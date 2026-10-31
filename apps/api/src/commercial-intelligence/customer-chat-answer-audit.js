import { buildCustomerEvidenceFailureResponse } from "./customer-chat-responses.js";
import { summarizeAnswerAuditEvidence } from "./customer-chat-history.js";
import { getDeadlineSignal } from "./customer-chat-records.js";
import { runStructuredTextResearch } from "../structuredWebResearch.js";

export async function auditCustomerAnswer({ payload, deadlineAt, contractComponent, snapshot, turnDiagnostics, user, jobId, state, routing, recordAnswerGeneration, deterministicOperationResponse, conversationHistory, evidenceLoop, publicSources, authorizedEvidence, verifiedEmptyResults, aiResult }) {
  const auditEvidenceSnapshot =
    summarizeAnswerAuditEvidence(authorizedEvidence);
  const answerAuditDiagnostics = {
    schemaName: "customer_account_answer_audit",
    ...(contractComponent ? { temperature: 0 } : {}),
    model: null,
    providerResponseId: null,
    status: "request_pending",
    proposedAnswer: String(aiResult.answer || "").slice(0, 1500),
    unsupportedClaims: [],
    findings: [],
    evidence: auditEvidenceSnapshot,
  };
  turnDiagnostics.answerAudit = answerAuditDiagnostics;
  let answerAudit;
  try {
    answerAudit = await runStructuredTextResearch({
      schemaName: "customer_account_answer_audit",
      ...(contractComponent ? { temperature: 0 } : {}),
      onResponseMetadata: ({ responseId, model } = {}) => {
        answerAuditDiagnostics.providerResponseId = responseId || null;
        answerAuditDiagnostics.model = model || null;
      },
      systemPrompt:
        "Para una actividad futura solicitada por el vendedor, distingue el borrador propuesto de un hecho CRM: audita sus IDs, identidad y relaciones con authorizedEvidence, y su tipo/objetivo con la petición y conversationHistory. Una propuesta editable no demuestra que la llamada esté acordada o guardada; no exijas preferencias o acuerdos previos. La ausencia de fecha/hora debe quedar explícita como dato pendiente, nunca inventada; no permitas propuestas con entidades ambiguas o sin respaldo ni afirmaciones de ejecución. " +
        "Audita cada afirmación factual de la respuesta contra authorizedEvidence y verifiedEmptyResults. conversationHistory y la pregunta no son prueba de hechos CRM. Respeta sourceDomain: crm_internal es evidencia CRM y public_web solo evidencia pública, nunca un hecho CRM. Toda afirmación basada en fuentes públicas debe estar respaldada por un registro public_web con URL y referenciar esa evidencia; marca unsupported si la respuesta presenta una señal pública como dato CRM o si no hay fuente pública concreta. Un verifiedEmptyResult completado con resultCount=0 permite afirmar únicamente que esa consulta no encontró registros en la cuenta/entidad indicada; no permite afirmar una ausencia global ni cubre otros dominios. No infieras datos de una entidad a otra. En una operación crm_operation con proposalOrigin=server_deterministic, la operación estructurada fue preparada por el servidor y es evidencia válida del estado del flujo: puede afirmarse que la propuesta está preparada, requiere confirmación y aún no se ejecutó; no exijas que esos estados aparezcan en el CRM. El valor destino es la solicitud del usuario, no un hecho CRM: comprueba que coincide con la petición y con operations.value. Verifica con authorizedEvidence la identidad de la oportunidad y su valor actual. Para cualquier otro tipo de respuesta, no confíes en operaciones generadas por el modelo como prueba de que una propuesta exista. Marca supported si todas las afirmaciones están respaldadas y las afirmaciones de cero resultados están dentro del alcance de verifiedEmptyResults; marca unsupported si hay contradicción o exceso, e inconclusive si no puedes decidir. Para cada afirmación no respaldada, devuelve en findings la afirmación, el veredicto, el motivo concreto y las referencias a los toolName/registros de authorizedEvidence que revisaste; no inventes referencias. No redactes una respuesta nueva ni autorices operaciones.",
      subject: snapshot.account?.name || "cuenta",
      context: {
        turnComponent: contractComponent,
        question: payload.question,
        channelIntentRouting: routing,
        conversationHistory,
        operationPolicy: payload.operationPolicy || {},
        proposalOrigin: deterministicOperationResponse
          ? "server_deterministic"
          : "model_generated",
        validatedAmountSelection: state.activeConversationContext?.pendingAmountSelection || null,
        proposedAnswer: {
          answer: aiResult.answer,
          evidence: Array.isArray(aiResult.evidence)
            ? aiResult.evidence
            : [],
          inferences: Array.isArray(aiResult.inferences)
            ? aiResult.inferences
            : [],
          recommendedActions: Array.isArray(aiResult.recommendedActions)
            ? aiResult.recommendedActions
            : [],
          operations: Array.isArray(aiResult.operations)
            ? aiResult.operations
            : [],
        },
        authorizedEvidence,
        verifiedEmptyResults,
        evidenceVerification: evidenceLoop.status,
      },
      currentValues: {},
      fields: [
        {
          key: "status",
          type: "enum",
          enum: ["supported", "unsupported", "inconclusive"],
          example: "supported",
        },
        {
          key: "unsupportedClaims",
          type: "array",
          example: [],
          items: { type: "string", example: "Dato no respaldado" },
        },
        {
          key: "findings",
          type: "array",
          example: [],
          items: {
            type: "object",
            fields: [
              { key: "claim", type: "string", example: "Hecho CRM" },
              {
                key: "verdict",
                type: "enum",
                enum: ["supported", "unsupported", "inconclusive"],
                example: "unsupported",
              },
              {
                key: "reason",
                type: "string",
                example: "Motivo concreto",
              },
              {
                key: "evidenceRefs",
                type: "array",
                example: [],
                items: { type: "string", example: "getOpportunity[0]" },
              },
            ],
          },
        },
      ],
      aiUsageContext: {
        userId: Number(user.id),
        featureCode: "commercial_intelligence.account_chat",
        jobType: "account_chat",
        jobId,
      },
      signal: getDeadlineSignal(deadlineAt),
    });
  } catch (error) {
    answerAuditDiagnostics.status = "request_error";
    answerAuditDiagnostics.errorCode = String(
      error?.code || error?.name || "audit_request_failed",
    ).slice(0, 80);
    throw error;
  }
  answerAuditDiagnostics.status = answerAudit?.status || "unavailable";
  turnDiagnostics.serverRules.decisions.push({
    ruleId: "answer-audit", outcome: answerAuditDiagnostics.status,
  });
  answerAuditDiagnostics.unsupportedClaims = Array.isArray(
    answerAudit?.unsupportedClaims,
  )
    ? answerAudit.unsupportedClaims
        .slice(0, 12)
        .map((claim) => String(claim || "").slice(0, 500))
    : [];
  answerAuditDiagnostics.findings = Array.isArray(answerAudit?.findings)
    ? answerAudit.findings.slice(0, 12).map((finding) => ({
        claim: String(finding?.claim || "").slice(0, 500),
        verdict: ["supported", "unsupported", "inconclusive"].includes(
          finding?.verdict,
        )
          ? finding.verdict
          : "inconclusive",
        reason: String(finding?.reason || "").slice(0, 500),
        evidenceRefs: Array.isArray(finding?.evidenceRefs)
          ? finding.evidenceRefs
              .slice(0, 12)
              .map((reference) => String(reference || "").slice(0, 120))
          : [],
      }))
    : [];
  if (answerAudit?.status === "supported")
    return { ...aiResult, publicSources };
  const answerAuditFailureCode =
    answerAudit?.status === "unsupported"
      ? "answer_not_grounded"
      : answerAudit?.status === "inconclusive"
        ? "answer_audit_inconclusive"
        : "answer_audit_unavailable";
  recordAnswerGeneration("answer_audit_rejected", aiResult);
  turnDiagnostics.fallback = {
    used: true,
    reasonCode: answerAuditFailureCode,
  };
  return buildCustomerEvidenceFailureResponse({
    status: "answer_generation_error",
    errorCode: answerAuditFailureCode,
    missingFacts: Array.isArray(answerAudit?.unsupportedClaims)
      ? answerAudit.unsupportedClaims
      : [],
    readToolResults: evidenceLoop.readToolResults,
  });
  
}
