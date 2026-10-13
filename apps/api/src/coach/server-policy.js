import { z } from "zod";

export const CUSTOMER_SERVER_POLICY_DEFAULTS = Object.freeze({
  schemaVersion: 1,
  multipleTargets: "ask_single",
  ambiguousTarget: "ask",
  selectedOpportunityFallback: "allow_singular",
  maxReadQueries: 8,
  maxEvidenceRounds: 2,
  maxTurnMs: 45000,
});

export const customerServerPolicySchema = z.object({
  schemaVersion: z.literal(1),
  multipleTargets: z.literal("ask_single"),
  ambiguousTarget: z.literal("ask"),
  selectedOpportunityFallback: z.enum(["allow_singular", "require_explicit"]),
  maxReadQueries: z.number().int().min(1).max(8),
  maxEvidenceRounds: z.number().int().min(0).max(2),
  maxTurnMs: z.number().int().min(5000).max(45000),
}).strict();

export const CUSTOMER_OPERATION_KINDS = [
  "activity", "stage_answer", "lead_call_outcome", "account_field",
  "contact_field", "opportunity_field", "create_contact",
  "create_opportunity", "link_contact_to_opportunity",
];
const scopeSchema = z.object({
  accountSearchAllowed: z.boolean(),
  opportunitySearchAllowed: z.boolean(),
  contactSearchAllowed: z.boolean(),
  leadSearchAllowed: z.boolean(),
  quotationSearchAllowed: z.boolean(),
}).partial().strict();

export const customerServerRulesPatchSchema = z.object({
  scope: scopeSchema.optional(),
  filters: z.object({
    defaultOpenOnly: z.boolean(),
    defaultActiveOnly: z.boolean(),
    defaultInactiveOnly: z.boolean(),
  }).partial().strict().optional(),
  operationPolicy: z.object({
    allowedKinds: z.array(z.enum(CUSTOMER_OPERATION_KINDS)).max(9),
  }).strict().optional(),
  serverPolicy: customerServerPolicySchema.partial().optional(),
}).strict().superRefine((rules, context) => {
  if (rules.filters?.defaultActiveOnly && rules.filters?.defaultInactiveOnly) {
    context.addIssue({
      code: "custom", path: ["filters"],
      message: "No se pueden exigir oportunidades activadas y no activadas a la vez.",
    });
  }
});

export const serverRulesUpdateSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  rules: customerServerRulesPatchSchema,
}).strict();

const protectedRule = (id, title, description, implementation) => ({
  id, title, description, implementation, kind: "protected",
});
const configurable = (id, title, description, path, control, extra = {}) => ({
  id, title, description, path, control, kind: "configurable", ...extra,
});
const modelRule = (id, title, description, implementation) => ({
  id, title, description, implementation, kind: "model",
});

