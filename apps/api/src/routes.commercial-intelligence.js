import {
  loadCoachBusinessRulesWithSource,
  resetCoachBusinessRules,
  saveCoachBusinessRules,
} from "./coach/business-rules.js";
import {
  createCoachAdminRule,
  deleteCoachAdminRule,
  getCoachAdminRule,
  listCoachAdminRules,
  updateCoachAdminRule,
} from "./coach/admin-rules.js";
import {
  listCoachIntentCatalog,
  listCoachIntentRevisions,
  restoreCoachIntentRevision,
  updateCoachIntentExamples,
} from "./coach/intent-governance.js";
import {
  listChannelIntentRevisions,
  loadChannelIntentConfigurations,
  previewChannelIntent,
  restoreChannelIntentRevision,
  updateChannelIntentConfiguration,
} from "./coach/channel-intent-governance.js";
import express from "express";
import { z } from "zod";
import { requirePermission } from "./auth.js";
import { logAuditEvent } from "./audit.js";
import { ensureCommercialIntelligencePermissions } from "./commercial-intelligence/permissions.js";
import { ensureCommercialIntelligenceSchema } from "./commercial-intelligence/schema.js";
import {
  createCommercialDiscoveryJob,
  createCustomerIntelligenceJob,
  createAccountInternalAnalysisJob,
  createCustomerExternalResearchJob,
  createCustomerExecutiveBriefingJob,
  buildAuthorizedCustomerSnapshot,
  getCustomerIntelligenceJob,
  getMiCoachGovernanceOverview,
  listCustomerIntelligenceFindings,
  applyCustomerIntelligenceFinding,
  applyCustomerContactFinding,
  processCommercialDiscoveryJob,
  processCustomerIntelligenceJob,
  processAccountInternalAnalysisJob,
  processCustomerExternalResearchJob,
  processCustomerExecutiveBriefingJob,
  createAccountIntelligenceAgentsJob,
  processAccountIntelligenceAgentsJob,
  getAccountIntelligenceMetrics,
  createCustomerAccountChatSession,
  createCustomerAccountChatJob,
  getCustomerAccountChatSession,
  processCustomerAccountChatJob,
  updateCustomerIntelligenceFindingStatus,
  updateMiCoachGovernanceSettings,
} from "./commercial-intelligence/service.js";

const router = express.Router();

const jobCreateSchema = z.object({
  accountId: z.number().int().positive().optional().nullable(),
  opportunityId: z.number().int().positive().optional().nullable(),
  contactId: z.number().int().positive().optional().nullable(),
  objective: z.string().trim().max(1000).optional().default(""),
  includePublicResearch: z.boolean().optional().default(false),
});

const findingsQuerySchema = z.object({
  accountId: z.coerce.number().int().positive().optional(),
  opportunityId: z.coerce.number().int().positive().optional(),
  contactId: z.coerce.number().int().positive().optional(),
  status: z.enum(["suggested", "confirmed", "rejected", "outdated"]).optional(),
});

const snapshotQuerySchema = z.object({
  accountId: z.coerce.number().int().positive().optional().nullable(),
  opportunityId: z.coerce.number().int().positive().optional().nullable(),
  contactId: z.coerce.number().int().positive().optional().nullable(),
});

const channelIntentChannelSchema = z.enum(["customer_account", "prospect"]);
const channelIntentConfigurationSchema = z.object({
  enabled: z.boolean(),
  examples: z.array(z.string().trim().min(1).max(240)).min(1).max(30),
  priority: z.number().int().min(0).max(200),
  allowedTools: z.array(z.string().trim().min(1)).max(20),
  requiredContext: z
    .array(z.enum(["account", "opportunity", "contact", "prospectSession"]))
    .max(4),
});
const channelIntentPreviewSchema = z.object({
  channel: channelIntentChannelSchema,
  question: z.string().trim().min(1).max(1200),
  intentCode: z.string().trim().min(1).max(80).optional(),
  configuration: channelIntentConfigurationSchema.optional(),
});

const customerChatSessionSchema = jobCreateSchema.pick({
  accountId: true,
  opportunityId: true,
  contactId: true,
});

const governanceSettingsSchema = z.object({
  externalSourcesEnabled: z.boolean().optional(),
  includeWonOpportunities: z.boolean().optional(),
  includeLostOpportunities: z.boolean().optional(),
  includeCancelledOpportunities: z.boolean().optional(),
  dailyResearchLimitPerUser: z.number().int().min(1).max(500).optional(),
  findingRetentionDays: z.number().int().min(30).max(3650).optional(),
  requireEvidenceForExternalFindings: z.boolean().optional(),
  allowProspectConversion: z.boolean().optional(),
  qualifiedOpportunityStageCodes: z
    .array(
      z.enum([
        "contacto_inicial",
        "identificacion_oportunidad",
        "desarrollo",
        "cotizacion",
        "demostracion",
        "negociacion",
        "waiting",
      ]),
    )
    .min(1)
    .optional(),
  committedOpportunityStageCodes: z
    .array(
      z.enum([
        "contacto_inicial",
        "identificacion_oportunidad",
        "desarrollo",
        "cotizacion",
        "demostracion",
        "negociacion",
        "waiting",
      ]),
    )
    .min(1)
    .optional(),
  notes: z.string().trim().max(1000).optional(),
});

