/**
 * Local-dev entry point for the WebWeaver Nexus MCP server.
 * Reuses the Express app from api/mcp.ts so dev and prod share the same wiring.
 *
 *   npm run serve        — Streamable HTTP transport on PORT (default 3001)
 *   npm run serve:stdio  — stdio transport for Claude Desktop local config
 *
 * On Vercel, this file is not executed; api/mcp.ts is invoked directly.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import app from "./api/mcp.js";
import { createServer } from "./server.js";

// Local development only: load .env from the working directory if one exists.
// Vercel injects env vars directly, and stdio hosts launch this with cwd=/,
// where there is nothing to find — Claude Desktop's config carries an `env`
// block instead. See .env.example.
try {
  process.loadEnvFile();
} catch {
  // No .env, or not readable. Both are normal.
}

if (process.argv.includes("--stdio")) {
  await createServer().connect(new StdioServerTransport());
} else {
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
