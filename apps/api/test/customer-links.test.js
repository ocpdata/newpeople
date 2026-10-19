import { describe, expect, it, vi } from "vitest";
import { buildCustomerLinkResponse, validateCustomerLinkMemory } from "../src/commercial-intelligence/customer-links.js";
import { coachOperationSchema } from "../src/coach/contract.js";
import { validateCustomerConversationContext } from "../src/commercial-intelligence/conversation-context.js";
const snapshot = { account: { id: 1, name: "Cuenta ficticia" },
  opportunities: [{ id: 3, accountId: 1, name: "Proyecto Alfa" }, { id: 4, accountId: 1, name: "Proyecto Alfa largo" }],
  contacts: [{ id: 2, accountId: 1, name: "Elena Prueba" }, { id: 5, accountId: 1, name: "Elena Otra" }] };
const pair = { accountName: "Cuenta ficticia", opportunityName: "Proyecto Alfa", contactName: "Elena Prueba", currentContactId: 6, currentContactName: "Persona anterior" };
const spec = { mode: "start", opportunityReference: "Proyecto Alfa", contactReference: "Elena Prueba", selectionTarget: "none",
  position: 0, intent: "assign", evidence: "Vincula Elena Prueba a Proyecto Alfa" };
const run = (patch = {}, options = {}) => buildCustomerLinkResponse({
  component: { object: "opportunity", scope: "single", linkSpec: { ...spec, ...patch } },
  movement: "new_request", question: "Vincula Elena Prueba a Proyecto Alfa", snapshot, readPair: vi.fn(async () => pair), ...options,
});
describe("A04 deterministic link drafts", () => {
  it("prepares an explicit replacement with actual before/after and server-resolved IDs", async () => {
    const result = await run();
    expect(result.operations).toHaveLength(1);
    expect(coachOperationSchema.parse(result.operations[0])).toMatchObject({
      kind: "link_contact_to_opportunity", opportunityId: 3, contactId: 2, currentContactId: 6,
      linkSummary: { effect: "replace", currentContactName: "Persona anterior" },
    });
    expect(result.answer).toContain("no se conservarán ambos");
    expect(result.answer).toContain("Propuesta no guardada");
  });
  it("supports assignment only on a confirmed missing current relationship", async () => {
    const result = await run({}, { readPair: async () => ({ ...pair, currentContactId: null, currentContactName: null }) });
    expect(result.linkMetadata.effect).toBe("assign");
    expect(result.operations[0].currentContactId).toBeNull();
  });
  it("does not propose a write when the same relationship already exists", async () => {
    const result = await run({}, { readPair: async () => ({ ...pair, currentContactId: 2, currentContactName: "Elena Prueba" }) });
    expect(result.operations).toEqual([]);
    expect(result.linkMetadata.effect).toBe("no_change");
    expect(result.answer).toContain("Ya existe");
  });
  it("never silently substitutes when the seller requests adding and keeping both", async () => {
    const result = await run({ intent: "add" });
    expect(result.operations).toEqual([]);
    expect(result.answer).toContain("conservando ambos");
    const next = await run({ mode: "continue", intent: "replace", contactReference: "", opportunityReference: "", evidence: "Sustituye" },
      { question: "Sustituye", previous: result.linkMemory });
    expect(next.operations).toHaveLength(1);
    expect(next.linkMemory.revision).toBe(2);
  });
  it("requires an action intent rather than interpreting a mere relationship review as a write", async () => {
    const result = await run({ intent: "unspecified" });
    expect(result.operations).toEqual([]);
    expect(result.linkMetadata.status).toBe("collecting");
  });
  it.each(["contactReference", "opportunityReference"])("preserves the resolved end while collecting missing %s", async (key) => {
    const first = await run({ [key]: "" });
    expect(first.operations).toEqual([]);
    expect(first.linkMemory[key === "contactReference" ? "opportunityId" : "contactId"]).toBe(key === "contactReference" ? 3 : 2);
    const value = spec[key];
    const second = await run({ mode: "continue", contactReference: "", opportunityReference: "", [key]: value, evidence: value, intent: "unspecified" },
      { previous: first.linkMemory, movement: "answer_clarification", question: value });
    expect(second.operations[0]).toMatchObject({ opportunityId: 3, contactId: 2 });
    expect(second.linkMemory.draftId).toBe(first.linkMemory.draftId);
  });
  it.each(["contact", "opportunity"])("revalidates %s list before accepting an ordinal", async (object) => {
    const key = `${object}Reference`;
    const ref = object === "contact" ? "Elena" : "Alfa";
    const first = await run({ [key]: ref });
    expect(first.operations).toEqual([]);
    const patch = { mode: "continue", opportunityReference: "", contactReference: "", intent: "unspecified",
      evidence: "el segundo", selectionTarget: object, position: 2 };
    const selected = await run(patch, { previous: first.linkMemory, question: "el segundo" });
    expect(selected.operations[0][`${object}Id`]).toBe(object === "contact" ? 5 : 4);
    const staleSnapshot = { ...snapshot, [object === "contact" ? "contacts" : "opportunities"]:
      snapshot[object === "contact" ? "contacts" : "opportunities"].slice(1) };
    const stale = await run(patch, { previous: first.linkMemory, snapshot: staleSnapshot, question: "el segundo" });
    expect(stale.operations).toEqual([]);
    expect(stale.answer).toContain("cambiaron");
  });
  it("corrects one end, increments revision and recomputes the effect", async () => {
    const first = await run();
    const next = await run({ mode: "continue", opportunityReference: "", contactReference: "Elena Otra", evidence: "Elena Otra", intent: "unspecified" },
      { previous: first.linkMemory, question: "Elena Otra", readPair: async () => ({ ...pair, contactName: "Elena Otra" }) });
    expect(next.operations[0].contactId).toBe(5);
    expect(next.linkMemory.opportunityId).toBe(3);
    expect(next.linkMemory.revision).toBe(2);
  });
  it("increments revision when a refresh observes a concurrent relation change", async () => {
    const first = await run();
    const next = await run({ mode: "refresh", opportunityReference: "", contactReference: "", evidence: "", intent: "unspecified" },
      { previous: first.linkMemory, readPair: async () => ({ ...pair, currentContactId: 9, currentContactName: "Nuevo actual" }) });
    expect(next.operations[0].currentContactId).toBe(9);
    expect(next.linkMemory.revision).toBe(2);
  });
  it("does not reuse another account's memory or resolve another account's records", async () => {
    const first = await run();
    expect(validateCustomerLinkMemory({ ...first.linkMemory, accountId: 99 }, snapshot)).toBeNull();
    const next = await run({}, { snapshot: { ...snapshot, contacts: [{ id: 2, accountId: 99, name: "Elena Prueba" }] } });
    expect(next.operations).toEqual([]);
    expect(next.linkMemory.contactId).toBe(0);
  });
  it.each(["contactReference", "opportunityReference"])("does not trust written IDs for %s", async (key) => {
    const result = await run({ [key]: "2", evidence: "Vincula 2 Elena Prueba Proyecto Alfa" },
      { question: "Vincula 2 Elena Prueba Proyecto Alfa" });
    expect(result.operations).toEqual([]);
  });
  it("requires literal evidence for corrections and retains the previous valid draft", async () => {
    const first = await run();
    const next = await run({ mode: "continue", contactReference: "Elena Otra" }, { previous: first.linkMemory, question: "Revisa" });
    expect(next.operations).toEqual([]);
    expect(next.linkMemory).toEqual(first.linkMemory);
  });
  it("rejects role-only identity without creating a substitute contact", async () => {
    const result = await run({ contactReference: "director de compras", evidence: "director de compras Proyecto Alfa" },
      { question: "director de compras Proyecto Alfa" });
    expect(result.operations).toEqual([]);
    expect(result.answer).toContain("cargo");
  });
  it("rejects unsupported links and collections", async () => {
    expect((await run({ unsupported: ["cuenta ajena"] })).operations).toEqual([]);
    expect((await run({}, { component: { scope: "collection", linkSpec: spec } })).operations).toEqual([]);
  });
  it("retains memory in validation and through current account context", async () => {
    const first = await run();
    expect(validateCustomerConversationContext({ version: 1, accountId: 1, linkMemory: first.linkMemory }, snapshot, 1).linkMemory)
      .toEqual(first.linkMemory);
    expect(validateCustomerLinkMemory({ ...first.linkMemory, revision: -1 }, snapshot)).toBeNull();
  });
  it.each([403, 404, 422])("surfaces fresh-read eligibility/access failure %s without a proposal", async (status) => {
    const result = await run({}, { readPair: async () => { throw Object.assign(new Error("No disponible"), { status }); } });
    expect(result.responseType).toBe("error");
    expect(result.operations).toEqual([]);
  });
  it("does not treat failed sources as empty lists or hide unexpected database errors", async () => {
    const readPair = vi.fn();
    const result = await run({}, { readPair, metrics: [{ source: "contacts", errorCode: "FAIL" }] });
    expect(result.responseType).toBe("error");
    expect(readPair).not.toHaveBeenCalled();
    await expect(run({}, { readPair: async () => { throw new Error("DB failed"); } })).rejects.toThrow("DB failed");
  });
  it("does not retain an inaccessible end as a selected ID", async () => {
    const first = await run();
    const next = await run({ mode: "review", contactReference: "", opportunityReference: "", evidence: "", intent: "unspecified" },
      { previous: first.linkMemory, snapshot: { ...snapshot, contacts: [] } });
    expect(next.linkMemory.contactId).toBe(0);
    expect(next.operations).toEqual([]);
  });
});
