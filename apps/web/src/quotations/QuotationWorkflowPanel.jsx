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
  const hasOverflowActions =
    overflowActions.length > 0 || riskActions.length > 0;

  return (
    <section className="quotation-create-step quotation-workflow-panel">
      <div className="quotation-create-step-header quotation-workflow-panel-header">
        <div>
          <h4>Estado y flujo</h4>
          <p className="field-hint quotation-create-step-hint">
            Resume el estado actual y prioriza las siguientes acciones.
          </p>
        </div>
        <div className="quotation-workflow-badges">
          <span className="record-id-badge">{selectedVersion?.statusName}</span>
          <span className="record-id-badge">
            {selectedVersion?.isLatestVersion
              ? "Version mayor"
              : "Version historica"}
          </span>
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
          <div className="quotation-workflow-actions-block">
            <span className="quotation-workflow-eyebrow">Accion principal</span>
            {showWorkflowActions && primaryAction ? (
              <button
                type="button"
                className="btn-primary quotation-workflow-primary-action"
                disabled={busyAction === `action-${primaryAction.code}`}
                onClick={() => handleAction(primaryAction.code)}
              >
                {getActionLabel(primaryAction)}
              </button>
            ) : (
              <p className="field-hint quotation-workflow-no-actions">
                No hay una accion principal disponible para esta version.
              </p>
            )}
          </div>

          {showWorkflowActions && quickActions.length ? (
            <div className="quotation-workflow-actions-block">
              <span className="quotation-workflow-eyebrow">
                Acciones rapidas
              </span>
              <div className="quotation-workflow-quick-actions">
                {quickActions.map((action) => (
                  <button
                    key={action.code}
                    type="button"
                    className="quotation-workflow-action-chip"
                    disabled={busyAction === `action-${action.code}`}
                    onClick={() => handleAction(action.code)}
                  >
                    {getActionLabel(action)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {showWorkflowActions && hasOverflowActions ? (
            <details className="quotation-workflow-risk-actions">
              <summary>Mas opciones</summary>
              <div className="quotation-workflow-risk-actions-body">
                {overflowActions.length ? (
                  <div className="quotation-workflow-overflow-group">
                    <span className="quotation-workflow-eyebrow">
                      Otras acciones
                    </span>
                    <div className="quotation-workflow-overflow-actions">
                      {overflowActions.map((action) => (
                        <button
                          key={action.code}
                          type="button"
                          className="quotation-workflow-action-chip"
                          disabled={busyAction === `action-${action.code}`}
                          onClick={() => handleAction(action.code)}
                        >
                          {getActionLabel(action)}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {riskActions.length ? (
                  <div className="quotation-workflow-overflow-group">
                    <span className="quotation-workflow-eyebrow">
                      Acciones de cierre
                    </span>
                    <div className="quotation-workflow-overflow-actions">
                      {riskActions.map((action) => (
                        <button
                          key={action.code}
                          type="button"
                          className="quotation-workflow-action-chip is-risk"
                          disabled={busyAction === `action-${action.code}`}
                          onClick={() => handleAction(action.code)}
                        >
                          {getActionLabel(action)}
                        </button>
                      ))}
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