const coachBusinessRulesSchema = z.object({
  channel: z.enum(["coach", "customer_account", "prospect"]).default("coach"),
  process: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_-]{1,80}$/)
    .default("default"),
  rules: z
    .object({
      channel: z.enum(["coach", "customer_account", "prospect"]).optional(),
      process: z
        .string()
        .trim()
        .regex(/^[a-zA-Z0-9_-]{1,80}$/)
        .optional(),
      scope: z
        .object({
          accountScoped: z.boolean().optional(),
          accountSearchAllowed: z.boolean().optional(),
          leadSearchAllowed: z.boolean().optional(),
          opportunitySearchAllowed: z.boolean().optional(),
          contactSearchAllowed: z.boolean().optional(),
          quotationSearchAllowed: z.boolean().optional(),
          requireContextForOperation: z.boolean().optional(),
          requireBusinessEvidence: z.boolean().optional(),
          requirePermissionValidation: z.boolean().optional(),
        })
        .partial()
        .optional(),
      filters: z
        .object({
          defaultOpenOnly: z.boolean().optional(),
          defaultActiveOnly: z.boolean().optional(),
          defaultInactiveOnly: z.boolean().optional(),
          defaultRequireEvidence: z.boolean().optional(),
        })
        .partial()
        .optional(),
      aliases: z
        .object({
          stage: z.record(z.string(), z.string()).optional(),
          opportunityStatus: z.record(z.string(), z.string()).optional(),
          inactivity: z.array(z.string().trim().min(1).max(80)).optional(),
        })
        .partial()
        .optional(),
      operationPolicy: z
        .object({
          allowedKinds: z
            .array(
              z.enum([
                "activity",
                "stage_answer",
                "lead_call_outcome",
                "account_field",
                "contact_field",
                "opportunity_field",
                "create_account",
                "create_contact",
                "create_opportunity",
              ]),
            )
            .optional(),
          sourceChannel: z
            .enum(["coach", "customer_account", "prospect"])
            .optional(),
        })
        .partial()
        .optional(),
      channelRules: z
        .object({
          scope: z.enum(["coach", "customer_account", "prospect"]).optional(),
          accountScoped: z.boolean().optional(),
          prospectScoped: z.boolean().optional(),
          crmRecordsConfirmedOnly: z.boolean().optional(),
          noSharedCoachSession: z.boolean().optional(),
        })
        .partial()
        .optional(),
      validation: z
        .object({
          requireEvidence: z.boolean().optional(),
          requireEntityResolution: z.boolean().optional(),
          requirePermissionValidation: z.boolean().optional(),
          allowAmbiguousEntitySelection: z.boolean().optional(),
        })
        .partial()
        .optional(),
    })
    .strict(),
});

const coachAdminRuleCreateSchema = z
  .object({
    scope: z.enum(["common", "channel"]),
    channel: z.enum(["coach", "customer_account", "prospect"]).optional(),
    process: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9_-]{1,80}$/)
      .default("default"),
    title: z.string().trim().min(1).max(180),
    instruction: z.string().trim().min(1).max(5000),
    enabled: z.boolean().default(true),
    sortOrder: z.number().int().min(-1000).max(1000).default(0),
  })
  .strict()
  .superRefine((rule, context) => {
    if (rule.scope === "channel" && !rule.channel) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["channel"],
        message: "Selecciona el chat para esta regla.",
      });
    }
  });

const coachAdminRuleUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(180),
    instruction: z.string().trim().min(1).max(5000),
    enabled: z.boolean(),
    sortOrder: z.number().int().min(-1000).max(1000),
  })
  .strict();

function sendRouteError(res, error, fallbackMessage) {
  const status = Number(error?.status || 500);
  return res.status(status).json({
    message: error?.message || fallbackMessage,
    ...(error?.requiredPermission
      ? { requiredPermission: error.requiredPermission }
      : {}),
  });
}

router.use(async (_req, res, next) => {
  try {
    await ensureCommercialIntelligencePermissions();
    await ensureCommercialIntelligenceSchema();
    next();
  } catch (error) {
    return res.status(500).json({
      message: "No fue posible preparar inteligencia comercial",
    });
  }
});

