import { useEffect, useMemo, useState } from "react";
import { api, getApiErrorMessage } from "./api";

function formatDateTime(value) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return date.toLocaleString("es-MX");
}

function formatDate(value) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return date.toLocaleDateString("es-MX");
}

function formatPriorityLabel(value) {
  switch (value) {
    case "critical":
      return "Crítica";
    case "high":
      return "Alta";
    case "medium":
      return "Media";
    case "low":
      return "Baja";
    default:
      return "Observación";
  }
}

function formatCaseTypeLabel(value) {
  switch (value) {
    case "reactivacion":
      return "Reactivación";
    case "expansion":
      return "Expansión";
    case "promovible":
      return "Promovible";
    case "riesgo_fuga":
      return "Riesgo de fuga";
    default:
      return "Nueva";
  }
}

function formatCaseStateLabel(value) {
  switch (value) {
    case "new":
      return "Nueva";
    case "in_review":
      return "Revisión gerencial";
    case "accepted":
      return "Aceptada";
    case "postponed":
      return "Pospuesta";
    case "converted":
      return "Convertida";
    case "dismissed":
      return "Descartada";
    case "expired":
      return "Expirada";
    default:
      return "Sin estado";
  }
}

function buildCaseStateIconClass(value) {
  switch (value) {
    case "new":
      return "is-new";
    case "in_review":
      return "is-in-review";
    case "accepted":
      return "is-accepted";
    case "postponed":
      return "is-postponed";
    case "converted":
      return "is-converted";
    case "dismissed":
      return "is-dismissed";
    case "expired":
      return "is-expired";
    default:
      return "is-unknown";
  }
}

function formatActionLabel(value) {
  switch (value) {
    case "crear_oportunidad":
      return "Crear oportunidad";
    case "agendar_reunion":
      return "Agendar reunión";
    case "llamar_contacto":
      return "Llamar contacto";
    case "enviar_material":
      return "Enviar material";
    case "investigar_cuenta":
      return "Investigar cuenta";
    case "reasignar_owner":
      return "Asignar caso";
    case "descartar":
      return "Descartar";
    default:
      return "Validar necesidad";
  }
}

function formatPeopleList(items, emptyLabel) {
  const names = (Array.isArray(items) ? items : [])
    .map((item) => String(item?.fullName || "").trim())
    .filter(Boolean);
  return names.length ? names.join(", ") : emptyLabel;
}

function buildDefaultConvertDraft(detail) {
  const closeDate = new Date();
  closeDate.setDate(closeDate.getDate() + 30);
  return {
    name: detail?.title || "",
    amountUsd: "",
    closeDate: closeDate.toISOString().slice(0, 10),
  };
}

const STATE_FILTER_OPTIONS = [
  { value: "all", label: "General" },
  { value: "new", label: "Nuevas" },
  { value: "accepted", label: "Aceptadas" },
  { value: "postponed", label: "Pospuestas" },
  { value: "converted", label: "Convertidas" },
  { value: "dismissed", label: "Descartadas" },
];

