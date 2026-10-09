import { runStructuredTextResearch } from "../structuredWebResearch.js";
import { config } from "../config.js";
import { buildCustomerActivityDraftResponse } from "./activity-draft.js";
import { resolveCoachEntities } from "../coach/entity-resolver.js";
import { executeCoachReadTool } from "../coach/crm-read-tools.js";
import { runConversationEngine } from "../coach/conversation-engine.js";
import { normalizeActivityOperation } from "../coach/operation-contract.js";
import { filterValidCoachOperations } from "../coach/contract.js";
import {
  buildStageReadiness,
  isStagePreparationQuestion,
} from "../coach/stage-readiness.js";
import {
  getCoachReadToolCatalog,
  inferCoachOpportunityFilters,
} from "../coach/read-tools.js";
import { loadCoachBusinessRules } from "../coach/business-rules.js";
import { listCoachAdminRules } from "../coach/admin-rules.js";
import { summarizeCoachToolResults } from "../coach/observability.js";
import { matchCoachQueryCase } from "../coach/case-catalog.js";
import {
  getChannelIntentPlanFields,
  getCustomerEvidenceAssessmentFields,
  normalizeChannelIntentPlan,
} from "../coach/channel-intents.js";
import { getAuthorizedCoachQuotationContent } from "../coach/quotation-read-service.js";
import { loadChannelIntentConfigurations } from "../coach/channel-intent-governance.js";
import {
  buildCustomerContactHistoryResponse,
  buildCustomerActivityHistoryResponse,
  getCustomerActivityHistoryRange,
  getCustomerActivityHistoryRangeFromFilters,
} from "./activity-history.js";
import {
  CUSTOMER_CHAT_EVIDENCE_LIMITS,
  normalizeCustomerEvidenceAssessment,
  runCustomerEvidenceLoop,
} from "./customer-chat-evidence.js";

const COACH_READ_TOOL_CATALOG = getCoachReadToolCatalog();
const COACH_READ_TOOL_NAMES = new Set(
  COACH_READ_TOOL_CATALOG.map((tool) => tool.name),
);
const ANSWER_AUDIT_EVIDENCE_FIELDS = [
  "id",
  "entityType",
  "name",
  "accountId",
  "accountName",
  "amountUsd",
  "closeDate",
  "stageCode",
  "stageName",
  "activationStatusCode",
  "activationStatusName",
  "commercialStatusCode",
  "lifecycle",
  "opportunityId",
  "opportunityName",
  "contactId",
  "contactName",
  "positionTitle",
  "title",
  "status",
  "dueDate",
];

function summarizeAnswerAuditEvidence(authorizedEvidence) {
  return authorizedEvidence.slice(0, 20).map((item) => {
    const rawResult = item?.result;
    const records = Array.isArray(rawResult)
      ? rawResult
      : rawResult && typeof rawResult === "object"
        ? [rawResult]
        : [];
    return {
      toolName: String(item?.toolName || "unknown").slice(0, 80),
      sourceDomain: String(item?.sourceDomain || "unknown").slice(0, 40),
      queryFailed: Boolean(item?.queryFailed),
      resultCount: Array.isArray(rawResult)
        ? rawResult.length
        : rawResult == null
          ? 0
          : 1,
      records: records.slice(0, 20).map((record) => {
        const summary = Object.fromEntries(
          ANSWER_AUDIT_EVIDENCE_FIELDS.filter(
            (field) => record?.[field] !== undefined,
          ).map((field) => [
            field,
            typeof record[field] === "string"
              ? record[field].slice(0, 240)
              : record[field],
          ]),
        );
        if (item.sourceDomain === "public_web") {
          summary.publicSource = {
            title: String(record?.title || record?.name || "").slice(0, 200),
            summary: String(record?.summary || "").slice(0, 800),
            evidence: String(
              record?.evidenceText || record?.evidence || "",
            ).slice(0, 1000),
            sourceUrl: String(
              record?.sourceUrl || record?.sourceReference || "",
            ).slice(0, 500),
            confidence: record?.confidence || "low",
            certainty: record?.certainty || "evidenced",
          };
        }
        if (record?.associatedContact) {
          summary.associatedContact = {
            name: String(record.associatedContact.name || "").slice(0, 160),
            positionTitle: String(
              record.associatedContact.positionTitle ||
                record.associatedContact.position_title ||
                "",
            ).slice(0, 160),
          };
        }
        return summary;
      }),
    };
  });
}

function buildCustomerPublicResearchEvidence(agents) {
  return (Array.isArray(agents) ? agents : [])
    .filter(
      (agent) =>
        agent?.status === "completed" &&
        agent?.sourceDomain === "public_web" &&
        Array.isArray(agent.findings),
    )
    .flatMap((agent) =>
      agent.findings.map((finding) => ({
        agentId: String(agent.agentId || "public_research").slice(0, 80),
        title: String(finding.title || "").slice(0, 200),
        summary: String(finding.summary || "").slice(0, 1200),
        evidence: String(
          finding.evidenceText || finding.evidence || "",
        ).slice(0, 1600),
        sourceUrl: String(
          finding.sourceUrl || finding.sourceReference || "",
        ).slice(0, 500),
        confidence: ["high", "medium", "low"].includes(finding.confidence)
          ? finding.confidence
          : "low",
        certainty: String(finding.certainty || "evidenced").slice(0, 40),
      })),
    )
    .filter((finding) => finding.title || finding.summary || finding.evidence)
    .slice(0, 24);
}

function buildCustomerPublicSourceLinks(publicEvidence) {
  const seenUrls = new Set();
  return publicEvidence.flatMap((finding) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(finding.sourceUrl);
    } catch {
      return [];
    }
    if (
      !["http:", "https:"].includes(parsedUrl.protocol) ||
      seenUrls.has(parsedUrl.href)
    ) {
      return [];
    }
    seenUrls.add(parsedUrl.href);
    return [
      {
        title: finding.title || parsedUrl.hostname,
        url: parsedUrl.href,
        sourceUrl: parsedUrl.href,
        domain: parsedUrl.hostname,
        sourceDomain: "public_web",
        confidence: finding.confidence,
        certainty: finding.certainty,
      },
    ];
  });
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isOpen(opportunity) {
  return opportunity?.lifecycle === "open";
}

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

function accountRecord(snapshot) {
  return snapshot.account
    ? [{ ...snapshot.account, accountId: snapshot.account.id }]
    : [];
}

function opportunityRecords(snapshot) {
  const accountId = Number(snapshot.account?.id || 0);
  const opportunities = new Map();
  for (const opportunity of [
    ...(snapshot.opportunities || []),
    ...(snapshot.inactiveOpportunities || []),
    ...(snapshot.selectedOpportunity ? [snapshot.selectedOpportunity] : []),
  ]) {
    if (Number(opportunity.accountId || 0) === accountId) {
      opportunities.set(Number(opportunity.id), opportunity);
    }
  }
  return [...opportunities.values()];
}

function scopeCustomerSnapshot(snapshot) {
  const accountId = Number(snapshot.account?.id || 0);
  if (!accountId) {
    return {
      ...snapshot,
      selectedOpportunity: null,
      opportunities: [],
      inactiveOpportunities: [],
      contacts: [],
      interactions: [],
      activities: [],
      opportunityActivities: [],
      calendarActivities: [],
    };
  }
  const isInScope = (record) => Number(record.accountId || 0) === accountId;
  const opportunities = (snapshot.opportunities || []).filter(isInScope);
  const inactiveOpportunities = (snapshot.inactiveOpportunities || []).filter(
    isInScope,
  );
  const selectedOpportunity = isInScope(snapshot.selectedOpportunity || {})
    ? snapshot.selectedOpportunity
    : null;
  const opportunityIds = new Set(
    [
      ...opportunities,
      ...inactiveOpportunities,
      ...(selectedOpportunity ? [selectedOpportunity] : []),
    ].map((opportunity) => Number(opportunity.id)),
  );
  const contacts = (snapshot.contacts || []).filter(isInScope);
  const interactions = (snapshot.interactions || []).filter(isInScope);
  const activities = (snapshot.activities || []).filter(
    (activity) =>
      isInScope(activity) &&
      (!activity.opportunityId ||
        opportunityIds.has(Number(activity.opportunityId))),
  );
  const opportunityActivities = (snapshot.opportunityActivities || []).filter(
    (activity) => Number(activity.accountId || 0) === accountId,
  );
  const calendarActivities = (snapshot.calendarActivities || []).filter(
    (activity) => Number(activity.accountId || 0) === accountId,
  );
  return {
    ...snapshot,
    selectedOpportunity,
    opportunities,
    inactiveOpportunities,
    contacts,
    interactions,
    activities,
    opportunityActivities,
    calendarActivities,
  };
}

