import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import {
  McpServer,
  type CallToolResult,
  type ReadResourceResult,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import { MCP_APP_HTML } from "./generated/mcp-app-html.js";
import {
  PRIMARY_GOAL_OPTIONS,
  type PrimaryGoal,
} from "./src/contact-contract.js";

/** Landing page that owns the contact API. Overridden for local development. */
const DEFAULT_CONTACT_API_BASE_URL = "https://webweaver-nexus.vercel.app";

/** The contact API answers in milliseconds; this only bounds a hung socket. */
const SUBMIT_TIMEOUT_MS = 10_000;

const contactFormResourceUri = "ui://get-contact-form/mcp-app.html";

/** Tuple form of the vendored options, for z.enum. */
const PRIMARY_GOAL_VALUES = PRIMARY_GOAL_OPTIONS.map(
  (option) => option.value,
) as unknown as [PrimaryGoal, ...PrimaryGoal[]];

/**
 * Machine-readable outcome attached to every `submit_contact_form` result.
 * The App switches on `kind` to decide whether to paint field errors, offer a
 * retry, or fall back to the web form.
 */
type SubmitOutcome =
  | { ok: true }
  | {
      ok: false;
      kind: "validation" | "config" | "rate_limit" | "network" | "server";
      message: string;
      fieldErrors?: Record<string, string[]>;
      retryAfterSeconds?: number;
    };

function submitResult(outcome: SubmitOutcome, text: string): CallToolResult {
  return {
    content: [{ type: "text", text }],
    structuredContent: outcome,
    ...(outcome.ok ? {} : { isError: true }),
  };
}

/**
 * Creates a new MCP server instance with all tools and resources registered.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "WebWeaver Nexus",
    version: "2.1.0",
  });

  // ── MCP App tool: get_contact_form ───────────────────────────────────

  registerAppTool(
    server,
    "get_contact_form",
    {
      title: "Contact WebWeaver Nexus",
      description:
        "Displays the WebWeaver Nexus contact form so the user can get in " +
        "touch — to book the \"AI-Ready\" Discovery & Audit, or to enquire " +
        "about a particular service. Call this when the user wants to make " +
        "contact; they fill the form in themselves, so do not collect their " +
        "details in the conversation first.",
      inputSchema: z.object({}),
      _meta: { ui: { resourceUri: contactFormResourceUri } },
    },
    async (): Promise<CallToolResult> => {
      return {
        content: [
          {
            type: "text",
            text:
              "The WebWeaver Nexus contact form is now displayed. The user " +
              "completes and submits it themselves; wait for them rather than " +
              "asking for their details here.",
          },
        ],
      };
    },
  );

  registerAppResource(
    server,
    contactFormResourceUri,
    contactFormResourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      return {
        contents: [
          {
            uri: contactFormResourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: MCP_APP_HTML,
            _meta: {
              ui: {
                // No `csp` by design. The form is rendered natively in this
                // document and makes zero external requests, so there is
                // nothing to allow-list. That is the actual fix for the host
                // bug this replaced: the previous Tally embed needed
                // frameDomains, and Claude Desktop and claude.ai both drop
                // that key, blocking the nested iframe outright. A policy we
                // do not depend on cannot be ignored.
                prefersBorder: true,
              },
            },
          },
        ],
      };
    },
  );

  // ── App-only tool: submit_contact_form ───────────────────────────────
  //
  // `visibility: ["app"]` keeps this out of tools/list for the model: it is
  // callable only by our own App over the postMessage bridge. That is what
  // lets the App submit without ever holding CONTACT_FORM_SHARED_SECRET — the
  // credential is read here, server-side, and the App is bundled into a
  // ~435 KB HTML string handed to every user.
  //
  // It also means the model cannot invent a submission: it cannot see the
  // tool. Submissions are recorded source='mcp' upstream regardless, so any
  // that did appear would still be identifiable.

  server.registerTool(
    "submit_contact_form",
    {
      title: "Submit Contact Form",
      description:
        "Internal. Submits the WebWeaver Nexus contact form on behalf of the " +
        "app that renders it. Not for direct use — call get_contact_form and " +
        "let the user complete the form.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      _meta: { ui: { visibility: ["app"] } },
      inputSchema: z.object({
        fullName: z.string().trim().min(1).max(120),
        email: z.email().max(254),
        company: z.string().trim().max(160).optional(),
        primaryGoal: z.enum(PRIMARY_GOAL_VALUES),
        // The upstream schema is z.literal(true): consent is a precondition,
        // not a field with two valid values.
        consentPrivacy: z.literal(true),
        foundingClient: z.boolean().optional(),
        // Epoch ms from the App. Required upstream, but its plausibility range
        // is only enforced for untrusted browser callers, not for us.
        renderedAt: z.number().int().nonnegative(),
      }),
    },
    async (args): Promise<CallToolResult> => {
      const secret = process.env.CONTACT_FORM_SHARED_SECRET;
      if (!secret) {
        console.error(
          "[submit_contact_form] CONTACT_FORM_SHARED_SECRET is not set",
        );
        return submitResult(
          {
            ok: false,
            kind: "config",
            message:
              "This server is not configured to accept submissions yet. " +
              "Please use the contact form on the website instead.",
          },
          "Submission failed: the server is missing its contact API credential.",
        );
      }

      const base = (
        process.env.CONTACT_API_BASE_URL ?? DEFAULT_CONTACT_API_BASE_URL
      ).replace(/\/$/, "");

      let response: Response;
      try {
        response = await fetch(`${base}/api/contact`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${secret}`,
          },
          // Deliberately explicit rather than spreading `args`: the upstream
          // honeypot field is `companyWebsite`, and any value in it triggers a
          // silent reject. Naming each field keeps it impossible to forward.
          body: JSON.stringify({
            fullName: args.fullName,
            email: args.email,
            company: args.company,
            primaryGoal: args.primaryGoal,
            consentPrivacy: true,
            foundingClient: args.foundingClient ?? false,
            renderedAt: args.renderedAt,
          }),
          signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
        });
      } catch (error) {
        const timedOut = error instanceof Error && error.name === "TimeoutError";
        console.error("[submit_contact_form] request failed", error);
        return submitResult(
          {
            ok: false,
            kind: "network",
            message: timedOut
              ? "The request timed out. Please try again."
              : "We could not reach the server. Please try again in a moment.",
          },
          "Submission failed: the contact API was unreachable.",
        );
      }

      if (response.ok) {
        // A duplicate inside the upstream 10-minute window also lands here,
        // with no new row written. That is the intended outcome — a
        // double-submit must not produce two leads or two emails.
        return submitResult(
          { ok: true },
          "The user submitted the WebWeaver Nexus contact form successfully.",
        );
      }

      const body = (await response.json().catch(() => null)) as {
        message?: string;
        fieldErrors?: Record<string, string[]>;
      } | null;

      if (response.status === 422 && body?.fieldErrors) {
        return submitResult(
          {
            ok: false,
            kind: "validation",
            message: body.message ?? "Please check the highlighted fields.",
            fieldErrors: body.fieldErrors,
          },
          "Submission rejected: some fields need correcting.",
        );
      }

      if (response.status === 401) {
        // Presents as a form bug and is a configuration mismatch. Say which,
        // so the next person does not debug the form.
        console.error(
          "[submit_contact_form] 401 from the contact API — " +
            "CONTACT_FORM_SHARED_SECRET does not match the landing page's value",
        );
        return submitResult(
          {
            ok: false,
            kind: "config",
            message:
              "This server is not authorised to submit the form. " +
              "Please use the contact form on the website instead.",
          },
          "Submission failed: the contact API rejected our credential (401). " +
            "The shared secret here does not match the landing page's.",
        );
      }

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after"));
        return submitResult(
          {
            ok: false,
            kind: "rate_limit",
            message: "Too many submissions. Please try again shortly.",
            ...(Number.isFinite(retryAfter) && retryAfter > 0
              ? { retryAfterSeconds: retryAfter }
              : {}),
          },
          "Submission failed: rate limited by the contact API.",
        );
      }

      console.error(
        `[submit_contact_form] unexpected ${response.status} from the contact API`,
      );
      return submitResult(
        {
          ok: false,
          kind: "server",
          message:
            body?.message ?? "Something went wrong. Please try again in a moment.",
        },
        `Submission failed: the contact API returned ${response.status}.`,
      );
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
