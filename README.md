# WebWeaver Nexus MCP Server

An MCP server that exposes WebWeaver Nexus tools to MCP-enabled hosts (Claude Desktop, claude.ai, etc.).

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

# stdio transport (for Claude Desktop local config)
npm run serve:stdio

# Dev mode (watch + serve)
npm run dev
```

The server listens at `http://localhost:3001/mcp` by default.

## Configuration

Before deploying, update the Tally form ID:

1. Open `src/mcp-app.ts`
2. Replace `YOUR_FORM_ID_HERE` with your real Tally form ID
3. Also update the `data-tally-src` URL in `mcp-app.html` to match

## Testing with Claude Desktop (Custom Connector)

To test with claude.ai using a local server, expose it via a Cloudflare tunnel:

```bash
# Terminal 1 — run the server
npm run build && npm run serve

# Terminal 2 — start the tunnel
npx cloudflared tunnel --url http://localhost:3001
```

Copy the `https://*.trycloudflare.com` URL from the tunnel output. In Claude's settings, add a custom MCP connector pointing to `https://<tunnel-url>/mcp`.

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

## Project Structure

```
├── main.ts              # Entry point — HTTP & stdio transports
├── server.ts            # Tool & resource registration
├── mcp-app.html         # App UI template (Vite entry)
├── src/
│   ├── mcp-app.ts       # Client-side App lifecycle + Tally integration
│   ├── mcp-app.css      # App-specific styles
│   └── global.css       # Host variable fallbacks & reset
├── vite.config.ts       # Vite + singlefile plugin config
├── tsconfig.json        # Client + shared type-checking
├── tsconfig.server.json # Server declaration emit
└── package.json
```
