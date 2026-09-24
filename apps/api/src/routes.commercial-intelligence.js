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
  getNextAutomaticCustomerBriefing,
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
  createCustomerAccountChatJob,
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
  status: z
    .enum(["suggested", "confirmed", "rejected", "outdated"])
    .optional(),
});

const snapshotQuerySchema = z.object({
  accountId: z.coerce.number().int().positive().optional().nullable(),
  opportunityId: z.coerce.number().int().positive().optional().nullable(),
  contactId: z.coerce.number().int().positive().optional().nullable(),
});

const governanceSettingsSchema = z.object({
  externalSourcesEnabled: z.boolean().optional(),
  dailyResearchLimitPerUser: z.number().int().min(1).max(500).optional(),
  findingRetentionDays: z.number().int().min(30).max(3650).optional(),
  requireEvidenceForExternalFindings: z.boolean().optional(),
  allowProspectConversion: z.boolean().optional(),
  notes: z.string().trim().max(1000).optional(),
});

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

router.post("/account-internal-analysis/jobs", requirePermission("mi_coach.use"), requirePermission("inteligencia_comercial.read"), async (req, res) => {
  try {
    const payload = jobCreateSchema.parse(req.body || {});
    const { job } = await createAccountInternalAnalysisJob({ user: req.user, payload });
    setImmediate(() => processAccountInternalAnalysisJob({ jobId: job.id, user: req.user }).catch(() => undefined));
    return res.status(202).json({ job });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ message: "Payload invalido", issues: error.issues });
    return sendRouteError(res, error, "No fue posible analizar la cuenta");
  }
});

router.get("/account-internal-analysis/jobs/:jobId", requirePermission("mi_coach.use"), requirePermission("inteligencia_comercial.read"), async (req, res) => {
  const jobId = Number(req.params.jobId || 0);
  if (!Number.isInteger(jobId) || jobId <= 0) return res.status(400).json({ message: "Job invalido" });
  const job = await getCustomerIntelligenceJob({ user: req.user, jobId });
  if (!job || job.jobType !== "account_internal_analysis") return res.status(404).json({ message: "Análisis de cuenta no encontrado" });
  return res.json({ job });
});

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
        processCustomerExternalResearchJob({ jobId: job.id, user: req.user }).catch(
          () => undefined,
        );
      });
      return res.status(202).json({ job });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Payload invalido", issues: error.issues });
      }
      return sendRouteError(res, error, "No fue posible iniciar investigacion externa");
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
    if (!Number.isInteger(jobId) || jobId <= 0) return res.status(400).json({ message: "Job invalido" });
    const job = await getCustomerIntelligenceJob({ user: req.user, jobId });
    if (!job || job.jobType !== "external_research") {
      return res.status(404).json({ message: "Investigacion externa no encontrada" });
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
      return res.status(404).json({ message: "Preparacion comercial no encontrada" });
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
      const { job } = await createCustomerExecutiveBriefingJob({ user: req.user, payload });
      setImmediate(() => processCustomerExecutiveBriefingJob({ jobId: job.id, user: req.user }).catch(() => undefined));
      return res.status(202).json({ job });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Payload invalido", issues: error.issues });
      return sendRouteError(res, error, "No fue posible iniciar el resumen ejecutivo");
    }
  },
);

router.get(
  "/executive-briefing/jobs/:jobId",
  requirePermission("mi_coach.use"),
  requirePermission("inteligencia_comercial.read"),
  async (req, res) => {
    const jobId = Number(req.params.jobId || 0);
    if (!Number.isInteger(jobId) || jobId <= 0) return res.status(400).json({ message: "Job invalido" });
    const job = await getCustomerIntelligenceJob({ user: req.user, jobId });
    if (!job || job.jobType !== "executive_briefing") return res.status(404).json({ message: "Resumen ejecutivo no encontrado" });
    return res.json({ job });
  },
);

router.post("/agents/jobs", requirePermission("mi_coach.use"), requirePermission("inteligencia_comercial.read"), async (req, res) => {
  try {
    const payload = jobCreateSchema.parse(req.body || {});
    const { job } = await createAccountIntelligenceAgentsJob({ user: req.user, payload });
    setImmediate(() => processAccountIntelligenceAgentsJob({ jobId: job.id, user: req.user }).catch(() => undefined));
    return res.status(202).json({ job });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ message: "Payload invalido", issues: error.issues });
    return sendRouteError(res, error, "No fue posible iniciar los agentes de Account Intelligence");
  }
});

