import express from "express";
import { requirePermission } from "./auth.js";
import {
  loadCommercialEnablementRecommendationCatalog,
  recommendCommercialEnablementResources,
} from "./commercial-enablement/service.js";
import { query } from "./db.js";
import { ensureCommercialExecutionSchema } from "./commercial-execution/schema.js";
import {
  buildOpportunityWorkspace,
  saveOpportunityAction,
} from "./opportunity-workspace/service.js";

const router = express.Router();

const STAGE_SLA_DAYS = {
  contacto_inicial: 3,
  descubrimiento: 5,
  validacion_valor: 5,
  propuesta: 6,
  negociacion: 4,
  cierre: 3,
};

const NEXT_STEP_ACTION_TYPES = new Set([
  "next_step",
  "follow_up",
  "waiting_customer",
]);

const DEPENDENCY_TYPE_LABELS = {
  presales_support: "Preventa",
  provider_response: "Proveedor",
  legal_review: "Legal",
  commercial_management: "Direccion comercial",
  pricing_internal: "Cotizacion interna",
  finance_approval: "Finanzas",
  operations_alignment: "Operaciones",
};

const CADENCE_LIBRARY = {
  discovery_push: {
    title: "Cadencia de descubrimiento ejecutivo",
    description:
      "Asegura siguiente paso, sponsor y evidencia operativa en oportunidades tempranas.",
    steps: [
      "Alinear proximo paso con fecha cerrada y responsable del cliente.",
      "Confirmar dolor economico, criterio de exito y urgencia ejecutiva.",
      "Acordar reunion con sponsor operativo y decisor.",
    ],
  },
  proposal_conversion: {
    title: "Cadencia de conversion de propuesta",
    description:
      "Reduce friccion despues de la propuesta y acelera validacion de negocio.",
    steps: [
      "Revisar propuesta con mapa de valor, ROI y condicion de cierre.",
      "Desbloquear objeciones legales, tecnicas o de compra en 48 horas.",
      "Cerrar reunion de decision con plan de implementacion y fecha compromiso.",
    ],
  },
  rescue_inactive: {
    title: "Cadencia de rescate comercial",
    description:
      "Reactiva oportunidades frenadas con mensaje directivo y secuencia corta.",
    steps: [
      "Enviar recap ejecutivo con riesgo de no actuar y propuesta de decision.",
      "Llamar al sponsor y validar si la oportunidad sigue priorizada.",
      "Escalar con nueva hipotesis de valor o cerrar perdida tecnica controlada.",
    ],
  },
};

router.use(async (_req, _res, next) => {
  try {
    await ensureCommercialExecutionSchema();
    next();
  } catch (error) {
    next(error);
  }
});

function hasGlobalOpportunityScope(user) {
  const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
  return permissions.includes("oportunidades.read_all");
}

function hasInteractionReadPermission(user) {
  const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
  return permissions.includes("interacciones.read");
}

function getDiffDays(fromDate, toDate = new Date()) {
  const start = new Date(fromDate);
  const end = new Date(toDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 0;
  }
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86400000));
}

function normalizeJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getDependencyTypeLabel(type) {
  return DEPENDENCY_TYPE_LABELS[type] || type || "Dependencia interna";
}

function buildOwnershipJoin(user, params, alias = "o") {
  if (hasGlobalOpportunityScope(user)) {
    return "";
  }
  params.push(Number(user.id));
  return `LEFT JOIN account_owners ao_scope ON ao_scope.account_id = ${alias}.account_id AND ao_scope.user_id = ?`;
}

async function listActiveSalesStages() {
  return query(
    `SELECT id, code, name, stage_order
     FROM opportunity_sales_stages
     WHERE is_active = 1
     ORDER BY stage_order ASC, id ASC`,
  );
}

function buildOpportunityStageSummary(stagesCatalog, opportunityState) {
  return stagesCatalog.map((stage) => {
    const stageOrder = Number(stage.stage_order || 0);
    const currentStageOrder = Number(opportunityState.stage_order || 0);
    return {
      id: Number(stage.id),
      code: stage.code,
      name: stage.name,
      description: null,
      stageOrder,
      isCurrent: Number(stage.id) === Number(opportunityState.salesStageId),
      isPast: stageOrder < currentStageOrder,
      isFuture: stageOrder > currentStageOrder,
    };
  });
}

function buildStageView(stagesCatalog, opportunityState) {
  const stages = buildOpportunityStageSummary(stagesCatalog, opportunityState);
  return {
    opportunityId: Number(opportunityState.id),
    selectedSalesStageId: Number(opportunityState.salesStageId),
    salesStageId: Number(opportunityState.salesStageId),
    salesStageCode: opportunityState.sales_stage_code,
    salesStageName: opportunityState.sales_stage_name,
    commercialStatusCode: opportunityState.commercial_status_code,
    commercialStatusName: opportunityState.commercial_status_name,
    stages,
  };
}

