# WebWeaver Nexus MCP Server

An MCP server that exposes WebWeaver Nexus services — a contact form (rendered as an interactive MCP App), product overview, and contact info — to MCP-enabled hosts (Claude Desktop, claude.ai, ChatGPT, Cursor, MCP Inspector, basic-host).

**Production URL:** `https://webweaver-nexus-mcp.vercel.app/mcp` — Streamable HTTP, public, no authentication.

The bare hostname serves a static signposting page (`public/index.html`). Only `/mcp` is routed to the function, so opening the endpoint itself in a browser returns `406 Not Acceptable` — that is correct content negotiation, not a fault.

[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-active-blue)](https://registry.modelcontextprotocol.io/?q=io.github.webweaver-nexus)

Published to the official MCP registry as `io.github.webweaver-nexus/webweaver-mcp-server`. See [Publishing to the MCP registry](#publishing-to-the-mcp-registry).

## Tools

| Tool | Type | Description |
|------|------|-------------|
| `get_contact_form` | MCP App (UI) | Renders the WebWeaver Nexus contact form natively inside the host |
| `get_product_overview` | Plain tool | Returns a description of what WebWeaver Nexus does |
| `get_contact_info` | Plain tool | Returns contact methods and links |
| `submit_contact_form` | App-only | Submits the form. Marked `_meta.ui.visibility: ["app"]`, so compliant hosts hide it from the model |

The form is rendered in the App's own document and makes **no external requests**. It submits through the MCP bridge (`app.callServerTool`) to `submit_contact_form`, which POSTs server-to-server to the landing page's `/api/contact` with a bearer secret. That shape is why it works where the previous Tally iframe did not — see [Known Limitations](#known-limitations).

## Prerequisites

- Node.js 24.x (see `engines` in `package.json`)
- npm

> `engines` pins 24.x deliberately: Vercel selects the function runtime from it. Newer local Node majors work fine but make npm print an `EBADENGINE` warning.

## Install

```bash
npm install
```

## Build

```bash
npm run build
```

This bundles the MCP App UI with Vite + `vite-plugin-singlefile`, type-checks the client and server, and emits the compiled server.

The Vite step runs **first** and is load-bearing: a build plugin writes the bundled HTML into `generated/mcp-app-html.ts`, which `server.ts` imports. The server type-check would fail without it. `generated/` is a build artifact and is git-ignored.

> During `npm run dev`, the watch build regenerates that module on every client change, but `npm run serve` loads it once at startup — restart the server to pick up UI edits.

## Run

```bash
# HTTP transport (default, port 3001)
npm run serve

# Custom port
PORT=4000 npm run serve

# stdio transport (for Claude Desktop local config)
npm run serve:stdio

# Dev mode (watch + serve)
npm run dev
```

The server listens at `http://localhost:3001/mcp` by default.

## Configuration

### Environment variables

Two, both for the contact API, both read **only** in `server.ts`. Copy `.env.example` to `.env` for local development.

| Variable | Purpose |
|---|---|
| `CONTACT_FORM_SHARED_SECRET` | Bearer token for the landing page's `/api/contact`. Must match that project's value. |
| `CONTACT_API_BASE_URL` | Where submissions go. Defaults to `https://webweaver-nexus.vercel.app`; a trailing slash is stripped. |

**The secret must never reach the client bundle.** `src/mcp-app.ts` is compiled into a single ~246 KB HTML string served to every user. After any build:

```bash
grep -c 'CONTACT_FORM_SHARED_SECRET' generated/mcp-app-html.ts   # must print 0
```

Going through `callServerTool` rather than fetching the API from the App is precisely what keeps the credential server-side.

**Point `CONTACT_API_BASE_URL` at a local landing page while developing.** Against production, every test submission writes a real row to the production Supabase table and sends two real emails. Vercel *preview* deployments of this server do point at production — use them sparingly and clean up the rows afterwards (they carry `source='mcp'`).

`npm run serve` loads `.env` from the working directory. The stdio entry point runs with `cwd=/` and cannot find it, so a stdio host config needs its own `env` block — see [Claude Desktop](#claude-desktop).

### The form contract

The landing page owns the form contract and publishes it at `GET /api/contact/schema`. This repo holds a generated, committed copy in `src/contact-contract.ts`:

```bash
npm run sync:contract    # regenerate from the endpoint
npm run check:contract   # fail if the copy has drifted
```

Never hand-edit that file. The 8 goal option strings are also the keys of `GOAL_PARAGRAPHS` in the landing page's welcome email, so a single byte of drift silently drops the personalised paragraph with no error anywhere. The copy is committed rather than fetched at build time so that `npm run build` works offline and on a fresh clone; `check:contract` is a release step, not a build step.

## Testing with MCP Inspector (default harness)

[MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) is the official MCP debugger and the right tool for almost every check here. Verified against **v2.5.0**.

```bash
npx @modelcontextprotocol/inspector
```

The web UI opens on port `6274`. Set:

- **Transport Type:** `Streamable HTTP`
- **Connection Type:** `Via Proxy` or `Direct` — both work. Proxy routes JSON-RPC through Inspector's local proxy (port `6277`); Direct goes browser → server.
- **URL:** `http://localhost:3001/mcp` (local) or `https://webweaver-nexus-mcp.vercel.app/mcp` (production)

Click **Connect**, then verify across tabs:

1. **Tools** — `get_contact_form`, `get_product_overview`, `get_contact_info` and `submit_contact_form` all appear. The last is marked app-only; Inspector lists it because **filtering by `visibility` is the host's job, not the server's**. The two plain tools return their text when called.
2. **Resources** — `ui://get-contact-form/mcp-app.html` lists; reading it returns ~246 KB of bundled HTML and carries `_meta.ui.prefersBorder` with **no `csp` key at all**.
3. **Apps** — select `get_contact_form`. The form renders with live, interactive controls and the network panel stays empty. Inspector strips `allow-same-origin`, so working controls here also prove the old Tally breakage was Tally's own storage access rather than a structural sandbox limit.

There is also a CLI, which makes post-deploy checks scriptable without a browser:

```bash
npx @modelcontextprotocol/inspector --cli --transport http \
  --server-url https://webweaver-nexus-mcp.vercel.app/mcp --method tools/list

# App metadata for a UI tool
npx @modelcontextprotocol/inspector --cli --transport http \
  --server-url https://webweaver-nexus-mcp.vercel.app/mcp \
  --method tools/call --tool-name get_contact_form --app-info
```

**The one thing Inspector cannot do:** accept `ui/update-model-context`. As of v2.5.0 it never registers an `onupdatemodelcontext` handler and never declares the capability, so `app.updateModelContext()` has nowhere to land. Use basic-host for that one check.

## Testing with basic-host (model context updates)

A vendored copy of the MCP Apps `basic-host` harness lives in [`tools/basic-host/`](tools/basic-host/). It is the only local host that declares the `updateModelContext` capability and renders a 📋 **Model Context** panel, which is how you confirm the form actually notifies the host model after submission.

```bash
# once
cd tools/basic-host && npm install && npm run build

# Terminal 1 — the server under test
npm run build && npm run serve

# Terminal 2 — the harness
cd tools/basic-host && SERVERS='["http://localhost:3001/mcp"]' npm run serve
# Open http://localhost:8080
```

Against production instead:

```bash
cd tools/basic-host && SERVERS='["https://webweaver-nexus-mcp.vercel.app/mcp"]' npm run serve
```

`SERVERS` is a **JSON array**, and ports 8080/8081 are effectively fixed — see [`tools/basic-host/README.md`](tools/basic-host/README.md) for provenance and the full set of caveats.

> The Model Context panel stays hidden until the first update arrives, which for `get_contact_form` means a **real submission** — it writes a row and fires notification emails. Point `CONTACT_API_BASE_URL` at a local landing page and use throwaway details.

## When to use which

| Need | Use |
|------|-----|
| "Is the server reachable? Do tools list?" | Inspector (`--cli` for scripts) |
| "Do the plain tools return the right text?" | Inspector |
| "Does the form render and are its controls live?" | Inspector |
| "Can a user actually complete and submit the form?" | basic-host, or Claude Desktop — both declare `serverTools` |
| "Does `app.updateModelContext()` reach the host?" | basic-host — Inspector cannot |
| "Does it work in the host customers actually use?" | Claude Desktop, via the local stdio config |
| Fastest post-deploy sanity check | Inspector `--cli` |

### Host support, as verified

Re-check per release; these are observations, not guarantees.

| Host | Form renders | Controls live | `serverTools` (submit) | Honours `visibility: ["app"]` |
|---|---|---|---|---|
| Claude Desktop | ✅ | ✅ | ✅ | ✅ |  *(re-verified on v2.1.0, 6 Oct 2026)*
| `tools/basic-host` | ✅ | ✅ | ✅ | n/a (shows all tools) |
| MCP Inspector | ✅ | ✅ | ✅ | ❌ lists it |
| claude.ai connector | ✅ | ✅ | ✅ | ✅ |

Claude Desktop and Inspector verified 5 October 2026 and re-verified on v2.1.0 on 6 October; claude.ai verified 6 October over a cloudflared tunnel. Inspector additionally cannot receive `ui/update-model-context`.

## Exposing local dev to claude.ai (Cloudflare tunnel)

For iterating on the server locally against claude.ai's custom connector UI (which only accepts public HTTPS URLs, not `localhost`), expose your dev server via a Cloudflare tunnel:

```bash
# Terminal 1 — run the server
npm run build && npm run serve

# Terminal 2 — start the tunnel
npx cloudflared tunnel --url http://localhost:3001
```

Copy the `https://*.trycloudflare.com` URL from the tunnel output. In Claude's settings, add a custom MCP connector pointing to `https://<tunnel-url>/mcp`.

`*.trycloudflare.com` is allowlisted by the Host header check in `api/mcp.ts` — cloudflared forwards the public hostname rather than `localhost`, so without that entry every tunnelled request is rejected with `403 Invalid Host`.

> **Note:** `get_contact_form` declares no CSP at all, so the `frameDomains` bug that blocked the previous Tally embed no longer applies. What to watch for instead is whether the host declares the `serverTools` capability — without it the App shows its "continue on the web" fallback rather than a submit button. See [Known Limitations](#known-limitations).

## Deployment (Vercel)

The MCP server is deployed as a Vercel serverless function using the Express + Streamable HTTP pattern.

**How it works:**
- `vercel.json` routes traffic to `api/mcp.ts`, which exports the Express app as `default`.
- The Vite-bundled MCP App UI is compiled into the function as a string constant (`generated/mcp-app-html.ts`), so no file is read from disk at runtime.
- The function runs on Vercel's Node.js 24 runtime with `maxDuration: 60` (well above what's needed; tool calls return in milliseconds).
- No environment variables are required — all configuration is hardcoded in the source.

**To redeploy:** Push to the `main` branch. Vercel auto-deploys on push.

**To verify the deployment:**

```bash
# Sanity check — should return a JSON-RPC tools list (~880 bytes)
curl -X POST https://webweaver-nexus-mcp.vercel.app/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# Resource read — should return ~246 KB of bundled HTML.
# A response under a few KB means the unbundled source HTML was inlined
# instead of the bundle (the build guards against this — see git history).
curl -X POST https://webweaver-nexus-mcp.vercel.app/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"resources/read","params":{"uri":"ui://get-contact-form/mcp-app.html"},"id":1}' \
  | wc -c
```

For an interactive equivalent, run MCP Inspector against the deployed URL (see [Testing with MCP Inspector](#testing-with-mcp-inspector-default-harness) above). Recommended as the first post-deploy check before bringing up basic-host.

## Publishing to the MCP registry

The registry entry is `io.github.webweaver-nexus/webweaver-mcp-server`, defined by `server.json`. Publishing is **manual dispatch only** — run the **Publish to MCP Registry** workflow from the Actions tab.

```bash
# validate locally before dispatching
mcp-publisher validate
```

**Why CI rather than publishing from your laptop.** `mcp-publisher login github` grants an org namespace only when GitHub reports you as an org **Owner** via `GET /user/memberships/orgs?state=active` — the registry requires `role == "admin"` (see `internal/api/handlers/v0/auth/github_at.go` upstream). That lookup returns nothing for this org even though the account *is* an Owner with public membership and the org's third-party policy is not the cause, so a personal login yields only `io.github.<user>/*` and the publish fails with 403.

GitHub Actions OIDC sidesteps it: the registry derives the namespace from the `repository_owner` claim, which is `webweaver-nexus` for this repo, granting `io.github.webweaver-nexus/*` directly. The workflow needs `id-token: write`.

Bump `version` in `server.json` before dispatching — the registry rejects a re-publish of an existing version.

## Install in your MCP client

All clients connect to the same endpoint:

```
https://webweaver-nexus-mcp.vercel.app/mcp
```

Transport is **Streamable HTTP**. No authentication; every registered tool is publicly callable, including `submit_contact_form` — see [`visibility` is a hint, not an access control](#visibility-app-is-a-hint-not-an-access-control).

Hosts that speak Streamable HTTP natively (claude.ai, ChatGPT, MCP Inspector, basic-host) take the URL directly. stdio-only hosts (Claude Desktop, Cursor today) use the `mcp-remote` npm shim — a small package that launches as a local stdio process and proxies JSON-RPC to the remote URL.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "webweaver-nexus": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://webweaver-nexus-mcp.vercel.app/mcp"]
    }
  }
}
```

Restart Claude Desktop; the three model-facing tools appear in the tools menu. `submit_contact_form` does **not** — Claude Desktop honours `visibility: ["app"]`.

To run this server as a **local stdio process** instead — which is how you test an unreleased change — point the config at the built entry point and carry the environment with it, because a stdio host launches the process with `cwd=/` and `.env` is never found:

```json
{
  "mcpServers": {
    "webweaver-nexus-local": {
      "command": "node",
      "args": ["/absolute/path/to/webweaver-mcp-server/dist/main.js", "--stdio"],
      "env": {
        "CONTACT_API_BASE_URL": "http://localhost:3000",
        "CONTACT_FORM_SHARED_SECRET": "local-dev-secret"
      }
    }
  }
}
```

> The `mcp-remote` config above proxies to the deployed server over HTTP, so it never exercised the stdio `cwd` bug fixed in v1.0.1 — that bug only applied to a local stdio config like this one.

### claude.ai (Custom Connector)

claude.ai speaks Streamable HTTP natively — no shim.

1. Open **Settings → Connectors** (or **Feature Preview → MCP**, depending on rollout).
2. **Add custom connector** → paste `https://webweaver-nexus-mcp.vercel.app/mcp`.
3. Save.

All three model-facing tools work. Whether `get_contact_form` can submit depends on claude.ai declaring the `serverTools` capability — see [Known Limitations](#known-limitations).

### Cursor

Edit `~/.cursor/mcp.json`, or use **Settings → MCP Servers** in the Cursor UI:

```json
{
  "mcpServers": {
    "webweaver-nexus": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://webweaver-nexus-mcp.vercel.app/mcp"]
    }
  }
}
```

Reload the Cursor window (`Cmd+Shift+P → Reload Window`).

### ChatGPT

Available on plan tiers that support MCP / custom connectors.

1. **Settings → Connectors** (or **Apps**) → **Add custom MCP server**.
2. Paste `https://webweaver-nexus-mcp.vercel.app/mcp`.
3. Enable for a conversation.

### Verifying the connection (any client)

Ask the host something like:

> Use the WebWeaver Nexus connector to get the product overview.

If the tool fires and returns text, the wire is good. For `get_contact_form`, the form renders directly in the conversation on hosts that have shipped MCP Apps rendering — see the per-client caveats above.

## Known Limitations

### ~~Claude Desktop stdio integration~~ — fixed in v1.0.1

**Previously:** `join_waitlist` (now `get_contact_form`) failed under Claude Desktop with `ENOENT: no such file or directory, open '/dist/mcp-app.html'`. Claude Desktop launches MCP server processes with the working directory set to `/` on macOS, and `server.ts` located the bundled HTML via `path.join(process.cwd(), "dist", "mcp-app.html")`. The `cwd` field in `claude_desktop_config.json` was tried as a workaround but is silently ignored on the version tested.

**Fix:** the Vite build now writes the bundled HTML into `generated/mcp-app-html.ts`, which `server.ts` imports as a string constant. Nothing resolves a filesystem path at runtime, so the App resource behaves identically under stdio, local HTTP, and Vercel. Verified by running the server from `/` and reading the resource over stdio.

Two earlier attempts are preserved in the history for context: a path probe (added in `e73484f`, reverted in `32dc1aa`) that resolved to an unbundled source file on Vercel, and a Vite 8 → 7 downgrade (`2e33c8e`, reverted in `c8ad36d`) that chased the wrong cause. The build now fails loudly if the unbundled source HTML is ever inlined by mistake.

### MCP Inspector strips `allow-same-origin` — no longer breaks the form

Inspector's sandbox proxy says so in its own source: the App iframe is sandboxed *without* `allow-same-origin`, which is "always stripped from a server-supplied value". The App therefore runs on an opaque (`null`) origin.

This used to kill the form. The old Tally iframe inherited the opaque origin (sandbox flags are inherited by nested frames), its JS could not reach same-origin storage, and its dropdown and checkboxes went dead while plain text inputs kept working. Confirmed at the time by an A/B test on the flag alone.

**The native form is unaffected**, because native controls need no storage. One constraint survives and must be respected: under an opaque origin `localStorage`, `sessionStorage` and `document.cookie` all throw `SecurityError`, which is why `RENDERED_AT` in `src/mcp-app.ts` is a module-scope constant and must stay one.

**Do not "fix" the sandbox with `_meta.ui.domain`.** Inspector does grant `allow-same-origin` to Apps declaring that field, but the spec is explicit that its format is *host-dependent* (`{hash}.claudemcpcontent.com`, `www-example-com.oaiusercontent.com`). The value is assigned by each host, so guessing one satisfies Inspector at the risk of breaking others. Nothing here needs it.

### ~~Hosts that ignore `frameDomains`~~ — resolved in v2.0.0 by removing the dependency

**Affected claude.ai custom connectors and Claude Desktop.** Both rendered the App shell correctly but left the embedded Tally form as blank space: the host ignores `frameDomains` declared in `_meta.ui.csp`, so the nested `tally.so` iframe was blocked. Upstream issue [`anthropics/claude-ai-mcp#40`](https://github.com/anthropics/claude-ai-mcp/issues/40), still open.

**Why it no longer applies.** The form is now rendered natively in the App's own document and declares no `csp` at all. A policy we do not depend on cannot be ignored. Kept here because it constrains future work: **never put a third-party iframe in an MCP App** — iframing a form of our own would hit the identical bug, since the nested-frame shape is the problem rather than Tally specifically.

Claude Desktop is the same stack — its `initialize` sends `clientInfo.name: "claude-ai (via mcp-remote …)"` — so it inherits the same bug. It does advertise MCP Apps support (`extensions["io.modelcontextprotocol/ui"]` with `text/html;profile=mcp-app`), and the MCP log shows `resources/read` and `tools/call` both returning normally, which is why this presents as a rendering failure rather than a protocol one.

**Confirmed from Claude Desktop's DevTools console:**

```
Framing 'https://tally.so/' violates the following Content Security Policy
directive: "frame-src 'self' blob: data:". The request has been blocked.
```

Only `frameDomains` is dropped — the other two declarations survive. The App frame is loaded with them in its query string:

```
mcp_apps?connect-src=https%3A%2F%2Ftally.so&resource-src=https%3A%2F%2Ftally.so+https%3A%2F%2Fassets.claude.ai
```

There was no `frame-src` parameter, so the policy fell back to `frame-src 'self' blob: data:`. Tally's loader did run and the App requested the correct embed URL — the host blocked the frame, nothing upstream of it. Identical on both transports, `mcp-remote` over HTTP and a local stdio config, as expected for a renderer-side block.

**Confirmed fixed in Claude Desktop, 5 October 2026.** The same App frame URL now reads:

```
mcp_apps?stable-origin=true&resource-src=https%3A%2F%2Fassets.claude.ai&dev=true
```

`tally.so` is gone from `resource-src` and there is no `connect-src` parameter at all, because the App asks for neither. The DevTools console showed **no CSP violations** across the whole session — the only policy line was Claude Desktop's own `Unrecognized Content-Security-Policy directive 'webrtc'`. The form rendered with live controls and a submission reached Supabase with `source='mcp'`.

Note the new `stable-origin=true` parameter: Claude Desktop now assigns App frames a stable origin, which is the mechanism behind `_meta.ui.domain`. If that comes with `allow-same-origin`, browser storage may eventually be usable in Apps on this host. Don't rely on it — MCP Inspector still strips the flag, so the opaque-origin rules below still bind.

### `GET` and `DELETE` on `/mcp` return `405`

Since v2.1.0 this endpoint serves both the 2025 protocol era and revision
**2026-07-28** from one URL, via `createMcpHandler`. Legacy traffic is served
statelessly — a fresh server instance per request — which means there is no
session for 2025's session operations to act on, so `GET` and `DELETE` are
answered `405 Method not allowed`. They previously returned `200`.

This is the SDK's documented stateless idiom rather than a fault. Verified not
to affect a real v1.30.0 SDK client, `tools/basic-host`, **Claude Desktop**
**or claude.ai** — none needs that stream for request/response work. In both
Claude hosts the form rendered, submitted and reached Supabase, with no `405`
appearing anywhere in either console. `POST` is unchanged.

Clients default to the 2025 handshake **with no probe**, so nothing has to
change on their side. A client opting in with
`versionNegotiation: { mode: 'auto' }` negotiates 2026-07-28 instead; both get
the same tools from the same URL.

### Hosts without the `serverTools` capability

`app.callServerTool()` requires the host to declare `serverTools`; without it the App cannot submit. **Claude Desktop declares it** — verified 5 October 2026, a submission went through end to end. So does `tools/basic-host`. It remains unverified on claude.ai and other hosts, and a host may withdraw it, so the guard stays.

`src/mcp-app.ts` probes the capability **on load, not on submit**, and when it is absent replaces the form with a "continue on the web" affordance that opens `/#contact` via `app.openLink()` (itself gated on `openLinks`; without that too, the URL is shown as selectable text). The ordering is deliberate: a form whose submit button silently does nothing is worse than no form, because it looks like it worked.

Because the capability is present on the hosts tested, **the fallback is insurance that has not been exercised in a real host.** It has only been confirmed by stubbing the capability locally. Re-check it if you touch that path.

### `visibility: ["app"]` is a hint, not an access control

`submit_contact_form` declares `_meta.ui.visibility: ["app"]`, and **Claude Desktop honours it**: asked to list its tools, the model named only `get_contact_form`, `get_contact_info` and `get_product_overview`, having just called the submit tool from inside the App (verified 5 October 2026).

That is host courtesy, not enforcement. **`tools/list` returns the tool to every client** — the server does no filtering, and the spec puts it on the host. A host that ignores the flag exposes the tool to its model. That is tolerable rather than dangerous: `consentPrivacy` must be literal `true`, and the landing page records every submission on this path as `source='mcp'`, so anything synthesised is identifiable. Don't treat the flag as a security boundary.


## Project Structure

├── api/
│   └── mcp.ts           # Vercel serverless entry — exports Express app
├── public/
│   └── index.html       # Static landing page served at / (not part of the MCP server)
├── main.ts              # Local-dev entry — HTTP & stdio transports
├── server.ts            # Tool & resource registration (shared)
├── mcp-app.html         # App UI template (Vite entry, source)
├── src/
│   ├── mcp-app.ts       # Client-side App lifecycle + native contact form
│   ├── contact-contract.ts # GENERATED — form contract vendored from the landing page
│   ├── submit-outcome.ts   # Result type shared by server.ts and the App
│   ├── mcp-app.css      # App-specific styles
│   └── global.css       # Host variable fallbacks & reset
├── scripts/
│   └── contract.ts      # sync / check the vendored contract
├── tools/
│   └── basic-host/      # Vendored MCP host harness (model context updates)
├── generated/           # Build artifact — bundled HTML as a TS constant (git-ignored)
├── dist/                # Build output — function code + bundled mcp-app.html
├── vite.config.ts       # Vite + singlefile plugin config
├── tsconfig.json        # Client + shared type-checking
├── tsconfig.server.json # Server declaration emit
├── tsconfig.scripts.json # Type-checks scripts/ (noEmit)
├── .env.example         # CONTACT_API_BASE_URL, CONTACT_FORM_SHARED_SECRET
├── vercel.json          # Vercel deployment config
└── package.json

## Version History

- **v2.1.0** — Migrated off the monolithic `@modelcontextprotocol/sdk` to the v2 split packages (`server` / `node` / `express` / `client` / `core`, all exact-pinned) and `ext-apps` 1.7.5 → 2.0.3. The endpoint now serves protocol revision **2026-07-28 alongside the 2025 era** from one URL via `createMcpHandler`; clients default to the 2025 handshake with no probe, so nothing has to change on their side. `GET` and `DELETE` on `/mcp` now return `405` — see [Known Limitations](#known-limitations). The bundled App shrank 447 KB → 246 KB purely from the leaner ext-apps. `tools/basic-host` is deliberately left on SDK v1 as a cross-version compatibility test, which passes. No tool, schema or behaviour change.
- **v2.0.0** — **Breaking:** `join_waitlist` is renamed `get_contact_form` and its resource URI is now `ui://get-contact-form/mcp-app.html`; there is no alias, so a cached client errors until it re-lists. The Tally iframe is replaced by a form rendered natively in the App, which makes zero external requests and therefore declares no `_meta.ui.csp` — the structural fix for hosts that ignore `frameDomains`. Submission goes through a new app-only `submit_contact_form` tool (`_meta.ui.visibility: ["app"]`) which POSTs server-to-server to the landing page's `/api/contact`, so the shared secret never enters the client bundle. Adds the repo's first two env vars and a vendored form contract with `npm run check:contract`. Also removes a `postMessage` listener that had no origin check and trusted any frame claiming to be a Tally submission.
- **v1.0.2** — Fixed `join_waitlist` rendering an empty panel in every host: the app loaded Tally's `embed.js` but never called `Tally.loadEmbeds()`, so the form iframe was never given a `src`. Also guards `updateModelContext` behind the host capability, and vendors the basic-host harness into `tools/basic-host/` so the `ext-apps` clone is no longer needed.
- **v1.0.1** — `join_waitlist` now works over stdio (Claude Desktop). The App HTML is compiled into the server instead of read from disk, removing the `process.cwd()` dependency. Rate limiting is now per-client: `trust proxy` was unset, so every caller shared a single 60/min bucket behind Vercel's proxy. Host validation now accepts Vercel preview deployments and `*.trycloudflare.com`, which the documented tunnel workflow needs. Dependencies updated to clear all `npm audit` advisories (MCP SDK 1.29 → 1.30).
- **v1.0.0** — Published to the official MCP registry as `io.github.webweaver-nexus/webweaver-mcp-server`. Endpoint hardened with a CORS allowlist and rate limiting.
- **v0.1.0** — First working production deployment. Three tools live; `join_waitlist` works on Streamable HTTP hosts. Claude Desktop stdio integration deferred.