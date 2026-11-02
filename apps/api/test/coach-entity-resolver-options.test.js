import { describe, expect, it } from "vitest";
import { resolveCoachEntities } from "../src/coach/entity-resolver.js";
import { coachLabSnapshot } from "../src/channel-quality/lab/coach.js";

const coach = { disambiguateByAccount: true };
const resolve = (text, options) => resolveCoachEntities(coachLabSnapshot, text, {}, options);

describe("opciones de resolución exclusivas de Coach", () => {
  it("sin la opción conserva el comportamiento compartido", () => {
    expect(resolve("Dame el detalle de Renovación SD-WAN de Telmex.").opportunity).toBeNull();
    expect(resolve("Dame el detalle de Totalplay.").candidates.opportunities.length).toBeGreaterThan(1);
  });

  it("una cuenta mencionada desambigua oportunidades y contactos del mismo nombre", () => {
    expect(resolve("Dame el detalle de Renovación SD-WAN de Telmex.", coach).opportunity?.id).toBe(10);
    expect(resolve("Quiero ver a Juan Pérez de Telmex.", coach).contact?.id).toBe(502);
  });

  it("mencionar solo la cuenta selecciona la cuenta y no obliga a elegir una oportunidad", () => {
    const resolution = resolve("Dame el detalle de Telmex.", coach);
    expect(resolution.account?.id).toBe(23);
    expect(resolution.candidates.opportunities).toEqual([]);
  });

  it("pedir «la oportunidad» de una cuenta con varias sigue pidiendo elegir", () => {
    expect(resolve("Dame el detalle de la oportunidad de Totalplay.", coach).candidates.opportunities.length).toBeGreaterThan(1);
  });

  it("al crear una oportunidad su nombre no se busca entre las existentes", () => {
    const text = "Crea una oportunidad nueva para Telmex llamada Renovación SD-WAN";
    expect(resolve(text, coach).candidates.opportunities.length).toBeGreaterThan(0);
    const creating = resolve(text, { ...coach, newOpportunity: true });
    expect(creating.account?.id).toBe(23);
    expect(creating.candidates.opportunities).toEqual([]);
  });

  it("las palabras de etapa no ocultan una oportunidad nombrada en el texto", () => {
    const text = "Historial de actividades y cotizaciones de Vrf 2027";
    expect(resolve(text).candidates.opportunities).toEqual([]);
    expect(resolve(text, coach).candidates.opportunities.map((item) => item.id)).toEqual([3]);
  });
});

describe("resolveCoachContextEntities de Coach", () => {
  it("solo trata como nueva la oportunidad cuando se pide crearla", async () => {
    const { resolveCoachContextEntities } = await import("../src/routes.mi-agent.js");
    const resolve = (text) => resolveCoachContextEntities(coachLabSnapshot, text, [], {}, {}, { intentMode: "operation" }).explicitEntities;
    expect(resolve("Crea una oportunidad nueva para Telmex llamada Renovación SD-WAN").candidates.opportunities).toEqual([]);
    expect(resolve("Crea una actividad de seguimiento para la oportunidad Switching campus").opportunity?.id).toBe(13);
  });
});
