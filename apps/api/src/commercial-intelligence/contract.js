import { z } from "zod";

export const CUSTOMER_INTELLIGENCE_CATEGORIES = [
  "company_profile",
  "business_challenge",
  "technology_project",
  "stakeholder",
  "decision_area",
  "need",
  "pain_point",
  "risk",
  "next_step",
  "missing_information",
  "renewal",
  "expansion",
];

export const CUSTOMER_INTELLIGENCE_SCOPE = [
  "executive_summary",
  "account_health",
  "risks",
  "opportunities",
  "key_contacts",
  "recent_activity",
  "public_research",
  "renewal_expansion",
  "recommended_actions",
];

export const CUSTOMER_INTELLIGENCE_TARGET_ENTITIES = [
  "account",
  "contact",
  "opportunity",
  "lead",
];

export const ACCOUNT_INTELLIGENCE_SOURCE_DOMAINS = ["crm_internal", "public_web"];

export const customerIntelligenceFindingSchema = z.object({
  sourceDomain: z.enum(ACCOUNT_INTELLIGENCE_SOURCE_DOMAINS).default("crm_internal"),
  category: z.enum(CUSTOMER_INTELLIGENCE_CATEGORIES),
  title: z.string().trim().min(1).max(190),
  summary: z.string().trim().min(1).max(4000),
  evidence: z.string().trim().max(4000).default(""),
  source: z.string().trim().min(1).max(60),
  sourceUrl: z.string().trim().max(500).default(""),
  confidence: z.enum(["high", "medium", "low"]),
  certainty: z.enum(["confirmed", "evidenced", "inferred"]),
  targetEntity: z.enum(CUSTOMER_INTELLIGENCE_TARGET_ENTITIES).nullable().default(null),
  targetField: z.string().trim().max(60).nullable().default(null),
  suggestedValue: z.string().trim().max(10000).nullable().default(null),
  requiresConfirmation: z.boolean().default(true),
});

export const CUSTOMER_INTELLIGENCE_AGENTS = [
  "crm_context",
  "commercial_health",
  "public_research",
  "contact_research",
  "technology_research",
  "expansion",
  "synthesis",
  "actions",
];

export const customerIntelligenceAgentResultSchema = z.object({
  agentId: z.enum(CUSTOMER_INTELLIGENCE_AGENTS),
  status: z.enum(["completed", "skipped", "failed"]),
  summary: z.string(),
  findings: z.array(customerIntelligenceFindingSchema),
  evidence: z.array(z.string()),
  confidence: z.enum(["high", "medium", "low"]),
  requiresConfirmation: z.boolean(),
  sourceDomain: z.enum(ACCOUNT_INTELLIGENCE_SOURCE_DOMAINS).default("crm_internal"),
  durationMs: z.number().int().nonnegative().default(0),
  sourceCount: z.number().int().nonnegative().default(0),
});

export const customerIntelligenceResultSchema = z.object({
  sourceDomain: z.enum(ACCOUNT_INTELLIGENCE_SOURCE_DOMAINS).default("crm_internal"),
  scope: z.array(z.enum(CUSTOMER_INTELLIGENCE_SCOPE)).min(1),
  headline: z.string().trim().min(1).max(190),
  summary: z.string().trim().min(1).max(4000),
  findings: z.array(customerIntelligenceFindingSchema),
  generatedAt: z.string().datetime({ offset: true }),
});

export const accountInternalAnalysisResultSchema = z.object({
  sourceDomain: z.literal("crm_internal"),
  scope: z.array(z.enum(CUSTOMER_INTELLIGENCE_SCOPE)).min(1),
  headline: z.string(),
  summary: z.string(),
  snapshot: z.any(),
  accountHealth: z.any(),
  findings: z.array(customerIntelligenceFindingSchema),
  agents: z.array(customerIntelligenceAgentResultSchema),
  generatedAt: z.string().datetime({ offset: true }),
  writesPerformed: z.literal(false),
});

export const customerIntelligenceOrchestrationSchema = z.object({
  sourceDomain: z.enum(ACCOUNT_INTELLIGENCE_SOURCE_DOMAINS).default("crm_internal"),
  orchestrationVersion: z.literal("account-intelligence.agents.v1"),
  agents: z.array(customerIntelligenceAgentResultSchema),
  generatedAt: z.string().datetime({ offset: true }),
  writesPerformed: z.literal(false),
});

