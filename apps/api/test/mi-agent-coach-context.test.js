import { describe, expect, it } from "vitest";
import {
  buildCoachScopedSnapshot,
  coachSessionContextMatchesRequest,
  getCoachConversationHistory,
  getEnabledCoachTerminalStatusCodes,
  resolveCoachTurnContext,
  resolveCoachContextEntities,
  resolveCoachResponseContext,
} from "../src/routes.mi-agent.js";

describe("Coach context optimization", () => {
  const snapshot = {
    pipeline: {
      qualifiedAmount: 300,
      qualifiedCount: 2,
      opportunities: [
        { id: 10, name: "Oportunidad A", amountUsd: 100, account: { id: 1 } },
        { id: 20, name: "Oportunidad B", amountUsd: 200, account: { id: 2 } },
      ],
    },
    workboard: [
      { id: 10, name: "Oportunidad A", account: { id: 1 } },
      { id: 20, name: "Oportunidad B", account: { id: 2 } },
    ],
    coachOpportunities: [
      {
        id: 5,
        name: "Prospecto inicial",
        amountUsd: 50,
        stageCode: "contacto_inicial",
        account: { id: 1 },
      },
      {
        id: 10,
        name: "Oportunidad A",
        amountUsd: 100,
        stageCode: "desarrollo",
        account: { id: 1 },
      },
      {
        id: 20,
        name: "Oportunidad B",
        amountUsd: 200,
        stageCode: "waiting",
        account: { id: 2 },
      },
    ],
    wonOpportunities: [
      {
        id: 70,
        name: "Venta histórica A",
        commercialStatusCode: "ganada",
        lifecycle: "historical",
        account: { id: 1 },
      },
    ],
    lostOpportunities: [
      {
        id: 71,
        name: "Venta perdida B",
        commercialStatusCode: "perdida",
        lifecycle: "historical",
        account: { id: 2 },
      },
    ],
    cancelledOpportunities: [],
    inactivePipelineOpportunities: [
      {
        id: 72,
        name: "Oportunidad desactivada A",
        commercialStatusCode: "en_proceso",
        activationStatusCode: "desactivada",
        lifecycle: "inactive",
        account: { id: 1 },
      },
    ],
    leads: [
      { id: 30, accountId: 1, opportunityId: 10 },
      { id: 40, accountId: 2, opportunityId: 20 },
    ],
    contactMappings: [
      { id: 50, accountId: 1 },
      { id: 60, accountId: 2 },
    ],
  };

  it("maps each governance switch to its terminal commercial status", () => {
    expect(
      getEnabledCoachTerminalStatusCodes({
        includeWonOpportunities: true,
        includeLostOpportunities: false,
        includeCancelledOpportunities: true,
      }),
    ).toEqual(["ganada", "anulada"]);
  });

  it("uses persisted conversation context on a follow-up despite a stale selector payload", () => {
    expect(
      resolveCoachTurnContext(
        { accountId: 44, opportunityId: 65, contactId: 71, leadId: null },
        { accountId: 24, opportunityId: 113, contactId: 34, leadId: null },
        true,
      ),
    ).toEqual({
      accountId: 24,
      opportunityId: 113,
      contactId: 34,
      leadId: null,
      quotationId: null,
      proposalId: null,
    });
  });

  it("uses selector context when starting a new conversation", () => {
    expect(
      resolveCoachTurnContext(
        { accountId: 44, opportunityId: 65, contactId: 71, leadId: null },
        { accountId: 24, opportunityId: 113 },
        false,
      ),
    ).toMatchObject({
      accountId: 44,
      opportunityId: 65,
      contactId: 71,
      leadId: null,
    });
  });

  it("detects a session whose account or lead differs from request context", () => {
    expect(
      coachSessionContextMatchesRequest(
        {
          accountId: 23,
          opportunityId: 27,
          contactId: null,
          leadId: null,
        },
        {
          accountId: 127,
          opportunityId: null,
          contactId: null,
          leadId: 93,
        },
      ),
    ).toBe(false);
  });

  it("keeps legacy untagged turns only for the matching session context", () => {
    const turns = [
      { role: "seller", text: "¿Y sus cotizaciones?" },
      {
        role: "coach",
        text: "Tiene dos cotizaciones ganadas.",
        context: { accountId: 23, opportunityId: 27 },
      },
      {
        role: "seller",
        text: "Resume Gana Lotto",
        context: { accountId: 127, leadId: 93 },
      },
    ];

    expect(
      getCoachConversationHistory(
        turns,
        { accountId: 23, opportunityId: 27 },
        {
          accountId: 23,
          opportunityId: 27,
        },
      ),
    ).toEqual([
      { role: "seller", text: "¿Y sus cotizaciones?" },
      { role: "coach", text: "Tiene dos cotizaciones ganadas." },
    ]);
    expect(
      getCoachConversationHistory(
        turns,
        { accountId: 127, leadId: 93 },
        {
          accountId: 23,
          opportunityId: 27,
        },
      ),
    ).toEqual([]);
  });

  it("does not resolve a prior unrelated lead over a selected opportunity", () => {
    const resolution = resolveCoachContextEntities(
      {
        ...snapshot,
        leads: [{ id: 93, title: "Gana Lotto", accountId: 127 }],
      },
      "¿Cuántas cotizaciones fueron las ganadas para esta oportunidad?",
      [{ role: "seller", text: "Resume Gana Lotto" }],
      { accountId: 23, opportunityId: 27, leadId: null },
    );

    expect(resolution.explicitEntities.candidates.opportunities).toEqual([]);
    expect(resolution.resolvedEntities.candidates.leads).toEqual([]);
  });

  it("adopts an accessible opportunity named in the Coach response", () => {
    const transition = resolveCoachResponseContext(
      snapshot,
      { accountId: 1, opportunityId: 70, contactId: null, leadId: null },
      {
        answer: "La oportunidad Oportunidad B es la más reciente.",
        entities: { names: ["Oportunidad B"] },
        facts: [
          {
            sourceType: "opportunity",
            sourceId: 20,
            label: "Oportunidad B",
            excerpt: "Registro comercial autorizado.",
          },
        ],
      },
    );

    expect(transition).toMatchObject({
      changed: true,
      source: "coach_response",
      context: { accountId: 2, opportunityId: 20 },
    });
  });

  it("prefers an opportunity over a same-title lead ID when the answer says opportunity", () => {
    const prosaSnapshot = {
      ...snapshot,
      accounts: [{ id: 24, name: "Prosa" }],
      coachOpportunities: [
        {
          id: 113,
          name: "Prosa Consolidado",
          accountId: 24,
          account: { id: 24, name: "Prosa" },
        },
      ],
      leads: [{ id: 209, title: "PROSA", accountId: null }],
    };
    const transition = resolveCoachResponseContext(
      prosaSnapshot,
      { accountId: 24, opportunityId: null, leadId: null },
      {
        answer: "La oportunidad Prosa Consolidado está en Waiting.",
        entities: {
          accountId: 24,
          opportunityId: null,
          contactId: null,
          leadId: 209,
          names: ["Prosa Consolidado"],
        },
        facts: [],
      },
    );

    expect(transition.context).toMatchObject({
      accountId: 24,
      opportunityId: 113,
      leadId: null,
    });
  });

  it("adopts an accessible account from the Coach response even without opportunities", () => {
    const transition = resolveCoachResponseContext(
      {
        ...snapshot,
        accounts: [{ id: 90, name: "Cuenta nueva mencionada" }],
      },
      { accountId: 1, opportunityId: 10, contactId: 50, leadId: null },
      {
        answer:
          "La cuenta Cuenta nueva mencionada no tiene oportunidades abiertas.",
        entities: { accountId: 90, names: ["Cuenta nueva mencionada"] },
        facts: [
          {
            sourceType: "account",
            sourceId: 90,
            label: "Cuenta nueva mencionada",
            excerpt: "Cuenta accesible.",
          },
        ],
      },
    );

    expect(transition).toMatchObject({
      changed: true,
      context: {
        accountId: 90,
        opportunityId: null,
        contactId: null,
        leadId: null,
      },
    });
  });

  it("adopts an accessible contact and its owning account from the Coach response", () => {
    const transition = resolveCoachResponseContext(
      snapshot,
      { accountId: 1, opportunityId: 10, contactId: null, leadId: null },
      {
        answer:
          "El contacto Karla Lobato Díaz de Acme Servicios es el decisor.",
        entities: { contactId: 60, names: ["Karla Lobato Díaz"] },
        facts: [
          {
            sourceType: "contact",
            sourceId: 60,
            label: "Karla Lobato Díaz",
            excerpt: "Contacto de la cuenta Acme Servicios.",
          },
        ],
      },
    );

    expect(transition).toMatchObject({
      changed: true,
      context: {
        accountId: 2,
        opportunityId: null,
        contactId: 60,
        leadId: null,
      },
    });
  });

  it("does not adopt an ambiguous multi-opportunity response as active context", () => {
    const transition = resolveCoachResponseContext(
      snapshot,
      { accountId: 1, opportunityId: 10, contactId: null, leadId: null },
      {
        answer: "Oportunidad A y Oportunidad B necesitan seguimiento.",
        entities: { names: [] },
        facts: [
          {
            sourceType: "opportunity",
            sourceId: 10,
            label: "Oportunidad A",
            excerpt: "Primera oportunidad.",
          },
          {
            sourceType: "opportunity",
            sourceId: 20,
            label: "Oportunidad B",
            excerpt: "Segunda oportunidad.",
          },
        ],
      },
    );

    expect(transition.changed).toBe(false);
    expect(transition.context).toMatchObject({
      accountId: 1,
      opportunityId: 10,
    });
  });

  it("preserves the complete snapshot without an explicit context", () => {
    expect(buildCoachScopedSnapshot(snapshot)).toBe(snapshot);
  });

  it("scopes opportunities, leads and contacts to the selected account", () => {
    const scoped = buildCoachScopedSnapshot(snapshot, { accountId: 1 });
    expect(scoped.coachOpportunities.map((item) => item.id)).toEqual([5, 10]);
    expect(scoped.leads.map((item) => item.id)).toEqual([30]);
    expect(scoped.contactMappings.map((item) => item.id)).toEqual([50]);
    expect(scoped.wonOpportunities.map((item) => item.id)).toEqual([70]);
    expect(scoped.lostOpportunities).toEqual([]);
    expect(scoped.inactivePipelineOpportunities.map((item) => item.id)).toEqual(
      [72],
    );
    expect(scoped.accounts.map((item) => item.id)).toEqual([1]);
    expect(scoped.pipeline.qualifiedAmount).toBe(300);
    expect(scoped.pipeline.opportunities.map((item) => item.id)).toEqual([10]);
    expect(scoped.selectedContext.accountId).toBe(1);
  });

  it("does not adopt a response entity outside the selected account snapshot", () => {
    const scopedSnapshot = buildCoachScopedSnapshot(
      {
        ...snapshot,
        accounts: [
          { id: 1, name: "Acme México" },
          { id: 44, name: "Grupo Electrodata" },
        ],
      },
      { accountId: 1, opportunityId: 10 },
    );
    const transition = resolveCoachResponseContext(
      scopedSnapshot,
      { accountId: 1, opportunityId: 10 },
      {
        answer:
          "La oportunidad Seguridad Movil para Bcp en Peru 2Da Etapa es de Grupo Electrodata.",
        entities: {
          names: ["Seguridad Movil para Bcp en Peru 2Da Etapa"],
          accountId: 44,
          opportunityId: 65,
        },
        facts: [
          {
            sourceType: "opportunity",
            sourceId: 65,
            label: "Seguridad Movil para Bcp en Peru 2Da Etapa",
            excerpt: "Oportunidad de Grupo Electrodata.",
          },
        ],
      },
    );

    expect(scopedSnapshot.accounts.map((account) => account.id)).toEqual([1]);
    expect(transition.changed).toBe(false);
    expect(transition.context).toMatchObject({
      accountId: 1,
      opportunityId: 10,
    });
  });

  it("keeps inactive in-process opportunities separate from the active pipeline", () => {
    const scoped = buildCoachScopedSnapshot(snapshot, { accountId: 1 });

    expect(scoped.inactivePipelineOpportunities).toMatchObject([
      {
        id: 72,
        commercialStatusCode: "en_proceso",
        activationStatusCode: "desactivada",
        lifecycle: "inactive",
      },
    ]);
    expect(scoped.coachOpportunities.map((item) => item.id)).toEqual([5, 10]);
    expect(scoped.workboard.map((item) => item.id)).toEqual([10]);
    expect(scoped.selectedRecord).toBeNull();
  });

  it("scopes the context to one opportunity", () => {
    const scoped = buildCoachScopedSnapshot(snapshot, { opportunityId: 20 });
    expect(scoped.coachOpportunities.map((item) => item.id)).toEqual([20]);
    expect(scoped.workboard.map((item) => item.id)).toEqual([20]);
    expect(scoped.pipeline.opportunities.map((item) => item.id)).toEqual([20]);
    expect(scoped.leads.map((item) => item.id)).toEqual([40]);
    expect(scoped.selectedContext.opportunityId).toBe(20);
  });

  it("selects a terminal opportunity without adding it to the open pipeline", () => {
    const scoped = buildCoachScopedSnapshot(snapshot, { opportunityId: 70 });

    expect(scoped.coachOpportunities).toEqual([]);
    expect(scoped.wonOpportunities.map((item) => item.id)).toEqual([70]);
    expect(scoped.selectedRecord).toMatchObject({
      id: 70,
      type: "opportunity",
      commercialStatusCode: "ganada",
    });
    expect(scoped.workboard).toEqual([]);
  });

  it("scopes the context to the selected contact's account", () => {
    const scoped = buildCoachScopedSnapshot(snapshot, { contactId: 60 });
    expect(scoped.coachOpportunities.map((item) => item.id)).toEqual([20]);
    expect(scoped.leads.map((item) => item.id)).toEqual([40]);
    expect(scoped.contactMappings.map((item) => item.id)).toEqual([60]);
    expect(scoped.selectedContext.contactId).toBe(60);
  });

  it("scopes a selected lead and preserves the enriched selected record", () => {
    const enrichedSnapshot = {
      ...snapshot,
      coachOpportunities: snapshot.coachOpportunities.map((item) =>
        item.id === 10
          ? {
              ...item,
              stageQuestions: [{ questionId: 1, status: "pending" }],
              quotations: [{ id: 70 }],
              proposals: [{ id: 80 }],
            }
          : item,
      ),
    };
    const scoped = buildCoachScopedSnapshot(enrichedSnapshot, { leadId: 30 });

    expect(scoped.coachOpportunities.map((item) => item.id)).toEqual([10]);
    expect(scoped.leads.map((item) => item.id)).toEqual([30]);
    expect(scoped.selectedRecord.stageQuestions).toHaveLength(1);
    expect(scoped.selectedRecord.quotations).toHaveLength(1);
    expect(scoped.selectedRecord.proposals).toHaveLength(1);
    expect(scoped.selectedContext.leadId).toBe(30);
  });

  it("keeps all seven commercial stages independently from the qualified pipeline", () => {
    const stageCodes = [
      "contacto_inicial",
      "identificacion_oportunidad",
      "desarrollo",
      "cotizacion",
      "demostracion",
      "negociacion",
      "waiting",
    ];
    const completeSnapshot = {
      ...snapshot,
      coachOpportunities: stageCodes.map((stageCode, index) => ({
        id: index + 1,
        name: stageCode,
        stageCode,
        account: { id: 1 },
      })),
    };

    const scoped = buildCoachScopedSnapshot(completeSnapshot, { accountId: 1 });

    expect(scoped.coachOpportunities.map((item) => item.stageCode)).toEqual(
      stageCodes,
    );
    expect(scoped.pipeline.qualifiedAmount).toBe(300);
    expect(scoped.pipeline.qualifiedCount).toBe(2);
  });
});
