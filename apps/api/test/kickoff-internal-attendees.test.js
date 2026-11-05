import express from "express";
import mysql from "mysql2/promise";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db.js", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("../src/audit.js", () => ({ logAuditEvent: vi.fn() }));
import { config } from "../src/config.js";
import { query } from "../src/db.js";
import router from "../src/routes.quotations.js";
import { listKickoffInternalAttendees, validateKickoffInternalAttendees } from "../src/kickoff-internal-attendees.js";

let connection;
const path = "/api/quotations/1/processing/kickoff-internal/invitations";
const body = {
  inviteSubject: "Kick off", inviteBodyTemplate: "Convocatoria", meetingDate: "2026-11-06",
  meetingMode: "virtual", internalAttendeesUserIds: [1, 4], statusCode: "draft",
};
function app(permissions = ["aceptar_pedido.procesamiento.convocar", "aceptar_pedido.procesamiento.update"]) {
  const instance = express();
  instance.use(express.json(), (req, _res, next) => {
    req.user = { id: 1, permissionSet: new Set(permissions) };
    next();
  });
  instance.use("/api", router);
  instance.use((error, _req, res, _next) => {
    res.status(error.status || 500).json({ message: error.message });
  });
  return instance;
}
beforeAll(async () => {
  connection = await mysql.createConnection(config.db);
  for (const [table, columns] of Object.entries({
    users: "id INT, full_name VARCHAR(100), email VARCHAR(100), status VARCHAR(30)",
    roles: "id INT, name VARCHAR(100)",
    user_roles: "user_id INT, role_id INT",
    opportunities: "id INT, seller_user_id INT",
    quotations: "id INT, opportunity_id INT",
  })) {
    await connection.query(`CREATE TEMPORARY TABLE ${table} (${columns})`);
  }
  await connection.query(`INSERT INTO users VALUES
    (1, 'Asignado', 'assigned@example.test', 'active'),
    (2, 'Otro vendedor', 'other@example.test', 'active'),
    (3, 'Multirrol', 'multi@example.test', 'active'),
    (4, 'Operaciones', 'ops@example.test', 'active'),
    (5, 'Sin rol', 'none@example.test', NULL),
    (6, 'Inactivo', 'inactive@example.test', 'inactive')`);
  await connection.query(`INSERT INTO roles VALUES
    (1, ' VENDEDOR '), (2, 'Operaciones'),
    (3, 'Vendedor con aprobación IA'), (4, 'Vendedor sin aprobación IA')`);
  await connection.query("INSERT INTO user_roles VALUES (1, 1), (2, 3), (3, 4), (3, 2), (4, 2)");
  await connection.query("INSERT INTO opportunities VALUES (1, 1), (2, NULL), (3, 3), (4, 6)");
  await connection.query("INSERT INTO quotations VALUES (1, 1), (2, 2), (3, 3), (4, 4)");
});
afterAll(async () => { await connection?.end(); });
beforeEach(() => {
  vi.clearAllMocks();
  query.mockImplementation(async (sql, params) => {
    if (sql.includes("FROM users u") && sql.includes("NOT EXISTS")) {
      return (await connection.query(sql, params))[0];
    }
    if (sql.includes("WHERE qv.id = ?")) return [{
      id: 10, quotation_id: 1, latest_version_id: 10, status_code: "aceptada",
    }];
    if (sql.includes("SELECT q.id, q.opportunity_id")) return [{ id: 1, opportunity_id: 1, latest_version_id: 10 }];
    if (sql.includes("SELECT id, full_name, email") && sql.includes("FROM users")) {
      return (await connection.query("SELECT id, full_name, email FROM users WHERE status = 'active' OR status IS NULL"))[0];
    }
    return [];
  });
});

describe("Kick off internal attendee eligibility", () => {
  it("includes the assigned seller and active non-sellers, excluding other sellers even with multiple roles", async () => {
    expect((await listKickoffInternalAttendees({ quotationId: 1 })).map((user) => user.id)).toEqual([1, 4, 5]);
  });
  it("recognizes the actual seller role variants and allows the assigned AI-approved seller", async () => {
    try {
      await connection.query("UPDATE opportunities SET seller_user_id = 2 WHERE id = 1");
      expect((await listKickoffInternalAttendees({ quotationId: 1 })).map((user) => user.id)).toEqual([4, 2, 5]);
    } finally {
      await connection.query("UPDATE opportunities SET seller_user_id = 1 WHERE id = 1");
    }
  });
  it("does not offer any sellers without an assigned seller", async () => {
    expect((await listKickoffInternalAttendees({ quotationId: 2 })).map((user) => user.id)).toEqual([4, 5]);
  });
  it("allows a multi-role seller only when assigned and still excludes inactive assigned users", async () => {
    expect((await listKickoffInternalAttendees({ quotationId: 3 })).map((user) => user.id)).toEqual([3, 4, 5]);
    expect((await listKickoffInternalAttendees({ quotationId: 4 })).map((user) => user.id)).toEqual([4, 5]);
  });
  it.each([2, 3, 6, 999])("rejects unavailable attendee %s", async (id) => {
    await expect(validateKickoffInternalAttendees({ quotationId: 1, userIds: [id] }))
      .rejects.toMatchObject({ status: 400, invalidUserIds: [id] });
  });
  it.each(["draft", "sent"])("blocks direct %s invitations with other sellers before any writes", async (statusCode) => {
    const response = await request(app()).post(path).send({ ...body, statusCode, internalAttendeesUserIds: [2] });
    expect(response.status, JSON.stringify(response.body)).toBe(400);
    expect(response.body.message).toMatch(/vendedor asignado/);
    expect(query.mock.calls.some(([sql]) =>
      sql.includes("INSERT INTO quotation_processing_kickoff_invites") ||
      sql.includes("INSERT INTO quotation_processing_stages"))).toBe(false);
  });
  it.each(["draft", "sent"])("allows %s invitations with the assigned seller and other users", async (statusCode) => {
    const response = await request(app()).post(path).send({ ...body, statusCode });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const insert = query.mock.calls.find(([sql]) => sql.includes("INSERT INTO quotation_processing_kickoff_invites"));
    expect(JSON.parse(insert[1][10])).toEqual([1, 4]);
  });
  it("does not require selecting the assigned seller", async () => {
    expect((await request(app()).post(path).send({ ...body, internalAttendeesUserIds: [4] })).status).toBe(200);
  });
  it("does not let a direct stage update bypass attendee validation", async () => {
    const response = await request(app()).patch("/api/quotations/1/processing/stages/kickoff_internal")
      .send({ status: "in_progress", stageData: { internalAttendeesUserIds: [2] } });
    expect(response.status).toBe(400);
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO quotation_processing_stages"))).toBe(false);
  });
  it("keeps the general assignee catalog unfiltered and supplies a separate kickoff catalog", async () => {
    const response = await request(app()).get("/api/quotations/1/processing");
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.assignableUsers.map((user) => user.id)).toContain(2);
    expect(response.body.kickoffInternal.assignableUsers.map((user) => user.id)).toEqual([1, 4, 5]);
  });
  it("preserves invitation permissions", async () => {
    expect((await request(app(["aceptar_pedido.procesamiento.read"])).post(path).send(body)).status).toBe(403);
  });
});
