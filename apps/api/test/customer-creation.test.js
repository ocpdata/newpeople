import { describe, expect, it } from "vitest";
import { buildCustomerCreationResponse, validateCustomerCreationMemory } from "../src/commercial-intelligence/customer-creation.js";
import { coachOperationSchema } from "../src/coach/contract.js";
import { buildCoachFormPatch } from "../../web/src/coach/handoffForm.js";
import { validateCustomerConversationContext } from "../src/commercial-intelligence/conversation-context.js";

const snapshot = {
  account: { id: 7, name: "Cuenta de prueba" },
  contacts: [{ id: 31, accountId: 7, name: "Elena Torres", email: "elena@example.invalid" }],
  opportunities: [{ id: 11, accountId: 7, name: "Renovación Alfa" }], inactiveOpportunities: [],
};
const field = (key, value, evidence = value) => ({ field: key, value, evidence });
function run(fields = [], options = {}) {
  const { object = "contact", mode = "start", previous, question = fields.map((entry) => entry.evidence).join("; "),
    spec = {}, ...rest } = options;
  return buildCustomerCreationResponse({
    component: { object, creationSpec: { fields, mode, ...spec } },
    movement: "new_request", question, snapshot, previous, ...rest,
  });
}
const contact = [field("firstName", "Ana"), field("lastName", "Luna")];
const opportunity = [field("name", "Proyecto Gamma")];

