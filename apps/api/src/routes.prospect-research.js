import express from "express";
import { z } from "zod";
import { requirePermission } from "./auth.js";
import { logAuditEvent } from "./audit.js";
import { ensureProspectResearchPermissions } from "./prospect-research/permissions.js";
import { ensureProspectResearchSchema } from "./prospect-research/schema.js";
import {
  convertProspectContact,
  convertProspectHypothesisToOpportunity,
  convertProspectSessionToAccount,
  convertProspectSessionToLead,
  createProspectResearchSession,
  getProspectResearchSession,
  runProspectExternalResearchSession,
  runProspectResearchSession,
  updateProspectResearchFindingStatus,
} from "./prospect-research/service.js";

const router = express.Router();

const createSessionSchema = z.object({
  companyName: z.string().trim().min(2).max(190),
  country: z.string().trim().min(2).max(120),
  website: z.string().trim().max(500).optional().default(""),
  industry: z.string().trim().max(160).optional().default(""),
});

const convertContactSchema = z.object({
  accountId: z.number().int().positive().optional().nullable(),
  contactName: z.string().trim().max(190).optional().default(""),
  email: z.string().trim().max(190).optional().default(""),
});

const convertLeadSchema = z.object({
  accountId: z.number().int().positive().optional().nullable(),
});

const convertOpportunitySchema = z.object({
  accountId: z.number().int().positive().optional().nullable(),
  contactId: z.number().int().positive(),
  amountUsd: z.number().nonnegative().optional().default(0),
  closeDate: z.string().trim().max(20).optional().default(""),
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
    await ensureProspectResearchPermissions();
    await ensureProspectResearchSchema();
    next();
  } catch {
    return res.status(500).json({
      message: "No fue posible preparar prospeccion asistida",
    });
  }
});

router.post(
  "/sessions",
  requirePermission("mi_coach.use"),
  requirePermission("prospeccion.create"),
  async (req, res) => {
    try {
      const payload = createSessionSchema.parse(req.body || {});
      const session = await createProspectResearchSession({
        user: req.user,
        payload,
      });
      return res.status(201).json({ session });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Payload invalido",
          issues: error.issues,
        });
      }
      return sendRouteError(res, error, "No fue posible crear la prospeccion");
    }
  },
);

router.get(
  "/sessions/:sessionId",
  requirePermission("mi_coach.use"),
  requirePermission("prospeccion.read"),
  async (req, res) => {
    const sessionId = Number(req.params.sessionId || 0);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      return res.status(400).json({ message: "Sesion invalida" });
    }
    const session = await getProspectResearchSession({
      user: req.user,
      sessionId,
    });
    if (!session) {
      return res.status(404).json({ message: "Prospeccion no encontrada" });
    }
    return res.json({ session });
  },
);

router.post(
  "/sessions/:sessionId/run",
  requirePermission("mi_coach.use"),
  requirePermission("prospeccion.create"),
  async (req, res) => {
    const sessionId = Number(req.params.sessionId || 0);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      return res.status(400).json({ message: "Sesion invalida" });
    }
    const session = await runProspectResearchSession({
      user: req.user,
      sessionId,
    });
    if (!session) {
      return res.status(404).json({ message: "Prospeccion no encontrada" });
    }
    return res.json({ session });
  },
);

router.post(
  "/sessions/:sessionId/run-external",
  requirePermission("mi_coach.use"),
  requirePermission("prospeccion.create"),
  requirePermission("fuentes_externas.execute"),
  async (req, res) => {
    const sessionId = Number(req.params.sessionId || 0);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      return res.status(400).json({ message: "Sesion invalida" });
    }
    try {
      const session = await runProspectExternalResearchSession({
        user: req.user,
        sessionId,
      });
      if (!session) {
        return res.status(404).json({ message: "Prospeccion no encontrada" });
      }
      return res.json({ session });
    } catch (error) {
      return sendRouteError(res, error, "No fue posible ejecutar investigacion externa");
    }
  },
);

router.post(
  "/sessions/:sessionId/convert-to-account",
  requirePermission("mi_coach.use"),
  requirePermission("prospeccion.update"),
  async (req, res) => {
    const sessionId = Number(req.params.sessionId || 0);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      return res.status(400).json({ message: "Sesion invalida" });
    }
    try {
      const result = await convertProspectSessionToAccount({
        user: req.user,
        sessionId,
      });
      if (!result) return res.status(404).json({ message: "Prospeccion no encontrada" });
      await logAuditEvent({
        req,
        module: "prospect_research",
        action: "prospect_research_converted_to_account",
        entityType: "account",
        entityId: result.accountId,
        detail: "Prospeccion convertida a cuenta",
        after: result,
      });
      return res.status(result.reused ? 200 : 201).json(result);
    } catch (error) {
      return sendRouteError(res, error, "No fue posible convertir la prospeccion a cuenta");
    }
  },
);

