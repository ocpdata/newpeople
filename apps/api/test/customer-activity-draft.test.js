import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildCustomerActivityDraftResponse } from "../src/commercial-intelligence/activity-draft.js";
import { validateCustomerConversationContext } from "../src/commercial-intelligence/conversation-context.js";

const store = vi.hoisted(() => ({
  createCoachSession: vi.fn(),
  getCoachOperation: vi.fn(),
  persistCoachOperations: vi.fn(),
  updateCoachOperation: vi.fn(),
  transitionCoachOperation: vi.fn(),
}));
vi.mock("../src/coach/service.js", () => store);
import {
  loadCustomerPendingActivity,
  persistCustomerActivityDraft,
} from "../src/commercial-intelligence/activity-draft-persistence.js";

const permissions = new Set([
  "mi_coach.execute",
  "calendario_comercial.update",
  "oportunidades.update",
  "contactos.read",
]);
const snapshot = {
  account: { id: 7, name: "Totalplay" },
  opportunities: [{ id: 11, accountId: 7, name: "Vrf 2027", contactId: 109 }],
  contacts: [{ id: 109, accountId: 7, name: "Rene Negrete" }],
};
const readToolResults = [
  {
    toolName: "getOpportunity",
    result: {
      id: 11,
      name: "Vrf 2027",
      associatedContact: { name: "Rene Negrete" },
    },
  },
];
const routing = {
  mode: "operation",
  intents: ["crm_operation", "contact_query"],
  serverResolvedEntityIds: { opportunityId: 11 },
  activityDraft: {
    action: "prepare",
    actionType: "call",
    title: "Llamar a Rene Negrete",
    scheduledAt: "",
    temporalPreference: "la próxima semana",
  },
};
const build = (overrides = {}) =>
  buildCustomerActivityDraftResponse({
    routing,
    snapshot,
    readToolResults,
    permissions,
    ...overrides,
  });

describe("Customer activity fields versus CRM evidence", () => {
  it("asks for day and time without requiring availability or history", () => {
    const response = build();
    expect(response.operations[0]).toMatchObject({
      kind: "activity",
      accountId: 7,
      opportunityId: 11,
      contactId: 109,
      scheduledAt: "",
      missingFields: ["scheduledAt"],
    });
    expect(response.answer).toContain("¿Qué día y a qué hora");
    expect(response.answer).toContain("próxima semana");
    expect(response.pendingItems).toEqual(["Fecha y hora"]);
  });
  it("merges a continuation into the existing draft", () => {
    const response = build({
      pendingActivity: build().activityDraft,
      routing: {
        ...routing,
        activityDraft: {
          action: "continue",
          actionType: "call",
          scheduledAt: "2026-10-13T10:00",
        },
      },
    });
    expect(response.operations[0]).toMatchObject({
      title: "Llamar a Rene Negrete",
      scheduledAt: "2026-10-13T10:00",
      missingFields: [],
    });
    expect(response.answer).toContain("No se ha guardado");
  });
  it("reuses the pending activity even if the planner calls a continuation prepare", () => {
    const response = build({
      pendingActivity: build().activityDraft,
      routing: {
        ...routing,
        activityDraft: {
          ...routing.activityDraft,
          action: "prepare",
          scheduledAt: "2026-10-13T10:00",
        },
      },
    });
    expect(response.activityDraft.action).toBe("continue");
    expect(response.operations[0].scheduledAt).toBe("2026-10-13T10:00");
  });
  it.each([
    "mi_coach.execute",
    "calendario_comercial.update",
    "oportunidades.update",
    "contactos.read",
  ])("blocks missing permission %s", (permission) => {
    expect(
      build({
        permissions: new Set(
          [...permissions].filter((item) => item !== permission),
        ),
      }).operations,
    ).toEqual([]);
  });
  it("requires successful opportunity and direct contact evidence", () => {
    expect(
      build({ readToolResults: [{ ...readToolResults[0], error: "denied" }] })
        .operations,
    ).toEqual([]);
    expect(
      build({
        readToolResults: [{ toolName: "getOpportunity", result: { id: 11 } }],
      }).operations,
    ).toEqual([]);
    expect(
      build({
        snapshot: { ...snapshot, contacts: [{ id: 109, accountId: 8 }] },
      }).operations,
    ).toEqual([]);
  });
  it("never bypasses the verifier for factual or ambiguous requests", () => {
    expect(
      build({
        routing: {
          ...routing,
          intents: ["crm_operation", "account_activity_history"],
        },
      }),
    ).toBeNull();
    expect(
      build({ routing: { ...routing, requiresClarification: true } }),
    ).toBeNull();
    expect(build({ routing: { ...routing, mode: "query" } })).toBeNull();
  });
  it.each(["2026-02-30T10:00", "2026-10-13T25:00", "mañana", "2026-10-13"])(
    "keeps invalid date %s pending",
    (scheduledAt) => {
      expect(
        build({
          routing: {
            ...routing,
            activityDraft: { ...routing.activityDraft, scheduledAt },
          },
        }).operations[0].missingFields,
      ).toEqual(["scheduledAt"]);
    },
  );
});

