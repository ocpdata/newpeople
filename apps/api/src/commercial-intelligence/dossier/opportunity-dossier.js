import {
  allowedCommercialStatuses, authorizeAccount, canRead, canReadAll, dossierError, opportunityScopeSql, sectionPermissions,
} from "./access.js";
import {
  ACTIVITY_STATUS_MEANINGS, COMMERCIAL_STATUS_MEANINGS, EMPTY_MEANINGS, FAILED_MEANING, MEANINGS,
  QUOTATION_STATUS_MEANINGS, RESTRICTED_MEANING, TRUNCATED_MEANING,
} from "./semantics.js";

export const DOSSIER_LIMITS = Object.freeze({
  stageAnswers: 300, stageRequirements: 100, contacts: 50, activities: 100, calendarActivities: 100,
  opportunityNotes: 50, quotations: 20, purchaseOrders: 20, documents: 50, interactions: 30, history: 50,
  opportunities: 50, pendingActivities: 50,
});
export const SECTION_TITLES = Object.freeze({
  stageAnswers: "Respuestas de todas las etapas",
  stageRequirements: "Preguntas de la etapa actual",
  contacts: "Contactos de la cuenta",
  activities: "Actividades de la oportunidad",
  calendarActivities: "Actividades de calendario",
  opportunityNotes: "Notas de la oportunidad",
  quotations: "Cotizaciones y versiones",
  purchaseOrders: "Orden de compra del cliente",
  documents: "Documentos asociados",
  interactions: "Interacciones",
  history: "Historial de cambios comerciales",
  opportunities: "Oportunidades de la cuenta",
  pendingActivities: "Actividades pendientes de la cuenta",
});
const TEXT_LIMIT = 4000;

function clip(value, limit = TEXT_LIMIT) {
  if (value === null || value === undefined) return { value: null, truncated: false };
  const text = String(value);
  return text.length > limit ? { value: text.slice(0, limit), truncated: true } : { value: text, truncated: false };
}

function withText(item, key, value, limit) {
  const clipped = clip(value, limit);
  item[key] = clipped.value;
  if (clipped.truncated) item.truncatedFields = [...(item.truncatedFields || []), key];
  return item;
}

export async function buildSection({ key, allowed, limit = DOSSIER_LIMITS[key], load, map }) {
  const base = { key, title: SECTION_TITLES[key] };
  if (!allowed) return { ...base, status: "restricted", total: null, items: [], meaning: RESTRICTED_MEANING };
  try {
    const rows = await load(limit + 1);
    const truncated = rows.length > limit;
    const items = rows.slice(0, limit).map(map);
    if (truncated) return { ...base, status: "truncated", total: null, totalAtLeast: limit + 1, items, meaning: TRUNCATED_MEANING };
    return items.length
      ? { ...base, status: "loaded", total: items.length, items }
      : { ...base, status: "empty", total: 0, items, meaning: EMPTY_MEANINGS[key] };
  } catch (error) {
    const errorCode = String(error?.code || error?.name || "Error").slice(0, 80);
    console.error("[dossier] Section read failed", { section: key, errorCode });
    return { ...base, status: "failed", total: null, items: [], errorCode, meaning: FAILED_MEANING };
  }
}