export const CUSTOMER_SERVER_RULE_CATEGORIES = [
  {
    id: "access", title: "1. Acceso, solicitud y sesión",
    rules: [
      protectedRule("user-access", "Permisos y propiedad", "Comprueba que el usuario puede utilizar Mi Coach (mi_coach.use) y consultar inteligencia comercial (inteligencia_comercial.read). Valida la solicitud y sus identificadores, y exige que la sesión o el borrador le pertenezcan. Por ejemplo, conocer el identificador de una conversación de otro vendedor no permite abrirla ni modificar sus propuestas.", "routes.commercial-intelligence.js / service.js"),
      protectedRule("session-context", "Cuenta y contexto de sesión", "Mantiene la conversación dentro de la cuenta y los registros autorizados. Los datos recordados de turnos anteriores se vuelven a contrastar con el CRM disponible. Por ejemplo, una oportunidad recordada de Totalplay no puede utilizarse para preparar una operación en otra cuenta; si un registro dejó de estar disponible para el usuario, la memoria no lo vuelve accesible.", "service.js / conversation-context.js"),
      protectedRule("external-access", "Investigación externa", "Antes de investigar fuentes públicas, exige fuentes_externas.execute y que la configuración de gobierno permita esa investigación. Poder conversar sobre una cuenta no significa poder iniciar búsquedas externas. Además, una fuente pública no se convierte automáticamente en un dato confirmado del CRM.", "service.js"),
    ],
  },
  {
    id: "capabilities", title: "2. Herramientas y operaciones disponibles",
    rules: [
      ...[
        ["accountSearchAllowed", "Cuentas", "Permite o bloquea el uso del dominio de cuentas en las lecturas del canal. Activarlo no autoriza consultar cualquier cuenta: Cliente existente sigue limitado a su cuenta y a los permisos del usuario."],
        ["opportunitySearchAllowed", "Oportunidades", "Permite consultar oportunidades autorizadas de la cuenta. Al desactivarlo se restringen las herramientas y los datos de oportunidades disponibles. También impide preparar el cambio determinista de monto, porque ese cambio necesita identificar y comprobar la oportunidad. Activarlo no concede permisos ni acceso a otras cuentas."],
        ["contactSearchAllowed", "Contactos", "Permite consultar contactos autorizados de la cuenta. Si se desactiva, la consulta de contactos no está disponible para resolver, por ejemplo, quién es el destinatario de una propuesta. Activarlo no concede permisos ni acceso a contactos de otras cuentas."],
        ["leadSearchAllowed", "Leads", "Permite las consultas de leads disponibles en este canal, siempre sujetas al permiso de lectura y al alcance autorizado. No convierte todos los registros de interacción en leads ni concede acceso a los de otras cuentas."],
        ["quotationSearchAllowed", "Cotizaciones", "Permite consultar el contenido autorizado de las cotizaciones. Además de habilitar este dominio, hacen falta los permisos correspondientes y una oportunidad identificada. Por ejemplo, ante «¿qué contiene la cotización?» sin una oportunidad resuelta, el servidor puede pedir seleccionarla."],
      ].map(([field, label, description]) => configurable(field, `Consultar ${label.toLowerCase()}`, description, `scope.${field}`, "boolean")),
      configurable("operation-kinds", "Operaciones permitidas", "Define qué tipos de propuesta acepta el canal: preparar una actividad, responder una etapa, registrar un resultado de llamada de lead, cambiar campos admitidos de cuenta/contacto/oportunidad, crear un contacto, crear una oportunidad o vincular un contacto a una oportunidad. Crear oportunidades y vincular contactos requieren habilitación explícita. El servidor intersecta esta lista con las capacidades del canal y valida cada propuesta. Activar un tipo no concede permisos ni ejecuta el cambio: todavía requiere las demás validaciones y confirmación.", "operationPolicy.allowedKinds", "operations", { values: CUSTOMER_OPERATION_KINDS }),
      protectedRule("tool-intersection", "Catálogo y permisos", "Una herramienta solo puede utilizarse si existe en el catálogo, está disponible en el canal, está permitida para la intención interpretada, la configuración administrativa no la bloquea y el usuario tiene los permisos necesarios. B6 no puede inventar una herramienta ni habilitarla por su cuenta.", "conversation-engine.js / channel-intents.js"),
    ],
  },
  {
    id: "plan", title: "3. Validación del plan de B6",
    rules: [
      configurable("single-operation-target", "Cambios sobre varios registros", "Cuando se solicita modificar una colección, explica que solo puede preparar un registro a la vez y pide elegirlo. Por ejemplo, «actualiza el monto de las oportunidades abiertas a 1000000» devuelve una aclaración y cero operaciones, aunque ya exista una oportunidad seleccionada. Limita las operaciones, no las consultas: sí se pueden listar varias oportunidades. Actualmente solo se admite pedir un registro; no permite activar operaciones masivas.", "serverPolicy.multipleTargets", "select", { options: [{ value: "ask_single", label: "Pedir que se elija un registro" }] }),
      configurable("ambiguous-target", "Objetivo ambiguo", "Si no puede distinguirse un objetivo único, pide aclaración y no elige un registro en silencio. Por ejemplo, si dos oportunidades coinciden con «Renovación», el servidor no decide arbitrariamente cuál modificar. Actualmente pedir aclaración es la única opción admitida; no permite activar selección automática.", "serverPolicy.ambiguousTarget", "select", { options: [{ value: "ask", label: "Pedir aclaración" }] }),
      configurable("selected-fallback", "Oportunidad seleccionada como respaldo", "Controla si la oportunidad seleccionada puede utilizarse cuando una solicitud singular de cambio de monto no identifica otro objetivo. «Permitir en solicitudes singulares compatibles» permite usar la selección para «cambia el monto de esta oportunidad». «Exigir identificar la oportunidad» necesita resolver el objetivo sin ese respaldo. Ninguna opción convierte «las oportunidades» en «la oportunidad seleccionada», ni ignora un nombre contradictorio o ambiguo.", "serverPolicy.selectedOpportunityFallback", "select", { options: [{ value: "allow_singular", label: "Permitir en solicitudes singulares compatibles" }, { value: "require_explicit", label: "Exigir identificar la oportunidad" }] }),
      protectedRule("plan-contract", "Intenciones, entidades y cardinalidad", "Comprueba que el plan de B6 tenga sentido para el servidor: la intención está habilitada, los candidatos (candidateKeys) corresponden a registros autorizados de la cuenta, el tipo de entidad y la cantidad de objetivos son coherentes, y existe el contexto requerido. Por ejemplo, B6 no puede señalar un contacto como si fuera una oportunidad ni utilizar un candidato de otra cuenta. Un plan inválido no ejecuta lecturas.", "channel-intents.js / conversation-engine.js"),
      protectedRule("plan-filters", "Filtros válidos", "Comprueba el formato y los rangos de los filtros: estados conocidos, códigos de etapa válidos, años entre 2000 y 2100, periodos entre 1 y 60 meses y fechas reales ordenadas. Los filtros inválidos se normalizan o eliminan según el contrato existente; no se aceptan tal como los inventó B6.", "channel-intents.js"),
      modelRule("plan-confidence", "Interpretación de B6", "B6 propone qué quiere hacer el usuario, qué registros menciona y con qué confianza lo interpreta. El servidor no trata esa interpretación como una autorización: valida el plan antes de utilizarlo y exige aclaración con confianza baja o cuando el plan resulta inconsistente.", "channel-intents.js"),
    ],
  },
  {
    id: "evidence", title: "4. Lectura de datos y evidencia",
    rules: [
      configurable("read-budget", "Máximo de lecturas por turno", "Limita las llamadas a herramientas de lectura durante el turno, incluidas las iniciales, las adicionales y las cotizaciones. Admite de 1 a 8; el valor inicial es 8. No es un límite de filas: una lectura puede devolver varios registros. Tampoco limita la construcción previa del snapshot autorizado (los datos CRM disponibles al iniciar el turno). Si se agota el presupuesto, no se debe inventar la información que faltó consultar.", "serverPolicy.maxReadQueries", "number", { min: 1, max: 8 }),
      configurable("evidence-rounds", "Rondas adicionales de evidencia", "Después de las primeras lecturas se evalúa si falta información. Esta regla limita cuántas veces puede intentarse recuperar más evidencia. Admite de 0 a 2 rondas adicionales; el valor inicial es 2. Con cero se mantiene la evaluación inicial, pero no se permiten rondas adicionales de lectura.", "serverPolicy.maxEvidenceRounds", "number", { min: 0, max: 2 }),
      configurable("turn-deadline", "Tiempo máximo del turno (ms)", "Establece un mismo plazo para planificación, preparación de lecturas, verificación de evidencia, generación y auditoría de la respuesta. Admite de 5000 a 45000 ms (5 a 45 segundos); el valor inicial es 45000 ms. No es el tiempo total de cualquier trabajo previo de investigación. Si el motor excede su plazo, el turno no se da por completado correctamente.", "serverPolicy.maxTurnMs", "number", { min: 5000, max: 45000 }),
      configurable("default-open", "Consultar abiertas por defecto", "Aplica el filtro de oportunidades abiertas cuando la solicitud no fija otro estado. Por ejemplo, puede orientar «muéstrame las oportunidades» hacia las abiertas. Una petición explícita de históricas tiene prioridad sobre este valor predeterminado.", "filters.defaultOpenOnly", "boolean"),
      configurable("default-active", "Consultar activadas por defecto", "Aplica el filtro de oportunidades activadas cuando la solicitud no establece otro criterio de activación o estado. Activada y abierta no significan lo mismo: una se refiere a activación y la otra al estado comercial. No puede combinarse con «Consultar no activadas por defecto».", "filters.defaultActiveOnly", "boolean"),
      configurable("default-inactive", "Consultar no activadas por defecto", "Aplica el filtro de oportunidades no activadas cuando la solicitud no establece otro criterio. No puede exigirse simultáneamente «solo activadas» y «solo no activadas»; la interfaz permite elegir una de esas preferencias, no ambas.", "filters.defaultInactiveOnly", "boolean"),
      protectedRule("read-scope", "Lecturas autorizadas y resultados vacíos", "No cruza cuentas y evita repetir consultas ya cubiertas. Distingue una consulta que terminó sin registros, una que falló y una que no se ejecutó o quedó incompleta. Solo la primera permite afirmar que esa consulta, dentro de ese alcance, no encontró resultados. Por ejemplo, un error de permisos al consultar actividades no permite responder «no hay actividades».", "customer-chat-adapter.js / customer-chat-evidence.js"),
      modelRule("evidence-assessment", "Suficiencia de evidencia", "La IA revisa si los datos obtenidos cubren todas las partes de la pregunta. El servidor impide aceptar «evidencia suficiente» o «sin resultados» cuando hay errores o fuentes necesarias pendientes. Por ejemplo, haber consultado oportunidades no basta para responder también quiénes son sus contactos asociados si esa información no está respaldada.", "customer-chat-evidence.js"),
    ],
  },
  {
    id: "activities", title: "5. Preparación de actividades",
    rules: [
      protectedRule("activity-read-priority", "Consulta de actividades", "Mantiene como lectura una pregunta sobre actividades existentes, no como preparación de un nuevo borrador. Por ejemplo, «¿qué llamadas tiene registradas esta oportunidad?» no debe convertirse en una propuesta para crear otra llamada.", "customer-chat-adapter.js"),
      protectedRule("activity-links", "Permisos y vínculos", "Antes de preparar una actividad, exige los permisos de ejecución de Coach y actualización de Calendario y oportunidades. Verifica las relaciones entre cuenta, oportunidad y contacto, y el acceso al contacto. No basta con que un contacto exista: debe ser compatible con la oportunidad y estar autorizado para el usuario.", "activity-draft.js"),
      protectedRule("activity-continuation", "Borrador y fecha", "Una continuación debe corresponder al borrador y a la oportunidad correctos. Si falta una fecha/hora válida, queda pendiente en lugar de inventarse. Por ejemplo, «propón una llamada» puede producir un borrador con fecha pendiente; no significa que la llamada ya esté guardada en Calendario.", "activity-draft.js / activity-draft-persistence.js"),
    ],
  },
  {
    id: "amount", title: "6. Preparación de cambios de monto",
    rules: [
      protectedRule("amount-input", "Importe y permisos", "Exige un importe numérico finito y no negativo, permiso para actualizar oportunidades (oportunidades.update), el tipo «Campo de oportunidad» (opportunity_field) habilitado y acceso al dominio necesario para comprobar la oportunidad. Si falta alguna condición, no prepara una operación válida de cambio de monto.", "customer-chat-adapter.js"),
      protectedRule("amount-target", "Un objetivo compatible", "Comprueba que el cambio corresponda a una oportunidad individual compatible con la solicitud y aplica las políticas de ambigüedad y respaldo seleccionado. Cuando pide elegir una, conserva importe, cuenta, filtros y candidatos autorizados. Por ejemplo, después de «cambia el monto de las oportunidades abiertas a 1000000», responder «Vrf 2027» permite volver a comprobar esa oportunidad y preparar una propuesta confirmable por 1000000. Una oportunidad histórica no satisface una solicitud de abiertas; una pregunta distinta que mencione el nombre tampoco se interpreta automáticamente como selección.", "server-policy.js / customer-chat-adapter.js"),
    ],
  },
  {
    id: "proposals", title: "7. Validación de operaciones propuestas",
    rules: [
      protectedRule("proposal-contract", "Contrato, campos y relaciones", "Comprueba la estructura concreta de cada operación: tipo, identificadores autorizados, campos admitidos y relaciones entre registros. Crear o vincular contactos y oportunidades exige permisos y relaciones de la misma cuenta. Por ejemplo, una propuesta de la IA con un campo no permitido o un contacto de otra cuenta no se conserva como operación válida.", "customer-chat-adapter.js / contract.js"),
      protectedRule("proposal-policy", "Política efectiva y confirmación", "Antes de entregar las propuestas, vuelve a filtrar sus tipos conforme a la política del turno y al canal de origen. Todas requieren confirmación y se rechazan propuestas incompatibles con la restricción de objetivo individual: una solicitud múltiple no produce operaciones. Que la IA diga «preparé el cambio» no demuestra que exista una operación válida ni que se haya ejecutado.", "conversation-engine.js / customer-chat-adapter.js"),
    ],
  },
  {
    id: "answer", title: "8. Respuesta final",
    rules: [
      protectedRule("business-evidence", "Evidencia obligatoria", "Una respuesta factual necesita evidencia de negocio. Si falta, devuelve una aclaración y retira las operaciones correspondientes. Las respuestas de aclaración, error o derivación no necesitan fingir evidencia CRM: pueden explicar directamente por qué no se pudo continuar.", "conversation-engine.js"),
      modelRule("answer-audit", "Auditoría de afirmaciones", "La IA contrasta la respuesta propuesta con la evidencia autorizada. Por ejemplo, afirmar que el monto actual es 2000000 requiere respaldo CRM. El monto destino solicitado por el usuario se comprueba como parte de la petición, no como un hecho ya existente en el CRM. Si la auditoría rechaza la respuesta, resulta inconclusa o no está disponible, el servidor bloquea la respuesta propuesta y sus operaciones.", "customer-chat-adapter.js"),
    ],
  },
  {
    id: "execution", title: "9. Persistencia y ejecución posterior",
    rules: [
      protectedRule("operation-version", "Propietario, estado y versión", "Al guardar o modificar borradores, comprueba su propietario, sesión, cuenta, estado y versión. Por ejemplo, si dos pantallas editan el mismo borrador, una actualización antigua no debe sobrescribir silenciosamente la más reciente. Tampoco se modifica como pendiente una operación ya cerrada.", "activity-draft-persistence.js / controlled-operation-service.js"),
      protectedRule("execution-access", "Revisión y ejecución", "Cuando llega el momento de ejecutar, vuelve a comprobar permisos, acceso, campos permitidos, valor actual y compatibilidad con el estado del registro. Una propuesta válida hace unos minutos puede dejar de serlo si cambió la oportunidad o el usuario perdió permisos. Bloquea cambios incompatibles con estados terminales, exige confirmación y deja auditoría de la ejecución.", "operation-policy.js / controlled-operation-service.js"),
    ],
  },
];

