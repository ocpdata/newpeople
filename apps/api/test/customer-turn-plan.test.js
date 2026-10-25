import { describe, expect, it } from "vitest";
import { DEFAULT_CONSTRAINTS, validateTurnPlan } from "../src/commercial-intelligence/dossier/turn-plan.js";
import {
  conversationStateFromLegacyContext, emptyConversationState, validateConversationState,
} from "../src/commercial-intelligence/dossier/conversation-state.js";
import { describeTurnTasks, hasTask, LEGACY_CATEGORY_TASKS } from "../src/commercial-intelligence/dossier/observed-tasks.js";
import { TASK_KINDS } from "../src/commercial-intelligence/dossier/turn-plan.js";

const task = (overrides = {}) => ({
  type: "consult", kind: "summary", ask: "Resumen de la cuenta", evidence: "Resume Totalplay",
  focusLevel: "account", opportunityIds: [], dependsOn: [], itemsNeedConfirmation: false,
  constraints: { ...DEFAULT_CONSTRAINTS }, ...overrides,
});
const plan = (tasks, overrides = {}) => ({
  tasks, recordFilters: [], continuation: { kind: "none", previousTaskIndex: 0 },
  clarification: { question: "", options: [] }, reason: "x", ...overrides,
});
const question = "Resume Totalplay, lista las pendientes de Hardware Refresh, redacta un correo a Kimberly y " +
  "prepara una agenda de 20 minutos; sin usar la biblioteca y no lo envíes";
const validate = (raw, extra = {}) => validateTurnPlan(raw, { question, opportunityIds: [36, 67], ...extra });

describe("plan del turno", () => {
  it("asigna IDs por código y acepta un plan de varias tareas con restricciones citadas", () => {
    const result = validate(plan([
      task(),
      task({ kind: "pending", evidence: "lista las pendientes de Hardware Refresh", focusLevel: "opportunity", opportunityIds: [36] }),
      task({ type: "compose", kind: "email", evidence: "redacta un correo a Kimberly",
        constraints: { ...DEFAULT_CONSTRAINTS, noSend: true, excludedSources: ["library"],
          quotes: ["no lo envíes", "sin usar la biblioteca"] } }),
      task({ type: "compose", kind: "agenda", evidence: "prepara una agenda de 20 minutos", dependsOn: [2],
        constraints: { ...DEFAULT_CONSTRAINTS, durationMinutes: 20, quotes: ["20 minutos"] } }),
    ]));
    expect(result.issues).toEqual([]);
    expect(result.plan.tasks.map((item) => item.id)).toEqual(["t1", "t2", "t3", "t4"]);
    expect(result.plan.tasks[3].dependsOn).toEqual(["t2"]);
  });

  it("rechaza tipos incoherentes, evidencia inventada, IDs ajenos y dependencias hacia adelante", () => {
    const issues = validate(plan([
      task({ kind: "email" }),
      task({ evidence: "texto que no está", opportunityIds: [999], focusLevel: "opportunity" }),
      task({ dependsOn: [3] }),
    ])).issues.join(" | ");
    expect(issues).toMatch(/t1: kind=email no corresponde/);
    expect(issues).toMatch(/t2: evidence debe ser un fragmento literal/);
    expect(issues).toMatch(/t2: opportunityIds contiene IDs ajenos/);
    expect(issues).toMatch(/t3: dependsOn solo puede apuntar a tareas anteriores/);
  });

  it("exige citas literales para cada restricción y coherencia de negaciones", () => {
    const issues = validate(plan([
      task({ type: "compose", kind: "questions", evidence: "Resume Totalplay",
        constraints: { ...DEFAULT_CONSTRAINTS, count: 3, quotes: [] } }),
      task({ type: "action", kind: "schedule_activity", evidence: "Resume Totalplay",
        constraints: { ...DEFAULT_CONSTRAINTS, noWrite: true, quotes: ["no lo envíes"] } }),
      task({ evidence: "Resume Totalplay", constraints: { ...DEFAULT_CONSTRAINTS, noSend: true, quotes: ["no lo envíes"] } }),
      task({ evidence: "Resume Totalplay", constraints: { ...DEFAULT_CONSTRAINTS, durationMinutes: 20, quotes: ["20 minutos"] } }),
    ])).issues.join(" | ");
    expect(issues).toMatch(/t1: cada restricción requiere su cita literal/);
    expect(issues).toMatch(/t2: una acción no puede llevar noWrite/);
    expect(issues).toMatch(/t3: noSend solo aplica a redacción/);
    expect(issues).toMatch(/t4: durationMinutes solo aplica a agendas/);
  });

  it("acepta una aclaración sin tareas y valida sus opciones y la continuación", () => {
    expect(validate(plan([], { clarification: { question: "¿Cuál?", options: [{ label: "HR", opportunityId: 36 }] } })).issues)
      .toEqual([]);
    expect(validate(plan([])).issues).toContain("El plan no tiene tareas ni aclaración.");
    expect(validate(plan([], { clarification: { question: "¿Cuál?", options: [{ label: "X", opportunityId: 999 }] } })).issues)
      .toContain("La aclaración ofrece oportunidades que no pertenecen a la cuenta.");
    expect(validate(plan([task()], { continuation: { kind: "pending_action", previousTaskIndex: 0 } })).issues)
      .toContain("continuation=pending_action sin una acción pendiente en el estado.");
    expect(validate(plan([task()], { continuation: { kind: "pending_action", previousTaskIndex: 0 } }),
      { hasPendingAction: true }).issues).toEqual([]);
  });

  it("devuelve los problemas de esquema sin plan", () => {
    const result = validate({ tasks: [{ type: "otra" }] });
    expect(result.plan).toBeNull();
    expect(result.issues.length).toBeGreaterThan(0);
  });
});

