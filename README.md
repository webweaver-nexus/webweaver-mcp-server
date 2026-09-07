# WebWeaver Nexus MCP Server

An MCP server that exposes WebWeaver Nexus services — waitlist signup (with an embedded form UI), product overview, and contact info — to MCP-enabled hosts (Claude Desktop, claude.ai, ChatGPT, Cursor, MCP Inspector, basic-host).

**Production URL:** `https://webweaver-nexus-mcp.vercel.app/mcp` — Streamable HTTP, public, no authentication.

[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-active-blue)](https://registry.modelcontextprotocol.io/?q=io.github.webweaver-nexus)

Published to the official MCP registry as `io.github.webweaver-nexus/webweaver-mcp-server` (live entry: v1.0.0).

## Tools

| Tool | Type | Description |
|------|------|-------------|
| `join_waitlist` | MCP App (UI) | Embeds the Tally waitlist form inside the host |
| `get_product_overview` | Plain tool | Returns a description of what WebWeaver Nexus does |
| `get_contact_info` | Plain tool | Returns contact methods and links |

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

Before deploying, update the Tally form ID:

1. Open `src/mcp-app.ts`
2. Replace the form ID constant with your real Tally form ID
3. Also update the `data-tally-src` URL in `mcp-app.html` to match

Tally's `embed.js` does **not** populate embeds by itself — `src/mcp-app.ts` has to call `window.Tally.loadEmbeds()` once the script loads, or the iframe keeps its `data-tally-src`, never gets a `src`, and the form silently renders as blank space.

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

1. **Tools** — all 3 tools appear (`join_waitlist`, `get_product_overview`, `get_contact_info`); the two plain tools return their text when called.
2. **Resources** — `ui://join-waitlist/mcp-app.html` lists; reading it returns ~435 KB of bundled HTML.
3. **Apps** — select `join_waitlist`; the Tally form renders inside its sandboxed iframe. Inspector builds a real CSP from our `_meta.ui.csp`, so this genuinely exercises `resourceDomains` / `frameDomains` / `connectDomains`.

There is also a CLI, which makes post-deploy checks scriptable without a browser:

```bash
npx @modelcontextprotocol/inspector --cli --transport http \
  --server-url https://webweaver-nexus-mcp.vercel.app/mcp --method tools/list

# App metadata for a UI tool
npx @modelcontextprotocol/inspector --cli --transport http \
  --server-url https://webweaver-nexus-mcp.vercel.app/mcp \
  --method tools/call --tool-name join_waitlist --app-info
```

**The one thing Inspector cannot do:** accept `ui/update-model-context`. As of v2.5.0 it never registers an `onupdatemodelcontext` handler and never declares the capability, so `app.updateModelContext()` has nowhere to land. Use basic-host for that one check.

## Testing with basic-host (model context updates)

A vendored copy of the MCP Apps `basic-host` harness lives in [`tools/basic-host/`](tools/basic-host/). It is the only local host that declares the `updateModelContext` capability and renders a 📋 **Model Context** panel, which is how you confirm the waitlist form actually notifies the host model after submission.

```bash
# once
cd tools/basic-host && npm install

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

> The Model Context panel stays hidden until the first update arrives, which for `join_waitlist` means a **real Tally submission** — it creates a live waitlist entry and fires notification emails. Use a throwaway entry.

## When to use which

| Need | Use |
|------|-----|
| "Is the server reachable? Do tools list?" | Inspector (`--cli` for scripts) |
| "Do the plain tools return the right text?" | Inspector |
| "Does the Tally form render inside the CSP sandbox?" | Inspector |
| "Does `app.updateModelContext()` reach the host?" | basic-host — Inspector cannot |
| Fastest post-deploy sanity check | Inspector `--cli` |

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

> **Note:** As of writing, claude.ai's custom connectors ignore `frameDomains` declared in `_meta.ui.csp` (see [GitHub issue `anthropics/claude-ai-mcp#40`](https://github.com/anthropics/claude-ai-mcp/issues/40)). This will cause the Tally embed in `join_waitlist` to be blocked. The two read-only tools work correctly. Track that issue for the fix.

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

# Resource read — should return ~435 KB of bundled HTML.
# A response under a few KB means the unbundled source HTML was inlined
# instead of the bundle (the build guards against this — see git history).
curl -X POST https://webweaver-nexus-mcp.vercel.app/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"resources/read","params":{"uri":"ui://join-waitlist/mcp-app.html"},"id":1}' \
  | wc -c
```

For an interactive equivalent, run MCP Inspector against the deployed URL (see [Testing with MCP Inspector](#testing-with-mcp-inspector-quick-smoke-test) above). Recommended as the first post-deploy check before bringing up basic-host.

## Install in your MCP client

All clients connect to the same endpoint:

```
https://webweaver-nexus-mcp.vercel.app/mcp
```

Transport is **Streamable HTTP**. No authentication; all three tools are publicly callable.

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

Restart Claude Desktop; the three tools appear in the tools menu.

> All three tools work in Claude Desktop. The `join_waitlist` stdio failure described in earlier revisions was fixed by compiling the App HTML into the server; see [Version History](#version-history).

### claude.ai (Custom Connector)

claude.ai speaks Streamable HTTP natively — no shim.

1. Open **Settings → Connectors** (or **Feature Preview → MCP**, depending on rollout).
2. **Add custom connector** → paste `https://webweaver-nexus-mcp.vercel.app/mcp`.
3. Save.

The two read-only tools work. `join_waitlist`'s Tally form is blocked by an upstream `frameDomains` bug — see [Known Limitations](#known-limitations).

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

If the tool fires and returns text, the wire is good. For `join_waitlist`, the embedded Tally form renders directly in the conversation on hosts that have shipped MCP Apps rendering (Inspector Apps tab, basic-host) — see the per-client caveats above for the others.

## Known Limitations

### ~~Claude Desktop stdio integration~~ — fixed in v1.0.1

**Previously:** `join_waitlist` failed under Claude Desktop with `ENOENT: no such file or directory, open '/dist/mcp-app.html'`. Claude Desktop launches MCP server processes with the working directory set to `/` on macOS, and `server.ts` located the bundled HTML via `path.join(process.cwd(), "dist", "mcp-app.html")`. The `cwd` field in `claude_desktop_config.json` was tried as a workaround but is silently ignored on the version tested.

**Fix:** the Vite build now writes the bundled HTML into `generated/mcp-app-html.ts`, which `server.ts` imports as a string constant. Nothing resolves a filesystem path at runtime, so the App resource behaves identically under stdio, local HTTP, and Vercel. Verified by running the server from `/` and reading the resource over stdio.

Two earlier attempts are preserved in the history for context: a path probe (added in `e73484f`, reverted in `32dc1aa`) that resolved to an unbundled source file on Vercel, and a Vite 8 → 7 downgrade (`2e33c8e`, reverted in `c8ad36d`) that chased the wrong cause. The build now fails loudly if the unbundled source HTML is ever inlined by mistake.

### claude.ai `frameDomains` bug

See the note under [Exposing local dev to claude.ai](#exposing-local-dev-to-claudeai-cloudflare-tunnel).


## Project Structure

├── api/
│   └── mcp.ts           # Vercel serverless entry — exports Express app
├── main.ts              # Local-dev entry — HTTP & stdio transports
├── server.ts            # Tool & resource registration (shared)
├── mcp-app.html         # App UI template (Vite entry, source)
├── src/
│   ├── mcp-app.ts       # Client-side App lifecycle + Tally integration
│   ├── mcp-app.css      # App-specific styles
│   └── global.css       # Host variable fallbacks & reset
├── tools/
│   └── basic-host/      # Vendored MCP host harness (model context updates)
├── generated/           # Build artifact — bundled HTML as a TS constant (git-ignored)
├── dist/                # Build output — function code + bundled mcp-app.html
├── vite.config.ts       # Vite + singlefile plugin config
├── tsconfig.json        # Client + shared type-checking
├── tsconfig.server.json # Server declaration emit
├── vercel.json          # Vercel deployment config
└── package.json

## Version History

- **v1.0.2** — Fixed `join_waitlist` rendering an empty panel in every host: the app loaded Tally's `embed.js` but never called `Tally.loadEmbeds()`, so the form iframe was never given a `src`. Also guards `updateModelContext` behind the host capability, and vendors the basic-host harness into `tools/basic-host/` so the `ext-apps` clone is no longer needed.
- **v1.0.1** — `join_waitlist` now works over stdio (Claude Desktop). The App HTML is compiled into the server instead of read from disk, removing the `process.cwd()` dependency. Rate limiting is now per-client: `trust proxy` was unset, so every caller shared a single 60/min bucket behind Vercel's proxy. Host validation now accepts Vercel preview deployments and `*.trycloudflare.com`, which the documented tunnel workflow needs. Dependencies updated to clear all `npm audit` advisories (MCP SDK 1.29 → 1.30).
- **v1.0.0** — Published to the official MCP registry as `io.github.webweaver-nexus/webweaver-mcp-server`. Endpoint hardened with a CORS allowlist and rate limiting.
- **v0.1.0** — First working production deployment. Three tools live; `join_waitlist` works on Streamable HTTP hosts. Claude Desktop stdio integration deferred.