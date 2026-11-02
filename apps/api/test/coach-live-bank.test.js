import { describe, expect, it } from "vitest";
import { renderFacts } from "../src/channel-quality/live/coach-facts.js";
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
