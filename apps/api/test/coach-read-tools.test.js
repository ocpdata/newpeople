import { describe, expect, it } from "vitest";
import {
  getCoachReadToolCatalog,
  inferCoachOpportunityFilters,
  searchCoachOpportunities,
} from "../src/coach/read-tools.js";
import { executeCoachReadTool } from "../src/coach/crm-read-tools.js";

describe("Coach read tools", () => {
  it("exposes relationship identity only in the explicit detail projection, never for unavailable destinations", () => {
    const record = { id: 10, accountId: 7, name: "Proyecto", contactId: 20,
      associatedContact: { name: "Contacto" }, associatedContactStatus: "available" };
    const snapshot = { coachOpportunities: [record], contactMappings: [
      { id: 20, accountId: 7, name: "Contacto", activationStatusCode: "activado" },
    ] };
    const read = (toolName, args) => executeCoachReadTool({ toolName, snapshot, args, businessRules: {} }).result;
    expect(read("getOpportunity", { opportunityId: 10 })).not.toHaveProperty("associatedContactId");
    expect(read("getOpportunity", { opportunityId: 10, includeDetails: true })).not.toHaveProperty("associatedContactId");
    expect(read("getOpportunity", { opportunityId: 10, includeDetails: true, includeRelationships: true }).associatedContactId).toBe(20);
    expect(read("searchOpportunities", { includeDetails: true, includeRelationships: true, applyDefaultFilters: false })[0].associatedContactId).toBe(20);
    expect(read("searchContacts", {})[0]).not.toHaveProperty("activationStatusCode");
    expect(read("searchContacts", { includeRelationships: true })[0].activationStatusCode).toBe("activado");
    for (const status of ["restricted", "unavailable", "not_recorded"]) {
      const restricted = { coachOpportunities: [{ ...record, associatedContact: null, associatedContactStatus: status }] };
      expect(executeCoachReadTool({ toolName: "getOpportunity", snapshot: restricted, businessRules: {},
        args: { opportunityId: 10, includeDetails: true, includeRelationships: true } }).result.associatedContactId).toBeNull();
    }
  });
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
    expect(inferCoachOpportunityFilters("oportunidades con fecha de cierre en 2026")).toMatchObject({
      closeYear: 2026,
    });
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

  it("preserves missing values in detail without changing the legacy projection", () => {
    const snapshot = { coachOpportunities: [{ id: 10, name: "Proyecto A", accountId: 7 }] };
    const read = (includeDetails) => executeCoachReadTool({
      toolName: "getOpportunity", snapshot, args: { opportunityId: 10, includeDetails },
    }).result;
    expect(read(false)).toMatchObject({ amountUsd: 0, commercialStatusCode: "en_proceso" });
    expect(read(true)).toMatchObject({
      amountUsd: null, commercialStatusCode: "", activationStatusCode: "",
      associatedContactStatus: "unavailable",
    });
  });

  it("returns communication fields only for an explicitly requested contact detail", () => {
    const snapshot = {
      contactMappings: [
        { id: 1, accountId: 7, name: "Elena", phone: "111", mobile: "222" },
        { id: 2, accountId: 8, name: "Elena", phone: "333" },
      ],
    };
    const read = (args) => executeCoachReadTool({
      toolName: "searchContacts", snapshot, args,
    }).result;
    expect(read({ accountId: 7 })).toHaveLength(1);
    expect(read({ accountId: 7 })[0]).not.toHaveProperty("phone");
    expect(read({ accountId: 7, contactId: 1, includeDetails: true }))
      .toMatchObject([{ id: 1, phone: "111", mobile: "222" }]);
    expect(read({ accountId: 7, contactId: 2, includeDetails: true })).toEqual([]);
    expect(executeCoachReadTool({
      toolName: "searchContacts", snapshot, args: { includeDetails: true },
      businessRules: { scope: { contactSearchAllowed: false } },
    })).toMatchObject({ result: null, error: expect.any(String) });
  });
  it("allows an explicit unfiltered collection without changing legacy default filters", () => {
    const snapshot = {
      coachOpportunities: [
        { id: 1, accountId: 7, name: "Abierta", commercialStatusCode: "en_proceso", activationStatusCode: "activada", lifecycle: "open" },
        { id: 2, accountId: 7, name: "Ganada", commercialStatusCode: "ganada", activationStatusCode: "activada", lifecycle: "historical" },
        { id: 3, accountId: 7, name: "Inactiva", commercialStatusCode: "en_proceso", activationStatusCode: "desactivada", lifecycle: "inactive" },
      ],
    };
    const read = (args) => executeCoachReadTool({
      toolName: "searchOpportunities", snapshot, args,
      businessRules: { filters: { defaultActiveOnly: true, defaultOpenOnly: true } },
    }).result;
    expect(read({}).map((record) => record.id)).toEqual([1]);
    expect(read({ applyDefaultFilters: false }).map((record) => record.id)).toEqual([1, 2, 3]);
  });
  it("preserves missing opportunity values in opt-in list projection", () => {
    const result = executeCoachReadTool({
      toolName: "searchOpportunities",
      snapshot: { coachOpportunities: [{ id: 1, accountId: 7, name: "Sin importe" }] },
      args: { accountId: 7, includeDetails: true, applyDefaultFilters: false },
    }).result;
    expect(result).toMatchObject([{ amountUsd: null, commercialStatusCode: "", activationStatusCode: "", associatedContactStatus: "unavailable" }]);
  });
});
