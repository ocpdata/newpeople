import { useEffect, useRef, useState } from "react";
import "./proposal-print.css";

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

export default function ProposalEmailComposerModal({
  isOpen,
  draft,
  sending,
  error,
  notice,
  isConfirmingSend,
  onClose,
  onChangeField,
  onAddAttachments,
  onRemoveAttachment,
  onRequestSend,
  onCancelConfirm,
}) {
  const fileInputRef = useRef(null);
  const hasCcValue = Boolean(String(draft?.cc || "").trim());
  const [isCcVisible, setIsCcVisible] = useState(hasCcValue);

  useEffect(() => {
    setIsCcVisible(hasCcValue);
  }, [hasCcValue, isOpen]);

  if (!isOpen || !draft) {
    return null;
  }

  function handleOpenFilePicker() {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  }

  function handleFilesChange(event) {
    const files = Array.from(event.target.files || []);
    if (files.length) {
      onAddAttachments(files);
    }
    event.target.value = "";
  }

  return (
    <div
      className="modal-overlay modal-overlay-elevated proposal-email-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget && !sending) {
          onClose();
        }
      }}
    >
      <div className="modal-dialog proposal-email-modal">
        <div className="modal-header proposal-email-modal-header">
          <div>
            <h3 className="modal-title">Enviar propuesta por correo</h3>
            <p className="field-hint">
              Adjuntaremos automaticamente el PDF de la propuesta. Puedes sumar
              archivos extra desde tu dispositivo.
            </p>
          </div>
        </div>

        {error ? <p className="form-error">{error}</p> : null}
        {notice ? (
          <p className="proposal-email-modal-notice">{notice}</p>
        ) : null}

        <div className="proposal-email-form-grid">
          <label className="proposal-email-field">
            <span>Para</span>
            <input
              type="email"
              value={draft.to}
              disabled={sending}
              onChange={(event) => onChangeField("to", event.target.value)}
              placeholder="contacto@cliente.com"
            />
          </label>

          <label className="proposal-email-field">
            <span>Asunto</span>
            <input
              value={draft.subject}
              disabled={sending}
              onChange={(event) => onChangeField("subject", event.target.value)}
              placeholder="Propuesta comercial"
            />
          </label>

          <div className="proposal-email-cc-toggle-row">
            <button
              type="button"
              className={`proposal-email-cc-toggle${
                isCcVisible || hasCcValue ? " is-active" : ""
              }`}
              onClick={() => setIsCcVisible((current) => !current)}
              disabled={sending}
              aria-expanded={isCcVisible || hasCcValue}
            >
              {isCcVisible || hasCcValue ? "Ocultar CC" : "Agregar CC"}
            </button>
          </div>

          {isCcVisible || hasCcValue ? (
            <label className="proposal-email-field">
              <span>CC</span>
              <input
                value={draft.cc}
                disabled={sending}
                onChange={(event) => onChangeField("cc", event.target.value)}
                placeholder="equipo@cliente.com; otro@cliente.com"
              />
            </label>
          ) : null}

          <label className="proposal-email-field proposal-email-field-full-width">
            <span>Mensaje</span>
            <textarea
              rows="7"
              value={draft.messageBody}
              disabled={sending}
              onChange={(event) =>
                onChangeField("messageBody", event.target.value)
              }
            />
          </label>

          <div className="proposal-email-attachments-panel proposal-email-field-full-width">
            <div className="proposal-email-attachments-header">
              <strong>Adjuntos</strong>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleOpenFilePicker}
                disabled={sending}
              >
                Agregar archivos
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="proposal-email-file-input"
                onChange={handleFilesChange}
              />
            </div>

            <div className="proposal-email-attachments-list">
              <div className="proposal-email-attachment-item is-fixed">
                <div>
                  <strong>Propuesta.pdf</strong>
                  <small>Se adjunta automaticamente al enviar</small>
                </div>
              </div>

              {(draft.attachments || []).map((entry) => (
                <div key={entry.id} className="proposal-email-attachment-item">
                  <div>
                    <strong>{entry.file?.name || "Adjunto"}</strong>
                    <small>{formatBytes(entry.file?.size || 0)}</small>
                  </div>
                  <button
                    type="button"
                    className="proposal-email-remove-attachment"
                    onClick={() => onRemoveAttachment(entry.id)}
                    disabled={sending}
                    aria-label="Quitar adjunto"
                    title="Quitar adjunto"
                  >
                    Quitar
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {isConfirmingSend ? (
          <div className="proposal-email-confirmation">
            <strong>Confirmacion de envio</strong>
            <p>
              Este correo se enviara ahora a {draft.to}. Confirma solo si el
              contenido final ya esta listo.
            </p>
            <div className="proposal-email-confirmation-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={onCancelConfirm}
                disabled={sending}
              >
                Volver a revisar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={onRequestSend}
                disabled={sending}
              >
                {sending ? "Enviando..." : "Confirmar envio"}
              </button>
            </div>
          </div>
        ) : null}

        <div className="modal-buttons proposal-email-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={sending}
          >
            Cancelar
          </button>
          {!isConfirmingSend ? (
            <button
              type="button"
              className="btn-primary"
              onClick={onRequestSend}
              disabled={sending}
            >
              Revisar y enviar
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
