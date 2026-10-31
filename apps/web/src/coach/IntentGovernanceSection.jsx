import { COACH_INTERACTION_MODE_LABELS, COACH_RULE_CHANNEL_LABELS } from "./miAgentConstants";

export function IntentGovernanceSection({ channelIntentCatalog, channelIntentChannel, channelIntentCode, channelIntentDraft, channelIntentFeedback, channelIntentPreview, channelIntentRevisions, channelIntentSaving, channelIntentTestQuestion, coachGovernanceSaving, coachIntentCatalog, coachIntentCode, coachIntentExamplesDraft, coachIntentFeedback, coachIntentPreview, coachIntentRevisions, coachIntentTestQuestion, previewChannelIntentConfiguration, previewCoachIntent, restoreChannelIntentConfiguration, restoreCoachIntentRevision, saveChannelIntentConfiguration, saveCoachIntentExamples, selectChannelIntent, selectCoachIntent, selectIntentRoutingChannel, selectedChannelIntent, selectedCoachIntent, setChannelIntentDraft, setChannelIntentTestQuestion, setCoachIntentExamplesDraft, setCoachIntentTestQuestion }) {
  return (
    <details
      className="mi-agent-intent-governance"
      aria-labelledby="mi-agent-intent-governance-title"
    >
      <summary className="mi-agent-intent-governance-summary">
        <strong
          id="mi-agent-intent-governance-title"
          role="heading"
          aria-level={4}
        >
          Intenciones y enrutamiento
        </strong>
        <span>
          Configura cómo se reconocen y enrutan las solicitudes de
          cada canal. Los permisos y límites los valida el servidor.
        </span>
      </summary>
      <div className="mi-agent-intent-governance-content">
        <label className="mi-agent-channel-intent-channel">
          Canal
          <select
            aria-label="Canal para intenciones y enrutamiento"
            value={channelIntentChannel}
            onChange={(event) =>
              selectIntentRoutingChannel(event.target.value)
            }
            disabled={channelIntentSaving || coachGovernanceSaving}
          >
            <option value="coach">Coach</option>
            <option value="customer_account">
              Cliente existente
            </option>
            <option value="prospect">Cuenta nueva</option>
          </select>
        </label>
        {channelIntentChannel === "coach" ? (
          <>
            <div
              className="mi-agent-intent-modes"
              aria-label="Modos de respuesta de Coach"
            >
              <article>
                <strong>Coaching</strong>
                <span>
                  Analiza avances y riesgos para proponer una mejora y
                  un siguiente paso al vendedor.
                </span>
              </article>
              <article>
                <strong>Contexto breve</strong>
                <span>
                  Contesta una pregunta puntual con los datos mínimos
                  relevantes, sin desplegar la ficha completa.
                </span>
              </article>
              <article>
                <strong>Exploración detallada</strong>
                <span>
                  No consulta el detalle desde Coach; ofrece abrir el
                  espacio que permite revisarlo.
                </span>
              </article>
              <article>
                <strong>Propuesta de operación</strong>
                <span>
                  Prepara un cambio para revisión; el módulo
                  correspondiente conserva la confirmación y
                  ejecución.
                </span>
              </article>
            </div>
            {coachIntentFeedback ? (
              <p
                className={`mi-agent-admin-rule-feedback is-${coachIntentFeedback.kind}`}
                role={
                  coachIntentFeedback.kind === "error"
                    ? "alert"
                    : "status"
                }
              >
                {coachIntentFeedback.message}
              </p>
            ) : null}
            <div className="mi-agent-intent-layout">
              <nav
                className="mi-agent-intent-catalog"
                aria-label="Catálogo de intenciones"
              >
                {coachIntentCatalog.map((intent) => (
                  <button
                    type="button"
                    key={intent.code}
                    className={
                      intent.code === coachIntentCode
                        ? "is-active"
                        : ""
                    }
                    onClick={() => selectCoachIntent(intent)}
                    disabled={coachGovernanceSaving}
                  >
                    <strong>{intent.label}</strong>
                    <span>{intent.code}</span>
                  </button>
                ))}
              </nav>
              {selectedCoachIntent ? (
                <div className="mi-agent-intent-detail">
                  <div>
                    <h5>{selectedCoachIntent.label}</h5>
                    <p>{selectedCoachIntent.description}</p>
                  </div>
                  <dl className="mi-agent-intent-metadata">
                    <div>
                      <dt>Contexto requerido</dt>
                      <dd>
                        {selectedCoachIntent.requiredContext.length
                          ? selectedCoachIntent.requiredContext.join(
                              ", ",
                            )
                          : "Ninguno"}
                      </dd>
                    </div>
                    <div>
                      <dt>Herramientas posibles</dt>
                      <dd>
                        {selectedCoachIntent.tools.length
                          ? selectedCoachIntent.tools.join(", ")
                          : "Ninguna"}
                      </dd>
                    </div>
                  </dl>
                  <label className="mi-agent-intent-examples">
                    Ejemplos reconocidos, uno por línea
                    <textarea
                      rows={6}
                      maxLength={7200}
                      value={coachIntentExamplesDraft}
                      onChange={(event) =>
                        setCoachIntentExamplesDraft(
                          event.target.value,
                        )
                      }
                      disabled={coachGovernanceSaving}
                    />
                  </label>
                  <div className="mi-agent-intent-preview-form">
                    <label>
                      Pregunta de prueba
                      <input
                        value={coachIntentTestQuestion}
                        maxLength={1200}
                        onChange={(event) =>
                          setCoachIntentTestQuestion(
                            event.target.value,
                          )
                        }
                        placeholder="Escribe una pregunta para probar el enrutamiento"
                      />
                    </label>
                    <div className="mi-agent-workspace-actions">
                      <button
                        type="button"
                        className="mi-agent-secondary-button"
                        onClick={previewCoachIntent}
                        disabled={
                          coachGovernanceSaving ||
                          !coachIntentTestQuestion.trim()
                        }
                      >
                        {coachGovernanceSaving
                          ? "Probando..."
                          : "Probar"}
                      </button>
                      <button
                        type="button"
                        className="mi-agent-primary-button"
                        onClick={saveCoachIntentExamples}
                        disabled={
                          coachGovernanceSaving ||
                          !coachIntentExamplesDraft.trim() ||
                          !selectedCoachIntent
                        }
                      >
                        Guardar ejemplos
                      </button>
                    </div>
                  </div>
                  {coachIntentPreview ? (
                    <div
                      className="mi-agent-intent-preview"
                      role="status"
                    >
                      <strong>
                        {coachIntentCatalog.find(
                          (intent) =>
                            intent.code ===
                            coachIntentPreview.classification.intent,
                        )?.label || "Requiere aclaración"}
                      </strong>
                      <span>
                        Modo:{" "}
                        {COACH_INTERACTION_MODE_LABELS[
                          coachIntentPreview.classification.mode
                        ] || "Requiere aclaración"}
                      </span>
                      {coachIntentPreview.classification
                        .detailTarget ? (
                        <span>
                          Detalle solicitado:{" "}
                          {
                            coachIntentPreview.classification
                              .detailTarget
                          }
                        </span>
                      ) : null}
                      <span>
                        Confianza{" "}
                        {Math.round(
                          coachIntentPreview.classification
                            .confidence * 100,
                        )}
                        %
                      </span>
                      <span>
                        Contexto:{" "}
                        {coachIntentPreview.classification.requiredContext.join(
                          ", ",
                        ) || "ninguno"}
                      </span>
                      {coachIntentPreview.missingContext.length ? (
                        <span>
                          Falta seleccionar:{" "}
                          {coachIntentPreview.missingContext.join(
                            ", ",
                          )}
                        </span>
                      ) : null}
                      <span>
                        Herramientas previstas:{" "}
                        {coachIntentPreview.plannedTools.join(", ") ||
                          "ninguna"}
                      </span>
                      <small>
                        Simulación sin ejecución de herramientas ni
                        cambios CRM.
                      </small>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="mi-agent-intent-revisions">
              <h5>Historial de configuración</h5>
              {coachIntentRevisions.length ? (
                coachIntentRevisions.map((revision) => (
                  <div
                    className="mi-agent-intent-revision"
                    key={revision.id}
                  >
                    <span>
                      Revisión {revision.id} ·{" "}
                      {new Date(revision.createdAt).toLocaleString()}
                      {revision.changedByUserId
                        ? ` · usuario ${revision.changedByUserId}`
                        : " · sistema"}
                    </span>
                    <button
                      type="button"
                      className="mi-agent-secondary-button"
                      onClick={() =>
                        restoreCoachIntentRevision(revision)
                      }
                      disabled={coachGovernanceSaving}
                    >
                      Restaurar
                    </button>
                  </div>
                ))
              ) : (
                <p>No hay cambios previos registrados.</p>
              )}
            </div>
          </>
        ) : null}

        {channelIntentChannel !== "coach" ? (
          <section
            className="mi-agent-channel-intent-governance"
            aria-labelledby="mi-agent-channel-intent-title"
          >
            <div className="mi-agent-admin-rules-heading">
              <div>
                <h4 id="mi-agent-channel-intent-title">
                  Enrutamiento ·{" "}
                  {COACH_RULE_CHANNEL_LABELS[channelIntentChannel]}
                </h4>
                <p>
                  Ajusta cómo se reconocen las intenciones y sus
                  lecturas permitidas. Los límites definitivos los
                  aplica el servidor.
                </p>
              </div>
            </div>
            {channelIntentFeedback ? (
              <p
                className={`mi-agent-admin-rule-feedback is-${channelIntentFeedback.kind}`}
                role={
                  channelIntentFeedback.kind === "error"
                    ? "alert"
                    : "status"
                }
              >
                {channelIntentFeedback.message}
              </p>
            ) : null}
            <div className="mi-agent-intent-layout">
              <nav
                className="mi-agent-intent-catalog"
                aria-label="Intenciones del canal"
              >
                {channelIntentCatalog.map((intent) => (
                  <button
                    type="button"
                    key={intent.code}
                    className={
                      intent.code === channelIntentCode
                        ? "is-active"
                        : ""
                    }
                    onClick={() => selectChannelIntent(intent)}
                    disabled={channelIntentSaving}
                  >
                    <strong>{intent.label}</strong>
                    <span>{intent.code}</span>
                  </button>
                ))}
              </nav>
              {selectedChannelIntent && channelIntentDraft ? (
                <div className="mi-agent-intent-detail">
                  <div>
                    <h5>{selectedChannelIntent.label}</h5>
                    <p>{selectedChannelIntent.description}</p>
                  </div>
                  <label className="mi-agent-channel-intent-toggle">
                    <input
                      type="checkbox"
                      checked={channelIntentDraft.enabled}
                      disabled={
                        channelIntentSaving ||
                        [
                          "account_overview",
                          "prospect_profile",
                        ].includes(selectedChannelIntent.code)
                      }
                      onChange={(event) =>
                        setChannelIntentDraft((current) => ({
                          ...current,
                          enabled: event.target.checked,
                        }))
                      }
                    />
                    Activa
                  </label>
                  <label className="mi-agent-channel-intent-priority">
                    Prioridad
                    <input
                      type="number"
                      min={0}
                      max={200}
                      value={channelIntentDraft.priority}
                      onChange={(event) =>
                        setChannelIntentDraft((current) => ({
                          ...current,
                          priority: Number(event.target.value),
                        }))
                      }
                      disabled={channelIntentSaving}
                    />
                  </label>
                  <label className="mi-agent-intent-examples">
                    Ejemplos reconocidos, uno por línea
                    <textarea
                      rows={5}
                      maxLength={7200}
                      value={channelIntentDraft.examples}
                      onChange={(event) =>
                        setChannelIntentDraft((current) => ({
                          ...current,
                          examples: event.target.value,
                        }))
                      }
                      disabled={channelIntentSaving}
                    />
                  </label>
                  <fieldset className="mi-agent-channel-intent-options">
                    <legend>Herramientas permitidas</legend>
                    {selectedChannelIntent.possibleTools.map(
                      (tool) => (
                        <label key={tool}>
                          <input
                            type="checkbox"
                            checked={channelIntentDraft.allowedTools.includes(
                              tool,
                            )}
                            onChange={(event) =>
                              setChannelIntentDraft((current) => ({
                                ...current,
                                allowedTools: event.target.checked
                                  ? [...current.allowedTools, tool]
                                  : current.allowedTools.filter(
                                      (item) => item !== tool,
                                    ),
                              }))
                            }
                            disabled={channelIntentSaving}
                          />
                          {tool}
                        </label>
                      ),
                    )}
                  </fieldset>
                  <fieldset className="mi-agent-channel-intent-options">
                    <legend>Contexto requerido</legend>
                    {(channelIntentChannel === "customer_account"
                      ? ["account", "opportunity", "contact"]
                      : ["prospectSession"]
                    ).map((contextKey) => {
                      const fixed =
                        selectedChannelIntent.fixedContext.includes(
                          contextKey,
                        );
                      return (
                        <label key={contextKey}>
                          <input
                            type="checkbox"
                            checked={channelIntentDraft.requiredContext.includes(
                              contextKey,
                            )}
                            onChange={(event) =>
                              setChannelIntentDraft((current) => ({
                                ...current,
                                requiredContext: event.target.checked
                                  ? [
                                      ...current.requiredContext,
                                      contextKey,
                                    ]
                                  : current.requiredContext.filter(
                                      (item) => item !== contextKey,
                                    ),
                              }))
                            }
                            disabled={channelIntentSaving || fixed}
                          />
                          {contextKey}
                          {fixed ? " · obligatorio" : ""}
                        </label>
                      );
                    })}
                  </fieldset>
                  <div className="mi-agent-intent-preview-form">
                    <label>
                      Pregunta de prueba
                      <input
                        value={channelIntentTestQuestion}
                        maxLength={1200}
                        onChange={(event) =>
                          setChannelIntentTestQuestion(
                            event.target.value,
                          )
                        }
                        placeholder="Escribe una pregunta para probar el enrutamiento"
                      />
                    </label>
                    <div className="mi-agent-workspace-actions">
                      <button
                        type="button"
                        className="mi-agent-secondary-button"
                        onClick={previewChannelIntentConfiguration}
                        disabled={
                          channelIntentSaving ||
                          !channelIntentTestQuestion.trim()
                        }
                      >
                        Probar
                      </button>
                      <button
                        type="button"
                        className="mi-agent-primary-button"
                        onClick={saveChannelIntentConfiguration}
                        disabled={
                          channelIntentSaving ||
                          !channelIntentDraft.examples.trim()
                        }
                      >
                        Guardar configuración
                      </button>
                    </div>
                  </div>
                  {channelIntentPreview?.classification ? (
                    <div className="mi-agent-intent-preview">
                      <strong>
                        {channelIntentPreview.classification.label} ·{" "}
                        {channelIntentPreview.classification.intent}
                      </strong>
                      {channelIntentPreview.classification
                        .missingContext.length ? (
                        <span>
                          Contexto requerido no suministrado:{" "}
                          {channelIntentPreview.classification.missingContext.join(
                            ", ",
                          )}
                        </span>
                      ) : null}
                      <span>
                        Herramientas previstas:{" "}
                        {channelIntentPreview.classification.allowedTools.join(
                          ", ",
                        ) || "ninguna"}
                      </span>
                      <small>
                        Simulación sin ejecución de herramientas ni
                        cambios CRM.
                      </small>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="mi-agent-intent-revisions">
              <h5>Historial de configuración del canal</h5>
              {channelIntentRevisions.length ? (
                channelIntentRevisions.map((revision) => (
                  <div
                    className="mi-agent-intent-revision"
                    key={revision.id}
                  >
                    <span>
                      Revisión {revision.id} ·{" "}
                      {new Date(revision.createdAt).toLocaleString()}
                      {revision.restoredFromRevisionId
                        ? ` · restaurada desde ${revision.restoredFromRevisionId}`
                        : ""}
                    </span>
                    <button
                      type="button"
                      className="mi-agent-secondary-button"
                      onClick={() =>
                        restoreChannelIntentConfiguration(revision)
                      }
                      disabled={channelIntentSaving}
                    >
                      Restaurar
                    </button>
                  </div>
                ))
              ) : (
                <p>No hay cambios previos registrados.</p>
              )}
            </div>
          </section>
        ) : null}
      </div>
    </details>
  );
}
