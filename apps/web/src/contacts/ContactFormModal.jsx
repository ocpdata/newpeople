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

function getDuplicateDecisionConfirmText(decision, savingContact) {
  if (savingContact) {
    return "Creando...";
  }
  return decision === "review_required" ? "Crear aun asi" : "Confirmar y crear";
}

function getDuplicateReviewVerdictLabel(verdict) {
  if (verdict === "likely_duplicate") return "Probable duplicado";
  if (verdict === "likely_distinct") return "Probablemente distinto";
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

function buildDraftContactName(form) {
  return `${form.firstName || ""} ${form.lastName || ""}`.trim();
}

function ContactDuplicateReviewModal({
  review,
  draftContactName,
  savingContact,
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
    <div
      className="modal-overlay modal-overlay-elevated"
      onClick={(event) => {
        event.stopPropagation();
        onCancel();
      }}
    >
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
                Intento actual: {draftContactName || "Sin nombre capturado"}
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
                ? `La coincidencia principal es ${primaryCandidate.contactName}.`
                : "Revisa las coincidencias antes de continuar."}
            </p>
          </div>
        </header>

        {review.aiReview ? (
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
          </section>
        ) : null}

        <section className="account-ai-subsection account-duplicate-review-section">
          <div className="account-duplicate-review-section-header">
            <div>
              <h5>Coincidencias detectadas</h5>
              <p>
                Abre el contacto sugerido si necesitas revisar sus datos antes
                de crear uno nuevo.
              </p>
            </div>
            <p className="account-duplicate-review-warning-note">
              Si abres un contacto existente desde aqui, se perdera este intento
              de creacion y tendras que capturarlo de nuevo.
            </p>
          </div>
          <div className="account-ai-card-list account-duplicate-review-card-list">
            {warnings.map((warning) => (
              <article
                key={`${warning.contactId}-${warning.matchReason}`}
                className="account-ai-card account-duplicate-review-candidate-card"
              >
                <div className="account-ai-card-header">
                  <div>
                    <strong>{warning.contactName}</strong>
                    <p className="account-duplicate-review-card-note">
                      {warning.accountName || "Sin cuenta asociada"}
                    </p>
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
                    <dt>E-mail</dt>
                    <dd>{warning.email || "Sin e-mail"}</dd>
                  </div>
                  <div>
                    <dt>Movil</dt>
                    <dd>{warning.mobile || "Sin movil"}</dd>
                  </div>
                  <div>
                    <dt>Cargo</dt>
                    <dd>{warning.positionTitle || "Sin cargo"}</dd>
                  </div>
                </dl>
                <div className="account-duplicate-review-loss-note">
                  Si abres este contacto existente, se perdera el intento actual
                  de creacion.
                </div>
                <div className="account-duplicate-review-inline-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => onOpenCandidate(warning.contactId)}
                  >
                    Abrir contacto
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <div className="modal-buttons account-duplicate-review-actions">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Volver al formulario
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={onConfirm}
            disabled={savingContact}
          >
            {getDuplicateDecisionConfirmText(
              review.duplicateDecision,
              savingContact,
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ContactFormModal({
  isOpen,
  editingContactId,
  currentContact,
  form,
  catalogs,
  managerOptions,
  editContactAudit,
  contactDuplicateReview,
  savingContact,
  onClose,
  onSubmit,
  onDismissDuplicateReview,
  onConfirmDuplicateOverride,
  onOpenDuplicateCandidate,
  onChange,
  onAccountChange,
  getContactStatusIconBadgeClass,
  getContactStatusLabel,
  formatDateTime,
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-dialog modal-dialog-account"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="opportunity-modal-header-copy">
            <h3 className="modal-title">
              {editingContactId ? "Editar contacto" : "Crear contacto"}
            </h3>
            <p className="field-hint opportunity-modal-subtitle">
              {editingContactId
                ? "Actualiza los datos necesarios y guarda los cambios."
                : "Completa la información principal y guarda para crear el contacto."}
            </p>
          </div>
          {editingContactId && currentContact ? (
            <div className="opportunity-modal-header-meta">
              <span className="record-id-badge" title="ID del contacto">
                <span className="record-id-icon" aria-hidden="true">
                  #
                </span>
                {editingContactId}
              </span>
              <span
                className={getContactStatusIconBadgeClass(currentContact)}
                title="Estado de activacion"
              >
                <span className="status-dot" aria-hidden="true" />
                {getContactStatusLabel(currentContact)}
              </span>
            </div>
          ) : null}
        </div>

        <form className="account-create-form in-modal" onSubmit={onSubmit}>
          <section className="account-form-section contact-modal-section contact-main-data-section">
            <h4>Datos principales</h4>
            <div className="grid-form account-grid-main">
              <div className="field-group">
                <label>
                  Nombres <span className="required-mark">*</span>
                </label>
                <input
                  value={form.firstName}
                  onChange={(e) => onChange("firstName", e.target.value)}
                  required
                />
              </div>
              <div className="field-group">
                <label>
                  Apellidos <span className="required-mark">*</span>
                </label>
                <input
                  value={form.lastName}
                  onChange={(e) => onChange("lastName", e.target.value)}
                  required
                />
              </div>
              <div className="field-group">
                <label>
                  Cuenta <span className="required-mark">*</span>
                </label>
                <select
                  value={form.accountId}
                  onChange={(e) => onAccountChange(e.target.value)}
                  required
                >
                  <option value="">Selecciona cuenta</option>
                  {catalogs.accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label>Cargo</label>
                <input
                  value={form.positionTitle}
                  onChange={(e) => onChange("positionTitle", e.target.value)}
                />
              </div>
              <div className="field-group">
                <label>E-mail</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => onChange("email", e.target.value)}
                />
              </div>
              <div className="field-group">
                <label>Móvil</label>
                <input
                  value={form.mobile}
                  onChange={(e) => onChange("mobile", e.target.value)}
                />
              </div>
              <div className="field-group">
                <label>Telefono fijo</label>
                <input
                  value={form.phone}
                  onChange={(e) => onChange("phone", e.target.value)}
                />
              </div>
              <div className="field-group">
                <label>Extension</label>
                <input
                  value={form.phoneExtension}
                  onChange={(e) => onChange("phoneExtension", e.target.value)}
                />
              </div>
              <div className="field-group">
                <label>Departamento</label>
                <input
                  value={form.department}
                  onChange={(e) => onChange("department", e.target.value)}
                />
              </div>
            </div>
          </section>

          <section className="account-form-section contact-modal-section contact-commercial-section">
            <h4>Relacion comercial</h4>
            <div className="grid-form account-grid-main">
              <div className="field-group">
                <label>
                  Participacion de compra{" "}
                  <span className="required-mark">*</span>
                </label>
                <select
                  value={form.purchaseParticipationId}
                  onChange={(e) =>
                    onChange("purchaseParticipationId", e.target.value)
                  }
                  required
                >
                  <option value="">Selecciona participación</option>
                  {catalogs.purchaseParticipations.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label>
                  Relacion con nosotros <span className="required-mark">*</span>
                </label>
                <select
                  value={form.relationshipTypeId}
                  onChange={(e) =>
                    onChange("relationshipTypeId", e.target.value)
                  }
                  required
                >
                  <option value="">Selecciona relación</option>
                  {catalogs.relationshipTypes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label>
                  Situacion en empresa <span className="required-mark">*</span>
                </label>
                <select
                  value={form.employmentStatusId}
                  onChange={(e) =>
                    onChange("employmentStatusId", e.target.value)
                  }
                  required
                >
                  <option value="">Selecciona situación</option>
                  {catalogs.employmentStatuses.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label>Jefe</label>
                <select
                  value={form.managerContactId}
                  onChange={(e) => onChange("managerContactId", e.target.value)}
                >
                  <option value="">Sin jefe</option>
                  {managerOptions.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label>Influye en</label>
                <select
                  value={form.influencesContactId}
                  onChange={(e) =>
                    onChange("influencesContactId", e.target.value)
                  }
                >
                  <option value="">Ninguno</option>
                  {managerOptions.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.full_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section className="account-form-section contact-modal-section contact-location-section">
            <h4>Ubicacion (si difiere de la cuenta)</h4>
            <div className="grid-form account-grid-location">
              <div className="field-group">
                <label>Pais</label>
                <select
                  value={form.countryId}
                  onChange={(e) => onChange("countryId", e.target.value)}
                >
                  <option value="">Usar país de la cuenta</option>
                  {catalogs.countries.map((country) => (
                    <option key={country.id} value={country.id}>
                      {country.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label>Estado</label>
                <input
                  value={form.stateRegion}
                  onChange={(e) => onChange("stateRegion", e.target.value)}
                />
              </div>
              <div className="field-group">
                <label>Ciudad</label>
                <input
                  value={form.city}
                  onChange={(e) => onChange("city", e.target.value)}
                />
              </div>
              <div className="field-group">
                <label>Direccion</label>
                <input
                  value={form.addressLine}
                  onChange={(e) => onChange("addressLine", e.target.value)}
                />
              </div>
              <div className="field-group">
                <label>Codigo postal</label>
                <input
                  value={form.postalCode}
                  onChange={(e) => onChange("postalCode", e.target.value)}
                />
              </div>
            </div>
          </section>

          {editingContactId && editContactAudit ? (
            <section className="account-form-section contact-modal-section modal-audit-strip">
              <h4>Auditoria del contacto</h4>
              <div className="role-audit-grid">
                <div className="audit-item">
                  <span className="audit-label">Creado por</span>
                  <span className="audit-value">
                    {editContactAudit.createdByName || "No registrado"}
                  </span>
                </div>
                <div className="audit-item">
                  <span className="audit-label">Fecha de creacion</span>
                  <span className="audit-value">
                    {formatDateTime(editContactAudit.createdAt)}
                  </span>
                </div>
                <div className="audit-item">
                  <span className="audit-label">Modificado por</span>
                  <span className="audit-value">
                    {editContactAudit.updatedByName || "No registrado"}
                  </span>
                </div>
                <div className="audit-item">
                  <span className="audit-label">Fecha de modificacion</span>
                  <span className="audit-value">
                    {formatDateTime(editContactAudit.updatedAt)}
                  </span>
                </div>
              </div>
            </section>
          ) : null}

          <div className="modal-buttons" style={{ marginTop: 16 }}>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={savingContact}
            >
              {savingContact
                ? editingContactId
                  ? "Guardando..."
                  : "Creando..."
                : editingContactId
                  ? "Guardar cambios"
                  : "Crear contacto"}
            </button>
          </div>
        </form>
      </div>

      {!editingContactId ? (
        <ContactDuplicateReviewModal
          review={contactDuplicateReview}
          draftContactName={buildDraftContactName(form)}
          savingContact={savingContact}
          onCancel={onDismissDuplicateReview}
          onConfirm={onConfirmDuplicateOverride}
          onOpenCandidate={onOpenDuplicateCandidate}
        />
      ) : null}
    </div>
  );
}
