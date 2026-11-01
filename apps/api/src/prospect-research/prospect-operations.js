import { normalizeProspectConversionOperation } from "../coach/operation-contract.js";

// Conversion proposals for the Cuenta nueva chat. They are built by the server from the session and the seller's
// explicit request; the model never proposes them. A query turn (profile, findings, contacts...) never carries operations.

const normalize = (value) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase();

const tokensOf = (value) => normalize(value).split(/[^a-z0-9]+/).filter((token) => token.length > 2);

// A person is named when every significant word of their name appears in the request.
function mentionsPerson(normalizedQuestion, name) {
  const tokens = tokensOf(name);
  if (!tokens.length) return false;
  const words = new Set(normalizedQuestion.split(/[^a-z0-9]+/));
  return tokens.every((token) => words.has(token));
}

function mentionsHypothesis(normalizedQuestion, hypothesis) {
  const tokens = tokensOf(hypothesis.title).filter((token) => token.length > 3);
  if (tokens.length < 2) return false;
  const words = new Set(normalizedQuestion.split(/[^a-z0-9]+/));
  return tokens.filter((token) => words.has(token)).length >= Math.min(2, tokens.length);
}

// Operation evidence in the shared contract only admits CRM record references, so the source goes in the notes.
const withSource = (note, source) => (String(source ?? "").trim() ? `${note} Fuente: ${String(source).trim()}.` : note);

export function resolveConversionAction({ question, snapshot }) {
  const text = normalize(question);
  const company = snapshot?.profile?.companyName || "el prospecto";
  const contacts = Array.isArray(snapshot?.contacts) ? snapshot.contacts : [];
  const hypotheses = Array.isArray(snapshot?.hypotheses) ? snapshot.hypotheses : [];

  const namedContacts = contacts.filter((contact) => mentionsPerson(text, contact.name));
  if (namedContacts.length === 1) {
    const [contact] = namedContacts;
    return {
      title: `Crear el contacto ${contact.name} en el CRM`,
      target: "contact",
      actionType: "conversion",
      notes: withSource("Persona identificada en una fuente pública; confirma sus datos antes de crearla.", contact.sourceTitle),
      successCriteria: "Contacto creado tras la confirmación del vendedor.",
    };
  }
  if (namedContacts.length > 1 || /\bcontactos?\b/.test(text)) return null;

  if (/\boportunidad(?:es)?\b/.test(text)) {
    const named = hypotheses.filter((hypothesis) => mentionsHypothesis(text, hypothesis));
    const hypothesis = named.length === 1 ? named[0] : hypotheses.length === 1 ? hypotheses[0] : null;
    if (!hypothesis) return null;
    return {
      title: `Crear una oportunidad desde la hipótesis: ${hypothesis.title}`,
      target: "opportunity",
      actionType: "conversion",
      notes: withSource("Es una hipótesis por validar; requiere elegir un contacto de la sesión y la confirmación del vendedor.", hypothesis.sourceTitle),
      successCriteria: "Oportunidad creada tras la confirmación del vendedor.",
    };
  }

  return {
    title: `Convertir el prospecto ${company} en cuenta del CRM`,
    target: "account",
    actionType: "conversion",
    notes: "Se revisan posibles cuentas duplicadas antes de confirmar.",
    successCriteria: "Cuenta creada tras la confirmación del vendedor.",
  };
}

// Only a conversion request produces a proposal, and at most one.
export function buildProspectRecommendedActions({ intent, question, snapshot }) {
  if (intent !== "conversion_request") return [];
  const action = resolveConversionAction({ question, snapshot });
  return action ? [action] : [];
}

const PROSPECT_CONVERSION_TARGETS = new Set([
  "account",
  "contact",
  "opportunity",
]);

export function normalizeProspectRecommendedActions(actions = []) {
  if (!Array.isArray(actions)) return [];
  return actions
    .filter((action) => {
      const target = String(action?.target || "")
        .trim()
        .toLowerCase();
      const actionType = String(action?.actionType || "")
        .trim()
        .toLowerCase();
      return (
        PROSPECT_CONVERSION_TARGETS.has(target) &&
        ["convert", "conversion", "create"].includes(actionType)
      );
    })
    .map((action) => ({
      ...action,
      target: String(action.target).trim().toLowerCase(),
      requiresConfirmation: true,
    }));
}

export function buildProspectOperations(actions, prospectSessionId) {
  return actions.map((action) =>
    normalizeProspectConversionOperation(action, { prospectSessionId, target: action.target || "account" }),
  );
}
