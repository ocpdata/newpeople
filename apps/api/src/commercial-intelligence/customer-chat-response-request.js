import { buildCustomerActivityDraftResponse } from "./activity-draft.js";
import {
  isExplicitCustomerAmountChange,
  buildCustomerIntentResponse,
} from "./customer-chat-intent-response.js";
import {
  buildCustomerDeterministicResponse,
  buildCustomerStageReadinessResponse,
  buildCustomerEvidenceFailureResponse,
  buildCustomerAccountOverviewResponse,
} from "./customer-chat-responses.js";
import {
  buildCustomerPublicResearchEvidence,
  buildCustomerPublicSourceLinks,
} from "./customer-chat-history.js";
import { getCustomerEvidenceLimits } from "../coach/server-policy.js";
import { runCustomerEvidenceLoop } from "./customer-chat-evidence.js";
import { summarizeCoachToolResults } from "../coach/observability.js";
import { opportunityRecords, getDeadlineSignal } from "./customer-chat-records.js";
import { associateCustomerReport } from "./turn-contract-runtime.js";
import { buildCustomerEvidenceQueryCoverage } from "./customer-chat-read-model.js";
import { assessCustomerChatEvidence, fetchCustomerChatAdditionalEvidence } from "./customer-chat-evidence-assessment.js";
import { auditCustomerAnswer } from "./customer-chat-answer-audit.js";
import { generateCustomerAnswer } from "./customer-chat-answer-generation.js";

