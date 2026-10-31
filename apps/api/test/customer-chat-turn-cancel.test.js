import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db.js", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("../src/settings.js", () => ({ getCommercialSettings: vi.fn().mockResolvedValue({ businessTimezone: "America/Mexico_City" }) }));
vi.mock("../src/commercial-intelligence/schema.js", () => ({ ensureCommercialIntelligenceSchema: vi.fn() }));
vi.mock("../src/coach/channel-intent-governance.js", () => ({ loadChannelIntentConfigurations: vi.fn().mockResolvedValue([]) }));
vi.mock("../src/structuredWebResearch.js", () => ({
  runStructuredTextResearch: vi.fn().mockResolvedValue(null), runStructuredWebResearch: vi.fn(),
}));
vi.mock("../src/coach/observability.js", () => ({ recordCoachTurnQualityTrace: vi.fn().mockResolvedValue(1) }));
vi.mock("../src/commercial-intelligence/dossier/engine.js", async (original) => ({
  ...(await original()), runCustomerDossierTurn: vi.fn(),
}));

import { query } from "../src/db.js";
import { runCustomerDossierTurn } from "../src/commercial-intelligence/dossier/engine.js";
import { cancelCustomerAccountChatJob, processCustomerAccountChatJob } from "../src/commercial-intelligence/service.js";
import { abortActiveTurn, currentTurnSignal } from "../src/commercial-intelligence/turn-context.js";

const user = { id: 31, permissionSet: new Set(["cuentas.read"]) };
let writes;
let jobStatus;

// Stands for a provider call in flight: it only ends when the turn is aborted.
function hangUntilAborted() {
  return new Promise((_resolve, reject) => {
    const signal = currentTurnSignal();
    signal.addEventListener("abort", () => reject(signal.reason));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  writes = [];
  jobStatus = "pending";
  query.mockImplementation(async (sql, params) => {
    if (sql.startsWith("SELECT * FROM customer_intelligence_jobs")) return [{
      id: 1, account_id: 7, requested_by_user_id: 31, status: jobStatus,
      request_json: JSON.stringify({ question: "Resume la cuenta", chatSessionId: 2 }),
    }];
    if (sql.startsWith("SELECT status FROM customer_intelligence_jobs")) return [{ status: jobStatus }];
    if (sql.includes("SELECT history_json, context_json")) return [{ history_json: "[]", context_json: null }];
    if (sql.includes("FROM accounts a")) return [{ id: 7, name: "Totalplay", status_code: "activada" }];
    if (sql.includes("UPDATE")) writes.push({ sql, params });
    return [];
  });
});

describe("cancelar un turno del chat en ejecución", () => {
  it("aborta la llamada en vuelo al instante y no marca el turno como fallido", async () => {
    runCustomerDossierTurn.mockImplementation(hangUntilAborted);
    const running = processCustomerAccountChatJob({ jobId: 1, user });
    await vi.waitFor(() => expect(runCustomerDossierTurn).toHaveBeenCalledTimes(1));
    jobStatus = "cancelled";
    await cancelCustomerAccountChatJob({ user, jobId: 1 }).catch(() => undefined);
    expect(await running).toBeNull();
    expect(writes.some(({ sql }) => sql.includes("status = 'failed'"))).toBe(false);
    expect(abortActiveTurn(1)).toBe(false);
  });

  it("se entera de la cancelación por sondeo cuando ocurre en otro proceso", async () => {
    runCustomerDossierTurn.mockImplementation(hangUntilAborted);
    const running = processCustomerAccountChatJob({ jobId: 1, user });
    await vi.waitFor(() => expect(runCustomerDossierTurn).toHaveBeenCalledTimes(1));
    jobStatus = "cancelled";
    expect(await running).toBeNull();
    expect(writes.some(({ sql }) => sql.includes("status = 'failed'"))).toBe(false);
  }, 10000);

  it("deja de sondear cuando el turno termina", async () => {
    runCustomerDossierTurn.mockResolvedValue({ handled: true, reason: "answered", response: null });
    await processCustomerAccountChatJob({ jobId: 1, user }).catch(() => undefined);
    query.mockClear();
    await new Promise((resolve) => setTimeout(resolve, 2300));
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith("SELECT status FROM customer_intelligence_jobs"))).toBe(false);
  }, 10000);
});
