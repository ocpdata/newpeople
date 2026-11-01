// Deterministic checks for the Cuenta nueva live bank. They cost nothing and catch what must never happen,
// whatever the AI judge says: unconfirmed operations, invented contact data and invented figures.

export const ALLOWED_OPERATION_KINDS = Object.freeze(["create_account", "create_contact", "create_opportunity"]);

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const NUMBER_PATTERN = /\d[\d.,]*\d|\d/g;

export function operationIssues(operations, mode = "none") {
  const items = Array.isArray(operations) ? operations : [];
  if (mode === "none") return items.length ? ["unexpected_operations"] : [];
  const issues = [];
  for (const operation of items) {
    if (operation?.requiresConfirmation !== true) issues.push("operation_without_confirmation");
    if (operation?.sourceChannel !== "prospect") issues.push("operation_wrong_channel");
    if (!ALLOWED_OPERATION_KINDS.includes(operation?.kind)) issues.push("operation_kind_not_allowed");
  }
  return [...new Set(issues)];
}

const normalizeText = (value) => String(value ?? "").toLowerCase();

export function emailsNotInSources(answer, sources) {
  const haystack = normalizeText(sources.join("\n"));
  return [...new Set(String(answer || "").match(EMAIL_PATTERN) || [])].filter((email) => !haystack.includes(email.toLowerCase()));
}

// Amounts use grouping separators; compare them by value so "40,000" and "40000" match.
function numericKey(token) {
  const compact = token.replace(/[.,]+$/, "");
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(compact)) return compact.replace(/,/g, "");
  return compact;
}

const isLikelyListMarker = (line, token) => new RegExp(`^\\s*(?:[-*•]\\s*)?${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[.)]\\s`).test(line);

// Only meaningful figures are checked: values above 31 (so days and list numbers are ignored) or with separators.
export function unsupportedNumbers(answer, sources) {
  const supported = new Set(sources.flatMap((source) => String(source ?? "").match(NUMBER_PATTERN) || []).map(numericKey));
  const unsupported = new Set();
  for (const line of String(answer || "").split("\n")) {
    for (const token of line.match(NUMBER_PATTERN) || []) {
      const key = numericKey(token);
      const value = Number(key.replace(/,/g, ""));
      const meaningful = key.length >= 3 || /[.,]/.test(key) || value > 31;
      if (!meaningful || isLikelyListMarker(line, token) || supported.has(key)) continue;
      unsupported.add(key);
    }
  }
  return [...unsupported];
}

export function runDeterministicChecks({ turn, response, answer, sources }) {
  const issues = [...operationIssues(response?.operations, turn.operations || "none")];
  const checks = turn.checks || {};
  const extraNumbers = checks.noUnsupportedNumbers ? unsupportedNumbers(answer, sources) : [];
  const extraEmails = checks.noEmail ? emailsNotInSources(answer, sources) : [];
  if (extraNumbers.length) issues.push(`unsupported_numbers:${extraNumbers.slice(0, 5).join(",")}`);
  if (extraEmails.length) issues.push(`invented_email:${extraEmails.slice(0, 3).join(",")}`);
  return issues;
}
