import { describe, expect, it, vi } from "vitest";
import { runConversationEngine } from "../src/coach/conversation-engine.js";
import {
  classifyChannelIntent,
  getChannelIntentPlanFields,
  getChannelIntentDefaults,
  normalizeChannelIntentPlan,
} from "../src/coach/channel-intents.js";

const customerTools = [
  "searchAccounts",
  "searchOpportunities",
  "getOpportunity",
  "getOpportunityQuotation",
  "searchContacts",
  "searchInteractions",
  "getOpportunityActivities",
  "getOpportunityReadiness",
  "getSellerPipeline",
].map((name) => ({ name }));

const prospectTools = [
  "getProspectProfile",
  "searchProspectFindings",
  "searchProspectContacts",
  "searchProspectHypotheses",
].map((name) => ({ name }));

describe("shared non-Coach channel intent routing", () => {
  it("routes opportunity guidance to detail, activity, readiness, and interaction tools", () => {
    const configuration = getChannelIntentDefaults("customer_account");
    const classified = classifyChannelIntent({
      channel: "customer_account",
      question: "¿Qué me sugieres hacer en esta oportunidad?",
      context: { accountId: 7, opportunityId: 11 },
      availableTools: customerTools,
      configuration,
    });
    expect(classified.intent).toBe("opportunity_guidance");

    const plan = normalizeChannelIntentPlan({
      channel: "customer_account",
      context: { accountId: 7, opportunityId: 11 },
      availableTools: customerTools.map((tool) => tool.name),
      configuration,
      question: "¿Qué me sugieres hacer en esta oportunidad?",
      plan: {
        objective: "Recomendar siguientes pasos con evidencia",
        queries: ["opportunity_guidance"],
        entities: { opportunityReference: "Proyecto abierto" },
        filters: { opportunityStatus: "open" },
        ambiguity: {
          reason: "none",
          requiresClarification: "no",
          missingContext: [],
          question: "",
        },
        mode: "read_only",
        confidence: "high",
      },
    });

    expect(plan).toMatchObject({
      intent: "opportunity_guidance",
      intents: ["opportunity_guidance"],
      requiredContext: ["account", "opportunity"],
      requiresClarification: false,
      allowedTools: [
        "getOpportunity",
        "getOpportunityActivities",
        "getOpportunityReadiness",
        "searchInteractions",
      ],
    });
    expect(
      getChannelIntentPlanFields("customer_account")
        .find((field) => field.key === "queries")
        .items.enum,
    ).toContain("opportunity_guidance");
  });

  it("uses the validated selected opportunity when the planner reports stale missing context", () => {
    const configuration = getChannelIntentDefaults("customer_account");
    const plan = {
      objective: "Cambiar el monto de la oportunidad seleccionada",
      queries: ["crm_operation"],
      entities: { opportunityReference: "" },
      filters: {},
      ambiguity: {
        reason: "missing_context",
        requiresClarification: "yes",
        missingContext: ["opportunity"],
        question: "Selecciona la oportunidad a modificar.",
      },
      mode: "clarification",
      confidence: "high",
    };

    const selectedOpportunityPlan = normalizeChannelIntentPlan({
      channel: "customer_account",
      context: { accountId: 7, opportunityId: 11 },
      availableTools: customerTools,
      configuration,
      question: "cambia el monto de la oportunidad a 1000000",
      plan,
    });
    const missingOpportunityPlan = normalizeChannelIntentPlan({
      channel: "customer_account",
      context: { accountId: 7, opportunityId: null },
      availableTools: customerTools,
      configuration,
      question: "cambia el monto de la oportunidad a 1000000",
      plan,
    });

    expect(selectedOpportunityPlan).toMatchObject({
      intent: "crm_operation",
      mode: "operation",
      requiresClarification: false,
      missingContext: [],
    });
    expect(missingOpportunityPlan).toMatchObject({
      intent: "crm_operation",
      mode: "clarification",
      requiresClarification: true,
      missingContext: ["opportunity"],
    });
  });

  it("resolves only a server-authorized candidate alias for a conversational reference", () => {
    const configuration = getChannelIntentDefaults("customer_account");
    const plan = {
      objective: "Cambiar el monto de la oportunidad anterior",
      queries: ["crm_operation"],
      entities: { opportunityReference: "" },
      referenceResolution: {
        targetType: "opportunity",
        cardinality: "single",
        source: "conversation_history",
        candidateKeys: ["opportunity_1"],
      },
      filters: {},
      ambiguity: {
        reason: "missing_context",
        requiresClarification: "yes",
        missingContext: ["opportunity"],
        question: "¿A qué oportunidad te refieres?",
      },
      mode: "clarification",
      confidence: "high",
    };
    const authorizedCandidate = {
      candidateKey: "opportunity_1",
      entityType: "opportunity",
      recordId: 11,
      accountId: 7,
      referenceText: "Vrf 2027",
    };
    const normalize = (
      referencePlan,
      serverEntityCandidates,
      question = "modifica el monto por 1000000",
    ) =>
      normalizeChannelIntentPlan({
        channel: "customer_account",
        plan: referencePlan,
        serverEntityCandidates,
        context: { accountId: 7 },
        availableTools: customerTools,
        configuration,
        question,
        trustedEntityReferences: ["Vrf 2027"],
      });

    const resolved = normalize(plan, [authorizedCandidate]);
    const invalid = normalize(
      {
        ...plan,
        referenceResolution: {
          ...plan.referenceResolution,
          candidateKeys: ["opportunity_99"],
        },
      },
      [authorizedCandidate],
    );
    const crossAccount = normalize(plan, [
      { ...authorizedCandidate, accountId: 99 },
    ]);
    const activityFollowUp = normalize(
      {
        ...plan,
        objective: "Consultar actividad pendiente de la oportunidad en contexto",
        queries: ["account_activity_history"],
        entities: { opportunityReference: "Vrf 2027" },
        referenceResolution: {
          targetType: "account",
          cardinality: "single",
          source: "active_context",
          candidateKeys: [],
        },
        ambiguity: {
          reason: "none",
          requiresClarification: "no",
          missingContext: [],
          question: "",
        },
        mode: "read_only",
      },
      [authorizedCandidate],
      "¿Qué actividad pendiente tiene?",
    );

    expect(resolved).toMatchObject({
      mode: "operation",
      requiresClarification: false,
      missingContext: [],
      serverResolvedEntityIds: { opportunityId: 11 },
      referenceResolution: {
        source: "conversation_history",
        candidateKeys: ["opportunity_1"],
      },
    });
    expect(invalid).toMatchObject({
      mode: "clarification",
      serverResolvedEntityIds: { opportunityId: null },
      ambiguity: { reason: "ambiguous_entity", requiresClarification: true },
    });
    expect(crossAccount).toMatchObject({
      mode: "clarification",
      serverResolvedEntityIds: { opportunityId: null },
    });
    expect(activityFollowUp).toMatchObject({
      intent: "account_activity_history",
      referenceResolution: {
        targetType: "opportunity",
        cardinality: "single",
        candidateKeys: ["opportunity_1"],
      },
      serverResolvedEntityIds: { opportunityId: 11 },
      requiresClarification: false,
    });

    const portfolio = normalize(
      {
        ...plan,
        queries: ["opportunity_query"],
        referenceResolution: {
          targetType: "opportunity",
          cardinality: "all",
          source: "account_scope",
          candidateKeys: [],
        },
        ambiguity: {
          reason: "none",
          requiresClarification: "no",
          missingContext: [],
          question: "",
        },
        mode: "read_only",
      },
      [authorizedCandidate],
    );
    expect(portfolio.serverResolvedEntityIds.opportunityId).toBeNull();

    const multiTargetWrite = normalize(
      {
        ...plan,
        referenceResolution: {
          targetType: "opportunity",
          cardinality: "multiple",
          source: "conversation_history",
          candidateKeys: ["opportunity_1", "opportunity_2"],
        },
        ambiguity: {
          reason: "none",
          requiresClarification: "no",
          missingContext: [],
          question: "",
        },
        mode: "operation",
      },
      [
        authorizedCandidate,
        {
          ...authorizedCandidate,
          candidateKey: "opportunity_2",
          recordId: 12,
        },
      ],
    );
    expect(multiTargetWrite).toMatchObject({
      mode: "clarification",
      requiresClarification: true,
      serverResolvedEntityIds: { opportunityId: null },
    });
  });

  it("normalizes compound plans and intersects intent tools with authorized tools", () => {
    const configuration = getChannelIntentDefaults("customer_account").map(
      (intent) =>
        intent.code === "opportunity_status"
          ? {
              ...intent,
              allowedTools: [
                "searchAccounts",
                "getOpportunity",
                "deleteAccount",
              ],
              requiredContext: [],
            }
          : intent,
    );
    const availableTools = [
      "searchAccounts",
      "searchOpportunities",
      "getOpportunity",
      "searchInteractions",
      "getOpportunityActivities",
    ];
    const plan = normalizeChannelIntentPlan({
      channel: "customer_account",
      context: { accountId: 7 },
      availableTools,
      configuration,
      plan: {
        objective: "Revisar estado y seguimiento",
        queries: ["opportunity_status", "account_activity_history"],
        entities: { opportunityReference: "Modernización Atlas" },
        filters: {
          opportunityStatus: "open",
          stageCode: "desarrollo",
          closeYear: "2026",
          periodMonths: "6",
          startDate: "2026-04-03",
          endDate: "2026-10-03",
        },
        ambiguity: {
          reason: "none",
          requiresClarification: "no",
          missingContext: [],
          question: "",
        },
        mode: "read_only",
        confidence: "high",
        tools: ["deleteAccount"],
      },
    });

    expect(plan).toMatchObject({
      source: "structured_plan",
      intents: ["opportunity_status", "account_activity_history"],
      objective: "Revisar estado y seguimiento",
      filters: {
        opportunityStatus: "open",
        stageCode: "desarrollo",
        closeYear: 2026,
        periodMonths: 6,
        startDate: "2026-04-03",
        endDate: "2026-10-03",
      },
      requiresClarification: false,
      mode: "query",
      allowedTools: [
        "searchAccounts",
        "getOpportunity",
        "searchInteractions",
        "searchOpportunities",
        "getOpportunityActivities",
      ],
    });
    expect(plan.allowedTools).not.toContain("deleteAccount");
    expect(plan.requiredContext).toContain("account");
    expect(
      getChannelIntentPlanFields("customer_account").find(
        (field) => field.key === "queries",
      ).items.enum,
    ).toContain("account_activity_history");
  });

  it("turns another-account and low-confidence plans into clarification without tools", () => {
    const basePlan = {
      objective: "Consultar otra cuenta",
      queries: [],
      entities: { accountReference: "Grupo Nébula" },
      filters: {},
      ambiguity: {
        reason: "other_account",
        requiresClarification: "yes",
        missingContext: [],
        question: "Cambia la cuenta seleccionada.",
      },
      mode: "clarification",
      confidence: "high",
    };
    const otherAccountPlan = normalizeChannelIntentPlan({
      channel: "customer_account",
      context: { accountId: 7 },
      availableTools: customerTools,
      plan: basePlan,
    });
    const lowConfidencePlan = normalizeChannelIntentPlan({
      channel: "customer_account",
      context: { accountId: 7 },
      availableTools: customerTools,
      plan: {
        ...basePlan,
        queries: ["opportunity_query"],
        ambiguity: { ...basePlan.ambiguity, reason: "ambiguous_entity" },
        mode: "read_only",
        confidence: "low",
      },
    });

    expect(otherAccountPlan).toMatchObject({
      ambiguity: { reason: "other_account", requiresClarification: true },
      requiresClarification: true,
      allowedTools: [],
    });
    expect(lowConfidencePlan).toMatchObject({
      ambiguity: { reason: "ambiguous_entity", requiresClarification: true },
      requiresClarification: true,
      allowedTools: [],
    });
  });

  it("rejects invented entity references and governance-disabled intents", () => {
    const configuration = getChannelIntentDefaults("customer_account").map(
      (intent) =>
        intent.code === "opportunity_query"
          ? { ...intent, enabled: false }
          : intent,
    );
    const plan = normalizeChannelIntentPlan({
      channel: "customer_account",
      question: "¿Qué oportunidades abiertas tenemos?",
      context: { accountId: 7 },
      availableTools: customerTools,
      configuration,
      plan: {
        objective: "Buscar oportunidad",
        queries: ["opportunity_query"],
        entities: { opportunityReference: "Oportunidad inventada" },
        filters: {},
        ambiguity: {
          reason: "none",
          requiresClarification: "no",
          missingContext: [],
          question: "",
        },
        mode: "read_only",
        confidence: "high",
      },
    });

    expect(plan).toBeNull();

    const accountOverview = normalizeChannelIntentPlan({
      channel: "customer_account",
      question: "Resume la cuenta Comercial Lumen",
      context: { accountId: 7 },
      availableTools: customerTools,
      configuration,
      plan: {
        objective: "Resumen de cuenta",
        queries: ["account_overview", "opportunity_query"],
        entities: { accountReference: "Comercial Lumen" },
        filters: {},
        ambiguity: {
          reason: "none",
          requiresClarification: "no",
          missingContext: [],
          question: "",
        },
        mode: "read_only",
        confidence: "high",
      },
    });

    expect(accountOverview.intents).toEqual(["account_overview"]);
    expect(accountOverview.entities.accountReference).toBe("Comercial Lumen");
  });

  it("keeps only literal references, valid filters and tools authorized for the selected intents", () => {
    const availableTools = ["searchAccounts", "searchOpportunities"];
    const plan = normalizeChannelIntentPlan({
      channel: "customer_account",
      question: "Lista oportunidades abiertas de Modernización Atlas",
      context: { accountId: 7 },
      availableTools,
      plan: {
        objective: "Listar oportunidades",
        queries: ["opportunity_query", "invented_intent"],
        entities: {
          opportunityReference: "Modernización Atlas",
          contactReference: "Contacto inventado",
        },
        filters: {
          opportunityStatus: "open",
          stageCode: "NEGOCIACION",
          closeYear: "3026",
          periodMonths: "600",
          startDate: "2026-02-30",
          endDate: "2026-03-01",
        },
        ambiguity: {
          reason: "none",
          requiresClarification: "no",
          missingContext: [],
          question: "",
        },
        mode: "read_only",
        confidence: "high",
        tools: ["deleteAccount", "searchContacts"],
      },
    });

    expect(plan.intents).toEqual(["opportunity_query"]);
    expect(plan.entities).toMatchObject({
      opportunityReference: "Modernización Atlas",
      contactReference: "",
    });
    expect(plan.filters).toMatchObject({
      opportunityStatus: "open",
      stageCode: "NEGOCIACION",
      closeYear: null,
      periodMonths: null,
      startDate: "",
      endDate: "2026-03-01",
    });
    expect(plan.allowedTools).toEqual([
      "searchAccounts",
      "searchOpportunities",
    ]);
    expect(plan.allowedTools).not.toEqual(
      expect.arrayContaining(["deleteAccount", "searchContacts"]),
    );
  });

  it("routes Customer Existing quotation, contact history, and account activity queries", () => {
    expect(
      classifyChannelIntent({
        channel: "customer_account",
        question:
          "¿Qué contiene la cotización para la oportunidad Solución DNS?",
        availableTools: customerTools,
        context: { accountId: 7, opportunityId: 11 },
      }),
    ).toMatchObject({
      intent: "quotation_query",
      requiredContext: ["account"],
      missingContext: [],
      allowedTools: [
        "searchAccounts",
        "searchOpportunities",
        "getOpportunity",
        "getOpportunityQuotation",
      ],
    });

    expect(
      classifyChannelIntent({
        channel: "customer_account",
        question: "Lista todos los contactos, sus datos y su historial",
        availableTools: customerTools,
        context: { accountId: 7 },
      }),
    ).toMatchObject({
      intent: "contact_history",
      allowedTools: ["searchAccounts", "searchContacts", "searchInteractions"],
    });

    expect(
      classifyChannelIntent({
        channel: "customer_account",
        question:
          "Muéstrame todas las interacciones y actividades de los últimos seis meses",
        availableTools: customerTools,
        context: { accountId: 7 },
      })?.intent,
    ).toBe("account_activity_history");

    expect(
      classifyChannelIntent({
        channel: "customer_account",
        question: "Actualiza el monto de esta oportunidad a 50000",
        availableTools: customerTools,
        context: { accountId: 7, opportunityId: 11 },
      }),
    ).toMatchObject({ intent: "crm_operation", mode: "operation" });

    expect(
      classifyChannelIntent({
        channel: "customer_account",
        question: "Redacta un correo para el contacto de la cuenta",
        availableTools: customerTools,
        context: { accountId: 7 },
      })?.intent,
    ).toBe("email_draft");
  });

  it("routes prospect requests only to prospect-session tools", () => {
    expect(
      classifyChannelIntent({
        channel: "prospect",
        question: "¿Qué contactos potenciales encontramos?",
        availableTools: prospectTools,
        context: { prospectSessionId: 55 },
      }),
    ).toMatchObject({
      intent: "prospect_contacts",
      requiredContext: ["prospectSession"],
      missingContext: [],
      allowedTools: ["getProspectProfile", "searchProspectContacts"],
    });

    expect(
      classifyChannelIntent({
        channel: "prospect",
        question: "Convierte esta hipótesis en una oportunidad CRM",
        availableTools: prospectTools,
        context: { prospectSessionId: 55 },
      })?.intent,
    ).toBe("conversion_request");

    expect(
      classifyChannelIntent({
        channel: "prospect",
        question: "Busca evidencia pública en internet sobre esta empresa",
        availableTools: prospectTools,
        context: { prospectSessionId: 55 },
      })?.intent,
    ).toBe("public_research_review");
  });

  it("applies editable tool and context limits without expanding hard policy", () => {
    const classification = classifyChannelIntent({
      channel: "customer_account",
      question: "¿Qué contiene la cotización para esta oportunidad?",
      availableTools: customerTools,
      context: { accountId: 7 },
      configuration: [
        {
          code: "quotation_query",
          enabled: true,
          examples: ["Consulta la cotización"],
          priority: 150,
          allowedTools: ["searchAccounts", "deleteAccount"],
          requiredContext: ["account", "opportunity"],
        },
      ],
    });

    expect(classification).toMatchObject({
      intent: "quotation_query",
      requiredContext: ["account", "opportunity"],
      missingContext: ["opportunity"],
      requiresClarification: true,
      allowedTools: ["searchAccounts"],
    });
  });

  it("filters non-Coach tools through the shared route before preparing the read model", async () => {
    let preparedInput;
    let promptedSnapshot;
    const loadedChannels = [];
    const businessRules = {
      channel: "customer_account",
      process: "account_chat",
      scope: {
        accountSearchAllowed: true,
        opportunitySearchAllowed: true,
        quotationSearchAllowed: true,
        contactSearchAllowed: true,
        leadSearchAllowed: true,
        requireBusinessEvidence: true,
      },
      filters: {},
      operationPolicy: { allowedKinds: [], sourceChannel: "customer_account" },
      channelRules: { scope: "customer_account", accountScoped: true },
      validation: { requireEvidence: true },
    };
    const response = await runConversationEngine({
      question: "¿Qué contiene la cotización para la oportunidad Solución DNS?",
      context: { accountId: 7, opportunityId: 11 },
      user: { id: 31, permissionSet: new Set() },
      availableTools: customerTools,
      businessRules,
      channelRules: businessRules.channelRules,
      operationPolicy: businessRules.operationPolicy,
      dependencies: {
        loadChannelIntentConfigurations: async ({ channel }) => {
          loadedChannels.push(channel);
          return getChannelIntentDefaults(channel).map((intent) =>
            intent.code === "quotation_query"
              ? { ...intent, allowedTools: ["searchAccounts"] }
              : intent,
          );
        },
        planChannelIntent: async () => ({
          objective: "Consultar contenido de cotización",
          queries: ["quotation_query"],
          entities: { opportunityReference: "Solución DNS" },
          filters: {},
          ambiguity: {
            reason: "none",
            requiresClarification: "no",
            missingContext: [],
            question: "",
          },
          mode: "read_only",
          confidence: "high",
        }),
        prepareReadModel: async (input) => {
          preparedInput = input;
          return {
            effectiveContext: input.selectedContext,
            questionContextTransition: { changed: false },
            scopedSnapshot: {},
            preparationRequested: false,
            selectedOpportunity: null,
            deterministicStageReadiness: null,
            readToolResults: [],
            modelSnapshot: {},
            clarification: null,
            conversationHistory: input.conversationHistory,
            explicitEntities: {},
          };
        },
        loadProcessGuide: async () => "",
        loadAdministrativeRules: async () => [],
        buildPrompt: (model) => {
          promptedSnapshot = model;
          return {};
        },
        requestResponse: async () => ({
          answer: "Hay una cotización autorizada.",
          evidence: ["Cotización CRM"],
          facts: [],
          inferences: [],
          pendingItems: [],
          operations: [],
          entities: {},
          confidence: "high",
          responseType: "informational",
        }),
        resolveResponseContext: (_snapshot, currentContext) => ({
          context: currentContext,
          changed: false,
          conflict: null,
        }),
        normalizeResponse: (result) => result,
        buildStageReadiness: () => null,
        featureCode: "customer-account-test",
      },
    });

    expect(preparedInput.availableTools.map((tool) => tool.name)).toEqual([
      "searchAccounts",
    ]);
    expect(loadedChannels).toEqual(["customer_account"]);
    expect(preparedInput.channelIntentRouting.intent).toBe("quotation_query");
    expect(promptedSnapshot.channelIntentRouting.intent).toBe(
      "quotation_query",
    );
    expect(response.response.channelIntentRouting.intent).toBe(
      "quotation_query",
    );
    expect(response.qualityTrace.diagnostics.planner).toEqual({
      source: "structured_plan",
      fallbackUsed: false,
      reasonCode: null,
      queryCount: 1,
      evaluation: expect.objectContaining({
        planAvailable: true,
        plannerIntents: ["quotation_query"],
      }),
    });
  });

  it("uses the structured plan as the sole Customer Existing route", async () => {
    let preparedInput;
    const businessRules = {
      channel: "customer_account",
      process: "account_chat",
      scope: {
        accountSearchAllowed: true,
        opportunitySearchAllowed: true,
        quotationSearchAllowed: true,
        contactSearchAllowed: true,
        leadSearchAllowed: true,
        requireBusinessEvidence: true,
      },
      filters: {},
      operationPolicy: { allowedKinds: [], sourceChannel: "customer_account" },
      channelRules: { scope: "customer_account", accountScoped: true },
      validation: { requireEvidence: true },
    };
    const response = await runConversationEngine({
      question: "¿Qué contactos tiene la cuenta?",
      context: { accountId: 7 },
      user: {
        id: 31,
        permissionSet: new Set(["cuentas.read", "contactos.read"]),
      },
      availableTools: customerTools,
      businessRules,
      dependencies: {
        loadChannelIntentConfigurations: async () =>
          getChannelIntentDefaults("customer_account"),
        planChannelIntent: async () => ({
          objective: "Consultar oportunidades",
          queries: ["opportunity_query"],
          entities: {},
          filters: { opportunityStatus: "open" },
          ambiguity: {
            reason: "none",
            requiresClarification: "no",
            missingContext: [],
            question: "",
          },
          mode: "read_only",
          confidence: "high",
        }),
        prepareReadModel: async (input) => {
          preparedInput = input;
          return {
            effectiveContext: input.selectedContext,
            questionContextTransition: { changed: false },
            scopedSnapshot: {},
            preparationRequested: false,
            selectedOpportunity: null,
            deterministicStageReadiness: null,
            readToolResults: [
              { toolName: "searchAccounts", result: [{ id: 7 }] },
              { toolName: "searchOpportunities", result: [{ id: 21 }] },
            ],
            modelSnapshot: { readToolResults: [] },
            clarification: null,
            conversationHistory: [],
            explicitEntities: {},
          };
        },
        loadAdministrativeRules: async () => [],
        loadProcessGuide: async () => "",
        buildPrompt: (model) => model,
        requestResponse: async ({ payload }) => ({
          answer: "La cuenta tiene contactos autorizados.",
          evidence: ["Contactos CRM"],
          facts: [],
          inferences: [],
          pendingItems: [],
          operations: [],
          entities: {},
          confidence: "high",
          responseType: "informational",
        }),
        resolveResponseContext: (_snapshot, context) => ({
          context,
          changed: false,
          conflict: null,
        }),
        normalizeResponse: (result) => result,
        buildStageReadiness: () => null,
        featureCode: "customer-account-planner-test",
      },
    });

    expect(preparedInput.channelIntentRouting.intent).toBe("opportunity_query");
    expect(response.response.channelIntentRouting.intent).toBe(
      "opportunity_query",
    );
    expect(response.qualityTrace.diagnostics.planner.evaluation).toMatchObject({
      planAvailable: true,
      plannerIntents: ["opportunity_query"],
      plannedToolCount: expect.any(Number),
    });
  });

  it("always invokes the structured planner for Customer Existing", async () => {
    const planChannelIntent = vi.fn(async () => ({
      objective: "Consultar contactos",
      queries: ["contact_history"],
      entities: {},
      filters: {},
      ambiguity: {
        reason: "none",
        requiresClarification: "no",
        missingContext: [],
        question: "",
      },
      mode: "read_only",
      confidence: "high",
    }));
    let preparedInput;
    const businessRules = {
      channel: "customer_account",
      process: "account_chat",
      scope: {
        accountSearchAllowed: true,
        opportunitySearchAllowed: true,
        quotationSearchAllowed: true,
        contactSearchAllowed: true,
        leadSearchAllowed: true,
        requireBusinessEvidence: true,
      },
      filters: {},
      operationPolicy: { allowedKinds: [], sourceChannel: "customer_account" },
      channelRules: { scope: "customer_account", accountScoped: true },
      validation: { requireEvidence: true },
    };
    const response = await runConversationEngine({
      question: "¿Qué contactos tiene la cuenta?",
      context: { accountId: 7 },
      user: {
        id: 31,
        permissionSet: new Set(["cuentas.read", "contactos.read"]),
      },
      availableTools: customerTools,
      businessRules,
      dependencies: {
        planChannelIntent,
        loadChannelIntentConfigurations: async () =>
          getChannelIntentDefaults("customer_account"),
        prepareReadModel: async (input) => {
          preparedInput = input;
          return {
            effectiveContext: input.selectedContext,
            questionContextTransition: { changed: false },
            scopedSnapshot: {},
            preparationRequested: false,
            selectedOpportunity: null,
            deterministicStageReadiness: null,
            readToolResults: [],
            modelSnapshot: {},
            clarification: null,
            conversationHistory: [],
            explicitEntities: {},
          };
        },
        loadProcessGuide: async () => "",
        loadAdministrativeRules: async () => [],
        buildPrompt: () => ({}),
        requestResponse: async () => ({
          answer: "Contactos CRM autorizados.",
          evidence: ["Contactos CRM"],
          facts: [],
          inferences: [],
          pendingItems: [],
          operations: [],
          entities: {},
          confidence: "high",
          responseType: "informational",
        }),
        resolveResponseContext: (_snapshot, context) => ({
          context,
          changed: false,
          conflict: null,
        }),
        normalizeResponse: (result) => result,
        buildStageReadiness: () => null,
      },
    });

    expect(planChannelIntent).toHaveBeenCalledTimes(1);
    expect(preparedInput.channelIntentRouting.intent).toBe("contact_history");
    expect(preparedInput.availableTools.map((tool) => tool.name)).toContain(
      "searchContacts",
    );
    expect(response.response.responseType).toBe("informational");
  });

  it("filters New Account tools through the same motor and keeps prospect scope", async () => {
    let preparedInput;
    const businessRules = {
      channel: "prospect",
      process: "prospect_chat",
      scope: {
        accountSearchAllowed: false,
        opportunitySearchAllowed: false,
        quotationSearchAllowed: false,
        contactSearchAllowed: false,
        leadSearchAllowed: false,
        requireBusinessEvidence: true,
      },
      filters: {},
      operationPolicy: {
        allowedKinds: [
          "create_account",
          "create_contact",
          "create_opportunity",
        ],
        sourceChannel: "prospect",
      },
      channelRules: {
        scope: "prospect",
        prospectScoped: true,
        crmRecordsConfirmedOnly: true,
      },
      validation: { requireEvidence: true },
    };
    const response = await runConversationEngine({
      question: "¿Qué contactos potenciales encontramos?",
      context: { prospectSessionId: 55 },
      user: { id: 31, permissionSet: new Set(["prospeccion.read"]) },
      availableTools: prospectTools,
      channelRules: businessRules.channelRules,
      operationPolicy: businessRules.operationPolicy,
      businessRules,
      dependencies: {
        prepareReadModel: async (input) => {
          preparedInput = input;
          return {
            effectiveContext: input.selectedContext,
            questionContextTransition: { changed: false },
            scopedSnapshot: {},
            preparationRequested: false,
            selectedOpportunity: null,
            deterministicStageReadiness: null,
            readToolResults: [],
            modelSnapshot: {},
            clarification: null,
            conversationHistory: input.conversationHistory,
            explicitEntities: {},
          };
        },
        loadProcessGuide: async () => "",
        loadAdministrativeRules: async () => [],
        buildPrompt: () => ({}),
        requestResponse: async () => ({
          answer: "Hay un contacto potencial.",
          evidence: ["Hallazgo en la sesión"],
          facts: [],
          inferences: [],
          pendingItems: [],
          operations: [],
          entities: {},
          confidence: "medium",
          responseType: "informational",
        }),
        resolveResponseContext: (_snapshot, currentContext) => ({
          context: currentContext,
          changed: false,
          conflict: null,
        }),
        normalizeResponse: (result) => result,
        buildStageReadiness: () => null,
        featureCode: "prospect-chat-test",
      },
    });

    expect(preparedInput.availableTools.map((tool) => tool.name)).toEqual([
      "getProspectProfile",
      "searchProspectContacts",
    ]);
    expect(preparedInput.channelIntentRouting.intent).toBe("prospect_contacts");
    expect(response.response.channelIntentRouting.intent).toBe(
      "prospect_contacts",
    );
    expect(response.activeContext).toEqual({ prospectSessionId: 55 });
  });

  it("stops non-Coach model execution when the route's root context is missing", async () => {
    let preparedInput;
    const requestResponse = vi.fn();
    const businessRules = {
      channel: "customer_account",
      process: "account_chat",
      scope: {
        accountSearchAllowed: true,
        opportunitySearchAllowed: true,
        quotationSearchAllowed: true,
        contactSearchAllowed: true,
        leadSearchAllowed: true,
        requireBusinessEvidence: true,
      },
      filters: {},
      operationPolicy: { allowedKinds: [], sourceChannel: "customer_account" },
      channelRules: { scope: "customer_account", accountScoped: true },
      validation: { requireEvidence: true },
    };
    const response = await runConversationEngine({
      question: "Resume esta cuenta",
      context: {},
      user: { id: 31, permissionSet: new Set() },
      availableTools: customerTools,
      businessRules,
      channelRules: businessRules.channelRules,
      operationPolicy: businessRules.operationPolicy,
      dependencies: {
        planChannelIntent: async () => {
          throw new Error("Private model transport detail");
        },
        prepareReadModel: async (input) => {
          preparedInput = input;
          return {
            effectiveContext: {},
            questionContextTransition: { changed: false },
            scopedSnapshot: {},
            preparationRequested: false,
            selectedOpportunity: null,
            deterministicStageReadiness: null,
            readToolResults: [],
            modelSnapshot: {},
            clarification: null,
            conversationHistory: [],
            explicitEntities: {},
          };
        },
        loadProcessGuide: async () => "",
        loadAdministrativeRules: async () => [],
        buildPrompt: () => ({}),
        requestResponse,
        resolveResponseContext: (_snapshot, context) => ({
          context,
          changed: false,
          conflict: null,
        }),
        normalizeResponse: (result) => result,
        buildStageReadiness: () => null,
        featureCode: "customer-account-test",
      },
    });

    expect(preparedInput.channelIntentRouting).toBeNull();
    expect(preparedInput.availableTools).toEqual([]);
    expect(requestResponse).not.toHaveBeenCalled();
    expect(response.response).toMatchObject({
      responseType: "clarification",
      answer: expect.stringContaining("No pude interpretar la solicitud"),
      clarification: expect.objectContaining({ missing: [] }),
    });
    expect(response.qualityTrace.diagnostics.planner).toMatchObject({
      source: "not_applicable",
      fallbackUsed: false,
      reasonCode: "planner_error",
      queryCount: 0,
      evaluation: expect.objectContaining({
        planAvailable: false,
      }),
    });
  });

  it("fails closed when every Customer Existing intent is disabled", async () => {
    let preparedInput;
    const requestResponse = vi.fn();
    const businessRules = {
      channel: "customer_account",
      process: "account_chat",
      scope: {
        accountSearchAllowed: true,
        opportunitySearchAllowed: true,
        quotationSearchAllowed: true,
        contactSearchAllowed: true,
        leadSearchAllowed: true,
        requireBusinessEvidence: true,
      },
      filters: {},
      operationPolicy: { allowedKinds: [], sourceChannel: "customer_account" },
      channelRules: { scope: "customer_account", accountScoped: true },
      validation: { requireEvidence: true },
    };
    const response = await runConversationEngine({
      question: "Resume esta cuenta",
      context: { accountId: 7 },
      user: { id: 31, permissionSet: new Set() },
      availableTools: customerTools,
      businessRules,
      channelRules: businessRules.channelRules,
      operationPolicy: businessRules.operationPolicy,
      dependencies: {
        loadChannelIntentConfigurations: async () =>
          getChannelIntentDefaults("customer_account").map((intent) => ({
            ...intent,
            enabled: false,
          })),
        prepareReadModel: async (input) => {
          preparedInput = input;
          return {
            effectiveContext: input.selectedContext,
            questionContextTransition: { changed: false },
            scopedSnapshot: {},
            preparationRequested: false,
            selectedOpportunity: null,
            deterministicStageReadiness: null,
            readToolResults: [],
            modelSnapshot: {},
            clarification: null,
            conversationHistory: [],
            explicitEntities: {},
          };
        },
        loadProcessGuide: async () => "",
        loadAdministrativeRules: async () => [],
        buildPrompt: () => ({}),
        requestResponse,
        resolveResponseContext: (_snapshot, context) => ({
          context,
          changed: false,
          conflict: null,
        }),
        normalizeResponse: (result) => result,
        buildStageReadiness: () => null,
        featureCode: "customer-account-test",
      },
    });

    expect(preparedInput.availableTools).toEqual([]);
    expect(requestResponse).not.toHaveBeenCalled();
    expect(response.response.responseType).toBe("clarification");
  });
});
