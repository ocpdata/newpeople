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

export function hasQuotationReadAccess(user) {
  return QUOTATION_READ_PERMISSIONS.some((permission) =>
    user?.permissionSet?.has(permission),
  );
}

export async function listAuthorizedCoachQuotations({ user, accountId, opportunityId, quotationReference = "" } = {}) {
  if (!hasQuotationReadAccess(user) || !Number.isSafeInteger(Number(accountId)) || Number(accountId) <= 0 ||
      !Number.isSafeInteger(Number(opportunityId)) || Number(opportunityId) <= 0) return null;
  const params = [];
  const ownershipJoin = user.permissionSet.has("cotizaciones.administracion") ? "" :
    (params.push(Number(user.id)), "INNER JOIN account_owners ao_scope ON ao_scope.account_id = o.account_id AND ao_scope.user_id = ?");
  params.push(Number(accountId), Number(opportunityId));
  const reference = String(quotationReference).trim();
  if (/^\d+$/.test(reference) && (!Number.isSafeInteger(Number(reference)) || Number(reference) <= 0)) return null;
  const referenceFilter = reference ? (/^\d+$/.test(reference) ? " AND q.id = ?" : " AND qv.proposal_name = ?") : "";
  if (reference) params.push(/^\d+$/.test(reference) ? Number(reference) : reference);
  const rows = await query(
    `SELECT q.id AS quotation_id, q.opportunity_id, q.latest_version_id,
            qv.id AS version_id, qv.version_number, qv.proposal_name,
            qv.quotation_date, q.updated_at
     FROM quotations q
     INNER JOIN opportunities o ON o.id = q.opportunity_id
     ${ownershipJoin}
     INNER JOIN quotation_versions qv ON qv.id = q.latest_version_id AND qv.quotation_id = q.id
     WHERE o.account_id = ? AND o.id = ?${referenceFilter}
     ORDER BY q.updated_at DESC, q.id DESC
     LIMIT 51`, params,
  );
  return {
    truncated: rows.length > 50,
    candidates: rows.slice(0, 50).map((row) => ({
      quotationId: Number(row.quotation_id), opportunityId: Number(row.opportunity_id),
      versionId: Number(row.version_id), versionNumber: Number(row.version_number),
      proposalName: row.proposal_name || "", quotationDate: row.quotation_date || null,
    })),
  };
}

export async function getAuthorizedCoachQuotationContent({
  user,
  opportunityId = null,
  quotationId = null,
  accountId = null,
  versionNumber = null,
  commercialOnly = false,
} = {}) {
  if (!hasQuotationReadAccess(user)) return null;
  const normalizedQuotationId = Number(quotationId ?? 0);
  const normalizedOpportunityId = Number(opportunityId ?? 0);
  if (![normalizedQuotationId, normalizedOpportunityId].every((id) => Number.isSafeInteger(id) && id >= 0)) return null;
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
  if (accountId != null) {
    if (!Number.isSafeInteger(Number(accountId)) || Number(accountId) <= 0) return null;
    selection += " AND o.account_id = ?";
    params.push(Number(accountId));
  }
  if (versionNumber != null && (!Number.isSafeInteger(Number(versionNumber)) || Number(versionNumber) <= 0)) return null;
  const versionJoin = versionNumber == null
    ? "qv.id = q.latest_version_id AND qv.quotation_id = q.id"
    : "qv.quotation_id = q.id";
  if (versionNumber != null) {
    selection += " AND qv.version_number = ?";
    params.push(Number(versionNumber));
  }

  const versionRows = await query(
    `SELECT q.id AS quotation_id, q.opportunity_id, q.latest_version_id,
            qv.id AS version_id, qv.version_number, qv.proposal_name,
            qv.quotation_date, qv.introduction, qv.currency_code,
            qv.summary_discount_mode, qv.summary_discount_value,
            qv.summary_distribution_mode, qv.summary_vat_mode,
            qv.summary_vat_pct, qv.delivery_time, qv.quotation_validity,
            qv.warranty_term, qv.payment_terms, qv.quotation_notes${commercialOnly ? " AS commercial_notes" : ""},
            qv.status_id, qs.code AS status_code, qs.name AS status_name,
            qas.code AS activation_status_code, o.name AS opportunity_name,
            a.id AS account_id, a.name AS account_name
     FROM quotations q
     INNER JOIN opportunities o ON o.id = q.opportunity_id
     ${ownershipJoin}
     INNER JOIN accounts a ON a.id = o.account_id
     LEFT JOIN quotation_versions qv ON ${versionJoin}
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
      quantity: row.quantity == null ? null : Number(row.quantity),
      currencyCode: row.original_currency_code || version.currency_code || null,
      listPriceUnit: row.list_price_unit == null ? null : Number(row.list_price_unit),
      discountPct: row.final_discount_pct == null ? null : Number(row.final_discount_pct),
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
    ...(commercialOnly ? { introduction: version.introduction || "", commercialNotes: version.commercial_notes || "" } : {}),
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
    ...(!commercialOnly ? { quotationNotes: version.quotation_notes || "" } : {}),
    sections: sections.map((section) => ({
      title: section.title || "",
      inclusion: section.inclusion_name || "",
      items: itemsBySection.get(Number(section.id)) || [],
    })),
  };
}