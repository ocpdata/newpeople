import { describe, expect, it } from "vitest";
import {
  buildCustomerRelationshipResponse, resolveCustomerRelationshipRequest, validateCustomerRelationshipMemory,
} from "../src/commercial-intelligence/customer-relationships.js";
import { validateCustomerRecordList } from "../src/commercial-intelligence/customer-record-list.js";
import { validateCustomerConversationContext } from "../src/commercial-intelligence/conversation-context.js";

const snapshot = {
  account: { id: 22, name: "Cuenta sintética" },
  permissions: { canReadContacts: true, canReadOpportunities: true },
  contacts: [
    { id: 109, accountId: 22, name: "Rene Negrete", activationStatusCode: "activado", positionTitle: "Compras" },
    { id: 110, accountId: 22, name: "Kimberly", activationStatusCode: "activado" },
    { id: 111, accountId: 22, name: "Moises Abraham", activationStatusCode: "activado", positionTitle: "Director" },
  ],
  opportunities: [
    { id: 36, accountId: 22, name: "Hardware Refresh", contactId: 110, amountUsd: 500000 },
    { id: 67, accountId: 22, name: "Hardware Refresh 3 Años", contactId: 110, amountUsd: 1500000 },
    { id: 94, accountId: 22, name: "Vrf 2027", contactId: 109, amountUsd: 2000000 },
  ],
};
const metrics = ["contacts", "opportunities_active", "opportunities_inactive"]
  .map((source) => ({ source, truncated: false, errorCode: null }));
function resolve(relationshipSpec = {}, extra = {}) {
  return resolveCustomerRelationshipRequest({
    component: { object: "opportunity", reference: "", relationshipSpec },
    movement: "new_request", previous: null, snapshot, context: { accountId: 22 },
    businessRules: {}, ...extra,
  });
}
const opportunityRead = (record) => ({
  ...record, commercialStatusCode: "en_proceso", activationStatusCode: "activada",
  associatedContactStatus: record.contactId ? "available" : "not_recorded",
  associatedContactId: record.contactId || null,
});
function render(spec, extra = {}) {
  const request = resolve(spec);
  const reads = [
    { toolName: "searchContacts", result: snapshot.contacts },
    { toolName: request.operation === "contact_opportunities" ? "searchOpportunities" : "getOpportunity",
      result: request.operation === "contact_opportunities" ? snapshot.opportunities.map(opportunityRead) : opportunityRead(request.opportunity) },
  ];
  return buildCustomerRelationshipResponse({ request, account: snapshot.account, reads, metrics, ...extra });
}
const direct = { operation: "associated_contact", opportunityReference: "Vrf 2027" };
const inverse = { operation: "contact_opportunities", contactReference: "Kimberly" };