router.post(
  "/sessions/:sessionId/convert-to-lead",
  requirePermission("mi_coach.use"),
  requirePermission("prospeccion.update"),
  async (req, res) => {
    const sessionId = Number(req.params.sessionId || 0);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      return res.status(400).json({ message: "Sesion invalida" });
    }
    try {
      const payload = convertLeadSchema.parse(req.body || {});
      const result = await convertProspectSessionToLead({
        user: req.user,
        sessionId,
        accountId: payload.accountId,
      });
      if (!result) return res.status(404).json({ message: "Prospeccion no encontrada" });
      await logAuditEvent({
        req,
        module: "prospect_research",
        action: "prospect_research_converted_to_lead",
        entityType: "interaction",
        entityId: result.interactionId,
        detail: "Prospeccion convertida a lead",
        after: result,
      });
      return res.status(201).json(result);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Payload invalido", issues: error.issues });
      return sendRouteError(res, error, "No fue posible convertir la prospeccion a lead");
    }
  },
);

router.post(
  "/contacts/:contactId/convert",
  requirePermission("mi_coach.use"),
  requirePermission("prospeccion.update"),
  async (req, res) => {
    const contactId = Number(req.params.contactId || 0);
    if (!Number.isInteger(contactId) || contactId <= 0) {
      return res.status(400).json({ message: "Contacto sugerido invalido" });
    }
    try {
      const payload = convertContactSchema.parse(req.body || {});
      const result = await convertProspectContact({
        user: req.user,
        contactId,
        accountId: payload.accountId,
        contactName: payload.contactName,
        email: payload.email,
      });
      if (!result) return res.status(404).json({ message: "Contacto sugerido no encontrado" });
      await logAuditEvent({
        req,
        module: "prospect_research",
        action: "prospect_research_contact_converted",
        entityType: "contact",
        entityId: result.contactId,
        detail: "Contacto sugerido convertido a contacto CRM",
        after: result,
      });
      return res.status(201).json(result);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Payload invalido", issues: error.issues });
      return sendRouteError(res, error, "No fue posible convertir el contacto sugerido");
    }
  },
);

router.post(
  "/hypotheses/:hypothesisId/convert-to-opportunity",
  requirePermission("mi_coach.use"),
  requirePermission("prospeccion.update"),
  async (req, res) => {
    const hypothesisId = Number(req.params.hypothesisId || 0);
    if (!Number.isInteger(hypothesisId) || hypothesisId <= 0) {
      return res.status(400).json({ message: "Hipotesis invalida" });
    }
    try {
      const payload = convertOpportunitySchema.parse(req.body || {});
      const result = await convertProspectHypothesisToOpportunity({
        user: req.user,
        hypothesisId,
        accountId: payload.accountId,
        contactId: payload.contactId,
        amountUsd: payload.amountUsd,
        closeDate: payload.closeDate,
      });
      if (!result) return res.status(404).json({ message: "Hipotesis no encontrada" });
      await logAuditEvent({
        req,
        module: "prospect_research",
        action: "prospect_research_hypothesis_converted",
        entityType: "opportunity",
        entityId: result.opportunityId,
        detail: "Hipotesis de prospeccion convertida a oportunidad",
        after: result,
      });
      return res.status(201).json(result);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Payload invalido", issues: error.issues });
      return sendRouteError(res, error, "No fue posible convertir la hipotesis a oportunidad");
    }
  },
);

async function updateFindingStatus(req, res, status) {
  const findingId = Number(req.params.findingId || 0);
  if (!Number.isInteger(findingId) || findingId <= 0) {
    return res.status(400).json({ message: "Hallazgo invalido" });
  }
  try {
    const finding = await updateProspectResearchFindingStatus({
      user: req.user,
      findingId,
      status,
    });
    if (!finding) {
      return res.status(404).json({ message: "Hallazgo no encontrado" });
    }
    await logAuditEvent({
      req,
      module: "prospect_research",
      action: `prospect_research_finding_${status}`,
      entityType: "prospect_research_finding",
      entityId: finding.id,
      detail: `Hallazgo de prospeccion marcado como ${status}`,
      after: finding,
    });
    return res.json({ finding });
  } catch (error) {
    return sendRouteError(
      res,
      error,
      "No fue posible actualizar el hallazgo de prospeccion",
    );
  }
}

router.post(
  "/findings/:findingId/confirm",
  requirePermission("mi_coach.use"),
  requirePermission("prospeccion.update"),
  async (req, res) => updateFindingStatus(req, res, "confirmed"),
);

router.post(
  "/findings/:findingId/reject",
  requirePermission("mi_coach.use"),
  requirePermission("prospeccion.update"),
  async (req, res) => updateFindingStatus(req, res, "rejected"),
);

export default router;
