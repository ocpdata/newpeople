import { normalizeCommercialActivityType } from "../../../../shared/commercial-activity-types.js";
import {
  COACH_INTENT_PROCESS_OPTIONS,
  COACH_OPERATION_LABELS,
  COACH_TARGET_MODULE_LABELS,
  PROSPECT_CONVERSION_ACTION_TYPES,
  PROSPECT_CONVERSION_TARGETS,
} from "./miAgentConstants";

export function getCoachProcessOption(process, channel = "coach") {
  if (channel === "customer_account") {
    return {
      label: "Conversación de cliente existente",
      description:
        "Se aplica a todas las solicitudes de la cuenta seleccionada.",
    };
  }
  if (channel === "prospect") {
    return {
      label: "Conversación de cuenta nueva",
      description:
        "Se aplica a todas las conversaciones y solicitudes del canal Cuenta nueva.",
    };
  }
  if (process === "default") {
    return {
      label:
        channel === "coach"
          ? "Configuración general de Coach"
          : "Configuración predeterminada del canal",
      description:
        channel === "coach"
          ? "Se aplica a toda la conversación cuando no hay un ajuste específico por intención."
          : "Esta configuración sirve de base para el canal y se usa cuando no hay una específica para el tipo de consulta.",
    };
  }
  return (
    COACH_INTENT_PROCESS_OPTIONS.find((option) => option.value === process) || {
      label: "Tipo de consulta personalizado",
      description: "Configuración específica para este código de consulta.",
    }
  );
}

export function getCoachBusinessRulesProcess(channel, process = "default") {
  return ["customer_account", "prospect"].includes(channel)
    ? "default"
    : process || "default";
}

export function isProspectConversionAction(action) {
  return (
    PROSPECT_CONVERSION_TARGETS.has(
      String(action?.target || "")
        .trim()
        .toLowerCase(),
    ) &&
    PROSPECT_CONVERSION_ACTION_TYPES.has(
      String(action?.actionType || "")
        .trim()
        .toLowerCase(),
    )
  );
}

export function isProspectConversionOperation(operation) {
  const targetByKind = {
    create_account: "account",
    create_contact: "contact",
    create_opportunity: "opportunity",
  };
  return (
    targetByKind[operation?.kind] === operation?.payload?.target &&
    PROSPECT_CONVERSION_TARGETS.has(operation?.payload?.target) &&
    PROSPECT_CONVERSION_ACTION_TYPES.has(
      String(operation?.payload?.actionType || "")
        .trim()
        .toLowerCase(),
    )
  );
}

export function getCustomerActionStatus({ loading, error, job }) {
  if (error) return "Error";
  if (loading || job?.status === "pending" || job?.status === "running") {
    return "En proceso";
  }
  if (job?.status === "completed") return "Listo";
  if (job?.status === "failed") return "Error";
  return "Sin ejecutar";
}

export function getCustomerActionStatusClass(status) {
  if (status === "Listo") return "is-ready";
  if (status === "En proceso") return "is-running";
  if (status === "Error") return "is-error";
  return "is-idle";
}

export function summarizeCustomerAgents(agents = []) {
  const findingCount = agents.reduce(
    (total, agent) => total + (agent.findings?.length || 0),
    0,
  );
  return `${agents.length} ${agents.length === 1 ? "agente" : "agentes"} · ${findingCount} ${findingCount === 1 ? "hallazgo" : "hallazgos"}`;
}

export function groupCustomerProductsByQuotation(products = []) {
  const groups = new Map();
  for (const product of products) {
    const quotationId = Number(product.quotationId);
    if (!groups.has(quotationId)) {
      groups.set(quotationId, {
        quotationId,
        commercialStatus: product.commercialStatus,
        products: [],
      });
    }
    groups.get(quotationId).products.push(product);
  }
  return [...groups.values()];
}

export function normalizeCoachActivityType(value) {
  return normalizeCommercialActivityType(value);
}

