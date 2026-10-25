import { canReadAll } from "./access.js";
import { buildSection, withText } from "./opportunity-dossier.js";
import { EXTENDED_MEANINGS } from "./semantics.js";

// Sources added in migration phase A1: account profile, opportunity workspace, account-level
// interactions and calendar, manufacturer registrations and proposals.

// Registration dates are stored as the UTC midnight of the chosen day; the MySQL driver returns them as Date
// objects, as the registrations module reads them. The calendar day is the UTC date of that instant.
export function registrationDay(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : date.toISOString().slice(0, 10);
}

const parseJson = (value) => {
  if (!value || typeof value !== "string") return value ?? null;
  try { return JSON.parse(value); } catch { return null; }
};

export async function accountProfileSection({ account, run, allowed }) {
  return buildSection({
    key: "accountProfile", allowed,
    load: () => run(
      `SELECT a.id, at.name AS account_type, es.name AS economic_sector, a.website, a.city, a.state_region,
              c.name AS country, a.description, a.phone, a.address_line, a.postal_code,
              (SELECT GROUP_CONCAT(u.full_name ORDER BY u.full_name SEPARATOR ', ')
                 FROM account_owners ao INNER JOIN users u ON u.id = ao.user_id WHERE ao.account_id = a.id) AS owner_names,
              CAST(a.created_at AS CHAR) AS created_at, CAST(a.updated_at AS CHAR) AS updated_at
       FROM accounts a
       LEFT JOIN account_types at ON at.id = a.account_type_id
       LEFT JOIN economic_sectors es ON es.id = a.economic_sector_id
       LEFT JOIN countries c ON c.id = a.country_id
       WHERE a.id = ?
       LIMIT 1`,
      [account.id],
    ),
    map: (row) => withText({
      evidenceId: `acct${row.id}`,
      source: { table: "accounts", id: Number(row.id) },
      name: account.name,
      accountType: row.account_type || null,
      economicSector: row.economic_sector || null,
      website: row.website ? String(row.website).split("?")[0] : null,
      city: row.city || null,
      stateRegion: row.state_region || null,
      country: row.country || null,
      phone: row.phone || null,
      address: [row.address_line, row.postal_code].filter(Boolean).join(", ") || null,
      ownerNames: row.owner_names || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      meanings: { accountType: EXTENDED_MEANINGS.accountType, ownerNames: EXTENDED_MEANINGS.accountOwners,
        description: EXTENDED_MEANINGS.accountDescription },
    }, "description", row.description || null, 2000),
  });
}

