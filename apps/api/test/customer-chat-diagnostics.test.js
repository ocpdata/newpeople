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

import { query, withTransaction } from "../src/db.js";
import { config } from "../src/config.js";
import { createCustomerAccountAdapter } from "../src/commercial-intelligence/customer-chat-adapter.js";
import {
  getCustomerAccountChatSession,
  getCustomerIntelligenceJob,
  processCustomerAccountChatJob,
} from "../src/commercial-intelligence/service.js";

const originalEnvironment = config.nodeEnv;
const originalContractMode = config.features.customerTurnContractMode;
const user = { id: 31, permissionSet: new Set(["cuentas.read"]) };
let writes;

beforeEach(() => {
  config.features.customerTurnContractMode = "off";
  vi.clearAllMocks();
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
  config.features.customerTurnContractMode = originalContractMode;
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
    ["report_destination_validated", "informational", "success", "pass", "Destino del reporte validado"],
    ["report_destination_clarification", "clarification", "warning", "warning", "El destino del reporte necesita una precisión"],
    ["report_destination_failed", "error", "error", "error", "No se pudo validar el destino del reporte"],
    ["content_validated", "informational", "success", "pass", "Contenido generado y auditado"],
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
        diagnostics: { evidence: { status } },
      },
    });
    const job = await processCustomerAccountChatJob({ jobId: 1, user });
    expect(job.status).toBe("completed");
    expect(job.result.debug.issue).toMatchObject({
      severity, title,
      ...(status === "activity_entities_validated" ? {} : { block: "B9" }),
    });
    expect(job.result.debug.flow.find((item) => item.block === "B9").checks)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ field: "evidenceStatus", state: checkState, actual: status }),
      ]));
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
});
