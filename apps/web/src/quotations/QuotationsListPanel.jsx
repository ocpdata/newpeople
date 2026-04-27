import { useEffect } from "react";
import QuotationStatusIcon from "./QuotationStatusIcon";
import { getQuotationStatusTone } from "./quotationStatusPresentation";

function QuotationsListPanel({
  showDetails,
  loading,
  quotations,
  selectedQuotationId,
  loadVersion,
  quotationStatusFilter,
  setQuotationStatusFilter,
  quotationStatusCounts,
  quotationQuery,
  setQuotationQuery,
  toggleQuotationSort,
  getQuotationSortArrow,
  visibleQuotations,
  pagedQuotations,
  formatQuotationDate,
  getQuotationWorkflowBadgeClass,
  getQuotationActivationBadgeClass,
  openQuotationMenuId,
  setOpenQuotationMenuId,
  quotationVersionsByQuotationId,
  selectedQuotationEditVersionIdByQuotationId,
  loadingQuotationVersionsByQuotationId,
  handleSelectQuotationEditVersion,
  toggleQuotationMenu,
  busyAction,
  openEditQuotationModal,
  quotationsPage,
  quotationsPerPage,
  totalQuotationPages,
  setQuotationsPage,
  setQuotationsPerPage,
}) {
  useEffect(() => {
    if (openQuotationMenuId === null) return undefined;

    function handlePointerDown(event) {
      if (event.target.closest(".opportunities-kebab-wrap")) return;
      setOpenQuotationMenuId(null);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [openQuotationMenuId, setOpenQuotationMenuId]);

  const formattedAmount = (value) => {
    if (value === null || value === undefined || value === "") return "-";
    return Number(value).toLocaleString("es-MX", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
    });
  };

  const buildQuotationVersionOptions = (quotation) => {
    const quotationId = String(quotation.id);
    const cachedVersions = quotationVersionsByQuotationId[quotationId] || [];

    if (cachedVersions.length > 0) {
      return cachedVersions;
    }

    return [
      {
        id: Number(quotation.latestVersionId || quotation.id || 0),
        versionNumber: quotation.latestVersionNumber || "-",
        statusName: quotation.latestStatusName || "",
        isLatestVersion: true,
      },
    ];
  };

  const formatVersionOptionLabel = (version) => {
    const segments = [`Version ${version.versionNumber || "-"}`];
    if (version.isLatestVersion) {
      segments.push("mayor");
    }
    if (version.statusName) {
      segments.push(version.statusName);
    }
    return segments.join(" · ");
  };

  if (showDetails) {
    return (
      <aside className="quotation-sidebar">
        {loading ? (
          <p className="field-hint">Cargando cotizaciones...</p>
        ) : null}
        {!loading && quotations.length === 0 ? (
          <p className="field-hint">
            Aun no hay cotizaciones para esta oportunidad.
          </p>
        ) : null}
        {quotations.map((quotation) => (
          <button
            key={quotation.id}
            type="button"
            className={
              Number(selectedQuotationId) === Number(quotation.id)
                ? "quotation-sidebar-card is-selected"
                : "quotation-sidebar-card"
            }
            onClick={() =>
              loadVersion(
                quotation.id,
                quotation.latestVersionId || quotation.id,
              )
            }
          >
            <strong>Cotizacion #{quotation.id}</strong>
            <span>Version mayor: {quotation.latestVersionNumber || "-"}</span>
            <span className="quotation-sidebar-status-row">
              <span>Estado:</span>
              <span
                className={`quotation-status-badge is-${getQuotationStatusTone({ uiKey: quotation.latestStatusUiKey, code: quotation.latestStatusCode })}`}
              >
                <span
                  className="quotation-status-badge-icon"
                  aria-hidden="true"
                >
                  <QuotationStatusIcon
                    status={{
                      uiKey: quotation.latestStatusUiKey,
                      code: quotation.latestStatusCode,
                    }}
                  />
                </span>
                <span>{quotation.latestStatusName || "-"}</span>
              </span>
            </span>
          </button>
        ))}
      </aside>
    );
  }

  return (
    <div className="quotation-list-panel">
      <div className="roles-pills-bar accounts-pills-bar-row">
        <div
          className="accounts-status-pills"
          role="group"
          aria-label="Filtrar cotizaciones por estado"
        >
          <button
            type="button"
            className={
              quotationStatusFilter === "active"
                ? "status-filter-pill status-filter-pill-active is-selected"
                : "status-filter-pill status-filter-pill-active"
            }
            aria-pressed={quotationStatusFilter === "active"}
            onClick={() => setQuotationStatusFilter("active")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Activas</span>
            <span className="status-filter-pill-count">
              {quotationStatusCounts.active}
            </span>
          </button>
          <button
            type="button"
            className={
              quotationStatusFilter === "inactive"
                ? "status-filter-pill status-filter-pill-inactive is-selected"
                : "status-filter-pill status-filter-pill-inactive"
            }
            aria-pressed={quotationStatusFilter === "inactive"}
            onClick={() => setQuotationStatusFilter("inactive")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Desactivadas</span>
            <span className="status-filter-pill-count">
              {quotationStatusCounts.inactive}
            </span>
          </button>
          <button
            type="button"
            className={
              quotationStatusFilter === "all"
                ? "status-filter-pill status-filter-pill-all is-selected"
                : "status-filter-pill status-filter-pill-all"
            }
            aria-pressed={quotationStatusFilter === "all"}
            onClick={() => setQuotationStatusFilter("all")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Todas</span>
            <span className="status-filter-pill-count">
              {quotations.length}
            </span>
          </button>
        </div>
        <input
          className="accounts-search-inline"
          type="text"
          placeholder="Buscar por ID, cuenta, oportunidad, etapa, importe, cierre o estado"
          value={quotationQuery}
          onChange={(event) => setQuotationQuery(event.target.value)}
        />
      </div>

      <table>
        <thead>
          <tr>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleQuotationSort("id")}
              >
                ID <span>{getQuotationSortArrow("id")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleQuotationSort("version")}
              >
                Versión <span>{getQuotationSortArrow("version")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleQuotationSort("cuenta")}
              >
                Cuenta <span>{getQuotationSortArrow("cuenta")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleQuotationSort("oportunidad")}
              >
                Oportunidad <span>{getQuotationSortArrow("oportunidad")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleQuotationSort("etapa_oportunidad")}
              >
                Etapa oportunidad{" "}
                <span>{getQuotationSortArrow("etapa_oportunidad")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleQuotationSort("importe")}
              >
                Importe <span>{getQuotationSortArrow("importe")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleQuotationSort("cierre_oportunidad")}
              >
                Cierre oportunidad{" "}
                <span>{getQuotationSortArrow("cierre_oportunidad")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleQuotationSort("estado_cotizacion")}
              >
                Estado cotizacion{" "}
                <span>{getQuotationSortArrow("estado_cotizacion")}</span>
              </button>
            </th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={9} className="empty-state">
                Cargando cotizaciones...
              </td>
            </tr>
          ) : visibleQuotations.length > 0 ? (
            pagedQuotations.map((quotation) => (
              <tr key={quotation.id}>
                <td>{quotation.id}</td>
                <td>{quotation.latestVersionNumber || "-"}</td>
                <td>{quotation.accountName || "-"}</td>
                <td>{quotation.opportunityName || "-"}</td>
                <td>{quotation.opportunitySalesStageName || "-"}</td>
                <td>{formattedAmount(quotation.latestTotalSaleAmount)}</td>
                <td>{formatQuotationDate(quotation.opportunityCloseDate)}</td>
                <td>
                  <span
                    className={`${getQuotationWorkflowBadgeClass(quotation)} quotation-status-badge`}
                  >
                    <span
                      className="quotation-status-badge-icon"
                      aria-hidden="true"
                    >
                      <QuotationStatusIcon
                        status={{
                          uiKey: quotation.latestStatusUiKey,
                          code: quotation.latestStatusCode,
                        }}
                      />
                    </span>
                    {quotation.latestStatusName || "-"}
                  </span>
                </td>
                <td className="accounts-actions-cell">
                  <div className="user-kebab-wrap opportunities-kebab-wrap">
                    {(() => {
                      const quotationId = String(quotation.id);
                      const versionOptions =
                        buildQuotationVersionOptions(quotation);
                      const selectedEditVersionId =
                        Number(
                          selectedQuotationEditVersionIdByQuotationId[
                            quotationId
                          ] || 0,
                        ) || Number(versionOptions[0]?.id || 0);
                      const loadingVersions =
                        loadingQuotationVersionsByQuotationId[quotationId];

                      return (
                        <>
                          <button
                            type="button"
                            className="kebab-btn"
                            onClick={() => toggleQuotationMenu(quotation)}
                            aria-label="Abrir acciones"
                          >
                            ⋮
                          </button>
                          {openQuotationMenuId === quotation.id ? (
                            <div className="user-kebab-menu quotation-actions-menu">
                              <label
                                className="quotation-actions-menu-label"
                                htmlFor={`quotation-edit-version-${quotation.id}`}
                              >
                                Version para editar
                              </label>
                              <select
                                id={`quotation-edit-version-${quotation.id}`}
                                className="quotation-actions-menu-select"
                                value={String(selectedEditVersionId || "")}
                                onChange={(event) =>
                                  handleSelectQuotationEditVersion(
                                    quotation.id,
                                    event.target.value,
                                  )
                                }
                              >
                                {versionOptions.map((version) => (
                                  <option
                                    key={version.id}
                                    value={String(version.id)}
                                  >
                                    {formatVersionOptionLabel(version)}
                                  </option>
                                ))}
                              </select>
                              {loadingVersions ? (
                                <p className="quotation-actions-menu-hint">
                                  Cargando versiones...
                                </p>
                              ) : null}
                              <button
                                type="button"
                                disabled={
                                  busyAction ===
                                    `open-quotation-${quotation.id}` ||
                                  !selectedEditVersionId
                                }
                                onClick={() =>
                                  openEditQuotationModal(
                                    quotation,
                                    selectedEditVersionId,
                                  )
                                }
                              >
                                Editar cotizacion
                              </button>
                            </div>
                          ) : null}
                        </>
                      );
                    })()}
                  </div>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={9} className="empty-state">
                No hay cotizaciones que coincidan con los filtros
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {visibleQuotations.length > 0 ? (
        <div className="users-pagination">
          <div className="users-pagination-left">
            <span className="users-pagination-info">
              {(quotationsPage - 1) * quotationsPerPage + 1}–
              {Math.min(
                quotationsPage * quotationsPerPage,
                visibleQuotations.length,
              )}{" "}
              de {visibleQuotations.length}
            </span>
          </div>
          <div className="users-pagination-center">
            <button
              type="button"
              className="users-page-btn"
              disabled={quotationsPage === 1}
              onClick={() => setQuotationsPage((page) => page - 1)}
            >
              ‹
            </button>
            <span className="users-pagination-pages">
              {quotationsPage} / {totalQuotationPages}
            </span>
            <button
              type="button"
              className="users-page-btn"
              disabled={quotationsPage === totalQuotationPages}
              onClick={() => setQuotationsPage((page) => page + 1)}
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
                className={`users-perpage-btn${quotationsPerPage === pageSize ? " is-active" : ""}`}
                onClick={() => setQuotationsPerPage(pageSize)}
              >
                {pageSize}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default QuotationsListPanel;
