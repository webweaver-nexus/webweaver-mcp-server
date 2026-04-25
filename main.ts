/**
 * Entry point for the WebWeaver Nexus MCP server.
 * Supports Streamable HTTP (default) and stdio (--stdio flag) transports.
 *
 * On Vercel: Express app is exported as default; Vercel handles request injection.
 * Locally: app.listen() runs when VERCEL env var is absent.
 */

import express from "express"; // satisfies Vercel's Express preset detector
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import type { Request, Response } from "express";
import { createServer } from "./server.js";

// ── Build the Express app at module top level ──────────────────────────
const app = createMcpExpressApp({
  host: "0.0.0.0",
  allowedHosts: [
    "localhost",
    "127.0.0.1",
    "webweaver-nexus-mcp.vercel.app",
  ],
});
app.use(cors());

app.all("/mcp", async (req: Request, res: Response) => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
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

// ── Local dev / stdio entry point ──────────────────────────────────────
// Only runs when not on Vercel. On Vercel, the default export below is used.
if (!process.env.VERCEL) {
  if (process.argv.includes("--stdio")) {
    // stdio transport for Claude Desktop local config
    await createServer().connect(new StdioServerTransport());
  } else {
    // HTTP transport for local testing (e.g. with basic-host)
    const port = parseInt(process.env.PORT ?? "3001", 10);

    const httpServer = app.listen(port, (err) => {
      if (err) {
        console.error("Failed to start server:", err);
        process.exit(1);
      }
      console.log(`MCP server listening on http://localhost:${port}/mcp`);
    });

    const shutdown = () => {
      console.log("\nShutting down...");
      httpServer.close(() => process.exit(0));
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }
}

// ── Vercel serverless export ───────────────────────────────────────────
export default app;