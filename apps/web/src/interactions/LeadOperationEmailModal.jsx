import { useEffect, useRef, useState } from "react";
import { api } from "../api";

function formatBytes(value) {
  const size = Number(value || 0);
  if (!Number.isFinite(size) || size <= 0) {
    return "0 B";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function AiIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        d="M12 3.75a.75.75 0 0 1 .73.58l.52 2.21a3 3 0 0 0 2.23 2.23l2.21.52a.75.75 0 0 1 0 1.46l-2.21.52a3 3 0 0 0-2.23 2.23l-.52 2.21a.75.75 0 0 1-1.46 0l-.52-2.21a3 3 0 0 0-2.23-2.23l-2.21-.52a.75.75 0 0 1 0-1.46l2.21-.52a3 3 0 0 0 2.23-2.23l.52-2.21A.75.75 0 0 1 12 3.75Zm6.25 11.5a.75.75 0 0 1 .73.58l.18.77a1.5 1.5 0 0 0 1.11 1.11l.77.18a.75.75 0 0 1 0 1.46l-.77.18a1.5 1.5 0 0 0-1.11 1.11l-.18.77a.75.75 0 0 1-1.46 0l-.18-.77a1.5 1.5 0 0 0-1.11-1.11l-.77-.18a.75.75 0 0 1 0-1.46l.77-.18a1.5 1.5 0 0 0 1.11-1.11l.18-.77a.75.75 0 0 1 .73-.58Zm-12.5 2a.75.75 0 0 1 .73.58l.13.55a1.25 1.25 0 0 0 .92.92l.55.13a.75.75 0 0 1 0 1.46l-.55.13a1.25 1.25 0 0 0-.92.92l-.13.55a.75.75 0 0 1-1.46 0l-.13-.55a1.25 1.25 0 0 0-.92-.92l-.55-.13a.75.75 0 0 1 0-1.46l.55-.13a1.25 1.25 0 0 0 .92-.92l.13-.55a.75.75 0 0 1 .73-.58Z"
        fill="currentColor"
      />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M9.25 8.25A1.75 1.75 0 0 1 11 6.5h6.25A1.75 1.75 0 0 1 19 8.25v8.5a1.75 1.75 0 0 1-1.75 1.75H11a1.75 1.75 0 0 1-1.75-1.75z" />
      <path d="M7 9.5H6.75A1.75 1.75 0 0 1 5 7.75v-3.5A1.75 1.75 0 0 1 6.75 2.5h4.5A1.75 1.75 0 0 1 13 4.25V5" />
    </svg>
  );
}

function PreviewIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M1.75 12s3.6-6 10.25-6 10.25 6 10.25 6-3.6 6-10.25 6S1.75 12 1.75 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M10 5 3 12l7 7" />
      <path d="M3 12h18" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M21.5 3.5 10 15" />
      <path d="M21.5 3.5 14.5 20.5 10 15 3.5 10.5 21.5 3.5Z" />
    </svg>
  );
}

function AttachmentAddIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M12 5.5v13" />
      <path d="M5.5 12h13" />
    </svg>
  );
}

function GoogleConnectIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M13 4.5a7.5 7.5 0 1 0 0 15h3.5" />
      <path d="M19 8.5v7" />
      <path d="M15.5 12h7" />
    </svg>
  );
}

function AttachmentDownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M12 3.5v11" />
      <path d="m8 10.5 4 4 4-4" />
      <path d="M4.5 16.5v2a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}

function AttachmentRemoveIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M4.5 7.5h15" />
      <path d="M9.5 7.5v-2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2" />
      <path d="M8 7.5l.75 11a1 1 0 0 0 1 .93h4.5a1 1 0 0 0 1-.93L16 7.5" />
      <path d="M10.25 10.5v6" />
      <path d="M13.75 10.5v6" />
    </svg>
  );
}

const MAIL_TYPE_OPTIONS = [
  { value: "company_intro", label: "Correo inicial de presentacion" },
  { value: "solution_detail", label: "Correo con detalle de solucion" },
  { value: "meeting_request", label: "Solicitud de reunion" },
  { value: "demo_request", label: "Solicitud de demostracion" },
];