async function loadAuthorizedOpportunity({ user, opportunityId, governance, run }) {
  if (!canRead(user, "oportunidades")) {
    throw dossierError(403, "DOSSIER_PERMISSION_DENIED", "Sin permiso para consultar oportunidades.");
  }
  const scope = opportunityScopeSql(user);
  const rows = await run(
    `SELECT o.id, o.name, o.account_id, o.contact_id, o.amount_usd,
            DATE_FORMAT(o.close_date, '%Y-%m-%d') AS close_date,
            o.sales_stage_id, oss.code AS stage_code, oss.name AS stage_name,
            o.commercial_status_id, ocs.code AS commercial_status_code, ocs.name AS commercial_status_name,
            DATE_FORMAT(o.commercial_closed_at, '%Y-%m-%d') AS commercial_closed_at, o.commercial_close_reason,
            seller.full_name AS seller_name, presales.full_name AS presales_name, bl.name AS business_line_name,
            CAST(o.created_at AS CHAR) AS created_at, CAST(o.updated_at AS CHAR) AS updated_at
     FROM opportunities o
     INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
     INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
     INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
     LEFT JOIN users seller ON seller.id = o.seller_user_id
     LEFT JOIN users presales ON presales.id = o.presales_user_id
     LEFT JOIN opportunity_business_lines bl ON bl.id = o.business_line_id
     WHERE o.id = ? AND oas.code = 'activada' AND ocs.code IN (?) ${scope.sql}
     LIMIT 1`,
    [Number(opportunityId), allowedCommercialStatuses(governance), ...scope.params],
  );
  if (!rows.length) throw dossierError(404, "DOSSIER_OPPORTUNITY_UNAVAILABLE", "La oportunidad no está disponible.");
  return rows[0];
}

function opportunityProfile(row) {
  return {
    evidenceId: `opp${row.id}`,
    source: { table: "opportunities", id: Number(row.id) },
    id: Number(row.id),
    name: row.name,
    accountId: Number(row.account_id),
    amountUsd: row.amount_usd === null ? null : String(row.amount_usd),
    closeDate: row.close_date,
    salesStageId: Number(row.sales_stage_id),
    stageCode: row.stage_code,
    stageName: row.stage_name,
    commercialStatusId: Number(row.commercial_status_id),
    commercialStatusCode: row.commercial_status_code,
    commercialStatusName: row.commercial_status_name,
    commercialClosedAt: row.commercial_closed_at,
    commercialCloseReason: row.commercial_close_reason || null,
    contactId: row.contact_id === null ? null : Number(row.contact_id),
    sellerName: row.seller_name || null,
    presalesName: row.presales_name || null,
    businessLine: row.business_line_name || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    meanings: {
      amountUsd: MEANINGS.amount,
      closeDate: MEANINGS.closeDate,
      stage: MEANINGS.stage,
      commercialStatus: COMMERCIAL_STATUS_MEANINGS[row.commercial_status_code] || null,
    },
  };
}

export function contactsSection({ accountId, opportunityContactId, run, allowed }) {
  return buildSection({
    key: "contacts", allowed,
    load: (limit) => run(
      `SELECT c.id, c.first_name, c.last_name, c.position_title, c.department,
              pp.name AS purchase_participation, il.name AS influence_level,
              h.name AS hierarchy_level, rt.name AS relationship_type
       FROM contacts c
       INNER JOIN contact_activation_statuses cas ON cas.id = c.activation_status_id
       LEFT JOIN contact_purchase_participations pp ON pp.id = c.purchase_participation_id
       LEFT JOIN contact_influence_levels il ON il.id = c.influence_level_id
       LEFT JOIN contact_hierarchy_levels h ON h.id = c.hierarchy_level_id
       LEFT JOIN contact_relationship_types rt ON rt.id = c.relationship_type_id
       WHERE c.account_id = ? AND cas.code = 'activado'
       ORDER BY (c.id = ?) DESC, c.first_name, c.last_name, c.id
       LIMIT ?`,
      [Number(accountId), Number(opportunityContactId || 0), limit],
    ),
    map: (row) => {
      const isOpportunityContact = Number(row.id) === Number(opportunityContactId || 0);
      return {
        evidenceId: `contact${row.id}`,
        source: { table: "contacts", id: Number(row.id) },
        firstName: row.first_name, lastName: row.last_name,
        positionTitle: row.position_title || null, department: row.department || null,
        purchaseParticipation: row.purchase_participation || null, influenceLevel: row.influence_level || null,
        hierarchyLevel: row.hierarchy_level || null, relationshipType: row.relationship_type || null,
        isOpportunityContact,
        meanings: {
          positionTitle: MEANINGS.contactTitle,
          ...(isOpportunityContact ? { association: MEANINGS.opportunityContact } : {}),
        },
      };
    },
  });
}

