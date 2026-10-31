export function DecisionObservabilitySection({ coachDecisionReviewSaving, coachDecisionTraceDetail, coachDecisionTraceFilters, coachDecisionTraceLoading, coachDecisionTraces, coachQualityLoading, coachQualitySummary, loadCoachQualitySummary, reviewCoachDecisionTrace, setCoachDecisionTraceDetail, setCoachDecisionTraceFilters }) {
  return (
    <details
      className="mi-agent-admin-rules"
      aria-labelledby="mi-agent-decision-observability-title"
    >
      <summary className="mi-agent-admin-rules-summary">
        <strong
          id="mi-agent-decision-observability-title"
          role="heading"
          aria-level={4}
        >
          Observabilidad de la decisión final
        </strong>
        <span>
          Muestra B3, B6 y la resolución del servidor para validar la
          intención final antes de ejecutar la respuesta.
        </span>
      </summary>
      <div className="mi-agent-admin-rules-content">
        {coachQualityLoading || coachDecisionTraceLoading ? (
          <div className="mi-agent-empty">
            Cargando trazas de decisión...
          </div>
        ) : null}
        {coachQualitySummary ? (
          <div className="mi-agent-domain-policy-content">
            <div className="mi-agent-governance-grid">
              <div className="mi-agent-domain-option">
                <strong>{coachQualitySummary.totalTurns || 0}</strong>
                <small>turnos analizados</small>
              </div>
              <div className="mi-agent-domain-option">
                <strong>
                  {coachQualitySummary.channels?.[0]
                    ?.clarificationRate
                    ? `${Math.round(
                        coachQualitySummary.channels[0]
                          .clarificationRate * 100,
                      )}%`
                    : "0%"}
                </strong>
                <small>tasa de aclaración</small>
              </div>
              <div className="mi-agent-domain-option">
                <strong>
                  {coachQualitySummary.channels?.[0]
                    ?.averageLatencyMs || 0}{" "}
                  ms
                </strong>
                <small>latencia media</small>
              </div>
            </div>
          </div>
        ) : null}
        <div className="mi-agent-governance-grid">
          <label>
            Canal
            <select
              value={coachDecisionTraceFilters.channel}
              onChange={(event) => {
                const nextFilters = {
                  ...coachDecisionTraceFilters,
                  channel: event.target.value,
                };
                setCoachDecisionTraceFilters(nextFilters);
                void loadCoachQualitySummary(nextFilters);
              }}
            >
              <option value="coach">Coach</option>
              <option value="customer_account">
                Cliente existente
              </option>
              <option value="prospect">Cuenta nueva</option>
            </select>
          </label>
          <label>
            Estado de revisión
            <select
              value={coachDecisionTraceFilters.reviewStatus}
              onChange={(event) => {
                const nextFilters = {
                  ...coachDecisionTraceFilters,
                  reviewStatus: event.target.value,
                };
                setCoachDecisionTraceFilters(nextFilters);
                void loadCoachQualitySummary(nextFilters);
              }}
            >
              <option value="all">Todas</option>
              <option value="accepted">Aceptadas</option>
              <option value="rejected">Rechazadas</option>
              <option value="needs_review">Necesitan revisión</option>
              <option value="unreviewed">Sin revisar</option>
            </select>
          </label>
          <label>
            Límite
            <select
              value={String(coachDecisionTraceFilters.limit)}
              onChange={(event) => {
                const nextFilters = {
                  ...coachDecisionTraceFilters,
                  limit: Number(event.target.value),
                };
                setCoachDecisionTraceFilters(nextFilters);
                void loadCoachQualitySummary(nextFilters);
              }}
            >
              <option value="5">5</option>
              <option value="8">8</option>
              <option value="12">12</option>
              <option value="20">20</option>
            </select>
          </label>
        </div>
        <div className="mi-agent-intent-revisions">
          <h5>Decisiones finales recientes</h5>
          {coachDecisionTraces.length ? (
            <div className="mi-agent-admin-rule-list">
              {coachDecisionTraces.map((trace) => (
                <article
                  className="mi-agent-admin-rule"
                  key={trace.id}
                >
                  <div className="mi-agent-admin-rule-copy">
                    <strong>{trace.intent}</strong>
                    <span>
                      {trace.policyProcess || "default"} ·{" "}
                      {trace.interactionMode || "unknown"}
                    </span>
                    <p>
                      Preclasificación: {trace.b3Bucket || "unknown"}{" "}
                      · Intención IA:{" "}
                      {trace.semanticIntent || "unknown"} ·
                      Resolución: {trace.resolution || "unknown"}
                    </p>
                  </div>
                  <div className="mi-agent-admin-rule-controls">
                    <small>
                      Confianza{" "}
                      {Math.round((trace.confidence || 0) * 100)}% ·{" "}
                      {trace.conflict === "conflict"
                        ? "conflicto"
                        : "alineado"}
                    </small>
                    <small>
                      {trace.requiresClarification
                        ? "requiere aclaración"
                        : "sin aclaración"}
                    </small>
                    <button
                      type="button"
                      className="mi-agent-secondary-button"
                      onClick={() =>
                        setCoachDecisionTraceDetail(trace)
                      }
                      disabled={coachDecisionReviewSaving}
                    >
                      Detalle
                    </button>
                    <button
                      type="button"
                      className="mi-agent-secondary-button"
                      onClick={() =>
                        reviewCoachDecisionTrace(trace.id, "accepted")
                      }
                      disabled={coachDecisionReviewSaving}
                    >
                      Aceptar
                    </button>
                    <button
                      type="button"
                      className="mi-agent-secondary-button"
                      onClick={() =>
                        reviewCoachDecisionTrace(trace.id, "rejected")
                      }
                      disabled={coachDecisionReviewSaving}
                    >
                      Rechazar
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p>
              No hay decisiones finales registradas en la última
              ventana.
            </p>
          )}
        </div>
        {coachDecisionTraceDetail ? (
          <div className="mi-agent-admin-rule-editor">
            <div className="mi-agent-admin-rule-editor-heading">
              <h5>Detalle de decisión</h5>
              <span>
                {coachDecisionTraceDetail.reviewStatus ||
                  "unreviewed"}
              </span>
            </div>
            <dl className="mi-agent-intent-metadata">
              <div>
                <dt>Intento final</dt>
                <dd>{coachDecisionTraceDetail.intent}</dd>
              </div>
              <div>
                <dt>Preclasificación determinista</dt>
                <dd>{coachDecisionTraceDetail.b3Bucket}</dd>
              </div>
              <div>
                <dt>Intención semántica (IA)</dt>
                <dd>{coachDecisionTraceDetail.semanticIntent}</dd>
              </div>
              <div>
                <dt>Resolución</dt>
                <dd>{coachDecisionTraceDetail.resolution}</dd>
              </div>
              <div>
                <dt>Modo</dt>
                <dd>{coachDecisionTraceDetail.interactionMode}</dd>
              </div>
              <div>
                <dt>Proceso</dt>
                <dd>{coachDecisionTraceDetail.policyProcess}</dd>
              </div>
              <div>
                <dt>Confianza</dt>
                <dd>
                  {Math.round(
                    (coachDecisionTraceDetail.confidence || 0) * 100,
                  )}
                  %
                </dd>
              </div>
              <div>
                <dt>Validación</dt>
                <dd>{coachDecisionTraceDetail.validationStatus}</dd>
              </div>
            </dl>
            <div className="mi-agent-workspace-actions">
              <button
                type="button"
                className="mi-agent-primary-button"
                onClick={() =>
                  reviewCoachDecisionTrace(
                    coachDecisionTraceDetail.id,
                    "accepted",
                    "Revisado por administración",
                  )
                }
                disabled={coachDecisionReviewSaving}
              >
                Marcar correcta
              </button>
              <button
                type="button"
                className="mi-agent-secondary-button"
                onClick={() =>
                  reviewCoachDecisionTrace(
                    coachDecisionTraceDetail.id,
                    "rejected",
                    "Revisado por administración",
                  )
                }
                disabled={coachDecisionReviewSaving}
              >
                Marcar como revisión
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </details>
  );
}
