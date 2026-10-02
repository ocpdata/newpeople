import { query } from "../db.js";

const QUOTATION_READ_PERMISSIONS = [
  "cotizaciones.operacion",
  "cotizaciones.revision",
  "cotizaciones.ingreso",
  "cotizaciones.aprobacion_humana",
  "cotizaciones.aprobacion_ia",
  "cotizaciones.administracion",
  "cotizaciones.externo",
];

function hasQuotationReadAccess(user) {
  return QUOTATION_READ_PERMISSIONS.some((permission) =>
    user?.permissionSet?.has(permission),
  );
}

export async function getAuthorizedCoachQuotationContent({
  user,
  opportunityId = null,
  quotationId = null,
} = {}) {
  if (!hasQuotationReadAccess(user)) return null;
  const normalizedQuotationId = Number(quotationId || 0);
  const normalizedOpportunityId = Number(opportunityId || 0);
  if (normalizedQuotationId <= 0 && normalizedOpportunityId <= 0) return null;

  const params = [];
  const ownershipJoin = user.permissionSet.has("cotizaciones.administracion")
    ? ""
    : (() => {
        params.push(Number(user.id));
        return "INNER JOIN account_owners ao_scope ON ao_scope.account_id = o.account_id AND ao_scope.user_id = ?";
      })();
  let selection = "q.opportunity_id = ?";
  if (normalizedQuotationId > 0) {
    selection = "q.id = ?";
    params.push(normalizedQuotationId);
  } else {
    params.push(normalizedOpportunityId);
  }
  if (normalizedOpportunityId > 0 && normalizedQuotationId > 0) {
    selection += " AND q.opportunity_id = ?";
    params.push(normalizedOpportunityId);
  }

  const versionRows = await query(
    `SELECT q.id AS quotation_id, q.opportunity_id, q.latest_version_id,
            qv.id AS version_id, qv.version_number, qv.proposal_name,
            qv.quotation_date, qv.introduction, qv.currency_code,
            qv.summary_discount_mode, qv.summary_discount_value,
            qv.summary_distribution_mode, qv.summary_vat_mode,
            qv.summary_vat_pct, qv.delivery_time, qv.quotation_validity,
            qv.warranty_term, qv.payment_terms, qv.quotation_notes,
            qv.status_id, qs.code AS status_code, qs.name AS status_name,
            qas.code AS activation_status_code, o.name AS opportunity_name,
            a.id AS account_id, a.name AS account_name
     FROM quotations q
     INNER JOIN opportunities o ON o.id = q.opportunity_id
     ${ownershipJoin}
     INNER JOIN accounts a ON a.id = o.account_id
     LEFT JOIN quotation_versions qv ON qv.id = q.latest_version_id
     LEFT JOIN quotation_statuses qs ON qs.id = qv.status_id
     LEFT JOIN quotation_activation_statuses qas ON qas.id = qv.activation_status_id
     WHERE ${selection}
     ORDER BY q.updated_at DESC, q.id DESC
     LIMIT 1`,
    params,
  );
  const version = versionRows[0];
  if (!version?.version_id) return null;

  const sections = await query(
    `SELECT qs.id, qs.title, qsit.name AS inclusion_name
     FROM quotation_sections qs
     INNER JOIN quotation_section_inclusion_types qsit
       ON qsit.id = qs.inclusion_type_id
     INNER JOIN quotation_activation_statuses qas
       ON qas.id = qs.activation_status_id
     WHERE qs.quotation_version_id = ? AND qas.code = 'activada'
     ORDER BY qs.display_order, qs.id`,
    [Number(version.version_id)],
  );
  const itemRows = sections.length
    ? await query(
        `SELECT qsi.quotation_section_id, qsi.product_code,
                qsi.product_description, qsi.item_type, qsi.is_renewal,
                qsi.quantity, qsi.original_currency_code, qsi.list_price_unit,
                qsi.final_discount_pct, qsi.display_order
         FROM quotation_section_items qsi
         WHERE qsi.quotation_section_id IN (${sections.map(() => "?").join(",")})
         ORDER BY qsi.quotation_section_id, qsi.display_order, qsi.id`,
        sections.map((section) => Number(section.id)),
      )
    : [];
  const itemsBySection = new Map();
  for (const row of itemRows) {
    const key = Number(row.quotation_section_id);
    const items = itemsBySection.get(key) || [];
    items.push({
      productCode: row.product_code || "",
      description: row.product_description || "",
      itemType: row.item_type || "producto",
      isRenewal: Boolean(row.is_renewal),
      quantity: Number(row.quantity || 0),
      currencyCode: row.original_currency_code || version.currency_code || null,
      listPriceUnit: Number(row.list_price_unit || 0),
      discountPct: Number(row.final_discount_pct || 0),
    });
    itemsBySection.set(key, items);
  }

  return {
    quotationId: Number(version.quotation_id),
    versionId: Number(version.version_id),
    versionNumber: Number(version.version_number),
    statusCode: version.status_code || null,
    statusName: version.status_name || null,
    activationStatusCode: version.activation_status_code || null,
    proposalName: version.proposal_name || "",
    quotationDate: version.quotation_date || null,
    accountId: Number(version.account_id),
    accountName: version.account_name || "",
    opportunityId: Number(version.opportunity_id),
    opportunityName: version.opportunity_name || "",
    currencyCode: version.currency_code || null,
    summaryDiscountMode: version.summary_discount_mode || null,
    summaryDiscountValue:
      version.summary_discount_value == null
        ? null
        : Number(version.summary_discount_value),
    summaryDistributionMode: version.summary_distribution_mode || null,
    vatMode: version.summary_vat_mode || null,
    vatPct: version.summary_vat_pct == null ? null : Number(version.summary_vat_pct),
    deliveryTime: version.delivery_time || null,
    validity: version.quotation_validity || null,
    warranty: version.warranty_term || null,
    paymentTerms: version.payment_terms || null,
    quotationNotes: version.quotation_notes || "",
    sections: sections.map((section) => ({
      title: section.title || "",
      inclusion: section.inclusion_name || "",
      items: itemsBySection.get(Number(section.id)) || [],
    })),
  };
}