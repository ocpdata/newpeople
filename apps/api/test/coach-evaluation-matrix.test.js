import { describe, expect, it } from "vitest";
import { coachLabCases, runCoachLab, runCoachLabCase } from "../src/channel-quality/lab/coach.js";

const regularCases = coachLabCases.filter((item) => !item.knownGap);
const knownGaps = coachLabCases.filter((item) => item.knownGap);
const getCase = (id) => coachLabCases.find((item) => item.id === id);

describe("Coach evaluation matrix", () => {
  it.each(regularCases)("executes case $id", (testCase) => {
    const result = runCoachLabCase(testCase);
    expect(result.error).toBeNull();
    expect(result.passed).toBe(true);
  });

  // When a gap is fixed, this test fails on purpose: remove knownGap from the case so it joins the main score.
  it.each(knownGaps)("still documents the known gap $id", (testCase) => {
    expect(testCase.note).toBeTruthy();
    expect(runCoachLabCase(testCase).passed).toBe(false);
  });

  it("keeps the documented cases addressable by stable unique IDs", () => {
    expect(new Set(coachLabCases.map((item) => item.id)).size).toBe(coachLabCases.length);
    expect(coachLabCases.length).toBeGreaterThanOrEqual(30);
    expect(getCase("COACH-ACCOUNT-001").question).toContain("Totalplay");
    expect(getCase("COACH-ACTION-001").kind).toBe("operation");
  });

  it("reports one score for the quality gate and tracks known gaps apart", () => {
    const { groups, results } = runCoachLab();
    expect(results).toEqual([]);
    expect(groups.cases).toEqual({ passed: regularCases.length, total: regularCases.length });
    expect(groups.known_gaps_fixed).toEqual({ passed: 0, total: knownGaps.length });
  });
});
