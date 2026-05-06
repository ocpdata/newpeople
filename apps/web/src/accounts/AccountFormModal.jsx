import { useEffect, useRef, useState } from "react";
import { ConfirmationModal } from "../AppModals";
import AccountDraftAnalysisPanel from "./AccountDraftAnalysisPanel";
import AccountInteractionModal from "./AccountInteractionModal";
import AccountInteractionsSection from "./AccountInteractionsSection";

const ACCOUNT_NAME_CONNECTORS = new Set([
  "de",
  "del",
  "la",
  "las",
  "el",
  "los",
  "y",
  "e",
  "and",
  "of",
]);

const ACCOUNT_NAME_SPECIAL_TOKENS = new Map([
  ["accessq", "AccessQ"],
  ["openai", "OpenAI"],
  ["ebay", "eBay"],
  ["ishop", "iShop"],
  ["iphone", "iPhone"],
  ["ipad", "iPad"],
  ["imac", "iMac"],
  ["ios", "iOS"],
  ["youtube", "YouTube"],
  ["linkedin", "LinkedIn"],
  ["whatsapp", "WhatsApp"],
  ["microsoft", "Microsoft"],
]);

const ACCOUNT_NAME_ACRONYMS = new Set([
  "aws",
  "bbva",
  "b2b",
  "crm",
  "dhl",
  "erp",
  "hp",
  "ibm",
  "sap",
  "sas",
  "sia",
  "ti",
  "3m",
]);

function collapseAccountNameWhitespace(value) {
  return String(value || "")
    .replace(/^\s+/g, "")
    .replace(/\s{2,}/g, " ");
}

