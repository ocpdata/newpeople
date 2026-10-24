import { describe, expect, it } from "vitest";
import { buildCustomerActivityDraftResponse } from "../src/commercial-intelligence/activity-draft.js";
import {
  buildPendingActivityRouting,
  buildPendingScheduleRouting,
  findDateInText,
  findTimeInText,
  matchOpportunitiesByReply,
  resolvePendingActivitySchedule,
  resolvePendingActivityTarget,
} from "../src/commercial-intelligence/pending-activity-target.js";

const timeZone = "America/Mexico_City";
const now = new Date("2026-10-24T22:00:00Z"); // sábado 24/10/2026 16:00 local
const permissions = new Set(["mi_coach.execute", "calendario_comercial.update", "oportunidades.update", "contactos.read"]);
const snapshot = {
  account: { id: 163, name: "Grupo Diestra" },
  opportunities: [
    { id: 121, accountId: 163, name: "Proteccion de Documentos Sealpath", contactId: 226, stageName: "Waiting" },
    { id: 117, accountId: 163, name: "Propuesta de Seguridad Correo 2500 Correos", contactId: 226 },
  ],
  contacts: [{ id: 226, accountId: 163, name: "Daniel Carrillo" }],
};
const intent = { actionType: "call", timing: "scheduled", title: "Llamada con Daniel", notes: "", successCriteria: "", temporalPreference: "" };
const awaitingOpportunity = { accountId: 163, pendingActivityIntent: intent };
const history = [
  { role: "user", text: "Agenda una llamada con Daniel el martes" },
  { role: "assistant", text: "¿A qué oportunidad vinculo la actividad?" },
];

describe("respuesta a «¿qué oportunidad?» de una actividad recordada", () => {
  const resolve = (question, extra = {}) => resolvePendingActivityTarget({
    question, conversationContext: awaitingOpportunity, snapshot, ...extra,
  });

  it("resuelve una respuesta breve por nombre parcial sin reinterpretarla", () => {
    expect(resolve("a sealpath")).toMatchObject({ status: "resolved", opportunity: { id: 121 } });
    expect(resolve("la de seguridad")).toMatchObject({ status: "resolved", opportunity: { id: 117 } });
    expect(resolve("Proteccion de Documentos Sealpath")).toMatchObject({ status: "resolved", opportunity: { id: 121 } });
  });

  it("ofrece opciones cuando no identifica una sola oportunidad", () => {
    expect(resolve("la otra")).toMatchObject({ status: "ambiguous" });
    expect(resolve("la otra").candidates.map((item) => item.id)).toEqual([121, 117]);
  });

  it("usa la oportunidad del selector si la respuesta no nombra otra", () => {
    expect(resolve("esa", { focusOpportunityId: 117 })).toMatchObject({ status: "resolved", opportunity: { id: 117 } });
  });

  it("deja al recorrido normal las preguntas, cancelaciones y turnos sin actividad recordada", () => {
    expect(resolve("¿en qué etapa está sealpath?")).toBeNull();
    expect(resolve("cancela la llamada")).toBeNull();
    expect(resolvePendingActivityTarget({ question: "a sealpath", conversationContext: { accountId: 163 }, snapshot })).toBeNull();
    expect(resolvePendingActivityTarget({ question: "a sealpath", snapshot,
      conversationContext: { accountId: 163, pendingActivityIntent: { ...intent, timing: "unclear" } } })).toBeNull();
  });

  it("compara por nombre completo antes que por palabras sueltas", () => {
    expect(matchOpportunitiesByReply("documentos", snapshot.opportunities).map((item) => item.id)).toEqual([121]);
    expect(matchOpportunitiesByReply("hola", snapshot.opportunities)).toEqual([]);
  });
});

