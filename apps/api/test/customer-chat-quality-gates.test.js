import { describe, expect, it } from "vitest";
import { assessQualityReport, normalizeGroups, regressionReasons } from "../src/customer-chat-quality/gates.js";
import { failedDetails } from "../src/customer-chat-quality/store.js";
import { flagJob, percentile, summarizeProductionWindow } from "../src/customer-chat-quality/production-monitor.js";

const contract = (catalog, dialogue, critical) => ({
  groups: { catalog: { passed: catalog, total: 46 }, dialogue: { passed: dialogue, total: 13 }, critical: { passed: critical, total: 9 } },
});

describe("umbrales de calidad del chat de cliente", () => {
  it("aprueba el contrato con los umbrales documentados", () => {
    const result = assessQualityReport({ source: "contract", report: contract(44, 12, 9) });
    expect(result.status).toBe("passed");
  });

  it("falla si el catálogo queda bajo 95%, el diálogo bajo 90% o un control crítico falla", () => {
    expect(assessQualityReport({ source: "contract", report: contract(43, 12, 9) }).reasons[0]).toMatch(/Categoría y objeto/);
    expect(assessQualityReport({ source: "contract", report: contract(44, 11, 9) }).reasons[0]).toMatch(/Movimiento/);
    const critical = assessQualityReport({ source: "contract", report: contract(46, 13, 8) });
    expect(critical.status).toBe("failed");
    expect(critical.reasons[0]).toMatch(/críticos/);
  });

  it("exige los siete recorridos del pipeline", () => {
    const scenarios = (passed) => Array.from({ length: 7 }, (_, index) => ({ name: `s${index}`, status: index < passed ? "pass" : "fail" }));
    expect(assessQualityReport({ source: "pipeline", report: { scenarios: scenarios(7) } }).status).toBe("passed");
    expect(assessQualityReport({ source: "pipeline", report: { scenarios: scenarios(6) } }).status).toBe("failed");
    expect(assessQualityReport({ source: "pipeline", report: { scenarios: scenarios(7).slice(0, 6) } }).status).toBe("failed");
  });

  it("marca regresión cuando baja 5 puntos o más aunque siga sobre el umbral", () => {
    const previous = normalizeGroups("contract", contract(46, 13, 9));
    const result = assessQualityReport({ source: "contract", report: contract(46, 12, 9), previousGroups: previous });
    expect(result.status).toBe("regressed");
    expect(result.reasons[0]).toMatch(/dialogue bajó/);
    expect(regressionReasons(previous, normalizeGroups("contract", contract(45, 13, 9)))).toEqual([]);
  });

  it("ignora grupos inválidos del reporte", () => {
    expect(normalizeGroups("contract", { groups: { catalog: { passed: 5, total: 3 }, dialogue: { passed: "x", total: 2 } } })).toEqual({});
  });

  it("evalúa el monitoreo de producción solo con datos suficientes", () => {
    const groups = (completed, finished, positive, rated) => ({
      groups: { reliability: { passed: completed, total: finished }, satisfaction: { passed: positive, total: rated } },
    });
    expect(assessQualityReport({ source: "production_monitor", report: groups(1, 3, 0, 0), metrics: { turns: 3 } }).status).toBe("passed");
    const unreliable = assessQualityReport({ source: "production_monitor", report: groups(8, 10, 5, 5), metrics: { turns: 10 } });
    expect(unreliable.status).toBe("failed");
    expect(unreliable.reasons[0]).toMatch(/Turnos sin fallo/);
    const unhappy = assessQualityReport({ source: "production_monitor", report: groups(10, 10, 2, 8), metrics: { turns: 10 } });
    expect(unhappy.reasons[0]).toMatch(/Valoraciones/);
    const slow = assessQualityReport({ source: "production_monitor", report: groups(10, 10, 5, 5), metrics: { turns: 10, latencyP95Seconds: 41 } });
    expect(slow.reasons[0]).toMatch(/Latencia p95/);
  });

  it("rechaza fuentes desconocidas", () => {
    expect(() => assessQualityReport({ source: "otra", report: {} })).toThrow(/desconocida/);
  });
});

describe("detalles y muestreo de producción", () => {
  it("guarda solo lo necesario de los casos fallidos", () => {
    const details = failedDetails({
      results: [{ group: "catalog", expected: "query.field_value", passed: true, actual: { big: true } },
        { group: "catalog", expected: "guidance.next_steps", passed: false, actual: { big: true }, error: "X" }],
      scenarios: [{ name: "Consulta", status: "fail" }, { name: "Lista", status: "pass" }],
    });
    expect(details).toEqual([
      { group: "catalog", id: "guidance.next_steps", error: "X" },
      { group: "scenarios", id: "Consulta", error: "fail" },
    ]);
  });

  it("calcula percentiles ignorando valores no numéricos", () => {
    expect(percentile([3, 1, 2, Number.NaN], 0.5)).toBe(2);
    expect(percentile([], 0.5)).toBeNull();
  });

  it("marca los turnos que merecen revisión", () => {
    expect(flagJob({ job: { status: "failed" }, trace: null, negativeFeedback: false })).toEqual(["job_failed"]);
    expect(flagJob({ job: { status: "completed" }, trace: { validation_status: "valid", evidence_count: 0, operations_rejected: 0 }, negativeFeedback: true }))
      .toEqual(["no_evidence", "negative_feedback"]);
    expect(flagJob({ job: { status: "completed" }, trace: { validation_status: "clarification", evidence_count: 0 }, negativeFeedback: false })).toEqual([]);
    expect(flagJob({ job: { status: "completed" }, trace: { validation_status: "valid", evidence_count: 2, operations_rejected: 1 }, negativeFeedback: false }))
      .toEqual(["operation_rejected"]);
  });

  it("resume la ventana y prioriza los turnos marcados en la muestra", () => {
    const jobs = [
      { id: 1, status: "completed", seconds: 5 }, { id: 2, status: "completed", seconds: 10 },
      { id: 3, status: "failed", seconds: null }, { id: 4, status: "pending", seconds: null }, { id: 5, status: "completed", seconds: 20 },
    ];
    const traces = [{ job_id: 2, validation_status: "valid", evidence_count: 3, operations_rejected: 0 }];
    const feedback = [{ job_id: 2, rating: "negative" }, { job_id: 1, rating: "positive" }];
    const summary = summarizeProductionWindow({ jobs, traces, feedback });
    expect(summary.groups).toEqual({ reliability: { passed: 3, total: 4 }, satisfaction: { passed: 1, total: 2 } });
    expect(summary.metrics).toMatchObject({ turns: 4, failedTurns: 1, ratedTurns: 2, negativeRatings: 1, latencyP95Seconds: 20 });
    expect(summary.sample.map((item) => item.jobId)).toEqual([3, 2, 5, 1]);
    expect(summary.sample[1].flags).toEqual(["negative_feedback"]);
  });
});
