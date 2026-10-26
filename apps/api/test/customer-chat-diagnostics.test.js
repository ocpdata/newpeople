import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db.js", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("../src/settings.js", () => ({ getCommercialSettings: vi.fn().mockResolvedValue({ businessTimezone: "America/Mexico_City" }) }));
vi.mock("../src/commercial-intelligence/schema.js", () => ({ ensureCommercialIntelligenceSchema: vi.fn() }));
vi.mock("../src/coach/channel-intent-governance.js", () => ({ loadChannelIntentConfigurations: vi.fn().mockResolvedValue([]) }));
vi.mock("../src/coach/semantic-classifier-prompts.js", async (original) => ({
  ...(await original()), loadSemanticClassifierPrompt: vi.fn().mockResolvedValue({ instruction: "", version: 0 }),
}));
vi.mock("../src/structuredWebResearch.js", () => ({
  runStructuredTextResearch: vi.fn().mockResolvedValue(null), runStructuredWebResearch: vi.fn(),
}));
vi.mock("../src/coach/observability.js", () => ({ recordCoachTurnQualityTrace: vi.fn().mockResolvedValue(1) }));
vi.mock("../src/commercial-intelligence/activity-draft-persistence.js", () => ({
  persistCustomerActivityDraft: vi.fn().mockResolvedValue(null), loadCustomerPendingActivity: vi.fn(),
}));
vi.mock("../src/commercial-intelligence/customer-chat-adapter.js", async (original) => ({
  ...(await original()), createCustomerAccountAdapter: vi.fn(),
}));
// The dossier engine answers consultations; these cases exercise diagnostics of the action path behind it.
const real = vi.hoisted(() => ({}));
vi.mock("../src/commercial-intelligence/dossier/engine.js", async (original) => {
  const actual = await original();
  real.runCustomerDossierTurn = actual.runCustomerDossierTurn;
  return { ...actual, runCustomerDossierTurn: vi.fn() };
});
vi.mock("../src/commercial-intelligence/turn-contract-review.js", async (original) => {
  const actual = await original();
  real.interpretReviewedCustomerTurn = actual.interpretReviewedCustomerTurn;
  return { ...actual, interpretReviewedCustomerTurn: vi.fn() };
});

import { query, withTransaction } from "../src/db.js";
import { config } from "../src/config.js";
import { runStructuredTextResearch } from "../src/structuredWebResearch.js";
import { createCustomerAccountAdapter } from "../src/commercial-intelligence/customer-chat-adapter.js";
import { runCustomerDossierTurn } from "../src/commercial-intelligence/dossier/engine.js";
import { interpretReviewedCustomerTurn } from "../src/commercial-intelligence/turn-contract-review.js";
import {
  getCustomerAccountChatSession,
  getCustomerIntelligenceJob,
  processCustomerAccountChatJob,
} from "../src/commercial-intelligence/service.js";

const originalEnvironment = config.nodeEnv;
const actionContract = {
  version: 1, movement: "new_request", resolution: "resolved", clarificationQuestion: "", confidence: "high",
  components: [{
    id: "c1", category: "action.record_note", text: "Registra la nota", object: "opportunity", topic: "",
    scope: "single", reference: "", attribution: "none", certainty: "unspecified", explicitAction: true,
    dependsOn: [], continuationOf: "none",
  }],
};
const useRealB3 = () => interpretReviewedCustomerTurn.mockImplementation(real.interpretReviewedCustomerTurn);
const originalConversationalEnabled = config.features.customerConversationalResponseEnabled;
const user = { id: 31, permissionSet: new Set(["cuentas.read"]) };
let writes;

