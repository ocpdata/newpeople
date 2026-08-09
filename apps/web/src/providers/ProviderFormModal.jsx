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
  contacts,
  contactDraft,
  editingContactIndex,
  onContactDraftChange,
  onUpsertContact,
  onEditContact,
  onRemoveContact,
  onCancelContactEdit,
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

          <section className="account-form-section account-modal-section">
            <h4>Contactos del proveedor</h4>
            <div className="grid-form account-grid-main">
              <div className="field-group">
                <label>Nombres</label>
                <input
                  value={contactDraft.firstName || ""}
                  onChange={(e) =>
                    onContactDraftChange("firstName", e.target.value)
                  }
                />
              </div>
              <div className="field-group">
                <label>Apellidos</label>
                <input
                  value={contactDraft.lastName || ""}
                  onChange={(e) =>
                    onContactDraftChange("lastName", e.target.value)
                  }
                />
              </div>
              <div className="field-group">
                <label>Correo</label>
                <input
                  type="email"
                  value={contactDraft.email || ""}
                  onChange={(e) => onContactDraftChange("email", e.target.value)}
                />
              </div>
              <div className="field-group">
                <label>Movil</label>
                <input
                  value={contactDraft.mobile || ""}
                  onChange={(e) => onContactDraftChange("mobile", e.target.value)}
                />
              </div>
              <div className="field-group">
                <label>Cargo</label>
                <input
                  value={contactDraft.role || ""}
                  onChange={(e) => onContactDraftChange("role", e.target.value)}
                />
              </div>
            </div>
            <div className="processing-stage-actions split" style={{ marginTop: 12 }}>
              {editingContactIndex >= 0 ? (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={onCancelContactEdit}
                >
                  Cancelar edicion
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                className="btn-primary"
                onClick={onUpsertContact}
              >
                {editingContactIndex >= 0 ? "Guardar contacto" : "Añadir contacto"}
              </button>
            </div>

            <section className="processing-products-box" style={{ marginTop: 14 }}>
              <header>
                <h6>Lista de contactos</h6>
              </header>
              {Array.isArray(contacts) && contacts.length ? (
                <div className="processing-products-table-wrap">
                  <table className="processing-products-table">
                    <thead>
                      <tr>
                        <th>Nombres</th>
                        <th>Apellidos</th>
                        <th>Correo</th>
                        <th>Movil</th>
                        <th>Cargo</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contacts.map((contact, index) => (
                        <tr key={`provider-contact-${index + 1}`}>
                          <td>{contact.firstName || "-"}</td>
                          <td>{contact.lastName || "-"}</td>
                          <td>{contact.email || "-"}</td>
                          <td>{contact.mobile || "-"}</td>
                          <td>{contact.role || "-"}</td>
                          <td>
                            <div className="processing-product-actions">
                              <button
                                type="button"
                                className="btn-secondary processing-product-action-icon"
                                title="Editar contacto"
                                aria-label="Editar contacto"
                                onClick={() => onEditContact(index)}
                              >
                                <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                                  <path d="M16.81 3.19a2.75 2.75 0 0 1 3.89 3.89l-11 11a.75.75 0 0 1-.34.2l-4 1a.75.75 0 0 1-.91-.91l1-4a.75.75 0 0 1 .2-.34zm2.83 1.06a1.25 1.25 0 0 0-1.77 0l-1.13 1.13 1.77 1.77 1.13-1.13a1.25 1.25 0 0 0 0-1.77M17.44 8.2l-1.77-1.77L7.9 14.2l-.56 2.22 2.22-.56z" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                className="btn-secondary processing-product-action-icon is-danger"
                                title="Eliminar contacto"
                                aria-label="Eliminar contacto"
                                onClick={() => onRemoveContact(index)}
                              >
                                <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                                  <path d="M9.25 4a.75.75 0 0 1 .75-.75h4a.75.75 0 0 1 .75.75V5h3a.75.75 0 0 1 0 1.5h-.76l-.63 11.01A2.75 2.75 0 0 1 14.37 20h-4.74a2.75 2.75 0 0 1-2.74-2.49L6.26 6.5H5.5a.75.75 0 0 1 0-1.5h3zm1.5.75V5h2.5v-.25zM7.76 6.5l.62 10.92c.04.66.58 1.18 1.25 1.18h4.74c.67 0 1.21-.52 1.25-1.18l.62-10.92z" />
                                  <path d="M10.75 9a.75.75 0 0 1 .75.75v5a.75.75 0 0 1-1.5 0v-5a.75.75 0 0 1 .75-.75m2.5 0a.75.75 0 0 1 .75.75v5a.75.75 0 0 1-1.5 0v-5a.75.75 0 0 1 .75-.75" />
                                </svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="field-hint">Aun no hay contactos añadidos.</p>
              )}
            </section>
          </section>

          <section className="account-form-section account-modal-section account-location-section">
            <h4>Ubicacion</h4>
            <div className="grid-form account-grid-location">
              <div className="field-group">
                <label>
                  País <span className="required-mark">*</span>
                </label>
                <select
                  value={form.countryId}
                  onChange={(e) => onChange("countryId", e.target.value)}
                  required
                >
                  <option value="">Selecciona país</option>
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
                <label>Código postal</label>
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
              <h4>Auditoría del proveedor</h4>
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