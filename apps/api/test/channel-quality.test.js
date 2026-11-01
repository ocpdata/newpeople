import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("../src/db.js", () => ({ query: (...args) => query(...args) }));

const { assessQualityReport, gateFailures, QUALITY_CHANNELS, QUALITY_SOURCES } = await import("../src/channel-quality/gates.js");
const { summarizeCoachWindow, summarizeProspectWindow, runChannelProductionMonitor } = await import("../src/channel-quality/production-monitor.js");
const { recordChannelQualityRun, getChannelQualityOverview } = await import("../src/channel-quality/store.js");

describe("compuertas de calidad por canal", () => {
  it("define solo Coach y Cuenta nueva, sin tocar Cliente existente", () => {
    expect(QUALITY_CHANNELS).toEqual(["coach", "prospect"]);
    expect(QUALITY_SOURCES).toEqual(["lab", "live", "production_monitor"]);
  });

  it("exige 90% en el laboratorio y 85% con IA real", () => {
    expect(gateFailures("lab", { cases: { passed: 9, total: 10 } })).toEqual([]);
    expect(gateFailures("lab", { cases: { passed: 8, total: 10 } })[0]).toContain("Casos aprobados: 8/10");
    expect(gateFailures("live", { cases: { passed: 17, total: 20 } })).toEqual([]);
    expect(gateFailures("live", { cases: { passed: 16, total: 20 } })).toHaveLength(1);
    expect(gateFailures("live", { cases: { passed: 20, total: 20 }, critical: { passed: 10, total: 10 } })).toEqual([]);
    expect(gateFailures("live", { cases: { passed: 23, total: 24 }, critical: { passed: 9, total: 10 } })[0]).toContain("Escenarios críticos: 9/10");
    expect(gateFailures("lab", {})[0]).toContain("no se ejecutó");
  });

  it("no evalúa producción con menos de 5 turnos y sí con más", () => {
    const groups = { reliability: { passed: 1, total: 4 }, satisfaction: { passed: 0, total: 4 } };
    expect(gateFailures("production_monitor", groups, { turns: 4 })).toEqual([]);
    const failures = gateFailures("production_monitor", { reliability: { passed: 5, total: 10 }, satisfaction: { passed: 1, total: 6 } },
      { turns: 10, latencyP95Seconds: 40 });
    expect(failures).toHaveLength(3);
  });

  it("marca regresión de 5 puntos aunque se cumpla el umbral", () => {
    const result = assessQualityReport({
      source: "lab", report: { groups: { cases: { passed: 18, total: 20 } } }, previousGroups: { cases: { passed: 20, total: 20 } },
    });
    expect(result.status).toBe("regressed");
    expect(result.reasons[0]).toContain("cases bajó de 100% a 90%");
    expect(() => gateFailures("contract", {})).toThrow("Fuente de calidad desconocida");
  });
});

describe("monitoreo de producción por canal", () => {
  it("resume los turnos de Coach desde las trazas", () => {
    const summary = summarizeCoachWindow([
      { id: 1, validation_status: "valid", error_code: null, operations_rejected: 0, feedback_rating: "positive", latency_ms: 2000 },
      { id: 2, validation_status: "error", error_code: "X", operations_rejected: 0, feedback_rating: null, latency_ms: 9000 },
      { id: 3, validation_status: "valid", error_code: null, operations_rejected: 1, feedback_rating: "negative", latency_ms: null },
    ]);
    expect(summary.groups).toEqual({ reliability: { passed: 2, total: 3 }, satisfaction: { passed: 1, total: 2 } });
    expect(summary.metrics).toMatchObject({ turns: 3, failedTurns: 1, ratedTurns: 2, negativeRatings: 1, latencyP95Seconds: 9 });
    expect(summary.sample.find((item) => item.id === 3).flags).toEqual(["operation_rejected", "negative_feedback"]);
  });

  it("resume los turnos de Cuenta nueva desde sus jobs y sus trazas", () => {
    const summary = summarizeProspectWindow({
      jobs: [
        { id: 10, status: "completed", seconds: 4 }, { id: 11, status: "failed", seconds: 1 },
        { id: 12, status: "running", seconds: null }, { id: 13, status: "completed", seconds: 8 },
      ],
      traces: [
        { job_id: 10, validation_status: "valid", operations_rejected: 0, feedback_rating: "negative" },
        { job_id: 13, validation_status: "valid", operations_rejected: 1, feedback_rating: "positive" },
      ],
    });
    expect(summary.groups.reliability).toEqual({ passed: 2, total: 3 });
    expect(summary.groups.satisfaction).toEqual({ passed: 1, total: 2 });
    expect(summary.metrics.latencyP50Seconds).toBe(8);
    expect(summary.sample.map((item) => [item.id, item.flags])).toEqual([
      [13, ["operation_rejected"]], [11, ["job_failed"]], [10, ["negative_feedback"]],
    ]);
  });

  it("omite el monitoreo si hubo uno hace menos de 20 horas y no lee datos", async () => {
    query.mockReset();
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ evaluated_at: new Date().toISOString() }]);
    expect(await runChannelProductionMonitor({ channel: "coach" })).toBeNull();
    expect(query.mock.calls.every(([sql]) => !String(sql).includes("coach_turn_quality_traces"))).toBe(true);
    await expect(runChannelProductionMonitor({ channel: "customer_account" })).rejects.toThrow("Canal de calidad desconocido");
  });
});

describe("almacén de calidad por canal", () => {
  beforeEach(() => { query.mockReset(); });

  it("rechaza canales y fuentes de Cliente existente", async () => {
    await expect(recordChannelQualityRun({ channel: "customer_account", source: "lab", report: {} })).rejects.toThrow("Canal");
    await expect(recordChannelQualityRun({ channel: "coach", source: "contract", report: {} })).rejects.toThrow("Fuente");
    await expect(getChannelQualityOverview({ channel: "customer_account" })).rejects.toThrow("Canal");
    expect(query).not.toHaveBeenCalled();
  });

  it("registra una ejecución con su estado y la compara con la anterior del mismo canal y fuente", async () => {
    const row = {
      id: 5, channel: "prospect", source: "lab", status: "regressed", trigger_kind: "manual", model: null, commit_sha: null,
      groups_json: "{}", metrics_json: "{}", reasons_json: "[]", details_json: "[]", evaluated_at: new Date().toISOString(),
    };
    query.mockImplementation(async (sql) => {
      if (sql.includes("CREATE TABLE")) return [];
      if (sql.includes("SELECT groups_json")) return [{ groups_json: JSON.stringify({ cases: { passed: 20, total: 20 } }) }];
      if (sql.includes("INSERT INTO")) return { insertId: 5 };
      if (sql.includes("WHERE id = ?")) return [row];
      throw new Error(`Unexpected query: ${sql}`);
    });
    const run = await recordChannelQualityRun({ channel: "prospect", source: "lab", report: { groups: { cases: { passed: 18, total: 20 } } } });
    expect(run).toMatchObject({ id: 5, channel: "prospect" });
    const previousCall = query.mock.calls.find(([sql]) => sql.includes("SELECT groups_json"));
    expect(previousCall[0]).toContain("channel = ? AND source = ?");
    expect(previousCall[1].slice(0, 2)).toEqual(["prospect", "lab"]);
    const insert = query.mock.calls.find(([sql]) => sql.includes("INSERT INTO"));
    expect(insert[1][0]).toBe("prospect");
    expect(insert[1][2]).toBe("regressed");
  });
});
