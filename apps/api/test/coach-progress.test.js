import { describe, expect, it, vi } from "vitest";
import {
  COACH_PROGRESS_PHASES,
  createCoachProgressReporter,
  phaseForCoachTraceEvent,
} from "../src/coach/progress.js";
import { createCoachBlockTrace } from "../src/coach/block-runtime.js";

const started = (label) => ({ phase: "call", status: "started", label });

describe("progreso por fases del chat de Coach", () => {
  it("mapea solo el inicio de los spans conocidos a una fase", () => {
    expect(phaseForCoachTraceEvent(started("Planificar turno de Coach"))).toBe("understanding");
    expect(phaseForCoachTraceEvent(started("Resolver contexto y preparar lecturas"))).toBe("context");
    expect(phaseForCoachTraceEvent(started("Lectura autorizada: getOpportunity"))).toBe("crm");
    expect(phaseForCoachTraceEvent(started("Solicitar lectura adicional"))).toBe("crm");
    expect(phaseForCoachTraceEvent(started("Verificar evidencia de Coach"))).toBe("verifying");
    expect(phaseForCoachTraceEvent(started("Formar respuesta de Coach"))).toBe("answering");
    expect(phaseForCoachTraceEvent(started("Auditar respuesta final de Coach"))).toBe("auditing");
    expect(phaseForCoachTraceEvent(started("Persistir operaciones y sesión de Coach"))).toBe("saving");
    expect(
      phaseForCoachTraceEvent({ phase: "return", status: "completed", label: "Formar respuesta de Coach" }),
    ).toBeNull();
    expect(phaseForCoachTraceEvent(started("Span desconocido"))).toBeNull();
    expect(phaseForCoachTraceEvent(null)).toBeNull();
  });

  it("cada fase mapeada tiene un texto para el usuario", () => {
    for (const phase of ["understanding", "context", "crm", "verifying", "answering", "auditing", "saving"]) {
      expect(COACH_PROGRESS_PHASES[phase]).toEqual(expect.any(String));
    }
  });

  it("guarda cada cambio de fase en orden y omite repeticiones", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const reporter = createCoachProgressReporter({
      jobId: 7,
      run,
      now: () => new Date("2026-11-02T12:00:00Z"),
    });
    reporter.report("understanding");
    reporter.report("understanding");
    reporter.report("crm");
    reporter.report("fase-inexistente");
    await reporter.flush();
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls.map(([, params]) => JSON.parse(params[0]).phase)).toEqual(["understanding", "crm"]);
    expect(run.mock.calls[0][0]).toContain("status IN ('pending', 'running')");
    expect(run.mock.calls[0][1][1]).toBe(7);
    expect(JSON.parse(run.mock.calls[0][1][0])).toEqual({
      phase: "understanding",
      label: COACH_PROGRESS_PHASES.understanding,
      at: "2026-11-02T12:00:00.000Z",
    });
  });

  it("un fallo al guardar el progreso no interrumpe el turno", async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error("db down")).mockResolvedValue(undefined);
    const reporter = createCoachProgressReporter({ jobId: 1, run });
    reporter.report("understanding");
    reporter.report("crm");
    await expect(reporter.flush()).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("la traza avisa a su observador y tolera que falle", async () => {
    const seen = [];
    const trace = createCoachBlockTrace({ jobId: 3, onEvent: (event) => seen.push(event.label) });
    await trace.span("B5", "B9", "Verificar evidencia de Coach", async () => "ok");
    expect(seen).toEqual(["Verificar evidencia de Coach", "Verificar evidencia de Coach"]);

    const failing = createCoachBlockTrace({
      jobId: 4,
      onEvent: () => {
        throw new Error("observer down");
      },
    });
    await expect(failing.span("B5", "B9", "Formar respuesta de Coach", async () => "ok")).resolves.toBe("ok");
    expect(failing.events).toHaveLength(2);
  });
});
