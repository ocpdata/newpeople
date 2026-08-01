import express from "express";
import { z } from "zod";
import { config } from "./config.js";
import { query, withTransaction } from "./db.js";
import { requireAnyPermission, requirePermission } from "./auth.js";
import { logAuditEvent } from "./audit.js";
import {
  applyUploadSessionToDraft,
  createUploadSession,
  deleteOpportunityDocument,
  deleteSessionDocument,
  getDocumentContentStream,
  getDocumentPreviewText,
  getUploadSessionReview,
  linkDocumentToOpportunityStage,
  linkDocumentToStageAnswer,
  listOpportunityDocuments,
  transferUploadSessionToOpportunity,
  uploadDocumentsToOpportunity,
  uploadFilesToSession,
} from "./opportunity-documents/service.js";
import { ensureOpportunityDocumentSchema } from "./opportunity-documents/schema.js";
import { queueOpportunityStageAnswerSuggestionProcessing } from "./opportunity-stage-answer-suggestions/async.js";
import {
  createOrReuseOpportunityStageAnswerSuggestionJob,
  getOpportunityStageAnswerSuggestionJob,
} from "./opportunity-stage-answer-suggestions/service.js";
import { ensureOpportunityStageAnswerSuggestionJobSchema } from "./opportunity-stage-answer-suggestions/schema.js";
import { queueOpportunityStageValidationProcessing } from "./opportunity-stage-validations/async.js";
import {
  createOrReuseOpportunityStageValidationJob,
  executeOpportunityCurrentStageValidation,
  getOpportunityStageValidationJob,
} from "./opportunity-stage-validations/service.js";
import { ensureOpportunityStageValidationJobSchema } from "./opportunity-stage-validations/schema.js";
import {
  isOpportunityStageAnswerSuggestionsEnabled,
  suggestOpportunityStageAnswers,
} from "./opportunityStageAnswerSuggestions.js";
import {
  activateOpportunityWorkspacePlaybookVersion,
  buildOpportunityWorkspace,
  deleteOpportunityAction,
  deleteOpportunityCriterionAssessment,
  deleteOpportunityDeliverable,
  deleteOpportunityStakeholder,
  deleteOpportunityThemeEntry,
  deleteOpportunityWeakness,
  getOpportunityWorkspacePlaybookVersionDetail,
  listOpportunityWorkspacePlaybooks,
  saveOpportunityAction,
  saveOpportunityDeliverable,
  saveOpportunityStakeholder,
  saveOpportunityThemeEntry,
  saveOpportunityWeakness,
  updateOpportunityWorkspacePlaybookCriterion,
  updateOpportunityWorkspacePlaybookStage,
  upsertOpportunityCriterionAssessment,
} from "./opportunity-workspace/service.js";
import { ensureOpportunityWorkspaceSchema } from "./opportunity-workspace/schema.js";
import { getTemporaryFeatureSettings } from "./settings.js";

const router = express.Router();

function getSanitizedInternalErrorDetail(error) {
  const message = String(error?.message || "")
    .split(/\r?\n/, 1)[0]
    .replace(/\s+/g, " ")
    .trim();

  if (!message) {
    return null;
  }

  return message.slice(0, 500);
}

async function loadAiUsageRequestIdsForSuggestionJob(jobId) {
  const safeJobId = Number(jobId || 0);
  if (!safeJobId) return [];

  const rows = await query(
    `SELECT internal_request_id
     FROM ai_usage_ledger
     WHERE job_type = 'opportunity_stage_answer_suggestion_job'
       AND job_id = ?
     ORDER BY id ASC`,
    [safeJobId],
  );

  return rows
    .map((row) => String(row.internal_request_id || "").trim())
    .filter(Boolean);
}

const opportunityBaseSchema = z.object({
  name: z.string().min(2).max(180),
  amountUsd: z.number().nonnegative(),
  accountId: z.number().int().positive(),
  closeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  contactId: z.number().int().positive(),
  businessLineId: z.number().int().positive(),
  sellerUserId: z.number().int().positive(),
  presalesUserId: z.number().int().positive().optional().nullable(),
});

const opportunityCreateSchema = opportunityBaseSchema.extend({
  salesStageId: z.number().int().positive().optional(),
  activationStatusId: z.number().int().positive().optional(),
  uploadSessionPublicId: z.string().trim().min(8).max(64).optional().nullable(),
});

const opportunityUpdateSchema = opportunityBaseSchema.extend({
  salesStageId: z.number().int().positive().optional(),
  activationStatusId: z.number().int().positive(),
  stageChangeMode: z.enum(["advance", "retreat", "bypass"]).optional(),
  stageChangeReason: z.string().trim().max(5000).optional().nullable(),
  commercialStatusCode: z.enum(["perdida", "anulada"]).optional(),
  commercialCloseReason: z.string().trim().max(5000).optional().nullable(),
});

const opportunityStatusSchema = z.object({
  statusCode: z.enum(["activada", "desactivada", "pendiente_activacion"]),
});

const opportunityStageAnswersSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.number().int().positive(),
        answerValue: z.string().trim().max(5000),
      }),
    )
    .min(1),
});

const opportunityStageTransitionSchema = z.object({
  direction: z.enum(["advance", "retreat"]),
});

const opportunityCommercialCloseSchema = z.object({
  statusCode: z.enum(["ganada", "perdida", "anulada"]),
  reason: z.string().trim().max(5000).optional().nullable(),
});

const opportunityStageValidationSchema = z.object({
  note: z.string().trim().max(5000).optional().nullable(),
});

const opportunityProposeAnswersJobSchema = z.object({
  forceRegenerate: z.boolean().optional(),
});

const opportunityStageBypassSchema = z.object({
  reason: z.string().trim().min(1).max(5000),
});

const opportunityDocumentApplySchema = z.object({
  fieldOverrides: z
    .object({
      name: z.string().trim().max(180).optional(),
      amountUsd: z.number().nonnegative().optional().nullable(),
      closeDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      summaryNotes: z.string().trim().max(5000).optional(),
    })
    .optional()
    .default({}),
  matchSelections: z
    .object({
      accountId: z.number().int().positive().optional().nullable(),
      contactId: z.number().int().positive().optional().nullable(),
      businessLineId: z.number().int().positive().optional().nullable(),
      sellerUserId: z.number().int().positive().optional().nullable(),
      presalesUserId: z.number().int().positive().optional().nullable(),
    })
    .optional()
    .default({}),
});

const opportunityStageDocumentLinkSchema = z.object({
  linkRole: z.string().trim().max(40).optional().default("evidence"),
});

const opportunityStageAnswerDocumentLinkSchema = z.object({
  evidenceExcerpt: z.string().trim().max(5000).optional().nullable(),
});

const opportunityWorkspaceAssessmentSchema = z.object({
  criterionCode: z.string().trim().min(1).max(120),
  salesStageId: z.number().int().positive().optional().nullable(),
  status: z.enum(["missing", "partial", "solid", "waived", "blocked"]),
  score: z.number().int().min(0).max(3),
  confidence: z.enum(["low", "medium", "high"]),
  summary: z.string().trim().max(5000).optional().nullable(),
});

const opportunityWorkspaceWeaknessSchema = z.object({
  id: z.number().int().positive().optional(),
  title: z.string().trim().min(2).max(220),
  category: z.string().trim().min(2).max(80),
  severity: z.enum(["low", "medium", "high"]),
  status: z.enum(["open", "mitigating", "accepted", "resolved"]),
  salesStageId: z.number().int().positive().optional().nullable(),
  themeCode: z.string().trim().max(80).optional().nullable(),
  detail: z.string().trim().max(5000).optional().nullable(),
  mitigationPlan: z.string().trim().max(5000).optional().nullable(),
  ownerUserId: z.number().int().positive().optional().nullable(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  resolvedNote: z.string().trim().max(5000).optional().nullable(),
});

const opportunityWorkspaceThemeEntrySchema = z.object({
  id: z.number().int().positive().optional(),
  themeCode: z.string().trim().min(2).max(80),
  claim: z.string().trim().min(2).max(5000),
  status: z.enum(["supported", "partial", "contradicted", "missing"]),
  confidence: z.enum(["low", "medium", "high"]),
  sourceType: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .optional()
    .default("manual_note"),
  sourceRefId: z.number().int().positive().optional().nullable(),
  evidenceExcerpt: z.string().trim().max(5000).optional().nullable(),
});

const opportunityWorkspaceStakeholderSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(2).max(180),
  roleCode: z.string().trim().min(2).max(80),
  roleLabel: z.string().trim().max(120).optional().nullable(),
  influenceLevel: z.enum(["low", "medium", "high", "critical"]),
  supportLevel: z.enum([
    "blocker",
    "resistant",
    "neutral",
    "supporter",
    "champion",
  ]),
  status: z.enum(["unknown", "identified", "engaged", "validated"]),
  priorities: z.string().trim().max(5000).optional().nullable(),
  concerns: z.string().trim().max(5000).optional().nullable(),
  nextAction: z.string().trim().max(5000).optional().nullable(),
  lastContactAt: z.string().trim().max(40).optional().nullable(),
});

