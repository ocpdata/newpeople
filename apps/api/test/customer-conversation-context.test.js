import { describe, expect, it } from "vitest";
import {
  buildCustomerConversationContext,
  getCustomerConversationFilterMemory,
  validateCustomerConversationContext,
} from "../src/commercial-intelligence/conversation-context.js";

const snapshot = {
  account: { id: 41 },
  opportunities: [{ id: 72, accountId: 41 }],
  inactiveOpportunities: [],
  selectedOpportunity: null,
  contacts: [{ id: 83, accountId: 41 }],
  interactions: [{ id: 94, accountId: 41, leadSubstatusCode: "contacted" }],
};

describe("Customer conversation context memory", () => {
  it("retains only same-account entities present in the authorized snapshot", () => {
    const result = validateCustomerConversationContext(
      {
        version: 1,
        accountId: 41,
        opportunityId: 72,
        contactId: 999,
        leadId: 94,
        intents: ["contact_history", "opportunity_guidance", "not_an_intent"],
        filters: { opportunityStatus: "open", periodMonths: 6 },
      },
      snapshot,
      41,
    );

    expect(result).toEqual({
      version: 1,
      accountId: 41,
      opportunityId: 72,
      contactId: null,
      leadId: 94,
      intents: ["contact_history", "opportunity_guidance"],
      filters: { opportunityStatus: "open", periodMonths: 6 },
    });
    expect(
      validateCustomerConversationContext(
        { accountId: 42, opportunityId: 72 },
        snapshot,
        41,
      ),
    ).toBeNull();
  });

  it("bounds and validates remembered filters", () => {
    expect(
      getCustomerConversationFilterMemory(
        {
          accountId: 41,
          filters: {
            opportunityStatus: "invented",
            periodMonths: 600,
            startDate: "2020-01-01",
            endDate: "2026-01-01",
          },
        },
        41,
      ),
    ).toEqual({});
    expect(
      getCustomerConversationFilterMemory(
        { accountId: 42, filters: { periodMonths: 6 } },
        41,
      ),
    ).toEqual({});
  });

  it("builds a compact account-bound context from resolved state", () => {
    expect(
      buildCustomerConversationContext({
        accountId: 41,
        effectiveContext: { opportunityId: 72, contactId: 83, leadId: 94 },
        routing: {
          intents: ["contact_history", "unknown"],
          filters: { periodMonths: 12, stageCode: "negociacion" },
        },
      }),
    ).toEqual({
      version: 1,
      accountId: 41,
      opportunityId: 72,
      contactId: 83,
      leadId: 94,
      intents: ["contact_history"],
      filters: { stageCode: "negociacion", periodMonths: 12 },
    });
  });
});