beforeEach(() => {
  config.features.customerConversationalResponseEnabled = false;
  vi.clearAllMocks();
  runCustomerDossierTurn.mockResolvedValue({ handled: false, reason: "action_task", plan: null });
  interpretReviewedCustomerTurn.mockResolvedValue({ contract: actionContract, review: { status: "approved" } });
  writes = [];
  query.mockImplementation(async (sql, params) => {
    if (sql.startsWith("SELECT * FROM customer_intelligence_jobs")) return [{
      id: 1, account_id: 7, requested_by_user_id: 31,
      request_json: JSON.stringify({ question: "Resume la cuenta", chatSessionId: 2 }),
    }];
    if (sql.includes("SELECT history_json, context_json")) return [{ history_json: "[]", context_json: null }];
    if (sql.includes("FROM accounts a")) return [{ id: 7, name: "Totalplay", status_code: "activada" }];
    if (sql.includes("UPDATE")) writes.push({ sql, params });
    return [];
  });
  withTransaction.mockImplementation(async (work) => work({
    query: async (sql, params) => [await query(sql, params)],
  }));
  createCustomerAccountAdapter.mockReturnValue({
    availableTools: [], permissions: user.permissionSet,
    channelRules: {}, operationPolicy: {},
    runTurn: vi.fn().mockResolvedValue({
      response: { answer: "Resumen de Totalplay", responseType: "informational", confidence: "high", operations: [], evidence: [] },
      qualityTrace: { validationStatus: "valid", toolsUsed: [], toolMetrics: [], diagnostics: {} },
    }),
  });
});

afterEach(() => {
  config.nodeEnv = originalEnvironment;
  config.features.customerConversationalResponseEnabled = originalConversationalEnabled;
});

