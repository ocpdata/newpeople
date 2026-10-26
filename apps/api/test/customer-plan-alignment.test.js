import { describe, expect, it, vi } from "vitest";
import {
  alignContractWithPlan, comparePlanAndContract, plannedTasksForInterpretation,
} from "../src/commercial-intelligence/dossier/plan-alignment.js";
import { interpretReviewedCustomerTurn } from "../src/commercial-intelligence/turn-contract-review.js";
import { customerTurnContractSchema, getCustomerTurnProviderVariants } from "../src/commercial-intelligence/turn-contract.js";

const question = "Redacta un correo para Daniel sin incluir costos y agenda una llamada el jueves.";
const constraints = (extra = {}) => ({ count: 0, durationMinutes: 0, length: "standard", format: "free",
  excludedSources: [], excludedFields: [], noWrite: false, noSend: false, quotes: [], ...extra });
const task = (id, type, kind, extra = {}) => ({ id, type, kind, ask: `Tarea ${id}`, evidence: "correo", focusLevel: "account",
  opportunityIds: [], dependsOn: [], itemsNeedConfirmation: false, constraints: constraints(), ...extra });
const plan = (tasks) => ({ tasks, recordFilters: [], continuation: { kind: "none", previousTaskIndex: 0 },
  clarification: { question: "", options: [] }, reason: "" });
const component = (id, category, extra = {}) => ({ id, category, text: question, object: "general", topic: "", scope: "none",
  reference: "", attribution: "none", certainty: "unspecified", explicitAction: category.startsWith("action."),
  dependsOn: [], continuationOf: "none", ...extra });
const contract = (components) => ({ version: 1, movement: "new_request", resolution: "resolved",
  clarificationQuestion: "", confidence: "high", components });

const emailTask = task("t1", "compose", "email", { constraints: constraints({ excludedFields: ["costs"], quotes: ["sin incluir costos"] }) });
const callTask = task("t2", "action", "schedule_activity");

describe("alineación del contrato de B3 con el plan", () => {
  it("empareja por tipo y tipo de tarea y detecta faltantes, extras y restricciones perdidas", () => {
    const comparison = comparePlanAndContract(plan([emailTask, callTask]), contract([
      component("c1", "content.email_draft", { text: "Correo para Daniel" }),
      component("c2", "query.record_detail"),
    ]));
    expect(comparison.issues.map((issue) => issue.code)).toEqual(["MISSING_TASK", "UNPLANNED_TASK", "LOST_CONSTRAINT"]);
    expect(comparison.missing.map((item) => item.id)).toEqual(["t2"]);
  });

  it("quita extras sin dependientes, repone citas literales y crea tareas sin especificación adicional", () => {
    const limit = task("t2", "limit", "send_communication");
    const { contract: aligned, adjustments } = alignContractWithPlan(plan([emailTask, limit]), contract([
      component("c1", "query.record_detail"),
      component("c2", "content.email_draft", { text: "Correo para Daniel", dependsOn: ["c1"] }),
      component("c3", "query.history", { dependsOn: ["c1"] }),
    ]));
    expect(aligned.components.map((item) => item.category)).toEqual([
      "query.record_detail", "content.email_draft", "action.send_communication"]);
    expect(aligned.components[1].text).toContain("«sin incluir costos»");
    expect(aligned.components[2]).toMatchObject({ id: "c4", explicitAction: true });
    expect(adjustments).toMatchObject({ removedComponentIds: ["c3"], synthesizedTaskIds: ["t2"], unresolvedTaskIds: [] });
    expect(() => customerTurnContractSchema.parse(aligned)).not.toThrow();
  });

  it("no inventa acciones que requieren especificación y respeta el máximo de componentes", () => {
    const { contract: aligned, adjustments } = alignContractWithPlan(plan([emailTask, callTask]), contract([
      component("c1", "content.email_draft", { text: "sin incluir costos" }),
      component("c2", "query.record_list", { continuationOf: "c1" }),
    ]));
    expect(aligned.components.map((item) => item.id)).toEqual(["c1"]);
    expect(adjustments).toMatchObject({ removedComponentIds: ["c2"], unresolvedTaskIds: ["t2"] });
  });

  it("repone el material aportado cuando el texto lo sustituye por una descripción", () => {
    const material = `Traduce al inglés: ${"Hardware Refresh pertenece a Totalplay y tiene un importe de 500.000 USD. ".repeat(6)}`;
    const translate = task("t1", "compose", "translation", { evidence: "Traduce al inglés" });
    const drifted = contract([component("c1", "content.translation", { text: "Traduce el texto aportado" })]);
    expect(comparePlanAndContract(plan([translate]), drifted, { question: material }).issues.map((issue) => issue.code))
      .toEqual(["LOST_MATERIAL"]);
    const { contract: aligned, adjustments } = alignContractWithPlan(plan([translate]), drifted, { question: material });
    expect(aligned.components[0].text).toBe(material.trim());
    expect(adjustments.restoredMaterialIds).toEqual(["c1"]);
    expect(comparePlanAndContract(plan([translate]), aligned, { question: material }).issues).toEqual([]);
  });

  it("entrega a B3 las categorías permitidas por tarea", () => {
    const [email, call] = plannedTasksForInterpretation(plan([emailTask, callTask]));
    expect(email.allowedCategories).toEqual(["content.email_draft"]);
    expect(call.allowedCategories).toContain("action.schedule_activity");
    expect(email.constraints.quotes).toEqual(["sin incluir costos"]);
  });
});

