import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(), noteAccess: vi.fn(), session: vi.fn(), persist: vi.fn(),
}));
vi.mock("../src/db.js", () => ({
  query: mocks.query, pool: {}, withTransaction: vi.fn(),
}));
vi.mock("../src/coach/customer-note-access.js", () => ({
  checkCustomerNoteAccess: mocks.noteAccess,
}));
vi.mock("../src/coach/service.js", async (importOriginal) => ({
  ...await importOriginal(),
  getOrCreateCoachSession: mocks.session,
  persistCoachOperations: mocks.persist,
}));
import router from "../src/routes.mi-agent.js";

const user = { id: 7, permissionSet: new Set([
  "mi_coach.execute", "mi_coach.access", "inteligencia_comercial.access",
  "oportunidades.read", "oportunidades.update", "cuentas.read",
]) };
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = user; next(); });
app.use(router);
app.use((error, _req, res, _next) => res.status(500).json({ message: error.message }));
const operation = {
  kind: "opportunity_note", sourceChannel: "customer_account",
  title: "Registrar nota", accountId: 160, opportunityId: 300,
  noteText: "El cliente solicita revisar el alcance.",
  sourceType: "chat_report", attribution: "seller", certainty: "reported",
  requiresConfirmation: true,
};
const payload = (overrides = {}) => ({
  originChannel: "customer_account", sessionId: null,
  context: { accountId: 160, opportunityId: 300 },
  operation: { ...operation, ...overrides },
});
describe("Customer note proposal route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.noteAccess.mockResolvedValue(null);
    mocks.query.mockResolvedValue([{ id: 160 }]);
    mocks.session.mockResolvedValue({ id: 923, status: "active" });
    mocks.persist.mockResolvedValue([{ id: 903, sessionId: 923, status: "ready",
      version: 1, pendingOperation: operation }]);
  });
  it("persists an authorized note proposal for review without writing the note", async () => {
    const response = await request(app).post("/coach/operations").send(payload()).expect(201);
    expect(response.body.operation.status).toBe("ready");
    expect(mocks.persist).toHaveBeenCalledWith(expect.objectContaining({
      operations: [expect.objectContaining({ kind: "opportunity_note", sourceChannel: "customer_account" })],
    }));
    expect(mocks.query).toHaveBeenCalledWith(
      "SELECT id FROM opportunities WHERE id = ? AND account_id = ? LIMIT 1",
      [300, 160],
    );
    expect(mocks.query.mock.calls.every(([sql]) => sql.trim().startsWith("SELECT"))).toBe(true);
  });
  it("rejects a note targeting another account", async () => {
    await request(app).post("/coach/operations").send(payload({ accountId: 999 })).expect(403);
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it("rejects an opportunity outside the fixed account", async () => {
    mocks.query.mockResolvedValueOnce([{ id: 160 }]).mockResolvedValueOnce([]);
    await request(app).post("/coach/operations").send(payload()).expect(404);
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it("preserves note policy and permission errors", async () => {
    mocks.noteAccess.mockResolvedValue({ status: 403, message: "No tienes permisos para guardar una nota" });
    const response = await request(app).post("/coach/operations").send(payload()).expect(403);
    expect(response.body.message).toContain("No tienes permisos");
    expect(mocks.persist).not.toHaveBeenCalled();
  });
});
