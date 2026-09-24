import { z } from "zod";

export const coachContextSchema = z.object({
  accountId: z.number().int().positive().nullable().optional(),
  contactId: z.number().int().positive().nullable().optional(),
  opportunityId: z.number().int().positive().nullable().optional(),
  quotationVersionId: z.number().int().positive().nullable().optional(),
  quotationId: z.number().int().positive().nullable().optional(),
  proposalId: z.number().int().positive().nullable().optional(),
  leadId: z.number().int().positive().nullable().optional(),
}).passthrough();

export const coachOperationSchema = z.object({
  kind: z.enum([
    "activity",
    "stage_answer",
    "opportunity_field",
    "account_field",
    "contact_field",
    "lead_call_outcome",
    "create_account",
    "create_contact",
    "create_opportunity",
    "create_quotation",
    "create_proposal",
    "lead_resolve",
  ]),
  opportunityId: z.number().int().positive().nullable().optional(),
  accountId: z.number().int().positive().nullable().optional(),
  contactId: z.number().int().positive().nullable().optional(),
  interactionId: z.number().int().positive().nullable().optional(),
  questionId: z.number().int().positive().nullable().optional(),
  activityId: z.number().int().positive().nullable().optional(),
  field: z.string().trim().min(1).nullable().optional(),
  value: z.union([z.string(), z.number()]).nullable().optional(),
  answerValue: z.string().trim().nullable().optional(),
  answerMode: z.enum(["replace", "append"]).nullable().optional(),
  title: z.string().trim().min(1).nullable().optional(),
  payload: z.record(z.string(), z.unknown()).nullable().optional(),
}).passthrough();

export const coachTurnSchema = z.object({
  role: z.enum(["seller", "coach"]),
  text: z.string().trim().max(4000).optional(),
  result: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export function parseCoachContext(value) {
  return coachContextSchema.parse(value || {});
}

export function filterValidCoachOperations(operations) {
  return (Array.isArray(operations) ? operations : [])
    .map((operation) => coachOperationSchema.safeParse(operation))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data);
}
