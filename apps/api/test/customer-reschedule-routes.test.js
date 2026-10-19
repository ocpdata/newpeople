import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), access: vi.fn(), getOperation: vi.fn(), persist: vi.fn(),
  getSession: vi.fn(), handoff: vi.fn(), loadHandoff: vi.fn(), complete: vi.fn(), save: vi.fn() }));
vi.mock("../src/db.js", () => ({ query: mocks.query, withTransaction: vi.fn() }));
vi.mock("../src/coach/customer-reschedule-access.js", () => ({ checkCustomerRescheduleAccess: mocks.access }));
vi.mock("../src/coach/customer-reschedule-save.js", () => ({ saveCustomerReschedule: mocks.save }));
vi.mock("../src/coach/service.js", async (original) => ({
  ...(await original()), getCoachOperation: mocks.getOperation, persistCoachOperations: mocks.persist,
  getOrCreateCoachSession: mocks.getSession, createCoachHandoff: mocks.handoff, getCoachHandoff: mocks.loadHandoff,
  completeCoachHandoff: mocks.complete,
}));
import router from "../src/routes.mi-agent.js";
import opportunitiesRouter from "../src/routes.opportunities.js";
const operation = { kind: "reschedule_activity", sourceChannel: "customer_account", title: "Reprogramar llamada",
  accountId: 1, opportunityId: 3, activityId: 75, payload: { accountId: 1, activityId: 75 },
  rescheduleDraftId: "77769f2d-6399-4e7e-9d4e-0601efc57f50", rescheduleRevision: 1, observedVersion: "[3,75]",
  proposedAt: "2030-10-23T16:00:00.000Z", proposedDueDate: "2030-10-23",
  scheduleSummary: { accountName: "Cuenta", opportunityName: "Proyecto", activityTitle: "Llamada",
    before: "2030-10-20T10:00:00", after: "2030-10-23T10:00:00", timeZone: "America/Mexico_City" },
  requiresConfirmation: true, evidence: [], missingFields: [] };
const saved = { id: 31, sessionId: 22, sourceChannel: "customer_account", kind: "reschedule_activity", status: "ready",
  pendingOperation: operation, targetModule: "calendar", targetRoute: "/calendar", version: 1,
  handoffToken: "44a6bf85-cd5a-431e-9697-fd0b2da5e9f6", handoffExpiresAt: "2031-01-01", identifiedEntities: {} };
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { id: 7, permissionSet: new Set(["mi_coach.access", "mi_coach.execute", "inteligencia_comercial.access",
    "cuentas.read", "oportunidades.read", "oportunidades.update", "calendario_comercial.read", "calendario_comercial.update", "desarrollo_comercial.update"]) };
  next();
});
app.use("/opportunities", opportunitiesRouter);
app.use(router);
app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: error.message }));
describe("A06 official proposal, handoff and calendar save endpoints", () => {
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
  it("persists a dedicated reschedule and retains its original session on retry", async () => {
    const result = await propose().expect(201);
    expect(result.body.sessionId).toBe(22);
    expect(mocks.access).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), expect.objectContaining(operation));
  });
  it.each([403, 404, 409, 422])("blocks invalid proposal %s before persistence", async (status) => {
    mocks.access.mockResolvedValue({ status, message: "Actividad no vigente" });
    await propose().expect(status);
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it.each(["completed", "cancelled", "rejected"])("does not reopen %s", async (status) => {
    mocks.persist.mockResolvedValue([{ ...saved, status }]);
    await propose().expect(409);
  });
  it("rejects historical revisions and mismatched fixed account", async () => {
    mocks.persist.mockResolvedValue([{ ...saved, pendingOperation: { ...operation, rescheduleRevision: 2 } }]);
    await propose().expect(409);
    await propose({ accountId: 99, payload: { accountId: 99, activityId: 75 } }).expect(403);
  });
  it("revalidates before generating and loading the calendar handoff", async () => {
    mocks.access.mockResolvedValue({ status: 409, message: "Borrador sustituido" });
    await request(app).post("/coach/operations/31/handoff").expect(409);
    expect(mocks.handoff).not.toHaveBeenCalled();
    await request(app).get(`/coach/handoffs/${saved.handoffToken}?module=calendar`).expect(409);
  });
  it("loads the dedicated read-only scheduling review", async () => {
    const result = await request(app).get(`/coach/handoffs/${saved.handoffToken}?module=calendar`).expect(200);
    expect(result.body.handoff.payload.activityId).toBe(75);
    expect(result.body.handoff.payload.scheduleSummary.after).toBe("2030-10-23T10:00:00");
  });
  it("generic completion cannot substitute for a transactional domain save", async () => {
    mocks.complete.mockResolvedValue({ outcome: "save_required", operation: saved });
    await request(app).post(`/coach/handoffs/${saved.handoffToken}/complete`).send({ module: "calendar", entityType: "opportunity", entityId: 3 }).expect(409);
  });
  it("saves only a token and version through the module", async () => {
    await request(app).post("/opportunities/3/coach-reschedule").send({ token: saved.handoffToken, version: 1 }).expect(200);
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ opportunityId: 3, token: saved.handoffToken, version: 1 }));
  });
  it.each([{ token: "invalid", version: 1 }, { token: saved.handoffToken, version: 0 },
    { token: saved.handoffToken, version: 1, activityId: 99 },
    { token: saved.handoffToken, version: 1, proposedAt: "2035-01-01T00:00:00Z" }])("rejects invalid input or external overrides %j", async (body) => {
    await request(app).post("/opportunities/3/coach-reschedule").send(body).expect(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each([403, 404, 409, 422])("surfaces save error %s without false success", async (status) => {
    mocks.save.mockRejectedValue(Object.assign(new Error("Revisa otra vez"), { status, code: "COACH_RESCHEDULE_CONFLICT" }));
    const result = await request(app).post("/opportunities/3/coach-reschedule").send({ token: saved.handoffToken, version: 1 }).expect(status);
    expect(result.body.operation).toBeUndefined();
  });
});
