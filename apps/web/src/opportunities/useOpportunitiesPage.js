import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, getApiErrorMessage } from "../api";
import { usePersistedStatusFilter } from "../appFilters";

const PROPOSE_ANSWERS_TIMEOUT_MS = 240000;
const PROPOSE_ANSWERS_JOB_POLL_INTERVAL_MS = 3000;
const PROPOSE_ANSWERS_TOTAL_POLL_TIMEOUT_MS = 120000;
const DOCUMENT_SESSION_POLL_INTERVAL_MS = 3000;
const VALIDATE_STAGE_TIMEOUT_MS = 60000;
const VALIDATE_STAGE_JOB_POLL_INTERVAL_MS = 3000;
const VALIDATE_STAGE_TOTAL_POLL_TIMEOUT_MS = 120000;
const COMMERCIAL_SELLER_ELIGIBILITY_PERMISSION =
  "comercial.seller.eligible";

function isDocumentProcessingPending(session, documents) {
  const sessionStatus = normalizeText(session?.status);
  if (sessionStatus === "processing") {
    return true;
  }

  return (Array.isArray(documents) ? documents : []).some((document) => {
    const processingStatus = normalizeText(document?.processingStatus);
    return (
      processingStatus === "uploaded" ||
      processingStatus === "retry_pending" ||
      processingStatus === "processing"
    );
  });
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

const OPPORTUNITY_NAME_CONNECTORS = new Set([
  "a",
  "al",
  "con",
  "de",
  "del",
  "en",
  "para",
  "por",
  "y",
  "e",
]);

const OPPORTUNITY_NAME_ACRONYMS = new Set([
  "aws",
  "b2b",
  "b2c",
  "bi",
  "crm",
  "erp",
  "gps",
  "hp",
  "ia",
  "iot",
  "it",
  "m365",
  "qa",
  "rfp",
  "sap",
  "sdr",
  "ti",
  "ui",
  "ux",
  "vpn",
  "wifi",
]);

const OPPORTUNITY_NAME_SPECIAL_TOKENS = new Map([
  ["accessq", "AccessQ"],
  ["linkedin", "LinkedIn"],
  ["microsoft", "Microsoft"],
  ["openai", "OpenAI"],
  ["powerbi", "Power BI"],
  ["whatsapp", "WhatsApp"],
]);

function collapseOpportunityNameWhitespace(value) {
  return String(value || "")
    .replace(/^\s+/g, "")
    .replace(/\s{2,}/g, " ");
}

function capitalizeOpportunityWord(value) {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function normalizeOpportunityNameKey(value) {
  return normalizeText(value).replace(/[^a-z0-9]/g, "");
}

function normalizeOpportunityNameSegment(segment) {
  const segmentKey = normalizeOpportunityNameKey(segment);
  if (OPPORTUNITY_NAME_SPECIAL_TOKENS.has(segmentKey)) {
    return OPPORTUNITY_NAME_SPECIAL_TOKENS.get(segmentKey);
  }

  if (OPPORTUNITY_NAME_ACRONYMS.has(segmentKey)) {
    return segment.toUpperCase();
  }

  return segment.replace(/[A-Za-zÀ-ÿ]+/g, (word) =>
    capitalizeOpportunityWord(word),
  );
}

function normalizeOpportunityNameToken(token, index) {
  const trimmedToken = String(token || "").trim();
  if (!trimmedToken) return "";

  const tokenKey = normalizeOpportunityNameKey(trimmedToken);
  if (OPPORTUNITY_NAME_SPECIAL_TOKENS.has(tokenKey)) {
    return OPPORTUNITY_NAME_SPECIAL_TOKENS.get(tokenKey);
  }

  if (OPPORTUNITY_NAME_ACRONYMS.has(tokenKey)) {
    return trimmedToken.toUpperCase();
  }

  if (OPPORTUNITY_NAME_CONNECTORS.has(tokenKey)) {
    return index === 0 ? capitalizeOpportunityWord(trimmedToken) : tokenKey;
  }

  return trimmedToken
    .split(/([-/'’])/)
    .map((segment) => {
      if (/^[-/'’]$/.test(segment)) {
        return segment;
      }
      return normalizeOpportunityNameSegment(segment);
    })
    .join("");
}

function normalizeOpportunityNameValue(value) {
  const sanitizedValue = collapseOpportunityNameWhitespace(value).trim();
  if (!sanitizedValue) return "";

  return sanitizedValue
    .split(" ")
    .filter(Boolean)
    .map((token, index) => normalizeOpportunityNameToken(token, index))
    .join(" ");
}

function buildDocumentReviewOverrides(review) {
  const suggestedFields = review?.suggestedFields || {};
  const suggestedNameOptions = Array.isArray(
    suggestedFields.suggestedNameOptions,
  )
    ? suggestedFields.suggestedNameOptions
    : [];
  const selectedSuggestedName =
    suggestedNameOptions.find((value) => String(value || "").trim()) ||
    suggestedFields.suggestedName ||
    "";

  return {
    fieldOverrides: {
      name: String(selectedSuggestedName || ""),
      amountUsd:
        suggestedFields.suggestedAmountUsd === null ||
        suggestedFields.suggestedAmountUsd === undefined
          ? ""
          : String(suggestedFields.suggestedAmountUsd),
      closeDate: String(suggestedFields.suggestedCloseDate || ""),
    },
    matchSelections: {
      accountId: suggestedFields.matchedAccount?.selectedEntityId
        ? String(suggestedFields.matchedAccount.selectedEntityId)
        : "",
      contactId: suggestedFields.matchedContact?.selectedEntityId
        ? String(suggestedFields.matchedContact.selectedEntityId)
        : "",
      businessLineId: suggestedFields.matchedBusinessLine?.selectedEntityId
        ? String(suggestedFields.matchedBusinessLine.selectedEntityId)
        : "",
      sellerUserId: suggestedFields.matchedSeller?.selectedEntityId
        ? String(suggestedFields.matchedSeller.selectedEntityId)
        : "",
      presalesUserId: suggestedFields.matchedPresales?.selectedEntityId
        ? String(suggestedFields.matchedPresales.selectedEntityId)
        : "",
    },
  };
}

function buildDocumentReviewAppliedState() {
  return {
    fieldKeys: {},
    matchKeys: {},
  };
}

function mergeDocumentReviewAppliedState(
  currentState,
  selectedFieldKeys,
  selectedMatchKeys,
) {
  const defaultFieldKeys = ["name", "amountUsd", "closeDate"];
  const defaultMatchKeys = [
    "accountId",
    "contactId",
    "businessLineId",
    "sellerUserId",
    "presalesUserId",
  ];

  const fieldKeysToApply = Array.isArray(selectedFieldKeys)
    ? selectedFieldKeys
    : Array.isArray(selectedMatchKeys)
      ? []
      : defaultFieldKeys;
  const matchKeysToApply = Array.isArray(selectedMatchKeys)
    ? selectedMatchKeys
    : Array.isArray(selectedFieldKeys)
      ? []
      : defaultMatchKeys;

  return {
    fieldKeys: {
      ...(currentState?.fieldKeys || {}),
      ...Object.fromEntries(fieldKeysToApply.map((key) => [key, true])),
    },
    matchKeys: {
      ...(currentState?.matchKeys || {}),
      ...Object.fromEntries(matchKeysToApply.map((key) => [key, true])),
    },
  };
}

function shouldApplyDocumentField(selectedFieldKeys, selectedMatchKeys, key) {
  if (Array.isArray(selectedFieldKeys)) {
    return selectedFieldKeys.includes(key);
  }
  return !Array.isArray(selectedMatchKeys);
}

function shouldApplyDocumentMatch(selectedFieldKeys, selectedMatchKeys, key) {
  if (Array.isArray(selectedMatchKeys)) {
    return selectedMatchKeys.includes(key);
  }
  return !Array.isArray(selectedFieldKeys);
}

function getDocumentSessionCreationErrorMessage(error) {
  const status = Number(error?.response?.status || 0);
  const reason = String(error?.response?.data?.reason || "").trim();

  if (status === 401 || status === 403) {
    return "No tienes permisos para iniciar una sesion documental en oportunidades.";
  }

  if (reason === "document_schema_not_available") {
    return "La carga documental no esta disponible todavia porque falta instalar el esquema documental en la API.";
  }

  if (!error?.response) {
    return "No fue posible contactar la API para iniciar la sesion documental. Verifica que el backend este levantado y accesible.";
  }

  if (status >= 500) {
    return "La API respondió con un error al iniciar la sesión documental. Revisa el backend o intenta más tarde.";
  }

  return getApiErrorMessage(
    error,
    "No fue posible preparar la sesion documental",
  );
}

function formatStageValidationFeedback(validation, fallbackMessage) {
  const decision = String(validation?.decision || "").trim();
  const summary = String(validation?.summary || "").trim();
  const reasons = Array.isArray(validation?.reasons)
    ? validation.reasons
        .map((reason) => String(reason || "").trim())
        .filter(Boolean)
    : [];
  const suggestions = Array.isArray(validation?.suggestions)
    ? validation.suggestions
        .map((suggestion) => String(suggestion || "").trim())
        .filter(Boolean)
    : [];

  return [
    decision === "not_ready_to_advance"
      ? "No lista para avanzar."
      : decision === "advance_with_caution"
        ? "Lista para avanzar con reservas."
        : decision === "ready_to_advance"
          ? "Lista para avanzar."
          : "",
    summary || String(fallbackMessage || "").trim(),
    reasons.length ? `Motivos: ${reasons.slice(0, 2).join(" | ")}` : "",
    suggestions.length
      ? `Sugerencias: ${suggestions.slice(0, 2).join(" | ")}`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function useOpportunitiesPage({
  currentUser,
  searchParams,
  setSearchParams,
}) {
  const [opportunities, setOpportunities] = useState([]);
  const [opportunitiesPendingEnabled, setOpportunitiesPendingEnabled] =
    useState(false);
  const [opportunityStatusFilter, setOpportunityStatusFilterState] =
    usePersistedStatusFilter("crm.opportunities.statusFilter");
  const [opportunityQuery, setOpportunityQueryState] = useState("");
  const [opportunitySortField, setOpportunitySortField] = useState("id");
  const [opportunitySortDirection, setOpportunitySortDirection] =
    useState("asc");
  const [opportunitiesPerPage, setOpportunitiesPerPageState] = useState(10);
  const [opportunitiesPage, setOpportunitiesPage] = useState(1);
  const [showOpportunityModal, setShowOpportunityModal] = useState(false);
  const [editingOpportunityId, setEditingOpportunityId] = useState(null);
  const [editOpportunityAudit, setEditOpportunityAudit] = useState(null);
  const [commercialContext, setCommercialContext] = useState(null);
  const [commercialStageViewsById, setCommercialStageViewsById] = useState({});
  const [draftStageAction, setDraftStageAction] = useState(null);
  const [selectedCommercialStageId, setSelectedCommercialStageId] =
    useState("");
  const [loadingCommercialStageView, setLoadingCommercialStageView] =
    useState(false);
  const [commercialCloseReason, setCommercialCloseReason] = useState("");
  const [pendingCommercialCloseAction, setPendingCommercialCloseAction] =
    useState(null);
  const [showCommercialCloseModal, setShowCommercialCloseModal] =
    useState(false);
  const [showCommercialStatusReasonModal, setShowCommercialStatusReasonModal] =
    useState(false);
  const [commercialCloseModalState, setCommercialCloseModalState] = useState({
    statusCode: "",
    reason: "",
  });
  const [showStageBypassModal, setShowStageBypassModal] = useState(false);
  const [stageBypassReason, setStageBypassReason] = useState("");
  const [stageValidationResult, setStageValidationResult] = useState(null);
  const [openOpportunityMenuId, setOpenOpportunityMenuId] = useState(null);
  const [savingOpportunity, setSavingOpportunity] = useState(false);
  const [savingCommercialAction, setSavingCommercialAction] = useState("");
  const [analyzingCommercialSuggestions, setAnalyzingCommercialSuggestions] =
    useState(false);
  const [commercialSuggestionFeedback, setCommercialSuggestionFeedback] =
    useState(null);
  const [documentUploadSession, setDocumentUploadSession] = useState(null);
  const [opportunityDocuments, setOpportunityDocuments] = useState([]);
  const [documentReview, setDocumentReview] = useState(null);
  const [documentReviewOverrides, setDocumentReviewOverrides] = useState(
    buildDocumentReviewOverrides(null),
  );
  const [documentReviewApplied, setDocumentReviewApplied] = useState(
    buildDocumentReviewAppliedState(),
  );
  const [loadingDocumentSession, setLoadingDocumentSession] = useState(false);
  const [loadingOpportunityDocuments, setLoadingOpportunityDocuments] =
    useState(false);
  const [uploadingOpportunityDocuments, setUploadingOpportunityDocuments] =
    useState(false);
  const [applyingDocumentSuggestions, setApplyingDocumentSuggestions] =
    useState(false);
  const [deletingOpportunityDocumentId, setDeletingOpportunityDocumentId] =
    useState("");
  const linkingStageDocumentId = "";
  const [linkingAnswerSourceId, setLinkingAnswerSourceId] = useState("");
  const [answerDocumentSelections, setAnswerDocumentSelections] = useState({});
  const [
    commercialAnswerSuggestionsByStageId,
    setCommercialAnswerSuggestionsByStageId,
  ] = useState({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const explicitOpportunityPermissions = useMemo(
    () => new Set(currentUser?.permissions || []),
    [currentUser],
  );
  const canDirectCreateOpportunities = explicitOpportunityPermissions.has(
    "oportunidades.create",
  );
  const canRequestOpportunities = explicitOpportunityPermissions.has(
    "oportunidades.request",
  );
  const currentUserHasSellerCapability = explicitOpportunityPermissions.has(
    COMMERCIAL_SELLER_ELIGIBILITY_PERMISSION,
  );
  const canCreateOrRequestOpportunities =
    canDirectCreateOpportunities ||
    (canRequestOpportunities && opportunitiesPendingEnabled);
  const canChangeOpportunityActivationStatus = canDirectCreateOpportunities;

  function getDefaultSellerUserId() {
    const currentUserIsAvailableSeller = catalogs.sellerUsers.some(
      (user) => Number(user.id) === Number(currentUser?.id),
    );

    return currentUserHasSellerCapability && currentUserIsAvailableSeller
      ? String(currentUser.id)
      : "";
  }

  const [catalogs, setCatalogs] = useState({
    accounts: [],
    contacts: [],
    sellerUsers: [],
    presalesUsers: [],
    businessLines: [],
    stages: [],
    statuses: [],
    commercialStatuses: [],
  });
  const [form, setForm] = useState({
    name: "",
    amountUsd: "",
    accountId: "",
    closeDate: "",
    contactId: "",
    salesStageId: "",
    businessLineId: "",
    sellerUserId: "",
    presalesUserId: "",
    activationStatusId: "",
  });
  const sellerFieldReadOnly = useMemo(() => {
    const currentUserId = Number(currentUser?.id || 0);
    if (!currentUserId) return false;

    if (!currentUserHasSellerCapability) return false;

    const hasGlobalOpportunityScope = explicitOpportunityPermissions.has(
      "oportunidades.read_all",
    );
    if (hasGlobalOpportunityScope) return false;

    return (
      catalogs.sellerUsers.length === 1 &&
      Number(catalogs.sellerUsers[0]?.id) === currentUserId
    );
  }, [
    catalogs.sellerUsers,
    currentUser,
    currentUserHasSellerCapability,
    explicitOpportunityPermissions,
  ]);
  const openEditOpportunityModalRef = useRef(null);
  const commercialSuggestionPollingTokenRef = useRef(0);
  const commercialSuggestionRetryNoticeRef = useRef("");
  const stageValidationPollingTokenRef = useRef(0);
  const shouldPollDocumentSession = useMemo(
    () =>
      Boolean(showOpportunityModal) &&
      !editingOpportunityId &&
      Boolean(documentUploadSession?.publicId) &&
      isDocumentProcessingPending(documentUploadSession, opportunityDocuments),
    [
      showOpportunityModal,
      editingOpportunityId,
      documentUploadSession,
      opportunityDocuments,
    ],
  );

  useEffect(
    () => () => {
      commercialSuggestionPollingTokenRef.current += 1;
      stageValidationPollingTokenRef.current += 1;
    },
    [],
  );

  useEffect(() => {
    if (!shouldPollDocumentSession || !documentUploadSession?.publicId) {
      return undefined;
    }

    let cancelled = false;
    let timerId = null;

    async function refreshDocumentSession() {
      try {
        const { data } = await api.get(
          `/api/opportunities/document-upload-sessions/${documentUploadSession.publicId}`,
        );
        if (cancelled) {
          return;
        }
        hydrateDocumentSessionState(data);

        if (isDocumentProcessingPending(data?.session, data?.documents)) {
          timerId = window.setTimeout(
            refreshDocumentSession,
            DOCUMENT_SESSION_POLL_INTERVAL_MS,
          );
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        setError(
          getApiErrorMessage(
            err,
            "No fue posible actualizar el estado de los documentos cargados",
          ),
        );
      }
    }

    timerId = window.setTimeout(refreshDocumentSession, 0);

    return () => {
      cancelled = true;
      if (timerId) {
        window.clearTimeout(timerId);
      }
    };
  }, [shouldPollDocumentSession, documentUploadSession?.publicId]);

  function findCatalogIdByCode(options, expectedCode) {
    const target = normalizeText(expectedCode);
    const found = options.find(
      (option) => normalizeText(option.code) === target,
    );
    return found ? String(found.id) : "";
  }

  async function load() {
    try {
      const [
        opportunitiesRes,
        accountsRes,
        contactsRes,
        sellerUsersRes,
        presalesUsersRes,
        businessLinesRes,
        stagesRes,
        statusesRes,
        commercialStatusesRes,
        temporaryFeaturesRes,
      ] = await Promise.all([
        api.get("/api/opportunities"),
        api.get("/api/catalogs/opportunity-accounts"),
        api.get("/api/catalogs/opportunity-contacts"),
        api.get("/api/catalogs/opportunity-seller-users"),
        api.get("/api/catalogs/opportunity-presales-users"),
        api.get("/api/catalogs/opportunity-business-lines"),
        api.get("/api/catalogs/opportunity-sales-stages"),
        api.get("/api/catalogs/opportunity-activation-statuses"),
        api.get("/api/catalogs/opportunity-commercial-statuses"),
        api
          .get("/api/settings/temporary-features")
          .catch(() => ({ data: { settings: null } })),
      ]);

      setOpportunities(opportunitiesRes.data || []);
      setCatalogs({
        accounts: accountsRes.data || [],
        contacts: contactsRes.data || [],
        sellerUsers: sellerUsersRes.data || [],
        presalesUsers: presalesUsersRes.data || [],
        businessLines: businessLinesRes.data || [],
        stages: stagesRes.data || [],
        statuses: statusesRes.data || [],
        commercialStatuses: commercialStatusesRes.data || [],
      });
      setOpportunitiesPendingEnabled(
        Boolean(
          temporaryFeaturesRes.data?.settings?.opportunitiesPendingEnabled,
        ),
      );
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible cargar oportunidades"));
    }
  }

  function buildDefaultOpportunityForm() {
    const defaultSellerUserId = getDefaultSellerUserId();

    return {
      name: "",
      amountUsd: "",
      accountId: "",
      closeDate: "",
      contactId: "",
      salesStageId: findCatalogIdByCode(catalogs.stages, "contacto_inicial"),
      businessLineId: "",
      sellerUserId: defaultSellerUserId,
      presalesUserId: "",
      activationStatusId: findCatalogIdByCode(
        catalogs.statuses,
        canDirectCreateOpportunities
          ? "activada"
          : opportunitiesPendingEnabled && canRequestOpportunities
            ? "pendiente_activacion"
            : "activada",
      ),
    };
  }

  function normalizeOpportunityNameField(value) {
    const normalizedValue = normalizeOpportunityNameValue(value);
    setForm((prev) => {
      if (prev.name === normalizedValue) {
        return prev;
      }

      return { ...prev, name: normalizedValue };
    });
  }

  function isPermittedSellerUserId(value) {
    const sellerUserId = Number(value || 0);
    if (!sellerUserId) {
      return false;
    }

    return catalogs.sellerUsers.some(
      (sellerUser) => Number(sellerUser.id) === sellerUserId,
    );
  }

  function buildDefaultCommercialContext() {
    const defaultStage = catalogs.stages.find(
      (stage) => normalizeText(stage.code) === "contacto_inicial",
    );
    const defaultCommercialStatus = catalogs.commercialStatuses.find(
      (status) => normalizeText(status.code) === "en_proceso",
    );

    return {
      salesStage: defaultStage
        ? {
            id: Number(defaultStage.id),
            code: String(defaultStage.code),
            name: String(defaultStage.name),
            order: Number(defaultStage.stage_order || 0),
          }
        : null,
      currentSalesStage: defaultStage
        ? {
            id: Number(defaultStage.id),
            code: String(defaultStage.code),
            name: String(defaultStage.name),
            order: Number(defaultStage.stage_order || 0),
          }
        : null,
      commercialStatus: defaultCommercialStatus
        ? {
            id: Number(defaultCommercialStatus.id),
            code: String(defaultCommercialStatus.code),
            name: String(defaultCommercialStatus.name),
            closedAt: null,
            closeReason: null,
          }
        : null,
      isSelectedStageCurrent: true,
      stages: defaultStage
        ? catalogs.stages.map((stage) => ({
            id: Number(stage.id),
            code: String(stage.code || ""),
            name: String(stage.name || ""),
            order: Number(stage.stage_order || 0),
            isCurrent: Number(stage.id) === Number(defaultStage.id),
            isSelected: Number(stage.id) === Number(defaultStage.id),
            isPast: false,
            isFuture:
              Number(stage.stage_order || 0) >
              Number(defaultStage.stage_order || 0),
            isClosed: false,
          }))
        : [],
      answers: [],
    };
  }

  function isCommercialOpportunityClosed(statusValue) {
    const normalized = normalizeText(statusValue);
    return (
      normalized === "ganada" ||
      normalized === "perdida" ||
      normalized === "anulada"
    );
  }

  const normalizeCommercialContext = useCallback((data) => {
    if (!data) return null;
    const normalizedSalesStage = data.salesStage
      ? {
          id: Number(data.salesStage.id),
          code: String(data.salesStage.code || ""),
          name: String(data.salesStage.name || ""),
          order: Number(
            data.salesStage.order || data.salesStage.stage_order || 0,
          ),
        }
      : null;
    const normalizedCurrentSalesStage = data.currentSalesStage
      ? {
          id: Number(data.currentSalesStage.id),
          code: String(data.currentSalesStage.code || ""),
          name: String(data.currentSalesStage.name || ""),
          order: Number(
            data.currentSalesStage.order ||
              data.currentSalesStage.stage_order ||
              0,
          ),
        }
      : normalizedSalesStage;
    const normalizedStages = Array.isArray(data.stages)
      ? data.stages.map((stage) => ({
          id: Number(stage.id),
          code: String(stage.code || ""),
          name: String(stage.name || ""),
          order: Number(stage.order || stage.stage_order || 0),
          isCurrent: Boolean(stage.isCurrent),
          isSelected: Boolean(stage.isSelected),
          isPast: Boolean(stage.isPast),
          isFuture: Boolean(stage.isFuture),
          isClosed: Boolean(stage.isClosed),
        }))
      : [];
    const normalizedCommercialStatusCode = normalizeText(
      data.commercialStatus?.code,
    );

    return {
      salesStage: normalizedSalesStage,
      workspace: data.workspace
        ? {
            playbook: data.workspace.playbook || null,
            summary: data.workspace.summary || null,
            stages: Array.isArray(data.workspace.stages)
              ? data.workspace.stages
              : [],
            currentStage: data.workspace.currentStage || null,
            scorecard: data.workspace.scorecard || null,
            recommendedStrategy: data.workspace.recommendedStrategy
              ? {
                  heading: String(
                    data.workspace.recommendedStrategy.heading || "",
                  ),
                  route: String(data.workspace.recommendedStrategy.route || ""),
                  finalObjective: String(
                    data.workspace.recommendedStrategy.finalObjective || "",
                  ),
                  steps: Array.isArray(data.workspace.recommendedStrategy.steps)
                    ? data.workspace.recommendedStrategy.steps.map((step) => ({
                        priorityLabel: String(step.priorityLabel || ""),
                        title: String(step.title || ""),
                        text: String(step.text || ""),
                      }))
                    : [],
                }
              : null,
            themes: Array.isArray(data.workspace.themes)
              ? data.workspace.themes
              : [],
            weaknesses: Array.isArray(data.workspace.weaknesses)
              ? data.workspace.weaknesses
              : [],
            stakeholders: Array.isArray(data.workspace.stakeholders)
              ? data.workspace.stakeholders
              : [],
            actions: Array.isArray(data.workspace.actions)
              ? data.workspace.actions
              : [],
            deliverables: Array.isArray(data.workspace.deliverables)
              ? data.workspace.deliverables
              : [],
            recommendations: data.workspace.recommendations
              ? {
                  actions: Array.isArray(data.workspace.recommendations.actions)
                    ? data.workspace.recommendations.actions
                    : [],
                  deliverables: Array.isArray(
                    data.workspace.recommendations.deliverables,
                  )
                    ? data.workspace.recommendations.deliverables
                    : [],
                  stakeholders: Array.isArray(
                    data.workspace.recommendations.stakeholders,
                  )
                    ? data.workspace.recommendations.stakeholders
                    : [],
                }
              : { actions: [], deliverables: [], stakeholders: [] },
            history: Array.isArray(data.workspace.history)
              ? data.workspace.history
              : [],
          }
        : null,
      currentSalesStage: normalizedCurrentSalesStage,
      features: data.features
        ? {
            documentAnswerSuggestionsEnabled:
              data.features.documentAnswerSuggestionsEnabled !== false,
            rolloutKey: String(data.features.rolloutKey || ""),
            configuredByEnv: data.features.configuredByEnv !== false,
          }
        : {
            documentAnswerSuggestionsEnabled: true,
            rolloutKey: "",
            configuredByEnv: true,
          },
      bypassInfo: data.bypassInfo
        ? {
            isBypassed: Boolean(data.bypassInfo.isBypassed),
            reason: data.bypassInfo.reason || null,
          }
        : {
            isBypassed: false,
            reason: null,
          },
      commercialStatus: data.commercialStatus
        ? {
            id: Number(data.commercialStatus.id),
            code: String(data.commercialStatus.code || ""),
            name: String(data.commercialStatus.name || ""),
            closedAt: data.commercialStatus.closedAt || null,
            closeReason: data.commercialStatus.closeReason || null,
          }
        : null,
      isSelectedStageCurrent:
        data.isSelectedStageCurrent !== undefined
          ? Boolean(data.isSelectedStageCurrent)
          : Number(normalizedSalesStage?.id) ===
            Number(normalizedCurrentSalesStage?.id),
      stages:
        normalizedStages.length > 0
          ? normalizedStages
          : normalizedSalesStage
            ? [
                {
                  ...normalizedSalesStage,
                  isCurrent: true,
                  isSelected: true,
                  isPast: false,
                  isFuture: false,
                  isClosed:
                    normalizedCommercialStatusCode === "ganada" ||
                    normalizedCommercialStatusCode === "perdida" ||
                    normalizedCommercialStatusCode === "anulada",
                },
              ]
            : [],
      answers: Array.isArray(data.answers)
        ? data.answers.map((answer) => ({
            ...answer,
            stage_answer_id: answer.stage_answer_id
              ? Number(answer.stage_answer_id)
              : null,
            question_id: Number(answer.question_id),
            answer_value:
              answer.answer_value === null || answer.answer_value === undefined
                ? ""
                : String(answer.answer_value),
            original_answer_value:
              answer.answer_value === null || answer.answer_value === undefined
                ? ""
                : String(answer.answer_value),
          }))
        : [],
    };
  }, []);

  function buildCommercialContextForDraftStage(
    baseContext,
    { currentStageId, selectedStageId = currentStageId },
  ) {
    if (!baseContext) return null;

    const currentStage =
      baseContext.stages.find(
        (stage) => Number(stage.id) === Number(currentStageId),
      ) ||
      baseContext.currentSalesStage ||
      baseContext.salesStage;
    const selectedStage =
      baseContext.stages.find(
        (stage) => Number(stage.id) === Number(selectedStageId),
      ) ||
      baseContext.salesStage ||
      currentStage;
    const currentOrder = Number(currentStage?.order || 0);

    return {
      ...baseContext,
      salesStage: selectedStage
        ? {
            id: Number(selectedStage.id),
            code: String(selectedStage.code || ""),
            name: String(selectedStage.name || ""),
            order: Number(selectedStage.order || 0),
          }
        : null,
      currentSalesStage: currentStage
        ? {
            id: Number(currentStage.id),
            code: String(currentStage.code || ""),
            name: String(currentStage.name || ""),
            order: Number(currentStage.order || 0),
          }
        : null,
      bypassInfo: baseContext.bypassInfo
        ? {
            isBypassed: Boolean(baseContext.bypassInfo.isBypassed),
            reason: baseContext.bypassInfo.reason || null,
          }
        : {
            isBypassed: false,
            reason: null,
          },
      isSelectedStageCurrent:
        Number(selectedStage?.id) === Number(currentStage?.id),
      stages: (baseContext.stages || []).map((stage) => ({
        ...stage,
        isCurrent: Number(stage.id) === Number(currentStage?.id),
        isSelected: Number(stage.id) === Number(selectedStage?.id),
        isPast: Number(stage.order || 0) < currentOrder,
        isFuture: Number(stage.order || 0) > currentOrder,
      })),
    };
  }

  function formatDateTime(value) {
    if (!value) return "No registrado";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "No registrado";
    return date.toLocaleString("es-ES");
  }

  function formatCloseDate(value) {
    if (!value) return "-";
    const datePart = String(value).split("T")[0];
    const [year, month, day] = datePart.split("-");
    if (!year || !month || !day) return value;
    return `${day.padStart(2, "0")}/${month.padStart(2, "0")}/${year.slice(-2)}`;
  }

  const formatOpportunityAmountInput = useCallback((value) => {
    const rawValue = String(value || "")
      .replace(/,/g, "")
      .replace(/[^\d.]/g, "");
    if (!rawValue) return "";

    const hasDecimal = rawValue.includes(".");
    const [integerPartRaw, ...decimalRest] = rawValue.split(".");
    const decimalPart = decimalRest.join("");
    const integerPartNormalized =
      integerPartRaw.replace(/^0+(?=\d)/, "") || "0";
    const formattedInteger = integerPartNormalized.replace(
      /\B(?=(\d{3})+(?!\d))/g,
      ",",
    );

    if (!hasDecimal) return formattedInteger;
    return `${formattedInteger}.${decimalPart}`;
  }, []);

  function parseOpportunityAmountInput(value) {
    return Number(String(value || "").replace(/,/g, ""));
  }

  function getOpportunityStatusLabel(opportunity) {
    if (
      !opportunitiesPendingEnabled &&
      normalizeText(opportunity.activation_status) === "pendiente de activacion"
    ) {
      return "Desactivada";
    }
    return opportunity.activation_status || "-";
  }

  function getOpportunityCommercialStatusLabel(opportunity) {
    return opportunity.commercial_status || "-";
  }

  function isOpportunityActive(opportunity) {
    return normalizeText(opportunity.activation_status) === "activada";
  }

  function isOpportunityPending(opportunity) {
    return (
      normalizeText(opportunity.activation_status) === "pendiente de activacion"
    );
  }

  function isOpportunityInactive(opportunity) {
    return normalizeText(opportunity.activation_status) === "desactivada";
  }

  function isOpportunityCommercialInProcess(opportunity) {
    const normalized = normalizeText(
      opportunity.commercial_status_code || opportunity.commercial_status,
    );
    return normalized === "en_proceso" || normalized === "en proceso";
  }

  function isOpportunityCommercialWon(opportunity) {
    return (
      normalizeText(
        opportunity.commercial_status_code || opportunity.commercial_status,
      ) === "ganada"
    );
  }

  function getOpportunityStatusBadgeClass(opportunity) {
    if (isOpportunityActive(opportunity)) {
      return "user-status-badge active";
    }
    if (isOpportunityPending(opportunity)) {
      return opportunitiesPendingEnabled
        ? "user-status-badge pending"
        : "user-status-badge inactive";
    }
    return "user-status-badge inactive";
  }

  function getOpportunityStatusIconBadgeClass(statusValue) {
    if (normalizeText(statusValue) === "activada") {
      return "status-icon-badge active";
    }
    if (normalizeText(statusValue) === "pendiente de activacion") {
      return opportunitiesPendingEnabled
        ? "status-icon-badge pending"
        : "status-icon-badge inactive";
    }
    return "status-icon-badge inactive";
  }

  function getCommercialStatusBadgeClass(statusValue) {
    const normalized = normalizeText(statusValue);
    if (normalized === "en_proceso" || normalized === "en proceso") {
      return "user-status-badge pending";
    }
    if (normalized === "ganada") {
      return "user-status-badge won";
    }
    if (normalized === "perdida") {
      return "user-status-badge lost";
    }
    if (normalized === "anulada") {
      return "user-status-badge canceled";
    }
    return "user-status-badge inactive";
  }

  function getCommercialStatusIconBadgeClass(statusValue) {
    const normalized = normalizeText(statusValue);
    if (normalized === "en_proceso" || normalized === "en proceso") {
      return "status-icon-badge pending";
    }
    if (normalized === "ganada") {
      return "status-icon-badge won";
    }
    if (normalized === "perdida") {
      return "status-icon-badge lost";
    }
    if (normalized === "anulada") {
      return "status-icon-badge canceled";
    }
    return "status-icon-badge inactive";
  }

  function resetCommercialDraftState() {
    setCommercialContext(null);
    setCommercialStageViewsById({});
    setCommercialAnswerSuggestionsByStageId({});
    setDraftStageAction(null);
    setSelectedCommercialStageId("");
    setLoadingCommercialStageView(false);
    setCommercialCloseReason("");
    setPendingCommercialCloseAction(null);
    setShowCommercialCloseModal(false);
    setShowCommercialStatusReasonModal(false);
    setCommercialCloseModalState({ statusCode: "", reason: "" });
    setShowStageBypassModal(false);
    setStageBypassReason("");
    setLinkingAnswerSourceId("");
    setAnswerDocumentSelections({});
    setCommercialSuggestionFeedback(null);
  }

  function resetOpportunityDocumentState() {
    setDocumentUploadSession(null);
    setOpportunityDocuments([]);
    setDocumentReview(null);
    setDocumentReviewOverrides(buildDocumentReviewOverrides(null));
    setDocumentReviewApplied(buildDocumentReviewAppliedState());
    setLoadingDocumentSession(false);
    setLoadingOpportunityDocuments(false);
    setUploadingOpportunityDocuments(false);
    setApplyingDocumentSuggestions(false);
    setDeletingOpportunityDocumentId("");
    setLinkingAnswerSourceId("");
    setAnswerDocumentSelections({});
  }

  function hydrateDocumentSessionState(payload) {
    setDocumentUploadSession(payload?.session || null);
    setOpportunityDocuments((prev) =>
      Array.isArray(payload?.documents) ? payload.documents : prev,
    );
    setDocumentReview(payload?.review || null);
    setDocumentReviewOverrides(buildDocumentReviewOverrides(payload?.review));
    setDocumentReviewApplied(buildDocumentReviewAppliedState());
  }

  function setDocumentReviewFieldOverride(field, value) {
    setDocumentReviewApplied((prev) => ({
      ...prev,
      fieldKeys: {
        ...prev.fieldKeys,
        [field]: false,
      },
    }));
    setDocumentReviewOverrides((prev) => ({
      ...prev,
      fieldOverrides: {
        ...prev.fieldOverrides,
        [field]: value,
      },
    }));
  }

  function setDocumentReviewMatchSelection(field, value) {
    setDocumentReviewApplied((prev) => ({
      ...prev,
      matchKeys: {
        ...prev.matchKeys,
        [field]: false,
      },
    }));
    setDocumentReviewOverrides((prev) => ({
      ...prev,
      matchSelections: {
        ...prev.matchSelections,
        [field]: value,
      },
    }));
  }

  function buildOpportunityDocumentApplyPayload({
    selectedFieldKeys,
    selectedMatchKeys,
  } = {}) {
    const { fieldOverrides, matchSelections } = documentReviewOverrides;

    const fieldEntries = Object.entries({
      name: String(fieldOverrides.name || "").trim(),
      amountUsd:
        String(fieldOverrides.amountUsd || "").trim() === ""
          ? null
          : parseOpportunityAmountInput(fieldOverrides.amountUsd),
      closeDate: String(fieldOverrides.closeDate || "").trim(),
    }).filter(([key, value]) => {
      if (
        Array.isArray(selectedFieldKeys) &&
        !selectedFieldKeys.includes(key)
      ) {
        return false;
      }

      if (key === "closeDate") {
        return value !== "";
      }

      if (key === "amountUsd") {
        return value !== null;
      }

      return value !== "";
    });

    const matchEntries = Object.entries(matchSelections)
      .filter(([key]) => {
        if (!Array.isArray(selectedMatchKeys)) {
          return true;
        }
        return selectedMatchKeys.includes(key);
      })
      .filter(([, value]) => String(value || "").trim() !== "")
      .map(([key, value]) => [key, Number(value)]);

    return {
      fieldOverrides: Object.fromEntries(fieldEntries),
      matchSelections: Object.fromEntries(matchEntries),
    };
  }

  async function createOpportunityDocumentSession() {
    setLoadingDocumentSession(true);
    try {
      const { data } = await api.post(
        "/api/opportunities/document-upload-sessions",
        {},
      );
      hydrateDocumentSessionState(data);
      return data?.session || null;
    } catch (err) {
      setError(getDocumentSessionCreationErrorMessage(err));
      return null;
    } finally {
      setLoadingDocumentSession(false);
    }
  }

  async function ensureOpportunityDocumentSession() {
    if (documentUploadSession?.publicId) {
      return documentUploadSession;
    }
    return createOpportunityDocumentSession();
  }

  async function loadExistingOpportunityDocuments(opportunityId) {
    if (!opportunityId) return;
    setLoadingOpportunityDocuments(true);
    try {
      const { data } = await api.get(
        `/api/opportunities/${opportunityId}/documents`,
      );
      setOpportunityDocuments(Array.isArray(data) ? data : []);
      setDocumentReview(null);
      setDocumentUploadSession(null);
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible cargar los documentos de la oportunidad",
        ),
      );
    } finally {
      setLoadingOpportunityDocuments(false);
    }
  }

  async function uploadOpportunityDocuments(nextFiles) {
    const files = Array.from(nextFiles || []);
    if (!files.length) return false;

    setError("");
    setSuccess("");
    setUploadingOpportunityDocuments(true);

    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));

      if (editingOpportunityId) {
        await api.post(
          `/api/opportunities/${editingOpportunityId}/documents`,
          formData,
          {
            headers: { "Content-Type": "multipart/form-data" },
          },
        );
        await loadExistingOpportunityDocuments(editingOpportunityId);
        setSuccess("Documentos vinculados a la oportunidad correctamente");
      } else {
        const session = await ensureOpportunityDocumentSession();
        if (!session?.publicId) return false;
        const { data } = await api.post(
          `/api/opportunities/document-upload-sessions/${session.publicId}/files`,
          formData,
          {
            headers: { "Content-Type": "multipart/form-data" },
          },
        );
        hydrateDocumentSessionState(data);
        setSuccess("Archivos cargados y analizados correctamente");
      }
      return true;
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible cargar los documentos"));
      return false;
    } finally {
      setUploadingOpportunityDocuments(false);
    }
  }

  async function applyOpportunityDocumentSuggestions({
    selectedFieldKeys,
    selectedMatchKeys,
    successMessage,
  } = {}) {
    if (!documentUploadSession?.publicId) return;

    setError("");
    setSuccess("");
    setApplyingDocumentSuggestions(true);

    try {
      const payload = buildOpportunityDocumentApplyPayload({
        selectedFieldKeys,
        selectedMatchKeys,
      });

      if (
        !Object.keys(payload.fieldOverrides).length &&
        !Object.keys(payload.matchSelections).length
      ) {
        setError("No hay una sugerencia valida para aplicar en ese campo.");
        return;
      }

      const { data } = await api.post(
        `/api/opportunities/document-upload-sessions/${documentUploadSession.publicId}/apply-to-draft`,
        payload,
      );
      hydrateDocumentSessionState(data);
      setForm((prev) => ({
        ...prev,
        name:
          shouldApplyDocumentField(
            selectedFieldKeys,
            selectedMatchKeys,
            "name",
          ) &&
          data?.appliedDraft &&
          Object.hasOwn(data.appliedDraft, "name")
            ? data.appliedDraft.name || ""
            : prev.name,
        amountUsd:
          shouldApplyDocumentField(
            selectedFieldKeys,
            selectedMatchKeys,
            "amountUsd",
          ) &&
          data?.appliedDraft &&
          Object.hasOwn(data.appliedDraft, "amountUsd") &&
          data.appliedDraft.amountUsd !== null &&
          data.appliedDraft.amountUsd !== undefined
            ? formatOpportunityAmountInput(String(data.appliedDraft.amountUsd))
            : prev.amountUsd,
        accountId:
          shouldApplyDocumentMatch(
            selectedFieldKeys,
            selectedMatchKeys,
            "accountId",
          ) &&
          data?.appliedDraft &&
          Object.hasOwn(data.appliedDraft, "accountId")
            ? data.appliedDraft.accountId
              ? String(data.appliedDraft.accountId)
              : ""
            : prev.accountId,
        contactId:
          shouldApplyDocumentMatch(
            selectedFieldKeys,
            selectedMatchKeys,
            "contactId",
          ) &&
          data?.appliedDraft &&
          Object.hasOwn(data.appliedDraft, "contactId")
            ? data.appliedDraft.contactId
              ? String(data.appliedDraft.contactId)
              : ""
            : prev.contactId,
        closeDate:
          shouldApplyDocumentField(
            selectedFieldKeys,
            selectedMatchKeys,
            "closeDate",
          ) &&
          data?.appliedDraft &&
          Object.hasOwn(data.appliedDraft, "closeDate")
            ? data.appliedDraft.closeDate || ""
            : prev.closeDate,
        businessLineId:
          shouldApplyDocumentMatch(
            selectedFieldKeys,
            selectedMatchKeys,
            "businessLineId",
          ) &&
          data?.appliedDraft &&
          Object.hasOwn(data.appliedDraft, "businessLineId")
            ? data.appliedDraft.businessLineId
              ? String(data.appliedDraft.businessLineId)
              : ""
            : prev.businessLineId,
        sellerUserId:
          shouldApplyDocumentMatch(
            selectedFieldKeys,
            selectedMatchKeys,
            "sellerUserId",
          ) &&
          data?.appliedDraft &&
          Object.hasOwn(data.appliedDraft, "sellerUserId")
            ? data.appliedDraft.sellerUserId
              ? String(data.appliedDraft.sellerUserId)
              : ""
            : prev.sellerUserId,
        presalesUserId:
          shouldApplyDocumentMatch(
            selectedFieldKeys,
            selectedMatchKeys,
            "presalesUserId",
          ) &&
          data?.appliedDraft &&
          Object.hasOwn(data.appliedDraft, "presalesUserId")
            ? data.appliedDraft.presalesUserId
              ? String(data.appliedDraft.presalesUserId)
              : ""
            : prev.presalesUserId,
      }));
      setDocumentReviewApplied(
        mergeDocumentReviewAppliedState(
          documentReviewApplied,
          selectedFieldKeys,
          selectedMatchKeys,
        ),
      );
      setSuccess(
        successMessage || "Sugerencia documental aplicada al borrador",
      );
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible aplicar las sugerencias documentales",
        ),
      );
    } finally {
      setApplyingDocumentSuggestions(false);
    }
  }

  async function deleteDraftOpportunityDocument(documentPublicId) {
    if (!documentPublicId) return;

    setError("");
    setSuccess("");
    setDeletingOpportunityDocumentId(documentPublicId);

    try {
      if (editingOpportunityId) {
        await api.delete(
          `/api/opportunities/${editingOpportunityId}/documents/${documentPublicId}`,
        );
        await loadExistingOpportunityDocuments(editingOpportunityId);
        setSuccess("Documento eliminado de la oportunidad");
      } else {
        if (!documentUploadSession?.publicId) return;
        const { data } = await api.delete(
          `/api/opportunities/document-upload-sessions/${documentUploadSession.publicId}/files/${documentPublicId}`,
        );
        hydrateDocumentSessionState(data);
        setSuccess("Documento eliminado del borrador");
      }
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible eliminar el documento"));
    } finally {
      setDeletingOpportunityDocumentId("");
    }
  }

  async function downloadOpportunityDocument(documentPublicId, fileName) {
    setError("");
    try {
      const response = await api.get(
        `/api/opportunities/documents/${documentPublicId}/content`,
        { responseType: "blob" },
      );
      const objectUrl = window.URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = fileName || "documento";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible abrir el documento"));
    }
  }

  function setAnswerDocumentSelection(questionId, documentPublicId) {
    setAnswerDocumentSelections((prev) => ({
      ...prev,
      [questionId]: documentPublicId,
    }));
  }

  async function linkOpportunityDocumentToAnswer(questionId) {
    const answer = commercialContext?.answers?.find(
      (item) => Number(item.question_id) === Number(questionId),
    );
    const documentPublicId = answerDocumentSelections[questionId];
    if (!answer?.stage_answer_id || !documentPublicId) {
      setError(
        "Guarda la respuesta y selecciona un documento para vincular evidencia",
      );
      return;
    }

    setError("");
    setSuccess("");
    setLinkingAnswerSourceId(String(questionId));
    try {
      await api.post(
        `/api/opportunities/stage-answer-sources/${answer.stage_answer_id}/documents/${documentPublicId}`,
        { evidenceExcerpt: answer.answer_value || null },
      );
      setSuccess("Documento vinculado como soporte de la respuesta");
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible vincular el documento a la respuesta",
        ),
      );
    } finally {
      setLinkingAnswerSourceId("");
    }
  }

  async function linkOpportunityDocumentToSelectedStage() {
    setError(
      "La vinculacion de documentos a etapa no esta disponible en esta version.",
    );
  }

  function seedCommercialDraftState(baseContext) {
    setCommercialContext(baseContext);
    setCommercialStageViewsById({});
    setCommercialAnswerSuggestionsByStageId({});
    setDraftStageAction(null);
    setSelectedCommercialStageId(
      baseContext?.salesStage?.id ? String(baseContext.salesStage.id) : "",
    );
    setLoadingCommercialStageView(false);
    setCommercialCloseReason("");
    setPendingCommercialCloseAction(null);
    setShowCommercialCloseModal(false);
    setCommercialCloseModalState({ statusCode: "", reason: "" });
    setShowStageBypassModal(false);
    setStageBypassReason("");
    setCommercialSuggestionFeedback(null);
  }

  function closeCommercialSuggestionFeedback() {
    setCommercialSuggestionFeedback(null);
    commercialSuggestionRetryNoticeRef.current = "";
  }

  function showCommercialSuggestionFeedback({
    tone,
    title,
    message,
    canRetry = false,
  }) {
    setCommercialSuggestionFeedback({
      tone,
      title,
      message,
      canRetry,
    });
  }

  function applyCommercialSuggestionResult(stageId, result) {
    const suggestions = Array.isArray(result?.suggestions)
      ? result.suggestions
      : [];
    const stageSuggestions = Object.fromEntries(
      suggestions.map((suggestion) => [
        Number(suggestion.questionId),
        suggestion,
      ]),
    );

    setCommercialAnswerSuggestionsByStageId((prev) => ({
      ...prev,
      [stageId]: stageSuggestions,
    }));

    const proposedCount = Number(result?.summary?.proposedCount || 0);
    const ambiguousCount = Number(result?.summary?.ambiguousCount || 0);
    const insufficientCount = Number(result?.summary?.insufficientCount || 0);
    showCommercialSuggestionFeedback({
      tone: proposedCount ? "success" : "warning",
      title: proposedCount
        ? "Sugerencias generadas"
        : "No hubo sugerencias confiables",
      message: proposedCount
        ? `Se generaron ${proposedCount} propuestas documentales para la etapa seleccionada. ${ambiguousCount} quedaron ambiguas y ${insufficientCount} sin evidencia suficiente.`
        : "No se encontraron respuestas documentales confiables para esta etapa.",
    });
  }

  async function pollCommercialSuggestionJob({
    opportunityId,
    stageId,
    jobId,
    pollingToken,
    pollAfterMs,
  }) {
    const deadline = Date.now() + PROPOSE_ANSWERS_TOTAL_POLL_TIMEOUT_MS;
    let nextDelay = Math.max(
      Number(pollAfterMs || PROPOSE_ANSWERS_JOB_POLL_INTERVAL_MS),
      0,
    );

    while (commercialSuggestionPollingTokenRef.current === pollingToken) {
      if (Date.now() >= deadline) {
        return {
          job: {
            id: jobId,
            status: "timed_out",
          },
          error: {
            code: "poll_timeout",
            message:
              "La generación de sugerencias sigue tardando más de 2 minutos. Puedes reintentar sin cerrar el modal.",
          },
        };
      }

      if (nextDelay > 0) {
        await new Promise((resolve) => {
          window.setTimeout(resolve, nextDelay);
        });
      }

      if (commercialSuggestionPollingTokenRef.current !== pollingToken) {
        return null;
      }

      const { data } = await api.get(
        `/api/opportunities/${opportunityId}/stage-view/${stageId}/propose-answers/jobs/${jobId}`,
        { timeout: PROPOSE_ANSWERS_TIMEOUT_MS },
      );

      if (data?.job?.retry?.isRetryingTimeout) {
        const attemptCount = Number(data?.job?.attemptCount || 0);
        const maxAttempts = Number(data?.job?.retry?.maxAttempts || 0);
        const retryKey = `${jobId}:${attemptCount}:${maxAttempts}`;
        if (commercialSuggestionRetryNoticeRef.current !== retryKey) {
          commercialSuggestionRetryNoticeRef.current = retryKey;
          showCommercialSuggestionFeedback({
            tone: "warning",
            title: "Reintentando análisis IA",
            message:
              maxAttempts > 0
                ? `El análisis tardó más de lo esperado y estamos reintentando automáticamente (${attemptCount}/${maxAttempts}).`
                : "El análisis tardó más de lo esperado y estamos reintentando automáticamente.",
            canRetry: false,
          });
        }
      }

      if (data?.result) {
        return data;
      }

      const jobStatus = String(data?.job?.status || "");
      if (["failed", "stale", "expired"].includes(jobStatus)) {
        return data;
      }

      nextDelay = Math.max(
        Number(data?.job?.pollAfterMs || PROPOSE_ANSWERS_JOB_POLL_INTERVAL_MS),
        0,
      );

      const remainingMs = Math.max(deadline - Date.now(), 0);
      nextDelay = Math.min(nextDelay, remainingMs);
    }

    return null;
  }

  function openCreateOpportunityModal() {
    setError("");
    setSuccess("");
    setEditingOpportunityId(null);
    setEditOpportunityAudit(null);
    resetOpportunityDocumentState();
    const defaultCommercialContext = buildDefaultCommercialContext();
    seedCommercialDraftState(defaultCommercialContext);
    const defaultForm = buildDefaultOpportunityForm();
    defaultForm.salesStageId = findCatalogIdByCode(catalogs.stages, "contacto_inicial");
    setForm(defaultForm);
    setShowOpportunityModal(true);
  }

  const hydrateOpportunityModal = useCallback(
    async (opportunityId) => {
      const [{ data }, { data: commercialData }] = await Promise.all([
        api.get(`/api/opportunities/${opportunityId}`),
        api.get(`/api/opportunities/${opportunityId}/commercial-context`),
      ]);

      await loadExistingOpportunityDocuments(opportunityId);

      setForm({
        name: data.name || "",
        amountUsd:
          data.amount_usd === null || data.amount_usd === undefined
            ? ""
            : formatOpportunityAmountInput(String(data.amount_usd)),
        accountId: String(data.account_id || ""),
        closeDate: data.close_date ? String(data.close_date).slice(0, 10) : "",
        contactId: String(data.contact_id || ""),
        salesStageId: String(data.sales_stage_id || ""),
        businessLineId: String(data.business_line_id || ""),
        sellerUserId: String(data.seller_user_id || ""),
        presalesUserId: data.presales_user_id
          ? String(data.presales_user_id)
          : "",
        activationStatusId: String(data.activation_status_id || ""),
      });
      setEditOpportunityAudit({
        createdByName: data.created_by_name || "",
        createdAt: data.created_at || "",
        updatedByName: data.updated_by_name || "",
        updatedAt: data.updated_at || "",
        activationStatus: data.activation_status || "",
        commercialStatus: data.commercial_status || "",
      });
      const normalizedCommercialContext =
        normalizeCommercialContext(commercialData);
      setCommercialContext(normalizedCommercialContext);
      setDraftStageAction(null);
      setCommercialAnswerSuggestionsByStageId({});
      setCommercialStageViewsById(
        normalizedCommercialContext?.salesStage?.id
          ? {
              [String(normalizedCommercialContext.salesStage.id)]:
                normalizedCommercialContext,
            }
          : {},
      );
      setSelectedCommercialStageId(
        normalizedCommercialContext?.salesStage?.id
          ? String(normalizedCommercialContext.salesStage.id)
          : "",
      );
      setLoadingCommercialStageView(false);
      setCommercialCloseReason(
        normalizedCommercialContext?.commercialStatus?.closeReason || "",
      );
      setPendingCommercialCloseAction(null);
      setShowCommercialCloseModal(false);
      setCommercialCloseModalState({ statusCode: "", reason: "" });
      setShowStageBypassModal(false);
      setStageBypassReason("");
      setCommercialSuggestionFeedback(null);
      setEditingOpportunityId(Number(opportunityId));
      setShowOpportunityModal(true);
    },
    [formatOpportunityAmountInput, normalizeCommercialContext],
  );

  const openEditOpportunityModal = useCallback(
    async (opportunityId) => {
      setError("");
      setSuccess("");
      try {
        await hydrateOpportunityModal(opportunityId);
      } catch (err) {
        setError(
          getApiErrorMessage(err, "No fue posible cargar la oportunidad"),
        );
      }
    },
    [hydrateOpportunityModal],
  );

  useEffect(() => {
    openEditOpportunityModalRef.current = openEditOpportunityModal;
  }, [openEditOpportunityModal]);

  useEffect(() => {
    if (opportunitiesPendingEnabled || opportunityStatusFilter !== "pending") {
      return;
    }
    setOpportunityStatusFilterState("all");
  }, [
    opportunityStatusFilter,
    opportunitiesPendingEnabled,
    setOpportunityStatusFilterState,
  ]);

  function closeOpportunityModal() {
    if (savingOpportunity || savingCommercialAction) return;
    setError("");
    setCommercialSuggestionFeedback(null);
    stageValidationPollingTokenRef.current += 1;
    setShowOpportunityModal(false);
    setEditingOpportunityId(null);
    setEditOpportunityAudit(null);
    setStageValidationResult(null);
    resetCommercialDraftState();
    resetOpportunityDocumentState();
  }

  function closeStageValidationResult() {
    stageValidationPollingTokenRef.current += 1;
    setStageValidationResult(null);
  }

  async function pollCurrentStageValidationJob({
    opportunityId,
    jobId,
    pollingToken,
    pollAfterMs,
  }) {
    const deadline = Date.now() + VALIDATE_STAGE_TOTAL_POLL_TIMEOUT_MS;
    let nextDelay = Math.max(
      Number(pollAfterMs || VALIDATE_STAGE_JOB_POLL_INTERVAL_MS),
      0,
    );

    while (stageValidationPollingTokenRef.current === pollingToken) {
      if (Date.now() >= deadline) {
        return {
          job: {
            id: jobId,
            status: "timed_out",
          },
          error: {
            code: "poll_timeout",
            message:
              "La validación sigue tardando más de 2 minutos. Puedes reintentar sin cerrar el modal.",
          },
        };
      }

      if (nextDelay > 0) {
        await new Promise((resolve) => {
          window.setTimeout(resolve, nextDelay);
        });
      }

      if (stageValidationPollingTokenRef.current !== pollingToken) {
        return null;
      }

      const { data } = await api.get(
        `/api/opportunities/${opportunityId}/validate-current-stage/jobs/${jobId}`,
        { timeout: VALIDATE_STAGE_TIMEOUT_MS },
      );

      if (data?.result) {
        return data;
      }

      const jobStatus = String(data?.job?.status || "");
      if (["failed", "stale", "expired"].includes(jobStatus)) {
        return data;
      }

      nextDelay = Math.max(
        Number(data?.job?.pollAfterMs || VALIDATE_STAGE_JOB_POLL_INTERVAL_MS),
        0,
      );
      const remainingMs = Math.max(deadline - Date.now(), 0);
      nextDelay = Math.min(nextDelay, remainingMs);
    }

    return null;
  }

  const filteredOpportunities = useMemo(
    () =>
      opportunities.filter((opportunity) => {
        if (opportunityStatusFilter === "all") return true;
        if (opportunityStatusFilter === "in_process") {
          return isOpportunityCommercialInProcess(opportunity);
        }
        if (opportunityStatusFilter === "won") {
          return isOpportunityCommercialWon(opportunity);
        }
        if (opportunityStatusFilter === "pending") {
          return (
            opportunitiesPendingEnabled && isOpportunityPending(opportunity)
          );
        }
        if (opportunityStatusFilter === "inactive") {
          return (
            isOpportunityInactive(opportunity) ||
            (!opportunitiesPendingEnabled && isOpportunityPending(opportunity))
          );
        }
        return isOpportunityActive(opportunity);
      }),
    [opportunities, opportunityStatusFilter, opportunitiesPendingEnabled],
  );

  const opportunityStatusCounts = useMemo(
    () =>
      opportunities.reduce(
        (totals, opportunity) => {
          if (isOpportunityCommercialInProcess(opportunity)) {
            totals.inProcess += 1;
          }
          if (isOpportunityCommercialWon(opportunity)) {
            totals.won += 1;
          }
          if (isOpportunityPending(opportunity)) {
            if (opportunitiesPendingEnabled) {
              totals.pending += 1;
            } else {
              totals.inactive += 1;
            }
            return totals;
          }
          if (isOpportunityInactive(opportunity)) {
            totals.inactive += 1;
            return totals;
          }
          totals.active += 1;
          return totals;
        },
        { active: 0, pending: 0, inactive: 0, inProcess: 0, won: 0 },
      ),
    [opportunities, opportunitiesPendingEnabled],
  );

  const totalOpportunitiesCount =
    opportunityStatusCounts.active +
    opportunityStatusCounts.pending +
    opportunityStatusCounts.inactive;

  const sortedOpportunities = useMemo(() => {
    const list = [...filteredOpportunities];

    const readValue = (opportunity) => {
      if (opportunitySortField === "id") return Number(opportunity.id) || 0;
      if (opportunitySortField === "nombre")
        return String(opportunity.name || "");
      if (opportunitySortField === "cuenta") {
        return String(opportunity.account_name || "");
      }
      if (opportunitySortField === "vendedor") {
        return String(opportunity.seller_user_name || "");
      }
      if (opportunitySortField === "preventa") {
        return String(opportunity.presales_user_name || "");
      }
      if (opportunitySortField === "etapa") {
        return String(opportunity.sales_stage || "");
      }
      if (opportunitySortField === "estado_comercial") {
        return String(getOpportunityCommercialStatusLabel(opportunity));
      }
      if (opportunitySortField === "importe") {
        return Number(opportunity.amount_usd) || 0;
      }
      if (opportunitySortField === "cierre") {
        return String(opportunity.close_date || "");
      }
      if (opportunitySortField === "estado") {
        return String(getOpportunityStatusLabel(opportunity));
      }
      return "";
    };

    list.sort((left, right) => {
      const leftValue = readValue(left);
      const rightValue = readValue(right);

      let result = 0;
      if (typeof leftValue === "number" && typeof rightValue === "number") {
        result = leftValue - rightValue;
      } else {
        result = String(leftValue).localeCompare(String(rightValue), "es", {
          numeric: true,
          sensitivity: "base",
        });
      }

      return opportunitySortDirection === "asc" ? result : -result;
    });

    return list;
  }, [filteredOpportunities, opportunitySortField, opportunitySortDirection]);

  const visibleOpportunities = useMemo(() => {
    const query = opportunityQuery.trim().toLowerCase();
    if (!query) return sortedOpportunities;

    return sortedOpportunities.filter((opportunity) => {
      const haystack = [
        opportunity.id,
        opportunity.name,
        opportunity.account_name,
        opportunity.seller_user_name,
        opportunity.contact_name,
        opportunity.sales_stage,
        opportunity.business_line,
        opportunity.presales_user_name,
        opportunity.activation_status,
        opportunity.commercial_status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [sortedOpportunities, opportunityQuery]);

  const totalOpportunityPages = Math.max(
    1,
    Math.ceil(visibleOpportunities.length / opportunitiesPerPage),
  );
  const pagedOpportunities = visibleOpportunities.slice(
    (opportunitiesPage - 1) * opportunitiesPerPage,
    opportunitiesPage * opportunitiesPerPage,
  );

  function toggleOpportunitySort(field) {
    if (opportunitySortField === field) {
      setOpportunitySortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setOpportunitySortField(field);
    setOpportunitySortDirection("asc");
  }

  function getOpportunitySortArrow(field) {
    if (opportunitySortField !== field) return "↕";
    return opportunitySortDirection === "asc" ? "↑" : "↓";
  }

  const currentSalesStageName =
    catalogs.stages.find(
      (stage) => String(stage.id) === String(form.salesStageId),
    )?.name || "";

  const currentCommercialStage =
    commercialContext?.currentSalesStage ||
    commercialContext?.salesStage ||
    null;
  const selectedCommercialStage = commercialContext?.salesStage || null;
  const hasPendingStageChange = Boolean(
    draftStageAction &&
    Number(draftStageAction.fromStageId) !== Number(draftStageAction.toStageId),
  );
  const hasPendingCommercialClose = Boolean(pendingCommercialCloseAction);
  const canRetreatToSelectedStage = Boolean(
    selectedCommercialStage &&
    currentCommercialStage &&
    Number(selectedCommercialStage.order || 0) <
      Number(currentCommercialStage.order || 0),
  );
  const currentCommercialStageIndex = (
    commercialContext?.stages || []
  ).findIndex(
    (stage) => Number(stage.id) === Number(currentCommercialStage?.id),
  );
  const canBypassCurrentStage =
    currentCommercialStageIndex > -1 &&
    currentCommercialStageIndex < (commercialContext?.stages || []).length - 1;
  const hasImmediatePreviousStage =
    normalizeText(currentCommercialStage?.code) !== "contacto_inicial";

  const isSelectedCommercialStageReadOnly =
    Boolean(editingOpportunityId) &&
    Boolean(commercialContext) &&
    !commercialContext.isSelectedStageCurrent;

  const isCommercialFlowClosed = isCommercialOpportunityClosed(
    commercialContext?.commercialStatus?.code,
  );

  const currentCommercialStatusName =
    commercialContext?.commercialStatus?.name ||
    catalogs.commercialStatuses.find(
      (status) => normalizeText(status.code) === "en_proceso",
    )?.name ||
    "En proceso";
  const isHeaderCommercialFlowClosed = isCommercialOpportunityClosed(
    editOpportunityAudit?.commercialStatus,
  );
  const currentCommercialStatusCode =
    commercialContext?.commercialStatus?.code ||
    commercialContext?.commercialStatus?.name ||
    "";
  const displayedCommercialCloseReason =
    pendingCommercialCloseAction?.reason ||
    commercialContext?.commercialStatus?.closeReason ||
    "";
  const canOpenCommercialStatusReason = ["perdida", "anulada"].includes(
    normalizeText(currentCommercialStatusCode),
  );
  const pendingCommercialCloseStatusName = pendingCommercialCloseAction
    ? catalogs.commercialStatuses.find(
        (status) =>
          String(status.code) ===
          String(pendingCommercialCloseAction.statusCode),
      )?.name || pendingCommercialCloseAction.statusCode
    : "";

  function openCommercialStatusReasonModal() {
    if (!canOpenCommercialStatusReason) return;
    setShowCommercialStatusReasonModal(true);
  }

  function closeCommercialStatusReasonModal() {
    setShowCommercialStatusReasonModal(false);
  }

  function updateCommercialAnswer(questionId, nextValue) {
    setCommercialContext((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        answers: prev.answers.map((answer) =>
          Number(answer.question_id) === Number(questionId)
            ? { ...answer, answer_value: nextValue }
            : answer,
        ),
      };
    });
  }

  function clearCommercialAnswerSuggestion(questionId, stageId = null) {
    const targetStageId = String(
      stageId ||
        selectedCommercialStageId ||
        commercialContext?.salesStage?.id ||
        "",
    );
    if (!targetStageId || !questionId) return;

    setCommercialAnswerSuggestionsByStageId((prev) => {
      const stageSuggestions = prev[targetStageId];
      if (!stageSuggestions || !stageSuggestions[questionId]) {
        return prev;
      }

      const nextStageSuggestions = { ...stageSuggestions };
      delete nextStageSuggestions[questionId];

      if (!Object.keys(nextStageSuggestions).length) {
        const nextState = { ...prev };
        delete nextState[targetStageId];
        return nextState;
      }

      return {
        ...prev,
        [targetStageId]: nextStageSuggestions,
      };
    });
  }

  async function analyzeCommercialStageAnswers() {
    const stageId = String(
      selectedCommercialStageId || commercialContext?.salesStage?.id || "",
    );
    if (!editingOpportunityId || !stageId) return;
    if (
      commercialContext?.features?.documentAnswerSuggestionsEnabled === false
    ) {
      setError(
        "Las sugerencias documentales no estan habilitadas en este entorno",
      );
      return;
    }
    if (!commercialContext?.isSelectedStageCurrent) {
      setError(
        "Solo puedes proponer respuestas sobre la etapa actual de la oportunidad",
      );
      return;
    }
    if (isCommercialFlowClosed) {
      setError(
        "No puedes proponer respuestas documentales en una oportunidad cerrada",
      );
      return;
    }
    if (!opportunityDocuments.length) {
      setError(
        "Carga al menos un documento en la oportunidad antes de solicitar propuestas",
      );
      return;
    }

    setError("");
    setSuccess("");
    commercialSuggestionPollingTokenRef.current += 1;
    const pollingToken = commercialSuggestionPollingTokenRef.current;
    setCommercialSuggestionFeedback(null);
    commercialSuggestionRetryNoticeRef.current = "";
    setAnalyzingCommercialSuggestions(true);

    try {
      const { data } = await api.post(
        `/api/opportunities/${editingOpportunityId}/stage-view/${stageId}/propose-answers/jobs`,
        {},
        { timeout: PROPOSE_ANSWERS_TIMEOUT_MS },
      );

      let resolvedData = data;
      if (!resolvedData?.result) {
        const jobId = String(resolvedData?.job?.id || "").trim();
        if (!jobId) {
          throw new Error(
            "No fue posible obtener el identificador del job de sugerencias",
          );
        }

        resolvedData = await pollCommercialSuggestionJob({
          opportunityId: editingOpportunityId,
          stageId,
          jobId,
          pollingToken,
          pollAfterMs: resolvedData?.job?.pollAfterMs,
        });
      }

      if (commercialSuggestionPollingTokenRef.current !== pollingToken) {
        return;
      }

      if (resolvedData?.result) {
        applyCommercialSuggestionResult(stageId, resolvedData.result);
      } else {
        showCommercialSuggestionFeedback({
          tone: "danger",
          title:
            resolvedData?.error?.code === "poll_timeout"
              ? "La generacion sigue en proceso"
              : "No fue posible generar sugerencias",
          message:
            String(resolvedData?.error?.message || "").trim() ||
            "No fue posible analizar los documentos para proponer respuestas",
          canRetry: true,
        });
      }
    } catch (err) {
      if (commercialSuggestionPollingTokenRef.current !== pollingToken) {
        return;
      }
      showCommercialSuggestionFeedback({
        tone: "danger",
        title: "No fue posible generar sugerencias",
        message: getApiErrorMessage(
          err,
          "No fue posible analizar los documentos para proponer respuestas",
        ),
        canRetry: true,
      });
    } finally {
      if (commercialSuggestionPollingTokenRef.current === pollingToken) {
        setAnalyzingCommercialSuggestions(false);
      }
    }
  }

  function applyCommercialAnswerSuggestion(questionId) {
    const stageId = String(
      selectedCommercialStageId || commercialContext?.salesStage?.id || "",
    );
    const suggestion =
      commercialAnswerSuggestionsByStageId?.[stageId]?.[Number(questionId)];
    if (!suggestion || suggestion.status !== "proposed") {
      return;
    }

    const currentAnswer = commercialContext?.answers?.find(
      (answer) => Number(answer.question_id) === Number(questionId),
    );
    const currentValue = String(currentAnswer?.answer_value || "").trim();
    if (
      currentValue &&
      suggestion.proposalKind === "replace_existing" &&
      !window.confirm(
        "Esta pregunta ya tiene una respuesta. ¿Deseas reemplazarla por la sugerencia documental?",
      )
    ) {
      return;
    }

    updateCommercialAnswer(questionId, suggestion.proposedAnswer || "");
    clearCommercialAnswerSuggestion(questionId, stageId);
    setSuccess(
      suggestion.proposalKind === "replace_existing"
        ? "Respuesta reemplazada con la propuesta documental"
        : "Respuesta sugerida aplicada al borrador de la etapa",
    );
  }

  function buildStageAnswersPayload() {
    if (
      !commercialContext?.answers?.length ||
      !commercialContext.isSelectedStageCurrent
    ) {
      return [];
    }
    return commercialContext.answers
      .map((answer) => {
        const nextValue = String(answer.answer_value || "").trim();
        const originalValue = String(answer.original_answer_value || "").trim();
        return {
          questionId: Number(answer.question_id),
          answerValue: nextValue,
          isModified: nextValue !== originalValue,
        };
      })
      .filter((answer) => answer.isModified)
      .map(({ questionId, answerValue }) => ({
        questionId,
        answerValue,
      }));
  }

  async function refreshOpportunityCommercialView() {
    if (!editingOpportunityId) return;
    await hydrateOpportunityModal(editingOpportunityId);
    await load();
  }

  function resolveStageChangeTarget({ mode, targetStageId = null }) {
    const orderedStages = [...(commercialContext?.stages || [])].sort(
      (left, right) => Number(left.order || 0) - Number(right.order || 0),
    );
    const currentStageIndex = orderedStages.findIndex(
      (stage) => Number(stage.id) === Number(currentCommercialStage?.id),
    );
    if (currentStageIndex === -1) {
      setError("No fue posible determinar la etapa actual");
      return { ok: false, targetStage: null };
    }

    const targetStage =
      mode === "advance" || mode === "bypass"
        ? orderedStages[currentStageIndex + 1] || null
        : targetStageId
          ? orderedStages.find(
              (stage) => Number(stage.id) === Number(targetStageId),
            ) || null
          : orderedStages[currentStageIndex - 1] || null;

    if (!targetStage) {
      setError(
        mode === "retreat"
          ? "La oportunidad ya esta en la primera etapa operativa"
          : "La oportunidad ya esta en la ultima etapa operativa",
      );
      return { ok: false, targetStage: null };
    }

    if (
      mode === "retreat" &&
      Number(targetStage.order || 0) >=
        Number(currentCommercialStage?.order || 0)
    ) {
      setError("Selecciona una etapa anterior para regresar la oportunidad");
      return { ok: false, targetStage: null };
    }

    return { ok: true, targetStage };
  }

  async function handleCommercialStageSelect(salesStageId) {
    const nextStageId = String(salesStageId || "");
    if (!editingOpportunityId || !nextStageId) return;
    if (nextStageId === String(commercialContext?.salesStage?.id || "")) {
      setSelectedCommercialStageId(nextStageId);
      return;
    }

    setError("");
    setSuccess("");
    setSelectedCommercialStageId(nextStageId);

    const cachedStageView = commercialStageViewsById[nextStageId];
    const draftCurrentStageId = Number(
      form.salesStageId ||
        commercialContext?.currentSalesStage?.id ||
        nextStageId,
    );
    if (cachedStageView) {
      setCommercialContext(
        buildCommercialContextForDraftStage(cachedStageView, {
          currentStageId: draftCurrentStageId,
          selectedStageId: Number(nextStageId),
        }),
      );
      return;
    }

    setLoadingCommercialStageView(true);
    try {
      const { data } = await api.get(
        `/api/opportunities/${editingOpportunityId}/stage-view/${nextStageId}`,
      );
      const normalizedStageView = normalizeCommercialContext(data);
      setCommercialContext(
        buildCommercialContextForDraftStage(normalizedStageView, {
          currentStageId: draftCurrentStageId,
          selectedStageId: Number(nextStageId),
        }),
      );
      setCommercialStageViewsById((prev) => ({
        ...prev,
        [nextStageId]: normalizedStageView,
      }));
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible cargar la etapa seleccionada"),
      );
      setSelectedCommercialStageId(
        String(commercialContext?.salesStage?.id || ""),
      );
    } finally {
      setLoadingCommercialStageView(false);
    }
  }

  async function previewStageDraftChange({
    mode,
    reason = null,
    targetStageId = null,
  }) {
    const stageResolution = resolveStageChangeTarget({ mode, targetStageId });
    if (!stageResolution.ok) {
      return false;
    }
    const { targetStage } = stageResolution;

    const nextStageId = String(targetStage.id);
    const cachedStageView = commercialStageViewsById[nextStageId];

    setLoadingCommercialStageView(true);
    try {
      const normalizedStageView = cachedStageView
        ? cachedStageView
        : normalizeCommercialContext(
            (
              await api.get(
                `/api/opportunities/${editingOpportunityId}/stage-view/${nextStageId}`,
              )
            ).data,
          );

      if (!cachedStageView) {
        setCommercialStageViewsById((prev) => ({
          ...prev,
          [nextStageId]: normalizedStageView,
        }));
      }

      setForm((prev) => ({
        ...prev,
        salesStageId: nextStageId,
      }));
      setDraftStageAction({
        mode,
        fromStageId: Number(currentCommercialStage?.id),
        toStageId: Number(targetStage.id),
        reason: reason || null,
      });
      setSelectedCommercialStageId(nextStageId);
      setCommercialContext(
        buildCommercialContextForDraftStage(normalizedStageView, {
          currentStageId: Number(targetStage.id),
          selectedStageId: Number(targetStage.id),
        }),
      );
      setSuccess(
        `Cambio de etapa pendiente. Presiona Guardar cambios para grabar ${targetStage.name}.`,
      );
      return true;
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible preparar el cambio de etapa"),
      );
      return false;
    } finally {
      setLoadingCommercialStageView(false);
    }
  }

  async function saveCommercialAnswers({
    silentSuccess = false,
    requireAnswers = true,
  } = {}) {
    if (!editingOpportunityId || !commercialContext) return true;
    if (!commercialContext.isSelectedStageCurrent) {
      setError("Selecciona la etapa actual para editar respuestas");
      return false;
    }
    const answersPayload = buildStageAnswersPayload();
    const hasExistingAnswers = Array.isArray(commercialContext?.answers)
      ? commercialContext.answers.some((answer) =>
          String(answer?.answer_value || "").trim(),
        )
      : false;
    if (!answersPayload.length) {
      if (hasExistingAnswers) {
        return true;
      }
      if (!requireAnswers) {
        return true;
      }
      setError("Debes capturar al menos una respuesta para guardar la etapa");
      return false;
    }

    try {
      await api.post(
        `/api/opportunities/${editingOpportunityId}/stage-answers`,
        {
          answers: answersPayload,
        },
      );
      await refreshOpportunityCommercialView();
      if (!silentSuccess) {
        setSuccess("Respuestas de etapa guardadas");
      }
      return true;
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible guardar las respuestas de etapa",
        ),
      );
      return false;
    }
  }

  async function handleStageTransition(direction) {
    setError("");
    setSuccess("");
    if (hasPendingStageChange) {
      setError(
        "Ya hay un cambio de etapa pendiente. Presiona Guardar cambios o cancela la edición.",
      );
      return;
    }
    if (direction !== "retreat" && !commercialContext?.isSelectedStageCurrent) {
      setError("Selecciona la etapa actual para mover la oportunidad");
      return;
    }
    if (
      direction === "retreat" &&
      !canRetreatToSelectedStage &&
      !hasImmediatePreviousStage
    ) {
      setError("Selecciona una etapa anterior para regresar la oportunidad");
      return;
    }
    setSavingCommercialAction(direction);
    try {
      if (direction === "advance") {
        const saved = await saveCommercialAnswers({ silentSuccess: true });
        if (!saved) return;
      }
      await previewStageDraftChange({
        mode: direction,
        targetStageId:
          direction === "retreat" && canRetreatToSelectedStage
            ? Number(selectedCommercialStage?.id)
            : null,
      });
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible actualizar la etapa comercial"),
      );
    } finally {
      setSavingCommercialAction("");
    }
  }

  async function handleCurrentStageValidation() {
    setError("");
    setSuccess("");
    setStageValidationResult(null);
    if (hasPendingStageChange) {
      setError("Guarda cambios antes de validar la nueva etapa seleccionada.");
      return;
    }
    if (hasPendingCommercialClose) {
      setError("Guarda cambios antes de validar la oportunidad cerrada.");
      return;
    }
    if (!commercialContext?.isSelectedStageCurrent) {
      setError("Selecciona la etapa actual para validarla");
      return;
    }
    setSavingCommercialAction("validate-current-stage");
    stageValidationPollingTokenRef.current += 1;
    const pollingToken = stageValidationPollingTokenRef.current;
    try {
      const saved = await saveCommercialAnswers({
        silentSuccess: true,
        requireAnswers: false,
      });
      if (!saved) return;

      const { data } = await api.post(
        `/api/opportunities/${editingOpportunityId}/validate-current-stage/jobs`,
        {
          note: "",
        },
        { timeout: VALIDATE_STAGE_TIMEOUT_MS },
      );

      let resolvedData = data;
      if (!resolvedData?.result) {
        const jobId = String(resolvedData?.job?.id || "").trim();
        if (!jobId) {
          throw new Error(
            "No fue posible obtener el identificador del job de validacion",
          );
        }

        resolvedData = await pollCurrentStageValidationJob({
          opportunityId: editingOpportunityId,
          jobId,
          pollingToken,
          pollAfterMs: resolvedData?.job?.pollAfterMs,
        });
      }

      if (stageValidationPollingTokenRef.current !== pollingToken) {
        return;
      }

      if (resolvedData?.result) {
        await refreshOpportunityCommercialView();
        const validationDecision = String(
          resolvedData?.result?.validation?.decision || "",
        ).trim();
        const advancedStageName = String(
          resolvedData?.result?.advancedSalesStage?.name || "",
        ).trim();
        setStageValidationResult({
          message:
            resolvedData?.result?.message ||
            `Etapa ${currentCommercialStage?.name || "actual"} validada`,
          feedbackMessage: formatStageValidationFeedback(
            resolvedData?.result?.validation,
            resolvedData?.result?.message ||
              `Etapa ${currentCommercialStage?.name || "actual"} validada`,
          ),
          validation: resolvedData?.result?.validation || null,
          autoAdvanced: Boolean(resolvedData?.result?.autoAdvanced),
          advancedSalesStage: resolvedData?.result?.advancedSalesStage || null,
        });
        if (validationDecision === "not_ready_to_advance") {
          setError(
            "Validacion completada: la etapa no esta lista para avanzar.",
          );
        } else if (validationDecision === "advance_with_caution") {
          setSuccess(
            "Validacion completada: la etapa puede avanzar con reservas.",
          );
        } else if (resolvedData?.result?.autoAdvanced) {
          setSuccess(
            advancedStageName
              ? `Validacion completada: la oportunidad avanzo a ${advancedStageName}.`
              : "Validacion completada: la etapa fue validada y la oportunidad avanzo.",
          );
        } else {
          setSuccess(
            "Validacion completada: la etapa esta lista para avanzar.",
          );
        }
      } else {
        setStageValidationResult({
          tone: "danger",
          title:
            resolvedData?.error?.code === "poll_timeout"
              ? "La validacion sigue en proceso"
              : "No fue posible validar la etapa",
          statusLabel:
            resolvedData?.error?.code === "poll_timeout"
              ? "En proceso"
              : "Error",
          message:
            String(resolvedData?.error?.message || "").trim() ||
            "No fue posible completar la validacion de la etapa actual.",
          feedbackMessage:
            String(resolvedData?.error?.message || "").trim() ||
            "No fue posible completar la validacion de la etapa actual.",
          canRetry: true,
        });
      }
    } catch (err) {
      if (stageValidationPollingTokenRef.current !== pollingToken) {
        return;
      }
      setError(
        getApiErrorMessage(err, "No fue posible validar la etapa actual"),
      );
    } finally {
      if (stageValidationPollingTokenRef.current === pollingToken) {
        setSavingCommercialAction("");
      }
    }
  }

  function retryCurrentStageValidation() {
    return handleCurrentStageValidation();
  }

  async function confirmValidatedStageAdvance() {
    if (!editingOpportunityId || !commercialContext?.isSelectedStageCurrent) {
      return;
    }

    if (!isPermittedSellerUserId(form.sellerUserId)) {
      setError("Selecciona un vendedor elegible comercialmente");
      return;
    }

    setError("");
    setSuccess("");
    setSavingCommercialAction("advance");
    try {
      const saved = await saveCommercialAnswers({
        silentSuccess: true,
        requireAnswers: false,
      });
      if (!saved) return;

      const isWaitingStage =
        String(
          currentCommercialStage?.code || currentCommercialStage?.name || "",
        )
          .trim()
          .toLowerCase() === "waiting";

      if (isWaitingStage) {
        const { data } = await api.post(
          `/api/opportunities/${editingOpportunityId}/commercial-close`,
          { statusCode: "ganada", reason: null },
        );

        setStageValidationResult(null);
        await refreshOpportunityCommercialView();
        setSuccess(data?.message || "Oportunidad marcada como ganada");
        return;
      }

      const stageResolution = resolveStageChangeTarget({ mode: "advance" });
      if (!stageResolution.ok) return;

      const { targetStage } = stageResolution;
      const normalizedOpportunityName = normalizeOpportunityNameValue(
        form.name,
      );
      setForm((prev) =>
        prev.name === normalizedOpportunityName
          ? prev
          : { ...prev, name: normalizedOpportunityName },
      );

      const payload = {
        name: normalizedOpportunityName,
        amountUsd: parseOpportunityAmountInput(form.amountUsd),
        accountId: Number(form.accountId),
        closeDate: form.closeDate,
        contactId: Number(form.contactId),
        salesStageId: Number(targetStage.id),
        businessLineId: Number(form.businessLineId),
        sellerUserId: Number(form.sellerUserId),
        presalesUserId: form.presalesUserId
          ? Number(form.presalesUserId)
          : null,
        activationStatusId: Number(form.activationStatusId),
        stageChangeMode: "advance",
        stageChangeReason: null,
      };

      const { data } = await api.put(
        `/api/opportunities/${editingOpportunityId}`,
        payload,
      );

      setStageValidationResult(null);
      await refreshOpportunityCommercialView();
      setSuccess(data?.message || "Oportunidad actualizada correctamente");
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible confirmar el avance de etapa"),
      );
    } finally {
      setSavingCommercialAction("");
    }
  }

  async function handleStageBypass() {
    setError("");
    setSuccess("");
    if (hasPendingStageChange) {
      setError(
        "Ya hay un cambio de etapa pendiente. Presiona Guardar cambios o cancela la edición.",
      );
      return;
    }
    if (hasPendingCommercialClose) {
      setError(
        "Guarda cambios antes de intentar otra acción del proceso comercial.",
      );
      return;
    }
    if (!commercialContext?.isSelectedStageCurrent) {
      setError("Selecciona la etapa actual para bypasearla");
      return;
    }
    if (!canBypassCurrentStage) {
      setError("La oportunidad ya esta en la ultima etapa operativa");
      return;
    }

    setStageBypassReason("");
    setShowStageBypassModal(true);
  }

  function closeStageBypassModal() {
    if (savingCommercialAction === "stage-bypass") return;
    setShowStageBypassModal(false);
    setStageBypassReason("");
  }

  async function confirmStageBypass() {
    const reason = String(stageBypassReason || "").trim();
    if (!reason) {
      setError("Debes indicar un motivo para bypasear la etapa");
      return;
    }

    setError("");
    setSuccess("");
    setSavingCommercialAction("stage-bypass");
    try {
      await previewStageDraftChange({ mode: "bypass", reason });
      setShowStageBypassModal(false);
      setStageBypassReason("");
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible bypasear la etapa actual"),
      );
    } finally {
      setSavingCommercialAction("");
    }
  }

  async function handleCommercialClose(statusCode) {
    setError("");
    setSuccess("");
    if (hasPendingStageChange) {
      setError("Guarda cambios antes de cerrar comercialmente la oportunidad.");
      return;
    }
    if (!commercialContext?.isSelectedStageCurrent) {
      setError("Selecciona la etapa actual para cerrar comercialmente");
      return;
    }
    if (statusCode === "perdida" || statusCode === "anulada") {
      setCommercialCloseModalState({
        statusCode,
        reason:
          pendingCommercialCloseAction?.statusCode === statusCode
            ? pendingCommercialCloseAction.reason
            : "",
      });
      setShowCommercialCloseModal(true);
      return;
    }
    setSavingCommercialAction(statusCode);
    try {
      const payload = {
        statusCode,
        reason:
          statusCode === "perdida" || statusCode === "anulada"
            ? commercialCloseReason
            : null,
      };
      const { data } = await api.post(
        `/api/opportunities/${editingOpportunityId}/commercial-close`,
        payload,
      );
      await refreshOpportunityCommercialView();
      setSuccess(data?.message || "Cierre comercial actualizado");
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible cerrar comercialmente la oportunidad",
        ),
      );
    } finally {
      setSavingCommercialAction("");
    }
  }

  function closeCommercialCloseModal() {
    if (savingCommercialAction === "commercial-close-draft") return;
    setShowCommercialCloseModal(false);
    setCommercialCloseModalState({ statusCode: "", reason: "" });
  }

  function confirmCommercialCloseDraft() {
    const reason = String(commercialCloseModalState.reason || "").trim();
    if (!reason) {
      setError("Debes indicar un motivo para cerrar la oportunidad");
      return;
    }

    const statusCode = commercialCloseModalState.statusCode;
    const statusName =
      catalogs.commercialStatuses.find(
        (status) => String(status.code) === String(statusCode),
      )?.name || statusCode;

    setError("");
    setSuccess(
      `Cierre comercial pendiente como ${statusName}. Presiona Guardar cambios para grabarlo.`,
    );
    setPendingCommercialCloseAction({ statusCode, reason });
    setCommercialCloseReason(reason);
    setShowCommercialCloseModal(false);
    setCommercialCloseModalState({ statusCode: "", reason: "" });
  }

  async function saveOpportunity(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    const wasEditing = Boolean(editingOpportunityId);
    if (!form.sellerUserId) {
      setError("Selecciona un vendedor");
      return;
    }
    if (!isPermittedSellerUserId(form.sellerUserId)) {
      setError("Selecciona un vendedor elegible comercialmente");
      return;
    }

    setSavingOpportunity(true);
    try {
      const normalizedOpportunityName = normalizeOpportunityNameValue(
        form.name,
      );
      const normalizedAmountUsd = formatOpportunityAmountInput(
        form.amountUsd || "0",
      );
      setForm((prev) =>
        prev.name === normalizedOpportunityName &&
        prev.amountUsd === normalizedAmountUsd
          ? prev
          : {
              ...prev,
              name: normalizedOpportunityName,
              amountUsd: normalizedAmountUsd,
            },
      );

      if (
        editingOpportunityId &&
        commercialContext?.isSelectedStageCurrent &&
        !isCommercialFlowClosed &&
        !hasPendingStageChange &&
        !hasPendingCommercialClose &&
        buildStageAnswersPayload().length
      ) {
        const savedAnswers = await saveCommercialAnswers({
          silentSuccess: true,
        });
        if (!savedAnswers) {
          setSavingOpportunity(false);
          return;
        }
      }

      const payload = {
        name: normalizedOpportunityName,
        amountUsd: parseOpportunityAmountInput(normalizedAmountUsd),
        accountId: Number(form.accountId),
        closeDate: form.closeDate,
        contactId: Number(form.contactId),
        businessLineId: Number(form.businessLineId),
        sellerUserId: Number(form.sellerUserId),
        presalesUserId: form.presalesUserId
          ? Number(form.presalesUserId)
          : null,
        activationStatusId: Number(form.activationStatusId),
      };

      if (!editingOpportunityId) {
        payload.salesStageId = Number(form.salesStageId);
        if (documentUploadSession?.publicId) {
          payload.uploadSessionPublicId = documentUploadSession.publicId;
        }
      } else if (form.salesStageId) {
        payload.salesStageId = Number(form.salesStageId);
      }

      if (editingOpportunityId && hasPendingStageChange) {
        payload.stageChangeMode = draftStageAction.mode;
        payload.stageChangeReason = draftStageAction.reason || null;
      }

      if (editingOpportunityId && hasPendingCommercialClose) {
        payload.commercialStatusCode = pendingCommercialCloseAction.statusCode;
        payload.commercialCloseReason = pendingCommercialCloseAction.reason;
      }

      const { data } = editingOpportunityId
        ? await api.put(`/api/opportunities/${editingOpportunityId}`, payload)
        : await api.post("/api/opportunities", payload);

      setSuccess(
        data?.message ||
          (editingOpportunityId
            ? "Oportunidad actualizada correctamente"
            : "Oportunidad creada correctamente"),
      );
      setShowOpportunityModal(false);
      setEditingOpportunityId(null);
      setEditOpportunityAudit(null);
      setStageValidationResult(null);
      setCommercialContext(null);
      setCommercialStageViewsById({});
      setCommercialAnswerSuggestionsByStageId({});
      setDraftStageAction(null);
      setSelectedCommercialStageId("");
      setCommercialCloseReason("");
      setPendingCommercialCloseAction(null);
      setShowCommercialCloseModal(false);
      setCommercialCloseModalState({ statusCode: "", reason: "" });
      setShowStageBypassModal(false);
      setStageBypassReason("");
      resetOpportunityDocumentState();
      await load();

      if (!wasEditing) {
        setOpportunityStatusFilterState("all");
        setOpportunityQueryState("");
        setOpportunitySortField("id");
        setOpportunitySortDirection("desc");
        setOpportunitiesPage(1);
      }
    } catch (err) {
      const fieldErrors = err?.response?.data?.errors?.fieldErrors;
      if (fieldErrors && typeof fieldErrors === "object") {
        const firstError = Object.entries(fieldErrors).find(
          ([, messages]) => Array.isArray(messages) && messages.length > 0,
        );
        if (firstError) {
          const [fieldName, messages] = firstError;
          setError(`${fieldName}: ${messages[0]}`);
          setSavingOpportunity(false);
          return;
        }
      }
      setError(
        getApiErrorMessage(err, "No fue posible guardar la oportunidad"),
      );
    } finally {
      setSavingOpportunity(false);
    }
  }

  function toggleOpportunityMenu(opportunityId) {
    setOpenOpportunityMenuId((prev) =>
      prev === opportunityId ? null : opportunityId,
    );
  }

  async function runOpportunityAction(action) {
    try {
      await action();
    } finally {
      setOpenOpportunityMenuId(null);
    }
  }

  async function updateOpportunityStatus(opportunity, statusCode) {
    setError("");
    setSuccess("");
    try {
      const { data } = await api.patch(
        `/api/opportunities/${opportunity.id}/status`,
        {
          statusCode,
        },
      );
      setSuccess(data?.message || "Estado de oportunidad actualizado");
      await load();
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible actualizar el estado de la oportunidad",
        ),
      );
    }
  }

  const contactOptions = useMemo(() => {
    if (!form.accountId) return [];
    return catalogs.contacts.filter(
      (contact) => Number(contact.account_id) === Number(form.accountId),
    );
  }, [catalogs.contacts, form.accountId]);

  useEffect(() => {
    if (!error && !success) return;
    const timeoutId = window.setTimeout(() => {
      setError("");
      setSuccess("");
    }, 4000);
    return () => window.clearTimeout(timeoutId);
  }, [error, success]);

  useEffect(() => {
    if (openOpportunityMenuId === null) return undefined;

    function handlePointerDown(event) {
      if (event.target.closest(".opportunities-kebab-wrap")) return;
      setOpenOpportunityMenuId(null);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [openOpportunityMenuId]);

  useEffect(() => {
    let cancelled = false;

    async function initializeOpportunities() {
      try {
        const [
          opportunitiesRes,
          accountsRes,
          contactsRes,
          sellerUsersRes,
          presalesUsersRes,
          businessLinesRes,
          stagesRes,
          statusesRes,
          commercialStatusesRes,
        ] = await Promise.all([
          api.get("/api/opportunities"),
          api.get("/api/catalogs/opportunity-accounts"),
          api.get("/api/catalogs/opportunity-contacts"),
          api.get("/api/catalogs/opportunity-seller-users"),
          api.get("/api/catalogs/opportunity-presales-users"),
          api.get("/api/catalogs/opportunity-business-lines"),
          api.get("/api/catalogs/opportunity-sales-stages"),
          api.get("/api/catalogs/opportunity-activation-statuses"),
          api.get("/api/catalogs/opportunity-commercial-statuses"),
        ]);

        if (cancelled) return;

        setOpportunities(opportunitiesRes.data || []);
        setCatalogs({
          accounts: accountsRes.data || [],
          contacts: contactsRes.data || [],
          sellerUsers: sellerUsersRes.data || [],
          presalesUsers: presalesUsersRes.data || [],
          businessLines: businessLinesRes.data || [],
          stages: stagesRes.data || [],
          statuses: statusesRes.data || [],
          commercialStatuses: commercialStatusesRes.data || [],
        });
      } catch (err) {
        if (!cancelled) {
          setError(
            getApiErrorMessage(err, "No fue posible cargar oportunidades"),
          );
        }
      }
    }

    void initializeOpportunities();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const editId = searchParams.get("edit");
    if (!editId) return;
    let cancelled = false;

    async function syncEditParam() {
      setSearchParams({}, { replace: true });
      if (cancelled) return;
      await openEditOpportunityModalRef.current?.(Number(editId));
    }

    void syncEditParam();

    return () => {
      cancelled = true;
    };
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!showOpportunityModal || editingOpportunityId) {
      return;
    }

    const defaultSellerUserId = getDefaultSellerUserId();
    if (!defaultSellerUserId) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm((prev) => {
      if (prev.sellerUserId) {
        return prev;
      }

      return { ...prev, sellerUserId: defaultSellerUserId };
    });
  }, [
    showOpportunityModal,
    editingOpportunityId,
    catalogs.sellerUsers,
    currentUser,
  ]);

  function setOpportunityStatusFilter(value) {
    setOpportunitiesPage(1);
    setOpportunityStatusFilterState(
      value === "pending" && !opportunitiesPendingEnabled ? "all" : value,
    );
  }

  function setOpportunityQuery(value) {
    setOpportunitiesPage(1);
    setOpportunityQueryState(value);
  }

  function setOpportunitiesPerPage(value) {
    setOpportunitiesPage(1);
    setOpportunitiesPerPageState(value);
  }

  return {
    opportunityStatusFilter,
    setOpportunityStatusFilter,
    opportunityQuery,
    setOpportunityQuery,
    opportunitiesPerPage,
    setOpportunitiesPerPage,
    opportunitiesPage,
    setOpportunitiesPage,
    showOpportunityModal,
    editingOpportunityId,
    editOpportunityAudit,
    selectedCommercialStageId,
    loadingCommercialStageView,
    showCommercialCloseModal,
    showCommercialStatusReasonModal,
    commercialCloseModalState,
    setCommercialCloseModalState,
    showStageBypassModal,
    stageBypassReason,
    setStageBypassReason,
    stageValidationResult,
    openOpportunityMenuId,
    savingOpportunity,
    savingCommercialAction,
    analyzingCommercialSuggestions,
    commercialSuggestionFeedback,
    documentUploadSession,
    opportunityDocuments,
    documentReview,
    documentReviewOverrides,
    documentReviewApplied,
    loadingDocumentSession,
    loadingOpportunityDocuments,
    uploadingOpportunityDocuments,
    applyingDocumentSuggestions,
    deletingOpportunityDocumentId,
    error,
    success,
    opportunitiesPendingEnabled,
    canCreateOrRequestOpportunities,
    canChangeOpportunityActivationStatus,
    sellerFieldReadOnly,
    catalogs,
    form,
    setForm,
    visibleOpportunities,
    pagedOpportunities,
    opportunityStatusCounts,
    totalOpportunitiesCount,
    totalOpportunityPages,
    currentSalesStageName,
    currentCommercialStage,
    hasPendingStageChange,
    hasPendingCommercialClose,
    canRetreatToSelectedStage,
    canBypassCurrentStage,
    hasImmediatePreviousStage,
    isSelectedCommercialStageReadOnly,
    isCommercialFlowClosed,
    currentCommercialStatusName,
    isHeaderCommercialFlowClosed,
    displayedCommercialCloseReason,
    canOpenCommercialStatusReason,
    pendingCommercialCloseStatusName,
    commercialContext,
    contactOptions,
    formatDateTime,
    formatCloseDate,
    formatOpportunityAmountInput,
    getOpportunityStatusLabel,
    getOpportunityCommercialStatusLabel,
    isOpportunityActive,
    isOpportunityPending,
    isOpportunityInactive,
    getOpportunityStatusBadgeClass,
    getOpportunityStatusIconBadgeClass,
    getCommercialStatusBadgeClass,
    getCommercialStatusIconBadgeClass,
    openCreateOpportunityModal,
    openEditOpportunityModal,
    normalizeOpportunityNameField,
    closeOpportunityModal,
    closeStageValidationResult,
    retryCurrentStageValidation,
    toggleOpportunitySort,
    getOpportunitySortArrow,
    openCommercialStatusReasonModal,
    closeCommercialStatusReasonModal,
    closeCommercialSuggestionFeedback,
    updateCommercialAnswer,
    analyzeCommercialStageAnswers,
    applyCommercialAnswerSuggestion,
    refreshOpportunityCommercialView,
    handleCommercialStageSelect,
    handleCurrentStageValidation,
    confirmValidatedStageAdvance,
    handleStageBypass,
    closeStageBypassModal,
    confirmStageBypass,
    handleStageTransition,
    handleCommercialClose,
    closeCommercialCloseModal,
    confirmCommercialCloseDraft,
    saveOpportunity,
    uploadOpportunityDocuments,
    applyOpportunityDocumentSuggestions,
    deleteDraftOpportunityDocument,
    downloadOpportunityDocument,
    setDocumentReviewFieldOverride,
    setDocumentReviewMatchSelection,
    toggleOpportunityMenu,
    runOpportunityAction,
    updateOpportunityStatus,
    answerDocumentSelections,
    linkingStageDocumentId,
    linkingAnswerSourceId,
    setAnswerDocumentSelection,
    linkOpportunityDocumentToSelectedStage,
    linkOpportunityDocumentToAnswer,
    commercialAnswerSuggestionsByStageId,
  };
}


