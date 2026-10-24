import { normalizeCustomerSearchText } from "./customer-record-list.js";
import { isCustomerActivityClarificationReply } from "./customer-chat-adapter.js";
import { localSchedule } from "../coach/customer-reschedule-time.js";

const MAX_REPLY_WORDS = 8;
const MAX_OPTIONS = 10;
const IGNORED_WORDS = new Set([
  "a", "al", "la", "el", "los", "las", "lo", "de", "del", "para", "en", "con", "y", "o", "u",
  "es", "esa", "ese", "esta", "este", "por", "favor", "que", "se", "un", "una", "sobre",
  "oportunidad", "oportunidades", "vinculala", "vincula", "asociala", "asocia", "usa", "usar",
]);

const words = (value) => normalizeCustomerSearchText(value).split(/[^a-z0-9]+/).filter(Boolean);

export function visibleCustomerOpportunities(snapshot) {
  const seen = new Set();
  return [...(snapshot?.opportunities || []), ...(snapshot?.inactiveOpportunities || [])]
    .filter((item) => {
      const id = Number(item?.id || 0);
      if (!id || seen.has(id) ||
          Number(item.accountId || snapshot?.account?.id) !== Number(snapshot?.account?.id)) return false;
      seen.add(id);
      return true;
    });
}

export function matchOpportunitiesByReply(reply, opportunities) {
  const text = normalizeCustomerSearchText(reply);
  const byFullName = opportunities.filter((item) => {
    const name = normalizeCustomerSearchText(item.name);
    return name && ` ${text} `.includes(` ${name} `);
  });
  if (byFullName.length === 1) return byFullName;
  const terms = words(reply).filter((word) => word.length >= 3 && !IGNORED_WORDS.has(word));
  if (!terms.length) return [];
  const scored = opportunities.map((item) => {
    const nameWords = words(item.name);
    const score = terms.filter((term) =>
      nameWords.some((word) => word === term || (term.length >= 4 && word.startsWith(term)))).length;
    return { item, score };
  });
  const best = Math.max(0, ...scored.map((entry) => entry.score));
  return best ? scored.filter((entry) => entry.score === best).map((entry) => entry.item) : [];
}

/**
 * Resolves a short reply to the chat's own "which opportunity?" question for a remembered
 * activity, without reinterpreting the reply as a new request. Returns null when the turn is
 * not such a reply, so the regular flow handles it.
 */
export function resolvePendingActivityTarget({ question, focusOpportunityId = null, conversationContext, snapshot }) {
  const intent = conversationContext?.pendingActivityIntent;
  if (!intent || conversationContext?.pendingActivity ||
      !["scheduled", "completed"].includes(intent.timing)) return null;
  const text = String(question || "").trim();
  if (!text || /[¿?]/.test(text) || words(text).length > MAX_REPLY_WORDS ||
      !isCustomerActivityClarificationReply(text, intent)) return null;
  const opportunities = visibleCustomerOpportunities(snapshot);
  if (!opportunities.length) return null;
  const matches = matchOpportunitiesByReply(text, opportunities);
  if (matches.length === 1) return { status: "resolved", opportunity: matches[0], intent };
  const focus = opportunities.find((item) => Number(item.id) === Number(focusOpportunityId || 0));
  if (!matches.length && focus) return { status: "resolved", opportunity: focus, intent };
  return { status: "ambiguous", candidates: (matches.length ? matches : opportunities).slice(0, MAX_OPTIONS), intent };
}

export function buildPendingActivityRouting(intent, opportunityId = null) {
  return {
    mode: "operation",
    intent: "crm_operation",
    intents: ["crm_operation"],
    operationKind: "activity",
    requiresClarification: false,
    ambiguity: { reason: "none", missingContext: [], clarificationQuestion: "", requiresClarification: false },
    referenceResolution: { source: "pending_activity_reply", targetType: "opportunity", cardinality: "single", candidateKeys: [] },
    entities: { opportunityReference: "", contactReference: "", accountReference: "", leadReference: "" },
    activityDraft: {
      action: "continue",
      actionType: intent.actionType || "call",
      timing: intent.timing,
      title: intent.title || "",
      notes: intent.notes || "",
      successCriteria: intent.successCriteria || "",
      temporalPreference: intent.temporalPreference || "",
      scheduledAt: "",
    },
    serverResolvedEntityIds: { opportunityId: opportunityId ? Number(opportunityId) : null, contactId: null, leadId: null },
  };
}

