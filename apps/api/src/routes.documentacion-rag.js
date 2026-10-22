import express from "express";
import { z } from "zod";
import { requireAnyPermission, requirePermission } from "./auth.js";
import { ensureDocumentacionRagPermissions } from "./documentacion-rag/permissions.js";
import { ensureDocumentacionRagSchema } from "./documentacion-rag/schema.js";
import { importPineconeDocuments, previewPineconeImport } from "./documentacion-rag/import-service.js";
import {
  createDocumentacionRagTopic,
  deleteDocumentacionRagDocument,
  deleteDocumentacionRagTopic,
  getDocumentacionRagBootstrap,
  getDocumentacionRagUploadLimits,
  replaceDocumentacionRagDocument,
  updateDocumentacionRagSummary,
  updateDocumentacionRagTopic,
  uploadDocumentacionRagDocument,
} from "./documentacion-rag/service.js";

const router = express.Router();
const topicSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000).optional().default(""),
  sortOrder: z.number().int().min(0).max(10000).optional().default(0),
});
const topicUpdateSchema = topicSchema.extend({
  isActive: z.boolean(),
});
const summarySchema = z.object({
  summary: z.string().trim().min(1).max(500),
});

router.use(async (_req, _res, next) => {
  try {
    await ensureDocumentacionRagPermissions();
    await ensureDocumentacionRagSchema();
    next();
  } catch (error) {
    next(error);
  }
});
router.get(
  "/bootstrap",
  requireAnyPermission(["documentacion_rag.access", "documentacion_rag.manage"]),
  async (_req, res) => {
    return res.json({
      ...(await getDocumentacionRagBootstrap()),
      uploadLimits: getDocumentacionRagUploadLimits(),
    });
  },
);

router.use(requirePermission("documentacion_rag.manage"));

router.get("/pinecone-import/preview", async (_req, res) => {
  return res.json(await previewPineconeImport());
});

router.post("/pinecone-import", async (req, res) => {
  const parsed = z.object({
    assistantName: z.string().min(1).max(255),
    selections: z.array(z.object({
      fileId: z.string().min(1).max(128),
      documentId: z.string().min(1).max(64),
      versionId: z.string().min(1).max(64),
      topicId: z.string().min(1).max(64).optional(),
    })).min(1).max(200).refine(
      (items) => new Set(items.map((item) => item.fileId)).size === items.length,
      "No se permiten archivos repetidos",
    ),
  }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Selección de importación no válida", errors: parsed.error.flatten() });
  }
  return res.json(await importPineconeDocuments({ user: req.user, ...parsed.data }));
});

router.post("/topics", async (req, res) => {
  const parsed = topicSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      message: "Datos del tema no válidos",
      errors: parsed.error.flatten(),
    });
  }
  const topicId = await createDocumentacionRagTopic({
    user: req.user,
    ...parsed.data,
  });
  return res.status(201).json({ topicId });
});

router.patch("/topics/:topicId", async (req, res) => {
  const parsed = topicUpdateSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      message: "Datos del tema no válidos",
      errors: parsed.error.flatten(),
    });
  }
  await updateDocumentacionRagTopic({
    user: req.user,
    topicPublicId: req.params.topicId,
    ...parsed.data,
  });
  return res.status(204).end();
});

router.delete("/topics/:topicId", async (req, res) => {
  await deleteDocumentacionRagTopic(req.params.topicId);
  return res.status(204).end();
});

router.post("/documents", async (req, res) => {
  const documentId = await uploadDocumentacionRagDocument({
    user: req.user,
    req,
  });
  return res.status(202).json({
    documentId,
    status: "processing",
    message: "Documento enviado a Pinecone para procesamiento",
  });
});

router.post("/documents/:documentId/replace", async (req, res) => {
  await replaceDocumentacionRagDocument({
    user: req.user,
    documentPublicId: req.params.documentId,
    req,
  });
  return res.status(202).json({
    documentId: req.params.documentId,
    status: "replacing",
    message: "La nueva versión se está procesando",
  });
});

router.patch("/documents/:documentId/summary", async (req, res) => {
  const parsed = summarySchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      message: "El resumen no es válido",
      errors: parsed.error.flatten(),
    });
  }
  await updateDocumentacionRagSummary({
    documentPublicId: req.params.documentId,
    summary: parsed.data.summary,
  });
  return res.status(204).end();
});

router.delete("/documents/:documentId", async (req, res) => {
  await deleteDocumentacionRagDocument(req.params.documentId);
  return res.status(202).json({
    documentId: req.params.documentId,
    status: "deleting",
    message: "Se solicitó eliminar el documento",
  });
});

export default router;