async function listAccessibleOpportunities(user) {
  const params = [];
  const ownershipJoin = buildOwnershipJoin(user, params);
  if (!hasGlobalOpportunityScope(user)) {
    params.push(Number(user.id));
  }

  return query(
    `SELECT o.id, o.account_id, o.name, o.amount_usd, o.close_date, o.sales_stage_id,
            o.commercial_status_id, o.seller_user_id, o.updated_at,
            a.name AS account_name,
            oss.code AS sales_stage_code,
            oss.name AS sales_stage_name,
            oss.stage_order,
            ocs.code AS commercial_status_code,
            ocs.name AS commercial_status_name,
            su.full_name AS seller_user_name
     FROM opportunities o
     ${ownershipJoin}
     INNER JOIN accounts a ON a.id = o.account_id
     INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
     INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
     LEFT JOIN users su ON su.id = o.seller_user_id
     WHERE ocs.code NOT IN ('ganada', 'perdida', 'cancelada')
       ${hasGlobalOpportunityScope(user) ? "" : "AND (ao_scope.user_id IS NOT NULL OR o.created_by = ?)"}
     ORDER BY o.updated_at DESC, o.id DESC`,
    params,
  );
}

async function listPendingInteractions(user) {
  if (!hasInteractionReadPermission(user)) {
    return [];
  }

  const params = [];
  const ownershipJoin = hasGlobalOpportunityScope(user)
    ? ""
    : "LEFT JOIN account_owners ao_scope ON ao_scope.account_id = i.account_id AND ao_scope.user_id = ?";
  if (!hasGlobalOpportunityScope(user)) {
    params.push(Number(user.id));
    params.push(Number(user.id));
  }

  const where = ["i.analysis_status <> 'resolved'"];
  if (!hasGlobalOpportunityScope(user)) {
    where.push("(ao_scope.user_id IS NOT NULL OR i.created_by = ?)");
  }

  return query(
    `SELECT i.id, i.title, i.analysis_status, i.created_at, i.account_id,
            a.name AS account_name,
            i.primary_opportunity_id,
            o.name AS primary_opportunity_name
     FROM interactions i
     LEFT JOIN accounts a ON a.id = i.account_id
     LEFT JOIN opportunities o ON o.id = i.primary_opportunity_id
     ${ownershipJoin}
     WHERE ${where.join(" AND ")}
     ORDER BY i.created_at DESC
     LIMIT 25`,
    params,
  );
}

async function listActiveCadences(opportunityIds) {
  if (!opportunityIds.length) {
    return [];
  }

  const placeholders = opportunityIds.map(() => "?").join(", ");
  return query(
    `SELECT c.id, c.opportunity_id, c.cadence_type, c.title, c.status,
            c.current_step_index, c.steps_json, c.next_run_at, c.last_executed_at,
            c.owner_user_id, c.notes, u.full_name AS owner_user_name
     FROM commercial_execution_cadences c
     LEFT JOIN users u ON u.id = c.owner_user_id
     WHERE c.opportunity_id IN (${placeholders})
       AND c.status IN ('active', 'paused')
     ORDER BY c.next_run_at IS NULL ASC, c.next_run_at ASC, c.updated_at DESC`,
    opportunityIds,
  );
}

async function listOpenDependencies(opportunityIds) {
  if (!opportunityIds.length) {
    return [];
  }

  const placeholders = opportunityIds.map(() => "?").join(", ");
  return query(
    `SELECT d.id, d.opportunity_id, d.dependency_type, d.title, d.status,
            d.owner_user_id, d.due_date, d.expected_outcome, d.details,
            d.resolution_note, d.created_at, d.updated_at,
            u.full_name AS owner_user_name
     FROM commercial_execution_dependencies d
     LEFT JOIN users u ON u.id = d.owner_user_id
     WHERE d.opportunity_id IN (${placeholders})
       AND d.status IN ('open', 'blocked')
     ORDER BY d.due_date IS NULL ASC, d.due_date ASC, d.updated_at DESC`,
    opportunityIds,
  );
}

function selectPrimaryNextStep(actions, currentStageId) {
  const candidates = (actions || [])
    .filter((action) =>
      ["pending", "in_progress", "blocked"].includes(action.status),
    )
    .sort((left, right) => {
      const leftDue = left.dueDate
        ? new Date(left.dueDate).getTime()
        : Number.MAX_SAFE_INTEGER;
      const rightDue = right.dueDate
        ? new Date(right.dueDate).getTime()
        : Number.MAX_SAFE_INTEGER;
      if (leftDue !== rightDue) return leftDue - rightDue;
      const leftCurrent =
        Number(left.linkedStageId || 0) === Number(currentStageId);
      const rightCurrent =
        Number(right.linkedStageId || 0) === Number(currentStageId);
      if (leftCurrent !== rightCurrent) return leftCurrent ? -1 : 1;
      return String(left.title || "").localeCompare(
        String(right.title || ""),
        "es",
      );
    });

  return candidates[0] || null;
}

function mapNextStep(nextStep) {
  if (!nextStep) {
    return null;
  }

  return {
    id: Number(nextStep.id),
    title: nextStep.title,
    actionType: nextStep.actionType || "next_step",
    dueDate: nextStep.dueDate,
    status: nextStep.status,
    successCriteria: nextStep.successCriteria || "",
    ownerUserId:
      nextStep.ownerUserId === null ? null : Number(nextStep.ownerUserId),
    ownerUserName: nextStep.ownerUserName || "",
    isOverdue: Boolean(nextStep.dueDate && getDiffDays(nextStep.dueDate) > 0),
  };
}

