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

export function verifyAnalysis({ analysis, obligations, dossiers }) {
  const index = new Map();
  for (const dossier of dossiers) {
    for (const [id, item] of indexDossierEvidence(dossier)) index.set(id, item);
  }
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
  return { ok: failures.length === 0, failures, citedEvidenceIds: [...cited] };
}