describe("Q08 typed relation and entity resolution", () => {
  it("prioritizes an exact name over a longer opportunity prefix", () => {
    expect(resolve({ ...direct, opportunityReference: "Hardware Refresh" }).memory.opportunityId).toBe(36);
  });
  it("resolves an unambiguous two-word contact prefix without expanding the opportunity", () => {
    const result = resolve({ operation: "verify_pair", opportunityReference: "Hardware Refresh", contactReference: "Moises Abraham" },
      { snapshot: { ...snapshot, contacts: snapshot.contacts.map((item) =>
        item.id === 111 ? { ...item, name: "Moises Abraham Vargas Dominguez" } : item) } });
    expect(result.memory).toMatchObject({ opportunityId: 36, contactId: 111 });
  });
  it("does not choose between two full contact names sharing a prefix", () => {
    const contacts = [
      { ...snapshot.contacts[2], name: "Moises Abraham Vargas Dominguez" },
      { ...snapshot.contacts[2], id: 222, name: "Moises Abraham Perez" },
    ];
    expect(resolve({ operation: "verify_pair", opportunityReference: "Hardware Refresh", contactReference: "Moises Abraham" },
      { snapshot: { ...snapshot, contacts } }).error).toBeTruthy();
    expect(resolve({ operation: "verify_pair", opportunityReference: "Hardware Refresh", contactReference: "Moises" },
      { snapshot: { ...snapshot, contacts: contacts.slice(0, 1) } }).error).toBeTruthy();
  });
  it.each(["Hardware", "missing opportunity"])("does not substitute a selected opportunity for %s", (reference) => {
    expect(resolve({ ...direct, opportunityReference: reference }, { context: { accountId: 22, opportunityId: 94 } }).error).toBeTruthy();
  });
  it("asks rather than choosing one of two contacts with the same name", () => {
    expect(resolve(inverse, { snapshot: {
      ...snapshot, contacts: [...snapshot.contacts, { ...snapshot.contacts[1], id: 222 }],
    } }).error).toBeTruthy();
  });
  it("requires an operation rather than guessing a relationship", () => {
    expect(resolve().error).toContain("Indica si deseas");
  });
  it("keeps the known opportunity when a verification is missing the other endpoint", () => {
    const result = resolve({ operation: "verify_pair", opportunityReference: "Hardware Refresh" });
    expect(result.error).toContain("Falta la referencia del contacto");
    expect(result.error).toContain("conservo la oportunidad");
  });
  it("distinguishes a provided but unresolvable name from an omitted contact", () => {
    const result = resolve({ operation: "verify_pair", opportunityReference: "Hardware Refresh", contactReference: "No visible" });
    expect(result.error).toContain('"No visible"');
    expect(result.error).not.toContain("Falta la referencia");
  });
  it.each([
    { operation: "authority" },
    { ...direct, unsupported: ["autoridad de firma"] },
    { ...direct, clarification: "¿Qué oportunidad?" },
    { ...direct, accountReference: "Otra cuenta" },
    { ...direct, listSpec: { limit: 2 } },
    { ...inverse, listSpec: { unsupported: ["margen"] } },
    { ...inverse, opportunityReference: "Hardware Refresh" },
  ])("does not execute unsupported or contradictory criteria %j", (spec) => {
    expect(resolve(spec).error).toBeTruthy();
  });
  it("requires the same selected account and filters candidates to that account", () => {
    expect(resolve(direct, { context: { accountId: 99 } }).error).toBeTruthy();
    expect(resolve(inverse, { snapshot: { ...snapshot, contacts: snapshot.contacts.map((item) => ({ ...item, accountId: 99 })) } }).error).toBeTruthy();
  });
  it("rejects an inactive contact instead of reading all its account's opportunities", () => {
    expect(resolve(inverse, { snapshot: { ...snapshot, contacts: snapshot.contacts.map((item) => ({ ...item, activationStatusCode: "desactivado" })) } }).error).toBeTruthy();
  });
  it("retains list conditions only for the same contact on continuation", () => {
    const first = resolve({ ...inverse, listSpec: { amountFilters: [{ operator: "gt", value: 500000, currency: "USD" }], limit: 2 } });
    const next = resolve({ operation: "contact_opportunities", listSpec: { changed: ["sortDirection"], sortDirection: "desc", limit: 0 } },
      { movement: "continue", previous: first.memory });
    expect(next.listSpec).toMatchObject({ limit: 2, sortDirection: "desc", amountFilters: first.listSpec.amountFilters });
    expect(resolve({ ...inverse, contactReference: "Rene Negrete" }, { movement: "continue", previous: first.memory }).listSpec.amountFilters).toEqual([]);
    expect(resolve(inverse, { previous: first.memory }).listSpec.amountFilters).toEqual([]);
  });
  it("supports a direction change using the independently remembered contact", () => {
    const memory = render(direct).relationshipMemory;
    expect(resolve({ operation: "contact_opportunities" }, { movement: "continue", previous: memory }).memory.contactId).toBe(109);
  });
  it("validates persisted memories against account, contact activation and visible opportunity", () => {
    const memory = render(direct).relationshipMemory;
    expect(validateCustomerRelationshipMemory(memory, snapshot)).toEqual(memory);
    expect(validateCustomerRelationshipMemory({ ...memory, accountId: 99 }, snapshot)).toBeNull();
    expect(validateCustomerRelationshipMemory(memory, { ...snapshot, opportunities: [] })).toBeNull();
    expect(validateCustomerRelationshipMemory(memory, { ...snapshot, contacts: [] })).toBeNull();
    expect(validateCustomerConversationContext({ accountId: 22, relationshipMemory: memory }, snapshot, 22).relationshipMemory).toEqual(memory);
  });
});

describe("Q08 deterministic evidence", () => {
  it("returns Rene for Vrf rather than the first contact or a director", () => {
    const response = render(direct);
    expect(response.answer).toContain("Rene Negrete es el contacto asociado registrado de Vrf 2027");
    expect(response.answer).not.toContain("Moises");
    expect(response.relationshipStatus).toBe("associated");
    expect(response.operations).toEqual([]);
    expect(response.relationshipMemory).toMatchObject({ opportunityId: 94, contactId: 109 });
  });
  it.each([["Kimberly", "matched"], ["Moises Abraham", "different"]])("verifies %s against the explicit opportunity link", (contactReference, expected) => {
    const response = render({ operation: "verify_pair", opportunityReference: "Hardware Refresh", contactReference });
    expect(response.relationshipStatus).toBe(expected);
    expect(response.answer).toContain("Kimberly");
    if (expected === "different") expect(response.answer).toContain("no descarta otras formas de participación");
  });
  it("does not turn missing link, inaccessible destination and missing projection into the same answer", () => {
    for (const [status, phrase] of [["not_recorded", "no tiene contacto asociado registrado"],
      ["restricted", "restringido"], ["unavailable", "No pude verificar el destino"]]) {
      const response = render(direct, { reads: [
        { toolName: "searchContacts", result: snapshot.contacts },
        { toolName: "getOpportunity", result: { ...snapshot.opportunities[2], associatedContactStatus: status } },
      ] });
      expect(response.answer).toContain(phrase);
      expect(response.answer).not.toContain("Rene Negrete");
    }
  });
  it("does not leak the linked identity without an authorized contact read", () => {
    const response = render(direct, { reads: [
      { toolName: "searchContacts", result: [] },
      { toolName: "getOpportunity", result: opportunityRead(snapshot.opportunities[2]) },
    ] });
    expect(response.responseType).toBe("error");
    expect(response.answer).not.toContain("Rene Negrete");
  });
  it.each([
    [{ toolName: "getOpportunity", error: "failed" }],
    [{ toolName: "getOpportunity", result: opportunityRead({ ...snapshot.opportunities[2], accountId: 99 }) },
      { toolName: "searchContacts", result: snapshot.contacts }],
    [{ toolName: "getOpportunity", result: opportunityRead(snapshot.opportunities[0]) },
      { toolName: "searchContacts", result: snapshot.contacts }],
  ].map((reads) => ({ reads })))("fails explicitly for failed or mismatched read evidence", ({ reads }) => {
    expect(render(direct, { reads }).responseType).toBe("error");
  });
  it("does not treat a snapshot source failure as no link", () => {
    expect(render(direct, { metrics: [{ source: "contacts", errorCode: "query_error" }] }).responseType).toBe("error");
  });
  it("does not claim signature or decision authority", () => {
    const response = resolve({ ...direct, unsupported: ["quién tiene autoridad para firmar"] });
    expect(response.error).toContain("no acreditan decisión ni autoridad de firma");
    expect(response.responseType).toBe("informational");
  });
});

