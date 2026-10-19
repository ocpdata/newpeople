import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), access: vi.fn(), persist: vi.fn(), session: vi.fn() }));
vi.mock("../src/db.js", () => ({ query: mocks.query, withTransaction: vi.fn() }));
vi.mock("../src/coach/customer-update-access.js", () => ({ checkCustomerUpdateAccess: mocks.access }));
vi.mock("../src/coach/service.js", async (original) => ({
  ...(await original()), persistCoachOperations: mocks.persist, getOrCreateCoachSession: mocks.session,
}));
import router from "../src/routes.mi-agent.js";
const operation = { kind: "account_field", accountId: 1, field: "city", currentValue: "Morelia", value: "Puebla",
  title: "Cambiar ciudad",
  sourceChannel: "customer_account", requiresConfirmation: true,
  updateDraftId: "994843b5-d91b-426b-b850-6c728ff11270", updateItemId: "b7ac43e8-a688-4a53-914e-426c03ea3c90", updateRevision: 1, updateAccountId: 1 };
const saved = { id: 31, sessionId: 22, status: "ready", pendingOperation: operation, version: 1 };
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { id: 7, permissionSet: new Set(["mi_coach.access", "mi_coach.execute", "inteligencia_comercial.access", "cuentas.read", "cuentas.update"]) };
  next();
});
app.use(router);
app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: error.message }));
describe("A02 operation proposal endpoint", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.query.mockResolvedValue([{ id: 1 }]);
    mocks.access.mockResolvedValue(null);
    mocks.persist.mockResolvedValue([saved]);
    mocks.session.mockResolvedValue({ id: 99, status: "active", context: {} });
  });
  const propose = (patch = {}) => request(app).post("/coach/operations").send({
    originChannel: "customer_account", context: { accountId: 1 }, operation: { ...operation, ...patch },
  });
  it("preserves draft identity and returns the original persistent session on retry", async () => {
    const result = await propose().expect(201);
    expect(result.body.sessionId).toBe(22);
    expect(mocks.access).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), expect.objectContaining(operation));
    expect(mocks.persist.mock.calls[0][0].operations[0]).toMatchObject(operation);
  });
  it.each([400, 403, 404, 409, 422])("rejects authorization or eligibility failure %s before persistence", async (status) => {
    mocks.access.mockResolvedValue({ status, message: "Propuesta no vigente" });
    await propose().expect(status);
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it.each(["completed", "cancelled", "rejected", "handed_off"])("does not reopen %s", async (status) => {
    mocks.persist.mockResolvedValue([{ ...saved, status }]);
    await propose().expect(409);
  });
  it("rejects a superseded historical version", async () => {
    mocks.persist.mockResolvedValue([{ ...saved, pendingOperation: { ...operation, updateRevision: 2 } }]);
    await propose().expect(409);
  });
  it("rejects a target outside the current fixed account", async () => {
    await propose({ accountId: 99 }).expect(403);
    expect(mocks.persist).not.toHaveBeenCalled();
  });
});
