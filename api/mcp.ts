/**
 * Vercel serverless entry for the WebWeaver Nexus MCP server.
 * Exports the Express app as default; Vercel handles request injection.
 */

import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
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

// Serves protocol revision 2026-07-28 *and* the 2025 era from one endpoint.
//
// `legacy` defaults to 'stateless': each legacy request is answered by a fresh
// instance from this same factory, which is what this server already did by
// hand with `sessionIdGenerator: undefined`. Do NOT pass 'reject' — that would
// refuse every host that has not adopted the new revision, which is currently
// all of them. Clients default to the 2025 handshake with no probe, so they
// keep working untouched; a client opting in with
// `versionNegotiation: { mode: 'auto' }` gets the modern era instead.
//
// One consequence worth knowing: stateless serving has no session to attach
// 2025's session operations to, so GET and DELETE on /mcp are now answered
// `405 Method not allowed` where they previously returned 200. That is the
// SDK's documented stateless idiom, not a fault.
const mcpHandler = createMcpHandler(() => createServer(), {
  onerror: (error) => console.error("MCP error:", error),
});

const nodeHandler = toNodeHandler(mcpHandler);

// Hand the handler the body Express already parsed. Two reasons this is not
// just `app.all("/mcp", toNodeHandler(mcpHandler))`:
//   1. `createMcpExpressApp` installs `express.json()`, so the request stream
//      is already drained by the time the handler runs — it would see an empty
//      body and answer `-32700 Parse error: Invalid JSON`.
//   2. Express calls a route handler as `(req, res, next)`, and the handler's
//      third parameter is `parsedBody` — so passing it directly would hand it
//      the `next` function as the request body.
app.all("/mcp", (req: Request, res: Response) => {
  void nodeHandler(req, res, req.body);
});

export default app;
