import { forwardRef, useImperativeHandle } from "react";
import QuotationCreateModal from "./QuotationCreateModal";
import QuotationEditModal from "./QuotationEditModal";
import QuotationEditorContent from "./QuotationEditorContent";
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
    isOpen,
    showHeader = true,
    showCreateButton = true,
    showDetails = true,
  },
  ref,
) {
  const {
    canCreateQuotation,
    isOpportunityActive,
    showCreateQuotationForm,
    busyAction,
    openCreateQuotationModal,
    error,
    success,
    createModalProps,
    editModalProps,
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
  });

  useImperativeHandle(
    ref,
    () => ({
      openCreateQuotationModal,
    }),
    [openCreateQuotationModal],
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
          showDetails ? "quotation-layout" : "quotation-layout is-list-only"
        }
      >
        <QuotationsListPanel {...listPanelProps} />

        {showDetails ? (
          <div className="quotation-content">
            <QuotationEditorContent {...editorContentProps} />
          </div>
        ) : null}
      </div>

      <QuotationEditModal {...editModalProps} />

      <QuotationsSectionFeedback
        isOpportunityActive={isOpportunityActive}
        error={editModalProps.isOpen ? "" : error}
        success={editModalProps.isOpen ? "" : success}
      />
    </section>
  );
});

export default QuotationsSection;
