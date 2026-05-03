import express from "express";
import { z } from "zod";
import { requireAnyPermission, requirePermission } from "./auth.js";
import { logAuditEvent } from "./audit.js";
import { ensureInteractionSchema } from "./interactions/schema.js";
import { ensurePotentialOpportunityPermissions } from "./potential-opportunities/permissions.js";
import { ensurePotentialOpportunitySchema } from "./potential-opportunities/schema.js";
import {
  convertPotentialOpportunityCase,
  getPotentialOpportunityAssignmentOptions,
  getPotentialOpportunityAnalytics,
  getPotentialOpportunityCaseDetail,
  getPotentialOpportunitySummary,
  listPotentialOpportunityCases,
  runPotentialOpportunityDetection,
  transitionPotentialOpportunityCase,
} from "./potential-opportunities/service.js";

const router = express.Router();

const readPermissions = [
  "oportunidades_potenciales.read",
  "oportunidades_potenciales.read_all",
];
const reviewPermissions = ["oportunidades_potenciales.review"];
const assignPermissions = ["oportunidades_potenciales.assign"];
const convertPermissions = ["oportunidades_potenciales.convert"];

const runDetectionSchema = z.object({
  sourceEntityIds: z.array(z.number().int().positive()).optional().default([]),
  forceRebuild: z.boolean().optional().default(false),
});

const assignOwnerSchema = z.object({
  ownerUserId: z.number().int().positive().nullable(),
});

const postponeSchema = z.object({
  postponedUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reasonCode: z.string().trim().min(1).max(64),
  reasonNote: z.string().trim().max(500).optional().nullable(),
});

const dismissSchema = z.object({
  reasonCode: z.string().trim().min(1).max(64),
  reasonNote: z.string().trim().max(500).optional().nullable(),
});

const convertSchema = z.object({
  name: z.string().trim().min(2).max(180),
  amountUsd: z.number().nonnegative().optional().default(0),
  closeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  primaryContactId: z.number().int().positive().optional().nullable(),
  ownerUserId: z.number().int().positive().optional().nullable(),
  presalesUserId: z.number().int().positive().optional().nullable(),
  businessLineId: z.number().int().positive().optional().nullable(),
});

router.use(async (_req, _res, next) => {
  try {
    await ensureInteractionSchema();
    await ensurePotentialOpportunityPermissions();
    await ensurePotentialOpportunitySchema();
    next();
  } catch (error) {
    next(error);
  }
});

router.get(
  "/summary",
  requireAnyPermission(readPermissions),
  async (req, res) => {
    const summary = await getPotentialOpportunitySummary({
      user: req.user,
      filters: req.query || {},
    });
    res.json(summary);
  },
);

router.get(
  "/analytics/dashboard",
  requirePermission("oportunidades_potenciales.analytics"),
  async (req, res) => {
    const result = await getPotentialOpportunityAnalytics({ user: req.user });
    res.json(result);
  },
);

router.post(
  "/run-detection",
  requirePermission("oportunidades_potenciales.review"),
  async (req, res) => {
    const parsed = runDetectionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const result = await runPotentialOpportunityDetection({
      user: req.user,
      interactionIds: parsed.data.sourceEntityIds,
      forceRebuild: parsed.data.forceRebuild,
    });
    await logAuditEvent({
      req,
      module: "oportunidades_potenciales",
      action: "run_detection",
      entityType: "potential_opportunity_detection",
      detail: "Ejecucion manual de deteccion de oportunidades potenciales",
      after: result,
    });
    res.json(result);
  },
);

router.get("/", requireAnyPermission(readPermissions), async (req, res) => {
  const result = await listPotentialOpportunityCases({
    user: req.user,
    filters: req.query || {},
  });
  res.json(result);
});

router.get(
  "/:caseId/assignment-options",
  requirePermission("oportunidades_potenciales.assign"),
  async (req, res) => {
    const result = await getPotentialOpportunityAssignmentOptions({
      user: req.user,
      caseId: req.params.caseId,
    });
    if (!result) {
      return res.status(404).json({ message: "Caso no encontrado" });
    }
    res.json(result);
  },
);

