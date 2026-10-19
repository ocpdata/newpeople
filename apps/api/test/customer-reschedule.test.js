import { describe, expect, it, vi } from "vitest";
import { buildCustomerRescheduleResponse, validateCustomerRescheduleMemory } from "../src/commercial-intelligence/customer-reschedule.js";
import { proposeSchedule, scheduleUtc } from "../src/coach/customer-reschedule-time.js";
import { coachOperationSchema } from "../src/coach/contract.js";
import { customerComponentCapability, customerTurnContractSchema } from "../src/commercial-intelligence/turn-contract.js";
import { appendCustomerAccountChatHistory } from "../src/commercial-intelligence/customer-chat-adapter.js";
import { getCoachBusinessRules } from "../src/coach/business-rules.js";
import { customerServerRulesPatchSchema } from "../src/coach/server-policy.js";

const now = new Date("2026-10-17T12:00:00Z"), timeZone = "America/Mexico_City";
const activity = { id: 75, opportunityId: 3, title: "Reunión Compras", actionType: "meeting_virtual", status: "pending",
  scheduledAt: new Date("2026-10-20T16:00:00Z"), dueDate: "2026-10-20" };
const data = { accountName: "Cuenta ficticia", opportunities: [{ id: 3, name: "Proyecto Alfa", status: "abierta" }], activities: [activity] };
const snapshot = { account: { id: 1, name: "Cuenta ficticia" } };
const spec = { mode: "start", opportunityReference: "Proyecto Alfa", activityReference: "75", selectionTarget: "none",
  position: 0, dateText: "2026-10-23", timeText: "", evidence: "Mueve 75 de Proyecto Alfa al 2026-10-23" };