router.post(
  "/customer-research/jobs",
  requirePermission("mi_coach.use"),
  requirePermission("inteligencia_comercial.read"),
  async (req, res) => {
    try {
      const payload = jobCreateSchema.parse(req.body || {});
      const { job } = await createCustomerIntelligenceJob({
        user: req.user,
        payload,
      });
      setImmediate(() => {
        processCustomerIntelligenceJob({ jobId: job.id, user: req.user }).catch(
          () => undefined,
        );
      });
      return res.status(202).json({ job });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Payload invalido",
          issues: error.issues,
        });
      }
      return sendRouteError(
        res,
        error,
        "No fue posible crear la investigacion del cliente",
      );
    }
  },
);

router.post(
  "/account-internal-analysis/jobs",
  requirePermission("mi_coach.use"),
  requirePermission("inteligencia_comercial.read"),
  async (req, res) => {
    try {
      const payload = jobCreateSchema.parse(req.body || {});
      const { job } = await createAccountInternalAnalysisJob({
        user: req.user,
        payload,
      });
      setImmediate(() =>
        processAccountInternalAnalysisJob({
          jobId: job.id,
          user: req.user,
        }).catch(() => undefined),
      );
      return res.status(202).json({ job });
    } catch (error) {
      if (error instanceof z.ZodError)
        return res
          .status(400)
          .json({ message: "Payload invalido", issues: error.issues });
      return sendRouteError(res, error, "No fue posible analizar la cuenta");
    }
  },
);

router.get(
  "/account-internal-analysis/jobs/:jobId",
  requirePermission("mi_coach.use"),
  requirePermission("inteligencia_comercial.read"),
  async (req, res) => {
    const jobId = Number(req.params.jobId || 0);
    if (!Number.isInteger(jobId) || jobId <= 0)
      return res.status(400).json({ message: "Job invalido" });
    const job = await getCustomerIntelligenceJob({ user: req.user, jobId });
    if (!job || job.jobType !== "account_internal_analysis")
      return res
        .status(404)
        .json({ message: "Análisis de cuenta no encontrado" });
    return res.json({ job });
  },
);

router.get(
  "/customer-research/jobs/:jobId",
  requirePermission("mi_coach.use"),
  requirePermission("inteligencia_comercial.read"),
  async (req, res) => {
    const jobId = Number(req.params.jobId || 0);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      return res.status(400).json({ message: "Job invalido" });
    }
    const job = await getCustomerIntelligenceJob({ user: req.user, jobId });
    if (!job) {
      return res.status(404).json({ message: "Investigacion no encontrada" });
    }
    return res.json({ job });
  },
);

router.post(
  "/external-research/jobs",
  requirePermission("mi_coach.use"),
  requirePermission("inteligencia_comercial.read"),
  requirePermission("fuentes_externas.execute"),
  async (req, res) => {
    try {
      const payload = jobCreateSchema.parse(req.body || {});
      const { job } = await createCustomerExternalResearchJob({
        user: req.user,
        payload,
      });
      setImmediate(() => {
        processCustomerExternalResearchJob({
          jobId: job.id,
          user: req.user,
        }).catch(() => undefined);
      });
      return res.status(202).json({ job });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: "Payload invalido", issues: error.issues });
      }
      return sendRouteError(
        res,
        error,
        "No fue posible iniciar investigacion externa",
      );
    }
  },
);

router.get(
  "/external-research/jobs/:jobId",
  requirePermission("mi_coach.use"),
  requirePermission("inteligencia_comercial.read"),
  requirePermission("fuentes_externas.execute"),
  async (req, res) => {
    const jobId = Number(req.params.jobId || 0);
    if (!Number.isInteger(jobId) || jobId <= 0)
      return res.status(400).json({ message: "Job invalido" });
    const job = await getCustomerIntelligenceJob({ user: req.user, jobId });
    if (!job || job.jobType !== "external_research") {
      return res
        .status(404)
        .json({ message: "Investigacion externa no encontrada" });
    }
    return res.json({ job });
  },
);

router.post(
  "/commercial-discovery/jobs",
  requirePermission("mi_coach.use"),
  requirePermission("inteligencia_comercial.read"),
  async (req, res) => {
    try {
      const payload = jobCreateSchema.parse(req.body || {});
      const { job } = await createCommercialDiscoveryJob({
        user: req.user,
        payload,
      });
      setImmediate(() => {
        processCommercialDiscoveryJob({ jobId: job.id, user: req.user }).catch(
          () => undefined,
        );
      });
      return res.status(202).json({ job });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Payload invalido",
          issues: error.issues,
        });
      }
      return sendRouteError(
        res,
        error,
        "No fue posible preparar la llamada comercial",
      );
    }
  },
);