function markSupersededAnswers(items) {
  const latestByQuestion = new Map();
  for (const item of items) {
    const key = item.questionId ? `q${item.questionId}` : `s${item.stageId}:${item.questionCode}`;
    const current = latestByQuestion.get(key);
    if (!current || item.source.id > current.source.id) latestByQuestion.set(key, item);
  }
  return items.map((item) => {
    const key = item.questionId ? `q${item.questionId}` : `s${item.stageId}:${item.questionCode}`;
    const latest = latestByQuestion.get(key);
    return latest === item
      ? { ...item, current: true }
      : { ...item, current: false, supersededBy: latest.evidenceId, meanings: { answer: MEANINGS.supersededAnswer } };
  });
}

async function quotationsSection({ opportunityId, run, allowed }) {
  return buildSection({
    key: "quotations", allowed,
    load: async (limit) => {
      const quotations = await run(
        `SELECT q.id, q.latest_version_id, qas.code AS activation_code
         FROM quotations q
         LEFT JOIN quotation_activation_statuses qas ON qas.id = q.activation_status_id
         WHERE q.opportunity_id = ? ORDER BY q.id DESC LIMIT ?`,
        [Number(opportunityId), limit],
      );
      if (!quotations.length) return [];
      const versions = await run(
        `SELECT v.id, v.quotation_id, v.version_number, v.proposal_name,
                DATE_FORMAT(v.quotation_date, '%Y-%m-%d') AS quotation_date, v.status_id,
                qs.code AS status_code, qs.name AS status_name, v.currency_code,
                CAST(v.updated_at AS CHAR) AS updated_at
         FROM quotation_versions v
         INNER JOIN quotation_statuses qs ON qs.id = v.status_id
         WHERE v.quotation_id IN (?)
         ORDER BY v.quotation_id, v.version_number`,
        [quotations.map((row) => Number(row.id))],
      );
      return quotations.map((row) => ({ ...row, versions: versions.filter((version) => Number(version.quotation_id) === Number(row.id)) }));
    },
    map: (row) => ({
      evidenceId: `quote${row.id}`,
      source: { table: "quotations", id: Number(row.id) },
      activationCode: row.activation_code || null,
      latestVersionEvidenceId: row.latest_version_id ? `qv${row.latest_version_id}` : null,
      versions: row.versions.map((version) => ({
        evidenceId: `qv${version.id}`,
        source: { table: "quotation_versions", id: Number(version.id) },
        quotationId: Number(version.quotation_id),
        versionNumber: Number(version.version_number),
        isLatest: Number(version.id) === Number(row.latest_version_id),
        proposalName: version.proposal_name || null,
        quotationDate: version.quotation_date,
        statusId: Number(version.status_id),
        statusCode: version.status_code,
        statusName: version.status_name,
        currencyCode: version.currency_code || null,
        updatedAt: version.updated_at,
        meanings: { status: QUOTATION_STATUS_MEANINGS[version.status_code] || null },
      })),
    }),
  });
}

