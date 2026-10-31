import { readCustomerStages } from "../coach/customer-stage-access.js";
import { readCustomerOutcomes } from "../coach/customer-outcome-access.js";
import { readCustomerSchedule } from "../coach/customer-reschedule-access.js";
import { loadRescheduleTimezone } from "../coach/customer-reschedule-time.js";
import { customerComponentCapability } from "./turn-contract.js";
import { resolveCustomerActivityListOpportunity } from "./activity-draft.js";
import { runConversationEngine } from "../coach/conversation-engine.js";
import { retrieveCustomerChatDocumentKnowledge } from "../documentacion-rag/service.js";
import {
  buildCustomerDocumentKnowledgeQuery,
  shouldRetrieveCustomerDocumentKnowledge,
} from "./customer-chat-document-knowledge.js";
import { buildStageReadiness, isStagePreparationQuestion } from "../coach/stage-readiness.js";
import { customerSingleTargetClarification, getCustomerServerPolicy } from "../coach/server-policy.js";
import { loadCoachBusinessRules } from "../coach/business-rules.js";
import { listCoachAdminRules } from "../coach/admin-rules.js";
import { loadChannelIntentConfigurations } from "../coach/channel-intent-governance.js";
import {
  COACH_READ_TOOL_CATALOG,
  buildCustomerReadModel,
  executeCustomerReadTool,
} from "./customer-chat-read-model.js";
import { buildCustomerPrompt } from "./customer-chat-history.js";
import { normalize } from "./customer-chat-records.js";
import { buildCustomerStatusQuestionResponse } from "./customer-chat-responses.js";
import { getValidatedContinuationReferences } from "./customer-chat-planner-context.js";
import {
  buildCustomerIntentResponse,
  isExplicitCustomerAmountChange,
} from "./customer-chat-intent-response.js";
import { normalizeCustomerResponse } from "./customer-chat-normalizers.js";

import { planCustomerChannelIntent } from "./customer-chat-intent-planning.js";
import { requestCustomerResponse } from "./customer-chat-response-request.js";
import { runCustomerChatContractTurn } from "./customer-chat-contract-turn.js";
export { extractCustomerNoteText, isCustomerActivityClarificationReply } from "./customer-chat-intents.js";
export { buildCustomerQuotationResponse, buildCustomerStageReadinessResponse, buildCustomerFallback, buildCustomerEvidenceFailureResponse } from "./customer-chat-responses.js";
export { buildCustomerQueryPlannerContext } from "./customer-chat-planner-context.js";
export { buildCustomerEvidenceQueryCoverage, buildCustomerReadModel } from "./customer-chat-read-model.js";
export { buildCustomerIntentResponse } from "./customer-chat-intent-response.js";
export { appendCustomerAccountChatHistory } from "./customer-chat-history.js";
export { normalizeCustomerOperations, normalizeCustomerResponse } from "./customer-chat-normalizers.js";

