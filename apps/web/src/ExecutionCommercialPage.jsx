import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, getApiErrorMessage } from "./api";

const TAB_OPTIONS = [
  { id: "overview", label: "Resumen" },
  { id: "workboard", label: "Mi bandeja" },
  { id: "followups", label: "Seguimientos" },
  { id: "cadences", label: "Cadencias" },
  { id: "risks", label: "Riesgos" },
  { id: "management", label: "Vista gerencial" },
];

const NEXT_STEP_TYPE_OPTIONS = [
  { value: "next_step", label: "Mover yo" },
  { value: "follow_up", label: "Seguimiento" },
  { value: "waiting_customer", label: "Esperando cliente" },
];

const DEPENDENCY_TYPE_OPTIONS = [
  { value: "presales_support", label: "Preventa" },
  { value: "provider_response", label: "Proveedor" },
  { value: "legal_review", label: "Legal" },
  { value: "commercial_management", label: "Direccion comercial" },
  { value: "pricing_internal", label: "Cotizacion interna" },
  { value: "finance_approval", label: "Finanzas" },
  { value: "operations_alignment", label: "Operaciones" },
];

function buildCadenceNextRunAt(daysAhead = 2) {
  return new Date(Date.now() + daysAhead * 86400000).toISOString();
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

function formatDateTime(value) {
  if (!value) return "Sin fecha";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Sin fecha";
  return parsed.toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCurrency(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
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

function getCadenceStatusLabel(status) {
  if (status === "active") return "Activa";
  if (status === "paused") return "Pausada";
  if (status === "completed") return "Completada";
  return status || "Sin estado";
}

function getCadenceDecisionLabel(decision) {
  if (decision === "activate") return "Activar";
  if (decision === "watch") return "Vigilar";
  return "Sin decision";
}

function getReminderToneClass(tone) {
  if (tone === "high") return "is-high";
  if (tone === "medium") return "is-medium";
  return "is-low";
}

function getExecutionStateToneClass(code) {
  if (["vencida", "bloqueada", "sin_conduccion"].includes(code)) {
    return "is-high";
  }
  if (["en_riesgo", "esperando_cliente", "esperando_interno"].includes(code)) {
    return "is-medium";
  }
  return "is-low";
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeDashboardResponse(data) {
  const normalizedWorkboard = asArray(data?.workboard).map((item) => ({
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
    workboard: normalizedWorkboard,
    risks: asArray(data?.risks).map((item) => ({
      ...item,
      riskReasons: asArray(item?.riskReasons),
      dependencies: asArray(item?.dependencies),
    })),
    followUps: asArray(data?.followUps),
    pendingInteractions: asArray(data?.pendingInteractions),
    cadences: {
      active: asArray(data?.cadences?.active).map((item) => ({
        ...item,
        steps: asArray(item?.steps),
      })),
      suggested: asArray(data?.cadences?.suggested).map((item) => ({
        ...item,
        steps: asArray(item?.steps),
        frictionReasons: asArray(item?.frictionReasons),
        protectiveSignals: asArray(item?.protectiveSignals),
      })),
      totalSuggested: Number(data?.cadences?.totalSuggested || 0),
      activateCount: Number(data?.cadences?.activateCount || 0),
      watchCount: Number(data?.cadences?.watchCount || 0),
      visibleLimit: Number(data?.cadences?.visibleLimit || 10),
    },
    management: {
      sellerStats: asArray(data?.management?.sellerStats),
      stageStats: asArray(data?.management?.stageStats),
      executionStateStats: asArray(data?.management?.executionStateStats),
      dependencyStats: asArray(data?.management?.dependencyStats),
    },
  };
}

function getRecommendedNextMoveTitle(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    return value.title || value.text || "";
  }
  return String(value);
}

function getRecommendedNextMoveText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    if (value.title && value.text) {
      return `${value.title}: ${value.text}`;
    }
    return value.text || value.title || "";
  }
  return String(value);
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

function SummaryCard({ label, value, helper, tone }) {
  return (
    <article
      className={`commercial-execution-summary-card ${tone || ""}`.trim()}
    >
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{helper}</p>
    </article>
  );
}

function CommercialExecutionHelp({ description }) {
  const detailsRef = useRef(null);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!detailsRef.current?.open) {
        return;
      }

      if (!detailsRef.current.contains(event.target)) {
        detailsRef.current.removeAttribute("open");
      }
    }

    function handleKeyDown(event) {
      if (event.key !== "Escape" || !detailsRef.current?.open) {
        return;
      }

      detailsRef.current.removeAttribute("open");
      detailsRef.current.querySelector("summary")?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <details className="commercial-execution-help" ref={detailsRef}>
      <summary
        className="commercial-execution-help-trigger"
        aria-label="Ayuda sobre ejecucion comercial"
        title="Ayuda sobre el módulo"
      >
        ?
      </summary>
      <div className="commercial-execution-help-popover">
        <strong>Para que sirve</strong>
        <p>{description}</p>
      </div>
    </details>
  );
}

export default function ExecutionCommercialPage() {
  const [activeTab, setActiveTab] = useState("overview");
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedOpportunityId, setSelectedOpportunityId] = useState(null);
  const [nextStepDraft, setNextStepDraft] = useState(buildNextStepDraft(null));
  const [dependencyDraft, setDependencyDraft] = useState(
    buildDependencyDraft(null),
  );
  const [savingNextStep, setSavingNextStep] = useState(false);
  const [savingDependencyKey, setSavingDependencyKey] = useState("");
  const [savingCadenceKey, setSavingCadenceKey] = useState("");
  const [showAllCadences, setShowAllCadences] = useState(false);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/api/execution-commercial/dashboard");
      const normalizedDashboard = normalizeDashboardResponse(response.data);
      setDashboard(normalizedDashboard);
      setSelectedOpportunityId((current) => {
        if (
          current &&
          normalizedDashboard.workboard.some((item) => item.id === current)
        ) {
          return current;
        }
        return normalizedDashboard.workboard[0]?.id || null;
      });
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar la vista de ejecucion comercial",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Server data load on mount is intentional for this page.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDashboard();
  }, [loadDashboard]);

  const workboard = dashboard?.workboard || [];
  const summary = dashboard?.summary || {};
  const selectedOpportunity = useMemo(
    () =>
      workboard.find((item) => item.id === selectedOpportunityId) ||
      workboard[0] ||
      null,
    [selectedOpportunityId, workboard],
  );

  useEffect(() => {
    // These drafts intentionally reset when the selected opportunity changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNextStepDraft(buildNextStepDraft(selectedOpportunity));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDependencyDraft(buildDependencyDraft(selectedOpportunity));
  }, [selectedOpportunity]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowAllCadences(false);
  }, [dashboard?.cadences?.totalSuggested]);

  const suggestedCadences = dashboard?.cadences?.suggested || [];
  const cadenceVisibleLimit = dashboard?.cadences?.visibleLimit || 10;
  const visibleSuggestedCadences = showAllCadences
    ? suggestedCadences
    : suggestedCadences.slice(0, cadenceVisibleLimit);
  const suggestedActivateCadences = visibleSuggestedCadences.filter(
    (item) => item.cadenceDecision === "activate",
  );
  const suggestedWatchCadences = visibleSuggestedCadences.filter(
    (item) => item.cadenceDecision === "watch",
  );
  const totalSuggestedCadences =
    dashboard?.cadences?.totalSuggested || suggestedCadences.length;

  async function handleSaveNextStep(event) {
    event.preventDefault();
    if (!nextStepDraft.opportunityId) {
      return;
    }

    setSavingNextStep(true);
    setError("");
    try {
      await api.post(
        `/api/execution-commercial/opportunities/${nextStepDraft.opportunityId}/next-step`,
        nextStepDraft,
      );
      await loadDashboard();
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible guardar el próximo paso",
        ),
      );
    } finally {
      setSavingNextStep(false);
    }
  }

  async function handleSaveDependency(event) {
    event.preventDefault();
    if (!dependencyDraft.opportunityId) {
      return;
    }

    setSavingDependencyKey(`create-${dependencyDraft.opportunityId}`);
    setError("");
    try {
      await api.post(
        `/api/execution-commercial/opportunities/${dependencyDraft.opportunityId}/dependencies`,
        dependencyDraft,
      );
      await loadDashboard();
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible guardar la dependencia interna",
        ),
      );
    } finally {
      setSavingDependencyKey("");
    }
  }

  async function handleUpdateDependency(dependencyId, payload) {
    setSavingDependencyKey(`dep-${dependencyId}`);
    setError("");
    try {
      await api.patch(
        `/api/execution-commercial/dependencies/${dependencyId}`,
        payload,
      );
      await loadDashboard();
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible actualizar la dependencia interna",
        ),
      );
    } finally {
      setSavingDependencyKey("");
    }
  }

  async function handleActivateCadence(cadence) {
    setSavingCadenceKey(
      `suggested-${cadence.opportunityId}-${cadence.cadenceType}`,
    );
    setError("");
    try {
      await api.post("/api/execution-commercial/cadences", {
        opportunityId: cadence.opportunityId,
        cadenceType: cadence.cadenceType,
      });
      await loadDashboard();
      setActiveTab("cadences");
    } catch (requestError) {
      setError(
        getApiErrorMessage(requestError, "No fue posible activar la cadencia"),
      );
    } finally {
      setSavingCadenceKey("");
    }
  }

  async function handleAdvanceCadence(cadence, nextStatus = "active") {
    setSavingCadenceKey(`active-${cadence.id}`);
    setError("");
    try {
      const nextIndex =
        nextStatus === "completed"
          ? cadence.currentStepIndex
          : Math.min(cadence.currentStepIndex + 1, cadence.steps.length - 1);
      await api.patch(`/api/execution-commercial/cadences/${cadence.id}`, {
        status: nextStatus,
        currentStepIndex: nextIndex,
        lastExecutedAt: new Date().toISOString(),
        nextRunAt:
          nextStatus === "completed"
            ? null
            : buildCadenceNextRunAt(),
      });
      await loadDashboard();
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible actualizar la cadencia",
        ),
      );
    } finally {
      setSavingCadenceKey("");
    }
  }

  if (loading) {
    return (
      <section className="panel centered">
        Cargando ejecucion comercial...
      </section>
    );
  }

  if (!dashboard || typeof dashboard !== "object") {
    return (
      <section className="panel commercial-execution-page">
        <header className="commercial-execution-hero">
          <div>
            <span className="commercial-execution-kicker">
              Módulo principal
            </span>
            <div className="commercial-execution-title-row">
              <h2>Ejecucion Comercial</h2>
              <CommercialExecutionHelp description="Este módulo ordena la ejecucion diaria del equipo comercial para que cada oportunidad tenga próximo paso, seguimiento, dependencias visibles y riesgos controlados." />
            </div>
            <p className="section-helper-text">
              La vista no recibió un tablero valido. Reintenta la carga del
              módulo.
            </p>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={loadDashboard}
          >
            Reintentar
          </button>
        </header>

        {error ? <p className="form-error">{error}</p> : null}
        <div className="empty-state">
          No fue posible construir la vista de Ejecucion Comercial.
        </div>
      </section>
    );
  }

  return (
    <section className="panel commercial-execution-page">
      <header className="commercial-execution-hero">
        <div>
          <span className="commercial-execution-kicker">Módulo principal</span>
          <div className="commercial-execution-title-row">
            <h2>Ejecucion Comercial</h2>
            <CommercialExecutionHelp description="Este módulo ayuda al vendedor a ejecutar su pipeline con una rutina clara: revisar riesgos, cumplir seguimientos, cerrar próximos pasos y coordinar dependencias sin salir de la misma vista." />
          </div>
          <p className="section-helper-text">
            Organiza la disciplina diaria del vendedor, obliga próximo paso y
            concentra riesgos, seguimientos y cadencias en una misma vista
            operativa.
          </p>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={loadDashboard}
        >
          Actualizar lectura
        </button>
      </header>

      {error ? <p className="form-error">{error}</p> : null}

      <div className="commercial-execution-summary-grid">
        <SummaryCard
          label="Pipeline abierto"
          value={summary.openOpportunities || 0}
          helper="Oportunidades activas con seguimiento comercial"
        />
        <SummaryCard
          label="Riesgos visibles"
          value={summary.riskyOpportunities || 0}
          helper="Casos que requieren intervencion del vendedor o manager"
          tone="is-alert"
        />
        <SummaryCard
          label="Seguimientos vencidos"
          value={summary.overdueFollowUps || 0}
          helper="Promesas comerciales fuera de fecha"
          tone="is-warn"
        />
        <SummaryCard
          label="Sin próximo paso"
          value={summary.withoutNextStep || 0}
          helper="Oportunidades sin compromiso cerrado"
          tone="is-danger"
        />
        <SummaryCard
          label="Esperando cliente"
          value={summary.waitingOnClient || 0}
          helper="Deals con respuesta pendiente del cliente"
          tone="is-warn"
        />
        <SummaryCard
          label="Esperando interno"
          value={summary.waitingOnInternal || 0}
          helper="Dependencias del equipo que frenan el avance"
          tone="is-alert"
        />
        <SummaryCard
          label="Cadencias activas"
          value={summary.activeCadences || 0}
          helper="Secuencias comerciales en ejecucion"
        />
        <SummaryCard
          label="Interacciones pendientes"
          value={summary.pendingInteractions || 0}
          helper="Documentos o hallazgos por resolver"
        />
      </div>

      <div
        className="commercial-execution-tabs"
        role="tablist"
        aria-label="Vistas de ejecucion comercial"
      >
        {TAB_OPTIONS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`commercial-execution-tab ${activeTab === tab.id ? "is-active" : ""}`.trim()}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" ? (
        <div className="commercial-execution-overview-grid">
          <section className="commercial-execution-block">
            <div className="commercial-execution-block-header">
              <h3>Prioridades del dia</h3>
              <span>{Math.min(5, workboard.length)} frentes clave</span>
            </div>
            <div className="commercial-execution-list">
              {workboard.slice(0, 5).map((item) => (
                <article
                  key={item.id}
                  className="commercial-execution-item-card"
                >
                  <div className="commercial-execution-item-topline">
                    <strong>{item.name}</strong>
                    <span
                      className={`commercial-execution-risk-badge ${getRiskToneClass(item.riskLevel)}`}
                    >
                      {getRiskLabel(item.riskLevel)}
                    </span>
                  </div>
                  <p>
                    {item.accountName} · {item.stageName}
                  </p>
                  <p>
                    {item.nextStep?.title ||
                      getRecommendedNextMoveText(item.recommendedNextMove) ||
                      "Definir siguiente jugada"}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section className="commercial-execution-block">
            <div className="commercial-execution-block-header">
              <h3>Riesgos a contener</h3>
              <span>{dashboard?.risks?.length || 0} oportunidades</span>
            </div>
            <div className="commercial-execution-list">
              {(dashboard?.risks || []).slice(0, 5).map((item) => (
                <article
                  key={item.id}
                  className="commercial-execution-item-card is-risk"
                >
                  <div className="commercial-execution-item-topline">
                    <strong>{item.name}</strong>
                    <span>{item.daysSinceActivity} días sin traccion</span>
                  </div>
                  <p>{item.riskReasons[0] || "Sin detalle"}</p>
                  <p>{item.executionState?.summary || ""}</p>
                  <button
                    className="link-button"
                    type="button"
                    onClick={() => {
                      setSelectedOpportunityId(item.id);
                      setActiveTab("workboard");
                    }}
                  >
                    Resolver desde mi bandeja
                  </button>
                </article>
              ))}
            </div>
          </section>

          <section className="commercial-execution-block">
            <div className="commercial-execution-block-header">
              <h3>Cadencias activas</h3>
              <span>{dashboard?.cadences?.active?.length || 0} secuencias</span>
            </div>
            <div className="commercial-execution-list">
              {(dashboard?.cadences?.active || [])
                .slice(0, 4)
                .map((cadence) => (
                  <article
                    key={cadence.id}
                    className="commercial-execution-item-card"
                  >
                    <div className="commercial-execution-item-topline">
                      <strong>{cadence.title}</strong>
                      <span>{getCadenceStatusLabel(cadence.status)}</span>
                    </div>
                    <p>{cadence.opportunityName}</p>
                    <p>{cadence.currentStepLabel || "Pendiente de iniciar"}</p>
                  </article>
                ))}
            </div>
          </section>

          <section className="commercial-execution-block">
            <div className="commercial-execution-block-header">
              <h3>Interacciones pendientes</h3>
              <span>
                {dashboard?.pendingInteractions?.length || 0} registros
              </span>
            </div>
            <div className="commercial-execution-list">
              {(dashboard?.pendingInteractions || [])
                .slice(0, 4)
                .map((item) => (
                  <article
                    key={item.id}
                    className="commercial-execution-item-card"
                  >
                    <div className="commercial-execution-item-topline">
                      <strong>{item.title}</strong>
                      <span>{item.daysOpen} días</span>
                    </div>
                    <p>{item.accountName || "Sin cuenta"}</p>
                    <p>
                      {item.primaryOpportunityName ||
                        "Sin oportunidad principal"}
                    </p>
                  </article>
                ))}
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "workboard" ? (
        <div className="commercial-execution-workboard-grid">
          <section className="commercial-execution-block">
            <div className="commercial-execution-block-header">
              <h3>Mi bandeja priorizada</h3>
              <span>{workboard.length} oportunidades activas</span>
            </div>
            <div className="commercial-execution-list">
              {workboard.map((item) => (
                <article
                  key={item.id}
                  className={`commercial-execution-item-card ${selectedOpportunity?.id === item.id ? "is-selected" : ""}`.trim()}
                >
                  <button
                    type="button"
                    className="commercial-execution-item-button"
                    onClick={() => setSelectedOpportunityId(item.id)}
                  >
                    <div className="commercial-execution-item-topline">
                      <strong>{item.name}</strong>
                      <span
                        className={`commercial-execution-risk-badge ${getRiskToneClass(item.riskLevel)}`}
                      >
                        {getRiskLabel(item.riskLevel)}
                      </span>
                    </div>
                    <p>
                      {item.accountName} · {item.stageName}
                    </p>
                    <p>
                      {item.nextStep?.title ||
                        getRecommendedNextMoveText(item.recommendedNextMove) ||
                        "Definir siguiente jugada"}
                    </p>
                    <div className="commercial-execution-item-meta-row">
                      <span>SLA: {item.slaDays} días</span>
                      <span>{item.daysSinceActivity} días sin actividad</span>
                      <span>{formatCurrency(item.amountUsd)}</span>
                    </div>
                  </button>
                </article>
              ))}
            </div>
          </section>

          <section className="commercial-execution-block commercial-execution-editor-block">
            <div className="commercial-execution-block-header">
              <h3>Proximo paso obligatorio</h3>
              <span>
                {selectedOpportunity?.name || "Selecciona una oportunidad"}
              </span>
            </div>
            {selectedOpportunity ? (
              <>
                <div className="commercial-execution-editor-meta">
                  <span>{selectedOpportunity.accountName}</span>
                  <span>{selectedOpportunity.stageName}</span>
                  <span>{selectedOpportunity.sellerUserName}</span>
                  <span
                    className={`commercial-execution-risk-badge ${getExecutionStateToneClass(selectedOpportunity.executionState?.code)}`}
                  >
                    {selectedOpportunity.executionState?.label || "Sin estado"}
                  </span>
                </div>
                <p className="section-helper-text">
                  Ruta sugerida:{" "}
                  {selectedOpportunity.recommendedHeading || "Sin estrategia"}.{" "}
                  {selectedOpportunity.recommendedRoute || ""}
                </p>
                <p className="section-helper-text">
                  {selectedOpportunity.executionState?.summary || ""}
                </p>
                <form
                  className="commercial-execution-form"
                  onSubmit={handleSaveNextStep}
                >
                  <label>
                    Tipo de conduccion
                    <select
                      value={nextStepDraft.actionType}
                      onChange={(event) =>
                        setNextStepDraft((current) => ({
                          ...current,
                          actionType: event.target.value,
                        }))
                      }
                    >
                      {NEXT_STEP_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Proximo paso
                    <input
                      value={nextStepDraft.title}
                      onChange={(event) =>
                        setNextStepDraft((current) => ({
                          ...current,
                          title: event.target.value,
                        }))
                      }
                      placeholder="Ej. agendar comite con decisor y sponsor"
                    />
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
                  <label>
                    Resultado esperado
                    <textarea
                      rows="4"
                      value={nextStepDraft.successCriteria}
                      onChange={(event) =>
                        setNextStepDraft((current) => ({
                          ...current,
                          successCriteria: event.target.value,
                        }))
                      }
                      placeholder="Ej. obtener validacion de presupuesto y fecha de decision"
                    />
                  </label>
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={savingNextStep}
                  >
                    {savingNextStep ? "Guardando..." : "Guardar próximo paso"}
                  </button>
                </form>
                <div className="commercial-execution-reasons-panel">
                  <strong>Riesgos visibles</strong>
                  {(selectedOpportunity.riskReasons || []).length ? (
                    <div className="commercial-execution-tag-row">
                      {selectedOpportunity.riskReasons.map((reason) => (
                        <span key={reason} className="commercial-execution-tag">
                          {reason}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="section-helper-text">
                      Sin alertas prioritarias.
                    </p>
                  )}
                </div>
                <div className="commercial-execution-reasons-panel">
                  <strong>Recordatorios inteligentes</strong>
                  {(selectedOpportunity.reminders || []).length ? (
                    <div className="commercial-execution-list">
                      {selectedOpportunity.reminders.map((reminder, index) => (
                        <article
                          key={`${reminder.title}-${index}`}
                          className="commercial-execution-reminder-card"
                        >
                          <div className="commercial-execution-item-topline">
                            <strong>{reminder.title}</strong>
                            <span
                              className={`commercial-execution-risk-badge ${getReminderToneClass(reminder.tone)}`}
                            >
                              {reminder.tone === "high"
                                ? "Urgente"
                                : reminder.tone === "medium"
                                  ? "Atender"
                                  : "Seguimiento"}
                            </span>
                          </div>
                          <p>{reminder.detail}</p>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="section-helper-text">
                      Sin recordatorios abiertos para esta oportunidad.
                    </p>
                  )}
                </div>
                <div className="commercial-execution-reasons-panel">
                  <strong>Recursos recomendados</strong>
                  {(selectedOpportunity.recommendedResources || []).length ? (
                    <div className="commercial-execution-list">
                      {selectedOpportunity.recommendedResources.map(
                        (resource) => (
                          <article
                            key={resource.publicId}
                            className="commercial-execution-reminder-card"
                          >
                            <div className="commercial-execution-item-topline">
                              <strong>{resource.title}</strong>
                              <span>{resource.kindLabel}</span>
                            </div>
                            <p>{resource.summary}</p>
                            <p>{resource.recommendationReason}</p>
                            <div className="commercial-execution-item-meta-row">
                              <span>
                                {resource.assets?.length || 0} adjuntos
                              </span>
                              <span>Score: {resource.matchScore || 0}</span>
                            </div>
                          </article>
                        ),
                      )}
                    </div>
                  ) : (
                    <p className="section-helper-text">
                      No hay recursos sugeridos todavia para esta oportunidad.
                    </p>
                  )}
                </div>
                <div className="commercial-execution-reasons-panel">
                  <strong>Dependencias internas</strong>
                  <form
                    className="commercial-execution-form commercial-execution-form-inline"
                    onSubmit={handleSaveDependency}
                  >
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
                        {DEPENDENCY_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Titulo
                      <input
                        value={dependencyDraft.title}
                        onChange={(event) =>
                          setDependencyDraft((current) => ({
                            ...current,
                            title: event.target.value,
                          }))
                        }
                        placeholder="Ej. validacion tecnica de preventa"
                      />
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
                        placeholder="Ej. aprobacion para presentar propuesta"
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
                        placeholder="Que debe entregar el equipo interno y que destraba la oportunidad"
                      />
                    </label>
                    <button
                      className="secondary-button"
                      type="submit"
                      disabled={
                        savingDependencyKey ===
                        `create-${selectedOpportunity.id}`
                      }
                    >
                      {savingDependencyKey ===
                      `create-${selectedOpportunity.id}`
                        ? "Guardando..."
                        : "Agregar dependencia"}
                    </button>
                  </form>

                  {(selectedOpportunity.dependencies || []).length ? (
                    <div className="commercial-execution-list">
                      {selectedOpportunity.dependencies.map((dependency) => (
                        <article
                          key={dependency.id}
                          className="commercial-execution-item-card"
                        >
                          <div className="commercial-execution-item-topline">
                            <strong>{dependency.dependencyLabel}</strong>
                            <span
                              className={`commercial-execution-risk-badge ${dependency.isOverdue ? "is-high" : "is-medium"}`}
                            >
                              {dependency.isOverdue ? "Vencida" : "Abierta"}
                            </span>
                          </div>
                          <p>{dependency.title}</p>
                          <p>
                            {dependency.expectedOutcome ||
                              "Sin resultado esperado"}
                          </p>
                          <div className="commercial-execution-item-meta-row">
                            <span>{formatDate(dependency.dueDate)}</span>
                            <span>
                              {dependency.ownerUserName || "Sin responsable"}
                            </span>
                          </div>
                          <div className="commercial-execution-action-row">
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={
                                savingDependencyKey === `dep-${dependency.id}`
                              }
                              onClick={() =>
                                handleUpdateDependency(dependency.id, {
                                  status:
                                    dependency.status === "blocked"
                                      ? "open"
                                      : "blocked",
                                })
                              }
                            >
                              {dependency.status === "blocked"
                                ? "Reabrir"
                                : "Bloquear"}
                            </button>
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={
                                savingDependencyKey === `dep-${dependency.id}`
                              }
                              onClick={() =>
                                handleUpdateDependency(dependency.id, {
                                  status: "done",
                                  resolutionNote:
                                    "Resuelta desde Ejecucion Comercial",
                                })
                              }
                            >
                              Resolver
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="section-helper-text">
                      No hay dependencias internas abiertas.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="empty-state">
                No hay oportunidades activas para esta vista.
              </div>
            )}
          </section>
        </div>
      ) : null}

      {activeTab === "followups" ? (
        <div className="commercial-execution-overview-grid">
          <section className="commercial-execution-block">
            <div className="commercial-execution-block-header">
              <h3>Seguimientos comprometidos</h3>
              <span>{dashboard?.followUps?.length || 0} compromisos</span>
            </div>
            <div className="commercial-execution-list">
              {(dashboard?.followUps || []).map((item) => (
                <article
                  key={item.id}
                  className="commercial-execution-item-card"
                >
                  <div className="commercial-execution-item-topline">
                    <strong>{item.name}</strong>
                    <span>{formatDate(item.nextStep?.dueDate)}</span>
                  </div>
                  <p>{item.nextStep?.title || "Sin titulo"}</p>
                  <div className="commercial-execution-item-meta-row">
                    <span>{item.accountName}</span>
                    <span>{item.stageName}</span>
                    <span>
                      {item.nextStep?.ownerUserName || item.sellerUserName}
                    </span>
                    <span>{item.executionState?.label || ""}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="commercial-execution-block">
            <div className="commercial-execution-block-header">
              <h3>Interacciones por resolver</h3>
              <span>
                {dashboard?.pendingInteractions?.length || 0} pendientes
              </span>
            </div>
            <div className="commercial-execution-list">
              {(dashboard?.pendingInteractions || []).map((item) => (
                <article
                  key={item.id}
                  className="commercial-execution-item-card"
                >
                  <div className="commercial-execution-item-topline">
                    <strong>{item.title}</strong>
                    <span>{item.analysisStatus}</span>
                  </div>
                  <p>{item.accountName || "Sin cuenta vinculada"}</p>
                  <p>
                    {item.primaryOpportunityName || "Sin oportunidad principal"}{" "}
                    · {item.daysOpen} días abiertos
                  </p>
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "cadences" ? (
        <div className="commercial-execution-overview-grid">
          <section className="commercial-execution-block">
            <div className="commercial-execution-block-header">
              <h3>Cadencias activas</h3>
              <span>{dashboard?.cadences?.active?.length || 0} secuencias</span>
            </div>
            <div className="commercial-execution-list">
              {(dashboard?.cadences?.active || []).map((cadence) => (
                <article
                  key={cadence.id}
                  className="commercial-execution-item-card"
                >
                  <div className="commercial-execution-item-topline">
                    <strong>{cadence.title}</strong>
                    <span>{getCadenceStatusLabel(cadence.status)}</span>
                  </div>
                  <p>
                    {cadence.opportunityName} · {cadence.accountName}
                  </p>
                  <p>Paso actual: {cadence.currentStepLabel || "Pendiente"}</p>
                  <div className="commercial-execution-item-meta-row">
                    <span>
                      Siguiente toque: {formatDateTime(cadence.nextRunAt)}
                    </span>
                    <span>{cadence.ownerUserName || "Sin propietario"}</span>
                  </div>
                  <div className="commercial-execution-action-row">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={savingCadenceKey === `active-${cadence.id}`}
                      onClick={() => handleAdvanceCadence(cadence, "active")}
                    >
                      Avanzar paso
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={savingCadenceKey === `active-${cadence.id}`}
                      onClick={() => handleAdvanceCadence(cadence, "paused")}
                    >
                      Pausar
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={savingCadenceKey === `active-${cadence.id}`}
                      onClick={() => handleAdvanceCadence(cadence, "completed")}
                    >
                      Completar
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="commercial-execution-block">
            <div className="commercial-execution-block-header commercial-execution-block-header-wide">
              <div>
                <h3>Cadencias sugeridas</h3>
                <span>{totalSuggestedCadences} oportunidades</span>
              </div>
              {totalSuggestedCadences > cadenceVisibleLimit ? (
                <button
                  type="button"
                  className="secondary-button commercial-execution-inline-button"
                  onClick={() => setShowAllCadences((current) => !current)}
                >
                  {showAllCadences
                    ? `Mostrar top ${cadenceVisibleLimit}`
                    : "Ver todas"}
                </button>
              ) : null}
            </div>
            {totalSuggestedCadences ? (
              <p className="section-helper-text commercial-execution-helper-inline">
                {showAllCadences
                  ? `Mostrando ${visibleSuggestedCadences.length} de ${totalSuggestedCadences} oportunidades con friccion.`
                  : `Mostrando ${visibleSuggestedCadences.length} de ${totalSuggestedCadences} oportunidades priorizadas por score de friccion.`}
              </p>
            ) : null}

            {suggestedActivateCadences.length ? (
              <div className="commercial-execution-subsection">
                <div className="commercial-execution-subsection-header">
                  <h4>Activar cadencia</h4>
                  <span>
                    {showAllCadences
                      ? dashboard?.cadences?.activateCount ||
                        suggestedActivateCadences.length
                      : suggestedActivateCadences.length}
                  </span>
                </div>
                <div className="commercial-execution-list">
                  {suggestedActivateCadences.map((cadence) => (
                    <article
                      key={`${cadence.opportunityId}-${cadence.cadenceType}`}
                      className="commercial-execution-item-card"
                    >
                      <div className="commercial-execution-item-topline">
                        <strong>{cadence.title}</strong>
                        <div className="commercial-execution-pill-row">
                          <span className="commercial-execution-cadence-pill is-activate">
                            {getCadenceDecisionLabel(cadence.cadenceDecision)}
                          </span>
                          <span>Score {cadence.frictionScore}</span>
                        </div>
                      </div>
                      <p>
                        {cadence.opportunityName} · {cadence.accountName}
                      </p>
                      <p>{cadence.description}</p>
                      {cadence.frictionReasons?.length ? (
                        <div className="commercial-execution-tag-row">
                          {cadence.frictionReasons.map((reason) => (
                            <span
                              key={reason}
                              className="commercial-execution-tag is-alert"
                            >
                              {reason}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <div className="commercial-execution-steps-list">
                        {cadence.steps.map((step) => (
                          <span key={step}>{step}</span>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="primary-button"
                        disabled={
                          savingCadenceKey ===
                          `suggested-${cadence.opportunityId}-${cadence.cadenceType}`
                        }
                        onClick={() => handleActivateCadence(cadence)}
                      >
                        Activar cadencia
                      </button>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}

            {suggestedWatchCadences.length ? (
              <div className="commercial-execution-subsection">
                <div className="commercial-execution-subsection-header">
                  <h4>Vigilar</h4>
                  <span>
                    {showAllCadences
                      ? dashboard?.cadences?.watchCount ||
                        suggestedWatchCadences.length
                      : suggestedWatchCadences.length}
                  </span>
                </div>
                <div className="commercial-execution-list">
                  {suggestedWatchCadences.map((cadence) => (
                    <article
                      key={`${cadence.opportunityId}-${cadence.cadenceType}`}
                      className="commercial-execution-item-card"
                    >
                      <div className="commercial-execution-item-topline">
                        <strong>{cadence.opportunityName}</strong>
                        <div className="commercial-execution-pill-row">
                          <span className="commercial-execution-cadence-pill is-watch">
                            {getCadenceDecisionLabel(cadence.cadenceDecision)}
                          </span>
                          <span>Score {cadence.frictionScore}</span>
                        </div>
                      </div>
                      <p>{cadence.description}</p>
                      {cadence.frictionReasons?.length ? (
                        <div className="commercial-execution-tag-row">
                          {cadence.frictionReasons.map((reason) => (
                            <span
                              key={reason}
                              className="commercial-execution-tag is-soft-alert"
                            >
                              {reason}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {cadence.protectiveSignals?.length ? (
                        <div className="commercial-execution-tag-row">
                          {cadence.protectiveSignals.map((signal) => (
                            <span
                              key={signal}
                              className="commercial-execution-tag is-positive"
                            >
                              {signal}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              </div>
            ) : null}

            {!visibleSuggestedCadences.length ? (
              <div className="empty-state">
                No hay oportunidades que requieran vigilancia o activacion de
                cadencia.
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {activeTab === "risks" ? (
        <section className="commercial-execution-block">
          <div className="commercial-execution-block-header">
            <h3>Mapa de riesgos comerciales</h3>
            <span>
              {dashboard?.risks?.length || 0} oportunidades en vigilancia
            </span>
          </div>
          <div className="commercial-execution-risk-grid">
            {(dashboard?.risks || []).map((item) => (
              <article
                key={item.id}
                className="commercial-execution-item-card is-risk"
              >
                <div className="commercial-execution-item-topline">
                  <strong>{item.name}</strong>
                  <span
                    className={`commercial-execution-risk-badge ${getRiskToneClass(item.riskLevel)}`}
                  >
                    {getRiskLabel(item.riskLevel)}
                  </span>
                </div>
                <p>
                  {item.accountName} · {item.stageName}
                </p>
                <div className="commercial-execution-tag-row">
                  {item.riskReasons.map((reason) => (
                    <span key={reason} className="commercial-execution-tag">
                      {reason}
                    </span>
                  ))}
                </div>
                {(item.dependencies || []).length ? (
                  <div className="commercial-execution-steps-list">
                    {item.dependencies.map((dependency) => (
                      <span key={dependency.id}>
                        {dependency.dependencyLabel}: {dependency.title}
                      </span>
                    ))}
                  </div>
                ) : null}
                <p>
                  Proximo movimiento sugerido:{" "}
                  {item.nextStep?.title ||
                    getRecommendedNextMoveText(item.recommendedNextMove) ||
                    "Definir próximo paso"}
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === "management" ? (
        <div className="commercial-execution-overview-grid">
          <section className="commercial-execution-block">
            <div className="commercial-execution-block-header">
              <h3>Vista por vendedor</h3>
              <span>
                {dashboard?.management?.sellerStats?.length || 0} responsables
              </span>
            </div>
            <div className="commercial-execution-table-wrap">
              <table className="commercial-execution-table">
                <thead>
                  <tr>
                    <th>Vendedor</th>
                    <th>Pipeline</th>
                    <th>Riesgos</th>
                    <th>Vencidos</th>
                    <th>Sin paso</th>
                    <th>Esperando cliente</th>
                    <th>Esperando interno</th>
                    <th>Bloqueadas</th>
                    <th>Cadencias</th>
                    <th>Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {(dashboard?.management?.sellerStats || []).map((item) => (
                    <tr
                      key={`${item.sellerUserId || "none"}-${item.sellerUserName}`}
                    >
                      <td>{item.sellerUserName}</td>
                      <td>{item.openPipeline}</td>
                      <td>{item.riskyOpportunities}</td>
                      <td>{item.overdueFollowUps}</td>
                      <td>{item.withoutNextStep}</td>
                      <td>{item.waitingClient || 0}</td>
                      <td>{item.waitingInternal || 0}</td>
                      <td>{item.blocked || 0}</td>
                      <td>{item.activeCadences}</td>
                      <td>{formatCurrency(item.totalAmountUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="commercial-execution-block">
            <div className="commercial-execution-block-header">
              <h3>Cuellos de botella por etapa</h3>
              <span>
                {dashboard?.management?.stageStats?.length || 0} etapas activas
              </span>
            </div>
            <div className="commercial-execution-table-wrap">
              <table className="commercial-execution-table">
                <thead>
                  <tr>
                    <th>Etapa</th>
                    <th>Volumen</th>
                    <th>En riesgo</th>
                    <th>Sin paso</th>
                    <th>Bloqueadas</th>
                    <th>Esperando interno</th>
                  </tr>
                </thead>
                <tbody>
                  {(dashboard?.management?.stageStats || []).map((item) => (
                    <tr key={item.stageCode}>
                      <td>{item.stageName}</td>
                      <td>{item.count}</td>
                      <td>{item.riskyCount}</td>
                      <td>{item.noNextStepCount}</td>
                      <td>{item.blockedCount || 0}</td>
                      <td>{item.waitingInternalCount || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="commercial-execution-block">
            <div className="commercial-execution-block-header">
              <h3>Estados de ejecucion</h3>
              <span>
                {dashboard?.management?.executionStateStats?.length || 0}{" "}
                estados
              </span>
            </div>
            <div className="commercial-execution-table-wrap">
              <table className="commercial-execution-table">
                <thead>
                  <tr>
                    <th>Estado</th>
                    <th>Oportunidades</th>
                  </tr>
                </thead>
                <tbody>
                  {(dashboard?.management?.executionStateStats || []).map(
                    (item) => (
                      <tr key={item.code}>
                        <td>{item.label}</td>
                        <td>{item.count}</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="commercial-execution-block">
            <div className="commercial-execution-block-header">
              <h3>Dependencias internas</h3>
              <span>
                {dashboard?.management?.dependencyStats?.length || 0} frentes
              </span>
            </div>
            <div className="commercial-execution-table-wrap">
              <table className="commercial-execution-table">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>Abiertas</th>
                    <th>Vencidas</th>
                  </tr>
                </thead>
                <tbody>
                  {(dashboard?.management?.dependencyStats || []).map(
                    (item) => (
                      <tr key={item.dependencyType}>
                        <td>{item.dependencyLabel}</td>
                        <td>{item.openCount}</td>
                        <td>{item.overdueCount}</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
