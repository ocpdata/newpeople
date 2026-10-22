import { describe, expect, it, vi } from "vitest";
import { latestCustomerDraft, requestedCustomerQuestionCount, validateCustomerQuestions } from "../src/commercial-intelligence/customer-content-validation.js";
import { generateCustomerContent } from "../src/commercial-intelligence/turn-contract-runtime.js";

const component = { id: "c1", category: "content.discovery_questions", object: "general", reference: "",
  text: "Prepara exactamente tres preguntas generales" };
const run = (generateWithAI, overrides = {}) => generateCustomerContent({
  component, question: component.text, readToolResults: [], history: [],
  user: { id: 0 }, jobId: 0, generateWithAI, ...overrides,
});
const questions = ["¿Qué necesita resolver?", "¿Cuál es su prioridad?", "¿Cómo lo validarán?"];

describe("Final content constraints", () => {
  it.each(["Prepara tres preguntas", "Dame exactamente 3 preguntas"])("extracts scoped quantities: %s", (text) => {
    expect(requestedCustomerQuestionCount({ ...component, text })).toBe(3);
  });
  it("does not treat a quantity for another category or an ambiguous quantity as a question count", () => {
    expect(requestedCustomerQuestionCount({ ...component, category: "content.email_draft" })).toBeNull();
    expect(requestedCustomerQuestionCount({ ...component, text: "Dos preguntas o tres preguntas" })).toBeNull();
    expect(requestedCustomerQuestionCount({ ...component, text: "Preguntas para 3 clientes" })).toBeNull();
  });
  it("rejects duplicate, empty, multiline and bundled questions", () => {
    expect(validateCustomerQuestions(questions, 3)).toBe(true);
    for (const invalid of [[], ["¿Una?", "¿Una?", "¿Otra?"], ["", "¿Dos?", "¿Tres?"],
      ["¿Una?\n¿Otra?", "¿Dos?", "¿Tres?"], ["¿Una? ¿Otra?", "¿Dos?", "¿Tres?"]]) {
      expect(validateCustomerQuestions(invalid, 3)).toBe(false);
    }
  });
  it("renders exactly three questions after repairing a wrong count without CRM or RAG", async () => {
    const generate = vi.fn().mockResolvedValueOnce({ questions: questions.slice(0, 2) })
      .mockResolvedValueOnce({ questions }).mockResolvedValueOnce({ approved: "yes", reasonCode: "supported" });
    const result = await run(generate);
    expect(result.responseType).toBe("informational");
    expect(result.answer.split("\n")).toHaveLength(3);
    expect(result.contentDiagnostics).toMatchObject({ repaired: true, attempts: 2, durationMs: expect.any(Number) });
    expect(generate.mock.calls[1][0].context.correction.reasonCode).toBe("quantity_mismatch");
    expect(generate.mock.calls[2][0].context.constraints.requestedQuestionCount).toBe(3);
    expect(generate).toHaveBeenCalledTimes(3);
  });
  it("never returns the rejected draft after a second quantity failure", async () => {
    const generate = vi.fn().mockResolvedValue({ questions: ["rechazado"] });
    const result = await run(generate);
    expect(result.responseType).toBe("error");
    expect(result.answer).not.toContain("rechazado");
    expect(result.contentDiagnostics).toMatchObject({ stage: "format", reasonCode: "quantity_mismatch", attempts: 2 });
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it.each(["lost_constraint", "attribution_changed", "uncertainty_changed", "task_coverage", "unsupported_commitment"])(
    "repairs %s once using the same source and current request, without requiring RAG", async (reasonCode) => {
      const material = { name: "Relato", text: "Según Karla, quizá revisen; no está confirmado." };
      const question = "Redacta un correo para compartir lo que dijo Karla, sin proponer reuniones.";
      const generate = vi.fn().mockResolvedValueOnce({ answer: "Karla confirmó y agendó una reunión." })
        .mockResolvedValueOnce({ approved: "no", reasonCode })
        .mockResolvedValueOnce({ answer: material.text })
        .mockResolvedValueOnce({ approved: "yes", reasonCode: "supported" });
      const result = await run(generate, { component: { ...component, category: "content.email_draft", text: question },
        question, referenceMaterial: material });
      expect(result.answer).toBe(material.text);
      expect(result.contentDiagnostics.repaired).toBe(true);
      expect(generate.mock.calls[2][0].context.referenceMaterial).toBe(material);
      expect(generate.mock.calls[2][0].context.originalRequest).toBe(question);
      expect(generate.mock.calls[2][0].context.correction.reasonCode).toBe(reasonCode);
      expect(generate).toHaveBeenCalledTimes(4);
    },
  );
  it("shares a single repair budget between quantity and semantic validation", async () => {
    const generate = vi.fn().mockResolvedValueOnce({ questions: [] }).mockResolvedValueOnce({ questions })
      .mockResolvedValueOnce({ approved: "no", reasonCode: "attribution_changed" });
    const result = await run(generate);
    expect(result.responseType).toBe("error");
    expect(generate).toHaveBeenCalledTimes(3);
  });
  it("does not retry provider failures or malformed audit output", async () => {
    const generate = vi.fn().mockRejectedValue(new Error("provider failed"));
    await expect(run(generate)).rejects.toMatchObject({ code: "CUSTOMER_CONTENT_GENERATION_FAILED" });
    expect(generate).toHaveBeenCalledTimes(1);
    generate.mockReset().mockResolvedValueOnce({ questions }).mockResolvedValueOnce({ approved: "maybe" });
    const result = await run(generate);
    expect(result.responseType).toBe("error");
    expect(result.contentDiagnostics.reasonCode).toBe("invalid_audit_output");
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it("reports an audit provider failure without retrying or returning the unvalidated draft", async () => {
    const generate = vi.fn().mockResolvedValueOnce({ questions })
      .mockRejectedValueOnce(new Error("private provider response"));
    await expect(run(generate)).rejects.toMatchObject({
      code: "CUSTOMER_CONTENT_AUDIT_FAILED",
      contentDiagnostics: { stage: "audit", reasonCode: "provider_failure", attempts: 1 },
    });
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it("rejects contradictory audit approval and empty generation without automatic retries", async () => {
    const generate = vi.fn().mockResolvedValueOnce({ questions })
      .mockResolvedValueOnce({ approved: "yes", reasonCode: "unsupported_crm_claim" });
    expect((await run(generate)).responseType).toBe("error");
    expect(generate).toHaveBeenCalledTimes(2);
    generate.mockReset().mockResolvedValue({ answer: " " });
    await expect(run(generate, { component: { ...component, category: "content.summary" } })).rejects.toMatchObject({
      code: "CUSTOMER_CONTENT_GENERATION_FAILED",
      contentDiagnostics: { stage: "generation", reasonCode: "empty_output", attempts: 1 },
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe("Effective draft source", () => {
  const draft = (text, components = [{ category: "content.email_draft", status: "completed" }]) =>
    ({ role: "assistant", text, components });
  it("uses the latest successful draft after reload rather than the original", () => {
    expect(latestCustomerDraft([draft("original"), { role: "user", text: "Más breve" }, draft("última versión")]).text)
      .toBe("última versión");
  });
  it("does not reach past a query, failed draft or mixed response to reuse stale content", () => {
    for (const last of [
      draft("consulta", [{ category: "query.field_value", status: "completed" }]),
      draft("falló", [{ category: "content.rewrite", status: "error" }]),
      draft("mezcla", [{ category: "content.email_draft", status: "completed" }, { category: "query.field_value", status: "completed" }]),
    ]) expect(latestCustomerDraft([draft("anterior"), last])).toBeNull();
  });
});
