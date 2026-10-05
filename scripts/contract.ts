#!/usr/bin/env npx tsx
/**
 * Syncs and verifies the vendored contact form contract.
 *
 *   npm run sync:contract    — rewrite src/contact-contract.ts from the endpoint
 *   npm run check:contract   — fail if the vendored copy has drifted
 *
 * The landing page owns the contract (`src/lib/forms/contact-form-schema.ts`
 * there) and publishes it at GET /api/contact/schema specifically so this copy
 * can be diffed against it — its own docstring names `npm run check:contract`
 * here as the consumer.
 *
 * Why the copy is committed rather than fetched during `npm run build`: the
 * build must work offline and on a fresh clone, and the MCP App bundles the
 * option strings into a single-file HTML artifact. A build-time fetch would
 * make every deploy depend on the landing page being up, and would let a
 * network blip silently ship a stale bundle. Drift is caught here instead, as
 * an explicit release step.
 *
 * Drift matters because the option strings are also the keys of
 * GOAL_PARAGRAPHS in the landing page's welcome email. One byte of difference
 * silently drops the personalised paragraph — no error, just a worse email.
 */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_BASE_URL = "https://webweaver-nexus.vercel.app";
const OUTPUT_PATH = path.resolve("src", "contact-contract.ts");

/** The shape of GET /api/contact/schema. */
interface SchemaPayload {
  contractVersion: string;
  options: { value: string; tier: string | null }[];
  copy: {
    fullName: { heading: string; placeholder: string };
    email: { heading: string; placeholder: string };
    company: { heading: string; placeholder: string };
    primaryGoal: { heading: string; placeholder: string };
    privacyPolicy: { heading: string };
    foundingClient: { heading: string };
    submit: string;
    submitting: string;
  };
  consentText: string;
  foundingClientText: string;
  foundingOfferActive: boolean;
}

function baseUrl(): string {
  return (process.env.CONTACT_API_BASE_URL ?? DEFAULT_BASE_URL).replace(
    /\/$/,
    "",
  );
}

async function fetchSchema(): Promise<SchemaPayload> {
  const url = `${baseUrl()}/api/contact/schema`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`GET ${url} returned ${res.status} ${res.statusText}`);
  }
  const payload = (await res.json()) as SchemaPayload;

  // A missing field here means the endpoint changed shape, which is a bigger
  // problem than drift and should not be written into the vendored copy.
  for (const key of [
    "contractVersion",
    "options",
    "copy",
    "consentText",
    "foundingClientText",
  ] as const) {
    if (payload[key] === undefined) {
      throw new Error(`${url} response is missing "${key}"`);
    }
  }
  if (!Array.isArray(payload.options) || payload.options.length === 0) {
    throw new Error(`${url} returned no options`);
  }
  return payload;
}

/**
 * The vendored module, rebuilt into the endpoint's own shape so the two can be
 * compared field for field.
 *
 * Imported lazily: `sync` writes this module, so a top-level import would make
 * the script unable to run on a checkout where it does not yet exist.
 */
async function vendoredAsPayload(): Promise<SchemaPayload> {
  const vendored = await import("../src/contact-contract.ts");
  return {
    contractVersion: vendored.CONTRACT_VERSION,
    options: vendored.PRIMARY_GOAL_OPTIONS.map(({ value, tier }) => ({
      value,
      tier,
    })),
    copy: vendored.CONTACT_FORM_COPY,
    consentText: vendored.CONSENT_TEXT,
    foundingClientText: vendored.FOUNDING_CLIENT_TEXT,
    foundingOfferActive: vendored.FOUNDING_OFFER_ACTIVE,
  } as SchemaPayload;
}

// ── sync ───────────────────────────────────────────────────────────────────