function buildCustomerCoachSnapshot(snapshot, quotation) {
  const account = snapshot.account;
  const accountId = Number(account?.id || 0) || null;
  const accountName = account?.name || "";
  const contactsById = new Map(
    (snapshot.contacts || []).map((contact) => [Number(contact.id), contact]),
  );
  const activities = snapshot.activities || snapshot.interactions || [];
  const opportunities = opportunityRecords(snapshot).map((opportunity) => ({
    ...opportunity,
    account: { id: accountId, name: accountName },
    associatedContact:
      snapshot.permissions?.canReadContacts === true &&
      Number(opportunity.contactId || 0) > 0 &&
      Number(opportunity.accountId || accountId) === accountId
        ? (() => {
            const contact = contactsById.get(Number(opportunity.contactId));
            return contact &&
              Number(contact.accountId || 0) === accountId &&
              contact.activationStatusCode === "activado"
              ? {
                  name: contact.name || "",
                  positionTitle: contact.positionTitle || "",
                }
              : null;
          })()
        : null,
    activities: activities.filter(
      (activity) =>
        Number(activity.opportunityId || 0) === Number(opportunity.id),
    ),
  }));
  const leads = (snapshot.interactions || [])
    .filter(
      (interaction) =>
        interaction.leadSubstatusCode ||
        interaction.leadReasonCode ||
        interaction.leadRequiredActionCode,
    )
    .map((interaction) => ({
      ...interaction,
      title: interaction.title,
      accountId,
      accountName,
      opportunityId: Number(interaction.opportunityId || 0) || null,
      status: interaction.leadSubstatusCode || "",
    }));
  return {
    accounts: accountRecord(snapshot),
    coachOpportunities: opportunities,
    wonOpportunities: [],
    lostOpportunities: [],
    cancelledOpportunities: [],
    inactivePipelineOpportunities: [],
    contactMappings: snapshot.contacts || [],
    leads,
    selectedOpportunityQuotation: quotation,
  };
}

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

