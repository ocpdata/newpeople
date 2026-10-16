import { describe, expect, it, vi } from "vitest";
import {
  CUSTOMER_TURN_CATEGORIES, CUSTOMER_DIALOGUE_MOVEMENTS, customerTurnContractSchema,
  customerTurnContractEnabled, customerComponentCapability, constrainCustomerComponentPlan,
  interpretCustomerTurn,
} from "../src/commercial-intelligence/turn-contract.js";
import {
  associateCustomerReport, generateCustomerContent, resolveCustomerContinuation,
  runCustomerContractTurn, validateCustomerTurnMemory,
} from "../src/commercial-intelligence/turn-contract-runtime.js";
import { validateCustomerConversationContext } from "../src/commercial-intelligence/conversation-context.js";
import { customerReadQueryKey } from "../src/commercial-intelligence/customer-chat-evidence.js";
import { CUSTOMER_TURN_CASES, SYNTHETIC_CUSTOMER_SNAPSHOT as snapshot } from "./fixtures/customer-turn-cases.js";

function component(category = "report.client_statement", extra = {}) {
  return {
    id: "c1", category, text: "El cliente sospecha que envían datos privados por correo.",
    object: "opportunity", topic: "motivación", scope: "single", reference: "Renovación Alfa",
    attribution: "client", certainty: "suspected", explicitAction: category.startsWith("action."),
    dependsOn: [], continuationOf: "none", ...extra,
  };
}
function contract(components = [component()], extra = {}) {
  return { version: 1, movement: "new_request", resolution: "resolved", clarificationQuestion: "", confidence: "high", components, ...extra };
}
function engine(answer, type = "informational", extra = {}) {
  return { response: { answer, responseType: type, operations: [], evidence: [], ...extra }, qualityTrace: { toolsUsed: [], diagnostics: {} } };
}
const reportArgs = () => ({
  component: component(), snapshot, routing: { serverResolvedEntityIds: { opportunityId: 9101 } },
  readToolResults: [{ toolName: "getOpportunity", result: { id: 9101 } }],
  authorizedToolNames: new Set(["getOpportunityReadiness"]), user: { id: 0 }, jobId: 0,
});

