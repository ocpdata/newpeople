import { query } from "../db.js";
import { ensureOpportunityWorkspaceSchema } from "./schema.js";

const DEFAULT_PLAYBOOK_CODE = "default_b2b_sales_workspace";

const DEFAULT_THEME_DEFINITIONS = [
  { code: "need", name: "Dolor o necesidad" },
  { code: "technical", name: "Requerimiento tecnico" },
  { code: "budget", name: "Presupuesto" },
  { code: "timeline", name: "Timeline" },
  { code: "stakeholders", name: "Decisores" },
  { code: "competition", name: "Ventaja competitiva" },
  { code: "strategy", name: "Estrategia" },
  { code: "risk", name: "Riesgos y objeciones" },
  { code: "commercial", name: "Condiciones comerciales" },
  { code: "validation", name: "Aceptacion y validacion" },
];

const THEME_DOCUMENT_HINTS = {
  need: ["necesidad", "dolor", "problema", "objetivo", "urgencia"],
  technical: [
    "arquitectura",
    "tecnico",
    "infraestructura",
    "integracion",
    "waf",
    "dns",
    "api",
    "balanceo",
  ],
  budget: ["presupuesto", "inversion", "monto", "costo", "capex", "opex"],
  timeline: [
    "fecha",
    "timeline",
    "plazo",
    "siguiente paso",
    "proxima reunion",
    "semana",
    "mes",
  ],
  stakeholders: [
    "director",
    "gerente",
    "compras",
    "finanzas",
    "cfo",
    "cto",
    "infraestructura",
    "seguridad",
  ],
  competition: [
    "competencia",
    "competidor",
    "postor",
    "alternativa",
    "f5",
    "bluecat",
  ],
  strategy: ["estrategia", "plan", "avance", "siguiente paso", "ruta"],
  risk: ["riesgo", "objecion", "bloqueo", "dependencia", "restriccion"],
  commercial: [
    "descuento",
    "condiciones",
    "comercial",
    "contrato",
    "orden de compra",
  ],
  validation: [
    "demo",
    "validacion",
    "aceptacion",
    "criterio de exito",
    "prueba",
  ],
};

const STAKEHOLDER_HINTS = [
  {
    roleCode: "economic_buyer",
    roleLabel: "Compras / Finanzas",
    patterns: ["compras", "finanzas", "cfo", "contralor", "procurement"],
    influenceLevel: "high",
  },
  {
    roleCode: "technical_buyer",
    roleLabel: "Lider tecnico / Infraestructura",
    patterns: [
      "director de infraestructura",
      "gerente de infraestructura",
      "arquitectura",
      "cto",
      "seguridad",
      "red",
      "infraestructura",
    ],
    influenceLevel: "high",
  },
  {
    roleCode: "sponsor",
    roleLabel: "Sponsor de negocio",
    patterns: ["director", "vp", "vicepresidente", "patrocinador", "sponsor"],
    influenceLevel: "critical",
  },
];

const DEFAULT_STAGE_DELIVERABLE_BY_CODE = {
  contacto_inicial: {
    deliverableType: "meeting_brief",
    title: "Brief de contacto y necesidad",
    audience: "Equipo comercial",
  },
  identificacion_oportunidad: {
    deliverableType: "discovery_summary",
    title: "Resumen de discovery y motivacion",
    audience: "Cliente y preventa",
  },
  desarrollo: {
    deliverableType: "solution_brief",
    title: "Resumen ejecutivo de solucion",
    audience: "Cliente",
  },
  cotizacion: {
    deliverableType: "commercial_proposal",
    title: "Propuesta comercial enviada",
    audience: "Cliente",
  },
  demostracion: {
    deliverableType: "demo_plan",
    title: "Guion y objetivos de demostracion",
    audience: "Cliente y equipo tecnico",
  },
  negociacion: {
    deliverableType: "negotiation_plan",
    title: "Plan de negociacion y concesiones",
    audience: "Equipo comercial",
  },
  waiting: {
    deliverableType: "closing_plan",
    title: "Plan de cierre y orden de compra",
    audience: "Equipo comercial",
  },
};

const PLAYBOOK_STAGE_DEFINITIONS = [
  {
    stageCode: "contacto_inicial",
    objective:
      "Confirmar una necesidad concreta del cliente y asegurar un siguiente paso de seguimiento o validacion.",
    exitCriteriaSummary:
      "Necesidad concreta documentada, interes verificable y siguiente reunion o paso acordado.",
    criteria: [
      {
        code: "contacto_need",
        title: "Necesidad concreta identificada",
        description:
          "El cliente expresa un problema, iniciativa o interes real que justifica la oportunidad.",
        themeCode: "need",
      },
      {
        code: "contacto_follow_up",
        title: "Siguiente paso acordado",
        description:
          "Existe reunion, demo o siguiente actividad concreta para continuar el desarrollo.",
        themeCode: "timeline",
      },
    ],
  },
  {
    stageCode: "identificacion_oportunidad",
    objective:
      "Determinar si existe una oportunidad real de compra y definir estrategia de desarrollo.",
    exitCriteriaSummary:
      "Motivacion, requerimiento, presupuesto, fecha, decisores, fortalezas y estrategia documentados.",
    criteria: [
      {
        code: "identificacion_requerimiento_tecnico",
        title: "Requerimiento tecnico",
        themeCode: "technical",
      },
      {
        code: "identificacion_motivacion_principal",
        title: "Motivacion de negocio",
        themeCode: "need",
      },
      {
        code: "identificacion_presupuesto_cliente",
        title: "Presupuesto",
        themeCode: "budget",
      },
      {
        code: "identificacion_fecha_adquisicion",
        title: "Fecha critica",
        themeCode: "timeline",
      },
      {
        code: "identificacion_decisor_proceso_compra",
        title: "Proceso de compra y decisores",
        themeCode: "stakeholders",
      },
      {
        code: "identificacion_ventajas_fortalezas",
        title: "Fortaleza competitiva",
        themeCode: "competition",
      },
      {
        code: "identificacion_estrategia",
        title: "Estrategia de avance",
        themeCode: "strategy",
      },
    ],
  },
  {
    stageCode: "desarrollo",
    objective:
      "Diseñar y validar una propuesta tecnica alineada con necesidad, restricciones y riesgos del cliente.",
    exitCriteriaSummary:
      "Propuesta clara, puntos tecnicos, riesgos, aceptacion preliminar y condiciones del cliente visibles.",
    criteria: [
      {
        code: "desarrollo_informacion_adicional",
        title: "Informacion adicional",
        themeCode: "technical",
      },
      {
        code: "desarrollo_presentacion_solucion",
        title: "Presentacion de la solucion",
        themeCode: "validation",
      },
      {
        code: "desarrollo_propuesta",
        title: "Propuesta tecnica",
        themeCode: "technical",
      },
      {
        code: "desarrollo_puntos_tecnicos",
        title: "Puntos tecnicos criticos",
        themeCode: "risk",
      },
      {
        code: "desarrollo_aceptacion_propuesta",
        title: "Aceptacion preliminar",
        themeCode: "validation",
      },
      {
        code: "desarrollo_observaciones_condiciones",
        title: "Condiciones y objeciones",
        themeCode: "risk",
      },
      {
        code: "desarrollo_riesgo_tecnico",
        title: "Riesgos tecnicos",
        themeCode: "risk",
      },
    ],
  },
  {
    stageCode: "cotizacion",
    objective:
      "Presentar una propuesta economica y comercial competitiva y alineada con el cliente.",
    exitCriteriaSummary:
      "Alineacion economica y condiciones comerciales validadas.",
    criteria: [
      {
        code: "cotizacion_propuesta_economica",
        title: "Alineacion economica",
        themeCode: "budget",
      },
      {
        code: "cotizacion_condiciones_comerciales",
        title: "Condiciones comerciales",
        themeCode: "commercial",
      },
    ],
  },
  {
    stageCode: "demostracion",
    objective:
      "Ejecutar una demostracion con criterios de exito claros y acordar el siguiente paso posterior.",
    exitCriteriaSummary:
      "Motivo, criterios de exito, resultado y siguientes pasos documentados.",
    criteria: [
      {
        code: "demostracion_motivo",
        title: "Motivo de la demo",
        themeCode: "need",
      },
      {
        code: "demostracion_criterios_exito",
        title: "Criterios de exito",
        themeCode: "validation",
      },
      {
        code: "demostracion_siguientes_pasos",
        title: "Siguientes pasos",
        themeCode: "timeline",
      },
      {
        code: "demostracion_resultado",
        title: "Resultado y reaccion",
        themeCode: "validation",
      },
    ],
  },
  {
    stageCode: "negociacion",
    objective:
      "Proteger el valor del acuerdo mientras se acomodan condiciones aceptables para ambas partes.",
    exitCriteriaSummary:
      "Limites claros, prioridades del cliente y puntos a proteger definidos.",
    criteria: [
      {
        code: "negociacion_precio_condiciones",
        title: "Precio y condiciones",
        themeCode: "commercial",
      },
      {
        code: "negociacion_puntos_cliente",
        title: "Prioridades del cliente",
        themeCode: "stakeholders",
      },
      {
        code: "negociacion_puntos_nosotros",
        title: "Puntos a proteger",
        themeCode: "strategy",
      },
    ],
  },
  {
    stageCode: "waiting",
    objective:
      "Acompanar el tramo final hasta la orden de compra y detectar riesgos de perdida tardia.",
    exitCriteriaSummary:
      "Acuerdo alcanzado, estado competitivo claro y seguimiento a proceso de compra activo.",
    criteria: [
      {
        code: "waiting_acuerdo_o_postores",
        title: "Acuerdo o postores restantes",
        themeCode: "competition",
      },
      {
        code: "waiting_follow_up_plan",
        title: "Plan de seguimiento activo",
        themeCode: "timeline",
      },
      {
        code: "waiting_purchase_path",
        title: "Ruta de aprobacion conocida",
        themeCode: "stakeholders",
      },
    ],
  },
];

const COMMERCIAL_PROCESS_ACTIONS = {
  contacto_inicial: [
    "Aterrizar la necesidad concreta del prospecto y documentar por que vale la pena seguir invirtiendo tiempo comercial.",
    "Usar un mensaje breve de presentacion conectado con su sector para despertar interes real, no curiosidad superficial.",
    "Hacer preguntas abiertas sobre objetivos, desafios actuales y forma de resolver hoy el problema.",
    "Cerrar la etapa solo cuando exista una reunion de seguimiento o una sesion con equipo tecnico ya acordada.",
  ],
  identificacion_oportunidad: [
    "Documentar motivacion de negocio, requerimiento tecnico, presupuesto, fecha critica y proceso de compra.",
    "Preguntar explicitamente quien decide, quien puede vetar y como se aprueba internamente la compra.",
    "Identificar ventajas competitivas especificas para esta cuenta y evitar quedar condicionados por la narrativa del competidor.",
    "Definir una estrategia concreta de avance antes de comprometer mas recursos de preventa o fabricante.",
  ],
  desarrollo: [
    "Profundizar el levantamiento tecnico y validar arquitectura, integraciones, seguridad, volumen y restricciones del cliente.",
    "Presentar la solucion con diagrama, propuesta tecnica, riesgos visibles y criterios de aceptacion medibles.",
    "Registrar objeciones, condiciones y riesgos tecnicos para que no aparezcan tarde en cotizacion o negociacion.",
    "Cerrar la etapa con aceptacion preliminar clara de la propuesta tecnica y del camino de implementacion.",
  ],
  cotizacion: [
    "Alinear la propuesta economica con el presupuesto real del cliente y presentar opciones comparables de inversion.",
    "Incluir condiciones comerciales competitivas, flexibilidad de pago y narrativa clara de ROI o costo de no actuar.",
    "Programar una reunion de revision de cotizacion dentro de 48 a 72 horas en lugar de solo enviar el documento.",
    "Preparar de antemano respuestas a objeciones de precio, tiempos y condiciones comerciales.",
  ],
  demostracion: [
    "Personalizar la demostracion alrededor del dolor principal, no alrededor de todas las funcionalidades del portafolio.",
    "Definir criterios de exito medibles antes de la demo y confirmar asistencia de decisores y evaluadores clave.",
    "Acordar por escrito el siguiente paso si la demo cumple los criterios esperados.",
    "Enviar resumen ejecutivo y compromisos de avance dentro de las 24 horas posteriores a la demostracion.",
  ],
  negociacion: [
    "Entrar a negociar con limites claros, BATNA definida y paquetes alternativos preparados.",
    "Defender valor total, soporte y menor riesgo operativo antes de conceder descuento directo.",
    "Distinguir lo negociable de lo no negociable para proteger margen y capacidad de implementacion.",
    "Llevar cada concesion a un intercambio concreto que acelere firma, volumen o plazo de contrato.",
  ],
  waiting: [
    "Mantener seguimiento activo al flujo de aprobacion, orden de compra y revisiones internas del cliente.",
    "Confirmar que seguimos posicionados frente a otros postores y que no hay riesgo de no decision silenciosa.",
    "Mapear los hitos finales de compras, legal y finanzas con fechas y responsables.",
    "Usar esta etapa para remover friccion de cierre, no para esperar pasivamente noticias del cliente.",
  ],
};

