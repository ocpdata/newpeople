import { createHash, randomUUID } from "node:crypto";
import { getUserAuthContext } from "../auth.js";
import { logAuditEvent } from "../audit.js";
import { config } from "../config.js";
import { query, withTransaction } from "../db.js";
import { listOpportunityDocuments } from "../opportunity-documents/service.js";
import { buildOpportunityWorkspace } from "../opportunity-workspace/service.js";
import { ensureOpportunityWorkspaceSchema } from "../opportunity-workspace/schema.js";
import {
  isOpportunityStageAnswerSuggestionsEnabled,
  validateOpportunityCurrentStageWithAi,
} from "../opportunityStageAnswerSuggestions.js";

const PIPELINE_VERSION = "v1";
const JOB_LEASE_SECONDS = 30;
const JOB_RESULT_TTL_MINUTES = 15;
const JOB_POLL_AFTER_MS = 3000;

function createHttpError(status, body) {
  const error = new Error(body?.message || "Solicitud invalida");
  error.status = status;
  error.body = body;
  return error;
}

function parseJsonField(value, fallback) {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function normalizeNote(note) {
  return String(note || "").trim();
}

function serializeDocumentFingerprint(document) {
  return [
    Number(document.id || 0),
    String(document.file_name || ""),
    String(document.mime_type || ""),
    String(document.extracted_text || document.preview_text || ""),
    String(document.updated_at || document.created_at || ""),
  ].join("|");
}

function serializeAnswerFingerprint(answer) {
  return [
    Number(answer.question_id || 0),
    String(answer.code || ""),
    String(answer.answer_value || ""),
    Number(answer.is_required || 0),
  ].join("|");
}

function buildMissingRequiredValidation({ currentAnswers, documents, message }) {
  return {
    decision: "not_ready_to_advance",
    summary: message,
    reasons: [message],
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

async function getOpportunitySalesStageById(salesStageId) {
  const rows = await query(
    `SELECT id, code, name, stage_order
     FROM opportunity_sales_stages
     WHERE id = ?
     LIMIT 1`,
    [salesStageId],
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

async function getLatestOpportunityStageAnswers({ opportunityId, salesStageId }) {
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

async function getLatestOpportunityStageBypass({ opportunityId, salesStageId }) {
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
  const selectedStage = await getOpportunitySalesStageById(selectedSalesStageId);
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

async function validateRequiredCurrentStageAnswers({ opportunityId, salesStageId }) {
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

async function getCurrentStageValidationContext({ opportunityId }) {
  const opportunityState = await getOpportunityStateById(opportunityId);
  if (!opportunityState) {
    throw createHttpError(404, { message: "Oportunidad no encontrada" });
  }
  if (isClosedCommercialStatus(opportunityState.commercial_status_code)) {
    throw createHttpError(400, {
      message: "No puedes validar una etapa de una oportunidad cerrada",
    });
  }
  if (!isOpportunityStageAnswerSuggestionsEnabled()) {
    throw createHttpError(404, {
      message: "La validacion de etapas con IA no esta habilitada",
    });
  }

  const salesStage = await getOpportunitySalesStageById(
    Number(opportunityState.sales_stage_id),
  );
  if (!salesStage) {
    throw createHttpError(404, { message: "Etapa de venta no encontrada" });
  }

  const [currentAnswers, documents] = await Promise.all([
    getLatestOpportunityStageAnswers({
      opportunityId,
      salesStageId: Number(opportunityState.sales_stage_id),
    }),
    listOpportunityDocuments({ opportunityId }),
  ]);

  const requiredAnswersValidation = await validateRequiredCurrentStageAnswers({
    opportunityId,
    salesStageId: Number(opportunityState.sales_stage_id),
  });
  if (!requiredAnswersValidation.ok) {
    throw createHttpError(400, {
      message: requiredAnswersValidation.message,
      validation: buildMissingRequiredValidation({
        currentAnswers,
        documents,
        message: requiredAnswersValidation.message,
      }),
    });
  }

  return {
    opportunityState,
    salesStage,
    currentAnswers,
    documents,
  };
}

function buildRequestFingerprint({ context, note }) {
  const snapshot = {
    opportunityId: Number(context.opportunityState.id),
    salesStageId: Number(context.opportunityState.sales_stage_id),
    salesStageCode: String(context.opportunityState.sales_stage_code || ""),
    commercialStatusCode: String(
      context.opportunityState.commercial_status_code || "",
    ),
    note: normalizeNote(note),
    answers: context.currentAnswers.map((answer) =>
      sha256(serializeAnswerFingerprint(answer)),
    ),
    documents: context.documents.map((document) =>
      sha256(serializeDocumentFingerprint(document)),
    ),
  };

  return {
    fingerprint: sha256(JSON.stringify(snapshot)),
    snapshot,
  };
}

function buildJobResponse(row) {
  const result = parseJsonField(row.result_json, null);
  const isExpired =
    row.expires_at && new Date(row.expires_at).getTime() <= Date.now();
  const status =
    isExpired && ["completed", "failed", "stale"].includes(row.status)
      ? "expired"
      : row.status;

  const response = {
    job: {
      id: String(row.public_id),
      status,
      pollAfterMs: JOB_POLL_AFTER_MS,
      resultAvailable: status === "completed" && Boolean(result),
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      expiresAt: row.expires_at,
    },
  };

  if (status === "completed" && result) {
    response.result = result;
    return response;
  }

  if (status === "failed") {
    response.error = {
      code: row.error_code || "validation_failed",
      message:
        String(row.error_message || "").trim() ||
        "No fue posible completar la validacion de la etapa",
    };
    return response;
  }

  if (status === "stale") {
    response.error = {
      code: row.error_code || "stale_snapshot",
      message:
        String(row.error_message || "").trim() ||
        "La evidencia cambio antes de ejecutar la validacion. Solicita un nuevo analisis.",
    };
    return response;
  }

  if (status === "expired") {
    response.error = {
      code: "expired_result",
      message:
        "El resultado de la validacion ya expiro. Solicita una nueva validacion.",
    };
  }

  return response;
}

async function getJobRowByPublicId(publicId) {
  const rows = await query(
    `SELECT *
     FROM opportunity_stage_validation_jobs
     WHERE public_id = ?
     LIMIT 1`,
    [publicId],
  );
  return rows.length ? rows[0] : null;
}

async function claimNextPendingJob() {
  const candidates = await query(
    `SELECT id
     FROM opportunity_stage_validation_jobs
     WHERE (
         status = 'pending'
         OR (
           status = 'running'
           AND lease_expires_at IS NOT NULL
           AND lease_expires_at <= NOW(3)
         )
       )
       AND (expires_at IS NULL OR expires_at > NOW(3))
     ORDER BY created_at ASC, id ASC
     LIMIT 20`,
  );

  for (const candidate of candidates) {
    const leaseToken = randomUUID().replace(/-/g, "");
    const row = await withTransaction(async (conn) => {
      const [updateResult] = await conn.query(
        `UPDATE opportunity_stage_validation_jobs
         SET status = 'running',
             attempt_count = attempt_count + 1,
             lease_token = ?,
             lease_expires_at = DATE_ADD(NOW(3), INTERVAL ? SECOND),
             started_at = COALESCE(started_at, NOW(3)),
             updated_at = NOW(3)
         WHERE id = ?
           AND (
             status = 'pending'
             OR (
               status = 'running'
               AND lease_expires_at IS NOT NULL
               AND lease_expires_at <= NOW(3)
             )
           )`,
        [leaseToken, JOB_LEASE_SECONDS, Number(candidate.id)],
      );

      if (!updateResult.affectedRows) {
        return null;
      }

      const [rows] = await conn.query(
        `SELECT *
         FROM opportunity_stage_validation_jobs
         WHERE id = ?
         LIMIT 1`,
        [Number(candidate.id)],
      );

      return rows[0] || null;
    });

    if (row) {
      return row;
    }
  }

  return null;
}

async function updateJobStatus({
  jobId,
  leaseToken,
  status,
  result,
  errorCode,
  errorMessage,
}) {
  await query(
    `UPDATE opportunity_stage_validation_jobs
     SET status = ?,
         result_json = ?,
         error_code = ?,
         error_message = ?,
         finished_at = NOW(3),
         expires_at = DATE_ADD(NOW(3), INTERVAL ? MINUTE),
         lease_token = NULL,
         lease_expires_at = NULL,
         updated_at = NOW(3)
     WHERE id = ?
       AND lease_token = ?`,
    [
      status,
      result ? JSON.stringify(result) : null,
      errorCode || null,
      errorMessage || null,
      JOB_RESULT_TTL_MINUTES,
      jobId,
      leaseToken,
    ],
  );
}

export async function executeOpportunityCurrentStageValidation({
  opportunityId,
  note,
  user,
  req,
  context,
}) {
  const currentContext =
    context || (await getCurrentStageValidationContext({ opportunityId }));
  const validationResult = applyContactoInicialValidationGuardrail({
    salesStage: currentContext.salesStage,
    currentAnswers: currentContext.currentAnswers,
    validationResult: await validateOpportunityCurrentStageWithAi({
      salesStage: currentContext.salesStage,
      questions: currentContext.currentAnswers,
      documents: currentContext.documents,
    }),
  });

  const validationNote = normalizeNote(note);
  let autoAdvanced = false;
  let advancedSalesStage = null;

  await logAuditEvent({
    req,
    actor: user,
    module: "oportunidades",
    action: "stage_validated",
    entityType: "opportunity",
    entityId: opportunityId,
    detail:
      validationResult.decision === "ready_to_advance"
        ? "Etapa actual validada por IA como lista para avanzar"
        : validationResult.decision === "advance_with_caution"
          ? "Etapa actual validada por IA con advertencias"
          : "Etapa actual validada por IA como no lista para avanzar",
    before: {
      sales_stage_id: Number(currentContext.opportunityState.sales_stage_id),
    },
    after: {
      sales_stage_id: Number(currentContext.opportunityState.sales_stage_id),
      validated_sales_stage_id: Number(
        currentContext.opportunityState.sales_stage_id,
      ),
      validated_sales_stage_code: String(
        currentContext.opportunityState.sales_stage_code,
      ),
      validated_sales_stage_name: String(
        currentContext.opportunityState.sales_stage_name,
      ),
      validation_note: validationNote || null,
      validation_decision: validationResult.decision,
      validation_summary: validationResult.summary,
    },
  });

  if (validationResult.decision === "ready_to_advance") {
    const stageResolution = await getAdjacentOpportunityStage({
      salesStageId: Number(currentContext.opportunityState.sales_stage_id),
      direction: "advance",
    });
    if (stageResolution.ok) {
      const targetStage = stageResolution.targetStage;
      const now = new Date();
      await query(
        `UPDATE opportunities
         SET sales_stage_id = ?, updated_by = ?, updated_at = ?
         WHERE id = ?`,
        [Number(targetStage.id), user.id, now, opportunityId],
      );

      await logAuditEvent({
        req,
        actor: user,
        module: "oportunidades",
        action: "stage_advanced",
        entityType: "opportunity",
        entityId: opportunityId,
        detail:
          "Etapa de oportunidad avanzada automaticamente tras validacion",
        before: {
          sales_stage_id: Number(currentContext.opportunityState.sales_stage_id),
        },
        after: { sales_stage_id: Number(targetStage.id) },
      });

      autoAdvanced = true;
      advancedSalesStage = {
        id: Number(targetStage.id),
        code: String(targetStage.code),
        name: String(targetStage.name),
      };
    }
  }

  await refreshOpportunityRecommendedStrategy({
    opportunityId,
    selectedSalesStageId: Number(
      advancedSalesStage?.id || currentContext.opportunityState.sales_stage_id,
    ),
    userId: Number(user.id),
  });

  return {
    message:
      validationResult.decision === "ready_to_advance"
        ? autoAdvanced && advancedSalesStage
          ? `La etapa ${currentContext.opportunityState.sales_stage_name} fue validada como lista para avanzar y la oportunidad avanzo a ${advancedSalesStage.name}`
          : `La etapa ${currentContext.opportunityState.sales_stage_name} esta lista para avanzar`
        : validationResult.decision === "advance_with_caution"
          ? `La etapa ${currentContext.opportunityState.sales_stage_name} puede avanzar con reservas`
          : `La etapa ${currentContext.opportunityState.sales_stage_name} aun no esta lista para avanzar`,
    validation: validationResult,
    autoAdvanced,
    advancedSalesStage,
  };
}

export async function createOrReuseOpportunityStageValidationJob({
  opportunityId,
  requestedByUserId,
  note,
}) {
  const context = await getCurrentStageValidationContext({ opportunityId });
  const { fingerprint, snapshot } = buildRequestFingerprint({ context, note });

  const reusableRows = await query(
    `SELECT *
     FROM opportunity_stage_validation_jobs
     WHERE opportunity_id = ?
       AND sales_stage_id = ?
       AND requested_by_user_id = ?
       AND request_fingerprint = ?
       AND pipeline_version = ?
       AND status IN ('pending', 'running')
     ORDER BY id DESC
     LIMIT 1`,
    [
      opportunityId,
      Number(context.opportunityState.sales_stage_id),
      requestedByUserId,
      fingerprint,
      PIPELINE_VERSION,
    ],
  );

  if (reusableRows.length) {
    return {
      wasReused: true,
      response: buildJobResponse(reusableRows[0]),
    };
  }

  const publicId = `opp-stage-validation-${randomUUID().replace(/-/g, "")}`;
  await query(
    `INSERT INTO opportunity_stage_validation_jobs (
       public_id,
       opportunity_id,
       sales_stage_id,
       requested_by_user_id,
       status,
       request_fingerprint,
       pipeline_version,
       source_snapshot_json
     ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [
      publicId,
      opportunityId,
      Number(context.opportunityState.sales_stage_id),
      requestedByUserId,
      fingerprint,
      PIPELINE_VERSION,
      JSON.stringify(snapshot),
    ],
  );

  const row = await getJobRowByPublicId(publicId);
  return {
    wasReused: false,
    response: buildJobResponse(row),
  };
}

export async function getOpportunityStageValidationJob({
  publicId,
  opportunityId,
}) {
  const rows = await query(
    `SELECT *
     FROM opportunity_stage_validation_jobs
     WHERE public_id = ?
       AND opportunity_id = ?
     LIMIT 1`,
    [publicId, opportunityId],
  );
  if (!rows.length) {
    return null;
  }
  return buildJobResponse(rows[0]);
}

async function processJob(row) {
  const snapshot = parseJsonField(row.source_snapshot_json, null);
  try {
    const user = await getUserAuthContext(Number(row.requested_by_user_id));
    if (!user) {
      await updateJobStatus({
        jobId: Number(row.id),
        leaseToken: row.lease_token,
        status: "failed",
        errorCode: "requester_not_found",
        errorMessage: "No fue posible resolver el usuario solicitante del job",
      });
      return;
    }

    const context = await getCurrentStageValidationContext({
      opportunityId: Number(row.opportunity_id),
    });
    const { fingerprint } = buildRequestFingerprint({
      context,
      note: snapshot?.note,
    });

    if (fingerprint !== row.request_fingerprint) {
      await updateJobStatus({
        jobId: Number(row.id),
        leaseToken: row.lease_token,
        status: "stale",
        errorCode: "stale_snapshot",
        errorMessage:
          "La evidencia cambio antes de ejecutar la validacion. Solicita un nuevo analisis.",
      });
      return;
    }

    const result = await executeOpportunityCurrentStageValidation({
      opportunityId: Number(row.opportunity_id),
      note: snapshot?.note || "",
      user,
      context,
    });

    await updateJobStatus({
      jobId: Number(row.id),
      leaseToken: row.lease_token,
      status: "completed",
      result,
    });
  } catch (error) {
    const status = error?.status === 409 ? "stale" : "failed";
    const errorCode = status === "stale" ? "stale_snapshot" : "validation_failed";
    const errorMessage =
      String(error?.body?.message || error?.message || "").trim() ||
      "No fue posible completar la validacion de la etapa";

    await updateJobStatus({
      jobId: Number(row.id),
      leaseToken: row.lease_token,
      status,
      errorCode,
      errorMessage,
    });
  }
}

export async function processPendingOpportunityStageValidationJobs({
  limit = 1,
} = {}) {
  let processed = 0;
  while (processed < limit) {
    const row = await claimNextPendingJob();
    if (!row) {
      break;
    }
    processed += 1;
    await processJob(row);
  }
  return processed;
}