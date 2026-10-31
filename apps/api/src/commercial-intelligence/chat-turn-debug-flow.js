import { diagnosticCheck } from "./service-helpers.js";
import { getCustomerSnapshotQueryMetrics } from "./customer-snapshot.js";

function debugBlockB1({ request }) {
  return {
    block: "B1",
    label: "Chat web",
    status: "completed",
    input: {
      accountId: Number(request.accountId || 0) || null,
      question: request.question,
    },
    output: { forwardedToApi: true },
    checks: [
      diagnosticCheck({
        field: "question",
        state: String(request.question || "").trim()
          ? "pass"
          : "error",
        expected: "pregunta no vacía",
        actual: String(request.question || "").length,
        message: String(request.question || "").trim()
          ? "La pregunta llegó al flujo."
          : "No llegó una pregunta para procesar.",
      }),
    ],
  };
}

function debugBlockB2({ jobId, request }) {
  return {
    block: "B2",
    label: "Rutas de sesión y jobs",
    status: "completed",
    input: {
      chatSessionId: Number(request.chatSessionId || 0) || null,
      questionLength: String(request.question || "").length,
    },
    output: {
      jobId: Number(jobId),
      initialStatus: "pending",
      accepted: true,
    },
    checks: [
      diagnosticCheck({
        field: "jobId",
        state: Number(jobId) > 0 ? "pass" : "error",
        expected: "ID positivo",
        actual: Number(jobId) || null,
        message:
          Number(jobId) > 0
            ? "El job tiene un ID válido."
            : "No se creó un ID válido para el job.",
      }),
      diagnosticCheck({
        field: "chatSessionId",
        state: Number(request.chatSessionId) > 0 ? "pass" : "error",
        expected: "ID positivo después de crear o recuperar sesión",
        actual: Number(request.chatSessionId) || null,
        message:
          Number(request.chatSessionId) > 0
            ? "El job está asociado a una sesión."
            : "El job debería estar asociado a una sesión.",
      }),
      diagnosticCheck({
        field: "jobAccepted",
        state: Number(jobId) > 0 ? "pass" : "error",
        expected: "job aceptado para procesamiento",
        actual: Number(jobId) > 0 ? true : null,
        message:
          Number(jobId) > 0
            ? "B2 aceptó el job; pending es el estado inicial esperado mientras B1 consulta el resultado."
            : "B2 no confirmó la creación del job.",
      }),
    ],
  };
}

function debugBlockB3({ agentMetrics, conversationHistory, job, snapshot }) {
  return {
    block: "B3",
    label: "Servicio del canal",
    status: "completed",
    input: { accountId: Number(job.account_id || 0) || null },
    output: {
      validatedContext: {
        accountId: snapshot.account?.id || null,
        opportunityId: snapshot.selectedOpportunity?.id || null,
        contactId: snapshot.selectedContact?.id || null,
      },
      historyMessageCount: conversationHistory.length,
      snapshotMetrics: getCustomerSnapshotQueryMetrics(snapshot),
      agentMetrics,
    },
    checks: [
      diagnosticCheck({
        field: "accountId",
        state:
          Number(snapshot.account?.id || 0) > 0 &&
          Number(snapshot.account?.id) === Number(job.account_id)
            ? "pass"
            : "error",
        expected: "ID positivo que coincide con la cuenta del job",
        actual: snapshot.account?.id || null,
        message:
          Number(snapshot.account?.id || 0) > 0 &&
          Number(snapshot.account?.id) === Number(job.account_id)
            ? "La cuenta del snapshot coincide con la cuenta autorizada del job."
            : "La cuenta del snapshot falta o no coincide con el job.",
      }),
      ...["opportunityId", "contactId"].map((field) => {
        const value =
          field === "opportunityId"
            ? snapshot.selectedOpportunity?.id
            : snapshot.selectedContact?.id;
        return diagnosticCheck({
          field,
          state: value ? "pass" : "not_applicable",
          expected: "ID si el turno seleccionó esa entidad",
          actual: value || null,
          message: value
            ? "Hay una entidad seleccionada para el contexto."
            : "No se seleccionó esta entidad; null es válido para una consulta a nivel de cuenta.",
        });
      }),
    ],
  };
}

