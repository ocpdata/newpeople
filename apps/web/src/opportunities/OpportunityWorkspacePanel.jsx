/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from "react";
import { api, getApiErrorMessage } from "../api";

const WEAKNESS_STATUS_OPTIONS = [
  { value: "open", label: "Abierta" },
  { value: "mitigating", label: "Mitigandose" },
  { value: "accepted", label: "Aceptada" },
  { value: "resolved", label: "Resuelta" },
];

const SUPPORT_LEVEL_OPTIONS = [
  { value: "blocker", label: "Bloqueador" },
  { value: "resistant", label: "Resistente" },
  { value: "neutral", label: "Neutral" },
  { value: "supporter", label: "Aliado" },
  { value: "champion", label: "Champion" },
];

const STAKEHOLDER_STATUS_OPTIONS = [
  { value: "unknown", label: "Desconocido" },
  { value: "identified", label: "Identificado" },
  { value: "engaged", label: "En conversacion" },
  { value: "validated", label: "Validado" },
];

const ACTION_STATUS_OPTIONS = [
  { value: "pending", label: "Pendiente" },
  { value: "in_progress", label: "En curso" },
  { value: "blocked", label: "Bloqueada" },
  { value: "done", label: "Hecha" },
];

const PRIORITY_OPTIONS = [
  { value: "low", label: "Baja" },
  { value: "medium", label: "Media" },
  { value: "high", label: "Alta" },
];

const DELIVERABLE_STATUS_OPTIONS = [
  { value: "missing", label: "Faltante" },
  { value: "draft", label: "Borrador" },
  { value: "sent", label: "Enviado" },
  { value: "validated", label: "Validado" },
];

const STRATEGY_VISIBLE_STEPS = 4;

function formatOpportunityScore(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return null;
  const scaledValue = Math.max(0, Math.min(10, (numericValue / 3) * 10));
  return Number(scaledValue.toFixed(1));
}

function derivePurchaseMaturity({ budgetItem, decidersItem, currentStage }) {
  const score =
    Number(budgetItem?.score || 0) +
    Number(decidersItem?.score || 0) +
    (currentStage?.isValidated ? 2 : 0);

  if (score >= 7) {
    return {
      label: "Alta",
      tone: "green",
      summary:
        "La compra ya tiene respaldo suficiente en presupuesto, actores y avance de etapa.",
    };
  }

  if (score >= 4) {
    return {
      label: "Media",
      tone: "amber",
      summary:
        "La oportunidad ya muestra traccion de compra, pero todavia depende de cerrar vacios tacticos.",
    };
  }

  return {
    label: "Baja",
    tone: "red",
    summary:
      "La madurez de compra sigue debil: aun no hay claridad suficiente para sostener el cierre.",
  };
}

function getToneClass(tone) {
  return tone ? `is-${tone}` : "";
}

function getStrategyStepMeta(step) {
  const haystack = `${step?.title || ""} ${step?.text || ""}`.toLowerCase();

  if (
    /presupuesto|economica|economico|roi|dinero|inversion|precio/.test(haystack)
  ) {
    return {
      tone: "budget",
      badge: "US$",
      label: "Presupuesto",
    };
  }

  if (/decisor|politic|influencia|sponsor|aprobador|veto/.test(haystack)) {
    return {
      tone: "deciders",
      badge: "ORG",
      label: "Decisores",
    };
  }

  if (
    /urgencia|ritmo|avance|siguiente paso|forecast|decision|cierre/.test(
      haystack,
    )
  ) {
    return {
      tone: "urgency",
      badge: "NOW",
      label: "Urgencia",
    };
  }

  if (/riesgo|debilidad|contencion|competencia|alerta|brecha/.test(haystack)) {
    return {
      tone: "risk",
      badge: "R!",
      label: "Riesgo",
    };
  }

  return {
    tone: "execution",
    badge: "GO",
    label: "Ejecucion",
  };
}

function buildDefaultThemeNote(themes) {
  return {
    themeCode: themes[0]?.code || "need",
    claim: "",
    status: "supported",
    confidence: "medium",
    evidenceExcerpt: "",
  };
}

