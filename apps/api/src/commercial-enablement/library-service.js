import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { query, withTransaction } from "../db.js";
import { ensureCommercialEnablementSchema } from "./schema.js";
import {
  cleanupTempFiles,
  parseMultipartFiles,
} from "../opportunity-documents/service.js";
import { createDocumentStorage } from "../opportunity-documents/storage.js";

const storage = createDocumentStorage();

const storageKeyPrefix = "commercial_enablement";

let ensureCommercialEnablementStarterDataPromise;

const MANAGE_PERMISSION_CODES = new Set([
  "enablement_comercial.manage",
  "enablement_comercial.admin",
]);
const UPLOAD_PERMISSION_CODES = new Set([
  "enablement_comercial.upload",
  "enablement_comercial.manage",
  "enablement_comercial.admin",
  "enablement_comercial.update",
]);
const USE_PERMISSION_CODES = new Set([
  "enablement_comercial.use",
  "enablement_comercial.upload",
  "enablement_comercial.manage",
  "enablement_comercial.admin",
  "enablement_comercial.read",
  "enablement_comercial.update",
  "enablement_comercial.analytics",
]);

const STATIC_CATALOG_SEEDS = {
  asset_type: [
    {
      code: "presentation",
      name: "Presentacion",
      description: "Material para exponer o presentar al cliente",
      sortOrder: 10,
    },
    {
      code: "infographic",
      name: "Infografia",
      description:
        "Resumen visual para comunicar hallazgos, beneficios o cifras clave",
      sortOrder: 15,
    },
    {
      code: "case_study",
      name: "Caso de exito",
      description: "Historia o prueba de valor para el cliente",
      sortOrder: 20,
    },
    {
      code: "battlecard",
      name: "Comparativo competitivo",
      description: "Material para preparacion o comparacion contra competencia",
      sortOrder: 30,
    },
    {
      code: "solution_brief",
      name: "Ficha de solucion",
      description: "Resumen comercial de una solucion u oferta",
      sortOrder: 40,
    },
    {
      code: "manufacturer_brief",
      name: "Ficha de fabricante",
      description: "Resumen comercial por fabricante o marca",
      sortOrder: 50,
    },
    {
      code: "internal_playbook",
      name: "Guia interna",
      description: "Material de uso interno para vendedor o equipo",
      sortOrder: 60,
    },
    {
      code: "customer_document",
      name: "Documento para cliente",
      description: "Documento directamente compartible con cliente",
      sortOrder: 70,
    },
    {
      code: "template",
      name: "Plantilla",
      description: "Plantilla reusable para presentacion o comunicacion",
      sortOrder: 80,
    },
    {
      code: "reference_url",
      name: "Referencia URL",
      description: "Enlace interno o externo como fuente de consulta",
      sortOrder: 90,
    },
  ],
  manufacturer: [
    {
      code: "cisco",
      name: "Cisco",
      description: "Networking, seguridad y colaboracion",
      sortOrder: 10,
    },
    {
      code: "fortinet",
      name: "Fortinet",
      description: "Seguridad perimetral, SD-WAN y proteccion de red",
      sortOrder: 20,
    },
    {
      code: "hpe_aruba",
      name: "HPE Aruba",
      description: "Red empresarial, wireless y acceso seguro",
      sortOrder: 30,
    },
    {
      code: "dell_technologies",
      name: "Dell Technologies",
      description: "Infraestructura, almacenamiento y data center",
      sortOrder: 40,
    },
    {
      code: "microsoft",
      name: "Microsoft",
      description: "Cloud, productividad y seguridad",
      sortOrder: 50,
    },
    {
      code: "lenovo",
      name: "Lenovo",
      description: "Endpoints, servidores y soluciones de infraestructura",
      sortOrder: 60,
    },
  ],
  audience: [
    { code: "client", name: "Cliente", sortOrder: 10 },
    { code: "seller", name: "Vendedor", sortOrder: 20 },
    { code: "presales", name: "Preventa", sortOrder: 30 },
    { code: "manager", name: "Gerencia", sortOrder: 40 },
    { code: "mixed", name: "Mixto", sortOrder: 50 },
  ],
  visibility: [
    {
      code: "client_safe",
      name: "Compartible con cliente",
      description: "Puede enviarse directamente al cliente",
      sortOrder: 10,
    },
    {
      code: "internal_sales",
      name: "Interno comercial",
      description: "Uso interno del equipo comercial",
      sortOrder: 20,
    },
    {
      code: "internal_company",
      name: "Interno empresa",
      description: "Uso interno ampliado para equipo y liderazgo",
      sortOrder: 30,
    },
    {
      code: "restricted",
      name: "Restringido",
      description: "Contenido sensible o reservado",
      sortOrder: 40,
    },
  ],
  language: [
    { code: "es", name: "Espanol", sortOrder: 10 },
    { code: "en", name: "Ingles", sortOrder: 20 },
  ],
};

const LEGACY_KIND_TO_TYPE = {
  case_study: "case_study",
  battlecard: "battlecard",
  one_pager: "customer_document",
  objection_guide: "internal_playbook",
  discovery_guide: "internal_playbook",
  industry_questions: "internal_playbook",
  value_message: "solution_brief",
  meeting_template: "template",
  minutes_template: "template",
  follow_up_template: "template",
  executive_recap_template: "template",
  technical_request_template: "template",
  solution_guide: "solution_brief",
  manager_guide: "internal_playbook",
  presales_guide: "internal_playbook",
};

const LEGACY_KIND_TO_VISIBILITY = {
  case_study: "client_safe",
  battlecard: "internal_sales",
  one_pager: "client_safe",
  objection_guide: "internal_sales",
  discovery_guide: "internal_sales",
  industry_questions: "internal_sales",
  value_message: "client_safe",
  meeting_template: "internal_sales",
  minutes_template: "internal_sales",
  follow_up_template: "client_safe",
  executive_recap_template: "client_safe",
  technical_request_template: "internal_company",
  solution_guide: "internal_sales",
  manager_guide: "restricted",
  presales_guide: "internal_company",
};

const LEGACY_KIND_TO_AUDIENCE = {
  case_study: "client",
  battlecard: "seller",
  one_pager: "client",
  objection_guide: "seller",
  discovery_guide: "seller",
  industry_questions: "seller",
  value_message: "mixed",
  meeting_template: "seller",
  minutes_template: "seller",
  follow_up_template: "mixed",
  executive_recap_template: "mixed",
  technical_request_template: "presales",
  solution_guide: "mixed",
  manager_guide: "manager",
  presales_guide: "presales",
};

const COLLECTION_SHAREABLE_VISIBILITIES = new Set(["client_safe"]);

async function execSql(executor, sql, params = []) {
  const result = await executor.query(sql, params);
  return Array.isArray(result) && result.length === 2 ? result[0] : result;
}

