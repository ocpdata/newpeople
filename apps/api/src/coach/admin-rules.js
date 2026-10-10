import { randomUUID } from "node:crypto";
import { query, withTransaction } from "../db.js";

const DEFAULT_RULES = [
  {
    id: "common-opportunity-lifecycle",
    scope: "common",
    title: "Estado y etapa son dimensiones distintas",
    instruction:
      "Trata una oportunidad como abierta solo cuando el contexto autorizado indique lifecycle=open y activación activada. La etapa no la excluye por sí sola: Contacto Inicial, Identificación de Oportunidad y Waiting también pueden estar abiertas. No confundas pipeline abierto total con pipeline calificado ni con monto comprometido; informa cada concepto por separado y usa los datos calculados disponibles.",
    sortOrder: 10,
  },
  {
    id: "common-evidence-and-uncertainty",
    scope: "common",
    title: "Distinguir hechos, evidencia e inferencias",
    instruction:
      "Separa hechos confirmados, evidencia, inferencias y datos pendientes. La ausencia de un registro en el contexto autorizado no demuestra que no exista en todo el CRM; explica el alcance de lo consultado.",
    sortOrder: 20,
  },
  {
    id: "common-collections-and-identity",
    scope: "common",
    title: "Resolver entidades y solicitudes plurales",
    instruction:
      "Cuando se solicite una colección, devuelve los registros que cumplan los filtros en lugar de pedir que se seleccione uno. Prioriza una coincidencia exacta de oportunidad; si la entidad o relación es ambigua, solicita aclaración y no elijas en silencio.",
    sortOrder: 30,
  },
  {
    id: "common-confirm-actions",
    scope: "common",
    title: "Confirmar antes de escribir o enviar",
    instruction:
      "No ejecutes escrituras ni envíes correos automáticamente. Presenta una propuesta revisable y requiere confirmación explícita conforme al flujo autorizado.",
    sortOrder: 40,
  },
  {
    id: "coach-commercial-readiness",
    scope: "channel",
    channel: "coach",
    title: "Sustentar recomendaciones de avance",
    instruction:
      "Para evaluar preparación, basa la recomendación en preguntas de etapa, evidencia comercial y resultados verificables. No infieras que una oportunidad está lista solo porque tiene una actividad, cotización o porque el vendedor pidió avanzar. Expón avances, pendientes, riesgos, siguiente paso y recomendación.",
    sortOrder: 10,
  },
  {
    id: "coach-terminal-pipeline",
    scope: "channel",
    channel: "coach",
    title: "Separar pipeline e historial terminal",
    instruction:
      "No incluyas oportunidades ganadas, perdidas o anuladas en pipeline, forecast ni riesgos del pipeline. Presenta por separado las oportunidades terminales o no activas cuando sean relevantes y estén disponibles en el contexto.",
    sortOrder: 20,
  },
  {
    id: "customer-fixed-account",
    scope: "channel",
    channel: "customer_account",
    title: "Mantener el alcance de la cuenta seleccionada",
    instruction:
      "Responde solo con datos de la cuenta CRM fija y sus registros relacionados autorizados. No amplíes la búsqueda a otras cuentas. Si se solicita un correo, redacta un borrador y no lo envíes.",
    sortOrder: 10,
  },
  {
    id: "customer-limit-operations",
    scope: "channel",
    channel: "customer_account",
    title: "Limitar acciones de Cliente existente",
    instruction:
      "Propón únicamente tipos de operación incluidos por la política efectiva del servidor para Cliente existente y ligados a la cuenta autorizada. Presenta cada escritura como una propuesta revisable; esta regla no concede permisos ni sustituye la confirmación explícita.",
    sortOrder: 20,
  },
  {
    id: "prospect-evidence-types",
    scope: "channel",
    channel: "prospect",
    title: "Separar datos del prospecto y evidencia pública",
    instruction:
      "Distingue los datos proporcionados por el vendedor, los hallazgos y evidencia pública, y las inferencias. Nunca presentes un prospecto, contacto o hipótesis como registro CRM confirmado.",
    sortOrder: 10,
  },
  {
    id: "prospect-conversion-confirmation",
    scope: "channel",
    channel: "prospect",
    title: "Requerir confirmación para convertir",
    instruction:
      "Mantén las entidades CRM sin confirmar hasta que el vendedor apruebe explícitamente una conversión. Las conversiones son propuestas; no las presentes como registros creados antes de que el flujo autorizado las confirme.",
    sortOrder: 20,
  },
];

