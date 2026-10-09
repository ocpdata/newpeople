import { describe, expect, it, vi } from "vitest";
import { createCoachBlockPipeline } from "../src/coach/block-pipeline.js";
import {
  createCoachBlockTrace,
  withCoachDeadline,
} from "../src/coach/block-runtime.js";
import { COACH_INTENT_CATALOG } from "../src/coach/intent-governance.js";

function fixture({
  plan = {},
  assessments = [],
  audit = { status: "supported" },
  reads = {},
  mode = "brief_context",
  guide = "Guía autorizada: confirmar necesidades antes de avanzar",
  limits,
} = {}) {
  const calls = [];
  const requestMiAgentJson = vi.fn(async (request) => {
    calls.push(request);
    if (request.phase === "coach_intent_route")
      return {
        intent: "account_query",
        mode,
        confidence: 0.9,
        reads: [{ toolName: "searchAccounts", filters: {} }],
        ...plan,
      };
    if (request.phase === "coach_evidence_assessment")
      return (
        assessments.shift() || {
          status: "sufficient",
          missingTools: [],
          missingFacts: [],
        }
      );
    if (request.phase === "coach_answer_audit") return audit;
    return {
      answer: "La cuenta está autorizada",
      responseType: "informational",
      evidence: ["searchAccounts"],
      operations: [],
    };
  });
  const executeReadTool = vi.fn(({ toolName }) => ({
    toolName,
    result: reads[toolName] ?? [{ id: 7, name: "Cuenta" }],
  }));
  const prepareReadModel = vi.fn(async (input) => ({
    effectiveContext: { accountId: 7 },
    scopedSnapshot: { accounts: [{ id: 7 }] },
    modelSnapshot: {},
    readToolResults: [],
    clarification: null,
    ...input.mockResult,
  }));
  const trace = createCoachBlockTrace({ jobId: 9 });
  const pipeline = createCoachBlockPipeline({
    dependencies: {
      requestMiAgentJson,
      executeReadTool,
      prepareReadModel,
      loadProcessGuide: async () => guide,
      buildStageReadiness: vi.fn(),
    },
    user: { id: 31 },
    businessRules: {
      operationPolicy: { sourceChannel: "coach", allowedKinds: ["activity"] },
    },
    trace,
    jobId: 9,
    question: "¿Qué debo revisar?",
    history: [],
    context: { accountId: 7 },
    limits,
  });
  return { pipeline, trace, calls, executeReadTool, prepareReadModel };
}

async function run(f, tools = ["searchAccounts"]) {
  const plan = await f.pipeline.hooks.classifyCoachIntentWithModel({
    catalog: COACH_INTENT_CATALOG,
  });
  await f.pipeline.hooks.prepareReadModel({
    availableTools: tools.map((name) => ({ name })),
    intentRouting: { mode: plan.mode },
  });
  await f.pipeline.hooks.loadProcessGuide();
  const response = await f.pipeline.hooks.requestResponse({
    payload: { input: [] },
    phase: "coach",
  });
  return f.pipeline.finalize({
    response,
    activeContext: { accountId: 7 },
    qualityTrace: { validationStatus: "valid" },
  });
}

