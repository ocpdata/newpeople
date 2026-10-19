import { describe, expect, it, vi } from "vitest";
import { buildCustomerOutcomeResponse, validateCustomerOutcomeMemory } from "../src/commercial-intelligence/customer-outcomes.js";
import { coachOperationSchema } from "../src/coach/contract.js";
import { getLeadCallOutcomeCatalogResponse, parseDateOnlyText, validateLeadCallOutcomeForCoach } from "../src/lead-call-outcomes.js";
import { customerOutcomeSpecSchema } from "../src/commercial-intelligence/turn-contract.js";
import { appendCustomerAccountChatHistory } from "../src/commercial-intelligence/customer-chat-adapter.js";
import { validateCustomerConversationContext } from "../src/commercial-intelligence/conversation-context.js";
const snapshot = { account: { id: 1, name: "Cuenta ficticia" } };
const lead = { id: 105, accountId: 1, status: "created", substatusCode: null, reasonCode: null, requiredActionCode: null,
  comment: null, dueDate: null, referredContactName: null, referredAreaName: null, resolvedAt: null, lastEventId: 0, disqualificationReason: null };
const data = { accountName: snapshot.account.name, leads: [lead] };
const spec = { mode: "start", leadReference: "105", resultReference: "Contacto pendiente", selectionTarget: "none", position: 0,
  changes: [], evidence: "Registra en 105: Contacto pendiente" };
const run = (patch = {}, options = {}) => {
  const next = { ...spec, ...patch };
  return buildCustomerOutcomeResponse({ component: { object: "lead", scope: "single", outcomeSpec: next }, movement: "new_request",
    question: next.evidence, snapshot, timeZone: "America/Mexico_City", now: new Date("2026-10-17T12:00:00Z"),
    readOutcomes: vi.fn(async () => data), ...options });
};
const resultName = (code) => getLeadCallOutcomeCatalogResponse().substatuses.find((item) => item.code === code).name;
const prepare = (code, changes = [], options = {}) => run({ resultReference: resultName(code),
  evidence: `105 ${resultName(code)} ${changes.map((item) => item.evidence).join(" ")}`, changes }, options);
