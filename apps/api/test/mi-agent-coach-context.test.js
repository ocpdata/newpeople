import { describe, expect, it } from "vitest";
import {
  buildCoachScopedSnapshot,
  coachSessionContextMatchesRequest,
  getEnabledCoachTerminalStatusCodes,
  mergeCoachSessionContext,
  resolveCoachContextEntities,
} from "../src/routes.mi-agent.js";

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
    wonOpportunities: [
      {
        id: 70,
        name: "Venta histórica A",
        commercialStatusCode: "ganada",
        lifecycle: "historical",
        account: { id: 1 },
      },
    ],
    lostOpportunities: [
      {
        id: 71,
        name: "Venta perdida B",
        commercialStatusCode: "perdida",
        lifecycle: "historical",
        account: { id: 2 },
      },
    ],
    cancelledOpportunities: [],
    leads: [
      { id: 30, accountId: 1, opportunityId: 10 },
      { id: 40, accountId: 2, opportunityId: 20 },
    ],
    contactMappings: [
      { id: 50, accountId: 1 },
      { id: 60, accountId: 2 },
    ],
  };

  it("maps each governance switch to its terminal commercial status", () => {
    expect(
      getEnabledCoachTerminalStatusCodes({
        includeWonOpportunities: true,
        includeLostOpportunities: false,
        includeCancelledOpportunities: true,
      }),
    ).toEqual(["ganada", "anulada"]);
  });

  it("does not restore a stale lead over explicit null request context", () => {
    expect(
      mergeCoachSessionContext(
        {
          accountId: 23,
          opportunityId: 27,
          contactId: null,
          leadId: null,
        },
        { accountId: 127, leadId: 93 },
        {
          accountId: 23,
          opportunityId: 27,
          contactId: null,
          leadId: null,
        },
      ),
    ).toEqual({
      accountId: 23,
      opportunityId: 27,
      contactId: null,
      leadId: null,
    });
  });

  it("detects a session whose account or lead differs from request context", () => {
    expect(
      coachSessionContextMatchesRequest(
        {
          accountId: 23,
          opportunityId: 27,
          contactId: null,
          leadId: null,
        },
        {
          accountId: 127,
          opportunityId: null,
          contactId: null,
          leadId: 93,
        },
      ),
    ).toBe(false);
  });

  it("does not resolve a prior unrelated lead over a selected opportunity", () => {
    const resolution = resolveCoachContextEntities(
      {
        ...snapshot,
        leads: [{ id: 93, title: "Gana Lotto", accountId: 127 }],
      },
      "¿Cuántas cotizaciones fueron las ganadas para esta oportunidad?",
      [{ role: "seller", text: "Resume Gana Lotto" }],
      { accountId: 23, opportunityId: 27, leadId: null },
    );

    expect(resolution.explicitEntities.candidates.opportunities).toEqual([]);
    expect(resolution.resolvedEntities.candidates.leads).toEqual([]);
  });

  it("preserves the complete snapshot without an explicit context", () => {
    expect(buildCoachScopedSnapshot(snapshot)).toBe(snapshot);
  });

  it("scopes opportunities, leads and contacts to the selected account", () => {
    const scoped = buildCoachScopedSnapshot(snapshot, { accountId: 1 });
    expect(scoped.coachOpportunities.map((item) => item.id)).toEqual([5, 10]);
    expect(scoped.leads.map((item) => item.id)).toEqual([30]);
    expect(scoped.contactMappings.map((item) => item.id)).toEqual([50]);
    expect(scoped.wonOpportunities.map((item) => item.id)).toEqual([70]);
    expect(scoped.lostOpportunities).toEqual([]);
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

  it("selects a terminal opportunity without adding it to the open pipeline", () => {
    const scoped = buildCoachScopedSnapshot(snapshot, { opportunityId: 70 });

    expect(scoped.coachOpportunities).toEqual([]);
    expect(scoped.wonOpportunities.map((item) => item.id)).toEqual([70]);
    expect(scoped.selectedRecord).toMatchObject({
      id: 70,
      type: "opportunity",
      commercialStatusCode: "ganada",
    });
    expect(scoped.workboard.map((item) => item.id)).toEqual([10, 20]);
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
