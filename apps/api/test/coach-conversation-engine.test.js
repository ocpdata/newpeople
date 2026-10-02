import { describe, expect, it, vi } from "vitest";
import {
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
} from "../src/coach/conversation-engine.js";
import { getCoachReadToolCatalog } from "../src/coach/read-tools.js";

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
    expect(getConversationChannelJobType("customer_account")).toBe("account_chat");
    expect(getConversationChannelJobType("prospect")).toBe("prospect_chat");
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
          { name: "searchOpportunities", requiredPermission: "oportunidades.read" },
          { name: "searchContacts" },
        ],
        { codes: ["cuentas.read"] },
      ).map((tool) => tool.name),
    ).toEqual(["searchAccounts", "searchContacts"]);
    expect(resolveAvailableCoachTools(getCoachReadToolCatalog(), new Set())).toEqual(
      [],
    );
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
            requiredAnyPermissions: ["cotizaciones.revision", "cotizaciones.operacion"],
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
            requiredAnyPermissions: ["cotizaciones.revision", "cotizaciones.operacion"],
          },
        ],
        new Set(["oportunidades.read"]),
      ),
    ).toEqual([]);
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
      { validation: { requireEvidence: true }, scope: { requireBusinessEvidence: true } },
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
    expect(requestResponse.mock.calls[0][0].payload.readToolResults[0].error).toBe(
      "Read tool no autorizada o no disponible.",
    );
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
      evidence: ["Evidencia CRM"],
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
    const result = await runConversationEngine({
      question: "Resume la cuenta",
      context: { accountId: 7 },
      history: [],
      user: { id: 31 },
      jobId: 18,
      dependencies: {
        getMiAgentContext: async () => ({ accounts: [], coachOpportunities: [] }),
        resolveCoachContextEntities: () => ({
          explicitEntities: {
            account: null,
            opportunity: null,
            contact: null,
            lead: null,
            candidates: { accounts: [], opportunities: [], contacts: [], leads: [] },
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
        buildCoachPrompt: () => ({}),
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
      evidence: ["Evidencia CRM"],
      inferences: [],
      confidence: "high",
      clarification: null,
      operations: [],
      activeContext: { accountId: 7 },
    });
    expect(result.qualityTrace).toMatchObject({
      channel: "coach",
      process: "general_query",
      validationStatus: "valid",
      primaryEntity: "account",
      evidenceCount: 1,
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

  it("incluye contenido de cotizacion autorizado en el contexto de Coach", async () => {
    const quotation = {
      quotationId: 51,
      opportunityId: 11,
      sections: [{ title: "Licencias", items: [{ description: "Licencia anual" }] }],
    };
    const readModel = await prepareCoachReadModel({
      user: { id: 31 },
      question: "¿Qué contiene la cotización?",
      availableTools: [{ name: "getOpportunityQuotation" }],
      dependencies: {
        getMiAgentContext: async () => ({ accounts: [], coachOpportunities: [] }),
        resolveCoachContextEntities: () => ({
          explicitEntities: { account: null, opportunity: null, contact: null, lead: null },
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
        getAuthorizedCoachQuotationContent: vi.fn().mockResolvedValue(quotation),
      },
    });

    expect(readModel.modelSnapshot.selectedOpportunityQuotation).toEqual(quotation);
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
