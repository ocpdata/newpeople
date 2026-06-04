import QuotationStatusIcon from "./QuotationStatusIcon";

const WORKFLOW_STEPS = [
  {
    code: "borrador",
    label: "Borrador",
    uiKey: "draft",
  },
  {
    code: "en_aprobacion",
    label: "En aprobacion",
    uiKey: "pending",
  },
  {
    code: "aprobada",
    label: "Aprobada",
    uiKey: "approved",
  },
  {
    code: "enviada",
    label: "Enviada",
    uiKey: "sent",
  },
  {
    code: "ganada",
    label: "Ganada",
    uiKey: "won",
  },
  {
    code: "aceptada",
    label: "Aceptada",
    uiKey: "accepted",
  },
];

const ALTERNATE_STATUS_LABELS = {
  rechazada: "Rechazada",
  perdida: "Perdida",
  anulada: "Anulada",
};

const ACTION_PRIORITY = {
  solicitar_aprobacion: 10,
  aprobar: 10,
  enviar: 10,
  declarar_ganada: 10,
  aceptar: 10,
  crear_version: 30,
  rechazar: 40,
  ponerla_borrador: 50,
  declarar_perdida: 70,
  declarar_anulada: 80,
};

const RECOMMENDED_ACTION_BY_STATUS = {
  borrador: "solicitar_aprobacion",
  rechazada: "solicitar_aprobacion",
  aprobada: "enviar",
  enviada: "declarar_ganada",
  ganada: "aceptar",
};

const ACTION_LABELS = {
  declarar_ganada: "Marcar ganada",
  declarar_perdida: "Marcar perdida",
  declarar_anulada: "Marcar anulada",
  ponerla_borrador: "Volver a borrador",
};

const QUICK_ACTION_LIMIT = 3;

function sortActions(actions) {
  return [...actions].sort((leftAction, rightAction) => {
    const leftPriority = ACTION_PRIORITY[leftAction.code] ?? 999;
    const rightPriority = ACTION_PRIORITY[rightAction.code] ?? 999;

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    return leftAction.name.localeCompare(rightAction.name, "es");
  });
}

function getActionLabel(action) {
  return ACTION_LABELS[action.code] || action.name;
}

function renderActionButtons({
  action,
  busyAction,
  handleAction,
  className,
  approvalCapabilities = null,
}) {
  const isActionBusy =
    busyAction === `action-${action.code}` ||
    busyAction.startsWith(`action-${action.code}-`);

  if (action.code !== "aprobar") {
    if (
      action.code === "solicitar_aprobacion" &&
      approvalCapabilities?.canApprove
    ) {
      return [];
    }

    return [
      <button
        key={action.code}
        type="button"
        className={className}
        disabled={isActionBusy}
        onClick={() => handleAction(action.code)}
      >
        {isActionBusy ? "Ejecutando..." : getActionLabel(action)}
      </button>,
    ];
  }

  const isApprovingWithAi = busyAction === "action-aprobar-with_ai";
  const isApprovingWithoutAi = busyAction === "action-aprobar-without_ai";
  const canApproveWithAi = Boolean(approvalCapabilities?.canApproveWithAi);
  const canApproveWithoutAi =
    approvalCapabilities == null
      ? true
      : Boolean(approvalCapabilities?.canApproveWithoutAi);

  const buttons = [];

  if (canApproveWithAi) {
    buttons.push(
      <button
        key={`${action.code}-with-ai`}
        type="button"
        className={className}
        disabled={isActionBusy}
        onClick={() =>
          handleAction(action.code, {
            approvalMode: "with_ai",
          })
        }
      >
        {isApprovingWithAi ? "Aprobando con IA..." : "Aprobar con IA"}
      </button>,
    );
  }

  if (canApproveWithoutAi) {
    buttons.push(
      <button
        key={`${action.code}-without-ai`}
        type="button"
        className={className}
        disabled={isActionBusy}
        onClick={() =>
          handleAction(action.code, {
            approvalMode: "without_ai",
          })
        }
      >
        {isApprovingWithoutAi ? "Aprobando sin IA..." : "Aprobar sin IA"}
      </button>,
    );
  }

  return buttons;
}

function getBusyActionMessage(busyAction) {
  if (!busyAction || !busyAction.startsWith("action-")) {
    return "";
  }

  if (busyAction === "action-aprobar-with_ai") {
    return "Procesando aprobacion con IA...";
  }
  if (busyAction === "action-aprobar-without_ai") {
    return "Procesando aprobacion sin IA...";
  }
  if (busyAction.startsWith("action-aprobar")) {
    return "Procesando aprobacion...";
  }

  return "Procesando accion...";
}