describe("borrador de actividad con oportunidad elegida", () => {
  it("usa la oportunidad seleccionada cuando el planificador solo identificó la cuenta", () => {
    const routing = { ...buildPendingActivityRouting(intent), serverResolvedEntityIds: { opportunityId: null } };
    routing.activityDraft.action = "prepare";
    const response = buildCustomerActivityDraftResponse({ routing, readToolResults: [], snapshot, permissions, selectedOpportunityId: 121 });
    expect(response).toMatchObject({ responseType: "operation", entities: { opportunityId: 121, contactId: 226 } });
    expect(response.answer).toContain("Daniel Carrillo");
  });

  it("no usa la seleccionada si la solicitud nombra otra oportunidad", () => {
    const routing = { ...buildPendingActivityRouting(intent), serverResolvedEntityIds: { opportunityId: null },
      entities: { opportunityReference: "Correo" } };
    const response = buildCustomerActivityDraftResponse({ routing, readToolResults: [], snapshot, permissions, selectedOpportunityId: 121 });
    expect(response.responseType).toBe("clarification");
  });

  it("pregunta solo la hora cuando ya conoce el día", () => {
    const routing = buildPendingActivityRouting({ ...intent, temporalPreference: "2026-10-27" }, 121);
    const response = buildCustomerActivityDraftResponse({ routing, readToolResults: [], snapshot, permissions, pendingActivityIntent: intent });
    expect(response.answer).toContain("¿A qué hora del 2026-10-27");
  });
});

describe("fecha y hora del borrador", () => {
  it("interpreta fechas y horas habituales en español", () => {
    expect(findDateInText("el martes", "2026-10-24")).toBe("2026-10-27");
    expect(findDateInText("mañana a las 4", "2026-10-24")).toBe("2026-10-25");
    expect(findDateInText("el 30 de octubre", "2026-10-24")).toBe("2026-10-30");
    expect(findDateInText("el lunes pasado", "2026-10-24")).toBe("2026-10-19");
    expect(findDateInText("a las 10 de la mañana", "2026-10-24")).toBeNull();
    expect(findTimeInText("a las 10 de la mañana")).toBe("10:00");
    expect(findTimeInText("a las 4 de la tarde")).toBe("16:00");
    expect(findTimeInText("a las diez y media")).toBe("10:30");
    expect(findTimeInText("15:00")).toBe("15:00");
    expect(findTimeInText("a las 3")).toBe("15:00");
  });

  const draftContext = (operation = {}) => ({
    accountId: 163,
    pendingActivity: { operationId: 9, sessionId: 4, version: 1,
      operation: { kind: "activity", opportunityId: 121, accountId: 163, contactId: 226, actionType: "call",
        title: "Llamada con Daniel", status: "pending", scheduledAt: "", missingFields: ["scheduledAt"], ...operation } },
  });
  const schedule = (question, context = draftContext()) =>
    resolvePendingActivitySchedule({ question, history, conversationContext: context, timeZone, now });

  it("completa la hora con el día mencionado antes en la conversación", () => {
    expect(schedule("a las 10 de la mañana")).toMatchObject({ status: "resolved", scheduledAt: "2026-10-27T10:00" });
  });

  it("pide lo que falta y rechaza una programación en el pasado", () => {
    expect(resolvePendingActivitySchedule({ question: "a las 10", history: [], conversationContext: draftContext(), timeZone, now }))
      .toMatchObject({ status: "needs_date" });
    expect(schedule("hoy a las 9 de la mañana")).toMatchObject({ status: "not_future" });
  });

  it("no intercepta respuestas sin fecha u hora ni borradores completos", () => {
    expect(schedule("perfecto")).toBeNull();
    expect(schedule("a las 10", draftContext({ scheduledAt: "2026-10-27T10:00", missingFields: [] }))).toBeNull();
  });

  it("construye un borrador completo con la fecha resuelta", () => {
    const context = draftContext();
    const routing = buildPendingScheduleRouting(context.pendingActivity.operation, "2026-10-27T10:00");
    const response = buildCustomerActivityDraftResponse({ routing, readToolResults: [], snapshot, permissions,
      pendingActivity: context.pendingActivity });
    expect(response.responseType).toBe("operation");
    expect(response.operations[0]).toMatchObject({ opportunityId: 121, scheduledAt: "2026-10-27T10:00" });
  });
});
