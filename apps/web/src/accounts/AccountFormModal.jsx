function AccountFormModal({
  isOpen,
  editingAccountId,
  creatingAccount,
  form,
  setForm,
  catalogs,
  users,
  editAccountAudit,
  getEditingActivationMeta,
  getOwnerOptionLabel,
  isInactiveOwner,
  toggleOwnerUser,
  onClose,
  onSubmit,
  formatDateTime,
}) {
  if (!isOpen) return null;

  const activationMeta = editingAccountId ? getEditingActivationMeta() : null;

  return (
    <div
      className="modal-overlay"
      onClick={() => {
        onClose();
      }}
    >
      <div
        className="modal-dialog modal-dialog-account"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div className="opportunity-modal-header-copy">
            <h3 className="modal-title">
              {editingAccountId ? "Editar cuenta" : "Crear cuenta"}
            </h3>
            <p className="field-hint opportunity-modal-subtitle">
              {editingAccountId
                ? "Actualiza los datos necesarios y guarda los cambios."
                : "Completa primero los datos principales y despues asigna los propietarios para crear la cuenta."}
            </p>
          </div>
          {editingAccountId && activationMeta && (
            <div className="opportunity-modal-header-meta">
              <span className="record-id-badge" title="ID de la cuenta">
                <span className="record-id-icon" aria-hidden="true">
                  #
                </span>
                {editingAccountId}
              </span>
              <span
                className={activationMeta.badgeClass}
                title="Estado de activacion"
              >
                <span className="status-dot" aria-hidden="true" />
                {activationMeta.label}
              </span>
            </div>
          )}
        </div>
        <form className="account-create-form in-modal" onSubmit={onSubmit}>
          <section className="account-form-section account-modal-section account-main-data-section">
            <h4>Datos principales</h4>
            <div className="grid-form account-grid-main">
              <div className="field-group">
                <label>
                  Nombre <span className="required-mark">*</span>
                </label>
                <input
                  placeholder="Ej. AccessQ S.A. de C.V."
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                  required
                />
              </div>
              <div className="field-group">
                <label>Registro</label>
                <input
                  placeholder="Ej. RFC o identificador interno"
                  value={form.registrationCode}
                  onChange={(event) =>
                    setForm({ ...form, registrationCode: event.target.value })
                  }
                />
              </div>
              <div className="field-group">
                <label>
                  Tipo de cuenta <span className="required-mark">*</span>
                </label>
                <select
                  value={form.accountTypeId}
                  onChange={(event) =>
                    setForm({ ...form, accountTypeId: event.target.value })
                  }
                  required
                >
                  <option value="">Selecciona tipo de cuenta</option>
                  {catalogs.accountTypes.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label>
                  Sector economico <span className="required-mark">*</span>
                </label>
                <select
                  value={form.economicSectorId}
                  onChange={(event) =>
                    setForm({ ...form, economicSectorId: event.target.value })
                  }
                  required
                >
                  <option value="">Selecciona sector economico</option>
                  {catalogs.sectors.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section className="account-form-section account-modal-section account-location-section">
            <h4>Ubicacion y contacto</h4>
            <div className="grid-form account-grid-location">
              <div className="field-group">
                <label>
                  Pais <span className="required-mark">*</span>
                </label>
                <select
                  value={form.countryId}
                  onChange={(event) =>
                    setForm({ ...form, countryId: event.target.value })
                  }
                  required
                >
                  <option value="">Selecciona pais</option>
                  {catalogs.countries.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label>Ciudad</label>
                <input
                  placeholder="Ciudad"
                  value={form.city}
                  onChange={(event) =>
                    setForm({ ...form, city: event.target.value })
                  }
                />
              </div>
              <div className="field-group">
                <label>Estado</label>
                <input
                  placeholder="Estado"
                  value={form.stateRegion}
                  onChange={(event) =>
                    setForm({ ...form, stateRegion: event.target.value })
                  }
                />
              </div>
              <div className="field-group">
                <label>Direccion</label>
                <input
                  placeholder="Direccion"
                  value={form.addressLine}
                  onChange={(event) =>
                    setForm({ ...form, addressLine: event.target.value })
                  }
                />
              </div>
              <div className="field-group">
                <label>Codigo postal</label>
                <input
                  placeholder="Codigo postal"
                  value={form.postalCode}
                  onChange={(event) =>
                    setForm({ ...form, postalCode: event.target.value })
                  }
                />
              </div>
              <div className="field-group">
                <label>Telefono</label>
                <input
                  placeholder="Telefono"
                  value={form.phone}
                  onChange={(event) =>
                    setForm({ ...form, phone: event.target.value })
                  }
                />
              </div>
              <div className="field-group">
                <label>Pagina web</label>
                <input
                  placeholder="https://empresa.com"
                  value={form.website}
                  onChange={(event) =>
                    setForm({ ...form, website: event.target.value })
                  }
                />
              </div>
            </div>
          </section>

          <section className="account-form-section account-modal-section account-description-section">
            <h4>Descripcion</h4>
            <div className="field-group">
              <textarea
                placeholder="Describe brevemente la cuenta, notas comerciales o contexto"
                value={form.description}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
              />
            </div>
          </section>

          <section className="account-form-section account-modal-section account-owners-section">
            <h4>
              Propietarios <span className="required-mark">*</span>
            </h4>
            <p className="field-hint">
              Selecciona uno o varios usuarios (obligatorio)
            </p>
            <div className="owners-selected-wrap">
              <p className="field-hint owners-selected-title">
                Propietarios seleccionados
              </p>
              <div className="owners-picker owners-selected-grid">
                {users
                  .filter((user) => form.ownerUserIds.includes(Number(user.id)))
                  .map((user) => (
                    <button
                      key={`selected-${user.id}`}
                      type="button"
                      className="owner-choice selected"
                      onClick={() => toggleOwnerUser(user.id)}
                      title="Quitar propietario"
                    >
                      <span className="owner-name">
                        {getOwnerOptionLabel(user)}
                      </span>
                      <span className="owner-email">{user.email}</span>
                    </button>
                  ))}
              </div>
              {form.ownerUserIds.length === 0 && (
                <p className="field-hint owners-empty-hint">
                  Aun no hay propietarios seleccionados.
                </p>
              )}
            </div>

            <div className="owners-list-wrap">
              <p className="field-hint owners-list-title">
                Lista de usuarios para seleccionar
              </p>
              <div className="owners-list" role="listbox" aria-multiselectable>
                {users.map((user) => {
                  const isSelected = form.ownerUserIds.includes(Number(user.id));
                  const inactiveOwner = isInactiveOwner(user);
                  return (
                    <label key={user.id} className="owners-list-item">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={inactiveOwner && !isSelected}
                        onChange={() => toggleOwnerUser(user.id)}
                      />
                      <span className="owners-list-text">
                        <span className="owner-name">
                          {getOwnerOptionLabel(user)}
                        </span>
                        <span className="owner-email">{user.email}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          </section>

          {editingAccountId && (
            <section className="account-form-section account-modal-section modal-audit-strip">
              <h4>Auditoria de la cuenta</h4>
              <div className="role-audit-grid">
                <div className="audit-item">
                  <span className="audit-label">Creado por</span>
                  <span className="audit-value">
                    {editAccountAudit?.createdByName || "No registrado"}
                  </span>
                </div>
                <div className="audit-item">
                  <span className="audit-label">Fecha de creacion</span>
                  <span className="audit-value">
                    {formatDateTime(editAccountAudit?.createdAt)}
                  </span>
                </div>
                <div className="audit-item">
                  <span className="audit-label">Modificado por</span>
                  <span className="audit-value">
                    {editAccountAudit?.updatedByName || "No registrado"}
                  </span>
                </div>
                <div className="audit-item">
                  <span className="audit-label">Fecha de modificacion</span>
                  <span className="audit-value">
                    {formatDateTime(editAccountAudit?.updatedAt)}
                  </span>
                </div>
              </div>
            </section>
          )}

          <div className="modal-buttons" style={{ marginTop: 16 }}>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={creatingAccount}>
              {creatingAccount
                ? editingAccountId
                  ? "Guardando..."
                  : "Creando..."
                : editingAccountId
                  ? "Guardar cambios"
                  : "Crear cuenta"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AccountFormModal;