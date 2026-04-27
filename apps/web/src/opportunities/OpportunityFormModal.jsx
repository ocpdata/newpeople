import DatePicker from "react-datepicker";
import { es } from "date-fns/locale";

function OpportunityFormModal({
  isOpen,
  editingOpportunityId,
  editOpportunityAudit,
  currentCommercialStage,
  currentSalesStageName,
  isHeaderCommercialFlowClosed,
  getOpportunityStatusIconBadgeClass,
  getCommercialStatusIconBadgeClass,
  form,
  setForm,
  parseDateFilterValue,
  formatDateFilterValue,
  catalogs,
  contactOptions,
  formatOpportunityAmountInput,
  commercialContext,
  selectedCommercialStageId,
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
  updateCommercialAnswer,
  closeOpportunityModal,
  saveOpportunity,
  savingOpportunity,
  formatDateTime,
}) {
  if (!isOpen) return null;

  const isWaitingCurrentStage =
    String(currentCommercialStage?.code || currentCommercialStage?.name || "")
      .trim()
      .toLowerCase() === "waiting";

  return (
    <div className="modal-overlay" onClick={closeOpportunityModal}>
      <div
        className="modal-dialog modal-dialog-account"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div className="opportunity-modal-header-copy">
            <h3 className="modal-title">
              {editingOpportunityId
                ? "Editar oportunidad"
                : "Crear oportunidad"}
            </h3>
            <p className="field-hint opportunity-modal-subtitle">
              {editingOpportunityId
                ? "Actualiza la oportunidad y guarda los cambios."
                : "Completa la información principal para registrar la oportunidad."}
            </p>
          </div>
          {editingOpportunityId && editOpportunityAudit ? (
            <div className="opportunity-modal-header-meta">
              <span className="record-id-badge" title="ID de la oportunidad">
                <span className="record-id-icon" aria-hidden="true">
                  #
                </span>
                {editingOpportunityId}
              </span>
              {!isHeaderCommercialFlowClosed ? (
                <span className="record-id-badge" title="Etapa de venta">
                  Etapa:{" "}
                  {currentCommercialStage?.name || currentSalesStageName || "-"}
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
        </div>

        {!editingOpportunityId && (
          <p className="field-hint">
            El ID de la oportunidad se asigna automaticamente y coincide con el
            ID interno.
          </p>
        )}

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
                    setForm((prev) => ({ ...prev, name: event.target.value }))
                  }
                  required
                />
              </div>
              <div className="field-group">
                <label>
                  Importe en dólares <span className="required-mark">*</span>
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
                  required
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
                  {catalogs.accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label>
                  Contacto de la cuenta <span className="required-mark">*</span>
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
                  {contactOptions.map((contact) => (
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
                    Etapa de venta <span className="required-mark">*</span>
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
                  Linea de negocio <span className="required-mark">*</span>
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
                  {catalogs.businessLines.map((line) => (
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
                  required
                >
                  <option value="">Selecciona vendedor</option>
                  {catalogs.sellerUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.full_name}
                    </option>
                  ))}
                </select>
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
                  {catalogs.presalesUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.full_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {editingOpportunityId && commercialContext && (
            <section className="account-form-section opportunity-commercial-section">
              <div className="opportunity-commercial-section-header">
                <div>
                  <h4>Proceso comercial</h4>
                  <p className="field-hint opportunity-commercial-hint">
                    Haz clic en una etapa para revisar sus preguntas. Solo la
                    etapa actual permite editar respuestas, mover la oportunidad
                    o cerrar el proceso comercial.
                  </p>
                </div>
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
              </div>

              <div
                className="opportunity-stage-stepper"
                role="tablist"
                aria-label="Etapas del proceso comercial"
              >
                {commercialContext.stages.map((stage) => {
                  const isSelected =
                    String(stage.id) === String(selectedCommercialStageId);
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
                      onClick={() => handleCommercialStageSelect(stage.id)}
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
                  {currentCommercialStage?.name || "la etapa seleccionada"}.
                  Presiona Guardar cambios para grabarlo o cierra el modal para
                  descartarlo.
                </p>
              ) : null}

              {hasPendingCommercialClose ? (
                <p className="field-hint opportunity-stage-readonly-banner">
                  Hay un cierre comercial pendiente como{" "}
                  {pendingCommercialCloseStatusName || "estado seleccionado"}.
                  Presiona Guardar cambios para grabarlo o cierra el modal para
                  descartarlo.
                </p>
              ) : null}

              {isSelectedCommercialStageReadOnly ? (
                <p className="field-hint opportunity-stage-readonly-banner">
                  Estás revisando la etapa{" "}
                  {commercialContext.salesStage?.name || "seleccionada"}. Esta
                  vista es solo lectura porque la oportunidad sigue en{" "}
                  {currentCommercialStage?.name || "la etapa actual"}.
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
                      savingCommercialAction === "stage-bypass" ? "..." : ">>",
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
                    key: "advance",
                    tone: "primary",
                    icon: savingCommercialAction === "advance" ? "..." : "→",
                    label: "Avanzar etapa",
                    shortLabel: "Avanzar",
                    onClick: () => handleStageTransition("advance"),
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
                    icon: savingCommercialAction === "retreat" ? "..." : "←",
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
                            savingCommercialAction === "ganada" ? "..." : "★",
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
                    icon: savingCommercialAction === "perdida" ? "..." : "✕",
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
                    icon: savingCommercialAction === "anulada" ? "..." : "⊘",
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
                    Esta etapa fue bypaseada. Solo se muestra el motivo del
                    bypass.
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
                  {commercialContext.answers.map((answer) => (
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
                    </div>
                  ))}
                </div>
              ) : (
                <p className="field-hint opportunity-commercial-hint">
                  Esta etapa no tiene preguntas activas configuradas.
                </p>
              )}
            </section>
          )}

          {editingOpportunityId && editOpportunityAudit && (
            <section className="account-form-section modal-audit-strip">
              <h4>Auditoria</h4>
              <div className="role-audit-grid">
                <div className="audit-item">
                  <span className="audit-label">Creado por</span>
                  <span className="audit-value">
                    {editOpportunityAudit.createdByName || "No registrado"}
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
                    {editOpportunityAudit.updatedByName || "No registrado"}
                  </span>
                </div>
                <div className="audit-item">
                  <span className="audit-label">Fecha de modificacion</span>
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
              onClick={closeOpportunityModal}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={savingOpportunity}
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
      </div>
    </div>
  );
}

export default OpportunityFormModal;
