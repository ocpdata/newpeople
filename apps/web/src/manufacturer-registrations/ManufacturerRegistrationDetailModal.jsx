import {
  formatManufacturerRegistrationDate,
  getManufacturerRegistrationAlertClass,
  getManufacturerRegistrationAlertLabel,
  getManufacturerRegistrationExpirationLabel,
  getManufacturerRegistrationStatusClass,
  getManufacturerRegistrationStatusLabel,
} from "./presentation";

export default function ManufacturerRegistrationDetailModal({
  isOpen,
  detail,
  loading = false,
  error = "",
  onClose,
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-overlay modal-overlay-elevated" onClick={onClose}>
      <div
        className="modal-dialog modal-dialog-account manufacturer-registration-detail-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div className="opportunity-modal-header-copy">
            <h3 className="modal-title">Detalle del registro</h3>
            <p className="field-hint opportunity-modal-subtitle">
              {detail?.providerName || "Cargando fabricante"}
            </p>
          </div>
          <button
            type="button"
            className="opportunity-documents-apply-icon-button"
            onClick={onClose}
            aria-label="Cerrar"
            title="Cerrar"
          >
            ×
          </button>
        </div>

        <div className="opportunity-document-preview-body manufacturer-registration-detail-body">
          {error ? (
            <div className="opportunity-modal-error">{error}</div>
          ) : null}
          {loading ? <p className="field-hint">Cargando detalle...</p> : null}

          {!loading && detail ? (
            <>
              <div className="manufacturer-registration-detail-meta">
                <span
                  className={`manufacturer-registration-badge ${getManufacturerRegistrationStatusClass(detail.displayStatus)}`}
                >
                  {getManufacturerRegistrationStatusLabel(detail.displayStatus)}
                </span>
                <span
                  className={`manufacturer-registration-badge ${getManufacturerRegistrationAlertClass(detail.alertLevel)}`}
                >
                  {getManufacturerRegistrationAlertLabel(detail.alertLevel)}
                </span>
                <span className="record-id-badge">
                  Folio: {detail.registrationFolio || "-"}
                </span>
              </div>

              <div className="role-audit-grid manufacturer-registration-detail-grid">
                <div className="audit-item">
                  <span className="audit-label">Oportunidad</span>
                  <span className="audit-value">
                    {detail.opportunityName || "-"}
                  </span>
                </div>
                <div className="audit-item">
                  <span className="audit-label">Cuenta</span>
                  <span className="audit-value">
                    {detail.accountName || "-"}
                  </span>
                </div>
                <div className="audit-item">
                  <span className="audit-label">Solicitud</span>
                  <span className="audit-value">
                    {formatManufacturerRegistrationDate(
                      detail.requestedAt,
                      true,
                    )}
                  </span>
                </div>
                <div className="audit-item">
                  <span className="audit-label">Vigencia</span>
                  <span className="audit-value">
                    {formatManufacturerRegistrationDate(detail.expiresAt)}
                  </span>
                </div>
                <div className="audit-item">
                  <span className="audit-label">Alerta</span>
                  <span className="audit-value">
                    {getManufacturerRegistrationExpirationLabel(detail)}
                  </span>
                </div>
                <div className="audit-item">
                  <span className="audit-label">Renovaciones</span>
                  <span className="audit-value">
                    {detail.renewalCount || 0}
                  </span>
                </div>
              </div>

              <div className="field-group manufacturer-registration-modal-notes">
                <label>Observaciones</label>
                <textarea
                  rows={3}
                  value={detail.notes || ""}
                  readOnly
                  disabled
                />
              </div>

              {detail.rejectionNotes ? (
                <div className="field-group manufacturer-registration-modal-notes">
                  <label>Comentario de rechazo</label>
                  <textarea
                    rows={3}
                    value={detail.rejectionNotes}
                    readOnly
                    disabled
                  />
                </div>
              ) : null}

              <section className="account-form-section manufacturer-registration-subsection">
                <h4>Renovaciones</h4>
                {Array.isArray(detail.renewals) && detail.renewals.length ? (
                  <div className="manufacturer-registration-history-list">
                    {detail.renewals.map((entry) => (
                      <article
                        key={entry.id}
                        className="manufacturer-registration-history-card"
                      >
                        <strong>
                          {formatManufacturerRegistrationDate(
                            entry.renewedAt,
                            true,
                          )}
                        </strong>
                        <span>
                          {entry.previousFolio || "-"} → {entry.newFolio || "-"}
                        </span>
                        <span>
                          {formatManufacturerRegistrationDate(
                            entry.previousExpiresAt,
                          )}{" "}
                          →{" "}
                          {formatManufacturerRegistrationDate(
                            entry.newExpiresAt,
                          )}
                        </span>
                        <span>{entry.renewedByName || "Sin usuario"}</span>
                        {entry.notes ? <p>{entry.notes}</p> : null}
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="field-hint">
                    Este registro aun no tiene renovaciones.
                  </p>
                )}
              </section>

              <section className="account-form-section manufacturer-registration-subsection">
                <h4>Auditoria</h4>
                {Array.isArray(detail.auditEntries) &&
                detail.auditEntries.length ? (
                  <div className="manufacturer-registration-history-list">
                    {detail.auditEntries.map((entry) => (
                      <article
                        key={entry.id}
                        className="manufacturer-registration-history-card"
                      >
                        <strong>{entry.action}</strong>
                        <span>
                          {formatManufacturerRegistrationDate(
                            entry.createdAt,
                            true,
                          )}
                        </span>
                        <span>
                          {entry.performedByName ||
                            entry.performedByEmail ||
                            "Sistema"}
                        </span>
                        <p>{entry.detail || "Sin detalle"}</p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="field-hint">
                    Sin auditoria disponible para este registro.
                  </p>
                )}
              </section>
            </>
          ) : null}

          <div className="modal-buttons">
            <button type="button" className="btn-primary" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
