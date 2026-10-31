import { PRIORITY_LABELS, ACTION_STATUS_LABELS } from "./miAgentConstants";

export function CoachAnalysisContent({ analysis, analyzeSituation, analyzing, canExecuteCoach, canUpdateCommercialDevelopment, canUseCoach, creatingActionRank, navigate, openCoachActionConfirmation, selectedAction, setActiveWorkspace, setSelectedAction }) {
  return (
    <div className="mi-agent-content-stack">
      <div className="mi-agent-main-column">
        <section className="mi-agent-focus-panel">
          <div className="mi-agent-section-heading">
            <div>
              <span className="mi-agent-section-label">
                Lectura del agente
              </span>
              <h3>{analysis.headline || "Tu situación comercial"}</h3>
            </div>
            <span className="mi-agent-analysis-date">
              Actualizado ahora
            </span>
            <button
              type="button"
              className="mi-agent-secondary-button"
              onClick={analyzeSituation}
              disabled={analyzing}
            >
              {analyzing ? "Actualizando..." : "Actualizar análisis"}
            </button>
          </div>
          <p>{analysis.summary || analysis.quotaReadout}</p>
        </section>

        {analysis.activityProgress ? (
          <section className="mi-agent-activity-progress-panel">
            <div className="mi-agent-section-heading">
              <div>
                <span className="mi-agent-section-label">
                  Efectividad comercial
                </span>
                <h3>Actividad vs. avance</h3>
              </div>
              <span>Lectura del período</span>
            </div>
            <p className="mi-agent-activity-progress-message">
              {analysis.activityProgress.message}
            </p>
            <div className="mi-agent-activity-progress-metrics">
              <article>
                <span>Actividades recientes</span>
                <strong>
                  {analysis.activityProgress.activityCount}
                </strong>
                <small>Últimos 7 días</small>
              </article>
              <article>
                <span>Oportunidades con respuesta de etapa</span>
                <strong>
                  {analysis.activityProgress.progressedOpportunities}
                </strong>
                <small>Registrada en los últimos 7 días</small>
              </article>
              <article
                className={
                  analysis.activityProgress
                    .opportunitiesWithoutProgress
                    ? "is-alert"
                    : ""
                }
              >
                <span>Actividad sin evidencia de etapa</span>
                <strong>
                  {
                    analysis.activityProgress
                      .opportunitiesWithoutProgress
                  }
                </strong>
                <small>
                  Oportunidades que requieren una interacción más
                  dirigida
                </small>
              </article>
            </div>
            {analysis.activityProgress.details?.filter(
              (item) => item.activityWithoutProgress,
            ).length ? (
              <div className="mi-agent-activity-progress-list">
                <strong>
                  Oportunidades con actividad pero sin respuesta de
                  etapa reciente
                </strong>
                <ul>
                  {analysis.activityProgress.details
                    .filter((item) => item.activityWithoutProgress)
                    .map((item) => (
                      <li key={item.opportunityId}>
                        <span>
                          {item.opportunityName} ·{" "}
                          {item.accountName || "Sin cuenta"}
                        </span>
                        <small>
                          {item.activityCount} actividades · sin
                          respuesta de etapa posterior a la actividad
                        </small>
                        <button
                          type="button"
                          className="mi-agent-link-button"
                          onClick={() =>
                            navigate(
                              `/opportunities?edit=${item.opportunityId}`,
                            )
                          }
                        >
                          Abrir oportunidad
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}

        {analysis.alerts?.length ? (
          <section className="mi-agent-alerts-panel">
            <div className="mi-agent-section-heading">
              <div>
                <span className="mi-agent-section-label">
                  Diagnóstico automático
                </span>
                <h3>Problemas de venta detectados</h3>
              </div>
              <span>{analysis.alerts.length} alertas</span>
            </div>
            <div className="mi-agent-alert-list">
              {analysis.alerts.map((alert) => (
                <article
                  key={`${alert.code}-${alert.opportunityId || alert.accountName || alert.title}`}
                  className={`mi-agent-alert-card is-${alert.severity}`}
                >
                  <div className="mi-agent-alert-card-heading">
                    <strong>{alert.title}</strong>
                    <span>
                      {alert.severity === "critical"
                        ? "Crítica"
                        : alert.severity === "high"
                          ? "Alta"
                          : "Media"}
                    </span>
                  </div>
                  <p>
                    {alert.opportunityName
                      ? `Oportunidad: ${alert.opportunityName} · ${alert.accountName || "Sin cuenta"}`
                      : "Pipeline del vendedor"}
                  </p>
                  <p>
                    <strong>Evidencia:</strong> {alert.evidence}
                  </p>
                  <p>
                    <strong>Acción:</strong> {alert.action}
                  </p>
                  {alert.opportunityId ? (
                    <button
                      type="button"
                      className="mi-agent-link-button"
                      onClick={() =>
                        navigate(
                          `/opportunities?edit=${alert.opportunityId}`,
                        )
                      }
                    >
                      Abrir oportunidad
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <section className="mi-agent-actions-panel">
          <div className="mi-agent-section-heading">
            <div>
              <span className="mi-agent-section-label">
                Orden recomendado
              </span>
              <h3>Qué hacer ahora</h3>
            </div>
            <span>{analysis.actions.length} acciones</span>
          </div>
          <div className="mi-agent-action-list">
            {analysis.actions.length ? (
              analysis.actions.map((action) => (
                <div
                  key={`${action.rank}-${action.opportunityId || action.title}`}
                  className="mi-agent-action-item"
                >
                  <button
                    type="button"
                    className={`mi-agent-action-row ${selectedAction?.rank === action.rank ? "is-selected" : ""}`}
                    onClick={() => setSelectedAction(action)}
                  >
                    <span className="mi-agent-action-rank">
                      {action.rank}
                    </span>
                    <span className="mi-agent-action-copy">
                      <strong>
                        {action.title || "Acción comercial"}
                      </strong>
                      <small>
                        Oportunidad #{action.opportunityId || "-"} ·{" "}
                        {action.opportunityName || "Sin nombre"}
                      </small>
                      <small>
                        {action.accountName || "Sin cuenta"} ·{" "}
                        {action.stageName || "Sin etapa"}
                      </small>
                    </span>
                    <span
                      className={`mi-agent-health-badge is-${String(action.salesHealth?.label || "parcial").toLowerCase()}`}
                    >
                      {action.salesHealth
                        ? `Salud ${action.salesHealth.label}`
                        : "Salud"}
                    </span>
                    <span
                      className={`mi-agent-priority is-${action.priority}`}
                    >
                      {PRIORITY_LABELS[action.priority]}
                    </span>
                    <span
                      className={`mi-agent-row-state ${action.status === "done" ? "is-done" : ""}`}
                    >
                      {ACTION_STATUS_LABELS[action.status] ||
                        "Pendiente"}
                    </span>
                  </button>
                  {action.opportunityId ? (
                    <button
                      type="button"
                      className="mi-agent-link-button"
                      onClick={() =>
                        navigate(
                          `/opportunities?edit=${action.opportunityId}`,
                        )
                      }
                    >
                      Abrir oportunidad
                    </button>
                  ) : canUseCoach ? (
                    <button
                      type="button"
                      className="mi-agent-link-button"
                      onClick={() => setActiveWorkspace("coach")}
                    >
                      Consultar con Coach
                    </button>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="mi-agent-empty">
                No se encontraron acciones concretas en este análisis.
              </div>
            )}
          </div>
        </section>
      </div>

      <section
        className="mi-agent-detail-panel"
        style={{ alignSelf: "stretch", position: "static" }}
      >
        {selectedAction ? (
          <>
            <div className="mi-agent-detail-heading">
              <div>
                <span className="mi-agent-section-label">
                  Detalle de la acción
                </span>
                <h3>{selectedAction.title}</h3>
                <p>
                  Oportunidad #{selectedAction.opportunityId || "-"} ·{" "}
                  {selectedAction.opportunityName || "Sin nombre"} ·{" "}
                  {selectedAction.accountName || "Sin cuenta"}
                </p>
              </div>
              <span
                className={`mi-agent-priority is-${selectedAction.priority}`}
              >
                {PRIORITY_LABELS[selectedAction.priority]}
              </span>
            </div>
            <div className="mi-agent-detail-facts">
              <article>
                <span>Por qué importa</span>
                <p>
                  {selectedAction.reason ||
                    "Prioridad definida por el análisis del pipeline."}
                </p>
              </article>
              <article>
                <span>Riesgo</span>
                <p>
                  {selectedAction.risk ||
                    "Sin riesgo adicional identificado."}
                </p>
              </article>
              <article>
                <span>Resultado esperado</span>
                <p>
                  {selectedAction.expectedOutcome ||
                    "Obtener un siguiente paso verificable."}
                </p>
              </article>
              <article>
                <span>Criterio de éxito</span>
                <p>
                  {selectedAction.successCriteria ||
                    "Registrar el resultado y el siguiente compromiso."}
                </p>
              </article>
            </div>
            {selectedAction.salesHealth ? (
              <div className="mi-agent-health-panel">
                <div className="mi-agent-health-heading">
                  <div>
                    <span className="mi-agent-section-label">
                      Salud de la oportunidad
                    </span>
                    <strong>
                      {selectedAction.salesHealth.label} ·{" "}
                      {selectedAction.salesHealth.solidCount}/
                      {selectedAction.salesHealth.totalCount}{" "}
                      dimensiones sólidas
                    </strong>
                  </div>
                  <span>
                    Principal debilidad:{" "}
                    {selectedAction.salesHealth.principalWeakness}
                  </span>
                </div>
                <div className="mi-agent-health-grid">
                  {selectedAction.salesHealth.dimensions.map(
                    (dimension) => (
                      <div
                        key={dimension.key}
                        className={`mi-agent-health-dimension is-${dimension.state}`}
                      >
                        <span>{dimension.label}</span>
                        <strong>{dimension.stateLabel}</strong>
                        <small>{dimension.evidence}</small>
                      </div>
                    ),
                  )}
                </div>
              </div>
            ) : null}
            <div className="mi-agent-execution-kit">
              <div className="mi-agent-execution-kit-heading">
                <div>
                  <span className="mi-agent-section-label">
                    Preparación para ejecutar
                  </span>
                  <h4>{selectedAction.actionType || "follow_up"}</h4>
                </div>
                <span>Listo para usar</span>
              </div>
              <div className="mi-agent-kit-grid">
                <article>
                  <span>Objetivo</span>
                  <p>
                    {selectedAction.executionKit?.objective ||
                      selectedAction.expectedOutcome ||
                      "Conseguir un compromiso verificable del cliente."}
                  </p>
                </article>
                <article>
                  <span>Resultado mínimo</span>
                  <p>
                    {selectedAction.executionKit?.minimumOutcome ||
                      selectedAction.successCriteria ||
                      "Definir fecha, responsable y siguiente hito."}
                  </p>
                </article>
                <article>
                  <span>Propuesta de valor</span>
                  <p>
                    {selectedAction.executionKit?.valueProposition ||
                      "Conectar la solución con la necesidad y el riesgo concreto del cliente."}
                  </p>
                </article>
                <article>
                  <span>Mensaje de seguimiento</span>
                  <p>
                    {selectedAction.executionKit?.followUpMessage ||
                      "Enviar un resumen de acuerdos con fecha y siguiente paso."}
                  </p>
                </article>
              </div>
              {selectedAction.executionKit?.knownInformation
                ?.length ? (
                <div className="mi-agent-kit-list">
                  <strong>Información conocida</strong>
                  <ul>
                    {selectedAction.executionKit.knownInformation.map(
                      (item) => (
                        <li key={item}>{item}</li>
                      ),
                    )}
                  </ul>
                </div>
              ) : null}
              {selectedAction.executionKit?.objections?.length ? (
                <div className="mi-agent-kit-list">
                  <strong>Objeciones probables</strong>
                  <ul>
                    {selectedAction.executionKit.objections.map(
                      (item) => (
                        <li key={item}>{item}</li>
                      ),
                    )}
                  </ul>
                </div>
              ) : null}
            </div>
            {selectedAction.questions?.length ? (
              <div className="mi-agent-questions">
                <strong>Preguntas sugeridas</strong>
                <ul>
                  {selectedAction.questions.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {selectedAction.developmentNarrative ? (
              <div className="mi-agent-development-context">
                <span className="mi-agent-section-label">
                  Desarrollo de la oportunidad
                </span>
                <span
                  className={`mi-agent-alignment-status is-${selectedAction.alignedContext?.alignment || "partially_aligned"}`}
                  style={{
                    display: "inline-block",
                    marginBottom: "8px",
                    fontSize: "12px",
                    fontWeight: 800,
                  }}
                >
                  Alineación:{" "}
                  {selectedAction.alignedContext?.alignment ===
                  "aligned"
                    ? "Alineada"
                    : selectedAction.alignedContext?.alignment ===
                        "not_aligned"
                      ? "Requiere revisión"
                      : "Parcial"}
                </span>
                <div className="mi-agent-development-block">
                  <strong>Descripción y situación actual</strong>
                  <p>
                    {selectedAction.alignedContext?.situation ||
                      selectedAction.developmentNarrative.contract
                        ?.descriptionSituationText ||
                      selectedAction.developmentNarrative
                        .statusSummary ||
                      "Sin información disponible."}
                  </p>
                </div>
                <div className="mi-agent-development-block">
                  <strong>Estrategia para lograr la venta</strong>
                  <p>
                    {selectedAction.alignedContext?.strategy ||
                      selectedAction.developmentNarrative.contract
                        ?.salesStrategyText ||
                      "Sin información disponible."}
                  </p>
                </div>
                <div className="mi-agent-development-block">
                  <strong>Siguiente mejor paso</strong>
                  <p>
                    {selectedAction.alignedContext?.nextBestStep ||
                      selectedAction.developmentNarrative.contract
                        ?.nextBestStepText ||
                      selectedAction.developmentNarrative
                        .nextStepRecommendation ||
                      "Sin información disponible."}
                  </p>
                </div>
                <div className="mi-agent-development-block">
                  <strong>Paso alternativo</strong>
                  <p>
                    {selectedAction.alignedContext?.alternativeStep ||
                      selectedAction.developmentNarrative.contract
                        ?.alternativeStepText ||
                      "Sin información disponible."}
                  </p>
                </div>
              </div>
            ) : null}
            {selectedAction.title &&
            canExecuteCoach &&
            canUpdateCommercialDevelopment ? (
              <button
                type="button"
                className="mi-agent-primary-button is-wide"
                onClick={() =>
                  openCoachActionConfirmation(selectedAction)
                }
                disabled={
                  creatingActionRank === selectedAction.rank ||
                  selectedAction.status === "done"
                }
              >
                {selectedAction.status === "done"
                  ? "Próximo paso creado"
                  : "Crear próximo paso"}
              </button>
            ) : null}
            {selectedAction.opportunityId &&
            (!canExecuteCoach || !canUpdateCommercialDevelopment) ? (
              <p className="mi-agent-permission-note">
                Tienes acceso de lectura. Solicita permiso de
                ejecución y Desarrollo Comercial para preparar el
                próximo paso.
              </p>
            ) : null}
          </>
        ) : (
          <div className="mi-agent-empty">
            Selecciona una acción para ver su contexto.
          </div>
        )}
      </section>
    </div>
  );
}
