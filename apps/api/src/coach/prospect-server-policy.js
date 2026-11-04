import { z } from "zod";

// Server rules of the Cuenta nueva chat: what the administrator may tune and what stays protected in code. They are
// stored with the channel's business rules (scope, operation kinds and serverPolicy) and versioned like those of the
// account chat, in their own channel.

export const PROSPECT_OPERATION_KINDS = ["create_account", "create_contact", "create_opportunity"];

export const PROSPECT_SERVER_POLICY_DEFAULTS = Object.freeze({
  schemaVersion: 1,
  semanticClassifier: "on",
  helpModelRole: "advanced",
  maxHistoryMessages: 16,
});

export const prospectServerPolicySchema = z.object({
  schemaVersion: z.literal(1),
  semanticClassifier: z.enum(["on", "off"]),
  helpModelRole: z.enum(["fast", "advanced"]),
  maxHistoryMessages: z.number().int().min(2).max(16),
}).strict();

export const PROSPECT_SCOPE_FLAGS = ["libraryMaterialsAllowed", "similarCustomersAllowed"];

export const prospectServerRulesPatchSchema = z.object({
  scope: z.object({
    libraryMaterialsAllowed: z.boolean(),
    similarCustomersAllowed: z.boolean(),
  }).partial().strict().optional(),
  operationPolicy: z.object({
    allowedKinds: z.array(z.enum(PROSPECT_OPERATION_KINDS)).max(PROSPECT_OPERATION_KINDS.length),
  }).strict().optional(),
  serverPolicy: prospectServerPolicySchema.partial().optional(),
}).strict();

export const prospectServerRulesUpdateSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  rules: prospectServerRulesPatchSchema,
}).strict();

// Invalid or missing values fall back to the default instead of breaking the chat.
export function getProspectServerPolicy(overrides = {}) {
  const parsed = prospectServerPolicySchema.safeParse({
    ...PROSPECT_SERVER_POLICY_DEFAULTS,
    ...(overrides?.serverPolicy || {}),
    schemaVersion: 1,
  });
  return parsed.success ? parsed.data : { ...PROSPECT_SERVER_POLICY_DEFAULTS };
}

const protectedRule = (id, title, description, implementation) => ({ id, title, description, implementation, kind: "protected" });
const configurable = (id, title, description, path, control, extra = {}) => ({
  id, title, description, path, control, kind: "configurable", ...extra,
});
const modelRule = (id, title, description, implementation) => ({ id, title, description, implementation, kind: "model" });

export const PROSPECT_SERVER_RULE_CATEGORIES = [
  {
    id: "access", title: "1. Acceso y sesión",
    rules: [
      protectedRule("user-access", "Permisos y propiedad", "Exige prospeccion.read y que la sesión de prospección pertenezca al usuario. El chat de Cuenta nueva está disponible para todos los usuarios con acceso a prospección: el rollout del canal no lo limita.", "routes.prospect-research.js, prospect-research/service.js"),
      protectedRule("crm-confirmed-only", "Datos de prospección, no CRM", "Los hallazgos, personas e hipótesis de la sesión nunca se presentan como registros confirmados del CRM.", "prospect-prompts.js, prospect-verifier.js"),
    ],
  },
  {
    id: "capabilities", title: "2. Herramientas y contexto",
    rules: [
      configurable("library-materials", "Material de la biblioteca comercial", "Permite que el chat recomiende material de la Biblioteca de ventas. Aunque esté activo, cada usuario solo ve el material que ya puede ver y necesita el permiso de la biblioteca.", "scope.libraryMaterialsAllowed", "boolean"),
      configurable("similar-customers", "Clientes parecidos del CRM", "Permite incluir clientes parecidos al prospecto, lo que se les vendió y quién atiende una cuenta parecida. Se lee con el alcance de cuentas del propio usuario.", "scope.similarCustomersAllowed", "boolean"),
      protectedRule("tool-intersection", "Catálogo y permisos", "Una herramienta solo se usa si existe en el catálogo del canal, la intención seleccionada la permite y el usuario tiene su permiso.", "channel-intents.js, conversation-engine.js"),
    ],
  },
  {
    id: "operations", title: "3. Conversiones al CRM",
    rules: [
      configurable("operation-kinds", "Conversiones que puede proponer", "Define qué conversiones puede proponer el chat (cuenta, contacto u oportunidad). Siempre requieren revisión y confirmación del vendedor; además dependen del gobierno de Mi Coach.", "operationPolicy.allowedKinds", "operations", { values: PROSPECT_OPERATION_KINDS }),
      protectedRule("server-operations", "Operaciones construidas por el servidor", "El modelo nunca propone operaciones: las construye el servidor a partir de la petición explícita del vendedor y siempre piden confirmación.", "prospect-operations.js"),
    ],
  },
  {
    id: "interpretation", title: "4. Interpretación y respuesta",
    rules: [
      configurable("semantic-classifier", "Clasificador con IA", "Con «on», un modelo elige la intención de la pregunta; con «off» decide solo el clasificador de patrones. Si el modelo falla o duda, siempre deciden los patrones.", "serverPolicy.semanticClassifier", "select", { options: [{ value: "on", label: "Activado" }, { value: "off", label: "Desactivado: solo patrones" }] }),
      configurable("help-model-role", "Nivel de modelo para ayuda", "Nivel del modelo que redacta correos, guiones, priorizaciones y material. Por defecto usa el modelo avanzado del módulo Cuenta nueva; «fast» usa el rápido, cuesta menos por respuesta y redacta con menos criterio.", "serverPolicy.helpModelRole", "select", { options: [{ value: "advanced", label: "Avanzado (recomendado)" }, { value: "fast", label: "Rápido (menor costo)" }] }),
      configurable("history-window", "Mensajes de memoria", "Cuántos mensajes recientes de la conversación recibe el modelo (de 2 a 16).", "serverPolicy.maxHistoryMessages", "number", { min: 2, max: 16 }),
      modelRule("intent-classification", "Interpretación de la pregunta", "El modelo propone la intención; el servidor solo acepta intenciones habilitadas del catálogo y las herramientas se intersectan con las permitidas.", "prospect-intent-classifier.js"),
    ],
  },
  {
    id: "verification", title: "5. Verificación de la respuesta",
    rules: [
      protectedRule("answer-verification", "Datos de la respuesta contra la sesión", "Comprueba que correos, enlaces, cifras, fechas y nombres de la respuesta existan en la sesión, el contexto del CRM o la biblioteca; si no, pide una corrección y retira lo que no pueda respaldar. No se puede desactivar desde la administración.", "prospect-verifier.js"),
      protectedRule("conversion-confirmation", "Confirmación de conversiones", "Ninguna cuenta, contacto u oportunidad se crea sin que el vendedor revise y confirme la operación.", "operation-contract.js"),
    ],
  },
];