export async function buildOpportunityDossier({ user, opportunityId, governance, run, now = new Date() }) {
  const row = await loadAuthorizedOpportunity({ user, opportunityId, governance, run });
  const account = await authorizeAccount({ user, accountId: row.account_id, run });
  const opportunity = opportunityProfile(row);
  const permissions = sectionPermissions(user);
  const id = opportunity.id;
  const sections = {};

  const stageAnswers = await buildSection({
    key: "stageAnswers", allowed: true,
    load: (limit) => run(
      `SELECT a.id, a.sales_stage_id, s.name AS stage_name, s.stage_order, a.question_id,
              COALESCE(q.code, a.question_code_snapshot) AS question_code,
              COALESCE(a.question_prompt_snapshot, q.prompt) AS question_prompt,
              a.answer_value, CAST(a.answered_at AS CHAR) AS answered_at, u.full_name AS answered_by
       FROM opportunity_stage_question_answers a
       LEFT JOIN opportunity_sales_stages s ON s.id = a.sales_stage_id
       LEFT JOIN opportunity_stage_questions q ON q.id = a.question_id
       LEFT JOIN users u ON u.id = a.answered_by_user_id
       WHERE a.opportunity_id = ?
       ORDER BY s.stage_order, a.sales_stage_id, a.id
       LIMIT ?`,
      [id, limit],
    ),
    map: (answer) => withText({
      evidenceId: `ans${answer.id}`,
      source: { table: "opportunity_stage_question_answers", id: Number(answer.id) },
      stageId: Number(answer.sales_stage_id),
      stageName: answer.stage_name || null,
      questionId: answer.question_id === null ? null : Number(answer.question_id),
      questionCode: answer.question_code || null,
      question: answer.question_prompt || null,
      answeredAt: answer.answered_at,
      answeredBy: answer.answered_by || null,
      meanings: { answer: MEANINGS.stageAnswer },
    }, "answerValue", answer.answer_value),
  });
  sections.stageAnswers = { ...stageAnswers, items: markSupersededAnswers(stageAnswers.items) };

  sections.stageRequirements = await buildSection({
    key: "stageRequirements", allowed: true,
    load: (limit) => run(
      `SELECT q.id, q.code, q.prompt, q.is_required,
              (SELECT a.id FROM opportunity_stage_question_answers a
               WHERE a.opportunity_id = ? AND a.question_id = q.id ORDER BY a.id DESC LIMIT 1) AS latest_answer_id
       FROM opportunity_stage_questions q
       WHERE q.sales_stage_id = ? AND q.is_active = 1
       ORDER BY q.display_order, q.id
       LIMIT ?`,
      [id, opportunity.salesStageId, limit],
    ),
    map: (question) => ({
      evidenceId: `req${id}.${question.id}`,
      source: { table: "opportunity_stage_questions", id: Number(question.id) },
      stageName: opportunity.stageName,
      questionCode: question.code,
      question: question.prompt,
      required: Number(question.is_required) === 1,
      answered: Boolean(question.latest_answer_id),
      answerEvidenceId: question.latest_answer_id ? `ans${question.latest_answer_id}` : null,
      meanings: { requirement: MEANINGS.requirement },
    }),
  });

  sections.contacts = await contactsSection({
    accountId: account.id, opportunityContactId: opportunity.contactId, run, allowed: permissions.contacts,
  });

  sections.activities = await buildSection({
    key: "activities", allowed: permissions.activities,
    load: (limit) => run(
      `SELECT a.id, a.title, a.action_type, a.status, a.priority,
              DATE_FORMAT(a.due_date, '%Y-%m-%d') AS due_date, CAST(a.scheduled_at AS CHAR) AS scheduled_at,
              a.success_criteria, a.notes, a.is_primary_next_step, u.full_name AS owner_name,
              CAST(a.created_at AS CHAR) AS created_at, CAST(a.updated_at AS CHAR) AS updated_at
       FROM opportunity_workspace_actions a
       LEFT JOIN users u ON u.id = a.owner_user_id
       WHERE a.opportunity_id = ?
       ORDER BY COALESCE(a.due_date, DATE(a.created_at)) DESC, a.id DESC
       LIMIT ?`,
      [id, limit],
    ),
    map: (activity) => withText({
      evidenceId: `act${activity.id}`,
      source: { table: "opportunity_workspace_actions", id: Number(activity.id) },
      title: activity.title,
      actionType: activity.action_type,
      status: activity.status,
      priority: activity.priority || null,
      dueDate: activity.due_date,
      scheduledAt: activity.scheduled_at,
      successCriteria: activity.success_criteria || null,
      isPrimaryNextStep: Number(activity.is_primary_next_step) === 1,
      ownerName: activity.owner_name || null,
      createdAt: activity.created_at,
      updatedAt: activity.updated_at,
      meanings: {
        status: ACTIVITY_STATUS_MEANINGS[activity.status] || null,
        dueDate: MEANINGS.dueDate,
        notes: MEANINGS.activityNote,
      },
    }, "notes", activity.notes || null),
  });

  const calendarScope = canReadAll(user, "calendario_comercial") ? "" : "AND (cca.seller_user_id = ? OR cca.created_by = ?)";
  sections.calendarActivities = await buildSection({
    key: "calendarActivities", allowed: permissions.calendarActivities,
    load: (limit) => run(
      `SELECT cca.id, cca.kind, cca.activity_type, cca.status, CAST(cca.scheduled_at AS CHAR) AS scheduled_at,
              DATE_FORMAT(cca.due_date, '%Y-%m-%d') AS due_date, cca.objective, cca.note, cca.success_criteria,
              cca.contact_id, cca.is_primary_next_step, CAST(cca.created_at AS CHAR) AS created_at
       FROM commercial_calendar_activities cca
       LEFT JOIN interactions linked_i ON linked_i.id = cca.interaction_id
       WHERE COALESCE(cca.opportunity_id, linked_i.primary_opportunity_id) = ? ${calendarScope}
       ORDER BY COALESCE(cca.scheduled_at, cca.due_date, cca.created_at) DESC, cca.id DESC
       LIMIT ?`,
      [id, ...(calendarScope ? [Number(user.id), Number(user.id)] : []), limit],
    ),
    map: (activity) => withText({
      evidenceId: `cal${activity.id}`,
      source: { table: "commercial_calendar_activities", id: Number(activity.id) },
      kind: activity.kind,
      activityType: activity.activity_type,
      status: activity.status,
      scheduledAt: activity.scheduled_at,
      dueDate: activity.due_date,
      objective: activity.objective || null,
      successCriteria: activity.success_criteria || null,
      contactId: activity.contact_id === null ? null : Number(activity.contact_id),
      isPrimaryNextStep: Number(activity.is_primary_next_step) === 1,
      createdAt: activity.created_at,
      meanings: {
        status: ACTIVITY_STATUS_MEANINGS[activity.status] || null,
        dueDate: MEANINGS.dueDate,
        note: MEANINGS.activityNote,
      },
    }, "note", activity.note || null),
  });

  sections.opportunityNotes = await buildSection({
    key: "opportunityNotes", allowed: permissions.opportunityNotes,
    load: (limit) => run(
      `SELECT n.id, n.note_text, n.source_type, n.attribution, n.certainty,
              CAST(n.created_at AS CHAR) AS created_at, u.full_name AS author_name
       FROM opportunity_notes n
       LEFT JOIN users u ON u.id = n.created_by_user_id
       WHERE n.opportunity_id = ?
       ORDER BY n.id DESC
       LIMIT ?`,
      [id, limit],
    ),
    map: (note) => withText({
      evidenceId: `note${note.id}`,
      source: { table: "opportunity_notes", id: Number(note.id) },
      sourceType: note.source_type || null,
      attribution: note.attribution || null,
      certainty: note.certainty || null,
      authorName: note.author_name || null,
      createdAt: note.created_at,
      meanings: { note: MEANINGS.opportunityNote },
    }, "noteText", note.note_text),
  });

  sections.quotations = await quotationsSection({ opportunityId: id, run, allowed: permissions.quotations });

  sections.purchaseOrders = await buildSection({
    key: "purchaseOrders", allowed: permissions.purchaseOrders,
    load: (limit) => run(
      `SELECT w.id, w.quotation_id, w.quotation_version_id, v.version_number, d.original_file_name,
              CAST(w.created_at AS CHAR) AS created_at, CAST(w.accepted_at AS CHAR) AS accepted_at
       FROM quotation_won_documents w
       LEFT JOIN quotation_versions v ON v.id = w.quotation_version_id
       LEFT JOIN documents d ON d.id = w.document_id
       WHERE w.opportunity_id = ? AND w.document_role = 'purchase_order'
       ORDER BY w.id DESC
       LIMIT ?`,
      [id, limit],
    ),
    map: (order) => ({
      evidenceId: `po${order.id}`,
      source: { table: "quotation_won_documents", id: Number(order.id) },
      quotationEvidenceId: `quote${order.quotation_id}`,
      versionNumber: order.version_number === null ? null : Number(order.version_number),
      fileName: order.original_file_name || null,
      registeredAt: order.created_at,
      acceptedAt: order.accepted_at || null,
      meanings: { document: MEANINGS.purchaseOrder },
    }),
  });

  sections.documents = await buildSection({
    key: "documents", allowed: permissions.documents,
    load: (limit) => run(
      `SELECT d.id, d.original_file_name, d.document_kind, d.mime_type, d.processing_status, l.link_type,
              CAST(d.created_at AS CHAR) AS created_at
       FROM opportunity_document_links l
       INNER JOIN documents d ON d.id = l.document_id
       WHERE l.opportunity_id = ? AND d.is_deleted = 0
       ORDER BY d.id DESC
       LIMIT ?`,
      [id, limit],
    ),
    map: (document) => ({
      evidenceId: `doc${document.id}`,
      source: { table: "documents", id: Number(document.id) },
      fileName: document.original_file_name || null,
      documentKind: document.document_kind || null,
      mimeType: document.mime_type || null,
      processingStatus: document.processing_status || null,
      linkType: document.link_type || null,
      createdAt: document.created_at,
      meanings: { document: MEANINGS.document },
    }),
  });

  const interactionScope = canReadAll(user, "interacciones") ? ""
    : "AND (i.seller_user_id = ? OR i.created_by = ? OR EXISTS (SELECT 1 FROM account_owners ao WHERE ao.account_id = ? AND ao.user_id = ?))";
  sections.interactions = await buildSection({
    key: "interactions", allowed: permissions.interactions,
    load: (limit) => run(
      `SELECT i.id, i.title, i.summary, i.analysis_status, CAST(i.created_at AS CHAR) AS created_at,
              CAST(i.updated_at AS CHAR) AS updated_at
       FROM interactions i
       WHERE i.primary_opportunity_id = ? ${interactionScope}
       ORDER BY COALESCE(i.updated_at, i.created_at) DESC, i.id DESC
       LIMIT ?`,
      [id, ...(interactionScope ? [Number(user.id), Number(user.id), account.id, Number(user.id)] : []), limit],
    ),
    map: (interaction) => withText({
      evidenceId: `int${interaction.id}`,
      source: { table: "interactions", id: Number(interaction.id) },
      title: interaction.title || null,
      analysisStatus: interaction.analysis_status || null,
      createdAt: interaction.created_at,
      updatedAt: interaction.updated_at,
      meanings: { summary: MEANINGS.interaction },
    }, "summary", interaction.summary || null, 1500),
  });

  sections.history = await buildSection({
    key: "history", allowed: permissions.history,
    load: (limit) => loadCommercialHistory({ opportunityId: id, run, limit }),
    map: (event) => ({
      evidenceId: `audit${event.id}`,
      source: { table: "audit_log", id: Number(event.id) },
      action: event.action,
      performedBy: event.performed_by_name || null,
      createdAt: event.created_at,
      changes: event.changes,
      ...(event.unparsed ? { unparsed: true } : {}),
      meanings: { event: MEANINGS.history },
    }),
  });

  const dossier = {
    kind: "opportunity",
    generatedAt: now.toISOString(),
    account: { evidenceId: `acct${account.id}`, source: { table: "accounts", id: account.id }, ...account },
    opportunity,
    sections,
  };
  return { ...dossier, size: dossierSize(dossier) };
}