function getRecommendedAction(actions, statusCode) {
  const desiredActionCode = RECOMMENDED_ACTION_BY_STATUS[statusCode] || null;
  if (desiredActionCode) {
    const exactMatch = actions.find(
      (action) => action.code === desiredActionCode,
    );
    if (exactMatch) {
      return exactMatch;
    }
  }

  return (
    sortActions(actions).find(
      (action) =>
        !["declarar_perdida", "declarar_anulada"].includes(action.code),
    ) || null
  );
}

function classifyActions(actions, statusCode) {
  const visibleActions = (actions || []).filter(
    (action) => !["ver", "modificar", "crear_cotizacion"].includes(action.code),
  );
  const recommendedAction = getRecommendedAction(visibleActions, statusCode);
  const groupedActions = visibleActions.reduce(
    (accumulator, action) => {
      if (recommendedAction && action.code === recommendedAction.code) {
        accumulator.primaryAction = action;
        return accumulator;
      }

      if (["declarar_perdida", "declarar_anulada"].includes(action.code)) {
        accumulator.riskActions.push(action);
        return accumulator;
      }

      accumulator.secondaryActions.push(action);
      return accumulator;
    },
    {
      primaryAction: null,
      secondaryActions: [],
      riskActions: [],
    },
  );
  const sortedSecondaryActions = sortActions(groupedActions.secondaryActions);

  return {
    primaryAction: groupedActions.primaryAction,
    quickActions: sortedSecondaryActions.slice(0, QUICK_ACTION_LIMIT),
    overflowActions: sortedSecondaryActions.slice(QUICK_ACTION_LIMIT),
    riskActions: sortActions(groupedActions.riskActions),
  };
}

function getNextStepMessage({ selectedVersion, primaryAction, quickActions }) {
  if (!selectedVersion?.isLatestVersion) {
    return "Version historica: el flujo se gestiona sobre la version mayor actual.";
  }

  if (primaryAction) {
    return `Siguiente paso: ${getActionLabel(primaryAction)}.`;
  }

  if (quickActions.length) {
    return `Accion mas cercana disponible: ${getActionLabel(quickActions[0])}.`;
  }

  return "No hay transiciones de workflow disponibles para esta version en este momento.";
}