const opportunityWorkspaceActionSchema = z.object({
  id: z.number().int().positive().optional(),
  title: z.string().trim().min(2).max(220),
  actionType: z.string().trim().min(2).max(80),
  status: z.enum(["pending", "in_progress", "blocked", "done"]),
  priority: z.enum(["low", "medium", "high"]),
  linkedStageId: z.number().int().positive().optional().nullable(),
  linkedThemeCode: z.string().trim().max(80).optional().nullable(),
  linkedWeaknessId: z.number().int().positive().optional().nullable(),
  stakeholderId: z.number().int().positive().optional().nullable(),
  ownerUserId: z.number().int().positive().optional().nullable(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  successCriteria: z.string().trim().max(5000).optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
});

const opportunityWorkspaceDeliverableSchema = z.object({
  id: z.number().int().positive().optional(),
  deliverableType: z.string().trim().min(2).max(80),
  title: z.string().trim().min(2).max(220),
  audience: z.string().trim().max(180).optional().nullable(),
  status: z.enum(["missing", "draft", "sent", "validated"]),
  versionLabel: z.string().trim().max(80).optional().nullable(),
  linkedStageId: z.number().int().positive().optional().nullable(),
  sentAt: z.string().trim().max(40).optional().nullable(),
  outcomeSummary: z.string().trim().max(5000).optional().nullable(),
  documentPublicId: z.string().trim().max(64).optional().nullable(),
});

const opportunityWorkspacePlaybookStageSchema = z.object({
  objective: z.string().trim().min(2).max(5000),
  exitCriteriaSummary: z.string().trim().min(2).max(5000),
});

const opportunityWorkspacePlaybookCriterionSchema = z.object({
  title: z.string().trim().min(2).max(220),
  description: z.string().trim().max(5000).optional().nullable(),
  themeCode: z.string().trim().max(80).optional().nullable(),
  displayOrder: z.number().int().positive().optional().default(1),
});

const opportunityCreatePermissions = [
  "oportunidades.create",
  "oportunidades.request",
];
const opportunityBypassStageValidationPermission =
  "oportunidades.bypass_stage_validation";
const opportunityBypassDemonstrationValidationPermission =
  "oportunidades.bypass_demostracion_validation";
const opportunityGlobalReadPermission = "oportunidades.read_all";
const commercialSellerEligibilityPermission = "comercial.seller.eligible";

function hasGlobalAccountReadScope(user) {
  return user?.permissionSet?.has(opportunityGlobalReadPermission);
}

function hasSellerCapability(user) {
  return user?.permissionSet?.has(commercialSellerEligibilityPermission);
}

function applyOwnedAccountScope({ user, accountExpression, params }) {
  if (hasGlobalAccountReadScope(user)) return "";
  params.push(Number(user.id));
  return `INNER JOIN account_owners ao_scope ON ao_scope.account_id = ${accountExpression} AND ao_scope.user_id = ?`;
}

async function requireAccessibleOpportunityOr404({
  user,
  opportunityId,
  message,
}) {
  const params = [];
  const ownershipJoin = applyOwnedAccountScope({
    user,
    accountExpression: "o.account_id",
    params,
  });
  params.push(Number(opportunityId));
  const rows = await query(
    `SELECT o.id
     FROM opportunities o
     ${ownershipJoin}
     WHERE o.id = ?
     LIMIT 1`,
    params,
  );

  if (!rows.length) {
    return { ok: false, response: { status: 404, body: { message } } };
  }

  return { ok: true };
}

function hasExplicitOpportunityPermission(user, permission) {
  return user?.permissionSet?.has(permission);
}

function canBypassCurrentOpportunityStage({ user, currentStageCode }) {
  if (
    hasExplicitOpportunityPermission(
      user,
      opportunityBypassStageValidationPermission,
    )
  ) {
    return true;
  }

  return (
    normalizeText(currentStageCode) === "demostracion" &&
    hasExplicitOpportunityPermission(
      user,
      opportunityBypassDemonstrationValidationPermission,
    )
  );
}

function canChangeOpportunityActivationStatus(user) {
  return hasExplicitOpportunityPermission(user, "oportunidades.create");
}

function canRequestOpportunities(user) {
  return hasExplicitOpportunityPermission(user, "oportunidades.request");
}

async function logOpportunityWorkspaceMutation({
  req,
  opportunityId,
  action,
  detail,
  after = null,
}) {
  await logAuditEvent({
    req,
    module: "opportunities.workspace",
    action,
    entityType: "opportunity",
    entityId: opportunityId,
    detail,
    after,
  });
}

async function getOpportunityActivationStatusId(statusCode) {
  const rows = await query(
    "SELECT id FROM opportunity_activation_statuses WHERE code = ? LIMIT 1",
    [statusCode],
  );
  return rows.length ? Number(rows[0].id) : null;
}

async function getOpportunityActivationStatusCodeById(statusId) {
  const rows = await query(
    "SELECT code FROM opportunity_activation_statuses WHERE id = ? LIMIT 1",
    [statusId],
  );
  return rows.length ? String(rows[0].code) : null;
}

async function getOpportunityCommercialStatusId(statusCode) {
  const rows = await query(
    "SELECT id FROM opportunity_commercial_statuses WHERE code = ? LIMIT 1",
    [statusCode],
  );
  return rows.length ? Number(rows[0].id) : null;
}

async function getOpportunityCommercialStatusCodeById(statusId) {
  const rows = await query(
    "SELECT code FROM opportunity_commercial_statuses WHERE id = ? LIMIT 1",
    [statusId],
  );
  return rows.length ? String(rows[0].code) : null;
}

function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function stringifyJson(value) {
  return JSON.stringify(value ?? null);
}

async function rollbackLeadOpportunityOnDeactivation({
  opportunityId,
  userId,
}) {
  const interactionRows = await query(
    `SELECT DISTINCT i.id,
            i.account_id,
            i.analysis_status,
            i.primary_opportunity_id,
            i.suggested_opportunities_json
     FROM interactions i
     INNER JOIN interaction_opportunity_links iol ON iol.interaction_id = i.id
     WHERE iol.opportunity_id = ?
       AND i.analysis_status IN ('lead_assigned', 'lead_qualified')`,
    [opportunityId],
  );

  if (!interactionRows.length) {
    return { interactionsRolledBack: 0 };
  }

  for (const interaction of interactionRows) {
    const interactionId = Number(interaction.id);
    const remainingLinks = await query(
      `SELECT opportunity_id
       FROM interaction_opportunity_links
       WHERE interaction_id = ?
         AND opportunity_id <> ?
       ORDER BY is_primary DESC, opportunity_id ASC`,
      [interactionId, opportunityId],
    );

    const hasRemainingOpportunities = remainingLinks.length > 0;
    const fallbackPrimaryOpportunityId = hasRemainingOpportunities
      ? Number(remainingLinks[0].opportunity_id)
      : null;

    const cleanedSuggestions = parseJsonArray(
      interaction.suggested_opportunities_json,
    ).filter(
      (suggestion) =>
        Number(suggestion?.selectedOpportunityId || 0) !==
        Number(opportunityId),
    );

    const nextAnalysisStatus = hasRemainingOpportunities
      ? "lead_qualified"
      : "lead_assigned";

    await query(
      `UPDATE interactions
       SET analysis_status = ?,
           primary_opportunity_id = ?,
           suggested_opportunities_json = ?,
           resolved_at = ?,
           updated_by = ?,
           updated_at = NOW(3)
       WHERE id = ?`,
      [
        nextAnalysisStatus,
        fallbackPrimaryOpportunityId,
        stringifyJson(cleanedSuggestions),
        hasRemainingOpportunities ? new Date() : null,
        userId,
        interactionId,
      ],
    );

    await query(
      `DELETE FROM interaction_opportunity_links
       WHERE interaction_id = ?
         AND opportunity_id = ?`,
      [interactionId, opportunityId],
    );

    if (hasRemainingOpportunities) {
      await query(
        `UPDATE interaction_opportunity_links
         SET is_primary = CASE WHEN opportunity_id = ? THEN 1 ELSE 0 END
         WHERE interaction_id = ?`,
        [fallbackPrimaryOpportunityId, interactionId],
      );
    }
  }

  return { interactionsRolledBack: interactionRows.length };
}

async function getOpportunitySalesStageByCode(stageCode) {
  const rows = await query(
    `SELECT id, code, name, stage_order
     FROM opportunity_sales_stages
     WHERE code = ?
     LIMIT 1`,
    [stageCode],
  );
  return rows.length ? rows[0] : null;
}

router.post(
  "/document-upload-sessions",
  requireAnyPermission(opportunityCreatePermissions),
  async (req, res) => {
    try {
      await ensureOpportunityDocumentSchema();
      const session = await createUploadSession({ user: req.user });
      await logAuditEvent({
        req,
        module: "oportunidades",
        action: "document_upload_session_created",
        entityType: "opportunity_document_upload_session",
        detail: "Sesion documental de oportunidad creada",
        after: {
          public_id: session.session.publicId,
          status: session.session.status,
        },
      });
      return res.status(201).json(session);
    } catch (error) {
      if (error?.code === "ER_NO_SUCH_TABLE") {
        return res.status(503).json({
          message:
            "La funcionalidad documental no esta disponible porque el esquema documental no esta instalado.",
          reason: "document_schema_not_available",
        });
      }

      return res.status(error.status || 500).json({
        message:
          error.status && error.status < 500
            ? error.message
            : "No fue posible crear la sesion documental",
      });
    }
  },
);

router.get(
  "/document-upload-sessions/:sessionPublicId",
  requireAnyPermission(opportunityCreatePermissions),
  async (req, res) => {
    try {
      await ensureOpportunityDocumentSchema();
      const review = await getUploadSessionReview({
        sessionPublicId: req.params.sessionPublicId,
        user: req.user,
      });
      return res.json(review);
    } catch (error) {
      return res.status(error.status || 500).json({
        message:
          error.status && error.status < 500
            ? error.message
            : "No fue posible consultar la sesion documental",
      });
    }
  },
);

router.get(
  "/document-upload-sessions/:sessionPublicId/review",
  requireAnyPermission(opportunityCreatePermissions),
  async (req, res) => {
    try {
      await ensureOpportunityDocumentSchema();
      const review = await getUploadSessionReview({
        sessionPublicId: req.params.sessionPublicId,
        user: req.user,
      });
      return res.json(review);
    } catch (error) {
      return res.status(error.status || 500).json({
        message:
          error.status && error.status < 500
            ? error.message
            : "No fue posible consolidar la revision documental",
      });
    }
  },
);

router.post(
  "/document-upload-sessions/:sessionPublicId/files",
  requireAnyPermission(opportunityCreatePermissions),
  async (req, res) => {
    try {
      await ensureOpportunityDocumentSchema();
      const review = await uploadFilesToSession({
        req,
        sessionPublicId: req.params.sessionPublicId,
        user: req.user,
      });
      await logAuditEvent({
        req,
        module: "oportunidades",
        action: "document_uploaded",
        entityType: "opportunity_document_upload_session",
        detail: "Archivos agregados a sesion documental de oportunidad",
        after: {
          public_id: review.session.publicId,
          status: review.session.status,
        },
      });
      return res.status(201).json(review);
    } catch (error) {
      return res.status(error.status || 500).json({
        message:
          error.status && error.status < 500
            ? error.message
            : "No fue posible subir los archivos a la sesion documental",
      });
    }
  },
);

router.delete(
  "/document-upload-sessions/:sessionPublicId/files/:documentPublicId",
  requireAnyPermission(opportunityCreatePermissions),
  async (req, res) => {
    try {
      await ensureOpportunityDocumentSchema();
      const review = await deleteSessionDocument({
        sessionPublicId: req.params.sessionPublicId,
        documentPublicId: req.params.documentPublicId,
        user: req.user,
      });
      return res.json(review);
    } catch (error) {
      return res.status(error.status || 500).json({
        message:
          error.status && error.status < 500
            ? error.message
            : "No fue posible eliminar el documento de la sesion",
      });
    }
  },
);

router.post(
  "/document-upload-sessions/:sessionPublicId/apply-to-draft",
  requireAnyPermission(opportunityCreatePermissions),
  async (req, res) => {
    const parsed = opportunityDocumentApplySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    try {
      await ensureOpportunityDocumentSchema();
      const applied = await applyUploadSessionToDraft({
        sessionPublicId: req.params.sessionPublicId,
        user: req.user,
        body: parsed.data,
      });
      return res.json(applied);
    } catch (error) {
      return res.status(error.status || 500).json({
        message:
          error.status && error.status < 500
            ? error.message
            : "No fue posible aplicar sugerencias al borrador",
      });
    }
  },
);

router.get(
  "/documents/:documentPublicId/preview-text",
  requirePermission("oportunidades.read"),
  async (req, res) => {
    try {
      await ensureOpportunityDocumentSchema();
      const preview = await getDocumentPreviewText({
        documentPublicId: req.params.documentPublicId,
      });
      return res.json(preview);
    } catch (error) {
      return res.status(error.status || 500).json({
        message:
          error.status && error.status < 500
            ? error.message
            : "No fue posible cargar el contenido del documento",
      });
    }
  },
);

router.get(
  "/documents/:documentPublicId/content",
  requirePermission("oportunidades.read"),
  async (req, res) => {
    try {
      await ensureOpportunityDocumentSchema();
      const { document, stream } = await getDocumentContentStream({
        documentPublicId: req.params.documentPublicId,
      });
      res.setHeader(
        "Content-Type",
        document.mime_type || "application/octet-stream",
      );
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(document.original_file_name)}"`,
      );
      stream.pipe(res);
    } catch (error) {
      return res.status(error.status || 500).json({
        message:
          error.status && error.status < 500
            ? error.message
            : "No fue posible abrir el documento",
      });
    }
  },
);

router.get(
  "/workspace-playbooks",
  requireAnyPermission([
    "oportunidades.read",
    "oportunidades.update",
    "configuracion.read",
  ]),
  async (_req, res) => {
    const playbooks = await listOpportunityWorkspacePlaybooks();
    return res.json({ items: playbooks });
  },
);

router.post(
  "/workspace-playbooks/:versionId/activate",
  requirePermission("configuracion.update"),
  async (req, res) => {
    const versionId = Number(req.params.versionId);
    if (!Number.isInteger(versionId) || versionId <= 0) {
      return res.status(400).json({ message: "versionId invalido" });
    }

    const playbook = await activateOpportunityWorkspacePlaybookVersion({
      versionId,
    });
    if (!playbook) {
      return res
        .status(404)
        .json({ message: "Version de playbook no encontrada" });
    }

    await logAuditEvent({
      req,
      module: "opportunities.workspace",
      action: "workspace_playbook_activated",
      entityType: "opportunity_playbook_version",
      entityId: versionId,
      detail: `Playbook activado: ${playbook.name} ${playbook.version}`,
      after: playbook,
    });

    return res.json({ playbook });
  },
);

router.get(
  "/workspace-playbooks/:versionId",
  requirePermission("configuracion.read"),
  async (req, res) => {
    const versionId = Number(req.params.versionId);
    if (!Number.isInteger(versionId) || versionId <= 0) {
      return res.status(400).json({ message: "versionId invalido" });
    }

    const playbook = await getOpportunityWorkspacePlaybookVersionDetail({
      versionId,
    });
    if (!playbook) {
      return res
        .status(404)
        .json({ message: "Version de playbook no encontrada" });
    }

    return res.json({ playbook });
  },
);

router.put(
  "/workspace-playbooks/:versionId/stages/:salesStageCode",
  requirePermission("configuracion.update"),
  async (req, res) => {
    const versionId = Number(req.params.versionId);
    if (!Number.isInteger(versionId) || versionId <= 0) {
      return res.status(400).json({ message: "versionId invalido" });
    }
    const parsed = opportunityWorkspacePlaybookStageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Payload invalido", errors: parsed.error.flatten() });
    }

    const playbook = await updateOpportunityWorkspacePlaybookStage({
      versionId,
      salesStageCode: String(req.params.salesStageCode || "").trim(),
      objective: parsed.data.objective,
      exitCriteriaSummary: parsed.data.exitCriteriaSummary,
    });
    if (!playbook) {
      return res
        .status(404)
        .json({ message: "Etapa de playbook no encontrada" });
    }

    await logAuditEvent({
      req,
      module: "opportunities.workspace",
      action: "workspace_playbook_stage_updated",
      entityType: "opportunity_playbook_version",
      entityId: versionId,
      detail: `Etapa editada: ${req.params.salesStageCode}`,
      after: {
        salesStageCode: req.params.salesStageCode,
        objective: parsed.data.objective,
        exitCriteriaSummary: parsed.data.exitCriteriaSummary,
      },
    });

    return res.json({ playbook });
  },
);

