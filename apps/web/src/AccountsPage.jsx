import { useEffect, useRef } from "react";
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
import {
  buildCoachFormPatch,
  getCoachHandoffEntityId,
  getCoachHandoffOperation,
} from "./coach/handoffForm";
import { useCoachHandoff } from "./coach/useCoachHandoff";
import { CoachHandoffNotice } from "./coach/CoachHandoffNotice";

function AccountsPage({ can, currentUser }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const coachHandoff = useCoachHandoff({ module: "accounts" });
  const appliedCoachHandoffRef = useRef("");
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

  useEffect(() => {
    const operation = getCoachHandoffOperation(coachHandoff.handoff);
    if (!operation || appliedCoachHandoffRef.current === coachHandoff.token) {
      return;
    }
    if (
      operation.kind === "create_account" &&
      (!catalogs.accountTypes.length || !catalogs.statuses.length)
    ) {
      return;
    }

    appliedCoachHandoffRef.current = coachHandoff.token;
    const formPatch = buildCoachFormPatch(coachHandoff.handoff, "accounts");
    if (operation.kind === "create_account") {
      openCreateAccountModal();
      setForm((current) => ({ ...current, ...formPatch }));
      return;
    }
    if (operation.kind === "account_field") {
      const accountId = getCoachHandoffEntityId(
        coachHandoff.handoff,
        "accountId",
      );
      if (accountId) {
        void openEditAccountModal(accountId).then(() => {
          setForm((current) => ({ ...current, ...formPatch }));
        });
      }
    }
  }, [
    coachHandoff.handoff,
    coachHandoff.token,
    catalogs,
    openCreateAccountModal,
    openEditAccountModal,
    setForm,
  ]);

  async function completeAccountHandoff(data) {
    const operation = getCoachHandoffOperation(coachHandoff.handoff);
    if (!operation || !data) return;
    const entityId =
      Number(data.id || 0) ||
      getCoachHandoffEntityId(coachHandoff.handoff, "accountId");
    if (entityId) {
      await coachHandoff.complete({ entityType: "account", entityId });
    }
  }

  async function saveAccountWithCoachHandoff(event, options) {
    const data = await saveAccount(event, options);
    await completeAccountHandoff(data);
    return data;
  }

  async function confirmAccountDuplicateWithCoachHandoff() {
    const data = await confirmAccountDuplicateOverride();
    await completeAccountHandoff(data);
    return data;
  }

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
      <CoachHandoffNotice {...coachHandoff} />
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
        onSubmit={saveAccountWithCoachHandoff}
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
        onConfirmDuplicateOverride={confirmAccountDuplicateWithCoachHandoff}
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
    </section>
  );
}

export default AccountsPage;
