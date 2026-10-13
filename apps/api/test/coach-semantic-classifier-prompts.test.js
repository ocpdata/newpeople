import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
  prompts: new Map(),
  revisions: [],
}));
vi.mock("../src/db.js", () => db);
let configuration;

describe("B3 semantic classifier configuration", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db.prompts = new Map();
    db.revisions = [];
    db.query.mockImplementation(async (sql, params = []) => {
      if (sql.includes("CREATE TABLE")) return [];
      if (sql.includes("INSERT IGNORE INTO mi_coach_semantic_classifier_prompts")) {
        const [channel, instruction] = params;
        if (!db.prompts.has(channel)) db.prompts.set(channel, { channel, instruction, version: 0 });
        return [];
      }
      if (sql.includes("FROM mi_coach_semantic_classifier_prompt_revisions")) {
        return [...db.revisions].reverse().filter((row) =>
          !params.length || (row.channel === params[0] && row.version === params[1]),
        );
      }
      if (sql.includes("FROM mi_coach_semantic_classifier_prompts")) {
        const rows = params.length ? [db.prompts.get(params[0])].filter(Boolean) : [...db.prompts.values()];
        return rows.map((row) => ({ ...row }));
      }
      if (sql.includes("INSERT INTO mi_coach_semantic_classifier_prompt_revisions")) {
        const [channel, version, instruction, created_by_user_id] = params;
        db.revisions.push({ channel, version, instruction, created_by_user_id });
        return [];
      }
      if (sql.includes("UPDATE mi_coach_semantic_classifier_prompts")) {
        const [instruction, version, updated_by_user_id, channel] = params;
        Object.assign(db.prompts.get(channel), { instruction, version, updated_by_user_id });
        return [];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    db.withTransaction.mockImplementation((work) => work({
      query: async (sql, params) => [await db.query(sql, params)],
    }));
    configuration = await import("../src/coach/semantic-classifier-prompts.js");
  });

  it("initializes separate defaults and connects only customer_account", async () => {
    const prompts = await configuration.listSemanticClassifierPrompts();
    expect(prompts.map((prompt) => prompt.channel)).toEqual(["coach", "customer_account", "prospect"]);
    expect(prompts.filter((prompt) => prompt.connected).map((prompt) => prompt.channel))
      .toEqual(["customer_account"]);
    for (const prompt of prompts) {
      expect(prompt.instruction.length).toBeLessThanOrEqual(8000);
      expect(prompt).toMatchObject({ version: 0, source: "default" });
      expect(prompt.initialInstruction).toBe(prompt.instruction);
    }
    expect(prompts[1].instruction).toContain("account_activity_history");
    expect(prompts[2].instruction).toContain("no conectada");
  });

  it("saves isolated channels and restores an immutable revision as a new version", async () => {
    await configuration.saveSemanticClassifierPrompt({
      channel: "customer_account", user: { id: 31 },
      input: { instruction: "Primera", expectedVersion: 0 },
    });
    await configuration.saveSemanticClassifierPrompt({
      channel: "customer_account", user: { id: 32 },
      input: { instruction: "Segunda", expectedVersion: 1 },
    });
    const restored = await configuration.restoreSemanticClassifierPrompt({
      channel: "customer_account", user: { id: 31 }, revisionVersion: 1,
      input: { expectedVersion: 2 },
    });
    expect(restored).toMatchObject({
      before: { version: 2, instruction: "Segunda" },
      after: { version: 3, instruction: "Primera", updatedByUserId: 31 },
    });
    const prompts = await configuration.listSemanticClassifierPrompts();
    expect(prompts[1].revisions.map((row) => row.instruction)).toEqual(["Primera", "Segunda", "Primera"]);
    expect(prompts[0].version).toBe(0);
    expect(prompts[2].version).toBe(0);
    expect(db.query.mock.calls.some(([sql]) => sql.includes("FOR UPDATE"))).toBe(true);
  });

  it("does not overwrite customized instructions on initialization", async () => {
    db.prompts.set("customer_account", {
      channel: "customer_account", version: 5, instruction: "Personalizada",
    });
    expect(await configuration.loadSemanticClassifierPrompt({ channel: "customer_account" }))
      .toMatchObject({ version: 5, instruction: "Personalizada", source: "custom" });
  });

  it("rejects stale writes and restorations without appending revisions", async () => {
    await configuration.saveSemanticClassifierPrompt({
      channel: "coach", user: { id: 31 },
      input: { instruction: "Preparada", expectedVersion: 0 },
    });
    await expect(configuration.saveSemanticClassifierPrompt({
      channel: "coach", user: { id: 32 },
      input: { instruction: "Obsoleta", expectedVersion: 0 },
    })).rejects.toMatchObject({ status: 409 });
    await expect(configuration.restoreSemanticClassifierPrompt({
      channel: "coach", user: { id: 32 }, revisionVersion: 1,
      input: { expectedVersion: 0 },
    })).rejects.toMatchObject({ status: 409 });
    expect(db.revisions).toHaveLength(1);
  });

  it.each([
    { instruction: "", expectedVersion: 0 },
    { instruction: "  ", expectedVersion: 0 },
    { instruction: "x".repeat(8001), expectedVersion: 0 },
    { instruction: "Texto", expectedVersion: -1 },
    { instruction: "Texto", expectedVersion: "0" },
    { instruction: "Texto", expectedVersion: 0, connected: true },
    { instruction: "Texto", expectedVersion: 0, fields: [] },
  ])("rejects invalid or protected settings", async (input) => {
    await expect(configuration.saveSemanticClassifierPrompt({
      channel: "customer_account", user: { id: 31 }, input,
    })).rejects.toMatchObject({ status: 400 });
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  it("accepts exactly 8000 characters and leaves disconnected channels disconnected", async () => {
    const saved = await configuration.saveSemanticClassifierPrompt({
      channel: "prospect", user: { id: 31 },
      input: { instruction: ` ${"x".repeat(8000)} `, expectedVersion: 0 },
    });
    expect(saved.after.instruction).toHaveLength(8000);
    expect(saved.after.connected).toBe(false);
  });

  it("rejects unknown channels and missing restoration versions", async () => {
    await expect(configuration.loadSemanticClassifierPrompt({ channel: "other" }))
      .rejects.toMatchObject({ status: 400 });
    expect(db.query).not.toHaveBeenCalled();
    await expect(configuration.restoreSemanticClassifierPrompt({
      channel: "coach", user: { id: 31 }, revisionVersion: 9,
      input: { expectedVersion: 0 },
    })).rejects.toMatchObject({ status: 404 });
    expect(db.revisions).toHaveLength(0);
  });

  it("surfaces storage failures and allows schema initialization to retry", async () => {
    db.query.mockRejectedValueOnce(new Error("Storage unavailable"));
    await expect(configuration.listSemanticClassifierPrompts()).rejects.toThrow("Storage unavailable");
    expect(await configuration.listSemanticClassifierPrompts()).toHaveLength(3);
    db.query.mockRejectedValueOnce(new Error("Read failed"));
    await expect(configuration.loadSemanticClassifierPrompt({ channel: "customer_account" }))
      .rejects.toThrow("Read failed");
  });
});
