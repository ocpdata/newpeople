import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CloudDownload, FileText, Info } from "lucide-react";
import { api, getApiErrorMessage } from "./api";
import "./documentacion-rag.css";

const STATUS_LABELS = {
  processing: "Procesando",
  replacing: "Actualizando",
  available: "Disponible",
  error: "Error",
  deleting: "Eliminando",
};

const FORMAT_LABELS = {
  ".docx": "DOCX",
  ".json": "JSON",
  ".md": "Markdown (.md)",
  ".pdf": "PDF",
  ".txt": "TXT",
};

const IMPORT_STATUS_LABELS = {
  importable: "Listo para importar",
  existing: "Ya registrado",
  blocked: "No disponible",
  topic_conflict: "Requiere tema",
  imported: "Importado",
};

function formatFileSize(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "Tamaño no disponible";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isPending(document) {
  return ["processing", "replacing", "deleting"].includes(
    String(document?.status || ""),
  );
}

export default function DocumentacionRagPage({ canManage = false }) {
  const [activeTab, setActiveTab] = useState("documents");
  const [topics, setTopics] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [uploadLimits, setUploadLimits] = useState(null);
  const [pineconeConfigured, setPineconeConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [importPreview, setImportPreview] = useState(null);
  const [importSelections, setImportSelections] = useState({});
  const [importTopics, setImportTopics] = useState({});
  const [importResults, setImportResults] = useState(null);
  const [uploadTarget, setUploadTarget] = useState(null);
  const [sourceDialog, setSourceDialog] = useState(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [summaryEditor, setSummaryEditor] = useState(null);
  const [topicDraft, setTopicDraft] = useState({
    name: "",
    description: "",
    sortOrder: 0,
  });
  const fileInputRef = useRef(null);

  const loadLibrary = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const { data } = await api.get("/api/documentacion-rag/bootstrap");
      setTopics(Array.isArray(data?.topics) ? data.topics : []);
      setDocuments(Array.isArray(data?.documents) ? data.documents : []);
      setUploadLimits(data?.uploadLimits || null);
      setPineconeConfigured(Boolean(data?.pineconeConfigured));
      setError("");
      return data;
    } catch (loadError) {
      setError(
        getApiErrorMessage(
          loadError,
          "No fue posible cargar Documentación RAG",
        ),
      );
      return null;
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timeoutId;
    let initialLoad = true;
    async function poll() {
      if (cancelled) return;
      const data = await loadLibrary(initialLoad);
      initialLoad = false;
      if (cancelled) return;
      const pending = (data?.documents || []).some(isPending);
      timeoutId = window.setTimeout(poll, pending ? 4000 : 30000);
    }
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [loadLibrary]);

  useEffect(() => {
    if (uploadTarget) fileInputRef.current?.click();
  }, [uploadTarget]);

  const documentsByTopic = useMemo(() => {
    const grouped = new Map();
    for (const topic of topics) grouped.set(topic.id, []);
    for (const document of documents) {
      if (!grouped.has(document.topicId)) grouped.set(document.topicId, []);
      grouped.get(document.topicId).push(document);
    }
    return grouped;
  }, [documents, topics]);
  const selectedImportCount = Object.values(importSelections).filter(Boolean).length;

  async function previewImport() {
    setBusy("import-preview");
    setError("");
    setNotice("");
    setImportResults(null);
    try {
      const { data } = await api.get("/api/documentacion-rag/pinecone-import/preview", { timeout: 125000 });
      setImportPreview(data);
      setImportSelections({});
      setImportTopics({});
    } catch (previewError) {
      setError(getApiErrorMessage(previewError, "No fue posible consultar los archivos de Pinecone"));
    } finally {
      setBusy("");
    }
  }

  async function confirmImport() {
    const selections = importPreview.files
      .filter((file) => importSelections[file.fileId])
      .map((file) => ({
        fileId: file.fileId,
        documentId: file.documentId,
        versionId: file.versionId,
        ...(importTopics[file.fileId] ? { topicId: importTopics[file.fileId] } : {}),
      }));
    setBusy("import");
    setError("");
    try {
      const { data } = await api.post("/api/documentacion-rag/pinecone-import", {
        assistantName: importPreview.assistantName,
        selections,
      }, { timeout: 125000 });
      setImportResults(data.results);
      setNotice(`Importados: ${data.results.filter((item) => item.status === "imported").length}. Ya registrados: ${data.results.filter((item) => item.status === "existing").length}. Bloqueados: ${data.results.filter((item) => !["imported", "existing"].includes(item.status)).length}.`);
      await loadLibrary();
    } catch (importError) {
      setError(getApiErrorMessage(importError, "No fue posible importar los documentos. Actualiza la vista previa antes de reintentar."));
    } finally {
      setBusy("");
    }
  }

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    const target = uploadTarget;
    event.target.value = "";
    setUploadTarget(null);
    if (!file || !target) return;
    if (uploadLimits?.maxFileBytes && file.size > uploadLimits.maxFileBytes) {
      setError(
        `El archivo supera el límite de ${formatFileSize(uploadLimits.maxFileBytes)}.`,
      );
      return;
    }

    await submitSource({ target, file });
  }

  async function submitSource({ target, file, url }) {
    const form = new FormData();
    if (file) form.append("file", file);
    if (url) form.append("sourceUrl", url);
    if (target.mode === "upload") form.append("topicId", target.topicId);
    const busyKey = `${target.mode}:${target.documentId || target.topicId}`;
    setBusy(busyKey);
    setError("");
    setNotice("");
    try {
      if (target.mode === "replace") {
        await api.post(
          `/api/documentacion-rag/documents/${encodeURIComponent(target.documentId)}/replace`,
          form,
          { timeout: 120000 },
        );
        setNotice("Se está procesando la nueva fuente. La versión vigente seguirá disponible hasta que termine.");
      } else {
        await api.post("/api/documentacion-rag/documents", form, {
          timeout: 120000,
        });
        setNotice("La fuente se envió a Pinecone y aparecerá cuando termine su procesamiento.");
      }
      setSourceDialog(null);
      setSourceUrl("");
      await loadLibrary();
    } catch (uploadError) {
      setError(
        getApiErrorMessage(uploadError, "No fue posible añadir la fuente"),
      );
    } finally {
      setBusy("");
    }
  }

  async function handleSourceUrlSubmit(event) {
    event.preventDefault();
    if (!sourceDialog || !sourceUrl.trim()) return;
    await submitSource({ target: sourceDialog, url: sourceUrl.trim() });
  }

  async function createTopic(event) {
    event.preventDefault();
    setBusy("topic:create");
    setError("");
    setNotice("");
    try {
      await api.post("/api/documentacion-rag/topics", {
        ...topicDraft,
        sortOrder: Number(topicDraft.sortOrder || 0),
      });
      setTopicDraft({ name: "", description: "", sortOrder: 0 });
      setNotice("Tema creado.");
      await loadLibrary();
    } catch (topicError) {
      setError(getApiErrorMessage(topicError, "No fue posible crear el tema"));
    } finally {
      setBusy("");
    }
  }

  async function saveTopic(topic, patch) {
    setBusy(`topic:${topic.id}`);
    setError("");
    setNotice("");
    try {
      await api.patch(
        `/api/documentacion-rag/topics/${encodeURIComponent(topic.id)}`,
        {
          name: patch.name ?? topic.name,
          description: patch.description ?? topic.description,
          sortOrder: Number(patch.sortOrder ?? topic.sortOrder),
          isActive: patch.isActive ?? topic.isActive,
        },
      );
      setNotice("Tema actualizado.");
      await loadLibrary();
    } catch (topicError) {
      setError(getApiErrorMessage(topicError, "No fue posible actualizar el tema"));
    } finally {
      setBusy("");
    }
  }

  async function deleteTopic(topic) {
    if (!window.confirm(`¿Eliminar el tema "${topic.name}"?`)) return;
    setBusy(`topic:${topic.id}`);
    setError("");
    setNotice("");
    try {
      await api.delete(
        `/api/documentacion-rag/topics/${encodeURIComponent(topic.id)}`,
      );
      setNotice("Tema eliminado.");
      await loadLibrary();
    } catch (topicError) {
      setError(getApiErrorMessage(topicError, "No fue posible eliminar el tema"));
    } finally {
      setBusy("");
    }
  }

  async function deleteDocument(document) {
    if (!window.confirm(`¿Eliminar "${document.fileName}" de la biblioteca?`)) {
      return;
    }
    setBusy(`delete:${document.id}`);
    setError("");
    setNotice("");
    try {
      await api.delete(
        `/api/documentacion-rag/documents/${encodeURIComponent(document.id)}`,
      );
      setNotice("Se solicitó eliminar el documento de Pinecone.");
      await loadLibrary();
    } catch (deleteError) {
      setError(getApiErrorMessage(deleteError, "No fue posible eliminar el documento"));
    } finally {
      setBusy("");
    }
  }

  async function saveSummary(event) {
    event.preventDefault();
    if (!summaryEditor) return;
    setBusy(`summary:${summaryEditor.id}`);
    setError("");
    try {
      await api.patch(
        `/api/documentacion-rag/documents/${encodeURIComponent(summaryEditor.id)}/summary`,
        { summary: summaryEditor.summary },
      );
      setSummaryEditor(null);
      setNotice("Resumen actualizado.");
      await loadLibrary();
    } catch (summaryError) {
      setError(getApiErrorMessage(summaryError, "No fue posible guardar el resumen"));
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="panel documentacion-rag-page">
      <header className="documentacion-rag-header">
        <div>
          <div className="module-title-with-icon">
            <h2>Base de conocimiento IA</h2>
          </div>
          <p className="roles-subtitle">
            {canManage
              ? "Administra documentos de conocimiento que la IA puede consultar."
              : "Consulta los documentos de conocimiento disponibles para la IA."}
          </p>
        </div>
      </header>

      <div className="documentacion-rag-tabs" role="tablist" aria-label="Secciones de Base de conocimiento IA">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab !== "admin" || !canManage}
          className={activeTab !== "admin" || !canManage ? "active" : ""}
          onClick={() => setActiveTab("documents")}
        >
          Documentos
        </button>
        {canManage ? (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "admin"}
            className={activeTab === "admin" ? "active" : ""}
            onClick={() => setActiveTab("admin")}
          >
            Administración
          </button>
        ) : null}
      </div>

      {error ? <div className="toast toast-error">{error}</div> : null}
      {notice ? <div className="toast toast-success">{notice}</div> : null}
      {!pineconeConfigured ? (
        <div className="documentacion-rag-warning" role="status">
          Pinecone Assistant no está configurado. Añade{" "}
          <code>PINECONE_API_KEY</code> en el entorno del backend para cargar y
          consultar documentos.
        </div>
      ) : null}
      {loading ? <p className="field-hint">Cargando biblioteca...</p> : null}
      {activeTab === "documents" && canManage ? (
        <button type="button" className="btn-secondary documentacion-rag-import-trigger"
          disabled={!pineconeConfigured || Boolean(busy)} onClick={previewImport}>
          <CloudDownload size={18} aria-hidden="true" />
          {busy === "import-preview" ? "Consultando Pinecone..." : "Importar desde Pinecone"}
        </button>
      ) : null}
      {importPreview ? (
        <section className="documentacion-rag-import" aria-label="Importar desde Pinecone">
          <header className="documentacion-rag-import-header">
            <div className="documentacion-rag-import-heading">
              <span className="documentacion-rag-import-icon"><CloudDownload size={24} aria-hidden="true" /></span>
              <div>
                <h3>Importar desde Pinecone</h3>
                <p>Incorpora archivos existentes a tu biblioteca, sin volver a cargarlos.</p>
              </div>
            </div>
            <span className="documentacion-rag-import-count">
              {importPreview.files.length} {importPreview.files.length === 1 ? "archivo encontrado" : "archivos encontrados"}
            </span>
          </header>
          <div className="documentacion-rag-import-assistant">
            Assistant: <strong>{importPreview.assistantName}</strong>
          </div>
          <div className="documentacion-rag-warning documentacion-rag-import-warning">
            <Info size={18} aria-hidden="true" />
            <p><strong>Los archivos seguirán compartidos.</strong> No se subirán ni eliminarán archivos.
              Un reemplazo o borrado desde otro entorno puede afectar su disponibilidad aquí.</p>
          </div>
          {importPreview.files.length === 0 ? <p>No hay archivos en este Assistant.</p> : null}
          {(importResults || importPreview.files).map((file) => (
            <div className={`documentacion-rag-import-row${!importResults && importSelections[file.fileId] ? " is-selected" : ""}`} key={file.fileId}>
              <label className="documentacion-rag-import-file">
                {!importResults ? (
                  <input type="checkbox" aria-label={`Importar ${file.fileName}`}
                    checked={Boolean(importSelections[file.fileId])}
                    disabled={Boolean(busy) || !(
                      file.status === "importable" ||
                      (file.status === "topic_conflict" && importTopics[file.fileId])
                    )}
                    onChange={(event) => setImportSelections((current) => ({
                      ...current, [file.fileId]: event.target.checked,
                    }))}
                  />
                ) : null}
                <span className="documentacion-rag-import-file-icon"><FileText size={20} aria-hidden="true" /></span>
                <strong>{file.fileName || file.fileId}</strong>
              </label>
              <span className={`documentacion-rag-import-status import-status-${file.status}`}>
                {IMPORT_STATUS_LABELS[file.status] || file.status}
              </span>
              <p className="field-hint documentacion-rag-import-reason">{file.reason}</p>
              {!importResults && file.status === "topic_conflict" ? (
                <label>
                  Asociar a tema local
                  <select aria-label={`Tema para ${file.fileName}`}
                    value={importTopics[file.fileId] || ""} disabled={Boolean(busy)}
                    onChange={(event) => {
                      setImportTopics((current) => ({ ...current, [file.fileId]: event.target.value }));
                      setImportSelections((current) => ({ ...current, [file.fileId]: false }));
                    }}>
                    <option value="">Selecciona un tema</option>
                    {importPreview.topics.filter((topic) => topic.isActive).map((topic) => (
                      <option key={topic.id} value={topic.id}>{topic.name}</option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          ))}
          <footer className="documentacion-rag-import-footer">
            <div aria-live="polite">
              <strong>{importResults
                ? `${importResults.filter((file) => file.status === "imported").length} documentos importados`
                : `${selectedImportCount} ${selectedImportCount === 1 ? "seleccionado" : "seleccionados"}`}</strong>
              {!importResults ? <p className="field-hint">Selecciona hasta 200 documentos por importación.</p> : null}
            </div>
            <div className="documentacion-rag-inline-actions">
            <button type="button" className="btn-secondary" disabled={Boolean(busy)}
              onClick={() => setImportPreview(null)}>Cerrar</button>
            {!importResults ? (
              <button type="button" className="btn-primary"
                disabled={Boolean(busy) || !selectedImportCount || selectedImportCount > 200}
                onClick={confirmImport}>
                {busy === "import" ? "Importando..." : "Importar seleccionados"}
              </button>
            ) : null}
            </div>
          </footer>
        </section>
      ) : null}
      {activeTab !== "admin" || !canManage ? (
        <p className="field-hint documentacion-rag-format-hint">
          Formatos aceptados:{" "}
          {(uploadLimits?.allowedExtensions || Object.keys(FORMAT_LABELS))
            .map((extension) => FORMAT_LABELS[extension] || extension)
            .join(", ")}
          {uploadLimits?.maxFileBytes
            ? ` · Tamaño máximo por archivo: ${formatFileSize(uploadLimits.maxFileBytes)}`
            : ""}
        </p>
      ) : null}

      <input
        ref={fileInputRef}
        className="documentacion-rag-file-input"
        type="file"
        accept={uploadLimits?.allowedExtensions?.join(",")}
        onChange={handleFileChange}
        aria-label="Seleccionar documento"
      />

      {sourceDialog ? (
        <div
          className="documentacion-rag-source-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="documentacion-rag-source-title"
        >
          <div className="documentacion-rag-source-card">
            <h3 id="documentacion-rag-source-title">
              {sourceDialog.mode === "replace" ? "Reemplazar fuente" : "Añadir fuente"}
            </h3>
            <p className="field-hint">
              Carga un archivo o importa el enlace público de un archivo
              compatible o de una página web.
            </p>
            <button
              type="button"
              className="btn-secondary"
              disabled={Boolean(busy)}
              onClick={() => {
                setUploadTarget(sourceDialog);
                setSourceDialog(null);
              }}
            >
              Seleccionar archivo
            </button>
            <form
              className="documentacion-rag-source-url-form"
              onSubmit={handleSourceUrlSubmit}
            >
              <label>
                Enlace público
                <input
                  type="url"
                  required
                  maxLength={2048}
                  placeholder="https://ejemplo.com/documento.pdf"
                  value={sourceUrl}
                  onChange={(event) => setSourceUrl(event.target.value)}
                />
              </label>
              <span className="field-hint">
                Se aceptan enlaces a PDF, DOCX, JSON, Markdown y TXT, además de
                páginas web públicas.
              </span>
              <div className="documentacion-rag-inline-actions">
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={Boolean(busy) || !sourceUrl.trim()}
                >
                  {busy ? "Importando..." : "Añadir enlace"}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={Boolean(busy)}
                  onClick={() => {
                    setSourceDialog(null);
                    setSourceUrl("");
                  }}
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {activeTab === "documents" ? (
        <div className="documentacion-rag-groups">
          {topics.length === 0 && !loading ? (
            <p className="field-hint">
              Todavía no hay temas. Crea temas desde la pestaña Administración.
            </p>
          ) : null}
          {topics.map((topic) => (
            <section className="documentacion-rag-topic" key={topic.id}>
              <header className="documentacion-rag-topic-header">
                <div>
                  <h3>{topic.name}</h3>
                  {topic.description ? (
                    <p className="field-hint">{topic.description}</p>
                  ) : null}
                </div>
                {topic.isActive && canManage ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={!pineconeConfigured || Boolean(busy)}
                    onClick={() => {
                      setSourceUrl("");
                      setSourceDialog({ mode: "upload", topicId: topic.id });
                    }}
                  >
                    Añadir documento
                  </button>
                ) : (
                  <span className="documentacion-rag-inactive">Tema inactivo</span>
                )}
              </header>
              <div className="documentacion-rag-document-list">
                {(documentsByTopic.get(topic.id) || []).length === 0 ? (
                  <p className="field-hint">No hay documentos en este tema.</p>
                ) : null}
                {(documentsByTopic.get(topic.id) || []).map((document) => (
                  <article className="documentacion-rag-document" key={document.id}>
                    <div className="documentacion-rag-document-main">
                      <div className="documentacion-rag-document-title-row">
                        <h4>{document.fileName}</h4>
                        <span
                          className={`documentacion-rag-status status-${document.status}`}
                          role="status"
                        >
                          {STATUS_LABELS[document.status] || document.status}
                        </span>
                      </div>
                      <p className="documentacion-rag-summary">
                        {document.summary ||
                          (document.summaryStatus === "processing"
                            ? "Generando resumen..."
                            : document.summaryStatus === "error"
                              ? "No fue posible generar el resumen."
                              : "Resumen pendiente.")}
                      </p>
                      <span className="field-hint">
                        {formatFileSize(document.byteSize)}
                        {document.updatedAt
                          ? ` · Actualizado ${new Date(document.updatedAt).toLocaleDateString()}`
                          : ""}
                      </span>
                      {document.sourceUrl ? (
                        <a
                          className="documentacion-rag-source-link"
                          href={document.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {document.sourceType === "web_page"
                            ? "Página web de origen"
                            : "Archivo de origen"}
                        </a>
                      ) : null}
                      {document.error ? (
                        <p className="documentacion-rag-error">{document.error}</p>
                      ) : null}
                      {document.summaryError && !document.summary ? (
                        <p className="documentacion-rag-error">{document.summaryError}</p>
                      ) : null}
                    </div>
                    <div className="documentacion-rag-document-actions">
                      {canManage && document.status === "available" ? (
                        <>
                          <button
                            type="button"
                            className="btn-secondary"
                            disabled={Boolean(busy)}
                            onClick={() =>
                              setSummaryEditor({
                                id: document.id,
                                summary: document.summary || "",
                              })
                            }
                          >
                            Editar resumen
                          </button>
                          <button
                            type="button"
                            className="btn-secondary"
                            disabled={!pineconeConfigured || Boolean(busy)}
                            onClick={() => {
                              setSourceUrl("");
                              setSourceDialog({
                                mode: "replace",
                                documentId: document.id,
                              });
                            }}
                          >
                            Reemplazar
                          </button>
                        </>
                      ) : null}
                      {canManage && !isPending(document) ? (
                        <button
                          type="button"
                          className="btn-secondary documentacion-rag-delete"
                          disabled={Boolean(busy)}
                          onClick={() => deleteDocument(document)}
                        >
                          Eliminar
                        </button>
                      ) : null}
                    </div>
                    {canManage && summaryEditor?.id === document.id ? (
                      <form
                        className="documentacion-rag-summary-editor"
                        onSubmit={saveSummary}
                      >
                        <label>
                          Resumen breve
                          <textarea
                            rows={3}
                            maxLength={500}
                            value={summaryEditor.summary}
                            onChange={(event) =>
                              setSummaryEditor((current) => ({
                                ...current,
                                summary: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <div className="documentacion-rag-inline-actions">
                          <button
                            type="submit"
                            className="btn-primary"
                            disabled={Boolean(busy)}
                          >
                            Guardar resumen
                          </button>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => setSummaryEditor(null)}
                          >
                            Cancelar
                          </button>
                        </div>
                      </form>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : canManage ? (
        <div className="documentacion-rag-admin">
          <form className="documentacion-rag-topic-form" onSubmit={createTopic}>
            <h3>Crear tema</h3>
            <label>
              Nombre
              <input
                required
                minLength={2}
                maxLength={160}
                value={topicDraft.name}
                onChange={(event) =>
                  setTopicDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Descripción
              <textarea
                rows={2}
                maxLength={1000}
                value={topicDraft.description}
                onChange={(event) =>
                  setTopicDraft((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Orden
              <input
                type="number"
                min="0"
                max="10000"
                value={topicDraft.sortOrder}
                onChange={(event) =>
                  setTopicDraft((current) => ({
                    ...current,
                    sortOrder: event.target.value,
                  }))
                }
              />
            </label>
            <button
              type="submit"
              className="btn-primary"
              disabled={Boolean(busy)}
            >
              Crear tema
            </button>
          </form>

          <div className="documentacion-rag-topic-admin-list">
            <h3>Temas configurados</h3>
            {topics.map((topic) => (
              <TopicAdminCard
                key={`${topic.id}:${topic.name}:${topic.description}:${topic.sortOrder}:${topic.isActive}`}
                topic={topic}
                busy={busy === `topic:${topic.id}`}
                onSave={(patch) => saveTopic(topic, patch)}
                onDelete={() => deleteTopic(topic)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function TopicAdminCard({ topic, busy, onSave, onDelete }) {
  const [draft, setDraft] = useState({
    name: topic.name,
    description: topic.description,
    sortOrder: topic.sortOrder,
  });

  return (
    <form
      className="documentacion-rag-topic-admin-card"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}
    >
      <div className="documentacion-rag-topic-admin-fields">
        <label>
          Nombre
          <input
            required
            minLength={2}
            maxLength={160}
            value={draft.name}
            onChange={(event) =>
              setDraft((current) => ({ ...current, name: event.target.value }))
            }
          />
        </label>
        <label>
          Descripción
          <input
            maxLength={1000}
            value={draft.description}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                description: event.target.value,
              }))
            }
          />
        </label>
        <label className="documentacion-rag-order-field">
          Orden
          <input
            type="number"
            min="0"
            max="10000"
            value={draft.sortOrder}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                sortOrder: event.target.value,
              }))
            }
          />
        </label>
      </div>
      <div className="documentacion-rag-inline-actions">
        <label className="documentacion-rag-active-toggle">
          <input
            type="checkbox"
            checked={topic.isActive}
            onChange={(event) =>
              onSave({ ...draft, isActive: event.target.checked })
            }
            disabled={busy}
          />
          Activo
        </label>
        <button type="submit" className="btn-secondary" disabled={busy}>
          Guardar cambios
        </button>
        <button
          type="button"
          className="btn-secondary documentacion-rag-delete"
          onClick={onDelete}
          disabled={busy || topic.documentCount > 0}
          title={
            topic.documentCount > 0
              ? "Elimina o mueve sus documentos antes de eliminar el tema"
              : ""
          }
        >
          Eliminar tema
        </button>
      </div>
      <span className="field-hint">{topic.documentCount} documento(s)</span>
    </form>
  );
}
