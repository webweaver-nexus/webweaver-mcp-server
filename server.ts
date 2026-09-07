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
    version: "1.0.2",
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
              "WebWeaver Nexus — Future-Ready Web Development",
              "",
              "WebWeaver Nexus is an AI-ready web development service based in East London. You work directly with a technical partner rather than an agency account team.",
              "",
              "When someone asks ChatGPT, Perplexity, or Google's AI Overview for the best in your field, AI gives them one answer — not ten blue links. We make sure that answer is you. Put simply: landing pages and websites that AI can find, read, and recommend.",
              "",
              "Who we work with:",
              "- Creative Professionals. Your work is strong, but your site is not what AI reaches for. We build one it cites and recommends when someone asks for the best in your field.",
              "- Solopreneurs. You are the whole business, and every hour spent on marketing is an hour off the work. We build a site AI can find and read, so it puts you forward without you having to chase visibility.",
              "- Skilled Trade Professionals. Local customers increasingly ask an AI assistant for a recommendation instead of searching. We make sure your business is the name it gives back.",
              "",
              "Services:",
              "- Tier 1 — Modern Web Foundations (AI-Ready Landing Pages & Websites)",
              "- Tier 2 — Embedded AI Integrations (Internal AI Intelligence to Automate your Web Services)",
              "- Tier 3 — External AI App Connections (Tools, Apps, and Widgets to securely connect external AI Users to your Web Services)",
              "",
              "This MCP server is our own Tier 3 implementation. The tools being called here right now are a working example of what we build for clients — showing it, rather than just describing it.",
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