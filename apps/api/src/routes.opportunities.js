import express from "express";
import { z } from "zod";
import { config } from "./config.js";
import { query, withTransaction } from "./db.js";
import { requireAnyPermission, requirePermission } from "./auth.js";
import { logAuditEvent } from "./audit.js";
import {
  applyUploadSessionToDraft,
  createUploadSession,
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
import {
  isOpportunityStageAnswerSuggestionsEnabled,
  suggestOpportunityStageAnswers,
  validateOpportunityCurrentStageWithAi,
} from "./opportunityStageAnswerSuggestions.js";

const router = express.Router();

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

const opportunityCreatePermissions = [
  "oportunidades.create",
  "oportunidades.request",
];
const opportunityGlobalReadPermission = "oportunidades.read_all";

function hasGlobalAccountReadScope(user) {
  return user?.permissionSet?.has(opportunityGlobalReadPermission);
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

function canChangeOpportunityActivationStatus(user) {
  return hasExplicitOpportunityPermission(user, "oportunidades.create");
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
       AND JSON_EXTRACT(changed_fields, '$.sales_stage_id.after') = CAST(? AS JSON)
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
}) {
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
  const isClosed = isClosedCommercialStatus(
    opportunityState.commercial_status_code,
  );

  return {
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

function resolveOpportunityCreationStatusCode(user) {
  if (hasExplicitOpportunityPermission(user, "oportunidades.create")) {
    return "activada";
  }
  if (hasExplicitOpportunityPermission(user, "oportunidades.request")) {
    return "pendiente_activacion";
  }
  return null;
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

  const sellerRows = await query(
    `SELECT u.id
     FROM users u
     INNER JOIN user_roles ur ON ur.user_id = u.id
     INNER JOIN roles r ON r.id = ur.role_id
     WHERE u.id = ?
       AND u.status = 'active'
       AND LOWER(TRIM(r.name)) = 'vendedor'
     LIMIT 1`,
    [sellerUserId],
  );

  if (!sellerRows.length) {
    return {
      ok: false,
      status: 400,
      message: "El vendedor debe tener rol de vendedor",
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
    });
    if (!stageView) {
      return res.status(404).json({ message: "Etapa de venta no encontrada" });
    }

    return res.json(stageView);
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
      });

      return res.json({
        salesStageId,
        salesStageName: salesStage.name,
        suggestions: result.suggestions,
        summary: result.summary,
        meta: result.meta,
      });
    } catch (error) {
      return res.status(500).json({
        message:
          "No fue posible proponer respuestas documentales para la etapa seleccionada",
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
    const creationStatusCode = resolveOpportunityCreationStatusCode(req.user);
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
          ? "No autorizado para crear o solicitar oportunidades"
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

    if (
      requestedStatusCode !== previousStatusCode &&
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
        body.activationStatusId,
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

    return res.json({
      message: `Oportunidad cerrada como ${parsed.data.statusCode}`,
    });
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

    const opportunityState = await getOpportunityStateById(id);
    if (!opportunityState) {
      return res.status(404).json({ message: "Oportunidad no encontrada" });
    }

    if (isClosedCommercialStatus(opportunityState.commercial_status_code)) {
      return res.status(400).json({
        message: "No puedes validar una etapa de una oportunidad cerrada",
      });
    }

    if (!isOpportunityStageAnswerSuggestionsEnabled()) {
      return res.status(404).json({
        message: "La validacion de etapas con IA no esta habilitada",
      });
    }

    const salesStage = await getOpportunitySalesStageById(
      Number(opportunityState.sales_stage_id),
    );
    if (!salesStage) {
      return res.status(404).json({ message: "Etapa de venta no encontrada" });
    }

    const [currentAnswers, documents] = await Promise.all([
      getLatestOpportunityStageAnswers({
        opportunityId: id,
        salesStageId: Number(opportunityState.sales_stage_id),
      }),
      listOpportunityDocuments({ opportunityId: id }),
    ]);

    const requiredAnswersValidation = await validateRequiredCurrentStageAnswers(
      {
        opportunityId: id,
        salesStageId: Number(opportunityState.sales_stage_id),
      },
    );
    if (!requiredAnswersValidation.ok) {
      return res.status(400).json({
        message: requiredAnswersValidation.message,
        validation: {
          decision: "not_ready_to_advance",
          summary: requiredAnswersValidation.message,
          reasons: [requiredAnswersValidation.message],
          suggestions: [
            "Completa todas las preguntas obligatorias de la etapa actual antes de validarla.",
          ],
          confidence: "high",
          questionAssessments: currentAnswers.map((answer) => ({
            questionId: Number(answer.question_id),
            questionCode: String(answer.code || ""),
            prompt: String(answer.prompt || ""),
            answerValue: String(answer.answer_value || ""),
            status:
              answer.is_required && !String(answer.answer_value || "").trim()
                ? "missing"
                : "adequate",
            reason:
              answer.is_required && !String(answer.answer_value || "").trim()
                ? "La pregunta obligatoria sigue sin respuesta."
                : "Cumple la validacion minima de presencia para esta etapa.",
            suggestion:
              answer.is_required && !String(answer.answer_value || "").trim()
                ? "Responde esta pregunta con informacion concreta antes de validar la etapa."
                : "Sin accion inmediata.",
          })),
          meta: {
            questionCount: currentAnswers.length,
            documentCount: documents.length,
            stageGuideAvailable: false,
          },
        },
      });
    }

    const validationResult = applyContactoInicialValidationGuardrail({
      salesStage,
      currentAnswers,
      validationResult: await validateOpportunityCurrentStageWithAi({
        salesStage,
        questions: currentAnswers,
        documents,
      }),
    });

    const validationNote = String(parsed.data.note || "").trim();
    await logAuditEvent({
      req,
      module: "oportunidades",
      action: "stage_validated",
      entityType: "opportunity",
      entityId: id,
      detail:
        validationResult.decision === "ready_to_advance"
          ? "Etapa actual validada por IA como lista para avanzar"
          : validationResult.decision === "advance_with_caution"
            ? "Etapa actual validada por IA con advertencias"
            : "Etapa actual validada por IA como no lista para avanzar",
      before: {
        sales_stage_id: Number(opportunityState.sales_stage_id),
      },
      after: {
        sales_stage_id: Number(opportunityState.sales_stage_id),
        validation_note: validationNote || null,
        validation_decision: validationResult.decision,
        validation_summary: validationResult.summary,
      },
    });

    return res.json({
      message:
        validationResult.decision === "ready_to_advance"
          ? `La etapa ${opportunityState.sales_stage_name} esta lista para avanzar`
          : validationResult.decision === "advance_with_caution"
            ? `La etapa ${opportunityState.sales_stage_name} puede avanzar con reservas`
            : `La etapa ${opportunityState.sales_stage_name} aun no esta lista para avanzar`,
      validation: validationResult,
    });
  },
);

router.post(
  "/:id/stage-bypass",
  requirePermission("oportunidades.update"),
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

    const now = new Date();
    await query(
      `UPDATE opportunities
       SET activation_status_id = ?, updated_by = ?, updated_at = ?
       WHERE id = ?`,
      [statusRows[0].id, req.user.id, now, id],
    );

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
