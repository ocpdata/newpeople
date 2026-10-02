import { query } from "../db.js";

export const COACH_INTENT_MIN_CONFIDENCE = 0.68;
export const COACH_INTERACTION_MODES = Object.freeze([
  "coaching",
  "brief_context",
  "deep_exploration",
  "operation",
]);

const COACHING_TOOLS = new Set([
  "getSellerPipeline",
  "searchOpportunities",
  "getOpportunity",
  "getOpportunityReadiness",
  "getOpportunityActivities",
  "searchAccounts",
  "searchLeads",
]);

const DETAIL_TARGETS = new Set([
  "account",
  "opportunity",
  "quotation",
  "contact",
  "lead",
]);

export const COACH_INTENT_CATALOG = Object.freeze([
  {
    code: "process_information",
    label: "Consulta informativa del proceso",
    description:
      "Explica etapas, conceptos o prácticas generales del proceso comercial.",
    examples: [
      "¿Qué etapas tiene el proceso de venta?",
      "¿Cuál es el proceso de ventas?",
      "¿Qué ocurre durante la etapa de demostración?",
    ],
    requiredContext: [],
    tools: [],
  },
  {
    code: "seller_coaching",
    label: "Desempeño y prioridades del vendedor",
    description:
      "Ayuda al vendedor a priorizar, mejorar seguimiento y avanzar el proceso con señales resumidas de su cartera.",
    examples: [
      "¿Cómo puedo mejorar mi desempeño comercial?",
      "¿Qué me sugieres hacer?",
      "Ayúdame a priorizar las oportunidades que debo atender esta semana.",
    ],
    requiredContext: [],
    tools: [
      "getSellerPipeline",
      "searchOpportunities",
      "getOpportunity",
      "getOpportunityReadiness",
      "getOpportunityActivities",
      "searchAccounts",
      "searchLeads",
    ],
  },
  {
    code: "stage_readiness",
    label: "Preparación de oportunidad",
    description:
      "Evalúa pendientes, riesgos o preparación de una oportunidad concreta.",
    examples: [
      "¿Qué me falta para avanzar de etapa en esta oportunidad?",
      "¿Qué riesgos bloquean esta oportunidad?",
    ],
    requiredContext: ["opportunity"],
    tools: ["getOpportunityReadiness", "getOpportunity"],
  },
  {
    code: "activity_query",
    label: "Consulta de actividades",
    description: "Consulta actividades y siguientes pasos de una oportunidad.",
    examples: ["¿Qué actividades están pendientes de esta oportunidad?"],
    requiredContext: ["opportunity"],
    tools: ["getOpportunityActivities"],
  },
  {
    code: "quotation_query",
    label: "Consulta de cotización",
    description:
      "Consulta contenido comercial de la cotización vinculada a una oportunidad.",
    examples: ["¿Qué contiene la cotización de esta oportunidad?"],
    requiredContext: ["opportunity"],
    tools: ["getOpportunityQuotation"],
  },
  {
    code: "contact_query",
    label: "Consulta de contactos",
    description:
      "Busca contactos y decisores relacionados con una cuenta u oportunidad.",
    examples: ["¿Quiénes son los decisores de la cuenta?"],
    requiredContext: ["account"],
    tools: ["searchContacts"],
  },
  {
    code: "account_query",
    label: "Consulta de cuenta",
    description: "Consulta el resumen o historial de una cuenta.",
    examples: ["Dame un resumen de esta cuenta."],
    requiredContext: ["account"],
    tools: ["searchAccounts"],
  },
  {
    code: "opportunity_query",
    label: "Consulta de oportunidades",
    description: "Busca o resume oportunidades autorizadas.",
    examples: ["¿Qué oportunidades abiertas tiene esta cuenta?"],
    requiredContext: [],
    tools: ["searchOpportunities", "getOpportunity", "getSellerPipeline"],
  },
  {
    code: "lead_query",
    label: "Consulta de leads",
    description: "Busca o consulta leads autorizados.",
    examples: ["¿Qué leads tengo pendientes?"],
    requiredContext: [],
    tools: ["searchLeads"],
  },
  {
    code: "account_ranking",
    label: "Cobertura de pipeline por cuenta",
    description: "Compara cuentas mediante sus oportunidades autorizadas.",
    examples: ["¿Qué cuentas tienen más oportunidades abiertas?"],
    requiredContext: [],
    tools: ["getSellerPipeline", "searchOpportunities"],
  },
  {
    code: "temporal_filter",
    label: "Consulta temporal",
    description:
      "Filtra registros por fechas de cierre u otro periodo comercial.",
    examples: ["¿Qué oportunidades cierran este año?"],
    requiredContext: [],
    tools: ["searchOpportunities", "getSellerPipeline"],
  },
  {
    code: "operation",
    label: "Solicitud de operación",
    description:
      "Solicita explícitamente crear o modificar un registro CRM mediante el flujo de confirmación. No incluye pedir recomendaciones, preguntar si se puede enviar un correo ni solicitar un borrador de correo.",
    examples: ["Agenda una llamada con el cliente."],
    requiredContext: [],
    tools: [
      "searchAccounts",
      "searchOpportunities",
      "getOpportunity",
      "getOpportunityActivities",
      "searchContacts",
      "searchLeads",
    ],
  },
  {
    code: "general_query",
    label: "Consulta general",
    description:
      "Pregunta que no corresponde claramente a otra intención del catálogo.",
    examples: [
      "Ayúdame a preparar mi siguiente conversación.",
      "¿Cómo puedo preguntar esto de otra manera?",
      "Ayúdame a formular una pregunta para el cliente.",
      "¿Le puedo enviar un correo a esta cuenta?",
      "Dame un ejemplo de correo para esta oportunidad.",
    ],
    requiredContext: [],
    tools: [],
  },
  {
    code: "clarification",
    label: "Requiere aclaración",
    description:
      "La solicitud es ambigua o la clasificación no alcanza la confianza mínima.",
    examples: ["¿Cómo va?"],
    requiredContext: [],
    tools: [],
  },
]);

