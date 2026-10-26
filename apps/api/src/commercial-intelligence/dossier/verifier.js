import { indexDossierEvidence } from "./opportunity-dossier.js";

const COMPLETE = new Set(["loaded", "empty"]);
const PERSON_FIELDS = ["sellerName", "presalesName", "ownerName", "authorName", "answeredBy", "performedBy", "contactName"];
const STATUS_FIELDS = ["status", "statusCode", "statusName", "stageName", "stageCode", "commercialStatusCode",
  "commercialStatusName", "activationCode"];
const plain = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ")
  .trim().toLowerCase();

function valueMatches(value, item) {
  if (value.type === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value.value)) return { ok: false, code: "VALUE_FORMAT" };
    const ok = Object.entries(item).some(([key, field]) => /(Date|At)$/.test(key) && typeof field === "string" &&
      field.startsWith(value.value));
    return { ok };
  }
  if (value.type === "amount") {
    const number = Number(String(value.value).replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(number)) return { ok: false, code: "VALUE_FORMAT" };
    return { ok: item.amountUsd !== undefined && item.amountUsd !== null && Math.abs(Number(item.amountUsd) - number) < 0.005 };
  }
  if (value.type === "status") {
    return { ok: STATUS_FIELDS.some((key) => item[key] !== undefined && item[key] !== null && plain(item[key]) === plain(value.value)) };
  }
  const names = [...PERSON_FIELDS.map((key) => item[key]), [item.firstName, item.lastName].filter(Boolean).join(" ")]
    .filter(Boolean).map(plain);
  return { ok: plain(value.value).length >= 3 && names.some((name) => name.includes(plain(value.value)) || plain(value.value).includes(name)) };
}

const EVIDENCE_TOKEN = /[a-z]+\d+(?:\.\d+)?/gi;
// Internal vocabulary and record IDs must never reach the seller.
const INTERNAL_TERMS = /\bexpedientes?\b|\bevidence(?:Id|Ids)?\b|\bsectionKeys?\b|\b(?:opp|acct|contact|ans|act|cal|qv|quote|note|po|doc|int|audit|aint|stk|wk|crit|dlv|strat|thm|reg|regr|prop|pdoc|camp|qitem|qterms|att|lib)\d+\b|\bdtext\d+x\d+\b/i;
export const BRIEF_MAX_CHARS = 1100;

export function buildEvidenceIndex(dossiers) {
  const index = new Map();
  for (const dossier of dossiers) {
    for (const [id, item] of indexDossierEvidence(dossier)) index.set(id, item);
  }
  return index;
}

/**
 * The model sometimes appends stray tokens to an ID ("opp94 trunc") or glues two IDs together.
 * Keeps only tokens that exactly match an existing record ID; anything else stays unknown.
 */
export function normalizeAnalysisEvidence(analysis, index) {
  let repaired = 0;
  const blocks = analysis.blocks.map((block) => ({
    ...block,
    claims: block.claims.map((claim) => {
      const ids = [];
      for (const raw of claim.evidenceIds) {
        const value = String(raw).trim();
        if (index.has(value)) { ids.push(value); continue; }
        const tokens = (value.match(EVIDENCE_TOKEN) || []).filter((token) => index.has(token));
        if (tokens.length) { repaired += 1; ids.push(...tokens); } else ids.push(value);
      }
      return { ...claim, evidenceIds: [...new Set(ids)] };
    }),
  }));
  return { analysis: { ...analysis, blocks }, repaired };
}

function aggregateMatches(value, items) {
  const number = Number(String(value.value).replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(number)) return { ok: false, code: "VALUE_FORMAT" };
  const distinct = [...new Map(items.map((item) => [item.evidenceId, item])).values()];
  if (value.type === "count") return { ok: distinct.length === number };
  const amounts = distinct.filter((item) => item.amountUsd !== undefined && item.amountUsd !== null);
  const total = amounts.reduce((sum, item) => sum + Number(item.amountUsd), 0);
  return { ok: amounts.length === distinct.length && Math.abs(total - number) < 0.01 };
}

export const CALCULATION_OPERATIONS = ["none", "difference", "ratio", "percent_change", "add_months", "add_days",
  "order_desc", "order_asc"];
export const CALCULATION_FIELDS = ["none", "amountUsd", "closeDate"];

function shiftDay(day, { months = 0, days = 0 }) {
  const [year, month, date] = day.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date, lastDay) + days);
  return target.toISOString().slice(0, 10);
}

