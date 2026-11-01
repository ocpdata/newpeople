import { describe, expect, it } from "vitest";
import { prospectLabCases, runProspectLab, runProspectLabCase } from "../src/channel-quality/lab/prospect.js";

const regularCases = prospectLabCases.filter((item) => !item.knownGap);
const knownGaps = prospectLabCases.filter((item) => item.knownGap);

describe("Cuenta nueva evaluation lab", () => {
  it.each(regularCases)("executes case $id", (testCase) => {
    const result = runProspectLabCase(testCase);
    expect(result.error).toBeNull();
    expect(result.passed).toBe(true);
  });

  // When a gap is fixed, this test fails on purpose: remove knownGap from the case so it joins the main score.
  it.each(knownGaps)("still documents the known gap $id", (testCase) => {
    expect(testCase.note).toBeTruthy();
    expect(runProspectLabCase(testCase).passed).toBe(false);
  });

  it("has stable unique IDs and enough cases per area", () => {
    expect(new Set(prospectLabCases.map((item) => item.id)).size).toBe(prospectLabCases.length);
    const { groups } = runProspectLab();
    expect(groups.cat_intent.total).toBeGreaterThanOrEqual(10);
    expect(groups.cat_answer.total).toBeGreaterThanOrEqual(10);
    expect(groups.cat_action.total).toBeGreaterThanOrEqual(5);
  });

  it("reports one score for the quality gate and tracks known gaps apart", () => {
    const { groups, results } = runProspectLab();
    expect(results).toEqual([]);
    expect(groups.cases).toEqual({ passed: regularCases.length, total: regularCases.length });
    expect(groups.known_gaps_fixed).toEqual({ passed: 0, total: knownGaps.length });
  });

  it("reports a failing case when the answer invents or omits data", () => {
    const broken = { ...regularCases.find((item) => item.kind === "fallback"), expected: { contains: ["dato inventado"], notContains: [] } };
    const result = runProspectLabCase(broken);
    expect(result.passed).toBe(false);
    expect(result.error).toContain("Falta «dato inventado»");
  });
});
