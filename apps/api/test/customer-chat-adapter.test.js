import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/coach/quotation-read-service.js", () => ({
  getAuthorizedCoachQuotationContent: vi.fn(),
}));

import { getAuthorizedCoachQuotationContent } from "../src/coach/quotation-read-service.js";
import { getCoachReadToolCatalog } from "../src/coach/read-tools.js";
import {
  appendCustomerAccountChatHistory,
  buildCustomerReadModel,
  buildCustomerFallback,
  createCustomerAccountAdapter,
  normalizeCustomerOperations,
} from "../src/commercial-intelligence/customer-chat-adapter.js";
import { getCoachBusinessRules } from "../src/coach/business-rules.js";

describe("Customer account chat adapter", () => {
  beforeEach(() => vi.clearAllMocks());

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
      sections: [
        { title: "Licencias", items: [{ description: "Licencia anual" }] },
      ],
    };
    getAuthorizedCoachQuotationContent.mockResolvedValue(quotation);
    const model = await buildCustomerReadModel({
      user: { id: 31 },
      question: "¿Qué contiene la cotización?",
      snapshot: { ...snapshot, selectedOpportunity: snapshot.opportunities[0] },
      availableTools: [{ name: "getOpportunityQuotation" }],
    });

    expect(getAuthorizedCoachQuotationContent).toHaveBeenCalledWith({
      user: { id: 31 },
      opportunityId: 11,
    });
    expect(model.modelSnapshot.selectedOpportunityQuotation).toEqual(quotation);
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
});
