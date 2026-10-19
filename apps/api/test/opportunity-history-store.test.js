import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ run: vi.fn(), begin: vi.fn() }));
vi.mock("../src/db.js", () => ({
  query: vi.fn(),
  withTransaction: vi.fn(async (work) => work({ query: mock.run, beginTransaction: mock.begin })),
}));
vi.mock("../src/ai-usage/service.js", () => ({ ensureAiUsageSchema: vi.fn() }));
import { installOpportunityCommercialHistory, readOpportunityCommercialHistory, readOpportunityScenarioBasis } from "../src/commercial-intelligence/opportunity-history-store.js";
import { HISTORY_FIELDS } from "../src/opportunity-audit.js";

describe("G06 persistent audit history installer", () => {
  beforeEach(() => {
    mock.begin.mockReset();
    mock.run.mockReset().mockImplementation(async (sql) => {
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
      if (sql.includes("SELECT * FROM opportunities")) return [[{ id: 1, name: "Alfa", account_id: 1 }]];
      if (sql.includes("INSERT INTO audit_log")) return [{ insertId: 42 }];
      return [[]];
    });
  });
  it("records complete baseline in existing audit without triggers or opportunity writes", async () => {
    await installOpportunityCommercialHistory();
    const sql = mock.run.mock.calls.map(([statement]) => statement).join("\n");
    expect(sql).toContain("ENGINE=InnoDB");
    expect(sql).toContain("FOR UPDATE");
    expect(sql).not.toMatch(/TRIGGER|opportunity_commercial_events|UPDATE opportunities|DELETE FROM|INTERVAL.*MONTH/);
    expect(mock.begin).toHaveBeenCalledOnce();
    const insert = mock.run.mock.calls.find(([statement]) => statement.includes("INSERT INTO audit_log"));
    expect(insert[1][1]).toBe("commercial_history_baseline");
    expect(JSON.parse(insert[1][6]).commercial_history.after.after_state.name).toBe("Alfa");
  });
  it("does not duplicate baselines or captured creations on rerun", async () => {
    mock.run.mockImplementation(async (sql) => {
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
      if (sql.includes("SELECT * FROM opportunities")) return [[{ id: 1 }]];
      if (sql.includes("SELECT DISTINCT entity_id")) return [[{ entity_id: 1 }]];
      return [[]];
    });
    await installOpportunityCommercialHistory();
    expect(mock.run.mock.calls.some(([sql]) => sql.includes("INSERT INTO audit_log"))).toBe(false);
  });
  it("does not install if another process holds the migration lock", async () => {
    mock.run.mockResolvedValue([[{ acquired: 0 }]]);
    await expect(installOpportunityCommercialHistory()).rejects.toThrow("bloqueo");
    expect(mock.run).toHaveBeenCalledOnce();
  });
  it("does not mark installation complete after an audit insert fails", async () => {
    mock.run.mockImplementation(async (sql) => {
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
      if (sql.includes("SELECT * FROM opportunities")) return [[{ id: 1 }]];
      if (sql.includes("INSERT INTO audit_log")) throw new Error("audit unavailable");
      return [[]];
    });
    await expect(installOpportunityCommercialHistory()).rejects.toThrow("audit unavailable");
    expect(mock.run.mock.calls.some(([sql]) => sql.includes("INSERT INTO opportunity_audit_history_control"))).toBe(false);
  });
});

