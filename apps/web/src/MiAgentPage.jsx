import { useEffect, useMemo, useRef, useState } from "react";
import { api, getApiErrorMessage } from "./api";
import "./mi-agent.css";
import "./mi-agent-detail.css";
import "./mi-agent-execution-kit.css";
import "./mi-agent-health.css";
import "./mi-agent-alerts.css";
import "./mi-agent-activity-progress.css";
import "./mi-agent-activity-message.css";
import "./mi-agent-coach.css";
import "./mi-agent-coach-thread.css";

const PRIORITY_LABELS = {
  critical: "Critica",
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

const ACTION_STATUS_LABELS = {
  pending: "Pendiente",
  done: "Creada",
};

const COACH_POLL_TIMEOUT_MS = 90000;

const COACH_RESPONSE_TYPE_LABELS = {
  informational: "Consulta informativa",
  recommendation: "Recomendación",
  change_request: "Solicitud de cambio",
  operation: "Operación completada",
  error: "Error de operación",
};

const COACH_CONFIDENCE_LABELS = {
  high: "Alta confianza",
  medium: "Confianza media",
  low: "Baja confianza",
};

const COACH_ACTIVITY_TYPE_OPTIONS = [
  ["call", "Llamada"],
  ["conference", "Reunión"],
  ["presentation", "Demostración"],
  ["visit", "Visita"],
  ["send_email", "Correo"],
  ["next_step", "Tarea de seguimiento"],
  ["waiting_customer", "Esperando cliente"],
  ["other", "Otro"],
];

const COACH_ACTIVITY_TYPE_ALIASES = {
  meeting: "conference",
  demo: "presentation",
  follow_up: "call",
};

function normalizeCoachActivityType(value) {
  return COACH_ACTIVITY_TYPE_ALIASES[value] || value || "other";
}

function formatCurrency(value, currency = "USD") {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return "Sin fecha";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(date);
}

function buildSnapshot(dashboard) {
  const development = dashboard?.development || dashboard || {};
  const quota = development.quota || {};
  const workboard = Array.isArray(dashboard?.workboard)
    ? dashboard.workboard
    : [];
  // El endpoint propio de Mi agente ya devuelve únicamente oportunidades calificadas.
  const qualified = workboard;

  return {
    period: development.period || dashboard?.period || null,
    quota: {
      assignedAmount: Number(quota.assignedAmount || 0),
      actualAmount: Number(quota.actualAmount || 0),
      gapAmount: Number(quota.gapAmount || 0),
      committedOpenAmount: Number(quota.committedOpenAmount || 0),
      weightedOpenAmount: Number(quota.weightedOpenAmount || 0),
      currencyCode:
        quota.currencyCode ||
        development.period?.baseCurrencyCode ||
        dashboard?.period?.baseCurrencyCode ||
        "USD",
    },
    pipeline: {
      qualifiedAmount: qualified.reduce(
        (sum, item) => sum + Number(item.amountUsd || 0),
        0,
      ),
      qualifiedCount: qualified.length,
      opportunities: qualified.map((item) => ({
        id: Number(item.id),
        name: item.name || "",
        accountName: item.accountName || "",
        amountUsd: Number(item.amountUsd || 0),
        closeDate: item.closeDate || null,
        updatedAt: item.updatedAt || null,
        stageCode: item.stageCode || "",
        stageName: item.stageName || "",
        riskLevel: item.riskLevel || "low",
        riskReasons: Array.isArray(item.riskReasons) ? item.riskReasons.slice(0, 4) : [],
        daysSinceActivity: Number(item.daysSinceActivity || 0),
        currentStageValidated: Boolean(item.currentStageValidated),
        openWeaknesses: Array.isArray(item.openWeaknesses) ? item.openWeaknesses : [],
        nextStep: item.nextStep || null,
        nextPendingAction: item.nextPendingAction || null,
        recommendedStrategySteps: Array.isArray(item.recommendedStrategySteps)
          ? item.recommendedStrategySteps.slice(0, 3)
          : [],
      })),
    },
    summary: dashboard?.summary || {},
  };
}

function buildCoachClarification(result, snapshot) {
  const action = result?.action;
  const unresolvedActivity = Array.isArray(result?.operations)
    ? result.operations.find((operation) => operation?.kind === "activity" && !operation.opportunityId)
    : null;
  if ((!action?.title || action.opportunityId) && !unresolvedActivity) return null;
  const candidates = Array.isArray(snapshot?.pipeline?.opportunities)
    ? snapshot.pipeline.opportunities.slice(0, 8)
    : [];
  return {
    message: "Para registrar esta actividad falta seleccionar la oportunidad.",
    missing: ["Oportunidad", "Fecha completa"],
    candidates,
    activity: {
      title: unresolvedActivity?.title || action?.title || "Actividad comercial",
      actionType: unresolvedActivity?.actionType || action?.actionType || "meeting",
      scheduledAt: unresolvedActivity?.scheduledAt || action?.scheduledAt || "",
      dueDate: unresolvedActivity?.dueDate || action?.suggestedDueDate || "",
      priority: unresolvedActivity?.priority || action?.priority || "medium",
      notes: unresolvedActivity?.notes || "",
      successCriteria: unresolvedActivity?.successCriteria || action?.successCriteria || "Definir el siguiente compromiso del cliente.",
    },
  };
}

function formatCoachOperationSummary(operation) {
  if (operation?.kind === "activity") {
    return `${operation.actionType || "Actividad"} · ${operation.scheduledAt || "Fecha pendiente"} · ${operation.priority || "Prioridad pendiente"}`;
  }
  if (operation?.kind === "stage_answer") return `Respuesta de etapa: ${operation.answerValue || "Pendiente"}`;
  if (operation?.kind === "lead_call_outcome") return `Resultado del lead: ${operation.substatusCode || "Pendiente"}`;
  if (operation?.kind === "lead_resolve") return "Resolver y materializar lead";
  if (operation?.kind === "create_account") return "Crear cuenta";
  if (operation?.kind === "create_contact") return "Crear contacto";
  if (operation?.kind === "create_opportunity") return "Crear oportunidad";
  return `${operation?.field || "Cambio"}: ${operation?.value ?? "Valor pendiente"}`;
}

export default function MiAgentPage({ currentUser, canCreateActions = false, canUpdateLeads = false, canUpdateAccounts = false, canUpdateContacts = false, canCreateAccounts = false, canCreateContacts = false, canResolveLeads = false, canCreateOpportunities = false, canUpdateCommercialDevelopment = false }) {
  const [dashboard, setDashboard] = useState(null);
  const [coachAccounts, setCoachAccounts] = useState([]);
  const [coachAccountSearch, setCoachAccountSearch] = useState("");
  const [coachOpportunities, setCoachOpportunities] = useState([]);
  const [coachContacts, setCoachContacts] = useState([]);
  const [coachContext, setCoachContext] = useState({ accountId: "", opportunityId: "", contactId: "" });
  const [loadingCoachContext, setLoadingCoachContext] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [creatingActionRank, setCreatingActionRank] = useState(null);
  const [error, setError] = useState("");
  const [coachNotice, setCoachNotice] = useState("");
  const [selectedAction, setSelectedAction] = useState(null);
  const [coachQuestion, setCoachQuestion] = useState("");
  const [coachAnswer, setCoachAnswer] = useState(null);
  const [askingCoach, setAskingCoach] = useState(false);
  const [coachMessages, setCoachMessages] = useState([]);
  const [coachMetrics, setCoachMetrics] = useState(null);
  const [coachActionDraft, setCoachActionDraft] = useState(null);
  const [coachOperationDraft, setCoachOperationDraft] = useState(null);
  const [coachUndoAuditId, setCoachUndoAuditId] = useState(null);
  const [coachUndoLeadId, setCoachUndoLeadId] = useState(null);
  const [savingCoachOperation, setSavingCoachOperation] = useState(false);
  const coachContextRef = useRef(coachContext);
  const coachThreadRef = useRef(null);

  useEffect(() => {
    coachContextRef.current = coachContext;
  }, [coachContext]);

  useEffect(() => {
    if (coachThreadRef.current) {
      coachThreadRef.current.scrollTop = coachThreadRef.current.scrollHeight;
    }
  }, [coachMessages]);

  async function loadDashboard() {
    setLoading(true);
    setError("");
    try {
      const [{ data }, metricsResponse] = await Promise.all([
        api.get("/api/mi-agent/context"),
        api.get("/api/mi-agent/coach/metrics").catch(() => ({ data: null })),
      ]);
      setDashboard(data);
      setCoachMetrics(metricsResponse.data);
      const accountsResponse = await api.get(`/api/accounts?activeOnly=true&search=${encodeURIComponent(coachAccountSearch)}`);
      setCoachAccounts(Array.isArray(accountsResponse.data) ? accountsResponse.data : []);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "No fue posible cargar tu situación comercial"));
    } finally {
      setLoading(false);
    }
  }

  async function selectCoachAccount(accountId) {
    const normalizedId = String(accountId || "");
    setCoachContext({ accountId: normalizedId, opportunityId: "", contactId: "" });
    setCoachOpportunities([]);
    setCoachContacts([]);
    setCoachMessages([]);
    setCoachAnswer(null);
    setCoachActionDraft(null);
    setCoachOperationDraft(null);
    setCoachNotice("");
    if (!normalizedId) return;
    setLoadingCoachContext(true);
    try {
      const [opportunitiesResponse, contactsResponse] = await Promise.all([
        api.get(`/api/opportunities?accountId=${normalizedId}&activeOnly=true&openOnly=true`),
        api.get(`/api/contacts?accountId=${normalizedId}&opportunityId=${coachContext.opportunityId || ""}&activeOnly=true`),
      ]);
      setCoachOpportunities(Array.isArray(opportunitiesResponse.data) ? opportunitiesResponse.data : []);
      setCoachContacts(Array.isArray(contactsResponse.data) ? contactsResponse.data : []);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "No fue posible cargar el contexto de la cuenta"));
    } finally {
      setLoadingCoachContext(false);
    }
  }

  async function searchCoachAccounts(value) {
    setCoachAccountSearch(value);
    try {
      const response = await api.get(`/api/accounts?activeOnly=true&search=${encodeURIComponent(value)}`);
      setCoachAccounts(Array.isArray(response.data) ? response.data : []);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "No fue posible buscar cuentas"));
    }
  }

  async function selectCoachOpportunity(opportunityId) {
    setCoachContext((current) => ({ ...current, opportunityId: String(opportunityId || ""), contactId: "" }));
    setCoachMessages([]);
    setCoachAnswer(null);
    setCoachActionDraft(null);
    setCoachOperationDraft(null);
    setCoachNotice("");
    if (opportunityId && coachContext.accountId) {
      const response = await api.get(`/api/contacts?accountId=${coachContext.accountId}&opportunityId=${opportunityId}&activeOnly=true`);
      setCoachContacts(Array.isArray(response.data) && response.data.length ? response.data : coachContacts);
    }
  }

  function selectCoachContact(contactId) {
    setCoachContext((current) => ({ ...current, contactId: String(contactId || "") }));
    setCoachMessages([]);
    setCoachAnswer(null);
    setCoachActionDraft(null);
    setCoachOperationDraft(null);
    setCoachNotice("");
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (coachAccountSearch !== "") {
        searchCoachAccounts(coachAccountSearch);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [coachAccountSearch]);

  const snapshot = useMemo(() => buildSnapshot(dashboard), [dashboard]);
  const currency = snapshot.quota.currencyCode;
  const coverage = snapshot.quota.gapAmount
    ? snapshot.pipeline.qualifiedAmount / snapshot.quota.gapAmount
    : 0;

  async function askCoach(question = coachQuestion) {
    const normalizedQuestion = String(question || "").trim();
    if (!normalizedQuestion) return;
    const requestContext = { ...coachContext };
    const contextKey = JSON.stringify(requestContext);
    setAskingCoach(true);
    setError("");
    setCoachNotice("");
    const messageId = `${Date.now()}-${normalizedQuestion}`;
    setCoachMessages((current) => [
      ...current,
      { id: `${messageId}-question`, role: "seller", text: normalizedQuestion },
      { id: `${messageId}-pending`, role: "coach", pending: true },
    ]);
    setCoachQuestion("");
    try {
      const { data: queued } = await api.post("/api/mi-agent/coach", {
        question: normalizedQuestion,
        context: {
          accountId: Number(coachContext.accountId || 0) || null,
          opportunityId: Number(coachContext.opportunityId || 0) || null,
          contactId: Number(coachContext.contactId || 0) || null,
        },
      });
      const jobId = Number(queued?.job?.id || 0);
      if (!jobId) throw new Error("No se pudo iniciar la consulta al Coach");
      const deadline = Date.now() + COACH_POLL_TIMEOUT_MS;
      for (;;) {
        if (Date.now() >= deadline) {
          throw new Error("El Coach está tardando más de lo esperado. Puedes intentarlo nuevamente.");
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const { data } = await api.get(`/api/mi-agent/coach/jobs/${jobId}`);
        if (data?.job?.status === "completed") {
          if (JSON.stringify(coachContextRef.current) !== contextKey) {
            throw new Error("El contexto cambio mientras se analizaba la pregunta. Vuelve a intentarlo.");
          }
          setCoachAnswer(data.result);
          setCoachMessages((current) => current.map((message) =>
            message.id === `${messageId}-pending`
              ? { ...message, pending: false, result: data.result }
              : message,
          ));
          break;
        }
        if (data?.job?.status === "failed") throw new Error(data.job.errorMessage || "No fue posible responder la pregunta");
      }
    } catch (requestError) {
      setCoachMessages((current) => current.map((message) =>
        message.id === `${messageId}-pending`
          ? { ...message, pending: false, error: getApiErrorMessage(requestError, "No fue posible responder la pregunta") }
          : message,
      ));
      setError(getApiErrorMessage(requestError, "No fue posible consultar al Coach"));
    } finally {
      setAskingCoach(false);
    }
  }

  async function analyzeSituation() {
    setAnalyzing(true);
    setError("");
    try {
      const { data: queued } = await api.post("/api/mi-agent/analyze", {
        snapshot,
      });
      const jobId = Number(queued?.job?.id || 0);
      if (!jobId) {
        throw new Error("No se pudo iniciar el análisis de Mi agente");
      }

      for (;;) {
        await new Promise((resolve) => {
          setTimeout(resolve, Math.max(500, Number(queued?.job?.pollAfterMs || 1000)));
        });
        const { data: jobData } = await api.get(
          `/api/mi-agent/analyze/jobs/${jobId}`,
        );
        const status = String(jobData?.job?.status || "");
        if (status === "completed" && jobData.result) {
          setAnalysis(jobData.result);
          setSelectedAction(jobData.result.actions?.[0] || null);
          break;
        }
        if (status === "failed") {
          throw new Error(
            jobData?.job?.errorMessage ||
              "No fue posible completar el análisis de Mi agente",
          );
        }
      }
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "No fue posible analizar tu situación comercial"));
    } finally {
      setAnalyzing(false);
    }
  }

  function openCoachActionConfirmation(action) {
    if (!canCreateActions || !action?.title) return;
    setCoachActionDraft({
      action,
      opportunityId: action.opportunityId || "",
      title: action.title || "",
      actionType: action.actionType || "next_step",
      status: action.status || "pending",
      dueDate: action.suggestedDueDate || "",
      scheduledAt: action.scheduledAt || "",
      priority: action.priority === "critical" ? "high" : action.priority || "medium",
      successCriteria: action.successCriteria || action.expectedOutcome || "",
      notes: action.notes || action.reason || "Creada desde el Coach Comercial de Mi Agente.",
      contextSnapshot: snapshot.pipeline.opportunities.find(
        (item) => Number(item.id) === Number(action.opportunityId),
      ) || null,
    });
    setError("");
  }

  function openClarifiedCoachActivity(candidate, activity) {
    openCoachActionConfirmation({
      opportunityId: candidate.id,
      title: activity?.title || "Actividad comercial",
      actionType: activity?.actionType || "meeting",
      status: "pending",
      priority: activity?.priority || "medium",
      scheduledAt: activity?.scheduledAt || "",
      suggestedDueDate: activity?.dueDate || "",
      notes: activity?.notes || activity?.rawRequest || "",
      successCriteria: activity?.successCriteria || "Definir el siguiente compromiso del cliente.",
    });
  }

  async function createNextStep() {
    const draft = coachActionDraft;
    const action = draft?.action;
    const opportunityId = Number(draft?.opportunityId || action?.opportunityId || 0);
    if (!opportunityId || !draft?.title.trim()) return;
    setCreatingActionRank(action.rank);
    setError("");
    try {
      const response = await api.post(`/api/opportunities/${opportunityId}/workspace/actions`, {
        title: draft.title.trim(),
        actionType: draft.actionType,
        status: draft.status,
        priority: draft.priority,
        dueDate: draft.dueDate || null,
        scheduledAt: draft.scheduledAt || null,
        successCriteria: draft.successCriteria.trim() || null,
        notes: draft.notes.trim() || null,
        ownerUserId: Number(currentUser?.id || 0) || null,
        approvalStatus: "approved",
        approvalReason: "Confirmado por el vendedor desde Mi Agente",
        contextSnapshot: draft.contextSnapshot
          ? {
              updatedAt: draft.contextSnapshot.updatedAt || null,
              salesStageId: draft.contextSnapshot.salesStageId || null,
              commercialStatusCode: draft.contextSnapshot.commercialStatusCode || null,
            }
          : null,
      });
      setAnalysis((current) =>
        current
          ? {
              ...current,
              actions: current.actions.map((item) =>
                item.rank === action.rank
                  ? { ...item, status: "done", coachCreatedId: Number(response.data?.id || 0) || null }
                  : item,
              ),
            }
          : current,
      );
      setCoachActionDraft(null);
      setCoachNotice("Actividad guardada correctamente en la oportunidad.");
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "No fue posible crear el próximo paso"));
    } finally {
      setCreatingActionRank(null);
    }
  }

  async function undoCoachAction(action) {
    if (!action?.coachCreatedId || !action?.opportunityId) return;
    setError("");
    try {
      await api.post(`/api/opportunities/${action.opportunityId}/workspace/actions/${action.coachCreatedId}/undo`);
      setAnalysis((current) => current
        ? { ...current, actions: current.actions.map((item) => item.rank === action.rank ? { ...item, status: "pending", coachCreatedId: null } : item) }
        : current);
      await loadDashboard();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "No fue posible deshacer la accion del Coach"));
    }
  }

  function openCoachOperationConfirmation(operation) {
    const canApplyOperation = operation?.kind === "lead_call_outcome"
      ? canUpdateLeads
      : operation?.kind === "account_field"
        ? canUpdateAccounts
        : operation?.kind === "contact_field"
          ? canUpdateContacts
          : operation?.kind === "create_account"
            ? canCreateAccounts
            : operation?.kind === "create_contact"
              ? canCreateContacts
              : operation?.kind === "lead_resolve"
                ? canResolveLeads
                : operation?.kind === "create_opportunity"
                  ? canCreateOpportunities
                  : operation?.kind === "activity"
                    ? canUpdateCommercialDevelopment
          : canCreateActions;
      if (!canApplyOperation || (!(operation?.opportunityId || operation?.accountId || operation?.contactId || operation?.interactionId) && !["create_account", "create_opportunity"].includes(operation?.kind))) return;
    setCoachOperationDraft({
      operation,
      opportunityId: operation.opportunityId || "",
      value: operation.value || operation.answerValue || "",
      answerMode: operation.answerMode || "replace",
        payload: operation.payload || {},
    });
    setError("");
  }

  function appendCoachOperationMessage(text, type = "success") {
    setCoachMessages((current) => [
      ...current,
      {
        id: `coach-operation-${Date.now()}-${Math.random()}`,
        role: "coach",
        result: {
          responseType: type === "error" ? "error" : "operation",
          confidence: "high",
          answer: text,
          evidence: [],
          recommendation: type === "error"
            ? "Corrige el problema y vuelve a intentarlo."
            : "La operación fue aplicada correctamente.",
        },
      },
    ]);
  }

  async function applyCoachOperation() {
    const draft = coachOperationDraft;
    const operation = draft?.operation;
    if (!(draft?.opportunityId || operation?.opportunityId || operation?.accountId || operation?.contactId || operation?.interactionId)) return;
    setError("");
    setSavingCoachOperation(true);
    try {
      let auditId = null;
      if (operation.kind === "create_account" || operation.kind === "create_contact" || operation.kind === "lead_resolve") {
        const payload = typeof draft.value === "string" && draft.value.trim().startsWith("{")
          ? JSON.parse(draft.value)
          : draft.payload;
        draft.payload = payload;
      } else if (operation.kind === "stage_answer") {
        const proposedAnswer = String(draft.value || "").trim();
        const answerValue = draft.answerMode === "append" && operation.previousAnswer
          ? `${operation.previousAnswer}\n${proposedAnswer}`
          : proposedAnswer;
        await api.post(`/api/opportunities/${operation.opportunityId}/stage-answers`, {
          answers: [{
            questionId: Number(operation.questionId),
            answerValue,
          }],
        });
      } else if (operation.kind === "opportunity_field") {
        const response = await api.patch(`/api/opportunities/${operation.opportunityId}/coach-field`, {
          field: operation.field,
          value: draft.value,
        });
        auditId = response.data?.auditId || null;
      } else if (operation.kind === "account_field") {
        const response = await api.patch(`/api/accounts/${operation.accountId}/coach-field`, { field: operation.field, value: draft.value });
        auditId = response.data?.auditId || null;
      } else if (operation.kind === "contact_field") {
        const response = await api.patch(`/api/contacts/${operation.contactId}/coach-field`, { field: operation.field, value: draft.value });
        auditId = response.data?.auditId || null;
      } else if (operation.kind === "lead_call_outcome") {
        await api.post(`/api/interactions/${operation.interactionId}/call-outcome`, {
          substatusCode: operation.substatusCode,
          reasonCode: operation.reasonCode,
          requiredActionCode: operation.requiredActionCode,
          comment: draft.value,
          nextActionDueAt: operation.nextActionDueAt || null,
          eventType: "activity_update",
        });
        setCoachUndoLeadId(operation.interactionId);
      } else if (operation.kind === "activity") {
        const opportunityId = Number(draft.opportunityId || operation.opportunityId || 0);
        if (!opportunityId) throw new Error("Selecciona una oportunidad para registrar la actividad");
        const activityType = normalizeCoachActivityType(operation.actionType);
        const activityPayload = {
          entryKind: "activity",
          activityType,
          objective: operation.title,
          status: operation.status || "pending",
          priority: operation.priority || "medium",
          dueDate: operation.dueDate || (operation.scheduledAt ? operation.scheduledAt.slice(0, 10) : null),
          scheduledAt: operation.scheduledAt || null,
          note: operation.notes || null,
          notes: operation.notes || null,
          successCriteria: operation.successCriteria || null,
          details: { entryKind: "activity", source: "mi_agent_coach", approvalStatus: "approved" },
        };
        if (operation.activityId) {
          await api.patch(`/api/commercial-development/opportunities/${opportunityId}/activities/${operation.activityId}`, activityPayload);
        } else {
          await api.post(`/api/commercial-development/opportunities/${opportunityId}/activities`, activityPayload);
        }
        const activitySuccessNotice = operation.activityId
          ? "Actividad actualizada correctamente en la oportunidad."
          : "Actividad creada correctamente en la oportunidad.";
        operation.successNotice = activitySuccessNotice;
      } else if (operation.kind === "create_account") {
        await api.post("/api/accounts", draft.payload);
      } else if (operation.kind === "create_contact") {
        const contactPayload = {
          ...draft.payload,
          accountId: draft.payload?.accountId || Number(coachContext.accountId || 0) || null,
        };
        if (!contactPayload.accountId) throw new Error("Selecciona una cuenta para crear el contacto");
        await api.post("/api/contacts", contactPayload);
      } else if (operation.kind === "create_opportunity") {
        const opportunityPayload = {
          ...draft.payload,
          accountId: draft.payload?.accountId || Number(coachContext.accountId || 0) || null,
          contactId: draft.payload?.contactId || Number(coachContext.contactId || 0) || null,
        };
        if (!opportunityPayload.accountId) throw new Error("Selecciona una cuenta para crear la oportunidad");
        await api.post("/api/opportunities", opportunityPayload);
      } else if (operation.kind === "lead_resolve") {
        await api.post(`/api/interactions/${operation.interactionId}/resolve`, draft.payload);
      }
      if (!operation.successNotice) {
        operation.successNotice = operation.kind === "opportunity_field"
          ? "Cambio de la oportunidad guardado correctamente."
          : operation.kind === "stage_answer"
            ? "Respuesta de etapa guardada correctamente."
            : operation.kind === "account_field"
              ? "Cambio de la cuenta guardado correctamente."
              : operation.kind === "contact_field"
                ? "Cambio del contacto guardado correctamente."
                : operation.kind === "lead_call_outcome" || operation.kind === "lead_resolve"
                  ? "Resultado del lead guardado correctamente."
                  : operation.kind === "create_account"
                    ? "Cuenta creada correctamente."
                    : operation.kind === "create_contact"
                      ? "Contacto creado correctamente."
                      : operation.kind === "create_opportunity"
                        ? "Oportunidad creada correctamente."
                        : "Cambio guardado correctamente en el CRM.";
      }
      if (auditId) setCoachUndoAuditId(auditId);
      setCoachOperationDraft(null);
      if (operation.successNotice) appendCoachOperationMessage(operation.successNotice);
      await loadDashboard();
      if (operation.successNotice) setCoachNotice(operation.successNotice);
    } catch (requestError) {
      const responseData = requestError?.response?.data;
      setCoachOperationDraft((current) => current
        ? {
            ...current,
            error: getApiErrorMessage(requestError, "No fue posible aplicar el cambio propuesto"),
            duplicateWarnings: responseData?.duplicateWarnings || current.duplicateWarnings || [],
            duplicateDecision: responseData?.duplicateDecision || current.duplicateDecision || null,
            duplicateReview: responseData?.duplicateReview || current.duplicateReview || null,
          }
        : current);
      appendCoachOperationMessage(getApiErrorMessage(requestError, "No fue posible aplicar el cambio propuesto"), "error");
      setError(getApiErrorMessage(requestError, "No fue posible aplicar el cambio propuesto"));
    } finally {
      setSavingCoachOperation(false);
    }
  }

  async function undoCoachOperation() {
    if (!coachUndoAuditId) return;
    try {
      await api.post(`/api/mi-agent/coach/operations/${coachUndoAuditId}/undo`);
      setCoachUndoAuditId(null);
      await loadDashboard();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "No fue posible revertir el cambio del Coach"));
    }
  }

  async function undoCoachLead() {
    if (!coachUndoLeadId) return;
    try {
      await api.post(`/api/mi-agent/coach/leads/${coachUndoLeadId}/undo`);
      setCoachUndoLeadId(null);
      await loadDashboard();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "No fue posible revertir el resultado del lead"));
    }
  }

  function rejectCoachOperation(operation) {
    setCoachOperationDraft(null);
    api.post("/api/mi-agent/coach/operations/rejected", { operation }).catch(() => undefined);
  }

  function rejectCoachAction(action) {
    api.post("/api/mi-agent/coach/operations/rejected", {
      operation: {
        kind: "next_step",
        opportunityId: action?.opportunityId || null,
        title: action?.title || "",
      },
    }).catch(() => undefined);
    setCoachActionDraft(null);
  }

  function updateCoachPayloadField(field, value) {
    setCoachOperationDraft((current) => ({
      ...current,
      payload: { ...(current?.payload || {}), [field]: value },
      value: "",
    }));
  }

  if (loading) {
    return <section className="mi-agent-page"><div className="mi-agent-empty">Cargando tu situación comercial...</div></section>;
  }

  return (
    <section className="mi-agent-page">
      <header className="mi-agent-hero">
        <div>
          <span className="mi-agent-kicker">Ejecución comercial</span>
          <h2>Mi Coach</h2>
          <p>Tu siguiente mejor movimiento para acercarte a la cuota.</p>
        </div>
      </header>

      {error ? <p className="form-error">{error}</p> : null}
      {coachNotice ? <p className="mi-agent-coach-success" role="status">{coachNotice}</p> : null}

      <div className="mi-agent-metrics">
        <article><span>Cuota</span><strong>{formatCurrency(snapshot.quota.assignedAmount, currency)}</strong><small>{snapshot.period?.label || "Período actual"}</small></article>
        <article><span>Real ganado</span><strong>{formatCurrency(snapshot.quota.actualAmount, currency)}</strong><small>{snapshot.quota.assignedAmount ? `${Math.round((snapshot.quota.actualAmount / snapshot.quota.assignedAmount) * 100)}% de avance` : "Sin cuota"}</small></article>
        <article className="is-alert"><span>Brecha</span><strong>{formatCurrency(snapshot.quota.gapAmount, currency)}</strong><small>Lo que aún falta</small></article>
        <article><span>Pipeline calificado</span><strong>{formatCurrency(snapshot.pipeline.qualifiedAmount, currency)}</strong><small>{snapshot.pipeline.qualifiedCount} oportunidades · {coverage ? `${coverage.toFixed(1)}x cobertura` : "Sin cobertura"}</small></article>
      </div>

      <section className="mi-agent-coach-panel">
        <div className="mi-agent-section-heading"><div><span className="mi-agent-section-label">Coach comercial</span><h3>Pregúntale a tu Coach</h3></div><span>Usa tu contexto real del CRM</span></div>
        <div className="mi-agent-coach-context-form">
          <label>
            Cuenta activa
            <input value={coachAccountSearch} onChange={(event) => searchCoachAccounts(event.target.value)} placeholder="Buscar cuenta" disabled={loadingCoachContext} />
            <select value={coachContext.accountId} onChange={(event) => selectCoachAccount(event.target.value)} disabled={loadingCoachContext}>
              <option value="">Selecciona una cuenta</option>
              {coachAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
          </label>
          <label>
            Oportunidad activa
            <select value={coachContext.opportunityId} onChange={(event) => selectCoachOpportunity(event.target.value)} disabled={!coachContext.accountId || loadingCoachContext}>
              <option value="">{loadingCoachContext ? "Cargando oportunidades..." : coachContext.accountId && !coachOpportunities.length ? "Sin oportunidades activas" : "Selecciona una oportunidad"}</option>
              {coachOpportunities.map((opportunity) => <option key={opportunity.id} value={opportunity.id}>{opportunity.name} · {opportunity.sales_stage || opportunity.stage_name || "Sin etapa"} · {formatCurrency(opportunity.amount_usd ?? opportunity.amountUsd, "USD")}</option>)}
            </select>
          </label>
          <label>
            Contacto
            <select value={coachContext.contactId} onChange={(event) => selectCoachContact(event.target.value)} disabled={!coachContext.accountId || loadingCoachContext}>
              <option value="">{loadingCoachContext ? "Cargando contactos..." : coachContext.accountId && !coachContacts.length ? "Sin contactos activos" : "Selecciona un contacto"}</option>
              {coachContacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.full_name || `${contact.first_name || ""} ${contact.last_name || ""}`.trim()} · {contact.position_title || "Sin cargo"}</option>)}
            </select>
          </label>
          <button type="button" className="btn-secondary" onClick={() => { setCoachContext({ accountId: "", opportunityId: "", contactId: "" }); setCoachOpportunities([]); setCoachContacts([]); }}>Limpiar contexto</button>
        </div>
        {coachContext.accountId ? <div className="mi-agent-coach-context-summary"><strong>Contexto aplicado</strong><span>{coachAccounts.find((item) => String(item.id) === String(coachContext.accountId))?.name || "Cuenta seleccionada"}</span>{coachContext.opportunityId ? <span>{coachOpportunities.find((item) => String(item.id) === String(coachContext.opportunityId))?.name || "Oportunidad seleccionada"}</span> : null}{coachContext.contactId ? <span>{coachContacts.find((item) => String(item.id) === String(coachContext.contactId))?.full_name || "Contacto seleccionado"}</span> : null}</div> : null}
        {coachContext.accountId && !loadingCoachContext && !coachOpportunities.length ? <p className="field-hint">Esta cuenta no tiene oportunidades activas y abiertas.</p> : null}
        {coachContext.accountId && !loadingCoachContext && !coachContacts.length ? <p className="field-hint">Esta cuenta no tiene contactos activos.</p> : null}
        {coachMetrics ? <div className="mi-agent-coach-result-meta"><span>Consultas: {coachMetrics.requests} · últimos 30 días</span><span>Decididas: {coachMetrics.operationsDecided || 0}</span><span>Aprobadas: {coachMetrics.operationsCreated || 0}</span><span>Rechazadas: {coachMetrics.operationsRejected || 0}</span><span>Completadas: {coachMetrics.operationsCompleted || 0}</span></div> : null}
        <div className="mi-agent-coach-quick-questions" style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #e2eaed" }}><strong style={{ display: "block", color: "#173b52", fontSize: 11 }}>Preguntas rápidas</strong><div className="mi-agent-coach-suggestions">{coachContext.opportunityId ? <><button type="button" onClick={() => askCoach("¿Qué falta para avanzar de etapa?")}>¿Qué falta para avanzar?</button><button type="button" onClick={() => askCoach("Registra una actividad de seguimiento")}>Registrar actividad</button></> : coachContext.accountId ? <><button type="button" onClick={() => askCoach("¿Qué oportunidades activas tiene esta cuenta?")}>¿Qué oportunidades tiene?</button><button type="button" onClick={() => askCoach("¿Qué contactos importantes tiene esta cuenta?")}>¿Qué contactos tiene?</button></> : <><button type="button" onClick={() => askCoach("¿Cómo voy este mes?")}>¿Cómo voy este mes?</button><button type="button" onClick={() => askCoach("¿Qué oportunidades tienen riesgo de perderse?")}>¿Qué está en riesgo?</button></>}</div></div>
        <form className="mi-agent-coach-form" onSubmit={(event) => { event.preventDefault(); askCoach(); }}>
          <input value={coachQuestion} onChange={(event) => setCoachQuestion(event.target.value)} placeholder="Escribe tu pregunta para el Coach..." disabled={askingCoach} />
          <button type="submit" className="mi-agent-primary-button" disabled={askingCoach || !coachQuestion.trim()}>{askingCoach ? "Consultando..." : "Preguntar"}</button>
        </form>
        {coachUndoAuditId ? <button type="button" className="btn-secondary mi-agent-coach-undo-button" onClick={undoCoachOperation}>Deshacer último cambio</button> : null}
        {coachUndoLeadId ? <button type="button" className="btn-secondary mi-agent-coach-undo-button" onClick={undoCoachLead}>Deshacer resultado del lead</button> : null}
        {coachMessages.filter((message) => message.result && (message.result.clarification || buildCoachClarification(message.result, snapshot))).slice(-1).map((message) => { const clarification = message.result.clarification || buildCoachClarification(message.result, snapshot); return <div className="mi-agent-coach-action" key={`${message.id}-clarification`}><strong>{clarification.message}</strong><small>Falta: {clarification.missing.join(", ")}</small>{clarification.candidates.length ? clarification.candidates.map((candidate) => <button type="button" className="btn-secondary" key={candidate.id} onClick={() => openClarifiedCoachActivity(candidate, clarification.activity)}>Usar {candidate.name} · {candidate.accountName || "Sin cuenta"}</button>) : <small>No hay oportunidades accesibles para seleccionar.</small>}</div>; })}
        {coachMessages.length ? <div ref={coachThreadRef} className="mi-agent-coach-thread" aria-live="polite">{coachMessages.map((message) => message.role === "seller" ? <div key={message.id} className="mi-agent-coach-message is-seller"><span>Vendedor</span><p>{message.text}</p></div> : <div key={message.id} className="mi-agent-coach-message is-coach"><span>Coach</span>{message.pending ? <p>Analizando tu contexto comercial...</p> : message.error ? <p>{message.error}</p> : <><div className="mi-agent-coach-result-meta"><span>{COACH_RESPONSE_TYPE_LABELS[message.result?.responseType] || "Respuesta del Coach"}</span><span>{COACH_CONFIDENCE_LABELS[message.result?.confidence] || "Confianza media"}</span></div><h4>{message.result?.answer || "Lectura comercial"}</h4>{message.result?.evidence?.length ? <ul>{message.result.evidence.map((item) => <li key={item}>{item}</li>)}</ul> : null}<p><strong>Recomendación:</strong> {message.result?.recommendation || "Sin recomendación adicional."}</p>{message.result?.operations?.map((operation, index) => <div className="mi-agent-coach-action" key={`${operation.kind}-${operation.opportunityId || operation.accountId || operation.contactId || operation.interactionId}-${index}`}><strong>{operation.title || "Cambio propuesto"}</strong><small>{formatCoachOperationSummary(operation)}</small>{(operation.kind === "activity" ? canUpdateCommercialDevelopment : operation.kind === "lead_call_outcome" ? canUpdateLeads : operation.kind === "account_field" ? canUpdateAccounts : operation.kind === "contact_field" ? canUpdateContacts : operation.kind === "create_account" ? canCreateAccounts : operation.kind === "create_contact" ? canCreateContacts : operation.kind === "lead_resolve" ? canResolveLeads : canCreateActions) ? <button type="button" className="btn-secondary" onClick={() => openCoachOperationConfirmation(operation)}>Revisar y confirmar</button> : <small>Requiere permiso de actualización.</small>}</div>)}{message.result?.action?.title ? <div className="mi-agent-coach-action"><strong>Acción sugerida: {message.result.action.title}</strong><small>Criterio de éxito: {message.result.action.successCriteria || "Definir un siguiente compromiso."}</small></div> : null}</>}</div>)}</div> : null}
      </section>

      {!analysis ? (
        <div className="mi-agent-start-panel">
          <div className="mi-agent-start-icon">✦</div>
          <div><h3>Tu plan comercial está listo para analizarse</h3><p>Mi agente revisará tu cuota, las oportunidades desde Desarrollo y las señales de riesgo del proceso comercial.</p><button type="button" className="mi-agent-primary-button" onClick={analyzeSituation} disabled={analyzing}>{analyzing ? "Analizando..." : "Analizar mi situación"}</button></div>
        </div>
      ) : (
        <div className="mi-agent-content-stack">
          <div className="mi-agent-main-column">
            <section className="mi-agent-focus-panel">
              <div className="mi-agent-section-heading"><div><span className="mi-agent-section-label">Lectura del agente</span><h3>{analysis.headline || "Tu situación comercial"}</h3></div><span className="mi-agent-analysis-date">Actualizado ahora</span></div>
              <p>{analysis.summary || analysis.quotaReadout}</p>
            </section>

            {analysis.activityProgress ? (
              <section className="mi-agent-activity-progress-panel">
                <div className="mi-agent-section-heading"><div><span className="mi-agent-section-label">Efectividad comercial</span><h3>Actividad vs. avance</h3></div><span>Lectura del período</span></div>
                <p className="mi-agent-activity-progress-message">{analysis.activityProgress.message}</p>
                <div className="mi-agent-activity-progress-metrics">
                  <article><span>Actividades recientes</span><strong>{analysis.activityProgress.activityCount}</strong><small>Últimos 7 días</small></article>
                  <article><span>Oportunidades que progresaron</span><strong>{analysis.activityProgress.progressedOpportunities}</strong><small>Con cambio comercial en el período</small></article>
                  <article className={analysis.activityProgress.opportunitiesWithoutProgress ? "is-alert" : ""}><span>Actividad sin avance</span><strong>{analysis.activityProgress.opportunitiesWithoutProgress}</strong><small>Oportunidades que requieren una interacción más dirigida</small></article>
                </div>
                {analysis.activityProgress.details?.filter((item) => item.activityWithoutProgress).length ? <div className="mi-agent-activity-progress-list"><strong>Oportunidades con actividad pero sin progreso</strong><ul>{analysis.activityProgress.details.filter((item) => item.activityWithoutProgress).map((item) => <li key={item.opportunityId}><span>{item.opportunityName} · {item.accountName || "Sin cuenta"}</span><small>{item.activityCount} actividades · falta confirmar evidencia comercial</small></li>)}</ul></div> : null}
              </section>
            ) : null}

            {analysis.alerts?.length ? (
              <section className="mi-agent-alerts-panel">
                <div className="mi-agent-section-heading"><div><span className="mi-agent-section-label">Diagnóstico automático</span><h3>Problemas de venta detectados</h3></div><span>{analysis.alerts.length} alertas</span></div>
                <div className="mi-agent-alert-list">
                  {analysis.alerts.map((alert) => (
                    <article key={`${alert.code}-${alert.opportunityId || alert.accountName || alert.title}`} className={`mi-agent-alert-card is-${alert.severity}`}>
                      <div className="mi-agent-alert-card-heading"><strong>{alert.title}</strong><span>{alert.severity === "critical" ? "Crítica" : alert.severity === "high" ? "Alta" : "Media"}</span></div>
                      <p>{alert.opportunityName ? `Oportunidad: ${alert.opportunityName} · ${alert.accountName || "Sin cuenta"}` : "Pipeline del vendedor"}</p>
                      <p><strong>Evidencia:</strong> {alert.evidence}</p>
                      <p><strong>Acción:</strong> {alert.action}</p>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="mi-agent-actions-panel">
              <div className="mi-agent-section-heading"><div><span className="mi-agent-section-label">Orden recomendado</span><h3>Qué hacer ahora</h3></div><span>{analysis.actions.length} acciones</span></div>
              <div className="mi-agent-action-list">
                {analysis.actions.length ? analysis.actions.map((action) => (
                  <button type="button" key={`${action.rank}-${action.opportunityId || action.title}`} className={`mi-agent-action-row ${selectedAction?.rank === action.rank ? "is-selected" : ""}`} onClick={() => setSelectedAction(action)}>
                    <span className="mi-agent-action-rank">{action.rank}</span>
                    <span className="mi-agent-action-copy"><strong>{action.title || "Acción comercial"}</strong><small>Oportunidad #{action.opportunityId || "-"} · {action.opportunityName || "Sin nombre"}</small><small>{action.accountName || "Sin cuenta"} · {action.stageName || "Sin etapa"}</small></span>
                    <span className={`mi-agent-health-badge is-${String(action.salesHealth?.label || "parcial").toLowerCase()}`}>{action.salesHealth ? `Salud ${action.salesHealth.label}` : "Salud"}</span>
                    <span className={`mi-agent-priority is-${action.priority}`}>{PRIORITY_LABELS[action.priority]}</span>
                    <span className={`mi-agent-row-state ${action.status === "done" ? "is-done" : ""}`}>{ACTION_STATUS_LABELS[action.status] || "Pendiente"}</span>
                  </button>
                )) : <div className="mi-agent-empty">No se encontraron acciones concretas en este análisis.</div>}
              </div>
            </section>
          </div>

          <section className="mi-agent-detail-panel" style={{ alignSelf: "stretch", position: "static" }}>
            {selectedAction ? <>
              <div className="mi-agent-detail-heading">
                <div>
                  <span className="mi-agent-section-label">Detalle de la acción</span>
                  <h3>{selectedAction.title}</h3>
                  <p>Oportunidad #{selectedAction.opportunityId || "-"} · {selectedAction.opportunityName || "Sin nombre"} · {selectedAction.accountName || "Sin cuenta"}</p>
                </div>
                <span className={`mi-agent-priority is-${selectedAction.priority}`}>{PRIORITY_LABELS[selectedAction.priority]}</span>
              </div>
              <div className="mi-agent-detail-facts">
                <article><span>Por qué importa</span><p>{selectedAction.reason || "Prioridad definida por el análisis del pipeline."}</p></article>
                <article><span>Riesgo</span><p>{selectedAction.risk || "Sin riesgo adicional identificado."}</p></article>
                <article><span>Resultado esperado</span><p>{selectedAction.expectedOutcome || "Obtener un siguiente paso verificable."}</p></article>
                <article><span>Criterio de éxito</span><p>{selectedAction.successCriteria || "Registrar el resultado y el siguiente compromiso."}</p></article>
              </div>
              {selectedAction.salesHealth ? (
                <div className="mi-agent-health-panel">
                  <div className="mi-agent-health-heading"><div><span className="mi-agent-section-label">Salud de la oportunidad</span><strong>{selectedAction.salesHealth.label} · {selectedAction.salesHealth.solidCount}/{selectedAction.salesHealth.totalCount} dimensiones sólidas</strong></div><span>Principal debilidad: {selectedAction.salesHealth.principalWeakness}</span></div>
                  <div className="mi-agent-health-grid">{selectedAction.salesHealth.dimensions.map((dimension) => <div key={dimension.key} className={`mi-agent-health-dimension is-${dimension.state}`}><span>{dimension.label}</span><strong>{dimension.stateLabel}</strong><small>{dimension.evidence}</small></div>)}</div>
                </div>
              ) : null}
              <div className="mi-agent-execution-kit">
                <div className="mi-agent-execution-kit-heading">
                  <div><span className="mi-agent-section-label">Preparación para ejecutar</span><h4>{selectedAction.actionType || "follow_up"}</h4></div>
                  <span>Listo para usar</span>
                </div>
                <div className="mi-agent-kit-grid">
                  <article><span>Objetivo</span><p>{selectedAction.executionKit?.objective || selectedAction.expectedOutcome || "Conseguir un compromiso verificable del cliente."}</p></article>
                  <article><span>Resultado mínimo</span><p>{selectedAction.executionKit?.minimumOutcome || selectedAction.successCriteria || "Definir fecha, responsable y siguiente hito."}</p></article>
                  <article><span>Propuesta de valor</span><p>{selectedAction.executionKit?.valueProposition || "Conectar la solución con la necesidad y el riesgo concreto del cliente."}</p></article>
                  <article><span>Mensaje de seguimiento</span><p>{selectedAction.executionKit?.followUpMessage || "Enviar un resumen de acuerdos con fecha y siguiente paso."}</p></article>
                </div>
                {selectedAction.executionKit?.knownInformation?.length ? <div className="mi-agent-kit-list"><strong>Información conocida</strong><ul>{selectedAction.executionKit.knownInformation.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
                {selectedAction.executionKit?.objections?.length ? <div className="mi-agent-kit-list"><strong>Objeciones probables</strong><ul>{selectedAction.executionKit.objections.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
              </div>
              {selectedAction.questions?.length ? <div className="mi-agent-questions"><strong>Preguntas sugeridas</strong><ul>{selectedAction.questions.map((question) => <li key={question}>{question}</li>)}</ul></div> : null}
              {selectedAction.developmentNarrative ? (
                <div className="mi-agent-development-context">
                  <span className="mi-agent-section-label">Desarrollo de la oportunidad</span>
                  <span className={`mi-agent-alignment-status is-${selectedAction.alignedContext?.alignment || "partially_aligned"}`} style={{ display: "inline-block", marginBottom: "8px", fontSize: "12px", fontWeight: 800 }}>Alineación: {selectedAction.alignedContext?.alignment === "aligned" ? "Alineada" : selectedAction.alignedContext?.alignment === "not_aligned" ? "Requiere revisión" : "Parcial"}</span>
                  <div className="mi-agent-development-block"><strong>Descripción y situación actual</strong><p>{selectedAction.alignedContext?.situation || selectedAction.developmentNarrative.contract?.descriptionSituationText || selectedAction.developmentNarrative.statusSummary || "Sin información disponible."}</p></div>
                  <div className="mi-agent-development-block"><strong>Estrategia para lograr la venta</strong><p>{selectedAction.alignedContext?.strategy || selectedAction.developmentNarrative.contract?.salesStrategyText || "Sin información disponible."}</p></div>
                  <div className="mi-agent-development-block"><strong>Siguiente mejor paso</strong><p>{selectedAction.alignedContext?.nextBestStep || selectedAction.developmentNarrative.contract?.nextBestStepText || selectedAction.developmentNarrative.nextStepRecommendation || "Sin información disponible."}</p></div>
                  <div className="mi-agent-development-block"><strong>Paso alternativo</strong><p>{selectedAction.alignedContext?.alternativeStep || selectedAction.developmentNarrative.contract?.alternativeStepText || "Sin información disponible."}</p></div>
                </div>
              ) : null}
              {selectedAction.title && canCreateActions ? <button type="button" className="mi-agent-primary-button is-wide" onClick={() => openCoachActionConfirmation(selectedAction)} disabled={creatingActionRank === selectedAction.rank || selectedAction.status === "done"}>{selectedAction.status === "done" ? "Próximo paso creado" : "Crear próximo paso"}</button> : null}
              {selectedAction.coachCreatedId ? <button type="button" className="btn-secondary mi-agent-coach-undo-button" onClick={() => undoCoachAction(selectedAction)}>Deshacer cambio del Coach</button> : null}
              {selectedAction.opportunityId && !canCreateActions ? <p className="mi-agent-permission-note">Tienes acceso de lectura. Solicita permiso de actualización para crear el próximo paso desde aquí.</p> : null}
            </> : <div className="mi-agent-empty">Selecciona una acción para ver su contexto.</div>}
          </section>
        </div>
      )}

      {coachActionDraft ? (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Confirmar próximo paso del Coach">
          <div className="modal-dialog mi-agent-coach-action-dialog">
            <h3 className="modal-title">Confirmar cambio comercial</h3>
            <p className="modal-message">
              Revisa y edita la propuesta antes de guardarla en la oportunidad.
            </p>
            <div className="mi-agent-coach-action-form">
              <label>
                Oportunidad
                <select
                  value={coachActionDraft.opportunityId}
                  onChange={(event) => setCoachActionDraft((current) => ({
                    ...current,
                    opportunityId: event.target.value,
                    contextSnapshot: snapshot.pipeline.opportunities.find((item) => Number(item.id) === Number(event.target.value)) || null,
                  }))}
                >
                  <option value="">Selecciona una oportunidad</option>
                  {snapshot.pipeline.opportunities.map((item) => (
                    <option key={item.id} value={item.id}>{item.name} · {item.accountName || "Sin cuenta"}</option>
                  ))}
                </select>
              </label>
              <label>
                Tipo de registro
                <select
                  value={coachActionDraft.actionType}
                  onChange={(event) => setCoachActionDraft((current) => ({ ...current, actionType: event.target.value }))}
                >
                  <option value="next_step">Próximo paso</option>
                  <option value="follow_up">Seguimiento</option>
                  <option value="call">Llamada</option>
                  <option value="meeting">Reunión</option>
                  <option value="demo">Demostración</option>
                  <option value="quotation">Cotización</option>
                  <option value="negotiation">Negociación</option>
                  <option value="other">Otra actividad</option>
                </select>
              </label>
              <label>
                Título
                <input
                  value={coachActionDraft.title}
                  onChange={(event) => setCoachActionDraft((current) => ({ ...current, title: event.target.value }))}
                />
              </label>
              <label>
                Estado
                <select
                  value={coachActionDraft.status}
                  onChange={(event) => setCoachActionDraft((current) => ({ ...current, status: event.target.value }))}
                >
                  <option value="pending">Pendiente</option>
                  <option value="in_progress">En progreso</option>
                  <option value="blocked">Bloqueado</option>
                  <option value="done">Realizado</option>
                </select>
              </label>
              <label>
                Fecha límite
                <input
                  type="date"
                  value={coachActionDraft.dueDate}
                  onChange={(event) => setCoachActionDraft((current) => ({ ...current, dueDate: event.target.value }))}
                />
              </label>
              <label>
                Fecha y hora programada
                <input
                  type="datetime-local"
                  value={coachActionDraft.scheduledAt}
                  onChange={(event) => setCoachActionDraft((current) => ({ ...current, scheduledAt: event.target.value }))}
                />
              </label>
              <label>
                Prioridad
                <select
                  value={coachActionDraft.priority}
                  onChange={(event) => setCoachActionDraft((current) => ({ ...current, priority: event.target.value }))}
                >
                  <option value="critical">Crítica</option>
                  <option value="low">Baja</option>
                  <option value="medium">Media</option>
                  <option value="high">Alta</option>
                </select>
              </label>
              <label>
                Criterio de éxito
                <textarea
                  rows={2}
                  value={coachActionDraft.successCriteria}
                  onChange={(event) => setCoachActionDraft((current) => ({ ...current, successCriteria: event.target.value }))}
                />
              </label>
              <label>
                Notas
                <textarea
                  rows={2}
                  value={coachActionDraft.notes}
                  onChange={(event) => setCoachActionDraft((current) => ({ ...current, notes: event.target.value }))}
                />
              </label>
            </div>
            <div className="modal-buttons">
              <button type="button" className="btn-secondary" onClick={() => rejectCoachAction(coachActionDraft.action)} disabled={Boolean(creatingActionRank)}>
                Cancelar
              </button>
              <button type="button" className="btn-primary" onClick={createNextStep} disabled={Boolean(creatingActionRank) || !coachActionDraft.title.trim()}>
                {creatingActionRank ? "Guardando..." : "Confirmar y guardar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {coachOperationDraft ? (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Confirmar cambio del Coach">
          <div className="modal-dialog mi-agent-coach-action-dialog" style={{ width: "min(820px, calc(100vw - 32px))", maxWidth: 820, padding: 20 }}>
            <h3 className="modal-title">Confirmar cambio</h3>
            <p className="modal-message">Revisa el valor propuesto antes de actualizar el CRM.</p>
            <div className="mi-agent-coach-action-form">
              <label>
                Operación
                <input value={coachOperationDraft.operation.title || coachOperationDraft.operation.kind} disabled />
              </label>
              {["create_account", "create_contact", "create_opportunity", "lead_resolve"].includes(coachOperationDraft.operation.kind) ? (
                <div className="mi-agent-coach-action-form">
                  {(coachOperationDraft.operation.kind === "create_account"
                    ? ["name", "registrationCode", "phone", "website", "city", "stateRegion", "postalCode", "companyDescription"]
                    : coachOperationDraft.operation.kind === "create_contact"
                      ? ["firstName", "lastName", "email", "phone", "mobile", "positionTitle", "department", "city", "stateRegion"]
                      : coachOperationDraft.operation.kind === "create_opportunity"
                        ? ["name", "amountUsd", "closeDate", "summary"]
                        : ["summary", "sourceNotes"]
                  ).map((field) => (
                    <label key={field}>
                      {field}
                      {field === "companyDescription" || field === "summary" || field === "sourceNotes" ? (
                        <textarea rows={3} value={coachOperationDraft.payload?.[field] || ""} onChange={(event) => updateCoachPayloadField(field, event.target.value)} />
                      ) : (
                        <input type={field === "amountUsd" ? "number" : field === "closeDate" ? "date" : "text"} value={coachOperationDraft.payload?.[field] ?? ""} onChange={(event) => updateCoachPayloadField(field, event.target.value)} />
                      )}
                    </label>
                  ))}
                  {coachOperationDraft.error ? <p className="form-error">{coachOperationDraft.error}</p> : null}
                  {coachOperationDraft.duplicateWarnings?.length ? <div className="mi-agent-coach-duplicate-warning"><strong>Revisa posibles duplicados antes de crear:</strong><ul>{coachOperationDraft.duplicateWarnings.map((warning, index) => <li key={`${warning.matchReason || "duplicate"}-${index}`}>{warning.reasonLabel || warning.message || warning.severityMessage || "Coincidencia detectada"}</li>)}</ul><small>Si ya existe, cancela esta propuesta y selecciona el registro existente desde el contexto del Coach.</small></div> : null}
                </div>
              ) : coachOperationDraft.operation.kind === "activity" ? (
                <div className="mi-agent-coach-action-form" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <label>
                    Oportunidad
                    <select value={coachOperationDraft.opportunityId} onChange={(event) => setCoachOperationDraft((current) => ({ ...current, opportunityId: event.target.value }))}>
                      <option value="">Selecciona una oportunidad</option>
                      {snapshot.pipeline.opportunities.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.accountName || "Sin cuenta"}</option>)}
                    </select>
                  </label>
                  {[['title', 'Título'], ['actionType', 'Tipo'], ['scheduledAt', 'Fecha y hora'], ['dueDate', 'Fecha límite'], ['priority', 'Prioridad'], ['notes', 'Notas'], ['successCriteria', 'Criterio de éxito']].map(([field, label]) => (
                    <label key={field}>
                      {label}
                      {field === "actionType" ? (
                        <select value={normalizeCoachActivityType(coachOperationDraft.operation[field])} onChange={(event) => setCoachOperationDraft((current) => ({ ...current, operation: { ...current.operation, [field]: event.target.value } }))}>
                          {COACH_ACTIVITY_TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      ) : field === "priority" ? (
                        <select value={coachOperationDraft.operation[field] || "medium"} onChange={(event) => setCoachOperationDraft((current) => ({ ...current, operation: { ...current.operation, [field]: event.target.value } }))}>
                          <option value="critical">Crítica</option>
                          <option value="high">Alta</option>
                          <option value="medium">Media</option>
                          <option value="low">Baja</option>
                        </select>
                      ) : field === "notes" || field === "successCriteria" ? (
                        <textarea rows={2} value={coachOperationDraft.operation[field] || ""} onChange={(event) => setCoachOperationDraft((current) => ({ ...current, operation: { ...current.operation, [field]: event.target.value } }))} />
                      ) : (
                        <input type={field === "scheduledAt" ? "datetime-local" : field === "dueDate" ? "date" : "text"} value={coachOperationDraft.operation[field] || ""} onChange={(event) => setCoachOperationDraft((current) => ({ ...current, operation: { ...current.operation, [field]: event.target.value } }))} />
                      )}
                    </label>
                  ))}
                </div>
              ) : coachOperationDraft.operation.kind === "stage_answer" || coachOperationDraft.operation.kind === "lead_call_outcome" ? (
                <label>
                  {coachOperationDraft.operation.kind === "stage_answer" ? "Respuesta de etapa" : "Comentario del resultado"}
                  <textarea
                    rows={4}
                    value={coachOperationDraft.value}
                    onChange={(event) => setCoachOperationDraft((current) => ({ ...current, value: event.target.value }))}
                  />
                </label>
              ) : (
                <label>
                  Nuevo valor
                  <input
                    value={coachOperationDraft.value}
                    onChange={(event) => setCoachOperationDraft((current) => ({ ...current, value: event.target.value }))}
                  />
                </label>
              )}
              {coachOperationDraft.operation.kind === "stage_answer" && coachOperationDraft.operation.previousAnswer ? (
                <label>
                  Tratamiento de la respuesta anterior
                  <select
                    value={coachOperationDraft.answerMode}
                    onChange={(event) => setCoachOperationDraft((current) => ({ ...current, answerMode: event.target.value }))}
                  >
                    <option value="replace">Reemplazar</option>
                    <option value="append">Agregar a la respuesta anterior</option>
                  </select>
                </label>
              ) : null}
              {coachOperationDraft.error ? <p className="form-error" role="alert">{coachOperationDraft.error}</p> : null}
            </div>
            <div className="modal-buttons">
              <button type="button" className="btn-secondary" onClick={() => rejectCoachOperation(coachOperationDraft.operation)} disabled={savingCoachOperation}>Cancelar</button>
              <button
                type="button"
                className="btn-primary"
                onClick={applyCoachOperation}
                disabled={savingCoachOperation || (
                  coachOperationDraft.operation.kind === "activity"
                    ? !String(coachOperationDraft.operation.title || "").trim() || !String(coachOperationDraft.operation.scheduledAt || "").trim()
                    : ["create_account", "create_contact", "create_opportunity", "lead_resolve"].includes(coachOperationDraft.operation.kind)
                      ? !Object.keys(coachOperationDraft.payload || {}).length
                      : !String(coachOperationDraft.value || "").trim()
                )}
              >
                {savingCoachOperation ? "Guardando..." : "Confirmar y guardar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {analysis?.risks?.length ? <section className="mi-agent-risks"><div className="mi-agent-section-heading"><div><span className="mi-agent-section-label">Señales a vigilar</span><h3>Riesgos principales</h3></div></div><div className="mi-agent-risk-list">{analysis.risks.map((risk) => <div key={risk}>!</div>)}</div><ul>{analysis.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul></section> : null}
    </section>
  );
}
