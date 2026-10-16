import { describe, expect, it, vi } from "vitest";
import { buildStructuredResearchSchema, runStructuredTextResearch } from "../src/structuredWebResearch.js";
import { config } from "../src/config.js";

describe("structured web research schema", () => {
  it("supports numeric fields used by structured response contracts", () => {
    const result = buildStructuredResearchSchema("numeric_contract", [
      { key: "accountId", type: "number", example: 7 },
    ]);

    expect(result.schema.properties.accountId).toEqual({ type: "number" });
    expect(result.schema.required).toEqual(["accountId"]);
  });
  it("keeps existing sampling defaults and supports deterministic intent interpretation", async () => {
    const apiKey = config.openai.apiKey;
    config.openai.apiKey = "test-only";
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ output_text: "{}" })));
    try {
      const request = {
        schemaName: "sampling_test", systemPrompt: "Test", subject: "synthetic",
        context: {}, currentValues: {}, fields: [{ key: "answer", type: "string" }],
      };
      await runStructuredTextResearch(request);
      await runStructuredTextResearch({ ...request, temperature: 0 });
      expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty("temperature");
      expect(JSON.parse(fetch.mock.calls[1][1].body).temperature).toBe(0);
    } finally {
      config.openai.apiKey = apiKey;
      fetch.mockRestore();
    }
  });
});
