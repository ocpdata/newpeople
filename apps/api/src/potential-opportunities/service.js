import { randomUUID } from "node:crypto";
import { query, withTransaction } from "../db.js";

const OPEN_CASE_STATES = ["new", "in_review", "accepted", "postponed"];
const TERMINAL_CASE_STATES = ["converted", "dismissed", "expired"];

const POTENTIAL_OPPORTUNITY_SORTS = {
  title: {
    asc: "poc.title ASC, poc.id ASC",
    desc: "poc.title DESC, poc.id DESC",
  },
  created_at: {
    asc: "poc.created_at ASC, poc.id ASC",
    desc: "poc.created_at DESC, poc.id DESC",
  },
  priority: {
    asc: "FIELD(poc.priority_level, 'observe', 'low', 'medium', 'high', 'critical') ASC, poc.total_score ASC, poc.id ASC",
    desc: "FIELD(poc.priority_level, 'critical', 'high', 'medium', 'low', 'observe') ASC, poc.total_score DESC, poc.id DESC",
  },
  account: {
    asc: "a.name ASC, poc.id ASC",
    desc: "a.name DESC, poc.id DESC",
  },
  owner: {
    asc: "(u.full_name IS NULL) ASC, u.full_name ASC, poc.id ASC",
    desc: "(u.full_name IS NULL) ASC, u.full_name DESC, poc.id DESC",
  },
  recommended_action: {
    asc: "poc.recommended_action ASC, poc.id ASC",
    desc: "poc.recommended_action DESC, poc.id DESC",
  },
};

function resolvePotentialOpportunitySort(filters) {
  const sortBy = String(filters.sortBy || "priority")
    .trim()
    .toLowerCase();
  const sortDirection =
    String(filters.sortDirection || "desc")
      .trim()
      .toLowerCase() === "asc"
      ? "asc"
      : "desc";
  const sortConfig =
    POTENTIAL_OPPORTUNITY_SORTS[sortBy] || POTENTIAL_OPPORTUNITY_SORTS.priority;

  return {
    sortBy: POTENTIAL_OPPORTUNITY_SORTS[sortBy] ? sortBy : "priority",
    sortDirection,
    orderBy: sortConfig[sortDirection],
  };
}

