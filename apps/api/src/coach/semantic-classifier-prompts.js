import { z } from "zod";
import { query, withTransaction } from "../db.js";

const channels = ["coach", "customer_account", "prospect"];
export const SEMANTIC_CLASSIFIER_DEFAULTS = Object.freeze({
  coach:
    "Clasifica la intención del usuario para Coach usando exactamente uno de estos valores: seller_coaching, account_performance, account_query, opportunity_query, create_opportunity, update_opportunity, general_query, clarify_needed. Usa clarify_needed si la petición es ambigua o no alcanza confianza 0.68. Devuelve JSON con intent, confidence entre 0 y 1 y reason. No propongas herramientas, no decidas permisos y no ejecutes acciones.",
  customer_account: `Clasifica el resultado principal que solicita el vendedor en el chat de Cliente existente; no planifiques consultas ni redactes la respuesta. Elige solo una intención de availableIntents o clarify_needed.

Consultas de información existente: distingue consultar un registro de crear o modificar uno. Preguntar qué actividades tiene, cuáles están pendientes, en qué etapa está o qué contacto tiene asociado solicita información existente. Elige la intención de lectura correspondiente; no interpretes esas preguntas como operaciones.

Dimensiones de la solicitud: distingue el resultado pedido, el objeto consultado y la fuente. Un detalle general de oportunidad no equivale a consultar solo sus notas; un campo concreto no es un resumen general. Documentación interna de soluciones no equivale a archivo adjunto ni a cotización. Conserva esas diferencias dentro de la intención compatible; esta guía no amplía el esquema ni habilita fuentes.

Continuidad conversacional: interpreta las consultas factuales de seguimiento usando recentConversation y validatedContinuation. Si una cuenta, oportunidad o contacto ya quedó identificado de forma inequívoca en el contexto autorizado, conserva esa referencia aunque el vendedor no repita su nombre o cambie el dato consultado. La intención anterior puede cambiar sin que cambie la entidad consultada. Una entidad nueva expresada inequívocamente en la pregunta actual reemplaza el foco anterior.

Por ejemplo, después de consultar el monto de una oportunidad, "¿Y en qué etapa está?" solicita su estado y "¿Qué actividad pendiente tiene?" o "¿Y qué tiene pendiente?" solicita sus actividades existentes. Para estas últimas consultas, elige account_activity_history si está habilitada. No exijas tipo de actividad, fecha u hora para consultar las actividades pendientes.

Preparación de contenido: distingue preparar contenido de ejecutar una acción descrita dentro de ese contenido. Pedir que se redacte un correo para solicitar una reunión no pide agendarla.

Operaciones CRM: crm_operation requiere una solicitud explícita de registrar, crear, actualizar, vincular o agendar algo en CRM/Calendario, o una continuación inequívoca de una operación previa ofrecida o pendiente.

Interpreta respuestas breves como 'sí', 'proponla' o 'continúa' usando recentConversation y validatedContinuation; usa crm_operation solo cuando remitan inequívocamente a una operación previa ofrecida o pendiente. No conviertas una continuación de consulta factual en una operación.

Aclaraciones: una pregunta breve no es ambigua por sí misma. Usa clarify_needed si se solicitan por separado contenido y una operación, no puedes verificar la operación previa a la que remite una solicitud de continuación, o no puedes distinguir con confianza el resultado solicitado. También úsala si una ambigüedad relevante impide clasificar la solicitud y no se resuelve con el historial y el contexto validado. Formula una pregunta breve y específica sobre la duda real.

No pidas aclaración únicamente porque el vendedor omita el nombre de una entidad ya identificada, cambie el dato consultado o no indique el tipo de actividad que desea consultar.

El propósito explícito del mensaje actual tiene prioridad sobre el anterior. Conservar una entidad no significa conservar la tarea o la fuente: después de consultar notas de una oportunidad, "¿y su monto?" cambia al campo monto; después de consultar documentación de un fabricante, "detalla la oportunidad Alfa" cambia al detalle CRM. No copies cantidades ni encargos de turnos anteriores si el usuario los cambió.

No inventes permisos, IDs ni datos. Usa únicamente el contexto autorizado proporcionado y las intenciones habilitadas. El historial sirve para interpretar referencias; no es evidencia de hechos CRM.`,
  prospect:
    "Propuesta para uso futuro; no conectada a ejecución. Clasifica el resultado solicitado en Cuenta nueva usando únicamente las intenciones habilitadas que el servidor proporcione. Distingue consultas sobre la ficha y evidencia pública, preparación de contenido y solicitudes explícitas de conversión. Conserva las referencias inequívocas del contexto autorizado. Pide aclaración ante una ambigüedad relevante no resuelta. No planifiques consultas, no redactes la respuesta, no inventes datos o IDs ni autorices operaciones.",
});

