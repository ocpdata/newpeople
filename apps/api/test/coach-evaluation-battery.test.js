import { describe, expect, it } from "vitest";
import { buildCoachEntityClarification, resolveCoachEntities } from "../src/coach/entity-resolver.js";
import { searchOpportunities } from "../src/coach/crm-read-tools.js";

const snapshot = {
  accounts: [{ id: 40, name: "Totalplay" }],
  coachOpportunities: [
    {
      id: 401,
      name: "Renovacion de infraestructura",
      accountId: 40,
      account: { id: 40, name: "Totalplay" },
      stageCode: "waiting",
      stageName: "Waiting",
      activationStatusCode: "activada",
      commercialStatusCode: "en_proceso",
      lifecycle: "open",
    },
    {
      id: 402,
      name: "Servicios administrados",
      accountId: 40,
      account: { id: 40, name: "Totalplay" },
      stageCode: "negociacion",
      stageName: "Negociacion",
      activationStatusCode: "activada",
      commercialStatusCode: "en_proceso",
      lifecycle: "open",
    },
    {
      id: 403,
      name: "Oportunidad desactivada",
      accountId: 40,
      account: { id: 40, name: "Totalplay" },
      stageCode: "waiting",
      stageName: "Waiting",
      activationStatusCode: "desactivada",
      commercialStatusCode: "en_proceso",
      lifecycle: "inactive",
    },
  ],
  leads: [{ id: 501, title: "Totalplay", accountId: 40 }],
};

const cases = [
  {
    id: "ENT-06",
    question: "Cual es la oportunidad de Totalplay que esta en waiting?",
    expectedIds: [401],
  },
  {
    id: "ENT-08",
    question: "Totalplay",
    expectedAccountId: 40,
  },
  {
    id: "SEC-03",
    question: "Que oportunidades abiertas tiene Totalplay?",
    expectedIds: [401, 402],
  },
  {
    id: "RES-01",
    question: "Oportunidad de Totalplay",
    expectedClarification: "select_opportunity",
  },
];

describe("Coach real-question evaluation battery", () => {
  for (const scenario of cases) {
    it(`${scenario.id}: ${scenario.question}`, () => {
      const resolution = resolveCoachEntities(snapshot, scenario.question);
      if (scenario.expectedIds) {
        const result = searchOpportunities(snapshot, {
          accountId: 40,
          stageCodes: scenario.id === "ENT-06" ? ["waiting"] : [],
          activeOnly: true,
          openOnly: true,
        });
        expect(result.map((item) => item.id)).toEqual(scenario.expectedIds);
        return;
      }

      const clarification = buildCoachEntityClarification(
        resolution,
        scenario.question,
      );
      if (scenario.expectedAccountId) {
        expect(resolution.account?.id).toBe(scenario.expectedAccountId);
      } else {
        expect(clarification?.type).toBe(scenario.expectedClarification);
        expect(clarification?.candidates.every((item) => item.entityType)).toBe(
          true,
        );
      }
    });
  }
});
