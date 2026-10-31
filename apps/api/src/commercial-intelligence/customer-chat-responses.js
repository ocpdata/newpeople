import { matchCoachQueryCase } from "../coach/case-catalog.js";
import { resolveCoachEntities } from "../coach/entity-resolver.js";
import { isStagePreparationQuestion } from "../coach/stage-readiness.js";
import { normalizeCustomerSearchText } from "./customer-record-list.js";
import {
  buildCustomerContactHistoryResponse,
  buildCustomerActivityHistoryResponse,
} from "./activity-history.js";
import {
  accountRecord,
  formatUsd,
  isOpen,
  normalize,
  opportunityRecords,
  permissionGranted,
} from "./customer-chat-records.js";
import { buildCustomerIntentResponse } from "./customer-chat-intent-response.js";

export function buildCustomerQuotationResponse(snapshot, question) {
  if (matchCoachQueryCase(question)?.type !== "quotation_query") return null;
  const quotation = snapshot?.selectedOpportunityQuotation;
  if (!quotation) return null;
  const sections = (quotation.sections || []).map((section, sectionIndex) => ({
    key: `quotation-section-${sectionIndex}`,
    title: section.title || "Sección sin título",
    subtitle: section.inclusion || "",
    available: true,
    items: (section.items || []).map((item, itemIndex) => {
      const details = [
        item.quantity != null ? `Cantidad: ${item.quantity}` : "",
        item.listPriceUnit != null
          ? `Precio unitario: ${item.currencyCode || quotation.currencyCode || ""} ${item.listPriceUnit}`.trim()
          : "",
        item.discountPct != null && Number(item.discountPct) > 0
          ? `Descuento: ${item.discountPct}%`
          : "",
        item.isRenewal ? "Renovación" : "",
      ].filter(Boolean);
      return {
        id: `${sectionIndex}-${itemIndex}`,
        date: quotation.quotationDate || "",
        title:
          item.description || item.productCode || "Partida sin descripción",
        activityType: item.itemType || "producto",
        status: "",
        details: details.join(" · "),
      };
    }),
  }));
  const itemCount = sections.reduce(
    (total, section) => total + section.items.length,
    0,
  );
  const proposalName = quotation.proposalName || "Cotización vigente";
  const opportunityName =
    quotation.opportunityName || snapshot?.selectedOpportunity?.name || "";
  const answer = `${proposalName}${opportunityName ? ` · ${opportunityName}` : ""} · versión ${quotation.versionNumber || "sin número"} · ${sections.length} secciones · ${itemCount} partidas.`;
  return {
    answer,
    evidence: [
      `Cotización CRM autorizada: ${proposalName}; versión ${quotation.versionNumber || "sin número"}; ${sections.length} secciones y ${itemCount} partidas.`,
    ],
    inferences: [],
    confidence: "high",
    recommendedActions: [],
    source: "account_intelligence",
    activityHistory: {
      mode: "quotation",
      metadata: {
        opportunityName,
        quotationDate: quotation.quotationDate || null,
        statusName: quotation.statusName || quotation.statusCode || "",
        currencyCode: quotation.currencyCode || "",
      },
      sections,
    },
  };
}