router.put(
  "/workspace-playbooks/:versionId/stages/:salesStageCode/criteria/:criterionCode",
  requirePermission("configuracion.update"),
  async (req, res) => {
    const versionId = Number(req.params.versionId);
    if (!Number.isInteger(versionId) || versionId <= 0) {
      return res.status(400).json({ message: "versionId invalido" });
    }
    const parsed = opportunityWorkspacePlaybookCriterionSchema.safeParse(
      req.body,
    );
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Payload invalido", errors: parsed.error.flatten() });
    }

    const playbook = await updateOpportunityWorkspacePlaybookCriterion({
      versionId,
      salesStageCode: String(req.params.salesStageCode || "").trim(),
      criterionCode: String(req.params.criterionCode || "").trim(),
      title: parsed.data.title,
      description: parsed.data.description,
      themeCode: parsed.data.themeCode,
      displayOrder: parsed.data.displayOrder,
    });
    if (!playbook) {
      return res
        .status(404)
        .json({ message: "Criterio de playbook no encontrado" });
    }

    await logAuditEvent({
      req,
      module: "opportunities.workspace",
      action: "workspace_playbook_criterion_updated",
      entityType: "opportunity_playbook_version",
      entityId: versionId,
      detail: `Criterio editado: ${req.params.criterionCode}`,
      after: {
        salesStageCode: req.params.salesStageCode,
        criterionCode: req.params.criterionCode,
        title: parsed.data.title,
        themeCode: parsed.data.themeCode,
      },
    });

    return res.json({ playbook });
  },
);

router.get(
  "/:id/documents",
  requirePermission("oportunidades.read"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Id de oportunidad invalido" });
    }

    const opportunityAccess = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId: id,
      message: "Oportunidad no encontrada",
    });
    if (!opportunityAccess.ok) {
      return res
        .status(opportunityAccess.response.status)
        .json(opportunityAccess.response.body);
    }

    await ensureOpportunityDocumentSchema();
    return res.json(await listOpportunityDocuments({ opportunityId: id }));
  },
);

router.post(
  "/:id/documents",
  requireAnyPermission(opportunityCreatePermissions),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Id de oportunidad invalido" });
    }

    const opportunityAccess = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId: id,
      message: "Oportunidad no encontrada",
    });
    if (!opportunityAccess.ok) {
      return res
        .status(opportunityAccess.response.status)
        .json(opportunityAccess.response.body);
    }

    try {
      await ensureOpportunityDocumentSchema();
      const documents = await uploadDocumentsToOpportunity({
        req,
        opportunityId: id,
        user: req.user,
      });
      return res.status(201).json(documents);
    } catch (error) {
      return res.status(error.status || 500).json({
        message:
          error.status && error.status < 500
            ? error.message
            : "No fue posible adjuntar documentos a la oportunidad",
      });
    }
  },
);

router.delete(
  "/:id/documents/:documentPublicId",
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Id de oportunidad invalido" });
    }

    const opportunityAccess = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId: id,
      message: "Oportunidad no encontrada",
    });
    if (!opportunityAccess.ok) {
      return res
        .status(opportunityAccess.response.status)
        .json(opportunityAccess.response.body);
    }

    try {
      await ensureOpportunityDocumentSchema();
      const deletedDocument = await deleteOpportunityDocument({
        opportunityId: id,
        documentPublicId: req.params.documentPublicId,
      });
      await logAuditEvent({
        req,
        module: "opportunities.workspace",
        action: "opportunity_document_deleted",
        entityType: "opportunity",
        entityId: id,
        detail: `Documento eliminado: ${deletedDocument.originalFileName}`,
        after: {
          documentPublicId: deletedDocument.publicId,
          originalFileName: deletedDocument.originalFileName,
        },
      });
      return res.json({ message: "Documento eliminado correctamente" });
    } catch (error) {
      return res.status(error.status || 500).json({
        message:
          error.status && error.status < 500
            ? error.message
            : "No fue posible eliminar el documento de la oportunidad",
      });
    }
  },
);

router.post(
  "/:id/stages/:salesStageId/documents/:documentPublicId/link",
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const id = Number(req.params.id);
    const salesStageId = Number(req.params.salesStageId);
    if (
      !Number.isInteger(id) ||
      id <= 0 ||
      !Number.isInteger(salesStageId) ||
      salesStageId <= 0
    ) {
      return res.status(400).json({ message: "Parametros invalidos" });
    }

    const parsed = opportunityStageDocumentLinkSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const opportunityAccess = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId: id,
      message: "Oportunidad no encontrada",
    });
    if (!opportunityAccess.ok) {
      return res
        .status(opportunityAccess.response.status)
        .json(opportunityAccess.response.body);
    }

    try {
      await ensureOpportunityDocumentSchema();
      await linkDocumentToOpportunityStage({
        opportunityId: id,
        salesStageId,
        documentPublicId: req.params.documentPublicId,
        userId: req.user.id,
        linkRole: parsed.data.linkRole,
      });
      return res
        .status(201)
        .json({ message: "Documento vinculado a la etapa" });
    } catch (error) {
      return res.status(error.status || 500).json({
        message:
          error.status && error.status < 500
            ? error.message
            : "No fue posible vincular el documento a la etapa",
      });
    }
  },
);

router.post(
  "/stage-answer-sources/:answerId/documents/:documentPublicId",
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const answerId = Number(req.params.answerId);
    if (!Number.isInteger(answerId) || answerId <= 0) {
      return res.status(400).json({ message: "Id de respuesta invalido" });
    }

    const parsed = opportunityStageAnswerDocumentLinkSchema.safeParse(
      req.body || {},
    );
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    try {
      await ensureOpportunityDocumentSchema();
      await linkDocumentToStageAnswer({
        stageAnswerId: answerId,
        documentPublicId: req.params.documentPublicId,
        evidenceExcerpt: parsed.data.evidenceExcerpt,
      });
      return res
        .status(201)
        .json({ message: "Documento vinculado a la respuesta" });
    } catch (error) {
      return res.status(error.status || 500).json({
        message:
          error.status && error.status < 500
            ? error.message
            : "No fue posible vincular el documento a la respuesta",
      });
    }
  },
);

async function getOpportunitySalesStageById(stageId) {
  const rows = await query(
    `SELECT id, code, name, stage_order
     FROM opportunity_sales_stages
     WHERE id = ?
       AND is_active = 1
     LIMIT 1`,
    [stageId],
  );
  return rows.length ? rows[0] : null;
}

async function getActiveOpportunityStages() {
  return query(
    `SELECT id, code, name, stage_order
     FROM opportunity_sales_stages
     WHERE is_active = 1
     ORDER BY stage_order, id`,
  );
}

async function getOpportunityStateById(opportunityId) {
  const rows = await query(
    `SELECT o.*, oss.code AS sales_stage_code, oss.name AS sales_stage_name,
            oss.stage_order,
            ocs.code AS commercial_status_code,
            ocs.name AS commercial_status_name
     FROM opportunities o
     INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
     INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
     WHERE o.id = ?
     LIMIT 1`,
    [opportunityId],
  );
  return rows.length ? rows[0] : null;
}

async function getOpportunityStageQuestions(salesStageId) {
  return query(
    `SELECT id, sales_stage_id, code, prompt, response_type,
            display_order, is_required, is_active
     FROM opportunity_stage_questions
     WHERE sales_stage_id = ?
       AND is_active = 1
     ORDER BY display_order, id`,
    [salesStageId],
  );
}

async function getLatestOpportunityStageAnswers({
  opportunityId,
  salesStageId,
}) {
  return query(
    `SELECT q.id AS question_id,
            a.id AS stage_answer_id,
            q.code,
            q.prompt,
            q.response_type,
            q.display_order,
            q.is_required,
            a.answer_value,
            a.answered_at,
            a.answered_by_user_id
     FROM opportunity_stage_questions q
     LEFT JOIN opportunity_stage_question_answers a
       ON a.id = (
         SELECT a2.id
         FROM opportunity_stage_question_answers a2
         WHERE a2.opportunity_id = ?
           AND a2.sales_stage_id = ?
           AND a2.question_id = q.id
         ORDER BY a2.id DESC
         LIMIT 1
       )
     WHERE q.sales_stage_id = ?
       AND q.is_active = 1
     ORDER BY q.display_order, q.id`,
    [opportunityId, salesStageId, salesStageId],
  );
}

async function getLatestOpportunityStageBypass({
  opportunityId,
  salesStageId,
}) {
  const rows = await query(
    `SELECT changed_fields
     FROM audit_log
     WHERE entity_type = 'opportunity'
       AND entity_id = ?
       AND action = 'stage_bypassed'
       AND JSON_EXTRACT(changed_fields, '$.sales_stage_id.before') = CAST(? AS JSON)
     ORDER BY id DESC
     LIMIT 1`,
    [opportunityId, Number(salesStageId)],
  );

  if (!rows.length || !rows[0].changed_fields) {
    return { isBypassed: false, reason: null };
  }

  try {
    const changedFields =
      typeof rows[0].changed_fields === "string"
        ? JSON.parse(rows[0].changed_fields)
        : rows[0].changed_fields;
    const reason = String(
      changedFields?.bypass_reason?.after ||
        changedFields?.stage_change_reason?.after ||
        "",
    ).trim();
    return {
      isBypassed: true,
      reason: reason || null,
    };
  } catch {
    return { isBypassed: true, reason: null };
  }
}

function buildOpportunityStageSummary({
  stages,
  currentSalesStageId,
  selectedSalesStageId,
  isClosed,
}) {
  const currentStage = stages.find(
    (stage) => Number(stage.id) === Number(currentSalesStageId),
  );

  return stages.map((stage) => {
    const stageOrder = Number(stage.stage_order);
    const currentOrder = Number(currentStage?.stage_order || 0);
    return {
      id: Number(stage.id),
      code: String(stage.code),
      name: String(stage.name),
      order: stageOrder,
      isCurrent: Number(stage.id) === Number(currentSalesStageId),
      isSelected: Number(stage.id) === Number(selectedSalesStageId),
      isPast: currentStage ? stageOrder < currentOrder : false,
      isFuture: currentStage ? stageOrder > currentOrder : false,
      isClosed,
    };
  });
}

async function buildOpportunityStageView({
  opportunityState,
  selectedSalesStageId = Number(opportunityState.sales_stage_id),
  persistRecommendedStrategy = false,
  strategyUpdatedByUserId = null,
}) {
  await ensureOpportunityWorkspaceSchema();
  const selectedStage =
    await getOpportunitySalesStageById(selectedSalesStageId);
  if (!selectedStage) {
    return null;
  }

  const stages = await getActiveOpportunityStages();
  const answers = await getLatestOpportunityStageAnswers({
    opportunityId: Number(opportunityState.id),
    salesStageId: Number(selectedStage.id),
  });
  const bypassInfo = await getLatestOpportunityStageBypass({
    opportunityId: Number(opportunityState.id),
    salesStageId: Number(selectedStage.id),
  });
  const documents = await listOpportunityDocuments({
    opportunityId: Number(opportunityState.id),
  }).catch(() => []);
  const isClosed = isClosedCommercialStatus(
    opportunityState.commercial_status_code,
  );

  const baseView = {
    opportunityId: Number(opportunityState.id),
    salesStage: {
      id: Number(selectedStage.id),
      code: String(selectedStage.code),
      name: String(selectedStage.name),
      order: Number(selectedStage.stage_order),
    },
    currentSalesStage: {
      id: Number(opportunityState.sales_stage_id),
      code: String(opportunityState.sales_stage_code),
      name: String(opportunityState.sales_stage_name),
      order: Number(opportunityState.stage_order),
    },
    commercialStatus: {
      id: Number(opportunityState.commercial_status_id),
      code: opportunityState.commercial_status_code,
      name: opportunityState.commercial_status_name,
      closedAt: opportunityState.commercial_closed_at,
      closeReason: opportunityState.commercial_close_reason,
    },
    isSelectedStageCurrent:
      Number(selectedStage.id) === Number(opportunityState.sales_stage_id),
    stages: buildOpportunityStageSummary({
      stages,
      currentSalesStageId: Number(opportunityState.sales_stage_id),
      selectedSalesStageId: Number(selectedStage.id),
      isClosed,
    }),
    features: {
      documentAnswerSuggestionsEnabled:
        isOpportunityStageAnswerSuggestionsEnabled(),
      rolloutKey: "opportunity_stage_answer_suggestions",
      configuredByEnv:
        String(config.features.opportunityStageAnswerSuggestionsEnabled) ===
        "true",
    },
    bypassInfo,
    answers,
  };

  const workspace = await buildOpportunityWorkspace({
    opportunityState,
    stageView: baseView,
    documents,
    persistRecommendedStrategy,
    strategyUpdatedByUserId,
  });

  return {
    ...baseView,
    workspace,
  };
}

async function refreshOpportunityRecommendedStrategy({
  opportunityId,
  selectedSalesStageId,
  userId,
}) {
  const opportunityState = await getOpportunityStateById(opportunityId);
  if (!opportunityState) {
    return null;
  }

  return buildOpportunityStageView({
    opportunityState,
    selectedSalesStageId:
      selectedSalesStageId || Number(opportunityState.sales_stage_id),
    persistRecommendedStrategy: true,
    strategyUpdatedByUserId: userId,
  });
}

