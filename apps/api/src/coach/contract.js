import { z } from "zod";

const positiveId = z.number().int().positive();
const nullablePositiveId = positiveId.nullable().optional();
const text = (max) => z.string().trim().min(1).max(max);
const optionalText = (max) => z.string().trim().max(max).nullable().optional();

export const coachContextSchema = z
  .object({
    accountId: nullablePositiveId,
    contactId: nullablePositiveId,
    opportunityId: nullablePositiveId,
    quotationVersionId: nullablePositiveId,
    quotationId: nullablePositiveId,
    proposalId: nullablePositiveId,
    leadId: nullablePositiveId,
  })
  .strict();

export const coachEvidenceSchema = z
  .object({
    sourceType: z.enum([
      "account",
      "contact",
      "opportunity",
      "lead",
      "stage_answer",
      "activity",
      "quotation",
      "proposal",
      "document",
      "process_guide",
      "crm_context",
      "conversation",
    ]),
    sourceId: positiveId.nullable(),
    label: text(300),
    excerpt: optionalText(1200),
  })
  .strict();

const readinessItemSchema = z
  .object({
    title: text(300),
    detail: text(1600),
    evidence: z.array(coachEvidenceSchema).max(12).default([]),
  })
  .strict();

export const stageReadinessSchema = z
  .object({
    currentStage: z
      .object({
        id: positiveId,
        code: text(100),
        name: text(200),
        objective: text(1600),
      })
      .strict(),
    confirmedProgress: z.array(readinessItemSchema).max(30),
    pendingItems: z.array(readinessItemSchema).max(30),
    risks: z
      .array(
        readinessItemSchema
          .extend({
            severity: z.enum(["low", "medium", "high", "critical"]),
            mitigation: optionalText(1200),
          })
          .strict(),
      )
      .max(30),
    nextStep: z
      .object({
        action: text(800),
        responsibleUserId: positiveId.nullable(),
        targetDate: z.iso.date().nullable(),
        successCriteria: text(1200),
      })
      .strict(),
    recommendation: z.enum(["advance", "advance_with_caution", "remain"]),
    rationale: text(2400),
  })
  .strict();

const operationCommon = {
  title: text(300),
  evidence: z.array(coachEvidenceSchema).max(12).default([]),
  missingFields: z.array(text(120)).max(30).default([]),
  requiresConfirmation: z.literal(true).default(true),
  persistentId: positiveId.optional(),
  persistenceVersion: positiveId.optional(),
  persistenceStatus: z
    .enum([
      "proposed",
      "collecting",
      "ready",
      "handed_off",
      "executing",
      "completed",
      "failed",
      "rejected",
      "cancelled",
      "superseded",
      "reverted",
    ])
    .optional(),
};

const sourceSchema = (type) =>
  z
    .object({
      type: z.literal(type),
      id: positiveId,
    })
    .strict();

const activityOperationSchema = z
  .object({
    kind: z.literal("activity"),
    ...operationCommon,
    opportunityId: nullablePositiveId,
    activityId: nullablePositiveId,
    actionType: z.enum([
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
    ]),
    status: z.enum(["pending", "in_progress", "blocked", "done"]),
    priority: z.enum(["low", "medium", "high"]),
    scheduledAt: optionalText(40),
    dueDate: z.iso.date().nullable().optional(),
    notes: optionalText(4000),
    successCriteria: optionalText(1200),
    activitySearch: optionalText(300),
    entityType: z.literal("opportunity_activity").optional(),
    source: sourceSchema("opportunity").nullable().optional(),
  })
  .strict();

const stageAnswerOperationSchema = z
  .object({
    kind: z.literal("stage_answer"),
    ...operationCommon,
    opportunityId: positiveId,
    questionId: positiveId,
    answerValue: text(4000),
    answerMode: z.enum(["replace", "append"]),
    previousAnswer: optionalText(4000),
    entityType: z.literal("stage_answer").optional(),
    source: sourceSchema("opportunity").optional(),
  })
  .strict();

const opportunityFieldOperationSchema = z
  .object({
    kind: z.literal("opportunity_field"),
    ...operationCommon,
    opportunityId: positiveId,
    field: z.enum(["name", "amountUsd", "closeDate"]),
    currentValue: z.union([z.string(), z.number(), z.null()]).optional(),
    value: z.union([z.string(), z.number()]),
    entityType: z.literal("opportunity").optional(),
    source: sourceSchema("opportunity").optional(),
  })
  .strict();