export function formatCurrency(value, currency = "USD") {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

export function formatCoachRecommendation(recommendation) {
  if (!recommendation) return "Sin recomendación adicional.";
  return typeof recommendation === "object"
    ? recommendation.action || "Sin recomendación adicional."
    : recommendation;
}

export function formatCoachDateTime(value, timeZone) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : new Intl.DateTimeFormat("es-MX", {
        dateStyle: "medium",
        timeStyle: "short",
        ...(timeZone ? { timeZone } : {}),
      }).format(date);
}

export function buildCoachOperationDraft(operation, persistedOperation = null) {
  const pendingOperation =
    persistedOperation?.pendingOperation || operation || {};
  const operationWithMissingFields = {
    ...pendingOperation,
    missingFields:
      persistedOperation?.missingFields || pendingOperation.missingFields || [],
  };
  return {
    operation: operationWithMissingFields,
    opportunityId: pendingOperation.opportunityId || "",
    value: pendingOperation.value ?? pendingOperation.answerValue ?? pendingOperation.comment ?? "",
    answerMode: pendingOperation.answerMode || "replace",
    payload: pendingOperation.payload || {},
    persistentId:
      persistedOperation?.id || pendingOperation.persistentId || null,
    version:
      persistedOperation?.version || pendingOperation.persistenceVersion || 1,
    persistenceStatus:
      persistedOperation?.status ||
      pendingOperation.persistenceStatus ||
      "ready",
    reviewedAt: persistedOperation?.reviewedAt || null,
  };
}

export function serializeCoachOperationDraft(draft) {
  const operation = { ...(draft?.operation || {}) };
  delete operation.persistenceStatus;
  delete operation.persistenceVersion;
  if (
    [
      "create_account",
      "create_contact",
      "create_opportunity",
      "create_lead",
      "create_contact_mapping",
      "create_quotation",
      "create_proposal",
      "lead_resolve",
    ].includes(operation.kind)
  ) {
    operation.payload = draft.payload || {};
  } else if (operation.kind === "stage_answer") {
    operation.answerValue = draft.value;
    operation.answerMode = draft.answerMode;
  } else if (operation.kind === "lead_call_outcome") {
    operation.comment = draft.value;
  } else if (operation.kind === "activity") {
    const calendarKind =
      operation.calendarKind ||
      (draft.opportunityId
        ? "opportunity"
        : operation.interactionId
          ? "lead"
          : "standalone");
    operation.calendarKind = calendarKind;
    operation.opportunityId =
      calendarKind === "opportunity"
        ? Number(draft.opportunityId || 0) || null
        : null;
    operation.interactionId =
      calendarKind === "lead"
        ? Number(operation.interactionId || 0) || null
        : null;
    operation.actionType = normalizeCommercialActivityType(
      operation.actionType,
    );
  } else if (operation.field) {
    operation.value = draft.value;
  }
  return operation;
}

export function unresolvedCoachFields(operation) {
  const payload = operation?.payload || {};
  const requiredFields =
    operation?.kind === "activity"
      ? [
          "title",
          "scheduledAt",
          ...(operation.calendarKind === "opportunity"
            ? ["opportunityId"]
            : operation.calendarKind === "lead"
              ? ["interactionId"]
              : []),
        ]
      : [];
  if (operation?.kind === "opportunity_note") requiredFields.push("noteText");
  return [
    ...new Set([
      ...(operation?.missingFields || []).filter(
        (field) =>
          operation?.kind !== "activity" ||
          field !== "opportunityId" ||
          operation.calendarKind === "opportunity",
      ),
      ...requiredFields,
    ]),
  ].filter((field) => {
    const value = payload[field] ?? operation[field];
    return value === null || value === undefined || String(value).trim() === "";
  });
}

export function isUsablePublicContactValue(value) {
  const text = String(value || "").trim();
  return Boolean(text) && !/[*xX]{2,}/.test(text);
}