/** Opportunity workspace: stakeholders, weaknesses, criteria, deliverables, strategy and themes. */
export async function workspaceSections({ opportunityId, run, allowed }) {
  const id = Number(opportunityId);
  const sections = {};
  sections.stakeholders = await buildSection({
    key: "stakeholders", allowed,
    load: (limit) => run(
      `SELECT s.id, s.name, s.role_label, s.role_code, s.influence_level, s.support_level, s.status, s.priorities,
              s.concerns, s.next_action, CAST(s.last_contact_at AS CHAR) AS last_contact_at, CAST(s.updated_at AS CHAR) AS updated_at
       FROM opportunity_workspace_stakeholders s WHERE s.opportunity_id = ?
       ORDER BY s.updated_at DESC, s.id DESC LIMIT ?`, [id, limit]),
    map: (row) => withText(withText({
      evidenceId: `stk${row.id}`, source: { table: "opportunity_workspace_stakeholders", id: Number(row.id) },
      name: row.name, role: row.role_label || row.role_code || null, influenceLevel: row.influence_level || null,
      supportLevel: row.support_level || null, status: row.status || null, nextAction: row.next_action || null,
      lastContactAt: row.last_contact_at, updatedAt: row.updated_at,
      meanings: { stakeholder: EXTENDED_MEANINGS.stakeholder },
    }, "priorities", row.priorities || null, 800), "concerns", row.concerns || null, 800),
  });
  sections.weaknesses = await buildSection({
    key: "weaknesses", allowed,
    load: (limit) => run(
      `SELECT w.id, w.title, w.category, w.severity, w.status, w.detail, w.mitigation_plan,
              DATE_FORMAT(w.due_date, '%Y-%m-%d') AS due_date, w.resolved_note, u.full_name AS owner_name,
              CAST(w.updated_at AS CHAR) AS updated_at
       FROM opportunity_workspace_weaknesses w LEFT JOIN users u ON u.id = w.owner_user_id
       WHERE w.opportunity_id = ? ORDER BY w.updated_at DESC, w.id DESC LIMIT ?`, [id, limit]),
    map: (row) => withText(withText({
      evidenceId: `wk${row.id}`, source: { table: "opportunity_workspace_weaknesses", id: Number(row.id) },
      title: row.title, category: row.category || null, severity: row.severity || null, status: row.status || null,
      dueDate: row.due_date, ownerName: row.owner_name || null, resolvedNote: row.resolved_note || null,
      updatedAt: row.updated_at, meanings: { weakness: EXTENDED_MEANINGS.weakness },
    }, "detail", row.detail || null, 1200), "mitigationPlan", row.mitigation_plan || null, 1200),
  });
  sections.criterionAssessments = await buildSection({
    key: "criterionAssessments", allowed,
    load: (limit) => run(
      `SELECT c.id, c.criterion_code, oss.name AS stage_name, c.status, c.score, c.confidence, c.summary, c.evidence_count,
              CAST(c.updated_at AS CHAR) AS updated_at
       FROM opportunity_workspace_criterion_assessments c LEFT JOIN opportunity_sales_stages oss ON oss.id = c.sales_stage_id
       WHERE c.opportunity_id = ? ORDER BY c.updated_at DESC, c.id DESC LIMIT ?`, [id, limit]),
    map: (row) => withText({
      evidenceId: `crit${row.id}`, source: { table: "opportunity_workspace_criterion_assessments", id: Number(row.id) },
      criterionCode: row.criterion_code, stageName: row.stage_name || null, status: row.status || null,
      score: row.score ?? null, confidence: row.confidence || null, evidenceCount: Number(row.evidence_count || 0),
      updatedAt: row.updated_at, meanings: { assessment: EXTENDED_MEANINGS.criterionAssessment },
    }, "summary", row.summary || null, 1200),
  });
  sections.deliverables = await buildSection({
    key: "deliverables", allowed,
    load: (limit) => run(
      `SELECT d.id, d.deliverable_type, d.title, d.audience, d.status, d.version_label, CAST(d.sent_at AS CHAR) AS sent_at,
              d.outcome_summary, CAST(d.updated_at AS CHAR) AS updated_at
       FROM opportunity_workspace_deliverables d WHERE d.opportunity_id = ?
       ORDER BY d.updated_at DESC, d.id DESC LIMIT ?`, [id, limit]),
    map: (row) => withText({
      evidenceId: `dlv${row.id}`, source: { table: "opportunity_workspace_deliverables", id: Number(row.id) },
      deliverableType: row.deliverable_type || null, title: row.title, audience: row.audience || null,
      status: row.status || null, versionLabel: row.version_label || null, sentAt: row.sent_at,
      updatedAt: row.updated_at, meanings: { deliverable: EXTENDED_MEANINGS.deliverable },
    }, "outcomeSummary", row.outcome_summary || null, 1200),
  });
  sections.recommendedStrategy = await buildSection({
    key: "recommendedStrategy", allowed,
    load: (limit) => run(
      `SELECT s.id, s.heading, s.route, s.final_objective, s.steps_json, s.derived_from_stage_code,
              CAST(s.updated_at AS CHAR) AS updated_at
       FROM opportunity_workspace_recommended_strategy s WHERE s.opportunity_id = ?
       ORDER BY s.updated_at DESC, s.id DESC LIMIT ?`, [id, limit]),
    map: (row) => {
      const steps = parseJson(row.steps_json);
      const item = withText(withText({
        evidenceId: `strat${row.id}`, source: { table: "opportunity_workspace_recommended_strategy", id: Number(row.id) },
        derivedFromStage: row.derived_from_stage_code || null, updatedAt: row.updated_at,
        meanings: { strategy: EXTENDED_MEANINGS.recommendedStrategy },
      }, "heading", row.heading || null, 800), "finalObjective", row.final_objective || null, 1200);
      withText(item, "route", row.route || null, 1200);
      return withText(item, "steps", Array.isArray(steps) ? JSON.stringify(steps) : null, 3000);
    },
  });
  sections.themeEntries = await buildSection({
    key: "themeEntries", allowed,
    load: (limit) => run(
      `SELECT t.id, t.theme_code, t.claim, t.status, t.confidence, t.source_type, t.evidence_excerpt,
              CAST(t.updated_at AS CHAR) AS updated_at
       FROM opportunity_workspace_theme_entries t WHERE t.opportunity_id = ?
       ORDER BY t.updated_at DESC, t.id DESC LIMIT ?`, [id, limit]),
    map: (row) => withText(withText({
      evidenceId: `thm${row.id}`, source: { table: "opportunity_workspace_theme_entries", id: Number(row.id) },
      themeCode: row.theme_code, status: row.status || null, confidence: row.confidence || null,
      sourceType: row.source_type || null, updatedAt: row.updated_at,
      meanings: { theme: EXTENDED_MEANINGS.themeEntry },
    }, "claim", row.claim || null, 1200), "evidenceExcerpt", row.evidence_excerpt || null, 800),
  });
  return sections;
}