/** Recomputes a declared calculation from the cited records, in the order they were cited. */
export function checkCalculation(calculation, items) {
  const { operation, field } = calculation;
  if (!calculation || operation === "none") return { ok: true };
  if (field === "none" || !items.length) return { ok: false, detail: "El cálculo no indica el campo o los registros de entrada." };
  const values = items.map((item) => item[field]);
  if (values.some((value) => value === null || value === undefined || value === "")) {
    return { ok: false, detail: `Algún registro citado no tiene ${field}.` };
  }
  const number = (value) => Number(String(value).replace(/[^\d.-]/g, ""));
  const parameter = number(calculation.parameter);
  const result = String(calculation.result || "").trim();
  const sameNumber = (expected, tolerance = 0.01) => Number.isFinite(number(result)) && Math.abs(number(result) - expected) <= tolerance;
  if (operation === "order_desc" || operation === "order_asc") {
    const keys = values.map((value) => (field === "amountUsd" ? number(value) : String(value)));
    const sorted = keys.every((key, index) => index === 0 ||
      (operation === "order_desc" ? keys[index - 1] >= key : keys[index - 1] <= key));
    return sorted ? { ok: true } : { ok: false, detail: `Los registros citados no están ordenados por ${field} (${operation}).` };
  }
  if (field === "closeDate") {
    if (!["add_months", "add_days"].includes(operation) || items.length !== 1 || !Number.isInteger(parameter)) {
      return { ok: false, detail: "Con fechas solo se admite desplazar una fecha por meses o días enteros." };
    }
    const expected = shiftDay(String(values[0]).slice(0, 10), operation === "add_months" ? { months: parameter } : { days: parameter });
    return result === expected ? { ok: true } : { ok: false, detail: `El resultado debería ser ${expected}.` };
  }
  const amounts = values.map(number);
  if (operation === "difference" && amounts.length === 2) {
    const expected = Math.abs(amounts[0] - amounts[1]);
    return sameNumber(expected) || sameNumber(-expected) ? { ok: true } : { ok: false, detail: `La diferencia es ${expected}.` };
  }
  if (operation === "ratio" && amounts.length === 2 && amounts.every(Boolean)) {
    const options = [amounts[0] / amounts[1], amounts[1] / amounts[0]];
    return options.some((expected) => sameNumber(expected, Math.max(0.01, expected * 0.005)))
      ? { ok: true } : { ok: false, detail: `La proporción es ${options.map((value) => value.toFixed(2)).join(" o ")}.` };
  }
  if (operation === "percent_change" && amounts.length === 1 && Number.isFinite(parameter)) {
    const expected = amounts[0] * (1 + parameter / 100);
    return sameNumber(expected) ? { ok: true } : { ok: false, detail: `Aplicar ${parameter} % da ${expected}.` };
  }
  return { ok: false, detail: `No se puede comprobar ${operation} con ${items.length} registros de ${field}.` };
}

export function presentationIssues({ answerText, responseLength = "standard" }) {
  const issues = [];
  if (INTERNAL_TERMS.test(answerText)) {
    issues.push({ code: "INTERNAL_TERMS", obligationId: null,
      detail: "La respuesta usa términos internos (expediente o identificadores de registros). Usa «registros del CRM» y nombres legibles." });
  }
  if (responseLength === "brief") {
    if (answerText.trim().length > BRIEF_MAX_CHARS) {
      issues.push({ code: "TOO_LONG_FOR_BRIEF", obligationId: null,
        detail: `El vendedor pidió algo breve: la respuesta tiene ${answerText.trim().length} caracteres y el máximo es ${BRIEF_MAX_CHARS}.` });
    }
    if (/^\s*#{1,6}\s/m.test(answerText)) {
      issues.push({ code: "HEADINGS_IN_BRIEF", obligationId: null, detail: "Una respuesta breve no lleva títulos." });
    }
  }
  return issues;
}

export function sectionsByKey(dossiers) {
  const map = new Map();
  for (const dossier of dossiers) {
    for (const section of Object.values(dossier.sections)) map.set(section.key, [...(map.get(section.key) || []), section]);
  }
  return map;
}

