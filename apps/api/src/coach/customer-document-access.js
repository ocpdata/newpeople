import path from "node:path";
import { query } from "../db.js";
import { hasQuotationReadAccess } from "./quotation-read-service.js";
import { extractContentFromBuffer, getDocumentContentStream } from "../opportunity-documents/service.js";

export const CRM_DOCUMENT_SOURCES = ["opportunity_document", "quotation_document"];
const positive = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
const has = (user, permission) => user?.permissionSet?.has(permission);

async function authorize({ user, accountId, opportunityId, source, execute }) {
  if (!CRM_DOCUMENT_SOURCES.includes(source) || !positive(accountId) || !positive(opportunityId) ||
      !positive(user?.id)) {
    throw fail(400, "CUSTOMER_DOCUMENT_INVALID_SCOPE", "Identifica una cuenta y una oportunidad válidas.");
  }
  if ((!has(user, "cuentas.read") && !has(user, "cuentas.read_all")) ||
      (!has(user, "oportunidades.read") && !has(user, "oportunidades.read_all")) ||
      (source === "quotation_document" && !hasQuotationReadAccess(user))) {
    throw fail(403, "CUSTOMER_DOCUMENT_PERMISSION_DENIED", "Tu perfil no permite consultar estos documentos.");
  }
  const globalScope = has(user, "cuentas.read_all") && has(user, "oportunidades.read_all");
  const rows = await execute(
    `SELECT o.id, o.account_id
     FROM opportunities o
     INNER JOIN accounts a ON a.id = o.account_id
     INNER JOIN account_activation_statuses aas ON aas.id = a.activation_status_id
     WHERE o.id = ? AND a.id = ? AND aas.code = 'activada'
       AND (? = 1 OR EXISTS (
         SELECT 1 FROM account_owners ao WHERE ao.account_id = a.id AND ao.user_id = ?
       ))
     LIMIT 1`,
    [Number(opportunityId), Number(accountId), globalScope ? 1 : 0, Number(user.id)],
  );
  if (!rows.length) throw fail(404, "CUSTOMER_DOCUMENT_SCOPE_UNAVAILABLE",
    "La oportunidad ya no está disponible en la cuenta autorizada.");
}

async function versionFor({ source, quotationId, versionNumber, opportunityId, execute }) {
  if (source !== "quotation_document") return null;
  if (!positive(quotationId) || (versionNumber != null && !positive(versionNumber))) {
    throw fail(400, "CUSTOMER_DOCUMENT_INVALID_VERSION", "Selecciona una cotización y una versión válidas.");
  }
  const rows = await execute(
    `SELECT qv.id, qv.quotation_id, qv.version_number
     FROM quotations q
     INNER JOIN quotation_versions qv ON qv.quotation_id = q.id
       AND ${versionNumber == null ? "qv.id = q.latest_version_id" : "qv.version_number = ?"}
     WHERE q.id = ? AND q.opportunity_id = ? LIMIT 1`,
    [...(versionNumber == null ? [] : [Number(versionNumber)]), Number(quotationId), Number(opportunityId)],
  );
  if (!rows.length) throw fail(404, "CUSTOMER_DOCUMENT_VERSION_UNAVAILABLE",
    "No pude verificar la versión de cotización solicitada; no significa que no tenga documentos.");
  return rows[0];
}

function association(source, version, opportunityId) {
  return source === "quotation_document"
    ? { join: "quotation_version_documents link", predicate: "link.quotation_version_id = ?",
      id: Number(version.id), ai: "link.ai_enabled" }
    : { join: "opportunity_document_links link", predicate: "link.opportunity_id = ?",
      id: Number(opportunityId), ai: "1" };
}

function metadata(row, source, version) {
  return {
    documentId: Number(row.id), name: String(row.original_file_name || "Documento").slice(0, 300),
    source, aiEnabled: Number(row.ai_enabled) === 1,
    extractionStatus: row.extraction_status || "pending",
    processingStatus: row.processing_status || "pending",
    ...(version ? { quotationId: Number(version.quotation_id), versionId: Number(version.id),
      versionNumber: Number(version.version_number) } : {}),
  };
}

export async function listCustomerCrmDocuments(options) {
  const { source, opportunityId, documentReference = "", documentIds, execute = query } = options;
  if (typeof documentReference !== "string" || documentReference.length > 300) {
    throw fail(400, "CUSTOMER_DOCUMENT_INVALID_REFERENCE", "El nombre del documento no es válido.");
  }
  if (documentIds !== undefined && (!Array.isArray(documentIds) || !documentIds.length ||
      documentIds.length > 50 || documentIds.some((id) => !positive(id)))) {
    throw fail(400, "CUSTOMER_DOCUMENT_INVALID_ID", "La lista documental anterior no es válida.");
  }
  await authorize({ ...options, execute });
  const version = await versionFor({ ...options, execute });
  const link = association(source, version, opportunityId);
  const rows = await execute(
    `SELECT DISTINCT d.id, d.original_file_name, d.processing_status,
            dc.extraction_status, ${link.ai} AS ai_enabled
     FROM ${link.join}
     INNER JOIN documents d ON d.id = link.document_id
     LEFT JOIN document_contents dc ON dc.document_id = d.id
     WHERE ${link.predicate} AND COALESCE(d.is_deleted, 0) = 0
       ${documentReference ? "AND d.original_file_name = ?" : ""}
       ${documentIds ? `AND d.id IN (${documentIds.map(() => "?").join(", ")})` : ""}
     ORDER BY d.id DESC LIMIT 51`, [link.id, ...(documentReference ? [documentReference] : []),
      ...(documentIds ? documentIds.map(Number) : [])],
  );
  return { candidates: rows.slice(0, 50).map((row) => metadata(row, source, version)),
    truncated: rows.length > 50, version: version ? {
      quotationId: Number(version.quotation_id), versionId: Number(version.id),
      versionNumber: Number(version.version_number),
    } : null };
}