describe("A07 deterministic lead outcome preparation", () => {
  it("uses the real catalog without inventing a no-answer mapping", async () => {
    const result = await run({ resultReference: "no contestó", evidence: "Registra en 105: no contestó" });
    expect(result.operations).toEqual([]);
    expect(result.answer).toContain("por suposición");
    expect(result.outcomeMemory.ruleCandidates.length).toBeGreaterThan(5);
  });
  it("produces a strict typed proposal and makes no domain write", async () => {
    const result = await prepare("contact_attempt_pending");
    expect(result.operations).toHaveLength(1);
    expect(coachOperationSchema.safeParse(result.operations[0]).success).toBe(true);
    expect(result.operations[0]).toMatchObject({ interactionId: 105, substatusCode: "contact_attempt_pending",
      reasonCode: "needs_more_information", requiredActionCode: "collect_missing_context", comment: "", nextActionDueAt: null });
    expect(result.answer).toContain("no guardada");
  });
  it.each(["meeting_requested", "meeting_confirmed", "needs_follow_up_later", "budget_timing_issue", "priority_not_now"])(
    "asks for required date for %s", async (code) => {
      const result = await prepare(code);
      expect(result.operations).toEqual([]);
      expect(result.pendingItems).toContain("Fecha compromiso");
    });
  it.each(["wrong_contact_identified", "alternative_contact_needed"])("asks for referred person for %s", async (code) => {
    const result = await prepare(code);
    expect(result.pendingItems).toContain("Persona referida");
  });
  it("requires area and comment without creating a contact", async () => {
    const result = await prepare("account_has_other_potential");
    expect(result.pendingItems).toEqual(["Comentario comercial", "Área objetivo"]);
  });
  it("accepts conditional references and preserves them in the operation contract", async () => {
    const result = await prepare("wrong_contact_identified", [{ field: "referredContactName", action: "set", value: "Ana Ficticia", evidence: "Ana Ficticia" }]);
    expect(result.operations[0].referredContactName).toBe("Ana Ficticia");
    expect(coachOperationSchema.parse(result.operations[0]).referredContactName).toBe("Ana Ficticia");
  });
  it.each(["2026-02-30", "2026-10-16", "en unos días", "constructor"])("clarifies invalid/past/ambiguous due date %s", async (value) => {
    expect((await prepare("meeting_requested", [{ field: "dueDateText", action: "set", value, evidence: value }])).operations).toEqual([]);
  });
  it("resolves tomorrow using the business date", async () => {
    const result = await prepare("meeting_requested", [{ field: "dueDateText", action: "set", value: "mañana", evidence: "mañana" }]);
    expect(result.operations[0].nextActionDueAt).toBe("2026-10-18");
  });
  it("never uses IDs outside the authorized account", async () => {
    expect((await run({ leadReference: "999", evidence: "999" })).operations).toEqual([]);
  });
  it("lists ambiguous leads and revalidates ordinals", async () => {
    const readOutcomes = async () => ({ ...data, leads: [lead, { ...lead, id: 106 }] });
    const first = await run({ leadReference: "", resultReference: "", evidence: "" }, { readOutcomes });
    const select = { mode: "continue", leadReference: "", resultReference: "", selectionTarget: "lead", position: 2, evidence: "el segundo" };
    const selected = await run(select, { previous: first.outcomeMemory, readOutcomes });
    expect(selected.outcomeMemory.leadId).toBe(106);
    const stale = await run(select, { previous: first.outcomeMemory, readOutcomes: async () => ({ ...data, leads: [{ ...lead, id: 106 }, lead] }) });
    expect(stale.operations).toEqual([]);
    expect(stale.answer).toContain("cambió");
  });
  it("treats the account name as account context, not a guessed lead identity", async () => {
    const result = await run({ leadReference: "Cuenta ficticia", resultReference: "", evidence: "Cuenta ficticia" },
      { readOutcomes: async () => ({ ...data, leads: [lead, { ...lead, id: 106 }] }) });
    expect(result.operations).toEqual([]);
    expect(result.outcomeMemory.leadCandidates).toEqual([105, 106]);
  });
  it("supports a verified result ordinal", async () => {
    const first = await run({ resultReference: "no contestó", evidence: "105 no contestó" });
    const selected = await run({ mode: "continue", leadReference: "", resultReference: "", selectionTarget: "result", position: 1,
      evidence: "el primer resultado" }, { previous: first.outcomeMemory });
    expect(selected.operations[0].substatusCode).toBe("contact_attempt_pending");
  });
  it("corrections retain draft identity, increment revision and clear previous review data", async () => {
    const first = await prepare("contact_attempt_pending");
    const next = await run({ mode: "continue", leadReference: "", resultReference: "",
      changes: [{ field: "comment", action: "set", value: "Nueva llamada", evidence: "Nueva llamada" }], evidence: "Nueva llamada" },
    { previous: first.outcomeMemory });
    expect(next.outcomeMemory.draftId).toBe(first.outcomeMemory.draftId);
    expect(next.outcomeMemory.revision).toBe(2);
    expect(next.operations[0].comment).toBe("Nueva llamada");
  });
  it("new calls get different draft IDs even for identical results", async () => {
    const first = await prepare("contact_attempt_pending");
    const next = await prepare("contact_attempt_pending", [], { previous: first.outcomeMemory });
    expect(next.outcomeMemory.draftId).not.toBe(first.outcomeMemory.draftId);
  });
  it("changing result removes old conditional data", async () => {
    const first = await prepare("wrong_contact_identified", [{ field: "referredContactName", action: "set", value: "Ana", evidence: "Ana" }]);
    const next = await run({ mode: "continue", leadReference: "", resultReference: resultName("meeting_requested"),
      evidence: resultName("meeting_requested") }, { previous: first.outcomeMemory });
    expect(next.outcomeMemory.values.referredContactName).toBe("");
    expect(next.pendingItems).toContain("Fecha compromiso");
  });
  it.each(["lead_qualified", "lead_disqualified", "unknown"])("rejects unavailable lead status %s", async (status) => {
    expect((await prepare("contact_attempt_pending", [], { readOutcomes: async () => ({ ...data, leads: [{ ...lead, status }] }) })).responseType).toBe("error");
  });
  it("does not accept fabricated or duplicate changes", async () => {
    const change = { field: "comment", action: "set", value: "Inventado", evidence: "Mensaje real" };
    expect((await run({ changes: [change], evidence: "Mensaje real" })).operations).toEqual([]);
    expect((await run({ changes: [{ ...change, value: "Mensaje real" }, { ...change, value: "Mensaje real" }], evidence: "Mensaje real" })).operations).toEqual([]);
  });
  it("does not claim to preserve a previous draft when none exists", async () => {
    const value = "A".repeat(256);
    const result = await run({
      changes: [{ field: "referredContactName", action: "set", value, evidence: value }],
      evidence: value,
    });
    expect(result.operations).toEqual([]);
    expect(result.answer).toContain("No preparé ningún cambio");
    expect(result.answer).not.toContain("Conservé el borrador previo");
  });
  it("requires a new explicit request rather than silently treating continuation as another call", async () => {
    const first = await prepare("contact_attempt_pending");
    const next = await prepare("contact_attempt_pending", [], { previous: first.outcomeMemory, movement: "continue" });
    expect(next.operations).toEqual([]);
  });
  it("refreshes observations even for a new event with identical values", async () => {
    const first = await prepare("contact_attempt_pending");
    const next = await run({ mode: "refresh", leadReference: "", resultReference: "", evidence: "" },
      { previous: first.outcomeMemory, readOutcomes: async () => ({ ...data, leads: [{ ...lead, lastEventId: 99 }] }) });
    expect(next.operations[0].outcomeObservedVersion).not.toBe(first.operations[0].outcomeObservedVersion);
    expect(next.outcomeMemory.revision).toBe(2);
  });
  it("validates memory by account and rejects unknown keys", async () => {
    const first = await prepare("contact_attempt_pending");
    expect(validateCustomerOutcomeMemory(first.outcomeMemory, snapshot)).not.toBeNull();
    expect(validateCustomerOutcomeMemory(first.outcomeMemory, { account: { id: 2 } })).toBeNull();
    expect(validateCustomerOutcomeMemory({ ...first.outcomeMemory, injected: true }, snapshot)).toBeNull();
    expect(customerOutcomeSpecSchema.safeParse({ ...spec, invented: true }).success).toBe(false);
    const context = { version: 1, accountId: 1, intents: [], filters: {}, outcomeMemory: first.outcomeMemory };
    expect(validateCustomerConversationContext(context, snapshot, 1).outcomeMemory).toEqual(first.outcomeMemory);
    expect(validateCustomerConversationContext({ ...context, outcomeMemory: null }, snapshot, 1).outcomeMemory).toBeUndefined();
  });
  it("preserves long candidate lists in assistant history", () => {
    const text = "x".repeat(50000);
    const history = appendCustomerAccountChatHistory([], "registro", text, { outcomeMetadata: { draftId: "draft" } });
    expect(history.at(-1).text).toHaveLength(50000);
  });
  it("shared validator rejects nonexistent dates rather than normalizing them", () => {
    expect(parseDateOnlyText("2030-02-30")).toBeNull();
    const rule = getLeadCallOutcomeCatalogResponse("created").transitionRules.find((item) => item.requiresDueDate);
    expect(validateLeadCallOutcomeForCoach({ currentStatusCode: "created", operation: { ...rule, nextActionDueAt: "2030-02-30" } }).ok).toBe(false);
  });
  it.each(getLeadCallOutcomeCatalogResponse().transitionRules)(
    "shared rule $currentStatusCode/$substatusCode/$reasonCode enforces exactly its requirements", (rule) => {
      const operation = { ...rule, comment: "Comentario ficticio", nextActionDueAt: "2030-10-23",
        referredContactName: "Ana Ficticia", referredAreaName: "Compras" };
      expect(validateLeadCallOutcomeForCoach({ currentStatusCode: rule.currentStatusCode, operation }).ok).toBe(true);
      for (const [required, field] of [["requiresDueDate", "nextActionDueAt"], ["requiresComment", "comment"],
        ["requiresReferredContact", "referredContactName"], ["requiresReferredArea", "referredAreaName"]]) {
        expect(validateLeadCallOutcomeForCoach({ currentStatusCode: rule.currentStatusCode, operation: { ...operation, [field]: "" } }).ok).toBe(!rule[required]);
      }
    });
  it("resolves a verified title and never falls back from an unknown name to the only lead", async () => {
    const result = await run({ leadReference: "Lead ficticio", resultReference: resultName("contact_attempt_pending"),
      evidence: `Lead ficticio ${resultName("contact_attempt_pending")}` }, { readOutcomes: async () => ({ ...data, leads: [{ ...lead, title: "Lead ficticio" }] }) });
    expect(result.operations[0].interactionId).toBe(105);
    const unknown = await run({ leadReference: "Fantasma", evidence: "Fantasma" });
    expect(unknown.operations).toEqual([]);
  });
});
