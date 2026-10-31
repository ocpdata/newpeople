import { describe, expect, it, vi } from "vitest";
import {
  CHAT_PROGRESS_PHASES,
  createChatProgressReporter,
  phaseForTraceEvent,
} from "../src/commercial-intelligence/chat-progress.js";
import { createTurnExecutionTrace } from "../src/commercial-intelligence/turn-execution-trace.js";

describe("progreso por fases del chat de cliente", () => {
  it("mapea solo el inicio de los spans conocidos a una fase", () => {
    expect(phaseForTraceEvent({ phase: "call", status: "started", label: "Autorizar contexto y construir snapshot" })).toBe("context");
    expect(phaseForTraceEvent({ phase: "call", status: "started", label: "Ejecutar motor conversacional" })).toBe("crm");
    expect(phaseForTraceEvent({ phase: "call", status: "started", label: "Redactar y auditar respuesta conversacional" })).toBe("answering");
    expect(phaseForTraceEvent({ phase: "return", status: "completed", label: "Ejecutar motor conversacional" })).toBeNull();
    expect(phaseForTraceEvent({ phase: "call", status: "started", label: "Span desconocido" })).toBeNull();
    expect(phaseForTraceEvent(null)).toBeNull();
  });

  it("toda fase mapeada tiene un texto para el usuario", () => {
    for (const phase of Object.values({ a: "context", b: "understanding", c: "dossier", d: "crm", e: "documents", f: "verifying", g: "answering", h: "saving", i: "attachment" })) {
      expect(CHAT_PROGRESS_PHASES[phase]).toEqual(expect.any(String));
    }
  });

  it("guarda cada cambio de fase en orden y omite repeticiones", async () => {
    const calls = [];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const run = vi.fn(async (sql, params) => {
      if (!calls.length) await gate;
      calls.push(JSON.parse(params[0]).phase);
    });
    const reporter = createChatProgressReporter({ jobId: 7, run, now: () => new Date("2026-10-30T12:00:00Z") });
    reporter.report("context");
    reporter.report("context");
    reporter.report("understanding");
    reporter.report("fase-inexistente");
    release();
    await reporter.flush();
    expect(calls).toEqual(["context", "understanding"]);
    expect(run.mock.calls[0][0]).toContain("status = 'pending'");
    expect(run.mock.calls[0][1][1]).toBe(7);
    expect(JSON.parse(run.mock.calls[0][1][0])).toEqual({
      phase: "context",
      label: CHAT_PROGRESS_PHASES.context,
      at: "2026-10-30T12:00:00.000Z",
    });
  });

  it("un fallo al guardar el progreso no interrumpe el turno", async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error("db down")).mockResolvedValue(undefined);
    const reporter = createChatProgressReporter({ jobId: 1, run });
    reporter.report("context");
    reporter.report("crm");
    await expect(reporter.flush()).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("la traza avisa a su observador y tolera que falle", async () => {
    const seen = [];
    const trace = createTurnExecutionTrace({
      onEvent: (event) => {
        seen.push(event.label);
        throw new Error("observer failure");
      },
    });
    await trace.span({ from: "B3", to: "B4", label: "Ejecutar motor conversacional" }, async () => "ok");
    expect(seen).toEqual(["Ejecutar motor conversacional", "Ejecutar motor conversacional"]);
    expect(trace.events).toHaveLength(2);
  });
});