describe("Customer activity persistence", () => {
  beforeEach(() => vi.clearAllMocks());
  it("creates once, then updates the same ID and preserves context across reload", async () => {
    const response = build();
    store.createCoachSession.mockResolvedValue({ id: 80 });
    store.persistCoachOperations.mockImplementation(async ({ operations }) => [
      {
        id: 90,
        sessionId: 80,
        version: 1,
        status: "collecting",
        pendingOperation: operations[0],
      },
    ]);
    const pending = await persistCustomerActivityDraft({
      userId: 31,
      response,
      context: { accountId: 7 },
      originalIntent: "programar llamada",
    });
    expect(response.operations[0].persistentId).toBe(90);
    const context = validateCustomerConversationContext(
      { accountId: 7, pendingActivity: pending },
      snapshot,
      7,
    );
    expect(context.pendingActivity.operationId).toBe(90);
    store.getCoachOperation.mockResolvedValue({
      id: 90,
      sessionId: 80,
      version: 1,
      status: "collecting",
      kind: "activity",
      pendingOperation: pending.operation,
    });
    const reloaded = await loadCustomerPendingActivity(31, context);
    const continuation = build({
      pendingActivity: reloaded,
      routing: {
        ...routing,
        activityDraft: {
          action: "continue",
          actionType: "call",
          scheduledAt: "2026-10-13T10:00",
        },
      },
    });
    store.updateCoachOperation.mockImplementation(
      async (userId, operationId, { pendingOperation }) => ({
        outcome: "updated",
        operation: {
          id: operationId,
          sessionId: 80,
          version: 2,
          status: "ready",
          pendingOperation,
        },
      }),
    );
    await persistCustomerActivityDraft({
      userId: 31,
      response: continuation,
      context,
      originalIntent: "martes a las diez",
    });
    expect(store.createCoachSession).toHaveBeenCalledTimes(1);
    expect(store.persistCoachOperations).toHaveBeenCalledTimes(1);
    expect(continuation.operations[0]).toMatchObject({
      persistentId: 90,
      persistenceVersion: 2,
      persistenceStatus: "ready",
    });
  });
  it("does not reload closed or foreign-account operations", async () => {
    const context = {
      accountId: 7,
      pendingActivity: { operationId: 90, sessionId: 80 },
    };
    store.getCoachOperation.mockResolvedValue({
      sessionId: 80,
      status: "completed",
      kind: "activity",
      pendingOperation: { accountId: 7 },
    });
    expect(await loadCustomerPendingActivity(31, context)).toBeNull();
    store.getCoachOperation.mockResolvedValue({
      sessionId: 80,
      status: "collecting",
      kind: "activity",
      pendingOperation: { accountId: 8 },
    });
    expect(await loadCustomerPendingActivity(31, context)).toBeNull();
  });
  it("cancels the same pending operation without creating another", async () => {
    store.getCoachOperation.mockResolvedValue({
      id: 90,
      version: 2,
      pendingOperation: { accountId: 7 },
    });
    const result = await persistCustomerActivityDraft({
      userId: 31,
      response: { activityDraftDiscarded: true },
      context: {
        accountId: 7,
        pendingActivity: { operationId: 90, sessionId: 80 },
      },
    });
    expect(result).toBeNull();
    expect(store.transitionCoachOperation).toHaveBeenCalledWith(
      31,
      90,
      expect.objectContaining({ status: "cancelled" }),
    );
    expect(store.createCoachSession).not.toHaveBeenCalled();
  });
  it("rejects a stale continuation instead of overwriting the edited draft", async () => {
    const response = build();
    const context = {
      accountId: 7,
      pendingActivity: { operationId: 90, sessionId: 80, version: 1 },
    };
    store.getCoachOperation.mockResolvedValue({
      id: 90,
      version: 2,
      pendingOperation: { accountId: 7 },
    });
    store.updateCoachOperation.mockResolvedValue({ outcome: "conflict" });
    await expect(
      persistCustomerActivityDraft({ userId: 31, response, context }),
    ).rejects.toThrow("El borrador cambió");
    expect(store.updateCoachOperation).toHaveBeenCalledWith(
      31,
      90,
      expect.objectContaining({ version: 1 }),
    );
  });
});