function PotentialOpportunityActionIconButton({
  label,
  onClick,
  disabled,
  tone = "default",
  children,
}) {
  return (
    <button
      type="button"
      className={`potential-opportunity-action-icon-btn is-${tone}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

export default function PotentialOpportunitiesPage({ can, currentUser }) {
  const [filters, setFilters] = useState({
    search: "",
    state: "all",
    priorityLevel: "all",
    caseType: "all",
    sortBy: "priority",
    sortDirection: "desc",
  });
  const [summary, setSummary] = useState(null);
  const [cases, setCases] = useState([]);
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [detail, setDetail] = useState(null);
  const [convertDraft, setConvertDraft] = useState({
    name: "",
    amountUsd: "",
    closeDate: "",
  });
  const [assignmentOptions, setAssignmentOptions] = useState([]);
  const [assignmentSelectionMode, setAssignmentSelectionMode] = useState("");
  const [selectedOwnerUserId, setSelectedOwnerUserId] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [actionLoading, setActionLoading] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const canReview = can("oportunidades_potenciales.review");
  const canAssign = can("oportunidades_potenciales.assign");
  const canConvert = can("oportunidades_potenciales.convert");

  async function loadSummary(nextFilters = filters) {
    const response = await api.get("/api/potential-opportunities/summary", {
      params: nextFilters,
    });
    setSummary(response.data);
  }

  async function loadCases(nextFilters = filters) {
    setLoadingList(true);
    try {
      const response = await api.get("/api/potential-opportunities", {
        params: nextFilters,
      });
      const items = response.data.items || [];
      setCases(items);
      setSelectedCaseId((current) => {
        if (current && items.some((item) => item.publicId === current)) {
          return current;
        }
        return items[0]?.publicId || "";
      });
    } finally {
      setLoadingList(false);
    }
  }

  async function loadDetail(caseId) {
    if (!caseId) {
      setDetail(null);
      return;
    }
    setLoadingDetail(true);
    try {
      const response = await api.get(`/api/potential-opportunities/${caseId}`);
      setDetail(response.data);
      setConvertDraft(buildDefaultConvertDraft(response.data));
    } finally {
      setLoadingDetail(false);
    }
  }

  async function loadAssignmentOptions(caseId) {
    if (!canAssign || !caseId) {
      setAssignmentOptions([]);
      setAssignmentSelectionMode("");
      return;
    }

    const response = await api.get(
      `/api/potential-opportunities/${caseId}/assignment-options`,
    );
    setAssignmentOptions(
      Array.isArray(response.data?.items) ? response.data.items : [],
    );
    setAssignmentSelectionMode(String(response.data?.selectionMode || ""));
  }

  async function refreshAll(nextFilters = filters) {
    setError("");
    await Promise.all([loadSummary(nextFilters), loadCases(nextFilters)]);
  }

  useEffect(() => {
    refreshAll(filters).catch((requestError) => {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar oportunidades potenciales",
        ),
      );
    });
  }, []);

  useEffect(() => {
    loadDetail(selectedCaseId).catch((requestError) => {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar el detalle del caso",
        ),
      );
    });
  }, [selectedCaseId]);

  useEffect(() => {
    if (!detail) {
      setSelectedOwnerUserId("");
      setAssignmentOptions([]);
      setAssignmentSelectionMode("");
      return;
    }
    if (detail.owner?.id) {
      setSelectedOwnerUserId(String(detail.owner.id));
    } else {
      setSelectedOwnerUserId("");
    }

    if (!canAssign) {
      setAssignmentOptions([]);
      setAssignmentSelectionMode("");
      return;
    }

    loadAssignmentOptions(detail.publicId).catch((requestError) => {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar los usuarios asignables",
        ),
      );
    });
  }, [detail, canAssign]);

  const filterQuery = useMemo(
    () => ({
      ...filters,
      search: filters.search.trim(),
    }),
    [filters],
  );

  async function applyStateFilter(nextState) {
    const nextFilters = {
      ...filters,
      state: nextState,
    };
    setFilters(nextFilters);
    try {
      await refreshAll({
        ...nextFilters,
        search: String(nextFilters.search || "").trim(),
      });
    } catch (requestError) {
      setError(
        getApiErrorMessage(requestError, "No fue posible aplicar el filtro"),
      );
    }
  }

  async function applyFilters(event) {
    event.preventDefault();
    try {
      await refreshAll(filterQuery);
    } catch (requestError) {
      setError(
        getApiErrorMessage(requestError, "No fue posible aplicar los filtros"),
      );
    }
  }

  function toggleSort(sortBy) {
    const nextDirection =
      filters.sortBy === sortBy && filters.sortDirection === "desc"
        ? "asc"
        : "desc";
    const nextFilters = {
      ...filters,
      sortBy,
      sortDirection: nextDirection,
    };
    setFilters(nextFilters);
    refreshAll({
      ...nextFilters,
      search: String(nextFilters.search || "").trim(),
    }).catch((requestError) => {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible ordenar la lista de casos",
        ),
      );
    });
  }

  function getSortArrow(sortBy) {
    if (filters.sortBy !== sortBy) return "↕";
    return filters.sortDirection === "asc" ? "↑" : "↓";
  }

  async function handleRunDetection() {
    setActionLoading("run-detection");
    setSuccess("");
    setError("");
    try {
      await api.post("/api/potential-opportunities/run-detection", {
        sourceEntityIds: [],
        forceRebuild: false,
      });
      await refreshAll(filterQuery);
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible ejecutar la detección",
        ),
      );
    } finally {
      setActionLoading("");
    }
  }

  async function runCaseAction(actionPath, body, successMessage) {
    if (!detail) return;
    setActionLoading(actionPath);
    setSuccess("");
    setError("");
    try {
      await api.post(
        `/api/potential-opportunities/${detail.publicId}/${actionPath}`,
        body,
      );
      await refreshAll(filterQuery);
      await loadDetail(detail.publicId);
      setSuccess(successMessage);
    } catch (requestError) {
      setError(
        getApiErrorMessage(requestError, "No fue posible ejecutar la acción"),
      );
    } finally {
      setActionLoading("");
    }
  }

  async function handleDismiss() {
    const reasonCode = window.prompt("Motivo de descarte", "falso_positivo");
    if (!reasonCode) return;
    await runCaseAction(
      "dismiss",
      { reasonCode, reasonNote: "Descartado desde bandeja" },
      "Caso descartado",
    );
  }

  async function handlePostpone() {
    const postponedUntil = window.prompt(
      "Retomar después (YYYY-MM-DD)",
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    );
    if (!postponedUntil) return;
    const reasonCode = window.prompt(
      "Motivo para retomarlo después",
      "esperando_timing_cliente",
    );
    if (!reasonCode) return;
    await runCaseAction(
      "postpone",
      { postponedUntil, reasonCode, reasonNote: "Pospuesto desde bandeja" },
      "Caso marcado para retomar después",
    );
  }

  async function handleAssignOwner() {
    if (!selectedOwnerUserId) return;
    const selectedUser = assignmentOptions.find(
      (item) => Number(item.id) === Number(selectedOwnerUserId),
    );
    await runCaseAction(
      "assign-owner",
      { ownerUserId: Number(selectedOwnerUserId) },
      selectedUser
        ? `Owner reasignado a ${selectedUser.fullName}`
        : "Owner reasignado",
    );
  }

  async function handleConvert(event) {
    event.preventDefault();
    if (!detail) return;
    setActionLoading("convert");
    setSuccess("");
    setError("");
    try {
      const response = await api.post(
        `/api/potential-opportunities/${detail.publicId}/convert`,
        {
          name: convertDraft.name,
          amountUsd: convertDraft.amountUsd
            ? Number(convertDraft.amountUsd)
            : 0,
          closeDate: convertDraft.closeDate,
          primaryContactId: detail.primaryContact?.id || null,
          ownerUserId: detail.owner?.id || null,
        },
      );
      await refreshAll(filterQuery);
      await loadDetail(detail.publicId);
      setSuccess(
        `Caso convertido a oportunidad ${response.data.opportunityId}.`,
      );
    } catch (requestError) {
      setError(
        getApiErrorMessage(requestError, "No fue posible convertir el caso"),
      );
    } finally {
      setActionLoading("");
    }
  }

  const hasAssignedSellerOwner = Boolean(
    detail?.owner?.id && detail?.owner?.isSeller,
  );
  const convertBlockedMessage = !detail
    ? ""
    : !detail.owner?.id
      ? "Asigna primero un vendedor al caso; esa persona quedará como vendedor de la oportunidad al convertir."
      : !detail.owner.isSeller
        ? "El asignado actual del caso sería el vendedor de la oportunidad, pero no tiene rol de vendedor. Reasigna el caso a un vendedor antes de convertirlo."
        : "";

  return (
    <section className="panel potential-opportunities-page">
      <div className="potential-opportunities-toolbar">
        <div>
          <div className="potential-opportunities-title-row">
            <h2>Oportunidades potenciales</h2>
            <details className="potential-opportunities-help">
              <summary
                className="potential-opportunities-help-trigger"
                aria-label="Ayuda sobre oportunidades potenciales"
                title="Ayuda sobre el módulo"
              >
                ?
              </summary>
              <div className="potential-opportunities-help-popover">
                <strong>Para qué sirve</strong>
                <p>
                  Este módulo ayuda a la gerencia comercial a detectar,
                  priorizar y distribuir señales comerciales encontradas en
                  interacciones ya analizadas.
                </p>
                <strong>Cómo usarlo</strong>
                <p>
                  La gerencia revisa los casos con mayor score, valida la
                  hipótesis y asigna seguimiento. El vendedor usa sus casos para
                  dar seguimiento y convertirlos cuando ya ameriten abrir una
                  oportunidad formal.
                </p>
              </div>
            </details>
          </div>
          <p className="section-helper-text">
            La gerencia comercial prioriza señales detectadas y los vendedores
            trabajan los casos para convertirlos en pipeline real.
          </p>
        </div>
        {canReview ? (
          <div className="potential-opportunities-toolbar-actions">
            <PotentialOpportunityActionIconButton
              label={
                actionLoading === "run-detection"
                  ? "Detectando"
                  : "Ejecutar detección"
              }
              onClick={handleRunDetection}
              disabled={actionLoading === "run-detection"}
              tone="review"
            >
              <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                <path d="M4 12a8 8 0 0 1 13.7-5.6" />
                <path d="M18 4v4h-4" />
                <path d="M20 12a8 8 0 0 1-13.7 5.6" />
                <path d="M6 20v-4h4" />
              </svg>
            </PotentialOpportunityActionIconButton>
          </div>
        ) : null}
      </div>

      {error ? <div className="form-error">{error}</div> : null}
      {success ? <div className="form-success">{success}</div> : null}

      <div className="potential-opportunities-top-strip">
        <div className="potential-opportunities-filter-panel">
          <div className="potential-opportunities-filter-heading">
            <span>Filtrar por estado</span>
          </div>
          <div
            className="potential-opportunities-state-tabs"
            role="tablist"
            aria-label="Filtrar por estado"
          >
            {STATE_FILTER_OPTIONS.map((option) => {
              const isActive = filters.state === option.value;
              const stateIconClass =
                option.value === "all"
                  ? "is-unknown"
                  : buildCaseStateIconClass(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`potential-opportunities-state-tab${isActive ? " is-active" : ""}`}
                  onClick={() => void applyStateFilter(option.value)}
                >
                  <span
                    className={`potential-opportunity-state-icon ${stateIconClass}`}
                    aria-hidden="true"
                  />
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>

          <form
            className="potential-opportunities-filters"
            onSubmit={applyFilters}
          >
            <input
              type="search"
              value={filters.search}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  search: event.target.value,
                }))
              }
              placeholder="Buscar por caso, cuenta o hipótesis"
            />
            <select
              value={filters.priorityLevel}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  priorityLevel: event.target.value,
                }))
              }
            >
              <option value="all">Todas las prioridades</option>
              <option value="critical">Crítica</option>
              <option value="high">Alta</option>
              <option value="medium">Media</option>
              <option value="low">Baja</option>
              <option value="observe">Observación</option>
            </select>
            <select
              value={filters.caseType}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  caseType: event.target.value,
                }))
              }
            >
              <option value="all">Todos los tipos</option>
              <option value="nueva">Nueva</option>
              <option value="reactivacion">Reactivación</option>
              <option value="expansion">Expansión</option>
              <option value="promovible">Promovible</option>
              <option value="riesgo_fuga">Riesgo de fuga</option>
            </select>
            <PotentialOpportunityActionIconButton
              label="Aplicar filtros"
              disabled={false}
              tone="default"
            >
              <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                <path d="M4 6h16" />
                <path d="M7 12h10" />
                <path d="M10 18h4" />
              </svg>
            </PotentialOpportunityActionIconButton>
          </form>
        </div>

        <div className="potential-opportunities-summary-panel">
          <div className="potential-opportunities-summary">
            <div className="potential-opportunity-summary-card">
              <span>Nuevas</span>
              <strong>{summary?.kpis?.newCount || 0}</strong>
            </div>
            <div className="potential-opportunity-summary-card">
              <span>Críticas</span>
              <strong>{summary?.kpis?.criticalCount || 0}</strong>
            </div>
            <div className="potential-opportunity-summary-card">
              <span>Alta prioridad</span>
              <strong>{summary?.kpis?.highCount || 0}</strong>
            </div>
            <div className="potential-opportunity-summary-card">
              <span>Sin asignado</span>
              <strong>{summary?.kpis?.withoutOwnerCount || 0}</strong>
            </div>
            <div className="potential-opportunity-summary-card">
              <span>Vencidas</span>
              <strong>{summary?.kpis?.staleCount || 0}</strong>
            </div>
            <div className="potential-opportunity-summary-card">
              <span>Conversiones últimos 30 días</span>
              <strong>{summary?.kpis?.convertedLast30Days || 0}</strong>
            </div>
          </div>
          <div className="potential-opportunities-score-note">
            <span
              className="potential-opportunities-score-note-icon"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M12 3 14.7 8.3 20.5 9.2 16.2 13.3 17.2 19.1 12 16.3 6.8 19.1 7.8 13.3 3.5 9.2 9.3 8.3Z" />
              </svg>
            </span>
            <span className="sr-only">Score:</span>
            <span>
              0-100 segun claridad de senal, urgencia, engagement, cobertura y
              siguiente paso.
            </span>
          </div>
        </div>
      </div>

      <div className="potential-opportunities-content">
        <div className="potential-opportunity-list-card">
          <div className="potential-opportunity-list-header">
            <button
              type="button"
              className="sort-header-btn"
              onClick={() => toggleSort("title")}
            >
              Caso <span>{getSortArrow("title")}</span>
            </button>
            <button
              type="button"
              className="sort-header-btn"
              onClick={() => toggleSort("created_at")}
            >
              Fecha <span>{getSortArrow("created_at")}</span>
            </button>
            <button
              type="button"
              className="sort-header-btn"
              onClick={() => toggleSort("priority")}
            >
              Prioridad <span>{getSortArrow("priority")}</span>
            </button>
            <button
              type="button"
              className="sort-header-btn"
              onClick={() => toggleSort("account")}
            >
              Cuenta <span>{getSortArrow("account")}</span>
            </button>
            <button
              type="button"
              className="sort-header-btn"
              onClick={() => toggleSort("owner")}
            >
              Asignado <span>{getSortArrow("owner")}</span>
            </button>
            <button
              type="button"
              className="sort-header-btn"
              onClick={() => toggleSort("recommended_action")}
            >
              Acción sugerida <span>{getSortArrow("recommended_action")}</span>
            </button>
          </div>
          {loadingList ? (
            <div className="centered">Cargando casos...</div>
          ) : cases.length ? (
            <div className="potential-opportunity-list">
              {cases.map((item) => {
                const isSelected = item.publicId === selectedCaseId;
                return (
                  <button
                    key={item.publicId}
                    type="button"
                    className={`potential-opportunity-list-row${isSelected ? " is-selected" : ""}`}
                    onClick={() => setSelectedCaseId(item.publicId)}
                  >
                    <div>
                      <strong>{item.title}</strong>
                      <div className="potential-opportunity-state-line muted-text">
                        <span
                          className={`potential-opportunity-state-icon ${buildCaseStateIconClass(
                            item.state,
                          )}`}
                          aria-hidden="true"
                        />
                        <span>{formatCaseTypeLabel(item.caseType)}</span>
                        <span>·</span>
                        <span>{formatCaseStateLabel(item.state)}</span>
                      </div>
                    </div>
                    <div>
                      <div className="muted-text potential-opportunity-date-cell">
                        {formatDate(item.createdAt)}
                      </div>
                    </div>
                    <div>
                      <span
                        className={`priority-pill priority-${item.priorityLevel}`}
                      >
                        {formatPriorityLabel(item.priorityLevel)}
                      </span>
                      <div className="muted-text potential-opportunity-score-inline">
                        <span
                          className="potential-opportunities-score-note-icon potential-opportunity-score-inline-icon"
                          aria-hidden="true"
                        >
                          <svg viewBox="0 0 24 24" focusable="false">
                            <path d="M12 3 14.7 8.3 20.5 9.2 16.2 13.3 17.2 19.1 12 16.3 6.8 19.1 7.8 13.3 3.5 9.2 9.3 8.3Z" />
                          </svg>
                        </span>
                        <span className="sr-only">Score </span>
                        <span>{item.totalScore}</span>
                      </div>
                    </div>
                    <div>
                      <strong>{item.account.name}</strong>
                      <div className="muted-text">
                        {item.primaryContact?.fullName ||
                          "Sin contacto principal"}
                      </div>
                      <div className="muted-text">
                        Responsables cuenta:{" "}
                        {formatPeopleList(
                          item.accountOwners,
                          "Sin responsables",
                        )}
                      </div>
                    </div>
                    <div>
                      <strong>{item.owner?.fullName || "Sin asignar"}</strong>
                    </div>
                    <div>
                      <strong>
                        {formatActionLabel(item.recommendedAction)}
                      </strong>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="centered">
              No hay casos para los filtros actuales.
            </div>
          )}
        </div>

        <div className="potential-opportunity-detail-card">
          {loadingDetail ? (
            <div className="centered">Cargando detalle...</div>
          ) : detail ? (
            <div className="potential-opportunity-detail">
              <div className="potential-opportunity-detail-header">
                <div>
                  <h3>{detail.title}</h3>
                  <div className="potential-opportunity-state-line muted-text">
                    <span
                      className={`potential-opportunity-state-icon ${buildCaseStateIconClass(
                        detail.state,
                      )}`}
                      aria-hidden="true"
                    />
                    <span>{detail.account.name}</span>
                    <span>·</span>
                    <span>{formatCaseTypeLabel(detail.caseType)}</span>
                    <span>·</span>
                    <span>{formatCaseStateLabel(detail.state)}</span>
                  </div>
                </div>
                <span
                  className={`priority-pill priority-${detail.priorityLevel}`}
                >
                  {formatPriorityLabel(detail.priorityLevel)}
                </span>
              </div>

              <div className="potential-opportunity-score-grid">
                <div>
                  <span>Score total</span>
                  <strong>{detail.scores.totalScore}</strong>
                </div>
                <div>
                  <span>Señal</span>
                  <strong>{detail.scores.signalStrengthScore}</strong>
                </div>
                <div>
                  <span>Urgencia</span>
                  <strong>{detail.scores.urgencyScore}</strong>
                </div>
                <div>
                  <span>Momentum</span>
                  <strong>{detail.scores.momentumScore}</strong>
                </div>
              </div>

              <div className="potential-opportunity-section">
                <h4>Hipótesis comercial</h4>
                <p>{detail.commercialHypothesis}</p>
              </div>

              <div className="potential-opportunity-section">
                <h4>Necesidad detectada</h4>
                <p>{detail.businessNeedSummary || "Sin resumen disponible."}</p>
              </div>

              <div className="potential-opportunity-section">
                <h4>Siguiente paso sugerido</h4>
                <p>
                  {detail.nextStepSuggestion || "Sin sugerencia disponible."}
                </p>
                <div className="muted-text">
                  Acción sugerida: {formatActionLabel(detail.recommendedAction)}
                  {detail.recommendedActionDueDate
                    ? ` · Antes de ${formatDate(detail.recommendedActionDueDate)}`
                    : ""}
                </div>
              </div>

              <div className="potential-opportunity-factor-grid">
                <div>
                  <h4>Factores a favor</h4>
                  <ul>
                    {(detail.topPositiveFactors || []).map((factor) => (
                      <li key={factor}>{factor}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4>Factores en contra</h4>
                  <ul>
                    {(detail.topNegativeFactors || []).map((factor) => (
                      <li key={factor}>{factor}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="potential-opportunity-section">
                <h4>Responsables</h4>
                <div className="potential-opportunity-responsibility-grid">
                  <div>
                    <span className="muted-text">Asignado del caso</span>
                    <strong>{detail.owner?.fullName || "Sin asignar"}</strong>
                  </div>
                  <div>
                    <span className="muted-text">Responsables de cuenta</span>
                    <strong>
                      {formatPeopleList(
                        detail.accountOwners,
                        "Sin responsables",
                      )}
                    </strong>
                  </div>
                </div>
              </div>

              <div className="potential-opportunity-section">
                <h4>Señales asociadas</h4>
                <div className="potential-opportunity-signal-list">
                  {detail.signals.map((signal) => (
                    <div
                      key={signal.publicId}
                      className="potential-opportunity-signal-item"
                    >
                      <strong>{signal.title}</strong>
                      <div className="muted-text">
                        {signal.interaction.title} · Score{" "}
                        {signal.contributionScore}
                      </div>
                      <p>{signal.description}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="potential-opportunity-actions">
                <div className="potential-opportunity-actions-toolbar">
                  {canReview &&
                  ["new", "in_review", "postponed"].includes(detail.state) ? (
                    <PotentialOpportunityActionIconButton
                      label="Aprobar para seguimiento"
                      onClick={() =>
                        runCaseAction(
                          "accept",
                          {},
                          "Caso aprobado para seguimiento comercial",
                        )
                      }
                      disabled={Boolean(actionLoading)}
                      tone="success"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        focusable="false"
                        aria-hidden="true"
                      >
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    </PotentialOpportunityActionIconButton>
                  ) : null}
                  {canReview &&
                  !["converted", "dismissed", "expired"].includes(
                    detail.state,
                  ) ? (
                    <PotentialOpportunityActionIconButton
                      label="Retomar después"
                      onClick={handlePostpone}
                      disabled={Boolean(actionLoading)}
                      tone="warning"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        focusable="false"
                        aria-hidden="true"
                      >
                        <circle cx="12" cy="12" r="8" />
                        <path d="M12 8v4l2.5 2.5" />
                      </svg>
                    </PotentialOpportunityActionIconButton>
                  ) : null}
                  {canReview &&
                  !["converted", "dismissed", "expired"].includes(
                    detail.state,
                  ) ? (
                    <PotentialOpportunityActionIconButton
                      label="Descartar"
                      onClick={handleDismiss}
                      disabled={Boolean(actionLoading)}
                      tone="danger"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        focusable="false"
                        aria-hidden="true"
                      >
                        <path d="M6 6l12 12" />
                        <path d="M18 6L6 18" />
                      </svg>
                    </PotentialOpportunityActionIconButton>
                  ) : null}
                </div>
                {canAssign && detail.state !== "accepted" ? (
                  <div className="potential-opportunity-actions-help">
                    <strong>Asignación bloqueada</strong> solo se habilita
                    cuando el caso ya fue aprobado para seguimiento.
                  </div>
                ) : null}
                {canAssign && detail.state === "accepted" ? (
                  <div className="potential-opportunity-owner-assignment">
                    <label>
                      Asignado del caso
                      <select
                        value={selectedOwnerUserId}
                        onChange={(event) =>
                          setSelectedOwnerUserId(event.target.value)
                        }
                        disabled={
                          Boolean(actionLoading) || !assignmentOptions.length
                        }
                      >
                        <option value="">Selecciona un usuario</option>
                        {assignmentOptions.map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.fullName}
                            {user.roles ? ` · ${user.roles}` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="potential-opportunity-actions-help">
                      La persona asignada a este caso será el vendedor de la
                      oportunidad cuando conviertas este caso.
                    </div>
                    {assignmentSelectionMode ===
                    "fallback_all_active_sellers" ? (
                      <div className="potential-opportunity-actions-help">
                        No hay owners vendedores definidos en la cuenta. Por
                        eso, de forma excepcional, puedes elegir cualquier
                        vendedor activo.
                      </div>
                    ) : (
                      <div className="potential-opportunity-actions-help">
                        Solo puedes asignar a uno de los owners actuales de la
                        cuenta que tenga rol de vendedor.
                      </div>
                    )}
                    <button
                      type="button"
                      className="potential-opportunity-action-icon-btn is-assign"
                      onClick={handleAssignOwner}
                      disabled={Boolean(actionLoading) || !selectedOwnerUserId}
                      aria-label={
                        detail.owner ? "Cambiar asignado" : "Asignar caso"
                      }
                      title={detail.owner ? "Cambiar asignado" : "Asignar caso"}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        focusable="false"
                        aria-hidden="true"
                      >
                        <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4z" />
                        <path d="M5 19a7 7 0 0 1 14 0" />
                        <path d="M19 8v4" />
                        <path d="M17 10h4" />
                      </svg>
                    </button>
                  </div>
                ) : null}
              </div>

              {canConvert &&
              !detail.convertedOpportunity &&
              hasAssignedSellerOwner ? (
                <form
                  className="potential-opportunity-convert-form"
                  onSubmit={handleConvert}
                >
                  <div className="potential-opportunity-convert-form-header">
                    <h4>Convertir a oportunidad</h4>
                    <p className="potential-opportunity-actions-help">
                      El asignado actual del caso se usará como vendedor de la
                      oportunidad al convertir.
                    </p>
                  </div>
                  <div className="potential-opportunity-convert-form-fields">
                    <label>
                      Nombre
                      <input
                        value={convertDraft.name}
                        onChange={(event) =>
                          setConvertDraft((current) => ({
                            ...current,
                            name: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      Monto USD
                      <input
                        value={convertDraft.amountUsd}
                        onChange={(event) =>
                          setConvertDraft((current) => ({
                            ...current,
                            amountUsd: event.target.value.replace(
                              /[^\d.]/g,
                              "",
                            ),
                          }))
                        }
                      />
                    </label>
                    <label>
                      Fecha de cierre
                      <input
                        type="date"
                        value={convertDraft.closeDate}
                        onChange={(event) =>
                          setConvertDraft((current) => ({
                            ...current,
                            closeDate: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>
                  <div className="potential-opportunity-convert-form-actions">
                    <button
                      type="submit"
                      className="potential-opportunity-action-icon-btn is-success"
                      disabled={actionLoading === "convert"}
                      aria-label={
                        actionLoading === "convert"
                          ? "Convirtiendo"
                          : "Convertir a oportunidad"
                      }
                      title={
                        actionLoading === "convert"
                          ? "Convirtiendo"
                          : "Convertir a oportunidad"
                      }
                    >
                      <svg
                        viewBox="0 0 24 24"
                        focusable="false"
                        aria-hidden="true"
                      >
                        <path d="M4 12h10" />
                        <path d="M10 6l6 6-6 6" />
                        <path d="M20 5v14" />
                      </svg>
                    </button>
                  </div>
                </form>
              ) : null}

              {canConvert &&
              !detail.convertedOpportunity &&
              !hasAssignedSellerOwner ? (
                <div className="potential-opportunity-actions-help">
                  <strong>Conversión bloqueada</strong> {convertBlockedMessage}
                </div>
              ) : null}

              {detail.convertedOpportunity ? (
                <div className="form-success">
                  Convertida a la oportunidad #{detail.convertedOpportunity.id}:{" "}
                  {detail.convertedOpportunity.name}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="centered">
              Selecciona un caso para ver su detalle.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