function mapDependencyRow(row) {
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    dependencyType: row.dependency_type,
    dependencyLabel: getDependencyTypeLabel(row.dependency_type),
    title: row.title,
    status: row.status,
    ownerUserId: row.owner_user_id === null ? null : Number(row.owner_user_id),
    ownerUserName: row.owner_user_name || "",
    dueDate: row.due_date,
    expectedOutcome: row.expected_outcome || "",
    details: row.details || "",
    resolutionNote: row.resolution_note || "",
    isOverdue: Boolean(row.due_date && getDiffDays(row.due_date) > 0),
    updatedAt: row.updated_at,
  };
}

function deriveCadenceType(opportunityItem) {
  if (opportunityItem.daysSinceActivity >= opportunityItem.slaDays + 2) {
    return "rescue_inactive";
  }
  if (
    ["propuesta", "negociacion", "cierre"].includes(opportunityItem.stageCode)
  ) {
    return "proposal_conversion";
  }
  return "discovery_push";
}

function buildRiskSummary({
  workspace,
  nextStep,
  dependencies,
  daysSinceActivity,
  slaDays,
}) {
  const reasons = [];
  const criticalWeaknesses = (workspace?.weaknesses || []).filter(
    (weakness) => weakness.tone === "critical" || weakness.tone === "red",
  );
  const openDependencies = dependencies.filter(
    (dependency) =>
      dependency.status === "open" || dependency.status === "blocked",
  );
  const overdueDependencies = openDependencies.filter(
    (dependency) => dependency.isOverdue,
  );

  if (!nextStep) {
    reasons.push("Sin proximo paso comprometido");
  }
  if (nextStep?.isOverdue) {
    reasons.push("Proximo paso vencido");
  }
  if (daysSinceActivity > slaDays) {
    reasons.push(`Inactividad mayor al SLA de ${slaDays} dias`);
  }
  if (nextStep?.actionType === "waiting_customer") {
    reasons.push("Esperando respuesta del cliente sin cierre confirmado");
  }
  if (openDependencies.length > 0) {
    reasons.push(
      `${openDependencies.length} dependencia(s) interna(s) abierta(s)`,
    );
  }
  if (overdueDependencies.length > 0) {
    reasons.push(
      `${overdueDependencies.length} dependencia(s) interna(s) vencida(s)`,
    );
  }
  if (criticalWeaknesses.length > 0) {
    reasons.push(
      `${criticalWeaknesses.length} debilidad(es) critica(s) abierta(s)`,
    );
  }
  if (workspace?.scorecard?.signals?.decisionRisk?.tone === "red") {
    reasons.push("Riesgo alto de decision o sponsor insuficiente");
  }

  let level = "low";
  if (reasons.length >= 3) {
    level = "high";
  } else if (reasons.length >= 1) {
    level = "medium";
  }

  return {
    level,
    reasons,
    criticalWeaknessCount: criticalWeaknesses.length,
  };
}

function buildSuggestedCadence(opportunityItem, activeCadenceByOpportunity) {
  if (activeCadenceByOpportunity.has(opportunityItem.id)) {
    return null;
  }

  const cadenceType = deriveCadenceType(opportunityItem);
  const cadence = CADENCE_LIBRARY[cadenceType];
  if (!cadence) {
    return null;
  }

  return {
    cadenceType,
    title: cadence.title,
    description: cadence.description,
    steps: cadence.steps,
    opportunityId: opportunityItem.id,
    opportunityName: opportunityItem.name,
    accountName: opportunityItem.accountName,
    sellerUserName: opportunityItem.sellerUserName,
  };
}

function deriveExecutionState({
  nextStep,
  dependencies,
  risk,
  daysSinceActivity,
  slaDays,
}) {
  const hasOpenDependencies = dependencies.some(
    (dependency) =>
      dependency.status === "open" || dependency.status === "blocked",
  );
  const hasOverdueDependencies = dependencies.some(
    (dependency) => dependency.isOverdue,
  );

  if (!nextStep) {
    return {
      code: "sin_conduccion",
      label: "Sin conduccion",
      summary:
        "La oportunidad sigue activa pero no tiene siguiente paso vigente.",
    };
  }
  if (nextStep.isOverdue) {
    return {
      code: "vencida",
      label: "Vencida",
      summary:
        "El siguiente paso ya vencio y la oportunidad requiere reaccion inmediata.",
    };
  }
  if (hasOverdueDependencies) {
    return {
      code: "bloqueada",
      label: "Bloqueada",
      summary:
        "Hay dependencias internas vencidas que estan frenando el avance.",
    };
  }
  if (hasOpenDependencies) {
    return {
      code: "esperando_interno",
      label: "Esperando interno",
      summary: "El avance depende de un compromiso interno aun abierto.",
    };
  }
  if (nextStep.actionType === "waiting_customer") {
    return {
      code: "esperando_cliente",
      label: "Esperando cliente",
      summary:
        "Existe siguiente paso definido, pero la respuesta pendiente la tiene el cliente.",
    };
  }
  if (risk.level !== "low" || daysSinceActivity > slaDays) {
    return {
      code: "en_riesgo",
      label: "En riesgo",
      summary:
        "La oportunidad mantiene conduccion, pero ya muestra señales de deterioro operativo.",
    };
  }

  return {
    code: "en_ritmo",
    label: "En ritmo",
    summary:
      "La oportunidad tiene siguiente paso vigente y no presenta bloqueos operativos criticos.",
  };
}

