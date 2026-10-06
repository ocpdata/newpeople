import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/coach/quotation-read-service.js", () => ({
  getAuthorizedCoachQuotationContent: vi.fn(),
}));
vi.mock("../src/structuredWebResearch.js", () => ({
  runStructuredTextResearch: vi.fn(),
}));

import { getAuthorizedCoachQuotationContent } from "../src/coach/quotation-read-service.js";
import { runStructuredTextResearch } from "../src/structuredWebResearch.js";
import * as coachBusinessRulesModule from "../src/coach/business-rules.js";
import * as coachAdminRulesModule from "../src/coach/admin-rules.js";
import * as channelIntentGovernanceModule from "../src/coach/channel-intent-governance.js";
import { resolveCoachEntities } from "../src/coach/entity-resolver.js";
import { getCoachReadToolCatalog } from "../src/coach/read-tools.js";
import { matchCoachQueryCase } from "../src/coach/case-catalog.js";
import { getChannelIntentDefaults } from "../src/coach/channel-intents.js";
import {
  appendCustomerAccountChatHistory,
  buildCustomerQuotationResponse,
  buildCustomerReadModel,
  buildCustomerFallback,
  buildCustomerIntentResponse,
  buildCustomerQueryPlannerContext,
  createCustomerAccountAdapter,
  normalizeCustomerOperations,
  normalizeCustomerResponse,
} from "../src/commercial-intelligence/customer-chat-adapter.js";
import { getCoachBusinessRules } from "../src/coach/business-rules.js";
import { enforceCoachBusinessEvidence } from "../src/coach/conversation-engine.js";
import {
  buildCustomerContactHistoryResponse,
  getCustomerActivityHistoryRange,
  getCustomerActivityHistoryRangeFromFilters,
} from "../src/commercial-intelligence/activity-history.js";
import { buildCustomerEvidenceFailureResponse } from "../src/commercial-intelligence/customer-chat-adapter.js";

