import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db.js", () => ({ query: vi.fn() }));

import { query } from "../src/db.js";
import { getAuthorizedCoachQuotationContent } from "../src/coach/quotation-read-service.js";

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
});