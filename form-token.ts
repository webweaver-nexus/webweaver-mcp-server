/**
 * Short-lived, stateless form tokens: proof that a submission came from a
 * contact form this server rendered, rather than from a model calling
 * `submit_contact_form` directly.
 *
 * Why this exists. `submit_contact_form` is declared `visibility: ["app"]`, and
 * the MCP Apps spec says hosts MUST NOT list such tools to the model. Claude and
 * ChatGPT comply. Gemini does not — it lists the tool as an ordinary action. So
 * the server enforces the rule itself instead of trusting every host to.
 *
 * Shape: `v1.<issuedAt>.<nonce>.<signature>`
 *   - issuedAt  integer seconds since the epoch
 *   - nonce     16 random bytes, base64url
 *   - signature HMAC-SHA256 over `v1.<issuedAt>.<nonce>`, base64url
 *
 * It carries no personal data — a timestamp and random bytes, nothing else.
 *
 * Limits, stated rather than discovered:
 *   - NOT single-use. Replay protection needs a store of spent nonces, which the
 *     deliberately stateless design avoids. The 30-minute expiry bounds the
 *     window instead.
 *   - It is only as strong as the host's handling of `_meta`. The token reaches
 *     the App through the tool result's `_meta`, which the MCP Apps spec
 *     describes as "not intended for model context" — but that is best-practice
 *     guidance, not a MUST. A host that ignores the visibility MUST could also
 *     leak `_meta` to its model. This raises the bar; it is not a guarantee.
 *
 * Server-side only. Never import this from `src/`, which is bundled into the
 * App and served to every user.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** 30 minutes — long enough to fill a form, short enough to bound a replay. */
export const FORM_TOKEN_TTL_SECONDS = 30 * 60;

/**
 * Tolerance for a token that appears to be issued in the future. The issuing
 * and verifying invocations can land on different Vercel instances; their
 * clocks are NTP-synced, so this only needs to cover small drift.
 */
const CLOCK_SKEW_SECONDS = 60;

/**
 * HMAC-SHA256 with a short key is brute-forceable. `openssl rand -hex 32`
 * produces 64 characters; anything under 32 is treated as unusable so a
 * placeholder like `test` fails closed instead of silently weakening the guard.
 */
const MIN_SECRET_LENGTH = 32;

const VERSION = "v1";

export type FormTokenSecret =
  | { ok: true; secret: string }
  | { ok: false; problem: "unset" | "too_short" };

/** Reads and vets the signing secret. Never falls back to a default. */
export function readFormTokenSecret(raw: string | undefined): FormTokenSecret {
  if (!raw) return { ok: false, problem: "unset" };
  if (raw.length < MIN_SECRET_LENGTH) return { ok: false, problem: "too_short" };
  return { ok: true, secret: raw };
}

export type FormTokenRejection =
  | "missing"
  | "malformed"
  | "bad_signature"
  | "expired"
  | "not_yet_valid";

export type FormTokenVerdict =
  | { ok: true }
  | { ok: false; reason: FormTokenRejection };

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Issues a fresh token. `now` is injectable so expiry can be tested. */
export function issueFormToken(secret: string, now: number = Date.now()): string {
  const issuedAt = Math.floor(now / 1000);
  const nonce = randomBytes(16).toString("base64url");
  const payload = `${VERSION}.${issuedAt}.${nonce}`;
  return `${payload}.${sign(secret, payload)}`;
}

/**
 * Verifies signature, then expiry. The signature is checked first and in
 * constant time: a token this server did not sign tells us nothing, so its
 * claimed timestamp is never acted on.
 */
export function verifyFormToken(
  token: unknown,
  secret: string,
  now: number = Date.now(),
): FormTokenVerdict {
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, reason: "missing" };
  }

  const parts = token.split(".");
  if (parts.length !== 4) return { ok: false, reason: "malformed" };
  const [version, issuedAtRaw, nonce, signature] = parts;
  if (
    version !== VERSION ||
    !/^\d{1,12}$/.test(issuedAtRaw) ||
    nonce.length === 0 ||
    signature.length === 0
  ) {
    return { ok: false, reason: "malformed" };
  }

  const expected = Buffer.from(sign(secret, `${version}.${issuedAtRaw}.${nonce}`));
  const presented = Buffer.from(signature);
  // timingSafeEqual throws on unequal lengths, so compare lengths first. A
  // length mismatch reveals only that the signature is wrong, which the caller
  // learns anyway.
  if (
    presented.length !== expected.length ||
    !timingSafeEqual(presented, expected)
  ) {
    return { ok: false, reason: "bad_signature" };
  }

  const issuedAt = Number(issuedAtRaw);
  const nowSeconds = Math.floor(now / 1000);
  if (issuedAt - nowSeconds > CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: "not_yet_valid" };
  }
  if (nowSeconds - issuedAt > FORM_TOKEN_TTL_SECONDS) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true };
}
