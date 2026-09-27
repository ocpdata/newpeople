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
  listCoachSessionOperations,
  persistCoachOperations,
  transitionCoachOperation,
  updateCoachOperation,
} from "../src/coach/service.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

describe("Coach operation persistence", () => {
  let rows;
  let events;

  beforeEach(() => {
    rows = [];
    events = [];
    queryMock.mockReset();
    withTransactionMock.mockReset();
    withTransactionMock.mockImplementation((work) =>
      work({ query: async (...args) => [await queryMock(...args)] }),
    );
    queryMock.mockImplementation(async (sql, params = []) => {
      if (sql.includes("INSERT INTO coach_session_operations")) {
        const [
          sessionId,
          userId,
          sourceJobId,
          operationIndex,
          operationKind,
          status,
          originalIntent,
          identifiedEntities,
          collectedFields,
          missingFields,
          evidence,
          targetModule,
          targetRoute,
          originalOperation,
          pendingOperation,
        ] = params;
        const existing = rows.find(
          (row) =>
            row.source_job_id === sourceJobId &&
            row.operation_index === operationIndex,
        );
        if (existing) return { insertId: existing.id, affectedRows: 0 };
        rows.push({
          id: rows.length + 1,
          session_id: sessionId,
          user_id: userId,
          source_job_id: sourceJobId,
          operation_index: operationIndex,
          operation_kind: operationKind,
          status,
          original_intent: originalIntent,
          identified_entities: identifiedEntities,
          collected_fields: collectedFields,
          missing_fields: missingFields,
          evidence,
          target_module: targetModule,
          target_route: targetRoute,
          original_operation: originalOperation,
          pending_operation: pendingOperation,
          result_payload: null,
          error_detail: null,
          cancellation_reason: null,
          version: 1,
          handed_off_at: null,
          completed_at: null,
          cancelled_at: null,
          created_at: "2026-09-26T12:00:00.000Z",
          updated_at: "2026-09-26T12:00:00.000Z",
        });
        return { insertId: rows.length, affectedRows: 1 };
      }
      if (sql.includes("INSERT IGNORE INTO coach_operation_events")) {
        events.push({
          operationId: params[0],
          eventType: params[4],
          fromStatus: params[5],
          toStatus: params[6],
          eventKey: params[13],
        });
        return { insertId: events.length, affectedRows: 1 };
      }
      if (sql.includes("SET pending_operation = ?")) {
        const row = rows.find(
          (item) => item.id === params[4] && item.user_id === params[5],
        );
        if (!row || row.version !== params[6]) return { affectedRows: 0 };
        row.pending_operation = params[0];
        row.collected_fields = params[1];
        row.missing_fields = params[2];
        row.status = params[3];
        row.version += 1;
        return { affectedRows: 1 };
      }
      if (sql.includes("SET status = ?")) {
        const operationId = params.at(-2);
        const userId = params.at(-1);
        const row = rows.find(
          (item) => item.id === operationId && item.user_id === userId,
        );
        row.status = params[0];
        row.result_payload = params[1];
        row.error_detail = params[2];
        row.cancellation_reason = params[3];
        row.version += 1;
        return { affectedRows: 1 };
      }
      if (sql.includes("WHERE source_job_id = ?")) {
        return rows.filter(
          (row) =>
            row.source_job_id === params[0] &&
            row.operation_index === params[1] &&
            row.user_id === params[2],
        );
      }
      if (sql.includes("WHERE id = ? AND user_id = ?")) {
        return rows.filter(
          (row) => row.id === params[0] && row.user_id === params[1],
        );
      }
      if (sql.includes("WHERE session_id = ? AND user_id = ?")) {
        return rows.filter(
          (row) => row.session_id === params[0] && row.user_id === params[1],
        );
      }
      return { affectedRows: 1 };
    });
  });

  it("persists at most six independent proposals", async () => {
    const operations = Array.from({ length: 7 }, (_, index) => ({
      kind: "activity",
      title: `Actividad ${index + 1}`,
      opportunityId: 20,
      missingFields: index === 0 ? ["scheduledAt"] : [],
      evidence: [],
    }));

    const persisted = await persistCoachOperations({
      userId: 7,
      sessionId: 11,
      sourceJobId: 30,
      originalIntent: "Prepara actividades de seguimiento",
      entities: { opportunityId: 20 },
      operations,
    });

    expect(persisted).toHaveLength(6);
    expect(persisted[0]).toMatchObject({
      status: "collecting",
      originalIntent: "Prepara actividades de seguimiento",
      identifiedEntities: { opportunityId: 20 },
      targetModule: "commercial_development",
      targetRoute: "/commercial-development",
    });
    expect(persisted[1].status).toBe("ready");
    expect(
      events.filter((event) => event.eventType === "proposed"),
    ).toHaveLength(6);
    expect(events.some((event) => event.eventType === "ready")).toBe(true);
  });

  it("isolates operations by user and preserves other proposals", async () => {
    await persistCoachOperations({
      userId: 7,
      sessionId: 11,
      sourceJobId: 30,
      originalIntent: "Actualiza los datos",
      operations: [
        { kind: "account_field", title: "Cuenta", field: "city", value: "A" },
        { kind: "contact_field", title: "Contacto", field: "city", value: "B" },
      ],
    });

    expect(await listCoachSessionOperations(8, 11)).toEqual([]);
    const ownOperations = await listCoachSessionOperations(7, 11);
    const updated = await updateCoachOperation(7, ownOperations[0].id, {
      pendingOperation: {
        ...ownOperations[0].pendingOperation,
        value: "Ciudad de México",
      },
      missingFields: [],
      version: ownOperations[0].version,
    });

    expect(updated.outcome).toBe("updated");
    expect(updated.operation.pendingOperation.value).toBe("Ciudad de México");
    expect(rows[1].version).toBe(1);
  });

  it("rejects stale versions and records cancellation reasons", async () => {
    const [operation] = await persistCoachOperations({
      userId: 7,
      sessionId: 11,
      sourceJobId: 30,
      originalIntent: "Crea una cuenta",
      operations: [{ kind: "create_account", title: "Crear cuenta" }],
    });
    const stale = await updateCoachOperation(7, operation.id, {
      pendingOperation: clone(operation.pendingOperation),
      version: 99,
    });
    const cancelled = await transitionCoachOperation(7, operation.id, {
      status: "cancelled",
      cancellationReason: "El vendedor ya no necesita la cuenta",
    });

    expect(stale.outcome).toBe("conflict");
    expect(cancelled.operation).toMatchObject({
      status: "cancelled",
      cancellationReason: "El vendedor ya no necesita la cuenta",
    });
    expect(events.at(-1)).toMatchObject({
      operationId: operation.id,
      eventType: "cancelled",
      toStatus: "cancelled",
    });
  });

  it("records seller rejection as a distinct terminal event", async () => {
    const [operation] = await persistCoachOperations({
      userId: 7,
      sessionId: 11,
      sourceJobId: 32,
      originalIntent: "Actualiza la ciudad",
      operations: [
        {
          kind: "account_field",
          accountId: 20,
          field: "city",
          value: "Puebla",
        },
      ],
    });

    const rejected = await transitionCoachOperation(7, operation.id, {
      status: "rejected",
      cancellationReason: "Rechazada por el vendedor",
      source: "user",
      reasonCode: "seller_rejected",
    });

    expect(rejected.operation.status).toBe("rejected");
    expect(events.at(-1)).toMatchObject({
      eventType: "rejected",
      fromStatus: "ready",
      toStatus: "rejected",
    });
  });

  it("does not let the client change the operation identity", async () => {
    const [operation] = await persistCoachOperations({
      userId: 7,
      sessionId: 11,
      sourceJobId: 31,
      originalIntent: "Actualiza la cuenta",
      operations: [
        {
          kind: "account_field",
          accountId: 20,
          field: "city",
          value: "Monterrey",
        },
      ],
    });

    const result = await updateCoachOperation(7, operation.id, {
      pendingOperation: {
        ...operation.pendingOperation,
        accountId: 999,
      },
      version: operation.version,
    });

    expect(result.outcome).toBe("invalid");
    expect(result.operation.pendingOperation.accountId).toBe(20);
  });
});
