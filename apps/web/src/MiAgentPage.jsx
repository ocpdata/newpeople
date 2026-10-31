import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LayoutDashboard, Pencil, Settings2, Trash2 } from "lucide-react";
import { api, getApiErrorMessage } from "./api";
import { CustomerChatEvaluations } from "./coach/CustomerChatEvaluations";
import { useCustomerChat } from "./coach/useCustomerChat";
import { formatDate } from "./coach/customerChatShared";
import "./mi-agent.css";
import "./mi-agent-prospect.css";
import "./mi-agent-navigation.css";
import "./mi-agent-detail.css";
import "./mi-agent-execution-kit.css";
import "./mi-agent-health.css";
import "./mi-agent-alerts.css";
import "./mi-agent-activity-progress.css";
import "./mi-agent-activity-message.css";
import "./mi-agent-coach.css";
import "./mi-agent-feedback.css";
import "./mi-agent-rules.css";
import "./mi-agent-coach-thread.css";
import ServerRulesSection from "./ServerRulesSection";
import SemanticClassifierSection from "./SemanticClassifierSection";
import { normalizeCommercialActivityType } from "../../../shared/commercial-activity-types.js";
import { stageAnswerPrefillStorageKey } from "../../../shared/stage-answer-prefill.js";
import {
  COACH_FOUNDATION_VISIBILITY_KEY,
  COACH_HANDOFF_OPERATION_KINDS,
  COACH_OPERATION_OPTIONS,
  COACH_POLL_TIMEOUT_MS,
  COACH_RULE_CHANNEL_LABELS,
  CUSTOMER_FINDING_APPLY_FIELDS,
  PROSPECT_SESSION_STORAGE_KEY,
} from "./coach/miAgentConstants";
import {
  buildCoachOperationDraft,
  buildCoachOpportunityOptions,
  buildSnapshot,
  formatCurrency,
  getCoachBusinessRulesProcess,
  getCoachProcessOption,
  serializeCoachOperationDraft,
  unresolvedCoachFields,
} from "./coach/miAgentHelpers";
import { AdministrationGroups } from "./coach/MiAgentWidgets";
import { ChannelPolicySection } from "./coach/ChannelPolicySection";
import { CoachAnalysisContent } from "./coach/CoachAnalysisContent";
import { CoachConversationPanel } from "./coach/CoachConversationPanel";
import { CoachOperationDialog } from "./coach/CoachOperationDialog";
import { CustomerAccountWorkspace } from "./coach/CustomerAccountWorkspace";
import { CustomerChatDiagnosticsPanel } from "./coach/CustomerChatDiagnosticsPanel";
import { DecisionObservabilitySection } from "./coach/DecisionObservabilitySection";
import { GovernanceSettingsSection } from "./coach/GovernanceSettingsSection";
import { IntentGovernanceSection } from "./coach/IntentGovernanceSection";
import { ProspectWorkspace } from "./coach/ProspectWorkspace";

