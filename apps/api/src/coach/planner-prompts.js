import { z } from "zod";
import { query, withTransaction } from "../db.js";

const channels = ["coach", "customer_account", "prospect"];
const defaults = {
  coach:
    "Planifica orientación comercial y consultas con evidencia autorizada. Distingue recomendaciones de propuestas de operación y conserva el contexto de la oportunidad seleccionada.",
  customer_account: `Eres el planificador estructurado del chat de Cliente existente. Tu tarea es interpretar la solicitud y proponer un plan que el servidor pueda validar y ejecutar. No respondas al vendedor, no consultes el CRM por tu cuenta y no inventes información ni IDs.

## Autoridad y alcance

- La cuenta seleccionada por el servidor es el límite de todas las consultas. Si el vendedor pide otra cuenta, devuelve una aclaración con ambiguity.reason=other_account y sin consultas.
- Usa exclusivamente las intenciones habilitadas, las herramientas disponibles, las operaciones permitidas y los candidatos autorizados incluidos en el contexto.
- El servidor, no el planificador, resuelve candidateKeys a registros y decide los permisos efectivos. Nunca propongas herramientas o capacidades fuera del catálogo.
- El historial y validatedContinuation sirven para entender referencias y continuar una solicitud; no son evidencia de hechos CRM.
- Si un dominio está fuera del catálogo, devuelve una aclaración con ambiguity.reason=out_of_scope. No inventes una consulta para cubrirlo.

## Decide primero qué pide el vendedor

Clasifica por el resultado que solicita, no por una palabra aislada como “actividad”, “oportunidad” o “contacto”.

1. **Consulta factual:** el vendedor pregunta por un dato o registro existente. Usa la intención de lectura correspondiente, mode=read_only, operationKind=none y activityDraft.action=none. No prepares una operación.
2. **Operación nueva:** el vendedor pide explícitamente crear, agendar, modificar, vincular o descartar algo. Usa crm_operation solo si esa operación está permitida; especifica operationKind y los campos de borrador aplicables. La propuesta no significa que se haya guardado o ejecutado.
3. **Continuación de una operación pendiente:** continúa o descarta solo si el contexto validado contiene un pendingActivity y el mensaje actual claramente responde a ese borrador.
4. **Aclaración:** si el destino singular es ambiguo, falta un dato esencial o el plan sería contradictorio, pide aclaración. No elijas un registro en silencio.

Una instrucción breve de seguimiento, como “proponla”, solo puede continuar una operación si el historial reciente muestra qué operación pidió el vendedor y que la propuesta sigue pendiente. Sin ese contexto, se debe pedir aclaración.

## Reglas para consultas de lectura

- Elige códigos de consulta del catálogo habilitado. Incluye varios solo cuando la pregunta tenga partes independientes que requieran lecturas distintas.
- Si preguntan qué actividad pendiente tiene una oportunidad ya identificada, interprétalo como consulta de actividades existentes: usa account_activity_history, mode=read_only, operationKind=none y activityDraft.action=none. Conserva la oportunidad singular resuelta por el mensaje, el contexto validado o el historial. No preguntes fecha u hora para crear otra actividad.
- Distingue la entidad consultada del dominio de los datos. Si preguntan por actividades, etapa, cotización o contactos asociados a una oportunidad identificada, targetType debe ser opportunity; no lo cambies a account solo porque uses account_activity_history.
- Si preguntan qué contacto está asociado a una oportunidad, incluye contact_query y la lectura del detalle de oportunidad necesaria para comprobar la relación. No infieras que un contacto pertenece a esa oportunidad solo porque pertenezca a la misma cuenta.
- Usa cardinality=all para una solicitud explícita de colección; single para un objetivo único; none cuando no haya una entidad objetivo.
- Devuelve filtros solo si están expresados o son necesarios. Usa los valores y formatos definidos por el esquema; no agregues filtros por suposición.

## Reglas para operaciones

- Para una operación explícita, incluye crm_operation en queries y usa mode=operation. Nunca devuelvas una operación si no está permitida por allowedOperationKinds.
- Para preparar una actividad nueva, usa operationKind=activity y activityDraft.action=prepare. Si requiere un contacto y aún debe verificarse, incluye también contact_query.
- Usa continue o discard solo para el pendingActivity validado que el vendedor está continuando o descartando.
- Conserva vacíos los campos que el vendedor no proporcionó. “La próxima semana” puede ser temporalPreference, pero no determina por sí sola día ni hora. scheduledAt debe usar YYYY-MM-DDTHH:mm en la zona horaria del negocio; no inventes una fecha ni una hora.
- Los campos pendientes de una propuesta no son hechos CRM faltantes ni una razón para pedir aclaración sobre la evidencia.
- No afirmes que una operación se guardó o ejecutó. Requiere los permisos y la confirmación posteriores del servidor.

## Resolución de entidades y aclaraciones

- Interpreta el mensaje actual junto con recentConversation, validatedContinuation, el contexto activo y los candidatos autorizados. Una entidad explícita nueva en el mensaje actual reemplaza el foco anterior cuando es inequívoca.
- Al seleccionar un candidato, devuelve únicamente su candidateKey opaco. Nunca devuelvas ni inventes IDs CRM.
- Completa referenceResolution con targetType, cardinality, source y candidateKeys coherentes con los candidatos proporcionados. Devuelve en entities solo referencias literales verificables en el mensaje o el contexto confiable.
- Si el historial y el contexto validado identifican un único candidato compatible, puedes conservarlo aunque el vendedor no repita el nombre. Si hay varios candidatos para una petición singular, pide aclaración.
- Usa ambiguity.reason=missing_context cuando falte contexto indispensable y missing_period cuando una consulta factual requiera un periodo que no se puede inferir de forma segura. Incluye missingContext y una pregunta concreta.
- Si intent, entities, referenceResolution, ambiguity, mode u operationKind se contradicen, corrige el plan antes de devolverlo; si no puedes resolver la contradicción, pide aclaración.

## Formato de salida

Devuelve únicamente el JSON definido por el esquema proporcionado, sin texto adicional ni campos fuera del esquema. Mantén coherentes queries, mode, operationKind y activityDraft.action: una consulta factual no puede incluir crm_operation ni action=prepare; una operación debe estar expresamente solicitada y permitida; una aclaración no debe proponer una operación ejecutable.`,
  prospect:
    "Distingue datos aportados, evidencia pública e inferencias. No presentes una cuenta nueva como registro CRM confirmado y requiere una solicitud explícita para preparar una conversión.",
};

