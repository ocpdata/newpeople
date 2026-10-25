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

  it("falla de forma explícita si el flujo termina sin resultado", async () => {
    config.openai.apiKey = "test-only";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(sse([{ type: "response.created", response: { id: "r1" } }]));
    await expect(request()).rejects.toThrow(/terminó sin resultado/);
  });
});