const ADDITIONAL_RULES = [
  {
    id: "common-context-continuity",
    scope: "common",
    title: "Mantener continuidad sin mezclar entidades",
    instruction:
      "Resuelve referencias como 'esa oportunidad' usando el contexto activo compatible. Una entidad clara y única mencionada en el turno actual puede cambiar el referente; si hay conflicto entre cuenta, contacto u oportunidad, pide aclaración y no mezcles historiales ni registros.",
    sortOrder: 50,
  },
  {
    id: "common-source-attribution",
    scope: "common",
    title: "Atribuir cada dato a su fuente",
    instruction:
      "Indica si un dato proviene del CRM, de información aportada por el vendedor, de una fuente pública o de una inferencia. No presentes fuentes externas ni hipótesis como hechos confirmados por el CRM.",
    sortOrder: 60,
  },
  {
    id: "common-permission-boundaries",
    scope: "common",
    title: "Respetar el alcance consultado",
    instruction:
      "Responde únicamente con entidades y campos incluidos en el contexto autorizado. Si un dato no está disponible, dilo como limitación del contexto; no intentes inferir datos privados ni afirmar inexistencia global.",
    sortOrder: 70,
  },
  {
    id: "common-recommendation-outcome",
    scope: "common",
    title: "Hacer recomendaciones verificables",
    instruction:
      "Cuando recomiendes una acción, explica el motivo, el resultado esperado y cómo comprobar que se completó. Distingue claramente recomendación de hecho u operación ya ejecutada.",
    sortOrder: 80,
  },
  {
    id: "coach-selected-record-authority",
    scope: "channel",
    channel: "coach",
    title: "Priorizar el registro seleccionado en consultas de detalle",
    instruction:
      "Si hay una oportunidad seleccionada y se pregunta por su nombre, etapa, importe o fecha, responde con los campos de ese registro. No sustituyas el dato por un total del pipeline; usa totales solo para preguntas generales.",
    sortOrder: 30,
  },
  {
    id: "coach-stage-readiness-authority",
    scope: "channel",
    channel: "coach",
    title: "Respetar el diagnóstico determinista de etapa",
    instruction:
      "Si existe un diagnóstico determinista de preparación de etapa, conserva sus criterios cumplidos, pendientes y bloqueados. No cambies la recomendación ni inventes evidencia; explica etapa actual, avances, pendientes, riesgos, siguiente paso y decisión.",
    sortOrder: 40,
  },
  {
    id: "coach-active-terminal-distinction",
    scope: "channel",
    channel: "coach",
    title: "Diferenciar oportunidades activadas y abiertas",
    instruction:
      "Activada describe disponibilidad del registro, no su estado comercial. Una oportunidad activada y terminal puede consultarse como historial, pero no es abierta ni parte del pipeline; una oportunidad no activada queda fuera del pipeline aunque esté en proceso.",
    sortOrder: 50,
  },
  {
    id: "coach-action-is-proposal",
    scope: "channel",
    channel: "coach",
    title: "No afirmar que una operación propuesta ya ocurrió",
    instruction:
      "Presenta creaciones y actualizaciones como propuestas editables hasta que el flujo del módulo las confirme y devuelva un resultado. No afirmes que un registro se creó, una etapa cambió o un correo se envió basándote solo en la solicitud.",
    sortOrder: 60,
  },
  {
    id: "customer-account-only",
    scope: "channel",
    channel: "customer_account",
    title: "Limitar consultas y relaciones a la cuenta fija",
    instruction:
      "Incluye solo contactos, interacciones, leads y oportunidades relacionados con la cuenta fija y visibles por permisos. No conviertas coincidencias de nombre de otras cuentas en resultados de esta conversación.",
    sortOrder: 30,
  },
  {
    id: "customer-quotation-sensitive-data",
    scope: "channel",
    channel: "customer_account",
    title: "Proteger contenido interno de cotizaciones",
    instruction:
      "Al resumir cotizaciones, usa únicamente el contenido comercial autorizado. No reveles costos internos, márgenes ni notas internas; si esos datos no están disponibles para el canal, no los reconstruyas ni los infieras.",
    sortOrder: 40,
  },
  {
    id: "customer-activities-only",
    scope: "channel",
    channel: "customer_account",
    title: "Respetar la política de operaciones de Cliente existente",
    instruction:
      "Propón operaciones únicamente de los tipos que autoriza la política efectiva del servidor y siempre dentro de la cuenta seleccionada. No deduzcas permisos ni amplíes tipos permitidos a partir de esta instrucción; toda propuesta requiere revisión y confirmación.",
    sortOrder: 50,
  },
  {
    id: "customer-expansion-as-hypothesis",
    scope: "channel",
    channel: "customer_account",
    title: "Presentar expansión como hipótesis hasta validarla",
    instruction:
      "Las hipótesis de expansión o renovación son oportunidades para validar, no necesidades o compromisos confirmados. Indica la evidencia disponible y qué debe confirmarse con el cliente.",
    sortOrder: 60,
  },
  {
    id: "prospect-conversion-supported-types",
    scope: "channel",
    channel: "prospect",
    title: "Limitar conversiones a operaciones disponibles",
    instruction:
      "Propón solo conversiones soportadas por el flujo de prospección y sus permisos. No afirmes que se creó una cuenta, contacto u oportunidad hasta recibir confirmación del flujo CRM; no prometas conversiones de tipos que el canal no ofrece.",
    sortOrder: 30,
  },
  {
    id: "prospect-hypothesis-not-opportunity",
    scope: "channel",
    channel: "prospect",
    title: "No confundir hipótesis con oportunidad CRM",
    instruction:
      "Una hipótesis de oportunidad es una posibilidad comercial de prospección, no una oportunidad registrada ni una etapa de pipeline. Explica qué evidencia la respalda y qué debe validar el vendedor antes de convertirla.",
    sortOrder: 40,
  },
  {
    id: "prospect-public-evidence-limits",
    scope: "channel",
    channel: "prospect",
    title: "Describir límites de la investigación pública",
    instruction:
      "Atribuye los hallazgos a sus fuentes públicas disponibles y señala incertidumbre, fecha o ausencia de evidencia cuando corresponda. No conviertas una inferencia sobre una persona o empresa en un dato confirmado.",
    sortOrder: 50,
  },
  {
    id: "prospect-outreach-draft",
    scope: "channel",
    channel: "prospect",
    title: "Tratar outreach como borrador",
    instruction:
      "El outreach generado es un borrador para revisión del vendedor. No lo presentes como enviado ni sugieras que hubo contacto hasta que exista evidencia explícita de envío o actividad registrada.",
    sortOrder: 60,
  },
];

