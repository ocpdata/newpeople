import { query } from "../db.js";
import { parseJsonSafe } from "./hash.js";

export const ANSWER_SOURCE = Object.freeze({
  manual: "manual",
  document: "document",
  crm: "crm",
  ai: "ai",
});

export const ANSWER_STATUS = Object.freeze({
  confirmed: "confirmed",
  suggested: "suggested",
});

// A confirmed human answer always wins; among automatic sources the more reliable one replaces the weaker one.
const SOURCE_PRIORITY = { manual: 4, document: 3, crm: 2, ai: 1 };

export function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

export function questionsForSelection(playbook, modules) {
  const active = new Set(["general", ...(modules || [])]);
  return (playbook?.content?.questions || []).filter((question) =>
    active.has(question.module),
  );
}

export function isEmptyAnswerValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

// Validates and normalizes a value against the question type.
export function normalizeAnswerValue(question, value) {
  if (isEmptyAnswerValue(value)) return null;
  switch (question.type) {
    case "number": {
      const numeric = Number(String(value).replace(/,/g, ""));
      if (!Number.isFinite(numeric) || numeric < 0) {
        throw badRequest(`La respuesta de "${question.code}" debe ser un numero`);
      }
      return numeric;
    }
    case "boolean": {
      if (typeof value === "boolean") return value;
      const text = String(value).trim().toLowerCase();
      if (["si", "sí", "true", "1", "yes"].includes(text)) return true;
      if (["no", "false", "0"].includes(text)) return false;
      throw badRequest(`La respuesta de "${question.code}" debe ser si o no`);
    }
    case "choice": {
      const text = String(value).trim();
      if (!question.options.includes(text)) {
        throw badRequest(`Opcion invalida para "${question.code}"`);
      }
      return text;
    }
    case "multi": {
      const list = (Array.isArray(value) ? value : [value])
        .map((entry) => String(entry).trim())
        .filter(Boolean);
      const invalid = list.find((entry) => !question.options.includes(entry));
      if (invalid) {
        throw badRequest(`Opcion invalida para "${question.code}": ${invalid}`);
      }
      return Array.from(new Set(list));
    }
    default:
      return String(value).trim().slice(0, 2_000);
  }
}

function serializeAnswerRow(row) {
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    playbookCode: row.playbook_code,
    questionCode: row.question_code,
    value: parseJsonSafe(row.value_json, null),
    sourceType: row.source_type,
    sourceRef: row.source_ref || "",
    confidence: row.confidence === null ? null : Number(row.confidence),
    status: row.status,
    updatedByUserId: row.updated_by_user_id
      ? Number(row.updated_by_user_id)
      : null,
    updatedAt: row.updated_at,
  };
}

export async function listAnswers(opportunityId, playbookCodes = null) {
  const params = [Number(opportunityId)];
  let filter = "";
  if (Array.isArray(playbookCodes) && playbookCodes.length) {
    filter = ` AND playbook_code IN (${playbookCodes.map(() => "?").join(", ")})`;
    params.push(...playbookCodes);
  }
  const rows = await query(
    `SELECT * FROM opportunity_technical_answers
     WHERE opportunity_id = ?${filter}
     ORDER BY playbook_code, question_code`,
    params,
  );
  return rows.map(serializeAnswerRow);
}

