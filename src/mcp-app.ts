/**
 * @file MCP App client for the WebWeaver Nexus contact form.
 *
 * Renders the contact form natively in this document and submits it through
 * the MCP bridge via `app.callServerTool()`. It makes **no external requests
 * of its own** — that is the whole point. The previous version iframed a Tally
 * form, which Claude Desktop and claude.ai both block with
 * `frame-src 'self' blob: data:`; nesting an iframe of our own form hits the
 * identical bug, so only a same-document form fixes it.
 *
 * Going through `callServerTool` rather than fetching the contact API directly
 * also keeps `CONTACT_FORM_SHARED_SECRET` out of this file. Everything here is
 * bundled into a single ~435 KB HTML string that is handed to every user, so
 * nothing secret may ever be imported into it.
 */

import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import {
  CONSENT_TEXT,
  CONTACT_FORM_COPY,
  FOUNDING_CLIENT_TEXT,
  FOUNDING_OFFER_ACTIVE,
  PRIMARY_GOAL_OPTIONS,
} from "./contact-contract.ts";
import type { SubmitOutcome } from "./submit-outcome.ts";
import "./global.css";
import "./mcp-app.css";

// ── Constants ──────────────────────────────────────────────────────────
// The public site, used only for links shown to the user. Always production:
// CONTACT_API_BASE_URL may point at a local landing page during development,
// but a local dev server is not where we send someone to read a policy.
const SITE_URL = "https://webweaver-nexus.vercel.app";
const PRIVACY_POLICY_URL = `${SITE_URL}/privacy-policy`;
const WEB_FORM_URL = `${SITE_URL}/#contact`;

/** The label inside CONSENT_TEXT to turn into a link, if it is present. */
const PRIVACY_LINK_LABEL = "Privacy Policy";

/**
 * Epoch ms at load, for the contact API's submit-timing check.
 *
 * A module-scope constant, never storage: hosts that strip `allow-same-origin`
 * leave this document on an opaque origin, where `localStorage`,
 * `sessionStorage` and `document.cookie` all throw `SecurityError`.
 */
const RENDERED_AT = Date.now();

type FieldName =
  | "fullName"
  | "email"
  | "company"
  | "primaryGoal"
  | "consentPrivacy";

/** Focus order when reporting the first invalid field. */
const FIELD_ORDER: FieldName[] = [
  "fullName",
  "email",
  "company",
  "primaryGoal",
  "consentPrivacy",
];

/**
 * Validation copy, authored here rather than vendored: the contract endpoint
 * publishes field headings and option strings but not error messages. These
 * match the landing page's zod messages so both renderers read the same.
 */
const MESSAGES = {
  fullName: "Please enter your full name",
  fullNameLong: "Please use 120 characters or fewer",
  email: "Please enter a valid email address",
  companyLong: "Please use 160 characters or fewer",
  primaryGoal: "Please select an option",
  consentPrivacy: "Please agree to the Privacy Policy to continue",
} as const;

// Shape check only. The contact API's zod schema is authoritative and its 422
// fieldErrors are painted onto the fields, so this just avoids a round-trip
// for an obviously empty or malformed address.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── DOM references ─────────────────────────────────────────────────────
const el = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const mainEl = document.querySelector(".main") as HTMLElement;
const formEl = el<HTMLDivElement>("contact-form");
const fullNameEl = el<HTMLInputElement>("fullName");
const emailEl = el<HTMLInputElement>("email");
const companyEl = el<HTMLInputElement>("company");
const primaryGoalEl = el<HTMLSelectElement>("primaryGoal");
const consentEl = el<HTMLInputElement>("consentPrivacy");
const consentTextEl = el<HTMLLabelElement>("consent-text");
const foundingFieldEl = el<HTMLDivElement>("founding-field");
const foundingEl = el<HTMLInputElement>("foundingClient");
const foundingTextEl = el<HTMLLabelElement>("founding-text");
const submitEl = el<HTMLButtonElement>("submit");
const formErrorEl = el<HTMLParagraphElement>("form-error");
const confirmationEl = el<HTMLDivElement>("confirmation");
const confirmationHeadingEl = el<HTMLHeadingElement>("confirmation-heading");
const fallbackEl = el<HTMLDivElement>("fallback");
const fallbackOpenEl = el<HTMLButtonElement>("fallback-open");
const fallbackUrlEl = el<HTMLParagraphElement>("fallback-url");

