import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CallToolResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";

// Works both from source (server.ts) and compiled (dist/server.js)
const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

/**
 * Creates a new MCP server instance with all tools and resources registered.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "WebWeaver Nexus",
    version: "1.0.0",
  });

  // ── MCP App tool: join_waitlist ──────────────────────────────────────

  const waitlistResourceUri = "ui://join-waitlist/mcp-app.html";

  registerAppTool(
    server,
    "join_waitlist",
    {
      title: "Join Waitlist",
      description:
        "Opens the WebWeaver Nexus waitlist signup form. Users can submit their details to join the early-access list.",
      inputSchema: {},
      _meta: { ui: { resourceUri: waitlistResourceUri } },
    },
    async (): Promise<CallToolResult> => {
      return {
        content: [
          {
            type: "text",
            text: "The WebWeaver Nexus waitlist form is now displayed. Fill it out to join the early-access list.",
          },
        ],
      };
    },
  );

  registerAppResource(
    server,
    waitlistResourceUri,
    waitlistResourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "mcp-app.html"),
        "utf-8",
      );

      return {
        contents: [
          {
            uri: waitlistResourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            _meta: {
              ui: {
                csp: {
                  // Tally embed script
                  resourceDomains: ["https://tally.so"],
                  // Tally iframe
                  frameDomains: ["https://tally.so"],
                  // Tally API calls from the embed
                  connectDomains: ["https://tally.so"],
                },
              },
            },
          },
        ],
      };
    },
  );

  // ── Plain MCP tools (no UI) ──────────────────────────────────────────

  server.tool(
    "get_product_overview",
    "Returns a short description of what WebWeaver Nexus does.",
    async (): Promise<CallToolResult> => {
      return {
        content: [
          {
            type: "text",
            text: [
              "WebWeaver Nexus — TODO: replace with real copy.",
              "",
              "WebWeaver Nexus is an AI-powered platform that helps you build, deploy, and manage modern web experiences.",
              "Key capabilities:",
              "- Intelligent page generation from natural-language briefs",
              "- One-click deployment to the edge",
              "- Built-in analytics and A/B testing",
              "",
              "Learn more at https://webweaver-nexus.vercel.app/",
            ].join("\n"),
          },
        ],
      };
    },
  );

  server.tool(
    "get_contact_info",
    "Returns contact methods and links for WebWeaver Nexus.",
    async (): Promise<CallToolResult> => {
      return {
        content: [
          {
            type: "text",
            text: [
              "WebWeaver Nexus — Contact Information (TODO: replace with real details)",
              "",
              "Website : https://webweaver-nexus.vercel.app/",
              "Email   : hello@example.com",
              "Twitter : @webweavernexus",
              "GitHub  : https://github.com/webweaver-nexus",
            ].join("\n"),
          },
        ],
      };
    },
  );

  return server;
}