export function buildSnapshot(dashboard) {
  const development = dashboard?.development || dashboard || {};
  const quota = development.quota || {};
  const workboard = Array.isArray(dashboard?.workboard)
    ? dashboard.workboard
    : [];
  // El endpoint propio de Mi agente ya devuelve únicamente oportunidades calificadas.
  const qualified = workboard;
  const coachOpportunities = Array.isArray(dashboard?.coachOpportunities)
    ? dashboard.coachOpportunities
    : qualified;
  const openPipeline = coachOpportunities.filter(
    (item) => item.lifecycle === "open",
  );
  const currencyCode =
    quota.currencyCode ||
    development.period?.baseCurrencyCode ||
    dashboard?.period?.baseCurrencyCode ||
    "USD";
  const currencyConversionAvailable =
    dashboard?.currencyConversion?.available ?? currencyCode === "USD";

  return {
    period: development.period || dashboard?.period || null,
    quota: {
      assignedAmount: Number(quota.assignedAmount || 0),
      actualAmount:
        quota.actualAmount == null ? null : Number(quota.actualAmount),
      gapAmount: quota.gapAmount == null ? null : Number(quota.gapAmount),
      committedOpenAmount:
        quota.committedOpenAmount == null
          ? null
          : Number(quota.committedOpenAmount),
      weightedOpenAmount:
        quota.weightedOpenAmount == null
          ? null
          : Number(quota.weightedOpenAmount),
      currencyCode,
      currencyConversionAvailable,
      usdToQuotaRate: Number(
        dashboard?.currencyConversion?.usdToTargetRate ?? 1,
      ),
      currencyRateFetchedAt: dashboard?.currencyConversion?.fetchedAt || null,
    },
    pipeline: {
      openAmount: !currencyConversionAvailable
        ? null
        : openPipeline.reduce(
            (sum, item) =>
              sum +
              Number(item.amountUsd ?? item.amount_usd ?? 0) *
                Number(dashboard?.currencyConversion?.usdToTargetRate ?? 1),
            0,
          ),
      openCount: openPipeline.length,
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
        riskReasons: Array.isArray(item.riskReasons)
          ? item.riskReasons.slice(0, 4)
          : [],
        daysSinceActivity: Number(item.daysSinceActivity || 0),
        currentStageValidated: Boolean(item.currentStageValidated),
        openWeaknesses: Array.isArray(item.openWeaknesses)
          ? item.openWeaknesses
          : [],
        nextStep: item.nextStep || null,
        nextPendingAction: item.nextPendingAction || null,
        recommendedStrategySteps: Array.isArray(item.recommendedStrategySteps)
          ? item.recommendedStrategySteps.slice(0, 3)
          : [],
      })),
    },
    coachOpportunities,
    wonOpportunities: Array.isArray(dashboard?.wonOpportunities)
      ? dashboard.wonOpportunities
      : [],
    lostOpportunities: Array.isArray(dashboard?.lostOpportunities)
      ? dashboard.lostOpportunities
      : [],
    cancelledOpportunities: Array.isArray(dashboard?.cancelledOpportunities)
      ? dashboard.cancelledOpportunities
      : [],
    inactivePipelineOpportunities: Array.isArray(
      dashboard?.inactivePipelineOpportunities,
    )
      ? dashboard.inactivePipelineOpportunities
      : [],
    accounts: Array.isArray(dashboard?.accounts) ? dashboard.accounts : [],
    contactMappings: Array.isArray(dashboard?.contactMappings)
      ? dashboard.contactMappings
      : [],
    summary: dashboard?.summary || {},
  };
}