function buildExecutionReminders({
  opportunityItem,
  nextStep,
  dependencies,
  risk,
}) {
  const reminders = [];

  if (!nextStep) {
    reminders.push({
      tone: "high",
      title: "Definir siguiente paso",
      detail:
        "La oportunidad no deberia permanecer activa sin compromiso y fecha cerrada.",
    });
  }
  if (nextStep?.isOverdue) {
    reminders.push({
      tone: "high",
      title: "Seguimiento vencido",
      detail: `El siguiente paso vencio y ya acumula ${getDiffDays(nextStep.dueDate)} dia(s) fuera de fecha.`,
    });
  }
  if (nextStep?.actionType === "waiting_customer") {
    reminders.push({
      tone: "medium",
      title: "Cliente pendiente de responder",
      detail:
        "Conviene proteger el deal con una fecha de decision o una reunion de cierre.",
    });
  }
  if (opportunityItem.daysSinceActivity > opportunityItem.slaDays) {
    reminders.push({
      tone: "high",
      title: "SLA comercial vencido",
      detail: `La oportunidad lleva ${opportunityItem.daysSinceActivity} dias sin traccion y supera el SLA de ${opportunityItem.slaDays} dias.`,
    });
  }

  dependencies
    .filter((dependency) => !dependency.isOverdue)
    .slice(0, 1)
    .forEach((dependency) => {
      reminders.push({
        tone: "medium",
        title: `Dependencia interna abierta: ${dependency.dependencyLabel}`,
        detail: dependency.title,
      });
    });

  dependencies
    .filter((dependency) => dependency.isOverdue)
    .slice(0, 2)
    .forEach((dependency) => {
      reminders.push({
        tone: "high",
        title: `Dependencia interna vencida: ${dependency.dependencyLabel}`,
        detail: dependency.title,
      });
    });

  risk.reasons.slice(0, 2).forEach((reason) => {
    reminders.push({
      tone: risk.level === "high" ? "high" : "medium",
      title: "Alerta operativa",
      detail: reason,
    });
  });

  return reminders.slice(0, 5);
}

function mapCadenceRow(row, opportunitiesById) {
  const opportunity = opportunitiesById.get(Number(row.opportunity_id));
  const steps = normalizeJsonArray(row.steps_json);
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    opportunityName: opportunity?.name || "Oportunidad",
    accountName: opportunity?.accountName || "",
    cadenceType: row.cadence_type,
    title: row.title,
    status: row.status,
    ownerUserId: row.owner_user_id === null ? null : Number(row.owner_user_id),
    ownerUserName: row.owner_user_name || "",
    currentStepIndex: Number(row.current_step_index || 0),
    currentStepLabel:
      steps[Number(row.current_step_index || 0)] || steps[0] || "",
    steps,
    nextRunAt: row.next_run_at,
    lastExecutedAt: row.last_executed_at,
    notes: row.notes || "",
  };
}

async function loadOpportunityForExecution(user, opportunityId) {
  const ownershipParams = [];
  const ownershipJoin = buildOwnershipJoin(user, ownershipParams);
  const params = hasGlobalOpportunityScope(user)
    ? [opportunityId]
    : [Number(user.id), opportunityId, Number(user.id)];

  const rows = await query(
    `SELECT o.id, o.account_id, o.name, o.amount_usd, o.close_date, o.sales_stage_id,
            o.commercial_status_id, o.seller_user_id, o.updated_at,
            a.name AS account_name,
            oss.code AS sales_stage_code,
            oss.name AS sales_stage_name,
            oss.stage_order,
            ocs.code AS commercial_status_code,
            ocs.name AS commercial_status_name,
            su.full_name AS seller_user_name
     FROM opportunities o
     ${ownershipJoin}
     INNER JOIN accounts a ON a.id = o.account_id
     INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
     INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
     LEFT JOIN users su ON su.id = o.seller_user_id
     WHERE o.id = ?
       ${hasGlobalOpportunityScope(user) ? "" : "AND (ao_scope.user_id IS NOT NULL OR o.created_by = ?)"}`,
    hasGlobalOpportunityScope(user)
      ? params
      : [...ownershipParams, ...params.slice(1)],
  );

  return rows[0] || null;
}

async function loadDependencyForExecution(user, dependencyId) {
  const rows = await query(
    `SELECT d.id, d.opportunity_id
     FROM commercial_execution_dependencies d
     WHERE d.id = ?
     LIMIT 1`,
    [dependencyId],
  );
  if (!rows[0]) {
    return null;
  }

  const opportunity = await loadOpportunityForExecution(
    user,
    Number(rows[0].opportunity_id),
  );
  if (!opportunity) {
    return null;
  }

  return rows[0];
}

