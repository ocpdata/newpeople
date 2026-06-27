import { forwardRef, useImperativeHandle } from "react";
import QuotationCreateModal from "./QuotationCreateModal";
import QuotationEditModal from "./QuotationEditModal";
import QuotationEditorContent from "./QuotationEditorContent";
import QuotationProviderImportWindow from "./QuotationProviderImportWindow";
import QuotationsSectionFeedback from "./QuotationsSectionFeedback";
import QuotationsSectionHeader from "./QuotationsSectionHeader";
import QuotationsListPanel from "./QuotationsListPanel";
import { useQuotationsSection } from "./useQuotationsSection";

const QuotationsSection = forwardRef(function QuotationsSection(
  {
    accounts,
    accountId,
    accountName,
    loadingAccounts,
    opportunities,
    opportunityId,
    opportunityName,
    opportunityActivationStatus,
    sellerUserId,
    sellerUserName,
    contactOptions,
    currentUser,
    onOpportunityFocusChange,
    onCreateProposalFromQuotationVersion,
    initialSelectedQuotationId,
    isOpen,
    showHeader = true,
    showCreateButton = true,
    showDetails = true,
  },
  ref,
) {
  const {
    canCreateQuotation,
    effectiveShowDetails,
    isOpportunityActive,
    showCreateQuotationForm,
    busyAction,
    openCreateQuotationModal,
    error,
    success,
    createModalProps,
    editModalProps,
    providerImportWindowProps,
    listPanelProps,
    editorContentProps,
  } = useQuotationsSection({
    accounts,
    accountId,
    accountName,
    loadingAccounts,
    opportunities,
    opportunityId,
    opportunityName,
    opportunityActivationStatus,
    sellerUserId,
    sellerUserName,
    contactOptions,
    currentUser,
    onOpportunityFocusChange,
    isOpen,
    showDetails,
    initialSelectedQuotationId,
  });

  useImperativeHandle(
    ref,
    () => ({
      openCreateQuotationModal,
      openEditQuotationModal: editModalProps.openEditQuotationModal,
      loadVersion: listPanelProps.loadVersion,
      loadQuotationById: listPanelProps.loadQuotationById,
    }),
    [
      openCreateQuotationModal,
      editModalProps.openEditQuotationModal,
      listPanelProps.loadVersion,
      listPanelProps.loadQuotationById,
    ],
  );

  return (
    <section className="account-form-section opportunity-quotations-section">
      <QuotationsSectionHeader
        showHeader={showHeader}
        showCreateButton={showCreateButton}
        canCreateQuotation={canCreateQuotation}
        isOpportunityActive={isOpportunityActive}
        busyAction={busyAction}
        openCreateQuotationModal={openCreateQuotationModal}
      />

      {showCreateQuotationForm ? (
        <QuotationCreateModal {...createModalProps} />
      ) : null}

      <div
        className={
          effectiveShowDetails
            ? "quotation-layout"
            : "quotation-layout is-list-only"
        }
      >
        <QuotationsListPanel
          {...listPanelProps}
          onCreateProposalFromQuotationVersion={
            onCreateProposalFromQuotationVersion
          }
        />

        {effectiveShowDetails ? (
          <div className="quotation-content">
            <QuotationEditorContent {...editorContentProps} />
          </div>
        ) : null}
      </div>

      <QuotationEditModal {...editModalProps} />

      <QuotationProviderImportWindow {...providerImportWindowProps} />

      <QuotationsSectionFeedback
        isOpportunityActive={isOpportunityActive}
        error={editModalProps.isOpen ? "" : error}
        success={editModalProps.isOpen ? "" : success}
      />
    </section>
  );
});

export default QuotationsSection;
