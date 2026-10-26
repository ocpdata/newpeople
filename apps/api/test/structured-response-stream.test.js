import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { runStructuredTextResearch } from "../src/structuredWebResearch.js";

const sse = (events) => new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
  { headers: { "content-type": "text/event-stream" } });
const request = () => runStructuredTextResearch({ schemaName: "test_stream", systemPrompt: "x", subject: "x", context: {},
  currentValues: {}, fields: [{ key: "answer", type: "string" }] });

describe("respuestas del proveedor en streaming", () => {
  const apiKey = config.openai.apiKey;
  afterEach(() => { config.openai.apiKey = apiKey; vi.restoreAllMocks(); });

  it("pide streaming y usa la respuesta final del flujo", async () => {
    config.openai.apiKey = "test-only";
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(sse([
      { type: "response.created", response: { id: "r1" } },
      { type: "response.output_text.delta", delta: "{\"ans" },
      { type: "response.completed", response: { id: "r1", output_text: JSON.stringify({ answer: "hola" }) } },
    ]));
    expect(await request()).toEqual({ answer: "hola" });
    expect(JSON.parse(fetch.mock.calls[0][1].body).stream).toBe(true);
  });

  it("convierte un fallo del flujo en un error reintentable con su estado", async () => {
    config.openai.apiKey = "test-only";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(sse([
      { type: "response.created", response: { id: "r1" } },
      { type: "response.failed", response: { id: "r1", error: { code: "server_error", message: "boom" } } },
    ]));
    await expect(request()).rejects.toThrow(/^OpenAI web search failed: 500 /);
  });

  it("corta un flujo que deja de enviar datos con un error reintentable", async () => {
    config.openai.apiKey = "test-only";
    const idle = config.openai.streamIdleTimeoutMs;
    config.openai.streamIdleTimeoutMs = 30;
    const body = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(`event: response.created\ndata: ${JSON.stringify({ type: "response.created" })}\n\n`));
    } });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { headers: { "content-type": "text/event-stream" } }));
    try {
      await expect(request()).rejects.toThrow(/^OpenAI web search failed: 504 .*no envió datos/);
    } finally { config.openai.streamIdleTimeoutMs = idle; }
  });

  it("reintenta como transitorio cuando el proveedor no envía cabeceras", async () => {
    config.openai.apiKey = "test-only";
    const timeout = config.openai.streamHeaderTimeoutMs;
    config.openai.streamHeaderTimeoutMs = 20;
    vi.spyOn(globalThis, "fetch").mockImplementation((url, init) => new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }));
    try {
      await expect(request()).rejects.toThrow(/^OpenAI web search failed: 504 El proveedor no respondió/);
    } finally { config.openai.streamHeaderTimeoutMs = timeout; }
  });

  it("corta una llamada que sigue enviando eventos sin terminar y la marca como reintentable", async () => {
    config.openai.apiKey = "test-only";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      let timer;
      const body = new ReadableStream({
        start(controller) {
          timer = setInterval(() => controller.enqueue(new TextEncoder().encode(
            `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: "x" })}\n\n`)), 5);
          init.signal.addEventListener("abort", () => { clearInterval(timer); controller.error(init.signal.reason); });
        },
        cancel() { clearInterval(timer); },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    });
    await expect(runStructuredTextResearch({ schemaName: "x", systemPrompt: "x", subject: "x", context: {}, currentValues: {},
      fields: [{ key: "answer", type: "string" }], maxDurationMs: 60 }))
      .rejects.toThrow(/^OpenAI web search failed: 504 La llamada superó 60 ms \(eventos \d+/);
  });

  it("limita los tokens de salida y reintenta una respuesta cortada por ese límite", async () => {
    config.openai.apiKey = "test-only";
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(sse([
      { type: "response.incomplete", response: { id: "r1", status: "incomplete", incomplete_details: { reason: "max_output_tokens" },
        output_text: "{\"answer\": \"aaaa" } },
    ]));
    await expect(runStructuredTextResearch({ schemaName: "x", systemPrompt: "x", subject: "x", context: {}, currentValues: {},
      fields: [{ key: "answer", type: "string" }], maxOutputTokens: 100 })).rejects.toThrow(/^OpenAI web search failed: 502 .*100 tokens/);
    expect(JSON.parse(fetch.mock.calls[0][1].body).max_output_tokens).toBe(100);
  });

  it("detecta una salida degenerada de espacios y la marca como reintentable", async () => {
    config.openai.apiKey = "test-only";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(sse([
      { type: "response.output_text.delta", delta: "{\"answer\": \"ok\"" },
      ...Array.from({ length: 450 }, () => ({ type: "response.output_text.delta", delta: "\n" })),
      { type: "response.completed", response: { id: "r1", output_text: "{}" } },
    ]));
    await expect(request()).rejects.toThrow(/^OpenAI web search failed: 502 Salida degenerada/);
  });

  it("falla de forma explícita si el flujo termina sin resultado", async () => {
    config.openai.apiKey = "test-only";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(sse([{ type: "response.created", response: { id: "r1" } }]));
    await expect(request()).rejects.toThrow(/terminó sin resultado/);
  });
});
