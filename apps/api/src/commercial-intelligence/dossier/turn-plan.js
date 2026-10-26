import { z } from "zod";

// Contract for the single interpretation of a customer-chat turn (design §4.1).
// The router proposes the plan; code validates it before any task runs.

export const TASK_KINDS = Object.freeze({
  consult: ["summary", "detail", "field", "list", "search", "history", "pending", "relationships", "notes",
    "readiness", "assessment", "risks", "next_steps", "strategy", "prioritization", "comparison", "trend",
    "scenario", "principle"],
  compose: ["email", "message", "agenda", "questions", "summary", "explanation", "rewrite", "translation",
    "value_argument"],
  document: ["quotation", "attachment", "crm_document", "library"],
  action: ["schedule_activity", "reschedule_activity", "update_fields", "link_contact", "record_outcome",
    "create_record", "record_note", "stage_answer", "change_stage"],
  limit: ["remove_record", "send_communication", "system_help", "financial_data", "internal_costs", "out_of_scope"],
});
export const TASK_TYPES = Object.freeze(Object.keys(TASK_KINDS));
export const EXCLUDABLE_SOURCES = Object.freeze(["library", "crm", "quotation", "attachment"]);
export const EXCLUDABLE_FIELDS = Object.freeze(["costs", "margins", "internal_notes", "prices", "discounts"]);
export const RESPONSE_LENGTHS = Object.freeze(["brief", "standard", "detailed"]);
export const RESPONSE_FORMATS = Object.freeze(["free", "list", "table", "email"]);
export const CONTINUATION_KINDS = Object.freeze(["none", "clarification_reply", "pending_action", "previous_task"]);
export const MAX_TASKS = 6;
// What a task works on besides the CRM: text pasted in the message, the previous assistant answer, an attached
// file or the document library.
export const TASK_MATERIALS = Object.freeze(["none", "message_text", "previous_answer", "attachment", "library"]);

const constraintSchema = z.object({
  count: z.number().int().min(0).max(20),
  durationMinutes: z.number().int().min(0).max(480),
  length: z.enum(RESPONSE_LENGTHS),
  format: z.enum(RESPONSE_FORMATS),
  excludedSources: z.array(z.enum(EXCLUDABLE_SOURCES)).max(EXCLUDABLE_SOURCES.length),
  excludedFields: z.array(z.enum(EXCLUDABLE_FIELDS)).max(EXCLUDABLE_FIELDS.length),
  noWrite: z.boolean(),
  noSend: z.boolean(),
  // Literal fragments of the message that justify each restriction above.
  quotes: z.array(z.string().min(1).max(300)).max(8),
}).strict();

const taskSchema = z.object({
  type: z.enum(TASK_TYPES),
  kind: z.string().min(1).max(40),
  ask: z.string().min(1).max(600),
  evidence: z.string().min(1).max(600),
  focusLevel: z.enum(["none", "account", "opportunity", "opportunities"]),
  opportunityIds: z.array(z.number().int().positive()).max(3),
  dependsOn: z.array(z.number().int().min(1).max(MAX_TASKS)).max(MAX_TASKS),
  itemsNeedConfirmation: z.boolean(),
  material: z.enum(TASK_MATERIALS).default("none"),
  constraints: constraintSchema,
}).strict();

const planSchema = z.object({
  tasks: z.array(taskSchema).max(MAX_TASKS),
  recordFilters: z.array(z.object({ description: z.string().max(300), quote: z.string().max(300) }).strict()).max(3),
  continuation: z.object({
    kind: z.enum(CONTINUATION_KINDS),
    previousTaskIndex: z.number().int().min(0).max(MAX_TASKS),
  }).strict(),
  clarification: z.object({
    question: z.string().max(1000),
    options: z.array(z.object({ label: z.string().min(1).max(200), opportunityId: z.number().int().min(0) }).strict()).max(10),
  }).strict(),
  reason: z.string().max(600),
}).strict();

