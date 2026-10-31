import { getCoachReadToolCatalog, inferCoachOpportunityFilters } from "../coach/read-tools.js";
import { executeCoachReadTool } from "../coach/crm-read-tools.js";
import { resolveCoachEntities } from "../coach/entity-resolver.js";
import { buildStageReadiness, isStagePreparationQuestion } from "../coach/stage-readiness.js";
import { getCustomerEvidenceLimits } from "../coach/server-policy.js";
import { matchCoachQueryCase } from "../coach/case-catalog.js";
import { getAuthorizedCoachQuotationContent } from "../coach/quotation-read-service.js";
import {
  getCustomerActivityHistoryRange,
  getCustomerActivityHistoryRangeFromFilters,
} from "./activity-history.js";
import { customerReadQueryKey } from "./customer-chat-evidence.js";
import {
  accountRecord,
  buildCustomerCoachSnapshot,
  normalize,
  opportunityRecords,
  permissionGranted,
  scopeCustomerSnapshot,
} from "./customer-chat-records.js";

export const COACH_READ_TOOL_CATALOG = getCoachReadToolCatalog();

const COACH_READ_TOOL_NAMES = new Set(
  COACH_READ_TOOL_CATALOG.map((tool) => tool.name),
);

export function buildCustomerEvidenceQueryCoverage({
  intentCodes = [],
  channelCatalog = [],
  authorizedToolNames = [],
  readToolResults = [],
  routing = null,
} = {}) {
  const authorizedNames = new Set(authorizedToolNames);
  const readResultsByTool = new Map(
    readToolResults.map((item) => [item.toolName, item]),
  );
  const opportunityScoped =
    routing?.referenceResolution?.targetType === "opportunity" &&
    Number(routing?.serverResolvedEntityIds?.opportunityId || 0) > 0;
  return intentCodes.map((intentCode) => {
    const intentConfiguration = channelCatalog.find(
      (intent) => intent.code === intentCode,
    );
    const intentToolNames = (
      Array.isArray(intentConfiguration?.allowedTools)
        ? intentConfiguration.allowedTools
        : []
    ).filter(
      (toolName) =>
        authorizedNames.has(toolName) &&
        !(
          intentCode === "account_activity_history" &&
          toolName === "getOpportunityActivities" &&
          !opportunityScoped
        ),
    );
    const completedToolNames = intentToolNames.filter((toolName) => {
      const result = readResultsByTool.get(toolName);
      return result && !result.error;
    });
    const failedToolNames = intentToolNames.filter(
      (toolName) => readResultsByTool.get(toolName)?.error,
    );
    const unqueriedToolNames = intentToolNames.filter(
      (toolName) => !readResultsByTool.has(toolName),
    );
    return {
      intentCode,
      authorizedTools: intentToolNames,
      completedTools: completedToolNames,
      failedTools: failedToolNames,
      unqueriedTools: unqueriedToolNames,
      fullyQueried:
        intentToolNames.length > 0 &&
        completedToolNames.length === intentToolNames.length,
    };
  });
}

function customerTools(snapshot) {
  const interactions = snapshot.interactions || [];
  return {
    searchInteractions: ({
      text = "",
      sinceDate = "",
      untilDate = "",
    } = {}) => {
      const normalizedText = normalize(text);
      return interactions.filter(
        (interaction) =>
          (!normalizedText ||
            normalize(`${interaction.title} ${interaction.summary}`).includes(
              normalizedText,
            )) &&
          (!sinceDate ||
            String(interaction.createdAt || interaction.updatedAt || "").slice(
              0,
              10,
            ) >= sinceDate) &&
          (!untilDate ||
            String(interaction.createdAt || interaction.updatedAt || "").slice(
              0,
              10,
            ) <= untilDate),
      );
    },
  };
}

