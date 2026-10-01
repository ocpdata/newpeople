import { describe, expect, test } from "vitest";
import {
  applyCoachEntityResolution,
  buildCoachEntityClarification,
  resolveCoachEntities,
} from "../src/coach/entity-resolver.js";

describe("Coach entity resolver", () => {
  const snapshot = {
    accounts: [
      { id: 7, name: "Acme México", website: "acme.mx" },
      { id: 8, name: "Acme Servicios", website: "servicios.acme.mx" },
    ],
    coachOpportunities: [
      {
        id: 115,
        name: "Descubrimiento de nube",
        stageCode: "contacto_inicial",
      },
      { id: 116, name: "Seguridad de las APIs" },
      {
        id: 117,
        name: "Seguridad de Redes",
        account: { id: 2, name: "Acme Servicios" },
      },
    ],
    wonOpportunities: [
      {
        id: 118,
        name: "Balanceo y Seguridad de Aplicaciones",
        commercialStatusCode: "ganada",
        lifecycle: "historical",
        account: { id: 7 },
      },
    ],
    pipeline: {
      opportunities: [
        { id: 116, name: "Seguridad de las APIs" },
        { id: 117, name: "Seguridad de Redes" },
      ],
    },
    contactMappings: [
      { id: 32, name: "Karla Lobato Bonilla", email: "karla@example.com" },
      { id: 33, name: "Karla Lobato Díaz", email: "karla.diaz@example.com" },
    ],
    leads: [
      {
        id: 88,
        title: "Renovación de APIs",
        summary: "Necesita renovar sus APIs",
      },
      {
        id: 89,
        title: "Renovación de red",
        summary: "Necesita renovar su red",
      },
    ],
  };

  test("resuelve una oportunidad y contacto con nombre parcial", () => {
    const result = resolveCoachEntities(
      snapshot,
      "para seguridad de las apis y karla@example.com",
    );
    expect(result.opportunity?.id).toBe(116);
    expect(result.contact?.id).toBe(32);
  });

  test("la oportunidad nombrada en la pregunta reemplaza la seleccionada", () => {
    const result = resolveCoachEntities(snapshot, "Revisa Seguridad de Redes");
    const transition = applyCoachEntityResolution(
      snapshot,
      { accountId: 7, opportunityId: 118, contactId: 32, leadId: null },
      result,
    );

    expect(transition).toMatchObject({
      changed: true,
      conflict: null,
      context: {
        accountId: 2,
        opportunityId: 117,
        leadId: null,
      },
    });
    expect(transition.context.contactId).toBeNull();
  });

  test("una cuenta restringe la busqueda de oportunidades sin mezclar contactos ni leads", () => {
    const raloySnapshot = {
      accounts: [
        { id: 23, name: "Raloy Lubricantes" },
        { id: 104, name: "Mexicana de Lubricantes" },
      ],
      coachOpportunities: [
        {
          id: 27,
          name: "Balanceo y Seguridad de Aplicaciones",
          accountId: 23,
          account: { id: 23, name: "Raloy Lubricantes" },
        },
      ],
      contactMappings: [
        {
          id: 33,
          name: "Pedro Jiménez",
          email: "pedro.jimenez@raloy.com",
          accountId: 23,
        },
      ],
      leads: [
        {
          id: 71,
          title: "Mexicana de Lubricantes",
          accountId: 104,
        },
      ],
    };
    const resolution = resolveCoachEntities(
      raloySnapshot,
      "¿Qué oportunidades abiertas tiene Raloy Lubricantes?",
    );
    const transition = applyCoachEntityResolution(
      raloySnapshot,
      { accountId: null, opportunityId: null, contactId: null, leadId: null },
      resolution,
    );

    expect(resolution.account?.id).toBe(23);
    expect(resolution.contact).toBeNull();
    expect(resolution.lead).toBeNull();
    expect(transition).toMatchObject({
      changed: true,
      conflict: null,
      context: { accountId: 23, opportunityId: 27, leadId: null },
    });
  });

  test("una pregunta de oportunidades prefiere Prosa Consolidado al lead PROSA", () => {
    const prosaSnapshot = {
      accounts: [
        { id: 24, name: "Prosa (Promoción y Operación S.A. de C.V.)" },
      ],
      coachOpportunities: [
        {
          id: 113,
          name: "Prosa Consolidado",
          accountId: 24,
          account: {
            id: 24,
            name: "Prosa (Promoción y Operación S.A. de C.V.)",
          },
        },
      ],
      leads: [
        {
          id: 209,
          title: "PROSA",
          accountId: null,
        },
      ],
    };
    const resolution = resolveCoachEntities(
      prosaSnapshot,
      "Ahora revisemos las oportunidades de Prosa",
    );
    const transition = applyCoachEntityResolution(
      prosaSnapshot,
      {},
      resolution,
    );

    expect(resolution.opportunity?.id).toBe(113);
    expect(resolution.lead).toBeNull();
    expect(transition.context).toMatchObject({
      accountId: 24,
      opportunityId: 113,
      leadId: null,
    });
  });

  test("mantiene el contexto si la cuenta y oportunidad nombradas no se relacionan", () => {
    const result = resolveCoachEntities(
      {
        ...snapshot,
        coachOpportunities: [
          ...snapshot.coachOpportunities,
          {
            id: 120,
            name: "Oportunidad Acme",
            account: { id: 7 },
          },
        ],
      },
      "Revisa Acme Servicios y Seguridad de Redes",
    );
    const transition = applyCoachEntityResolution(
      snapshot,
      { accountId: 7, opportunityId: 118 },
      result,
    );

    expect(transition.changed).toBe(false);
    expect(transition.conflict).toMatchObject({
      type: "entity_relationship",
    });
    expect(transition.context).toMatchObject({
      accountId: 7,
      opportunityId: 118,
    });
  });

  test("no elige una oportunidad ambigua", () => {
    const result = resolveCoachEntities(snapshot, "seguridad");
    expect(result.opportunity).toBeNull();
    expect(result.candidates.opportunities).toHaveLength(3);
  });

  test("prioriza el nombre de oportunidad sobre la cuenta", () => {
    const totalplaySnapshot = {
      accounts: [{ id: 40, name: "Totalplay" }],
      coachOpportunities: [
        {
          id: 401,
          name: "Vrf 2027",
          accountId: 40,
          account: { id: 40, name: "Totalplay" },
        },
        {
          id: 402,
          name: "Renovacion de infraestructura",
          accountId: 40,
          account: { id: 40, name: "Totalplay" },
        },
      ],
    };
    const result = resolveCoachEntities(
      totalplaySnapshot,
      "Dame el detalle de la oportunidad Vrf 2027 de Totalplay",
    );

    expect(result.opportunity?.id).toBe(401);
    expect(result.candidates.opportunities.map((item) => item.id)).toEqual([
      401,
    ]);
  });

  test("busca oportunidades por cuenta y etapa sin ofrecer leads", () => {
    const totalplaySnapshot = {
      accounts: [{ id: 40, name: "Totalplay" }],
      coachOpportunities: [
        {
          id: 401,
          name: "Renovacion de infraestructura",
          accountId: 40,
          account: { id: 40, name: "Totalplay" },
          stageCode: "waiting",
          stageName: "Waiting",
        },
        {
          id: 402,
          name: "Servicios administrados",
          accountId: 40,
          account: { id: 40, name: "Totalplay" },
          stageCode: "waiting",
          stageName: "Waiting",
        },
      ],
      leads: [{ id: 501, title: "Totalplay", accountId: 40 }],
    };
    const result = resolveCoachEntities(
      totalplaySnapshot,
      "Cual es la oportunidad de Totalplay que esta en waiting?",
    );
    const clarification = buildCoachEntityClarification(
      result,
      "Cual es la oportunidad de Totalplay que esta en waiting?",
    );

    expect(result.candidates.opportunities.map((item) => item.id)).toEqual([
      401,
      402,
    ]);
    expect(result.candidates.leads).toEqual([]);
    expect(clarification).toMatchObject({
      type: "select_opportunity",
      missing: ["Oportunidad"],
    });
    expect(clarification.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 401,
          entityType: "opportunity",
          accountName: "Totalplay",
          stageCode: "waiting",
        }),
      ]),
    );
  });

  test("deduplica registros repetidos por ID", () => {
    const duplicate = {
      id: 130,
      name: "Oportunidad repetida",
      accountId: 7,
      account: { id: 7, name: "Acme México" },
    };
    const result = resolveCoachEntities(
      { ...snapshot, coachOpportunities: [duplicate, { ...duplicate }] },
      "Oportunidad repetida",
    );

    expect(result.candidates.opportunities).toHaveLength(1);
    expect(result.opportunity?.id).toBe(130);
  });

  test("no trata palabras genéricas de seguimiento como nombre de oportunidad", () => {
    const result = resolveCoachEntities(
      {
        ...snapshot,
        coachOpportunities: [
          ...snapshot.coachOpportunities,
          {
            id: 119,
            name: "Sim para Complementar Su Infraestructura",
          },
          { id: 120, name: "Adc para Gateways" },
        ],
      },
      "que numero de cotizaciones fueron las ganadas para esta oportunidad",
    );

    expect(result.opportunity).toBeNull();
    expect(result.candidates.opportunities).toEqual([]);
  });

  test("una pregunta de etapa conserva referencias deícticas en lugar de coincidir con 'Etapa' del título", () => {
    const result = resolveCoachEntities(
      {
        ...snapshot,
        coachOpportunities: [
          ...snapshot.coachOpportunities,
          {
            id: 121,
            name: "Seguridad Movil para Bcp en Peru 2Da Etapa",
          },
        ],
      },
      "¿En qué etapa está?",
    );

    expect(result.opportunity).toBeNull();
    expect(result.candidates.opportunities).toEqual([]);
  });

  test("resuelve cuentas y oportunidades fuera del pipeline calificado", () => {
    const result = resolveCoachEntities(
      snapshot,
      "Revisa acme.mx y Descubrimiento de nube",
    );
    expect(result.account?.id).toBe(7);
    expect(result.opportunity?.id).toBe(115);
  });

  test("resuelve oportunidades ganadas desde el historial separado", () => {
    const result = resolveCoachEntities(
      snapshot,
      "¿Qué pasó con Balanceo y Seguridad de Aplicaciones?",
    );

    expect(result.opportunity).toMatchObject({
      id: 118,
      commercialStatusCode: "ganada",
      lifecycle: "historical",
    });
  });

  test("devuelve candidatos tipados para cuentas ambiguas", () => {
    const result = resolveCoachEntities(snapshot, "Acme");
    expect(result.account).toBeNull();
    expect(result.candidates.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 7, name: "Acme México" }),
        expect.objectContaining({ id: 8, name: "Acme Servicios" }),
      ]),
    );
  });

  test("no elige un contacto ambiguo y conserva candidatos tipados", () => {
    const result = resolveCoachEntities(snapshot, "Karla Lobato");

    expect(result.contact).toBeNull();
    expect(result.candidates.contacts.map((item) => item.id)).toEqual([32, 33]);
    expect(
      buildCoachEntityClarification(result, "Escribe a Karla Lobato"),
    ).toMatchObject({
      type: "select_contact",
      originalRequest: "Escribe a Karla Lobato",
    });
  });

  test("no elige un lead ambiguo y permite resolver uno por título completo", () => {
    const ambiguous = resolveCoachEntities(snapshot, "Renovación");
    const exact = resolveCoachEntities(snapshot, "Renovación de APIs");

    expect(ambiguous.lead).toBeNull();
    expect(ambiguous.candidates.leads).toHaveLength(2);
    expect(
      buildCoachEntityClarification(ambiguous, "Revisa Renovación"),
    ).toMatchObject({ type: "select_lead" });
    expect(exact.lead?.id).toBe(88);
  });

  test("no pide seleccionar una oportunidad cuando se solicita la coleccion", () => {
    const collectionSnapshot = {
      accounts: [{ id: 7, name: "Totalplay" }],
      coachOpportunities: [
        {
          id: 201,
          name: "Proyecto uno",
          accountId: 7,
          account: { id: 7, name: "Totalplay" },
          activationStatusCode: "activada",
        },
        {
          id: 202,
          name: "Proyecto dos",
          accountId: 7,
          account: { id: 7, name: "Totalplay" },
          activationStatusCode: "activada",
        },
      ],
    };
    const resolution = resolveCoachEntities(
      collectionSnapshot,
      "Dime las oportunidades activas de Totalplay",
    );

    expect(resolution.account?.id).toBe(7);
    expect(resolution.opportunity).toBeNull();
    expect(
      buildCoachEntityClarification(
        resolution,
        "Dime las oportunidades activas de Totalplay",
      ),
    ).toBeNull();
  });

  test("no interpreta una pregunta genérica de productos como referencia a leads", () => {
    const result = resolveCoachEntities(
      {
        ...snapshot,
        leads: snapshot.leads.map((lead) => ({
          ...lead,
          summary: `Productos considerados: ${lead.summary}`,
        })),
      },
      "¿Qué productos incluyeron las cotizaciones?",
    );

    expect(result.lead).toBeNull();
    expect(result.candidates.leads).toEqual([]);
  });

  test("construye una aclaración reutilizable que conserva la solicitud", () => {
    const resolution = resolveCoachEntities(snapshot, "Acme");
    const clarification = buildCoachEntityClarification(
      resolution,
      "Actualiza el teléfono de Acme",
    );

    expect(clarification).toEqual(
      expect.objectContaining({
        type: "select_account",
        originalRequest: "Actualiza el teléfono de Acme",
        intendedAction: "continue_request",
      }),
    );
    expect(clarification.candidates).toHaveLength(2);
  });

  test("pide aclaración si el turno menciona varias cuentas aunque haya selección", () => {
    const resolution = resolveCoachEntities(snapshot, "Acme");
    const clarification = buildCoachEntityClarification(
      resolution,
      "Revisa Acme",
      { accountId: 7 },
    );

    expect(clarification).toMatchObject({ type: "select_account" });
  });

  test("pide aclaración si hay varias cuentas y la selección no es candidata", () => {
    const resolution = resolveCoachEntities(snapshot, "Acme");
    expect(
      buildCoachEntityClarification(resolution, "Revisa Acme", {
        accountId: 99,
      }),
    ).toMatchObject({ type: "select_account" });
  });

  test("no interrumpe una oportunidad seleccionada por leads ambiguos", () => {
    const resolution = resolveCoachEntities(
      snapshot,
      "¿Qué productos incluyeron las cotizaciones?",
    );
    const clarification = buildCoachEntityClarification(
      resolution,
      "¿Qué productos incluyeron las cotizaciones?",
      { accountId: 7, opportunityId: 118 },
    );

    expect(resolution.candidates.leads).toEqual([]);
    expect(clarification).toBeNull();
  });
});