describe("Coach B6–B10 pipeline", () => {
  it("plans, reads, verifies, synthesizes and audits with call/return traces", async () => {
    const f = fixture();
    const result = await run(f);
    expect(result.response.answer).toContain("autorizada");
    expect(f.calls.map((item) => item.phase)).toEqual([
      "coach_intent_route",
      "coach_evidence_assessment",
      "coach",
      "coach_answer_audit",
    ]);
    expect(
      f.trace.events
        .filter((item) => item.phase === "call")
        .map((item) => item.to),
    ).toEqual(expect.arrayContaining(["B6", "B7", "B8", "B9", "B10"]));
    expect(f.pipeline.diagnostics.answerAudit.status).toBe("supported");
  });
  it("requests missing authorized evidence and assesses it again", async () => {
    const f = fixture({
      plan: { intent: "seller_coaching", mode: "coaching" },
      assessments: [
        {
          status: "incomplete",
          missingTools: ["searchOpportunities"],
          missingFacts: ["Oportunidades"],
        },
        { status: "sufficient" },
      ],
    });
    const result = await run(f, ["searchAccounts", "searchOpportunities"]);
    expect(result.response.responseType).toBe("informational");
    expect(f.executeReadTool).toHaveBeenCalledTimes(2);
    expect(f.pipeline.diagnostics.evidence.rounds).toBe(1);
    expect(
      f.trace.events.some((item) => item.from === "B9" && item.to === "B7"),
    ).toBe(true);
  });
  it("never executes tools invented by the planner or verifier", async () => {
    const f = fixture({
      plan: { reads: [{ toolName: "deleteAccount", filters: {} }] },
      assessments: [{ status: "incomplete", missingTools: ["deleteAccount"] }],
    });
    const result = await run(f);
    expect(f.executeReadTool).not.toHaveBeenCalled();
    expect(result.response.responseType).toBe("clarification");
    expect(result.response.operations).toEqual([]);
  });
  it("rejects model-provided CRM IDs in planned filters", async () => {
    const f = fixture({
      plan: {
        reads: [{ toolName: "searchAccounts", filters: { accountId: 999 } }],
      },
    });
    const plan = await f.pipeline.hooks.classifyCoachIntentWithModel({
      catalog: COACH_INTENT_CATALOG,
    });
    expect(plan.intent).toBe("clarification");
    expect(f.pipeline.diagnostics.planner.status).toBe("invalid");
  });
  it("binds tool IDs to the validated server context", async () => {
    const f = fixture();
    await run(f);
    expect(f.executeReadTool.mock.calls[0][0].args.accountId).toBe(7);
    expect(f.prepareReadModel.mock.calls[0][0].availableTools).toEqual([]);
  });
  it("does not treat failed or truncated reads as empty results", async () => {
    const f = fixture({
      assessments: [{ status: "no_results" }],
      reads: { searchAccounts: [] },
    });
    f.executeReadTool.mockReturnValue({
      toolName: "searchAccounts",
      result: [],
      error: "denied",
    });
    const result = await run(f);
    expect(result.response.responseType).toBe("error");
    expect(f.calls.some((item) => item.phase === "coach")).toBe(false);
  });
  it("accepts verified zero results but not zero as sufficient facts", async () => {
    const zero = fixture({
      assessments: [{ status: "no_results" }],
      reads: { searchAccounts: [] },
      guide: "",
    });
    expect((await run(zero)).response.responseType).toBe("informational");
    const insufficient = fixture({ reads: { searchAccounts: [] }, guide: "" });
    expect((await run(insufficient)).response.responseType).toBe(
      "clarification",
    );
  });
  it("supports general coaching from an authorized guide without CRM reads", async () => {
    const f = fixture({
      mode: "coaching",
      plan: { intent: "process_information", reads: [] },
    });
    const result = await run(f, []);
    expect(result.response.responseType).toBe("informational");
    expect(f.executeReadTool).not.toHaveBeenCalled();
    const assessment = JSON.parse(
      f.calls.find((item) => item.phase === "coach_evidence_assessment").payload
        .input[1].content,
    );
    expect(assessment.processGuide).toContain("Guía autorizada");
  });
  it.each(["unsupported", "inconclusive"])(
    "removes operations after %s audit",
    async (status) => {
      const f = fixture({
        audit: { status, unsupportedClaims: ["Importe inventado"] },
      });
      const original = f.pipeline.finalize;
      f.pipeline.finalize = (result) =>
        original({
          ...result,
          response: { ...result.response, operations: [{ kind: "activity" }] },
        });
      const result = await run(f);
      expect(result.response.responseType).toBe("error");
      expect(result.response.operations).toEqual([]);
      expect(result.qualityTrace.operationsRejected).toBe(1);
    },
  );
  it("fails closed when the audit provider is unavailable", async () => {
    const f = fixture({ audit: null });
    const result = await run(f);
    expect(result.response.responseType).toBe("error");
    expect(f.pipeline.diagnostics.answerAudit.status).toBe("unavailable");
  });
  it("rejects a supported audit that still reports unsupported claims", async () => {
    const f = fixture({
      audit: { status: "supported", unsupportedClaims: ["Dato no verificado"] },
    });
    expect((await run(f)).response.responseType).toBe("error");
  });
  it("never reads CRM for a deep-exploration handoff", async () => {
    const f = fixture({
      plan: {
        intent: "account_query",
        mode: "deep_exploration",
        detailTarget: "account",
      },
    });
    const plan = await f.pipeline.hooks.classifyCoachIntentWithModel({
      catalog: COACH_INTENT_CATALOG,
    });
    expect(plan.reads).toEqual([]);
    await f.pipeline.hooks.prepareReadModel({
      availableTools: [],
      intentRouting: { mode: "deep_exploration" },
    });
    await f.pipeline.finalize({ response: { responseType: "handoff" } });
    expect(f.executeReadTool).not.toHaveBeenCalled();
    expect(f.calls).toHaveLength(1);
  });
  it("enforces the read budget and the whole-turn deadline", async () => {
    const f = fixture({
      limits: { maxTurnMs: 45000, maxReadQueries: 1, maxEvidenceRounds: 2 },
      plan: { intent: "seller_coaching", mode: "coaching" },
      assessments: [
        { status: "incomplete", missingTools: ["searchOpportunities"] },
      ],
    });
    const result = await run(f, ["searchAccounts", "searchOpportunities"]);
    expect(result.response.responseType).toBe("clarification");
    expect(f.executeReadTool).toHaveBeenCalledTimes(1);
    await expect(
      withCoachDeadline(async () => 1, Date.now() - 1),
    ).rejects.toMatchObject({ code: "coach_turn_timeout" });
  });
});
