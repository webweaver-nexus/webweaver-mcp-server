/**
 * Contact form contract — GENERATED FILE. Do not edit by hand.
 *
 * Vendored from GET /api/contact/schema on the landing page, which is the
 * single source of truth (its `src/lib/forms/contact-form-schema.ts`).
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
export const CONTRACT_VERSION = "2.0.0";

/**
 * The dropdown, in display order. `tier` is published explicitly rather than
 * parsed off the " - Tier NX" suffix, so a copy edit cannot silently change
 * which tier a lead is recorded against.
 */
export const PRIMARY_GOAL_OPTIONS = [
  { value: "I'm not sure yet - I need a Discovery & Audit", tier: null },
  { value: "Essentials landing page or website, optimised for Local/Standard SEO - Tier 1A", tier: "1A" },
  { value: "AI-Search Optimised landing page or website, optimised for AI Search - Tier 1B", tier: "1B" },
  { value: "Automation of Customer Support through my landing page/website - Tier 2A", tier: "2A" },
  { value: "Automation of Lead Qualification through my landing page/website - Tier 2B", tier: "2B" },
  { value: "Secure Tools Connection to my web service from ChatGPT, etc. - Tier 3A", tier: "3A" },
  { value: "Secure Interactive UI Connection to my web service from ChatGPT, etc. - Tier 3B", tier: "3B" },
] as const;

export type PrimaryGoal = (typeof PRIMARY_GOAL_OPTIONS)[number]["value"];

/** Headings, placeholders and button labels, reproduced exactly. */
export const CONTACT_FORM_COPY = {
  "fullName": {
    "heading": "Full Name",
    "placeholder": "Full Name"
  },
  "email": {
    "heading": "Email",
    "placeholder": "Email Address"
  },
  "company": {
    "heading": "Company (optional)",
    "placeholder": "Your company if you have one"
  },
  "primaryGoal": {
    "heading": "What is your primary goal?",
    "placeholder": "Please Select an Option"
  },
  "privacyPolicy": {
    "heading": "Privacy Policy"
  },
  "foundingClient": {
    "heading": "Founding Client (optional)"
  },
  "submit": "Contact Us",
  "submitting": "Sending…"
} as const;

/**
 * Stored verbatim against every submission: UK GDPR Art. 6(1)(a) requires
 * showing *what* was consented to, not merely that consent was given.
 */
export const CONSENT_TEXT = "I agree to the Privacy Policy and consent to WebWeaver Nexus using my contact details to respond to this enquiry.";

/** Carries the offer deadline, interpolated upstream so it cannot drift. */
export const FOUNDING_CLIENT_TEXT = "I'd like to be considered for the Founding Client Programme (open until 18 December 2026).";

/** False once the Founding Client Programme closes; hides the checkbox. */
export const FOUNDING_OFFER_ACTIVE = true;
