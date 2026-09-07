# basic-host (vendored)

A minimal MCP **host** used to test this repo's MCP App. It connects to an MCP server over
Streamable HTTP, lists its tools, calls one, and renders the tool's linked `ui://` resource
inside a double-iframe sandbox with a real CSP.

## Why it is here

MCP Inspector covers almost everything we need — tools, resources, the Apps tab, and it builds a
real Content-Security-Policy from our `_meta.ui.csp` declarations. The one thing it does **not**
do (as of v2.5.0) is accept `ui/update-model-context`: it never registers an
`onupdatemodelcontext` handler and never declares the capability, so `app.updateModelContext()`
has nowhere to land.

This harness does both — it declares `updateModelContext: { text: {} }`
(`src/implementation.ts`), wires the handler, and renders a 📋 **Model Context** panel. That
panel is the only local way to confirm the waitlist form actually notifies the host model after a
Tally submission.

Use Inspector for everyday checks. Use this when you specifically need to see a model-context
update land.

## Provenance

Vendored from [`modelcontextprotocol/ext-apps`](https://github.com/modelcontextprotocol/ext-apps),
`examples/basic-host`, at `v1.7.0-2-g9e638a0` — upstream base commit `64b4fa1`
("chore: bump ext-apps to 1.7.0 (#628)", 2026-04-21). The two commits on top of that base were
local and only deleted unrelated examples.

Upstream is MIT-licensed; `LICENSE` here is the upstream licence file, retained as required. The
rest of this repository is Apache-2.0.

This is a **pinned snapshot** and will drift from the `@modelcontextprotocol/ext-apps` SDK version
the server builds against. If the App handshake starts failing in a way Inspector does not
reproduce, suspect the drift and re-vendor from upstream.

Two local changes to the upstream copy:

- `package.json` — marked `private`, and `serve` now runs `npx tsx serve.ts` instead of
  `bun --watch serve.ts` (bun is not a dependency of this project; `serve.ts` already carries a
  `#!/usr/bin/env npx tsx` shebang).
- `tsx` added to `devDependencies` for the same reason.

## Running it

```bash
# once
npm install

# terminal 1 — the MCP server under test
cd ../.. && npm run build && npm run serve      # http://localhost:3001/mcp

# terminal 2 — this harness
SERVERS='["http://localhost:3001/mcp"]' npm run serve
```

Then open **http://localhost:8080** and pick `join_waitlist`.

`dist/` is committed and prebuilt, so no build step is needed to run it. `npm run build` rebuilds
it (React + Vite) if you ever edit `src/`.

### Things that will trip you up

- **`SERVERS` is a JSON array**, not a bare URL: `SERVERS='["http://localhost:3001/mcp"]'`.
  It defaults to `["http://localhost:3001/mcp"]`, which is already this server's dev port.
- **Ports 8080 and 8081 are effectively fixed.** The sandbox origin is hardcoded as
  `SANDBOX_PROXY_BASE_URL` in `src/implementation.ts` and baked into the prebuilt bundle, so
  setting `SANDBOX_PORT` alone breaks the sandbox. Both ports must be free.
- **The Model Context panel is hidden until the first non-empty update arrives.** For
  `join_waitlist` that means it appears only after a real Tally form submission — which creates a
  real waitlist entry and fires notification emails.
- **Only the latest update is shown** (it replaces, it does not append), and the panel is hidden
  entirely while the App is in fullscreen display mode.

## Pointing it at production

```bash
SERVERS='["https://webweaver-nexus-mcp.vercel.app/mcp"]' npm run serve
```

This exercises the full deployment — CSP propagation, sandbox iframe loading, the Tally embed, and
the submit event flow.