router.get("/agents/jobs/:jobId", requirePermission("mi_coach.use"), requirePermission("inteligencia_comercial.read"), async (req, res) => {
  const jobId = Number(req.params.jobId || 0);
  if (!Number.isInteger(jobId) || jobId <= 0) return res.status(400).json({ message: "Job invalido" });
  const job = await getCustomerIntelligenceJob({ user: req.user, jobId });
  if (!job || job.jobType !== "agent_orchestration") return res.status(404).json({ message: "Orquestación no encontrada" });
  return res.json({ job });
});

router.get("/agents/metrics", requirePermission("mi_coach.use"), requirePermission("inteligencia_comercial.read"), async (req, res) => {
  return res.json(await getAccountIntelligenceMetrics({ user: req.user }));
});

router.post("/account-chat/jobs", requirePermission("mi_coach.use"), requirePermission("inteligencia_comercial.read"), async (req, res) => {
  try {
    const parsed = jobCreateSchema.extend({ question: z.string().trim().min(1).max(2000), includePublicResearch: z.boolean().optional().default(false) }).parse(req.body || {});
    const { job } = await createCustomerAccountChatJob({ user: req.user, payload: parsed });
    setImmediate(() => processCustomerAccountChatJob({ jobId: job.id, user: req.user }).catch(() => undefined));
    return res.status(202).json({ job });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ message: "Payload invalido", issues: error.issues });
    return sendRouteError(res, error, "No fue posible iniciar el chat de cuenta");
  }
});

router.get("/account-chat/jobs/:jobId", requirePermission("mi_coach.use"), requirePermission("inteligencia_comercial.read"), async (req, res) => {
  const jobId = Number(req.params.jobId || 0);
  if (!Number.isInteger(jobId) || jobId <= 0) return res.status(400).json({ message: "Job invalido" });
  const job = await getCustomerIntelligenceJob({ user: req.user, jobId });
  if (!job || job.jobType !== "account_chat") return res.status(404).json({ message: "Chat de cuenta no encontrado" });
  return res.json({ job });
});

router.post("/findings/:findingId/apply-contact", requirePermission("mi_coach.use"), requirePermission("inteligencia_comercial.update"), async (req, res) => {
  try {
    const findingId = Number(req.params.findingId || 0);
    const result = await applyCustomerContactFinding({ user: req.user, findingId, contactId: Number(req.body?.contactId || 0) || null, contactData: req.body?.contactData || {} });
    if (!result) return res.status(404).json({ message: "Hallazgo no encontrado" });
    await logAuditEvent({ req, module: "commercial_intelligence", action: "customer_intelligence_contact_applied", entityType: "contact", entityId: result.contactId, detail: `Contacto ${result.mode} desde hallazgo público`, after: result });
    return res.json(result);
  } catch (error) {
    return sendRouteError(res, error, "No fue posible aplicar el contacto");
  }
});

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
        return res.status(400).json({ message: "Contexto invalido", issues: error.issues });
      }
      return sendRouteError(res, error, "No fue posible cargar el snapshot de la cuenta");
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

router.put(
  "/governance/settings",
  requirePermission("mi_coach.admin"),
  async (req, res) => {
    const parsed = governanceSettingsSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Payload invalido", issues: parsed.error.issues });
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

router.get(
  "/automatic-briefing/next",
  requirePermission("mi_coach.use"),
  requirePermission("inteligencia_comercial.read"),
  async (req, res) => {
    try {
      const briefing = await getNextAutomaticCustomerBriefing({ user: req.user });
      return res.json(briefing);
    } catch (error) {
      return sendRouteError(
        res,
        error,
        "No fue posible preparar el briefing automatico",
      );
    }
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
      return res.status(400).json({ message: "Aplicacion de hallazgo invalida", issues: parsed.success ? [] : parsed.error.issues });
    }
    try {
      const result = await applyCustomerIntelligenceFinding({
        user: req.user,
        findingId,
        ...parsed.data,
      });
      if (!result) return res.status(404).json({ message: "Hallazgo no encontrado" });
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
