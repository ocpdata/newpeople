import { describe, expect, test } from "vitest";
import {
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
      { id: 117, name: "Seguridad de Redes" },
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

  test("no elige una oportunidad ambigua", () => {
    const result = resolveCoachEntities(snapshot, "seguridad");
    expect(result.opportunity).toBeNull();
    expect(result.candidates.opportunities).toHaveLength(3);
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

  test("respeta una cuenta ya seleccionada aunque el texto sea ambiguo", () => {
    const resolution = resolveCoachEntities(snapshot, "Acme");
    const clarification = buildCoachEntityClarification(
      resolution,
      "Revisa Acme",
      { accountId: 7 },
    );

    expect(clarification).toBeNull();
  });

  test("no interrumpe una oportunidad seleccionada por leads ambiguos", () => {
    const resolution = resolveCoachEntities(snapshot, "Renovación");
    const clarification = buildCoachEntityClarification(
      resolution,
      "¿Qué productos incluyeron las cotizaciones?",
      { accountId: 7, opportunityId: 118 },
    );

    expect(resolution.candidates.leads).toHaveLength(2);
    expect(clarification).toBeNull();
  });
});
