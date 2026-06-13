import { useRef } from "react";

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

function OpportunityAiIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        d="M12 3.75a.75.75 0 0 1 .73.58l.52 2.21a3 3 0 0 0 2.23 2.23l2.21.52a.75.75 0 0 1 0 1.46l-2.21.52a3 3 0 0 0-2.23 2.23l-.52 2.21a.75.75 0 0 1-1.46 0l-.52-2.21a3 3 0 0 0-2.23-2.23l-2.21-.52a.75.75 0 0 1 0-1.46l2.21-.52a3 3 0 0 0 2.23-2.23l.52-2.21A.75.75 0 0 1 12 3.75Zm6.25 11.5a.75.75 0 0 1 .73.58l.18.77a1.5 1.5 0 0 0 1.11 1.11l.77.18a.75.75 0 0 1 0 1.46l-.77.18a1.5 1.5 0 0 0-1.11 1.11l-.18.77a.75.75 0 0 1-1.46 0l-.18-.77a1.5 1.5 0 0 0-1.11-1.11l-.77-.18a.75.75 0 0 1 0-1.46l.77-.18a1.5 1.5 0 0 0 1.11-1.11l.18-.77a.75.75 0 0 1 .73-.58Zm-12.5 2a.75.75 0 0 1 .73.58l.13.55a1.25 1.25 0 0 0 .92.92l.55.13a.75.75 0 0 1 0 1.46l-.55.13a1.25 1.25 0 0 0-.92.92l-.13.55a.75.75 0 0 1-1.46 0l-.13-.55a1.25 1.25 0 0 0-.92-.92l-.55-.13a.75.75 0 0 1 0-1.46l.55-.13a1.25 1.25 0 0 0 .92-.92l.13-.55a.75.75 0 0 1 .73-.58Z"
        fill="currentColor"
      />
    </svg>
  );
}

function OpportunityCopyIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M9.25 8.25A1.75 1.75 0 0 1 11 6.5h6.25A1.75 1.75 0 0 1 19 8.25v8.5a1.75 1.75 0 0 1-1.75 1.75H11a1.75 1.75 0 0 1-1.75-1.75z" />
      <path d="M7 9.5H6.75A1.75 1.75 0 0 1 5 7.75v-3.5A1.75 1.75 0 0 1 6.75 2.5h4.5A1.75 1.75 0 0 1 13 4.25V5" />
    </svg>
  );
}

