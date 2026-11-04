import { verifyAnswerValues } from "../coach/answer-grounding.js";
import { unknownNames } from "../coach/claim-verifier.js";

// Checks, without the model, that what a Cuenta nueva answer states as data exists in the session the seller owns:
// emails, links, figures and dates, and names of people or companies. A statement that is not in the session may be a
// recommendation, so this never judges tone or advice; it only catches data the seller could act on by mistake.

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const LINK = /https?:\/\/[^\s)>\]"'«»]+/gi;
const MAX_ISSUES = 8;

// Words that are capitalized by the structure of the answer (headings, roles, areas), not because they name someone.
const STRUCTURE_VOCABULARY = [
  "apertura", "preguntas", "descubrimiento", "cierre", "objeciones", "objecion", "respuesta", "respuestas", "siguiente",
  "paso", "pasos", "plan", "resumen", "asunto", "correo", "validar", "validacion", "hipotesis", "hallazgos", "hallazgo",
  "contactos", "contacto", "evidencia", "fuente", "fuentes", "prospecto", "prospeccion", "angulo", "llamada", "reunion",
  "guion", "borrador", "prioridad", "recomendacion", "accion", "hoy", "despues", "falta", "datos", "sesion", "por", "que",
  "director", "directora", "gerente", "jefe", "jefa", "ti", "ot", "it", "crm", "tu", "nombre", "estimado", "estimada",
  "hola", "saludos", "cordiales", "cordial", "atentamente", "gracias", "nota", "importante", "primero", "segundo",
  "tercero", "ahora", "contexto", "tema", "propuesta", "ejemplo", "opcion", "opciones", "mensaje", "idea", "ideas",
  "biblioteca", "ventas", "material", "materiales", "presentacion", "folleto", "caso", "casos", "uso", "exito", "cliente",
  "clientes", "similar", "similares", "interno", "interna", "cuenta", "cuentas", "comercial",
].join(" ");

const normalizeText = (value) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase();

const clean = (token) => token.replace(/[.,;:)\]}>]+$/, "").replace(/\/$/, "");

