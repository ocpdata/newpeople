import { useEffect, useRef, useState } from "react";
import "../proposals/proposal-print.css";

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

function AddAttachmentIcon() {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-hidden="true" focusable="false">
      <path
        d="M12 5.25a.75.75 0 0 1 .75.75v5.25H18a.75.75 0 0 1 0 1.5h-5.25V18a.75.75 0 0 1-1.5 0v-5.25H6a.75.75 0 0 1 0-1.5h5.25V6a.75.75 0 0 1 .75-.75Z"
        fill="currentColor"
      />
    </svg>
  );
}

function SendMailIcon() {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-hidden="true" focusable="false">
      <path
        d="M3.2 11.2 19.9 4.5c.56-.22 1.16.2 1.16.8v.02c0 .3-.16.57-.42.72l-7.5 4.35a.6.6 0 0 0-.29.37l-1.43 5.33a.86.86 0 0 1-1.63.05l-1.2-3.03a.6.6 0 0 0-.34-.34l-3.03-1.2a.86.86 0 0 1-.05-1.63Z"
        fill="currentColor"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-hidden="true" focusable="false">
      <path
        d="M6.97 6.97a.75.75 0 0 1 1.06 0L12 10.94l3.97-3.97a.75.75 0 1 1 1.06 1.06L13.06 12l3.97 3.97a.75.75 0 1 1-1.06 1.06L12 13.06l-3.97 3.97a.75.75 0 1 1-1.06-1.06L10.94 12 6.97 8.03a.75.75 0 0 1 0-1.06Z"
        fill="currentColor"
      />
    </svg>
  );
}

export default function QuotationEmailComposerModal({
  isOpen,
  draft,
  sending,
  error,
  notice,
  onClose,
  onChangeField,
  onAddAttachments,
  onRemoveAttachment,
  onRequestSend,
  googleMailStatus,
  onConnectGoogleMail,
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

  const mailStatus = googleMailStatus || {};
  const canSendViaGoogle = Boolean(mailStatus.canSend);
  const showConnectAction = !canSendViaGoogle;

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
          <div className="proposal-email-modal-header-main">
            <h3 className="modal-title">Enviar cotizacion por correo</h3>
            <p className="field-hint">
              Adjuntaremos automaticamente el PDF de la cotizacion. Puedes sumar
              archivos extra desde tu dispositivo.
            </p>
          </div>
          <button
            type="button"
            className="proposal-email-icon-button proposal-email-close-button account-modal-close-button"
            onClick={onClose}
            disabled={sending}
            aria-label="Cancelar"
            title="Cancelar"
          >
            <CloseIcon />
          </button>
        </div>

        {error ? <p className="form-error">{error}</p> : null}
        {notice ? (
          <p className="proposal-email-modal-notice">{notice}</p>
        ) : null}

        <div className="proposal-email-google-status">
          {mailStatus.loading ? (
            <p className="field-hint">
              Verificando conexion con Google para envio delegado...
            </p>
          ) : null}
          {!mailStatus.loading && canSendViaGoogle ? (
            <p className="proposal-email-google-status-ok">
              Envio habilitado con Google:
              {mailStatus.googleEmail
                ? ` ${mailStatus.googleEmail}`
                : " cuenta conectada"}
            </p>
          ) : null}
          {!mailStatus.loading && !canSendViaGoogle ? (
            <p className="proposal-email-google-status-warning">
              Debes conectar tu cuenta de Google con permiso de envio para
              continuar.
            </p>
          ) : null}
          {showConnectAction ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={onConnectGoogleMail}
              disabled={sending || mailStatus.loading}
            >
              {mailStatus.connected ? "Re-conectar Google" : "Conectar Google"}
            </button>
          ) : null}
        </div>

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
              placeholder="Cotizacion comercial"
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
                className="proposal-email-icon-button proposal-email-add-attachment-button"
                onClick={handleOpenFilePicker}
                disabled={sending}
                aria-label="Agregar archivos"
                title="Agregar archivos"
              >
                <AddAttachmentIcon />
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
                  <strong>Cotizacion.pdf</strong>
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

        <div className="modal-buttons proposal-email-actions">
          <button
            type="button"
            className="proposal-email-icon-button proposal-email-send-button"
            onClick={onRequestSend}
            disabled={sending || mailStatus.loading || !canSendViaGoogle}
            aria-label={sending ? "Enviando correo" : "Enviar correo"}
            title={sending ? "Enviando correo" : "Enviar correo"}
          >
            <SendMailIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