export default function OpportunityOperationEmailModal({
  isOpen,
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

  if (!isOpen || !draft) {
    return null;
  }

  const status = googleMailStatus || {};
  const canSendViaGoogle = Boolean(status.canSend);
  const selectedLibraryIds = Array.isArray(selectedLibraryAttachmentIds)
    ? selectedLibraryAttachmentIds
    : [];
  const selectedCount = selectedLibraryIds.length;
  const safeMaxLibraryAssets = Number(maxLibraryAssets || 3);

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

    if (sourceType === "opportunity_document") {
      return "Local";
    }
    if (sourceType === "library_file") {
      return selectionSource === "library_ai"
        ? "Biblioteca (IA)"
        : "Biblioteca (manual)";
    }
    return String(attachment?.sourceLabel || "Adjunto").trim() || "Adjunto";
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

        {error ? <p className="form-error">{error}</p> : null}
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
            <p className="field-hint">
              Debes conectar Google con permisos de envio para continuar.
            </p>
          ) : null}
          {!canSendViaGoogle ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={onConnectGoogleMail}
              disabled={sending || status.loading}
            >
              {status.connected ? "Re-conectar Google" : "Conectar Google"}
            </button>
          ) : null}
        </div>

        <div className="opportunity-operation-email-form-grid">
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
              title="Edita el destinatario si necesitas enviar a otro correo"
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
            <small
              className="field-hint opportunity-operation-email-hint-placeholder"
              aria-hidden="true"
            >
              Destinatario fijo: contacto de la oportunidad.
            </small>
          </label>
          <label className="is-span-2">
            Asunto
            <input
              value={draft.subject}
              disabled={sending}
              onChange={(event) => onChangeField("subject", event.target.value)}
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
              <span id="opportunity-operation-email-ai-instructions-label">
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
                  generatingAiDraft ? "Generando..." : "Generar borrador con IA"
                }
              >
                <OpportunityAiIcon />
                <span>Generar IA</span>
              </button>
            </div>
            <small className="field-hint" aria-live="polite">
              {generatingAiDraft
                ? "Generando borrador con IA..."
                : "Describe el tono y el objetivo. La IA devolverá una sugerencia lista para copiar."}
            </small>

            <div className="opportunity-operation-email-ai-fields">
              <label className="opportunity-operation-email-ai-field">
                <span>Instrucciones</span>
                <textarea
                  rows={3}
                  value={aiInstructionText}
                  aria-labelledby="opportunity-operation-email-ai-instructions-label"
                  disabled={sending || generatingAiDraft}
                  onChange={(event) =>
                    onChangeAiInstruction(event.target.value)
                  }
                  placeholder="Ejemplo: tono ejecutivo, breve, incluir llamado a la accion y fecha compromiso."
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
                    <OpportunityCopyIcon />
                    <span>Usar sugerencia</span>
                  </button>
                </div>
                {aiSuggestionSubject ? (
                  <small className="field-hint opportunity-operation-email-ai-suggestion-subject">
                    Asunto sugerido: {aiSuggestionSubject}
                  </small>
                ) : null}
                <textarea
                  rows={5}
                  value={aiSuggestionMessageBody || ""}
                  readOnly
                  placeholder="La sugerencia generada por la IA aparecerá aqui."
                />
                <small className="field-hint">
                  Puedes copiar esta sugerencia o seguir editando el borrador.
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
                  className="btn-secondary"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={
                    sending || generatingAiDraft || generatingAiAttachments
                  }
                >
                  Agregar archivos
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
                  disabled={
                    sending ||
                    generatingAiDraft ||
                    generatingAiAttachments ||
                    !String(aiInstructionText || "").trim()
                  }
                  aria-label="Sugerir adjuntos de biblioteca con IA"
                  title="Sugerir adjuntos de biblioteca con IA"
                >
                  <OpportunityAiIcon />
                  <span>
                    {generatingAiAttachments ? "Sugiriendo..." : "IA Adjuntos"}
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
                  onChange={(event) => onChangeLibraryQuery(event.target.value)}
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
                  ) : Array.isArray(libraryOptions) && libraryOptions.length ? (
                    libraryOptions.slice(0, 3).map((asset) => {
                      const isSelected = selectedLibraryIds.includes(asset.id);
                      const reachedLimit =
                        !isSelected && selectedCount >= safeMaxLibraryAssets;
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
                            onChange={() => onToggleLibraryAttachment(asset.id)}
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
                      No hay activos de biblioteca disponibles con ese filtro.
                    </p>
                  )}
                </div>
              </div>
            </section>
          </div>

          <div className="opportunity-operation-email-attachments-list">
            {(draft.attachments || []).length ? (
              draft.attachments.map((attachment) => (
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
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => onRemoveAttachment(attachment.id)}
                    disabled={
                      sending || generatingAiDraft || generatingAiAttachments
                    }
                  >
                    Quitar
                  </button>
                </div>
              ))
            ) : (
              <p className="field-hint">No hay adjuntos seleccionados.</p>
            )}
          </div>
        </div>

        <div className="modal-buttons">
          <button
            type="button"
            className="btn-primary"
            onClick={onRequestSend}
            disabled={sending || status.loading || !canSendViaGoogle}
          >
            {sending ? "Enviando..." : "Enviar correo"}
          </button>
        </div>
      </div>
    </div>
  );
}
