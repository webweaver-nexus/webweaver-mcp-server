/**
 * Integration tests: drive the real server (server.ts) over an in-memory MCP
 * transport and check the form-token guard end to end.
 *
 * The property that matters is "a bad token writes nothing". `fetch` — the
 * server's only outbound call, to the landing page's /api/contact — is stubbed,
 * and each rejection test asserts it was never called.
 *
 * Needs `npm run build` first: server.ts imports the generated App HTML.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";

import { issueFormToken } from "../form-token.ts";
import { createServer } from "../server.ts";
import { PRIMARY_GOAL_OPTIONS } from "../src/contact-contract.ts";
import { FORM_TOKEN_META_KEY } from "../src/submit-outcome.ts";

const TOKEN_SECRET = "s".repeat(64);
const ENV_KEYS = [
  "MCP_FORM_TOKEN_SECRET",
  "CONTACT_FORM_SHARED_SECRET",
  "CONTACT_API_BASE_URL",
] as const;

const realFetch = globalThis.fetch;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};
let fetchCalls: string[] = [];

function validSubmission(formToken?: string) {
  return {
    fullName: "Guard Test",
    email: "guard-test@example.com",
    primaryGoal: PRIMARY_GOAL_OPTIONS[0].value,
    consentPrivacy: true,
    renderedAt: Date.now(),
    ...(formToken === undefined ? {} : { formToken }),
  };
}

async function connect(): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer().connect(serverSide);
  const client = new Client({ name: "guard-test", version: "1.0.0" });
  await client.connect(clientSide);
  return client;
}

function outcome(result: unknown) {
  return (result as { structuredContent?: { ok: boolean; kind?: string; message?: string } })
    .structuredContent;
}

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env.MCP_FORM_TOKEN_SECRET = TOKEN_SECRET;
  process.env.CONTACT_FORM_SHARED_SECRET = "test-shared-secret";
  process.env.CONTACT_API_BASE_URL = "http://contact-api.invalid";

  fetchCalls = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    fetchCalls.push(String(input));
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("tool declarations (Change 1 and Change 2)", () => {
  it("advertises a title and accurate annotations on every tool", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

    for (const name of ["get_product_overview", "get_contact_info"]) {
      assert.ok(byName[name].title, `${name} has a title`);
      assert.deepEqual(byName[name].annotations, {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
    assert.ok(byName.get_contact_form.title);
    assert.deepEqual(byName.get_contact_form.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
    assert.ok(byName.submit_contact_form.title);
    assert.deepEqual(byName.submit_contact_form.annotations, {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
  });

  it("declares submit_contact_form app-only, at exactly _meta.ui.visibility", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const submit = tools.find((t) => t.name === "submit_contact_form");
    assert.deepEqual(submit?._meta, { ui: { visibility: ["app"] } });
  });
});

describe("token delivery", () => {
  it("puts the token in _meta only — never in content or structuredContent", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "get_contact_form", arguments: {} });

    const token = (result._meta as Record<string, unknown> | undefined)?.[FORM_TOKEN_META_KEY];
    assert.equal(typeof token, "string");
    assert.ok(!JSON.stringify(result.content).includes(token as string), "not in content");
    assert.equal(result.structuredContent, undefined, "no structuredContent at all");
  });

  it("issues no token, but still returns the form, when the secret is missing", async () => {
    delete process.env.MCP_FORM_TOKEN_SECRET;
    const client = await connect();
    const result = await client.callTool({ name: "get_contact_form", arguments: {} });
    assert.equal(result._meta, undefined);
    assert.ok(Array.isArray(result.content) && result.content.length > 0);
  });
});

describe("submit guard — a bad token writes nothing", () => {
  it("rejects a submission with no token", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "submit_contact_form",
      arguments: validSubmission(),
    });
    assert.equal(outcome(result)?.kind, "form_token");
    assert.equal(
      outcome(result)?.message,
      "This form has expired. Please ask for the contact form again.",
    );
    assert.deepEqual(fetchCalls, [], "nothing was sent to the contact API");
  });

  it("rejects an expired token", async () => {
    const client = await connect();
    const stale = issueFormToken(TOKEN_SECRET, Date.now() - 31 * 60 * 1000);
    const result = await client.callTool({
      name: "submit_contact_form",
      arguments: validSubmission(stale),
    });
    assert.equal(outcome(result)?.kind, "form_token");
    assert.deepEqual(fetchCalls, []);
  });

  it("rejects a tampered token", async () => {
    const client = await connect();
    const parts = issueFormToken(TOKEN_SECRET).split(".");
    parts[1] = String(Number(parts[1]) + 3600);
    const result = await client.callTool({
      name: "submit_contact_form",
      arguments: validSubmission(parts.join(".")),
    });
    assert.equal(outcome(result)?.kind, "form_token");
    assert.deepEqual(fetchCalls, []);
  });

  it("fails closed when MCP_FORM_TOKEN_SECRET is missing — even with a token", async () => {
    const token = issueFormToken(TOKEN_SECRET);
    delete process.env.MCP_FORM_TOKEN_SECRET;
    const client = await connect();
    const result = await client.callTool({
      name: "submit_contact_form",
      arguments: validSubmission(token),
    });
    assert.equal(outcome(result)?.kind, "config");
    assert.deepEqual(fetchCalls, [], "never falls back to accepting unsigned submissions");
  });

  it("fails closed when MCP_FORM_TOKEN_SECRET is a short placeholder", async () => {
    process.env.MCP_FORM_TOKEN_SECRET = "test";
    const client = await connect();
    const result = await client.callTool({
      name: "submit_contact_form",
      arguments: validSubmission(issueFormToken("test".repeat(16))),
    });
    assert.equal(outcome(result)?.kind, "config");
    assert.deepEqual(fetchCalls, []);
  });
});

describe("submit guard — a valid token proceeds", () => {
  it("accepts the token get_contact_form issued, and sends exactly one request", async () => {
    const client = await connect();
    const form = await client.callTool({ name: "get_contact_form", arguments: {} });
    const token = (form._meta as Record<string, unknown>)[FORM_TOKEN_META_KEY] as string;

    const result = await client.callTool({
      name: "submit_contact_form",
      arguments: validSubmission(token),
    });
    assert.equal(outcome(result)?.ok, true);
    assert.deepEqual(fetchCalls, ["http://contact-api.invalid/api/contact"]);
  });
});
