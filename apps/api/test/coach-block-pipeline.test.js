import { describe, expect, it, vi } from "vitest";
import { COACH_OPERATION_NOT_AVAILABLE_ANSWER, COACH_OUT_OF_SCOPE_ANSWER, withoutOwnQuota, coerceCreateOperationPayloads, createCoachBlockPipeline, normalizePlannedReads, operationNotPrepared, withCoachCounts } from "../src/coach/block-pipeline.js";
import {
  createCoachBlockTrace,
  isRetryableCoachError,
  serializeCoachDates,
  withCoachDeadline,
} from "../src/coach/block-runtime.js";
import { completeAnswerFromFacts } from "../src/coach/answer-completion.js";
import {
  COACH_AUDIT_UNAVAILABLE_ANSWER,
  COACH_FORMAT_FAILURE_ANSWER,
  COACH_NO_EVIDENCE_ANSWER,
  COACH_PLAN_INVALID_ANSWER,
  COACH_RESPONSE_FAILED_ANSWER,
  COACH_TIMEOUT_ANSWER,
  COACH_UNSUPPORTED_ANSWER,
  coachFailureAnswerFor,
} from "../src/coach/failure-messages.js";
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
  synthesize = null,
  failOnce = null,
} = {}) {
  const calls = [];
  let failed = false;
  const requestMiAgentJson = vi.fn(async (request) => {
    calls.push(request);
    if (failOnce && !failed && request.phase === failOnce.phase) {
      failed = true;
      throw failOnce.error;
    }
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
    if (request.phase === "coach_answer_audit")
      return typeof audit === "function" ? audit(request) : audit;
    if (synthesize) return synthesize(request);
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
    expect(operationNotPrepared("¿Cómo va X?", "brief_context", false)).toContain("No encontré en tus registros");
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
    expect(operationNotPrepared("¿Cuántas hay?", "brief_context")).toContain("No encontré en tus registros");
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
    expect(
      normalizePlannedReads([{ toolName: "searchOpportunities", filters: { text: ["Alfa", " ", "Beta"], openOnly: true } }]),
    ).toEqual([
      { toolName: "searchOpportunities", filters: { text: "Alfa", openOnly: true } },
      { toolName: "searchOpportunities", filters: { text: "Beta", openOnly: true } },
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

describe("Coach: respuestas completas, reparación y reintentos", () => {
  // Mirrors the engine: the model answer goes through normalizeResponse before the final audit.
  async function runNormalized(f) {
    const plan = await f.pipeline.hooks.classifyCoachIntentWithModel({
      catalog: COACH_INTENT_CATALOG,
    });
    await f.pipeline.hooks.prepareReadModel({
      availableTools: [{ name: "searchAccounts" }],
      intentRouting: { mode: plan.mode },
    });
    await f.pipeline.hooks.loadProcessGuide();
    const raw = await f.pipeline.hooks.requestResponse({
      payload: { input: [] },
      phase: "coach",
    });
    const response = f.pipeline.hooks.normalizeResponse(
      raw,
      {},
      "¿Qué debo revisar?",
      { accountId: 7 },
      null,
    );
    return f.pipeline.finalize({
      response,
      activeContext: { accountId: 7 },
      qualityTrace: { validationStatus: "valid", validationReasons: [] },
    });
  }
  const isRepair = (request) =>
    JSON.stringify(request.payload.input).includes("La auditoría rechazó");

  it("completa con los hechos verificados una respuesta que anuncia una lista y se detiene", async () => {
    const audits = [];
    const f = fixture({
      audit: (request) => {
        audits.push(JSON.parse(request.payload.input[1].content).proposedAnswer.answer);
        return { status: "supported" };
      },
      synthesize: () => ({
        answer: "Estas son las oportunidades con riesgo:",
        responseType: "informational",
        facts: [
          { sourceType: "opportunity", sourceId: 1, label: "Proyecto B", excerpt: "Riesgo alto" },
          { sourceType: "opportunity", sourceId: 2, label: "Proyecto C" },
        ],
        operations: [],
      }),
    });
    const result = await runNormalized(f);
    expect(result.response.answer).toBe(
      "Estas son las oportunidades con riesgo:\n\n- **Proyecto B**: Riesgo alto\n- **Proyecto C**",
    );
    expect(audits[0]).toContain("- **Proyecto B**: Riesgo alto");
  });

  it("repara una vez una respuesta no respaldada y la entrega si la nueva auditoría la acepta", async () => {
    let audits = 0;
    const f = fixture({
      audit: () =>
        ++audits === 1
          ? { status: "unsupported", unsupportedClaims: ["Monto inventado"] }
          : { status: "supported" },
      synthesize: (request) => ({
        answer: isRepair(request) ? "Solo lo que consta en el CRM" : "Monto inventado de 9 millones",
        responseType: "informational",
        operations: [],
      }),
    });
    const result = await runNormalized(f);
    expect(result.response.answer).toBe("Solo lo que consta en el CRM");
    expect(result.response.responseType).toBe("informational");
    expect(result.qualityTrace.validationReasons).toContain("coach_answer_repaired");
    expect(f.pipeline.diagnostics.repair).toEqual({ attempted: true, outcome: "repaired" });
    expect(f.calls.filter((call) => call.phase === "coach_answer_audit")).toHaveLength(2);
    const repairCall = f.calls.find(isRepair);
    expect(JSON.stringify(repairCall.payload.input)).toContain("Monto inventado");
  });

  it("si la respuesta reparada tampoco se respalda, explica qué hacer en lugar de un error genérico", async () => {
    const f = fixture({
      audit: { status: "unsupported", unsupportedClaims: ["Dato no verificado"] },
      synthesize: () => ({ answer: "Dato no verificado", responseType: "informational", operations: [] }),
    });
    const result = await runNormalized(f);
    expect(result.response.answer).toBe(COACH_UNSUPPORTED_ANSWER);
    expect(result.response.answer).toContain("registro concreto");
    expect(result.qualityTrace.validationStatus).toBe("error");
    expect(f.pipeline.diagnostics.repair).toEqual({ attempted: true, outcome: "still_unsupported" });
    expect(f.calls.filter(isRepair)).toHaveLength(1);
  });

  it("no reescribe turnos de operación ni preguntas fuera de alcance", async () => {
    const operation = fixture({
      mode: "operation",
      plan: { intent: "operation" },
      audit: { status: "unsupported", unsupportedClaims: ["x"] },
      synthesize: () => ({
        answer: "Propongo la actividad",
        responseType: "action_proposal",
        operations: [{ kind: "activity", title: "Llamar", payload: {}, evidence: [], requiresConfirmation: true }],
      }),
    });
    const result = await runNormalized(operation);
    expect(result.response.answer).toBe(COACH_UNSUPPORTED_ANSWER);
    expect(operation.calls.filter(isRepair)).toHaveLength(0);

    const general = fixture({
      mode: "coaching",
      plan: { intent: "general_query" },
      reads: { searchAccounts: [] },
      audit: { status: "unsupported", unsupportedClaims: ["París"] },
    });
    await runNormalized(general);
    expect(general.calls.filter(isRepair)).toHaveLength(0);
  });

  it("no inicia una reparación si no queda tiempo en el turno", async () => {
    const f = fixture({
      limits: { maxTurnMs: 45000, maxReadQueries: 8, maxEvidenceRounds: 2 },
      audit: () => {
        vi.setSystemTime(Date.now() + 40000);
        return { status: "unsupported", unsupportedClaims: ["x"] };
      },
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const result = await runNormalized(f);
      expect(result.response.answer).toBe(COACH_UNSUPPORTED_ANSWER);
      expect(f.calls.filter(isRepair)).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reintenta una vez un fallo transitorio del proveedor y lo registra", async () => {
    const f = fixture({
      failOnce: {
        phase: "coach_evidence_assessment",
        error: new Error("No fue posible obtener el análisis de Mi agente: HTTP 503"),
      },
    });
    const result = await run(f);
    expect(result.response.responseType).toBe("informational");
    expect(f.calls.filter((call) => call.phase === "coach_evidence_assessment")).toHaveLength(2);
    expect(f.pipeline.diagnostics.retries).toEqual(["coach_evidence_assessment"]);
  });

  it("no reintenta un rechazo por cuota ni un error del que no se puede esperar otro resultado", async () => {
    const quota = fixture({
      failOnce: {
        phase: "coach_evidence_assessment",
        error: new Error("No fue posible obtener el análisis de Mi agente: insufficient_quota HTTP 429"),
      },
    });
    const result = await run(quota);
    expect(result.response.responseType).toBe("error");
    expect(result.response.answer).toBe(COACH_RESPONSE_FAILED_ANSWER);
    expect(quota.calls.filter((call) => call.phase === "coach_evidence_assessment")).toHaveLength(1);
    expect(quota.pipeline.diagnostics.retries).toBeUndefined();
  });

  it("reintenta una vez cuando el verificador devuelve algo que no cumple su esquema", async () => {
    const answers = [{ status: "no-valido" }];
    const f = fixture({ assessments: answers });
    const result = await run(f);
    expect(result.response.responseType).toBe("informational");
    expect(f.calls.filter((call) => call.phase === "coach_evidence_assessment")).toHaveLength(2);
  });

  it("los mensajes de fallo dicen qué ocurrió y qué intentar", () => {
    expect(coachFailureAnswerFor({ code: "coach_turn_timeout" })).toBe(COACH_TIMEOUT_ANSWER);
    expect(coachFailureAnswerFor(new Error("x"))).toBe(COACH_RESPONSE_FAILED_ANSWER);
    for (const message of [
      COACH_UNSUPPORTED_ANSWER,
      COACH_FORMAT_FAILURE_ANSWER,
      COACH_AUDIT_UNAVAILABLE_ANSWER,
      COACH_TIMEOUT_ANSWER,
      COACH_RESPONSE_FAILED_ANSWER,
      COACH_NO_EVIDENCE_ANSWER,
      COACH_PLAN_INVALID_ANSWER,
    ]) {
      expect(message).toMatch(/(Inténtalo|Intenta|Reformúlala|Indica|Pregunta)/);
    }
  });

  it("completeAnswerFromFacts no toca respuestas que no terminan en dos puntos ni respuestas sin hechos", () => {
    const complete = { answer: "Todo en orden.", facts: [{ label: "A" }] };
    expect(completeAnswerFromFacts(complete)).toEqual({ response: complete, completed: 0 });
    const hollow = { answer: "Estas son:", facts: [] };
    expect(completeAnswerFromFacts(hollow)).toEqual({ response: hollow, completed: 0 });
    const many = {
      answer: "Lista:",
      facts: Array.from({ length: 20 }, (_, index) => ({ label: `R${index}` })),
    };
    expect(completeAnswerFromFacts(many).completed).toBe(12);
  });

  it("isRetryableCoachError separa fallos transitorios de los que no conviene repetir", () => {
    expect(isRetryableCoachError(new Error("La respuesta de Mi agente no tuvo un formato válido"))).toBe(true);
    expect(isRetryableCoachError(new Error("HTTP 502"))).toBe(true);
    expect(isRetryableCoachError(new Error("fetch failed"))).toBe(true);
    expect(isRetryableCoachError(Object.assign(new Error("tiempo"), { code: "coach_turn_timeout" }))).toBe(false);
    expect(isRetryableCoachError(new Error("insufficient_quota"))).toBe(false);
    expect(isRetryableCoachError(new Error("otro"))).toBe(false);
    expect(isRetryableCoachError(null)).toBe(false);
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
