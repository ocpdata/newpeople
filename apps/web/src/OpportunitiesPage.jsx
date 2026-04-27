import { useSearchParams } from "react-router-dom";
import {
  CommercialCloseConfirmationModal,
  CommercialStatusReasonModal,
  StageBypassConfirmationModal,
} from "./AppModals";
import { formatDateFilterValue, parseDateFilterValue } from "./appFilters";
import OpportunityFormModal from "./opportunities/OpportunityFormModal";
import OpportunitiesListSection from "./opportunities/OpportunitiesListSection";
import { useOpportunitiesPage } from "./opportunities/useOpportunitiesPage";

function OpportunitiesPage({ currentUser }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    opportunityStatusFilter,
    setOpportunityStatusFilter,
    opportunityQuery,
    setOpportunityQuery,
    opportunitiesPerPage,
    setOpportunitiesPerPage,
    opportunitiesPage,
    setOpportunitiesPage,
    showOpportunityModal,
    editingOpportunityId,
    editOpportunityAudit,
    selectedCommercialStageId,
    loadingCommercialStageView,
    showCommercialCloseModal,
    showCommercialStatusReasonModal,
    commercialCloseModalState,
    setCommercialCloseModalState,
    showStageBypassModal,
    stageBypassReason,
    setStageBypassReason,
    openOpportunityMenuId,
    savingOpportunity,
    savingCommercialAction,
    error,
    success,
    canCreateOrRequestOpportunities,
    canChangeOpportunityActivationStatus,
    catalogs,
    form,
    setForm,
    visibleOpportunities,
    pagedOpportunities,
    opportunityStatusCounts,
    totalOpportunitiesCount,
    totalOpportunityPages,
    currentSalesStageName,
    currentCommercialStage,
    hasPendingStageChange,
    hasPendingCommercialClose,
    canRetreatToSelectedStage,
    canBypassCurrentStage,
    hasImmediatePreviousStage,
    isSelectedCommercialStageReadOnly,
    isCommercialFlowClosed,
    currentCommercialStatusName,
    isHeaderCommercialFlowClosed,
    displayedCommercialCloseReason,
    canOpenCommercialStatusReason,
    pendingCommercialCloseStatusName,
    commercialContext,
    contactOptions,
    formatDateTime,
    formatCloseDate,
    formatOpportunityAmountInput,
    getOpportunityStatusLabel,
    getOpportunityCommercialStatusLabel,
    isOpportunityActive,
    isOpportunityPending,
    isOpportunityInactive,
    getOpportunityStatusBadgeClass,
    getOpportunityStatusIconBadgeClass,
    getCommercialStatusBadgeClass,
    getCommercialStatusIconBadgeClass,
    openCreateOpportunityModal,
    openEditOpportunityModal,
    closeOpportunityModal,
    toggleOpportunitySort,
    getOpportunitySortArrow,
    openCommercialStatusReasonModal,
    closeCommercialStatusReasonModal,
    updateCommercialAnswer,
    handleCommercialStageSelect,
    handleCurrentStageValidation,
    handleStageBypass,
    closeStageBypassModal,
    confirmStageBypass,
    handleStageTransition,
    handleCommercialClose,
    closeCommercialCloseModal,
    confirmCommercialCloseDraft,
    saveOpportunity,
    toggleOpportunityMenu,
    runOpportunityAction,
    updateOpportunityStatus,
  } = useOpportunitiesPage({ currentUser, searchParams, setSearchParams });

  return (
    <section className="panel">
      <OpportunitiesListSection
        canCreateOrRequestOpportunities={canCreateOrRequestOpportunities}
        openCreateOpportunityModal={openCreateOpportunityModal}
        opportunityStatusFilter={opportunityStatusFilter}
        setOpportunityStatusFilter={setOpportunityStatusFilter}
        opportunityStatusCounts={opportunityStatusCounts}
        totalOpportunitiesCount={totalOpportunitiesCount}
        opportunityQuery={opportunityQuery}
        setOpportunityQuery={setOpportunityQuery}
        visibleOpportunities={visibleOpportunities}
        pagedOpportunities={pagedOpportunities}
        toggleOpportunitySort={toggleOpportunitySort}
        getOpportunitySortArrow={getOpportunitySortArrow}
        formatCloseDate={formatCloseDate}
        getCommercialStatusBadgeClass={getCommercialStatusBadgeClass}
        getOpportunityCommercialStatusLabel={
          getOpportunityCommercialStatusLabel
        }
        getOpportunityStatusBadgeClass={getOpportunityStatusBadgeClass}
        getOpportunityStatusLabel={getOpportunityStatusLabel}
        openOpportunityMenuId={openOpportunityMenuId}
        toggleOpportunityMenu={toggleOpportunityMenu}
        runOpportunityAction={runOpportunityAction}
        openEditOpportunityModal={openEditOpportunityModal}
        canChangeOpportunityActivationStatus={
          canChangeOpportunityActivationStatus
        }
        isOpportunityActive={isOpportunityActive}
        isOpportunityPending={isOpportunityPending}
        isOpportunityInactive={isOpportunityInactive}
        updateOpportunityStatus={updateOpportunityStatus}
        opportunitiesPage={opportunitiesPage}
        opportunitiesPerPage={opportunitiesPerPage}
        totalOpportunityPages={totalOpportunityPages}
        setOpportunitiesPage={setOpportunitiesPage}
        setOpportunitiesPerPage={setOpportunitiesPerPage}
      />

      <OpportunityFormModal
        isOpen={showOpportunityModal}
        editingOpportunityId={editingOpportunityId}
        editOpportunityAudit={editOpportunityAudit}
        currentCommercialStage={currentCommercialStage}
        currentSalesStageName={currentSalesStageName}
        isHeaderCommercialFlowClosed={isHeaderCommercialFlowClosed}
        getOpportunityStatusIconBadgeClass={getOpportunityStatusIconBadgeClass}
        getCommercialStatusIconBadgeClass={getCommercialStatusIconBadgeClass}
        form={form}
        setForm={setForm}
        parseDateFilterValue={parseDateFilterValue}
        formatDateFilterValue={formatDateFilterValue}
        catalogs={catalogs}
        contactOptions={contactOptions}
        formatOpportunityAmountInput={formatOpportunityAmountInput}
        commercialContext={commercialContext}
        selectedCommercialStageId={selectedCommercialStageId}
        loadingCommercialStageView={loadingCommercialStageView}
        hasPendingStageChange={hasPendingStageChange}
        hasPendingCommercialClose={hasPendingCommercialClose}
        isSelectedCommercialStageReadOnly={isSelectedCommercialStageReadOnly}
        isCommercialFlowClosed={isCommercialFlowClosed}
        canOpenCommercialStatusReason={canOpenCommercialStatusReason}
        displayedCommercialCloseReason={displayedCommercialCloseReason}
        pendingCommercialCloseStatusName={pendingCommercialCloseStatusName}
        openCommercialStatusReasonModal={openCommercialStatusReasonModal}
        handleCommercialStageSelect={handleCommercialStageSelect}
        handleCurrentStageValidation={handleCurrentStageValidation}
        handleStageBypass={handleStageBypass}
        handleStageTransition={handleStageTransition}
        handleCommercialClose={handleCommercialClose}
        canBypassCurrentStage={canBypassCurrentStage}
        canRetreatToSelectedStage={canRetreatToSelectedStage}
        hasImmediatePreviousStage={hasImmediatePreviousStage}
        savingCommercialAction={savingCommercialAction}
        updateCommercialAnswer={updateCommercialAnswer}
        closeOpportunityModal={closeOpportunityModal}
        saveOpportunity={saveOpportunity}
        savingOpportunity={savingOpportunity}
        formatDateTime={formatDateTime}
      />

      <StageBypassConfirmationModal
        isOpen={showStageBypassModal}
        reason={stageBypassReason}
        onReasonChange={setStageBypassReason}
        onCancel={closeStageBypassModal}
        onConfirm={confirmStageBypass}
        isSubmitting={savingCommercialAction === "stage-bypass"}
      />

      <CommercialCloseConfirmationModal
        isOpen={showCommercialCloseModal}
        statusCode={commercialCloseModalState.statusCode}
        reason={commercialCloseModalState.reason}
        onReasonChange={(reason) =>
          setCommercialCloseModalState((prev) => ({ ...prev, reason }))
        }
        onCancel={closeCommercialCloseModal}
        onConfirm={confirmCommercialCloseDraft}
      />

      <CommercialStatusReasonModal
        isOpen={showCommercialStatusReasonModal}
        statusLabel={currentCommercialStatusName}
        reason={displayedCommercialCloseReason}
        onClose={closeCommercialStatusReasonModal}
      />

      {error && <div className="toast toast-error">{error}</div>}
      {success && <div className="toast toast-success">{success}</div>}
    </section>
  );
}

export default OpportunitiesPage;