export async function buildAccountDossier({ user, accountId, governance, run, now = new Date() }) {
  const account = await authorizeAccount({ user, accountId, run });
  const permissions = sectionPermissions(user);
  const scope = opportunityScopeSql(user);
  const showContactNames = canRead(user, "contactos");
  const sections = {};
  sections.opportunities = await buildSection({
    key: "opportunities", allowed: canRead(user, "oportunidades"),
    load: (limit) => run(
      `SELECT o.id, o.name, o.amount_usd, DATE_FORMAT(o.close_date, '%Y-%m-%d') AS close_date,
              o.sales_stage_id, oss.name AS stage_name, o.commercial_status_id,
              ocs.code AS commercial_status_code, ocs.name AS commercial_status_name, o.contact_id,
              ${showContactNames ? "CONCAT_WS(' ', c.first_name, c.last_name)" : "NULL"} AS contact_name,
              CAST(o.updated_at AS CHAR) AS updated_at
       FROM opportunities o
       INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
       INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
       INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
       LEFT JOIN contacts c ON c.id = o.contact_id AND c.account_id = o.account_id
       WHERE o.account_id = ? AND oas.code = 'activada' AND ocs.code IN (?) ${scope.sql}
       ORDER BY o.close_date IS NULL, o.close_date ASC, o.amount_usd DESC, o.id
       LIMIT ?`,
      [account.id, allowedCommercialStatuses(governance), ...scope.params, limit],
    ),
    map: (row) => ({
      evidenceId: `opp${row.id}`,
      source: { table: "opportunities", id: Number(row.id) },
      id: Number(row.id),
      name: row.name,
      amountUsd: row.amount_usd === null ? null : String(row.amount_usd),
      closeDate: row.close_date,
      salesStageId: Number(row.sales_stage_id),
      stageName: row.stage_name,
      commercialStatusId: Number(row.commercial_status_id),
      commercialStatusCode: row.commercial_status_code,
      commercialStatusName: row.commercial_status_name,
      contactId: row.contact_id === null ? null : Number(row.contact_id),
      contactName: row.contact_name || null,
      updatedAt: row.updated_at,
      meanings: {
        closeDate: MEANINGS.closeDate,
        commercialStatus: COMMERCIAL_STATUS_MEANINGS[row.commercial_status_code] || null,
      },
    }),
  });
  sections.contacts = await contactsSection({ accountId: account.id, opportunityContactId: null, run,
    allowed: permissions.contacts });
  sections.pendingActivities = await buildSection({
    key: "pendingActivities", allowed: permissions.activities,
    load: (limit) => run(
      `SELECT a.id, a.opportunity_id, o.name AS opportunity_name, a.title, a.action_type, a.status,
              DATE_FORMAT(a.due_date, '%Y-%m-%d') AS due_date, CAST(a.scheduled_at AS CHAR) AS scheduled_at,
              a.notes, CAST(a.created_at AS CHAR) AS created_at
       FROM opportunity_workspace_actions a
       INNER JOIN opportunities o ON o.id = a.opportunity_id
       INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
       INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
       WHERE o.account_id = ? AND oas.code = 'activada' AND ocs.code IN (?) ${scope.sql}
         AND a.status IN ('pending', 'rescheduled')
       ORDER BY COALESCE(a.due_date, DATE(a.created_at)), a.id
       LIMIT ?`,
      [account.id, allowedCommercialStatuses(governance), ...scope.params, limit],
    ),
    map: (activity) => withText({
      evidenceId: `act${activity.id}`,
      source: { table: "opportunity_workspace_actions", id: Number(activity.id) },
      opportunityId: Number(activity.opportunity_id),
      opportunityName: activity.opportunity_name,
      title: activity.title,
      actionType: activity.action_type,
      status: activity.status,
      dueDate: activity.due_date,
      scheduledAt: activity.scheduled_at,
      createdAt: activity.created_at,
      meanings: {
        status: ACTIVITY_STATUS_MEANINGS[activity.status] || null,
        dueDate: MEANINGS.dueDate,
        notes: MEANINGS.activityNote,
      },
    }, "notes", activity.notes || null),
  });
  const dossier = {
    kind: "account",
    generatedAt: now.toISOString(),
    account: { evidenceId: `acct${account.id}`, source: { table: "accounts", id: account.id }, ...account },
    sections,
  };
  return { ...dossier, size: dossierSize(dossier) };
}