async function saveExecutionDependency({
  dependencyId = null,
  opportunityId,
  payload,
  userId,
}) {
  const allowedColumns = [
    "dependency_type",
    "title",
    "status",
    "owner_user_id",
    "due_date",
    "expected_outcome",
    "details",
    "resolution_note",
    "updated_by_user_id",
  ];
  const entries = Object.entries({
    ...payload,
    updated_by_user_id: userId,
  }).filter(([key]) => allowedColumns.includes(key));

  if (dependencyId) {
    const setClause = entries.map(([key]) => `${key} = ?`).join(", ");
    await query(
      `UPDATE commercial_execution_dependencies
       SET ${setClause}, updated_at = NOW(3)
       WHERE id = ?`,
      [...entries.map((entry) => entry[1]), dependencyId],
    );
    return Number(dependencyId);
  }

  const columns = [
    "opportunity_id",
    "created_by_user_id",
    "updated_by_user_id",
    ...entries
      .map(([key]) => key)
      .filter((key) => key !== "updated_by_user_id"),
  ];
  const values = [
    opportunityId,
    userId,
    userId,
    ...entries
      .filter(([key]) => key !== "updated_by_user_id")
      .map((entry) => entry[1]),
  ];
  const placeholders = columns.map(() => "?").join(", ");
  const result = await query(
    `INSERT INTO commercial_execution_dependencies (${columns.join(", ")}) VALUES (${placeholders})`,
    values,
  );
  return Number(result.insertId);
}