function buildCustomerPlanEntityCandidates(
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
  const opportunityCandidates = addContinuationCandidate(
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

function getValidatedContinuationReferences(snapshot, context) {
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
  const permittedToolNames = (Array.isArray(availableTools) ? availableTools : [])
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
    pendingActivity: conversationContext?.pendingActivity || null,
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
      "Para editar o consultar un contacto existente, conserva la resolución estricta de candidato autorizado y no la confundas con create_contact.",
      "Pide aclaración solo si falta una referencia, periodo o dato indispensable para fijar el alcance; no declares ambiguo un objetivo que ya está resuelto.",
      "Si el objetivo, referenceResolution y ambiguity se contradicen, corrige el plan antes de devolverlo.",
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

function executeCustomerReadTool({
  toolName,
  snapshot,
  args = {},
  businessRules = {},
  buildReadiness,
}) {
  if (COACH_READ_TOOL_NAMES.has(toolName)) {
    return executeCoachReadTool({
      toolName,
      snapshot,
      args,
      businessRules,
      buildReadiness,
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
}) {
  snapshot = scopeCustomerSnapshot(snapshot || {}); // Ensure snapshot is scoped correctly
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
  const selectedOpportunityQuotation =
    quotationRequested &&
    selectedOpportunity &&
    scope.opportunitySearchAllowed !== false &&
    scope.quotationSearchAllowed !== false &&
    toolNames.has("getOpportunityQuotation")
      ? await getAuthorizedCoachQuotationContent({
          user,
          opportunityId: selectedOpportunity.id,
        })
      : null;
  const coachSnapshot = buildCustomerCoachSnapshot(
    snapshot,
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
  let initialReadQueryCount = selectedOpportunityQuotation ? 1 : 0;
  const skippedAuthorizedTools = [];
  const availableNames = new Set(availableTools.map((tool) => tool.name));
  const pushTool = (toolName, args = {}) => {
    if (!availableNames.has(toolName)) return;
    const quotationAlreadyFetched =
      toolName === "getOpportunityQuotation" &&
      Boolean(selectedOpportunityQuotation);
    if (
      !quotationAlreadyFetched &&
      initialReadQueryCount >= CUSTOMER_CHAT_EVIDENCE_LIMITS.maxReadQueries
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
    readToolResults.push(result);
  };
  if (routeAllows("searchAccounts")) pushTool("searchAccounts");
  if (
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
    pushTool("searchContacts");
  }
  if (
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
    pushTool("getOpportunity", { opportunityId: selectedOpportunity.id });
  }
  if (
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

function buildCustomerAccountOverviewResponse(snapshot, readToolResults = []) {
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

function buildCustomerDeterministicResponse({
  snapshot,
  question,
  routing,
  permissions,
  allowedOperationKinds,
}) {
  const intentResponse = buildCustomerIntentResponse({
    snapshot,
    question,
    routing,
    permissions,
    allowedOperationKinds,
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

function getDeadlineSignal(deadlineAt) {
  if (!Number.isFinite(Number(deadlineAt))) return null;
  const remainingMs = Math.max(0, Math.floor(Number(deadlineAt) - Date.now()));
  return remainingMs > 0
    ? AbortSignal.timeout(remainingMs)
    : AbortSignal.abort();
}

function permissionGranted(permissions, permissionCode) {
  if (typeof permissions?.has === "function") {
    return permissions.has(permissionCode);
  }
  if (Array.isArray(permissions)) return permissions.includes(permissionCode);
  if (Array.isArray(permissions?.codes)) {
    return permissions.codes.includes(permissionCode);
  }
  return permissions?.[permissionCode] === true;
}

function formatUsd(value) {
  return `USD ${Number(value || 0).toLocaleString("es-MX")}`;
}

function resolveCustomerOpportunity(snapshot, question) {
  const resolution = resolveCoachEntities(
    {
      accounts: accountRecord(snapshot),
      coachOpportunities: opportunityRecords(snapshot),
    },
    question,
    {},
    { ignoreStageFilters: true },
  );
  return resolution.opportunity || snapshot.selectedOpportunity || null;
}

function isExplicitCustomerAmountChange(question) {
  const normalizedQuestion = normalize(question);
  return (
    /\b(?:actualiza|actualizar|cambia|cambiar|modifica|modificar|ajusta|ajustar|sube|subir|incrementa|incrementar|reduce|reducir|baja|bajar)\b/.test(
      normalizedQuestion,
    ) && /\b(?:monto|importe)\b/.test(normalizedQuestion)
  );
}

function buildCustomerEmailDraft(snapshot, question, contactReadAllowed) {
  const contacts =
    contactReadAllowed && Array.isArray(snapshot.contacts)
      ? snapshot.contacts
      : [];
  const normalizedQuestion = normalize(question)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const questionWords = new Set(normalizedQuestion.split(/\s+/));
  const matchingContacts = contacts.filter((contact) => {
    const name = normalize(contact.name).trim();
    const nameWords = name.split(/\s+/).filter(Boolean);
    return (
      (name && normalizedQuestion.includes(name)) ||
      (nameWords.length && questionWords.has(nameWords[0]))
    );
  });
  const selectedContact = snapshot.selectedContext?.contactId
    ? contacts.find(
        (contact) =>
          Number(contact.id) === Number(snapshot.selectedContext.contactId),
      )
    : null;
  const recipient =
    matchingContacts.length === 1 ? matchingContacts[0] : selectedContact;
  const accountName = snapshot.account?.name || "la cuenta";
  const greetingName = recipient?.name?.trim().split(/\s+/)[0] || "";
  const greeting = greetingName ? `Hola ${greetingName},` : "Hola,";
  const subject = `Conversación sobre nuevas oportunidades para ${accountName}`;
  const body = [
    greeting,
    "",
    `Me gustaría coordinar una breve conversación para conocer tus prioridades y explorar nuevas oportunidades en las que podamos apoyar a ${accountName}.`,
    "",
    "¿Tendrías disponibilidad para reunirnos en los próximos días?",
    "",
    "Saludos,",
    "[Tu nombre]",
  ].join("\n");
  return {
    answer: `Borrador de correo${recipient ? ` para ${recipient.name}` : ""}\nAsunto: ${subject}\n\n${body}\n\nNo se envió el correo.`,
    evidence: [
      `Borrador preparado con el nombre de cuenta autorizado: ${accountName}.`,
      ...(recipient
        ? [`Contacto autorizado seleccionado: ${recipient.name}.`]
        : []),
    ],
    inferences: [],
    confidence: recipient ? "high" : "medium",
    recommendedActions: [],
    operations: [],
    source: "account_intelligence",
  };
}

export function buildCustomerIntentResponse({
  snapshot,
  question,
  routing,
  permissions,
  allowedOperationKinds,
} = {}) {
  if (routing?.intent === "email_draft") {
    return buildCustomerEmailDraft(
      snapshot || {},
      question || "",
      routing.allowedTools?.includes("searchContacts") === true,
    );
  }
  if (routing?.intent !== "crm_operation") return null;

  const normalizedQuestion = normalize(question);
  if (!/\b(monto|importe)\b/.test(normalizedQuestion)) return null;
  const amountMatch = String(question || "").match(
    /\b(?:a|en|por)\s+\$?\s*(\d[\d,]*(?:\.\d+)?)\s*(?:usd|dolares?)?\b/i,
  );
  const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, "")) : NaN;
  if (!Number.isFinite(amount) || amount < 0) {
    return {
      answer:
        "Indica el nuevo monto como una cantidad numérica para preparar la propuesta. No se modificó el CRM.",
      responseType: "clarification",
      clarification: {
        type: "missing_fields",
        message:
          "Indica el nuevo monto como una cantidad numérica para preparar la propuesta.",
        missing: ["Nuevo monto"],
      },
      evidence: [],
      inferences: [],
      confidence: "medium",
      recommendedActions: [],
      operations: [],
      source: "account_intelligence",
    };
  }
  if (!permissionGranted(permissions, "oportunidades.update")) {
    return {
      answer:
        "No tienes permiso para preparar cambios en oportunidades. No se modificó el CRM.",
      responseType: "clarification",
      evidence: [],
      inferences: [],
      confidence: "high",
      recommendedActions: [],
      operations: [],
      source: "account_intelligence",
    };
  }
  if (
    Array.isArray(allowedOperationKinds) &&
    !allowedOperationKinds.includes("opportunity_field")
  ) {
    return {
      answer:
        'La política de Cliente existente no permite cambios en campos de oportunidad. Un administrador debe habilitar "Campo de oportunidad" en Gobierno de Mi Coach > Reglas del motor. No se creó una propuesta ni se modificó el CRM.',
      responseType: "clarification",
      clarification: {
        type: "missing_fields",
        message:
          'Un administrador debe habilitar "Campo de oportunidad" en las reglas de Cliente existente.',
        missing: ["Permiso de política para opportunity_field"],
      },
      evidence: [],
      inferences: [],
      confidence: "high",
      recommendedActions: [],
      operations: [],
      source: "account_intelligence",
    };
  }
  const opportunity = resolveCustomerOpportunity(
    snapshot || {},
    question || "",
  );
  if (!opportunity) {
    return {
      answer:
        "No pude identificar una única oportunidad de esta cuenta. Selecciónala o indica su nombre para preparar el cambio. No se modificó el CRM.",
      responseType: "clarification",
      clarification: {
        type: "select_opportunity",
        message:
          "No pude identificar una única oportunidad de esta cuenta. Selecciónala o indica su nombre para preparar el cambio.",
        missing: ["Oportunidad única"],
      },
      evidence: [],
      inferences: [],
      confidence: "medium",
      recommendedActions: [],
      operations: [],
      source: "account_intelligence",
    };
  }

  const currentValue = Number(opportunity.amountUsd || 0);
  const operation = {
    kind: "opportunity_field",
    title: `Actualizar monto de ${opportunity.name || "la oportunidad"}`,
    opportunityId: Number(opportunity.id),
    field: "amountUsd",
    currentValue,
    value: amount,
    sourceChannel: "customer_account",
    requiresConfirmation: true,
    evidence: [
      {
        sourceType: "opportunity",
        sourceId: Number(opportunity.id),
        label: `Oportunidad CRM: ${opportunity.name || opportunity.id}`,
        excerpt: `Monto actual: ${formatUsd(currentValue)}.`,
      },
    ],
    source: { type: "opportunity", id: Number(opportunity.id) },
  };
  return {
    answer: `Preparé una propuesta para cambiar el monto de ${opportunity.name || "la oportunidad"} de ${formatUsd(currentValue)} a ${formatUsd(amount)}. Requiere tu confirmación; todavía no se modificó el CRM.`,
    evidence: [
      `Oportunidad CRM ${opportunity.name || opportunity.id}; monto actual ${formatUsd(currentValue)}.`,
    ],
    inferences: [],
    confidence: "high",
    recommendedActions: [],
    operations: [operation],
    source: "account_intelligence",
  };
}

export function appendCustomerAccountChatHistory(
  history = [],
  question,
  answer,
  assistantMetadata = {},
) {
  const normalizedHistory = (Array.isArray(history) ? history : [])
    .filter(
      (message) =>
        ["user", "assistant"].includes(message?.role) &&
        String(message?.text || "").trim(),
    )
    .map((message) => ({
      role: message.role,
      text: String(message.text).trim().slice(0, 2000),
      ...(message.role === "assistant" && message.activityHistory
        ? { activityHistory: message.activityHistory }
        : {}),
      ...(message.role === "assistant" && message.turnDebug
        ? { turnDebug: message.turnDebug }
        : {}),
      ...(message.role === "assistant" && Array.isArray(message.operations)
        ? { operations: message.operations }
        : {}),
    }));
  return [
    ...normalizedHistory,
    question
      ? { role: "user", text: String(question).trim().slice(0, 2000) }
      : null,
    answer
      ? {
          role: "assistant",
          text: String(answer).trim().slice(0, 2000),
          ...(assistantMetadata.activityHistory
            ? { activityHistory: assistantMetadata.activityHistory }
            : {}),
          ...(assistantMetadata.turnDebug
            ? { turnDebug: assistantMetadata.turnDebug }
            : {}),
          ...(Array.isArray(assistantMetadata.operations)
            ? { operations: assistantMetadata.operations }
            : {}),
        }
      : null,
  ]
    .filter(Boolean)
    .slice(-8);
}

function buildCustomerPrompt(
  snapshot,
  question,
  _processGuide,
  context,
  conversationHistory = [],
  _channelRules = {},
  _permissions = {},
  operationPolicy = {},
) {
  const administrativeRules = Array.isArray(snapshot?.administrativeRules)
    ? snapshot.administrativeRules
        .filter((rule) => rule?.enabled && rule?.instruction)
        .map((rule) => `- ${rule.title}: ${rule.instruction}`)
    : [];
  return {
    question,
    context: snapshot,
    selectedContext: context,
    conversationHistory,
    operationPolicy,
    instruction:
      "Responde la solicitud sobre la cuenta usando solo el CRM autorizado. Si se pide un correo, redacta un borrador y no lo envíes. Si solicitan un cambio, devuelve operations con el tipo de operación y los IDs exactos del contexto de esta cuenta; nunca propongas una entidad de otra cuenta. operationKind determina el tipo de escritura: activityDraft solo aplica cuando operationKind=activity y nunca debe convertir create_contact en una actividad. Para create_contact, usa accountId de la cuenta seleccionada y coloca únicamente datos del nuevo contacto en payload; no busques ni inventes un contactId. Para create_opportunity, usa accountId de la cuenta seleccionada, un nombre explícito, los datos comerciales mencionados y solo un contactId existente de esta cuenta si fue identificado. Para link_contact_to_opportunity, usa una oportunidad y un contacto existentes de esta misma cuenta, con sus IDs del snapshot. No inventes correo, teléfono, cargo, nombres ni IDs. Toda operación es una propuesta revisable y requiere confirmación; no afirmes que ya fue ejecutada." +
      (snapshot?.channelIntentRouting
        ? `\n\nEnrutamiento validado por el servidor: ${JSON.stringify(snapshot.channelIntentRouting)}. Responde a esa intención con evidencia del contexto autorizado y no la conviertas en otra clase de consulta.`
        : "") +
      (administrativeRules.length
        ? `\n\nReglas administrativas activas para este canal; aplícalas sin ampliar el alcance autorizado ni omitir permisos o confirmaciones:\n${administrativeRules.join("\n")}`
        : ""),
  };
}

export function normalizeCustomerOperations(
  operations,
  snapshot,
  context,
  permissions = new Set(),
) {
  const accountId = Number(snapshot?.account?.id || context.accountId || 0);
  const contactIds = new Set(
    (snapshot?.contacts || []).map((item) => Number(item.id)).filter(Boolean),
  );
  const opportunityIds = new Set(
    [
      ...(snapshot?.opportunities || []),
      ...(snapshot?.inactiveOpportunities || []),
      ...(snapshot?.selectedOpportunity ? [snapshot.selectedOpportunity] : []),
    ]
      .filter((item) => Number(item.accountId || accountId) === accountId)
      .map((item) => Number(item.id))
      .filter(Boolean),
  );
  const interactionIds = new Set(
    (snapshot?.interactions || [])
      .map((item) => Number(item.id))
      .filter(Boolean),
  );
  const candidates = (Array.isArray(operations) ? operations : []).map(
    (item) => {
      const operation = {
        ...item,
        sourceChannel: "customer_account",
        requiresConfirmation: true,
      };
      if (
        [
          "activity",
          "stage_answer",
          "opportunity_field",
          "link_contact_to_opportunity",
        ].includes(operation.kind)
      ) {
        operation.opportunityId =
          Number(operation.opportunityId || context.opportunityId || 0) || null;
      }
      if (operation.kind === "account_field") {
        operation.accountId = Number(operation.accountId || accountId) || null;
      }
      if (operation.kind === "contact_field") {
        operation.contactId =
          Number(operation.contactId || context.contactId || 0) || null;
      }
      if (operation.kind === "create_opportunity") {
        const sourcePayload =
          operation.payload &&
          typeof operation.payload === "object" &&
          !Array.isArray(operation.payload)
            ? operation.payload
            : {};
        const proposedAccountId = Number(
          operation.accountId || sourcePayload.accountId || accountId,
        );
        const contactId =
          Number(operation.contactId || sourcePayload.contactId || 0) || null;
        if (
          proposedAccountId !== accountId ||
          (sourcePayload.accountId &&
            Number(sourcePayload.accountId) !== accountId) ||
          (operation.contactId &&
            sourcePayload.contactId &&
            Number(operation.contactId) !== Number(sourcePayload.contactId)) ||
          (contactId && !contactIds.has(contactId))
        ) {
          return null;
        }
        const payload = { accountId };
        const name = String(sourcePayload.name || operation.name || "")
          .trim()
          .slice(0, 180);
        if (name) payload.name = name;
        if (sourcePayload.amountUsd !== undefined) {
          const amountUsd = Number(sourcePayload.amountUsd);
          if (Number.isFinite(amountUsd) && amountUsd >= 0) {
            payload.amountUsd = amountUsd;
          }
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(sourcePayload.closeDate || ""))) {
          payload.closeDate = String(sourcePayload.closeDate);
        }
        if (contactId) payload.contactId = contactId;
        return {
          kind: "create_opportunity",
          title: String(operation.title || `Crear oportunidad${name ? ` ${name}` : ""}`)
            .trim()
            .slice(0, 300),
          evidence: [],
          missingFields: Array.isArray(operation.missingFields)
            ? operation.missingFields
                .map((field) => String(field || "").trim().slice(0, 120))
                .filter(Boolean)
                .slice(0, 30)
            : [],
          requiresConfirmation: true,
          sourceChannel: "customer_account",
          targetModule: "opportunities",
          payload,
          accountId,
          contactId,
          opportunityId: null,
          interactionId: null,
          quotationVersionId: null,
          source: { type: "account", id: accountId },
        };
      }
      if (operation.kind === "link_contact_to_opportunity") {
        const opportunityId = Number(operation.opportunityId || 0) || null;
        const contactId = Number(operation.contactId || 0) || null;
        if (
          !opportunityIds.has(opportunityId) ||
          !contactIds.has(contactId) ||
          (operation.accountId && Number(operation.accountId) !== accountId)
        ) {
          return null;
        }
        return {
          kind: "link_contact_to_opportunity",
          title: String(operation.title || "Vincular contacto a oportunidad")
            .trim()
            .slice(0, 300),
          evidence: [],
          missingFields: [],
          requiresConfirmation: true,
          sourceChannel: "customer_account",
          targetModule: "opportunities",
          payload: { accountId, contactId },
          accountId,
          contactId,
          opportunityId,
          interactionId: null,
          quotationVersionId: null,
          source: { type: "opportunity", id: opportunityId },
        };
      }
      if (operation.kind === "create_contact") {
        const proposedAccountId = Number(
          operation.accountId || operation.payload?.accountId || 0,
        );
        if (proposedAccountId && proposedAccountId !== accountId) return null;
        const sourcePayload =
          operation.payload &&
          typeof operation.payload === "object" &&
          !Array.isArray(operation.payload)
            ? operation.payload
            : {};
        const contactFields = [
          "firstName",
          "lastName",
          "positionTitle",
          "email",
          "phone",
          "mobile",
          "department",
          "city",
          "stateRegion",
        ];
        return {
          kind: "create_contact",
          title: String(operation.title || "Crear contacto")
            .trim()
            .slice(0, 300),
          evidence: [],
          missingFields: Array.isArray(operation.missingFields)
            ? operation.missingFields
                .map((field) => String(field || "").trim().slice(0, 120))
                .filter(Boolean)
                .slice(0, 30)
            : [],
          requiresConfirmation: true,
          sourceChannel: "customer_account",
          targetModule: "contacts",
          payload: {
            ...Object.fromEntries(
              contactFields
                .filter((field) => sourcePayload[field] !== undefined)
                .map((field) => [
                  field,
                  String(sourcePayload[field] || "").trim().slice(0, 500),
                ]),
            ),
            accountId,
          },
          accountId,
          contactId: null,
          opportunityId: null,
          interactionId: null,
          quotationVersionId: null,
        };
      } else delete operation.payload;
      return operation;
    },
  );
  return filterValidCoachOperations(candidates).filter((operation) => {
    if (operation.kind === "account_field")
      return Number(operation.accountId) === accountId;
    if (operation.kind === "contact_field")
      return contactIds.has(Number(operation.contactId));
    if (operation.kind === "create_contact") {
      const canCreateContact =
        permissionGranted(permissions, "contactos.create") ||
        permissionGranted(permissions, "contactos.request");
      return (
        accountId > 0 &&
        Number(operation.accountId) === accountId &&
        canCreateContact
      );
    }
    if (operation.kind === "create_opportunity") {
      const canCreateOpportunity =
        permissionGranted(permissions, "oportunidades.create") ||
        permissionGranted(permissions, "oportunidades.request");
      return (
        accountId > 0 &&
        Number(operation.accountId) === accountId &&
        canCreateOpportunity
      );
    }
    if (operation.kind === "link_contact_to_opportunity") {
      const canUpdateOpportunity = permissionGranted(
        permissions,
        "oportunidades.update",
      );
      const canReadContact =
        permissionGranted(permissions, "contactos.read") ||
        permissionGranted(permissions, "contactos.read_all");
      return (
        Number(operation.accountId) === accountId &&
        opportunityIds.has(Number(operation.opportunityId)) &&
        contactIds.has(Number(operation.contactId)) &&
        canUpdateOpportunity &&
        canReadContact
      );
    }
    if (
      ["activity", "stage_answer", "opportunity_field"].includes(operation.kind)
    )
      return opportunityIds.has(Number(operation.opportunityId));
    if (operation.kind === "lead_call_outcome")
      return interactionIds.has(Number(operation.interactionId));
    return false;
  });
}

export function normalizeCustomerResponse(
  result,
  snapshot,
  _question,
  context,
  permissions = new Set(),
) {
  const normalized = result || {};
  const recommendedActions = Array.isArray(normalized.recommendedActions)
    ? normalized.recommendedActions
        .map((action) => ({
          ...action,
          opportunityId: Number(action.opportunityId || 0) || null,
          requiresConfirmation: true,
        }))
        .slice(0, 5)
    : [];
  const operations = normalizeCustomerOperations(
    normalized.operations,
    snapshot,
    context,
    permissions,
  );
  const publicSources = Array.isArray(normalized.publicSources)
    ? normalized.publicSources
        .map((source) => {
          const rawUrl = String(source?.url || source?.sourceUrl || "").trim();
          try {
            const parsedUrl = new URL(rawUrl);
            if (!["http:", "https:"].includes(parsedUrl.protocol)) return null;
            return {
              title: String(source.title || parsedUrl.hostname).slice(0, 200),
              url: parsedUrl.href,
              sourceUrl: parsedUrl.href,
              domain: parsedUrl.hostname,
              sourceDomain: "public_web",
              confidence: source.confidence || "low",
              certainty: source.certainty || "evidenced",
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .slice(0, 24)
      : [];
  for (const operation of operations) {
    if (operation.kind !== "activity") continue;
    if (
      !recommendedActions.some(
        (action) =>
          Number(action.opportunityId || 0) ===
            Number(operation.opportunityId || 0) &&
          action.title === operation.title,
      )
    ) {
      recommendedActions.push({
        title: operation.title,
        opportunityId: operation.opportunityId,
        actionType: operation.actionType,
        notes: operation.notes,
        successCriteria: operation.successCriteria,
        dueDate: operation.dueDate,
        scheduledAt: operation.scheduledAt,
        evidence: operation.evidence,
      });
    }
  }
  for (const action of recommendedActions) {
    const activity = normalizeActivityOperation(action, context);
    if (
      activity.opportunityId &&
      !operations.some(
        (operation) =>
          operation.kind === "activity" &&
          Number(operation.opportunityId) === Number(activity.opportunityId) &&
          operation.title === activity.title,
      )
    ) {
      operations.push(activity);
    }
  }
  return {
    answer: String(
      normalized.answer || "No fue posible responder la pregunta.",
    ),
    responseType: normalized.responseType || "informational",
    evidence: Array.isArray(normalized.evidence) ? normalized.evidence : [],
    inferences: Array.isArray(normalized.inferences)
      ? normalized.inferences
      : [],
    pendingItems: Array.isArray(normalized.pendingItems)
      ? normalized.pendingItems
          .map((item) =>
            String(item || "")
              .trim()
              .slice(0, 500),
          )
          .filter(Boolean)
          .slice(0, 8)
      : [],
    confidence: ["high", "medium", "low"].includes(normalized.confidence)
      ? normalized.confidence
      : "low",
    recommendedActions: normalized.activityDraft ? [] : recommendedActions,
    publicSources,
    activityHistory: normalized.activityHistory || null,
    ...(normalized.activityDraft
      ? { activityDraft: normalized.activityDraft }
      : {}),
    ...(normalized.activityDraftDiscarded
      ? { activityDraftDiscarded: true }
      : {}),
    source: "account_intelligence",
    entities: {
      accountId: context.accountId || null,
      opportunityId:
        Number(
          normalized.entities?.opportunityId || context.opportunityId || 0,
        ) || null,
      contactId:
        Number(normalized.entities?.contactId || context.contactId || 0) ||
        null,
      leadId: null,
      names: [],
    },
    operations,
    clarification: normalized.clarification || null,
  };
}

export function createCustomerAccountAdapter({
  user,
  snapshot,
  conversationContext = null,
  snapshotQueryMetrics = [],
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
  };
  let activeBusinessRules = null;
  const availableTools = [
    ...COACH_READ_TOOL_CATALOG,
    {
      name: "searchInteractions",
      requiredPermission: "interacciones.read",
      readOnly: true,
    },
  ];
  const dependencies = {
    planChannelIntent: async ({
      question,
      context,
      conversationHistory,
      conversationContext,
      availableTools: permittedTools,
      catalog,
      allowedOperationKinds,
      deadlineAt,
    }) => {
      const enabledIntentCodes = (Array.isArray(catalog) ? catalog : [])
        .filter((intent) => intent.enabled !== false)
        .map((intent) => intent.code);
      if (!enabledIntentCodes.length) return null;
      const entityCandidates = buildCustomerPlanEntityCandidates(
        snapshot,
        question,
        activeBusinessRules || {},
        conversationContext,
        context,
        permittedTools,
      );
      turnDiagnostics.plannerInput = {
        questionLength: String(question || "").length,
        historyMessageCount: Array.isArray(conversationHistory)
          ? conversationHistory.length
          : 0,
        selectedContext: {
          accountId: Number(context.accountId || 0) || null,
          opportunityId: Number(context.opportunityId || 0) || null,
          contactId: Number(context.contactId || 0) || null,
        },
        enabledIntentCodes,
        allowedOperationKinds,
        availableToolNames: permittedTools.map((tool) => tool.name),
        candidateCounts: Object.fromEntries(
          Object.entries(entityCandidates.publicCandidates || {}).map(
            ([entityType, candidates]) => [
              entityType,
              Array.isArray(candidates) ? candidates.length : 0,
            ],
          ),
        ),
      };
      const plannerContext = buildCustomerQueryPlannerContext({
        question,
        context,
        conversationHistory,
        conversationContext,
        availableTools: permittedTools,
        catalog,
        snapshot,
        businessRules: activeBusinessRules || {},
        allowedOperationKinds,
        entityCandidates,
        researchAgents: agents,
      });
      const plan = await runStructuredTextResearch({
        schemaName: "customer_account_query_plan",
        systemPrompt:
          "Para preparar una actividad, llena activityDraft.action=prepare; para responder campos de pendingActivity usa continue; si el usuario la descarta usa discard; para consultas factuales usa none. Interpreta las respuestas breves con el borrador y el historial. Usa queries=[crm_operation,contact_query] para una actividad con contacto, no consultas de historial salvo que el usuario las solicite explícitamente. Conserva día/hora no proporcionados como vacíos: 'la próxima semana' es temporalPreference, no una cita. scheduledAt debe ser YYYY-MM-DDTHH:mm en la zona horaria del negocio; calcula fechas relativas con referenceDateTime y no inventes hora ni día. Los campos pendientes del borrador no son ambiguity ni evidencia CRM faltante; solo entidades ambiguas, inaccesibles o referencias no resueltas requieren aclaración. " +
          "Eres un planificador de consultas para el chat de Cliente existente. No respondas al vendedor ni inventes datos o IDs. Devuelve solo el plan estructurado. El alcance siempre es la cuenta seleccionada por el servidor: si la pregunta pide otra cuenta, responde con mode=clarification, ambiguity.reason=other_account y sin consultas. Para dominios fuera del catálogo, usa out_of_scope y no inventes consultas. Usa solo códigos de consulta del catálogo. Interpreta la pregunta junto con recentConversation, validatedContinuation y los candidatos autorizados; resuelve referencias conversacionales y no dependas de coincidencias literales en la pregunta actual. Distingue la intención consultada de la entidad a la que se refiere: si preguntas por las actividades, etapa, cotización o contactos que tiene una oportunidad ya identificada, targetType debe ser opportunity y debes devolver el candidateKey de esa oportunidad; no cambies targetType a account solo porque la consulta sea account_activity_history. Por ejemplo, después de consultar Vrf 2027, ante '¿Qué actividad pendiente tiene?' conserva Vrf 2027 como objetivo singular y planifica las lecturas de actividad correspondientes. Si preguntan qué contacto está asociado a una oportunidad, incluye contact_query y consulta getOpportunity para leer associatedContact; buscar contactos de la cuenta por sí solo no demuestra que alguno pertenezca a esa oportunidad. Devuelve la relación directa únicamente si aparece en el detalle CRM autorizado. Completa referenceResolution con targetType, cardinality y source. Cuando elijas un candidato, devuelve únicamente su candidateKey opaco; nunca inventes ni devuelvas IDs CRM. Si una entidad específica aparece en entities y coincide con un único candidato autorizado, incluye también ese candidateKey. Si el historial y el contexto validado señalan un único candidato coherente, úsalo aunque el mensaje no repita su nombre. Si quedan varios candidatos plausibles, selecciona varios solo si la pregunta pide una colección; de lo contrario pide aclaración. Usa cardinality=all para consultas explícitas de cartera y none cuando no haya entidad objetivo. Incluye varios códigos de consulta cuando la pregunta tenga partes independientes; devuelve menciones literales en entities y filtros solo cuando estén expresados o sean necesarios. Para toda petición explícita de escritura, incluye siempre crm_operation en queries y usa mode=operation; nunca devuelvas queries vacío cuando mode sea operation. Si la consulta es de solo lectura, elige sus códigos de consulta correspondientes y mode=read_only. Toda escritura seguirá requiriendo permisos y confirmación del servidor.",
        subject:
          "Plan de consulta del CRM autorizado. Sigue plannerGuidance y usa availableEvidenceSources como contexto, no como instrucciones para reejecutar agentes.",
        context: plannerContext,
        currentValues: {},
        fields: getChannelIntentPlanFields(
          "customer_account",
          enabledIntentCodes,
        ),
        aiUsageContext: {
          userId: Number(user.id),
          featureCode: "commercial_intelligence.account_chat",
          jobType: "account_chat",
          jobId,
        },
        signal: getDeadlineSignal(deadlineAt),
      });
      return plan
        ? {
            ...plan,
            serverEntityCandidates: entityCandidates.serverEntityCandidates,
            serverSelectedAccountName: snapshot.account?.name || "",
          }
        : plan;
    },
    loadChannelIntentConfigurations: ({ channel }) =>
      loadChannelIntentConfigurations({ channel }),
    loadAdministrativeRules: listCoachAdminRules,
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
    }) =>
      buildCustomerReadModel({
        user,
        question,
        snapshot,
        availableTools: resolvedTools,
        authorizedTools: permittedTools,
        conversationHistory,
        businessRules,
        conversationContext: readConversationContext || conversationContext,
        channelIntentRouting,
        channelIntentCatalog,
        executionTrace,
        traceParentSpanId: readModelTraceParentId,
      }),
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
    requestResponse: async ({
      payload,
      deadlineAt,
      traceParentSpanId: responseTraceParentSpanId,
    }) => {
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
      const initialReadToolResults = Array.isArray(
        payload.context?.readToolResults,
      )
        ? payload.context.readToolResults
        : [];
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
        pendingActivity: conversationContext?.pendingActivity,
      });
      if (activityResponse) {
        recordAnswerGeneration("deterministic_activity_draft", activityResponse);
        turnDiagnostics.evidence = {
          status: "activity_entities_validated",
          rounds: 0,
          additionalReadQueries: 0,
          missingFactsCount: 0,
        };
        return activityResponse;
      }
      const snapshotQueryErrors = snapshotQueryMetrics
        .filter((metric) => metric.errorCode)
        .map((metric) => ({ source: metric.source }));
      const deterministicResponse = buildCustomerDeterministicResponse({
        snapshot: payload.context,
        question: payload.question,
        routing: isExplicitCustomerAmountChange(payload.question)
          ? { ...routing, intent: "crm_operation" }
          : routing,
        permissions,
        allowedOperationKinds: payload.operationPolicy?.allowedKinds,
      });
      const deterministicOperationResponse = isExplicitCustomerAmountChange(
        payload.question,
      )
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
        Date.now() + CUSTOMER_CHAT_EVIDENCE_LIMITS.maxTurnMs;
      const followUpIntents = new Set();
      const evidenceLoop = await runCustomerEvidenceLoop({
        initialReadToolResults,
        initialQueryErrors: snapshotQueryErrors,
        unqueriedAuthorizedTools,
        deadlineAt: turnDeadline,
        onTraceEvent: executionTrace?.record,
        traceParentSpanId: responseTraceParentSpanId,
        assessEvidence: async ({
          readToolResults,
          round,
          remainingMs,
          hasQueryErrors,
        }) => {
          const queryCoverage = buildQueryCoverage(readToolResults);
          const assessment = await runStructuredTextResearch({
            schemaName: "customer_account_evidence_assessment",
            systemPrompt:
              "Evalúa si la evidencia autorizada responde todas las partes de la pregunta, incluyendo evidencia CRM y pública, junto con recentConversation y validatedContinuation. El historial sirve para resolver intención y referencias, nunca como prueba factual. No redactes la respuesta ni inventes datos. Usa queryCoverage para saber qué intenciones ya fueron consultadas y no devuelvas en missingQueries una intención fullyQueried cuya evidencia ya cubra la pregunta. Distingue consultas factuales de solicitudes para preparar propuestas editables: ante 'proponla' después de ofrecer una llamada, verifica la identidad y vínculos CRM de la cuenta, oportunidad y contacto referidos, pero no exijas preferencias de llamada, acuerdos confirmados, actividades previas ni detalles futuros que el vendedor no pidió consultar como hechos. La fecha/hora y otros datos no proporcionados de una propuesta son campos pendientes, no hechos CRM; no los inventes. Preparar una propuesta no ejecuta ni guarda la actividad y sigue sujeto a operationPolicy. Marca sufficient solo si cada parte está respaldada por resultados concretos y no faltan hechos. Marca no_results solo cuando las consultas necesarias terminaron sin errores y no encontraron coincidencias. Un error de herramienta nunca significa que no haya registros. Devuelve missingQueries solo para una fuente/intención autorizada con una consulta útil aún no ejecutada; si otra lectura no puede obtener un dato faltante, descríbelo en missingFacts. Solicita aclaración solo para ambigüedades reales, referencias insuficientes o periodos indispensables de una consulta factual. Devuelve missingFacts como etiquetas breves en español para el vendedor, no como códigos internos ni afirmaciones inventadas.",
            subject: "Verificación de evidencia CRM y pública",
            context: {
              question: payload.question,
              recentConversation: conversationHistory.slice(-8),
              validatedContinuation: conversationContext || null,
              operationPolicy: payload.operationPolicy || {},
              intentPlan: routing
                ? {
                    objective: routing.objective || "",
                    intents: intentCodes,
                    entities: routing.entities || {},
                    filters: routing.filters || {},
                  }
                : null,
              evidence: readToolResults.map((item) => ({
                toolName: item.toolName,
                sourceDomain: "crm_internal",
                result: item.result,
                queryFailed: Boolean(item.error),
              })),
              publicEvidence,
              queryCoverage,
              round,
              hasQueryErrors,
              snapshotQueryMetrics,
              unqueriedAuthorizedTools,
            },
            currentValues: {},
            fields: getCustomerEvidenceAssessmentFields(enabledIntentCodes),
            aiUsageContext: {
              userId: Number(user.id),
              featureCode: "commercial_intelligence.account_chat",
              jobType: "account_chat",
              jobId,
            },
            signal: getDeadlineSignal(Date.now() + remainingMs),
          });
          return normalizeCustomerEvidenceAssessment({
            assessment,
            queryCoverage,
            readToolResults,
            hasQueryErrors,
            unqueriedAuthorizedTools,
          });
        },
        fetchAdditionalEvidence: async ({
          missingQueries,
          readToolResults,
          remainingReadQueries,
          traceParentSpanId: additionalReadSpanId,
        }) => {
          const safeMissingQueries = missingQueries.filter((code) =>
            enabledIntentCodes.includes(code),
          );
          if (!safeMissingQueries.length || remainingReadQueries <= 0) {
            return { readToolResults: [] };
          }
          const followUpRouting = normalizeChannelIntentPlan({
            channel: "customer_account",
            plan: {
              objective: routing?.objective || "Recuperar evidencia faltante",
              queries: safeMissingQueries,
              entities: routing?.entities || {},
              filters: routing?.filters || {},
              ambiguity: {
                reason: "none",
                requiresClarification: "no",
                missingContext: [],
                question: "",
              },
              mode: "read_only",
              confidence: "high",
            },
            availableTools: authorizedTools,
            context: payload.context?.selectedContext || {},
            configuration: channelCatalog,
            question: payload.question,
            conversationHistory,
          });
          if (!followUpRouting || followUpRouting.requiresClarification) {
            return { readToolResults: [] };
          }
          const previouslyQueried = new Set(
            readToolResults.map((item) => item.toolName),
          );
          const followUpTools = authorizedTools
            .filter(
              (tool) =>
                followUpRouting.allowedTools.includes(tool.name) &&
                !previouslyQueried.has(tool.name),
            )
            .slice(0, remainingReadQueries);
          if (!followUpTools.length) return { readToolResults: [] };
          for (const code of followUpRouting.intents) followUpIntents.add(code);
          const followUpReadModel = await buildCustomerReadModel({
            user,
            question: payload.question,
            snapshot,
            availableTools: followUpTools,
            conversationHistory,
            conversationContext,
            businessRules: activeBusinessRules || {},
            channelIntentRouting: {
              ...followUpRouting,
              allowedTools: followUpTools.map((tool) => tool.name),
            },
            channelIntentCatalog: channelCatalog,
            executionTrace,
            traceParentSpanId: additionalReadSpanId,
          });
          return {
            readToolResults: followUpReadModel.readToolResults.slice(
              0,
              remainingReadQueries,
            ),
          };
        },
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
      };
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
      if (intentCodes.length === 1 && intentCodes[0] === "account_overview") {
        const accountOverview = buildCustomerAccountOverviewResponse(
          snapshot,
          evidenceLoop.readToolResults,
        );
        if (accountOverview) {
          recordAnswerGeneration("deterministic_account_overview", accountOverview);
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
      const fallback = {
        answer: "Respuesta basada únicamente en la evidencia autorizada.",
        evidence: [],
        inferences: [],
        confidence: "medium",
        pendingItems: [],
        recommendedActions: [],
        operations: [],
      };
      const aiResult =
        deterministicOperationResponse ||
        (await runStructuredTextResearch({
          schemaName: "account_contextual_chat",
          systemPrompt:
            "Responde usando exclusivamente authorizedEvidence y verifiedEmptyResults. conversationHistory solo sirve para resolver referencias conversacionales, nunca como prueba factual. Cada afirmación debe estar respaldada por un resultado con la fuente correcta; no traslades métricas de cuenta a una oportunidad ni viceversa. Distingue fuentes CRM (crm_internal) de fuentes públicas (public_web), y no presentes estas últimas como hechos CRM. Para toda afirmación basada en public_web, incluye en evidence el título o URL de la fuente pública autorizada que la respalda y no generalices más allá del hallazgo. Si evidenceVerification es no_results, usa verifiedEmptyResults para explicar qué consulta autorizada terminó sin filas dentro de qué cuenta o entidad; comunica únicamente que no se encontraron registros en ese alcance, no que nunca existan. Un cero verificado es un resultado, no evidencia faltante. Nunca afirmes ausencia si una consulta falló, quedó truncada o no se ejecutó. Omite datos no consultados o colócalos en pendingItems. Cuando identifiques una oportunidad como foco, devuelve su ID en entities.opportunityId solo si aparece en evidencia CRM autorizada y es inequívoca; no inventes IDs. Las operaciones son propuestas que requieren revisión y confirmación; no ejecutes operaciones ni envíes correos. Si el vendedor acepta preparar una actividad ofrecida en el turno anterior, por ejemplo con 'proponla', devuelve el borrador estructurado en operations cuando activity esté permitido y sus vínculos estén verificados; no repitas la oferta ni exijas preferencias del contacto o acuerdos que el usuario no pidió consultar. Los detalles futuros son propuestas, no hechos CRM. Si falta fecha/hora, deja scheduledAt vacío, añade scheduledAt a missingFields y pide completarlo para abrir Calendario; nunca inventes una cita ni afirmes que está coordinada, aceptada, guardada o ejecutada.",
          subject: snapshot.account?.name || "cuenta",
          context: answerEvidenceContext,
          currentValues: {},
          fields: [
            { key: "answer", type: "string", example: fallback.answer },
            {
              key: "entities",
              type: "object",
              fields: [{ key: "opportunityId", type: "number", example: 0 }],
            },
            {
              key: "evidence",
              type: "array",
              example: [],
              items: { type: "string", example: "Evidencia" },
            },
            {
              key: "inferences",
              type: "array",
              example: [],
              items: { type: "string", example: "Hipótesis" },
            },
            {
              key: "confidence",
              type: "enum",
              enum: ["high", "medium", "low"],
              example: "medium",
            },
            {
              key: "pendingItems",
              type: "array",
              example: [],
              items: { type: "string", example: "Dato no verificado" },
            },
            {
              key: "recommendedActions",
              type: "array",
              example: [],
              items: {
                type: "object",
                fields: [
                  { key: "title", type: "string", example: "Actividad" },
                  { key: "opportunityId", type: "string", example: "" },
                  { key: "actionType", type: "string", example: "call" },
                  { key: "notes", type: "string", example: "" },
                  { key: "successCriteria", type: "string", example: "" },
                  {
                    key: "requiresConfirmation",
                    type: "string",
                    example: "true",
                  },
                ],
              },
            },
            {
              key: "operations",
              type: "array",
              example: [],
              items: {
                type: "object",
                fields: [
                  {
                    key: "kind",
                    type: "enum",
                    enum: [
                      "activity",
                      "stage_answer",
                      "lead_call_outcome",
                      "account_field",
                      "contact_field",
                      "create_contact",
                      "create_opportunity",
                      "link_contact_to_opportunity",
                      "opportunity_field",
                    ],
                    example: "opportunity_field",
                  },
                  {
                    key: "title",
                    type: "string",
                    example: "Actualizar importe",
                  },
                  { key: "accountId", type: "number", example: 7 },
                  {
                    key: "payload",
                    type: "object",
                    fields: [
                      { key: "accountId", type: "number", example: 7 },
                      { key: "name", type: "string", example: "Renovación anual" },
                      { key: "amountUsd", type: "number", example: 12000 },
                      { key: "closeDate", type: "string", example: "2027-12-31" },
                      { key: "contactId", type: "number", example: 12 },
                      { key: "firstName", type: "string", example: "" },
                      { key: "lastName", type: "string", example: "" },
                      { key: "positionTitle", type: "string", example: "" },
                      { key: "email", type: "string", example: "" },
                      { key: "phone", type: "string", example: "" },
                      { key: "mobile", type: "string", example: "" },
                      { key: "department", type: "string", example: "" },
                      { key: "city", type: "string", example: "" },
                      { key: "stateRegion", type: "string", example: "" },
                    ],
                  },
                  { key: "contactId", type: "number", example: 12 },
                  { key: "opportunityId", type: "number", example: 18 },
                  { key: "interactionId", type: "number", example: 25 },
                  { key: "field", type: "string", example: "amountUsd" },
                  { key: "currentValue", type: "string", example: "10000" },
                  { key: "value", type: "string", example: "12000" },
                  { key: "questionId", type: "number", example: 4 },
                  { key: "answerValue", type: "string", example: "" },
                  {
                    key: "answerMode",
                    type: "enum",
                    enum: ["replace", "append"],
                    example: "replace",
                  },
                  { key: "substatusCode", type: "string", example: "" },
                  { key: "reasonCode", type: "string", example: "" },
                  { key: "requiredActionCode", type: "string", example: "" },
                  { key: "comment", type: "string", example: "" },
                  {
                    key: "actionType",
                    type: "enum",
                    enum: [
                      "next_step",
                      "follow_up",
                      "call",
                      "meeting",
                      "conference",
                      "presentation",
                      "visit",
                      "send_email",
                      "waiting_customer",
                      "demo",
                      "quotation",
                      "negotiation",
                      "other",
                    ],
                    example: "call",
                  },
                  {
                    key: "status",
                    type: "enum",
                    enum: ["pending", "in_progress", "blocked", "done"],
                    example: "pending",
                  },
                  {
                    key: "priority",
                    type: "enum",
                    enum: ["low", "medium", "high"],
                    example: "medium",
                  },
                  { key: "scheduledAt", type: "string", example: "" },
                  { key: "dueDate", type: "string", example: "" },
                  { key: "notes", type: "string", example: "" },
                  { key: "successCriteria", type: "string", example: "" },
                  {
                    key: "evidence",
                    type: "array",
                    example: [],
                    items: {
                      type: "object",
                      fields: [
                        {
                          key: "sourceType",
                          type: "string",
                          example: "opportunity",
                        },
                        { key: "sourceId", type: "number", example: 18 },
                        { key: "label", type: "string", example: "Dato CRM" },
                        { key: "excerpt", type: "string", example: "" },
                      ],
                    },
                  },
                ],
              },
            },
            { key: "source", type: "string", example: "account_intelligence" },
          ],
          aiUsageContext: {
            userId: Number(user.id),
            featureCode: "commercial_intelligence.account_chat",
            jobType: "account_chat",
            jobId,
          },
          signal: getDeadlineSignal(deadlineAt),
        }));
      recordAnswerGeneration(
        deterministicOperationResponse
          ? "deterministic_crm_operation"
          : aiResult
            ? "structured_answer_model"
            : "structured_answer_unavailable",
        aiResult,
      );
      if (aiResult) {
        const auditEvidenceSnapshot =
          summarizeAnswerAuditEvidence(authorizedEvidence);
        const answerAuditDiagnostics = {
          schemaName: "customer_account_answer_audit",
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
            onResponseMetadata: ({ responseId, model } = {}) => {
              answerAuditDiagnostics.providerResponseId = responseId || null;
              answerAuditDiagnostics.model = model || null;
            },
            systemPrompt:
              "Para una actividad futura solicitada por el vendedor, distingue el borrador propuesto de un hecho CRM: audita sus IDs, identidad y relaciones con authorizedEvidence, y su tipo/objetivo con la petición y conversationHistory. Una propuesta editable no demuestra que la llamada esté acordada o guardada; no exijas preferencias o acuerdos previos. La ausencia de fecha/hora debe quedar explícita como dato pendiente, nunca inventada; no permitas propuestas con entidades ambiguas o sin respaldo ni afirmaciones de ejecución. " +
              "Audita cada afirmación factual de la respuesta contra authorizedEvidence y verifiedEmptyResults. conversationHistory y la pregunta no son prueba de hechos CRM. Respeta sourceDomain: crm_internal es evidencia CRM y public_web solo evidencia pública, nunca un hecho CRM. Toda afirmación basada en fuentes públicas debe estar respaldada por un registro public_web con URL y referenciar esa evidencia; marca unsupported si la respuesta presenta una señal pública como dato CRM o si no hay fuente pública concreta. Un verifiedEmptyResult completado con resultCount=0 permite afirmar únicamente que esa consulta no encontró registros en la cuenta/entidad indicada; no permite afirmar una ausencia global ni cubre otros dominios. No infieras datos de una entidad a otra. En una operación crm_operation con proposalOrigin=server_deterministic, la operación estructurada fue preparada por el servidor y es evidencia válida del estado del flujo: puede afirmarse que la propuesta está preparada, requiere confirmación y aún no se ejecutó; no exijas que esos estados aparezcan en el CRM. El valor destino es la solicitud del usuario, no un hecho CRM: comprueba que coincide con la petición y con operations.value. Verifica con authorizedEvidence la identidad de la oportunidad y su valor actual. Para cualquier otro tipo de respuesta, no confíes en operaciones generadas por el modelo como prueba de que una propuesta exista. Marca supported si todas las afirmaciones están respaldadas y las afirmaciones de cero resultados están dentro del alcance de verifiedEmptyResults; marca unsupported si hay contradicción o exceso, e inconclusive si no puedes decidir. Para cada afirmación no respaldada, devuelve en findings la afirmación, el veredicto, el motivo concreto y las referencias a los toolName/registros de authorizedEvidence que revisaste; no inventes referencias. No redactes una respuesta nueva ni autorices operaciones.",
            subject: snapshot.account?.name || "cuenta",
            context: {
              question: payload.question,
              channelIntentRouting: routing,
              conversationHistory,
              operationPolicy: payload.operationPolicy || {},
              proposalOrigin: deterministicOperationResponse
                ? "server_deterministic"
                : "model_generated",
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
    },
    resolveResponseContext: (_snapshot, context) => ({
      context,
      changed: false,
      conflict: null,
    }),
    normalizeResponse: (result, scopedSnapshot, question, context) =>
      normalizeCustomerResponse(
        result,
        scopedSnapshot,
        question,
        context,
        permissions,
      ),
    featureCode: "commercial_intelligence.account_chat",
    getTurnDiagnostics: () => ({
      ...turnDiagnostics,
      snapshotMetrics: snapshotQueryMetrics,
    }),
  };
  return {
    channel: "customer_account",
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
      ],
      sourceChannel: "customer_account",
    },
    async runTurn({
      question,
      context = {},
      history = [],
      conversationContext: turnConversationContext = null,
      traceParentSpanId: turnTraceParentSpanId = traceParentSpanId,
    }) {
      const businessRules = await loadCoachBusinessRules({
        channel: "customer_account",
        process: "default",
      });
      activeBusinessRules = businessRules;
      const currentScope = businessRules.scope || {};
      const storedContinuationContext =
        turnConversationContext || conversationContext;
      const effectiveConversationContext = storedContinuationContext
        ? {
            ...storedContinuationContext,
            opportunityId:
              currentScope.opportunitySearchAllowed === false
                ? null
                : storedContinuationContext.opportunityId,
            contactId:
              currentScope.contactSearchAllowed === false
                ? null
                : storedContinuationContext.contactId,
          }
        : null;
      const effectiveContext = {
        ...context,
        opportunityId:
          currentScope.opportunitySearchAllowed === false
            ? null
            : context.opportunityId || null,
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
