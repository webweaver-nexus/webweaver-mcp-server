# WebWeaver Nexus MCP Server

An MCP server that exposes WebWeaver Nexus tools to MCP-enabled hosts (Claude Desktop, claude.ai, basic-host, etc.).

**Production URL:** `https://webweaver-nexus-mcp.vercel.app/mcp`

## Tools

| Tool | Type | Description |
|------|------|-------------|
| `join_waitlist` | MCP App (UI) | Embeds the Tally waitlist form inside the host |
| `get_product_overview` | Plain tool | Returns a description of what WebWeaver Nexus does |
| `get_contact_info` | Plain tool | Returns contact methods and links |

## Prerequisites

- Node.js 20+
- npm

## Install

```bash
npm install
```

## Build

```bash
npm run build
```

This runs TypeScript type-checking, bundles the MCP App UI with Vite + `vite-plugin-singlefile`, and emits server type declarations.

## Run

```bash
# HTTP transport (default, port 3001)
npm run serve

# Custom port
PORT=4000 npm run serve

# stdio transport (for Claude Desktop local config — see "Known Limitations")
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

## Testing with basic-host (local)

```bash
# Terminal 1 — run your server
npm run build && npm run serve

# Terminal 2 — clone and run the MCP Apps basic-host
git clone --depth 1 https://github.com/modelcontextprotocol/ext-apps.git /tmp/mcp-ext-apps
cd /tmp/mcp-ext-apps/examples/basic-host
npm install
SERVERS='["http://localhost:3001/mcp"]' npm run start
# Open http://localhost:8080
```

## Testing with basic-host (against production)

To run the same harness against the deployed server instead of localhost:

```bash
SERVERS='["https://webweaver-nexus-mcp.vercel.app/mcp"]' npx tsx serve.ts
```

This is the most reliable end-to-end test — it exercises the full Vercel deployment, CSP propagation, sandbox iframe loading, Tally embed, and submit event flow.

## Testing with Claude Desktop (Custom Connector)

To test with claude.ai using a local server, expose it via a Cloudflare tunnel:

```bash
# Terminal 1 — run the server
npm run build && npm run serve

# Terminal 2 — start the tunnel
npx cloudflared tunnel --url http://localhost:3001
```

Copy the `https://*.trycloudflare.com` URL from the tunnel output. In Claude's settings, add a custom MCP connector pointing to `https://<tunnel-url>/mcp`.

> **Note:** As of writing, claude.ai's custom connectors ignore `frameDomains` declared in `_meta.ui.csp` (see [GitHub issue `anthropics/claude-ai-mcp#40`](https://github.com/anthropics/claude-ai-mcp/issues/40)). This will cause the Tally embed in `join_waitlist` to be blocked. The two read-only tools work correctly. Track that issue for the fix.

## Deployment (Vercel)

The MCP server is deployed as a Vercel serverless function using the Express + Streamable HTTP pattern.

**How it works:**
- `vercel.json` routes traffic to `api/mcp.ts`, which exports the Express app as `default`.
- The Vite-bundled `dist/mcp-app.html` (the MCP App UI) is included in the deployment via `includeFiles` and read at runtime by `server.ts` via `fs.readFile`.
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

# Resource read — should return ~330 KB of bundled HTML.
# A response under a few KB means the unbundled source HTML is being served
# instead of the bundled artifact (path resolution bug — see git history).
curl -X POST https://webweaver-nexus-mcp.vercel.app/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"resources/read","params":{"uri":"ui://join-waitlist/mcp-app.html"},"id":1}' \
  | wc -c
```

## Known Limitations

### Claude Desktop stdio integration is not currently supported

The two read-only tools (`get_product_overview`, `get_contact_info`) work in Claude Desktop. `join_waitlist` does not.

**Cause:** Claude Desktop launches MCP server processes with the working directory set to `/` (the filesystem root) on macOS. The current `server.ts` uses `path.join(process.cwd(), "dist", "mcp-app.html")` to locate the bundled HTML at runtime, which resolves to `/dist/mcp-app.html` under Claude Desktop — a path that doesn't exist. The `cwd` field in `claude_desktop_config.json` was tried as a workaround but is silently ignored on the version tested.

**Workaround:** Use a Streamable HTTP MCP host (basic-host, claude.ai's custom connectors when MCP App rendering bugs are fixed, or other spec-compliant clients) rather than Claude Desktop's local stdio mode.

**Possible fixes for future work:**

1. **Embed the HTML as a build-time string constant.** Replace the runtime `fs.readFile` with an `import` (or build step) that inlines `dist/mcp-app.html` directly into the compiled JS as a string. Eliminates filesystem path resolution entirely; works identically across every host environment. Cost: small build-step change; HTML changes require a rebuild (which they already do anyway).

2. **A more robust path probe** that tries `dist/`-prefixed paths first and never falls through to anywhere a same-named source file might live. The probe approach was attempted in commit e73484f and reverted in commit 32dc1aa. A Vite 8 → 7 downgrade was also tried in commit 2e33c8e (suspecting vite-plugin-singlefile incompatibility) and reverted in commit c8ad36d once we determined the actual cause was the path probe finding an unbundled source file on Vercel. See the git history around 28 April 2026 for the full diagnostic trail.

The first option is recommended if you come back to this.

### claude.ai `frameDomains` bug

See note in the "Testing with Claude Desktop (Custom Connector)" section above.


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
├── dist/                # Build output — function code + bundled mcp-app.html
├── vite.config.ts       # Vite + singlefile plugin config
├── tsconfig.json        # Client + shared type-checking
├── tsconfig.server.json # Server declaration emit
├── vercel.json          # Vercel deployment config
└── package.json

## Version History

- **v0.1.0** — First working production deployment. Three tools live; `join_waitlist` works on Streamable HTTP hosts. Claude Desktop stdio integration deferred (see Known Limitations).