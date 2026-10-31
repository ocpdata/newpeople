import { normalizeCustomerSearchText } from "./customer-record-list.js";
import { resolveCoachEntities } from "../coach/entity-resolver.js";
import { config } from "../config.js";
import { accountRecord, buildCustomerCoachSnapshot, opportunityRecords } from "./customer-chat-records.js";

function getValidatedContinuationEntities(snapshot, context) {
  if (!context || Number(context.accountId) !== Number(snapshot?.account?.id)) {
    return {};
  }
  const accountId = Number(snapshot.account.id);
  const opportunities = [
    ...(snapshot.opportunities || []),
    ...(snapshot.inactiveOpportunities || []),
    ...(snapshot.selectedOpportunity ? [snapshot.selectedOpportunity] : []),
  ];
  return {
    opportunity: opportunities.find(
      (item) =>
        Number(item.id) === Number(context.opportunityId) &&
        Number(item.accountId || accountId) === accountId,
    ),
    contact: (snapshot.contacts || []).find(
      (item) =>
        Number(item.id) === Number(context.contactId) &&
        Number(item.accountId || accountId) === accountId,
    ),
    lead: (snapshot.interactions || []).find(
      (item) =>
        Number(item.id) === Number(context.leadId) &&
        Number(item.accountId || accountId) === accountId,
    ),
  };
}

export function buildCustomerPlanEntityCandidates(
  snapshot,
  question,
  businessRules,
  conversationContext = null,
  selectedContext = {},
  availableTools = [],
) {
  const toolNames = new Set(
    (Array.isArray(availableTools) ? availableTools : []).map((tool) =>
      typeof tool === "string" ? tool : tool?.name,
    ),
  );
  const opportunityReadAllowed =
    toolNames.has("searchOpportunities") || toolNames.has("getOpportunity");
  const contactReadAllowed = toolNames.has("searchContacts");
  const leadReadAllowed = toolNames.has("searchLeads");
  const resolution = resolveCoachEntities(
    {
      accounts: accountRecord(snapshot),
      coachOpportunities: opportunityRecords(snapshot),
      contactMappings: snapshot.contacts || [],
      leads: buildCustomerCoachSnapshot(snapshot, null).leads,
    },
    question,
    businessRules,
    { ignoreStageFilters: true },
  );
  const continuation = getValidatedContinuationEntities(
    snapshot,
    conversationContext,
  );
  const activeSelection = getValidatedContinuationEntities(snapshot, {
    accountId: snapshot.account?.id,
    opportunityId: selectedContext.opportunityId,
    contactId: selectedContext.contactId,
    leadId: selectedContext.leadId,
  });
  const serverEntityCandidates = [];
  const buildCandidates = (entityType, records, project) => {
    const uniqueRecords = [];
    const seenIds = new Set();
    for (const record of records) {
      const id = Number(record?.id || 0);
      if (
        !id ||
        Number(record.accountId || snapshot.account?.id) !==
          Number(snapshot.account?.id) ||
        seenIds.has(id)
      ) {
        continue;
      }
      seenIds.add(id);
      uniqueRecords.push(record);
    }
    return uniqueRecords.slice(0, 8).map((record, index) => {
      const candidateKey = `${entityType}_${index + 1}`;
      serverEntityCandidates.push({
        candidateKey,
        entityType,
        recordId: Number(record.id),
        accountId: Number(record.accountId || snapshot.account?.id),
        referenceText: String(record.name || record.title || "")
          .trim()
          .slice(0, 180),
      });
      return { candidateKey, ...project(record) };
    });
  };
  const addContinuationCandidate = (records, entity) => {
    if (
      !entity ||
      records.some((item) => Number(item.id) === Number(entity.id))
    ) {
      return records;
    }
    return [...records.slice(0, 7), entity];
  };
  const normalizeReference = (value) => normalizeCustomerSearchText(value)
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const normalizedQuestion = ` ${normalizeReference(question)} `;
  const literalOpportunityMatches = opportunityReadAllowed
    ? opportunityRecords(snapshot).filter((record) => {
        const name = normalizeReference(record.name);
        return name && normalizedQuestion.includes(` ${name} `);
      })
    : [];
  const explicitOpportunityMatches = literalOpportunityMatches.filter((record) => {
    const name = normalizeReference(record.name);
    const nameOccurrences = normalizedQuestion.split(` ${name} `).length - 1;
    return !literalOpportunityMatches.some((other) => {
      const otherName = normalizeReference(other.name);
      return Number(other.id) !== Number(record.id) &&
        otherName.startsWith(`${name} `) &&
        normalizedQuestion.includes(` ${otherName} `) &&
        nameOccurrences === 1;
    });
  });
  const opportunityCandidates = explicitOpportunityMatches.length
    ? explicitOpportunityMatches
    : addContinuationCandidate(
        addContinuationCandidate(
          opportunityReadAllowed ? resolution.candidates.opportunities : [],
          opportunityReadAllowed ? continuation.opportunity : null,
        ),
        opportunityReadAllowed ? activeSelection.opportunity : null,
      );
  const contactRecords = addContinuationCandidate(
    addContinuationCandidate(
      contactReadAllowed ? resolution.candidates.contacts : [],
      contactReadAllowed ? continuation.contact : null,
    ),
    contactReadAllowed ? activeSelection.contact : null,
  );
  const leadRecords = addContinuationCandidate(
    addContinuationCandidate(
      leadReadAllowed ? resolution.candidates.leads : [],
      leadReadAllowed ? continuation.lead : null,
    ),
    leadReadAllowed ? activeSelection.lead : null,
  );
  return {
    publicCandidates: {
      opportunities: buildCandidates(
        "opportunity",
        opportunityCandidates,
        (item) => ({
          name: item.name,
          stageName: item.stageName,
          commercialStatusCode: item.commercialStatusCode,
        }),
      ),
      contacts: buildCandidates("contact", contactRecords, (item) => ({
        name: item.name,
        positionTitle: item.positionTitle,
      })),
      leads: buildCandidates("lead", leadRecords, (item) => ({
        name: item.name || item.title,
      })),
    },
    serverEntityCandidates,
  };
}

