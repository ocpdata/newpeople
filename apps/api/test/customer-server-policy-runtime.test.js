import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/commercial-intelligence/customer-target-validation.js", async (original) => ({
  ...(await original()), validateCustomerPlanTarget: vi.fn(),
}));
import { validateCustomerPlanTarget } from "../src/commercial-intelligence/customer-target-validation.js";
vi.mock("../src/structuredWebResearch.js", () => ({ runStructuredTextResearch: vi.fn() }));
vi.mock("../src/coach/planner-prompts.js", async (original) => ({
  ...(await original()), loadPlannerPrompt: vi.fn(),
}));
vi.mock("../src/coach/quotation-read-service.js", () => ({ getAuthorizedCoachQuotationContent: vi.fn() }));
vi.mock("../src/coach/business-rules.js", async (original) => ({
  ...(await original()), loadCoachBusinessRules: vi.fn(),
}));
vi.mock("../src/coach/admin-rules.js", () => ({ listCoachAdminRules: vi.fn() }));
vi.mock("../src/coach/channel-intent-governance.js", () => ({ loadChannelIntentConfigurations: vi.fn() }));
import { runStructuredTextResearch } from "../src/structuredWebResearch.js";
import { loadPlannerPrompt } from "../src/coach/planner-prompts.js";
import { getAuthorizedCoachQuotationContent } from "../src/coach/quotation-read-service.js";
import { getCoachBusinessRules, loadCoachBusinessRules } from "../src/coach/business-rules.js";
import { listCoachAdminRules } from "../src/coach/admin-rules.js";
import { loadChannelIntentConfigurations } from "../src/coach/channel-intent-governance.js";
import { getChannelIntentDefaults } from "../src/coach/channel-intents.js";
import {
  buildCustomerIntentResponse, buildCustomerReadModel, createCustomerAccountAdapter,
} from "../src/commercial-intelligence/customer-chat-adapter.js";
import { getCustomerEvidenceLimits } from "../src/coach/server-policy.js";
import { runCustomerEvidenceLoop } from "../src/commercial-intelligence/customer-chat-evidence.js";

