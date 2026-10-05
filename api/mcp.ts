/**
 * Vercel serverless entry for the WebWeaver Nexus MCP server.
 * Exports the Express app as default; Vercel handles request injection.
 */

import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import cors from "cors";
import type { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { createServer } from "../server.js";

// No `allowedHosts` here on purpose — see the host validation below. The SDK
// logs a "binding without DNS rebinding protection" warning at startup as a
// result; it is expected, and the middleware below provides that protection.
const app = createMcpExpressApp({ host: "0.0.0.0" });

// Vercel (and the cloudflared tunnel used for local claude.ai testing) fronts
// the app with a single proxy hop and sets X-Forwarded-For. Without this,
// Express falls back to the proxy's socket IP, so every caller shares one
// rate-limit bucket and a single noisy client can 429 all other hosts.
app.set("trust proxy", 1);

// Host header validation (DNS rebinding protection). The SDK's `allowedHosts`
// option matches exact strings only, which rejected two hostnames we serve
// legitimately: Vercel preview deployments and the `cloudflared` tunnel the
// README uses to test local dev against claude.ai. Patterns cover both.
const ALLOWED_HOSTS: readonly (string | RegExp)[] = [
  "localhost",
  "127.0.0.1",
  "[::1]",
  "webweaver-nexus-mcp.vercel.app",
  // Vercel preview deployments, e.g. webweaver-nexus-mcp-git-<branch>-<scope>
  /^webweaver-nexus-mcp-[a-z0-9-]+\.vercel\.app$/,
  // `npx cloudflared tunnel --url http://localhost:3001` — dev only; this
  // hostname never reaches the Vercel deployment, its edge rejects it first.
  /^[a-z0-9-]+\.trycloudflare\.com$/,
];

app.use((req: Request, res: Response, next: NextFunction) => {
  const hostHeader = req.headers.host;
  let hostname: string | undefined;

  if (hostHeader) {
    try {
      // Parsing via URL keeps this port-agnostic and IPv6-safe, matching the
      // SDK middleware this replaces.
      hostname = new URL(`http://${hostHeader}`).hostname;
    } catch {
      hostname = undefined;
    }
  }

  const allowed =
    hostname !== undefined &&
    ALLOWED_HOSTS.some((entry) =>
      typeof entry === "string" ? entry === hostname : entry.test(hostname),
    );

  if (!allowed) {
    res.status(403).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: `Invalid Host: ${hostHeader ?? "(missing)"}`,
      },
      id: null,
    });
    return;
  }

  next();
});

app.use(
  cors({
    origin: [
      /^http:\/\/localhost(:\d+)?$/,
      "https://claude.ai",
      "https://chatgpt.com",
      "https://chat.openai.com",
    ],
    credentials: false,
  }),
);

app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);

app.all("/mcp", async (req: Request, res: Response) => {
  const server = createServer();
  const transport = new NodeStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

export default app;
