import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildCustomerActivityDraftResponse, resolveCustomerActivityListOpportunity } from "../src/commercial-intelligence/activity-draft.js";
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
    timing: "scheduled",
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

describe("Activity continuation from a single listed opportunity", () => {
  const question = "De esta oportunidad necesito registrar una llamada que hice el dia de hoy para agendar una reunion";
  const context = {
    accountId: 7,
    recordList: { accountId: 7, object: "opportunity", spec: {}, ids: [11] },
    turnMemory: { contract: { components: [{ category: "query.record_list", object: "opportunity" }] } },
  };
  const resolve = (overrides = {}) => resolveCustomerActivityListOpportunity({
    question, conversationContext: context, snapshot, ...overrides,
  });
  it("uses the only displayed opportunity, not an arbitrary opportunity in the account", () => {
    expect(resolve({ snapshot: { ...snapshot, opportunities: [
      ...snapshot.opportunities, { id: 12, accountId: 7, name: "Otro proyecto" },
    ] } })).toBe(11);
  });
  it.each([
    { recordList: { ...context.recordList, ids: [] } },
    { recordList: { ...context.recordList, ids: [11, 12] } },
    { recordList: { ...context.recordList, ids: [12] } },
    { recordList: { ...context.recordList, accountId: 99 } },
    { recordList: { ...context.recordList, object: "contact" } },
    { accountId: 99 },
    { opportunityId: 12 },
    { turnMemory: null },
    { turnMemory: { contract: { components: [{ category: "query.account_summary", object: "account" }] } } },
    { turnMemory: { contract: { components: [{ id: "c1", category: "query.record_list", object: "opportunity" }] }, pendingComponentIds: ["c1"] } },
  ])("does not reuse ambiguous, stale or conflicting context %j", (patch) => {
    expect(resolve({ conversationContext: { ...context, ...patch } })).toBeNull();
  });
  it("does not infer a destination without an explicit conversational reference", () => {
    expect(resolve({ question: "Necesito registrar una llamada" })).toBeNull();
  });
  it("revalidates account membership and read access", () => {
    expect(resolve({ snapshot: { ...snapshot, opportunities: [{ ...snapshot.opportunities[0], accountId: 99 }] } })).toBeNull();
    expect(resolve({ snapshot: { ...snapshot, permissions: { canReadOpportunities: false } } })).toBeNull();
  });
  it("does not override an explicit reference to another opportunity", () => {
    expect(resolve({
      question: `${question}, pero para Otro proyecto`,
      snapshot: { ...snapshot, opportunities: [...snapshot.opportunities, { id: 12, accountId: 7, name: "Otro proyecto" }] },
    })).toBeNull();
  });
  it("keeps the past call completed and its meeting objective without creating a second activity", () => {
    const response = build({
      routing: { ...routing, serverResolvedEntityIds: { opportunityId: resolve() },
        activityDraft: { ...routing.activityDraft, timing: "completed", notes: "Llamada para agendar una reunión", scheduledAt: "" } },
    });
    expect(response.operations).toHaveLength(1);
    expect(response.operations[0]).toMatchObject({
      opportunityId: 11, actionType: "call", status: "done",
      notes: "Llamada para agendar una reunión", scheduledAt: "", missingFields: ["scheduledAt"],
    });
  });
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
  it("records a past call as done and asks when it occurred", () => {
    const response = build({
      routing: {
        ...routing,
        activityDraft: { ...routing.activityDraft, timing: "completed" },
      },
    });

    expect(response.operations[0]).toMatchObject({
      kind: "activity",
      status: "done",
      scheduledAt: "",
      missingFields: ["scheduledAt"],
    });
    expect(response.answer).toContain("¿Qué día y a qué hora ocurrió");
    expect(response.answer).toContain("como realizada");
  });
  it("surfaces the reported result of a completed call in the response", () => {
    const response = build({
      routing: {
        ...routing,
        activityDraft: {
          ...routing.activityDraft,
          timing: "completed",
          notes: "El cliente no contestó.",
        },
      },
    });
    expect(response.answer).toContain("Nota: “El cliente no contestó.”");
    expect(response.operations[0].notes).toBe("El cliente no contestó.");
  });
  it("previews a dated past call as done without implying it was saved", () => {
    const response = build({
      routing: {
        ...routing,
        activityDraft: {
          ...routing.activityDraft,
          timing: "completed",
          scheduledAt: "2026-10-12T16:30",
          notes: "El cliente revisará la propuesta.",
        },
      },
    });

    expect(response.operations[0]).toMatchObject({
      status: "done",
      scheduledAt: "2026-10-12T16:30",
      notes: "El cliente revisará la propuesta.",
      missingFields: [],
    });
    expect(response.answer).toContain("como realizada");
    expect(response.answer).toContain("No se ha guardado todavía");
  });
  it("retains a completed-call intent while asking for its opportunity", () => {
    const pendingActivityIntent = {
      actionType: "call",
      timing: "completed",
      title: "Resultado de llamada",
      notes: "El cliente revisará la propuesta.",
    };
    const clarification = build({
      pendingActivityIntent,
      routing: {
        ...routing,
        serverResolvedEntityIds: {},
        activityDraft: {
          ...routing.activityDraft,
          timing: "completed",
          notes: "El cliente revisará la propuesta.",
        },
      },
      readToolResults: [],
    });

    expect(clarification.responseType).toBe("clarification");
    expect(clarification.operations).toEqual([]);
    expect(clarification.activityIntent).toMatchObject(
      pendingActivityIntent,
    );

    const continued = build({
      pendingActivityIntent: clarification.activityIntent,
      routing: {
        ...routing,
        activityDraft: {
          ...routing.activityDraft,
          action: "continue",
          timing: "completed",
          notes: "El cliente revisará la propuesta.",
        },
      },
    });
    expect(continued.operations[0]).toMatchObject({
      status: "done",
      notes: "El cliente revisará la propuesta.",
      scheduledAt: "",
      missingFields: ["scheduledAt"],
    });
    expect(continued.answer).toContain("como realizada");
  });
  it("asks whether an activity is past or future when timing is unclear", () => {
    const response = build({
      routing: {
        ...routing,
        activityDraft: { ...routing.activityDraft, timing: "unclear" },
      },
    });

    expect(response.responseType).toBe("clarification");
    expect(response.operations).toEqual([]);
    expect(response.answer).toContain("¿La llamada ya ocurrió o quieres programarla?");
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
      build({
        routing: {
          ...routing,
          requiresClarification: true,
          validationDiagnostics: { operationPolicyDenied: true },
        },
      }),
    ).toBeNull();
    const clarification = build({
      routing: { ...routing, requiresClarification: true },
    });
    expect(clarification.responseType).toBe("clarification");
    expect(clarification.operations).toEqual([]);
    expect(clarification.activityIntent).toEqual(
      expect.objectContaining({ timing: "scheduled" }),
    );
    expect(
      build({
        routing: {
          ...routing,
          requiresClarification: true,
          ambiguity: { reason: "other_account" },
        },
      }),
    ).toBeNull();
    expect(build({ routing: { ...routing, mode: "query" } })).toBeNull();
  });
  it("does not route contact creation through the activity draft handler", () => {
    expect(
      build({
        routing: {
          ...routing,
          operationKind: "create_contact",
          activityDraft: {
            ...routing.activityDraft,
            action: "prepare",
          },
        },
      }),
    ).toBeNull();
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
    expect(store.persistCoachOperations).toHaveBeenCalledWith(
      expect.objectContaining({
        operations: [expect.objectContaining({ sourceChannel: "customer_account" })],
      }),
    );
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