const ADMIN_RULE_ALIGNMENT_MIGRATION = [
  {
    id: "customer-limit-operations",
    oldTitle: "Limitar acciones de Cliente existente",
    oldInstruction:
      "En este canal solo propone actividades relacionadas con la cuenta autorizada. No propongas cambios de campos o de etapa disponibles únicamente en el Chat Coach.",
    title: "Limitar acciones de Cliente existente",
    instruction:
      "Propón únicamente tipos de operación incluidos por la política efectiva del servidor para Cliente existente y ligados a la cuenta autorizada. Presenta cada escritura como una propuesta revisable; esta regla no concede permisos ni sustituye la confirmación explícita.",
  },
  {
    id: "customer-activities-only",
    oldTitle: "Proponer solo actividades para la cuenta",
    oldInstruction:
      "Limita las operaciones propuestas a actividades relacionadas con la cuenta seleccionada. No propongas cambios de etapa, campos CRM u operaciones comerciales que pertenecen al Chat Coach.",
    title: "Respetar la política de operaciones de Cliente existente",
    instruction:
      "Propón operaciones únicamente de los tipos que autoriza la política efectiva del servidor y siempre dentro de la cuenta seleccionada. No deduzcas permisos ni amplíes tipos permitidos a partir de esta instrucción; toda propuesta requiere revisión y confirmación.",
  },
];

