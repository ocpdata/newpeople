import { describe, expect, it, vi } from "vitest";
import {
  applyCoachOperationPolicy,
  buildDeterministicAccountOpportunityRanking,
  completeCoachModelTurn,
  normalizeCoachToolCalls,
  resolveAvailableCoachTools,
  runConversationEngine,
} from "../src/coach/conversation-engine.js";

describe("Coach conversation engine", () => {
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
          { name: "searchAccounts", requiredPermission: "accounts.read" },
          { name: "searchOpportunities", requiredPermission: "opportunities.read" },
          { name: "searchContacts" },
        ],
        { codes: ["accounts.read"] },
      ).map((tool) => tool.name),
    ).toEqual(["searchAccounts", "searchContacts"]);
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
