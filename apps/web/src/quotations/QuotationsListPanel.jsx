import { useEffect, useState } from "react";
import { api, getApiErrorMessage } from "../api";
import QuotationStatusIcon from "./QuotationStatusIcon";
import { getQuotationStatusTone } from "./quotationStatusPresentation";

function QuotationsListPanel({
  showDetails,
  loading,
  quotations,
  duplicateTargetAccounts,
  duplicateTargetOpportunities,
  loadingDuplicateTargetOpportunities,
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
  openQuotationMenuId,
  setOpenQuotationMenuId,
  quotationVersionsByQuotationId,
  selectedQuotationEditVersionIdByQuotationId,
  loadingQuotationVersionsByQuotationId,
  handleSelectQuotationEditVersion,
  toggleQuotationMenu,
  busyAction,
  openEditQuotationModal,
  duplicateQuotationModalState,
  openDuplicateQuotationModal,
  closeDuplicateQuotationModal,
  handleDuplicateQuotationTargetAccountChange,
  handleDuplicateQuotationTargetOpportunityChange,
  handleDuplicateQuotation,
  onCreateProposalFromQuotationVersion,
  quotationsPage,
  quotationsPerPage,
  totalQuotationPages,
  setQuotationsPage,
  setQuotationsPerPage,
}) {
  const [accountModalAccount, setAccountModalAccount] = useState(null);
  const [accountModalDetail, setAccountModalDetail] = useState(null);
  const [accountModalLoading, setAccountModalLoading] = useState(false);
  const [accountModalError, setAccountModalError] = useState("");
  const [accountModalStatusFilter, setAccountModalStatusFilter] =
    useState("all");

  const [opportunityModalOpportunity, setOpportunityModalOpportunity] =
    useState(null);
  const [opportunityModalDetail, setOpportunityModalDetail] = useState(null);
  const [opportunityModalLoading, setOpportunityModalLoading] = useState(false);
  const [opportunityModalError, setOpportunityModalError] = useState("");
  const [opportunityModalStatusFilter, setOpportunityModalStatusFilter] =
    useState("all");

  const [contactModalContact, setContactModalContact] = useState(null);
  const [contactModalDetail, setContactModalDetail] = useState(null);
  const [contactModalLoading, setContactModalLoading] = useState(false);
  const [contactModalError, setContactModalError] = useState("");
  const [contactModalStatusFilter, setContactModalStatusFilter] =
    useState("all");

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

  function normalizeSpanishStatus(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  }

  function getStatusCode(detail) {
    const status = normalizeSpanishStatus(
      detail?.activation_status || detail?.activationStatus || "",
    );
    if (status.includes("desactiv")) return "inactive";
    if (status.includes("pendiente")) return "pending";
    return "active";
  }

  function getStatusLabel(detail) {
    const statusCode = getStatusCode(detail);
    if (statusCode === "inactive") return "Desactivada";
    if (statusCode === "pending") return "Pendiente";
    return "Activada";
  }

  function getStatusBadgeClass(detail) {
    const statusCode = getStatusCode(detail);
    if (statusCode === "inactive") return "user-status-badge inactive";
    if (statusCode === "pending") return "user-status-badge pending";
    return "user-status-badge active";
  }

  function getContactStatusLabel(detail) {
    const statusCode = getStatusCode(detail);
    if (statusCode === "inactive") return "Desactivado";
    if (statusCode === "pending") return "Pendiente";
    return "Activado";
  }

  async function openAccountModal(quotation) {
    const accountId = Number(quotation?.accountId || 0);
    if (!accountId) return;
    setOpenQuotationMenuId(null);
    setAccountModalAccount({
      id: accountId,
      name: quotation?.accountName || `Cuenta #${accountId}`,
    });
    setAccountModalDetail(null);
    setAccountModalError("");
    setAccountModalStatusFilter("all");
    setAccountModalLoading(true);
    try {
      const { data } = await api.get(`/api/accounts/${accountId}`);
      setAccountModalDetail(data || null);
    } catch (err) {
      setAccountModalError(
        getApiErrorMessage(
          err,
          "No fue posible cargar el detalle de la cuenta",
        ),
      );
    } finally {
      setAccountModalLoading(false);
    }
  }

  function closeAccountModal() {
    setAccountModalAccount(null);
    setAccountModalDetail(null);
    setAccountModalError("");
    setAccountModalStatusFilter("all");
    setAccountModalLoading(false);
  }

  async function openOpportunityModal(quotation) {
    const opportunityId = Number(quotation?.opportunityId || 0);
    if (!opportunityId) return;
    setOpenQuotationMenuId(null);
    setOpportunityModalOpportunity({
      id: opportunityId,
      name: quotation?.opportunityName || `Oportunidad #${opportunityId}`,
    });
    setOpportunityModalDetail(null);
    setOpportunityModalError("");
    setOpportunityModalStatusFilter("all");
    setOpportunityModalLoading(true);
    try {
      const { data } = await api.get(`/api/opportunities/${opportunityId}`);
      setOpportunityModalDetail(data || null);
    } catch (err) {
      setOpportunityModalError(
        getApiErrorMessage(
          err,
          "No fue posible cargar el detalle de la oportunidad",
        ),
      );
    } finally {
      setOpportunityModalLoading(false);
    }
  }

  function closeOpportunityModal() {
    setOpportunityModalOpportunity(null);
    setOpportunityModalDetail(null);
    setOpportunityModalError("");
    setOpportunityModalStatusFilter("all");
    setOpportunityModalLoading(false);
  }

  async function resolveContactMeta(quotation, selectedVersion) {
    const versionContactId = Number(selectedVersion?.contactId || 0);
    const versionContactName = String(
      selectedVersion?.contactName || "",
    ).trim();
    if (versionContactId) {
      return {
        id: versionContactId,
        name: versionContactName || `Contacto #${versionContactId}`,
      };
    }

    const quotationId = Number(quotation?.id || 0);
    if (!quotationId) return null;
    const { data } = await api.get(`/api/quotations/${quotationId}`);
    const versions = Array.isArray(data?.versions) ? data.versions : [];
    const preferredVersionId = Number(selectedVersion?.id || 0);
    const preferred =
      versions.find((version) => Number(version.id) === preferredVersionId) ||
      versions.find(
        (version) => Number(version.id) === Number(data?.latestVersionId || 0),
      ) ||
      versions[0] ||
      null;
    if (!preferred) return null;

    const contactId = Number(preferred.contactId || 0);
    if (!contactId) return null;

    return {
      id: contactId,
      name:
        String(preferred.contactName || "").trim() || `Contacto #${contactId}`,
    };
  }

  async function openContactModal(quotation, selectedVersion) {
    setOpenQuotationMenuId(null);
    setContactModalDetail(null);
    setContactModalError("");
    setContactModalStatusFilter("all");
    setContactModalLoading(true);
    try {
      const contactMeta = await resolveContactMeta(quotation, selectedVersion);
      if (!contactMeta?.id) {
        setContactModalError(
          "No hay contacto asociado a la cotizacion seleccionada",
        );
        setContactModalContact({ id: 0, name: "Contacto" });
        return;
      }
      setContactModalContact(contactMeta);
      const { data } = await api.get(`/api/contacts/${Number(contactMeta.id)}`);
      setContactModalDetail(data || null);
    } catch (err) {
      setContactModalError(
        getApiErrorMessage(
          err,
          "No fue posible cargar el detalle del contacto",
        ),
      );
      setContactModalContact({ id: 0, name: "Contacto" });
    } finally {
      setContactModalLoading(false);
    }
  }

  function closeContactModal() {
    setContactModalContact(null);
    setContactModalDetail(null);
    setContactModalError("");
    setContactModalStatusFilter("all");
    setContactModalLoading(false);
  }

  const formattedAmount = (value, currencyCode) => {
    if (value === null || value === undefined || value === "") return "-";
    const normalizedCurrency = String(currencyCode || "USD")
      .trim()
      .toUpperCase();

    try {
      const formattedValue = Number(value).toLocaleString("es-MX", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      return `${normalizedCurrency} ${formattedValue}`;
    } catch {
      const formattedValue = Number(value).toLocaleString("es-MX", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      return `USD ${formattedValue}`;
    }
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
        statusCode: quotation.latestStatusCode || "",
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
            Aún no hay cotizaciones para esta oportunidad.
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
            <strong>Cotización #{quotation.id}</strong>
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
                Estado cotización{" "}
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
                <td className="quotation-amount-cell">
                  {formattedAmount(
                    quotation.latestTotalSaleAmount,
                    quotation.latestCurrencyCode,
                  )}
                </td>
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
                      const selectedEditVersion = versionOptions.find(
                        (version) =>
                          Number(version.id) === Number(selectedEditVersionId),
                      );
                      const loadingVersions =
                        loadingQuotationVersionsByQuotationId[quotationId];
                      const canOpenProposal =
                        typeof onCreateProposalFromQuotationVersion ===
                          "function" &&
                        Number(selectedEditVersion?.proposalId || 0) > 0;
                      const canCreateProposal =
                        typeof onCreateProposalFromQuotationVersion ===
                          "function" &&
                        selectedEditVersion?.statusCode === "aprobada" &&
                        !canOpenProposal;
                      const proposalActionLabel = canOpenProposal
                        ? "Abrir propuesta"
                        : "Crear propuesta";
                      const canDuplicateQuotation =
                        typeof openDuplicateQuotationModal === "function" &&
                        Number(selectedEditVersionId || 0) > 0;

                      return (
                        <>
                          <button
                            type="button"
                            className="kebab-btn"
                            data-help-id="quotations.actions"
                            onClick={() => toggleQuotationMenu(quotation)}
                            aria-label="Abrir acciones"
                            aria-haspopup="menu"
                            aria-expanded={openQuotationMenuId === quotation.id}
                          >
                            ⋮
                          </button>
                          {openQuotationMenuId === quotation.id ? (
                            <div className="user-kebab-menu quotation-actions-menu">
                              <div className="quotation-actions-menu-section">
                                <label
                                  className="quotation-actions-menu-label"
                                  htmlFor={`quotation-edit-version-${quotation.id}`}
                                >
                                  Version
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
                              </div>

                              <div className="quotation-actions-menu-section quotation-actions-menu-section-actions">
                                <button
                                  type="button"
                                  className="quotation-actions-menu-button is-secondary"
                                  disabled={!Number(quotation.accountId || 0)}
                                  onClick={() => openAccountModal(quotation)}
                                >
                                  <span className="quotation-actions-menu-button-body">
                                    <span className="quotation-actions-menu-button-title">
                                      Cuenta
                                    </span>
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  className="quotation-actions-menu-button is-secondary"
                                  disabled={
                                    !Number(quotation.opportunityId || 0)
                                  }
                                  onClick={() =>
                                    openOpportunityModal(quotation)
                                  }
                                >
                                  <span className="quotation-actions-menu-button-body">
                                    <span className="quotation-actions-menu-button-title">
                                      Oportunidad
                                    </span>
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  className="quotation-actions-menu-button is-secondary"
                                  disabled={!Number(quotation.id || 0)}
                                  onClick={() =>
                                    openContactModal(
                                      quotation,
                                      selectedEditVersion,
                                    )
                                  }
                                >
                                  <span className="quotation-actions-menu-button-body">
                                    <span className="quotation-actions-menu-button-title">
                                      Contacto
                                    </span>
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  className="quotation-actions-menu-button is-primary"
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
                                  <span
                                    className="quotation-actions-menu-button-icon"
                                    aria-hidden="true"
                                  >
                                    <svg viewBox="0 0 20 20" focusable="false">
                                      <path
                                        d="M13.7 2.3a1 1 0 0 1 1.4 0l2.6 2.6a1 1 0 0 1 0 1.4l-8.6 8.6-3.8.9.9-3.8 8.6-8.6zM5.8 13.3l.9.9-.3-1.2-.6.3z"
                                        fill="currentColor"
                                      />
                                    </svg>
                                  </span>
                                  <span className="quotation-actions-menu-button-body">
                                    <span className="quotation-actions-menu-button-title">
                                      Editar cotización
                                    </span>
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  className="quotation-actions-menu-button is-secondary"
                                  disabled={!canDuplicateQuotation}
                                  onClick={() =>
                                    openDuplicateQuotationModal?.(
                                      quotation,
                                      selectedEditVersion,
                                    )
                                  }
                                >
                                  <span
                                    className="quotation-actions-menu-button-icon"
                                    aria-hidden="true"
                                  >
                                    <svg viewBox="0 0 20 20" focusable="false">
                                      <path
                                        d="M4 4h8a2 2 0 0 1 2 2v2h2a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H8a2 2 0 0 1-2-2v-2H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1 2v5h7V6H5zm3 7v2h7v-5h-1v4a1 1 0 0 1-1 1H8z"
                                        fill="currentColor"
                                      />
                                    </svg>
                                  </span>
                                  <span className="quotation-actions-menu-button-body">
                                    <span className="quotation-actions-menu-button-title">
                                      Duplicar cotización
                                    </span>
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  className="quotation-actions-menu-button is-secondary"
                                  disabled={
                                    loadingVersions ||
                                    (!canCreateProposal && !canOpenProposal)
                                  }
                                  onClick={() => {
                                    onCreateProposalFromQuotationVersion?.(
                                      quotation,
                                      selectedEditVersion,
                                    );
                                    setOpenQuotationMenuId(null);
                                  }}
                                >
                                  <span
                                    className="quotation-actions-menu-button-icon"
                                    aria-hidden="true"
                                  >
                                    <svg viewBox="0 0 20 20" focusable="false">
                                      <path
                                        d="M4 3h8a2 2 0 0 1 2 2v1h2a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H8a2 2 0 0 1-2-2v-1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm1 2v7h7V5H5zm3 8v2h7V8h-1v6a1 1 0 0 1-1 1H8z"
                                        fill="currentColor"
                                      />
                                    </svg>
                                  </span>
                                  <span className="quotation-actions-menu-button-body">
                                    <span className="quotation-actions-menu-button-title">
                                      {proposalActionLabel}
                                    </span>
                                  </span>
                                </button>
                              </div>
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

      {accountModalAccount ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`Cuenta ${accountModalAccount.name}`}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeAccountModal();
            }
          }}
        >
          <div className="modal-dialog modal-dialog-wide modal-dialog-account-opps">
            <div className="modal-header">
              <h3 className="modal-title">
                Cuenta -{" "}
                <span style={{ fontWeight: 400 }}>
                  {accountModalAccount.name}
                </span>
              </h3>
            </div>

            {!accountModalLoading &&
            !accountModalError &&
            accountModalDetail ? (
              <div className="account-opps-filters">
                <div
                  className="account-opps-pills"
                  role="group"
                  aria-label="Filtrar por estado"
                >
                  {[
                    { value: "active", label: "Activas", tone: "active" },
                    {
                      value: "inactive",
                      label: "Desactivadas",
                      tone: "inactive",
                    },
                    { value: "all", label: "Todas", tone: "all" },
                  ].map((status) => (
                    <button
                      key={status.value}
                      type="button"
                      className={`account-opps-pill account-opps-pill--${status.tone}${
                        accountModalStatusFilter === status.value
                          ? " is-active"
                          : ""
                      }`}
                      onClick={() => setAccountModalStatusFilter(status.value)}
                    >
                      {status.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {(() => {
              const items = accountModalDetail ? [accountModalDetail] : [];
              const visibleItems =
                accountModalStatusFilter === "all"
                  ? items
                  : items.filter((item) => {
                      const inactive = getStatusCode(item) === "inactive";
                      return accountModalStatusFilter === "inactive"
                        ? inactive
                        : !inactive;
                    });

              if (accountModalLoading) {
                return (
                  <p className="account-opps-empty">Cargando cuentas...</p>
                );
              }
              if (accountModalError) {
                return (
                  <p className="account-opps-empty">{accountModalError}</p>
                );
              }
              if (!items.length) {
                return (
                  <p className="account-opps-empty">
                    No hay cuentas registradas para esta cotizacion.
                  </p>
                );
              }
              if (!visibleItems.length) {
                return (
                  <p className="account-opps-empty">
                    Sin resultados para el filtro seleccionado.
                  </p>
                );
              }

              return (
                <div className="account-opps-list">
                  {visibleItems.map((item) => (
                    <div
                      key={item.id || accountModalAccount.id}
                      className="account-opp-row"
                    >
                      <div className="account-opp-main">
                        <span className="account-opp-name">
                          {item.name || accountModalAccount.name}
                        </span>
                        <span className={getStatusBadgeClass(item)}>
                          {getStatusLabel(item)}
                        </span>
                      </div>
                      <div className="account-opp-meta">
                        <span>Tipo: {item.account_type || "-"}</span>
                        <span>Sector: {item.economic_sector || "-"}</span>
                        <span>Pais: {item.country || "-"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}

            <div className="modal-buttons" style={{ marginTop: 16 }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={closeAccountModal}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {opportunityModalOpportunity ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`Oportunidad ${opportunityModalOpportunity.name}`}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeOpportunityModal();
            }
          }}
        >
          <div className="modal-dialog modal-dialog-wide modal-dialog-account-opps">
            <div className="modal-header">
              <h3 className="modal-title">
                Oportunidad -{" "}
                <span style={{ fontWeight: 400 }}>
                  {opportunityModalOpportunity.name}
                </span>
              </h3>
            </div>

            {!opportunityModalLoading &&
            !opportunityModalError &&
            opportunityModalDetail ? (
              <div className="account-opps-filters">
                <div
                  className="account-opps-pills"
                  role="group"
                  aria-label="Filtrar por estado"
                >
                  {[
                    { value: "active", label: "Activas", tone: "active" },
                    {
                      value: "inactive",
                      label: "Desactivadas",
                      tone: "inactive",
                    },
                    { value: "all", label: "Todas", tone: "all" },
                  ].map((status) => (
                    <button
                      key={status.value}
                      type="button"
                      className={`account-opps-pill account-opps-pill--${status.tone}${
                        opportunityModalStatusFilter === status.value
                          ? " is-active"
                          : ""
                      }`}
                      onClick={() =>
                        setOpportunityModalStatusFilter(status.value)
                      }
                    >
                      {status.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {(() => {
              const items = opportunityModalDetail
                ? [opportunityModalDetail]
                : [];
              const visibleItems =
                opportunityModalStatusFilter === "all"
                  ? items
                  : items.filter((item) => {
                      const inactive = getStatusCode(item) === "inactive";
                      return opportunityModalStatusFilter === "inactive"
                        ? inactive
                        : !inactive;
                    });

              if (opportunityModalLoading) {
                return (
                  <p className="account-opps-empty">
                    Cargando oportunidades...
                  </p>
                );
              }
              if (opportunityModalError) {
                return (
                  <p className="account-opps-empty">{opportunityModalError}</p>
                );
              }
              if (!items.length) {
                return (
                  <p className="account-opps-empty">
                    No hay oportunidades registradas para esta cotizacion.
                  </p>
                );
              }
              if (!visibleItems.length) {
                return (
                  <p className="account-opps-empty">
                    Sin resultados para el filtro seleccionado.
                  </p>
                );
              }

              return (
                <div className="account-opps-list">
                  {visibleItems.map((item) => (
                    <div
                      key={item.id || opportunityModalOpportunity.id}
                      className="account-opp-row"
                    >
                      <div className="account-opp-main">
                        <span className="account-opp-name">
                          {item.name || opportunityModalOpportunity.name}
                        </span>
                        <span className={getStatusBadgeClass(item)}>
                          {getStatusLabel(item)}
                        </span>
                      </div>
                      <div className="account-opp-meta">
                        <span>Cuenta: {item.account_name || "-"}</span>
                        <span>Etapa: {item.sales_stage || "-"}</span>
                        <span>
                          Importe:{" "}
                          {Number(item.amount_usd || 0).toLocaleString(
                            "en-US",
                            { style: "currency", currency: "USD" },
                          )}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}

            <div className="modal-buttons" style={{ marginTop: 16 }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={closeOpportunityModal}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {contactModalContact ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`Contacto ${contactModalContact.name}`}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeContactModal();
            }
          }}
        >
          <div className="modal-dialog modal-dialog-wide modal-dialog-account-opps">
            <div className="modal-header">
              <h3 className="modal-title">
                Contacto -{" "}
                <span style={{ fontWeight: 400 }}>
                  {contactModalContact.name}
                </span>
              </h3>
            </div>

            {!contactModalLoading &&
            !contactModalError &&
            contactModalDetail ? (
              <div className="account-opps-filters">
                <div
                  className="account-opps-pills"
                  role="group"
                  aria-label="Filtrar por estado"
                >
                  {[
                    { value: "active", label: "Activas", tone: "active" },
                    {
                      value: "inactive",
                      label: "Desactivadas",
                      tone: "inactive",
                    },
                    { value: "all", label: "Todas", tone: "all" },
                  ].map((status) => (
                    <button
                      key={status.value}
                      type="button"
                      className={`account-opps-pill account-opps-pill--${status.tone}${
                        contactModalStatusFilter === status.value
                          ? " is-active"
                          : ""
                      }`}
                      onClick={() => setContactModalStatusFilter(status.value)}
                    >
                      {status.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {(() => {
              const items = contactModalDetail ? [contactModalDetail] : [];
              const visibleItems =
                contactModalStatusFilter === "all"
                  ? items
                  : items.filter((item) => {
                      const inactive = getStatusCode(item) === "inactive";
                      return contactModalStatusFilter === "inactive"
                        ? inactive
                        : !inactive;
                    });

              if (contactModalLoading) {
                return (
                  <p className="account-opps-empty">Cargando contactos...</p>
                );
              }
              if (contactModalError) {
                return (
                  <p className="account-opps-empty">{contactModalError}</p>
                );
              }
              if (!items.length) {
                return (
                  <p className="account-opps-empty">
                    No hay contactos registrados para esta cotizacion.
                  </p>
                );
              }
              if (!visibleItems.length) {
                return (
                  <p className="account-opps-empty">
                    Sin resultados para el filtro seleccionado.
                  </p>
                );
              }

              return (
                <div className="account-opps-list">
                  {visibleItems.map((item) => (
                    <div
                      key={item.id || contactModalContact.id}
                      className="account-opp-row"
                    >
                      <div className="account-opp-main">
                        <span className="account-opp-name">
                          {item.full_name || contactModalContact.name}
                        </span>
                        <span className={getStatusBadgeClass(item)}>
                          {getContactStatusLabel(item)}
                        </span>
                      </div>
                      <div className="account-opp-meta">
                        <span>Cargo: {item.position_title || "-"}</span>
                        <span>E-mail: {item.email || "-"}</span>
                        <span>Movil: {item.mobile || "-"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}

            <div className="modal-buttons" style={{ marginTop: 16 }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={closeContactModal}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {duplicateQuotationModalState?.isOpen ? (
        <div className="modal-overlay" onClick={closeDuplicateQuotationModal}>
          <div
            className="modal-dialog modal-dialog-account"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="modal-title">Duplicar cotización</h3>
            <p className="field-hint opportunity-modal-subtitle">
              La nueva cotización copiará la
              {` ${duplicateQuotationModalState.sourceVersionLabel || "version seleccionada"}`}{" "}
              sin adjuntar documentos.
            </p>
            <div className="field-group">
              <label>Cuenta destino</label>
              <select
                value={duplicateQuotationModalState.targetAccountId || ""}
                onChange={(event) =>
                  handleDuplicateQuotationTargetAccountChange?.(
                    event.target.value,
                  )
                }
              >
                <option value="">Selecciona cuenta</option>
                {(Array.isArray(duplicateTargetAccounts)
                  ? duplicateTargetAccounts
                  : []
                ).map((account) => (
                  <option key={account.id} value={String(account.id)}>
                    {account.name || `Cuenta ${account.id}`}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-group">
              <label>Oportunidad destino</label>
              <select
                value={duplicateQuotationModalState.targetOpportunityId || ""}
                disabled={
                  !duplicateQuotationModalState.targetAccountId ||
                  loadingDuplicateTargetOpportunities
                }
                onChange={(event) =>
                  handleDuplicateQuotationTargetOpportunityChange?.(
                    event.target.value,
                  )
                }
              >
                <option value="">Selecciona oportunidad</option>
                {(Array.isArray(duplicateTargetOpportunities)
                  ? duplicateTargetOpportunities
                  : []
                ).map((opportunity) => (
                  <option key={opportunity.id} value={String(opportunity.id)}>
                    {opportunity.name || `Oportunidad ${opportunity.id}`}
                  </option>
                ))}
              </select>
              {loadingDuplicateTargetOpportunities ? (
                <p className="field-hint">Cargando oportunidades...</p>
              ) : null}
            </div>
            {duplicateQuotationModalState.error ? (
              <p className="field-hint quotation-product-picker-error">
                {duplicateQuotationModalState.error}
              </p>
            ) : null}
            <div className="modal-buttons">
              <button
                type="button"
                className="btn-secondary"
                onClick={closeDuplicateQuotationModal}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={busyAction === "duplicate-quotation"}
                onClick={handleDuplicateQuotation}
              >
                Duplicar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default QuotationsListPanel;
