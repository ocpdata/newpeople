import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), ai: vi.fn(), audit: vi.fn(), mutate: vi.fn() }));
vi.mock("../src/db.js", () => ({ query: mocks.query, withTransaction: vi.fn() }));
vi.mock("../src/audit.js", () => ({ logAuditEvent: mocks.audit }));
vi.mock("../src/opportunity-audit.js", () => ({ mutateAuditedOpportunity: mocks.mutate }));
vi.mock("../src/opportunityStageAnswerSuggestions.js", () => ({
  isOpportunityStageAnswerSuggestionsEnabled: () => true, validateOpportunityCurrentStageWithAi: mocks.ai,
}));
import { executeOpportunityCurrentStageValidation } from "../src/opportunity-stage-validations/service.js";
describe("A08 preserves the existing stage validator without changing its decisions or automatic advancement", () => {
  const context = {
    opportunityState: { id: 3, sales_stage_id: 1, sales_stage_code: "negotiation", sales_stage_name: "Negociación" },
    salesStage: { id: 1, code: "negotiation", name: "Negociación" },
    currentAnswers: [{ question_id: 1, is_required: 1, answer_value: "Respuesta completa" }], documents: [],
  };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockImplementation(async (sql) => sql.includes("WHERE is_active = 1")
      ? [{ id: 1, code: "negotiation", name: "Negociación", stage_order: 1 }, { id: 2, code: "waiting", name: "Waiting", stage_order: 2 }] : []);
    mocks.audit.mockResolvedValue(1);
  });
  it.each(["ready_to_advance", "advance_with_caution", "not_ready_to_advance"])(
    "retains original behavior for %s, even with complete answers", async (decision) => {
      const validation = { decision, summary: "Evaluación existente", reasons: ["Evidencia evaluada"], suggestions: [] };
      mocks.ai.mockResolvedValue(validation);
      const result = await executeOpportunityCurrentStageValidation({ opportunityId: 3, note: "", user: { id: 7 }, context });
      expect(mocks.ai).toHaveBeenCalledExactlyOnceWith({
        salesStage: context.salesStage, questions: context.currentAnswers, documents: context.documents,
      });
      expect(result.validation).toMatchObject(validation);
      expect(result.autoAdvanced).toBe(decision === "ready_to_advance");
      if (decision === "ready_to_advance") {
        expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ opportunityId: 3 }),
          expect.stringContaining("SET sales_stage_id = ?"), [2, 7, expect.any(Date), 3]);
        expect(result.advancedSalesStage).toEqual({ id: 2, code: "waiting", name: "Waiting" });
      } else {
        expect(mocks.mutate).not.toHaveBeenCalled();
        expect(result.advancedSalesStage).toBeNull();
      }
    });
  it("propagates an AI failure instead of replacing it with answers-complete approval", async () => {
    mocks.ai.mockRejectedValue(new Error("Validador no disponible"));
    await expect(executeOpportunityCurrentStageValidation({ opportunityId: 3, user: { id: 7 }, context })).rejects.toThrow("Validador no disponible");
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
});
