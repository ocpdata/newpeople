import { extname } from "node:path";
import { config } from "../config.js";
import { query, withTransaction } from "../db.js";
import { DOCUMENT_FORMATS } from "../../../../shared/document-formats.js";
import { listRagFiles } from "./pinecone.js";
import { ensureDocumentacionRagSchema } from "./schema.js";

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function validId(value, maxLength) {
  return typeof value === "string" &&
    value.length > 0 && value.length <= maxLength &&
    /^[a-zA-Z0-9_-]+$/.test(value);
}

function classifyFile(file, files, topics, documents, mappedTopicId) {
  const metadata = file.metadata || {};
  const entry = {
    fileId: file.id,
    fileName: file.name,
    documentId: typeof metadata.document_id === "string" ? metadata.document_id : "",
    versionId: typeof metadata.version_id === "string" ? metadata.version_id : "",
    topicId: typeof metadata.topic_id === "string" ? metadata.topic_id : "",
    topicName: typeof metadata.topic_name === "string" ? metadata.topic_name : "",
    status: "blocked",
    reason: "",
  };
  const block = (reason) => ({ ...entry, reason });
  if (!validId(file.id, 128) || !validId(metadata.document_id, 64) ||
      !validId(metadata.version_id, 64) || !validId(metadata.topic_id, 64) ||
      typeof metadata.topic_name !== "string" ||
      !metadata.topic_name.trim() || metadata.topic_name.length > 160 ||
      !file.name.trim() || file.name.length > 255) {
    return block("Metadatos incompletos o no válidos.");
  }
  const matches = documents.filter((document) =>
    document.public_id === metadata.document_id ||
    [document.active_file_id, document.pending_file_id, document.retired_file_id]
      .includes(file.id));
  if (matches.length) {
    if (matches.length === 1 && matches[0].public_id === metadata.document_id &&
        matches[0].active_file_id === file.id &&
        matches[0].active_version_id === metadata.version_id) {
      return { ...entry, status: "existing", reason: "Ya registrado." };
    }
    return block("Conflicto con un documento o una operación local existente.");
  }
  if (files.filter((candidate) =>
    candidate.metadata?.document_id === metadata.document_id).length > 1 ||
      files.filter((candidate) => candidate.id === file.id).length > 1) {
    return block("Hay varios archivos o versiones para el mismo documento.");
  }
  if (file.status !== "Available") {
    return block(`Archivo no disponible en Pinecone (${file.status || "estado desconocido"}).`);
  }
  const topicMetadataConflict = files.some((candidate) =>
    candidate.metadata?.topic_id === metadata.topic_id &&
    candidate.metadata?.topic_name !== metadata.topic_name);
  if (topicMetadataConflict) {
    return block("El tema remoto tiene nombres contradictorios.");
  }
  const matchingTopic = topics.find((topic) => topic.public_id === metadata.topic_id);
  const nameMatch = topics.find((topic) =>
    topic.name.trim().toLocaleLowerCase() === metadata.topic_name.trim().toLocaleLowerCase());
  const mappedTopic = mappedTopicId
    ? topics.find((topic) => topic.public_id === mappedTopicId)
    : null;
  if (mappedTopicId && !mappedTopic) return block("El tema seleccionado ya no existe.");
  const topic = mappedTopic || matchingTopic;
  if (!mappedTopic && ((matchingTopic && matchingTopic.name !== metadata.topic_name) ||
      (!matchingTopic && nameMatch))) {
    return { ...entry, status: "topic_conflict", reason: "Selecciona un tema local para asociar este documento." };
  }
  if (topic && !Number(topic.is_active)) return block("El tema local está inactivo.");
  return {
    ...entry,
    status: "importable",
    reason: topic ? `Tema: ${topic.name}` : `Se creará el tema: ${metadata.topic_name}`,
    localTopicId: topic?.public_id || null,
  };
}

