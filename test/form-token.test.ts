/**
 * Unit tests for the form token (form-token.ts).
 *
 * Run with `npm test`. Uses Node's built-in test runner through tsx, so it adds
 * no dependencies. Not run in CI: this repo's only workflows are the registry
 * publish and the contract drift check.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FORM_TOKEN_TTL_SECONDS,
  issueFormToken,
  readFormTokenSecret,
  verifyFormToken,
} from "../form-token.ts";

const SECRET = "a".repeat(64);
const NOW = Date.UTC(2026, 10, 14, 12, 0, 0);

describe("issue and verify", () => {
  it("accepts a token it has just issued", () => {
    const token = issueFormToken(SECRET, NOW);
    assert.deepEqual(verifyFormToken(token, SECRET, NOW), { ok: true });
  });

  it("accepts a token just inside the 30-minute window", () => {
    const token = issueFormToken(SECRET, NOW);
    const later = NOW + (FORM_TOKEN_TTL_SECONDS - 1) * 1000;
    assert.deepEqual(verifyFormToken(token, SECRET, later), { ok: true });
  });

  it("issues a different token every time", () => {
    assert.notEqual(issueFormToken(SECRET, NOW), issueFormToken(SECRET, NOW));
  });

  it("carries no personal data — only version, timestamp, nonce, signature", () => {
    const parts = issueFormToken(SECRET, NOW).split(".");
    assert.equal(parts.length, 4);
    const [version, issuedAt, nonce, signature] = parts;
    assert.equal(version, "v1");
    assert.equal(issuedAt, String(Math.floor(NOW / 1000)));
    assert.match(nonce, /^[A-Za-z0-9_-]{22}$/); // 16 bytes, base64url
    assert.match(signature, /^[A-Za-z0-9_-]{43}$/); // 32 bytes, base64url
  });
});

describe("expiry", () => {
  it("rejects a token older than 30 minutes", () => {
    const token = issueFormToken(SECRET, NOW);
    const later = NOW + (FORM_TOKEN_TTL_SECONDS + 1) * 1000;
    assert.deepEqual(verifyFormToken(token, SECRET, later), {
      ok: false,
      reason: "expired",
    });
  });

  it("rejects a token dated more than a minute in the future", () => {
    const token = issueFormToken(SECRET, NOW + 5 * 60 * 1000);
    assert.deepEqual(verifyFormToken(token, SECRET, NOW), {
      ok: false,
      reason: "not_yet_valid",
    });
  });

  it("tolerates small clock skew between instances", () => {
    const token = issueFormToken(SECRET, NOW + 30 * 1000);
    assert.deepEqual(verifyFormToken(token, SECRET, NOW), { ok: true });
  });
});

describe("tampering", () => {
  const token = issueFormToken(SECRET, NOW);
  const [version, issuedAt, nonce, signature] = token.split(".");

  it("rejects a changed signature", () => {
    const flipped = signature[0] === "A" ? `B${signature.slice(1)}` : `A${signature.slice(1)}`;
    assert.deepEqual(
      verifyFormToken(`${version}.${issuedAt}.${nonce}.${flipped}`, SECRET, NOW),
      { ok: false, reason: "bad_signature" },
    );
  });

  it("rejects a back-dated timestamp — the classic way to extend a token", () => {
    const backdated = String(Number(issuedAt) + 3600);
    assert.deepEqual(
      verifyFormToken(`${version}.${backdated}.${nonce}.${signature}`, SECRET, NOW),
      { ok: false, reason: "bad_signature" },
    );
  });

  it("rejects a changed nonce", () => {
    assert.deepEqual(
      verifyFormToken(`${version}.${issuedAt}.AAAAAAAAAAAAAAAAAAAAAA.${signature}`, SECRET, NOW),
      { ok: false, reason: "bad_signature" },
    );
  });

  it("rejects a token signed with a different secret", () => {
    const foreign = issueFormToken("b".repeat(64), NOW);
    assert.deepEqual(verifyFormToken(foreign, SECRET, NOW), {
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects a signature of the wrong length without throwing", () => {
    assert.deepEqual(
      verifyFormToken(`${version}.${issuedAt}.${nonce}.short`, SECRET, NOW),
      { ok: false, reason: "bad_signature" },
    );
  });
});

describe("missing or malformed", () => {
  for (const [label, value] of [
    ["undefined", undefined],
    ["empty string", ""],
    ["a number", 12345],
    ["null", null],
  ] as const) {
    it(`rejects ${label} as missing`, () => {
      assert.deepEqual(verifyFormToken(value, SECRET, NOW), {
        ok: false,
        reason: "missing",
      });
    });
  }

  for (const [label, value] of [
    ["too few parts", "v1.123.abc"],
    ["too many parts", "v1.123.abc.def.ghi"],
    ["unknown version", "v2.123.abc.def"],
    ["non-numeric timestamp", "v1.soon.abc.def"],
    ["empty nonce", "v1.123..def"],
  ] as const) {
    it(`rejects ${label} as malformed`, () => {
      assert.deepEqual(verifyFormToken(value, SECRET, NOW), {
        ok: false,
        reason: "malformed",
      });
    });
  }
});

describe("secret handling — fail closed", () => {
  it("treats an unset secret as unusable", () => {
    assert.deepEqual(readFormTokenSecret(undefined), { ok: false, problem: "unset" });
    assert.deepEqual(readFormTokenSecret(""), { ok: false, problem: "unset" });
  });

  it("treats a short placeholder secret as unusable rather than weakening the guard", () => {
    assert.deepEqual(readFormTokenSecret("test"), { ok: false, problem: "too_short" });
    assert.deepEqual(readFormTokenSecret("x".repeat(31)), { ok: false, problem: "too_short" });
  });

  it("accepts a secret of openssl rand -hex 32 length", () => {
    assert.deepEqual(readFormTokenSecret(SECRET), { ok: true, secret: SECRET });
  });
});