function StageSummaryCard({ stage, isCurrent }) {
  const statusClass = stage.isValidated
    ? "solid"
    : stage.status || "not_started";
  const stageStatusLabel = stage.isValidated
    ? "Validada"
    : stage.status === "in_progress"
      ? "En curso"
      : stage.status === "blocked"
        ? "Bloqueada"
        : stage.status === "conditional"
          ? "Con reservas"
          : "Sin iniciar";
  return (
    <article
      className={`opportunity-workspace-stage-chip status-${statusClass}${isCurrent ? " is-current is-selected" : ""}`}
    >
      <div className="opportunity-workspace-stage-chip-top">
        <strong>{stage.stageName}</strong>
        <span
          className={`opportunity-workspace-stage-chip-badge status-${statusClass}`}
        >
          {stageStatusLabel}
        </span>
      </div>
      <div className="opportunity-workspace-stage-chip-metrics">
        <span className="opportunity-workspace-stage-chip-pill">
          {Math.round(Number(stage.completionRatio || 0) * 100)}% avance
        </span>
        <span className="opportunity-workspace-stage-chip-pill is-alert">
          {Number(stage.weaknessCount || 0)} alertas
        </span>
      </div>
      <p>{stage.objective}</p>
    </article>
  );
}

export default function OpportunityWorkspacePanel({
  opportunityId,
  commercialContext,
  isReadOnly,
  isCommercialFlowClosed,
  onRefresh,
}) {
  const [savingKey, setSavingKey] = useState("");
  const [weaknessDrafts, setWeaknessDrafts] = useState({});
  const [, setActionDrafts] = useState({});
  const [, setDeliverableDrafts] = useState({});
  const [, setNewThemeNote] = useState({
    themeCode: "need",
    claim: "",
    status: "supported",
    confidence: "medium",
    evidenceExcerpt: "",
  });
  const [isWorkspaceExpanded, setIsWorkspaceExpanded] = useState(true);
  const [isWeaknessPanelExpanded, setIsWeaknessPanelExpanded] = useState(true);
  const [isStrategyPanelExpanded, setIsStrategyPanelExpanded] = useState(true);
  const [isStrategyStepsExpanded, setIsStrategyStepsExpanded] = useState(false);

  const workspace = commercialContext?.workspace || null;
  const stages = Array.isArray(workspace?.stages) ? workspace.stages : [];
  const currentStage = workspace?.currentStage || null;
  const stagesById = new Map(
    stages
      .filter((stage) => Number(stage.stageId || 0) > 0)
      .map((stage) => [Number(stage.stageId), stage]),
  );
  const stagesByCode = new Map(
    stages
      .filter((stage) => String(stage.code || "").trim())
      .map((stage) => [String(stage.code), stage]),
  );
  const themes = Array.isArray(workspace?.themes) ? workspace.themes : [];
  const weaknesses = Array.isArray(workspace?.weaknesses)
    ? workspace.weaknesses
    : [];
  const actions = Array.isArray(workspace?.actions) ? workspace.actions : [];
  const deliverables = Array.isArray(workspace?.deliverables)
    ? workspace.deliverables
    : [];
  const scorecardItems = Array.isArray(workspace?.scorecard?.items)
    ? workspace.scorecard.items
    : [];
  const urgencyItem =
    scorecardItems.find((item) => item.key === "urgency") || null;
  const budgetItem =
    scorecardItems.find((item) => item.key === "budget") || null;
  const decidersItem =
    scorecardItems.find((item) => item.key === "deciders") || null;
  const noDecisionRiskItem =
    scorecardItems.find((item) => item.key === "no_decision_risk") || null;
  const purchaseMaturity = derivePurchaseMaturity({
    budgetItem,
    decidersItem,
    currentStage,
  });
  const opportunityScore = formatOpportunityScore(
    workspace?.scorecard?.averageScore,
  );
  const recommendedStrategy = workspace?.recommendedStrategy || {
    heading:
      "La estrategia recomendada aun no esta disponible para esta oportunidad.",
    route: "Pendiente",
    finalObjective:
      "Completa o actualiza informacion comercial para regenerar la estrategia.",
    steps: [],
  };
  const visibleStrategySteps = isStrategyStepsExpanded
    ? recommendedStrategy.steps
    : recommendedStrategy.steps.slice(0, STRATEGY_VISIBLE_STEPS);
  const hiddenStrategyStepsCount = Math.max(
    recommendedStrategy.steps.length - visibleStrategySteps.length,
    0,
  );

  useEffect(() => {
    const nextDrafts = {};
    weaknesses.forEach((item) => {
      if (item.isAutoGenerated) return;
      nextDrafts[item.id] = {
        status: item.status,
        mitigationPlan: item.mitigationPlan || "",
        dueDate: item.dueDate || "",
      };
    });
    setWeaknessDrafts(nextDrafts);
  }, [workspace?.weaknesses]);

  useEffect(() => {
    const nextDrafts = {};
    actions.forEach((item) => {
      nextDrafts[item.id] = {
        status: item.status,
        dueDate: item.dueDate || "",
        notes: item.notes || "",
      };
    });
    setActionDrafts(nextDrafts);
  }, [workspace?.actions]);

  useEffect(() => {
    const nextDrafts = {};
    deliverables.forEach((item) => {
      nextDrafts[item.id] = {
        status: item.status,
        versionLabel: item.versionLabel || "",
        outcomeSummary: item.outcomeSummary || "",
      };
    });
    setDeliverableDrafts(nextDrafts);
  }, [workspace?.deliverables]);
  useEffect(() => {
    setNewThemeNote(buildDefaultThemeNote(themes));
  }, [workspace?.themes]);

  async function postWorkspace(path, payload) {
    setSavingKey(path);
    try {
      await api.post(
        `/api/opportunities/${opportunityId}/workspace/${path}`,
        payload,
      );
      await onRefresh?.();
    } catch (error) {
      console.error(
        getApiErrorMessage(error, "No fue posible actualizar el workspace"),
      );
    } finally {
      setSavingKey("");
    }
  }

  async function deleteWorkspace(path, itemId) {
    if (
      !window.confirm("Se eliminara este registro del workspace. ¿Continuar?")
    ) {
      return;
    }
    setSavingKey(`${path}:delete:${itemId}`);
    try {
      await api.delete(
        `/api/opportunities/${opportunityId}/workspace/${path}/${itemId}`,
      );
      await onRefresh?.();
    } catch (error) {
      console.error(
        getApiErrorMessage(error, "No fue posible eliminar el registro"),
      );
    } finally {
      setSavingKey("");
    }
  }

  if (!workspace) {
    return null;
  }

  function renderCollapseButton({
    isExpanded,
    onToggle,
    expandLabel,
    collapseLabel,
    controlsId,
  }) {
    return (
      <button
        type="button"
        className="opportunity-workspace-collapse-button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-controls={controlsId}
      >
        <span>{isExpanded ? collapseLabel : expandLabel}</span>
        <span aria-hidden="true">{isExpanded ? "−" : "+"}</span>
      </button>
    );
  }

  return (
    <section className="opportunity-workspace-shell">
      <div className="opportunity-workspace-header">
        <div>
          <h5>Workspace comercial</h5>
          <p className="field-hint">
            Lectura posterior a las respuestas de la etapa para resumir salud,
            brechas y riesgos visibles de la oportunidad.
          </p>
        </div>
        <div className="opportunity-workspace-header-actions">
          <div className="opportunity-workspace-playbook-meta">
            <span className="record-id-badge">
              {workspace.playbook?.name || "Playbook"}
            </span>
            <span className="record-id-badge">
              {workspace.playbook?.version || "v1"} |{" "}
              {workspace.playbook?.stageCount || 0} etapas |{" "}
              {workspace.playbook?.criteriaCount || 0} criterios
            </span>
          </div>
          {renderCollapseButton({
            isExpanded: isWorkspaceExpanded,
            onToggle: () => setIsWorkspaceExpanded((value) => !value),
            expandLabel: "Expandir workspace",
            collapseLabel: "Contraer workspace",
            controlsId: "opportunity-workspace-content",
          })}
        </div>
      </div>

      {isWorkspaceExpanded ? (
        <>
          <div
            id="opportunity-workspace-content"
            className="opportunity-workspace-overview"
          >
        <section className="opportunity-workspace-panel">
          <div className="opportunity-workspace-panel-header">
            <div>
              <h6>Panel Resumen Ejecutivo</h6>
              <p className="field-hint">
                Lectura rapida de salud, urgencia, madurez de compra y riesgo de
                estancamiento.
              </p>
            </div>
            <span
              className={`record-id-badge ${getToneClass(workspace.summary?.health?.overallTone)}`}
            >
              Semaforo general: {workspace.summary?.health?.overallLabel || "-"}
            </span>
          </div>

          <div className="opportunity-workspace-summary-grid opportunity-workspace-summary-grid-executive">
            {[
              {
                label: "Salud de la oportunidad",
                value: workspace.summary?.health?.overallLabel || "-",
                tone: workspace.summary?.health?.overallTone,
                summary:
                  workspace.summary?.health?.summary ||
                  "No hay lectura de salud disponible para la oportunidad.",
              },
              {
                label: "Urgencia real",
                value: urgencyItem?.statusLabel || "-",
                tone: urgencyItem?.tone,
                summary:
                  urgencyItem?.summary ||
                  "No hay lectura de urgencia disponible.",
              },
              {
                label: "Madurez de compra",
                value: purchaseMaturity?.label || "-",
                tone: purchaseMaturity?.tone,
                summary:
                  purchaseMaturity?.summary ||
                  "No hay lectura de madurez de compra disponible.",
              },
              {
                label: "Riesgo de estancamiento",
                value: noDecisionRiskItem?.statusLabel || "-",
                tone: noDecisionRiskItem?.tone,
                summary:
                  noDecisionRiskItem?.summary ||
                  "No hay lectura de riesgo de estancamiento disponible.",
              },
              {
                label: "Score de oportunidad",
                value:
                  opportunityScore === null ? "-" : `${opportunityScore}/10`,
                tone: workspace.summary?.health?.overallTone,
                summary:
                  opportunityScore === null
                    ? "No hay score consolidado disponible para la oportunidad."
                    : "Escala 0-10 basada en el scorecard actual y alineada con la salud general de la oportunidad.",
              },
            ].map((item) => (
              <article
                key={item.label}
                className={`opportunity-workspace-summary-card ${getToneClass(item.tone)}`}
              >
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <p>{item.summary}</p>
              </article>
            ))}
          </div>
        </section>

        {stages.length ? (
          <div className="opportunity-workspace-stage-strip">
            {stages.map((stage) => (
              <StageSummaryCard
                key={stage.code}
                stage={stage}
                isCurrent={stage.code === currentStage?.code}
              />
            ))}
          </div>
        ) : null}
          </div>

          <section className="opportunity-workspace-panel">
            <div className="opportunity-workspace-panel-header">
              <h6>Panel Scorecard</h6>
              <span
                className={`record-id-badge ${getToneClass(workspace.scorecard?.overallTone)}`}
              >
                Solidez global {workspace.summary?.health?.overallLabel || "-"}
              </span>
            </div>
            <div className="opportunity-workspace-scorecard-grid">
              {scorecardItems.map((item) => (
                <article
                  key={item.key}
                  className={`opportunity-workspace-scorecard-card ${getToneClass(item.tone)}`}
                >
                  <strong>{item.label}</strong>
                  <span>Estado: {item.statusLabel}</span>
                  <span>
                    Senales cubiertas: {item.checkedCount || 0}/
                    {item.totalCount || 0}
                  </span>
                  <p>{item.summary}</p>
                  <div className="opportunity-workspace-audit-checklist">
                    {(item.checklist || []).map((entry) => (
                      <div
                        key={`${item.key}:${entry.key}`}
                        className={`opportunity-workspace-audit-checklist-item ${
                          entry.checked ? "is-checked" : "is-unchecked"
                        }`}
                      >
                        <strong>{entry.checked ? "Cubierto" : "Falta"}</strong>
                        <span>{entry.label}</span>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="opportunity-workspace-panel opportunity-workspace-weakness-panel">
        <div className="opportunity-workspace-panel-header">
          <div>
            <h6>Panel Debilidades y Riesgos</h6>
            <span className="field-hint">Manual y auto detectadas</span>
          </div>
          {renderCollapseButton({
            isExpanded: isWeaknessPanelExpanded,
            onToggle: () => setIsWeaknessPanelExpanded((value) => !value),
            expandLabel: "Expandir panel",
            collapseLabel: "Contraer panel",
            controlsId: "opportunity-workspace-weakness-content",
          })}
        </div>

            {isWeaknessPanelExpanded ? (
              <div
                id="opportunity-workspace-weakness-content"
                className="opportunity-workspace-side-list opportunity-workspace-weakness-grid"
              >
          {weaknesses.map((item) => {
            const draft = weaknessDrafts[item.id] || {
              status: item.status,
              mitigationPlan: item.mitigationPlan || "",
              dueDate: item.dueDate || "",
            };
            const weaknessStage = item.salesStageId
              ? stagesById.get(Number(item.salesStageId)) || null
              : item.salesStageCode
                ? stagesByCode.get(String(item.salesStageCode)) || null
                : null;
            const isCurrentStageWeakness = Boolean(weaknessStage?.isCurrent);
            const isPendingValidationWeakness = Boolean(
              isCurrentStageWeakness && !weaknessStage?.isValidated,
            );
            return (
              <article
                key={item.id}
                className="opportunity-workspace-side-card opportunity-workspace-weakness-card"
              >
                <div className="opportunity-workspace-side-card-header">
                  <strong>{item.title}</strong>
                  <span className={`record-id-badge severity-${item.severity}`}>
                    {item.severity}
                  </span>
                </div>
                {weaknessStage ? (
                  <div className="opportunity-workspace-inline-actions">
                    <span className="record-id-badge">
                      {weaknessStage.stageName}
                    </span>
                    {isCurrentStageWeakness ? (
                      <span className="record-id-badge status-in_progress">
                        Etapa en curso
                      </span>
                    ) : null}
                    {isPendingValidationWeakness ? (
                      <span className="record-id-badge status-conditional">
                        Pendiente de validacion
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <p>{item.detail || item.mitigationPlan || "Sin detalle"}</p>
                {item.isAutoGenerated ? (
                  <span className="field-hint">
                    Brecha detectada automaticamente a partir de criterios
                    faltantes de la etapa
                  </span>
                ) : (
                  <>
                    <select
                      value={draft.status}
                      disabled={isReadOnly || isCommercialFlowClosed}
                      onChange={(event) =>
                        setWeaknessDrafts((prev) => ({
                          ...prev,
                          [item.id]: {
                            ...draft,
                            status: event.target.value,
                          },
                        }))
                      }
                    >
                      {WEAKNESS_STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <textarea
                      rows={2}
                      value={draft.mitigationPlan}
                      disabled={isReadOnly || isCommercialFlowClosed}
                      onChange={(event) =>
                        setWeaknessDrafts((prev) => ({
                          ...prev,
                          [item.id]: {
                            ...draft,
                            mitigationPlan: event.target.value,
                          },
                        }))
                      }
                    />
                    <input
                      type="date"
                      value={draft.dueDate || ""}
                      disabled={isReadOnly || isCommercialFlowClosed}
                      onChange={(event) =>
                        setWeaknessDrafts((prev) => ({
                          ...prev,
                          [item.id]: {
                            ...draft,
                            dueDate: event.target.value,
                          },
                        }))
                      }
                    />
                    <div className="opportunity-workspace-inline-actions">
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={savingKey === "weaknesses"}
                        onClick={() =>
                          postWorkspace(
                            "weaknesses",
                            {
                              id: item.id,
                              title: item.title,
                              category: item.category,
                              severity: item.severity,
                              status: draft.status,
                              salesStageId: item.salesStageId,
                              themeCode: item.themeCode,
                              detail: item.detail,
                              mitigationPlan: draft.mitigationPlan,
                              ownerUserId: item.ownerUserId,
                              dueDate: draft.dueDate || null,
                              resolvedNote: item.resolvedNote || "",
                            },
                            "Debilidad actualizada",
                          )
                        }
                      >
                        Guardar
                      </button>
                      <button
                        type="button"
                        className="btn-danger"
                        disabled={savingKey === `weaknesses:delete:${item.id}`}
                        onClick={() =>
                          deleteWorkspace(
                            "weaknesses",
                            item.id,
                            "Debilidad eliminada",
                          )
                        }
                      >
                        Eliminar
                      </button>
                    </div>
                  </>
                )}
              </article>
            );
          })}
              </div>
            ) : null}
          </section>

          <section className="opportunity-workspace-panel">
        <div className="opportunity-workspace-panel-header">
          <div>
            <h6>Estrategia recomendada</h6>
            <span className="field-hint">Ruta sugerida hasta la venta</span>
          </div>
          {renderCollapseButton({
            isExpanded: isStrategyPanelExpanded,
            onToggle: () => setIsStrategyPanelExpanded((value) => !value),
            expandLabel: "Expandir estrategia",
            collapseLabel: "Contraer estrategia",
            controlsId: "opportunity-workspace-strategy-content",
          })}
        </div>
            {isStrategyPanelExpanded ? (
              <div
                id="opportunity-workspace-strategy-content"
                className="opportunity-workspace-strategy-layout"
              >
          <article className="opportunity-workspace-side-card opportunity-workspace-strategy-hero">
            <div className="opportunity-workspace-side-card-header">
              <div className="opportunity-workspace-strategy-heading">
                <span className="opportunity-workspace-strategy-eyebrow">
                  Plan de avance comercial
                </span>
                <strong>Como avanzar desde aqui</strong>
              </div>
              <span
                className={`record-id-badge ${getToneClass(purchaseMaturity?.tone)}`}
              >
                Madurez {purchaseMaturity?.label || "-"}
              </span>
            </div>
            <p>{recommendedStrategy.heading}</p>
            <div className="opportunity-workspace-strategy-meta-grid">
              <div className="opportunity-workspace-strategy-meta-card">
                <span>Ruta esperada</span>
                <strong>{recommendedStrategy.route}</strong>
              </div>
              <div className="opportunity-workspace-strategy-meta-card">
                <span>Objetivo inmediato</span>
                <strong>{recommendedStrategy.finalObjective}</strong>
              </div>
              <div className="opportunity-workspace-strategy-meta-card">
                <span>Foco inicial</span>
                <strong>
                  {Math.min(
                    STRATEGY_VISIBLE_STEPS,
                    recommendedStrategy.steps.length,
                  )}{" "}
                  prioridades para mover la venta ahora
                </strong>
              </div>
            </div>
            <p className="opportunity-workspace-strategy-caption">
              La secuencia esta ordenada por impacto comercial para enfocar al
              equipo primero en lo que mas mueve la venta.
            </p>
          </article>
          <div className="opportunity-workspace-strategy-steps">
            {visibleStrategySteps.map((step, index) => {
              const stepMeta = getStrategyStepMeta(step);

              return (
                <article
                  key={`strategy-step:${index + 1}`}
                  className={`opportunity-workspace-strategy-step opportunity-workspace-strategy-step-${stepMeta.tone}${index === 0 ? " is-primary" : ""}`}
                >
                  <div className="opportunity-workspace-strategy-step-index">
                    {index + 1}
                  </div>
                  <div className="opportunity-workspace-strategy-step-copy">
                    <div className="opportunity-workspace-strategy-step-topline">
                      <span>{step.priorityLabel}</span>
                      <div className="opportunity-workspace-strategy-step-tags">
                        <span className="opportunity-workspace-strategy-step-badge">
                          {stepMeta.badge}
                        </span>
                        <span
                          className={`opportunity-workspace-strategy-step-type is-${stepMeta.tone}`}
                        >
                          {stepMeta.label}
                        </span>
                      </div>
                    </div>
                    <strong>{step.title}</strong>
                    <p>{step.text}</p>
                  </div>
                </article>
              );
            })}
            {!visibleStrategySteps.length ? (
              <article className="opportunity-workspace-strategy-step opportunity-workspace-strategy-step-execution is-primary">
                <div className="opportunity-workspace-strategy-step-index">
                  1
                </div>
                <div className="opportunity-workspace-strategy-step-copy">
                  <div className="opportunity-workspace-strategy-step-topline">
                    <span>Prioridad inicial</span>
                    <div className="opportunity-workspace-strategy-step-tags">
                      <span className="opportunity-workspace-strategy-step-badge">
                        GO
                      </span>
                      <span className="opportunity-workspace-strategy-step-type is-execution">
                        Ejecucion
                      </span>
                    </div>
                  </div>
                  <strong>Actualizar lectura comercial</strong>
                  <p>
                    Aun no hay suficientes senales para construir una ruta de
                    avance detallada. Completa respuestas o refresca el
                    workspace para generar una nueva estrategia.
                  </p>
                </div>
              </article>
            ) : null}
          </div>
          {recommendedStrategy.steps.length > STRATEGY_VISIBLE_STEPS ? (
            <div className="opportunity-workspace-strategy-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setIsStrategyStepsExpanded((value) => !value)}
              >
                {isStrategyStepsExpanded
                  ? "Ver menos prioridades"
                  : `Ver ${hiddenStrategyStepsCount} prioridades mas`}
              </button>
            </div>
          ) : null}
              </div>
            ) : null}
          </section>

          <div className="opportunity-workspace-layout"></div>
        </>
      ) : null}
    </section>
  );
}
