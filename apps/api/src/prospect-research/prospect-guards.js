import { CONVERSION_DISABLED_ANSWER, conversionBlock, duplicatesAnswer } from "./prospect-crm-context.js";
import { buildProspectOperations, normalizeProspectRecommendedActions, resolveConversionAction } from "./prospect-operations.js";

// Turns the Cuenta nueva chat answers itself, without the model, because the answer is a fact about the session or
// a rule of the channel: an empty session, a request outside its scope, a web search, or a CRM conversion.
// Everything else goes to the model. The detectors are deliberately narrow: a missed turn only costs a model call,
// a false positive replaces a good answer.

const normalize = (value) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase();

const CONVERSION_VERB = /\b(convierte|convertir|convierta|convertirlo|convertirla|crea|crear|creame|creale|pasa|pasalo|pasala|registra|registrar|registralo|da de alta|dalo de alta|dala de alta|dar de alta|alta)\b/;
const CONVERSION_TARGET = /\b(cuenta|contacto|oportunidad|lead|prospecto)\b/;
const CREATIVE_OBJECT = /\b(correo|email|mail|mensaje|borrador|resumen|lista|tabla|plan|guion|texto|pregunta|preguntas|agenda|briefing)\b/;
const CRM_MENTION = /\b(?:en|del|de mi|de) (?:el |mi )?crm\b/;
const CRM_CONSULT_OBJECT = /\b(oportunidades?|cotizaciones?|actividades|interacciones|pipeline|leads?|cuenta|cuentas)\b/;
const EXISTENCE_CHECK = /\b(ya existe|existe ya|esta registrad[oa]|ya esta registrad[oa]|duplicad[oa]s?|ya es cliente|ya tenemos)\b/;
const WEB_VERB = /\b(busca|buscar|buscame|investiga|investigar|consulta|averigua|revisa)\b/;
const WEB_OBJECT = /\b(internet|web|en linea|google|ultimas noticias|noticias nuevas|noticias recientes|redes sociales)\b/;
const LANGUAGE_INSTRUCTION = /\b(en ingles|in english|english|en frances|en portugues)\b/;

const isCreative = (text) => /\b(redacta|redactame|escribe|escribeme|prepara|preparame|genera|dame un|hazme)\b/.test(text) && CREATIVE_OBJECT.test(text);

function emptyCategory(text, snapshot) {
  if (isCreative(text)) return null;
  const hasEvidence = (snapshot.findings || []).length || (snapshot.externalResearch?.evidence || []).length;
  if (/\bhipotesis\b/.test(text) && !(snapshot.hypotheses || []).length) return { key: "hypotheses", label: "hipótesis de oportunidad" };
  if (/\b(contactos?|decisores?)\b/.test(text) && !(snapshot.contacts || []).length) return { key: "contacts", label: "contactos potenciales" };
  if (/\b(hallazgos?|noticias|novedades)\b/.test(text) && !(snapshot.findings || []).length) return { key: "findings", label: "hallazgos" };
  if (/\b(evidencia|fuentes)\b/.test(text) && /\bpublic[ao]s?\b/.test(text) && !hasEvidence) return { key: "evidence", label: "evidencia pública" };
  return null;
}

const savedEvidenceLines = (snapshot) => (snapshot.findings || []).slice(0, 5).map((finding) => {
  const published = finding.metadata?.sourcePublishedAt || finding.sourcePublishedAt;
  return `- ${finding.title}${published ? ` (${String(published).slice(0, 10)})` : ""}`;
});

function conversionAnswer({ text, snapshot, action }) {
  const company = snapshot.profile?.companyName || "el prospecto";
  const none = "Todavía no se creó ningún registro en el CRM; la acción requiere tu confirmación.";
  if (action?.target === "contact") {
    return `Propongo crear en el CRM el contacto ${action.title.replace(/^Crear el contacto /, "").replace(/ en el CRM$/, "")}. Es una persona identificada en una fuente pública, no un contacto confirmado: confirma sus datos antes de crearla. ${none}`;
  }
  if (action?.target === "opportunity") {
    return `Propongo crear una oportunidad desde la hipótesis «${action.title.replace(/^Crear una oportunidad desde la hipótesis: /, "")}». Sigue siendo una hipótesis por validar y requiere elegir un contacto de la sesión. ${none}`;
  }
  if (action?.target === "account") {
    return `Propongo convertir el prospecto ${company} en cuenta del CRM. Antes de confirmar se revisan posibles cuentas duplicadas y decides si usar una existente o crear una nueva. ${none}`;
  }
  if (/\bcontacto\b/.test(text)) {
    const names = (snapshot.contacts || []).map((contact) => contact.name).filter(Boolean);
    return names.length
      ? `No identifiqué a qué contacto de la sesión te refieres, o la persona no aparece entre ellos. No puedo proponer crear un contacto con datos que no están en la sesión. Contactos disponibles: ${names.join(", ")}. ${none}`
      : `La sesión no tiene contactos potenciales registrados, así que no hay ninguno que proponer crear. Usa «Investigar fuentes públicas» para identificarlos. ${none}`;
  }
  if (/\boportunidad\b/.test(text)) {
    const titles = (snapshot.hypotheses || []).map((hypothesis) => hypothesis.title).filter(Boolean);
    return titles.length
      ? `Para crear una oportunidad necesito saber desde qué hipótesis y con qué contacto de la sesión. Hipótesis disponibles: ${titles.join("; ")}. Una oportunidad nace de una hipótesis por validar y requiere tu confirmación. ${none}`
      : `La sesión no tiene hipótesis de oportunidad registradas, así que no hay desde qué crear una oportunidad. ${none}`;
  }
  return `La conversión a lead se hace desde las acciones de la ficha del prospecto, con su propia revisión y confirmación. ${none}`;
}

