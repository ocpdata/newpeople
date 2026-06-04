import { useEffect, useRef } from "react";

function OpportunitiesListSection({
  canCreateOrRequestOpportunities,
  opportunitiesPendingEnabled,
  openCreateOpportunityModal,
  opportunityStatusFilter,
  setOpportunityStatusFilter,
  opportunityStatusCounts,
  totalOpportunitiesCount,
  opportunityQuery,
  setOpportunityQuery,
  visibleOpportunities,
  pagedOpportunities,
  toggleOpportunitySort,
  getOpportunitySortArrow,
  formatCloseDate,
  getCommercialStatusBadgeClass,
  getOpportunityCommercialStatusLabel,
  getOpportunityStatusBadgeClass,
  getOpportunityStatusLabel,
  openOpportunityMenuId,
  toggleOpportunityMenu,
  runOpportunityAction,
  openEditOpportunityModal,
  canChangeOpportunityActivationStatus,
  isOpportunityActive,
  isOpportunityPending,
  isOpportunityInactive,
  updateOpportunityStatus,
  opportunitiesPage,
  opportunitiesPerPage,
  totalOpportunityPages,
  setOpportunitiesPage,
  setOpportunitiesPerPage,
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

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);

  return (
    <>
      <div className="roles-page-header">
        <div className="roles-page-header-left">
          <div className="module-title-with-icon">
            <h2>Oportunidades</h2>
            <span
              className="module-title-icon module-title-icon-opportunities"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M5 18.5a.75.75 0 0 1-.75-.75V6.25A2.25 2.25 0 0 1 6.5 4h11a2.25 2.25 0 0 1 2.25 2.25v11.5a.75.75 0 0 1-1.5 0V6.25a.75.75 0 0 0-.75-.75h-11a.75.75 0 0 0-.75.75v11.5a.75.75 0 0 1-.75.75" />
                <path d="M8.25 15.75a.75.75 0 0 1-.53-1.28l2.72-2.72a.75.75 0 0 1 1.06 0l1.25 1.25 3.22-3.22a.75.75 0 1 1 1.06 1.06l-3.75 3.75a.75.75 0 0 1-1.06 0L11 13.34l-2.19 2.19a.75.75 0 0 1-.56.22" />
              </svg>
            </span>
            <details className="accounts-module-help" ref={helpRef}>
              <summary
                className="accounts-module-help-trigger"
                aria-label="Ayuda sobre el módulo de oportunidades"
                title="Ayuda sobre el módulo"
              >
                ?
              </summary>
              <div className="accounts-module-help-popover">
                <strong>Para qué sirve</strong>
                <p>
                  Este módulo centraliza las oportunidades comerciales activas,
                  pendientes e inactivas junto con su contexto de cuenta,
                  contacto, responsables y avance.
                </p>
                <strong>Cómo usarlo</strong>
                <p>
                  Úsalo para crear oportunidades, dar seguimiento al proceso
                  comercial, revisar evidencia documental y mantener actualizado
                  el estado de cada negocio.
                </p>
              </div>
            </details>
          </div>
          <p className="roles-subtitle">
            Gestiona las oportunidades comerciales y su seguimiento
          </p>
          <p className="field-hint">
            Las cotizaciones ahora se administran desde su modulo principal.
          </p>
        </div>
        {canCreateOrRequestOpportunities && (
          <button
            type="button"
            className="btn-primary"
            onClick={openCreateOpportunityModal}
          >
            + Crear oportunidad
          </button>
        )}
      </div>

      <div className="roles-pills-bar accounts-pills-bar-row">
        <div
          className="accounts-status-pills"
          role="group"
          aria-label="Filtrar oportunidades por estado"
        >
          <button
            type="button"
            className={
              opportunityStatusFilter === "active"
                ? "status-filter-pill status-filter-pill-active is-selected"
                : "status-filter-pill status-filter-pill-active"
            }
            aria-pressed={opportunityStatusFilter === "active"}
            onClick={() => setOpportunityStatusFilter("active")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Activas</span>
            <span className="status-filter-pill-count">
              {opportunityStatusCounts.active}
            </span>
          </button>
          {opportunitiesPendingEnabled ? (
            <button
              type="button"
              className={
                opportunityStatusFilter === "pending"
                  ? "status-filter-pill status-filter-pill-pending is-selected"
                  : "status-filter-pill status-filter-pill-pending"
              }
              aria-pressed={opportunityStatusFilter === "pending"}
              onClick={() => setOpportunityStatusFilter("pending")}
            >
              <span className="status-filter-pill-dot" aria-hidden="true" />
              <span className="status-filter-pill-text">Pendientes</span>
              <span className="status-filter-pill-count">
                {opportunityStatusCounts.pending}
              </span>
            </button>
          ) : null}
          <button
            type="button"
            className={
              opportunityStatusFilter === "in_process"
                ? "status-filter-pill status-filter-pill-process is-selected"
                : "status-filter-pill status-filter-pill-process"
            }
            aria-pressed={opportunityStatusFilter === "in_process"}
            onClick={() => setOpportunityStatusFilter("in_process")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">En proceso</span>
            <span className="status-filter-pill-count">
              {opportunityStatusCounts.inProcess}
            </span>
          </button>
          <button
            type="button"
            className={
              opportunityStatusFilter === "won"
                ? "status-filter-pill status-filter-pill-won is-selected"
                : "status-filter-pill status-filter-pill-won"
            }
            aria-pressed={opportunityStatusFilter === "won"}
            onClick={() => setOpportunityStatusFilter("won")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Ganadas</span>
            <span className="status-filter-pill-count">
              {opportunityStatusCounts.won}
            </span>
          </button>
          <button
            type="button"
            className={
              opportunityStatusFilter === "inactive"
                ? "status-filter-pill status-filter-pill-inactive is-selected"
                : "status-filter-pill status-filter-pill-inactive"
            }
            aria-pressed={opportunityStatusFilter === "inactive"}
            onClick={() => setOpportunityStatusFilter("inactive")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Desactivadas</span>
            <span className="status-filter-pill-count">
              {opportunityStatusCounts.inactive}
            </span>
          </button>
          <button
            type="button"
            className={
              opportunityStatusFilter === "all"
                ? "status-filter-pill status-filter-pill-all is-selected"
                : "status-filter-pill status-filter-pill-all"
            }
            aria-pressed={opportunityStatusFilter === "all"}
            onClick={() => setOpportunityStatusFilter("all")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Todas</span>
            <span className="status-filter-pill-count">
              {totalOpportunitiesCount}
            </span>
          </button>
        </div>
        <input
          className="accounts-search-inline"
          type="text"
          placeholder="Buscar por nombre, ID, cuenta, vendedor, contacto, etapa o línea"
          value={opportunityQuery}
          onChange={(event) => setOpportunityQuery(event.target.value)}
        />
      </div>

      <table>
        <thead>
          <tr>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleOpportunitySort("id")}
              >
                ID <span>{getOpportunitySortArrow("id")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleOpportunitySort("nombre")}
              >
                Oportunidad <span>{getOpportunitySortArrow("nombre")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleOpportunitySort("cuenta")}
              >
                Cuenta <span>{getOpportunitySortArrow("cuenta")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleOpportunitySort("vendedor")}
              >
                Vendedor <span>{getOpportunitySortArrow("vendedor")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleOpportunitySort("preventa")}
              >
                Preventa <span>{getOpportunitySortArrow("preventa")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleOpportunitySort("etapa")}
              >
                Etapa <span>{getOpportunitySortArrow("etapa")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleOpportunitySort("importe")}
              >
                Importe USD <span>{getOpportunitySortArrow("importe")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleOpportunitySort("cierre")}
              >
                Cierre <span>{getOpportunitySortArrow("cierre")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleOpportunitySort("estado_comercial")}
              >
                Estado comercial{" "}
                <span>{getOpportunitySortArrow("estado_comercial")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleOpportunitySort("estado")}
              >
                Estado <span>{getOpportunitySortArrow("estado")}</span>
              </button>
            </th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {visibleOpportunities.length > 0 ? (
            pagedOpportunities.map((opportunity) => (
              <tr
                key={opportunity.id}
                className="accounts-row-clickable"
                onClick={() => openEditOpportunityModal(opportunity.id)}
              >
                <td>{opportunity.id}</td>
                <td>{opportunity.name}</td>
                <td>{opportunity.account_name}</td>
                <td>{opportunity.seller_user_name || "-"}</td>
                <td>{opportunity.presales_user_name || "-"}</td>
                <td>{opportunity.sales_stage}</td>
                <td>
                  {Number(opportunity.amount_usd || 0).toLocaleString("en-US", {
                    style: "currency",
                    currency: "USD",
                  })}
                </td>
                <td>{formatCloseDate(opportunity.close_date)}</td>
                <td>
                  <span
                    className={getCommercialStatusBadgeClass(
                      opportunity.commercial_status,
                    )}
                  >
                    {getOpportunityCommercialStatusLabel(opportunity)}
                  </span>
                </td>
                <td>
                  <span className={getOpportunityStatusBadgeClass(opportunity)}>
                    {getOpportunityStatusLabel(opportunity)}
                  </span>
                </td>
                <td
                  className="accounts-actions-cell"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="user-kebab-wrap opportunities-kebab-wrap">
                    <button
                      type="button"
                      className="kebab-btn"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleOpportunityMenu(opportunity.id);
                      }}
                      aria-label="Abrir acciones"
                    >
                      ⋮
                    </button>
                    {openOpportunityMenuId === opportunity.id && (
                      <div className="user-kebab-menu">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            runOpportunityAction(() =>
                              openEditOpportunityModal(opportunity.id),
                            );
                          }}
                        >
                          Editar oportunidad
                        </button>
                        <button
                          type="button"
                          disabled={
                            !canChangeOpportunityActivationStatus ||
                            isOpportunityActive(opportunity)
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            runOpportunityAction(() =>
                              updateOpportunityStatus(opportunity, "activada"),
                            );
                          }}
                        >
                          Activar
                        </button>
                        {opportunitiesPendingEnabled ? (
                          <button
                            type="button"
                            disabled={
                              !canChangeOpportunityActivationStatus ||
                              isOpportunityPending(opportunity)
                            }
                            onClick={(event) => {
                              event.stopPropagation();
                              runOpportunityAction(() =>
                                updateOpportunityStatus(
                                  opportunity,
                                  "pendiente_activacion",
                                ),
                              );
                            }}
                          >
                            Marcar pendiente
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={
                            !canChangeOpportunityActivationStatus ||
                            isOpportunityInactive(opportunity)
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            runOpportunityAction(() =>
                              updateOpportunityStatus(
                                opportunity,
                                "desactivada",
                              ),
                            );
                          }}
                        >
                          Desactivar
                        </button>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={11} className="empty-state">
                No hay oportunidades que coincidan con los filtros
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {visibleOpportunities.length > 0 && (
        <div className="users-pagination">
          <div className="users-pagination-left">
            <span className="users-pagination-info">
              {(opportunitiesPage - 1) * opportunitiesPerPage + 1}–
              {Math.min(
                opportunitiesPage * opportunitiesPerPage,
                visibleOpportunities.length,
              )}{" "}
              de {visibleOpportunities.length}
            </span>
          </div>
          <div className="users-pagination-center">
            <button
              type="button"
              className="users-page-btn"
              disabled={opportunitiesPage === 1}
              onClick={() => setOpportunitiesPage((page) => page - 1)}
            >
              ‹
            </button>
            <span className="users-pagination-pages">
              {opportunitiesPage} / {totalOpportunityPages}
            </span>
            <button
              type="button"
              className="users-page-btn"
              disabled={opportunitiesPage === totalOpportunityPages}
              onClick={() => setOpportunitiesPage((page) => page + 1)}
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
                  opportunitiesPerPage === pageSize ? " is-active" : ""
                }`}
                onClick={() => setOpportunitiesPerPage(pageSize)}
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

export default OpportunitiesListSection;