export function opportunityOptions(opportunities) {
  return opportunities.slice(0, MAX_OPTIONS).map((item) => ({
    id: Number(item.id),
    name: String(item.name || ""),
    stageName: item.stageName || item.salesStageName || null,
  }));
}

export function buildPendingActivityOptionsResponse(intent, candidates) {
  return {
    answer: "¿A cuál de estas oportunidades vinculo la actividad? Elige una opción o escribe su nombre.",
    responseType: "clarification",
    operations: [],
    evidence: [],
    inferences: [],
    pendingItems: ["Oportunidad"],
    recommendedActions: [],
    confidence: "high",
    activityIntent: intent,
    opportunityOptions: opportunityOptions(candidates),
  };
}

const WEEKDAYS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre",
  "octubre", "noviembre", "diciembre"];
const HOUR_WORDS = { una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12 };
const PERIOD = "(a\\.?\\s?m\\.?|p\\.?\\s?m\\.?|de la manana|de la tarde|de la noche|del mediodia)";
const MAX_SCHEDULE_REPLY_WORDS = 12;
const HISTORY_USER_MESSAGES = 6;

const pad = (value) => String(value).padStart(2, "0");
const isoDay = (date) => date.toISOString().slice(0, 10);

function shiftDays(today, days) {
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDay(date);
}

export function findDateInText(text, today, direction = "future") {
  const value = normalizeCustomerSearchText(text).replace(/\bde la (?:manana|tarde|noche)\b/g, " ");
  const iso = value.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const numeric = value.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (numeric) return `${numeric[3]}-${pad(numeric[2])}-${pad(numeric[1])}`;
  const named = value.match(new RegExp(`\\b(\\d{1,2}) de (${MONTHS.join("|")})(?: de (\\d{4}))?\\b`));
  if (named) {
    const year = Number(named[3] || today.slice(0, 4));
    let date = `${year}-${pad(MONTHS.indexOf(named[2]) + 1)}-${pad(named[1])}`;
    if (!named[3] && direction === "future" && date < today) date = `${year + 1}${date.slice(4)}`;
    if (!named[3] && direction === "past" && date > today) date = `${year - 1}${date.slice(4)}`;
    return date;
  }
  const relative = [["pasado manana", 2], ["anteayer", -2], ["antier", -2], ["manana", 1], ["hoy", 0], ["ayer", -1]]
    .find(([word]) => new RegExp(`\\b${word}\\b`).test(value));
  if (relative) return shiftDays(today, relative[1]);
  const weekday = value.match(new RegExp(`\\b(este |proximo |pasado )?(${WEEKDAYS.join("|")})\\b`));
  if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[2]);
    const current = new Date(`${today}T12:00:00Z`).getUTCDay();
    const saysPast = weekday[1] === "pasado " || new RegExp(`\\b${weekday[2]} pasado\\b`).test(value);
    if (direction === "past" || saysPast) return shiftDays(today, -(((current - target + 7) % 7) || 7));
    const ahead = (target - current + 7) % 7;
    return shiftDays(today, ahead === 0 && weekday[1] !== "este " ? 7 : ahead);
  }
  return null;
}

export function findTimeInText(text) {
  const value = normalizeCustomerSearchText(text);
  const hourToken = `(\\d{1,2}|${Object.keys(HOUR_WORDS).join("|")})`;
  const patterns = [
    new RegExp(`\\ba (?:las?|la) ${hourToken}(?::([0-5]\\d)| y (media|cuarto))?(?:\\s*(?:hrs?|horas))?\\s*${PERIOD}?`),
    new RegExp(`\\b(\\d{1,2}):([0-5]\\d)()\\s*${PERIOD}?`),
    new RegExp(`\\b(\\d{1,2})()()\\s*${PERIOD}`),
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (!match) continue;
    let hour = Number(HOUR_WORDS[match[1]] ?? match[1]);
    const minutes = match[2] ? Number(match[2]) : match[3] === "media" ? 30 : match[3] === "cuarto" ? 15 : 0;
    const period = String(match[4] || "").replace(/[\s.]/g, "");
    if (!Number.isInteger(hour) || hour > 23) continue;
    if (["pm", "dela tarde", "delatarde", "delanoche"].includes(period) && hour < 12) hour += 12;
    else if (["am", "delamanana"].includes(period) && hour === 12) hour = 0;
    else if (!period && hour >= 1 && hour <= 6) hour += 12;
    return `${pad(hour)}:${pad(minutes)}`;
  }
  return null;
}