router.get(
  "/commercial-discovery/jobs/:jobId",
  requirePermission("mi_coach.use"),
  requirePermission("inteligencia_comercial.read"),
  async (req, res) => {
    const jobId = Number(req.params.jobId || 0);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      return res.status(400).json({ message: "Job invalido" });
    }
    const job = await getCustomerIntelligenceJob({ user: req.user, jobId });
    if (!job || job.jobType !== "commercial_discovery") {
      return res
        .status(404)
        .json({ message: "Preparacion comercial no encontrada" });
    }
    return res.json({ job });
  },
);

router.post(
  "/executive-briefing/jobs",
  requirePermission("mi_coach.use"),
  requirePermission("inteligencia_comercial.read"),
  async (req, res) => {
    try {
      const payload = jobCreateSchema.parse(req.body || {});
      const { job } = await createCustomerExecutiveBriefingJob({
        user: req.user,
        payload,
      });
      setImmediate(() =>
        processCustomerExecutiveBriefingJob({
          jobId: job.id,
          user: req.user,
        }).catch(() => undefined),
      );
      return res.status(202).json({ job });
    } catch (error) {
      if (error instanceof z.ZodError)
        return res
          .status(400)
          .json({ message: "Payload invalido", issues: error.issues });
      return sendRouteError(
        res,
        error,
        "No fue posible iniciar el resumen ejecutivo",
      );
    }
  },
);

router.get(
  "/executive-briefing/jobs/:jobId",
  requirePermission("mi_coach.use"),
  requirePermission("inteligencia_comercial.read"),
  async (req, res) => {
    const jobId = Number(req.params.jobId || 0);
    if (!Number.isInteger(jobId) || jobId <= 0)
      return res.status(400).json({ message: "Job invalido" });
    const job = await getCustomerIntelligenceJob({ user: req.user, jobId });
    if (!job || job.jobType !== "executive_briefing")
      return res
        .status(404)
        .json({ message: "Resumen ejecutivo no encontrado" });
    return res.json({ job });
  },
);

router.post(
  "/agents/jobs",
  requirePermission("mi_coach.use"),
  requirePermission("inteligencia_comercial.read"),
  async (req, res) => {
    try {
      const payload = jobCreateSchema.parse(req.body || {});
      const { job } = await createAccountIntelligenceAgentsJob({
        user: req.user,
        payload,
      });
      setImmediate(() =>
        processAccountIntelligenceAgentsJob({
          jobId: job.id,
          user: req.user,
        }).catch(() => undefined),
      );
      return res.status(202).json({ job });
    } catch (error) {
      if (error instanceof z.ZodError)
        return res
          .status(400)
          .json({ message: "Payload invalido", issues: error.issues });
      return sendRouteError(
        res,
        error,
        "No fue posible iniciar los agentes de Account Intelligence",
      );
    }
  },
);

router.get(
  "/agents/jobs/:jobId",
  requirePermission("mi_coach.use"),
  requirePermission("inteligencia_comercial.read"),
  async (req, res) => {
    const jobId = Number(req.params.jobId || 0);
    if (!Number.isInteger(jobId) || jobId <= 0)
      return res.status(400).json({ message: "Job invalido" });
    const job = await getCustomerIntelligenceJob({ user: req.user, jobId });
    if (!job || job.jobType !== "agent_orchestration")
      return res.status(404).json({ message: "Orquestación no encontrada" });
    return res.json({ job });
  },
);

router.get(
  "/agents/metrics",
  requirePermission("mi_coach.use"),
  requirePermission("inteligencia_comercial.read"),
  async (req, res) => {
    return res.json(await getAccountIntelligenceMetrics({ user: req.user }));
  },
);

router.post(
  "/account-chat/sessions",
  requirePermission("mi_coach.use"),
  requirePermission("inteligencia_comercial.read"),
  async (req, res) => {
    try {
      const payload = customerChatSessionSchema.parse(req.body || {});
      const { session } = await createCustomerAccountChatSession({
        user: req.user,
        payload,
      });
      return res.status(201).json({ session });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: "Payload invalido", issues: error.issues });
      }
      return sendRouteError(
        res,
        error,
        "No fue posible crear la sesion de chat",
      );
    }
  },
);

router.get(
  "/account-chat/sessions/:sessionId",
  requirePermission("mi_coach.use"),
  requirePermission("inteligencia_comercial.read"),
  async (req, res) => {
    const sessionId = Number(req.params.sessionId || 0);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      return res.status(400).json({ message: "Sesion invalida" });
    }
    const session = await getCustomerAccountChatSession({
      user: req.user,
      sessionId,
    });
    if (!session) {
      return res.status(404).json({ message: "Chat de cuenta no encontrado" });
    }
    return res.json({ session });
  },
);

