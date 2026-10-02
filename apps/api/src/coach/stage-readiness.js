import { stageReadinessSchema } from "./contract.js";
import { matchCoachQueryCase } from "./case-catalog.js";

const COMPLETED_ACTION_STATUSES = new Set(["done", "completed"]);
const CLOSED_RISK_STATUSES = new Set(["resolved", "closed", "dismissed"]);
const CONFIRMED_CRITERION_STATUSES = new Set(["solid", "waived"]);
const BLOCKING_CRITERION_STATUSES = new Set(["blocked"]);
const SEVERITY_ORDER = { low: 1, medium: 2, high: 3, critical: 4 };

function clean(value, fallback = "") {
  return String(value || fallback)
    .replace(/\s+/g, " ")
    .trim();
}

function dateOnly(value) {
  const match = String(value || "").match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function addUtcDays(now, days) {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function evidence(sourceType, sourceId, label, excerpt = null) {
  return {
    sourceType,
    sourceId: Number(sourceId || 0) || null,
    label: clean(label, "Evidencia comercial").slice(0, 300),
    excerpt: clean(excerpt).slice(0, 1200) || null,
  };
}

function normalizeSeverity(value) {
  const severity = clean(value).toLowerCase();
  return Object.hasOwn(SEVERITY_ORDER, severity) ? severity : "medium";
}

function openActions(opportunity) {
  return (opportunity?.workspace?.actions || []).filter(
    (action) =>
      !COMPLETED_ACTION_STATUSES.has(clean(action?.status).toLowerCase()),
  );
}

function buildNextStep(opportunity, pendingItems, risks, currentUserId, now) {
  const actions = openActions(opportunity);
  const action = actions.find((item) => item.primary) || actions[0] || null;
  if (action) {
    return {
      action: clean(
        action.title,
        "Completar el siguiente paso comercial",
      ).slice(0, 800),
      responsibleUserId:
        Number(action.ownerUserId || 0) || Number(currentUserId || 0) || null,
      targetDate:
        dateOnly(action.dueDate || action.scheduledAt) || addUtcDays(now, 7),
      successCriteria: clean(
        action.successCriteria,
        "Registrar el resultado y la evidencia del compromiso acordado con el cliente.",
      ).slice(0, 1200),
    };
  }

  const pending = pendingItems[0];
  const risk = risks[0];
  const actionTitle = pending
    ? `Resolver: ${pending.title}`
    : risk
      ? `Mitigar: ${risk.title}`
      : "Validar con el cliente el cumplimiento de la etapa";
  return {
    action: actionTitle.slice(0, 800),
    responsibleUserId: Number(currentUserId || 0) || null,
    targetDate: addUtcDays(now, 7),
    successCriteria: clean(
      pending?.detail ||
        risk?.mitigation ||
        opportunity?.currentStage?.expectedOutcome,
      "Dejar evidencia verificable del resultado esperado de la etapa.",
    ).slice(0, 1200),
  };
}

export function isStagePreparationQuestion(question) {
  if (matchCoachQueryCase(question)?.type === "stage_readiness") return true;
  const text = clean(question)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return [
    /que me falta.*(?:avanz|pasar|etapa|cotiz|demo|negoci)/,
    /(?:lista|listo|preparad[ao]).*(?:avanz|pasar|cotiz|demo|negoci)/,
    /(?:avanzar|pasar).*(?:etapa|desarrollo|cotizacion|demostracion|negociacion|waiting)/,
    /preguntas?.*(?:sin respuesta|pendiente)/,
    /preguntas?.*(?:debo|deberia|conviene).*(?:hacer|preguntar|plantear|cotiz|demostracion|negociacion|waiting)/,
    /(?:antes de|para).*(?:cotizar|demostracion|demo|negociacion)/,
    /(?:riesgo|bloqueo).*(?:impide|frena|avanz)/,
    /(?:preparacion|readiness).*(?:etapa|oportunidad)/,
  ].some((pattern) => pattern.test(text));
}

export function buildStageReadiness(
  opportunity,
  { currentUserId = null, now = new Date() } = {},
) {
  if (!opportunity || Number(opportunity.id || 0) <= 0) return null;

  const stage = opportunity.currentStage || {};
  const stageId = Number(opportunity.salesStageId || stage.id || 0);
  if (!stageId) return null;

  const confirmedProgress = [];
  const pendingItems = [];
  const risks = [];
  const questions = Array.isArray(opportunity.stageQuestions)
    ? opportunity.stageQuestions
    : [];
  const assessments = Array.isArray(opportunity.workspace?.criteria)
    ? opportunity.workspace.criteria
    : [];
  const assessmentByCode = new Map(
    assessments.map((item) => [clean(item.code), item]),
  );

  for (const question of questions) {
    const answered = Boolean(clean(question.answer));
    const item = {
      title: clean(question.prompt, question.code || "Pregunta de etapa").slice(
        0,
        300,
      ),
      detail: answered
        ? clean(question.answer).slice(0, 1600)
        : `${question.required ? "Pregunta obligatoria" : "Pregunta"} sin respuesta en la etapa actual.`,
      evidence: answered
        ? [
            evidence(
              "stage_answer",
              question.questionId,
              question.prompt,
              question.answer,
            ),
          ]
        : [
            evidence(
              "process_guide",
              null,
              "Pregunta definida por el proceso comercial",
              question.prompt,
            ),
          ],
    };
    (answered ? confirmedProgress : pendingItems).push(item);
  }

  for (const criterion of stage.criteria || []) {
    const assessment = assessmentByCode.get(clean(criterion.code));
    const status = clean(assessment?.status, "missing").toLowerCase();
    const item = {
      title: clean(
        criterion.title,
        criterion.code || "Criterio de etapa",
      ).slice(0, 300),
      detail: clean(
        assessment?.summary,
        criterion.description ||
          "No existe evidencia suficiente para confirmar este criterio.",
      ).slice(0, 1600),
      evidence: assessment?.evidenceCount
        ? [
            evidence(
              "crm_context",
              opportunity.id,
              "Evaluación registrada del criterio",
              assessment.summary,
            ),
          ]
        : [
            evidence(
              "process_guide",
              null,
              "Criterio definido por el proceso comercial",
              criterion.description,
            ),
          ],
    };
    if (CONFIRMED_CRITERION_STATUSES.has(status)) {
      confirmedProgress.push(item);
    } else {
      pendingItems.push(item);
    }
    if (BLOCKING_CRITERION_STATUSES.has(status)) {
      risks.push({
        ...item,
        severity: "critical",
        mitigation: `Resolver el bloqueo del criterio ${item.title} antes de avanzar.`,
      });
    }
  }

  for (const action of opportunity.workspace?.actions || []) {
    if (!COMPLETED_ACTION_STATUSES.has(clean(action.status).toLowerCase()))
      continue;
    confirmedProgress.push({
      title: clean(action.title, "Actividad completada").slice(0, 300),
      detail: clean(
        action.successCriteria || action.notes,
        "Actividad comercial completada y registrada.",
      ).slice(0, 1600),
      evidence: [evidence("activity", action.id, action.title, action.notes)],
    });
  }

  for (const weakness of opportunity.workspace?.weaknesses || []) {
    if (CLOSED_RISK_STATUSES.has(clean(weakness.status).toLowerCase()))
      continue;
    risks.push({
      title: clean(weakness.title, "Riesgo comercial").slice(0, 300),
      detail: clean(
        weakness.detail,
        "Existe un riesgo abierto sin detalle adicional.",
      ).slice(0, 1600),
      evidence: [
        evidence(
          "crm_context",
          opportunity.id,
          weakness.category || "Riesgo registrado",
          weakness.detail,
        ),
      ],
      severity: normalizeSeverity(weakness.severity),
      mitigation: clean(weakness.mitigation).slice(0, 1200) || null,
    });
  }

  for (const reason of opportunity.riskReasons || []) {
    const title = clean(reason);
    if (!title || risks.some((risk) => risk.title === title)) continue;
    risks.push({
      title: title.slice(0, 300),
      detail: title.slice(0, 1600),
      evidence: [
        evidence(
          "opportunity",
          opportunity.id,
          "Señal calculada del CRM",
          title,
        ),
      ],
      severity: /sin.*siguiente paso/i.test(title) ? "high" : "medium",
      mitigation: /sin.*siguiente paso/i.test(title)
        ? "Definir una actividad concreta, responsable, fecha y criterio de éxito."
        : "Actualizar el seguimiento y registrar el resultado de la próxima interacción.",
    });
  }

  if (!questions.length && !(stage.criteria || []).length) {
    pendingItems.push({
      title: "Criterios de etapa no configurados",
      detail:
        "No hay preguntas ni criterios activos para evaluar de forma verificable esta etapa.",
      evidence: [
        evidence("process_guide", null, "Configuración del proceso comercial"),
      ],
    });
  }

  const requiredQuestionsMissing = questions.some(
    (question) => question.required && !clean(question.answer),
  );
  const requiredCriteria = (stage.criteria || []).filter(
    (criterion) => criterion.required !== false,
  );
  const requiredCriteriaIncomplete = requiredCriteria.some((criterion) => {
    const status = clean(
      assessmentByCode.get(clean(criterion.code))?.status,
      "missing",
    ).toLowerCase();
    return !CONFIRMED_CRITERION_STATUSES.has(status);
  });
  const hasBlocker = risks.some((risk) => risk.severity === "critical");
  const hasMaterialRisk = risks.some(
    (risk) => SEVERITY_ORDER[risk.severity] >= SEVERITY_ORDER.medium,
  );
  const hasConfiguredChecks =
    questions.length > 0 || (stage.criteria || []).length > 0;

  let recommendation = "advance";
  let rationale =
    "Las preguntas obligatorias y los criterios requeridos cuentan con respaldo verificable.";
  if (
    hasBlocker ||
    requiredQuestionsMissing ||
    requiredCriteriaIncomplete ||
    !hasConfiguredChecks
  ) {
    recommendation = "remain";
    rationale = hasBlocker
      ? "Existe al menos un bloqueo crítico que debe resolverse antes de avanzar."
      : "Persisten preguntas o criterios pendientes que impiden confirmar el cumplimiento de la etapa.";
  } else if (hasMaterialRisk || pendingItems.length) {
    recommendation = "advance_with_caution";
    rationale =
      "Los criterios están respaldados, pero existen riesgos abiertos que requieren seguimiento explícito.";
  }

  const result = {
    currentStage: {
      id: stageId,
      code: clean(stage.code, opportunity.stageCode || "etapa_actual").slice(
        0,
        100,
      ),
      name: clean(stage.name, opportunity.stageName || "Etapa actual").slice(
        0,
        200,
      ),
      objective: clean(
        stage.objective,
        stage.expectedOutcome ||
          "Completar los criterios comerciales definidos para la etapa.",
      ).slice(0, 1600),
    },
    confirmedProgress: confirmedProgress.slice(0, 30),
    pendingItems: pendingItems.slice(0, 30),
    risks: risks
      .sort(
        (left, right) =>
          SEVERITY_ORDER[right.severity] - SEVERITY_ORDER[left.severity],
      )
      .slice(0, 30),
    nextStep: buildNextStep(
      opportunity,
      pendingItems,
      risks,
      currentUserId,
      now,
    ),
    recommendation,
    rationale,
  };

  return stageReadinessSchema.parse(result);
}
