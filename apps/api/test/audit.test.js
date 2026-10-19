import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db.js", () => ({ query: vi.fn() }));
vi.mock("../src/ai-usage/service.js", () => ({ ensureAiUsageSchema: vi.fn() }));

import { query } from "../src/db.js";
import { logAuditEvent } from "../src/audit.js";

describe("audit events without expiration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-17T12:00:00Z"));
    vi.mocked(query).mockReset().mockResolvedValue({ insertId: 42 });
  });

  afterEach(() => vi.useRealTimers());

  it("only inserts events, without purging old records or scheduling retention", async () => {
    for (const years of [0, 1, 10]) {
      vi.setSystemTime(new Date(Date.UTC(2026 + years, 9, 17, 12)));
      expect(await logAuditEvent({
        actor: { id: 7, full_name: "Vendedor" },
        module: "opportunities", action: "updated", entityType: "opportunity", entityId: 9,
        before: { amount_usd: 500 }, after: { amount_usd: 700 },
      })).toBe(42);
    }

    expect(query).toHaveBeenCalledTimes(3);
    for (const [sql, params] of vi.mocked(query).mock.calls) {
      expect(sql.trim()).toMatch(/^INSERT INTO audit_log\s/);
      expect(params[6]).toBe('{"amount_usd":{"before":500,"after":700}}');
      expect(params[7]).toBe(7);
      expect(params[12]).toBeInstanceOf(Date);
    }
    expect(vi.getTimerCount()).toBe(0);
  });
});