router.post(
  "/account-chat/jobs",
  requirePermission("mi_coach.use"),
  requirePermission("inteligencia_comercial.read"),
  async (req, res) => {
    try {
      const parsed = jobCreateSchema
        .extend({
          question: z.string().trim().min(1).max(2000),
          includePublicResearch: z.boolean().optional().default(false),
          chatSessionId: z.number().int().positive().optional(),
        })
        .parse(req.body || {});
      const { job } = await createCustomerAccountChatJob({
        user: req.user,
        payload: parsed,
      });
      setImmediate(() =>
        processCustomerAccountChatJob({ jobId: job.id, user: req.user }).catch(
          () => undefined,
        ),
      );
      return res.status(202).json({ job });
    } catch (error) {
      if (error instanceof z.ZodError)
        return res
          .status(400)
          .json({ message: "Payload invalido", issues: error.issues });
      return sendRouteError(
        res,
        error,
        "No fue posible iniciar el chat de cuenta",
      );
    }
  },
);

router.get(
  "/account-chat/jobs/:jobId",
  requirePermission("mi_coach.use"),
  requirePermission("inteligencia_comercial.read"),
  async (req, res) => {
    const jobId = Number(req.params.jobId || 0);
    if (!Number.isInteger(jobId) || jobId <= 0)
      return res.status(400).json({ message: "Job invalido" });
    const job = await getCustomerIntelligenceJob({ user: req.user, jobId });
    if (!job || job.jobType !== "account_chat")
      return res.status(404).json({ message: "Chat de cuenta no encontrado" });
    return res.json({ job });
  },
);

router.post(
  "/findings/:findingId/apply-contact",
  requirePermission("mi_coach.use"),
  requirePermission("inteligencia_comercial.update"),
  async (req, res) => {
    try {
      const findingId = Number(req.params.findingId || 0);
      const result = await applyCustomerContactFinding({
        user: req.user,
        findingId,
        contactId: Number(req.body?.contactId || 0) || null,
        contactData: req.body?.contactData || {},
      });
      if (!result)
        return res.status(404).json({ message: "Hallazgo no encontrado" });
      await logAuditEvent({
        req,
        module: "commercial_intelligence",
        action: "customer_intelligence_contact_applied",
        entityType: "contact",
        entityId: result.contactId,
        detail: `Contacto ${result.mode} desde hallazgo público`,
        after: result,
      });
      return res.json(result);
    } catch (error) {
      return sendRouteError(res, error, "No fue posible aplicar el contacto");
    }
  },
);

router.get(
  "/findings",
  requirePermission("mi_coach.use"),
  requirePermission("inteligencia_comercial.read"),
  async (req, res) => {
    try {
      const filters = findingsQuerySchema.parse(req.query || {});
      const findings = await listCustomerIntelligenceFindings({
        user: req.user,
        filters,
      });
      return res.json({ findings });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Filtros invalidos",
          issues: error.issues,
        });
      }
      return sendRouteError(
        res,
        error,
        "No fue posible listar hallazgos de inteligencia comercial",
      );
    }
  },
);

router.get(
  "/account-intelligence/snapshot",
  requirePermission("mi_coach.use"),
  requirePermission("inteligencia_comercial.read"),
  async (req, res) => {
    try {
      const context = snapshotQuerySchema.parse(req.query || {});
      const snapshot = await buildAuthorizedCustomerSnapshot({
        user: req.user,
        ...context,
      });
      return res.json({ snapshot });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: "Contexto invalido", issues: error.issues });
      }
      return sendRouteError(
        res,
        error,
        "No fue posible cargar el snapshot de la cuenta",
      );
    }
  },
);

router.get(
  "/governance",
  requirePermission("mi_coach.admin"),
  async (_req, res) => {
    res.json(await getMiCoachGovernanceOverview());
  },
);

router.get(
  "/governance/business-rules",
  requirePermission("mi_coach.admin"),
  async (req, res) => {
    const parsed = z
      .object({
        channel: z
          .enum(["coach", "customer_account", "prospect"])
          .default("coach"),
        process: z
          .string()
          .trim()
          .regex(/^[a-zA-Z0-9_-]{1,80}$/)
          .default("default"),
      })
      .safeParse(req.query || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Ambito de reglas invalido",
        issues: parsed.error.issues,
      });
    }
    const { businessRules, configurationSource } =
      await loadCoachBusinessRulesWithSource(parsed.data);
    return res.json({ businessRules, configurationSource });
  },
);

router.put(
  "/governance/business-rules",
  requirePermission("mi_coach.admin"),
  async (req, res) => {
    const parsed = coachBusinessRulesSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Reglas de negocio invalidas",
        issues: parsed.error.issues,
      });
    }
    try {
      const businessRules = await saveCoachBusinessRules({
        user: req.user,
        ...parsed.data,
      });
      await logAuditEvent({
        req,
        module: "mi_coach",
        action: "mi_coach_business_rules_updated",
        entityType: "mi_coach_business_rules",
        entityId: null,
        detail: `Reglas de ${parsed.data.channel}/${parsed.data.process} actualizadas`,
        after: businessRules,
      });
      return res.json({
        businessRules,
        configurationSource: {
          sourceProcess: businessRules.process,
          hasSavedOverride: true,
          inheritedFromDefault: false,
        },
      });
    } catch (error) {
      return sendRouteError(
        res,
        error,
        "No fue posible guardar las reglas de negocio",
      );
    }
  },
);

