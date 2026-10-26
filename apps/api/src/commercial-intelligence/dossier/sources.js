import { listCustomerCrmDocuments, readCustomerCrmDocument } from "../../coach/customer-document-access.js";
import { retrieveCustomerChatDocumentKnowledge } from "../../documentacion-rag/service.js";
import { buildSection } from "./opportunity-dossier.js";
import { FAILED_MEANING, MEANINGS, RESTRICTED_MEANING } from "./semantics.js";

// Sources the dossier loads only when a task of the turn needs them (migration phase D, design §4.3):
// quotation content, the attached file, CRM document text and the document library.

const FRAGMENT_CHARS = 1500;
const DOCUMENT_BUDGET_CHARS = 12000;
const MAX_DOCUMENTS = 3;
const MAX_QUOTATIONS_PER_OPPORTUNITY = 3;
const PRICE_FIELDS = new Set(["prices", "discounts", "costs", "margins"]);

/** Which sources the plan needs, decided only from task types, kinds and materials. */
export function sourcesNeeded(plan, { hasAttachment = false } = {}) {
  const tasks = plan?.tasks || [];
  const excluded = (source) => tasks.length > 0 && tasks.every((task) => task.constraints.excludedSources.includes(source));
  const needs = (predicate) => tasks.some(predicate);
  return {
    quotationContent: !excluded("quotation") && needs((task) => task.type === "document" && task.kind === "quotation"),
    attachment: hasAttachment || needs((task) => (task.type === "document" && task.kind === "attachment") ||
      task.material === "attachment"),
    crmDocuments: needs((task) => task.type === "document" && task.kind === "crm_document"),
    library: !excluded("library") && needs((task) => (task.type === "document" && task.kind === "library") ||
      task.material === "library"),
    hidePrices: tasks.some((task) => task.constraints.excludedFields.some((field) => PRICE_FIELDS.has(field))),
  };
}

function fragments(text, prefix, budget = Infinity) {
  const items = [];
  const available = String(text || "").slice(0, budget);
  for (let offset = 0, n = 1; offset < available.length; offset += FRAGMENT_CHARS, n += 1) {
    items.push({ n, text: available.slice(offset, offset + FRAGMENT_CHARS) });
  }
  return { items, truncated: String(text || "").length > available.length, prefix };
}

function quotationContentSection({ opportunityDossiers, run, allowed, hidePrices, opportunityIds }) {
  const versions = opportunityDossiers
    .filter((dossier) => !opportunityIds.length || opportunityIds.includes(dossier.opportunity.id))
    .flatMap((dossier) => (dossier.sections.quotations?.items || [])
      .filter((quotation) => !quotation.activationCode || quotation.activationCode === "activada")
      .slice(0, MAX_QUOTATIONS_PER_OPPORTUNITY)
      .map((quotation) => ({ opportunity: dossier.opportunity, quotation,
        version: quotation.versions.find((version) => version.isLatest) }))
      .filter((entry) => entry.version));
  return buildSection({
    key: "quotationContent", allowed,
    load: async (limit) => {
      if (!versions.length) return [];
      const versionIds = versions.map((entry) => entry.version.source.id);
      const terms = await run(
        `SELECT v.id, v.currency_code, v.delivery_time, v.quotation_validity, v.warranty_term, v.payment_terms,
                v.summary_vat_mode, v.summary_vat_pct
         FROM quotation_versions v WHERE v.id IN (?)`, [versionIds]);
      const items = await run(
        `SELECT i.id, s.quotation_version_id, s.title AS section_title, sit.name AS inclusion_name,
                i.product_code, i.product_description, i.item_type, i.is_renewal, i.quantity,
                i.original_currency_code, i.list_price_unit, i.final_discount_pct
         FROM quotation_sections s
         INNER JOIN quotation_section_inclusion_types sit ON sit.id = s.inclusion_type_id
         INNER JOIN quotation_activation_statuses sas ON sas.id = s.activation_status_id
         INNER JOIN quotation_section_items i ON i.quotation_section_id = s.id
         WHERE s.quotation_version_id IN (?) AND sas.code = 'activada'
         ORDER BY s.quotation_version_id, s.display_order, s.id, i.display_order, i.id
         LIMIT ?`, [versionIds, limit]);
      return [
        ...terms.map((row) => ({ kind: "terms", row })),
        ...items.map((row) => ({ kind: "item", row })),
      ];
    },
    map: ({ kind, row }) => {
      const entry = versions.find((item) => item.version.source.id === Number(kind === "terms" ? row.id : row.quotation_version_id));
      const origin = { quotationId: entry.quotation.source.id, quotationEvidenceId: entry.quotation.evidenceId,
        versionEvidenceId: entry.version.evidenceId, versionNumber: entry.version.versionNumber,
        opportunityId: entry.opportunity.id, opportunityName: entry.opportunity.name };
      if (kind === "terms") {
        return { evidenceId: `qterms${row.id}`, source: { table: "quotation_versions", id: Number(row.id) }, ...origin,
          currencyCode: row.currency_code || null, deliveryTime: row.delivery_time || null,
          validity: row.quotation_validity || null, warranty: row.warranty_term || null,
          paymentTerms: row.payment_terms || null,
          vat: row.summary_vat_mode ? `${row.summary_vat_mode}${row.summary_vat_pct == null ? "" : ` ${row.summary_vat_pct}%`}` : null,
          meanings: { terms: MEANINGS.quotationTerms } };
      }
      return { evidenceId: `qitem${row.id}`, source: { table: "quotation_section_items", id: Number(row.id) }, ...origin,
        sectionTitle: row.section_title || null, inclusion: row.inclusion_name || null,
        productCode: row.product_code || null, description: String(row.product_description || "").slice(0, 1000),
        itemType: row.item_type || null, isRenewal: Boolean(row.is_renewal),
        quantity: row.quantity == null ? null : Number(row.quantity),
        ...(hidePrices ? {} : {
          currencyCode: row.original_currency_code || null,
          listPriceUnit: row.list_price_unit == null ? null : String(row.list_price_unit),
          discountPct: row.final_discount_pct == null ? null : String(row.final_discount_pct),
        }),
        meanings: { item: MEANINGS.quotationItem } };
    },
  });
}

