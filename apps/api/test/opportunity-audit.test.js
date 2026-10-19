import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ query: vi.fn(), commit: vi.fn(), rollback: vi.fn() }));
vi.mock("../src/db.js", () => ({
  query: vi.fn(),
  withTransaction: vi.fn(async (work) => {
    try {
      const result = await work({ query: mock.query });
      mock.commit();
      return result;
    } catch (error) {
      mock.rollback();
      throw error;
    }
  }),
}));
vi.mock("../src/ai-usage/service.js", () => ({ ensureAiUsageSchema: vi.fn() }));
import { mutateAuditedOpportunity } from "../src/opportunity-audit.js";
import { withTransaction } from "../src/db.js";

const initial = {
  id: 1, name: "Alfa", account_id: 2, amount_usd: "500.00", sales_stage_id: 1,
  commercial_status_id: 1, activation_status_id: 1, close_date: "2026-12-31",
  commercial_closed_at: null, seller_user_id: 7, presales_user_id: null,
  created_by: 7, created_at: new Date(2026, 0, 1, 10),
};
describe("transactional opportunity audit", () => {
  let after;
  beforeEach(() => {
    after = { ...initial, amount_usd: "700.00" };
    vi.clearAllMocks();
    mock.query.mockImplementation(async (sql) => {
      if (sql.includes("FOR UPDATE")) return [[initial]];
      if (sql.startsWith("SELECT")) return [[after]];
      return [{ insertId: 1, affectedRows: 1 }];
    });
  });
  const update = (extra = {}) => mutateAuditedOpportunity({
    opportunityId: 1, req: { user: { id: 7, full_name: "Vendedor" }, ip: "127.0.0.1" }, ...extra,
  }, "UPDATE opportunities SET amount_usd=? WHERE id=?", [700, 1]);
  it("locks, changes and audits the full state before committing with the CRM actor", async () => {
    expect((await update()).affectedRows).toBe(1);
    expect(mock.query.mock.calls.map(([sql]) => sql.trim().split(/\s+/).slice(0, 2).join(" "))).toEqual([
      "SELECT *", "UPDATE opportunities", "SELECT *", "INSERT INTO",
    ]);
    const params = mock.query.mock.calls[3][1];
    const capture = JSON.parse(params[6]).commercial_history.after;
    expect(capture).toMatchObject({
      version: 1, kind: "changed",
      before_state: { amount_usd: "500.00", account_id: 2, created_at: "2026-01-01 10:00:00" },
      after_state: { amount_usd: "700.00", account_id: 2 },
    });
    expect(params[7]).toBe(7);
    expect(mock.commit).toHaveBeenCalledOnce();
  });
  it("propagates audit failure so the transaction rolls back instead of reporting success", async () => {
    const execute = mock.query.getMockImplementation();
    mock.query.mockImplementation(async (sql, params) => {
      if (sql.includes("INSERT INTO audit_log")) throw new Error("audit unavailable");
      return execute(sql, params);
    });
    await expect(update()).rejects.toThrow("audit unavailable");
    expect(mock.commit).not.toHaveBeenCalled();
    expect(mock.rollback).toHaveBeenCalledOnce();
  });
  it("does not open or commit a nested transaction when the caller owns it", async () => {
    await update({ connection: { query: mock.query } });
    expect(withTransaction).not.toHaveBeenCalled();
    expect(mock.commit).not.toHaveBeenCalled();
    expect(mock.query).toHaveBeenCalledTimes(4);
  });
  it("records creations and deletions without inventing a previous or subsequent state", async () => {
    await mutateAuditedOpportunity({ actor: { id: 7 } }, "INSERT INTO opportunities(name) VALUES(?)", ["Alfa"]);
    expect(JSON.parse(mock.query.mock.calls.at(-1)[1][6]).commercial_history.after).toMatchObject({
      kind: "created", before_state: null, after_state: { name: "Alfa" },
    });
    mock.query.mockClear();
    after = undefined;
    mock.query.mockImplementation(async (sql) => {
      if (sql.includes("FOR UPDATE")) return [[initial]];
      if (sql.startsWith("SELECT")) return [[]];
      return [{ insertId: 1, affectedRows: 1 }];
    });
    await mutateAuditedOpportunity({ opportunityId: 1 }, "DELETE FROM opportunities WHERE id=?", [1]);
    expect(JSON.parse(mock.query.mock.calls.at(-1)[1][6]).commercial_history.after).toMatchObject({
      kind: "deleted", before_state: { name: "Alfa" }, after_state: null,
    });
  });
  it("does not duplicate history for unchanged commercial fields", async () => {
    after = { ...initial, updated_at: new Date() };
    await update();
    expect(mock.query.mock.calls.some(([sql]) => sql.includes("INSERT INTO audit_log"))).toBe(false);
  });
  it("does not mutate an opportunity that disappeared", async () => {
    mock.query.mockResolvedValue([[]]);
    await expect(update()).rejects.toMatchObject({ status: 404 });
    expect(mock.query).toHaveBeenCalledOnce();
    expect(mock.rollback).toHaveBeenCalledOnce();
  });
});