export async function manufacturerRegistrationsSection({ opportunityId, run, allowed }) {
  return buildSection({
    key: "manufacturerRegistrations", allowed,
    load: async (limit) => {
      const rows = await run(
        `SELECT r.id, p.name AS provider_name, r.status_code, r.requested_at, r.approved_at, r.expires_at,
                r.registration_folio, r.renewal_count, r.last_renewed_at, r.rejected_at, r.notes, r.rejection_notes
         FROM opportunity_manufacturer_registrations r LEFT JOIN providers p ON p.id = r.provider_id
         WHERE r.opportunity_id = ? ORDER BY r.requested_at DESC, r.id DESC LIMIT ?`, [Number(opportunityId), limit]);
      if (!rows.length) return rows;
      const renewals = await run(
        `SELECT n.id, n.registration_id, n.previous_folio, n.new_folio, n.previous_expires_at, n.new_expires_at, n.renewed_at
         FROM opportunity_manufacturer_registration_renewals n WHERE n.registration_id IN (?) ORDER BY n.renewed_at, n.id`,
        [rows.map((row) => row.id)]);
      return rows.map((row) => ({ ...row, renewals: renewals.filter((item) => Number(item.registration_id) === Number(row.id)) }));
    },
    map: (row) => withText(withText({
      evidenceId: `reg${row.id}`, source: { table: "opportunity_manufacturer_registrations", id: Number(row.id) },
      providerName: row.provider_name || null, status: row.status_code || null, requestedAt: registrationDay(row.requested_at),
      approvedAt: registrationDay(row.approved_at), expiresAt: registrationDay(row.expires_at), folio: row.registration_folio || null,
      renewalCount: Number(row.renewal_count || 0), lastRenewedAt: registrationDay(row.last_renewed_at),
      rejectedAt: registrationDay(row.rejected_at),
      renewals: (row.renewals || []).map((item) => ({
        evidenceId: `regr${item.id}`, source: { table: "opportunity_manufacturer_registration_renewals", id: Number(item.id) },
        previousFolio: item.previous_folio || null, newFolio: item.new_folio || null,
        previousExpiresAt: registrationDay(item.previous_expires_at), newExpiresAt: registrationDay(item.new_expires_at),
        renewedAt: registrationDay(item.renewed_at),
      })),
      meanings: { registration: EXTENDED_MEANINGS.manufacturerRegistration, expiresAt: EXTENDED_MEANINGS.registrationExpiry },
    }, "notes", row.notes || null, 1200), "rejectionNotes", row.rejection_notes || null, 800),
  });
}

