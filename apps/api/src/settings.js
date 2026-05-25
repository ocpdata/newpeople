import { config } from "./config.js";
import { query, withTransaction } from "./db.js";

let ensureCompanyProfileTablePromise;
let ensureTemporaryFeatureSettingsTablePromise;
let ensureInstitutionalAssetsSchemaPromise;
let ensureProposalContentSchemaPromise;
let ensureProposalContentClonesSchemaPromise;

const PROPOSAL_LAYOUT_MODES = ["stack", "horizontal-gallery", "manual-rows"];

export const PROPOSAL_CONTENT_COMPONENT_DEFINITIONS = [
  { code: "document_rights", title: "Derechos del documento", displayOrder: 1 },
  { code: "certifications", title: "Certificaciones", displayOrder: 2 },
  { code: "presentation", title: "Presentacion", displayOrder: 3 },
  { code: "mission", title: "Mision", displayOrder: 4 },
  { code: "vision", title: "Vision", displayOrder: 5 },
  { code: "key_partners", title: "Socios principales", displayOrder: 6 },
  { code: "key_clients", title: "Principales clientes", displayOrder: 7 },
  { code: "executive_summary", title: "Resumen ejecutivo", displayOrder: 8 },
  { code: "background", title: "Antecedentes", displayOrder: 9 },
  {
    code: "solution_description",
    title: "Descripcion de la solucion",
    displayOrder: 10,
  },
  { code: "services", title: "Servicios", displayOrder: 11 },
  {
    code: "product_brochures",
    title: "Folletos de los productos",
    displayOrder: 12,
  },
  {
    code: "commercial_proposal",
    title: "Propuesta economica",
    displayOrder: 13,
  },
  { code: "next_steps", title: "Siguientes pasos", displayOrder: 14 },
];

const PROPOSAL_BLOCK_TYPES = ["heading", "paragraph", "list", "image"];
const INSTITUTIONAL_ASSET_STATUSES = ["draft", "active", "archived"];

function safeParseJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function executeQuery(executor, sql, params = []) {
  if (typeof executor === "function") {
    return executor(sql, params);
  }

  const [rows] = await executor.query(sql, params);
  return rows;
}

async function ensureTableColumn(tableName, columnName, ddl) {
  const rows = await query(`SHOW COLUMNS FROM ${tableName} LIKE ?`, [
    columnName,
  ]);
  if (!Array.isArray(rows) || rows.length === 0) {
    await query(`ALTER TABLE ${tableName} ${ddl}`);
  }
}

function slugifyCode(value, fallbackPrefix = "asset") {
  const base = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return `${base || fallbackPrefix}_${Date.now()}`;
}

function getProposalComponentDefinition(componentCode) {
  return (
    PROPOSAL_CONTENT_COMPONENT_DEFINITIONS.find(
      (component) => component.code === componentCode,
    ) || null
  );
}

function normalizeProposalLayoutConfig(value) {
  const parsed = safeParseJson(value, null);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const mode = asText(parsed.mode);
  if (!PROPOSAL_LAYOUT_MODES.includes(mode)) {
    return null;
  }

  if (mode !== "manual-rows") {
    return { mode };
  }

  const rows = Array.isArray(parsed.rows)
    ? parsed.rows
        .map((row) => {
          const blockIndexes = Array.isArray(row?.blockIndexes)
            ? row.blockIndexes
                .map((index) => Number(index))
                .filter((index) => Number.isInteger(index) && index >= 0)
            : [];
          return blockIndexes.length ? { blockIndexes } : null;
        })
        .filter(Boolean)
    : [];

  return rows.length ? { mode, rows } : { mode };
}

function resolveProposalComponentLayoutMode(componentCode, layoutConfig) {
  const explicitMode = asText(layoutConfig?.mode);
  if (PROPOSAL_LAYOUT_MODES.includes(explicitMode)) {
    return explicitMode;
  }

  return componentCode === "certifications" ? "horizontal-gallery" : "stack";
}

function normalizeInstitutionalAssetVersionRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    assetId: Number(row.asset_id),
    versionNumber: Number(row.version_number || 1),
    fileUrl: asText(row.file_url),
    fileName: asText(row.file_name),
    mimeType: asText(row.mime_type),
    fileSizeBytes:
      row.file_size_bytes == null ? null : Number(row.file_size_bytes),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    checksum: asText(row.checksum),
    altText: asText(row.alt_text),
    caption: asText(row.caption),
    status: asText(row.status) || "active",
    createdAt: row.created_at || null,
    createdByUserId: row.created_by_user_id
      ? Number(row.created_by_user_id)
      : null,
  };
}

function buildInstitutionalAssetSnapshot(versionRow, assetRow = null) {
  if (!versionRow) return null;
  return {
    assetId: Number(versionRow.asset_id),
    assetVersionId: Number(versionRow.id),
    name: asText(assetRow?.name || versionRow.asset_name),
    category: asText(assetRow?.category || versionRow.asset_category),
    versionNumber: Number(versionRow.version_number || 1),
    fileUrl: asText(versionRow.file_url),
    fileName: asText(versionRow.file_name),
    mimeType: asText(versionRow.mime_type),
    fileSizeBytes:
      versionRow.file_size_bytes == null
        ? null
        : Number(versionRow.file_size_bytes),
    width: versionRow.width == null ? null : Number(versionRow.width),
    height: versionRow.height == null ? null : Number(versionRow.height),
    checksum: asText(versionRow.checksum),
    altText: asText(versionRow.alt_text),
    caption: asText(versionRow.caption),
  };
}

function normalizeInstitutionalAssetRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    code: asText(row.code),
    name: asText(row.name),
    description: asText(row.description),
    category: asText(row.category),
    mediaType: asText(row.media_type) || "image",
    status: asText(row.status) || "active",
    tags: Array.isArray(safeParseJson(row.tags_json, []))
      ? safeParseJson(row.tags_json, []).filter(Boolean)
      : [],
    currentVersionId: row.current_version_id
      ? Number(row.current_version_id)
      : null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    createdByUserId: row.created_by_user_id
      ? Number(row.created_by_user_id)
      : null,
    updatedByUserId: row.updated_by_user_id
      ? Number(row.updated_by_user_id)
      : null,
    currentVersion:
      row.current_version_id && row.current_file_url
        ? {
            id: Number(row.current_version_id),
            versionNumber: Number(row.current_version_number || 1),
            fileUrl: asText(row.current_file_url),
            fileName: asText(row.current_file_name),
            mimeType: asText(row.current_mime_type),
            fileSizeBytes:
              row.current_file_size_bytes == null
                ? null
                : Number(row.current_file_size_bytes),
            width: row.current_width == null ? null : Number(row.current_width),
            height:
              row.current_height == null ? null : Number(row.current_height),
            altText: asText(row.current_alt_text),
            caption: asText(row.current_caption),
          }
        : null,
  };
}

