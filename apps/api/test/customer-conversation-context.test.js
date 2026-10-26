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
  it("keeps an attributed R05 claim separate from CRM entities and drops foreign or revoked source memory", () => {
    const documentReportMemory = {
      accountId: 41, claim: "Según la cotización, incluyen cuatro equipos.", source: "quotation",
      mode: "receive", questionReference: "", fingerprint: "a".repeat(64), observedAt: "2026-10-17T12:00:00.000Z",
      documentMemory: { accountId: 41, source: "quotation", opportunityId: 72, quotationId: 18, versionId: 108, versionNumber: 8, candidates: [] },
    };
    const value = { accountId: 41, documentReportMemory };
    expect(validateCustomerConversationContext(value, snapshot, 41)).toMatchObject({ documentReportMemory, opportunityId: null });
    for (const bad of [
      { ...documentReportMemory, accountId: 42 }, { ...documentReportMemory, claim: "" },
      { ...documentReportMemory, documentMemory: { ...documentReportMemory.documentMemory, opportunityId: 999 } },
    ]) expect(validateCustomerConversationContext({ ...value, documentReportMemory: bad }, snapshot, 41).documentReportMemory).toBeUndefined();
    expect(validateCustomerConversationContext(value, { ...snapshot, permissions: { canReadOpportunities: false } }, 41).documentReportMemory).toBeUndefined();
    expect(validateCustomerConversationContext({ ...value, documentReportMemory: null }, snapshot, 41).documentReportMemory).toBeUndefined();
  });
  it("retains a pending amount and filters only for currently authorized candidates in the same account", () => {
    const result = validateCustomerConversationContext({
      accountId: 41,
      pendingAmountSelection: {
        accountId: 41, amount: 1000000, candidateIds: [72, 72, 999],
        filters: { opportunityStatus: "open", closeYear: 2026, unknown: true },
      },
    }, snapshot, 41);
    expect(result.pendingAmountSelection).toEqual({
      accountId: 41, amount: 1000000, candidateIds: [72],
      filters: { opportunityStatus: "open", closeYear: 2026 },
    });
    for (const pending of [
      { accountId: 42, amount: 1000000, candidateIds: [72] },
      { accountId: 41, amount: -1, candidateIds: [72] },
      { accountId: 41, amount: Infinity, candidateIds: [72] },
    ]) {
      expect(validateCustomerConversationContext({
        accountId: 41, pendingAmountSelection: pending,
      }, snapshot, 41).pendingAmountSelection).toBeUndefined();
    }
  });
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

  it("retains only a bounded pending activity intent inside the selected account", () => {
    const pendingActivityIntent = {
      actionType: "call",
      timing: "completed",
      title: "Registrar llamada",
      notes: "Resultado de la conversación",
      successCriteria: "",
      temporalPreference: "",
      opportunityId: 999,
    };
    const result = validateCustomerConversationContext(
      { accountId: 41, pendingActivityIntent },
      snapshot,
      41,
    );

    expect(result.pendingActivityIntent).toEqual({
      actionType: "call",
      timing: "completed",
      title: "Registrar llamada",
      notes: "Resultado de la conversación",
      successCriteria: "",
      temporalPreference: "",
    });
    expect(
      validateCustomerConversationContext(
        { accountId: 42, pendingActivityIntent },
        snapshot,
        41,
      ),
    ).toBeNull();
    expect(
      validateCustomerConversationContext(
        {
          accountId: 41,
          pendingActivityIntent: { ...pendingActivityIntent, timing: "invented" },
        },
        snapshot,
        41,
      ).pendingActivityIntent,
    ).toBeUndefined();
  });
});