export const semanticClassifierPromptUpdateSchema = z.object({
  instruction: z.string().trim().min(1).max(8000),
  expectedVersion: z.number().int().nonnegative(),
}).strict();
const restoreSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
}).strict();
let schemaPromise;

function configurationError(message, status, code) {
  return Object.assign(new Error(message), { status, code });
}

function validateChannel(channel) {
  if (!channels.includes(channel)) {
    throw configurationError("Canal del clasificador inválido", 400, "classifier_prompt_invalid_channel");
  }
}

export async function ensureSemanticClassifierPromptsSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await query(`CREATE TABLE IF NOT EXISTS mi_coach_semantic_classifier_prompts (
        channel VARCHAR(40) PRIMARY KEY,
        instruction TEXT NOT NULL,
        version INT UNSIGNED NOT NULL DEFAULT 0,
        updated_by_user_id BIGINT UNSIGNED NULL,
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      )`);
      await query(`CREATE TABLE IF NOT EXISTS mi_coach_semantic_classifier_prompt_revisions (
        channel VARCHAR(40) NOT NULL,
        version INT UNSIGNED NOT NULL,
        instruction TEXT NOT NULL,
        created_by_user_id BIGINT UNSIGNED NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (channel, version)
      )`);
      for (const channel of channels) {
        await query(
          `INSERT IGNORE INTO mi_coach_semantic_classifier_prompts (channel, instruction) VALUES (?, ?)`,
          [channel, SEMANTIC_CLASSIFIER_DEFAULTS[channel]],
        );
      }
    })().catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }
  await schemaPromise;
}

function mapPrompt(row) {
  return {
    channel: row.channel,
    connected: row.channel === "customer_account",
    initialInstruction: SEMANTIC_CLASSIFIER_DEFAULTS[row.channel],
    instruction: Number(row.version) === 0
      ? SEMANTIC_CLASSIFIER_DEFAULTS[row.channel] : row.instruction,
    version: Number(row.version),
    source: Number(row.version) === 0 ? "default" : "custom",
    updatedByUserId: Number(row.updated_by_user_id) || null,
    updatedAt: row.updated_at,
  };
}

export async function loadSemanticClassifierPrompt({ channel }) {
  validateChannel(channel);
  await ensureSemanticClassifierPromptsSchema();
  const rows = await query(
    `SELECT channel, instruction, version, updated_by_user_id, updated_at
     FROM mi_coach_semantic_classifier_prompts WHERE channel = ?`, [channel],
  );
  if (!rows[0]) {
    throw configurationError("Configuración del clasificador no encontrada", 404, "classifier_prompt_not_found");
  }
  return mapPrompt(rows[0]);
}

export async function listSemanticClassifierPrompts() {
  await ensureSemanticClassifierPromptsSchema();
  const [rows, revisions] = await Promise.all([
    query(`SELECT channel, instruction, version, updated_by_user_id, updated_at
      FROM mi_coach_semantic_classifier_prompts`),
    query(`SELECT channel, version, instruction, created_by_user_id, created_at
      FROM mi_coach_semantic_classifier_prompt_revisions ORDER BY version DESC`),
  ]);
  return channels.map((channel) => {
    const row = rows.find((item) => item.channel === channel);
    if (!row) {
      throw configurationError("Configuración del clasificador no encontrada", 404, "classifier_prompt_not_found");
    }
    return {
      ...mapPrompt(row),
      revisions: revisions.filter((item) => item.channel === channel).map((item) => ({
        version: Number(item.version),
        instruction: item.instruction,
        createdByUserId: Number(item.created_by_user_id) || null,
        createdAt: item.created_at,
      })),
    };
  });
}