const CRITERION_ANSWER_ALIASES = {
  contacto_need: ["contacto_inicial_interes_cliente"],
};

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function compactWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildWorkspaceDocumentText(document) {
  return compactWhitespace(
    [
      document?.contentSummary,
      document?.transcriptText,
      document?.rawText,
      document?.normalizedText,
      document?.originalFileName,
    ]
      .filter(Boolean)
      .join(" \n "),
  );
}

function summarizeSnippet(text, keyword) {
  const haystack = String(text || "");
  if (!haystack) return "";
  const normalizedHaystack = normalizeText(haystack);
  const normalizedKeyword = normalizeText(keyword);
  const foundIndex = normalizedHaystack.indexOf(normalizedKeyword);
  if (foundIndex === -1) {
    return haystack.slice(0, 180).trim();
  }
  const start = Math.max(0, foundIndex - 80);
  const end = Math.min(
    haystack.length,
    foundIndex + normalizedKeyword.length + 100,
  );
  return compactWhitespace(haystack.slice(start, end)).slice(0, 220);
}

function buildDocumentEvidenceByTheme(documents) {
  const docs = Array.isArray(documents) ? documents : [];
  const evidenceByTheme = new Map(
    Object.keys(THEME_DOCUMENT_HINTS).map((themeCode) => [themeCode, []]),
  );

  for (const document of docs) {
    const fullText = buildWorkspaceDocumentText(document);
    const normalized = normalizeText(fullText);
    if (!normalized) continue;

    for (const [themeCode, hints] of Object.entries(THEME_DOCUMENT_HINTS)) {
      const matchedKeyword = hints.find((keyword) =>
        normalized.includes(normalizeText(keyword)),
      );
      if (!matchedKeyword) continue;
      evidenceByTheme.get(themeCode).push({
        sourceType: "document",
        sourceLabel:
          document.originalFileName || document.publicId || "Documento",
        sourceRefId: document.publicId || null,
        excerpt: summarizeSnippet(fullText, matchedKeyword),
        keyword: matchedKeyword,
      });
    }
  }

  return evidenceByTheme;
}

function extractSuggestedStakeholdersFromDocuments({
  documents,
  stakeholders,
}) {
  const existingKeys = new Set(
    (Array.isArray(stakeholders) ? stakeholders : []).map((item) =>
      normalizeText(item.roleLabel || item.roleCode || item.name),
    ),
  );
  const suggestions = [];
  const docs = Array.isArray(documents) ? documents : [];

  for (const document of docs) {
    const fullText = buildWorkspaceDocumentText(document);
    const normalized = normalizeText(fullText);
    if (!normalized) continue;

    for (const hint of STAKEHOLDER_HINTS) {
      const matchedKeyword = hint.patterns.find((pattern) =>
        normalized.includes(normalizeText(pattern)),
      );
      if (!matchedKeyword) continue;
      const dedupeKey = normalizeText(hint.roleLabel);
      if (existingKeys.has(dedupeKey)) continue;
      existingKeys.add(dedupeKey);
      suggestions.push({
        key: `${hint.roleCode}:${document.publicId || matchedKeyword}`,
        name: hint.roleLabel,
        roleCode: hint.roleCode,
        roleLabel: hint.roleLabel,
        influenceLevel: hint.influenceLevel,
        supportLevel: "neutral",
        status: "identified",
        concerns: "Detectado desde evidencia documental del cliente.",
        priorities: summarizeSnippet(fullText, matchedKeyword),
        sourceLabel:
          document.originalFileName || document.publicId || "Documento",
      });
    }
  }

  return suggestions;
}

function buildAnswerMap(answers) {
  return new Map(
    (Array.isArray(answers) ? answers : []).map((answer) => [
      String(answer.code || answer.question_code || ""),
      answer,
    ]),
  );
}

function getCriterionAnswer(answerMap, criterionCode) {
  const directCode = String(criterionCode || "");
  if (answerMap.has(directCode)) {
    return answerMap.get(directCode);
  }

  const aliases = CRITERION_ANSWER_ALIASES[directCode] || [];
  for (const alias of aliases) {
    if (answerMap.has(alias)) {
      return answerMap.get(alias);
    }
  }

  return null;
}

function deriveFollowUpAssessment({ criterion, stageCode, stageId, actions }) {
  const relevantActions = (Array.isArray(actions) ? actions : []).filter(
    (action) => {
      const linkedStageMatches =
        stageId && Number(action.linkedStageId) === Number(stageId);
      if (linkedStageMatches) return true;
      return (
        !action.linkedStageId &&
        String(action.linkedThemeCode || "") === "timeline" &&
        stageCode === "contacto_inicial"
      );
    },
  );

  if (!relevantActions.length) {
    return null;
  }

  const strongestAction =
    relevantActions.find(
      (action) => action.dueDate || action.successCriteria,
    ) || relevantActions[0];
  const summaryText = compactWhitespace(
    [
      strongestAction.title,
      strongestAction.successCriteria,
      strongestAction.notes,
    ]
      .filter(Boolean)
      .join(". "),
  );

  return {
    status:
      strongestAction.dueDate || strongestAction.successCriteria
        ? "solid"
        : "partial",
    score: strongestAction.dueDate || strongestAction.successCriteria ? 3 : 1,
    confidence:
      strongestAction.dueDate || strongestAction.successCriteria
        ? "high"
        : "medium",
    summary:
      summaryText ||
      `Ya existe seguimiento visible para ${criterion.title.toLowerCase()}.`,
    sourceType: "workspace_action",
    sourceRefId: Number(strongestAction.id) || null,
  };
}

function derivePurchasePathAssessment({ criterion, stakeholders }) {
  const relevantStakeholders = (
    Array.isArray(stakeholders) ? stakeholders : []
  ).filter((stakeholder) => {
    const roleCode = String(stakeholder.roleCode || "");
    const roleText = normalizeText(
      [
        stakeholder.roleLabel,
        stakeholder.name,
        stakeholder.priorities,
        stakeholder.concerns,
      ].join(" "),
    );
    return (
      roleCode === "economic_buyer" ||
      roleText.includes("compras") ||
      roleText.includes("finanzas") ||
      roleText.includes("aprob") ||
      roleText.includes("orden de compra")
    );
  });

  if (!relevantStakeholders.length) {
    return null;
  }

  const strongestStakeholder =
    relevantStakeholders.find(
      (stakeholder) => stakeholder.nextAction || stakeholder.priorities,
    ) || relevantStakeholders[0];
  const summaryText = compactWhitespace(
    [
      strongestStakeholder.name,
      strongestStakeholder.roleLabel,
      strongestStakeholder.priorities,
      strongestStakeholder.nextAction,
    ]
      .filter(Boolean)
      .join(". "),
  );

  return {
    status:
      strongestStakeholder.nextAction || strongestStakeholder.priorities
        ? "solid"
        : "partial",
    score:
      strongestStakeholder.nextAction || strongestStakeholder.priorities
        ? 3
        : 1,
    confidence:
      strongestStakeholder.nextAction || strongestStakeholder.priorities
        ? "high"
        : "medium",
    summary:
      summaryText ||
      `Ya existe visibilidad parcial sobre ${criterion.title.toLowerCase()}.`,
    sourceType: "workspace_stakeholder",
    sourceRefId: Number(strongestStakeholder.id) || null,
  };
}

function buildCommercialMissingSummary({ criterion, stageCode }) {
  const criterionTitle = String(
    criterion?.title || "este frente",
  ).toLowerCase();

  if (stageCode === "contacto_inicial") {
    if (criterion?.code === "contacto_need") {
      return "Todavia no queda claro que dolor, prioridad o interes comercial esta abriendo la oportunidad, y eso la deja en riesgo de descalificacion temprana.";
    }
    if (criterion?.code === "contacto_follow_up") {
      return "La conversacion existe, pero aun no hay un siguiente paso comercial acordado para mover la oportunidad, y eso la deja en riesgo de enfriarse o descalificarse temprano.";
    }
  }

  if (stageCode === "identificacion_oportunidad") {
    return `Todavia hay un vacio importante en ${criterionTitle}, y eso debilita la calificacion comercial de la etapa y deja el forecast en riesgo.`;
  }

  if (stageCode === "desarrollo") {
    return `Todavia falta claridad comercial sobre ${criterionTitle}, y eso debilita la propuesta frente al cliente y hace menos confiable el forecast.`;
  }

  if (stageCode === "cotizacion") {
    return `Todavia falta definir ${criterionTitle} en la cotizacion, y eso puede frenar el avance, debilitar el cierre o abrir espacio a competidores.`;
  }

  if (stageCode === "demostracion") {
    return `La demo todavia no deja claro ${criterionTitle}, por lo que el cliente puede salir con dudas y el forecast pierde solidez.`;
  }

  if (stageCode === "negociacion") {
    return `Todavia hay una brecha en ${criterionTitle} dentro de la negociacion, y eso reduce control del cierre, presiona el margen y aumenta el riesgo de retraso o perdida.`;
  }

  if (stageCode === "waiting") {
    return `Todavia no hay suficiente claridad sobre ${criterionTitle} en el tramo final del cierre, y eso aumenta el riesgo de retraso, caida o perdida tardia.`;
  }

  return `La oportunidad todavia no tiene respaldo comercial suficiente en ${criterionTitle}, y eso la vuelve mas vulnerable comercialmente.`;
}

function buildCommercialMitigationPlan({ criterion, stageCode }) {
  if (stageCode === "contacto_inicial") {
    if (criterion?.code === "contacto_need") {
      return "Validar explicitamente que problema o iniciativa quiere resolver el cliente y dejarlo documentado para evitar una descalificacion temprana.";
    }
    if (criterion?.code === "contacto_follow_up") {
      return "Acordar una reunion, demo o siguiente actividad con fecha para que la oportunidad no se quede solo en interes inicial ni se descalifique por falta de traccion.";
    }
  }

  if (stageCode === "identificacion_oportunidad") {
    return "Cerrar esta brecha de calificacion antes de seguir empujando forecast o mover la oportunidad a la siguiente etapa.";
  }

  if (stageCode === "desarrollo") {
    return "Aterrizar esta definicion con el cliente y convertirla en una accion concreta para defender mejor el forecast.";
  }

  if (stageCode === "cotizacion") {
    return "Completar este punto antes de defender propuesta economica o sostener el forecast de la oportunidad.";
  }

  if (stageCode === "demostracion") {
    return "Asegurar que la siguiente interaccion con el cliente cierre esta brecha y deje una senal clara para sostener el avance y el forecast.";
  }

  if (stageCode === "negociacion") {
    return "Resolver este punto antes de conceder condiciones o comprometer el cierre para no debilitar posicion ni margen.";
  }

  if (stageCode === "waiting") {
    return "Mantener seguimiento activo hasta dejar clara la ruta de aprobacion o el siguiente hito de compra para proteger el cierre.";
  }

  return "Convertir esta brecha en una accion comercial concreta con responsable y siguiente paso para proteger la oportunidad.";
}

function inferCriterionFromAnswer({
  criterion,
  answer,
  stageCode,
  stageId,
  actions,
  stakeholders,
}) {
  const value = String(answer?.answer_value || "").trim();
  const answerLength = value.length;
  const hasValue = answerLength > 0;
  const hasStrongSignal = answerLength >= 80;
  let status = hasStrongSignal ? "solid" : hasValue ? "partial" : "missing";
  let score = hasStrongSignal ? 3 : hasValue ? 2 : 0;
  let confidence = hasStrongSignal ? "high" : hasValue ? "medium" : "low";
  let summary = hasValue
    ? value.slice(0, 220)
    : buildCommercialMissingSummary({ criterion, stageCode });
  let sourceType = answer ? "stage_answer" : "derived";
  let sourceRefId = answer?.question_id ? Number(answer.question_id) : null;

  if (criterion.code === "contacto_follow_up") {
    const normalized = normalizeText(value);
    const followUpPattern =
      /reunion|seguimiento|demo|demostracion|sesion|agenda|agendar|prueba|siguiente paso/;
    if (followUpPattern.test(normalized)) {
      status = "solid";
      score = 3;
      confidence = "high";
    } else if (hasValue) {
      status = "partial";
      score = 1;
      confidence = "medium";
    } else {
      const derivedFollowUp = deriveFollowUpAssessment({
        criterion,
        stageCode,
        stageId,
        actions,
      });
      if (derivedFollowUp) {
        status = derivedFollowUp.status;
        score = derivedFollowUp.score;
        confidence = derivedFollowUp.confidence;
        summary = derivedFollowUp.summary;
        sourceType = derivedFollowUp.sourceType;
        sourceRefId = derivedFollowUp.sourceRefId;
      }
    }
  }

  if (stageCode === "waiting" && criterion.code === "waiting_follow_up_plan") {
    if (hasValue) {
      status = "partial";
      score = 1;
      confidence = "medium";
      summary = value.slice(0, 220);
    } else {
      const derivedFollowUp = deriveFollowUpAssessment({
        criterion,
        stageCode,
        stageId,
        actions,
      });
      if (derivedFollowUp) {
        status = derivedFollowUp.status;
        score = derivedFollowUp.score;
        confidence = derivedFollowUp.confidence;
        summary = derivedFollowUp.summary;
        sourceType = derivedFollowUp.sourceType;
        sourceRefId = derivedFollowUp.sourceRefId;
      } else {
        status = "missing";
        score = 0;
        confidence = "low";
        summary =
          "No existe un plan explicito de seguimiento mientras se espera la orden de compra.";
      }
    }
  }

  if (stageCode === "waiting" && criterion.code === "waiting_purchase_path") {
    const derivedPurchasePath = derivePurchasePathAssessment({
      criterion,
      stakeholders,
    });
    if (derivedPurchasePath) {
      status = derivedPurchasePath.status;
      score = derivedPurchasePath.score;
      confidence = derivedPurchasePath.confidence;
      summary = derivedPurchasePath.summary;
      sourceType = derivedPurchasePath.sourceType;
      sourceRefId = derivedPurchasePath.sourceRefId;
    } else {
      status = "missing";
      score = 0;
      confidence = "low";
      summary =
        "El flujo de aprobacion hacia la orden de compra aun no se captura estructuradamente.";
    }
  }

  return {
    criterionCode: criterion.code,
    title: criterion.title,
    description: criterion.description || null,
    themeCode: criterion.themeCode || null,
    salesStageCode: stageCode,
    status,
    score,
    confidence,
    sourceType,
    sourceRefId,
    summary,
  };
}

