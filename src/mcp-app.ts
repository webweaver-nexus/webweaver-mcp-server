/**
 * @file MCP App client for the WebWeaver Nexus waitlist form.
 *
 * Embeds an existing Tally form via their loader script and listens for
 * the Tally.FormSubmitted event to notify the MCP host on successful submission.
 */

import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import "./global.css";
import "./mcp-app.css";

// ── Tally form ID — swap this when you have your real form ─────────────
const TALLY_FORM_ID = "3xGZlk";

// ── DOM references ─────────────────────────────────────────────────────
const mainEl = document.querySelector(".main") as HTMLElement;
const confirmationEl = document.getElementById("confirmation")!;

// ── Host context theming ───────────────────────────────────────────────
function handleHostContextChanged(ctx: McpUiHostContext) {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  if (ctx.safeAreaInsets) {
    mainEl.style.paddingTop = `${ctx.safeAreaInsets.top}px`;
    mainEl.style.paddingRight = `${ctx.safeAreaInsets.right}px`;
    mainEl.style.paddingBottom = `${ctx.safeAreaInsets.bottom}px`;
    mainEl.style.paddingLeft = `${ctx.safeAreaInsets.left}px`;
  }
}

// ── MCP App lifecycle ──────────────────────────────────────────────────
const app = new App({ name: "WebWeaver Nexus Waitlist", version: "1.0.0" });

app.onteardown = async () => {
  return {};
};

app.ontoolinput = (params) => {
  console.info("Tool input:", params);
};

app.ontoolresult = (result) => {
  console.info("Tool result:", result);
};

app.onerror = console.error;
app.onhostcontextchanged = handleHostContextChanged;

await app.connect();
const ctx = app.getHostContext();
if (ctx) handleHostContextChanged(ctx);

// ── Load the Tally embed script ────────────────────────────────────────
// Tally's loader finds iframes with data-tally-src and swaps in a real src,
// wiring up dynamic height + postMessage events. It does NOT do this on its
// own: the script only assigns window.Tally and handles popup config, so
// loadEmbeds() has to be called explicitly or the iframe keeps its
// data-tally-src, never gets a src, and the form silently never renders.
const tallyScript = document.createElement("script");
tallyScript.src = "https://tally.so/widgets/embed.js";
tallyScript.async = true;
tallyScript.onload = () => {
  if (!window.Tally) {
    console.error("[mcp-app] Tally embed script loaded but window.Tally is missing.");
    return;
  }
  window.Tally.loadEmbeds();
};
tallyScript.onerror = () => {
  console.error("[mcp-app] Failed to load the Tally embed script.");
};
document.head.appendChild(tallyScript);

// ── Listen for Tally form submission ───────────────────────────────────
window.addEventListener("message", async (event: MessageEvent) => {
  if (typeof event.data !== "string") return;

  let payload: { event?: string; payload?: { formId?: string } };
  try {
    payload = JSON.parse(event.data);
  } catch {
    // Not a JSON message — ignore
    return;
  }

  if (
    payload.event !== "Tally.FormSubmitted" ||
    payload.payload?.formId !== TALLY_FORM_ID
  ) {
    return;
  }

  // Show local confirmation
  confirmationEl.hidden = false;

  // Notify the MCP host so the model knows the user signed up. Not every host
  // accepts context updates — MCP Inspector, for one, never registers a
  // handler — so check the capability rather than letting the call reject.
  if (!app.getHostCapabilities()?.updateModelContext) {
    console.info(
      "[mcp-app] Host does not accept model context updates; skipping.",
    );
    return;
  }

  await app.updateModelContext({
    content: [
      {
        type: "text",
        text: "The user has successfully submitted the WebWeaver Nexus waitlist form.",
      },
    ],
  });
});