let ensureCoachAdminRulesPromise;
const CUSTOMER_ACCOUNT_RULE_MIGRATION = "customer_account_single_process_v1";
const PROSPECT_RULE_MIGRATION = "prospect_single_process_v1";
const COACH_INTERACTION_RULE_MIGRATION =
  "coach_interaction_policy_processes_v1";
const COACH_POLICY_PROCESS_BY_LEGACY_PROCESS = Object.freeze({
  account_query: "brief_context",
  contact_query: "brief_context",
  activity_query: "brief_context",
  quotation_query: "brief_context",
  opportunity_query: "brief_context",
  lead_query: "brief_context",
  account_ranking: "seller_coaching",
  temporal_filter: "seller_coaching",
  stage_readiness: "seller_coaching",
  general_query: "seller_coaching",
});

function canonicalRuleProcess(channel, process = "default") {
  if (["customer_account", "prospect"].includes(channel)) return "default";
  if (channel !== "coach") return process || "default";
  const normalized = String(process || "default")
    .trim()
    .toLowerCase();
  if (
    ["default", "seller_coaching", "brief_context", "operation"].includes(
      normalized,
    )
  ) {
    return normalized;
  }
  if (normalized === "unknown") return "default";
  return (
    COACH_POLICY_PROCESS_BY_LEGACY_PROCESS[normalized] || "seller_coaching"
  );
}