function buildCustomerOpportunityStatusResponse(snapshot, question) {
  const normalizedQuestion = normalize(question)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const asksSingularOpportunityStatus =
    /\boportunidad\b/.test(normalizedQuestion) &&
    !/\boportunidades\b/.test(normalizedQuestion) &&
    /\b(estado|estatus|situacion|etapa)\b/.test(normalizedQuestion);
  if (!asksSingularOpportunityStatus) return null;
  const opportunity =
    snapshot?.selectedOpportunity ||
    resolveCoachEntities(
      {
        accounts: accountRecord(snapshot),
        coachOpportunities: opportunityRecords(snapshot),
      },
      question,
      {},
      { ignoreStageFilters: true },
    ).opportunity;
  if (!opportunity) {
    return {
      answer:
        "No hay una oportunidad seleccionada para esta cuenta. Indica su nombre o selecciónala para consultar su estado.",
      evidence: [],
      inferences: [],
      confidence: "medium",
      recommendedActions: [],
      source: "account_intelligence",
    };
  }
  const statusLabels = {
    en_proceso: "En proceso",
    ganada: "Ganada",
    perdida: "Perdida",
    anulada: "Anulada",
  };
  const status =
    statusLabels[opportunity.commercialStatusCode] ||
    opportunity.commercialStatusCode ||
    "Sin estado comercial registrado";
  const activationStatus =
    opportunity.activationStatusCode || "Sin estado de activación registrado";
  const stage = opportunity.stageName || "Sin etapa registrada";
  return {
    answer: `${opportunity.name || "Oportunidad seleccionada"}: ${status}; etapa ${stage}; activación ${activationStatus}.`,
    evidence: [
      `Estado CRM de la oportunidad ${opportunity.name || opportunity.id}: comercial ${status}; etapa ${stage}; activación ${activationStatus}.`,
    ],
    inferences: [],
    confidence: "high",
    recommendedActions: [],
    source: "account_intelligence",
  };
}

export function buildCustomerStageReadinessResponse({
  question,
  readToolResults = [],
  reportedCriterionTitles = [],
} = {}) {
  const isPreparationQuestion = isStagePreparationQuestion(question);
  const readinessRead = readToolResults.find(
    (item) => item?.toolName === "getOpportunityReadiness",
  );
  const readiness = readinessRead?.error ? null : readinessRead?.result;
  const stageName = String(readiness?.currentStage?.name || "").trim();
  if (!stageName || !Array.isArray(readiness?.pendingItems)) return null;

  const pendingItems = readiness.pendingItems.filter(
    (item) => String(item?.title || "").trim(),
  );
  if (!isPreparationQuestion) {
    const pendingByTitle = new Map(
      pendingItems.map((item) => [normalize(item.title).trim(), item]),
    );
    const reportedItems = [
      ...new Set(
        reportedCriterionTitles
          .map((title) => pendingByTitle.get(normalize(title).trim()))
          .filter(Boolean),
      ),
    ];
    if (!reportedItems.length) return null;
    const reportedText = String(question).trim().replace(/\s+/g, " ");
    const reportedTitles = reportedItems.map((item) =>
      String(item.title).trim(),
    );
    return {
      answer: `Según lo que reportas, el cliente indicó: "${reportedText}". Esto corresponde al criterio ${reportedTitles.map((title) => `"${title}"`).join(", ")}. No está verificado ni registrado en CRM; estos criterios seguirán pendientes hasta que confirmes su registro. Si quieres, puedo preparar las respuestas para que las revises; no se guardarán sin tu confirmación.`,
      evidence: [
        ...reportedTitles.map(
          (title) => `Información reportada por el vendedor para el criterio "${title}".`,
        ),
      ],
      inferences: [],
      confidence: "medium",
      pendingItems: pendingItems.map((item) => String(item.title).trim()),
      recommendedActions: [],
      operations: [],
      responseType: "informational",
      source: "account_intelligence",
    };
  }
  const pendingTitles = pendingItems.map((item) =>
    String(item.title).trim(),
  );
  const rationale = String(readiness.rationale || "").trim();
  const recommendation = {
    remain: "La recomendación es permanecer en esta etapa.",
    advance: "La oportunidad cumple los criterios para avanzar.",
    advance_with_caution: "La recomendación es avanzar con cautela.",
  }[readiness.recommendation] || "";
  const answer = pendingTitles.length
    ? `Para completar la etapa "${stageName}", readiness registra estos criterios como pendientes: ${pendingTitles.join("; ")}.${recommendation ? ` ${recommendation}` : ""}${rationale ? ` ${rationale}` : ""}`
    : `Readiness no registra criterios pendientes para la etapa "${stageName}".${recommendation ? ` ${recommendation}` : ""}${rationale ? ` ${rationale}` : ""}`;

  return {
    answer,
    evidence: [
      `Lectura de readiness CRM para la etapa "${stageName}".`,
      ...pendingItems.map((item) =>
        `Criterio pendiente: ${String(item.title).trim()}${item.detail ? `: ${String(item.detail).trim()}` : ""}`,
      ),
    ],
    inferences: [],
    confidence: "high",
    pendingItems: pendingTitles,
    recommendedActions: [],
    operations: [],
    responseType: "informational",
    source: "account_intelligence",
  };
}

