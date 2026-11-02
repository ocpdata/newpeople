import { describe, expect, it, vi } from "vitest";
import { COACH_OPERATION_NOT_AVAILABLE_ANSWER, COACH_OUT_OF_SCOPE_ANSWER, withoutOwnQuota, coerceCreateOperationPayloads, createCoachBlockPipeline, normalizePlannedReads, operationNotPrepared, withCoachCounts } from "../src/coach/block-pipeline.js";
import {
  createCoachBlockTrace,
  serializeCoachDates,
  withCoachDeadline,
} from "../src/coach/block-runtime.js";
import { COACH_INTENT_CATALOG } from "../src/coach/intent-governance.js";

function fixture({
  plan = {},
  assessments = [],
  audit = { status: "supported" },
  reads = {},
  mode = "brief_context",
  coachIntentClassification = null,
  guide = "Guía autorizada: confirmar necesidades antes de avanzar",
  limits,
  history = [],
  responseType = "informational",
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
      responseType,
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
      buildCoachPrompt: vi.fn(() => ({ input: [{ role: "system", content: "Sistema" }] })),
      normalizeCoachResult: vi.fn((result) => ({ ...result, responseType: "informational" })),
    },
    user: { id: 31 },
    businessRules: {
      operationPolicy: { sourceChannel: "coach", allowedKinds: ["activity"] },
    },
    trace,
    jobId: 9,
    question: "¿Qué debo revisar?",
    history,
    context: { accountId: 7 },
    coachIntentClassification,
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
  it("una propuesta de operación no se descarta por campos que se completan al confirmar", async () => {
    const assessment = { status: "incomplete", missingTools: [], missingFacts: ["hora de la actividad"] };
    const operation = fixture({ mode: "operation", plan: { intent: "operation" }, assessments: [assessment] });
    await run(operation);
    expect(operation.pipeline.diagnostics.evidence.status).toBe("sufficient_for_operation");
    const query = fixture({ assessments: [assessment] });
    await run(query);
    expect(query.pipeline.diagnostics.evidence.status).toBe("insufficient_evidence");
    const coaching = fixture({ mode: "coaching", plan: { intent: "seller_coaching" }, assessments: [assessment] });
    await run(coaching);
    expect(coaching.pipeline.diagnostics.evidence.status).toBe("sufficient_for_coaching");
  });

  it("dice que no encontró el registro cuando las lecturas salieron vacías", () => {
    expect(operationNotPrepared("¿Cómo va X?", "brief_context", true)).toContain("No encontré ningún registro");
    expect(operationNotPrepared("¿Cómo va X?", "brief_context", false)).toContain("evidencia autorizada");
  });

  it("pide una vez más la operación cuando una propuesta llega sin ella", async () => {
    const operation = fixture({ mode: "operation", plan: { intent: "operation" } });
    await run(operation);
    expect(operation.calls.filter((item) => item.phase === "coach")).toHaveLength(2);
    const query = fixture();
    await run(query);
    expect(query.calls.filter((item) => item.phase === "coach")).toHaveLength(1);
  });

  it("el servidor cuenta las lecturas para que el modelo no cuente a mano", () => {
    const counted = withCoachCounts({
      toolName: "searchOpportunities",
      result: [{ commercialStatusCode: "ganada" }, { commercialStatusCode: "ganada" }, { commercialStatusCode: "perdida" }, {}],
    });
    expect(counted).toMatchObject({ resultCount: 4, countsByCommercialStatus: { ganada: 2, perdida: 1, sin_estado: 1 } });
    expect(counted.totalAmountUsd).toBeUndefined();
    expect(withCoachCounts({ toolName: "searchOpportunities", result: [{ amountUsd: 100.5 }, { amountUsd: 20 }, { amountUsd: null }] }).totalAmountUsd).toBe(120.5);
    expect(withCoachCounts({ toolName: "getOpportunity", result: { id: 1 } })).toEqual({ toolName: "getOpportunity", result: { id: 1 } });
    expect(withCoachCounts({ toolName: "x", result: [{ id: 1 }] }).countsByCommercialStatus).toBeUndefined();
  });

  it("una pregunta general sin respaldo del CRM se responde como fuera de alcance, no como error", async () => {
    const f = fixture({
      mode: "coaching",
      plan: { intent: "general_query" },
      reads: { searchAccounts: [] },
      audit: { status: "unsupported", unsupportedClaims: ["París"] },
    });
    const result = await run(f);
    expect(result.response.responseType).toBe("clarification");
    expect(result.response.answer).toBe(COACH_OUT_OF_SCOPE_ANSWER);
    expect(result.qualityTrace.validationStatus).toBe("clarification");
  });

  it("coloca en payload los campos de una creación que el modelo dejó junto a kind", () => {
    const [created, withPayload, activity] = coerceCreateOperationPayloads([
      { kind: "create_opportunity", accountId: 22, name: "Renovación de red", title: "Crear oportunidad" },
      { kind: "create_contact", accountId: 22, payload: { firstName: "Ana" } },
      { kind: "activity", opportunityId: 5, title: "Llamar" },
    ]);
    expect(created.payload).toEqual({ accountId: 22, name: "Renovación de red" });
    expect(created).toEqual({ kind: "create_opportunity", accountId: 22, title: "Crear oportunidad", payload: { accountId: 22, name: "Renovación de red" } });
    expect(withPayload.payload).toEqual({ firstName: "Ana" });
    expect(activity.payload).toBeUndefined();
    expect(coerceCreateOperationPayloads(undefined)).toBeUndefined();
  });

  it("una propuesta que la política del canal dejó sin operación se corrige en lugar de prometer algo que no existe", async () => {
    const f = fixture({ mode: "operation", plan: { intent: "operation" }, responseType: "action_proposal" });
    const result = await run(f);
    expect(result.response.answer).toBe(COACH_OPERATION_NOT_AVAILABLE_ANSWER);
    expect(result.response.responseType).toBe("informational");
  });

  it("retira la cuota propia del contexto cuando la lectura de desempeño es la fuente", () => {
    const snapshot = { quota: { gapAmount: 343563 }, currencyConversion: { available: true }, pipeline: { openCount: 1 } };
    expect(withoutOwnQuota(snapshot, [{ toolName: "getSellerPerformance", result: {} }])).toEqual({ pipeline: { openCount: 1 } });
    expect(withoutOwnQuota(snapshot, [{ toolName: "getSellerPipeline", result: {} }])).toBe(snapshot);
    expect(withoutOwnQuota(snapshot, [{ toolName: "getSellerPerformance", error: true }])).toBe(snapshot);
  });

  it("explica qué no hace Coach cuando no puede preparar una operación", () => {
    expect(operationNotPrepared("Marca como ganada la oportunidad X", "operation")).toContain("no cierra oportunidades");
    expect(operationNotPrepared("Cierra como perdida la oportunidad X", "operation")).toContain("no cierra oportunidades");
    expect(operationNotPrepared("Crea una actividad", "operation")).toContain("no se cambió ningún registro");
    expect(operationNotPrepared("¿Cuántas hay?", "brief_context")).toContain("evidencia autorizada");
  });

  it("le recuerda al modelo el idioma que pidió el vendedor", () => {
    const withLanguage = fixture({ history: [{ role: "seller", text: "A partir de ahora responde en inglés." }] });
    expect(withLanguage.pipeline.hooks.buildPrompt({}).input[0].content).toContain("Idioma pedido por el vendedor: inglés");
    const plain = fixture();
    expect(plain.pipeline.hooks.buildPrompt({}).input[0].content).toBe("Sistema");
  });

  it("normaliza los códigos de estado que propone el planificador", () => {
    expect(
      normalizePlannedReads([
        { toolName: "searchOpportunities", filters: { commercialStatusCodes: ["Ganada", " En proceso "], stageCodes: ["Contacto-Inicial"], openOnly: true } },
      ]),
    ).toEqual([
      { toolName: "searchOpportunities", filters: { commercialStatusCodes: ["ganada", "en_proceso"], stageCodes: ["contacto_inicial"], openOnly: true } },
    ]);
    expect(normalizePlannedReads(undefined)).toBeUndefined();
    expect(normalizePlannedReads([{ toolName: "x" }])).toEqual([{ toolName: "x" }]);
  });

  it("respalda con lo que el servidor leyó una respuesta del modelo sin hechos", async () => {
    const f = fixture();
    await run(f);
    const bare = f.pipeline.hooks.normalizeResponse({ answer: "La cuenta está autorizada", facts: [] });
    expect(bare.facts).toEqual([
      expect.objectContaining({ sourceType: "account", label: "Lectura autorizada: searchAccounts" }),
    ]);
    const listed = f.pipeline.hooks.normalizeResponse({
      answer: "La cuenta está autorizada",
      facts: [{ sourceType: "account", sourceId: 7, label: "Cuenta", excerpt: "Autorizada" }],
    });
    expect(listed.facts).toEqual([expect.objectContaining({ label: "Cuenta" })]);
    expect(f.pipeline.hooks.normalizeResponse({ answer: "", facts: [] }).facts).toEqual([]);
  });

  it("respalda con la guía autorizada una respuesta de coaching sin lecturas del CRM", async () => {
    const f = fixture({ mode: "coaching", plan: { intent: "seller_coaching" }, reads: { searchAccounts: [] } });
    await run(f);
    expect(f.pipeline.hooks.normalizeResponse({ answer: "Prioriza el seguimiento", facts: [] }).facts).toEqual([
      expect.objectContaining({ sourceType: "process_guide" }),
    ]);
  });

  it("no inventa hechos cuando la lectura no devolvió datos", async () => {
    const f = fixture({ reads: { searchAccounts: [] } });
    await run(f);
    expect(f.pipeline.hooks.normalizeResponse({ answer: "Sin datos", facts: [] }).facts).toEqual([]);
  });

  it("uses B6's resolved intent to constrain the planner's proposed reads", async () => {
    const f = fixture({
      coachIntentClassification: {
        decisionTrace: {
          finalDecision: { intent: "account_query" },
          semanticDecision: { confidence: 0.9 },
        },
      },
      plan: {
        intent: "seller_coaching",
        mode: "coaching",
        reads: [{ toolName: "searchOpportunities", filters: {} }],
      },
    });

    const plan = await f.pipeline.hooks.classifyCoachIntentWithModel({
      catalog: COACH_INTENT_CATALOG,
    });

    expect(plan.intent).toBe("account_query");
    expect(plan.mode).toBe("brief_context");
    expect(plan.reads).toEqual([]);
  });

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

describe("fechas de las aclaraciones de Coach", () => {
  it("serializa las fechas de MySQL como yyyy-mm-dd", () => {
    expect(
      serializeCoachDates({
        candidates: [{ id: 1, closeDate: new Date("2027-01-31T00:00:00.000Z") }, { id: 2, closeDate: null }],
        invalid: new Date("nope"),
      }),
    ).toEqual({ candidates: [{ id: 1, closeDate: "2027-01-31" }, { id: 2, closeDate: null }], invalid: null });
  });
});
