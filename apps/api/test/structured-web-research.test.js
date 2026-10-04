import { describe, expect, it } from "vitest";
import { buildStructuredResearchSchema } from "../src/structuredWebResearch.js";

describe("structured web research schema", () => {
  it("supports numeric fields used by structured response contracts", () => {
    const result = buildStructuredResearchSchema("numeric_contract", [
      { key: "accountId", type: "number", example: 7 },
    ]);

    expect(result.schema.properties.accountId).toEqual({ type: "number" });
    expect(result.schema.required).toEqual(["accountId"]);
  });
});
