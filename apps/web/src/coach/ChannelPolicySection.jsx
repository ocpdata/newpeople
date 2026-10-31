import {
  COACH_INTENT_PROCESS_OPTIONS,
  COACH_RULE_CHANNEL_LABELS,
  COACH_OPERATION_OPTIONS,
  COACH_OPERATION_DESCRIPTIONS,
} from "./miAgentConstants";

export function ChannelPolicySection({ coachBusinessRulesChannel, coachBusinessRulesProcess, coachBusinessRulesSourceLabel, coachGovernanceSaving, loadCoachAdminRules, loadCoachBusinessRulesForScope, saveCoachBusinessRules, selectedCoachBusinessRules, selectedCoachProcessOption, setCoachBusinessRulesChannel, setCoachBusinessRulesProcess, updateCoachBusinessRuleField, updateCoachOperationKind }) {
  return (
    <details
      className="mi-agent-domain-policy"
      aria-labelledby="mi-agent-channel-policy-title"
    >
      <summary className="mi-agent-domain-policy-main-summary">
        <strong
          id="mi-agent-channel-policy-title"
          role="heading"
          aria-level={4}
        >
          Políticas del canal y contexto
        </strong>
        <span>
          Delimita qué datos puede consultar cada canal y qué
          operaciones puede proponer. Los permisos del usuario siempre
          se validan por separado.
        </span>
      </summary>
      <div className="mi-agent-domain-policy-content">
        <div className="mi-agent-governance-grid">
          <label>
            Canal
            <select
              value={coachBusinessRulesChannel}
              onChange={(event) => {
                const channel = event.target.value;
                setCoachBusinessRulesChannel(channel);
                setCoachBusinessRulesProcess("default");
                loadCoachAdminRules("all", "default");
                loadCoachBusinessRulesForScope(channel, "default");
              }}
            >
              <option value="coach">Coach</option>
              <option value="customer_account">
                Cuenta existente
              </option>
              <option value="prospect">Cuenta nueva</option>
            </select>
          </label>
          {["coach", "customer_account", "prospect"].includes(
            coachBusinessRulesChannel,
          ) ? (
            <div className="mi-agent-governance-process-fixed">
              <span>
                {coachBusinessRulesChannel === "coach"
                  ? "Conversación"
                  : "Tipo de consulta"}
              </span>
              <strong>
                {coachBusinessRulesChannel === "coach"
                  ? "Asesoría de desarrollo comercial"
                  : selectedCoachProcessOption.label}
              </strong>
              <small className="mi-agent-scope-help">
                {coachBusinessRulesChannel === "coach"
                  ? "Orienta el desempeño del vendedor y el avance del proceso comercial."
                  : selectedCoachProcessOption.description}
              </small>
            </div>
          ) : (
            <label>
              Tipo de consulta
              <select
                value={coachBusinessRulesProcess}
                onChange={(event) => {
                  const process = event.target.value;
                  setCoachBusinessRulesProcess(process);
                  loadCoachAdminRules("all", process);
                  loadCoachBusinessRulesForScope(
                    coachBusinessRulesChannel,
                    process,
                  );
                }}
              >
                <option value="default">
                  Configuración predeterminada del canal
                </option>
                {COACH_INTENT_PROCESS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <small className="mi-agent-scope-help">
                {selectedCoachProcessOption.description}
              </small>
            </label>
          )}
        </div>

        {coachBusinessRulesChannel === "customer_account" ? (
          <p>Las políticas de Cliente existente ahora se administran en{" "}
            <a href="#mi-agent-server-rules" onClick={() => {
              const section = document.getElementById("mi-agent-server-rules");
              if (section) section.open = true;
            }}>Reglas del servidor</a>. Se utiliza la misma configuración, sin duplicarla.</p>
        ) : (
          <>
        {coachBusinessRulesChannel === "coach" ? (
          <details className="mi-agent-admin-rules-advanced mi-agent-intent-policy-overrides">
            <summary>Ajustes avanzados por intención</summary>
            <label>
              Intención con ajuste específico
              <select
                value={
                  coachBusinessRulesProcess === "default"
                    ? ""
                    : coachBusinessRulesProcess
                }
                onChange={(event) => {
                  const process = event.target.value || "default";
                  setCoachBusinessRulesProcess(process);
                  loadCoachAdminRules("all", process);
                  loadCoachBusinessRulesForScope("coach", process);
                }}
              >
                <option value="">
                  Sin ajuste específico · usar configuración general
                </option>
                {COACH_INTENT_PROCESS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <p>
              Los ajustes por intención son opcionales y sustituyen
              solo la configuración general de esa intención.
              Exploración detallada siempre se deriva al módulo
              autorizado.
            </p>
          </details>
        ) : null}

        <p className="mi-agent-scope-explainer">
          {coachBusinessRulesChannel === "customer_account"
            ? "Esta configuración única se aplica a toda la conversación de cliente existente."
            : coachBusinessRulesChannel === "prospect"
              ? "Esta configuración única se aplica a todas las conversaciones de cuenta nueva."
              : coachBusinessRulesProcess === "default"
                ? "Esta configuración general aplica a toda la conversación de Coach; los overrides por intención son opcionales."
                : `Este ajuste se aplica a ${selectedCoachProcessOption.label.toLowerCase()}; si no hay un override, Coach usa la configuración general.`}
        </p>

        <section className="mi-agent-domain-policy-subsection">
          <div className="mi-agent-domain-policy-subsection-heading">
            <h4>
              {coachBusinessRulesChannel === "coach" &&
              coachBusinessRulesProcess !== "default"
                ? `Ajuste por intención: ${selectedCoachProcessOption.label}`
                : "Alcance por dominio y operaciones"}
            </h4>
            <span>
              {COACH_RULE_CHANNEL_LABELS[coachBusinessRulesChannel]} ·{" "}
              {selectedCoachProcessOption.label}
            </span>
          </div>
          <div className="mi-agent-domain-policy-content">
            <div>
              <span className="mi-agent-section-label">
                {COACH_RULE_CHANNEL_LABELS[coachBusinessRulesChannel]}
              </span>
              <div className="mi-agent-admin-scope-status">
                <strong>
                  Configuración para:{" "}
                  {
                    COACH_RULE_CHANNEL_LABELS[
                      coachBusinessRulesChannel
                    ]
                  }{" "}
                  · {selectedCoachProcessOption.label}
                </strong>
                <span>{coachBusinessRulesSourceLabel}</span>
              </div>
              <p>
                Estos controles pueden reducir lo que consulta o
                propone el chat. Los permisos efectivos y los límites
                obligatorios del canal siguen siendo validados por el
                servidor.
              </p>
            </div>
            <div className="mi-agent-domain-policy-groups">
              <fieldset className="mi-agent-domain-stage-group">
                <legend>Dominios disponibles para consulta</legend>
                {[
                  [
                    "accountSearchAllowed",
                    "Cuentas",
                    "Consulta datos generales de cuentas autorizadas, como nombre, registro y ubicación.",
                  ],
                  [
                    "contactSearchAllowed",
                    "Contactos",
                    "Busca contactos vinculados a una cuenta y consulta su nombre, correo y cargo.",
                  ],
                  [
                    "leadSearchAllowed",
                    "Leads",
                    "Busca leads asociados a una cuenta y consulta su nombre y estado.",
                  ],
                  [
                    "opportunitySearchAllowed",
                    "Oportunidades y pipeline",
                    "Consulta oportunidades de la cuenta, su etapa, estado y activación; algunas lecturas requieren permisos adicionales.",
                  ],
                  [
                    "quotationSearchAllowed",
                    "Cotizaciones",
                    "Consulta cotizaciones accesibles y sus partidas comerciales; no muestra costos internos ni márgenes.",
                  ],
                ].map(([field, label, description]) => {
                  const channelForbidsDomain =
                    coachBusinessRulesChannel === "prospect" &&
                    [
                      "contactSearchAllowed",
                      "leadSearchAllowed",
                      "opportunitySearchAllowed",
                      "quotationSearchAllowed",
                    ].includes(field);
                  return (
                    <div
                      className="mi-agent-domain-option"
                      key={field}
                    >
                      <label>
                        <input
                          type="checkbox"
                          checked={
                            selectedCoachBusinessRules.scope?.[
                              field
                            ] !== false
                          }
                          disabled={channelForbidsDomain}
                          onChange={(event) =>
                            updateCoachBusinessRuleField(
                              "scope",
                              field,
                              event.target.checked,
                            )
                          }
                        />
                        {label}
                        {channelForbidsDomain
                          ? " · no disponible en este canal"
                          : ""}
                      </label>
                      <small>{description}</small>
                    </div>
                  );
                })}
              </fieldset>
              <fieldset className="mi-agent-domain-stage-group">
                <legend>
                  Operaciones que este canal puede proponer
                </legend>
                {(
                  COACH_OPERATION_OPTIONS[
                    coachBusinessRulesChannel
                  ] || []
                ).map(([kind, label]) => (
                  <div
                    className="mi-agent-operation-policy-option"
                    key={kind}
                  >
                    <label>
                      <input
                        type="checkbox"
                        checked={(
                          selectedCoachBusinessRules.operationPolicy
                            ?.allowedKinds || []
                        ).includes(kind)}
                        onChange={(event) =>
                          updateCoachOperationKind(
                            kind,
                            event.target.checked,
                          )
                        }
                      />
                      {label}
                    </label>
                    <small>
                      {COACH_OPERATION_DESCRIPTIONS[kind] ||
                        "La operación requiere revisión y confirmación."}
                    </small>
                  </div>
                ))}
              </fieldset>
            </div>
            <div className="mi-agent-workspace-actions">
              <button
                type="button"
                className="mi-agent-primary-button"
                onClick={saveCoachBusinessRules}
                disabled={coachGovernanceSaving}
              >
                {coachBusinessRulesChannel === "coach" &&
                coachBusinessRulesProcess !== "default"
                  ? "Guardar ajuste de intención"
                  : coachBusinessRulesChannel === "coach"
                    ? "Guardar configuración general"
                    : "Guardar políticas del canal"}
              </button>
            </div>
          </div>
        </section>
          </>
        )}
      </div>
    </details>
  );
}
