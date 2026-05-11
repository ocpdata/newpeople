import express from "express";
import { z } from "zod";
import { requireAnyPermission } from "./auth.js";
import { logAuditEvent } from "./audit.js";
import { ensureCommercialEnablementPermissions } from "./commercial-enablement/permissions.js";
import { ensureCommercialEnablementSchema } from "./commercial-enablement/schema.js";
import {
  addCommercialEnablementCollectionItem,
  addCommercialEnablementFavorite,
  archiveCommercialEnablementAsset,
  buildCommercialEnablementCollectionSharePackage,
  createCommercialEnablementAsset,
  createCommercialEnablementCatalogEntry,
  deleteCommercialEnablementCatalogEntry,
  deleteCommercialEnablementAsset,
  createCommercialEnablementCollection,
  createCommercialEnablementLink,
  createCommercialEnablementRelation,
  ensureCommercialEnablementStarterData,
  getCommercialEnablementAnalyticsOverview,
  getCommercialEnablementAssetDetail,
  getCommercialEnablementBootstrap,
  getCommercialEnablementCatalogs,
  getCommercialEnablementCollection,
  getCommercialEnablementDashboard,
  getCommercialEnablementFileStream,
  getCommercialEnablementGovernanceOverview,
  listCommercialEnablementAssets,
  listCommercialEnablementCollections,
  listCommercialEnablementFavorites,
  listCommercialEnablementRecent,
  obsoleteCommercialEnablementAsset,
  openCommercialEnablementLink,
  publishCommercialEnablementAsset,
  recordCommercialEnablementUsageEvent,
  removeCommercialEnablementCollectionItem,
  removeCommercialEnablementFavorite,
  updateCommercialEnablementAsset,
  updateCommercialEnablementCatalogEntry,
  updateCommercialEnablementLink,
  uploadCommercialEnablementFiles,
  validateCommercialEnablementAsset,
  validateCommercialEnablementAssetPayload,
  deleteCommercialEnablementFile,
  deleteCommercialEnablementLink,
  deleteCommercialEnablementRelation,
  duplicateCommercialEnablementAsset,
} from "./commercial-enablement/service.js";

const router = express.Router();

const READ_PERMISSIONS = [
  "enablement_comercial.use",
  "enablement_comercial.upload",
  "enablement_comercial.manage",
  "enablement_comercial.admin",
  "enablement_comercial.read",
  "enablement_comercial.update",
  "enablement_comercial.analytics",
];
const UPLOAD_PERMISSIONS = [
  "enablement_comercial.upload",
  "enablement_comercial.manage",
  "enablement_comercial.admin",
  "enablement_comercial.update",
];
const MANAGE_PERMISSIONS = [
  "enablement_comercial.manage",
  "enablement_comercial.admin",
];
const ADMIN_PERMISSIONS = ["enablement_comercial.admin"];

const stringArraySchema = z
  .array(z.string().trim().min(1).max(120))
  .default([]);

const assetSchema = z.object({
  title: z.string().trim().min(3).max(190),
  summary: z.string().trim().max(4000).optional().default(""),
  internalDescription: z.string().trim().max(40000).optional().default(""),
  assetTypeCode: z.string().trim().min(2).max(80),
  status: z
    .enum(["draft", "published", "obsolete", "archived"])
    .default("draft"),
  sourceType: z.enum(["file", "url", "mixed"]).default("mixed"),
  visibilityLevel: z.enum([
    "client_safe",
    "internal_sales",
    "internal_company",
    "restricted",
  ]),
  audienceCode: z.string().trim().min(2).max(60),
  languageCode: z.string().trim().min(2).max(20).default("es"),
  manufacturerCodes: stringArraySchema.optional().default([]),
  solutionCodes: stringArraySchema.optional().default([]),
  needCodes: stringArraySchema.optional().default([]),
  requirementCodes: stringArraySchema.optional().default([]),
  competitorCodes: stringArraySchema.optional().default([]),
  industryCodes: stringArraySchema.optional().default([]),
  stageCodes: stringArraySchema.optional().default([]),
  themeTags: stringArraySchema.optional().default([]),
  personaTags: stringArraySchema.optional().default([]),
  recommendedRoleTags: stringArraySchema.optional().default([]),
  isInternal: z.boolean().optional().default(false),
  isDownloadable: z.boolean().optional().default(true),
  isFeatured: z.boolean().optional().default(false),
  ownerUserId: z.number().int().positive().optional().nullable(),
});

