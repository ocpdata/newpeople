import { describe, expect, it, vi } from "vitest";
import { buildCustomerStageResponse, validateCustomerStageMemory } from "../src/commercial-intelligence/customer-stage.js";
import { coachOperationSchema } from "../src/coach/contract.js";
import { getCoachBusinessRules } from "../src/coach/business-rules.js";
import { validateCustomerConversationContext } from "../src/commercial-intelligence/conversation-context.js";
const snapshot = { account: { id: 1 } };
const data = { accountName: "Cuenta ficticia", opportunities: [{ id: 3, name: "Alfa", stageId: 1, stageName: "Inicial", status: "abierta" }],
  stages: [{ id: 1, name: "Inicial", code: "initial", stage_order: 1 }, { id: 2, name: "Negociación", code: "negotiation", stage_order: 2 },
    { id: 3, name: "Waiting", code: "waiting", stage_order: 3 }] };
const spec = { mode: "start", opportunityReference: "Alfa", targetReference: "", request: "advance", position: 0, evidence: "Avanza Alfa" };
const run = (patch = {}, options = {}) => {
  const next = { ...spec, ...patch };
  return buildCustomerStageResponse({ component: { object: "opportunity", scope: "single", stageSpec: next },
    question: next.evidence, movement: "new_request", snapshot, readStages: vi.fn(async () => data), ...options });
};
describe("A08 stage validation preparation", () => {
  it("prepares a strict handoff, never approval, job or direct stage change", async () => {
    const result = await run();
    expect(result.operations).toHaveLength(1);
    expect(coachOperationSchema.safeParse(result.operations[0]).success).toBe(true);
    expect(result.operations[0]).toMatchObject({ kind: "validate_stage", opportunityId: 3, stageRevision: 1,
      stageSummary: { currentStageId: 1, targetStageId: 2 } });
    expect(result.answer).toContain("La etapa todavía no cambió");
    expect(result.answer).toContain("automáticamente");
  });
  it("is opt-in without changing the default operation policy", () => {
    expect(getCoachBusinessRules({ channel: "customer_account" }).operationPolicy.allowedKinds).not.toContain("validate_stage");
    expect(getCoachBusinessRules({ channel: "customer_account", overrides: { operationPolicy: { allowedKinds: ["validate_stage"] } } })
      .operationPolicy.allowedKinds).toContain("validate_stage");
  });
  it.each(["evaluate_only", "unsupported"])("does not start or propose %s", async (request) => {
    const readStages = vi.fn();
    const result = await run({ request }, { readStages });
    expect(result.operations).toEqual([]);
    expect(readStages).not.toHaveBeenCalled();
  });
  it("never substitutes a future target with a sequence of automatic advances", async () => {
    const result = await run({ targetReference: "Waiting", evidence: "Alfa a Waiting" });
    expect(result.operations).toEqual([]);
    expect(result.answer).toContain("No saltaré");
  });
  it("accepts only the next exact stage name/code and literal references", async () => {
    expect((await run({ targetReference: "Negociación", evidence: "Alfa a Negociación" })).operations).toHaveLength(1);
    expect((await run({ targetReference: "Inventado" })).operations).toEqual([]);
    expect((await run({ opportunityReference: "999", evidence: "999" })).operations).toEqual([]);
  });
  it("accepts an opportunity reference quoted directly in the request without separate evidence text", async () => {
    const question = "Comprueba si Hardware Refresh puede avanzar y avánzala si puede";
    const result = await run({ opportunityReference: "Hardware Refresh", evidence: "" }, {
      question,
      readStages: vi.fn(async () => ({ ...data, opportunities: [
        { ...data.opportunities[0], name: "Hardware Refresh" },
      ] })),
    });
    expect(result.responseType).toBe("change_request");
    expect(result.answer).toContain("Dejé lista la solicitud");
    expect(result.answer).not.toContain("Conserva las referencias literales");
    expect(result.operations).toHaveLength(1);
  });
  it("does not claim that a draft was preserved when an invalid reference has no prior memory", async () => {
    const result = await run({ opportunityReference: "Inventada", evidence: "Inventada" }, {
      question: "Avanza Fantasma",
    });
    expect(result.answer).toContain("No preparé una validación");
    expect(result.answer).not.toContain("El borrador previo no cambió");
    expect(result.stageMemory).toBeNull();
  });
  it("rejects an opportunity reference that is not present in the current request", async () => {
    const readStages = vi.fn(async () => data);
    const result = await run({ opportunityReference: "Inventada", evidence: "Alfa" }, {
      question: "Comprueba si Alfa puede avanzar",
      readStages,
    });
    expect(result.responseType).toBe("clarification");
    expect(result.operations).toEqual([]);
    expect(readStages).not.toHaveBeenCalled();
  });
  it("asks for an opportunity instead of listing the account when none is identified", async () => {
    const readStages = vi.fn(async () => data);
    const result = await run({ opportunityReference: "", evidence: "actívala" }, {
      question: "actívala",
      readStages,
    });
    expect(result.responseType).toBe("clarification");
    expect(result.answer).toContain("¿Qué oportunidad quieres validar?");
    expect(result.stageMemory).toBeNull();
    expect(readStages).not.toHaveBeenCalled();
  });
  it("allows a short continuation to reuse the validated opportunity, not an ungrounded reference", async () => {
    const first = await run();
    const next = await run({ mode: "continue", opportunityReference: "Alfa", evidence: "" }, {
      question: "actívala",
      previous: first.stageMemory,
    });
    expect(next.operations).toHaveLength(1);
    expect(next.operations[0].opportunityId).toBe(3);
  });
  it.each(["ganada", "perdida", "anulada"])("blocks closed %s opportunities", async (status) => {
    const result = await run({}, { readStages: async () => ({ ...data, opportunities: [{ ...data.opportunities[0], status }] }) });
    expect(result.responseType).toBe("informational"); expect(result.operations).toEqual([]);
    expect(result.answer).toContain("No se inició ninguna validación");
  });
  it("does not substitute a requested commercial win for stage advancement", async () => {
    const readStages = vi.fn(async () => data);
    const result = await run({ evidence: "Observé interés en Hardware Refresh; márcala ganada" }, {
      question: "Observé interés en Hardware Refresh; márcala ganada", readStages,
    });
    expect(result.responseType).toBe("informational");
    expect(result.operations).toEqual([]);
    expect(result.answer).toContain("no se ejecutó ningún cambio");
    expect(readStages).not.toHaveBeenCalled();
  });
  it("does not validate at the last or inactive stage", async () => {
    for (const stageId of [3, 999]) {
      expect((await run({}, { readStages: async () => ({ ...data, opportunities: [{ ...data.opportunities[0], stageId }] }) })).operations).toEqual([]);
    }
  });
  it("clarifies homonyms and revalidates ordinal identity/order", async () => {
    const candidates = { ...data, opportunities: [...data.opportunities, { ...data.opportunities[0], id: 4 }] };
    const first = await run({}, { readStages: async () => candidates });
    expect(first.stageMemory.candidates).toEqual([3, 4]);
    const patch = { mode: "continue", opportunityReference: "", position: 2, evidence: "la segunda" };
    expect((await run(patch, { previous: first.stageMemory, readStages: async () => candidates })).operations[0].opportunityId).toBe(4);
    expect((await run(patch, { previous: first.stageMemory, readStages: async () => ({ ...candidates, opportunities: [...candidates.opportunities].reverse() }) })).operations).toEqual([]);
  });
  it("refreshes observed stages and invalidates previous revisions", async () => {
    const first = await run();
    const next = await run({ mode: "refresh", opportunityReference: "", evidence: "" }, { previous: first.stageMemory,
      readStages: async () => ({ ...data, opportunities: [{ ...data.opportunities[0], stageId: 2, stageName: "Negociación" }] }) });
    expect(next.operations[0].stageRevision).toBe(2);
    expect(next.operations[0].stageSummary.targetStageId).toBe(3);
    expect(next.stageMemory.draftId).toBe(first.stageMemory.draftId);
  });
  it("blocks bulk requests", async () => {
    const result = await run({}, { component: { scope: "collection", stageSpec: spec } });
    expect(result.operations).toEqual([]);
  });
  it("does not silently reuse a previous authorization after evaluate_only", async () => {
    const first = await run();
    const next = await run({ mode: "continue", opportunityReference: "", request: "evaluate_only", evidence: "" }, { previous: first.stageMemory });
    expect(next.stageMemory).toMatchObject({ request: "evaluate_only", observedVersion: "", revision: 2 });
  });
  it("preserves valid scoped memory and removes discarded or cross-account memory", async () => {
    const first = await run();
    expect(validateCustomerStageMemory(first.stageMemory, snapshot)).toEqual(first.stageMemory);
    expect(validateCustomerStageMemory(first.stageMemory, { account: { id: 2 } })).toBeNull();
    expect(validateCustomerConversationContext({ version: 1, accountId: 1, intents: [], filters: {},
      stageMemory: first.stageMemory }, snapshot, 1).stageMemory).toEqual(first.stageMemory);
    expect(validateCustomerConversationContext({ version: 1, accountId: 1, stageMemory: null }, snapshot, 1).stageMemory).toBeUndefined();
  });
});