function debugBlockB4({ adapter, agentMetrics, engineInputSummary, job, snapshot }) {
  return {
    block: "B4",
    label: "Adaptador del canal",
    status: "completed",
    input: {
      channel: adapter.channel,
      context: {
        accountId: snapshot.account?.id || null,
        opportunityId:
          Number(job.opportunity_id || 0) ||
          snapshot.selectedOpportunity?.id ||
          null,
        contactId:
          Number(job.contact_id || 0) ||
          snapshot.selectedContact?.id ||
          null,
      },
      snapshotMetrics: getCustomerSnapshotQueryMetrics(snapshot),
      preparedAgentCount: agentMetrics.length,
    },
    output: { engineInput: engineInputSummary },
    checks: [
      diagnosticCheck({
        field: "channel",
        state:
          adapter.channel === "customer_account" ? "pass" : "error",
        expected: "customer_account",
        actual: adapter.channel,
        message:
          adapter.channel === "customer_account"
            ? "El adaptador corresponde a Cliente existente."
            : "El adaptador no corresponde al canal solicitado.",
      }),
      diagnosticCheck({
        field: "accountId",
        state:
          Number(engineInputSummary.context.accountId || 0) > 0
            ? "pass"
            : "error",
        expected: "ID positivo para Cliente existente",
        actual: engineInputSummary.context.accountId,
        message:
          Number(engineInputSummary.context.accountId || 0) > 0
            ? "El adaptador pasa una cuenta al motor."
            : "Falta la cuenta requerida para este canal.",
      }),
    ],
  };
}

function debugBlockB5({ engineInputSummary, engineResult, qualityTrace, response }) {
  return {
    block: "B5",
    label: "Motor conversacional",
    status: "completed",
    input: engineInputSummary,
    output: {
      responseType: response.responseType || null,
      responseTypeReceived:
        qualityTrace?.diagnostics?.responseTypeNormalization
          ?.received ?? null,
      responseTypeSource:
        qualityTrace?.diagnostics?.responseTypeNormalization
          ?.source || "missing",
      confidence: response.confidence || null,
      answerLength: String(response.answer || "").length,
      clarificationRequired: Boolean(response.clarification),
      operationCount: Array.isArray(response.operations)
        ? response.operations.length
        : 0,
      validationStatus: qualityTrace?.validationStatus || null,
      plannerRoutingReturned: Boolean(
        engineResult?.channelIntentRouting,
      ),
      latencyMs: qualityTrace?.latencyMs || null,
    },
    checks: [
      diagnosticCheck({
        field: "responseType",
        state: !response.responseType
          ? "error"
          : qualityTrace?.diagnostics?.responseTypeNormalization
                ?.source === "customer_account_default"
            ? "warning"
            : "pass",
        expected: "tipo de respuesta normalizado definido",
        actual: {
          received:
            qualityTrace?.diagnostics?.responseTypeNormalization
              ?.received ?? null,
          normalized: response.responseType || null,
          source:
            qualityTrace?.diagnostics?.responseTypeNormalization
              ?.source || "missing",
        },
        message: !response.responseType
          ? "El resultado final sigue sin tipo de respuesta."
          : qualityTrace?.diagnostics?.responseTypeNormalization
                ?.source === "customer_account_default"
            ? "El resultado original omitió el tipo; Cliente existente aplicó el default informational."
            : "El tipo de respuesta normalizado está definido.",
      }),
      diagnosticCheck({
        field: "validationStatus",
        state: ["valid", "clarification"].includes(
          qualityTrace?.validationStatus,
        )
          ? "pass"
          : qualityTrace?.validationStatus === "error" ||
              qualityTrace?.validationStatus === "invalid"
            ? "error"
            : "warning",
        expected: "valid o clarification",
        actual: qualityTrace?.validationStatus || null,
        message:
          qualityTrace?.validationStatus === "clarification"
            ? "La respuesta solicita una aclaración de forma controlada."
            : qualityTrace?.validationStatus === "valid"
              ? "La respuesta pasó la validación."
              : "La respuesta requiere revisar su estado de validación.",
      }),
    ],
  };
}