router.get(
  "/:caseId",
  requireAnyPermission(readPermissions),
  async (req, res) => {
    const detail = await getPotentialOpportunityCaseDetail({
      user: req.user,
      caseId: req.params.caseId,
    });
    if (!detail) {
      return res.status(404).json({ message: "Caso no encontrado" });
    }
    res.json(detail);
  },
);

router.post(
  "/:caseId/start-review",
  requirePermission("oportunidades_potenciales.review"),
  async (req, res) => {
    const updatedId = await transitionPotentialOpportunityCase({
      user: req.user,
      caseId: req.params.caseId,
      toState: "in_review",
      reasonCode: "manual_review",
      reasonNote: "Inicio de revision comercial",
    });
    if (!updatedId) {
      return res.status(404).json({ message: "Caso no encontrado" });
    }
    res.json({ ok: true, caseId: updatedId });
  },
);

router.post(
  "/:caseId/accept",
  requirePermission("oportunidades_potenciales.review"),
  async (req, res) => {
    const updatedId = await transitionPotentialOpportunityCase({
      user: req.user,
      caseId: req.params.caseId,
      toState: "accepted",
      reasonCode: "accepted",
      reasonNote: "Caso aceptado para trabajo comercial",
    });
    if (!updatedId) {
      return res.status(404).json({ message: "Caso no encontrado" });
    }
    res.json({ ok: true, caseId: updatedId });
  },
);

router.post(
  "/:caseId/assign-owner",
  requirePermission("oportunidades_potenciales.assign"),
  async (req, res) => {
    const parsed = assignOwnerSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const updatedId = await transitionPotentialOpportunityCase({
      user: req.user,
      caseId: req.params.caseId,
      toState: "accepted",
      reasonCode: "owner_assigned",
      reasonNote: "Owner asignado al caso",
      ownerUserId: parsed.data.ownerUserId,
    });
    if (!updatedId) {
      return res.status(404).json({ message: "Caso no encontrado" });
    }
    res.json({ ok: true, caseId: updatedId });
  },
);

router.post(
  "/:caseId/postpone",
  requirePermission("oportunidades_potenciales.review"),
  async (req, res) => {
    const parsed = postponeSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const updatedId = await transitionPotentialOpportunityCase({
      user: req.user,
      caseId: req.params.caseId,
      toState: "postponed",
      reasonCode: parsed.data.reasonCode,
      reasonNote: parsed.data.reasonNote,
      postponedUntil: parsed.data.postponedUntil,
    });
    if (!updatedId) {
      return res.status(404).json({ message: "Caso no encontrado" });
    }
    res.json({ ok: true, caseId: updatedId });
  },
);

router.post(
  "/:caseId/dismiss",
  requirePermission("oportunidades_potenciales.review"),
  async (req, res) => {
    const parsed = dismissSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const updatedId = await transitionPotentialOpportunityCase({
      user: req.user,
      caseId: req.params.caseId,
      toState: "dismissed",
      reasonCode: parsed.data.reasonCode,
      reasonNote: parsed.data.reasonNote,
    });
    if (!updatedId) {
      return res.status(404).json({ message: "Caso no encontrado" });
    }
    res.json({ ok: true, caseId: updatedId });
  },
);

router.post(
  "/:caseId/convert",
  requireAnyPermission(convertPermissions),
  async (req, res) => {
    const parsed = convertSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    try {
      const opportunityId = await convertPotentialOpportunityCase({
        user: req.user,
        caseId: req.params.caseId,
        payload: parsed.data,
      });
      if (!opportunityId) {
        return res.status(404).json({ message: "Caso no encontrado" });
      }
      res.status(201).json({ ok: true, opportunityId });
    } catch (error) {
      if (error?.status) {
        return res.status(error.status).json({ message: error.message });
      }
      throw error;
    }
  },
);

export default router;