const accountFieldOperationSchema = z
  .object({
    kind: z.literal("account_field"),
    ...operationCommon,
    accountId: positiveId,
    field: z.enum([
      "name",
      "phone",
      "website",
      "city",
      "stateRegion",
      "companyDescription",
    ]),
    currentValue: z.union([z.string(), z.number(), z.null()]).optional(),
    value: z.union([z.string(), z.number()]),
    entityType: z.literal("account").optional(),
    source: sourceSchema("account").optional(),
  })
  .strict();

const contactFieldOperationSchema = z
  .object({
    kind: z.literal("contact_field"),
    ...operationCommon,
    contactId: positiveId,
    field: z.enum([
      "firstName",
      "lastName",
      "email",
      "mobile",
      "phone",
      "positionTitle",
      "department",
      "city",
      "stateRegion",
      "hierarchyLevelId",
      "relationshipTypeId",
      "influenceLevelId",
      "managerContactId",
      "influencesContactId",
    ]),
    currentValue: z.union([z.string(), z.number(), z.null()]).optional(),
    value: z.union([z.string(), z.number()]),
    entityType: z.literal("contact").optional(),
    source: sourceSchema("contact").optional(),
  })
  .strict();

const leadCallOutcomeOperationSchema = z
  .object({
    kind: z.literal("lead_call_outcome"),
    ...operationCommon,
    interactionId: positiveId,
    substatusCode: text(100),
    reasonCode: text(100),
    requiredActionCode: text(100),
    comment: optionalText(4000),
    nextActionDueAt: z.iso.date().nullable().optional(),
    entityType: z.literal("lead").optional(),
    source: sourceSchema("lead").optional(),
  })
  .strict();

function handoffSchema(kind, targetModule, entityType) {
  return z
    .object({
      kind: z.literal(kind),
      ...operationCommon,
      targetModule: z.literal(targetModule).default(targetModule),
      payload: z.record(z.string(), z.unknown()),
      accountId: nullablePositiveId,
      contactId: nullablePositiveId,
      opportunityId: nullablePositiveId,
      interactionId: nullablePositiveId,
      quotationVersionId: nullablePositiveId,
      entityType: z.literal(entityType).optional(),
      source: z
        .object({
          type: z.enum([
            "account",
            "contact",
            "opportunity",
            "lead",
            "quotation",
            "proposal",
          ]),
          id: positiveId.nullable(),
        })
        .strict()
        .nullable()
        .optional(),
    })
    .strict();
}

export const coachOperationSchema = z.discriminatedUnion("kind", [
  activityOperationSchema,
  stageAnswerOperationSchema,
  opportunityFieldOperationSchema,
  accountFieldOperationSchema,
  contactFieldOperationSchema,
  leadCallOutcomeOperationSchema,
  handoffSchema("create_account", "accounts", "account"),
  handoffSchema("create_contact", "contacts", "contact"),
  handoffSchema("create_opportunity", "opportunities", "opportunity"),
  handoffSchema("create_lead", "interactions", "lead"),
  handoffSchema("create_contact_mapping", "contact_mapping", "contact_mapping"),
  handoffSchema("create_quotation", "quotations", "quotation"),
  handoffSchema("create_proposal", "proposals", "proposal"),
  handoffSchema("lead_resolve", "interactions", "lead"),
]);

export const coachEntitiesSchema = z
  .object({
    opportunityId: positiveId.nullable(),
    accountId: positiveId.nullable(),
    contactId: positiveId.nullable(),
    leadId: positiveId.nullable(),
    names: z.array(text(300)).max(20),
  })
  .strict();

