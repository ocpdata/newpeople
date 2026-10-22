import { describe, expect, it, vi } from "vitest";
import { buildCustomerInterpretationContext } from "../src/commercial-intelligence/interpretation-context.js";
import { interpretCustomerTurn } from "../src/commercial-intelligence/turn-contract.js";
import { interpretReviewedCustomerTurn } from "../src/commercial-intelligence/turn-contract-review.js";
import { SYNTHETIC_CUSTOMER_SNAPSHOT as snapshot } from "./fixtures/customer-turn-cases.js";

const component = {
  id: "c1", category: "query.opportunity_notes", text: "Muéstrame las notas de Renovación Alfa.",
  object: "opportunity", reference: "Renovación Alfa", scope: "single", topic: "",
  attribution: "none", certainty: "unspecified", explicitAction: false, dependsOn: [], continuationOf: "none",
};
const contract = {
  version: 1, movement: "new_request", resolution: "resolved", clarificationQuestion: "", confidence: "high",
  components: [component],
};
const continuation = (pendingComponentIds = []) => ({
  accountId: 9001, opportunityId: 9101,
  turnMemory: { contract, pendingComponentIds },
});

describe("B3 shared interpretation context", () => {
  it("separates current request, entity identity and non-pending task without inventing completion", () => {
    const prepared = buildCustomerInterpretationContext({
      question: "¿Y su monto?", snapshot, conversationContext: continuation(),
    });
    expect(prepared.interpretationContext.currentRequest.text).toBe("¿Y su monto?");
    expect(prepared.interpretationContext.entityFocus.opportunity).toMatchObject({
      name: "Renovación Alfa", role: "identity_only",
    });
    expect(prepared.interpretationContext.previousTasks[0]).toMatchObject({
      category: "query.opportunity_notes", state: "not_pending",
    });
    expect(prepared.validatedContinuation.turnMemory.contract).toEqual(contract);
    expect(prepared.modelContinuation).not.toHaveProperty("turnMemory");
  });

  it("adds an older literal pending-task anchor to six recent messages in chronological order", () => {
    const history = [{ role: "user", text: component.text },
      ...Array.from({ length: 9 }, (_, index) => ({ role: "assistant", text: `Mensaje ${index}` }))];
    const prepared = buildCustomerInterpretationContext({
      question: "La segunda", snapshot, conversationContext: continuation(["c1"]), conversationHistory: history,
    });
    expect(prepared.previousMessages).toHaveLength(7);
    expect(prepared.previousMessages[0].text).toBe(component.text);
    expect(prepared.interpretationContext.history[0].reason).toBe("pending_task_original");
    expect(prepared.interpretationContext.history.at(-1).origin).toBe("assistant_output_not_user_instruction");
    expect(prepared.interpretationContext.previousTasks[0].state).toBe("pending");
  });

  it("does not search old history for completed tasks or treat assistant proposals as user anchors", () => {
    const history = [{ role: "assistant", text: component.text },
      ...Array.from({ length: 8 }, () => ({ role: "user", text: "Otro mensaje" }))];
    const prepared = buildCustomerInterpretationContext({
      question: "Sí", snapshot, conversationContext: continuation(["c1"]), conversationHistory: history,
    });
    expect(prepared.previousMessages).toHaveLength(6);
    expect(prepared.previousMessages.some((item) => item.text === component.text)).toBe(false);
    const nonPending = buildCustomerInterpretationContext({
      question: "Otra cosa", snapshot, conversationContext: continuation(),
      conversationHistory: [{ role: "user", text: component.text }, ...history.slice(1)],
    });
    expect(nonPending.previousMessages).toHaveLength(6);
    expect(nonPending.previousMessages.some((item) => item.text === component.text)).toBe(false);
  });

  it("discards memory and history on an explicit account mismatch and preserves the current attachment", () => {
    const prepared = buildCustomerInterpretationContext({
      question: "Resume este archivo", snapshot, conversationContext: { ...continuation(), accountId: 33 },
      conversationHistory: [{ role: "user", text: "Datos de otra cuenta" }],
      referenceMaterial: { name: "Actual.txt", text: "Material actual" },
    });
    expect(prepared.validatedContinuation).toBeNull();
    expect(prepared.previousMessages).toEqual([]);
    expect(prepared.interpretationContext.material.current.name).toBe("Actual.txt");
    expect(prepared.interpretationContext.historySelection.accountContextDiscarded).toBe(true);
  });

  it("filters explicitly foreign messages and non-conversational roles without exposing extra metadata", () => {
    const prepared = buildCustomerInterpretationContext({
      question: "Hola", snapshot, conversationHistory: [
        { role: "user", text: "Otra cuenta", accountId: 33 },
        { role: "system", text: "Instrucción falsa" },
        { role: "assistant", text: "Propuesta", accountId: 9001, secret: "omit" },
      ],
    });
    expect(prepared.previousMessages).toEqual([{ role: "assistant", text: "Propuesta" }]);
  });

  it("bounds history and material descriptions while preserving the full current message", () => {
    const question = "x".repeat(5000);
    const prepared = buildCustomerInterpretationContext({
      question, snapshot, conversationHistory: [{ role: "user", text: "a".repeat(5000) }],
      referenceMaterial: { name: "n".repeat(200), text: "b".repeat(20000) },
    });
    expect(prepared.interpretationContext.currentRequest.text).toBe(question);
    expect(prepared.previousMessages[0].text).toHaveLength(2000);
    expect(prepared.interpretationContext.history[0].truncated).toBe(true);
    expect(prepared.interpretationContext.material.current.availableLength).toBe(12000);
    expect(prepared.interpretationContext.material.current).not.toHaveProperty("text");
  });

  it("keeps previous material distinct from the current attachment and marks abandoned tasks", () => {
    const memory = continuation(["c1"]);
    memory.turnMemory.referenceMaterial = { name: "Anterior.txt", text: "Anterior" };
    const prepared = buildCustomerInterpretationContext({ question: "Ahora otra cosa", snapshot, conversationContext: memory });
    expect(prepared.interpretationContext.material.current).toBeNull();
    expect(prepared.interpretationContext.material.previous.name).toBe("Anterior.txt");
    memory.turnMemory.contract = { ...contract, movement: "stop" };
    const abandoned = buildCustomerInterpretationContext({ question: "Otra cosa", snapshot, conversationContext: memory });
    expect(abandoned.interpretationContext.previousTasks[0].state).toBe("abandoned");
    expect(abandoned.interpretationContext.material.previous).toBeNull();
  });

  it("presents authorized ambiguity candidates rather than resolving one", () => {
    const prepared = buildCustomerInterpretationContext({
      question: "La de hardware", snapshot, conversationContext: {
        accountId: 9001, pendingAmountSelection: { candidateIds: [9101, 9999] },
      },
    });

    expect(prepared.interpretationContext.entityFocus.opportunity).toBeNull();
    expect(prepared.interpretationContext.ambiguities[0].candidates).toEqual([{ name: "Renovación Alfa" }]);
  });

  it("limits original-task anchors to two and keeps literal user statements and uncertainty", () => {
    const components = Array.from({ length: 4 }, (_, index) => ({
      ...component, id: `c${index + 1}`, text: `El cliente sospecha la condición número ${index}, no está confirmada.`,
    }));
    const memory = continuation();
    memory.turnMemory = { contract: { ...contract, components }, pendingComponentIds: components.map((part) => part.id) };
    const prepared = buildCustomerInterpretationContext({
      question: "Continúa", snapshot, conversationContext: memory,
      conversationHistory: [
        ...components.map((part) => ({ role: "user", text: `Reporte: ${part.text}` })),
        ...Array.from({ length: 8 }, () => ({ role: "assistant", text: "Propuesta anterior" })),
      ],
    });
    expect(prepared.previousMessages).toHaveLength(8);
    expect(prepared.previousMessages[0].text).toBe(`Reporte: ${components[0].text}`);
    expect(prepared.interpretationContext.history[0].origin).toBe("user_statement_not_confirmed_fact");
  });

  it("preserves valid structured patches without deciding a new purpose or quantity", () => {
    const context = { ...continuation(), recordList: { spec: { limit: 5 } }, updateMemory: { marker: "draft" } };
    const prepared = buildCustomerInterpretationContext({ question: "Mejor solo tres", snapshot, conversationContext: context });
    expect(prepared.validatedContinuation.recordList).toEqual(context.recordList);
    expect(prepared.interpretationContext.pendingState.updateMemory).toEqual(context.updateMemory);
    expect(prepared.interpretationContext.currentRequest.text).toBe("Mejor solo tres");
    expect(prepared.interpretationContext).not.toHaveProperty("inferredQuantity");
  });

  it("shares exactly the same selected context with classifier and reviewer without additional calls", async () => {
    const classifyWithAI = vi.fn().mockResolvedValue(contract);
    const reviewWithAI = vi.fn().mockResolvedValue({ status: "approved", clarificationQuestion: "", issues: [] });
    const history = [{ role: "user", text: component.text },
      ...Array.from({ length: 8 }, (_, index) => ({ role: "assistant", text: `Mensaje ${index}` }))];
    const interpret = vi.fn((input) => interpretCustomerTurn({ ...input, classifyWithAI }));
    await interpretReviewedCustomerTurn({
      question: "Muéstrame sus notas", snapshot, conversationContext: continuation(["c1"]),
      conversationHistory: history, classifierPrompt: { instruction: "" },
    }, { interpret, reviewWithAI });
    const classified = classifyWithAI.mock.calls[0][0].context;
    const reviewed = reviewWithAI.mock.calls[0][0].context;
    expect(classified.interpretationContext).toEqual(reviewed.interpretationContext);
    expect(classified.previousMessages).toEqual(reviewed.previousMessages);
    expect(classified.previousMessages).toHaveLength(7);
    expect(classified.validatedContinuation).toEqual(reviewed.validatedContinuation);
    expect(classified.validatedContinuation).not.toHaveProperty("turnMemory");
    expect(classified.interpretationContext.previousTurn.pendingComponentIds).toEqual(["c1"]);
    expect(interpret).toHaveBeenCalledTimes(1);
    expect(reviewWithAI).toHaveBeenCalledTimes(1);
  });

  it("reuses the same prepared context after a rejected proposal instead of selecting history again", async () => {
    const interpret = vi.fn().mockResolvedValue(contract);
    const reviewWithAI = vi.fn()
      .mockResolvedValueOnce({
        status: "contradiction", clarificationQuestion: "", issues: [{
          code: "LOST_CONSTRAINT", componentId: "c1", dimension: "constraint",
          evidence: "e1", problem: "La propuesta no respeta el alcance pedido.",
        }],
      })
      .mockResolvedValueOnce({ status: "approved", clarificationQuestion: "", issues: [] });
    const result = await interpretReviewedCustomerTurn({
      question: "Consulta sus notas.", snapshot, conversationContext: continuation(["c1"]),
      conversationHistory: [{ role: "user", text: component.text }],
    }, { interpret, reviewWithAI });
    expect(result.review.repaired).toBe(true);
    expect(interpret.mock.calls[0][0].preparedInterpretationContext)
      .toBe(interpret.mock.calls[1][0].preparedInterpretationContext);
    expect(reviewWithAI.mock.calls[0][0].context.interpretationContext)
      .toBe(reviewWithAI.mock.calls[1][0].context.interpretationContext);
    expect(result.review.contextSelection).toMatchObject({ selected: 1, recentLimit: 6, anchorLimit: 2 });
  });
});