export const DEFAULT_CONSTRAINTS = Object.freeze({
  count: 0, durationMinutes: 0, length: "standard", format: "free", excludedSources: [], excludedFields: [],
  noWrite: false, noSend: false, quotes: [],
});

const normalize = (text) => String(text || "").normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
const restricts = (constraints) => constraints.count > 0 || constraints.durationMinutes > 0 ||
  constraints.excludedSources.length > 0 || constraints.excludedFields.length > 0 ||
  constraints.noWrite || constraints.noSend;

/**
 * Validates a proposed turn plan against the message and the opportunities the user can see.
 * Returns the plan with task IDs assigned by code (t1..tN) and the concrete issues found.
 */
export function validateTurnPlan(raw, { question, opportunityIds = [], hasPendingAction = false }) {
  const parsed = planSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      plan: null,
      issues: parsed.error.issues.map((issue) => `${issue.path.join(".") || "plan"}: ${issue.message}`),
    };
  }
  const plan = parsed.data;
  const issues = [];
  const visible = new Set(opportunityIds.map(Number));
  const message = normalize(question);
  const clarifying = Boolean(plan.clarification.question.trim());

  if (!plan.tasks.length && !clarifying) issues.push("El plan no tiene tareas ni aclaración.");
  if (plan.clarification.options.some((option) => option.opportunityId && !visible.has(option.opportunityId))) {
    issues.push("La aclaración ofrece oportunidades que no pertenecen a la cuenta.");
  }
  if (plan.continuation.kind === "pending_action" && !hasPendingAction) {
    issues.push("continuation=pending_action sin una acción pendiente en el estado.");
  }

  plan.tasks.forEach((task, index) => {
    const id = `t${index + 1}`;
    if (!TASK_KINDS[task.type].includes(task.kind)) issues.push(`${id}: kind=${task.kind} no corresponde a type=${task.type}.`);
    if (!message.includes(normalize(task.evidence))) issues.push(`${id}: evidence debe ser un fragmento literal del mensaje.`);
    if (task.opportunityIds.some((oppId) => !visible.has(oppId))) issues.push(`${id}: opportunityIds contiene IDs ajenos a la cuenta.`);
    if (task.focusLevel === "opportunity" && task.opportunityIds.length !== 1) issues.push(`${id}: focusLevel=opportunity requiere un ID.`);
    if (task.focusLevel === "opportunities" && task.opportunityIds.length < 2) issues.push(`${id}: focusLevel=opportunities requiere 2 o 3 IDs.`);
    if (task.dependsOn.some((dep) => dep >= index + 1)) issues.push(`${id}: dependsOn solo puede apuntar a tareas anteriores.`);
    const { constraints } = task;
    if (task.type === "action" && constraints.noWrite) {
      issues.push(`${id}: una acción no puede llevar noWrite; si el usuario solo pide redactar, la tarea es compose.`);
    }
    if (constraints.noSend && !["compose", "limit"].includes(task.type)) issues.push(`${id}: noSend solo aplica a redacción.`);
    if (constraints.durationMinutes > 0 && !(task.type === "compose" && task.kind === "agenda")) {
      issues.push(`${id}: durationMinutes solo aplica a agendas.`);
    }
    if (restricts(constraints)) {
      if (!constraints.quotes.length) issues.push(`${id}: cada restricción requiere su cita literal en quotes.`);
      if (constraints.quotes.some((quote) => !message.includes(normalize(quote)))) {
        issues.push(`${id}: quotes contiene fragmentos que no están en el mensaje.`);
      }
    }
  });

  // Record filters must quote the message; unquoted ones are dropped instead of trusted.
  const recordFilters = plan.recordFilters.filter((filter) => normalize(filter.quote).length >= 3 &&
    message.includes(normalize(filter.quote)));
  return {
    issues,
    droppedFilters: plan.recordFilters.filter((filter) => !recordFilters.includes(filter)),
    plan: {
      ...plan,
      recordFilters,
      tasks: plan.tasks.map((task, index) => ({
        id: `t${index + 1}`,
        ...task,
        dependsOn: task.dependsOn.map((dep) => `t${dep}`),
      })),
    },
  };
}
