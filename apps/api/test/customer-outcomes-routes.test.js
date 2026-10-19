import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), access: vi.fn(), getOperation: vi.fn(), persist: vi.fn(),
  getSession: vi.fn(), review: vi.fn(), execute: vi.fn() }));
vi.mock("../src/db.js", () => ({ query: mocks.query, withTransaction: vi.fn() }));
vi.mock("../src/coach/customer-outcome-access.js", () => ({ checkCustomerOutcomeAccess: mocks.access }));
vi.mock("../src/coach/service.js", async (original) => ({
  ...(await original()), getCoachOperation: mocks.getOperation, persistCoachOperations: mocks.persist,
  getOrCreateCoachSession: mocks.getSession,
}));
vi.mock("../src/coach/controlled-operation-service.js", async (original) => ({
  ...(await original()), reviewControlledCoachOperation: mocks.review, executeControlledCoachOperation: mocks.execute,
}));
import router from "../src/routes.mi-agent.js";
import { CoachOperationError } from "../src/coach/controlled-operation-service.js";
const operation = { kind: "lead_call_outcome", sourceChannel: "customer_account", title: "Registrar llamada",
  accountId: 1, interactionId: 105, outcomeDraftId: "77769f2d-6399-4e7e-9d4e-0601efc57f50", outcomeRevision: 1,
  outcomeObservedVersion: "observed", outcomeRule: "rule",
  substatusCode: "wrong_contact_identified", reasonCode: "wrong_contact", requiredActionCode: "contact_referred_person",
  comment: "Refirió a Ana", nextActionDueAt: null, referredContactName: "Ana Ficticia", referredAreaName: "",
  outcomeSummary: { accountName: "Cuenta", leadLabel: "Lead 105", currentStatus: "Creado", currentResult: "(sin dato)",
    currentReason: "(sin dato)", currentAction: "(sin dato)", currentComment: "", currentDueDate: null,
    proposed: { result: "Contacto incorrecto", reason: "Contacto equivocado", action: "Contactar persona referida", status: "Creado" },
    timeZone: "America/Mexico_City" },
  requiresConfirmation: true, evidence: [], missingFields: [] };
const saved = { id: 31, sessionId: 22, sourceChannel: "customer_account", kind: "lead_call_outcome", status: "ready",
  pendingOperation: operation, targetModule: "interactions", version: 1, identifiedEntities: {} };
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { id: 7, permissionSet: new Set(["mi_coach.access", "mi_coach.execute", "inteligencia_comercial.access",
    "cuentas.read", "interacciones.read", "interacciones.update"]) }; next();
});
app.use(router);
app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: error.message }));
describe("A07 official proposal/review/execute endpoints", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.query.mockResolvedValue([{ id: 1 }]);
    mocks.access.mockResolvedValue(null);
    mocks.getOperation.mockResolvedValue(saved);
    mocks.persist.mockResolvedValue([saved]);
    mocks.getSession.mockResolvedValue({ id: 99, status: "active", context: {} });
    mocks.review.mockResolvedValue({ ...saved, version: 2, reviewedAt: "2030-01-01" });
    mocks.execute.mockResolvedValue({ ...saved, version: 3, status: "completed" });
  });
  const propose = (patch = {}) => request(app).post("/coach/operations").send({
    originChannel: "customer_account", context: { accountId: 1 }, operation: { ...operation, ...patch },
  });
  it("retains conditional names and the deduplicated original session", async () => {
    const result = await propose().expect(201);
    expect(result.body.sessionId).toBe(22);
    expect(mocks.access).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), expect.objectContaining(operation));
    expect(mocks.persist.mock.calls[0][0].operations[0].referredContactName).toBe("Ana Ficticia");
  });
  it.each([403, 404, 409, 422])("rejects invalid proposal %s before persistence", async (status) => {
    mocks.access.mockResolvedValue({ status, message: "Borrador no vigente" });
    await propose().expect(status);
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it.each(["completed", "cancelled", "rejected"])("does not restore a %s historical draft", async (status) => {
    mocks.persist.mockResolvedValue([{ ...saved, status }]);
    await propose().expect(409);
  });
  it("rejects superseded revisions and a different fixed account", async () => {
    mocks.persist.mockResolvedValue([{ ...saved, pendingOperation: { ...operation, outcomeRevision: 2 } }]);
    await propose().expect(409);
    await propose({ accountId: 99 }).expect(403);
  });
  it("rejects unknown fields and excessive referred name length", async () => {
    await propose({ invented: true }).expect(400);
    await propose({ referredContactName: "x".repeat(256) }).expect(400);
  });
  it("reviews through the existing controlled service without executing", async () => {
    const result = await request(app).post("/coach/operations/31/review").send({ version: 1 }).expect(200);
    expect(result.body.operation.reviewedAt).toBeTruthy();
    expect(mocks.review).toHaveBeenCalledWith(expect.objectContaining({ operationId: 31, version: 1 }));
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("executes only through the existing controlled service and shared validator", async () => {
    await request(app).post("/coach/operations/31/execute").send({ version: 2, idempotencyKey: "test-key" }).expect(200);
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ operationId: 31, version: 2,
      idempotencyKey: "test-key", validateLeadOutcome: expect.any(Function) }));
  });
  it.each([403, 404, 409, 422])("surfaces controlled review/execute error %s", async (status) => {
    mocks.review.mockRejectedValue(new CoachOperationError(status, "COACH_OUTCOME_STALE", "Revisa nuevamente"));
    await request(app).post("/coach/operations/31/review").send({ version: 1 }).expect(status);
    mocks.execute.mockRejectedValue(new CoachOperationError(status, "COACH_OUTCOME_STALE", "Revisa nuevamente"));
    await request(app).post("/coach/operations/31/execute").send({ version: 1, idempotencyKey: "test-key" }).expect(status);
  });
});
