import { describe, expect, it } from "vitest";
import { createTurnExecutionTrace } from "../src/commercial-intelligence/turn-execution-trace.js";

describe("turn execution trace", () => {
  it("records nested async spans with timing and summarized payloads", async () => {
    const times = [1000, 1000, 1010, 1020, 1020, 1035];
    const trace = createTurnExecutionTrace({
      now: () => times.shift() ?? 1035,
    });

    await trace.span(
      { from: "B3", to: "B4", label: "adapter" },
      async ({ spanId }) =>
        trace.span(
          {
            from: "B4",
            to: "B5",
            label: "engine",
            parentSpanId: spanId,
          },
          async () => ({ answer: "private response" }),
          (result) => ({ answerLength: result.answer.length }),
        ),
    );

    expect(trace.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "B5",
          to: "B4",
          parentSpanId: "turn-span-1",
          phase: "return",
          output: { answerLength: 16 },
        }),
        expect.objectContaining({
          from: "B4",
          to: "B3",
          phase: "return",
          durationMs: 35,
        }),
      ]),
    );
    expect(JSON.stringify(trace.events)).not.toContain("private response");
  });

  it("records synchronous failures without leaking error messages", () => {
    const trace = createTurnExecutionTrace({ now: () => 2000 });
    expect(() =>
      trace.spanSync(
        { from: "B7", to: "B8", label: "read tool" },
        () => {
          const error = new Error("private query details");
          error.code = "READ_FAILED";
          throw error;
        },
      ),
    ).toThrow("private query details");

    expect(trace.events[1]).toMatchObject({
      phase: "return",
      status: "failed",
      errorCode: "READ_FAILED",
    });
    expect(JSON.stringify(trace.events)).not.toContain("private query details");
  });

  it("records synchronous read-tool returns in the reverse direction", () => {
    const times = [3000, 3000, 3007, 3007];
    const trace = createTurnExecutionTrace({
      now: () => times.shift() ?? 3007,
    });

    trace.spanSync(
      {
        from: "B7",
        to: "B8",
        label: "Ejecutar searchAccounts",
        input: { toolName: "searchAccounts" },
      },
      () => ({ toolName: "searchAccounts", result: [{ id: 22 }] }),
      (result) => ({
        toolName: result.toolName,
        resultCount: result.result.length,
      }),
    );

    expect(trace.events).toMatchObject([
      { from: "B7", to: "B8", phase: "call", status: "started" },
      {
        from: "B8",
        to: "B7",
        phase: "return",
        status: "completed",
        durationMs: 7,
        output: { toolName: "searchAccounts", resultCount: 1 },
      },
    ]);
  });
});