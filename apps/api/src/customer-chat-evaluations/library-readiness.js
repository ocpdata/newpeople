import { query } from "../db.js";
import { config } from "../config.js";

export async function getEvaluationLibraryReadiness() {
  if (!String(config.pinecone?.apiKey || "").trim()) {
    return { ready: false, reason: "Pinecone no está configurado en esta API.", eligibleDocuments: 0 };
  }
  const tables = await query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN ('documentacion_rag_documents', 'documentacion_rag_topics')`,
  );
  if (tables.length !== 2) {
    return { ready: false, reason: "El catálogo local RAG no está preparado. Abre Documentación RAG e importa los archivos existentes.", eligibleDocuments: 0 };
  }
  const [row] = await query(
    `SELECT COUNT(*) AS total
     FROM documentacion_rag_documents d
     INNER JOIN documentacion_rag_topics t ON t.id = d.topic_id
     WHERE d.status IN ('available', 'replacing')
       AND d.active_file_id IS NOT NULL AND d.active_version_id IS NOT NULL
       AND t.is_active = 1
       AND (LOWER(t.name) LIKE '%bluecat%' OR LOWER(d.original_file_name) LIKE '%bluecat%')`,
  );
  const count = Number(row?.total);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("No fue posible verificar el conteo del catálogo RAG.");
  }
  return {
    ready: count > 0,
    eligibleDocuments: count,
    reason: count > 0
      ? "Catálogo local de BlueCat disponible. No verifica autenticación, fragmentos ni relevancia en Pinecone."
      : "No hay documentos activos identificables de BlueCat en el catálogo local. Revisa Documentación RAG e importa desde Pinecone.",
  };
}