describe("G06 full authorized audit history reader", () => {
  const user = { id: 7, permissionSet: new Set(["cuentas.read", "oportunidades.read"]) };
  const governance = { includeWonOpportunities: false, includeLostOpportunities: false, includeCancelledOpportunities: false };
  const run = (extra = {}) => readOpportunityCommercialHistory({
    user, accountId: 1, governance, execute: async (sql, params) => (await mock.run(sql, params))[0], ...extra,
  });

  describe("G07 complete current authorized scenario reader", () => {
    const user = { id: 7, permissionSet: new Set(["cuentas.read", "oportunidades.read"]) };
    const run = (extra = {}) => readOpportunityScenarioBasis({ user, accountId: 1, governance: {}, ...extra });
    beforeEach(() => mock.run.mockReset().mockResolvedValue([[{ id: 1, account_id: 1 }]]));
    it("queries only current commercial fields with complete ownership and governance scopes", async () => {
      const result = await run();
      expect(result.complete).toBe(true);
      expect(mock.run).toHaveBeenCalledOnce();
      const [query, params] = mock.run.mock.calls[0];
      expect(query.sql).toContain("account_owners");
      expect(query.sql).toContain("o.created_by=? OR o.seller_user_id=?");
      expect(query.sql).toContain("a.code AS activation_status_code");
      expect(query.sql).toContain("st.code AS stage_code");
      expect(query.sql).toContain("LIMIT 10001");
      expect(query.sql).not.toMatch(/audit_log|UPDATE|INSERT|TRIGGER/);
      expect(params).toEqual([1, 7, 7, 7, 7, "en_proceso"]);
      expect((query.sql.match(/\?/g) || []).length).toBe(params.length);
    });
    it("never treats read_all as the base read permission", async () => {
      await expect(run({ user: { id: 7, permissionSet: new Set(["oportunidades.read_all", "cuentas.read_all"]) } }))
        .rejects.toMatchObject({ code: "HISTORY_ACCESS_DENIED" });
      expect(mock.run).not.toHaveBeenCalled();
    });
    it("rejects a sentinel over the collection limit without returning a success-shaped partial total", async () => {
      mock.run.mockResolvedValue([Array(10001).fill({ id: 1 })]);
      await expect(run()).rejects.toMatchObject({ code: "SCENARIO_LIMIT" });
    });
    it("propagates source failure and honors cancellation before and after SQL", async () => {
      mock.run.mockRejectedValue(new Error("source unavailable"));
      await expect(run()).rejects.toThrow("source unavailable");
      const controller = new AbortController();
      controller.abort();
      mock.run.mockClear();
      await expect(run({ signal: controller.signal })).rejects.toThrow();
      expect(mock.run).not.toHaveBeenCalled();
      const during = new AbortController();
      mock.run.mockImplementation(async () => { during.abort(); return [[]]; });
      await expect(run({ signal: during.signal })).rejects.toThrow();
    });
  });
  const source = (audits = []) => mock.run.mockImplementation(async (sql) => {
    if (sql.includes("FROM opportunity_audit_history_control")) return [[{ baseline_completed_at_utc: new Date() }]];
    if (sql.includes("SELECT o.*")) return [[{ id: 1 }]];
    if (sql.includes("FROM audit_log a")) return [audits];
    return [[]];
  });
  beforeEach(() => { mock.run.mockReset(); source(); });
  it("applies current ownership and governance before retrieving audit", async () => {
    expect((await run()).complete).toBe(true);
    const calls = mock.run.mock.calls.filter(([sql]) => sql.includes("account_owners"));
    expect(calls).toHaveLength(2);
    for (const [sql, params] of calls) {
      expect(sql).toContain("o.created_by=? OR o.seller_user_id=?");
      expect(params).toEqual([1, 7, 7, 7, 7, "en_proceso"]);
      expect((sql.match(/\?/g) || []).length).toBe(params.length);
    }
    expect(calls[1][0]).toContain("authorized.id=a.entity_id");
    expect(calls[1][0]).toContain("LIMIT 100001");
    expect(mock.run).toHaveBeenCalledTimes(4);
    expect(mock.run.mock.calls.find(([sql]) => sql.includes("UNION ALL"))[0]).toContain("stage_order AS display_order");
  });
  it("read_all never replaces base permission", async () => {
    await expect(run({ user: { ...user, permissionSet: new Set(["cuentas.read_all", "oportunidades.read_all"]) } }))
      .rejects.toMatchObject({ code: "HISTORY_ACCESS_DENIED" });
    expect(mock.run).not.toHaveBeenCalled();
  });
  it("includes only explicitly allowed current statuses", async () => {
    await run({ governance: { includeWonOpportunities: true } });
    expect(mock.run.mock.calls.find(([sql]) => sql.includes("SELECT o.*"))[1]).toContain("ganada");
    expect(mock.run.mock.calls.find(([sql]) => sql.includes("SELECT o.*"))[1]).not.toContain("perdida");
  });
  it("requires completed baseline, not trigger privileges", async () => {
    mock.run.mockResolvedValue([[]]);
    await expect(run()).rejects.toMatchObject({ code: "HISTORY_NOT_READY" });
  });
  it("separates certified snapshots from ordinary audit without duplicating metrics", async () => {
    const state = { ...Object.fromEntries(HISTORY_FIELDS.map((field) => [field, null])), account_id: 1 };
    const history = { version: 1, kind: "created", recorded_at_utc: "2026-01-01T00:00:00Z", before_state: null, after_state: state };
    source([
      { id: 1, entity_id: 1, action: "commercial_history_created", changed_fields: JSON.stringify({ commercial_history: { after: history } }) },
      { id: 2, entity_id: 1, action: "created", created_at: "2026-01-01", changed_fields: { amount_usd: { after: 100 } } },
    ]);
    const result = await run();
    expect(result.events.map((item) => item.event_kind)).toEqual(["created", "legacy"]);
    expect(result.events[0].after_state).toEqual(state);
  });
  it("rejects malformed certified audit instead of treating it as empty history", async () => {
    source([{ id: 1, entity_id: 1, action: "commercial_history_changed", changed_fields: {} }]);
    await expect(run()).rejects.toMatchObject({ code: "HISTORY_INVALID_AUDIT" });
  });
  it("requires full snapshots rather than certifying a partial changed-fields delta", async () => {
    source([{ id: 1, entity_id: 1, action: "commercial_history_baseline", changed_fields: {
      commercial_history: { after: { version: 1, kind: "baseline", recorded_at_utc: "2026-01-01T00:00:00Z",
        before_state: null, after_state: { account_id: 1 } } },
    } }]);
    await expect(run()).rejects.toMatchObject({ code: "HISTORY_INVALID_AUDIT" });
  });
  it("rejects truncated source collections", async () => {
    mock.run.mockImplementation(async (sql) => {
      if (sql.includes("history_control")) return [[{ baseline_completed_at_utc: new Date() }]];
      if (sql.includes("SELECT o.*")) return [Array(10001).fill({ id: 1 })];
      return [[]];
    });
    await expect(run()).rejects.toMatchObject({ code: "HISTORY_LIMIT" });
  });
});
