import { UserAvatar } from "../AppShell";

export default function UsersListSection({
  canCreateUsers,
  showCreateForm,
  openCreateUserModal,
  userStatusFilter,
  setUserStatusFilter,
  userStatusCounts,
  totalUsersCount,
  userQuery,
  setUserQuery,
  filteredUsers,
  pagedUsers,
  toggleSort,
  getSortArrow,
  openUserMenuId,
  toggleUserMenu,
  setOpenUserMenuId,
  openEditUser,
  openUserActionConfirmation,
  usersPage,
  setUsersPage,
  usersPerPage,
  setUsersPerPage,
  totalUserPages,
}) {
  return (
    <>
      <div className="roles-page-header">
        <div className="roles-page-header-left">
          <div className="module-title-with-icon">
            <h2>Usuarios</h2>
            <span className="module-title-icon module-title-icon-users" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M12 12.25a4.25 4.25 0 1 0-4.25-4.25A4.25 4.25 0 0 0 12 12.25m0 1.5c-3.66 0-6.75 2.2-6.75 4.8 0 .52.42.95.95.95h11.6a.95.95 0 0 0 .95-.95c0-2.6-3.09-4.8-6.75-4.8" />
              </svg>
            </span>
          </div>
          <p className="roles-subtitle">
            Gestiona los usuarios del sistema y sus roles asignados
          </p>
        </div>
        {canCreateUsers && !showCreateForm && (
          <button type="button" className="btn-primary" onClick={openCreateUserModal}>
            + Crear usuario
          </button>
        )}
      </div>

      <div className="roles-pills-bar accounts-pills-bar-row">
        <div
          className="accounts-status-pills"
          role="group"
          aria-label="Filtrar usuarios por estado"
        >
          <button
            type="button"
            className={
              userStatusFilter === "active"
                ? "status-filter-pill status-filter-pill-active is-selected"
                : "status-filter-pill status-filter-pill-active"
            }
            aria-pressed={userStatusFilter === "active"}
            onClick={() => setUserStatusFilter("active")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Activos</span>
            <span className="status-filter-pill-count">{userStatusCounts.active}</span>
          </button>
          <button
            type="button"
            className={
              userStatusFilter === "inactive"
                ? "status-filter-pill status-filter-pill-inactive is-selected"
                : "status-filter-pill status-filter-pill-inactive"
            }
            aria-pressed={userStatusFilter === "inactive"}
            onClick={() => setUserStatusFilter("inactive")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Desactivados</span>
            <span className="status-filter-pill-count">{userStatusCounts.inactive}</span>
          </button>
          <button
            type="button"
            className={
              userStatusFilter === "all"
                ? "status-filter-pill status-filter-pill-all is-selected"
                : "status-filter-pill status-filter-pill-all"
            }
            aria-pressed={userStatusFilter === "all"}
            onClick={() => setUserStatusFilter("all")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Todos</span>
            <span className="status-filter-pill-count">{totalUsersCount}</span>
          </button>
        </div>
        <input
          className="accounts-search-inline"
          type="text"
          placeholder="Buscar por nombre, email, móvil, estado o rol"
          value={userQuery}
          onChange={(event) => setUserQuery(event.target.value)}
        />
      </div>

      <table>
        <thead>
          <tr>
            <th>
              <button type="button" className="sort-header-btn" onClick={() => toggleSort("id")}>
                ID <span>{getSortArrow("id")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleSort("nombre")}
              >
                Nombre <span>{getSortArrow("nombre")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleSort("email")}
              >
                Email <span>{getSortArrow("email")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleSort("movil")}
              >
                Movil <span>{getSortArrow("movil")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleSort("estado")}
              >
                Estado <span>{getSortArrow("estado")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleSort("roles")}
              >
                Roles <span>{getSortArrow("roles")}</span>
              </button>
            </th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {filteredUsers.length > 0 ? (
            pagedUsers.map((user) => (
              <tr key={user.id}>
                <td>{user.id}</td>
                <td>
                  <div className="user-name-cell">
                    <UserAvatar src={user.avatar_url} fullName={user.full_name} size="sm" />
                    <span>{user.full_name}</span>
                  </div>
                </td>
                <td>{user.email}</td>
                <td>{user.mobile || "-"}</td>
                <td>
                  <span
                    className={
                      user.status === "active"
                        ? "user-status-badge active"
                        : "user-status-badge inactive"
                    }
                  >
                    {user.status === "active" ? "Activo" : "Inactivo"}
                  </span>
                </td>
                <td>{user.roles || "-"}</td>
                <td>
                  <div className="user-kebab-wrap users-kebab-wrap">
                    <button
                      type="button"
                      className="kebab-btn"
                      onClick={() => toggleUserMenu(user.id)}
                      aria-label="Abrir acciones"
                      title="Acciones"
                    >
                      ⋮
                    </button>
                    {openUserMenuId === user.id && (
                      <div className="user-kebab-menu">
                        <button
                          type="button"
                          onClick={() => {
                            setOpenUserMenuId(null);
                            openEditUser(user);
                          }}
                        >
                          Editar
                        </button>
                        {user.status === "active" ? (
                          <button
                            type="button"
                            onClick={() => openUserActionConfirmation(user, "inactive")}
                          >
                            Desactivar
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openUserActionConfirmation(user, "active")}
                          >
                            Activar
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            openUserActionConfirmation(user, "reset-password")
                          }
                        >
                          Reiniciar contraseña
                        </button>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={7} className="empty-state">
                No hay usuarios que coincidan con la búsqueda
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {filteredUsers.length > 0 && (
        <div className="users-pagination">
          <div className="users-pagination-left">
            <span className="users-pagination-info">
              {(usersPage - 1) * usersPerPage + 1}–
              {Math.min(usersPage * usersPerPage, filteredUsers.length)} de{" "}
              {filteredUsers.length}
            </span>
          </div>
          <div className="users-pagination-center">
            <button
              type="button"
              className="users-page-btn"
              disabled={usersPage === 1}
              onClick={() => setUsersPage((page) => page - 1)}
            >
              ‹
            </button>
            <span className="users-pagination-pages">
              {usersPage} / {totalUserPages}
            </span>
            <button
              type="button"
              className="users-page-btn"
              disabled={usersPage === totalUserPages}
              onClick={() => setUsersPage((page) => page + 1)}
            >
              ›
            </button>
          </div>
          <div className="users-pagination-right">
            <span className="users-pagination-label">Por página:</span>
            {[10, 50, 100].map((count) => (
              <button
                key={count}
                type="button"
                className={`users-perpage-btn${usersPerPage === count ? " is-active" : ""}`}
                onClick={() => setUsersPerPage(count)}
              >
                {count}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}