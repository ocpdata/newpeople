import { describe, expect, it, vi } from "vitest";
import {
  applyCoachInteractionModeLimits,
  applyCoachOperationPolicy,
  buildDeterministicAccountOpportunityRanking,
  completeCoachModelTurn,
  enforceCoachBusinessEvidence,
  getConversationChannelJobType,
  normalizeChannelConversationHistory,
  normalizeCoachToolCalls,
  prepareCoachReadModel,
  resolveAvailableCoachTools,
  runConversationEngine,
  shouldPreserveCoachContextForQuestion,
} from "../src/coach/conversation-engine.js";
import { getCoachReadToolCatalog } from "../src/coach/read-tools.js";
import { getChannelIntentDefaults } from "../src/coach/channel-intents.js";

describe("Coach conversation engine", () => {
  it("normaliza historial y tipo de job según el adaptador", () => {
    expect(
      normalizeChannelConversationHistory(
        [
          { role: "seller", text: "Pregunta de Coach" },
          { role: "coach", text: "Respuesta de Coach" },
        ],
        "customer_account",
      ),
    ).toEqual([
      { role: "user", text: "Pregunta de Coach" },
      { role: "assistant", text: "Respuesta de Coach" },
    ]);
    expect(getConversationChannelJobType("coach")).toBe("mi_coach_chat");
    expect(getConversationChannelJobType("customer_account")).toBe(
      "account_chat",
    );
    expect(getConversationChannelJobType("prospect")).toBe("prospect_chat");
  });

  it("preserves the active entity for deictic follow-ups but not requests for another record", () => {
    expect(
      shouldPreserveCoachContextForQuestion(
        "Para esta oportunidad, ¿ves adecuado que le envíe un correo?",
        { opportunityId: 41 },
      ),
    ).toBe(true);
    expect(
      shouldPreserveCoachContextForQuestion(
        "¿Qué otra oportunidad debería priorizar?",
        { opportunityId: 41 },
      ),
    ).toBe(false);
    expect(
      shouldPreserveCoachContextForQuestion(
        "¿Qué hago con esta oportunidad?",
        {},
      ),
    ).toBe(false);
  });

  it("normaliza tool calls de ambos formatos y limita el lote", () => {
    const calls = normalizeCoachToolCalls({
      tool_calls: [
        { name: "searchAccounts", arguments: { accountId: 7 } },
        { toolName: "searchContacts", args: { accountId: 7 } },
        { name: "searchLeads", arguments: {} },
        { name: "getSellerPipeline", arguments: {} },
        { name: "searchOpportunities", arguments: {} },
      ],
    });

    expect(calls).toEqual([
      { toolName: "searchAccounts", args: { accountId: 7 } },
      { toolName: "searchContacts", args: { accountId: 7 } },
      { toolName: "searchLeads", args: {} },
      { toolName: "getSellerPipeline", args: {} },
    ]);
  });

  it("filtra herramientas por permisos del canal", () => {
    expect(
      resolveAvailableCoachTools(
        [
          { name: "searchAccounts", requiredPermission: "cuentas.read" },
          {
            name: "searchOpportunities",
            requiredPermission: "oportunidades.read",
          },
          { name: "searchContacts" },
        ],
        { codes: ["cuentas.read"] },
      ).map((tool) => tool.name),
    ).toEqual(["searchAccounts", "searchContacts"]);
    expect(
      resolveAvailableCoachTools(getCoachReadToolCatalog(), new Set()),
    ).toEqual([]);
    expect(
      resolveAvailableCoachTools(
        [
          {
            name: "getOpportunityActivities",
            requiredPermissions: [
              "oportunidades.read",
              "desarrollo_comercial.read",
            ],
          },
        ],
        new Set(["oportunidades.read"]),
      ),
    ).toEqual([]);
    expect(
      resolveAvailableCoachTools(
        [
          {
            name: "getOpportunityActivities",
            requiredPermissions: [
              "oportunidades.read",
              "desarrollo_comercial.read",
            ],
          },
        ],
        new Set(["oportunidades.read", "desarrollo_comercial.read"]),
      ),
    ).toHaveLength(1);
    expect(
      resolveAvailableCoachTools(
        [
          {
            name: "getOpportunityQuotation",
            requiredPermission: "oportunidades.read",
            requiredAnyPermissions: [
              "cotizaciones.revision",
              "cotizaciones.operacion",
            ],
          },
        ],
        new Set(["oportunidades.read", "cotizaciones.revision"]),
      ),
    ).toHaveLength(1);
    expect(
      resolveAvailableCoachTools(
        [
          {
            name: "getOpportunityQuotation",
            requiredPermission: "oportunidades.read",
            requiredAnyPermissions: [
              "cotizaciones.revision",
              "cotizaciones.operacion",
            ],
          },
        ],
        new Set(["oportunidades.read"]),
      ),
    ).toEqual([]);
  });

  it("mantiene las reglas y permisos del servidor fuera del contrato del planificador", async () => {
    const planChannelIntent = vi.fn().mockResolvedValue({
      objective: "Aclarar el alcance",
      queries: [],
      entities: {
        accountReference: "",
        opportunityReference: "",
        contactReference: "",
        leadReference: "",
      },
      filters: {},
      ambiguity: {
        reason: "missing_context",
        requiresClarification: "yes",
        missingContext: ["account"],
        question: "Selecciona una cuenta autorizada.",
      },
      mode: "clarification",
      confidence: "high",
    });
    const businessRules = {
      channel: "customer_account",
      process: "account_chat",
      scope: {
        accountSearchAllowed: true,
        opportunitySearchAllowed: true,
        contactSearchAllowed: true,
        leadSearchAllowed: true,
        quotationSearchAllowed: true,
        requireBusinessEvidence: true,
      },
      filters: {},
      operationPolicy: { allowedKinds: [] },
      channelRules: {},
      validation: { requireEvidence: true },
    };
    const result = await runConversationEngine({
      question: "¿Qué ocurrió?",
      context: {},
      history: [],
      user: { id: 31, permissionSet: new Set() },
      permissions: new Set(),
      availableTools: [
        { name: "searchAccounts", requiredPermission: "cuentas.read" },
      ],
      businessRules,
      dependencies: {
        planChannelIntent,
        loadChannelIntentConfigurations: async () =>
          getChannelIntentDefaults("customer_account"),
        prepareReadModel: async () => ({
          effectiveContext: {},
          questionContextTransition: { changed: false },
          scopedSnapshot: {},
          preparationRequested: false,
          selectedOpportunity: null,
          deterministicStageReadiness: null,
          readToolResults: [],
          modelSnapshot: { readToolResults: [] },
          clarification: null,
          conversationHistory: [],
          explicitEntities: {
            candidates: {
              accounts: [],
              opportunities: [],
              contacts: [],
              leads: [],
            },
          },
        }),
        loadAdministrativeRules: async () => [],
        loadProcessGuide: async () => "",
        buildCoachPrompt: () => ({}),
        requestResponse: vi.fn(),
        normalizeResponse: (value) => value,
        resolveResponseContext: (_snapshot, context) => ({
          context,
          changed: false,
          conflict: null,
        }),
        buildStageReadiness: () => null,
      },
    });

    const plannerRequest = planChannelIntent.mock.calls[0][0];
    expect(plannerRequest).toMatchObject({
      channel: "customer_account",
      question: "¿Qué ocurrió?",
      availableTools: [],
    });
    expect(plannerRequest).not.toHaveProperty("businessRules");
    expect(plannerRequest).not.toHaveProperty("permissions");
    expect(plannerRequest).not.toHaveProperty("user");
    expect(plannerRequest).not.toHaveProperty("jobId");
    expect(result.response.responseType).toBe("clarification");
  });

  it("aplica la politica de operaciones antes de devolver resultados", () => {
    expect(
      applyCoachOperationPolicy(
        [
          { kind: "activity", title: "Llamar" },
          { kind: "account_field", title: "Actualizar cuenta" },
        ],
        { allowedKinds: ["activity"] },
      ),
    ).toEqual([{ kind: "activity", title: "Llamar" }]);
  });

  it("no mezcla operaciones de otro canal aunque compartan el mismo tipo", () => {
    expect(
      applyCoachOperationPolicy(
        [
          { kind: "activity", sourceChannel: "customer_account" },
          { kind: "activity", sourceChannel: "prospect" },
          { kind: "activity", title: "Nativa sin etiqueta" },
        ],
        {
          allowedKinds: ["activity"],
          sourceChannel: "customer_account",
        },
      ),
    ).toEqual([
      { kind: "activity", sourceChannel: "customer_account" },
      {
        kind: "activity",
        title: "Nativa sin etiqueta",
        sourceChannel: "customer_account",
      },
    ]);
  });

  it("convierte respuestas de negocio sin evidencia en una aclaracion y descarta operaciones", () => {
    const result = enforceCoachBusinessEvidence(
      {
        intent: "context_query",
        responseType: "informational",
        answer: "La oportunidad va bien.",
        evidence: [],
        facts: [],
        operations: [{ kind: "activity", title: "Agendar llamada" }],
      },
      "Como va la oportunidad?",
      {
        validation: { requireEvidence: true },
        scope: { requireBusinessEvidence: true },
      },
    );

    expect(result).toMatchObject({
      intent: "clarification",
      responseType: "clarification",
      operations: [],
      clarification: {
        type: "missing_fields",
        originalRequest: "Como va la oportunidad?",
      },
    });
  });

  it("limita respuestas de contexto breve sin truncar el modo coaching", () => {
    const response = {
      answer: "A".repeat(2000),
      facts: Array.from({ length: 8 }, (_, index) => ({ id: index })),
      evidence: Array.from({ length: 8 }, (_, index) => `Evidencia ${index}`),
      inferences: Array.from(
        { length: 5 },
        (_, index) => `Inferencia ${index}`,
      ),
      pendingItems: Array.from(
        { length: 5 },
        (_, index) => `Pendiente ${index}`,
      ),
    };

    expect(
      applyCoachInteractionModeLimits(response, "brief_context"),
    ).toMatchObject({
      answer: response.answer.slice(0, 1400),
      facts: response.facts.slice(0, 6),
      evidence: response.evidence.slice(0, 6),
      inferences: response.inferences.slice(0, 3),
      pendingItems: response.pendingItems.slice(0, 3),
    });
    expect(applyCoachInteractionModeLimits(response, "coaching")).toBe(
      response,
    );
  });

  it("permite coaching basado en la guía del proceso sin exigir evidencia CRM", () => {
    const response = {
      intent: "context_query",
      responseType: "informational",
      answer: "El proceso comercial se organiza en etapas verificables.",
      evidence: [],
      facts: [],
      operations: [],
    };

    expect(
      enforceCoachBusinessEvidence(
        response,
        "¿Qué etapas tiene el proceso de venta?",
        {
          validation: { requireEvidence: true },
          scope: { requireBusinessEvidence: true },
        },
        true,
      ),
    ).toEqual(response);
  });

  it("ejecuta resultados de lectura y solicita una segunda respuesta", async () => {
    const requestMiAgentJson = vi.fn().mockResolvedValue({
      intent: "context_query",
      responseType: "informational",
      answer: "Respuesta con datos consultados.",
    });
    const buildCoachPrompt = vi.fn((snapshot) => snapshot);
    const result = await completeCoachModelTurn({
      result: {
        toolCalls: [
          { toolName: "searchOpportunities", args: { accountId: 7 } },
        ],
      },
      clarification: null,
      snapshot: {
        coachOpportunities: [
          {
            id: 11,
            name: "Proyecto CRM",
            accountId: 7,
            stageCode: "waiting",
            lifecycle: "open",
          },
        ],
      },
      modelSnapshot: { readToolResults: [] },
      question: "Que oportunidades tiene la cuenta?",
      processGuide: "",
      effectiveContext: { accountId: 7 },
      conversationHistory: [],
      user: { id: 31 },
      jobId: 18,
      startedAt: new Date("2026-09-30T12:00:00.000Z"),
      featureCode: "mi_coach.chat",
      availableTools: ["searchOpportunities"],
      dependencies: {
        buildStageReadiness: () => null,
        buildCoachPrompt,
        requestMiAgentJson,
      },
    });

    expect(result.result.answer).toBe("Respuesta con datos consultados.");
    expect(result.requestedToolResults).toHaveLength(1);
    expect(result.requestedToolResults[0].result).toEqual([
      expect.objectContaining({ id: 11 }),
    ]);
    expect(buildCoachPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        readToolResults: [
          expect.objectContaining({ toolName: "searchOpportunities" }),
        ],
      }),
      "Que oportunidades tiene la cuenta?",
      "",
      { accountId: 7 },
      [],
    );
    expect(requestMiAgentJson).toHaveBeenCalledOnce();
  });

  it("rechaza tool calls cuando el adaptador no tiene herramientas autorizadas", async () => {
    const requestResponse = vi.fn().mockResolvedValue({ answer: "Sin datos" });
    const result = await completeCoachModelTurn({
      result: { toolCalls: [{ toolName: "searchOpportunities", args: {} }] },
      clarification: null,
      snapshot: { coachOpportunities: [{ id: 11, name: "Privada" }] },
      modelSnapshot: { readToolResults: [] },
      question: "Lista oportunidades",
      processGuide: "",
      effectiveContext: {},
      conversationHistory: [],
      user: { id: 31 },
      jobId: 18,
      startedAt: new Date("2026-10-01T12:00:00.000Z"),
      featureCode: "mi_coach.chat",
      availableTools: [],
      dependencies: {
        buildStageReadiness: () => null,
        buildCoachPrompt: (snapshot) => snapshot,
        requestResponse,
        executeReadTool: vi.fn(),
      },
    });

    expect(result.requestedToolResults[0]).toMatchObject({
      result: null,
      error: "Read tool no autorizada o no disponible.",
    });
    expect(
      requestResponse.mock.calls[0][0].payload.readToolResults[0].error,
    ).toBe("Read tool no autorizada o no disponible.");
  });

  it("registra la segunda pasada de IA con el canal y job type de prospeccion", async () => {
    const requestResponse = vi.fn().mockResolvedValue({ answer: "Respuesta" });
    const result = await completeCoachModelTurn({
      result: { toolCalls: [{ toolName: "searchProspectFindings", args: {} }] },
      clarification: null,
      snapshot: {},
      modelSnapshot: { readToolResults: [] },
      question: "Que evidencia tenemos?",
      processGuide: "",
      effectiveContext: { prospectSessionId: 12 },
      conversationHistory: [{ role: "user", text: "Contexto anterior" }],
      user: { id: 31 },
      jobId: null,
      startedAt: new Date("2026-10-01T12:00:00.000Z"),
      featureCode: "prospect_research.chat",
      channel: "prospect",
      jobType: "prospect_chat",
      availableTools: ["searchProspectFindings"],
      dependencies: {
        buildStageReadiness: () => null,
        buildCoachPrompt: () => ({}),
        requestResponse,
        executeReadTool: () => ({
          toolName: "searchProspectFindings",
          readOnly: true,
          result: [],
        }),
      },
    });

    expect(result.result.answer).toBe("Respuesta");
    expect(requestResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "prospect_tool_results",
        featureCode: "prospect_research.chat",
        jobType: "prospect_chat",
      }),
    );
  });

  it("devuelve el contrato común y el contexto actualizado", async () => {
    const response = {
      intent: "context_query",
      responseType: "informational",
      answer: "Respuesta comun.",
      facts: [],
      evidence: [],
      inferences: [],
      pendingItems: [],
      recommendation: null,
      confidence: "high",
      entities: {
        accountId: null,
        opportunityId: null,
        contactId: null,
        leadId: null,
        names: [],
      },
      operations: [],
      clarification: null,
      action: null,
      stageReadiness: null,
    };
    const activeAdminRules = [
      {
        id: "common-test-rule",
        title: "Common test rule",
        instruction: "Use a shared policy.",
        enabled: true,
      },
    ];
    const loadAdministrativeRules = vi.fn().mockResolvedValue(activeAdminRules);
    const classifyCoachIntentWithModel = vi.fn().mockResolvedValue({
      intent: "general_query",
      confidence: 0.97,
      contextNeeded: [],
    });
    let promptSnapshot = null;
    const result = await runConversationEngine({
      question: "¿Cuál es el proceso de ventas?",
      context: { accountId: 7 },
      history: [],
      user: { id: 31 },
      jobId: 18,
      dependencies: {
        getMiAgentContext: async () => ({
          accounts: [],
          coachOpportunities: [],
        }),
        resolveCoachContextEntities: () => ({
          explicitEntities: {
            account: null,
            opportunity: null,
            contact: null,
            lead: null,
            candidates: {
              accounts: [],
              opportunities: [],
              contacts: [],
              leads: [],
            },
          },
        }),
        applyCoachEntityResolution: () => ({
          context: { accountId: 7 },
          changed: false,
          conflict: null,
        }),
        normalizeCoachMatchText: (value) => String(value).toLowerCase(),
        buildCoachEntityClarification: () => null,
        getMiAgentEnrichedContext: async () => ({
          accounts: [],
          coachOpportunities: [],
          selectedContext: { accountId: 7 },
        }),
        buildCoachScopedSnapshot: (snapshot) => snapshot,
        isStagePreparationQuestion: () => false,
        buildStageReadiness: () => null,
        loadProcessGuide: async () => "",
        requestMiAgentJson: async () => response,
        loadAdministrativeRules,
        loadCoachIntentCatalog: async () => [],
        classifyCoachIntentWithModel,
        buildCoachPrompt: (snapshot) => {
          promptSnapshot = snapshot;
          return {};
        },
        resolveCoachResponseContext: () => ({
          context: { accountId: 7 },
          changed: false,
          conflict: null,
        }),
        normalizeCoachResult: (value) => value,
        featureCode: "mi_coach.chat",
      },
    });

    expect(result).toMatchObject({
      response: expect.objectContaining({ answer: "Respuesta comun." }),
      entities: expect.objectContaining({ accountId: 7 }),
      evidence: [],
      inferences: [],
      confidence: "high",
      clarification: null,
      operations: [],
      activeContext: { accountId: 7 },
    });
    expect(result.qualityTrace).toMatchObject({
      channel: "coach",
      process: "process_information",
      validationStatus: "valid",
      primaryEntity: "account",
      evidenceCount: 0,
    });
    expect(loadAdministrativeRules).toHaveBeenCalledWith({
      channel: "coach",
      process: "default",
    });
    expect(classifyCoachIntentWithModel).toHaveBeenCalledTimes(1);
    expect(result.response.intentRouting).toMatchObject({
      intent: "process_information",
      mode: "coaching",
      confidence: 1,
      requiredContext: [],
      allowedTools: [],
    });
    expect(promptSnapshot.administrativeRules).toEqual(activeAdminRules);
    expect(promptSnapshot).not.toHaveProperty("channelIntentRouting");
    expect(promptSnapshot).not.toHaveProperty("channelIntentCatalog");
  });

  it("derives detailed record exploration to Cliente existente without querying details in Coach", async () => {
    const prepareReadModel = vi.fn().mockResolvedValue({
      effectiveContext: { accountId: 12, opportunityId: 41 },
      questionContextTransition: { changed: false },
      scopedSnapshot: {},
      preparationRequested: false,
      selectedOpportunity: {
        id: 41,
        accountId: 12,
        lifecycle: "open",
      },
      deterministicStageReadiness: null,
      readToolResults: [],
      modelSnapshot: { readToolResults: [] },
      clarification: null,
      conversationHistory: [],
      explicitEntities: {
        candidates: {
          accounts: [],
          opportunities: [],
          contacts: [],
          leads: [],
        },
      },
    });
    const requestMiAgentJson = vi.fn();
    const classifyCoachIntentWithModel = vi.fn().mockResolvedValue({
      intent: "quotation_query",
      mode: "deep_exploration",
      detailTarget: "quotation",
      confidence: 0.96,
      contextNeeded: ["opportunity"],
    });
    const result = await runConversationEngine({
      question: "Muéstrame todo el detalle y las partidas de la cotización.",
      context: { accountId: 12, opportunityId: 41 },
      user: {
        id: 31,
        permissionSet: new Set(["cuentas.read", "inteligencia_comercial.read"]),
      },
      dependencies: {
        prepareReadModel,
        loadCoachIntentCatalog: async () => [],
        classifyCoachIntentWithModel,
        loadAdministrativeRules: async () => [],
        loadProcessGuide: async () => "",
        requestMiAgentJson,
        buildCoachPrompt: () => ({}),
        resolveCoachResponseContext: (_snapshot, context) => ({
          context,
          changed: false,
          conflict: null,
        }),
        normalizeCoachResult: (value) => value,
        buildStageReadiness: () => null,
      },
    });

    expect(prepareReadModel).toHaveBeenCalledWith(
      expect.objectContaining({ availableTools: [] }),
    );
    expect(requestMiAgentJson).not.toHaveBeenCalled();
    expect(result.response).toMatchObject({
      intent: "continue_work",
      responseType: "handoff",
      intentRouting: {
        mode: "deep_exploration",
        allowedTools: [],
      },
      detailHandoff: {
        destination: "customer_account",
        detailTarget: "quotation",
        accountId: 12,
        opportunityId: 41,
      },
    });
  });

  it("pide una oportunidad antes de responder una consulta global de actividades", async () => {
    const snapshot = {
      accounts: [],
      coachOpportunities: [],
      wonOpportunities: [],
      lostOpportunities: [],
      cancelledOpportunities: [],
      leads: [],
      contactMappings: [],
    };
    const readModel = await prepareCoachReadModel({
      user: { id: 31 },
      question: "¿Qué actividades están pendientes?",
      availableTools: ["getOpportunityActivities"],
      businessRules: {},
      dependencies: {
        getMiAgentContext: async () => snapshot,
        resolveCoachContextEntities: () => ({
          explicitEntities: {
            account: null,
            opportunity: null,
            contact: null,
            lead: null,
            candidates: {
              accounts: [],
              opportunities: [],
              contacts: [],
              leads: [],
            },
          },
        }),
        applyCoachEntityResolution: (_snapshot, context) => ({
          context,
          changed: false,
          conflict: null,
        }),
        normalizeCoachMatchText: (value) => String(value).toLowerCase(),
        buildCoachEntityClarification: () => null,
        getMiAgentEnrichedContext: async (_user, model) => model,
        buildCoachScopedSnapshot: (value) => value,
        isStagePreparationQuestion: () => false,
        buildStageReadiness: () => null,
      },
    });

    expect(readModel.clarification).toMatchObject({
      type: "select_opportunity",
      missing: ["Oportunidad"],
    });
  });

  it("no exige oportunidad ni ejecuta herramientas para una consulta conceptual del proceso", async () => {
    const readModel = await prepareCoachReadModel({
      user: { id: 31 },
      question: "¿Qué etapas tiene el proceso de venta?",
      availableTools: [
        { name: "searchOpportunities" },
        { name: "getOpportunityReadiness" },
      ],
      businessRules: {},
      intentRouting: {
        intent: "process_information",
        requiredContext: [],
        allowedTools: [],
      },
      dependencies: {
        getMiAgentContext: async () => ({
          accounts: [],
          coachOpportunities: [],
        }),
        resolveCoachContextEntities: () => ({
          explicitEntities: {
            account: null,
            opportunity: null,
            contact: null,
            lead: null,
            candidates: {
              accounts: [],
              opportunities: [],
              contacts: [],
              leads: [],
            },
          },
        }),
        applyCoachEntityResolution: (_snapshot, context) => ({
          context,
          changed: false,
          conflict: null,
        }),
        normalizeCoachMatchText: (value) => String(value).toLowerCase(),
        buildCoachEntityClarification: () => null,
        getMiAgentEnrichedContext: async (_user, snapshot) => snapshot,
        buildCoachScopedSnapshot: (snapshot) => snapshot,
        isStagePreparationQuestion: () => true,
        buildStageReadiness: () => null,
      },
    });

    expect(readModel.clarification).toBeNull();
    expect(readModel.readToolResults).toEqual([]);
    expect(readModel.preparationRequested).toBe(false);
  });

  it("restaura el alcance completo de cartera para priorizar oportunidades tras un foco previo", async () => {
    const snapshot = {
      accounts: [],
      coachOpportunities: [
        {
          id: 41,
          name: "Proyecto de expansión",
          accountId: 12,
          amountUsd: 50000,
          activationStatusCode: "activada",
          lifecycle: "open",
          riskLevel: "high",
        },
        {
          id: 42,
          name: "Proyecto de renovación",
          accountId: 13,
          amountUsd: 30000,
          activationStatusCode: "activada",
          lifecycle: "open",
          riskLevel: "medium",
        },
      ],
      wonOpportunities: [],
      lostOpportunities: [],
      cancelledOpportunities: [],
      leads: [],
      contactMappings: [],
    };
    const scopedContexts = [];
    const resolveCoachContextEntities = vi.fn(() => ({
      explicitEntities: {
        account: null,
        opportunity: null,
        contact: null,
        lead: null,
        candidates: {
          accounts: [],
          opportunities: [],
          contacts: [],
          leads: [],
        },
      },
    }));
    const readModel = await prepareCoachReadModel({
      user: { id: 31 },
      question:
        "Ayúdame a identificar las oportunidades más críticas para priorizar.",
      selectedContext: { accountId: 12, opportunityId: 41 },
      availableTools: [
        { name: "getSellerPipeline" },
        { name: "searchOpportunities" },
      ],
      businessRules: {},
      intentRouting: {
        intent: "seller_coaching",
        mode: "coaching",
        requiredContext: [],
        allowedTools: ["getSellerPipeline", "searchOpportunities"],
      },
      dependencies: {
        getMiAgentContext: async () => snapshot,
        resolveCoachContextEntities,
        applyCoachEntityResolution: (_snapshot, context) => ({
          context,
          changed: false,
          conflict: null,
        }),
        normalizeCoachMatchText: (value) => String(value).toLowerCase(),
        buildCoachEntityClarification: () => null,
        getMiAgentEnrichedContext: async (_user, scopedSnapshot) =>
          scopedSnapshot,
        buildCoachScopedSnapshot: (value, context) => {
          scopedContexts.push(context);
          const opportunityId = Number(context?.opportunityId || 0);
          return opportunityId
            ? {
                ...value,
                coachOpportunities: value.coachOpportunities.filter(
                  (opportunity) => Number(opportunity.id) === opportunityId,
                ),
              }
            : value;
        },
        isStagePreparationQuestion: () => false,
        buildStageReadiness: () => null,
      },
    });

    expect(readModel.readToolResults.map((item) => item.toolName)).toEqual([
      "getSellerPipeline",
      "searchOpportunities",
    ]);
    expect(resolveCoachContextEntities).toHaveBeenCalledWith(
      snapshot,
      "Ayúdame a identificar las oportunidades más críticas para priorizar.",
      [],
      { accountId: 12, opportunityId: 41 },
      {},
      { exactMatchOnly: true },
    );
    expect(readModel.effectiveContext).toMatchObject({
      accountId: null,
      opportunityId: null,
    });
    expect(scopedContexts[0]).toMatchObject({
      accountId: null,
      opportunityId: null,
    });
    expect(readModel.modelSnapshot.pipeline).toMatchObject({
      openCount: 2,
      riskCount: 2,
    });
    expect(readModel.modelSnapshot.coachOpportunities).toHaveLength(2);
  });

  it("no carga detalles enriquecidos ni ejecuta herramientas para exploración detallada", async () => {
    const getMiAgentEnrichedContext = vi.fn();
    const readModel = await prepareCoachReadModel({
      user: { id: 31 },
      question: "Muéstrame el detalle completo de la cotización.",
      selectedContext: { accountId: 12, opportunityId: 41 },
      availableTools: [],
      businessRules: {},
      intentRouting: {
        intent: "quotation_query",
        mode: "deep_exploration",
        detailTarget: "quotation",
        requiredContext: ["opportunity"],
        allowedTools: [],
      },
      dependencies: {
        getMiAgentContext: async () => ({
          accounts: [],
          coachOpportunities: [],
          selectedRecord: {
            type: "opportunity",
            id: 41,
            accountId: 12,
            account: { id: 12, name: "Cuenta Demo" },
            lifecycle: "open",
          },
        }),
        resolveCoachContextEntities: () => ({
          explicitEntities: {
            account: null,
            opportunity: null,
            contact: null,
            lead: null,
            candidates: {
              accounts: [],
              opportunities: [],
              contacts: [],
              leads: [],
            },
          },
        }),
        applyCoachEntityResolution: (_snapshot, context) => ({
          context,
          changed: false,
          conflict: null,
        }),
        normalizeCoachMatchText: (value) => String(value).toLowerCase(),
        buildCoachEntityClarification: () => null,
        getMiAgentEnrichedContext,
        buildCoachScopedSnapshot: (snapshot) => snapshot,
        isStagePreparationQuestion: () => false,
        buildStageReadiness: () => null,
      },
    });

    expect(getMiAgentEnrichedContext).not.toHaveBeenCalled();
    expect(readModel.readToolResults).toEqual([]);
    expect(readModel.modelSnapshot.selectedOpportunityDetail).toBeNull();
    expect(readModel.modelSnapshot.selectedOpportunityQuotation).toBeNull();
  });

  it("incluye contenido de cotizacion autorizado en el contexto de Coach", async () => {
    const quotation = {
      quotationId: 51,
      opportunityId: 11,
      sections: [
        { title: "Licencias", items: [{ description: "Licencia anual" }] },
      ],
    };
    const readModel = await prepareCoachReadModel({
      user: { id: 31 },
      question: "¿Qué contiene la cotización?",
      availableTools: [{ name: "getOpportunityQuotation" }],
      dependencies: {
        getMiAgentContext: async () => ({
          accounts: [],
          coachOpportunities: [],
        }),
        resolveCoachContextEntities: () => ({
          explicitEntities: {
            account: null,
            opportunity: null,
            contact: null,
            lead: null,
          },
        }),
        applyCoachEntityResolution: (_snapshot, context) => ({
          context,
          changed: false,
          conflict: null,
        }),
        normalizeCoachMatchText: (value) => String(value).toLowerCase(),
        buildCoachEntityClarification: () => null,
        getMiAgentEnrichedContext: async (_user, model) => ({
          ...model,
          selectedRecord: { type: "opportunity", id: 11, name: "Proyecto" },
        }),
        buildCoachScopedSnapshot: (snapshot) => snapshot,
        isStagePreparationQuestion: () => false,
        buildStageReadiness: () => null,
        getAuthorizedCoachQuotationContent: vi
          .fn()
          .mockResolvedValue(quotation),
      },
    });

    expect(readModel.modelSnapshot.selectedOpportunityQuotation).toEqual(
      quotation,
    );
    expect(readModel.readToolResults).toEqual([
      expect.objectContaining({
        toolName: "getOpportunityQuotation",
        result: quotation,
      }),
    ]);
  });
});
it("cuenta determinísticamente solo oportunidades abiertas en rankings globales", () => {
  const result = buildDeterministicAccountOpportunityRanking(
    "Que cuentas tienen la mayor cantidad de oportunidades abiertas?",
    [
      ...Array.from({ length: 8 }, (_, index) => ({
        id: index + 1,
        accountId: 22,
        accountName: "Totalplay",
        lifecycle: "open",
      })),
      ...Array.from({ length: 6 }, (_, index) => ({
        id: index + 9,
        accountId: 22,
        accountName: "Totalplay",
        lifecycle: "historical",
      })),
    ],
  );

  expect(result.answer).toContain("Totalplay con 8 oportunidad(es) abiertas");
  expect(result.facts[0]).toMatchObject({ sourceId: 22 });
});
