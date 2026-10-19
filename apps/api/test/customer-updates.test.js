import { describe, expect, it, vi } from "vitest";
import { buildCustomerUpdateResponse, validateCustomerUpdateMemory } from "../src/commercial-intelligence/customer-updates.js";
import { CUSTOMER_UPDATE_FIELDS, normalizeCustomerUpdateValue } from "../src/coach/customer-field-values.js";
import { coachOperationSchema } from "../src/coach/contract.js";
import { validateCustomerConversationContext } from "../src/commercial-intelligence/conversation-context.js";

const snapshot = { account: { id: 1, name: "Cuenta" }, contacts: [{ id: 2, accountId: 1, name: "Elena" }],
  opportunities: [{ id: 3, accountId: 1, name: "Alfa" }, { id: 4, accountId: 1, name: "Alfa tres años" }] };
const change = (field = "amountUsd", value = "550.000", evidence = `${value} USD`, action = "set") => ({ field, value, evidence, action });
async function run(changes = [change()], options = {}) {
  const { object = "opportunity", mode = "start", reference = object === "opportunity" ? "Alfa" : object === "contact" ? "Elena" : "",
    question = changes.map((item) => item.evidence).join("; "), readRecord = vi.fn(async () => ({ amountUsd: "500000.00" })),
    loadStates = vi.fn(async () => []), component = {}, spec = {}, ...rest } = options;
  return buildCustomerUpdateResponse({ question, snapshot, movement: "new_request", ...rest,
    component: { object, scope: "single", reference: "", updateSpec: { changes, targetReference: reference, mode, ...spec }, ...component },
    readRecord, loadStates });
}
describe("A02 typed update drafts", () => {
  it("prepares an exact before/after without writes or invented identifiers", async () => {
    const result = await run();
    expect(result.operations).toHaveLength(1);
    expect(coachOperationSchema.parse(result.operations[0])).toMatchObject({
      opportunityId: 3, field: "amountUsd", currentValue: 500000, value: 550000, requiresConfirmation: true,
    });
    expect(result.updateMetadata).toMatchObject({ currentValue: 500000, proposedValue: 550000, targetId: 3 });
    expect(result.answer).toContain("No se guardó");
  });
  it.each(Object.entries(CUSTOMER_UPDATE_FIELDS).flatMap(([object, fields]) => Object.keys(fields).map((field) => [object, field])))(
    "supports the approved %s.%s field", async (object, field) => {
      const value = field === "amountUsd" ? "0" : field === "closeDate" ? "2028-02-29" :
        field === "email" ? "elena@example.invalid" : field === "website" ? "https://example.invalid" : "Nuevo valor";
      const result = await run([change(field, value, `${value}${field === "amountUsd" ? " USD" : ""}`)], {
        object, readRecord: async () => ({ [field]: null }),
      });
      expect(result.operations).toHaveLength(1);
      expect(coachOperationSchema.safeParse(result.operations[0]).success).toBe(true);
    });
  it.each(["-1", "1e3", "Infinity", "1.2345", "100000000000000", "texto"])("rejects invalid amount %s", async (value) => {
    const result = await run([change("amountUsd", value)]);
    expect(result.operations).toEqual([]);
    expect(result.responseType).toBe("clarification");
  });
  it.each([["550,000.25", 550000.25], ["550.000,25", 550000.25], ["12,25", 12.25], ["0", 0]])(
    "parses literal USD %s exactly", async (value, expected) => {
      const result = await run([change("amountUsd", value)]);
      expect(result.operations[0].value).toBe(expected);
    });
  it.each([["550000", "550.000 USD"], ["550000", "USD 550.000"], ["550000.5", "550.000,50 dólares"]])(
    "accepts a normalized amount only when its currency and literal amount are evidenced: %s / %s",
    async (value, evidence) => {
      const result = await run([change("amountUsd", value, evidence)]);
      expect(result.operations[0].value).toBe(Number(value));
    },
  );
  it("rejects a normalized amount that differs from the literal amount in the evidence", async () => {
    const result = await run([change("amountUsd", "550001", "550.000 USD")]);
    expect(result.operations).toEqual([]);
  });
  it.each(["550 mil", "$550", "550 MXN"])("asks for an unambiguous USD value from %s", async (evidence) => {
    expect((await run([change("amountUsd", "550", evidence)])).operations).toEqual([]);
  });
  it.each(["2027-02-29", "2028-04-31", "mañana", "01/02/2027"])("rejects ambiguous or impossible date %s", async (value) => {
    expect((await run([change("closeDate", value, value)])).operations).toEqual([]);
  });
  it("enforces current literal evidence and preserves the prior proposal after a fabricated value", async () => {
    const first = await run();
    const result = await run([change("amountUsd", "42")], { previous: first.updateMemory, mode: "continue", question: "muéstrame" });
    expect(result.operations).toEqual([]);
    expect(result.updateMemory).toEqual(first.updateMemory);
  });
  it("does not claim to preserve a draft when none existed", async () => {
    const result = await run([change("amountUsd", "42", "42 USD")], {
      question: "cambia a 41 USD",
    });
    expect(result.answer).toContain("No preparé ningún cambio");
    expect(result.answer).not.toContain("Conservé el borrador anterior");
  });
  it("retains requested values while resolving ambiguous targets, including ordinal revalidation", async () => {
    const first = await run([change()], { reference: "Alfa " , snapshot: {
      ...snapshot, opportunities: snapshot.opportunities.map((item) => ({ ...item, name: `Proyecto ${item.name}` })),
    } });
    const ambiguous = await run([change()], { reference: "Alfa", snapshot: { ...snapshot, opportunities: [
      { id: 3, accountId: 1, name: "Proyecto Alfa" }, { id: 4, accountId: 1, name: "Proyecto Alfa largo" },
    ] } });
    expect(ambiguous.operations).toEqual([]);
    expect(ambiguous.updateMemory.items[0].value).toBe("550.000");
    const selected = await run([], { mode: "continue", reference: "", previous: ambiguous.updateMemory,
      snapshot: { ...snapshot, opportunities: [{ id: 3, accountId: 1, name: "Proyecto Alfa" }, { id: 4, accountId: 1, name: "Proyecto Alfa largo" }] },
      component: { listPosition: 2 } });
    expect(selected.operations[0].opportunityId).toBe(4);
    const stale = await run([], { mode: "continue", reference: "", previous: ambiguous.updateMemory,
      component: { listPosition: 2 }, snapshot: { ...snapshot, opportunities: [{ id: 4, accountId: 1, name: "Proyecto Alfa largo" }] } });
    expect(stale.operations).toEqual([]);
    expect(stale.answer).toContain("cambiaron");
    expect(first.updateMemory).toBeTruthy();
  });
  it("does not trust IDs or guess a collection target", async () => {
    expect((await run([change()], { reference: "3" })).operations).toEqual([]);
    expect((await run([change()], { component: { scope: "collection" } })).operations).toEqual([]);
  });
  it("asks for a target before preparing a change to an opportunity", async () => {
    const readRecord = vi.fn();
    const result = await run([change()], { reference: "", readRecord });
    expect(result.operations).toEqual([]);
    expect(result.answer).toContain("¿Qué oportunidad quieres actualizar?");
    expect(readRecord).not.toHaveBeenCalled();
  });
  it("collects a missing value and later corrects only that field", async () => {
    const first = await run([change("amountUsd", "", "cambia el monto", "pending")]);
    expect(first.operations).toEqual([]);
    const result = await run([change("amountUsd", "540000")], { previous: first.updateMemory, mode: "continue", reference: "" });
    expect(result.operations[0].value).toBe(540000);
    expect(result.updateMemory.draftId).toBe(first.updateMemory.draftId);
    expect(result.updateMemory.revision).toBe(2);
  });
  it("keeps multiple fields and refuses to skip an unconfirmed operation", async () => {
    const first = await run([change(), change("name", "Nombre nuevo", "Nombre nuevo")]);
    expect(first.operations).toHaveLength(1);
    expect(first.pendingItems).toEqual(["Importe USD", "Nombre"]);
    const next = await run([], { previous: first.updateMemory, mode: "next", reference: "" });
    expect(next.operations[0].field).toBe("amountUsd");
    expect(next.answer).toContain("sigue pendiente");
    const completed = await run([], { previous: first.updateMemory, mode: "next", reference: "",
      loadStates: async () => [{ status: "completed", operation: first.operations[0] }],
      readRecord: async () => ({ name: "Alfa" }) });
    expect(completed.operations[0].field).toBe("name");
    expect(completed.updateMetadata.changes[0].status).toBe("completed");
  });
  it("discards only the current proposal without clearing the CRM value", async () => {
    const first = await run([change(), change("name", "Nuevo nombre", "Nuevo nombre")]);
    const next = await run([], { previous: first.updateMemory, reference: "", mode: "discard_current",
      readRecord: async () => ({ name: "Alfa" }) });
    expect(next.operations[0].field).toBe("name");
    expect(next.updateMemory.items[0].status).toBe("discarded");
  });
  it("does not mark a corrected value as saved if an older version completed concurrently", async () => {
    const first = await run();
    const revised = await run([change("amountUsd", "540000")], { previous: first.updateMemory, mode: "continue", reference: "" });
    const next = await run([], { previous: revised.updateMemory, mode: "next", reference: "",
      loadStates: async () => [{ status: "completed", operation: first.operations[0] }] });
    expect(next.operations).toEqual([]);
    expect(next.responseType).toBe("error");
    expect(next.answer).toContain("No acredité tu nuevo valor");
    expect(next.updateMemory.items[0].status).toBe("pending");
  });
  it("does not let another target's persisted status advance the queue", async () => {
    const first = await run();
    const next = await run([], { previous: first.updateMemory, mode: "next", reference: "",
      loadStates: async () => [{ status: "completed", operation: { ...first.operations[0], opportunityId: 99 } }] });
    expect(next.operations[0].field).toBe("amountUsd");
    expect(next.updateMemory.items[0].status).toBe("pending");
  });
  it("handles explicit removal of a queued proposal, not a CRM clear", async () => {
    const first = await run();
    const removed = await run([change("amountUsd", "", "retira el cambio de monto", "remove")],
      { previous: first.updateMemory, reference: "", mode: "continue" });
    expect(removed.operations).toEqual([]);
    expect(removed.updateMetadata.status).toBe("finished");
  });
  it("clears only optional fields explicitly and never clears required names, amount or date", async () => {
    const result = await run([change("phone", "", "vacía el teléfono", "clear")], { object: "contact", readRecord: async () => ({ phone: "555" }) });
    expect(result.operations[0].value).toBe("");
    for (const field of ["name", "amountUsd", "closeDate"]) {
      expect((await run([change(field, "", `vacía ${field}`, "clear")])).operations).toEqual([]);
    }
  });
  it("marks already-equal values as no-change without generating a write", async () => {
    const result = await run([change("amountUsd", "500000")]);
    expect(result.operations).toEqual([]);
    expect(result.updateMetadata.status).toBe("no_change");
    expect(result.updateMemory.items[0].status).toBe("no_change");
  });
  it("blocks closed opportunities before reading or proposing", async () => {
    const readRecord = vi.fn();
    const result = await run([change()], { readRecord, snapshot: { ...snapshot,
      opportunities: [{ ...snapshot.opportunities[0], commercialStatusCode: "ganada" }] } });
    expect(result.operations).toEqual([]);
    expect(readRecord).not.toHaveBeenCalled();
  });
  it("blocks an opportunity closed after target selection and exposes read failures", async () => {
    const blocked = await run([change()], { readRecord: async () => { throw Object.assign(new Error("Cerrada"), { status: 422 }); } });
    expect(blocked.responseType).toBe("error");
    expect(blocked.operations).toEqual([]);
    await expect(run([change()], { readRecord: async () => { throw new Error("DB failed"); } })).rejects.toThrow("DB failed");
    await expect(run([change()], { readRecord: async () => ({}) })).rejects.toThrow("campo");
  });
  it("does not move values to another target without an explicit new request", async () => {
    const first = await run();
    const blocked = await run([], { previous: first.updateMemory, mode: "continue", reference: "Alfa tres años" });
    expect(blocked.updateMemory).toEqual(first.updateMemory);
    expect(blocked.operations).toEqual([]);
    const next = await run([change()], { previous: first.updateMemory, mode: "start", reference: "Alfa tres años" });
    expect(next.operations[0].opportunityId).toBe(4);
    expect(next.updateMemory.draftId).not.toBe(first.updateMemory.draftId);
  });
  it("rejects cross-account destinations and stale/invalid memory", async () => {
    const first = await run();
    expect(validateCustomerUpdateMemory({ ...first.updateMemory, accountId: 99 }, snapshot)).toBeNull();
    expect(validateCustomerUpdateMemory({ ...first.updateMemory, items: [{ ...first.updateMemory.items[0], field: "salesStageId" }] }, snapshot)).toBeNull();
    expect((await run([change()], { snapshot: { ...snapshot, opportunities: [{ id: 3, accountId: 99, name: "Alfa" }] } })).operations).toEqual([]);
    expect(validateCustomerConversationContext({ version: 1, accountId: 1, updateMemory: first.updateMemory }, snapshot, 1).updateMemory)
      .toEqual(first.updateMemory);
  });
  it("does not silently truncate values or duplicate a field", async () => {
    expect((await run([change("name", "x".repeat(181), "x".repeat(181))])).operations).toEqual([]);
    expect((await run([change(), change()])).operations).toEqual([]);
    expect(() => normalizeCustomerUpdateValue("account", "companyDescription", "x".repeat(10001))).toThrow();
  });
});
