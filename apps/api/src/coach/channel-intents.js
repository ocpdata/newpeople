const CHANNEL_INTENTS = Object.freeze({
  customer_account: [
    {
      code: "crm_operation",
      label: "Operación CRM confirmable",
      description:
        "Solicitudes explícitas para crear o cambiar registros de la cuenta actual; siempre requieren revisión y confirmación.",
      tools: [
        "searchAccounts",
        "searchOpportunities",
        "getOpportunity",
        "getOpportunityActivities",
        "searchContacts",
      ],
      context: ["account"],
      examples: [
        "Actualiza el monto de esta oportunidad a 50000",
        "Agenda una llamada para confirmar el siguiente paso",
      ],
      patterns: [
        /\b(crea|crear|actualiza|actualizar|modifica|modificar|cambia|cambiar|registra|registrar|agenda|agendar)\b.*\b(cuenta|contacto|oportunidad|actividad|llamada|reunion|reunión)\b/,
      ],
      priority: 120,
    },
    {
      code: "email_draft",
      label: "Borrador de correo",
      description:
        "Prepara un borrador de correo usando solo datos autorizados de la cuenta.",
      tools: ["searchAccounts", "searchContacts"],
      context: ["account"],
      examples: ["Redacta un correo para el contacto de la cuenta"],
      patterns: [/\b(correo|email|outreach)\b/],
      priority: 110,
    },
    {
      code: "quotation_query",
      label: "Contenido de cotización",
      description:
        "Consulta la cotización autorizada de una oportunidad de la cuenta actual.",
      tools: [
        "searchAccounts",
        "searchOpportunities",
        "getOpportunity",
        "getOpportunityQuotation",
      ],
      context: ["account"],
      examples: ["¿Qué contiene la cotización para esta oportunidad?"],
      patterns: [
        /\b(cotizacion|cotizaciones|partidas cotizadas|productos cotizados|servicios cotizados)\b/,
      ],
      priority: 100,
    },
    {
      code: "contact_history",
      label: "Contactos e historial relacionado",
      description:
        "Lista los contactos visibles y sus interacciones CRM vinculadas.",
      tools: ["searchAccounts", "searchContacts", "searchInteractions"],
      context: ["account"],
      examples: [
        "Lista todos los contactos, sus datos y su historial en esta cuenta",
      ],
      patterns: [
        /\bcontactos?\b.*\b(datos?|historial|interacciones?|actividades?)\b/,
        /\b(datos?|historial|interacciones?|actividades?)\b.*\bcontactos?\b/,
      ],
      priority: 95,
    },
    {
      code: "opportunity_status",
      label: "Estado de oportunidad",
      description:
        "Consulta estado, etapa y activación de una oportunidad de esta cuenta.",
      tools: ["searchAccounts", "searchOpportunities", "getOpportunity"],
      context: ["account"],
      examples: ["¿Cuál es el estado actual de esta oportunidad?"],
      patterns: [
        /\b(oportunidad|esta oportunidad)\b.*\b(estado|estatus|situacion|etapa)\b/,
        /\b(estado|estatus|situacion|etapa)\b.*\boportunidad\b/,
      ],
      priority: 90,
    },
    {
      code: "opportunity_guidance",
      label: "Recomendaciones para oportunidad",
      description:
        "Recomienda siguientes pasos para la oportunidad seleccionada usando su detalle, readiness, actividades e interacciones CRM autorizadas.",
      tools: [
        "getOpportunity",
        "getOpportunityActivities",
        "getOpportunityReadiness",
        "searchInteractions",
      ],
      context: ["account", "opportunity"],
      examples: [
        "¿Qué me sugieres hacer en esta oportunidad?",
        "¿Cuál sería el siguiente paso para esta oportunidad?",
      ],
      patterns: [
        /\b(sugieres|recomiendas|recomendar|aconsejas)\b.*\boportunidad\b/,
        /\b(que deberia hacer|que hago|siguiente paso|proximo paso)\b.*\boportunidad\b/,
      ],
      priority: 92,
    },
    {
      code: "account_activity_history",
      label: "Historial de interacciones y actividades",
      description:
        "Lista las interacciones y actividades comerciales de la cuenta en el periodo solicitado.",
      tools: [
        "searchAccounts",
        "searchInteractions",
        "searchOpportunities",
        "getOpportunityActivities",
      ],
      context: ["account"],
      examples: [
        "Muéstrame todas las interacciones y actividades de los últimos seis meses",
      ],
      patterns: [
        /\b(interacciones?|actividades?)\b.*\b(todos?|todas?|ultimos?|historial|lista|muestr)/,
        /\b(todos?|todas?|ultimos?|historial|lista|muestr)\b.*\b(interacciones?|actividades?)\b/,
      ],
      priority: 85,
    },
    {
      code: "contact_query",
      label: "Contactos de cuenta",
      description:
        "Busca contactos y decisores relacionados con la cuenta actual.",
      tools: ["searchAccounts", "searchContacts"],
      context: ["account"],
      examples: ["¿Quiénes son los decisores de la cuenta?"],
      patterns: [/\b(contacto|contactos|decisor|decisores|persona|personas)\b/],
      priority: 60,
    },
    {
      code: "opportunity_query",
      label: "Oportunidades de cuenta",
      description:
        "Busca o resume oportunidades autorizadas de la cuenta actual.",
      tools: ["searchAccounts", "searchOpportunities", "getSellerPipeline"],
      context: ["account"],
      examples: ["¿Qué oportunidades abiertas tiene esta cuenta?"],
      patterns: [/\b(oportunidad|oportunidades|pipeline)\b/],
      priority: 50,
    },
    {
      code: "account_overview",
      label: "Resumen de cuenta",
      description:
        "Resume los datos básicos de la cuenta y, cuando estén disponibles, el conteo de oportunidades abiertas, pipeline y contactos desde lecturas CRM autorizadas. No afirmes interacciones si no se consultó searchInteractions.",
      tools: ["searchAccounts", "searchOpportunities", "searchContacts"],
      context: ["account"],
      examples: ["Resume esta cuenta"],
      patterns: [/.*/],
      priority: 0,
    },
  ],
  prospect: [
    {
      code: "conversion_request",
      label: "Conversión confirmable a CRM",
      description:
        "Prepara la revisión de una conversión; nunca crea un registro sin confirmación.",
      tools: [
        "getProspectProfile",
        "searchProspectContacts",
        "searchProspectHypotheses",
      ],
      context: ["prospectSession"],
      examples: ["Convierte esta hipótesis en una oportunidad CRM"],
      patterns: [
        /\b(convertir|convierte|crear en crm|dar de alta|registrar como cuenta|materializar)\b/,
      ],
      priority: 100,
    },
    {
      code: "outreach_draft",
      label: "Borrador de acercamiento",
      description:
        "Prepara un mensaje de acercamiento con el contexto de la sesión.",
      tools: [
        "getProspectProfile",
        "searchProspectContacts",
        "searchProspectFindings",
      ],
      context: ["prospectSession"],
      examples: ["Redacta un correo inicial para el contacto potencial"],
      patterns: [/\b(correo|email|outreach|mensaje|contactar|acercamiento)\b/],
      priority: 90,
    },
    {
      code: "public_research_review",
      label: "Evidencia pública de la sesión",
      description:
        "Resume evidencia pública que ya está presente en esta sesión, sin iniciar búsquedas nuevas.",
      tools: [
        "getProspectProfile",
        "searchProspectFindings",
        "searchProspectContacts",
      ],
      context: ["prospectSession"],
      examples: ["¿Qué fuentes públicas se encontraron sobre esta empresa?"],
      patterns: [
        /\b(fuentes? publicas?|investigacion externa|investiga|internet|web publica)\b/,
      ],
      priority: 85,
    },
    {
      code: "prospect_contacts",
      label: "Contactos potenciales",
      description:
        "Consulta contactos potenciales de la sesión, no contactos CRM confirmados.",
      tools: ["getProspectProfile", "searchProspectContacts"],
      context: ["prospectSession"],
      examples: ["¿Qué contactos potenciales encontramos?"],
      patterns: [/\b(contacto|contactos|decisor|responsable|persona)\b/],
      priority: 80,
    },
    {
      code: "opportunity_hypotheses",
      label: "Hipótesis de oportunidad",
      description: "Consulta hipótesis comerciales por validar en la sesión.",
      tools: [
        "getProspectProfile",
        "searchProspectHypotheses",
        "searchProspectFindings",
      ],
      context: ["prospectSession"],
      examples: ["¿Qué hipótesis de oportunidad tenemos?"],
      patterns: [
        /\b(oportunidad|oportunidades|hipotesis|hipótesis|reto|necesidad)\b/,
      ],
      priority: 70,
    },
    {
      code: "prospect_findings",
      label: "Hallazgos y evidencia del prospecto",
      description:
        "Consulta hallazgos e indicios registrados en la sesión del prospecto.",
      tools: ["getProspectProfile", "searchProspectFindings"],
      context: ["prospectSession"],
      examples: ["¿Qué hallazgos hay en la sesión?"],
      patterns: [
        /\b(hallazgo|hallazgos|evidencia|fuente|riesgo|investigacion|investigar)\b/,
      ],
      priority: 60,
    },
    {
      code: "prospect_profile",
      label: "Perfil del prospecto",
      description:
        "Consulta el perfil ingresado para la sesión de Cuenta nueva.",
      tools: ["getProspectProfile", "searchProspectFindings"],
      context: ["prospectSession"],
      examples: ["Resume el perfil de esta empresa"],
      patterns: [/.*/],
      priority: 0,
    },
  ],
});