export function createCustomerAccountAdapter({
  user,
  snapshot,
  authoritativeIntent = null,
  contractComponent = null,
  contractMovement = null,
  initialDocumentKnowledge = null,
  dependencyResults = [],
  turnBudget = null,
  referenceMaterial = null,
  documentReportEvidence = null,
  channelIntentConfiguration = null,
  conversationContext = null,
  snapshotQueryMetrics = [],
  loadUpdateRecord = null,
  loadUpdateStates = null,
  loadLinkPair = null,
  loadSchedule = readCustomerSchedule,
  loadScheduleTimezone = loadRescheduleTimezone,
  loadOutcomes = readCustomerOutcomes,
  loadStages = readCustomerStages,
  agents,
  jobId,
  executionTrace = null,
  traceParentSpanId = null,
}) {
  const permissions = user?.permissionSet || new Set();
  const turnDiagnostics = {
    fallback: { used: false, reasonCode: null },
    evidence: null,
    answerAudit: null,
    answerGeneration: null,
    documentKnowledge: { status: "not_requested", snippetsCount: 0 },
    serverRules: { version: null, decisions: [] },
  };
  const loadDocumentKnowledge = async ({
    question,
    routing = null,
    turnContract = null,
    traceParentSpanId: knowledgeTraceParentSpanId = null,
    traceFrom = "B5",
  }) => {
    const effectiveTurnContract = turnContract || (contractComponent
      ? { resolution: "resolved", components: [contractComponent] }
      : null);
    const requested = shouldRetrieveCustomerDocumentKnowledge({
      question,
      routing,
      turnContract: effectiveTurnContract,
    });
    const retrieve = async () => requested
      ? initialDocumentKnowledge || retrieveCustomerChatDocumentKnowledge({
          userId: user?.id,
          prompt: buildCustomerDocumentKnowledgeQuery({
            question,
            routing,
            turnContract: effectiveTurnContract,
            snapshot,
          }),
        })
      : { status: "not_applicable", snippets: [] };
    try {
      state.turnDocumentKnowledge = executionTrace
        ? await executionTrace.span(
            {
              from: traceFrom,
              to: "B12",
              label: "Recuperar conocimiento documental",
              parentSpanId: knowledgeTraceParentSpanId,
              input: {
                requested,
                questionLength: String(question || "").length,
              },
            },
            retrieve,
            (value) => ({
              status: value.status,
              snippetsCount: value.snippets.length,
            }),
          )
        : await retrieve();
    } catch (error) {
      console.error("[account-chat] Document knowledge retrieval failed", {
        jobId,
        errorCode: error?.code || error?.name || "DOCUMENT_KNOWLEDGE_ERROR",
      });
      state.turnDocumentKnowledge = { status: "error", snippets: [] };
    }
    turnDiagnostics.documentKnowledge = {
      status: state.turnDocumentKnowledge.status,
      snippetsCount: state.turnDocumentKnowledge.snippets.length,
    };
    return state.turnDocumentKnowledge;
  };
  const state = {
    turnDocumentKnowledge: { status: "not_requested", snippets: [] },
    activeBusinessRules: null,
    activeConversationContext: conversationContext,
    activeOriginalQuestion: "",
    activeSelectedOpportunityId: null,
    sellerReportedStageAnswerQuestionIds: [],
    sellerReportedStageAnswerCandidates: [],
    sellerReportAssessment: null,
    allowOperationsForTurn: false,
  };
  const availableTools = [
    ...COACH_READ_TOOL_CATALOG,
    {
      name: "searchInteractions",
      requiredPermission: "interacciones.read",
      readOnly: true,
    },
  ];
  const turnCtx = {
    snapshot,
    contractComponent,
    authoritativeIntent,
    turnDiagnostics,
    agents,
    user,
    jobId,
    contractMovement,
    permissions,
    state,
    snapshotQueryMetrics,
    availableTools,
    turnBudget,
    executionTrace,
    documentReportEvidence,
  };
  const dependencies = {
    authoritativeIntent,
    turnDeadlineAt: turnBudget?.deadlineAt,
    canAnswerWithoutBusinessEvidence: () =>
      contractComponent?.category === "report.client_statement" &&
      turnDiagnostics.evidence?.status === "report_destination_validated" ||
      !state.allowOperationsForTurn && state.sellerReportAssessment?.messageKind === "client_report",
    validateServerRequest: ({ question, routing, businessRules, operationPolicy }) => {
      if (contractComponent && !contractComponent.category.startsWith("action.")) return null;
      if (["other_account", "out_of_scope"].includes(routing?.ambiguity?.reason)) return null;
      if (!isExplicitCustomerAmountChange(question) && (
        routing?.mode === "operation" ||
        routing?.intents?.includes("crm_operation") ||
        /\b(?:actualiza|cambia|modifica|ajusta|elimina|borra)\b/i.test(normalize(question))
      )) {
        const multiple = customerSingleTargetClarification(question, routing, businessRules);
        if (multiple) {
          turnDiagnostics.serverRules.decisions.push({ ruleId: multiple.ruleId, outcome: "clarification" });
          return { ...multiple, type: "select_opportunity", candidates: [] };
        }
      }
      if (!isExplicitCustomerAmountChange(question)) return null;
      const response = buildCustomerIntentResponse({
        snapshot, question, routing: { ...routing, intent: "crm_operation" },
        permissions, allowedOperationKinds: operationPolicy.allowedKinds, businessRules,
      });
      if (!response || response.operations?.length) return null;
      const ruleId = response.clarification?.ruleId || "amount-input";
      turnDiagnostics.serverRules.decisions.push({ ruleId, outcome: "clarification" });
      return response.clarification || {
        type: "missing_fields", message: response.answer, candidates: [], ruleId,
      };
    },
    planChannelIntent: (args) => planCustomerChannelIntent(turnCtx, args),
    loadChannelIntentConfigurations: ({ channel }) =>
      channel === "customer_account" && Array.isArray(channelIntentConfiguration)
        ? channelIntentConfiguration
        : loadChannelIntentConfigurations({ channel }),
    loadAdministrativeRules: listCoachAdminRules,
    loadDocumentKnowledge,
    prepareReadModel: async ({
      question,
      availableTools: resolvedTools,
      authorizedTools: permittedTools,
      conversationHistory,
      conversationContext: readConversationContext,
      businessRules,
      channelIntentRouting,
      channelIntentCatalog,
      traceParentSpanId: readModelTraceParentId,
    }) => {
      const model = await buildCustomerReadModel({
        readQueryBudget: turnBudget ? turnBudget.remainingReadQueries : null,
        user,
        question,
        snapshot,
        availableTools: resolvedTools,
        authorizedTools: permittedTools,
        conversationHistory,
        businessRules,
        conversationContext: readConversationContext || state.activeConversationContext,
        channelIntentRouting,
        channelIntentCatalog,
        executionTrace,
        traceParentSpanId: readModelTraceParentId,
      });
      if (turnBudget) turnBudget.remainingReadQueries -= model.readToolResults?.length || 0;
      return model;
    },
    executeReadTool: ({
      toolName,
      snapshot: scopedSnapshot,
      args,
      businessRules,
    }) =>
      executeCustomerReadTool({
        toolName,
        snapshot: scopedSnapshot,
        args,
        businessRules,
      }),
    buildStageReadiness: (opportunity) =>
      buildStageReadiness(opportunity, { currentUserId: Number(user?.id) }),
    isStagePreparationQuestion,
    loadProcessGuide: async () => "",
    buildPrompt: buildCustomerPrompt,
    requestResponse: (args) => requestCustomerResponse(turnCtx, args),
    resolveResponseContext: (_snapshot, context) => ({
      context,
      changed: false,
      conflict: null,
    }),
    normalizeResponse: (result, scopedSnapshot, question, context) => {
      let response = normalizeCustomerResponse(
        result,
        scopedSnapshot,
        question,
        context,
        permissions,
      );
      if (!state.allowOperationsForTurn && response.operations.length) {
        turnDiagnostics.serverRules.decisions.push({
          ruleId: "explicit-operation-intent",
          outcome: "rejected",
          proposed: response.operations.length,
        });
        response = { ...response, operations: [] };
      }
      if (contractComponent) {
        const capability = customerComponentCapability(contractComponent);
        if (capability.verifier === "query") {
          response = { ...response, recommendedActions: [] };
        }
        const operations = response.operations.filter((operation) =>
          capability.verifier === "action" && operation.kind === capability.operationKind);
        if (operations.length !== response.operations.length) {
          turnDiagnostics.serverRules.decisions.push({
            ruleId: "turn-component-purpose", outcome: "rejected",
            proposed: response.operations.length, accepted: operations.length,
          });
          response = {
            ...response, operations, responseType: "error",
            answer: "La propuesta no coincidió con la acción solicitada. No se ejecutó ningún cambio; vuelve a solicitar la operación.",
          };
        }
      }
      const targetsByKind = new Map();
      for (const operation of response.operations) {
        const id = operation.kind === "account_field" ? operation.accountId :
          operation.kind === "contact_field" ? operation.contactId :
          ["opportunity_field", "stage_answer", "activity"].includes(operation.kind)
            ? operation.opportunityId : null;
        if (!id) continue;
        if (!targetsByKind.has(operation.kind)) targetsByKind.set(operation.kind, new Set());
        targetsByKind.get(operation.kind).add(Number(id));
      }
      if ([...targetsByKind.values()].some((ids) => ids.size > 1)) {
        const message = "Solo puedo preparar operaciones para un registro a la vez. ¿Cuál quieres modificar?";
        response = {
          ...response, answer: message, responseType: "clarification",
          operations: [], recommendedActions: [],
          clarification: { type: "missing_fields", message, ruleId: "single-operation-target" },
        };
        turnDiagnostics.serverRules.decisions.push({
          ruleId: "single-operation-target", outcome: "rejected",
        });
      }
      turnDiagnostics.serverRules.decisions.push({
        ruleId: "proposal-contract",
        outcome: response.operations.length < (result.operations?.length || 0) ? "rejected" : "validated",
        proposed: result.operations?.length || 0,
        accepted: response.operations.length,
      });
      return response;
    },
    featureCode: "commercial_intelligence.account_chat",
    getTurnDiagnostics: () => ({
      ...turnDiagnostics,
      snapshotMetrics: snapshotQueryMetrics,
    }),
  };
  return {
    channel: "customer_account",
    getTurnDiagnostics: dependencies.getTurnDiagnostics,
    availableTools,
    permissions,
    channelRules: { accountScoped: true, noSharedCoachSession: true },
    operationPolicy: {
      allowedKinds: [
        "activity",
        "stage_answer",
        "lead_call_outcome",
        "account_field",
        "contact_field",
        "create_contact",
        "opportunity_field",
        "create_opportunity",
        "link_contact_to_opportunity",
        "reschedule_activity",
        "opportunity_note",
      ],
      sourceChannel: "customer_account",
    },
    async runTurn({
      question,
      originalQuestion = "",
      context = {},
      history = [],
      conversationContext: turnConversationContext = null,
      traceParentSpanId: turnTraceParentSpanId = traceParentSpanId,
    }) {
      state.activeOriginalQuestion = String(originalQuestion || question || "");
      state.activeSelectedOpportunityId = Number(context?.opportunityId || 0) || null;
      const statusQuestionResponse = buildCustomerStatusQuestionResponse(
        question,
        snapshot || {},
        permissions,
      );
      if (statusQuestionResponse) return statusQuestionResponse;
      if (authoritativeIntent?.turnContract && !contractComponent) return await runCustomerChatContractTurn({ createAdapter: createCustomerAccountAdapter, question, context, history, turnConversationContext, turnTraceParentSpanId, user, snapshot, authoritativeIntent, contractComponent, referenceMaterial, channelIntentConfiguration, conversationContext, snapshotQueryMetrics, loadUpdateRecord, loadUpdateStates, loadLinkPair, loadSchedule, loadScheduleTimezone, loadOutcomes, loadStages, agents, jobId, executionTrace, permissions, loadDocumentKnowledge, state });
      const businessRules = await loadCoachBusinessRules({
        channel: "customer_account",
        process: "default",
      });
      state.activeBusinessRules = businessRules;
      turnDiagnostics.serverRules.decisions = [];
      turnDiagnostics.serverRules.version = businessRules.serverRulesVersion ?? 0;
      turnDiagnostics.serverRules.policy = getCustomerServerPolicy(businessRules);
      const currentScope = businessRules.scope || {};
      const storedContinuationContext =
        turnConversationContext || conversationContext;
      const listOpportunityId = currentScope.opportunitySearchAllowed !== false &&
        contractComponent && customerComponentCapability(contractComponent).operationKind === "activity" &&
        !context.opportunityId
        ? resolveCustomerActivityListOpportunity({
            question: state.activeOriginalQuestion, conversationContext: storedContinuationContext, snapshot,
          })
        : null;
      const effectiveConversationContext = storedContinuationContext
        ? {
            ...storedContinuationContext,
            opportunityId:
              currentScope.opportunitySearchAllowed === false
                ? null
                : listOpportunityId || storedContinuationContext.opportunityId,
            contactId:
              currentScope.contactSearchAllowed === false
                ? null
                : storedContinuationContext.contactId,
          }
        : null;
      state.activeConversationContext = effectiveConversationContext;
      const effectiveContext = {
        ...context,
        opportunityId:
          currentScope.opportunitySearchAllowed === false
            ? null
            : context.opportunityId || listOpportunityId || null,
        contactId:
          currentScope.contactSearchAllowed === false
            ? null
            : context.contactId,
      };
      const trustedEntityReferences = getValidatedContinuationReferences(
        snapshot,
        effectiveConversationContext,
      );
      const engineInput = {
        question,
        context: {
          ...effectiveContext,
          conversationContext: effectiveConversationContext,
          trustedEntityReferences,
        },
        history,
        user,
        jobId,
        availableTools,
        channelRules: this.channelRules,
        permissions,
        operationPolicy: this.operationPolicy,
        businessRules,
        dependencies,
        executionTrace,
      };
      const runEngine = ({ spanId = turnTraceParentSpanId } = {}) =>
        runConversationEngine({
          ...engineInput,
          traceParentSpanId: spanId,
        });
      return executionTrace
        ? executionTrace.span(
            {
              from: "B4",
              to: "B5",
              label: "Ejecutar motor conversacional",
              parentSpanId: turnTraceParentSpanId,
              input: {
                channel: "customer_account",
                questionLength: String(question || "").length,
                historyMessageCount: history.length,
                accountId: effectiveContext.accountId || null,
                toolCount: availableTools.length,
                conversationContext: {
                  accountId: effectiveConversationContext?.accountId || null,
                  opportunityId:
                    effectiveConversationContext?.opportunityId || null,
                  contactId: effectiveConversationContext?.contactId || null,
                  intents: effectiveConversationContext?.intents || [],
                  filterNames: Object.keys(
                    effectiveConversationContext?.filters || {},
                  ),
                },
                policy: {
                  serverRulesVersion: businessRules.serverRulesVersion ?? 0,
                  serverPolicy: businessRules.serverPolicy,
                  channelRules: this.channelRules,
                  businessScope: Object.fromEntries(
                    Object.entries(currentScope).filter(
                      ([, value]) => typeof value === "boolean",
                    ),
                  ),
                  operationKinds: this.operationPolicy.allowedKinds,
                  availableTools: availableTools.map((tool) => tool.name),
                },
              },
            },
            runEngine,
            (value) => ({
              responseType: value.response?.responseType || null,
              answerLength: String(value.response?.answer || "").length,
              toolCount: value.qualityTrace?.toolsUsed?.length || 0,
            }),
          )
        : runEngine();
    },
  };
}
