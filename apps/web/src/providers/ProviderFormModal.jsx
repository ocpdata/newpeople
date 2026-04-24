export default function ProviderFormModal({
  isOpen,
  editingProviderId,
  form,
  catalogs,
  editProviderAudit,
  savingProvider,
  onClose,
  onSubmit,
  onChange,
  getProviderStatusIconBadgeClassById,
  formatDateTime,
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-dialog modal-dialog-account"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="opportunity-modal-header-copy">
            <h3 className="modal-title">
              {editingProviderId ? "Editar proveedor" : "Crear proveedor"}
            </h3>
            <p className="field-hint opportunity-modal-subtitle">
              {editingProviderId
                ? "Actualiza los datos necesarios y guarda los cambios."
                : "Completa la información principal para registrar el proveedor."}
            </p>
          </div>
          {editingProviderId && (
            <div className="opportunity-modal-header-meta">
              <span className="record-id-badge" title="ID del proveedor">
                <span className="record-id-icon" aria-hidden="true">
                  #
                </span>
                {editingProviderId}
              </span>
              <span
                className={getProviderStatusIconBadgeClassById(
                  form.activationStatusId,
                )}
                title="Estado de activacion"
              >
                <span className="status-dot" aria-hidden="true" />
                {catalogs.providerStatuses.find(
                  (status) =>
                    String(status.id) === String(form.activationStatusId),
                )?.name || "Sin estado"}
              </span>
            </div>
          )}
        </div>

        <form className="account-create-form in-modal" onSubmit={onSubmit}>
          <section className="account-form-section account-modal-section">
            <h4>Datos principales</h4>
            <div className="grid-form account-grid-main">
              <div className="field-group">
                <label>
                  Nombre <span className="required-mark">*</span>
                </label>
                <input
                  value={form.name}
                  onChange={(e) => onChange("name", e.target.value)}
                  required
                />
              </div>
              <div className="field-group">
                <label>Registro</label>
                <input
                  value={form.registrationCode}
                  onChange={(e) =>
                    onChange("registrationCode", e.target.value)
                  }
                />
              </div>
            </div>
          </section>

          <section className="account-form-section account-modal-section account-location-section">
            <h4>Ubicacion</h4>
            <div className="grid-form account-grid-location">
              <div className="field-group">
                <label>
                  Pais <span className="required-mark">*</span>
                </label>
                <select
                  value={form.countryId}
                  onChange={(e) => onChange("countryId", e.target.value)}
                  required
                >
                  <option value="">Selecciona pais</option>
                  {catalogs.countries.map((country) => (
                    <option key={country.id} value={country.id}>
                      {country.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label>Ciudad</label>
                <input
                  value={form.city}
                  onChange={(e) => onChange("city", e.target.value)}
                />
              </div>
              <div className="field-group">
                <label>Estado</label>
                <input
                  value={form.stateRegion}
                  onChange={(e) => onChange("stateRegion", e.target.value)}
                />
              </div>
              <div className="field-group">
                <label>Direccion</label>
                <input
                  value={form.addressLine}
                  onChange={(e) => onChange("addressLine", e.target.value)}
                />
              </div>
              <div className="field-group">
                <label>Codigo postal</label>
                <input
                  value={form.postalCode}
                  onChange={(e) => onChange("postalCode", e.target.value)}
                />
              </div>
              {editingProviderId && (
                <div className="field-group">
                  <label>Estado de activacion</label>
                  <select
                    value={form.activationStatusId}
                    onChange={(e) =>
                      onChange("activationStatusId", e.target.value)
                    }
                  >
                    {catalogs.providerStatuses.map((status) => (
                      <option key={status.id} value={status.id}>
                        {status.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </section>

          {editingProviderId && editProviderAudit && (
            <section className="account-form-section account-modal-section modal-audit-strip">
              <h4>Auditoria del proveedor</h4>
              <div className="role-audit-grid">
                <div className="audit-item">
                  <span className="audit-label">Creado por</span>
                  <span className="audit-value">
                    {editProviderAudit.createdByName || "No registrado"}
                  </span>
                </div>
                <div className="audit-item">
                  <span className="audit-label">Fecha de creacion</span>
                  <span className="audit-value">
                    {formatDateTime(editProviderAudit.createdAt)}
                  </span>
                </div>
                <div className="audit-item">
                  <span className="audit-label">Modificado por</span>
                  <span className="audit-value">
                    {editProviderAudit.updatedByName || "No registrado"}
                  </span>
                </div>
                <div className="audit-item">
                  <span className="audit-label">Fecha de modificacion</span>
                  <span className="audit-value">
                    {formatDateTime(editProviderAudit.updatedAt)}
                  </span>
                </div>
              </div>
            </section>
          )}

          <div className="modal-buttons" style={{ marginTop: 16 }}>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={savingProvider}>
              {savingProvider
                ? editingProviderId
                  ? "Guardando..."
                  : "Creando..."
                : editingProviderId
                  ? "Guardar cambios"
                  : "Crear proveedor"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}