const CONTEXT_KEYS = new Set(["account", "opportunity", "contact", "lead"]);
const CATALOG_BY_CODE = new Map(
  COACH_INTENT_CATALOG.map((item) => [item.code, item]),
);

export function isGeneralCoachProcessInformationQuestion(question = "") {
  const text = String(question || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (
    /\b(mi|mis|esta|este|esa|ese|cuenta|cuentas|oportunidad|oportunidades|cliente|contacto|contactos|lead|leads)\b/.test(
      text,
    )
  ) {
    return false;
  }
  return (
    /\b(?:cual es|que es|como funciona|como es|explica|describe|resume|dime)\b.*\b(?:proceso (?:de )?(?:venta|ventas|comercial)|ciclo (?:de )?ventas)\b/.test(
      text,
    ) ||
    /^que etapas? (?:tiene|contempla|incluye)\b.*\bproceso\b/.test(text) ||
    /^que (?:ocurre|pasa) (?:durante|en) (?:la )?etapa\b/.test(text)
  );
}

export function isCoachEmailHelpQuestion(question = "") {
  const text = String(question || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!/\b(correo|correos|email|emails)\b/.test(text)) return false;
  return (
    /\b(puedo|podemos|puede|se puede|es posible)\b.*\b(enviar|mandar|redactar|escribir)\b/.test(
      text,
    ) ||
    /\b(ejemplo|borrador)\b/.test(text) ||
    /\b(redacta|redactar|escribe|escribir|prepara|preparar|envia|enviar|manda|mandar)\b.*\b(correo|correos|email|emails)\b/.test(
      text,
    )
  );
}

export function isCoachQuestionPhrasingHelp(question = "") {
  const text = String(question || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return (
    /\b(como puedo|como podria|como debo|de que manera puedo)\b.*\b(preguntar|formular|plantear|decir)\b/.test(
      text,
    ) ||
    /\b(otra manera|otra forma|reformular)\b.*\b(pregunta|preguntar)\b/.test(
      text,
    )
  );
}

function getDefaultInteractionMode(intent) {
  if (intent === "operation") return "operation";
  if (
    [
      "account_query",
      "contact_query",
      "activity_query",
      "quotation_query",
      "opportunity_query",
      "lead_query",
    ].includes(intent)
  ) {
    return "brief_context";
  }
  return "coaching";
}

function getDefaultDetailTarget(intent) {
  if (["quotation_query"].includes(intent)) return "quotation";
  if (["contact_query"].includes(intent)) return "contact";
  if (["account_query"].includes(intent)) return "account";
  if (["lead_query"].includes(intent)) return "lead";
  if (
    ["activity_query", "stage_readiness", "opportunity_query"].includes(intent)
  )
    return "opportunity";
  return null;
}

function getRequiredContextForClassification(intent, mode, detailTarget) {
  if (mode !== "deep_exploration") {
    return [...(CATALOG_BY_CODE.get(intent)?.requiredContext || [])];
  }
  if (detailTarget === "account" || detailTarget === "contact")
    return ["account"];
  if (detailTarget === "opportunity" || detailTarget === "quotation")
    return ["opportunity"];
  if (detailTarget === "lead") return ["lead"];
  return [];
}

function getAllowedToolsForClassification(intent, mode) {
  const catalogTools = CATALOG_BY_CODE.get(intent)?.tools || [];
  if (mode === "deep_exploration") return [];
  if (mode === "coaching")
    return catalogTools.filter((tool) => COACHING_TOOLS.has(tool));
  return [...catalogTools];
}

let ensureIntentGovernanceSchemaPromise;

export function normalizeIntentExamples(value, fallback = []) {
  const source = Array.isArray(value) ? value : fallback;
  const examples = [
    ...new Set(
      source
        .map((item) =>
          String(item || "")
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 240),
        )
        .filter(Boolean),
    ),
  ];
  if (!examples.length || examples.length > 30) {
    throw new Error("Cada intención debe tener entre 1 y 30 ejemplos.");
  }
  return examples;
}

export function validateCoachIntentClassification(value) {
  const code = String(value?.intent || "").trim();
  const catalogItem = CATALOG_BY_CODE.get(code);
  const confidence = Number(value?.confidence);
  if (
    !catalogItem ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    return {
      intent: "clarification",
      mode: "coaching",
      confidence: 0,
      requiresClarification: true,
      reason: "invalid_classification",
      requiredContext: [],
      suggestedContext: [],
      allowedTools: [],
    };
  }
  const requestedMode = String(value?.mode || "").trim();
  const invalidMode = Boolean(
    requestedMode && !COACH_INTERACTION_MODES.includes(requestedMode),
  );
  const mode = COACH_INTERACTION_MODES.includes(requestedMode)
    ? requestedMode
    : getDefaultInteractionMode(code);
  const requestedDetailTarget = String(value?.detailTarget || "").trim();
  const invalidDetailTarget = Boolean(
    requestedDetailTarget && !DETAIL_TARGETS.has(requestedDetailTarget),
  );
  const detailTarget = DETAIL_TARGETS.has(requestedDetailTarget)
    ? requestedDetailTarget
    : mode === "deep_exploration"
      ? getDefaultDetailTarget(code)
      : null;
  const suggestedContext = Array.isArray(value?.contextNeeded)
    ? [
        ...new Set(
          value.contextNeeded
            .map((item) => String(item).trim())
            .filter((item) => CONTEXT_KEYS.has(item)),
        ),
      ]
    : [];
  const modeIntentMismatch = (code === "operation") !== (mode === "operation");
  const requiresClarification =
    code === "clarification" ||
    confidence < COACH_INTENT_MIN_CONFIDENCE ||
    modeIntentMismatch ||
    invalidMode ||
    invalidDetailTarget ||
    (mode === "deep_exploration" && !detailTarget);
  const effectiveMode = requiresClarification ? "coaching" : mode;
  return {
    intent: requiresClarification ? "clarification" : code,
    mode: effectiveMode,
    detailTarget,
    confidence,
    requiresClarification,
    reason: requiresClarification
      ? String(
          value?.reason ||
            (modeIntentMismatch
              ? "intent_mode_mismatch"
              : invalidMode
                ? "invalid_interaction_mode"
                : invalidDetailTarget
                  ? "invalid_detail_target"
                  : mode === "deep_exploration" && !detailTarget
                    ? "missing_detail_target"
                    : "low_confidence"),
        )
          .trim()
          .slice(0, 240)
      : null,
    requiredContext: requiresClarification
      ? []
      : getRequiredContextForClassification(code, effectiveMode, detailTarget),
    suggestedContext,
    allowedTools: requiresClarification
      ? []
      : getAllowedToolsForClassification(code, effectiveMode),
  };
}

export function getMissingCoachIntentContext(classification, context = {}) {
  const contextIds = {
    account: context.accountId,
    opportunity: context.opportunityId,
    contact: context.contactId,
    lead: context.leadId,
  };
  return (classification?.requiredContext || []).filter(
    (key) => !(Number(contextIds[key] || 0) > 0),
  );
}

export function buildCoachDetailHandoff({
  classification,
  context = {},
  selectedOpportunity = null,
  explicitEntities = {},
  canOpenCustomerWorkspace = false,
  canOpenLeadManagement = false,
} = {}) {
  if (classification?.mode !== "deep_exploration") return null;
  const accountId =
    Number(
      context.accountId ||
        selectedOpportunity?.account?.id ||
        selectedOpportunity?.accountId ||
        explicitEntities.account?.id ||
        explicitEntities.opportunity?.account?.id ||
        explicitEntities.opportunity?.accountId ||
        explicitEntities.contact?.account?.id ||
        explicitEntities.contact?.accountId ||
        0,
    ) || null;
  const opportunityId =
    Number(context.opportunityId || selectedOpportunity?.id || 0) || null;
  const contactId =
    Number(context.contactId || explicitEntities.contact?.id || 0) || null;
  const leadId =
    Number(context.leadId || explicitEntities.lead?.id || 0) || null;

  if (classification.detailTarget === "lead") {
    return canOpenLeadManagement && leadId
      ? {
          destination: "lead_management",
          detailTarget: "lead",
          accountId,
          opportunityId,
          contactId,
          leadId,
        }
      : null;
  }

  return canOpenCustomerWorkspace && accountId
    ? {
        destination: "customer_account",
        detailTarget: classification.detailTarget || "account",
        accountId,
        opportunityId,
        contactId,
        leadId,
      }
    : null;
}

export function buildCoachIntentCatalogForPrompt(
  catalog = COACH_INTENT_CATALOG,
) {
  return catalog.map((item) => ({
    intent: item.intent || item.code,
    description: item.description,
    examples: [...item.examples],
    requiredContext: [...(item.requiredContext || [])],
    allowedTools: [...(item.allowedTools || item.tools || [])],
  }));
}

export function getCoachInteractionModePolicy(mode) {
  const policies = {
    coaching: {
      label: "Coaching del vendedor",
      instruction:
        "Prioriza cómo mejorar el desempeño y avanzar en el proceso. Usa solo evidencia puntual o resumida necesaria para justificar la recomendación; no conviertas la respuesta en una ficha del cliente.",
    },
    brief_context: {
      label: "Contexto breve",
      instruction:
        "Responde la pregunta puntual de forma breve, destacando solo los datos necesarios. No enumeres historiales, todos los contactos, partidas completas de cotización ni detalles exhaustivos; ofrece continuar en el espacio especializado si hace falta.",
    },
    deep_exploration: {
      label: "Exploración detallada",
      instruction:
        "No consultes registros ni herramientas desde Coach. Devuelve una derivación al espacio autorizado de detalle; el servidor resolverá el destino y validará el acceso al abrirlo.",
    },
    operation: {
      label: "Propuesta de operación",
      instruction:
        "Prepara una propuesta revisable según el flujo existente. No ejecutes escrituras ni afirmes que ocurrieron sin confirmación del módulo.",
    },
  };
  return policies[mode] || policies.coaching;
}

export function buildCoachIntentPreviewPrompt(question, catalog) {
  return {
    model: process.env.OPENAI_MODEL || undefined,
    temperature: 0,
    input: [
      {
        role: "system",
        content:
          "Clasifica usando exclusivamente un intent del catálogo y un mode: coaching, brief_context, deep_exploration u operation. Coaching busca mejorar el desempeño del vendedor; brief_context responde un dato puntual; deep_exploration pide revisar a fondo un registro y debe derivarse sin leerlo desde Coach; operation solicita proponer un cambio confirmado en el flujo posterior. Devuelve confidence de 0 a 1, contextNeeded, detailTarget (account, opportunity, quotation, contact o lead; null si no aplica) y reason. Si hay ambigüedad o confianza menor a 0.68, usa intent=clarification. No ejecutes herramientas ni inventes IDs.",
      },
      {
        role: "user",
        content: JSON.stringify({
          question: String(question || "").trim(),
          catalog: buildCoachIntentCatalogForPrompt(catalog),
          expectedJsonShape: {
            intent: "catalog intent code",
            mode: "coaching|brief_context|deep_exploration|operation",
            confidence: 0.0,
            contextNeeded: ["account|opportunity|contact|lead"],
            detailTarget: "account|opportunity|quotation|contact|lead|null",
            reason: "",
          },
        }),
      },
    ],
  };
}

async function ensureCoachIntentGovernanceSchema() {
  if (!ensureIntentGovernanceSchemaPromise) {
    ensureIntentGovernanceSchemaPromise = (async () => {
      await query(
        `CREATE TABLE IF NOT EXISTS mi_coach_intent_examples (
          intent_code VARCHAR(80) PRIMARY KEY,
          examples_json JSON NOT NULL,
          updated_by_user_id BIGINT UNSIGNED NULL,
          updated_at DATETIME(3) NOT NULL DEFAULT NOW(3)
        )`,
      );
      await query(
        `CREATE TABLE IF NOT EXISTS mi_coach_intent_revisions (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          snapshot_json JSON NOT NULL,
          changed_by_user_id BIGINT UNSIGNED NULL,
          restored_from_revision_id BIGINT UNSIGNED NULL,
          created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
          INDEX idx_mi_coach_intent_revisions_created (created_at)
        )`,
      );
      for (const item of COACH_INTENT_CATALOG) {
        await query(
          `INSERT IGNORE INTO mi_coach_intent_examples (intent_code, examples_json)
           VALUES (?, ?)`,
          [item.code, JSON.stringify(item.examples)],
        );
      }
    })().catch((error) => {
      ensureIntentGovernanceSchemaPromise = undefined;
      throw error;
    });
  }
  await ensureIntentGovernanceSchemaPromise;
}

async function readExampleMap() {
  await ensureCoachIntentGovernanceSchema();
  const rows = await query(
    `SELECT intent_code, examples_json FROM mi_coach_intent_examples`,
  );
  return Object.fromEntries(
    rows.map((row) => [
      row.intent_code,
      typeof row.examples_json === "string"
        ? JSON.parse(row.examples_json)
        : row.examples_json,
    ]),
  );
}

export async function listCoachIntentCatalog() {
  const exampleMap = await readExampleMap();
  return COACH_INTENT_CATALOG.map((item) => ({
    ...item,
    examples: normalizeIntentExamples(exampleMap[item.code], item.examples),
  }));
}

export async function updateCoachIntentExamples({
  user,
  intentCode,
  examples,
}) {
  const catalogItem = CATALOG_BY_CODE.get(String(intentCode || "").trim());
  if (!catalogItem) return null;
  const normalizedExamples = normalizeIntentExamples(examples);
  const before = await readExampleMap();
  await query(
    `INSERT INTO mi_coach_intent_revisions (snapshot_json, changed_by_user_id)
     VALUES (?, ?)`,
    [JSON.stringify(before), Number(user?.id) || null],
  );
  await query(
    `UPDATE mi_coach_intent_examples
     SET examples_json = ?, updated_by_user_id = ?, updated_at = NOW(3)
     WHERE intent_code = ?`,
    [
      JSON.stringify(normalizedExamples),
      Number(user?.id) || null,
      catalogItem.code,
    ],
  );
  return {
    catalog: await listCoachIntentCatalog(),
    before,
    after: { ...before, [catalogItem.code]: normalizedExamples },
  };
}

export async function listCoachIntentRevisions(limit = 20) {
  await ensureCoachIntentGovernanceSchema();
  const rows = await query(
    `SELECT id, changed_by_user_id, restored_from_revision_id, created_at
     FROM mi_coach_intent_revisions ORDER BY id DESC LIMIT ?`,
    [Math.max(1, Math.min(100, Number(limit) || 20))],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    changedByUserId: Number(row.changed_by_user_id) || null,
    restoredFromRevisionId: Number(row.restored_from_revision_id) || null,
    createdAt: row.created_at,
  }));
}