export function buildCustomerStatusQuestionResponse(question, snapshot, permissions) {
  const normalizedQuestion = normalizeCustomerSearchText(question);
  let answer = "";

  if (/\bpendiente\b/.test(normalizedQuestion) &&
      /\bperdida\b/.test(normalizedQuestion) &&
      /\b(?:significa|equivale|quiere decir|implica)\b/.test(normalizedQuestion)) {
    answer = "No. «Pendiente» es el estado de una actividad que todavía no se completa; «Perdida» es un estado comercial de una oportunidad. Una actividad pendiente no significa que la oportunidad esté perdida: son registros y estados distintos, y el estado comercial debe revisarse por separado.";
  } else if (/\bwaiting\b/.test(normalizedQuestion) &&
      /\babiertas?\b/.test(normalizedQuestion) &&
      /\b(?:todas?|siguen|continuan)\b/.test(normalizedQuestion)) {
    if (!permissionGranted(permissions, "oportunidades.read") ||
        snapshot.permissions?.canReadOpportunities === false) return null;
    const waiting = [...(snapshot.opportunities || []), ...(snapshot.inactiveOpportunities || [])]
      .filter((item) => normalizeCustomerSearchText(item.stageCode || item.stageName) === "waiting");
    const statusCode = (item) => normalizeCustomerSearchText(item.commercialStatusCode).replaceAll("_", " ");
    const won = waiting.find((item) => statusCode(item) === "ganada");
    const inProgress = waiting.find((item) => statusCode(item) === "en proceso");
    if (!won || !inProgress) return null;
    answer = `No. ${won.name} está en etapa Waiting y su estado comercial es Ganada, así que no sigue abierta. ${inProgress.name} también está en Waiting, pero está En proceso${normalizeCustomerSearchText(inProgress.activationStatusCode) === "activada" ? " y activada" : ""}. Waiting es una etapa; Ganada y En proceso son estados comerciales, y la activación es independiente.`;
  }

  if (!answer) return null;
  return {
    response: {
      answer,
      responseType: "informational",
      evidence: [],
      inferences: [],
      pendingItems: [],
      confidence: "high",
      recommendedActions: [],
      operations: [],
      source: "account_intelligence",
      entities: {
        accountId: Number(snapshot.account?.id || 0) || null,
        opportunityId: null,
        contactId: null,
        leadId: null,
        names: [],
      },
    },
    qualityTrace: {
      toolsUsed: [],
      diagnostics: {
        answerGeneration: { source: "deterministic_status_explanation" },
      },
    },
    channelIntentRouting: null,
  };
}

