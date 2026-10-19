import { beforeEach, describe, expect, it, vi } from "vitest";
const { sql, rules, intents } = vi.hoisted(() => ({ sql: vi.fn(), rules: vi.fn(), intents: vi.fn() }));
vi.mock("../src/db.js", () => ({ query: sql }));
vi.mock("../src/coach/business-rules.js", () => ({ loadCoachBusinessRules: rules }));
vi.mock("../src/coach/channel-intent-governance.js", () => ({ loadChannelIntentConfigurations: intents }));
import { checkCustomerUpdateAccess, readCustomerUpdateRecord } from "../src/coach/customer-update-access.js";
const user = { id: 7, permissionSet: new Set(["cuentas.read", "mi_coach.execute", "contactos.read", "contactos.update"]) };
const operation = { kind: "contact_field", sourceChannel: "customer_account", contactId: 2, field: "email", value: "elena@example.invalid",
  updateDraftId: "322b1ca4-e7d4-462d-b7ea-033568af3f50", updateRevision: 1, updateAccountId: 1,
  updateItemId: "f5e6abc6-3ee7-46d6-9b99-2df6ad5c91bf" };
const memory = () => ({ object: "contact", accountId: 1, targetId: 2, revision: 1,
  items: [{ id: operation.updateItemId, field: "email", value: operation.value, action: "set", status: "pending" }] });
describe("A02 current draft and target authorization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    rules.mockResolvedValue({ operationPolicy: { allowedKinds: ["contact_field"] }, scope: {} });
    intents.mockResolvedValue([]);
    sql.mockImplementation(async (text) => text.includes("context_json") ? [{ context_json: { updateMemory: memory() } }] : [{ id: 2 }]);
  });
  it("revalidates identity, revision, literal value, ownership and account relationship", async () => {
    expect(await checkCustomerUpdateAccess(user, operation)).toBeNull();
    expect(sql.mock.calls[0][1]).toEqual([7, 1, operation.updateDraftId]);
    expect(sql.mock.calls[1][1]).toEqual([2, 1, 0, 1, 7]);
  });
  it("does not affect legacy operations", async () => {
    expect(await checkCustomerUpdateAccess(user, { kind: "contact_field" })).toBeNull();
    expect(sql).not.toHaveBeenCalled();
  });
  it.each(["mi_coach.execute", "contactos.update", "contactos.read", "cuentas.read"])("rejects revoked %s", async (permission) => {
    expect(await checkCustomerUpdateAccess({ ...user, permissionSet: new Set([...user.permissionSet].filter((code) => code !== permission)) }, operation))
      .toMatchObject({ status: 403 });
  });
  it.each([{ updateRevision: 2 }, { contactId: 3 }, { updateAccountId: 2 }, { updateItemId: "other" }, { field: "phone" }, { value: "injected@example.invalid" }])(
    "rejects stale, mismatched or externally edited proposal %j", async (patch) => {
      expect(await checkCustomerUpdateAccess(user, { ...operation, ...patch })).toMatchObject({ status: 409 });
    });
  it.each(["completed", "discarded", "no_change"])("rejects already attended field %s", async (status) => {
    const updateMemory = memory(); updateMemory.items[0].status = status;
    sql.mockResolvedValue([{ context_json: JSON.stringify({ updateMemory }) }]);
    expect(await checkCustomerUpdateAccess(user, operation)).toMatchObject({ status: 409 });
  });
  it("rejects a cancelled conversation and an unavailable record without treating either as writable", async () => {
    sql.mockResolvedValue([]);
    expect(await checkCustomerUpdateAccess(user, operation)).toMatchObject({ status: 409 });
    sql.mockImplementation(async (text) => text.includes("context_json") ? [{ context_json: { updateMemory: memory() } }] : []);
    expect(await checkCustomerUpdateAccess(user, operation)).toMatchObject({ status: 404 });
  });
  it.each(["rules", "intent", "scope"])("honors revoked %s", async (which) => {
    if (which === "rules") rules.mockResolvedValue({ operationPolicy: { allowedKinds: [] } });
    if (which === "intent") intents.mockResolvedValue([{ code: "crm_operation", enabled: false }]);
    if (which === "scope") rules.mockResolvedValue({ operationPolicy: { allowedKinds: ["contact_field"] }, scope: { contactSearchAllowed: false } });
    expect(await checkCustomerUpdateAccess(user, operation)).toMatchObject({ status: 409 });
  });
  it.each(["ganada", "perdida", "anulada"])("blocks an opportunity that is now %s", async (commercialStatusCode) => {
    sql.mockResolvedValue([{ id: 3, commercialStatusCode }]);
    await expect(readCustomerUpdateRecord({ user: { ...user, permissionSet: new Set(["cuentas.read", "oportunidades.read"]) },
      object: "opportunity", accountId: 1, targetId: 3 })).rejects.toMatchObject({ status: 422 });
  });
  it("uses locks on the current session and target when called transactionally", async () => {
    expect(await checkCustomerUpdateAccess(user, operation, { lock: true })).toBeNull();
    expect(sql.mock.calls.every(([text]) => text.endsWith(" FOR UPDATE"))).toBe(true);
  });
  it("supports global read grants without silently bypassing the account relationship", async () => {
    const globalUser = { ...user, permissionSet: new Set(["cuentas.read_all", "contactos.read_all", "contactos.update", "mi_coach.execute"]) };
    expect(await checkCustomerUpdateAccess(globalUser, operation)).toBeNull();
    expect(sql.mock.calls.at(-1)[1]).toEqual([2, 1, 1, 1, 7]);
  });
  it("allows an explicit optional-field clear only when it matches the current draft", async () => {
    const updateMemory = memory(); Object.assign(updateMemory.items[0], { value: "", action: "clear" });
    sql.mockImplementation(async (text) => text.includes("context_json") ? [{ context_json: { updateMemory } }] : [{ id: 2 }]);
    expect(await checkCustomerUpdateAccess(user, { ...operation, value: "" })).toBeNull();
  });
  it("propagates database failures", async () => {
    sql.mockRejectedValue(new Error("DB unavailable"));
    await expect(checkCustomerUpdateAccess(user, operation)).rejects.toThrow("DB unavailable");
  });
});