function isClosedCommercialStatus(statusCode) {
  return (
    statusCode === "ganada" ||
    statusCode === "perdida" ||
    statusCode === "anulada"
  );
}

function normalizeOpportunityValidationText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function applyContactoInicialValidationGuardrail({
  salesStage,
  currentAnswers,
  validationResult,
}) {
  if (String(salesStage?.code || "") !== "contacto_inicial") {
    return validationResult;
  }

  const combinedAnswers = normalizeOpportunityValidationText(
    (Array.isArray(currentAnswers) ? currentAnswers : [])
      .map((answer) => String(answer.answer_value || "").trim())
      .filter(Boolean)
      .join(" \n "),
  );

  const hasConcreteNeed =
    combinedAnswers.length >= 40 &&
    /(necesit|problema|interes|busca|requiere|prioridad|urgenc|riesgo|seguridad|control|mejorar|optimizar|proteger|api|dns|aws|trafico|solucion)/.test(
      combinedAnswers,
    );
  const hasFollowUp =
    /(reunion|seguimiento|demo|demostracion|prueba tecnica|sesion|agenda|agendad|agendar|coordina|coordinad|equipo tecnico|validar la solucion|validar la propuesta|siguiente paso)/.test(
      combinedAnswers,
    );

  if (!hasConcreteNeed) {
    return validationResult;
  }

  if (!hasFollowUp) {
    return {
      ...validationResult,
      decision: "advance_with_caution",
      summary:
        "La etapa de Contacto Inicial puede avanzar con reservas porque la necesidad del cliente ya es clara, aunque el siguiente paso todavia no esta documentado con suficiente precision.",
      reasons: [
        "La respuesta actual ya demuestra una necesidad o interes concreto del cliente.",
        "Aun falta documentar con mayor precision la reunion, demo o siguiente paso que cerrara la etapa con mas solidez.",
      ],
      suggestions: [
        "Confirma y registra el siguiente paso comercial o tecnico para avanzar con mayor respaldo a la siguiente etapa.",
      ],
      confidence: hasFollowUp ? "high" : "medium",
      questionAssessments: (Array.isArray(validationResult?.questionAssessments)
        ? validationResult.questionAssessments
        : []
      ).map((assessment) => ({
        ...assessment,
        status: assessment.status === "missing" ? "missing" : "adequate",
        reason:
          assessment.status === "missing"
            ? assessment.reason
            : "La respuesta ya demuestra una necesidad concreta del cliente para cerrar Contacto Inicial con reservas.",
        suggestion:
          assessment.status === "missing"
            ? assessment.suggestion
            : "Documenta el siguiente paso acordado para dejar lista la transicion sin reservas.",
      })),
    };
  }

  return {
    ...validationResult,
    decision: "ready_to_advance",
    summary:
      "La etapa de Contacto Inicial esta lista para avanzar porque ya existe una necesidad concreta del cliente y un siguiente paso acordado para profundizar la oportunidad.",
    reasons: [
      "La respuesta actual expresa una necesidad o interes concreto del cliente.",
      "Tambien deja claro un siguiente paso de seguimiento o validacion tecnica, que cumple el criterio de cierre de Contacto Inicial.",
    ],
    suggestions: [
      "Ejecuta la reunion o prueba tecnica y documenta los hallazgos para desarrollar la oportunidad en la siguiente etapa.",
    ],
    confidence: "high",
    questionAssessments: (Array.isArray(validationResult?.questionAssessments)
      ? validationResult.questionAssessments
      : []
    ).map((assessment) => ({
      ...assessment,
      status: assessment.status === "missing" ? "missing" : "adequate",
      reason:
        assessment.status === "missing"
          ? assessment.reason
          : "La respuesta demuestra una necesidad concreta del cliente y sustenta el avance de la etapa.",
      suggestion:
        assessment.status === "missing"
          ? assessment.suggestion
          : "Registrar el resultado del siguiente paso tecnico o comercial en la siguiente etapa.",
    })),
  };
}

async function validateRequiredCurrentStageAnswers({
  opportunityId,
  salesStageId,
}) {
  const rows = await getLatestOpportunityStageAnswers({
    opportunityId,
    salesStageId,
  });
  const missingRequiredAnswers = rows.filter(
    (row) => row.is_required && !String(row.answer_value || "").trim(),
  );
  if (missingRequiredAnswers.length) {
    return {
      ok: false,
      message:
        "Debes responder todas las preguntas obligatorias de la etapa actual",
    };
  }
  return { ok: true };
}

async function getAdjacentOpportunityStage({ salesStageId, direction }) {
  const stages = await getActiveOpportunityStages();
  const currentStageIndex = stages.findIndex(
    (stage) => Number(stage.id) === Number(salesStageId),
  );
  if (currentStageIndex === -1) {
    return {
      ok: false,
      message: "La etapa actual de la oportunidad no es valida",
    };
  }

  const targetStage =
    direction === "advance"
      ? stages[currentStageIndex + 1] || null
      : stages[currentStageIndex - 1] || null;

  if (!targetStage) {
    return {
      ok: false,
      message:
        direction === "advance"
          ? "La oportunidad ya esta en la ultima etapa operativa"
          : "La oportunidad ya esta en la primera etapa operativa",
    };
  }

  return { ok: true, targetStage };
}

async function resolveOpportunityCreationStatusCode(user) {
  if (hasExplicitOpportunityPermission(user, "oportunidades.create")) {
    return "activada";
  }
  if (!canRequestOpportunities(user)) {
    return null;
  }

  if (hasGlobalAccountReadScope(user)) {
    return "pendiente_activacion";
  }

  const settings = await getTemporaryFeatureSettings();
  if (settings.opportunitiesPendingEnabled) {
    return "pendiente_activacion";
  }

  return null;
}

async function ensurePendingOpportunityStatusAllowed() {
  const settings = await getTemporaryFeatureSettings();
  return settings.opportunitiesPendingEnabled;
}

async function validateOpportunityRelations({
  user,
  accountId,
  contactId,
  sellerUserId,
  presalesUserId,
}) {
  if (!hasGlobalAccountReadScope(user)) {
    const accountRows = await query(
      `SELECT 1
       FROM account_owners
       WHERE account_id = ? AND user_id = ?
       LIMIT 1`,
      [Number(accountId), Number(user.id)],
    );

    if (!accountRows.length) {
      return {
        ok: false,
        status: 403,
        message: "No autorizado para usar una cuenta que no te pertenece",
      };
    }
  }

  const contactRows = await query(
    "SELECT account_id FROM contacts WHERE id = ? LIMIT 1",
    [contactId],
  );
  if (!contactRows.length) {
    return { ok: false, status: 400, message: "Contacto invalido" };
  }
  if (Number(contactRows[0].account_id) !== Number(accountId)) {
    return {
      ok: false,
      status: 400,
      message: "El contacto debe pertenecer a la cuenta seleccionada",
    };
  }

  if (
    hasSellerCapability(user) &&
    !hasGlobalAccountReadScope(user) &&
    Number(sellerUserId) !== Number(user.id)
  ) {
    return {
      ok: false,
      status: 403,
      message:
        "No autorizado para asignar un vendedor diferente al usuario actual",
    };
  }

  const sellerRows = await query(
    `SELECT u.id
     FROM users u
     WHERE u.id = ?
       AND u.status = 'active'
       AND EXISTS (
         SELECT 1
         FROM user_roles ur
         INNER JOIN role_permissions rp ON rp.role_id = ur.role_id
         INNER JOIN permissions p ON p.id = rp.permission_id
         WHERE ur.user_id = u.id
           AND p.code = ?
       )
     LIMIT 1`,
    [sellerUserId, commercialSellerEligibilityPermission],
  );

  if (!sellerRows.length) {
    return {
      ok: false,
      status: 400,
      message: "El vendedor debe ser elegible comercialmente",
    };
  }

  if (presalesUserId) {
    const presalesRows = await query(
      `SELECT u.id
       FROM users u
       INNER JOIN user_roles ur ON ur.user_id = u.id
       INNER JOIN roles r ON r.id = ur.role_id
       WHERE u.id = ?
         AND u.status = 'active'
         AND LOWER(TRIM(r.name)) = 'preventa'
       LIMIT 1`,
      [presalesUserId],
    );

    if (!presalesRows.length) {
      return {
        ok: false,
        status: 400,
        message: "El ingeniero preventa debe tener rol de preventa",
      };
    }
  }

  return { ok: true };
}

router.get("/", requirePermission("oportunidades.read"), async (req, res) => {
  const params = [];
  const ownershipJoin = applyOwnedAccountScope({
    user: req.user,
    accountExpression: "o.account_id",
    params,
  });

  const accountIdFilter = req.query.accountId
    ? Number(req.query.accountId)
    : null;
  if (accountIdFilter !== null) {
    if (!Number.isInteger(accountIdFilter) || accountIdFilter <= 0) {
      return res.status(400).json({ message: "accountId invalido" });
    }
    params.push(accountIdFilter);
  }

  const contactIdFilter = req.query.contactId
    ? Number(req.query.contactId)
    : null;
  if (contactIdFilter !== null) {
    if (!Number.isInteger(contactIdFilter) || contactIdFilter <= 0) {
      return res.status(400).json({ message: "contactId invalido" });
    }
    params.push(contactIdFilter);
  }

  const whereClauses = [];
  if (accountIdFilter !== null) {
    whereClauses.push("o.account_id = ?");
  }
  if (contactIdFilter !== null) {
    whereClauses.push("o.contact_id = ?");
  }

  const rows = await query(
    `SELECT o.id, o.name, o.amount_usd, o.close_date,
            a.id AS account_id, a.name AS account_name,
          o.contact_id AS contact_id,
            CONCAT(c.first_name, ' ', c.last_name) AS contact_name,
            oss.name AS sales_stage,
            ocs.name AS commercial_status,
            obl.name AS business_line,
            su.full_name AS seller_user_name,
            pu.full_name AS presales_user_name,
            oas.name AS activation_status,
            u1.full_name AS created_by_name,
            o.created_at,
            u2.full_name AS updated_by_name,
            o.updated_at
     FROM opportunities o
               ${ownershipJoin}
     INNER JOIN accounts a ON a.id = o.account_id
     INNER JOIN contacts c ON c.id = o.contact_id
     INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
    INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
     INNER JOIN opportunity_business_lines obl ON obl.id = o.business_line_id
     LEFT JOIN users su ON su.id = o.seller_user_id
     LEFT JOIN users pu ON pu.id = o.presales_user_id
     INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
     INNER JOIN users u1 ON u1.id = o.created_by
     INNER JOIN users u2 ON u2.id = o.updated_by
     ${whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : ""}
     ORDER BY o.id DESC`,
    params,
  );
  res.json(rows);
});

router.get(
  "/:id/commercial-context",
  requirePermission("oportunidades.read"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Id de oportunidad invalido" });
    }

    const opportunityAccess = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId: id,
      message: "Oportunidad no encontrada",
    });
    if (!opportunityAccess.ok) {
      return res
        .status(opportunityAccess.response.status)
        .json(opportunityAccess.response.body);
    }

    const opportunityState = await getOpportunityStateById(id);
    if (!opportunityState) {
      return res.status(404).json({ message: "Oportunidad no encontrada" });
    }

    const stageView = await buildOpportunityStageView({
      opportunityState,
      selectedSalesStageId: Number(opportunityState.sales_stage_id),
      persistRecommendedStrategy: true,
    });
    if (!stageView) {
      return res.status(400).json({ message: "Etapa de venta invalida" });
    }

    return res.json(stageView);
  },
);

router.get(
  "/:id/stage-view/:salesStageId",
  requirePermission("oportunidades.read"),
  async (req, res) => {
    const id = Number(req.params.id);
    const salesStageId = Number(req.params.salesStageId);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Id de oportunidad invalido" });
    }
    if (!Number.isInteger(salesStageId) || salesStageId <= 0) {
      return res.status(400).json({ message: "salesStageId invalido" });
    }

    const opportunityAccess = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId: id,
      message: "Oportunidad no encontrada",
    });
    if (!opportunityAccess.ok) {
      return res
        .status(opportunityAccess.response.status)
        .json(opportunityAccess.response.body);
    }

    const opportunityState = await getOpportunityStateById(id);
    if (!opportunityState) {
      return res.status(404).json({ message: "Oportunidad no encontrada" });
    }

    const stageView = await buildOpportunityStageView({
      opportunityState,
      selectedSalesStageId: salesStageId,
      persistRecommendedStrategy: true,
    });
    if (!stageView) {
      return res.status(404).json({ message: "Etapa de venta no encontrada" });
    }

    return res.json(stageView);
  },
);