function mergeCriterionAssessment(baseAssessment, persistedAssessment) {
  if (!persistedAssessment) {
    return baseAssessment;
  }
  return {
    ...baseAssessment,
    status: String(persistedAssessment.status || baseAssessment.status),
    score: Number.isFinite(Number(persistedAssessment.score))
      ? Number(persistedAssessment.score)
      : baseAssessment.score,
    confidence: String(
      persistedAssessment.confidence || baseAssessment.confidence,
    ),
    summary: String(
      persistedAssessment.summary || baseAssessment.summary || "",
    ),
    evidenceCount: Number(persistedAssessment.evidence_count || 0),
    updatedAt: persistedAssessment.updated_at || null,
  };
}

const POSITIVE_DIMENSION_META = {
  missing: { label: "Sin informacion", tone: "neutral", score: 0 },
  weak: { label: "Debil", tone: "red", score: 1 },
  partial: { label: "Parcial", tone: "amber", score: 2 },
  solid: { label: "Solido", tone: "green", score: 3 },
};

const RISK_DIMENSION_META = {
  low: { label: "Bajo", tone: "green", score: 3 },
  medium: { label: "Medio", tone: "amber", score: 2 },
  high: { label: "Alto", tone: "red", score: 0 },
};

function hasAssessmentEvidence(assessment) {
  const status = String(assessment?.status || "missing");
  return status !== "missing" && status !== "blocked";
}

function hasAssessmentMatch(criterionAssessments, matcher) {
  return (Array.isArray(criterionAssessments) ? criterionAssessments : []).some(
    (assessment) => hasAssessmentEvidence(assessment) && matcher(assessment),
  );
}

function getThemeByCode(themes, themeCode) {
  return (Array.isArray(themes) ? themes : []).find(
    (theme) => theme.code === themeCode,
  );
}

function collectThemeText(themes, themeCodes) {
  return normalizeText(
    (Array.isArray(themeCodes) ? themeCodes : [])
      .map((themeCode) => getThemeByCode(themes, themeCode))
      .filter(Boolean)
      .flatMap((theme) => [
        theme.claim,
        ...(Array.isArray(theme.entries)
          ? theme.entries.flatMap((entry) => [
              entry.claim,
              entry.evidenceExcerpt,
            ])
          : []),
        ...(Array.isArray(theme.evidence)
          ? theme.evidence.map((entry) => entry.excerpt)
          : []),
      ])
      .filter(Boolean)
      .join(" "),
  );
}

function hasPattern(text, patterns) {
  const haystack = normalizeText(text);
  return (Array.isArray(patterns) ? patterns : []).some((pattern) =>
    haystack.includes(normalizeText(pattern)),
  );
}

function buildChecklistItem(key, label, checked, evidenceHint = "") {
  return {
    key,
    label,
    checked: Boolean(checked),
    evidenceHint: evidenceHint || "",
  };
}

function countCheckedChecklistItems(checklist) {
  return (Array.isArray(checklist) ? checklist : []).filter(
    (item) => item.checked,
  ).length;
}

function resolvePositiveDimensionState({
  checkedCount,
  missingMax,
  weakMax,
  partialMax,
  solidRequirements = [],
}) {
  if (checkedCount <= missingMax) {
    return "missing";
  }
  if (checkedCount <= weakMax) {
    return "weak";
  }
  if (checkedCount <= partialMax) {
    return "partial";
  }
  if (
    (Array.isArray(solidRequirements) ? solidRequirements : []).every(Boolean)
  ) {
    return "solid";
  }
  return "partial";
}

function summarizePositiveDimension({
  key,
  label,
  checklist,
  summaryByState,
  missingMax,
  weakMax,
  partialMax,
  solidRequirements,
}) {
  const checkedCount = countCheckedChecklistItems(checklist);
  const totalCount = Array.isArray(checklist) ? checklist.length : 0;
  const state = resolvePositiveDimensionState({
    checkedCount,
    missingMax,
    weakMax,
    partialMax,
    solidRequirements,
  });
  const meta = POSITIVE_DIMENSION_META[state];
  return {
    key,
    label,
    family: "progress",
    state,
    statusLabel: meta.label,
    tone: meta.tone,
    score: meta.score,
    checkedCount,
    totalCount,
    checklist,
    summary: summaryByState?.[state] || "",
  };
}

function summarizeRiskDimension({ key, label, checklist, summaryByState }) {
  const checkedCount = countCheckedChecklistItems(checklist);
  let state = "low";
  if (checkedCount >= 6) {
    state = "high";
  } else if (checkedCount >= 3) {
    state = "medium";
  }
  const meta = RISK_DIMENSION_META[state];
  return {
    key,
    label,
    family: "risk",
    state,
    statusLabel: meta.label,
    tone: meta.tone,
    score: meta.score,
    checkedCount,
    totalCount: Array.isArray(checklist) ? checklist.length : 0,
    checklist,
    summary: summaryByState?.[state] || "",
  };
}

function summarizeOverallHealth({
  urgency,
  budget,
  deciders,
  noDecisionRisk,
  currentStage,
  weaknesses,
}) {
  const openWeaknesses = (Array.isArray(weaknesses) ? weaknesses : []).filter(
    (item) => item.status === "open",
  );
  const criticalWeaknesses = openWeaknesses.filter(
    (item) => item.severity === "high",
  );
  const checklist = [
    buildChecklistItem(
      "urgency-at-least-partial",
      "Urgencia en parcial o solido",
      ["partial", "solid"].includes(urgency.state),
    ),
    buildChecklistItem(
      "budget-at-least-partial",
      "Presupuesto en parcial o solido",
      ["partial", "solid"].includes(budget.state),
    ),
    buildChecklistItem(
      "deciders-at-least-partial",
      "Decisores en parcial o solido",
      ["partial", "solid"].includes(deciders.state),
    ),
    buildChecklistItem(
      "risk-not-high",
      "Riesgo de no decision fuera de alto",
      noDecisionRisk.state !== "high",
    ),
    buildChecklistItem(
      "next-step-visible",
      "Existe siguiente paso visible",
      urgency.checklist.find((item) => item.key === "scheduled-next-step")
        ?.checked,
    ),
    buildChecklistItem(
      "stage-backed-by-evidence",
      "La etapa actual tiene evidencia suficiente",
      Number(currentStage?.completionRatio || 0) >= 0.6,
    ),
    buildChecklistItem(
      "weakness-load-managed",
      "Las debilidades abiertas estan bajo control",
      criticalWeaknesses.length === 0 && openWeaknesses.length <= 8,
    ),
  ];
  const checkedCount = countCheckedChecklistItems(checklist);
  const blockedForSolid =
    noDecisionRisk.state === "high" ||
    [urgency.state, budget.state, deciders.state].some(
      (state) => state === "missing",
    );
  let state = "weak";
  if (checkedCount >= 6 && !blockedForSolid) {
    state = "solid";
  } else if (checkedCount >= 3) {
    state = "partial";
  }
  const meta = POSITIVE_DIMENSION_META[state];
  return {
    state,
    overallLabel: meta.label,
    overallTone: meta.tone,
    checkedCount,
    totalCount: checklist.length,
    checklist,
    summary:
      state === "solid"
        ? "La oportunidad esta suficientemente desarrollada para avanzar con confianza."
        : state === "partial"
          ? "La oportunidad ya es utilizable, pero aun requiere cerrar vacios criticos."
          : "La oportunidad sigue debilmente sustentada y no es defendible todavia.",
  };
}