async function findOpenNextStepAction(opportunityId) {
  const rows = await query(
    `SELECT id
     FROM opportunity_workspace_actions
     WHERE opportunity_id = ?
       AND action_type = 'next_step'
       AND status IN ('pending', 'in_progress', 'blocked')
     ORDER BY due_date IS NULL ASC, due_date ASC, id ASC
     LIMIT 1`,
    [opportunityId],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

router.get(
  "/dashboard",
  requirePermission("oportunidades.read"),
  async (req, res) => {
    const stagesCatalog = await listActiveSalesStages();
    const opportunityRows = await listAccessibleOpportunities(req.user);
    const recommendationCatalog =
      await loadCommercialEnablementRecommendationCatalog();
    const dependencyRows = await listOpenDependencies(
      opportunityRows.map((row) => Number(row.id)),
    );
    const dependenciesByOpportunity = dependencyRows.reduce(
      (accumulator, row) => {
        const key = Number(row.opportunity_id);
        const current = accumulator.get(key) || [];
        current.push(mapDependencyRow(row));
        accumulator.set(key, current);
        return accumulator;
      },
      new Map(),
    );
    const executionItems = await Promise.all(
      opportunityRows.map(async (row) => {
        const opportunityState = {
          ...row,
          salesStageId: Number(row.sales_stage_id),
        };
        const stageView = buildStageView(stagesCatalog, opportunityState);
        const workspace = await buildOpportunityWorkspace({
          opportunityState,
          stageView,
          documents: [],
          currentUserId: Number(req.user.id),
        });

        const nextStep = selectPrimaryNextStep(
          workspace.actions || [],
          opportunityState.salesStageId,
        );
        const mappedNextStep = mapNextStep(nextStep);
        const lastActivityAt =
          workspace.history?.[0]?.createdAt ||
          row.updated_at ||
          new Date().toISOString();
        const daysSinceActivity = getDiffDays(lastActivityAt);
        const slaDays = STAGE_SLA_DAYS[row.sales_stage_code] || 5;
        const dependencies =
          dependenciesByOpportunity.get(Number(row.id)) || [];
        const risk = buildRiskSummary({
          workspace,
          nextStep: mappedNextStep,
          dependencies,
          daysSinceActivity,
          slaDays,
        });
        const executionState = deriveExecutionState({
          nextStep: mappedNextStep,
          dependencies,
          risk,
          daysSinceActivity,
          slaDays,
        });

        const item = {
          id: Number(row.id),
          name: row.name,
          accountId: Number(row.account_id),
          accountName: row.account_name,
          amountUsd: Number(row.amount_usd || 0),
          closeDate: row.close_date,
          stageId: Number(row.sales_stage_id),
          stageCode: row.sales_stage_code,
          stageName: row.sales_stage_name,
          commercialStatusCode: row.commercial_status_code,
          commercialStatusName: row.commercial_status_name,
          sellerUserId:
            row.seller_user_id === null ? null : Number(row.seller_user_id),
          sellerUserName: row.seller_user_name || "Sin vendedor",
          updatedAt: row.updated_at,
          lastActivityAt,
          daysSinceActivity,
          slaDays,
          slaBreached: daysSinceActivity > slaDays,
          recommendedHeading: workspace.recommendedStrategy?.heading || "",
          recommendedRoute: workspace.recommendedStrategy?.route || "",
          recommendedNextMove: workspace.recommendedStrategy?.steps?.[0] || "",
          weaknessCount: (workspace.weaknesses || []).length,
          criticalWeaknessCount: risk.criticalWeaknessCount,
          riskLevel: risk.level,
          riskReasons: risk.reasons,
          executionState,
          dependencies,
          decisionRiskTone:
            workspace.scorecard?.signals?.decisionRisk?.tone || "neutral",
          nextStep: mappedNextStep,
        };

        item.reminders = buildExecutionReminders({
          opportunityItem: item,
          nextStep: mappedNextStep,
          dependencies,
          risk,
        });
        item.recommendedResources = recommendCommercialEnablementResources({
          catalog: recommendationCatalog,
          context: {
            stageCode: item.stageCode,
            accountName: item.accountName,
            opportunityName: item.name,
            riskReasons: item.riskReasons,
            executionStateCode: item.executionState?.code,
            executionStateLabel: item.executionState?.label,
            recommendedHeading: item.recommendedHeading,
            recommendedRoute: item.recommendedRoute,
            dependencies,
            roleTags: ["seller"],
          },
        });

        return item;
      }),
    );

    const opportunityIds = executionItems.map((item) => item.id);
    const activeCadenceRows = await listActiveCadences(opportunityIds);
    const opportunitiesById = new Map(
      executionItems.map((item) => [item.id, item]),
    );
    const activeCadences = activeCadenceRows.map((row) =>
      mapCadenceRow(row, opportunitiesById),
    );
    const activeCadenceByOpportunity = new Map(
      activeCadences.map((item) => [item.opportunityId, item]),
    );
    const suggestedCadences = executionItems
      .map((item) => buildSuggestedCadence(item, activeCadenceByOpportunity))
      .filter(Boolean)
      .slice(0, 10);

    const followUps = executionItems
      .filter((item) => item.nextStep)
      .sort((left, right) => {
        const leftDue = left.nextStep?.dueDate
          ? new Date(left.nextStep.dueDate).getTime()
          : Number.MAX_SAFE_INTEGER;
        const rightDue = right.nextStep?.dueDate
          ? new Date(right.nextStep.dueDate).getTime()
          : Number.MAX_SAFE_INTEGER;
        return leftDue - rightDue;
      })
      .slice(0, 20);

    const highRisks = executionItems
      .filter((item) => item.riskLevel !== "low")
      .sort((left, right) => right.riskReasons.length - left.riskReasons.length)
      .slice(0, 20);

    const pendingInteractions = (await listPendingInteractions(req.user)).map(
      (row) => ({
        id: Number(row.id),
        title: row.title,
        analysisStatus: row.analysis_status,
        accountId: row.account_id === null ? null : Number(row.account_id),
        accountName: row.account_name || "",
        primaryOpportunityId:
          row.primary_opportunity_id === null
            ? null
            : Number(row.primary_opportunity_id),
        primaryOpportunityName: row.primary_opportunity_name || "",
        createdAt: row.created_at,
        daysOpen: getDiffDays(row.created_at),
      }),
    );

    const sellerStats = Array.from(
      executionItems
        .reduce((accumulator, item) => {
          const key = item.sellerUserId || `unassigned-${item.id}`;
          const current = accumulator.get(key) || {
            sellerUserId: item.sellerUserId,
            sellerUserName: item.sellerUserName,
            openPipeline: 0,
            riskyOpportunities: 0,
            overdueFollowUps: 0,
            withoutNextStep: 0,
            activeCadences: 0,
            totalAmountUsd: 0,
          };
          current.openPipeline += 1;
          current.totalAmountUsd += Number(item.amountUsd || 0);
          if (item.riskLevel !== "low") current.riskyOpportunities += 1;
          if (item.executionState.code === "bloqueada")
            current.blocked = (current.blocked || 0) + 1;
          if (item.executionState.code === "esperando_interno")
            current.waitingInternal = (current.waitingInternal || 0) + 1;
          if (item.executionState.code === "esperando_cliente")
            current.waitingClient = (current.waitingClient || 0) + 1;
          if (
            item.nextStep?.dueDate &&
            getDiffDays(item.nextStep.dueDate) > 0
          ) {
            current.overdueFollowUps += 1;
          }
          if (!item.nextStep) current.withoutNextStep += 1;
          if (activeCadenceByOpportunity.has(item.id))
            current.activeCadences += 1;
          accumulator.set(key, current);
          return accumulator;
        }, new Map())
        .values(),
    ).sort((left, right) => right.riskyOpportunities - left.riskyOpportunities);

    const stageStats = Array.from(
      executionItems
        .reduce((accumulator, item) => {
          const current = accumulator.get(item.stageCode) || {
            stageCode: item.stageCode,
            stageName: item.stageName,
            count: 0,
            riskyCount: 0,
            noNextStepCount: 0,
            blockedCount: 0,
            waitingInternalCount: 0,
          };
          current.count += 1;
          if (item.riskLevel !== "low") current.riskyCount += 1;
          if (!item.nextStep) current.noNextStepCount += 1;
          if (item.executionState.code === "bloqueada")
            current.blockedCount += 1;
          if (item.executionState.code === "esperando_interno") {
            current.waitingInternalCount += 1;
          }
          accumulator.set(item.stageCode, current);
          return accumulator;
        }, new Map())
        .values(),
    );

    const executionStateStats = Array.from(
      executionItems
        .reduce((accumulator, item) => {
          const key = item.executionState.code;
          const current = accumulator.get(key) || {
            code: item.executionState.code,
            label: item.executionState.label,
            count: 0,
          };
          current.count += 1;
          accumulator.set(key, current);
          return accumulator;
        }, new Map())
        .values(),
    ).sort((left, right) => right.count - left.count);

    const dependencyStats = Array.from(
      dependencyRows
        .reduce((accumulator, row) => {
          const key = String(row.dependency_type || "unknown");
          const current = accumulator.get(key) || {
            dependencyType: key,
            dependencyLabel: getDependencyTypeLabel(key),
            openCount: 0,
            overdueCount: 0,
          };
          current.openCount += 1;
          if (row.due_date && getDiffDays(row.due_date) > 0) {
            current.overdueCount += 1;
          }
          accumulator.set(key, current);
          return accumulator;
        }, new Map())
        .values(),
    ).sort((left, right) => right.overdueCount - left.overdueCount);

    res.json({
      summary: {
        openOpportunities: executionItems.length,
        riskyOpportunities: executionItems.filter(
          (item) => item.riskLevel !== "low",
        ).length,
        overdueFollowUps: executionItems.filter(
          (item) =>
            item.nextStep?.dueDate && getDiffDays(item.nextStep.dueDate) > 0,
        ).length,
        withoutNextStep: executionItems.filter((item) => !item.nextStep).length,
        staleOpportunities: executionItems.filter((item) => item.slaBreached)
          .length,
        waitingOnClient: executionItems.filter(
          (item) => item.executionState.code === "esperando_cliente",
        ).length,
        waitingOnInternal: executionItems.filter(
          (item) => item.executionState.code === "esperando_interno",
        ).length,
        blockedOpportunities: executionItems.filter(
          (item) => item.executionState.code === "bloqueada",
        ).length,
        activeCadences: activeCadences.length,
        openDependencies: dependencyRows.length,
        overdueDependencies: dependencyRows.filter(
          (row) => row.due_date && getDiffDays(row.due_date) > 0,
        ).length,
        pendingInteractions: pendingInteractions.length,
      },
      workboard: executionItems,
      followUps,
      risks: highRisks,
      cadences: {
        active: activeCadences,
        suggested: suggestedCadences,
      },
      pendingInteractions,
      management: {
        sellerStats,
        stageStats,
        executionStateStats,
        dependencyStats,
      },
    });
  },
);

router.post(
  "/opportunities/:id/next-step",
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const opportunityId = Number(req.params.id);
    if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
      return res.status(400).json({ message: "Oportunidad invalida" });
    }

    const opportunity = await loadOpportunityForExecution(
      req.user,
      opportunityId,
    );
    if (!opportunity) {
      return res.status(404).json({ message: "Oportunidad no encontrada" });
    }

    const title = String(req.body?.title || "").trim();
    const dueDate = req.body?.dueDate ? String(req.body.dueDate) : null;
    const successCriteria = String(req.body?.successCriteria || "").trim();
    const ownerUserId = req.body?.ownerUserId
      ? Number(req.body.ownerUserId)
      : null;
    const actionType = String(req.body?.actionType || "next_step").trim();

    if (!title) {
      return res
        .status(400)
        .json({ message: "El proximo paso requiere titulo" });
    }
    if (!NEXT_STEP_ACTION_TYPES.has(actionType)) {
      return res.status(400).json({ message: "actionType invalido" });
    }

    const existingActionId = await findOpenNextStepAction(opportunityId);
    const actionId = await saveOpportunityAction({
      opportunityId,
      actionId: existingActionId,
      payload: {
        linked_stage_id: Number(opportunity.sales_stage_id),
        action_type: actionType,
        priority: "high",
        title,
        owner_user_id: ownerUserId,
        due_date: dueDate,
        success_criteria: successCriteria,
        status: "pending",
      },
      userId: Number(req.user.id),
    });

    return res.status(existingActionId ? 200 : 201).json({
      id: actionId,
      message: existingActionId
        ? "Proximo paso actualizado"
        : "Proximo paso creado",
    });
  },
);

