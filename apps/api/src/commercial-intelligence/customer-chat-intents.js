import { matchCoachQueryCase } from "../coach/case-catalog.js";
import { normalize } from "./customer-chat-records.js";

const CUSTOMER_NOTE_COMMAND_PREFIX =
  /^\s*(?:por favor\s+)?(?:guarda|guardar|registra|registrar|anota|anotar|agrega|agregar|añade|anade|pon|poner)(?:me)?\s+(?:como\s+)?(?:(?:esta|la|una)\s+)?nota\b/i;

const CUSTOMER_NOTE_WITH_CONTENT =
  /^\s*(?:por favor\s+)?(?:guarda|guardar|registra|registrar|anota|anotar|agrega|agregar|añade|anade|pon|poner)(?:me)?\s+(?:como\s+)?(?:(?:esta|la|una)\s+)?nota(?:\s+(?:en|para)\s+[\s\S]*?)?\s*(?:que|:)\s+([\s\S]+?)\s*$/i;

export function extractCustomerNoteText(value) {
  const text = String(value || "").trim();
  const content = text.match(CUSTOMER_NOTE_WITH_CONTENT)?.[1]?.trim();
  if (content) return content.replace(/^["'“”‘’]|["'“”‘’]$/g, "").trim();
  return CUSTOMER_NOTE_COMMAND_PREFIX.test(text) ? "" : text;
}

export function isCustomerActivityClarificationReply(
  question,
  pendingActivityIntent,
) {
  const normalized = normalize(question).trim();
  if (
    !pendingActivityIntent ||
    !normalized ||
    normalized.length > 240 ||
    /\b(?:cancela|cancelar|descarta|descartar|olvida|olvidalo|otra pregunta|cambiando de tema)\b/.test(
      normalized,
    ) ||
    /\b(?:consulta|consultar|muestra|mostrar|lista|listar|busca|buscar|resume|resumen|analiza|redacta|redactar|cuanto|quien|que actividades|que riesgos|que contiene)\b/.test(
      normalized,
    )
  ) {
    return false;
  }
  return true;
}

function isExplicitCustomerActivityRequest(question) {
  return /\b(?:agenda|agendar|agendame|crear|crea|creame|programa|programar|prepara|preparar|coordina|coordinar|registra|registrar)\b/.test(
    normalize(question),
  );
}

export function normalizeCustomerActivityQueryPlan(question, plan) {
  if (
    !plan ||
    matchCoachQueryCase(question)?.type !== "activity_query" ||
    isExplicitCustomerActivityRequest(question)
  ) {
    return plan;
  }
  return {
    ...plan,
    queries: ["account_activity_history"],
    mode: "read_only",
    operationKind: "none",
    activityDraft: { ...plan.activityDraft, action: "none" },
  };
}