export function buildCustomerFallback(snapshot, question) {
  const quotationResponse = buildCustomerQuotationResponse(snapshot, question);
  if (quotationResponse) return quotationResponse;
  const opportunityStatusResponse = buildCustomerOpportunityStatusResponse(
    snapshot,
    question,
  );
  if (opportunityStatusResponse) return opportunityStatusResponse;
  const contactHistoryResponse = buildCustomerContactHistoryResponse(
    snapshot,
    question,
  );
  if (contactHistoryResponse) return contactHistoryResponse;
  const activityHistoryResponse = buildCustomerActivityHistoryResponse(
    snapshot,
    question,
  );
  if (activityHistoryResponse) return activityHistoryResponse;
  const normalizedQuestion = normalize(question);
  const openOpportunities = (snapshot.opportunities || []).filter(isOpen);
  const accountName = snapshot.account?.name || "la cuenta seleccionada";
  const evidence = [`Snapshot CRM capturado: ${snapshot.capturedAt}`];
  const risk = snapshot.accountHealth?.signals?.find(
    (signal) => signal.severity === "high",
  );
  const recommendedActions = risk
    ? [
        {
          title: risk.title,
          opportunityId:
            risk.entityType === "opportunity"
              ? risk.entityId
              : openOpportunities[0]?.id || null,
          actionType: "call",
          notes: "Revisar desde Cliente existente.",
          successCriteria: "Validar la señal con el cliente.",
          requiresConfirmation: true,
        },
      ]
    : [];
  if (
    /\b(correo|email|mail|modelo|enviar|mensaje)\b/.test(normalizedQuestion)
  ) {
    return {
      answer: `Borrador de correo para solicitar una conversación comercial con ${snapshot.account?.name || "la cuenta"}.`,
      evidence,
      inferences: [],
      confidence: "low",
      recommendedActions,
      source: "account_intelligence",
    };
  }
  if (/\b(oportunidad|oportunidades|pipeline)\b/.test(normalizedQuestion)) {
    return {
      answer: `La cuenta ${accountName} tiene ${openOpportunities.length} oportunidad(es) abierta(s): ${openOpportunities.map((item) => item.name).join(", ") || "ninguna"}.`,
      evidence,
      inferences: [],
      confidence: "medium",
      recommendedActions,
      source: "account_intelligence",
    };
  }
  return {
    answer: `La cuenta ${accountName} tiene ${snapshot.contacts?.length || 0} contacto(s), ${openOpportunities.length} oportunidad(es) abiertas y ${snapshot.interactions?.length || 0} interacción(es) recientes.`,
    evidence,
    inferences: [],
    confidence: "low",
    recommendedActions,
    source: "account_intelligence",
  };
}

export function buildCustomerAccountOverviewResponse(snapshot, readToolResults = []) {
  const accountName = String(snapshot?.account?.name || "").trim();
  if (!accountName) return null;
  const resultFor = (toolName) =>
    readToolResults.find((item) => item?.toolName === toolName && !item.error);
  const opportunityRead = resultFor("searchOpportunities");
  const contactRead = resultFor("searchContacts");
  const interactionRead = resultFor("searchInteractions");
  const sections = [];
  const evidence = [`Cuenta seleccionada y autorizada: ${accountName}.`];

  if (Array.isArray(opportunityRead?.result)) {
    const openOpportunities = opportunityRead.result.filter(
      (opportunity) =>
        String(opportunity?.lifecycle || "").toLowerCase() === "open" &&
        String(opportunity?.commercialStatusCode || "").toLowerCase() ===
          "en_proceso" &&
        String(opportunity?.activationStatusCode || "").toLowerCase() ===
          "activada",
    );
    const openPipelineUsd = openOpportunities.reduce(
      (total, opportunity) => total + (Number(opportunity.amountUsd) || 0),
      0,
    );
    sections.push(
      `${openOpportunities.length} oportunidades abiertas con un pipeline de ${formatUsd(openPipelineUsd)}`,
    );
    evidence.push(
      `searchOpportunities: ${openOpportunities.length} oportunidades abiertas; pipeline ${formatUsd(openPipelineUsd)}.`,
    );
  }

  if (Array.isArray(contactRead?.result)) {
    sections.push(`${contactRead.result.length} contactos activos visibles`);
    evidence.push(
      `searchContacts: ${contactRead.result.length} contactos activos visibles.`,
    );
  }

  if (Array.isArray(interactionRead?.result)) {
    sections.push(`${interactionRead.result.length} interacciones consultadas`);
    evidence.push(
      `searchInteractions: ${interactionRead.result.length} interacciones consultadas.`,
    );
  }

  if (!sections.length) return null;
  return {
    answer: `Resumen de ${accountName}: ${sections.join("; ")}.`,
    evidence,
    inferences: [],
    confidence: opportunityRead && contactRead ? "high" : "medium",
    pendingItems: [],
    recommendedActions: [],
    operations: [],
    source: "account_intelligence",
  };
}