router.delete(
  "/governance/business-rules",
  requirePermission("mi_coach.admin"),
  async (req, res) => {
    const parsed = z
      .object({
        channel: z
          .enum(["coach", "customer_account", "prospect"])
          .default("coach"),
        process: z
          .string()
          .trim()
          .regex(/^[a-zA-Z0-9_-]{1,80}$/)
          .default("default"),
      })
      .safeParse(req.query || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Ambito de reglas invalido",
        issues: parsed.error.issues,
      });
    }
    try {
      await resetCoachBusinessRules(parsed.data);
      const { businessRules, configurationSource } =
        await loadCoachBusinessRulesWithSource(parsed.data);
      await logAuditEvent({
        req,
        module: "mi_coach",
        action: "mi_coach_business_rules_reset",
        entityType: "mi_coach_business_rules",
        entityId: null,
        detail: `Reglas de ${parsed.data.channel}/${parsed.data.process} restablecidas`,
        after: businessRules,
      });
      return res.json({ businessRules, configurationSource });
    } catch (error) {
      return sendRouteError(
        res,
        error,
        "No fue posible restablecer las reglas",
      );
    }
  },
);

router.get(
  "/governance/rules",
  requirePermission("mi_coach.admin"),
  async (req, res) => {
    const parsed = z
      .object({
        channel: z
          .enum(["coach", "customer_account", "prospect", "all"])
          .default("coach"),
        process: z
          .string()
          .trim()
          .regex(/^[a-zA-Z0-9_-]{1,80}$/)
          .default("default"),
      })
      .safeParse(req.query || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Ambito de reglas invalido",
        issues: parsed.error.issues,
      });
    }
    const rules = await listCoachAdminRules(parsed.data);
    return res.json({ rules });
  },
);

router.post(
  "/governance/rules",
  requirePermission("mi_coach.admin"),
  async (req, res) => {
    const parsed = coachAdminRuleCreateSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Regla invalida",
        issues: parsed.error.issues,
      });
    }
    const rule = await createCoachAdminRule({
      user: req.user,
      rule: parsed.data,
    });
    await logAuditEvent({
      req,
      module: "mi_coach",
      action: "mi_coach_admin_rule_created",
      entityType: "mi_coach_admin_rule",
      entityId: null,
      detail: `Regla ${rule.id} creada: ${rule.scope}/${rule.channel || "all"}/${rule.process}`,
      after: rule,
    });
    return res.status(201).json({ rule });
  },
);

router.put(
  "/governance/rules/:ruleId",
  requirePermission("mi_coach.admin"),
  async (req, res) => {
    const parsed = coachAdminRuleUpdateSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Regla invalida",
        issues: parsed.error.issues,
      });
    }
    const before = await getCoachAdminRule(req.params.ruleId);
    const rule = await updateCoachAdminRule({
      user: req.user,
      id: req.params.ruleId,
      rule: parsed.data,
    });
    if (!rule) return res.status(404).json({ message: "Regla no encontrada" });
    await logAuditEvent({
      req,
      module: "mi_coach",
      action: "mi_coach_admin_rule_updated",
      entityType: "mi_coach_admin_rule",
      entityId: null,
      detail: `Regla ${rule.id} actualizada: ${rule.title}`,
      before,
      after: rule,
    });
    return res.json({ rule });
  },
);

router.delete(
  "/governance/rules/:ruleId",
  requirePermission("mi_coach.admin"),
  async (req, res) => {
    const rule = await deleteCoachAdminRule(req.params.ruleId);
    if (!rule) return res.status(404).json({ message: "Regla no encontrada" });
    await logAuditEvent({
      req,
      module: "mi_coach",
      action: "mi_coach_admin_rule_deleted",
      entityType: "mi_coach_admin_rule",
      entityId: null,
      detail: `Regla ${rule.id} eliminada: ${rule.title}`,
      before: rule,
    });
    return res.json({ rule });
  },
);

router.get(
  "/governance/intents",
  requirePermission("mi_coach.admin"),
  async (_req, res) => {
    return res.json({
      catalog: await listCoachIntentCatalog(),
      revisions: await listCoachIntentRevisions(),
    });
  },
);