function QuotationWorkflowPanel({
  selectedVersion,
  allowedActions,
  busyAction,
  handleAction,
  error,
  success,
  recommendations,
  onDismissRecommendations,
}) {
  const statusCode = selectedVersion?.statusCode || "";
  const statusUiKey = selectedVersion?.statusUiKey || statusCode;
  const { primaryAction, quickActions, overflowActions, riskActions } =
    classifyActions(allowedActions, statusCode);
  const showWorkflowActions = Boolean(selectedVersion?.isLatestVersion);
  const nextStepMessage = getNextStepMessage({
    selectedVersion,
    primaryAction,
    quickActions,
  });
  const currentStepIndex = WORKFLOW_STEPS.findIndex(
    (step) => step.code === statusCode,
  );
  const alternateStatusLabel = ALTERNATE_STATUS_LABELS[statusCode] || "";
  const busyActionMessage = getBusyActionMessage(busyAction);
  const workflowRecommendations = Array.isArray(recommendations)
    ? recommendations
    : [];
  const approvalCapabilities = selectedVersion?.approvalCapabilities || null;
  const primaryActionButtons =
    showWorkflowActions && primaryAction
      ? renderActionButtons({
          action: primaryAction,
          busyAction,
          handleAction,
          className: "btn-primary quotation-workflow-primary-action",
          approvalCapabilities,
        })
      : [];
  const quickActionButtons = showWorkflowActions
    ? quickActions.flatMap((action) =>
        renderActionButtons({
          action,
          busyAction,
          handleAction,
          className: "quotation-workflow-action-chip",
          approvalCapabilities,
        }),
      )
    : [];
  const overflowActionButtons = showWorkflowActions
    ? overflowActions.flatMap((action) =>
        renderActionButtons({
          action,
          busyAction,
          handleAction,
          className: "quotation-workflow-action-chip",
          approvalCapabilities,
        }),
      )
    : [];
  const riskActionButtons = showWorkflowActions
    ? riskActions.flatMap((action) =>
        renderActionButtons({
          action,
          busyAction,
          handleAction,
          className: "quotation-workflow-action-chip is-risk",
          approvalCapabilities,
        }),
      )
    : [];
  const hasOverflowActions =
    overflowActionButtons.length > 0 || riskActionButtons.length > 0;
  const overflowActionCount =
    overflowActionButtons.length + riskActionButtons.length;

  return (
    <section className="quotation-create-step quotation-workflow-panel">
      <div className="quotation-create-step-header quotation-workflow-panel-header">
        <div>
          <h4>Estado y flujo</h4>
          <p className="field-hint quotation-create-step-hint">
            Resume el estado actual y prioriza las siguientes acciones.
          </p>
        </div>
      </div>

      <div className="quotation-workflow-summary-card">
        <div className="quotation-workflow-main">
          <div className="quotation-workflow-status-strip">
            <div className="quotation-workflow-current-state">
              <span className="quotation-workflow-eyebrow">Estado actual</span>
              <strong className="quotation-workflow-current-state-value">
                <span className="quotation-workflow-status-icon is-current">
                  <QuotationStatusIcon status={statusUiKey} />
                </span>
                <span>{selectedVersion?.statusName || "Sin estado"}</span>
              </strong>
            </div>
            <p className="field-hint quotation-workflow-next-step">
              {nextStepMessage}
            </p>
          </div>

          {!selectedVersion?.isLatestVersion ? (
            <p className="field-hint quotation-workflow-history-note">
              Puedes corregir contenido si tu rol lo permite, pero las
              transiciones solo aplican sobre la version mayor.
            </p>
          ) : null}

          <div
            className="quotation-workflow-stepper"
            aria-label="Flujo de cotizacion"
          >
            {WORKFLOW_STEPS.map((step, index) => {
              const isActive = step.code === statusCode;
              const isCompleted =
                currentStepIndex >= 0 && index < currentStepIndex;

              return (
                <div
                  key={step.code}
                  className={[
                    "quotation-workflow-step",
                    isActive ? "is-active" : "",
                    isCompleted ? "is-complete" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <span className="quotation-workflow-step-dot">
                    <span className="quotation-workflow-status-icon">
                      <QuotationStatusIcon status={step.uiKey || step.code} />
                    </span>
                  </span>
                  <span className="quotation-workflow-step-label">
                    {step.label}
                  </span>
                </div>
              );
            })}
            {alternateStatusLabel ? (
              <div className="quotation-workflow-alternate-state">
                <span className="quotation-workflow-status-icon is-alternate">
                  <QuotationStatusIcon status={statusUiKey} />
                </span>
                <span>
                  Estado alterno: <strong>{alternateStatusLabel}</strong>
                </span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="quotation-workflow-actions-panel">
          {busyActionMessage || error || success ? (
            <div className="quotation-modal-feedback quotation-modal-feedback-inline">
              {busyActionMessage ? (
                <div className="toast toast-success">{busyActionMessage}</div>
              ) : null}
              {error ? <div className="toast toast-error">{error}</div> : null}
              {success ? <div className="toast toast-success">{success}</div> : null}
            </div>
          ) : null}

          {workflowRecommendations.length ? (
            <div className="quotation-workflow-recommendations" role="status" aria-live="polite">
              <div className="quotation-workflow-recommendations-header">
                <span className="quotation-workflow-eyebrow">
                  Recomendaciones de aprobacion
                </span>
                <button
                  type="button"
                  className="quotation-workflow-recommendations-close"
                  onClick={() => onDismissRecommendations?.()}
                  aria-label="Cerrar recomendaciones de aprobacion"
                  title="Cerrar"
                >
                  x
                </button>
              </div>
              <ul>
                {workflowRecommendations.map((recommendation) => (
                  <li key={recommendation}>{recommendation}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="quotation-workflow-actions-block">
            <span className="quotation-workflow-eyebrow">Accion principal</span>
            {primaryActionButtons.length ? (
              <div className="quotation-workflow-quick-actions">
                {primaryActionButtons}
              </div>
            ) : (
              <p className="field-hint quotation-workflow-no-actions">
                No hay una accion principal disponible para esta version.
              </p>
            )}
          </div>

          {quickActionButtons.length ? (
            <div className="quotation-workflow-actions-block">
              <span className="quotation-workflow-eyebrow">
                Acciones rapidas
              </span>
              <div className="quotation-workflow-quick-actions">
                {quickActionButtons}
              </div>
            </div>
          ) : null}

          {showWorkflowActions && hasOverflowActions ? (
            <details className="quotation-workflow-risk-actions">
              <summary>
                Mas opciones
                {overflowActionCount ? (
                  <span className="quotation-workflow-overflow-count">
                    {overflowActionCount}
                  </span>
                ) : null}
              </summary>
              <div className="quotation-workflow-risk-actions-body">
                {overflowActionButtons.length ? (
                  <div className="quotation-workflow-overflow-group">
                    <span className="quotation-workflow-eyebrow">
                      Otras acciones
                    </span>
                    <div className="quotation-workflow-overflow-actions">
                      {overflowActionButtons}
                    </div>
                  </div>
                ) : null}

                {riskActionButtons.length ? (
                  <div className="quotation-workflow-overflow-group">
                    <span className="quotation-workflow-eyebrow">
                      Acciones de cierre
                    </span>
                    <div className="quotation-workflow-overflow-actions">
                      {riskActionButtons}
                    </div>
                  </div>
                ) : null}
              </div>
            </details>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export default QuotationWorkflowPanel;