const HISTORY_ACTIONS = ["created", "updated", "stage_advanced", "stage_retreated", "commercial_closed",
  "commercial_history_created", "commercial_history_changed"];
const HISTORY_FIELDS = Object.freeze({
  amount_usd: "importe USD", close_date: "fecha de cierre", sales_stage_id: "etapa",
  commercial_status_id: "estado comercial", contact_id: "contacto asociado", commercial_closed_at: "fecha de cierre comercial",
});
const HISTORY_RAW_LIMIT = 2000;

function historyChanges(raw) {
  const fields = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!fields || typeof fields !== "object") return [];
  const history = fields.commercial_history?.after;
  if (history?.before_state !== undefined || history?.after_state !== undefined) {
    const before = history.before_state || {};
    const after = history.after_state || {};
    return Object.keys(HISTORY_FIELDS)
      .filter((field) => String(before[field] ?? "") !== String(after[field] ?? ""))
      .map((field) => ({ field, before: before[field] ?? null, after: after[field] ?? null }));
  }
  return Object.keys(HISTORY_FIELDS)
    .filter((field) => fields[field] && typeof fields[field] === "object" &&
      String(fields[field].before ?? "") !== String(fields[field].after ?? ""))
    .map((field) => ({ field, before: fields[field].before ?? null, after: fields[field].after ?? null }));
}

