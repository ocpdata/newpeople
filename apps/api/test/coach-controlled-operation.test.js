import { beforeEach, describe, expect, it, vi } from "vitest";

const { withTransactionMock } = vi.hoisted(() => ({
  withTransactionMock: vi.fn(),
}));

vi.mock("../src/db.js", () => ({
  query: vi.fn(),
  withTransaction: withTransactionMock,
}));

import {
  CoachOperationError,
  executeControlledCoachOperation,
  revertControlledCoachOperation,
  reviewControlledCoachOperation,
} from "../src/coach/controlled-operation-service.js";

function operationRow(overrides = {}) {
  return {
    id: 41,
    session_id: 9,
    user_id: 7,
    source_job_id: 12,
    operation_index: 0,
    operation_kind: "account_field",
    status: "ready",
    original_intent: "Actualiza la ciudad",
    identified_entities: "{}",
    collected_fields: "{}",
    missing_fields: "[]",
    evidence: "[]",
    target_module: "accounts",
    target_route: "/accounts",
    original_operation: JSON.stringify({
      kind: "account_field",
      accountId: 20,
      field: "city",
      value: "Monterrey",
    }),
    pending_operation: JSON.stringify({
      kind: "account_field",
      accountId: 20,
      field: "city",
      value: "Monterrey",
      currentValue: "Guadalajara",
    }),
    result_payload: null,
    error_detail: null,
    cancellation_reason: null,
    execution_key: null,
    domain_audit_id: null,
    version: 3,
    handed_off_at: null,
    approved_at: null,
    reviewed_at: "2026-09-26T10:01:00.000Z",
    executing_at: null,
    completed_at: null,
    failed_at: null,
    cancelled_at: null,
    reverted_at: null,
    created_at: "2026-09-26T10:00:00.000Z",
    updated_at: "2026-09-26T10:00:00.000Z",
    ...overrides,
  };
}

function request(permissions) {
  return {
    user: {
      id: 7,
      name: "Seller",
      email: "seller@example.com",
      permissionSet: new Set(permissions),
    },
    ip: "127.0.0.1",
    headers: { "user-agent": "vitest" },
  };
}

function connectionForAccount({
  currentValue = "Guadalajara",
  operationVisible = true,
  entityVisible = true,
} = {}) {
  let row = operationRow();
  const calls = [];
  const conn = {
    query: vi.fn(async (sql, params = []) => {
      calls.push({ sql, params });
      if (
        sql.includes("FROM coach_session_operations") &&
        sql.includes("FOR UPDATE")
      ) {
        return [operationVisible ? [row] : []];
      }
      if (sql.includes("SELECT a.id FROM accounts")) {
        return [entityVisible ? [{ id: 20 }] : []];
      }
      if (sql.includes("SELECT city AS value FROM accounts")) {
        return [[{ value: currentValue }]];
      }
      if (sql.includes("INSERT INTO audit_log")) return [{ insertId: 88 }];
      if (sql.includes("SET status = 'completed'")) {
        row = {
          ...row,
          status: "completed",
          result_payload: params[0],
          domain_audit_id: params[1],
          execution_key: "request-1",
          version: 5,
        };
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("SET status = 'executing'")) {
        row = {
          ...row,
          status: "executing",
          execution_key: params[0],
          version: 4,
        };
        return [{ affectedRows: 1 }];
      }
      if (
        sql.includes(
          "SELECT * FROM coach_session_operations WHERE id = ? LIMIT 1",
        )
      ) {
        return [[row]];
      }
      return [{ affectedRows: 1 }];
    }),
  };
  return { conn, calls, getRow: () => row };
}

