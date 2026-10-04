import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/coach/quotation-read-service.js", () => ({
  getAuthorizedCoachQuotationContent: vi.fn(),
}));

import { getAuthorizedCoachQuotationContent } from "../src/coach/quotation-read-service.js";
import { getCoachBusinessRules } from "../src/coach/business-rules.js";
import { getCoachReadToolCatalog } from "../src/coach/read-tools.js";
import {
  getChannelIntentDefaults,
  normalizeChannelIntentPlan,
} from "../src/coach/channel-intents.js";
import {
  buildCustomerIntentResponse,
  buildCustomerQuotationResponse,
  buildCustomerReadModel,
} from "../src/commercial-intelligence/customer-chat-adapter.js";
import { buildCustomerEvidenceFailureResponse } from "../src/commercial-intelligence/customer-chat-adapter.js";
import { getCustomerActivityHistoryRange } from "../src/commercial-intelligence/activity-history.js";
import {
  CUSTOMER_ACCOUNT_CHAT_EVALUATION_CASES,
  CUSTOMER_ACCOUNT_CHAT_EVALUATION_FIXTURE,
  CUSTOMER_ACCOUNT_CHAT_PERIOD_CASES,
  CUSTOMER_ACCOUNT_CHAT_EVALUATION_VERSION,
  createCustomerAccountChatEvaluationSnapshot,
} from "./fixtures/customer-account-chat-evaluation-v1.js";

const completeToolCatalog = [
  ...getCoachReadToolCatalog(),
  { name: "searchInteractions", requiredPermission: "interacciones.read" },
];

function getScenario(scenarioId) {
  return CUSTOMER_ACCOUNT_CHAT_EVALUATION_CASES.find(
    (item) => item.id === scenarioId,
  );
}

function getAvailableTools(scenario) {
  if (!scenario.baseline.availableTools) return completeToolCatalog;
  const permitted = new Set(scenario.baseline.availableTools);
  return completeToolCatalog.filter((tool) => permitted.has(tool.name));
}

function readOnlyPlan(queries, { entities = {}, filters = {} } = {}) {
  return {
    objective: "Evaluación sintética de consulta CRM",
    queries,
    entities,
    filters,
    ambiguity: {
      reason: "none",
      requiresClarification: "no",
      missingContext: [],
      question: "",
    },
    mode: "read_only",
    confidence: "high",
  };
}

const SYNTHETIC_STRUCTURED_PLANS = {
  "CAC-READ-001": readOnlyPlan(["account_overview"], {
    entities: { accountReference: "Comercial Lumen" },
  }),
  "CAC-READ-002": readOnlyPlan(["opportunity_query"], {
    filters: { opportunityStatus: "open" },
  }),
  "CAC-READ-003": readOnlyPlan(["opportunity_status"], {
    entities: { opportunityReference: "Modernización Atlas" },
  }),
  "CAC-READ-004": readOnlyPlan(["contact_history"]),
  "CAC-READ-005": readOnlyPlan(["account_activity_history"], {
    filters: { periodMonths: 6 },
  }),
  "CAC-READ-006": readOnlyPlan(["quotation_query"], {
    entities: { opportunityReference: "Modernización Atlas" },
  }),
  "CAC-OP-001": {
    ...readOnlyPlan(["crm_operation"], {
      entities: { opportunityReference: "Modernización Atlas" },
    }),
    mode: "operation",
  },
  "CAC-SAFE-001": readOnlyPlan(["opportunity_query"], {
    filters: { opportunityStatus: "open" },
  }),
  "CAC-SAFE-002": readOnlyPlan(["contact_history"]),
};

async function evaluateScenario(scenario) {
  const snapshot = createCustomerAccountChatEvaluationSnapshot(
    scenario.fixtureOverrides,
  );
  if (scenario.id === "CAC-READ-006") {
    getAuthorizedCoachQuotationContent.mockResolvedValue(
      snapshot.quotations[0] || null,
    );
  }
  const availableTools = getAvailableTools(scenario);
  const plan =
    scenario.structuredPlan || SYNTHETIC_STRUCTURED_PLANS[scenario.id];
  if (!plan) throw new Error(`Missing synthetic plan for ${scenario.id}`);
  const selectedRouting = normalizeChannelIntentPlan({
    channel: "customer_account",
    plan,
    availableTools,
    context: scenario.context,
    configuration: getChannelIntentDefaults("customer_account"),
    question: scenario.question,
    conversationHistory: scenario.history || [],
  });
  const routedTools = availableTools.filter((tool) =>
    selectedRouting.allowedTools.includes(tool.name),
  );
  const model = await buildCustomerReadModel({
    user: { id: 31 },
    question: scenario.question,
    snapshot,
    availableTools: routedTools,
    conversationHistory: scenario.history || [],
    businessRules: getCoachBusinessRules({ channel: "customer_account" }),
    channelIntentRouting: selectedRouting,
    channelIntentCatalog: getChannelIntentDefaults("customer_account"),
  });
  return {
    routing: selectedRouting,
    model,
    snapshot,
  };
}