export async function loadCommercialHistory({ opportunityId, run, limit }) {
  const rows = await run(
    `SELECT a.id, a.action, a.changed_fields, a.performed_by_name, CAST(a.created_at AS CHAR) AS created_at
     FROM audit_log a
     WHERE a.entity_type = 'opportunity' AND a.entity_id = ? AND a.status = 'success' AND a.action IN (?)
     ORDER BY a.id
     LIMIT ?`,
    [Number(opportunityId), HISTORY_ACTIONS, HISTORY_RAW_LIMIT],
  );
  if (rows.length >= HISTORY_RAW_LIMIT) {
    throw Object.assign(new Error("El historial supera el límite de lectura."), { code: "DOSSIER_HISTORY_LIMIT" });
  }
  const catalogs = await run(
    `SELECT 'stage' AS catalog, id, name FROM opportunity_sales_stages
     UNION ALL SELECT 'commercial', id, name FROM opportunity_commercial_statuses`,
  );
  const label = (field, value) => {
    if (value === null || value === undefined) return null;
    const catalog = field === "sales_stage_id" ? "stage" : field === "commercial_status_id" ? "commercial" : null;
    const match = catalog && catalogs.find((item) => item.catalog === catalog && Number(item.id) === Number(value));
    return match ? match.name : String(value).slice(0, 40);
  };
  const events = rows.flatMap((row) => {
    let changes;
    try {
      changes = historyChanges(row.changed_fields);
    } catch {
      console.error("[dossier] Unparsed audit event", { auditId: Number(row.id) });
      return [{ ...row, changes: [], unparsed: true }];
    }
    if (!changes.length) return [];
    return [{ ...row, changes: changes.map((change) => ({
      field: change.field, label: HISTORY_FIELDS[change.field],
      before: label(change.field, change.before), after: label(change.field, change.after),
    })) }];
  });
  const signature = (event) => JSON.stringify(event.changes);
  const deduplicated = events.filter((event, index) => event.action !== "updated" || event.unparsed ||
    ![events[index - 1], events[index + 1]].some((neighbor) => neighbor && neighbor.action !== "updated" &&
      signature(neighbor) === signature(event)));
  return deduplicated.reverse().slice(0, limit);
}

export function dossierSize(dossier) {  const chars = JSON.stringify(dossier).length;
  return { chars, approxTokens: Math.ceil(chars / 3.5) };
}

export function indexDossierEvidence(dossier) {
  const index = new Map();
  const add = (item) => {
    if (!item?.evidenceId) return;
    if (index.has(item.evidenceId)) {
      throw dossierError(500, "DOSSIER_DUPLICATE_EVIDENCE", `Evidencia duplicada en el expediente: ${item.evidenceId}`);
    }
    index.set(item.evidenceId, item);
  };
  add(dossier.account);
  add(dossier.opportunity);
  for (const section of Object.values(dossier.sections)) {
    for (const item of section.items) {
      add(item);
      for (const version of item.versions || []) add(version);
    }
  }
  return index;
}