function summarizeScorecard({
  criterionAssessments,
  themes,
  stakeholders,
  actions,
  weaknesses,
  currentStage,
}) {
  const timelineText = collectThemeText(themes, ["timeline", "strategy"]);
  const needText = collectThemeText(themes, ["need"]);
  const budgetText = collectThemeText(themes, ["budget", "commercial"]);
  const stakeholderText = collectThemeText(themes, ["stakeholders"]);
  const riskText = collectThemeText(themes, ["risk"]);

  const hasNeedEvidence =
    hasAssessmentMatch(
      criterionAssessments,
      (assessment) => assessment.themeCode === "need",
    ) || Number(getThemeByCode(themes, "need")?.evidenceCount || 0) > 0;
  const hasTimelineEvidence =
    hasAssessmentMatch(
      criterionAssessments,
      (assessment) => assessment.themeCode === "timeline",
    ) || Number(getThemeByCode(themes, "timeline")?.evidenceCount || 0) > 0;
  const hasBudgetEvidence =
    hasAssessmentMatch(
      criterionAssessments,
      (assessment) => assessment.themeCode === "budget",
    ) || Number(getThemeByCode(themes, "budget")?.evidenceCount || 0) > 0;
  const followUpActionExists = (Array.isArray(actions) ? actions : []).some(
    (action) =>
      String(action.status) !== "done" &&
      ["follow_up", "next_step", "stakeholder_mapping"].includes(
        String(action.actionType),
      ),
  );
  const followUpAssessmentExists = hasAssessmentMatch(
    criterionAssessments,
    (assessment) =>
      /follow_up|siguientes_pasos|purchase_path/.test(
        String(assessment.criterionCode || ""),
      ),
  );
  const scheduledNextStep = followUpActionExists || followUpAssessmentExists;

  const urgency = summarizePositiveDimension({
    key: "urgency",
    label: "Urgencia",
    checklist: [
      buildChecklistItem(
        "impact-need",
        "El cliente ya expreso un problema o prioridad concreta",
        hasNeedEvidence,
      ),
      buildChecklistItem(
        "consequence-visible",
        "Esta claro que pasa si el cliente no resuelve esto",
        hasPattern(`${needText} ${timelineText}`, [
          "impacto",
          "consecuencia",
          "costo de no",
          "urgencia",
          "prioridad",
          "riesgo",
          "bloqueo",
        ]),
      ),
      buildChecklistItem(
        "time-horizon",
        "Hay una fecha o ventana que presiona la decision",
        hasTimelineEvidence ||
          hasPattern(timelineText, [
            "fecha",
            "hito",
            "plazo",
            "semana",
            "mes",
            "trimestre",
            "timeline",
          ]),
      ),
      buildChecklistItem(
        "business-milestone",
        "La fecha esta amarrada a un evento real del negocio",
        hasPattern(timelineText, [
          "implementacion",
          "go live",
          "renovacion",
          "licitacion",
          "auditoria",
          "cierre",
          "orden de compra",
          "proxima reunion",
        ]),
      ),
      buildChecklistItem(
        "scheduled-next-step",
        "Ya existe un siguiente paso acordado para avanzar",
        scheduledNextStep,
      ),
      buildChecklistItem(
        "trusted-source",
        "La urgencia esta sustentada por evidencia confiable",
        Number(getThemeByCode(themes, "timeline")?.evidenceCount || 0) > 0 ||
          Number(getThemeByCode(themes, "need")?.evidenceCount || 0) > 0,
      ),
    ],
    summaryByState: {
      missing:
        "Todavia no es claro que el cliente tenga un motivo real para decidir pronto.",
      weak: "Se percibe interes, pero aun no hay una urgencia comercial bien aterrizada.",
      partial:
        "Ya hay una razon temporal para avanzar, aunque todavia falta validarla mejor.",
      solid:
        "La urgencia ya esta clara y sirve para empujar la decision del cliente.",
    },
    missingMax: 0,
    weakMax: 2,
    partialMax: 4,
    solidRequirements: [
      hasTimelineEvidence ||
        hasPattern(timelineText, ["fecha", "hito", "plazo"]),
      hasPattern(`${needText} ${timelineText}`, [
        "impacto",
        "consecuencia",
        "costo de no",
        "urgencia",
      ]),
    ],
  });

  const economicBuyerMapped = (
    Array.isArray(stakeholders) ? stakeholders : []
  ).some((stakeholder) => stakeholder.roleCode === "economic_buyer");
  const budget = summarizePositiveDimension({
    key: "budget",
    label: "Presupuesto",
    checklist: [
      buildChecklistItem(
        "budget-discussed",
        "Ya se hablo de presupuesto o capacidad de inversion",
        hasBudgetEvidence,
      ),
      buildChecklistItem(
        "amount-or-range",
        "Ya tenemos un monto, rango o referencia economica",
        hasPattern(budgetText, [
          "monto",
          "rango",
          "usd",
          "mxn",
          "capex",
          "opex",
        ]) || /\$\s*\d|\d+\s*(usd|mxn)/i.test(budgetText),
      ),
      buildChecklistItem(
        "funding-source",
        "Se entiende de donde saldran los fondos o la aprobacion",
        hasPattern(budgetText, [
          "capex",
          "opex",
          "partida",
          "fondo",
          "aprobado",
          "aprobacion",
          "orden de compra",
        ]),
      ),
      buildChecklistItem(
        "economic-approver",
        "Ya sabemos quien aprueba el presupuesto",
        economicBuyerMapped ||
          hasPattern(`${budgetText} ${stakeholderText}`, [
            "compras",
            "finanzas",
            "cfo",
            "procurement",
          ]),
      ),
      buildChecklistItem(
        "budget-next-step",
        "Existe una accion concreta para cerrar el tema presupuestal",
        (Array.isArray(actions) ? actions : []).some(
          (action) =>
            String(action.linkedThemeCode || "") === "budget" ||
            /presupuesto|aprobacion|econom/i.test(String(action.title || "")),
        ),
      ),
      buildChecklistItem(
        "trusted-source",
        "El dato presupuestal viene de una fuente confiable",
        Number(getThemeByCode(themes, "budget")?.evidenceCount || 0) > 0,
      ),
    ],
    summaryByState: {
      missing:
        "Todavia no tenemos base suficiente para afirmar que hay presupuesto real.",
      weak: "Hay senales economicas, pero el presupuesto sigue poco claro.",
      partial:
        "Ya existe una base presupuestal util, aunque todavia incompleta.",
      solid:
        "El presupuesto ya esta suficientemente claro para sostener forecast y propuesta.",
    },
    missingMax: 0,
    weakMax: 2,
    partialMax: 4,
    solidRequirements: [
      hasPattern(budgetText, [
        "monto",
        "rango",
        "usd",
        "mxn",
        "capex",
        "opex",
      ]) || /\$\s*\d|\d+\s*(usd|mxn)/i.test(budgetText),
      economicBuyerMapped ||
        hasPattern(`${budgetText} ${stakeholderText}`, [
          "compras",
          "finanzas",
          "cfo",
        ]),
    ],
  });

  const distinctStakeholderRoles = new Set(
    (Array.isArray(stakeholders) ? stakeholders : [])
      .map((stakeholder) => String(stakeholder.roleCode || "").trim())
      .filter(Boolean),
  );
  const sponsorMapped = (Array.isArray(stakeholders) ? stakeholders : []).some(
    (stakeholder) => stakeholder.roleCode === "sponsor",
  );
  const technicalBuyerMapped = (
    Array.isArray(stakeholders) ? stakeholders : []
  ).some((stakeholder) => stakeholder.roleCode === "technical_buyer");
  const deciders = summarizePositiveDimension({
    key: "deciders",
    label: "Decisores",
    checklist: [
      buildChecklistItem(
        "relevant-contact",
        "Ya identificamos al menos un actor relevante",
        (Array.isArray(stakeholders) ? stakeholders : []).length > 0,
      ),
      buildChecklistItem(
        "economic-buyer",
        "Ya sabemos quien decide o aprueba economicamente",
        economicBuyerMapped,
      ),
      buildChecklistItem(
        "technical-buyer",
        "Ya sabemos quien valida tecnicamente o usara la solucion",
        technicalBuyerMapped,
      ),
      buildChecklistItem(
        "sponsor",
        "Existe un sponsor o impulsor claro dentro del cliente",
        sponsorMapped,
      ),
      buildChecklistItem(
        "multiple-roles",
        "Ya distinguimos al menos dos roles distintos en la compra",
        distinctStakeholderRoles.size >= 2,
      ),
      buildChecklistItem(
        "decision-process",
        "Se entiende como se tomara la decision",
        hasPattern(stakeholderText, [
          "proceso",
          "aprobacion",
          "comite",
          "orden de compra",
          "ruta",
        ]) ||
          hasAssessmentMatch(criterionAssessments, (assessment) =>
            /purchase_path|decisor|proceso_compra/.test(
              String(assessment.criterionCode || ""),
            ),
          ),
      ),
      buildChecklistItem(
        "actor-action-plan",
        "Existe una siguiente accion para mover a los actores clave",
        (Array.isArray(stakeholders) ? stakeholders : []).some((stakeholder) =>
          String(stakeholder.nextAction || "").trim(),
        ) ||
          (Array.isArray(actions) ? actions : []).some(
            (action) => Number(action.stakeholderId || 0) > 0,
          ),
      ),
    ],
    summaryByState: {
      missing: "Todavia no entendemos bien quien decide ni como se compra.",
      weak: "Hay actores visibles, pero el mapa politico sigue incompleto.",
      partial:
        "El mapa de compra ya orienta la estrategia, aunque aun faltan confirmaciones.",
      solid:
        "Los actores criticos y su rol en la decision ya estan suficientemente claros.",
    },
    missingMax: 1,
    weakMax: 3,
    partialMax: 5,
    solidRequirements: [
      economicBuyerMapped,
      distinctStakeholderRoles.size >= 2,
    ],
  });

  const openWeaknesses = (Array.isArray(weaknesses) ? weaknesses : []).filter(
    (item) => item.status === "open",
  );
  const criticalWeaknesses = openWeaknesses.filter(
    (item) => item.severity === "high",
  );
  const noDecisionRisk = summarizeRiskDimension({
    key: "no_decision_risk",
    label: "Riesgo de no decision",
    checklist: [
      buildChecklistItem(
        "no-next-step",
        "No hay un siguiente paso claro para mover la oportunidad",
        !scheduledNextStep,
      ),
      buildChecklistItem(
        "weak-urgency",
        "La urgencia del cliente sigue floja o poco clara",
        ["missing", "weak"].includes(urgency.state),
      ),
      buildChecklistItem(
        "weak-budget",
        "El presupuesto sigue poco claro o sin validar",
        ["missing", "weak"].includes(budget.state),
      ),
      buildChecklistItem(
        "weak-deciders",
        "Todavia no entendemos bien quienes deciden",
        ["missing", "weak"].includes(deciders.state),
      ),
      buildChecklistItem(
        "weak-need",
        "La necesidad del cliente sigue poco aterrizada",
        !hasNeedEvidence,
      ),
      buildChecklistItem(
        "no-sponsor",
        "No hay sponsor claro empujando la compra",
        !sponsorMapped,
      ),
      buildChecklistItem(
        "stalled-stage",
        "La oportunidad parece estancada en la etapa actual",
        String(currentStage?.code || "") === "waiting" && !scheduledNextStep,
      ),
      buildChecklistItem(
        "critical-contradictions",
        "Siguen abiertas objeciones o debilidades criticas",
        criticalWeaknesses.length > 1 ||
          Number(getThemeByCode(themes, "risk")?.contradictionCount || 0) > 0 ||
          hasPattern(riskText, ["riesgo", "objecion", "bloqueo"]),
      ),
    ],
    summaryByState: {
      low: "La oportunidad conserva suficiente traccion para llegar a decision.",
      medium: "La oportunidad avanza, pero tiene vacios que pueden frenarla.",
      high: "La oportunidad corre riesgo serio de enfriarse o quedarse sin decision.",
    },
  });

  const health = summarizeOverallHealth({
    urgency,
    budget,
    deciders,
    noDecisionRisk,
    currentStage,
    weaknesses,
  });

  const items = [urgency, budget, deciders, noDecisionRisk];
  const averageScore = items.length
    ? Number(
        (
          items.reduce((total, item) => total + Number(item.score || 0), 0) /
          items.length
        ).toFixed(2),
      )
    : 0;

  return {
    averageScore,
    overallTone: health.overallTone,
    items,
    health,
  };
}

function derivePurchaseMaturity({ budgetItem, decidersItem, currentStage }) {
  const score =
    Number(budgetItem?.score || 0) +
    Number(decidersItem?.score || 0) +
    (currentStage?.isValidated ? 2 : 0);

  if (score >= 7) {
    return {
      label: "Alta",
      tone: "green",
      summary:
        "La compra ya tiene respaldo suficiente en presupuesto, actores y avance de etapa.",
    };
  }

  if (score >= 4) {
    return {
      label: "Media",
      tone: "amber",
      summary:
        "La oportunidad ya muestra traccion de compra, pero todavia depende de cerrar vacios tacticos.",
    };
  }

  return {
    label: "Baja",
    tone: "red",
    summary:
      "La madurez de compra sigue debil: aun no hay claridad suficiente para sostener el cierre.",
  };
}

function buildRecommendedStrategy({
  currentStage,
  stages,
  weaknesses,
  purchaseMaturity,
  scorecardItems,
}) {
  const orderedStages = Array.isArray(stages)
    ? [...stages].sort(
        (left, right) => Number(left.order || 0) - Number(right.order || 0),
      )
    : [];
  const currentStageOrder = Number(currentStage?.order || 0);
  const remainingStages = orderedStages.filter(
    (stage) => Number(stage.order || 0) > currentStageOrder,
  );
  const openWeaknesses = (Array.isArray(weaknesses) ? weaknesses : []).filter(
    (item) => item.status === "open",
  );
  const criticalWeaknesses = openWeaknesses.filter(
    (item) => item.severity === "high",
  );
  const blockedScorecards = (
    Array.isArray(scorecardItems) ? scorecardItems : []
  ).filter((item) => item.tone === "red");
  const stageCode = String(currentStage?.code || "");
  const currentStageName = currentStage?.stageName || "la etapa actual";
  const nextStageName = remainingStages[0]?.stageName || "el cierre";
  const blockedLabels = blockedScorecards.map((item) => item.label);
  const blockedLabelSet = new Set(blockedLabels);

  const heading = currentStage?.stageName
    ? `La recomendacion comercial es consolidar ${currentStage.stageName} y llegar a ${nextStageName} con mas traccion, mejor posicion politica y una narrativa de valor mas defendible.`
    : "La recomendacion comercial es fortalecer la oportunidad antes de acelerar el siguiente avance del proceso de venta.";

  const route = remainingStages.length
    ? remainingStages.map((stage) => stage.stageName).join(" -> ")
    : "Cierre comercial";

  const immediatePriorities = [
    {
      title: "Movimiento comercial inmediato",
      text: currentStage?.isValidated
        ? `La etapa actual ya tiene validacion; ahora toca capitalizar ese avance y abrir ${nextStageName} con una posicion mas fuerte, mas visible y comercialmente mas defendible.`
        : `No conviene empujar ${nextStageName} todavia; primero hay que dejar ${currentStageName} suficientemente solida para que el avance gane credibilidad frente al cliente y dentro del forecast.`,
      rank: 30,
    },
    {
      title: "Riesgo que puede enfriar la venta",
      text: criticalWeaknesses.length
        ? `Hoy la oportunidad carga ${criticalWeaknesses.length} debilidad${criticalWeaknesses.length === 1 ? " critica abierta" : "es criticas abiertas"}; si no se contienen rapido, van a frenar momentum, debilitar posicion y abrir espacio a la competencia.`
        : openWeaknesses.length
          ? `Aun hay ${openWeaknesses.length} brecha${openWeaknesses.length === 1 ? " abierta" : "s abiertas"}; conviene resolver primero las que golpean urgencia, confianza y decision de compra.`
          : "No hay alertas comerciales abiertas de peso; eso permite jugar una estrategia mas ofensiva para acelerar la venta.",
      rank: criticalWeaknesses.length ? 100 : openWeaknesses.length ? 60 : 10,
    },
    {
      title: "Variable que mas debilita la oportunidad",
      text: blockedLabels.length
        ? `Hoy la oportunidad pierde fuerza comercial principalmente en ${blockedLabels
            .slice(0, 3)
            .map((label) => label.toLowerCase())
            .join(
              ", ",
            )}; ese es el frente con mayor impacto para recuperar traccion.`
        : `La madurez de compra es ${String(purchaseMaturity?.label || "media").toLowerCase()}; la prioridad es convertir interes en decision y decision en siguiente paso firme.`,
      rank: blockedLabels.length ? 90 : 20,
    },
  ];

  const playbookActions = COMMERCIAL_PROCESS_ACTIONS[stageCode] || [
    "Consolidar la evidencia de la etapa actual antes de abrir negociacion o forecast agresivo.",
    "Asegurar un siguiente paso claro con fecha, responsables y criterio de avance.",
    "Usar la informacion comercial y tecnica acumulada para defender mejor el valor de la oportunidad.",
  ];

  const directorActions = [
    {
      title: blockedLabelSet.has("Presupuesto")
        ? "Cerrar viabilidad economica"
        : "Defender valor economico",
      text: blockedLabelSet.has("Presupuesto")
        ? "Es momento de hablar de dinero sin rodeos: confirma rango, fuente de aprobacion y opcion minima viable para evitar que la oportunidad siga viva comercialmente pero sin base economica real."
        : "Lleva la conversacion a impacto financiero, costo de no actuar y retorno esperado; en venta B2B el valor de negocio tiene que pesar mas que el detalle tecnico.",
      rank: blockedLabelSet.has("Presupuesto") ? 95 : 45,
    },
    {
      title: blockedLabelSet.has("Decisores")
        ? "Ganar posicion politica"
        : "Fortalecer influencia en la cuenta",
      text: blockedLabelSet.has("Decisores")
        ? "Sube de nivel el mapa politico cuanto antes: sponsor, aprobador economico y vetos potenciales deben quedar claros antes de la siguiente conversacion clave."
        : "Cada reunion tiene que sumar influencia dentro de la cuenta; no basta con avanzar en lo tecnico si la decision sigue politicamente fragil.",
      rank: blockedLabelSet.has("Decisores") ? 92 : 40,
    },
    {
      title: blockedLabelSet.has("Urgencia")
        ? "Activar sentido de compra"
        : "Acelerar decision",
      text: blockedLabelSet.has("Urgencia")
        ? "Construye urgencia comercial con un evento del negocio, costo de demora o riesgo visible; sin tension real, esta oportunidad puede quedarse en no decision."
        : "Usa el siguiente paso para acercar al cliente a una decision concreta, no solo para seguir compartiendo informacion.",
      rank: blockedLabelSet.has("Urgencia") ? 91 : 35,
    },
    {
      title:
        stageCode === "cotizacion"
          ? "Defender propuesta"
          : stageCode === "demostracion"
            ? "Convertir interes en avance"
            : stageCode === "negociacion"
              ? "Proteger margen y cierre"
              : "Dirigir la oportunidad para ganar",
      text:
        stageCode === "cotizacion"
          ? "No dejes la cotizacion sola en el inbox: defendela en vivo, compara escenarios y controla objeciones antes de que precio sea el unico criterio de decision."
          : stageCode === "demostracion"
            ? "La demo tiene que comprar un siguiente paso claro; si no genera avance, hubo interes pero no movimiento comercial real."
            : stageCode === "negociacion"
              ? "Negocia intercambios, no descuentos sueltos: cada concesion debe comprar velocidad, volumen, plazo o mayor certeza de cierre."
              : "Conduce la oportunidad como forecast ejecutivo: menos actividad dispersa y mas acciones que eleven probabilidad real de ganar.",
      rank:
        stageCode === "cotizacion"
          ? 88
          : stageCode === "demostracion"
            ? 84
            : stageCode === "negociacion"
              ? 89
              : 30,
    },
    {
      title: criticalWeaknesses.length
        ? "Plan de contencion"
        : "Mantener iniciativa comercial",
      text: criticalWeaknesses.length
        ? "Activa un plan de contencion para las debilidades criticas con responsable, fecha y mensaje de control; el cliente tiene que percibir direccion y confianza."
        : "Mantener la iniciativa es clave: cuando el cliente deja de sentir direccion comercial, la oportunidad pierde ritmo aunque siga mostrando interes.",
      rank: criticalWeaknesses.length ? 93 : 25,
    },
  ];

  const finalObjective = remainingStages.length
    ? `Objetivo inmediato: salir de ${currentStageName} con argumentos y senales suficientes para entrar a ${nextStageName} sin debilitar el forecast.`
    : "Objetivo inmediato: convertir la oportunidad en cierre efectivo y controlar el tramo final hasta la venta.";

  const playbookStepObjects = playbookActions.map((text, index) => ({
    title: `Accion comercial ${index + 1}`,
    text,
    rank:
      blockedLabelSet.has("Presupuesto") &&
      /presupuesto|inversion|roi/i.test(text)
        ? 87
        : blockedLabelSet.has("Decisores") &&
            /decide|aprobar|compra/i.test(text)
          ? 86
          : blockedLabelSet.has("Urgencia") &&
              /fecha|siguiente paso|avance/i.test(text)
            ? 85
            : 50 - index,
  }));

  const steps = [
    ...immediatePriorities,
    ...directorActions,
    ...playbookStepObjects,
  ]
    .sort((left, right) => Number(right.rank || 0) - Number(left.rank || 0))
    .map((item, index) => ({
      priorityLabel: `Prioridad ${index + 1}`,
      title: item.title,
      text: item.text,
    }));

  return {
    heading,
    route,
    finalObjective,
    steps,
  };
}

