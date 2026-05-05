import { useNavigate, useSearchParams } from "react-router-dom";
import { ConfirmationModal } from "./AppModals";
import ContactFormModal from "./contacts/ContactFormModal";
import ContactOpportunitiesModal from "./contacts/ContactOpportunitiesModal";
import { useContactsPage } from "./contacts/useContactsPage";

function ContactsPage({ can, currentUser }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
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
    confirmContactDuplicateOverride,
    openDuplicateCandidateContact,
  } = useContactsPage({ currentUser, searchParams, setSearchParams });

  function handleOpportunitySelect(opportunityId) {
    closeContactOppsModal();
    navigate(`/opportunities?edit=${opportunityId}`);
  }

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
        onConfirmDuplicateOverride={confirmContactDuplicateOverride}
        onOpenDuplicateCandidate={openDuplicateCandidateContact}
        onChange={updateContactFormField}
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
              <tr key={contact.id}>
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
                <td className="accounts-actions-cell">
                  <div className="user-kebab-wrap contacts-kebab-wrap">
                    <button
                      type="button"
                      className="kebab-btn"
                      onClick={() => toggleContactMenu(contact.id)}
                      aria-label="Abrir acciones"
                    >
                      ⋮
                    </button>
                    {openContactMenuId === contact.id && (
                      <div className="user-kebab-menu">
                        <button
                          type="button"
                          onClick={() =>
                            runContactAction(() =>
                              openEditContactModal(contact.id),
                            )
                          }
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          disabled={
                            !canChangeContactActivationStatus ||
                            isContactActive(contact)
                          }
                          onClick={() =>
                            openContactStatusConfirmation(contact, "activado")
                          }
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
                            onClick={() =>
                              openContactStatusConfirmation(
                                contact,
                                "pendiente_activacion",
                              )
                            }
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
                          onClick={() =>
                            openContactStatusConfirmation(
                              contact,
                              "desactivado",
                            )
                          }
                        >
                          Desactivar
                        </button>
                        {can("oportunidades.read") && (
                          <button
                            type="button"
                            onClick={() =>
                              runContactAction(() =>
                                openContactOppsModal(contact),
                              )
                            }
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