export async function proposalSections({ opportunityId, run, allowed }) {
  const id = Number(opportunityId);
  return {
    proposals: await buildSection({
      key: "proposals", allowed,
      load: (limit) => run(
        `SELECT p.id, p.title, p.status_code, p.quotation_id, p.quotation_version_id, u.full_name AS owner_name,
                (SELECT COUNT(*) FROM proposal_revisions r WHERE r.proposal_id = p.id) AS revision_count,
                CAST(p.created_at AS CHAR) AS created_at, CAST(p.updated_at AS CHAR) AS updated_at,
                CAST(p.archived_at AS CHAR) AS archived_at
         FROM proposals p LEFT JOIN users u ON u.id = p.owner_user_id
         WHERE p.opportunity_id = ? ORDER BY p.updated_at DESC, p.id DESC LIMIT ?`, [id, limit]),
      map: (row) => ({
        evidenceId: `prop${row.id}`, source: { table: "proposals", id: Number(row.id) },
        title: row.title, status: row.status_code || null, quotationId: Number(row.quotation_id || 0) || null,
        quotationVersionId: Number(row.quotation_version_id || 0) || null, ownerName: row.owner_name || null,
        revisionCount: Number(row.revision_count || 0), createdAt: row.created_at, updatedAt: row.updated_at,
        archivedAt: row.archived_at, meanings: { proposal: EXTENDED_MEANINGS.proposal },
      }),
    }),
    proposalDocuments: await buildSection({
      key: "proposalDocuments", allowed,
      load: (limit) => run(
        `SELECT d.id, d.title, d.status, d.quotation_id, CAST(d.created_at AS CHAR) AS created_at, CAST(d.updated_at AS CHAR) AS updated_at
         FROM proposal_documents d WHERE d.opportunity_id = ? ORDER BY d.updated_at DESC, d.id DESC LIMIT ?`, [id, limit]),
      map: (row) => ({
        evidenceId: `pdoc${row.id}`, source: { table: "proposal_documents", id: Number(row.id) },
        title: row.title, status: row.status || null, quotationId: Number(row.quotation_id || 0) || null,
        createdAt: row.created_at, updatedAt: row.updated_at, meanings: { proposalDocument: EXTENDED_MEANINGS.proposalDocument },
      }),
    }),
  };
}