function attachmentSection(attachment) {
  const text = String(attachment?.text || "");
  const split = fragments(text, "att");
  return {
    key: "attachment", title: "Archivo adjunto al mensaje",
    ...(!text.trim()
      ? { status: "empty", total: 0, items: [], meaning: "El vendedor no adjuntó un archivo legible en este mensaje." }
      : { status: attachment.coverage === "partial" || attachment.truncated ? "truncated" : "loaded",
        total: split.items.length, fileName: attachment.name || null,
        ...(attachment.coverage === "partial" || attachment.truncated
          ? { meaning: "Solo se pudo leer una parte del archivo; no afirmes nada sobre el resto." } : {}),
        items: split.items.map((item) => ({ evidenceId: `att${item.n}`, source: { table: "chat_attachment", id: item.n },
          fileName: attachment.name || null, text: item.text, meanings: { text: MEANINGS.attachment } })) }),
  };
}

async function crmDocumentSection({ user, accountId, opportunityDossiers, opportunityIds, allowed,
  list = listCustomerCrmDocuments, read = readCustomerCrmDocument, signal }) {
  const base = { key: "crmDocumentContent", title: "Contenido de documentos del CRM" };
  if (!allowed) return { ...base, status: "restricted", total: null, items: [], meaning: RESTRICTED_MEANING };
  const targets = opportunityDossiers.filter((dossier) => !opportunityIds.length || opportunityIds.includes(dossier.opportunity.id));
  if (!targets.length) {
    return { ...base, status: "empty", total: 0, items: [],
      meaning: "No se identificó una oportunidad cuyos documentos leer; indica de qué oportunidad es el documento." };
  }
  const items = [];
  const notes = [];
  let partial = false;
  try {
    for (const dossier of targets) {
      const options = { user, accountId, opportunityId: dossier.opportunity.id, source: "opportunity_document", signal };
      const listing = await list(options);
      const readable = listing.candidates.filter((item) => item.aiEnabled);
      if (listing.truncated || readable.length > MAX_DOCUMENTS) partial = true;
      const budget = Math.floor(DOCUMENT_BUDGET_CHARS / Math.max(1, Math.min(readable.length, MAX_DOCUMENTS)));
      for (const candidate of readable.slice(0, MAX_DOCUMENTS)) {
        const document = await read({ ...options, documentId: candidate.documentId });
        if (document.status !== "ready") {
          partial = true;
          notes.push(`${candidate.name}: ${document.message}`);
          continue;
        }
        const split = fragments(document.text, "dtext", budget);
        if (split.truncated) partial = true;
        items.push(...split.items.map((item) => ({
          evidenceId: `dtext${candidate.documentId}x${item.n}`, source: { table: "documents", id: candidate.documentId },
          documentEvidenceId: `doc${candidate.documentId}`, fileName: candidate.name, opportunityId: dossier.opportunity.id,
          contentKind: document.kind || null, text: item.text, meanings: { text: MEANINGS.crmDocumentText },
        })));
      }
      for (const candidate of listing.candidates.filter((item) => !item.aiEnabled)) {
        notes.push(`${candidate.name}: excluido del uso con IA; no se leyó.`);
      }
    }
  } catch (error) {
    console.error("[dossier] CRM document read failed", { errorCode: String(error?.code || error?.name || "Error").slice(0, 80) });
    return { ...base, status: "failed", total: null, items, errorCode: String(error?.code || "Error").slice(0, 80),
      meaning: FAILED_MEANING };
  }
  const status = !items.length && !notes.length ? "empty" : partial || notes.length ? "truncated" : "loaded";
  return { ...base, status, total: items.length, items, ...(notes.length ? { readingNotes: notes } : {}),
    ...(status === "empty" ? { meaning: "La oportunidad no tiene documentos habilitados para IA con texto legible." }
      : status === "truncated" ? { meaning: "Lectura parcial: hay documentos o partes no leídos; no afirmes nada sobre ellos." } : {}) };
}

