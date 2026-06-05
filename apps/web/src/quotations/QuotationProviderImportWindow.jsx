import QuotationProviderDocumentImportModal from "./QuotationProviderDocumentImportModal";

function QuotationProviderImportWindow({
  isOpen,
  onClose,
  errorMessage,
  successMessage,
  documents,
  providerOptions,
  selectedDocumentId,
  onDocumentChange,
  confirmedProviderId,
  onProviderChange,
  onAnalyze,
  preview,
  effectiveItems,
  workflowStage,
  previewJob,
  loadingPreview,
  creatingMissingItems,
  creatingSuggestedMatchPreviewId,
  suggestedMatchFeedbackByPreviewId,
  applying,
  commercialTermsSelection,
  onToggleCommercialTermSelection,
  commercialClausesSelection,
  onToggleCommercialClauseSelection,
  onSelectSuggestedMatchCandidate,
  onResolveSuggestedMatch,
  missingItemsSelection,
  onToggleMissingItemSelection,
  transferableWarningsSelection,
  onToggleTransferableWarningSelection,
  isWarningTransferable,
  onApply,
  onCreateMissingItems,
  onCreateSuggestedMatchItem,
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-dialog modal-dialog-account quotation-create-modal quotation-edit-modal quotation-provider-import-window"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="quotation-content quotation-edit-modal-content">
          <QuotationProviderDocumentImportModal
            isOpen={isOpen}
            errorMessage={errorMessage}
            successMessage={successMessage}
            documents={documents}
            providerOptions={providerOptions}
            selectedDocumentId={selectedDocumentId}
            onDocumentChange={onDocumentChange}
            confirmedProviderId={confirmedProviderId}
            onProviderChange={onProviderChange}
            onClose={onClose}
            onAnalyze={onAnalyze}
            preview={preview}
            effectiveItems={effectiveItems}
            workflowStage={workflowStage}
            previewJob={previewJob}
            loadingPreview={loadingPreview}
            creatingMissingItems={creatingMissingItems}
            creatingSuggestedMatchPreviewId={creatingSuggestedMatchPreviewId}
            suggestedMatchFeedbackByPreviewId={suggestedMatchFeedbackByPreviewId}
            applying={applying}
            commercialTermsSelection={commercialTermsSelection}
            onToggleCommercialTermSelection={onToggleCommercialTermSelection}
            commercialClausesSelection={commercialClausesSelection}
            onToggleCommercialClauseSelection={
              onToggleCommercialClauseSelection
            }
            onSelectSuggestedMatchCandidate={onSelectSuggestedMatchCandidate}
            onResolveSuggestedMatch={onResolveSuggestedMatch}
            missingItemsSelection={missingItemsSelection}
            onToggleMissingItemSelection={onToggleMissingItemSelection}
            transferableWarningsSelection={transferableWarningsSelection}
            onToggleTransferableWarningSelection={onToggleTransferableWarningSelection}
            isWarningTransferable={isWarningTransferable}
            onApply={onApply}
            onCreateMissingItems={onCreateMissingItems}
            onCreateSuggestedMatchItem={onCreateSuggestedMatchItem}
          />
        </div>
      </div>
    </div>
  );
}

export default QuotationProviderImportWindow;
