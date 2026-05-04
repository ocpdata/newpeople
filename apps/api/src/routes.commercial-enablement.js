import express from "express";
import { z } from "zod";
import { requirePermission } from "./auth.js";
import { logAuditEvent } from "./audit.js";
import { ensureCommercialEnablementPermissions } from "./commercial-enablement/permissions.js";
import { ensureCommercialEnablementSchema } from "./commercial-enablement/schema.js";
import {
  createCommercialEnablementResource,
  deleteCommercialEnablementAsset,
  ensureCommercialEnablementStarterData,
  getCommercialEnablementAssetStream,
  getCommercialEnablementDashboard,
  getCommercialEnablementResourceDetail,
  listCommercialEnablementResources,
  recordCommercialEnablementFeedback,
  updateCommercialEnablementResource,
  uploadCommercialEnablementAssets,
} from "./commercial-enablement/service.js";

const router = express.Router();

const stringArraySchema = z.array(z.string().trim().min(1).max(80)).default([]);

const resourceSchema = z.object({
  kind: z.string().trim().min(2).max(60),
  status: z.enum(["draft", "published", "obsolete"]),
  title: z.string().trim().min(3).max(190),
  summary: z.string().trim().max(4000).optional().default(""),
  bodyMarkdown: z.string().trim().max(40000).optional().default(""),
  solutionCodes: stringArraySchema.optional().default([]),
  industryTags: stringArraySchema.optional().default([]),
  stageCodes: stringArraySchema.optional().default([]),
  themeTags: stringArraySchema.optional().default([]),
  competitorTags: stringArraySchema.optional().default([]),
  personaTags: stringArraySchema.optional().default([]),
  needTags: stringArraySchema.optional().default([]),
  recommendedRoleTags: stringArraySchema.optional().default([]),
  validUntil: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  ownerUserId: z.number().int().positive().optional().nullable(),
  metadata: z.record(z.any()).optional().default({}),
});

const feedbackSchema = z.object({
  eventType: z.enum(["helpful", "not_helpful", "used"]),
  contextType: z.string().trim().max(40).optional().nullable(),
  contextEntityId: z.number().int().positive().optional().nullable(),
});

router.use(async (_req, _res, next) => {
  try {
    await ensureCommercialEnablementPermissions();
    await ensureCommercialEnablementSchema();
    await ensureCommercialEnablementStarterData();
    next();
  } catch (error) {
    next(error);
  }
});

router.get(
  "/dashboard",
  requirePermission("enablement_comercial.read"),
  async (_req, res) => {
    res.json(await getCommercialEnablementDashboard());
  },
);

router.get(
  "/resources",
  requirePermission("enablement_comercial.read"),
  async (_req, res) => {
    res.json(await listCommercialEnablementResources());
  },
);

router.post(
  "/resources",
  requirePermission("enablement_comercial.update"),
  async (req, res) => {
    const parsed = resourceSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const resource = await createCommercialEnablementResource({
      body: parsed.data,
      user: req.user,
    });
    await logAuditEvent({
      req,
      module: "enablement_comercial",
      action: "created",
      entityType: "commercial_enablement_resource",
      entityId: resource.id,
      detail: `Recurso creado: ${resource.title}`,
      after: resource,
    });
    return res.status(201).json(resource);
  },
);

router.put(
  "/resources/:resourcePublicId",
  requirePermission("enablement_comercial.update"),
  async (req, res) => {
    const parsed = resourceSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const before = await getCommercialEnablementResourceDetail(
      req.params.resourcePublicId,
    );
    if (!before) {
      return res.status(404).json({ message: "Recurso no encontrado" });
    }

    const resource = await updateCommercialEnablementResource({
      resourcePublicId: req.params.resourcePublicId,
      body: parsed.data,
      user: req.user,
    });
    await logAuditEvent({
      req,
      module: "enablement_comercial",
      action: "updated",
      entityType: "commercial_enablement_resource",
      entityId: resource.id,
      detail: `Recurso actualizado: ${resource.title}`,
      before,
      after: resource,
    });
    return res.json(resource);
  },
);

router.post(
  "/resources/:resourcePublicId/assets",
  requirePermission("enablement_comercial.update"),
  async (req, res) => {
    try {
      const resource = await uploadCommercialEnablementAssets({
        req,
        resourcePublicId: req.params.resourcePublicId,
        user: req.user,
      });
      await logAuditEvent({
        req,
        module: "enablement_comercial",
        action: "asset_uploaded",
        entityType: "commercial_enablement_resource",
        entityId: resource.id,
        detail: `Adjunto cargado en recurso ${resource.title}`,
        after: { assetCount: resource.assets.length },
      });
      return res.status(201).json(resource);
    } catch (error) {
      return res.status(error.status || 500).json({
        message:
          error.status && error.status < 500
            ? error.message
            : "No fue posible cargar el adjunto",
      });
    }
  },
);

router.delete(
  "/resources/:resourcePublicId/assets/:assetPublicId",
  requirePermission("enablement_comercial.update"),
  async (req, res) => {
    try {
      const resource = await deleteCommercialEnablementAsset({
        resourcePublicId: req.params.resourcePublicId,
        assetPublicId: req.params.assetPublicId,
      });
      return res.json(resource);
    } catch (error) {
      return res.status(error.status || 500).json({
        message:
          error.status && error.status < 500
            ? error.message
            : "No fue posible eliminar el adjunto",
      });
    }
  },
);

router.get(
  "/resources/:resourcePublicId/assets/:assetPublicId/content",
  requirePermission("enablement_comercial.read"),
  async (req, res) => {
    const asset = await getCommercialEnablementAssetStream({
      resourcePublicId: req.params.resourcePublicId,
      assetPublicId: req.params.assetPublicId,
    });
    if (!asset) {
      return res.status(404).json({ message: "Adjunto no encontrado" });
    }

    res.setHeader("Content-Type", asset.mimeType || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(asset.fileName)}"`,
    );
    asset.stream.pipe(res);
  },
);

router.post(
  "/resources/:resourcePublicId/feedback",
  requirePermission("enablement_comercial.read"),
  async (req, res) => {
    const parsed = feedbackSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const resource = await recordCommercialEnablementFeedback({
      resourcePublicId: req.params.resourcePublicId,
      eventType: parsed.data.eventType,
      user: req.user,
      contextType: parsed.data.contextType || null,
      contextEntityId: parsed.data.contextEntityId || null,
    });
    return res.json(resource);
  },
);

export default router;