function buildPublicId(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleizeCode(value) {
  const text = String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function boolToTinyInt(value) {
  return value ? 1 : 0;
}

function uniqueStrings(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

function parseCsvArray(value) {
  if (Array.isArray(value)) return uniqueStrings(value);
  return uniqueStrings(
    String(value || "")
      .split(",")
      .map((part) => part.trim()),
  );
}

function getPermissionSet(user) {
  return user?.permissionSet || new Set(user?.permissions || []);
}

function userHasAnyPermission(user, permissions) {
  const permissionSet = getPermissionSet(user);
  return permissions.some((permission) => permissionSet.has(permission));
}

function canUseEnablement(user) {
  return userHasAnyPermission(user, Array.from(USE_PERMISSION_CODES));
}

function canUploadEnablement(user) {
  return userHasAnyPermission(user, Array.from(UPLOAD_PERMISSION_CODES));
}

function canManageEnablement(user) {
  return userHasAnyPermission(user, Array.from(MANAGE_PERMISSION_CODES));
}

function canAdminEnablement(user) {
  return userHasAnyPermission(user, ["enablement_comercial.admin"]);
}

function getAllowedVisibilityLevels(user) {
  if (canManageEnablement(user) || canAdminEnablement(user)) {
    return ["client_safe", "internal_sales", "internal_company", "restricted"];
  }
  if (canUploadEnablement(user)) {
    return ["client_safe", "internal_sales", "internal_company"];
  }
  return ["client_safe", "internal_sales"];
}

function buildSearchText({ item, catalogs, tags, links, files }) {
  return normalizeText(
    [
      item.title,
      item.summary,
      item.internal_description,
      item.asset_type_code,
      item.visibility_level,
      item.audience_code,
      item.language_code,
      ...catalogs.map((catalog) => catalog.name),
      ...tags.map((tag) => tag.label),
      ...links.map((link) => link.label),
      ...links.map((link) => link.url),
      ...files.map((file) => file.original_file_name),
    ].join(" "),
  );
}

function buildCatalogCodeMap(entries) {
  return entries.reduce((accumulator, entry) => {
    if (!accumulator[entry.catalogType]) {
      accumulator[entry.catalogType] = new Map();
    }
    accumulator[entry.catalogType].set(entry.code, entry);
    return accumulator;
  }, {});
}

function normalizeCatalogCode(value) {
  return normalizeText(value).replace(/\s+/g, "_");
}

async function upsertCatalogEntry(
  connOrQuery,
  { catalogType, code, name, description = "", sortOrder = 0 },
) {
  const executor =
    typeof connOrQuery.query === "function" ? connOrQuery : { query };
  const normalizedCode = normalizeCatalogCode(code) || buildPublicId("cat");
  await execSql(
    executor,
    `INSERT INTO commercial_enablement_catalog_entries
      (public_id, catalog_type, code, name, description, sort_order, is_active, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, 1, NOW(3), NOW(3)
     WHERE NOT EXISTS (
       SELECT 1 FROM commercial_enablement_catalog_entries
       WHERE catalog_type = ? AND code = ?
     )`,
    [
      buildPublicId("cec"),
      catalogType,
      normalizedCode,
      name,
      description || null,
      Number(sortOrder || 0),
      catalogType,
      normalizedCode,
    ],
  );

  const rows = await execSql(
    executor,
    `SELECT id, public_id, catalog_type, code, name, description, sort_order, is_active
     FROM commercial_enablement_catalog_entries
     WHERE catalog_type = ? AND code = ?
     LIMIT 1`,
    [catalogType, normalizedCode],
  );
  return rows[0] || null;
}

async function seedStaticCatalogs() {
  await withTransaction(async (conn) => {
    const tombstoneRows = await execSql(
      conn,
      `SELECT catalog_type, code
       FROM commercial_enablement_catalog_seed_tombstones`,
    );
    const deletedSeedKeys = new Set(
      tombstoneRows.map((row) => `${row.catalog_type}:${row.code}`),
    );

    for (const [catalogType, entries] of Object.entries(STATIC_CATALOG_SEEDS)) {
      for (const entry of entries) {
        const normalizedCode = normalizeCatalogCode(entry.code);
        if (deletedSeedKeys.has(`${catalogType}:${normalizedCode}`)) {
          continue;
        }
        await upsertCatalogEntry(conn, {
          catalogType,
          code: normalizedCode,
          name: entry.name,
          description: entry.description || "",
          sortOrder: entry.sortOrder || 0,
        });
      }
    }
  });
}

async function getCatalogEntries() {
  const rows = await query(
    `SELECT id, public_id, catalog_type, code, name, description, sort_order, is_active, metadata_json
     FROM commercial_enablement_catalog_entries
     ORDER BY catalog_type ASC, sort_order ASC, name ASC`,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    publicId: row.public_id,
    catalogType: row.catalog_type,
    code: row.code,
    name: row.name,
    description: row.description || "",
    sortOrder: Number(row.sort_order || 0),
    isActive: Boolean(row.is_active),
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : {},
  }));
}

function isStaticCatalogSeed(catalogType, code) {
  return (STATIC_CATALOG_SEEDS[catalogType] || []).some(
    (entry) => entry.code === code,
  );
}

async function migrateLegacyResourcesIfNeeded() {
  const legacyTableExists = await query(
    `SELECT COUNT(*) AS total
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name = 'commercial_enablement_resources'`,
  );
  if (!Number(legacyTableExists?.[0]?.total || 0)) {
    return;
  }

  const legacyResources = await query(
    `SELECT *
     FROM commercial_enablement_resources
     ORDER BY id ASC`,
  );
  if (!legacyResources.length) {
    return;
  }

  const existing = await query(
    `SELECT source_legacy_resource_id
     FROM commercial_enablement_items
     WHERE source_legacy_resource_id IS NOT NULL`,
  );
  const existingLegacyIds = new Set(
    existing
      .map((row) => Number(row.source_legacy_resource_id))
      .filter(Boolean),
  );
  const catalogEntries = await getCatalogEntries();
  const catalogCodeMap = buildCatalogCodeMap(catalogEntries);

  await withTransaction(async (conn) => {
    for (const resource of legacyResources) {
      const legacyId = Number(resource.id);
      if (existingLegacyIds.has(legacyId)) continue;

      const itemPublicId = buildPublicId("cea");
      const assetTypeCode =
        LEGACY_KIND_TO_TYPE[resource.kind] || "internal_playbook";
      const visibilityLevel =
        LEGACY_KIND_TO_VISIBILITY[resource.kind] || "internal_sales";
      const audienceCode = LEGACY_KIND_TO_AUDIENCE[resource.kind] || "seller";
      const status =
        resource.status === "obsolete"
          ? "obsolete"
          : resource.status === "published"
            ? "published"
            : "draft";
      const solutionCodes = parseJsonArray(resource.solution_codes_json);
      const industryTags = parseJsonArray(resource.industry_tags_json);
      const competitorTags = parseJsonArray(resource.competitor_tags_json);
      const needTags = parseJsonArray(resource.need_tags_json);
      const stageCodes = parseJsonArray(resource.stage_codes_json);
      const themeTags = parseJsonArray(resource.theme_tags_json);
      const personaTags = parseJsonArray(resource.persona_tags_json);
      const recommendedRoleTags = parseJsonArray(
        resource.recommended_role_tags_json,
      );

      const itemIdResult = await execSql(
        conn,
        `INSERT INTO commercial_enablement_items
          (public_id, title, summary, internal_description, asset_type_code,
           status, source_type, visibility_level, audience_code, language_code,
           owner_user_id, created_by_user_id, updated_by_user_id,
           is_internal, is_downloadable, is_featured,
           search_text, source_legacy_resource_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'file', ?, ?, 'es', ?, ?, ?, ?, 1, 0, ?, ?, NOW(3), NOW(3))`,
        [
          itemPublicId,
          resource.title,
          resource.summary || "",
          resource.body_markdown || "",
          assetTypeCode,
          status,
          visibilityLevel,
          audienceCode,
          resource.owner_user_id || null,
          resource.created_by_user_id || null,
          resource.updated_by_user_id || null,
          boolToTinyInt(visibilityLevel !== "client_safe"),
          normalizeText(
            [
              resource.title,
              resource.summary,
              resource.body_markdown,
              ...solutionCodes,
              ...industryTags,
              ...competitorTags,
              ...needTags,
              ...stageCodes,
              ...themeTags,
            ].join(" "),
          ),
          legacyId,
        ],
      );
      const itemId = Number(itemIdResult.insertId);

      const typedCatalogGroups = [
        ["solution", solutionCodes],
        ["industry", industryTags],
        ["competitor", competitorTags],
        ["need", needTags],
      ];
      for (const [catalogType, values] of typedCatalogGroups) {
        for (const value of values) {
          const normalizedCode = normalizeText(value).replace(/\s+/g, "_");
          let entry = catalogCodeMap[catalogType]?.get(normalizedCode);
          if (!entry) {
            const created = await upsertCatalogEntry(conn, {
              catalogType,
              code: normalizedCode,
              name: titleizeCode(value),
            });
            entry = {
              id: Number(created.id),
              publicId: created.public_id,
              catalogType: created.catalog_type,
              code: created.code,
              name: created.name,
            };
            if (!catalogCodeMap[catalogType])
              catalogCodeMap[catalogType] = new Map();
            catalogCodeMap[catalogType].set(normalizedCode, entry);
          }
          await execSql(
            conn,
            `INSERT IGNORE INTO commercial_enablement_item_catalog_links
              (item_id, catalog_entry_id, created_at)
             VALUES (?, ?, NOW(3))`,
            [itemId, entry.id],
          );
        }
      }

      const tagGroups = {
        stage: stageCodes,
        theme: themeTags,
        persona: personaTags,
        recommended_role: recommendedRoleTags,
      };
      for (const [tagGroup, values] of Object.entries(tagGroups)) {
        for (const value of values) {
          await execSql(
            conn,
            `INSERT IGNORE INTO commercial_enablement_item_tags
              (item_id, tag_group, value_code, value_label, created_at)
             VALUES (?, ?, ?, ?, NOW(3))`,
            [
              itemId,
              tagGroup,
              normalizeText(value).replace(/\s+/g, "_"),
              titleizeCode(value),
            ],
          );
        }
      }

      const legacyFiles = await execSql(
        conn,
        `SELECT *
         FROM commercial_enablement_assets
         WHERE resource_id = ? AND is_deleted = 0`,
        [legacyId],
      );
      for (const file of legacyFiles) {
        await execSql(
          conn,
          `INSERT INTO commercial_enablement_item_files
            (public_id, item_id, storage_provider, storage_bucket, storage_key,
             original_file_name, stored_file_name, mime_type, file_extension,
             byte_size, sha256, uploaded_by_user_id, is_deleted,
             source_legacy_asset_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
          [
            buildPublicId("cef"),
            itemId,
            file.storage_provider,
            file.storage_bucket,
            file.storage_key,
            file.original_file_name,
            file.stored_file_name,
            file.mime_type,
            file.file_extension,
            file.byte_size,
            file.sha256,
            file.uploaded_by_user_id || null,
            Number(file.is_deleted || 0),
            Number(file.id),
          ],
        );
      }
    }
  });
}

const TECHNOLOGY_CATALOG_HINTS = [
  "ciberseguridad",
  "ddi",
  "distributed cloud services",
  "distributed cloud",
  "micetro",
  "general",
  "nginx",
  "kubernetes",
];

const SOLUTION_CATALOG_HINTS = [
  "eliminar la complejidad",
  "mayor seguridad",
  "soluciones de ciberseguridad",
  "unificacion y optimizacion",
  "operacion en ambientes",
  "multinube",
  "hibridos",
  "hibridos",
  "visibilidad en ambientes",
];

function isTechnologyCatalogEntryLike(entry) {
  const normalizedName = normalizeText(entry?.name || entry?.code || "");
  if (!normalizedName) return false;
  if (TECHNOLOGY_CATALOG_HINTS.some((hint) => normalizedName.includes(hint))) {
    return true;
  }
  return normalizedName.split(" ").filter(Boolean).length <= 3;
}

function isSolutionCatalogEntryLike(entry) {
  const normalizedName = normalizeText(entry?.name || entry?.code || "");
  if (!normalizedName) return false;
  if (SOLUTION_CATALOG_HINTS.some((hint) => normalizedName.includes(hint))) {
    return true;
  }
  return normalizedName.split(" ").filter(Boolean).length >= 4;
}

async function migrateSwappedSolutionTechnologyCatalogsIfNeeded() {
  const rows = await query(
    `SELECT id, catalog_type, code, name
       FROM commercial_enablement_catalog_entries
      WHERE catalog_type IN ('solution', 'technology')`,
  );

  const technologyRows = rows.filter(
    (row) => String(row.catalog_type) === "technology",
  );
  const solutionRows = rows.filter(
    (row) => String(row.catalog_type) === "solution",
  );

  if (!technologyRows.length || !solutionRows.length) {
    return;
  }

  const technologyLooksLikeSolutions = technologyRows.filter(
    isSolutionCatalogEntryLike,
  );
  const solutionLooksLikeTechnologies = solutionRows.filter(
    isTechnologyCatalogEntryLike,
  );

  const shouldSwap =
    technologyLooksLikeSolutions.length >=
      Math.max(1, Math.ceil(technologyRows.length / 2)) &&
    solutionLooksLikeTechnologies.length >=
      Math.max(1, Math.ceil(solutionRows.length / 2));

  if (!shouldSwap) {
    return;
  }

  await withTransaction(async (conn) => {
    await execSql(
      conn,
      `UPDATE commercial_enablement_catalog_entries
          SET catalog_type = 'solution_swap_tmp'
        WHERE catalog_type = 'solution'`,
    );
    await execSql(
      conn,
      `UPDATE commercial_enablement_catalog_entries
          SET catalog_type = 'solution'
        WHERE catalog_type = 'technology'`,
    );
    await execSql(
      conn,
      `UPDATE commercial_enablement_catalog_entries
          SET catalog_type = 'technology'
        WHERE catalog_type = 'solution_swap_tmp'`,
    );

    await execSql(
      conn,
      `UPDATE commercial_enablement_catalog_seed_tombstones
          SET catalog_type = 'solution_swap_tmp'
        WHERE catalog_type = 'solution'`,
    );
    await execSql(
      conn,
      `UPDATE commercial_enablement_catalog_seed_tombstones
          SET catalog_type = 'solution'
        WHERE catalog_type = 'technology'`,
    );
    await execSql(
      conn,
      `UPDATE commercial_enablement_catalog_seed_tombstones
          SET catalog_type = 'technology'
        WHERE catalog_type = 'solution_swap_tmp'`,
    );
  });
}

const SOLUTION_TARGET_KEYS = {
  simplifyMulticloud:
    "eliminar la complejidad de la operacion en ambientes multinube e hibridos",
  optimizeDdi: "unificacion y optimizacion del ddi",
  cybersecurity: "soluciones de ciberseguridad",
  nginxKubernetes:
    "mayor seguridad performance y visibilidad de ambientes nginx y kubernetes",
};

const MISSING_SOLUTIONS_MIGRATION_MARKER =
  "missing_solution_links_from_technologies_v1";

function findBestSolutionEntryId(solutionRows, targetKey) {
  const normalizedTarget = normalizeText(targetKey);
  if (!normalizedTarget) return null;

  const exactCode = solutionRows.find(
    (entry) => normalizeText(entry.code) === normalizedTarget,
  );
  if (exactCode) return Number(exactCode.id);

  const exactName = solutionRows.find(
    (entry) => normalizeText(entry.name) === normalizedTarget,
  );
  if (exactName) return Number(exactName.id);

  const targetTokens = normalizedTarget.split(" ").filter(Boolean);
  const scored = solutionRows
    .map((entry) => {
      const haystack = `${normalizeText(entry.code)} ${normalizeText(entry.name)}`;
      const score = targetTokens.reduce(
        (acc, token) => (haystack.includes(token) ? acc + 1 : acc),
        0,
      );
      return { id: Number(entry.id), score };
    })
    .sort((left, right) => right.score - left.score);

  return scored[0]?.score ? scored[0].id : null;
}

function chooseSolutionTargetForItem({ title, summary, technologyCodes }) {
  const normalizedTechCodes = uniqueStrings(technologyCodes).map((code) =>
    normalizeText(code),
  );
  const text = normalizeText(`${title || ""} ${summary || ""}`);

  const hasTech = (token) => normalizedTechCodes.some((code) => code === token);

  if (
    hasTech("ddi") ||
    hasTech("micetro") ||
    /\bddi\b|\bdns\b|\bdhcp\b|\bipam\b/.test(text)
  ) {
    return "optimizeDdi";
  }

  if (text.includes("nginx") || text.includes("kubernetes")) {
    return "nginxKubernetes";
  }

  if (
    hasTech("distributed_cloud_services") ||
    text.includes("distributed cloud") ||
    text.includes("multinube") ||
    text.includes("hibrid")
  ) {
    return "simplifyMulticloud";
  }

  if (
    hasTech("ciberseguridad") ||
    text.includes("seguridad") ||
    text.includes("ddos") ||
    text.includes("waap") ||
    text.includes("bot defense")
  ) {
    return "cybersecurity";
  }

  return null;
}

async function migrateMissingSolutionLinksFromTechnologiesIfNeeded() {
  const markerRows = await query(
    `SELECT 1
       FROM commercial_enablement_catalog_seed_tombstones
      WHERE catalog_type = '__migration__' AND code = ?
      LIMIT 1`,
    [MISSING_SOLUTIONS_MIGRATION_MARKER],
  );
  if (markerRows.length) {
    return;
  }

  const solutionRows = await query(
    `SELECT id, code, name
       FROM commercial_enablement_catalog_entries
      WHERE catalog_type = 'solution' AND is_active = 1`,
  );

  if (!solutionRows.length) {
    return;
  }

  const solutionIdsByTarget = {
    simplifyMulticloud: findBestSolutionEntryId(
      solutionRows,
      SOLUTION_TARGET_KEYS.simplifyMulticloud,
    ),
    optimizeDdi: findBestSolutionEntryId(
      solutionRows,
      SOLUTION_TARGET_KEYS.optimizeDdi,
    ),
    cybersecurity: findBestSolutionEntryId(
      solutionRows,
      SOLUTION_TARGET_KEYS.cybersecurity,
    ),
    nginxKubernetes: findBestSolutionEntryId(
      solutionRows,
      SOLUTION_TARGET_KEYS.nginxKubernetes,
    ),
  };

  const itemRows = await query(
    `SELECT i.id, i.title, i.summary,
            GROUP_CONCAT(DISTINCT CASE WHEN e.catalog_type = 'technology' THEN e.code END) AS technology_codes,
            SUM(CASE WHEN e.catalog_type = 'solution' THEN 1 ELSE 0 END) AS solution_count
       FROM commercial_enablement_items i
  LEFT JOIN commercial_enablement_item_catalog_links l ON l.item_id = i.id
  LEFT JOIN commercial_enablement_catalog_entries e ON e.id = l.catalog_entry_id
      WHERE i.is_deleted = 0
      GROUP BY i.id, i.title, i.summary
     HAVING solution_count = 0
        AND technology_codes IS NOT NULL
        AND technology_codes <> ''`,
  );

  await withTransaction(async (conn) => {
    for (const item of itemRows) {
      const technologyCodes = String(item.technology_codes || "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);

      const targetKey = chooseSolutionTargetForItem({
        title: item.title,
        summary: item.summary,
        technologyCodes,
      });
      if (!targetKey) continue;

      const solutionEntryId = Number(solutionIdsByTarget[targetKey] || 0);
      if (!solutionEntryId) continue;

      await execSql(
        conn,
        `INSERT IGNORE INTO commercial_enablement_item_catalog_links
          (item_id, catalog_entry_id, created_at)
         VALUES (?, ?, NOW(3))`,
        [Number(item.id), solutionEntryId],
      );
    }

    await execSql(
      conn,
      `INSERT IGNORE INTO commercial_enablement_catalog_seed_tombstones
        (catalog_type, code, deleted_by_user_id, deleted_at)
       VALUES ('__migration__', ?, NULL, NOW(3))`,
      [MISSING_SOLUTIONS_MIGRATION_MARKER],
    );
  });
}

export async function ensureCommercialEnablementStarterData() {
  if (!ensureCommercialEnablementStarterDataPromise) {
    ensureCommercialEnablementStarterDataPromise = (async () => {
      await ensureCommercialEnablementSchema();
      await seedStaticCatalogs();
      await migrateLegacyResourcesIfNeeded();
      await migrateSwappedSolutionTechnologyCatalogsIfNeeded();
      await migrateMissingSolutionLinksFromTechnologiesIfNeeded();
    })().catch((error) => {
      ensureCommercialEnablementStarterDataPromise = null;
      throw error;
    });
  }

  return ensureCommercialEnablementStarterDataPromise;
}

function groupCatalogEntries(entries) {
  return entries.reduce((accumulator, entry) => {
    if (!accumulator[entry.catalogType]) accumulator[entry.catalogType] = [];
    accumulator[entry.catalogType].push(entry);
    return accumulator;
  }, {});
}

async function loadRawEnablementData() {
  const [
    itemRows,
    fileRows,
    linkRows,
    catalogRows,
    catalogLinkRows,
    tagRows,
    relationRows,
    usageRows,
    favoriteRows,
    collectionRows,
    collectionItemRows,
  ] = await Promise.all([
    query(
      `SELECT * FROM commercial_enablement_items WHERE is_deleted = 0 ORDER BY updated_at DESC, id DESC`,
    ),
    query(
      `SELECT * FROM commercial_enablement_item_files WHERE is_deleted = 0 ORDER BY created_at DESC`,
    ),
    query(
      `SELECT * FROM commercial_enablement_item_links WHERE is_deleted = 0 ORDER BY is_primary DESC, created_at ASC`,
    ),
    query(
      `SELECT * FROM commercial_enablement_catalog_entries WHERE is_active = 1 ORDER BY catalog_type ASC, sort_order ASC, name ASC`,
    ),
    query(`SELECT * FROM commercial_enablement_item_catalog_links`),
    query(
      `SELECT * FROM commercial_enablement_item_tags ORDER BY tag_group ASC, value_label ASC`,
    ),
    query(`SELECT * FROM commercial_enablement_item_relations`),
    query(
      `SELECT * FROM commercial_enablement_usage_events_v2 ORDER BY created_at DESC`,
    ),
    query(
      `SELECT * FROM commercial_enablement_favorites ORDER BY created_at DESC`,
    ),
    query(
      `SELECT * FROM commercial_enablement_collections ORDER BY updated_at DESC, id DESC`,
    ),
    query(
      `SELECT * FROM commercial_enablement_collection_items ORDER BY sort_order ASC, created_at ASC`,
    ),
  ]);

  return {
    itemRows,
    fileRows,
    linkRows,
    catalogRows,
    catalogLinkRows,
    tagRows,
    relationRows,
    usageRows,
    favoriteRows,
    collectionRows,
    collectionItemRows,
  };
}

function assembleEnablementItems(raw, user) {
  const catalogById = new Map(
    raw.catalogRows.map((row) => [
      Number(row.id),
      {
        id: Number(row.id),
        publicId: row.public_id,
        catalogType: row.catalog_type,
        code: row.code,
        name: row.name,
      },
    ]),
  );
  const filesByItemId = new Map();
  raw.fileRows.forEach((row) => {
    const itemId = Number(row.item_id);
    if (!filesByItemId.has(itemId)) filesByItemId.set(itemId, []);
    filesByItemId.get(itemId).push({
      id: Number(row.id),
      publicId: row.public_id,
      originalFileName: row.original_file_name,
      storedFileName: row.stored_file_name,
      mimeType: row.mime_type,
      byteSize: Number(row.byte_size || 0),
      fileExtension: row.file_extension || "",
      storageProvider: row.storage_provider,
      storageBucket: row.storage_bucket,
      storageKey: row.storage_key,
      uploadedByUserId: row.uploaded_by_user_id
        ? Number(row.uploaded_by_user_id)
        : null,
      createdAt: row.created_at,
    });
  });
  const linksByItemId = new Map();
  raw.linkRows.forEach((row) => {
    const itemId = Number(row.item_id);
    if (!linksByItemId.has(itemId)) linksByItemId.set(itemId, []);
    linksByItemId.get(itemId).push({
      id: Number(row.id),
      publicId: row.public_id,
      url: row.url,
      linkType: row.link_type,
      label: row.label || row.url,
      description: row.description || "",
      isPrimary: Boolean(row.is_primary),
      createdAt: row.created_at,
    });
  });
  const catalogsByItemId = new Map();
  raw.catalogLinkRows.forEach((row) => {
    const itemId = Number(row.item_id);
    const entry = catalogById.get(Number(row.catalog_entry_id));
    if (!entry) return;
    if (!catalogsByItemId.has(itemId)) catalogsByItemId.set(itemId, []);
    catalogsByItemId.get(itemId).push(entry);
  });
  const tagsByItemId = new Map();
  raw.tagRows.forEach((row) => {
    const itemId = Number(row.item_id);
    if (!tagsByItemId.has(itemId)) tagsByItemId.set(itemId, []);
    tagsByItemId.get(itemId).push({
      id: Number(row.id),
      tagGroup: row.tag_group,
      code: row.value_code,
      label: row.value_label,
    });
  });
  const usageByItemId = raw.usageRows.reduce((accumulator, row) => {
    const itemId = Number(row.item_id);
    if (!accumulator.has(itemId)) accumulator.set(itemId, []);
    accumulator.get(itemId).push({
      id: Number(row.id),
      eventType: row.event_type,
      userId: row.user_id ? Number(row.user_id) : null,
      contextType: row.context_type || null,
      contextEntityId: row.context_entity_id
        ? Number(row.context_entity_id)
        : null,
      createdAt: row.created_at,
    });
    return accumulator;
  }, new Map());
  const favoriteItemIds = new Set(
    raw.favoriteRows
      .filter((row) => Number(row.user_id) === Number(user?.id || 0))
      .map((row) => Number(row.item_id)),
  );

  const relationRowsByItemId = raw.relationRows.reduce((accumulator, row) => {
    const itemId = Number(row.item_id);
    if (!accumulator.has(itemId)) accumulator.set(itemId, []);
    accumulator.get(itemId).push(row);
    return accumulator;
  }, new Map());

  const allowedVisibilities = new Set(getAllowedVisibilityLevels(user));
  const items = raw.itemRows
    .map((row) => {
      const itemId = Number(row.id);
      const files = filesByItemId.get(itemId) || [];
      const links = linksByItemId.get(itemId) || [];
      const catalogs = catalogsByItemId.get(itemId) || [];
      const tags = tagsByItemId.get(itemId) || [];
      const usageEvents = usageByItemId.get(itemId) || [];
      const isOwner =
        Number(row.owner_user_id || 0) === Number(user?.id || 0) ||
        Number(row.created_by_user_id || 0) === Number(user?.id || 0);
      const visible =
        allowedVisibilities.has(String(row.visibility_level || "")) ||
        (String(row.visibility_level || "") === "restricted" && isOwner);
      const canEdit =
        canManageEnablement(user) || (canUploadEnablement(user) && isOwner);
      return {
        id: itemId,
        publicId: row.public_id,
        title: row.title,
        summary: row.summary || "",
        internalDescription: row.internal_description || "",
        assetTypeCode: row.asset_type_code,
        assetTypeLabel: titleizeCode(row.asset_type_code),
        status: row.status,
        statusLabel:
          row.status === "published"
            ? "Vigente"
            : row.status === "obsolete"
              ? "Obsoleto"
              : row.status === "archived"
                ? "Archivado"
                : "Borrador",
        sourceType: row.source_type,
        visibilityLevel: row.visibility_level,
        visibilityLabel: titleizeCode(row.visibility_level),
        audienceCode: row.audience_code,
        audienceLabel: titleizeCode(row.audience_code),
        languageCode: row.language_code || "es",
        ownerUserId: row.owner_user_id ? Number(row.owner_user_id) : null,
        createdByUserId: row.created_by_user_id
          ? Number(row.created_by_user_id)
          : null,
        updatedByUserId: row.updated_by_user_id
          ? Number(row.updated_by_user_id)
          : null,
        isInternal: Boolean(row.is_internal),
        isDownloadable: Boolean(row.is_downloadable),
        isFeatured: Boolean(row.is_featured),
        searchText:
          row.search_text ||
          buildSearchText({ item: row, catalogs, tags, links, files }),
        files,
        links,
        catalogs,
        tags,
        usageCount: usageEvents.length,
        usageEvents,
        isFavorite: favoriteItemIds.has(itemId),
        visible,
        canEdit,
        canPublish: canManageEnablement(user),
        canObsolete: canManageEnablement(user),
        relations: relationRowsByItemId.get(itemId) || [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    })
    .filter((item) => {
      if (item.visible) return true;
      if (canManageEnablement(user)) return true;
      if (canUploadEnablement(user) && item.canEdit) return true;
      return false;
    });

  const itemMap = new Map(items.map((item) => [item.id, item]));
  items.forEach((item) => {
    item.relations = item.relations
      .map((row) => ({
        id: Number(row.id),
        relationType: row.relation_type,
        relatedItem: itemMap.get(Number(row.related_item_id))
          ? {
              id: Number(row.related_item_id),
              publicId: itemMap.get(Number(row.related_item_id)).publicId,
              title: itemMap.get(Number(row.related_item_id)).title,
              assetTypeLabel: itemMap.get(Number(row.related_item_id))
                .assetTypeLabel,
              visibilityLevel: itemMap.get(Number(row.related_item_id))
                .visibilityLevel,
            }
          : null,
      }))
      .filter((relation) => relation.relatedItem);
  });

  return items;
}

function groupCatalogsForResponse(entries, options = {}) {
  const includeStatus = options.includeStatus === true;
  const grouped = groupCatalogEntries(entries);
  const order = [
    "asset_type",
    "manufacturer",
    "technology",
    "solution",
    "need",
    "requirement",
    "competitor",
    "industry",
    "audience",
    "visibility",
    "language",
  ];
  const response = {};
  order.forEach((type) => {
    response[type] = (grouped[type] || []).map((entry) => ({
      id: entry.id,
      publicId: entry.publicId,
      code: entry.code,
      name: entry.name,
      description: entry.description || "",
      sortOrder: entry.sortOrder,
      ...(includeStatus ? { isActive: entry.isActive !== false } : {}),
    }));
  });
  return response;
}

async function buildCommercialEnablementCatalogResponse(user = null) {
  const catalogs = await getCatalogEntries();
  const response = {
    catalogs: groupCatalogsForResponse(
      catalogs.filter((entry) => entry.isActive),
    ),
  };

  if (user && canAdminEnablement(user)) {
    response.adminCatalogs = groupCatalogsForResponse(catalogs, {
      includeStatus: true,
    });
  }

  return response;
}

function itemHasCatalogCode(item, catalogType, filterCodes) {
  if (!filterCodes.length) return true;
  const values = item.catalogs
    .filter((catalog) => catalog.catalogType === catalogType)
    .map((catalog) => String(catalog.code));
  return filterCodes.some((code) => values.includes(code));
}

function itemHasTagCode(item, tagGroup, filterCodes) {
  if (!filterCodes.length) return true;
  const values = item.tags
    .filter((tag) => tag.tagGroup === tagGroup)
    .map((tag) => String(tag.code));
  return filterCodes.some((code) => values.includes(code));
}

function filterItems(items, filters = {}) {
  const queryText = normalizeText(filters.q || "");
  const manufacturerCodes = parseCsvArray(filters.manufacturerCodes);
  const solutionCodes = parseCsvArray(filters.solutionCodes);
  const technologyCodes = parseCsvArray(filters.technologyCodes);
  const needCodes = parseCsvArray(filters.needCodes);
  const requirementCodes = parseCsvArray(filters.requirementCodes);
  const competitorCodes = parseCsvArray(filters.competitorCodes);
  const industryCodes = parseCsvArray(filters.industryCodes);
  const assetTypeCodes = parseCsvArray(filters.assetTypeCodes);
  const audienceCodes = parseCsvArray(filters.audienceCodes);
  const visibilityLevels = parseCsvArray(filters.visibilityLevels);
  const languageCodes = parseCsvArray(filters.languageCodes);
  const stageCodes = parseCsvArray(filters.stageCodes);
  const tags = parseCsvArray(filters.tags).map((tag) =>
    normalizeText(tag).replace(/\s+/g, "_"),
  );
  const status = String(filters.status || "published").trim();
  const includeDrafts = String(filters.includeDrafts || "false") === "true";

  return items.filter((item) => {
    if (!includeDrafts) {
      if (status === "all") {
        if (!["published", "obsolete"].includes(item.status) && !item.canEdit) {
          return false;
        }
      } else if (status && status !== item.status) {
        return false;
      } else if (!status && item.status !== "published") {
        return false;
      }
    } else if (status && status !== "all" && status !== item.status) {
      return false;
    }

    if (queryText && !String(item.searchText || "").includes(queryText))
      return false;
    if (
      assetTypeCodes.length &&
      !assetTypeCodes.includes(String(item.assetTypeCode))
    )
      return false;
    if (
      audienceCodes.length &&
      !audienceCodes.includes(String(item.audienceCode))
    )
      return false;
    if (
      visibilityLevels.length &&
      !visibilityLevels.includes(String(item.visibilityLevel))
    )
      return false;
    if (
      languageCodes.length &&
      !languageCodes.includes(String(item.languageCode))
    )
      return false;
    if (!itemHasCatalogCode(item, "manufacturer", manufacturerCodes))
      return false;
    if (!itemHasCatalogCode(item, "solution", solutionCodes)) return false;
    if (!itemHasCatalogCode(item, "technology", technologyCodes)) return false;
    if (!itemHasCatalogCode(item, "need", needCodes)) return false;
    if (!itemHasCatalogCode(item, "requirement", requirementCodes))
      return false;
    if (!itemHasCatalogCode(item, "competitor", competitorCodes)) return false;
    if (!itemHasCatalogCode(item, "industry", industryCodes)) return false;
    if (!itemHasTagCode(item, "stage", stageCodes)) return false;
    if (
      tags.length &&
      !tags.some((tag) => item.tags.some((itemTag) => itemTag.code === tag))
    ) {
      return false;
    }
    if (filters.onlyFavorites === "true" && !item.isFavorite) return false;
    if (
      filters.onlyClientSafe === "true" &&
      item.visibilityLevel !== "client_safe"
    )
      return false;
    return true;
  });
}

function sortItems(items, sort = "updated_desc") {
  const cloned = [...items];
  if (sort === "title_asc") {
    return cloned.sort((left, right) =>
      String(left.title).localeCompare(String(right.title), "es"),
    );
  }
  if (sort === "most_used") {
    return cloned.sort(
      (left, right) =>
        right.usageCount - left.usageCount ||
        String(left.title).localeCompare(String(right.title), "es"),
    );
  }
  if (sort === "recent") {
    return cloned.sort((left, right) =>
      String(right.updatedAt).localeCompare(String(left.updatedAt)),
    );
  }
  return cloned.sort((left, right) =>
    String(right.updatedAt).localeCompare(String(left.updatedAt)),
  );
}

function paginate(items, page = 1, pageSize = 24) {
  const normalizedPage = Math.max(1, Number(page || 1));
  const normalizedPageSize = Math.min(100, Math.max(1, Number(pageSize || 24)));
  const startIndex = (normalizedPage - 1) * normalizedPageSize;
  return {
    page: normalizedPage,
    pageSize: normalizedPageSize,
    total: items.length,
    items: items.slice(startIndex, startIndex + normalizedPageSize),
  };
}

export async function getCommercialEnablementCatalogs() {
  await ensureCommercialEnablementStarterData();
  const response = await buildCommercialEnablementCatalogResponse();
  return response.catalogs;
}

export async function getCommercialEnablementBootstrap({ user }) {
  await ensureCommercialEnablementStarterData();
  const raw = await loadRawEnablementData();
  const items = assembleEnablementItems(raw, user);
  const catalogResponse = await buildCommercialEnablementCatalogResponse(user);
  const recent = await listCommercialEnablementRecent({ user, raw, items });
  const favorites = await listCommercialEnablementFavorites({
    user,
    raw,
    items,
  });
  const collections = await listCommercialEnablementCollections({
    user,
    raw,
    items,
  });

  return {
    permissions: {
      canUse: canUseEnablement(user),
      canUpload: canUploadEnablement(user),
      canManage: canManageEnablement(user),
      canAdmin: canAdminEnablement(user),
    },
    summary: {
      totalVisibleAssets: items.filter((item) => item.status === "published")
        .length,
      clientSafeAssets: items.filter(
        (item) =>
          item.status === "published" && item.visibilityLevel === "client_safe",
      ).length,
      internalAssets: items.filter(
        (item) =>
          item.status === "published" && item.visibilityLevel !== "client_safe",
      ).length,
      favoriteAssets: favorites.length,
      recentAssets: recent.length,
    },
    catalogs: catalogResponse.catalogs,
    adminCatalogs: catalogResponse.adminCatalogs || catalogResponse.catalogs,
    recent,
    favorites,
    collections,
  };
}

export async function listCommercialEnablementAssets({ user, filters = {} }) {
  await ensureCommercialEnablementStarterData();
  const raw = await loadRawEnablementData();
  const items = assembleEnablementItems(raw, user);
  const filtered = sortItems(
    filterItems(items, filters),
    filters.sort || "updated_desc",
  );
  const paginated = paginate(filtered, filters.page, filters.pageSize);
  return {
    page: paginated.page,
    pageSize: paginated.pageSize,
    total: paginated.total,
    items: paginated.items,
  };
}

export async function getCommercialEnablementAssetDetail({
  user,
  assetPublicId,
}) {
  await ensureCommercialEnablementStarterData();
  const raw = await loadRawEnablementData();
  const items = assembleEnablementItems(raw, user);
  const item =
    items.find((candidate) => candidate.publicId === assetPublicId) || null;
  if (!item) return null;

  const files = await Promise.all(
    item.files.map(async (file) => ({
      ...file,
      isAvailable: await storage
        .exists({
          storageKey: file.storageKey,
          storageBucket: file.storageBucket,
        })
        .catch(() => false),
    })),
  );

  const sourceContentRows = await query(
    `SELECT source_file_name, source_mime_type, created_at,
            CHAR_LENGTH(COALESCE(extracted_text, '')) AS extracted_char_count,
            CHAR_LENGTH(COALESCE(extracted_text_summary, '')) AS summary_char_count
       FROM commercial_enablement_item_source_contents
      WHERE item_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [Number(item.id)],
  );
  const latestSourceContent = sourceContentRows[0] || null;

  return {
    ...item,
    files,
    sourceContent: latestSourceContent
      ? {
          sourceFileName: latestSourceContent.source_file_name || "",
          sourceMimeType: latestSourceContent.source_mime_type || "",
          createdAt: latestSourceContent.created_at || null,
          hasExtractedText:
            Number(latestSourceContent.extracted_char_count || 0) > 0,
          hasSummary: Number(latestSourceContent.summary_char_count || 0) > 0,
          canReanalyzeSummary:
            Number(latestSourceContent.extracted_char_count || 0) > 0 ||
            Number(latestSourceContent.summary_char_count || 0) > 0,
        }
      : {
          sourceFileName: "",
          sourceMimeType: "",
          createdAt: null,
          hasExtractedText: false,
          hasSummary: false,
          canReanalyzeSummary: false,
        },
  };
}

function buildAssetSearchPayload(body = {}) {
  return {
    title: String(body.title || "").trim(),
    summary: String(body.summary || "").trim(),
    internalDescription: String(body.internalDescription || "").trim(),
    assetTypeCode:
      String(body.assetTypeCode || "").trim() || "internal_playbook",
    status: String(body.status || "draft").trim() || "draft",
    sourceType: String(body.sourceType || "mixed").trim() || "mixed",
    visibilityLevel:
      String(body.visibilityLevel || "internal_sales").trim() ||
      "internal_sales",
    audienceCode: String(body.audienceCode || "seller").trim() || "seller",
    languageCode: String(body.languageCode || "es").trim() || "es",
    isInternal: Boolean(body.isInternal),
    isDownloadable: body.isDownloadable === false ? false : true,
    isFeatured: Boolean(body.isFeatured),
    manufacturerCodes: uniqueStrings(body.manufacturerCodes),
    solutionCodes: uniqueStrings(body.solutionCodes),
    technologyCodes: uniqueStrings(body.technologyCodes),
    needCodes: uniqueStrings(body.needCodes),
    requirementCodes: uniqueStrings(body.requirementCodes),
    competitorCodes: uniqueStrings(body.competitorCodes),
    industryCodes: uniqueStrings(body.industryCodes),
    stageCodes: uniqueStrings(body.stageCodes),
    themeTags: uniqueStrings(body.themeTags),
    personaTags: uniqueStrings(body.personaTags),
    recommendedRoleTags: uniqueStrings(body.recommendedRoleTags),
    ownerUserId: body.ownerUserId ? Number(body.ownerUserId) : null,
  };
}

async function syncCatalogLinks(conn, itemId, groupedCodes) {
  await execSql(
    conn,
    `DELETE FROM commercial_enablement_item_catalog_links WHERE item_id = ?`,
    [itemId],
  );
  for (const [catalogType, codes] of Object.entries(groupedCodes)) {
    for (const code of uniqueStrings(codes)) {
      const entry = await upsertCatalogEntry(conn, {
        catalogType,
        code,
        name: titleizeCode(code),
      });
      await execSql(
        conn,
        `INSERT IGNORE INTO commercial_enablement_item_catalog_links
          (item_id, catalog_entry_id, created_at)
         VALUES (?, ?, NOW(3))`,
        [itemId, Number(entry.id)],
      );
    }
  }
}

async function syncTags(conn, itemId, groupedTags) {
  await execSql(
    conn,
    `DELETE FROM commercial_enablement_item_tags WHERE item_id = ?`,
    [itemId],
  );
  for (const [tagGroup, values] of Object.entries(groupedTags)) {
    for (const value of uniqueStrings(values)) {
      const normalizedCode = normalizeText(value).replace(/\s+/g, "_");
      await execSql(
        conn,
        `INSERT INTO commercial_enablement_item_tags
          (item_id, tag_group, value_code, value_label, created_at)
         VALUES (?, ?, ?, ?, NOW(3))`,
        [itemId, tagGroup, normalizedCode, titleizeCode(value)],
      );
    }
  }
}

const SINGLE_RESOURCE_VALIDATION_MESSAGE =
  "Cada activo solo puede tener un archivo o una URL";
const SINGLE_RESOURCE_ATTACH_MESSAGE =
  "Cada activo solo puede tener un archivo o una URL. Elimina el recurso actual antes de agregar otro.";

async function getItemResourceCounts(itemId) {
  const [fileRows, linkRows] = await Promise.all([
    query(
      `SELECT COUNT(*) AS total
       FROM commercial_enablement_item_files
       WHERE item_id = ? AND is_deleted = 0`,
      [Number(itemId)],
    ),
    query(
      `SELECT COUNT(*) AS total
       FROM commercial_enablement_item_links
       WHERE item_id = ? AND is_deleted = 0`,
      [Number(itemId)],
    ),
  ]);

  const fileCount = Number(fileRows?.[0]?.total || 0);
  const linkCount = Number(linkRows?.[0]?.total || 0);
  return {
    fileCount,
    linkCount,
    total: fileCount + linkCount,
  };
}

export async function validateCommercialEnablementAssetPayload({ body }) {
  const payload = buildAssetSearchPayload(body);
  const issues = [];
  if (!payload.title) issues.push("Titulo requerido");
  if (!payload.summary) issues.push("Resumen requerido");
  if (!payload.assetTypeCode) issues.push("Tipo de activo requerido");
  if (!payload.visibilityLevel) issues.push("Visibilidad requerida");
  if (!payload.audienceCode) issues.push("Audiencia requerida");
  if (!payload.manufacturerCodes.length && !payload.solutionCodes.length) {
    issues.push("Debes indicar al menos un fabricante o una solucion");
  }
  return {
    ok: issues.length === 0,
    issues,
    payload,
  };
}

export async function createCommercialEnablementAsset({ body, user }) {
  await ensureCommercialEnablementStarterData();
  const payload = buildAssetSearchPayload(body);
  const publicId = buildPublicId("cea");
  const searchText = normalizeText(
    [
      payload.title,
      payload.summary,
      payload.internalDescription,
      payload.assetTypeCode,
      ...payload.manufacturerCodes,
      ...payload.solutionCodes,
      ...payload.technologyCodes,
      ...payload.needCodes,
      ...payload.requirementCodes,
      ...payload.competitorCodes,
      ...payload.industryCodes,
      ...payload.stageCodes,
      ...payload.themeTags,
      ...payload.personaTags,
      ...payload.recommendedRoleTags,
    ].join(" "),
  );

  const assetPublicId = await withTransaction(async (conn) => {
    const result = await execSql(
      conn,
      `INSERT INTO commercial_enablement_items
        (public_id, title, summary, internal_description, asset_type_code,
         status, source_type, visibility_level, audience_code, language_code,
         owner_user_id, created_by_user_id, updated_by_user_id, is_internal,
         is_downloadable, is_featured, is_deleted, search_text,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NOW(3), NOW(3))`,
      [
        publicId,
        payload.title,
        payload.summary,
        payload.internalDescription,
        payload.assetTypeCode,
        payload.status,
        payload.sourceType,
        payload.visibilityLevel,
        payload.audienceCode,
        payload.languageCode,
        payload.ownerUserId || Number(user.id),
        Number(user.id),
        Number(user.id),
        boolToTinyInt(payload.isInternal),
        boolToTinyInt(payload.isDownloadable),
        boolToTinyInt(payload.isFeatured),
        searchText,
      ],
    );
    const itemId = Number(result.insertId);
    await syncCatalogLinks(conn, itemId, {
      manufacturer: payload.manufacturerCodes,
      solution: payload.solutionCodes,
      technology: payload.technologyCodes,
      need: payload.needCodes,
      requirement: payload.requirementCodes,
      competitor: payload.competitorCodes,
      industry: payload.industryCodes,
    });
    await syncTags(conn, itemId, {
      stage: payload.stageCodes,
      theme: payload.themeTags,
      persona: payload.personaTags,
      recommended_role: payload.recommendedRoleTags,
    });
    return publicId;
  });

  return getCommercialEnablementAssetDetail({ user, assetPublicId });
}

export async function updateCommercialEnablementAsset({
  assetPublicId,
  body,
  user,
}) {
  await ensureCommercialEnablementStarterData();
  const payload = buildAssetSearchPayload(body);
  const existing = await query(
    `SELECT * FROM commercial_enablement_items WHERE public_id = ? AND is_deleted = 0 LIMIT 1`,
    [assetPublicId],
  );
  if (!existing.length) {
    const error = new Error("Activo no encontrado");
    error.status = 404;
    throw error;
  }
  const item = existing[0];
  const canEdit =
    canManageEnablement(user) ||
    Number(item.owner_user_id || 0) === Number(user.id) ||
    Number(item.created_by_user_id || 0) === Number(user.id);
  if (!canEdit) {
    const error = new Error("No autorizado para editar este activo");
    error.status = 403;
    throw error;
  }
  const searchText = normalizeText(
    [
      payload.title,
      payload.summary,
      payload.internalDescription,
      payload.assetTypeCode,
      ...payload.manufacturerCodes,
      ...payload.solutionCodes,
      ...payload.technologyCodes,
      ...payload.needCodes,
      ...payload.requirementCodes,
      ...payload.competitorCodes,
      ...payload.industryCodes,
      ...payload.stageCodes,
      ...payload.themeTags,
      ...payload.personaTags,
      ...payload.recommendedRoleTags,
    ].join(" "),
  );

  await withTransaction(async (conn) => {
    await execSql(
      conn,
      `UPDATE commercial_enablement_items
       SET title = ?, summary = ?, internal_description = ?, asset_type_code = ?,
           status = ?, source_type = ?, visibility_level = ?, audience_code = ?,
           language_code = ?, owner_user_id = ?, updated_by_user_id = ?,
           is_internal = ?, is_downloadable = ?, is_featured = ?, search_text = ?,
           updated_at = NOW(3)
       WHERE public_id = ?`,
      [
        payload.title,
        payload.summary,
        payload.internalDescription,
        payload.assetTypeCode,
        payload.status,
        payload.sourceType,
        payload.visibilityLevel,
        payload.audienceCode,
        payload.languageCode,
        payload.ownerUserId || Number(user.id),
        Number(user.id),
        boolToTinyInt(payload.isInternal),
        boolToTinyInt(payload.isDownloadable),
        boolToTinyInt(payload.isFeatured),
        searchText,
        assetPublicId,
      ],
    );
    await syncCatalogLinks(conn, Number(item.id), {
      manufacturer: payload.manufacturerCodes,
      solution: payload.solutionCodes,
      technology: payload.technologyCodes,
      need: payload.needCodes,
      requirement: payload.requirementCodes,
      competitor: payload.competitorCodes,
      industry: payload.industryCodes,
    });
    await syncTags(conn, Number(item.id), {
      stage: payload.stageCodes,
      theme: payload.themeTags,
      persona: payload.personaTags,
      recommended_role: payload.recommendedRoleTags,
    });
  });

  return getCommercialEnablementAssetDetail({ user, assetPublicId });
}

async function getItemFileRow({ itemPublicId, filePublicId }) {
  const rows = await query(
    `SELECT f.*, i.public_id AS item_public_id
     FROM commercial_enablement_item_files f
     INNER JOIN commercial_enablement_items i ON i.id = f.item_id
     WHERE i.public_id = ? AND f.public_id = ? AND f.is_deleted = 0
     LIMIT 1`,
    [itemPublicId, filePublicId],
  );
  return rows[0] || null;
}

export async function uploadCommercialEnablementFiles({
  req,
  assetPublicId,
  user,
}) {
  await ensureCommercialEnablementStarterData();
  const itemRows = await query(
    `SELECT * FROM commercial_enablement_items WHERE public_id = ? AND is_deleted = 0 LIMIT 1`,
    [assetPublicId],
  );
  if (!itemRows.length) {
    const error = new Error("Activo no encontrado");
    error.status = 404;
    throw error;
  }
  const item = itemRows[0];
  const canEdit =
    canManageEnablement(user) ||
    Number(item.owner_user_id || 0) === Number(user.id) ||
    Number(item.created_by_user_id || 0) === Number(user.id);
  if (!canEdit) {
    const error = new Error(
      "No autorizado para cargar archivos en este activo",
    );
    error.status = 403;
    throw error;
  }

  const { files } = await parseMultipartFiles(req);
  if (!files.length) {
    const error = new Error("No se recibieron archivos");
    error.status = 400;
    throw error;
  }
  if (files.length > 1) {
    const error = new Error("Solo se permite un archivo por activo");
    error.status = 400;
    throw error;
  }

  const resourceCounts = await getItemResourceCounts(Number(item.id));
  if (resourceCounts.total > 0) {
    const error = new Error(SINGLE_RESOURCE_ATTACH_MESSAGE);
    error.status = 409;
    throw error;
  }

  try {
    await withTransaction(async (conn) => {
      for (const file of files) {
        const buffer = await readFile(file.filepath);
        const sha256 = createHash("sha256").update(buffer).digest("hex");
        const extension = path
          .extname(file.originalFilename || "")
          .toLowerCase();
        const filePublicId = buildPublicId("cef");
        const storageKey = `${storageKeyPrefix}/${assetPublicId}/${filePublicId}${extension}`;
        const stored = await storage.save({ buffer, storageKey });
        await execSql(
          conn,
          `INSERT INTO commercial_enablement_item_files
            (public_id, item_id, storage_provider, storage_bucket, storage_key,
             original_file_name, stored_file_name, mime_type, file_extension,
             byte_size, sha256, uploaded_by_user_id, is_deleted,
             created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NOW(3), NOW(3))`,
          [
            filePublicId,
            Number(item.id),
            stored.storageProvider,
            stored.storageBucket,
            stored.storageKey,
            file.originalFilename || path.basename(file.filepath),
            stored.storedFileName,
            file.mimetype || "application/octet-stream",
            extension,
            Number(file.size || 0),
            sha256,
            Number(user.id),
          ],
        );
      }
      await execSql(
        conn,
        `UPDATE commercial_enablement_items
         SET source_type = ?, updated_by_user_id = ?, updated_at = NOW(3)
         WHERE id = ?`,
        ["file", Number(user.id), Number(item.id)],
      );
    });
  } finally {
    await cleanupTempFiles(files).catch(() => undefined);
  }

  return getCommercialEnablementAssetDetail({ user, assetPublicId });
}

export async function updateCommercialEnablementFile({
  req,
  assetPublicId,
  filePublicId,
  user,
}) {
  const fileRow = await getItemFileRow({
    itemPublicId: assetPublicId,
    filePublicId,
  });
  if (!fileRow) {
    const error = new Error("Archivo no encontrado");
    error.status = 404;
    throw error;
  }

  const itemRows = await query(
    `SELECT * FROM commercial_enablement_items WHERE id = ? AND is_deleted = 0 LIMIT 1`,
    [Number(fileRow.item_id)],
  );
  const item = itemRows[0];
  const canEdit =
    canManageEnablement(user) ||
    Number(item.owner_user_id || 0) === Number(user.id) ||
    Number(item.created_by_user_id || 0) === Number(user.id);
  if (!canEdit) {
    const error = new Error("No autorizado para reemplazar este archivo");
    error.status = 403;
    throw error;
  }

  const { files } = await parseMultipartFiles(req);
  if (!files.length) {
    const error = new Error("No se recibio ningun archivo");
    error.status = 400;
    throw error;
  }
  if (files.length > 1) {
    const error = new Error("Solo se permite un archivo por activo");
    error.status = 400;
    throw error;
  }

  const nextFile = files[0];
  const previousStorageKey = fileRow.storage_key;
  const previousStorageBucket = fileRow.storage_bucket;

  try {
    const buffer = await readFile(nextFile.filepath);
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const extension = path
      .extname(nextFile.originalFilename || "")
      .toLowerCase();
    const storageKey = `${storageKeyPrefix}/${assetPublicId}/${filePublicId}${extension}`;
    const stored = await storage.save({ buffer, storageKey });

    await query(
      `UPDATE commercial_enablement_item_files
       SET storage_provider = ?, storage_bucket = ?, storage_key = ?,
           original_file_name = ?, stored_file_name = ?, mime_type = ?,
           file_extension = ?, byte_size = ?, sha256 = ?, uploaded_by_user_id = ?,
           updated_at = NOW(3)
       WHERE public_id = ? AND item_id = ? AND is_deleted = 0`,
      [
        stored.storageProvider,
        stored.storageBucket,
        stored.storageKey,
        nextFile.originalFilename || path.basename(nextFile.filepath),
        stored.storedFileName,
        nextFile.mimetype || "application/octet-stream",
        extension,
        Number(nextFile.size || 0),
        sha256,
        Number(user.id),
        filePublicId,
        Number(item.id),
      ],
    );

    if (
      previousStorageKey &&
      (previousStorageKey !== stored.storageKey ||
        previousStorageBucket !== stored.storageBucket)
    ) {
      await storage
        .delete({
          storageKey: previousStorageKey,
          storageBucket: previousStorageBucket,
        })
        .catch(() => undefined);
    }
  } finally {
    await cleanupTempFiles(files).catch(() => undefined);
  }

  return getCommercialEnablementAssetDetail({ user, assetPublicId });
}

export async function deleteCommercialEnablementFile({
  assetPublicId,
  filePublicId,
  user,
}) {
  const fileRow = await getItemFileRow({
    itemPublicId: assetPublicId,
    filePublicId,
  });
  if (!fileRow) {
    const error = new Error("Archivo no encontrado");
    error.status = 404;
    throw error;
  }
  const itemRows = await query(
    `SELECT * FROM commercial_enablement_items WHERE id = ? AND is_deleted = 0 LIMIT 1`,
    [Number(fileRow.item_id)],
  );
  const item = itemRows[0];
  const canEdit =
    canManageEnablement(user) ||
    Number(item.owner_user_id || 0) === Number(user.id) ||
    Number(item.created_by_user_id || 0) === Number(user.id);
  if (!canEdit) {
    const error = new Error("No autorizado para eliminar este archivo");
    error.status = 403;
    throw error;
  }

  const resourceCounts = await getItemResourceCounts(Number(item.id));
  if (resourceCounts.total <= 1) {
    const error = new Error(
      "No puedes eliminar el unico recurso del activo. Modifica el activo o reemplaza el recurso en su lugar.",
    );
    error.status = 409;
    throw error;
  }

  await query(
    `UPDATE commercial_enablement_item_files
     SET is_deleted = 1, updated_at = NOW(3)
     WHERE public_id = ?`,
    [filePublicId],
  );
  await storage
    .delete({
      storageKey: fileRow.storage_key,
      storageBucket: fileRow.storage_bucket,
    })
    .catch(() => undefined);
  return getCommercialEnablementAssetDetail({ user, assetPublicId });
}

export async function getCommercialEnablementFileStream({
  assetPublicId,
  filePublicId,
  user,
}) {
  const asset = await getCommercialEnablementAssetDetail({
    user,
    assetPublicId,
  });
  if (!asset) return null;
  const file = asset.files.find(
    (candidate) => candidate.publicId === filePublicId,
  );
  if (!file) return null;

  if (file.isAvailable === false) {
    const missingError = new Error("Archivo no disponible en almacenamiento");
    missingError.status = 404;
    throw missingError;
  }

  try {
    const stream = await storage.openReadStream({
      storageKey: file.storageKey,
      storageBucket: file.storageBucket,
    });
    return {
      stream,
      mimeType: file.mimeType,
      fileName: file.originalFileName || file.storedFileName || "archivo",
    };
  } catch (error) {
    const streamError = new Error(
      error?.code === "ENOENT"
        ? "Archivo no disponible en almacenamiento"
        : "No fue posible abrir el archivo almacenado",
    );
    streamError.status = error?.code === "ENOENT" ? 404 : 502;
    streamError.cause = error;
    throw streamError;
  }
}

export async function createCommercialEnablementLink({
  assetPublicId,
  body,
  user,
}) {
  const asset = await getCommercialEnablementAssetDetail({
    user,
    assetPublicId,
  });
  if (!asset) {
    const error = new Error("Activo no encontrado");
    error.status = 404;
    throw error;
  }
  if (!(canManageEnablement(user) || asset.canEdit)) {
    const error = new Error("No autorizado para editar enlaces");
    error.status = 403;
    throw error;
  }

  const url = String(body.url || "").trim();
  if (!url) {
    const error = new Error("URL requerida");
    error.status = 400;
    throw error;
  }
  if (asset.files.length + asset.links.length > 0) {
    const error = new Error(SINGLE_RESOURCE_ATTACH_MESSAGE);
    error.status = 409;
    throw error;
  }

  await withTransaction(async (conn) => {
    await conn.query(
      `INSERT INTO commercial_enablement_item_links
        (public_id, item_id, url, link_type, label, description, is_primary,
         created_by_user_id, created_at, updated_at, is_deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3), 0)`,
      [
        buildPublicId("cel"),
        Number(asset.id),
        url,
        String(body.linkType || "external").trim() || "external",
        String(body.label || url)
          .trim()
          .slice(0, 190),
        String(body.description || "").trim(),
        boolToTinyInt(Boolean(body.isPrimary)),
        Number(user.id),
      ],
    );
    await conn.query(
      `UPDATE commercial_enablement_items
       SET source_type = ?, updated_by_user_id = ?, updated_at = NOW(3)
       WHERE id = ?`,
      ["url", Number(user.id), Number(asset.id)],
    );
  });

  return getCommercialEnablementAssetDetail({ user, assetPublicId });
}

export async function updateCommercialEnablementLink({
  assetPublicId,
  linkPublicId,
  body,
  user,
}) {
  const asset = await getCommercialEnablementAssetDetail({
    user,
    assetPublicId,
  });
  if (!asset) {
    const error = new Error("Activo no encontrado");
    error.status = 404;
    throw error;
  }
  if (!(canManageEnablement(user) || asset.canEdit)) {
    const error = new Error("No autorizado para editar enlaces");
    error.status = 403;
    throw error;
  }
  await query(
    `UPDATE commercial_enablement_item_links
     SET url = ?, link_type = ?, label = ?, description = ?, is_primary = ?, updated_at = NOW(3)
     WHERE public_id = ? AND item_id = ? AND is_deleted = 0`,
    [
      String(body.url || "").trim(),
      String(body.linkType || "external").trim() || "external",
      String(body.label || body.url || "")
        .trim()
        .slice(0, 190),
      String(body.description || "").trim(),
      boolToTinyInt(Boolean(body.isPrimary)),
      linkPublicId,
      Number(asset.id),
    ],
  );
  return getCommercialEnablementAssetDetail({ user, assetPublicId });
}

export async function deleteCommercialEnablementLink({
  assetPublicId,
  linkPublicId,
  user,
}) {
  const asset = await getCommercialEnablementAssetDetail({
    user,
    assetPublicId,
  });
  if (!asset) {
    const error = new Error("Activo no encontrado");
    error.status = 404;
    throw error;
  }
  if (!(canManageEnablement(user) || asset.canEdit)) {
    const error = new Error("No autorizado para editar enlaces");
    error.status = 403;
    throw error;
  }
  if (asset.files.length + asset.links.length <= 1) {
    const error = new Error(
      "No puedes eliminar el unico recurso del activo. Modifica el activo o reemplaza el recurso en su lugar.",
    );
    error.status = 409;
    throw error;
  }
  await query(
    `UPDATE commercial_enablement_item_links
     SET is_deleted = 1, updated_at = NOW(3)
     WHERE public_id = ? AND item_id = ?`,
    [linkPublicId, Number(asset.id)],
  );
  return getCommercialEnablementAssetDetail({ user, assetPublicId });
}

export async function validateCommercialEnablementAsset({
  assetPublicId,
  user,
}) {
  const asset = await getCommercialEnablementAssetDetail({
    user,
    assetPublicId,
  });
  if (!asset) {
    const error = new Error("Activo no encontrado");
    error.status = 404;
    throw error;
  }
  const issues = [];
  if (!asset.title) issues.push("Titulo requerido");
  if (!asset.summary) issues.push("Resumen requerido");
  if (!asset.assetTypeCode) issues.push("Tipo de activo requerido");
  if (
    ![
      "client_safe",
      "internal_sales",
      "internal_company",
      "restricted",
    ].includes(asset.visibilityLevel)
  ) {
    issues.push("Visibilidad invalida");
  }
  if (
    !asset.catalogs.some((catalog) => catalog.catalogType === "manufacturer") &&
    !asset.catalogs.some((catalog) => catalog.catalogType === "solution")
  ) {
    issues.push("Debes indicar al menos un fabricante o una solucion");
  }
  if (asset.files.length + asset.links.length > 1) {
    issues.push(SINGLE_RESOURCE_VALIDATION_MESSAGE);
  }
  if (!asset.files.length && !asset.links.length) {
    issues.push("Debes adjuntar al menos un archivo o una URL");
  }
  return { ok: issues.length === 0, issues, asset };
}

async function changeAssetStatus({ assetPublicId, user, status }) {
  const validation = await validateCommercialEnablementAsset({
    assetPublicId,
    user,
  });
  if (status === "published" && !validation.ok) {
    const error = new Error(validation.issues.join(". "));
    error.status = 400;
    throw error;
  }
  if (!canManageEnablement(user) && !canAdminEnablement(user)) {
    const error = new Error("No autorizado para cambiar el estado");
    error.status = 403;
    throw error;
  }
  await query(
    `UPDATE commercial_enablement_items
     SET status = ?, updated_by_user_id = ?, updated_at = NOW(3)
     WHERE public_id = ?`,
    [status, Number(user.id), assetPublicId],
  );
  return getCommercialEnablementAssetDetail({ user, assetPublicId });
}

export async function publishCommercialEnablementAsset({
  assetPublicId,
  user,
}) {
  return changeAssetStatus({ assetPublicId, user, status: "published" });
}

export async function obsoleteCommercialEnablementAsset({
  assetPublicId,
  user,
}) {
  return changeAssetStatus({ assetPublicId, user, status: "obsolete" });
}

export async function archiveCommercialEnablementAsset({
  assetPublicId,
  user,
}) {
  return changeAssetStatus({ assetPublicId, user, status: "archived" });
}

export async function deleteCommercialEnablementAsset({ assetPublicId, user }) {
  const asset = await getCommercialEnablementAssetDetail({
    user,
    assetPublicId,
  });
  if (!asset) {
    const error = new Error("Activo no encontrado");
    error.status = 404;
    throw error;
  }
  if (!canManageEnablement(user) && !canAdminEnablement(user)) {
    const error = new Error("No autorizado para eliminar este activo");
    error.status = 403;
    throw error;
  }

  await Promise.all(
    asset.files.map((file) =>
      storage
        .delete({
          storageKey: file.storageKey,
          storageBucket: file.storageBucket,
        })
        .catch(() => undefined),
    ),
  );

  await query(
    `UPDATE commercial_enablement_items
     SET is_deleted = 1, updated_by_user_id = ?, updated_at = NOW(3)
     WHERE public_id = ?`,
    [Number(user.id), assetPublicId],
  );

  return {
    deletedPublicId: asset.publicId,
    title: asset.title,
  };
}

export async function duplicateCommercialEnablementAsset({
  assetPublicId,
  user,
}) {
  const asset = await getCommercialEnablementAssetDetail({
    user,
    assetPublicId,
  });
  if (!asset) {
    const error = new Error("Activo no encontrado");
    error.status = 404;
    throw error;
  }
  if (!(canManageEnablement(user) || asset.canEdit)) {
    const error = new Error("No autorizado para duplicar este activo");
    error.status = 403;
    throw error;
  }
  if (asset.files.length + asset.links.length > 1) {
    const error = new Error(
      "No se puede duplicar un activo con multiples recursos. Deja un solo archivo o una sola URL antes de duplicarlo.",
    );
    error.status = 409;
    throw error;
  }
  const duplicatePublicId = buildPublicId("cea");
  await withTransaction(async (conn) => {
    const result = await execSql(
      conn,
      `INSERT INTO commercial_enablement_items
        (public_id, title, summary, internal_description, asset_type_code,
         status, source_type, visibility_level, audience_code, language_code,
         owner_user_id, created_by_user_id, updated_by_user_id, is_internal,
         is_downloadable, is_featured, search_text,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
      [
        duplicatePublicId,
        `${asset.title} copia`,
        asset.summary,
        asset.internalDescription,
        asset.assetTypeCode,
        asset.sourceType,
        asset.visibilityLevel,
        asset.audienceCode,
        asset.languageCode,
        asset.ownerUserId || Number(user.id),
        Number(user.id),
        Number(user.id),
        boolToTinyInt(asset.isInternal),
        boolToTinyInt(asset.isDownloadable),
        boolToTinyInt(asset.isFeatured),
        asset.searchText,
      ],
    );
    const duplicateId = Number(result.insertId);
    for (const catalog of asset.catalogs) {
      await execSql(
        conn,
        `INSERT INTO commercial_enablement_item_catalog_links (item_id, catalog_entry_id, created_at)
         VALUES (?, ?, NOW(3))`,
        [duplicateId, catalog.id],
      );
    }
    for (const tag of asset.tags) {
      await execSql(
        conn,
        `INSERT INTO commercial_enablement_item_tags
          (item_id, tag_group, value_code, value_label, created_at)
         VALUES (?, ?, ?, ?, NOW(3))`,
        [duplicateId, tag.tagGroup, tag.code, tag.label],
      );
    }
    for (const link of asset.links) {
      await execSql(
        conn,
        `INSERT INTO commercial_enablement_item_links
          (public_id, item_id, url, link_type, label, description, is_primary,
           created_by_user_id, created_at, updated_at, is_deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3), 0)`,
        [
          buildPublicId("cel"),
          duplicateId,
          link.url,
          link.linkType,
          link.label,
          link.description,
          boolToTinyInt(link.isPrimary),
          Number(user.id),
        ],
      );
    }
    for (const file of asset.files) {
      await execSql(
        conn,
        `INSERT INTO commercial_enablement_item_files
          (public_id, item_id, storage_provider, storage_bucket, storage_key,
           original_file_name, stored_file_name, mime_type, file_extension,
           byte_size, sha256, uploaded_by_user_id, is_deleted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NOW(3), NOW(3))`,
        [
          buildPublicId("cef"),
          duplicateId,
          file.storageProvider,
          file.storageBucket,
          file.storageKey,
          file.originalFileName,
          file.storedFileName,
          file.mimeType,
          file.fileExtension,
          file.byteSize,
          createHash("sha256")
            .update(`${file.storageKey}:${duplicatePublicId}`)
            .digest("hex"),
          Number(user.id),
        ],
      );
    }
  });
  return getCommercialEnablementAssetDetail({
    user,
    assetPublicId: duplicatePublicId,
  });
}

export async function createCommercialEnablementRelation({
  assetPublicId,
  body,
  user,
}) {
  const asset = await getCommercialEnablementAssetDetail({
    user,
    assetPublicId,
  });
  if (!asset) {
    const error = new Error("Activo no encontrado");
    error.status = 404;
    throw error;
  }
  if (!(canManageEnablement(user) || asset.canEdit)) {
    const error = new Error("No autorizado para relacionar activos");
    error.status = 403;
    throw error;
  }
  const relatedPublicId = String(body.relatedAssetPublicId || "").trim();
  const related = await getCommercialEnablementAssetDetail({
    user,
    assetPublicId: relatedPublicId,
  });
  if (!related) {
    const error = new Error("Activo relacionado no encontrado");
    error.status = 404;
    throw error;
  }
  await query(
    `INSERT INTO commercial_enablement_item_relations
      (item_id, related_item_id, relation_type, created_by_user_id, created_at)
     VALUES (?, ?, ?, ?, NOW(3))`,
    [
      Number(asset.id),
      Number(related.id),
      String(body.relationType || "related_to"),
      Number(user.id),
    ],
  );
  return getCommercialEnablementAssetDetail({ user, assetPublicId });
}

export async function deleteCommercialEnablementRelation({
  assetPublicId,
  relationId,
  user,
}) {
  const asset = await getCommercialEnablementAssetDetail({
    user,
    assetPublicId,
  });
  if (!asset) {
    const error = new Error("Activo no encontrado");
    error.status = 404;
    throw error;
  }
  if (!(canManageEnablement(user) || asset.canEdit)) {
    const error = new Error("No autorizado para eliminar relaciones");
    error.status = 403;
    throw error;
  }
  await query(
    `DELETE FROM commercial_enablement_item_relations
     WHERE id = ? AND item_id = ?`,
    [Number(relationId), Number(asset.id)],
  );
  return getCommercialEnablementAssetDetail({ user, assetPublicId });
}

export async function recordCommercialEnablementUsageEvent({
  assetPublicId,
  eventType,
  user,
  contextType = null,
  contextEntityId = null,
  metadata = null,
}) {
  const asset = await getCommercialEnablementAssetDetail({
    user,
    assetPublicId,
  });
  if (!asset) {
    const error = new Error("Activo no encontrado");
    error.status = 404;
    throw error;
  }
  await query(
    `INSERT INTO commercial_enablement_usage_events_v2
      (item_id, user_id, event_type, context_type, context_entity_id, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW(3))`,
    [
      Number(asset.id),
      user?.id ? Number(user.id) : null,
      String(eventType || "viewed"),
      contextType || null,
      contextEntityId ? Number(contextEntityId) : null,
      metadata ? JSON.stringify(metadata) : null,
    ],
  );
  return getCommercialEnablementAssetDetail({ user, assetPublicId });
}

export async function listCommercialEnablementRecent({
  user,
  raw = null,
  items = null,
}) {
  const currentRaw = raw || (await loadRawEnablementData());
  const currentItems = items || assembleEnablementItems(currentRaw, user);
  const userId = Number(user?.id || 0);
  if (!userId) return [];
  const latestUsage = new Map();
  currentRaw.usageRows
    .filter((row) => Number(row.user_id || 0) === userId)
    .forEach((row) => {
      const itemId = Number(row.item_id);
      if (
        !latestUsage.has(itemId) ||
        String(row.created_at) > String(latestUsage.get(itemId).createdAt)
      ) {
        latestUsage.set(itemId, { createdAt: row.created_at });
      }
    });
  return Array.from(latestUsage.entries())
    .sort((left, right) =>
      String(right[1].createdAt).localeCompare(String(left[1].createdAt)),
    )
    .map(([itemId]) =>
      currentItems.find((item) => Number(item.id) === Number(itemId)),
    )
    .filter(Boolean)
    .slice(0, 8);
}

export async function listCommercialEnablementFavorites({
  user,
  raw = null,
  items = null,
}) {
  const currentRaw = raw || (await loadRawEnablementData());
  const currentItems = items || assembleEnablementItems(currentRaw, user);
  const favoriteIds = new Set(
    currentRaw.favoriteRows
      .filter((row) => Number(row.user_id || 0) === Number(user?.id || 0))
      .map((row) => Number(row.item_id)),
  );
  return currentItems
    .filter((item) => favoriteIds.has(Number(item.id)))
    .slice(0, 12);
}

export async function addCommercialEnablementFavorite({ assetPublicId, user }) {
  const asset = await getCommercialEnablementAssetDetail({
    user,
    assetPublicId,
  });
  if (!asset) {
    const error = new Error("Activo no encontrado");
    error.status = 404;
    throw error;
  }
  await query(
    `INSERT IGNORE INTO commercial_enablement_favorites
      (user_id, item_id, created_at)
     VALUES (?, ?, NOW(3))`,
    [Number(user.id), Number(asset.id)],
  );
  await recordCommercialEnablementUsageEvent({
    assetPublicId,
    eventType: "favorited",
    user,
    contextType: "enablement_module",
    contextEntityId: asset.id,
  }).catch(() => undefined);
  return getCommercialEnablementAssetDetail({ user, assetPublicId });
}

export async function removeCommercialEnablementFavorite({
  assetPublicId,
  user,
}) {
  const asset = await getCommercialEnablementAssetDetail({
    user,
    assetPublicId,
  });
  if (!asset) {
    const error = new Error("Activo no encontrado");
    error.status = 404;
    throw error;
  }
  await query(
    `DELETE FROM commercial_enablement_favorites
     WHERE user_id = ? AND item_id = ?`,
    [Number(user.id), Number(asset.id)],
  );
  return getCommercialEnablementAssetDetail({ user, assetPublicId });
}

function assembleCollections(raw, items, user) {
  const itemMap = new Map(items.map((item) => [Number(item.id), item]));
  return raw.collectionRows
    .filter((row) => Number(row.user_id) === Number(user?.id || 0))
    .map((row) => {
      const collectionItems = raw.collectionItemRows
        .filter((item) => Number(item.collection_id) === Number(row.id))
        .map((item) => itemMap.get(Number(item.item_id)))
        .filter(Boolean);
      return {
        id: Number(row.id),
        publicId: row.public_id,
        name: row.name,
        description: row.description || "",
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        items: collectionItems,
      };
    });
}

export async function listCommercialEnablementCollections({
  user,
  raw = null,
  items = null,
}) {
  const currentRaw = raw || (await loadRawEnablementData());
  const currentItems = items || assembleEnablementItems(currentRaw, user);
  return assembleCollections(currentRaw, currentItems, user);
}

export async function createCommercialEnablementCollection({ body, user }) {
  const name = String(body.name || "").trim();
  if (!name) {
    const error = new Error("Nombre requerido");
    error.status = 400;
    throw error;
  }
  const publicId = buildPublicId("cec");
  await query(
    `INSERT INTO commercial_enablement_collections
      (public_id, user_id, name, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, NOW(3), NOW(3))`,
    [
      publicId,
      Number(user.id),
      name,
      String(body.description || "").trim() || null,
    ],
  );
  const collections = await listCommercialEnablementCollections({ user });
  return (
    collections.find((collection) => collection.publicId === publicId) || null
  );
}

export async function getCommercialEnablementCollection({
  collectionPublicId,
  user,
}) {
  const collections = await listCommercialEnablementCollections({ user });
  return (
    collections.find(
      (collection) => collection.publicId === collectionPublicId,
    ) || null
  );
}

export async function addCommercialEnablementCollectionItem({
  collectionPublicId,
  assetPublicId,
  user,
}) {
  const collection = await getCommercialEnablementCollection({
    collectionPublicId,
    user,
  });
  if (!collection) {
    const error = new Error("Coleccion no encontrada");
    error.status = 404;
    throw error;
  }
  const asset = await getCommercialEnablementAssetDetail({
    user,
    assetPublicId,
  });
  if (!asset) {
    const error = new Error("Activo no encontrado");
    error.status = 404;
    throw error;
  }
  const currentMax = await query(
    `SELECT COALESCE(MAX(sort_order), 0) AS current_max
     FROM commercial_enablement_collection_items
     WHERE collection_id = ?`,
    [Number(collection.id)],
  );
  await query(
    `INSERT IGNORE INTO commercial_enablement_collection_items
      (collection_id, item_id, sort_order, created_at)
     VALUES (?, ?, ?, NOW(3))`,
    [
      Number(collection.id),
      Number(asset.id),
      Number(currentMax[0]?.current_max || 0) + 1,
    ],
  );
  await recordCommercialEnablementUsageEvent({
    assetPublicId,
    eventType: "added_to_collection",
    user,
    contextType: "collection",
    contextEntityId: collection.id,
  }).catch(() => undefined);
  return getCommercialEnablementCollection({ collectionPublicId, user });
}

export async function removeCommercialEnablementCollectionItem({
  collectionPublicId,
  assetPublicId,
  user,
}) {
  const collection = await getCommercialEnablementCollection({
    collectionPublicId,
    user,
  });
  if (!collection) {
    const error = new Error("Coleccion no encontrada");
    error.status = 404;
    throw error;
  }
  const asset = await getCommercialEnablementAssetDetail({
    user,
    assetPublicId,
  });
  if (!asset) {
    const error = new Error("Activo no encontrado");
    error.status = 404;
    throw error;
  }
  await query(
    `DELETE FROM commercial_enablement_collection_items
     WHERE collection_id = ? AND item_id = ?`,
    [Number(collection.id), Number(asset.id)],
  );
  return getCommercialEnablementCollection({ collectionPublicId, user });
}

export async function buildCommercialEnablementCollectionSharePackage({
  collectionPublicId,
  user,
}) {
  const collection = await getCommercialEnablementCollection({
    collectionPublicId,
    user,
  });
  if (!collection) {
    const error = new Error("Coleccion no encontrada");
    error.status = 404;
    throw error;
  }
  const shareableItems = collection.items.filter((item) =>
    COLLECTION_SHAREABLE_VISIBILITIES.has(item.visibilityLevel),
  );
  const blockedItems = collection.items.filter(
    (item) => !COLLECTION_SHAREABLE_VISIBILITIES.has(item.visibilityLevel),
  );
  return {
    collection: {
      publicId: collection.publicId,
      name: collection.name,
      itemCount: collection.items.length,
    },
    shareableItems: shareableItems.map((item) => ({
      publicId: item.publicId,
      title: item.title,
      links: item.links,
      fileCount: item.files.length,
    })),
    blockedItems: blockedItems.map((item) => ({
      publicId: item.publicId,
      title: item.title,
      visibilityLevel: item.visibilityLevel,
    })),
  };
}

export async function getCommercialEnablementAnalyticsOverview({ user }) {
  await ensureCommercialEnablementStarterData();
  if (!canManageEnablement(user) && !canAdminEnablement(user)) {
    const error = new Error("No autorizado");
    error.status = 403;
    throw error;
  }
  const raw = await loadRawEnablementData();
  const items = assembleEnablementItems(raw, user);
  const published = items.filter((item) => item.status === "published");
  const usageByType = published.reduce((accumulator, item) => {
    accumulator[item.assetTypeCode] =
      (accumulator[item.assetTypeCode] || 0) + item.usageCount;
    return accumulator;
  }, {});
  const topItems = [...published]
    .sort((left, right) => right.usageCount - left.usageCount)
    .slice(0, 10)
    .map((item) => ({
      publicId: item.publicId,
      title: item.title,
      usageCount: item.usageCount,
      visibilityLevel: item.visibilityLevel,
      assetTypeLabel: item.assetTypeLabel,
    }));
  return {
    totals: {
      totalAssets: items.length,
      publishedAssets: published.length,
      totalUsageEvents: raw.usageRows.length,
      totalFavorites: raw.favoriteRows.length,
      totalCollections: raw.collectionRows.length,
    },
    usageByType,
    topItems,
  };
}

export async function getCommercialEnablementGovernanceOverview({ user }) {
  await ensureCommercialEnablementStarterData();
  if (!canManageEnablement(user) && !canAdminEnablement(user)) {
    const error = new Error("No autorizado");
    error.status = 403;
    throw error;
  }
  const raw = await loadRawEnablementData();
  const items = assembleEnablementItems(raw, user);
  const qualityIssues = items.filter((item) => {
    const hasManufacturerOrSolution = item.catalogs.some((catalog) =>
      ["manufacturer", "solution"].includes(catalog.catalogType),
    );
    const hasNeedOrRequirement = item.catalogs.some((catalog) =>
      ["need", "requirement"].includes(catalog.catalogType),
    );
    return (
      !hasManufacturerOrSolution ||
      !hasNeedOrRequirement ||
      (!item.files.length && !item.links.length)
    );
  });
  const duplicates = items.filter(
    (item, index, array) =>
      array.findIndex(
        (candidate) =>
          normalizeText(candidate.title) === normalizeText(item.title),
      ) !== index,
  );
  return {
    summary: {
      totalAssets: items.length,
      draftAssets: items.filter((item) => item.status === "draft").length,
      obsoleteAssets: items.filter((item) => item.status === "obsolete").length,
      qualityIssues: qualityIssues.length,
      duplicateCandidates: duplicates.length,
    },
    qualityIssues: qualityIssues.slice(0, 20).map((item) => ({
      publicId: item.publicId,
      title: item.title,
      status: item.status,
      hasFilesOrLinks: Boolean(item.files.length || item.links.length),
      categoriesCount: item.catalogs.length,
    })),
    duplicateCandidates: duplicates.slice(0, 20).map((item) => ({
      publicId: item.publicId,
      title: item.title,
      updatedAt: item.updatedAt,
    })),
    manageableItems: items.slice(0, 20).map((item) => ({
      publicId: item.publicId,
      title: item.title,
      status: item.status,
      updatedAt: item.updatedAt,
      assetTypeLabel: item.assetTypeLabel,
      usageCount: item.usageCount,
    })),
  };
}

export async function createCommercialEnablementCatalogEntry({
  catalogType,
  body,
  user,
}) {
  if (!canAdminEnablement(user)) {
    const error = new Error("No autorizado");
    error.status = 403;
    throw error;
  }
  const name = String(body.name || "").trim();
  const code =
    String(body.code || "").trim() || normalizeText(name).replace(/\s+/g, "_");
  if (!catalogType || !name) {
    const error = new Error("catalogType y name son requeridos");
    error.status = 400;
    throw error;
  }
  await upsertCatalogEntry(query, {
    catalogType,
    code,
    name,
    description: String(body.description || "").trim(),
    sortOrder: Number(body.sortOrder || 0),
  });
  return buildCommercialEnablementCatalogResponse(user);
}

export async function updateCommercialEnablementCatalogEntry({
  catalogPublicId,
  body,
  user,
}) {
  if (!canAdminEnablement(user)) {
    const error = new Error("No autorizado");
    error.status = 403;
    throw error;
  }
  const normalizedName = String(body.name || "").trim();
  const normalizedCode =
    String(body.code || "").trim() ||
    normalizeText(normalizedName).replace(/\s+/g, "_");
  await query(
    `UPDATE commercial_enablement_catalog_entries
     SET code = ?, name = ?, description = ?, sort_order = ?, is_active = ?, updated_at = NOW(3)
     WHERE public_id = ?`,
    [
      normalizedCode,
      normalizedName,
      String(body.description || "").trim() || null,
      Number(body.sortOrder || 0),
      boolToTinyInt(body.isActive !== false),
      catalogPublicId,
    ],
  );
  return buildCommercialEnablementCatalogResponse(user);
}

export async function deleteCommercialEnablementCatalogEntry({
  catalogPublicId,
  user,
}) {
  if (!canAdminEnablement(user)) {
    const error = new Error("No autorizado");
    error.status = 403;
    throw error;
  }

  const rows = await query(
    `SELECT id, catalog_type, code
     FROM commercial_enablement_catalog_entries
     WHERE public_id = ?
     LIMIT 1`,
    [catalogPublicId],
  );
  const entry = rows[0] || null;

  if (!entry) {
    const error = new Error("Opcion de catalogo no encontrada");
    error.status = 404;
    throw error;
  }

  await withTransaction(async (conn) => {
    if (isStaticCatalogSeed(entry.catalog_type, entry.code)) {
      await execSql(
        conn,
        `INSERT INTO commercial_enablement_catalog_seed_tombstones
          (catalog_type, code, deleted_by_user_id, deleted_at)
         VALUES (?, ?, ?, NOW(3))
         ON DUPLICATE KEY UPDATE
           deleted_by_user_id = VALUES(deleted_by_user_id),
           deleted_at = VALUES(deleted_at)`,
        [entry.catalog_type, entry.code, Number(user.id) || null],
      );
    }

    await execSql(
      conn,
      `DELETE FROM commercial_enablement_catalog_entries WHERE public_id = ?`,
      [catalogPublicId],
    );
  });

  return buildCommercialEnablementCatalogResponse(user);
}

export async function openCommercialEnablementLink({
  assetPublicId,
  linkPublicId,
  user,
}) {
  const asset = await getCommercialEnablementAssetDetail({
    user,
    assetPublicId,
  });
  if (!asset) return null;
  const link = asset.links.find(
    (candidate) => candidate.publicId === linkPublicId,
  );
  if (!link) return null;
  await recordCommercialEnablementUsageEvent({
    assetPublicId,
    eventType: "opened_link",
    user,
    contextType: "enablement_module",
    contextEntityId: asset.id,
    metadata: { linkPublicId },
  }).catch(() => undefined);
  return link;
}

export async function getCommercialEnablementDashboard({ user = null } = {}) {
  const bootstrap = await getCommercialEnablementBootstrap({ user });
  return bootstrap;
}

export async function loadCommercialEnablementRecommendationCatalog() {
  await ensureCommercialEnablementStarterData();
  const raw = await loadRawEnablementData();
  const items = assembleEnablementItems(raw, {
    permissionSet: new Set(["enablement_comercial.manage"]),
    id: null,
  }).filter((item) => item.status === "published");
  return items;
}

export function recommendCommercialEnablementResources({
  catalog = [],
  context = {},
}) {
  const stageCode = normalizeText(context.stageCode).replace(/\s+/g, "_");
  const riskReasons = Array.isArray(context.riskReasons)
    ? context.riskReasons.map((reason) => normalizeText(reason))
    : [];
  const roleTags = uniqueStrings(context.roleTags || []).map((tag) =>
    normalizeText(tag).replace(/\s+/g, "_"),
  );

  return [...catalog]
    .map((item) => {
      let score = 0;
      if (
        item.tags.some(
          (tag) => tag.tagGroup === "stage" && tag.code === stageCode,
        )
      )
        score += 3;
      if (
        item.tags.some(
          (tag) =>
            tag.tagGroup === "recommended_role" && roleTags.includes(tag.code),
        )
      )
        score += 2;
      if (
        riskReasons.some((risk) => String(item.searchText || "").includes(risk))
      )
        score += 2;
      if (item.visibilityLevel === "client_safe") score += 1;
      return {
        publicId: item.publicId,
        title: item.title,
        summary: item.summary,
        kindLabel: item.assetTypeLabel,
        recommendationReason:
          score >= 5
            ? "Alta coincidencia con la etapa, el rol y el contexto actual"
            : score >= 3
              ? "Coincide parcialmente con el contexto actual"
              : "Puede servir como material complementario",
        score,
      };
    })
    .filter((item) => item.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        String(left.title).localeCompare(String(right.title), "es"),
    )
    .slice(0, 3);
}
