import { z } from "zod";

const plannerFiltersSchema = z.object({
  common: z
    .object({
      recentOnly: z.boolean().default(false),
    })
    .default({ recentOnly: false }),
  accounts: z
    .object({
      activeOnly: z.boolean().default(true),
      activationStatusCodes: z.array(z.string()).default([]),
    })
    .default({ activeOnly: true, activationStatusCodes: [] }),
  contacts: z
    .object({
      activeOnly: z.boolean().default(true),
      activationStatusCodes: z.array(z.string()).default([]),
    })
    .default({ activeOnly: true, activationStatusCodes: [] }),
  opportunities: z
    .object({
      openOnly: z.boolean().default(false),
      activeOnly: z.boolean().default(true),
      activationStatusCodes: z.array(z.string()).default([]),
      commercialStatusCodes: z.array(z.string()).default([]),
      salesStageCodes: z.array(z.string()).default([]),
    })
    .default({
      openOnly: false,
      activeOnly: true,
      activationStatusCodes: [],
      commercialStatusCodes: [],
      salesStageCodes: [],
    }),
  quotations: z
    .object({
      activeOnly: z.boolean().default(true),
      activationStatusCodes: z.array(z.string()).default([]),
      latestStatusCodes: z.array(z.string()).default([]),
    })
    .default({
      activeOnly: true,
      activationStatusCodes: [],
      latestStatusCodes: [],
    }),
  proposals: z
    .object({
      statusCodes: z.array(z.string()).default([]),
      quotationVersionStatusCodes: z.array(z.string()).default([]),
    })
    .default({
      statusCodes: [],
      quotationVersionStatusCodes: [],
    }),
});

export const sessionSchema = z.object({
  locale: z.string().trim().min(2).max(16).optional().default("es"),
  userContext: z.record(z.string(), z.any()).optional().default({}),
});

export const messageSchema = z.object({
  sessionId: z.string().trim().min(8).max(64),
  message: z.string().trim().min(1).max(4000),
  useContext: z.boolean().optional().default(true),
  contextSnapshot: z.record(z.string(), z.any()).optional().default({}),
  featureCode: z
    .string()
    .trim()
    .min(3)
    .max(100)
    .optional()
    .default("chatbot.assistant"),
});

export const plannerOutputSchema = z.object({
  mode: z.enum(["knowledge", "crm_lookup"]),
  targetEntityType: z.enum(["none", "account", "contact", "opportunity"]),
  targetEntityName: z.string().default(""),
  contextEntityId: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .default(null),
  requestedDomains: z.array(
    z.enum([
      "accounts",
      "contacts",
      "opportunities",
      "quotations",
      "proposals",
      "documentation",
    ]),
  ),
  filters: plannerFiltersSchema.default({}),
  clarificationNeeded: z.boolean().default(false),
  clarificationQuestion: z.string().default(""),
  confidence: z.number().min(0).max(1).optional().default(0.7),
});

export const resolverOutputSchema = z.object({
  resolutionStatus: z.enum([
    "resolved",
    "ambiguous",
    "not_found",
    "clarification_required",
  ]),
  selectedEntityType: z.enum(["none", "account", "contact", "opportunity"]),
  selectedEntityId: z.number().int().positive().nullable().default(null),
  confidence: z.number().min(0).max(1).default(0.5),
  clarificationNeeded: z.boolean().default(false),
  clarificationQuestion: z.string().default(""),
});

export const answerOutputSchema = z.object({
  answer: z.string(),
  sourceType: z.enum(["knowledge", "crm_data", "mixed", "fallback"]),
  confidence: z.number(),
  references: z.array(z.string()),
});