export async function restoreCoachIntentRevision({ user, revisionId }) {
  await ensureCoachIntentGovernanceSchema();
  const rows = await query(
    `SELECT id, snapshot_json FROM mi_coach_intent_revisions WHERE id = ? LIMIT 1`,
    [Number(revisionId)],
  );
  if (!rows[0]) return null;
  const current = await readExampleMap();
  const snapshot =
    typeof rows[0].snapshot_json === "string"
      ? JSON.parse(rows[0].snapshot_json)
      : rows[0].snapshot_json;
  const restored = Object.fromEntries(
    COACH_INTENT_CATALOG.map((item) => [
      item.code,
      normalizeIntentExamples(snapshot?.[item.code], item.examples),
    ]),
  );
  await query(
    `INSERT INTO mi_coach_intent_revisions
      (snapshot_json, changed_by_user_id, restored_from_revision_id)
     VALUES (?, ?, ?)`,
    [JSON.stringify(current), Number(user?.id) || null, Number(revisionId)],
  );
  for (const item of COACH_INTENT_CATALOG) {
    await query(
      `UPDATE mi_coach_intent_examples
       SET examples_json = ?, updated_by_user_id = ?, updated_at = NOW(3)
       WHERE intent_code = ?`,
      [
        JSON.stringify(restored[item.code]),
        Number(user?.id) || null,
        item.code,
      ],
    );
  }
  return {
    catalog: await listCoachIntentCatalog(),
    before: current,
    after: restored,
  };
}