const first = { id: 11, accountId: 7, name: "Vrf 2027", amountUsd: 2000000, lifecycle: "open", commercialStatusCode: "en_proceso", closeDate: "2027-05-01" };
const second = { ...first, id: 12, name: "DNS 2027", amountUsd: 40000 };
const historical = { ...first, id: 13, name: "Vrf 2025", lifecycle: "historical", commercialStatusCode: "ganada" };
const snapshot = {
  account: { id: 7, name: "Totalplay" }, opportunities: [first, second],
  inactiveOpportunities: [historical], selectedOpportunity: first,
  contacts: [], interactions: [], activities: [],
};
const permissions = new Set(["cuentas.read", "oportunidades.read", "oportunidades.update"]);
function amountResponse(question, extra = {}) {
  return buildCustomerIntentResponse({
    snapshot, question, routing: { intent: "crm_operation" }, permissions,
    allowedOperationKinds: ["opportunity_field"], ...extra,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  validateCustomerPlanTarget.mockResolvedValue({ status: "aligned", reason: "", references: [] });
  loadCoachBusinessRules.mockResolvedValue({
    ...getCoachBusinessRules({ channel: "customer_account" }), serverRulesVersion: 7,
  });
  listCoachAdminRules.mockResolvedValue([]);
  loadChannelIntentConfigurations.mockResolvedValue(getChannelIntentDefaults("customer_account"));
  loadPlannerPrompt.mockResolvedValue({ channel: "customer_account", version: 0, instruction: "Prioriza las lecturas" });
  runStructuredTextResearch.mockImplementation(async (input) => {
    if (input.schemaName === "customer_account_query_plan") return {
      objective: "Cambiar monto", queries: ["crm_operation"],
      entities: { opportunityReference: "Vrf 2027" }, filters: {},
      referenceResolution: { targetType: "opportunity", cardinality: "single", source: "message", candidateKeys: ["opportunity_1"] },
      mode: "operation", confidence: "high",
      ambiguity: { reason: "none", requiresClarification: "no", missingContext: [], question: "" },
    };
    if (input.schemaName === "customer_account_evidence_assessment") return { status: "sufficient", missingQueries: [], missingFacts: [] };
    if (input.schemaName === "customer_account_answer_audit") return { status: "supported", targetStatus: "aligned", unsupportedClaims: [] };
    throw new Error(`Unexpected AI call: ${input.schemaName}`);
  });
});

describe("Customer server policies at runtime", () => {
  it.each(["que oportunidades hay abiertas?", "¿Cuánto suman las oportunidades abiertas?"])(
    "runs the real target guard and answers a collection without inheriting Vrf: %s", async (question) => {
      const actual = await vi.importActual("../src/commercial-intelligence/customer-target-validation.js");
      validateCustomerPlanTarget.mockImplementationOnce(actual.validateCustomerPlanTarget);
      runStructuredTextResearch.mockImplementation(async (request) => {
        if (request.schemaName === "customer_account_query_plan") return {
          queries: ["opportunity_query"], mode: "read_only", confidence: "high",
          entities: { accountReference: "Totalplay", opportunityReference: "" },
          filters: { opportunityStatus: "open" },
          referenceResolution: { targetType: "account", cardinality: "single", source: "active_context", candidateKeys: [] },
          ambiguity: { reason: "none", requiresClarification: "no" },
        };
        if (request.schemaName === "customer_account_target_validation") {
          expect(request.context.question).toBe(question);
          expect(request.context.proposedPlan.filters).toEqual({ opportunityStatus: "open" });
          return {
            status: "aligned", reason: "Consulta del conjunto de oportunidades abiertas de la cuenta seleccionada",
            references: [{ text: question, kind: "collection", entityType: "opportunity", candidateKeys: [] }],
          };
        }
        if (request.schemaName === "customer_account_evidence_assessment") {
          const opportunities = request.context.evidence
            .find((tool) => tool.toolName === "searchOpportunities").result;
          expect(opportunities.map((item) => item.id).sort()).toEqual([11, 12]);
          return { status: "sufficient", missingQueries: [], missingFacts: [] };
        }
        if (request.schemaName === "account_contextual_chat") return {
          answer: "Vrf 2027 y DNS 2027 están abiertas. Suman 2,040,000 USD.",
          evidence: ["Vrf 2027: 2000000 USD", "DNS 2027: 40000 USD"], confidence: "high", operations: [],
        };
        if (request.schemaName === "customer_account_answer_audit") return {
          status: "supported", targetStatus: "aligned", unsupportedClaims: [],
        };
        throw new Error(`Unexpected schema: ${request.schemaName}`);
      });
      const result = await createCustomerAccountAdapter({
        user: { id: 31, permissionSet: permissions }, snapshot, agents: [], jobId: 366,
        authoritativeIntent: { intent: "opportunity_query", confidence: 0.95 },
        conversationContext: { accountId: 7, opportunityId: 11, intents: ["opportunity_query"] },
      }).runTurn({
        question, context: { accountId: 7 },
        history: [{ role: "assistant", text: "Vrf 2027 tiene un monto de 2,000,000 USD." }],
      });
      expect(result.response.responseType).not.toMatch(/clarification|error/);
      expect(result.response.answer).toContain("DNS 2027");
      expect(result.response.operations).toEqual([]);
      expect(result.channelIntentRouting.serverResolvedEntityIds.opportunityId).toBeNull();
      expect(result.qualityTrace.diagnostics.targetValidation).toMatchObject({
        status: "aligned", references: [{ kind: "collection" }],
      });
      expect(runStructuredTextResearch.mock.calls.map(([request]) => request.schemaName))
        .toEqual(["customer_account_query_plan", "customer_account_target_validation",
          "customer_account_evidence_assessment", "account_contextual_chat", "customer_account_answer_audit"]);
    },
  );

  it("runs the independent verifier on the original request and blocks the incorrect B6 plan", async () => {
    const actual = await vi.importActual("../src/commercial-intelligence/customer-target-validation.js");
    validateCustomerPlanTarget.mockImplementationOnce(actual.validateCustomerPlanTarget);
    runStructuredTextResearch.mockImplementation(async (request) => {
      if (request.schemaName === "customer_account_query_plan") return {
        queries: ["opportunity_query"], mode: "read_only", confidence: "high",
        entities: { accountReference: "Totalplay" },
        referenceResolution: { targetType: "account", cardinality: "single", source: "active_context", candidateKeys: [] },
        ambiguity: { reason: "none", requiresClarification: "no" },
      };
      if (request.schemaName === "customer_account_target_validation") {
        expect(request.context.question).toContain("Grupo Nébula");
        expect(request.context.proposedPlan.entities.accountReference).toBe("Totalplay");
        return {
          status: "mismatch", reason: "B6 sustituyó Grupo Nébula por Totalplay",
          references: [{ text: "Grupo Nébula", kind: "entity", entityType: "account", candidateKeys: [] }],
        };
      }
      throw new Error(`Unexpected schema: ${request.schemaName}`);
    });
    const result = await createCustomerAccountAdapter({
      user: { id: 31, permissionSet: permissions }, snapshot, agents: [], jobId: 364,
    }).runTurn({
      question: "Busca la oportunidad de Grupo Nébula y dime su monto.",
      context: { accountId: 7 }, history: [{ role: "assistant", text: "Vrf 2027 tiene un monto de 2,000,000 USD." }],
    });
    expect(result.response.responseType).toBe("clarification");
    expect(result.response.answer).toContain("Grupo Nébula");
    expect(result.response.operations).toEqual([]);
    expect(result.qualityTrace.toolMetrics).toEqual([]);
    expect(result.qualityTrace.diagnostics.targetValidation.status).toBe("mismatch");
    expect(runStructuredTextResearch.mock.calls.map(([request]) => request.schemaName))
      .toEqual(["customer_account_query_plan", "customer_account_target_validation"]);
  });

  it.each(["other_account", "ambiguous", "mismatch"])(
    "blocks Grupo Nébula before CRM reads even when B6 selects Totalplay (%s)", async (status) => {
      validateCustomerPlanTarget.mockResolvedValueOnce({
        status, reason: "explicit_target_replaced",
        references: [{ text: "Grupo Nébula", entityType: "account", candidateKeys: [] }],
      });
      const result = await createCustomerAccountAdapter({
        user: { id: 31, permissionSet: permissions }, snapshot, agents: [], jobId: 364,
        authoritativeIntent: { intent: "opportunity_query", confidence: 0.95 },
        conversationContext: { accountId: 7, opportunityId: 11, intents: ["opportunity_query"] },
      }).runTurn({
        question: "Busca la oportunidad de Grupo Nébula y dime su monto.",
        context: { accountId: 7 },
        history: [{ role: "assistant", text: "Vrf 2027 tiene un monto de 2,000,000 USD." }],
      });
      expect(result.response.responseType).toBe("clarification");
      expect(result.response.operations).toEqual([]);
      expect(result.response.answer).not.toContain("2,000,000");
      expect(result.qualityTrace.toolMetrics).toEqual([]);
      expect(result.qualityTrace.diagnostics.targetValidation.status).toBe(status);
      expect(runStructuredTextResearch.mock.calls.map(([request]) => request.schemaName))
        .toEqual(["customer_account_query_plan"]);
      expect(result.qualityTrace.diagnostics.serverRules.decisions).toContainEqual({
        ruleId: "plan-target-correspondence", outcome: status,
      });
    },
  );

  it("fails closed when independent target validation is unavailable", async () => {
    validateCustomerPlanTarget.mockRejectedValueOnce(new Error("Target verifier unavailable"));
    const result = await createCustomerAccountAdapter({
      user: { id: 31, permissionSet: permissions }, snapshot, agents: [], jobId: 365,
    }).runTurn({ question: "Dime el monto de Vrf 2027", context: { accountId: 7 }, history: [] });
    expect(result.response.answer).toContain("No consulté el CRM");
    expect(result.response.operations).toEqual([]);
    expect(result.qualityTrace.diagnostics.targetValidation.status).toBe("unavailable");
    expect(result.qualityTrace.toolMetrics).toEqual([]);
  });

  it("records provider HTTP failure without exposing the provider response", async () => {
    validateCustomerPlanTarget.mockRejectedValueOnce(new Error(
      "OpenAI web search failed: 400 private provider response",
    ));
    const result = await createCustomerAccountAdapter({
      user: { id: 31, permissionSet: permissions }, snapshot, agents: [], jobId: 367,
    }).runTurn({ question: "que oportunidades hay abiertas?", context: { accountId: 7 }, history: [] });
    expect(result.qualityTrace.diagnostics.targetValidation).toMatchObject({
      status: "unavailable", reason: "target_provider_http_400",
    });
    expect(result.qualityTrace.toolMetrics).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("private provider response");
  });

  it.each(["mismatch", "inconclusive", undefined])(
    "blocks a factually supported answer whose target is not approved (%s)", async (targetStatus) => {
      runStructuredTextResearch.mockImplementation(async (request) => {
        if (request.schemaName === "customer_account_query_plan") return {
          queries: ["opportunity_query"], mode: "read_only", confidence: "high",
          entities: { opportunityReference: "DNS 2027" }, filters: {},
          referenceResolution: { targetType: "opportunity", cardinality: "single", source: "message", candidateKeys: ["opportunity_1"] },
          ambiguity: { reason: "none", requiresClarification: "no" },
        };
        if (request.schemaName === "customer_account_evidence_assessment") {
          expect(request.context.validatedTarget.status).toBe("aligned");
          return { status: "sufficient", missingQueries: [], missingFacts: [] };
        }
        if (request.schemaName === "account_contextual_chat") return {
          answer: "Vrf 2027 tiene un monto de 2,000,000 USD.",
          evidence: ["Vrf 2027: 2000000 USD"], confidence: "high", operations: [],
        };
        if (request.schemaName === "customer_account_answer_audit") {
          expect(request.context.question).toBe("Dime el monto de DNS 2027");
          expect(request.systemPrompt).toContain("Un dato verdadero sobre otra entidad");
          return { status: "supported", targetStatus, unsupportedClaims: [] };
        }
        throw new Error(`Unexpected schema: ${request.schemaName}`);
      });
      const result = await createCustomerAccountAdapter({
        user: { id: 31, permissionSet: permissions }, snapshot, agents: [], jobId: 366,
      }).runTurn({ question: "Dime el monto de DNS 2027", context: { accountId: 7 }, history: [] });
      expect(result.response.responseType).toBe("error");
      expect(result.response.answer).not.toContain("2,000,000");
      expect(result.response.operations).toEqual([]);
      expect(result.qualityTrace.diagnostics.fallback.reasonCode)
        .toBe(targetStatus === "mismatch" ? "answer_target_mismatch" : "answer_target_unverified");
    },
  );

  it.each(["Actualiza el monto de las oportunidades abiertas de Totalplay a 1000000",
    "Cambia el monto de ambas oportunidades a 1000000",
    "Actualiza el monto de oportunidades de Totalplay a 1000000"])(
    "never chooses the selected opportunity for a collection (%s)", (question) => {
      const response = amountResponse(question, {
        snapshot: { ...snapshot, opportunities: [...snapshot.opportunities, { ...first, id: 99, accountId: 99 }] },
      });
      expect(response.operations).toEqual([]);
      expect(response.answer).toContain("una oportunidad a la vez");
      expect(response.clarification.pendingAmountSelection.amount).toBe(1000000);
      if (question.includes("abiertas")) {
        expect(response.clarification.pendingAmountSelection.candidateIds).toEqual([11, 12]);
      }
      expect(response.clarification.candidates.map((item) => item.id)).not.toContain(99);
    },
  );
  it("enforces plural clarification even if B6 incorrectly chooses a single selected record", async () => {
    const adapter = createCustomerAccountAdapter({ user: { id: 31, permissionSet: permissions }, snapshot, agents: [], jobId: 1 });
    const result = await adapter.runTurn({
      question: "Actualiza el monto de las oportunidades abiertas de Totalplay a 1000000",
      context: { accountId: 7, opportunityId: 11 }, history: [],
    });
    expect(result.response.operations).toEqual([]);
    expect(result.response.answer).toContain("una oportunidad a la vez");
    expect(runStructuredTextResearch).toHaveBeenCalledTimes(1);
    expect(result.qualityTrace.appliedRules.serverRulesVersion).toBe(7);
    expect(result.qualityTrace.appliedRules.decisions).toContainEqual({
      ruleId: "single-operation-target", outcome: "clarification",
    });
  });
  it("uses the selected fallback only when enabled and preserves explicit single-record changes", () => {
    expect(amountResponse("Actualiza el monto de esta oportunidad a 1000000").operations).toHaveLength(1);
    const businessRules = getCoachBusinessRules({
      channel: "customer_account", overrides: { serverPolicy: { selectedOpportunityFallback: "require_explicit" } },
    });
    expect(amountResponse("Actualiza el monto de esta oportunidad a 1000000", { businessRules }).operations).toEqual([]);
    expect(amountResponse("Actualiza el monto de Vrf 2027 a 1000000", { businessRules }).operations[0].opportunityId).toBe(11);
    expect(amountResponse("Actualiza el monto de Vrf 2027 a 1000000", {
      snapshot: { ...snapshot, opportunities: [first, { ...first, id: 12 }] },
    }).operations).toEqual([]);
    expect(amountResponse("Actualiza el monto de la oportunidad inexistente a 1000000", {
      routing: {
        intent: "crm_operation", entities: { opportunityReference: "inexistente" },
        serverResolvedEntityIds: { opportunityId: 11 },
      },
    }).operations).toEqual([]);
  });
  it("retains amount and open scope while selecting one candidate and rejects historical/foreign targets", () => {
    const pending = amountResponse("Actualiza el monto de las oportunidades abiertas a 1000000").clarification.pendingAmountSelection;
    const response = amountResponse("DNS 2027", { pendingAmountSelection: pending });
    expect(response.operations).toEqual([expect.objectContaining({
      opportunityId: 12, value: 1000000, requiresConfirmation: true,
    })]);
    for (const question of ["Vrf 2025", "No existe", "Consulta actividades de DNS 2027"]) {
      const result = amountResponse(question, { pendingAmountSelection: pending });
      expect(result?.operations || []).toEqual([]);
    }
    expect(amountResponse("DNS 2027", { pendingAmountSelection: { ...pending, accountId: 99 } })).toBeNull();
  });
  it.each(["operation", "read_only"])("continues a name-only selection even if B6 proposes %s, through evidence and audit", async (mode) => {
    const pending = amountResponse("Actualiza el monto de las oportunidades abiertas a 1000000").clarification.pendingAmountSelection;
    const adapter = createCustomerAccountAdapter({
      user: { id: 31, permissionSet: permissions }, snapshot, agents: [], jobId: 2,
    });
    const originalAi = runStructuredTextResearch.getMockImplementation();
    runStructuredTextResearch.mockImplementation(async (input) => {
      const result = await originalAi(input);
      if (input.schemaName === "customer_account_query_plan") {
        return { ...result, mode, queries: mode === "read_only" ? ["opportunity_query"] : result.queries };
      }
      return result;
    });
    const result = await adapter.runTurn({
      question: "Vrf 2027", context: { accountId: 7 }, history: [],
      conversationContext: { accountId: 7, intents: ["crm_operation"], filters: pending.filters, pendingAmountSelection: pending },
    });
    expect(result.response.operations).toEqual([expect.objectContaining({ opportunityId: 11, value: 1000000 })]);
    const audit = runStructuredTextResearch.mock.calls.find(([input]) => input.schemaName === "customer_account_answer_audit")[0];
    expect(audit.context.validatedAmountSelection).toMatchObject({ amount: 1000000, filters: { opportunityStatus: "open" } });
    expect(result.qualityTrace.appliedRules.decisions).toContainEqual({ ruleId: "answer-audit", outcome: "supported" });
    const planner = runStructuredTextResearch.mock.calls.find(([input]) => input.schemaName === "customer_account_query_plan")[0];
    expect(planner.context.pendingAmountSelection).toMatchObject({
      amount: 1000000, candidateKeys: expect.arrayContaining(["opportunity_1"]),
    });
  });
  it("does not treat a question mentioning a pending candidate as a selection or operation", () => {
    const pending = amountResponse("Actualiza el monto de las oportunidades abiertas a 1000000").clarification.pendingAmountSelection;
    expect(amountResponse("¿Cómo va Vrf 2027?", { pendingAmountSelection: pending })).toBeNull();
    expect(amountResponse("Muestra Vrf 2027", { pendingAmountSelection: pending })).toBeNull();
  });
  it("enforces initial and remaining read budgets before executing any additional reads", async () => {
    const businessRules = getCoachBusinessRules({ channel: "customer_account", overrides: { serverPolicy: { maxReadQueries: 1 } } });
    const input = {
      user: { id: 31 }, snapshot, question: "Muestra oportunidades y contactos",
      businessRules, availableTools: [{ name: "searchOpportunities" }, { name: "searchContacts" }],
      channelIntentRouting: { intent: "opportunity_query", allowedTools: ["searchOpportunities", "searchContacts"], filters: {} },
    };
    const initial = await buildCustomerReadModel(input);
    expect(initial.readToolResults).toHaveLength(1);
    expect(initial.modelSnapshot.readQueryCount).toBe(1);
    expect(initial.modelSnapshot.skippedAuthorizedTools).toContain("searchContacts");
    const exhausted = await buildCustomerReadModel({ ...input, readQueryBudget: 0 });
    expect(exhausted.readToolResults).toEqual([]);
    expect(exhausted.modelSnapshot.readQueryCount).toBe(0);
    const quote = await buildCustomerReadModel({
      ...input, question: "Cotización", readQueryBudget: 0,
      availableTools: [{ name: "getOpportunityQuotation" }],
      channelIntentRouting: { allowedTools: ["getOpportunityQuotation"], filters: {} },
    });
    expect(quote.readToolResults).toEqual([]);
    expect(getAuthorizedCoachQuotationContent).not.toHaveBeenCalled();
  });
  it("connects the configured number of evidence rounds and the deadline to fail-closed outcomes", async () => {
    const limits = getCustomerEvidenceLimits(getCoachBusinessRules({
      channel: "customer_account", overrides: { serverPolicy: { maxEvidenceRounds: 0, maxTurnMs: 5000 } },
    }));
    const fetchAdditionalEvidence = vi.fn();
    const result = await runCustomerEvidenceLoop({
      limits, initialReadToolResults: [{ toolName: "searchOpportunities", result: [first] }],
      assessEvidence: async () => ({ status: "incomplete", missingQueries: ["contact_query"] }),
      fetchAdditionalEvidence,
    });
    expect(result.status).not.toBe("sufficient");
    expect(result.rounds).toBe(0);
    expect(fetchAdditionalEvidence).not.toHaveBeenCalled();
    const deadlineResult = await runCustomerEvidenceLoop({
      limits, deadlineAt: 5000, now: () => 5001,
      assessEvidence: vi.fn(), fetchAdditionalEvidence,
    });
    expect(deadlineResult.errorCode).toBe("turn_timeout");
  });
  it("enforces the configured deadline during an initial quotation read and retains the active version for error tracing", async () => {
    vi.useFakeTimers();
    try {
      loadCoachBusinessRules.mockResolvedValue({
        ...getCoachBusinessRules({
          channel: "customer_account", overrides: { serverPolicy: { maxTurnMs: 5000 } },
        }), serverRulesVersion: 9,
      });
      runStructuredTextResearch.mockResolvedValue({
        queries: ["quotation_query"], mode: "read_only", confidence: "high",
        entities: { opportunityReference: "Vrf 2027" }, filters: {},
        referenceResolution: { targetType: "opportunity", cardinality: "single", source: "message", candidateKeys: ["opportunity_1"] },
        ambiguity: { reason: "none", requiresClarification: "no", missingContext: [], question: "" },
      });
      getAuthorizedCoachQuotationContent.mockImplementation(() => new Promise(() => {}));
      const adapter = createCustomerAccountAdapter({
        user: { id: 31, permissionSet: new Set([...permissions, "cotizaciones.operacion"]) },
        snapshot, agents: [], jobId: 5,
      });
      const turn = adapter.runTurn({ question: "Consulta la cotización de Vrf 2027", context: { accountId: 7 }, history: [] });
      const assertion = expect(turn).rejects.toMatchObject({ code: "CUSTOMER_CHAT_TURN_TIMEOUT" });
      await vi.advanceTimersByTimeAsync(5001);
      await assertion;
      expect(getAuthorizedCoachQuotationContent).toHaveBeenCalledTimes(1);
      expect(adapter.getTurnDiagnostics().serverRules).toMatchObject({
        version: 9, policy: { maxTurnMs: 5000 },
      });
    } finally {
      vi.useRealTimers();
    }
  });
  it("keeps Coach and prospect policies unchanged and disconnected", () => {
    for (const channel of ["coach", "prospect"]) {
      expect(getCoachBusinessRules({
        channel, overrides: { serverPolicy: { maxReadQueries: 1, selectedOpportunityFallback: "require_explicit" } },
      }).serverPolicy).toBeUndefined();
    }
  });
});
