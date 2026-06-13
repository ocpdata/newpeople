import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ConfirmationModal } from "./AppModals";
import ContactFormModal from "./contacts/ContactFormModal";
import ContactOpportunitiesModal from "./contacts/ContactOpportunitiesModal";
import AccountQuotationsModal from "./accounts/AccountQuotationsModal";
import AccountProposalsModal from "./accounts/AccountProposalsModal";
import { useAccountRelatedRecords } from "./accounts/useAccountRelatedRecords";
import { api, getApiErrorMessage } from "./api";
import { useContactsPage } from "./contacts/useContactsPage";

function ContactsPage({ can, currentUser }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const canAccessAccounts = can("cuentas.read") || can("cuentas.read_all");
  const canAccessQuotations = [
    "cotizaciones.read",
    "cotizaciones.operacion",
    "cotizaciones.revision",
    "cotizaciones.ingreso",
    "cotizaciones.administracion",
    "cotizaciones.externo",
  ].some(can);
  const canAccessProposals = [
    "propuestas.read",
    "propuestas.create",
    "propuestas.update",
    "cotizaciones.operacion",
    "cotizaciones.revision",
    "cotizaciones.ingreso",
    "cotizaciones.administracion",
    "cotizaciones.externo",
  ].some(can);
  const [accountModalAccount, setAccountModalAccount] = useState(null);
  const [accountModalDetail, setAccountModalDetail] = useState(null);
  const [accountModalLoading, setAccountModalLoading] = useState(false);
  const [accountModalError, setAccountModalError] = useState("");
  const [accountModalStatusFilter, setAccountModalStatusFilter] =
    useState("all");
  const helpRef = useRef(null);
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
  const {
    contactStatusFilter,
    setContactStatusFilter,
    contactQuery,
    setContactQuery,
    contactsPerPage,
    setContactsPerPage,
    contactsPage,
    setContactsPage,
    showContactModal,
    editingContactId,
    editContactAudit,
    contactDuplicateReview,
    editContactOpportunities,
    loadingContactOpportunities,
    contactOppSectionStatusFilter,
    setContactOppSectionStatusFilter,
    contactOppSectionYearFilter,
    setContactOppSectionYearFilter,
    contactOppsModalContact,
    openContactMenuId,
    confirmContactStatusAction,
    savingContact,
    error,
    success,
    catalogs,
    contactsPendingEnabled,
    canCreateOrRequestContacts,
    canChangeContactActivationStatus,
    form,
    totalContactsCount,
    contactStatusCounts,
    visibleContacts,
    pagedContacts,
    totalContactPages,
    managerOptions,
    editingContact,
    opportunityYears,
    visibleContactOpportunities,
    isContactActive,
    isContactPending,
    isContactInactive,
    getContactStatusLabel,
    getContactStatusBadgeClass,
    getContactStatusIconBadgeClass,
    getOpportunityStatusBadgeClass,
    toggleContactSort,
    getContactSortArrow,
    formatDateTime,
    updateContactFormField,
    normalizeContactFormField,
    handleContactAccountChange,
    openCreateContactModal,
    openEditContactModal,
    closeContactModal,
    toggleContactMenu,
    openContactOppsModal,
    closeContactOppsModal,
    runContactAction,
    openContactStatusConfirmation,
    closeContactStatusConfirmation,
    confirmSelectedContactStatusChange,
    getContactStatusConfirmationMeta,
    saveContact,
    dismissContactDuplicateReview,
    openDuplicateCandidateContact,
  } = useContactsPage({ currentUser, searchParams, setSearchParams });

  function handleOpportunitySelect(opportunityId) {
    closeContactOppsModal();
    navigate(`/opportunities?edit=${opportunityId}`);
  }

  function toContactAccount(contact) {
    const accountId = Number(contact?.account_id || 0);
    return {
      id: accountId,
      name:
        String(contact?.account_name || "").trim() || `Cuenta #${accountId}`,
    };
  }

  async function openContactAccountModal(contact) {
    const account = toContactAccount(contact);
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

  function closeContactAccountModal() {
    setAccountModalAccount(null);
    setAccountModalDetail(null);
    setAccountModalError("");
    setAccountModalStatusFilter("all");
    setAccountModalLoading(false);
  }

  function getAccountModalStatusCode(accountDetail) {
    const status = String(
      accountDetail?.activation_status || accountDetail?.activationStatus || "",
    )
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
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
    <section className="panel">
      <ConfirmationModal
        isOpen={Boolean(confirmContactStatusAction)}
        title={getContactStatusConfirmationMeta().title}
        message={getContactStatusConfirmationMeta().message}
        onConfirm={confirmSelectedContactStatusChange}
        onCancel={closeContactStatusConfirmation}
        confirmText={getContactStatusConfirmationMeta().confirmText}
        isDangerous={getContactStatusConfirmationMeta().isDangerous}
      />

      <div className="roles-page-header">
        <div className="roles-page-header-left">
          <div className="module-title-with-icon">
            <h2>Contactos</h2>
            <span
              className="module-title-icon module-title-icon-contacts"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M7 4.5A2.5 2.5 0 0 0 4.5 7v10A2.5 2.5 0 0 0 7 19.5h10a2.5 2.5 0 0 0 2.5-2.5V7A2.5 2.5 0 0 0 17 4.5zm0 1.5h10c.55 0 1 .45 1 1v10c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1V7c0-.55.45-.1 1-1" />
                <path d="M12 8.25a2.25 2.25 0 1 0 2.25 2.25A2.25 2.25 0 0 0 12 8.25m0 6c-1.94 0-3.75.97-3.75 2.1a.65.65 0 0 0 .65.65h6.2a.65.65 0 0 0 .65-.65c0-1.13-1.81-2.1-3.75-2.1" />
              </svg>
            </span>
            <details className="accounts-module-help" ref={helpRef}>
              <summary
                className="accounts-module-help-trigger"
                aria-label="Ayuda sobre el módulo de contactos"
                title="Ayuda sobre el módulo"
              >
                ?
              </summary>
              <div className="accounts-module-help-popover">
                <strong>Para qué sirve</strong>
                <p>
                  Este módulo organiza a las personas de contacto asociadas a
                  las cuentas y concentra sus datos de comunicación y relación.
                </p>
                <strong>Cómo usarlo</strong>
                <p>
                  Úsalo para registrar contactos, relacionarlos con su cuenta,
                  revisar su estado y consultar las oportunidades en las que
                  participan.
                </p>
              </div>
            </details>
          </div>
          <p className="roles-subtitle">
            Gestiona los contactos del sistema y sus datos de comunicación
          </p>
        </div>
        {canCreateOrRequestContacts && (
          <button
            type="button"
            className="btn-primary"
            onClick={openCreateContactModal}
          >
            + Crear contacto
          </button>
        )}
      </div>

      <div className="roles-pills-bar accounts-pills-bar-row">
        <div
          className="accounts-status-pills"
          role="group"
          aria-label="Filtrar contactos por estado"
        >
          <button
            type="button"
            className={
              contactStatusFilter === "active"
                ? "status-filter-pill status-filter-pill-active is-selected"
                : "status-filter-pill status-filter-pill-active"
            }
            aria-pressed={contactStatusFilter === "active"}
            onClick={() => setContactStatusFilter("active")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Activos</span>
            <span className="status-filter-pill-count">
              {contactStatusCounts.active}
            </span>
          </button>
          {contactsPendingEnabled ? (
            <button
              type="button"
              className={
                contactStatusFilter === "pending"
                  ? "status-filter-pill status-filter-pill-pending is-selected"
                  : "status-filter-pill status-filter-pill-pending"
              }
              aria-pressed={contactStatusFilter === "pending"}
              onClick={() => setContactStatusFilter("pending")}
            >
              <span className="status-filter-pill-dot" aria-hidden="true" />
              <span className="status-filter-pill-text">Pendientes</span>
              <span className="status-filter-pill-count">
                {contactStatusCounts.pending}
              </span>
            </button>
          ) : null}
          <button
            type="button"
            className={
              contactStatusFilter === "inactive"
                ? "status-filter-pill status-filter-pill-inactive is-selected"
                : "status-filter-pill status-filter-pill-inactive"
            }
            aria-pressed={contactStatusFilter === "inactive"}
            onClick={() => setContactStatusFilter("inactive")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Desactivados</span>
            <span className="status-filter-pill-count">
              {contactStatusCounts.inactive}
            </span>
          </button>
          <button
            type="button"
            className={
              contactStatusFilter === "all"
                ? "status-filter-pill status-filter-pill-all is-selected"
                : "status-filter-pill status-filter-pill-all"
            }
            aria-pressed={contactStatusFilter === "all"}
            onClick={() => setContactStatusFilter("all")}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Todas</span>
            <span className="status-filter-pill-count">
              {totalContactsCount}
            </span>
          </button>
        </div>
        <input
          className="accounts-search-inline"
          type="text"
          placeholder="Buscar por nombre, cuenta, cargo, email, móvil o estado"
          value={contactQuery}
          onChange={(event) => setContactQuery(event.target.value)}
        />
      </div>

      <ContactFormModal
        isOpen={showContactModal}
        editingContactId={editingContactId}
        currentContact={editingContact}
        form={form}
        catalogs={catalogs}
        managerOptions={managerOptions}
        editContactAudit={editContactAudit}
        contactDuplicateReview={contactDuplicateReview}
        savingContact={savingContact}
        onClose={closeContactModal}
        onSubmit={saveContact}
        onDismissDuplicateReview={dismissContactDuplicateReview}
        onOpenDuplicateCandidate={openDuplicateCandidateContact}
        onChange={updateContactFormField}
        onNormalizeField={normalizeContactFormField}
        onAccountChange={handleContactAccountChange}
        getContactStatusIconBadgeClass={getContactStatusIconBadgeClass}
        getContactStatusLabel={getContactStatusLabel}
        formatDateTime={formatDateTime}
      />

      <ContactOpportunitiesModal
        contact={contactOppsModalContact}
        loading={loadingContactOpportunities}
        opportunities={editContactOpportunities}
        visibleOpportunities={visibleContactOpportunities}
        statusFilter={contactOppSectionStatusFilter}
        yearFilter={contactOppSectionYearFilter}
        availableYears={opportunityYears}
        onClose={closeContactOppsModal}
        onStatusFilterChange={setContactOppSectionStatusFilter}
        onYearFilterChange={setContactOppSectionYearFilter}
        onOpportunitySelect={handleOpportunitySelect}
        getOpportunityStatusBadgeClass={getOpportunityStatusBadgeClass}
      />

      {accountModalAccount && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`Cuenta ${accountModalAccount.name}`}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeContactAccountModal();
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
                    No hay cuentas registradas para esta cuenta.
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
                onClick={closeContactAccountModal}
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

      {error && <div className="toast toast-error">{error}</div>}
      {success && <div className="toast toast-success">{success}</div>}

      <table>
        <thead>
          <tr>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleContactSort("id")}
              >
                ID <span>{getContactSortArrow("id")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleContactSort("nombre")}
              >
                Nombre <span>{getContactSortArrow("nombre")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleContactSort("cuenta")}
              >
                Cuenta <span>{getContactSortArrow("cuenta")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleContactSort("cargo")}
              >
                Cargo <span>{getContactSortArrow("cargo")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleContactSort("email")}
              >
                E-mail <span>{getContactSortArrow("email")}</span>
              </button>
            </th>
            <th>Móvil</th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleContactSort("estado")}
              >
                Estado <span>{getContactSortArrow("estado")}</span>
              </button>
            </th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {visibleContacts.length > 0 ? (
            pagedContacts.map((contact) => (
              <tr
                key={contact.id}
                className="accounts-row-clickable"
                onClick={() => openEditContactModal(contact.id)}
              >
                <td>{contact.id}</td>
                <td>{contact.full_name}</td>
                <td>{contact.account_name}</td>
                <td>{contact.position_title || "-"}</td>
                <td>{contact.email || "-"}</td>
                <td>{contact.mobile || "-"}</td>
                <td>
                  <span className={getContactStatusBadgeClass(contact)}>
                    {getContactStatusLabel(contact)}
                  </span>
                </td>
                <td
                  className="accounts-actions-cell"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="user-kebab-wrap contacts-kebab-wrap">
                    <button
                      type="button"
                      className="kebab-btn"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleContactMenu(contact.id);
                      }}
                      aria-label="Abrir acciones"
                    >
                      ⋮
                    </button>
                    {openContactMenuId === contact.id && (
                      <div className="user-kebab-menu">
                        {canAccessAccounts && (
                          <button
                            type="button"
                            disabled={!Number(contact.account_id || 0)}
                            onClick={(event) => {
                              event.stopPropagation();
                              runContactAction(() =>
                                openContactAccountModal(contact),
                              );
                            }}
                          >
                            Cuenta
                          </button>
                        )}
                        {canAccessQuotations && (
                          <button
                            type="button"
                            disabled={!Number(contact.account_id || 0)}
                            onClick={(event) => {
                              event.stopPropagation();
                              runContactAction(() =>
                                openAccountQuotationsModal(
                                  toContactAccount(contact),
                                ),
                              );
                            }}
                          >
                            Cotizaciones
                          </button>
                        )}
                        {canAccessProposals && (
                          <button
                            type="button"
                            disabled={!Number(contact.account_id || 0)}
                            onClick={(event) => {
                              event.stopPropagation();
                              runContactAction(() =>
                                openAccountProposalsModal(
                                  toContactAccount(contact),
                                ),
                              );
                            }}
                          >
                            Propuestas
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            runContactAction(() =>
                              openEditContactModal(contact.id),
                            );
                          }}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          disabled={
                            !canChangeContactActivationStatus ||
                            isContactActive(contact)
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            openContactStatusConfirmation(contact, "activado");
                          }}
                        >
                          Activar
                        </button>
                        {contactsPendingEnabled ? (
                          <button
                            type="button"
                            disabled={
                              !canChangeContactActivationStatus ||
                              isContactPending(contact)
                            }
                            onClick={(event) => {
                              event.stopPropagation();
                              openContactStatusConfirmation(
                                contact,
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
                            !canChangeContactActivationStatus ||
                            isContactInactive(contact)
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            openContactStatusConfirmation(
                              contact,
                              "desactivado",
                            );
                          }}
                        >
                          Desactivar
                        </button>
                        {can("oportunidades.read") && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              runContactAction(() =>
                                openContactOppsModal(contact),
                              );
                            }}
                          >
                            Oportunidades
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
                No hay contactos que coincidan con los filtros
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {visibleContacts.length > 0 && (
        <div className="users-pagination">
          <div className="users-pagination-left">
            <span className="users-pagination-info">
              {(contactsPage - 1) * contactsPerPage + 1}–
              {Math.min(contactsPage * contactsPerPage, visibleContacts.length)}{" "}
              de {visibleContacts.length}
            </span>
          </div>
          <div className="users-pagination-center">
            <button
              type="button"
              className="users-page-btn"
              disabled={contactsPage === 1}
              onClick={() => setContactsPage((page) => page - 1)}
            >
              ‹
            </button>
            <span className="users-pagination-pages">
              {contactsPage} / {totalContactPages}
            </span>
            <button
              type="button"
              className="users-page-btn"
              disabled={contactsPage === totalContactPages}
              onClick={() => setContactsPage((page) => page + 1)}
            >
              ›
            </button>
          </div>
          <div className="users-pagination-right">
            <span className="users-pagination-label">Por página:</span>
            {[10, 50, 100].map((size) => (
              <button
                key={size}
                type="button"
                className={`users-perpage-btn${
                  contactsPerPage === size ? " is-active" : ""
                }`}
                onClick={() => setContactsPerPage(size)}
              >
                {size}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export default ContactsPage;