const inputFor: Record<FieldName, HTMLElement> = {
  fullName: fullNameEl,
  email: emailEl,
  company: companyEl,
  primaryGoal: primaryGoalEl,
  consentPrivacy: consentEl,
};

/** Only nag with per-field errors once the user has tried to submit. */
let attempted = false;

// ── Host context theming ───────────────────────────────────────────────
function handleHostContextChanged(ctx: McpUiHostContext) {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  if (ctx.safeAreaInsets) {
    mainEl.style.paddingTop = `${ctx.safeAreaInsets.top}px`;
    mainEl.style.paddingRight = `${ctx.safeAreaInsets.right}px`;
    mainEl.style.paddingBottom = `${ctx.safeAreaInsets.bottom}px`;
    mainEl.style.paddingLeft = `${ctx.safeAreaInsets.left}px`;
  }
}

// ── Field errors ───────────────────────────────────────────────────────
function setFieldError(field: FieldName, message: string | undefined) {
  const errorEl = el<HTMLParagraphElement>(`${field}-error`);
  const input = inputFor[field];
  errorEl.textContent = message ?? "";
  errorEl.hidden = !message;
  if (message) {
    input.setAttribute("aria-invalid", "true");
  } else {
    input.removeAttribute("aria-invalid");
  }
}

function clearFieldErrors() {
  for (const field of FIELD_ORDER) setFieldError(field, undefined);
}

function paintFieldErrors(errors: Partial<Record<FieldName, string>>) {
  for (const field of FIELD_ORDER) setFieldError(field, errors[field]);
  const first = FIELD_ORDER.find((field) => errors[field]);
  if (first) inputFor[first].focus();
}

function setFormError(message: string | null) {
  formErrorEl.textContent = message ?? "";
  formErrorEl.hidden = !message;
}

// ── Values and validation ──────────────────────────────────────────────
interface FormValues {
  fullName: string;
  email: string;
  company: string;
  primaryGoal: string;
  consentPrivacy: boolean;
  foundingClient: boolean;
}

function readValues(): FormValues {
  return {
    fullName: fullNameEl.value.trim(),
    email: emailEl.value.trim(),
    company: companyEl.value.trim(),
    primaryGoal: primaryGoalEl.value,
    consentPrivacy: consentEl.checked,
    // A hidden checkbox must never contribute an opt-in, even if it was
    // ticked before the goal changed to an excluded one.
    foundingClient: !foundingFieldEl.hidden && foundingEl.checked,
  };
}

function validate(values: FormValues): Partial<Record<FieldName, string>> {
  const errors: Partial<Record<FieldName, string>> = {};
  if (!values.fullName) errors.fullName = MESSAGES.fullName;
  else if (values.fullName.length > 120) errors.fullName = MESSAGES.fullNameLong;

  if (!EMAIL_SHAPE.test(values.email) || values.email.length > 254) {
    errors.email = MESSAGES.email;
  }
  if (values.company.length > 160) errors.company = MESSAGES.companyLong;
  if (!values.primaryGoal) errors.primaryGoal = MESSAGES.primaryGoal;
  if (!values.consentPrivacy) errors.consentPrivacy = MESSAGES.consentPrivacy;
  return errors;
}

// ── Founding Client visibility ─────────────────────────────────────────
/**
 * Mirrors the landing page: the checkbox appears only once a goal is chosen
 * and only for goals the programme covers. Tier 3 is excluded — 3A is the
 * price ceiling and 3B is quote-on-enquiry, so an audit credit fits neither.
 *
 * The rule is derived from the `tier` field the contract publishes rather than
 * from a vendored copy of the eligible-tier list, which the endpoint does not
 * expose. If that list ever changes, the checkbox shows or hides wrongly while
 * the API still records correctly — cosmetic drift, never a data error.
 */
function syncFoundingVisibility() {
  const option = PRIMARY_GOAL_OPTIONS.find(
    (candidate) => candidate.value === primaryGoalEl.value,
  );
  const applies =
    FOUNDING_OFFER_ACTIVE &&
    option !== undefined &&
    !option.tier?.startsWith("3");

  if (!applies && foundingEl.checked) foundingEl.checked = false;
  foundingFieldEl.hidden = !applies;
}

