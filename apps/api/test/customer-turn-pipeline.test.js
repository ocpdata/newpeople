import { beforeEach, describe, expect, it, vi } from "vitest";
import { runStructuredTextResearch } from "../src/structuredWebResearch.js";
import { appendCustomerAccountChatHistory, createCustomerAccountAdapter } from "../src/commercial-intelligence/customer-chat-adapter.js";
import { getCoachBusinessRules } from "../src/coach/business-rules.js";
import { getChannelIntentDefaults } from "../src/coach/channel-intents.js";
import { SYNTHETIC_CUSTOMER_SNAPSHOT } from "./fixtures/customer-turn-cases.js";
import { interpretCustomerTurn } from "../src/commercial-intelligence/turn-contract.js";

const provider = vi.hoisted(() => ({ real: null }));
vi.mock("../src/structuredWebResearch.js", async (original) => {
  const actual = await original();
  provider.real = actual.runStructuredTextResearch;
  return { ...actual, runStructuredTextResearch: vi.fn() };
});
vi.mock("../src/coach/business-rules.js", async (original) => {
  const actual = await original();
  return { ...actual, loadCoachBusinessRules: vi.fn(async () => actual.getCoachBusinessRules({ channel: "customer_account" })) };
});
vi.mock("../src/coach/admin-rules.js", () => ({ listCoachAdminRules: vi.fn(async () => []) }));
vi.mock("../src/coach/channel-intent-governance.js", async (original) => {
  const actual = await original();
  return { ...actual, loadChannelIntentConfigurations: vi.fn(async () => getChannelIntentDefaults("customer_account")) };
});
vi.mock("../src/coach/planner-prompts.js", async (original) => ({
  ...(await original()),
  loadPlannerPrompt: vi.fn(async () => ({ instruction: "Planifica lecturas autorizadas.", version: 0, source: "default" })),
}));

const snapshot = {
  ...SYNTHETIC_CUSTOMER_SNAPSHOT,
  opportunities: [{
    ...SYNTHETIC_CUSTOMER_SNAPSHOT.opportunities[0],
    contactId: 9301,
    stageCode: "identificacion_oportunidad",
    stageName: "Identificación de oportunidad",
    currentStage: { id: 1, code: "identificacion_oportunidad", name: "Identificación", criteria: [] },
    workspace: { criteria: [], actions: [], weaknesses: [] },
  }],
  accountHealth: { status: "healthy", score: 80 },
};
const permissions = new Set([
  "cuentas.read", "oportunidades.read", "desarrollo_comercial.read",
  "contactos.read", "interacciones.read", "mi_coach.execute",
  "oportunidades.update", "contactos.update", "calendario_comercial.update",
]);
const makeComponent = (category, object = "opportunity", extra = {}) => ({
  id: "c1", category, object, text: "Solicitud sintética sobre Renovación Alfa.",
  topic: "", scope: "single", reference: "Renovación Alfa", attribution: "none",
  certainty: "unspecified", explicitAction: category.startsWith("action."), dependsOn: [], continuationOf: "none", ...extra,
});
const makeContract = (components, extra = {}) => ({
  version: 1, movement: "new_request", resolution: "resolved", confidence: "high", clarificationQuestion: "", components, ...extra,
});
function adapter(components, extra = {}) {
  return createCustomerAccountAdapter({
    user: { id: 0, permissionSet: permissions },
    snapshot, agents: [], jobId: 0,
    authoritativeIntent: { turnContract: makeContract(components) },
    channelIntentConfiguration: getChannelIntentDefaults("customer_account"),
    ...extra,
  });
}

