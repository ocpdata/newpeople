// "Volviendo a la primera" or "regresemos a la anterior" point at an entity discussed earlier in the same
// conversation. The session keeps the context of every message, so the server can restore it deterministically.

const CONTEXT_KEYS = ["accountId", "opportunityId", "contactId", "leadId", "quotationId", "proposalId"];
const RETURN_VERB = /\b(volviendo|volvamos|volver|regresando|regresemos|regresar|retomando|retomemos|retomar)\b/;
const FIRST = /\b(primera|primero|inicial|original)\b/;
const PREVIOUS = /\b(anterior|otra|otro|pasada|pasado)\b/;

const normalize = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const cleanContext = (context) => Object.fromEntries(
  CONTEXT_KEYS.map((key) => [key, Number(context?.[key] || 0) || null]),
);
const signature = (context) => JSON.stringify(CONTEXT_KEYS.map((key) => Number(context?.[key] || 0) || null));
const hasEntity = (context) => CONTEXT_KEYS.some((key) => Number(context?.[key] || 0) > 0);

// Returns the earlier context the seller is going back to, or null when the question is not a back reference or the
// conversation has no different entity to return to.
export function resolveCoachBackReference({ question, messages = [], current = {} } = {}) {
  const text = normalize(question);
  if (!RETURN_VERB.test(text)) return null;
  const wantsFirst = FIRST.test(text);
  const wantsPrevious = PREVIOUS.test(text);
  if (!wantsFirst && !wantsPrevious) return null;
  const seen = new Map();
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!hasEntity(message?.context)) continue;
    const context = cleanContext(message.context);
    seen.set(signature(context), context);
  }
  const entities = [...seen.values()];
  const currentSignature = signature(current);
  const target = wantsFirst
    ? entities[0]
    : [...entities].reverse().find((entity) => signature(entity) !== currentSignature);
  return target && signature(target) !== currentSignature ? target : null;
}