router.post(
  "/:id/workspace/assessments",
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Id de oportunidad invalido" });
    }

    const parsed = opportunityWorkspaceAssessmentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Payload invalido", errors: parsed.error.flatten() });
    }

    const opportunityAccess = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId: id,
      message: "Oportunidad no encontrada",
    });
    if (!opportunityAccess.ok) {
      return res
        .status(opportunityAccess.response.status)
        .json(opportunityAccess.response.body);
    }

    await upsertOpportunityCriterionAssessment({
      opportunityId: id,
      criterionCode: parsed.data.criterionCode,
      salesStageId: parsed.data.salesStageId,
      status: parsed.data.status,
      score: parsed.data.score,
      confidence: parsed.data.confidence,
      summary: parsed.data.summary,
      userId: Number(req.user.id),
    });

    await logOpportunityWorkspaceMutation({
      req,
      opportunityId: id,
      action: "workspace_assessment_saved",
      detail: `Assessment actualizado: ${parsed.data.criterionCode}`,
      after: {
        criterionCode: parsed.data.criterionCode,
        status: parsed.data.status,
        score: parsed.data.score,
      },
    });

    const opportunityState = await getOpportunityStateById(id);
    const stageView = await buildOpportunityStageView({
      opportunityState,
      selectedSalesStageId: Number(opportunityState.sales_stage_id),
      persistRecommendedStrategy: true,
      strategyUpdatedByUserId: Number(req.user.id),
    });
    return res.json({ workspace: stageView.workspace });
  },
);

router.post(
  "/:id/workspace/weaknesses",
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Id de oportunidad invalido" });
    }
    const parsed = opportunityWorkspaceWeaknessSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Payload invalido", errors: parsed.error.flatten() });
    }
    const opportunityAccess = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId: id,
      message: "Oportunidad no encontrada",
    });
    if (!opportunityAccess.ok) {
      return res
        .status(opportunityAccess.response.status)
        .json(opportunityAccess.response.body);
    }
    const savedId = await saveOpportunityWeakness({
      opportunityId: id,
      weaknessId: parsed.data.id,
      payload: {
        title: parsed.data.title,
        category: parsed.data.category,
        severity: parsed.data.severity,
        status: parsed.data.status,
        sales_stage_id: parsed.data.salesStageId || null,
        theme_code: parsed.data.themeCode || null,
        detail: parsed.data.detail || null,
        mitigation_plan: parsed.data.mitigationPlan || null,
        owner_user_id: parsed.data.ownerUserId || null,
        due_date: parsed.data.dueDate || null,
        resolved_note: parsed.data.resolvedNote || null,
      },
      userId: Number(req.user.id),
    });
    await logOpportunityWorkspaceMutation({
      req,
      opportunityId: id,
      action: parsed.data.id
        ? "workspace_weakness_updated"
        : "workspace_weakness_created",
      detail: `Debilidad guardada: ${parsed.data.title}`,
      after: {
        id: savedId,
        title: parsed.data.title,
        status: parsed.data.status,
        severity: parsed.data.severity,
      },
    });
    await refreshOpportunityRecommendedStrategy({
      opportunityId: id,
      userId: Number(req.user.id),
    });
    return res.json({ id: savedId });
  },
);

router.post(
  "/:id/workspace/themes",
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Id de oportunidad invalido" });
    }
    const parsed = opportunityWorkspaceThemeEntrySchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Payload invalido", errors: parsed.error.flatten() });
    }
    const opportunityAccess = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId: id,
      message: "Oportunidad no encontrada",
    });
    if (!opportunityAccess.ok) {
      return res
        .status(opportunityAccess.response.status)
        .json(opportunityAccess.response.body);
    }
    const savedId = await saveOpportunityThemeEntry({
      opportunityId: id,
      entryId: parsed.data.id,
      payload: {
        theme_code: parsed.data.themeCode,
        claim: parsed.data.claim,
        status: parsed.data.status,
        confidence: parsed.data.confidence,
        source_type: parsed.data.sourceType,
        source_ref_id: parsed.data.sourceRefId || null,
        evidence_excerpt: parsed.data.evidenceExcerpt || null,
      },
      userId: Number(req.user.id),
    });
    await logOpportunityWorkspaceMutation({
      req,
      opportunityId: id,
      action: parsed.data.id
        ? "workspace_theme_updated"
        : "workspace_theme_created",
      detail: `Claim tematico guardado: ${parsed.data.themeCode}`,
      after: {
        id: savedId,
        themeCode: parsed.data.themeCode,
        status: parsed.data.status,
      },
    });
    await refreshOpportunityRecommendedStrategy({
      opportunityId: id,
      userId: Number(req.user.id),
    });
    return res.json({ id: savedId });
  },
);

router.post(
  "/:id/workspace/stakeholders",
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Id de oportunidad invalido" });
    }
    const parsed = opportunityWorkspaceStakeholderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Payload invalido", errors: parsed.error.flatten() });
    }
    const opportunityAccess = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId: id,
      message: "Oportunidad no encontrada",
    });
    if (!opportunityAccess.ok) {
      return res
        .status(opportunityAccess.response.status)
        .json(opportunityAccess.response.body);
    }
    const savedId = await saveOpportunityStakeholder({
      opportunityId: id,
      stakeholderId: parsed.data.id,
      payload: {
        name: parsed.data.name,
        role_code: parsed.data.roleCode,
        role_label: parsed.data.roleLabel || null,
        influence_level: parsed.data.influenceLevel,
        support_level: parsed.data.supportLevel,
        status: parsed.data.status,
        priorities: parsed.data.priorities || null,
        concerns: parsed.data.concerns || null,
        next_action: parsed.data.nextAction || null,
        last_contact_at: parsed.data.lastContactAt || null,
      },
      userId: Number(req.user.id),
    });
    await logOpportunityWorkspaceMutation({
      req,
      opportunityId: id,
      action: parsed.data.id
        ? "workspace_stakeholder_updated"
        : "workspace_stakeholder_created",
      detail: `Stakeholder guardado: ${parsed.data.name}`,
      after: {
        id: savedId,
        name: parsed.data.name,
        supportLevel: parsed.data.supportLevel,
        status: parsed.data.status,
      },
    });
    await refreshOpportunityRecommendedStrategy({
      opportunityId: id,
      userId: Number(req.user.id),
    });
    return res.json({ id: savedId });
  },
);

router.post(
  "/:id/workspace/actions",
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Id de oportunidad invalido" });
    }
    const parsed = opportunityWorkspaceActionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Payload invalido", errors: parsed.error.flatten() });
    }
    const opportunityAccess = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId: id,
      message: "Oportunidad no encontrada",
    });
    if (!opportunityAccess.ok) {
      return res
        .status(opportunityAccess.response.status)
        .json(opportunityAccess.response.body);
    }
    const savedId = await saveOpportunityAction({
      opportunityId: id,
      actionId: parsed.data.id,
      payload: {
        title: parsed.data.title,
        action_type: parsed.data.actionType,
        status: parsed.data.status,
        priority: parsed.data.priority,
        linked_stage_id: parsed.data.linkedStageId || null,
        linked_theme_code: parsed.data.linkedThemeCode || null,
        linked_weakness_id: parsed.data.linkedWeaknessId || null,
        stakeholder_id: parsed.data.stakeholderId || null,
        owner_user_id: parsed.data.ownerUserId || null,
        due_date: parsed.data.dueDate || null,
        success_criteria: parsed.data.successCriteria || null,
        notes: parsed.data.notes || null,
      },
      userId: Number(req.user.id),
    });
    await logOpportunityWorkspaceMutation({
      req,
      opportunityId: id,
      action: parsed.data.id
        ? "workspace_action_updated"
        : "workspace_action_created",
      detail: `Accion guardada: ${parsed.data.title}`,
      after: {
        id: savedId,
        title: parsed.data.title,
        status: parsed.data.status,
        priority: parsed.data.priority,
      },
    });
    await refreshOpportunityRecommendedStrategy({
      opportunityId: id,
      userId: Number(req.user.id),
    });
    return res.json({ id: savedId });
  },
);

router.post(
  "/:id/workspace/deliverables",
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Id de oportunidad invalido" });
    }
    const parsed = opportunityWorkspaceDeliverableSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Payload invalido", errors: parsed.error.flatten() });
    }
    const opportunityAccess = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId: id,
      message: "Oportunidad no encontrada",
    });
    if (!opportunityAccess.ok) {
      return res
        .status(opportunityAccess.response.status)
        .json(opportunityAccess.response.body);
    }
    const savedId = await saveOpportunityDeliverable({
      opportunityId: id,
      deliverableId: parsed.data.id,
      payload: {
        deliverable_type: parsed.data.deliverableType,
        title: parsed.data.title,
        audience: parsed.data.audience || null,
        status: parsed.data.status,
        version_label: parsed.data.versionLabel || null,
        linked_stage_id: parsed.data.linkedStageId || null,
        sent_at: parsed.data.sentAt || null,
        outcome_summary: parsed.data.outcomeSummary || null,
        document_public_id: parsed.data.documentPublicId || null,
      },
      userId: Number(req.user.id),
    });
    await logOpportunityWorkspaceMutation({
      req,
      opportunityId: id,
      action: parsed.data.id
        ? "workspace_deliverable_updated"
        : "workspace_deliverable_created",
      detail: `Entregable guardado: ${parsed.data.title}`,
      after: {
        id: savedId,
        title: parsed.data.title,
        status: parsed.data.status,
        deliverableType: parsed.data.deliverableType,
      },
    });
    await refreshOpportunityRecommendedStrategy({
      opportunityId: id,
      userId: Number(req.user.id),
    });
    return res.json({ id: savedId });
  },
);

router.delete(
  "/:id/workspace/assessments/:criterionCode",
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const id = Number(req.params.id);
    const criterionCode = String(req.params.criterionCode || "").trim();
    if (!Number.isInteger(id) || id <= 0 || !criterionCode) {
      return res.status(400).json({ message: "Parametros invalidos" });
    }

    const opportunityAccess = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId: id,
      message: "Oportunidad no encontrada",
    });
    if (!opportunityAccess.ok) {
      return res
        .status(opportunityAccess.response.status)
        .json(opportunityAccess.response.body);
    }

    await deleteOpportunityCriterionAssessment({
      opportunityId: id,
      criterionCode,
    });
    await logOpportunityWorkspaceMutation({
      req,
      opportunityId: id,
      action: "workspace_assessment_deleted",
      detail: `Assessment eliminado: ${criterionCode}`,
      after: { criterionCode },
    });
    const opportunityState = await getOpportunityStateById(id);
    const stageView = await buildOpportunityStageView({
      opportunityState,
      selectedSalesStageId: Number(opportunityState.sales_stage_id),
      persistRecommendedStrategy: true,
      strategyUpdatedByUserId: Number(req.user.id),
    });
    return res.json({ workspace: stageView.workspace });
  },
);

router.delete(
  "/:id/workspace/weaknesses/:workspaceItemId",
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const id = Number(req.params.id);
    const workspaceItemId = Number(req.params.workspaceItemId);
    if (
      !Number.isInteger(id) ||
      id <= 0 ||
      !Number.isInteger(workspaceItemId)
    ) {
      return res.status(400).json({ message: "Parametros invalidos" });
    }
    const opportunityAccess = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId: id,
      message: "Oportunidad no encontrada",
    });
    if (!opportunityAccess.ok) {
      return res
        .status(opportunityAccess.response.status)
        .json(opportunityAccess.response.body);
    }
    await deleteOpportunityWeakness({
      opportunityId: id,
      weaknessId: workspaceItemId,
    });
    await logOpportunityWorkspaceMutation({
      req,
      opportunityId: id,
      action: "workspace_weakness_deleted",
      detail: `Debilidad eliminada: ${workspaceItemId}`,
      after: { weaknessId: workspaceItemId },
    });
    await refreshOpportunityRecommendedStrategy({
      opportunityId: id,
      userId: Number(req.user.id),
    });
    return res.json({ ok: true });
  },
);

router.delete(
  "/:id/workspace/themes/:workspaceItemId",
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const id = Number(req.params.id);
    const workspaceItemId = Number(req.params.workspaceItemId);
    if (
      !Number.isInteger(id) ||
      id <= 0 ||
      !Number.isInteger(workspaceItemId)
    ) {
      return res.status(400).json({ message: "Parametros invalidos" });
    }
    const opportunityAccess = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId: id,
      message: "Oportunidad no encontrada",
    });
    if (!opportunityAccess.ok) {
      return res
        .status(opportunityAccess.response.status)
        .json(opportunityAccess.response.body);
    }
    await deleteOpportunityThemeEntry({
      opportunityId: id,
      entryId: workspaceItemId,
    });
    await logOpportunityWorkspaceMutation({
      req,
      opportunityId: id,
      action: "workspace_theme_deleted",
      detail: `Claim tematico eliminado: ${workspaceItemId}`,
      after: { entryId: workspaceItemId },
    });
    await refreshOpportunityRecommendedStrategy({
      opportunityId: id,
      userId: Number(req.user.id),
    });
    return res.json({ ok: true });
  },
);