// Returns { kind, answer, operationsIntent } or null when the model should answer.
export function detectGuardedTurn({ question, snapshot, history = [] }) {
  const text = normalize(question);
  if (history.some((turn) => turn.role === "user" && LANGUAGE_INSTRUCTION.test(normalize(turn.text)))) return null;
  const company = snapshot.profile?.companyName || "el prospecto";

  if (EXISTENCE_CHECK.test(text) && CRM_MENTION.test(text)) {
    if (snapshot.crm) return { kind: "existence_check", answer: duplicatesAnswer(company, snapshot.crm) };
    return {
      kind: "existence_check",
      answer: `Desde esta sesión no puedo confirmar si ${company} ya existe en el CRM. La revisión de posibles cuentas duplicadas se hace al convertir el prospecto en cuenta y ahí decides si usar una existente o crear una nueva.`,
    };
  }
  if (CONVERSION_VERB.test(text) && CONVERSION_TARGET.test(text) && !CREATIVE_OBJECT.test(text) && !/\bcuenta de correo\b/.test(text)) {
    const action = /\blead\b/.test(text) ? null : resolveConversionAction({ question, snapshot });
    const block = conversionBlock(snapshot.crm, action ? action.target : "account");
    if (block?.reason === "disabled") return { kind: "conversion_blocked", answer: CONVERSION_DISABLED_ANSWER };
    if (block?.reason === "duplicates") return { kind: "conversion_blocked", answer: duplicatesAnswer(company, snapshot.crm) };
    return { kind: "conversion", answer: conversionAnswer({ text, snapshot, action }), action };
  }
  if (CRM_MENTION.test(text) && CRM_CONSULT_OBJECT.test(text) && !isCreative(text)) {
    return {
      kind: "out_of_scope",
      answer: `Este chat trabaja solo con la sesión de prospección de ${company}; no consulta cuentas, oportunidades ni otros registros del CRM. Para consultar una cuenta del CRM usa Cliente existente.`,
    };
  }
  if (WEB_VERB.test(text) && WEB_OBJECT.test(text)) {
    const saved = savedEvidenceLines(snapshot);
    return {
      kind: "web_search",
      answer: `Este chat no realiza búsquedas nuevas; trabaja con la evidencia ya guardada en la sesión de ${company}. Para actualizarla usa «Investigar fuentes públicas».${saved.length ? `\n\nEvidencia guardada:\n${saved.join("\n")}` : " Todavía no hay evidencia guardada."}`,
    };
  }
  const empty = emptyCategory(text, snapshot);
  if (empty) {
    return {
      kind: "empty_data",
      answer: `La sesión de ${company} no contiene ${empty.label} registrados todavía. No puedo inventarlos: usa «Investigar fuentes públicas» para obtenerlos.`,
    };
  }
  return null;
}

// Builds the same response shape the engine returns, so the job pipeline stores and renders it unchanged.
export function buildGuardedProspectTurn({ question, snapshot, history = [], sessionId, normalizeResponse }) {
  const startedAt = Date.now();
  const guarded = detectGuardedTurn({ question, snapshot, history });
  if (!guarded) return null;
  const base = normalizeResponse({ answer: guarded.answer, evidence: [], inferences: [], confidence: "high" },
    { ...snapshot, channelIntentRouting: { intent: "prospect_guard" } }, question, { prospectSessionId: sessionId });
  const recommendedActions = normalizeProspectRecommendedActions(guarded.action ? [guarded.action] : []);
  const response = {
    ...base,
    recommendedActions,
    operations: buildProspectOperations(recommendedActions, sessionId),
    responseType: "informational",
    channel: "prospect",
  };
  return {
    response,
    qualityTrace: {
      process: "prospect_chat",
      intentType: "prospect_guard",
      intentSubtype: guarded.kind,
      validationStatus: "valid",
      validationReasons: [],
      responseType: "informational",
      confidence: "high",
      evidenceCount: 0,
      operationsProposed: response.operations.length,
      latencyMs: Date.now() - startedAt,
      diagnostics: { guard: guarded.kind },
    },
  };
}