async function getPersistedOpportunityRecommendedStrategy(opportunityId) {
  await ensureOpportunityWorkspaceSchema();
  const rows = await query(
    `SELECT heading, route, final_objective, steps_json,
            derived_from_stage_id, derived_from_stage_code, updated_at
     FROM opportunity_workspace_recommended_strategy
     WHERE opportunity_id = ?
     LIMIT 1`,
    [opportunityId],
  );

  if (!rows.length) {
    return null;
  }

  const row = rows[0];
  let steps = [];
  try {
    const parsed =
      typeof row.steps_json === "string"
        ? JSON.parse(row.steps_json)
        : row.steps_json;
    steps = Array.isArray(parsed) ? parsed : [];
  } catch {
    steps = [];
  }

  return {
    heading: row.heading,
    route: row.route,
    finalObjective: row.final_objective,
    steps,
    derivedFromStageId: row.derived_from_stage_id
      ? Number(row.derived_from_stage_id)
      : null,
    derivedFromStageCode: row.derived_from_stage_code || null,
    updatedAt: row.updated_at || null,
  };
}

async function upsertOpportunityRecommendedStrategy({
  opportunityId,
  strategy,
  currentStage,
  userId,
}) {
  await ensureOpportunityWorkspaceSchema();
  await query(
    `INSERT INTO opportunity_workspace_recommended_strategy (
      opportunity_id,
      heading,
      route,
      final_objective,
      steps_json,
      derived_from_stage_id,
      derived_from_stage_code,
      updated_by_user_id
    ) VALUES (?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      heading = VALUES(heading),
      route = VALUES(route),
      final_objective = VALUES(final_objective),
      steps_json = VALUES(steps_json),
      derived_from_stage_id = VALUES(derived_from_stage_id),
      derived_from_stage_code = VALUES(derived_from_stage_code),
      updated_by_user_id = VALUES(updated_by_user_id),
      updated_at = NOW(3)`,
    [
      opportunityId,
      strategy.heading,
      strategy.route,
      strategy.finalObjective,
      JSON.stringify(Array.isArray(strategy.steps) ? strategy.steps : []),
      currentStage?.stageId || null,
      currentStage?.code || null,
      userId || null,
    ],
  );
}

function buildStageStatus(criteria) {
  const list = Array.isArray(criteria) ? criteria : [];
  if (!list.length) {
    return { status: "not_started", completionRatio: 0, weaknessCount: 0 };
  }
  const completeCount = list.filter((item) => item.status === "solid").length;
  const partialCount = list.filter((item) => item.status === "partial").length;
  const completionRatio = (completeCount + partialCount * 0.5) / list.length;
  let status = "blocked";
  if (completeCount === list.length) {
    status = "solid";
  } else if (completeCount + partialCount === 0) {
    status = "not_started";
  } else if (partialCount || completeCount) {
    status = completionRatio >= 0.65 ? "conditional" : "in_progress";
  }
  return {
    status,
    completionRatio,
    weaknessCount: list.filter((item) => item.status === "missing").length,
  };
}

function buildAutoWeaknessTitle(assessment) {
  const baseTitle = compactWhitespace(assessment?.title || "brecha comercial");
  if (!baseTitle) {
    return "Brecha comercial detectada";
  }
  return `Brecha detectada: ${baseTitle}`;
}

function buildAutoWeaknesses({ criterionAssessments, stagesByCode }) {
  return criterionAssessments
    .filter((assessment) => assessment.status === "missing")
    .map((assessment) => ({
      id: `auto:${assessment.criterionCode}`,
      title: buildAutoWeaknessTitle(assessment),
      category: assessment.themeCode || "general",
      severity:
        assessment.salesStageCode === "contacto_inicial" ||
        assessment.salesStageCode === "identificacion_oportunidad"
          ? "high"
          : "medium",
      status: "open",
      isAutoGenerated: true,
      salesStageId: stagesByCode.get(assessment.salesStageCode)?.id || null,
      salesStageCode: assessment.salesStageCode,
      detail: buildCommercialMissingSummary({
        criterion: {
          code: assessment.criterionCode,
          title: assessment.title,
        },
        stageCode: assessment.salesStageCode,
      }),
      mitigationPlan: buildCommercialMitigationPlan({
        criterion: {
          code: assessment.criterionCode,
          title: assessment.title,
        },
        stageCode: assessment.salesStageCode,
      }),
      ownerUserId: null,
      dueDate: null,
      updatedAt: null,
    }));
}

function summarizeThemes({
  themeEntries,
  criterionAssessments,
  answers,
  documents,
}) {
  const answerMap = Array.isArray(answers) ? answers : [];
  const docs = Array.isArray(documents) ? documents : [];
  const documentEvidenceByTheme = buildDocumentEvidenceByTheme(docs);
  return DEFAULT_THEME_DEFINITIONS.map((theme) => {
    const mappedCriteria = criterionAssessments.filter(
      (item) => item.themeCode === theme.code,
    );
    const storedEntries = themeEntries.filter(
      (item) => String(item.theme_code) === theme.code,
    );
    const supportedCount = [
      ...mappedCriteria.filter((item) => item.status !== "missing"),
      ...storedEntries,
    ].length;
    const contradictionCount = storedEntries.filter(
      (item) => String(item.status) === "contradicted",
    ).length;
    const documentEvidence = documentEvidenceByTheme.get(theme.code) || [];
    const state = contradictionCount
      ? "contradictory"
      : supportedCount
        ? supportedCount >= 2
          ? "sufficient"
          : "partial"
        : "missing";
    const claim =
      storedEntries[0]?.claim ||
      documentEvidence[0]?.excerpt ||
      mappedCriteria.find((item) => item.status !== "missing")?.summary ||
      `Aun no existe evidencia tematica suficiente para ${theme.name.toLowerCase()}.`;
    const relatedQuestionIds = mappedCriteria
      .map((item) => item.sourceRefId)
      .filter(Boolean);
    const evidenceCount =
      relatedQuestionIds.length +
      storedEntries.length +
      documentEvidence.length;
    return {
      code: theme.code,
      name: theme.name,
      state,
      claim,
      evidenceCount,
      contradictionCount,
      entries: storedEntries.map((entry) => ({
        id: Number(entry.id),
        claim: entry.claim,
        status: entry.status,
        confidence: entry.confidence,
        sourceType: entry.source_type,
        evidenceExcerpt: entry.evidence_excerpt,
        updatedAt: entry.updated_at,
      })),
      evidence: [
        ...mappedCriteria
          .filter((item) => item.status !== "missing")
          .map((item) => ({
            sourceType: item.sourceType,
            sourceLabel: item.sourcePrompt || item.title,
            sourceRefId: item.sourceRefId || null,
            excerpt: item.summary,
          })),
        ...storedEntries.map((entry) => ({
          sourceType: entry.source_type,
          sourceLabel: "Nota manual",
          sourceRefId: Number(entry.id),
          excerpt: entry.evidence_excerpt || entry.claim,
        })),
        ...documentEvidence,
      ].slice(0, 6),
      relatedQuestionIds,
    };
  });
}

function buildRecommendedActions({
  stageDefinitions,
  currentStage,
  weaknesses,
  stakeholders,
  actions,
  themes,
}) {
  const existingKeys = new Set(
    (Array.isArray(actions) ? actions : []).map((item) =>
      normalizeText(
        `${item.title}|${item.actionType}|${item.linkedStageId || ""}`,
      ),
    ),
  );
  const suggestions = [];

  if (!Array.isArray(stakeholders) || stakeholders.length === 0) {
    suggestions.push({
      key: "stakeholder-map",
      title: "Identificar decisor economico y aprobadores",
      actionType: "stakeholder_mapping",
      priority: "high",
      linkedStageId: currentStage?.stageId || null,
      rationale:
        "El mapa de compra sigue vacio; sin actores identificados la oportunidad no es defendible.",
    });
  }

  const budgetTheme = (Array.isArray(themes) ? themes : []).find(
    (item) => item.code === "budget",
  );
  if (budgetTheme && budgetTheme.state === "missing") {
    suggestions.push({
      key: "budget-discovery",
      title: "Confirmar rango presupuestal y aprobacion",
      actionType: "budget_discovery",
      priority: "high",
      linkedStageId: currentStage?.stageId || null,
      linkedThemeCode: "budget",
      rationale:
        "El workspace sigue sin evidencia suficiente de presupuesto o aprobacion financiera.",
    });
  }

  const openHighWeaknesses = (
    Array.isArray(weaknesses) ? weaknesses : []
  ).filter((item) => item.status === "open" && item.severity === "high");
  for (const weakness of openHighWeaknesses.slice(0, 3)) {
    suggestions.push({
      key: `weakness:${weakness.id}`,
      title: `Mitigar: ${weakness.title}`,
      actionType: "mitigation",
      priority: "high",
      linkedStageId: weakness.salesStageId || currentStage?.stageId || null,
      linkedWeaknessId: typeof weakness.id === "number" ? weakness.id : null,
      rationale:
        weakness.mitigationPlan ||
        weakness.detail ||
        "La oportunidad mantiene una brecha comercial abierta y todavia no existe una accion clara para cerrarla.",
    });
  }

  if (currentStage && currentStage.status !== "solid") {
    const hasPendingCurrentStageAction = (
      Array.isArray(actions) ? actions : []
    ).some(
      (item) =>
        String(item.status) !== "done" &&
        Number(item.linkedStageId || 0) === Number(currentStage.stageId || 0),
    );
    if (!hasPendingCurrentStageAction) {
      suggestions.push({
        key: `stage:${currentStage.code}`,
        title: `Cerrar brechas de ${currentStage.stageName}`,
        actionType: "stage_progression",
        priority: currentStage.status === "blocked" ? "high" : "medium",
        linkedStageId: currentStage.stageId || null,
        rationale:
          currentStage.exitCriteriaSummary ||
          "La etapa actual sigue incompleta y no tiene una accion activa asociada.",
      });
    }
  }

  return suggestions.filter((item) => {
    const key = normalizeText(
      `${item.title}|${item.actionType}|${item.linkedStageId || ""}`,
    );
    return !existingKeys.has(key);
  });
}