router.delete(
  "/:id/workspace/stakeholders/:workspaceItemId",
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const id = Number(req.params.id);
    const workspaceItemId = Number(req.params.workspaceItemId);
    if (
      !Number.isInteger(id) ||
      id <= 0 ||
      !Number.isInteger(workspaceItemId)
    ) {
      return res.status(400).json({ message: "Parametros invalidos" });
    }
    const opportunityAccess = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId: id,
      message: "Oportunidad no encontrada",
    });
    if (!opportunityAccess.ok) {
      return res
        .status(opportunityAccess.response.status)
        .json(opportunityAccess.response.body);
    }
    await deleteOpportunityStakeholder({
      opportunityId: id,
      stakeholderId: workspaceItemId,
    });
    await logOpportunityWorkspaceMutation({
      req,
      opportunityId: id,
      action: "workspace_stakeholder_deleted",
      detail: `Stakeholder eliminado: ${workspaceItemId}`,
      after: { stakeholderId: workspaceItemId },
    });
    await refreshOpportunityRecommendedStrategy({
      opportunityId: id,
      userId: Number(req.user.id),
    });
    return res.json({ ok: true });
  },
);

router.delete(
  "/:id/workspace/actions/:workspaceItemId",
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const id = Number(req.params.id);
    const workspaceItemId = Number(req.params.workspaceItemId);
    if (
      !Number.isInteger(id) ||
      id <= 0 ||
      !Number.isInteger(workspaceItemId)
    ) {
      return res.status(400).json({ message: "Parametros invalidos" });
    }
    const opportunityAccess = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId: id,
      message: "Oportunidad no encontrada",
    });
    if (!opportunityAccess.ok) {
      return res
        .status(opportunityAccess.response.status)
        .json(opportunityAccess.response.body);
    }
    await deleteOpportunityAction({
      opportunityId: id,
      actionId: workspaceItemId,
    });
    await logOpportunityWorkspaceMutation({
      req,
      opportunityId: id,
      action: "workspace_action_deleted",
      detail: `Accion eliminada: ${workspaceItemId}`,
      after: { actionId: workspaceItemId },
    });
    await refreshOpportunityRecommendedStrategy({
      opportunityId: id,
      userId: Number(req.user.id),
    });
    return res.json({ ok: true });
  },
);

router.delete(
  "/:id/workspace/deliverables/:workspaceItemId",
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const id = Number(req.params.id);
    const workspaceItemId = Number(req.params.workspaceItemId);
    if (
      !Number.isInteger(id) ||
      id <= 0 ||
      !Number.isInteger(workspaceItemId)
    ) {
      return res.status(400).json({ message: "Parametros invalidos" });
    }
    const opportunityAccess = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId: id,
      message: "Oportunidad no encontrada",
    });
    if (!opportunityAccess.ok) {
      return res
        .status(opportunityAccess.response.status)
        .json(opportunityAccess.response.body);
    }
    await deleteOpportunityDeliverable({
      opportunityId: id,
      deliverableId: workspaceItemId,
    });
    await logOpportunityWorkspaceMutation({
      req,
      opportunityId: id,
      action: "workspace_deliverable_deleted",
      detail: `Entregable eliminado: ${workspaceItemId}`,
      after: { deliverableId: workspaceItemId },
    });
    await refreshOpportunityRecommendedStrategy({
      opportunityId: id,
      userId: Number(req.user.id),
    });
    return res.json({ ok: true });
  },
);

router.post(
  "/:id/stage-view/:salesStageId/propose-answers/jobs",
  requirePermission("oportunidades.read"),
  async (req, res) => {
    const id = Number(req.params.id);
    const salesStageId = Number(req.params.salesStageId);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Id de oportunidad invalido" });
    }
    if (!Number.isInteger(salesStageId) || salesStageId <= 0) {
      return res.status(400).json({ message: "salesStageId invalido" });
    }

    const parsed = opportunityProposeAnswersJobSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Parametros invalidos para generar sugerencias documentales",
        errors: parsed.error.flatten(),
      });
    }

    if (!isOpportunityStageAnswerSuggestionsEnabled()) {
      return res.status(404).json({
        message:
          "Las sugerencias documentales de respuestas no estan habilitadas",
      });
    }

    await ensureOpportunityStageAnswerSuggestionJobSchema();

    const opportunityAccess = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId: id,
      message: "Oportunidad no encontrada",
    });
    if (!opportunityAccess.ok) {
      return res
        .status(opportunityAccess.response.status)
        .json(opportunityAccess.response.body);
    }

    try {
      const result = await createOrReuseOpportunityStageAnswerSuggestionJob({
        opportunityId: id,
        salesStageId,
        requestedByUserId: Number(req.user.id),
        forceRegenerate: Boolean(parsed.data.forceRegenerate),
      });

      if (!result.wasReused) {
        queueOpportunityStageAnswerSuggestionProcessing();
      } else if (result.response?.result) {
        const aiUsageRequestIds = await loadAiUsageRequestIdsForSuggestionJob(
          result.row?.id,
        );
        await logAuditEvent({
          req,
          module: "oportunidades",
          action: "stage_answer_suggestions_reused",
          entityType: "opportunity",
          entityId: id,
          detail: `Sugerencias IA reutilizadas para etapa ${String(result.response.result.salesStageName || salesStageId)}`,
          aiUsageRequestIds,
        });
      }

      return res
        .status(result.response?.result ? 200 : 202)
        .json(result.response);
    } catch (error) {
      const status = Number(error?.status || 500);
      const detail = getSanitizedInternalErrorDetail(error);
      return res.status(status).json({
        message:
          status === 404
            ? detail || "No fue posible preparar la generacion de sugerencias"
            : "No fue posible preparar la generacion de sugerencias documentales",
        ...(status >= 500 && detail ? { detail } : {}),
      });
    }
  },
);

router.get(
  "/:id/stage-view/:salesStageId/propose-answers/jobs/:jobId",
  requirePermission("oportunidades.read"),
  async (req, res) => {
    const id = Number(req.params.id);
    const salesStageId = Number(req.params.salesStageId);
    const jobId = String(req.params.jobId || "").trim();
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Id de oportunidad invalido" });
    }
    if (!Number.isInteger(salesStageId) || salesStageId <= 0) {
      return res.status(400).json({ message: "salesStageId invalido" });
    }
    if (!jobId) {
      return res.status(400).json({ message: "jobId invalido" });
    }

    await ensureOpportunityStageAnswerSuggestionJobSchema();

    const opportunityAccess = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId: id,
      message: "Oportunidad no encontrada",
    });
    if (!opportunityAccess.ok) {
      return res
        .status(opportunityAccess.response.status)
        .json(opportunityAccess.response.body);
    }

    const job = await getOpportunityStageAnswerSuggestionJob({
      publicId: jobId,
      opportunityId: id,
      salesStageId,
    });
    if (!job) {
      return res.status(404).json({ message: "Job no encontrado" });
    }

    return res.json(job);
  },
);

router.post(
  "/:id/stage-view/:salesStageId/propose-answers",
  requirePermission("oportunidades.read"),
  async (req, res) => {
    const id = Number(req.params.id);
    const salesStageId = Number(req.params.salesStageId);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Id de oportunidad invalido" });
    }
    if (!Number.isInteger(salesStageId) || salesStageId <= 0) {
      return res.status(400).json({ message: "salesStageId invalido" });
    }
    if (!isOpportunityStageAnswerSuggestionsEnabled()) {
      return res.status(404).json({
        message:
          "Las sugerencias documentales de respuestas no estan habilitadas",
      });
    }

    const opportunityAccess = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId: id,
      message: "Oportunidad no encontrada",
    });
    if (!opportunityAccess.ok) {
      return res
        .status(opportunityAccess.response.status)
        .json(opportunityAccess.response.body);
    }

    const opportunityState = await getOpportunityStateById(id);
    if (!opportunityState) {
      return res.status(404).json({ message: "Oportunidad no encontrada" });
    }

    const salesStage = await getOpportunitySalesStageById(salesStageId);
    if (!salesStage) {
      return res.status(404).json({ message: "Etapa de venta no encontrada" });
    }

    const questions = await getOpportunityStageQuestions(salesStageId);
    if (!questions.length) {
      return res.json({
        salesStageId,
        salesStageName: salesStage.name,
        suggestions: [],
      });
    }

    try {
      const aiUsageRequestIds = [];
      const [existingAnswers, documents] = await Promise.all([
        getLatestOpportunityStageAnswers({
          opportunityId: id,
          salesStageId,
        }),
        listOpportunityDocuments({ opportunityId: id }),
      ]);

      const result = await suggestOpportunityStageAnswers({
        salesStage,
        questions,
        existingAnswers,
        documents,
        aiUsageContext: {
          userId: Number(req.user.id),
          featureCode: "opportunities.stage_suggestions",
          jobType: "opportunity_stage_answers_sync",
          jobId: null,
          aiUsageRequestIds,
        },
      });

      await logAuditEvent({
        req,
        module: "oportunidades",
        action: "stage_answer_suggestions_generated",
        entityType: "opportunity",
        entityId: id,
        detail: `Sugerencias IA generadas para etapa ${String(salesStage.name || salesStageId)}`,
        aiUsageRequestIds,
      });

      return res.json({
        salesStageId,
        salesStageName: salesStage.name,
        suggestions: result.suggestions,
        summary: result.summary,
        meta: result.meta,
      });
    } catch (error) {
      const detail = getSanitizedInternalErrorDetail(error);
      return res.status(500).json({
        message:
          "No fue posible proponer respuestas documentales para la etapa seleccionada",
        ...(detail ? { detail } : {}),
      });
    }
  },
);

router.get(
  "/:id",
  requirePermission("oportunidades.read"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Id de oportunidad invalido" });
    }

    const params = [];
    const ownershipJoin = applyOwnedAccountScope({
      user: req.user,
      accountExpression: "o.account_id",
      params,
    });
    params.push(id);

    const rows = await query(
      `SELECT o.*, a.name AS account_name,
              CONCAT(c.first_name, ' ', c.last_name) AS contact_name,
              oss.name AS sales_stage,
              oss.code AS sales_stage_code,
              ocs.name AS commercial_status,
              ocs.code AS commercial_status_code,
              obl.name AS business_line,
              su.full_name AS seller_user_name,
              pu.full_name AS presales_user_name,
              oas.name AS activation_status,
              u1.full_name AS created_by_name,
              u2.full_name AS updated_by_name
       FROM opportunities o
            ${ownershipJoin}
       INNER JOIN accounts a ON a.id = o.account_id
       INNER JOIN contacts c ON c.id = o.contact_id
       INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
      INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
       INNER JOIN opportunity_business_lines obl ON obl.id = o.business_line_id
       LEFT JOIN users su ON su.id = o.seller_user_id
       LEFT JOIN users pu ON pu.id = o.presales_user_id
       INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
       INNER JOIN users u1 ON u1.id = o.created_by
       INNER JOIN users u2 ON u2.id = o.updated_by
       WHERE o.id = ?`,
      params,
    );

    if (!rows.length) {
      return res.status(404).json({ message: "Oportunidad no encontrada" });
    }

    res.json(rows[0]);
  },
);