function recentUserTexts(history) {
  return (Array.isArray(history) ? history : [])
    .filter((message) => message?.role === "user")
    .slice(-HISTORY_USER_MESSAGES)
    .reverse()
    .map((message) => String(message.text || "").split("\n\n")[0]);
}

/** Date and time stated for the activity in this reply or, when missing, in the recent conversation. */
export function resolveActivitySchedule({ question, history = [], direction = "future", timeZone, now = new Date() }) {
  const nowLocal = localSchedule(now, timeZone);
  if (!nowLocal) return { date: null, time: null };
  const today = nowLocal.slice(0, 10);
  const texts = [String(question || ""), ...recentUserTexts(history)];
  const date = texts.map((text) => findDateInText(text, today, direction)).find(Boolean) || null;
  const time = texts.map((text) => findTimeInText(text)).find(Boolean) || null;
  return { date, time, nowLocal: nowLocal.slice(0, 16) };
}

/**
 * Completes the date and time of an open activity draft from a short reply, instead of
 * reinterpreting the reply as a new request. Returns null when the turn is not such a reply.
 */
export function resolvePendingActivitySchedule({ question, history, conversationContext, timeZone, now = new Date() }) {
  const pending = conversationContext?.pendingActivity;
  const operation = pending?.operation;
  if (!operation || !Number(operation.opportunityId || 0)) return null;
  const complete = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(operation.scheduledAt || "")) &&
    !(operation.missingFields || []).includes("scheduledAt");
  if (complete) return null;
  const text = String(question || "").trim();
  if (!text || /[¿?]/.test(text) || words(text).length > MAX_SCHEDULE_REPLY_WORDS ||
      /\b(?:cancela|cancelar|descarta|descartar|olvida|olvidalo)\b/.test(normalizeCustomerSearchText(text))) return null;
  const direction = operation.status === "done" ? "past" : "future";
  const today = (localSchedule(now, timeZone) || "").slice(0, 10);
  if (!today || (!findDateInText(text, today, direction) && !findTimeInText(text))) return null;
  const { date, time, nowLocal } = resolveActivitySchedule({ question: text, history, direction, timeZone, now });
  const opportunityId = Number(operation.opportunityId);
  if (!date) return { status: "needs_date", opportunityId, operation };
  if (!time) return { status: "needs_time", opportunityId, operation, date };
  const scheduledAt = `${date}T${time}`;
  if (direction === "future" && scheduledAt <= nowLocal) return { status: "not_future", opportunityId, operation, scheduledAt };
  if (direction === "past" && scheduledAt > nowLocal) return { status: "not_past", opportunityId, operation, scheduledAt };
  return { status: "resolved", opportunityId, operation, scheduledAt };
}

export function buildPendingScheduleRouting(operation, scheduledAt) {
  const routing = buildPendingActivityRouting({
    actionType: operation.actionType || "call",
    timing: operation.status === "done" ? "completed" : "scheduled",
    title: operation.title || "",
    notes: operation.notes || "",
    successCriteria: operation.successCriteria || "",
    temporalPreference: "",
  }, operation.opportunityId);
  routing.activityDraft.scheduledAt = scheduledAt || "";
  if (!scheduledAt) routing.activityDraft.action = "none";
  return routing;
}

export function buildPendingScheduleClarification(resolution) {
  const answer = {
    needs_date: "¿Qué día quieres registrar la actividad? Indica la fecha; la hora ya la tengo.",
    needs_time: `¿A qué hora el ${resolution.date}? Indica la hora (por ejemplo, 10:00 o 4 de la tarde).`,
    not_future: `La fecha y hora ${String(resolution.scheduledAt || "").replace("T", " ")} ya pasaron. Indica una fecha y hora futuras para programar la actividad.`,
    not_past: `La fecha y hora ${String(resolution.scheduledAt || "").replace("T", " ")} aún no ocurren. Indica cuándo se realizó la actividad.`,
  }[resolution.status];
  return {
    answer, responseType: "clarification", operations: [], evidence: [], inferences: [],
    pendingItems: ["Fecha y hora"], recommendedActions: [], confidence: "high",
  };
}
