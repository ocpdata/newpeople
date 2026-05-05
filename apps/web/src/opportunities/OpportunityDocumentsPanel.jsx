import { useState } from "react";
import { api, getApiErrorMessage } from "../api";

function buildPastedTextFileName(label) {
  const normalizedLabel = String(label || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${normalizedLabel || "texto-pegado"}-${timestamp}.txt`;
}

function buildPastedTextFile({ fileName, text }) {
  return new File([String(text || "")], fileName, {
    type: "text/plain",
    lastModified: Date.now(),
  });
}

function renderDocumentStatus(document) {
  if (document.processingStatus === "review_ready") {
    return "Analizado";
  }
  if (document.processingStatus === "failed") {
    return "Procesamiento fallido";
  }
  if (document.processingStatus === "processing") {
    return "Procesando";
  }
  return "Cargado";
}

function renderMatchLabel(match) {
  if (!match) return "Sin coincidencia interna";
  if (match.matchStatus === "single_match") {
    return `Coincidencia: ${match.selectedEntityLabel || "confirmada"}`;
  }
  if (match.matchStatus === "multiple_matches") {
    return "Varias coincidencias, revisar manualmente";
  }
  return "Sin coincidencia interna";
}

function hasMatchSuggestion(match) {
  if (!match) return false;
  if (match.selectedEntityId) return true;
  if (String(match.reason || "").trim()) return true;
  return (
    Array.isArray(match.candidateEntities) && match.candidateEntities.length
  );
}

function renderApplySuggestionButton({ disabled, onApply, label = "Aplicar" }) {
  return (
    <button
      type="button"
      className="btn-secondary opportunity-documents-apply-field-button"
      onClick={onApply}
      disabled={disabled}
    >
      {label}
    </button>
  );
}

function buildDocumentPreview(document) {
  const previewText = String(document?.previewText || "").trim();
  if (previewText) {
    return {
      heading:
        document?.previewKind === "transcript"
          ? "Transcripcion"
          : document?.previewKind === "raw"
            ? "Contenido completo"
            : document?.previewKind === "normalized"
              ? "Contenido extraido"
              : document?.previewKind === "summary"
                ? "Resumen detectado"
                : "Contenido del documento",
      text: previewText,
    };
  }

  const transcriptText = String(document?.transcriptText || "").trim();
  if (transcriptText) {
    return {
      heading: "Transcripcion",
      text: transcriptText,
    };
  }

  const rawText = String(document?.rawText || "").trim();
  if (rawText) {
    return {
      heading: "Contenido completo",
      text: rawText,
    };
  }

  const normalizedText = String(document?.normalizedText || "").trim();
  if (normalizedText) {
    return {
      heading: "Contenido extraido",
      text: normalizedText,
    };
  }

  const contentSummary = String(document?.contentSummary || "").trim();
  if (contentSummary) {
    return {
      heading: "Resumen detectado",
      text: contentSummary,
    };
  }

  if (document?.processingStatus === "processing") {
    return {
      heading: "Analisis en curso",
      text: "Este archivo todavia se esta procesando. Cuando termine, aqui se mostrara el texto extraido o la transcripcion disponible.",
    };
  }

  if (document?.processingStatus === "failed") {
    return {
      heading: "Sin vista previa",
      text:
        String(document?.processingError || "").trim() ||
        "No fue posible extraer contenido textual de este archivo.",
    };
  }

  return {
    heading: "Sin contenido textual",
    text: "Este archivo aun no tiene texto extraido o transcripcion disponible para vista previa.",
  };
}

function OpportunityDocumentsPanel({
  editingOpportunityId,
  documentUploadSession,
  documents,
  documentReview,
  documentReviewOverrides,
  documentReviewApplied,
  loadingDocumentSession,
  loadingOpportunityDocuments,
  uploadingOpportunityDocuments,
  applyingDocumentSuggestions,
  deletingOpportunityDocumentId,
  onUploadFiles,
  onApplySuggestions,
  onDeleteDocument,
  onDownloadDocument,
  onChangeFieldOverride,
  onChangeMatchSelection,
  onApplyFieldSuggestion,
  onApplyMatchSuggestion,
}) {
  const [previewDocument, setPreviewDocument] = useState(null);
  const [pastedTextName, setPastedTextName] = useState("");
  const [pastedTextValue, setPastedTextValue] = useState("");

  async function openDocumentPreview(document) {
    setPreviewDocument({
      ...document,
      previewLoading: true,
      previewError: "",
    });

    try {
      const { data } = await api.get(
        `/api/opportunities/documents/${document.publicId}/preview-text`,
      );
      setPreviewDocument((current) => {
        if (!current || current.publicId !== document.publicId) {
          return current;
        }
        return {
          ...current,
          ...data,
          previewLoading: false,
          previewError: "",
        };
      });
    } catch (error) {
      setPreviewDocument((current) => {
        if (!current || current.publicId !== document.publicId) {
          return current;
        }
        return {
          ...current,
          previewLoading: false,
          previewError: getApiErrorMessage(
            error,
            "No fue posible cargar el contenido completo del documento.",
          ),
        };
      });
    }
  }

  async function handleUploadPastedText() {
    const trimmedText = String(pastedTextValue || "").trim();
    if (!trimmedText) return;

    const file = buildPastedTextFile({
      fileName: buildPastedTextFileName(pastedTextName),
      text: trimmedText,
    });
    const uploaded = await onUploadFiles([file]);
    if (uploaded) {
      setPastedTextName("");
      setPastedTextValue("");
    }
  }

  const isCreateMode = !editingOpportunityId;
  const suggestedFields = documentReview?.suggestedFields || null;
  const preview = buildDocumentPreview(previewDocument);
  const documentCount = Array.isArray(documents) ? documents.length : 0;
  const reviewReadyCount = documents.filter(
    (document) => document.processingStatus === "review_ready",
  ).length;
  const processingCount = documents.filter(
    (document) => document.processingStatus === "processing",
  ).length;
  const compactSuggestions = suggestedFields
    ? [
        {
          key: "name",
          kind: "field",
          label: "Nombre",
          value:
            String(
              documentReviewOverrides?.fieldOverrides?.name || "",
            ).trim() ||
            suggestedFields.suggestedName ||
            (Array.isArray(suggestedFields.suggestedNameOptions) &&
            suggestedFields.suggestedNameOptions.length
              ? `${suggestedFields.suggestedNameOptions.length} opciones detectadas`
              : "Sin sugerencia"),
          canApply: Boolean(
            String(documentReviewOverrides?.fieldOverrides?.name || "").trim(),
          ),
          isApplied: Boolean(documentReviewApplied?.fieldKeys?.name),
          onApply: () =>
            onApplyFieldSuggestion("name", "Nombre aplicado al borrador"),
        },
        {
          key: "amountUsd",
          kind: "field",
          label: "Monto",
          value:
            String(
              documentReviewOverrides?.fieldOverrides?.amountUsd || "",
            ).trim() ||
            suggestedFields.suggestedAmountUsd === null ||
            suggestedFields.suggestedAmountUsd === undefined
              ? "Sin monto detectado"
              : String(
                  documentReviewOverrides?.fieldOverrides?.amountUsd ||
                    suggestedFields.suggestedAmountUsd,
                ),
          canApply: Boolean(
            String(
              documentReviewOverrides?.fieldOverrides?.amountUsd || "",
            ).trim(),
          ),
          isApplied: Boolean(documentReviewApplied?.fieldKeys?.amountUsd),
          onApply: () =>
            onApplyFieldSuggestion("amountUsd", "Monto aplicado al borrador"),
        },
        {
          key: "closeDate",
          kind: "field",
          label: "Cierre",
          value:
            String(documentReviewOverrides?.fieldOverrides?.closeDate || "") ||
            suggestedFields.suggestedCloseDate ||
            "Sin fecha detectada",
          canApply: Boolean(
            String(
              documentReviewOverrides?.fieldOverrides?.closeDate || "",
            ).trim(),
          ),
          isApplied: Boolean(documentReviewApplied?.fieldKeys?.closeDate),
          onApply: () =>
            onApplyFieldSuggestion(
              "closeDate",
              "Fecha de cierre aplicada al borrador",
            ),
        },
        ...(hasMatchSuggestion(suggestedFields.matchedAccount)
          ? [
              {
                key: "account",
                kind: "match",
                label: "Cuenta",
                value: renderMatchLabel(suggestedFields.matchedAccount),
                canApply: Boolean(
                  String(
                    documentReviewOverrides?.matchSelections?.accountId || "",
                  ).trim(),
                ),
                isApplied: Boolean(documentReviewApplied?.matchKeys?.accountId),
                onApply: () =>
                  onApplyMatchSuggestion(
                    "accountId",
                    "Cuenta aplicada al borrador",
                  ),
              },
            ]
          : []),
        ...(hasMatchSuggestion(suggestedFields.matchedContact)
          ? [
              {
                key: "contact",
                kind: "match",
                label: "Contacto",
                value: renderMatchLabel(suggestedFields.matchedContact),
                canApply: Boolean(
                  String(
                    documentReviewOverrides?.matchSelections?.contactId || "",
                  ).trim(),
                ),
                isApplied: Boolean(documentReviewApplied?.matchKeys?.contactId),
                onApply: () =>
                  onApplyMatchSuggestion(
                    "contactId",
                    "Contacto aplicado al borrador",
                  ),
              },
            ]
          : []),
      ]
    : [];

  return (
    <section className="account-form-section opportunity-documents-section">
      <div className="opportunity-documents-section-header">
        <div>
          <h4>
            {isCreateMode
              ? "Documentos de referencia"
              : "Repositorio documental"}
          </h4>
          <p className="field-hint opportunity-documents-hint">
            {isCreateMode
              ? "Carga archivos para extraer contexto, detectar coincidencias internas y rellenar el borrador antes de crear la oportunidad."
              : "Consulta y agrega documentos ya vinculados a la oportunidad para conservar evidencia comercial reutilizable."}
          </p>
        </div>
      </div>

      <div
        className={`opportunity-documents-toolbar-card${
          documentCount ? " has-documents" : " is-empty"
        }`}
      >
        <div className="opportunity-documents-toolbar-head">
          <div className="opportunity-documents-toolbar-copy">
            <span className="opportunity-documents-toolbar-eyebrow">
              Analisis documental asistido
            </span>
            <strong>
              {documentCount
                ? "Repositorio listo para enriquecer el borrador"
                : "Sube la evidencia comercial para arrancar el borrador"}
            </strong>
            <p className="field-hint opportunity-documents-toolbar-hint">
              {documentCount
                ? "Cada archivo analizado puede sugerir nombre, monto, etapa, cuenta y contactos antes de guardar la oportunidad."
                : "Carga evidencia comercial para extraer contexto, detectar coincidencias internas y construir una primera propuesta automaticamente."}
            </p>
          </div>

          <div className="opportunity-documents-toolbar-actions">
            {!documentCount || !isCreateMode ? (
              <label className="btn-secondary opportunity-documents-upload-button">
                <input
                  type="file"
                  multiple
                  accept=".pdf,.docx,.xlsx,.xls,.csv,.txt,.eml,.png,.jpg,.jpeg,.mp3,.wav,.m4a"
                  onChange={(event) => {
                    const nextFiles = event.target.files;
                    if (nextFiles?.length) {
                      onUploadFiles(nextFiles);
                    }
                    event.target.value = "";
                  }}
                  disabled={
                    loadingDocumentSession ||
                    loadingOpportunityDocuments ||
                    uploadingOpportunityDocuments
                  }
                />
                <span
                  className="opportunity-documents-upload-button-icon"
                  aria-hidden="true"
                >
                  {uploadingOpportunityDocuments ? "…" : "+"}
                </span>
                <span className="opportunity-documents-upload-button-text">
                  {uploadingOpportunityDocuments
                    ? "Subiendo..."
                    : isCreateMode
                      ? "Cargar y analizar archivos"
                      : "Agregar documentos"}
                </span>
              </label>
            ) : isCreateMode ? (
              <label className="btn-secondary opportunity-documents-upload-button">
                <input
                  type="file"
                  multiple
                  accept=".pdf,.docx,.xlsx,.xls,.csv,.txt,.eml,.png,.jpg,.jpeg,.mp3,.wav,.m4a"
                  onChange={(event) => {
                    const nextFiles = event.target.files;
                    if (nextFiles?.length) {
                      onUploadFiles(nextFiles);
                    }
                    event.target.value = "";
                  }}
                  disabled={
                    loadingDocumentSession ||
                    loadingOpportunityDocuments ||
                    uploadingOpportunityDocuments
                  }
                />
                <span
                  className="opportunity-documents-upload-button-icon"
                  aria-hidden="true"
                >
                  {uploadingOpportunityDocuments ? "…" : "+"}
                </span>
                <span className="opportunity-documents-upload-button-text">
                  {uploadingOpportunityDocuments
                    ? "Subiendo..."
                    : "Subir y analizar mas archivos"}
                </span>
              </label>
            ) : null}
            <span className="field-hint opportunity-documents-toolbar-formats">
              Formatos: PDF, DOCX, XLSX, CSV, TXT, EML, imagen y audio.
            </span>
          </div>
        </div>

        <div className="opportunity-documents-toolbar-body">
          <div className="opportunity-documents-toolbar-overview">
            <div className="opportunity-documents-toolbar-badges">
              <span className="opportunity-documents-toolbar-badge">
                <strong>{documentCount}</strong>
                <span>documento{documentCount === 1 ? "" : "s"}</span>
              </span>
              <span className="opportunity-documents-toolbar-badge">
                <strong>{reviewReadyCount}</strong>
                <span>analizado{reviewReadyCount === 1 ? "" : "s"}</span>
              </span>
              <span className="opportunity-documents-toolbar-badge">
                <strong>{processingCount}</strong>
                <span>en analisis</span>
              </span>
            </div>
            <div className="opportunity-documents-toolbar-summary-card">
              <strong>Que puedes hacer aqui</strong>
              <ul className="opportunity-documents-toolbar-summary-list">
                <li>Adjuntar correos, propuestas, minutas y cotizaciones.</li>
                <li>
                  Pegar texto libre como evidencia adicional
                  {isCreateMode ? " del borrador." : " de la oportunidad."}
                </li>
                <li>
                  {isCreateMode
                    ? "Aplicar solo las sugerencias utiles antes de guardar."
                    : "Centralizar evidencia adicional para el seguimiento comercial."}
                </li>
              </ul>
            </div>

            {documents.length ? (
              <div className="opportunity-documents-toolbar-list">
                <div className="opportunity-documents-list">
                  {documents.map((document) => (
                    <article
                      key={document.publicId}
                      className={`opportunity-documents-card${
                        isCreateMode
                          ? " opportunity-documents-card-compact"
                          : ""
                      }`}
                    >
                      <div className="opportunity-documents-card-header">
                        <div className="opportunity-documents-card-summary">
                          <strong
                            className="opportunity-documents-card-title"
                            title={document.originalFileName}
                          >
                            {document.originalFileName}
                          </strong>
                          {isCreateMode ? (
                            <span className="field-hint opportunity-documents-card-meta">
                              {renderDocumentStatus(document)}
                            </span>
                          ) : null}
                        </div>
                        <div className="opportunity-documents-card-actions">
                          <button
                            type="button"
                            className="opportunity-documents-apply-icon-button opportunity-documents-file-action-button"
                            onClick={() => openDocumentPreview(document)}
                            aria-label={`Ver contenido de ${document.originalFileName}`}
                            title={`Ver contenido de ${document.originalFileName}`}
                          >
                            i
                          </button>
                          {isCreateMode ? (
                            <button
                              type="button"
                              className="opportunity-documents-apply-icon-button opportunity-documents-file-action-button danger"
                              onClick={() => onDeleteDocument(document.publicId)}
                              disabled={
                                deletingOpportunityDocumentId ===
                                document.publicId
                              }
                              aria-label={`Quitar ${document.originalFileName}`}
                              title={`Quitar ${document.originalFileName}`}
                            >
                              {deletingOpportunityDocumentId ===
                              document.publicId
                                ? "…"
                                : "×"}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="opportunity-documents-paste-card">
              <div className="opportunity-documents-paste-card-head">
                <strong>Analizar texto pegado</strong>
                <p className="field-hint opportunity-documents-paste-hint">
                  Convierte notas, correos o briefs en un documento `.txt`
                  dentro del mismo repositorio
                  {isCreateMode ? " del borrador." : " documental de la oportunidad."}
                </p>
              </div>
              <div className="field-group opportunity-documents-paste-name-group">
                <label htmlFor="opportunity-pasted-text-name">
                  Nombre del texto
                </label>
                <input
                  id="opportunity-pasted-text-name"
                  type="text"
                  value={pastedTextName}
                  onChange={(event) => setPastedTextName(event.target.value)}
                  placeholder="Ej. resumen de llamada o correo pegado"
                  maxLength={80}
                  disabled={
                    loadingDocumentSession ||
                    loadingOpportunityDocuments ||
                    uploadingOpportunityDocuments
                  }
                />
              </div>
              <div className="field-group opportunity-documents-paste-text-group">
                <label htmlFor="opportunity-pasted-text-body">
                  Pegar texto para analizar
                </label>
                <textarea
                  id="opportunity-pasted-text-body"
                  value={pastedTextValue}
                  onChange={(event) => setPastedTextValue(event.target.value)}
                  placeholder="Pega aqui el correo, minuta, brief o contexto comercial que quieras analizar como un documento mas."
                  disabled={
                    loadingDocumentSession ||
                    loadingOpportunityDocuments ||
                    uploadingOpportunityDocuments
                  }
                />
              </div>
              <button
                type="button"
                className="btn-secondary opportunity-documents-paste-submit"
                onClick={handleUploadPastedText}
                disabled={
                  loadingDocumentSession ||
                  loadingOpportunityDocuments ||
                  uploadingOpportunityDocuments ||
                  !String(pastedTextValue || "").trim()
                }
              >
                {uploadingOpportunityDocuments
                  ? "Agregando texto..."
                  : "Agregar texto al analisis"}
              </button>
            </div>
        </div>
      </div>

      {loadingDocumentSession ? (
        <p className="field-hint opportunity-documents-empty">
          Preparando sesion documental...
        </p>
      ) : null}

      {loadingOpportunityDocuments ? (
        <p className="field-hint opportunity-documents-empty">
          Cargando documentos vinculados...
        </p>
      ) : null}

      {isCreateMode && suggestedFields && compactSuggestions.length ? (
        <div className="opportunity-documents-review-card opportunity-documents-review-card-compact">
          <div className="opportunity-documents-review-header">
            <div>
              <strong>Sugerencias</strong>
              <p className="field-hint opportunity-documents-review-hint">
                Aplica solo lo util al borrador.
              </p>
            </div>
            <button
              type="button"
              className="opportunity-documents-apply-icon-button opportunity-documents-apply-all-button"
              onClick={() =>
                onApplySuggestions({
                  successMessage:
                    "Sugerencias documentales aplicadas al borrador",
                })
              }
              disabled={
                applyingDocumentSuggestions || !documentReview?.canApply
              }
              aria-label={
                applyingDocumentSuggestions
                  ? "Aplicando sugerencias"
                  : "Aplicar todas las sugerencias al borrador"
              }
              title={
                applyingDocumentSuggestions
                  ? "Aplicando sugerencias"
                  : "Aplicar todas las sugerencias"
              }
            >
              {applyingDocumentSuggestions ? "…" : "✓"}
            </button>
          </div>

          <div className="opportunity-documents-suggestion-grid opportunity-documents-suggestion-grid-compact">
            {compactSuggestions.map((item) => (
              <div
                key={item.key}
                className={`opportunity-documents-suggestion-item${
                  item.isApplied ? " is-applied" : ""
                }`}
              >
                <div className="opportunity-documents-suggestion-item-head">
                  <span className="opportunity-documents-suggestion-label">
                    {item.label}
                  </span>
                  <button
                    type="button"
                    className="opportunity-documents-apply-icon-button opportunity-documents-apply-field-button"
                    onClick={item.onApply}
                    disabled={
                      applyingDocumentSuggestions ||
                      !item.canApply ||
                      item.isApplied
                    }
                    aria-label={`Aplicar ${item.label}`}
                    title={`Aplicar ${item.label}`}
                  >
                    {applyingDocumentSuggestions ? "…" : "↗"}
                  </button>
                </div>
                <strong
                  className="opportunity-documents-suggestion-value"
                  title={item.value}
                >
                  {item.value}
                </strong>
                {item.isApplied ? (
                  <span className="opportunity-documents-suggestion-applied-note">
                    Ya se aplico.
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {previewDocument ? (
        <div className="modal-overlay" onClick={() => setPreviewDocument(null)}>
          <div
            className="modal-dialog modal-dialog-account opportunity-document-preview-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div className="opportunity-modal-header-copy">
                <h3 className="modal-title">Contenido del documento</h3>
                <p className="field-hint opportunity-document-preview-file-name">
                  {previewDocument.originalFileName}
                </p>
              </div>
              <div className="opportunity-document-preview-actions">
                <button
                  type="button"
                  className="opportunity-documents-apply-icon-button"
                  onClick={() =>
                    onDownloadDocument(
                      previewDocument.publicId,
                      previewDocument.originalFileName,
                    )
                  }
                  aria-label={`Descargar ${previewDocument.originalFileName}`}
                  title={`Descargar ${previewDocument.originalFileName}`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="opportunity-documents-apply-icon-button"
                  onClick={() => setPreviewDocument(null)}
                  aria-label="Cerrar vista previa del documento"
                  title="Cerrar"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="opportunity-document-preview-body">
              <div className="opportunity-document-preview-meta">
                <span className="record-id-badge">{preview.heading}</span>
                <span className="record-id-badge">
                  {renderDocumentStatus(previewDocument)}
                </span>
                {previewDocument.previewLoading ? (
                  <span className="record-id-badge">
                    Cargando texto completo
                  </span>
                ) : null}
              </div>
              {previewDocument.previewError ? (
                <p className="field-hint opportunity-document-preview-error">
                  {previewDocument.previewError}
                </p>
              ) : null}
              <pre className="opportunity-document-preview-text">
                {preview.text}
              </pre>
            </div>
          </div>
        </div>
      ) : null}

      {!documents.length &&
      !loadingDocumentSession &&
      !loadingOpportunityDocuments ? (
        <div className="opportunity-documents-empty-state">
          <div className="opportunity-documents-empty-state-copy">
            <strong>
              {isCreateMode
                ? "Todavia no hay documentos cargados para este borrador"
                : "Esta oportunidad todavia no tiene documentos vinculados"}
            </strong>
            <p className="field-hint opportunity-documents-empty">
              {isCreateMode
                ? "Empieza con propuestas, minutas, correos o cotizaciones para que el asistente prepare un borrador mas completo desde el inicio."
                : "Agrega material comercial para mantener el contexto centralizado y reutilizable durante el seguimiento."}
            </p>
          </div>

          <div className="opportunity-documents-empty-state-grid">
            <div className="opportunity-documents-empty-state-card">
              <strong>1. Carga evidencia</strong>
              <span>Adjunta archivos comerciales, tecnicos o de contexto.</span>
            </div>
            <div className="opportunity-documents-empty-state-card">
              <strong>2. Revisa sugerencias</strong>
              <span>
                El sistema propone nombre, monto, fecha y coincidencias
                internas.
              </span>
            </div>
            <div className="opportunity-documents-empty-state-card">
              <strong>3. Aplica al borrador</strong>
              <span>
                Usa solo los datos utiles antes de registrar la oportunidad.
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default OpportunityDocumentsPanel;
