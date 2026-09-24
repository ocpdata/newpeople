import { describe, expect, test } from "vitest";
import { resolveCoachEntities } from "../src/coach/entity-resolver.js";

describe("Coach entity resolver", () => {
  const snapshot = {
    pipeline: {
      opportunities: [
        { id: 116, name: "Seguridad de las APIs" },
        { id: 117, name: "Seguridad de Redes" },
      ],
    },
    contactMappings: [{ id: 32, name: "Karla Lobato Bonilla", email: "karla@example.com" }],
    leads: [{ id: 88, title: "Renovación de APIs", summary: "Necesita renovar sus APIs" }],
  };

  test("resuelve una oportunidad y contacto con nombre parcial", () => {
    const result = resolveCoachEntities(snapshot, "para seguridad de las apis y Karla Lobato");
    expect(result.opportunity?.id).toBe(116);
    expect(result.contact?.id).toBe(32);
  });

  test("no elige una oportunidad ambigua", () => {
    const result = resolveCoachEntities(snapshot, "seguridad");
    expect(result.opportunity).toBeNull();
    expect(result.candidates.opportunities).toHaveLength(2);
  });
});