export function buildCustomerDeterministicResponse({
  snapshot,
  question,
  routing,
  permissions,
  allowedOperationKinds,
  businessRules,
  pendingAmountSelection,
}) {
  const intentResponse = buildCustomerIntentResponse({
    snapshot,
    question,
    routing,
    permissions,
    allowedOperationKinds,
    businessRules,
    pendingAmountSelection,
  });
  if (intentResponse) return intentResponse;
  const quotationResponse = buildCustomerQuotationResponse(snapshot, question);
  if (quotationResponse) return quotationResponse;
  const opportunityStatusResponse = buildCustomerOpportunityStatusResponse(
    snapshot,
    question,
  );
  if (opportunityStatusResponse) return opportunityStatusResponse;
  const contactHistoryResponse = buildCustomerContactHistoryResponse(
    snapshot,
    question,
  );
  if (contactHistoryResponse) return contactHistoryResponse;
  return buildCustomerActivityHistoryResponse(snapshot, question);
}

export function buildCustomerEvidenceFailureResponse({
  status,
  errorCode,
  readToolResults = [],
  failedSources = [],
  missingQueries = [],
  missingFacts = [],
  clarificationQuestion = "",
} = {}) {
  const queryLabels = {
    account_overview: "resumen de cuenta",
    opportunity_query: "oportunidades",
    opportunity_status: "estado o etapa de oportunidad",
    opportunity_guidance: "recomendaciones para la oportunidad",
    contact_query: "contactos",
    contact_history: "historial de contactos",
    account_activity_history: "interacciones y actividades",
    quotation_query: "contenido de cotización",
    email_draft: "destinatario del borrador de correo",
  };
  const pendingItems = [
    ...missingFacts,
    ...missingQueries.map((code) => queryLabels[code] || "consulta adicional"),
  ].slice(0, 8);
  const failedSourceLabels = [
    ...new Set([
      ...readToolResults
        .filter((item) => item?.error)
        .map((item) => String(item.toolName || "consulta CRM")),
      ...(Array.isArray(failedSources) ? failedSources : []),
    ]),
  ];
  let answer;
  let responseType = "clarification";
  let clarification = null;
  if (status === "clarification") {
    answer =
      clarificationQuestion ||
      "Necesito que precises a qué registro o periodo te refieres antes de consultar.";
    clarification = {
      type: "missing_fields",
      message: answer,
      missing: missingFacts,
    };
  } else if (status === "no_results") {
    responseType = "informational";
    clarification = null;
    answer =
      "Las consultas autorizadas no devolvieron registros que coincidan con los filtros solicitados. Esto no confirma que nunca hayan existido registros fuera del alcance consultado.";
  } else if (status === "query_error" || failedSourceLabels.length) {
    responseType = "error";
    answer = `No pude verificar toda la solicitud porque falló la consulta de ${failedSourceLabels.join(", ") || "una fuente CRM"}. No interpretaré ese error como ausencia de registros.`;
  } else if (status === "adapter_execution_error") {
    responseType = "error";
    answer =
      "Ocurrió un error interno al procesar la consulta. No pude verificar la respuesta. Inténtalo de nuevo; si el problema persiste, contacta al administrador.";
  } else if (status === "timeout" || errorCode === "turn_timeout") {
    responseType = "error";
    answer =
      "La verificación excedió el tiempo disponible. No puedo confirmar esta respuesta con la evidencia recuperada.";
  } else if (
    status === "verification_unavailable" ||
    status === "verification_error"
  ) {
    responseType = "error";
    answer =
      "No fue posible verificar si la evidencia disponible responde la solicitud. No presentaré una conclusión como confirmada.";
  } else if (status === "answer_generation_error") {
    responseType = "error";
    answer =
      "La evidencia se verificó, pero no pude redactar una respuesta confiable. No presentaré una conclusión sin esa revisión.";
  } else {
    const missing = pendingItems.length
      ? ` Falta verificar: ${pendingItems.join(", ")}.`
      : "";
    answer = `No pude verificar con suficiente evidencia todas las partes de la solicitud.${missing} Puedes precisar la oportunidad, el contacto o el periodo para continuar.`;
  }
  return {
    answer,
    responseType,
    clarification,
    evidence: [],
    inferences: [],
    pendingItems,
    confidence: "low",
    recommendedActions: [],
    operations: [],
    source: "account_intelligence",
  };
}
