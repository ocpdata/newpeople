import { describe, expect, it } from "vitest";
import { RECENT_MESSAGES, earlierRequestsContext, earlierUserRequests } from "../src/commercial-intelligence/dossier/earlier-requests.js";
import { buildAnalystContext, ANALYST_SYSTEM_PROMPT } from "../src/commercial-intelligence/dossier/analyst.js";
import { buildComposerContext, COMPOSER_SYSTEM_PROMPT } from "../src/commercial-intelligence/dossier/composer.js";
import { buildRouterContext, ROUTER_SYSTEM_PROMPT } from "../src/commercial-intelligence/dossier/router.js";

const conversation = (pairs) => Array.from({ length: pairs }, (_, index) => [
  { role: "user", text: `Pedido ${index + 1}` },
  { role: "assistant", text: `Respuesta ${index + 1}` },
]).flat();

describe("memoria de pedidos anteriores del vendedor", () => {
  it("no agrega nada mientras la conversación cabe en la ventana reciente", () => {
    expect(earlierUserRequests(conversation(3))).toEqual([]);
    expect(earlierRequestsContext(conversation(3))).toEqual({});
    expect(earlierRequestsContext([])).toEqual({});
    expect(earlierRequestsContext(undefined)).toEqual({});
  });

  it("conserva solo los mensajes del vendedor anteriores a la ventana", () => {
    const history = conversation(5);
    expect(history).toHaveLength(10);
    expect(earlierUserRequests(history)).toEqual(["Pedido 1", "Pedido 2"]);
    expect(RECENT_MESSAGES).toBe(6);
  });

  it("limita la cantidad y el largo y normaliza el espacio", () => {
    const history = [
      ...Array.from({ length: 15 }, (_, index) => ({ role: "user", text: `P${index}` })),
      { role: "user", text: `  responde   siempre\n en inglés ${"x".repeat(400)} ` },
      ...conversation(3),
    ];
    const earlier = earlierUserRequests(history);
    expect(earlier).toHaveLength(10);
    expect(earlier.at(-1).startsWith("responde siempre en inglés")).toBe(true);
    expect(earlier.at(-1)).toHaveLength(200);
    expect(earlier.at(-1).endsWith("…")).toBe(true);
    expect(earlier[0]).toBe("P6");
  });

  it("ignora mensajes vacíos y los que no son del vendedor", () => {
    const history = [{ role: "user", text: "   " }, { role: "assistant", text: "Hola" }, { role: "user", text: "Útil" }, ...conversation(3)];
    expect(earlierUserRequests(history)).toEqual(["Útil"]);
  });

  describe("contextos de los modelos", () => {
    const long = conversation(6);
    const dossier = { account: { id: 1, name: "Cuenta" }, sections: { opportunities: { items: [] } } };
    const router = (history) => buildRouterContext({ question: "Hola", history, selectedOpportunityId: null, accountDossier: dossier, memory: null, today: "2026-10-30" });
    const analyst = (history) => buildAnalystContext({ question: "Hola", route: { obligations: [], focusLevel: "account", opportunityIds: [], recordFilters: [] },
      dossiers: [], history, today: "2026-10-30", timezone: "America/Mexico_City" });
    const composer = (history) => buildComposerContext({ question: "Hola", tasks: [], dossiers: [], history, today: "2026-10-30", timezone: "America/Mexico_City" });

    it("incluyen los pedidos anteriores solo en conversaciones largas y mantienen la ventana reciente", () => {
      for (const build of [router, analyst, composer]) {
        const longContext = build(long);
        expect(longContext.earlierUserRequests).toEqual(["Pedido 1", "Pedido 2", "Pedido 3"]);
        const recent = longContext.recentConversation || longContext.conversationForContinuityOnly;
        expect(recent).toHaveLength(6);
        expect(recent.at(-1).text).toBe("Respuesta 6");
        expect(build(conversation(2))).not.toHaveProperty("earlierUserRequests");
      }
    });

    it("las instrucciones explican que no son evidencia ni tareas", () => {
      for (const prompt of [ROUTER_SYSTEM_PROMPT, ANALYST_SYSTEM_PROMPT, COMPOSER_SYSTEM_PROMPT]) {
        expect(prompt).toContain("earlierUserRequests");
      }
      expect(ROUTER_SYSTEM_PROMPT).toMatch(/no los conviertas en tareas/);
      expect(ANALYST_SYSTEM_PROMPT).toMatch(/no son evidencia/);
    });
  });
});