router.post(
  "/opportunities/:id/dependencies",
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const opportunityId = Number(req.params.id);
    if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
      return res.status(400).json({ message: "Oportunidad invalida" });
    }

    const opportunity = await loadOpportunityForExecution(
      req.user,
      opportunityId,
    );
    if (!opportunity) {
      return res.status(404).json({ message: "Oportunidad no encontrada" });
    }

    const dependencyType = String(req.body?.dependencyType || "").trim();
    const title = String(req.body?.title || "").trim();
    const status = String(req.body?.status || "open").trim();
    if (!dependencyType || !DEPENDENCY_TYPE_LABELS[dependencyType]) {
      return res.status(400).json({ message: "dependencyType invalido" });
    }
    if (!title) {
      return res
        .status(400)
        .json({ message: "La dependencia requiere titulo" });
    }
    if (!["open", "blocked", "done"].includes(status)) {
      return res.status(400).json({ message: "status invalido" });
    }

    const dependencyId = await saveExecutionDependency({
      opportunityId,
      payload: {
        dependency_type: dependencyType,
        title,
        status,
        owner_user_id: req.body?.ownerUserId
          ? Number(req.body.ownerUserId)
          : null,
        due_date: req.body?.dueDate ? new Date(req.body.dueDate) : null,
        expected_outcome:
          String(req.body?.expectedOutcome || "").trim() || null,
        details: String(req.body?.details || "").trim() || null,
      },
      userId: Number(req.user.id),
    });

    return res.status(201).json({
      id: dependencyId,
      message: "Dependencia interna creada",
    });
  },
);

