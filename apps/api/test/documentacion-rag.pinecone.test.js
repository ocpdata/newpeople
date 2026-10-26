import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { pineconeConfig } = vi.hoisted(() => ({
  pineconeConfig: {
    pinecone: {
      apiKey: "test-api-key",
      assistantName: "test-assistant",
      assistantRegion: "us",
      apiVersion: "2026-07",
      maxFileBytes: 50 * 1024 * 1024,
    },
  },
}));

vi.mock("../src/config.js", () => ({ config: pineconeConfig }));

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Pinecone Assistant REST client", () => {
  it("lista archivos sin crear Assistants ni exponer signed_url", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: "Ready", host: "assistant.example.com" }))
      .mockResolvedValueOnce(jsonResponse({ files: [{
        id: "file-1", name: "guide.pdf", status: "Available",
        metadata: { document_id: "doc-1" }, signed_url: "https://private.example.com",
      }] }));
    vi.stubGlobal("fetch", fetchMock);
    const { listRagFiles } = await import("../src/documentacion-rag/pinecone.js");
    const result = await listRagFiles();
    expect(result.files[0]).not.toHaveProperty("signed_url");
    expect(fetchMock.mock.calls[1][0]).toBe("https://assistant.example.com/assistant/files/test-assistant");
    expect(fetchMock.mock.calls.every(([, options]) => options.method === "GET")).toBe(true);
  });

  it("no crea un Assistant ausente durante la importación", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: "not found" }, 404));
    vi.stubGlobal("fetch", fetchMock);
    const { listRagFiles } = await import("../src/documentacion-rag/pinecone.js");
    await expect(listRagFiles()).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rechaza listados malformados en lugar de tratarlos como vacíos", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ host: "assistant.example.com", status: "Ready" }))
      .mockResolvedValueOnce(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    const { listRagFiles } = await import("../src/documentacion-rag/pinecone.js");
    await expect(listRagFiles()).rejects.toMatchObject({ status: 502 });
  });

  beforeEach(() => {
    pineconeConfig.pinecone.apiKey = "test-api-key";
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sube el archivo al host del Assistant con metadatos y versión de API", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({ name: "test-assistant", host: "assistant.example.com" }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: "operation-1", file_id: "rag-file-1" }, 202));
    vi.stubGlobal("fetch", fetchMock);
    const { uploadRagFile } = await import("../src/documentacion-rag/pinecone.js");

    const result = await uploadRagFile({
      buffer: Buffer.from("contenido"),
      fileName: "guia.pdf",
      mimeType: "application/pdf",
      metadata: { document_id: "doc-1", version_id: "version-1" },
    });

    expect(result).toEqual({ id: "operation-1", file_id: "rag-file-1" });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.pinecone.io/assistant/assistants/test-assistant",
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://assistant.example.com/assistant/files/test-assistant",
    );
    expect(fetchMock.mock.calls[1][1].method).toBe("POST");
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({
      "Api-Key": "test-api-key",
      "X-Pinecone-Api-Version": "2026-07",
    });
    expect(fetchMock.mock.calls[1][1].body.get("metadata")).toBe(
      JSON.stringify({ document_id: "doc-1", version_id: "version-1" }),
    );
    expect(fetchMock.mock.calls[1][1].body.get("file").name).toBe("guia.pdf");
  });

  it("envía filtros y top-k al endpoint de contexto", async () => {
    const filter = {
      $and: [{ document_id: { $eq: "doc-1" } }, { version_id: { $eq: "v1" } }],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({ name: "test-assistant", host: "https://assistant.example.com" }),
      )
      .mockResolvedValueOnce(jsonResponse({ snippets: [{ content: "Fragmento" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const { retrieveRagContext } = await import("../src/documentacion-rag/pinecone.js");

    await expect(
      retrieveRagContext({ query: "¿Cómo funciona?", filter, topK: 6 }),
    ).resolves.toEqual([{ content: "Fragmento" }]);

    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://assistant.example.com/assistant/chat/test-assistant/context",
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      query: "¿Cómo funciona?",
      top_k: 6,
      filter,
    });
  });

  it("registra los tokens de contexto y de respuesta que reporta Pinecone", async () => {
    const recordAiServiceUsage = vi.fn().mockResolvedValue(undefined);
    vi.doMock("../src/ai-services/store.js", () => ({
      recordAiServiceUsage,
      recordAiServiceError: vi.fn(),
    }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({ name: "test-assistant", host: "https://assistant.example.com", status: "Ready" }),
      )
      .mockResolvedValueOnce(jsonResponse({
        snippets: [{ content: "Fragmento" }],
        usage: { prompt_tokens: 1200, completion_tokens: 0 },
      }))
      .mockResolvedValueOnce(jsonResponse({
        message: { content: "Resumen." },
        usage: { prompt_tokens: 900, completion_tokens: 40 },
      }));
    vi.stubGlobal("fetch", fetchMock);
    const { retrieveRagContext, generateRagDocumentSummary } = await import(
      "../src/documentacion-rag/pinecone.js"
    );

    await retrieveRagContext({
      query: "¿Cómo funciona?",
      featureCode: "commercial_intelligence.account_chat.library",
      userId: 7,
    });
    await generateRagDocumentSummary({ fileName: "guia.pdf", documentId: "doc-1", versionId: "v1", userId: 3 });

    await vi.waitFor(() => expect(recordAiServiceUsage).toHaveBeenCalledTimes(3));
    expect(recordAiServiceUsage.mock.calls.map(([details]) => details)).toEqual([
      {
        provider: "pinecone",
        metric: "context_tokens",
        units: 1200,
        featureCode: "commercial_intelligence.account_chat.library",
        userId: 7,
      },
      { provider: "pinecone", metric: "chat_input_tokens", units: 900, featureCode: "documentacion_rag.summary", userId: 3 },
      { provider: "pinecone", metric: "chat_output_tokens", units: 40, featureCode: "documentacion_rag.summary", userId: 3 },
    ]);
    vi.doUnmock("../src/ai-services/store.js");
  });

  it("espera a que el Assistant recién creado esté listo", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({
          name: "test-assistant",
          host: "assistant.example.com",
          status: "Initializing",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          name: "test-assistant",
          host: "assistant.example.com",
          status: "Ready",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { getPineconeAssistant } = await import("../src/documentacion-rag/pinecone.js");

    const assistantPromise = getPineconeAssistant();
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(assistantPromise).resolves.toMatchObject({
      name: "test-assistant",
      host: "https://assistant.example.com",
      status: "Ready",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("filtra el resumen al documento y versión solicitados", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({
          name: "test-assistant",
          host: "https://assistant.example.com",
          status: "Ready",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ message: { content: "  Resumen breve.  " } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { generateRagDocumentSummary } = await import("../src/documentacion-rag/pinecone.js");

    await expect(
      generateRagDocumentSummary({
        fileName: "guia.pdf",
        documentId: "doc-1",
        versionId: "version-1",
      }),
    ).resolves.toBe("Resumen breve.");

    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      filter: {
        $and: [
          { document_id: { $eq: "doc-1" } },
          { version_id: { $eq: "version-1" } },
        ],
      },
      messages: [{ role: "user" }],
    });
  });

  it("falla explícitamente cuando falta la clave de Pinecone", async () => {
    pineconeConfig.pinecone.apiKey = "";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { getPineconeAssistant } = await import("../src/documentacion-rag/pinecone.js");

    await expect(getPineconeAssistant()).rejects.toMatchObject({
      code: "PINECONE_NOT_CONFIGURED",
      status: 503,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
