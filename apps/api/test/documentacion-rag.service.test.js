import { beforeEach, describe, expect, it, vi } from "vitest";

const { config, queryMock, retrieveRagContextMock } = vi.hoisted(() => ({
  config: {
    pinecone: {
      apiKey: "test-api-key",
      maxFileBytes: 50 * 1024 * 1024,
    },
    documents: { storage: { maxSessionBytes: 125 * 1024 * 1024 } },
  },
  queryMock: vi.fn(),
  retrieveRagContextMock: vi.fn(),
}));

vi.mock("../src/config.js", () => ({ config }));
vi.mock("../src/db.js", () => ({ query: queryMock }));
vi.mock("../src/opportunity-documents/service.js", () => ({
  cleanupTempFiles: vi.fn(),
  parseMultipartFiles: vi.fn(),
}));
vi.mock("../src/documentacion-rag/schema.js", () => ({
  buildRagPublicId: vi.fn(),
  ensureDocumentacionRagSchema: vi.fn(),
}));
vi.mock("../src/documentacion-rag/pinecone.js", () => ({
  deleteRagFile: vi.fn(),
  describeRagOperation: vi.fn(),
  generateRagDocumentSummary: vi.fn(),
  isPineconeConfigured: vi.fn(() => true),
  retrieveRagContext: retrieveRagContextMock,
  uploadRagFile: vi.fn(),
}));

describe("Documentación RAG retrieval", () => {
  beforeEach(() => {
    queryMock.mockReset();
    retrieveRagContextMock.mockReset();
  });

  it("limita la recuperación a documentos y versiones activas en temas activos", async () => {
    queryMock.mockResolvedValue([
      { public_id: "doc-1", active_version_id: "version-1" },
      { public_id: "doc-2", active_version_id: "version-2" },
    ]);
    retrieveRagContextMock.mockResolvedValue([
      { content: " Evidencia ", score: 0.92, reference: { file: { id: "secret-id" } } },
      { content: "   ", score: 0.2 },
    ]);
    const { retrieveDocumentacionRagEvidence } = await import(
      "../src/documentacion-rag/service.js"
    );

    await expect(
      retrieveDocumentacionRagEvidence({ prompt: "Consulta" }),
    ).resolves.toEqual([{ content: "Evidencia", score: 0.92 }]);
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("d.status IN ('available', 'replacing')"),
    );
    expect(queryMock.mock.calls[0][0]).toContain("t.is_active = 1");
    expect(retrieveRagContextMock).toHaveBeenCalledWith({
      query: "Consulta",
      topK: 6,
      filter: {
        $or: [
          {
            $and: [
              { document_id: { $eq: "doc-1" } },
              { version_id: { $eq: "version-1" } },
            ],
          },
          {
            $and: [
              { document_id: { $eq: "doc-2" } },
              { version_id: { $eq: "version-2" } },
            ],
          },
        ],
      },
    });
  });

  it("no consulta Pinecone cuando no hay documentos disponibles", async () => {
    queryMock.mockResolvedValue([]);
    const { retrieveDocumentacionRagEvidence } = await import(
      "../src/documentacion-rag/service.js"
    );

    await expect(
      retrieveDocumentacionRagEvidence({ prompt: "Consulta" }),
    ).resolves.toEqual([]);
    expect(retrieveRagContextMock).not.toHaveBeenCalled();
  });
});
