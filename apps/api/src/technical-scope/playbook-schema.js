import { z } from "zod";
import { normalizeTopology } from "../../../../shared/topology.js";

const code = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9_]+$/, "Usa minusculas, numeros y guion bajo");
const shortText = z.string().trim().max(300);
const longText = z.string().trim().max(2_000);

export const QUESTION_TYPES = ["text", "number", "boolean", "choice", "multi"];
export const CONDITION_OPERATORS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "truthy",
  "contains",
];

const conditionSchema = z.object({
  question: code,
  op: z.enum(CONDITION_OPERATORS),
  value: z.union([z.string(), z.number(), z.boolean()]).optional().nullable(),
});

export const playbookQuestionSchema = z.object({
  code,
  module: code.default("general"),
  section: shortText.optional().default(""),
  prompt: z.string().trim().min(3).max(500),
  type: z.enum(QUESTION_TYPES).default("text"),
  options: z.array(shortText).max(30).optional().default([]),
  required: z.boolean().optional().default(false),
  helpText: longText.optional().default(""),
  unit: z.string().trim().max(30).optional().default(""),
});

export const playbookModuleSchema = z.object({
  code,
  name: z.string().trim().min(1).max(160),
  description: longText.optional().default(""),
  detectKeywords: z.array(shortText).max(20).optional().default([]),
});

const regexSource = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => {
    try {
      new RegExp(value, "i");
      return true;
    } catch {
      return false;
    }
  }, "Expresion regular invalida");

const severity = z.enum(["blocking", "warning"]).default("warning");

export const playbookExpectationSchema = z.object({
  code,
  when: conditionSchema,
  expectProduct: regexSource,
  message: z.string().trim().min(3).max(500),
  severity,
});

export const playbookDependencySchema = z.object({
  code,
  ifProduct: regexSource,
  requireProduct: regexSource,
  unless: conditionSchema.optional().nullable(),
  message: z.string().trim().min(3).max(500),
  severity,
});

const stringList = z.array(z.string().trim().min(1).max(600)).max(60);

export const playbookScopeSchema = z.object({
  included: stringList.optional().default([]),
  excluded: stringList.optional().default([]),
  assumptions: stringList.optional().default([]),
  clientResponsibilities: stringList.optional().default([]),
  deliverables: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        description: z.string().trim().max(600).optional().default(""),
      }),
    )
    .max(40)
    .optional()
    .default([]),
  phases: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        activities: stringList.optional().default([]),
        durationHint: z.string().trim().max(120).optional().default(""),
      }),
    )
    .max(20)
    .optional()
    .default([]),
  acceptanceCriteria: stringList.optional().default([]),
  supportNotes: stringList.optional().default([]),
  risks: stringList.optional().default([]),
});

export const playbookTopologyTemplateSchema = z.object({
  code,
  name: z.string().trim().min(1).max(160),
  description: longText.optional().default(""),
  topology: z
    .any()
    .transform((value) => normalizeTopology(value))
    .default({ zones: [], nodes: [], edges: [] }),
});

export const playbookContentSchema = z
  .object({
    summary: longText.optional().default(""),
    modules: z.array(playbookModuleSchema).max(20).default([]),
    questions: z.array(playbookQuestionSchema).max(200).default([]),
    expectations: z.array(playbookExpectationSchema).max(60).optional().default([]),
    dependencies: z.array(playbookDependencySchema).max(60).optional().default([]),
    scope: playbookScopeSchema.optional().default({}),
    topologyTemplates: z
      .array(playbookTopologyTemplateSchema)
      .max(20)
      .optional()
      .default([]),
  })
  .superRefine((value, context) => {
    const moduleCodes = new Set(["general", ...value.modules.map((m) => m.code)]);
    const seen = new Set();
    value.questions.forEach((question, index) => {
      if (seen.has(question.code)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Pregunta repetida: ${question.code}`,
          path: ["questions", index, "code"],
        });
      }
      seen.add(question.code);
      if (!moduleCodes.has(question.module)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Modulo inexistente: ${question.module}`,
          path: ["questions", index, "module"],
        });
      }
      if (
        (question.type === "choice" || question.type === "multi") &&
        question.options.length === 0
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "La pregunta de opcion requiere opciones",
          path: ["questions", index, "options"],
        });
      }
    });
    const check = (condition, path) => {
      if (condition && !seen.has(condition.question)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `La condicion usa una pregunta inexistente: ${condition.question}`,
          path,
        });
      }
    };
    value.expectations.forEach((rule, index) =>
      check(rule.when, ["expectations", index, "when"]),
    );
    value.dependencies.forEach((rule, index) =>
      check(rule.unless, ["dependencies", index, "unless"]),
    );
  });

export const PLAYBOOK_STATUS = Object.freeze({
  draftAi: "borrador_ia",
  validated: "validado",
  archived: "archivado",
});

export function parsePlaybookContent(raw) {
  return playbookContentSchema.parse(raw);
}
