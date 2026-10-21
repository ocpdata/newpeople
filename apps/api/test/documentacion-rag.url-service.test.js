import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cleanupTempFilesMock,
  config,
  ensureSchemaMock,
  importRagSourceUrlMock,
  parseMultipartFilesMock,
  queryMock,
  uploadRagFileMock,
} = vi.hoisted(() => ({
  cleanupTempFilesMock: vi.fn(),
  config: {
    pinecone: { maxFileBytes: 50 * 1024 * 1024 },
  },
  ensureSchemaMock: vi.fn(),
  importRagSourceUrlMock: vi.fn(),
  parseMultipartFilesMock: vi.fn(),
  queryMock: vi.fn(),
  uploadRagFileMock: vi.fn(),
}));

vi.mock("../src/config.js", () => ({ config }));
vi.mock("../src/db.js", () => ({ query: queryMock }));
vi.mock("../src/opportunity-documents/service.js", () => ({
  cleanupTempFiles: cleanupTempFilesMock,
  parseMultipartFiles: parseMultipartFilesMock,
}));
vi.mock("../src/documentacion-rag/schema.js", () => ({
  buildRagPublicId: vi.fn(() => "rag-document-1"),
  ensureDocumentacionRagSchema: ensureSchemaMock,
}));
vi.mock("../src/documentacion-rag/pinecone.js", () => ({
  deleteRagFile: vi.fn(),
  describeRagOperation: vi.fn(),
  generateRagDocumentSummary: vi.fn(),
  isPineconeConfigured: vi.fn(() => true),
  retrieveRagContext: vi.fn(),
  uploadRagFile: uploadRagFileMock,
}));
vi.mock("../src/documentacion-rag/url-import.js", () => ({
  importRagSourceUrl: importRagSourceUrlMock,
}));

describe("Documentación RAG URL upload service", () => {
  beforeEach(() => {
    queryMock.mockReset();
    parseMultipartFilesMock.mockReset();
    uploadRagFileMock.mockReset();
    importRagSourceUrlMock.mockReset();
    cleanupTempFilesMock.mockReset();
    ensureSchemaMock.mockReset();

    queryMock.mockImplementation(async (sql) => {
      if (sql.includes("FROM documentacion_rag_topics")) {
        return [{ id: 11, public_id: "topic-sales", name: "Ventas" }];
      }
      return { affectedRows: 1 };
    });
    parseMultipartFilesMock.mockResolvedValue({
      fields: {
        sourceUrl: "https://example.com/guide",
        topicId: "topic-sales",
      },
      files: [],
    });
    importRagSourceUrlMock.mockResolvedValue({
      buffer: Buffer.from("# Guía"),
      fileName: "Guía.md",
      mimeType: "text/markdown",
      byteSize: 8,
      sourceType: "web_page",
      sourceUrl: "https://example.com/guide",
    });
    uploadRagFileMock.mockResolvedValue({
      id: "operation-1",
      file_id: "file-1",
    });
  });

  it("imports the link and persists its source metadata with the pending upload", async () => {
    const { uploadDocumentacionRagDocument } = await import(
      "../src/documentacion-rag/service.js"
    );

    await expect(
      uploadDocumentacionRagDocument({
        user: { id: 7 },
        req: {},
      }),
    ).resolves.toBe("rag-document-1");

    expect(importRagSourceUrlMock).toHaveBeenCalledWith(
      "https://example.com/guide",
      { maxBytes: 50 * 1024 * 1024 },
    );
    expect(uploadRagFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        buffer: Buffer.from("# Guía"),
        fileName: "Guía.md",
        mimeType: "text/markdown",
      }),
    );
    const insert = queryMock.mock.calls.find(([sql]) =>
      sql.includes("INSERT INTO documentacion_rag_documents"),
    );
    expect(insert[1]).toEqual(
      expect.arrayContaining([
        "web_page",
        "https://example.com/guide",
        "operation-1",
      ]),
    );
    expect(cleanupTempFilesMock).toHaveBeenCalledWith([]);
  });

  it("keeps replacement source metadata pending until Pinecone completes", async () => {
    queryMock.mockImplementation(async (sql) => {
      if (sql.includes("FROM documentacion_rag_documents d")) {
        return [
          {
            id: 22,
            public_id: "rag-existing",
            topic_id: 11,
            topic_public_id: "topic-sales",
            topic_name: "Ventas",
            status: "available",
            active_file_id: "active-file",
            active_version_id: "active-version",
            original_file_name: "Current.pdf",
            mime_type: "application/pdf",
            byte_size: 100,
          },
        ];
      }
      return { affectedRows: 1 };
    });
    const { replaceDocumentacionRagDocument } = await import(
      "../src/documentacion-rag/service.js"
    );

    await replaceDocumentacionRagDocument({
      user: { id: 7 },
      documentPublicId: "rag-existing",
      req: {},
    });

    const update = queryMock.mock.calls.find(([sql]) =>
      sql.includes("pending_source_type = ?"),
    );
    expect(update[1][3]).toBe("web_page");
    expect(update[1][4]).toBe("https://example.com/guide");
    expect(update[0]).toContain("status = 'replacing'");
    expect(uploadRagFileMock).toHaveBeenCalled();
  });
});