export function getCustomerServerPolicy(businessRules = {}) {
  return customerServerPolicySchema.parse({
    ...CUSTOMER_SERVER_POLICY_DEFAULTS,
    ...businessRules.serverPolicy,
  });
}

export function getCustomerEvidenceLimits(businessRules = {}) {
  const policy = getCustomerServerPolicy(businessRules);
  return {
    maxReadQueries: policy.maxReadQueries,
    maxRounds: policy.maxEvidenceRounds,
    maxTurnMs: policy.maxTurnMs,
  };
}

export function isCustomerCollectionRequest(question, routing = null) {
  return ["multiple", "all"].includes(routing?.referenceResolution?.cardinality) ||
    /\b(?:oportunidades|contactos|cuentas|leads|registros|ambas|ambos|cada\s+oportunidad)\b/i.test(
      String(question || "").normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
    );
}

export function customerSingleTargetClarification(question, routing = null, businessRules = {}) {
  const policy = getCustomerServerPolicy(businessRules);
  if (policy.multipleTargets !== "ask_single" || !isCustomerCollectionRequest(question, routing)) return null;
  const opportunityTarget = /\boportunidades\b/i.test(question || "") ||
    routing?.referenceResolution?.targetType === "opportunity";
  return {
    ruleId: "single-operation-target",
    message: opportunityTarget
      ? "Solo puedo preparar el cambio de una oportunidad a la vez. ¿Cuál quieres modificar?"
      : "Solo puedo preparar el cambio de un registro a la vez. ¿Cuál quieres modificar?",
    operations: [],
  };
}
