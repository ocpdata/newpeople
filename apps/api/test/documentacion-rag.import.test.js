import { beforeEach, describe, expect, it, vi } from "vitest";

const { query, listRagFiles, connectionQuery, withTransaction } = vi.hoisted(() => ({
  query: vi.fn(),
  listRagFiles: vi.fn(),
  connectionQuery: vi.fn(),
  withTransaction: vi.fn(),
}));
vi.mock("../src/config.js", () => ({ config: { pinecone: { assistantName: "library" } } }));
vi.mock("../src/db.js", () => ({ query, withTransaction }));
vi.mock("../src/documentacion-rag/pinecone.js", () => ({ listRagFiles }));
vi.mock("../src/documentacion-rag/schema.js", () => ({ ensureDocumentacionRagSchema: vi.fn() }));

import { importPineconeDocuments, previewPineconeImport } from "../src/documentacion-rag/import-service.js";

const topic = { id: 12, public_id: "topic-bluecat", name: "BlueCat", is_active: 1 };
const file = {
  id: "file-1", name: "BlueCat.pdf", status: "Available",
  metadata: { document_id: "doc-1", version_id: "version-1", topic_id: "topic-bluecat", topic_name: "BlueCat" },
};
const selection = { fileId: "file-1", documentId: "doc-1", versionId: "version-1" };
const importFiles = (selections = [selection]) => importPineconeDocuments({
  user: { id: 8 }, assistantName: "library", selections,
});

