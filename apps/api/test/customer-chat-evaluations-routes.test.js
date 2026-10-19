import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  permission: vi.fn(), catalog: vi.fn(), preflight: vi.fn(), create: vi.fn(), list: vi.fn(), get: vi.fn(),
  case: vi.fn(), cancel: vi.fn(), review: vi.fn(), export: vi.fn(), queue: vi.fn(), action: vi.fn(), actions: vi.fn(),
}));
vi.mock("../src/customer-chat-evaluations/service.js", () => ({
  requireEvaluationPermission: mocks.permission, preflightEvaluation: mocks.preflight, createEvaluation: mocks.create,
  listEvaluations: mocks.list, getEvaluation: mocks.get, getEvaluationCase: mocks.case,
  cancelEvaluation: mocks.cancel, reviewEvaluationCase: mocks.review, exportEvaluation: mocks.export,
}));
vi.mock("../src/customer-chat-evaluations/catalog.js", () => ({ getEvaluationCatalog: mocks.catalog }));
vi.mock("../src/customer-chat-evaluations/async.js", () => ({ queueEvaluationProcessing: mocks.queue }));
vi.mock("../src/customer-chat-evaluations/actions.js", () => ({
  confirmEvaluationAction: mocks.action, readEvaluationActions: mocks.actions,
}));
import router from "../src/customer-chat-evaluations/routes.js";
const id = "44a6bf85-cd5a-431e-9697-fd0b2da5e9f6";
const app = express(); app.use(express.json());
const user = { id: 7, permissionSet: new Set() };
app.use((req, _res, next) => { req.user = user; next(); });
app.use("/evaluations", router);
app.use((error, _req, res, _next) => res.status(500).json({ message: error.message }));
describe("Customer chat evaluation API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.create.mockResolvedValue({ id, reused: false }); mocks.catalog.mockResolvedValue({ cases: [] });
    for (const key of ["preflight", "list", "get", "case", "cancel", "review", "export", "action", "actions"]) mocks[key].mockResolvedValue({});
  });
  it("requires permission on every endpoint", async () => {
    mocks.permission.mockImplementation(() => { throw Object.assign(new Error("No autorizado"), { status: 403 }); });
    await request(app).get("/evaluations/catalog").expect(403);
    await request(app).post("/evaluations/runs").send({}).expect(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("launches exactly one persistent worker request", async () => {
    await request(app).post("/evaluations/runs").send({ acknowledgePaidCalls: true }).expect(202);
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith(user, { acknowledgePaidCalls: true });
    expect(mocks.queue).toHaveBeenCalledTimes(1);
  });
  it("returns reused launches without claiming another run", async () => {
    mocks.create.mockResolvedValue({ id, reused: true });
    expect((await request(app).post("/evaluations/runs").send({}).expect(200)).body.reused).toBe(true);
  });
  it("verifies the environment without starting a worker", async () => {
    await request(app).post("/evaluations/preflight").send({}).expect(200);
    expect(mocks.preflight).toHaveBeenCalledExactlyOnceWith(user); expect(mocks.queue).not.toHaveBeenCalled();
  });
  it("validates IDs and page ranges before calling services", async () => {
    await request(app).get("/evaluations/runs/not-uuid").expect(400);
    await request(app).get("/evaluations/runs?page=-1").expect(400);
    await request(app).get(`/evaluations/runs/${id}/cases/nope`).expect(400);
    expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.case).not.toHaveBeenCalled();
  });
  it("paginates lists and case results", async () => {
    await request(app).get("/evaluations/runs?page=2").expect(200);
    await request(app).get(`/evaluations/runs/${id}?page=3`).expect(200);
    expect(mocks.list).toHaveBeenCalledWith(user, 2); expect(mocks.get).toHaveBeenCalledWith(user, id, 3);
  });
  it("exports JSON through an owned service with a safe attachment name", async () => {
    const result = await request(app).get(`/evaluations/runs/${id}/export`).expect(200);
    expect(result.headers["content-disposition"]).toContain(`evaluation-${id}.json`);
    expect(mocks.export).toHaveBeenCalledWith(user, id);
  });
  it("routes cancellation and review independently of starting a run", async () => {
    await request(app).post(`/evaluations/runs/${id}/cancel`).send({}).expect(200);
    await request(app).post(`/evaluations/runs/${id}/cases/1/review`).send({ decision: "rejected", note: "Incorrecto" }).expect(200);
    expect(mocks.cancel).toHaveBeenCalledWith(user, id);
    expect(mocks.review).toHaveBeenCalledWith(user, id, 1, { decision: "rejected", note: "Incorrecto" });
    expect(mocks.queue).not.toHaveBeenCalled();
  });
  it("separates explicit business confirmation from status reads", async () => {
    await request(app).post(`/evaluations/runs/${id}/cases/1/actions`).send({ accountId: 22 }).expect(200);
    await request(app).get(`/evaluations/runs/${id}/cases/1/actions`).expect(200);
    expect(mocks.action).toHaveBeenCalledTimes(1); expect(mocks.actions).toHaveBeenCalledTimes(1);
  });
  it.each([400, 403, 404, 409, 422, 502])("surfaces service error %s explicitly", async (status) => {
    mocks.create.mockRejectedValue(Object.assign(new Error("No se ejecutó la prueba"), { status }));
    const response = await request(app).post("/evaluations/runs").send({}).expect(status);
    expect(response.body.message).toBe("No se ejecutó la prueba");
    expect(mocks.queue).not.toHaveBeenCalled();
  });
});
