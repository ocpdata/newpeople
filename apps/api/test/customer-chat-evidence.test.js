import { describe, expect, it, vi } from "vitest";
import {
  CUSTOMER_CHAT_EVIDENCE_LIMITS,
  runCustomerEvidenceLoop,
} from "../src/commercial-intelligence/customer-chat-evidence.js";

describe("Customer Existing evidence loop", () => {
  it("reserves enough time for planning, evidence checks, synthesis, and audit", () => {
    expect(CUSTOMER_CHAT_EVIDENCE_LIMITS.maxTurnMs).toBe(45000);
  });

  it("requests another authorized evidence batch and verifies again", async () => {
    const assessEvidence = vi
      .fn()
      .mockResolvedValueOnce({
        status: "incomplete",
        missingQueries: ["account_activity_history"],
      })
      .mockResolvedValueOnce({ status: "sufficient", missingQueries: [] });
    const fetchAdditionalEvidence = vi.fn().mockResolvedValue({
      readToolResults: [
        { toolName: "getOpportunityActivities", result: [{ id: 24 }] },
        { toolName: "searchInteractions", result: [{ id: 25 }] },
      ],
    });
    const traceEvents = [];

    const result = await runCustomerEvidenceLoop({
      initialReadToolResults: [
        { toolName: "getOpportunity", result: { id: 11 } },
      ],
      assessEvidence,
      fetchAdditionalEvidence,
      onTraceEvent: (event) => traceEvents.push(event),
    });

    expect(result).toMatchObject({
      status: "sufficient",
      rounds: 1,
      additionalReadQueries: 2,
      readToolResults: [
        { toolName: "getOpportunity", result: { id: 11 } },
        { toolName: "getOpportunityActivities", result: [{ id: 24 }] },
        { toolName: "searchInteractions", result: [{ id: 25 }] },
      ],
    });
    expect(fetchAdditionalEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        missingQueries: ["account_activity_history"],
        remainingReadQueries: CUSTOMER_CHAT_EVIDENCE_LIMITS.maxReadQueries - 1,
      }),
    );
    expect(assessEvidence).toHaveBeenCalledTimes(2);
    expect(traceEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "B9",
          to: "B7",
          phase: "call",
          status: "started",
          round: 0,
        }),
        expect.objectContaining({
          from: "B7",
          to: "B9",
          phase: "return",
          status: "completed",
          round: 0,
        }),
      ]),
    );
  });

  it("never reports a failed read as a valid empty result", async () => {
    const result = await runCustomerEvidenceLoop({
      initialReadToolResults: [
        {
          toolName: "searchInteractions",
          result: null,
          error: "permission denied",
        },
      ],
      assessEvidence: async () => ({
        status: "no_results",
        missingQueries: [],
      }),
    });

    expect(result).toMatchObject({
      status: "query_error",
      errorCode: "read_query_failed",
    });
  });

  it("keeps snapshot query failures separate from tool budgets and reports them", async () => {
    const result = await runCustomerEvidenceLoop({
      initialReadToolResults: [],
      initialQueryErrors: [{ source: "contacts" }],
      assessEvidence: async () => ({
        status: "no_results",
        missingQueries: [],
      }),
    });

    expect(result).toMatchObject({
      status: "query_error",
      errorCode: "read_query_failed",
      failedSources: ["contacts"],
      additionalReadQueries: 0,
    });
  });

  it("does not accept sufficient when the successful read contains no evidence", async () => {
    const result = await runCustomerEvidenceLoop({
      initialReadToolResults: [{ toolName: "searchInteractions", result: [] }],
      assessEvidence: async () => ({
        status: "sufficient",
        missingFacts: [],
        missingQueries: [],
      }),
    });

    expect(result).toMatchObject({
      status: "insufficient_evidence",
      errorCode: null,
    });
  });

  it("does not accept no_results until at least one authorized read succeeded", async () => {
    const result = await runCustomerEvidenceLoop({
      initialReadToolResults: [],
      assessEvidence: async () => ({
        status: "no_results",
        missingQueries: [],
      }),
    });

    expect(result).toMatchObject({
      status: "insufficient_evidence",
      errorCode: "no_authorized_queries_executed",
    });
  });

  it("rejects sufficient when the verifier still lists missing facts", async () => {
    const result = await runCustomerEvidenceLoop({
      initialReadToolResults: [
        { toolName: "getOpportunity", result: { id: 11, stage: "desarrollo" } },
      ],
      assessEvidence: async () => ({
        status: "sufficient",
        missingFacts: ["actividades pendientes"],
        missingQueries: [],
      }),
    });

    expect(result).toMatchObject({
      status: "insufficient_evidence",
      missingFacts: ["actividades pendientes"],
    });
  });

  it("stops immediately for a clarification and does not fetch tools", async () => {
    const fetchAdditionalEvidence = vi.fn();
    const traceEvents = [];
    const result = await runCustomerEvidenceLoop({
      assessEvidence: async () => ({
        status: "clarification",
        clarificationQuestion: "¿Cuál de las dos oportunidades?",
      }),
      fetchAdditionalEvidence,
      onTraceEvent: (event) => traceEvents.push(event),
    });

    expect(result).toMatchObject({
      status: "clarification",
      clarificationQuestion: "¿Cuál de las dos oportunidades?",
    });
    expect(fetchAdditionalEvidence).not.toHaveBeenCalled();
    expect(
      traceEvents.some((event) => event.from === "B9" && event.to === "B7"),
    ).toBe(false);
  });

  it("honors the maximum evidence rounds", async () => {
    const assessEvidence = vi.fn().mockResolvedValue({
      status: "incomplete",
      missingQueries: ["opportunity_query"],
    });
    const fetchAdditionalEvidence = vi
      .fn()
      .mockResolvedValueOnce({
        readToolResults: [{ toolName: "searchOpportunities", result: [] }],
      })
      .mockResolvedValueOnce({
        readToolResults: [{ toolName: "searchContacts", result: [] }],
      });

    const result = await runCustomerEvidenceLoop({
      initialReadToolResults: [{ toolName: "searchAccounts", result: [] }],
      assessEvidence,
      fetchAdditionalEvidence,
    });

    expect(result.status).toBe("insufficient_evidence");
    expect(result.rounds).toBe(CUSTOMER_CHAT_EVIDENCE_LIMITS.maxRounds);
    expect(assessEvidence).toHaveBeenCalledTimes(
      CUSTOMER_CHAT_EVIDENCE_LIMITS.maxRounds + 1,
    );
  });

  it("rejects an initial read batch that already exceeds the total query cap", async () => {
    const assessEvidence = vi.fn();
    const initialReadToolResults = Array.from(
      { length: CUSTOMER_CHAT_EVIDENCE_LIMITS.maxReadQueries + 1 },
      (_, index) => ({ toolName: `tool-${index}`, result: [{ id: index }] }),
    );
    const result = await runCustomerEvidenceLoop({
      initialReadToolResults,
      assessEvidence,
    });

    expect(result).toMatchObject({
      status: "query_limit_reached",
      errorCode: "read_query_limit_reached",
    });
    expect(result.readToolResults).toHaveLength(
      CUSTOMER_CHAT_EVIDENCE_LIMITS.maxReadQueries,
    );
    expect(assessEvidence).not.toHaveBeenCalled();
  });

  it("does not claim sufficient evidence when authorized sources were skipped by the cap", async () => {
    const result = await runCustomerEvidenceLoop({
      initialReadToolResults: [
        { toolName: "getOpportunity", result: { id: 11 } },
      ],
      unqueriedAuthorizedTools: ["searchInteractions"],
      assessEvidence: async () => ({
        status: "sufficient",
        missingQueries: [],
        missingFacts: [],
      }),
    });

    expect(result).toMatchObject({
      status: "query_limit_reached",
      errorCode: "read_query_limit_reached",
      unqueriedAuthorizedTools: ["searchInteractions"],
    });
  });

  it("stops when the whole turn deadline has elapsed", async () => {
    const assessEvidence = vi.fn();
    const result = await runCustomerEvidenceLoop({
      deadlineAt: 5,
      now: () => 5,
      assessEvidence,
    });

    expect(result).toMatchObject({
      status: "timeout",
      errorCode: "turn_timeout",
    });
    expect(assessEvidence).not.toHaveBeenCalled();
  });

  it("times out a verifier that does not resolve before the remaining deadline", async () => {
    const result = await runCustomerEvidenceLoop({
      deadlineAt: Date.now() + 5,
      assessEvidence: () => new Promise(() => {}),
    });

    expect(result).toMatchObject({
      status: "timeout",
      errorCode: "turn_timeout",
    });
  });
});
