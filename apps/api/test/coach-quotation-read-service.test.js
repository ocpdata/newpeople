import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db.js", () => ({ query: vi.fn() }));

import { query } from "../src/db.js";
import { getAuthorizedCoachQuotationContent, listAuthorizedCoachQuotations } from "../src/coach/quotation-read-service.js";

describe("Coach quotation read service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires a quotation permission before querying CRM data", async () => {
    await expect(
      getAuthorizedCoachQuotationContent({
        user: { id: 19, permissionSet: new Set(["oportunidades.read"]) },
        opportunityId: 8,
      }),
    ).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it("uses account ownership and returns commercial items without internal cost or margin", async () => {
    query
      .mockResolvedValueOnce([
        {
          quotation_id: 11,
          opportunity_id: 8,
          version_id: 12,
          version_number: 2,
          proposal_name: "Renovación anual",
          currency_code: "USD",
          summary_discount_mode: "percent",
          summary_discount_value: 5,
          status_code: "borrador",
          activation_status_code: "activada",
          account_id: 3,
          account_name: "Cuenta Demo",
          opportunity_name: "Proyecto SD-WAN",
        },
      ])
      .mockResolvedValueOnce([
        { id: 21, title: "Licencias", inclusion_name: "Incluido" },
      ])
      .mockResolvedValueOnce([
        {
          quotation_section_id: 21,
          product_code: "LIC-001",
          product_description: "Licencia anual",
          item_type: "producto",
          is_renewal: 1,
          quantity: 10,
          original_currency_code: "USD",
          list_price_unit: 120,
          final_discount_pct: 5,
          import_cost_pct: 40,
          profit_margin_pct: 25,
        },
      ]);

    const quotation = await getAuthorizedCoachQuotationContent({
      user: { id: 19, permissionSet: new Set(["cotizaciones.operacion"]) },
      opportunityId: 8,
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("account_owners ao_scope"),
      [19, 8],
    );
    expect(quotation).toMatchObject({
      quotationId: 11,
      versionNumber: 2,
      accountId: 3,
      opportunityId: 8,
      sections: [
        {
          title: "Licencias",
          items: [
            expect.objectContaining({
              productCode: "LIC-001",
              quantity: 10,
              listPriceUnit: 120,
              discountPct: 5,
            }),
          ],
        },
      ],
    });
    expect(quotation.sections[0].items[0]).not.toHaveProperty("importCostPct");
    expect(quotation.sections[0].items[0]).not.toHaveProperty("profitMarginPct");
    expect(quotation).not.toHaveProperty("internalNotes");
  });
  it("lists only authorized candidates of the selected account and opportunity with a 51st-row sentinel", async () => {
    query.mockResolvedValueOnce(Array.from({ length: 51 }, (_, index) => ({
      quotation_id: index + 1, opportunity_id: 8, version_id: index + 100, version_number: 1,
    })));
    const result = await listAuthorizedCoachQuotations({
      user: { id: 19, permissionSet: new Set(["cotizaciones.operacion"]) }, accountId: 3, opportunityId: 8,
    });
    expect(result.candidates).toHaveLength(50);
    expect(result.truncated).toBe(true);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("WHERE o.account_id = ? AND o.id = ?"), [19, 3, 8]);
    expect(query.mock.calls[0][0]).toContain("LIMIT 51");
    expect(query.mock.calls[0][0]).toContain("qv.quotation_id = q.id");
  });
  it.each([
    ["18", "q.id = ?", 18],
    ["Alternativa comercial", "qv.proposal_name = ?", "Alternativa comercial"],
  ])("filters an explicit reference before the candidate limit: %s", async (quotationReference, sql, value) => {
    query.mockResolvedValueOnce([]);
    await listAuthorizedCoachQuotations({
      user: { id: 19, permissionSet: new Set(["cotizaciones.administracion"]) },
      accountId: 3, opportunityId: 8, quotationReference,
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining(sql), [3, 8, value]);
    expect(query.mock.calls[0][0]).not.toContain("account_owners");
  });
  it.each([
    { user: { permissionSet: new Set() }, accountId: 3, opportunityId: 8 },
    { user: { permissionSet: new Set(["cotizaciones.operacion"]) }, accountId: 0, opportunityId: 8 },
  ])("does not read candidates without permission or a valid account", async (args) => {
    await expect(listAuthorizedCoachQuotations(args)).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
  it("reads an explicit revision constrained to quotation, opportunity and account", async () => {
    query.mockResolvedValueOnce([{
      quotation_id: 18, opportunity_id: 8, account_id: 3, version_id: 123, version_number: 2,
      commercial_notes: "Texto público de Notas del PDF", introduction: "Introducción comercial",
    }]).mockResolvedValueOnce([]);
    const result = await getAuthorizedCoachQuotationContent({
      user: { id: 19, permissionSet: new Set(["cotizaciones.operacion"]) },
      accountId: 3, opportunityId: 8, quotationId: 18, versionNumber: 2, commercialOnly: true,
    });
    expect(query.mock.calls[0][1]).toEqual([19, 18, 8, 3, 2]);
    expect(query.mock.calls[0][0]).toContain("AND qv.version_number = ?");
    expect(query.mock.calls[0][0]).toContain("qv.quotation_id = q.id");
    expect(query.mock.calls[0][0]).toContain("qv.quotation_notes AS commercial_notes");
    expect(result).toMatchObject({ versionNumber: 2, commercialNotes: "Texto público de Notas del PDF" });
    expect(result).not.toHaveProperty("quotationNotes");
  });
  it("preserves absent quantities and prices rather than converting them to zero", async () => {
    query.mockResolvedValueOnce([{ quotation_id: 18, opportunity_id: 8, account_id: 3, version_id: 123, version_number: 2 }])
      .mockResolvedValueOnce([{ id: 21 }]).mockResolvedValueOnce([{ quotation_section_id: 21, quantity: null, list_price_unit: null }]);
    const result = await getAuthorizedCoachQuotationContent({
      user: { id: 19, permissionSet: new Set(["cotizaciones.operacion"]) }, opportunityId: 8,
    });
    expect(result.sections[0].items[0]).toMatchObject({ quantity: null, listPriceUnit: null, discountPct: null });
  });
  it("propagates database errors instead of returning an empty quotation", async () => {
    query.mockRejectedValueOnce(new Error("DB unavailable"));
    await expect(listAuthorizedCoachQuotations({
      user: { id: 19, permissionSet: new Set(["cotizaciones.operacion"]) }, accountId: 3, opportunityId: 8,
    })).rejects.toThrow("DB unavailable");
  });
  it.each([NaN, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])("does not query a malformed quotation identity: %s", async (quotationId) => {
    await expect(getAuthorizedCoachQuotationContent({
      user: { id: 19, permissionSet: new Set(["cotizaciones.operacion"]) }, quotationId, opportunityId: 8,
    })).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});