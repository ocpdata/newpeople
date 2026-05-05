import { useState } from "react";
import { ConfirmationModal } from "../AppModals";
import AccountDraftAnalysisPanel from "./AccountDraftAnalysisPanel";
import AccountInteractionModal from "./AccountInteractionModal";
import AccountInteractionsSection from "./AccountInteractionsSection";

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
    return "Revision obligatoria antes de crear";
  }
  return "Confirmacion recomendada antes de crear";
}

function getDuplicateDecisionBadgeClass(decision) {
  return decision === "review_required" ? "high" : "medium";
}

function getDuplicateDecisionConfirmText(decision, creatingAccount) {
  if (creatingAccount) {
    return "Creando...";
  }
  return decision === "review_required" ? "Crear aun asi" : "Confirmar y crear";
}

function getDuplicateReviewVerdictLabel(verdict) {
  if (verdict === "likely_duplicate") return "Probable duplicado";
  if (verdict === "likely_distinct") return "Probablemente distinta";
  return "Revision no concluyente";
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
                <h5>Revision IA adicional</h5>
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
                misma organizacion.
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
                      Recomendacion
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
              Si abres una cuenta existente desde aqui, se perdera este intento
              de creacion y tendras que capturarlo de nuevo.
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
                    <dt>Pais</dt>
                    <dd>{warning.country || "-"}</dd>
                  </div>
                  <div>
                    <dt>Registro</dt>
                    <dd>{warning.registrationCode || "Sin registro"}</dd>
                  </div>
                  <div>
                    <dt>Website</dt>
                    <dd>{warning.website || "Sin website"}</dd>
                  </div>
                </dl>
                <div className="account-duplicate-review-loss-note">
                  Si abres esta cuenta existente, se perdera el intento actual
                  de creacion.
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
  const isDraftAnalysisLocked = analyzingAccountDraft;

  if (!isOpen) return null;

  const activationMeta = editingAccountId ? getEditingActivationMeta() : null;

  function handleClose() {
    if (isDraftAnalysisLocked) return;
    setShowCreateConfirmation(false);
    onClose();
  }

  function handleSubmit(event) {
    event.preventDefault();

    if (isDraftAnalysisLocked) {
      return;
    }

    if (editingAccountId) {
      void onSubmit(event);
      return;
    }

    setShowCreateConfirmation(true);
  }

  function handleConfirmCreate() {
    setShowCreateConfirmation(false);
    void onSubmit({ preventDefault() {} });
  }

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div
        className="modal-dialog modal-dialog-account"
        aria-busy={isDraftAnalysisLocked}
        onClick={(event) => event.stopPropagation()}
      >
        <ConfirmationModal
          isOpen={showCreateConfirmation}
          title="Confirmar creación de cuenta"
          message="Se creará la cuenta con la información capturada en el formulario. ¿Deseas continuar?"
          onConfirm={handleConfirmCreate}
          onCancel={() => setShowCreateConfirmation(false)}
          confirmText={creatingAccount ? "Creando..." : "Crear cuenta"}
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
            <h3 className="modal-title">
              {editingAccountId ? "Editar cuenta" : "Crear cuenta"}
            </h3>
            <p className="field-hint opportunity-modal-subtitle">
              {editingAccountId
                ? "Actualiza los datos necesarios y guarda los cambios."
                : "Completa primero los datos principales y despues asigna los propietarios para crear la cuenta."}
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
                title="Estado de activacion"
              >
                <span className="status-dot" aria-hidden="true" />
                {activationMeta.label}
              </span>
            </div>
          )}
        </div>
        <fieldset
          className="interaction-detail-lock-shell"
          disabled={isDraftAnalysisLocked}
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
                    onChange={(event) =>
                      setForm({ ...form, name: event.target.value })
                    }
                    required
                  />
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
                  <label>
                    Sector economico <span className="required-mark">*</span>
                  </label>
                  <select
                    value={form.economicSectorId}
                    onChange={(event) =>
                      setForm({ ...form, economicSectorId: event.target.value })
                    }
                    required
                  >
                    <option value="">Selecciona sector economico</option>
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
              <h4>Ubicacion y contacto</h4>
              <div className="grid-form account-grid-location">
                <div className="field-group">
                  <label>
                    Pais <span className="required-mark">*</span>
                  </label>
                  <select
                    value={form.countryId}
                    onChange={(event) =>
                      setForm({ ...form, countryId: event.target.value })
                    }
                    required
                  >
                    <option value="">Selecciona pais</option>
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
                  <label>Direccion</label>
                  <input
                    placeholder="Direccion"
                    value={form.addressLine}
                    onChange={(event) =>
                      setForm({ ...form, addressLine: event.target.value })
                    }
                  />
                </div>
                <div className="field-group">
                  <label>Codigo postal</label>
                  <input
                    placeholder="Codigo postal"
                    value={form.postalCode}
                    onChange={(event) =>
                      setForm({ ...form, postalCode: event.target.value })
                    }
                  />
                </div>
                <div className="field-group">
                  <label>Telefono</label>
                  <input
                    placeholder="Telefono"
                    value={form.phone}
                    onChange={(event) =>
                      setForm({ ...form, phone: event.target.value })
                    }
                  />
                </div>
                <div className="field-group">
                  <label>Pagina web</label>
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
              <h4>Descripcion de la empresa</h4>
              <div className="field-group">
                <textarea
                  placeholder="Describe que hace la empresa, a que se dedica y cualquier contexto publico o comercial relevante"
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
                    Aun no hay propietarios seleccionados.
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
                <h4>Auditoria de la cuenta</h4>
                <div className="role-audit-grid">
                  <div className="audit-item">
                    <span className="audit-label">Creado por</span>
                    <span className="audit-value">
                      {editAccountAudit?.createdByName || "No registrado"}
                    </span>
                  </div>
                  <div className="audit-item">
                    <span className="audit-label">Fecha de creacion</span>
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
                    <span className="audit-label">Fecha de modificacion</span>
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
                Estamos revisando el borrador con IA y la ventana quedará
                bloqueada hasta que termine o se produzca un error.
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