export function normalizeCustomerIntelligenceOrchestration(input = {}) {
  return customerIntelligenceOrchestrationSchema.parse({
    sourceDomain: input.sourceDomain || "crm_internal",
    orchestrationVersion: "account-intelligence.agents.v1",
    agents: (input.agents || []).map((agent) => ({
      ...agent,
      findings: (agent.findings || []).map(normalizeCustomerIntelligenceFinding),
    })),
    generatedAt: input.generatedAt || new Date().toISOString(),
    writesPerformed: false,
  });
}

export const customerAccountChatResponseSchema = z.object({
  answer: z.string(),
  evidence: z.array(z.string()),
  confidence: z.enum(["high", "medium", "low"]),
  recommendedActions: z.array(z.object({
    title: z.string(),
    opportunityId: z.number().int().positive().nullable(),
    actionType: z.string(),
    notes: z.string(),
    successCriteria: z.string(),
    requiresConfirmation: z.literal(true),
  })),
  source: z.literal("account_intelligence"),
});

const customerIntelligenceAccountSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  registrationCode: z.string(),
  phone: z.string(),
  website: z.string(),
  city: z.string(),
  stateRegion: z.string(),
  description: z.string(),
});

const customerIntelligenceContactSchema = z.object({
  id: z.number().int().positive(),
  accountId: z.number().int().positive(),
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  mobile: z.string(),
  positionTitle: z.string(),
  department: z.string(),
});

const customerIntelligenceOpportunitySchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  accountId: z.number().int().positive(),
  contactId: z.number().int().positive().nullable(),
  amountUsd: z.number(),
  closeDate: z.any().nullable(),
  updatedAt: z.any().nullable(),
  stageCode: z.string(),
  stageName: z.string(),
  commercialStatusCode: z.string(),
});

const customerIntelligenceInteractionSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  analysisStatus: z.string(),
  summary: z.string(),
  sourceNotes: z.string(),
  leadSubstatusCode: z.string(),
  leadReasonCode: z.string(),
  leadRequiredActionCode: z.string(),
  leadNextActionDueAt: z.any().nullable(),
  updatedAt: z.any().nullable(),
});

const customerIntelligenceRenewalSchema = z.object({
  id: z.number().int().positive(),
  opportunityId: z.number().int().positive(),
  providerId: z.number().int().positive(),
  providerName: z.string(),
  statusCode: z.string(),
  expiresAt: z.any().nullable(),
  renewalCount: z.number().int().nonnegative(),
  lastRenewedAt: z.any().nullable(),
  notes: z.string(),
});

const customerIntelligenceProductSchema = z.object({
  quotationId: z.number().int().positive(),
  quotationVersionId: z.number().int().positive(),
  opportunityId: z.number().int().positive(),
  providerId: z.number().int().positive(),
  providerName: z.string(),
  productCode: z.string(),
  description: z.string(),
  itemType: z.string(),
  isRenewal: z.boolean(),
  quantity: z.number(),
  listPriceUnit: z.number().nullable(),
  currencyCode: z.string().nullable(),
  commercialStatus: z.enum(["accepted", "won"]),
  fulfillmentStatus: z.literal("not_verified"),
});

const customerIntelligenceExpansionSchema = z.object({
  type: z.enum(["renewal", "upsell", "cross_sell"]),
  title: z.string(),
  summary: z.string(),
  evidence: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  sourceProductCode: z.string().nullable(),
  suggestedProductCode: z.string().nullable(),
  suggestedProductDescription: z.string().nullable(),
  opportunityId: z.number().int().positive().nullable(),
  requiresConfirmation: z.literal(true),
});

const customerIntelligenceHealthSignalSchema = z.object({
  code: z.string().trim().min(1).max(80),
  severity: z.enum(["high", "medium", "low", "info"]),
  title: z.string().trim().min(1).max(190),
  summary: z.string().trim().min(1).max(1000),
  evidence: z.string().trim().max(2000),
  source: z.string().trim().min(1).max(120),
  entityType: z.string().trim().max(60).nullable(),
  entityId: z.number().int().positive().nullable(),
});

const customerIntelligenceHealthSchema = z.object({
  status: z.enum(["healthy", "attention", "at_risk", "insufficient_data"]),
  score: z.number().min(0).max(100),
  signals: z.array(customerIntelligenceHealthSignalSchema),
  metrics: z.object({
    contactCount: z.number().int().nonnegative(),
    opportunityCount: z.number().int().nonnegative(),
    riskyOpportunityCount: z.number().int().nonnegative(),
    interactionCount: z.number().int().nonnegative(),
    daysSinceLastInteraction: z.number().int().nonnegative().nullable(),
    renewalCount: z.number().int().nonnegative(),
    productCount: z.number().int().nonnegative(),
  }),
});

