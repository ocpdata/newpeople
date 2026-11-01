import { describe, expect, it } from "vitest";
import { formatChannelUsage, loadChannelUsage, summarize } from "../src/channel-quality/usage.js";

const fakeRun = (tables) => async (sql) => {
  for (const [needle, rows] of Object.entries(tables)) if (sql.includes(needle)) return rows;
  throw new Error(`Unexpected query: ${sql.slice(0, 80)}`);
};

const tables = {
  coach_turn_quality_traces: [
    { channel: "coach", user_id: 1, validation_status: "valid", feedback_rating: "positive", latency_ms: 2000 },
    { channel: "coach", user_id: 2, validation_status: "error", feedback_rating: null, latency_ms: 6000 },
    { channel: "customer_account", user_id: 3, validation_status: "clarification", feedback_rating: "negative", latency_ms: 1000 },
    { channel: "prospect", user_id: 4, validation_status: "valid", feedback_rating: "positive", latency_ms: 3000 },
  ],
  coach_conversation_sessions: [{ sessions: 10, users: 3, with_messages: 4, avg_messages: "1.5", max_messages: 8 }],
  customer_intelligence_chat_sessions: [{ sessions: 5, users: 2, with_messages: 5, avg_messages: "6", max_messages: 12 }],
  customer_chat_turn_feedback: [{ rating: "positive", total: 3 }, { rating: "negative", total: 1 }],
  prospect_research_sessions: [{ sessions: 2, users: 1, with_messages: 1, avg_messages: "2", max_messages: 4 }],
  prospect_research_chat_jobs: [
    { status: "completed", seconds: 4 }, { status: "completed", seconds: 8 }, { status: "failed", seconds: 1 },
  ],
};

describe("reporte de uso de los chats", () => {
  it("resume percentiles e ignora valores no numéricos", () => {
    expect(summarize([3, "x", 1, null, 2])).toEqual({ count: 3, p50: 2, p95: 3, max: 3 });
    expect(summarize([])).toEqual({ count: 0, p50: null, p95: null, max: null });
  });

  it("separa los tres canales y marca Cliente existente como referencia", async () => {
    const report = await loadChannelUsage({ days: 30 }, { run: fakeRun(tables) });
    expect(report.channels.coach).toMatchObject({
      sessions: 10, withMessages: 4, turns: 2, errors: 1, errorRatePct: 50, positive: 1, negative: 0, users: 3,
    });
    expect(report.channels.customer_account).toMatchObject({
      referenceOnly: true, turns: 1, clarificationRatePct: 100, rated: 4, positive: 3, negative: 1,
    });
    expect(report.channels.prospect).toMatchObject({ sessions: 2, turns: 3, errors: 1, errorRatePct: 33.3, rated: 1, positive: 1 });
    expect(report.channels.prospect.latencySeconds).toMatchObject({ count: 2, p50: 8 });
  });

  it("solo ejecuta consultas de lectura", async () => {
    const statements = [];
    await loadChannelUsage({ days: 7 }, { run: async (sql) => { statements.push(sql); return fakeRun(tables)(sql); } });
    expect(statements.length).toBeGreaterThan(0);
    expect(statements.every((sql) => /^\s*SELECT\b/i.test(sql))).toBe(true);
  });

  it("imprime un bloque por canal con sus valoraciones", async () => {
    const text = formatChannelUsage(await loadChannelUsage({ days: 30 }, { run: fakeRun(tables) }));
    expect(text).toContain("Coach");
    expect(text).toContain("Cliente existente (referencia)");
    expect(text).toContain("Cuenta nueva");
    expect(text).toContain("Valoraciones: 1 (👍 1 · 👎 0)");
  });
});