async function loadCatalog(runQuery) {
  const topics = await runQuery("SELECT id, public_id, name, is_active FROM documentacion_rag_topics");
  const documents = await runQuery(
    `SELECT public_id, active_file_id, active_version_id, pending_file_id, retired_file_id
     FROM documentacion_rag_documents`,
  );
  return { topics, documents };
}

export async function previewPineconeImport() {
  await ensureDocumentacionRagSchema();
  const remote = await listRagFiles();
  const { topics, documents } = await loadCatalog(query);
  return {
    assistantName: remote.assistantName,
    topics: topics.map((topic) => ({
      id: topic.public_id, name: topic.name, isActive: Boolean(Number(topic.is_active)),
    })),
    files: remote.files.map((file) => classifyFile(file, remote.files, topics, documents)),
  };
}

export async function importPineconeDocuments({ user, assistantName, selections }) {
  await ensureDocumentacionRagSchema();
  if (assistantName !== String(config.pinecone.assistantName || "").trim()) {
    throw httpError(409, "El Assistant configurado cambió. Actualiza la vista previa.");
  }
  const remote = await listRagFiles();
  return withTransaction(async (connection) => {
    const runQuery = async (sql, params = []) => {
      const [rows] = await connection.query(sql, params);
      return rows;
    };
    // Serialize imports across API processes; the unique document ID is a second guard.
    await runQuery(
      "INSERT IGNORE INTO documentacion_rag_meta (meta_key) VALUES ('pinecone_import_lock')",
    );
    await runQuery(
      "SELECT meta_key FROM documentacion_rag_meta WHERE meta_key = 'pinecone_import_lock' FOR UPDATE",
    );
    const { topics, documents } = await loadCatalog(runQuery);
    const results = [];
    for (const selection of selections) {
      const file = remote.files.find((candidate) => candidate.id === selection.fileId);
      if (!file) {
        results.push({ fileId: selection.fileId, status: "blocked", reason: "El archivo ya no existe en el Assistant." });
        continue;
      }
      if (file.metadata?.document_id !== selection.documentId ||
          file.metadata?.version_id !== selection.versionId) {
        results.push({ fileId: file.id, fileName: file.name, status: "blocked", reason: "Los metadatos cambiaron. Actualiza la vista previa." });
        continue;
      }
      const entry = classifyFile(file, remote.files, topics, documents, selection.topicId);
      if (entry.status !== "importable") {
        results.push(entry);
        continue;
      }
      let topic = topics.find((candidate) => candidate.public_id === entry.localTopicId);
      if (!topic) {
        const inserted = await runQuery(
          `INSERT INTO documentacion_rag_topics
           (public_id, name, created_by_user_id, updated_by_user_id)
           VALUES (?, ?, ?, ?)`,
          [entry.topicId, entry.topicName, user.id, user.id],
        );
        topic = { id: inserted.insertId, public_id: entry.topicId, name: entry.topicName, is_active: 1 };
        topics.push(topic);
      }
      const mimeType = DOCUMENT_FORMATS[extname(file.name).toLowerCase()]?.mimeTypes[0] ||
        (extname(file.name).toLowerCase() === ".json" ? "application/json" : "application/octet-stream");
      await runQuery(
        `INSERT INTO documentacion_rag_documents
         (public_id, topic_id, original_file_name, mime_type, byte_size, source_type,
          status, active_file_id, active_version_id, summary_status, uploaded_by_user_id)
         VALUES (?, ?, ?, ?, 0, 'upload', 'available', ?, ?, 'pending', ?)`,
        [entry.documentId, topic.id, file.name, mimeType, file.id, entry.versionId, user.id],
      );
      documents.push({
        public_id: entry.documentId, active_file_id: file.id, active_version_id: entry.versionId,
      });
      results.push({ ...entry, status: "imported", reason: "Importado correctamente." });
    }
    return { assistantName: remote.assistantName, results };
  });
}
