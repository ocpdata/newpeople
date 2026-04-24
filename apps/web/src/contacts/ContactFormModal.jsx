export default function ContactFormModal({
  isOpen,
  editingContactId,
  currentContact,
  form,
  catalogs,
  managerOptions,
  editContactAudit,
  savingContact,
  onClose,
  onSubmit,
  onChange,
  onAccountChange,
  getContactStatusIconBadgeClass,
  getContactStatusLabel,
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
              {editingContactId ? "Editar contacto" : "Crear contacto"}
            </h3>
            <p className="field-hint opportunity-modal-subtitle">
              {editingContactId
                ? "Actualiza los datos necesarios y guarda los cambios."
                : "Completa la información principal y guarda para crear el contacto."}
            </p>
          </div>
          {editingContactId && currentContact ? (
            <div className="opportunity-modal-header-meta">
              <span className="record-id-badge" title="ID del contacto">
                <span className="record-id-icon" aria-hidden="true">
                  #
                </span>
                {editingContactId}
              </span>
              <span
                className={getContactStatusIconBadgeClass(currentContact)}
                title="Estado de activacion"
              >
                <span className="status-dot" aria-hidden="true" />
                {getContactStatusLabel(currentContact)}
              </span>
            </div>
          ) : null}
        </div>

        <form className="account-create-form in-modal" onSubmit={onSubmit}>
          <section className="account-form-section contact-modal-section contact-main-data-section">
            <h4>Datos principales</h4>
            <div className="grid-form account-grid-main">
              <div className="field-group">
                <label>
                  Nombres <span className="required-mark">*</span>
                </label>
                <input
                  value={form.firstName}
                  onChange={(e) => onChange("firstName", e.target.value)}
                  required
                />
              </div>
              <div className="field-group">
                <label>
                  Apellidos <span className="required-mark">*</span>
                </label>
                <input
                  value={form.lastName}
                  onChange={(e) => onChange("lastName", e.target.value)}
                  required
                />
              </div>
              <div className="field-group">
                <label>
                  Cuenta <span className="required-mark">*</span>
                </label>
                <select
                  value={form.accountId}
                  onChange={(e) => onAccountChange(e.target.value)}
                  required
                >
                  <option value="">Selecciona cuenta</option>
                  {catalogs.accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label>Cargo</label>
                <input
                  value={form.positionTitle}
                  onChange={(e) => onChange("positionTitle", e.target.value)}
                />
              </div>
              <div className="field-group">
                <label>E-mail</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => onChange("email", e.target.value)}
                />
              </div>
              <div className="field-group">
                <label>Móvil</label>
                <input
                  value={form.mobile}
                  onChange={(e) => onChange("mobile", e.target.value)}
                />
              </div>
              <div className="field-group">
                <label>Telefono fijo</label>
                <input
                  value={form.phone}
                  onChange={(e) => onChange("phone", e.target.value)}
                />
              </div>
              <div className="field-group">
                <label>Extension</label>
                <input
                  value={form.phoneExtension}
                  onChange={(e) => onChange("phoneExtension", e.target.value)}
                />
              </div>
              <div className="field-group">
                <label>Departamento</label>
                <input
                  value={form.department}
                  onChange={(e) => onChange("department", e.target.value)}
                />
              </div>
            </div>
          </section>

          <section className="account-form-section contact-modal-section contact-commercial-section">
            <h4>Relacion comercial</h4>
            <div className="grid-form account-grid-main">
              <div className="field-group">
                <label>
                  Participacion de compra <span className="required-mark">*</span>
                </label>
                <select
                  value={form.purchaseParticipationId}
                  onChange={(e) =>
                    onChange("purchaseParticipationId", e.target.value)
                  }
                  required
                >
                  <option value="">Selecciona participación</option>
                  {catalogs.purchaseParticipations.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label>
                  Relacion con nosotros <span className="required-mark">*</span>
                </label>
                <select
                  value={form.relationshipTypeId}
                  onChange={(e) => onChange("relationshipTypeId", e.target.value)}
                  required
                >
                  <option value="">Selecciona relación</option>
                  {catalogs.relationshipTypes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label>
                  Situacion en empresa <span className="required-mark">*</span>
                </label>
                <select
                  value={form.employmentStatusId}
                  onChange={(e) => onChange("employmentStatusId", e.target.value)}
                  required
                >
                  <option value="">Selecciona situación</option>
                  {catalogs.employmentStatuses.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label>Jefe</label>
                <select
                  value={form.managerContactId}
                  onChange={(e) => onChange("managerContactId", e.target.value)}
                >
                  <option value="">Sin jefe</option>
                  {managerOptions.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label>Influye en</label>
                <select
                  value={form.influencesContactId}
                  onChange={(e) => onChange("influencesContactId", e.target.value)}
                >
                  <option value="">Ninguno</option>
                  {managerOptions.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.full_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section className="account-form-section contact-modal-section contact-location-section">
            <h4>Ubicacion (si difiere de la cuenta)</h4>
            <div className="grid-form account-grid-location">
              <div className="field-group">
                <label>Pais</label>
                <select
                  value={form.countryId}
                  onChange={(e) => onChange("countryId", e.target.value)}
                >
                  <option value="">Usar país de la cuenta</option>
                  {catalogs.countries.map((country) => (
                    <option key={country.id} value={country.id}>
                      {country.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label>Estado</label>
                <input
                  value={form.stateRegion}
                  onChange={(e) => onChange("stateRegion", e.target.value)}
                />
              </div>
              <div className="field-group">
                <label>Ciudad</label>
                <input
                  value={form.city}
                  onChange={(e) => onChange("city", e.target.value)}
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
            </div>
          </section>

          {editingContactId && editContactAudit ? (
            <section className="account-form-section contact-modal-section modal-audit-strip">
              <h4>Auditoria del contacto</h4>
              <div className="role-audit-grid">
                <div className="audit-item">
                  <span className="audit-label">Creado por</span>
                  <span className="audit-value">
                    {editContactAudit.createdByName || "No registrado"}
                  </span>
                </div>
                <div className="audit-item">
                  <span className="audit-label">Fecha de creacion</span>
                  <span className="audit-value">
                    {formatDateTime(editContactAudit.createdAt)}
                  </span>
                </div>
                <div className="audit-item">
                  <span className="audit-label">Modificado por</span>
                  <span className="audit-value">
                    {editContactAudit.updatedByName || "No registrado"}
                  </span>
                </div>
                <div className="audit-item">
                  <span className="audit-label">Fecha de modificacion</span>
                  <span className="audit-value">
                    {formatDateTime(editContactAudit.updatedAt)}
                  </span>
                </div>
              </div>
            </section>
          ) : null}

          <div className="modal-buttons" style={{ marginTop: 16 }}>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={savingContact}>
              {savingContact
                ? editingContactId
                  ? "Guardando..."
                  : "Creando..."
                : editingContactId
                  ? "Guardar cambios"
                  : "Crear contacto"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}