// The authorized snapshot of an account that the existing-customer chat and the agents work from.

import { buildCustomerHistoryReadFilter } from "./customer-history.js";
import { buildCustomerPendingReadFilter } from "./customer-pending.js";
import { captureSnapshotQueryFailure, captureSnapshotQueryRows } from "./snapshot-query-metrics.js";
import { ensureCommercialCalendarActivitiesSchema } from "./calendar-activities-schema.js";
import { ensureLandingSchema } from "../landing/schema.js";
import { ensureManufacturerRegistrationsSchema } from "../manufacturer-registrations/schema.js";
import { normalizeCustomerIntelligenceSnapshot } from "./contract.js";
import { query } from "../db.js";
import { clip, createHttpError, daysSince, daysUntil, filterCustomerOpportunityArtifacts, filterCustomerOpportunityHistory, hasReadAllPermission, hasReadPermission, isCustomerOpportunityHistoryStatusAllowed, isOpenCustomerOpportunity } from "./service-helpers.js";
import { getAccessibleAccount, getAccessibleContact, getAccessibleOpportunity, resolveAccountId } from "./account-access.js";
import { getMiCoachGovernanceSettings } from "./governance-settings.js";

export const CUSTOMER_SNAPSHOT_QUERY_METRICS = new WeakMap();

export const PROVIDER_CATALOG_RESULT_LIMIT = 1000;

export function getCustomerSnapshotQueryMetrics(snapshot) {
  return CUSTOMER_SNAPSHOT_QUERY_METRICS.get(snapshot) || [];
}

export function buildAccountHealth({
  account,
  contacts = [],
  opportunities = [],
  interactions = [],
  renewals = [],
  products = [],
  now = new Date(),
}) {
  const signals = [];
  const nowTimestamp = new Date(now).getTime();
  const openOpportunities = opportunities.filter(isOpenCustomerOpportunity);
  const latestInteraction =
    interactions
      .map((item) => item.updatedAt || item.createdAt)
      .filter(Boolean)
      .sort(
        (left, right) => new Date(right).getTime() - new Date(left).getTime(),
      )[0] || null;
  const daysSinceLastInteraction = daysSince(latestInteraction, nowTimestamp);
  const riskyOpportunities = openOpportunities.filter((opportunity) => {
    const closeDays = daysUntil(opportunity.closeDate, nowTimestamp);
    const staleDays = daysSince(opportunity.updatedAt, nowTimestamp);
    return (
      (closeDays !== null && closeDays <= 30) ||
      (staleDays !== null && staleDays >= 30)
    );
  });

  if (!account?.description) {
    signals.push({
      code: "missing_account_description",
      severity: "medium",
      title: "Falta contexto de cuenta",
      summary: "La cuenta no tiene una descripción comercial suficiente.",
      evidence: "Campo description vacío o no disponible.",
      source: "crm:accounts.description",
      entityType: "account",
      entityId: account?.id || null,
    });
  }
  if (!contacts.length) {
    signals.push({
      code: "no_active_contacts",
      severity: "medium",
      title: "Sin contactos activos",
      summary:
        "No hay contactos activos disponibles para mapear la relación comercial.",
      evidence: "Consulta de contactos activos sin resultados.",
      source: "crm:contacts",
      entityType: "account",
      entityId: account?.id || null,
    });
  }
  if (!openOpportunities.length) {
    signals.push({
      code: "no_open_opportunities",
      severity: "low",
      title: "Sin oportunidades abiertas",
      summary: "No hay oportunidades abiertas visibles para esta cuenta.",
      evidence: "Consulta de oportunidades activas sin resultados.",
      source: "crm:opportunities",
      entityType: "account",
      entityId: account?.id || null,
    });
  }
  if (daysSinceLastInteraction === null || daysSinceLastInteraction >= 30) {
    signals.push({
      code: "stale_account_activity",
      severity: "high",
      title: "Actividad comercial atrasada",
      summary: "La cuenta no tiene una interacción reciente accesible.",
      evidence:
        daysSinceLastInteraction === null
          ? "No hay interacciones recientes."
          : `Última interacción hace ${daysSinceLastInteraction} días.`,
      source: "crm:interactions",
      entityType: "account",
      entityId: account?.id || null,
    });
  }
  for (const opportunity of riskyOpportunities.slice(0, 5)) {
    const closeDays = daysUntil(opportunity.closeDate, nowTimestamp);
    const staleDays = daysSince(opportunity.updatedAt, nowTimestamp);
    const reason =
      closeDays !== null && closeDays <= 30
        ? `Cierre previsto en ${closeDays} días.`
        : `Sin actualización comercial hace ${staleDays} días.`;
    signals.push({
      code: "opportunity_needs_attention",
      severity: "high",
      title: `Revisar oportunidad: ${opportunity.name}`,
      summary: "La oportunidad tiene una señal determinística de riesgo.",
      evidence: reason,
      source: "crm:opportunities",
      entityType: "opportunity",
      entityId: opportunity.id,
    });
  }
  for (const renewal of renewals
    .filter(
      (item) =>
        daysSince(item.expiresAt, nowTimestamp) !== null &&
        daysSince(item.expiresAt, nowTimestamp) <= 90,
    )
    .slice(0, 5)) {
    const expiryDays = daysSince(renewal.expiresAt, nowTimestamp);
    signals.push({
      code: "renewal_due_soon",
      severity: "medium",
      title: `Renovación próxima: ${renewal.providerName}`,
      summary:
        "Existe un registro de fabricante cercano a su fecha de vencimiento.",
      evidence: `Vencimiento previsto en ${expiryDays} días.`,
      source: "crm:manufacturer_registrations",
      entityType: "opportunity",
      entityId: renewal.opportunityId,
    });
  }

  const highCount = signals.filter(
    (signal) => signal.severity === "high",
  ).length;
  const mediumCount = signals.filter(
    (signal) => signal.severity === "medium",
  ).length;
  const score = Math.max(
    0,
    100 -
      highCount * 25 -
      mediumCount * 10 -
      signals.filter((signal) => signal.severity === "low").length * 5,
  );
  return {
    status: !account
      ? "insufficient_data"
      : highCount
        ? "at_risk"
        : mediumCount
          ? "attention"
          : "healthy",
    score,
    signals,
    metrics: {
      contactCount: contacts.length,
      opportunityCount: openOpportunities.length,
      riskyOpportunityCount: riskyOpportunities.length,
      interactionCount: interactions.length,
      daysSinceLastInteraction,
      renewalCount: renewals.length,
      productCount: products.length,
    },
  };
}