router.patch(
  "/dependencies/:id",
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const dependencyId = Number(req.params.id);
    if (!Number.isInteger(dependencyId) || dependencyId <= 0) {
      return res.status(400).json({ message: "Dependencia invalida" });
    }

    const dependency = await loadDependencyForExecution(req.user, dependencyId);
    if (!dependency) {
      return res.status(404).json({ message: "Dependencia no encontrada" });
    }

    const payload = {};
    if (req.body?.status !== undefined) {
      const status = String(req.body.status).trim();
      if (!["open", "blocked", "done"].includes(status)) {
        return res.status(400).json({ message: "status invalido" });
      }
      payload.status = status;
    }
    if (req.body?.title !== undefined) {
      const title = String(req.body.title || "").trim();
      if (!title) {
        return res
          .status(400)
          .json({ message: "La dependencia requiere titulo" });
      }
      payload.title = title;
    }
    if (req.body?.dependencyType !== undefined) {
      const dependencyType = String(req.body.dependencyType || "").trim();
      if (!DEPENDENCY_TYPE_LABELS[dependencyType]) {
        return res.status(400).json({ message: "dependencyType invalido" });
      }
      payload.dependency_type = dependencyType;
    }
    if (req.body?.ownerUserId !== undefined) {
      payload.owner_user_id = req.body.ownerUserId
        ? Number(req.body.ownerUserId)
        : null;
    }
    if (req.body?.dueDate !== undefined) {
      payload.due_date = req.body.dueDate ? new Date(req.body.dueDate) : null;
    }
    if (req.body?.expectedOutcome !== undefined) {
      payload.expected_outcome =
        String(req.body.expectedOutcome || "").trim() || null;
    }
    if (req.body?.details !== undefined) {
      payload.details = String(req.body.details || "").trim() || null;
    }
    if (req.body?.resolutionNote !== undefined) {
      payload.resolution_note =
        String(req.body.resolutionNote || "").trim() || null;
    }

    await saveExecutionDependency({
      dependencyId,
      opportunityId: Number(dependency.opportunity_id),
      payload,
      userId: Number(req.user.id),
    });

    return res.json({ message: "Dependencia interna actualizada" });
  },
);

router.post(
  "/cadences",
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const opportunityId = Number(req.body?.opportunityId);
    const cadenceType = String(req.body?.cadenceType || "").trim();
    if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
      return res.status(400).json({ message: "opportunityId invalido" });
    }
    if (!CADENCE_LIBRARY[cadenceType]) {
      return res.status(400).json({ message: "cadenceType invalido" });
    }

    const opportunity = await loadOpportunityForExecution(
      req.user,
      opportunityId,
    );
    if (!opportunity) {
      return res.status(404).json({ message: "Oportunidad no encontrada" });
    }

    const cadence = CADENCE_LIBRARY[cadenceType];
    const nextRunAt = req.body?.nextRunAt
      ? new Date(req.body.nextRunAt)
      : new Date();
    await query(
      `INSERT INTO commercial_execution_cadences
         (opportunity_id, cadence_type, title, status, current_step_index, steps_json,
          next_run_at, owner_user_id, notes, created_by_user_id, updated_by_user_id)
       VALUES (?, ?, ?, 'active', 0, ?, ?, ?, ?, ?, ?)`,
      [
        opportunityId,
        cadenceType,
        cadence.title,
        JSON.stringify(cadence.steps),
        Number.isNaN(nextRunAt.getTime()) ? null : nextRunAt,
        req.body?.ownerUserId ? Number(req.body.ownerUserId) : null,
        String(req.body?.notes || "").trim() || null,
        Number(req.user.id),
        Number(req.user.id),
      ],
    );

    return res.status(201).json({ message: "Cadencia activada" });
  },
);

router.patch(
  "/cadences/:id",
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const cadenceId = Number(req.params.id);
    if (!Number.isInteger(cadenceId) || cadenceId <= 0) {
      return res.status(400).json({ message: "Cadencia invalida" });
    }

    const cadenceRows = await query(
      `SELECT id, status, current_step_index
       FROM commercial_execution_cadences
       WHERE id = ?
       LIMIT 1`,
      [cadenceId],
    );
    if (!cadenceRows[0]) {
      return res.status(404).json({ message: "Cadencia no encontrada" });
    }

    const status = req.body?.status
      ? String(req.body.status)
      : cadenceRows[0].status;
    const currentStepIndex = Number.isInteger(req.body?.currentStepIndex)
      ? Number(req.body.currentStepIndex)
      : Number(cadenceRows[0].current_step_index || 0);

    await query(
      `UPDATE commercial_execution_cadences
       SET status = ?,
           current_step_index = ?,
           next_run_at = ?,
           last_executed_at = ?,
           notes = ?,
           updated_by_user_id = ?,
           updated_at = NOW(3)
       WHERE id = ?`,
      [
        status,
        Math.max(0, currentStepIndex),
        req.body?.nextRunAt ? new Date(req.body.nextRunAt) : null,
        req.body?.lastExecutedAt ? new Date(req.body.lastExecutedAt) : null,
        String(req.body?.notes || "").trim() || null,
        Number(req.user.id),
        cadenceId,
      ],
    );

    return res.json({ message: "Cadencia actualizada" });
  },
);

export default router;