export function getValidatedContinuationReferences(snapshot, context) {
  const continuation = getValidatedContinuationEntities(snapshot, context);
  return [
    continuation.opportunity?.name,
    continuation.contact?.name,
    continuation.lead?.title,
  ].filter(Boolean);
}

export function buildCustomerQueryPlannerContext({
  question,
  context,
  conversationHistory,
  conversationContext,
  availableTools,
  catalog,
  snapshot,
  businessRules,
  allowedOperationKinds: effectiveAllowedOperationKinds = null,
  entityCandidates = null,
  researchAgents = [],
} = {}) {
  const permittedToolNames = (
    Array.isArray(availableTools) ? availableTools : []
  )
    .map((tool) => tool?.name)
    .filter(Boolean);
  const permittedToolNameSet = new Set(permittedToolNames);
  const validatedContinuationReferences = getValidatedContinuationReferences(
    snapshot,
    conversationContext,
  );
  return {
    question: String(question || "")
      .trim()
      .slice(0, 2000),
    recentConversation: (Array.isArray(conversationHistory)
      ? conversationHistory
      : []
    )
      .slice(-6)
      .map((message) => ({
        role: message.role,
        text: String(message.text || "").slice(0, 1200),
      })),
    selectedContext: {
      accountSelected: Boolean(context?.accountId),
      opportunitySelected: Boolean(context?.opportunityId),
      contactSelected: Boolean(context?.contactId),
    },
    selectedAccountName: snapshot?.account?.name || "",
    referenceDateTime: new Date().toISOString(),
    businessTimezone: snapshot?.businessTimezone || config.app.businessTimezone,
    pendingActivityIntent: conversationContext?.pendingActivityIntent || null,
    pendingActivity: conversationContext?.pendingActivity || null,
    pendingAmountSelection: conversationContext?.pendingAmountSelection ? {
      amount: conversationContext.pendingAmountSelection.amount,
      filters: conversationContext.pendingAmountSelection.filters,
      candidateKeys: (entityCandidates?.serverEntityCandidates || [])
        .filter((candidate) => candidate.entityType === "opportunity" &&
          conversationContext.pendingAmountSelection.candidateIds.includes(candidate.recordId))
        .map((candidate) => candidate.candidateKey),
    } : null,
    availableEvidenceSources: {
      selectedAccountCrm: Boolean(context?.accountId),
      preparedAgents: (Array.isArray(researchAgents) ? researchAgents : [])
        .filter((agent) => agent?.status === "completed" && agent?.agentId)
        .map((agent) => ({
          agentId: String(agent.agentId).slice(0, 80),
          evidenceCount: Array.isArray(agent.evidence)
            ? agent.evidence.length
            : 0,
        })),
    },
    plannerGuidance: [
      "Planifica lecturas CRM; las capacidades de investigación y sus resultados preparados se describen por separado.",
      "El contexto seleccionado identifica el alcance disponible, no implica que la pregunta se refiera a una oportunidad o contacto.",
      "Para solicitudes generales sobre la cuenta activa, resuelve el objetivo como account en active_context y no pidas seleccionar un registro hijo.",
      "Para crear un contacto, elige operationKind=create_contact solo si allowedOperationKinds lo permite. Usa la cuenta seleccionada como parent account con targetType=account, cardinality=single y source=active_context; el nombre del contacto nuevo es dato del borrador, no contactReference ni candidateKey. No pidas elegir un contacto existente.",
      "Para crear una oportunidad en la cuenta, elige operationKind=create_opportunity solo si allowedOperationKinds lo permite y deja que el formulario de Oportunidades seleccione el contacto requerido. La cuenta seleccionada es el alcance; el nombre de la nueva oportunidad no es opportunityReference ni candidateKey.",
      "Para cambiar el contacto asociado a una oportunidad existente, elige operationKind=link_contact_to_opportunity solo si está permitido. Usa IDs de oportunidad y contacto presentes en el snapshot autorizado, ambos de la cuenta seleccionada. No lo confundas con crear un mapeo jerárquico de contactos.",
      "Para preparar una actividad de calendario, usa operationKind=activity. No combines activityDraft.action=prepare con create_contact; al crear un contacto deja activityDraft.action=none.",
      "Distingue activityDraft.timing: completed significa que la actividad ya ocurrió y requiere status=done con la fecha/hora real en scheduledAt; scheduled significa futura y requiere status=pending con la fecha programada; si el tiempo no está claro, usa unclear y pregunta antes de crear la operación. Interpreta «la llamada que ya tuve», «ya realicé la llamada» o «ayer hablé» como completed; «quiero programar/agendar una llamada» como scheduled. Conserva tipo, timing, título y notas desde pendingActivityIntent cuando el vendedor responde una aclaración; no cambies una llamada pasada a futura ni pierdas la intención al pedir la oportunidad.",
      "«Registrar una llamada que hice hoy para agendar una reunión» pide registrar la llamada realizada (call, completed); agendar la reunión es su objetivo, no una segunda actividad autorizada. No inventes una hora cuando solo indica el día.",
      "Para editar o consultar un contacto existente, conserva la resolución estricta de candidato autorizado y no la confundas con create_contact.",
      "Pide aclaración solo si falta una referencia, periodo o dato indispensable para fijar el alcance; no declares ambiguo un objetivo que ya está resuelto.",
      "Si el objetivo, referenceResolution y ambiguity se contradicen, corrige el plan antes de devolverlo.",
      "pendingAmountSelection conserva una solicitud de cambio de monto a la espera de un objetivo individual. Una respuesta inequívoca con el nombre de un candidato continúa esa operación; una pregunta diferente que mencione ese nombre no es una selección.",
    ],
    allowedOperationKinds: Array.isArray(effectiveAllowedOperationKinds)
      ? effectiveAllowedOperationKinds
      : Array.isArray(businessRules?.operationPolicy?.allowedKinds)
        ? businessRules.operationPolicy.allowedKinds
        : [],
    validatedContinuation: conversationContext
      ? {
          opportunityName:
            [
              ...(snapshot?.opportunities || []),
              ...(snapshot?.inactiveOpportunities || []),
              ...(snapshot?.selectedOpportunity
                ? [snapshot.selectedOpportunity]
                : []),
            ].find(
              (item) =>
                Number(item.id) === Number(conversationContext.opportunityId),
            )?.name || "",
          contactName:
            (snapshot?.contacts || []).find(
              (item) =>
                Number(item.id) === Number(conversationContext.contactId),
            )?.name || "",
          leadTitle:
            (snapshot?.interactions || []).find(
              (item) => Number(item.id) === Number(conversationContext.leadId),
            )?.title || "",
          intents: conversationContext.intents || [],
          filters: conversationContext.filters || {},
        }
      : null,
    trustedContinuationReferences: validatedContinuationReferences,
    authorizedEntityCandidates:
      entityCandidates?.publicCandidates ||
      buildCustomerPlanEntityCandidates(
        snapshot || {},
        question,
        businessRules || {},
        conversationContext,
        context,
        availableTools,
      ).publicCandidates,
    permittedIntentCatalog: (Array.isArray(catalog) ? catalog : []).map(
      (intent) => ({
        code: intent.code,
        label: intent.label,
        description: intent.description,
        requiredContext: Array.isArray(intent.requiredContext)
          ? intent.requiredContext
          : Array.isArray(intent.context)
            ? intent.context
            : [],
        allowedTools: (Array.isArray(intent.allowedTools)
          ? intent.allowedTools
          : Array.isArray(intent.tools)
            ? intent.tools
            : []
        ).filter((toolName) => permittedToolNameSet.has(toolName)),
      }),
    ),
    permittedToolNames,
  };
}
