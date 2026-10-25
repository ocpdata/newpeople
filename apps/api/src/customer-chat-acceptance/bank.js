import { readFile } from "node:fs/promises";
import { z } from "zod";

const identifier = z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/);
// «dossier» tells where a fact stored as an ID (sector, owner) appears by name in the dossier.
const dossierLocation = z.object({
  evidenceId: z.string().min(1).max(80),
  field: z.string().min(1).max(64),
  equals: z.union([z.string(), z.number()]).optional(),
  contains: z.string().min(1).optional(),
}).strict().refine((value) => (value.equals === undefined) !== (value.contains === undefined),
  "dossier requiere equals o contains, no ambos.");
const factBase = {
  table: z.string().min(1).max(64), meaning: z.string().max(300).optional(),
  dossier: dossierLocation.optional(), dossierOpportunityId: z.number().int().positive().optional(),
};
const fieldFactSchema = z.object({
  ...factBase,
  id: z.number().int().positive(),
  field: z.string().min(1).max(64),
  equals: z.union([z.string(), z.number()]).optional(),
  contains: z.string().min(1).optional(),
}).strict().refine((fact) => (fact.equals === undefined) !== (fact.contains === undefined), {
  message: "Un hecho de campo requiere exactamente equals o contains.",
});
const countFactSchema = z.object({
  ...factBase,
  where: z.record(z.string().min(1).max(64), z.union([z.string(), z.number()])),
  count: z.number().int().min(0),
}).strict().refine((fact) => Object.keys(fact.where).length > 0, { message: "Un conteo requiere filtros." });

const requiredSchema = z.object({
  id: identifier,
  critical: z.boolean(),
  statement: z.string().min(1).max(600),
  evidence: z.array(z.string()).default([]),
}).strict();
const forbiddenSchema = z.object({ id: identifier, statement: z.string().min(1).max(600) }).strict();
const formSchema = z.object({
  kind: z.literal("exact_items"),
  count: z.number().int().min(1).max(10),
  itemRequirement: z.string().min(1).max(600),
}).strict();
const turnSchema = z.object({
  id: identifier,
  question: z.string().min(1).max(2000),
  mustInclude: z.array(requiredSchema).min(1),
  mustNotClaim: z.array(forbiddenSchema).default([]),
  form: formSchema.optional(),
  allowClarification: z.boolean().default(false),
}).strict();
const conversationSchema = z.object({
  id: identifier,
  title: z.string().min(1).max(200),
  accountId: z.number().int().positive(),
  focusOpportunityId: z.number().int().positive().optional(),
  turns: z.array(turnSchema).min(1),
}).strict();

export const acceptanceBankSchema = z.object({
  version: z.literal(1),
  description: z.string().min(1),
  facts: z.record(identifier, z.union([fieldFactSchema, countFactSchema])),
  conversations: z.array(conversationSchema).min(1),
}).strict().superRefine((bank, ctx) => {
  const conversationIds = new Set();
  for (const conversation of bank.conversations) {
    if (conversationIds.has(conversation.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Conversación duplicada: ${conversation.id}` });
    }
    conversationIds.add(conversation.id);
    const turnIds = new Set();
    for (const turn of conversation.turns) {
      if (turnIds.has(turn.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Turno duplicado: ${conversation.id}/${turn.id}` });
      }
      turnIds.add(turn.id);
      const checkIds = [...turn.mustInclude, ...turn.mustNotClaim].map((item) => item.id);
      if (new Set(turn.mustInclude.map((item) => item.id)).size !== turn.mustInclude.length ||
          new Set(turn.mustNotClaim.map((item) => item.id)).size !== turn.mustNotClaim.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Comprobaciones duplicadas en ${conversation.id}/${turn.id}: ${checkIds.join(",")}` });
      }
      for (const item of turn.mustInclude) {
        for (const factId of item.evidence) {
          if (!bank.facts[factId]) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Evidencia inexistente ${factId} en ${conversation.id}/${turn.id}/${item.id}`,
            });
          }
        }
      }
    }
  }
});

export function parseAcceptanceBank(value) {
  return acceptanceBankSchema.parse(value);
}

export const DEFAULT_BANK_URL = new URL("./bank.json", import.meta.url);

export async function loadAcceptanceBank(url = DEFAULT_BANK_URL) {
  return parseAcceptanceBank(JSON.parse(await readFile(url, "utf8")));
}

export function selectConversations(bank, ids = []) {
  if (!ids.length) return bank.conversations;
  const unknown = ids.filter((id) => !bank.conversations.some((item) => item.id === id));
  if (unknown.length) throw new Error(`Conversaciones desconocidas: ${unknown.join(", ")}`);
  return bank.conversations.filter((item) => ids.includes(item.id));
}
