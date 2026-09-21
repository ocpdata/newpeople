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
    expect(scoped.pipeline.opportunities.map((item) => item.id)).toEqual([10]);
    expect(scoped.leads.map((item) => item.id)).toEqual([30]);
    expect(scoped.contactMappings.map((item) => item.id)).toEqual([50]);
    expect(scoped.pipeline.qualifiedAmount).toBe(100);
    expect(scoped.selectedContext.accountId).toBe(1);
  });

  it("scopes the context to one opportunity", () => {
    const scoped = buildCoachScopedSnapshot(snapshot, { opportunityId: 20 });
    expect(scoped.pipeline.opportunities.map((item) => item.id)).toEqual([20]);
    expect(scoped.workboard.map((item) => item.id)).toEqual([20]);
    expect(scoped.leads.map((item) => item.id)).toEqual([40]);
    expect(scoped.selectedContext.opportunityId).toBe(20);
  });

  it("scopes the context to the selected contact's account", () => {
    const scoped = buildCoachScopedSnapshot(snapshot, { contactId: 60 });
    expect(scoped.pipeline.opportunities.map((item) => item.id)).toEqual([20]);
    expect(scoped.leads.map((item) => item.id)).toEqual([40]);
    expect(scoped.contactMappings.map((item) => item.id)).toEqual([60]);
    expect(scoped.selectedContext.contactId).toBe(60);
  });
});