// ── Static copy and options ────────────────────────────────────────────
function populateOptions() {
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = CONTACT_FORM_COPY.primaryGoal.placeholder;
  // Starts empty and genuinely required, so "not sure yet" is a real signal
  // rather than an untouched default.
  placeholder.selected = true;
  primaryGoalEl.append(placeholder);

  for (const { value } of PRIMARY_GOAL_OPTIONS) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    primaryGoalEl.append(option);
  }
}

function applyPlaceholders() {
  fullNameEl.placeholder = CONTACT_FORM_COPY.fullName.placeholder;
  emailEl.placeholder = CONTACT_FORM_COPY.email.placeholder;
  companyEl.placeholder = CONTACT_FORM_COPY.company.placeholder;
  submitEl.textContent = CONTACT_FORM_COPY.submit;
  foundingTextEl.textContent = FOUNDING_CLIENT_TEXT;
}

/**
 * Renders the consent text, turning "Privacy Policy" into a control that asks
 * the host to open the policy. `target="_blank"` is useless here — a sandbox
 * without `allow-popups` blocks it — so this goes through `ui/open-link`.
 * Without that capability the text stays plain and the URL is shown below it,
 * selectable, rather than leaving a control that does nothing.
 */
function renderConsentText(canOpenLinks: boolean) {
  const index = CONSENT_TEXT.indexOf(PRIVACY_LINK_LABEL);

  if (!canOpenLinks || index === -1) {
    consentTextEl.textContent = CONSENT_TEXT;
    if (!canOpenLinks) {
      const note = document.createElement("p");
      note.className = "policy-url";
      note.textContent = `Privacy Policy: ${PRIVACY_POLICY_URL}`;
      consentTextEl.insertAdjacentElement("afterend", note);
    }
    return;
  }

  const link = document.createElement("button");
  link.type = "button";
  link.className = "inline-link";
  link.textContent = PRIVACY_LINK_LABEL;
  link.addEventListener("click", (event) => {
    // The label wraps the checkbox, so a click inside it would otherwise
    // toggle consent as a side effect of reading the policy.
    event.preventDefault();
    event.stopPropagation();
    void app.openLink({ url: PRIVACY_POLICY_URL }).catch((error: unknown) => {
      console.error("[mcp-app] openLink failed", error);
    });
  });

  consentTextEl.replaceChildren(
    document.createTextNode(CONSENT_TEXT.slice(0, index)),
    link,
    document.createTextNode(CONSENT_TEXT.slice(index + PRIVACY_LINK_LABEL.length)),
  );
}

// ── Submission ─────────────────────────────────────────────────────────
function setSubmitting(submitting: boolean) {
  submitEl.disabled = submitting;
  submitEl.textContent = submitting
    ? CONTACT_FORM_COPY.submitting
    : CONTACT_FORM_COPY.submit;
  formEl.setAttribute("aria-busy", String(submitting));
}

function showConfirmation() {
  formEl.hidden = true;
  confirmationEl.hidden = false;
  // The SDK's auto-resize observes documentElement and body, so swapping the
  // form for this shorter block reports a new height on its own.
  confirmationHeadingEl.focus();
}

async function handleSubmit() {
  attempted = true;
  setFormError(null);

  const values = readValues();
  const errors = validate(values);
  if (Object.keys(errors).length > 0) {
    paintFieldErrors(errors);
    return;
  }
  clearFieldErrors();
  setSubmitting(true);

  try {
    const result = await app.callServerTool({
      name: "submit_contact_form",
      arguments: {
        fullName: values.fullName,
        email: values.email,
        ...(values.company ? { company: values.company } : {}),
        primaryGoal: values.primaryGoal,
        consentPrivacy: true,
        foundingClient: values.foundingClient,
        renderedAt: RENDERED_AT,
      },
    });

    const outcome = result.structuredContent as SubmitOutcome | undefined;

    if (outcome?.ok) {
      showConfirmation();
      await notifyHost(values);
      return;
    }

    if (outcome?.kind === "validation" && outcome.fieldErrors) {
      const mapped: Partial<Record<FieldName, string>> = {};
      for (const [field, messages] of Object.entries(outcome.fieldErrors)) {
        if (FIELD_ORDER.includes(field as FieldName)) {
          mapped[field as FieldName] = messages?.[0];
        }
      }
      // A 422 naming only fields we do not render would otherwise look like
      // nothing happened at all.
      if (Object.keys(mapped).length > 0) {
        paintFieldErrors(mapped);
      } else {
        setFormError(outcome.message);
      }
      return;
    }

    setFormError(
      outcome?.message ?? "Something went wrong. Please try again in a moment.",
    );
  } catch (error) {
    console.error("[mcp-app] callServerTool failed", error);
    setFormError("We could not reach the server. Please try again in a moment.");
  } finally {
    setSubmitting(false);
  }
}