/** Checks the evidence, absences and values of claims; shared by the analyst and the composer. */
export function verifyClaims({ claims, obligationId, index, sections, fail, cited }) {
  for (const claim of claims) {
    const missing = claim.evidenceIds.filter((id) => !index.has(id));
    if (missing.length) fail("UNKNOWN_EVIDENCE", obligationId, `Evidencia inexistente: ${missing.join(", ")}.`, claim);
    const items = claim.evidenceIds.filter((id) => index.has(id)).map((id) => index.get(id));
    items.forEach((item) => cited.add(item.evidenceId));
    if (["registered", "absence"].includes(claim.kind) && !claim.evidenceIds.length && !claim.sectionKeys.length) {
      fail("MISSING_EVIDENCE", obligationId, "Una afirmación registrada o de ausencia debe citar evidencia.", claim);
    }
    if (claim.kind === "absence") {
      if (!claim.sectionKeys.length) {
        fail("ABSENCE_WITHOUT_SECTION", obligationId, "Una ausencia debe indicar las secciones revisadas.", claim);
      }
      for (const key of claim.sectionKeys) {
        const found = sections.get(key) || [];
        if (!found.length) fail("ABSENCE_UNKNOWN_SECTION", obligationId, `La sección ${key} no está en los expedientes.`, claim);
        const incomplete = found.filter((section) => !COMPLETE.has(section.status));
        if (incomplete.length) {
          fail("ABSENCE_INCOMPLETE_SECTION", obligationId,
            `La sección ${key} está ${incomplete.map((section) => section.status).join("/")}; no permite afirmar ausencia.`, claim);
        }
      }
    }
    if (claim.calculation && claim.calculation.operation !== "none") {
      const checked = checkCalculation(claim.calculation, items);
      if (!checked.ok) fail("CALCULATION_MISMATCH", obligationId, `Cálculo no verificable: ${checked.detail}`, claim);
    }
    for (const value of claim.values) {
      if (["count", "amount_total"].includes(value.type)) {
        const result = items.length ? aggregateMatches(value, items) : { ok: false };
        if (result.code) fail("VALUE_FORMAT", obligationId, `Formato no válido para ${value.type}: ${value.value}.`, claim);
        else if (!result.ok) {
          fail("AGGREGATE_MISMATCH", obligationId,
            `El valor ${value.type}=${value.value} no coincide con los registros citados; cita exactamente los registros que suman o cuentas.`, claim);
        }
        continue;
      }
      if (!items.length) {
        fail("VALUE_WITHOUT_EVIDENCE", obligationId, `El valor ${value.value} no cita un registro.`, claim);
        continue;
      }
      const results = items.map((item) => valueMatches(value, item));
      if (results.some((result) => result.code === "VALUE_FORMAT")) {
        fail("VALUE_FORMAT", obligationId, `Formato no válido para ${value.type}: ${value.value}.`, claim);
      } else if (!results.some((result) => result.ok)) {
        fail("VALUE_MISMATCH", obligationId, `El valor ${value.type}=${value.value} no coincide con la evidencia citada.`, claim);
      }
    }
  }
}

export function verifyAnalysis({ analysis, obligations, dossiers, responseLength = "standard" }) {
  const index = buildEvidenceIndex(dossiers);
  const sections = sectionsByKey(dossiers);
  const failures = [];
  const fail = (code, obligationId, detail, claim = null) => failures.push({
    code, obligationId, detail, ...(claim ? { claim: claim.text.slice(0, 300) } : {}),
  });
  if (!analysis.answerText.trim()) fail("EMPTY_ANSWER", null, "La respuesta final está vacía.");
  const cited = new Set();
  for (const obligation of obligations) {
    const block = analysis.blocks.find((item) => item.obligationId === obligation.id);
    if (block.status !== "answered" && !block.reason.trim()) {
      fail("MISSING_REASON", obligation.id, "Un bloque parcial o sin respuesta debe explicar el motivo.");
    }
    if (block.status !== "cannot_answer" && !block.claims.length) {
      fail("MISSING_CLAIMS", obligation.id, "El bloque no contiene afirmaciones que respalden la respuesta.");
    }
    if (obligation.form === "exact_items" && block.status !== "cannot_answer") {
      const items = block.items.filter((item) => item.text.trim());
      if (items.length !== obligation.count) {
        fail("ITEM_COUNT", obligation.id, `Se pidieron ${obligation.count} puntos y hay ${items.length}.`);
      }
      if (obligation.itemsNeedConfirmation && items.some((item) => !item.confirmation.trim())) {
        fail("MISSING_CONFIRMATION", obligation.id, "Cada punto debe incluir su confirmación concreta.");
      }
    }
    verifyClaims({ claims: block.claims, obligationId: obligation.id, index, sections, fail, cited });
  }
  const presentation = presentationIssues({ answerText: analysis.answerText, responseLength });
  return { ok: failures.length === 0, failures, presentationIssues: presentation, citedEvidenceIds: [...cited] };
}
