import { describe, expect, it } from "vitest";
import { createProspectChatAdapter } from "../src/prospect-research/prospect-chat-adapter.js";

describe("Prospect chat adapter", () => {
  it("mantiene el prospecto fuera de las entidades CRM", () => {
    const adapter = createProspectChatAdapter({
      user: { id: 31, permissionSet: new Set(["prospeccion.read"]) },
      session: {
        id: 10,
        companyName: "Prospecto Demo",
        country: "Mexico",
        result: {
          profile: { companyName: "Prospecto Demo", country: "Mexico" },
          outreach: { body: "Mensaje inicial" },
        },
        findings: [],
        contacts: [],
        hypotheses: [],
      },
      jobId: null,
    });

    expect(adapter.channel).toBe("prospect");
    expect(adapter.channelRules).toEqual({
      prospectScoped: true,
      crmRecordsConfirmedOnly: true,
    });
    expect(adapter.operationPolicy).toEqual({
      allowedKinds: [
        "create_account",
        "create_contact",
        "create_opportunity",
      ],
      sourceChannel: "prospect",
    });
  });
});