describe("Pinecone catalog import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listRagFiles.mockResolvedValue({ assistantName: "library", files: [file] });
    query.mockImplementation(async (sql) => sql.includes("FROM documentacion_rag_topics") ? [topic] : []);
    connectionQuery.mockImplementation(async (sql) => {
      if (sql.includes("FROM documentacion_rag_topics")) return [[topic]];
      if (sql.includes("FROM documentacion_rag_documents")) return [[]];
      return [{ insertId: 33 }];
    });
    withTransaction.mockImplementation((work) => work({ query: connectionQuery }));
  });

  it("previews missing documents without writing or exposing remote URLs", async () => {
    const preview = await previewPineconeImport();
    expect(preview.files[0]).toMatchObject({ status: "importable", fileId: "file-1", localTopicId: topic.public_id });
    expect(query.mock.calls.every(([sql]) => sql.startsWith("SELECT"))).toBe(true);
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["Processing", "Archivo no disponible"],
    ["ProcessingFailed", "Archivo no disponible"],
    ["Deleting", "Archivo no disponible"],
  ])("blocks %s files", async (status, reason) => {
    listRagFiles.mockResolvedValue({ files: [{ ...file, status }] });
    expect((await previewPineconeImport()).files[0]).toMatchObject({
      status: "blocked", reason: expect.stringContaining(reason),
    });
  });

  it("blocks missing metadata and duplicate versions", async () => {
    listRagFiles.mockResolvedValue({ files: [{ ...file, metadata: null }] });
    expect((await previewPineconeImport()).files[0].status).toBe("blocked");
    listRagFiles.mockResolvedValue({ files: [file, { ...file, id: "file-2" }] });
    expect((await previewPineconeImport()).files.every((entry) => entry.status === "blocked")).toBe(true);
  });

  it("skips exact local matches and blocks different local versions", async () => {
    query.mockResolvedValueOnce([topic]).mockResolvedValueOnce([{
      public_id: "doc-1", active_file_id: "file-1", active_version_id: "version-1",
    }]);
    expect((await previewPineconeImport()).files[0].status).toBe("existing");
    query.mockResolvedValueOnce([topic]).mockResolvedValueOnce([{
      public_id: "doc-1", active_file_id: "old-file", active_version_id: "old-version",
    }]);
    expect((await previewPineconeImport()).files[0].status).toBe("blocked");
  });

  it("blocks inactive themes and requests mapping for same-name different-ID themes", async () => {
    query.mockResolvedValueOnce([{ ...topic, is_active: 0 }]).mockResolvedValueOnce([]);
    expect((await previewPineconeImport()).files[0].status).toBe("blocked");
    query.mockResolvedValueOnce([{ ...topic, public_id: "local-topic" }]).mockResolvedValueOnce([]);
    expect((await previewPineconeImport()).files[0].status).toBe("topic_conflict");
  });

  it("imports preserving document/file/version IDs and locks before reading catalog", async () => {
    expect((await importFiles()).results[0].status).toBe("imported");
    expect(connectionQuery.mock.calls[1][0]).toContain("FOR UPDATE");
    expect(connectionQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO documentacion_rag_documents"),
      ["doc-1", 12, "BlueCat.pdf", "application/pdf", "file-1", "version-1", 8],
    );
  });

  it("creates missing topics transactionally", async () => {
    connectionQuery.mockImplementation(async (sql) =>
      sql.startsWith("SELECT") ? [[]] : [{ insertId: 33 }]);
    expect((await importFiles()).results[0].status).toBe("imported");
    expect(connectionQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO documentacion_rag_topics"),
      ["topic-bluecat", "BlueCat", 8, 8],
    );
  });

  it("accepts explicit local topic mapping", async () => {
    connectionQuery.mockImplementation(async (sql) => {
      if (sql.includes("FROM documentacion_rag_topics")) return [[{ ...topic, public_id: "local-topic" }]];
      return sql.startsWith("SELECT") ? [[]] : [{ insertId: 33 }];
    });
    expect((await importFiles([{ ...selection, topicId: "local-topic" }])).results[0].status).toBe("imported");
    expect(connectionQuery.mock.calls.some(([sql]) => sql.includes("INSERT INTO documentacion_rag_topics"))).toBe(false);
  });

  it("revalidates deleted files, changed metadata and Assistant", async () => {
    listRagFiles.mockResolvedValue({ files: [] });
    expect((await importFiles()).results[0].status).toBe("blocked");
    listRagFiles.mockResolvedValue({ files: [{ ...file, metadata: { ...file.metadata, version_id: "changed" } }] });
    expect((await importFiles()).results[0].status).toBe("blocked");
    await expect(importPineconeDocuments({
      user: { id: 8 }, assistantName: "different", selections: [selection],
    })).rejects.toMatchObject({ status: 409 });
  });

  it("repeated imports skip documents already recorded under the transaction lock", async () => {
    connectionQuery.mockImplementation(async (sql) => {
      if (sql.includes("FROM documentacion_rag_topics")) return [[topic]];
      if (sql.includes("FROM documentacion_rag_documents")) return [[{
        public_id: "doc-1", active_file_id: "file-1", active_version_id: "version-1",
      }]];
      return [{}];
    });
    expect((await importFiles()).results[0].status).toBe("existing");
    expect(connectionQuery.mock.calls.some(([sql]) => sql.includes("INSERT INTO documentacion_rag_documents"))).toBe(false);
  });

  it("concurrent requests re-read the catalog after acquiring the import lock", async () => {
    const recorded = [];
    let queue = Promise.resolve();
    withTransaction.mockImplementation((work) => {
      const pending = queue.then(() => work({ query: connectionQuery }));
      queue = pending;
      return pending;
    });
    connectionQuery.mockImplementation(async (sql, params) => {
      if (sql.includes("FROM documentacion_rag_topics")) return [[topic]];
      if (sql.includes("FROM documentacion_rag_documents")) return [[...recorded]];
      if (sql.includes("INSERT INTO documentacion_rag_documents")) {
        recorded.push({ public_id: params[0], active_file_id: params[4], active_version_id: params[5] });
      }
      return [{ insertId: 33 }];
    });
    const results = await Promise.all([importFiles(), importFiles()]);
    expect(results.map((result) => result.results[0].status)).toEqual(["imported", "existing"]);
    expect(connectionQuery.mock.calls.filter(([sql]) => sql.includes("INSERT INTO documentacion_rag_documents"))).toHaveLength(1);
    expect(connectionQuery.mock.calls.filter(([sql]) => sql.includes("FOR UPDATE"))).toHaveLength(2);
  });

  it("propagates provider and database failures instead of claiming success", async () => {
    listRagFiles.mockRejectedValueOnce(new Error("provider failed"));
    await expect(previewPineconeImport()).rejects.toThrow("provider failed");
    connectionQuery.mockRejectedValueOnce(new Error("database failed"));
    await expect(importFiles()).rejects.toThrow("database failed");
  });
});
