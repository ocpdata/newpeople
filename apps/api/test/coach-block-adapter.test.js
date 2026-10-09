import { describe, expect, it, vi } from "vitest";
import {
  createCoachAdapter,
  coachBlockPipelineEnabled,
} from "../src/coach/coach-adapter.js";
import { COACH_INTENT_CATALOG } from "../src/coach/intent-governance.js";
import { getCoachBusinessRules } from "../src/coach/business-rules.js";

function dependencies({ audit = "supported", enabled = true } = {}) {
  return {
    coachBlockPipelineEnabled: enabled,
    loadCoachIntentCatalog: async () => COACH_INTENT_CATALOG,
    loadAdministrativeRules: async () => [
      {
        enabled: true,
        instruction: "Nunca afirmar envío de correos",
        title: "Correo",
      },
    ],
    loadProcessGuide: async () =>
      "Guía del proceso: verificar interés antes de avanzar",
    prepareReadModel: async () => ({
      effectiveContext: { accountId: 7 },
      questionContextTransition: { changed: false },
      scopedSnapshot: { accounts: [{ id: 7, name: "Cuenta autorizada" }] },
      preparationRequested: false,
      selectedOpportunity: null,
      deterministicStageReadiness: null,
      readToolResults: [],
      modelSnapshot: {},
      clarification: null,
      conversationHistory: [],
      explicitEntities: {},
    }),
    executeReadTool: vi.fn(() => ({
      toolName: "searchAccounts",
      result: [{ id: 7, name: "Cuenta autorizada" }],
    })),
    buildCoachPrompt: (snapshot, question) => ({
      input: [
        { role: "user", content: JSON.stringify({ snapshot, question }) },
      ],
    }),
    resolveCoachResponseContext: (snapshot, context) => ({
      context,
      changed: false,
    }),
    normalizeCoachResult: (result) => ({
      ...result,
      entities: { accountId: 7 },
      operations: result.operations || [],
      evidence: result.evidence || [],
    }),
    requestMiAgentJson: vi.fn(async ({ phase, payload }) => {
      if (phase === "coach_intent_route")
        return {
          intent: "account_query",
          mode: "brief_context",
          confidence: 0.9,
          reads: [{ toolName: "searchAccounts", filters: {} }],
        };
      if (phase === "coach_evidence_assessment") {
        const context = JSON.parse(payload.input[1].content);
        expect(context.administrativeRules[0].title).toBe("Correo");
        return { status: "sufficient", missingFacts: [], missingTools: [] };
      }
      if (phase === "coach_answer_audit")
        return { status: audit, unsupportedClaims: [] };
      return {
        intent: "context_query",
        responseType: "informational",
        answer: "La cuenta autorizada está disponible.",
        evidence: ["searchAccounts: cuenta 7"],
        operations: [],
      };
    }),
    buildStageReadiness: vi.fn(),
  };
}

