import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCoachSessionMock } = vi.hoisted(() => ({
  getCoachSessionMock: vi.fn(),
}));

vi.mock("../src/coach/service.js", () => ({
  getCoachSession: getCoachSessionMock,
}));

import {
  normalizeCoachGatewayRequest,
  prepareCoachTurn,
} from "../src/coach/agent-gateway.js";

describe("Coach Agent Gateway", () => {
  beforeEach(() => {
    getCoachSessionMock.mockReset();
  });

  it("normaliza pregunta, contexto, historial y sesión", () => {
    expect(
      normalizeCoachGatewayRequest({
        question: "  ¿Qué falta? ",
        sessionId: "12",
        context: { accountId: "7", opportunityId: "0", extra: 99 },
        history: [
          { role: "seller", text: "  Primero  " },
          { role: "coach", text: "Respuesta" },
          { role: "system", text: "Ignorar como seller" },
        ],
      }),
    ).toEqual({
      question: "¿Qué falta?",
      requestedSessionId: 12,
      requestContext: {
        accountId: 7,
        contactId: null,
        opportunityId: null,
        quotationId: null,
        proposalId: null,
        leadId: null,
      },
      conversationHistory: [
        { role: "seller", text: "Primero" },
        { role: "coach", text: "Respuesta" },
        { role: "seller", text: "Ignorar como seller" },
      ],
    });
  });

  it("usa el contexto y el historial de una sesión activa", async () => {
    getCoachSessionMock.mockResolvedValue({
      id: 12,
      status: "active",
      context: { accountId: 7, opportunityId: 20 },
      messages: [
        {
          role: "seller",
          text: "Pregunta anterior",
          context: { accountId: 7, opportunityId: 20 },
        },
        {
          role: "coach",
          result: { answer: "Respuesta anterior" },
          context: { accountId: 7, opportunityId: 20 },
        },
        { role: "seller", text: "Otro contexto", context: { accountId: 8 } },
      ],
    });

    const result = await prepareCoachTurn({
      userId: 31,
      body: { sessionId: 12, question: "Sigue" },
    });

    expect(result).toMatchObject({
      question: "Sigue",
      requestedSessionId: 12,
      selectedContext: { accountId: 7, opportunityId: 20 },
      session: { id: 12, status: "active" },
      conversationHistory: [
        { role: "seller", text: "Pregunta anterior" },
        { role: "coach", text: "Respuesta anterior" },
      ],
    });
  });

  it("no reutiliza una sesión cerrada y conserva el contexto solicitado", async () => {
    getCoachSessionMock.mockResolvedValue({
      id: 12,
      status: "closed",
      context: { accountId: 7 },
      messages: [{ role: "seller", text: "No restaurar" }],
    });

    const result = await prepareCoachTurn({
      userId: 31,
      body: {
        sessionId: 12,
        question: "Nueva pregunta",
        context: { accountId: 9 },
      },
    });

    expect(result.session).toBeNull();
    expect(result.selectedContext).toMatchObject({ accountId: 9 });
    expect(result.conversationHistory).toEqual([]);
  });
});