const usageEventSchema = z.object({
  eventType: z.enum([
    "viewed",
    "downloaded",
    "opened_link",
    "copied_link",
    "favorited",
    "added_to_collection",
    "shared",
  ]),
  contextType: z.string().trim().max(40).optional().nullable(),
  contextEntityId: z.number().int().positive().optional().nullable(),
  metadata: z.record(z.any()).optional().nullable(),
});

const linkSchema = z.object({
  url: z.string().trim().url(),
  linkType: z.string().trim().max(40).optional().default("external"),
  label: z.string().trim().max(190).optional().default(""),
  description: z.string().trim().max(4000).optional().default(""),
  isPrimary: z.boolean().optional().default(false),
});

const collectionSchema = z.object({
  name: z.string().trim().min(3).max(190),
  description: z.string().trim().max(4000).optional().default(""),
});

const relationSchema = z.object({
  relatedAssetPublicId: z.string().trim().min(4).max(80),
  relationType: z.string().trim().min(3).max(60),
});

const catalogEntrySchema = z.object({
  code: z.string().trim().max(100).optional().default(""),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(4000).optional().default(""),
  sortOrder: z.number().int().min(0).optional().default(0),
  isActive: z.boolean().optional().default(true),
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
  "/bootstrap",
  requireAnyPermission(READ_PERMISSIONS),
  async (req, res) => {
    res.json(await getCommercialEnablementBootstrap({ user: req.user }));
  },
);

router.get(
  "/dashboard",
  requireAnyPermission(READ_PERMISSIONS),
  async (req, res) => {
    res.json(await getCommercialEnablementDashboard({ user: req.user }));
  },
);

router.get(
  "/catalogs",
  requireAnyPermission(READ_PERMISSIONS),
  async (_req, res) => {
    res.json(await getCommercialEnablementCatalogs());
  },
);

router.get(
  "/assets",
  requireAnyPermission(READ_PERMISSIONS),
  async (req, res) => {
    res.json(
      await listCommercialEnablementAssets({
        user: req.user,
        filters: req.query || {},
      }),
    );
  },
);

router.post(
  "/assets",
  requireAnyPermission(UPLOAD_PERMISSIONS),
  async (req, res) => {
    const parsed = assetSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const validation = await validateCommercialEnablementAssetPayload({
      body: parsed.data,
    });
    if (!validation.ok && parsed.data.status === "published") {
      return res.status(400).json({
        message: "No puedes publicar un activo incompleto",
        issues: validation.issues,
      });
    }
    const resource = await createCommercialEnablementAsset({
      body: parsed.data,
      user: req.user,
    });
    await logAuditEvent({
      req,
      module: "enablement_comercial",
      action: "created",
      entityType: "commercial_enablement_asset",
      entityId: resource.id,
      detail: `Activo creado: ${resource.title}`,
      after: resource,
    });
    return res.status(201).json(resource);
  },
);

router.get(
  "/assets/:assetPublicId",
  requireAnyPermission(READ_PERMISSIONS),
  async (req, res) => {
    const asset = await getCommercialEnablementAssetDetail({
      user: req.user,
      assetPublicId: req.params.assetPublicId,
    });
    if (!asset) {
      return res.status(404).json({ message: "Activo no encontrado" });
    }
    return res.json(asset);
  },
);

router.put(
  "/assets/:assetPublicId",
  requireAnyPermission(UPLOAD_PERMISSIONS),
  async (req, res) => {
    const parsed = assetSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const before = await getCommercialEnablementAssetDetail({
      user: req.user,
      assetPublicId: req.params.assetPublicId,
    });
    if (!before) {
      return res.status(404).json({ message: "Activo no encontrado" });
    }

    const resource = await updateCommercialEnablementAsset({
      assetPublicId: req.params.assetPublicId,
      body: parsed.data,
      user: req.user,
    });
    await logAuditEvent({
      req,
      module: "enablement_comercial",
      action: "updated",
      entityType: "commercial_enablement_asset",
      entityId: resource.id,
      detail: `Activo actualizado: ${resource.title}`,
      before,
      after: resource,
    });
    return res.json(resource);
  },
);

router.post(
  "/assets/:assetPublicId/files",
  requireAnyPermission(UPLOAD_PERMISSIONS),
  async (req, res) => {
    try {
      const resource = await uploadCommercialEnablementFiles({
        req,
        assetPublicId: req.params.assetPublicId,
        user: req.user,
      });
      await logAuditEvent({
        req,
        module: "enablement_comercial",
        action: "file_uploaded",
        entityType: "commercial_enablement_asset",
        entityId: resource.id,
        detail: `Archivo cargado en activo ${resource.title}`,
        after: { fileCount: resource.files.length },
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
  "/assets/:assetPublicId/files/:filePublicId",
  requireAnyPermission(UPLOAD_PERMISSIONS),
  async (req, res) => {
    try {
      const resource = await deleteCommercialEnablementFile({
        assetPublicId: req.params.assetPublicId,
        filePublicId: req.params.filePublicId,
        user: req.user,
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
  "/assets/:assetPublicId/files/:filePublicId/content",
  requireAnyPermission(READ_PERMISSIONS),
  async (req, res) => {
    try {
      const asset = await getCommercialEnablementFileStream({
        assetPublicId: req.params.assetPublicId,
        filePublicId: req.params.filePublicId,
        user: req.user,
      });
      if (!asset) {
        return res.status(404).json({ message: "Archivo no encontrado" });
      }

      asset.stream.on("error", (error) => {
        console.error(error);
        if (!res.headersSent) {
          res
            .status(502)
            .json({ message: "No fue posible transmitir el archivo" });
          return;
        }
        res.destroy(error);
      });

      res.setHeader(
        "Content-Type",
        asset.mimeType || "application/octet-stream",
      );
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(asset.fileName)}"`,
      );
      asset.stream.pipe(res);
    } catch (error) {
      const status = Number(error?.status) || 500;
      if (status >= 500) {
        console.error(error);
      }
      return res.status(status).json({
        message: error?.message || "No fue posible abrir el archivo solicitado",
      });
    }
  },
);

router.post(
  "/assets/:assetPublicId/links",
  requireAnyPermission(UPLOAD_PERMISSIONS),
  async (req, res) => {
    const parsed = linkSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const resource = await createCommercialEnablementLink({
      assetPublicId: req.params.assetPublicId,
      body: parsed.data,
      user: req.user,
    });
    return res.status(201).json(resource);
  },
);

router.put(
  "/assets/:assetPublicId/links/:linkPublicId",
  requireAnyPermission(UPLOAD_PERMISSIONS),
  async (req, res) => {
    const parsed = linkSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const resource = await updateCommercialEnablementLink({
      assetPublicId: req.params.assetPublicId,
      linkPublicId: req.params.linkPublicId,
      body: parsed.data,
      user: req.user,
    });
    return res.json(resource);
  },
);

router.delete(
  "/assets/:assetPublicId/links/:linkPublicId",
  requireAnyPermission(UPLOAD_PERMISSIONS),
  async (req, res) => {
    const resource = await deleteCommercialEnablementLink({
      assetPublicId: req.params.assetPublicId,
      linkPublicId: req.params.linkPublicId,
      user: req.user,
    });
    return res.json(resource);
  },
);

router.get(
  "/assets/:assetPublicId/open-link/:linkPublicId",
  requireAnyPermission(READ_PERMISSIONS),
  async (req, res) => {
    const link = await openCommercialEnablementLink({
      assetPublicId: req.params.assetPublicId,
      linkPublicId: req.params.linkPublicId,
      user: req.user,
    });
    if (!link) {
      return res.status(404).json({ message: "Enlace no encontrado" });
    }
    return res.redirect(link.url);
  },
);

router.post(
  "/assets/:assetPublicId/usage-events",
  requireAnyPermission(READ_PERMISSIONS),
  async (req, res) => {
    const parsed = usageEventSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }
    const asset = await recordCommercialEnablementUsageEvent({
      assetPublicId: req.params.assetPublicId,
      eventType: parsed.data.eventType,
      user: req.user,
      contextType: parsed.data.contextType || null,
      contextEntityId: parsed.data.contextEntityId || null,
      metadata: parsed.data.metadata || null,
    });
    return res.json(asset);
  },
);

router.post(
  "/assets/:assetPublicId/favorite",
  requireAnyPermission(READ_PERMISSIONS),
  async (req, res) => {
    return res.json(
      await addCommercialEnablementFavorite({
        assetPublicId: req.params.assetPublicId,
        user: req.user,
      }),
    );
  },
);

router.delete(
  "/assets/:assetPublicId/favorite",
  requireAnyPermission(READ_PERMISSIONS),
  async (req, res) => {
    return res.json(
      await removeCommercialEnablementFavorite({
        assetPublicId: req.params.assetPublicId,
        user: req.user,
      }),
    );
  },
);

router.post(
  "/assets/:assetPublicId/validate",
  requireAnyPermission(UPLOAD_PERMISSIONS),
  async (req, res) => {
    return res.json(
      await validateCommercialEnablementAsset({
        assetPublicId: req.params.assetPublicId,
        user: req.user,
      }),
    );
  },
);

router.post(
  "/assets/:assetPublicId/publish",
  requireAnyPermission(MANAGE_PERMISSIONS),
  async (req, res) => {
    return res.json(
      await publishCommercialEnablementAsset({
        assetPublicId: req.params.assetPublicId,
        user: req.user,
      }),
    );
  },
);

router.post(
  "/assets/:assetPublicId/obsolete",
  requireAnyPermission(MANAGE_PERMISSIONS),
  async (req, res) => {
    return res.json(
      await obsoleteCommercialEnablementAsset({
        assetPublicId: req.params.assetPublicId,
        user: req.user,
      }),
    );
  },
);

router.post(
  "/assets/:assetPublicId/archive",
  requireAnyPermission(MANAGE_PERMISSIONS),
  async (req, res) => {
    return res.json(
      await archiveCommercialEnablementAsset({
        assetPublicId: req.params.assetPublicId,
        user: req.user,
      }),
    );
  },
);

router.post(
  "/assets/:assetPublicId/duplicate",
  requireAnyPermission(UPLOAD_PERMISSIONS),
  async (req, res) => {
    return res.json(
      await duplicateCommercialEnablementAsset({
        assetPublicId: req.params.assetPublicId,
        user: req.user,
      }),
    );
  },
);

router.delete(
  "/assets/:assetPublicId",
  requireAnyPermission(MANAGE_PERMISSIONS),
  async (req, res) => {
    const before = await getCommercialEnablementAssetDetail({
      user: req.user,
      assetPublicId: req.params.assetPublicId,
    });
    if (!before) {
      return res.status(404).json({ message: "Activo no encontrado" });
    }

    const resource = await deleteCommercialEnablementAsset({
      assetPublicId: req.params.assetPublicId,
      user: req.user,
    });
    await logAuditEvent({
      req,
      module: "enablement_comercial",
      action: "deleted",
      entityType: "commercial_enablement_asset",
      entityId: before.id,
      detail: `Activo eliminado: ${before.title}`,
      before,
      after: resource,
    });
    return res.json(resource);
  },
);

router.post(
  "/assets/:assetPublicId/relations",
  requireAnyPermission(UPLOAD_PERMISSIONS),
  async (req, res) => {
    const parsed = relationSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }
    return res.json(
      await createCommercialEnablementRelation({
        assetPublicId: req.params.assetPublicId,
        body: parsed.data,
        user: req.user,
      }),
    );
  },
);

router.delete(
  "/assets/:assetPublicId/relations/:relationId",
  requireAnyPermission(UPLOAD_PERMISSIONS),
  async (req, res) => {
    return res.json(
      await deleteCommercialEnablementRelation({
        assetPublicId: req.params.assetPublicId,
        relationId: req.params.relationId,
        user: req.user,
      }),
    );
  },
);

router.get(
  "/recent",
  requireAnyPermission(READ_PERMISSIONS),
  async (req, res) => {
    return res.json(await listCommercialEnablementRecent({ user: req.user }));
  },
);

router.get(
  "/favorites",
  requireAnyPermission(READ_PERMISSIONS),
  async (req, res) => {
    return res.json(
      await listCommercialEnablementFavorites({ user: req.user }),
    );
  },
);

router.get(
  "/collections",
  requireAnyPermission(READ_PERMISSIONS),
  async (req, res) => {
    return res.json(
      await listCommercialEnablementCollections({ user: req.user }),
    );
  },
);

router.post(
  "/collections",
  requireAnyPermission(READ_PERMISSIONS),
  async (req, res) => {
    const parsed = collectionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }
    return res.status(201).json(
      await createCommercialEnablementCollection({
        body: parsed.data,
        user: req.user,
      }),
    );
  },
);

router.get(
  "/collections/:collectionPublicId",
  requireAnyPermission(READ_PERMISSIONS),
  async (req, res) => {
    const collection = await getCommercialEnablementCollection({
      collectionPublicId: req.params.collectionPublicId,
      user: req.user,
    });
    if (!collection) {
      return res.status(404).json({ message: "Coleccion no encontrada" });
    }
    return res.json(collection);
  },
);

router.post(
  "/collections/:collectionPublicId/items",
  requireAnyPermission(READ_PERMISSIONS),
  async (req, res) => {
    const assetPublicId = String(req.body?.assetPublicId || "").trim();
    if (!assetPublicId) {
      return res.status(400).json({ message: "assetPublicId requerido" });
    }
    return res.json(
      await addCommercialEnablementCollectionItem({
        collectionPublicId: req.params.collectionPublicId,
        assetPublicId,
        user: req.user,
      }),
    );
  },
);

router.delete(
  "/collections/:collectionPublicId/items/:assetPublicId",
  requireAnyPermission(READ_PERMISSIONS),
  async (req, res) => {
    return res.json(
      await removeCommercialEnablementCollectionItem({
        collectionPublicId: req.params.collectionPublicId,
        assetPublicId: req.params.assetPublicId,
        user: req.user,
      }),
    );
  },
);

router.post(
  "/collections/:collectionPublicId/share-package",
  requireAnyPermission(READ_PERMISSIONS),
  async (req, res) => {
    return res.json(
      await buildCommercialEnablementCollectionSharePackage({
        collectionPublicId: req.params.collectionPublicId,
        user: req.user,
      }),
    );
  },
);

router.get(
  "/analytics/overview",
  requireAnyPermission(MANAGE_PERMISSIONS),
  async (req, res) => {
    return res.json(
      await getCommercialEnablementAnalyticsOverview({ user: req.user }),
    );
  },
);

router.get(
  "/governance/overview",
  requireAnyPermission(MANAGE_PERMISSIONS),
  async (req, res) => {
    return res.json(
      await getCommercialEnablementGovernanceOverview({ user: req.user }),
    );
  },
);

router.post(
  "/catalogs/:catalogType",
  requireAnyPermission(ADMIN_PERMISSIONS),
  async (req, res) => {
    const parsed = catalogEntrySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }
    return res.status(201).json(
      await createCommercialEnablementCatalogEntry({
        catalogType: req.params.catalogType,
        body: parsed.data,
        user: req.user,
      }),
    );
  },
);

router.put(
  "/catalogs/entry/:catalogPublicId",
  requireAnyPermission(ADMIN_PERMISSIONS),
  async (req, res) => {
    const parsed = catalogEntrySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }
    return res.json(
      await updateCommercialEnablementCatalogEntry({
        catalogPublicId: req.params.catalogPublicId,
        body: parsed.data,
        user: req.user,
      }),
    );
  },
);

router.delete(
  "/catalogs/entry/:catalogPublicId",
  requireAnyPermission(ADMIN_PERMISSIONS),
  async (req, res) => {
    return res.json(
      await deleteCommercialEnablementCatalogEntry({
        catalogPublicId: req.params.catalogPublicId,
        user: req.user,
      }),
    );
  },
);

export default router;
