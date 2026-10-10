import { describe, expect, it, vi } from "vitest";
vi.mock("../src/coach/service.js", () => ({
  getCoachSession: vi.fn(),
  setCoachPendingQuestion: vi.fn().mockResolvedValue(null),
}));
vi.mock("../src/coach/observability.js", async (importOriginal) => ({
  ...(await importOriginal()),
  recordCoachTurnQualityTrace: vi.fn().mockResolvedValue(4),
}));
import { runCoachJob } from "../src/coach/agent-gateway.js";
import { COACH_INTENT_CATALOG } from "../src/coach/intent-governance.js";
import { getCoachBusinessRules } from "../src/coach/business-rules.js";

async function run(auditStatus = "supported", question = "¿Qué cuenta es?") {
  const query = vi.fn().mockResolvedValue({ affectedRows: 1 });
  const appendCoachSessionTurn = vi.fn().mockResolvedValue(null);
  const persistCoachOperations = vi.fn().mockResolvedValue([]);
  const loadCoachBusinessRules = vi.fn(async ({ channel, process }) =>
    getCoachBusinessRules({ channel, process }),
  );
  const requestMiAgentJson = vi.fn(async ({ phase }) => {
    if (phase === "coach_intent_route")
      return {
        intent: "account_query",
        mode: "brief_context",
        confidence: 0.9,
        reads: [{ toolName: "searchAccounts", filters: {} }],
      };
    if (phase === "coach_evidence_assessment") return { status: "sufficient" };
    if (phase === "coach_answer_audit") return { status: auditStatus };
    return {
      intent: "context_query",
      responseType: "informational",
      answer: "Cuenta autorizada",
      evidence: ["searchAccounts: 7"],
      operations: [],
    };
  });
  await runCoachJob({
    jobId: 31,
    sessionId: 12,
    user: { id: 7, permissionSet: new Set(["cuentas.read"]) },
    question,
    selectedContext: { accountId: 7 },
    dependencies: {
      query,
      appendCoachSessionTurn,
      persistCoachOperations,
      coachBlockPipelineEnabled: true,
      loadCoachBusinessRules,
      loadCoachIntentCatalog: async () => COACH_INTENT_CATALOG,
      loadAdministrativeRules: async () => [],
      loadProcessGuide: async () => "Proceso comercial autorizado",
      buildCoachPrompt: () => ({ input: [] }),
      requestMiAgentJson,
      normalizeCoachResult: (result) => ({
        ...result,
        entities: { accountId: 7 },
      }),
      resolveCoachResponseContext: (snapshot, context) => ({
        context,
        changed: false,
      }),
      prepareReadModel: async () => ({
        effectiveContext: { accountId: 7 },
        questionContextTransition: { changed: false },
        scopedSnapshot: { accounts: [{ id: 7 }] },
        modelSnapshot: {},
        selectedOpportunity: null,
        clarification: null,
        conversationHistory: [],
        explicitEntities: {},
        readToolResults: [],
      }),
      executeReadTool: () => ({
        toolName: "searchAccounts",
        result: [{ id: 7 }],
      }),
    },
  });
  const failure = query.mock.calls.find(([sql]) =>
    sql.includes("status = 'failed'"),
  );
  if (failure) throw new Error(`Coach gateway failed: ${failure[1][0]}`);
  return {
    query,
    appendCoachSessionTurn,
    persistCoachOperations,
    loadCoachBusinessRules,
  };
}

describe("Coach blocks job persistence", () => {
  it("persists B2–B11 execution and the session without changing storage contracts", async () => {
    const result = await run();
    expect(result.loadCoachBusinessRules).toHaveBeenCalledWith({
      channel: "coach",
      process: "brief_context",
    });
    expect(result.appendCoachSessionTurn).toHaveBeenCalledTimes(2);
    const finalWrite = result.query.mock.calls.find(([sql]) =>
      sql.includes("SET status = 'completed'"),
    );
    const response = JSON.parse(finalWrite[1][0]);
    const observability = JSON.parse(finalWrite[1][1]);
    expect(response.coachArchitecture.version).toBe("coach_blocks_v1");
    expect(observability.executionTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "B2",
          to: "B3",
          input: expect.objectContaining({
            interactionMode: "brief_context",
            policyProcess: "brief_context",
          }),
        }),
        expect.objectContaining({
          from: "B3",
          to: "B2",
          output: expect.objectContaining({
            interactionMode: "brief_context",
            policyProcess: "brief_context",
          }),
        }),
      ]),
    );
    expect(
      observability.executionTrace.some(
        (event) => event.from === "B2" && event.to === "B3",
      ),
    ).toBe(true);
    expect(
      observability.executionTrace.some(
        (event) => event.from === "B3" && event.to === "B4",
      ),
    ).toBe(true);
    expect(
      observability.executionTrace.some(
        (event) =>
          event.from === "B11" &&
          event.to === "B3" &&
          event.status === "completed",
      ),
    ).toBe(true);
    expect(
      observability.executionTrace.every((event) => event.channel === "coach"),
    ).toBe(true);
  });

  it("loads seller coaching policy for portfolio-priority requests", async () => {
    const result = await run(
      "supported",
      "¿Qué oportunidades debería priorizar?",
    );
    expect(result.loadCoachBusinessRules).toHaveBeenCalledWith({
      channel: "coach",
      process: "seller_coaching",
    });
  });
  it("persists an error without proposed operations when final audit rejects", async () => {
    const result = await run("unsupported");
    expect(result.persistCoachOperations.mock.calls[0][0].operations).toEqual(
      [],
    );
    const finalWrite = result.query.mock.calls.find(([sql]) =>
      sql.includes("SET status = 'completed'"),
    );
    expect(JSON.parse(finalWrite[1][0]).responseType).toBe("error");
  });
});