export function executeCustomerReadTool({
  toolName,
  snapshot,
  args = {},
  businessRules = {},
  buildReadiness,
  readOpportunityNotes,
}) {
  if (COACH_READ_TOOL_NAMES.has(toolName)) {
    return executeCoachReadTool({
      toolName,
      snapshot,
      args,
      businessRules,
      buildReadiness,
      readOpportunityNotes,
    });
  }
  const scope = businessRules.scope || {};
  const denied =
    (toolName === "searchAccounts" && scope.accountSearchAllowed === false) ||
    ([
      "searchOpportunities",
      "getOpportunity",
      "getOpportunityQuotation",
    ].includes(toolName) &&
      scope.opportunitySearchAllowed === false) ||
    (toolName === "searchContacts" && scope.contactSearchAllowed === false);
  if (denied) {
    return {
      toolName,
      readOnly: true,
      result: null,
      error: "Herramienta no permitida por la politica del canal.",
    };
  }
  const effectiveArgs =
    toolName === "searchOpportunities"
      ? {
          ...args,
          activeOnly: args.inactiveOnly
            ? false
            : args.activeOnly ||
              (args.applyDefaultFilters !== false &&
                businessRules.filters?.defaultActiveOnly),
          inactiveOnly: args.activeOnly
            ? false
            : args.inactiveOnly ||
              (args.applyDefaultFilters !== false &&
                businessRules.filters?.defaultInactiveOnly),
          openOnly:
            args.openOnly ||
            (args.applyDefaultFilters !== false &&
              businessRules.filters?.defaultOpenOnly),
        }
      : args;
  const tools = customerTools(snapshot);
  const execute = tools[toolName];
  if (!execute) throw new Error(`Read tool no soportada: ${toolName}`);
  return {
    toolName,
    readOnly: true,
    result: execute(effectiveArgs),
  };
}

