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
import { processCustomerAccountChatJob } from "../src/commercial-intelligence/service.js";

const originalEnvironment = config.nodeEnv;
const user = { id: 31, permissionSet: new Set(["cuentas.read"]) };
let writes;

beforeEach(() => {
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

afterEach(() => { config.nodeEnv = originalEnvironment; });

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