function debugBlockB6({ plannerDiagnostics, plannerReturnEvent, qualityTrace, response, routingValidationEvent }) {
  return {
    block: "B6",
    label: "Planificador IA",
    status: plannerDiagnostics ? "completed" : "not_reached",
    input: qualityTrace?.diagnostics?.plannerInput || null,
    output: {
      diagnostics: plannerDiagnostics,
      proposedPlan:
        plannerReturnEvent?.output?.proposedRouting || null,
      routingValidation: routingValidationEvent?.output || null,
      normalizedPlan: response.channelIntentRouting || null,
    },
    checks: [
      diagnosticCheck({
        field: "normalizedPlan",
        state: response.channelIntentRouting ? "pass" : "warning",
        expected: "plan normalizado o motivo explícito de aclaración",
        actual: response.channelIntentRouting?.intent || null,
        message: response.channelIntentRouting
          ? "B5 recibió y normalizó el routing del planificador."
          : `No hay routing normalizado: ${plannerDiagnostics?.reasonCode || "revisar diagnóstico del planificador"}.`,
      }),
      diagnosticCheck({
        field: "allowedTools",
        state: (() => {
          const plannedTools =
            response.channelIntentRouting?.allowedTools || [];
          const authorizedTools =
            qualityTrace?.diagnostics?.plannerInput
              ?.availableToolNames || [];
          return plannedTools.every((tool) =>
            authorizedTools.includes(tool),
          )
            ? "pass"
            : "error";
        })(),
        expected:
          "herramientas del plan incluidas en las herramientas permitidas",
        actual: response.channelIntentRouting?.allowedTools || [],
        message:
          "El plan normalizado no debe ampliar el conjunto de herramientas autorizadas.",
      }),
    ],
  };
}

function debugBlockB12({ documentKnowledgeCallEvent, documentKnowledgeCount, documentKnowledgeStatus }) {
  return {
    block: "B12",
    label: "Recuperación documental",
    status: documentKnowledgeStatus,
    input: {
      requested: Boolean(documentKnowledgeCallEvent?.input?.requested),
    },
    output: {
      status: documentKnowledgeStatus,
      snippetsCount: documentKnowledgeCount,
    },
    checks: [
      diagnosticCheck({
        field: "retrievalStatus",
        state: documentKnowledgeStatus === "error"
          ? "warning"
          : documentKnowledgeStatus === "not_reached"
            ? "not_checked"
            : documentKnowledgeStatus === "not_applicable"
              ? "not_applicable"
              : "pass",
        expected: "recuperación acotada, omisión justificada o fallback controlado",
        actual: {
          status: documentKnowledgeStatus,
          snippetsCount: documentKnowledgeCount,
        },
        message: documentKnowledgeStatus === "error"
          ? "Pinecone no respondió; el turno continuó sin evidencia documental."
          : documentKnowledgeStatus === "results"
            ? "Se recuperó conocimiento documental, separado de la evidencia CRM."
            : documentKnowledgeStatus === "no_results"
              ? "La búsqueda no encontró fragmentos documentales pertinentes."
              : documentKnowledgeStatus === "not_applicable"
                ? "La intención no requiere consultar documentación."
                : documentKnowledgeStatus === "not_configured"
                  ? "Pinecone no está configurado; el turno continuó sin evidencia documental."
                  : documentKnowledgeStatus === "disabled"
                    ? "La documentación está desactivada para Cliente existente; el turno continuó sin evidencia documental."
                  : documentKnowledgeStatus === "no_documents"
                    ? "No hay documentos activos disponibles para recuperar."
                    : "La recuperación documental no se alcanzó.",
      }),
    ],
  };
}

function debugBlockB7({ engineInputSummary, evidenceDiagnostics, plannerDiagnostics, response, snapshot }) {
  return {
    block: "B7",
    label: "Read model del canal",
    status: evidenceDiagnostics ? "completed" : "not_reached",
    input: {
      plannedTools:
        plannerDiagnostics?.evaluation?.plannerTools || [],
      routeDisposition: !response.channelIntentRouting
        ? "no_valid_route"
        : response.channelIntentRouting.requiresClarification
          ? "blocked_by_routing_clarification"
          : (plannerDiagnostics?.evaluation?.plannerTools || [])
                .length
            ? "authorized_reads_planned"
            : "no_authorized_reads_planned",
      validatedRouting: response.channelIntentRouting
        ? {
            intents: response.channelIntentRouting.intents || [],
            intent: response.channelIntentRouting.intent || null,
            allowedTools:
              response.channelIntentRouting.allowedTools || [],
            referenceResolution: response.channelIntentRouting
              .referenceResolution
              ? {
                  targetType:
                    response.channelIntentRouting.referenceResolution
                      .targetType || null,
                  cardinality:
                    response.channelIntentRouting.referenceResolution
                      .cardinality || null,
                  source:
                    response.channelIntentRouting.referenceResolution
                      .source || null,
                }
              : null,
            filters: Object.fromEntries(
              Object.entries(
                response.channelIntentRouting.filters || {},
              ).filter(([key]) =>
                [
                  "opportunityStatus",
                  "stageCode",
                  "closeYear",
                  "periodMonths",
                  "startDate",
                  "endDate",
                ].includes(key),
              ),
            ),
            requiresClarification: Boolean(
              response.channelIntentRouting.requiresClarification,
            ),
          }
        : null,
      policy: engineInputSummary.policy,
    },
    output: {
      availableSources: getCustomerSnapshotQueryMetrics(snapshot).map(
        (metric) => metric.source,
      ),
    },
    checks: [
      diagnosticCheck({
        field: "plannedTools",
        state: evidenceDiagnostics ? "pass" : "not_checked",
        expected:
          "el read model continúa con el plan o detiene el flujo de forma controlada",
        actual: plannerDiagnostics?.evaluation?.plannerTools || [],
        message: evidenceDiagnostics
          ? "El flujo de lectura llegó a la verificación de evidencia."
          : "No hay evidencia de que se ejecutara una lectura del canal.",
      }),
    ],
  };
}

