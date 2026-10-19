import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(), access: vi.fn(), getOperation: vi.fn(), persist: vi.fn(),
  getSession: vi.fn(), handoff: vi.fn(), loadHandoff: vi.fn(),
}));
vi.mock("../src/db.js", () => ({ query: mocks.query, withTransaction: vi.fn() }));
vi.mock("../src/coach/customer-creation-access.js", () => ({ checkCustomerCreationAccess: mocks.access }));
vi.mock("../src/coach/service.js", async (original) => ({
  ...(await original()), getCoachOperation: mocks.getOperation, persistCoachOperations: mocks.persist,
  getOrCreateCoachSession: mocks.getSession, createCoachHandoff: mocks.handoff, getCoachHandoff: mocks.loadHandoff,
}));
import router from "../src/routes.mi-agent.js";

const operation = {
  kind: "create_contact", sourceChannel: "customer_account", accountId: 1,
  payload: { accountId: 1, firstName: "Ana", lastName: "Luna" }, title: "Preparar contacto",
  creationDraftId: "85cdd497-d8af-43a8-b073-3b9e66723ab4", creationRevision: 1,
  evidence: [], missingFields: [], requiresConfirmation: true,
};
const saved = {
  id: 31, sessionId: 22, kind: "create_contact", sourceChannel: "customer_account", status: "ready",
  pendingOperation: operation, targetModule: "contacts", targetRoute: "/contacts", version: 1,
  handoffToken: "fixture-token", handoffExpiresAt: "2027-01-01", identifiedEntities: {},
};
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { id: 7, permissionSet: new Set([
    "mi_coach.access", "mi_coach.execute", "inteligencia_comercial.access", "cuentas.read", "contactos.create",
  ]) };
  next();
});
app.use(router);
app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: error.message }));

describe("A01 official operation and handoff endpoints", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.query.mockResolvedValue([{ id: 1 }]);
    mocks.access.mockResolvedValue(null);
    mocks.getOperation.mockResolvedValue(saved);
    mocks.persist.mockResolvedValue([saved]);
    mocks.getSession.mockResolvedValue({ id: 99, status: "active", context: {} });
    mocks.handoff.mockResolvedValue({ outcome: "ready", operation: { ...saved, status: "handed_off" } });
    mocks.loadHandoff.mockResolvedValue({ outcome: "ready", operation: { ...saved, status: "handed_off" } });
  });
  const propose = () => request(app).post("/coach/operations").send({
    originChannel: "customer_account", context: { accountId: 1 }, operation,
  });
  it("returns the existing operation's session after a retry, not an empty newly opened session", async () => {
    const result = await propose().expect(201);
    expect(result.body.sessionId).toBe(22);
    expect(mocks.access).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }),
      expect.objectContaining({ creationDraftId: operation.creationDraftId }));
    expect(mocks.persist).toHaveBeenCalledOnce();
  });
  it("rejects a historical draft before persisting it when authorization or revision has changed", async () => {
    mocks.access.mockResolvedValue({ status: 409, message: "Borrador cancelado" });
    await propose().expect(409);
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it.each(["handed_off", "completed", "cancelled", "rejected"])("does not reopen an existing %s operation", async (status) => {
    mocks.persist.mockResolvedValue([{ ...saved, status }]);
    await propose().expect(409);
  });
  it("rejects an old persisted revision instead of presenting it as the current proposal", async () => {
    mocks.persist.mockResolvedValue([{ ...saved, pendingOperation: { ...operation, creationRevision: 2 } }]);
    await propose().expect(409);
  });
  it("rechecks creation access before generating a handoff", async () => {
    mocks.access.mockResolvedValue({ status: 403, message: "Permiso revocado" });
    await request(app).post("/coach/operations/31/handoff").expect(403);
    expect(mocks.handoff).not.toHaveBeenCalled();
  });
  it("opens the same module token without claiming a CRM write", async () => {
    const result = await request(app).post("/coach/operations/31/handoff").expect(200);
    expect(result.body.handoff.url).toBe("/contacts?coachDraft=fixture-token");
    expect(mocks.access).toHaveBeenCalledOnce();
  });
  it("rechecks the draft when the destination module loads it", async () => {
    mocks.access.mockResolvedValue({ status: 409, message: "Borrador sustituido" });
    await request(app).get("/coach/handoffs/fixture-token?module=contacts").expect(409);
    expect(mocks.access).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), operation);
  });
});
