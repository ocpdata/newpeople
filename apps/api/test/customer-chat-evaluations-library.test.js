import { beforeEach, describe, expect, it, vi } from "vitest";
const { query, config } = vi.hoisted(() => ({
  query: vi.fn(), config: { pinecone: { apiKey: "test-key" } },
}));
vi.mock("../src/db.js", () => ({ query }));
vi.mock("../src/config.js", () => ({ config }));
import { getEvaluationLibraryReadiness } from "../src/customer-chat-evaluations/library-readiness.js";

describe("Evaluation RAG preparation (no provider calls or writes)", () => {
  beforeEach(() => {
    query.mockReset();
    config.pinecone.apiKey = "test-key";
    query.mockResolvedValueOnce([{ TABLE_NAME: "documents" }, { TABLE_NAME: "topics" }])
      .mockResolvedValueOnce([{ total: 3 }]);
  });
  it("reports missing key without inspecting or modifying the catalog", async () => {
    config.pinecone.apiKey = " ";
    expect(await getEvaluationLibraryReadiness()).toMatchObject({ ready: false, eligibleDocuments: 0 });
    expect(query).not.toHaveBeenCalled();
  });
  it("reports absent schema without creating tables", async () => {
    query.mockReset().mockResolvedValue([]);
    expect(await getEvaluationLibraryReadiness()).toMatchObject({ ready: false, eligibleDocuments: 0 });
    expect(query).toHaveBeenCalledTimes(1);
  });
  it("requires active BlueCat documents and explicitly limits what readiness proves", async () => {
    const result = await getEvaluationLibraryReadiness();
    expect(result).toMatchObject({ ready: true, eligibleDocuments: 3, reason: expect.stringContaining("No verifica") });
    expect(query.mock.calls[1][0]).toContain("t.is_active = 1");
    expect(query.mock.calls[1][0]).toContain("d.active_version_id IS NOT NULL");
    expect(query.mock.calls[1][0]).toContain("bluecat");
    expect(query.mock.calls.every(([sql]) => sql.trim().startsWith("SELECT"))).toBe(true);
  });
  it("does not present an empty local catalog as ready even if the key exists", async () => {
    query.mockReset().mockResolvedValueOnce([{}, {}]).mockResolvedValueOnce([{ total: 0 }]);
    expect(await getEvaluationLibraryReadiness()).toMatchObject({ ready: false, eligibleDocuments: 0 });
  });
  it("propagates database errors and invalid counts", async () => {
    query.mockReset().mockRejectedValueOnce(new Error("read failed"));
    await expect(getEvaluationLibraryReadiness()).rejects.toThrow("read failed");
    query.mockReset().mockResolvedValueOnce([{}, {}]).mockResolvedValueOnce([]);
    await expect(getEvaluationLibraryReadiness()).rejects.toThrow("conteo");
  });
});