function debugBlockB8({ qualityTrace, toolsUsed }) {
  return {
    block: "B8",
    label: "Herramientas CRM autorizadas",
    status: toolsUsed.length ? "executed" : "no_reads",
    input: { toolNames: toolsUsed },
    output: { toolMetrics: qualityTrace?.toolMetrics || [] },
    checks: [
      diagnosticCheck({
        field: "toolMetrics",
        state: (qualityTrace?.toolMetrics || []).some(
          (metric) => metric.errorCode,
        )
          ? "warning"
          : toolsUsed.length
            ? "pass"
            : "not_applicable",
        expected:
          "métricas para lecturas ejecutadas; cero lecturas puede ser válido",
        actual: (qualityTrace?.toolMetrics || []).length,
        message: (qualityTrace?.toolMetrics || []).some(
          (metric) => metric.errorCode,
        )
          ? "Una o más herramientas reportaron error."
          : toolsUsed.length
            ? "Las lecturas ejecutadas tienen métricas."
            : "Este turno no ejecutó lecturas CRM.",
      }),
    ],
  };
}

function debugBlockB9({ evidenceDescription, evidenceDiagnostics, qualityTrace }) {
  return {
    block: "B9",
    label: "Verificador de evidencia",
    status: evidenceDiagnostics?.status || "not_reached",
    input: {
      toolMetrics: qualityTrace?.toolMetrics || [],
    },
    output: evidenceDiagnostics ? {
      ...evidenceDiagnostics,
      ...(qualityTrace?.diagnostics?.content
        ? { content: qualityTrace.diagnostics.content } : {}),
    } : null,
    checks: [
      diagnosticCheck({
        field: "evidenceStatus",
        state: evidenceDescription.state,
        expected:
          "Estado controlado del verificador factual, de entidades, de reporte o de contenido; fallos identificados aparte.",
        actual: evidenceDiagnostics?.status || null,
        message: evidenceDescription.message,
      }),
    ],
  };
}