export const coachClarificationSchema = z
  .object({
    type: z.enum([
      "select_account",
      "select_opportunity",
      "select_contact",
      "select_lead",
      "missing_fields",
    ]),
    message: text(1000),
    missing: z.array(text(120)).max(30),
    candidates: z
      .array(
        z
          .object({
            id: positiveId,
            name: text(300),
            accountId: nullablePositiveId,
            contactId: nullablePositiveId,
            opportunityId: nullablePositiveId,
            accountName: optionalText(300),
            stageName: optionalText(200),
            email: optionalText(320),
            positionTitle: optionalText(200),
            website: optionalText(500),
            city: optionalText(200),
            entityType: z
              .enum(["account", "opportunity", "contact", "lead"])
              .optional(),
          })
          .strict(),
      )
      .max(20),
    activity: z
      .object({
        actionType: text(100),
        title: text(300),
        rawRequest: optionalText(2000),
      })
      .strict()
      .nullable()
      .optional(),
    originalRequest: optionalText(2000),
    intendedAction: optionalText(120),
  })
  .strict();

export const coachRecommendationSchema = z
  .object({
    action: text(1200),
    rationale: text(2400),
    expectedOutcome: text(1200),
    successCriteria: text(1200),
    responsibleUserId: positiveId.nullable(),
    targetDate: z.iso.date().nullable(),
  })
  .strict();

export const coachActionSchema = z
  .object({
    title: text(300),
    opportunityId: positiveId.nullable(),
    actionType: text(100),
    status: z.enum(["pending", "in_progress", "blocked", "done"]),
    priority: z.enum(["low", "medium", "high"]),
    suggestedDueDate: z.iso.date().nullable(),
    scheduledAt: optionalText(40),
    notes: optionalText(4000),
    successCriteria: optionalText(1200),
  })
  .strict();

export const coachResponseSchema = z
  .object({
    intent: z.enum([
      "seller_status",
      "today_priorities",
      "at_risk_opportunities",
      "neglected_accounts",
      "pipeline_coverage",
      "opportunity_preparation",
      "context_query",
      "risk_diagnosis",
      "recommendation",
      "interaction_preparation",
      "create_record",
      "update_record",
      "continue_work",
      "clarification",
      "freeform",
    ]),
    responseType: z.enum([
      "informational",
      "recommendation",
      "change_request",
      "clarification",
    ]),
    answer: text(6000),
    facts: z.array(coachEvidenceSchema).max(30),
    evidence: z.array(text(1600)).max(30),
    inferences: z.array(text(1600)).max(30),
    pendingItems: z.array(text(1600)).max(30),
    recommendation: z.union([
      coachRecommendationSchema,
      z.string().trim().max(2400),
      z.null(),
    ]),
    confidence: z.enum(["high", "medium", "low"]),
    entities: coachEntitiesSchema,
    operations: z.array(coachOperationSchema).max(6),
    clarification: coachClarificationSchema.nullable(),
    action: coachActionSchema.nullable(),
    stageReadiness: stageReadinessSchema.nullable(),
  })
  .strict()
  .superRefine((response, context) => {
    if (
      response.intent === "opportunity_preparation" &&
      !response.stageReadiness
    ) {
      context.addIssue({
        code: "custom",
        path: ["stageReadiness"],
        message: "El diagnóstico de etapa es obligatorio para esta intención",
      });
    }
  });

export const coachTurnSchema = z
  .object({
    role: z.enum(["seller", "coach"]),
    text: optionalText(4000),
    result: coachResponseSchema.optional(),
    context: coachContextSchema.optional(),
    createdAt: z.iso.datetime().optional(),
  })
  .strict();

export const coachOperationResultSchema = z
  .object({
    operationId: positiveId,
    status: z.enum([
      "proposed",
      "collecting",
      "ready",
      "handed_off",
      "executing",
      "cancelled",
      "failed",
      "completed",
      "superseded",
    ]),
    targetModule: z
      .enum([
        "accounts",
        "contacts",
        "opportunities",
        "interactions",
        "contact_mapping",
        "quotations",
        "proposals",
        "commercial_development",
      ])
      .nullable(),
    entityId: positiveId.nullable(),
    message: text(1200),
    errorCode: optionalText(120),
  })
  .strict();

export function parseCoachContext(value) {
  return coachContextSchema.parse(value || {});
}

export function parseCoachResponse(value) {
  return coachResponseSchema.parse(value);
}

export function safeParseCoachResponse(value) {
  return coachResponseSchema.safeParse(value);
}

export function filterValidCoachOperations(operations) {
  return (Array.isArray(operations) ? operations : [])
    .map((operation) => coachOperationSchema.safeParse(operation))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data);
}
