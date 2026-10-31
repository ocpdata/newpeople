import { COACH_OPPORTUNITY_STAGE_OPTIONS } from "./miAgentConstants";

export function GovernanceSettingsSection({ coachGovernance, coachGovernanceSaving, saveCoachGovernance, setCoachGovernance, updateOpportunityStageSet }) {
  return (
    <details
      className="mi-agent-governance-settings"
      aria-labelledby="mi-agent-governance-settings-title"
    >
      <summary className="mi-agent-governance-settings-summary">
        <strong
          id="mi-agent-governance-settings-title"
          role="heading"
          aria-level={4}
        >
          Configuración de gobierno
        </strong>
        <span>
          Ajusta límites globales y banderas generales de la
          organización.
        </span>
      </summary>
      <div className="mi-agent-governance-settings-content">
        <section className="mi-agent-pipeline-governance">
          <div>
            <span className="mi-agent-section-label">
              Configuración global
            </span>
            <h4>Etapas del pipeline calificado y comprometido</h4>
            <p>
              Elige qué etapas se incluyen en cada indicador. Esto se
              aplica a toda la organización, no al canal ni al tipo de
              consulta seleccionado. Una oportunidad abierta se define
              por estar activada y En proceso; esta selección no
              cambia esa regla.
            </p>
          </div>
          <div className="mi-agent-domain-policy-groups">
            {[
              {
                key: "qualifiedOpportunityStageCodes",
                title: "Etapas que cuentan en el pipeline calificado",
                selected:
                  coachGovernance.settings
                    .qualifiedOpportunityStageCodes || [],
              },
              {
                key: "committedOpportunityStageCodes",
                title: "Etapas que cuentan en el monto comprometido",
                selected:
                  coachGovernance.settings
                    .committedOpportunityStageCodes || [],
              },
            ].map((group) => (
              <fieldset
                className="mi-agent-domain-stage-group"
                key={group.key}
              >
                <legend>{group.title}</legend>
                {COACH_OPPORTUNITY_STAGE_OPTIONS.map((stage) => {
                  const isQualified = (
                    coachGovernance.settings
                      .qualifiedOpportunityStageCodes || []
                  ).includes(stage.code);
                  return (
                    <label key={`${group.key}-${stage.code}`}>
                      <input
                        type="checkbox"
                        checked={group.selected.includes(stage.code)}
                        disabled={
                          (group.key ===
                            "committedOpportunityStageCodes" &&
                            !isQualified) ||
                          (group.selected.length === 1 &&
                            group.selected.includes(stage.code))
                        }
                        onChange={(event) =>
                          updateOpportunityStageSet(
                            group.key,
                            stage.code,
                            event.target.checked,
                          )
                        }
                      />
                      {stage.label}
                    </label>
                  );
                })}
              </fieldset>
            ))}
          </div>
          <p className="mi-agent-scope-help">
            Se guarda con el botón «Guardar configuración» de esta
            sección.
          </p>
        </section>
        <div className="mi-agent-governance-grid">
          <label>
            Fuentes externas habilitadas
            <input
              type="checkbox"
              checked={Boolean(
                coachGovernance.settings.externalSourcesEnabled,
              )}
              onChange={(event) =>
                setCoachGovernance((current) => ({
                  ...current,
                  settings: {
                    ...current.settings,
                    externalSourcesEnabled: event.target.checked,
                  },
                }))
              }
            />
          </label>
          <label>
            Conversiones de prospección habilitadas
            <input
              type="checkbox"
              checked={Boolean(
                coachGovernance.settings.allowProspectConversion,
              )}
              onChange={(event) =>
                setCoachGovernance((current) => ({
                  ...current,
                  settings: {
                    ...current.settings,
                    allowProspectConversion: event.target.checked,
                  },
                }))
              }
            />
          </label>
          <label>
            Confirmar notas y cambios de datos (oportunidad, cuenta y contacto) desde el chat de Cliente existente
            <input
              type="checkbox"
              checked={Boolean(
                coachGovernance.settings.customerChatConfirmationEnabled,
              )}
              onChange={(event) =>
                setCoachGovernance((current) => ({
                  ...current,
                  settings: {
                    ...current.settings,
                    customerChatConfirmationEnabled: event.target.checked,
                  },
                }))
              }
            />
          </label>
          <label>
            Incluir oportunidades ganadas
            <input
              type="checkbox"
              checked={Boolean(
                coachGovernance.settings.includeWonOpportunities,
              )}
              onChange={(event) =>
                setCoachGovernance((current) => ({
                  ...current,
                  settings: {
                    ...current.settings,
                    includeWonOpportunities: event.target.checked,
                  },
                }))
              }
            />
          </label>
          <label>
            Incluir oportunidades perdidas
            <input
              type="checkbox"
              checked={Boolean(
                coachGovernance.settings.includeLostOpportunities,
              )}
              onChange={(event) =>
                setCoachGovernance((current) => ({
                  ...current,
                  settings: {
                    ...current.settings,
                    includeLostOpportunities: event.target.checked,
                  },
                }))
              }
            />
          </label>
          <label>
            Incluir oportunidades anuladas
            <input
              type="checkbox"
              checked={Boolean(
                coachGovernance.settings
                  .includeCancelledOpportunities,
              )}
              onChange={(event) =>
                setCoachGovernance((current) => ({
                  ...current,
                  settings: {
                    ...current.settings,
                    includeCancelledOpportunities:
                      event.target.checked,
                  },
                }))
              }
            />
          </label>
          <label>
            Límite diario de investigación por usuario
            <input
              type="number"
              min="1"
              max="500"
              value={
                coachGovernance.settings.dailyResearchLimitPerUser
              }
              onChange={(event) =>
                setCoachGovernance((current) => ({
                  ...current,
                  settings: {
                    ...current.settings,
                    dailyResearchLimitPerUser: Number(
                      event.target.value,
                    ),
                  },
                }))
              }
            />
          </label>
          <label>
            Retención de hallazgos (días)
            <input
              type="number"
              min="30"
              max="3650"
              value={coachGovernance.settings.findingRetentionDays}
              onChange={(event) =>
                setCoachGovernance((current) => ({
                  ...current,
                  settings: {
                    ...current.settings,
                    findingRetentionDays: Number(event.target.value),
                  },
                }))
              }
            />
          </label>
          <label className="mi-agent-governance-wide">
            Notas
            <textarea
              value={coachGovernance.settings.notes || ""}
              onChange={(event) =>
                setCoachGovernance((current) => ({
                  ...current,
                  settings: {
                    ...current.settings,
                    notes: event.target.value,
                  },
                }))
              }
            />
          </label>
        </div>
        <div className="mi-agent-workspace-actions">
          <button
            type="button"
            className="mi-agent-primary-button"
            onClick={saveCoachGovernance}
            disabled={coachGovernanceSaving}
          >
            {coachGovernanceSaving
              ? "Guardando..."
              : "Guardar configuración"}
          </button>
        </div>
      </div>
    </details>
  );
}