/**
 * Tells the host's model that the form was submitted, so the conversation can
 * carry on sensibly. Not every host accepts context updates — MCP Inspector,
 * for one, never registers a handler — so check before calling.
 */
async function notifyHost(values: FormValues) {
  if (!app.getHostCapabilities()?.updateModelContext) {
    console.info(
      "[mcp-app] Host does not accept model context updates; skipping.",
    );
    return;
  }
  try {
    await app.updateModelContext({
      content: [
        {
          type: "text",
          text:
            "The user has submitted the WebWeaver Nexus contact form " +
            `(primary goal: ${values.primaryGoal}). WebWeaver Nexus will be ` +
            "in touch to arrange a brief Discovery video call.",
        },
      ],
    });
  } catch (error) {
    console.error("[mcp-app] updateModelContext failed", error);
  }
}

// ── Fallback when the host cannot proxy tool calls ─────────────────────
/**
 * Shown *instead of* the form, decided on load rather than on submit. A form
 * whose submit button silently does nothing is worse than no form at all: it
 * looks like it worked.
 */
function showFallback(canOpenLinks: boolean) {
  formEl.hidden = true;
  fallbackEl.hidden = false;

  if (canOpenLinks) {
    fallbackOpenEl.hidden = false;
    fallbackOpenEl.addEventListener("click", () => {
      void app.openLink({ url: WEB_FORM_URL }).catch((error: unknown) => {
        console.error("[mcp-app] openLink failed", error);
        fallbackUrlEl.textContent = WEB_FORM_URL;
        fallbackUrlEl.hidden = false;
      });
    });
    return;
  }

  fallbackUrlEl.textContent = WEB_FORM_URL;
  fallbackUrlEl.hidden = false;
}

// ── Wiring ─────────────────────────────────────────────────────────────
function wireForm() {
  submitEl.addEventListener("click", () => void handleSubmit());

  primaryGoalEl.addEventListener("change", () => {
    syncFoundingVisibility();
    if (attempted) setFieldError("primaryGoal", undefined);
  });

  for (const field of FIELD_ORDER) {
    inputFor[field].addEventListener("input", () => {
      if (attempted) setFieldError(field, undefined);
    });
  }
  consentEl.addEventListener("change", () => {
    if (attempted) setFieldError("consentPrivacy", undefined);
  });

  // There is no <form>, so Enter has to be handled explicitly. Excluded for
  // <select>, where Enter belongs to the native option popup.
  formEl.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    const target = event.target as HTMLElement | null;
    if (!target || target.tagName === "SELECT" || target.tagName === "BUTTON") {
      return;
    }
    event.preventDefault();
    void handleSubmit();
  });
}

// ── MCP App lifecycle ──────────────────────────────────────────────────
const app = new App({ name: "WebWeaver Nexus Contact", version: "2.0.0" });

app.onteardown = async () => {
  return {};
};

app.onerror = console.error;
app.onhostcontextchanged = handleHostContextChanged;

await app.connect();

const ctx = app.getHostContext();
if (ctx) handleHostContextChanged(ctx);

const capabilities = app.getHostCapabilities();
const canOpenLinks = Boolean(capabilities?.openLinks);

populateOptions();
applyPlaceholders();
renderConsentText(canOpenLinks);
syncFoundingVisibility();

if (capabilities?.serverTools) {
  wireForm();
} else {
  console.warn(
    "[mcp-app] Host does not declare the serverTools capability, so the form " +
      "cannot be submitted from here; offering the web form instead.",
  );
  showFallback(canOpenLinks);
}