describe("controlled Coach operations", () => {
  beforeEach(() => {
    withTransactionMock.mockReset();
  });

  it("executes the domain update, audit, and completion in one transaction", async () => {
    const fixture = connectionForAccount();
    withTransactionMock.mockImplementation((work) => work(fixture.conn));

    const operation = await executeControlledCoachOperation({
      req: request(["mi_coach.use", "mi_coach.execute", "cuentas.update"]),
      operationId: 41,
      version: 3,
      idempotencyKey: "request-1",
      validateLeadOutcome: vi.fn(),
    });

    expect(operation.status).toBe("completed");
    expect(operation.domainAuditId).toBe(88);
    expect(
      fixture.calls.some(({ sql }) => sql.includes("UPDATE accounts SET city")),
    ).toBe(true);
    expect(
      fixture.calls.some(({ sql }) => sql.includes("INSERT INTO audit_log")),
    ).toBe(true);
    const auditCall = fixture.calls.find(({ sql }) =>
      sql.includes("INSERT INTO audit_log"),
    );
    expect(auditCall.params[4]).toBe(41);
    expect(
      fixture.calls
        .filter(({ sql }) => sql.includes("coach_operation_events"))
        .map(({ params }) => params[4]),
    ).toEqual(["approved", "execution_started", "completed"]);
    const completedEvent = fixture.calls.find(
      ({ sql, params }) =>
        sql.includes("coach_operation_events") && params[4] === "completed",
    );
    expect(completedEvent.params[11]).toBe(88);
  });

  it("requires both Coach execution and domain permissions", async () => {
    const fixture = connectionForAccount();
    withTransactionMock.mockImplementation((work) => work(fixture.conn));

    await expect(
      executeControlledCoachOperation({
        req: request(["mi_coach.use", "cuentas.update"]),
        operationId: 41,
        version: 3,
        idempotencyKey: "request-1",
        validateLeadOutcome: vi.fn(),
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: "COACH_EXECUTION_FORBIDDEN",
    });
  });

  it("does not expose an invented or cross-user operation id", async () => {
    const fixture = connectionForAccount({ operationVisible: false });
    withTransactionMock.mockImplementation((work) => work(fixture.conn));

    await expect(
      executeControlledCoachOperation({
        req: request(["mi_coach.use", "mi_coach.execute", "cuentas.update"]),
        operationId: 999,
        version: 3,
        idempotencyKey: "request-invented",
        validateLeadOutcome: vi.fn(),
      }),
    ).rejects.toMatchObject({
      status: 404,
      code: "COACH_OPERATION_NOT_FOUND",
    });
  });

  it("does not expose a target entity outside the seller scope", async () => {
    const fixture = connectionForAccount({ entityVisible: false });
    withTransactionMock.mockImplementation((work) => work(fixture.conn));

    await expect(
      executeControlledCoachOperation({
        req: request(["mi_coach.use", "mi_coach.execute", "cuentas.update"]),
        operationId: 41,
        version: 3,
        idempotencyKey: "request-cross-user",
        validateLeadOutcome: vi.fn(),
      }),
    ).rejects.toMatchObject({
      status: 404,
      code: "COACH_ENTITY_NOT_FOUND",
    });
    expect(
      fixture.calls.some(({ sql }) => sql.includes("UPDATE accounts SET city")),
    ).toBe(false);
  });

  it("rejects a concurrent domain change before writing", async () => {
    const fixture = connectionForAccount({ currentValue: "Querétaro" });
    withTransactionMock.mockImplementation((work) => work(fixture.conn));

    await expect(
      executeControlledCoachOperation({
        req: request(["mi_coach.use", "mi_coach.execute", "cuentas.update"]),
        operationId: 41,
        version: 3,
        idempotencyKey: "request-1",
        validateLeadOutcome: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(CoachOperationError);
    expect(
      fixture.calls.some(({ sql }) => sql.includes("UPDATE accounts SET city")),
    ).toBe(false);
  });

  it("reviews and persists the authoritative current value", async () => {
    let row = operationRow({
      pending_operation: JSON.stringify({
        kind: "account_field",
        accountId: 20,
        field: "city",
        value: "Monterrey",
      }),
    });
    const conn = {
      query: vi.fn(async (sql, params = []) => {
        if (
          sql.includes("FROM coach_session_operations") &&
          sql.includes("FOR UPDATE")
        )
          return [[row]];
        if (sql.includes("SELECT a.id FROM accounts")) return [[{ id: 20 }]];
        if (sql.includes("SELECT city AS value FROM accounts"))
          return [[{ value: "Guadalajara" }]];
        if (sql.includes("SET pending_operation = ?")) {
          row = { ...row, pending_operation: params[0], version: 4 };
          return [{ affectedRows: 1 }];
        }
        if (
          sql.includes(
            "SELECT * FROM coach_session_operations WHERE id = ? LIMIT 1",
          )
        )
          return [[row]];
        return [{ affectedRows: 1 }];
      }),
    };
    withTransactionMock.mockImplementation((work) => work(conn));

    const reviewed = await reviewControlledCoachOperation({
      user: request(["mi_coach.use", "cuentas.read"]).user,
      operationId: 41,
      version: 3,
    });

    expect(reviewed.pendingOperation.currentValue).toBe("Guadalajara");
    expect(reviewed.version).toBe(4);
  });

  it("requires domain read permission before exposing the current value", async () => {
    const fixture = connectionForAccount();
    withTransactionMock.mockImplementation((work) => work(fixture.conn));

    await expect(
      reviewControlledCoachOperation({
        user: request(["mi_coach.use"]).user,
        operationId: 41,
        version: 3,
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: "COACH_REVIEW_FORBIDDEN",
    });
  });

  it("returns the completed result when the same idempotency key is retried", async () => {
    const completed = operationRow({
      status: "completed",
      execution_key: "request-1",
      result_payload: JSON.stringify({ entityId: 20, after: "Monterrey" }),
      completed_at: "2026-09-26T10:02:00.000Z",
    });
    const conn = {
      query: vi.fn(async () => [[completed]]),
    };
    withTransactionMock.mockImplementation((work) => work(conn));

    const operation = await executeControlledCoachOperation({
      req: request(["mi_coach.use", "mi_coach.execute", "cuentas.update"]),
      operationId: 41,
      version: 3,
      idempotencyKey: "request-1",
      validateLeadOutcome: vi.fn(),
    });

    expect(operation.status).toBe("completed");
    expect(conn.query).toHaveBeenCalledTimes(1);
  });

  it("reverts only while the domain value still matches the completed result", async () => {
    let row = operationRow({
      status: "completed",
      result_payload: JSON.stringify({
        auditId: 88,
        entityType: "account",
        entityId: 20,
        field: "city",
        before: "Guadalajara",
        after: "Monterrey",
      }),
      domain_audit_id: 88,
      completed_at: "2026-09-26T10:02:00.000Z",
    });
    const calls = [];
    const conn = {
      query: vi.fn(async (sql, params = []) => {
        calls.push({ sql, params });
        if (
          sql.includes("FROM coach_session_operations") &&
          sql.includes("FOR UPDATE")
        )
          return [[row]];
        if (sql.includes("SELECT a.id FROM accounts")) return [[{ id: 20 }]];
        if (sql.includes("SELECT city AS value FROM accounts"))
          return [[{ value: "Monterrey" }]];
        if (sql.includes("INSERT INTO audit_log")) return [{ insertId: 89 }];
        if (sql.includes("SET status = 'reverted'")) {
          row = {
            ...row,
            status: "reverted",
            result_payload: params[0],
            version: 6,
          };
          return [{ affectedRows: 1 }];
        }
        if (
          sql.includes(
            "SELECT * FROM coach_session_operations WHERE id = ? LIMIT 1",
          )
        )
          return [[row]];
        return [{ affectedRows: 1 }];
      }),
    };
    withTransactionMock.mockImplementation((work) => work(conn));

    const reverted = await revertControlledCoachOperation({
      req: request(["mi_coach.use", "mi_coach.execute", "cuentas.update"]),
      operationId: 41,
    });

    expect(reverted.status).toBe("reverted");
    expect(reverted.result.reversalAuditId).toBe(89);
    expect(
      calls.some(
        ({ sql, params }) =>
          sql.includes("UPDATE accounts SET city") &&
          params[0] === "Guadalajara",
      ),
    ).toBe(true);
    const reversalAudit = calls.find(({ sql }) =>
      sql.includes("INSERT INTO audit_log"),
    );
    expect(reversalAudit.params[4]).toBe(41);
    const revertedEvent = calls.find(
      ({ sql, params }) =>
        sql.includes("coach_operation_events") && params[4] === "reverted",
    );
    expect(revertedEvent.params[11]).toBe(89);
  });
});
