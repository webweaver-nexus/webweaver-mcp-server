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
  issueFormToken,
  readFormTokenSecret,
  verifyFormToken,
} from "./form-token.js";
import {
  PRIMARY_GOAL_OPTIONS,
  type PrimaryGoal,
} from "./src/contact-contract.js";
import {
  FORM_TOKEN_META_KEY,
  type SubmitOutcome,
} from "./src/submit-outcome.js";

/** Landing page that owns the contact API. Overridden for local development. */
const DEFAULT_CONTACT_API_BASE_URL = "https://webweaver-nexus.vercel.app";

/** The contact API answers in milliseconds; this only bounds a hung socket. */
const SUBMIT_TIMEOUT_MS = 10_000;

const contactFormResourceUri = "ui://get-contact-form/mcp-app.html";

/** Tuple form of the vendored options, for z.enum. */
const PRIMARY_GOAL_VALUES = PRIMARY_GOAL_OPTIONS.map(
  (option) => option.value,
) as unknown as [PrimaryGoal, ...PrimaryGoal[]];

/** Shown for any form-token failure. Deliberately one message for all of them. */
const FORM_EXPIRED_MESSAGE =
  "This form has expired. Please ask for the contact form again.";

// SubmitOutcome is the shared contract in src/submit-outcome.ts. It used to be
// duplicated here, which meant a new failure `kind` had to be added in two
// places — the drift that module exists to prevent.
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
    version: "2.3.0",
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
      // Opens a form; changes nothing. readOnlyHint defaults to false in the
      // MCP spec, so without this Gemini filed it under "Write / delete".
      // Issuing a fresh form token per call is not a state change.
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: { ui: { resourceUri: contactFormResourceUri } },
    },
    async (): Promise<CallToolResult> => {
      const result: CallToolResult = {
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

      // Issue the form token. It goes in `_meta`, never `content` (the model's
      // text) and never `structuredContent`. The App reads it from the
      // tool-result notification. See src/submit-outcome.ts.
      const secret = readFormTokenSecret(process.env.MCP_FORM_TOKEN_SECRET);
      if (secret.ok) {
        result._meta = { [FORM_TOKEN_META_KEY]: issueFormToken(secret.secret) };
      } else {
        // The form still renders — opening it changes nothing — but it cannot
        // be submitted, and the App shows its "continue on the web" fallback.
        console.error(
          `[get_contact_form] MCP_FORM_TOKEN_SECRET is ${secret.problem === "unset" ? "not set" : "shorter than 32 characters"}; ` +
            "issuing no form token, so submissions will be refused",
        );
      }
      return result;
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
        // Marketing permission, distinct from consentPrivacy above: that one
        // is a precondition of replying, this is a separate lawful basis the
        // enquirer may decline. Optional upstream — verified against the live
        // API, which does not list it among the required fields.
        marketingOptIn: z.boolean().optional(),
        // Epoch ms from the App. Required upstream, but its plausibility range
        // is only enforced for untrusted browser callers, not for us.
        renderedAt: z.number().int().nonnegative(),
        // Issued by get_contact_form, carried by the App. Optional in the
        // schema only so that a missing token produces our clear message
        // rather than an SDK input-validation error — it is required in
        // practice, and checked before anything else below.
        formToken: z.string().max(512).optional(),
      }),
    },
    async (args): Promise<CallToolResult> => {
      // ── Form token: checked before anything else ─────────────────────────
      // Visibility ["app"] relies on every host honouring the spec; Gemini
      // does not. This makes the server enforce "only the rendered form can
      // submit" itself. Nothing is sent anywhere until it passes.
      const tokenSecret = readFormTokenSecret(process.env.MCP_FORM_TOKEN_SECRET);
      if (!tokenSecret.ok) {
        // Fail closed. Never fall back to accepting unsigned submissions.
        console.error(
          `[submit_contact_form] MCP_FORM_TOKEN_SECRET is ${tokenSecret.problem === "unset" ? "not set" : "shorter than 32 characters"}; ` +
            "refusing every submission until it is configured",
        );
        return submitResult(
          {
            ok: false,
            kind: "config",
            message:
              "This server is not configured to accept submissions yet. " +
              "Please use the contact form on the website instead.",
          },
          "Submission refused: the server has no form-token secret configured.",
        );
      }

      const verdict = verifyFormToken(args.formToken, tokenSecret.secret);
      if (!verdict.ok) {
        // The reason is logged for diagnosis; the user gets one message for
        // every failure. The token carries no personal data, so neither does
        // this log line.
        console.warn(`[submit_contact_form] form token rejected: ${verdict.reason}`);
        return submitResult(
          { ok: false, kind: "form_token", message: FORM_EXPIRED_MESSAGE },
          `Submission refused: form token ${verdict.reason}. ${FORM_EXPIRED_MESSAGE}`,
        );
      }

      // ── Existing submission chain, unchanged ─────────────────────────────
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
            marketingOptIn: args.marketingOptIn ?? false,
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
    {
      title: "WebWeaver Nexus Product Overview",
      description: "Returns a short description of what WebWeaver Nexus does.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
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
              "When someone asks ChatGPT, Perplexity, or Google's AI Overview for the best in your field, AI gives them one answer — not ten blue links. We make sure that answer is you. Put simply: landing pages and websites that tell your story — and that AI can find, read, and recommend.",
              "",
              "Story for people, structure for AI. Anyone can generate a website with AI now. What AI can't generate is your story: why you do the work, what makes you the right choice, and the proof behind it. That's where we start. Every build pairs copy and design shaped around your business with the structured data that lets AI search understand it and recommend you.",
              "",
              "Who we work with:",
              "- Creative Professionals. Your work is strong, but your site is not what AI reaches for. We build one it cites and recommends when someone asks for the best in your field.",
              "- Solopreneurs. You are the whole business, and every hour spent on marketing is an hour off the work. We build a site AI can find and read, so it puts you forward without you having to chase visibility.",
              "- Skilled Trade Professionals. Local customers increasingly ask an AI assistant for a recommendation instead of searching. We make sure your business is the name it gives back.",
              "",
              "Services:",
              "- Tier 1 — Modern Web Foundations. Two options, each starting at a single page and growing into a website as you need more pages: 1A Essentials, optimised for Local/Standard SEO, and 1B AI-Search Optimised, which adds AEO and GEO on top. Every Tier 1 build includes story-led copy, written or refined from a short questionnaire. An optional CRM Connect add-on sends every enquiry into your own HubSpot CRM.",
              "- Tier 2 — Embedded AI Integrations (Internal AI Intelligence to Automate your Web Services). Option A, the Customer Support Assistant, can add CRM Connect so chat enquiries reach HubSpot too. Option B, the Lead-Filtering Agent, delivers scored leads into your own HubSpot CRM as standard.",
              "- Tier 3 — External AI App Connections (Tools, Apps, and Widgets to securely connect external AI Users to your Web Services)",
              "",
              "This MCP server is our own Tier 3 implementation. The tools being called here right now are a working example of what we build for clients — showing it, rather than just describing it.",
              "",
              "For current prices and timescales see the website — this overview deliberately carries no figures, so there is nothing here to go stale. Do not quote prices from memory.",
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
    {
      title: "WebWeaver Nexus Contact Details",
      description: "Returns contact methods and links for WebWeaver Nexus.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (): Promise<CallToolResult> => {
      return {
        content: [
          {
            type: "text",
            text: [
              "WebWeaver Nexus — Contact Information",
              "",
              "Preferred contact: https://webweaver-nexus.vercel.app/#contact",
              "Website   : https://webweaver-nexus.vercel.app/",
              "YouTube   : https://www.youtube.com/@WebWeaverNexus",
              "LinkedIn  : https://www.linkedin.com/company/webweaver-nexus",
              "Facebook  : https://www.facebook.com/people/WebWeaver-Nexus/61577419581659/",
              "Instagram : https://www.instagram.com/webweaver_nexus/",
              "X         : https://x.com/WebWeaver_Nexus",
              "GitHub    : https://github.com/webweaver-nexus",
              "Google Business Profile : https://g.page/webweaver-nexus",
            ].join("\n"),
          },
        ],
      };
    },
  );

  return server;
}