function buildRecommendedDeliverables({ currentStage, deliverables }) {
  if (!currentStage) return [];
  const template = DEFAULT_STAGE_DELIVERABLE_BY_CODE[currentStage.code];
  if (!template) return [];

  const alreadyPresent = (Array.isArray(deliverables) ? deliverables : []).some(
    (item) =>
      normalizeText(item.deliverableType) ===
        normalizeText(template.deliverableType) &&
      Number(item.linkedStageId || 0) === Number(currentStage.stageId || 0),
  );
  if (alreadyPresent) {
    return [];
  }

  return [
    {
      key: `deliverable:${currentStage.code}`,
      ...template,
      linkedStageId: currentStage.stageId || null,
      rationale:
        "La etapa actual no tiene un entregable guia registrado para sostener el siguiente paso.",
    },
  ];
}

async function getActivePlaybookMetadata() {
  const rows = await query(
    `SELECT p.id AS playbook_id,
            p.code,
            p.name,
            p.description,
            v.id AS version_id,
            v.version_label,
            COUNT(DISTINCT st.id) AS stage_count,
            COUNT(DISTINCT c.id) AS criteria_count
     FROM opportunity_playbooks p
     INNER JOIN opportunity_playbook_versions v
       ON v.playbook_id = p.id AND v.is_active = 1
     LEFT JOIN opportunity_playbook_stage_templates st
       ON st.playbook_version_id = v.id
     LEFT JOIN opportunity_playbook_stage_criteria c
       ON c.stage_template_id = st.id
     WHERE p.is_active = 1
       AND v.is_active = 1
     GROUP BY p.id, p.code, p.name, p.description, v.id, v.version_label
     ORDER BY p.updated_at DESC, v.id DESC
     LIMIT 1`,
  );

  if (!rows.length) return null;

  return {
    id: Number(rows[0].playbook_id),
    code: rows[0].code,
    name: rows[0].name,
    description: rows[0].description || "",
    versionId: Number(rows[0].version_id),
    version: rows[0].version_label,
    stageCount: Number(rows[0].stage_count || 0),
    criteriaCount: Number(rows[0].criteria_count || 0),
  };
}

async function getActivePlaybookDefinition() {
  const rows = await query(
    `SELECT p.id AS playbook_id,
            p.code AS playbook_code,
            p.name AS playbook_name,
            p.description AS playbook_description,
            v.id AS version_id,
            v.version_label,
            st.display_order AS stage_display_order,
            st.objective,
            st.exit_criteria_summary,
            sales.id AS sales_stage_id,
            sales.code AS sales_stage_code,
            c.code AS criterion_code,
            c.title AS criterion_title,
            c.description AS criterion_description,
            c.theme_code,
            c.display_order AS criterion_display_order
     FROM opportunity_playbooks p
     INNER JOIN opportunity_playbook_versions v
       ON v.playbook_id = p.id AND v.is_active = 1
     INNER JOIN opportunity_playbook_stage_templates st
       ON st.playbook_version_id = v.id
     INNER JOIN opportunity_sales_stages sales ON sales.id = st.sales_stage_id
     LEFT JOIN opportunity_playbook_stage_criteria c
       ON c.stage_template_id = st.id
     WHERE p.is_active = 1
     ORDER BY st.display_order, sales.id, c.display_order, c.id`,
  );

  if (!rows.length) {
    return null;
  }

  const metadata = await getActivePlaybookMetadata();
  const stageMap = new Map();
  for (const row of rows) {
    const stageCode = String(row.sales_stage_code);
    if (!stageMap.has(stageCode)) {
      stageMap.set(stageCode, {
        stageCode,
        objective: row.objective || "",
        exitCriteriaSummary: row.exit_criteria_summary || "",
        criteria: [],
      });
    }
    if (!row.criterion_code) continue;
    stageMap.get(stageCode).criteria.push({
      code: row.criterion_code,
      title: row.criterion_title,
      description: row.criterion_description || null,
      themeCode: row.theme_code || null,
    });
  }

  return {
    playbook: metadata,
    stages: Array.from(stageMap.values()),
  };
}

async function ensureDefaultPlaybook() {
  await ensureOpportunityWorkspaceSchema();
  await query(
    `INSERT INTO opportunity_playbooks (code, name, description)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), updated_at = NOW(3)`,
    [
      DEFAULT_PLAYBOOK_CODE,
      "Playbook comercial B2B",
      "Playbook base para desarrollo solido de oportunidades comerciales.",
    ],
  );

  const playbookRows = await query(
    `SELECT id FROM opportunity_playbooks WHERE code = ? LIMIT 1`,
    [DEFAULT_PLAYBOOK_CODE],
  );
  const playbookId = Number(playbookRows[0]?.id || 0);
  if (!playbookId) return null;

  await query(
    `INSERT INTO opportunity_playbook_versions (playbook_id, version_label)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE updated_at = NOW(3)`,
    [playbookId, "v1"],
  );
  const versionRows = await query(
    `SELECT id FROM opportunity_playbook_versions
     WHERE playbook_id = ? AND version_label = ?
     LIMIT 1`,
    [playbookId, "v1"],
  );
  const versionId = Number(versionRows[0]?.id || 0);
  if (!versionId) return null;

  const stageRows = await query(
    `SELECT id, code FROM opportunity_sales_stages WHERE is_active = 1`,
  );
  const stageIdByCode = new Map(
    stageRows.map((row) => [String(row.code), Number(row.id)]),
  );

  for (const [index, stageDefinition] of PLAYBOOK_STAGE_DEFINITIONS.entries()) {
    const stageId = stageIdByCode.get(stageDefinition.stageCode);
    if (!stageId) continue;
    await query(
      `INSERT INTO opportunity_playbook_stage_templates (
        playbook_version_id,
        sales_stage_id,
        display_order,
        objective,
        exit_criteria_summary
      ) VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        updated_at = NOW(3)`,
      [
        versionId,
        stageId,
        index + 1,
        stageDefinition.objective,
        stageDefinition.exitCriteriaSummary,
      ],
    );

    const templateRows = await query(
      `SELECT id FROM opportunity_playbook_stage_templates
       WHERE playbook_version_id = ? AND sales_stage_id = ? LIMIT 1`,
      [versionId, stageId],
    );
    const templateId = Number(templateRows[0]?.id || 0);
    if (!templateId) continue;

    for (const [
      criterionIndex,
      criterion,
    ] of stageDefinition.criteria.entries()) {
      await query(
        `INSERT INTO opportunity_playbook_stage_criteria (
          stage_template_id,
          code,
          title,
          description,
          theme_code,
          display_order,
          is_required
        ) VALUES (?, ?, ?, ?, ?, ?, 1)
        ON DUPLICATE KEY UPDATE
          updated_at = NOW(3)`,
        [
          templateId,
          criterion.code,
          criterion.title,
          criterion.description || null,
          criterion.themeCode || null,
          criterionIndex + 1,
        ],
      );
    }
  }

  return getActivePlaybookMetadata();
}

export async function listOpportunityWorkspacePlaybooks() {
  await ensureDefaultPlaybook();
  const rows = await query(
    `SELECT p.id AS playbook_id,
            p.code,
            p.name,
            p.description,
            p.is_active AS playbook_is_active,
            v.id AS version_id,
            v.version_label,
            v.is_active AS version_is_active,
            COUNT(DISTINCT st.id) AS stage_count,
            COUNT(DISTINCT c.id) AS criteria_count
     FROM opportunity_playbooks p
     INNER JOIN opportunity_playbook_versions v ON v.playbook_id = p.id
     LEFT JOIN opportunity_playbook_stage_templates st ON st.playbook_version_id = v.id
     LEFT JOIN opportunity_playbook_stage_criteria c ON c.stage_template_id = st.id
     GROUP BY p.id, p.code, p.name, p.description, p.is_active, v.id, v.version_label, v.is_active
     ORDER BY p.name, v.id DESC`,
  );

  return rows.map((row) => ({
    playbookId: Number(row.playbook_id),
    versionId: Number(row.version_id),
    code: row.code,
    name: row.name,
    description: row.description || "",
    version: row.version_label,
    isActive: Boolean(row.playbook_is_active) && Boolean(row.version_is_active),
    stageCount: Number(row.stage_count || 0),
    criteriaCount: Number(row.criteria_count || 0),
  }));
}

export async function getOpportunityWorkspacePlaybookVersionDetail({
  versionId,
}) {
  await ensureDefaultPlaybook();
  const rows = await query(
    `SELECT p.id AS playbook_id,
            p.code AS playbook_code,
            p.name AS playbook_name,
            p.description AS playbook_description,
            p.is_active AS playbook_is_active,
            v.id AS version_id,
            v.version_label,
            v.is_active AS version_is_active,
            st.id AS stage_template_id,
            st.display_order AS stage_display_order,
            st.objective,
            st.exit_criteria_summary,
            sales.id AS sales_stage_id,
            sales.code AS sales_stage_code,
            sales.name AS sales_stage_name,
            c.id AS criterion_id,
            c.code AS criterion_code,
            c.title AS criterion_title,
            c.description AS criterion_description,
            c.theme_code,
            c.display_order AS criterion_display_order,
            c.is_required
     FROM opportunity_playbooks p
     INNER JOIN opportunity_playbook_versions v ON v.playbook_id = p.id
     INNER JOIN opportunity_playbook_stage_templates st ON st.playbook_version_id = v.id
     INNER JOIN opportunity_sales_stages sales ON sales.id = st.sales_stage_id
     LEFT JOIN opportunity_playbook_stage_criteria c ON c.stage_template_id = st.id
     WHERE v.id = ?
     ORDER BY st.display_order, sales.id, c.display_order, c.id`,
    [versionId],
  );

  if (!rows.length) {
    return null;
  }

  const first = rows[0];
  const stagesByCode = new Map();
  for (const row of rows) {
    const stageCode = String(row.sales_stage_code);
    if (!stagesByCode.has(stageCode)) {
      stagesByCode.set(stageCode, {
        stageTemplateId: Number(row.stage_template_id),
        salesStageId: Number(row.sales_stage_id),
        stageCode,
        stageName: row.sales_stage_name,
        displayOrder: Number(row.stage_display_order || 0),
        objective: row.objective || "",
        exitCriteriaSummary: row.exit_criteria_summary || "",
        criteria: [],
      });
    }
    if (!row.criterion_id) continue;
    stagesByCode.get(stageCode).criteria.push({
      criterionId: Number(row.criterion_id),
      criterionCode: row.criterion_code,
      title: row.criterion_title,
      description: row.criterion_description || "",
      themeCode: row.theme_code || "",
      displayOrder: Number(row.criterion_display_order || 0),
      isRequired: Boolean(row.is_required),
    });
  }

  return {
    playbookId: Number(first.playbook_id),
    code: first.playbook_code,
    name: first.playbook_name,
    description: first.playbook_description || "",
    versionId: Number(first.version_id),
    version: first.version_label,
    isActive:
      Boolean(first.playbook_is_active) && Boolean(first.version_is_active),
    stages: Array.from(stagesByCode.values()),
  };
}

export async function updateOpportunityWorkspacePlaybookStage({
  versionId,
  salesStageCode,
  objective,
  exitCriteriaSummary,
}) {
  await ensureOpportunityWorkspaceSchema();
  const rows = await query(
    `SELECT st.id
     FROM opportunity_playbook_stage_templates st
     INNER JOIN opportunity_playbook_versions v ON v.id = st.playbook_version_id
     INNER JOIN opportunity_sales_stages sales ON sales.id = st.sales_stage_id
     WHERE v.id = ? AND sales.code = ?
     LIMIT 1`,
    [versionId, salesStageCode],
  );
  const stageTemplateId = Number(rows[0]?.id || 0);
  if (!stageTemplateId) {
    return null;
  }

  await query(
    `UPDATE opportunity_playbook_stage_templates
     SET objective = ?,
         exit_criteria_summary = ?,
         updated_at = NOW(3)
     WHERE id = ?`,
    [objective || null, exitCriteriaSummary || null, stageTemplateId],
  );

  return getOpportunityWorkspacePlaybookVersionDetail({ versionId });
}

