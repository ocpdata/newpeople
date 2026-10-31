import { afterEach, describe, expect, it, vi } from "vitest";
import { promptCacheFields } from "../src/ai-prompt-cache.js";
import { config } from "../src/config.js";
import { runStructuredTextResearch } from "../src/structuredWebResearch.js";
import {
  TURN_BUDGET_CODE,
  TURN_CANCELLED_CODE,
  abortActiveTurn,
  currentTurnSignal,
  registerProviderCall,
  runWithTurnContext,
  turnCallCount,
} from "../src/commercial-intelligence/turn-context.js";

const request = {
  schemaName: "turn_budget_test", systemPrompt: "Test", subject: "synthetic", context: {}, currentValues: {},
  fields: [{ key: "answer", type: "string" }],
};

describe("campos de caché de prompts", () => {
  const openai = "https://api.openai.com/v1";
  it("envía una clave por función solo a OpenAI y solo si está habilitada", () => {
    expect(promptCacheFields({ featureCode: "x.y", baseUrl: openai, enabled: true, retention: "" }))
      .toEqual({ prompt_cache_key: "np:x.y" });
    expect(promptCacheFields({ featureCode: "x.y", baseUrl: openai, enabled: false })).toEqual({});
    expect(promptCacheFields({ featureCode: "x.y", baseUrl: "https://gateway.example.com/v1", enabled: true })).toEqual({});
    expect(promptCacheFields({ featureCode: "", baseUrl: openai, enabled: true })).toEqual({});
    expect(promptCacheFields({ featureCode: "x", baseUrl: "no-es-url", enabled: true })).toEqual({});
  });

  it("añade la retención solo con valores válidos y limita el largo de la clave", () => {
    expect(promptCacheFields({ featureCode: "x", baseUrl: openai, enabled: true, retention: "24h" }))
      .toEqual({ prompt_cache_key: "np:x", prompt_cache_retention: "24h" });
    expect(promptCacheFields({ featureCode: "x", baseUrl: openai, enabled: true, retention: "forever" }))
      .toEqual({ prompt_cache_key: "np:x" });
    expect(promptCacheFields({ featureCode: "f".repeat(200), baseUrl: openai, enabled: true }).prompt_cache_key).toHaveLength(64);
  });
});

describe("contexto del turno", () => {
  it("no hace nada fuera de un turno", () => {
    expect(currentTurnSignal()).toBeNull();
    expect(() => registerProviderCall()).not.toThrow();
    expect(turnCallCount()).toBe(0);
  });

  it("cuenta las llamadas y se detiene al superar el presupuesto", async () => {
    await runWithTurnContext({ jobId: 1, maxLlmCalls: 2 }, async (signal) => {
      registerProviderCall();
      registerProviderCall();
      expect(turnCallCount()).toBe(2);
      expect(() => registerProviderCall()).toThrowError(expect.objectContaining({ code: TURN_BUDGET_CODE, budgetReason: "calls" }));
      expect(signal.aborted).toBe(true);
      expect(() => registerProviderCall()).toThrowError(expect.objectContaining({ code: TURN_BUDGET_CODE }));
    });
  });

  it("aborta las llamadas en curso al cancelar y libera el registro", async () => {
    let seen;
    await runWithTurnContext({ jobId: 7, maxLlmCalls: 5 }, async (signal) => {
      seen = signal;
      expect(abortActiveTurn(7)).toBe(true);
      expect(signal.aborted).toBe(true);
      expect(() => registerProviderCall()).toThrowError(expect.objectContaining({ code: TURN_CANCELLED_CODE }));
      expect(abortActiveTurn(7)).toBe(false);
    });
    expect(seen.aborted).toBe(true);
    expect(abortActiveTurn(7)).toBe(false);
  });

  it("limita la duración total del turno", async () => {
    await runWithTurnContext({ jobId: 8, maxDurationMs: 20 }, async (signal) => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(signal.aborted).toBe(true);
      expect(() => registerProviderCall()).toThrowError(expect.objectContaining({ code: TURN_BUDGET_CODE, budgetReason: "time" }));
    });
  });

  it("aísla turnos simultáneos", async () => {
    const results = await Promise.all([1, 2].map((id) => runWithTurnContext({ jobId: id, maxLlmCalls: 1 }, async () => {
      registerProviderCall();
      await new Promise((resolve) => setTimeout(resolve, 10));
      return turnCallCount();
    })));
    expect(results).toEqual([1, 1]);
  });
});

describe("llamadas al proveedor dentro de un turno", () => {
  const apiKey = config.openai.apiKey;
  afterEach(() => { config.openai.apiKey = apiKey; vi.restoreAllMocks(); });

  it("envía la clave de caché, y la retención solo cuando está configurada", async () => {
    config.openai.apiKey = "test-only";
    const previous = { ...config.openai };
    Object.assign(config.openai, { baseUrl: "https://api.openai.com/v1", promptCacheKeyEnabled: true, promptCacheRetention: "" });
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ output_text: "{}" })));
    try {
      await runStructuredTextResearch({ ...request, aiUsageContext: { userId: 0, featureCode: "commercial_intelligence.account_chat.intent" } });
      expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ prompt_cache_key: "np:commercial_intelligence.account_chat.intent" });
      expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty("prompt_cache_retention");
      config.openai.promptCacheRetention = "24h";
      await runStructuredTextResearch(request);
      expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({ prompt_cache_retention: "24h" });
      config.openai.promptCacheKeyEnabled = false;
      await runStructuredTextResearch(request);
      expect(JSON.parse(fetch.mock.calls[2][1].body)).not.toHaveProperty("prompt_cache_key");
    } finally { Object.assign(config.openai, previous); }
  });

  it("no llama al proveedor cuando el turno fue cancelado o agotó su presupuesto", async () => {
    config.openai.apiKey = "test-only";
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ output_text: "{}" })));
    await runWithTurnContext({ jobId: 21, maxLlmCalls: 1 }, async () => {
      await runStructuredTextResearch(request);
      await expect(runStructuredTextResearch(request)).rejects.toMatchObject({ code: TURN_BUDGET_CODE });
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    await runWithTurnContext({ jobId: 22 }, async () => {
      abortActiveTurn(22);
      await expect(runStructuredTextResearch(request)).rejects.toMatchObject({ code: TURN_CANCELLED_CODE });
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("interrumpe una llamada en vuelo cuando se cancela el turno", async () => {
    config.openai.apiKey = "test-only";
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
    }));
    await runWithTurnContext({ jobId: 23 }, async () => {
      const pending = runStructuredTextResearch(request);
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      abortActiveTurn(23);
      await expect(pending).rejects.toMatchObject({ code: TURN_CANCELLED_CODE });
    });
  });

  it("no cambia el comportamiento fuera de un turno", async () => {
    config.openai.apiKey = "test-only";
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ output_text: "{\"answer\":\"hola\"}" })));
    expect(await runStructuredTextResearch(request)).toEqual({ answer: "hola" });
  });
});
