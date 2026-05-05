import { useEffect, useRef } from "react";

function AccountsListSection({
  canCreateOrRequestAccounts,
  canActivateAccounts,
  accountsPendingEnabled,
  canReadOpportunities,
  canReadContacts,
  accountStatusFilter,
  setAccountStatusFilter,
  accountStatusCounts,
  totalAccountsCount,
  accountQuery,
  setAccountQuery,
  openCreateAccountModal,
  visibleAccounts,
  pagedAccounts,
  getAccountStatusBadgeClass,
  getAccountStatusLabel,
  toggleAccountSort,
  getAccountSortArrow,
  openAccountMenuId,
  toggleAccountMenu,
  runAccountAction,
  openEditAccountModal,
  isAccountActive,
  isAccountPending,
  isAccountInactive,
  openAccountStatusConfirmation,
  openAccountOppsModal,
  openAccountContactsModal,
  accountsPage,
  accountsPerPage,
  totalAccountPages,
  setAccountsPage,
  setAccountsPerPage,
}) {
  const helpRef = useRef(null);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!helpRef.current?.open) {
        return;
      }

      if (!helpRef.current.contains(event.target)) {
        helpRef.current.removeAttribute("open");
      }
    }

    function handleKeyDown(event) {
      if (event.key !== "Escape" || !helpRef.current?.open) {
        return;
      }

      helpRef.current.removeAttribute("open");
      helpRef.current.querySelector("summary")?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <>
      <div className="roles-page-header">
        <div className="roles-page-header-left">
          <div className="module-title-with-icon">
            <h2>Cuentas</h2>
            <span className="module-title-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M9 6.25a1.75 1.75 0 0 1 1.75-1.75h2.5A1.75 1.75 0 0 1 15 6.25V7h3.25A2.75 2.75 0 0 1 21 9.75v7.5A2.75 2.75 0 0 1 18.25 20h-12.5A2.75 2.75 0 0 1 3 17.25v-7.5A2.75 2.75 0 0 1 5.75 7H9zm1.5.75h3v-.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25zM4.5 11.5h15v5.75c0 .69-.56 1.25-1.25 1.25H5.75c-.69 0-1.25-.56-1.25-1.25zm15-1.5h-15v-.25c0-.69.56-1.25 1.25-1.25h12.5c.69 0 1.25.56 1.25 1.25z" />
              </svg>
            </span>
            <details className="accounts-module-help" ref={helpRef}>
              <summary
                className="accounts-module-help-trigger"
                aria-label="Ayuda sobre el módulo de cuentas"
                title="Ayuda sobre el módulo"
              >
                ?
              </summary>
              <div className="accounts-module-help-popover">
                <strong>Para qué sirve</strong>
                <p>
                  Este módulo concentra el padrón de clientes y prospectos,
                  su información comercial y el contexto necesario para dar
                  seguimiento.
                </p>
                <strong>Cómo usarlo</strong>
                <p>
                  Úsalo para crear cuentas, revisar su estado, abrir sus
                  contactos e identificar las oportunidades asociadas.
                </p>
              </div>
            </details>
          </div>
          <p className="roles-subtitle">
            Gestiona las cuentas del sistema y sus datos de contacto
          </p>
        </div>
        {canCreateOrRequestAccounts && (
          <button
            type="button"
            className="btn-primary"
            onClick={openCreateAccountModal}
          >
            + Crear cuenta
          </button>
        )}
      </div>

      <div className="roles-pills-bar accounts-pills-bar-row">
        <div
          className="accounts-status-pills"
          role="group"
          aria-label="Filtrar cuentas por estado"
        >
          <button
            type="button"
            className={
              accountStatusFilter === "active"
                ? "status-filter-pill status-filter-pill-active is-selected"
                : "status-filter-pill status-filter-pill-active"
            }
            aria-pressed={accountStatusFilter === "active"}
            onClick={() => setAccountStatusFilter("active")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Activas</span>
            <span className="status-filter-pill-count">
              {accountStatusCounts.active}
            </span>
          </button>
          {accountsPendingEnabled ? (
            <button
              type="button"
              className={
                accountStatusFilter === "pending"
                  ? "status-filter-pill status-filter-pill-pending is-selected"
                  : "status-filter-pill status-filter-pill-pending"
              }
              aria-pressed={accountStatusFilter === "pending"}
              onClick={() => setAccountStatusFilter("pending")}
            >
              <span className="status-filter-pill-dot" aria-hidden="true" />
              <span className="status-filter-pill-text">Pendientes</span>
              <span className="status-filter-pill-count">
                {accountStatusCounts.pending}
              </span>
            </button>
          ) : null}
          <button
            type="button"
            className={
              accountStatusFilter === "inactive"
                ? "status-filter-pill status-filter-pill-inactive is-selected"
                : "status-filter-pill status-filter-pill-inactive"
            }
            aria-pressed={accountStatusFilter === "inactive"}
            onClick={() => setAccountStatusFilter("inactive")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Desactivadas</span>
            <span className="status-filter-pill-count">
              {accountStatusCounts.inactive}
            </span>
          </button>
          <button
            type="button"
            className={
              accountStatusFilter === "all"
                ? "status-filter-pill status-filter-pill-all is-selected"
                : "status-filter-pill status-filter-pill-all"
            }
            aria-pressed={accountStatusFilter === "all"}
            onClick={() => setAccountStatusFilter("all")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Todas</span>
            <span className="status-filter-pill-count">{totalAccountsCount}</span>
          </button>
        </div>
        <input
          className="accounts-search-inline"
          type="text"
          placeholder="Buscar por ID, nombre, tipo, país, registro o estado"
          value={accountQuery}
          onChange={(event) => setAccountQuery(event.target.value)}
        />
      </div>

      <table>
        <thead>
          <tr>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleAccountSort("id")}
              >
                ID <span>{getAccountSortArrow("id")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleAccountSort("nombre")}
              >
                Nombre <span>{getAccountSortArrow("nombre")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleAccountSort("tipo")}
              >
                Tipo <span>{getAccountSortArrow("tipo")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleAccountSort("pais")}
              >
                Pais <span>{getAccountSortArrow("pais")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleAccountSort("registro")}
              >
                Registro <span>{getAccountSortArrow("registro")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleAccountSort("propietarios")}
              >
                Propietarios <span>{getAccountSortArrow("propietarios")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleAccountSort("estado")}
              >
                Estado <span>{getAccountSortArrow("estado")}</span>
              </button>
            </th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {visibleAccounts.length > 0 ? (
            pagedAccounts.map((account) => (
              <tr
                key={account.id}
                className="accounts-row-clickable"
                onClick={() => openEditAccountModal(account.id)}
              >
                <td>{account.id}</td>
                <td>{account.name}</td>
                <td>{account.account_type}</td>
                <td>{account.country}</td>
                <td>{account.registration_code}</td>
                <td>{account.owners_display || "-"}</td>
                <td>
                  <span className={getAccountStatusBadgeClass(account)}>
                    {getAccountStatusLabel(account)}
                  </span>
                </td>
                <td
                  className="accounts-actions-cell"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="user-kebab-wrap accounts-kebab-wrap">
                    <button
                      type="button"
                      className="kebab-btn"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleAccountMenu(account.id);
                      }}
                      aria-label="Abrir acciones"
                    >
                      ⋮
                    </button>
                    {openAccountMenuId === account.id && (
                      <div className="user-kebab-menu">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            runAccountAction(() => openEditAccountModal(account.id));
                          }}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          disabled={
                            !canActivateAccounts || isAccountActive(account)
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            openAccountStatusConfirmation(account, "activada");
                          }}
                        >
                          Activar
                        </button>
                        {accountsPendingEnabled ? (
                          <button
                            type="button"
                            disabled={
                              !canActivateAccounts || isAccountPending(account)
                            }
                            onClick={(event) => {
                              event.stopPropagation();
                              openAccountStatusConfirmation(
                                account,
                                "pendiente_activacion",
                              );
                            }}
                          >
                            Marcar pendiente
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={
                            !canActivateAccounts || isAccountInactive(account)
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            openAccountStatusConfirmation(account, "desactivada");
                          }}
                        >
                          Desactivar
                        </button>
                        {canReadOpportunities && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              runAccountAction(() => openAccountOppsModal(account));
                            }}
                          >
                            Oportunidades
                          </button>
                        )}
                        {canReadContacts && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              runAccountAction(() => openAccountContactsModal(account));
                            }}
                          >
                            Contactos
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={8} className="empty-state">
                No hay cuentas que coincidan con los filtros
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {visibleAccounts.length > 0 && (
        <div className="users-pagination">
          <div className="users-pagination-left">
            <span className="users-pagination-info">
              {(accountsPage - 1) * accountsPerPage + 1}-
              {Math.min(accountsPage * accountsPerPage, visibleAccounts.length)} de{" "}
              {visibleAccounts.length}
            </span>
          </div>
          <div className="users-pagination-center">
            <button
              type="button"
              className="users-page-btn"
              disabled={accountsPage === 1}
              onClick={() => setAccountsPage((page) => page - 1)}
            >
              ‹
            </button>
            <span className="users-pagination-pages">
              {accountsPage} / {totalAccountPages}
            </span>
            <button
              type="button"
              className="users-page-btn"
              disabled={accountsPage === totalAccountPages}
              onClick={() => setAccountsPage((page) => page + 1)}
            >
              ›
            </button>
          </div>
          <div className="users-pagination-right">
            <span className="users-pagination-label">Por página:</span>
            {[10, 50, 100].map((pageSize) => (
              <button
                key={pageSize}
                type="button"
                className={`users-perpage-btn${
                  accountsPerPage === pageSize ? " is-active" : ""
                }`}
                onClick={() => setAccountsPerPage(pageSize)}
              >
                {pageSize}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export default AccountsListSection;