describe("A01 attributed creation drafts", () => {
  it("collects missing names without inventing optional data", () => {
    const result = run([field("firstName", "Ana")]);
    expect(result.responseType).toBe("clarification");
    expect(result.creationMetadata.pendingFields).toContain("Apellido");
    expect(result.creationMemory.values).toEqual({ firstName: "Ana" });
    expect(result.operations).toEqual([]);
  });
  it.each(["contact", "opportunity"])("prepares %s and transfers only allowed values to the existing module", (object) => {
    const result = run(object === "contact" ? contact : opportunity, { object });
    expect(result.responseType).toBe("informational");
    expect(result.operations).toHaveLength(1);
    const operation = coachOperationSchema.parse(result.operations[0]);
    expect(operation.creationDraftId).toBe(result.creationMemory.draftId);
    expect(operation.creationRevision).toBe(1);
    expect(operation.requiresConfirmation).toBe(true);
    expect(buildCoachFormPatch({ payload: operation }, operation.targetModule)).toEqual({
      accountId: "7", ...(object === "contact" ? { firstName: "Ana", lastName: "Luna" } : { name: "Proyecto Gamma" }),
    });
    expect(result.answer).toContain("No se creó ningún registro");
  });
  it("continues, corrects, removes and reviews without losing the rest of the draft", () => {
    const first = run(contact);
    const added = run([field("email", "ana@example.invalid")], { previous: first.creationMemory, mode: "continue" });
    const corrected = run([field("lastName", "López")], { previous: added.creationMemory, mode: "continue" });
    const removed = run([field("email", "", "retira el correo")], { previous: corrected.creationMemory, mode: "continue" });
    const review = run([], { previous: removed.creationMemory, mode: "review", question: "muéstrame cómo quedó" });
    expect(review.creationMemory.draftId).toBe(first.creationMemory.draftId);
    expect(review.creationMemory.values).toEqual({ firstName: "Ana", lastName: "López" });
    expect(review.creationMemory.revision).toBe(4);
  });
  it("requires literal current-message provenance and does not reuse old values as new evidence", () => {
    const previous = run(contact).creationMemory;
    const result = run([field("email", "invented@example.invalid")], { previous, mode: "continue", question: "muéstralo" });
    expect(result.operations).toEqual([]);
    expect(result.creationMemory).toEqual(previous);
    expect(result.answer).toContain("literalmente");
  });
  it.each([
    field("email", "invalid-email"), field("closeDate", "2027-02-30"), field("amountUsd", "-1", "-1 USD"),
    field("amountUsd", "1e5", "1e5 USD"), field("amountUsd", "Infinity", "Infinity USD"),
    field("amountUsd", "1,25", "1,25 USD"), field("firstName", "A"), field("phone", "1".repeat(41)),
    field("name", "x".repeat(181)),
  ])("rejects invalid values without silent truncation: %j", (entry) => {
    const result = run([entry], { object: ["closeDate", "amountUsd", "name"].includes(entry.field) ? "opportunity" : "contact" });
    expect(result.responseType).toBe("clarification");
    expect(result.operations).toEqual([]);
    expect(result.creationMemory).toBeNull();
  });
  it("does not prepare an opportunity when the request explicitly asks for a contact", () => {
    const result = run([field("name", "Alejandro Ruiz")], {
      object: "opportunity",
      question: "Crea un nuevo contacto llamado Alejandro Ruiz",
    });
    expect(result.operations).toEqual([]);
    expect(result.answer).toContain("El mensaje pide crear un contacto");
    expect(result.answer).not.toContain("Conservé el borrador anterior");
  });
  it.each(["1000", "1000 MXN", "$1000"])("does not assume USD from %s", (evidence) => {
    const result = run([...opportunity, field("amountUsd", "1000", evidence)], { object: "opportunity" });
    expect(result.operations).toEqual([]);
    expect(result.answer).toContain("moneda");
  });
  it.each(["0", "25,000.50"])("retains exact explicitly denominated USD amount %s", (value) => {
    const result = run([...opportunity, field("amountUsd", value, `${value} dólares`)], { object: "opportunity" });
    expect(result.operations[0].payload.amountUsd).toBe(Number(value.replaceAll(",", "")));
  });
  it("accepts a real ISO date and no implicit catalog or CRM fields", () => {
    const result = run([...opportunity, field("closeDate", "2028-02-29")], { object: "opportunity" });
    expect(result.operations[0].payload).toEqual({ accountId: 7, name: "Proyecto Gamma", closeDate: "2028-02-29" });
    expect(run([...contact, field("name", "Another")]).operations).toEqual([]);
    expect(run([...contact, field("sellerUserId", "999")]).operations).toEqual([]);
  });
  it("does not silently accept duplicate fields", () => {
    expect(run([...contact, field("firstName", "Eva")]).operations).toEqual([]);
  });
  it("warns on partial name and requires a second-turn distinct-record decision", () => {
    const first = run([field("firstName", "Elena")]);
    expect(first.creationMetadata.coincidences).toHaveLength(1);
    expect(first.operations).toEqual([]);
    const complete = run([field("lastName", "Torres")], { previous: first.creationMemory, mode: "continue" });
    const accepted = run([], { previous: complete.creationMemory, mode: "continue",
      question: "Es otra persona", spec: { duplicateDecision: "distinct", duplicateEvidence: "Es otra persona" } });
    expect(accepted.operations).toHaveLength(1);
    expect(accepted.creationMetadata.duplicateAcknowledged).toBe(true);
    const reviewed = run([], { previous: accepted.creationMemory, mode: "review" });
    expect(reviewed.operations).toHaveLength(1);
  });
  it("warns for a matching email even with another name", () => {
    const result = run([...contact, field("email", "elena@example.invalid")]);
    expect(result.creationMetadata.coincidences[0].reason).toBe("Coincidencia de correo");
    expect(result.operations).toEqual([]);
  });
  it("checks inactive opportunities too and never updates them instead", () => {
    const result = run([field("name", "Proyecto Inactivo")], { object: "opportunity",
      snapshot: { ...snapshot, inactiveOpportunities: [{ id: 12, name: "Proyecto Inactivo", accountId: 7 }] } });
    expect(result.creationMetadata.status).toBe("coincidence_review");
    expect(result.operations).toEqual([]);
  });
  it("does not accept an unobserved, stale or fabricated duplicate decision", () => {
    const entries = [field("firstName", "Elena"), field("lastName", "Torres")];
    const first = run(entries);
    expect(run(entries, { question: "Elena Torres es otra persona", spec: {
      duplicateDecision: "distinct", duplicateEvidence: "es otra persona",
    } }).operations).toEqual([]);
    expect(run([], { previous: first.creationMemory, mode: "continue", question: "muéstralo",
      spec: { duplicateDecision: "distinct", duplicateEvidence: "Es otra persona" } }).operations).toEqual([]);
    const changed = run([], { previous: first.creationMemory, mode: "continue", question: "Es otra persona",
      spec: { duplicateDecision: "distinct", duplicateEvidence: "Es otra persona" },
      snapshot: { ...snapshot, contacts: [...snapshot.contacts, { id: 32, accountId: 7, name: "Elena Torres" }] } });
    expect(changed.operations).toEqual([]);
  });
  it("invalidates acknowledgement when draft identity values or matches change", () => {
    const first = run([field("firstName", "Elena"), field("lastName", "Torres")]);
    const accepted = run([], { previous: first.creationMemory, mode: "continue", question: "otra persona",
      spec: { duplicateDecision: "distinct", duplicateEvidence: "otra persona" } });
    expect(run([field("email", "elena@example.invalid")], { previous: accepted.creationMemory, mode: "continue" })
      .creationMetadata.status).toBe("coincidence_review");
  });
  it("preserves acknowledgement when JSON persistence changes key order but not values", () => {
    const first = run([field("firstName", "Elena"), field("lastName", "Torres")]);
    const accepted = run([], { previous: first.creationMemory, mode: "continue", question: "otra persona",
      spec: { duplicateDecision: "distinct", duplicateEvidence: "otra persona" } });
    const stored = { ...accepted.creationMemory,
      values: Object.fromEntries(Object.entries(accepted.creationMemory.values).reverse()) };
    const reviewed = run([], { previous: stored, mode: "review" });
    expect(reviewed.creationMetadata.duplicateAcknowledged).toBe(true);
    expect(reviewed.creationMemory.revision).toBe(stored.revision);
    expect(reviewed.operations).toHaveLength(1);
  });
  it("limits displayed matches but fingerprints the whole available set", () => {
    const result = run([field("firstName", "Elena")], {
      snapshot: { ...snapshot, contacts: Array.from({ length: 21 }, (_, index) => ({ id: index + 1, accountId: 7, name: "Elena Torres" })) },
    });
    expect(result.creationMetadata.coincidences).toHaveLength(20);
    expect(result.creationMetadata.coincidenceCount).toBe(21);
    expect(result.creationMetadata.warnings.join(" ")).toContain("primeras 20");
  });
  it.each([
    { contactsAllowed: false },
    { metrics: [{ source: "contacts", errorCode: "READ_FAILED" }] },
  ])("does not equate restricted or failed readings with no duplicates %j", (options) => {
    const result = run(contact, options);
    expect(result.creationMetadata.coincidences).toEqual([]);
    expect(result.creationMetadata.warnings.length).toBeGreaterThan(1);
    expect(result.answer).toContain("no garantiza ausencia");
  });
  it("resolves only an exact unique authorized existing contact for an opportunity", () => {
    const result = run([...opportunity, field("contactReference", "Elena Torres")], { object: "opportunity" });
    expect(result.operations[0].contactId).toBe(31);
    expect(result.operations[0].payload.contactId).toBe(31);
    expect(result.operations[0].payload.contactReference).toBeUndefined();
  });
  it.each([
    { contactsAllowed: false },
    { metrics: [{ source: "contacts", errorCode: "READ_FAILED" }] },
    { snapshot: { ...snapshot, contacts: [] } },
    { snapshot: { ...snapshot, contacts: [{ id: 9, accountId: 99, name: "Elena Torres" }] } },
    { snapshot: { ...snapshot, contacts: [...snapshot.contacts, { id: 32, accountId: 7, name: "Elena Torres" }] } },
  ])("does not link an inaccessible or ambiguous contact %j", (options) => {
    const result = run([...opportunity, field("contactReference", "Elena Torres")], { object: "opportunity", ...options });
    expect(result.operations).toEqual([]);
    expect(result.responseType).toBe("clarification");
  });
  it("requires explicit start when switching types, without leaking previous fields", () => {
    const prior = run(contact).creationMemory;
    const blocked = run(opportunity, { object: "opportunity", previous: prior, mode: "continue" });
    expect(blocked.creationMemory).toEqual(prior);
    const started = run(opportunity, { object: "opportunity", previous: prior });
    expect(started.creationMemory.draftId).not.toBe(prior.draftId);
    expect(started.creationMemory.values).toEqual({ name: "Proyecto Gamma" });
  });
  it("does not resurrect a draft from another account or an invalid memory", () => {
    const memory = run(contact).creationMemory;
    expect(validateCustomerCreationMemory({ ...memory, accountId: 8 }, snapshot)).toBeNull();
    expect(validateCustomerCreationMemory({ ...memory, values: { sellerUserId: "999" } }, snapshot)).toBeNull();
    expect(validateCustomerCreationMemory({ ...memory, values: { email: "invalid" } }, snapshot)).toBeNull();
    expect(run([], { previous: { ...memory, accountId: 8 }, mode: "review" }).operations).toEqual([]);
    const context = validateCustomerConversationContext({ version: 1, accountId: 7, creationMemory: memory }, snapshot, 7);
    expect(context.creationMemory).toEqual(memory);
  });
  it("checks a separately selected opportunity once and never accepts records with unknown account identity", () => {
    const result = run([field("name", "Proyecto seleccionado")], { object: "opportunity", snapshot: {
      ...snapshot, selectedOpportunity: { id: 12, accountId: 7, name: "Proyecto seleccionado" },
      opportunities: [{ id: 12, accountId: 7, name: "Proyecto seleccionado" }],
    } });
    expect(result.creationMetadata.coincidenceCount).toBe(1);
    const unknown = run([...opportunity, field("contactReference", "Contacto sin cuenta")], { object: "opportunity",
      snapshot: { ...snapshot, contacts: [{ id: 99, name: "Contacto sin cuenta" }] } });
    expect(unknown.operations).toEqual([]);
  });
});
