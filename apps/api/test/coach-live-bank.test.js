import { snapshotReferenceFacts } from "../src/channel-quality/live/coach-needs-snapshots.js";
import { describe, expect, it } from "vitest";
import { renderFacts } from "../src/channel-quality/live/coach-facts.js";
import needsBank from "../src/channel-quality/live/coach-needs-bank.json" with { type: "json" };
import { coachBank, coachDeterministicIssues, renderScenario, validateCoachBank } from "../src/channel-quality/live/coach-live.js";

const facts = {
  open: { count: 56, amountUsd: 10043124.77 },
  topAccounts: [{ name: "AT&T México", openCount: 14 }],
  focus: { name: "Vrf 2027", account: "Totalplay", stage: "Contacto Inicial", amountUsd: 2000000 },
};

describe("banco de Coach con IA real", () => {
  it("el banco es válido y marca como críticos los escenarios de seguridad", () => {
    expect(validateCoachBank()).toEqual([]);
    expect(coachBank.scenarios.filter((scenario) => scenario.critical).map((scenario) => scenario.id)).toEqual(["K08", "K09", "K12", "K13", "K14"]);
  });

  it("el banco de necesidades del vendedor es válido y sus marcadores existen en los datos de referencia", () => {
    expect(validateCoachBank(needsBank)).toEqual([]);
    const seller = {
      seller: { name: "Ana" }, quarter: { daysRemaining: 60 },
      me: { quotaUsd: 500000, wonUsd: 0, attainmentPct: 0, gapUsd: 500000, weeklyNeededUsd: 58000, rank: 5, pipelineWeightedUsd: 1, lowestScoreComponent: "discipline", overdue: 1, noNextStep: 4, opportunitiesCreatedLastWeek: 0, opportunitiesCreatedWeekBefore: 2, leadsLastWeek: 0, leadsWeekBefore: 1 },
      team: { size: 5 }, closed: { lost: 7, won: 9, decided: 16, winRatePct: 56.3, avgCycleDays: 19 }, created: { thisMonth: 3, lastMonth: 2 }, trend: { lastWeekCreated: 1, weekBeforeCreated: 2 },
      commission: { productPct: 4, servicePct: 6, renewalPct: 2, totalAmount: 0, acceptedSales: 0, attainmentPct: 0, missingToEnable: 350000 }, focus: { name: "Vrf", account: "Totalplay", stage: "Contacto Inicial" },
      snapshots: snapshotReferenceFacts({ seeded: true, current: { openPipelineUsd: 362000, quarterWeightedUsd: 48700, scoreTotal: 2.06, rankPosition: 5, overdueCount: 1, noNextStepCount: 4 }, now: new Date(2026, 10, 4) }),
    };
    for (const scenario of needsBank.scenarios) expect(() => renderScenario(scenario, seller)).not.toThrow();
  });

  it("calcula los cambios esperados de la historia sembrada y los apaga sin historia", () => {
    const current = { openPipelineUsd: 362000, quarterWeightedUsd: 48700, scoreTotal: 2.06, rankPosition: 5, overdueCount: 1, noNextStepCount: 4 };
    const seeded = snapshotReferenceFacts({ seeded: true, current, now: new Date(2026, 10, 4) });
    expect(seeded).toMatchObject({ currentWeek: "2026-11-02", previousWeek: "2026-10-26", fourWeeksAgoWeek: "2026-10-05" });
    expect(seeded.changeVsPreviousWeek).toMatchObject({ openPipelineUsd: 22000, scoreTotal: -2.94, rankPosition: 1 });
    expect(seeded.changeVsFourWeeksAgo).toMatchObject({ openPipelineUsd: 62000, rankPosition: 2 });
    expect(snapshotReferenceFacts({ seeded: false, current }).changeVsPreviousWeek.openPipelineUsd).toBe("n/d");
  });

  it("todas las afirmaciones de contenido son obligatorias para aprobar", () => {
    const optional = coachBank.scenarios.flatMap((scenario) => scenario.turns.flatMap((turn) => turn.mustInclude.filter((item) => !item.critical)));
    expect(optional).toEqual([]);
  });

  it("sustituye los marcadores por los datos de la base y falla si falta alguno", () => {
    expect(renderFacts("Hay {{open.count}} abiertas en {{topAccounts.0.name}}", facts)).toBe("Hay 56 abiertas en AT&T México");
    expect(renderFacts("Monto {{focus.amountUsd}}", facts)).toBe("Monto 2,000,000");
    expect(() => renderFacts("{{focus.inexistente}}", facts)).toThrow(/no existe/);
  });

  it("renderiza preguntas y afirmaciones de cada escenario", () => {
    const scenario = renderScenario(coachBank.scenarios.find((item) => item.id === "K06"), facts);
    expect(scenario.turns[0].question).toBe("¿En qué etapa está la oportunidad Vrf 2027?");
    expect(scenario.turns[0].mustInclude[0].statement).toContain("Contacto Inicial");
  });

  it("las verificaciones deterministas exigen confirmación y no aceptan aclaraciones a preguntas claras", () => {
    const turn = { operations: "confirmed_only", checks: { mustAnswer: true } };
    expect(coachDeterministicIssues({ turn, response: { responseType: "informational", operations: [{ requiresConfirmation: true }] } })).toEqual([]);
    expect(coachDeterministicIssues({ turn, response: { responseType: "informational", operations: [{ requiresConfirmation: false }] } })).toEqual(["operation_without_confirmation"]);
    expect(coachDeterministicIssues({ turn, response: { responseType: "clarification", operations: [] } })).toEqual(["unexpected_clarification"]);
    expect(coachDeterministicIssues({ turn: { operations: "none" }, response: { operations: [{ requiresConfirmation: true }] } })).toEqual(["unexpected_operations"]);
  });
});