describe("Customer turn contract", () => {
  it("covers exactly the agreed 44 categories and 13 dialogue movements", () => {
    expect(CUSTOMER_TURN_CATEGORIES).toHaveLength(44);
    expect(new Set(CUSTOMER_TURN_CATEGORIES.map((item) => item.code)).size).toBe(44);
    expect(CUSTOMER_DIALOGUE_MOVEMENTS).toHaveLength(13);
    expect(CUSTOMER_TURN_CASES.map((item) => item.category)).toEqual(CUSTOMER_TURN_CATEGORIES.map((item) => item.code));
  });
  it.each(CUSTOMER_TURN_CASES)("validates and maps $category without inventing execution", ({ category, object }) => {
    const item = component(category, { object });
    expect(customerTurnContractSchema.safeParse(contract([item])).success).toBe(true);
    const capability = customerComponentCapability(item);
    expect(capability.verifier).toBe(category.split(".")[0]);
    if (capability.available && category.startsWith("action.")) expect(capability.operationKind).toBeTruthy();
    if (!capability.available) expect(capability.intent).toBeFalsy();
  });
  it.each(CUSTOMER_DIALOGUE_MOVEMENTS)("validates dialogue movement %s independently of purpose", (movement) => {
    expect(customerTurnContractSchema.safeParse(contract(undefined, { movement })).success).toBe(true);
  });
  it("requires a valid explicit action, unique IDs and acyclic dependencies", () => {
    expect(customerTurnContractSchema.safeParse(contract([component("action.create_record", { explicitAction: false })])).success).toBe(false);
    expect(customerTurnContractSchema.safeParse(contract([component(), component()])).success).toBe(false);
    expect(customerTurnContractSchema.safeParse(contract([component("query.record_list", { dependsOn: ["c2"] })])).success).toBe(false);
    expect(customerTurnContractSchema.safeParse(contract(undefined, { resolution: "clarification" })).success).toBe(false);
  });
  it("enables all users in on mode and preserves rollback and pilot isolation", () => {
    expect(customerTurnContractEnabled({ customerTurnContractMode: "on" }, 1)).toBe(true);
    expect(customerTurnContractEnabled({ customerTurnContractMode: "on" }, 999999)).toBe(true);
    expect(customerTurnContractEnabled({ customerTurnContractMode: "off", customerTurnContractPilotUserIds: [1] }, 1)).toBe(false);
    expect(customerTurnContractEnabled({ customerTurnContractMode: "pilot", customerTurnContractPilotUserIds: [1] }, 1)).toBe(true);
    expect(customerTurnContractEnabled({ customerTurnContractMode: "pilot", customerTurnContractPilotUserIds: [1] }, 2)).toBe(false);
    expect(customerTurnContractEnabled({ customerTurnContractMode: "invalid", customerTurnContractPilotUserIds: [] }, 1)).toBe(false);
  });
  it("does not confuse unavailable CRM objects with implemented actions", () => {
    expect(customerComponentCapability(component("action.create_record", { object: "account" })).available).toBe(false);
    expect(customerComponentCapability(component("query.document_content", { object: "document" })).available).toBe(false);
    expect(customerComponentCapability(component("action.send_communication")).available).toBe(false);
  });
  it("B6 cannot turn reported information or a question into an operation", () => {
    const plan = constrainCustomerComponentPlan({ mode: "operation", queries: ["crm_operation"], operationKind: "activity", activityDraft: { action: "prepare" } }, component());
    expect(plan).toMatchObject({ mode: "read_only", queries: ["opportunity_guidance"], operationKind: "none", activityDraft: { action: "none" } });
    expect(constrainCustomerComponentPlan({ mode: "read_only", queries: [] }, component("action.create_record")))
      .toMatchObject({ mode: "operation", operationKind: "create_opportunity", queries: ["crm_operation"] });
  });
  it("B3 validates provider output and includes custom guidance without a legacy fallback", async () => {
    const classifyWithAI = vi.fn().mockResolvedValue({
      ...contract(), components: [{ ...component(), explicitAction: "no" }],
    });
    const result = await interpretCustomerTurn({
      question: component().text, classifierPrompt: { instruction: "Personalizada" }, snapshot, user: { id: 0 }, classifyWithAI,
    });
    expect(result).toEqual(contract());
    expect(classifyWithAI.mock.calls[0][0].context.classifierGuidance.instruction).toBe("Personalizada");
    classifyWithAI.mockResolvedValue({ ...contract(), components: [{ ...component(), category: "invalid" }] });
    await expect(interpretCustomerTurn({ question: "x", classifierPrompt: { instruction: "" }, classifyWithAI }))
      .rejects.toMatchObject({ code: "CUSTOMER_TURN_CONTRACT_INVALID" });
  });
  it("preserves a report through selection instead of replacing it with the clarification answer", () => {
    const memory = { contract: contract(), pendingComponentIds: ["c1"] };
    const next = resolveCustomerContinuation(contract([component("query.field_value", { text: "la primera", reference: "la primera" })], { movement: "select_candidate" }), memory);
    expect(next.components[0]).toMatchObject({ category: "report.client_statement", text: component().text, reference: "la primera" });
    expect(validateCustomerConversationContext({ accountId: 9001, turnMemory: memory }, snapshot, 9001).turnMemory).toEqual(memory);
    expect(validateCustomerConversationContext({ accountId: 9999, turnMemory: memory }, snapshot, 9001)).toBeNull();
    expect(validateCustomerTurnMemory({ contract: contract(), pendingComponentIds: ["c9"] })).toBeNull();
  });
  it("restores a unique pending component when B3 returns only a selection movement", async () => {
    const turnMemory = { contract: contract(), pendingComponentIds: ["c1"] };
    const interpreted = await interpretCustomerTurn({
      question: "La primera pregunta", snapshot,
      classifierPrompt: { instruction: "" },
      conversationContext: { accountId: 9001, turnMemory },
      classifyWithAI: vi.fn().mockResolvedValue(contract([], { movement: "select_candidate" })),
    });
    expect(interpreted.components[0]).toMatchObject({
      category: "report.client_statement", text: component().text,
      continuationOf: "c1", reference: "La primera pregunta",
    });
  });
  it("keeps historical continuation separate from same-turn dependencies", async () => {
    const interpreted = await interpretCustomerTurn({
      question: "Corrijo el reporte: falta responsable.", snapshot,
      classifierPrompt: { instruction: "" },
      conversationContext: { accountId: 9001, turnMemory: { contract: contract(), pendingComponentIds: ["c1"] } },
      classifyWithAI: vi.fn().mockResolvedValue(contract([
        component(undefined, { continuationOf: "c1", dependsOn: ["c1"] }),
      ], { movement: "correct" })),
    });
    expect(interpreted.components[0].dependsOn).toEqual([]);
    expect(interpreted.components[0].continuationOf).toBe("c1");
  });
  it("keeps supplied documents across clarification without inventing a CRM document reader", async () => {
    const referenceMaterial = { name: "synthetic.txt", text: "Material sintético sobre necesidades comerciales." };
    const first = await runCustomerContractTurn({
      contract: contract([component("content.summary", { object: "document" })]),
      question: "resumen", referenceMaterial,
      executeComponent: vi.fn().mockResolvedValue(engine("¿Qué parte?", "clarification")),
    });
    expect(first.turnMemory.referenceMaterial).toEqual(referenceMaterial);
    const executeComponent = vi.fn().mockResolvedValue(engine("Resumen"));
    await runCustomerContractTurn({
      contract: contract([component("content.summary", { object: "document", continuationOf: "c1" })], { movement: "answer_clarification" }),
      question: "la necesidad", conversationContext: { turnMemory: first.turnMemory }, executeComponent,
    });
    expect(executeComponent.mock.calls[0][0].referenceMaterial).toEqual(referenceMaterial);
    expect(customerComponentCapability(component("query.document_content", { object: "document" })).available).toBe(false);
    expect(customerComponentCapability(component("query.document_content", { object: "document" }), { hasReferenceMaterial: true }).providedDocument).toBe(true);
  });
  it("focus changes and stop do not reuse the previous report", () => {
    const next = contract([component("query.record_list")], { movement: "change_focus" });
    expect(resolveCustomerContinuation(next, { contract: contract(), pendingComponentIds: ["c1"] })).toEqual(next);
  });
  it("preserves the other pending components after selecting one draft", async () => {
    const previous = contract([
      component("action.schedule_activity", { object: "activity" }),
      component("report.client_statement", { id: "c2" }),
    ]);
    const selected = contract([component("report.client_statement", { continuationOf: "c2" })], { movement: "select_candidate" });
    const result = await runCustomerContractTurn({
      contract: selected, question: "primero el reporte",
      conversationContext: { turnMemory: { contract: previous, pendingComponentIds: ["c1", "c2"] } },
      executeComponent: vi.fn().mockResolvedValue(engine("Reporte preparado")),
    });
    expect(result.turnMemory.contract.components.map((item) => item.category)).toEqual(["action.schedule_activity"]);
    expect(result.turnMemory.pendingComponentIds).toEqual(["c1"]);
    expect(validateCustomerTurnMemory(result.turnMemory)).toEqual(result.turnMemory);
  });
  it("refuses to execute a selected component whose prerequisite is still pending", async () => {
    const previous = contract([
      component("query.field_value"),
      component("content.email_draft", { id: "c2", dependsOn: ["c1"] }),
    ]);
    const executeComponent = vi.fn();
    const result = await runCustomerContractTurn({
      contract: contract([component("content.email_draft", { continuationOf: "c2" })], { movement: "select_candidate" }),
      question: "el correo",
      conversationContext: { turnMemory: { contract: previous, pendingComponentIds: ["c1", "c2"] } },
      executeComponent,
    });
    expect(result.response.responseType).toBe("clarification");
    expect(executeComponent).not.toHaveBeenCalled();
    expect(result.turnMemory.pendingComponentIds).toEqual(["c1", "c2"]);
    expect(result.turnMemory.contract.components[1].dependsOn).toEqual(["c1"]);
  });
  it("confirmation and rationale do not erase an unfinished report", async () => {
    const turnMemory = { contract: contract(), pendingComponentIds: ["c1"] };
    const result = await runCustomerContractTurn({
      contract: contract(undefined, { movement: "confirm_execution" }), question: "confirmo",
      conversationContext: { turnMemory }, executeComponent: vi.fn(),
    });
    expect(result.turnMemory).toEqual(turnMemory);
  });
  it("report association only matches a destination, including unanswered questions", async () => {
    const classifyWithAI = vi.fn().mockResolvedValue({ match: "matched", questionIds: [9201], reason: "motivación" });
    const result = await associateCustomerReport({ ...reportArgs(), classifyWithAI });
    expect(result.stageAnswerPrefill).toMatchObject({ opportunityId: 9101, questionIds: [9201] });
    expect(result.stageAnswerPrefill.appendText).toContain(component().text);
    expect(classifyWithAI.mock.calls[0][0].schemaName).toBe("customer_account_report_destination");
    expect(classifyWithAI.mock.calls[0][0].fields.some((field) => field.key === "messageKind")).toBe(false);
    expect(result.operations).toEqual([]);
  });
  it("retains report and asks only for the missing destination on ambiguity", async () => {
    const result = await associateCustomerReport({ ...reportArgs(), classifyWithAI: vi.fn().mockResolvedValue({ match: "ambiguous", questionIds: [9201, 9202], reason: "dos destinos" }) });
    expect(result.responseType).toBe("clarification");
    expect(result.answer).toContain("No necesitas repetir");
  });
  it("rejects hallucinated or cross-account question IDs distinctly from evidence failure", async () => {
    await expect(associateCustomerReport({ ...reportArgs(), classifyWithAI: vi.fn().mockResolvedValue({ match: "matched", questionIds: [9999], reason: "inventado" }) }))
      .rejects.toMatchObject({ code: "CUSTOMER_REPORT_ASSOCIATION_INVALID" });
    const classifyWithAI = vi.fn();
    expect((await associateCustomerReport({ ...reportArgs(), readToolResults: [{ error: "failed" }], classifyWithAI })).responseType).toBe("error");
    expect(classifyWithAI).not.toHaveBeenCalled();
  });
  it("does not use closed opportunities or bypass report permissions", async () => {
    const classifyWithAI = vi.fn();
    const args = reportArgs();
    expect((await associateCustomerReport({ ...args, authorizedToolNames: new Set(), classifyWithAI })).responseType).toBe("error");
    const closed = { ...snapshot, opportunities: [{ ...snapshot.opportunities[0], commercialStatusCode: "ganada" }] };
    expect((await associateCustomerReport({ ...args, snapshot: closed, classifyWithAI })).responseType).toBe("clarification");
    expect(classifyWithAI).not.toHaveBeenCalled();
  });
  it("uses content-specific generation and fails explicitly when its audit rejects", async () => {
    const generateWithAI = vi.fn().mockResolvedValueOnce({ answer: "Borrador sintético" }).mockResolvedValueOnce({ approved: "no" });
    const result = await generateCustomerContent({ component: component("content.email_draft"), readToolResults: [], history: [], user: { id: 0 }, generateWithAI });
    expect(result.responseType).toBe("error");
    expect(result.operations).toEqual([]);
  });
  it("returns every compound component and preserves dependencies on failure", async () => {
    const executeComponent = vi.fn().mockResolvedValueOnce(engine("Necesito aclaración", "clarification"));
    const result = await runCustomerContractTurn({
      contract: contract([component("query.field_value"), component("content.email_draft", { id: "c2", dependsOn: ["c1"] })]),
      question: "consulta y correo", context: {}, executeComponent,
    });
    expect(executeComponent).toHaveBeenCalledTimes(1);
    expect(result.response.components.map((item) => item.status)).toEqual(["clarification", "clarification"]);
    expect(result.turnMemory.pendingComponentIds).toEqual(["c1", "c2"]);
  });
  it("does not invoke capabilities for unsupported requests, stop or execution confirmations", async () => {
    const executeComponent = vi.fn();
    for (const movement of ["stop", "confirm_execution"]) {
      const result = await runCustomerContractTurn({ contract: contract(undefined, { movement }), question: "sí", executeComponent });
      expect(result.response.operations).toEqual([]);
      expect(result.turnMemory.pendingComponentIds).toEqual([]);
    }
    const result = await runCustomerContractTurn({ contract: contract([component("action.send_communication")]), question: "envía", executeComponent });
    expect(result.response.components[0].status).toBe("unavailable");
    expect(executeComponent).not.toHaveBeenCalled();
  });
  it("deduplicates reads by tool and normalized arguments, not just tool name", () => {
    expect(customerReadQueryKey({ toolName: "getOpportunity", queryArgs: { opportunityId: 1, accountId: 2 } }))
      .toBe(customerReadQueryKey({ toolName: "getOpportunity", queryArgs: { accountId: 2, opportunityId: 1 } }));
    expect(customerReadQueryKey({ toolName: "getOpportunity", queryArgs: { opportunityId: 1 } }))
      .not.toBe(customerReadQueryKey({ toolName: "getOpportunity", queryArgs: { opportunityId: 2 } }));
  });
});
