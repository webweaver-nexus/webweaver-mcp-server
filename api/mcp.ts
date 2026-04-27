/**
 * Vercel serverless entry for the WebWeaver Nexus MCP server.
 * Exports the Express app as default; Vercel handles request injection.
 */

import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import type { Request, Response } from "express";
import { createServer } from "../server.js";

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

export default app;
