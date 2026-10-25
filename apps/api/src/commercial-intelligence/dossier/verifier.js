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
const INTERNAL_TERMS = /\bexpedientes?\b|\bevidence(?:Id|Ids)?\b|\bsectionKeys?\b|\b(?:opp|acct|contact|ans|act|cal|qv|quote|note|po|doc|int|audit)\d+\b/i;
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

export function verifyAnalysis({ analysis, obligations, dossiers, responseLength = "standard" }) {
  const index = buildEvidenceIndex(dossiers);
  const sectionsByKey = new Map();
  for (const dossier of dossiers) {
    for (const section of Object.values(dossier.sections)) {
      sectionsByKey.set(section.key, [...(sectionsByKey.get(section.key) || []), section]);
    }
  }
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
    for (const claim of block.claims) {
      const missing = claim.evidenceIds.filter((id) => !index.has(id));
      if (missing.length) fail("UNKNOWN_EVIDENCE", obligation.id, `Evidencia inexistente: ${missing.join(", ")}.`, claim);
      const items = claim.evidenceIds.filter((id) => index.has(id)).map((id) => index.get(id));
      items.forEach((item) => cited.add(item.evidenceId));
      if (["registered", "absence"].includes(claim.kind) && !claim.evidenceIds.length && !claim.sectionKeys.length) {
        fail("MISSING_EVIDENCE", obligation.id, "Una afirmación registrada o de ausencia debe citar evidencia.", claim);
      }
      if (claim.kind === "absence") {
        if (!claim.sectionKeys.length) {
          fail("ABSENCE_WITHOUT_SECTION", obligation.id, "Una ausencia debe indicar las secciones revisadas.", claim);
        }
        for (const key of claim.sectionKeys) {
          const sections = sectionsByKey.get(key) || [];
          if (!sections.length) fail("ABSENCE_UNKNOWN_SECTION", obligation.id, `La sección ${key} no está en los expedientes.`, claim);
          const incomplete = sections.filter((section) => !COMPLETE.has(section.status));
          if (incomplete.length) {
            fail("ABSENCE_INCOMPLETE_SECTION", obligation.id,
              `La sección ${key} está ${incomplete.map((section) => section.status).join("/")}; no permite afirmar ausencia.`, claim);
          }
        }
      }
      for (const value of claim.values) {
        if (["count", "amount_total"].includes(value.type)) {
          const result = items.length ? aggregateMatches(value, items) : { ok: false };
          if (result.code) fail("VALUE_FORMAT", obligation.id, `Formato no válido para ${value.type}: ${value.value}.`, claim);
          else if (!result.ok) {
            fail("AGGREGATE_MISMATCH", obligation.id,
              `El valor ${value.type}=${value.value} no coincide con los registros citados; cita exactamente los registros que suman o cuentas.`, claim);
          }
          continue;
        }
        if (!items.length) {
          fail("VALUE_WITHOUT_EVIDENCE", obligation.id, `El valor ${value.value} no cita un registro.`, claim);
          continue;
        }
        const results = items.map((item) => valueMatches(value, item));
        if (results.some((result) => result.code === "VALUE_FORMAT")) {
          fail("VALUE_FORMAT", obligation.id, `Formato no válido para ${value.type}: ${value.value}.`, claim);
        } else if (!results.some((result) => result.ok)) {
          fail("VALUE_MISMATCH", obligation.id, `El valor ${value.type}=${value.value} no coincide con la evidencia citada.`, claim);
        }
      }
    }
  }
  const presentation = presentationIssues({ answerText: analysis.answerText, responseLength });
  return { ok: failures.length === 0, failures, presentationIssues: presentation, citedEvidenceIds: [...cited] };
}