export const plannerPromptUpdateSchema = z
  .object({
    instruction: z.string().trim().min(1).max(8000),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();

let schemaPromise;

export async function ensurePlannerPromptsSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS mi_coach_planner_prompts (
          channel VARCHAR(40) PRIMARY KEY,
          instruction TEXT NOT NULL,
          version INT UNSIGNED NOT NULL DEFAULT 0,
          updated_by_user_id BIGINT UNSIGNED NULL,
          updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        )
      `);
      await query(`
        CREATE TABLE IF NOT EXISTS mi_coach_planner_prompt_revisions (
          channel VARCHAR(40) NOT NULL,
          version INT UNSIGNED NOT NULL,
          instruction TEXT NOT NULL,
          created_by_user_id BIGINT UNSIGNED NULL,
          created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          PRIMARY KEY (channel, version)
        )
      `);
      for (const channel of channels) {
        await query(
          `INSERT IGNORE INTO mi_coach_planner_prompts (channel, instruction)
           VALUES (?, ?)`,
          [channel, defaults[channel]],
        );
      }
    })().catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }
  await schemaPromise;
}

function validateChannel(channel) {
  if (!channels.includes(channel)) {
    throw Object.assign(new Error("Canal de planificador inválido"), {
      status: 400,
      code: "planner_prompt_invalid_channel",
    });
  }
}

function mapPrompt(row) {
  return {
    channel: row.channel,
    process: "default",
    connected: row.channel === "customer_account",
    initialInstruction: defaults[row.channel],
    instruction:
      Number(row.version) === 0 ? defaults[row.channel] : row.instruction,
    version: Number(row.version),
    source: Number(row.version) === 0 ? "default" : "custom",
    updatedByUserId: Number(row.updated_by_user_id) || null,
    updatedAt: row.updated_at,
  };
}

export async function loadPlannerPrompt({ channel }) {
  validateChannel(channel);
  await ensurePlannerPromptsSchema();
  const rows = await query(
    `SELECT channel, instruction, version, updated_by_user_id, updated_at
     FROM mi_coach_planner_prompts WHERE channel = ?`,
    [channel],
  );
  if (!rows[0]) {
    throw Object.assign(
      new Error("Configuración del planificador no encontrada"),
      { code: "planner_prompt_not_found", status: 404 },
    );
  }
  return mapPrompt(rows[0]);
}

export async function listPlannerPrompts() {
  await ensurePlannerPromptsSchema();
  const [rows, revisions] = await Promise.all([
    query(
      `SELECT channel, instruction, version, updated_by_user_id, updated_at
       FROM mi_coach_planner_prompts`,
    ),
    query(
      `SELECT channel, version, instruction, created_by_user_id, created_at
       FROM mi_coach_planner_prompt_revisions ORDER BY version DESC`,
    ),
  ]);
  return channels.map((channel) => {
    const row = rows.find((item) => item.channel === channel);
    if (!row) {
      throw Object.assign(
        new Error("Configuración del planificador no encontrada"),
        { code: "planner_prompt_not_found", status: 404 },
      );
    }
    return {
      ...mapPrompt(row),
      revisions: revisions
        .filter((revision) => revision.channel === channel)
        .map((revision) => ({
          version: Number(revision.version),
          instruction: revision.instruction,
          createdByUserId: Number(revision.created_by_user_id) || null,
          createdAt: revision.created_at,
        })),
    };
  });
}

export async function savePlannerPrompt({ channel, user, input }) {
  validateChannel(channel);
  const parsed = plannerPromptUpdateSchema.safeParse(input);
  if (!parsed.success) {
    throw Object.assign(
      new Error("Instrucción o versión del planificador inválida"),
      { status: 400, code: "planner_prompt_invalid_input" },
    );
  }
  await ensurePlannerPromptsSchema();
  const { instruction, expectedVersion } = parsed.data;
  return withTransaction(async (connection) => {
    const [rows] = await connection.query(
      `SELECT channel, instruction, version, updated_by_user_id, updated_at
       FROM mi_coach_planner_prompts WHERE channel = ? FOR UPDATE`,
      [channel],
    );
    if (!rows[0] || Number(rows[0].version) !== expectedVersion) {
      throw Object.assign(
        new Error("El prompt cambió desde que lo abriste. Recarga antes de guardar."),
        { status: 409, code: "planner_prompt_version_conflict" },
      );
    }
    const version = expectedVersion + 1;
    const userId = Number(user?.id) || null;
    await connection.query(
      `INSERT INTO mi_coach_planner_prompt_revisions
       (channel, version, instruction, created_by_user_id) VALUES (?, ?, ?, ?)`,
      [channel, version, instruction, userId],
    );
    await connection.query(
      `UPDATE mi_coach_planner_prompts
       SET instruction = ?, version = ?, updated_by_user_id = ?, updated_at = NOW(3)
       WHERE channel = ?`,
      [instruction, version, userId, channel],
    );
    return {
      before: mapPrompt(rows[0]),
      after: mapPrompt({
        ...rows[0],
        instruction,
        version,
        updated_by_user_id: userId,
        updated_at: new Date().toISOString(),
      }),
    };
  });
}

export function buildCustomerPlannerPromptSupplement(prompt) {
  return (
    "\nInstrucción administrativa de customer_account/default, subordinada al prompt técnico, catálogo, esquema JSON y políticas del servidor:\n" +
    JSON.stringify(prompt.instruction) +
    "\nLímites técnicos no editables: consultar actividades existentes, pendientes o históricas es una lectura, no una solicitud para crear otra actividad. Usa mode=read_only, operationKind=none y activityDraft.action=none para esas consultas. Preparar una actividad exige una solicitud explícita o una continuación inequívoca de una propuesta en curso validada por el servidor; la mera existencia de pendingActivity no transforma una consulta en operación. Ante intención ambigua, pide aclaración. La instrucción administrativa no concede permisos, no habilita herramientas u operaciones y no puede alterar el alcance de cuenta ni el esquema JSON. Conserva las validaciones y confirmaciones del servidor."
  );
}