router.get(
  "/governance/channel-intents/:channel",
  requirePermission("mi_coach.admin"),
  async (req, res) => {
    const channelResult = channelIntentChannelSchema.safeParse(
      req.params.channel,
    );
    if (!channelResult.success) {
      return res.status(400).json({ message: "Canal no configurable" });
    }
    const channel = channelResult.data;
    return res.json({
      channel,
      catalog: await loadChannelIntentConfigurations({ channel }),
      revisions: await listChannelIntentRevisions({ channel }),
    });
  },
);

router.put(
  "/governance/channel-intents/:channel/:intentCode",
  requirePermission("mi_coach.admin"),
  async (req, res) => {
    const channelResult = channelIntentChannelSchema.safeParse(
      req.params.channel,
    );
    const configResult = channelIntentConfigurationSchema.safeParse(
      req.body || {},
    );
    if (!channelResult.success || !configResult.success) {
      return res.status(400).json({
        message: "Configuración de enrutamiento inválida",
        issues: configResult.success ? [] : configResult.error.issues,
      });
    }
    const channel = channelResult.data;
    const beforeCatalog = await loadChannelIntentConfigurations({ channel });
    const before = beforeCatalog.find(
      (intent) => intent.code === req.params.intentCode,
    );
    if (!before) {
      return res.status(404).json({ message: "Intención no encontrada" });
    }
    try {
      const result = await updateChannelIntentConfiguration({
        user: req.user,
        channel,
        intentCode: req.params.intentCode,
        configuration: configResult.data,
      });
      if (!result) {
        return res.status(404).json({ message: "Intención no encontrada" });
      }
      const after = result.catalog.find(
        (intent) => intent.code === req.params.intentCode,
      );
      await logAuditEvent({
        req,
        module: "mi_coach",
        action: "mi_coach_channel_intent_updated",
        entityType: "channel_intent",
        entityId: `${channel}:${req.params.intentCode}`,
        detail: `Intención ${req.params.intentCode} actualizada para ${channel}`,
        before,
        after,
      });
      return res.json({ channel, ...result });
    } catch (error) {
      return sendRouteError(
        res,
        error,
        "No fue posible guardar la intención del canal",
      );
    }
  },
);

router.post(
  "/governance/channel-intents/preview",
  requirePermission("mi_coach.admin"),
  async (req, res) => {
    const parsed = channelIntentPreviewSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Pregunta de prueba inválida",
        issues: parsed.error.issues,
      });
    }
    return res.json(await previewChannelIntent(parsed.data));
  },
);

router.get(
  "/governance/channel-intents/:channel/revisions",
  requirePermission("mi_coach.admin"),
  async (req, res) => {
    const channelResult = channelIntentChannelSchema.safeParse(
      req.params.channel,
    );
    if (!channelResult.success) {
      return res.status(400).json({ message: "Canal no configurable" });
    }
    return res.json({
      revisions: await listChannelIntentRevisions({
        channel: channelResult.data,
      }),
    });
  },
);

router.post(
  "/governance/channel-intents/:channel/revisions/:revisionId/restore",
  requirePermission("mi_coach.admin"),
  async (req, res) => {
    const channelResult = channelIntentChannelSchema.safeParse(
      req.params.channel,
    );
    const revisionId = Number(req.params.revisionId);
    if (
      !channelResult.success ||
      !Number.isSafeInteger(revisionId) ||
      revisionId < 1
    ) {
      return res.status(400).json({ message: "Canal o revisión inválidos" });
    }
    try {
      const result = await restoreChannelIntentRevision({
        user: req.user,
        channel: channelResult.data,
        revisionId,
      });
      if (!result) {
        return res.status(404).json({ message: "Revisión no encontrada" });
      }
      await logAuditEvent({
        req,
        module: "mi_coach",
        action: "mi_coach_channel_intent_revision_restored",
        entityType: "channel_intent_revision",
        entityId: revisionId,
        detail: `Configuración de intenciones de ${channelResult.data} restaurada`,
        after: result.catalog,
      });
      return res.json({ channel: channelResult.data, ...result });
    } catch (error) {
      return sendRouteError(
        res,
        error,
        "No fue posible restaurar la configuración de intenciones",
      );
    }
  },
);

router.put(
  "/governance/intents/:intentCode/examples",
  requirePermission("mi_coach.admin"),
  async (req, res) => {
    const parsed = z
      .object({
        examples: z.array(z.string().trim().min(1).max(240)).min(1).max(30),
      })
      .safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Ejemplos de intención inválidos",
        issues: parsed.error.issues,
      });
    }
    const result = await updateCoachIntentExamples({
      user: req.user,
      intentCode: req.params.intentCode,
      examples: parsed.data.examples,
    });
    if (!result)
      return res.status(404).json({ message: "Intención no encontrada" });
    await logAuditEvent({
      req,
      module: "mi_coach",
      action: "mi_coach_intent_examples_updated",
      entityType: "mi_coach_intent",
      entityId: req.params.intentCode,
      detail: `Ejemplos de intención ${req.params.intentCode} actualizados`,
      before: result.before,
      after: result.after,
    });
    return res.json({ catalog: result.catalog });
  },
);