async function ensureCoachAdminRulesSchema() {
  if (!ensureCoachAdminRulesPromise) {
    ensureCoachAdminRulesPromise = (async () => {
      await query(
        `CREATE TABLE IF NOT EXISTS mi_coach_admin_rules (
          id VARCHAR(80) PRIMARY KEY,
          scope_code VARCHAR(20) NOT NULL,
          channel_code VARCHAR(40) NOT NULL DEFAULT '',
          process_key VARCHAR(80) NOT NULL DEFAULT 'default',
          title VARCHAR(180) NOT NULL,
          instruction TEXT NOT NULL,
          is_enabled TINYINT(1) NOT NULL DEFAULT 1,
          sort_order INT NOT NULL DEFAULT 0,
          created_by_user_id BIGINT UNSIGNED NULL,
          updated_by_user_id BIGINT UNSIGNED NULL,
          created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
          updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
          INDEX idx_mi_coach_admin_rules_scope (scope_code, channel_code, process_key, is_enabled, sort_order)
        )`,
      );
      await query(
        `CREATE TABLE IF NOT EXISTS mi_coach_admin_rule_migrations (
          migration_key VARCHAR(100) PRIMARY KEY,
          applied_at DATETIME(3) NOT NULL DEFAULT NOW(3)
        )`,
      );
      await query(
        `CREATE TABLE IF NOT EXISTS mi_coach_admin_rule_migration_snapshots (
          migration_key VARCHAR(100) PRIMARY KEY,
          snapshot_json JSON NOT NULL,
          applied_at DATETIME(3) NOT NULL DEFAULT NOW(3)
        )`,
      );
      const migrations = await query(
        `SELECT migration_key FROM mi_coach_admin_rule_migrations
         WHERE migration_key = ? LIMIT 1`,
        ["seed_initial_admin_rules_v1"],
      );
      if (!migrations.length) {
        for (const rule of DEFAULT_RULES) {
          await query(
            `INSERT IGNORE INTO mi_coach_admin_rules
              (id, scope_code, channel_code, process_key, title, instruction, is_enabled, sort_order)
             VALUES (?, ?, ?, 'default', ?, ?, 1, ?)`,
            [
              rule.id,
              rule.scope,
              rule.channel || "",
              rule.title,
              rule.instruction,
              rule.sortOrder,
            ],
          );
        }
        await query(
          `INSERT IGNORE INTO mi_coach_admin_rule_migrations (migration_key)
           VALUES (?)`,
          ["seed_initial_admin_rules_v1"],
        );
      }
      const additionalMigration = await query(
        `SELECT migration_key FROM mi_coach_admin_rule_migrations
         WHERE migration_key = ? LIMIT 1`,
        ["seed_additional_admin_rules_v2"],
      );
      if (!additionalMigration.length) {
        for (const rule of ADDITIONAL_RULES) {
          await query(
            `INSERT IGNORE INTO mi_coach_admin_rules
              (id, scope_code, channel_code, process_key, title, instruction, is_enabled, sort_order)
             VALUES (?, ?, ?, 'default', ?, ?, 1, ?)`,
            [
              rule.id,
              rule.scope,
              rule.channel || "",
              rule.title,
              rule.instruction,
              rule.sortOrder,
            ],
          );
        }
        await query(
          `INSERT IGNORE INTO mi_coach_admin_rule_migrations (migration_key)
           VALUES (?)`,
          ["seed_additional_admin_rules_v2"],
        );
      }
      const operationAlignmentMigration = await query(
        `SELECT migration_key FROM mi_coach_admin_rule_migrations
         WHERE migration_key = ? LIMIT 1`,
        ["align_customer_operations_admin_rules_v3"],
      );
      if (!operationAlignmentMigration.length) {
        for (const rule of ADMIN_RULE_ALIGNMENT_MIGRATION) {
          await query(
            `UPDATE mi_coach_admin_rules
             SET title = ?, instruction = ?, updated_at = NOW(3)
             WHERE id = ? AND title = ? AND instruction = ?`,
            [
              rule.title,
              rule.instruction,
              rule.id,
              rule.oldTitle,
              rule.oldInstruction,
            ],
          );
        }
        await query(
          `INSERT IGNORE INTO mi_coach_admin_rule_migrations (migration_key)
           VALUES (?)`,
          ["align_customer_operations_admin_rules_v3"],
        );
      }
      await withTransaction(async (connection) => {
        const [coachMigrations] = await connection.query(
          `SELECT migration_key FROM mi_coach_admin_rule_migrations
           WHERE migration_key = ? LIMIT 1`,
          [COACH_INTERACTION_RULE_MIGRATION],
        );
        if (!coachMigrations.length) {
          const [coachRules] = await connection.query(
            `SELECT id, scope_code, channel_code, process_key, title, instruction,
                    is_enabled, sort_order, created_by_user_id, updated_by_user_id,
                    created_at, updated_at
             FROM mi_coach_admin_rules
             WHERE scope_code = 'channel' AND channel_code = ?`,
            ["coach"],
          );
          await connection.query(
            `INSERT IGNORE INTO mi_coach_admin_rule_migration_snapshots
               (migration_key, snapshot_json)
             VALUES (?, ?)`,
            [COACH_INTERACTION_RULE_MIGRATION, JSON.stringify(coachRules)],
          );
          for (const rule of coachRules) {
            const process = canonicalRuleProcess("coach", rule.process_key);
            if (process === rule.process_key) continue;
            await connection.query(
              `UPDATE mi_coach_admin_rules
               SET process_key = ?, updated_at = NOW(3) WHERE id = ?`,
              [process, rule.id],
            );
          }
          await connection.query(
            `INSERT IGNORE INTO mi_coach_admin_rule_migrations (migration_key)
             VALUES (?)`,
            [COACH_INTERACTION_RULE_MIGRATION],
          );
        }

        for (const [channel, migrationKey] of [
          ["customer_account", CUSTOMER_ACCOUNT_RULE_MIGRATION],
          ["prospect", PROSPECT_RULE_MIGRATION],
        ]) {
          const [migrations] = await connection.query(
            `SELECT migration_key FROM mi_coach_admin_rule_migrations
             WHERE migration_key = ? LIMIT 1`,
            [migrationKey],
          );
          if (migrations.length) continue;
          await connection.query(
            `UPDATE mi_coach_admin_rules
             SET process_key = 'default', updated_at = NOW(3)
             WHERE scope_code = 'channel' AND channel_code = ?
               AND process_key <> 'default'`,
            [channel],
          );
          await connection.query(
            `INSERT IGNORE INTO mi_coach_admin_rule_migrations (migration_key)
             VALUES (?)`,
            [migrationKey],
          );
        }
      });
    })().catch((error) => {
      ensureCoachAdminRulesPromise = undefined;
      throw error;
    });
  }
  await ensureCoachAdminRulesPromise;
}

