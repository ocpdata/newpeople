import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db.js", () => ({ query: vi.fn() }));
vi.mock("../src/coach/schema.js", () => ({ ensureCoachSchema: vi.fn() }));

import { query } from "../src/db.js";
import {
  getCoachQualityDashboard,
  isCoachUserInRollout,
  recordCoachTurnQualityTrace,
  listCoachQualityTraces,
  saveCoachChannelRollouts,
  summarizeCoachToolResults,
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
        appliedRules: {
          channel: "customer_account",
          scope: { accountScoped: true },
        },
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

  it("summarizes tool outcomes without retaining result contents", () => {
    const metrics = summarizeCoachToolResults([
      {
        toolName: "searchContacts",
        args: { search: "Ana Torres" },
        result: [{ id: 21, name: "Ana Torres", email: "ana@example.test" }],
      },
      {
        toolName: "searchInteractions",
        result: {
          results: [{ id: 31 }, { id: 32 }],
          pagination: { totalCount: 9 },
        },
      },
      {
        toolName: "searchOpportunities",
        result: null,
        error: "Herramienta no permitida por la politica del canal.",
      },
    ]);

    expect(metrics).toEqual([
      {
        toolName: "searchContacts",
        resultCount: 1,
        errorCode: null,
        truncated: null,
      },
      {
        toolName: "searchInteractions",
        resultCount: 2,
        errorCode: null,
        truncated: true,
      },
      {
        toolName: "searchOpportunities",
        resultCount: 0,
        errorCode: "permission_denied",
        truncated: null,
      },
    ]);
    expect(JSON.stringify(metrics)).not.toContain("Ana Torres");
    expect(JSON.stringify(metrics)).not.toContain("ana@example.test");
    expect(JSON.stringify(metrics)).not.toContain("politica del canal");
  });

  it("persists route and fallback diagnostics without raw question metadata", async () => {
    query.mockResolvedValueOnce({ insertId: 43 });
    await recordCoachTurnQualityTrace({
      channel: "customer_account",
      process: "account_chat",
      userId: 17,
      trace: {
        validationStatus: "error",
        toolMetrics: [
          {
            toolName: "searchContacts",
            result: [{ id: 21, name: "Private Contact" }],
          },
        ],
        diagnostics: {
          planner: {
            source: "invalid_source",
            fallbackUsed: true,
            reasonCode: "planner_error",
            queryCount: 0,
          },
          channelIntentRouting: {
            intent: "contact_query",
            confidence: 0.95,
            allowedTools: ["searchContacts"],
            missingContext: [],
            requiresClarification: false,
          },
          fallback: {
            used: true,
            reasonCode: "adapter_execution_failed",
          },
          snapshotMetrics: [
            {
              source: "contacts",
              resultCount: 50,
              resultLimit: 50,
              truncated: true,
              errorCode: "query_error",
              privateValue: "Do not store source rows",
            },
          ],
          questionText: "Do not persist this question",
        },
      },
    });

    const parameters = query.mock.calls[0][1];
    expect(JSON.parse(parameters[17])).toEqual([
      {
        toolName: "searchContacts",
        resultCount: 1,
        errorCode: null,
        truncated: null,
      },
    ]);
    expect(JSON.parse(parameters[18])).toMatchObject({
      planner: {
        source: "not_applicable",
        fallbackUsed: false,
        reasonCode: "planner_error",
        queryCount: 0,
      },
      channelIntentRouting: {
        intent: "contact_query",
        allowedTools: ["searchContacts"],
      },
      fallback: { used: true, reasonCode: "adapter_execution_failed" },
      snapshotMetrics: [
        {
          source: "contacts",
          resultCount: 50,
          resultLimit: 50,
          truncated: true,
          errorCode: "query_error",
        },
      ],
    });
    expect(JSON.stringify(parameters)).not.toContain("Private Contact");
    expect(JSON.stringify(parameters)).not.toContain(
      "Do not store source rows",
    );
    expect(JSON.stringify(parameters)).not.toContain(
      "Do not persist this question",
    );
  });

  it("returns safe tool metrics and diagnostics for the owning session", async () => {
    query.mockResolvedValueOnce([
      {
        id: 43,
        channel: "customer_account",
        process_key: "account_chat",
        session_id: 23,
        job_id: 91,
        entity_resolution_json: JSON.stringify({
          resolvedEntityIds: { accountId: 7 },
        }),
        applied_rules_json: JSON.stringify({ channel: "customer_account" }),
        validation_status: "valid",
        validation_reasons_json: "[]",
        tools_used_json: '["searchAccounts"]',
        tool_metrics_json: JSON.stringify([
          {
            toolName: "searchAccounts",
            resultCount: 1,
            errorCode: null,
            truncated: null,
          },
        ]),
        diagnostics_json: JSON.stringify({
          fallback: { used: false, reasonCode: null },
        }),
      },
    ]);

    const traces = await listCoachQualityTraces({
      userId: 17,
      channel: "customer_account",
      sessionId: 23,
    });

    expect(traces[0]).toMatchObject({
      id: 43,
      toolMetrics: [
        expect.objectContaining({
          toolName: "searchAccounts",
          resultCount: 1,
          truncated: null,
        }),
      ],
      diagnostics: { fallback: { used: false } },
    });
    expect(query.mock.calls[0][0]).toContain(
      "WHERE user_id = ? AND channel = ? AND session_id = ?",
    );
    expect(query.mock.calls[0][1]).toEqual([17, "customer_account", 23, 50]);
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
      .mockResolvedValueOnce([{ channel: "coach", proposed: 4, rejected: 1 }]);

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
    expect(isCoachUserInRollout({ ...rollout, enabled: false }, 99)).toBe(
      false,
    );
  });

  it("blocks expansion without sufficient quality data", async () => {
    query.mockImplementation(async (sql) => {
      if (sql.includes("SELECT channel, enabled, rollout_percentage")) {
        return [
          {
            channel: "prospect",
            enabled: true,
            rollout_percentage: 0,
            allowlist_json: [],
          },
        ];
      }
      if (sql.includes("SELECT COUNT(*) AS total_turns")) {
        return [
          {
            total_turns: 0,
            invalid_turns: 0,
            feedback_turns: 0,
            negative_feedback: 0,
            corrected_feedback: 0,
            proposed_operations: 0,
            rejected_operations: 0,
          },
        ];
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
    ).rejects.toMatchObject({
      code: "ROLLOUT_QUALITY_GATE_INSUFFICIENT_SAMPLE",
    });
  });

  it("does not expose planner rollout controls for Customer Existing", async () => {
    query.mockResolvedValue([]);
    await expect(
      saveCoachChannelRollouts({
        user: { id: 7 },
        rollouts: [
          {
            channel: "customer_account",
            enabled: true,
            rolloutPercentage: 100,
            allowlist: [],
          },
        ],
      }),
    ).rejects.toThrow("Canal de rollout no soportado");
  });

  it("aggregates planner quality, clarification feedback, retrieval, truncation, latency and cost", async () => {
    query.mockImplementation(async (sql) => {
      if (sql.includes("SELECT channel, process_key, case_id")) return [];
      if (sql.includes("coach_operation_events")) return [];
      if (sql.includes("SELECT diagnostics_json, tool_metrics_json")) {
        return [
          {
            job_id: 991,
            latency_ms: 1200,
            response_type: "clarification",
            feedback_rating: "negative",
            feedback_category: "intent",
            feedback_corrected: 1,
            diagnostics_json: {
              planner: {
                evaluation: {
                  mode: "active",
                  assigned: true,
                  planAvailable: true,
                  plannerIntents: ["account_overview"],
                  plannerTools: ["searchAccounts", "searchOpportunities"],
                  plannerFilterCount: 0,
                  plannerEntityReferenceCount: 0,
                  plannerRequiresClarification: true,
                  plannedToolCount: 2,
                  plannedToolsObserved: 2,
                  plannedToolsWithEvidence: 1,
                  genericFallback: false,
                  retrievalError: false,
                  truncatedSourceCount: 1,
                },
              },
            },
          },
        ];
      }
      if (sql.includes("FROM ai_usage_ledger")) {
        return [{ job_id: 991, total_cost_micros: 2500 }];
      }
      return [];
    });

    const dashboard = await getCoachQualityDashboard(30);

    expect(dashboard.plannerMetrics[0]).toMatchObject({
      mode: "active",
      turns: 1,
      assignedTurns: 1,
      planAvailableTurns: 1,
      plannerClarificationRate: 1,
      visibleClarificationRate: 1,
      incorrectClarificationRate: 1,
      plannedToolObservationRate: 1,
      plannedToolEvidenceRate: 0.5,
      retrievalErrorRate: 0,
      truncationRate: 1,
      averageLatencyMs: 1200,
      averageCostMicros: 2500,
      correctionByFeedbackRate: 1,
    });
  });
});