router.get(
  "/governance/intents/revisions",
  requirePermission("mi_coach.admin"),
  async (_req, res) => {
    return res.json({ revisions: await listCoachIntentRevisions(50) });
  },
);

router.post(
  "/governance/intents/revisions/:revisionId/restore",
  requirePermission("mi_coach.admin"),
  async (req, res) => {
    const revisionId = Number(req.params.revisionId);
    if (!Number.isSafeInteger(revisionId) || revisionId < 1) {
      return res.status(400).json({ message: "Revisión inválida" });
    }
    const result = await restoreCoachIntentRevision({
      user: req.user,
      revisionId,
    });
    if (!result)
      return res.status(404).json({ message: "Revisión no encontrada" });
    await logAuditEvent({
      req,
      module: "mi_coach",
      action: "mi_coach_intent_revision_restored",
      entityType: "mi_coach_intent_revision",
      entityId: revisionId,
      detail: `Configuración de intenciones restaurada desde revisión ${revisionId}`,
      before: result.before,
      after: result.after,
    });
    return res.json({
      catalog: result.catalog,
      revisions: await listCoachIntentRevisions(50),
    });
  },
);

router.put(
  "/governance/settings",
  requirePermission("mi_coach.admin"),
  async (req, res) => {
    const parsed = governanceSettingsSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Payload invalido", issues: parsed.error.issues });
    }
    const overview = await updateMiCoachGovernanceSettings({
      user: req.user,
      settings: parsed.data,
    });
    await logAuditEvent({
      req,
      module: "mi_coach",
      action: "mi_coach_governance_updated",
      entityType: "mi_coach_governance_settings",
      entityId: null,
      detail: "Configuracion de gobierno de Mi Coach actualizada",
      after: overview.settings,
    });
    return res.json(overview);
  },
);

async function updateFindingStatus(req, res, status) {
  const findingId = Number(req.params.findingId || 0);
  if (!Number.isInteger(findingId) || findingId <= 0) {
    return res.status(400).json({ message: "Hallazgo invalido" });
  }
  try {
    const finding = await updateCustomerIntelligenceFindingStatus({
      user: req.user,
      findingId,
      status,
    });
    if (!finding) {
      return res.status(404).json({ message: "Hallazgo no encontrado" });
    }
    await logAuditEvent({
      req,
      module: "commercial_intelligence",
      action: `customer_intelligence_finding_${status}`,
      entityType: "customer_intelligence_finding",
      entityId: finding.id,
      detail: `Hallazgo de inteligencia comercial marcado como ${status}`,
      after: finding,
    });
    return res.json({ finding });
  } catch (error) {
    return sendRouteError(
      res,
      error,
      "No fue posible actualizar el hallazgo de inteligencia comercial",
    );
  }
}

const applyFindingSchema = z.object({
  target: z.enum(["account", "contact", "opportunity"]),
  field: z.string().trim().min(1).max(60),
  value: z.string().trim().min(1).max(10000),
  mode: z.enum(["append", "replace"]).default("append"),
});

router.post(
  "/findings/:findingId/apply",
  requirePermission("mi_coach.use"),
  requirePermission("inteligencia_comercial.update"),
  async (req, res) => {
    const findingId = Number(req.params.findingId || 0);
    const parsed = applyFindingSchema.safeParse(req.body || {});
    if (!Number.isInteger(findingId) || findingId <= 0 || !parsed.success) {
      return res.status(400).json({
        message: "Aplicacion de hallazgo invalida",
        issues: parsed.success ? [] : parsed.error.issues,
      });
    }
    try {
      const result = await applyCustomerIntelligenceFinding({
        user: req.user,
        findingId,
        ...parsed.data,
      });
      if (!result)
        return res.status(404).json({ message: "Hallazgo no encontrado" });
      await logAuditEvent({
        req,
        module: "commercial_intelligence",
        action: "customer_intelligence_finding_applied",
        entityType: result.target,
        entityId: result.recordId,
        detail: `Hallazgo aplicado al campo ${result.field}`,
        after: result,
      });
      return res.json(result);
    } catch (error) {
      return sendRouteError(res, error, "No fue posible aplicar el hallazgo");
    }
  },
);

router.post(
  "/findings/:findingId/confirm",
  requirePermission("mi_coach.use"),
  requirePermission("inteligencia_comercial.update"),
  async (req, res) => updateFindingStatus(req, res, "confirmed"),
);

router.post(
  "/findings/:findingId/reject",
  requirePermission("mi_coach.use"),
  requirePermission("inteligencia_comercial.update"),
  async (req, res) => updateFindingStatus(req, res, "rejected"),
);

export default router;