export async function buildCustomerReadModel({
  user,
  question,
  snapshot,
  availableTools,
  authorizedTools = availableTools,
  conversationHistory = [],
  businessRules = {},
  channelIntentRouting = null,
  channelIntentCatalog = [],
  conversationContext = null,
  executionTrace = null,
  traceParentSpanId = null,
  readQueryBudget = null,
  previouslyQueried = [],
  recordDetail = null,
}) {
  snapshot = scopeCustomerSnapshot(snapshot || {}); // Ensure snapshot is scoped correctly
  const evidenceLimits = getCustomerEvidenceLimits(businessRules);
  const maxReadQueries = readQueryBudget === null ? evidenceLimits.maxReadQueries :
    Math.min(evidenceLimits.maxReadQueries, Math.max(0, readQueryBudget));
  const crmSnapshot = {
    accounts: accountRecord(snapshot),
    coachOpportunities: opportunityRecords(snapshot),
    wonOpportunities: [],
    lostOpportunities: [],
    cancelledOpportunities: [],
    contactMappings: snapshot.contacts || [],
    leads: [],
  };
  const queryCase = matchCoachQueryCase(question);
  const planEntityReferences = Object.values(
    channelIntentRouting?.entities || {},
  ).filter(Boolean);
  const entityResolutionQuestion = [question, ...planEntityReferences].join(
    " ",
  );
  const resolution = resolveCoachEntities(
    crmSnapshot,
    entityResolutionQuestion,
    businessRules,
    { ignoreStageFilters: queryCase?.type === "quotation_query" },
  );
  const inferredOpportunityFilters = inferCoachOpportunityFilters(
    question,
    businessRules,
  );
  const currentPlannedFilters = channelIntentRouting?.filters || {};
  const inheritsConversationFilters = [
    "conversation_history",
    "active_context",
  ].includes(channelIntentRouting?.referenceResolution?.source);
  const plannedFilters = {
    ...(inheritsConversationFilters ? conversationContext?.filters || {} : {}),
    ...currentPlannedFilters,
  };
  const plannedStatus = plannedFilters.opportunityStatus || "unspecified";
  const explicitPlannedStatus = ["open", "historical", "all"].includes(
    plannedStatus,
  );
  const plannedStatusCodes = {
    open: ["en_proceso"],
    historical: ["ganada", "perdida", "anulada"],
  };
  const opportunityFilters = {
    ...inferredOpportunityFilters,
    stageCodes: plannedFilters.stageCode
      ? [plannedFilters.stageCode]
      : inferredOpportunityFilters.stageCodes,
    commercialStatusCodes: explicitPlannedStatus
      ? plannedStatusCodes[plannedStatus] || []
      : inferredOpportunityFilters.commercialStatusCodes,
    activeOnly: explicitPlannedStatus
      ? plannedStatus === "open"
      : inferredOpportunityFilters.activeOnly,
    inactiveOnly: explicitPlannedStatus
      ? false
      : inferredOpportunityFilters.inactiveOnly,
    openOnly: explicitPlannedStatus
      ? plannedStatus === "open"
      : inferredOpportunityFilters.openOnly,
    closeYear: plannedFilters.closeYear || inferredOpportunityFilters.closeYear,
    applyDefaultFilters: !explicitPlannedStatus,
  };
  const scope = businessRules.scope || {};
  const serverResolvedEntityIds =
    channelIntentRouting?.serverResolvedEntityIds || {};
  const scopedOpportunities = [
    ...(snapshot.opportunities || []),
    ...(snapshot.inactiveOpportunities || []),
    ...(snapshot.selectedOpportunity ? [snapshot.selectedOpportunity] : []),
  ];
  const plannedOpportunity = scopedOpportunities.find(
    (item) =>
      Number(item.id) === Number(serverResolvedEntityIds.opportunityId) &&
      Number(item.accountId || snapshot.account?.id) ===
        Number(snapshot.account?.id),
  );
  const hasReferenceResolution = Boolean(
    channelIntentRouting?.referenceResolution,
  );
  const selectedOpportunity = hasReferenceResolution
    ? plannedOpportunity || null
    : resolution.opportunity || snapshot.selectedOpportunity || null;
  const plannedContact = (snapshot.contacts || []).find(
    (item) =>
      Number(item.id) === Number(serverResolvedEntityIds.contactId) &&
      Number(item.accountId || snapshot.account?.id) ===
        Number(snapshot.account?.id),
  );
  const selectedContact =
    plannedContact ||
    (hasReferenceResolution ? null : snapshot.selectedContact || null);
  const plannedLead = (snapshot.interactions || []).find(
    (item) =>
      Number(item.id) === Number(serverResolvedEntityIds.leadId) &&
      Number(item.accountId || snapshot.account?.id) ===
        Number(snapshot.account?.id),
  );
  const selectedLeadId = plannedLead?.id || null;
  const opportunityGuidanceRequested =
    channelIntentRouting?.intent === "opportunity_guidance" ||
    channelIntentRouting?.intents?.includes("opportunity_guidance");
  const toolNames = new Set(availableTools.map((tool) => tool.name));
  const quotationRequested =
    queryCase?.readTool === "getOpportunityQuotation" ||
    channelIntentRouting?.intent === "quotation_query" ||
    channelIntentRouting?.intents?.includes("quotation_query");
  const quotationReadAttempted = Boolean(
    quotationRequested &&
    selectedOpportunity &&
    scope.opportunitySearchAllowed !== false &&
    scope.quotationSearchAllowed !== false &&
    toolNames.has("getOpportunityQuotation") &&
    maxReadQueries > 0,
  );
  const selectedOpportunityQuotation = quotationReadAttempted
      ? await getAuthorizedCoachQuotationContent({
          user,
          opportunityId: selectedOpportunity.id,
        })
      : null;
  const coachSnapshot = buildCustomerCoachSnapshot(
    recordDetail ? {
      ...snapshot,
      permissions: {
        ...snapshot.permissions,
        canReadContacts: snapshot.permissions?.canReadContacts === true &&
          scope.contactSearchAllowed !== false &&
          permissionGranted(user?.permissionSet, "contactos.read"),
      },
    } : snapshot,
    selectedOpportunityQuotation,
  );
  const normalizedQuestion = normalize(question);
  const activityHistoryRange =
    getCustomerActivityHistoryRange(question) ||
    getCustomerActivityHistoryRangeFromFilters(currentPlannedFilters) ||
    (inheritsConversationFilters
      ? getCustomerActivityHistoryRangeFromFilters(conversationContext?.filters)
      : null);
  const routedToolNames = channelIntentRouting
    ? new Set(channelIntentRouting.allowedTools)
    : null;
  const routeAllows = (toolName, legacyCondition = true) =>
    routedToolNames ? routedToolNames.has(toolName) : legacyCondition;
  const readToolResults = [];
  let initialReadQueryCount = quotationReadAttempted ? 1 : 0;
  const skippedAuthorizedTools = [];
  const availableNames = new Set(availableTools.map((tool) => tool.name));
  const previousQueryKeys = new Set(previouslyQueried.map(customerReadQueryKey));
  const pushTool = (toolName, args = {}) => {
    if (!availableNames.has(toolName)) return;
    if (previousQueryKeys.has(customerReadQueryKey({ toolName, queryArgs: args }))) return;
    const quotationAlreadyFetched =
      toolName === "getOpportunityQuotation" &&
      quotationReadAttempted;
    if (
      !quotationAlreadyFetched &&
      initialReadQueryCount >= maxReadQueries
    ) {
      skippedAuthorizedTools.push(toolName);
      return;
    }
    if (!quotationAlreadyFetched) initialReadQueryCount += 1;
    const isCoachTool = COACH_READ_TOOL_NAMES.has(toolName);
    const execute = () =>
      executeCustomerReadTool({
        toolName,
        snapshot: isCoachTool ? coachSnapshot : snapshot,
        args,
        businessRules,
        buildReadiness: (opportunity) =>
          buildStageReadiness(opportunity, { currentUserId: Number(user?.id) }),
      });
    const safeArgs = Object.fromEntries(
      Object.entries(args).filter(([key]) =>
        [
          "accountId",
          "opportunityId",
          "contactId",
          "activeOnly",
          "inactiveOnly",
          "openOnly",
          "stageCodes",
          "commercialStatusCodes",
          "sinceDate",
          "untilDate",
          "closeYear",
          "limit",
        ].includes(key),
      ),
    );
    const result = executionTrace
      ? executionTrace.spanSync(
          {
            from: "B7",
            to: "B8",
            label: `Ejecutar ${toolName}`,
            parentSpanId: traceParentSpanId,
            input: { toolName, args: safeArgs },
          },
          execute,
          (value) => ({
            toolName: value.toolName,
            resultCount: Array.isArray(value.result)
              ? value.result.length
              : value.result == null
                ? 0
                : 1,
            failed: Boolean(value.error),
          }),
        )
      : execute();
    readToolResults.push({ ...result, queryArgs: args });
  };
  if (!recordDetail && routeAllows("searchAccounts")) pushTool("searchAccounts");
  if (
    !recordDetail &&
    routeAllows(
      "searchOpportunities",
      /\b(oportunidad|oportunidades|pipeline|etapa|waiting|negociacion)\b/.test(
        normalizedQuestion,
      ),
    )
  ) {
    pushTool("searchOpportunities", {
      ...opportunityFilters,
      stageCodes: opportunityFilters.stageCodes,
      commercialStatusCodes: opportunityFilters.commercialStatusCodes,
      activeOnly: opportunityFilters.activeOnly,
      inactiveOnly: opportunityFilters.inactiveOnly,
    });
  }
  if (
    routeAllows(
      "searchContacts",
      /\b(contacto|contactos|decisor|eduardo|persona)\b/.test(
        normalizedQuestion,
      ),
    )
  ) {
    if (!recordDetail || (recordDetail.object === "contact" && selectedContact)) {
      pushTool("searchContacts", recordDetail ? {
        accountId: snapshot.account?.id,
        contactId: selectedContact?.id || null,
        includeDetails: true,
      } : {});
    }
  }
  if (
    !recordDetail &&
    routeAllows(
      "searchInteractions",
      opportunityGuidanceRequested ||
        /\b(interaccion|interacciones|actividad|actividades|correo|email|llamada|riesgo)\b/.test(
          normalizedQuestion,
        ),
    )
  ) {
    pushTool("searchInteractions", {
      sinceDate: activityHistoryRange?.startDate || "",
      untilDate: activityHistoryRange?.endDate || "",
    });
  }
  if (
    selectedOpportunity &&
    routeAllows(
      "getOpportunity",
      opportunityGuidanceRequested ||
        /\b(detalle|monto|importe|etapa|oportunidad)\b/.test(
          normalizedQuestion,
        ),
    )
  ) {
    pushTool("getOpportunity", {
      opportunityId: selectedOpportunity.id,
      ...(recordDetail ? { includeDetails: true } : {}),
    });
  }
  if (
    !recordDetail &&
    selectedOpportunity &&
    routeAllows(
      "getOpportunityActivities",
      opportunityGuidanceRequested ||
        /\b(actividad|actividades|siguiente paso|proximo paso)\b/.test(
          normalizedQuestion,
        ),
    )
  ) {
    pushTool("getOpportunityActivities", {
      opportunityId: selectedOpportunity.id,
    });
  }
  if (
    !recordDetail &&
    selectedOpportunity &&
    routeAllows(
      "getOpportunityReadiness",
      opportunityGuidanceRequested || isStagePreparationQuestion(question),
    ) &&
    (opportunityGuidanceRequested || isStagePreparationQuestion(question))
  ) {
    pushTool("getOpportunityReadiness", {
      opportunityId: selectedOpportunity.id,
    });
  }
  if (
    !recordDetail &&
    routeAllows(
      "getSellerPipeline",
      /\b(pipeline|cobertura|riesgo|riesgos|prioridades)\b/.test(
        normalizedQuestion,
      ),
    )
  ) {
    pushTool("getSellerPipeline");
  }
  if (
    !recordDetail &&
    routeAllows(
      "searchLeads",
      /\b(lead|leads|prospecto|prospectos)\b/.test(normalizedQuestion),
    )
  ) {
    pushTool("searchLeads", { accountId: snapshot.account?.id || null });
  }
  if (quotationRequested && selectedOpportunity) {
    pushTool("getOpportunityQuotation", {
      opportunityId: selectedOpportunity.id,
    });
  }
  const modelSnapshot = {
    account: scope.accountSearchAllowed === false ? null : snapshot.account,
    opportunities:
      scope.opportunitySearchAllowed === false
        ? []
        : snapshot.opportunities || [],
    inactiveOpportunities:
      scope.opportunitySearchAllowed === false
        ? []
        : snapshot.inactiveOpportunities || [],
    contacts:
      scope.contactSearchAllowed === false ? [] : snapshot.contacts || [],
    interactions: snapshot.interactions || [],
    opportunityActivities: snapshot.opportunityActivities || [],
    calendarActivities: snapshot.calendarActivities || [],
    accountHealth: snapshot.accountHealth,
    expansionHypotheses: snapshot.expansionHypotheses || [],
    selectedOpportunity:
      scope.opportunitySearchAllowed === false ? null : selectedOpportunity,
    selectedOpportunityQuotation,
    selectedContext: {
      accountId: snapshot.account?.id || null,
      opportunityId:
        scope.opportunitySearchAllowed === false
          ? null
          : selectedOpportunity?.id || null,
      contactId:
        scope.contactSearchAllowed === false
          ? null
          : selectedContact?.id || null,
      leadId: selectedLeadId,
    },
    readToolResults,
    readQueryCount: initialReadQueryCount,
    readQueryLimitReached: skippedAuthorizedTools.length > 0,
    skippedAuthorizedTools,
    channelIntentCatalog,
    channelIntentRouting,
    availableReadTools: availableTools.map((tool) => tool.name),
    authorizedReadTools: authorizedTools.map((tool) => tool.name),
  };
  return {
    baseSnapshot: crmSnapshot,
    effectiveContext: modelSnapshot.selectedContext,
    explicitEntities: resolution,
    questionContextTransition: {
      changed: false,
      context: modelSnapshot.selectedContext,
    },
    scopedSnapshot: modelSnapshot,
    preparationRequested: false,
    selectedOpportunity,
    deterministicStageReadiness: null,
    readToolResults,
    modelSnapshot,
    clarification:
      queryCase?.type === "quotation_query" &&
      !toolNames.has("getOpportunityQuotation")
        ? {
            type: "missing_fields",
            message:
              "No tienes permisos para consultar cotizaciones en esta cuenta.",
            missing: ["Permiso de lectura de cotizaciones"],
            candidates: [],
            originalRequest: question,
            intendedAction: "continue_request",
          }
        : queryCase?.requiresOpportunityContext && !selectedOpportunity
          ? {
              type: "select_opportunity",
              message:
                queryCase.type === "quotation_query"
                  ? "Selecciona una oportunidad para consultar el contenido de su cotización."
                  : "Selecciona una oportunidad para consultar sus actividades y siguientes pasos.",
              missing: ["Oportunidad"],
              candidates:
                queryCase.type === "quotation_query" &&
                scope.opportunitySearchAllowed !== false
                  ? opportunityRecords(snapshot)
                      .slice(0, 20)
                      .map((opportunity) => ({
                        id: Number(opportunity.id),
                        name: opportunity.name || "Oportunidad sin nombre",
                        accountId:
                          Number(
                            opportunity.accountId || snapshot.account?.id || 0,
                          ) || null,
                        opportunityId: Number(opportunity.id),
                        accountName: snapshot.account?.name || null,
                        stageName: opportunity.stageName || null,
                        entityType: "opportunity",
                      }))
                  : [],
              originalRequest: question,
              intendedAction: "continue_request",
            }
          : queryCase?.type === "quotation_query" &&
              selectedOpportunity &&
              !selectedOpportunityQuotation
            ? {
                type: "missing_fields",
                message:
                  "No encontré una cotización accesible para esta oportunidad.",
                missing: ["Cotización vigente y accesible"],
                candidates: [],
                originalRequest: question,
                intendedAction: "continue_request",
              }
            : null,
    conversationHistory,
  };
}