// Name detection works on plain sentences: markdown emphasis, list markers and parentheses would otherwise glue the
// capitalized words of neighboring lines or asides into one false name.
function plainSentences(text) {
  return String(text)
    .split("\n")
    .map((line) => line
      .replace(/^[\s>*#•-]+/, "")
      .replace(/^\d+[.)]\s+/, "")
      .replace(/[*_`#]+/g, "")
      .replace(/[()[\]{}]/g, ". ")
      .trim())
    .filter(Boolean)
    .map((line) => (/[.!?:;]$/.test(line) ? line : `${line}.`))
    .join("\n");
}

// Name detection relies on Spanish capitalization (sentence case); in another language it would flag every heading.
function isMostlySpanish(text) {
  const normalized = normalizeText(text);
  const english = (normalized.match(/\b(the|and|your|with|for|dear|our|this|that|you|we|is|are)\b/g) || []).length;
  const spanish = (normalized.match(/\b(el|la|los|las|de|que|para|con|una|un|y|en|es|por)\b/g) || []).length;
  return spanish >= english;
}

function sourceTexts({ snapshot, question, history }) {
  return [
    JSON.stringify(snapshot ?? {}),
    String(question ?? ""),
    ...(Array.isArray(history) ? history : []).map((message) => String(message?.text ?? "")),
  ];
}

// Returns the data the answer states that the session does not contain. `issues` is empty when nothing was found.
export function verifyProspectAnswer({ answer, inferences = [], snapshot, question = "", history = [] }) {
  const texts = [String(answer ?? ""), ...(Array.isArray(inferences) ? inferences : []).map((item) => String(item ?? ""))]
    .filter((text) => text.trim());
  const sources = sourceTexts({ snapshot, question, history });
  const haystack = normalizeText(sources.join("\n"));
  const issues = [];
  const seen = new Set();
  const add = (kind, text) => {
    const key = `${kind}:${normalizeText(text)}`;
    if (!seen.has(key) && issues.length < MAX_ISSUES) {
      seen.add(key);
      issues.push({ kind, text });
    }
  };

  for (const text of texts) {
    for (const email of text.match(EMAIL) || []) {
      if (!haystack.includes(normalizeText(email))) add("email", email);
    }
    for (const link of (text.match(LINK) || []).map(clean)) {
      if (!haystack.includes(normalizeText(link))) add("link", link);
    }
  }
  const values = verifyAnswerValues({ texts, sources });
  for (const item of values.ungrounded) add(item.kind, item.text);
  const joined = texts.join("\n");
  if (isMostlySpanish(joined)) {
    const names = unknownNames({ answer: plainSentences(joined), haystack: `${sources.join("\n")}\n${STRUCTURE_VOCABULARY}` });
    for (const name of names) add("name", name);
  }
  return { issues, checked: values.checked };
}

const sentencesOf = (line) => line.split(/(?<=[.!?])\s+/);

// Keeps the useful part of an answer when the data could not be repaired: drops only the sentences that carry it.
export function removeUnsupportedData(answer, issues) {
  const needles = issues.map((issue) => normalizeText(issue.text)).filter(Boolean);
  if (!needles.length) return String(answer ?? "");
  const kept = String(answer ?? "").split("\n").map((line) => {
    if (!needles.some((needle) => normalizeText(line).includes(needle))) return line;
    return sentencesOf(line).filter((sentence) => !needles.some((needle) => normalizeText(sentence).includes(needle))).join(" ");
  });
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function prospectVerificationEnabled(env = process.env) {
  return String(env.PROSPECT_ANSWER_VERIFICATION ?? "true").toLowerCase() !== "false";
}

export const UNSUPPORTED_DATA_NOTE = "Nota: retiré de la respuesta datos que no están en la sesión de prospección.";
const MIN_USEFUL_ANSWER = 60;

const issueKinds = (issues) => [...new Set(issues.map((issue) => issue.kind))];

// Verifies a model answer; when it states data the session does not have, asks the model once to rewrite it without
// that data and, if it still does, removes the offending sentences instead of delivering them.
export async function verifyAndRepairAnswer({ result, snapshot, question, history, repair, fallbackAnswer }) {
  const check = (candidate) => verifyProspectAnswer({
    answer: candidate.answer, inferences: candidate.inferences, snapshot, question, history,
  });
  const first = check(result);
  if (!first.issues.length) {
    return { result, verification: { status: "clean", checked: first.checked, issueCount: 0, issueKinds: [] } };
  }
  let repaired = null;
  try {
    repaired = await repair({ previousAnswer: result.answer, issues: first.issues });
  } catch {
    repaired = null;
  }
  const second = repaired?.answer ? check(repaired) : null;
  if (second && !second.issues.length) {
    return {
      result: repaired,
      verification: { status: "repaired", checked: second.checked, issueCount: first.issues.length, issueKinds: issueKinds(first.issues) },
    };
  }
  const base = second ? repaired : result;
  const remaining = second || first;
  const stripped = removeUnsupportedData(base.answer, remaining.issues);
  const removedSomething = stripped !== String(base.answer ?? "").trim();
  const needles = remaining.issues.map((issue) => normalizeText(issue.text));
  const inferences = (Array.isArray(base.inferences) ? base.inferences : [])
    .filter((item) => !needles.some((needle) => normalizeText(item).includes(needle)));
  return {
    result: {
      ...base,
      answer: stripped.length < MIN_USEFUL_ANSWER ? fallbackAnswer : removedSomething ? `${stripped}\n\n${UNSUPPORTED_DATA_NOTE}` : stripped,
      inferences,
    },
    verification: { status: "degraded", checked: remaining.checked, issueCount: remaining.issues.length, issueKinds: issueKinds(remaining.issues) },
  };
}
