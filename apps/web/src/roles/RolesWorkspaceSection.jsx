export default function RolesWorkspaceSection({
  canUpdateRoles,
  roleStatusFilter,
  setRoleStatusFilter,
  roleStatusCounts,
  filteredRoles,
  selectedRoleId,
  selectedRole,
  openRoleMenuId,
  toggleRoleMenu,
  setOpenRoleMenuId,
  openEditRoleModal,
  runRoleAction,
  updateRoleStatus,
  formatDateTime,
  permissions,
  selectedPerms,
  permissionsByModule,
  togglePermission,
  savePerms,
  roleUsers,
  selectRole,
}) {
  return (
    <>
      <div className="roles-pills-bar">
        <div
          className="accounts-status-pills"
          role="group"
          aria-label="Filtrar roles por estado"
        >
          <button
            type="button"
            className={
              roleStatusFilter === "active"
                ? "status-filter-pill status-filter-pill-active is-selected"
                : "status-filter-pill status-filter-pill-active"
            }
            aria-pressed={roleStatusFilter === "active"}
            onClick={() => setRoleStatusFilter("active")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Activos</span>
            <span className="status-filter-pill-count">{roleStatusCounts.active}</span>
          </button>
          <button
            type="button"
            className={
              roleStatusFilter === "inactive"
                ? "status-filter-pill status-filter-pill-inactive is-selected"
                : "status-filter-pill status-filter-pill-inactive"
            }
            aria-pressed={roleStatusFilter === "inactive"}
            onClick={() => setRoleStatusFilter("inactive")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Desactivados</span>
            <span className="status-filter-pill-count">{roleStatusCounts.inactive}</span>
          </button>
          <button
            type="button"
            className={
              roleStatusFilter === "all"
                ? "status-filter-pill status-filter-pill-all is-selected"
                : "status-filter-pill status-filter-pill-all"
            }
            aria-pressed={roleStatusFilter === "all"}
            onClick={() => setRoleStatusFilter("all")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Todos</span>
            <span className="status-filter-pill-count">{roleStatusCounts.all}</span>
          </button>
        </div>
      </div>

      <div className="roles-workspace">
        <div className="roles-col">
          <div className="roles-col-header">
            <div className="roles-col-header-left">
              <span className="roles-col-title">Roles</span>
              <span className="roles-col-count">{filteredRoles.length}</span>
            </div>
          </div>
          <ul className="roles-card-list">
            {filteredRoles.map((role) => (
              <li
                key={role.id}
                className={[
                  "roles-card",
                  selectedRoleId === role.id ? "is-selected" : "",
                  Number(role.is_active) === 0 ? "is-inactive" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <button className="roles-card-btn" onClick={() => selectRole(role.id)}>
                  <div className="roles-card-top">
                    <span className="roles-card-name">{role.name}</span>
                    <span
                      className={
                        Number(role.is_active) === 1
                          ? "role-status-badge active"
                          : "role-status-badge inactive"
                      }
                    >
                      {Number(role.is_active) === 1 ? "Activo" : "Inactivo"}
                    </span>
                  </div>
                  <div className="roles-card-meta">
                    <span className="roles-card-desc">
                      {role.description || "Sin descripción"}
                    </span>
                    <span className="roles-card-perm-count">
                      {role.permissions_count} permisos
                    </span>
                  </div>
                </button>
                {canUpdateRoles && Number(role.is_system) !== 1 && (
                  <div className="user-kebab-wrap role-kebab-wrap">
                    <button
                      type="button"
                      className="kebab-btn"
                      onClick={() => toggleRoleMenu(role.id)}
                      aria-label="Abrir acciones del rol"
                      title="Acciones"
                    >
                      ⋮
                    </button>
                    {openRoleMenuId === role.id && (
                      <div className="user-kebab-menu">
                        <button
                          type="button"
                          onClick={() => {
                            setOpenRoleMenuId(null);
                            openEditRoleModal(role);
                          }}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          disabled={Number(role.is_active) === 1}
                          onClick={() => runRoleAction(() => updateRoleStatus(role, true))}
                        >
                          Activar
                        </button>
                        <button
                          type="button"
                          disabled={Number(role.is_active) !== 1}
                          onClick={() => runRoleAction(() => updateRoleStatus(role, false))}
                        >
                          Desactivar
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {selectedRole && (
            <div className="role-audit-compact">
              <div className="role-audit-compact-title">Auditoría</div>
              <div className="audit-item">
                <span className="audit-label">Creado por</span>
                <span className="audit-value">
                  {selectedRole.created_by_user_name || "—"}
                </span>
              </div>
              <div className="audit-item">
                <span className="audit-label">Fecha creación</span>
                <span className="audit-value">
                  {formatDateTime(selectedRole.created_at)}
                </span>
              </div>
              <div className="audit-item">
                <span className="audit-label">Modificado por</span>
                <span className="audit-value">
                  {selectedRole.updated_by_user_name || "—"}
                </span>
              </div>
              <div className="audit-item">
                <span className="audit-label">Última modificación</span>
                <span className="audit-value">
                  {formatDateTime(selectedRole.updated_at)}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="roles-col">
          <div className="roles-col-header">
            <div className="roles-col-header-left">
              <span className="roles-col-title">Permisos</span>
              <span className="roles-col-count">{permissions.length}</span>
              {canUpdateRoles && selectedRoleId && (
                <button
                  className="btn-icon-save-perms"
                  onClick={savePerms}
                  title="Guardar permisos"
                  type="button"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                    <polyline points="17 21 17 13 7 13 7 21" />
                    <polyline points="7 3 7 8 15 8" />
                  </svg>
                  Guardar
                </button>
              )}
            </div>
          </div>
          {selectedRoleId ? (
            <div className="permissions-by-module">
              {permissionsByModule.map(([moduleName, modulePermissions]) => (
                <div key={moduleName} className="permission-module-group">
                  <div className="permission-module-header">
                    {moduleName.charAt(0).toUpperCase() + moduleName.slice(1)}
                  </div>
                  <div className="checkbox-grid">
                    {modulePermissions.map((permission) => (
                      <label key={permission.id}>
                        <input
                          type="checkbox"
                          checked={selectedPerms.includes(Number(permission.id))}
                          onChange={(event) =>
                            togglePermission(permission.id, event.target.checked)
                          }
                        />
                        <span className="permission-label">
                          <span className="permission-code">{permission.action}</span>
                          {permission.description && (
                            <span className="permission-description">
                              {permission.description}
                            </span>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="roles-empty-state">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="36"
                height="36"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#c0cfe0"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <p>Selecciona un rol para gestionar sus permisos</p>
            </div>
          )}
        </div>

        <div className="roles-col">
          <div className="roles-col-header">
            <div className="roles-col-header-left">
              <span className="roles-col-title">Usuarios asignados</span>
              {selectedRoleId && <span className="roles-col-count">{roleUsers.length}</span>}
            </div>
          </div>
          {selectedRoleId ? (
            <div className="users-list">
              {roleUsers.length > 0 ? (
                <ul className="list">
                  {roleUsers.map((user) => (
                    <li key={user.id} className="roles-user-item">
                      <div className="roles-user-avatar">
                        {user.full_name.charAt(0).toUpperCase()}
                      </div>
                      <div className="roles-user-info">
                        <div className="roles-user-name">{user.full_name}</div>
                        <div className="roles-user-email">{user.email}</div>
                      </div>
                      <span
                        className={
                          user.status === "active"
                            ? "role-status-badge active"
                            : "role-status-badge inactive"
                        }
                      >
                        {user.status === "active" ? "Activo" : "Inactivo"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="roles-empty-state">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="36"
                    height="36"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#c0cfe0"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                  <p>No hay usuarios con este rol</p>
                </div>
              )}
            </div>
          ) : (
            <div className="roles-empty-state">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="36"
                height="36"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#c0cfe0"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <p>Selecciona un rol para ver sus usuarios</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}