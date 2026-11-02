import { describe, expect, it } from "vitest";
import { resolveCoachBackReference } from "../src/coach/back-reference.js";

const opportunity = { accountId: 22, opportunityId: 94 };
const account = { accountId: 25 };
const messages = [
  { role: "seller", text: "Háblame de Vrf 2027", context: opportunity },
  { role: "coach", text: "…", context: opportunity },
  { role: "seller", text: "¿Y AT&T?", context: account },
  { role: "coach", text: "…", context: account },
];

describe("referencias a una entidad anterior de la conversación", () => {
  it("vuelve a la primera entidad", () => {
    const result = resolveCoachBackReference({ question: "Volviendo a la primera, ¿en qué etapa estaba?", messages, current: account });
    expect(result).toMatchObject({ accountId: 22, opportunityId: 94, contactId: null });
  });

  it("vuelve a la anterior distinta de la actual", () => {
    const result = resolveCoachBackReference({ question: "Regresemos a la anterior", messages, current: account });
    expect(result.opportunityId).toBe(94);
    expect(resolveCoachBackReference({ question: "Regresemos a la anterior", messages, current: opportunity })?.accountId).toBe(25);
  });

  it("no actúa sin verbo de regreso ni cuando no hay a dónde volver", () => {
    expect(resolveCoachBackReference({ question: "¿Cuál es la primera etapa?", messages, current: account })).toBeNull();
    expect(resolveCoachBackReference({ question: "Volviendo a la primera", messages, current: opportunity })).toBeNull();
    expect(resolveCoachBackReference({ question: "Volviendo a la primera", messages: [], current: {} })).toBeNull();
    expect(resolveCoachBackReference({ question: "Volviendo al tema", messages, current: account })).toBeNull();
  });
});