export function buildExpansionHypotheses({
  products = [],
  renewals = [],
  catalogItems = [],
  opportunities = [],
}) {
  const hypotheses = [];
  const opportunityId =
    opportunities.find(isOpenCustomerOpportunity)?.id || null;
  for (const renewal of renewals.filter((item) => item.expiresAt)) {
    hypotheses.push({
      type: "renewal",
      title: `Preparar renovación de ${renewal.providerName}`,
      summary:
        "El registro tiene una fecha de vencimiento y requiere validar continuidad.",
      evidence: `Vencimiento: ${renewal.expiresAt}.`,
      confidence: "high",
      sourceProductCode: null,
      suggestedProductCode: null,
      suggestedProductDescription: null,
      opportunityId: renewal.opportunityId || opportunityId,
      requiresConfirmation: true,
    });
  }
  const existingCodes = new Set(
    products.map((product) => product.productCode).filter(Boolean),
  );
  const sameProvider = catalogItems.filter(
    (item) =>
      products.some(
        (product) => Number(product.providerId) === Number(item.providerId),
      ) && !existingCodes.has(item.code),
  );
  const otherProvider = catalogItems.filter(
    (item) =>
      !products.some(
        (product) => Number(product.providerId) === Number(item.providerId),
      ) && !existingCodes.has(item.code),
  );
  const sourceProduct = products[0] || null;
  if (sourceProduct && sameProvider[0])
    hypotheses.push({
      type: "upsell",
      title: `Explorar ampliación de ${sourceProduct.description}`,
      summary:
        "Existe otra oferta activa del mismo proveedor que podría complementar o ampliar la solución actual.",
      evidence: `Producto actual: ${sourceProduct.description}; alternativa: ${sameProvider[0].description}.`,
      confidence: "low",
      sourceProductCode: sourceProduct.productCode || null,
      suggestedProductCode: sameProvider[0].code,
      suggestedProductDescription: sameProvider[0].description,
      opportunityId,
      requiresConfirmation: true,
    });
  if (sourceProduct && otherProvider[0])
    hypotheses.push({
      type: "cross_sell",
      title: `Explorar solución complementaria: ${otherProvider[0].description}`,
      summary:
        "Existe una oferta de otro proveedor que puede evaluarse como complemento, no como hecho confirmado.",
      evidence: `Producto actual: ${sourceProduct.description}; catálogo complementario: ${otherProvider[0].description}.`,
      confidence: "low",
      sourceProductCode: sourceProduct.productCode || null,
      suggestedProductCode: otherProvider[0].code,
      suggestedProductDescription: otherProvider[0].description,
      opportunityId,
      requiresConfirmation: true,
    });
  const seen = new Set();
  return hypotheses
    .filter((hypothesis) => {
      const key = `${hypothesis.type}:${hypothesis.sourceProductCode || ""}:${hypothesis.suggestedProductCode || ""}:${hypothesis.opportunityId || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10);
}

export async function buildAuthorizedCustomerSnapshot({
  user,
  accountId,
  opportunityId,
  contactId,
  activityHistoryStartDate = null,
  activityHistoryEndDate = null,
  includeContactHistory = false,
  includeProviderCatalog = true,
  historySources = null,
  historyRequest = null,
}) {
  const historyReadFilter = (source) => historyRequest
    ? historyRequest.pending ? buildCustomerPendingReadFilter(source, historyRequest) :
      buildCustomerHistoryReadFilter(source, historyRequest) : { sql: "", params: [] };
  const governanceSettings = await getMiCoachGovernanceSettings();
  const snapshotQueryMetrics = [];
  const loadSnapshotRows = async (
    source,
    executeQuery,
    resultLimit = null,
    rethrow = false,
  ) => {
    try {
      const captured = captureSnapshotQueryRows(
        source,
        await executeQuery(),
        resultLimit,
      );
      snapshotQueryMetrics.push(captured.metric);
      return captured.rows;
    } catch (error) {
      if (historySources) {
        console.error("[account-chat] History source read failed", { source, errorCode: error?.code || error?.name || "Error" });
      }
      snapshotQueryMetrics.push(
        captureSnapshotQueryFailure(source, resultLimit),
      );
      if (rethrow) {
        try {
          error.customerSnapshotQueryMetrics = [...snapshotQueryMetrics];
        } catch {}
        throw error;
      }
      return [];
    }
  };
  const normalizedAccountId = Number(accountId || 0);
  const normalizedOpportunityId = Number(opportunityId || 0);
  const normalizedContactId = Number(contactId || 0);

  if (
    !normalizedAccountId &&
    !normalizedOpportunityId &&
    !normalizedContactId
  ) {
    throw createHttpError(400, "Selecciona una cuenta, oportunidad o contacto");
  }

  const [account, opportunity, contact] = await Promise.all([
    normalizedAccountId
      ? getAccessibleAccount({ user, accountId: normalizedAccountId })
      : Promise.resolve(null),
    normalizedOpportunityId
      ? getAccessibleOpportunity({
          user,
          opportunityId: normalizedOpportunityId,
        })
      : Promise.resolve(null),
    normalizedContactId
      ? getAccessibleContact({ user, contactId: normalizedContactId })
      : Promise.resolve(null),
  ]);

  if (
    opportunity &&
    ((opportunity.commercial_status_code === "ganada" &&
      !governanceSettings.includeWonOpportunities) ||
      (opportunity.commercial_status_code === "perdida" &&
        !governanceSettings.includeLostOpportunities) ||
      (opportunity.commercial_status_code === "anulada" &&
        !governanceSettings.includeCancelledOpportunities))
  ) {
    throw createHttpError(404, "La oportunidad no esta disponible");
  }

  const resolvedAccountId = resolveAccountId({ account, opportunity, contact });
  let resolvedAccount = account;
  if (!resolvedAccount && resolvedAccountId) {
    resolvedAccount = await getAccessibleAccount({
      user,
      accountId: resolvedAccountId,
    });
  }

  if (
    account &&
    opportunity &&
    Number(opportunity.account_id) !== Number(account.id)
  ) {
    throw createHttpError(
      400,
      "La oportunidad no pertenece a la cuenta seleccionada",
    );
  }
  if (account && contact && Number(contact.account_id) !== Number(account.id)) {
    throw createHttpError(
      400,
      "El contacto no pertenece a la cuenta seleccionada",
    );
  }

  const relatedContacts =
    resolvedAccountId && hasReadPermission(user, "contactos")
      ? await loadSnapshotRows(
          "contacts",
          () =>
            query(
              `SELECT c.id, c.account_id, c.first_name, c.last_name, c.email, c.phone,
              c.mobile, c.position_title, c.department,
                  CASE WHEN manager.id IS NOT NULL THEN c.manager_contact_id ELSE NULL END AS manager_contact_id,
                  CASE WHEN influenced.id IS NOT NULL THEN c.influences_contact_id ELSE NULL END AS influences_contact_id,
              pp.name AS purchase_participation,
              h.name AS hierarchy_level, rt.name AS relationship_type,
              il.name AS influence_level, cas.code AS activation_status_code,
              CONCAT(manager.first_name, ' ', manager.last_name) AS manager_name,
              CONCAT(influenced.first_name, ' ', influenced.last_name) AS influences_name
           FROM contacts c
           INNER JOIN contact_activation_statuses cas ON cas.id = c.activation_status_id
             LEFT JOIN contact_purchase_participations pp ON pp.id = c.purchase_participation_id
             LEFT JOIN contact_hierarchy_levels h ON h.id = c.hierarchy_level_id
             LEFT JOIN contact_relationship_types rt ON rt.id = c.relationship_type_id
             LEFT JOIN contact_influence_levels il ON il.id = c.influence_level_id
             LEFT JOIN contacts manager ON manager.id = c.manager_contact_id AND manager.account_id = c.account_id
             LEFT JOIN contacts influenced ON influenced.id = c.influences_contact_id AND influenced.account_id = c.account_id
           WHERE c.account_id = ?
             ${includeContactHistory ? "" : "AND cas.code = 'activado'"}
             ${hasReadAllPermission(user, "cuentas") ? "" : "AND EXISTS (SELECT 1 FROM account_owners ao_contact_scope WHERE ao_contact_scope.account_id = c.account_id AND ao_contact_scope.user_id = ?)"}
           ORDER BY c.first_name, c.last_name
           ${includeContactHistory ? "" : "LIMIT 51"}`,
              hasReadAllPermission(user, "cuentas")
                ? [resolvedAccountId]
                : [resolvedAccountId, Number(user.id)],
            ),
          includeContactHistory ? null : 50,
        )
      : [];

  const relatedOpportunities =
    resolvedAccountId && hasReadPermission(user, "oportunidades")
      ? await loadSnapshotRows(
          "opportunities_active",
          () =>
            query(
              `SELECT o.id, o.name, o.account_id, o.contact_id, o.amount_usd, o.close_date, o.updated_at,
              o.sales_stage_id,
                  oss.code AS stage_code, oss.name AS stage_name,
                  ocs.code AS commercial_status_code
           FROM opportunities o
           INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
           INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
           INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
           WHERE o.account_id = ? AND oas.code = 'activada'
             ${hasReadAllPermission(user, "oportunidades") ? "" : "AND (EXISTS (SELECT 1 FROM account_owners ao_opportunity_scope WHERE ao_opportunity_scope.account_id = o.account_id AND ao_opportunity_scope.user_id = ?) OR o.created_by = ? OR o.seller_user_id = ?)"}
           ORDER BY o.close_date IS NULL, o.close_date ASC, o.amount_usd DESC
           LIMIT 51`,
              hasReadAllPermission(user, "oportunidades")
                ? [resolvedAccountId]
                : [
                    resolvedAccountId,
                    Number(user.id),
                    Number(user.id),
                    Number(user.id),
                  ],
            ),
          50,
        )
      : [];

  const visibleRelatedOpportunities = filterCustomerOpportunityHistory(
    relatedOpportunities,
    governanceSettings,
  );
  const visibleOpportunityIds = new Set(
    visibleRelatedOpportunities.map((item) => Number(item.id)),
  );

  const relatedInactiveOpportunities =
    resolvedAccountId && hasReadPermission(user, "oportunidades")
      ? await loadSnapshotRows(
          "opportunities_inactive",
          () =>
            query(
              `SELECT o.id, o.name, o.account_id, o.contact_id, o.amount_usd,
              o.close_date, o.updated_at, o.sales_stage_id, oss.code AS stage_code,
                  oss.name AS stage_name, ocs.code AS commercial_status_code,
                  oas.code AS activation_status_code
           FROM opportunities o
           INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
           INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
           INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
           WHERE o.account_id = ? AND oas.code <> 'activada'
             ${hasReadAllPermission(user, "oportunidades") ? "" : "AND (EXISTS (SELECT 1 FROM account_owners ao_opportunity_scope WHERE ao_opportunity_scope.account_id = o.account_id AND ao_opportunity_scope.user_id = ?) OR o.created_by = ? OR o.seller_user_id = ?)"}
           ORDER BY o.updated_at DESC, o.close_date IS NULL, o.close_date ASC
           LIMIT 51`,
              hasReadAllPermission(user, "oportunidades")
                ? [resolvedAccountId]
                : [
                    resolvedAccountId,
                    Number(user.id),
                    Number(user.id),
                    Number(user.id),
                  ],
            ),
          50,
        )
      : [];

  const visibleRelatedInactiveOpportunities = relatedInactiveOpportunities.filter(
    (item) => isCustomerOpportunityHistoryStatusAllowed(item, governanceSettings),
  );

  if (resolvedAccountId && hasReadPermission(user, "interacciones")) {
    await ensureLandingSchema();
  }
  const interactionAccessScope = hasReadAllPermission(user, "interacciones")
    ? ""
    : "AND (i.seller_user_id = ? OR i.created_by = ? OR EXISTS (SELECT 1 FROM account_owners ao_interaction_scope WHERE ao_interaction_scope.account_id = COALESCE(i.account_id, (SELECT related_opportunity.account_id FROM opportunities related_opportunity WHERE related_opportunity.id = i.primary_opportunity_id)) AND ao_interaction_scope.user_id = ?) OR EXISTS (SELECT 1 FROM landing_submissions ls WHERE ls.id = i.landing_submission_id AND ls.sent_to_leads_by = ?) OR EXISTS (SELECT 1 FROM landing_submission_crm_links lscl INNER JOIN landing_submissions ls ON ls.id = lscl.submission_id WHERE lscl.lead_id = i.id AND ls.sent_to_leads_by = ?))";
  const interactionHistoryFilter = activityHistoryStartDate && !historySources
    ? "AND COALESCE(i.created_at, i.updated_at) >= ? AND COALESCE(i.created_at, i.updated_at) < DATE_ADD(?, INTERVAL 1 DAY)"
    : "";
  const interactionParams = hasReadAllPermission(user, "interacciones")
    ? [resolvedAccountId, resolvedAccountId]
    : [
        resolvedAccountId,
        resolvedAccountId,
        Number(user.id),
        Number(user.id),
        Number(user.id),
        Number(user.id),
        Number(user.id),
      ];
  if (activityHistoryStartDate && !historySources) {
    interactionParams.push(activityHistoryStartDate, activityHistoryEndDate);
  }
  const relatedInteractions =
    resolvedAccountId && hasReadPermission(user, "interacciones") &&
    (!historySources || historySources.includes("interactions"))
      ? await loadSnapshotRows(
          "interactions",
          () =>
            query(
              `SELECT i.id, i.account_id, i.primary_opportunity_id, i.title, i.analysis_status, i.summary, i.source_notes,
                  i.lead_substatus_code, i.lead_reason_code, i.lead_required_action_code,
                  i.lead_next_action_due_at, i.updated_at, i.created_at
           FROM interactions i
           WHERE (i.account_id = ? OR i.primary_opportunity_id IN (
             SELECT o.id FROM opportunities o WHERE o.account_id = ?
           ))
             ${interactionAccessScope}
             ${interactionHistoryFilter}
             ${historyReadFilter("interactions").sql}
           ORDER BY i.updated_at DESC, i.created_at DESC
           ${historySources ? "LIMIT 501" : activityHistoryStartDate || includeContactHistory ? "" : "LIMIT 31"}`,
              [...interactionParams, ...historyReadFilter("interactions").params],
            ),
          historySources ? 500 : activityHistoryStartDate || includeContactHistory ? null : 30,
          !historySources && Boolean(activityHistoryStartDate || includeContactHistory),
        )
      : [];

  let contactIdsByInteraction = new Map();
  if (
    includeContactHistory &&
    hasReadPermission(user, "contactos") &&
    hasReadPermission(user, "interacciones") &&
    relatedInteractions.length &&
    relatedContacts.length
  ) {
    const interactionIds = relatedInteractions.map((item) => Number(item.id));
    const contactIds = relatedContacts.map((item) => Number(item.id));
    const interactionPlaceholders = interactionIds.map(() => "?").join(",");
    const contactPlaceholders = contactIds.map(() => "?").join(",");
    const contactLinkRows = await loadSnapshotRows("interaction_contact_links", () => query(
      `SELECT l.interaction_id, l.contact_id
       FROM interaction_contact_links l
       INNER JOIN contacts c ON c.id = l.contact_id
       WHERE l.interaction_id IN (${interactionPlaceholders})
         AND l.contact_id IN (${contactPlaceholders})
         AND c.account_id = ?`,
      [...interactionIds, ...contactIds, resolvedAccountId],
    ), null, !historySources);
    contactIdsByInteraction = contactLinkRows.reduce((groups, row) => {
      const interactionId = Number(row.interaction_id);
      const linked = groups.get(interactionId) || [];
      linked.push(Number(row.contact_id));
      groups.set(interactionId, linked);
      return groups;
    }, new Map());
  }

  let relatedRenewals = [];
  if (resolvedAccountId && hasReadPermission(user, "oportunidades")) {
    await ensureManufacturerRegistrationsSchema();
    relatedRenewals = await loadSnapshotRows(
      "renewals",
      () =>
        query(
          `SELECT r.id, r.opportunity_id, r.provider_id, p.name AS provider_name,
              r.status_code, r.expires_at, r.renewal_count, r.last_renewed_at, r.notes
       FROM opportunity_manufacturer_registrations r
       INNER JOIN opportunities o ON o.id = r.opportunity_id
       INNER JOIN providers p ON p.id = r.provider_id
      INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
      WHERE o.account_id = ?
         ${hasReadAllPermission(user, "oportunidades") ? "" : "AND (EXISTS (SELECT 1 FROM account_owners ao_renewal_scope WHERE ao_renewal_scope.account_id = o.account_id AND ao_renewal_scope.user_id = ?) OR o.created_by = ? OR o.seller_user_id = ?)"}
       ORDER BY r.expires_at IS NULL, r.expires_at ASC, r.id DESC
       LIMIT 51`,
          hasReadAllPermission(user, "oportunidades")
            ? [resolvedAccountId]
            : [
                resolvedAccountId,
                Number(user.id),
                Number(user.id),
                Number(user.id),
              ],
        ),
      50,
    );
  }

  const relatedProducts =
    resolvedAccountId && hasReadPermission(user, "oportunidades")
      ? await loadSnapshotRows(
          "quotation_products",
          () =>
            query(
              `SELECT q.id AS quotation_id, qv.id AS quotation_version_id,
                q.opportunity_id, qsi.provider_id, p.name AS provider_name,
                qsi.product_code, qsi.product_description, qsi.item_type,
                qsi.is_renewal, qsi.quantity, qsi.list_price_unit,
                qv.currency_code, qs.code AS quotation_status
         FROM quotations q
         INNER JOIN opportunities o ON o.id = q.opportunity_id
         INNER JOIN quotation_versions qv ON qv.id = q.latest_version_id
         INNER JOIN quotation_statuses qs ON qs.id = qv.status_id
         INNER JOIN quotation_sections qsec ON qsec.quotation_version_id = qv.id
         INNER JOIN quotation_section_items qsi ON qsi.quotation_section_id = qsec.id
         INNER JOIN providers p ON p.id = qsi.provider_id
           WHERE o.account_id = ?
             ${hasReadAllPermission(user, "oportunidades") ? "" : "AND (EXISTS (SELECT 1 FROM account_owners ao_product_scope WHERE ao_product_scope.account_id = o.account_id AND ao_product_scope.user_id = ?) OR o.created_by = ? OR o.seller_user_id = ?)"}
         ORDER BY qv.quotation_date DESC, qsi.display_order ASC
           LIMIT 201`,
              hasReadAllPermission(user, "oportunidades")
                ? [resolvedAccountId]
                : [
                    resolvedAccountId,
                    Number(user.id),
                    Number(user.id),
                    Number(user.id),
                  ],
            ),
          200,
        )
      : [];
  const catalogItems =
    includeProviderCatalog &&
    resolvedAccountId &&
    hasReadPermission(user, "oportunidades")
      ? await loadSnapshotRows(
          "provider_catalog",
          () =>
            query(
              `SELECT ppli.provider_id AS providerId, ppli.code, ppli.description FROM provider_price_list_items ppli INNER JOIN provider_price_lists ppl ON ppl.id = ppli.price_list_id INNER JOIN provider_price_list_item_statuses ps ON ps.id = ppli.activation_status_id WHERE ppl.is_active = 1 AND ps.is_active = 1 ORDER BY ppli.updated_at DESC LIMIT ${PROVIDER_CATALOG_RESULT_LIMIT + 1}`,
            ),
          PROVIDER_CATALOG_RESULT_LIMIT,
        )
      : [];

  relatedRenewals = filterCustomerOpportunityArtifacts(
    relatedRenewals,
    visibleOpportunityIds,
  );
  const visibleRelatedProducts = filterCustomerOpportunityArtifacts(
    relatedProducts,
    visibleOpportunityIds,
  );
  const coachOpportunityIds = [
    ...new Set(
      [
        ...visibleRelatedOpportunities,
        ...visibleRelatedInactiveOpportunities,
        ...(opportunity ? [opportunity] : []),
      ]
        .map((item) => Number(item.id))
        .filter(Boolean),
    ),
  ];
  const coachContextByOpportunity = new Map();
  let relatedOpportunityActivities = [];
  let relatedCalendarActivities = [];
  if (coachOpportunityIds.length) {
    const placeholders = coachOpportunityIds.map(() => "?").join(",");
    const [
      stageQuestions,
      workspaceActions,
      workspaceWeaknesses,
      assessments,
      playbookRows,
    ] = await Promise.all([
      query(
        `SELECT o.id AS opportunity_id, q.id AS question_id,
                  q.sales_stage_id, q.code, q.prompt, q.is_required,
                  a.answer_value
           FROM opportunities o
           INNER JOIN opportunity_stage_questions q
             ON q.sales_stage_id = o.sales_stage_id AND q.is_active = 1
           LEFT JOIN opportunity_stage_question_answers a
             ON a.id = (SELECT a2.id FROM opportunity_stage_question_answers a2
                        WHERE a2.opportunity_id = o.id
                          AND a2.question_id = q.id
                        ORDER BY a2.id DESC LIMIT 1)
           WHERE o.id IN (${placeholders})
           ORDER BY o.id, q.display_order`,
        coachOpportunityIds,
      ).catch(() => []),
      query(
        `SELECT opportunity_id, id, title, action_type, status, priority,
                  owner_user_id, due_date, scheduled_at, success_criteria,
                  notes, is_primary_next_step
           FROM opportunity_workspace_actions
           WHERE opportunity_id IN (${placeholders})
           ORDER BY opportunity_id, due_date IS NULL, due_date, updated_at DESC`,
        coachOpportunityIds,
      ).catch(() => []),
      query(
        `SELECT opportunity_id, title, category, severity, status, detail,
                  mitigation_plan
           FROM opportunity_workspace_weaknesses
           WHERE opportunity_id IN (${placeholders})
           ORDER BY opportunity_id, FIELD(severity, 'high', 'medium', 'low'), updated_at DESC`,
        coachOpportunityIds,
      ).catch(() => []),
      query(
        `SELECT opportunity_id, criterion_code, status, summary, evidence_count
           FROM opportunity_workspace_criterion_assessments
           WHERE opportunity_id IN (${placeholders})`,
        coachOpportunityIds,
      ).catch(() => []),
      query(
        `SELECT st.sales_stage_id, sales.code AS stage_code,
                  sales.name AS stage_name, st.objective,
                  st.exit_criteria_summary, c.code AS criterion_code,
                  c.title AS criterion_title, c.description AS criterion_description,
                  c.is_required
           FROM opportunity_playbooks p
           INNER JOIN opportunity_playbook_versions v
             ON v.playbook_id = p.id AND v.is_active = 1
           INNER JOIN opportunity_playbook_stage_templates st
             ON st.playbook_version_id = v.id
           INNER JOIN opportunity_sales_stages sales ON sales.id = st.sales_stage_id
           LEFT JOIN opportunity_playbook_stage_criteria c
             ON c.stage_template_id = st.id
           WHERE p.is_active = 1
             AND st.sales_stage_id IN (
               SELECT DISTINCT sales_stage_id FROM opportunities
               WHERE id IN (${placeholders})
             )
           ORDER BY st.display_order, c.display_order, c.id`,
        coachOpportunityIds,
      ).catch(() => []),
    ]);
    const groupRows = (rows) =>
      rows.reduce((groups, row) => {
        const id = Number(row.opportunity_id);
        const group = groups.get(id) || [];
        group.push(row);
        groups.set(id, group);
        return groups;
      }, new Map());
    const questionsByOpportunity = groupRows(stageQuestions);
    const actionsByOpportunity = groupRows(workspaceActions);
    const weaknessesByOpportunity = groupRows(workspaceWeaknesses);
    const assessmentsByOpportunity = groupRows(assessments);
    const stagesById = new Map();
    for (const row of playbookRows) {
      const stageId = Number(row.sales_stage_id);
      const stage = stagesById.get(stageId) || {
        id: stageId,
        code: row.stage_code || "",
        name: row.stage_name || "",
        objective: row.objective || "",
        expectedOutcome: row.exit_criteria_summary || "",
        criteria: [],
      };
      if (row.criterion_code) {
        stage.criteria.push({
          code: row.criterion_code,
          title: row.criterion_title || "",
          description: row.criterion_description || "",
          required: Boolean(row.is_required),
        });
      }
      stagesById.set(stageId, stage);
    }
    for (const item of [
      ...visibleRelatedOpportunities,
      ...relatedInactiveOpportunities,
      ...(opportunity ? [opportunity] : []),
    ]) {
      const id = Number(item.id);
      const stageId = Number(item.sales_stage_id || 0) || null;
      coachContextByOpportunity.set(id, {
        salesStageId: stageId,
        currentStage: stageId
          ? stagesById.get(stageId) || {
              id: stageId,
              code: item.stage_code || "",
              name: item.stage_name || "",
              objective: "",
              expectedOutcome: "",
              criteria: [],
            }
          : null,
        stageQuestions: (questionsByOpportunity.get(id) || []).map((row) => ({
          questionId: Number(row.question_id),
          code: row.code || "",
          prompt: row.prompt || "",
          required: Boolean(row.is_required),
          answer: row.answer_value || null,
        })),
        workspace: {
          actions: (actionsByOpportunity.get(id) || []).map((row) => ({
            id: Number(row.id),
            title: row.title || "",
            actionType: row.action_type || "other",
            status: row.status || "pending",
            priority: row.priority || "medium",
            ownerUserId: Number(row.owner_user_id || 0) || null,
            dueDate: row.due_date || null,
            scheduledAt: row.scheduled_at || null,
            successCriteria: row.success_criteria || "",
            notes: row.notes || "",
            primary: Boolean(row.is_primary_next_step),
          })),
          weaknesses: (weaknessesByOpportunity.get(id) || []).map((row) => ({
            title: row.title || "",
            category: row.category || "",
            severity: row.severity || "medium",
            status: row.status || "open",
            detail: row.detail || "",
            mitigation: row.mitigation_plan || "",
          })),
          criteria: (assessmentsByOpportunity.get(id) || []).map((row) => ({
            code: row.criterion_code || "",
            status: row.status || "missing",
            summary: row.summary || "",
            evidenceCount: Number(row.evidence_count || 0),
          })),
        },
      });
    }
  }
  if (
    resolvedAccountId &&
    (historySources ? historySources.includes("opportunityActivities") : activityHistoryStartDate) &&
    hasReadPermission(user, "oportunidades") &&
    hasReadPermission(user, "desarrollo_comercial")
  ) {
    const activityOpportunityScope = hasReadAllPermission(user, "oportunidades")
      ? ""
      : "AND (EXISTS (SELECT 1 FROM account_owners ao_activity_scope WHERE ao_activity_scope.account_id = o.account_id AND ao_activity_scope.user_id = ?) OR o.created_by = ? OR o.seller_user_id = ?)";
    const activityDateScope = activityHistoryStartDate && !historySources
      ? "AND COALESCE(a.due_date, a.created_at) >= ? AND COALESCE(a.due_date, a.created_at) < DATE_ADD(?, INTERVAL 1 DAY)"
      : "";
    const activityParams = [resolvedAccountId];
    if (!hasReadAllPermission(user, "oportunidades")) {
      activityParams.push(Number(user.id), Number(user.id), Number(user.id));
    }
    if (activityHistoryStartDate && !historySources) {
      activityParams.push(activityHistoryStartDate, activityHistoryEndDate);
    }
    const rows = await loadSnapshotRows(
      "opportunity_activities",
      () =>
        query(
          `SELECT a.id, a.opportunity_id, a.title, a.action_type, a.status,
              a.priority, ${historySources ? "DATE_FORMAT(a.due_date, '%Y-%m-%d')" : "a.due_date"} AS due_date,
              a.scheduled_at, a.success_criteria, a.notes,
              a.created_at, o.account_id, o.name AS opportunity_name
       FROM opportunity_workspace_actions a
       INNER JOIN opportunities o ON o.id = a.opportunity_id
       WHERE o.account_id = ? ${activityOpportunityScope} ${activityDateScope}
         ${historyReadFilter("opportunityActivities").sql}
       ORDER BY ${historySources ? "COALESCE(a.scheduled_at, a.due_date, a.created_at)" : "COALESCE(a.due_date, a.created_at)"} DESC, a.id DESC
       ${historySources ? "LIMIT 501" : ""}`,
          [...activityParams, ...historyReadFilter("opportunityActivities").params],
        ),
      historySources ? 500 : null,
      !historySources && Boolean(activityHistoryStartDate),
    );
    relatedOpportunityActivities = rows.map((row) => ({
      id: Number(row.id),
      accountId: Number(row.account_id),
      opportunityId: Number(row.opportunity_id),
      opportunityName: row.opportunity_name || "",
      title: row.title || "",
      actionType: row.action_type || "other",
      status: row.status || "pending",
      priority: row.priority || "medium",
      dueDate: row.due_date || null,
      scheduledAt: historySources ? row.scheduled_at || null : null,
      notes: row.notes || "",
      successCriteria: row.success_criteria || "",
      createdAt: row.created_at || null,
    }));
  }
  if (
    resolvedAccountId &&
    (historySources ? historySources.includes("calendarActivities") : activityHistoryStartDate) &&
    hasReadPermission(user, "calendario_comercial") &&
    hasReadPermission(user, "oportunidades")
  ) {
    await ensureCommercialCalendarActivitiesSchema();
    const calendarAccessScope = hasReadAllPermission(
      user,
      "calendario_comercial",
    )
      ? ""
      : "AND (cca.seller_user_id = ? OR cca.created_by = ?)";
    const calendarParams = [
      resolvedAccountId,
      resolvedAccountId,
      resolvedAccountId,
      resolvedAccountId,
      ...(!historySources ? [activityHistoryStartDate, activityHistoryEndDate] : []),
    ];
    if (!hasReadAllPermission(user, "calendario_comercial")) {
      calendarParams.push(Number(user.id), Number(user.id));
    }
    const calendarRows = await loadSnapshotRows(
      "calendar_activities",
      () =>
        query(
          `SELECT cca.id, cca.kind, cca.activity_type, cca.status,
              cca.scheduled_at, ${historySources ? "DATE_FORMAT(cca.due_date, '%Y-%m-%d')" : "cca.due_date"} AS due_date, cca.objective, cca.note,
              cca.success_criteria, ${historySources ? "COALESCE(cca.opportunity_id, linked_i.primary_opportunity_id)" : "cca.opportunity_id"} AS opportunity_id, cca.interaction_id,
              cca.account_id, cca.contact_id, cca.created_at, o.name AS opportunity_name
       FROM commercial_calendar_activities cca
       ${historySources ? "LEFT JOIN interactions linked_i ON linked_i.id = cca.interaction_id" : ""}
       LEFT JOIN opportunities o ON o.id = ${historySources ? "COALESCE(cca.opportunity_id, linked_i.primary_opportunity_id)" : "cca.opportunity_id"}
       WHERE (
         cca.account_id = ? OR
         cca.opportunity_id IN (
           SELECT account_opportunities.id FROM opportunities account_opportunities
           WHERE account_opportunities.account_id = ?
         ) OR
         cca.interaction_id IN (
           SELECT i.id FROM interactions i
           WHERE i.account_id = ? OR i.primary_opportunity_id IN (
             SELECT interaction_opportunities.id FROM opportunities interaction_opportunities
             WHERE interaction_opportunities.account_id = ?
           )
         )
       )
         ${historySources ? "" : `AND COALESCE(cca.scheduled_at, cca.due_date, cca.created_at) >= ?
         AND COALESCE(cca.scheduled_at, cca.due_date, cca.created_at) < DATE_ADD(?, INTERVAL 1 DAY)`}
         ${calendarAccessScope}
         ${historyReadFilter("calendarActivities").sql}
       ORDER BY COALESCE(cca.scheduled_at, cca.due_date, cca.created_at) DESC,
                cca.id DESC ${historySources ? "LIMIT 501" : ""}`,
          [...calendarParams, ...historyReadFilter("calendarActivities").params],
        ),
      historySources ? 500 : null,
      !historySources,
    );
    relatedCalendarActivities = calendarRows.map((row) => ({
      id: Number(row.id),
      accountId: Number(row.account_id || resolvedAccountId),
      opportunityId: Number(row.opportunity_id || 0) || null,
      opportunityName: row.opportunity_name || "",
      interactionId: Number(row.interaction_id || 0) || null,
      contactId: Number(row.contact_id || 0) || null,
      activityType: row.activity_type || "",
      status: row.status || "pending",
      scheduledAt: row.scheduled_at || null,
      dueDate: row.due_date || null,
      title: row.objective || "",
      notes: row.note || "",
      successCriteria: row.success_criteria || "",
      createdAt: row.created_at || null,
    }));
  }
  const coachContextFor = (item) =>
    coachContextByOpportunity.get(Number(item?.id)) || {};

  const normalizedData = {
    snapshotVersion: "account-intelligence.v1",
    capturedAt: new Date().toISOString(),
    account: resolvedAccount
      ? {
          id: Number(resolvedAccount.id),
          name: resolvedAccount.name || "",
          registrationCode: resolvedAccount.registration_code || "",
          phone: resolvedAccount.phone || "",
          website: resolvedAccount.website || "",
          city: resolvedAccount.city || "",
          stateRegion: resolvedAccount.state_region || "",
          description: clip(resolvedAccount.description, 2000),
        }
      : null,
    selectedOpportunity: opportunity
      ? {
          ...coachContextFor(opportunity),
          id: Number(opportunity.id),
          name: opportunity.name || "",
          accountId: Number(opportunity.account_id),
          contactId: Number(opportunity.contact_id || 0) || null,
          amountUsd: opportunity.amount_usd == null ? null : Number(opportunity.amount_usd),
          closeDate: opportunity.close_date || null,
          updatedAt: opportunity.updated_at || null,
          stageCode: opportunity.stage_code || "",
          stageName: opportunity.stage_name || "",
          commercialStatusCode: opportunity.commercial_status_code || "",
          activationStatusCode: "activada",
          lifecycle: isOpenCustomerOpportunity({
            commercialStatusCode: opportunity.commercial_status_code,
          })
            ? "open"
            : "historical",
        }
      : null,
    selectedContact: contact
      ? {
          id: Number(contact.id),
          accountId: Number(contact.account_id),
          name: [contact.first_name, contact.last_name]
            .filter(Boolean)
            .join(" ")
            .trim(),
          email: contact.email || "",
          phone: contact.phone || "",
          mobile: contact.mobile || "",
          positionTitle: contact.position_title || "",
          department: contact.department || "",
        }
      : null,
    contacts: relatedContacts.map((item) => ({
      id: Number(item.id),
      accountId: Number(item.account_id),
      name: [item.first_name, item.last_name].filter(Boolean).join(" ").trim(),
      email: item.email || "",
      phone: item.phone || "",
      mobile: item.mobile || "",
      positionTitle: item.position_title || "",
      department: item.department || "",
      activationStatusCode: item.activation_status_code || "",
      purchaseParticipation: item.purchase_participation || "",
      hierarchyLevel: item.hierarchy_level || "",
      relationshipType: item.relationship_type || "",
      influenceLevel: item.influence_level || "",
      managerContactId: Number(item.manager_contact_id || 0) || null,
      managerName: item.manager_name || "",
      influencesContactId: Number(item.influences_contact_id || 0) || null,
      influencesName: item.influences_name || "",
    })),
    opportunities: visibleRelatedOpportunities.map((item) => ({
      ...coachContextFor(item),
      id: Number(item.id),
      name: item.name || "",
      accountId: Number(item.account_id),
      contactId: Number(item.contact_id || 0) || null,
      amountUsd: item.amount_usd == null ? null : Number(item.amount_usd),
      closeDate: item.close_date || null,
      updatedAt: item.updated_at || null,
      stageCode: item.stage_code || "",
      stageName: item.stage_name || "",
      commercialStatusCode: item.commercial_status_code || "",
      activationStatusCode: "activada",
      lifecycle: isOpenCustomerOpportunity({
        commercialStatusCode: item.commercial_status_code,
      })
        ? "open"
        : "historical",
    })),
    inactiveOpportunities: visibleRelatedInactiveOpportunities.map((item) => ({
      ...coachContextFor(item),
      id: Number(item.id),
      name: item.name || "",
      accountId: Number(item.account_id),
      contactId: Number(item.contact_id || 0) || null,
      amountUsd: item.amount_usd == null ? null : Number(item.amount_usd),
      closeDate: item.close_date || null,
      updatedAt: item.updated_at || null,
      stageCode: item.stage_code || "",
      stageName: item.stage_name || "",
      commercialStatusCode: item.commercial_status_code || "",
      activationStatusCode: item.activation_status_code || "",
      lifecycle: "inactive",
    })),
    interactions: relatedInteractions.map((item) => ({
      id: Number(item.id),
      accountId: Number(resolvedAccountId),
      ...(item.account_id !== undefined ? { directAccountId: Number(item.account_id || 0) || null } : {}),
      contactIds: contactIdsByInteraction.get(Number(item.id)) || [],
      opportunityId: Number(item.primary_opportunity_id || 0) || null,
      title: item.title || "",
      analysisStatus: item.analysis_status || "",
      summary: clip(item.summary, 1200),
      sourceNotes: clip(item.source_notes, 1200),
      leadSubstatusCode: item.lead_substatus_code || "",
      leadReasonCode: item.lead_reason_code || "",
      leadRequiredActionCode: item.lead_required_action_code || "",
      leadNextActionDueAt: item.lead_next_action_due_at || null,
      createdAt: item.created_at || null,
      updatedAt: item.updated_at || item.created_at || null,
    })),
    activities: relatedInteractions.map((item) => ({
      id: Number(item.id),
      accountId: Number(resolvedAccountId),
      opportunityId: Number(item.primary_opportunity_id || 0) || null,
      title: item.title || "",
      analysisStatus: item.analysis_status || "",
      summary: clip(item.summary, 1200),
      sourceNotes: clip(item.source_notes, 1200),
      leadSubstatusCode: item.lead_substatus_code || "",
      leadReasonCode: item.lead_reason_code || "",
      leadRequiredActionCode: item.lead_required_action_code || "",
      leadNextActionDueAt: item.lead_next_action_due_at || null,
      createdAt: item.created_at || null,
      updatedAt: item.updated_at || item.created_at || null,
    })),
    opportunityActivities: relatedOpportunityActivities,
    calendarActivities: relatedCalendarActivities,
    renewals: relatedRenewals.map((item) => ({
      id: Number(item.id),
      opportunityId: Number(item.opportunity_id),
      providerId: Number(item.provider_id),
      providerName: item.provider_name || "",
      statusCode: item.status_code || "",
      expiresAt: item.expires_at || null,
      renewalCount: Number(item.renewal_count || 0),
      lastRenewedAt: item.last_renewed_at || null,
      notes: item.notes || "",
    })),
    products: visibleRelatedProducts.map((item) => ({
      quotationId: Number(item.quotation_id),
      quotationVersionId: Number(item.quotation_version_id),
      opportunityId: Number(item.opportunity_id),
      providerId: Number(item.provider_id),
      providerName: item.provider_name || "",
      productCode: item.product_code || "",
      description: item.product_description || "",
      itemType: item.item_type || "producto",
      isRenewal: Boolean(item.is_renewal),
      quantity: Number(item.quantity || 0),
      listPriceUnit:
        item.list_price_unit === null ? null : Number(item.list_price_unit),
      currencyCode: item.currency_code || null,
      commercialStatus: item.quotation_status || "unknown",
      fulfillmentStatus: "not_verified",
    })),
    expansionHypotheses: [],
    supportCases: [],
    dataAvailability: { products: true, supportCases: false },
    permissions: {
      canReadAccounts: hasReadPermission(user, "cuentas"),
      canReadContacts: hasReadPermission(user, "contactos"),
      canReadOpportunities: hasReadPermission(user, "oportunidades"),
      canReadInteractions: hasReadPermission(user, "interacciones"),
      canReadOpportunityActivities:
        hasReadPermission(user, "oportunidades") &&
        hasReadPermission(user, "desarrollo_comercial"),
      canReadCalendarActivities:
        hasReadPermission(user, "calendario_comercial") &&
        hasReadPermission(user, "oportunidades"),
      canReadAllCalendarActivities: hasReadAllPermission(
        user,
        "calendario_comercial",
      ),
    },
  };
  normalizedData.expansionHypotheses = buildExpansionHypotheses({
    products: normalizedData.products,
    renewals: normalizedData.renewals,
    catalogItems,
    opportunities: normalizedData.opportunities,
  });
  const normalizedSnapshot = normalizeCustomerIntelligenceSnapshot({
    ...normalizedData,
    accountHealth: buildAccountHealth(normalizedData),
  });
  normalizedSnapshot.collectionScopes = {
    contacts: includeContactHistory ? "activados y no activados" : "solo activados",
    opportunities: [
      governanceSettings.includeWonOpportunities ? "incluye ganadas" : "excluye ganadas",
      governanceSettings.includeLostOpportunities ? "incluye perdidas" : "excluye perdidas",
      governanceSettings.includeCancelledOpportunities ? "incluye anuladas" : "excluye anuladas",
    ].join(", "),
  };
  CUSTOMER_SNAPSHOT_QUERY_METRICS.set(normalizedSnapshot, snapshotQueryMetrics);
  return normalizedSnapshot;
}