/** Account-level interactions, leads, campaign status and calendar activities without an opportunity. */
export async function accountActivitySections({ user, account, run, permissions }) {
  const sections = {};
  const ownerScope = (alias, creatorColumn) => canReadAll(user, "interacciones") ? { sql: "", params: [] } : {
    sql: `AND (${alias}.${creatorColumn} = ? OR EXISTS (SELECT 1 FROM account_owners ao WHERE ao.account_id = ? AND ao.user_id = ?))`,
    params: [Number(user.id), account.id, Number(user.id)],
  };
  const accountInteractionScope = ownerScope("ai", "created_by");
  sections.accountInteractions = await buildSection({
    key: "accountInteractions", allowed: permissions.accountInteractions,
    load: (limit) => run(
      `SELECT ai.id, ait.name AS interaction_type, air.name AS result_name, ai.title, ai.summary, ai.next_step,
              CAST(ai.occurred_at AS CHAR) AS occurred_at, CAST(ai.follow_up_at AS CHAR) AS follow_up_at,
              ai.linked_opportunity_id,
              (SELECT GROUP_CONCAT(CONCAT_WS(' ', c.first_name, c.last_name) SEPARATOR ', ')
                 FROM account_interaction_contacts aic INNER JOIN contacts c ON c.id = aic.contact_id
                 WHERE aic.interaction_id = ai.id) AS contact_names
       FROM account_interactions ai
       LEFT JOIN account_interaction_types ait ON ait.id = ai.interaction_type_id
       LEFT JOIN account_interaction_results air ON air.id = ai.result_id
       WHERE ai.account_id = ? ${accountInteractionScope.sql}
       ORDER BY ai.occurred_at DESC, ai.id DESC LIMIT ?`,
      [account.id, ...accountInteractionScope.params, limit]),
    map: (row) => withText(withText({
      evidenceId: `aint${row.id}`, source: { table: "account_interactions", id: Number(row.id) },
      interactionType: row.interaction_type || null, result: row.result_name || null, title: row.title || null,
      occurredAt: row.occurred_at, followUpAt: row.follow_up_at, contactNames: row.contact_names || null,
      opportunityId: Number(row.linked_opportunity_id || 0) || null,
      meanings: { interaction: EXTENDED_MEANINGS.accountInteraction },
    }, "summary", row.summary || null, 1500), "nextStep", row.next_step || null, 600),
  });
  const leadScope = canReadAll(user, "interacciones") ? { sql: "", params: [] } : {
    sql: "AND (i.seller_user_id = ? OR i.created_by = ? OR EXISTS (SELECT 1 FROM account_owners ao WHERE ao.account_id = ? AND ao.user_id = ?))",
    params: [Number(user.id), Number(user.id), account.id, Number(user.id)],
  };
  sections.leads = await buildSection({
    key: "leads", allowed: permissions.leads,
    load: (limit) => run(
      `SELECT i.id, i.title, i.lead_source, i.summary, i.analysis_status, i.processing_status, i.lead_substatus_code,
              i.lead_required_action_code, i.lead_commercial_comment, CAST(i.lead_next_action_due_at AS CHAR) AS next_action_due_at,
              i.disqualification_reason, u.full_name AS seller_name, CAST(i.created_at AS CHAR) AS created_at,
              CAST(i.updated_at AS CHAR) AS updated_at
       FROM interactions i LEFT JOIN users u ON u.id = i.seller_user_id
       WHERE i.account_id = ? AND i.primary_opportunity_id IS NULL ${leadScope.sql}
       ORDER BY COALESCE(i.updated_at, i.created_at) DESC, i.id DESC LIMIT ?`,
      [account.id, ...leadScope.params, limit]),
    map: (row) => withText(withText({
      evidenceId: `int${row.id}`, source: { table: "interactions", id: Number(row.id) },
      title: row.title || null, leadSource: row.lead_source || null, analysisStatus: row.analysis_status || null,
      processingStatus: row.processing_status || null, leadSubstatus: row.lead_substatus_code || null,
      requiredAction: row.lead_required_action_code || null, nextActionDueAt: row.next_action_due_at,
      disqualificationReason: row.disqualification_reason || null, sellerName: row.seller_name || null,
      createdAt: row.created_at, updatedAt: row.updated_at,
      meanings: { lead: EXTENDED_MEANINGS.lead, analysisStatus: EXTENDED_MEANINGS.leadAnalysisStatus },
    }, "summary", row.summary || null, 1500), "commercialComment", row.lead_commercial_comment || null, 800),
  });
  sections.campaignInteractions = await buildSection({
    key: "campaignInteractions", allowed: permissions.campaignInteractions,
    load: (limit) => run(
      `SELECT ci.id, c.name AS campaign_name, ci.etapa_ciclo_vida, ci.estado_interaccion, ci.notes,
              CAST(ci.last_interaction_at AS CHAR) AS last_interaction_at, CAST(ci.updated_at AS CHAR) AS updated_at
       FROM campaign_account_interactions ci INNER JOIN campaigns c ON c.id = ci.campaign_id
       WHERE ci.account_id = ? ORDER BY COALESCE(ci.last_interaction_at, ci.updated_at) DESC, ci.id DESC LIMIT ?`,
      [account.id, limit]),
    map: (row) => withText({
      evidenceId: `camp${row.id}`, source: { table: "campaign_account_interactions", id: Number(row.id) },
      campaignName: row.campaign_name, lifecycleStage: row.etapa_ciclo_vida || null,
      interactionStatus: row.estado_interaccion || null, lastInteractionAt: row.last_interaction_at, updatedAt: row.updated_at,
      meanings: { campaign: EXTENDED_MEANINGS.campaignInteraction },
    }, "notes", row.notes || null, 800),
  });
  const calendarScope = canReadAll(user, "calendario_comercial") ? { sql: "", params: [] } : {
    sql: "AND (cca.seller_user_id = ? OR cca.created_by = ?)", params: [Number(user.id), Number(user.id)],
  };
  sections.accountCalendar = await buildSection({
    key: "accountCalendar", allowed: permissions.accountCalendar,
    load: (limit) => run(
      `SELECT cca.id, cca.kind, cca.activity_type, cca.status, CAST(cca.scheduled_at AS CHAR) AS scheduled_at,
              DATE_FORMAT(cca.due_date, '%Y-%m-%d') AS due_date, cca.objective, cca.note, cca.success_criteria,
              CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name, u.full_name AS seller_name
       FROM commercial_calendar_activities cca
       LEFT JOIN contacts c ON c.id = cca.contact_id
       LEFT JOIN users u ON u.id = cca.seller_user_id
       WHERE cca.account_id = ? AND cca.opportunity_id IS NULL ${calendarScope.sql}
       ORDER BY COALESCE(cca.due_date, DATE(cca.scheduled_at)) DESC, cca.id DESC LIMIT ?`,
      [account.id, ...calendarScope.params, limit]),
    map: (row) => withText({
      evidenceId: `cal${row.id}`, source: { table: "commercial_calendar_activities", id: Number(row.id) },
      kind: row.kind || null, activityType: row.activity_type || null, status: row.status || null,
      scheduledAt: row.scheduled_at, dueDate: row.due_date, objective: row.objective || null,
      successCriteria: row.success_criteria || null, contactName: row.contact_name || null, sellerName: row.seller_name || null,
      meanings: { dueDate: EXTENDED_MEANINGS.calendarDate },
    }, "note", row.note || null, 1500),
  });
  return sections;
}