export function buildCoachOpportunityOptions(openOpportunities, snapshot, accountId) {
  const normalizedAccountId = Number(accountId || 0);
  const open = (Array.isArray(openOpportunities) ? openOpportunities : []).map(
    (opportunity) => ({ ...opportunity, contextGroup: "open" }),
  );
  const historicalGroups = [
    ["wonOpportunities", "won"],
    ["lostOpportunities", "lost"],
    ["cancelledOpportunities", "cancelled"],
  ];
  const historical = historicalGroups.flatMap(([key, contextGroup]) =>
    (Array.isArray(snapshot?.[key]) ? snapshot[key] : [])
      .filter(
        (opportunity) =>
          Number(opportunity.account?.id || opportunity.accountId || 0) ===
          normalizedAccountId,
      )
      .map((opportunity) => ({ ...opportunity, contextGroup })),
  );
  const unique = new Map();
  [...open, ...historical].forEach((opportunity) => {
    unique.set(Number(opportunity.id), opportunity);
  });
  return [...unique.values()];
}

export function formatCoachOperationLabel(operation) {
  const title = String(operation?.pendingOperation?.title || "").trim();
  if (title && title.toLowerCase() !== "unknown") return title;
  const kind =
    operation?.kind && operation.kind !== "unknown"
      ? operation.kind
      : operation?.pendingOperation?.kind;
  return COACH_OPERATION_LABELS[kind] || "Acción pendiente";
}

export function formatCoachTargetModule(targetModule) {
  return COACH_TARGET_MODULE_LABELS[targetModule] || "";
}

export function formatCoachOperationSummary(operation) {
  if (operation?.kind === "opportunity_note")
    return String(operation.noteText || "Nota pendiente de revisión");
  if (operation?.kind === "reschedule_activity") return `${operation.scheduleSummary?.before || "Sin programación"} → ${operation.scheduleSummary?.after || "Fecha pendiente"}`;
  if (operation?.kind === "activity") {
    return `${operation.actionType || "Actividad"} · ${operation.scheduledAt || "Fecha pendiente"} · ${operation.priority || "Prioridad pendiente"}`;
  }
  if (operation?.kind === "stage_answer")
    return `Respuesta de etapa: ${operation.answerValue || "Pendiente"}`;
  if (operation?.kind === "lead_call_outcome")
    return `Resultado del lead: ${operation.substatusCode || "Pendiente"}`;
  if (operation?.kind === "lead_resolve") return "Resolver y materializar lead";
  if (operation?.kind === "create_account") return "Crear cuenta";
  if (operation?.kind === "create_contact") return "Crear contacto";
  if (operation?.kind === "create_opportunity")
    return operation.title || "Crear oportunidad en esta cuenta";
  if (operation?.kind === "link_contact_to_opportunity")
    return operation.title || "Vincular contacto existente a una oportunidad";
  return `${formatCoachFieldLabel(operation?.field)}: ${operation?.value ?? "Valor pendiente"}`;
}

export function formatCoachFieldLabel(field) {
  const labels = {
    amountUsd: "Importe de la oportunidad",
    closeDate: "Fecha de cierre",
    name: "Nombre",
    phone: "Teléfono",
    website: "Sitio web",
    companyDescription: "Descripción de la empresa",
    firstName: "Nombre",
    lastName: "Apellido",
    email: "Correo",
    mobile: "Móvil",
    city: "Ciudad",
    stateRegion: "Estado o región",
    postalCode: "Código postal",
    registrationCode: "Código de registro",
    summary: "Resumen",
    sourceNotes: "Notas de origen",
    proposalName: "Nombre de cotización",
    quotationDate: "Fecha de cotización",
    introduction: "Introducción",
    paymentTerms: "Condiciones de pago",
    quotationVersionId: "Versión de cotización",
    sourceProposalId: "Propuesta de origen",
    templateId: "Plantilla",
    opportunityId: "Oportunidad",
    title: "Título",
    actionType: "Tipo de actividad",
    scheduledAt: "Fecha y hora",
    dueDate: "Fecha límite",
    priority: "Prioridad",
    notes: "Notas",
    successCriteria: "Criterio de éxito",
  };
  return labels[field] || field || "Cambio";
}