function debugBlockB10({ evidenceDiagnostics, job, qualityTrace, response, snapshot }) {
  return {
    block: "B10",
    label: "Respuesta final",
    status: response.presentation?.status === "degraded" ? "degraded" : "completed",
    input: {
      evidenceStatus: evidenceDiagnostics?.status || null,
      responseType: response.responseType || "informational",
      selectedContext: {
        accountId: snapshot.account?.id || null,
        opportunityId:
          Number(job.opportunity_id || 0) ||
          snapshot.selectedOpportunity?.id ||
          null,
        contactId:
          Number(job.contact_id || 0) ||
          snapshot.selectedContact?.id ||
          null,
      },
      operationKind:
        response.channelIntentRouting?.operationKind || null,
      activityDraftAction:
        response.channelIntentRouting?.activityDraft?.action ||
        "none",
      answerGeneration:
        qualityTrace?.diagnostics?.answerGeneration || null,
      conversationalPresentation:
        qualityTrace?.diagnostics?.conversationalPresentation || null,
    },
    output: {
      answer: response.answer || "",
      responseType: response.responseType || "informational",
      entities: response.entities || {},
      operationSummary: (response.operations || []).map(
        (operation) => ({
          kind: operation.kind || null,
          targetModule: operation.targetModule || null,
          accountId: Number(operation.accountId || 0) || null,
          contactId: Number(operation.contactId || 0) || null,
          requiresConfirmation: Boolean(
            operation.requiresConfirmation,
          ),
        }),
      ),
      answerGeneration:
        qualityTrace?.diagnostics?.answerGeneration || null,
      auditDiagnostics:
        qualityTrace?.diagnostics?.answerAudit || null,
      conversationalPresentation:
        qualityTrace?.diagnostics?.conversationalPresentation || null,
    },
    checks: [
      ...(response.presentation ? [diagnosticCheck({
        field: "conversationalPresentation",
        state: response.presentation.status === "completed" ? "pass"
          : response.presentation.status === "degraded" ? "warning" : "not_applicable",
        expected: "Redacción final auditada o respuesta base conservada explícitamente.",
        actual: response.presentation.status,
        message: response.presentation.status === "degraded"
          ? "Se mostró la respuesta verificada sin reformulación; revisar el motivo de degradación."
          : response.presentation.status === "completed"
            ? "La respuesta final pasó los controles de fidelidad y cobertura."
            : "No se necesitó una redacción adicional.",
      })] : []),
      ...(qualityTrace?.diagnostics?.answerAudit
        ? [
            diagnosticCheck({
              field: "answerAudit",
              state:
                qualityTrace.diagnostics.answerAudit.status ===
                "supported"
                  ? "pass"
                  : qualityTrace.diagnostics.answerAudit.status ===
                      "unsupported"
                    ? "error"
                    : "warning",
              expected: "auditoría de respuesta respaldada",
              actual: {
                status: qualityTrace.diagnostics.answerAudit.status,
                unsupportedClaimCount: Array.isArray(
                  qualityTrace.diagnostics.answerAudit
                    .unsupportedClaims,
                )
                  ? qualityTrace.diagnostics.answerAudit
                      .unsupportedClaims.length
                  : 0,
                providerResponseId:
                  qualityTrace.diagnostics.answerAudit
                    .providerResponseId || null,
              },
              message:
                qualityTrace.diagnostics.answerAudit.status ===
                "supported"
                  ? "La auditoría respaldó la respuesta propuesta."
                  : qualityTrace.diagnostics.answerAudit.status ===
                      "unsupported"
                    ? "La auditoría marcó afirmaciones como no respaldadas; revisa el detalle de B10."
                    : "No se obtuvo un dictamen concluyente de la auditoría; revisa el detalle de B10.",
            }),
          ]
        : []),
      diagnosticCheck({
        field: "answer",
        state: String(response.answer || "").trim()
          ? "pass"
          : "error",
        expected: "texto de respuesta o aclaración no vacío",
        actual: String(response.answer || "").length,
        message: String(response.answer || "").trim()
          ? "Hay contenido que mostrar al usuario."
          : "La respuesta final está vacía.",
      }),
    ],
  };
}

function debugBlockB11({ conversationContextUpdated, jobId, nextHistory, persistedConversationContext, request }) {
  return {
    block: "B11",
    label: "Persistencia del servicio",
    status: "completed",
    input: {
      jobId: Number(jobId),
      chatSessionId: Number(request.chatSessionId || 0),
    },
    output: {
      jobStatus: "completed",
      historyMessageCount: nextHistory.length,
      contextDisposition: conversationContextUpdated
        ? "recomputed"
        : "preserved",
      context: persistedConversationContext,
    },
    checks: [
      diagnosticCheck({
        field: "persistedJobId",
        state: Number(jobId) > 0 ? "pass" : "error",
        expected: "ID positivo del job completado",
        actual: Number(jobId) || null,
        message:
          Number(jobId) > 0
            ? "El resultado quedó asociado al job."
            : "No se identifica el job que debía persistirse.",
      }),
      diagnosticCheck({
        field: "persistedSessionId",
        state: Number(request.chatSessionId) > 0 ? "pass" : "error",
        expected: "ID positivo de sesión",
        actual: Number(request.chatSessionId) || null,
        message:
          Number(request.chatSessionId) > 0
            ? "El historial quedó asociado a una sesión."
            : "Falta la sesión donde debía persistirse el historial.",
      }),
    ],
  };
}

export function buildTurnDebugFlow(context) {
  return [
    debugBlockB1(context),
    debugBlockB2(context),
    debugBlockB3(context),
    debugBlockB4(context),
    debugBlockB5(context),
    debugBlockB6(context),
    debugBlockB12(context),
    debugBlockB7(context),
    debugBlockB8(context),
    debugBlockB9(context),
    debugBlockB10(context),
    debugBlockB11(context),
  ];
}