function resultIds(readToolResult) {
  const result = readToolResult?.result;
  if (Array.isArray(result)) return result.map((item) => Number(item.id));
  if (Number(result?.id)) return [Number(result.id)];
  if (Array.isArray(result?.opportunities)) {
    return result.opportunities.map((item) => Number(item.id));
  }
  return [];
}

describe("synthetic Customer Existing chat evaluation corpus", () => {
  beforeEach(() => vi.clearAllMocks());

  it("has a versioned, deterministic CRM fixture with isolated account records", () => {
    expect(CUSTOMER_ACCOUNT_CHAT_EVALUATION_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(CUSTOMER_ACCOUNT_CHAT_EVALUATION_FIXTURE.selectedAccount.id).toBe(
      7001,
    );
    expect(
      CUSTOMER_ACCOUNT_CHAT_EVALUATION_FIXTURE.opportunities.some(
        (item) => item.accountId === 8001,
      ),
    ).toBe(true);
    expect(
      CUSTOMER_ACCOUNT_CHAT_EVALUATION_FIXTURE.contacts.some(
        (item) => item.accountId === 8001,
      ),
    ).toBe(true);
    expect(
      CUSTOMER_ACCOUNT_CHAT_EVALUATION_FIXTURE.interactions.some(
        (item) => item.accountId === 8001,
      ),
    ).toBe(true);
  });

  it("covers query, security, ambiguity, continuity and response-limit dimensions", () => {
    const categories = new Set(
      CUSTOMER_ACCOUNT_CHAT_EVALUATION_CASES.map((item) => item.category),
    );
    const ids = CUSTOMER_ACCOUNT_CHAT_EVALUATION_CASES.map((item) => item.id);
    const requiredCategories = [
      "account_overview",
      "opportunity_list",
      "opportunity_status",
      "contact_history",
      "activity_history_period",
      "quotation_contents",
      "opportunity_amount_proposal",
      "account_isolation",
      "tool_permission_filter",
      "compound_question",
      "follow_up_reference",
      "ambiguous_entity",
      "foreign_account_request",
      "empty_result",
      "truncated_result",
      "out_of_scope_support",
      "public_research_opt_in",
      "language_paraphrase",
    ];

    expect(new Set(ids).size).toBe(ids.length);
    expect([...categories]).toEqual(expect.arrayContaining(requiredCategories));
    expect(CUSTOMER_ACCOUNT_CHAT_EVALUATION_CASES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expect.any(String),
          question: expect.any(String),
          baseline: expect.objectContaining({ status: expect.any(String) }),
          target: expect.objectContaining({ behavior: expect.any(String) }),
        }),
      ]),
    );
  });

  it.each(
    CUSTOMER_ACCOUNT_CHAT_EVALUATION_CASES.filter(
      (scenario) =>
        scenario.baseline.status === "covered" && scenario.baseline.intent,
    ).map((scenario) => [scenario.id, scenario]),
  )("measures deterministic baseline for %s", async (_scenarioId, scenario) => {
    const { routing, model } = await evaluateScenario(scenario);

    expect(routing).toMatchObject({
      intent: scenario.baseline.intent,
      ...(scenario.baseline.mode ? { mode: scenario.baseline.mode } : {}),
      allowedTools: scenario.baseline.allowedTools,
    });
    expect(model.readToolResults.map((result) => result.toolName)).toEqual(
      scenario.baseline.readTools,
    );

    for (const [toolName, expectedIds] of Object.entries(
      scenario.baseline.evidenceIds || {},
    )) {
      const toolResult = model.readToolResults.find(
        (result) => result.toolName === toolName,
      );
      expect(
        toolResult,
        `${scenario.id} should execute ${toolName}`,
      ).toBeTruthy();
      expect(resultIds(toolResult)).toEqual(expectedIds);
      if (scenario.id === "CAC-READ-006") {
        expect(toolResult.result.sections[0].items[0].description).toBe(
          "Implementación inicial",
        );
      }
    }
  });

  it("keeps other-account records out of the evaluated snapshot", async () => {
    const { model } = await evaluateScenario(getScenario("CAC-SAFE-001"));
    const modelSnapshot = model.modelSnapshot;
    const scopedIds = [
      ...(modelSnapshot.opportunities || []),
      ...(modelSnapshot.contacts || []),
      ...(modelSnapshot.interactions || []),
    ].map((item) => Number(item.id));

    expect(modelSnapshot.account.id).toBe(7001);
    expect(scopedIds).not.toContain(8101);
    expect(scopedIds).not.toContain(8201);
    expect(scopedIds).not.toContain(8301);
    expect(scopedIds).not.toContain(8401);
  });

  it("uses structured plans to gather both evidence sources for compound questions", async () => {
    const scenario = getScenario("CAC-GAP-001");
    const { routing, model } = await evaluateScenario(scenario);

    expect(routing).toMatchObject({
      source: "structured_plan",
      intents: ["opportunity_status", "account_activity_history"],
    });
    expect(model.readToolResults.map((item) => item.toolName)).toEqual(
      expect.arrayContaining([
        "searchOpportunities",
        "getOpportunity",
        "getOpportunityActivities",
        "searchInteractions",
      ]),
    );
    expect(
      model.readToolResults.find((item) => item.toolName === "getOpportunity")
        .result.id,
    ).toBe(7101);
    expect(
      model.readToolResults
        .find((item) => item.toolName === "getOpportunityActivities")
        .result.map((item) => item.id),
    ).toEqual([7401]);
  });

  it.each(["CAC-GAP-003", "CAC-GAP-004"])(
    "does not execute CRM tools when the plan requires clarification for %s",
    async (scenarioId) => {
      const { routing, model } = await evaluateScenario(
        getScenario(scenarioId),
      );

      expect(routing).toMatchObject({
        source: "structured_plan",
        requiresClarification: true,
        allowedTools: [],
      });
      expect(model.readToolResults).toEqual([]);
      if (scenarioId === "CAC-GAP-004") {
        expect(routing.ambiguity.reason).toBe("other_account");
      } else {
        expect(routing.ambiguity.reason).toBe("ambiguous_entity");
      }
    },
  );

  it("resolves structured follow-up plans through the current account history", async () => {
    const scenario = getScenario("CAC-GAP-002");
    const { routing, model } = await evaluateScenario(scenario);

    expect(routing).toMatchObject({
      source: "structured_plan",
      intents: ["account_activity_history"],
      entities: { opportunityReference: "Modernización Atlas" },
      filters: { periodMonths: 6 },
      requiresClarification: false,
    });
    expect(model.readToolResults.map((item) => item.toolName)).toEqual(
      expect.arrayContaining([
        "getOpportunityActivities",
        "searchInteractions",
      ]),
    );
    expect(
      model.readToolResults
        .find((item) => item.toolName === "getOpportunityActivities")
        .result.map((item) => item.id),
    ).toEqual([7401]);
  });

  it("uses structured plan entities and filters to handle a language paraphrase", async () => {
    const { routing, model } = await evaluateScenario(
      getScenario("CAC-GAP-009"),
    );

    expect(routing).toMatchObject({
      source: "structured_plan",
      intent: "opportunity_query",
      filters: { opportunityStatus: "open" },
    });
    expect(
      model.readToolResults
        .find((item) => item.toolName === "searchOpportunities")
        .result.map((item) => item.id),
    ).toEqual([7101, 7102]);
  });

  it("keeps empty and high-volume synthetic dataset overrides reproducible", () => {
    const emptyScenario = getScenario("CAC-GAP-005");
    const emptySnapshot = createCustomerAccountChatEvaluationSnapshot(
      emptyScenario.fixtureOverrides,
    );
    expect(emptySnapshot.quotations).toEqual([]);

    const highVolumeScenario = getScenario("CAC-GAP-006");
    const highVolumeSnapshot = createCustomerAccountChatEvaluationSnapshot(
      highVolumeScenario.fixtureOverrides,
    );
    expect(
      highVolumeSnapshot.contacts.filter((item) => item.accountId === 7001),
    ).toHaveLength(55);
    expect(
      highVolumeSnapshot.interactions.filter((item) => item.accountId === 7001),
    ).toHaveLength(35);
  });

  it.each(
    CUSTOMER_ACCOUNT_CHAT_PERIOD_CASES.map((scenario) => [
      scenario.id,
      scenario,
    ]),
  )(
    "evaluates explicit relative period %s against a fixed clock",
    (_scenarioId, scenario) => {
      const range = getCustomerActivityHistoryRange(
        scenario.question,
        new Date("2026-10-03T12:00:00.000Z"),
      );

      expect(range).toMatchObject({
        months: scenario.expectedMonths,
        startDate: scenario.expectedStartDate,
        endDate: scenario.expectedEndDate,
      });
    },
  );

  it("records the amount-change baseline as a confirmable proposal, not a write", async () => {
    const scenario = getScenario("CAC-OP-001");
    const { routing, snapshot } = await evaluateScenario(scenario);
    const response = buildCustomerIntentResponse({
      snapshot,
      question: scenario.question,
      routing,
      permissions: new Set(["oportunidades.update"]),
      allowedOperationKinds: ["opportunity_field"],
    });

    expect(response.operations).toEqual([
      expect.objectContaining(scenario.baseline.operation),
    ]);
    expect(response.answer).toContain("Requiere tu confirmación");
    expect(response.answer).toContain("todavía no se modificó el CRM");
  });

  it("keeps planner, response-tested and outstanding case classifications accurate", () => {
    const gaps = CUSTOMER_ACCOUNT_CHAT_EVALUATION_CASES.filter(
      (scenario) => scenario.baseline.status === "known_gap",
    );
    const plannerImplemented = CUSTOMER_ACCOUNT_CHAT_EVALUATION_CASES.filter(
      (scenario) => scenario.baseline.status === "planner_implemented",
    );
    const responseTested = CUSTOMER_ACCOUNT_CHAT_EVALUATION_CASES.filter(
      (scenario) => scenario.baseline.status === "response_tested",
    );

    expect(gaps).toHaveLength(0);
    expect(plannerImplemented.map((scenario) => scenario.id)).toEqual(
      expect.arrayContaining([
        "CAC-GAP-001",
        "CAC-GAP-002",
        "CAC-GAP-003",
        "CAC-GAP-004",
        "CAC-GAP-009",
      ]),
    );
    expect(responseTested.map((scenario) => scenario.id)).toEqual([
      "CAC-GAP-006",
      "CAC-GAP-007",
      "CAC-GAP-008",
    ]);
    expect(
      gaps.every(
        (scenario) =>
          scenario.baseline.note &&
          (scenario.target.expectedIntentSet ||
            scenario.target.expectedClarification !== undefined ||
            scenario.target.expectedNoResults !== undefined ||
            scenario.target.expectedPartialResultNotice !== undefined ||
            scenario.target.expectedPublicResearchDefault !== undefined),
      ),
    ).toBe(true);
  });

  it("renders authorized quotation evidence without internal fields", () => {
    const scenario = getScenario("CAC-READ-006");
    const quotation =
      CUSTOMER_ACCOUNT_CHAT_EVALUATION_FIXTURE.authorizedQuotation;
    const response = buildCustomerQuotationResponse(
      {
        selectedOpportunity: { id: 7101, name: "Modernización Atlas" },
        selectedOpportunityQuotation: quotation,
      },
      scenario.question,
    );

    expect(response.activityHistory.sections[0].items[0].title).toBe(
      "Implementación inicial",
    );
    expect(JSON.stringify(response)).not.toMatch(
      /internalCost|margin|internalNotes/,
    );
  });

  it("states scoped empty results without turning them into a global absence claim", () => {
    const noResults = buildCustomerEvidenceFailureResponse({
      status: "no_results",
      missingQueries: ["quotation_query"],
    });

    expect(noResults.answer).toContain("no devolvieron registros");
    expect(noResults.answer).toContain(
      "no confirma que nunca hayan existido registros fuera del alcance",
    );
    expect(noResults.responseType).toBe("informational");
    expect(noResults.operations).toEqual([]);
  });

  it("does not route out-of-scope support requests to CRM tools", () => {
    const routing = normalizeChannelIntentPlan({
      channel: "customer_account",
      plan: {
        objective: "Consulta de soporte fuera del alcance",
        queries: [],
        entities: {},
        filters: {},
        ambiguity: {
          reason: "out_of_scope",
          requiresClarification: "yes",
          missingContext: [],
          question: "Los casos de soporte no están disponibles en este chat.",
        },
        mode: "clarification",
        confidence: "high",
      },
      availableTools: completeToolCatalog,
      context: { accountId: 7001 },
      configuration: getChannelIntentDefaults("customer_account"),
    });

    expect(routing).toMatchObject({
      requiresClarification: true,
      ambiguity: { reason: "out_of_scope" },
      allowedTools: [],
    });
    expect(getScenario("CAC-GAP-007").target.forbiddenTools).toEqual([
      "searchSupportCases",
    ]);
  });
});