function normalizeAccountNameKey(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function capitalizeWord(value) {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function normalizeAccountNameToken(token, index) {
  const trimmedToken = String(token || "").trim();
  if (!trimmedToken) return "";

  const simpleKey = normalizeAccountNameKey(trimmedToken).replace(
    /[^a-z0-9]/g,
    "",
  );
  if (ACCOUNT_NAME_SPECIAL_TOKENS.has(simpleKey)) {
    return ACCOUNT_NAME_SPECIAL_TOKENS.get(simpleKey);
  }

  if (ACCOUNT_NAME_ACRONYMS.has(simpleKey)) {
    return trimmedToken.toUpperCase();
  }

  if (ACCOUNT_NAME_CONNECTORS.has(simpleKey)) {
    return index === 0 ? capitalizeWord(trimmedToken) : simpleKey;
  }

  if (/^[A-Za-z][A-Za-z0-9]+$/.test(trimmedToken)) {
    return capitalizeWord(trimmedToken);
  }

  return trimmedToken.replace(/[A-Za-zÀ-ÿ]+/g, (segment) => {
    const segmentKey = normalizeAccountNameKey(segment).replace(
      /[^a-z0-9]/g,
      "",
    );
    if (ACCOUNT_NAME_SPECIAL_TOKENS.has(segmentKey)) {
      return ACCOUNT_NAME_SPECIAL_TOKENS.get(segmentKey);
    }
    if (ACCOUNT_NAME_ACRONYMS.has(segmentKey)) {
      return segment.toUpperCase();
    }
    return capitalizeWord(segment);
  });
}

function buildNormalizedAccountName(value) {
  const sanitized = collapseAccountNameWhitespace(value).trim();
  if (!sanitized) return "";

  return sanitized
    .split(" ")
    .filter(Boolean)
    .map((token, index) => normalizeAccountNameToken(token, index))
    .join(" ");
}

function isPlainUpperOrLowerCase(value) {
  const lettersOnly = String(value || "").replace(/[^A-Za-zÀ-ÿ]/g, "");
  if (!lettersOnly) return false;
  return (
    lettersOnly === lettersOnly.toLowerCase() ||
    lettersOnly === lettersOnly.toUpperCase()
  );
}

function getAccountNameNormalizationState(value) {
  const rawValue = String(value || "");
  const sanitizedValue = collapseAccountNameWhitespace(rawValue);
  const normalizedValue = buildNormalizedAccountName(sanitizedValue);
  const trimmedRawValue = sanitizedValue.trim();
  const hasSpacingAdjustment = sanitizedValue !== rawValue;
  const hasFormatSuggestion =
    Boolean(trimmedRawValue) &&
    normalizedValue &&
    normalizedValue !== trimmedRawValue;
  const shouldAutoApplyOnBlur =
    hasFormatSuggestion && isPlainUpperOrLowerCase(trimmedRawValue);

  return {
    sanitizedValue,
    normalizedValue,
    hasSpacingAdjustment,
    hasFormatSuggestion,
    shouldAutoApplyOnBlur,
    shouldConfirmOnSave: hasFormatSuggestion && !shouldAutoApplyOnBlur,
  };
}

function getDuplicateSeverityLabel(severity) {
  if (severity === "high") return "Alta";
  if (severity === "medium") return "Media";
  return "Baja";
}

function getDuplicateDecisionTitle(decision) {
  if (decision === "review_required") {
    return "Posible duplicado fuerte detectado";
  }
  return "Posible duplicado antes de crear";
}

function getDuplicateDecisionEyebrow(decision) {
  if (decision === "review_required") {
    return "Revisión obligatoria antes de crear";
  }
  return "Confirmación recomendada antes de crear";
}

function getDuplicateDecisionBadgeClass(decision) {
  return decision === "review_required" ? "high" : "medium";
}

function getDuplicateDecisionConfirmText(decision, creatingAccount) {
  if (creatingAccount) {
    return "Creando...";
  }
  return decision === "review_required"
    ? "Crear de todos modos"
    : "Confirmar y crear";
}

function getDuplicateReviewVerdictLabel(verdict) {
  if (verdict === "likely_duplicate") return "Probable duplicado";
  if (verdict === "likely_distinct") return "Probablemente distinta";
  return "Revisión no concluyente";
}

function getDuplicateReviewConfidenceLabel(confidence) {
  if (confidence === "high") return "Alta";
  if (confidence === "medium") return "Media";
  return "Baja";
}

function getDuplicateReviewSourceLabel(source) {
  if (source === "ai") return "Con apoyo de IA";
  return "Con reglas internas";
}

function getDuplicateReviewStatus(review) {
  if (review.aiReviewStatus === "loading") {
    return "Analizando con IA";
  }
  if (review.aiReviewError) {
    return "IA no disponible";
  }
  if (review.aiReview) {
    return getDuplicateReviewVerdictLabel(review.aiReview.verdict);
  }
  return getDuplicateReviewSourceLabel(review.duplicateValidationSource);
}

function AccountDuplicateReviewModal({
  review,
  draftName,
  creatingAccount,
  onCancel,
  onConfirm,
  onOpenCandidate,
}) {
  if (!review) return null;

  const warnings = review.duplicateWarnings || [];
  const primaryCandidate = warnings[0] || null;
  const aiSummary = String(review.aiReview?.summary || "").trim();
  const aiRecommendation = String(review.aiReview?.recommendation || "").trim();
  const aiVerdictClass =
    review.aiReview?.verdict === "likely_duplicate"
      ? "high"
      : review.aiReview?.verdict === "likely_distinct"
        ? "info"
        : "medium";

  return (
    <div className="modal-overlay modal-overlay-elevated">
      <div
        className="modal-dialog modal-dialog-account account-duplicate-review-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="account-duplicate-review-hero">
          <div className="account-duplicate-review-hero-copy">
            <span className="account-duplicate-review-eyebrow">
              {getDuplicateDecisionEyebrow(review.duplicateDecision)}
            </span>
            <h3 className="modal-title">
              {getDuplicateDecisionTitle(review.duplicateDecision)}
            </h3>
            <p className="modal-message">{review.message}</p>
            <div className="account-duplicate-review-hero-tags">
              <span className="account-duplicate-review-tag">
                Intento actual: {draftName || "Sin nombre capturado"}
              </span>
              <span className="account-duplicate-review-tag">
                {warnings.length}{" "}
                {warnings.length === 1 ? "coincidencia" : "coincidencias"}
              </span>
            </div>
          </div>
          <div className="account-duplicate-review-hero-side">
            <span
              className={`account-ai-mini-badge ${getDuplicateDecisionBadgeClass(
                review.duplicateDecision,
              )}`}
            >
              {review.duplicateDecision === "review_required"
                ? "Detener y revisar"
                : "Confirmar antes de seguir"}
            </span>
            <p className="account-duplicate-review-side-note">
              {primaryCandidate
                ? `La coincidencia principal es ${primaryCandidate.accountName}.`
                : "Revisa las coincidencias antes de continuar."}
            </p>
          </div>
        </header>

        {review.aiReviewStatus === "loading" ||
        review.aiReviewError ||
        review.aiReview ? (
          <section className="account-ai-subsection account-duplicate-review-section">
            <div className="account-duplicate-review-section-header">
              <div>
                <h5>Revisión IA adicional</h5>
                <p>
                  {getDuplicateReviewSourceLabel(
                    review.duplicateValidationSource,
                  )}
                </p>
              </div>
            </div>
            {review.aiReviewStatus === "loading" && (
              <div className="account-ai-banner">
                Estamos validando con IA si el borrador parece corresponder a la
                misma organización.
              </div>
            )}
            {review.aiReviewError && (
              <div className="account-ai-banner error">
                {review.aiReviewError}
              </div>
            )}
            {review.aiReview && (
              <article className="account-ai-card account-duplicate-review-feature-card">
                <div className="account-ai-card-header">
                  <div>
                    <strong>
                      {getDuplicateReviewVerdictLabel(review.aiReview.verdict)}
                    </strong>
                    {aiSummary ? (
                      <p className="account-duplicate-review-card-note">
                        {aiSummary}
                      </p>
                    ) : null}
                  </div>
                  <div className="account-ai-card-badges">
                    <span className={`account-ai-mini-badge ${aiVerdictClass}`}>
                      {getDuplicateReviewConfidenceLabel(
                        review.aiReview.confidence,
                      )}
                    </span>
                  </div>
                </div>
                {aiRecommendation && aiRecommendation !== aiSummary ? (
                  <div className="account-duplicate-review-callout">
                    <span className="account-duplicate-review-summary-label">
                      Recomendación
                    </span>
                    <p className="field-hint">{aiRecommendation}</p>
                  </div>
                ) : null}
              </article>
            )}
          </section>
        ) : null}

        <section className="account-ai-subsection account-duplicate-review-section">
          <div className="account-duplicate-review-section-header">
            <div>
              <h5>Coincidencias detectadas</h5>
              <p>
                Abre la cuenta sugerida si necesitas validar propietarios,
                registro o sitio web antes de crear una nueva.
              </p>
            </div>
            <p className="account-duplicate-review-warning-note">
              Si abres una cuenta existente desde aquí, se perderá este intento
              de creación y tendrás que capturarlo de nuevo.
            </p>
          </div>
          <div className="account-ai-card-list account-duplicate-review-card-list">
            {warnings.map((warning) => (
              <article
                key={`${warning.accountId}-${warning.matchReason}`}
                className="account-ai-card account-duplicate-review-candidate-card"
              >
                <div className="account-ai-card-header">
                  <div>
                    <strong>{warning.accountName}</strong>
                  </div>
                  <div className="account-ai-card-badges">
                    <span
                      className={`account-ai-mini-badge ${warning.severity}`}
                    >
                      {getDuplicateSeverityLabel(warning.severity)}
                    </span>
                  </div>
                </div>
                <p>{warning.severityMessage || warning.recommendedAction}</p>
                <dl className="account-ai-meta-grid">
                  <div>
                    <dt>Motivo</dt>
                    <dd>{warning.reasonLabel || warning.matchReason}</dd>
                  </div>
                  <div>
                    <dt>País</dt>
                    <dd>{warning.country || "-"}</dd>
                  </div>
                  <div>
                    <dt>Registro</dt>
                    <dd>{warning.registrationCode || "Sin registro"}</dd>
                  </div>
                  <div>
                    <dt>Website</dt>
                    <dd>{warning.website || "Sin sitio web"}</dd>
                  </div>
                </dl>
                <div className="account-duplicate-review-loss-note">
                  Si abres esta cuenta existente, se perderá el intento actual
                  de creación.
                </div>
                <div className="account-duplicate-review-inline-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => onOpenCandidate(warning.accountId)}
                  >
                    Abrir cuenta
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <div className="modal-buttons account-duplicate-review-actions">
          <button className="btn-secondary" onClick={onCancel}>
            Volver a editar
          </button>
          <button
            className="btn-primary"
            onClick={onConfirm}
            disabled={review.aiReviewStatus === "loading"}
          >
            {getDuplicateDecisionConfirmText(
              review.duplicateDecision,
              creatingAccount,
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function AccountFormModal({
  isOpen,
  editingAccountId,
  creatingAccount,
  form,
  setForm,
  catalogs,
  users,
  editAccountAudit,
  getEditingActivationMeta,
  getOwnerOptionLabel,
  isInactiveOwner,
  toggleOwnerUser,
  onClose,
  onSubmit,
  onAnalyzeDraft,
  onUseSuggestedCompanyDescription,
  onApplySuggestedWebsite,
  onApplySuggestedEconomicSector,
  onApplySuggestedContactData,
  onApplySuggestedRegistration,
  accountDraftAnalysis,
  accountDraftAnalysisError,
  accountDuplicateReview,
  analyzingAccountDraft,
  onDismissDuplicateReview,
  onConfirmDuplicateOverride,
  onOpenDuplicateCandidateAccount,
  accountInteractions,
  visibleAccountInteractions,
  interactionTypes,
  interactionResults,
  interactionTypeFilter,
  setInteractionTypeFilter,
  interactionResultFilter,
  setInteractionResultFilter,
  interactionQuery,
  setInteractionQuery,
  loadingAccountInteractions,
  interactionModalOpen,
  editingInteractionId,
  interactionForm,
  setInteractionForm,
  interactionDocuments,
  savingInteraction,
  uploadingInteractionDocuments,
  deletingInteractionDocumentId,
  showPromotionPanel,
  setShowPromotionPanel,
  promotionForm,
  setPromotionForm,
  promotionCatalogs,
  promotingInteraction,
  accountInteractionError,
  accountInteractionSuccess,
  accountContactOptions,
  openCreateInteractionModal,
  openEditInteractionModal,
  closeInteractionModal,
  saveInteraction,
  toggleInteractionContact,
  uploadInteractionDocuments,
  deleteInteractionDocument,
  downloadInteractionDocument,
  promoteInteractionToOpportunity,
  togglePromotionDocument,
  formatInteractionPromotionAmountInput,
  onOpenLinkedOpportunity,
  formatDateTime,
}) {
  const [showCreateConfirmation, setShowCreateConfirmation] = useState(false);
  const [showNameFormatConfirmation, setShowNameFormatConfirmation] =
    useState(false);
  const [pendingSubmitFormOverride, setPendingSubmitFormOverride] =
    useState(null);
  const [waitingCreateResponse, setWaitingCreateResponse] = useState(false);
  const [showCreateHelp, setShowCreateHelp] = useState(false);
  const createHelpRef = useRef(null);
  const isDraftAnalysisLocked = analyzingAccountDraft;
  const isCreateSubmissionLocked = waitingCreateResponse || creatingAccount;
  const isModalLocked = isDraftAnalysisLocked || isCreateSubmissionLocked;

  function closeCreateHelp() {
    setShowCreateHelp(false);
  }

  useEffect(() => {
    if (editingAccountId || !showCreateHelp) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (!createHelpRef.current?.contains(event.target)) {
        closeCreateHelp();
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        closeCreateHelp();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [editingAccountId, showCreateHelp]);

  useEffect(() => {
    if (!waitingCreateResponse || creatingAccount) {
      return;
    }

    setWaitingCreateResponse(false);
  }, [waitingCreateResponse, creatingAccount]);

  if (!isOpen) return null;

  const activationMeta = editingAccountId ? getEditingActivationMeta() : null;

  function handleClose() {
    if (isModalLocked) return;
    setShowCreateConfirmation(false);
    setShowNameFormatConfirmation(false);
    setPendingSubmitFormOverride(null);
    setWaitingCreateResponse(false);
    closeCreateHelp();
    onClose();
  }

  function updateNameValue(nextValue) {
    setForm({ ...form, name: nextValue });
  }

  function handleNameChange(event) {
    updateNameValue(collapseAccountNameWhitespace(event.target.value));
  }

  function handleNameBlur() {
    const normalizationState = getAccountNameNormalizationState(form.name);
    if (!form.name) return;

    if (normalizationState.hasSpacingAdjustment) {
      updateNameValue(normalizationState.sanitizedValue);
      return;
    }

    if (normalizationState.shouldAutoApplyOnBlur) {
      updateNameValue(normalizationState.normalizedValue);
    }
  }

  function buildNextFormForSubmit() {
    const normalizationState = getAccountNameNormalizationState(form.name);
    const nextName =
      normalizationState.normalizedValue || normalizationState.sanitizedValue;
    return {
      nextForm: {
        ...form,
        name: nextName,
      },
      normalizationState,
    };
  }

  function handleSubmit(event) {
    event.preventDefault();

    if (isDraftAnalysisLocked) {
      return;
    }

    if (editingAccountId) {
      const { nextForm, normalizationState } = buildNextFormForSubmit();
      if (normalizationState.shouldConfirmOnSave) {
        setPendingSubmitFormOverride(nextForm);
        setShowNameFormatConfirmation(true);
        return;
      }

      updateNameValue(nextForm.name);
      void onSubmit(event, { formOverride: nextForm });
      return;
    }

    const { nextForm, normalizationState } = buildNextFormForSubmit();
    if (normalizationState.shouldConfirmOnSave) {
      setPendingSubmitFormOverride(nextForm);
      setShowNameFormatConfirmation(true);
      return;
    }

    updateNameValue(nextForm.name);
    setPendingSubmitFormOverride(nextForm);
    setShowCreateConfirmation(true);
  }

  function handleConfirmNameFormat() {
    const nextForm = pendingSubmitFormOverride;
    setShowNameFormatConfirmation(false);

    if (!nextForm) {
      return;
    }

    updateNameValue(nextForm.name);

    if (editingAccountId) {
      void onSubmit({ preventDefault() {} }, { formOverride: nextForm });
      setPendingSubmitFormOverride(null);
      return;
    }

    setShowCreateConfirmation(true);
  }

  function handleConfirmCreate() {
    const nextForm = pendingSubmitFormOverride || form;
    setShowCreateConfirmation(false);
    setWaitingCreateResponse(true);
    void onSubmit({ preventDefault() {} }, { formOverride: nextForm });
  }

  function handleCancelNameFormat() {
    setShowNameFormatConfirmation(false);
    setPendingSubmitFormOverride(null);
  }

  const nameNormalizationState = getAccountNameNormalizationState(form.name);

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div
        className="modal-dialog modal-dialog-account"
        aria-busy={isModalLocked}
        onClick={(event) => event.stopPropagation()}
      >
        <ConfirmationModal
          isOpen={showCreateConfirmation}
          title="Confirmar creación de cuenta"
          message="Se creará la cuenta con la información capturada en el formulario. ¿Deseas continuar?"
          onConfirm={handleConfirmCreate}
          onCancel={() => {
            if (isCreateSubmissionLocked) return;
            setShowCreateConfirmation(false);
          }}
          confirmText={creatingAccount ? "Creando..." : "Crear cuenta"}
          overlayClassName="modal-overlay-elevated"
        />
        <ConfirmationModal
          isOpen={showNameFormatConfirmation}
          title="Confirmar formato del nombre"
          message={`El nombre se guardará como: ${pendingSubmitFormOverride?.name || form.name}`}
          onConfirm={handleConfirmNameFormat}
          onCancel={handleCancelNameFormat}
          confirmText="Confirmar formato"
          cancelText="Revisar nombre"
          overlayClassName="modal-overlay-elevated"
        />
        <AccountDuplicateReviewModal
          review={accountDuplicateReview}
          draftName={form.name}
          creatingAccount={creatingAccount}
          onCancel={onDismissDuplicateReview}
          onConfirm={onConfirmDuplicateOverride}
          onOpenCandidate={onOpenDuplicateCandidateAccount}
        />
        <div className="modal-header">
          <div className="opportunity-modal-header-copy">
            <div className="account-modal-help-shell" ref={createHelpRef}>
              <div className="account-modal-title-row">
                <h3 className="modal-title">
                  {editingAccountId ? "Editar cuenta" : "Crear cuenta"}
                </h3>
                {!editingAccountId ? (
                  <button
                    type="button"
                    className="accounts-module-help-trigger account-modal-help-trigger"
                    aria-label="Ayuda sobre el modal de crear cuenta"
                    aria-expanded={showCreateHelp}
                    title="Ayuda sobre el modal de crear cuenta"
                    onClick={() => setShowCreateHelp((current) => !current)}
                  >
                    ?
                  </button>
                ) : null}
              </div>
              {!editingAccountId && showCreateHelp ? (
                <div
                  className="account-modal-help-popover"
                  role="dialog"
                  aria-label="Ayuda sobre crear cuenta"
                >
                  <strong>Para qué sirve este modal</strong>
                  <p>
                    Úsalo para registrar una cuenta nueva con sus datos
                    principales, responsables y contexto comercial inicial.
                  </p>
                  <strong>Qué debes capturar primero</strong>
                  <p>
                    Completa el nombre, tipo, sector, país y propietarios para
                    que la cuenta pueda quedar lista para seguimiento.
                  </p>
                </div>
              ) : null}
            </div>
            <p className="field-hint opportunity-modal-subtitle">
              {editingAccountId
                ? "Actualiza los datos necesarios y guarda los cambios."
                : "Completa primero los datos principales y después asigna los propietarios para crear la cuenta."}
            </p>
          </div>
          {editingAccountId && activationMeta && (
            <div className="opportunity-modal-header-meta">
              <span className="record-id-badge" title="ID de la cuenta">
                <span className="record-id-icon" aria-hidden="true">
                  #
                </span>
                {editingAccountId}
              </span>
              <span
                className={activationMeta.badgeClass}
                title="Estado de activación"
              >
                <span className="status-dot" aria-hidden="true" />
                {activationMeta.label}
              </span>
            </div>
          )}
        </div>
        <fieldset
          className="interaction-detail-lock-shell"
          disabled={isModalLocked}
        >
          <form
            className="account-create-form in-modal"
            onSubmit={handleSubmit}
          >
            <section className="account-form-section account-modal-section account-main-data-section">
              <h4>Datos principales</h4>
              <div className="grid-form account-grid-main">
                <div className="field-group">
                  <label>
                    Nombre <span className="required-mark">*</span>
                  </label>
                  <input
                    placeholder="Ej. AccessQ S.A. de C.V."
                    value={form.name}
                    onChange={handleNameChange}
                    onBlur={handleNameBlur}
                    required
                  />
                  <p className="field-hint">
                    Se ajustarán espacios al escribir y se respetarán siglas o
                    marcas conocidas al guardar.
                  </p>
                  {nameNormalizationState.hasFormatSuggestion ? (
                    <p className="field-hint">
                      Formato sugerido: {nameNormalizationState.normalizedValue}
                    </p>
                  ) : null}
                </div>
                <div className="field-group">
                  <label>
                    Tipo de cuenta <span className="required-mark">*</span>
                  </label>
                  <select
                    value={form.accountTypeId}
                    onChange={(event) =>
                      setForm({ ...form, accountTypeId: event.target.value })
                    }
                    required
                  >
                    <option value="">Selecciona tipo de cuenta</option>
                    {catalogs.accountTypes.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-group">
                  <label>Registro</label>
                  <input
                    placeholder="Ej. RFC o identificador interno"
                    value={form.registrationCode}
                    onChange={(event) =>
                      setForm({ ...form, registrationCode: event.target.value })
                    }
                  />
                </div>
                <div className="field-group">
                  <label>
                    Sector económico <span className="required-mark">*</span>
                  </label>
                  <select
                    value={form.economicSectorId}
                    onChange={(event) =>
                      setForm({ ...form, economicSectorId: event.target.value })
                    }
                    required
                  >
                    <option value="">Selecciona sector económico</option>
                    {catalogs.sectors.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </section>

            <section className="account-form-section account-modal-section account-location-section">
              <h4>Ubicación y contacto</h4>
              <div className="grid-form account-grid-location">
                <div className="field-group">
                  <label>
                    País <span className="required-mark">*</span>
                  </label>
                  <select
                    value={form.countryId}
                    onChange={(event) =>
                      setForm({ ...form, countryId: event.target.value })
                    }
                    required
                  >
                    <option value="">Selecciona país</option>
                    {catalogs.countries.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-group">
                  <label>Ciudad</label>
                  <input
                    placeholder="Ciudad"
                    value={form.city}
                    onChange={(event) =>
                      setForm({ ...form, city: event.target.value })
                    }
                  />
                </div>
                <div className="field-group">
                  <label>Estado</label>
                  <input
                    placeholder="Estado"
                    value={form.stateRegion}
                    onChange={(event) =>
                      setForm({ ...form, stateRegion: event.target.value })
                    }
                  />
                </div>
                <div className="field-group">
                  <label>Dirección</label>
                  <input
                    placeholder="Dirección"
                    value={form.addressLine}
                    onChange={(event) =>
                      setForm({ ...form, addressLine: event.target.value })
                    }
                  />
                </div>
                <div className="field-group">
                  <label>Código postal</label>
                  <input
                    placeholder="Código postal"
                    value={form.postalCode}
                    onChange={(event) =>
                      setForm({ ...form, postalCode: event.target.value })
                    }
                  />
                </div>
                <div className="field-group">
                  <label>Teléfono</label>
                  <input
                    placeholder="Teléfono"
                    value={form.phone}
                    onChange={(event) =>
                      setForm({ ...form, phone: event.target.value })
                    }
                  />
                </div>
                <div className="field-group">
                  <label>Página web</label>
                  <input
                    placeholder="https://empresa.com"
                    value={form.website}
                    onChange={(event) =>
                      setForm({ ...form, website: event.target.value })
                    }
                  />
                </div>
              </div>
            </section>

            <section className="account-form-section account-modal-section account-description-section">
              <h4>Descripción de la empresa</h4>
              <div className="field-group">
                <textarea
                  placeholder="Describe qué hace la empresa, a qué se dedica y cualquier contexto público o comercial relevante"
                  value={form.companyDescription}
                  onChange={(event) =>
                    setForm({ ...form, companyDescription: event.target.value })
                  }
                />
              </div>
            </section>

            {!editingAccountId && (
              <AccountDraftAnalysisPanel
                analysis={accountDraftAnalysis}
                error={accountDraftAnalysisError}
                loading={analyzingAccountDraft}
                form={form}
                onAnalyze={onAnalyzeDraft}
                onApplySuggestedCompanyDescription={
                  onUseSuggestedCompanyDescription
                }
                onApplySuggestedWebsite={onApplySuggestedWebsite}
                onApplySuggestedEconomicSector={onApplySuggestedEconomicSector}
                onApplySuggestedContactData={onApplySuggestedContactData}
                onApplySuggestedRegistration={onApplySuggestedRegistration}
                isDisabled={!form.name.trim() || !form.countryId}
              />
            )}

            <section className="account-form-section account-modal-section account-owners-section">
              <h4>
                Propietarios <span className="required-mark">*</span>
              </h4>
              <p className="field-hint">
                Selecciona uno o varios usuarios (obligatorio)
              </p>
              <div className="owners-selected-wrap">
                <p className="field-hint owners-selected-title">
                  Propietarios seleccionados
                </p>
                <div className="owners-picker owners-selected-grid">
                  {users
                    .filter((user) =>
                      form.ownerUserIds.includes(Number(user.id)),
                    )
                    .map((user) => (
                      <button
                        key={`selected-${user.id}`}
                        type="button"
                        className="owner-choice selected"
                        onClick={() => toggleOwnerUser(user.id)}
                        title="Quitar propietario"
                      >
                        <span className="owner-name">
                          {getOwnerOptionLabel(user)}
                        </span>
                        <span className="owner-email">{user.email}</span>
                      </button>
                    ))}
                </div>
                {form.ownerUserIds.length === 0 && (
                  <p className="field-hint owners-empty-hint">
                    Aún no hay propietarios seleccionados.
                  </p>
                )}
              </div>

              <div className="owners-list-wrap">
                <p className="field-hint owners-list-title">
                  Lista de usuarios para seleccionar
                </p>
                <div
                  className="owners-list"
                  role="listbox"
                  aria-multiselectable
                >
                  {users.map((user) => {
                    const isSelected = form.ownerUserIds.includes(
                      Number(user.id),
                    );
                    const inactiveOwner = isInactiveOwner(user);
                    return (
                      <label key={user.id} className="owners-list-item">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={inactiveOwner && !isSelected}
                          onChange={() => toggleOwnerUser(user.id)}
                        />
                        <span className="owners-list-text">
                          <span className="owner-name">
                            {getOwnerOptionLabel(user)}
                          </span>
                          <span className="owner-email">{user.email}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </section>

            {editingAccountId ? (
              <AccountInteractionsSection
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
                onCreateInteraction={openCreateInteractionModal}
                onEditInteraction={openEditInteractionModal}
                onOpenOpportunity={onOpenLinkedOpportunity}
                error={accountInteractionError}
                success={accountInteractionSuccess}
              />
            ) : null}

            {editingAccountId && (
              <section className="account-form-section account-modal-section modal-audit-strip">
                <h4>Auditoría de la cuenta</h4>
                <div className="role-audit-grid">
                  <div className="audit-item">
                    <span className="audit-label">Creado por</span>
                    <span className="audit-value">
                      {editAccountAudit?.createdByName || "No registrado"}
                    </span>
                  </div>
                  <div className="audit-item">
                    <span className="audit-label">Fecha de creación</span>
                    <span className="audit-value">
                      {formatDateTime(editAccountAudit?.createdAt)}
                    </span>
                  </div>
                  <div className="audit-item">
                    <span className="audit-label">Modificado por</span>
                    <span className="audit-value">
                      {editAccountAudit?.updatedByName || "No registrado"}
                    </span>
                  </div>
                  <div className="audit-item">
                    <span className="audit-label">Fecha de modificación</span>
                    <span className="audit-value">
                      {formatDateTime(editAccountAudit?.updatedAt)}
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
                disabled={isDraftAnalysisLocked}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={creatingAccount || isDraftAnalysisLocked}
              >
                {creatingAccount
                  ? editingAccountId
                    ? "Guardando..."
                    : "Creando..."
                  : editingAccountId
                    ? "Guardar cambios"
                    : "Crear cuenta"}
              </button>
            </div>
          </form>
        </fieldset>

        {isDraftAnalysisLocked ? (
          <div
            className="interaction-progress-overlay"
            role="status"
            aria-live="polite"
          >
            <div className="interaction-progress-card">
              <span
                className="interaction-progress-spinner"
                aria-hidden="true"
              />
              <strong>Analizando borrador de cuenta</strong>
              <span>
                La IA está revisando la información capturada. Podrás seguir
                editando la cuenta cuando termine el análisis.
              </span>
            </div>
          </div>
        ) : null}

        <AccountInteractionModal
          isOpen={interactionModalOpen}
          editingInteractionId={editingInteractionId}
          interactionForm={interactionForm}
          setInteractionForm={setInteractionForm}
          interactionTypes={interactionTypes}
          interactionResults={interactionResults}
          accountContactOptions={accountContactOptions}
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
          onClose={closeInteractionModal}
          onSubmit={saveInteraction}
          onToggleContact={toggleInteractionContact}
          onUploadDocuments={uploadInteractionDocuments}
          onDeleteDocument={deleteInteractionDocument}
          onDownloadDocument={downloadInteractionDocument}
          onPromote={promoteInteractionToOpportunity}
          onTogglePromotionDocument={togglePromotionDocument}
          formatAmountInput={formatInteractionPromotionAmountInput}
        />
      </div>
    </div>
  );
}

export default AccountFormModal;