export const customerIntelligenceSnapshotSchema = z.object({
  snapshotVersion: z.literal("account-intelligence.v1"),
  capturedAt: z.string().datetime({ offset: true }),
  account: customerIntelligenceAccountSchema.nullable(),
  selectedOpportunity: customerIntelligenceOpportunitySchema.extend({ contactId: z.number().int().positive().nullable() }).nullable(),
  selectedContact: customerIntelligenceContactSchema.nullable(),
  contacts: z.array(customerIntelligenceContactSchema),
  opportunities: z.array(customerIntelligenceOpportunitySchema),
  interactions: z.array(customerIntelligenceInteractionSchema),
  activities: z.array(customerIntelligenceInteractionSchema),
  renewals: z.array(customerIntelligenceRenewalSchema),
  products: z.array(customerIntelligenceProductSchema),
  expansionHypotheses: z.array(customerIntelligenceExpansionSchema),
  supportCases: z.array(z.record(z.string(), z.any())),
  dataAvailability: z.object({
    products: z.boolean(),
    supportCases: z.boolean(),
  }),
  accountHealth: customerIntelligenceHealthSchema,
  permissions: z.object({
    canReadAccounts: z.boolean(),
    canReadContacts: z.boolean(),
    canReadOpportunities: z.boolean(),
    canReadInteractions: z.boolean(),
  }),
});

export function normalizeCustomerIntelligenceSnapshot(input = {}) {
  return customerIntelligenceSnapshotSchema.parse({
    snapshotVersion: "account-intelligence.v1",
    capturedAt: input.capturedAt || new Date().toISOString(),
    account: input.account || null,
    selectedOpportunity: input.selectedOpportunity || null,
    selectedContact: input.selectedContact || null,
    contacts: input.contacts || [],
    opportunities: input.opportunities || [],
    interactions: input.interactions || [],
    activities: input.activities || input.interactions || [],
    renewals: input.renewals || [],
    products: input.products || [],
    expansionHypotheses: input.expansionHypotheses || [],
    supportCases: input.supportCases || [],
    dataAvailability: input.dataAvailability || { products: false, supportCases: false },
    accountHealth: input.accountHealth || {
      status: "insufficient_data",
      score: 0,
      signals: [],
      metrics: {
        contactCount: 0,
        opportunityCount: 0,
        riskyOpportunityCount: 0,
        interactionCount: 0,
        daysSinceLastInteraction: null,
        renewalCount: 0,
        productCount: 0,
      },
    },
    permissions: input.permissions || {
      canReadAccounts: false,
      canReadContacts: false,
      canReadOpportunities: false,
      canReadInteractions: false,
    },
  });
}

export function normalizeCustomerIntelligenceFinding(input = {}) {
  const metadata = input.metadata && typeof input.metadata === "object"
    ? input.metadata
    : {};
  const parsed = customerIntelligenceFindingSchema.parse({
    sourceDomain: input.sourceDomain ?? (input.sourceType === "tavily" || input.sourceType === "public_web" ? "public_web" : "crm_internal"),
    category: input.category,
    title: input.title,
    summary: input.summary,
    evidence: input.evidence ?? input.evidenceText ?? "",
    source: input.source ?? input.sourceType ?? "crm",
    sourceUrl: input.sourceUrl ?? input.sourceReference ?? "",
    confidence: input.confidence ?? "medium",
    certainty: input.certainty ?? "inferred",
    targetEntity: input.targetEntity ?? metadata.targetEntity ?? null,
    targetField: input.targetField ?? metadata.targetField ?? null,
    suggestedValue: input.suggestedValue ?? metadata.suggestedValue ?? null,
    requiresConfirmation: input.requiresConfirmation ?? input.status !== "confirmed",
  });
  return {
    ...parsed,
    evidenceText: parsed.evidence,
    sourceType: parsed.source,
    sourceReference: parsed.sourceUrl,
    metadata: {
      ...metadata,
      targetEntity: parsed.targetEntity,
      targetField: parsed.targetField,
      suggestedValue: parsed.suggestedValue,
      requiresConfirmation: parsed.requiresConfirmation,
    },
  };
}

export function normalizeCustomerIntelligenceResult(input = {}) {
  return customerIntelligenceResultSchema.parse({
    sourceDomain: input.sourceDomain || "crm_internal",
    scope: input.scope?.length ? input.scope : ["executive_summary"],
    headline: input.headline,
    summary: input.summary,
    findings: (input.findings || []).map(normalizeCustomerIntelligenceFinding),
    generatedAt: input.generatedAt || new Date().toISOString(),
  });
}