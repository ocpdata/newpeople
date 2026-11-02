import { collectGroundingSources } from "./answer-grounding.js";

// Gives every read of the turn, and every record inside a list, a stable ID the model can cite and the code can check.
// "e3" is the whole read; "e3.2" is the second record of that read.

const MAX_RECORD_IDS_PER_READ = 40;

const READ_LABELS = {
  getSellerPerformance: "Ritmo comercial",
  getSellerAgenda: "Agenda del vendedor",
  getSellerClosedDeals: "Oportunidades cerradas",
  getSellerTrend: "Tendencia semanal",
  getSellerSnapshots: "Historial semanal",
  getSellerCommission: "Comisiones",
  getSellerQuotations: "Cotizaciones del vendedor",
  getSellerPipeline: "Pipeline",
  getLibraryMaterials: "Biblioteca de ventas",
  getOpportunity: "Oportunidad",
  getOpportunityActivities: "Actividades de la oportunidad",
  getOpportunityNotes: "Notas de la oportunidad",
  getOpportunityQuotation: "Cotización de la oportunidad",
  getOpportunityReadiness: "Preparación de etapa",
  searchOpportunities: "Oportunidades",
  searchAccounts: "Cuentas",
  searchContacts: "Contactos",
  searchLeads: "Leads",
};

const SOURCE_BY_TOOL = [
  [/quotation/i, "quotation"],
  [/activit/i, "activity"],
  [/opportunit|pipeline/i, "opportunity"],
  [/account/i, "account"],
  [/contact/i, "contact"],
  [/lead/i, "lead"],
];

const sourceTypeFor = (toolName) =>
  SOURCE_BY_TOOL.find(([pattern]) => pattern.test(toolName))?.[1] || "crm_context";

const recordLabel = (record) =>
  String(record.name || record.title || record.fullName || record.accountName || record.id || "Registro").slice(0, 160);

function recordDetail(record) {
  return [
    record.stageName,
    record.amountUsd !== undefined && record.amountUsd !== null && `${Number(record.amountUsd).toLocaleString("en-US")} USD`,
    record.accountName,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function indexCoachEvidence(evidence = []) {
  const entries = new Map();
  let sequence = 0;
  const indexed = evidence.map((item) => {
    if (!item || item.error || item.result === null || item.result === undefined) return item;
    sequence += 1;
    const readId = `e${sequence}`;
    entries.set(readId, {
      id: readId,
      toolName: item.toolName,
      sourceType: sourceTypeFor(item.toolName),
      recordId: null,
      label: READ_LABELS[item.toolName] || item.toolName,
      detail: Array.isArray(item.result) ? `${item.result.length} registro(s)` : "",
      content: item,
    });
    if (!Array.isArray(item.result)) return { evidenceId: readId, ...item };
    const records = item.result.map((record, position) => {
      if (position >= MAX_RECORD_IDS_PER_READ || !record || typeof record !== "object") return record;
      const id = `${readId}.${position + 1}`;
      entries.set(id, {
        id,
        toolName: item.toolName,
        sourceType: sourceTypeFor(item.toolName),
        recordId: Number(record.id) > 0 ? Number(record.id) : null,
        label: recordLabel(record),
        detail: recordDetail(record),
        content: record,
      });
      return { evidenceId: id, ...record };
    });
    return { evidenceId: readId, ...item, result: records };
  });
  return { indexed, entries };
}

// Numbers, dates and text of an entry, computed once because claims cite the same entries repeatedly.
export function entryFacts(entry) {
  if (!entry.facts) entry.facts = collectGroundingSources([entry.content]);
  return entry.facts;
}

const normalizeText = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function entryText(entry) {
  if (entry.text === undefined) {
    let raw = "";
    try {
      raw = JSON.stringify(entry.content, (_key, value) => (value instanceof Date ? value.toISOString() : value));
    } catch {
      raw = "";
    }
    entry.text = ` ${normalizeText(raw)} `;
  }
  return entry.text;
}

export function describeEntry(entry) {
  return {
    evidenceId: entry.id,
    sourceType: entry.sourceType,
    sourceId: entry.recordId,
    label: entry.label,
    detail: entry.detail || null,
  };
}

export { normalizeText as normalizeEvidenceText };