const run = (patch = {}, options = {}) => buildCustomerRescheduleResponse({
  component: { object: "activity", scope: "single", rescheduleSpec: { ...spec, ...patch } },
  movement: "new_request", question: patch.evidence ?? spec.evidence, snapshot,
  readSchedule: vi.fn(async () => data), timeZone, now, ...options,
});
describe("A06 deterministic rescheduling", () => {
  it("creates a typed proposal retaining identity and time", async () => {
    const result = await run();
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]).toMatchObject({ kind: "reschedule_activity", activityId: 75, opportunityId: 3, proposedAt: "2026-10-23T16:00:00.000Z", proposedDueDate: "2026-10-23" });
    expect(coachOperationSchema.safeParse(result.operations[0]).success).toBe(true);
    expect(result.answer).toContain("no guardada");
  });
  it("resolves an activity ID without assuming an opportunity", async () => {
    const result = await run({ opportunityReference: "" });
    expect(result.operations[0].opportunityId).toBe(3);
  });
  it("changes only the hour while retaining the date", async () => {
    const result = await run({ dateText: "", timeText: "17:30", evidence: "Mueve 75 de Proyecto Alfa a 17:30" });
    expect(result.operations[0].proposedAt).toBe("2026-10-20T23:30:00.000Z");
  });
  it("returns no_change without operation", async () => {
    const result = await run({ dateText: "2026-10-20", evidence: "Mueve 75 de Proyecto Alfa al 2026-10-20" });
    expect(result.operations).toEqual([]);
    expect(result.rescheduleMetadata.status).toBe("no_change");
  });
  it("rejects fabricated current-message evidence", async () => {
    expect((await run({ dateText: "2030-01-01" })).operations).toEqual([]);
  });
  it("does not accept unsupported bulk/field changes", async () => {
    expect((await run({ unsupported: ["cambiar responsable"] })).operations).toEqual([]);
  });
  it.each(["done", "cancelled", "in_progress", "blocked"])("blocks activity status %s", async (status) => {
    expect((await run({}, { readSchedule: async () => ({ ...data, activities: [{ ...activity, status }] }) })).responseType).toBe("error");
  });
  it.each(["ganada", "perdida", "anulada"])("blocks opportunity status %s", async (status) => {
    expect((await run({}, { readSchedule: async () => ({ ...data, opportunities: [{ ...data.opportunities[0], status }] }) })).responseType).toBe("error");
  });
  it("rejects action items even if pending", async () => {
    expect((await run({}, { readSchedule: async () => ({ ...data, activities: [{ ...activity, actionType: "next_step" }] }) })).operations).toEqual([]);
  });
  it("requires missing dates and ambiguous hours rather than inventing", async () => {
    expect((await run({ dateText: "", timeText: "" })).responseType).toBe("clarification");
    expect((await run({ timeText: "cinco", evidence: "Mueve 75 de Proyecto Alfa al 2026-10-23 a las cinco" })).operations).toEqual([]);
  });
  it("clarifies ambiguous matches and revalidates ordinal lists", async () => {
    const records = { ...data, activities: [activity, { ...activity, id: 76 }] };
    const first = await run({ activityReference: "Reunión", evidence: "Mueve Reunión de Proyecto Alfa al 2026-10-23" }, { readSchedule: async () => records });
    expect(first.operations).toEqual([]);
    expect(first.rescheduleMemory.activityCandidates).toEqual([75, 76]);
    const patch = { mode: "continue", opportunityReference: "", activityReference: "", dateText: "", selectionTarget: "activity", position: 2, evidence: "la segunda" };
    const selected = await run(patch, { previous: first.rescheduleMemory, readSchedule: async () => records });
    expect(selected.operations[0].activityId).toBe(76);
    expect((await run(patch, { previous: first.rescheduleMemory,
      readSchedule: async () => ({ ...records, activities: [...records.activities].reverse() }) })).operations).toEqual([]);
  });
  it("corrects a date in the same draft and increments revision", async () => {
    const first = await run();
    const next = await run({ mode: "continue", opportunityReference: "", activityReference: "", dateText: "2026-10-24", evidence: "Mejor 2026-10-24" }, { previous: first.rescheduleMemory });
    expect(next.rescheduleMemory.draftId).toBe(first.rescheduleMemory.draftId);
    expect(next.rescheduleMemory.revision).toBe(2);
  });
  it("refresh invalidates the previous revision and reobserves the activity", async () => {
    const first = await run();
    const next = await run({ mode: "refresh", opportunityReference: "", activityReference: "", dateText: "", evidence: "" }, { previous: first.rescheduleMemory });
    expect(next.operations[0].rescheduleRevision).toBe(2);
  });
  it("rejects unavailable records and does not hide database failures", async () => {
    expect((await run({}, { readSchedule: async () => ({ ...data, activities: [] }) })).operations).toEqual([]);
    await expect(run({}, { readSchedule: async () => { throw new Error("DB down"); } })).rejects.toThrow("DB down");
  });
  it("does not resolve an unknown numeric ID by substring in an activity title", async () => {
    expect((await run({ activityReference: "999", evidence: "Mueve 999 de Proyecto Alfa al 2026-10-23" },
      { readSchedule: async () => ({ ...data, activities: [{ ...activity, title: "Reunión 999" }] }) })).operations).toEqual([]);
  });
  it("newly observed names invalidate the proposal even without explicit refresh", async () => {
    const first = await run();
    const next = await run({ mode: "review", opportunityReference: "", activityReference: "", dateText: "", evidence: "" }, {
      previous: first.rescheduleMemory, readSchedule: async () => ({ ...data, accountName: "Nombre actualizado" }),
    });
    expect(next.operations[0].rescheduleRevision).toBe(2);
  });
  it("keeps memory account-scoped and strict", async () => {
    const memory = (await run()).rescheduleMemory;
    expect(validateCustomerRescheduleMemory(memory, snapshot)).toEqual(memory);
    expect(validateCustomerRescheduleMemory(memory, { account: { id: 2 } })).toBeNull();
    expect(validateCustomerRescheduleMemory({ ...memory, extra: 1 }, snapshot)).toBeNull();
  });
  it("preserves historical metadata without claiming a write", async () => {
    const result = await run();
    expect(appendCustomerAccountChatHistory([], "mueve", result.answer,
      { rescheduleMetadata: result.rescheduleMetadata }).at(-1).rescheduleMetadata).toEqual(result.rescheduleMetadata);
  });
  it("preserves all 100 displayed candidates in persisted history instead of truncating the selection list", async () => {
    const activities = Array.from({ length: 100 }, (_, index) => ({ ...activity, id: index + 100,
      title: `Reunión ${"seguimiento ".repeat(12)}${index + 1}` }));
    const result = await run({ activityReference: "Reunión", evidence: "Mueve Reunión de Proyecto Alfa al 2026-10-23" },
      { readSchedule: async () => ({ ...data, activities }) });
    const history = appendCustomerAccountChatHistory([], "mueve", result.answer, { rescheduleMetadata: result.rescheduleMetadata });
    expect(history.at(-1).text).toBe(result.answer);
    expect(history.at(-1).text).toContain("ID 199");
    expect(appendCustomerAccountChatHistory(history, "otra consulta", "ok").find((item) => item.rescheduleMetadata).text).toBe(result.answer);
  });
  it("registers A06 as a dedicated delegated operation", () => {
    expect(customerComponentCapability({ category: "action.reschedule_activity", object: "activity" }).operationKind).toBe("reschedule_activity");
    expect(customerTurnContractSchema).toBeDefined();
  });
  it("supports explicit administrative opt-in without changing defaults or other channels", () => {
    expect(getCoachBusinessRules({ channel: "customer_account" }).operationPolicy.allowedKinds).not.toContain("reschedule_activity");
    expect(customerServerRulesPatchSchema.safeParse({ operationPolicy: { allowedKinds: ["reschedule_activity"] } }).success).toBe(true);
    expect(getCoachBusinessRules({ channel: "customer_account", overrides: { operationPolicy: { allowedKinds: ["reschedule_activity"] } } }).operationPolicy.allowedKinds).toEqual(["reschedule_activity"]);
    expect(getCoachBusinessRules({ channel: "coach", overrides: { operationPolicy: { allowedKinds: ["reschedule_activity"] } } }).operationPolicy.allowedKinds).toEqual([]);
  });
});
describe("A06 temporal rules", () => {
  const propose = (dateText, timeText = "") => proposeSchedule({ current: activity.scheduledAt, dateText, timeText, timeZone, now });
  it.each(["2026-10-23", "23/10/2026", "23 de octubre de 2026", "viernes"])("resolves date %s with business timezone", (text) => {
    expect(propose(text).proposed).toBe("2026-10-23T16:00:00.000Z");
  });
  it("resolves tomorrow from a fixed business clock", () => {
    expect(propose("mañana").dueDate).toBe("2026-10-18");
  });
  it.each(["5 pm", "cinco de la tarde", "17:00"])("resolves explicit hour %s", (text) => {
    expect(propose("2026-10-23", text).proposed).toBe("2026-10-23T23:00:00.000Z");
  });
  it.each(["2026-02-30", "2026-13-01", "2020-01-01", "el otro día", "constructor", "__proto__"])("refuses invalid or past date %s", (text) => {
    expect(propose(text).error).toBeTruthy();
  });
  it.each(["25:00", "17:75", "cinco", "5", "aproximadamente cinco"])("refuses ambiguous or invalid time %s", (text) => {
    expect(propose("2026-10-23", text).error).toBeTruthy();
  });
  it("rejects nonexistent and ambiguous local times at DST boundaries", () => {
    expect(scheduleUtc("2027-03-14T02:30:00", "America/New_York")).toBeNull();
    expect(scheduleUtc("2026-11-01T01:30:00", "America/New_York")).toBeNull();
    expect(scheduleUtc("2026-11-01T03:30:00", "America/New_York")).toBeInstanceOf(Date);
  });
});
