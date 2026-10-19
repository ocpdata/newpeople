import { describe, expect, it, vi } from "vitest";
import { buildStructuredResearchSchema, runStructuredTextResearch } from "../src/structuredWebResearch.js";
import { config } from "../src/config.js";
import { interpretCustomerTurn, getCustomerTurnContractFields, getCustomerTurnProviderVariants } from "../src/commercial-intelligence/turn-contract.js";

describe("structured web research schema", () => {
  it("keeps boolean criteria as booleans rather than string placeholders", () => {
    const result = buildStructuredResearchSchema("boolean_criteria", [{ key: "includeUndated", type: "boolean" }]);
    expect(result.schema.properties.includeUndated).toEqual({ type: "boolean" });
  });
  function expandReferences(value, root) {
    if (Array.isArray(value)) return value.map((entry) => expandReferences(entry, root));
    if (!value || typeof value !== "object") return value;
    if (value.$ref) return expandReferences(root.$defs[value.$ref.split("/").at(-1)], root);
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "$defs")
      .map(([key, entry]) => [key, expandReferences(entry, root)]));
  }

  function withoutDefinitions(value) {
    if (Array.isArray(value)) return value.map(withoutDefinitions);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "definition")
      .map(([key, entry]) => [key, withoutDefinitions(entry)]));
  }

  it("shares definitions without changing any expanded provider constraint", () => {
    const fields = getCustomerTurnContractFields();
    const variants = getCustomerTurnProviderVariants(fields);
    const { schema } = buildStructuredResearchSchema("compact", fields, variants);
    const { schema: inline } = buildStructuredResearchSchema("inline", fields, withoutDefinitions(variants));
    expect(expandReferences(schema, schema)).toEqual(expandReferences(inline, inline));
    expect(JSON.stringify(schema).length).toBeLessThan(34500);
    const components = schema.$defs.componentsItem.anyOf;
    for (const variant of components) {
      for (const key of ["object", "scope", "attribution", "certainty", "continuationOf"]) {
        const name = `component${key[0].toUpperCase()}${key.slice(1)}`;
        expect(variant.properties[key]).toEqual({ $ref: `#/$defs/${name}` });
        expect(schema.$defs[name].enum).toEqual(fields.find((field) => field.key === "components")
          .items.fields.find((field) => field.key === key).enum);
      }
    }
    expect(schema.$defs.prioritySpec.properties.listSpec).toEqual({
      anyOf: [{ $ref: "#/$defs/listSpec" }, { type: "null" }],
    });
    expect(schema.$defs.historySpec.properties.period).toEqual({
      anyOf: [{ $ref: "#/$defs/period" }, { type: "null" }],
    });
    expect(schema.$defs.trendSpec.properties.comparePeriod).toEqual(schema.$defs.historySpec.properties.period);
    expect(schema.$defs.scenarioSpec.properties.period).toEqual(schema.$defs.historySpec.properties.period);
  });

  it("keeps the complete compact provider schema within structural limits", () => {
    const fields = getCustomerTurnContractFields();
    const { schema } = buildStructuredResearchSchema("compact", fields, getCustomerTurnProviderVariants(fields));
    let enums = 0, properties = 0;
    function visit(value) {
      if (!value || typeof value !== "object") return;
      if (value.enum) enums += value.enum.length;
      if (value.properties) {
        properties += Object.keys(value.properties).length;
        expect(value.additionalProperties).toBe(false);
        expect([...value.required].sort()).toEqual(Object.keys(value.properties).sort());
      }
      Object.values(value).forEach(visit);
    }
    visit(schema);
    expect(enums).toBeLessThanOrEqual(1000);
    expect(properties).toBeLessThanOrEqual(5000);
    const a08 = schema.$defs.componentsItem.anyOf.find((item) => item.properties.category.enum.includes("action.change_status"));
    expect(Object.keys(a08.properties).filter((key) => key.endsWith("Spec"))).toEqual(["stageSpec"]);
    expect(schema.$defs.stageSpec.required).toContain("evidence");
    const unavailable = schema.$defs.componentsItem.anyOf.find((item) => item.properties.category.enum.includes("action.remove_record"));
    expect(Object.keys(unavailable.properties).filter((key) => key.endsWith("Spec"))).toEqual([]);
  });
  it.each(["request", "control", "invalid_empty_request"])("passes the real B3 envelope through the shared provider boundary: %s", async (kind) => {
    const stageSpec = { mode: "start", opportunityReference: "Hardware Refresh", targetReference: "",
      request: "validate_advance", position: 0, evidence: "Valida el avance de Hardware Refresh" };
    const result = { version: 1, movement: kind === "control" ? "stop" : "new_request",
      resolution: "resolved", clarificationQuestion: "", confidence: "high",
      components: kind === "request" ? [{
        id: "c1", category: "action.change_status", text: stageSpec.evidence, object: "opportunity",
        topic: "avance", scope: "single", reference: "Hardware Refresh", attribution: "none",
        certainty: "unspecified", explicitAction: true, dependsOn: [], continuationOf: "none", stageSpec,
      }] : [] };
    const apiKey = config.openai.apiKey;
    config.openai.apiKey = "test-only";
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ output_text: JSON.stringify({ result }) })));
    try {
      const turn = interpretCustomerTurn({ question: stageSpec.evidence, classifierPrompt: { instruction: "" },
        snapshot: { account: { id: 22, name: "Totalplay" } } });
      if (kind === "invalid_empty_request") await expect(turn).rejects.toMatchObject({ code: "CUSTOMER_TURN_CONTRACT_INVALID" });
      else expect(await turn).toEqual(result);
      const schema = JSON.parse(fetch.mock.calls[0][1].body).text.format.schema;
      expect(schema.$defs.componentsItem.anyOf.flatMap((item) => item.properties.category.enum)).toHaveLength(46);
      expect(schema.properties.result.anyOf[0].properties.components).toMatchObject({
        minItems: 1, maxItems: 4, items: { $ref: "#/$defs/componentsItem" },
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      const example = JSON.parse(JSON.parse(fetch.mock.calls[0][1].body).input[1].content).expectedJsonShape;
      expect(JSON.stringify(example).length).toBeLessThan(600);
      expect(Object.keys(example.result.components[0]).some((key) => key.endsWith("Spec"))).toBe(false);
      expect(example.result.components[0].id).toBe("c1");
    } finally { config.openai.apiKey = apiKey; fetch.mockRestore(); }
  });
  const variants = [
    [{ key: "movement", type: "enum", enum: ["new_request"] },
      { key: "components", type: "array", minItems: 1, maxItems: 4, items: { type: "string", example: "request" } }],
    [{ key: "movement", type: "enum", enum: ["stop"] },
      { key: "components", type: "array", minItems: 0, maxItems: 4, items: { type: "string" } }],
  ];
  it("uses a nested union so business requests cannot have empty components while controls can", () => {
    const { schema } = buildStructuredResearchSchema("turn", [], variants);
    expect(schema.required).toEqual(["result"]);
    expect(schema).not.toHaveProperty("anyOf");
    const [request, control] = schema.properties.result.anyOf;
    expect(request.properties.movement.enum).toEqual(["new_request"]);
    expect(request.properties.components.minItems).toBe(1);
    expect(request.properties.components.maxItems).toBe(4);
    expect(control.properties.movement.enum).toEqual(["stop"]);
    expect(control.properties.components.minItems).toBe(0);
  });
  it.each([
    { movement: "new_request", components: ["request"] },
    { movement: "stop", components: [] },
  ])("unwraps the provider envelope without changing the internal result: %j", async (result) => {
    const apiKey = config.openai.apiKey;
    config.openai.apiKey = "test-only";
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ output_text: JSON.stringify({ result }) })));
    try {
      expect(await runStructuredTextResearch({ schemaName: "turn", systemPrompt: "Test", subject: "synthetic",
        context: {}, currentValues: {}, fields: [], responseVariants: variants })).toEqual(result);
      const payload = JSON.parse(fetch.mock.calls[0][1].body);
      expect(JSON.parse(payload.input[1].content).expectedJsonShape).toEqual({
        result: { movement: "new_request", components: ["request"] },
      });
    } finally { config.openai.apiKey = apiKey; fetch.mockRestore(); }
  });
  it.each([{}, { movement: "new_request", components: [] }, { result: [] }, { result: {}, extra: true }])(
    "rejects a malformed envelope instead of returning a success-shaped default: %j", async (output) => {
      const apiKey = config.openai.apiKey;
      config.openai.apiKey = "test-only";
      const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ output_text: JSON.stringify(output) })));
      try {
        await expect(runStructuredTextResearch({ schemaName: "turn", systemPrompt: "Test", subject: "synthetic",
          context: {}, currentValues: {}, fields: [], responseVariants: variants }))
          .rejects.toMatchObject({ code: "STRUCTURED_RESPONSE_INVALID_ENVELOPE" });
      } finally { config.openai.apiKey = apiKey; fetch.mockRestore(); }
    });
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