describe("proponente de acciones acotado", () => {
  it("restringe el esquema a las categorías permitidas por el plan", () => {
    const categories = (variants) => variants[0].find((field) => field.key === "components").items.variants
      .flatMap((variant) => variant.fields.find((field) => field.key === "category").enum);
    expect(categories(getCustomerTurnProviderVariants())).toHaveLength(46);
    expect(categories(getCustomerTurnProviderVariants(undefined, ["action.schedule_activity", "action.update_fields"])).sort())
      .toEqual(["action.schedule_activity", "action.update_fields"]);
  });
});

describe("B3 guiado por el plan", () => {
  const input = { question, classifierPrompt: { instruction: "" }, user: { id: 0 } };

  it("acepta el contrato que coincide con el plan sin revisor de IA", async () => {
    const good = contract([component("c1", "content.email_draft"),
      component("c2", "action.schedule_activity", { object: "activity" })]);
    const interpret = vi.fn().mockResolvedValue(good);
    const reviewWithAI = vi.fn();
    const result = await interpretReviewedCustomerTurn(input, { plan: plan([emailTask, callTask]), interpret, reviewWithAI });
    expect(result.contract).toEqual(good);
    expect(result.review).toMatchObject({ status: "plan_aligned", attempts: 1, adjustments: null });
    expect(interpret.mock.calls[0][0].plannedTasks.map((item) => item.id)).toEqual(["t1", "t2"]);
    expect(reviewWithAI).not.toHaveBeenCalled();
  });

  it("conserva el contrato de B3 si alinearlo lo dejaría sin componentes", async () => {
    const outcome = task("t1", "action", "record_outcome");
    const report = contract([component("c1", "report.interaction_outcome", { text: question, explicitAction: false })]);
    const interpret = vi.fn().mockResolvedValue(report);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await interpretReviewedCustomerTurn(input, { plan: plan([outcome]), interpret, reviewWithAI: vi.fn() });
    expect(result.contract).toEqual(report);
    expect(result.review).toMatchObject({ status: "plan_unaligned", adjustments: { keptUnaligned: true } });
    warn.mockRestore();
  });

  it("reinterpreta una vez con los problemas y luego alinea por código", async () => {
    const drifted = contract([component("c1", "content.email_draft", { text: "Correo para Daniel" }), component("c2", "query.history")]);
    const interpret = vi.fn().mockResolvedValue(drifted);
    const result = await interpretReviewedCustomerTurn(input, { plan: plan([emailTask]), interpret, reviewWithAI: vi.fn() });
    expect(interpret).toHaveBeenCalledTimes(2);
    expect(interpret.mock.calls[1][0].interpretationFeedback.issues.map((issue) => issue.code))
      .toEqual(["UNPLANNED_TASK", "LOST_CONSTRAINT"]);
    expect(result.contract.components).toHaveLength(1);
    expect(result.contract.components[0].text).toContain("«sin incluir costos»");
    expect(result.review.adjustments.removedComponentIds).toEqual(["c2"]);
  });
});
