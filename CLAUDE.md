# CLAUDE.md

Guidance for Claude Code when working in this repo. For commands, deployment, verification curls, and known limitations, see `README.md` — this file focuses on the architectural mental model and editing gotchas.

## Project Overview

MCP server that exposes WebWeaver Nexus's services to **external** AI hosts (Claude Desktop, claude.ai custom connectors, ChatGPT, Gemini, etc.) — *not* consumed by our own landing page or by the Python support agent. Production: `https://webweaver-nexus-mcp.vercel.app/mcp`.

Three model-facing tools — `get_contact_form` (MCP App with a natively rendered contact form), `get_product_overview`, `get_contact_info` — plus `submit_contact_form`, which carries `_meta.ui.visibility: ["app"]` so compliant hosts hide it from the model and let only our own App call it.

For the WebWeaver Nexus product context (this repo's role within Tier 3), see `../CLAUDE.md` and `../README.md` at the parent folder.

## Architecture

**Two-process model**, communicating across the MCP wire protocol:

- **Server (Node + Express + MCP SDK)** — registers tools and resources, handles JSON-RPC over Streamable HTTP (or stdio).
- **Client App (browser, runs in an iframe inside the MCP host)** — `src/mcp-app.ts` + `mcp-app.html` + CSS, bundled by Vite + `vite-plugin-singlefile` into a single self-contained `dist/mcp-app.html`. Served back to the host as a resource on `resources/read`.

**No shared types between server and client.** They communicate over the MCP protocol (JSON-RPC + `postMessage` via `@modelcontextprotocol/ext-apps`). Don't try to import across the boundary.

### Server: one core, two entry points

- `server.ts` — **canonical tool/resource registration.** Exports `createServer()`. This is the only place tools are defined.
- `main.ts` — local-dev entry. Supports `--stdio` or HTTP on `PORT` (default 3001). Imports `createServer()`.
- `api/mcp.ts` — Vercel serverless entry. Exports the Express app as `default`. Imports `createServer()`. Owns the edge concerns — `trust proxy`, Host validation, CORS, rate limiting — and uses `StreamableHTTPServerTransport` per-request (no session reuse).

When fixing a **tool** bug, edit `server.ts` — the change picks up in both entry points. When fixing a **transport/CORS/routing** bug, identify which entry point it affects.

### Client App lifecycle

`src/mcp-app.ts` instantiates `App` from `@modelcontextprotocol/ext-apps`, applies host context (theme, fonts, CSS variables, safe-area insets), renders the contact form from the vendored contract, and submits it with `app.callServerTool({ name: "submit_contact_form" })`. On success it calls `app.updateModelContext()` so the host's model knows the user made contact.

**The App makes zero external requests, and that is load-bearing.** It needs no `_meta.ui.csp` at all, which is why the host CSP bug that killed the previous Tally embed cannot recur (see the sharp edges). Submitting through the bridge rather than `fetch` is equally deliberate: the shared secret stays server-side, and the App — a ~450 KB HTML string handed to every user — never holds a credential.

## Adding or editing tools

**Plain tool (no UI)** — use `server.registerTool`. See `get_product_overview` / `get_contact_info` in `server.ts` for the pattern.

**App-only tool** — a tool the App calls but the model should not see: register it with `server.registerTool` and `_meta: { ui: { visibility: ["app"] } }`. See `submit_contact_form`. **Filtering is the host's job, not ours** — `tools/list` returns it to every client, and a compliant host hides it from the model. Treat it as a strong hint, not an access control: anything behind it still needs to be safe if the model calls it directly.

**MCP App tool (with UI)** — pair `registerAppTool` + `registerAppResource` from `@modelcontextprotocol/ext-apps/server`. See `get_contact_form` in `server.ts`. Required pieces:
- `_meta.ui.resourceUri` on the tool — points to the resource URI.
- `registerAppResource` returning the bundled HTML with `_meta.ui.csp` declaring any third-party domains the embed needs (`resourceDomains` for scripts, `frameDomains` for iframes, `connectDomains` for fetch/XHR).
- The HTML/CSS/TS for the UI lives under `src/` + `mcp-app.html`. Vite picks up the `INPUT` env var (`mcp-app.html`) at build time.

If you add another MCP App tool that needs a different UI, you'll need a second Vite entry — the current build assumes a single `INPUT`. That's a real refactor, not a config tweak.

## Configuration touchpoints

Most configuration is in-source. **Two env vars are the exception** — see `.env.example`. This used to read "there are no env vars"; the contact API needs a credential and a target, and a credential cannot be in-source.

| What | Where | Notes |
|---|---|---|
| `CONTACT_FORM_SHARED_SECRET` | env, read **only** in `server.ts` | Bearer token for the landing page's `/api/contact`. Must match the value in that project. **Never import it into anything under `src/`** — that is bundled into the App and served to every user. A mismatch surfaces as a 401 that looks like a form bug; check the two projects agree first. |
| `CONTACT_API_BASE_URL` | env, read **only** in `server.ts` | Defaults to `https://webweaver-nexus.vercel.app`. A trailing slash is stripped. Point it at `http://localhost:3000` for development — against production, every test submission writes a real row and sends two real emails. |
| Contact form contract | `src/contact-contract.ts` (**generated**) | The 8 goal options, field copy, consent text. Regenerate with `npm run sync:contract`; verify with `npm run check:contract`. Never hand-edit: the option strings are also the keys of `GOAL_PARAGRAPHS` upstream, and a one-byte drift silently drops the welcome email's personalised paragraph. |
| Privacy policy / web form URLs | `src/mcp-app.ts` (`SITE_URL`) | Always production, deliberately: these are links shown to a user, and a local dev server is not where to send someone to read a policy. Not secret, safe to bundle. |
| Allowed Host headers | `api/mcp.ts` (`ALLOWED_HOSTS` array) | Strings match exactly, regexes match patterns (Vercel previews, `*.trycloudflare.com`). New deploy domains must be added here or requests 403. Anchor any regex you add — `.vercel.app` unanchored would match `evil-....vercel.app.attacker.com`. |
| Server name/version | `server.ts` (`new McpServer({ name, version })`) | Reported to hosts on `initialize`. |
| App name/version | `src/mcp-app.ts` (`new App({ name, version })`) | Reported during the App handshake with the host. |
| Vercel runtime | `vercel.json` | `maxDuration` + routing only. `includeFiles` was removed once the HTML was compiled into the function. |
| CORS allowlist, rate limit, `trust proxy` | `api/mcp.ts` | Applies to local dev too — `main.ts` serves this same Express app. `trust proxy` is load-bearing: without it every caller shares one rate-limit bucket behind Vercel's proxy. |

## Known sharp edges

- **The App HTML is compiled in, not read from disk.** `server.ts` imports `MCP_APP_HTML` from `generated/mcp-app-html.ts`, which a `vite.config.ts` build plugin writes from `dist/mcp-app.html` on every build. Don't reintroduce a runtime `fs.readFile` or a path probe: the old `process.cwd()` lookup broke under stdio (`cwd=/`), and the probe that replaced it resolved to the *unbundled* source HTML on Vercel (tried and reverted around 28 April 2026). The plugin throws if the HTML it's about to inline still references `/src/mcp-app.ts`, which is the signature of that regression.
- **`generated/` is git-ignored, so build order matters.** `npm run build` runs Vite *before* the server type-check for this reason; on a fresh clone `server.ts` won't type-check until you've built once. `npm run serve` loads the constant at startup, so UI edits need a server restart (the old `fs.readFile` picked them up per-request).
- **The SDK's `allowedHosts` option is deliberately unused.** It only matches exact strings, so it cannot express Vercel preview domains or tunnel hostnames; `api/mcp.ts` supplies equivalent middleware instead. The SDK therefore logs a "binding to 0.0.0.0 without DNS rebinding protection" warning at startup — expected, not a regression.
- **The App must never make an external request.** The form is rendered in this document and submits over the postMessage bridge, so `registerAppResource` declares **no `_meta.ui.csp`** at all. That is the fix for the host bug below, not a workaround for it: a policy we do not depend on cannot be ignored by a host. Adding any third-party script, iframe, font or `fetch` to `src/mcp-app.ts` would reintroduce a CSP dependency and, if it is a frame, the exact breakage this replaced.
- **Inspector cannot receive `ui/update-model-context`.** As of v2.5.0 it registers no `onupdatemodelcontext` handler and does not declare the capability, so `app.updateModelContext()` would reject there. `src/mcp-app.ts` checks `getHostCapabilities()` before calling. Use `tools/basic-host` to verify that path.
- **MCP Inspector strips `allow-same-origin` from the App sandbox** (v2.5.0), so the App runs on an opaque origin. Under an opaque origin `localStorage`, `sessionStorage` and `document.cookie` all throw `SecurityError` — which is why `RENDERED_AT` is a module-scope constant in `src/mcp-app.ts` and must stay one. This is what killed the old Tally embed's controls (its own JS needed same-origin storage); native controls need no storage, so the form itself is unaffected.
- **`claude.ai` and Claude Desktop ignore `frameDomains`** in `_meta.ui.csp` (upstream `anthropics/claude-ai-mcp#40`). This is the bug the native form exists to escape, kept here because it constrains any future UI work: **never put a third-party iframe in an MCP App.** Captured in Claude Desktop's DevTools: `Framing 'https://tally.so/' violates the following Content Security Policy directive: "frame-src 'self' blob: data:"`. Only `frameDomains` is lost — the App frame URL carried `connect-src` and `resource-src` fine, with no `frame-src` parameter at all. Nesting an iframe of *our own* form would hit the identical bug; the shape is the problem, not Tally.
- **`app.callServerTool()` needs the host's `serverTools` capability, and not every host has it.** Without it the form cannot submit. `src/mcp-app.ts` probes on load — not on submit — and shows a "continue on the web" fallback instead of a form. Keep that ordering: a form whose submit button silently does nothing is worse than no form, because it looks like it worked.
- **`visibility: ["app"]` is a host-side hint, not an access control.** `submit_contact_form` is returned by `tools/list` to every client; hosts are expected to hide it from the model. So it still has to be safe if a model calls it directly — hence `consentPrivacy: z.literal(true)`, and upstream recording every such submission as `source='mcp'`.
- **`StreamableHTTPServerTransport` is constructed per-request** in `api/mcp.ts` with `sessionIdGenerator: undefined` (no session reuse). If you add stateful tools that need per-session memory, this is the place to revisit — currently every request is independent.

## Build / tsconfig topology

- `tsconfig.json` — client + shared type-checking (the App UI in `src/`).
- `tsconfig.server.json` — emits `.d.ts` and compiled JS for the server (`server.ts`, `main.ts`, `api/mcp.ts`, plus `src/contact-contract.ts`, which the server imports for its `z.enum` of goal options).
- `tsconfig.scripts.json` — type-checks `scripts/` only, `noEmit`. It needs an explicit `"types": ["node"]`; without it, automatic `@types` discovery does not apply through `extends` and every `node:` import fails to resolve.
- `vite.config.ts` — bundles the App UI (input from the `INPUT` env var), and hosts the `webweaver:inline-app-html` plugin that emits `generated/mcp-app-html.ts`.
- The full build (`npm run build`): Vite bundle (+ inline HTML into `generated/`) → typecheck client → typecheck scripts → typecheck server → emit server JS. Order matters: the server type-check depends on the generated module.
- `npm run check:contract` is **not** part of the build, deliberately: the build must work offline and on a fresh clone. It is a release step.

## What's not here

- **No tests.** Verification is via the README's `curl` checks, `npm run check:contract`, MCP Inspector (the default harness), and the vendored `tools/basic-host` harness for model-context updates.
- **Two env vars**, both for the contact API, both read only in `server.ts`. Everything else is in-source. See `.env.example` and the configuration touchpoints above. `npm run serve` loads `.env` from the working directory; the stdio entry point runs with `cwd=/` and cannot, so a stdio host config needs its own `env` block.
- **No CI for build or test.** The only workflow is the manual-dispatch MCP registry publish (`.github/workflows/publish-mcp-registry.yml`). Vercel auto-deploys on push to `main`.