describe("Customer account chat adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("plans, retrieves missing authorized evidence, verifies again, then synthesizes", async () => {
    const businessRules = getCoachBusinessRules({
      channel: "customer_account",
      process: "account_chat",
    });
    vi.spyOn(
      coachBusinessRulesModule,
      "loadCoachBusinessRules",
    ).mockResolvedValue(businessRules);
    vi.spyOn(coachAdminRulesModule, "listCoachAdminRules").mockResolvedValue(
      [],
    );
    vi.spyOn(
      channelIntentGovernanceModule,
      "loadChannelIntentConfigurations",
    ).mockResolvedValue(getChannelIntentDefaults("customer_account"));
    runStructuredTextResearch
      .mockResolvedValueOnce({
        objective: "Consultar el estado y seguimiento",
        queries: ["opportunity_status"],
        entities: { opportunityReference: "Proyecto abierto" },
        filters: {},
        ambiguity: {
          reason: "none",
          requiresClarification: "no",
          missingContext: [],
          question: "",
        },
        mode: "read_only",
        confidence: "high",
      })
      .mockResolvedValueOnce({
        status: "incomplete",
        missingQueries: ["account_activity_history"],
        missingFacts: ["Actividades pendientes"],
        clarificationQuestion: "",
      })
      .mockResolvedValueOnce({
        status: "sufficient",
        missingQueries: [],
        missingFacts: [],
        clarificationQuestion: "",
      })
      .mockResolvedValueOnce({
        answer:
          "Proyecto abierto está en Desarrollo. Tiene una llamada pendiente.",
        entities: { opportunityId: 11 },
        evidence: ["Oportunidad 11", "Actividad 31"],
        inferences: [],
        confidence: "high",
        pendingItems: [],
        recommendedActions: [],
        operations: [],
      })
      .mockResolvedValueOnce({
        status: "supported",
        unsupportedClaims: [],
      });

    const adapter = createCustomerAccountAdapter({
      user: {
        id: 31,
        permissionSet: new Set([
          "cuentas.read",
          "oportunidades.read",
          "contactos.read",
          "interacciones.read",
          "desarrollo_comercial.read",
        ]),
      },
      snapshot: {
        ...snapshot,
        selectedOpportunity: {
          ...snapshot.opportunities[0],
          stageName: "Desarrollo",
          stageCode: "desarrollo",
          commercialStatusCode: "en_proceso",
          activationStatusCode: "activada",
          closeDate: "2026-12-15",
        },
        opportunities: [
          {
            ...snapshot.opportunities[0],
            stageName: "Desarrollo",
            stageCode: "desarrollo",
            commercialStatusCode: "en_proceso",
            activationStatusCode: "activada",
            closeDate: "2026-12-15",
          },
        ],
        activities: [
          {
            id: 31,
            accountId: 7,
            opportunityId: 11,
            title: "Llamada pendiente",
            actionType: "call",
            status: "pending",
          },
        ],
      },
      agents: [],
      jobId: 900,
    });

    const result = await adapter.runTurn({
      question:
        "¿Cuál es la etapa de Proyecto abierto y qué actividades tiene pendientes?",
      context: { accountId: 7 },
      history: [],
    });

    expect(result.response.answer).toContain("está en Desarrollo");
    expect(result.response.evidence).toHaveLength(2);
    expect(result.response.entities.opportunityId).toBe(11);
    expect(runStructuredTextResearch.mock.calls[3][0].fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "entities", type: "object" }),
      ]),
    );
    expect(
      result.qualityTrace.diagnostics.evidence.additionalToolMetrics,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolName: "getOpportunityActivities" }),
        expect.objectContaining({ toolName: "searchInteractions" }),
      ]),
    );
    expect(result.qualityTrace.diagnostics.evidence).toMatchObject({
      status: "sufficient",
      rounds: 1,
      additionalReadQueries: 2,
      missingFactsCount: 0,
    });
    expect(runStructuredTextResearch).toHaveBeenCalledTimes(5);
    expect(runStructuredTextResearch.mock.calls[2][0].context.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolName: "getOpportunityActivities" }),
        expect.objectContaining({ toolName: "searchInteractions" }),
      ]),
    );
    expect(runStructuredTextResearch.mock.calls[4][0].schemaName).toBe(
      "customer_account_answer_audit",
    );
    expect(
      runStructuredTextResearch.mock.calls[4][0].context.authorizedEvidence,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolName: "getOpportunity" }),
        expect.objectContaining({ toolName: "getOpportunityActivities" }),
      ]),
    );
    vi.restoreAllMocks();
  });

  it("forwards structured routing to read tools when question wording has no keyword trigger", async () => {
    const businessRules = getCoachBusinessRules({
      channel: "customer_account",
      process: "account_chat",
    });
    vi.spyOn(
      coachBusinessRulesModule,
      "loadCoachBusinessRules",
    ).mockResolvedValue(businessRules);
    vi.spyOn(coachAdminRulesModule, "listCoachAdminRules").mockResolvedValue(
      [],
    );
    vi.spyOn(
      channelIntentGovernanceModule,
      "loadChannelIntentConfigurations",
    ).mockResolvedValue(getChannelIntentDefaults("customer_account"));
    runStructuredTextResearch
      .mockResolvedValueOnce({
        objective: "Consultar interacciones recientes",
        queries: ["account_activity_history"],
        entities: {
          accountReference: "",
          opportunityReference: "",
          contactReference: "",
          leadReference: "",
        },
        filters: {},
        ambiguity: {
          reason: "none",
          requiresClarification: "no",
          missingContext: [],
          question: "",
        },
        mode: "read_only",
        confidence: "high",
      })
      .mockResolvedValueOnce({
        status: "sufficient",
        missingQueries: [],
        missingFacts: [],
      })
      .mockResolvedValueOnce({
        answer: "Hay una interacción reciente registrada.",
        evidence: ["Interacción CRM consultada."],
        inferences: [],
        confidence: "high",
        pendingItems: [],
        recommendedActions: [],
        operations: [],
      })
      .mockResolvedValueOnce({ status: "supported", unsupportedClaims: [] });

    const adapter = createCustomerAccountAdapter({
      user: {
        id: 31,
        permissionSet: new Set(["cuentas.read", "interacciones.read"]),
      },
      snapshot: {
        ...snapshot,
        interactions: [
          {
            id: 41,
            accountId: 7,
            title: "Revisión de propuesta",
            summary: "Revisión comercial",
            createdAt: "2026-09-28T12:00:00.000Z",
          },
        ],
      },
      agents: [],
      jobId: 901,
    });
    const result = await adapter.runTurn({
      question: "Continúa con lo reciente",
      context: { accountId: 7 },
      history: [],
    });

    const evidenceRequest = runStructuredTextResearch.mock.calls[1][0];
    expect(evidenceRequest.schemaName).toBe(
      "customer_account_evidence_assessment",
    );
    expect(evidenceRequest.context.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: "searchInteractions",
          result: [expect.objectContaining({ id: 41 })],
        }),
      ]),
    );
    expect(result.qualityTrace.toolsUsed).toContain("searchInteractions");
    expect(result.response.answer).toBe(
      "Hay una interacción reciente registrada.",
    );
  });

  it("returns the audited proposal for an anaphoric opportunity amount change", async () => {
    const businessRules = getCoachBusinessRules({
      channel: "customer_account",
      process: "account_chat",
    });
    vi.spyOn(
      coachBusinessRulesModule,
      "loadCoachBusinessRules",
    ).mockResolvedValue(businessRules);
    vi.spyOn(coachAdminRulesModule, "listCoachAdminRules").mockResolvedValue(
      [],
    );
    vi.spyOn(
      channelIntentGovernanceModule,
      "loadChannelIntentConfigurations",
    ).mockResolvedValue(getChannelIntentDefaults("customer_account"));
    runStructuredTextResearch
      .mockResolvedValueOnce({
        objective: "Preparar una propuesta de operación CRM",
        queries: ["crm_operation"],
        entities: {
          accountReference: "",
          opportunityReference: "",
          contactReference: "",
          leadReference: "",
        },
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
      })
      .mockResolvedValueOnce({
        status: "sufficient",
        missingQueries: [],
        missingFacts: [],
      })
      .mockResolvedValueOnce({ status: "supported", unsupportedClaims: [] });

    const opportunity = {
      ...snapshot.opportunities[0],
      name: "vrf 2027",
      amountUsd: 42000,
    };
    const otherOpportunity = {
      ...opportunity,
      id: 12,
      name: "Otra oportunidad",
      amountUsd: 15000,
    };
    const adapter = createCustomerAccountAdapter({
      user: {
        id: 31,
        permissionSet: new Set([
          "cuentas.read",
          "oportunidades.read",
          "oportunidades.update",
        ]),
      },
      snapshot: {
        ...snapshot,
        opportunities: [opportunity, otherOpportunity],
      },
      agents: [],
      jobId: 905,
    });

    const result = await adapter.runTurn({
      question: "modifica el monto por 1000000",
      context: { accountId: 7 },
      history: [],
      conversationContext: {
        accountId: 7,
        opportunityId: 11,
      },
    });

    expect(result.response.answer).toContain("Requiere tu confirmación");
    expect(result.response.operations).toEqual([
      expect.objectContaining({
        kind: "opportunity_field",
        opportunityId: 11,
        field: "amountUsd",
        currentValue: 42000,
        value: 1000000,
      }),
    ]);
    expect(runStructuredTextResearch).toHaveBeenCalledTimes(3);
    expect(runStructuredTextResearch.mock.calls[2][0].schemaName).toBe(
      "customer_account_answer_audit",
    );
    expect(runStructuredTextResearch.mock.calls[0][0].context).toMatchObject({
      validatedContinuation: { opportunityName: "vrf 2027" },
      authorizedEntityCandidates: {
        opportunities: [
          expect.objectContaining({
            candidateKey: "opportunity_1",
            name: "vrf 2027",
          }),
        ],
      },
    });
    expect(
      JSON.stringify(runStructuredTextResearch.mock.calls[0][0].context),
    ).not.toContain('"id":11');
    expect(result.response.channelIntentRouting).not.toHaveProperty(
      "serverResolvedEntityIds",
    );
    expect(runStructuredTextResearch.mock.calls[2][0].context).toMatchObject({
      proposalOrigin: "server_deterministic",
    });
    expect(runStructuredTextResearch.mock.calls[2][0].systemPrompt).toContain(
      "no exijas que esos estados aparezcan en el CRM",
    );
    expect(
      runStructuredTextResearch.mock.calls[2][0].context.proposedAnswer
        .operations,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "opportunity_field",
          opportunityId: 11,
          field: "amountUsd",
          value: 1000000,
        }),
      ]),
    );
  });

  it("builds account overview only from queried summary sections", async () => {
    const businessRules = getCoachBusinessRules({
      channel: "customer_account",
      process: "account_chat",
    });
    vi.spyOn(
      coachBusinessRulesModule,
      "loadCoachBusinessRules",
    ).mockResolvedValue(businessRules);
    vi.spyOn(coachAdminRulesModule, "listCoachAdminRules").mockResolvedValue(
      [],
    );
    vi.spyOn(
      channelIntentGovernanceModule,
      "loadChannelIntentConfigurations",
    ).mockResolvedValue(getChannelIntentDefaults("customer_account"));
    runStructuredTextResearch
      .mockResolvedValueOnce({
        objective: "Resumir la cuenta",
        queries: ["account_overview"],
        entities: {
          accountReference: "",
          opportunityReference: "",
          contactReference: "",
          leadReference: "",
        },
        filters: { opportunityStatus: "unspecified" },
        ambiguity: {
          reason: "none",
          requiresClarification: "no",
          missingContext: [],
          question: "",
        },
        mode: "read_only",
        confidence: "high",
      })
      .mockResolvedValueOnce({
        status: "sufficient",
        missingQueries: [],
        missingFacts: [],
      });

    const adapter = createCustomerAccountAdapter({
      user: {
        id: 31,
        permissionSet: new Set([
          "cuentas.read",
          "oportunidades.read",
          "contactos.read",
          "interacciones.read",
        ]),
      },
      snapshot: {
        ...snapshot,
        account: { id: 7, name: "Totalplay" },
        opportunities: [
          {
            id: 11,
            name: "Proyecto abierto 1",
            accountId: 7,
            amountUsd: 1000000,
            lifecycle: "open",
            commercialStatusCode: "en_proceso",
            activationStatusCode: "activada",
          },
          {
            id: 12,
            name: "Proyecto abierto 2",
            accountId: 7,
            amountUsd: 250000,
            lifecycle: "open",
            commercialStatusCode: "en_proceso",
            activationStatusCode: "activada",
          },
          {
            id: 13,
            name: "Proyecto ganado",
            accountId: 7,
            amountUsd: 800000,
            lifecycle: "historical",
            commercialStatusCode: "ganada",
            activationStatusCode: "activada",
          },
        ],
        contacts: [
          { id: 21, accountId: 7, name: "Ana López" },
          { id: 22, accountId: 7, name: "Luis Pérez" },
        ],
        interactions: [
          {
            id: 41,
            accountId: 7,
            title: "Seguimiento reciente",
            createdAt: "2026-10-04T12:00:00.000Z",
          },
        ],
      },
      agents: [],
      jobId: 902,
    });
    const result = await adapter.runTurn({
      question: "Dame un resumen de la cuenta",
      context: { accountId: 7 },
      history: [],
    });

    expect(result.response.answer).toContain("2 oportunidades abiertas");
    expect(result.response.answer).toMatch(/USD 1,250,000|USD 1\.250\.000/);
    expect(result.response.answer).toContain("2 contactos activos visibles");
    expect(result.response.answer).not.toMatch(/interacci[oó]n|61 días|riesgo/i);
    expect(runStructuredTextResearch).toHaveBeenCalledTimes(2);
    expect(result.qualityTrace.toolsUsed).toEqual(
      expect.arrayContaining([
        "searchAccounts",
        "searchOpportunities",
        "searchContacts",
      ]),
    );
    expect(result.qualityTrace.toolsUsed).not.toContain("searchInteractions");
  });

  it("withholds invented final claims and operations rejected by the evidence audit", async () => {
    const businessRules = getCoachBusinessRules({
      channel: "customer_account",
      process: "account_chat",
    });
    vi.spyOn(
      coachBusinessRulesModule,
      "loadCoachBusinessRules",
    ).mockResolvedValue(businessRules);
    vi.spyOn(coachAdminRulesModule, "listCoachAdminRules").mockResolvedValue(
      [],
    );
    vi.spyOn(
      channelIntentGovernanceModule,
      "loadChannelIntentConfigurations",
    ).mockResolvedValue(getChannelIntentDefaults("customer_account"));
    runStructuredTextResearch
      .mockResolvedValueOnce({
        objective: "Consultar oportunidades abiertas",
        queries: ["opportunity_query"],
        entities: {
          accountReference: "",
          opportunityReference: "",
          contactReference: "",
          leadReference: "",
        },
        filters: { opportunityStatus: "open" },
        ambiguity: {
          reason: "none",
          requiresClarification: "no",
          missingContext: [],
          question: "",
        },
        mode: "read_only",
        confidence: "high",
      })
      .mockResolvedValueOnce({
        status: "sufficient",
        missingQueries: [],
        missingFacts: [],
        clarificationQuestion: "",
      })
      .mockResolvedValueOnce({
        answer:
          "Comercial Lumen acordó un contrato anual de USD 120,000 y Ana Torres confirmó la compra.",
        evidence: ["Evidencia CRM autorizada."],
        inferences: [],
        confidence: "high",
        pendingItems: [],
        recommendedActions: [],
        operations: [
          {
            kind: "account_field",
            title: "Marcar compra confirmada",
            accountId: 7,
            field: "companyDescription",
            currentValue: "",
            value: "Compra confirmada",
            evidence: [],
            missingFields: [],
          },
        ],
      })
      .mockResolvedValueOnce({
        status: "unsupported",
        unsupportedClaims: [
          "Contrato anual de USD 120,000 no aparece en la evidencia CRM.",
          "La compra atribuida a Ana Torres no está confirmada por la evidencia.",
        ],
      });

    const adapter = createCustomerAccountAdapter({
      user: {
        id: 31,
        permissionSet: new Set([
          "cuentas.read",
          "oportunidades.read",
          "contactos.read",
        ]),
      },
      snapshot: {
        ...snapshot,
        account: { id: 7, name: "Comercial Lumen", city: "Monterrey" },
        contacts: [
          {
            id: 21,
            accountId: 7,
            name: "Ana Torres",
            positionTitle: "Directora de Operaciones",
          },
        ],
      },
      agents: [],
      jobId: 901,
    });
    const result = await adapter.runTurn({
      question: "¿Qué oportunidades abiertas hay en la cuenta Comercial Lumen?",
      context: { accountId: 7 },
      history: [],
    });

    expect(result.qualityTrace.diagnostics.evidence.status).toBe("sufficient");
    expect(result.qualityTrace.diagnostics.fallback).toEqual({
      used: true,
      reasonCode: "answer_not_grounded",
    });
    expect(result.response.responseType).toBe("error");
    expect(result.response.answer).toContain(
      "no pude redactar una respuesta confiable",
    );
    expect(result.response.answer).not.toContain("120,000");
    expect(result.response.answer).not.toContain("Ana Torres");
    expect(result.response.operations).toEqual([]);
    expect(
      runStructuredTextResearch.mock.calls[3][0].context.authorizedEvidence,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolName: "searchAccounts" }),
      ]),
    );
    expect(
      JSON.stringify(
        runStructuredTextResearch.mock.calls[3][0].context.authorizedEvidence,
      ),
    ).toContain("Comercial Lumen");
  });

  const snapshot = {
    capturedAt: "2026-09-30T12:00:00.000Z",
    account: { id: 7, name: "Totalplay" },
    opportunities: [
      {
        id: 11,
        name: "Proyecto abierto",
        accountId: 7,
        lifecycle: "open",
      },
    ],
    inactiveOpportunities: [],
    contacts: [],
    interactions: [],
    accountHealth: { status: "healthy", score: 80 },
  };

  it("mantiene cuenta fija y operaciones confirmables", () => {
    const adapter = createCustomerAccountAdapter({
      user: { id: 31, permissionSet: new Set(["cuentas.read"]) },
      snapshot,
      agents: [],
      jobId: 10,
    });

    expect(adapter.channel).toBe("customer_account");
    expect(adapter.channelRules).toMatchObject({
      accountScoped: true,
      noSharedCoachSession: true,
    });
    expect(adapter.operationPolicy).toEqual({
      allowedKinds: [
        "activity",
        "stage_answer",
        "lead_call_outcome",
        "account_field",
        "contact_field",
        "opportunity_field",
      ],
      sourceChannel: "customer_account",
    });
    expect(adapter.availableTools.map((tool) => tool.name)).toEqual([
      ...getCoachReadToolCatalog().map((tool) => tool.name),
      "searchInteractions",
    ]);
  });

  it("normaliza operaciones controladas y descarta referencias fuera de la cuenta fija", () => {
    const operations = normalizeCustomerOperations(
      [
        {
          kind: "account_field",
          title: "Actualizar ciudad",
          accountId: 7,
          field: "city",
          currentValue: "Monterrey",
          value: "Guadalajara",
        },
        {
          kind: "opportunity_field",
          title: "Actualizar importe",
          opportunityId: 11,
          field: "amountUsd",
          currentValue: 10000,
          value: 12000,
        },
        {
          kind: "opportunity_field",
          title: "No tocar otra cuenta",
          opportunityId: 99,
          field: "amountUsd",
          currentValue: 10000,
          value: 12000,
        },
      ],
      snapshot,
      { accountId: 7 },
    );

    expect(operations.map((operation) => operation.kind)).toEqual([
      "account_field",
      "opportunity_field",
    ]);
    expect(
      operations.every((operation) => operation.requiresConfirmation),
    ).toBe(true);
    expect(
      operations.every(
        (operation) => operation.sourceChannel === "customer_account",
      ),
    ).toBe(true);
  });

  it("prioriza la intencion de correo en el fallback", () => {
    const result = buildCustomerFallback(
      snapshot,
      "Dame un modelo de correo para enviarlo a Eduardo para buscar mas oportunidades",
    );

    expect(result.answer).toContain("Borrador de correo");
    expect(result.answer).not.toContain("1 oportunidad");
  });

  it("redacta un correo dirigido al contacto sin enviarlo ni añadir acciones ajenas", () => {
    const result = buildCustomerIntentResponse({
      snapshot: {
        ...snapshot,
        contacts: [{ id: 21, name: "Ana López", email: "ana@example.com" }],
        accountHealth: {
          signals: [{ severity: "high", title: "Actividad atrasada" }],
        },
      },
      question:
        "Dame un modelo de correo para escribirle a Ana y conversar sobre nuevas oportunidades",
      routing: {
        intent: "email_draft",
        allowedTools: ["searchContacts"],
      },
      permissions: new Set(["contactos.read"]),
    });

    expect(result.answer).toContain("Borrador de correo para Ana López");
    expect(result.answer).toContain("Asunto:");
    expect(result.answer).toContain("Hola Ana,");
    expect(result.answer).toContain("nuevas oportunidades");
    expect(result.answer).toContain("No se envió el correo.");
    expect(result.operations).toEqual([]);
    expect(result.recommendedActions).toEqual([]);

    const restricted = buildCustomerIntentResponse({
      snapshot: {
        ...snapshot,
        contacts: [{ id: 21, name: "Ana López", email: "ana@example.com" }],
      },
      question: "Dame un modelo de correo para escribirle a Ana",
      routing: { intent: "email_draft", allowedTools: [] },
      permissions: new Set(),
    });
    expect(restricted.answer).toContain("Borrador de correo\nAsunto:");
    expect(restricted.answer).not.toContain("Ana López");
    expect(restricted.evidence.join(" ")).not.toContain("Ana López");
  });

  it("prepara un cambio de monto como operación confirmable y no ejecutada", () => {
    const opportunity = {
      ...snapshot.opportunities[0],
      name: "Solución (Dns) Periodo 2 2026",
      amountUsd: 42000,
    };
    const result = buildCustomerIntentResponse({
      snapshot: {
        ...snapshot,
        opportunities: [opportunity],
      },
      question:
        "Actualiza el monto de la oportunidad Solución (Dns) Periodo 2 2026 a 50000",
      routing: { intent: "crm_operation" },
      permissions: new Set(["oportunidades.update"]),
      allowedOperationKinds: ["activity", "opportunity_field"],
    });

    expect(result.answer).toContain("de USD 42,000 a USD 50,000");
    expect(result.answer).toContain("Requiere tu confirmación");
    expect(result.answer).toContain("todavía no se modificó el CRM");
    expect(result.operations).toEqual([
      expect.objectContaining({
        kind: "opportunity_field",
        opportunityId: 11,
        field: "amountUsd",
        currentValue: 42000,
        value: 50000,
        requiresConfirmation: true,
        sourceChannel: "customer_account",
      }),
    ]);
    expect(
      normalizeCustomerResponse(
        result,
        {
          account: snapshot.account,
          opportunities: [opportunity],
        },
        "Actualiza el monto de la oportunidad Solución (Dns) Periodo 2 2026 a 50000",
        { accountId: 7 },
      ).operations,
    ).toEqual([
      expect.objectContaining({
        kind: "opportunity_field",
        opportunityId: 11,
        field: "amountUsd",
        currentValue: 42000,
        value: 50000,
      }),
    ]);
    expect(result.recommendedActions).toEqual([]);

    const restricted = buildCustomerIntentResponse({
      snapshot: { ...snapshot, opportunities: [opportunity] },
      question:
        "Actualiza el monto de la oportunidad Solución (Dns) Periodo 2 2026 a 50000",
      routing: { intent: "crm_operation" },
      permissions: new Set(["oportunidades.update"]),
      allowedOperationKinds: ["activity"],
    });
    expect(restricted.answer).toContain(
      'habilitar "Campo de oportunidad" en Gobierno de Mi Coach',
    );
    expect(restricted.answer).toContain("No se creó una propuesta");
    expect(restricted.operations).toEqual([]);
    const finalRestrictedResponse = enforceCoachBusinessEvidence(
      normalizeCustomerResponse(
        restricted,
        { account: snapshot.account, opportunities: [opportunity] },
        "Actualiza el monto de la oportunidad Solución (Dns) Periodo 2 2026 a 50000",
        { accountId: 7 },
      ),
      "Actualiza el monto de la oportunidad Solución (Dns) Periodo 2 2026 a 50000",
      {
        validation: { requireEvidence: true },
        scope: { requireBusinessEvidence: true },
      },
    );
    expect(finalRestrictedResponse.responseType).toBe("clarification");
    expect(finalRestrictedResponse.answer).toContain(
      'habilitar "Campo de oportunidad" en Gobierno de Mi Coach',
    );
    expect(finalRestrictedResponse.answer).not.toContain(
      "Indica la cuenta, oportunidad o dato",
    );
    expect(finalRestrictedResponse.operations).toEqual([]);
  });

  it("se niega a proponer el cambio si la oportunidad no es inequívoca o falta permiso", () => {
    const question = "Actualiza el monto de la oportunidad a 50000";
    const denied = buildCustomerIntentResponse({
      snapshot,
      question,
      routing: { intent: "crm_operation" },
      permissions: new Set(),
    });
    expect(denied.answer).toContain("No tienes permiso");
    expect(denied.operations).toEqual([]);

    const unresolved = buildCustomerIntentResponse({
      snapshot,
      question,
      routing: { intent: "crm_operation" },
      permissions: new Set(["oportunidades.update"]),
    });
    expect(unresolved.answer).toContain(
      "No pude identificar una única oportunidad",
    );
    expect(unresolved.operations).toEqual([]);
  });

  it("mantiene el fallback genérico de cuenta sin depender del normalizador", () => {
    const result = buildCustomerFallback(snapshot, "Resume esta cuenta");

    expect(result.answer).toContain("La cuenta Totalplay tiene");
    expect(result.activityHistory).toBeUndefined();
  });

  it("responde el estado de la oportunidad seleccionada en vez de listar la cartera", () => {
    const result = buildCustomerFallback(
      {
        ...snapshot,
        permissions: { canReadOpportunities: true },
        selectedOpportunity: {
          ...snapshot.opportunities[0],
          name: "Solución (Dns) Periodo 2 2026",
          stageName: "Desarrollo",
          commercialStatusCode: "en_proceso",
          activationStatusCode: "activada",
        },
      },
      "¿Cuál es el estado actual de esta oportunidad?",
    );

    expect(result.answer).toContain("Solución (Dns) Periodo 2 2026");
    expect(result.answer).toContain("Desarrollo");
    expect(result.answer).toContain("En proceso");
    expect(result.answer).not.toContain("8 oportunidad(es) abierta(s)");
    expect(result.evidence).toContainEqual(
      expect.stringContaining("Estado CRM de la oportunidad Solución"),
    );
  });

  it("pide identificar la oportunidad si la pregunta singular no tiene foco activo", () => {
    const result = buildCustomerFallback(
      {
        ...snapshot,
        selectedOpportunity: null,
      },
      "¿Cuál es el estado actual de esta oportunidad?",
    );

    expect(result.answer).toContain("No hay una oportunidad seleccionada");
    expect(result.answer).not.toContain("oportunidad(es) abierta(s)");
  });

  it("lista interacciones y actividades del periodo en vez del resumen genérico", () => {
    const now = new Date();
    const recentDate = new Date();
    recentDate.setMonth(recentDate.getMonth() - 2);
    const oldDate = new Date();
    oldDate.setFullYear(oldDate.getFullYear() - 2);
    const result = buildCustomerFallback(
      {
        ...snapshot,
        permissions: {
          canReadInteractions: true,
          canReadOpportunityActivities: true,
          canReadCalendarActivities: true,
        },
        interactions: [
          {
            id: 31,
            title: "Llamada de seguimiento",
            summary: "Confirmar alcance",
            createdAt: recentDate.toISOString(),
          },
          {
            id: 32,
            title: "Interacción fuera del periodo",
            createdAt: oldDate.toISOString(),
          },
        ],
        opportunityActivities: [
          {
            id: 41,
            opportunityId: 11,
            title: "Revisión de propuesta",
            dueDate: recentDate.toISOString().slice(0, 10),
            createdAt: recentDate.toISOString(),
          },
          {
            id: 42,
            opportunityId: 11,
            title: "Actividad futura",
            dueDate: new Date(now.getTime() + 86400000)
              .toISOString()
              .slice(0, 10),
          },
        ],
        calendarActivities: [
          {
            id: 51,
            title: "Llamada desde calendario",
            activityType: "call",
            status: "done",
            scheduledAt: recentDate.toISOString(),
            createdAt: recentDate.toISOString(),
          },
        ],
      },
      "Muéstrame todas las interacciones y actividades de Totalplay de los últimos seis meses",
    );

    expect(result.answer).toContain("Historial de Totalplay · 6 meses");
    expect(result.answer).toContain(
      "1 interacción · 1 actividad de oportunidad · 1 actividad de calendario",
    );
    expect(result.evidence).toEqual([
      expect.stringContaining("Historial CRM de Totalplay consultado"),
    ]);
    expect(
      normalizeCustomerResponse(
        result,
        {},
        "Muéstrame todas las interacciones y actividades de Totalplay de los últimos seis meses",
        { accountId: 7 },
      ).activityHistory,
    ).toEqual(result.activityHistory);
    expect(result.activityHistory.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "interactions",
          items: [expect.objectContaining({ title: "Llamada de seguimiento" })],
        }),
        expect.objectContaining({
          key: "opportunityActivities",
          items: [expect.objectContaining({ title: "Revisión de propuesta" })],
        }),
        expect.objectContaining({
          key: "calendarActivities",
          items: [
            expect.objectContaining({ title: "Llamada desde calendario" }),
          ],
        }),
      ]),
    );
    const historyItems = result.activityHistory.sections.flatMap(
      (section) => section.items,
    );
    expect(historyItems.map((item) => item.title)).not.toContain(
      "Interacción fuera del periodo",
    );
    expect(historyItems.map((item) => item.title)).not.toContain(
      "Actividad futura",
    );
    expect(result.recommendedActions).toEqual([]);
    expect(
      getCustomerActivityHistoryRange(
        "Muéstrame todas las interacciones de los últimos seis meses",
        new Date("2026-10-03T12:00:00.000Z"),
      ),
    ).toEqual({
      months: 6,
      startDate: "2026-04-03",
      endDate: "2026-10-03",
    });
    expect(
      getCustomerActivityHistoryRange(
        "Interacciones de los últimos treinta y cinco días",
        new Date("2026-10-03T12:00:00.000Z"),
      ),
    ).toEqual({
      months: null,
      startDate: "2026-08-29",
      endDate: "2026-10-03",
    });
    expect(
      getCustomerActivityHistoryRange(
        "Actividades Q2 2025",
        new Date("2026-10-03T12:00:00.000Z"),
      ),
    ).toEqual({
      months: 3,
      startDate: "2025-04-01",
      endDate: "2025-06-30",
    });
    expect(
      getCustomerActivityHistoryRange(
        "Interacciones entre 2026-01-01 y 2026-03-31",
        new Date("2026-10-03T12:00:00.000Z"),
      ),
    ).toEqual({
      months: null,
      startDate: "2026-01-01",
      endDate: "2026-03-31",
    });
    expect(
      getCustomerActivityHistoryRange(
        "Historial de interacciones desde 2020-01-01",
        new Date("2026-10-03T12:00:00.000Z"),
      ),
    ).toBeNull();
    expect(
      getCustomerActivityHistoryRange(
        "Interacciones entre 2026-02-30 y 2026-03-31",
        new Date("2026-10-03T12:00:00.000Z"),
      ),
    ).toBeNull();

    const restricted = buildCustomerFallback(
      {
        ...snapshot,
        permissions: {
          canReadInteractions: false,
          canReadOpportunityActivities: false,
          canReadCalendarActivities: false,
        },
        interactions: [
          {
            id: 31,
            title: "No debe mostrarse",
            createdAt: recentDate.toISOString(),
          },
        ],
        opportunityActivities: [
          {
            id: 41,
            title: "Tampoco debe mostrarse",
            dueDate: recentDate.toISOString(),
          },
        ],
        calendarActivities: [
          {
            id: 51,
            title: "Calendario restringido",
            scheduledAt: recentDate.toISOString(),
          },
        ],
      },
      "Muéstrame todas las interacciones y actividades de Totalplay de los últimos seis meses",
    );
    expect(
      restricted.activityHistory.sections.every(
        (section) => !section.available,
      ),
    ).toBe(true);
    expect(restricted.answer).not.toContain("No debe mostrarse");
    expect(restricted.answer).not.toContain("Tampoco debe mostrarse");
    expect(restricted.answer).not.toContain("Calendario restringido");
  });

  it("agrupa los datos y el historial CRM por contacto sin cruzar cuentas", () => {
    const result = buildCustomerContactHistoryResponse(
      {
        account: { id: 7, name: "Totalplay" },
        permissions: {
          canReadContacts: true,
          canReadInteractions: true,
        },
        contacts: [
          {
            id: 21,
            accountId: 7,
            name: "Ana López",
            email: "ana@example.com",
            phone: "5550101",
            positionTitle: "Arquitecta",
          },
          {
            id: 22,
            accountId: 7,
            name: "Luis Pérez",
          },
        ],
        interactions: [
          {
            id: 31,
            accountId: 7,
            contactIds: [21],
            title: "Revisión de propuesta",
            createdAt: "2026-08-01T10:00:00.000Z",
            summary: "Validar alcance técnico",
          },
          {
            id: 32,
            accountId: 8,
            contactIds: [21],
            title: "Interacción de otra cuenta",
            createdAt: "2026-08-02T10:00:00.000Z",
          },
        ],
      },
      "Lista todos los contactos, sus datos y su historial en esta cuenta",
    );

    expect(result.activityHistory).toMatchObject({
      mode: "contact_history",
      contactsAvailable: true,
      interactionsAvailable: true,
      contacts: [
        {
          id: 21,
          name: "Ana López",
          email: "ana@example.com",
          interactionHistoryAvailable: true,
          interactions: [
            expect.objectContaining({
              id: 31,
              title: "Revisión de propuesta",
            }),
          ],
        },
        { id: 22, name: "Luis Pérez", interactions: [] },
      ],
    });
    expect(result.answer).toContain("Contactos de Totalplay · 2 contactos");
  });

  it("devuelve contacto e historial en el fallback y conserva el bloque al normalizar", () => {
    const snapshot = {
      account: { id: 7, name: "Totalplay" },
      permissions: { canReadContacts: true, canReadInteractions: true },
      contacts: [
        {
          id: 21,
          accountId: 7,
          name: "Ana López",
          email: "ana@example.com",
          activationStatusCode: "activado",
        },
      ],
      interactions: [
        {
          id: 31,
          accountId: 7,
          contactIds: [21],
          title: "Seguimiento de propuesta",
          createdAt: "2026-08-01T10:00:00.000Z",
        },
      ],
      opportunities: [],
    };
    const question =
      "Lista todos los contactos, sus datos y su historial en esta cuenta";
    const fallback = buildCustomerFallback(snapshot, question);
    const normalized = normalizeCustomerResponse(fallback, snapshot, question, {
      accountId: 7,
    });

    expect(normalized.activityHistory).toMatchObject({
      mode: "contact_history",
      contacts: [
        {
          name: "Ana López",
          email: "ana@example.com",
          interactions: [
            expect.objectContaining({ title: "Seguimiento de propuesta" }),
          ],
        },
      ],
    });
  });

  it("mantiene historial dentro del contexto fijo de Cliente existente", async () => {
    const history = [
      { role: "user", text: "Resume la cuenta" },
      { role: "assistant", text: "Hay una oportunidad abierta." },
    ];
    const model = await buildCustomerReadModel({
      user: { id: 31 },
      question: "Amplia el resumen anterior",
      snapshot,
      availableTools: [],
      conversationHistory: history,
    });

    expect(model.conversationHistory).toEqual(history);
    expect(model.modelSnapshot.selectedContext).toEqual({
      accountId: 7,
      opportunityId: null,
      contactId: null,
      leadId: null,
    });
  });

  it("loads guidance evidence for an anaphoric opportunity question without keyword triggers", async () => {
    const selectedOpportunity = {
      ...snapshot.opportunities[0],
      lifecycle: "open",
      commercialStatusCode: "en_proceso",
      activationStatusCode: "activada",
    };
    const routing = {
      intent: "opportunity_guidance",
      intents: ["opportunity_guidance"],
      allowedTools: [
        "getOpportunity",
        "getOpportunityActivities",
        "getOpportunityReadiness",
        "searchInteractions",
      ],
      entities: { opportunityReference: selectedOpportunity.name },
      filters: { opportunityStatus: "open" },
      requiresClarification: false,
    };
    const tools = [
      ...getCoachReadToolCatalog(),
      { name: "searchInteractions", requiredPermission: "interacciones.read" },
    ];
    const model = await buildCustomerReadModel({
      user: {
        id: 31,
        permissionSet: new Set([
          "cuentas.read",
          "oportunidades.read",
          "desarrollo_comercial.read",
          "interacciones.read",
        ]),
      },
      question: "¿Qué me sugieres hacer en esta oportunidad?",
      snapshot: { ...snapshot, selectedOpportunity },
      availableTools: tools,
      authorizedTools: tools,
      businessRules: getCoachBusinessRules({
        channel: "customer_account",
        process: "account_chat",
      }),
      channelIntentRouting: routing,
    });

    expect(model.selectedOpportunity.id).toBe(selectedOpportunity.id);
    expect(model.readToolResults.map((item) => item.toolName)).toEqual(
      expect.arrayContaining([
        "getOpportunity",
        "getOpportunityActivities",
        "getOpportunityReadiness",
        "searchInteractions",
      ]),
    );
    expect(
      model.readToolResults.find((item) => item.toolName === "getOpportunity")
        .result.id,
    ).toBe(selectedOpportunity.id);
  });

  it("prioriza el periodo explícito del seguimiento sobre el periodo recordado", async () => {
    const model = await buildCustomerReadModel({
      user: { id: 31 },
      question: "Y muestra las interacciones entre 2026-02-01 y 2026-02-28",
      snapshot: {
        ...snapshot,
        interactions: [
          {
            id: 301,
            accountId: 7,
            title: "Interacción del periodo actual",
            createdAt: "2026-02-15T10:00:00.000Z",
          },
          {
            id: 302,
            accountId: 7,
            title: "Interacción del periodo recordado",
            createdAt: "2025-10-15T10:00:00.000Z",
          },
        ],
      },
      availableTools: [{ name: "searchInteractions" }],
      channelIntentRouting: {
        intent: "account_activity_history",
        intents: ["account_activity_history"],
        allowedTools: ["searchInteractions"],
        entities: {},
        filters: {},
      },
      conversationContext: {
        accountId: 7,
        filters: {
          startDate: "2025-10-01",
          endDate: "2025-10-31",
        },
      },
    });

    expect(model.readToolResults[0].result).toEqual([
      expect.objectContaining({ title: "Interacción del periodo actual" }),
    ]);
  });

  it("no expone oportunidades al modelo cuando la politica de canal las deshabilita", async () => {
    const model = await buildCustomerReadModel({
      user: { id: 31 },
      question: "Que oportunidades abiertas tiene la cuenta?",
      snapshot: {
        ...snapshot,
        selectedOpportunity: snapshot.opportunities[0],
      },
      availableTools: [
        { name: "searchAccounts" },
        { name: "searchOpportunities" },
        { name: "getOpportunity" },
      ],
      businessRules: getCoachBusinessRules({
        channel: "customer_account",
        overrides: {
          scope: { opportunitySearchAllowed: false },
        },
      }),
    });

    expect(model.modelSnapshot.opportunities).toEqual([]);
    expect(model.modelSnapshot.selectedOpportunity).toBeNull();
    expect(model.readToolResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: "searchOpportunities",
          result: null,
          error: expect.stringContaining("politica del canal"),
        }),
      ]),
    );
  });

  it("reutiliza herramientas de Coach sin salir de la cuenta seleccionada", async () => {
    const model = await buildCustomerReadModel({
      user: { id: 31 },
      question: "Muestra el pipeline de oportunidades abiertas",
      snapshot: {
        ...snapshot,
        opportunities: [
          { id: 11, name: "Proyecto propio", accountId: 7, lifecycle: "open" },
          { id: 12, name: "Proyecto ajeno", accountId: 8, lifecycle: "open" },
        ],
        inactiveOpportunities: [
          {
            id: 13,
            name: "Inactiva ajena",
            accountId: 8,
            lifecycle: "inactive",
          },
        ],
      },
      availableTools: [
        { name: "searchAccounts" },
        { name: "searchOpportunities" },
        { name: "getSellerPipeline" },
      ],
    });
    const pipeline = model.readToolResults.find(
      (tool) => tool.toolName === "getSellerPipeline",
    ).result;

    expect(pipeline.opportunities.map((opportunity) => opportunity.id)).toEqual(
      [11],
    );
    expect(
      model.modelSnapshot.opportunities.map((opportunity) => opportunity.id),
    ).toEqual([11]);
  });

  it("prefiere el plan de intención del motor a los disparadores de palabras clave", async () => {
    const model = await buildCustomerReadModel({
      user: { id: 31 },
      question: "Lista todos los contactos y sus interacciones",
      snapshot: {
        ...snapshot,
        contacts: [{ id: 12, accountId: 7, name: "Ana López" }],
        interactions: [{ id: 31, accountId: 7, title: "Llamada" }],
      },
      availableTools: [
        { name: "searchAccounts" },
        { name: "searchContacts" },
        { name: "searchInteractions" },
      ],
      channelIntentRouting: {
        channel: "customer_account",
        intent: "account_overview",
        allowedTools: ["searchAccounts"],
        requiredContext: ["account"],
        missingContext: [],
        requiresClarification: false,
      },
    });

    expect(model.readToolResults.map((item) => item.toolName)).toEqual([
      "searchAccounts",
    ]);
  });

  it("aplica filtros estructurados de estado, etapa y año al buscar oportunidades", async () => {
    const model = await buildCustomerReadModel({
      user: { id: 31 },
      question: "¿Qué iniciativas corresponden a la etapa Desarrollo?",
      snapshot: {
        ...snapshot,
        selectedOpportunity: null,
        opportunities: [
          {
            id: 11,
            accountId: 7,
            name: "Modernización Atlas",
            stageCode: "desarrollo",
            stageName: "Desarrollo",
            commercialStatusCode: "en_proceso",
            activationStatusCode: "activada",
            lifecycle: "open",
            closeDate: "2026-12-15",
          },
          {
            id: 12,
            accountId: 7,
            name: "Renovación Atlas",
            stageCode: "negociacion",
            stageName: "Negociación",
            commercialStatusCode: "en_proceso",
            activationStatusCode: "activada",
            lifecycle: "open",
            closeDate: "2026-12-15",
          },
          {
            id: 13,
            accountId: 7,
            name: "Modernización anterior",
            stageCode: "desarrollo",
            stageName: "Desarrollo",
            commercialStatusCode: "ganada",
            activationStatusCode: "desactivada",
            lifecycle: "historical",
            closeDate: "2025-12-15",
          },
        ],
      },
      availableTools: [{ name: "searchOpportunities" }],
      businessRules: getCoachBusinessRules({ channel: "customer_account" }),
      channelIntentRouting: {
        channel: "customer_account",
        intent: "opportunity_query",
        intents: ["opportunity_query"],
        allowedTools: ["searchOpportunities"],
        filters: {
          opportunityStatus: "open",
          stageCode: "desarrollo",
          closeYear: 2026,
        },
        requiredContext: ["account"],
        missingContext: [],
        requiresClarification: false,
      },
    });

    expect(
      model.readToolResults
        .find((tool) => tool.toolName === "searchOpportunities")
        .result.map((item) => item.id),
    ).toEqual([11]);
  });

  it("usa periodos estructurados y query intent para recuperar actividades y cotizaciones", async () => {
    const activityModel = await buildCustomerReadModel({
      user: { id: 31 },
      question: "¿Qué ocurrió durante el periodo que revisamos?",
      snapshot: {
        ...snapshot,
        interactions: [
          { id: 31, accountId: 7, title: "Anterior", createdAt: "2026-04-30" },
          { id: 32, accountId: 7, title: "Dentro", createdAt: "2026-05-15" },
          { id: 33, accountId: 7, title: "Posterior", createdAt: "2026-07-01" },
        ],
      },
      availableTools: [{ name: "searchInteractions" }],
      businessRules: getCoachBusinessRules({ channel: "customer_account" }),
      channelIntentRouting: {
        channel: "customer_account",
        intent: "account_activity_history",
        intents: ["account_activity_history"],
        allowedTools: ["searchInteractions"],
        filters: {
          periodMonths: 2,
          startDate: "2026-05-01",
          endDate: "2026-06-30",
        },
      },
    });
    expect(
      activityModel.readToolResults
        .find((tool) => tool.toolName === "searchInteractions")
        .result.map((item) => item.id),
    ).toEqual([32]);
    expect(
      getCustomerActivityHistoryRangeFromFilters(
        { periodMonths: 6 },
        new Date("2026-10-03T12:00:00.000Z"),
      ),
    ).toMatchObject({ startDate: "2026-04-03", endDate: "2026-10-03" });

    getAuthorizedCoachQuotationContent.mockResolvedValue({
      id: 51,
      opportunityId: 11,
      proposalName: "Propuesta Atlas",
      sections: [],
    });
    const quotationModel = await buildCustomerReadModel({
      user: { id: 31 },
      question: "Muéstrame las partidas incluidas en este proyecto.",
      snapshot: {
        ...snapshot,
        selectedOpportunity: {
          id: 11,
          name: "Modernización Atlas",
          accountId: 7,
          lifecycle: "open",
        },
      },
      availableTools: [
        { name: "getOpportunityQuotation" },
        { name: "getOpportunity" },
      ],
      businessRules: getCoachBusinessRules({ channel: "customer_account" }),
      channelIntentRouting: {
        channel: "customer_account",
        intent: "quotation_query",
        intents: ["quotation_query"],
        allowedTools: ["getOpportunityQuotation", "getOpportunity"],
        filters: {},
      },
    });
    expect(getAuthorizedCoachQuotationContent).toHaveBeenCalledWith({
      user: { id: 31 },
      opportunityId: 11,
    });
    expect(
      quotationModel.readToolResults.map((tool) => tool.toolName),
    ).toContain("getOpportunityQuotation");
  });

  it("consulta actividades únicamente de la oportunidad seleccionada", async () => {
    const model = await buildCustomerReadModel({
      user: { id: 31 },
      question: "¿Qué actividades tiene la oportunidad?",
      snapshot: {
        ...snapshot,
        selectedOpportunity: snapshot.opportunities[0],
        activities: [
          {
            id: 31,
            accountId: 7,
            opportunityId: 11,
            title: "Llamar al cliente",
            summary: "Revisar propuesta",
          },
          {
            id: 32,
            accountId: 8,
            opportunityId: 12,
            title: "Actividad ajena",
          },
        ],
      },
      availableTools: [{ name: "getOpportunityActivities" }],
    });
    const activities = model.readToolResults.find(
      (tool) => tool.toolName === "getOpportunityActivities",
    ).result;

    expect(activities).toEqual([
      expect.objectContaining({ id: 31, opportunityId: 11 }),
    ]);
  });

  it("reutiliza la evaluacion de readiness de Coach con datos de la cuenta", async () => {
    const model = await buildCustomerReadModel({
      user: { id: 31 },
      question: "¿Qué me falta para avanzar de etapa?",
      snapshot: {
        ...snapshot,
        selectedOpportunity: {
          ...snapshot.opportunities[0],
          salesStageId: 4,
          currentStage: {
            id: 4,
            code: "desarrollo",
            name: "Desarrollo",
            criteria: [
              {
                code: "need_confirmed",
                title: "Necesidad confirmada",
                description: "Validar la necesidad con el cliente.",
                required: true,
              },
            ],
          },
          stageQuestions: [],
          workspace: { criteria: [], actions: [], weaknesses: [] },
        },
      },
      availableTools: [{ name: "getOpportunityReadiness" }],
    });
    const readiness = model.readToolResults.find(
      (tool) => tool.toolName === "getOpportunityReadiness",
    ).result;

    expect(readiness).toMatchObject({
      currentStage: { code: "desarrollo" },
      recommendation: "remain",
      pendingItems: [
        expect.objectContaining({ title: "Necesidad confirmada" }),
      ],
    });
  });

  it("permite buscar leads solo dentro de la cuenta fija", async () => {
    const model = await buildCustomerReadModel({
      user: { id: 31 },
      question: "Busca los leads de la cuenta",
      snapshot: {
        ...snapshot,
        interactions: [
          {
            id: 41,
            accountId: 7,
            title: "Lead propio",
            leadSubstatusCode: "seguimiento",
          },
          {
            id: 42,
            accountId: 8,
            title: "Lead ajeno",
            leadSubstatusCode: "seguimiento",
          },
        ],
      },
      availableTools: [{ name: "searchLeads" }],
      businessRules: getCoachBusinessRules({ channel: "customer_account" }),
    });

    expect(model.readToolResults).toEqual([
      expect.objectContaining({
        toolName: "searchLeads",
        result: [expect.objectContaining({ id: 41, accountId: 7 })],
      }),
    ]);
  });

  it("incluye contenido de cotizacion autorizado en Cliente existente", async () => {
    const quotation = {
      quotationId: 51,
      opportunityId: 11,
      proposalName: "Cotización de Solución DNS",
      versionNumber: 3,
      statusName: "Aprobada",
      quotationDate: "2026-09-15",
      currencyCode: "USD",
      sections: [
        {
          title: "Licencias",
          inclusion: "Incluidos",
          items: [
            {
              description: "Licencia anual",
              itemType: "producto",
              quantity: 2,
              currencyCode: "USD",
              listPriceUnit: 1200,
              discountPct: 10,
            },
          ],
        },
      ],
    };
    getAuthorizedCoachQuotationContent.mockResolvedValue(quotation);
    const question =
      "¿Qué contiene la cotización para la oportunidad Solución (Dns) Periodo 2 2026?";
    expect(matchCoachQueryCase(question)).toMatchObject({
      type: "quotation_query",
      readTool: "getOpportunityQuotation",
    });
    const minimalResolution = resolveCoachEntities(
      {
        coachOpportunities: [
          { id: 11, name: "Solución (Dns) Periodo 2 2026", accountId: 7 },
        ],
      },
      question,
      {},
      { ignoreStageFilters: true },
    );
    expect(minimalResolution.candidates.opportunities).toHaveLength(1);
    const entityResolution = resolveCoachEntities(
      {
        accounts: [{ id: 7, name: "Totalplay" }],
        coachOpportunities: [
          {
            ...snapshot.opportunities[0],
            name: "Solución (Dns) Periodo 2 2026",
            account: { id: 7, name: "Totalplay" },
          },
        ],
      },
      question,
      {},
      { ignoreStageFilters: true },
    );
    expect(entityResolution.candidates.opportunities).toEqual([
      expect.objectContaining({ id: 11 }),
    ]);
    const model = await buildCustomerReadModel({
      user: { id: 31 },
      question,
      snapshot: {
        ...snapshot,
        opportunities: [
          {
            ...snapshot.opportunities[0],
            name: "Solución (Dns) Periodo 2 2026",
          },
        ],
      },
      availableTools: [{ name: "getOpportunityQuotation" }],
    });

    expect(model.selectedOpportunity?.id).toBe(11);
    expect(getAuthorizedCoachQuotationContent).toHaveBeenCalledWith({
      user: { id: 31 },
      opportunityId: 11,
    });
    expect(model.modelSnapshot.selectedOpportunityQuotation).toEqual(quotation);
    const response = buildCustomerQuotationResponse(
      model.modelSnapshot,
      question,
    );
    expect(response).toMatchObject({
      answer: expect.stringContaining("Cotización de Solución DNS"),
      activityHistory: {
        mode: "quotation",
        sections: [
          expect.objectContaining({
            title: "Licencias",
            items: [expect.objectContaining({ title: "Licencia anual" })],
          }),
        ],
      },
    });
    expect(model.readToolResults).toEqual([
      expect.objectContaining({
        toolName: "getOpportunityQuotation",
        result: quotation,
      }),
    ]);
  });

  it("aclara permisos antes de seleccionar una oportunidad y respeta la politica de canal", async () => {
    const user = { id: 31 };
    const question = "¿Qué contiene la cotización?";
    const noPermissionModel = await buildCustomerReadModel({
      user,
      question,
      snapshot,
      availableTools: [],
    });

    expect(noPermissionModel.clarification).toMatchObject({
      type: "missing_fields",
      missing: ["Permiso de lectura de cotizaciones"],
    });
    expect(noPermissionModel.clarification.candidates).toEqual([]);
    expect(getAuthorizedCoachQuotationContent).not.toHaveBeenCalled();

    const blockedModel = await buildCustomerReadModel({
      user,
      question,
      snapshot: { ...snapshot, selectedOpportunity: snapshot.opportunities[0] },
      availableTools: [{ name: "getOpportunityQuotation" }],
      businessRules: getCoachBusinessRules({
        channel: "customer_account",
        overrides: { scope: { opportunitySearchAllowed: false } },
      }),
    });

    expect(getAuthorizedCoachQuotationContent).not.toHaveBeenCalled();
    expect(blockedModel.modelSnapshot.selectedOpportunityQuotation).toBeNull();
    expect(blockedModel.readToolResults).toEqual([
      expect.objectContaining({
        toolName: "getOpportunityQuotation",
        result: null,
        error: expect.stringContaining("politica del canal"),
      }),
    ]);
  });

  it("agrega memoria dentro de una sesion y conserva solo ocho mensajes", () => {
    const history = Array.from({ length: 6 }, (_, index) => index + 1).flatMap(
      (turn) => [
        { role: "user", text: `Pregunta ${turn}` },
        { role: "assistant", text: `Respuesta ${turn}` },
      ],
    );

    expect(
      appendCustomerAccountChatHistory(history, "Pregunta 7", "Respuesta 7"),
    ).toEqual(
      [4, 5, 6, 7].flatMap((turn) => [
        { role: "user", text: `Pregunta ${turn}` },
        { role: "assistant", text: `Respuesta ${turn}` },
      ]),
    );
  });

  it("persiste y conserva la estructura de historial al continuar una sesion", () => {
    const activityHistory = {
      range: { months: 6, startDate: "2026-04-03", endDate: "2026-10-03" },
      sections: [
        {
          key: "interactions",
          title: "Interacciones",
          available: true,
          items: [
            { id: 31, date: "2026-07-31", title: "Llamada de seguimiento" },
          ],
        },
      ],
    };
    const history = appendCustomerAccountChatHistory(
      [],
      "Muéstrame las interacciones de los últimos seis meses",
      "Historial de Totalplay · 6 meses · 1 interacción.",
      { activityHistory },
    );
    const continued = appendCustomerAccountChatHistory(
      history,
      "¿Qué ocurrió en esa llamada?",
      "Se confirmó el siguiente paso.",
    );

    expect(continued[1].activityHistory).toEqual(activityHistory);
    expect(continued[3]).not.toHaveProperty("activityHistory");
  });

  it("builds a minimal planner context without candidate IDs or contact details", () => {
    const planningContext = buildCustomerQueryPlannerContext({
      question: "¿Qué ocurrió con Proyecto abierto y Ana Torres?",
      context: { accountId: 7 },
      conversationHistory: [],
      conversationContext: {
        version: 1,
        accountId: 7,
        opportunityId: 11,
        contactId: 21,
        leadId: null,
        intents: ["contact_query"],
        filters: { periodMonths: 3 },
      },
      availableTools: [
        { name: "searchOpportunities" },
        { name: "searchContacts" },
      ],
      catalog: [
        {
          code: "opportunity_query",
          label: "Oportunidades",
          description: "Consulta oportunidades autorizadas.",
          enabled: true,
        },
      ],
      snapshot: {
        ...snapshot,
        contacts: [
          {
            id: 21,
            accountId: 7,
            name: "Ana Torres",
            email: "ana@example.test",
            positionTitle: "Directora de Operaciones",
          },
        ],
      },
      businessRules: getCoachBusinessRules({ channel: "customer_account" }),
    });

    expect(planningContext.authorizedEntityCandidates).toMatchObject({
      opportunities: [expect.objectContaining({ name: "Proyecto abierto" })],
      contacts: [
        expect.objectContaining({
          name: "Ana Torres",
          positionTitle: "Directora de Operaciones",
        }),
      ],
    });
    expect(planningContext.permittedToolNames).toEqual([
      "searchOpportunities",
      "searchContacts",
    ]);
    expect(planningContext.validatedContinuation).toEqual({
      opportunityName: "Proyecto abierto",
      contactName: "Ana Torres",
      leadTitle: "",
      intents: ["contact_query"],
      filters: { periodMonths: 3 },
    });
    expect(planningContext.trustedContinuationReferences).toEqual([
      "Proyecto abierto",
      "Ana Torres",
    ]);
    expect(planningContext).not.toHaveProperty("businessRules");
    expect(planningContext).not.toHaveProperty("administrativeRules");
    expect(planningContext).not.toHaveProperty("permissions");
    expect(planningContext).not.toHaveProperty("operationPolicy");
    expect(JSON.stringify(planningContext)).not.toContain('"id"');
    expect(JSON.stringify(planningContext)).not.toContain("ana@example.test");
    expect(JSON.stringify(planningContext)).not.toContain("amountUsd");
  });

  it("exposes the explicitly selected record as an opaque planner candidate", () => {
    const planningContext = buildCustomerQueryPlannerContext({
      question: "sube el monto",
      context: { accountId: 7, opportunityId: 11 },
      conversationHistory: [],
      conversationContext: null,
      availableTools: [{ name: "getOpportunity" }],
      catalog: [],
      snapshot,
      businessRules: getCoachBusinessRules({ channel: "customer_account" }),
    });

    expect(planningContext.authorizedEntityCandidates.opportunities).toEqual([
      expect.objectContaining({
        candidateKey: "opportunity_1",
        name: "Proyecto abierto",
      }),
    ]);
    expect(JSON.stringify(planningContext)).not.toContain('"id":11');
  });

  it("distinguishes empty results, query errors and unverified answer failures", () => {
    const noResults = buildCustomerEvidenceFailureResponse({
      status: "no_results",
      missingQueries: ["account_activity_history"],
    });
    const queryError = buildCustomerEvidenceFailureResponse({
      status: "query_error",
      failedSources: ["interactions"],
    });
    const synthesisError = buildCustomerEvidenceFailureResponse({
      status: "answer_generation_error",
    });
    const adapterError = buildCustomerEvidenceFailureResponse({
      status: "adapter_execution_error",
      errorCode: "adapter_execution_failed",
    });

    expect(noResults.answer).toContain("no devolvieron registros");
    expect(noResults.answer).toContain("no confirma que nunca");
    expect(noResults.pendingItems).toContain("interacciones y actividades");
    expect(queryError.answer).toContain("falló la consulta de interactions");
    expect(queryError.answer).not.toContain("no devolvieron registros");
    expect(synthesisError.answer).toContain("La evidencia se verificó");
    expect(synthesisError.answer).not.toContain("No fue posible verificar");
    expect(adapterError.responseType).toBe("error");
    expect(adapterError.answer).toContain("error interno");
    expect(adapterError.answer).not.toContain("falló la consulta");
  });

  it("uses a safe alternative when the final answer contains unsupported CRM claims", async () => {
    const businessRules = getCoachBusinessRules({
      channel: "customer_account",
      process: "account_chat",
    });
    vi.spyOn(
      coachBusinessRulesModule,
      "loadCoachBusinessRules",
    ).mockResolvedValue(businessRules);
    vi.spyOn(coachAdminRulesModule, "listCoachAdminRules").mockResolvedValue(
      [],
    );
    vi.spyOn(
      channelIntentGovernanceModule,
      "loadChannelIntentConfigurations",
    ).mockResolvedValue(getChannelIntentDefaults("customer_account"));
    runStructuredTextResearch
      .mockResolvedValueOnce({
        objective: "Consultar oportunidades abiertas",
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
      })
      .mockResolvedValueOnce({
        status: "sufficient",
        missingQueries: [],
        missingFacts: [],
      })
      .mockResolvedValueOnce({
        answer:
          "La cuenta firmó un contrato anual de USD 120,000 confirmado por Ana Torres.",
        evidence: ["Resumen CRM disponible."],
        inferences: [],
        confidence: "high",
        pendingItems: [],
        recommendedActions: [],
        operations: [
          {
            kind: "account_field",
            title: "Marcar contrato firmado",
            accountId: 7,
            field: "companyDescription",
            currentValue: "",
            value: "Contrato firmado",
            evidence: [],
            missingFields: [],
          },
        ],
      })
      .mockResolvedValueOnce({
        status: "unsupported",
        unsupportedClaims: [
          "El monto y la firma no aparecen en los resultados CRM autorizados.",
        ],
      });

    const adapter = createCustomerAccountAdapter({
      user: {
        id: 31,
        permissionSet: new Set([
          "cuentas.read",
          "oportunidades.read",
          "contactos.read",
        ]),
      },
      snapshot: {
        ...snapshot,
        account: { id: 7, name: "Comercial Lumen", city: "Monterrey" },
      },
      agents: [],
      jobId: 902,
    });
    const result = await adapter.runTurn({
      question: "¿Qué oportunidades abiertas hay en la cuenta Comercial Lumen?",
      context: { accountId: 7 },
      history: [],
    });

    const synthesisContext = runStructuredTextResearch.mock.calls[2][0].context;
    const auditContext = runStructuredTextResearch.mock.calls[3][0].context;
    expect(synthesisContext.authorizedEvidence).toEqual(
      auditContext.authorizedEvidence,
    );
    expect(synthesisContext).not.toHaveProperty("agents");
    expect(synthesisContext).not.toHaveProperty("snapshot");

    expect(
      auditContext.authorizedEvidence,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolName: "searchAccounts" }),
      ]),
    );
    expect(
      JSON.stringify(
        auditContext.authorizedEvidence,
      ),
    ).toContain("Comercial Lumen");
    expect(result.response.responseType).toBe("error");
    expect(result.response.answer).toContain(
      "no pude redactar una respuesta confiable",
    );
    expect(result.response.answer).not.toContain("120,000");
    expect(result.response.answer).not.toContain("Ana Torres");
    expect(result.response.operations).toEqual([]);
    expect(result.qualityTrace.diagnostics.fallback.reasonCode).toBe(
      "answer_not_grounded",
    );
  });

  it("does not turn a CRM snapshot error into an empty-result answer", async () => {
    const businessRules = getCoachBusinessRules({
      channel: "customer_account",
      process: "account_chat",
    });
    vi.spyOn(
      coachBusinessRulesModule,
      "loadCoachBusinessRules",
    ).mockResolvedValue(businessRules);
    vi.spyOn(coachAdminRulesModule, "listCoachAdminRules").mockResolvedValue(
      [],
    );
    vi.spyOn(
      channelIntentGovernanceModule,
      "loadChannelIntentConfigurations",
    ).mockResolvedValue(getChannelIntentDefaults("customer_account"));
    runStructuredTextResearch
      .mockResolvedValueOnce({
        objective: "Consultar historial de interacciones",
        queries: ["account_activity_history"],
        entities: {},
        filters: { periodMonths: 6 },
        ambiguity: {
          reason: "none",
          requiresClarification: "no",
          missingContext: [],
          question: "",
        },
        mode: "read_only",
        confidence: "high",
      })
      .mockResolvedValueOnce({
        status: "no_results",
        missingQueries: [],
        missingFacts: [],
      });

    const adapter = createCustomerAccountAdapter({
      user: {
        id: 31,
        permissionSet: new Set(["cuentas.read", "interacciones.read"]),
      },
      snapshot,
      snapshotQueryMetrics: [
        {
          source: "interactions",
          resultCount: 0,
          resultLimit: 30,
          truncated: null,
          errorCode: "query_error",
        },
      ],
      agents: [],
      jobId: 903,
    });
    const result = await adapter.runTurn({
      question: "Muestra todas las interacciones de los últimos seis meses",
      context: { accountId: 7 },
      history: [],
    });

    expect(result.response.responseType).toBe("error");
    expect(result.response.answer).toContain("falló la consulta");
    expect(result.response.answer).not.toContain("no devolvieron registros");
    expect(result.response.operations).toEqual([]);
    expect(runStructuredTextResearch).toHaveBeenCalledTimes(2);
    expect(result.qualityTrace.diagnostics.evidence.status).toBe("query_error");
  });

  it.each([
    [
      "inconclusive",
      { status: "inconclusive", unsupportedClaims: [] },
      "answer_audit_inconclusive",
    ],
    ["unavailable", null, "answer_audit_unavailable"],
  ])(
    "fails closed and removes proposed operations when the final-answer audit is %s",
    async (_label, auditResult, expectedReason) => {
      const businessRules = getCoachBusinessRules({
        channel: "customer_account",
        process: "account_chat",
      });
      vi.spyOn(
        coachBusinessRulesModule,
        "loadCoachBusinessRules",
      ).mockResolvedValue(businessRules);
      vi.spyOn(coachAdminRulesModule, "listCoachAdminRules").mockResolvedValue(
        [],
      );
      vi.spyOn(
        channelIntentGovernanceModule,
        "loadChannelIntentConfigurations",
      ).mockResolvedValue(getChannelIntentDefaults("customer_account"));
      runStructuredTextResearch
        .mockResolvedValueOnce({
          objective: "Consultar oportunidades abiertas",
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
        })
        .mockResolvedValueOnce({
          status: "sufficient",
          missingQueries: [],
          missingFacts: [],
        })
        .mockResolvedValueOnce({
          answer: "La cuenta tiene una oportunidad abierta.",
          evidence: ["Evidencia propuesta."],
          inferences: [],
          confidence: "high",
          pendingItems: [],
          recommendedActions: [],
          operations: [
            {
              kind: "account_field",
              title: "Actualizar descripción",
              accountId: 7,
              field: "companyDescription",
              currentValue: "",
              value: "Dato propuesto",
              evidence: [],
              missingFields: [],
            },
          ],
        })
        .mockResolvedValueOnce(auditResult);

      const adapter = createCustomerAccountAdapter({
        user: {
          id: 31,
          permissionSet: new Set(["cuentas.read", "oportunidades.read"]),
        },
        snapshot: {
          ...snapshot,
          account: { id: 7, name: "Comercial Lumen" },
        },
        agents: [],
        jobId: 904,
      });
      const result = await adapter.runTurn({
        question: "¿Qué oportunidades abiertas hay en la cuenta?",
        context: { accountId: 7 },
        history: [],
      });

      expect(result.response.responseType).toBe("error");
      expect(result.response.answer).toContain(
        "no pude redactar una respuesta confiable",
      );
      expect(result.response.answer).not.toContain(
        "La cuenta tiene una oportunidad abierta",
      );
      expect(result.response.operations).toEqual([]);
      expect(result.qualityTrace.diagnostics.fallback).toEqual({
        used: true,
        reasonCode: expectedReason,
      });
    },
  );
});
