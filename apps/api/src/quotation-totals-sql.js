export const DEFAULT_QUOTATION_VAT_PCT = 16;

export function buildQuotationVersionNetSaleSql({
  versionAlias = "lv",
  totalsAlias = "latest_total",
} = {}) {
  const sale = `COALESCE(${totalsAlias}.base_sale_total, 0)`;
  return `CASE
    WHEN ${versionAlias}.id IS NULL THEN NULL
    WHEN ${versionAlias}.summary_distribution_mode = 'per_item' THEN ${sale}
    WHEN ${versionAlias}.summary_discount_mode = 'amount'
      THEN GREATEST(${sale} - LEAST(COALESCE(${versionAlias}.summary_discount_value, 0), ${sale}), 0)
    WHEN ${versionAlias}.summary_discount_mode = 'percentage'
      THEN ${sale} * (1 - LEAST(GREATEST(COALESCE(${versionAlias}.summary_discount_value, 0), 0), 100) / 100)
    ELSE ${sale} END`;
}

export function buildQuotationVersionBaseSaleTotalJoin(versionAlias = "lv") {
  return `LEFT JOIN (
      SELECT qs.quotation_version_id,
             SUM(
               CASE
                 WHEN qsi.profit_margin_pct >= 100 THEN 0
                 ELSE qsi.quantity * (
                   (
                     qsi.list_price_unit *
                     (1 - (qsi.manufacturer_discount_pct / 100)) *
                     (1 + (qsi.import_cost_pct / 100))
                   ) /
                   (1 - (qsi.profit_margin_pct / 100)) *
                   (1 - (qsi.final_discount_pct / 100))
                 )
               END
             ) AS base_sale_total,
             SUM(
               CASE
                 WHEN qsi.profit_margin_pct >= 100 THEN 0
                 ELSE qsi.quantity * (
                   qsi.list_price_unit *
                   (1 - (qsi.manufacturer_discount_pct / 100)) *
                   (1 + (qsi.import_cost_pct / 100))
                 )
               END
             ) AS base_cost_total
             ,SUM(
               CASE
                 WHEN qsi.item_type = 'servicio_propio' THEN 0
                 WHEN qsi.profit_margin_pct >= 100 THEN 0
                 ELSE qsi.quantity * (
                   (
                     qsi.list_price_unit *
                     (1 - (qsi.manufacturer_discount_pct / 100)) *
                     (1 + (qsi.import_cost_pct / 100))
                   ) /
                   (1 - (qsi.profit_margin_pct / 100)) *
                   (1 - (qsi.final_discount_pct / 100))
                 )
               END
             ) AS product_sale_total,
             SUM(
               CASE
                 WHEN qsi.item_type = 'servicio_propio' THEN 0
                 WHEN qsi.profit_margin_pct >= 100 THEN 0
                 ELSE qsi.quantity * (
                   qsi.list_price_unit *
                   (1 - (qsi.manufacturer_discount_pct / 100)) *
                   (1 + (qsi.import_cost_pct / 100))
                 )
               END
             ) AS product_cost_total,
             SUM(
               CASE
                 WHEN qsi.item_type <> 'servicio_propio' THEN 0
                 WHEN qsi.profit_margin_pct >= 100 THEN 0
                 ELSE qsi.quantity * (
                   (
                     qsi.list_price_unit *
                     (1 - (qsi.manufacturer_discount_pct / 100)) *
                     (1 + (qsi.import_cost_pct / 100))
                   ) /
                   (1 - (qsi.profit_margin_pct / 100)) *
                   (1 - (qsi.final_discount_pct / 100))
                 )
               END
             ) AS service_sale_total,
             SUM(
               CASE
                 WHEN qsi.item_type <> 'servicio_propio' THEN 0
                 WHEN qsi.profit_margin_pct >= 100 THEN 0
                 ELSE qsi.quantity * (
                   qsi.list_price_unit *
                   (1 - (qsi.manufacturer_discount_pct / 100)) *
                   (1 + (qsi.import_cost_pct / 100))
                 )
               END
             ) AS service_cost_total
      FROM quotation_sections qs
      INNER JOIN quotation_section_items qsi ON qsi.quotation_section_id = qs.id
      LEFT JOIN quotation_section_items child
        ON child.bundle_parent_item_id = qsi.id
       AND child.quotation_section_id = qs.id
      WHERE child.id IS NULL
        AND qsi.item_type <> 'grupo_productos'
      GROUP BY qs.quotation_version_id
    ) latest_total ON latest_total.quotation_version_id = ${versionAlias}.id`;
}

export function buildQuotationVersionEffectiveTotalSql({
  versionAlias = "lv",
  totalsAlias = "latest_total",
} = {}) {
  const baseTotalSql = `COALESCE(${totalsAlias}.base_sale_total, 0)`;
  const vatPctSql = `COALESCE(${versionAlias}.summary_vat_pct, ${DEFAULT_QUOTATION_VAT_PCT})`;
  const totalWithPerItemVatSql = `CASE
      WHEN ${versionAlias}.summary_vat_mode = 'per_item'
        THEN ${baseTotalSql} * (1 + (${vatPctSql} / 100))
      ELSE ${baseTotalSql}
    END`;
  const discountedTotalSql = `CASE
      WHEN ${versionAlias}.summary_distribution_mode = 'per_item'
        THEN ${totalWithPerItemVatSql}
      WHEN ${versionAlias}.summary_discount_mode = 'amount'
        THEN GREATEST(
          ${totalWithPerItemVatSql} - LEAST(COALESCE(${versionAlias}.summary_discount_value, 0), ${totalWithPerItemVatSql}),
          0
        )
      WHEN ${versionAlias}.summary_discount_mode = 'percentage'
        THEN ${totalWithPerItemVatSql} *
          (1 - (LEAST(GREATEST(COALESCE(${versionAlias}.summary_discount_value, 0), 0), 100) / 100))
      ELSE ${totalWithPerItemVatSql}
    END`;

  return `CASE
      WHEN ${versionAlias}.id IS NULL THEN NULL
      WHEN ${versionAlias}.summary_vat_mode = 'total'
        THEN ${discountedTotalSql} * (1 + (${vatPctSql} / 100))
      ELSE ${discountedTotalSql}
    END`;
}
