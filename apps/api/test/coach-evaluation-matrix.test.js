import { describe, expect, it } from "vitest";
import cases from "./fixtures/coach-evaluation-cases.json" with { type: "json" };
import {
  buildCoachEntityClarification,
  resolveCoachEntities,
} from "../src/coach/entity-resolver.js";
import {
  buildDeterministicAccountOpportunityRanking,
} from "../src/coach/conversation-engine.js";
import { searchCoachOpportunities } from "../src/coach/read-tools.js";
import { coachOperationSchema } from "../src/coach/contract.js";
import { normalizeActivityOperation } from "../src/coach/operation-contract.js";

const snapshot = {
  accounts: [{ id: 22, name: "Totalplay" }],
  coachOpportunities: [
    {
      id: 1,
      name: "Proyecto abierto",
      accountId: 22,
      account: { id: 22, name: "Totalplay" },
      accountName: "Totalplay",
      lifecycle: "open",
      activationStatusCode: "activada",
      commercialStatusCode: "en_proceso",
    },
    {
      id: 2,
      name: "Otra oportunidad",
      accountId: 22,
      account: { id: 22, name: "Totalplay" },
      accountName: "Totalplay",
      lifecycle: "open",
      activationStatusCode: "activada",
      commercialStatusCode: "en_proceso",
    },
    ...Array.from({ length: 6 }, (_, index) => ({
      id: index + 4,
      name: `Proyecto abierto ${index + 3}`,
      accountId: 22,
      account: { id: 22, name: "Totalplay" },
      accountName: "Totalplay",
      lifecycle: "open",
      activationStatusCode: "activada",
      commercialStatusCode: "en_proceso",
    })),
    {
      id: 3,
      name: "Vrf 2027",
      accountId: 22,
      account: { id: 22, name: "Totalplay" },
      accountName: "Totalplay",
      lifecycle: "historical",
      activationStatusCode: "activada",
      commercialStatusCode: "ganada",
    },
  ],
  wonOpportunities: [],
  lostOpportunities: [],
  cancelledOpportunities: [],
};

const getCase = (id) => cases.find((item) => item.id === id);

describe("Coach evaluation matrix", () => {
  it.each(cases)("executes case $id", (testCase) => {
    if (testCase.kind === "account_ranking") {
      const result = buildDeterministicAccountOpportunityRanking(
        testCase.question,
        snapshot.coachOpportunities,
      );
      expect(result.facts[0].sourceId).toBe(testCase.expected.topAccountId);
      expect(result.answer).toContain(
        `${testCase.expected.topCount} oportunidad(es) abiertas`,
      );
      return;
    }

    if (testCase.kind === "opportunity_search") {
      const result = searchCoachOpportunities(snapshot, testCase.filters);
      expect(result.map((item) => item.id).sort((left, right) => left - right)).toEqual(
        testCase.expected.ids,
      );
      return;
    }

    const resolution = resolveCoachEntities(snapshot, testCase.question);
    if (testCase.kind === "exact_entity") {
      expect(resolution.opportunity?.id).toBe(testCase.expected.opportunityId);
      return;
    }
    if (testCase.kind === "clarification" || testCase.kind === "collection") {
      const clarification = buildCoachEntityClarification(
        resolution,
        testCase.question,
      );
      expect(clarification?.type || null).toBe(
        testCase.expected.type || testCase.expected.clarification,
      );
      return;
    }
    if (testCase.kind === "operation") {
      const operation = normalizeActivityOperation(
        { title: "Llamar", actionType: "call" },
        { opportunityId: 1 },
      );
      expect(coachOperationSchema.safeParse(operation).success).toBe(true);
      expect(operation.kind).toBe(testCase.expected.kind);
      expect(operation.requiresConfirmation).toBe(
        testCase.expected.requiresConfirmation,
      );
    }
  });

  it("keeps the documented cases addressable by stable IDs", () => {
    expect(getCase("COACH-ACCOUNT-001").question).toContain("Totalplay");
    expect(getCase("COACH-ACTION-001").kind).toBe("operation");
  });
});
