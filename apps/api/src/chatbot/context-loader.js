import { query } from "../db.js";
import { hasAnyPermission } from "./common.js";

function normalizeId(value) {
  const id = Number(value || 0);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function loadActiveOpportunityContext({ user, contextSnapshot = {} }) {
  const activeEntity = contextSnapshot?.activeEntity;
  if (String(activeEntity?.type || "").trim().toLowerCase() !== "opportunity") {
    return null;
  }

  const opportunityId = normalizeId(activeEntity?.id);
  if (!opportunityId) return null;

  const canReadAll = hasAnyPermission(user, ["oportunidades.read_all"]);
  const params = canReadAll
    ? [opportunityId]
    : [Number(user?.id || 0), opportunityId, Number(user?.id || 0), Number(user?.id || 0)];
  const scopeJoin = canReadAll
    ? ""
    : "LEFT JOIN account_owners ao_scope ON ao_scope.account_id = o.account_id AND ao_scope.user_id = ?";
  const scopeWhere = canReadAll
    ? ""
    : "AND (ao_scope.user_id IS NOT NULL OR o.created_by = ? OR o.seller_user_id = ?)";

  const opportunityRows = await query(
    `SELECT o.id, o.name, o.amount_usd, o.close_date,
            o.account_id, o.contact_id, o.business_line_id,
            o.seller_user_id, o.presales_user_id, o.activation_status_id,
            oss.id AS sales_stage_id, oss.code AS sales_stage_code,
            oss.name AS sales_stage_name,
            ocs.code AS commercial_status_code,
            ocs.name AS commercial_status_name,
            a.name AS account_name,
            c.first_name AS contact_first_name,
            c.last_name AS contact_last_name,
            c.email AS contact_email
     FROM opportunities o
     ${scopeJoin}
     INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
     INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
     LEFT JOIN accounts a ON a.id = o.account_id
     LEFT JOIN contacts c ON c.id = o.contact_id
     WHERE o.id = ?
       ${scopeWhere}
     LIMIT 1`,
    params,
  );

  const opportunity = opportunityRows[0];
  if (!opportunity) return null;

  const answerRows = await query(
    `SELECT q.id AS question_id, q.prompt, q.response_type,
            q.is_required, a.answer_value, a.answered_at
     FROM opportunity_stage_questions q
     LEFT JOIN opportunity_stage_question_answers a ON a.id = (
       SELECT a2.id
       FROM opportunity_stage_question_answers a2
       WHERE a2.opportunity_id = ?
         AND a2.sales_stage_id = ?
         AND a2.question_id = q.id
       ORDER BY a2.id DESC
       LIMIT 1
     )
     WHERE q.sales_stage_id = ? AND q.is_active = 1
     ORDER BY q.display_order, q.id`,
    [opportunityId, Number(opportunity.sales_stage_id), Number(opportunity.sales_stage_id)],
  );

  return {
    opportunity: {
      id: Number(opportunity.id),
      name: opportunity.name || "",
      amountUsd: Number(opportunity.amount_usd || 0),
      closeDate: opportunity.close_date || null,
      accountId: Number(opportunity.account_id || 0) || null,
      contactId: Number(opportunity.contact_id || 0) || null,
      businessLineId: Number(opportunity.business_line_id || 0) || null,
      sellerUserId: Number(opportunity.seller_user_id || 0) || null,
      presalesUserId: Number(opportunity.presales_user_id || 0) || null,
      activationStatusId: Number(opportunity.activation_status_id || 0) || null,
      accountName: opportunity.account_name || "",
      contact: {
        name: `${opportunity.contact_first_name || ""} ${opportunity.contact_last_name || ""}`.trim(),
        email: opportunity.contact_email || "",
      },
    },
    stage: {
      id: Number(opportunity.sales_stage_id),
      code: opportunity.sales_stage_code || "",
      name: opportunity.sales_stage_name || "",
    },
    commercialStatus: {
      code: opportunity.commercial_status_code || "",
      name: opportunity.commercial_status_name || "",
    },
    stageAnswers: answerRows.map((answer) => ({
      questionId: Number(answer.question_id),
      prompt: answer.prompt || "",
      responseType: answer.response_type || "",
      required: Boolean(answer.is_required),
      answerValue: answer.answer_value || "",
      answeredAt: answer.answered_at || null,
    })),
  };
}

export function mergeLoadedOpportunityContext(contextSnapshot = {}, loaded) {
  if (!loaded) return contextSnapshot || {};
  return {
    ...(contextSnapshot || {}),
    visibleData: {
      ...(contextSnapshot?.visibleData || {}),
      opportunity: loaded.opportunity,
      amountUsd: loaded.opportunity.amountUsd,
      closeDate: loaded.opportunity.closeDate,
      currentSalesStageId: loaded.stage.id,
      currentSalesStageCode: loaded.stage.code,
      currentSalesStageName: loaded.stage.name,
      commercialStatusCode: loaded.commercialStatus.code,
      commercialStatusName: loaded.commercialStatus.name,
      stageAnswers: loaded.stageAnswers,
    },
  };
}
