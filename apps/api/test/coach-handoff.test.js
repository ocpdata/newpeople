import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock, withTransactionMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  withTransactionMock: vi.fn(),
}));

vi.mock("../src/db.js", () => ({
  query: queryMock,
  withTransaction: withTransactionMock,
}));
vi.mock("../src/coach/schema.js", () => ({
  ensureCoachSchema: vi.fn().mockResolvedValue(undefined),
}));

import {
  cancelCoachHandoff,
  completeCoachHandoff,
  createCoachHandoff,
  getCoachHandoff,
} from "../src/coach/service.js";

function buildRow(overrides = {}) {
  return {
    id: 41,
    session_id: 12,
    user_id: 7,
    source_job_id: 30,
    operation_index: 0,
    operation_kind: "create_account",
    status: "ready",
    original_intent: "Crear una cuenta",
    identified_entities: "{}",
    collected_fields: "{}",
    missing_fields: "[]",
    evidence: "[]",
    target_module: "accounts",
    target_route: "/accounts",
    handoff_token: null,
    handoff_expires_at: null,
    handoff_consumed_at: null,
    original_operation: '{"kind":"create_account"}',
    pending_operation: '{"kind":"create_account","payload":{"name":"Acme"}}',
    result_payload: null,
    error_detail: null,
    cancellation_reason: null,
    version: 1,
    handed_off_at: null,
    completed_at: null,
    cancelled_at: null,
    created_at: "2026-09-26T12:00:00.000Z",
    updated_at: "2026-09-26T12:00:00.000Z",
    ...overrides,
  };
}

function installQueryStore(initialRow = buildRow()) {
  let row = initialRow;
  queryMock.mockImplementation(async (sql, params = []) => {
    if (sql.includes("WHERE handoff_token = ?")) {
      const [token, userId] = params;
      const active =
        row.handoff_token === token &&
        row.user_id === userId &&
        ["handed_off", "failed"].includes(row.status);
      return active ? [row] : [];
    }
    if (sql.includes("SET handoff_token = ?")) {
      row = {
        ...row,
        handoff_token: params[0],
        handoff_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        handoff_consumed_at: null,
        status: "handed_off",
        version: row.version + 1,
      };
      return { affectedRows: 1 };
    }
    if (sql.includes("SET handoff_consumed_at")) {
      row = {
        ...row,
        handoff_consumed_at:
          row.handoff_consumed_at || new Date().toISOString(),
      };
      return { affectedRows: 1 };
    }
    if (sql.includes("SET status = ?")) {
      row = {
        ...row,
        status: params[0],
        result_payload: params[1],
        error_detail: params[2],
        cancellation_reason: params[3],
        version: row.version + 1,
      };
      return { affectedRows: 1 };
    }
    if (sql.includes("WHERE id = ? AND user_id = ?")) {
      return row.id === params[0] && row.user_id === params[1] ? [row] : [];
    }
    return { affectedRows: 1 };
  });
  return () => row;
}

describe("Coach handoffs", () => {
  beforeEach(() => {
    queryMock.mockReset();
    withTransactionMock.mockReset();
    withTransactionMock.mockImplementation((work) =>
      work({ query: async (...args) => [await queryMock(...args)] }),
    );
  });

  it("reuses an active token and replaces an expired token", async () => {
    const readRow = installQueryStore();
    const first = await createCoachHandoff(7, 41);
    const second = await createCoachHandoff(7, 41);
    const firstToken = first.operation.handoffToken;

    expect(first.outcome).toBe("ready");
    expect(second.operation.handoffToken).toBe(firstToken);

    readRow().handoff_expires_at = new Date(Date.now() - 1_000).toISOString();
    const renewed = await createCoachHandoff(7, 41);
    expect(renewed.operation.handoffToken).not.toBe(firstToken);
  });

  it("does not hand off proposals that still require review", async () => {
    installQueryStore(buildRow({ status: "collecting" }));

    const result = await createCoachHandoff(7, 41);

    expect(result).toMatchObject({
      outcome: "not_ready",
      operation: { status: "collecting" },
    });
  });

  it("enforces ownership, module and expiration while loading", async () => {
    const token = "token-accounts";
    const readRow = installQueryStore(
      buildRow({
        status: "handed_off",
        handoff_token: token,
        handoff_expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
    );

    expect((await getCoachHandoff(8, token, "accounts")).outcome).toBe(
      "not_found",
    );
    expect((await getCoachHandoff(7, token, "contacts")).outcome).toBe(
      "wrong_module",
    );
    expect((await getCoachHandoff(7, token, "accounts")).outcome).toBe("ready");
    expect(readRow().handoff_consumed_at).toBeTruthy();

    readRow().handoff_expires_at = new Date(Date.now() - 1_000).toISOString();
    expect((await getCoachHandoff(7, token, "accounts")).outcome).toBe(
      "expired",
    );
    expect(readRow()).toMatchObject({
      status: "cancelled",
      cancellation_reason: "El handoff expiró",
    });
  });

  it("completes and cancels active handoffs with their result", async () => {
    const completeToken = "token-complete";
    installQueryStore(
      buildRow({
        status: "handed_off",
        handoff_token: completeToken,
        handoff_expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
    );
    const completed = await completeCoachHandoff(7, completeToken, "accounts", {
      entityType: "account",
      entityId: 99,
    });
    expect(completed.operation).toMatchObject({
      status: "completed",
      result: { entityType: "account", entityId: 99 },
    });

    const cancelToken = "token-cancel";
    installQueryStore(
      buildRow({
        status: "handed_off",
        handoff_token: cancelToken,
        handoff_expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
    );
    const cancelled = await cancelCoachHandoff(
      7,
      cancelToken,
      "accounts",
      "Descartado por el vendedor",
    );
    expect(cancelled.operation).toMatchObject({
      status: "cancelled",
      cancellationReason: "Descartado por el vendedor",
    });
  });

  it("does not complete the same handoff twice", async () => {
    const token = "token-single-use";
    const readRow = installQueryStore(
      buildRow({
        status: "handed_off",
        handoff_token: token,
        handoff_expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
    );

    const first = await completeCoachHandoff(7, token, "accounts", {
      entityType: "account",
      entityId: 99,
    });
    const second = await completeCoachHandoff(7, token, "accounts", {
      entityType: "account",
      entityId: 100,
    });

    expect(first.operation.status).toBe("completed");
    expect(second).toEqual({ outcome: "not_found", operation: null });
    expect(readRow().result_payload).toBe(
      JSON.stringify({ entityType: "account", entityId: 99 }),
    );
  });

  it("hides invented tokens and tokens owned by another user", async () => {
    installQueryStore(
      buildRow({
        status: "handed_off",
        handoff_token: "owned-token",
        handoff_expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
    );

    expect(await getCoachHandoff(7, "invented-token", "accounts")).toEqual({
      outcome: "not_found",
      operation: null,
    });
    expect(await getCoachHandoff(8, "owned-token", "accounts")).toEqual({
      outcome: "not_found",
      operation: null,
    });
  });
});