describe("estado unificado de la conversación", () => {
  it("descarta referencias a oportunidades que ya no son visibles", () => {
    const state = {
      ...emptyConversationState(22),
      focus: { level: "opportunities", opportunityIds: [36, 99] },
      pendingAction: { kind: "schedule_activity", opportunityId: 99, fields: {}, missingFields: [], draftId: null, draftVersion: null },
      pendingClarification: { question: "¿Cuál?", optionOpportunityIds: [36, 99] },
    };
    const validated = validateConversationState(state, { accountId: 22, opportunityIds: [36] });
    expect(validated.focus).toEqual({ level: "opportunity", opportunityIds: [36] });
    expect(validated.pendingAction).toBeNull();
    expect(validated.pendingClarification.optionOpportunityIds).toEqual([36]);
    expect(validateConversationState(state, { accountId: 23, opportunityIds: [36] })).toEqual(emptyConversationState(23));
    expect(validateConversationState({ version: 9 }, { accountId: 22 })).toEqual(emptyConversationState(22));
  });

  it("se construye desde las memorias actuales para convivir con el recorrido anterior", () => {
    const fromDossier = conversationStateFromLegacyContext({
      accountId: 22,
      dossierMemory: { level: "opportunity", focusOpportunityIds: [36], obligations: [{ id: "o1", ask: "Monto" }],
        citedEvidenceIds: ["opp36"] },
      pendingActivity: { operationId: 9, version: 2, operation: { opportunityId: 36, actionType: "call",
        title: "Llamada con Kimberly", scheduledAt: "", missingFields: ["scheduledAt"] } },
    }, { accountId: 22, opportunityIds: [36] });
    expect(fromDossier.focus).toEqual({ level: "opportunity", opportunityIds: [36] });
    expect(fromDossier.lastTasks).toEqual([{ type: "consult", kind: "summary", ask: "Monto", status: "completed" }]);
    expect(fromDossier.pendingAction).toMatchObject({ kind: "schedule_activity", opportunityId: 36, draftId: 9,
      draftVersion: 2, missingFields: ["scheduledAt"], fields: { title: "Llamada con Kimberly", scheduledAt: "" } });
    const awaiting = conversationStateFromLegacyContext({ accountId: 22,
      pendingActivityIntent: { actionType: "call", timing: "scheduled", title: "Llamada con Daniel" } },
    { accountId: 22, opportunityIds: [36] });
    expect(awaiting.pendingAction).toMatchObject({ opportunityId: null, missingFields: ["opportunityId"],
      fields: { timing: "scheduled" } });
    expect(conversationStateFromLegacyContext(null, { accountId: 22 })).toEqual(emptyConversationState(22));
  });
});

describe("tareas observadas por turno", () => {
  it("traduce cada categoría del recorrido anterior a un tipo y subtipo válidos del plan", () => {
    expect(Object.keys(LEGACY_CATEGORY_TASKS)).toHaveLength(46);
    for (const [type, kind] of Object.values(LEGACY_CATEGORY_TASKS)) expect(TASK_KINDS[type]).toContain(kind);
  });

  it("describe tareas de ambos recorridos con la misma forma", () => {
    const legacy = describeTurnTasks({ components: [
      { id: "c1", category: "query.document_content", object: "general", documentSpec: { source: "knowledge_library" }, status: "completed" },
      { id: "c2", category: "content.discovery_questions", status: "completed", contentValidation: { reasonCode: "approved" } },
      { id: "c3", category: "action.send_communication", status: "unavailable" },
    ] });
    expect(legacy.map(({ type, kind, status }) => [type, kind, status])).toEqual([
      ["document", "library", "completed"], ["compose", "questions", "completed"], ["limit", "send_communication", "unavailable"]]);
    expect(legacy[1].validation).toEqual({ reasonCode: "approved" });
    const dossier = { turnTasks: [{ id: "o1", type: "consult", kind: "summary", status: "completed", engine: "dossier" }] };
    expect(hasTask(dossier, { type: "consult", statuses: ["completed"] })).toBe(true);
    expect(describeTurnTasks({ operations: [{ kind: "activity" }] })).toMatchObject([{ type: "action", kind: "schedule_activity" }]);
    expect(describeTurnTasks({ answer: "Hola" })).toEqual([]);
  });
});
