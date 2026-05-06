import { useCallback, useEffect, useMemo, useState } from "react";
import { api, getApiErrorMessage } from "./api";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatCurrency(value, currency = "USD") {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "Sin dato";
  }
  return `${Number(value).toFixed(0)}%`;
}

function formatDate(value) {
  if (!value) return "Sin fecha";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Sin fecha";
  return parsed.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function toIsoDate(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function getQuarterDateRange(period) {
  const year = Number(period?.year || 0);
  const quarter = Number(period?.quarter || 0);
  if (!year || quarter < 1 || quarter > 4) return null;
  const start = new Date(Date.UTC(year, (quarter - 1) * 3, 1));
  const end = new Date(Date.UTC(year, quarter * 3, 0));
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function isDateWithinPeriod(value, period) {
  const isoDate = toIsoDate(value);
  const range = getQuarterDateRange(period);
  if (!isoDate || !range) return false;
  return isoDate >= range.startDate && isoDate <= range.endDate;
}

function getRiskToneClass(level) {
  if (level === "high") return "is-high";
  if (level === "medium") return "is-medium";
  return "is-low";
}

function getRiskLabel(level) {
  if (level === "high") return "Riesgo alto";
  if (level === "medium") return "Riesgo medio";
  return "Controlado";
}

function getToneClass(tone) {
  if (tone === "high") return "is-high";
  if (tone === "medium") return "is-medium";
  return "is-low";
}

function getCadenceDecisionLabel(value) {
  if (value === "activate") return "Activar";
  if (value === "watch") return "Vigilar";
  return "Pendiente";
}

function getRecommendedNextMoveTitle(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.title || value.text || "";
}

function isCommittedStage(stageCode) {
  return stageCode === "negociacion" || stageCode === "waiting";
}

function getRiskRank(level) {
  if (level === "high") return 0;
  if (level === "medium") return 1;
  return 2;
}

function getCoverageKind(item) {
  return isCommittedStage(item?.stageCode) ? "committed" : "weighted";
}

function getRawCoverageAmount(item) {
  if (getCoverageKind(item) === "committed") {
    return Number(item?.amountUsd || 0);
  }
  return Number(item?.amountUsd || 0) * (Number(item?.stageConfidence || 0) / 100);
}

function getPrimaryBlocker(item) {
  const overdueDependency = asArray(item?.dependencies).find(
    (dependency) => dependency?.isOverdue,
  );
  if (overdueDependency?.title) {
    return `Dependencia vencida: ${overdueDependency.title}`;
  }

  const blockingDependency = asArray(item?.dependencies).find(
    (dependency) => dependency?.status !== "resolved",
  );
  if (blockingDependency?.title) {
    return `${blockingDependency.dependencyLabel || "Dependencia"}: ${blockingDependency.title}`;
  }

  if (asArray(item?.riskReasons).length) {
    return item.riskReasons[0];
  }

  if (!item?.nextStep) {
    return "No hay siguiente paso registrado.";
  }

  return "Sin bloqueo crítico visible.";
}

function getCoverageReadout({ gapAmount, committedAmount, weightedAdditionalAmount }) {
  if (!(gapAmount > 0)) {
    return "La cuota ya está cubierta en real; ahora toca proteger cierres, margen y expansión.";
  }

  if (committedAmount >= gapAmount) {
    return "La brecha puede cerrarse con oportunidades ya comprometidas si se ejecutan bien.";
  }

  if (committedAmount + weightedAdditionalAmount >= gapAmount) {
    return "Lo comprometido no alcanza; necesitas convertir también oportunidades en maduración.";
  }

  return "Ni lo comprometido ni la cobertura ponderada actual alcanzan la cuota; hace falta abrir o acelerar pipeline.";
}

function buildNextStepDraft(item) {
  const dueDate = item?.nextStep?.dueDate
    ? String(item.nextStep.dueDate).slice(0, 10)
    : new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  return {
    opportunityId: item?.id || null,
    title:
      item?.nextStep?.title ||
      getRecommendedNextMoveTitle(item?.recommendedNextMove) ||
      "",
    actionType: item?.nextStep?.actionType || "follow_up",
    dueDate,
    successCriteria: item?.nextStep?.successCriteria || "",
  };
}

function buildDependencyDraft(item) {
  return {
    opportunityId: item?.id || null,
    dependencyType: "presales_support",
    title: "",
    dueDate: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
    expectedOutcome: "",
    details: "",
  };
}

function normalizeDashboardResponse(data) {
  const workboard = asArray(data?.workboard).map((item) => ({
    ...item,
    riskReasons: asArray(item?.riskReasons),
    reminders: asArray(item?.reminders),
    dependencies: asArray(item?.dependencies),
    recommendedResources: asArray(item?.recommendedResources).map(
      (resource) => ({
        ...resource,
        assets: asArray(resource?.assets),
      }),
    ),
  }));

  return {
    summary:
      data?.summary && typeof data.summary === "object" ? data.summary : {},
    workboard,
    cadences: {
      active: asArray(data?.cadences?.active).map((item) => ({
        ...item,
        steps: asArray(item?.steps),
      })),
      suggested: asArray(data?.cadences?.suggested).map((item) => ({
        ...item,
        steps: asArray(item?.steps),
        frictionReasons: asArray(item?.frictionReasons),
      })),
    },
    development:
      data?.development && typeof data.development === "object"
        ? data.development
        : {
            period: null,
            periods: [],
            quota: {},
            sellerSnapshots: [],
            pipelineByStage: [],
            priorities: [],
            recommendations: [],
            actionsToday: [],
          },
  };
}

function SummaryMetric({ label, value, helper, tone }) {
  return (
    <article className={`commercial-development-metric ${tone || ""}`.trim()}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{helper}</p>
    </article>
  );
}

function DevelopmentHelp() {
  return (
    <details className="commercial-development-help">
      <summary
        className="commercial-development-help-trigger"
        aria-label="Ayuda sobre desarrollo comercial"
      >
        ?
      </summary>
      <div className="commercial-development-help-popover">
        <strong>Para qué sirve</strong>
        <p>
          Reúne en una sola vista la cuota trimestral, la cobertura real del
          pipeline, las oportunidades que más mueven resultado y las acciones
          concretas para empujar avance.
        </p>
      </div>
    </details>
  );
}

export default function CommercialDevelopmentPage() {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedPeriodKey, setSelectedPeriodKey] = useState("");
  const [selectedOpportunityId, setSelectedOpportunityId] = useState(null);
  const [nextStepDraft, setNextStepDraft] = useState(buildNextStepDraft(null));
  const [dependencyDraft, setDependencyDraft] = useState(
    buildDependencyDraft(null),
  );
  const [savingNextStep, setSavingNextStep] = useState(false);
  const [savingDependency, setSavingDependency] = useState(false);
  const [activatingCadenceKey, setActivatingCadenceKey] = useState("");

  const loadDashboard = useCallback(async (periodKey = "") => {
    setLoading(true);
    setError("");
    try {
      const params = {};
      if (periodKey) {
        const [year, quarter] = String(periodKey).split("-");
        params.year = Number(year);
        params.quarter = Number(quarter);
      }
      const response = await api.get("/api/commercial-development/dashboard", {
        params,
      });
      const nextDashboard = normalizeDashboardResponse(response.data);
      setDashboard(nextDashboard);
      const nextPeriodKey = nextDashboard.development?.period
        ? `${nextDashboard.development.period.year}-${nextDashboard.development.period.quarter}`
        : "";
      setSelectedPeriodKey((current) => current || nextPeriodKey);
      setSelectedOpportunityId((current) => {
        const priorityIds = asArray(nextDashboard.development?.priorities).map(
          (item) => item.id,
        );
        const fallbackId =
          priorityIds[0] || nextDashboard.workboard[0]?.id || null;
        if (
          current &&
          nextDashboard.workboard.some((item) => item.id === current)
        ) {
          return current;
        }
        return fallbackId;
      });
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar la vista de desarrollo comercial",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard(selectedPeriodKey);
  }, [loadDashboard, selectedPeriodKey]);

  const workboard = dashboard?.workboard || [];
  const development = dashboard?.development || {};
  const quota = development.quota || {};
  const priorities = development.priorities || [];
  const pipelineByStage = development.pipelineByStage || [];
  const recommendations = development.recommendations || [];
  const actionsToday = development.actionsToday || [];
  const periodOptions = development.periods || [];
  const currentPeriod = development.period || null;
  const selectedOpportunity = useMemo(() => {
    return (
      workboard.find((item) => item.id === selectedOpportunityId) ||
      priorities.find((item) => item.id === selectedOpportunityId) ||
      workboard[0] ||
      priorities[0] ||
      null
    );
  }, [priorities, selectedOpportunityId, workboard]);

  const selectedCadenceSuggestions = useMemo(
    () =>
      asArray(dashboard?.cadences?.suggested).filter(
        (item) => item.opportunityId === selectedOpportunity?.id,
      ),
    [dashboard?.cadences?.suggested, selectedOpportunity?.id],
  );

  const gapClosingView = useMemo(() => {
    const activeGapAmount = Number(quota.gapAmount || 0);
    const candidates = priorities
      .filter((item) => isDateWithinPeriod(item?.closeDate, currentPeriod))
      .map((item) => ({
        ...item,
        coverageKind: getCoverageKind(item),
        rawCoverageAmount: getRawCoverageAmount(item),
      }))
      .filter((item) => item.rawCoverageAmount > 0)
      .sort((left, right) => {
        const commitmentDelta =
          (left.coverageKind === "committed" ? 1 : 0) -
          (right.coverageKind === "committed" ? 1 : 0);
        if (commitmentDelta !== 0) {
          return -commitmentDelta;
        }
        if (right.rawCoverageAmount !== left.rawCoverageAmount) {
          return right.rawCoverageAmount - left.rawCoverageAmount;
        }
        const leftClose = left.closeDate ? new Date(left.closeDate).getTime() : Number.MAX_SAFE_INTEGER;
        const rightClose = right.closeDate ? new Date(right.closeDate).getTime() : Number.MAX_SAFE_INTEGER;
        if (leftClose !== rightClose) {
          return leftClose - rightClose;
        }
        const riskDelta = getRiskRank(left.riskLevel) - getRiskRank(right.riskLevel);
        if (riskDelta !== 0) {
          return riskDelta;
        }
        return Number(right.amountUsd || 0) - Number(left.amountUsd || 0);
      });

    const committedAmount = roundCurrency(
      candidates
        .filter((item) => item.coverageKind === "committed")
        .reduce((total, item) => total + Number(item.rawCoverageAmount || 0), 0),
    );
    const weightedAdditionalAmount = roundCurrency(
      candidates
        .filter((item) => item.coverageKind === "weighted")
        .reduce((total, item) => total + Number(item.rawCoverageAmount || 0), 0),
    );

    let remainingGap = activeGapAmount;
    const cards = candidates.slice(0, 5).map((item) => {
      const effectiveCoverageAmount = activeGapAmount > 0
        ? Math.min(remainingGap, item.rawCoverageAmount)
        : 0;
      remainingGap = Math.max(remainingGap - effectiveCoverageAmount, 0);
      return {
        ...item,
        effectiveCoverageAmount: roundCurrency(effectiveCoverageAmount),
        gapCoverageShare: activeGapAmount
          ? roundCurrency((effectiveCoverageAmount / activeGapAmount) * 100)
          : null,
        blockerLabel: getPrimaryBlocker(item),
      };
    });

    return {
      gapAmount: activeGapAmount,
      committedAmount,
      weightedAdditionalAmount,
      cards,
      coverageReadout: getCoverageReadout({
        gapAmount: activeGapAmount,
        committedAmount,
        weightedAdditionalAmount,
      }),
    };
  }, [currentPeriod, priorities, quota.gapAmount]);

  useEffect(() => {
    setNextStepDraft(buildNextStepDraft(selectedOpportunity));
    setDependencyDraft(buildDependencyDraft(selectedOpportunity));
  }, [selectedOpportunity]);

  async function handleSaveNextStep(event) {
    event.preventDefault();
    if (!nextStepDraft.opportunityId) return;

    setSavingNextStep(true);
    setError("");
    try {
      await api.post(
        `/api/commercial-development/opportunities/${nextStepDraft.opportunityId}/next-step`,
        nextStepDraft,
      );
      await loadDashboard(selectedPeriodKey);
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible guardar el siguiente paso",
        ),
      );
    } finally {
      setSavingNextStep(false);
    }
  }

  async function handleSaveDependency(event) {
    event.preventDefault();
    if (!dependencyDraft.opportunityId) return;

    setSavingDependency(true);
    setError("");
    try {
      await api.post(
        `/api/commercial-development/opportunities/${dependencyDraft.opportunityId}/dependencies`,
        dependencyDraft,
      );
      await loadDashboard(selectedPeriodKey);
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible registrar la dependencia interna",
        ),
      );
    } finally {
      setSavingDependency(false);
    }
  }

  async function handleActivateCadence(cadence) {
    setActivatingCadenceKey(`${cadence.opportunityId}-${cadence.cadenceType}`);
    setError("");
    try {
      await api.post("/api/commercial-development/cadences", {
        opportunityId: cadence.opportunityId,
        cadenceType: cadence.cadenceType,
      });
      await loadDashboard(selectedPeriodKey);
    } catch (requestError) {
      setError(
        getApiErrorMessage(requestError, "No fue posible activar la cadencia"),
      );
    } finally {
      setActivatingCadenceKey("");
    }
  }

  if (loading && !dashboard) {
    return <section className="panel centered">Cargando desarrollo comercial...</section>;
  }

  function getCoverageActionLabel(item) {
    if (!item?.nextStep) return "Registrar siguiente paso";
    if (item?.executionState?.code === "esperando_interno") {
      return "Destrabar dependencia";
    }
    return "Abrir oportunidad";
  }

  function roundCurrency(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  return (
    <section className="panel commercial-development-page">
      <header className="commercial-development-hero">
        <div className="commercial-development-hero-copy">
          <span className="commercial-development-kicker">Cockpit comercial</span>
          <div className="commercial-development-title-row">
            <h2>Desarrollo Comercial</h2>
            <DevelopmentHelp />
          </div>
          <p className="section-helper-text">
            Prioriza cobertura contra cuota, concentra decisiones del trimestre y
            permite ejecutar el siguiente movimiento desde la misma vista.
          </p>
        </div>

        <div className="commercial-development-toolbar">
          <label>
            Trimestre
            <select
              value={selectedPeriodKey}
              onChange={(event) => setSelectedPeriodKey(event.target.value)}
            >
              {periodOptions.map((period) => (
                <option
                  key={`${period.year}-${period.quarter}`}
                  value={`${period.year}-${period.quarter}`}
                >
                  {period.label}
                </option>
              ))}
              {!periodOptions.length && development.period ? (
                <option
                  value={`${development.period.year}-${development.period.quarter}`}
                >
                  {development.period.label}
                </option>
              ) : null}
            </select>
          </label>
          <button
            type="button"
            className="secondary-button"
            onClick={() => loadDashboard(selectedPeriodKey)}
          >
            Actualizar lectura
          </button>
        </div>
      </header>

      {error ? <p className="form-error">{error}</p> : null}

      <div className="commercial-development-metrics-grid">
        <SummaryMetric
          label="Cuota asignada"
          value={formatCurrency(
            quota.assignedAmount,
            development.period?.baseCurrencyCode,
          )}
          helper={development.period?.label || "Trimestre activo"}
        />
        <SummaryMetric
          label="Real ganado"
          value={formatCurrency(
            quota.actualAmount,
            development.period?.baseCurrencyCode,
          )}
          helper={`Avance ${formatPercent(quota.attainmentPercent)}`}
          tone="is-soft"
        />
        <SummaryMetric
          label="Brecha actual"
          value={formatCurrency(
            quota.gapAmount,
            development.period?.baseCurrencyCode,
          )}
          helper="Monto que aún falta en real"
          tone={Number(quota.gapAmount || 0) > 0 ? "is-danger" : "is-good"}
        />
        <SummaryMetric
          label="Pipeline comprometido"
          value={formatCurrency(
            quota.committedOpenAmount,
            development.period?.baseCurrencyCode,
          )}
          helper="Monto abierto solo en negociación o waiting"
          tone="is-soft"
        />
        <SummaryMetric
          label="Pipeline ponderado"
          value={formatCurrency(
            quota.weightedOpenAmount,
            development.period?.baseCurrencyCode,
          )}
          helper={`${pipelineByStage.length} etapa(s) con cobertura gradual`}
        />
      </div>

      <div className="commercial-development-top-grid">
        <section className="commercial-development-spotlight">
          <div className="commercial-development-section-header">
            <div>
              <h3>Cerrar la brecha este trimestre</h3>
              <p>
                Estas oportunidades son las que más mueven la cuota del período seleccionado.
              </p>
            </div>
            <span>{currentPeriod?.label || "Sin trimestre"}</span>
          </div>

          <div className="commercial-development-gap-summary">
            <div className="commercial-development-gap-summary-item is-danger">
              <span>Brecha actual</span>
              <strong>
                {formatCurrency(
                  gapClosingView.gapAmount,
                  currentPeriod?.baseCurrencyCode,
                )}
              </strong>
            </div>
            <div className="commercial-development-gap-summary-item is-soft">
              <span>Cobertura comprometida</span>
              <strong>
                {formatCurrency(
                  gapClosingView.committedAmount,
                  currentPeriod?.baseCurrencyCode,
                )}
              </strong>
            </div>
            <div className="commercial-development-gap-summary-item is-soft">
              <span>Cobertura ponderada adicional</span>
              <strong>
                {formatCurrency(
                  gapClosingView.weightedAdditionalAmount,
                  currentPeriod?.baseCurrencyCode,
                )}
              </strong>
            </div>
          </div>

          <div className="commercial-development-gap-readout">
            {gapClosingView.coverageReadout}
          </div>

          {gapClosingView.cards.length ? (
            <div className="commercial-development-gap-coverage-list">
              {gapClosingView.cards.map((item) => (
                <article
                  key={`gap-coverage-${item.id}`}
                  className="commercial-development-gap-coverage-card"
                >
                  <div className="commercial-development-inline-row">
                    <div>
                      <strong>{item.name}</strong>
                      <p>{item.accountName}</p>
                    </div>
                    <span className={`commercial-development-pill ${item.coverageKind === "committed" ? "is-low" : "is-medium"}`}>
                      {item.coverageKind === "committed" ? "Comprometida" : "Ponderada"}
                    </span>
                  </div>

                  <div className="commercial-development-gap-coverage-grid">
                    <div>
                      <span>Monto total</span>
                      <strong>
                        {formatCurrency(item.amountUsd, currentPeriod?.baseCurrencyCode)}
                      </strong>
                    </div>
                    <div>
                      <span>Etapa actual</span>
                      <strong>{item.stageName || "Sin etapa"}</strong>
                    </div>
                    <div>
                      <span>Aporte a la brecha</span>
                      <strong>
                        {formatCurrency(
                          item.effectiveCoverageAmount,
                          currentPeriod?.baseCurrencyCode,
                        )}
                      </strong>
                    </div>
                    <div>
                      <span>Riesgo</span>
                      <strong>{getRiskLabel(item.riskLevel)}</strong>
                    </div>
                  </div>

                  <div className="commercial-development-gap-coverage-meta">
                    <p>
                      {item.coverageKind === "committed"
                        ? `Ya está en tramo final; aquí el reto es ejecución y protección del cierre. Cubre ${formatCurrency(item.effectiveCoverageAmount, currentPeriod?.baseCurrencyCode)} de la brecha.`
                        : `Todavía no está comprometida; debe avanzar de etapa para aportar con más certeza. Aporta ${formatCurrency(item.effectiveCoverageAmount, currentPeriod?.baseCurrencyCode)} de la brecha.`}
                    </p>
                    <p>
                      <strong>Próximo paso:</strong>{" "}
                      {item.nextStep?.title || "Sin siguiente paso"}
                    </p>
                    <p>
                      <strong>Bloqueo principal:</strong>{" "}
                      {item.blockerLabel}
                    </p>
                    <p>
                      <strong>Fecha objetivo:</strong>{" "}
                      {formatDate(item.closeDate)}
                    </p>
                  </div>

                  <div className="commercial-development-gap-coverage-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setSelectedOpportunityId(item.id)}
                    >
                      {getCoverageActionLabel(item)}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              {gapClosingView.gapAmount > 0
                ? "No hay oportunidades del trimestre con aporte material a la brecha."
                : "La cuota ya está cubierta; no hace falta cobertura adicional en este trimestre."}
            </div>
          )}
        </section>

        <div className="commercial-development-side-stack">
          <section className="commercial-development-panel">
            <div className="commercial-development-section-header">
              <div>
                <h3>Recomendaciones</h3>
                <p>Foco sugerido para mover cuota y proteger avance.</p>
              </div>
            </div>
            <div className="commercial-development-list">
              {recommendations.map((item, index) => (
                <article
                  key={`${item.type}-${index}`}
                  className="commercial-development-note"
                >
                  <div className="commercial-development-inline-row">
                    <strong>{item.title}</strong>
                    <span className={`commercial-development-pill ${getToneClass(item.tone)}`}>
                      {item.tone === "high"
                        ? "Alta"
                        : item.tone === "medium"
                          ? "Media"
                          : "Baja"}
                    </span>
                  </div>
                  <p>{item.detail}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="commercial-development-panel">
            <div className="commercial-development-section-header">
              <div>
                <h3>Acciones del día</h3>
                <p>Tareas concretas para avanzar hoy.</p>
              </div>
            </div>
            <div className="commercial-development-list">
              {actionsToday.length ? (
                actionsToday.map((item, index) => (
                  <article
                    key={`${item.kind}-${item.opportunityId || index}`}
                    className="commercial-development-note is-action"
                  >
                    <div className="commercial-development-inline-row">
                      <strong>{item.title}</strong>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() =>
                          item.opportunityId &&
                          setSelectedOpportunityId(item.opportunityId)
                        }
                      >
                        Abrir
                      </button>
                    </div>
                    <p>{item.detail}</p>
                    <span>
                      {item.opportunityName || "Sin oportunidad"} · {formatDate(item.dueDate)}
                    </span>
                  </article>
                ))
              ) : (
                <div className="empty-state">No hay acciones urgentes abiertas.</div>
              )}
            </div>
          </section>
        </div>
      </div>

      <section className="commercial-development-panel">
        <div className="commercial-development-section-header">
          <div>
            <h3>Pipeline por etapa</h3>
            <p>Cobertura ponderada del trimestre seleccionado.</p>
          </div>
        </div>
        <div className="commercial-development-stage-grid">
          {pipelineByStage.length ? (
            pipelineByStage.map((stage) => (
              <article key={stage.stageCode} className="commercial-development-stage-card">
                <div className="commercial-development-inline-row">
                  <strong>{stage.stageName}</strong>
                  <span>{stage.opportunityCount} opps</span>
                </div>
                <p>{formatCurrency(stage.weightedAmount, development.period?.baseCurrencyCode)}</p>
                <div className="commercial-development-stage-meta">
                  <span>Abierto: {formatCurrency(stage.openAmount, development.period?.baseCurrencyCode)}</span>
                  <span>En riesgo: {stage.riskyCount}</span>
                  <span>Sin paso: {stage.withoutNextStepCount}</span>
                </div>
              </article>
            ))
          ) : (
            <div className="empty-state">No hay pipeline con fecha de cierre en este trimestre.</div>
          )}
        </div>
      </section>

      <div className="commercial-development-main-grid">
        <section className="commercial-development-panel">
          <div className="commercial-development-section-header">
            <div>
              <h3>Oportunidades priorizadas</h3>
              <p>Ordenadas por impacto, urgencia y riesgo operativo.</p>
            </div>
            <span>{priorities.length} foco(s)</span>
          </div>
          <div className="commercial-development-list">
            {priorities.length ? (
              priorities.map((item) => (
                <article
                  key={item.id}
                  className={`commercial-development-priority-card ${selectedOpportunity?.id === item.id ? "is-selected" : ""}`.trim()}
                >
                  <button
                    type="button"
                    className="commercial-development-priority-button"
                    onClick={() => setSelectedOpportunityId(item.id)}
                  >
                    <div className="commercial-development-inline-row">
                      <strong>{item.name}</strong>
                      <span className={`commercial-development-pill ${getRiskToneClass(item.riskLevel)}`}>
                        {getRiskLabel(item.riskLevel)}
                      </span>
                    </div>
                    <p>
                      {item.accountName} · {item.stageName} · {formatCurrency(item.amountUsd)}
                    </p>
                    <div className="commercial-development-score-row">
                      <span>Prioridad {item.priorityScore}</span>
                      <span>Impacto {item.impactScore}</span>
                      <span>Urgencia {item.urgencyScore}</span>
                      <span>Riesgo {item.riskScore}</span>
                    </div>
                    <p>{item.primaryRecommendation}</p>
                  </button>
                </article>
              ))
            ) : (
              <div className="empty-state">No hay oportunidades activas para priorizar.</div>
            )}
          </div>
        </section>

        <section className="commercial-development-panel commercial-development-detail-panel">
          <div className="commercial-development-section-header">
            <div>
              <h3>Panel operativo</h3>
              <p>
                {selectedOpportunity?.name || "Selecciona una oportunidad para ejecutar acciones."}
              </p>
            </div>
          </div>

          {selectedOpportunity ? (
            <>
              <div className="commercial-development-opportunity-meta">
                <span>{selectedOpportunity.accountName}</span>
                <span>{selectedOpportunity.stageName}</span>
                <span>{selectedOpportunity.sellerUserName}</span>
                <span>{formatCurrency(selectedOpportunity.amountUsd)}</span>
              </div>

              <div className="commercial-development-opportunity-summary">
                <div>
                  <span>Siguiente paso</span>
                  <strong>
                    {selectedOpportunity.nextStep?.title ||
                      "Definir conducción visible"}
                  </strong>
                </div>
                <div>
                  <span>Última actividad</span>
                  <strong>{selectedOpportunity.daysSinceActivity} día(s)</strong>
                </div>
                <div>
                  <span>Cierre estimado</span>
                  <strong>{formatDate(selectedOpportunity.closeDate)}</strong>
                </div>
              </div>

              <form className="commercial-development-form" onSubmit={handleSaveNextStep}>
                <h4>Empujar siguiente paso</h4>
                <label>
                  Título
                  <input
                    value={nextStepDraft.title}
                    onChange={(event) =>
                      setNextStepDraft((current) => ({
                        ...current,
                        title: event.target.value,
                      }))
                    }
                    placeholder="Ej. validar decisión con sponsor y compras"
                  />
                </label>
                <div className="commercial-development-form-grid">
                  <label>
                    Tipo
                    <select
                      value={nextStepDraft.actionType}
                      onChange={(event) =>
                        setNextStepDraft((current) => ({
                          ...current,
                          actionType: event.target.value,
                        }))
                      }
                    >
                      <option value="next_step">Mover yo</option>
                      <option value="follow_up">Seguimiento</option>
                      <option value="waiting_customer">Esperando cliente</option>
                    </select>
                  </label>
                  <label>
                    Fecha compromiso
                    <input
                      type="date"
                      value={nextStepDraft.dueDate}
                      onChange={(event) =>
                        setNextStepDraft((current) => ({
                          ...current,
                          dueDate: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
                <label>
                  Resultado esperado
                  <textarea
                    rows="3"
                    value={nextStepDraft.successCriteria}
                    onChange={(event) =>
                      setNextStepDraft((current) => ({
                        ...current,
                        successCriteria: event.target.value,
                      }))
                    }
                    placeholder="Qué debe quedar resuelto para que la oportunidad avance"
                  />
                </label>
                <button className="primary-button" type="submit" disabled={savingNextStep}>
                  {savingNextStep ? "Guardando..." : "Guardar siguiente paso"}
                </button>
              </form>

              <form className="commercial-development-form" onSubmit={handleSaveDependency}>
                <h4>Destrabar dependencia interna</h4>
                <label>
                  Título
                  <input
                    value={dependencyDraft.title}
                    onChange={(event) =>
                      setDependencyDraft((current) => ({
                        ...current,
                        title: event.target.value,
                      }))
                    }
                    placeholder="Ej. validación técnica de preventa"
                  />
                </label>
                <div className="commercial-development-form-grid">
                  <label>
                    Tipo
                    <select
                      value={dependencyDraft.dependencyType}
                      onChange={(event) =>
                        setDependencyDraft((current) => ({
                          ...current,
                          dependencyType: event.target.value,
                        }))
                      }
                    >
                      <option value="presales_support">Preventa</option>
                      <option value="provider_response">Proveedor</option>
                      <option value="legal_review">Legal</option>
                      <option value="commercial_management">Dirección comercial</option>
                      <option value="pricing_internal">Cotización interna</option>
                      <option value="finance_approval">Finanzas</option>
                      <option value="operations_alignment">Operaciones</option>
                    </select>
                  </label>
                  <label>
                    Fecha compromiso
                    <input
                      type="date"
                      value={dependencyDraft.dueDate}
                      onChange={(event) =>
                        setDependencyDraft((current) => ({
                          ...current,
                          dueDate: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
                <label>
                  Resultado esperado
                  <input
                    value={dependencyDraft.expectedOutcome}
                    onChange={(event) =>
                      setDependencyDraft((current) => ({
                        ...current,
                        expectedOutcome: event.target.value,
                      }))
                    }
                    placeholder="Qué debe entregar el equipo interno"
                  />
                </label>
                <label>
                  Detalle
                  <textarea
                    rows="3"
                    value={dependencyDraft.details}
                    onChange={(event) =>
                      setDependencyDraft((current) => ({
                        ...current,
                        details: event.target.value,
                      }))
                    }
                    placeholder="Contexto para destrabar la oportunidad"
                  />
                </label>
                <button className="secondary-button" type="submit" disabled={savingDependency}>
                  {savingDependency ? "Guardando..." : "Agregar dependencia"}
                </button>
              </form>

              <div className="commercial-development-subgrid">
                <section className="commercial-development-mini-panel">
                  <h4>Riesgos visibles</h4>
                  {selectedOpportunity.riskReasons?.length ? (
                    <div className="commercial-development-tag-row">
                      {selectedOpportunity.riskReasons.map((reason) => (
                        <span key={reason} className="commercial-development-tag">
                          {reason}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="section-helper-text">Sin alertas prioritarias.</p>
                  )}
                </section>

                <section className="commercial-development-mini-panel">
                  <h4>Cadencias sugeridas</h4>
                  {selectedCadenceSuggestions.length ? (
                    <div className="commercial-development-list">
                      {selectedCadenceSuggestions.map((cadence) => (
                        <article key={`${cadence.opportunityId}-${cadence.cadenceType}`} className="commercial-development-note">
                          <div className="commercial-development-inline-row">
                            <strong>{cadence.title}</strong>
                            <span>{getCadenceDecisionLabel(cadence.cadenceDecision)}</span>
                          </div>
                          <p>{cadence.description}</p>
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={
                              activatingCadenceKey ===
                              `${cadence.opportunityId}-${cadence.cadenceType}`
                            }
                            onClick={() => handleActivateCadence(cadence)}
                          >
                            {activatingCadenceKey ===
                            `${cadence.opportunityId}-${cadence.cadenceType}`
                              ? "Activando..."
                              : "Activar cadencia"}
                          </button>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="section-helper-text">Sin cadencias sugeridas para esta oportunidad.</p>
                  )}
                </section>

                <section className="commercial-development-mini-panel">
                  <h4>Recursos sugeridos</h4>
                  {selectedOpportunity.recommendedResources?.length ? (
                    <div className="commercial-development-list">
                      {selectedOpportunity.recommendedResources.slice(0, 3).map((resource) => (
                        <article key={resource.publicId} className="commercial-development-note">
                          <div className="commercial-development-inline-row">
                            <strong>{resource.title}</strong>
                            <span>{resource.kindLabel}</span>
                          </div>
                          <p>{resource.summary}</p>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="section-helper-text">Sin recursos recomendados para esta oportunidad.</p>
                  )}
                </section>
              </div>
            </>
          ) : (
            <div className="empty-state">No hay una oportunidad seleccionada.</div>
          )}
        </section>
      </div>
    </section>
  );
}