function renderModule(schema: SchemaPayload): string {
  const q = (value: string) => JSON.stringify(value);

  const options = schema.options
    .map(
      ({ value, tier }) =>
        `  { value: ${q(value)}, tier: ${tier === null ? "null" : q(tier)} },`,
    )
    .join("\n");

  return `/**
 * Contact form contract — GENERATED FILE. Do not edit by hand.
 *
 * Vendored from GET /api/contact/schema on the landing page, which is the
 * single source of truth (its \`src/lib/forms/contact-form-schema.ts\`).
 *
 *   npm run sync:contract    — regenerate this file
 *   npm run check:contract   — fail if it has drifted from the endpoint
 *
 * Character-level cautions, inherited from the Tally form these strings
 * replace: the separator before a tier code is space + ASCII hyphen-minus +
 * space (" - "), never an en dash; apostrophes are straight ASCII; "&" is
 * literal; spellings are British ("optimised"). A single byte of drift
 * silently drops the personalised paragraph from the welcome email, because
 * these values are also the keys of GOAL_PARAGRAPHS over there.
 *
 * Bundled into the MCP App, so it must contain nothing secret.
 */

/** Bumped by the landing page whenever the options or field set change. */
export const CONTRACT_VERSION = ${q(schema.contractVersion)};

/**
 * The dropdown, in display order. \`tier\` is published explicitly rather than
 * parsed off the " - Tier NX" suffix, so a copy edit cannot silently change
 * which tier a lead is recorded against.
 */
export const PRIMARY_GOAL_OPTIONS = [
${options}
] as const;

export type PrimaryGoal = (typeof PRIMARY_GOAL_OPTIONS)[number]["value"];

/** Headings, placeholders and button labels, reproduced exactly. */
export const CONTACT_FORM_COPY = ${JSON.stringify(schema.copy, null, 2)} as const;

/**
 * Stored verbatim against every submission: UK GDPR Art. 6(1)(a) requires
 * showing *what* was consented to, not merely that consent was given.
 */
export const CONSENT_TEXT = ${q(schema.consentText)};

/** Carries the offer deadline, interpolated upstream so it cannot drift. */
export const FOUNDING_CLIENT_TEXT = ${q(schema.foundingClientText)};

/** False once the Founding Client Programme closes; hides the checkbox. */
export const FOUNDING_OFFER_ACTIVE = ${schema.foundingOfferActive};
`;
}

async function sync(): Promise<void> {
  const schema = await fetchSchema();
  await fs.writeFile(OUTPUT_PATH, renderModule(schema), "utf-8");
  console.log(
    `Wrote ${path.relative(process.cwd(), OUTPUT_PATH)} ` +
      `(contract ${schema.contractVersion}, ${schema.options.length} options) ` +
      `from ${baseUrl()}`,
  );
}

// ── check ──────────────────────────────────────────────────────────────────

/** Every leaf path where two payloads differ, as `a.b[0].c` strings. */
function diffPaths(live: unknown, local: unknown, at = ""): string[] {
  if (JSON.stringify(live) === JSON.stringify(local)) return [];

  if (Array.isArray(live) && Array.isArray(local)) {
    const out: string[] = [];
    for (let i = 0; i < Math.max(live.length, local.length); i++) {
      out.push(...diffPaths(live[i], local[i], `${at}[${i}]`));
    }
    return out;
  }

  const bothObjects =
    live !== null &&
    local !== null &&
    typeof live === "object" &&
    typeof local === "object";

  if (bothObjects) {
    const keys = new Set([
      ...Object.keys(live as object),
      ...Object.keys(local as object),
    ]);
    const out: string[] = [];
    for (const key of keys) {
      out.push(
        ...diffPaths(
          (live as Record<string, unknown>)[key],
          (local as Record<string, unknown>)[key],
          at ? `${at}.${key}` : key,
        ),
      );
    }
    return out;
  }

  return [at || "(root)"];
}

async function check(): Promise<void> {
  const live = await fetchSchema();
  const local = await vendoredAsPayload();
  const paths = diffPaths(live, local);

  if (paths.length === 0) {
    console.log(
      `Contract ${live.contractVersion} matches ${baseUrl()} — ` +
        `${live.options.length} options, no drift.`,
    );
    return;
  }

  console.error(
    `Contract drift: src/contact-contract.ts does not match ${baseUrl()}/api/contact/schema\n`,
  );
  for (const at of paths) {
    const pick = (root: unknown) =>
      at
        .replace(/\[(\d+)\]/g, ".$1")
        .split(".")
        .filter(Boolean)
        .reduce<unknown>(
          (node, key) => (node as Record<string, unknown>)?.[key],
          root,
        );
    console.error(`  ${at}`);
    console.error(`    live:     ${JSON.stringify(pick(live))}`);
    console.error(`    vendored: ${JSON.stringify(pick(local))}`);
  }
  console.error("\nRun `npm run sync:contract` to adopt the live contract.");
  process.exitCode = 1;
}

// ── entry ──────────────────────────────────────────────────────────────────

const mode = process.argv[2];
if (mode === "sync") {
  await sync();
} else if (mode === "check") {
  await check();
} else {
  console.error("Usage: tsx scripts/contract.ts <sync|check>");
  process.exitCode = 2;
}