function normalizeQuestion(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function getChannelIntentCatalog(channel) {
  return (CHANNEL_INTENTS[channel] || []).map((intent) => ({
    code: intent.code,
    label: intent.label,
    description: intent.description,
    examples: [...(intent.examples || [])],
    priority: intent.priority,
    tools: [...intent.tools],
    requiredContext: [...intent.context],
    enabled: true,
  }));
}

export function getChannelIntentDefaults(channel) {
  return (CHANNEL_INTENTS[channel] || []).map((intent) => ({
    code: intent.code,
    label: intent.label,
    description: intent.description,
    examples: [...(intent.examples || [])],
    priority: intent.priority,
    allowedTools: [...intent.tools],
    requiredContext: [...intent.context],
    enabled: true,
  }));
}

export function getChannelIntentPlanFields(channel, enabledIntentCodes = null) {
  const enabledCodes = Array.isArray(enabledIntentCodes)
    ? new Set(enabledIntentCodes)
    : null;
  const intentCodes = (CHANNEL_INTENTS[channel] || [])
    .map((intent) => intent.code)
    .filter((code) => !enabledCodes || enabledCodes.has(code));
  if (!intentCodes.length) return [];
  return [
    { key: "objective", type: "string", example: "Consultar oportunidades" },
    {
      key: "queries",
      type: "array",
      example: [],
      items: { type: "enum", enum: intentCodes },
    },
    ...(channel === "customer_account"
      ? [
          {
            key: "referenceResolution",
            type: "object",
            fields: [
              {
                key: "targetType",
                type: "enum",
                enum: [
                  "account",
                  "opportunity",
                  "contact",
                  "lead",
                  "quotation",
                  "none",
                ],
                example: "opportunity",
              },
              {
                key: "cardinality",
                type: "enum",
                enum: ["single", "multiple", "all", "none", "unknown"],
                example: "single",
              },
              {
                key: "source",
                type: "enum",
                enum: [
                  "current_message",
                  "conversation_history",
                  "active_context",
                  "account_scope",
                  "none",
                ],
                example: "conversation_history",
              },
              {
                key: "candidateKeys",
                type: "array",
                example: ["opportunity_1"],
                items: { type: "string", example: "opportunity_1" },
              },
            ],
          },
        ]
      : []),
    {
      key: "entities",
      type: "object",
      fields: [
        { key: "accountReference", type: "string", example: "" },
        { key: "opportunityReference", type: "string", example: "" },
        { key: "contactReference", type: "string", example: "" },
        { key: "leadReference", type: "string", example: "" },
      ],
    },
    {
      key: "filters",
      type: "object",
      fields: [
        {
          key: "opportunityStatus",
          type: "enum",
          enum: ["unspecified", "open", "historical", "all"],
          example: "unspecified",
        },
        { key: "stageCode", type: "string", example: "" },
        { key: "closeYear", type: "string", example: "" },
        { key: "periodMonths", type: "string", example: "" },
        { key: "startDate", type: "string", example: "" },
        { key: "endDate", type: "string", example: "" },
      ],
    },
    {
      key: "ambiguity",
      type: "object",
      fields: [
        {
          key: "reason",
          type: "enum",
          enum: [
            "none",
            "ambiguous_entity",
            "missing_context",
            "missing_period",
            "other_account",
            "out_of_scope",
          ],
          example: "none",
        },
        {
          key: "requiresClarification",
          type: "enum",
          enum: ["yes", "no"],
          example: "no",
        },
        {
          key: "missingContext",
          type: "array",
          example: [],
          items: {
            type: "enum",
            enum: ["account", "opportunity", "contact", "lead", "period"],
          },
        },
        { key: "question", type: "string", example: "" },
      ],
    },
    {
      key: "mode",
      type: "enum",
      enum: ["read_only", "operation", "clarification"],
      example: "read_only",
    },
    {
      key: "confidence",
      type: "enum",
      enum: ["high", "medium", "low"],
      example: "medium",
    },
  ];
}

export function getCustomerEvidenceReviewFields(enabledIntentCodes = null) {
  const enabled = Array.isArray(enabledIntentCodes)
    ? new Set(enabledIntentCodes)
    : null;
  const followUpQueryCodes = (CHANNEL_INTENTS.customer_account || [])
    .filter(
      (intent) =>
        !["crm_operation", "email_draft"].includes(intent.code) &&
        (!enabled || enabled.has(intent.code)),
    )
    .map((intent) => intent.code);
  return [
    {
      key: "status",
      type: "enum",
      enum: ["sufficient", "incomplete", "no_results", "clarification"],
      example: "sufficient",
    },
    {
      key: "missingQueries",
      type: "array",
      example: [],
      items: { type: "enum", enum: followUpQueryCodes },
    },
    {
      key: "missingFacts",
      type: "array",
      example: [],
      items: { type: "string", example: "Estado comercial de la oportunidad" },
    },
    {
      key: "clarificationQuestion",
      type: "string",
      example: "",
    },
  ];
}

export function getCustomerEvidenceAssessmentFields(enabledIntentCodes = null) {
  const followUpQueryCodes =
    getChannelIntentPlanFields("customer_account", enabledIntentCodes)
      .find((field) => field.key === "queries")
      ?.items?.enum?.filter(
        (code) => !["crm_operation", "email_draft"].includes(code),
      ) || [];
  return [
    {
      key: "status",
      type: "enum",
      enum: ["sufficient", "incomplete", "no_results", "clarification"],
      example: "sufficient",
    },
    {
      key: "missingQueries",
      type: "array",
      example: [],
      items: { type: "enum", enum: followUpQueryCodes },
    },
    {
      key: "missingFacts",
      type: "array",
      example: [],
      items: { type: "string", example: "Etapa comercial" },
    },
    { key: "clarificationQuestion", type: "string", example: "" },
  ];
}

function normalizePlanFilterText(value, pattern, maxLength = 80) {
  const text = String(value || "").trim();
  return text && pattern.test(text) ? text.slice(0, maxLength) : "";
}

function normalizePlanDate(value) {
  const date = normalizePlanFilterText(value, /^\d{4}-\d{2}-\d{2}$/, 10);
  if (!date) return "";
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date
    ? date
    : "";
}

function normalizeVerifiedEntityReference(value, sourceTexts = []) {
  const reference = String(value || "")
    .trim()
    .slice(0, 180);
  const normalizedReference = normalizeQuestion(reference);
  if (!normalizedReference) return "";
  const appearsInSource = sourceTexts.some((source) =>
    normalizeQuestion(source).includes(normalizedReference),
  );
  return appearsInSource ? reference : "";
}

export function normalizeChannelIntentPlan({
  channel,
  plan,
  serverEntityCandidates = [],
  availableTools = [],
  context = {},
  configuration = null,
  question = "",
  conversationHistory = [],
  trustedEntityReferences = [],
} = {}) {
  const catalog = CHANNEL_INTENTS[channel];
  if (!catalog || !plan || typeof plan !== "object") return null;

  const configurationByCode = new Map(
    (Array.isArray(configuration) ? configuration : []).map((item) => [
      item.code,
      item,
    ]),
  );
  const requestedCodes = Array.isArray(plan.queries) ? plan.queries : [];
  const selectedIntents = catalog.filter(({ code }) => {
    const config = configurationByCode.get(code);
    return requestedCodes.includes(code) && config?.enabled !== false;
  });
  const rawReferenceResolution = plan.referenceResolution || {};
  const targetTypes = new Set([
    "account",
    "opportunity",
    "contact",
    "lead",
    "quotation",
    "none",
  ]);
  const cardinalities = new Set([
    "single",
    "multiple",
    "all",
    "none",
    "unknown",
  ]);
  const referenceSources = new Set([
    "current_message",
    "conversation_history",
    "active_context",
    "account_scope",
    "none",
  ]);
  let targetType = targetTypes.has(rawReferenceResolution.targetType)
    ? rawReferenceResolution.targetType
    : "none";
  const cardinality = cardinalities.has(rawReferenceResolution.cardinality)
    ? rawReferenceResolution.cardinality
    : "none";
  const referenceSource = referenceSources.has(rawReferenceResolution.source)
    ? rawReferenceResolution.source
    : "none";
  const candidateByKey = new Map(
    (Array.isArray(serverEntityCandidates) ? serverEntityCandidates : [])
      .filter(
        (candidate) =>
          candidate?.candidateKey &&
          Number(candidate.recordId) > 0 &&
          Number(candidate.accountId) === Number(context.accountId) &&
          ["opportunity", "contact", "lead"].includes(candidate.entityType),
      )
      .map((candidate) => [candidate.candidateKey, candidate]),
  );
  let candidateKeys = Array.isArray(rawReferenceResolution.candidateKeys)
    ? [...new Set(rawReferenceResolution.candidateKeys)].slice(0, 8)
    : [];
  let selectedCandidates = candidateKeys.map((key) =>
    candidateByKey.get(key),
  );
  const rawEntities = plan.entities || {};
  const sourceTexts = [
    question,
    ...(Array.isArray(conversationHistory)
      ? conversationHistory.map((message) => message?.text || "")
      : []),
    ...(Array.isArray(trustedEntityReferences) ? trustedEntityReferences : []),
  ];
  const entityReferenceFields = [
    ["opportunity", rawEntities.opportunityReference],
    ["contact", rawEntities.contactReference],
    ["lead", rawEntities.leadReference],
  ]
    .map(([entityType, value]) => ({
      entityType,
      value: String(value || "").trim(),
      normalized: normalizeQuestion(value),
    }))
    .filter(
      (reference) =>
        reference.normalized &&
        sourceTexts.some((source) =>
          normalizeQuestion(source).includes(reference.normalized),
        ),
    );
  const literalCandidateMatches = entityReferenceFields.flatMap((reference) =>
    [...candidateByKey.values()].filter(
      (candidate) =>
        candidate.entityType === reference.entityType &&
        normalizeQuestion(candidate.referenceText) === reference.normalized,
    ),
  );
  const unresolvedModelReference =
    Boolean(plan.referenceResolution) &&
    candidateKeys.length === 0 &&
    entityReferenceFields.length > 0 &&
    literalCandidateMatches.length !== 1;
  if (
    Boolean(plan.referenceResolution) &&
    candidateKeys.length === 0 &&
    cardinality === "single" &&
    literalCandidateMatches.length === 1
  ) {
    const [literalCandidate] = literalCandidateMatches;
    targetType = literalCandidate.entityType;
    candidateKeys = [literalCandidate.candidateKey];
    selectedCandidates = [literalCandidate];
  }
  const targetMatchesCandidate = (candidate) =>
    candidate &&
    (candidate.entityType === targetType ||
      (targetType === "quotation" && candidate.entityType === "opportunity"));
  const invalidCandidateSelection =
    selectedCandidates.some((candidate) => !targetMatchesCandidate(candidate)) ||
    (cardinality === "single" && candidateKeys.length > 1) ||
    (cardinality === "none" && candidateKeys.length > 0) ||
    unresolvedModelReference;
  const unresolvedConversationalReference =
    ["conversation_history", "active_context"].includes(referenceSource) &&
    ["opportunity", "contact", "lead", "quotation"].includes(targetType) &&
    cardinality === "single" &&
    candidateKeys.length === 0;
  const operationNeedsSingleTarget =
    selectedIntents.some((intent) => intent.code === "crm_operation") &&
    (targetType === "none" || cardinality !== "single");
  const validatedCandidateKeys = selectedCandidates
    .filter(targetMatchesCandidate)
    .map((candidate) => candidate.candidateKey);
  const singleSelectedCandidate =
    !invalidCandidateSelection &&
    cardinality === "single" &&
    selectedCandidates.length === 1
      ? selectedCandidates[0]
      : null;
  const serverResolvedEntityIds = {
    opportunityId:
      singleSelectedCandidate &&
      ["opportunity", "quotation"].includes(targetType) &&
      singleSelectedCandidate.entityType === "opportunity"
        ? Number(singleSelectedCandidate.recordId)
        : null,
    contactId:
      singleSelectedCandidate && targetType === "contact"
        ? Number(singleSelectedCandidate.recordId)
        : null,
    leadId:
      singleSelectedCandidate && targetType === "lead"
        ? Number(singleSelectedCandidate.recordId)
        : null,
  };
  const rawAmbiguity = plan.ambiguity || {};
  const ambiguityReasons = new Set([
    "none",
    "ambiguous_entity",
    "missing_context",
    "missing_period",
    "other_account",
    "out_of_scope",
  ]);
  const ambiguityReason = ambiguityReasons.has(rawAmbiguity.reason)
    ? rawAmbiguity.reason
    : "none";
  const plannerRequestedClarification =
    rawAmbiguity.requiresClarification === "yes" ||
    plan.mode === "clarification" ||
    invalidCandidateSelection ||
    unresolvedConversationalReference ||
    operationNeedsSingleTarget;
  if (!selectedIntents.length && !plannerRequestedClarification) return null;

  const availableNames = new Set(
    availableTools.map((tool) =>
      typeof tool === "string" ? tool : tool?.name,
    ),
  );
  const allowedContextKeys = new Set([
    "account",
    "opportunity",
    "contact",
    "lead",
  ]);
  const requiredContext = [
    ...new Set(
      selectedIntents.flatMap((intent) => {
        const configuredContext = configurationByCode.get(
          intent.code,
        )?.requiredContext;
        return [
          ...intent.context,
          ...(Array.isArray(configuredContext) ? configuredContext : []),
        ].filter((key) => allowedContextKeys.has(key));
      }),
    ),
  ];
  const contextValues = {
    account: context.accountId,
    opportunity: context.opportunityId || serverResolvedEntityIds.opportunityId,
    contact: context.contactId || serverResolvedEntityIds.contactId,
    lead: context.leadId || serverResolvedEntityIds.leadId,
  };
  const rawFilters = plan.filters || {};
  const hasRequiredContext = (key) => {
    if (key === "period") {
      return (
        Number(rawFilters.periodMonths || 0) > 0 ||
        Boolean(normalizePlanDate(rawFilters.startDate)) &&
          Boolean(normalizePlanDate(rawFilters.endDate))
      );
    }
    return Number(contextValues[key] || 0) > 0;
  };
  const reportedMissingContext = [
    ...new Set(
      (Array.isArray(rawAmbiguity.missingContext)
        ? rawAmbiguity.missingContext
        : []
      ).filter((key) =>
        ["account", "opportunity", "contact", "lead", "period"].includes(
          key,
        ),
      ),
    ),
  ];
  const unresolvedReportedContext = reportedMissingContext.filter(
    (key) => !hasRequiredContext(key),
  );
  const missingContext = [
    ...new Set([
      ...requiredContext.filter((key) => !hasRequiredContext(key)),
      ...unresolvedReportedContext,
    ]),
  ];
  const plannerOnlyReportedMissingContext =
    ambiguityReason === "missing_context" &&
    reportedMissingContext.length > 0 &&
    unresolvedReportedContext.length === 0 &&
    missingContext.length === 0 &&
    plan.confidence !== "low";
  const clarificationRequested =
    plannerRequestedClarification && !plannerOnlyReportedMissingContext;
  const allowedTools = [
    ...new Set(
      selectedIntents.flatMap((intent) => {
        const config = configurationByCode.get(intent.code);
        if (config?.enabled === false) return [];
        const configuredTools = Array.isArray(config?.allowedTools)
          ? config.allowedTools
          : intent.tools;
        const hardAllowedTools = new Set(intent.tools);
        return configuredTools.filter(
          (tool) => hardAllowedTools.has(tool) && availableNames.has(tool),
        );
      }),
    ),
  ];
  const periodMonths = Number(rawFilters.periodMonths || 0);
  const closeYear = Number(rawFilters.closeYear || 0);
  const opportunityStatus = [
    "unspecified",
    "open",
    "historical",
    "all",
  ].includes(rawFilters.opportunityStatus)
    ? rawFilters.opportunityStatus
    : "unspecified";
  let startDate = normalizePlanDate(rawFilters.startDate);
  let endDate = normalizePlanDate(rawFilters.endDate);
  if (startDate && endDate && startDate > endDate) {
    startDate = "";
    endDate = "";
  }
  const confidenceScores = { high: 0.9, medium: 0.65, low: 0.35 };
  const confidence = confidenceScores[plan.confidence] ?? 0.35;
  const mode =
    clarificationRequested || missingContext.length || plan.confidence === "low"
      ? "clarification"
      : selectedIntents.some((intent) => intent.code === "crm_operation")
        ? "operation"
        : "query";
  const primaryIntent =
    selectedIntents.find((intent) => intent.code === "crm_operation") ||
    selectedIntents[0];
  return {
    channel,
    source: "structured_plan",
    intent: primaryIntent?.code || "clarification",
    intents: selectedIntents.map((intent) => intent.code),
    objective: String(plan.objective || "")
      .trim()
      .slice(0, 500),
    entities: {
      accountReference: normalizeVerifiedEntityReference(
        rawEntities.accountReference,
        sourceTexts,
      ),
      opportunityReference: normalizeVerifiedEntityReference(
        rawEntities.opportunityReference,
        sourceTexts,
      ),
      contactReference: normalizeVerifiedEntityReference(
        rawEntities.contactReference,
        sourceTexts,
      ),
      leadReference: normalizeVerifiedEntityReference(
        rawEntities.leadReference,
        sourceTexts,
      ),
    },
    ...(plan.referenceResolution
      ? {
          referenceResolution: {
            targetType,
            cardinality,
            source: referenceSource,
            candidateKeys: validatedCandidateKeys,
          },
        }
      : {}),
    serverResolvedEntityIds,
    filters: {
      opportunityStatus,
      stageCode: normalizePlanFilterText(
        rawFilters.stageCode,
        /^[a-z0-9_]{1,60}$/i,
      ),
      closeYear:
        Number.isInteger(closeYear) && closeYear >= 2000 && closeYear <= 2100
          ? closeYear
          : null,
      periodMonths:
        Number.isInteger(periodMonths) &&
        periodMonths >= 1 &&
        periodMonths <= 60
          ? periodMonths
          : null,
      startDate,
      endDate,
    },
    ambiguity: {
      reason:
        invalidCandidateSelection || operationNeedsSingleTarget
          ? "ambiguous_entity"
          : ambiguityReason,
      requiresClarification: mode === "clarification",
      clarificationQuestion: String(
        rawAmbiguity.question ||
          (invalidCandidateSelection || operationNeedsSingleTarget
            ? "No pude validar el registro seleccionado. Indica cuál registro quieres usar."
            : ""),
      )
        .trim()
        .slice(0, 500),
      missingContext,
    },
    confidence,
    label: primaryIntent?.label || "Aclaración necesaria",
    requiredContext,
    missingContext,
    allowedTools: mode === "clarification" ? [] : allowedTools,
    requiresClarification: mode === "clarification",
    mode,
  };
}

export function classifyChannelIntent({
  channel,
  question = "",
  availableTools = [],
  context = {},
  configuration = null,
} = {}) {
  const catalog = CHANNEL_INTENTS[channel];
  if (!catalog) return null;
  const text = normalizeQuestion(question);
  const configurationByCode = new Map(
    (Array.isArray(configuration) ? configuration : []).map((item) => [
      item.code,
      item,
    ]),
  );
  const candidates = [...catalog]
    .map((intent) => ({
      intent,
      config: configurationByCode.get(intent.code),
    }))
    .filter(({ config }) => config?.enabled !== false)
    .map(({ intent, config }) => {
      const examples = Array.isArray(config?.examples)
        ? config.examples
        : intent.examples || [];
      const configuredMatch = examples.some((example) => {
        const normalizedExample = normalizeQuestion(example);
        return normalizedExample && text.includes(normalizedExample);
      });
      return {
        intent,
        config,
        matches:
          intent.patterns.some((pattern) => pattern.test(text)) ||
          configuredMatch,
        priority: Number.isFinite(Number(config?.priority))
          ? Number(config.priority)
          : intent.priority,
      };
    })
    .filter((item) => item.matches)
    .sort((left, right) => right.priority - left.priority);
  const selectedCandidate = candidates[0];
  if (!selectedCandidate) return null;
  const { intent: selected, config } = selectedCandidate;
  const availableNames = new Set(
    availableTools.map((tool) =>
      typeof tool === "string" ? tool : tool?.name,
    ),
  );
  const hardAllowedTools = new Set(selected.tools);
  const configuredTools = Array.isArray(config?.allowedTools)
    ? config.allowedTools
    : selected.tools;
  const allowedTools = configuredTools.filter(
    (tool) => hardAllowedTools.has(tool) && availableNames.has(tool),
  );
  const contextValues = {
    account: context.accountId,
    opportunity: context.opportunityId,
    contact: context.contactId,
    prospectSession: context.prospectSessionId,
  };
  const requiredContext = Array.isArray(config?.requiredContext)
    ? config.requiredContext
    : selected.context;
  const missingContext = requiredContext.filter(
    (key) => !(Number(contextValues[key] || 0) > 0),
  );
  return {
    channel,
    intent: selected.code,
    label: selected.label,
    confidence: 0.95,
    requiredContext: [...requiredContext],
    missingContext,
    allowedTools,
    requiresClarification: missingContext.length > 0,
    mode: ["conversion_request", "crm_operation"].includes(selected.code)
      ? "operation"
      : "query",
  };
}
