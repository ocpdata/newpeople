import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock("../src/db.js", () => ({ query: queryMock }));
vi.mock("../src/coach/schema.js", () => ({
  ensureCoachSchema: vi.fn().mockResolvedValue(undefined),
}));

import { getCoachMetrics } from "../src/coach/metrics.js";

describe("Coach metrics", () => {
  beforeEach(() => queryMock.mockReset());

  it("derives lifecycle metrics only from events and persisted state", async () => {
    queryMock.mockImplementation(async (sql) => {
      const statement = String(sql || "");
      if (statement.includes("FROM ai_usage_ledger")) {
        return [{ requests: 4, tokens: 900, costMicros: 1200 }];
      }
      if (statement.includes("FROM coach_operation_events")) {
        return [
          {
            proposed: 5,
            approved: 3,
            rejected: 2,
            completed: 2,
            failed: 1,
            reverted: 1,
            cancelled: 0,
            superseded: 0,
          },
        ];
      }
      return [{ pending: 1 }];
    });

    const metrics = await getCoachMetrics(7);

    expect(metrics).toMatchObject({
      requests: 4,
      proposed: 5,
      approved: 3,
      rejected: 2,
      completed: 2,
      failed: 1,
      reverted: 1,
      pending: 1,
      decided: 5,
      approvalRate: 0.6,
      completionRate: 2 / 3,
    });
    const sql = queryMock.mock.calls.map(([statement]) => statement).join("\n");
    expect(sql).toContain("feature_code = 'mi_coach.chat'");
    expect(sql).toContain("FROM coach_operation_events");
    expect(sql).not.toContain("opportunity_workspace_actions");
    expect(sql).not.toContain("audit_log");
    expect(sql).not.toContain("Coach Comercial");
  });
});