function normalizeProposalBlockRow(row) {
  const settings = safeParseJson(row.settings_json, {});
  const block = {
    id: Number(row.id),
    type: asText(row.block_type),
    displayOrder: Number(row.display_order || 0),
    text: asText(row.text_value),
    items: Array.isArray(settings.items) ? settings.items.filter(Boolean) : [],
  };

  if (block.type === "image") {
    block.image = row.asset_snapshot_json
      ? safeParseJson(row.asset_snapshot_json, null)
      : row.asset_version_id
        ? buildInstitutionalAssetSnapshot(
            {
              id: row.asset_version_id,
              asset_id: row.asset_id,
              version_number: row.asset_version_number,
              file_url: row.asset_file_url,
              file_name: row.asset_file_name,
              mime_type: row.asset_mime_type,
              file_size_bytes: row.asset_file_size_bytes,
              width: row.asset_width,
              height: row.asset_height,
              checksum: row.asset_checksum,
              alt_text: row.asset_alt_text,
              caption: row.asset_caption,
              asset_name: row.asset_name,
              asset_category: row.asset_category,
            },
            row,
          )
        : null;
    block.assetId = row.asset_id ? Number(row.asset_id) : null;
    block.assetVersionId = row.asset_version_id
      ? Number(row.asset_version_id)
      : null;
  }

  return block;
}

function normalizeProposalComponentRows(componentRows, blockRows) {
  const blocksByComponentId = new Map();
  for (const blockRow of blockRows) {
    const componentId = Number(blockRow.component_id);
    if (!blocksByComponentId.has(componentId)) {
      blocksByComponentId.set(componentId, []);
    }
    blocksByComponentId
      .get(componentId)
      .push(normalizeProposalBlockRow(blockRow));
  }

  return componentRows.map((row) => {
    const layoutConfig = normalizeProposalLayoutConfig(row.layout_config_json);
    return {
      id: Number(row.id),
      componentCode: asText(row.component_code),
      title: asText(row.title),
      displayOrder: Number(row.display_order || 0),
      status: asText(row.status) || "active",
      layoutConfig,
      resolvedLayoutMode: resolveProposalComponentLayoutMode(
        asText(row.component_code),
        layoutConfig,
      ),
      blocks: (blocksByComponentId.get(Number(row.id)) || []).sort(
        (left, right) => left.displayOrder - right.displayOrder,
      ),
    };
  });
}