/**
 * Quotations named only by number ("la cotización 18") belong to an opportunity the plan did not name.
 * Returns the visible account opportunities of those quotations so their dossiers (and content) are read.
 */
export async function quotationOpportunityIds({ plan, run, visibleOpportunityIds }) {
  const numbers = [...new Set((plan?.tasks || [])
    .filter((task) => task.type === "document" && task.kind === "quotation" && !task.opportunityIds.length)
    .flatMap((task) => [...`${task.evidence} ${task.ask}`.matchAll(/cotizaci[oó]n\s*(?:n[uú]m(?:ero)?\.?\s*|#\s*)?(\d{1,9})\b/giu)]
      .map((match) => Number(match[1]))))].slice(0, 3);
  if (!numbers.length || !visibleOpportunityIds.length) return [];
  const rows = await run(
    "SELECT DISTINCT q.opportunity_id FROM quotations q WHERE q.id IN (?) AND q.opportunity_id IN (?)",
    [numbers, visibleOpportunityIds]);
  return rows.map((row) => Number(row.opportunity_id));
}

/** Library query without account or opportunity names, so retrieval targets general product knowledge. */
export function libraryQuery(plan, names = []) {
  let text = (plan?.tasks || []).filter((task) => task.material === "library" || task.kind === "library")
    .map((task) => task.ask).join(". ");
  for (const name of names.filter((value) => String(value || "").length >= 3)) {
    text = text.replace(new RegExp(String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu"), " ");
  }
  return text.replace(/\s+/g, " ").trim().slice(0, 1200) || "conocimiento comercial general";
}

async function librarySection({ query, userId = null, retrieve = retrieveCustomerChatDocumentKnowledge }) {
  const base = { key: "library", title: "Biblioteca documental (conocimiento general)" };
  try {
    const result = await retrieve({ prompt: query, userId });
    if (result.status === "not_configured") {
      return { ...base, status: "restricted", total: null, items: [], meaning: "La biblioteca documental no está configurada." };
    }
    if (result.status === "disabled") {
      return { ...base, status: "restricted", total: null, items: [],
        meaning: "La biblioteca documental está desactivada para Cliente existente en la configuración de IA." };
    }
    const items = result.snippets.map((snippet, index) => ({
      evidenceId: `lib${index + 1}`, source: { table: "documentacion_rag", id: index + 1 },
      text: snippet.content, score: snippet.score, meanings: { text: MEANINGS.library },
    }));
    return items.length
      ? { ...base, status: "loaded", total: items.length, items, query }
      : { ...base, status: "empty", total: 0, items, query,
        meaning: "La biblioteca no devolvió fragmentos para esta consulta; no acredita que el tema no exista." };
  } catch (error) {
    console.error("[dossier] Library retrieval failed", { errorCode: String(error?.code || error?.name || "Error").slice(0, 80),
      errorMessage: String(error?.message || "").slice(0, 200) });
    return { ...base, status: "failed", total: null, items: [], errorCode: String(error?.code || "Error").slice(0, 80),
      meaning: "Falló la consulta a la biblioteca; no se puede tratar como ausencia de información." };
  }
}

/**
 * Builds the turn-sources dossier. It shares the evidence index, verification and source trace of the CRM
 * dossiers, so every fragment the answer uses is cited and checked by code.
 */
export async function buildTurnSourcesDossier({ plan, user, accountDossier, opportunityDossiers, permissions, attachment,
  run, signal, retrieveLibrary, listDocuments, readDocument }) {
  const needed = sourcesNeeded(plan, { hasAttachment: Boolean(attachment?.text) });
  const idsFor = (predicate) => [...new Set((plan?.tasks || []).filter(predicate).flatMap((task) => task.opportunityIds))];
  const sections = {};
  if (needed.quotationContent) {
    sections.quotationContent = await quotationContentSection({ opportunityDossiers, run, allowed: permissions.quotations,
      hidePrices: needed.hidePrices, opportunityIds: idsFor((task) => task.type === "document" && task.kind === "quotation") });
  }
  if (needed.attachment) sections.attachment = attachmentSection(attachment);
  if (needed.crmDocuments) {
    sections.crmDocumentContent = await crmDocumentSection({ user, accountId: accountDossier.account.id, opportunityDossiers,
      opportunityIds: idsFor((task) => task.kind === "crm_document"), allowed: permissions.documents, signal,
      ...(listDocuments ? { list: listDocuments } : {}), ...(readDocument ? { read: readDocument } : {}) });
  }
  if (needed.library) {
    const names = [accountDossier.account.name, ...opportunityDossiers.map((dossier) => dossier.opportunity.name)];
    sections.library = await librarySection({ query: libraryQuery(plan, names), userId: user?.id,
      ...(retrieveLibrary ? { retrieve: retrieveLibrary } : {}) });
  }
  if (!Object.keys(sections).length) return null;
  return { kind: "sources", account: accountDossier.account, sections, size: JSON.stringify(sections).length };
}