async function recordHistory({
  opportunityId,
  playbookCode,
  questionCode,
  previous,
  next,
  sourceType,
  status,
  userId,
}) {
  await query(
    `INSERT INTO opportunity_technical_answer_history
       (opportunity_id, playbook_code, question_code, previous_value_json, new_value_json, source_type, status, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      Number(opportunityId),
      playbookCode,
      questionCode,
      previous === undefined ? null : JSON.stringify(previous),
      JSON.stringify(next ?? null),
      sourceType,
      status,
      userId ? Number(userId) : null,
    ],
  );
}

async function recordCalibrationSuggestion({
  playbookCode,
  proposalDocumentId,
  questionCode,
  suggested,
  confirmed,
  userId,
}) {
  const rows = await query(
    `SELECT id FROM tech_playbooks WHERE code = ? LIMIT 1`,
    [playbookCode],
  );
  if (!rows.length) return;
  await query(
    `INSERT INTO tech_playbook_suggestions
       (playbook_id, proposal_document_id, kind, subject_code, detail_json, created_by_user_id)
     VALUES (?, ?, 'answer_correction', ?, ?, ?)`,
    [
      Number(rows[0].id),
      proposalDocumentId ? Number(proposalDocumentId) : null,
      questionCode,
      JSON.stringify({ suggested, confirmed }),
      userId ? Number(userId) : null,
    ],
  );
}

// Saves an answer typed by a person. Returns the stored answer.
export async function saveManualAnswer({
  opportunityId,
  playbookCode,
  question,
  value,
  userId,
  proposalDocumentId = null,
}) {
  const normalized = normalizeAnswerValue(question, value);
  const existingRows = await query(
    `SELECT * FROM opportunity_technical_answers
     WHERE opportunity_id = ? AND playbook_code = ? AND question_code = ? LIMIT 1`,
    [Number(opportunityId), playbookCode, question.code],
  );
  const existing = existingRows[0] ? serializeAnswerRow(existingRows[0]) : null;

  if (normalized === null) {
    if (existing) {
      await query(`DELETE FROM opportunity_technical_answers WHERE id = ?`, [
        existing.id,
      ]);
      await recordHistory({
        opportunityId,
        playbookCode,
        questionCode: question.code,
        previous: existing.value,
        next: null,
        sourceType: ANSWER_SOURCE.manual,
        status: ANSWER_STATUS.confirmed,
        userId,
      });
    }
    return null;
  }

  await query(
    `INSERT INTO opportunity_technical_answers
       (opportunity_id, playbook_code, question_code, value_json, source_type, source_ref, confidence, status, updated_by_user_id)
     VALUES (?, ?, ?, ?, 'manual', NULL, NULL, 'confirmed', ?)
     ON DUPLICATE KEY UPDATE
       value_json = VALUES(value_json),
       source_type = 'manual',
       source_ref = NULL,
       confidence = NULL,
       status = 'confirmed',
       updated_by_user_id = VALUES(updated_by_user_id),
       updated_at = NOW(3)`,
    [
      Number(opportunityId),
      playbookCode,
      question.code,
      JSON.stringify(normalized),
      userId ? Number(userId) : null,
    ],
  );
  await recordHistory({
    opportunityId,
    playbookCode,
    questionCode: question.code,
    previous: existing?.value,
    next: normalized,
    sourceType: ANSWER_SOURCE.manual,
    status: ANSWER_STATUS.confirmed,
    userId,
  });

  if (
    existing &&
    existing.status === ANSWER_STATUS.suggested &&
    JSON.stringify(existing.value) !== JSON.stringify(normalized)
  ) {
    await recordCalibrationSuggestion({
      playbookCode,
      proposalDocumentId,
      questionCode: question.code,
      suggested: existing.value,
      confirmed: normalized,
      userId,
    }).catch(() => {});
  }

  const rows = await query(
    `SELECT * FROM opportunity_technical_answers
     WHERE opportunity_id = ? AND playbook_code = ? AND question_code = ? LIMIT 1`,
    [Number(opportunityId), playbookCode, question.code],
  );
  return rows[0] ? serializeAnswerRow(rows[0]) : null;
}

// Stores an automatic suggestion (document, CRM or AI) without ever overriding a confirmed answer.
export async function saveSuggestedAnswer({
  opportunityId,
  playbookCode,
  question,
  value,
  sourceType,
  sourceRef = "",
  confidence = null,
  userId = null,
}) {
  let normalized;
  try {
    normalized = normalizeAnswerValue(question, value);
  } catch {
    return { stored: false, reason: "invalid_value" };
  }
  if (normalized === null) return { stored: false, reason: "empty" };

  const existingRows = await query(
    `SELECT * FROM opportunity_technical_answers
     WHERE opportunity_id = ? AND playbook_code = ? AND question_code = ? LIMIT 1`,
    [Number(opportunityId), playbookCode, question.code],
  );
  const existing = existingRows[0] ? serializeAnswerRow(existingRows[0]) : null;

  if (existing) {
    if (existing.status === ANSWER_STATUS.confirmed) {
      const same = JSON.stringify(existing.value) === JSON.stringify(normalized);
      return same
        ? { stored: false, reason: "already_confirmed" }
        : {
            stored: false,
            reason: "conflict",
            conflict: {
              questionCode: question.code,
              playbookCode,
              current: existing.value,
              suggested: normalized,
              sourceType,
              sourceRef,
            },
          };
    }
    if (
      (SOURCE_PRIORITY[sourceType] || 0) < (SOURCE_PRIORITY[existing.sourceType] || 0)
    ) {
      return { stored: false, reason: "lower_priority" };
    }
  }

  await query(
    `INSERT INTO opportunity_technical_answers
       (opportunity_id, playbook_code, question_code, value_json, source_type, source_ref, confidence, status, updated_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'suggested', ?)
     ON DUPLICATE KEY UPDATE
       value_json = VALUES(value_json),
       source_type = VALUES(source_type),
       source_ref = VALUES(source_ref),
       confidence = VALUES(confidence),
       status = 'suggested',
       updated_by_user_id = VALUES(updated_by_user_id),
       updated_at = NOW(3)`,
    [
      Number(opportunityId),
      playbookCode,
      question.code,
      JSON.stringify(normalized),
      sourceType,
      String(sourceRef || "").slice(0, 500) || null,
      confidence === null ? null : Math.max(0, Math.min(1, Number(confidence))),
      userId ? Number(userId) : null,
    ],
  );
  await recordHistory({
    opportunityId,
    playbookCode,
    questionCode: question.code,
    previous: existing?.value,
    next: normalized,
    sourceType,
    status: ANSWER_STATUS.suggested,
    userId,
  });
  return { stored: true };
}

export async function confirmSuggestedAnswers({
  opportunityId,
  playbookCode,
  questionCodes = null,
  userId,
}) {
  const params = [Number(opportunityId), playbookCode];
  let filter = "";
  if (Array.isArray(questionCodes) && questionCodes.length) {
    filter = ` AND question_code IN (${questionCodes.map(() => "?").join(", ")})`;
    params.push(...questionCodes);
  }
  const rows = await query(
    `SELECT * FROM opportunity_technical_answers
     WHERE opportunity_id = ? AND playbook_code = ? AND status = 'suggested'${filter}`,
    params,
  );
  for (const row of rows) {
    await query(
      `UPDATE opportunity_technical_answers
       SET status = 'confirmed', updated_by_user_id = ?, updated_at = NOW(3)
       WHERE id = ?`,
      [userId ? Number(userId) : null, Number(row.id)],
    );
    await recordHistory({
      opportunityId,
      playbookCode,
      questionCode: row.question_code,
      previous: parseJsonSafe(row.value_json, null),
      next: parseJsonSafe(row.value_json, null),
      sourceType: row.source_type,
      status: ANSWER_STATUS.confirmed,
      userId,
    });
  }
  return rows.length;
}

// Coverage of the questionnaire for the selected playbooks and modules.
export function computeQuestionnaireCoverage({ selections, playbooks, answers }) {
  const byKey = new Map(
    answers.map((answer) => [`${answer.playbookCode}:${answer.questionCode}`, answer]),
  );
  const result = {
    total: 0,
    confirmed: 0,
    suggestedPending: 0,
    requiredMissing: [],
  };
  for (const selection of selections) {
    const playbook = playbooks.find((entry) => entry.code === selection.code);
    for (const question of questionsForSelection(playbook, selection.modules)) {
      result.total += 1;
      const answer = byKey.get(`${selection.code}:${question.code}`);
      if (answer?.status === ANSWER_STATUS.confirmed) result.confirmed += 1;
      else if (answer?.status === ANSWER_STATUS.suggested) result.suggestedPending += 1;
      if (question.required && answer?.status !== ANSWER_STATUS.confirmed) {
        result.requiredMissing.push({
          playbookCode: selection.code,
          questionCode: question.code,
          prompt: question.prompt,
        });
      }
    }
  }
  return result;
}

// Frozen copy of the confirmed answers; the scope, its hash and the PDF use this, not the live profile.
export function buildProfileSnapshot({ selections, playbooks, answers }) {
  const byKey = new Map(
    answers
      .filter((answer) => answer.status === ANSWER_STATUS.confirmed)
      .map((answer) => [`${answer.playbookCode}:${answer.questionCode}`, answer]),
  );
  const snapshotAnswers = [];
  const missing = [];
  for (const selection of selections) {
    const playbook = playbooks.find((entry) => entry.code === selection.code);
    for (const question of questionsForSelection(playbook, selection.modules)) {
      const answer = byKey.get(`${selection.code}:${question.code}`);
      if (answer) {
        snapshotAnswers.push({
          playbookCode: selection.code,
          questionCode: question.code,
          prompt: question.prompt,
          type: question.type,
          unit: question.unit || "",
          value: answer.value,
          sourceType: answer.sourceType,
          sourceRef: answer.sourceRef,
        });
      } else {
        missing.push({
          playbookCode: selection.code,
          questionCode: question.code,
          prompt: question.prompt,
          required: Boolean(question.required),
        });
      }
    }
  }
  return {
    capturedAt: new Date().toISOString(),
    playbooks: selections.map((selection) => ({
      code: selection.code,
      versionNumber: selection.versionNumber || null,
      modules: selection.modules || [],
    })),
    answers: snapshotAnswers,
    missing,
  };
}
