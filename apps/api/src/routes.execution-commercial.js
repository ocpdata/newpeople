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
import { ensureCommercialPlanningSchema } from "./commercial-planning/schema.js";

const router = express.Router();

const STAGE_SLA_DAYS = {
  contacto_inicial: 3,
  descubrimiento: 5,
  validacion_valor: 5,
  propuesta: 6,
  negociacion: 4,
  cierre: 3,
};

const CADENCE_VISIBLE_LIMIT = 10;
const DEVELOPMENT_PRIORITY_LIMIT = 12;
const DEVELOPMENT_ACTION_LIMIT = 10;

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
    await Promise.all([
      ensureCommercialExecutionSchema(),
      ensureCommercialPlanningSchema(),
    ]);
    next();
  } catch (error) {
    next(error);
  }
});

function getQuarterLabel(year, quarter) {
  return `T${quarter} ${year}`;
}

function roundAmount(value) {
  return Number(Number(value || 0).toFixed(2));
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toIsoDate(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
}

function resolveQuarterSelection(input) {
  const now = new Date();
  const fallbackQuarter = Math.floor(now.getMonth() / 3) + 1;
  const year = Number(input?.year);
  const quarter = Number(input?.quarter);
  return {
    year: Number.isInteger(year) && year >= 2020 && year <= 2100
      ? year
      : now.getFullYear(),
    quarter: Number.isInteger(quarter) && quarter >= 1 && quarter <= 4
      ? quarter
      : fallbackQuarter,
  };
}

function getQuarterDateRange(year, quarter) {
  const start = new Date(Date.UTC(year, (quarter - 1) * 3, 1));
  const end = new Date(Date.UTC(year, quarter * 3, 0));
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function isDateWithinQuarter(value, year, quarter) {
  const isoDate = toIsoDate(value);
  if (!isoDate) return false;
  const { startDate, endDate } = getQuarterDateRange(year, quarter);
  return isoDate >= startDate && isoDate <= endDate;
}

function getStageConfidence(stageCode, stageOrder = 0, maxStageOrder = 6) {
  const mapped = {
    contacto_inicial: 0.12,
    identificacion_oportunidad: 0.18,
    descubrimiento: 0.28,
    validacion_valor: 0.45,
    propuesta: 0.68,
    negociacion: 0.84,
    cierre: 0.94,
    waiting: 0.4,
  }[stageCode];

  if (mapped) {
    return mapped;
  }

  if (!maxStageOrder) {
    return 0.35;
  }

  return clampNumber(Number(stageOrder || 0) / Number(maxStageOrder || 1), 0.1, 0.95);
}

function isCommittedStage(stageCode) {
  return stageCode === "negociacion" || stageCode === "waiting";
}

async function listDevelopmentPeriods() {
  const rows = await query(
    `SELECT p.id, p.plan_year, p.plan_quarter, p.status,
            EXISTS(
              SELECT 1
              FROM commercial_planning_versions v
              WHERE v.period_id = p.id AND v.status = 'active'
            ) AS has_active_version
     FROM commercial_planning_periods p
     ORDER BY p.plan_year DESC, p.plan_quarter DESC, p.id DESC
     LIMIT 8`,
    [],
  ).catch(() => []);

  return rows.map((row) => ({
    id: Number(row.id),
    year: Number(row.plan_year),
    quarter: Number(row.plan_quarter),
    label: getQuarterLabel(row.plan_year, row.plan_quarter),
    status: row.status,
    hasActiveVersion: Boolean(row.has_active_version),
  }));
}

async function loadPlanningSnapshot({ user, year, quarter, openItems }) {
  const periodRows = await query(
    `SELECT p.id, p.plan_year, p.plan_quarter, p.base_currency_code, p.status, p.notes,
            v.id AS version_id, v.version_number, v.status AS version_status, v.label AS version_label
     FROM commercial_planning_periods p
     LEFT JOIN commercial_planning_versions v ON v.id = (
       SELECT v2.id
       FROM commercial_planning_versions v2
       WHERE v2.period_id = p.id
       ORDER BY CASE v2.status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
                v2.version_number DESC,
                v2.id DESC
       LIMIT 1
     )
     WHERE p.plan_year = ? AND p.plan_quarter = ?
     ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
              p.id DESC
     LIMIT 1`,
    [year, quarter],
  ).catch(() => []);

  const periodRow = periodRows[0] || null;
  const hasGlobalScope = hasGlobalOpportunityScope(user);
  const targetParams = [];
  let targetScopeWhere = "";
  if (periodRow?.version_id) {
    targetParams.push(Number(periodRow.version_id));
    if (!hasGlobalScope) {
      targetScopeWhere = "AND t.seller_user_id = ?";
      targetParams.push(Number(user.id) || 0);
    }
  }

  const targetRows = periodRow?.version_id
    ? await query(
        `SELECT t.seller_user_id, t.sales_quota_amount, t.currency_code,
                t.expected_margin_percent, t.expected_contribution_amount,
                t.status, u.full_name AS seller_user_name
         FROM commercial_planning_targets t
         INNER JOIN users u ON u.id = t.seller_user_id
         WHERE t.version_id = ?
           AND t.status <> 'void'
           ${targetScopeWhere}
         ORDER BY u.full_name ASC`,
        targetParams,
      ).catch(() => [])
    : [];

  const { startDate, endDate } = getQuarterDateRange(year, quarter);
  const wonParams = [];
  const ownershipJoin = buildOwnershipJoin(user, wonParams);
  if (!hasGlobalScope) {
    wonParams.push(Number(user.id));
  }
  const wonRows = await query(
    `SELECT o.seller_user_id,
            COALESCE(SUM(o.amount_usd), 0) AS won_amount,
            COUNT(*) AS won_count
     FROM opportunities o
     ${ownershipJoin}
     INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
     WHERE ocs.code = 'ganada'
       AND o.close_date BETWEEN ? AND ?
       ${hasGlobalScope ? "" : "AND (ao_scope.user_id IS NOT NULL OR o.created_by = ?)"}
     GROUP BY o.seller_user_id`,
    hasGlobalScope
      ? [...wonParams, startDate, endDate]
      : [...wonParams, startDate, endDate, Number(user.id)],
  ).catch(() => []);

  const wonBySellerId = wonRows.reduce((accumulator, row) => {
    accumulator.set(
      row.seller_user_id === null ? null : Number(row.seller_user_id),
      {
        wonAmount: roundAmount(row.won_amount),
        wonCount: Number(row.won_count || 0),
      },
    );
    return accumulator;
  }, new Map());

  const stageOrderValues = openItems.map((item) => Number(item.stageId || 0));
  const maxStageOrder = stageOrderValues.length
    ? Math.max(...stageOrderValues)
    : 6;
  const openItemsInQuarter = openItems.filter((item) =>
    isDateWithinQuarter(item.closeDate, year, quarter),
  );
  const openBySellerId = openItemsInQuarter.reduce((accumulator, item) => {
    const key = item.sellerUserId || null;
    const current = accumulator.get(key) || {
      openAmount: 0,
      committedOpenAmount: 0,
      weightedOpenAmount: 0,
      openCount: 0,
    };
    const stageConfidence = getStageConfidence(
      item.stageCode,
      item.stageId,
      maxStageOrder,
    );
    current.openAmount += Number(item.amountUsd || 0);
    if (isCommittedStage(item.stageCode)) {
      current.committedOpenAmount += Number(item.amountUsd || 0);
    }
    current.weightedOpenAmount += Number(item.amountUsd || 0) * stageConfidence;
    current.openCount += 1;
    accumulator.set(key, current);
    return accumulator;
  }, new Map());

  const targetSnapshots = targetRows.map((row) => {
    const sellerUserId = Number(row.seller_user_id);
    const won = wonBySellerId.get(sellerUserId) || { wonAmount: 0, wonCount: 0 };
    const open = openBySellerId.get(sellerUserId) || {
      openAmount: 0,
      committedOpenAmount: 0,
      weightedOpenAmount: 0,
      openCount: 0,
    };
    const quotaAmount = roundAmount(row.sales_quota_amount);
    const projectedAmount = roundAmount(won.wonAmount + open.weightedOpenAmount);
    return {
      sellerUserId,
      sellerUserName: row.seller_user_name,
      quotaAmount,
      currencyCode: row.currency_code || periodRow?.base_currency_code || "USD",
      expectedMarginPercent: Number(row.expected_margin_percent || 0),
      expectedContributionAmount: roundAmount(row.expected_contribution_amount),
      wonAmount: won.wonAmount,
      wonCount: won.wonCount,
      openAmount: roundAmount(open.openAmount),
      committedOpenAmount: roundAmount(open.committedOpenAmount),
      openCount: open.openCount,
      weightedOpenAmount: roundAmount(open.weightedOpenAmount),
      gapAmount: roundAmount(Math.max(quotaAmount - won.wonAmount, 0)),
      projectedGapAmount: roundAmount(Math.max(quotaAmount - projectedAmount, 0)),
      attainmentPercent: quotaAmount
        ? roundAmount((won.wonAmount / quotaAmount) * 100)
        : null,
      projectionPercent: quotaAmount
        ? roundAmount((projectedAmount / quotaAmount) * 100)
        : null,
    };
  });

  const assignedAmount = roundAmount(
    targetSnapshots.reduce((total, item) => total + Number(item.quotaAmount || 0), 0),
  );
  const actualAmount = roundAmount(
    targetSnapshots.reduce((total, item) => total + Number(item.wonAmount || 0), 0),
  );
  const openAmount = roundAmount(
    targetSnapshots.reduce((total, item) => total + Number(item.openAmount || 0), 0),
  );
  const committedOpenAmount = roundAmount(
    targetSnapshots.reduce(
      (total, item) => total + Number(item.committedOpenAmount || 0),
      0,
    ),
  );
  const weightedOpenAmount = roundAmount(
    targetSnapshots.reduce(
      (total, item) => total + Number(item.weightedOpenAmount || 0),
      0,
    ),
  );
  const projectedAmount = roundAmount(actualAmount + weightedOpenAmount);
  const gapAmount = roundAmount(Math.max(assignedAmount - actualAmount, 0));
  const projectedGapAmount = roundAmount(
    Math.max(assignedAmount - projectedAmount, 0),
  );

  return {
    period: {
      id: periodRow ? Number(periodRow.id) : null,
      year,
      quarter,
      label: getQuarterLabel(year, quarter),
      baseCurrencyCode: periodRow?.base_currency_code || targetSnapshots[0]?.currencyCode || "USD",
      status: periodRow?.status || "unplanned",
      hasPlan: Boolean(periodRow),
      hasPublishedVersion: periodRow?.version_status === "active",
      versionId: periodRow?.version_id ? Number(periodRow.version_id) : null,
      versionNumber: periodRow?.version_number ? Number(periodRow.version_number) : null,
      versionLabel: periodRow?.version_label || null,
      notes: periodRow?.notes || "",
      startDate,
      endDate,
    },
    quota: {
      assignedAmount,
      actualAmount,
      openAmount,
      committedOpenAmount,
      weightedOpenAmount,
      projectedAmount,
      gapAmount,
      projectedGapAmount,
      attainmentPercent: assignedAmount
        ? roundAmount((actualAmount / assignedAmount) * 100)
        : null,
      projectionPercent: assignedAmount
        ? roundAmount((projectedAmount / assignedAmount) * 100)
        : null,
      targetCount: targetSnapshots.length,
    },
    sellerSnapshots: targetSnapshots,
  };
}

function buildPipelineByStage(items, quotaGapAmount = 0) {
  const maxStageOrder = items.length
    ? Math.max(...items.map((item) => Number(item.stageId || 0)))
    : 6;
  return Array.from(
    items.reduce((accumulator, item) => {
      const key = String(item.stageCode || item.stageId || "unknown");
      const current = accumulator.get(key) || {
        stageCode: item.stageCode,
        stageName: item.stageName,
        opportunityCount: 0,
        openAmount: 0,
        weightedAmount: 0,
        riskyCount: 0,
        overdueCount: 0,
        withoutNextStepCount: 0,
        quotaCoverageShare: 0,
      };
      const stageConfidence = getStageConfidence(
        item.stageCode,
        item.stageId,
        maxStageOrder,
      );
      current.opportunityCount += 1;
      current.openAmount += Number(item.amountUsd || 0);
      current.weightedAmount += Number(item.amountUsd || 0) * stageConfidence;
      if (item.riskLevel !== "low") current.riskyCount += 1;
      if (item.nextStep?.isOverdue) current.overdueCount += 1;
      if (!item.nextStep) current.withoutNextStepCount += 1;
      accumulator.set(key, current);
      return accumulator;
    }, new Map()),
    ([, item]) => ({
      ...item,
      openAmount: roundAmount(item.openAmount),
      weightedAmount: roundAmount(item.weightedAmount),
      quotaCoverageShare: quotaGapAmount
        ? roundAmount((item.weightedAmount / quotaGapAmount) * 100)
        : null,
    }),
  ).sort((left, right) => right.weightedAmount - left.weightedAmount);
}

function buildDevelopmentRecommendation(item) {
  if (!item.nextStep) {
    return "Define un siguiente paso con fecha y responsable para recuperar conducción.";
  }
  if (item.nextStep?.isOverdue) {
    return "Cierra o renegocia hoy el compromiso vencido para no seguir degradando la oportunidad.";
  }
  if (item.executionState?.code === "esperando_interno") {
    return "Destraba la dependencia interna antes de pedir otra reunión al cliente.";
  }
  if (item.executionState?.code === "esperando_cliente") {
    return "Empuja confirmación del cliente con resumen ejecutivo y fecha cerrada de decisión.";
  }
  if (item.riskLevel === "high") {
    return item.riskReasons?.[0] || "Atiende la principal señal de riesgo antes del siguiente hito comercial.";
  }
  return getRecommendedNextMove(item.recommendedNextMove);
}

function getRecommendedNextMove(value) {
  if (!value) return "Concreta el siguiente movimiento comercial con evidencia y fecha.";
  if (typeof value === "string") return value;
  return value.title || value.text || "Concreta el siguiente movimiento comercial con evidencia y fecha.";
}

function buildPriorityItems(items, planningSnapshot) {
  const maxAmount = items.length
    ? Math.max(...items.map((item) => Number(item.amountUsd || 0)), 1)
    : 1;
  const maxStageOrder = items.length
    ? Math.max(...items.map((item) => Number(item.stageId || 0)), 6)
    : 6;
  const quotaGapAmount = Number(planningSnapshot?.quota?.gapAmount || 0);

  return items
    .map((item) => {
      const amountRatio = Number(item.amountUsd || 0) / maxAmount;
      const stageConfidence = getStageConfidence(
        item.stageCode,
        item.stageId,
        maxStageOrder,
      );
      const impactScore = Math.round(
        amountRatio * 45 +
          Math.min(quotaGapAmount > 0 ? Number(item.amountUsd || 0) / quotaGapAmount : 0.45, 1) * 35 +
          stageConfidence * 20,
      );

      let riskScore = item.riskLevel === "high" ? 70 : item.riskLevel === "medium" ? 45 : 15;
      riskScore += Math.min((item.riskReasons || []).length * 6, 18);
      riskScore += item.nextStep?.isOverdue ? 12 : 0;
      riskScore += item.executionState?.code === "bloqueada" ? 10 : 0;
      riskScore += item.executionState?.code === "esperando_interno" ? 8 : 0;
      riskScore = clampNumber(riskScore, 0, 100);

      const closeDate = item.closeDate ? new Date(item.closeDate) : null;
      const daysToClose = closeDate && !Number.isNaN(closeDate.getTime())
        ? Math.ceil((closeDate.getTime() - Date.now()) / 86400000)
        : null;
      let urgencyScore = 25;
      if (daysToClose !== null) {
        if (daysToClose <= 7) urgencyScore += 35;
        else if (daysToClose <= 21) urgencyScore += 24;
        else if (daysToClose <= 45) urgencyScore += 14;
      }
      if (item.nextStep?.isOverdue) urgencyScore += 20;
      if (!item.nextStep) urgencyScore += 12;
      if (item.daysSinceActivity > item.slaDays) urgencyScore += 10;
      urgencyScore = clampNumber(urgencyScore, 0, 100);

      const priorityScore = Math.round(
        impactScore * 0.45 + riskScore * 0.3 + urgencyScore * 0.25,
      );
      const gapCoverageShare = quotaGapAmount
        ? roundAmount((Number(item.amountUsd || 0) / quotaGapAmount) * 100)
        : null;

      return {
        ...item,
        impactScore,
        riskScore,
        urgencyScore,
        priorityScore,
        stageConfidence: roundAmount(stageConfidence * 100),
        gapCoverageShare,
        primaryRecommendation: buildDevelopmentRecommendation(item),
      };
    })
    .sort((left, right) => {
      if (right.priorityScore !== left.priorityScore) {
        return right.priorityScore - left.priorityScore;
      }
      return Number(right.amountUsd || 0) - Number(left.amountUsd || 0);
    });
}

function buildDevelopmentRecommendations({ summary, planningSnapshot, priorities, quarterPipeline }) {
  const recommendations = [];
  const quota = planningSnapshot.quota || {};

  if (!planningSnapshot.period?.hasPlan) {
    recommendations.push({
      type: "planning_gap",
      title: `No existe cuota publicada para ${planningSnapshot.period?.label}`,
      detail: "Publica una versión activa en Planeación Comercial para medir avance real contra meta.",
      tone: "medium",
    });
  } else if (Number(quota.gapAmount || 0) > 0) {
    const committedOpenAmount = Number(quota.committedOpenAmount || 0);
    const weightedOpenAmount = Number(quota.weightedOpenAmount || 0);
    recommendations.push({
      type: "quota_gap",
      title: `Faltan ${quota.gapAmount || 0} para cubrir la cuota del trimestre`,
      detail:
        committedOpenAmount >= Number(quota.gapAmount || 0)
          ? "El pipeline comprometido ya cubre la brecha actual, pero depende de ejecutar bien las oportunidades del tramo final."
          : committedOpenAmount + weightedOpenAmount >= Number(quota.gapAmount || 0)
            ? "Lo comprometido no alcanza; necesitas convertir también oportunidades en maduración para cubrir la brecha."
            : "Ni el pipeline comprometido ni el ponderado actuales alcanzan la brecha; hace falta abrir o acelerar cobertura.",
      tone:
        committedOpenAmount >= Number(quota.gapAmount || 0)
          ? "medium"
          : committedOpenAmount + weightedOpenAmount >= Number(quota.gapAmount || 0)
            ? "medium"
            : "high",
    });
  } else {
    recommendations.push({
      type: "quota_on_track",
      title: "La cuota del trimestre ya está cubierta en real",
      detail: "Protege los cierres ganados y reorienta foco a expansión o margen.",
      tone: "low",
    });
  }

  if (summary.withoutNextStep > 0) {
    recommendations.push({
      type: "next_step",
      title: `${summary.withoutNextStep} oportunidad(es) siguen sin siguiente paso`,
      detail: "La prioridad operativa más barata es cerrar conducción visible en oportunidades con monto relevante.",
      tone: "high",
    });
  }

  if (summary.waitingOnInternal > 0 || summary.blockedOpportunities > 0) {
    recommendations.push({
      type: "internal_blockers",
      title: "Hay avance detenido por bloqueos internos",
      detail: `Tienes ${summary.waitingOnInternal || 0} esperando interno y ${summary.blockedOpportunities || 0} bloqueadas. Destrabar interno probablemente mueve más cuota que abrir más pipeline.`,
      tone: "medium",
    });
  }

  const topPriority = priorities[0];
  if (topPriority) {
    recommendations.push({
      type: "focus_opportunity",
      title: `Empieza por ${topPriority.name}`,
      detail: topPriority.primaryRecommendation,
      tone: topPriority.riskLevel === "high" ? "high" : "medium",
      opportunityId: topPriority.id,
    });
  }

  const strongestStage = quarterPipeline[0];
  if (strongestStage && strongestStage.opportunityCount > 0) {
    recommendations.push({
      type: "stage_focus",
      title: `La mayor cobertura del trimestre está en ${strongestStage.stageName}`,
      detail: `Esta etapa concentra ${strongestStage.weightedAmount} ponderados. Vale la pena limpiar vacíos y acelerar decisión aquí antes de abrir más frentes.`,
      tone: "low",
    });
  }

  return recommendations.slice(0, 5);
}

function buildActionsToday({ priorities, activeCadences, pendingInteractions }) {
  const actionItems = [];

  priorities.forEach((item) => {
    if (!item.nextStep) {
      actionItems.push({
        kind: "next_step",
        priorityScore: item.priorityScore + 8,
        opportunityId: item.id,
        opportunityName: item.name,
        accountName: item.accountName,
        title: "Definir siguiente paso",
        detail: item.primaryRecommendation,
        dueDate: null,
      });
    } else if (item.nextStep.isOverdue) {
      actionItems.push({
        kind: "follow_up_overdue",
        priorityScore: item.priorityScore + 12,
        opportunityId: item.id,
        opportunityName: item.name,
        accountName: item.accountName,
        title: item.nextStep.title || "Cerrar seguimiento vencido",
        detail: "El compromiso ya venció y debe renegociarse o completarse hoy.",
        dueDate: item.nextStep.dueDate || null,
      });
    }

    const overdueDependency = (item.dependencies || []).find(
      (dependency) => dependency.isOverdue,
    );
    if (overdueDependency) {
      actionItems.push({
        kind: "dependency",
        priorityScore: item.priorityScore + 10,
        opportunityId: item.id,
        opportunityName: item.name,
        accountName: item.accountName,
        title: overdueDependency.title,
        detail: `Resolver ${overdueDependency.dependencyLabel} para liberar avance comercial.`,
        dueDate: overdueDependency.dueDate || null,
      });
    }
  });

  activeCadences.forEach((cadence) => {
    const nextRunAt = cadence.nextRunAt ? new Date(cadence.nextRunAt) : null;
    if (!nextRunAt || nextRunAt.getTime() <= Date.now()) {
      actionItems.push({
        kind: "cadence",
        priorityScore: 70,
        opportunityId: cadence.opportunityId,
        opportunityName: cadence.opportunityName,
        accountName: cadence.accountName,
        title: cadence.title,
        detail: cadence.currentStepLabel || "Cadencia lista para ejecutarse",
        dueDate: cadence.nextRunAt || null,
      });
    }
  });

  pendingInteractions.slice(0, 4).forEach((item) => {
    actionItems.push({
      kind: "interaction",
      priorityScore: 55,
      opportunityId: item.primaryOpportunityId,
      opportunityName: item.primaryOpportunityName || "Sin oportunidad principal",
      accountName: item.accountName,
      title: item.title,
      detail: "Resolver interacción pendiente que puede destrabar evidencia o avance.",
      dueDate: item.createdAt || null,
    });
  });

  return actionItems
    .sort((left, right) => right.priorityScore - left.priorityScore)
    .slice(0, DEVELOPMENT_ACTION_LIMIT);
}

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

function setLatestActivityTimestamp(
  activityByOpportunity,
  opportunityId,
  value,
) {
  const parsed = value ? new Date(value) : null;
  if (
    !Number.isInteger(opportunityId) ||
    opportunityId <= 0 ||
    !parsed ||
    Number.isNaN(parsed.getTime())
  ) {
    return;
  }

  const current = activityByOpportunity.get(opportunityId);
  if (!current || parsed.getTime() > current.getTime()) {
    activityByOpportunity.set(opportunityId, parsed);
  }
}

async function listLastActivityByOpportunity(opportunityIds) {
  if (!opportunityIds.length) {
    return new Map();
  }

  const placeholders = opportunityIds.map(() => "?").join(", ");
  const actionTypes = Array.from(NEXT_STEP_ACTION_TYPES);
  const actionTypePlaceholders = actionTypes.map(() => "?").join(", ");

  const [actionRows, dependencyRows, answerRows, auditRows, interactionRows] =
    await Promise.all([
      query(
        `SELECT opportunity_id, MAX(COALESCE(updated_at, created_at)) AS last_activity_at
       FROM opportunity_workspace_actions
       WHERE opportunity_id IN (${placeholders})
         AND action_type IN (${actionTypePlaceholders})
       GROUP BY opportunity_id`,
        [...opportunityIds, ...actionTypes],
      ).catch(() => []),
      query(
        `SELECT opportunity_id, MAX(COALESCE(updated_at, created_at)) AS last_activity_at
       FROM commercial_execution_dependencies
       WHERE opportunity_id IN (${placeholders})
       GROUP BY opportunity_id`,
        opportunityIds,
      ).catch(() => []),
      query(
        `SELECT opportunity_id, MAX(answered_at) AS last_activity_at
       FROM opportunity_stage_question_answers
       WHERE opportunity_id IN (${placeholders})
       GROUP BY opportunity_id`,
        opportunityIds,
      ).catch(() => []),
      query(
        `SELECT entity_id AS opportunity_id, MAX(created_at) AS last_activity_at
       FROM audit_log
       WHERE entity_type = 'opportunity'
         AND entity_id IN (${placeholders})
       GROUP BY entity_id`,
        opportunityIds,
      ).catch(() => []),
      query(
        `SELECT related.opportunity_id, MAX(related.created_at) AS last_activity_at
       FROM (
         SELECT i.primary_opportunity_id AS opportunity_id, i.created_at
         FROM interactions i
         WHERE i.primary_opportunity_id IN (${placeholders})

         UNION ALL

         SELECT l.opportunity_id, i.created_at
         FROM interaction_opportunity_links l
         INNER JOIN interactions i ON i.id = l.interaction_id
         WHERE l.opportunity_id IN (${placeholders})
       ) related
       GROUP BY related.opportunity_id`,
        [...opportunityIds, ...opportunityIds],
      ).catch(() => []),
    ]);

  const activityByOpportunity = new Map();
  for (const row of [
    ...actionRows,
    ...dependencyRows,
    ...answerRows,
    ...auditRows,
    ...interactionRows,
  ]) {
    setLatestActivityTimestamp(
      activityByOpportunity,
      Number(row.opportunity_id),
      row.last_activity_at,
    );
  }

  return activityByOpportunity;
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

function getUniqueTexts(values, limit = 4) {
  return Array.from(
    new Set(
      (values || []).map((value) => String(value || "").trim()).filter(Boolean),
    ),
  ).slice(0, limit);
}

function determineCadenceType(opportunityItem) {
  const openDependencies = (opportunityItem.dependencies || []).filter(
    (dependency) =>
      dependency.status === "open" || dependency.status === "blocked",
  );
  const overdueDependencies = openDependencies.filter(
    (dependency) => dependency.isOverdue,
  );
  if (
    overdueDependencies.length > 0 ||
    opportunityItem.daysSinceActivity >= opportunityItem.slaDays + 2 ||
    (!opportunityItem.nextStep &&
      opportunityItem.daysSinceActivity > opportunityItem.slaDays)
  ) {
    return "rescue_inactive";
  }
  if (
    ["propuesta", "negociacion", "cierre", "waiting"].includes(
      opportunityItem.stageCode,
    ) ||
    opportunityItem.nextStep?.actionType === "waiting_customer"
  ) {
    return "proposal_conversion";
  }
  return "discovery_push";
}

function buildCadenceSuggestionAssessment(opportunityItem) {
  const reasons = [];
  const protectiveSignals = [];
  const openDependencies = (opportunityItem.dependencies || []).filter(
    (dependency) =>
      dependency.status === "open" || dependency.status === "blocked",
  );
  const overdueDependencies = openDependencies.filter(
    (dependency) => dependency.isOverdue,
  );
  const nextStep = opportunityItem.nextStep;

  let score = 0;
  if (!nextStep) {
    score += 50;
    reasons.push("Sin proximo paso vigente");
  }
  if (nextStep?.isOverdue) {
    score += 28;
    reasons.push("Proximo paso vencido");
  }
  if (opportunityItem.daysSinceActivity > opportunityItem.slaDays + 4) {
    score += 24;
    reasons.push(
      `Inactividad severa: ${opportunityItem.daysSinceActivity} dias sin movimiento`,
    );
  } else if (opportunityItem.daysSinceActivity > opportunityItem.slaDays + 2) {
    score += 20;
    reasons.push(
      `Inactividad alta: ${opportunityItem.daysSinceActivity} dias sin movimiento`,
    );
  } else if (opportunityItem.daysSinceActivity > opportunityItem.slaDays) {
    score += 14;
    reasons.push(`SLA vencido en etapa ${opportunityItem.stageName}`);
  }
  if (openDependencies.length > 0) {
    score += Math.min(12, openDependencies.length * 4);
    reasons.push(
      `${openDependencies.length} dependencia(s) interna(s) abierta(s)`,
    );
  }
  if (overdueDependencies.length > 0) {
    score += Math.min(20, overdueDependencies.length * 10);
    reasons.push(
      `${overdueDependencies.length} dependencia(s) interna(s) vencida(s)`,
    );
  }
  if (nextStep?.actionType === "waiting_customer") {
    score += 10;
    reasons.push("Respuesta del cliente pendiente de cierre");
  }
  if (opportunityItem.riskLevel === "high") {
    score += 16;
    reasons.push("Riesgo operativo alto");
  } else if (opportunityItem.riskLevel === "medium") {
    score += 10;
    reasons.push("Riesgo operativo medio");
  }
  if (opportunityItem.criticalWeaknessCount > 0) {
    score += Math.min(14, opportunityItem.criticalWeaknessCount * 7);
    reasons.push(
      `${opportunityItem.criticalWeaknessCount} debilidad(es) critica(s) abierta(s)`,
    );
  }
  if (opportunityItem.decisionRiskTone === "red") {
    score += 10;
    reasons.push("Riesgo de decision o sponsor insuficiente");
  }
  if (
    ["propuesta", "negociacion", "cierre", "waiting"].includes(
      opportunityItem.stageCode,
    )
  ) {
    score += 6;
  }

  let nextStepProtection = 0;
  if (nextStep && !nextStep.isOverdue) {
    nextStepProtection += 12;
    protectiveSignals.push("Tiene siguiente paso vigente");
    if (nextStep.dueDate) {
      nextStepProtection += 8;
      protectiveSignals.push("Tiene fecha de seguimiento confirmada");
    }
    if (nextStep.successCriteria?.trim()) {
      nextStepProtection += 8;
      protectiveSignals.push("Tiene criterio de exito definido");
    }
    if (nextStep.ownerUserId) {
      nextStepProtection += 6;
      protectiveSignals.push("Tiene responsable asignado");
    }
  }
  if (
    opportunityItem.daysSinceActivity <=
    Math.max(1, Math.floor(opportunityItem.slaDays / 2))
  ) {
    nextStepProtection += 8;
    protectiveSignals.push("Tiene actividad comercial reciente");
  }

  const boundedScore = Math.max(
    0,
    Math.min(100, score - Math.min(34, nextStepProtection)),
  );
  const cadenceDecision =
    boundedScore >= 70 ? "activate" : boundedScore >= 50 ? "watch" : "none";

  return {
    frictionScore: boundedScore,
    cadenceDecision,
    frictionReasons: getUniqueTexts(
      [...reasons, ...(opportunityItem.riskReasons || [])],
      4,
    ),
    protectiveSignals: getUniqueTexts(protectiveSignals, 3),
    hasGoodNextStep: nextStepProtection >= 28,
  };
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

  const assessment = buildCadenceSuggestionAssessment(opportunityItem);
  if (assessment.cadenceDecision === "none") {
    return null;
  }

  const cadenceType = determineCadenceType(opportunityItem);
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
    frictionScore: assessment.frictionScore,
    cadenceDecision: assessment.cadenceDecision,
    frictionReasons: assessment.frictionReasons,
    protectiveSignals: assessment.protectiveSignals,
    hasGoodNextStep: assessment.hasGoodNextStep,
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
    const quarterSelection = resolveQuarterSelection(req.query || {});
    const developmentPeriods = await listDevelopmentPeriods();
    const stagesCatalog = await listActiveSalesStages();
    const opportunityRows = await listAccessibleOpportunities(req.user);
    const opportunityIds = opportunityRows.map((row) => Number(row.id));
    const recommendationCatalog =
      await loadCommercialEnablementRecommendationCatalog();
    const dependencyRows = await listOpenDependencies(opportunityIds);
    const lastActivityByOpportunity =
      await listLastActivityByOpportunity(opportunityIds);
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
          lastActivityByOpportunity.get(Number(row.id)) ||
          (row.updated_at ? new Date(row.updated_at) : null) ||
          new Date();
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
      .sort((left, right) => {
        const decisionDelta =
          (right.cadenceDecision === "activate" ? 1 : 0) -
          (left.cadenceDecision === "activate" ? 1 : 0);
        if (decisionDelta !== 0) {
          return decisionDelta;
        }
        if (right.frictionScore !== left.frictionScore) {
          return right.frictionScore - left.frictionScore;
        }
        return String(left.opportunityName || "").localeCompare(
          String(right.opportunityName || ""),
          "es",
        );
      });
    const activateCount = suggestedCadences.filter(
      (item) => item.cadenceDecision === "activate",
    ).length;
    const watchCount = suggestedCadences.filter(
      (item) => item.cadenceDecision === "watch",
    ).length;

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

    const planningSnapshot = await loadPlanningSnapshot({
      user: req.user,
      year: quarterSelection.year,
      quarter: quarterSelection.quarter,
      openItems: executionItems,
    });

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

    const summary = {
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
    };

    const priorityItems = buildPriorityItems(executionItems, planningSnapshot);
    const quarterPipeline = buildPipelineByStage(
      executionItems.filter((item) =>
        isDateWithinQuarter(
          item.closeDate,
          planningSnapshot.period.year,
          planningSnapshot.period.quarter,
        ),
      ),
      planningSnapshot.quota.gapAmount,
    );
    const developmentRecommendations = buildDevelopmentRecommendations({
      summary,
      planningSnapshot,
      priorities: priorityItems,
      quarterPipeline,
    });
    const actionsToday = buildActionsToday({
      priorities: priorityItems,
      activeCadences,
      pendingInteractions,
    });

    res.json({
      summary,
      workboard: executionItems,
      followUps,
      risks: highRisks,
      cadences: {
        active: activeCadences,
        suggested: suggestedCadences,
        totalSuggested: suggestedCadences.length,
        activateCount,
        watchCount,
        visibleLimit: CADENCE_VISIBLE_LIMIT,
      },
      pendingInteractions,
      management: {
        sellerStats,
        stageStats,
        executionStateStats,
        dependencyStats,
      },
      development: {
        period: planningSnapshot.period,
        periods: developmentPeriods,
        quota: planningSnapshot.quota,
        sellerSnapshots: planningSnapshot.sellerSnapshots,
        pipelineByStage: quarterPipeline,
        priorities: priorityItems.slice(0, DEVELOPMENT_PRIORITY_LIMIT),
        recommendations: developmentRecommendations,
        actionsToday,
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
