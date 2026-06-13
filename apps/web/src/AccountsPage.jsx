import { useNavigate, useSearchParams } from "react-router-dom";
import { ConfirmationModal } from "./AppModals";
import AccountContactsModal from "./accounts/AccountContactsModal";
import AccountQuotationsModal from "./accounts/AccountQuotationsModal";
import AccountProposalsModal from "./accounts/AccountProposalsModal";
import AccountFormModal from "./accounts/AccountFormModal";
import { useAccountInteractions } from "./accounts/useAccountInteractions";
import AccountsListSection from "./accounts/AccountsListSection";
import AccountOpportunitiesModal from "./accounts/AccountOpportunitiesModal";
import { useAccountsCrud } from "./accounts/useAccountsCrud";
import { useAccountRelatedRecords } from "./accounts/useAccountRelatedRecords";

function AccountsPage({ can, currentUser }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const canAccessQuotations = [
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
    accountDuplicateReview,
    catalogs,
    error,
    success,
    accountsPendingEnabled,
    canCreateOrRequestAccounts,
    canActivateAccounts,
    canAssignAnyOwners,
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
    runDuplicateAiReview,
    dismissAccountDuplicateReview,
    confirmAccountDuplicateOverride,
    openDuplicateCandidateAccount,
    useSuggestedCompanyDescription,
    applySuggestedAccountField,
  } = useAccountsCrud({ currentUser, searchParams, setSearchParams });

  const {
    editAccountOpportunities,
    loadingAccountOpportunities,
    oppSectionStatusFilter,
    setOppSectionStatusFilter,
    oppSectionYearFilter,
    setOppSectionYearFilter,
    accountOppsModalAccount,
    accountContactsModalAccount,
    accountQuotationsModalAccount,
    accountProposalsModalAccount,
    editAccountContacts,
    editAccountQuotations,
    editAccountProposals,
    loadingAccountContacts,
    loadingAccountQuotations,
    loadingAccountProposals,
    contactModalStatusFilter,
    quotationModalStatusFilter,
    proposalModalStatusFilter,
    setContactModalStatusFilter,
    setQuotationModalStatusFilter,
    setProposalModalStatusFilter,
    openAccountOppsModal,
    closeAccountOppsModal,
    openAccountContactsModal,
    closeAccountContactsModal,
    openAccountQuotationsModal,
    closeAccountQuotationsModal,
    openAccountProposalsModal,
    closeAccountProposalsModal,
    getOpportunityStatusBadgeClass,
    getContactStatusBadgeClass,
    getQuotationStatusBadgeClass,
    getProposalStatusBadgeClass,
  } = useAccountRelatedRecords();

  const {
    interactionTypes,
    interactionResults,
    accountContactOptions,
    promotionCatalogs,
    accountInteractions,
    visibleAccountInteractions,
    loadingAccountInteractions,
    showInteractionModal,
    editingInteractionId,
    interactionForm,
    setInteractionForm,
    interactionDocuments,
    savingInteraction,
    uploadingInteractionDocuments,
    deletingInteractionDocumentId,
    interactionTypeFilter,
    setInteractionTypeFilter,
    interactionResultFilter,
    setInteractionResultFilter,
    interactionQuery,
    setInteractionQuery,
    showPromotionPanel,
    setShowPromotionPanel,
    promotionForm,
    setPromotionForm,
    promotingInteraction,
    error: accountInteractionError,
    success: accountInteractionSuccess,
    openCreateInteractionModal,
    openEditInteractionModal,
    closeInteractionModal,
    saveInteraction,
    uploadInteractionDocuments,
    deleteInteractionDocument,
    downloadInteractionDocument,
    promoteInteractionToOpportunity,
    toggleInteractionContact,
    togglePromotionDocument,
    formatAmountInput: formatInteractionPromotionAmountInput,
  } = useAccountInteractions({
    editingAccountId,
    isAccountModalOpen: showCreateAccountModal,
  });

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
        accountsPendingEnabled={accountsPendingEnabled}
        canReadOpportunities={can("oportunidades.read")}
        canReadContacts={can("contactos.read")}
        canAccessQuotations={canAccessQuotations}
        canAccessProposals={canAccessProposals}
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
        openAccountQuotationsModal={openAccountQuotationsModal}
        openAccountProposalsModal={openAccountProposalsModal}
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
        canAssignAnyOwners={canAssignAnyOwners}
        onClose={closeAccountModal}
        onSubmit={saveAccount}
        onAnalyzeDraft={analyzeAccountDraft}
        onUseSuggestedCompanyDescription={useSuggestedCompanyDescription}
        onApplySuggestedWebsite={() => applySuggestedAccountField("website")}
        onApplySuggestedEconomicSector={() =>
          applySuggestedAccountField("economicSector")
        }
        onApplySuggestedContactData={(fieldName) =>
          applySuggestedAccountField(fieldName)
        }
        onApplySuggestedRegistration={() =>
          applySuggestedAccountField("registration")
        }
        accountDraftAnalysis={accountDraftAnalysis}
        accountDraftAnalysisError={accountDraftAnalysisError}
        accountDuplicateReview={accountDuplicateReview}
        analyzingAccountDraft={analyzingAccountDraft}
        onDismissDuplicateReview={dismissAccountDuplicateReview}
        onConfirmDuplicateOverride={confirmAccountDuplicateOverride}
        onOpenDuplicateCandidateAccount={openDuplicateCandidateAccount}
        onRetryDuplicateAiReview={() =>
          runDuplicateAiReview(accountDuplicateReview)
        }
        accountInteractions={accountInteractions}
        visibleAccountInteractions={visibleAccountInteractions}
        interactionTypes={interactionTypes}
        interactionResults={interactionResults}
        interactionTypeFilter={interactionTypeFilter}
        setInteractionTypeFilter={setInteractionTypeFilter}
        interactionResultFilter={interactionResultFilter}
        setInteractionResultFilter={setInteractionResultFilter}
        interactionQuery={interactionQuery}
        setInteractionQuery={setInteractionQuery}
        loadingAccountInteractions={loadingAccountInteractions}
        interactionModalOpen={showInteractionModal}
        editingInteractionId={editingInteractionId}
        interactionForm={interactionForm}
        setInteractionForm={setInteractionForm}
        interactionDocuments={interactionDocuments}
        savingInteraction={savingInteraction}
        uploadingInteractionDocuments={uploadingInteractionDocuments}
        deletingInteractionDocumentId={deletingInteractionDocumentId}
        showPromotionPanel={showPromotionPanel}
        setShowPromotionPanel={setShowPromotionPanel}
        promotionForm={promotionForm}
        setPromotionForm={setPromotionForm}
        promotionCatalogs={promotionCatalogs}
        promotingInteraction={promotingInteraction}
        accountInteractionError={accountInteractionError}
        accountInteractionSuccess={accountInteractionSuccess}
        accountContactOptions={accountContactOptions}
        openCreateInteractionModal={openCreateInteractionModal}
        openEditInteractionModal={openEditInteractionModal}
        closeInteractionModal={closeInteractionModal}
        saveInteraction={saveInteraction}
        toggleInteractionContact={toggleInteractionContact}
        uploadInteractionDocuments={uploadInteractionDocuments}
        deleteInteractionDocument={deleteInteractionDocument}
        downloadInteractionDocument={downloadInteractionDocument}
        promoteInteractionToOpportunity={promoteInteractionToOpportunity}
        togglePromotionDocument={togglePromotionDocument}
        formatInteractionPromotionAmountInput={
          formatInteractionPromotionAmountInput
        }
        onOpenLinkedOpportunity={(opportunityId) =>
          navigate(`/opportunities?edit=${opportunityId}`)
        }
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
    </section>
  );
}

export default AccountsPage;