router.post(
  "/",
  requireAnyPermission(opportunityCreatePermissions),
  async (req, res) => {
    const parsed = opportunityCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const body = parsed.data;
    const relationValidation = await validateOpportunityRelations({
      user: req.user,
      ...body,
    });
    if (!relationValidation.ok) {
      return res
        .status(relationValidation.status)
        .json({ message: relationValidation.message });
    }

    const now = new Date();
    const creationStatusCode = await resolveOpportunityCreationStatusCode(
      req.user,
    );
    const activationStatusId = creationStatusCode
      ? await getOpportunityActivationStatusId(creationStatusCode)
      : null;
    const initialStage =
      await getOpportunitySalesStageByCode("contacto_inicial");
    const initialCommercialStatusId =
      await getOpportunityCommercialStatusId("en_proceso");

    if (
      !activationStatusId ||
      !initialStage?.id ||
      !initialCommercialStatusId
    ) {
      return res.status(403).json({
        message: !activationStatusId
          ? "No autorizado"
          : "Configuracion incompleta del proceso comercial",
      });
    }

    try {
      if (body.uploadSessionPublicId) {
        await ensureOpportunityDocumentSchema();
      }
      const opportunityId = await withTransaction(async (conn) => {
        const [insertResult] = await conn.query(
          `INSERT INTO opportunities
            (name, amount_usd, account_id, close_date, contact_id,
             sales_stage_id, business_line_id, seller_user_id, presales_user_id, activation_status_id,
             commercial_status_id, created_by, created_at, updated_by, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            body.name,
            body.amountUsd,
            body.accountId,
            body.closeDate,
            body.contactId,
            Number(initialStage.id),
            body.businessLineId,
            body.sellerUserId,
            body.presalesUserId || null,
            activationStatusId,
            initialCommercialStatusId,
            req.user.id,
            now,
            req.user.id,
            now,
          ],
        );

        if (body.uploadSessionPublicId) {
          await transferUploadSessionToOpportunity({
            conn,
            sessionPublicId: body.uploadSessionPublicId,
            opportunityId: insertResult.insertId,
            userId: req.user.id,
          });
        }

        return insertResult.insertId;
      });

      await logAuditEvent({
        req,
        module: "oportunidades",
        action: "created",
        entityType: "opportunity",
        entityId: opportunityId,
        detail: "Oportunidad creada",
        after: {
          name: body.name,
          amount_usd: body.amountUsd,
          account_id: body.accountId,
          close_date: body.closeDate,
          contact_id: body.contactId,
          sales_stage_id: Number(initialStage.id),
          business_line_id: body.businessLineId,
          seller_user_id: body.sellerUserId,
          presales_user_id: body.presalesUserId || null,
          activation_status_id: activationStatusId,
          commercial_status_id: initialCommercialStatusId,
          upload_session_public_id: body.uploadSessionPublicId || null,
        },
      });

      return res.status(201).json({
        id: opportunityId,
        message:
          creationStatusCode === "activada"
            ? "Oportunidad creada"
            : "Solicitud de oportunidad creada en estado pendiente",
      });
    } catch (error) {
      return res
        .status(500)
        .json({ message: "No fue posible crear la oportunidad" });
    }
  },
);

router.put(
  "/:id",
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Id de oportunidad invalido" });
    }

    const parsed = opportunityUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const body = parsed.data;
    const opportunityAccess = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId: id,
      message: "Oportunidad no encontrada",
    });
    if (!opportunityAccess.ok) {
      return res
        .status(opportunityAccess.response.status)
        .json(opportunityAccess.response.body);
    }

    const beforeRows = await query(
      "SELECT * FROM opportunities WHERE id = ? LIMIT 1",
      [id],
    );
    if (!beforeRows.length) {
      return res.status(404).json({ message: "Oportunidad no encontrada" });
    }

    const previousStatusCode = await getOpportunityActivationStatusCodeById(
      Number(beforeRows[0].activation_status_id),
    );
    const requestedStatusCode = await getOpportunityActivationStatusCodeById(
      Number(body.activationStatusId),
    );

    if (!requestedStatusCode) {
      return res.status(400).json({ message: "Estado de activacion invalido" });
    }

    let effectiveActivationStatusId = Number(body.activationStatusId);
    let effectiveRequestedStatusCode = requestedStatusCode;

    if (
      requestedStatusCode === "pendiente_activacion" &&
      requestedStatusCode !== previousStatusCode &&
      !(await ensurePendingOpportunityStatusAllowed())
    ) {
      effectiveActivationStatusId = Number(beforeRows[0].activation_status_id);
      effectiveRequestedStatusCode = previousStatusCode;
    }

    if (
      effectiveRequestedStatusCode !== previousStatusCode &&
      !canChangeOpportunityActivationStatus(req.user)
    ) {
      return res.status(403).json({
        message:
          "No autorizado para cambiar el estado de activacion de oportunidades",
      });
    }

    const requestedSalesStageId = body.salesStageId
      ? Number(body.salesStageId)
      : Number(beforeRows[0].sales_stage_id);
    const previousSalesStageId = Number(beforeRows[0].sales_stage_id);
    const hasStageChange = requestedSalesStageId !== previousSalesStageId;
    const previousCommercialStatusCode =
      await getOpportunityCommercialStatusCodeById(
        Number(beforeRows[0].commercial_status_id),
      );
    const requestedCommercialStatusCode = body.commercialStatusCode
      ? String(body.commercialStatusCode)
      : previousCommercialStatusCode;
    const hasCommercialCloseChange =
      Boolean(body.commercialStatusCode) &&
      requestedCommercialStatusCode !== previousCommercialStatusCode;

    let stageChangeAction = null;
    let stageChangeReason = String(body.stageChangeReason || "").trim();
    let commercialStatusId = Number(beforeRows[0].commercial_status_id);
    let commercialCloseReason = String(body.commercialCloseReason || "").trim();
    let commercialClosedAt = beforeRows[0].commercial_closed_at || null;
    if (hasStageChange) {
      const opportunityState = await getOpportunityStateById(id);
      if (!opportunityState) {
        return res.status(404).json({ message: "Oportunidad no encontrada" });
      }

      if (isClosedCommercialStatus(opportunityState.commercial_status_code)) {
        return res.status(400).json({
          message: "No puedes cambiar la etapa de una oportunidad cerrada",
        });
      }

      const stages = await getActiveOpportunityStages();
      const currentStageIndex = stages.findIndex(
        (stage) => Number(stage.id) === previousSalesStageId,
      );
      const requestedStageIndex = stages.findIndex(
        (stage) => Number(stage.id) === requestedSalesStageId,
      );

      if (currentStageIndex === -1 || requestedStageIndex === -1) {
        return res.status(400).json({
          message: "La etapa solicitada no es valida",
        });
      }

      const stageDelta = requestedStageIndex - currentStageIndex;
      if (stageDelta === 0) {
        return res.status(400).json({
          message: "No hay un cambio de etapa para guardar",
        });
      }

      if (stageDelta > 1) {
        return res.status(400).json({
          message:
            "Solo puedes avanzar una etapa por vez; el retroceso puede ir a cualquier etapa anterior",
        });
      }

      if (!body.stageChangeMode) {
        return res.status(400).json({
          message:
            "Debes usar una accion de etapa valida antes de guardar cambios",
        });
      }

      if (stageDelta === 1) {
        if (body.stageChangeMode === "advance") {
          const requiredAnswersValidation =
            await validateRequiredCurrentStageAnswers({
              opportunityId: id,
              salesStageId: previousSalesStageId,
            });
          if (!requiredAnswersValidation.ok) {
            return res
              .status(400)
              .json({ message: requiredAnswersValidation.message });
          }
          stageChangeAction = "stage_advanced";
        } else if (body.stageChangeMode === "bypass") {
          if (!stageChangeReason) {
            return res.status(400).json({
              message: "Debes indicar un motivo para bypasear la etapa",
            });
          }
          stageChangeAction = "stage_bypassed";
        } else {
          return res.status(400).json({
            message:
              "La accion seleccionada no coincide con el cambio de etapa",
          });
        }
      } else {
        if (body.stageChangeMode !== "retreat") {
          return res.status(400).json({
            message:
              "La accion seleccionada no coincide con el cambio de etapa",
          });
        }
        stageChangeAction = "stage_retreated";
      }
    }

    if (hasCommercialCloseChange) {
      if (hasStageChange) {
        return res.status(400).json({
          message:
            "Guarda el cambio de etapa pendiente antes de cerrar comercialmente la oportunidad",
        });
      }

      if (isClosedCommercialStatus(previousCommercialStatusCode)) {
        return res.status(400).json({
          message: "La oportunidad ya tiene un cierre comercial definitivo",
        });
      }

      if (!commercialCloseReason) {
        return res.status(400).json({
          message: "Debes indicar un motivo para cerrar la oportunidad",
        });
      }

      commercialStatusId = await getOpportunityCommercialStatusId(
        requestedCommercialStatusCode,
      );
      if (!commercialStatusId) {
        return res.status(400).json({
          message: "Estado comercial invalido",
        });
      }

      commercialClosedAt = new Date();
    }

    const relationValidation = await validateOpportunityRelations({
      user: req.user,
      ...body,
    });
    if (!relationValidation.ok) {
      return res
        .status(relationValidation.status)
        .json({ message: relationValidation.message });
    }

    const now = new Date();
    await query(
      `UPDATE opportunities
       SET name = ?, amount_usd = ?, account_id = ?, close_date = ?, contact_id = ?,
           sales_stage_id = ?, business_line_id = ?, seller_user_id = ?,
           presales_user_id = ?, activation_status_id = ?, commercial_status_id = ?,
           commercial_closed_at = ?, commercial_close_reason = ?, updated_by = ?, updated_at = ?
       WHERE id = ?`,
      [
        body.name,
        body.amountUsd,
        body.accountId,
        body.closeDate,
        body.contactId,
        requestedSalesStageId,
        body.businessLineId,
        body.sellerUserId,
        body.presalesUserId || null,
        effectiveActivationStatusId,
        commercialStatusId,
        commercialClosedAt,
        hasCommercialCloseChange
          ? commercialCloseReason || null
          : beforeRows[0].commercial_close_reason,
        req.user.id,
        now,
        id,
      ],
    );

    const afterRows = await query(
      "SELECT * FROM opportunities WHERE id = ? LIMIT 1",
      [id],
    );
    await logAuditEvent({
      req,
      module: "oportunidades",
      action: "updated",
      entityType: "opportunity",
      entityId: id,
      detail: "Oportunidad actualizada",
      before: beforeRows[0],
      after: afterRows[0],
    });

    if (hasStageChange && stageChangeAction) {
      await logAuditEvent({
        req,
        module: "oportunidades",
        action: stageChangeAction,
        entityType: "opportunity",
        entityId: id,
        detail:
          stageChangeAction === "stage_bypassed"
            ? "Etapa de oportunidad bypaseada"
            : stageChangeAction === "stage_advanced"
              ? "Etapa de oportunidad avanzada"
              : "Etapa de oportunidad retrocedida",
        before: { sales_stage_id: previousSalesStageId },
        after: {
          sales_stage_id: requestedSalesStageId,
          stage_change_reason: stageChangeReason || null,
        },
      });
    }

    if (hasCommercialCloseChange) {
      await logAuditEvent({
        req,
        module: "oportunidades",
        action: "commercial_closed",
        entityType: "opportunity",
        entityId: id,
        detail: `Oportunidad cerrada como ${requestedCommercialStatusCode}`,
        before: {
          commercial_status_id: Number(beforeRows[0].commercial_status_id),
          commercial_close_reason: beforeRows[0].commercial_close_reason,
        },
        after: {
          commercial_status_id: commercialStatusId,
          commercial_close_reason: commercialCloseReason || null,
        },
      });
    }

    if (hasStageChange || hasCommercialCloseChange) {
      refreshOpportunityRecommendedStrategy({
        opportunityId: id,
        selectedSalesStageId: requestedSalesStageId,
        userId: Number(req.user.id),
      }).catch((err) => {
        console.error(
          "[opportunities] refreshOpportunityRecommendedStrategy failed:",
          err,
        );
      });
    }

    res.json({
      message: hasCommercialCloseChange
        ? `Oportunidad cerrada como ${requestedCommercialStatusCode}`
        : "Oportunidad actualizada",
    });
  },
);

router.post(
  "/:id/stage-answers",
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Id de oportunidad invalido" });
    }

    const parsed = opportunityStageAnswersSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const opportunityAccess = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId: id,
      message: "Oportunidad no encontrada",
    });
    if (!opportunityAccess.ok) {
      return res
        .status(opportunityAccess.response.status)
        .json(opportunityAccess.response.body);
    }

    const opportunityState = await getOpportunityStateById(id);
    if (!opportunityState) {
      return res.status(404).json({ message: "Oportunidad no encontrada" });
    }

    if (isClosedCommercialStatus(opportunityState.commercial_status_code)) {
      return res.status(400).json({
        message: "No puedes registrar respuestas en una oportunidad cerrada",
      });
    }

    const stageQuestions = await getOpportunityStageQuestions(
      Number(opportunityState.sales_stage_id),
    );
    const stageQuestionsById = new Map(
      stageQuestions.map((question) => [Number(question.id), question]),
    );

    const questionIds = parsed.data.answers.map((answer) => answer.questionId);
    const uniqueQuestionIds = new Set(questionIds);
    if (uniqueQuestionIds.size !== questionIds.length) {
      return res.status(400).json({
        message:
          "No puedes enviar respuestas duplicadas para la misma pregunta",
      });
    }

    for (const answer of parsed.data.answers) {
      if (!stageQuestionsById.has(Number(answer.questionId))) {
        return res.status(400).json({
          message: "Hay preguntas que no pertenecen a la etapa actual",
        });
      }
    }

    const now = new Date();
    for (const answer of parsed.data.answers) {
      const question = stageQuestionsById.get(Number(answer.questionId));
      await query(
        `INSERT INTO opportunity_stage_question_answers
          (opportunity_id, sales_stage_id, question_id, question_code_snapshot,
           question_prompt_snapshot, answer_value, answered_by_user_id, answered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          Number(opportunityState.sales_stage_id),
          Number(question.id),
          String(question.code),
          String(question.prompt),
          answer.answerValue,
          req.user.id,
          now,
        ],
      );
    }

    await logAuditEvent({
      req,
      module: "oportunidades",
      action: "stage_answers_saved",
      entityType: "opportunity",
      entityId: id,
      detail: "Respuestas de etapa guardadas",
      after: {
        sales_stage_id: Number(opportunityState.sales_stage_id),
        answers_count: parsed.data.answers.length,
      },
    });

    await refreshOpportunityRecommendedStrategy({
      opportunityId: id,
      selectedSalesStageId: Number(opportunityState.sales_stage_id),
      userId: Number(req.user.id),
    });

    return res.json({ message: "Respuestas guardadas" });
  },
);

router.post(
  "/:id/stage-transition",
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Id de oportunidad invalido" });
    }

    const parsed = opportunityStageTransitionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const opportunityAccess = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId: id,
      message: "Oportunidad no encontrada",
    });
    if (!opportunityAccess.ok) {
      return res
        .status(opportunityAccess.response.status)
        .json(opportunityAccess.response.body);
    }

    const opportunityState = await getOpportunityStateById(id);
    if (!opportunityState) {
      return res.status(404).json({ message: "Oportunidad no encontrada" });
    }

    if (isClosedCommercialStatus(opportunityState.commercial_status_code)) {
      return res.status(400).json({
        message: "No puedes mover de etapa una oportunidad cerrada",
      });
    }

    let targetStage = null;
    if (parsed.data.direction === "advance") {
      const requiredAnswersValidation =
        await validateRequiredCurrentStageAnswers({
          opportunityId: id,
          salesStageId: Number(opportunityState.sales_stage_id),
        });
      if (!requiredAnswersValidation.ok) {
        return res
          .status(400)
          .json({ message: requiredAnswersValidation.message });
      }
    } else {
      targetStage = null;
    }

    const stageResolution = await getAdjacentOpportunityStage({
      salesStageId: Number(opportunityState.sales_stage_id),
      direction: parsed.data.direction,
    });
    if (!stageResolution.ok) {
      return res.status(400).json({ message: stageResolution.message });
    }
    targetStage = stageResolution.targetStage;

    const now = new Date();
    await query(
      `UPDATE opportunities
       SET sales_stage_id = ?, updated_by = ?, updated_at = ?
       WHERE id = ?`,
      [Number(targetStage.id), req.user.id, now, id],
    );

    await logAuditEvent({
      req,
      module: "oportunidades",
      action:
        parsed.data.direction === "advance"
          ? "stage_advanced"
          : "stage_retreated",
      entityType: "opportunity",
      entityId: id,
      detail:
        parsed.data.direction === "advance"
          ? "Etapa de oportunidad avanzada"
          : "Etapa de oportunidad retrocedida",
      before: { sales_stage_id: Number(opportunityState.sales_stage_id) },
      after: { sales_stage_id: Number(targetStage.id) },
    });

    await refreshOpportunityRecommendedStrategy({
      opportunityId: id,
      selectedSalesStageId: Number(targetStage.id),
      userId: Number(req.user.id),
    });

    return res.json({
      message:
        parsed.data.direction === "advance"
          ? "Etapa avanzada"
          : "Etapa retrocedida",
      salesStageId: Number(targetStage.id),
      salesStageCode: String(targetStage.code),
    });
  },
);