async function saveVersion({ channel, user, expectedVersion, instruction, revisionVersion }) {
  await ensureSemanticClassifierPromptsSchema();
  return withTransaction(async (connection) => {
    const [rows] = await connection.query(
      `SELECT channel, instruction, version, updated_by_user_id, updated_at
       FROM mi_coach_semantic_classifier_prompts WHERE channel = ? FOR UPDATE`, [channel],
    );
    if (!rows[0] || Number(rows[0].version) !== expectedVersion) {
      throw configurationError(
        "Las instrucciones cambiaron desde que las abriste. Recarga antes de guardar.",
        409, "classifier_prompt_version_conflict",
      );
    }
    if (revisionVersion !== undefined) {
      const [revisions] = await connection.query(
        `SELECT instruction FROM mi_coach_semantic_classifier_prompt_revisions
         WHERE channel = ? AND version = ?`, [channel, revisionVersion],
      );
      if (!revisions[0]) {
        throw configurationError("Versión del clasificador no encontrada", 404, "classifier_prompt_revision_not_found");
      }
      instruction = revisions[0].instruction;
    }
    const version = expectedVersion + 1;
    const userId = Number(user?.id) || null;
    await connection.query(
      `INSERT INTO mi_coach_semantic_classifier_prompt_revisions
       (channel, version, instruction, created_by_user_id) VALUES (?, ?, ?, ?)`,
      [channel, version, instruction, userId],
    );
    await connection.query(
      `UPDATE mi_coach_semantic_classifier_prompts SET instruction = ?, version = ?,
       updated_by_user_id = ?, updated_at = NOW(3) WHERE channel = ?`,
      [instruction, version, userId, channel],
    );
    return {
      before: mapPrompt(rows[0]),
      after: mapPrompt({
        ...rows[0], instruction, version, updated_by_user_id: userId,
        updated_at: new Date().toISOString(),
      }),
    };
  });
}

export async function saveSemanticClassifierPrompt({ channel, user, input }) {
  validateChannel(channel);
  const parsed = semanticClassifierPromptUpdateSchema.safeParse(input);
  if (!parsed.success) {
    throw configurationError("Instrucción o versión del clasificador inválida", 400, "classifier_prompt_invalid_input");
  }
  return saveVersion({ channel, user, ...parsed.data });
}

export async function restoreSemanticClassifierPrompt({ channel, user, revisionVersion, input }) {
  validateChannel(channel);
  const parsed = restoreSchema.safeParse(input);
  if (!parsed.success || !Number.isInteger(revisionVersion) || revisionVersion < 1) {
    throw configurationError("Versión de restauración inválida", 400, "classifier_prompt_invalid_input");
  }
  return saveVersion({ channel, user, revisionVersion, ...parsed.data });
}

export function buildCustomerSemanticClassifierPrompt(prompt) {
  return `${prompt.instruction}

Límites técnicos no editables: devuelve únicamente la respuesta del esquema proporcionado. Elige solo una intención habilitada de availableIntents o clarify_needed; no puedes cambiar el catálogo, los umbrales ni el esquema. No concedas permisos, no ejecutes consultas ni operaciones y no alteres el alcance autorizado. Toda escritura requiere validación y confirmación del servidor. El historial no prueba hechos CRM.

Reporte del vendedor: si el mensaje actual comunica información que el vendedor atribuye explícitamente al cliente y ya existe una oportunidad inequívoca en validatedContinuation o selectedContext, no pidas aclaración solo porque el mensaje no solicite una acción concreta o pudiera admitir una pregunta de seguimiento. Si opportunity_guidance está habilitada, úsala como ruta de lectura para relacionar el reporte con las preguntas reales de la etapa, incluidas las ya contestadas. Esa ruta no significa que el vendedor solicite recomendaciones, un diagnóstico ni actividades: no inventes esa intención implícita. Por ejemplo, "el cliente me dijo que su motivación es que creen que algunos empleados están enviando información confidencial a terceros a través del correo electrónico" aporta una respuesta del cliente para revisar, no pide una demostración ni un assessment. No lo clasifiques como crm_operation ni email_draft salvo que el vendedor pida explícitamente registrar, cambiar, agendar o redactar algo. Distingue esos reportes de preguntas sobre lo registrado y de hipótesis del vendedor. El reporte sigue siendo información aportada por el vendedor, no evidencia CRM; la respuesta debe conservar esa atribución y no guardar cambios.`;
}