export async function readCustomerCrmDocument(options) {
  const { source, opportunityId, documentId, execute = query, signal,
    openContent = getDocumentContentStream, extract = extractContentFromBuffer } = options;
  if (!positive(documentId)) throw fail(400, "CUSTOMER_DOCUMENT_INVALID_ID", "Selecciona un documento válido.");
  signal?.throwIfAborted();
  await authorize({ ...options, execute });
  const version = await versionFor({ ...options, execute });
  const link = association(source, version, opportunityId);
  const rows = await execute(
    `SELECT d.id, d.public_id, d.original_file_name, d.mime_type, d.file_extension,
            d.byte_size, d.processing_status, dc.extraction_status, dc.transcription_status,
            dc.normalized_text, dc.raw_text, dc.transcript_text, dc.content_summary,
            ${link.ai} AS ai_enabled
     FROM ${link.join}
     INNER JOIN documents d ON d.id = link.document_id
     LEFT JOIN document_contents dc ON dc.document_id = d.id
     WHERE ${link.predicate} AND d.id = ? AND COALESCE(d.is_deleted, 0) = 0
       AND ${link.ai} = 1 LIMIT 1`, [link.id, Number(documentId)],
  );
  const row = rows[0];
  if (!row) throw fail(404, "CUSTOMER_DOCUMENT_UNAVAILABLE",
    "El documento ya no está disponible o no está habilitado para IA. Selecciona una fuente autorizada.");
  const info = metadata(row, source, version);
  let text = "", kind = "extracted_text";
  let completed = row.extraction_status === "completed" || row.transcription_status === "completed";
  if (completed) {
    text = row.transcript_text || row.normalized_text || row.raw_text || "";
  }
  if (!String(text).trim() && row.content_summary) {
    text = row.content_summary;
    kind = "summary";
  }
  if (!String(text).trim() && source === "quotation_document" && row.processing_status === "uploaded") {
    // Quotation uploads do not enqueue extraction. Only local text parsers run here.
    const extension = `.${String(row.file_extension || path.extname(row.original_file_name).slice(1)).replace(/^\./, "").toLowerCase()}`;
    if (![".txt", ".md", ".pdf", ".docx", ".eml", ".csv", ".xlsx", ".xls"].includes(extension)) {
      return { ...info, status: "extraction_required", text: "",
        message: "El archivo requiere extracción previa; el chat no inicia OCR ni transcripción automáticamente." };
    }
    const maxBytes = 8 * 1024 * 1024;
    if (Number(row.byte_size) > maxBytes) return { ...info, status: "size_limit", text: "",
      message: "El archivo supera el límite de lectura local de 8 MiB." };
    const { stream } = await openContent({ documentPublicId: row.public_id });
    const abort = () => stream.destroy(signal.reason);
    signal?.addEventListener("abort", abort, { once: true });
    const chunks = [];
    let bytes = 0;
    try {
      signal?.throwIfAborted();
      for await (const chunk of stream) {
        signal?.throwIfAborted();
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > maxBytes) throw fail(413, "CUSTOMER_DOCUMENT_SIZE_LIMIT", "El archivo supera el límite de lectura de 8 MiB.");
        chunks.push(buffer);
      }
      const result = await extract({ buffer: Buffer.concat(chunks), mimeType: row.mime_type,
        fileName: row.original_file_name, extension });
      signal?.throwIfAborted();
      if (result.extractionStatus === "completed") {
        completed = true;
        text = result.normalizedText || result.rawText || "";
      }
    } catch (error) {
      if (signal?.aborted || error.code === "CUSTOMER_DOCUMENT_SIZE_LIMIT") throw error;
      console.error("[customer-document] Local extraction failed", {
        code: "CUSTOMER_DOCUMENT_EXTRACTION_FAILED", documentId: Number(documentId), source,
      });
      throw fail(502, "CUSTOMER_DOCUMENT_EXTRACTION_FAILED",
        "No pude extraer texto del archivo solicitado. No se interpreta como un documento vacío.");
    } finally {
      signal?.removeEventListener("abort", abort);
      stream.destroy();
    }
  }
  if (!String(text).trim()) {
    const failed = row.extraction_status === "failed" || row.processing_status === "failed";
    return { ...info, status: failed ? "extraction_failed" : completed ? "no_readable_text" : "not_ready", text: "",
      message: failed ? "La extracción del archivo falló; no se pudo leer su contenido."
        : completed ? "La extracción terminó sin texto legible; no demuestra que el archivo original esté vacío."
          : "El contenido está pendiente de procesamiento y todavía no puede consultarse." };
  }
  const originalLength = text.length;
  return { ...info, status: "ready", kind, text: text.slice(0, 12000), originalLength,
    availableLength: Math.min(originalLength, 12000), partial: true };
}