export async function updateOpportunityWorkspacePlaybookCriterion({
  versionId,
  salesStageCode,
  criterionCode,
  title,
  description,
  themeCode,
  displayOrder,
}) {
  await ensureOpportunityWorkspaceSchema();
  const rows = await query(
    `SELECT c.id
     FROM opportunity_playbook_stage_criteria c
     INNER JOIN opportunity_playbook_stage_templates st ON st.id = c.stage_template_id
     INNER JOIN opportunity_playbook_versions v ON v.id = st.playbook_version_id
     INNER JOIN opportunity_sales_stages sales ON sales.id = st.sales_stage_id
     WHERE v.id = ? AND sales.code = ? AND c.code = ?
     LIMIT 1`,
    [versionId, salesStageCode, criterionCode],
  );
  const criterionId = Number(rows[0]?.id || 0);
  if (!criterionId) {
    return null;
  }

  await query(
    `UPDATE opportunity_playbook_stage_criteria
     SET title = ?,
         description = ?,
         theme_code = ?,
         display_order = ?,
         updated_at = NOW(3)
     WHERE id = ?`,
    [
      title,
      description || null,
      themeCode || null,
      Number(displayOrder || 1),
      criterionId,
    ],
  );

  return getOpportunityWorkspacePlaybookVersionDetail({ versionId });
}

export async function activateOpportunityWorkspacePlaybookVersion({
  versionId,
}) {
  await ensureOpportunityWorkspaceSchema();
  const versionRows = await query(
    `SELECT id, playbook_id
     FROM opportunity_playbook_versions
     WHERE id = ?
     LIMIT 1`,
    [versionId],
  );
  if (!versionRows.length) {
    return null;
  }

  await query(
    `UPDATE opportunity_playbook_versions
     SET is_active = 0, updated_at = NOW(3)`,
  );
  await query(
    `UPDATE opportunity_playbooks
     SET is_active = 0, updated_at = NOW(3)`,
  );
  await query(
    `UPDATE opportunity_playbooks
     SET is_active = 1, updated_at = NOW(3)
     WHERE id = ?`,
    [versionRows[0].playbook_id],
  );
  await query(
    `UPDATE opportunity_playbook_versions
     SET is_active = 1, updated_at = NOW(3)
     WHERE id = ?`,
    [versionId],
  );

  return getActivePlaybookMetadata();
}

async function getPersistedCriterionAssessments(opportunityId) {
  return query(
    `SELECT *
     FROM opportunity_workspace_criterion_assessments
     WHERE opportunity_id = ?`,
    [opportunityId],
  );
}

async function getLatestWorkspaceStageAnswers(opportunityId) {
  return query(
    `SELECT q.id AS question_id,
            q.sales_stage_id,
            q.code,
            q.prompt,
            q.response_type,
            q.display_order,
            a.answer_value,
            a.answered_at,
            a.answered_by_user_id
     FROM opportunity_stage_questions q
     LEFT JOIN opportunity_stage_question_answers a
       ON a.id = (
         SELECT a2.id
         FROM opportunity_stage_question_answers a2
         WHERE a2.opportunity_id = ?
           AND a2.question_id = q.id
         ORDER BY a2.id DESC
         LIMIT 1
       )
     WHERE q.is_active = 1
     ORDER BY q.sales_stage_id, q.display_order, q.id`,
    [opportunityId],
  );
}

async function getManualWeaknesses(opportunityId) {
  return query(
    `SELECT w.*, u.full_name AS owner_name
     FROM opportunity_workspace_weaknesses w
     LEFT JOIN users u ON u.id = w.owner_user_id
     WHERE w.opportunity_id = ?
     ORDER BY FIELD(w.severity, 'high', 'medium', 'low'), w.updated_at DESC`,
    [opportunityId],
  );
}

async function getThemeEntries(opportunityId) {
  return query(
    `SELECT *
     FROM opportunity_workspace_theme_entries
     WHERE opportunity_id = ?
     ORDER BY updated_at DESC`,
    [opportunityId],
  );
}

async function getStakeholders(opportunityId) {
  return query(
    `SELECT s.*, u.full_name AS owner_name
     FROM opportunity_workspace_stakeholders s
     LEFT JOIN users u ON u.id = s.updated_by_user_id
     WHERE s.opportunity_id = ?
     ORDER BY FIELD(s.support_level, 'champion', 'supporter', 'neutral', 'resistant', 'blocker'), s.updated_at DESC`,
    [opportunityId],
  );
}

async function getActions(opportunityId) {
  return query(
    `SELECT a.*, u.full_name AS owner_name, st.name AS stage_name, w.title AS weakness_title, s.name AS stakeholder_name
     FROM opportunity_workspace_actions a
     LEFT JOIN users u ON u.id = a.owner_user_id
     LEFT JOIN opportunity_sales_stages st ON st.id = a.linked_stage_id
     LEFT JOIN opportunity_workspace_weaknesses w ON w.id = a.linked_weakness_id
     LEFT JOIN opportunity_workspace_stakeholders s ON s.id = a.stakeholder_id
     WHERE a.opportunity_id = ?
     ORDER BY FIELD(a.status, 'pending', 'in_progress', 'blocked', 'done'),
              a.is_primary_next_step DESC,
              a.scheduled_at IS NULL,
              a.scheduled_at,
              a.due_date IS NULL,
              a.due_date,
              a.updated_at DESC`,
    [opportunityId],
  );
}

async function getDeliverables(opportunityId) {
  return query(
    `SELECT d.*, st.name AS stage_name
     FROM opportunity_workspace_deliverables d
     LEFT JOIN opportunity_sales_stages st ON st.id = d.linked_stage_id
     WHERE d.opportunity_id = ?
     ORDER BY FIELD(d.status, 'missing', 'draft', 'sent', 'validated'), d.updated_at DESC`,
    [opportunityId],
  );
}

async function getWorkspaceHistory(opportunityId) {
  const auditRows = await query(
    `SELECT module, action, entity_type, entity_id, detail, changed_fields, created_at, performed_by_name
     FROM audit_log
     WHERE entity_type = 'opportunity' AND entity_id = ?
     ORDER BY created_at DESC
     LIMIT 30`,
    [opportunityId],
  ).catch(() => []);

  const answerRows = await query(
    `SELECT q.prompt, a.answer_value, a.answered_at AS created_at
     FROM opportunity_stage_question_answers a
     INNER JOIN opportunity_stage_questions q ON q.id = a.question_id
     WHERE a.opportunity_id = ?
     ORDER BY a.answered_at DESC
     LIMIT 20`,
    [opportunityId],
  );

  const history = [
    ...auditRows.map((row, index) => ({
      id: `audit:${index}:${row.created_at}`,
      type: row.action,
      label: String(row.detail || `${row.module}.${row.action}`),
      detail: row.changed_fields || null,
      actorName: row.performed_by_name || null,
      createdAt: row.created_at,
    })),
    ...answerRows.map((row, index) => ({
      id: `answer:${index}:${row.created_at}`,
      type: "stage_answer",
      label: row.prompt,
      detail: row.answer_value,
      createdAt: row.created_at,
    })),
  ];

  return history
    .sort(
      (left, right) =>
        new Date(right.createdAt).getTime() -
        new Date(left.createdAt).getTime(),
    )
    .slice(0, 40);
}

