import { query, withTransaction } from "../db.js";
import { parseJsonSafe } from "./hash.js";
import {
  PLAYBOOK_STATUS,
  parsePlaybookContent,
} from "./playbook-schema.js";
import { SEED_PLAYBOOKS } from "./seeds/playbooks.js";
import { listDocumentacionRagTopicOptions } from "../documentacion-rag/service.js";

export function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function serializePlaybookRow(row, { content = null } = {}) {
  return {
    id: Number(row.id),
    code: row.code,
    name: row.name,
    manufacturer: row.manufacturer || "",
    ragTopicName: row.rag_topic_name || "",
    detectionKeywords: parseJsonSafe(row.detection_keywords_json, []) || [],
    status: row.status,
    origin: row.origin,
    currentVersionId: row.current_version_id
      ? Number(row.current_version_id)
      : null,
    currentVersionNumber: row.current_version_number
      ? Number(row.current_version_number)
      : null,
    updatedAt: row.updated_at,
    ...(content ? { content } : {}),
  };
}

const PLAYBOOK_SELECT = `
  SELECT p.*, v.version_number AS current_version_number, v.content_json
  FROM tech_playbooks p
  LEFT JOIN tech_playbook_versions v ON v.id = p.current_version_id`;

async function insertPlaybookVersion(conn, {
  playbookId,
  content,
  status,
  notes,
  generatedBy,
  userId,
}) {
  const [versionRows] = await conn.query(
    `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
     FROM tech_playbook_versions WHERE playbook_id = ?`,
    [Number(playbookId)],
  );
  const versionNumber = Number(versionRows[0].next_version);
  const [result] = await conn.query(
    `INSERT INTO tech_playbook_versions
       (playbook_id, version_number, status, content_json, source_notes, generated_by, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      Number(playbookId),
      versionNumber,
      status,
      JSON.stringify(content),
      notes || null,
      generatedBy,
      userId ? Number(userId) : null,
    ],
  );
  await conn.query(
    `UPDATE tech_playbooks
     SET current_version_id = ?, status = ?, updated_at = NOW(3)
     WHERE id = ?`,
    [Number(result.insertId), status, Number(playbookId)],
  );
  return { versionId: Number(result.insertId), versionNumber };
}

// The playbook is linked to a RAG topic by name, so the name must match an existing active topic.
async function resolveRagTopicName(name) {
  const requested = String(name || "").trim();
  if (!requested) return "";
  const topics = await listDocumentacionRagTopicOptions();
  const match = topics.find((topic) => topic.name.toLowerCase() === requested.toLowerCase());
  if (!match) {
    const error = new Error(
      `El tema "${requested}" no existe en Documentación RAG. Elige uno de los temas disponibles.`,
    );
    error.status = 400;
    error.code = "rag_topic_not_found";
    throw error;
  }
  return match.name;
}

// A version is "in use" once a proposal scope was started with it; those versions are never edited in place.
export async function isPlaybookVersionInUse(code, versionNumber) {
  if (!versionNumber) return false;
  const prefix = `{"code":${JSON.stringify(String(code))},"versionNumber":${Number(versionNumber)}`;
  const rows = await query(
    `SELECT 1 AS used FROM proposal_technical_scopes
     WHERE LOCATE(?, playbook_codes_json) > 0 OR LOCATE(?, playbook_codes_json) > 0
     LIMIT 1`,
    [`${prefix},`, `${prefix}}`],
  );
  return rows.length > 0;
}

let ensureSeedsPromise;

// Seeds are inserted once; later edits and generated drafts are never overwritten by the seed.
export async function ensureTechnicalPlaybookSeeds() {
  if (!ensureSeedsPromise) {
    ensureSeedsPromise = insertMissingSeeds().catch((error) => {
      ensureSeedsPromise = undefined;
      throw error;
    });
  }
  await ensureSeedsPromise;
}

async function insertMissingSeeds() {
  for (const seed of SEED_PLAYBOOKS) {
    const content = parsePlaybookContent(seed.content);
    const existing = await query(
      `SELECT id FROM tech_playbooks WHERE code = ? LIMIT 1`,
      [seed.code],
    );
    if (existing.length) continue;
    await withTransaction(async (conn) => {
      const [result] = await conn.query(
        `INSERT INTO tech_playbooks
           (code, name, manufacturer, rag_topic_name, detection_keywords_json, status, origin)
         VALUES (?, ?, ?, ?, ?, ?, 'seed')`,
        [
          seed.code,
          seed.name,
          seed.manufacturer,
          seed.ragTopicName,
          JSON.stringify(seed.detectionKeywords || []),
          PLAYBOOK_STATUS.draftAi,
        ],
      );
      await insertPlaybookVersion(conn, {
        playbookId: result.insertId,
        content,
        status: PLAYBOOK_STATUS.draftAi,
        notes: "Playbook semilla general, pendiente de enriquecer con la documentación del tema RAG.",
        generatedBy: "seed",
        userId: null,
      });
    });
  }
}

export async function listPlaybooks({ includeArchived = false } = {}) {
  const rows = await query(
    `${PLAYBOOK_SELECT}
     ${includeArchived ? "" : "WHERE p.status <> 'archivado'"}
     ORDER BY p.manufacturer, p.name`,
  );
  return rows.map((row) => serializePlaybookRow(row));
}

export async function getPlaybookByCode(code, { versionNumber = null } = {}) {
  if (versionNumber) {
    const rows = await query(
      `SELECT p.*, v.version_number AS current_version_number, v.content_json
       FROM tech_playbooks p
       INNER JOIN tech_playbook_versions v
         ON v.playbook_id = p.id AND v.version_number = ?
       WHERE p.code = ? LIMIT 1`,
      [Number(versionNumber), String(code)],
    );
    return rows[0]
      ? serializePlaybookRow(rows[0], {
          content: parsePlaybookContent(parseJsonSafe(rows[0].content_json, {})),
        })
      : null;
  }
  const rows = await query(`${PLAYBOOK_SELECT} WHERE p.code = ? LIMIT 1`, [
    String(code),
  ]);
  const row = rows[0];
  if (!row) return null;
  return serializePlaybookRow(row, {
    content: parsePlaybookContent(parseJsonSafe(row.content_json, {})),
  });
}

export async function listPlaybookVersions(code) {
  const rows = await query(
    `SELECT v.id, v.version_number, v.status, v.generated_by, v.source_notes, v.created_at
     FROM tech_playbook_versions v
     INNER JOIN tech_playbooks p ON p.id = v.playbook_id
     WHERE p.code = ?
     ORDER BY v.version_number DESC`,
    [String(code)],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    versionNumber: Number(row.version_number),
    status: row.status,
    generatedBy: row.generated_by,
    notes: row.source_notes || "",
    createdAt: row.created_at,
  }));
}

export async function createPlaybook({
  code,
  name,
  manufacturer = "",
  ragTopicName = "",
  detectionKeywords = [],
  content,
  userId,
}) {
  const parsedContent = parsePlaybookContent(content || {});
  const topicName = await resolveRagTopicName(ragTopicName);
  const existing = await query(
    `SELECT id FROM tech_playbooks WHERE code = ? LIMIT 1`,
    [code],
  );
  if (existing.length) {
    const error = new Error("Ya existe un playbook con ese codigo");
    error.status = 409;
    throw error;
  }
  await withTransaction(async (conn) => {
    const [result] = await conn.query(
      `INSERT INTO tech_playbooks
         (code, name, manufacturer, rag_topic_name, detection_keywords_json, status, origin)
       VALUES (?, ?, ?, ?, ?, ?, 'manual')`,
      [
        code,
        name,
        manufacturer,
        topicName,
        JSON.stringify(detectionKeywords),
        PLAYBOOK_STATUS.draftAi,
      ],
    );
    await insertPlaybookVersion(conn, {
      playbookId: result.insertId,
      content: parsedContent,
      status: PLAYBOOK_STATUS.draftAi,
      notes: "Alta manual",
      generatedBy: "manual",
      userId,
    });
  });
  return getPlaybookByCode(code);
}

// A save creates a new version, except when the caller asks to overwrite the current one and that
// version is an unused AI draft that stays an AI draft.
export async function savePlaybookVersion({
  code,
  content,
  status = null,
  notes = "",
  generatedBy = "manual",
  userId = null,
  overwriteCurrent = false,
}) {
  const parsedContent = parsePlaybookContent(content);
  const playbook = await getPlaybookByCode(code);
  if (!playbook) {
    const error = new Error("Playbook no encontrado");
    error.status = 404;
    throw error;
  }
  const nextStatus = Object.values(PLAYBOOK_STATUS).includes(status)
    ? status
    : playbook.status === PLAYBOOK_STATUS.archived
      ? PLAYBOOK_STATUS.draftAi
      : playbook.status;
  const canOverwrite =
    overwriteCurrent &&
    playbook.currentVersionId &&
    nextStatus === PLAYBOOK_STATUS.draftAi &&
    playbook.status === PLAYBOOK_STATUS.draftAi &&
    !(await isPlaybookVersionInUse(code, playbook.currentVersionNumber));
  if (canOverwrite) {
    await withTransaction(async (conn) => {
      await conn.query(
        `UPDATE tech_playbook_versions
         SET content_json = ?, source_notes = ?, generated_by = ?, created_by_user_id = ?
         WHERE id = ?`,
        [
          JSON.stringify(parsedContent),
          notes || null,
          generatedBy,
          userId ? Number(userId) : null,
          playbook.currentVersionId,
        ],
      );
      await conn.query(`UPDATE tech_playbooks SET updated_at = NOW(3) WHERE id = ?`, [playbook.id]);
    });
    return { ...(await getPlaybookByCode(code)), overwritten: true };
  }
  await withTransaction(async (conn) => {
    await insertPlaybookVersion(conn, {
      playbookId: playbook.id,
      content: parsedContent,
      status: nextStatus,
      notes,
      generatedBy,
      userId,
    });
  });
  return { ...(await getPlaybookByCode(code)), overwritten: false };
}

export async function updatePlaybookMetadata(code, patch) {
  const playbook = await getPlaybookByCode(code);
  if (!playbook) {
    const error = new Error("Playbook no encontrado");
    error.status = 404;
    throw error;
  }
  const status = Object.values(PLAYBOOK_STATUS).includes(patch.status)
    ? patch.status
    : playbook.status;
  // Only a changed topic is validated, so a playbook keeps working if its topic was later renamed.
  const ragTopicName =
    patch.ragTopicName !== undefined && patch.ragTopicName.trim() !== playbook.ragTopicName
      ? await resolveRagTopicName(patch.ragTopicName)
      : playbook.ragTopicName;
  await query(
    `UPDATE tech_playbooks
     SET name = ?, manufacturer = ?, rag_topic_name = ?,
         detection_keywords_json = ?, status = ?, updated_at = NOW(3)
     WHERE id = ?`,
    [
      patch.name ?? playbook.name,
      patch.manufacturer ?? playbook.manufacturer,
      ragTopicName,
      JSON.stringify(patch.detectionKeywords ?? playbook.detectionKeywords),
      status,
      playbook.id,
    ],
  );
  return getPlaybookByCode(code);
}

// Suggests playbooks (and the modules inside) from the quoted products and opportunity name.
export function detectPlaybooksFromText(playbooks, sourceText) {
  const haystack = normalizeSearchText(sourceText);
  const matches = [];
  for (const playbook of playbooks) {
    const keywords = (playbook.detectionKeywords || []).map(normalizeSearchText);
    const hits = keywords.filter((keyword) => keyword && haystack.includes(keyword));
    const modules = playbook.content?.modules || [];
    const matchedModules = modules
      .filter((module) =>
        (module.detectKeywords || []).some((keyword) => {
          const normalized = normalizeSearchText(keyword);
          return normalized && haystack.includes(normalized);
        }),
      )
      .map((module) => module.code);
    if (!hits.length && !matchedModules.length) continue;
    const moduleCodes = modules.length === 1
      ? modules.map((module) => module.code)
      : matchedModules;
    matches.push({
      code: playbook.code,
      name: playbook.name,
      status: playbook.status,
      score: hits.length + matchedModules.length,
      modules: moduleCodes,
    });
  }
  return matches.sort((a, b) => b.score - a.score);
}

export async function listPlaybooksWithContent() {
  const rows = await query(
    `${PLAYBOOK_SELECT} WHERE p.status <> 'archivado' ORDER BY p.manufacturer, p.name`,
  );
  return rows.map((row) =>
    serializePlaybookRow(row, {
      content: parsePlaybookContent(parseJsonSafe(row.content_json, {})),
    }),
  );
}
