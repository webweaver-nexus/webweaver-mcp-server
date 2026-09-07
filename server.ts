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
import { MCP_APP_HTML } from "./generated/mcp-app-html.js";

/**
 * Creates a new MCP server instance with all tools and resources registered.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "WebWeaver Nexus",
    version: "1.0.1",
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
      return {
        contents: [
          {
            uri: waitlistResourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: MCP_APP_HTML,
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

  server.registerTool(
    "get_product_overview",
    { description: "Returns a short description of what WebWeaver Nexus does." },
    async (): Promise<CallToolResult> => {
      return {
        content: [
          {
            type: "text",
            text: [
              "WebWeaver Nexus — Service Overview",
              "",
              'WebWeaver Nexus is a personal, AI-ready web development service based in East London. Acting as a \'technical partner\', we empower SMEs to transition their web presence from a static brochure to a dynamic digital asset which is optimised for today\'s AI-native web.',
              "",
              "Key Services:",
              "- Modern Web Foundations (AI-Search optimised Landing Pages & Websites)",
              "- Embedded AI Integrations (Internal AI Intelligence to automate your web services through customer support and lead qualification)",
              "- External AI App Connections (Tools, Apps, and Widgets to securely and interactively connect external AI users to your web services)",
              "",
              "Learn more at https://webweaver-nexus.vercel.app/",
            ].join("\n"),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_contact_info",
    { description: "Returns contact methods and links for WebWeaver Nexus." },
    async (): Promise<CallToolResult> => {
      return {
        content: [
          {
            type: "text",
            text: [
              "WebWeaver Nexus — Contact Information",
              "",
              "Preferred contact: https://webweaver-nexus.vercel.app/#contact",
              "Website : https://webweaver-nexus.vercel.app/",
              "YouTube : https://www.youtube.com/@WebWeaverNexus",
              "LinkedIn: https://www.linkedin.com/company/webweaver-nexus/",
              "Facebook : https://www.facebook.com/people/WebWeaver-Nexus/61577419581659/",
              "Twitter : https://x.com/WebWeaver_Nexus",
              "GitHub  : https://github.com/webweaver-nexus/",
            ].join("\n"),
          },
        ],
      };
    },
  );

  return server;
}