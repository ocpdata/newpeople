import { randomUUID } from "node:crypto";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { query } from "../db.js";
import { cleanupTempFiles, parseMultipartFiles } from "../opportunity-documents/service.js";
import { config } from "../config.js";
import { buildRagPublicId, ensureDocumentacionRagSchema } from "./schema.js";
import {
  deleteRagFile,
  describeRagOperation,
  generateRagDocumentSummary,
  isPineconeConfigured,
  retrieveRagContext,
  uploadRagFile,
} from "./pinecone.js";
import { importRagSourceUrl } from "./url-import.js";

const ALLOWED_EXTENSIONS = new Set([".docx", ".json", ".md", ".pdf", ".txt"]);
const MAX_FILE_SIZE_BYTES = Number(config.pinecone.maxFileBytes);
const refreshLocks = new Map();
let workerStarted = false;

function makeHttpError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}

function normalizeTopic(row) {
  return {
    id: String(row.public_id || ""),
    name: String(row.name || ""),
    description: String(row.description || ""),
    sortOrder: Number(row.sort_order || 0),
    isActive: Boolean(Number(row.is_active || 0)),
    documentCount: Number(row.document_count || 0),
  };
}

function normalizeDocument(row) {
  return {
    id: String(row.public_id || ""),
    topicId: String(row.topic_public_id || ""),
    topicName: String(row.topic_name || ""),
    fileName: String(row.original_file_name || ""),
    mimeType: String(row.mime_type || ""),
    byteSize: Number(row.byte_size || 0),
    sourceType: String(row.source_type || "upload"),
    sourceUrl: String(row.source_url || ""),
    status: String(row.status || "error"),
    summary: String(row.summary || ""),
    summaryStatus: String(row.summary_status || "pending"),
    summaryError: String(row.summary_error || ""),
    error: String(row.error_message || ""),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function loadDocument(documentPublicId) {
  const rows = await query(
    `SELECT d.*, t.public_id AS topic_public_id, t.name AS topic_name
     FROM documentacion_rag_documents d
     INNER JOIN documentacion_rag_topics t ON t.id = d.topic_id
     WHERE d.public_id = ?
     LIMIT 1`,
    [String(documentPublicId || "").trim()],
  );
  return rows[0] || null;
}

async function updateSummary(documentId) {
  const lockKey = `summary:${documentId}`;
  if (refreshLocks.has(lockKey)) return refreshLocks.get(lockKey);
  const promise = (async () => {
    const document = await loadDocument(documentId);
    if (
      !document ||
      document.status !== "available" ||
      document.summary_status !== "pending"
    ) {
      return;
    }

    const claim = await query(
      `UPDATE documentacion_rag_documents
       SET summary_status = 'processing', summary_error = NULL, updated_at = NOW(3)
       WHERE id = ? AND summary_status = 'pending'`,
      [Number(document.id)],
    );
    if (!claim?.affectedRows) return;
    try {
      const summary = await generateRagDocumentSummary({
        fileName: document.original_file_name,
        documentId: document.public_id,
        versionId: document.active_version_id,
      });
      if (!summary) {
        throw new Error("Pinecone no devolvió un resumen para el documento");
      }
      await query(
        `UPDATE documentacion_rag_documents
         SET summary = ?, summary_status = 'available', summary_error = NULL,
             updated_at = NOW(3)
         WHERE id = ?`,
        [summary, Number(document.id)],
      );
    } catch (error) {
      await query(
        `UPDATE documentacion_rag_documents
         SET summary_status = 'error', summary_error = ?, updated_at = NOW(3)
         WHERE id = ?`,
        [
          String(error?.message || "No fue posible generar el resumen").slice(0, 1000),
          Number(document.id),
        ],
      );
    }
  })().finally(() => refreshLocks.delete(lockKey));
  refreshLocks.set(lockKey, promise);
  return promise;
}

async function beginDelete(documentId, fileId) {
  if (!fileId) return null;
  const operation = await deleteRagFile(fileId);
  return String(operation?.id || "");
}

async function refreshDocument(document) {
  const lockKey = `document:${document.public_id}`;
  if (refreshLocks.has(lockKey)) return refreshLocks.get(lockKey);
  const promise = (async () => {
    let current = await loadDocument(document.public_id);
    if (!current) return;

    if (current.status === "deleting") {
      let fileIds = parseJson(current.delete_file_ids_json, []);
      if (current.delete_operation_id) {
        const operation = await describeRagOperation(current.delete_operation_id);
        const status = String(operation?.status || "");
        if (status === "Failed") {
          await query(
            `UPDATE documentacion_rag_documents
             SET status = 'error', error_message = ?, updated_at = NOW(3)
             WHERE id = ?`,
            [
              String(operation?.error_message || "Pinecone no pudo eliminar el documento").slice(0, 1000),
              Number(current.id),
            ],
          );
          return;
        }
        if (status !== "Completed") return;
        fileIds = fileIds.slice(1);
        await query(
          `UPDATE documentacion_rag_documents
           SET delete_operation_id = NULL, delete_file_ids_json = ?, updated_at = NOW(3)
           WHERE id = ?`,
          [JSON.stringify(fileIds), Number(current.id)],
        );
        current = await loadDocument(document.public_id);
      }

      fileIds = parseJson(current?.delete_file_ids_json, []);
      if (!fileIds.length) {
        await query(
          "DELETE FROM documentacion_rag_documents WHERE id = ?",
          [Number(current.id)],
        );
        return;
      }
      const [nextFileId, ...remaining] = fileIds;
      const operationId = await beginDelete(current.id, nextFileId);
      if (!operationId) {
        await query(
          `UPDATE documentacion_rag_documents
           SET delete_file_ids_json = ?, updated_at = NOW(3)
           WHERE id = ?`,
          [JSON.stringify(remaining), Number(current.id)],
        );
        current = await loadDocument(document.public_id);
        if (!remaining.length) {
          await query(
            "DELETE FROM documentacion_rag_documents WHERE id = ?",
            [Number(current.id)],
          );
        }
        return;
      }
      await query(
        `UPDATE documentacion_rag_documents
         SET delete_operation_id = ?, updated_at = NOW(3)
         WHERE id = ?`,
        [operationId, Number(current.id)],
      );
      return;
    }

    if (current.upload_operation_id) {
      const operation = await describeRagOperation(current.upload_operation_id);
      const status = String(operation?.status || "");
      if (status === "Failed") {
        const nextStatus = current.active_file_id ? "available" : "error";
        await query(
          `UPDATE documentacion_rag_documents
           SET status = ?, pending_file_id = NULL, pending_version_id = NULL,
               pending_file_name = NULL, pending_mime_type = NULL,
                 pending_byte_size = NULL, pending_source_type = NULL,
                 pending_source_url = NULL,
               upload_operation_id = NULL, error_message = ?, updated_at = NOW(3)
           WHERE id = ? AND upload_operation_id = ?`,
          [
            nextStatus,
            String(operation?.error_message || "Pinecone no pudo procesar el documento").slice(0, 1000),
            Number(current.id),
            String(current.upload_operation_id),
          ],
        );
        if (current.pending_file_id && !current.active_file_id) {
          try {
            await deleteRagFile(current.pending_file_id);
          } catch (cleanupError) {
            console.error("No fue posible limpiar el archivo RAG fallido", cleanupError);
          }
        }
        return;
      }
      if (status !== "Completed") return;

      const previousFileId = String(current.active_file_id || "");
      const pendingFileId = String(current.pending_file_id || "");
      const activated = await query(
        `UPDATE documentacion_rag_documents
         SET original_file_name = COALESCE(pending_file_name, original_file_name),
             mime_type = COALESCE(pending_mime_type, mime_type),
             byte_size = COALESCE(pending_byte_size, byte_size),
             source_type = COALESCE(pending_source_type, source_type),
             source_url = pending_source_url,
             active_file_id = pending_file_id,
             active_version_id = pending_version_id,
             pending_file_id = NULL,
             pending_version_id = NULL,
             pending_file_name = NULL,
             pending_mime_type = NULL,
             pending_byte_size = NULL,
             pending_source_type = NULL,
             pending_source_url = NULL,
             upload_operation_id = NULL,
             status = 'available',
             error_message = NULL,
             summary = NULL,
             summary_status = 'pending',
             summary_error = NULL,
             updated_at = NOW(3)
         WHERE id = ? AND upload_operation_id = ?`,
        [
          Number(current.id),
          String(current.upload_operation_id),
        ],
      );
      if (!activated?.affectedRows) return;

      if (previousFileId && previousFileId !== pendingFileId) {
        try {
          const deleteOperation = await beginDelete(current.id, previousFileId);
          if (deleteOperation) {
            await query(
              `UPDATE documentacion_rag_documents
               SET retired_file_id = ?, delete_operation_id = ?, updated_at = NOW(3)
               WHERE id = ?`,
              [previousFileId, deleteOperation, Number(current.id)],
            );
          }
        } catch (error) {
          await query(
            `UPDATE documentacion_rag_documents
             SET retired_file_id = ?, error_message = ?, updated_at = NOW(3)
             WHERE id = ?`,
            [
              previousFileId,
              `La nueva versión está disponible, pero no se pudo retirar la anterior: ${String(error?.message || error).slice(0, 700)}`,
              Number(current.id),
            ],
          );
        }
      }
      void updateSummary(current.public_id).catch((error) => {
        console.error("No fue posible generar el resumen del documento RAG", error);
      });
      return;
    }

    if (current.delete_operation_id && current.retired_file_id) {
      const operation = await describeRagOperation(current.delete_operation_id);
      const status = String(operation?.status || "");
      if (status === "Completed") {
        await query(
          `UPDATE documentacion_rag_documents
           SET retired_file_id = NULL, delete_operation_id = NULL,
               error_message = NULL, updated_at = NOW(3)
           WHERE id = ?`,
          [Number(current.id)],
        );
      } else if (status === "Failed") {
        await query(
          `UPDATE documentacion_rag_documents
           SET error_message = ?, delete_operation_id = NULL, updated_at = NOW(3)
           WHERE id = ?`,
          [
            `No se pudo retirar la versión anterior: ${String(operation?.error_message || "error de Pinecone").slice(0, 700)}`,
            Number(current.id),
          ],
        );
      }
    }
  })().finally(() => refreshLocks.delete(lockKey));
  refreshLocks.set(lockKey, promise);
  return promise;
}

async function refreshPendingDocuments() {
  await query(
    `UPDATE documentacion_rag_documents
     SET summary_status = 'pending', updated_at = NOW(3)
     WHERE status = 'available' AND summary_status = 'processing'
       AND updated_at < DATE_SUB(NOW(3), INTERVAL 10 MINUTE)`,
  );
  const rows = await query(
    `SELECT public_id
     FROM documentacion_rag_documents
     WHERE upload_operation_id IS NOT NULL
        OR status = 'deleting'
        OR (delete_operation_id IS NOT NULL AND retired_file_id IS NOT NULL)
     ORDER BY updated_at ASC
     LIMIT 50`,
  );
  for (let offset = 0; offset < rows.length; offset += 8) {
    await Promise.all(
      rows.slice(offset, offset + 8).map((row) => refreshDocument(row)),
    );
  }
  const summaryRows = await query(
    `SELECT public_id
     FROM documentacion_rag_documents
     WHERE status = 'available' AND summary_status = 'pending'
     ORDER BY updated_at ASC
     LIMIT 50`,
  );
  for (let offset = 0; offset < summaryRows.length; offset += 8) {
    await Promise.all(
      summaryRows
        .slice(offset, offset + 8)
        .map((row) => updateSummary(row.public_id)),
    );
  }
}

export function startDocumentacionRagWorker() {
  if (workerStarted) return;
  workerStarted = true;
  const timer = setInterval(() => {
    if (!isPineconeConfigured()) return;
    void ensureDocumentacionRagSchema()
      .then(refreshPendingDocuments)
      .catch((error) => {
        console.error("No fue posible actualizar operaciones de Documentación RAG", error);
      });
  }, 5_000);
  timer.unref?.();
}

export async function getDocumentacionRagBootstrap() {
  await ensureDocumentacionRagSchema();
  void refreshPendingDocuments().catch((error) => {
    console.error("No fue posible actualizar estados de Documentación RAG", error);
  });
  const [topics, documents] = await Promise.all([
    query(
      `SELECT t.public_id, t.name, t.description, t.sort_order, t.is_active,
              COUNT(d.id) AS document_count
       FROM documentacion_rag_topics t
       LEFT JOIN documentacion_rag_documents d ON d.topic_id = t.id
       GROUP BY t.id
       ORDER BY t.sort_order ASC, t.name ASC`,
    ),
    query(
      `SELECT d.*, t.public_id AS topic_public_id, t.name AS topic_name
       FROM documentacion_rag_documents d
       INNER JOIN documentacion_rag_topics t ON t.id = d.topic_id
       ORDER BY t.sort_order ASC, t.name ASC, d.original_file_name ASC`,
    ),
  ]);
  return {
    pineconeConfigured: isPineconeConfigured(),
    topics: topics.map(normalizeTopic),
    documents: documents.map(normalizeDocument),
  };
}

export async function createDocumentacionRagTopic({ user, name, description, sortOrder }) {
  await ensureDocumentacionRagSchema();
  const publicId = buildRagPublicId();
  try {
    await query(
      `INSERT INTO documentacion_rag_topics
         (public_id, name, description, sort_order, created_by_user_id,
          updated_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
      [
        publicId,
        name,
        description,
        sortOrder,
        Number(user.id),
        Number(user.id),
      ],
    );
  } catch (error) {
    if (String(error?.code || "") === "ER_DUP_ENTRY") {
      throw makeHttpError(409, "Ya existe un tema con ese nombre");
    }
    throw error;
  }
  return publicId;
}

export async function updateDocumentacionRagTopic({
  user,
  topicPublicId,
  name,
  description,
  sortOrder,
  isActive,
}) {
  await ensureDocumentacionRagSchema();
  try {
    const result = await query(
      `UPDATE documentacion_rag_topics
       SET name = ?, description = ?, sort_order = ?, is_active = ?,
           updated_by_user_id = ?, updated_at = NOW(3)
       WHERE public_id = ?`,
      [
        name,
        description,
        sortOrder,
        isActive ? 1 : 0,
        Number(user.id),
        String(topicPublicId || "").trim(),
      ],
    );
    if (!result?.affectedRows) {
      throw makeHttpError(404, "Tema no encontrado");
    }
  } catch (error) {
    if (String(error?.code || "") === "ER_DUP_ENTRY") {
      throw makeHttpError(409, "Ya existe un tema con ese nombre");
    }
    throw error;
  }
}

export async function deleteDocumentacionRagTopic(topicPublicId) {
  await ensureDocumentacionRagSchema();
  const topics = await query(
    "SELECT id FROM documentacion_rag_topics WHERE public_id = ? LIMIT 1",
    [String(topicPublicId || "").trim()],
  );
  if (!topics.length) throw makeHttpError(404, "Tema no encontrado");
  const documents = await query(
    `SELECT id FROM documentacion_rag_documents
     WHERE topic_id = ? LIMIT 1`,
    [Number(topics[0].id)],
  );
  if (documents.length) {
    throw makeHttpError(409, "No se puede eliminar un tema que tiene documentos");
  }
  await query("DELETE FROM documentacion_rag_topics WHERE id = ?", [
    Number(topics[0].id),
  ]);
}

function readMultipartField(fields, name) {
  const value = fields?.[name];
  return Array.isArray(value) ? String(value[0] || "").trim() : String(value || "").trim();
}

function validateFileDetails({ fileName: inputFileName, mimeType: inputMimeType, byteSize }) {
  const fileName = String(inputFileName || "documento")
    .replace(/[\r\n]/g, "")
    .trim()
    .slice(0, 255);
  const extension = path.extname(fileName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw makeHttpError(
      400,
      "Formato no admitido. Sube un archivo PDF, DOCX, JSON, Markdown o TXT",
    );
  }
  if (Number(byteSize || 0) > MAX_FILE_SIZE_BYTES) {
    throw makeHttpError(413, "El documento supera el límite de tamaño permitido");
  }
  return {
    fileName,
    mimeType: String(inputMimeType || "application/octet-stream")
      .trim()
      .toLowerCase(),
  };
}

async function getActiveTopic(topicPublicId) {
  const rows = await query(
    `SELECT id, public_id, name
     FROM documentacion_rag_topics
     WHERE public_id = ? AND is_active = 1
     LIMIT 1`,
    [String(topicPublicId || "").trim()],
  );
  if (!rows.length) throw makeHttpError(404, "Tema activo no encontrado");
  return rows[0];
}

async function prepareUploadSource({ file, sourceUrl }) {
  if (file) {
    const details = validateFileDetails({
      fileName: file.originalFilename || file.newFilename,
      mimeType: file.mimetype,
      byteSize: file.size,
    });
    const buffer = await readFile(file.filepath);
    const byteSize = buffer.length;
    if (byteSize > MAX_FILE_SIZE_BYTES) {
      throw makeHttpError(413, "El documento supera el límite de tamaño permitido");
    }
    return {
      ...details,
      buffer,
      byteSize,
      sourceType: "upload",
      sourceUrl: "",
    };
  }

  try {
    const imported = await importRagSourceUrl(sourceUrl, {
      maxBytes: MAX_FILE_SIZE_BYTES,
    });
    const details = validateFileDetails(imported);
    return { ...imported, ...details };
  } catch (error) {
    if (Number(error?.status)) throw error;
    const tooLarge = String(error?.message || "").includes("tamaño máximo");
    throw makeHttpError(
      tooLarge ? 413 : 400,
      String(error?.message || "No fue posible importar el enlace"),
      "RAG_SOURCE_URL_INVALID",
    );
  }
}

async function uploadFileToPinecone({
  source,
  topic,
  documentPublicId,
  fileId,
}) {
  const versionId = randomUUID();
  const operation = await uploadRagFile({
    buffer: source.buffer,
    fileName: source.fileName,
    mimeType: source.mimeType,
    fileId,
    metadata: {
      document_id: documentPublicId,
      topic_id: String(topic.public_id),
      version_id: versionId,
      topic_name: String(topic.name),
    },
  });
  const operationId = String(operation?.id || "");
  const resolvedFileId = String(operation?.file_id || fileId || "");
  if (!operationId || !resolvedFileId) {
    throw makeHttpError(502, "Pinecone no devolvió el identificador de la operación de carga");
  }
  return {
    ...source,
    versionId,
    operationId,
    fileId: resolvedFileId,
  };
}

export async function uploadDocumentacionRagDocument({ user, req }) {
  await ensureDocumentacionRagSchema();
  const { fields, files } = await parseMultipartFiles(req);
  try {
    const sourceUrl = readMultipartField(fields, "sourceUrl");
    if (files.length > 1 || (files.length === 1 && sourceUrl)) {
      throw makeHttpError(400, "Selecciona un archivo o un enlace, no ambos");
    }
    if (files.length === 0 && !sourceUrl) {
      throw makeHttpError(400, "Selecciona un archivo o proporciona un enlace");
    }
    const topic = await getActiveTopic(readMultipartField(fields, "topicId"));
    const publicId = buildRagPublicId();
    const fileId = `rag-${publicId}`;
    const source = await prepareUploadSource({
      file: files[0],
      sourceUrl,
    });
    const uploaded = await uploadFileToPinecone({
      source,
      topic,
      documentPublicId: publicId,
      fileId,
    });
    try {
      await query(
        `INSERT INTO documentacion_rag_documents
           (public_id, topic_id, original_file_name, mime_type, byte_size,
            source_type, source_url, pending_source_type, pending_source_url,
            status, pending_file_id, pending_version_id, pending_file_name,
            pending_mime_type, pending_byte_size, upload_operation_id,
            summary_status, uploaded_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?, ?, ?, ?, ?, 'pending', ?, NOW(3), NOW(3))`,
        [
          publicId,
          Number(topic.id),
          uploaded.fileName,
          uploaded.mimeType,
          uploaded.byteSize,
          uploaded.sourceType,
          uploaded.sourceUrl || null,
          uploaded.sourceType,
          uploaded.sourceUrl || null,
          uploaded.fileId,
          uploaded.versionId,
          uploaded.fileName,
          uploaded.mimeType,
          uploaded.byteSize,
          uploaded.operationId,
          Number(user.id),
        ],
      );
    } catch (error) {
      try {
        await deleteRagFile(uploaded.fileId);
      } catch (cleanupError) {
        console.error("No fue posible limpiar el archivo RAG huérfano", cleanupError);
      }
      throw error;
    }
    return publicId;
  } finally {
    await cleanupTempFiles(files);
  }
}

export async function replaceDocumentacionRagDocument({ user, documentPublicId, req }) {
  await ensureDocumentacionRagSchema();
  const document = await loadDocument(documentPublicId);
  if (!document) throw makeHttpError(404, "Documento no encontrado");
  if (
    document.status === "deleting" ||
    document.upload_operation_id ||
    document.delete_operation_id
  ) {
    throw makeHttpError(409, "Espera a que termine la operación actual del documento");
  }
  const { fields, files } = await parseMultipartFiles(req);
  try {
    const sourceUrl = readMultipartField(fields, "sourceUrl");
    if (files.length > 1 || (files.length === 1 && sourceUrl)) {
      throw makeHttpError(400, "Selecciona un archivo o un enlace, no ambos");
    }
    if (files.length === 0 && !sourceUrl) {
      throw makeHttpError(400, "Selecciona un archivo o proporciona un enlace");
    }
    const topic = {
      id: Number(document.topic_id),
      public_id: String(document.topic_public_id),
      name: String(document.topic_name),
    };
    const versionId = randomUUID();
    const fileId = `rag-${document.public_id}-${versionId.replace(/-/g, "")}`;
    const source = await prepareUploadSource({
      file: files[0],
      sourceUrl,
    });
    const uploaded = await uploadFileToPinecone({
      source,
      topic,
      documentPublicId: document.public_id,
      fileId,
    });
    try {
      const result = await query(
        `UPDATE documentacion_rag_documents
         SET original_file_name = ?, mime_type = ?, byte_size = ?,
             pending_source_type = ?, pending_source_url = ?,
             pending_file_id = ?, pending_version_id = ?,
             pending_file_name = ?, pending_mime_type = ?, pending_byte_size = ?,
             upload_operation_id = ?, status = 'replacing',
             error_message = NULL, uploaded_by_user_id = ?, updated_at = NOW(3)
         WHERE id = ? AND status IN ('available', 'error')
           AND upload_operation_id IS NULL AND delete_operation_id IS NULL`,
        [
          document.original_file_name,
          document.mime_type,
          document.byte_size,
          uploaded.sourceType,
          uploaded.sourceUrl || null,
          uploaded.fileId,
          uploaded.versionId,
          uploaded.fileName,
          uploaded.mimeType,
          uploaded.byteSize,
          uploaded.operationId,
          Number(user.id),
          Number(document.id),
        ],
      );
      if (!result?.affectedRows) {
        throw makeHttpError(409, "El documento cambió mientras se iniciaba el reemplazo");
      }
    } catch (error) {
      try {
        await deleteRagFile(uploaded.fileId);
      } catch (cleanupError) {
        console.error("No fue posible limpiar el archivo RAG reemplazado en conflicto", cleanupError);
      }
      throw error;
    }
  } finally {
    await cleanupTempFiles(files);
  }
}

export async function deleteDocumentacionRagDocument(documentPublicId) {
  await ensureDocumentacionRagSchema();
  const document = await loadDocument(documentPublicId);
  if (!document) throw makeHttpError(404, "Documento no encontrado");
  if (document.status === "deleting") {
    throw makeHttpError(409, "El documento ya se está eliminando");
  }
  if (document.upload_operation_id || document.delete_operation_id) {
    throw makeHttpError(409, "Espera a que termine la operación actual antes de eliminar el documento");
  }
  const fileIds = [
    document.active_file_id,
    document.pending_file_id,
    document.retired_file_id,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (!fileIds.length) {
    await query("DELETE FROM documentacion_rag_documents WHERE id = ?", [
      Number(document.id),
    ]);
    return;
  }
  await query(
    `UPDATE documentacion_rag_documents
     SET status = 'deleting', delete_file_ids_json = ?, delete_operation_id = NULL,
         error_message = NULL, updated_at = NOW(3)
     WHERE id = ?`,
    [JSON.stringify([...new Set(fileIds)]), Number(document.id)],
  );
}

export async function updateDocumentacionRagSummary({
  documentPublicId,
  summary,
}) {
  await ensureDocumentacionRagSchema();
  const normalizedSummary = String(summary || "").trim().slice(0, 500);
  const result = await query(
    `UPDATE documentacion_rag_documents
     SET summary = ?, summary_status = ?, summary_error = NULL,
         updated_at = NOW(3)
     WHERE public_id = ? AND status = 'available'`,
    [
      normalizedSummary || null,
      normalizedSummary ? "available" : "pending",
      String(documentPublicId || "").trim(),
    ],
  );
  if (!result?.affectedRows) {
    const rows = await query(
      "SELECT public_id FROM documentacion_rag_documents WHERE public_id = ? LIMIT 1",
      [String(documentPublicId || "").trim()],
    );
    if (!rows.length) throw makeHttpError(404, "Documento no encontrado");
    throw makeHttpError(409, "El resumen solo se puede editar cuando el documento está disponible");
  }
}

export async function retrieveDocumentacionRagEvidence({ prompt }) {
  if (!isPineconeConfigured()) return [];
  await ensureDocumentacionRagSchema();
  const rows = await query(
    `SELECT d.public_id, d.active_version_id
     FROM documentacion_rag_documents d
     INNER JOIN documentacion_rag_topics t ON t.id = d.topic_id
     WHERE d.status IN ('available', 'replacing')
       AND d.active_file_id IS NOT NULL
       AND d.active_version_id IS NOT NULL
       AND t.is_active = 1
     ORDER BY d.updated_at DESC
     LIMIT 200`,
  );
  if (!rows.length) return [];
  const filter = {
    $or: rows.map((row) => ({
      $and: [
        { document_id: { $eq: String(row.public_id) } },
        { version_id: { $eq: String(row.active_version_id) } },
      ],
    })),
  };
  const snippets = await retrieveRagContext({ query: prompt, filter, topK: 6 });
  return snippets
    .map((snippet) => ({
      content: String(snippet?.content || "").trim().slice(0, 5000),
      score: Number(snippet?.score || 0),
    }))
    .filter((snippet) => snippet.content);
}

export function getDocumentacionRagUploadLimits() {
  return {
    maxFileBytes: Number.isFinite(MAX_FILE_SIZE_BYTES)
      ? Math.min(MAX_FILE_SIZE_BYTES, config.documents.storage.maxSessionBytes)
      : config.documents.storage.maxSessionBytes,
    allowedExtensions: Array.from(ALLOWED_EXTENSIONS),
  };
}