export default function LeadOperationEmailModal({
  isOpen,
  interactionId,
  draft,
  sending,
  generatingAiDraft,
  generatingAiAttachments,
  error,
  notice,
  libraryError,
  googleMailStatus,
  aiInstructionText,
  aiSuggestionSubject,
  aiSuggestionMessageBody,
  aiSuggestionSource,
  aiSuggestionSourceReason,
  libraryQuery,
  libraryOptions,
  libraryLoading,
  selectedLibraryAttachmentIds,
  maxLibraryAssets,
  onClose,
  onChangeField,
  onChangeAiInstruction,
  onChangeLibraryQuery,
  onToggleLibraryAttachment,
  onAddAttachments,
  onRemoveAttachment,
  onRequestAiDraft,
  onRequestAiAttachments,
  onUseAiSuggestion,
  onRequestSend,
  onConnectGoogleMail,
}) {
  const fileInputRef = useRef(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewError, setPreviewError] = useState("");

  const status = googleMailStatus || {};
  const canSendViaGoogle =
    Boolean(status.canSend) &&
    !Boolean(status.missingScope) &&
    !Boolean(status.needsReconnect);
  const selectedLibraryIds = Array.isArray(selectedLibraryAttachmentIds)
    ? selectedLibraryAttachmentIds
    : [];
  const selectedCount = selectedLibraryIds.length;
  const safeMaxLibraryAssets = Number(maxLibraryAssets || 3);
  const currentAttachments = Array.isArray(draft?.attachments)
    ? draft.attachments
    : [];
  const effectiveError = previewError || error;
  const normalizedAiSuggestionSource = String(aiSuggestionSource || "")
    .trim()
    .toLowerCase();
  const aiSuggestionSourceLabel =
    normalizedAiSuggestionSource === "openai"
      ? "Origen: IA"
      : normalizedAiSuggestionSource
        ? "Origen: fallback"
        : "";
  const normalizedAiSuggestionReason = String(aiSuggestionSourceReason || "")
    .trim()
    .toLowerCase();
  const aiSuggestionFallbackReasonLabel =
    normalizedAiSuggestionSource === "openai"
      ? ""
      : normalizedAiSuggestionReason === "missing_openai_api_key"
        ? "Motivo fallback: falta OPENAI_API_KEY"
        : normalizedAiSuggestionReason === "ai_budget_exceeded"
          ? "Motivo fallback: saldo IA insuficiente"
          : normalizedAiSuggestionReason === "openai_request_failed"
            ? "Motivo fallback: fallo de llamada a OpenAI"
            : normalizedAiSuggestionReason
              ? "Motivo fallback: error de generacion IA"
              : "";

  useEffect(() => {
    if (!isOpen) {
      setIsPreviewOpen(false);
      setPreviewError("");
    }
  }, [isOpen]);

  useEffect(() => {
    setPreviewError("");
  }, [draft?.recipient, draft?.subject, draft?.messageBody]);

  function validateDraftForPreview() {
    const recipient = String(draft?.recipient || "").trim();
    const subject = String(draft?.subject || "").trim();
    const messageBody = String(draft?.messageBody || "").trim();

    if (!recipient) {
      return "Indica el destinatario principal.";
    }
    if (!subject) {
      return "Indica el asunto del correo.";
    }
    if (!messageBody) {
      return "El mensaje no puede ir vacio.";
    }
    return "";
  }

  function handleOpenPreview() {
    const validationMessage = validateDraftForPreview();
    if (validationMessage) {
      setPreviewError(validationMessage);
      return;
    }
    setPreviewError("");
    setIsPreviewOpen(true);
  }

  if (!isOpen || !draft) {
    return null;
  }

  function handleFilesChange(event) {
    const files = Array.from(event.target.files || []);
    if (files.length) {
      onAddAttachments(files);
    }
    event.target.value = "";
  }

  function getAttachmentOriginLabel(attachment) {
    const sourceType = String(attachment?.sourceType || "").trim();
    const selectionSource = String(attachment?.selectionSource || "").trim();

    if (
      sourceType === "interaction_document" ||
      sourceType === "local_upload"
    ) {
      return "Local";
    }
    if (sourceType === "library_file") {
      return selectionSource === "library_ai"
        ? "Biblioteca (IA)"
        : "Biblioteca (manual)";
    }
    return String(attachment?.sourceLabel || "Adjunto").trim() || "Adjunto";
  }

  function getAttachmentDownloadUrl(attachment) {
    const sourceType = String(attachment?.sourceType || "").trim();
    if (sourceType === "local_upload") {
      return "local-upload";
    }
    if (sourceType === "interaction_document") {
      const documentPublicId = String(
        attachment?.documentPublicId || "",
      ).trim();
      if (!documentPublicId || !interactionId) return "";
      return `/api/interactions/${encodeURIComponent(interactionId)}/documents/${encodeURIComponent(documentPublicId)}/download`;
    }
    if (sourceType === "library_file") {
      const assetPublicId = String(attachment?.resourcePublicId || "").trim();
      const filePublicId = String(attachment?.filePublicId || "").trim();
      if (!assetPublicId || !filePublicId) return "";
      return `/api/commercial-enablement/assets/${encodeURIComponent(assetPublicId)}/files/${encodeURIComponent(filePublicId)}/content`;
    }
    return "";
  }

  async function handleDownloadAttachment(attachment) {
    if (typeof window === "undefined") return;
    if (String(attachment?.sourceType || "").trim() === "local_upload") {
      const file = attachment?.file;
      if (!(file instanceof File)) return;
      const objectUrl = window.URL.createObjectURL(file);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download =
        String(file.name || attachment?.fileName || "archivo").trim() ||
        "archivo";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(objectUrl);
      return;
    }
    const targetUrl = getAttachmentDownloadUrl(attachment);
    if (!targetUrl) return;

    try {
      const response = await api.get(targetUrl, { responseType: "blob" });
      const blob = response?.data;
      if (!(blob instanceof Blob)) {
        throw new Error("download_failed");
      }

      const contentDisposition = String(
        response?.headers?.["content-disposition"] || "",
      ).trim();
      const encodedNameMatch = contentDisposition.match(
        /filename\*=UTF-8''([^;]+)/i,
      );
      const plainNameMatch = contentDisposition.match(/filename="?([^";]+)"?/i);

      const headerFileName = encodedNameMatch?.[1]
        ? decodeURIComponent(encodedNameMatch[1])
        : plainNameMatch?.[1] || "";

      const objectUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download =
        String(headerFileName || attachment?.fileName || "documento").trim() ||
        "documento";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(objectUrl);
    } catch {
      // Keep silent here; modal-level notices already communicate API failures.
    }
  }

  return (
    <div
      className="modal-overlay"
      onClick={(event) => {
        if (
          event.target === event.currentTarget &&
          !sending &&
          !generatingAiDraft
        ) {
          onClose();
        }
      }}
    >
      <div className="modal-dialog opportunity-operation-email-modal">
        <div className="modal-header">
          <h3>Enviar correo al contacto</h3>
          <button
            type="button"
            className="opportunity-documents-apply-icon-button account-modal-close-button"
            onClick={onClose}
            disabled={sending || generatingAiDraft}
            aria-label="Cerrar"
            title="Cerrar"
          >
            ×
          </button>
        </div>

        {effectiveError ? <p className="form-error">{effectiveError}</p> : null}
        {notice ? <p className="field-hint">{notice}</p> : null}

        <div className="opportunity-operation-email-google-status">
          {status.loading ? (
            <p className="field-hint">Verificando conexion de Google...</p>
          ) : null}
          {!status.loading && canSendViaGoogle ? (
            <p className="field-hint">
              Envio habilitado con Google
              {status.googleEmail ? `: ${status.googleEmail}` : ""}
            </p>
          ) : null}
          {!status.loading && !canSendViaGoogle ? (
            <div className="opportunity-operation-email-google-connect-row">
              <button
                type="button"
                className="opportunity-operation-email-google-connect-icon-button"
                onClick={onConnectGoogleMail}
                disabled={sending || status.loading}
                aria-label={
                  status.connected
                    ? "Re-conectar Google. Es necesario para enviar el correo"
                    : "Conectar Google. Es necesario para enviar el correo"
                }
                title={
                  status.connected ? "Re-conectar Google" : "Conectar Google"
                }
              >
                <GoogleConnectIcon />
              </button>
              <p className="field-hint opportunity-operation-email-google-connect-help">
                {status.connected && status.missingScope
                  ? "Tu conexion de Google no incluye permiso de envio. Reconecta y acepta el permiso solicitado."
                  : "Conectar Google es obligatorio para enviar el correo."}
              </p>
            </div>
          ) : null}
        </div>

        {isPreviewOpen ? (
          <div
            className="opportunity-operation-email-preview"
            role="region"
            aria-label="Vista previa del correo"
          >
            <div className="opportunity-operation-email-preview-header">
              <h4>Vista previa del correo</h4>
              <p className="field-hint">Revisa el contenido antes de enviar.</p>
            </div>

            <div className="opportunity-operation-email-preview-meta">
              <p>
                <strong>Para:</strong>{" "}
                {String(draft.recipient || "").trim() || "-"}
              </p>
              <p>
                <strong>CC:</strong>{" "}
                {String(draft.cc || "").trim() || "Sin copia"}
              </p>
              <p>
                <strong>Asunto:</strong>{" "}
                {String(draft.subject || "").trim() || "-"}
              </p>
            </div>

            <div className="opportunity-operation-email-preview-message">
              <h5>Mensaje</h5>
              <div className="opportunity-operation-email-preview-message-body">
                {String(draft.messageBody || "").trim() || "Sin contenido"}
              </div>
            </div>

            <div className="opportunity-operation-email-preview-attachments">
              <h5>Adjuntos</h5>
              {currentAttachments.length ? (
                <ul>
                  {currentAttachments.map((attachment) => (
                    <li key={attachment.id}>
                      <strong>{attachment.fileName || "Adjunto"}</strong>
                      <span>
                        {formatBytes(attachment.byteSize || 0)} ·{" "}
                        {getAttachmentOriginLabel(attachment)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="field-hint">No hay adjuntos seleccionados.</p>
              )}
            </div>

            <div className="modal-buttons opportunity-operation-email-modal-actions">
              <button
                type="button"
                className="opportunity-operation-email-preview-icon-button"
                onClick={() => setIsPreviewOpen(false)}
                disabled={sending}
                aria-label="Volver a editar"
                title="Volver a editar"
              >
                <BackIcon />
              </button>
              <button
                type="button"
                className="opportunity-operation-email-preview-icon-button is-send"
                onClick={onRequestSend}
                disabled={sending || status.loading || !canSendViaGoogle}
                aria-label={sending ? "Enviando" : "Enviar ahora"}
                title={sending ? "Enviando" : "Enviar ahora"}
              >
                <SendIcon />
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="opportunity-operation-email-form-grid">
              <label>
                Tipo de correo
                <select
                  value={String(draft.purposeOther || "company_intro")}
                  disabled={sending}
                  onChange={(event) =>
                    onChangeField("purposeOther", event.target.value)
                  }
                >
                  {MAIL_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Para
                <input
                  type="email"
                  value={draft.recipient}
                  disabled={sending}
                  onChange={(event) =>
                    onChangeField("recipient", event.target.value)
                  }
                  placeholder="destinatario@cliente.com"
                  title="Edita el destinatario principal"
                />
                <small className="field-hint">
                  Puedes editar este destinatario antes de enviar.
                </small>
              </label>

              <label>
                CC
                <input
                  value={draft.cc}
                  disabled={sending}
                  onChange={(event) => onChangeField("cc", event.target.value)}
                  placeholder="equipo@cliente.com"
                />
              </label>

              <label className="is-span-2">
                Asunto
                <input
                  value={draft.subject}
                  disabled={sending}
                  onChange={(event) =>
                    onChangeField("subject", event.target.value)
                  }
                  placeholder="Seguimiento comercial"
                />
              </label>
              <label className="is-span-2">
                Mensaje
                <textarea
                  rows={7}
                  value={draft.messageBody}
                  disabled={sending}
                  onChange={(event) =>
                    onChangeField("messageBody", event.target.value)
                  }
                />
              </label>

              <section className="is-span-2 opportunity-operation-email-ai-instructions">
                <div className="opportunity-operation-email-ai-instructions-head">
                  <span id="lead-operation-email-ai-instructions-label">
                    IA
                  </span>
                  <button
                    type="button"
                    className="opportunity-operation-email-ai-icon-button"
                    onClick={onRequestAiDraft}
                    disabled={sending || generatingAiDraft}
                    aria-label={
                      generatingAiDraft
                        ? "Generando borrador con IA"
                        : "Generar borrador con IA"
                    }
                    title={
                      generatingAiDraft
                        ? "Generando..."
                        : "Generar borrador con IA"
                    }
                  >
                    <AiIcon />
                    <span>Generar IA</span>
                  </button>
                </div>
                <small className="field-hint" aria-live="polite">
                  {generatingAiDraft
                    ? "Generando borrador con IA..."
                    : "Describe el tono y el objetivo. La IA devolvera una sugerencia lista para copiar."}
                </small>

                <div className="opportunity-operation-email-ai-fields">
                  <label className="opportunity-operation-email-ai-field">
                    <span>Instrucciones</span>
                    <textarea
                      rows={3}
                      value={aiInstructionText}
                      aria-labelledby="lead-operation-email-ai-instructions-label"
                      disabled={sending || generatingAiDraft}
                      onChange={(event) =>
                        onChangeAiInstruction(event.target.value)
                      }
                      placeholder="Ejemplo: tono ejecutivo, breve, incluir llamado a la accion y fecha propuesta."
                    />
                  </label>

                  <div className="opportunity-operation-email-ai-suggestion">
                    <div className="opportunity-operation-email-ai-suggestion-head">
                      <span>Sugerencia</span>
                      <button
                        type="button"
                        className="opportunity-operation-email-ai-copy-button"
                        onClick={onUseAiSuggestion}
                        disabled={
                          sending ||
                          generatingAiDraft ||
                          !String(aiSuggestionMessageBody || "").trim()
                        }
                        aria-label="Copiar sugerencia al borrador"
                        title="Copiar sugerencia al borrador"
                      >
                        <CopyIcon />
                        <span>Usar sugerencia</span>
                      </button>
                    </div>
                    {aiSuggestionSubject ? (
                      <small className="field-hint opportunity-operation-email-ai-suggestion-subject">
                        Asunto sugerido: {aiSuggestionSubject}
                      </small>
                    ) : null}
                    {aiSuggestionSourceLabel ? (
                      <small className="field-hint opportunity-operation-email-ai-suggestion-source">
                        {aiSuggestionSourceLabel}
                      </small>
                    ) : null}
                    {aiSuggestionFallbackReasonLabel ? (
                      <small className="field-hint opportunity-operation-email-ai-suggestion-source">
                        {aiSuggestionFallbackReasonLabel}
                      </small>
                    ) : null}
                    <textarea
                      rows={5}
                      value={aiSuggestionMessageBody || ""}
                      readOnly
                      placeholder="La sugerencia generada por la IA aparecera aqui."
                    />
                    <small className="field-hint">
                      Puedes copiar esta sugerencia o seguir editando el
                      borrador.
                    </small>
                  </div>
                </div>
              </section>
            </div>

            <div className="opportunity-operation-email-attachments">
              <div className="opportunity-operation-email-attachments-header">
                <strong>Adjuntos</strong>
              </div>

              <div className="opportunity-operation-email-attachments-subsections">
                <section className="opportunity-operation-email-attachments-subsection">
                  <div className="opportunity-operation-email-subsection-head">
                    <strong>Adjuntar localmente</strong>
                    <button
                      type="button"
                      className="opportunity-operation-email-attach-icon-button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={
                        sending || generatingAiDraft || generatingAiAttachments
                      }
                      aria-label="Agregar archivos"
                      title="Agregar archivos"
                    >
                      <AttachmentAddIcon />
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="opportunity-operation-email-file-input"
                      onChange={handleFilesChange}
                    />
                  </div>
                  <p className="field-hint">
                    Carga archivos desde tu equipo para agregarlos al correo.
                  </p>
                </section>

                <section className="opportunity-operation-email-attachments-subsection">
                  <div className="opportunity-operation-email-subsection-head">
                    <strong>Adjuntar de biblioteca</strong>
                    <span className="field-hint">
                      Seleccionados: {selectedCount}/{safeMaxLibraryAssets}
                    </span>
                  </div>

                  <div className="opportunity-operation-email-library-tools">
                    <button
                      type="button"
                      className="opportunity-operation-email-ai-icon-button"
                      onClick={onRequestAiAttachments}
                      disabled={sending || generatingAiAttachments}
                      aria-label="Sugerir adjuntos de biblioteca con IA"
                      title="Sugerir adjuntos de biblioteca con IA"
                    >
                      <AiIcon />
                      <span>
                        {generatingAiAttachments
                          ? "Sugiriendo..."
                          : "IA Adjuntos"}
                      </span>
                    </button>
                  </div>

                  <label className="opportunity-operation-email-library-search">
                    <span>Buscar contenido</span>
                    <input
                      type="search"
                      value={libraryQuery}
                      disabled={
                        sending || generatingAiDraft || generatingAiAttachments
                      }
                      placeholder="Buscar por titulo, resumen o tipo"
                      onChange={(event) =>
                        onChangeLibraryQuery(event.target.value)
                      }
                    />
                  </label>

                  {libraryError ? (
                    <p className="form-error">{libraryError}</p>
                  ) : null}

                  <div className="opportunity-operation-email-library-picker">
                    <div className="opportunity-operation-email-library-picker-header">
                      <strong>Biblioteca comercial para adjuntar</strong>
                      <span className="field-hint">
                        Maximo 3 resultados visibles
                      </span>
                    </div>
                    <div className="opportunity-operation-email-library-options">
                      {libraryLoading ? (
                        <p className="field-hint">
                          Cargando biblioteca comercial...
                        </p>
                      ) : Array.isArray(libraryOptions) &&
                        libraryOptions.length ? (
                        libraryOptions.slice(0, 3).map((asset) => {
                          const isSelected = selectedLibraryIds.includes(
                            asset.id,
                          );
                          const reachedLimit =
                            !isSelected &&
                            selectedCount >= safeMaxLibraryAssets;
                          return (
                            <label
                              key={asset.id}
                              className={
                                isSelected
                                  ? "opportunity-operation-email-library-option is-selected"
                                  : "opportunity-operation-email-library-option"
                              }
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                disabled={
                                  sending ||
                                  generatingAiDraft ||
                                  generatingAiAttachments ||
                                  reachedLimit
                                }
                                onChange={() =>
                                  onToggleLibraryAttachment(asset.id)
                                }
                              />
                              <div>
                                <strong>
                                  {asset.fileName || asset.title || "Activo"}
                                </strong>
                                <small>
                                  {asset.sourceLabel || "Biblioteca"}
                                  {asset.assetTypeLabel
                                    ? ` · ${asset.assetTypeLabel}`
                                    : ""}
                                </small>
                              </div>
                            </label>
                          );
                        })
                      ) : (
                        <p className="field-hint">
                          No hay activos de biblioteca disponibles con ese
                          filtro.
                        </p>
                      )}
                    </div>
                  </div>
                </section>
              </div>

              <div className="opportunity-operation-email-attachments-list">
                {currentAttachments.length ? (
                  currentAttachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      className="opportunity-operation-email-attachment-item"
                    >
                      <div>
                        <strong>{attachment.fileName || "Adjunto"}</strong>
                        <small>
                          {formatBytes(attachment.byteSize || 0)} ·{" "}
                          {getAttachmentOriginLabel(attachment)}
                        </small>
                      </div>
                      <div className="opportunity-operation-email-attachment-actions">
                        <button
                          type="button"
                          className="opportunity-operation-email-attachment-icon-button"
                          onClick={() => handleDownloadAttachment(attachment)}
                          disabled={!getAttachmentDownloadUrl(attachment)}
                          aria-label={`Descargar documento: ${attachment.fileName || "Adjunto"}`}
                          title="Descargar documento"
                        >
                          <AttachmentDownloadIcon />
                        </button>
                        <button
                          type="button"
                          className="opportunity-operation-email-attachment-icon-button is-remove"
                          onClick={() => onRemoveAttachment(attachment.id)}
                          disabled={
                            sending ||
                            generatingAiDraft ||
                            generatingAiAttachments
                          }
                          aria-label={`Quitar adjunto: ${attachment.fileName || "Adjunto"}`}
                          title="Quitar adjunto"
                        >
                          <AttachmentRemoveIcon />
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="field-hint">No hay adjuntos seleccionados.</p>
                )}
              </div>
            </div>

            <div className="modal-buttons opportunity-operation-email-modal-actions">
              <button
                type="button"
                className="btn-secondary opportunity-operation-email-preview-button"
                onClick={handleOpenPreview}
                disabled={
                  sending || generatingAiDraft || generatingAiAttachments
                }
              >
                <PreviewIcon /> Vista previa
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