function parseAuditChangedFields(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function getLatestWorkspaceStageValidations({
  opportunityId,
  currentSalesStageId,
}) {
  const rows = await query(
    `SELECT id, action, changed_fields,
            created_at
     FROM audit_log
     WHERE entity_type = 'opportunity'
       AND entity_id = ?
     ORDER BY id DESC`,
    [opportunityId],
  ).catch(() => []);

  const validationsByStageId = new Map();
  let inferredSalesStageId = Number(currentSalesStageId || 0) || null;

  for (const row of rows) {
    const changedFields = parseAuditChangedFields(row.changed_fields);

    if (row.action === "stage_validated") {
      const explicitSalesStageId = Number(
        changedFields?.validated_sales_stage_id?.after ||
          changedFields?.sales_stage_id?.after ||
          inferredSalesStageId ||
          0,
      );
      if (
        explicitSalesStageId &&
        !validationsByStageId.has(explicitSalesStageId)
      ) {
        const decision = String(
          changedFields?.validation_decision?.after || "",
        ).trim();
        validationsByStageId.set(explicitSalesStageId, {
          salesStageId: explicitSalesStageId,
          decision,
          summary: String(
            changedFields?.validation_summary?.after || "",
          ).trim(),
          validatedAt: row.created_at || null,
          isValidated:
            decision === "ready_to_advance" ||
            decision === "advance_with_caution",
        });
      }
    }

    const previousSalesStageId = Number(
      changedFields?.sales_stage_id?.before || 0,
    );
    if (previousSalesStageId) {
      inferredSalesStageId = previousSalesStageId;
    }
  }

  return validationsByStageId;
}

export async function buildOpportunityWorkspace({
  opportunityState,
  stageView,
  documents = [],
  persistRecommendedStrategy = false,
  strategyUpdatedByUserId = null,
}) {
  const activePlaybook = await ensureDefaultPlaybook();
  const activePlaybookDefinition = await getActivePlaybookDefinition();

  const opportunityId = Number(opportunityState.id);
  const workspaceAnswers = await getLatestWorkspaceStageAnswers(opportunityId);
  const answerMap = buildAnswerMap(workspaceAnswers);
  const persistedAssessments =
    await getPersistedCriterionAssessments(opportunityId);
  const persistedByCode = new Map(
    persistedAssessments.map((item) => [String(item.criterion_code), item]),
  );
  const stagesByCode = new Map(
    stageView.stages.map((stage) => [String(stage.code), stage]),
  );
  const stakeholders = (await getStakeholders(opportunityId)).map((row) => ({
    id: Number(row.id),
    name: row.name,
    roleCode: row.role_code,
    roleLabel: row.role_label || row.role_code,
    influenceLevel: row.influence_level,
    supportLevel: row.support_level,
    status: row.status,
    priorities: row.priorities || "",
    concerns: row.concerns || "",
    nextAction: row.next_action || "",
    lastContactAt: row.last_contact_at || null,
    updatedAt: row.updated_at,
  }));
  const actions = (await getActions(opportunityId)).map((row) => ({
    id: Number(row.id),
    title: row.title,
    actionType: row.action_type,
    status: row.status,
    priority: row.priority,
    linkedStageId: row.linked_stage_id ? Number(row.linked_stage_id) : null,
    linkedThemeCode: row.linked_theme_code || null,
    linkedWeaknessId: row.linked_weakness_id
      ? Number(row.linked_weakness_id)
      : null,
    stakeholderId: row.stakeholder_id ? Number(row.stakeholder_id) : null,
    ownerUserId: row.owner_user_id ? Number(row.owner_user_id) : null,
    ownerName: row.owner_name || "",
    dueDate: row.due_date || null,
    scheduledAt: row.scheduled_at || null,
    successCriteria: row.success_criteria || "",
    notes: row.notes || "",
    isPrimaryNextStep: Boolean(row.is_primary_next_step),
    stageName: row.stage_name || "",
    weaknessTitle: row.weakness_title || "",
    stakeholderName: row.stakeholder_name || "",
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  }));
  const stageValidationsByStageId = await getLatestWorkspaceStageValidations({
    opportunityId,
    currentSalesStageId: opportunityState?.salesStageId,
  });

  const playbookStageDefinitions = activePlaybookDefinition?.stages?.length
    ? activePlaybookDefinition.stages
    : PLAYBOOK_STAGE_DEFINITIONS;

  const stageDefinitions = playbookStageDefinitions.map((definition) => {
    const stageMeta = stagesByCode.get(definition.stageCode) || null;
    const criteria = definition.criteria.map((criterion) => {
      const criterionAnswer = getCriterionAnswer(answerMap, criterion.code);
      const inferred = inferCriterionFromAnswer({
        criterion,
        answer: criterionAnswer,
        stageCode: definition.stageCode,
        stageId: stageMeta?.id || null,
        actions,
        stakeholders,
      });
      return mergeCriterionAssessment(
        {
          ...inferred,
          sourcePrompt: criterionAnswer?.prompt || null,
          answerValue: criterionAnswer?.answer_value || "",
        },
        persistedByCode.get(criterion.code),
      );
    });
    const stageStatus = buildStageStatus(criteria);
    const stageValidation = stageMeta?.id
      ? stageValidationsByStageId.get(Number(stageMeta.id)) || null
      : null;
    return {
      code: definition.stageCode,
      stageId: stageMeta?.id || null,
      order: stageMeta?.order || null,
      stageName: stageMeta?.name || definition.stageCode,
      objective: definition.objective,
      exitCriteriaSummary: definition.exitCriteriaSummary,
      checklist: criteria,
      status: stageStatus.status,
      completionRatio: stageValidation?.isValidated
        ? Number(stageStatus.completionRatio.toFixed(2))
        : 0,
      weaknessCount: stageStatus.weaknessCount,
      isValidated: Boolean(stageValidation?.isValidated),
      validationDecision: stageValidation?.decision || null,
      validationSummary: stageValidation?.summary || null,
      validatedAt: stageValidation?.validatedAt || null,
      isCurrent: Boolean(stageMeta?.isCurrent),
      isSelected: Boolean(stageMeta?.isSelected),
      isPast: Boolean(stageMeta?.isPast),
      isFuture: Boolean(stageMeta?.isFuture),
    };
  });

  const allCriterionAssessments = stageDefinitions.flatMap((stage) =>
    stage.checklist.map((item) => ({ ...item, salesStageCode: stage.code })),
  );
  const selectedStageWorkspace =
    stageDefinitions.find((stage) => stage.isSelected) || null;
  const actualCurrentStageWorkspace =
    stageDefinitions.find((stage) => stage.isCurrent) ||
    stageDefinitions[0] ||
    null;
  const currentStageWorkspace =
    selectedStageWorkspace || actualCurrentStageWorkspace;
  const weaknessStageWorkspace =
    selectedStageWorkspace && !selectedStageWorkspace.isFuture
      ? selectedStageWorkspace
      : actualCurrentStageWorkspace;
  const reachedStageIds = new Set(
    stageDefinitions
      .filter((stage) => !stage.isFuture)
      .map((stage) => Number(stage.stageId || 0))
      .filter(Boolean),
  );

  const manualWeaknessRows = await getManualWeaknesses(opportunityId);
  const manualWeaknesses = manualWeaknessRows
    .map((row) => ({
      id: Number(row.id),
      title: row.title,
      category: row.category,
      severity: row.severity,
      status: row.status,
      salesStageId: row.sales_stage_id ? Number(row.sales_stage_id) : null,
      themeCode: row.theme_code || null,
      detail: row.detail || "",
      mitigationPlan: row.mitigation_plan || "",
      ownerUserId: row.owner_user_id ? Number(row.owner_user_id) : null,
      ownerName: row.owner_name || "",
      dueDate: row.due_date || null,
      resolvedNote: row.resolved_note || "",
      updatedAt: row.updated_at,
      isAutoGenerated: false,
    }))
    .filter(
      (item) =>
        !item.salesStageId || reachedStageIds.has(Number(item.salesStageId)),
    );
  const autoWeaknesses = buildAutoWeaknesses({
    criterionAssessments: weaknessStageWorkspace?.checklist
      ? weaknessStageWorkspace.checklist.map((item) => ({
          ...item,
          salesStageCode: weaknessStageWorkspace.code,
        }))
      : [],
    stagesByCode,
  }).filter(
    (autoItem) =>
      (!autoItem.salesStageId ||
        reachedStageIds.has(Number(autoItem.salesStageId))) &&
      !manualWeaknesses.some(
        (item) => normalizeText(item.title) === normalizeText(autoItem.title),
      ),
  );
  const weaknesses = [...manualWeaknesses, ...autoWeaknesses];

  const themeEntries = await getThemeEntries(opportunityId);
  const themes = summarizeThemes({
    themeEntries,
    criterionAssessments: allCriterionAssessments,
    answers: workspaceAnswers,
    documents,
  });
  const stakeholderSuggestions = extractSuggestedStakeholdersFromDocuments({
    documents,
    stakeholders,
  });

  const deliverables = (await getDeliverables(opportunityId)).map((row) => ({
    id: Number(row.id),
    deliverableType: row.deliverable_type,
    title: row.title,
    audience: row.audience || "",
    status: row.status,
    versionLabel: row.version_label || "",
    linkedStageId: row.linked_stage_id ? Number(row.linked_stage_id) : null,
    stageName: row.stage_name || "",
    sentAt: row.sent_at || null,
    outcomeSummary: row.outcome_summary || "",
    documentPublicId: row.document_public_id || null,
  }));

  const recommendations = {
    actions: buildRecommendedActions({
      stageDefinitions,
      currentStage:
        stageDefinitions.find((stage) => stage.isSelected) ||
        stageDefinitions[0],
      weaknesses,
      stakeholders,
      actions,
      themes,
    }),
    deliverables: buildRecommendedDeliverables({
      currentStage:
        stageDefinitions.find((stage) => stage.isSelected) ||
        stageDefinitions[0],
      deliverables,
    }),
    stakeholders: stakeholderSuggestions,
  };

  const scorecard = summarizeScorecard({
    criterionAssessments: allCriterionAssessments,
    themes,
    stakeholders,
    actions,
    weaknesses,
    currentStage: currentStageWorkspace,
  });
  const health = scorecard.health;

  const purchaseMaturity = derivePurchaseMaturity({
    budgetItem: scorecard.items.find((item) => item.key === "budget") || null,
    decidersItem:
      scorecard.items.find((item) => item.key === "deciders") || null,
    currentStage: currentStageWorkspace,
  });
  const derivedRecommendedStrategy = buildRecommendedStrategy({
    currentStage: currentStageWorkspace,
    stages: stageDefinitions,
    weaknesses,
    purchaseMaturity,
    scorecardItems: scorecard.items,
  });
  if (persistRecommendedStrategy) {
    await upsertOpportunityRecommendedStrategy({
      opportunityId,
      strategy: derivedRecommendedStrategy,
      currentStage: currentStageWorkspace,
      userId: strategyUpdatedByUserId,
    });
  }
  const persistedRecommendedStrategy = persistRecommendedStrategy
    ? null
    : await getPersistedOpportunityRecommendedStrategy(opportunityId);
  const recommendedStrategy =
    persistedRecommendedStrategy || derivedRecommendedStrategy;

  return {
    playbook: activePlaybookDefinition?.playbook ||
      activePlaybook || {
        code: DEFAULT_PLAYBOOK_CODE,
        name: "Playbook comercial B2B",
        version: "v1",
      },
    summary: {
      health,
      openWeaknessCount: weaknesses.filter((item) => item.status === "open")
        .length,
      criticalWeaknessCount: weaknesses.filter(
        (item) => item.status === "open" && item.severity === "high",
      ).length,
      pendingActionCount: actions.filter((item) => item.status !== "done")
        .length,
      stakeholderCoverageCount: stakeholders.length,
      evidenceThemeCoverage: themes.filter((item) => item.state !== "missing")
        .length,
    },
    stages: stageDefinitions,
    currentStage: currentStageWorkspace,
    scorecard,
    themes,
    weaknesses,
    stakeholders,
    actions,
    deliverables,
    recommendations,
    recommendedStrategy,
    history: await getWorkspaceHistory(opportunityId),
  };
}

export async function upsertOpportunityCriterionAssessment({
  opportunityId,
  criterionCode,
  salesStageId,
  status,
  score,
  confidence,
  summary,
  userId,
}) {
  await ensureOpportunityWorkspaceSchema();
  await query(
    `INSERT INTO opportunity_workspace_criterion_assessments (
      opportunity_id,
      criterion_code,
      sales_stage_id,
      status,
      score,
      confidence,
      summary,
      updated_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      sales_stage_id = VALUES(sales_stage_id),
      status = VALUES(status),
      score = VALUES(score),
      confidence = VALUES(confidence),
      summary = VALUES(summary),
      updated_by_user_id = VALUES(updated_by_user_id),
      updated_at = NOW(3)`,
    [
      opportunityId,
      criterionCode,
      salesStageId || null,
      status,
      score,
      confidence,
      summary || null,
      userId,
    ],
  );
}

async function insertOrUpdateEntity({
  table,
  id,
  allowedColumns,
  payload,
  createColumns,
  createValues,
}) {
  await ensureOpportunityWorkspaceSchema();

  const entries = Object.entries(payload).filter((entry) =>
    allowedColumns.includes(entry[0]),
  );
  if (id) {
    const setClause = entries.map(([key]) => `${key} = ?`).join(", ");
    await query(
      `UPDATE ${table} SET ${setClause}, updated_at = NOW(3) WHERE id = ?`,
      [...entries.map((entry) => entry[1]), id],
    );
    return Number(id);
  }
  const createColumnSet = new Set(createColumns);
  const insertEntries = entries.filter(
    (entry) => !createColumnSet.has(entry[0]),
  );
  const columns = [...createColumns, ...insertEntries.map((entry) => entry[0])];
  const placeholders = columns.map(() => "?").join(", ");
  const result = await query(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`,
    [...createValues, ...insertEntries.map((entry) => entry[1])],
  );
  return Number(result.insertId);
}

export async function saveOpportunityWeakness({
  opportunityId,
  weaknessId,
  payload,
  userId,
}) {
  return insertOrUpdateEntity({
    table: "opportunity_workspace_weaknesses",
    id: weaknessId,
    allowedColumns: [
      "title",
      "category",
      "severity",
      "status",
      "sales_stage_id",
      "theme_code",
      "detail",
      "mitigation_plan",
      "owner_user_id",
      "due_date",
      "resolved_note",
      "updated_by_user_id",
    ],
    payload: { ...payload, updated_by_user_id: userId },
    createColumns: [
      "opportunity_id",
      "created_by_user_id",
      "updated_by_user_id",
    ],
    createValues: [opportunityId, userId, userId],
  });
}

export async function saveOpportunityThemeEntry({
  opportunityId,
  entryId,
  payload,
  userId,
}) {
  return insertOrUpdateEntity({
    table: "opportunity_workspace_theme_entries",
    id: entryId,
    allowedColumns: [
      "theme_code",
      "claim",
      "status",
      "confidence",
      "source_type",
      "source_ref_id",
      "evidence_excerpt",
      "updated_by_user_id",
    ],
    payload: { ...payload, updated_by_user_id: userId },
    createColumns: [
      "opportunity_id",
      "created_by_user_id",
      "updated_by_user_id",
    ],
    createValues: [opportunityId, userId, userId],
  });
}

export async function saveOpportunityStakeholder({
  opportunityId,
  stakeholderId,
  payload,
  userId,
}) {
  return insertOrUpdateEntity({
    table: "opportunity_workspace_stakeholders",
    id: stakeholderId,
    allowedColumns: [
      "name",
      "role_code",
      "role_label",
      "influence_level",
      "support_level",
      "status",
      "priorities",
      "concerns",
      "next_action",
      "last_contact_at",
      "updated_by_user_id",
    ],
    payload: { ...payload, updated_by_user_id: userId },
    createColumns: [
      "opportunity_id",
      "created_by_user_id",
      "updated_by_user_id",
    ],
    createValues: [opportunityId, userId, userId],
  });
}

export async function saveOpportunityAction({
  opportunityId,
  actionId,
  payload,
  userId,
}) {
  return insertOrUpdateEntity({
    table: "opportunity_workspace_actions",
    id: actionId,
    allowedColumns: [
      "title",
      "action_type",
      "status",
      "priority",
      "linked_stage_id",
      "linked_theme_code",
      "linked_weakness_id",
      "stakeholder_id",
      "owner_user_id",
      "due_date",
      "scheduled_at",
      "success_criteria",
      "notes",
      "is_primary_next_step",
      "updated_by_user_id",
    ],
    payload: { ...payload, updated_by_user_id: userId },
    createColumns: [
      "opportunity_id",
      "created_by_user_id",
      "updated_by_user_id",
    ],
    createValues: [opportunityId, userId, userId],
  });
}

export async function saveOpportunityDeliverable({
  opportunityId,
  deliverableId,
  payload,
  userId,
}) {
  return insertOrUpdateEntity({
    table: "opportunity_workspace_deliverables",
    id: deliverableId,
    allowedColumns: [
      "deliverable_type",
      "title",
      "audience",
      "status",
      "version_label",
      "linked_stage_id",
      "sent_at",
      "outcome_summary",
      "document_public_id",
      "updated_by_user_id",
    ],
    payload: { ...payload, updated_by_user_id: userId },
    createColumns: [
      "opportunity_id",
      "created_by_user_id",
      "updated_by_user_id",
    ],
    createValues: [opportunityId, userId, userId],
  });
}

async function deleteOpportunityWorkspaceRow({ table, opportunityId, id }) {
  await ensureOpportunityWorkspaceSchema();
  const result = await query(
    `DELETE FROM ${table} WHERE opportunity_id = ? AND id = ? LIMIT 1`,
    [opportunityId, id],
  );
  return Number(result.affectedRows || 0) > 0;
}

export async function deleteOpportunityCriterionAssessment({
  opportunityId,
  criterionCode,
}) {
  await ensureOpportunityWorkspaceSchema();
  const result = await query(
    `DELETE FROM opportunity_workspace_criterion_assessments
     WHERE opportunity_id = ? AND criterion_code = ?
     LIMIT 1`,
    [opportunityId, criterionCode],
  );
  return Number(result.affectedRows || 0) > 0;
}

export async function deleteOpportunityWeakness({ opportunityId, weaknessId }) {
  return deleteOpportunityWorkspaceRow({
    table: "opportunity_workspace_weaknesses",
    opportunityId,
    id: weaknessId,
  });
}

export async function deleteOpportunityThemeEntry({ opportunityId, entryId }) {
  return deleteOpportunityWorkspaceRow({
    table: "opportunity_workspace_theme_entries",
    opportunityId,
    id: entryId,
  });
}

export async function deleteOpportunityStakeholder({
  opportunityId,
  stakeholderId,
}) {
  return deleteOpportunityWorkspaceRow({
    table: "opportunity_workspace_stakeholders",
    opportunityId,
    id: stakeholderId,
  });
}

export async function deleteOpportunityAction({ opportunityId, actionId }) {
  return deleteOpportunityWorkspaceRow({
    table: "opportunity_workspace_actions",
    opportunityId,
    id: actionId,
  });
}

export async function deleteOpportunityDeliverable({
  opportunityId,
  deliverableId,
}) {
  return deleteOpportunityWorkspaceRow({
    table: "opportunity_workspace_deliverables",
    opportunityId,
    id: deliverableId,
  });
}
