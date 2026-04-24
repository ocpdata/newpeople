export default function UserFormModal({
  isOpen,
  mode,
  saving,
  form,
  roles,
  user,
  onSubmit,
  onClose,
  onFieldChange,
  onRoleToggle,
  onAvatarChange,
  formatDateTime,
}) {
  if (!isOpen) {
    return null;
  }

  const isEditMode = mode === "edit";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={isEditMode ? "modal-dialog" : "modal-dialog modal-dialog-wide"}
        style={isEditMode ? { maxWidth: 480 } : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        {isEditMode ? (
          <div className="modal-header">
            <h3 className="modal-title">Editar usuario</h3>
            <div className="opportunity-modal-header-meta">
              <span className="record-id-badge" title="ID del usuario">
                <span className="record-id-icon" aria-hidden="true">
                  #
                </span>
                {user.id}
              </span>
              <span
                className={
                  user.status === "active"
                    ? "status-icon-badge active"
                    : "status-icon-badge inactive"
                }
                title="Estado del usuario"
              >
                <span className="status-dot" aria-hidden="true" />
                {user.status === "active" ? "Activo" : "Inactivo"}
              </span>
            </div>
          </div>
        ) : (
          <h3 className="modal-title">Crear usuario</h3>
        )}

        <form
          className={isEditMode ? undefined : "user-create-form in-modal"}
          onSubmit={onSubmit}
          autoComplete={isEditMode ? undefined : "off"}
        >
          {!isEditMode && (
            <>
              <input
                type="text"
                name="fake_username"
                autoComplete="username"
                className="hidden-autofill-trap"
                tabIndex={-1}
              />
              <input
                type="password"
                name="fake_password"
                autoComplete="current-password"
                className="hidden-autofill-trap"
                tabIndex={-1}
              />
            </>
          )}

          <div className="grid-form">
            <div className="field-group">
              <label>
                Nombre completo <span className="required-mark">*</span>
              </label>
              <input
                type="text"
                placeholder={isEditMode ? undefined : "Ej. Ana Perez"}
                value={form.fullName}
                onChange={(event) => onFieldChange("fullName", event.target.value)}
                required
                minLength={isEditMode ? 3 : undefined}
                maxLength={isEditMode ? 160 : undefined}
              />
            </div>

            <div className="field-group">
              <label>
                E-mail <span className="required-mark">*</span>
              </label>
              <input
                type="email"
                placeholder={
                  isEditMode ? undefined : "Ej. nombre.apellido@empresa.com"
                }
                name={isEditMode ? undefined : "new_user_email"}
                autoComplete={isEditMode ? undefined : "off"}
                value={form.email}
                onChange={(event) => onFieldChange("email", event.target.value)}
                required
                maxLength={isEditMode ? 254 : undefined}
              />
            </div>

            <div className="field-group">
              <label>{isEditMode ? "Móvil" : "Movil"}</label>
              <input
                type="text"
                placeholder={isEditMode ? "Opcional" : "Ej. 5512345678"}
                value={form.mobile}
                onChange={(event) => onFieldChange("mobile", event.target.value)}
                maxLength={isEditMode ? 30 : undefined}
              />
            </div>

            <div className="field-group" style={{ gridColumn: "1 / -1" }}>
              <label>Imagen del usuario</label>
              <div className="user-avatar-upload-wrap">
                {form.avatarUrl ? (
                  <img
                    src={form.avatarUrl}
                    alt="Vista previa del usuario"
                    className="user-avatar-preview"
                  />
                ) : (
                  <div className="user-avatar-placeholder">Sin imagen</div>
                )}
                <div className="user-avatar-controls">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) =>
                      onAvatarChange(event.target.files?.[0], (avatarUrl) =>
                        onFieldChange("avatarUrl", avatarUrl),
                      )
                    }
                  />
                  <p className="field-hint">
                    JPG, PNG o WEBP. Tamaño máximo: 2 MB.
                  </p>
                  {form.avatarUrl && (
                    <button
                      type="button"
                      className="btn-secondary user-avatar-clear-btn"
                      onClick={() => onFieldChange("avatarUrl", "")}
                    >
                      Quitar imagen
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="field-group" style={{ gridColumn: "1 / -1" }}>
              <label>Roles</label>
              {!isEditMode && (
                <p className="field-hint">Selecciona uno o varios roles</p>
              )}
              <div className="roles-picker">
                {roles.map((role) => (
                  <label key={role.id} className="role-choice">
                    <input
                      type="checkbox"
                      checked={form.roleIds.includes(Number(role.id))}
                      onChange={(event) =>
                        onRoleToggle(Number(role.id), event.target.checked)
                      }
                    />
                    <span>{role.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {!isEditMode && (
            <p className="field-hint create-user-email-hint">
              Al crear el usuario se enviara un correo para que configure su
              contrasena en otra seccion de la aplicacion.
            </p>
          )}

          {isEditMode && (
            <section className="account-form-section modal-audit-strip">
              <h4>Auditoría de usuario</h4>
              <div className="role-audit-grid">
                <div className="audit-item">
                  <span className="audit-label">Creado por</span>
                  <span className="audit-value">
                    {user.created_by_name || "No registrado"}
                  </span>
                </div>
                <div className="audit-item">
                  <span className="audit-label">Fecha de creacion</span>
                  <span className="audit-value">
                    {formatDateTime(user.created_at)}
                  </span>
                </div>
                <div className="audit-item">
                  <span className="audit-label">Modificado por</span>
                  <span className="audit-value">
                    {user.updated_by_name || "No registrado"}
                  </span>
                </div>
                <div className="audit-item">
                  <span className="audit-label">Fecha de modificacion</span>
                  <span className="audit-value">
                    {formatDateTime(user.updated_at)}
                  </span>
                </div>
              </div>
            </section>
          )}

          <div className="modal-buttons" style={{ marginTop: isEditMode ? 20 : 16 }}>
            {isEditMode ? (
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? "Guardando..." : "Guardar"}
              </button>
            ) : (
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? "Creando usuario..." : "Guardar usuario"}
              </button>
            )}
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}