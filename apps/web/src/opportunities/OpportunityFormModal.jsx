import { useEffect, useState } from "react";
import DatePicker from "react-datepicker";
import { es } from "date-fns/locale";
import ModalInlineHelp from "../help/ModalInlineHelp";
import ManufacturerRegistrationsPanel from "../manufacturer-registrations/ManufacturerRegistrationsPanel";
import OpportunityDocumentsPanel from "./OpportunityDocumentsPanel";
import OpportunityDevelopmentPanel from "./OpportunityDevelopmentPanel";

function withCurrentCatalogOption(options, currentValue, labelKey = "name") {
  if (!currentValue) return options;

  const normalizedCurrentValue = String(currentValue);
  if (
    options.some(
      (option) =>
        String(option?.id || option?.code || "") === normalizedCurrentValue,
    )
  ) {
    return options;
  }

  return [
    {
      id: normalizedCurrentValue,
      [labelKey]: `Actual (${normalizedCurrentValue})`,
      full_name: `Actual (${normalizedCurrentValue})`,
      name: `Actual (${normalizedCurrentValue})`,
    },
    ...options,
  ];
}

function OpportunityFormModal({
  isOpen,
  error,
  editingOpportunityId,
  editOpportunityAudit,
  currentCommercialStage,
  currentSalesStageName,
  isHeaderCommercialFlowClosed,
  getOpportunityStatusIconBadgeClass,
  getCommercialStatusIconBadgeClass,
  form,
  setForm,
  sellerFieldReadOnly = false,
  normalizeOpportunityNameField,
  parseDateFilterValue,
  formatDateFilterValue,
  catalogs,
  contactOptions,
  formatOpportunityAmountInput,
  commercialContext,
  selectedCommercialStageId,
  stageValidationResult,
  loadingCommercialStageView,
  hasPendingStageChange,
  hasPendingCommercialClose,
  isSelectedCommercialStageReadOnly,
  isCommercialFlowClosed,
  canOpenCommercialStatusReason,
  displayedCommercialCloseReason,
  pendingCommercialCloseStatusName,
  openCommercialStatusReasonModal,
  handleCommercialStageSelect,
  handleCurrentStageValidation,
  handleStageBypass,
  handleStageTransition,
  handleCommercialClose,
  canBypassCurrentStage,
  canRetreatToSelectedStage,
  hasImmediatePreviousStage,
  savingCommercialAction,
  analyzingCommercialSuggestions,
  commercialSuggestionFeedback,
  updateCommercialAnswer,
  analyzeCommercialStageAnswers,
  applyCommercialAnswerSuggestion,
  closeCommercialSuggestionFeedback,
  retryCommercialSuggestionAnalysis,
  refreshOpportunityCommercialView,
  closeStageValidationResult,
  retryCurrentStageValidation,
  closeOpportunityModal,
  saveOpportunity,
  confirmValidatedStageAdvance,
  savingOpportunity,
  documentUploadSession,
  opportunityDocuments,
  documentReview,
  documentReviewOverrides,
  documentReviewApplied,
  loadingDocumentSession,
  loadingOpportunityDocuments,
  uploadingOpportunityDocuments,
  applyingDocumentSuggestions,
  deletingOpportunityDocumentId,
  commercialAnswerSuggestionsByStageId,
  uploadOpportunityDocuments,
  applyOpportunityDocumentSuggestions,
  deleteDraftOpportunityDocument,
  downloadOpportunityDocument,
  setDocumentReviewFieldOverride,
  setDocumentReviewMatchSelection,
  formatDateTime,
  canRequestManufacturerRegistrations,
  canUpdateManufacturerRegistrations,
}) {
  if (!isOpen) return null;

  const isDocumentUploadLocked =
    uploadingOpportunityDocuments || loadingDocumentSession;
  const stageValidationDecision = String(
    stageValidationResult?.validation?.decision || "",
  ).trim();
  const stageValidationAutoAdvanced = Boolean(
    stageValidationResult?.autoAdvanced,
  );
  const stageValidationAdvancedStageName = String(
    stageValidationResult?.advancedSalesStage?.name || "",
  ).trim();
  const stageValidationReasons = Array.isArray(
    stageValidationResult?.validation?.reasons,
  )
    ? stageValidationResult.validation.reasons
        .map((reason) => String(reason || "").trim())
        .filter(Boolean)
    : [];
  const stageValidationSuggestions = Array.isArray(
    stageValidationResult?.validation?.suggestions,
  )
    ? stageValidationResult.validation.suggestions
        .map((suggestion) => String(suggestion || "").trim())
        .filter(Boolean)
    : [];
  const stageValidationTitle = stageValidationAutoAdvanced
    ? stageValidationAdvancedStageName
      ? `La oportunidad avanzo a ${stageValidationAdvancedStageName}`
      : "La oportunidad avanzo de etapa"
    : String(stageValidationResult?.title || "").trim() ||
      (stageValidationDecision === "not_ready_to_advance"
        ? "La etapa no esta lista para avanzar"
        : stageValidationDecision === "advance_with_caution"
          ? "La etapa puede avanzar con reservas"
          : "La etapa esta lista para avanzar");
  const stageValidationTone =
    String(stageValidationResult?.tone || "").trim() ||
    (stageValidationDecision === "not_ready_to_advance"
      ? "danger"
      : stageValidationDecision === "advance_with_caution"
        ? "warning"
        : "success");
  const stageValidationStatusLabel = stageValidationAutoAdvanced
    ? "Avanzada"
    : String(stageValidationResult?.statusLabel || "").trim() ||
      (stageValidationDecision === "not_ready_to_advance"
        ? "No lista"
        : stageValidationDecision === "advance_with_caution"
          ? "Con reservas"
          : "Lista para avanzar");
  const canRetryStageValidation = Boolean(stageValidationResult?.canRetry);
  const isWaitingCurrentStage =
    String(currentCommercialStage?.code || currentCommercialStage?.name || "")
      .trim()
      .toLowerCase() === "waiting";
  const canMarkWonFromValidationResult =
    isWaitingCurrentStage &&
    (stageValidationDecision === "ready_to_advance" ||
      stageValidationDecision === "advance_with_caution") &&
    !savingCommercialAction &&
    !isCommercialFlowClosed &&
    commercialContext?.isSelectedStageCurrent &&
    !hasPendingStageChange &&
    !hasPendingCommercialClose;
  const canAdvanceFromValidationResult =
    (stageValidationDecision === "advance_with_caution" ||
      canMarkWonFromValidationResult) &&
    !savingCommercialAction &&
    !isCommercialFlowClosed &&
    commercialContext?.isSelectedStageCurrent &&
    !hasPendingStageChange &&
    !hasPendingCommercialClose &&
    (canBypassCurrentStage || canMarkWonFromValidationResult);
  const isCommercialSuggestionFeatureEnabled =
    commercialContext?.features?.documentAnswerSuggestionsEnabled !== false;
  const stageAnswerSuggestions =
    commercialAnswerSuggestionsByStageId?.[selectedCommercialStageId] || {};
  const isStageValidationInProgress =
    savingCommercialAction === "validate-current-stage";
  const isCommercialSuggestionsInProgress = analyzingCommercialSuggestions;
  const isStageValidationBlocking =
    isStageValidationInProgress || Boolean(stageValidationResult);
  const isCommercialSuggestionBlocking =
    isCommercialSuggestionsInProgress || Boolean(commercialSuggestionFeedback);
  const isModalLocked =
    isDocumentUploadLocked ||
    savingOpportunity ||
    isCommercialSuggestionsInProgress;

  const progressOverlayTitle = isStageValidationInProgress
    ? "Estamos validando las respuestas"
    : isCommercialSuggestionsInProgress
      ? "Estamos analizando las sugerencias"
      : isDocumentUploadLocked
        ? "Estamos preparando un borrador mas completo"
        : editingOpportunityId
          ? "Estamos guardando los cambios"
          : "Estamos registrando la oportunidad";
  const progressOverlayMessage = isStageValidationInProgress
    ? "La ventana queda bloqueada hasta recibir el resultado de la validacion y que cierres ese mensaje para retomar el control."
    : isCommercialSuggestionsInProgress
      ? "Estamos revisando la evidencia documental para proponer respuestas para la etapa actual. Esto puede tardar hasta 2 minutos antes de ofrecerte reintentar."
      : isDocumentUploadLocked
        ? "Estamos cargando y analizando la evidencia para enriquecer la oportunidad con mejores sugerencias antes de continuar."
        : editingOpportunityId
          ? "Estamos actualizando la oportunidad para dejar registrados los cambios y mantener el seguimiento comercial al dia."
          : "Estamos registrando la oportunidad con su contexto comercial para dejarla lista y continuar con el seguimiento.";
  const accountOptions = withCurrentCatalogOption(
    catalogs.accounts,
    form.accountId,
  );
  const currentContactOptions = withCurrentCatalogOption(
    contactOptions,
    form.contactId,
    "full_name",
  );
  const businessLineOptions = withCurrentCatalogOption(
    catalogs.businessLines,
    form.businessLineId,
  );
  const sellerOptions = withCurrentCatalogOption(
    catalogs.sellerUsers,
    form.sellerUserId,
    "full_name",
  );
  const presalesOptions = withCurrentCatalogOption(
    catalogs.presalesUsers,
    form.presalesUserId,
    "full_name",
  );
  const [isCommercialSectionExpanded, setIsCommercialSectionExpanded] =
    useState(Boolean(editingOpportunityId));

  useEffect(() => {
    setIsCommercialSectionExpanded(Boolean(editingOpportunityId));
  }, [editingOpportunityId, isOpen]);

  function handleClose() {
    if (
      isModalLocked ||
      isStageValidationBlocking ||
      isCommercialSuggestionBlocking
    ) {
      return;
    }
    closeOpportunityModal();
  }

  async function handleAdvanceFromValidationResult() {
    closeStageValidationResult();
    await confirmValidatedStageAdvance();
  }

  return (
    <>
      <div className="modal-overlay">
        <div
          className={`modal-dialog modal-dialog-account opportunity-edit-modal modal-dialog-with-scroll-shell${isModalLocked ? " modal-dialog-busy" : ""}`}
          aria-busy={
            isModalLocked ||
            isStageValidationBlocking ||
            isCommercialSuggestionBlocking
          }
          onClick={(event) => event.stopPropagation()}
        >
          <div className="modal-dialog-scroll-shell">
            <div className="modal-header">
              <div className="opportunity-modal-header-copy">
                <div className="account-modal-title-row">
                  <h3 className="modal-title">
                    {editingOpportunityId
                      ? "Editar oportunidad"
                      : "Crear oportunidad"}
                  </h3>
                  <ModalInlineHelp
                    helpKey={
                      editingOpportunityId
                        ? "opportunity.edit"
                        : "opportunity.create"
                    }
                  />
                </div>
                <p className="field-hint opportunity-modal-subtitle">
                  {editingOpportunityId
                    ? "Actualiza la oportunidad y guarda los cambios."
                    : "Completa la información principal para registrar la oportunidad."}
                </p>
              </div>
              <div className="account-modal-header-actions">
                {editingOpportunityId && editOpportunityAudit ? (
                  <div className="opportunity-modal-header-meta">
                    <span
                      className="record-id-badge"
                      title="ID de la oportunidad"
                    >
                      <span className="record-id-icon" aria-hidden="true">
                        #
                      </span>
                      {editingOpportunityId}
                    </span>
                    {!isHeaderCommercialFlowClosed ? (
                      <span className="record-id-badge" title="Etapa de venta">
                        Etapa:{" "}
                        {currentCommercialStage?.name ||
                          currentSalesStageName ||
                          "-"}
                      </span>
                    ) : null}
                    <span
                      className={getOpportunityStatusIconBadgeClass(
                        editOpportunityAudit.activationStatus,
                      )}
                      title="Estado de activacion"
                    >
                      <span className="status-dot" aria-hidden="true" />
                      {editOpportunityAudit.activationStatus || "Sin estado"}
                    </span>
                    <span
                      className={getCommercialStatusIconBadgeClass(
                        editOpportunityAudit.commercialStatus,
                      )}
                      title="Estado comercial"
                    >
                      <span className="status-dot" aria-hidden="true" />
                      {editOpportunityAudit.commercialStatus ||
                        "Sin estado comercial"}
                    </span>
                  </div>
                ) : null}
                <button
                  type="button"
                  className="opportunity-documents-apply-icon-button account-modal-close-button"
                  onClick={handleClose}
                  aria-label={
                    editingOpportunityId
                      ? "Cerrar modal de edición de oportunidad"
                      : "Cerrar modal de creación de oportunidad"
                  }
                  title="Cerrar"
                  disabled={
                    isModalLocked ||
                    isStageValidationBlocking ||
                    isCommercialSuggestionBlocking
                  }
                >
                  ×
                </button>
              </div>
            </div>

            {error ? (
              <div className="opportunity-modal-error" role="alert">
                {error}
              </div>
            ) : null}

            <fieldset
              className="interaction-detail-lock-shell"
              disabled={isModalLocked || isStageValidationBlocking}
            >
              <form
                className="account-create-form in-modal"
                onSubmit={saveOpportunity}
              >
                <section className="account-form-section opportunity-main-data-section">
                  <h4>Datos principales</h4>
                  <div className="grid-form account-grid-main">
                    <div className="field-group">
                      <label>
                        Nombre de la oportunidad{" "}
                        <span className="required-mark">*</span>
                      </label>
                      <input
                        value={form.name}
                        onChange={(event) =>
                          setForm((prev) => ({
                            ...prev,
                            name: event.target.value,
                          }))
                        }
                        onBlur={(event) =>
                          normalizeOpportunityNameField(event.target.value)
                        }
                        required
                      />
                    </div>
                    <div className="field-group">
                      <label>
                        Importe en dólares{" "}
                        <span className="required-mark">*</span>
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="Ej. 50,000"
                        value={form.amountUsd}
                        onChange={(event) =>
                          setForm((prev) => ({
                            ...prev,
                            amountUsd: formatOpportunityAmountInput(
                              event.target.value,
                            ),
                          }))
                        }
                        onBlur={(event) =>
                          setForm((prev) => ({
                            ...prev,
                            amountUsd: formatOpportunityAmountInput(
                              event.target.value || "0",
                            ),
                          }))
                        }
                      />
                    </div>
                    <div className="field-group">
                      <label>
                        Fecha de cierre <span className="required-mark">*</span>
                      </label>
                      <DatePicker
                        selected={parseDateFilterValue(form.closeDate)}
                        onChange={(date) =>
                          setForm((prev) => ({
                            ...prev,
                            closeDate: formatDateFilterValue(date),
                          }))
                        }
                        placeholderText="Selecciona fecha"
                        dateFormat="dd/MM/yyyy"
                        locale={es}
                        showMonthDropdown
                        showYearDropdown
                        dropdownMode="select"
                        fixedHeight
                        todayButton="Hoy"
                        calendarClassName="audit-datepicker-calendar"
                        popperClassName="audit-datepicker-popper"
                        className="audit-date-input"
                        autoComplete="off"
                        isClearable={false}
                        showPopperArrow={false}
                        required
                      />
                    </div>
                    <div className="field-group">
                      <label>
                        Cuenta <span className="required-mark">*</span>
                      </label>
                      <select
                        value={form.accountId}
                        onChange={(event) =>
                          setForm((prev) => ({
                            ...prev,
                            accountId: event.target.value,
                            contactId: "",
                          }))
                        }
                        required
                      >
                        <option value="">Selecciona cuenta</option>
                        {accountOptions.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field-group">
                      <label>
                        Contacto de la cuenta{" "}
                        <span className="required-mark">*</span>
                      </label>
                      <select
                        value={form.contactId}
                        onChange={(event) =>
                          setForm((prev) => ({
                            ...prev,
                            contactId: event.target.value,
                          }))
                        }
                        required
                      >
                        <option value="">Selecciona contacto</option>
                        {currentContactOptions.map((contact) => (
                          <option key={contact.id} value={contact.id}>
                            {contact.full_name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </section>

                <section className="account-form-section opportunity-sales-management-section">
                  <h4>Gestion comercial</h4>
                  <div className="grid-form account-grid-main">
                    {!editingOpportunityId ? (
                      <div className="field-group">
                        <label>
                          Etapa de venta{" "}
                          <span className="required-mark">*</span>
                        </label>
                        <input
                          aria-label="Etapa de venta"
                          value={currentSalesStageName}
                          readOnly
                        />
                      </div>
                    ) : null}
                    <div className="field-group">
                      <label>
                        Linea de negocio{" "}
                        <span className="required-mark">*</span>
                      </label>
                      <select
                        value={form.businessLineId}
                        onChange={(event) =>
                          setForm((prev) => ({
                            ...prev,
                            businessLineId: event.target.value,
                          }))
                        }
                        required
                      >
                        <option value="">Selecciona linea</option>
                        {businessLineOptions.map((line) => (
                          <option key={line.id} value={line.id}>
                            {line.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field-group">
                      <label>
                        Vendedor <span className="required-mark">*</span>
                      </label>
                      <select
                        value={form.sellerUserId}
                        onChange={(event) =>
                          setForm((prev) => ({
                            ...prev,
                            sellerUserId: event.target.value,
                          }))
                        }
                        disabled={sellerFieldReadOnly}
                        aria-readonly={sellerFieldReadOnly}
                        required
                      >
                        <option value="">Selecciona vendedor</option>
                        {sellerOptions.map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.full_name}
                          </option>
                        ))}
                      </select>
                      {sellerFieldReadOnly ? (
                        <p className="field-hint">
                          Este campo se asigna automaticamente a tu usuario.
                        </p>
                      ) : null}
                    </div>
                    <div className="field-group">
                      <label>Ingeniero preventa</label>
                      <select
                        value={form.presalesUserId}
                        onChange={(event) =>
                          setForm((prev) => ({
                            ...prev,
                            presalesUserId: event.target.value,
                          }))
                        }
                      >
                        <option value="">Sin preventa</option>
                        {presalesOptions.map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.full_name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </section>

                <OpportunityDocumentsPanel
                  editingOpportunityId={editingOpportunityId}
                  documentUploadSession={documentUploadSession}
                  documents={opportunityDocuments}
                  documentReview={documentReview}
                  documentReviewOverrides={documentReviewOverrides}
                  documentReviewApplied={documentReviewApplied}
                  loadingDocumentSession={loadingDocumentSession}
                  loadingOpportunityDocuments={loadingOpportunityDocuments}
                  uploadingOpportunityDocuments={uploadingOpportunityDocuments}
                  applyingDocumentSuggestions={applyingDocumentSuggestions}
                  deletingOpportunityDocumentId={deletingOpportunityDocumentId}
                  onUploadFiles={uploadOpportunityDocuments}
                  onApplySuggestions={applyOpportunityDocumentSuggestions}
                  onApplyFieldSuggestion={(field, successMessage) =>
                    applyOpportunityDocumentSuggestions({
                      selectedFieldKeys: [field],
                      successMessage,
                    })
                  }
                  onApplyMatchSuggestion={(field, successMessage) =>
                    applyOpportunityDocumentSuggestions({
                      selectedMatchKeys: [field],
                      successMessage,
                    })
                  }
                  onDeleteDocument={deleteDraftOpportunityDocument}
                  onDownloadDocument={downloadOpportunityDocument}
                  onChangeFieldOverride={setDocumentReviewFieldOverride}
                  onChangeMatchSelection={setDocumentReviewMatchSelection}
                />

                {editingOpportunityId && commercialContext && (
                  <section className="account-form-section opportunity-commercial-section">
                    <div className="opportunity-commercial-section-header">
                      <div className="opportunity-collapsible-section-copy">
                        <h4>Proceso comercial</h4>
                        <p className="field-hint opportunity-commercial-hint">
                          Haz clic en una etapa para revisar sus preguntas. Solo
                          la etapa actual permite editar respuestas, mover la
                          oportunidad o cerrar el proceso comercial.
                        </p>
                      </div>
                      <div className="opportunity-collapsible-section-actions">
                        <div className="opportunity-commercial-badges">
                          {!isCommercialFlowClosed ? (
                            <span className="record-id-badge">
                              Etapa actual: {currentCommercialStage?.name || "-"}
                            </span>
                          ) : null}
                          <button
                            type="button"
                            className={`${getCommercialStatusIconBadgeClass(
                              commercialContext.commercialStatus?.name,
                            )} commercial-status-badge-button${
                              canOpenCommercialStatusReason ? " is-clickable" : ""
                            }`}
                            onClick={openCommercialStatusReasonModal}
                            disabled={!canOpenCommercialStatusReason}
                            title={
                              canOpenCommercialStatusReason
                                ? "Ver motivo del estado comercial"
                                : "Estado comercial"
                            }
                          >
                            <span className="status-dot" aria-hidden="true" />
                            {commercialContext.commercialStatus?.name ||
                              "Sin estado comercial"}
                          </button>
                        </div>
                        <button
                          type="button"
                          className="opportunity-workspace-collapse-button"
                          onClick={() =>
                            setIsCommercialSectionExpanded((current) => !current)
                          }
                          aria-expanded={isCommercialSectionExpanded}
                          aria-controls="opportunity-commercial-section-body"
                        >
                          <span aria-hidden="true">
                            {isCommercialSectionExpanded ? "▾" : "▸"}
                          </span>
                          {isCommercialSectionExpanded ? "Colapsar" : "Expandir"}
                        </button>
                      </div>
                    </div>

                    <div
                      id="opportunity-commercial-section-body"
                      hidden={!isCommercialSectionExpanded}
                    >
                    <div
                      className="opportunity-stage-stepper"
                      role="tablist"
                      aria-label="Etapas del proceso comercial"
                    >
                      {commercialContext.stages.map((stage) => {
                        const isSelected =
                          String(stage.id) ===
                          String(selectedCommercialStageId);
                        const normalizedStageName = stage.name
                          .normalize("NFD")
                          .replace(/[\u0300-\u036f]/g, "")
                          .toLowerCase();
                        const stepperStageName =
                          normalizedStageName === "contacto inicial"
                            ? "Contacto"
                            : normalizedStageName ===
                                "identificacion de la oportunidad"
                              ? "Identificacion"
                              : stage.name;
                        const className = [
                          "opportunity-stage-step",
                          isSelected ? "is-selected" : "",
                          stage.isCurrent ? "is-current" : "",
                          stage.isPast ? "is-past" : "",
                          stage.isFuture ? "is-future" : "",
                        ]
                          .filter(Boolean)
                          .join(" ");

                        return (
                          <button
                            key={stage.id}
                            type="button"
                            className={className}
                            onClick={() =>
                              handleCommercialStageSelect(stage.id)
                            }
                            aria-label={stage.name}
                            aria-pressed={isSelected}
                            disabled={loadingCommercialStageView && isSelected}
                          >
                            <span className="opportunity-stage-step-line" />
                            <span className="opportunity-stage-step-circle-wrap">
                              <span className="opportunity-stage-step-order">
                                {stage.order}
                              </span>
                            </span>
                            <span className="opportunity-stage-step-content">
                              <strong>{stepperStageName}</strong>
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {loadingCommercialStageView ? (
                      <p className="field-hint opportunity-commercial-hint">
                        Cargando etapa seleccionada...
                      </p>
                    ) : null}

                    {hasPendingStageChange ? (
                      <p className="field-hint opportunity-stage-readonly-banner">
                        Hay un cambio de etapa pendiente hacia{" "}
                        {currentCommercialStage?.name ||
                          "la etapa seleccionada"}
                        . Presiona Guardar cambios para grabarlo o cierra el
                        modal para descartarlo.
                      </p>
                    ) : null}

                    {hasPendingCommercialClose ? (
                      <p className="field-hint opportunity-stage-readonly-banner">
                        Hay un cierre comercial pendiente como{" "}
                        {pendingCommercialCloseStatusName ||
                          "estado seleccionado"}
                        . Presiona Guardar cambios para grabarlo o cierra el
                        modal para descartarlo.
                      </p>
                    ) : null}

                    {isSelectedCommercialStageReadOnly ? (
                      <p className="field-hint opportunity-stage-readonly-banner">
                        Estás revisando la etapa{" "}
                        {commercialContext.salesStage?.name || "seleccionada"}.
                        Esta vista es solo lectura porque la oportunidad sigue
                        en {currentCommercialStage?.name || "la etapa actual"}.
                      </p>
                    ) : null}

                    {displayedCommercialCloseReason ? (
                      <div className="field-group opportunity-stage-question">
                        <label>Motivo de cierre comercial</label>
                        <textarea
                          aria-label="Motivo de cierre comercial"
                          rows={3}
                          value={displayedCommercialCloseReason}
                          disabled
                          readOnly
                        />
                      </div>
                    ) : null}

                    <div className="opportunity-commercial-actions">
                      {[
                        ...(isCommercialSuggestionFeatureEnabled
                          ? [
                              {
                                key: "suggest-document-answers",
                                tone: "primary",
                                icon: analyzingCommercialSuggestions
                                  ? "..."
                                  : "✦",
                                label: "Proponer respuestas desde documentos",
                                shortLabel: "Sugerir",
                                onClick: analyzeCommercialStageAnswers,
                                disabled:
                                  analyzingCommercialSuggestions ||
                                  Boolean(savingCommercialAction) ||
                                  isCommercialFlowClosed ||
                                  !commercialContext.isSelectedStageCurrent ||
                                  hasPendingStageChange ||
                                  hasPendingCommercialClose ||
                                  !opportunityDocuments.length,
                              },
                            ]
                          : []),
                        {
                          key: "validate-current-stage",
                          tone: "success",
                          icon:
                            savingCommercialAction === "validate-current-stage"
                              ? "..."
                              : "✓",
                          label: "Validar etapa actual",
                          shortLabel: "Validar",
                          onClick: handleCurrentStageValidation,
                          disabled:
                            Boolean(savingCommercialAction) ||
                            isCommercialFlowClosed ||
                            !commercialContext.isSelectedStageCurrent ||
                            hasPendingStageChange ||
                            hasPendingCommercialClose,
                        },
                        {
                          key: "stage-bypass",
                          tone: "warning",
                          icon:
                            savingCommercialAction === "stage-bypass"
                              ? "..."
                              : ">>",
                          label: "Bypasear etapa",
                          shortLabel: "Bypasear",
                          onClick: handleStageBypass,
                          disabled:
                            Boolean(savingCommercialAction) ||
                            isCommercialFlowClosed ||
                            !commercialContext.isSelectedStageCurrent ||
                            hasPendingStageChange ||
                            hasPendingCommercialClose ||
                            !canBypassCurrentStage,
                        },
                        {
                          key: "retreat",
                          tone: "neutral",
                          icon:
                            savingCommercialAction === "retreat" ? "..." : "←",
                          label: canRetreatToSelectedStage
                            ? "Regresar a etapa seleccionada"
                            : "Regresar etapa anterior",
                          shortLabel: "Regresar",
                          onClick: () => handleStageTransition("retreat"),
                          disabled:
                            Boolean(savingCommercialAction) ||
                            isCommercialFlowClosed ||
                            hasPendingStageChange ||
                            hasPendingCommercialClose ||
                            (!commercialContext.isSelectedStageCurrent &&
                              !canRetreatToSelectedStage) ||
                            (!canRetreatToSelectedStage &&
                              !hasImmediatePreviousStage),
                        },
                        ...(isWaitingCurrentStage
                          ? [
                              {
                                key: "ganada",
                                tone: "success",
                                icon:
                                  savingCommercialAction === "ganada"
                                    ? "..."
                                    : "★",
                                label: "Marcar ganada",
                                shortLabel: "Ganada",
                                onClick: () => handleCommercialClose("ganada"),
                                disabled:
                                  Boolean(savingCommercialAction) ||
                                  isCommercialFlowClosed ||
                                  !commercialContext.isSelectedStageCurrent ||
                                  hasPendingStageChange ||
                                  hasPendingCommercialClose,
                              },
                            ]
                          : []),
                        {
                          key: "perdida",
                          tone: "danger",
                          icon:
                            savingCommercialAction === "perdida" ? "..." : "✕",
                          label: "Marcar perdida",
                          shortLabel: "Perdida",
                          onClick: () => handleCommercialClose("perdida"),
                          disabled:
                            Boolean(savingCommercialAction) ||
                            isCommercialFlowClosed ||
                            !commercialContext.isSelectedStageCurrent ||
                            hasPendingStageChange,
                        },
                        {
                          key: "anulada",
                          tone: "muted",
                          icon:
                            savingCommercialAction === "anulada" ? "..." : "⊘",
                          label: "Marcar anulada",
                          shortLabel: "Anulada",
                          onClick: () => handleCommercialClose("anulada"),
                          disabled:
                            Boolean(savingCommercialAction) ||
                            isCommercialFlowClosed ||
                            !commercialContext.isSelectedStageCurrent ||
                            hasPendingStageChange,
                        },
                      ].map((action) => (
                        <div
                          key={action.key}
                          className="opportunity-commercial-action-item"
                        >
                          <button
                            type="button"
                            className={`opportunity-commercial-action-icon is-${action.tone}`}
                            onClick={action.onClick}
                            disabled={action.disabled}
                            title={action.label}
                            aria-label={action.label}
                          >
                            <span aria-hidden="true">{action.icon}</span>
                          </button>
                          <span className="opportunity-commercial-action-label">
                            {action.shortLabel}
                          </span>
                        </div>
                      ))}
                    </div>

                    {commercialContext.bypassInfo?.isBypassed ? (
                      <div className="opportunity-stage-bypass-summary">
                        <p className="field-hint opportunity-stage-readonly-banner">
                          Esta etapa fue bypaseada. Solo se muestra el motivo
                          del bypass.
                        </p>
                        <div className="field-group opportunity-stage-question">
                          <label>Motivo del bypass</label>
                          <textarea
                            aria-label="Motivo del bypass aplicado"
                            rows={3}
                            value={
                              commercialContext.bypassInfo.reason ||
                              "Sin motivo registrado"
                            }
                            disabled
                          />
                        </div>
                      </div>
                    ) : commercialContext.answers.length > 0 ? (
                      <div className="opportunity-stage-questions">
                        {commercialContext.answers.map((answer) => {
                          const suggestion =
                            stageAnswerSuggestions[
                              Number(answer.question_id)
                            ] || null;

                          return (
                            <div
                              key={answer.question_id}
                              className="field-group opportunity-stage-question"
                            >
                              <label>
                                {answer.prompt}{" "}
                                {answer.is_required ? (
                                  <span className="required-mark">*</span>
                                ) : null}
                              </label>
                              <textarea
                                aria-label={`${answer.prompt}${
                                  answer.is_required ? " *" : ""
                                }`}
                                rows={3}
                                value={answer.answer_value}
                                onChange={(event) =>
                                  updateCommercialAnswer(
                                    answer.question_id,
                                    event.target.value,
                                  )
                                }
                                disabled={
                                  isCommercialFlowClosed ||
                                  !commercialContext.isSelectedStageCurrent ||
                                  hasPendingStageChange
                                }
                              />

                              {suggestion?.status === "proposed" ? (
                                <div className="opportunity-answer-suggestion-card">
                                  <div className="opportunity-answer-suggestion-copy">
                                    <strong>
                                      {String(answer.answer_value || "").trim()
                                        ? "Reemplazo sugerido"
                                        : "Sugerencia documental"}
                                    </strong>
                                    <p>{suggestion.proposedAnswer}</p>
                                    {suggestion.reason ? (
                                      <span>{suggestion.reason}</span>
                                    ) : null}
                                  </div>
                                  <button
                                    type="button"
                                    className="btn-secondary"
                                    onClick={() =>
                                      applyCommercialAnswerSuggestion(
                                        answer.question_id,
                                      )
                                    }
                                    disabled={
                                      isCommercialFlowClosed ||
                                      !commercialContext.isSelectedStageCurrent ||
                                      hasPendingStageChange
                                    }
                                  >
                                    {String(answer.answer_value || "").trim()
                                      ? "Aplicar reemplazo"
                                      : "Aplicar sugerencia"}
                                  </button>
                                </div>
                              ) : suggestion?.reason ? (
                                <p className="field-hint opportunity-answer-suggestion-hint">
                                  {suggestion.reason}
                                </p>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="field-hint opportunity-commercial-hint">
                        Esta etapa no tiene preguntas activas configuradas.
                      </p>
                    )}
                    </div>

                  </section>
                )}

                {editingOpportunityId ? (
                  <OpportunityDevelopmentPanel
                    editingOpportunityId={editingOpportunityId}
                    form={form}
                    commercialContext={commercialContext}
                    opportunityDocuments={opportunityDocuments}
                    currentCommercialStage={currentCommercialStage}
                    loadingCommercialStageView={loadingCommercialStageView}
                    isCommercialFlowClosed={isCommercialFlowClosed}
                    refreshCommercialContext={refreshOpportunityCommercialView}
                  />
                ) : null}

                {editingOpportunityId ? (
                  <ManufacturerRegistrationsPanel
                    opportunityId={editingOpportunityId}
                    canRequest={canRequestManufacturerRegistrations}
                    canUpdate={canUpdateManufacturerRegistrations}
                    isOpportunityClosed={isCommercialFlowClosed}
                  />
                ) : null}

                {editingOpportunityId && editOpportunityAudit && (
                  <section className="account-form-section modal-audit-strip">
                    <h4>Auditoria</h4>
                    <div className="role-audit-grid">
                      <div className="audit-item">
                        <span className="audit-label">Creado por</span>
                        <span className="audit-value">
                          {editOpportunityAudit.createdByName ||
                            "No registrado"}
                        </span>
                      </div>
                      <div className="audit-item">
                        <span className="audit-label">Fecha de creacion</span>
                        <span className="audit-value">
                          {formatDateTime(editOpportunityAudit.createdAt)}
                        </span>
                      </div>
                      <div className="audit-item">
                        <span className="audit-label">Modificado por</span>
                        <span className="audit-value">
                          {editOpportunityAudit.updatedByName ||
                            "No registrado"}
                        </span>
                      </div>
                      <div className="audit-item">
                        <span className="audit-label">
                          Fecha de modificacion
                        </span>
                        <span className="audit-value">
                          {formatDateTime(editOpportunityAudit.updatedAt)}
                        </span>
                      </div>
                    </div>
                  </section>
                )}

                <div className="modal-buttons" style={{ marginTop: 16 }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleClose}
                    disabled={
                      isDocumentUploadLocked ||
                      isCommercialSuggestionsInProgress
                    }
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={
                      savingOpportunity ||
                      isDocumentUploadLocked ||
                      isCommercialSuggestionsInProgress
                    }
                  >
                    {savingOpportunity
                      ? editingOpportunityId
                        ? "Guardando..."
                        : "Creando..."
                      : editingOpportunityId
                        ? "Guardar cambios"
                        : "Crear oportunidad"}
                  </button>
                </div>
              </form>
            </fieldset>
          </div>

          {isModalLocked ? (
            <div
              className="modal-dialog-blocking-overlay"
              role="status"
              aria-live="polite"
            >
              <div className="modal-dialog-blocking-card">
                <span
                  className="interaction-progress-spinner"
                  aria-hidden="true"
                />
                <strong>{progressOverlayTitle}</strong>
                <span>{progressOverlayMessage}</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {commercialSuggestionFeedback ? (
        <div className="modal-overlay modal-overlay-elevated">
          <div
            className={`modal-dialog modal-dialog-account opportunity-document-preview-modal opportunity-stage-validation-modal is-${commercialSuggestionFeedback.tone}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div className="opportunity-modal-header-copy">
                <h3 className="modal-title">
                  {commercialSuggestionFeedback.title}
                </h3>
                <p className="field-hint opportunity-modal-subtitle">
                  Resultado del analisis de sugerencias documentales.
                </p>
              </div>
              <button
                type="button"
                className="opportunity-documents-apply-icon-button"
                onClick={closeCommercialSuggestionFeedback}
                aria-label="Cerrar resultado de sugerencias"
                title="Cerrar"
              >
                ×
              </button>
            </div>

            <div className="opportunity-document-preview-body">
              <div className="opportunity-document-preview-meta">
                <span className="record-id-badge opportunity-stage-validation-badge">
                  Sugerencias IA
                </span>
                <span
                  className={`record-id-badge opportunity-stage-validation-badge is-${commercialSuggestionFeedback.tone}`}
                >
                  {commercialSuggestionFeedback.tone === "success"
                    ? "Exito"
                    : commercialSuggestionFeedback.tone === "warning"
                      ? "Sin propuestas"
                      : "Error"}
                </span>
              </div>

              <div className="field-group opportunity-stage-question">
                <label>Resultado</label>
                <textarea
                  aria-label="Resultado de sugerencias documentales"
                  rows={5}
                  value={commercialSuggestionFeedback.message}
                  disabled
                  readOnly
                />
              </div>

              <div className="modal-buttons">
                {commercialSuggestionFeedback.canRetry ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={retryCommercialSuggestionAnalysis}
                  >
                    Reintentar
                  </button>
                ) : null}
                <button
                  type="button"
                  className={
                    commercialSuggestionFeedback.canRetry
                      ? "btn-secondary"
                      : "btn-primary"
                  }
                  onClick={closeCommercialSuggestionFeedback}
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {stageValidationResult ? (
        <div className="modal-overlay modal-overlay-elevated">
          <div
            className={`modal-dialog modal-dialog-account opportunity-document-preview-modal opportunity-stage-validation-modal is-${stageValidationTone}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div className="opportunity-modal-header-copy">
                <h3 className="modal-title">{stageValidationTitle}</h3>
                <p className="field-hint opportunity-modal-subtitle">
                  {stageValidationResult.message ||
                    stageValidationResult.feedbackMessage}
                </p>
              </div>
              <button
                type="button"
                className="opportunity-documents-apply-icon-button"
                onClick={closeStageValidationResult}
                aria-label="Cerrar resultado de validacion"
                title="Cerrar"
              >
                ×
              </button>
            </div>

            <div className="opportunity-document-preview-body">
              <div className="opportunity-document-preview-meta">
                <span className="record-id-badge opportunity-stage-validation-badge">
                  Validacion IA
                </span>
                <span
                  className={`record-id-badge opportunity-stage-validation-badge is-${stageValidationTone}`}
                >
                  {stageValidationStatusLabel}
                </span>
              </div>

              <div className="field-group opportunity-stage-question">
                <label>Resumen</label>
                <textarea
                  aria-label="Resumen de validacion"
                  rows={4}
                  value={
                    String(stageValidationResult?.validation?.summary || "") ||
                    stageValidationResult.feedbackMessage ||
                    ""
                  }
                  disabled
                  readOnly
                />
              </div>

              {stageValidationReasons.length ? (
                <div className="field-group opportunity-stage-question">
                  <label>Motivos</label>
                  <textarea
                    aria-label="Motivos de validacion"
                    rows={Math.max(3, stageValidationReasons.length + 1)}
                    value={stageValidationReasons
                      .join("\n• ")
                      .replace(/^/, "• ")}
                    disabled
                    readOnly
                  />
                </div>
              ) : null}

              {stageValidationSuggestions.length ? (
                <div className="field-group opportunity-stage-question">
                  <label>Sugerencias</label>
                  <textarea
                    aria-label="Sugerencias de validacion"
                    rows={Math.max(3, stageValidationSuggestions.length + 1)}
                    value={stageValidationSuggestions
                      .join("\n• ")
                      .replace(/^/, "• ")}
                    disabled
                    readOnly
                  />
                </div>
              ) : null}

              <div className="modal-buttons">
                {canAdvanceFromValidationResult ? (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleAdvanceFromValidationResult}
                    disabled={savingCommercialAction === "advance"}
                  >
                    {savingCommercialAction === "advance"
                      ? "Preparando confirmacion..."
                      : canMarkWonFromValidationResult
                        ? "Declarar ganada"
                        : "Confirmar avance"}
                  </button>
                ) : null}
                {canRetryStageValidation ? (
                  <button
                    type="button"
                    className={
                      canAdvanceFromValidationResult
                        ? "btn-secondary"
                        : "btn-primary"
                    }
                    onClick={retryCurrentStageValidation}
                    disabled={
                      savingCommercialAction === "validate-current-stage"
                    }
                  >
                    Reintentar validacion
                  </button>
                ) : null}
                <button
                  type="button"
                  className={
                    canAdvanceFromValidationResult || canRetryStageValidation
                      ? "btn-secondary"
                      : "btn-primary"
                  }
                  onClick={closeStageValidationResult}
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isStageValidationInProgress ? (
        <div className="modal-overlay modal-overlay-elevated">
          <div className="modal-dialog" aria-live="polite">
            <div className="modal-dialog-blocking-card">
              <span
                className="interaction-progress-spinner"
                aria-hidden="true"
              />
              <strong>Estamos validando con la IA</strong>
              <span>
                Estamos revisando las respuestas de la etapa actual. La ventana
                seguira bloqueada hasta mostrar el resultado.
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default OpportunityFormModal;
