import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import AccountQuotationsModal from "../accounts/AccountQuotationsModal";
import AccountProposalsModal from "../accounts/AccountProposalsModal";
import { useAccountRelatedRecords } from "../accounts/useAccountRelatedRecords";
import { api, getApiErrorMessage } from "../api";

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
  const navigate = useNavigate();
  const [accountModalAccount, setAccountModalAccount] = useState(null);
  const [accountModalDetail, setAccountModalDetail] = useState(null);
  const [accountModalLoading, setAccountModalLoading] = useState(false);
  const [accountModalError, setAccountModalError] = useState("");
  const [accountModalStatusFilter, setAccountModalStatusFilter] =
    useState("all");
  const [contactModalContact, setContactModalContact] = useState(null);
  const [contactModalDetail, setContactModalDetail] = useState(null);
  const [contactModalLoading, setContactModalLoading] = useState(false);
  const [contactModalError, setContactModalError] = useState("");
  const [contactModalStatusFilter, setContactModalStatusFilter] =
    useState("all");
  const {
    accountQuotationsModalAccount,
    accountProposalsModalAccount,
    editAccountQuotations,
    editAccountProposals,
    loadingAccountQuotations,
    loadingAccountProposals,
    quotationModalStatusFilter,
    proposalModalStatusFilter,
    setQuotationModalStatusFilter,
    setProposalModalStatusFilter,
    openAccountQuotationsModal,
    closeAccountQuotationsModal,
    openAccountProposalsModal,
    closeAccountProposalsModal,
    getQuotationStatusBadgeClass,
    getProposalStatusBadgeClass,
  } = useAccountRelatedRecords();

  function toOpportunityAccount(opportunity) {
    const accountId = Number(opportunity?.account_id || 0);
    return {
      id: accountId,
      name:
        String(opportunity?.account_name || "").trim() ||
        `Cuenta #${accountId}`,
    };
  }

  function toOpportunityContact(opportunity) {
    const contactId = Number(opportunity?.contact_id || 0);
    return {
      id: contactId,
      name:
        String(opportunity?.contact_name || "").trim() ||
        `Contacto #${contactId}`,
    };
  }

  function normalizeSpanishStatus(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  }

  function getAccountModalStatusCode(accountDetail) {
    const status = normalizeSpanishStatus(
      accountDetail?.activation_status || accountDetail?.activationStatus || "",
    );
    if (status.includes("desactiv")) return "inactive";
    if (status.includes("pendiente")) return "pending";
    return "active";
  }

  function getAccountModalStatusLabel(accountDetail) {
    const statusCode = getAccountModalStatusCode(accountDetail);
    if (statusCode === "inactive") return "Desactivada";
    if (statusCode === "pending") return "Pendiente";
    return "Activada";
  }

  function getAccountModalStatusBadgeClass(accountDetail) {
    const statusCode = getAccountModalStatusCode(accountDetail);
    if (statusCode === "inactive") return "user-status-badge inactive";
    if (statusCode === "pending") return "user-status-badge pending";
    return "user-status-badge active";
  }

  function getContactModalStatusCode(contactDetail) {
    const status = normalizeSpanishStatus(
      contactDetail?.activation_status || contactDetail?.activationStatus || "",
    );
    if (status.includes("desactiv")) return "inactive";
    if (status.includes("pendiente")) return "pending";
    return "active";
  }

  function getContactModalStatusLabel(contactDetail) {
    const statusCode = getContactModalStatusCode(contactDetail);
    if (statusCode === "inactive") return "Desactivado";
    if (statusCode === "pending") return "Pendiente";
    return "Activado";
  }

  function getContactModalStatusBadgeClass(contactDetail) {
    const statusCode = getContactModalStatusCode(contactDetail);
    if (statusCode === "inactive") return "user-status-badge inactive";
    if (statusCode === "pending") return "user-status-badge pending";
    return "user-status-badge active";
  }

  async function openOpportunityAccountModal(opportunity) {
    const account = toOpportunityAccount(opportunity);
    if (!Number(account.id || 0)) return;

    setAccountModalAccount(account);
    setAccountModalDetail(null);
    setAccountModalError("");
    setAccountModalStatusFilter("all");
    setAccountModalLoading(true);
    try {
      const { data } = await api.get(`/api/accounts/${Number(account.id)}`);
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

  function closeOpportunityAccountModal() {
    setAccountModalAccount(null);
    setAccountModalDetail(null);
    setAccountModalError("");
    setAccountModalStatusFilter("all");
    setAccountModalLoading(false);
  }

  async function openOpportunityContactModal(opportunity) {
    const contact = toOpportunityContact(opportunity);
    if (!Number(contact.id || 0)) return;

    setContactModalContact(contact);
    setContactModalDetail(null);
    setContactModalError("");
    setContactModalStatusFilter("all");
    setContactModalLoading(true);
    try {
      const { data } = await api.get(`/api/contacts/${Number(contact.id)}`);
      setContactModalDetail(data || null);
    } catch (err) {
      setContactModalError(
        getApiErrorMessage(
          err,
          "No fue posible cargar el detalle del contacto",
        ),
      );
    } finally {
      setContactModalLoading(false);
    }
  }

  function closeOpportunityContactModal() {
    setContactModalContact(null);
    setContactModalDetail(null);
    setContactModalError("");
    setContactModalStatusFilter("all");
    setContactModalLoading(false);
  }

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
            <h2 data-help-id="opportunities.title">Oportunidades</h2>
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
            Las cotizaciones ahora se administran desde su módulo principal.
          </p>
        </div>
        {canCreateOrRequestOpportunities && (
          <button
            type="button"
            className="btn-primary"
            data-help-id="opportunities.create"
            onClick={openCreateOpportunityModal}
          >
            + Crear oportunidad
          </button>
        )}
      </div>

      <div className="roles-pills-bar accounts-pills-bar-row">
        <div
          data-help-id="opportunities.filters"
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

      {accountModalAccount && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`Cuenta ${accountModalAccount.name}`}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeOpportunityAccountModal();
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
              accountModalDetail && (
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
                        onClick={() =>
                          setAccountModalStatusFilter(status.value)
                        }
                      >
                        {status.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

            {(() => {
              const accountItems = accountModalDetail
                ? [accountModalDetail]
                : [];
              const visibleAccounts =
                accountModalStatusFilter === "all"
                  ? accountItems
                  : accountItems.filter((item) => {
                      const inactive =
                        getAccountModalStatusCode(item) === "inactive";
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
              if (accountItems.length === 0) {
                return (
                  <p className="account-opps-empty">
                    No hay cuentas registradas para esta oportunidad.
                  </p>
                );
              }
              if (visibleAccounts.length === 0) {
                return (
                  <p className="account-opps-empty">
                    Sin resultados para el filtro seleccionado.
                  </p>
                );
              }

              return (
                <div className="account-opps-list">
                  {visibleAccounts.map((item) => (
                    <div
                      key={item.id || accountModalAccount.id}
                      className="account-opp-row"
                    >
                      <div className="account-opp-main">
                        <span className="account-opp-name">
                          {item.name || accountModalAccount.name}
                        </span>
                        <span className={getAccountModalStatusBadgeClass(item)}>
                          {getAccountModalStatusLabel(item)}
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
                onClick={closeOpportunityAccountModal}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {contactModalContact && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`Contacto ${contactModalContact.name}`}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeOpportunityContactModal();
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
              contactModalDetail && (
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
                        onClick={() =>
                          setContactModalStatusFilter(status.value)
                        }
                      >
                        {status.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

            {(() => {
              const contactItems = contactModalDetail
                ? [contactModalDetail]
                : [];
              const visibleContacts =
                contactModalStatusFilter === "all"
                  ? contactItems
                  : contactItems.filter((item) => {
                      const inactive =
                        getContactModalStatusCode(item) === "inactive";
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
              if (contactItems.length === 0) {
                return (
                  <p className="account-opps-empty">
                    No hay contactos registrados para esta oportunidad.
                  </p>
                );
              }
              if (visibleContacts.length === 0) {
                return (
                  <p className="account-opps-empty">
                    Sin resultados para el filtro seleccionado.
                  </p>
                );
              }

              return (
                <div className="account-opps-list">
                  {visibleContacts.map((item) => (
                    <div
                      key={item.id || contactModalContact.id}
                      className="account-opp-row"
                    >
                      <div className="account-opp-main">
                        <span className="account-opp-name">
                          {item.full_name || contactModalContact.name}
                        </span>
                        <span className={getContactModalStatusBadgeClass(item)}>
                          {getContactModalStatusLabel(item)}
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
                onClick={closeOpportunityContactModal}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      <AccountQuotationsModal
        account={accountQuotationsModalAccount}
        loading={loadingAccountQuotations}
        quotations={editAccountQuotations}
        statusFilter={quotationModalStatusFilter}
        setStatusFilter={setQuotationModalStatusFilter}
        onClose={closeAccountQuotationsModal}
        onQuotationSelect={(quotation) => {
          closeAccountQuotationsModal();
          const opportunityId = Number(
            quotation?.opportunityId || quotation?.opportunity_id || 0,
          );
          const quotationId = Number(quotation?.id || 0);
          if (opportunityId && quotationId) {
            navigate(
              `/quotations?opportunityId=${opportunityId}&quotationId=${quotationId}`,
            );
            return;
          }
          if (opportunityId) {
            navigate(`/quotations?opportunityId=${opportunityId}`);
            return;
          }
          navigate("/quotations");
        }}
        getQuotationStatusBadgeClass={getQuotationStatusBadgeClass}
      />

      <AccountProposalsModal
        account={accountProposalsModalAccount}
        loading={loadingAccountProposals}
        proposals={editAccountProposals}
        statusFilter={proposalModalStatusFilter}
        setStatusFilter={setProposalModalStatusFilter}
        onClose={closeAccountProposalsModal}
        onProposalSelect={(proposalId) => {
          closeAccountProposalsModal();
          navigate(`/proposals?proposalId=${Number(proposalId || 0)}`);
        }}
        getProposalStatusBadgeClass={getProposalStatusBadgeClass}
      />

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
                          disabled={!Number(opportunity.account_id || 0)}
                          onClick={(event) => {
                            event.stopPropagation();
                            runOpportunityAction(() =>
                              openOpportunityAccountModal(opportunity),
                            );
                          }}
                        >
                          Cuentas
                        </button>
                        <button
                          type="button"
                          disabled={!Number(opportunity.contact_id || 0)}
                          onClick={(event) => {
                            event.stopPropagation();
                            runOpportunityAction(() =>
                              openOpportunityContactModal(opportunity),
                            );
                          }}
                        >
                          Contacto
                        </button>
                        <button
                          type="button"
                          disabled={!Number(opportunity.account_id || 0)}
                          onClick={(event) => {
                            event.stopPropagation();
                            runOpportunityAction(() =>
                              openAccountQuotationsModal(
                                toOpportunityAccount(opportunity),
                                opportunity.id,
                              ),
                            );
                          }}
                        >
                          Cotizaciones
                        </button>
                        <button
                          type="button"
                          disabled={!Number(opportunity.account_id || 0)}
                          onClick={(event) => {
                            event.stopPropagation();
                            runOpportunityAction(() =>
                              openAccountProposalsModal(
                                toOpportunityAccount(opportunity),
                              ),
                            );
                          }}
                        >
                          Propuestas
                        </button>
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
