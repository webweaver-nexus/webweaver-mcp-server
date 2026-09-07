# CLAUDE.md

Guidance for Claude Code when working in this repo. For commands, deployment, verification curls, and known limitations, see `README.md` — this file focuses on the architectural mental model and editing gotchas.

## Project Overview

MCP server that exposes WebWeaver Nexus's services to **external** AI hosts (Claude Desktop, claude.ai custom connectors, ChatGPT, Gemini, etc.) — *not* consumed by our own landing page or by the Python support agent. Three tools: `join_waitlist` (MCP App with embedded Tally form UI), `get_product_overview`, `get_contact_info`. Production: `https://webweaver-nexus-mcp.vercel.app/mcp`.

For the WebWeaver Nexus product context (this repo's role within Tier 3), see `../CLAUDE.md` and `../README.md` at the parent folder.

## Architecture

**Two-process model**, communicating across the MCP wire protocol:

- **Server (Node + Express + MCP SDK)** — registers tools and resources, handles JSON-RPC over Streamable HTTP (or stdio).
- **Client App (browser, runs in an iframe inside the MCP host)** — `src/mcp-app.ts` + `mcp-app.html` + CSS, bundled by Vite + `vite-plugin-singlefile` into a single self-contained `dist/mcp-app.html`. Served back to the host as a resource on `resources/read`.

**No shared types between server and client.** They communicate over the MCP protocol (JSON-RPC + `postMessage` via `@modelcontextprotocol/ext-apps`). Don't try to import across the boundary.

### Server: one core, two entry points

- `server.ts` — **canonical tool/resource registration.** Exports `createServer()`. This is the only place tools are defined.
- `main.ts` — local-dev entry. Supports `--stdio` or HTTP on `PORT` (default 3001). Imports `createServer()`.
- `api/mcp.ts` — Vercel serverless entry. Exports the Express app as `default`. Imports `createServer()`. Hardcodes `allowedHosts` (localhost + production domain) and uses `StreamableHTTPServerTransport` per-request (no session reuse).

When fixing a **tool** bug, edit `server.ts` — the change picks up in both entry points. When fixing a **transport/CORS/routing** bug, identify which entry point it affects.

### Client App lifecycle

`src/mcp-app.ts` instantiates `App` from `@modelcontextprotocol/ext-apps`, applies host context (theme, fonts, CSS variables, safe-area insets), loads the Tally embed script, and listens for `Tally.FormSubmitted` postMessages. On submission it calls `app.updateModelContext()` to notify the host model that the user signed up.

The Tally form is loaded as a third-party iframe inside the MCP App iframe — that's why CSP needs all three of `resourceDomains` / `frameDomains` / `connectDomains` set to `https://tally.so`.

## Adding or editing tools

**Plain tool (no UI)** — use `server.registerTool`. See `get_product_overview` / `get_contact_info` in `server.ts` for the pattern.

**MCP App tool (with UI)** — pair `registerAppTool` + `registerAppResource` from `@modelcontextprotocol/ext-apps/server`. See `join_waitlist` in `server.ts`. Required pieces:
- `_meta.ui.resourceUri` on the tool — points to the resource URI.
- `registerAppResource` returning the bundled HTML with `_meta.ui.csp` declaring any third-party domains the embed needs (`resourceDomains` for scripts, `frameDomains` for iframes, `connectDomains` for fetch/XHR).
- The HTML/CSS/TS for the UI lives under `src/` + `mcp-app.html`. Vite picks up the `INPUT` env var (`mcp-app.html`) at build time.

If you add another MCP App tool that needs a different UI, you'll need a second Vite entry — the current build assumes a single `INPUT`. That's a real refactor, not a config tweak.

## Configuration touchpoints

These are the places hardcoded values live. There are no env vars; don't go hunting for a `.env.example`.

| What | Where | Notes |
|---|---|---|
| Tally form ID | `src/mcp-app.ts` (`TALLY_FORM_ID` const) **and** `mcp-app.html` (`data-tally-src` URL) | **Must match in both files.** The TS const is checked against incoming `Tally.FormSubmitted` events; the HTML attribute is what Tally's loader reads. |
| Allowed Host headers | `api/mcp.ts` (`allowedHosts` array) | New deploy domains (preview URLs, alternate prod domains) must be added here or requests get rejected. |
| Server name/version | `server.ts` (`new McpServer({ name, version })`) | Reported to hosts on `initialize`. |
| App name/version | `src/mcp-app.ts` (`new App({ name, version })`) | Reported during the App handshake with the host. |
| Vercel runtime | `vercel.json` | `maxDuration` + routing only. `includeFiles` was removed once the HTML was compiled into the function. |
| CORS allowlist, rate limit, `trust proxy` | `api/mcp.ts` | Applies to local dev too — `main.ts` serves this same Express app. `trust proxy` is load-bearing: without it every caller shares one rate-limit bucket behind Vercel's proxy. |

## Known sharp edges

- **The App HTML is compiled in, not read from disk.** `server.ts` imports `MCP_APP_HTML` from `generated/mcp-app-html.ts`, which a `vite.config.ts` build plugin writes from `dist/mcp-app.html` on every build. Don't reintroduce a runtime `fs.readFile` or a path probe: the old `process.cwd()` lookup broke under stdio (`cwd=/`), and the probe that replaced it resolved to the *unbundled* source HTML on Vercel (tried and reverted around 28 April 2026). The plugin throws if the HTML it's about to inline still references `/src/mcp-app.ts`, which is the signature of that regression.
- **`generated/` is git-ignored, so build order matters.** `npm run build` runs Vite *before* the server type-check for this reason; on a fresh clone `server.ts` won't type-check until you've built once. `npm run serve` loads the constant at startup, so UI edits need a server restart (the old `fs.readFile` picked them up per-request).
- **claude.ai custom connectors currently ignore `frameDomains`** declared in `_meta.ui.csp` (upstream issue `anthropics/claude-ai-mcp#40`). The Tally embed in `join_waitlist` is blocked there until that's fixed; the two read-only tools work fine. Don't attempt to "fix" this from our side — it's a host bug.
- **`StreamableHTTPServerTransport` is constructed per-request** in `api/mcp.ts` with `sessionIdGenerator: undefined` (no session reuse). If you add stateful tools that need per-session memory, this is the place to revisit — currently every request is independent.

## Build / tsconfig topology

- `tsconfig.json` — client + shared type-checking (the App UI in `src/`).
- `tsconfig.server.json` — emits `.d.ts` and compiled JS for the server (`server.ts`, `main.ts`, `api/mcp.ts`).
- `vite.config.ts` — bundles the App UI (input from the `INPUT` env var), and hosts the `webweaver:inline-app-html` plugin that emits `generated/mcp-app-html.ts`.
- The full build (`npm run build`): Vite bundle (+ inline HTML into `generated/`) → typecheck client → typecheck server → emit server JS. Order matters: the server type-check depends on the generated module.

## What's not here

- **No tests.** Verification is via the README's `curl` checks and the basic-host harness from `ext-apps/examples/basic-host`.
- **No env vars.** All config is in-source.
- **No CI configured in this repo.** Vercel auto-deploys on push to `main`.
