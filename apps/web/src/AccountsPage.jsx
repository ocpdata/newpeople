import { useNavigate } from "react-router-dom";
import { ConfirmationModal } from "./AppModals";
import AccountContactsModal from "./accounts/AccountContactsModal";
import AccountFormModal from "./accounts/AccountFormModal";
import AccountsListSection from "./accounts/AccountsListSection";
import AccountOpportunitiesModal from "./accounts/AccountOpportunitiesModal";
import { useAccountsCrud } from "./accounts/useAccountsCrud";
import { useAccountRelatedRecords } from "./accounts/useAccountRelatedRecords";

function AccountsPage({ can, currentUser }) {
  const navigate = useNavigate();
  const {
    users,
    accountStatusFilter,
    setAccountStatusFilter,
    accountQuery,
    setAccountQuery,
    accountsPerPage,
    setAccountsPerPage,
    accountsPage,
    setAccountsPage,
    showCreateAccountModal,
    editingAccountId,
    editAccountAudit,
    openAccountMenuId,
    confirmAccountStatusAction,
    creatingAccount,
    analyzingAccountDraft,
    accountDraftAnalysis,
    accountDraftAnalysisError,
    catalogs,
    error,
    success,
    canCreateOrRequestAccounts,
    canActivateAccounts,
    form,
    setForm,
    visibleAccounts,
    pagedAccounts,
    totalAccountPages,
    accountStatusCounts,
    totalAccountsCount,
    isInactiveOwner,
    getOwnerOptionLabel,
    formatDateTime,
    saveAccount,
    toggleOwnerUser,
    toggleAccountMenu,
    runAccountAction,
    isAccountActive,
    isAccountPending,
    isAccountInactive,
    getAccountStatusBadgeClass,
    getAccountStatusLabel,
    getEditingActivationMeta,
    openAccountStatusConfirmation,
    closeAccountStatusConfirmation,
    confirmSelectedAccountStatusChange,
    getAccountStatusConfirmationMeta,
    openEditAccountModal,
    openCreateAccountModal,
    closeAccountModal,
    toggleAccountSort,
    getAccountSortArrow,
    analyzeAccountDraft,
    useSuggestedAccountDescription,
    useSuggestedAccountField,
  } = useAccountsCrud({ currentUser });

  const {
    editAccountOpportunities,
    loadingAccountOpportunities,
    oppSectionStatusFilter,
    setOppSectionStatusFilter,
    oppSectionYearFilter,
    setOppSectionYearFilter,
    accountOppsModalAccount,
    accountContactsModalAccount,
    editAccountContacts,
    loadingAccountContacts,
    contactModalStatusFilter,
    setContactModalStatusFilter,
    openAccountOppsModal,
    closeAccountOppsModal,
    openAccountContactsModal,
    closeAccountContactsModal,
    getOpportunityStatusBadgeClass,
    getContactStatusBadgeClass,
  } = useAccountRelatedRecords();

  return (
    <section className="panel">
      <ConfirmationModal
        isOpen={Boolean(confirmAccountStatusAction)}
        title={getAccountStatusConfirmationMeta().title}
        message={getAccountStatusConfirmationMeta().message}
        onConfirm={confirmSelectedAccountStatusChange}
        onCancel={closeAccountStatusConfirmation}
        confirmText={getAccountStatusConfirmationMeta().confirmText}
        isDangerous={getAccountStatusConfirmationMeta().isDangerous}
      />

      <AccountsListSection
        canCreateOrRequestAccounts={canCreateOrRequestAccounts}
        canActivateAccounts={canActivateAccounts}
        canReadOpportunities={can("oportunidades.read")}
        canReadContacts={can("contactos.read")}
        accountStatusFilter={accountStatusFilter}
        setAccountStatusFilter={setAccountStatusFilter}
        accountStatusCounts={accountStatusCounts}
        totalAccountsCount={totalAccountsCount}
        accountQuery={accountQuery}
        setAccountQuery={setAccountQuery}
        openCreateAccountModal={openCreateAccountModal}
        visibleAccounts={visibleAccounts}
        pagedAccounts={pagedAccounts}
        getAccountStatusBadgeClass={getAccountStatusBadgeClass}
        getAccountStatusLabel={getAccountStatusLabel}
        toggleAccountSort={toggleAccountSort}
        getAccountSortArrow={getAccountSortArrow}
        openAccountMenuId={openAccountMenuId}
        toggleAccountMenu={toggleAccountMenu}
        runAccountAction={runAccountAction}
        openEditAccountModal={openEditAccountModal}
        isAccountActive={isAccountActive}
        isAccountPending={isAccountPending}
        isAccountInactive={isAccountInactive}
        openAccountStatusConfirmation={openAccountStatusConfirmation}
        openAccountOppsModal={openAccountOppsModal}
        openAccountContactsModal={openAccountContactsModal}
        accountsPage={accountsPage}
        accountsPerPage={accountsPerPage}
        totalAccountPages={totalAccountPages}
        setAccountsPage={setAccountsPage}
        setAccountsPerPage={setAccountsPerPage}
      />

      <AccountFormModal
        isOpen={showCreateAccountModal}
        editingAccountId={editingAccountId}
        creatingAccount={creatingAccount}
        form={form}
        setForm={setForm}
        catalogs={catalogs}
        users={users}
        editAccountAudit={editAccountAudit}
        getEditingActivationMeta={getEditingActivationMeta}
        getOwnerOptionLabel={getOwnerOptionLabel}
        isInactiveOwner={isInactiveOwner}
        toggleOwnerUser={toggleOwnerUser}
        onClose={closeAccountModal}
        onSubmit={saveAccount}
        onAnalyzeDraft={analyzeAccountDraft}
        onUseAdministrativeDescription={() =>
          useSuggestedAccountDescription("administrative")
        }
        onUseCommercialDescription={() =>
          useSuggestedAccountDescription("commercial")
        }
        onApplySuggestedWebsite={() => useSuggestedAccountField("website")}
        onApplySuggestedEconomicSector={() =>
          useSuggestedAccountField("economicSector")
        }
        onApplySuggestedContactData={() =>
          useSuggestedAccountField("contactData")
        }
        onApplySuggestedRegistration={() =>
          useSuggestedAccountField("registration")
        }
        accountDraftAnalysis={accountDraftAnalysis}
        accountDraftAnalysisError={accountDraftAnalysisError}
        analyzingAccountDraft={analyzingAccountDraft}
        formatDateTime={formatDateTime}
      />

      {error && <div className="toast toast-error">{error}</div>}
      {success && <div className="toast toast-success">{success}</div>}

      <AccountOpportunitiesModal
        account={accountOppsModalAccount}
        loading={loadingAccountOpportunities}
        opportunities={editAccountOpportunities}
        statusFilter={oppSectionStatusFilter}
        setStatusFilter={setOppSectionStatusFilter}
        yearFilter={oppSectionYearFilter}
        setYearFilter={setOppSectionYearFilter}
        onClose={closeAccountOppsModal}
        onOpportunitySelect={(opportunityId) => {
          closeAccountOppsModal();
          navigate(`/opportunities?edit=${opportunityId}`);
        }}
        getOpportunityStatusBadgeClass={getOpportunityStatusBadgeClass}
      />

      <AccountContactsModal
        account={accountContactsModalAccount}
        loading={loadingAccountContacts}
        contacts={editAccountContacts}
        statusFilter={contactModalStatusFilter}
        setStatusFilter={setContactModalStatusFilter}
        onClose={closeAccountContactsModal}
        onContactSelect={(contactId) => {
          closeAccountContactsModal();
          navigate(`/contacts?edit=${contactId}`);
        }}
        getContactStatusBadgeClass={getContactStatusBadgeClass}
      />
    </section>
  );
}

export default AccountsPage;