describe("Coach block adapter integration", () => {
  it("runs the actual shared motor through Coach-only B6–B10 dependencies", async () => {
    const deps = dependencies();
    const adapter = createCoachAdapter({
      user: { id: 31, permissionSet: new Set(["cuentas.read"]) },
      dependencies: deps,
      businessRules: getCoachBusinessRules({ channel: "coach" }),
    });
    const result = await adapter.runTurn({
      question: "¿Cuál es esta cuenta?",
      context: { accountId: 7 },
      jobId: 8,
    });
    expect(result.response.responseType).toBe("informational");
    expect(result.response.coachArchitecture).toMatchObject({
      channel: "coach",
      version: "coach_blocks_v1",
      planner: { source: "structured_plan", fallbackUsed: false },
      evidence: { status: "sufficient" },
      answerAudit: { status: "supported" },
    });
    expect(
      result.response.coachArchitecture.executionTrace.every(
        (event) => event.channel === "coach",
      ),
    ).toBe(true);
    expect(
      deps.requestMiAgentJson.mock.calls.map(([request]) => request.phase),
    ).toEqual([
      "coach_intent_route",
      "coach_evidence_assessment",
      "coach",
      "coach_answer_audit",
    ]);
    expect(result.response.entities.accountId).toBe(7);
    expect(result.qualityTrace.diagnostics.architecture).toBe(
      "coach_blocks_v1",
    );
  });
  it("fails closed after the final motor response when the audit rejects it", async () => {
    const deps = dependencies({ audit: "unsupported" });
    const adapter = createCoachAdapter({
      user: { id: 31, permissionSet: new Set(["cuentas.read"]) },
      dependencies: deps,
    });
    const result = await adapter.runTurn({
      question: "¿Cuál es esta cuenta?",
      context: { accountId: 7 },
      jobId: 8,
    });
    expect(result.response.responseType).toBe("error");
    expect(result.response.operations).toEqual([]);
    expect(result.qualityTrace.validationStatus).toBe("error");
  });
  it("can explicitly disable Coach blocks without changing the legacy motor", async () => {
    const deps = dependencies({ enabled: false });
    deps.classifyCoachIntentWithModel = async () => ({
      intent: "account_query",
      mode: "brief_context",
      confidence: 0.9,
    });
    const adapter = createCoachAdapter({
      user: { id: 31, permissionSet: new Set(["cuentas.read"]) },
      dependencies: deps,
    });
    const result = await adapter.runTurn({
      question: "¿Cuál es esta cuenta?",
      context: { accountId: 7 },
    });
    expect(result.response.coachArchitecture).toBeUndefined();
    expect(
      deps.requestMiAgentJson.mock.calls.map(([request]) => request.phase),
    ).toEqual(["coach"]);
    expect(
      coachBlockPipelineEnabled({ coachBlockPipelineEnabled: false }),
    ).toBe(false);
  });
  it("preserves mode policies in synthesis and projects facts without inventing fields", async () => {
    const deps = dependencies();
    const original = deps.normalizeCoachResult;
    deps.normalizeCoachResult = vi.fn(original);
    const adapter = createCoachAdapter({
      user: { id: 31, permissionSet: new Set(["cuentas.read"]) },
      dependencies: deps,
    });
    const result = await adapter.runTurn({
      question: "¿Cuál es esta cuenta?",
      context: { accountId: 7 },
    });
    const synthesis = deps.requestMiAgentJson.mock.calls.find(
      ([request]) => request.phase === "coach",
    )[0];
    const input = JSON.parse(synthesis.payload.input[0].content);
    expect(input.snapshot.intentRouting.mode).toBe("brief_context");
    expect(input.snapshot.interactionModePolicy).toBeTruthy();
    expect(result.response.coachArchitecture.answerAudit.status).toBe(
      "supported",
    );
  });
  it("does not synthesize through conceptual shortcuts when the planner failed", async () => {
    const deps = dependencies();
    deps.requestMiAgentJson = vi
      .fn()
      .mockRejectedValue(new Error("planner offline"));
    const adapter = createCoachAdapter({
      user: { id: 31, permissionSet: new Set() },
      dependencies: deps,
    });
    const result = await adapter.runTurn({
      question: "¿Qué etapas tiene el proceso de ventas?",
      context: {},
    });
    expect(result.response.responseType).toBe("clarification");
    expect(result.response.operations).toEqual([]);
    expect(deps.requestMiAgentJson).toHaveBeenCalledTimes(1);
    expect(result.response.coachArchitecture.planner.status).toBe("error");
  });
  it("projects evidence facts to the strict contract and drops unsupported fact types", async () => {
    const deps = dependencies();
    const request = deps.requestMiAgentJson;
    deps.requestMiAgentJson = vi.fn(async (input) => {
      const value = await request(input);
      return input.phase === "coach"
        ? {
            ...value,
            facts: [
              {
                sourceType: "account",
                sourceId: 7,
                label: "Cuenta autorizada",
                excerpt: "Cuenta",
                extra: "not a contract field",
              },
              {
                sourceType: "invented_source",
                sourceId: 7,
                label: "No verificable",
              },
            ],
          }
        : value;
    });
    deps.normalizeCoachResult = vi.fn(deps.normalizeCoachResult);
    const adapter = createCoachAdapter({
      user: { id: 31, permissionSet: new Set(["cuentas.read"]) },
      dependencies: deps,
    });
    const result = await adapter.runTurn({
      question: "¿Cuál es esta cuenta?",
      context: { accountId: 7 },
    });
    expect(deps.normalizeCoachResult.mock.calls[0][0].facts).toEqual([
      {
        sourceType: "account",
        sourceId: 7,
        label: "Cuenta autorizada",
        excerpt: "Cuenta",
      },
    ]);
    expect(result.qualityTrace.diagnostics.responseContract.rejectedFacts).toBe(
      1,
    );
    expect(result.response.coachArchitecture.answerAudit.status).toBe(
      "supported",
    );
  });
});
