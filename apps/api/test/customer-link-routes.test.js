import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), access: vi.fn(), getOperation: vi.fn(), persist: vi.fn(),
  getSession: vi.fn(), handoff: vi.fn(), loadHandoff: vi.fn(), complete: vi.fn(), save: vi.fn() }));
vi.mock("../src/db.js", () => ({ query: mocks.query, withTransaction: vi.fn() }));
vi.mock("../src/coach/customer-link-access.js", () => ({ checkCustomerLinkAccess: mocks.access }));
vi.mock("../src/coach/customer-link-save.js", () => ({ saveCustomerLinkHandoff: mocks.save }));
vi.mock("../src/coach/service.js", async (original) => ({
  ...(await original()), getCoachOperation: mocks.getOperation, persistCoachOperations: mocks.persist,
  getOrCreateCoachSession: mocks.getSession, createCoachHandoff: mocks.handoff, getCoachHandoff: mocks.loadHandoff,
  completeCoachHandoff: mocks.complete,
}));
import router from "../src/routes.mi-agent.js";
import opportunitiesRouter from "../src/routes.opportunities.js";
const operation = { kind: "link_contact_to_opportunity", sourceChannel: "customer_account", title: "Sustituir contacto",
  accountId: 1, opportunityId: 3, contactId: 2, payload: { accountId: 1, contactId: 2 },
  linkDraftId: "77769f2d-6399-4e7e-9d4e-0601efc57f50", linkRevision: 1, currentContactId: 6,
  linkSummary: { accountName: "Cuenta", opportunityName: "Proyecto", contactName: "Elena", currentContactName: "Anterior", effect: "replace" },
  requiresConfirmation: true, evidence: [], missingFields: [] };
const saved = { id: 31, sessionId: 22, sourceChannel: "customer_account", status: "ready", pendingOperation: operation,
  targetModule: "opportunities", targetRoute: "/opportunities", version: 1,
  handoffToken: "44a6bf85-cd5a-431e-9697-fd0b2da5e9f6", handoffExpiresAt: "2029-01-01", identifiedEntities: {} };
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { id: 7, permissionSet: new Set(["mi_coach.access", "mi_coach.execute", "inteligencia_comercial.access",
    "cuentas.read", "oportunidades.read", "oportunidades.update", "contactos.read"]) };
  next();
});
app.use("/opportunities", opportunitiesRouter);
app.use(router);
app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: error.message }));
describe("A04 official proposal, transfer and module endpoints", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.query.mockResolvedValue([{ id: 1 }]);
    mocks.access.mockResolvedValue(null);
    mocks.getOperation.mockResolvedValue(saved);
    mocks.persist.mockResolvedValue([saved]);
    mocks.getSession.mockResolvedValue({ id: 99, status: "active", context: {} });
    mocks.handoff.mockResolvedValue({ outcome: "ready", operation: { ...saved, status: "handed_off" } });
    mocks.loadHandoff.mockResolvedValue({ outcome: "ready", operation: { ...saved, status: "handed_off" } });
    mocks.save.mockResolvedValue({ ...saved, status: "completed" });
  });
  const propose = (patch = {}) => request(app).post("/coach/operations").send({
    originChannel: "customer_account", context: { accountId: 1 }, operation: { ...operation, ...patch },
  });
  it("returns the original session after a retry and preserves versioned relationship identity", async () => {
    const result = await propose().expect(201);
    expect(result.body.sessionId).toBe(22);
    expect(mocks.access).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), expect.objectContaining(operation));
  });
  it.each([403, 404, 409, 422])("rejects access/eligibility failure %s before persistence", async (status) => {
    mocks.access.mockResolvedValue({ status, message: "Vínculo no vigente" });
    await propose().expect(status);
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it.each(["completed", "cancelled", "rejected"])("does not reopen %s", async (status) => {
    mocks.persist.mockResolvedValue([{ ...saved, status }]);
    await propose().expect(409);
  });
  it("rejects old historical revisions instead of showing another persisted value as current", async () => {
    mocks.persist.mockResolvedValue([{ ...saved, pendingOperation: { ...operation, linkRevision: 2 } }]);
    await propose().expect(409);
  });
  it("rejects cross-account endpoints", async () => {
    mocks.query.mockImplementation(async (text) => text.includes("INNER JOIN contacts c") ? [] : [{ id: 1 }]);
    await propose().expect(404);
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it("revalidates draft before generating and loading a module transfer", async () => {
    mocks.access.mockResolvedValue({ status: 409, message: "Borrador sustituido" });
    await request(app).post("/coach/operations/31/handoff").expect(409);
    expect(mocks.handoff).not.toHaveBeenCalled();
    await request(app).get(`/coach/handoffs/${saved.handoffToken}?module=opportunities`).expect(409);
  });
  it("loads the review with current relationship and explicit effect", async () => {
    const result = await request(app).get(`/coach/handoffs/${saved.handoffToken}?module=opportunities`).expect(200);
    expect(result.body.handoff.payload.linkSummary.effect).toBe("replace");
    expect(result.body.handoff.version).toBe(1);
  });
  it("cannot use generic handoff completion to assert a relationship save", async () => {
    mocks.complete.mockResolvedValue({ outcome: "save_required", operation: saved });
    await request(app).post(`/coach/handoffs/${saved.handoffToken}/complete`).send({ module: "opportunities", entityType: "opportunity", entityId: 3 }).expect(409);
  });
  it("saves through the Opportunities module with only token, version and fixed opportunity", async () => {
    const result = await request(app).post("/opportunities/3/coach-contact").send({ token: saved.handoffToken, version: 1 }).expect(200);
    expect(result.body.operation.status).toBe("completed");
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ token: saved.handoffToken, version: 1, opportunityId: 3 }));
  });
  it.each([{ token: "invalid", version: 1 }, { token: saved.handoffToken, version: 0 },
    { token: saved.handoffToken, version: 1, contactId: 99 }])("rejects invalid save input or external field overrides %j", async (body) => {
    await request(app).post("/opportunities/3/coach-contact").send(body).expect(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each([403, 404, 409, 422])("surfaces save conflict %s without success-shaped output", async (status) => {
    mocks.save.mockRejectedValue(Object.assign(new Error("Vuelve a revisar"), { code: "COACH_LINK_CONFLICT", status }));
    const result = await request(app).post("/opportunities/3/coach-contact").send({ token: saved.handoffToken, version: 1 }).expect(status);
    expect(result.body.operation).toBeUndefined();
  });
});
