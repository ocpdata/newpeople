import { describe, expect, it } from "vitest";
import {
  buildCustomerFallback,
  createCustomerAccountAdapter,
} from "../src/commercial-intelligence/customer-chat-adapter.js";

describe("Customer account chat adapter", () => {
  const snapshot = {
    capturedAt: "2026-09-30T12:00:00.000Z",
    account: { id: 7, name: "Totalplay" },
    opportunities: [
      {
        id: 11,
        name: "Proyecto abierto",
        accountId: 7,
        lifecycle: "open",
      },
    ],
    inactiveOpportunities: [],
    contacts: [],
    interactions: [],
    accountHealth: { status: "healthy", score: 80 },
  };

  it("mantiene cuenta fija y operaciones confirmables", () => {
    const adapter = createCustomerAccountAdapter({
      user: { id: 31, permissionSet: new Set(["cuentas.read"]) },
      snapshot,
      agents: [],
      jobId: 10,
    });

    expect(adapter.channel).toBe("customer_account");
    expect(adapter.channelRules).toMatchObject({
      accountScoped: true,
      noSharedCoachSession: true,
    });
    expect(adapter.operationPolicy).toEqual({
      allowedKinds: ["activity"],
      sourceChannel: "customer_account",
    });
    expect(adapter.availableTools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "searchAccounts",
        "searchOpportunities",
        "searchContacts",
        "searchInteractions",
      ]),
    );
  });

  it("prioriza la intencion de correo en el fallback", () => {
    const result = buildCustomerFallback(
      snapshot,
      "Dame un modelo de correo para enviarlo a Eduardo para buscar mas oportunidades",
    );

    expect(result.answer).toContain("Borrador de correo");
    expect(result.answer).not.toContain("1 oportunidad");
  });
});