describe.each(["development", "production"])("Customer chat diagnostics in %s", (environment) => {
  beforeEach(() => { config.nodeEnv = environment; });

  it("returns and persists diagnostics with the completed execution trace", async () => {
    const job = await processCustomerAccountChatJob({ jobId: 1, user });
    expect(job.status).toBe("completed");
    expect(job.result.debug).toMatchObject({
      architecture: "account_chat_v1",
      currentTurn: { jobId: 1, chatSessionId: 2 },
      issue: { title: "El turno terminó sin señales de error" },
    });

    describe("Customer chat diagnostic visibility", () => {
      const debug = { issue: { severity: "success", title: "Destino del reporte validado" } };
      const stageAnswerPrefill = { opportunityId: 11, questionIds: [21], appendText: "Reporte" };

      it.each([
        ["without support permission", [], false],
        ["administrator without support permission", ["mi_coach.admin"], false],
        ["with support permission", ["mi_coach.chat_diagnostics"], true],
      ])("filters jobs and stored history %s", async (_label, permissions, allowed) => {
        const viewer = { id: 31, permissionSet: new Set(permissions) };
        const result = { answer: "Borrador preparado", debug, qualityTraceId: 99, stageAnswerPrefill };
        for (const status of ["completed", "failed"]) {
          query.mockResolvedValueOnce([{
            id: 1, job_type: "account_chat", requested_by_user_id: 31,
            status, result_json: JSON.stringify(result),
          }]).mockResolvedValueOnce([]);
          const job = await getCustomerIntelligenceJob({ user: viewer, jobId: 1 });
          expect(job.result).toEqual(allowed ? result : {
            answer: result.answer, stageAnswerPrefill,
          });
        }
        const message = { role: "assistant", text: result.answer, turnDebug: debug, qualityTraceId: 99, stageAnswerPrefill };
        query.mockResolvedValueOnce([{
          id: 2, account_id: 7, history_json: JSON.stringify([message]),
        }]);
        const session = await getCustomerAccountChatSession({ user: viewer, sessionId: 2 });
        expect(session.history).toEqual([allowed ? message : {
          role: "assistant", text: result.answer, stageAnswerPrefill,
        }]);
      });
    });
    expect(job.result.debug.executionTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Retorno de persistencia", status: "completed" }),
      expect.objectContaining({ label: "Retornar resultado del worker", status: "completed" }),
    ]));
    const historyWrite = writes.filter(({ sql }) => sql.includes("SET history_json")).at(-1);
    expect(JSON.parse(historyWrite.params[0]).at(-1).turnDebug).toEqual(job.result.debug);
    const jobWrite = writes.find(({ sql }) => sql.includes("status = 'completed'"));
    expect(JSON.parse(jobWrite.params[0]).debug).toEqual(job.result.debug);
  });

  it("stores failure diagnostics when persistence fails", async () => {
    withTransaction.mockRejectedValueOnce(new Error("Test persistence failure"));
    expect(await processCustomerAccountChatJob({ jobId: 1, user })).toBeNull();
    const failureWrite = writes.find(({ sql }) => sql.includes("status = 'failed'"));
    expect(JSON.parse(failureWrite.params[1]).debug).toMatchObject({
      issue: { block: "B11", title: "Falló la persistencia del turno" },
      executionTrace: expect.arrayContaining([
        expect.objectContaining({ label: "Retorno de persistencia", status: "failed" }),
      ]),
    });
  });

  it.each([
    [true, "results", 5],
    [true, "no_results", 0],
    [false, "not_applicable", 0],
  ])("pairs B12 input and output for requested=%s and status=%s", async (requested, status, snippetsCount) => {
    const adapter = createCustomerAccountAdapter();
    createCustomerAccountAdapter.mockImplementationOnce(({ executionTrace }) => {
      adapter.runTurn.mockImplementationOnce(async () => {
        for (const retrieval of [
          { requested: !requested, status: "results", snippetsCount: 5 },
          { requested, status, snippetsCount },
        ]) {
          await executionTrace.span(
            {
              from: "B4", to: "B12",
              label: "Recuperar conocimiento documental",
              input: { requested: retrieval.requested },
            },
            async () => ({ status: retrieval.status, snippetsCount: retrieval.snippetsCount }),
            (result) => result,
          );
        }
        return {
          response: { answer: "Resumen de Totalplay", responseType: "informational", operations: [], evidence: [] },
          qualityTrace: {
            validationStatus: "valid", toolsUsed: [], toolMetrics: [],
            diagnostics: { documentKnowledge: { status: "results", snippetsCount: 5 } },
          },
        };
      });
      return adapter;
    });

    const job = await processCustomerAccountChatJob({ jobId: 1, user });
    expect(job.status).toBe("completed");
    expect(job.result.debug.flow.find((item) => item.block === "B12")).toMatchObject({
      status,
      input: { requested },
      output: { status, snippetsCount },
    });
    const historyWrite = writes.filter(({ sql }) => sql.includes("SET history_json")).at(-1);
    expect(JSON.parse(historyWrite.params[0]).at(-1).turnDebug).toEqual(job.result.debug);
    const jobWrite = writes.find(({ sql }) => sql.includes("status = 'completed'"));
    expect(JSON.parse(jobWrite.params[0]).debug).toEqual(job.result.debug);
  });

  it("persists explicit B3 timeout metadata without executing the business pipeline", async () => {
    useRealB3();
    runStructuredTextResearch.mockRejectedValueOnce(Object.assign(new Error("Request aborted"), { name: "TimeoutError" }));
    expect(await processCustomerAccountChatJob({ jobId: 1, user, deadlineAt: Date.now() + 2000 })).toBeNull();
    const failureWrite = writes.find(({ sql }) => sql.includes("status = 'failed'"));
    const result = JSON.parse(failureWrite.params[1]);
    expect(result.errorCode).toBe("CUSTOMER_B3_TIMEOUT");
    expect(result.debug.currentTurn.diagnostics.classificationFailure).toMatchObject({
      code: "CUSTOMER_B3_TIMEOUT", contractVersion: "compact-v7", durationMs: expect.any(Number),
    });
    expect(result.debug.currentTurn.diagnostics.classificationFailure.timeoutMs).toBeLessThanOrEqual(2000);
    expect(createCustomerAccountAdapter).not.toHaveBeenCalled();
  });

  it("persists the cause of a dossier engine failure without exposing it to the seller", async () => {
    runCustomerDossierTurn.mockImplementationOnce(real.runCustomerDossierTurn);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await processCustomerAccountChatJob({ jobId: 1, user, deadlineAt: Date.now() + 5000 })).toBeNull();
    consoleError.mockRestore();
    const failureWrite = writes.find(({ sql }) => sql.includes("status = 'failed'"));
    expect(failureWrite.params[0]).toBe("No pude completar la consulta con los registros del CRM. Intenta nuevamente.");
    const result = JSON.parse(failureWrite.params[1]);
    expect(result.debug.currentTurn.diagnostics).toMatchObject({ failureStage: "dossier_engine",
      dossierFailure: { code: "DOSSIER_ENGINE_FAILED", causeName: expect.any(String), cause: expect.any(String) } });
  });

  it.each([
    ["report_destination_validated", "informational", "success", "pass", "Destino del reporte validado"],
    ["report_destination_clarification", "clarification", "warning", "warning", "El destino del reporte necesita una precisión"],
    ["report_destination_failed", "error", "error", "error", "No se pudo validar el destino del reporte"],
    ["content_validated", "informational", "success", "pass", "Contenido generado y auditado"],
    ["verified_authorized_read", "informational", "success", "pass", "El turno terminó sin señales de error"],
    ["content_failed", "error", "error", "error", "El contenido no pudo validarse"],
    ["unknown_status", "informational", "error", "error", "La evidencia no quedó verificada"],
    ["query_error", "error", "error", "error", "El turno no pudo completarse"],
    ["activity_entities_validated", "informational", "success", "pass", "El turno terminó sin señales de error"],
  ])("persists the correct panel for %s", async (status, responseType, severity, checkState, title) => {
    const adapter = createCustomerAccountAdapter();
    adapter.runTurn.mockResolvedValueOnce({
      response: { answer: "Resultado del verificador", responseType, operations: [], evidence: [] },
      qualityTrace: {
        validationStatus: "valid", toolsUsed: [], toolMetrics: [],
        diagnostics: {
          evidence: { status },
          ...(status === "content_failed" ? {
            content: { stage: "audit", reasonCode: "insufficient_document_support", repaired: true },
          } : {}),
        },
      },
    });
    const job = await processCustomerAccountChatJob({ jobId: 1, user });
    expect(job.status).toBe("completed");
    expect(job.result.debug.issue).toMatchObject({
      severity, title,
      ...(["activity_entities_validated", "verified_authorized_read"].includes(status) ? {} : { block: "B9" }),
    });
    expect(job.result.debug.flow.find((item) => item.block === "B9").checks)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ field: "evidenceStatus", state: checkState, actual: status }),
      ]));
    if (status === "content_failed") {
      expect(job.result.debug.flow.find((item) => item.block === "B9").output.content)
        .toMatchObject({ stage: "audit", reasonCode: "insufficient_document_support", repaired: true });
    }
    if (status === "report_destination_validated") {
      expect(job.result.debug.issue.message).toContain("no verifica su veracidad");
    }
    const historyWrite = writes.filter(({ sql }) => sql.includes("SET history_json")).at(-1);
    expect(JSON.parse(historyWrite.params[0]).at(-1).turnDebug).toEqual(job.result.debug);
    const jobWrite = writes.find(({ sql }) => sql.includes("status = 'completed'"));
    expect(JSON.parse(jobWrite.params[0]).debug).toEqual(job.result.debug);
  });

  it("retains an execution trace when preparation fails", async () => {
    query.mockResolvedValueOnce([{
      id: 1, account_id: 7, requested_by_user_id: 31,
      request_json: JSON.stringify({ question: "Resume la cuenta", chatSessionId: 2 }),
    }]).mockResolvedValueOnce([]);
    expect(await processCustomerAccountChatJob({ jobId: 1, user })).toBeNull();
    expect(createCustomerAccountAdapter).not.toHaveBeenCalled();
    const failureWrite = writes.find(({ sql }) => sql.includes("status = 'failed'"));
    expect(JSON.parse(failureWrite.params[1]).debug).toMatchObject({
      issue: { block: "B3", title: "Falló la preparación del turno" },
      executionTrace: expect.arrayContaining([
        expect.objectContaining({ label: "Retornar fallo de preparación", status: "failed" }),
      ]),
    });
  });

  it("blocks execution and persists a review failure in B3 diagnostics", async () => {
    useRealB3();
    runStructuredTextResearch.mockImplementation(async (request) => {
      if (request.schemaName === "customer_account_turn_contract") return {
        version: 1, movement: "new_request", resolution: "resolved", clarificationQuestion: "", confidence: "high",
        components: [{
          id: "c1", category: "query.account_summary", text: "Resume la cuenta",
          object: "account", topic: "", scope: "single", reference: "Totalplay",
          attribution: "none", certainty: "unspecified", dependsOn: [], continuationOf: "none",
        }],
      };
      return null;
    });
    try {
      expect(await processCustomerAccountChatJob({ jobId: 1, user })).toBeNull();
      expect(createCustomerAccountAdapter).not.toHaveBeenCalled();
      const failureWrite = writes.find(({ sql }) => sql.includes("status = 'failed'"));
      const saved = JSON.parse(failureWrite.params[1]);
      expect(JSON.stringify(saved)).toContain("CUSTOMER_B3_REVIEW_FAILED");
      expect(saved.debug.issue.block).toBe("B3");
      expect(saved.debug.currentTurn.diagnostics.classificationFailure.reviewFailure)
        .toMatchObject({ kind: "invalid_review", attempt: 2,
          receivedReview: { receivedType: "null" },
          validationIssues: [{ code: "invalid_type", path: [], message: expect.any(String) }],
          previousFailures: [{ kind: "invalid_review", attempt: 1 }],
        });
      expect(runStructuredTextResearch.mock.calls.filter(([request]) =>
        request.schemaName === "customer_account_turn_coherence")).toHaveLength(2);
    } finally {
      runStructuredTextResearch.mockReset().mockResolvedValue(null);
    }
  });

  it("includes successful coherence review in the persisted classification trace", async () => {
    useRealB3();
    runStructuredTextResearch.mockImplementation(async (request) => {
      if (request.schemaName === "customer_account_turn_contract") return {
        version: 1, movement: "new_request", resolution: "resolved", clarificationQuestion: "", confidence: "high",
        components: [{
          id: "c1", category: "query.account_summary", text: "Resume la cuenta",
          object: "account", topic: "", scope: "single", reference: "Totalplay",
          attribution: "none", certainty: "unspecified", dependsOn: [], continuationOf: "none",
        }],
      };
      if (request.schemaName === "customer_account_turn_coherence") return {
        status: "approved", clarificationQuestion: "", issues: [],
      };
      return null;
    });
    try {
      const job = await processCustomerAccountChatJob({ jobId: 1, user });
      expect(job.status).toBe("completed");
      const classification = job.result.debug.executionTrace.find((event) =>
        event.label === "Clasificar intención de la solicitud" && event.phase === "return");
      expect(classification.output.coherenceReview).toMatchObject({
        status: "approved", attempts: 1, repaired: false,
        checks: [{ comparison: { coverage: true, support: true, fidelity: true } }],
      });
      const jobWrite = writes.find(({ sql }) => sql.includes("status = 'completed'"));
      expect(JSON.parse(jobWrite.params[0]).debug).toEqual(job.result.debug);
    } finally {
      runStructuredTextResearch.mockReset().mockResolvedValue(null);
    }
  });

  it.each([true, false])("persists the final B10 answer and its audit/degradation status: supported=%s", async (supported) => {
    useRealB3();
    config.features.customerConversationalResponseEnabled = true;
    const natural = "Totalplay tiene la información disponible para revisar.";
    runStructuredTextResearch.mockImplementation(async (request) => {
      if (request.schemaName === "customer_account_turn_contract") return {
        version: 1, movement: "new_request", resolution: "resolved", clarificationQuestion: "", confidence: "high",
        components: [{ id: "c1", category: "query.account_summary", text: "Resume la cuenta", object: "account",
          topic: "", scope: "single", reference: "Totalplay", attribution: "none", certainty: "unspecified",
          dependsOn: [], continuationOf: "none" }],
      };
      if (request.schemaName === "customer_account_turn_coherence") return {
        status: "approved", clarificationQuestion: "", issues: [],
      };
      if (request.schemaName === "customer_account_conversational_response") return { answer: natural };
      if (request.schemaName === "customer_account_conversational_audit") return {
        status: supported ? "supported" : "unsupported", reasons: supported ? [] : ["Falta información."],
        checks: { faithfulness: true, coverage: supported, uncertainty: true, operationState: true, conversation: true },
      };
      return null;
    });
    try {
      const job = await processCustomerAccountChatJob({ jobId: 1, user });
      expect(job.status).toBe("completed");
      expect(job.result.answer).toBe(supported ? natural : "Resumen de Totalplay");
      expect(job.result.presentation.status).toBe(supported ? "completed" : "degraded");
      const b10 = job.result.debug.flow.find((item) => item.block === "B10");
      expect(b10.output.conversationalPresentation).toMatchObject({
        status: supported ? "completed" : "degraded", calls: 2,
      });
      if (!supported) expect(job.result.debug.issue).toMatchObject({ block: "B10", severity: "warning" });
      const historyWrite = writes.filter(({ sql }) => sql.includes("SET history_json")).at(-1);
      const finalMessage = JSON.parse(historyWrite.params[0]).at(-1);
      expect(finalMessage.text).toBe(job.result.answer);
      expect(finalMessage.presentation).toEqual(job.result.presentation);
      const jobWrite = writes.find(({ sql }) => sql.includes("status = 'completed'"));
      expect(JSON.parse(jobWrite.params[0]).answer).toBe(job.result.answer);
    } finally {
      runStructuredTextResearch.mockReset().mockResolvedValue(null);
    }
  });
});
