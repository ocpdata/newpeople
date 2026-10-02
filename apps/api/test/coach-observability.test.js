import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db.js", () => ({ query: vi.fn() }));
vi.mock("../src/coach/schema.js", () => ({ ensureCoachSchema: vi.fn() }));

import { query } from "../src/db.js";
import {
  getCoachQualityDashboard,
  isCoachUserInRollout,
  recordCoachTurnQualityTrace,
  saveCoachChannelRollouts,
  submitCoachTurnFeedback,
} from "../src/coach/observability.js";

describe("Coach observability", () => {
  beforeEach(() => vi.resetAllMocks());

  it("persists structured traces without requiring raw question text", async () => {
    query.mockResolvedValueOnce({ insertId: 42 });
    const traceId = await recordCoachTurnQualityTrace({
      channel: "customer_account",
      process: "account_chat",
      userId: 17,
      sessionId: 23,
      jobId: 91,
      trace: {
        caseId: "CUSTOMER-001",
        intentType: "channel_query",
        intentSubtype: "customer_account",
        primaryEntity: "account",
        entityResolution: { resolvedEntityTypes: ["account"] },
        appliedRules: { channel: "customer_account", scope: { accountScoped: true } },
        validationStatus: "valid",
        evidenceCount: 1,
        toolsUsed: ["searchAccounts"],
        operationsProposed: 0,
        latencyMs: 12,
      },
    });

    expect(traceId).toBe(42);
    expect(query.mock.calls[0][1]).toEqual(
      expect.arrayContaining([
        "customer_account",
        "account_chat",
        "CUSTOMER-001",
        17,
        23,
        91,
      ]),
    );
    expect(query.mock.calls[0][0]).not.toContain("question_text");
  });

  it("only accepts feedback from the owner of a trace", async () => {
    query.mockResolvedValueOnce([]);

    await expect(
      submitCoachTurnFeedback({
        traceId: 42,
        userId: 18,
        rating: "negative",
        category: "entity",
        corrected: true,
      }),
    ).resolves.toEqual({ outcome: "not_found" });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("WHERE id = ? AND user_id = ?"),
      [42, 18],
    );
  });

  it("derives quality rates and regressions by channel and process", async () => {
    query
      .mockResolvedValueOnce([
        {
          channel: "coach",
          process_key: "opportunity_query",
          case_id: "COACH-OPP-001",
          total_turns: 10,
          clarifications: 2,
          invalid_responses: 1,
          error_responses: 0,
          intent_positive: 7,
          intent_negative: 1,
          entity_positive: 6,
          entity_negative: 2,
          negative_feedback: 2,
          feedback_total: 4,
          corrected_feedback: 1,
          operations_proposed: 4,
          rejected_operations: 1,
          average_latency_ms: 100,
        },
      ])
      .mockResolvedValueOnce([
        { channel: "coach", proposed: 4, rejected: 1 },
      ]);

    const dashboard = await getCoachQualityDashboard(30);

    expect(dashboard.channels[0]).toMatchObject({
      channel: "coach",
      totalTurns: 10,
      clarificationRate: 0.2,
      invalidResponseRate: 0.1,
      intentClassificationAccuracy: 0.875,
      entityResolutionQuality: 0.75,
      rejectedOperationRate: 0.25,
      correctionByFeedbackRate: 0.25,
    });
    expect(dashboard.regressions[0]).toMatchObject({
      process: "opportunity_query",
      caseId: "COACH-OPP-001",
      invalidResponseRate: 0.1,
    });
  });

  it("does not report accuracy or rejection rates before their denominator exists", async () => {
    query
      .mockResolvedValueOnce([
        {
          channel: "prospect",
          process_key: "prospect_chat",
          total_turns: 3,
          clarifications: 0,
          invalid_responses: 0,
          error_responses: 0,
          intent_positive: 0,
          intent_negative: 0,
          entity_positive: 0,
          entity_negative: 0,
          negative_feedback: 0,
          corrected_feedback: 0,
          operations_proposed: 0,
          rejected_operations: 0,
          average_latency_ms: 12,
        },
      ])
      .mockResolvedValueOnce([]);

    const dashboard = await getCoachQualityDashboard();

    expect(dashboard.channels[0]).toMatchObject({
      intentClassificationAccuracy: null,
      entityResolutionQuality: null,
      rejectedOperationRate: null,
    });
  });

  it("assigns stable percentage cohorts and honors allowlists and kill switches", () => {
    const rollout = {
      channel: "prospect",
      enabled: true,
      rolloutPercentage: 35,
      allowlist: [99],
    };
    expect(isCoachUserInRollout(rollout, 99)).toBe(true);
    expect(isCoachUserInRollout(rollout, 12)).toBe(
      isCoachUserInRollout(rollout, 12),
    );
    expect(
      isCoachUserInRollout({ ...rollout, enabled: false }, 99),
    ).toBe(false);
  });

  it("blocks expansion without sufficient quality data but permits a bounded allowlisted canary", async () => {
    query.mockImplementation(async (sql) => {
      if (sql.includes("SELECT channel, enabled, rollout_percentage")) {
        return [{
          channel: "prospect",
          enabled: true,
          rollout_percentage: 0,
          allowlist_json: [],
        }];
      }
      if (sql.includes("SELECT COUNT(*) AS total_turns")) {
        return [{
          total_turns: 0,
          invalid_turns: 0,
          feedback_turns: 0,
          negative_feedback: 0,
          corrected_feedback: 0,
          proposed_operations: 0,
          rejected_operations: 0,
        }];
      }
      return [];
    });

    await expect(
      saveCoachChannelRollouts({
        user: { id: 7 },
        rollouts: [
          {
            channel: "prospect",
            enabled: true,
            rolloutPercentage: 50,
            allowlist: [],
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "ROLLOUT_QUALITY_GATE_INSUFFICIENT_SAMPLE" });

    query.mockImplementation(async () => []);
    const canary = await saveCoachChannelRollouts({
      user: { id: 7 },
      rollouts: [
        {
          channel: "prospect",
          enabled: true,
          rolloutPercentage: 5,
          allowlist: [7],
        },
      ],
    });
    expect(canary[0]).toMatchObject({
      channel: "prospect",
      rolloutPercentage: 5,
      allowlist: [7],
    });
  });
});