export async function requestCustomerResponse(turnCtx, {
      payload,
      deadlineAt,
      traceParentSpanId: responseTraceParentSpanId,
    }) {
  const { contractComponent, snapshot, permissions, snapshotQueryMetrics, availableTools, agents, turnBudget, executionTrace, turnDiagnostics, user, jobId, documentReportEvidence, state } = turnCtx;
  const routing = payload.context?.channelIntentRouting;
  const recordAnswerGeneration = (source, result = null) => {
    turnDiagnostics.answerGeneration = {
      source,
      operationKind: routing?.operationKind || null,
      activityDraftAction: routing?.activityDraft?.action || "none",
      responseType: result?.responseType || null,
      operationKinds: Array.isArray(result?.operations)
        ? result.operations
            .map((operation) => operation?.kind)
            .filter(Boolean)
        : [],
    };
  };
  const intentCodes =
    routing?.intents || (routing?.intent ? [routing.intent] : []);
  state.allowOperationsForTurn =
    routing?.mode === "operation" || intentCodes.includes("crm_operation");
  state.sellerReportedStageAnswerQuestionIds = [];
  state.sellerReportedStageAnswerCandidates = [];
  state.sellerReportAssessment = null;
  const initialReadToolResults = Array.isArray(
    payload.context?.readToolResults,
  )
    ? payload.context.readToolResults
    : [];
  if (contractComponent?.category.startsWith("report.")) {
    const result = await associateCustomerReport({
      component: contractComponent, snapshot, routing,
      readToolResults: initialReadToolResults,
      authorizedToolNames: new Set(payload.context?.authorizedReadTools || []),
      user, jobId, signal: getDeadlineSignal(deadlineAt),
      selection: contractComponent.reference,
      queryErrors: snapshotQueryMetrics.filter((metric) => metric.errorCode),
      unqueriedTools: payload.context?.skippedAuthorizedTools || [],
      documentReportEvidence,
    });
    turnDiagnostics.evidence = {
      status: result.responseType === "clarification" ? "report_destination_clarification" :
        result.responseType === "error" ? "report_destination_failed" : "report_destination_validated",
      verifier: "report", rounds: 0,
    };
    recordAnswerGeneration("contract_report", result);
    return result;
  }
  const unqueriedAuthorizedTools = Array.isArray(
    payload.context?.skippedAuthorizedTools,
  )
    ? payload.context.skippedAuthorizedTools
    : [];
  const activityResponse = buildCustomerActivityDraftResponse({
    routing,
    readToolResults: initialReadToolResults,
    snapshot,
    permissions,
    pendingActivity: state.activeConversationContext?.pendingActivity,
    pendingActivityIntent:
      state.activeConversationContext?.pendingActivityIntent,
    selectedOpportunityId: state.activeSelectedOpportunityId,
  });
  if (activityResponse) {
    recordAnswerGeneration(
      "deterministic_activity_draft",
      activityResponse,
    );
    turnDiagnostics.evidence = {
      status: "activity_entities_validated",
      rounds: 0,
      additionalReadQueries: 0,
      missingFactsCount: 0,
    };
    return activityResponse;
  }
  if (routing?.intent === "email_draft") {
    const emailDraftResponse = buildCustomerIntentResponse({
      snapshot: payload.context,
      question: payload.question,
      routing,
      permissions,
      allowedOperationKinds: payload.operationPolicy?.allowedKinds,
      businessRules: state.activeBusinessRules || {},
      pendingAmountSelection:
        state.activeConversationContext?.pendingAmountSelection || null,
    });
    if (emailDraftResponse) {
      recordAnswerGeneration("deterministic_email_draft", emailDraftResponse);
      return emailDraftResponse;
    }
  }
  const snapshotQueryErrors = snapshotQueryMetrics
    .filter((metric) => metric.errorCode)
    .map((metric) => ({ source: metric.source }));
  const explicitAmountChange = (!contractComponent ||
    contractComponent.category === "action.update_fields") &&
    isExplicitCustomerAmountChange(payload.question);
  const deterministicResponse = buildCustomerDeterministicResponse({
    snapshot: payload.context,
    question: payload.question,
    routing: explicitAmountChange
      ? { ...routing, intent: "crm_operation" }
      : routing,
    permissions,
    allowedOperationKinds: payload.operationPolicy?.allowedKinds,
    businessRules: state.activeBusinessRules || {},
    pendingAmountSelection: state.activeConversationContext?.pendingAmountSelection || null,
  });
  const deterministicOperationResponse = explicitAmountChange
    ? deterministicResponse
    : intentCodes.includes("crm_operation") &&
        deterministicResponse?.operations?.length
      ? deterministicResponse
      : null;
  const channelCatalog = Array.isArray(
    payload.context?.channelIntentCatalog,
  )
    ? payload.context.channelIntentCatalog
    : [];
  const enabledIntentCodes = channelCatalog
    .filter((intent) => intent.enabled !== false)
    .map((intent) => intent.code);
  const authorizedToolNames = new Set(
    Array.isArray(payload.context?.authorizedReadTools)
      ? payload.context.authorizedReadTools
      : [],
  );
  const authorizedTools = availableTools.filter((tool) =>
    authorizedToolNames.has(tool.name),
  );
  const publicEvidence = buildCustomerPublicResearchEvidence(agents);
  const buildQueryCoverage = (readResults) =>
    buildCustomerEvidenceQueryCoverage({
      intentCodes: [...new Set([...intentCodes, ...followUpIntents])],
      channelCatalog,
      authorizedToolNames: [...authorizedToolNames],
      readToolResults: readResults,
      routing,
    });
  const conversationHistory = Array.isArray(payload.conversationHistory)
    ? payload.conversationHistory
    : [];
  const turnDeadline =
    Number(deadlineAt) ||
    Date.now() + getCustomerEvidenceLimits(state.activeBusinessRules || {}).maxTurnMs;
  const followUpIntents = new Set();
  const evidenceState = {
    reportInterpretation: null,
  };
  const evidenceCtx = {
    buildQueryCoverage,
    snapshot,
    authorizedToolNames,
    state,
    contractComponent,
    payload,
    conversationHistory,
    routing,
    intentCodes,
    publicEvidence,
    snapshotQueryMetrics,
    unqueriedAuthorizedTools,
    enabledIntentCodes,
    user,
    jobId,
    turnDeadline,
    evidenceState,
    authorizedTools,
    channelCatalog,
    executionTrace,
    followUpIntents,
  };
  const evidenceLoop = await runCustomerEvidenceLoop({
    traceIdPrefix: contractComponent ? `${contractComponent.id}-` : "",
    limits: {
      ...getCustomerEvidenceLimits(state.activeBusinessRules || {}),
      ...(turnBudget ? {
        maxReadQueries: initialReadToolResults.length + turnBudget.remainingReadQueries,
        maxRounds: turnBudget.remainingRounds,
      } : {}),
    },
    initialReadToolResults,
    initialQueryErrors: snapshotQueryErrors,
    unqueriedAuthorizedTools,
    deadlineAt: turnDeadline,
    onTraceEvent: executionTrace?.record,
    traceParentSpanId: responseTraceParentSpanId,
    assessEvidence: (args) => assessCustomerChatEvidence(evidenceCtx, args),
    fetchAdditionalEvidence: (args) => fetchCustomerChatAdditionalEvidence(evidenceCtx, args),
  });
  turnDiagnostics.evidence = {
    status: evidenceLoop.status,
    rounds: evidenceLoop.rounds,
    additionalReadQueries: evidenceLoop.additionalReadQueries,
    missingFactsCount: evidenceLoop.missingFacts.length,
    errorCode: evidenceLoop.errorCode,
    unqueriedAuthorizedTools: evidenceLoop.unqueriedAuthorizedTools,
    additionalToolMetrics: summarizeCoachToolResults(
      evidenceLoop.readToolResults.slice(initialReadToolResults.length),
    ),
    sellerReport: state.sellerReportAssessment,
  };
  if (turnBudget) {
    turnBudget.remainingReadQueries -= evidenceLoop.additionalReadQueries;
    turnBudget.remainingRounds -= evidenceLoop.rounds;
  }
  turnDiagnostics.serverRules.decisions.push({
    ruleId: "read-budget",
    outcome: evidenceLoop.errorCode === "read_query_limit_reached" ? "limited" : "applied",
    readQueries: evidenceLoop.readToolResults.length,
  }, {
    ruleId: "evidence-rounds", outcome: evidenceLoop.status,
    rounds: evidenceLoop.rounds,
  }, {
    ruleId: "turn-deadline", outcome: evidenceLoop.errorCode === "turn_timeout" ? "limited" : "applied",
  });
  const selectedStageAnswerCandidates =
    state.sellerReportedStageAnswerCandidates.filter((candidate) =>
      state.sellerReportedStageAnswerQuestionIds.includes(candidate.questionId),
    );
  const opportunityRead = evidenceLoop.readToolResults.find(
    (item) => item?.toolName === "getOpportunity" && !item.error,
  )?.result;
  const prefillOpportunityId = Number(
    opportunityRead?.id || snapshot.selectedOpportunity?.id || 0,
  );
  const prefillOpportunity = opportunityRecords(snapshot).find(
    (item) => Number(item.id) === prefillOpportunityId,
  );
  const reportEvidenceAvailable =
    ["sufficient", "no_results"].includes(evidenceLoop.status);
  if (!reportEvidenceAvailable && state.sellerReportAssessment?.messageKind === "client_report") {
    state.sellerReportAssessment.outcome = "evidence_unavailable";
  }
  if (
    reportEvidenceAvailable &&
    !state.allowOperationsForTurn &&
    state.sellerReportAssessment?.messageKind === "client_report" &&
    state.sellerReportAssessment.match === "matched" &&
    !state.sellerReportAssessment.rejectedQuestionIds.length &&
    selectedStageAnswerCandidates.length === 1 &&
    prefillOpportunity
  ) {
    state.sellerReportAssessment.outcome = "draft_prepared";
    const appendText = `Reporte del vendedor: ${String(payload.question || "")
      .trim()
      .replace(/\s+/g, " ")}`.slice(0, 4000);
    const questionPrompts = selectedStageAnswerCandidates.map(
      (candidate) => candidate.prompt,
    );
    const stageAnswerPrefillResponse = {
      answer: `Preparé un borrador para agregar tu reporte a ${questionPrompts.length === 1 ? `la pregunta "${questionPrompts[0]}"` : `las preguntas ${questionPrompts.map((prompt) => `"${prompt}"`).join(", ")}`} de la oportunidad "${prefillOpportunity.name}". Se conservarán las respuestas actuales y no se guardará nada hasta que revises y pulses Guardar cambios.`,
      evidence: questionPrompts.map(
        (prompt) => `Pregunta de etapa CRM: ${prompt}`,
      ),
      inferences: [],
      confidence: "medium",
      pendingItems: [],
      recommendedActions: [],
      operations: [],
      responseType: "informational",
      source: "account_intelligence",
      entities: {
        opportunityId: prefillOpportunityId,
      },
      stageAnswerPrefill: {
        opportunityId: prefillOpportunityId,
        questionIds: selectedStageAnswerCandidates.map(
          (candidate) => candidate.questionId,
        ),
        questionPrompts,
        appendText,
      },
    };
    recordAnswerGeneration(
      "seller_reported_stage_answer_prefill",
      stageAnswerPrefillResponse,
    );
    return stageAnswerPrefillResponse;
  }
  if (!state.allowOperationsForTurn && state.sellerReportAssessment?.messageKind === "client_report") {
    const reportedText = String(payload.question || "").trim().replace(/\s+/g, " ").slice(0, 4000);
    const answer = `Conservo el reporte atribuido al cliente: “${reportedText}”. Queda en el historial de este chat, no registrado en el CRM. No lo he verificado de forma independiente ni he guardado cambios. Si quieres incorporarlo a una respuesta de etapa, indica la pregunta correspondiente y prepararé un borrador revisable.`;
    const response = {
      answer,
      evidence: [],
      inferences: [],
      confidence: "medium",
      responseType: "informational",
      operations: [],
      recommendedActions: [],
      pendingItems: [],
      source: "account_intelligence",
    };
    recordAnswerGeneration("seller_reported_statement_acknowledgement", response);
    return response;
  }
  const readinessResponse = buildCustomerStageReadinessResponse({
    question: payload.question,
    readToolResults: evidenceLoop.readToolResults,
  });
  if (readinessResponse) {
    recordAnswerGeneration("deterministic_stage_readiness", readinessResponse);
    return readinessResponse;
  }
  if (!new Set(["sufficient", "no_results"]).has(evidenceLoop.status)) {
    const evidenceFailure = buildCustomerEvidenceFailureResponse({
      ...evidenceLoop,
      failedSources: evidenceLoop.failedSources,
    });
    recordAnswerGeneration("evidence_gate_failure", evidenceFailure);
    return evidenceFailure;
  }
  payload = {
    ...payload,
    context: {
      ...payload.context,
      readToolResults: evidenceLoop.readToolResults,
      evidenceVerification: {
        status: evidenceLoop.status,
        rounds: evidenceLoop.rounds,
        sourceMetrics: snapshotQueryMetrics,
      },
      channelIntentRouting: routing
        ? {
            ...routing,
            intents: [...new Set([...intentCodes, ...followUpIntents])],
          }
        : routing,
    },
  };
  if (intentCodes.length === 1 && intentCodes[0] === "account_overview" &&
      !contractComponent) {
    const accountOverview = buildCustomerAccountOverviewResponse(
      snapshot,
      evidenceLoop.readToolResults,
    );
    if (accountOverview) {
      recordAnswerGeneration(
        "deterministic_account_overview",
        accountOverview,
      );
    }
    return (
      accountOverview ||
      buildCustomerEvidenceFailureResponse({
        status: "insufficient_evidence",
        missingFacts: [
          "datos de oportunidades o contactos consultados para el resumen",
        ],
      })
    );
  }
  const publicSources = buildCustomerPublicSourceLinks(publicEvidence);
  const publicResearchEvidence = publicEvidence
    .filter((finding) => /^https?:\/\//i.test(finding.sourceUrl))
    .map((finding) => ({
      toolName: finding.agentId,
      sourceDomain: "public_web",
      result: {
        title: finding.title,
        summary: finding.summary,
        evidenceText: finding.evidence,
        sourceUrl: finding.sourceUrl,
        confidence: finding.confidence,
        certainty: finding.certainty,
      },
      queryFailed: false,
    }));
  const authorizedEvidence = [
    ...evidenceLoop.readToolResults.map((item) => ({
      toolName: item.toolName,
      sourceDomain: "crm_internal",
      result: item.result,
      queryFailed: Boolean(item.error),
    })),
    ...publicResearchEvidence,
  ];
  const resolvedOpportunityId = Number(
    routing?.serverResolvedEntityIds?.opportunityId || 0,
  );
  const resolvedOpportunity = [
    ...(snapshot.opportunities || []),
    ...(snapshot.inactiveOpportunities || []),
    ...(snapshot.selectedOpportunity ? [snapshot.selectedOpportunity] : []),
  ].find(
    (opportunity) =>
      Number(opportunity.id) === resolvedOpportunityId &&
      Number(opportunity.accountId || snapshot.account?.id) ===
        Number(snapshot.account?.id),
  );
  const verifiedEmptyResults = evidenceLoop.readToolResults
    .filter(
      (item) =>
        item?.toolName &&
        !item.error &&
        Array.isArray(item.result) &&
        item.result.length === 0,
    )
    .map((item) => ({
      toolName: item.toolName,
      scopeName:
        item.toolName === "getOpportunityActivities"
          ? resolvedOpportunity?.name ||
            snapshot.account?.name ||
            "cuenta autorizada"
          : snapshot.account?.name || "cuenta autorizada",
      resultCount: 0,
      completed: true,
      sourceDomain: "crm_internal",
    }));
  const answerEvidenceContext = {
    turnComponent: contractComponent,
    question: payload.question,
    conversationHistory,
    instruction: payload.instruction || "",
    selectedContext: payload.context?.selectedContext || {},
    channelIntentRouting: routing,
    operationPolicy: payload.operationPolicy || {},
    evidenceVerification: evidenceLoop.status,
    authorizedEvidence,
    verifiedEmptyResults,
  };
  const { aiResult } = await generateCustomerAnswer({ deadlineAt, contractComponent, snapshot, user, jobId, deterministicOperationResponse, answerEvidenceContext });
  recordAnswerGeneration(
    deterministicOperationResponse
      ? "deterministic_crm_operation"
      : aiResult
        ? "structured_answer_model"
        : "structured_answer_unavailable",
    aiResult,
  );
  if (aiResult) return await auditCustomerAnswer({ payload, deadlineAt, contractComponent, snapshot, turnDiagnostics, user, jobId, state, routing, recordAnswerGeneration, deterministicOperationResponse, conversationHistory, evidenceLoop, publicSources, authorizedEvidence, verifiedEmptyResults, aiResult });
  turnDiagnostics.fallback = {
    used: true,
    reasonCode: "structured_response_unavailable",
  };
  return buildCustomerEvidenceFailureResponse({
    status: "answer_generation_error",
    errorCode: "answer_generation_unavailable",
    readToolResults: evidenceLoop.readToolResults,
    failedSources: evidenceLoop.failedSources,
  });
}