router.post(
  "/:id/commercial-close",
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Id de oportunidad invalido" });
    }

    const parsed = opportunityCommercialCloseSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const opportunityAccess = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId: id,
      message: "Oportunidad no encontrada",
    });
    if (!opportunityAccess.ok) {
      return res
        .status(opportunityAccess.response.status)
        .json(opportunityAccess.response.body);
    }

    const opportunityState = await getOpportunityStateById(id);
    if (!opportunityState) {
      return res.status(404).json({ message: "Oportunidad no encontrada" });
    }

    if (isClosedCommercialStatus(opportunityState.commercial_status_code)) {
      return res.status(400).json({
        message: "La oportunidad ya tiene un cierre comercial definitivo",
      });
    }

    if (
      parsed.data.statusCode === "ganada" &&
      String(opportunityState.sales_stage_code) !== "waiting"
    ) {
      return res.status(400).json({
        message: "Solo puedes marcar como ganada una oportunidad en Waiting",
      });
    }

    const closeReason = String(parsed.data.reason || "").trim();
    if (
      (parsed.data.statusCode === "perdida" ||
        parsed.data.statusCode === "anulada") &&
      !closeReason
    ) {
      return res.status(400).json({
        message: "Debes indicar un motivo para cerrar la oportunidad",
      });
    }

    const commercialStatusId = await getOpportunityCommercialStatusId(
      parsed.data.statusCode,
    );
    if (!commercialStatusId) {
      return res.status(400).json({ message: "Estado comercial invalido" });
    }

    const now = new Date();
    await query(
      `UPDATE opportunities
       SET commercial_status_id = ?, commercial_closed_at = ?,
           commercial_close_reason = ?, updated_by = ?, updated_at = ?
       WHERE id = ?`,
      [commercialStatusId, now, closeReason || null, req.user.id, now, id],
    );

    await logAuditEvent({
      req,
      module: "oportunidades",
      action: "commercial_closed",
      entityType: "opportunity",
      entityId: id,
      detail: "Oportunidad cerrada comercialmente",
      before: {
        commercial_status_id: Number(opportunityState.commercial_status_id),
        commercial_close_reason: opportunityState.commercial_close_reason,
      },
      after: {
        commercial_status_id: commercialStatusId,
        commercial_close_reason: closeReason || null,
      },
    });

    await refreshOpportunityRecommendedStrategy({
      opportunityId: id,
      selectedSalesStageId: Number(opportunityState.sales_stage_id),
      userId: Number(req.user.id),
    });

    return res.json({
      message: `Oportunidad cerrada como ${parsed.data.statusCode}`,
    });
  },
);

router.post(
  "/:id/validate-current-stage/jobs",
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Id de oportunidad invalido" });
    }

    const parsed = opportunityStageValidationSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    await ensureOpportunityStageValidationJobSchema();

    const opportunityAccess = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId: id,
      message: "Oportunidad no encontrada",
    });
    if (!opportunityAccess.ok) {
      return res
        .status(opportunityAccess.response.status)
        .json(opportunityAccess.response.body);
    }

    try {
      const result = await createOrReuseOpportunityStageValidationJob({
        opportunityId: id,
        requestedByUserId: Number(req.user.id),
        note: parsed.data.note,
      });

      if (!result.wasReused) {
        queueOpportunityStageValidationProcessing();
      }

      return res.status(202).json(result.response);
    } catch (error) {
      const status = Number(error?.status || 500);
      if (error?.body) {
        return res.status(status).json(error.body);
      }
      const detail = getSanitizedInternalErrorDetail(error);
      return res.status(status).json({
        message: "No fue posible preparar la validacion de la etapa",
        ...(status >= 500 && detail ? { detail } : {}),
      });
    }
  },
);

router.get(
  "/:id/validate-current-stage/jobs/:jobId",
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const id = Number(req.params.id);
    const jobId = String(req.params.jobId || "").trim();
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Id de oportunidad invalido" });
    }
    if (!jobId) {
      return res.status(400).json({ message: "jobId invalido" });
    }

    await ensureOpportunityStageValidationJobSchema();

    const opportunityAccess = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId: id,
      message: "Oportunidad no encontrada",
    });
    if (!opportunityAccess.ok) {
      return res
        .status(opportunityAccess.response.status)
        .json(opportunityAccess.response.body);
    }

    const job = await getOpportunityStageValidationJob({
      publicId: jobId,
      opportunityId: id,
    });
    if (!job) {
      return res.status(404).json({ message: "Job no encontrado" });
    }

    return res.json(job);
  },
);

router.post(
  "/:id/validate-current-stage",
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Id de oportunidad invalido" });
    }

    const parsed = opportunityStageValidationSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const opportunityAccess = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId: id,
      message: "Oportunidad no encontrada",
    });
    if (!opportunityAccess.ok) {
      return res
        .status(opportunityAccess.response.status)
        .json(opportunityAccess.response.body);
    }

    try {
      const result = await executeOpportunityCurrentStageValidation({
        opportunityId: id,
        note: parsed.data.note,
        user: req.user,
        req,
      });
      return res.json(result);
    } catch (error) {
      if (error?.status && error?.body) {
        return res.status(error.status).json(error.body);
      }
      throw error;
    }
  },
);

router.post(
  "/:id/stage-bypass",
  requireAnyPermission([
    opportunityBypassStageValidationPermission,
    opportunityBypassDemonstrationValidationPermission,
  ]),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Id de oportunidad invalido" });
    }

    const parsed = opportunityStageBypassSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const opportunityAccess = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId: id,
      message: "Oportunidad no encontrada",
    });
    if (!opportunityAccess.ok) {
      return res
        .status(opportunityAccess.response.status)
        .json(opportunityAccess.response.body);
    }

    const opportunityState = await getOpportunityStateById(id);
    if (!opportunityState) {
      return res.status(404).json({ message: "Oportunidad no encontrada" });
    }

    if (isClosedCommercialStatus(opportunityState.commercial_status_code)) {
      return res.status(400).json({
        message: "No puedes bypasear la etapa de una oportunidad cerrada",
      });
    }

    if (
      !canBypassCurrentOpportunityStage({
        user: req.user,
        currentStageCode: opportunityState.sales_stage_code,
      })
    ) {
      return res.status(403).json({
        message:
          "No autorizado: este permiso solo permite bypasear la etapa de Demostracion",
        requiredPermission: opportunityBypassDemonstrationValidationPermission,
      });
    }

    const stageResolution = await getAdjacentOpportunityStage({
      salesStageId: Number(opportunityState.sales_stage_id),
      direction: "advance",
    });
    if (!stageResolution.ok) {
      return res.status(400).json({ message: stageResolution.message });
    }

    const targetStage = stageResolution.targetStage;
    const now = new Date();
    await query(
      `UPDATE opportunities
       SET sales_stage_id = ?, updated_by = ?, updated_at = ?
       WHERE id = ?`,
      [Number(targetStage.id), req.user.id, now, id],
    );

    await logAuditEvent({
      req,
      module: "oportunidades",
      action: "stage_bypassed",
      entityType: "opportunity",
      entityId: id,
      detail: "Etapa actual bypaseada manualmente",
      before: {
        sales_stage_id: Number(opportunityState.sales_stage_id),
      },
      after: {
        sales_stage_id: Number(targetStage.id),
        bypass_reason: parsed.data.reason,
      },
    });

    await refreshOpportunityRecommendedStrategy({
      opportunityId: id,
      selectedSalesStageId: Number(targetStage.id),
      userId: Number(req.user.id),
    });

    return res.json({
      message: `Etapa bypaseada hacia ${targetStage.name}`,
      salesStageId: Number(targetStage.id),
      salesStageCode: String(targetStage.code),
    });
  },
);

router.patch(
  "/:id/status",
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Id de oportunidad invalido" });
    }

    const parsed = opportunityStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const statusRows = await query(
      "SELECT id FROM opportunity_activation_statuses WHERE code = ? LIMIT 1",
      [parsed.data.statusCode],
    );
    if (!statusRows.length) {
      return res.status(400).json({ message: "Estado de activacion invalido" });
    }

    if (
      parsed.data.statusCode === "pendiente_activacion" &&
      !(await ensurePendingOpportunityStatusAllowed())
    ) {
      return res.status(400).json({
        message: "El estado pendiente no esta habilitado para oportunidades",
      });
    }

    if (!canChangeOpportunityActivationStatus(req.user)) {
      return res.status(403).json({
        message:
          "No autorizado para cambiar el estado de activacion de oportunidades",
      });
    }

    const opportunityAccess = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId: id,
      message: "Oportunidad no encontrada",
    });
    if (!opportunityAccess.ok) {
      return res
        .status(opportunityAccess.response.status)
        .json(opportunityAccess.response.body);
    }

    const beforeRows = await query(
      "SELECT activation_status_id FROM opportunities WHERE id = ? LIMIT 1",
      [id],
    );
    if (!beforeRows.length) {
      return res.status(404).json({ message: "Oportunidad no encontrada" });
    }

    const previousStatusCode = await getOpportunityActivationStatusCodeById(
      Number(beforeRows[0].activation_status_id),
    );

    if (
      parsed.data.statusCode === "pendiente_activacion" &&
      parsed.data.statusCode !== previousStatusCode &&
      !(await ensurePendingOpportunityStatusAllowed())
    ) {
      return res.status(400).json({
        message: "El estado pendiente no esta habilitado para oportunidades",
      });
    }

    const now = new Date();
    await query(
      `UPDATE opportunities
       SET activation_status_id = ?, updated_by = ?, updated_at = ?
       WHERE id = ?`,
      [statusRows[0].id, req.user.id, now, id],
    );

    if (parsed.data.statusCode === "desactivada") {
      await rollbackLeadOpportunityOnDeactivation({
        opportunityId: id,
        userId: Number(req.user.id),
      });
    }

    await logAuditEvent({
      req,
      module: "oportunidades",
      action: "status_changed",
      entityType: "opportunity",
      entityId: id,
      detail: "Estado de oportunidad actualizado",
      before: {
        activation_status_id: Number(beforeRows[0].activation_status_id),
      },
      after: { activation_status_id: Number(statusRows[0].id) },
    });

    const messageByCode = {
      activada: "Oportunidad activada",
      desactivada: "Oportunidad desactivada",
      pendiente_activacion: "Oportunidad marcada como pendiente de activacion",
    };

    return res.json({
      message: messageByCode[parsed.data.statusCode] || "Estado actualizado",
    });
  },
);

export default router;
