import { beforeEach, describe, expect, it, vi } from "vitest";
const { sql, rules, intents } = vi.hoisted(() => ({ sql: vi.fn(), rules: vi.fn(), intents: vi.fn() }));
vi.mock("../src/db.js", () => ({ query: sql, withTransaction: vi.fn() }));
vi.mock("../src/coach/business-rules.js", () => ({ loadCoachBusinessRules: rules }));
vi.mock("../src/coach/channel-intent-governance.js", () => ({ loadChannelIntentConfigurations: intents }));
import { checkCustomerCreationAccess } from "../src/coach/customer-creation-access.js";

const user = { id: 7, permissionSet: new Set(["mi_coach.execute", "cuentas.read", "contactos.create", "oportunidades.create", "contactos.read"]) };
const operation = { sourceChannel: "customer_account", kind: "create_contact", accountId: 1, payload: { accountId: 1 },
  creationDraftId: "85cdd497-d8af-43a8-b073-3b9e66723ab4", creationRevision: 2 };
describe("A01 module transition authorization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    rules.mockResolvedValue({ operationPolicy: { allowedKinds: ["create_contact", "create_opportunity"] }, scope: {} });
    intents.mockResolvedValue([]);
    sql.mockImplementation(async (text) => text.includes("AS revision") ? [{ revision: 2 }] : [{ id: 1 }]);
  });
  it("revalidates account, policy, permissions and the currently persisted draft revision", async () => {
    expect(await checkCustomerCreationAccess(user, operation)).toBeNull();
    expect(sql.mock.calls[0][1]).toEqual([1, 0, 7]);
    expect(sql.mock.calls[1][1]).toEqual([7, 1, operation.creationDraftId]);
  });
  it.each(["create_contact", "create_opportunity"])("accepts request permission for %s", async (kind) => {
    const permission = kind === "create_contact" ? "contactos.request" : "oportunidades.request";
    expect(await checkCustomerCreationAccess({ ...user, permissionSet: new Set(["cuentas.read", "mi_coach.execute", permission]) },
      { ...operation, kind })).toBeNull();
  });
  it("does not change unrelated Coach or non-creation behavior", async () => {
    expect(await checkCustomerCreationAccess(user, { ...operation, sourceChannel: "coach" })).toBeNull();
    expect(await checkCustomerCreationAccess(user, { ...operation, kind: "activity" })).toBeNull();
    expect(rules).not.toHaveBeenCalled();
  });
  it.each(["policy", "intent"])("blocks revoked %s", async (which) => {
    if (which === "policy") rules.mockResolvedValue({ operationPolicy: { allowedKinds: [] } });
    else intents.mockResolvedValue([{ code: "crm_operation", enabled: false }]);
    expect(await checkCustomerCreationAccess(user, operation)).toMatchObject({ status: 409 });
    expect(sql).not.toHaveBeenCalled();
  });
  it.each([
    ["contactos.update", "mi_coach.execute", "cuentas.read"],
    ["contactos.create", "cuentas.read"],
  ])("blocks revoked domain or execute permission %j", async (...permissions) => {
    expect(await checkCustomerCreationAccess({ ...user, permissionSet: new Set(permissions.flat()) }, operation))
      .toMatchObject({ status: 403 });
  });
  it.each([undefined, 2, -1])("does not accept a different payload account %s", async (accountId) => {
    expect(await checkCustomerCreationAccess(user, { ...operation, payload: { accountId } })).toMatchObject({ status: 400 });
  });
  it("refuses account access that has been revoked", async () => {
    sql.mockResolvedValue([]);
    expect(await checkCustomerCreationAccess(user, operation)).toMatchObject({ status: 404 });
  });
  it.each([{ drafts: [] }, { drafts: [{ revision: 1 }] }, { drafts: [{ revision: 3 }] }])("blocks cancelled, replaced and stale historical proposals %j", async ({ drafts }) => {
    sql.mockImplementation(async (text) => text.includes("AS revision") ? drafts : [{ id: 1 }]);
    expect(await checkCustomerCreationAccess(user, operation)).toMatchObject({ status: 409 });
  });
  it("revalidates that the selected contact still belongs to the account", async () => {
    const selected = { ...operation, kind: "create_opportunity", contactId: 31, payload: { accountId: 1, contactId: 31 } };
    expect(await checkCustomerCreationAccess(user, selected)).toBeNull();
    expect(sql.mock.calls.at(-1)[1]).toEqual([31, 1]);
    sql.mockImplementation(async (text) => text.includes("FROM contacts") ? [] :
      text.includes("AS revision") ? [{ revision: 2 }] : [{ id: 1 }]);
    expect(await checkCustomerCreationAccess(user, selected)).toMatchObject({ status: 404 });
  });
  it("rejects conflicting contact identities or lost read permission", async () => {
    const selected = { ...operation, kind: "create_opportunity", contactId: 31, payload: { accountId: 1, contactId: 32 } };
    expect(await checkCustomerCreationAccess(user, selected)).toMatchObject({ status: 403 });
    expect(await checkCustomerCreationAccess({ ...user, permissionSet: new Set(["cuentas.read", "mi_coach.execute", "oportunidades.create"]) },
      { ...selected, contactId: 32 })).toMatchObject({ status: 403 });
  });
  it("surfaces database failures rather than granting access", async () => {
    sql.mockRejectedValue(new Error("DB unavailable"));
    await expect(checkCustomerCreationAccess(user, operation)).rejects.toThrow("DB unavailable");
  });
});