function mapRule(row) {
  return {
    id: String(row.id),
    scope: row.scope_code,
    channel: row.channel_code || null,
    process: row.process_key || "default",
    title: row.title || "",
    instruction: row.instruction || "",
    enabled: Boolean(Number(row.is_enabled)),
    sortOrder: Number(row.sort_order || 0),
  };
}

export async function listCoachAdminRules({
  channel,
  process = "default",
} = {}) {
  process = canonicalRuleProcess(channel, process);
  await ensureCoachAdminRulesSchema();
  const rows =
    channel === "all"
      ? await query(
          `SELECT id, scope_code, channel_code, process_key, title, instruction,
                  is_enabled, sort_order
           FROM mi_coach_admin_rules
           ORDER BY CASE WHEN scope_code = 'common' THEN 0 ELSE 1 END,
                    channel_code, process_key, sort_order, title, id`,
        )
      : await query(
          `SELECT id, scope_code, channel_code, process_key, title, instruction,
                  is_enabled, sort_order
           FROM mi_coach_admin_rules
           WHERE scope_code = 'common'
              OR (scope_code = 'channel' AND channel_code = ?
                  AND process_key IN ('default', ?))
           ORDER BY CASE WHEN scope_code = 'common' THEN 0 ELSE 1 END,
                    sort_order, title, id`,
          [channel, process],
        );
  return rows.map(mapRule);
}

export async function createCoachAdminRule({ user, rule }) {
  await ensureCoachAdminRulesSchema();
  const id = randomUUID();
  const process =
    rule.scope === "common"
      ? "default"
      : canonicalRuleProcess(rule.channel, rule.process);
  await query(
    `INSERT INTO mi_coach_admin_rules
      (id, scope_code, channel_code, process_key, title, instruction, is_enabled,
       sort_order, created_by_user_id, updated_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      rule.scope,
      rule.scope === "common" ? "" : rule.channel,
      process,
      rule.title,
      rule.instruction,
      rule.enabled ? 1 : 0,
      rule.sortOrder,
      Number(user?.id) || null,
      Number(user?.id) || null,
    ],
  );
  const rows = await query(
    `SELECT id, scope_code, channel_code, process_key, title, instruction,
            is_enabled, sort_order
     FROM mi_coach_admin_rules WHERE id = ? LIMIT 1`,
    [id],
  );
  return mapRule(rows[0]);
}

export async function getCoachAdminRule(id) {
  await ensureCoachAdminRulesSchema();
  const rows = await query(
    `SELECT id, scope_code, channel_code, process_key, title, instruction,
            is_enabled, sort_order
     FROM mi_coach_admin_rules WHERE id = ? LIMIT 1`,
    [id],
  );
  return rows[0] ? mapRule(rows[0]) : null;
}

export async function updateCoachAdminRule({ user, id, rule }) {
  await ensureCoachAdminRulesSchema();
  const existing = await getCoachAdminRule(id);
  if (!existing) return null;
  await query(
    `UPDATE mi_coach_admin_rules
     SET title = ?, instruction = ?, is_enabled = ?, sort_order = ?,
         updated_by_user_id = ?, updated_at = NOW(3)
     WHERE id = ?`,
    [
      rule.title,
      rule.instruction,
      rule.enabled ? 1 : 0,
      rule.sortOrder,
      Number(user?.id) || null,
      id,
    ],
  );
  const rows = await query(
    `SELECT id, scope_code, channel_code, process_key, title, instruction,
            is_enabled, sort_order
     FROM mi_coach_admin_rules WHERE id = ? LIMIT 1`,
    [id],
  );
  return rows[0] ? mapRule(rows[0]) : null;
}

export async function deleteCoachAdminRule(id) {
  await ensureCoachAdminRulesSchema();
  const rows = await query(
    `SELECT id, scope_code, channel_code, process_key, title, instruction,
            is_enabled, sort_order
     FROM mi_coach_admin_rules WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!rows[0]) return null;
  await query(`DELETE FROM mi_coach_admin_rules WHERE id = ?`, [id]);
  return mapRule(rows[0]);
}
