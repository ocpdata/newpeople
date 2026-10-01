import { describe, expect, it } from "vitest";
import {
  getCoachReadToolCatalog,
  inferCoachOpportunityFilters,
  searchCoachOpportunities,
} from "../src/coach/read-tools.js";

describe("Coach read tools", () => {
  it("declara herramientas de consulta sin capacidades de escritura", () => {
    const catalog = getCoachReadToolCatalog();

    expect(catalog.length).toBeGreaterThanOrEqual(7);
    expect(catalog.every((tool) => tool.readOnly)).toBe(true);
    expect(catalog.map((tool) => tool.name)).toContain("searchOpportunities");
  });

  it("infiere etapa, apertura y activacion como filtros estructurados", () => {
    expect(inferCoachOpportunityFilters("oportunidades abiertas en waiting")).toMatchObject({
      stageCodes: ["waiting"],
      commercialStatusCodes: ["en_proceso"],
      openOnly: true,
    });
    expect(
      inferCoachOpportunityFilters("oportunidades desactivadas de Totalplay"),
    ).toMatchObject({ inactiveOnly: true, activeOnly: false });
  });

  it("busca por cuenta y etapa y deduplica por ID", () => {
    const snapshot = {
      coachOpportunities: [
        {
          id: 10,
          name: "Proyecto A",
          accountId: 7,
          account: { id: 7, name: "Totalplay" },
          stageCode: "waiting",
          lifecycle: "open",
        },
        {
          id: 10,
          name: "Proyecto A",
          accountId: 7,
          account: { id: 7, name: "Totalplay" },
          stageCode: "waiting",
          lifecycle: "open",
        },
        {
          id: 11,
          name: "Proyecto B",
          accountId: 7,
          account: { id: 7, name: "Totalplay" },
          stageCode: "negociacion",
          lifecycle: "open",
        },
      ],
    };

    expect(
      searchCoachOpportunities(snapshot, {
        accountId: 7,
        stageCodes: ["waiting"],
        openOnly: true,
      }).map((opportunity) => opportunity.id),
    ).toEqual([10]);
  });

  it("distingue oportunidades activadas de oportunidades abiertas", () => {
    const snapshot = {
      coachOpportunities: [
        {
          id: 20,
          name: "Proyecto abierto",
          accountId: 7,
          activationStatusCode: "activada",
          lifecycle: "open",
        },
      ],
      wonOpportunities: [
        {
          id: 21,
          name: "Proyecto ganado",
          accountId: 7,
          activationStatusCode: "activada",
          lifecycle: "historical",
          commercialStatusCode: "ganada",
        },
      ],
    };

    expect(
      searchCoachOpportunities(snapshot, { accountId: 7, activeOnly: true }),
    ).toMatchObject([{ id: 20 }, { id: 21 }]);
    expect(
      searchCoachOpportunities(snapshot, { accountId: 7, openOnly: true }),
    ).toMatchObject([{ id: 20 }]);
  });
});
