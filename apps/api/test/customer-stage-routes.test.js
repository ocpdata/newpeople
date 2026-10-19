import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), access: vi.fn(), getOperation: vi.fn(), persist: vi.fn(),
  getSession: vi.fn(), start: vi.fn(), read: vi.fn(), handoff: vi.fn(), load: vi.fn() }));
vi.mock("../src/db.js", () => ({ query: mocks.query, withTransaction: vi.fn() }));
vi.mock("../src/coach/customer-stage-access.js", () => ({ checkCustomerStageAccess: mocks.access }));
vi.mock("../src/coach/customer-stage-validation.js", () => ({
  startCustomerStageValidation: mocks.start, readCustomerStageValidation: mocks.read,
}));
vi.mock("../src/coach/service.js", async (original) => ({
  ...(await original()), getCoachOperation: mocks.getOperation, persistCoachOperations: mocks.persist,
  getOrCreateCoachSession: mocks.getSession, createCoachHandoff: mocks.handoff, getCoachHandoff: mocks.load,
}));
import router from "../src/routes.mi-agent.js";
import opportunityRouter from "../src/routes.opportunities.js";
const token = "44a6bf85-cd5a-431e-9697-fd0b2da5e9f6";
const operation = { kind: "validate_stage", sourceChannel: "customer_account", title: "Validar Alfa", targetModule: "opportunities",
  accountId: 1, opportunityId: 3, payload: { accountId: 1, opportunityId: 3 },
  stageDraftId: "77769f2d-6399-4e7e-9d4e-0601efc57f50", stageRevision: 1, stageObservedVersion: "observed",
  stageSummary: { accountName: "Cuenta", opportunityName: "Alfa", currentStageId: 1, currentStageName: "Inicial", targetStageId: 2, targetStageName: "Negociación" },
  evidence: [], missingFields: [], requiresConfirmation: true };
const saved = { id: 31, sessionId: 22, sourceChannel: "customer_account", kind: "validate_stage", status: "ready",
  pendingOperation: operation, targetModule: "opportunities", version: 1, handoffToken: token, identifiedEntities: {} };
const app = express(); app.use(express.json());
app.use((req, _res, next) => {
  req.user = { id: 7, permissionSet: new Set(["mi_coach.access", "mi_coach.execute", "inteligencia_comercial.access",
    "cuentas.read", "oportunidades.read", "oportunidades.update"]) }; next();
});
app.use("/opportunities", opportunityRouter); app.use(router);
app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: error.message }));
describe("A08 official proposal/handoff/validation wrapper routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.query.mockResolvedValue([{ id: 1 }]); mocks.access.mockResolvedValue(null);
    mocks.persist.mockResolvedValue([saved]); mocks.getOperation.mockResolvedValue(saved);
    mocks.getSession.mockResolvedValue({ id: 99, status: "active", context: {} });
    mocks.handoff.mockResolvedValue({ outcome: "ready", operation: { ...saved, status: "handed_off" } });
    mocks.load.mockResolvedValue({ outcome: "ready", operation: { ...saved, status: "handed_off" } });
    mocks.start.mockResolvedValue({ job: { id: "existing-job", status: "pending" } });
    mocks.read.mockResolvedValue({ operation: saved, validation: null });
  });
  const propose = (patch = {}) => request(app).post("/coach/operations").send({
    originChannel: "customer_account", context: { accountId: 1 }, operation: { ...operation, ...patch },
  });
  it("prepares and loads a handoff without running the validator", async () => {
    expect((await propose().expect(201)).body.sessionId).toBe(22);
    await request(app).post("/coach/operations/31/handoff").expect(200);
    expect((await request(app).get(`/coach/handoffs/${token}?module=opportunities`).expect(200)).body.handoff.kind).toBe("validate_stage");
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it.each([403, 404, 409, 422])("rejects invalid proposal/handoff %s", async (status) => {
    mocks.access.mockResolvedValue({ status, message: "Solicitud no vigente" });
    await propose().expect(status);
    await request(app).post("/coach/operations/31/handoff").expect(status);
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it("rejects a different fixed account and historical revision", async () => {
    await propose({ accountId: 99, payload: { accountId: 99, opportunityId: 3 } }).expect(403);
    mocks.persist.mockResolvedValue([{ ...saved, pendingOperation: { ...operation, stageRevision: 2 } }]);
    await propose().expect(409);
  });
  it.each(["completed", "cancelled", "rejected"])("does not reopen %s", async (status) => {
    mocks.persist.mockResolvedValue([{ ...saved, status }]);
    await propose().expect(409);
  });
  it("does not turn a linked validation into another proposal", async () => {
    mocks.persist.mockResolvedValue([{ ...saved, status: "handed_off", result: { validationJobId: "existing" } }]);
    await propose().expect(409);
  });
  it("starts only through an explicit module POST with token/version, without external stage overrides", async () => {
    await request(app).post("/opportunities/3/coach-stage-validation").send({ token, version: 1 }).expect(202);
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({ token, version: 1, opportunityId: 3 }));
    for (const body of [{ token: "invalid", version: 1 }, { token, version: 0 }, { token, version: 1, targetStageId: 99 }]) {
      await request(app).post("/opportunities/3/coach-stage-validation").send(body).expect(400);
    }
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });
  it("reads linked results without starting a new validator", async () => {
    await request(app).get(`/opportunities/3/coach-stage-validation/${token}`).expect(200);
    expect(mocks.read).toHaveBeenCalledWith(expect.objectContaining({ token, opportunityId: 3 }));
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("preserves prerequisite errors from the existing validator", async () => {
    mocks.start.mockRejectedValue(Object.assign(new Error("Faltan respuestas"), {
      status: 400, body: { message: "Faltan respuestas", validation: { decision: "not_ready_to_advance" } },
    }));
    const result = await request(app).post("/opportunities/3/coach-stage-validation").send({ token, version: 1 }).expect(400);
    expect(result.body.validation.decision).toBe("not_ready_to_advance");
  });
  it.each([403, 404, 409, 422])("surfaces wrapper conflict %s", async (status) => {
    const error = Object.assign(new Error("Revisa nuevamente"), { status, code: "COACH_STAGE_CONFLICT" });
    mocks.start.mockRejectedValue(error); mocks.read.mockRejectedValue(error);
    await request(app).post("/opportunities/3/coach-stage-validation").send({ token, version: 1 }).expect(status);
    await request(app).get(`/opportunities/3/coach-stage-validation/${token}`).expect(status);
  });
});
