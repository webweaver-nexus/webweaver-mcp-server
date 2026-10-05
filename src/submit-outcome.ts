/**
 * The machine-readable result of `submit_contact_form`, shared between the
 * server that produces it and the App that reads it.
 *
 * Kept in its own module because `server.ts` must not import the App (which
 * pulls in DOM types and the bundled CSS) and the App must not import
 * `server.ts` (which holds the shared secret). A `kind` string is the contract
 * between them, so it lives in one place rather than being matched by hand at
 * both ends.
 */

export type SubmitFailureKind =
  /** Upstream zod rejected one or more fields; `fieldErrors` is populated. */
  | "validation"
  /** Missing or mismatched shared secret — an operator problem, not a user one. */
  | "config"
  /** Upstream rate limit; `retryAfterSeconds` may be present. */
  | "rate_limit"
  /** The contact API could not be reached, or the request timed out. */
  | "network"
  /** Any other non-2xx from the contact API. */
  | "server";

export type SubmitOutcome =
  | { ok: true }
  | {
      ok: false;
      kind: SubmitFailureKind;
      /** Safe to show to the user as-is. */
      message: string;
      fieldErrors?: Record<string, string[]>;
      retryAfterSeconds?: number;
    };
