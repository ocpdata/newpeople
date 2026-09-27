import { describe, expect, it } from "vitest";
import { buildCoachScopedSnapshot } from "../src/routes.mi-agent.js";

describe("Coach context optimization", () => {
  const snapshot = {
    pipeline: {
      qualifiedAmount: 300,
      qualifiedCount: 2,
      opportunities: [
        { id: 10, name: "Oportunidad A", amountUsd: 100, account: { id: 1 } },
        { id: 20, name: "Oportunidad B", amountUsd: 200, account: { id: 2 } },
      ],
    },
    workboard: [
      { id: 10, name: "Oportunidad A", account: { id: 1 } },
      { id: 20, name: "Oportunidad B", account: { id: 2 } },
    ],
    coachOpportunities: [
      {
        id: 5,
        name: "Prospecto inicial",
        amountUsd: 50,
        stageCode: "contacto_inicial",
        account: { id: 1 },
      },
      {
        id: 10,
        name: "Oportunidad A",
        amountUsd: 100,
        stageCode: "desarrollo",
        account: { id: 1 },
      },
      {
        id: 20,
        name: "Oportunidad B",
        amountUsd: 200,
        stageCode: "waiting",
        account: { id: 2 },
      },
    ],
    leads: [
      { id: 30, accountId: 1, opportunityId: 10 },
      { id: 40, accountId: 2, opportunityId: 20 },
    ],
    contactMappings: [
      { id: 50, accountId: 1 },
      { id: 60, accountId: 2 },
    ],
  };

  it("preserves the complete snapshot without an explicit context", () => {
    expect(buildCoachScopedSnapshot(snapshot)).toBe(snapshot);
  });

  it("scopes opportunities, leads and contacts to the selected account", () => {
    const scoped = buildCoachScopedSnapshot(snapshot, { accountId: 1 });
    expect(scoped.coachOpportunities.map((item) => item.id)).toEqual([5, 10]);
    expect(scoped.leads.map((item) => item.id)).toEqual([30]);
    expect(scoped.contactMappings.map((item) => item.id)).toEqual([50]);
    expect(scoped.pipeline.qualifiedAmount).toBe(300);
    expect(scoped.pipeline.opportunities.map((item) => item.id)).toEqual([
      10, 20,
    ]);
    expect(scoped.selectedContext.accountId).toBe(1);
  });

  it("scopes the context to one opportunity", () => {
    const scoped = buildCoachScopedSnapshot(snapshot, { opportunityId: 20 });
    expect(scoped.coachOpportunities.map((item) => item.id)).toEqual([20]);
    expect(scoped.workboard.map((item) => item.id)).toEqual([10, 20]);
    expect(scoped.leads.map((item) => item.id)).toEqual([40]);
    expect(scoped.selectedContext.opportunityId).toBe(20);
  });

  it("scopes the context to the selected contact's account", () => {
    const scoped = buildCoachScopedSnapshot(snapshot, { contactId: 60 });
    expect(scoped.coachOpportunities.map((item) => item.id)).toEqual([20]);
    expect(scoped.leads.map((item) => item.id)).toEqual([40]);
    expect(scoped.contactMappings.map((item) => item.id)).toEqual([60]);
    expect(scoped.selectedContext.contactId).toBe(60);
  });

  it("scopes a selected lead and preserves the enriched selected record", () => {
    const enrichedSnapshot = {
      ...snapshot,
      coachOpportunities: snapshot.coachOpportunities.map((item) =>
        item.id === 10
          ? {
              ...item,
              stageQuestions: [{ questionId: 1, status: "pending" }],
              quotations: [{ id: 70 }],
              proposals: [{ id: 80 }],
            }
          : item,
      ),
    };
    const scoped = buildCoachScopedSnapshot(enrichedSnapshot, { leadId: 30 });

    expect(scoped.coachOpportunities.map((item) => item.id)).toEqual([10]);
    expect(scoped.leads.map((item) => item.id)).toEqual([30]);
    expect(scoped.selectedRecord.stageQuestions).toHaveLength(1);
    expect(scoped.selectedRecord.quotations).toHaveLength(1);
    expect(scoped.selectedRecord.proposals).toHaveLength(1);
    expect(scoped.selectedContext.leadId).toBe(30);
  });

  it("keeps all seven commercial stages independently from the qualified pipeline", () => {
    const stageCodes = [
      "contacto_inicial",
      "identificacion_oportunidad",
      "desarrollo",
      "cotizacion",
      "demostracion",
      "negociacion",
      "waiting",
    ];
    const completeSnapshot = {
      ...snapshot,
      coachOpportunities: stageCodes.map((stageCode, index) => ({
        id: index + 1,
        name: stageCode,
        stageCode,
        account: { id: 1 },
      })),
    };

    const scoped = buildCoachScopedSnapshot(completeSnapshot, { accountId: 1 });

    expect(scoped.coachOpportunities.map((item) => item.stageCode)).toEqual(
      stageCodes,
    );
    expect(scoped.pipeline.qualifiedAmount).toBe(300);
    expect(scoped.pipeline.qualifiedCount).toBe(2);
  });
});