describe("Q08 inverse relation and list reuse", () => {
  it("filters by contact ID before ordering and limiting, keeping original recovered counts", () => {
    const response = render({ ...inverse, listSpec: { sortBy: "amountUsd", sortDirection: "desc", limit: 1 } });
    expect(response.recordList.ids).toEqual([67]);
    expect(response.recordList.relationshipContactId).toBe(110);
    expect(response.listMetadata).toMatchObject({ retrievedCount: 3, knownMatchCount: 2, shownCount: 1, presentationLimited: true });
  });
  it("excludes an exact amount threshold and supports explicit filter clearing", () => {
    const response = render({ ...inverse, listSpec: { amountFilters: [{ operator: "gt", value: 500000, currency: "USD" }] } });
    expect(response.recordList.ids).toEqual([67]);
    const previous = response.relationshipMemory;
    const cleared = resolve({ operation: "contact_opportunities", listSpec: { amountFilters: [] } }, { movement: "continue", previous });
    expect(cleared.listSpec.amountFilters).toEqual([]);
  });
  it("does not claim global absence for partial or unknown source coverage", () => {
    for (const sourceMetrics of [[], metrics.map((metric) => ({ ...metric, truncated: true }))]) {
      const response = render({ ...inverse, contactReference: "Moises Abraham" }, { metrics: sourceMetrics });
      expect(response.recordList.ids).toEqual([]);
      expect(response.listMetadata.sourceComplete).toBe(false);
      expect(response.answer).toContain("no puedo afirmar que no existan otras");
    }
  });
  it("marks unverifiable associations as partial before formatting an empty list", () => {
    const response = render({ ...inverse, contactReference: "Moises Abraham" }, { reads: [
      { toolName: "searchContacts", result: snapshot.contacts },
      { toolName: "searchOpportunities", result: [{ ...opportunityRead(snapshot.opportunities[0]), associatedContactStatus: "unavailable" }] },
    ] });
    expect(response.listMetadata.sourceComplete).toBe(false);
    expect(response.answer).not.toContain("Se muestran todas las coincidencias");
    expect(response.answer).not.toContain("No hay coincidencias con esos filtros dentro del alcance");
  });
  it("validates ordinal IDs and invalidates the entire list when the association changes", () => {
    const response = render(inverse);
    expect(validateCustomerRecordList(response.recordList, snapshot, 22)).toEqual(response.recordList);
    const changed = { ...snapshot, opportunities: snapshot.opportunities.map((item) => item.id === 36 ? { ...item, contactId: 109 } : item) };
    expect(validateCustomerRecordList(response.recordList, changed, 22)).toBeNull();
  });
  it("invalidates the list if its contact is no longer visible", () => {
    expect(validateCustomerRecordList(render(inverse).recordList, { ...snapshot, contacts: [] }, 22)).toBeNull();
  });
  it("uses the exact 50-result presentation ceiling for inverse relationships", () => {
    const reads = [
      { toolName: "searchContacts", result: snapshot.contacts },
      { toolName: "searchOpportunities", result: Array.from({ length: 60 }, (_, index) => opportunityRead({
        ...snapshot.opportunities[0], id: index + 1, name: `Proyecto ${index + 1}`,
      })) },
    ];
    const response = render({ ...inverse, listSpec: { limit: 500 } }, { reads });
    expect(response.recordList.ids).toHaveLength(50);
    expect(response.listMetadata).toMatchObject({ knownMatchCount: 60, shownCount: 50, appliedLimit: 50, presentationLimited: true });
  });
});