function blocksToPlainText(blocks, fallback = "") {
  const text = (blocks || [])
    .map((block) => {
      if (block.type === "list") {
        return Array.isArray(block.items) ? block.items.join("\n") : "";
      }
      return String(block.text || "").trim();
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
  return text || fallback;
}

function firstListItems(blocks) {
  return (blocks || [])
    .flatMap((block) => (block.type === "list" ? block.items || [] : []))
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

export function summarizeProposalComponents(components, fallbackTitle = "") {
  const byCode = new Map(
    (components || []).map((component) => [component.componentCode, component]),
  );
  return {
    heroTitle: fallbackTitle || "Propuesta comercial",
    heroSubtitle: blocksToPlainText(
      byCode.get("presentation")?.blocks || [],
      "Propuesta comercial institucional.",
    ),
    executiveSummary: blocksToPlainText(
      byCode.get("executive_summary")?.blocks || [],
    ),
    solutionOverview: blocksToPlainText(
      byCode.get("solution_description")?.blocks || [],
    ),
    valueHighlights: firstListItems(byCode.get("services")?.blocks || []),
    closingMessage: blocksToPlainText(byCode.get("next_steps")?.blocks || []),
  };
}

async function ensureInstitutionalAssetsSchema() {
  if (!ensureInstitutionalAssetsSchemaPromise) {
    ensureInstitutionalAssetsSchemaPromise = (async () => {
      await query(
        `CREATE TABLE IF NOT EXISTS institutional_assets (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          code VARCHAR(120) NOT NULL,
          name VARCHAR(190) NOT NULL,
          description TEXT NULL,
          category VARCHAR(80) NOT NULL,
          media_type VARCHAR(40) NOT NULL DEFAULT 'image',
          status VARCHAR(40) NOT NULL DEFAULT 'active',
          current_version_id BIGINT UNSIGNED NULL,
          tags_json JSON NULL,
          created_by_user_id BIGINT UNSIGNED NULL,
          updated_by_user_id BIGINT UNSIGNED NULL,
          created_at DATETIME(3) NOT NULL,
          updated_at DATETIME(3) NOT NULL,
          CONSTRAINT uq_institutional_assets_code UNIQUE (code),
          CONSTRAINT fk_institutional_assets_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
          CONSTRAINT fk_institutional_assets_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
        )`,
      );
      await query(
        `CREATE TABLE IF NOT EXISTS institutional_asset_versions (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          asset_id BIGINT UNSIGNED NOT NULL,
          version_number INT UNSIGNED NOT NULL,
          file_url LONGTEXT NOT NULL,
          file_name VARCHAR(255) NULL,
          mime_type VARCHAR(120) NULL,
          file_size_bytes BIGINT NULL,
          width INT NULL,
          height INT NULL,
          checksum VARCHAR(120) NULL,
          alt_text VARCHAR(500) NULL,
          caption TEXT NULL,
          status VARCHAR(40) NOT NULL DEFAULT 'active',
          created_by_user_id BIGINT UNSIGNED NULL,
          created_at DATETIME(3) NOT NULL,
          CONSTRAINT uq_institutional_asset_versions UNIQUE (asset_id, version_number),
          CONSTRAINT fk_institutional_asset_versions_asset FOREIGN KEY (asset_id) REFERENCES institutional_assets(id) ON DELETE CASCADE,
          CONSTRAINT fk_institutional_asset_versions_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
        )`,
      );
    })().catch((error) => {
      ensureInstitutionalAssetsSchemaPromise = undefined;
      throw error;
    });
  }

  await ensureInstitutionalAssetsSchemaPromise;
}

async function ensureProposalContentSchema() {
  if (!ensureProposalContentSchemaPromise) {
    ensureProposalContentSchemaPromise = (async () => {
      await ensureInstitutionalAssetsSchema();
      await query(
        `CREATE TABLE IF NOT EXISTS proposal_content_configs (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          singleton_key VARCHAR(40) NOT NULL,
          status VARCHAR(40) NOT NULL DEFAULT 'active',
          created_by_user_id BIGINT UNSIGNED NULL,
          updated_by_user_id BIGINT UNSIGNED NULL,
          published_at DATETIME(3) NULL,
          published_by_user_id BIGINT UNSIGNED NULL,
          created_at DATETIME(3) NOT NULL,
          updated_at DATETIME(3) NOT NULL,
          CONSTRAINT uq_proposal_content_configs_singleton UNIQUE (singleton_key),
          CONSTRAINT fk_proposal_content_configs_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
          CONSTRAINT fk_proposal_content_configs_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
          CONSTRAINT fk_proposal_content_configs_published_by FOREIGN KEY (published_by_user_id) REFERENCES users(id) ON DELETE SET NULL
        )`,
      );
      await query(
        `CREATE TABLE IF NOT EXISTS proposal_content_components (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          proposal_content_config_id BIGINT UNSIGNED NOT NULL,
          component_code VARCHAR(80) NOT NULL,
          title VARCHAR(190) NOT NULL,
          display_order INT UNSIGNED NOT NULL,
          is_required TINYINT(1) NOT NULL DEFAULT 1,
          status VARCHAR(40) NOT NULL DEFAULT 'active',
          layout_config_json JSON NULL,
          created_at DATETIME(3) NOT NULL,
          updated_at DATETIME(3) NOT NULL,
          CONSTRAINT uq_proposal_content_components UNIQUE (proposal_content_config_id, component_code),
          CONSTRAINT fk_proposal_content_components_config FOREIGN KEY (proposal_content_config_id) REFERENCES proposal_content_configs(id) ON DELETE CASCADE
        )`,
      );
      await query(
        `CREATE TABLE IF NOT EXISTS proposal_content_blocks (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          proposal_content_component_id BIGINT UNSIGNED NOT NULL,
          block_type VARCHAR(40) NOT NULL,
          display_order INT UNSIGNED NOT NULL,
          text_value LONGTEXT NULL,
          asset_id BIGINT UNSIGNED NULL,
          asset_version_id BIGINT UNSIGNED NULL,
          settings_json JSON NULL,
          status VARCHAR(40) NOT NULL DEFAULT 'active',
          created_at DATETIME(3) NOT NULL,
          updated_at DATETIME(3) NOT NULL,
          CONSTRAINT fk_proposal_content_blocks_component FOREIGN KEY (proposal_content_component_id) REFERENCES proposal_content_components(id) ON DELETE CASCADE,
          CONSTRAINT fk_proposal_content_blocks_asset FOREIGN KEY (asset_id) REFERENCES institutional_assets(id) ON DELETE SET NULL,
          CONSTRAINT fk_proposal_content_blocks_asset_version FOREIGN KEY (asset_version_id) REFERENCES institutional_asset_versions(id) ON DELETE SET NULL
        )`,
      );

      await query(
        `INSERT INTO proposal_content_configs
          (singleton_key, status, created_by_user_id, updated_by_user_id, published_at, published_by_user_id, created_at, updated_at)
         SELECT 'default', 'active', NULL, NULL, NOW(3), NULL, NOW(3), NOW(3)
         WHERE NOT EXISTS (
           SELECT 1 FROM proposal_content_configs WHERE singleton_key = 'default'
         )`,
      );

      const configRows = await query(
        `SELECT id
         FROM proposal_content_configs
         WHERE singleton_key = 'default'
         LIMIT 1`,
      );
      const configId = Number(configRows[0]?.id || 0);
      if (configId > 0) {
        for (const component of PROPOSAL_CONTENT_COMPONENT_DEFINITIONS) {
          await query(
            `INSERT INTO proposal_content_components
              (proposal_content_config_id, component_code, title, display_order, is_required, status, created_at, updated_at)
             SELECT ?, ?, ?, ?, 1, 'active', NOW(3), NOW(3)
             WHERE NOT EXISTS (
               SELECT 1
               FROM proposal_content_components
               WHERE proposal_content_config_id = ?
                 AND component_code = ?
             )`,
            [
              configId,
              component.code,
              component.title,
              component.displayOrder,
              configId,
              component.code,
            ],
          );
        }
      }

      await ensureTableColumn(
        "proposal_content_components",
        "layout_config_json",
        "ADD COLUMN layout_config_json JSON NULL AFTER status",
      );
    })().catch((error) => {
      ensureProposalContentSchemaPromise = undefined;
      throw error;
    });
  }

  await ensureProposalContentSchemaPromise;
}

async function ensureProposalContentClonesSchema() {
  if (!ensureProposalContentClonesSchemaPromise) {
    ensureProposalContentClonesSchemaPromise = (async () => {
      await query(
        `CREATE TABLE IF NOT EXISTS proposal_components (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          proposal_id BIGINT UNSIGNED NOT NULL,
          component_code VARCHAR(80) NOT NULL,
          title_snapshot VARCHAR(190) NOT NULL,
          display_order INT UNSIGNED NOT NULL,
          status VARCHAR(40) NOT NULL DEFAULT 'active',
          layout_config_json JSON NULL,
          created_by_user_id BIGINT UNSIGNED NULL,
          updated_by_user_id BIGINT UNSIGNED NULL,
          created_at DATETIME(3) NOT NULL,
          updated_at DATETIME(3) NOT NULL,
          CONSTRAINT uq_proposal_components UNIQUE (proposal_id, component_code),
          CONSTRAINT fk_proposal_components_proposal FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE,
          CONSTRAINT fk_proposal_components_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
          CONSTRAINT fk_proposal_components_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
        )`,
      );
      await query(
        `CREATE TABLE IF NOT EXISTS proposal_blocks (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          proposal_component_id BIGINT UNSIGNED NOT NULL,
          block_type VARCHAR(40) NOT NULL,
          display_order INT UNSIGNED NOT NULL,
          text_value LONGTEXT NULL,
          source_asset_id BIGINT UNSIGNED NULL,
          source_asset_version_id BIGINT UNSIGNED NULL,
          asset_snapshot_json JSON NULL,
          settings_json JSON NULL,
          created_by_user_id BIGINT UNSIGNED NULL,
          updated_by_user_id BIGINT UNSIGNED NULL,
          created_at DATETIME(3) NOT NULL,
          updated_at DATETIME(3) NOT NULL,
          CONSTRAINT fk_proposal_blocks_component FOREIGN KEY (proposal_component_id) REFERENCES proposal_components(id) ON DELETE CASCADE,
          CONSTRAINT fk_proposal_blocks_asset FOREIGN KEY (source_asset_id) REFERENCES institutional_assets(id) ON DELETE SET NULL,
          CONSTRAINT fk_proposal_blocks_asset_version FOREIGN KEY (source_asset_version_id) REFERENCES institutional_asset_versions(id) ON DELETE SET NULL,
          CONSTRAINT fk_proposal_blocks_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
          CONSTRAINT fk_proposal_blocks_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
        )`,
      );

      await ensureTableColumn(
        "proposal_components",
        "layout_config_json",
        "ADD COLUMN layout_config_json JSON NULL AFTER status",
      );
    })().catch((error) => {
      ensureProposalContentClonesSchemaPromise = undefined;
      throw error;
    });
  }

  await ensureProposalContentClonesSchemaPromise;
}

async function getCurrentProposalContentConfigId(executor = query) {
  await ensureProposalContentSchema();
  const rows = await executeQuery(
    executor,
    `SELECT id
     FROM proposal_content_configs
     WHERE singleton_key = 'default'
     LIMIT 1`,
  );
  return Number(rows[0]?.id || 0);
}

async function getInstitutionalAssetVersionRow(
  assetVersionId,
  executor = query,
) {
  await ensureInstitutionalAssetsSchema();
  const rows = await executeQuery(
    executor,
    `SELECT iav.*, ia.name AS asset_name, ia.category AS asset_category
     FROM institutional_asset_versions iav
     INNER JOIN institutional_assets ia ON ia.id = iav.asset_id
     WHERE iav.id = ?
     LIMIT 1`,
    [Number(assetVersionId)],
  );
  return rows[0] || null;
}

export async function listInstitutionalAssets(filters = {}) {
  await ensureInstitutionalAssetsSchema();
  const params = [];
  const where = [];
  if (filters.status) {
    where.push("ia.status = ?");
    params.push(filters.status);
  }
  if (filters.category) {
    where.push("ia.category = ?");
    params.push(filters.category);
  }
  if (filters.search) {
    where.push("(ia.name LIKE ? OR ia.description LIKE ?)");
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }
  const rows = await query(
    `SELECT ia.*, iav.id AS current_version_id, iav.version_number AS current_version_number,
            iav.file_url AS current_file_url, iav.file_name AS current_file_name,
            iav.mime_type AS current_mime_type, iav.file_size_bytes AS current_file_size_bytes,
            iav.width AS current_width, iav.height AS current_height,
            iav.alt_text AS current_alt_text, iav.caption AS current_caption
     FROM institutional_assets ia
     LEFT JOIN institutional_asset_versions iav ON iav.id = ia.current_version_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY ia.updated_at DESC, ia.id DESC`,
    params,
  );

  return rows.map(normalizeInstitutionalAssetRow);
}

export async function getInstitutionalAsset(assetId) {
  await ensureInstitutionalAssetsSchema();
  const assetRows = await query(
    `SELECT ia.*, iav.id AS current_version_id, iav.version_number AS current_version_number,
            iav.file_url AS current_file_url, iav.file_name AS current_file_name,
            iav.mime_type AS current_mime_type, iav.file_size_bytes AS current_file_size_bytes,
            iav.width AS current_width, iav.height AS current_height,
            iav.alt_text AS current_alt_text, iav.caption AS current_caption
     FROM institutional_assets ia
     LEFT JOIN institutional_asset_versions iav ON iav.id = ia.current_version_id
     WHERE ia.id = ?
     LIMIT 1`,
    [Number(assetId)],
  );
  if (!assetRows.length) return null;

  const versionRows = await query(
    `SELECT *
     FROM institutional_asset_versions
     WHERE asset_id = ?
     ORDER BY version_number DESC, id DESC`,
    [Number(assetId)],
  );

  return {
    ...normalizeInstitutionalAssetRow(assetRows[0]),
    versions: versionRows.map(normalizeInstitutionalAssetVersionRow),
  };
}

export async function createInstitutionalAsset(payload, actorUserId) {
  await ensureInstitutionalAssetsSchema();
  const createdAssetId = await withTransaction(async (conn) => {
    const now = new Date();
    const code = slugifyCode(payload.name || payload.code || "asset");
    const assetResult = await executeQuery(
      conn,
      `INSERT INTO institutional_assets
        (code, name, description, category, media_type, status, current_version_id,
         tags_json, created_by_user_id, updated_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'image', ?, NULL, ?, ?, ?, ?, ?)`,
      [
        code,
        asText(payload.name),
        asText(payload.description) || null,
        asText(payload.category) || "generic_proposal_media",
        INSTITUTIONAL_ASSET_STATUSES.includes(payload.status)
          ? payload.status
          : "active",
        JSON.stringify(Array.isArray(payload.tags) ? payload.tags : []),
        actorUserId || null,
        actorUserId || null,
        now,
        now,
      ],
    );

    const assetId = Number(assetResult.insertId);
    const versionResult = await executeQuery(
      conn,
      `INSERT INTO institutional_asset_versions
        (asset_id, version_number, file_url, file_name, mime_type, file_size_bytes,
         width, height, checksum, alt_text, caption, status, created_by_user_id, created_at)
       VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      [
        assetId,
        asText(payload.fileUrl),
        asText(payload.fileName) || null,
        asText(payload.mimeType) || null,
        payload.fileSizeBytes == null ? null : Number(payload.fileSizeBytes),
        payload.width == null ? null : Number(payload.width),
        payload.height == null ? null : Number(payload.height),
        asText(payload.checksum) || null,
        asText(payload.altText) || null,
        asText(payload.caption) || null,
        actorUserId || null,
        now,
      ],
    );

    await executeQuery(
      conn,
      `UPDATE institutional_assets
       SET current_version_id = ?, updated_at = ?, updated_by_user_id = ?
       WHERE id = ?`,
      [Number(versionResult.insertId), now, actorUserId || null, assetId],
    );

    return assetId;
  });
  return getInstitutionalAsset(createdAssetId);
}

export async function addInstitutionalAssetVersion(
  assetId,
  payload,
  actorUserId,
) {
  await ensureInstitutionalAssetsSchema();
  const committedAssetId = await withTransaction(async (conn) => {
    const rows = await executeQuery(
      conn,
      `SELECT id, status
       FROM institutional_assets
       WHERE id = ?
       LIMIT 1`,
      [Number(assetId)],
    );
    if (!rows.length) {
      return null;
    }
    const versionRows = await executeQuery(
      conn,
      `SELECT COALESCE(MAX(version_number), 0) AS max_version
       FROM institutional_asset_versions
       WHERE asset_id = ?`,
      [Number(assetId)],
    );
    const nextVersionNumber = Number(versionRows[0]?.max_version || 0) + 1;
    const now = new Date();
    const versionResult = await executeQuery(
      conn,
      `INSERT INTO institutional_asset_versions
        (asset_id, version_number, file_url, file_name, mime_type, file_size_bytes,
         width, height, checksum, alt_text, caption, status, created_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      [
        Number(assetId),
        nextVersionNumber,
        asText(payload.fileUrl),
        asText(payload.fileName) || null,
        asText(payload.mimeType) || null,
        payload.fileSizeBytes == null ? null : Number(payload.fileSizeBytes),
        payload.width == null ? null : Number(payload.width),
        payload.height == null ? null : Number(payload.height),
        asText(payload.checksum) || null,
        asText(payload.altText) || null,
        asText(payload.caption) || null,
        actorUserId || null,
        now,
      ],
    );

    await executeQuery(
      conn,
      `UPDATE institutional_assets
       SET current_version_id = ?, status = 'active', updated_by_user_id = ?, updated_at = ?
       WHERE id = ?`,
      [
        Number(versionResult.insertId),
        actorUserId || null,
        now,
        Number(assetId),
      ],
    );

    return Number(assetId);
  });
  if (!committedAssetId) return null;
  return getInstitutionalAsset(committedAssetId);
}

export async function archiveInstitutionalAsset(assetId, actorUserId) {
  await ensureInstitutionalAssetsSchema();
  const now = new Date();
  await query(
    `UPDATE institutional_assets
     SET status = 'archived', updated_by_user_id = ?, updated_at = ?
     WHERE id = ?`,
    [actorUserId || null, now, Number(assetId)],
  );
  return getInstitutionalAsset(assetId);
}

export async function getProposalContentConfiguration() {
  await ensureProposalContentSchema();
  await ensureInstitutionalAssetsSchema();
  const configRows = await query(
    `SELECT *
     FROM proposal_content_configs
     WHERE singleton_key = 'default'
     LIMIT 1`,
  );
  const config = configRows[0] || null;
  if (!config) return null;

  const componentRows = await query(
    `SELECT id, component_code, title, display_order, status, layout_config_json
     FROM proposal_content_components
     WHERE proposal_content_config_id = ?
     ORDER BY display_order ASC, id ASC`,
    [Number(config.id)],
  );

  const blockRows = await query(
    `SELECT pcb.id, pcb.proposal_content_component_id AS component_id,
            pcb.block_type, pcb.display_order, pcb.text_value, pcb.settings_json,
            pcb.asset_id, pcb.asset_version_id,
            iav.version_number AS asset_version_number,
            iav.file_url AS asset_file_url,
            iav.file_name AS asset_file_name,
            iav.mime_type AS asset_mime_type,
            iav.file_size_bytes AS asset_file_size_bytes,
            iav.width AS asset_width,
            iav.height AS asset_height,
            iav.checksum AS asset_checksum,
            iav.alt_text AS asset_alt_text,
            iav.caption AS asset_caption,
            ia.name AS asset_name,
            ia.category AS asset_category
     FROM proposal_content_blocks pcb
     LEFT JOIN institutional_assets ia ON ia.id = pcb.asset_id
     LEFT JOIN institutional_asset_versions iav ON iav.id = pcb.asset_version_id
     WHERE pcb.proposal_content_component_id IN (
       SELECT id
       FROM proposal_content_components
       WHERE proposal_content_config_id = ?
     )
     ORDER BY pcb.display_order ASC, pcb.id ASC`,
    [Number(config.id)],
  );

  return {
    id: Number(config.id),
    status: asText(config.status) || "active",
    publishedAt: config.published_at || null,
    updatedAt: config.updated_at || null,
    components: normalizeProposalComponentRows(componentRows, blockRows),
  };
}

export async function saveProposalContentComponent({
  componentCode,
  title,
  layoutConfig,
  blocks,
  actorUserId,
}) {
  await ensureProposalContentSchema();
  await ensureInstitutionalAssetsSchema();
  const definition = getProposalComponentDefinition(componentCode);
  if (!definition) {
    throw new Error("Componente de propuesta no soportado");
  }

  await withTransaction(async (conn) => {
    const configId = await getCurrentProposalContentConfigId(conn);
    const componentRows = await executeQuery(
      conn,
      `SELECT id
       FROM proposal_content_components
       WHERE proposal_content_config_id = ?
         AND component_code = ?
       LIMIT 1`,
      [configId, componentCode],
    );
    const componentId = Number(componentRows[0]?.id || 0);
    const now = new Date();
    if (layoutConfig === undefined) {
      await executeQuery(
        conn,
        `UPDATE proposal_content_components
         SET title = ?, updated_at = ?
         WHERE id = ?`,
        [asText(title) || definition.title, now, componentId],
      );
    } else {
      await executeQuery(
        conn,
        `UPDATE proposal_content_components
         SET title = ?, layout_config_json = ?, updated_at = ?
         WHERE id = ?`,
        [
          asText(title) || definition.title,
          layoutConfig === null ? null : JSON.stringify(layoutConfig),
          now,
          componentId,
        ],
      );
    }

    await executeQuery(
      conn,
      `DELETE FROM proposal_content_blocks
       WHERE proposal_content_component_id = ?`,
      [componentId],
    );

    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      const settings =
        block.type === "list"
          ? { items: Array.isArray(block.items) ? block.items : [] }
          : {};

      await executeQuery(
        conn,
        `INSERT INTO proposal_content_blocks
          (proposal_content_component_id, block_type, display_order, text_value,
           asset_id, asset_version_id, settings_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
        [
          componentId,
          block.type,
          index + 1,
          asText(block.text) || null,
          block.assetId ? Number(block.assetId) : null,
          block.assetVersionId ? Number(block.assetVersionId) : null,
          JSON.stringify(settings),
          now,
          now,
        ],
      );
    }

    await executeQuery(
      conn,
      `UPDATE proposal_content_configs
       SET updated_at = ?, updated_by_user_id = ?
       WHERE id = ?`,
      [now, actorUserId || null, configId],
    );
  });
  return getProposalContentConfiguration();
}

export async function publishProposalContentConfiguration(actorUserId) {
  await ensureProposalContentSchema();
  const configId = await getCurrentProposalContentConfigId();
  const now = new Date();
  await query(
    `UPDATE proposal_content_configs
     SET status = 'active', published_at = ?, published_by_user_id = ?, updated_at = ?, updated_by_user_id = ?
     WHERE id = ?`,
    [now, actorUserId || null, now, actorUserId || null, configId],
  );
  return getProposalContentConfiguration();
}

export async function listProposalComponents(proposalId) {
  await ensureProposalContentClonesSchema();
  await ensureInstitutionalAssetsSchema();
  const componentRows = await query(
    `SELECT id, component_code, title_snapshot AS title, display_order, status, layout_config_json
     FROM proposal_components
     WHERE proposal_id = ?
     ORDER BY display_order ASC, id ASC`,
    [Number(proposalId)],
  );
  if (!componentRows.length) return [];

  const blockRows = await query(
    `SELECT pb.id, pb.proposal_component_id AS component_id, pb.block_type,
            pb.display_order, pb.text_value, pb.settings_json, pb.asset_snapshot_json,
            pb.source_asset_id AS asset_id, pb.source_asset_version_id AS asset_version_id,
            iav.version_number AS asset_version_number,
            iav.file_url AS asset_file_url,
            iav.file_name AS asset_file_name,
            iav.mime_type AS asset_mime_type,
            iav.file_size_bytes AS asset_file_size_bytes,
            iav.width AS asset_width,
            iav.height AS asset_height,
            iav.checksum AS asset_checksum,
            iav.alt_text AS asset_alt_text,
            iav.caption AS asset_caption,
            ia.name AS asset_name,
            ia.category AS asset_category
     FROM proposal_blocks pb
     LEFT JOIN institutional_assets ia ON ia.id = pb.source_asset_id
     LEFT JOIN institutional_asset_versions iav ON iav.id = pb.source_asset_version_id
     WHERE pb.proposal_component_id IN (
       SELECT id FROM proposal_components WHERE proposal_id = ?
     )
     ORDER BY pb.display_order ASC, pb.id ASC`,
    [Number(proposalId)],
  );

  return normalizeProposalComponentRows(componentRows, blockRows);
}

async function resolveSourceComponentRows({
  sourceProposalId = null,
  executor = query,
}) {
  if (sourceProposalId) {
    const componentRows = await executeQuery(
      executor,
      `SELECT id, component_code, title_snapshot AS title, display_order, status, layout_config_json
       FROM proposal_components
       WHERE proposal_id = ?
       ORDER BY display_order ASC, id ASC`,
      [Number(sourceProposalId)],
    );
    const blockRows = componentRows.length
      ? await executeQuery(
          executor,
          `SELECT id, proposal_component_id AS component_id, block_type, display_order,
                  text_value, source_asset_id AS asset_id,
                  source_asset_version_id AS asset_version_id, asset_snapshot_json,
                  settings_json
           FROM proposal_blocks
           WHERE proposal_component_id IN (${componentRows.map(() => "?").join(", ")})
           ORDER BY display_order ASC, id ASC`,
          componentRows.map((row) => Number(row.id)),
        )
      : [];
    return normalizeProposalComponentRows(componentRows, blockRows);
  }

  const configId = await getCurrentProposalContentConfigId(executor);
  const componentRows = await executeQuery(
    executor,
    `SELECT id, component_code, title, display_order, status, layout_config_json
     FROM proposal_content_components
     WHERE proposal_content_config_id = ?
     ORDER BY display_order ASC, id ASC`,
    [configId],
  );
  const blockRows = componentRows.length
    ? await executeQuery(
        executor,
        `SELECT pcb.id, pcb.proposal_content_component_id AS component_id,
                pcb.block_type, pcb.display_order, pcb.text_value, pcb.settings_json,
                pcb.asset_id, pcb.asset_version_id,
                iav.version_number AS asset_version_number,
                iav.file_url AS asset_file_url,
                iav.file_name AS asset_file_name,
                iav.mime_type AS asset_mime_type,
                iav.file_size_bytes AS asset_file_size_bytes,
                iav.width AS asset_width,
                iav.height AS asset_height,
                iav.checksum AS asset_checksum,
                iav.alt_text AS asset_alt_text,
                iav.caption AS asset_caption,
                ia.name AS asset_name,
                ia.category AS asset_category
         FROM proposal_content_blocks pcb
         LEFT JOIN institutional_assets ia ON ia.id = pcb.asset_id
         LEFT JOIN institutional_asset_versions iav ON iav.id = pcb.asset_version_id
         WHERE pcb.proposal_content_component_id IN (${componentRows
           .map(() => "?")
           .join(", ")})
         ORDER BY pcb.display_order ASC, pcb.id ASC`,
        componentRows.map((row) => Number(row.id)),
      )
    : [];
  return normalizeProposalComponentRows(componentRows, blockRows);
}

export async function cloneProposalComponents({
  proposalId,
  actorUserId,
  sourceProposalId = null,
  executor = query,
}) {
  await ensureProposalContentSchema();
  await ensureProposalContentClonesSchema();
  const sourceComponents = await resolveSourceComponentRows({
    sourceProposalId,
    executor,
  });
  const now = new Date();

  await executeQuery(
    executor,
    `DELETE pb
     FROM proposal_blocks pb
     INNER JOIN proposal_components pc ON pc.id = pb.proposal_component_id
     WHERE pc.proposal_id = ?`,
    [Number(proposalId)],
  );
  await executeQuery(
    executor,
    `DELETE FROM proposal_components
     WHERE proposal_id = ?`,
    [Number(proposalId)],
  );

  for (const component of sourceComponents) {
    const componentResult = await executeQuery(
      executor,
      `INSERT INTO proposal_components
        (proposal_id, component_code, title_snapshot, display_order, status,
         layout_config_json, created_by_user_id, updated_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(proposalId),
        component.componentCode,
        component.title,
        Number(component.displayOrder || 0),
        component.status || "active",
        component.layoutConfig ? JSON.stringify(component.layoutConfig) : null,
        actorUserId || null,
        actorUserId || null,
        now,
        now,
      ],
    );
    const proposalComponentId = Number(componentResult.insertId);

    for (let index = 0; index < component.blocks.length; index += 1) {
      const block = component.blocks[index];
      const settings =
        block.type === "list"
          ? { items: Array.isArray(block.items) ? block.items : [] }
          : {};
      const snapshot =
        block.type === "image" && block.image
          ? JSON.stringify(block.image)
          : null;
      await executeQuery(
        executor,
        `INSERT INTO proposal_blocks
          (proposal_component_id, block_type, display_order, text_value,
           source_asset_id, source_asset_version_id, asset_snapshot_json, settings_json,
           created_by_user_id, updated_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          proposalComponentId,
          block.type,
          index + 1,
          asText(block.text) || null,
          block.assetId ? Number(block.assetId) : null,
          block.assetVersionId ? Number(block.assetVersionId) : null,
          snapshot,
          JSON.stringify(settings),
          actorUserId || null,
          actorUserId || null,
          now,
          now,
        ],
      );
    }
  }

  return listProposalComponents(proposalId);
}

export async function saveProposalComponentBlocks({
  proposalId,
  componentCode,
  title,
  blocks,
  actorUserId,
}) {
  await ensureProposalContentClonesSchema();
  await ensureInstitutionalAssetsSchema();
  const definition = getProposalComponentDefinition(componentCode);
  if (!definition) {
    throw new Error("Componente de propuesta no soportado");
  }

  return withTransaction(async (conn) => {
    const now = new Date();
    const rows = await executeQuery(
      conn,
      `SELECT id
       FROM proposal_components
       WHERE proposal_id = ? AND component_code = ?
       LIMIT 1`,
      [Number(proposalId), componentCode],
    );

    let proposalComponentId = Number(rows[0]?.id || 0);
    if (!proposalComponentId) {
      const insertResult = await executeQuery(
        conn,
        `INSERT INTO proposal_components
          (proposal_id, component_code, title_snapshot, display_order, status,
           layout_config_json, created_by_user_id, updated_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', NULL, ?, ?, ?, ?)`,
        [
          Number(proposalId),
          componentCode,
          asText(title) || definition.title,
          Number(definition.displayOrder || 0),
          actorUserId || null,
          actorUserId || null,
          now,
          now,
        ],
      );
      proposalComponentId = Number(insertResult.insertId);
    } else {
      await executeQuery(
        conn,
        `UPDATE proposal_components
         SET title_snapshot = ?, updated_at = ?, updated_by_user_id = ?
         WHERE id = ?`,
        [
          asText(title) || definition.title,
          now,
          actorUserId || null,
          proposalComponentId,
        ],
      );
      await executeQuery(
        conn,
        `DELETE FROM proposal_blocks
         WHERE proposal_component_id = ?`,
        [proposalComponentId],
      );
    }

    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      const settings =
        block.type === "list"
          ? { items: Array.isArray(block.items) ? block.items : [] }
          : {};
      let snapshot = null;
      if (block.type === "image" && block.assetVersionId) {
        const versionRow = await getInstitutionalAssetVersionRow(
          Number(block.assetVersionId),
          conn,
        );
        snapshot = versionRow
          ? buildInstitutionalAssetSnapshot(versionRow)
          : null;
      }

      await executeQuery(
        conn,
        `INSERT INTO proposal_blocks
          (proposal_component_id, block_type, display_order, text_value,
           source_asset_id, source_asset_version_id, asset_snapshot_json, settings_json,
           created_by_user_id, updated_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          proposalComponentId,
          block.type,
          index + 1,
          asText(block.text) || null,
          block.assetId ? Number(block.assetId) : null,
          block.assetVersionId ? Number(block.assetVersionId) : null,
          snapshot ? JSON.stringify(snapshot) : null,
          JSON.stringify(settings),
          actorUserId || null,
          actorUserId || null,
          now,
          now,
        ],
      );
    }

    return listProposalComponents(proposalId);
  });
}

export async function replaceProposalComponentImage({
  proposalId,
  componentCode,
  blockId,
  assetId,
  assetVersionId,
  actorUserId,
}) {
  await ensureProposalContentClonesSchema();
  await ensureInstitutionalAssetsSchema();
  const versionRow = await getInstitutionalAssetVersionRow(assetVersionId);
  if (!versionRow || Number(versionRow.asset_id) !== Number(assetId)) {
    return null;
  }

  const snapshot = buildInstitutionalAssetSnapshot(versionRow);
  const now = new Date();
  await query(
    `UPDATE proposal_blocks pb
     INNER JOIN proposal_components pc ON pc.id = pb.proposal_component_id
     SET pb.source_asset_id = ?,
         pb.source_asset_version_id = ?,
         pb.asset_snapshot_json = ?,
         pb.updated_by_user_id = ?,
         pb.updated_at = ?,
         pc.updated_by_user_id = ?,
         pc.updated_at = ?
     WHERE pb.id = ?
       AND pc.proposal_id = ?
       AND pc.component_code = ?`,
    [
      Number(assetId),
      Number(assetVersionId),
      JSON.stringify(snapshot),
      actorUserId || null,
      now,
      actorUserId || null,
      now,
      Number(blockId),
      Number(proposalId),
      componentCode,
    ],
  );

  return listProposalComponents(proposalId);
}

function asText(value) {
  return String(value || "").trim();
}

function buildFallbackCompanyProfile() {
  const defaultCompany = config.documents.quotation.company;
  const addressLines = Array.isArray(defaultCompany.addressLines)
    ? defaultCompany.addressLines.filter(Boolean)
    : [];

  return {
    id: null,
    singletonKey: "default",
    legalName: asText(defaultCompany.legalName),
    commercialName: "",
    taxId: asText(defaultCompany.taxId),
    logoUrl: asText(defaultCompany.logoPath),
    addressLine1: asText(addressLines[0]),
    addressLine2: asText(addressLines[1]),
    city: "",
    stateRegion: "",
    countryId: null,
    countryCode: "",
    countryName: "",
    postalCode: "",
    email: asText(defaultCompany.email),
    phone: asText(defaultCompany.phone),
    website: "",
    description: "",
    createdAt: null,
    updatedAt: null,
    createdByUserId: null,
    createdByUserName: "",
    updatedByUserId: null,
    updatedByUserName: "",
  };
}

function normalizeCompanyProfileRow(row) {
  if (!row) {
    return buildFallbackCompanyProfile();
  }

  return {
    id: Number(row.id),
    singletonKey: row.singleton_key,
    legalName: asText(row.legal_name),
    commercialName: asText(row.commercial_name),
    taxId: asText(row.tax_id),
    logoUrl: asText(row.logo_url),
    addressLine1: asText(row.address_line1),
    addressLine2: asText(row.address_line2),
    city: asText(row.city),
    stateRegion: asText(row.state_region),
    countryId: row.country_id ? Number(row.country_id) : null,
    countryCode: asText(row.country_code),
    countryName: asText(row.country_name),
    postalCode: asText(row.postal_code),
    email: asText(row.email),
    phone: asText(row.phone),
    website: asText(row.website),
    description: asText(row.description),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    createdByUserId: row.created_by_user_id
      ? Number(row.created_by_user_id)
      : null,
    createdByUserName: asText(row.created_by_user_name),
    updatedByUserId: row.updated_by_user_id
      ? Number(row.updated_by_user_id)
      : null,
    updatedByUserName: asText(row.updated_by_user_name),
  };
}

function buildFallbackTemporaryFeatureSettings() {
  return {
    id: null,
    singletonKey: "default",
    accountsPendingEnabled: false,
    contactsPendingEnabled: false,
    opportunitiesPendingEnabled: false,
    createdAt: null,
    updatedAt: null,
    createdByUserId: null,
    updatedByUserId: null,
    createdByUserName: "",
    updatedByUserName: "",
  };
}

function normalizeTemporaryFeatureSettingsRow(row) {
  if (!row) {
    return buildFallbackTemporaryFeatureSettings();
  }

  return {
    id: Number(row.id),
    singletonKey: asText(row.singleton_key),
    accountsPendingEnabled: Boolean(row.accounts_pending_enabled),
    contactsPendingEnabled: Boolean(row.contacts_pending_enabled),
    opportunitiesPendingEnabled: Boolean(row.opportunities_pending_enabled),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    createdByUserId: row.created_by_user_id
      ? Number(row.created_by_user_id)
      : null,
    updatedByUserId: row.updated_by_user_id
      ? Number(row.updated_by_user_id)
      : null,
    createdByUserName: asText(row.created_by_user_name),
    updatedByUserName: asText(row.updated_by_user_name),
  };
}

async function ensureCompanyProfileTable() {
  if (!ensureCompanyProfileTablePromise) {
    ensureCompanyProfileTablePromise = query(
      `CREATE TABLE IF NOT EXISTS company_profile (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        singleton_key VARCHAR(40) NOT NULL,
        legal_name VARCHAR(190) NOT NULL,
        commercial_name VARCHAR(190) NULL,
        tax_id VARCHAR(120) NOT NULL,
        logo_url LONGTEXT NULL,
        address_line1 VARCHAR(255) NOT NULL,
        address_line2 VARCHAR(255) NULL,
        city VARCHAR(120) NOT NULL,
        state_region VARCHAR(120) NOT NULL,
        country_id BIGINT UNSIGNED NOT NULL,
        postal_code VARCHAR(20) NOT NULL,
        email VARCHAR(190) NULL,
        phone VARCHAR(40) NULL,
        website VARCHAR(300) NULL,
        description TEXT NULL,
        created_by_user_id BIGINT UNSIGNED NULL,
        updated_by_user_id BIGINT UNSIGNED NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        CONSTRAINT uq_company_profile_singleton UNIQUE (singleton_key),
        CONSTRAINT fk_company_profile_country FOREIGN KEY (country_id) REFERENCES countries(id),
        CONSTRAINT fk_company_profile_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_company_profile_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      )`,
    ).catch((error) => {
      ensureCompanyProfileTablePromise = undefined;
      throw error;
    });
  }

  await ensureCompanyProfileTablePromise;
}

async function ensureTemporaryFeatureSettingsTable() {
  if (!ensureTemporaryFeatureSettingsTablePromise) {
    ensureTemporaryFeatureSettingsTablePromise = query(
      `CREATE TABLE IF NOT EXISTS temporary_feature_settings (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        singleton_key VARCHAR(40) NOT NULL,
        accounts_pending_enabled TINYINT(1) NOT NULL DEFAULT 0,
        contacts_pending_enabled TINYINT(1) NOT NULL DEFAULT 0,
        opportunities_pending_enabled TINYINT(1) NOT NULL DEFAULT 0,
        created_by_user_id BIGINT UNSIGNED NULL,
        updated_by_user_id BIGINT UNSIGNED NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        CONSTRAINT uq_temporary_feature_settings_singleton UNIQUE (singleton_key),
        CONSTRAINT fk_temporary_feature_settings_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_temporary_feature_settings_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      )`,
    ).catch((error) => {
      ensureTemporaryFeatureSettingsTablePromise = undefined;
      throw error;
    });
  }

  await ensureTemporaryFeatureSettingsTablePromise;
}

async function ensureDefaultCompanyProfile() {
  await ensureCompanyProfileTable();

  const countryRows = await query(
    `SELECT id
     FROM countries
     WHERE iso2 = 'MX'
     ORDER BY id
     LIMIT 1`,
  );
  const countryId = countryRows[0]?.id;
  if (!countryId) {
    return null;
  }

  await query(
    `INSERT INTO company_profile
      (singleton_key, legal_name, commercial_name, tax_id, logo_url,
       address_line1, address_line2, city, state_region, country_id,
       postal_code, email, phone, website, description,
       created_by_user_id, updated_by_user_id, created_at, updated_at)
     VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NOW(3), NOW(3))`,
    [
      "Access Quality S.A. de C.V.",
      "Access Quality",
      "RFC: AQU110118AV2",
      null,
      "Montecito #38, Piso 7, Oficina 1, WTC, Col. Napoles",
      "",
      "Ciudad de Mexico",
      "CDMX",
      Number(countryId),
      "03810",
      "",
      "",
      "",
      "Configuracion institucional inicial",
    ],
  );

  return countryId;
}

async function ensureDefaultTemporaryFeatureSettings() {
  await ensureTemporaryFeatureSettingsTable();
  await query(
    `INSERT INTO temporary_feature_settings
      (singleton_key, accounts_pending_enabled, contacts_pending_enabled,
       opportunities_pending_enabled, created_by_user_id, updated_by_user_id,
       created_at, updated_at)
     SELECT 'default', 0, 0, 0, NULL, NULL, NOW(3), NOW(3)
     WHERE NOT EXISTS (
       SELECT 1
       FROM temporary_feature_settings tfs
       WHERE tfs.singleton_key = 'default'
     )`,
  );
}

function buildAddressLines(profile) {
  const lines = [];
  if (profile.addressLine1) lines.push(profile.addressLine1);
  if (profile.addressLine2) lines.push(profile.addressLine2);

  const locality = [profile.city, profile.stateRegion]
    .filter(Boolean)
    .join(", ");
  const localityWithPostal = [
    locality,
    profile.postalCode ? `CP ${profile.postalCode}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  if (localityWithPostal) lines.push(localityWithPostal);
  if (profile.countryName) lines.push(profile.countryName);
  return lines;
}

export async function getCompanyProfile() {
  await ensureCompanyProfileTable();

  const selectProfile = () =>
    query(
      `SELECT cp.*, c.iso2 AS country_code, c.name AS country_name,
              uc.full_name AS created_by_user_name,
              uu.full_name AS updated_by_user_name
       FROM company_profile cp
       INNER JOIN countries c ON c.id = cp.country_id
       LEFT JOIN users uc ON uc.id = cp.created_by_user_id
       LEFT JOIN users uu ON uu.id = cp.updated_by_user_id
       WHERE cp.singleton_key = 'default'
       LIMIT 1`,
    );

  let rows = await selectProfile();
  if (!rows.length) {
    await ensureDefaultCompanyProfile();
    rows = await selectProfile();
  }

  return normalizeCompanyProfileRow(rows[0] || null);
}

export async function getTemporaryFeatureSettings() {
  await ensureTemporaryFeatureSettingsTable();

  const selectSettings = () =>
    query(
      `SELECT tfs.*, uc.full_name AS created_by_user_name,
              uu.full_name AS updated_by_user_name
       FROM temporary_feature_settings tfs
       LEFT JOIN users uc ON uc.id = tfs.created_by_user_id
       LEFT JOIN users uu ON uu.id = tfs.updated_by_user_id
       WHERE tfs.singleton_key = 'default'
       LIMIT 1`,
    );

  let rows = await selectSettings();
  if (!rows.length) {
    await ensureDefaultTemporaryFeatureSettings();
    rows = await selectSettings();
  }

  return normalizeTemporaryFeatureSettingsRow(rows[0] || null);
}

export async function saveTemporaryFeatureSettings(settings, actorUserId) {
  const current = await getTemporaryFeatureSettings();
  const existingId = current.id ? Number(current.id) : null;
  const now = new Date();
  const payload = {
    accountsPendingEnabled: settings.accountsPendingEnabled ? 1 : 0,
    contactsPendingEnabled: settings.contactsPendingEnabled ? 1 : 0,
    opportunitiesPendingEnabled: settings.opportunitiesPendingEnabled ? 1 : 0,
  };

  if (existingId) {
    await query(
      `UPDATE temporary_feature_settings
       SET accounts_pending_enabled = ?, contacts_pending_enabled = ?,
           opportunities_pending_enabled = ?, updated_by_user_id = ?, updated_at = ?
       WHERE id = ?`,
      [
        payload.accountsPendingEnabled,
        payload.contactsPendingEnabled,
        payload.opportunitiesPendingEnabled,
        actorUserId || null,
        now,
        existingId,
      ],
    );
  } else {
    await query(
      `INSERT INTO temporary_feature_settings
        (singleton_key, accounts_pending_enabled, contacts_pending_enabled,
         opportunities_pending_enabled, created_by_user_id, updated_by_user_id,
         created_at, updated_at)
       VALUES ('default', ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.accountsPendingEnabled,
        payload.contactsPendingEnabled,
        payload.opportunitiesPendingEnabled,
        actorUserId || null,
        actorUserId || null,
        now,
        now,
      ],
    );
  }

  return getTemporaryFeatureSettings();
}

export function buildCompanyDocumentBranding(profile) {
  const safeProfile = profile || buildFallbackCompanyProfile();
  return {
    logoUrl: asText(safeProfile.logoUrl),
    legalName: asText(safeProfile.legalName),
    commercialName: asText(safeProfile.commercialName),
    taxId: asText(safeProfile.taxId),
    addressLines: buildAddressLines(safeProfile),
    email: asText(safeProfile.email),
    phone: asText(safeProfile.phone),
  };
}

export async function getCompanyDocumentBranding() {
  return buildCompanyDocumentBranding(await getCompanyProfile());
}
