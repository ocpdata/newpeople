import { beforeEach, describe, expect, it, vi } from "vitest";
const { sql, rules, intents } = vi.hoisted(() => ({ sql: vi.fn(), rules: vi.fn(), intents: vi.fn() }));
vi.mock("../src/db.js", () => ({ query: sql }));
vi.mock("../src/coach/business-rules.js", () => ({ loadCoachBusinessRules: rules }));
vi.mock("../src/coach/channel-intent-governance.js", () => ({ loadChannelIntentConfigurations: intents }));
import { checkCustomerLinkAccess } from "../src/coach/customer-link-access.js";
const user = { id: 7, permissionSet: new Set(["mi_coach.execute", "cuentas.read", "contactos.read", "oportunidades.read", "oportunidades.update"]) };
const operation = { kind: "link_contact_to_opportunity", sourceChannel: "customer_account", accountId: 1, opportunityId: 3, contactId: 2,
  payload: { accountId: 1, contactId: 2 }, linkDraftId: "draft", linkRevision: 1, currentContactId: 6,
  linkSummary: { accountName: "Cuenta", opportunityName: "Alfa", contactName: "Elena", currentContactName: "Anterior", effect: "replace" } };
const memory = () => ({ accountId: 1, opportunityId: 3, contactId: 2, revision: 1, currentContactId: 6, observed: true, intent: "assign" });
describe("A04 current draft access", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    rules.mockResolvedValue({ operationPolicy: { allowedKinds: ["link_contact_to_opportunity"] }, scope: {} });
    intents.mockResolvedValue([]);
    sql.mockImplementation(async (text) => {
      if (text.includes("context_json")) return [{ context_json: { linkMemory: memory() } }];
      if (text.includes("FROM opportunities")) return [{ id: 3, opportunityName: "Alfa", currentContactId: 6, commercialStatusCode: "abierta" }];
      if (text.includes("contactName")) return [{ id: 2, contactName: "Elena" }];
      if (text.includes("AS name FROM contacts")) return [{ name: "Anterior" }];
      return [{ id: 1, accountName: "Cuenta" }];
    });
  });
  it("revalidates the current memory, ownership and both endpoints", async () => {
    expect(await checkCustomerLinkAccess(user, operation)).toBeNull();
    expect(sql.mock.calls[0][1]).toEqual([7, 1, "draft"]);
    expect(sql.mock.calls[2][1]).toEqual([3, 1]);
    expect(sql.mock.calls[3][1]).toEqual([2, 1]);
  });
  it("preserves unrelated and legacy behavior", async () => {
    expect(await checkCustomerLinkAccess(user, { kind: "link_contact_to_opportunity" })).toBeNull();
    expect(sql).not.toHaveBeenCalled();
  });
  it.each(["intent", "contactSearchAllowed", "opportunitySearchAllowed"])("blocks disabled %s", async (which) => {
    if (which === "intent") intents.mockResolvedValue([{ code: "crm_operation", enabled: false }]);
    else rules.mockResolvedValue({ operationPolicy: { allowedKinds: ["link_contact_to_opportunity"] }, scope: { [which]: false } });
    expect(await checkCustomerLinkAccess(user, operation)).toMatchObject({ status: 409 });
  });
  it.each([{ revision: 2 }, { opportunityId: 99 }, { contactId: 99 }, { observed: false }, { intent: "add" }])(
    "rejects memory mismatch %j", async (patch) => {
      sql.mockResolvedValue([{ context_json: { linkMemory: { ...memory(), ...patch } } }]);
      expect(await checkCustomerLinkAccess(user, operation)).toMatchObject({ status: 409 });
    });
  it("rejects inconsistent top-level and payload identities", async () => {
    expect(await checkCustomerLinkAccess(user, { ...operation, payload: { accountId: 1, contactId: 99 } })).toMatchObject({ status: 400 });
  });
  it("does not accept altered display names or a forged replacement/assignment effect", async () => {
    expect(await checkCustomerLinkAccess(user, { ...operation, linkSummary: { ...operation.linkSummary, contactName: "Forged" } }))
      .toMatchObject({ status: 409 });
    expect(await checkCustomerLinkAccess(user, { ...operation, linkSummary: { ...operation.linkSummary, effect: "assign" } }))
      .toMatchObject({ status: 409 });
  });
  it("uses global read grants without removing fixed-account predicates", async () => {
    const global = { ...user, permissionSet: new Set(["mi_coach.execute", "cuentas.read_all", "contactos.read_all", "oportunidades.read_all", "oportunidades.update"]) };
    expect(await checkCustomerLinkAccess(global, operation)).toBeNull();
    expect(sql.mock.calls[1][1]).toEqual([1, 1, 7]);
  });
  it("locks memory, account and both writable endpoints in a transaction", async () => {
    expect(await checkCustomerLinkAccess(user, operation, { lock: true })).toBeNull();
    expect(sql.mock.calls.slice(0, 4).every(([text]) => text.endsWith(" FOR UPDATE"))).toBe(true);
  });
  it("surfaces database failures", async () => {
    sql.mockRejectedValue(new Error("DB unavailable"));
    await expect(checkCustomerLinkAccess(user, operation)).rejects.toThrow("DB unavailable");
  });
});