describe("Customer contract B6/B9/B10 integration", () => {
  beforeEach(() => {
    runStructuredTextResearch.mockReset();
    runStructuredTextResearch.mockImplementation(async (request) => {
      if (request.schemaName === "customer_account_query_plan") {
        const component = request.context.turnComponent;
        const collection = component.scope === "collection";
        const general = component.object === "general" || component.object === "account" || collection ||
          component.category === "action.create_record";
        return {
          objective: component.text, queries: [request.context.authoritativeIntent.intent],
          mode: component.explicitAction ? "operation" : "read_only",
          operationKind: component.category === "action.schedule_activity" ? "activity" : "none",
          activityDraft: {
            action: component.category === "action.schedule_activity" ? "prepare" : "none",
            actionType: "meeting", timing: "scheduled", title: "Reunión sintética", scheduledAt: "",
            notes: "", successCriteria: "", temporalPreference: "",
          },
          entities: general ? {} : { opportunityReference: "Renovación Alfa" },
          filters: {},
          ambiguity: { reason: "none", requiresClarification: "no", missingContext: [], question: "" },
          referenceResolution: {
            targetType: general ? "account" : "opportunity",
            cardinality: collection ? "all" : "single", source: "current_message",
            candidateKeys: general ? ["account_1"] : ["opportunity_1"],
          },
          confidence: "high",
        };
      }
      if (request.schemaName === "customer_account_report_destination") {
        return { match: "matched", questionIds: [9201], reason: "Motivación del cliente" };
      }
      if (request.schemaName === "customer_account_content") return { answer: "Estimada Elena: propongo conversar sobre Renovación Alfa. [Fecha por completar]." };
      if (request.schemaName === "customer_account_content_audit") return { approved: "yes" };
      if (request.schemaName === "customer_account_evidence_assessment") {
        return { status: "sufficient", missingQueries: [], missingFacts: [] };
      }
      if (request.schemaName === "account_contextual_chat") {
        return { answer: "La oportunidad está en Identificación.", evidence: ["getOpportunity"], operations: [], recommendedActions: [], pendingItems: [], inferences: [], confidence: "high" };
      }
      if (request.schemaName === "customer_account_answer_audit") {
        return { status: "supported", unsupportedClaims: [], findings: [] };
      }
      throw new Error(`Unexpected AI schema ${request.schemaName}`);
    });
  });
  it("uses one report-destination match and no evidence/intent reclassification", async () => {
    const result = await adapter([makeComponent("report.client_statement", "opportunity", {
      text: "El cliente dijo que su motivación es evitar filtraciones.", attribution: "client", certainty: "suspected",
    })]).runTurn({ question: "reporte", context: { accountId: 9001 } });
    expect(result.response.stageAnswerPrefill?.questionIds).toEqual([9201]);
    expect(result.response.operations).toEqual([]);
    expect(runStructuredTextResearch.mock.calls.map(([request]) => request.schemaName))
      .toEqual(["customer_account_query_plan", "customer_account_report_destination"]);
    expect(result.qualityTrace.diagnostics.components[0].diagnostics.evidence.verifier).toBe("report");
  });
  it("does not call a report interpreter for a stage question", async () => {
    const result = await adapter([makeComponent("query.field_value", "opportunity", { text: "¿En qué etapa está Renovación Alfa?" })])
      .runTurn({ question: "etapa", context: { accountId: 9001 } });
    expect(result.response.responseType).not.toBe("error");
    expect(result.response.stageAnswerPrefill).toBeUndefined();
    expect(runStructuredTextResearch.mock.calls.map(([request]) => request.schemaName))
      .not.toContain("customer_account_seller_report");
  });
  it("preserves both a factual question and a requested email without scheduling or sending", async () => {
    const result = await adapter([
      makeComponent("query.field_value", "opportunity", { text: "¿En qué etapa está Renovación Alfa?" }),
      makeComponent("content.email_draft", "opportunity", { id: "c2", text: "Redacta un correo para pedir reunión.", dependsOn: ["c1"] }),
    ]).runTurn({ question: "etapa y correo", context: { accountId: 9001 } });
    expect(result.response.components.map((item) => item.status), JSON.stringify(result.response)).toEqual(["completed", "completed"]);
    expect(result.response.answer).toContain("Estimada Elena");
    expect(result.response.operations).toEqual([]);
    expect(result.qualityTrace.diagnostics.components).toHaveLength(2);
  });
  it("prepares a meeting in the existing confirmable activity flow without inventing its date", async () => {
    const result = await adapter([makeComponent("action.schedule_activity", "activity")])
      .runTurn({ question: "programar reunión", context: { accountId: 9001 } });
    expect(result.response.operations, JSON.stringify(result.response)).toHaveLength(1);
    expect(result.response.operations[0]).toMatchObject({ kind: "activity", scheduledAt: "", status: "pending" });
    expect(result.response.operations[0].missingFields).toContain("scheduledAt");
  });
  it("does not reclassify a report after clarification", async () => {
    const previous = makeContract([makeComponent("report.client_statement", "opportunity", { text: "El cliente sospecha fugas de datos." })]);
    const current = makeContract([makeComponent("query.field_value", "opportunity", { text: "La primera pregunta", reference: "La primera pregunta" })], { movement: "select_candidate" });
    const result = await adapter([], { authoritativeIntent: { turnContract: current } }).runTurn({
      question: "La primera pregunta", context: { accountId: 9001 },
      conversationContext: { accountId: 9001, opportunityId: 9101, turnMemory: { contract: previous, pendingComponentIds: ["c1"] } },
    });
    expect(result.response.stageAnswerPrefill?.appendText).toContain("El cliente sospecha fugas de datos.");
    expect(result.response.stageAnswerPrefill?.appendText).not.toContain("La primera pregunta");
  });
  it("keeps recognition separate from disabled operations", async () => {
    const rules = getCoachBusinessRules({ channel: "customer_account" });
    expect(rules.operationPolicy.allowedKinds).not.toContain("create_opportunity");
    const result = await adapter([makeComponent("action.create_record", "opportunity", { text: "Crea Proyecto Gamma." })])
      .runTurn({ question: "crear", context: { accountId: 9001 } });
    expect(result.response.operations).toEqual([]);
    expect(result.response.components[0].status).toBe("disabled");
  });
  it("reports a denied write permission without asking the seller to rephrase", async () => {
    const result = await adapter([makeComponent("action.schedule_activity", "activity")], {
      user: { id: 0, permissionSet: new Set(["cuentas.read", "oportunidades.read"]) },
    }).runTurn({ question: "programar", context: { accountId: 9001 } });
    expect(result.response.components[0].status).toBe("permission_denied");
    expect(result.response.answer).toContain("permisos");
    expect(runStructuredTextResearch).not.toHaveBeenCalled();
  });
  it("answers about an already extracted attachment without inventing CRM document tools", async () => {
    const result = await adapter([makeComponent("query.document_content", "document")], {
      referenceMaterial: { name: "synthetic.txt", text: "Necesidad sintética: reducir fugas de información." },
    }).runTurn({ question: "¿Qué necesidad explica el archivo?", context: { accountId: 9001 } });
    expect(result.response.components[0].status).toBe("completed");
    expect(result.response.contentSource).toBe("user_provided");
    expect(runStructuredTextResearch.mock.calls.map(([request]) => request.schemaName))
      .toEqual(["customer_account_content", "customer_account_content_audit"]);
    expect(runStructuredTextResearch.mock.calls[0][0].context.referenceMaterial.name).toBe("synthetic.txt");
  });
  it("persists reviewed-stage links, component status and provided-content provenance across history updates", () => {
    const stageAnswerPrefill = { opportunityId: 9101, questionIds: [9201], appendText: "Reporte sintético" };
    const components = [{ id: "c1", category: "report.client_statement", status: "completed" }];
    const first = appendCustomerAccountChatHistory([], "Reporte", "Borrador preparado", {
      stageAnswerPrefill, components, contentSource: "user_provided",
    });
    const next = appendCustomerAccountChatHistory(first, "¿Qué sigue?", "Revisa el borrador");
    expect(next[1]).toMatchObject({ stageAnswerPrefill, components, contentSource: "user_provided" });
  });

  it.runIf(process.env.CUSTOMER_TURN_PIPELINE_LIVE === "1").each([
    ["report.client_statement", "El cliente me dijo que su motivación en Renovación Alfa es que sospechan que envían datos privados por correo."],
    ["query.field_value", "¿En qué etapa está la oportunidad Renovación Alfa?"],
    ["guidance.next_steps", "¿Qué me recomiendas para avanzar en Renovación Alfa?"],
    ["query.record_list", "Dame una lista de las oportunidades de esta cuenta."],
    ["content.email_draft", "Dame un ejemplo de correo para pedir reunión sobre Renovación Alfa; no lo envíes."],
    ["action.schedule_activity", "Quiero programar una reunión sobre Renovación Alfa."],
    ["action.create_record", "Quiero crear una oportunidad nueva llamada Proyecto Gamma."],
  ])("real synthetic B3→B6→B9→B10: %s", async (category, question) => {
    runStructuredTextResearch.mockImplementation(provider.real);
    const turnContract = await interpretCustomerTurn({
      question, snapshot, user: { id: 0 },
      classifierPrompt: { instruction: "Interpreta solicitudes comerciales autorizadas. No ejecutes cambios." },
    });
    expect(turnContract.components[0].category).toBe(category);
    const result = await adapter([], { authoritativeIntent: { turnContract } })
      .runTurn({ question, context: { accountId: 9001 } });
    expect(result.response.components[0].status, JSON.stringify(result.response))
      .toBe(category === "action.create_record" ? "disabled" : "completed");
    if (category === "report.client_statement") expect(result.response.stageAnswerPrefill?.questionIds).toEqual([9201]);
    if (category === "action.schedule_activity") {
      expect(result.response.operations[0]).toMatchObject({ kind: "activity", scheduledAt: "" });
    } else expect(result.response.operations).toEqual([]);
    const schemas = runStructuredTextResearch.mock.calls.map(([request]) => request.schemaName);
    expect(schemas.filter((schema) => schema === "customer_account_turn_contract")).toHaveLength(1);
    expect(schemas).not.toContain("customer_account_seller_report");
  }, 90000);
});