export default function MiAgentPage({
  canUseCoach = false,
  canExecuteCoach = false,
  canCreateActions = false,
  canUpdateLeads = false,
  canReadLeads = false,
  canCreateLeads = false,
  canUpdateAccounts = false,
  canUpdateContacts = false,
  canCreateAccounts = false,
  canCreateContacts = false,
  canResolveLeads = false,
  canCreateOpportunities = false,
  canUpdateCommercialDevelopment = false,
  canUpdateCalendar = false,
  canCreateQuotations = false,
  canCreateProposals = false,
  canUseExternalSources = false,
  canReadProspecting = false,
  canCreateProspecting = false,
  canUpdateProspecting = false,
  canAccessProspectChat = false,
  canReadCustomerIntelligence = false,
  canAccessCustomerChat = false,
  canManageCoach = false,
  canDiagnoseCustomerChats = false,
  canReadEvaluations = false,
  canExecuteEvaluations = false,
  canWriteEvaluations = false,
}) {
  const navigate = useNavigate();
  const [activeWorkspace, setActiveWorkspace] = useState(() => {
    if (canReadEvaluations && new URLSearchParams(window.location.search).has("evaluationRun")) return "evaluations";
    if (canUseCoach) return "summary";
    if (canAccessCustomerChat && canReadCustomerIntelligence) return "customer";
    if (
      canAccessProspectChat &&
      (canReadProspecting || canCreateProspecting)
    ) return "prospect";
    if (canManageCoach) return "admin";
    if (canDiagnoseCustomerChats) return "chat-diagnostics";
    if (canReadEvaluations) return "evaluations";
    return "empty";
  });
  const [chatDiagnosticsQuery, setChatDiagnosticsQuery] = useState("");
  const [chatDiagnosticsStatus, setChatDiagnosticsStatus] = useState("all");
  const [chatDiagnosticsReviewStatus, setChatDiagnosticsReviewStatus] = useState("all");
  const [chatDiagnosticsClosingId, setChatDiagnosticsClosingId] = useState(null);
  const [chatDiagnosticsAccountId, setChatDiagnosticsAccountId] = useState("");
  const [chatDiagnosticsDateFrom, setChatDiagnosticsDateFrom] = useState("");
  const [chatDiagnosticsDateTo, setChatDiagnosticsDateTo] = useState("");
  const [chatDiagnosticsPage, setChatDiagnosticsPage] = useState(1);
  const [chatDiagnosticsResult, setChatDiagnosticsResult] = useState(null);
  const [chatDiagnosticsSelected, setChatDiagnosticsSelected] = useState(null);
  const [chatDiagnosticsLoading, setChatDiagnosticsLoading] = useState(false);
  const [chatDiagnosticsError, setChatDiagnosticsError] = useState("");
  const [dashboard, setDashboard] = useState(null);
  const [coachAccounts, setCoachAccounts] = useState([]);
  const [coachOpportunities, setCoachOpportunities] = useState([]);
  const [coachContacts, setCoachContacts] = useState([]);
  const [coachContext, setCoachContext] = useState({
    accountId: "",
    opportunityId: "",
    contactId: "",
    leadId: "",
  });
  const [coachSessionId, setCoachSessionId] = useState(null);
  const [loadingCoachContext, setLoadingCoachContext] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [creatingActionRank, setCreatingActionRank] = useState(null);
  const [error, setError] = useState("");
  const [coachNotice, setCoachNotice] = useState("");
  const [selectedAction, setSelectedAction] = useState(null);
  const [coachQuestion, setCoachQuestion] = useState("");
  const [askingCoach, setAskingCoach] = useState(false);
  const [coachMessages, setCoachMessages] = useState([]);
  const [showCoachFoundation, setShowCoachFoundation] = useState(
    () =>
      window.localStorage.getItem(COACH_FOUNDATION_VISIBILITY_KEY) === "true",
  );
  const [coachActionDraft, setCoachActionDraft] = useState(null);
  const [coachOperationDraft, setCoachOperationDraft] = useState(null);
  const [
    coachOperationOpportunityOptionsOverride,
    setCoachOperationOpportunityOptionsOverride,
  ] = useState(null);
  const [coachPendingOperations, setCoachPendingOperations] = useState([]);
  const [coachRecentOperations, setCoachRecentOperations] = useState([]);
  const [coachUndoOperationId, setCoachUndoOperationId] = useState(null);
  const [savingCoachOperation, setSavingCoachOperation] = useState(false);
  const [coachDraftSaving, setCoachDraftSaving] = useState(false);
  const [coachOperationAction, setCoachOperationAction] = useState({});
  const [coachGovernance, setCoachGovernance] = useState(null);
  const [coachGovernanceLoading, setCoachGovernanceLoading] = useState(false);
  const [coachGovernanceSaving, setCoachGovernanceSaving] = useState(false);
  const [plannerPrompts, setPlannerPrompts] = useState([]);
  const [plannerPromptSaving, setPlannerPromptSaving] = useState("");
  const [plannerPromptNotice, setPlannerPromptNotice] = useState("");
  const [coachQualitySummary, setCoachQualitySummary] = useState(null);
  const [coachDecisionTraces, setCoachDecisionTraces] = useState([]);
  const [coachDecisionTraceDetail, setCoachDecisionTraceDetail] =
    useState(null);
  const [coachDecisionTraceFilters, setCoachDecisionTraceFilters] = useState({
    channel: "coach",
    reviewStatus: "all",
    limit: 8,
  });
  const [coachQualityLoading, setCoachQualityLoading] = useState(false);
  const [coachDecisionTraceLoading, setCoachDecisionTraceLoading] =
    useState(false);
  const [coachDecisionReviewSaving, setCoachDecisionReviewSaving] =
    useState(false);
  const [coachBusinessRulesDraft, setCoachBusinessRulesDraft] = useState("");
  const [coachBusinessRulesChannel, setCoachBusinessRulesChannel] =
    useState("coach");
  const [coachBusinessRulesProcess, setCoachBusinessRulesProcess] =
    useState("default");
  const [coachBusinessRulesSource, setCoachBusinessRulesSource] =
    useState(null);
  const [coachAdminRules, setCoachAdminRules] = useState([]);
  const [coachIntentCatalog, setCoachIntentCatalog] = useState([]);
  const [coachIntentRevisions, setCoachIntentRevisions] = useState([]);
  const [coachIntentCode, setCoachIntentCode] = useState("");
  const [coachIntentExamplesDraft, setCoachIntentExamplesDraft] = useState("");
  const [coachIntentTestQuestion, setCoachIntentTestQuestion] = useState("");
  const [coachIntentPreview, setCoachIntentPreview] = useState(null);
  const [coachIntentFeedback, setCoachIntentFeedback] = useState(null);
  const [channelIntentChannel, setChannelIntentChannel] = useState("coach");
  const [channelIntentCatalog, setChannelIntentCatalog] = useState([]);
  const [channelIntentRevisions, setChannelIntentRevisions] = useState([]);
  const [channelIntentCode, setChannelIntentCode] = useState("");
  const [channelIntentDraft, setChannelIntentDraft] = useState(null);
  const [channelIntentTestQuestion, setChannelIntentTestQuestion] =
    useState("");
  const [channelIntentPreview, setChannelIntentPreview] = useState(null);
  const [channelIntentFeedback, setChannelIntentFeedback] = useState(null);
  const [channelIntentSaving, setChannelIntentSaving] = useState(false);
  const [coachAdminRuleDraft, setCoachAdminRuleDraft] = useState(null);
  const [coachAdminRuleEditingId, setCoachAdminRuleEditingId] = useState(null);
  const [coachAdminRuleFeedback, setCoachAdminRuleFeedback] = useState(null);
  const [customerIntelligenceJob, setCustomerIntelligenceJob] = useState(null);
  const customerIntelligenceResultRef = useRef(null);
  const [openCustomerAction, setOpenCustomerAction] = useState(null);
  const [customerAccounts, setCustomerAccounts] = useState([]);
  const [customerAccountSearch, setCustomerAccountSearch] = useState("");
  const [customerAccountId, setCustomerAccountId] = useState("");
  const [customerContextSnapshot, setCustomerContextSnapshot] = useState(null);
  const [customerAnalysisSnapshot, setCustomerAnalysisSnapshot] = useState(null);
  const customerAnalysisRevisionRef = useRef(0);
  const customerSnapshot = customerAnalysisSnapshot || customerContextSnapshot;
  const [customerSnapshotLoading, setCustomerSnapshotLoading] = useState(false);
  const [customerFindings, setCustomerFindings] = useState([]);
  const [customerInvestigating, setCustomerInvestigating] = useState(false);
  const [customerIntelligenceError, setCustomerIntelligenceError] =
    useState("");
  const [customerActionErrors, setCustomerActionErrors] = useState({
    analysis: "",
    agents: "",
    briefing: "",
    call: "",
  });
  const [customerFindingApplyDraft, setCustomerFindingApplyDraft] =
    useState(null);
  const [customerFindingApplying, setCustomerFindingApplying] = useState(false);
  const [customerContactApplyDraft, setCustomerContactApplyDraft] =
    useState(null);
  const [customerContactApplying, setCustomerContactApplying] = useState(false);
  const [customerDiscoveryJob, setCustomerDiscoveryJob] = useState(null);
  const [customerDiscoveryPreparing, setCustomerDiscoveryPreparing] =
    useState(false);
  const [customerExecutiveBriefingJob, setCustomerExecutiveBriefingJob] =
    useState(null);
  const [
    customerExecutiveBriefingLoading,
    setCustomerExecutiveBriefingLoading,
  ] = useState(false);
  const [customerAgentsJob, setCustomerAgentsJob] = useState(null);
  const [customerAgentsLoading, setCustomerAgentsLoading] = useState(false);
  const [customerFocusOptions, setCustomerFocusOptions] = useState({ enabled: false, opportunities: [] });
  const [customerFocusOpportunityId, setCustomerFocusOpportunityId] = useState("");
  const [prospectForm, setProspectForm] = useState({
    companyName: "",
    country: "",
    website: "",
    industry: "",
  });
  const [prospectView, setProspectView] = useState("new");
  const [prospectListSearch, setProspectListSearch] = useState("");
  const [prospectList, setProspectList] = useState({
    items: [],
    total: 0,
    limit: 25,
    offset: 0,
  });
  const [prospectListLoading, setProspectListLoading] = useState(false);
  const [prospectListError, setProspectListError] = useState("");
  const [prospectTargetUpdatingId, setProspectTargetUpdatingId] =
    useState(null);
  const [prospectSession, setProspectSession] = useState(null);
  const [prospectChatQuestion, setProspectChatQuestion] = useState("");
  const [prospectChatMessages, setProspectChatMessages] = useState([]);
  const [prospectChatLoading, setProspectChatLoading] = useState(false);
  const [prospectPreparing, setProspectPreparing] = useState(false);
  const [prospectError, setProspectError] = useState("");
  const [prospectConversionConfirmation, setProspectConversionConfirmation] =
    useState("");
  const [prospectFindingUpdatingId, setProspectFindingUpdatingId] =
    useState(null);
  const [prospectConverting, setProspectConverting] = useState("");
  const [prospectExternalResearching, setProspectExternalResearching] =
    useState(false);
  const [prospectConvertedAccountId, setProspectConvertedAccountId] =
    useState(null);
  const [prospectConvertedLeadId, setProspectConvertedLeadId] = useState(null);
  const [prospectConvertedContacts, setProspectConvertedContacts] = useState(
    {},
  );
  const [prospectConvertedOpportunities, setProspectConvertedOpportunities] =
    useState({});
  const [prospectContactDrafts, setProspectContactDrafts] = useState({});
  const coachContextRef = useRef(coachContext);
  const coachThreadRef = useRef(null);
  const coachDialogRef = useRef(null);
  const coachReturnFocusRef = useRef(null);
  const coachActiveSessionCheckedRef = useRef(false);
  const coachActiveSessionRequestRef = useRef(null);
  const coachContextRevisionRef = useRef(0);
  const coachDraftSaveSignatureRef = useRef("");
  // Set while the Coach dialog shows a proposal opened from the customer chat, so the chat learns how it ended.
  const coachChatOriginRef = useRef(null);

  useEffect(() => {
    const sessionId = Number(
      window.sessionStorage.getItem(PROSPECT_SESSION_STORAGE_KEY) || 0,
    );
    if (!sessionId) return undefined;
    let cancelled = false;
    api
      .get(`/api/prospect-research/sessions/${sessionId}`)
      .then(({ data }) => {
        if (cancelled || !data?.session) return;
        const session = data.session;
        setProspectSession(session);
        setProspectForm({
          companyName: session.companyName || "",
          country: session.country || "",
          website: session.website || "",
          industry: session.industry || "",
        });
        setProspectChatMessages(
          (Array.isArray(session.chatHistory) ? session.chatHistory : []).map(
            (message) => ({
              ...message,
              role: message.role === "assistant" ? "assistant" : "seller",
              text: message.text || message.answer || "",
            }),
          ),
        );
      })
      .catch(() => {
        if (!cancelled) {
          window.sessionStorage.removeItem(PROSPECT_SESSION_STORAGE_KEY);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activeWorkspace !== "prospect" || prospectView === "new") return;
    loadProspectSessions({
      search: prospectListSearch,
      targetOnly: prospectView === "targets",
      offset: 0,
    });
  }, [activeWorkspace, prospectView]);

  useEffect(() => {
    if (customerIntelligenceJob?.status !== "completed") return;
    customerIntelligenceResultRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [customerIntelligenceJob?.status]);

  useEffect(() => {
    coachContextRef.current = coachContext;
  }, [coachContext]);

  useEffect(() => {
    if (coachSessionId)
      window.localStorage.setItem(
        "mi-agent-coach-session",
        String(coachSessionId),
      );
    else window.localStorage.removeItem("mi-agent-coach-session");
  }, [coachSessionId]);

  useEffect(() => {
    if (!coachSessionId || coachMessages.length) return undefined;
    const contextRevision = coachContextRevisionRef.current;
    let cancelled = false;
    api
      .get(`/api/mi-agent/coach/sessions/${coachSessionId}`)
      .then(({ data }) => {
        if (
          cancelled ||
          contextRevision !== coachContextRevisionRef.current ||
          !data?.session
        )
          return;
        const session = data.session;
        setCoachContext((current) => ({
          ...current,
          accountId: String(
            session.context?.accountId || current.accountId || "",
          ),
          contactId: String(
            session.context?.contactId || current.contactId || "",
          ),
          opportunityId: String(
            session.context?.opportunityId || current.opportunityId || "",
          ),
          leadId: String(session.context?.leadId || current.leadId || ""),
        }));
        setCoachMessages(session.messages || []);
        setCoachPendingOperations(data.operations || []);
        setCoachRecentOperations(data.recentOperations || []);
      })
      .catch(() => {
        if (!cancelled) setCoachSessionId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [coachSessionId, coachMessages.length]);

  useEffect(() => {
    if (coachActiveSessionCheckedRef.current || coachSessionId) return;
    if (!canUseCoach) {
      coachActiveSessionCheckedRef.current = true;
      return;
    }
    coachActiveSessionCheckedRef.current = true;
    const contextRevision = coachContextRevisionRef.current;
    const request = api.get("/api/mi-agent/coach/sessions/active");
    coachActiveSessionRequestRef.current = request;
    request
      .then(({ data }) => {
        if (
          contextRevision !== coachContextRevisionRef.current ||
          !data?.session
        )
          return;
        setCoachSessionId(Number(data.session.id));
        setCoachMessages(data.session.messages || []);
        setCoachPendingOperations(data.operations || []);
        setCoachRecentOperations(data.recentOperations || []);
        setCoachContext((current) => ({
          ...current,
          accountId: String(data.session.context?.accountId || ""),
          contactId: String(data.session.context?.contactId || ""),
          opportunityId: String(data.session.context?.opportunityId || ""),
          leadId: String(data.session.context?.leadId || ""),
        }));
      })
      .catch(() => undefined)
      .finally(() => {
        if (coachActiveSessionRequestRef.current === request) {
          coachActiveSessionRequestRef.current = null;
        }
      });
  }, [canUseCoach, coachSessionId]);

  useEffect(() => {
    if (
      !coachOperationDraft?.persistentId ||
      savingCoachOperation ||
      coachOperationDraft.operation.kind === "activity"
    )
      return undefined;
    const pendingOperation = serializeCoachOperationDraft(coachOperationDraft);
    const missingFields = unresolvedCoachFields(pendingOperation);
    const signature = JSON.stringify({ pendingOperation, missingFields });
    if (signature === coachDraftSaveSignatureRef.current) return undefined;
    const timer = window.setTimeout(() => {
      setCoachDraftSaving(true);
      api
        .patch(
          `/api/mi-agent/coach/operations/${coachOperationDraft.persistentId}`,
          {
            pendingOperation,
            missingFields,
            version: coachOperationDraft.version,
          },
        )
        .then(({ data }) => {
          const saved = data?.operation;
          if (!saved) return;
          coachDraftSaveSignatureRef.current = signature;
          setCoachOperationDraft((current) =>
            current?.persistentId === saved.id
              ? {
                  ...current,
                  version: saved.version,
                  persistenceStatus: saved.status,
                }
              : current,
          );
          setCoachPendingOperations((current) =>
            current.map((item) => (item.id === saved.id ? saved : item)),
          );
        })
        .catch((requestError) => {
          const serverOperation = requestError?.response?.data?.operation;
          const message = getApiErrorMessage(
            requestError,
            "No fue posible guardar el borrador del Coach",
          );
          if (serverOperation) {
            setCoachPendingOperations((current) =>
              current.map((item) =>
                item.id === serverOperation.id ? serverOperation : item,
              ),
            );
          }
          setCoachOperationDraft((current) =>
            current
              ? {
                  ...current,
                  operation:
                    serverOperation?.pendingOperation || current.operation,
                  version: serverOperation?.version || current.version,
                  persistenceStatus:
                    serverOperation?.status || current.persistenceStatus,
                  error: message,
                }
              : current,
          );
        })
        .finally(() => setCoachDraftSaving(false));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [coachOperationDraft, savingCoachOperation]);

  const coachOperationFocusKey =
    coachOperationDraft?.idempotencyKey ||
    coachOperationDraft?.persistentId ||
    coachOperationDraft?.operation?.kind ||
    null;

  useEffect(() => {
    if (coachOperationFocusKey) coachDialogRef.current?.focus();
  }, [coachOperationFocusKey]);

  useEffect(() => {
    if (coachThreadRef.current) {
      coachThreadRef.current.scrollTop = coachThreadRef.current.scrollHeight;
    }
  }, [coachMessages]);

  async function loadDashboard() {
    setLoading(true);
    setError("");
    try {
      if (canUseCoach) {
        const { data } = await api.get("/api/mi-agent/context");
        setDashboard(data);
      } else {
        setDashboard(null);
      }
      if (canUseCoach || canReadCustomerIntelligence) {
        const accountsResponse = await api.get("/api/accounts?activeOnly=true");
        const accounts = Array.isArray(accountsResponse.data)
          ? accountsResponse.data
          : [];
        setCoachAccounts(canUseCoach ? accounts : []);
        setCustomerAccounts(
          canReadCustomerIntelligence ? accounts : [],
        );
      } else {
        setCoachAccounts([]);
        setCustomerAccounts([]);
      }
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar el contexto de Mi Coach",
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  function requestCoachGeneralScope() {
    const pendingOperationCount = coachPendingOperations.length;
    const pendingOperationNotice = pendingOperationCount
      ? pendingOperationCount === 1
        ? " También se descartará 1 acción pendiente."
        : ` También se descartarán ${pendingOperationCount} acciones pendientes.`
      : "";

    const confirmed = window.confirm(
      `Volver al ámbito general cerrará esta conversación y limpiará sus mensajes y borradores.${pendingOperationNotice} No podrás reabrirla desde Coach. ¿Continuar?`,
    );
    if (confirmed) void resetCoachToGeneral();
  }

  async function clearCoachConversation() {
    const hasConversationState = Boolean(
      coachSessionId ||
      coachMessages.length ||
      coachRecentOperations.length ||
      coachOperationDraft,
    );
    if (!hasConversationState) return;
    const pendingOperationCount = coachPendingOperations.length;
    const pendingOperationNotice =
      pendingOperationCount === 1
        ? " También se descartará 1 acción pendiente."
        : pendingOperationCount
          ? ` También se descartarán ${pendingOperationCount} acciones pendientes.`
          : "";
    const confirmed = window.confirm(
      `Se cerrará esta conversación y se eliminarán sus mensajes de la vista.${pendingOperationNotice} ¿Continuar?`,
    );
    if (!confirmed) return;

    const sessionId = Number(coachSessionId || 0);
    coachContextRevisionRef.current += 1;
    coachActiveSessionRequestRef.current = null;
    setError("");
    try {
      if (pendingOperationCount) {
        await Promise.all(
          coachPendingOperations.map((operation) =>
            api.post(`/api/mi-agent/coach/operations/${operation.id}/status`, {
              status: "cancelled",
              cancellationReason: "Descartada al limpiar la conversación",
            }),
          ),
        );
      }
      if (sessionId) {
        await api.post(`/api/mi-agent/coach/sessions/${sessionId}/close`);
      }
      setCoachSessionId(null);
      setCoachMessages([]);
      setCoachQuestion("");
      setCoachNotice("");
      setCoachActionDraft(null);
      setCoachOperationDraft(null);
      setCoachPendingOperations([]);
      setCoachRecentOperations([]);
      setCoachUndoOperationId(null);
      setCoachOperationAction({});
      coachDraftSaveSignatureRef.current = "";
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible limpiar la conversación del Coach",
        ),
      );
    }
  }

  async function resetCoachToGeneral() {
    setLoadingCoachContext(true);
    setError("");
    const pendingRestore = coachActiveSessionRequestRef.current;
    coachContextRevisionRef.current += 1;
    coachActiveSessionRequestRef.current = null;
    try {
      const restoredSessionResponse = pendingRestore
        ? await pendingRestore.catch(() => null)
        : null;
      const generalContext = {
        accountId: "",
        opportunityId: "",
        contactId: "",
        leadId: "",
      };
      const sessionIdToClose = Number(
        coachSessionId || restoredSessionResponse?.data?.session?.id || 0,
      );
      if (coachPendingOperations.length) {
        await Promise.all(
          coachPendingOperations.map((operation) =>
            api.post(`/api/mi-agent/coach/operations/${operation.id}/status`, {
              status: "cancelled",
              cancellationReason: "Descartada al volver al ámbito general",
            }),
          ),
        );
      }
      if (sessionIdToClose) {
        await api.post(
          `/api/mi-agent/coach/sessions/${sessionIdToClose}/close`,
        );
      }

      setCoachContext(generalContext);
      coachContextRef.current = generalContext;
      setCoachSessionId(null);
      setCoachOpportunities([]);
      setCoachContacts([]);
      setCoachMessages([]);
      setCoachQuestion("");
      setCoachActionDraft(null);
      setCoachOperationDraft(null);
      setCoachPendingOperations([]);
      setCoachRecentOperations([]);
      setCoachUndoOperationId(null);
      setCoachOperationAction({});
      setCoachNotice("");
      coachDraftSaveSignatureRef.current = "";
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible volver al ámbito general del Coach",
        ),
      );
    } finally {
      setLoadingCoachContext(false);
    }
  }

  async function searchCustomerAccounts(value) {
    setCustomerAccountSearch(value);
    try {
      const response = await api.get(
        `/api/accounts?activeOnly=true&search=${encodeURIComponent(value)}`,
      );
      setCustomerAccounts(Array.isArray(response.data) ? response.data : []);
    } catch (requestError) {
      setCustomerIntelligenceError(
        getApiErrorMessage(requestError, "No fue posible buscar cuentas"),
      );
    }
  }

  function selectCustomerAccount(accountId) {
    setCustomerAccountId(String(accountId || ""));
    resetCustomerIntelligence();
  }

  function openCoachDetailHandoff(handoff) {
    if (handoff?.destination === "customer_account") {
      if (!canReadCustomerIntelligence || !Number(handoff.accountId || 0)) {
        return;
      }
      setActiveWorkspace("customer");
      selectCustomerAccount(handoff.accountId);
      return;
    }
    if (
      handoff?.destination === "lead_management" &&
      canReadLeads &&
      Number(handoff.leadId || 0)
    ) {
      navigate(`/interactions?leadId=${Number(handoff.leadId)}`);
    }
  }

  async function applyCoachActiveContext(
    activeContext,
    expectedRevision = coachContextRevisionRef.current,
  ) {
    if (expectedRevision !== coachContextRevisionRef.current) return;
    const nextContext = {
      accountId: String(activeContext?.accountId || ""),
      opportunityId: String(activeContext?.opportunityId || ""),
      contactId: String(activeContext?.contactId || ""),
      leadId: String(activeContext?.leadId || ""),
    };
    const hasChanged = [
      "accountId",
      "opportunityId",
      "contactId",
      "leadId",
    ].some((key) => nextContext[key] !== coachContextRef.current[key]);
    setCoachContext(nextContext);
    if (!hasChanged) return;
    if (!nextContext.accountId) {
      setCoachOpportunities([]);
      setCoachContacts([]);
      return;
    }

    const [contextResponse, opportunitiesResponse, contactsResponse] =
      await Promise.all([
        api.get("/api/mi-agent/context"),
        api.get(
          `/api/opportunities?accountId=${nextContext.accountId}&activeOnly=true&openOnly=true`,
        ),
        api.get(
          `/api/contacts?accountId=${nextContext.accountId}&opportunityId=${nextContext.opportunityId}&activeOnly=true`,
        ),
      ]);
    if (expectedRevision !== coachContextRevisionRef.current) return;
    const accountSnapshot = buildSnapshot(contextResponse.data);
    setDashboard(contextResponse.data);
    setCoachAccounts((current) => {
      const accounts = new Map(
        current.map((account) => [Number(account.id), account]),
      );
      accountSnapshot.accounts.forEach((account) =>
        accounts.set(Number(account.id), account),
      );
      return [...accounts.values()];
    });
    setCoachOpportunities(
      buildCoachOpportunityOptions(
        opportunitiesResponse.data,
        accountSnapshot,
        nextContext.accountId,
      ),
    );
    setCoachContacts(
      Array.isArray(contactsResponse.data) ? contactsResponse.data : [],
    );
  }

  useEffect(() => {
    if (
      canDiagnoseCustomerChats &&
      !canUseCoach &&
      !canAccessCustomerChat &&
      !canAccessProspectChat
    ) {
      setLoading(false);
      void loadCustomerChatDiagnostics({ page: 1 });
      return;
    }
    loadDashboard();
  }, []);

  const snapshot = useMemo(() => buildSnapshot(dashboard), [dashboard]);
  const currency = snapshot.quota.currencyCode;
  const coverage =
    snapshot.quota.currencyConversionAvailable && snapshot.quota.gapAmount
      ? snapshot.pipeline.openAmount / snapshot.quota.gapAmount
      : null;
  const sortedCustomerAccounts = useMemo(
    () => [...customerAccounts].sort((a, b) =>
      a.name.localeCompare(b.name, "es", { sensitivity: "base" }),
    ),
    [customerAccounts],
  );
  const selectedCustomerAccount =
    customerAccounts.find(
      (item) => String(item.id) === String(customerAccountId),
    ) || null;
  const hasCustomerContext = Boolean(customerAccountId);

  useEffect(() => {
    setCustomerFocusOpportunityId("");
    if (activeWorkspace !== "customer" || !hasCustomerContext) {
      setCustomerFocusOptions({ enabled: false, opportunities: [] });
      return undefined;
    }
    let cancelled = false;
    api
      .get("/api/commercial-intelligence/account-chat/focus-options", {
        params: { accountId: Number(customerAccountId) },
      })
      .then((response) => {
        if (!cancelled) {
          setCustomerFocusOptions({
            enabled: Boolean(response.data?.enabled),
            opportunities: Array.isArray(response.data?.opportunities) ? response.data.opportunities : [],
            status: response.data?.status || null,
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setCustomerFocusOptions({
            enabled: false,
            opportunities: [],
            error: error?.response?.data?.message || "No se pudieron cargar las oportunidades de la cuenta.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeWorkspace, customerAccountId, hasCustomerContext]);

  useEffect(() => {
    if (activeWorkspace !== "customer" || !hasCustomerContext) {
      setCustomerContextSnapshot(null);
      return undefined;
    }
    let cancelled = false;
    setCustomerSnapshotLoading(true);
    api
      .get("/api/commercial-intelligence/account-intelligence/snapshot", {
        params: {
          accountId: Number(customerAccountId),
        },
      })
      .then((response) => {
        if (!cancelled) {
          setCustomerContextSnapshot(response.data?.snapshot || null);
        }
      })
      .catch((requestError) => {
        if (!cancelled)
          setCustomerIntelligenceError(
            getApiErrorMessage(
              requestError,
              "No fue posible cargar el contexto de la cuenta",
            ),
          );
      })
      .finally(() => {
        if (!cancelled) setCustomerSnapshotLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeWorkspace, customerAccountId, hasCustomerContext]);

  const customerChat = useCustomerChat({
    activeWorkspace,
    customerAccountId,
    hasCustomerContext,
    buildCustomerIntelligencePayload,
    customerFocusOptions,
    customerFocusOpportunityId,
    setCustomerIntelligenceError,
  });
  const { askCustomerChat, customerChatLoading } = customerChat;

  function resetCustomerIntelligence() {
    customerChat.reset();
    setCustomerContextSnapshot(null);
    setCustomerAnalysisSnapshot(null);
    setCustomerSnapshotLoading(false);
    setCustomerInvestigating(false);
    setCustomerIntelligenceJob(null);
    setOpenCustomerAction(null);
    setCustomerFindings([]);
    setCustomerIntelligenceError("");
    setCustomerActionErrors({
      analysis: "",
      agents: "",
      briefing: "",
      call: "",
    });
    setCustomerFindingApplyDraft(null);
    setCustomerFindingApplying(false);
    setCustomerContactApplyDraft(null);
    setCustomerContactApplying(false);
    setCustomerDiscoveryJob(null);
    setCustomerDiscoveryPreparing(false);
    setCustomerExecutiveBriefingJob(null);
    setCustomerExecutiveBriefingLoading(false);
    setCustomerAgentsJob(null);
    setCustomerAgentsLoading(false);
    setCustomerFocusOpportunityId("");
  }

  function setCustomerActionResultOpen(action, isOpen) {
    setOpenCustomerAction((current) => {
      if (isOpen) return action;
      return current === action ? null : current;
    });
  }

  function buildCustomerIntelligencePayload() {
    return {
      accountId: customerAccountId ? Number(customerAccountId) : null,
      objective: "Investigar cliente existente desde Mi Coach",
    };
  }

  async function pollCustomerIntelligenceJob(jobId, revision) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (revision !== customerAnalysisRevisionRef.current) return null;
      const response = await api.get(
        `/api/commercial-intelligence/account-internal-analysis/jobs/${jobId}`,
      );
      if (revision !== customerAnalysisRevisionRef.current) return null;
      const job = response.data?.job || null;
      if (job) {
        setCustomerIntelligenceJob(job);
      }
      if (["completed", "failed"].includes(String(job?.status || ""))) {
        return job;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 600));
    }
    return null;
  }

  async function runCustomerInvestigation() {
    if (!hasCustomerContext) {
      setCustomerActionErrors((current) => ({
        ...current,
        analysis: "Selecciona una cuenta existente para investigar.",
      }));
      return;
    }
    const revision = ++customerAnalysisRevisionRef.current;
    const accountId = Number(customerAccountId);
    setCustomerInvestigating(true);
    setCustomerActionResultOpen("analysis", true);
    setCustomerActionErrors((current) => ({ ...current, analysis: "" }));
    setCoachNotice("");
    try {
      const response = await api.post(
        "/api/commercial-intelligence/account-internal-analysis/jobs",
        buildCustomerIntelligencePayload(),
      );
      if (revision !== customerAnalysisRevisionRef.current) return;
      const job = response.data?.job;
      if (!job?.id)
        throw new Error("No se pudo iniciar la investigación del cliente");
      setCustomerIntelligenceJob(job);
      const completedJob = await pollCustomerIntelligenceJob(job.id, revision);
      if (revision !== customerAnalysisRevisionRef.current) return;
      if (!completedJob || completedJob.status === "failed") {
        throw new Error(
          completedJob?.errorMessage ||
            "No fue posible completar la investigación del cliente",
        );
      }
      const snapshot = completedJob.result?.snapshot;
      if (!snapshot || Number(snapshot.account?.id) !== accountId) {
        throw new Error(
          "El análisis no devolvió información válida de la cuenta seleccionada.",
        );
      }
      setCustomerAnalysisSnapshot(snapshot);
      const findings = Array.isArray(completedJob.findings)
        ? completedJob.findings
        : [];
      const representedSources = new Map([
        [`account:${accountId}:description`, "need"],
        [`account:${accountId}:contacts`, "stakeholder"],
        [`account:${accountId}:opportunities`, "technology_project"],
        [`account:${accountId}:relationship-map`, "missing_information"],
      ]);
      setCustomerFindings(
        findings.filter(
          (finding) =>
            representedSources.get(finding.sourceReference) !== finding.category,
        ),
      );
      setCoachNotice("Investigación del cliente completada.");
    } catch (requestError) {
      if (revision !== customerAnalysisRevisionRef.current) return;
      setCustomerActionErrors((current) => ({
        ...current,
        analysis: getApiErrorMessage(
          requestError,
          "No fue posible investigar el cliente",
        ),
      }));
    } finally {
      if (revision === customerAnalysisRevisionRef.current) {
        setCustomerInvestigating(false);
      }
    }
  }

  async function applyCustomerFinding() {
    const draft = customerFindingApplyDraft;
    if (
      !draft?.finding?.id ||
      !draft.target ||
      !draft.field ||
      !String(draft.value || "").trim()
    )
      return;
    setCustomerFindingApplying(true);
    setCustomerIntelligenceError("");
    try {
      await api.post(
        `/api/commercial-intelligence/findings/${draft.finding.id}/apply`,
        {
          target: draft.target,
          field: draft.field,
          value: draft.value.trim(),
          mode: draft.mode,
        },
      );
      setCustomerFindingApplyDraft(null);
      setCoachNotice("Hallazgo aplicado al registro correctamente.");
    } catch (requestError) {
      setCustomerIntelligenceError(
        getApiErrorMessage(
          requestError,
          "No fue posible aplicar el hallazgo al registro",
        ),
      );
    } finally {
      setCustomerFindingApplying(false);
    }
  }

  async function applyCustomerContact() {
    const draft = customerContactApplyDraft;
    if (!draft?.finding?.id) return;
    setCustomerContactApplying(true);
    try {
      await api.post(
        `/api/commercial-intelligence/findings/${draft.finding.id}/apply-contact`,
        {
          contactId: draft.contactId ? Number(draft.contactId) : null,
          contactData: draft.contactData,
        },
      );
      setCustomerContactApplyDraft(null);
      setCoachNotice("Contacto confirmado y guardado correctamente.");
    } catch (requestError) {
      setCustomerIntelligenceError(
        getApiErrorMessage(requestError, "No fue posible guardar el contacto"),
      );
    } finally {
      setCustomerContactApplying(false);
    }
  }

  async function pollCustomerDiscoveryJob(jobId) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await api.get(
        `/api/commercial-intelligence/commercial-discovery/jobs/${jobId}`,
      );
      const job = response.data?.job || null;
      if (job) setCustomerDiscoveryJob(job);
      if (["completed", "failed"].includes(String(job?.status || "")))
        return job;
      await new Promise((resolve) => window.setTimeout(resolve, 600));
    }
    return null;
  }

  async function prepareCustomerCall() {
    if (!hasCustomerContext) {
      setCustomerActionErrors((current) => ({
        ...current,
        call: "Selecciona una cuenta existente para preparar la llamada.",
      }));
      return;
    }
    setCustomerDiscoveryPreparing(true);
    setCustomerActionResultOpen("call", true);
    setCustomerActionErrors((current) => ({ ...current, call: "" }));
    setCoachNotice("");
    try {
      const response = await api.post(
        "/api/commercial-intelligence/commercial-discovery/jobs",
        buildCustomerIntelligencePayload(),
      );
      const job = response.data?.job;
      if (!job?.id)
        throw new Error("No se pudo iniciar la preparación comercial");
      setCustomerDiscoveryJob(job);
      const completedJob = await pollCustomerDiscoveryJob(job.id);
      if (!completedJob || completedJob.status === "failed") {
        throw new Error(
          completedJob?.errorMessage || "No fue posible preparar la llamada",
        );
      }
      setCoachNotice("Briefing comercial preparado.");
    } catch (requestError) {
      setCustomerActionErrors((current) => ({
        ...current,
        call: getApiErrorMessage(
          requestError,
          "No fue posible preparar la llamada",
        ),
      }));
    } finally {
      setCustomerDiscoveryPreparing(false);
    }
  }

  async function prepareCustomerExecutiveBriefing() {
    if (!hasCustomerContext) {
      setCustomerActionErrors((current) => ({
        ...current,
        briefing:
          "Selecciona una cuenta existente para preparar el resumen ejecutivo.",
      }));
      return;
    }
    setCustomerExecutiveBriefingLoading(true);
    setCustomerActionResultOpen("briefing", true);
    setCustomerActionErrors((current) => ({ ...current, briefing: "" }));
    try {
      const response = await api.post(
        "/api/commercial-intelligence/executive-briefing/jobs",
        buildCustomerIntelligencePayload(),
      );
      const jobId = Number(response.data?.job?.id || 0);
      if (!jobId) throw new Error("No se pudo iniciar el resumen ejecutivo");
      setCustomerExecutiveBriefingJob(response.data.job);
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const jobResponse = await api.get(
          `/api/commercial-intelligence/executive-briefing/jobs/${jobId}`,
        );
        const job = jobResponse.data?.job;
        if (job) setCustomerExecutiveBriefingJob(job);
        if (["completed", "failed"].includes(String(job?.status || ""))) {
          if (job.status === "failed")
            throw new Error(
              job.errorMessage ||
                "No fue posible preparar el resumen ejecutivo",
            );
          setCoachNotice("Resumen ejecutivo preparado.");
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 600));
      }
      throw new Error(
        "El resumen ejecutivo tardó demasiado; inténtalo de nuevo",
      );
    } catch (requestError) {
      setCustomerActionErrors((current) => ({
        ...current,
        briefing: getApiErrorMessage(
          requestError,
          "No fue posible preparar el resumen ejecutivo",
        ),
      }));
    } finally {
      setCustomerExecutiveBriefingLoading(false);
    }
  }

  async function runCustomerAgents() {
    if (!hasCustomerContext) {
      setCustomerActionErrors((current) => ({
        ...current,
        agents: "Selecciona una cuenta existente para ejecutar los agentes.",
      }));
      return;
    }
    setCustomerAgentsLoading(true);
    setCustomerActionResultOpen("agents", true);
    setCustomerActionErrors((current) => ({ ...current, agents: "" }));
    try {
      if (!canUseExternalSources) {
        throw new Error(
          "No tienes permiso para ejecutar agentes con fuentes públicas",
        );
      }
      const response = await api.post(
        "/api/commercial-intelligence/agents/jobs",
        { ...buildCustomerIntelligencePayload(), includePublicResearch: true },
      );
      const jobId = Number(response.data?.job?.id || 0);
      if (!jobId)
        throw new Error("No se pudo iniciar la orquestación de agentes");
      setCustomerAgentsJob(response.data.job);
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const jobResponse = await api.get(
          `/api/commercial-intelligence/agents/jobs/${jobId}`,
        );
        const job = jobResponse.data?.job;
        if (job) setCustomerAgentsJob(job);
        if (["completed", "failed"].includes(String(job?.status || ""))) {
          if (job.status === "failed")
            throw new Error(
              job.errorMessage || "No fue posible ejecutar los agentes",
            );
          setCoachNotice("Agentes especializados ejecutados.");
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 600));
      }
      throw new Error("La orquestación tardó demasiado; inténtalo de nuevo");
    } catch (requestError) {
      setCustomerActionErrors((current) => ({
        ...current,
        agents: getApiErrorMessage(
          requestError,
          "No fue posible ejecutar los agentes",
        ),
      }));
    } finally {
      setCustomerAgentsLoading(false);
    }
  }

  function openCustomerStageAnswerPrefill(prefill) {
    if (!canCreateActions) return;
    const opportunityId = Number(prefill?.opportunityId || 0);
    const questionIds = Array.isArray(prefill?.questionIds)
      ? prefill.questionIds
          .map((id) => Number(id))
          .filter((id) => Number.isInteger(id) && id > 0)
      : [];
    const appendText = String(prefill?.appendText || "").trim();
    if (!opportunityId || !questionIds.length || !appendText) return;

    setCustomerIntelligenceError("");
    const opportunityTab = window.open("about:blank", "_blank");
    if (!opportunityTab) {
      setCustomerIntelligenceError(
        "No fue posible abrir la oportunidad. Permite las ventanas emergentes de este sitio y vuelve a intentarlo.",
      );
      return;
    }
    try {
      // Detach the opener before navigating, and seed the new tab's own storage.
      opportunityTab.opener = null;
      const token = window.crypto.randomUUID();
      opportunityTab.sessionStorage.setItem(
        stageAnswerPrefillStorageKey(token),
        JSON.stringify({ opportunityId, questionIds, appendText }),
      );
      opportunityTab.location.replace(
        `/opportunities?edit=${opportunityId}&stageAnswerPrefill=${encodeURIComponent(token)}`,
      );
    } catch (err) {
      opportunityTab.close();
      setCustomerIntelligenceError(
        getApiErrorMessage(
          err,
          "No fue posible abrir la oportunidad con el borrador. Vuelve a intentarlo.",
        ),
      );
    }
  }

  async function openDiscoveryActivity(nextStep) {
    const opportunityId = Number(nextStep?.opportunityId || 0);
    if (!opportunityId || !canExecuteCoach || !canUpdateCalendar) return;
    const snapshotAccountId = Number(customerSnapshot?.account?.id || 0);
    const customerOpportunity = [
      ...(customerSnapshot?.opportunities || []),
      ...(customerSnapshot?.inactiveOpportunities || []),
    ].find(
      (item) =>
        Number(item.id) === opportunityId &&
        Number(item.accountId || snapshotAccountId) === snapshotAccountId &&
        snapshotAccountId === Number(customerAccountId || 0),
    );
    if (!customerOpportunity) {
      setError(
        "La oportunidad ya no está disponible en la cuenta seleccionada. Actualiza la información e inténtalo de nuevo.",
      );
      return;
    }
    setSavingCoachOperation(true);
    setError("");
    try {
      const response = await api.post("/api/mi-agent/coach/operations", {
        sessionId: null,
        originalIntent: "Preparar actividad desde Cliente existente",
        context: {
          accountId: Number(customerAccountId || 0) || null,
          opportunityId,
        },
        operation: {
          kind: "activity",
          sourceChannel: "coach",
          calendarKind: "opportunity",
          accountId: Number(customerAccountId || 0) || null,
          title: nextStep.title || "Seguimiento comercial",
          evidence: Array.isArray(nextStep.evidence) ? nextStep.evidence : [],
          missingFields: [],
          requiresConfirmation: true,
          opportunityId,
          activityId: null,
          actionType: normalizeCommercialActivityType(
            nextStep.actionType || "call",
          ),
          status: "pending",
          priority: nextStep.priority || "medium",
          scheduledAt: nextStep.scheduledAt || null,
          dueDate: nextStep.dueDate || null,
          notes:
            nextStep.notes || "Preparada desde Cliente existente en Mi Coach.",
          successCriteria:
            nextStep.successCriteria || "Obtener siguiente paso confirmado.",
        },
      });
      const persistedOperation = response.data?.operation;
      const destinationSessionId = Number(
        response.data?.sessionId || persistedOperation?.sessionId || 0,
      );
      if (!persistedOperation?.id || !destinationSessionId) {
        throw new Error(
          "No se pudo persistir la actividad en una sesión nueva del Coach",
        );
      }
      const coachContextForHandoff = {
        accountId: String(customerAccountId || ""),
        opportunityId: String(opportunityId),
        contactId: "",
        leadId: "",
      };
      setCoachContext(coachContextForHandoff);
      coachContextRef.current = coachContextForHandoff;
      setCoachMessages([]);
      setCoachSessionId(destinationSessionId);
      setCoachPendingOperations((current) => [
        persistedOperation,
        ...current.filter((item) => item.id !== persistedOperation.id),
      ]);
      await openCoachOperationConfirmation(
        {
          ...persistedOperation.pendingOperation,
          persistentId: persistedOperation.id,
          persistenceVersion: persistedOperation.version,
          persistenceStatus: persistedOperation.status,
        },
        {
          opportunityOptions: [
            {
              ...customerOpportunity,
              accountName:
                customerSnapshot.account.name || selectedCustomerAccount?.name,
            },
          ],
        },
      );
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible preparar la actividad",
        ),
      );
    } finally {
      setSavingCoachOperation(false);
    }
  }

  function canReviewCustomerOperation(operation) {
    if (!canExecuteCoach) return false;
    if (operation?.kind === "validate_stage") return canCreateActions;
    if (operation?.kind === "reschedule_activity") return canUpdateCalendar && canCreateActions;
    if (operation?.kind === "activity") return canUpdateCalendar;
    if (operation?.kind === "lead_call_outcome") return canUpdateLeads;
    if (operation?.kind === "account_field") return canUpdateAccounts;
    if (operation?.kind === "contact_field") return canUpdateContacts;
    if (operation?.kind === "create_contact") return canCreateContacts;
    if (operation?.kind === "create_opportunity") return canCreateOpportunities;
    if (operation?.kind === "opportunity_note")
      return canCreateActions;
    if (operation?.kind === "link_contact_to_opportunity")
      return (
        canCreateActions &&
        Boolean(customerSnapshot?.permissions?.canReadContacts)
      );
    if (["stage_answer", "opportunity_field"].includes(operation?.kind))
      return canCreateActions;
    return false;
  }

  async function openCustomerChatOperation(operation) {
    if (!operation || !canReviewCustomerOperation(operation)) return;
    setSavingCoachOperation(true);
    setError("");
    setCustomerIntelligenceError("");
    try {
      const accountId = Number(customerAccountId || 0) || null;
      const opportunityId = Number(operation.opportunityId || 0) || null;
      const contactId = Number(operation.contactId || 0) || null;
      const opportunityOptions = [
        ...(customerSnapshot?.opportunities || []),
        ...(customerSnapshot?.inactiveOpportunities || []),
        ...(customerSnapshot?.selectedOpportunity
          ? [customerSnapshot.selectedOpportunity]
          : []),
      ]
        .filter(
          (item) =>
            Number(item.accountId || customerSnapshot?.account?.id) ===
            Number(accountId),
        )
        .map((item) => ({
          ...item,
          accountName: customerSnapshot?.account?.name || "",
        }));
      const coachOperation = {
        ...operation,
        sourceChannel: "coach",
        requiresConfirmation: true,
      };
      const response = operation.persistentId
        ? await api.get(
            `/api/mi-agent/coach/operations/${operation.persistentId}`,
          )
        : await api.post("/api/mi-agent/coach/operations", {
            sessionId: null,
            originChannel: "customer_account",
            originalIntent: `Propuesta desde Cliente existente: ${operation.title || operation.kind}`,
            context: {
              accountId,
              opportunityId,
              contactId,
              leadId: null,
            },
            operation: coachOperation,
          });
      const persistedOperation = response.data?.operation;
      const destinationSessionId = Number(
        response.data?.sessionId || persistedOperation?.sessionId || 0,
      );
      if (!persistedOperation?.id || !destinationSessionId) {
        throw new Error("No se pudo preparar la operación en el Coach");
      }
      const coachContextForHandoff = {
        accountId: String(accountId || ""),
        opportunityId: String(opportunityId || ""),
        contactId: String(contactId || ""),
        leadId: "",
      };
      setCoachContext(coachContextForHandoff);
      coachContextRef.current = coachContextForHandoff;
      setCoachMessages([]);
      setCoachSessionId(destinationSessionId);
      setCoachPendingOperations((current) => [
        persistedOperation,
        ...current.filter((item) => item.id !== persistedOperation.id),
      ]);
      coachChatOriginRef.current = {
        chatSessionId: Number(customerChat.customerChatSessionId || 0) || null,
        signature: operation.signature || null,
      };
      await openCoachOperationConfirmation({
        ...persistedOperation.pendingOperation,
        persistentId: persistedOperation.id,
        persistenceVersion: persistedOperation.version,
        persistenceStatus: persistedOperation.status,
      }, { opportunityOptions, persistedOperation, onReviewError: setCustomerIntelligenceError });
    } catch (requestError) {
      setCustomerIntelligenceError(
        getApiErrorMessage(
          requestError,
          "No fue posible preparar la operación en el Coach",
        ),
      );
    } finally {
      setSavingCoachOperation(false);
    }
  }

  function updateProspectForm(field, value) {
    setProspectForm((current) => ({ ...current, [field]: value }));
    setProspectError("");
  }

  async function loadProspectSessions({
    search = prospectListSearch,
    targetOnly = prospectView === "targets",
    offset = 0,
  } = {}) {
    setProspectListLoading(true);
    setProspectListError("");
    try {
      const response = await api.get("/api/prospect-research/sessions", {
        params: { search, targetOnly, limit: 25, offset },
      });
      setProspectList(
        response.data || { items: [], total: 0, limit: 25, offset },
      );
    } catch (requestError) {
      setProspectListError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar las investigaciones guardadas",
        ),
      );
    } finally {
      setProspectListLoading(false);
    }
  }

  async function openSavedProspect(sessionId) {
    setProspectListLoading(true);
    setProspectListError("");
    try {
      const response = await api.get(
        `/api/prospect-research/sessions/${sessionId}`,
      );
      const session = response.data?.session;
      if (!session) throw new Error("No se encontró la investigación");
      setProspectSession(session);
      setProspectForm({
        companyName: session.companyName || "",
        country: session.country || "",
        website: session.website || "",
        industry: session.industry || "",
      });
      setProspectConvertedAccountId(session.convertedAccountId || null);
      setProspectConvertedLeadId(null);
      setProspectConvertedContacts({});
      setProspectConvertedOpportunities({});
      setProspectContactDrafts({});
      setProspectChatQuestion("");
      setProspectError("");
      setProspectChatMessages(
        (Array.isArray(session.chatHistory) ? session.chatHistory : []).map(
          (message) => ({
            ...message,
            role: message.role === "assistant" ? "assistant" : "seller",
            text: message.text || message.answer || "",
          }),
        ),
      );
      window.sessionStorage.setItem(
        PROSPECT_SESSION_STORAGE_KEY,
        String(session.id),
      );
      setProspectView("new");
    } catch (requestError) {
      setProspectListError(
        getApiErrorMessage(
          requestError,
          "No fue posible abrir la investigación",
        ),
      );
    } finally {
      setProspectListLoading(false);
    }
  }

  async function updateProspectTarget(session) {
    if (!session?.id) return;
    setProspectTargetUpdatingId(Number(session.id));
    setProspectListError("");
    setProspectError("");
    try {
      const response = await api.patch(
        `/api/prospect-research/sessions/${session.id}/target`,
        { isTarget: !session.isTarget },
      );
      const isTarget = Boolean(response.data?.isTarget);
      setProspectSession((current) =>
        current && Number(current.id) === Number(session.id)
          ? { ...current, isTarget, targetAddedAt: response.data.targetAddedAt }
          : current,
      );
      await loadProspectSessions({ targetOnly: prospectView === "targets" });
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible actualizar Cuentas objetivo",
      );
      if (prospectView === "new") setProspectError(message);
      else setProspectListError(message);
    } finally {
      setProspectTargetUpdatingId(null);
    }
  }

  async function deleteSavedProspect(session) {
    if (!session?.id) return;
    const duplicateNote =
      session.duplicateCount > 1
        ? ` También se archivarán sus ${session.duplicateCount - 1} ficha(s) duplicada(s).`
        : "";
    const confirmed = window.confirm(
      `¿Eliminar la investigación guardada de ${session.companyName}?${duplicateNote} La cuenta CRM, si existe, no se eliminará.`,
    );
    if (!confirmed) return;
    setProspectListLoading(true);
    setProspectListError("");
    try {
      await api.delete(`/api/prospect-research/sessions/${session.id}`);
      if (Number(prospectSession?.id) === Number(session.id)) {
        setProspectSession(null);
        setProspectChatMessages([]);
        setProspectChatQuestion("");
        setProspectConvertedAccountId(null);
        setProspectConvertedLeadId(null);
        setProspectConvertedContacts({});
        setProspectConvertedOpportunities({});
        setProspectContactDrafts({});
        window.sessionStorage.removeItem(PROSPECT_SESSION_STORAGE_KEY);
      }
      await loadProspectSessions({ targetOnly: prospectView === "targets" });
    } catch (requestError) {
      setProspectListError(
        getApiErrorMessage(
          requestError,
          "No fue posible eliminar la investigación guardada",
        ),
      );
    } finally {
      setProspectListLoading(false);
    }
  }

  async function startProspectResearch() {
    const companyName = prospectForm.companyName.trim();
    const country = prospectForm.country.trim();
    if (!companyName || !country) {
      setProspectError("Captura empresa y país para iniciar la investigación.");
      return;
    }
    setProspectPreparing(true);
    setProspectError("");
    setCoachNotice("");
    try {
      const createResponse = await api.post("/api/prospect-research/sessions", {
        companyName,
        country,
        website: prospectForm.website.trim(),
        industry: prospectForm.industry.trim(),
      });
      const sessionId = Number(createResponse.data?.session?.id || 0);
      if (!sessionId)
        throw new Error("No se pudo crear la sesión de prospección");
      setProspectSession(createResponse.data.session);
      setProspectChatMessages([]);
      window.sessionStorage.setItem(
        PROSPECT_SESSION_STORAGE_KEY,
        String(sessionId),
      );
      setProspectConvertedAccountId(null);
      setProspectConvertedLeadId(null);
      setProspectConvertedContacts({});
      setProspectConvertedOpportunities({});
      setProspectContactDrafts({});
      await runProspectExternalResearch(sessionId);
    } catch (requestError) {
      setProspectError(
        getApiErrorMessage(
          requestError,
          "No fue posible iniciar la investigación pública",
        ),
      );
    } finally {
      setProspectPreparing(false);
    }
  }

  async function askProspectChat(question = prospectChatQuestion) {
    const normalizedQuestion = String(question || "").trim();
    if (!normalizedQuestion || !prospectSession?.id) return;
    const sessionId = Number(prospectSession.id);
    setProspectChatLoading(true);
    setProspectError("");
    setProspectChatMessages((current) => [
      ...current,
      { role: "seller", text: normalizedQuestion },
    ]);
    setProspectChatQuestion("");
    try {
      const response = await api.post(
        `/api/prospect-research/sessions/${sessionId}/chat/jobs`,
        { question: normalizedQuestion },
      );
      const jobId = Number(response.data?.job?.id || 0);
      if (!jobId) throw new Error("No se pudo iniciar el turno de chat");

      let completedJob = null;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const jobResponse = await api.get(
          `/api/prospect-research/sessions/${sessionId}/chat/jobs/${jobId}`,
        );
        const job = jobResponse.data?.job;
        if (job?.status === "completed") {
          completedJob = job;
          break;
        }
        if (job?.status === "failed") {
          throw new Error(
            job.errorMessage || "No fue posible responder sobre el prospecto",
          );
        }
        await new Promise((resolve) => window.setTimeout(resolve, 600));
      }
      if (!completedJob?.result) {
        throw new Error("La respuesta tardó demasiado; inténtalo de nuevo");
      }
      const assistantMessage = {
        role: "assistant",
        ...completedJob.result,
        text: completedJob.result.text || completedJob.result.answer || "",
      };
      setProspectChatMessages((current) => [...current, assistantMessage]);
      setProspectSession((current) =>
        current
          ? {
              ...current,
              chatHistory: [
                ...(Array.isArray(current.chatHistory)
                  ? current.chatHistory
                  : []),
                { role: "user", text: normalizedQuestion },
                assistantMessage,
              ].slice(-16),
            }
          : current,
      );
    } catch (requestError) {
      setProspectError(
        getApiErrorMessage(
          requestError,
          "No fue posible responder sobre el prospecto",
        ),
      );
    } finally {
      setProspectChatLoading(false);
    }
  }

  async function runProspectExternalResearch(sessionId = prospectSession?.id) {
    if (!sessionId) return;
    setProspectExternalResearching(true);
    setProspectError("");
    try {
      const startPath = `/api/prospect-research/sessions/${sessionId}/run-external`;
      let startResponse;
      let lastStartError;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          startResponse = await api.post(startPath, {});
          break;
        } catch (requestError) {
          lastStartError = requestError;
          const isTransient = [
            "ECONNABORTED",
            "ETIMEDOUT",
            "ERR_NETWORK",
          ].includes(requestError?.code);
          if (!isTransient || attempt === 2) throw requestError;
        }
      }
      if (!startResponse) throw lastStartError;
      const runId = Number(startResponse.data?.job?.id || 0);
      if (!runId) throw new Error("No se pudo iniciar la investigación");

      let completedJob = null;
      let transientPollFailures = 0;
      for (let attempt = 0; attempt < 240; attempt += 1) {
        try {
          const statusResponse = await api.get(
            `/api/prospect-research/sessions/${sessionId}/run-external/${runId}`,
          );
          const job = statusResponse.data?.job;
          transientPollFailures = 0;
          if (job?.status === "completed" || job?.status === "failed") {
            completedJob = job;
            break;
          }
          await new Promise((resolve) =>
            window.setTimeout(resolve, Number(job?.pollAfterMs || 700)),
          );
        } catch (requestError) {
          const isTransient = [
            "ECONNABORTED",
            "ETIMEDOUT",
            "ERR_NETWORK",
          ].includes(requestError?.code);
          if (!isTransient || transientPollFailures >= 3) throw requestError;
          transientPollFailures += 1;
          await new Promise((resolve) =>
            window.setTimeout(resolve, 700 * transientPollFailures),
          );
        }
      }
      if (!completedJob) {
        const latestSession = await api.get(
          `/api/prospect-research/sessions/${sessionId}`,
        );
        setProspectSession(latestSession.data?.session || prospectSession);
        setCoachNotice(
          "La consulta sigue activa. La ficha queda guardada; pulsa Actualizar investigación para recuperar su estado.",
        );
        return;
      }
      if (completedJob.status === "failed") {
        throw new Error(
          completedJob.warnings?.join(" ") ||
            "No fue posible completar la investigación pública",
        );
      }
      setProspectSession(completedJob.session || prospectSession);
      const externalResearch = completedJob.session?.result?.externalResearch;
      const hasFindings = Number(externalResearch?.findingCount || 0) > 0;
      setCoachNotice(
        hasFindings
          ? "Investigación pública actualizada con fuentes verificables."
          : "La investigación terminó sin hallazgos públicos verificables.",
      );
    } catch (requestError) {
      setProspectError(
        getApiErrorMessage(
          requestError,
          "No fue posible investigar fuentes públicas",
        ),
      );
    } finally {
      setProspectExternalResearching(false);
    }
  }

  async function updateProspectFindingStatus(finding, status) {
    const action = status === "confirmed" ? "confirm" : "reject";
    setProspectFindingUpdatingId(finding.id);
    setProspectError("");
    try {
      const response = await api.post(
        `/api/prospect-research/findings/${finding.id}/${action}`,
        {},
      );
      const updatedFinding = response.data?.finding;
      if (updatedFinding) {
        setProspectSession((current) =>
          current
            ? {
                ...current,
                findings: (Array.isArray(current.findings)
                  ? current.findings
                  : []
                ).map((item) =>
                  Number(item.id) === Number(updatedFinding.id)
                    ? updatedFinding
                    : item,
                ),
              }
            : current,
        );
      }
    } catch (requestError) {
      setProspectError(
        getApiErrorMessage(
          requestError,
          "No fue posible actualizar el hallazgo",
        ),
      );
    } finally {
      setProspectFindingUpdatingId(null);
    }
  }

  async function convertProspectAccount() {
    if (!prospectSession?.id) return false;
    setProspectConverting("account");
    setProspectError("");
    try {
      const response = await api.post(
        `/api/prospect-research/sessions/${prospectSession.id}/convert-to-account`,
        {},
      );
      const accountId = Number(response.data?.accountId || 0);
      if (!accountId) throw new Error("No se pudo crear la cuenta");
      setProspectConvertedAccountId(accountId);
      setProspectSession((current) =>
        current ? { ...current, convertedAccountId: accountId } : current,
      );
      setCoachNotice("Cuenta creada desde la prospección.");
      setProspectConversionConfirmation("");
      return true;
    } catch (requestError) {
      const duplicateCandidates =
        requestError.response?.data?.duplicateCandidates;
      if (Array.isArray(duplicateCandidates) && duplicateCandidates.length) {
        setProspectSession((current) =>
          current
            ? {
                ...current,
                duplicateReview: {
                  ...current.duplicateReview,
                  completed: true,
                  candidates: duplicateCandidates,
                },
              }
            : current,
        );
        setProspectConversionConfirmation("");
      }
      setProspectError(
        getApiErrorMessage(requestError, "No fue posible crear la cuenta"),
      );
      return false;
    } finally {
      setProspectConverting("");
    }
  }

  async function updateProspectHypothesisStatus(hypothesis, status) {
    setProspectConverting(`hypothesis-${hypothesis.id}`);
    setProspectError("");
    try {
      const response = await api.post(
        `/api/prospect-research/hypotheses/${hypothesis.id}/${status === "confirmed" ? "confirm" : "reject"}`,
        {},
      );
      const updatedHypothesis = response.data?.hypothesis;
      if (updatedHypothesis) {
        setProspectSession((current) =>
          current
            ? {
                ...current,
                hypotheses: (current.hypotheses || []).map((item) =>
                  Number(item.id) === Number(updatedHypothesis.id)
                    ? updatedHypothesis
                    : item,
                ),
              }
            : current,
        );
      }
    } catch (requestError) {
      setProspectError(
        getApiErrorMessage(requestError, "No fue posible validar la hipótesis"),
      );
    } finally {
      setProspectConverting("");
    }
  }

  async function convertProspectLead() {
    if (!prospectSession?.id) return false;
    setProspectConverting("lead");
    setProspectError("");
    try {
      const response = await api.post(
        `/api/prospect-research/sessions/${prospectSession.id}/convert-to-lead`,
        {
          accountId:
            prospectConvertedAccountId ||
            prospectSession.convertedAccountId ||
            null,
        },
      );
      const interactionId = Number(response.data?.interactionId || 0);
      if (!interactionId) throw new Error("No se pudo crear el lead");
      setProspectConvertedLeadId(interactionId);
      setCoachNotice("Lead creado desde la prospección.");
      setProspectConversionConfirmation("");
      return true;
    } catch (requestError) {
      setProspectError(
        getApiErrorMessage(requestError, "No fue posible crear el lead"),
      );
      return false;
    } finally {
      setProspectConverting("");
    }
  }

  async function confirmProspectConversion() {
    if (prospectConversionConfirmation === "account") {
      await convertProspectAccount();
    } else if (prospectConversionConfirmation === "lead") {
      await convertProspectLead();
    }
  }

  function updateProspectContactDraft(contactId, field, value) {
    setProspectContactDrafts((current) => ({
      ...current,
      [contactId]: { ...(current[contactId] || {}), [field]: value },
    }));
  }

  async function convertProspectContact(contact) {
    const accountId =
      prospectConvertedAccountId || prospectSession?.convertedAccountId || null;
    if (!accountId) {
      setProspectError(
        "Primero crea o vincula la cuenta antes de crear contactos.",
      );
      return;
    }
    const draft = prospectContactDrafts[contact.id] || {};
    const contactName = String(draft.contactName || contact.name || "").trim();
    if (!contactName) {
      setProspectError(
        "Captura el nombre real del contacto sugerido antes de crearlo.",
      );
      return;
    }
    setProspectConverting(`contact-${contact.id}`);
    setProspectError("");
    try {
      const response = await api.post(
        `/api/prospect-research/contacts/${contact.id}/convert`,
        {
          accountId,
          contactName,
          email: draft.email || "",
        },
      );
      const contactId = Number(response.data?.contactId || 0);
      if (!contactId) throw new Error("No se pudo crear el contacto");
      setProspectConvertedContacts((current) => ({
        ...current,
        [contact.id]: contactId,
      }));
      setCoachNotice("Contacto creado desde la prospección.");
    } catch (requestError) {
      setProspectError(
        getApiErrorMessage(requestError, "No fue posible crear el contacto"),
      );
    } finally {
      setProspectConverting("");
    }
  }

  async function convertProspectOpportunity(hypothesis) {
    const accountId =
      prospectConvertedAccountId || prospectSession?.convertedAccountId || null;
    const firstContactId = Number(
      Object.values(prospectConvertedContacts)[0] || 0,
    );
    if (!accountId || !firstContactId) {
      setProspectError(
        "Crea la cuenta y al menos un contacto antes de crear una oportunidad preliminar.",
      );
      return;
    }
    setProspectConverting(`opportunity-${hypothesis.id}`);
    setProspectError("");
    try {
      const response = await api.post(
        `/api/prospect-research/hypotheses/${hypothesis.id}/convert-to-opportunity`,
        {
          accountId,
          contactId: firstContactId,
          amountUsd: 0,
        },
      );
      const opportunityId = Number(response.data?.opportunityId || 0);
      if (!opportunityId) throw new Error("No se pudo crear la oportunidad");
      setProspectConvertedOpportunities((current) => ({
        ...current,
        [hypothesis.id]: opportunityId,
      }));
      setCoachNotice("Oportunidad preliminar creada desde la prospección.");
    } catch (requestError) {
      setProspectError(
        getApiErrorMessage(requestError, "No fue posible crear la oportunidad"),
      );
    } finally {
      setProspectConverting("");
    }
  }

  async function askCoach(
    question = coachQuestion,
    contextOverride = coachContext,
    sessionIdOverride = coachSessionId,
  ) {
    const normalizedQuestion = String(question || "").trim();
    if (!normalizedQuestion) return;
    const requestContext = { ...contextOverride };
    const contextKey = JSON.stringify(requestContext);
    const contextRevision = coachContextRevisionRef.current;
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
      const conversationHistory = coachMessages
        .filter((message) => !message.pending)
        .slice(-8)
        .map((message) => ({
          role: message.role === "coach" ? "coach" : "seller",
          text:
            message.role === "coach"
              ? message.result?.answer || message.error || ""
              : message.text || "",
        }))
        .filter((message) => message.text);
      const { data: queued } = await api.post("/api/mi-agent/coach", {
        question: normalizedQuestion,
        history: conversationHistory,
        sessionId: sessionIdOverride,
        context: {
          accountId: Number(requestContext.accountId || 0) || null,
          opportunityId: Number(requestContext.opportunityId || 0) || null,
          contactId: Number(requestContext.contactId || 0) || null,
          leadId: Number(requestContext.leadId || 0) || null,
        },
      });
      if (contextRevision !== coachContextRevisionRef.current) return;
      if (queued?.sessionId) setCoachSessionId(Number(queued.sessionId));
      const jobId = Number(queued?.job?.id || 0);
      if (!jobId) throw new Error("No se pudo iniciar la consulta al Coach");
      const deadline = Date.now() + COACH_POLL_TIMEOUT_MS;
      for (;;) {
        if (Date.now() >= deadline) {
          throw new Error(
            "El Coach está tardando más de lo esperado. Puedes intentarlo nuevamente.",
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (contextRevision !== coachContextRevisionRef.current) return;
        const { data } = await api.get(`/api/mi-agent/coach/jobs/${jobId}`);
        if (data?.job?.status === "completed") {
          if (
            contextRevision !== coachContextRevisionRef.current ||
            JSON.stringify(coachContextRef.current) !== contextKey
          ) {
            throw new Error(
              "El contexto cambio mientras se analizaba la pregunta. Vuelve a intentarlo.",
            );
          }
          const activeContext = data.result?.activeContext;
          if (activeContext)
            await applyCoachActiveContext(activeContext, contextRevision);
          const persistedOperations = (data.result?.operations || [])
            .filter((operation) => operation.persistentId)
            .map((operation) => ({
              id: operation.persistentId,
              sessionId: Number(queued.sessionId || coachSessionId || 0),
              kind: operation.kind,
              status: operation.persistenceStatus || "ready",
              version: operation.persistenceVersion || 1,
              originalIntent: normalizedQuestion,
              missingFields: operation.missingFields || [],
              evidence: operation.evidence || [],
              targetModule: operation.targetModule || null,
              pendingOperation: operation,
            }));
          if (persistedOperations.length) {
            setCoachPendingOperations((current) => {
              const incomingIds = new Set(
                persistedOperations.map((operation) => operation.id),
              );
              return [
                ...persistedOperations,
                ...current.filter(
                  (operation) => !incomingIds.has(operation.id),
                ),
              ];
            });
          }
          setCoachMessages((current) =>
            current.map((message) =>
              message.id === `${messageId}-pending`
                ? { ...message, pending: false, result: data.result }
                : message,
            ),
          );
          break;
        }
        if (data?.job?.status === "failed")
          throw new Error(
            data.job.errorMessage || "No fue posible responder la pregunta",
          );
      }
    } catch (requestError) {
      setCoachMessages((current) =>
        current.map((message) =>
          message.id === `${messageId}-pending`
            ? {
                ...message,
                pending: false,
                error: getApiErrorMessage(
                  requestError,
                  "No fue posible responder la pregunta",
                ),
              }
            : message,
        ),
      );
      setError(
        getApiErrorMessage(requestError, "No fue posible consultar al Coach"),
      );
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
          setTimeout(
            resolve,
            Math.max(500, Number(queued?.job?.pollAfterMs || 1000)),
          );
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
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible analizar tu situación comercial",
        ),
      );
    } finally {
      setAnalyzing(false);
    }
  }

  async function loadCoachGovernance() {
    setCoachGovernanceLoading(true);
    setError("");
    try {
      const [
        response,
        rulesResponse,
        businessRulesResponse,
        intentsResponse,
        channelIntentsResponse,
        plannerPromptsResponse,
      ] = await Promise.all([
        api.get("/api/commercial-intelligence/governance"),
        api.get(
          "/api/commercial-intelligence/governance/rules?channel=all&process=default",
        ),
        api.get(
          "/api/commercial-intelligence/governance/business-rules?channel=coach&process=default",
        ),
        api.get("/api/commercial-intelligence/governance/intents"),
        channelIntentChannel === "coach"
          ? Promise.resolve({ data: {} })
          : api
              .get(
                `/api/commercial-intelligence/governance/channel-intents/${channelIntentChannel}`,
              )
              .catch((requestError) => ({
                data: { loadError: requestError },
              })),
        api.get("/api/mi-agent/coach/admin/planner-prompts"),
      ]);
      setPlannerPrompts(
        (plannerPromptsResponse.data?.prompts || []).map((prompt) => ({
          ...prompt,
          draft: prompt.instruction,
        })),
      );
      setPlannerPromptNotice("");
      setCoachGovernance(response.data || null);
      setCoachBusinessRulesDraft(
        JSON.stringify(
          businessRulesResponse.data?.businessRules || {},
          null,
          2,
        ),
      );
      setCoachBusinessRulesSource(
        businessRulesResponse.data?.configurationSource || null,
      );
      setCoachAdminRules(rulesResponse.data?.rules || []);
      const intentCatalog = intentsResponse.data?.catalog || [];
      setCoachIntentCatalog(intentCatalog);
      setCoachIntentRevisions(intentsResponse.data?.revisions || []);
      setCoachIntentCode((current) =>
        intentCatalog.some((item) => item.code === current)
          ? current
          : intentCatalog[0]?.code || "",
      );
      setCoachIntentExamplesDraft(
        (current) => current || (intentCatalog[0]?.examples || []).join("\n"),
      );
      const channelCatalog = channelIntentsResponse.data?.catalog || [];
      setChannelIntentCatalog(channelCatalog);
      setChannelIntentRevisions(channelIntentsResponse.data?.revisions || []);
      if (channelIntentsResponse.data?.loadError) {
        setChannelIntentFeedback({
          kind: "error",
          message: getApiErrorMessage(
            channelIntentsResponse.data.loadError,
            "No fue posible cargar la configuración del canal.",
          ),
        });
      }
      const initialChannelIntent = channelCatalog[0];
      setChannelIntentCode(initialChannelIntent?.code || "");
      setChannelIntentDraft(
        initialChannelIntent
          ? {
              enabled: initialChannelIntent.enabled,
              examples: initialChannelIntent.examples.join("\n"),
              priority: initialChannelIntent.priority,
              allowedTools: [...initialChannelIntent.allowedTools],
              requiredContext: [...initialChannelIntent.requiredContext],
            }
          : null,
      );
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar gobierno de Mi Coach",
        ),
      );
    } finally {
      setCoachGovernanceLoading(false);
      if (canManageCoach) {
        void loadCoachQualitySummary();
      }
    }
  }

  async function loadCoachQualitySummary(
    nextFilters = coachDecisionTraceFilters,
  ) {
    if (!canManageCoach) return;
    setCoachQualityLoading(true);
    setCoachDecisionTraceLoading(true);
    try {
      const [qualityResponse, decisionsResponse] = await Promise.all([
        api.get("/api/mi-agent/coach/quality", {
          params: { periodDays: 30 },
        }),
        api.get("/api/mi-agent/coach/quality/decisions", {
          params: {
            channel: nextFilters.channel || "coach",
            limit: nextFilters.limit || 8,
            reviewStatus: nextFilters.reviewStatus || "all",
          },
        }),
      ]);
      setCoachQualitySummary(qualityResponse.data?.quality || null);
      setCoachDecisionTraces(decisionsResponse.data?.traces || []);
      setCoachDecisionTraceDetail((current) => {
        if (!current) return null;
        const nextSelected = (decisionsResponse.data?.traces || []).find(
          (trace) => trace.id === current.id,
        );
        return nextSelected || null;
      });
    } catch (requestError) {
      setCoachQualitySummary(null);
      setCoachDecisionTraces([]);
    } finally {
      setCoachQualityLoading(false);
      setCoachDecisionTraceLoading(false);
    }
  }

  async function reviewCoachDecisionTrace(traceId, status, note = "") {
    if (!traceId || !canManageCoach) return;
    setCoachDecisionReviewSaving(true);
    try {
      await api.post(
        `/api/mi-agent/coach/quality/decisions/${traceId}/review`,
        {
          status,
          note,
        },
      );
      await loadCoachQualitySummary();
      setCoachDecisionTraceDetail((current) =>
        current && current.id === traceId ? null : current,
      );
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No se pudo guardar la revisión de la trazabilidad",
        ),
      );
    } finally {
      setCoachDecisionReviewSaving(false);
    }
  }

  async function loadCustomerChatDiagnostics({
    page = chatDiagnosticsPage,
    query = chatDiagnosticsQuery,
    status = chatDiagnosticsStatus,
    reviewStatus = chatDiagnosticsReviewStatus,
    accountId = chatDiagnosticsAccountId,
    dateFrom = chatDiagnosticsDateFrom,
    dateTo = chatDiagnosticsDateTo,
  } = {}) {
    if (!canDiagnoseCustomerChats) return;
    setChatDiagnosticsLoading(true);
    setChatDiagnosticsError("");
    try {
      const response = await api.get(
        "/api/commercial-intelligence/account-chat/diagnostics/sessions",
        {
          params: {
            page,
            pageSize: 10,
            query,
            status,
            reviewStatus,
            accountId: accountId || undefined,
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
          },
        },
      );
      setChatDiagnosticsResult(response.data || null);
    } catch (requestError) {
      setChatDiagnosticsError(
        getApiErrorMessage(
          requestError,
          "No fue posible consultar las sesiones de chat",
        ),
      );
    } finally {
      setChatDiagnosticsLoading(false);
    }
  }

  async function openCustomerChatDiagnostic({ sessionId, jobId }) {
    if (!canDiagnoseCustomerChats) return;
    setChatDiagnosticsLoading(true);
    setChatDiagnosticsError("");
    try {
      const path = jobId
        ? `/api/commercial-intelligence/account-chat/diagnostics/jobs/${jobId}`
        : `/api/commercial-intelligence/account-chat/diagnostics/sessions/${sessionId}`;
      const response = await api.get(path);
      setChatDiagnosticsSelected(response.data?.session || null);
    } catch (requestError) {
      setChatDiagnosticsError(
        getApiErrorMessage(
          requestError,
          "No fue posible abrir el diagnóstico de la sesión",
        ),
      );
      setChatDiagnosticsSelected(null);
    } finally {
      setChatDiagnosticsLoading(false);
    }

  }

  async function closeCustomerDiagnostic(session) {
    setChatDiagnosticsClosingId(session.sessionId);
    setChatDiagnosticsError("");
    try {
      await api.post(
        `/api/commercial-intelligence/account-chat/diagnostics/sessions/${session.sessionId}/close`,
        { latestJobId: session.latestJob?.jobId || 0 },
      );
      const page = chatDiagnosticsReviewStatus === "pending" &&
        chatDiagnosticsResult?.sessions?.length === 1 && chatDiagnosticsPage > 1
        ? chatDiagnosticsPage - 1 : chatDiagnosticsPage;
      setChatDiagnosticsPage(page);
      await loadCustomerChatDiagnostics({ page });
      if (chatDiagnosticsSelected?.id === session.sessionId) {
        await openCustomerChatDiagnostic({ sessionId: session.sessionId });
      }
    } catch (requestError) {
      setChatDiagnosticsError(getApiErrorMessage(requestError, "No fue posible cerrar el diagnóstico"));
    } finally {
      setChatDiagnosticsClosingId(null);
    }
  }

  async function saveCoachGovernance() {
    if (!coachGovernance?.settings) return;
    setCoachGovernanceSaving(true);
    setError("");
    try {
      const response = await api.put(
        "/api/commercial-intelligence/governance/settings",
        coachGovernance.settings,
      );
      setCoachGovernance(response.data || coachGovernance);
      const contextResponse = await api.get("/api/mi-agent/context");
      setDashboard(contextResponse.data);
      if (coachContext.accountId) {
        const opportunitiesResponse = await api.get(
          `/api/opportunities?accountId=${coachContext.accountId}&activeOnly=true&openOnly=true`,
        );
        setCoachOpportunities(
          buildCoachOpportunityOptions(
            opportunitiesResponse.data,
            buildSnapshot(contextResponse.data),
            coachContext.accountId,
          ),
        );
      }

      setCoachNotice("Configuración de gobierno guardada.");
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible guardar gobierno de Mi Coach",
        ),
      );
    } finally {
      setCoachGovernanceSaving(false);
    }
  }

  async function savePlannerPrompt(channel) {
    const prompt = plannerPrompts.find((item) => item.channel === channel);
    if (!prompt || !canManageCoach) return;
    setPlannerPromptSaving(channel);
    setPlannerPromptNotice("");
    setError("");
    try {
      const response = await api.put(
        `/api/mi-agent/coach/admin/planner-prompts/${channel}`,
        { instruction: prompt.draft, expectedVersion: prompt.version },
      );
      const saved = response.data.prompt;
      setPlannerPrompts((current) =>
        current.map((item) =>
          item.channel === channel
            ? {
                ...saved,
                draft: saved.instruction,
                revisions: [
                  {
                    version: saved.version,
                    instruction: saved.instruction,
                    createdByUserId: saved.updatedByUserId,
                    createdAt: saved.updatedAt,
                  },
                  ...(item.revisions || []),
                ],
              }
            : item,
        ),
      );
      setPlannerPromptNotice(
        saved.connected
          ? "Versión guardada. Se aplicará en la próxima planificación de Cliente existente."
          : "Versión guardada. Este canal aún no consume el prompt editable.",
      );
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No se pudo guardar el prompt del planificador",
        ),
      );
    } finally {
      setPlannerPromptSaving("");
    }
  }

  function loadInitialPlannerPrompt(channel) {
    const prompt = plannerPrompts.find((item) => item.channel === channel);
    if (!prompt || !canManageCoach) return;
    if (
      !window.confirm(
        "¿Cargar el prompt inicial? Reemplazará el texto del editor. Pulsa Guardar para activarlo; el historial se conservará.",
      )
    ) return;
    setPlannerPrompts((current) =>
      current.map((item) =>
        item.channel === channel
          ? { ...item, draft: item.initialInstruction }
          : item,
      ),
    );
    setPlannerPromptNotice("Prompt inicial cargado en el editor. Pulsa Guardar para activarlo.");
  }

  async function reloadPlannerPrompts() {
    if (!canManageCoach) return;
    setPlannerPromptSaving("reload");
    setPlannerPromptNotice("");
    setError("");
    try {
      const response = await api.get("/api/mi-agent/coach/admin/planner-prompts");
      setPlannerPrompts(
        response.data.prompts.map((prompt) => ({
          ...prompt,
          draft: prompt.instruction,
        })),
      );
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No se pudieron recargar los prompts del planificador",
        ),
      );
    } finally {
      setPlannerPromptSaving("");
    }
  }

  function updateCoachBusinessRuleField(section, field, value) {
    setCoachBusinessRulesDraft((current) => {
      let rules = {};
      try {
        rules = JSON.parse(current || "{}");
      } catch {
        return current;
      }
      return JSON.stringify(
        {
          ...rules,
          [section]: {
            ...(rules[section] || {}),
            [field]: value,
          },
        },
        null,
        2,
      );
    });
  }

  function updateCoachOperationKind(kind, enabled) {
    let rules = {};
    try {
      rules = JSON.parse(coachBusinessRulesDraft || "{}");
    } catch {
      return;
    }
    const currentKinds = Array.isArray(rules.operationPolicy?.allowedKinds)
      ? rules.operationPolicy.allowedKinds
      : (COACH_OPERATION_OPTIONS[coachBusinessRulesChannel] || []).map(
          ([code]) => code,
        );
    const allowedKinds = enabled
      ? [...new Set([...currentKinds, kind])]
      : currentKinds.filter((currentKind) => currentKind !== kind);
    updateCoachBusinessRuleField(
      "operationPolicy",
      "allowedKinds",
      allowedKinds,
    );
  }

  function updateOpportunityStageSet(settingKey, stageCode, enabled) {
    setCoachGovernance((current) => {
      if (!current?.settings) return current;
      const settings = current.settings;
      const existing = Array.isArray(settings[settingKey])
        ? settings[settingKey]
        : [];
      const next = enabled
        ? [...new Set([...existing, stageCode])]
        : existing.filter((code) => code !== stageCode);
      if (!next.length) return current;
      const nextSettings = { ...settings, [settingKey]: next };
      if (settingKey === "qualifiedOpportunityStageCodes" && !enabled) {
        const remainingCommittedStages = (
          settings.committedOpportunityStageCodes || []
        ).filter((code) => code !== stageCode);
        nextSettings.committedOpportunityStageCodes =
          remainingCommittedStages.length > 0
            ? remainingCommittedStages
            : [next[next.length - 1]];
      }
      return { ...current, settings: nextSettings };
    });
  }

  async function saveCoachBusinessRules() {
    setCoachGovernanceSaving(true);
    setError("");
    try {
      const rules = JSON.parse(coachBusinessRulesDraft || "{}");
      const response = await api.put(
        "/api/commercial-intelligence/governance/business-rules",
        {
          channel: coachBusinessRulesChannel,
          process: getCoachBusinessRulesProcess(
            coachBusinessRulesChannel,
            coachBusinessRulesProcess,
          ),
          rules,
        },
      );
      setCoachBusinessRulesDraft(
        JSON.stringify(response.data?.businessRules || rules, null, 2),
      );
      setCoachBusinessRulesSource(
        response.data?.configurationSource || {
          sourceProcess: getCoachBusinessRulesProcess(
            coachBusinessRulesChannel,
            coachBusinessRulesProcess,
          ),
          hasSavedOverride: true,
          inheritedFromDefault: false,
        },
      );
      setCoachGovernance((current) => ({
        ...current,
        businessRules: response.data?.businessRules || rules,
      }));
      setCoachNotice("Reglas del motor guardadas.");
    } catch (requestError) {
      setError(
        requestError instanceof SyntaxError
          ? "El JSON de reglas no es valido."
          : getApiErrorMessage(
              requestError,
              "No fue posible guardar las reglas del motor",
            ),
      );
    } finally {
      setCoachGovernanceSaving(false);
    }
  }

  async function loadCoachBusinessRulesForScope(
    channel = coachBusinessRulesChannel,
    process = coachBusinessRulesProcess,
  ) {
    process = getCoachBusinessRulesProcess(channel, process);
    setCoachGovernanceSaving(true);
    setError("");
    try {
      const params = new URLSearchParams({
        channel,
        process,
      });
      const response = await api.get(
        `/api/commercial-intelligence/governance/business-rules?${params}`,
      );
      setCoachBusinessRulesDraft(
        JSON.stringify(response.data?.businessRules || {}, null, 2),
      );
      setCoachBusinessRulesSource(response.data?.configurationSource || null);
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar las reglas del motor",
        ),
      );
    } finally {
      setCoachGovernanceSaving(false);
    }
  }

  async function loadCoachAdminRules(
    channel = "all",
    process = coachBusinessRulesProcess,
  ) {
    process = getCoachBusinessRulesProcess(channel, process);
    setCoachGovernanceSaving(true);
    setError("");
    try {
      const params = new URLSearchParams({ channel, process });
      const response = await api.get(
        `/api/commercial-intelligence/governance/rules?${params}`,
      );
      setCoachAdminRules(response.data?.rules || []);
    } catch (requestError) {
      setError(
        getApiErrorMessage(requestError, "No fue posible cargar las reglas"),
      );
    } finally {
      setCoachGovernanceSaving(false);
    }
  }

  function startCoachAdminRuleCreate(scope) {
    setCoachAdminRuleEditingId(null);
    setCoachAdminRuleDraft({
      scope,
      channel: scope === "channel" ? coachBusinessRulesChannel : null,
      process:
        scope === "channel"
          ? getCoachBusinessRulesProcess(
              coachBusinessRulesChannel,
              coachBusinessRulesProcess,
            )
          : "default",
      title: "",
      instruction: "",
      enabled: true,
      sortOrder:
        Math.max(
          0,
          ...coachAdminRules.map((rule) => Number(rule.sortOrder || 0)),
        ) + 10,
    });
  }

  function startCoachAdminRuleEdit(rule) {
    setCoachAdminRuleEditingId(rule.id);
    setCoachAdminRuleDraft({ ...rule });
  }

  async function saveCoachAdminRule() {
    if (!coachAdminRuleDraft) return;
    setCoachGovernanceSaving(true);
    setCoachAdminRuleFeedback(null);
    setError("");
    try {
      const payload = {
        title: coachAdminRuleDraft.title.trim(),
        instruction: coachAdminRuleDraft.instruction.trim(),
        enabled: Boolean(coachAdminRuleDraft.enabled),
        sortOrder: Number(coachAdminRuleDraft.sortOrder || 0),
      };
      if (coachAdminRuleEditingId) {
        await api.put(
          `/api/commercial-intelligence/governance/rules/${coachAdminRuleEditingId}`,
          payload,
        );
      } else {
        const response = await api.post(
          "/api/commercial-intelligence/governance/rules",
          {
            ...payload,
            scope: coachAdminRuleDraft.scope,
            process: coachAdminRuleDraft.process,
            ...(coachAdminRuleDraft.scope === "channel"
              ? { channel: coachAdminRuleDraft.channel }
              : {}),
          },
        );
        const createdRule = response.data?.rule;
        if (createdRule?.id) {
          setCoachAdminRules((current) =>
            current.some((rule) => rule.id === createdRule.id)
              ? current
              : [...current, createdRule],
          );
        }
      }
      setCoachAdminRuleDraft(null);
      setCoachAdminRuleEditingId(null);
      await loadCoachAdminRules("all", coachBusinessRulesProcess);
      const savedTitle = payload.title;
      setCoachAdminRuleFeedback({
        kind: "success",
        message: `La regla “${savedTitle}” se guardó correctamente y ya aparece en la lista.`,
      });
      setCoachNotice("Regla guardada correctamente.");
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible guardar la regla.",
      );
      setCoachAdminRuleFeedback({ kind: "error", message });
      setError(message);
    } finally {
      setCoachGovernanceSaving(false);
    }
  }

  async function toggleCoachAdminRule(rule) {
    setCoachGovernanceSaving(true);
    setCoachAdminRuleFeedback(null);
    setError("");
    try {
      await api.put(
        `/api/commercial-intelligence/governance/rules/${rule.id}`,
        {
          title: rule.title,
          instruction: rule.instruction,
          enabled: !rule.enabled,
          sortOrder: rule.sortOrder,
        },
      );
      await loadCoachAdminRules();
      setCoachAdminRuleFeedback({
        kind: "success",
        message: `La regla “${rule.title}” se actualizó correctamente.`,
      });
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible actualizar la regla.",
      );
      setCoachAdminRuleFeedback({ kind: "error", message });
      setError(message);
    } finally {
      setCoachGovernanceSaving(false);
    }
  }

  async function deleteCoachAdminRule(rule) {
    if (!window.confirm(`¿Eliminar la regla “${rule.title}”?`)) return;
    setCoachGovernanceSaving(true);
    setCoachAdminRuleFeedback(null);
    setError("");
    try {
      await api.delete(
        `/api/commercial-intelligence/governance/rules/${rule.id}`,
      );
      setCoachAdminRules((current) =>
        current.filter((item) => item.id !== rule.id),
      );
      if (coachAdminRuleEditingId === rule.id) {
        setCoachAdminRuleDraft(null);
        setCoachAdminRuleEditingId(null);
      }
      setCoachNotice("Regla eliminada.");
      setCoachAdminRuleFeedback({
        kind: "success",
        message: `La regla “${rule.title}” se eliminó correctamente.`,
      });
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible eliminar la regla.",
      );
      setCoachAdminRuleFeedback({ kind: "error", message });
      setError(message);
    } finally {
      setCoachGovernanceSaving(false);
    }
  }

  function selectCoachIntent(intent) {
    setCoachIntentCode(intent.code);
    setCoachIntentExamplesDraft((intent.examples || []).join("\n"));
    setCoachIntentPreview(null);
    setCoachIntentFeedback(null);
  }

  async function saveCoachIntentExamples() {
    const examples = coachIntentExamplesDraft
      .split("\n")
      .map((example) => example.trim())
      .filter(Boolean);
    setCoachGovernanceSaving(true);
    setCoachIntentFeedback(null);
    setError("");
    try {
      const response = await api.put(
        `/api/commercial-intelligence/governance/intents/${coachIntentCode}/examples`,
        { examples },
      );
      setCoachIntentCatalog(response.data?.catalog || []);
      setCoachIntentRevisions(
        (
          await api.get(
            "/api/commercial-intelligence/governance/intents/revisions",
          )
        ).data?.revisions || [],
      );
      setCoachIntentFeedback({
        kind: "success",
        message: "Los ejemplos se guardaron y quedaron auditados.",
      });
      setCoachNotice("Ejemplos de enrutamiento guardados.");
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible guardar los ejemplos de intención.",
      );
      setCoachIntentFeedback({ kind: "error", message });
      setError(message);
    } finally {
      setCoachGovernanceSaving(false);
    }
  }

  async function previewCoachIntent() {
    const examples = coachIntentExamplesDraft
      .split("\n")
      .map((example) => example.trim())
      .filter(Boolean);
    setCoachGovernanceSaving(true);
    setCoachIntentFeedback(null);
    setCoachIntentPreview(null);
    setError("");
    try {
      const { data } = await api.post(
        "/api/mi-agent/coach/admin/intents/preview",
        {
          question: coachIntentTestQuestion,
          intentCode: coachIntentCode,
          examples,
        },
      );
      setCoachIntentPreview(data);
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible probar la clasificación.",
      );
      setCoachIntentFeedback({ kind: "error", message });
      setError(message);
    } finally {
      setCoachGovernanceSaving(false);
    }
  }

  async function restoreCoachIntentRevision(revision) {
    if (
      !window.confirm(
        `¿Restaurar la configuración anterior a la revisión ${revision.id}?`,
      )
    ) {
      return;
    }
    setCoachGovernanceSaving(true);
    setCoachIntentFeedback(null);
    setError("");
    try {
      const { data } = await api.post(
        `/api/commercial-intelligence/governance/intents/revisions/${revision.id}/restore`,
      );
      setCoachIntentCatalog(data.catalog || []);
      setCoachIntentRevisions(data.revisions || []);
      const selected = (data.catalog || []).find(
        (item) => item.code === coachIntentCode,
      );
      if (selected) setCoachIntentExamplesDraft(selected.examples.join("\n"));
      setCoachIntentPreview(null);
      setCoachIntentFeedback({
        kind: "success",
        message: `Se restauró la revisión ${revision.id}; la restauración también quedó registrada.`,
      });
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible restaurar la configuración.",
      );
      setCoachIntentFeedback({ kind: "error", message });
      setError(message);
    } finally {
      setCoachGovernanceSaving(false);
    }
  }

  function selectChannelIntent(intent) {
    setChannelIntentCode(intent.code);
    setChannelIntentDraft({
      enabled: intent.enabled,
      examples: intent.examples.join("\n"),
      priority: intent.priority,
      allowedTools: [...intent.allowedTools],
      requiredContext: [...intent.requiredContext],
    });
    setChannelIntentPreview(null);
    setChannelIntentFeedback(null);
  }

  async function loadChannelIntentChannel(channel) {
    setChannelIntentChannel(channel);
    setChannelIntentCatalog([]);
    setChannelIntentRevisions([]);
    setChannelIntentCode("");
    setChannelIntentDraft(null);
    setChannelIntentSaving(true);
    setChannelIntentFeedback(null);
    setChannelIntentPreview(null);
    try {
      const { data } = await api.get(
        `/api/commercial-intelligence/governance/channel-intents/${channel}`,
      );
      const catalog = data?.catalog || [];
      const firstIntent = catalog[0];
      setChannelIntentCatalog(catalog);
      setChannelIntentRevisions(data?.revisions || []);
      setChannelIntentCode(firstIntent?.code || "");
      setChannelIntentDraft(
        firstIntent
          ? {
              enabled: firstIntent.enabled,
              examples: firstIntent.examples.join("\n"),
              priority: firstIntent.priority,
              allowedTools: [...firstIntent.allowedTools],
              requiredContext: [...firstIntent.requiredContext],
            }
          : null,
      );
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible cargar la configuración del canal.",
      );
      setChannelIntentFeedback({ kind: "error", message });
    } finally {
      setChannelIntentSaving(false);
    }
  }

  function selectIntentRoutingChannel(channel) {
    setChannelIntentChannel(channel);
    setChannelIntentFeedback(null);
    setChannelIntentPreview(null);
    if (channel === "coach") {
      setChannelIntentCatalog([]);
      setChannelIntentRevisions([]);
      setChannelIntentCode("");
      setChannelIntentDraft(null);
      return;
    }
    loadChannelIntentChannel(channel);
  }

  async function saveChannelIntentConfiguration() {
    if (!channelIntentDraft || !channelIntentCode) return;
    const configuration = {
      ...channelIntentDraft,
      examples: channelIntentDraft.examples
        .split("\n")
        .map((example) => example.trim())
        .filter(Boolean),
    };
    setChannelIntentSaving(true);
    setChannelIntentFeedback(null);
    try {
      const { data } = await api.put(
        `/api/commercial-intelligence/governance/channel-intents/${channelIntentChannel}/${channelIntentCode}`,
        configuration,
      );
      const catalog = data?.catalog || [];
      setChannelIntentCatalog(catalog);
      setChannelIntentRevisions(data?.revisions || []);
      const savedIntent = catalog.find(
        (intent) => intent.code === channelIntentCode,
      );
      if (savedIntent) selectChannelIntent(savedIntent);
      setChannelIntentFeedback({
        kind: "success",
        message: "La configuración se guardó y quedó auditada.",
      });
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible guardar la configuración del canal.",
      );
      setChannelIntentFeedback({ kind: "error", message });
    } finally {
      setChannelIntentSaving(false);
    }
  }

  async function previewChannelIntentConfiguration() {
    setChannelIntentSaving(true);
    setChannelIntentFeedback(null);
    setChannelIntentPreview(null);
    try {
      const { data } = await api.post(
        "/api/commercial-intelligence/governance/channel-intents/preview",
        {
          channel: channelIntentChannel,
          question: channelIntentTestQuestion,
          intentCode: channelIntentCode,
          configuration: {
            ...channelIntentDraft,
            examples: channelIntentDraft.examples
              .split("\n")
              .map((example) => example.trim())
              .filter(Boolean),
          },
        },
      );
      setChannelIntentPreview(data);
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible probar el enrutamiento.",
      );
      setChannelIntentFeedback({ kind: "error", message });
    } finally {
      setChannelIntentSaving(false);
    }
  }

  async function restoreChannelIntentConfiguration(revision) {
    if (
      !window.confirm(
        `¿Restaurar la configuración del canal a la revisión ${revision.id}?`,
      )
    ) {
      return;
    }
    setChannelIntentSaving(true);
    setChannelIntentFeedback(null);
    try {
      const { data } = await api.post(
        `/api/commercial-intelligence/governance/channel-intents/${channelIntentChannel}/revisions/${revision.id}/restore`,
      );
      const catalog = data?.catalog || [];
      setChannelIntentCatalog(catalog);
      setChannelIntentRevisions(data?.revisions || []);
      const selected = catalog.find(
        (intent) => intent.code === channelIntentCode,
      );
      if (selected) selectChannelIntent(selected);
      setChannelIntentFeedback({
        kind: "success",
        message: `Se restauró la revisión ${revision.id} y la restauración quedó registrada.`,
      });
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible restaurar la configuración del canal.",
      );
      setChannelIntentFeedback({ kind: "error", message });
    } finally {
      setChannelIntentSaving(false);
    }
  }

  function openCoachActionConfirmation(action) {
    if (!canExecuteCoach || !canUpdateCommercialDevelopment || !action?.title)
      return;
    setCoachActionDraft({
      action,
      opportunityId: action.opportunityId || "",
      title: action.title || "",
      actionType: action.actionType || "next_step",
      status: action.status || "pending",
      dueDate: action.suggestedDueDate || "",
      scheduledAt: action.scheduledAt || "",
      priority:
        action.priority === "critical" ? "high" : action.priority || "medium",
      successCriteria: action.successCriteria || action.expectedOutcome || "",
      notes:
        action.notes ||
        action.reason ||
        "Creada desde el Coach Comercial de Mi Agente.",
      contextSnapshot:
        snapshot.pipeline.opportunities.find(
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
      successCriteria:
        activity?.successCriteria ||
        "Definir el siguiente compromiso del cliente.",
    });
  }

  async function applyCoachClarification(candidate, clarification) {
    const entityType = candidate?.entityType;
    if (!entityType) {
      setError(
        "La aclaración del Coach no incluye el tipo de entidad requerido.",
      );
      return;
    }
    if (clarification?.activity && entityType === "opportunity") {
      openClarifiedCoachActivity(candidate, clarification.activity);
      return;
    }
    const nextContext = {
      accountId: String(
        candidate?.accountId || (entityType === "account" ? candidate.id : ""),
      ),
      opportunityId: String(
        candidate?.opportunityId ||
          (entityType === "opportunity" ? candidate.id : ""),
      ),
      contactId: String(
        candidate?.contactId || (entityType === "contact" ? candidate.id : ""),
      ),
      leadId: String(entityType === "lead" ? candidate.id : ""),
    };
    setCoachContext(nextContext);
    coachContextRef.current = nextContext;
    setCoachSessionId(null);
    setCoachActionDraft(null);
    setCoachOperationDraft(null);
    if (entityType === "account") {
      setCoachAccounts((current) =>
        current.some((item) => Number(item.id) === Number(candidate.id))
          ? current
          : [...current, candidate],
      );
    }
    await askCoach(
      clarification?.originalRequest || "Continúa con la solicitud anterior.",
      nextContext,
      null,
    );
  }

  async function createNextStep() {
    const draft = coachActionDraft;
    const action = draft?.action;
    const opportunityId = Number(
      draft?.opportunityId || action?.opportunityId || 0,
    );
    if (!opportunityId || !draft?.title.trim()) return;
    setCreatingActionRank(action.rank);
    setError("");
    try {
      const proposed = await api.post("/api/mi-agent/coach/operations", {
        sessionId: coachSessionId,
        originalIntent: action.reason || action.title,
        context: { opportunityId },
        operation: {
          kind: "activity",
          title: draft.title.trim(),
          opportunityId,
          activityId: null,
          actionType: draft.actionType,
          status: draft.status,
          priority: draft.priority,
          dueDate: draft.dueDate || null,
          scheduledAt: draft.scheduledAt || null,
          successCriteria: draft.successCriteria.trim() || null,
          notes: draft.notes.trim() || null,
          evidence: [],
          missingFields: [],
          requiresConfirmation: true,
        },
      });
      const operation = proposed.data?.operation;
      if (!operation?.id) throw new Error("No se pudo preparar la actividad");
      const response = await api.post(
        `/api/mi-agent/coach/operations/${operation.id}/handoff`,
      );
      if (!response.data?.handoff?.url) {
        throw new Error("No se pudo abrir Desarrollo Comercial");
      }
      if (proposed.data?.sessionId)
        setCoachSessionId(Number(proposed.data.sessionId));
      setCoachActionDraft(null);
      navigate(response.data.handoff.url);
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible crear el próximo paso",
        ),
      );
    } finally {
      setCreatingActionRank(null);
    }
  }

  async function openCoachOperationConfirmation(
    operation,
    { opportunityOptions = null, persistedOperation: suppliedPersistedOperation = null, onReviewError = null } = {},
  ) {
    coachReturnFocusRef.current = document.activeElement;
    const canApplyOperation = !canExecuteCoach
      ? false
      : operation?.kind === "lead_call_outcome"
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
                    : operation?.kind === "link_contact_to_opportunity"
                      ? canCreateActions &&
                        Boolean(customerSnapshot?.permissions?.canReadContacts)
                      : operation?.kind === "reschedule_activity"
                        ? canUpdateCalendar && canCreateActions
                      : operation?.kind === "validate_stage"
                        ? canCreateActions
                      : operation?.kind === "activity"
                        ? canUpdateCalendar
                        : operation?.kind === "create_lead"
                          ? canCreateLeads
                          : operation?.kind === "create_contact_mapping"
                            ? canUpdateContacts
                            : operation?.kind === "create_quotation"
                              ? canCreateQuotations
                              : operation?.kind === "create_proposal"
                                ? canCreateProposals
                                                        : operation?.kind === "opportunity_note"
                                                          ? canCreateActions
                                                        : [
                                      "stage_answer",
                                      "opportunity_field",
                                    ].includes(operation?.kind)
                                  ? canCreateActions
                                  : false;
    if (
      !canApplyOperation ||
      (!(
        operation?.opportunityId ||
        operation?.accountId ||
        operation?.contactId ||
        operation?.interactionId ||
        operation?.quotationVersionId
      ) &&
        ![
          "create_account",
          "create_opportunity",
          "create_quotation",
          "create_proposal",
          "activity",
        ].includes(operation?.kind))
    )
      return;
    setCoachOperationOpportunityOptionsOverride(opportunityOptions);
    const persistedOperation = suppliedPersistedOperation || coachPendingOperations.find(
      (candidate) => candidate.id === Number(operation.persistentId || 0),
    );
    let reviewedOperation = persistedOperation;
    if (
      persistedOperation &&
      !COACH_HANDOFF_OPERATION_KINDS.has(operation?.kind)
    ) {
      setSavingCoachOperation(true);
      try {
        const response = await api.post(
          `/api/mi-agent/coach/operations/${persistedOperation.id}/review`,
          { version: persistedOperation.version },
        );
        reviewedOperation = response.data?.operation || persistedOperation;
        setCoachPendingOperations((current) =>
          current.map((item) =>
            item.id === reviewedOperation.id ? reviewedOperation : item,
          ),
        );
      } catch (requestError) {
        const message = getApiErrorMessage(
          requestError,
          "No fue posible revisar el valor actual",
        );
        setCoachOperationAction({
          id: persistedOperation.id,
          state: "error",
          message,
        });
        if (onReviewError) onReviewError(message);
        return;
      } finally {
        setSavingCoachOperation(false);
      }
    }
    const draft = buildCoachOperationDraft(operation, reviewedOperation);
    draft.idempotencyKey = crypto.randomUUID();
    coachDraftSaveSignatureRef.current = JSON.stringify({
      pendingOperation: serializeCoachOperationDraft(draft),
      missingFields: unresolvedCoachFields(serializeCoachOperationDraft(draft)),
    });
    setCoachOperationDraft(draft);
    setError("");
  }

  async function persistCoachOperationDraft(draft) {
    if (!draft?.persistentId) return draft;
    if (draft.operation.linkDraftId || draft.operation.rescheduleDraftId || draft.operation.outcomeDraftId || draft.operation.stageDraftId) return draft;
    const pendingOperation = serializeCoachOperationDraft(draft);
    const response = await api.patch(
      `/api/mi-agent/coach/operations/${draft.persistentId}`,
      {
        pendingOperation,
        missingFields: unresolvedCoachFields(pendingOperation),
        version: draft.version,
      },
    );
    const persisted = response.data?.operation;
    if (!persisted) return draft;
    setCoachPendingOperations((current) =>
      current.map((item) => (item.id === persisted.id ? persisted : item)),
    );
    return {
      ...draft,
      operation: persisted.pendingOperation,
      version: persisted.version,
      persistenceStatus: persisted.status,
      reviewedAt: persisted.reviewedAt || null,
    };
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
          recommendation:
            type === "error"
              ? "Corrige el problema y vuelve a intentarlo."
              : "La operación fue aplicada correctamente.",
        },
      },
    ]);
  }

  function closeCoachOperationDraft() {
    coachChatOriginRef.current = null;
    setCoachOperationDraft(null);
    setCoachOperationOpportunityOptionsOverride(null);
    window.requestAnimationFrame(() => coachReturnFocusRef.current?.focus());
  }

  async function applyCoachOperation() {
    let draft = coachOperationDraft;
    let operation = draft?.operation;
    const delegatesToModule = COACH_HANDOFF_OPERATION_KINDS.has(
      operation?.kind,
    );
    let handoffTab = null;
    if (
      !delegatesToModule &&
      !(
        draft?.opportunityId ||
        operation?.opportunityId ||
        operation?.accountId ||
        operation?.contactId ||
        operation?.interactionId
      )
    )
      return;
    if (delegatesToModule) {
      handoffTab = window.open("about:blank", "_blank");
      if (!handoffTab) {
        setCoachOperationDraft((current) =>
          current
            ? {
                ...current,
                error:
                  "No fue posible abrir el módulo. Permite las ventanas emergentes de este sitio y vuelve a intentarlo.",
              }
            : current,
        );
        return;
      }
      handoffTab.opener = null;
    }
    setError("");
    setSavingCoachOperation(true);
    try {
      draft = await persistCoachOperationDraft(draft);
      operation = draft?.operation;
      if (delegatesToModule) {
        if (
          operation?.kind === "activity" &&
          unresolvedCoachFields(serializeCoachOperationDraft(draft)).length
        ) {
          throw new Error(
            "Completa el objetivo, fecha/hora y el vínculo del origen seleccionado antes de abrir Calendario.",
          );
        }
        if (!draft?.persistentId)
          throw new Error("La operación no tiene un borrador persistente");
        const response = await api.post(
          `/api/mi-agent/coach/operations/${draft.persistentId}/handoff`,
        );
        const handoff = response.data?.handoff;
        if (!handoff?.url)
          throw new Error("No fue posible preparar el módulo de destino");
        if (response.data?.operation) {
          setCoachPendingOperations((current) =>
            current.map((item) =>
              item.id === response.data.operation.id
                ? response.data.operation
                : item,
            ),
          );
        }
        handoffTab.location.replace(handoff.url);
        handoffTab = null;
        closeCoachOperationDraft();
        return;
      }
      if (!draft.reviewedAt) {
        const reviewResponse = await api.post(
          `/api/mi-agent/coach/operations/${draft.persistentId}/review`,
          { version: draft.version },
        );
        const reviewedOperation = reviewResponse.data?.operation;
        if (!reviewedOperation)
          throw new Error("No fue posible revisar el valor actual");
        setCoachPendingOperations((current) =>
          current.map((item) =>
            item.id === reviewedOperation.id ? reviewedOperation : item,
          ),
        );
        setCoachOperationDraft((current) =>
          current?.persistentId === reviewedOperation.id
            ? {
                ...current,
                operation: {
                  ...reviewedOperation.pendingOperation,
                  missingFields: reviewedOperation.missingFields || [],
                },
                version: reviewedOperation.version,
                persistenceStatus: reviewedOperation.status,
                reviewedAt: reviewedOperation.reviewedAt,
                error: "",
              }
            : current,
        );
        return;
      }
      const response = await api.post(
        `/api/mi-agent/coach/operations/${draft.persistentId}/execute`,
        {
          version: draft.version,
          idempotencyKey: draft.idempotencyKey,
          ...(coachChatOriginRef.current?.chatSessionId ? { chatSessionId: coachChatOriginRef.current.chatSessionId } : {}),
        },
      );
      const completedOperation = response.data?.operation;
      if (completedOperation?.status === "completed" && coachChatOriginRef.current?.signature) {
        customerChat.setCustomerChatOperationOutcome(coachChatOriginRef.current.signature, "confirmed");
      }
      if ((operation.updateDraftId || operation.outcomeDraftId || operation.kind === "opportunity_note") && completedOperation?.status !== "completed") {
        throw new Error("El servidor no confirmó la ejecución del cambio. No se acredita como guardado.");
      }
      if (!operation.successNotice) {
        operation.successNotice =
          operation.kind === "opportunity_field"
            ? "Cambio de la oportunidad guardado correctamente."
            : operation.kind === "stage_answer"
              ? "Respuesta de etapa guardada correctamente."
              : operation.kind === "account_field"
                ? "Cambio de la cuenta guardado correctamente."
                : operation.kind === "contact_field"
                  ? "Cambio del contacto guardado correctamente."
                  : operation.kind === "lead_call_outcome"
                    ? "Resultado del lead guardado correctamente."
                    : operation.kind === "opportunity_note"
                      ? "Nota registrada correctamente en la oportunidad."
                    : "Cambio guardado correctamente en el CRM.";
      }
      if (completedOperation?.id && operation.kind !== "opportunity_note")
        setCoachUndoOperationId(completedOperation.id);
      if (completedOperation) {
        setCoachPendingOperations((current) =>
          current.filter((item) => item.id !== completedOperation.id),
        );
        setCoachRecentOperations((current) =>
          [
            completedOperation,
            ...current.filter((item) => item.id !== completedOperation.id),
          ].slice(0, 6),
        );
      }
      closeCoachOperationDraft();
      setCoachMessages((current) =>
        current
          .filter((message) => message.result?.responseType !== "error")
          .map((message) => {
            if (!Array.isArray(message.result?.operations)) return message;
            const remainingOperations = message.result.operations.filter(
              (candidate) =>
                candidate !== operation &&
                !(
                  candidate.kind === operation.kind &&
                  candidate.opportunityId === operation.opportunityId &&
                  candidate.accountId === operation.accountId &&
                  candidate.contactId === operation.contactId &&
                  candidate.field === operation.field
                ),
            );
            return remainingOperations.length ===
              message.result.operations.length
              ? message
              : {
                  ...message,
                  result: {
                    ...message.result,
                    operations: remainingOperations,
                  },
                };
          }),
      );
      if (operation.successNotice)
        appendCoachOperationMessage(operation.successNotice);
      await loadDashboard();
      if (operation.successNotice) setCoachNotice(operation.successNotice);
    } catch (requestError) {
      handoffTab?.close();
      const responseData = requestError?.response?.data;
      const errorCode = responseData?.code;
      setCoachOperationDraft((current) =>
        current
          ? {
              ...current,
              operation:
                errorCode === "COACH_TARGET_CHANGED" &&
                Object.prototype.hasOwnProperty.call(
                  responseData || {},
                  "currentValue",
                )
                  ? {
                      ...current.operation,
                      currentValue: responseData.currentValue,
                    }
                  : current.operation,
              version: responseData?.operation?.version || current.version,
              persistenceStatus:
                responseData?.operation?.status || current.persistenceStatus,
              reviewedAt:
                errorCode === "COACH_TARGET_CHANGED" ||
                errorCode === "COACH_REVIEW_REQUIRED"
                  ? null
                  : current.reviewedAt,
              error: getApiErrorMessage(
                requestError,
                "No fue posible aplicar el cambio propuesto",
              ),
              duplicateWarnings:
                responseData?.duplicateWarnings ||
                current.duplicateWarnings ||
                [],
              duplicateDecision:
                responseData?.duplicateDecision ||
                current.duplicateDecision ||
                null,
              duplicateReview:
                responseData?.duplicateReview ||
                current.duplicateReview ||
                null,
            }
          : current,
      );
      appendCoachOperationMessage(
        getApiErrorMessage(
          requestError,
          "No fue posible aplicar el cambio propuesto",
        ),
        "error",
      );
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible aplicar el cambio propuesto",
        ),
      );
    } finally {
      setSavingCoachOperation(false);
    }
  }

  async function undoCoachOperation() {
    if (!coachUndoOperationId) return;
    try {
      const response = await api.post(
        `/api/mi-agent/coach/operations/${coachUndoOperationId}/revert`,
      );
      if (response.data?.operation) {
        setCoachRecentOperations((current) =>
          [
            response.data.operation,
            ...current.filter((item) => item.id !== response.data.operation.id),
          ].slice(0, 6),
        );
      }
      setCoachUndoOperationId(null);
      await loadDashboard();
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible revertir el cambio del Coach",
        ),
      );
    }
  }

  async function rejectCoachOperation(operation) {
    const persistentId =
      coachOperationDraft?.persistentId || operation?.persistentId || null;
    if (!persistentId) {
      closeCoachOperationDraft();
      return;
    }
    try {
      const response = await api.post(
        `/api/mi-agent/coach/operations/${persistentId}/reject`,
        {
          reason: "Rechazada por el vendedor",
          ...(coachChatOriginRef.current?.chatSessionId ? { chatSessionId: coachChatOriginRef.current.chatSessionId } : {}),
        },
      );
      if (response.data?.operation && coachChatOriginRef.current?.signature) {
        customerChat.setCustomerChatOperationOutcome(coachChatOriginRef.current.signature, "discarded");
      }
      if (response.data?.operation) {
        setCoachPendingOperations((current) =>
          current.filter((item) => item.id !== response.data.operation.id),
        );
        setCoachRecentOperations((current) =>
          [
            response.data.operation,
            ...current.filter((item) => item.id !== response.data.operation.id),
          ].slice(0, 6),
        );
      }
      closeCoachOperationDraft();
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible rechazar la operación del Coach",
        ),
      );
    }
  }

  async function continueCoachOperation(persistedOperation) {
    const operation = {
      ...persistedOperation.pendingOperation,
      persistentId: persistedOperation.id,
    };
    if (persistedOperation.status !== "handed_off") {
      await openCoachOperationConfirmation(operation);
      return;
    }
    setCoachOperationAction({ id: persistedOperation.id, state: "loading" });
    try {
      const response = await api.post(
        `/api/mi-agent/coach/operations/${persistedOperation.id}/handoff`,
      );
      if (!response.data?.handoff?.url) {
        throw new Error("No fue posible recuperar el módulo de destino");
      }
      navigate(response.data.handoff.url);
    } catch (requestError) {
      setCoachOperationAction({
        id: persistedOperation.id,
        state: "error",
        message: getApiErrorMessage(
          requestError,
          "No fue posible continuar la operación",
        ),
      });
    }
  }

  async function cancelPendingCoachOperation(persistedOperation) {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "¿Quieres descartar esta acción pendiente? La información preparada se perderá.",
      )
    ) {
      return;
    }
    setCoachOperationAction({ id: persistedOperation.id, state: "loading" });
    try {
      const response = await api.post(
        `/api/mi-agent/coach/operations/${persistedOperation.id}/status`,
        {
          status: "cancelled",
          cancellationReason: "Cancelada por el vendedor",
        },
      );
      setCoachPendingOperations((current) =>
        current.filter((item) => item.id !== persistedOperation.id),
      );
      if (response.data?.operation) {
        setCoachRecentOperations((current) =>
          [
            response.data.operation,
            ...current.filter((item) => item.id !== response.data.operation.id),
          ].slice(0, 6),
        );
      }
      setCoachOperationAction({});
    } catch (requestError) {
      setCoachOperationAction({
        id: persistedOperation.id,
        state: "error",
        message: getApiErrorMessage(
          requestError,
          "No fue posible descartar la acción",
        ),
      });
    }
  }

  function rejectCoachAction() {
    setCoachActionDraft(null);
  }

  function updateCoachPayloadField(field, value) {
    setCoachOperationDraft((current) => ({
      ...current,
      payload: { ...(current?.payload || {}), [field]: value },
      value: "",
    }));
  }

  function updateCoachFoundationVisibility(visible) {
    setShowCoachFoundation(visible);
    window.localStorage.setItem(
      COACH_FOUNDATION_VISIBILITY_KEY,
      String(visible),
    );
  }

  const coachDraftSerialized = coachOperationDraft
    ? serializeCoachOperationDraft(coachOperationDraft)
    : null;
  const coachDraftMissingFields = coachDraftSerialized
    ? unresolvedCoachFields(coachDraftSerialized)
    : [];
  const coachDraftMissingSet = new Set(coachDraftMissingFields);
  const hasCoachFoundation = coachMessages.some((message) => {
    const result = message.result;
    return Boolean(
      result?.facts?.length ||
      result?.evidence?.length ||
      result?.inferences?.length ||
      result?.recommendation,
    );
  });
  const hasCoachConversation = Boolean(
    coachSessionId ||
    coachMessages.length ||
    coachRecentOperations.length ||
    coachOperationDraft,
  );
  let selectedCoachBusinessRules = {};
  try {
    selectedCoachBusinessRules = JSON.parse(coachBusinessRulesDraft || "{}");
  } catch {
    selectedCoachBusinessRules = {};
  }
  const coachBusinessRulesSourceLabel =
    coachBusinessRulesSource?.hasSavedOverride &&
    coachBusinessRulesSource?.sourceProcess ===
      getCoachBusinessRulesProcess(
        coachBusinessRulesChannel,
        coachBusinessRulesProcess,
      )
      ? coachBusinessRulesChannel === "customer_account"
        ? "Hay una configuración guardada para toda la conversación de cliente existente."
        : coachBusinessRulesChannel === "prospect"
          ? "Hay una configuración guardada para toda la conversación de cuenta nueva."
          : coachBusinessRulesProcess === "default"
            ? coachBusinessRulesChannel === "coach"
              ? "Hay una configuración general guardada para Coach."
              : "Hay una configuración predeterminada guardada para este canal."
            : "Hay ajustes propios guardados para este tipo de consulta."
      : coachBusinessRulesSource?.inheritedFromDefault
        ? "No hay ajustes propios para este tipo; se usa la configuración predeterminada del canal."
        : "Se usan los valores iniciales del sistema para este canal.";
  const selectedCoachProcessOption = getCoachProcessOption(
    coachBusinessRulesProcess,
    coachBusinessRulesChannel,
  );
  const getVisibleChannelRules = (channel) =>
    coachAdminRules.filter(
      (rule) =>
        rule.scope === "channel" &&
        rule.channel === channel &&
        (channel !== coachBusinessRulesChannel ||
          rule.process === "default" ||
          rule.process === coachBusinessRulesProcess),
    );
  const selectedCoachIntent = coachIntentCatalog.find(
    (intent) => intent.code === coachIntentCode,
  );
  const selectedChannelIntent = channelIntentCatalog.find(
    (intent) => intent.code === channelIntentCode,
  );

  if (loading) {
    return (
      <section className="mi-agent-page">
        <div className="mi-agent-empty">Cargando tu situación comercial...</div>
      </section>
    );
  }

  return (
    <section className="mi-agent-page">
      <header className="mi-agent-hero">
        <div>
          <span className="mi-agent-kicker">Ejecución comercial</span>
          <h2>Mi coach</h2>
          <p>Tu siguiente mejor movimiento para acercarte a la cuota.</p>
        </div>
      </header>

      {error ? <p className="form-error">{error}</p> : null}
      {coachNotice ? (
        <p className="mi-agent-coach-success" role="status">
          {coachNotice}
        </p>
      ) : null}

      <div className="mi-agent-workspace-navigation">
        <nav
          className="mi-agent-workspace-tabs"
          aria-label="Espacios de Mi Coach"
        >
          {canUseCoach ? (
            <button
              type="button"
              className={
                activeWorkspace === "summary" || activeWorkspace === "coach"
                  ? "is-active"
                  : ""
              }
              aria-current={
                activeWorkspace === "summary" || activeWorkspace === "coach"
                  ? "page"
                  : undefined
              }
              onClick={() => setActiveWorkspace("summary")}
            >
              <LayoutDashboard size={16} aria-hidden="true" />
              Mi Coach
            </button>
          ) : null}
          {canAccessCustomerChat && canReadCustomerIntelligence ? (
            <button
              type="button"
              className={activeWorkspace === "customer" ? "is-active" : ""}
              aria-current={activeWorkspace === "customer" ? "page" : undefined}
              onClick={() => setActiveWorkspace("customer")}
            >
              Cliente existente
            </button>
          ) : null}
          {canAccessProspectChat &&
          (canReadProspecting || canCreateProspecting) ? (
            <button
              type="button"
              className={activeWorkspace === "prospect" ? "is-active" : ""}
              aria-current={activeWorkspace === "prospect" ? "page" : undefined}
              onClick={() => setActiveWorkspace("prospect")}
            >
              Cuenta nueva
            </button>
          ) : null}
        </nav>
        {canReadEvaluations ? <nav className="mi-agent-workspace-admin" aria-label="Evaluación del chat">
          <button type="button" className={activeWorkspace === "evaluations" ? "is-active" : ""}
            aria-current={activeWorkspace === "evaluations" ? "page" : undefined}
            onClick={() => setActiveWorkspace("evaluations")}>Pruebas del chat</button>
        </nav> : null}
        {canManageCoach ? (
          <nav className="mi-agent-workspace-admin" aria-label="Administración">
            <button
              type="button"
              className={activeWorkspace === "admin" ? "is-active" : ""}
              aria-current={activeWorkspace === "admin" ? "page" : undefined}
              onClick={() => {
                setActiveWorkspace("admin");
                loadCoachGovernance();
                void loadCoachQualitySummary();
              }}
            >
              <Settings2 size={16} aria-hidden="true" />
              Administración
            </button>
          </nav>
        ) : null}
        {canDiagnoseCustomerChats ? (
          <nav
            className="mi-agent-workspace-admin"
            aria-label="Diagnóstico de soporte"
          >
            <button
              type="button"
              className={
                activeWorkspace === "chat-diagnostics" ? "is-active" : ""
              }
              aria-current={
                activeWorkspace === "chat-diagnostics" ? "page" : undefined
              }
              onClick={() => {
                setActiveWorkspace("chat-diagnostics");
                setChatDiagnosticsSelected(null);
                void loadCustomerChatDiagnostics({ page: 1 });
                setChatDiagnosticsPage(1);
              }}
            >
              Diagnóstico de chats
            </button>
          </nav>
        ) : null}
      </div>

      {canUseCoach &&
      (activeWorkspace === "summary" ||
        (activeWorkspace === "coach" && canUseCoach)) ? (
        <nav
          className="mi-agent-workspace-tabs mi-agent-coach-view-tabs"
          aria-label="Vistas de Mi Coach"
        >
          <button
            type="button"
            className={activeWorkspace === "summary" ? "is-active" : ""}
            aria-current={activeWorkspace === "summary" ? "page" : undefined}
            onClick={() => setActiveWorkspace("summary")}
          >
            Resumen
          </button>
          {canUseCoach ? (
            <button
              type="button"
              className={activeWorkspace === "coach" ? "is-active" : ""}
              aria-current={activeWorkspace === "coach" ? "page" : undefined}
              onClick={() => setActiveWorkspace("coach")}
            >
              Conversación
            </button>
          ) : null}
        </nav>
      ) : null}

      {activeWorkspace === "evaluations" && canReadEvaluations ? (
        <CustomerChatEvaluations canExecute={canExecuteEvaluations} canWrite={canWriteEvaluations} />
      ) : activeWorkspace === "chat-diagnostics" && canDiagnoseCustomerChats ? (
        <CustomerChatDiagnosticsPanel
          canWriteEvaluations={canWriteEvaluations}
          chatDiagnosticsAccountId={chatDiagnosticsAccountId}
          chatDiagnosticsClosingId={chatDiagnosticsClosingId}
          chatDiagnosticsDateFrom={chatDiagnosticsDateFrom}
          chatDiagnosticsDateTo={chatDiagnosticsDateTo}
          chatDiagnosticsError={chatDiagnosticsError}
          chatDiagnosticsLoading={chatDiagnosticsLoading}
          chatDiagnosticsPage={chatDiagnosticsPage}
          chatDiagnosticsQuery={chatDiagnosticsQuery}
          chatDiagnosticsResult={chatDiagnosticsResult}
          chatDiagnosticsReviewStatus={chatDiagnosticsReviewStatus}
          chatDiagnosticsSelected={chatDiagnosticsSelected}
          chatDiagnosticsStatus={chatDiagnosticsStatus}
          closeCustomerDiagnostic={closeCustomerDiagnostic}
          loadCustomerChatDiagnostics={loadCustomerChatDiagnostics}
          openCustomerChatDiagnostic={openCustomerChatDiagnostic}
          setChatDiagnosticsAccountId={setChatDiagnosticsAccountId}
          setChatDiagnosticsDateFrom={setChatDiagnosticsDateFrom}
          setChatDiagnosticsDateTo={setChatDiagnosticsDateTo}
          setChatDiagnosticsPage={setChatDiagnosticsPage}
          setChatDiagnosticsQuery={setChatDiagnosticsQuery}
          setChatDiagnosticsReviewStatus={setChatDiagnosticsReviewStatus}
          setChatDiagnosticsStatus={setChatDiagnosticsStatus}
        />
      ) : activeWorkspace === "summary" ||
        (activeWorkspace === "coach" && canUseCoach) ? (
        <>
          {activeWorkspace === "summary" ? (
            <section
              className="mi-agent-summary"
              aria-labelledby="mi-agent-summary-title"
            >
              <div className="mi-agent-section-heading">
                <div>
                  <span className="mi-agent-section-label">Vista general</span>
                  <h3 id="mi-agent-summary-title">Resumen comercial</h3>
                </div>
                <div className="mi-agent-summary-period">
                  <span>{snapshot.period?.label || "Período actual"}</span>
                  {currency !== "USD" &&
                  snapshot.quota.currencyConversionAvailable ? (
                    <small>
                      1 USD ={" "}
                      {snapshot.quota.usdToQuotaRate.toLocaleString("es-MX", {
                        maximumFractionDigits: 4,
                      })}{" "}
                      {currency} · tasa de referencia{" "}
                      {snapshot.quota.currencyRateFetchedAt
                        ? formatDate(snapshot.quota.currencyRateFetchedAt)
                        : "actual"}
                    </small>
                  ) : null}
                </div>
              </div>
              <div className="mi-agent-metrics">
                <article>
                  <span>Cuota</span>
                  <strong>
                    {formatCurrency(snapshot.quota.assignedAmount, currency)}
                  </strong>
                  <small>{snapshot.period?.label || "Período actual"}</small>
                </article>
                <article>
                  <span>Real ganado</span>
                  <strong>
                    {snapshot.quota.currencyConversionAvailable
                      ? formatCurrency(snapshot.quota.actualAmount, currency)
                      : "No disponible"}
                  </strong>
                  <small>
                    {!snapshot.quota.currencyConversionAvailable
                      ? "Avance no disponible: falta tipo de cambio"
                      : snapshot.quota.assignedAmount
                        ? `${Math.round((snapshot.quota.actualAmount / snapshot.quota.assignedAmount) * 100)}% de avance`
                        : "Sin cuota"}
                  </small>
                </article>
                <article className="is-alert">
                  <span>Brecha</span>
                  <strong>
                    {snapshot.quota.currencyConversionAvailable
                      ? formatCurrency(snapshot.quota.gapAmount, currency)
                      : "No disponible"}
                  </strong>
                  <small>
                    {snapshot.quota.currencyConversionAvailable
                      ? "Lo que aún falta"
                      : "No se obtuvo tipo de cambio desde USD"}
                  </small>
                </article>
                <article>
                  <span>Pipeline abierto</span>
                  <strong>
                    {snapshot.quota.currencyConversionAvailable
                      ? formatCurrency(snapshot.pipeline.openAmount, currency)
                      : "No disponible"}
                  </strong>
                  <small>
                    {snapshot.pipeline.openCount} oportunidades ·{" "}
                    {!snapshot.quota.currencyConversionAvailable
                      ? "Cobertura no disponible"
                      : coverage
                        ? `${coverage.toFixed(1)}x cobertura`
                        : "Sin cobertura"}
                  </small>
                </article>
              </div>
            </section>
          ) : null}

          {activeWorkspace === "coach" ? (
            <>
              <CoachConversationPanel
                applyCoachClarification={applyCoachClarification}
                askCoach={askCoach}
                askingCoach={askingCoach}
                canCreateAccounts={canCreateAccounts}
                canCreateActions={canCreateActions}
                canCreateContacts={canCreateContacts}
                canReadCustomerIntelligence={canReadCustomerIntelligence}
                canReadLeads={canReadLeads}
                canResolveLeads={canResolveLeads}
                canUpdateAccounts={canUpdateAccounts}
                canUpdateCalendar={canUpdateCalendar}
                canUpdateContacts={canUpdateContacts}
                canUpdateLeads={canUpdateLeads}
                cancelPendingCoachOperation={cancelPendingCoachOperation}
                clearCoachConversation={clearCoachConversation}
                coachAccounts={coachAccounts}
                coachContacts={coachContacts}
                coachContext={coachContext}
                coachMessages={coachMessages}
                coachOperationAction={coachOperationAction}
                coachOpportunities={coachOpportunities}
                coachPendingOperations={coachPendingOperations}
                coachQuestion={coachQuestion}
                coachRecentOperations={coachRecentOperations}
                coachThreadRef={coachThreadRef}
                coachUndoOperationId={coachUndoOperationId}
                continueCoachOperation={continueCoachOperation}
                hasCoachConversation={hasCoachConversation}
                hasCoachFoundation={hasCoachFoundation}
                loadingCoachContext={loadingCoachContext}
                openCoachDetailHandoff={openCoachDetailHandoff}
                openCoachOperationConfirmation={openCoachOperationConfirmation}
                requestCoachGeneralScope={requestCoachGeneralScope}
                setCoachQuestion={setCoachQuestion}
                showCoachFoundation={showCoachFoundation}
                undoCoachOperation={undoCoachOperation}
                updateCoachFoundationVisibility={updateCoachFoundationVisibility}
              />
            </>
          ) : null}

          {activeWorkspace === "summary" ? (
            !analysis ? (
              <div className="mi-agent-start-panel">
                <div className="mi-agent-start-icon">✦</div>
                <div>
                  <h3>Tu plan comercial está listo para analizarse</h3>
                  <p>
                    Mi agente revisará tu cuota, las oportunidades desde
                    Desarrollo y las señales de riesgo del proceso comercial.
                  </p>
                  <button
                    type="button"
                    className="mi-agent-primary-button"
                    onClick={analyzeSituation}
                    disabled={analyzing}
                  >
                    {analyzing ? "Analizando..." : "Analizar mi situación"}
                  </button>
                </div>
              </div>
            ) : (
              <CoachAnalysisContent
                analysis={analysis}
                analyzeSituation={analyzeSituation}
                analyzing={analyzing}
                canExecuteCoach={canExecuteCoach}
                canUpdateCommercialDevelopment={canUpdateCommercialDevelopment}
                canUseCoach={canUseCoach}
                creatingActionRank={creatingActionRank}
                navigate={navigate}
                openCoachActionConfirmation={openCoachActionConfirmation}
                selectedAction={selectedAction}
                setActiveWorkspace={setActiveWorkspace}
                setSelectedAction={setSelectedAction}
              />
            )
          ) : null}
        </>
      ) : activeWorkspace === "customer" ? (
        <CustomerAccountWorkspace
          askCustomerChat={askCustomerChat}
          canCreateActions={canCreateActions}
          canDiagnoseCustomerChats={canDiagnoseCustomerChats}
          canExecuteCoach={canExecuteCoach}
          canReviewCustomerOperation={canReviewCustomerOperation}
          canUpdateCalendar={canUpdateCalendar}
          canUpdateContacts={canUpdateContacts}
          canUseExternalSources={canUseExternalSources}
          customerAccountId={customerAccountId}
          customerAccountSearch={customerAccountSearch}
          customerActionErrors={customerActionErrors}
          customerAgentsJob={customerAgentsJob}
          customerAgentsLoading={customerAgentsLoading}
          customerAnalysisSnapshot={customerAnalysisSnapshot}
          customerChat={customerChat}
          customerChatLoading={customerChatLoading}
          customerDiscoveryJob={customerDiscoveryJob}
          customerDiscoveryPreparing={customerDiscoveryPreparing}
          customerExecutiveBriefingJob={customerExecutiveBriefingJob}
          customerExecutiveBriefingLoading={customerExecutiveBriefingLoading}
          customerFindings={customerFindings}
          customerFocusOpportunityId={customerFocusOpportunityId}
          customerFocusOptions={customerFocusOptions}
          customerIntelligenceError={customerIntelligenceError}
          customerIntelligenceJob={customerIntelligenceJob}
          customerIntelligenceResultRef={customerIntelligenceResultRef}
          customerInvestigating={customerInvestigating}
          customerSnapshot={customerSnapshot}
          customerSnapshotLoading={customerSnapshotLoading}
          hasCustomerContext={hasCustomerContext}
          navigate={navigate}
          openCustomerAction={openCustomerAction}
          openCustomerChatOperation={openCustomerChatOperation}
          openCustomerStageAnswerPrefill={openCustomerStageAnswerPrefill}
          openDiscoveryActivity={openDiscoveryActivity}
          prepareCustomerCall={prepareCustomerCall}
          prepareCustomerExecutiveBriefing={prepareCustomerExecutiveBriefing}
          runCustomerAgents={runCustomerAgents}
          runCustomerInvestigation={runCustomerInvestigation}
          savingCoachOperation={savingCoachOperation}
          searchCustomerAccounts={searchCustomerAccounts}
          selectCustomerAccount={selectCustomerAccount}
          selectedCustomerAccount={selectedCustomerAccount}
          setCustomerActionResultOpen={setCustomerActionResultOpen}
          setCustomerFocusOpportunityId={setCustomerFocusOpportunityId}
          sortedCustomerAccounts={sortedCustomerAccounts}
        />
      ) : activeWorkspace === "prospect" ? (
        <ProspectWorkspace
          askProspectChat={askProspectChat}
          canCreateAccounts={canCreateAccounts}
          canCreateContacts={canCreateContacts}
          canCreateLeads={canCreateLeads}
          canCreateOpportunities={canCreateOpportunities}
          canCreateProspecting={canCreateProspecting}
          canReviewCustomerOperation={canReviewCustomerOperation}
          canUpdateProspecting={canUpdateProspecting}
          canUseExternalSources={canUseExternalSources}
          convertProspectContact={convertProspectContact}
          convertProspectOpportunity={convertProspectOpportunity}
          deleteSavedProspect={deleteSavedProspect}
          loadProspectSessions={loadProspectSessions}
          openCustomerChatOperation={openCustomerChatOperation}
          openSavedProspect={openSavedProspect}
          prospectChatLoading={prospectChatLoading}
          prospectChatMessages={prospectChatMessages}
          prospectChatQuestion={prospectChatQuestion}
          prospectContactDrafts={prospectContactDrafts}
          prospectConvertedAccountId={prospectConvertedAccountId}
          prospectConvertedContacts={prospectConvertedContacts}
          prospectConvertedLeadId={prospectConvertedLeadId}
          prospectConvertedOpportunities={prospectConvertedOpportunities}
          prospectConverting={prospectConverting}
          prospectError={prospectError}
          prospectExternalResearching={prospectExternalResearching}
          prospectFindingUpdatingId={prospectFindingUpdatingId}
          prospectForm={prospectForm}
          prospectList={prospectList}
          prospectListError={prospectListError}
          prospectListLoading={prospectListLoading}
          prospectListSearch={prospectListSearch}
          prospectPreparing={prospectPreparing}
          prospectSession={prospectSession}
          prospectTargetUpdatingId={prospectTargetUpdatingId}
          prospectView={prospectView}
          runProspectExternalResearch={runProspectExternalResearch}
          savingCoachOperation={savingCoachOperation}
          setProspectChatMessages={setProspectChatMessages}
          setProspectChatQuestion={setProspectChatQuestion}
          setProspectConversionConfirmation={setProspectConversionConfirmation}
          setProspectError={setProspectError}
          setProspectForm={setProspectForm}
          setProspectListSearch={setProspectListSearch}
          setProspectSession={setProspectSession}
          setProspectView={setProspectView}
          startProspectResearch={startProspectResearch}
          updateProspectContactDraft={updateProspectContactDraft}
          updateProspectFindingStatus={updateProspectFindingStatus}
          updateProspectForm={updateProspectForm}
          updateProspectHypothesisStatus={updateProspectHypothesisStatus}
          updateProspectTarget={updateProspectTarget}
        />
      ) : activeWorkspace === "admin" && canManageCoach ? (
        <section className="mi-agent-workspace-panel mi-agent-governance-panel">
          <div className="mi-agent-section-heading">
            <div>
              <span className="mi-agent-section-label">
                Gobierno de Mi Coach
              </span>
              <h3>Configuración, límites y métricas</h3>
            </div>
            <span>Solo administración</span>
          </div>
          {coachGovernanceLoading ? (
            <div className="mi-agent-empty">
              Cargando configuración de gobierno...
            </div>
          ) : null}
          {coachGovernance ? (
            <AdministrationGroups
              classifier={<SemanticClassifierSection />}
              planner={
              <details className="mi-agent-planner-prompts">
                <summary className="mi-agent-intent-governance-summary">
                  <strong role="heading" aria-level={4}>
                    Prompts del planificador · B6
                  </strong>
                  <span>
                    Instrucciones versionadas por canal. El prompt técnico base
                    y el esquema JSON están protegidos.
                  </span>
                </summary>
                <div className="mi-agent-intent-governance-content">
                  <p>
                    Estas instrucciones orientan la planificación; no conceden
                    permisos ni sustituyen las validaciones del servidor.
                  </p>
                  {plannerPromptNotice ? (
                    <p role="status">{plannerPromptNotice}</p>
                  ) : null}
                  <button
                    type="button"
                    className="mi-agent-secondary-button"
                    disabled={Boolean(plannerPromptSaving)}
                    onClick={reloadPlannerPrompts}
                  >
                    Recargar prompts guardados
                  </button>
                  {plannerPrompts.map((prompt) => {
                    const label = {
                      coach: "Coach",
                      customer_account: "Cliente existente",
                      prospect: "Cuenta nueva",
                    }[prompt.channel];
                    return (
                      <article
                        className="mi-agent-admin-rule-group"
                        key={prompt.channel}
                      >
                        <h4>{label}</h4>
                        <p>
                          {prompt.connected
                            ? "Conectado a B6. La versión guardada se aplica a la próxima planificación."
                            : "No conectado: esta configuración todavía no afecta su flujo."}
                        </p>
                        <p>
                          {prompt.source === "default"
                            ? "Versión inicial"
                            : `Versión ${prompt.version}`}
                        </p>
                        <label>
                          Instrucciones del planificador de {label}
                          <textarea
                            rows={6}
                            maxLength={8000}
                            value={prompt.draft}
                            disabled={Boolean(plannerPromptSaving)}
                            onChange={(event) => {
                              const draft = event.target.value;
                              setPlannerPrompts((current) =>
                                current.map((item) =>
                                  item.channel === prompt.channel
                                    ? { ...item, draft }
                                    : item,
                                ),
                              );
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          className="mi-agent-primary-button"
                          disabled={
                            Boolean(plannerPromptSaving) ||
                            !prompt.draft.trim() ||
                            prompt.draft.trim() === prompt.instruction
                          }
                          onClick={() => savePlannerPrompt(prompt.channel)}
                        >
                          {plannerPromptSaving === prompt.channel
                            ? "Guardando..."
                            : `Guardar prompt de ${label}`}
                        </button>
                        <button
                          type="button"
                          className="mi-agent-secondary-button"
                          disabled={
                            Boolean(plannerPromptSaving) ||
                            !prompt.initialInstruction ||
                            prompt.draft === prompt.initialInstruction
                          }
                          onClick={() => loadInitialPlannerPrompt(prompt.channel)}
                        >
                          Cargar prompt inicial de {label}
                        </button>
                        <details>
                          <summary>Historial de versiones de {label}</summary>
                          {prompt.revisions?.length ? (
                            prompt.revisions.map((revision) => (
                              <div key={revision.version}>
                                <h5>Versión {revision.version}</h5>
                                <p>
                                  {new Date(revision.createdAt).toLocaleString()}
                                </p>
                                <pre>{revision.instruction}</pre>
                              </div>
                            ))
                          ) : (
                            <p>Todavía no hay versiones personalizadas.</p>
                          )}
                        </details>
                      </article>
                    );
                  })}
                </div>
              </details>
              }
              intents={
              <IntentGovernanceSection
                channelIntentCatalog={channelIntentCatalog}
                channelIntentChannel={channelIntentChannel}
                channelIntentCode={channelIntentCode}
                channelIntentDraft={channelIntentDraft}
                channelIntentFeedback={channelIntentFeedback}
                channelIntentPreview={channelIntentPreview}
                channelIntentRevisions={channelIntentRevisions}
                channelIntentSaving={channelIntentSaving}
                channelIntentTestQuestion={channelIntentTestQuestion}
                coachGovernanceSaving={coachGovernanceSaving}
                coachIntentCatalog={coachIntentCatalog}
                coachIntentCode={coachIntentCode}
                coachIntentExamplesDraft={coachIntentExamplesDraft}
                coachIntentFeedback={coachIntentFeedback}
                coachIntentPreview={coachIntentPreview}
                coachIntentRevisions={coachIntentRevisions}
                coachIntentTestQuestion={coachIntentTestQuestion}
                previewChannelIntentConfiguration={previewChannelIntentConfiguration}
                previewCoachIntent={previewCoachIntent}
                restoreChannelIntentConfiguration={restoreChannelIntentConfiguration}
                restoreCoachIntentRevision={restoreCoachIntentRevision}
                saveChannelIntentConfiguration={saveChannelIntentConfiguration}
                saveCoachIntentExamples={saveCoachIntentExamples}
                selectChannelIntent={selectChannelIntent}
                selectCoachIntent={selectCoachIntent}
                selectIntentRoutingChannel={selectIntentRoutingChannel}
                selectedChannelIntent={selectedChannelIntent}
                selectedCoachIntent={selectedCoachIntent}
                setChannelIntentDraft={setChannelIntentDraft}
                setChannelIntentTestQuestion={setChannelIntentTestQuestion}
                setCoachIntentExamplesDraft={setCoachIntentExamplesDraft}
                setCoachIntentTestQuestion={setCoachIntentTestQuestion}
              />
              }
              observability={
              <DecisionObservabilitySection
                coachDecisionReviewSaving={coachDecisionReviewSaving}
                coachDecisionTraceDetail={coachDecisionTraceDetail}
                coachDecisionTraceFilters={coachDecisionTraceFilters}
                coachDecisionTraceLoading={coachDecisionTraceLoading}
                coachDecisionTraces={coachDecisionTraces}
                coachQualityLoading={coachQualityLoading}
                coachQualitySummary={coachQualitySummary}
                loadCoachQualitySummary={loadCoachQualitySummary}
                reviewCoachDecisionTrace={reviewCoachDecisionTrace}
                setCoachDecisionTraceDetail={setCoachDecisionTraceDetail}
                setCoachDecisionTraceFilters={setCoachDecisionTraceFilters}
              />
              }
              conversationalRules={
              <details
                className="mi-agent-admin-rules"
                aria-labelledby="mi-agent-admin-rules-title"
              >
                <summary className="mi-agent-admin-rules-summary">
                  <strong
                    id="mi-agent-admin-rules-title"
                    role="heading"
                    aria-level={4}
                  >
                    Reglas conversacionales
                  </strong>
                  <span>
                    Instrucciones comunes o específicas que orientan las
                    respuestas del asistente.
                  </span>
                </summary>
                <div className="mi-agent-admin-rules-content">
                  <div className="mi-agent-admin-rules-actions">
                    <button
                      type="button"
                      className="mi-agent-secondary-button"
                      onClick={() => startCoachAdminRuleCreate("common")}
                      disabled={coachGovernanceSaving}
                    >
                      Añadir regla común
                    </button>
                    <button
                      type="button"
                      className="mi-agent-primary-button"
                      onClick={() => startCoachAdminRuleCreate("channel")}
                      disabled={coachGovernanceSaving}
                    >
                      Añadir regla específica
                    </button>
                  </div>
                  {coachAdminRuleFeedback ? (
                    <p
                      className={`mi-agent-admin-rule-feedback is-${coachAdminRuleFeedback.kind}`}
                      role={
                        coachAdminRuleFeedback.kind === "error"
                          ? "alert"
                          : "status"
                      }
                    >
                      {coachAdminRuleFeedback.message}
                    </p>
                  ) : null}
                  <div className="mi-agent-admin-rule-groups">
                    {[
                      {
                        key: "common",
                        title: "Comunes a todos los chats",
                        rules: coachAdminRules.filter(
                          (rule) => rule.scope === "common",
                        ),
                      },
                      {
                        key: "coach",
                        title: `Específicas para Coach · ${coachBusinessRulesChannel === "coach" ? getCoachProcessOption(coachBusinessRulesProcess, "coach").label : "todos los tipos de consulta"}`,
                        rules: getVisibleChannelRules("coach"),
                      },
                      {
                        key: "customer_account",
                        title: `Específicas para Cliente existente · ${coachBusinessRulesChannel === "customer_account" ? getCoachProcessOption(coachBusinessRulesProcess, "customer_account").label : "toda la conversación"}`,
                        rules: getVisibleChannelRules("customer_account"),
                      },
                      {
                        key: "prospect",
                        title: `Específicas para Cuenta nueva · ${coachBusinessRulesChannel === "prospect" ? getCoachProcessOption(coachBusinessRulesProcess, "prospect").label : "toda la conversación"}`,
                        rules: getVisibleChannelRules("prospect"),
                      },
                    ].map((group) => (
                      <details
                        className="mi-agent-admin-rule-group"
                        key={group.key}
                      >
                        <summary className="mi-agent-admin-rule-group-summary">
                          <h5>{group.title}</h5>
                          <span>{group.rules.length}</span>
                        </summary>
                        <div className="mi-agent-admin-rule-group-content">
                          {group.rules.length ? (
                            <div className="mi-agent-admin-rule-list">
                              {group.rules.map((rule) => (
                                <article
                                  className={`mi-agent-admin-rule${rule.enabled ? "" : " is-disabled"}`}
                                  key={rule.id}
                                >
                                  <div className="mi-agent-admin-rule-copy">
                                    <strong>{rule.title}</strong>
                                    {rule.scope === "channel" ? (
                                      <span>
                                        {
                                          COACH_RULE_CHANNEL_LABELS[
                                            rule.channel
                                          ]
                                        }{" "}
                                        ·{" "}
                                        {
                                          getCoachProcessOption(
                                            rule.process,
                                            rule.channel,
                                          ).label
                                        }
                                      </span>
                                    ) : null}
                                    <p>{rule.instruction}</p>
                                  </div>
                                  <div className="mi-agent-admin-rule-controls">
                                    <label className="mi-agent-admin-rule-toggle">
                                      <input
                                        type="checkbox"
                                        checked={Boolean(rule.enabled)}
                                        onChange={() =>
                                          toggleCoachAdminRule(rule)
                                        }
                                        disabled={coachGovernanceSaving}
                                      />
                                      Activa
                                    </label>
                                    <button
                                      type="button"
                                      className="mi-agent-icon-button"
                                      aria-label={`Editar regla ${rule.title}`}
                                      title="Editar regla"
                                      onClick={() =>
                                        startCoachAdminRuleEdit(rule)
                                      }
                                      disabled={coachGovernanceSaving}
                                    >
                                      <Pencil size={15} aria-hidden="true" />
                                    </button>
                                    <button
                                      type="button"
                                      className="mi-agent-icon-button is-danger"
                                      aria-label={`Eliminar regla ${rule.title}`}
                                      title="Eliminar regla"
                                      onClick={() => deleteCoachAdminRule(rule)}
                                      disabled={coachGovernanceSaving}
                                    >
                                      <Trash2 size={15} aria-hidden="true" />
                                    </button>
                                  </div>
                                </article>
                              ))}
                            </div>
                          ) : (
                            <p className="mi-agent-admin-rule-empty">
                              {group.key === coachBusinessRulesChannel &&
                              coachBusinessRulesProcess !== "default"
                                ? `No hay reglas específicas para ${getCoachProcessOption(coachBusinessRulesProcess, coachBusinessRulesChannel).label}; se aplican las reglas predeterminadas del canal.`
                                : "No hay reglas en este ámbito."}
                            </p>
                          )}
                        </div>
                      </details>
                    ))}
                  </div>
                  {coachAdminRuleDraft ? (
                    <div className="mi-agent-admin-rule-editor">
                      <div className="mi-agent-admin-rule-editor-heading">
                        <h5>
                          {coachAdminRuleEditingId
                            ? "Editar regla"
                            : "Nueva regla"}
                        </h5>
                        <span>
                          {coachAdminRuleDraft.scope === "common"
                            ? "Común a todos los chats"
                            : `${COACH_RULE_CHANNEL_LABELS[coachAdminRuleDraft.channel]} · ${getCoachProcessOption(coachAdminRuleDraft.process, coachAdminRuleDraft.channel).label}`}
                        </span>
                      </div>
                      <label>
                        Nombre
                        <input
                          value={coachAdminRuleDraft.title}
                          maxLength={180}
                          onChange={(event) =>
                            setCoachAdminRuleDraft((current) => ({
                              ...current,
                              title: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        Instrucción
                        <textarea
                          rows={4}
                          value={coachAdminRuleDraft.instruction}
                          maxLength={5000}
                          onChange={(event) =>
                            setCoachAdminRuleDraft((current) => ({
                              ...current,
                              instruction: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="mi-agent-admin-rule-order">
                        Orden
                        <input
                          type="number"
                          min={-1000}
                          max={1000}
                          value={coachAdminRuleDraft.sortOrder}
                          onChange={(event) =>
                            setCoachAdminRuleDraft((current) => ({
                              ...current,
                              sortOrder: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <div className="mi-agent-workspace-actions">
                        <button
                          type="button"
                          className="mi-agent-primary-button"
                          onClick={saveCoachAdminRule}
                          disabled={
                            coachGovernanceSaving ||
                            !coachAdminRuleDraft.title.trim() ||
                            !coachAdminRuleDraft.instruction.trim()
                          }
                        >
                          {coachGovernanceSaving
                            ? "Guardando..."
                            : "Guardar regla"}
                        </button>
                        <button
                          type="button"
                          className="mi-agent-secondary-button"
                          onClick={() => {
                            setCoachAdminRuleDraft(null);
                            setCoachAdminRuleEditingId(null);
                          }}
                          disabled={coachGovernanceSaving}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </details>
              }
              serverRules={<ServerRulesSection />}
              policies={
              <ChannelPolicySection
                coachBusinessRulesChannel={coachBusinessRulesChannel}
                coachBusinessRulesProcess={coachBusinessRulesProcess}
                coachBusinessRulesSourceLabel={coachBusinessRulesSourceLabel}
                coachGovernanceSaving={coachGovernanceSaving}
                loadCoachAdminRules={loadCoachAdminRules}
                loadCoachBusinessRulesForScope={loadCoachBusinessRulesForScope}
                saveCoachBusinessRules={saveCoachBusinessRules}
                selectedCoachBusinessRules={selectedCoachBusinessRules}
                selectedCoachProcessOption={selectedCoachProcessOption}
                setCoachBusinessRulesChannel={setCoachBusinessRulesChannel}
                setCoachBusinessRulesProcess={setCoachBusinessRulesProcess}
                updateCoachBusinessRuleField={updateCoachBusinessRuleField}
                updateCoachOperationKind={updateCoachOperationKind}
              />
              }
              governance={
              <GovernanceSettingsSection
                coachGovernance={coachGovernance}
                coachGovernanceSaving={coachGovernanceSaving}
                saveCoachGovernance={saveCoachGovernance}
                setCoachGovernance={setCoachGovernance}
                updateOpportunityStageSet={updateOpportunityStageSet}
              />
              }
            />
          ) : !coachGovernanceLoading ? (
            <div className="mi-agent-empty">
              No se pudo cargar el gobierno de Mi Coach.
            </div>
          ) : null}
        </section>
      ) : activeWorkspace === "empty" ? (
        <section className="mi-agent-workspace-panel">
          <div className="mi-agent-empty">
            No tienes canales habilitados en Mi Coach.
          </div>
        </section>
      ) : null}

      {customerContactApplyDraft ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Confirmar contacto público"
        >
          <div className="modal-dialog mi-agent-coach-action-dialog">
            <h3 className="modal-title">Confirmar contacto público</h3>
            <p className="modal-message">
              Revisa la evidencia y confirma si deseas crear este contacto en la
              cuenta.
            </p>
            <div className="mi-agent-coach-action-form">
              {[
                ["firstName", "Nombre"],
                ["lastName", "Apellido"],
                ["positionTitle", "Cargo"],
                ["department", "Departamento"],
                ["email", "Correo corporativo"],
                ["phone", "Teléfono"],
                ["mobile", "Móvil"],
              ].map(([field, label]) => (
                <label key={field}>
                  {label}
                  <input
                    value={customerContactApplyDraft.contactData?.[field] || ""}
                    onChange={(event) =>
                      setCustomerContactApplyDraft((current) => ({
                        ...current,
                        contactData: {
                          ...current.contactData,
                          [field]: event.target.value,
                        },
                      }))
                    }
                  />
                </label>
              ))}
              {coachContacts.length ? (
                <label>
                  Actualizar contacto existente (opcional)
                  <select
                    value={customerContactApplyDraft.contactId}
                    onChange={(event) =>
                      setCustomerContactApplyDraft((current) => ({
                        ...current,
                        contactId: event.target.value,
                      }))
                    }
                  >
                    <option value="">Crear contacto nuevo</option>
                    {coachContacts.map((contact) => (
                      <option key={contact.id} value={contact.id}>
                        {contact.full_name ||
                          `${contact.first_name || ""} ${contact.last_name || ""}`.trim()}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            <div className="modal-buttons">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setCustomerContactApplyDraft(null)}
                disabled={customerContactApplying}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={applyCustomerContact}
                disabled={
                  customerContactApplying ||
                  !customerContactApplyDraft.contactData?.firstName?.trim() ||
                  !customerContactApplyDraft.contactData?.lastName?.trim()
                }
              >
                {customerContactApplying
                  ? "Guardando..."
                  : "Confirmar y guardar contacto"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {customerFindingApplyDraft ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Aplicar hallazgo al CRM"
        >
          <div className="modal-dialog mi-agent-coach-action-dialog">
            <h3 className="modal-title">Aplicar hallazgo al CRM</h3>
            <p className="modal-message">
              El hallazgo fue confirmado. Revisa el valor sugerido antes de
              agregarlo o reemplazar el dato del registro.
            </p>
            <div className="mi-agent-coach-action-form">
              <label>
                Registro
                <select
                  value={customerFindingApplyDraft.target}
                  onChange={(event) => {
                    const target = event.target.value;
                    const firstField =
                      CUSTOMER_FINDING_APPLY_FIELDS[target]?.[0]?.[0] || "";
                    setCustomerFindingApplyDraft((current) => ({
                      ...current,
                      target,
                      field: firstField,
                    }));
                  }}
                >
                  {customerFindingApplyDraft.finding.accountId ? (
                    <option value="account">Cuenta</option>
                  ) : null}
                  {customerFindingApplyDraft.finding.contactId ? (
                    <option value="contact">Contacto</option>
                  ) : null}
                  {customerFindingApplyDraft.finding.opportunityId ? (
                    <option value="opportunity">Oportunidad</option>
                  ) : null}
                </select>
              </label>
              <label>
                Campo
                <select
                  value={customerFindingApplyDraft.field}
                  onChange={(event) =>
                    setCustomerFindingApplyDraft((current) => ({
                      ...current,
                      field: event.target.value,
                    }))
                  }
                >
                  {(
                    CUSTOMER_FINDING_APPLY_FIELDS[
                      customerFindingApplyDraft.target
                    ] || []
                  ).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Valor
                <textarea
                  rows={5}
                  value={customerFindingApplyDraft.value}
                  onChange={(event) =>
                    setCustomerFindingApplyDraft((current) => ({
                      ...current,
                      value: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Tratamiento del valor actual
                <select
                  value={customerFindingApplyDraft.mode}
                  onChange={(event) =>
                    setCustomerFindingApplyDraft((current) => ({
                      ...current,
                      mode: event.target.value,
                    }))
                  }
                >
                  <option value="append">Agregar al valor existente</option>
                  <option value="replace">Reemplazar el valor existente</option>
                </select>
              </label>
            </div>
            <div className="modal-buttons">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setCustomerFindingApplyDraft(null)}
                disabled={customerFindingApplying}
              >
                Cerrar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={applyCustomerFinding}
                disabled={
                  customerFindingApplying ||
                  !String(customerFindingApplyDraft.value || "").trim()
                }
              >
                {customerFindingApplying
                  ? "Aplicando..."
                  : "Confirmar aplicación"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {prospectConversionConfirmation ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={
            prospectConversionConfirmation === "account"
              ? "Confirmar creación de cuenta"
              : "Confirmar creación de lead"
          }
        >
          <div className="modal-dialog mi-agent-coach-action-dialog">
            <h3 className="modal-title">
              {prospectConversionConfirmation === "account"
                ? "Confirmar creación de cuenta"
                : "Confirmar creación de lead"}
            </h3>
            {prospectConversionConfirmation === "account" ? (
              <>
                <p className="modal-message">
                  Se creará una cuenta nueva en el CRM con estos datos:
                </p>
                <dl className="mi-agent-prospect-confirmation-details">
                  <div>
                    <dt>Empresa</dt>
                    <dd>{prospectSession?.companyName || "Sin nombre"}</dd>
                  </div>
                  <div>
                    <dt>País</dt>
                    <dd>{prospectSession?.country || "Sin país"}</dd>
                  </div>
                  {prospectSession?.website ? (
                    <div>
                      <dt>Sitio web</dt>
                      <dd>{prospectSession.website}</dd>
                    </div>
                  ) : null}
                  {prospectSession?.industry ? (
                    <div>
                      <dt>Industria</dt>
                      <dd>{prospectSession.industry}</dd>
                    </div>
                  ) : null}
                </dl>
                <p className="modal-message">
                  Los hallazgos y las hipótesis de la investigación no se
                  crearán como registros CRM.
                </p>
              </>
            ) : (
              <>
                <p className="modal-message">
                  Se registrará un lead de prospección para{" "}
                  <strong>
                    {prospectSession?.companyName || "esta empresa"}
                  </strong>
                  {prospectSession?.country
                    ? `, en ${prospectSession.country}`
                    : ""}
                  {prospectSession?.industry
                    ? `, industria ${prospectSession.industry}`
                    : ""}
                  .
                </p>
                <p className="modal-message">
                  {prospectConvertedAccountId ||
                  prospectSession?.convertedAccountId
                    ? "El lead quedará asociado a la cuenta creada en esta prospección."
                    : "El lead quedará sin asociar a una cuenta. No se vinculará a una cuenta existente."}
                </p>
              </>
            )}
            {prospectError ? (
              <p className="form-error" role="alert">
                {prospectError}
              </p>
            ) : null}
            <div className="modal-buttons">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setProspectConversionConfirmation("")}
                disabled={Boolean(prospectConverting)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={confirmProspectConversion}
                disabled={Boolean(prospectConverting)}
              >
                {prospectConverting === "account"
                  ? "Creando cuenta..."
                  : prospectConverting === "lead"
                    ? "Creando lead..."
                    : prospectConversionConfirmation === "account"
                      ? "Confirmar y crear cuenta"
                      : "Confirmar y crear lead"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {coachActionDraft ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Confirmar próximo paso del Coach"
        >
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
                  onChange={(event) =>
                    setCoachActionDraft((current) => ({
                      ...current,
                      opportunityId: event.target.value,
                      contextSnapshot:
                        snapshot.pipeline.opportunities.find(
                          (item) =>
                            Number(item.id) === Number(event.target.value),
                        ) || null,
                    }))
                  }
                >
                  <option value="">Selecciona una oportunidad</option>
                  {snapshot.pipeline.opportunities.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.accountName || "Sin cuenta"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Tipo de registro
                <select
                  value={coachActionDraft.actionType}
                  onChange={(event) =>
                    setCoachActionDraft((current) => ({
                      ...current,
                      actionType: event.target.value,
                    }))
                  }
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
                  onChange={(event) =>
                    setCoachActionDraft((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Estado
                <select
                  value={coachActionDraft.status}
                  onChange={(event) =>
                    setCoachActionDraft((current) => ({
                      ...current,
                      status: event.target.value,
                    }))
                  }
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
                  onChange={(event) =>
                    setCoachActionDraft((current) => ({
                      ...current,
                      dueDate: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Fecha y hora programada
                <input
                  type="datetime-local"
                  value={coachActionDraft.scheduledAt}
                  onChange={(event) =>
                    setCoachActionDraft((current) => ({
                      ...current,
                      scheduledAt: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Prioridad
                <select
                  value={coachActionDraft.priority}
                  onChange={(event) =>
                    setCoachActionDraft((current) => ({
                      ...current,
                      priority: event.target.value,
                    }))
                  }
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
                  onChange={(event) =>
                    setCoachActionDraft((current) => ({
                      ...current,
                      successCriteria: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Notas
                <textarea
                  rows={2}
                  value={coachActionDraft.notes}
                  onChange={(event) =>
                    setCoachActionDraft((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <div className="modal-buttons">
              <button
                type="button"
                className="btn-secondary"
                onClick={rejectCoachAction}
                disabled={Boolean(creatingActionRank)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={createNextStep}
                disabled={
                  Boolean(creatingActionRank) || !coachActionDraft.title.trim()
                }
              >
                {creatingActionRank
                  ? "Preparando..."
                  : "Continuar en Desarrollo Comercial"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {coachOperationDraft ? (
        <CoachOperationDialog
          applyCoachOperation={applyCoachOperation}
          canExecuteCoach={canExecuteCoach}
          coachAccounts={coachAccounts}
          coachDialogRef={coachDialogRef}
          coachDraftMissingFields={coachDraftMissingFields}
          coachDraftMissingSet={coachDraftMissingSet}
          coachDraftSaving={coachDraftSaving}
          coachOperationDraft={coachOperationDraft}
          coachOperationOpportunityOptionsOverride={coachOperationOpportunityOptionsOverride}
          customerSnapshot={customerSnapshot}
          rejectCoachOperation={rejectCoachOperation}
          savingCoachOperation={savingCoachOperation}
          setCoachOperationDraft={setCoachOperationDraft}
          snapshot={snapshot}
          updateCoachPayloadField={updateCoachPayloadField}
        />
      ) : null}

      {analysis?.risks?.length ? (
        <section className="mi-agent-risks">
          <div className="mi-agent-section-heading">
            <div>
              <span className="mi-agent-section-label">Señales a vigilar</span>
              <h3>Riesgos principales</h3>
            </div>
          </div>
          <div className="mi-agent-risk-list">
            {analysis.risks.map((risk) => (
              <div key={risk}>!</div>
            ))}
          </div>
          <ul>
            {analysis.risks.map((risk) => (
              <li key={risk}>{risk}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