function parseJsonField(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueStrings(items) {
  return Array.from(
    new Set(
      (Array.isArray(items) ? items : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  );
}

async function loadAccountOwnersMap(accountIds, connOrQuery = query) {
  const normalizedIds = Array.from(
    new Set((Array.isArray(accountIds) ? accountIds : []).map(Number)),
  ).filter((value) => Number.isInteger(value) && value > 0);

  if (!normalizedIds.length) {
    return new Map();
  }

  const rows = await connOrQuery(
    `SELECT ao.account_id, u.id AS user_id, u.full_name
     FROM account_owners ao
     INNER JOIN users u ON u.id = ao.user_id
     WHERE ao.account_id IN (${normalizedIds.map(() => "?").join(", ")})
     ORDER BY ao.account_id ASC, u.full_name ASC, u.id ASC`,
    normalizedIds,
  );

  return rows.reduce((map, row) => {
    const accountId = Number(row.account_id);
    if (!map.has(accountId)) {
      map.set(accountId, []);
    }
    map.get(accountId).push({
      id: Number(row.user_id),
      fullName: row.full_name,
    });
    return map;
  }, new Map());
}

function confidenceToScore(value) {
  switch (String(value || "").toLowerCase()) {
    case "high":
      return 85;
    case "medium":
      return 60;
    case "low":
      return 35;
    default:
      return 20;
  }
}

function buildPublicId(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function detectKeywordScore(text, dictionary) {
  const normalized = normalizeText(text);
  let score = 0;
  for (const item of dictionary) {
    if (normalized.includes(item.term)) {
      score += item.score;
    }
  }
  return score;
}

function deriveCaseType(text) {
  if (/(renovacion|reactiv|retom|reabr)/.test(text)) return "reactivacion";
  if (
    /(expansion|upsell|cross sell|crosssell|adicional|nueva area)/.test(text)
  ) {
    return "expansion";
  }
  if (/(sin respuesta|enfri|ghost|sin seguimiento|riesgo)/.test(text)) {
    return "riesgo_fuga";
  }
  if (/(demo|propuesta|cotizacion|proyecto|piloto|alcance)/.test(text)) {
    return "promovible";
  }
  return "nueva";
}

function mapCaseTypeToSignalType(caseType) {
  switch (caseType) {
    case "reactivacion":
      return "reactivacion";
    case "expansion":
      return "expansion";
    case "riesgo_fuga":
      return "riesgo_fuga";
    case "promovible":
      return "interaccion_promovible";
    default:
      return "nueva_oportunidad";
  }
}

function buildTopicKey({ suggestedOpportunities, title, summary }) {
  const firstSuggestion = Array.isArray(suggestedOpportunities)
    ? suggestedOpportunities[0]?.name
    : "";
  return normalizeText(firstSuggestion || title || summary).slice(0, 180);
}

function resolveRecommendedAction(caseType, totalScore, nextSteps) {
  if (caseType === "riesgo_fuga") return "llamar_contacto";
  if (totalScore >= 75) return "crear_oportunidad";
  if (Array.isArray(nextSteps) && nextSteps.length) return "agendar_reunion";
  if (caseType === "reactivacion") return "llamar_contacto";
  return "validar_necesidad";
}

function resolvePriorityLevel(totalScore, ruleset) {
  if (totalScore >= Number(ruleset.priority_critical_threshold)) {
    return "critical";
  }
  if (totalScore >= Number(ruleset.priority_high_threshold)) {
    return "high";
  }
  if (totalScore >= Number(ruleset.priority_medium_threshold)) {
    return "medium";
  }
  if (totalScore >= Number(ruleset.priority_low_threshold)) {
    return "low";
  }
  return "observe";
}

function buildFactorLists(scores, context) {
  const positive = [];
  const negative = [];

  if (scores.signalStrengthScore >= 70)
    positive.push("Necesidad o tema comercial claro");
  if (scores.engagementScore >= 65)
    positive.push("Actividad reciente con seguimiento");
  if (scores.momentumScore >= 65) positive.push("Siguiente paso identificable");
  if (scores.fitScore >= 65) positive.push("Cuenta con buen fit comercial");
  if (scores.coverageScore < 50)
    negative.push("Cobertura comercial incompleta");
  if (scores.urgencyScore < 45) negative.push("Urgencia aun poco definida");
  if (!context.hasSuggestedOpportunity) {
    negative.push("Aun no hay propuesta de oportunidad claramente nombrada");
  }
  if (!context.hasLinkedContacts) {
    negative.push("Faltan contactos vinculados a la senal");
  }

  return {
    positive: positive.slice(0, 3),
    negative: negative.slice(0, 3),
  };
}

function buildSignalFromInteraction(interaction, ruleset) {
  const suggestedAccount = parseJsonField(
    interaction.suggested_account_json,
    null,
  );
  const suggestedContacts = parseJsonField(
    interaction.suggested_contacts_json,
    [],
  );
  const suggestedOpportunities = parseJsonField(
    interaction.suggested_opportunities_json,
    [],
  );
  const topics = uniqueStrings(parseJsonField(interaction.topics_json, []));
  const actionsTaken = uniqueStrings(
    parseJsonField(interaction.actions_taken_json, []),
  );
  const nextSteps = uniqueStrings(
    parseJsonField(interaction.next_steps_json, []),
  );
  const summary = String(interaction.summary || "");
  const sourceNotes = String(interaction.source_notes || "");
  const title = String(interaction.title || "Interaccion sin titulo");
  const combinedText = normalizeText(
    [
      title,
      summary,
      sourceNotes,
      topics.join(" "),
      actionsTaken.join(" "),
      nextSteps.join(" "),
    ].join(" "),
  );

  const keywordSignal = detectKeywordScore(combinedText, [
    { term: "propuesta", score: 18 },
    { term: "cotizacion", score: 18 },
    { term: "demo", score: 15 },
    { term: "piloto", score: 14 },
    { term: "proyecto", score: 16 },
    { term: "renovacion", score: 14 },
    { term: "necesidad", score: 12 },
    { term: "alcance", score: 10 },
    { term: "requerimiento", score: 10 },
  ]);
  const urgencyKeywords = detectKeywordScore(combinedText, [
    { term: "urgente", score: 25 },
    { term: "licitacion", score: 25 },
    { term: "renovacion", score: 20 },
    { term: "fecha", score: 10 },
    { term: "trimestre", score: 10 },
    { term: "presupuesto", score: 15 },
  ]);

  const topSuggestedOpportunity = Array.isArray(suggestedOpportunities)
    ? suggestedOpportunities[0] || null
    : null;
  const opportunityConfidence = confidenceToScore(
    topSuggestedOpportunity?.confidence,
  );
  const accountConfidence = confidenceToScore(suggestedAccount?.confidence);
  const contactConfidence = Math.max(
    0,
    ...suggestedContacts.map((contact) =>
      confidenceToScore(contact?.confidence),
    ),
  );

  const hasSuggestedOpportunity = Boolean(
    topSuggestedOpportunity?.name || suggestedOpportunities.length,
  );
  const hasLinkedContacts = Boolean(
    Number(interaction.primary_contact_id) || suggestedContacts.length,
  );

  if (
    !hasSuggestedOpportunity &&
    keywordSignal < Number(ruleset.min_signal_score)
  ) {
    return null;
  }

  const fitScore = Math.min(
    100,
    (interaction.account_id ? 55 : 0) +
      Math.round(accountConfidence * 0.35) +
      (hasLinkedContacts ? 10 : 0) +
      15,
  );
  const signalStrengthScore = Math.min(
    100,
    Math.max(opportunityConfidence, keywordSignal) +
      Math.min(12, suggestedOpportunities.length * 6) +
      (summary.length > 120 ? 8 : 0),
  );
  const urgencyScore = Math.min(
    100,
    urgencyKeywords +
      (nextSteps.length ? 20 : 5) +
      (combinedText.includes("seguimiento") ? 10 : 0),
  );
  const engagementScore = Math.min(
    100,
    25 +
      Math.min(20, topics.length * 8) +
      Math.min(20, actionsTaken.length * 6) +
      Math.min(20, nextSteps.length * 8) +
      (hasLinkedContacts ? 10 : 0),
  );
  const coverageScore = Math.min(
    100,
    (interaction.account_id ? 35 : 0) +
      (Number(interaction.account_owner_count) ? 25 : 0) +
      (hasLinkedContacts ? 20 : 0) +
      Math.round(contactConfidence * 0.2),
  );
  const momentumScore = Math.min(
    100,
    (nextSteps.length ? 35 : 5) +
      (hasSuggestedOpportunity ? 25 : 0) +
      (combinedText.includes("reunion") ? 15 : 0) +
      (combinedText.includes("demo") ? 10 : 0),
  );
  const daysSinceEvidence = Math.max(
    0,
    Math.floor(
      (Date.now() - new Date(interaction.created_at).getTime()) /
        (1000 * 60 * 60 * 24),
    ),
  );
  const staleDays = Math.max(
    0,
    daysSinceEvidence - Number(ruleset.stale_penalty_start_days),
  );
  const stalenessPenalty = Math.min(
    Number(ruleset.stale_penalty_cap),
    staleDays * Number(ruleset.stale_penalty_per_day),
  );
  const duplicatePenalty = 0;

  const rawTotal =
    Number(ruleset.fit_weight) * fitScore +
    Number(ruleset.signal_strength_weight) * signalStrengthScore +
    Number(ruleset.urgency_weight) * urgencyScore +
    Number(ruleset.engagement_weight) * engagementScore +
    Number(ruleset.coverage_weight) * coverageScore +
    Number(ruleset.momentum_weight) * momentumScore -
    stalenessPenalty -
    duplicatePenalty;

  const totalScore = Math.max(
    0,
    Math.min(100, Math.round(rawTotal * 100) / 100),
  );
  if (totalScore < Number(ruleset.min_signal_score)) {
    return null;
  }

  const caseType = deriveCaseType(combinedText);
  const recommendedAction = resolveRecommendedAction(
    caseType,
    totalScore,
    nextSteps,
  );
  const factors = buildFactorLists(
    {
      fitScore,
      signalStrengthScore,
      urgencyScore,
      engagementScore,
      coverageScore,
      momentumScore,
    },
    { hasSuggestedOpportunity, hasLinkedContacts },
  );
  const suggestedTitle =
    String(topSuggestedOpportunity?.name || "").trim() ||
    title ||
    "Oportunidad potencial detectada";
  const topicKey = buildTopicKey({
    suggestedOpportunities,
    title: suggestedTitle,
    summary,
  });
  const dueDate = new Date(interaction.created_at || Date.now());
  dueDate.setDate(dueDate.getDate() + (totalScore >= 75 ? 2 : 5));

  return {
    signalType: mapCaseTypeToSignalType(caseType),
    signalSubtype:
      topSuggestedOpportunity?.matchStatus || "interaction_analysis",
    caseType,
    title: suggestedTitle,
    topicKey,
    description:
      topSuggestedOpportunity?.summary ||
      summary ||
      sourceNotes ||
      "La interaccion sugiere una oportunidad potencial que conviene revisar.",
    evidenceSummary:
      nextSteps[0] || actionsTaken[0] || topics[0] || summary.slice(0, 280),
    commercialHypothesis:
      topSuggestedOpportunity?.summary ||
      `La interaccion ${title} muestra indicios suficientes para abrir trabajo comercial estructurado.`,
    businessNeedSummary:
      summary || sourceNotes || topSuggestedOpportunity?.reason || "",
    nextStepSuggestion:
      nextSteps[0] ||
      topSuggestedOpportunity?.reason ||
      "Validar necesidad y definir siguiente paso comercial.",
    recommendedAction,
    recommendedActionDueDate: dueDate.toISOString().slice(0, 10),
    fitScore,
    signalStrengthScore,
    urgencyScore,
    engagementScore,
    coverageScore,
    momentumScore,
    stalenessPenalty,
    duplicatePenalty,
    totalScore,
    confidenceScore: Math.max(
      opportunityConfidence,
      accountConfidence,
      contactConfidence,
    ),
    priorityLevel: resolvePriorityLevel(totalScore, ruleset),
    topPositiveFactors: factors.positive,
    topNegativeFactors: factors.negative,
    relatedOpportunityId: Number(interaction.primary_opportunity_id) || null,
    primaryContactId: Number(interaction.primary_contact_id) || null,
    ownerUserId: null,
    detectedAt: interaction.analyzed_at || interaction.created_at,
  };
}

async function getActiveRuleset(connOrQuery = query) {
  const rows = await connOrQuery(
    `SELECT *
     FROM commercial_signal_rulesets
     WHERE is_active = 1
     ORDER BY id DESC
     LIMIT 1`,
  );
  return rows[0] || null;
}

function buildAccessScope({ user, caseAlias = "poc", params }) {
  if (user?.permissionSet?.has("oportunidades_potenciales.read_all")) {
    return "";
  }
  params.push(Number(user.id));
  return `INNER JOIN account_owners ao_scope ON ao_scope.account_id = ${caseAlias}.account_id AND ao_scope.user_id = ?`;
}

async function loadActiveUsersByIds(connOrQuery, userIds) {
  const normalizedIds = Array.from(
    new Set((Array.isArray(userIds) ? userIds : []).map(Number)),
  ).filter((value) => Number.isInteger(value) && value > 0);

  if (!normalizedIds.length) {
    return [];
  }

  return await connOrQuery(
    `SELECT u.id, u.full_name, u.email,
            GROUP_CONCAT(DISTINCT r.name ORDER BY r.name SEPARATOR ', ') AS roles
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     WHERE u.status = 'active'
       AND u.id IN (${normalizedIds.map(() => "?").join(", ")})
     GROUP BY u.id, u.full_name, u.email
     ORDER BY u.full_name ASC, u.id ASC`,
    normalizedIds,
  );
}

async function loadAllActiveUsers(connOrQuery = query) {
  return await connOrQuery(
    `SELECT u.id, u.full_name, u.email,
            GROUP_CONCAT(DISTINCT r.name ORDER BY r.name SEPARATOR ', ') AS roles
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     WHERE u.status = 'active'
     GROUP BY u.id, u.full_name, u.email
     ORDER BY u.full_name ASC, u.id ASC`,
  );
}

async function loadAccessibleCaseRecord(conn, { user, caseId }) {
  const params = [];
  const joins = buildAccessScope({ user, caseAlias: "poc", params });
  params.push(caseId, caseId);
  const [rows] = await conn.query(
    `SELECT poc.id, poc.public_id, poc.account_id, poc.state, poc.owner_user_id
     FROM potential_opportunity_cases poc
     ${joins}
     WHERE poc.id = ? OR poc.public_id = ?
     LIMIT 1`,
    params,
  );
  return rows[0] || null;
}

async function resolveAllowedAssignmentUsers(conn, { accountId }) {
  const accountOwnersByAccountId = await loadAccountOwnersMap(
    [accountId],
    (sql, sqlParams) => conn.query(sql, sqlParams).then(([rows]) => rows),
  );
  const accountOwners = accountOwnersByAccountId.get(Number(accountId)) || [];

  if (accountOwners.length) {
    const ownerRows = await loadActiveUsersByIds(
      (sql, sqlParams) => conn.query(sql, sqlParams).then(([rows]) => rows),
      accountOwners.map((item) => Number(item.id)),
    );
    return {
      selectionMode: "account_owners",
      items: ownerRows.map((row) => ({
        id: Number(row.id),
        fullName: row.full_name,
        email: row.email,
        roles: row.roles || "",
      })),
    };
  }

  const fallbackRows = await loadAllActiveUsers((sql, sqlParams) =>
    conn.query(sql, sqlParams).then(([rows]) => rows),
  );
  return {
    selectionMode: "fallback_all_active_users",
    items: fallbackRows.map((row) => ({
      id: Number(row.id),
      fullName: row.full_name,
      email: row.email,
      roles: row.roles || "",
    })),
  };
}

export async function getPotentialOpportunityAssignmentOptions({
  user,
  caseId,
}) {
  return withTransaction(async (conn) => {
    const current = await loadAccessibleCaseRecord(conn, { user, caseId });
    if (!current) {
      return null;
    }

    if (current.state !== "accepted") {
      return {
        caseId: Number(current.id),
        currentState: current.state,
        assignmentAllowed: false,
        selectionMode: "disabled_until_accepted",
        items: [],
      };
    }

    const resolved = await resolveAllowedAssignmentUsers(conn, {
      accountId: Number(current.account_id),
    });

    return {
      caseId: Number(current.id),
      currentState: current.state,
      assignmentAllowed: true,
      selectionMode: resolved.selectionMode,
      items: resolved.items,
    };
  });
}

async function loadSignalsForCase(conn, caseId) {
  const [rows] = await conn.query(
    `SELECT *
     FROM commercial_signals
     WHERE case_id = ?
     ORDER BY detected_at DESC, id DESC`,
    [Number(caseId)],
  );
  return rows;
}

async function recomputeCaseAggregate(conn, caseId, userId) {
  const signals = await loadSignalsForCase(conn, caseId);
  if (!signals.length) {
    return;
  }

  const firstSignal = signals[0];
  const aggregate = signals.reduce(
    (accumulator, signal) => ({
      fitScore: Math.max(accumulator.fitScore, Number(signal.fit_score || 0)),
      signalStrengthScore: Math.max(
        accumulator.signalStrengthScore,
        Number(signal.signal_strength_score || 0),
      ),
      urgencyScore: Math.max(
        accumulator.urgencyScore,
        Number(signal.urgency_score || 0),
      ),
      engagementScore: Math.max(
        accumulator.engagementScore,
        Number(signal.engagement_score || 0),
      ),
      coverageScore: Math.max(
        accumulator.coverageScore,
        Number(signal.coverage_score || 0),
      ),
      momentumScore: Math.max(
        accumulator.momentumScore,
        Number(signal.momentum_score || 0),
      ),
      stalenessPenalty: Math.max(
        accumulator.stalenessPenalty,
        Number(signal.staleness_penalty || 0),
      ),
      duplicatePenalty: Math.max(
        accumulator.duplicatePenalty,
        Number(signal.duplicate_penalty || 0),
      ),
      totalScore: Math.max(
        accumulator.totalScore,
        Number(signal.total_score || 0),
      ),
      detectedAt:
        new Date(signal.detected_at).getTime() >
        new Date(accumulator.detectedAt).getTime()
          ? signal.detected_at
          : accumulator.detectedAt,
    }),
    {
      fitScore: 0,
      signalStrengthScore: 0,
      urgencyScore: 0,
      engagementScore: 0,
      coverageScore: 0,
      momentumScore: 0,
      stalenessPenalty: 0,
      duplicatePenalty: 0,
      totalScore: 0,
      detectedAt: firstSignal.detected_at,
    },
  );

  const positive = parseJsonField(firstSignal.top_positive_factors_json, []);
  const negative = parseJsonField(firstSignal.top_negative_factors_json, []);
  const reviewSla = new Date(aggregate.detectedAt);
  reviewSla.setDate(reviewSla.getDate() + 5);

  await conn.query(
    `UPDATE potential_opportunity_cases
     SET fit_score = ?,
         signal_strength_score = ?,
         urgency_score = ?,
         engagement_score = ?,
         coverage_score = ?,
         momentum_score = ?,
         staleness_penalty = ?,
         duplicate_penalty = ?,
         total_score = ?,
         priority_level = ?,
         top_positive_factors_json = ?,
         top_negative_factors_json = ?,
         signal_count = ?,
         last_detected_at = ?,
         latest_evidence_at = ?,
         review_sla_at = ?,
         updated_by = ?,
         updated_at = NOW(3)
     WHERE id = ?`,
    [
      aggregate.fitScore,
      aggregate.signalStrengthScore,
      aggregate.urgencyScore,
      aggregate.engagementScore,
      aggregate.coverageScore,
      aggregate.momentumScore,
      aggregate.stalenessPenalty,
      aggregate.duplicatePenalty,
      aggregate.totalScore,
      aggregate.totalScore >= 85
        ? "critical"
        : aggregate.totalScore >= 70
          ? "high"
          : aggregate.totalScore >= 55
            ? "medium"
            : aggregate.totalScore >= 40
              ? "low"
              : "observe",
      JSON.stringify(positive),
      JSON.stringify(negative),
      signals.length,
      aggregate.detectedAt,
      aggregate.detectedAt,
      reviewSla.toISOString().slice(0, 19).replace("T", " "),
      Number(userId),
      Number(caseId),
    ],
  );
}

async function clearImplicitCaseAssignment(conn, caseId, userId) {
  await conn.query(
    `UPDATE potential_opportunity_cases
     SET owner_user_id = NULL,
         updated_by = ?,
         updated_at = NOW(3)
     WHERE id = ?
       AND assigned_by_user_id IS NULL`,
    [Number(userId), Number(caseId)],
  );
}

async function findExistingOpenCase(conn, { accountId, caseType, topicKey }) {
  const [rows] = await conn.query(
    `SELECT *
     FROM potential_opportunity_cases
     WHERE account_id = ?
       AND case_type = ?
       AND topic_key = ?
       AND state IN (${OPEN_CASE_STATES.map(() => "?").join(", ")})
     ORDER BY id DESC
     LIMIT 1`,
    [Number(accountId), caseType, topicKey, ...OPEN_CASE_STATES],
  );
  return rows[0] || null;
}

async function insertCaseTransition(
  conn,
  { caseId, fromState, toState, reasonCode, reasonNote, userId },
) {
  await conn.query(
    `INSERT INTO potential_opportunity_case_transitions
       (case_id, from_state, to_state, reason_code, reason_note, changed_by_user_id, changed_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW(3))`,
    [
      Number(caseId),
      fromState || null,
      toState,
      reasonCode || null,
      reasonNote || null,
      userId || null,
    ],
  );
}

async function createOrUpdateCaseForSignal(
  conn,
  { signalId, interaction, payload, rulesetId, userId, forceRebuild },
) {
  const [existingSignalRows] = await conn.query(
    `SELECT * FROM commercial_signals WHERE interaction_id = ? LIMIT 1`,
    [Number(interaction.id)],
  );
  const existingSignal = existingSignalRows[0] || null;

  let caseId = existingSignal?.case_id ? Number(existingSignal.case_id) : null;
  if (!caseId) {
    const existingCase = await findExistingOpenCase(conn, {
      accountId: interaction.account_id,
      caseType: payload.caseType,
      topicKey: payload.topicKey,
    });
    caseId = existingCase ? Number(existingCase.id) : null;
  }

  if (!caseId) {
    const [result] = await conn.query(
      `INSERT INTO potential_opportunity_cases
        (public_id, case_type, title, topic_key, account_id, primary_contact_id,
         related_opportunity_id,
          owner_user_id, source_kind, source_entity_id, commercial_hypothesis,
          business_need_summary, next_step_suggestion, recommended_action,
          recommended_action_due_date, fit_score, signal_strength_score,
          urgency_score, engagement_score, coverage_score, momentum_score,
          staleness_penalty, duplicate_penalty, total_score, priority_level,
          top_positive_factors_json, top_negative_factors_json, signal_count,
          first_detected_at, last_detected_at, latest_evidence_at, review_sla_at,
          created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'interaction', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
      [
        buildPublicId("poc"),
        payload.caseType,
        payload.title,
        payload.topicKey,
        Number(interaction.account_id),
        payload.primaryContactId,
        payload.relatedOpportunityId,
        payload.ownerUserId,
        Number(interaction.id),
        payload.commercialHypothesis,
        payload.businessNeedSummary,
        payload.nextStepSuggestion,
        payload.recommendedAction,
        payload.recommendedActionDueDate,
        payload.fitScore,
        payload.signalStrengthScore,
        payload.urgencyScore,
        payload.engagementScore,
        payload.coverageScore,
        payload.momentumScore,
        payload.stalenessPenalty,
        payload.duplicatePenalty,
        payload.totalScore,
        payload.priorityLevel,
        JSON.stringify(payload.topPositiveFactors),
        JSON.stringify(payload.topNegativeFactors),
        payload.detectedAt,
        payload.detectedAt,
        payload.detectedAt,
        new Date(
          new Date(payload.detectedAt).getTime() + 5 * 24 * 60 * 60 * 1000,
        )
          .toISOString()
          .slice(0, 19)
          .replace("T", " "),
        Number(userId),
        Number(userId),
      ],
    );
    caseId = Number(result.insertId);
    await insertCaseTransition(conn, {
      caseId,
      fromState: null,
      toState: "new",
      reasonCode: "auto_created",
      reasonNote: "Caso creado automaticamente desde deteccion de interaccion",
      userId: Number(userId),
    });
  }

  await clearImplicitCaseAssignment(conn, caseId, userId);

  if (existingSignal) {
    if (!forceRebuild) {
      return {
        caseId,
        signalId: Number(existingSignal.id),
        action: "existing",
      };
    }
    await conn.query(
      `UPDATE commercial_signals
       SET case_id = ?,
           ruleset_id = ?,
           signal_type = ?,
           signal_subtype = ?,
           account_id = ?,
           contact_id = ?,
           owner_user_id = ?,
           title = ?,
           description = ?,
           evidence_summary = ?,
           topic_key = ?,
           fit_score = ?,
           signal_strength_score = ?,
           urgency_score = ?,
           engagement_score = ?,
           coverage_score = ?,
           momentum_score = ?,
           staleness_penalty = ?,
           duplicate_penalty = ?,
           total_score = ?,
           confidence_score = ?,
           top_positive_factors_json = ?,
           top_negative_factors_json = ?,
           status = 'attached',
           detected_at = ?,
           updated_by = ?,
           updated_at = NOW(3)
       WHERE id = ?`,
      [
        caseId,
        rulesetId,
        payload.signalType,
        payload.signalSubtype,
        Number(interaction.account_id),
        payload.primaryContactId,
        payload.ownerUserId,
        payload.title,
        payload.description,
        payload.evidenceSummary,
        payload.topicKey,
        payload.fitScore,
        payload.signalStrengthScore,
        payload.urgencyScore,
        payload.engagementScore,
        payload.coverageScore,
        payload.momentumScore,
        payload.stalenessPenalty,
        payload.duplicatePenalty,
        payload.totalScore,
        payload.confidenceScore,
        JSON.stringify(payload.topPositiveFactors),
        JSON.stringify(payload.topNegativeFactors),
        payload.detectedAt,
        Number(userId),
        Number(existingSignal.id),
      ],
    );
    await recomputeCaseAggregate(conn, caseId, userId);
    return { caseId, signalId: Number(existingSignal.id), action: "updated" };
  }

  const [signalResult] = await conn.query(
    `INSERT INTO commercial_signals
       (public_id, case_id, ruleset_id, signal_type, signal_subtype, source_type,
        source_entity_id, interaction_id, account_id, contact_id, owner_user_id,
        title, description, evidence_summary, topic_key, fit_score,
        signal_strength_score, urgency_score, engagement_score, coverage_score,
        momentum_score, staleness_penalty, duplicate_penalty, total_score,
        confidence_score, top_positive_factors_json, top_negative_factors_json,
        status, detected_at, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'interaction', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'attached', ?, ?, ?, NOW(3), NOW(3))`,
    [
      buildPublicId("sig"),
      caseId,
      rulesetId,
      payload.signalType,
      payload.signalSubtype,
      Number(interaction.id),
      Number(interaction.id),
      Number(interaction.account_id),
      payload.primaryContactId,
      payload.ownerUserId,
      payload.title,
      payload.description,
      payload.evidenceSummary,
      payload.topicKey,
      payload.fitScore,
      payload.signalStrengthScore,
      payload.urgencyScore,
      payload.engagementScore,
      payload.coverageScore,
      payload.momentumScore,
      payload.stalenessPenalty,
      payload.duplicatePenalty,
      payload.totalScore,
      payload.confidenceScore,
      JSON.stringify(payload.topPositiveFactors),
      JSON.stringify(payload.topNegativeFactors),
      payload.detectedAt,
      Number(userId),
      Number(userId),
    ],
  );
  await recomputeCaseAggregate(conn, caseId, userId);
  return { caseId, signalId: Number(signalResult.insertId), action: "created" };
}

export async function runPotentialOpportunityDetection({
  user,
  interactionIds = [],
  forceRebuild = false,
}) {
  const ruleset = await getActiveRuleset();
  if (!ruleset) {
    throw new Error("No hay ruleset activo para oportunidades potenciales");
  }

  const params = [];
  let ownershipJoin = "";
  if (!user?.permissionSet?.has("oportunidades_potenciales.read_all")) {
    ownershipJoin =
      "INNER JOIN account_owners ao_scope ON ao_scope.account_id = i.account_id AND ao_scope.user_id = ?";
    params.push(Number(user.id));
  }

  const where = [
    "i.account_id IS NOT NULL",
    "i.analysis_status IN ('analyzed', 'resolved')",
  ];
  if (Array.isArray(interactionIds) && interactionIds.length) {
    where.push(`i.id IN (${interactionIds.map(() => "?").join(", ")})`);
    params.push(...interactionIds.map((item) => Number(item)));
  }

  const rows = await query(
    `SELECT i.*,
            a.name AS account_name,
            (SELECT MIN(contact_id) FROM interaction_contact_links WHERE interaction_id = i.id) AS primary_contact_id,
            (SELECT COUNT(*) FROM account_owners WHERE account_id = i.account_id) AS account_owner_count
     FROM interactions i
     INNER JOIN accounts a ON a.id = i.account_id
     ${ownershipJoin}
     WHERE ${where.join(" AND ")}
     ORDER BY COALESCE(i.analyzed_at, i.created_at) DESC, i.id DESC`,
    params,
  );

  const processed = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  await withTransaction(async (conn) => {
    for (const interaction of rows) {
      const payload = buildSignalFromInteraction(interaction, ruleset);
      if (!payload) {
        skipped += 1;
        continue;
      }

      const result = await createOrUpdateCaseForSignal(conn, {
        interaction,
        payload,
        rulesetId: Number(ruleset.id),
        userId: Number(user.id),
        forceRebuild,
      });

      if (result.action === "created") {
        created += 1;
      } else if (result.action === "updated") {
        updated += 1;
      } else {
        skipped += 1;
      }

      processed.push({
        interactionId: Number(interaction.id),
        caseId: result.caseId,
        signalId: result.signalId,
        action: result.action,
      });
    }
  });

  return {
    created,
    updated,
    skipped,
    processed,
  };
}

export async function listPotentialOpportunityCases({ user, filters = {} }) {
  const page = Math.max(1, Number(filters.page || 1) || 1);
  const pageSize = Math.min(
    50,
    Math.max(1, Number(filters.pageSize || 20) || 20),
  );
  const params = [];
  const joins = buildAccessScope({ user, caseAlias: "poc", params });
  const where = ["1 = 1"];

  if (filters.search) {
    where.push(
      "(poc.title LIKE ? OR a.name LIKE ? OR poc.commercial_hypothesis LIKE ?)",
    );
    const pattern = `%${String(filters.search).trim()}%`;
    params.push(pattern, pattern, pattern);
  }
  if (filters.state && filters.state !== "all") {
    where.push("poc.state = ?");
    params.push(String(filters.state));
  }
  if (filters.priorityLevel && filters.priorityLevel !== "all") {
    where.push("poc.priority_level = ?");
    params.push(String(filters.priorityLevel));
  }
  if (filters.caseType && filters.caseType !== "all") {
    where.push("poc.case_type = ?");
    params.push(String(filters.caseType));
  }
  if (filters.ownerUserId) {
    where.push("poc.owner_user_id = ?");
    params.push(Number(filters.ownerUserId));
  }
  if (filters.withoutOwner === "true") {
    where.push("poc.owner_user_id IS NULL");
  }

  const { sortBy, sortDirection, orderBy } =
    resolvePotentialOpportunitySort(filters);

  const countRows = await query(
    `SELECT COUNT(*) AS total
     FROM potential_opportunity_cases poc
     ${joins}
     INNER JOIN accounts a ON a.id = poc.account_id
     WHERE ${where.join(" AND ")}`,
    params,
  );
  const total = Number(countRows[0]?.total || 0);
  const listParams = [...params, pageSize, (page - 1) * pageSize];
  const rows = await query(
    `SELECT poc.id, poc.public_id, poc.title, poc.case_type, poc.state, poc.priority_level,
            poc.total_score, poc.recommended_action, poc.recommended_action_due_date,
            poc.next_step_suggestion, poc.signal_count, poc.latest_evidence_at, poc.review_sla_at,
            poc.created_at,
            poc.top_positive_factors_json, poc.top_negative_factors_json,
            a.id AS account_id, a.name AS account_name,
            c.id AS contact_id, TRIM(CONCAT_WS(' ', c.first_name, c.last_name)) AS contact_name,
            u.id AS owner_user_id, u.full_name AS owner_name
     FROM potential_opportunity_cases poc
     ${joins}
     INNER JOIN accounts a ON a.id = poc.account_id
     LEFT JOIN contacts c ON c.id = poc.primary_contact_id
     LEFT JOIN users u ON u.id = poc.owner_user_id
     WHERE ${where.join(" AND ")}
     ORDER BY ${orderBy}
     LIMIT ? OFFSET ?`,
    listParams,
  );

  const accountOwnersByAccountId = await loadAccountOwnersMap(
    rows.map((row) => Number(row.account_id)),
  );

  return {
    items: rows.map((row) => ({
      id: Number(row.id),
      publicId: row.public_id,
      title: row.title,
      caseType: row.case_type,
      state: row.state,
      priorityLevel: row.priority_level,
      totalScore: Number(row.total_score || 0),
      recommendedAction: row.recommended_action,
      recommendedActionDueDate: row.recommended_action_due_date,
      nextStepSuggestion: row.next_step_suggestion || "",
      signalCount: Number(row.signal_count || 0),
      latestEvidenceAt: row.latest_evidence_at,
      reviewSlaAt: row.review_sla_at,
      createdAt: row.created_at,
      account: {
        id: Number(row.account_id),
        name: row.account_name,
      },
      accountOwners: accountOwnersByAccountId.get(Number(row.account_id)) || [],
      primaryContact: row.contact_id
        ? {
            id: Number(row.contact_id),
            fullName: row.contact_name || "",
          }
        : null,
      owner: row.owner_user_id
        ? {
            id: Number(row.owner_user_id),
            fullName: row.owner_name,
          }
        : null,
      topPositiveFactors: parseJsonField(row.top_positive_factors_json, []),
      topNegativeFactors: parseJsonField(row.top_negative_factors_json, []),
    })),
    sortBy,
    sortDirection,
    page,
    pageSize,
    total,
  };
}

export async function getPotentialOpportunitySummary({ user, filters = {} }) {
  const params = [];
  const joins = buildAccessScope({ user, caseAlias: "poc", params });
  const where = ["1 = 1"];
  if (filters.ownerUserId) {
    where.push("poc.owner_user_id = ?");
    params.push(Number(filters.ownerUserId));
  }

  const rows = await query(
    `SELECT
        SUM(CASE WHEN poc.state = 'new' THEN 1 ELSE 0 END) AS new_count,
        SUM(CASE WHEN poc.priority_level = 'critical' THEN 1 ELSE 0 END) AS critical_count,
        SUM(CASE WHEN poc.priority_level = 'high' THEN 1 ELSE 0 END) AS high_count,
        SUM(CASE WHEN poc.owner_user_id IS NULL AND poc.state IN ('new', 'in_review', 'accepted', 'postponed') THEN 1 ELSE 0 END) AS without_owner_count,
        SUM(CASE WHEN poc.review_sla_at IS NOT NULL AND poc.review_sla_at < NOW(3) AND poc.state IN ('new', 'in_review', 'accepted') THEN 1 ELSE 0 END) AS stale_count,
        SUM(CASE WHEN poc.state = 'converted' AND poc.converted_at >= DATE_SUB(NOW(3), INTERVAL 30 DAY) THEN 1 ELSE 0 END) AS converted_last_30_days
     FROM potential_opportunity_cases poc
     ${joins}
     WHERE ${where.join(" AND ")}`,
    params,
  );
  const row = rows[0] || {};

  const distributions = await query(
    `SELECT poc.state, poc.case_type, COUNT(*) AS total
     FROM potential_opportunity_cases poc
     ${joins}
     WHERE ${where.join(" AND ")}
     GROUP BY poc.state, poc.case_type`,
    params,
  );

  return {
    kpis: {
      newCount: Number(row.new_count || 0),
      criticalCount: Number(row.critical_count || 0),
      highCount: Number(row.high_count || 0),
      withoutOwnerCount: Number(row.without_owner_count || 0),
      staleCount: Number(row.stale_count || 0),
      convertedLast30Days: Number(row.converted_last_30_days || 0),
    },
    distributionByState: Array.from(
      distributions.reduce((map, item) => {
        map.set(
          item.state,
          (map.get(item.state) || 0) + Number(item.total || 0),
        );
        return map;
      }, new Map()),
      ([state, count]) => ({ state, count }),
    ),
    distributionByType: Array.from(
      distributions.reduce((map, item) => {
        map.set(
          item.case_type,
          (map.get(item.case_type) || 0) + Number(item.total || 0),
        );
        return map;
      }, new Map()),
      ([caseType, count]) => ({ caseType, count }),
    ),
  };
}

export async function getPotentialOpportunityCaseDetail({ user, caseId }) {
  const params = [];
  const joins = buildAccessScope({ user, caseAlias: "poc", params });
  params.push(caseId, caseId);
  const rows = await query(
    `SELECT poc.*, a.name AS account_name,
          TRIM(CONCAT_WS(' ', c.first_name, c.last_name)) AS contact_name,
            u.full_name AS owner_name,
            o.name AS converted_opportunity_name
     FROM potential_opportunity_cases poc
     ${joins}
     INNER JOIN accounts a ON a.id = poc.account_id
     LEFT JOIN contacts c ON c.id = poc.primary_contact_id
     LEFT JOIN users u ON u.id = poc.owner_user_id
     LEFT JOIN opportunities o ON o.id = poc.converted_opportunity_id
     WHERE poc.id = ? OR poc.public_id = ?
     LIMIT 1`,
    params,
  );
  if (!rows.length) return null;

  const row = rows[0];
  const [signals, transitions] = await Promise.all([
    query(
      `SELECT cs.id, cs.public_id, cs.signal_type, cs.signal_subtype, cs.title,
              cs.description, cs.evidence_summary, cs.total_score, cs.detected_at,
              i.public_id AS interaction_public_id, i.title AS interaction_title
       FROM commercial_signals cs
       INNER JOIN interactions i ON i.id = cs.interaction_id
       WHERE cs.case_id = ?
       ORDER BY cs.detected_at DESC, cs.id DESC`,
      [Number(row.id)],
    ),
    query(
      `SELECT pct.from_state, pct.to_state, pct.reason_code, pct.reason_note,
              pct.changed_at, u.full_name AS changed_by_name
       FROM potential_opportunity_case_transitions pct
       LEFT JOIN users u ON u.id = pct.changed_by_user_id
       WHERE pct.case_id = ?
       ORDER BY pct.changed_at DESC, pct.id DESC`,
      [Number(row.id)],
    ),
  ]);
  const accountOwnersByAccountId = await loadAccountOwnersMap([
    Number(row.account_id),
  ]);

  return {
    id: Number(row.id),
    publicId: row.public_id,
    title: row.title,
    caseType: row.case_type,
    state: row.state,
    priorityLevel: row.priority_level,
    commercialHypothesis: row.commercial_hypothesis,
    businessNeedSummary: row.business_need_summary || "",
    nextStepSuggestion: row.next_step_suggestion || "",
    recommendedAction: row.recommended_action,
    recommendedActionDueDate: row.recommended_action_due_date,
    signalCount: Number(row.signal_count || 0),
    scores: {
      fitScore: Number(row.fit_score || 0),
      signalStrengthScore: Number(row.signal_strength_score || 0),
      urgencyScore: Number(row.urgency_score || 0),
      engagementScore: Number(row.engagement_score || 0),
      coverageScore: Number(row.coverage_score || 0),
      momentumScore: Number(row.momentum_score || 0),
      stalenessPenalty: Number(row.staleness_penalty || 0),
      duplicatePenalty: Number(row.duplicate_penalty || 0),
      totalScore: Number(row.total_score || 0),
    },
    account: {
      id: Number(row.account_id),
      name: row.account_name,
    },
    accountOwners: accountOwnersByAccountId.get(Number(row.account_id)) || [],
    primaryContact: row.primary_contact_id
      ? {
          id: Number(row.primary_contact_id),
          fullName: row.contact_name || "",
        }
      : null,
    owner: row.owner_user_id
      ? {
          id: Number(row.owner_user_id),
          fullName: row.owner_name,
        }
      : null,
    convertedOpportunity: row.converted_opportunity_id
      ? {
          id: Number(row.converted_opportunity_id),
          name: row.converted_opportunity_name,
        }
      : null,
    topPositiveFactors: parseJsonField(row.top_positive_factors_json, []),
    topNegativeFactors: parseJsonField(row.top_negative_factors_json, []),
    signals: signals.map((signal) => ({
      id: Number(signal.id),
      publicId: signal.public_id,
      signalType: signal.signal_type,
      signalSubtype: signal.signal_subtype,
      title: signal.title,
      description: signal.description,
      evidenceSummary: signal.evidence_summary || "",
      contributionScore: Number(signal.total_score || 0),
      detectedAt: signal.detected_at,
      interaction: {
        publicId: signal.interaction_public_id,
        title: signal.interaction_title,
      },
    })),
    transitions: transitions.map((transition) => ({
      fromState: transition.from_state,
      toState: transition.to_state,
      reasonCode: transition.reason_code,
      reasonNote: transition.reason_note,
      changedAt: transition.changed_at,
      changedByName: transition.changed_by_name || "",
    })),
  };
}

export async function transitionPotentialOpportunityCase({
  user,
  caseId,
  toState,
  reasonCode = null,
  reasonNote = null,
  ownerUserId = null,
  postponedUntil = null,
}) {
  return withTransaction(async (conn) => {
    const current = await loadAccessibleCaseRecord(conn, { user, caseId });
    if (!current) return null;
    if (
      TERMINAL_CASE_STATES.includes(current.state) &&
      toState !== current.state
    ) {
      const error = new Error("El caso ya no admite cambios de estado");
      error.status = 409;
      throw error;
    }

    if (ownerUserId !== null) {
      if (current.state !== "accepted") {
        const error = new Error(
          "Solo se puede asignar un responsable cuando el caso ya fue aprobado por gerencia",
        );
        error.status = 409;
        throw error;
      }

      const resolved = await resolveAllowedAssignmentUsers(conn, {
        accountId: Number(current.account_id),
      });
      const ownerAllowed = resolved.items.some(
        (item) => Number(item.id) === Number(ownerUserId),
      );

      if (!ownerAllowed) {
        const error = new Error(
          resolved.selectionMode === "account_owners"
            ? "El asignado del caso debe ser uno de los owners actuales de la cuenta"
            : "El usuario seleccionado no es valido para este caso",
        );
        error.status = 400;
        throw error;
      }
    }

    const updates = ["state = ?", "updated_by = ?", "updated_at = NOW(3)"];
    const updateParams = [toState, Number(user.id)];
    if (reasonCode !== null) {
      updates.push("state_reason = ?");
      updateParams.push(reasonCode);
    }
    if (toState === "dismissed") {
      updates.push("dismissed_reason_code = ?", "dismissed_reason_note = ?");
      updateParams.push(reasonCode || null, reasonNote || null);
    }
    if (toState === "postponed") {
      updates.push("postponed_until = ?", "snooze_count = snooze_count + 1");
      updateParams.push(postponedUntil || null);
    }
    if (ownerUserId !== null) {
      updates.push("owner_user_id = ?", "assigned_by_user_id = ?");
      updateParams.push(ownerUserId, Number(user.id));
    }

    updateParams.push(Number(current.id));
    await conn.query(
      `UPDATE potential_opportunity_cases
       SET ${updates.join(", ")}
       WHERE id = ?`,
      updateParams,
    );
    await insertCaseTransition(conn, {
      caseId: Number(current.id),
      fromState: current.state,
      toState,
      reasonCode,
      reasonNote,
      userId: Number(user.id),
    });

    return Number(current.id);
  });
}

async function getIdByCodeWithConn(conn, tableName, code) {
  const [rows] = await conn.query(
    `SELECT id FROM ${tableName} WHERE code = ? LIMIT 1`,
    [code],
  );
  return rows.length ? Number(rows[0].id) : null;
}

export async function convertPotentialOpportunityCase({
  user,
  caseId,
  payload,
}) {
  return withTransaction(async (conn) => {
    const params = [];
    const joins = buildAccessScope({ user, caseAlias: "poc", params });
    params.push(caseId, caseId);
    const [rows] = await conn.query(
      `SELECT poc.*
       FROM potential_opportunity_cases poc
       ${joins}
       WHERE poc.id = ? OR poc.public_id = ?
       LIMIT 1`,
      params,
    );
    const current = rows[0] || null;
    if (!current) return null;
    if (current.converted_opportunity_id) {
      return Number(current.converted_opportunity_id);
    }

    const [existingOpen] = await conn.query(
      `SELECT id
       FROM opportunities
       WHERE account_id = ?
         AND LOWER(TRIM(name)) = LOWER(TRIM(?))
         AND commercial_status_id = (
           SELECT id FROM opportunity_commercial_statuses WHERE code = 'en_proceso' LIMIT 1
         )
       LIMIT 1`,
      [Number(current.account_id), payload.name],
    );
    if (existingOpen.length) {
      const error = new Error(
        "Ya existe una oportunidad abierta equivalente para la cuenta",
      );
      error.status = 409;
      throw error;
    }

    const creationStatusCode = user.permissionSet?.has("oportunidades.create")
      ? "activada"
      : "pendiente_activacion";
    const [salesStageId, commercialStatusId, activationStatusId] =
      await Promise.all([
        getIdByCodeWithConn(
          conn,
          "opportunity_sales_stages",
          "contacto_inicial",
        ),
        getIdByCodeWithConn(
          conn,
          "opportunity_commercial_statuses",
          "en_proceso",
        ),
        getIdByCodeWithConn(
          conn,
          "opportunity_activation_statuses",
          creationStatusCode,
        ),
      ]);
    const businessLineId = payload.businessLineId
      ? Number(payload.businessLineId)
      : await getIdByCodeWithConn(conn, "opportunity_business_lines", "otros");
    const sellerUserId = payload.ownerUserId
      ? Number(payload.ownerUserId)
      : Number(user.id);

    const [insertResult] = await conn.query(
      `INSERT INTO opportunities
         (name, amount_usd, account_id, close_date, contact_id,
          sales_stage_id, business_line_id, seller_user_id, presales_user_id,
          activation_status_id, commercial_status_id, created_by, created_at,
          updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), ?, NOW(3))`,
      [
        payload.name,
        Number(payload.amountUsd || 0),
        Number(current.account_id),
        payload.closeDate,
        payload.primaryContactId || current.primary_contact_id || null,
        salesStageId,
        businessLineId,
        sellerUserId,
        payload.presalesUserId || null,
        activationStatusId,
        commercialStatusId,
        Number(user.id),
        Number(user.id),
      ],
    );
    const opportunityId = Number(insertResult.insertId);

    await conn.query(
      `UPDATE potential_opportunity_cases
       SET converted_opportunity_id = ?,
           converted_at = NOW(3),
           converted_by_user_id = ?,
           state = 'converted',
           updated_by = ?,
           updated_at = NOW(3)
       WHERE id = ?`,
      [opportunityId, Number(user.id), Number(user.id), Number(current.id)],
    );
    await insertCaseTransition(conn, {
      caseId: Number(current.id),
      fromState: current.state,
      toState: "converted",
      reasonCode: "manual_convert",
      reasonNote: "Caso convertido a oportunidad formal",
      userId: Number(user.id),
    });

    return opportunityId;
  });
}

export async function getPotentialOpportunityAnalytics({ user }) {
  const params = [];
  const joins = buildAccessScope({ user, caseAlias: "poc", params });
  const [rows] = await query(
    `SELECT
        COUNT(*) AS total_cases,
        SUM(CASE WHEN poc.state = 'converted' THEN 1 ELSE 0 END) AS converted_cases,
        SUM(CASE WHEN poc.state = 'dismissed' THEN 1 ELSE 0 END) AS dismissed_cases,
        AVG(TIMESTAMPDIFF(HOUR, poc.created_at, COALESCE(poc.converted_at, poc.updated_at))) AS avg_resolution_hours,
        AVG(CASE WHEN poc.converted_at IS NOT NULL THEN TIMESTAMPDIFF(DAY, poc.created_at, poc.converted_at) END) AS avg_conversion_days
     FROM potential_opportunity_cases poc
     ${joins}`,
    params,
  );
  const row = rows[0] || {};
  const byType = await query(
    `SELECT poc.case_type, COUNT(*) AS created,
            SUM(CASE WHEN poc.state = 'converted' THEN 1 ELSE 0 END) AS converted
     FROM potential_opportunity_cases poc
     ${joins}
     GROUP BY poc.case_type`,
    params,
  );
  const byOwner = await query(
    `SELECT u.id AS owner_user_id, u.full_name AS owner_name,
            COUNT(*) AS open_cases,
            SUM(CASE WHEN poc.state = 'converted' THEN 1 ELSE 0 END) AS converted_cases,
            SUM(CASE WHEN poc.review_sla_at < NOW(3) AND poc.state IN ('new', 'in_review', 'accepted') THEN 1 ELSE 0 END) AS backlog_over_sla
     FROM potential_opportunity_cases poc
     ${joins}
     LEFT JOIN users u ON u.id = poc.owner_user_id
     GROUP BY u.id, u.full_name
     ORDER BY open_cases DESC, converted_cases DESC`,
    params,
  );

  const totalCases = Number(row.total_cases || 0);
  const convertedCases = Number(row.converted_cases || 0);
  const dismissedCases = Number(row.dismissed_cases || 0);
  return {
    kpis: {
      signalsCreated: Number(totalCases),
      casesCreated: totalCases,
      casesReviewed: Number(totalCases - Math.max(0, 0)),
      casesConverted: convertedCases,
      conversionRate: totalCases ? convertedCases / totalCases : 0,
      falsePositiveRate: totalCases ? dismissedCases / totalCases : 0,
      avgTimeToFirstReviewHours: Number(row.avg_resolution_hours || 0),
      avgTimeToConvertDays: Number(row.avg_conversion_days || 0),
    },
    byCaseType: byType.map((item) => ({
      caseType: item.case_type,
      created: Number(item.created || 0),
      converted: Number(item.converted || 0),
    })),
    byOwner: byOwner.map((item) => ({
      ownerUserId: item.owner_user_id ? Number(item.owner_user_id) : null,
      ownerName: item.owner_name || "Sin owner",
      openCases: Number(item.open_cases || 0),
      convertedCases: Number(item.converted_cases || 0),
      backlogOverSla: Number(item.backlog_over_sla || 0),
    })),
  };
}
