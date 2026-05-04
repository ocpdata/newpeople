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

export const COMMERCIAL_ENABLEMENT_KIND_GROUPS = {
  library: [
    "case_study",
    "battlecard",
    "one_pager",
    "objection_guide",
    "discovery_guide",
    "industry_questions",
    "value_message",
  ],
  templates: [
    "meeting_template",
    "minutes_template",
    "follow_up_template",
    "executive_recap_template",
    "technical_request_template",
  ],
  solutionGuides: ["solution_guide"],
  roleGuides: ["manager_guide", "presales_guide"],
};

const KIND_LABELS = {
  case_study: "Caso de exito",
  battlecard: "Battlecard",
  one_pager: "One-pager",
  objection_guide: "Guia de objeciones",
  discovery_guide: "Discovery guide",
  industry_questions: "Preguntas por industria",
  value_message: "Mensajes de valor",
  meeting_template: "Agenda de reunion",
  minutes_template: "Minuta",
  follow_up_template: "Correo post-reunion",
  executive_recap_template: "Recap ejecutivo",
  technical_request_template: "Solicitud tecnica",
  solution_guide: "Playbook por solucion",
  manager_guide: "Guia para gerente",
  presales_guide: "Guia para preventa",
};

const STATUS_LABELS = {
  draft: "Borrador",
  published: "Vigente",
  obsolete: "Obsoleto",
};

const STARTER_RESOURCES = [
  {
    kind: "case_study",
    status: "published",
    title: "Caso fintech: acelerar decision en seguridad perimetral",
    summary:
      "Historia corta para abrir conversaciones con bancos, fintech y aseguradoras cuando el dolor es continuidad y visibilidad.",
    bodyMarkdown:
      "Problema: comites lentos y alta sensibilidad a riesgo.\nUso sugerido: etapas Desarrollo y Cotizacion.\nValor: conectar impacto, urgencia y diferenciacion comercial.",
    solutionCodes: ["network_security"],
    industryTags: ["finanzas"],
    stageCodes: ["desarrollo", "cotizacion", "negociacion"],
    themeTags: ["riesgo", "continuidad", "decision"],
    recommendedRoleTags: ["seller", "manager"],
  },
  {
    kind: "battlecard",
    status: "published",
    title: "Battlecard para competencia centrada en precio",
    summary:
      "Argumentario breve para recentrar la conversacion en costo de riesgo, velocidad de ejecucion y capacidad de acompanamiento.",
    bodyMarkdown:
      "Cuando usar: si el deal entra en comparacion economica.\nPreguntas clave: costo de la demora, riesgo operativo, soporte local.\nMovimiento sugerido: pasar de descuento a valor defendible.",
    solutionCodes: ["network_security", "customer_edge"],
    stageCodes: ["cotizacion", "negociacion"],
    themeTags: ["competencia", "precio", "roi"],
    competitorTags: ["competidor_precio"],
    recommendedRoleTags: ["seller"],
  },
  {
    kind: "one_pager",
    status: "published",
    title: "One-pager ejecutivo para infraestructura hibrida segura",
    summary:
      "Resumen comercial de una pagina para decisor economico con mensajes de valor y razones para avanzar a validacion tecnica.",
    bodyMarkdown:
      "Objetivo: facilitar lectura ejecutiva despues de discovery.\nIncluye: problema, impacto, resultado esperado y siguiente paso recomendado.",
    solutionCodes: ["hybrid_infrastructure"],
    stageCodes: ["contacto_inicial", "desarrollo"],
    themeTags: ["valor", "ejecutivo", "sponsor"],
    recommendedRoleTags: ["seller", "manager"],
  },
  {
    kind: "objection_guide",
    status: "published",
    title: "Guia de objeciones para presupuesto congelado",
    summary:
      "Mensajes, preguntas y rutas de salida cuando el cliente no abre presupuesto pero reconoce el problema.",
    bodyMarkdown:
      "Enfoque: costo de la demora, piloto acotado, ROI temprano, escalamiento por riesgo.\nCierra siempre con un compromiso verificable.",
    stageCodes: ["desarrollo", "cotizacion", "negociacion"],
    themeTags: ["presupuesto", "roi", "objeciones"],
    recommendedRoleTags: ["seller", "manager"],
  },
  {
    kind: "discovery_guide",
    status: "published",
    title: "Discovery guide para oportunidad sin dolor claro",
    summary:
      "Secuencia de preguntas para descubrir impacto, urgencia, champion y criterios de decision.",
    bodyMarkdown:
      "Usar cuando la oportunidad esta tibia o sin sponsor claro.\nMeta: salir con dolor cuantificado y siguiente paso calendarizado.",
    stageCodes: ["contacto_inicial", "desarrollo"],
    themeTags: ["discovery", "dolor", "champion"],
    recommendedRoleTags: ["seller"],
  },
  {
    kind: "meeting_template",
    status: "published",
    title: "Agenda de discovery comercial de 45 minutos",
    summary:
      "Plantilla de reunion para abrir contexto, detectar dolor, mapear actores y cerrar proximo paso.",
    bodyMarkdown:
      "Bloques sugeridos: contexto, problema actual, impacto, decision, tiempos, siguiente paso.\nNo cerrar sin fecha y responsable.",
    stageCodes: ["contacto_inicial", "desarrollo"],
    themeTags: ["agenda", "discovery"],
    recommendedRoleTags: ["seller"],
  },
  {
    kind: "follow_up_template",
    status: "published",
    title: "Correo post-reunion con recap y compromiso",
    summary:
      "Plantilla para consolidar acuerdos, reforzar valor y dejar siguiente paso por escrito.",
    bodyMarkdown:
      "Estructura: objetivo compartido, hallazgos, riesgos, documentos prometidos y fecha del siguiente movimiento.",
    stageCodes: ["desarrollo", "cotizacion", "negociacion"],
    themeTags: ["seguimiento", "recap"],
    recommendedRoleTags: ["seller"],
  },
  {
    kind: "executive_recap_template",
    status: "published",
    title: "Recap ejecutivo para sponsor o decisor",
    summary:
      "Resumen de 5 bloques para alinear decisor economico sin saturarlo de detalle tecnico.",
    bodyMarkdown:
      "Bloques: situacion actual, riesgo, impacto esperado, decision pendiente y pedido concreto al sponsor.",
    stageCodes: ["cotizacion", "negociacion", "waiting"],
    themeTags: ["ejecutivo", "sponsor", "decision"],
    recommendedRoleTags: ["seller", "manager"],
  },
  {
    kind: "technical_request_template",
    status: "published",
    title: "Solicitud estructurada para preventa",
    summary:
      "Checklist para pedir apoyo tecnico con mejor contexto y menos reprocesos.",
    bodyMarkdown:
      "Debe incluir: dolor, objetivo comercial, alcance esperado, urgencia, competidor, criterio de exito y fecha del cliente.",
    stageCodes: ["desarrollo", "cotizacion", "demostracion"],
    themeTags: ["preventa", "dependencia", "alineacion"],
    recommendedRoleTags: ["seller", "presales"],
  },
  {
    kind: "solution_guide",
    status: "published",
    title: "Playbook de solucion: Customer Edge",
    summary:
      "Problemas que resuelve, senales de encaje, preguntas de calificacion y riesgos frecuentes.",
    bodyMarkdown:
      "Encaje: multi-sede, experiencia distribuida, visibilidad y seguridad.\nRiesgos: decision difusa, comparacion por precio, falta de sponsor.",
    solutionCodes: ["customer_edge"],
    stageCodes: ["contacto_inicial", "desarrollo", "cotizacion"],
    themeTags: ["solution_playbook", "encaje"],
    recommendedRoleTags: ["seller", "manager", "presales"],
  },
  {
    kind: "manager_guide",
    status: "published",
    title: "Guia de intervencion para gerente comercial",
    summary:
      "Senales para intervenir, preguntas de coaching y tipos de apoyo segun estado de ejecucion.",
    bodyMarkdown:
      "Intervenir cuando: no hay proximo paso, sponsor debil, riesgo alto o dependencia interna bloqueando avance.\nSiempre pedir plan verificable.",
    themeTags: ["coaching", "forecast", "riesgo"],
    recommendedRoleTags: ["manager"],
  },
  {
    kind: "presales_guide",
    status: "published",
    title: "Guia de coordinacion con preventa",
    summary:
      "Define que informacion necesita preventa, cuando conviene involucrarla y como cerrar entregables utiles.",
    bodyMarkdown:
      "Objetivo: evitar que preventa entre tarde o sin contexto.\nResultado esperado: alcance claro, due date y criterio comercial del entregable.",
    themeTags: ["preventa", "colaboracion"],
    recommendedRoleTags: ["seller", "presales", "manager"],
  },
];

function buildResourcePublicId() {
  return `cer_${randomUUID().replace(/-/g, "")}`;
}

function buildAssetPublicId() {
  return `cea_${randomUUID().replace(/-/g, "")}`;
}

function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parseJsonArray(parsed);
    } catch {
      return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function normalizeTag(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function sanitizeFileName(fileName) {
  return String(fileName || "archivo")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 160);
}

function buildAssetStorageKey({
  resourcePublicId,
  assetPublicId,
  fileName,
  sha256,
}) {
  const safeFileName = sanitizeFileName(fileName);
  return path.posix.join(
    "commercial_enablement",
    "resources",
    resourcePublicId,
    assetPublicId,
    `${sha256}__${safeFileName}`,
  );
}

function mapAssetRow(row) {
  return {
    id: Number(row.id),
    publicId: row.public_id,
    originalFileName: row.original_file_name,
    storedFileName: row.stored_file_name || row.original_file_name,
    mimeType: row.mime_type,
    fileExtension: row.file_extension || "",
    byteSize: Number(row.byte_size || 0),
    createdAt: row.created_at,
  };
}

function mapResourceRow(row) {
  return {
    id: Number(row.id),
    publicId: row.public_id,
    kind: row.kind,
    kindLabel: KIND_LABELS[row.kind] || row.kind,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status] || row.status,
    title: row.title,
    summary: row.summary || "",
    bodyMarkdown: row.body_markdown || "",
    solutionCodes: parseJsonArray(row.solution_codes_json),
    industryTags: parseJsonArray(row.industry_tags_json),
    stageCodes: parseJsonArray(row.stage_codes_json),
    themeTags: parseJsonArray(row.theme_tags_json),
    competitorTags: parseJsonArray(row.competitor_tags_json),
    personaTags: parseJsonArray(row.persona_tags_json),
    needTags: parseJsonArray(row.need_tags_json),
    recommendedRoleTags: parseJsonArray(row.recommended_role_tags_json),
    validUntil: row.valid_until,
    usageCount: Number(row.usage_count || 0),
    helpfulCount: Number(row.helpful_count || 0),
    notHelpfulCount: Number(row.not_helpful_count || 0),
    metadata: parseJsonObject(row.metadata_json),
    ownerUserId: row.owner_user_id === null ? null : Number(row.owner_user_id),
    ownerUserName: row.owner_user_name || "Sin owner",
    assetCount: Number(row.asset_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listResourceAssetsByResourceIds(resourceIds) {
  if (!resourceIds.length) return new Map();
  const rows = await query(
    `SELECT id, public_id, resource_id, original_file_name, stored_file_name,
            mime_type, file_extension, byte_size, created_at
     FROM commercial_enablement_assets
     WHERE resource_id IN (${resourceIds.map(() => "?").join(", ")})
       AND is_deleted = 0
     ORDER BY created_at DESC, id DESC`,
    resourceIds,
  );

  return rows.reduce((accumulator, row) => {
    const key = Number(row.resource_id);
    const current = accumulator.get(key) || [];
    current.push(mapAssetRow(row));
    accumulator.set(key, current);
    return accumulator;
  }, new Map());
}

export async function ensureCommercialEnablementStarterData() {
  await ensureCommercialEnablementSchema();
  const rows = await query(
    `SELECT COUNT(*) AS count
     FROM commercial_enablement_resources`,
  );
  if (Number(rows[0]?.count || 0) > 0) {
    return;
  }

  await withTransaction(async (conn) => {
    const now = new Date();
    for (const resource of STARTER_RESOURCES) {
      await conn.query(
        `INSERT INTO commercial_enablement_resources
          (public_id, kind, status, title, summary, body_markdown,
           solution_codes_json, industry_tags_json, stage_codes_json,
           theme_tags_json, competitor_tags_json, persona_tags_json,
           need_tags_json, recommended_role_tags_json, valid_until,
           metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          buildResourcePublicId(),
          resource.kind,
          resource.status,
          resource.title,
          resource.summary,
          resource.bodyMarkdown,
          JSON.stringify(resource.solutionCodes || []),
          JSON.stringify(resource.industryTags || []),
          JSON.stringify(resource.stageCodes || []),
          JSON.stringify(resource.themeTags || []),
          JSON.stringify(resource.competitorTags || []),
          JSON.stringify(resource.personaTags || []),
          JSON.stringify(resource.needTags || []),
          JSON.stringify(resource.recommendedRoleTags || []),
          null,
          JSON.stringify({ starter: true }),
          now,
          now,
        ],
      );
    }
  });
}

export async function listCommercialEnablementResources({
  includeDrafts = true,
} = {}) {
  await ensureCommercialEnablementStarterData();
  const rows = await query(
    `SELECT r.*, owner.full_name AS owner_user_name,
            COUNT(a.id) AS asset_count
     FROM commercial_enablement_resources r
     LEFT JOIN users owner ON owner.id = r.owner_user_id
     LEFT JOIN commercial_enablement_assets a
       ON a.resource_id = r.id AND a.is_deleted = 0
     ${includeDrafts ? "" : "WHERE r.status = 'published'"}
     GROUP BY r.id
     ORDER BY FIELD(r.status, 'published', 'draft', 'obsolete'),
              r.updated_at DESC,
              r.id DESC`,
  );
  const resources = rows.map(mapResourceRow);
  const assetsByResourceId = await listResourceAssetsByResourceIds(
    resources.map((resource) => resource.id),
  );

  return resources.map((resource) => ({
    ...resource,
    assets: assetsByResourceId.get(resource.id) || [],
  }));
}

function groupResources(resources) {
  return {
    library: resources.filter((resource) =>
      COMMERCIAL_ENABLEMENT_KIND_GROUPS.library.includes(resource.kind),
    ),
    templates: resources.filter((resource) =>
      COMMERCIAL_ENABLEMENT_KIND_GROUPS.templates.includes(resource.kind),
    ),
    solutionGuides: resources.filter((resource) =>
      COMMERCIAL_ENABLEMENT_KIND_GROUPS.solutionGuides.includes(resource.kind),
    ),
    roleGuides: resources.filter((resource) =>
      COMMERCIAL_ENABLEMENT_KIND_GROUPS.roleGuides.includes(resource.kind),
    ),
  };
}

function extractUniqueValues(resources, selector) {
  return Array.from(
    new Set(
      resources.flatMap((resource) => selector(resource) || []).filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function buildAnalytics(resources) {
  const publishedCount = resources.filter(
    (resource) => resource.status === "published",
  ).length;
  const obsoleteCount = resources.filter(
    (resource) => resource.status === "obsolete",
  ).length;
  const expiredCount = resources.filter(
    (resource) =>
      resource.validUntil &&
      new Date(resource.validUntil).getTime() < Date.now(),
  ).length;
  const totalUsage = resources.reduce(
    (accumulator, resource) => accumulator + Number(resource.usageCount || 0),
    0,
  );
  const totalHelpful = resources.reduce(
    (accumulator, resource) => accumulator + Number(resource.helpfulCount || 0),
    0,
  );
  const totalNotHelpful = resources.reduce(
    (accumulator, resource) =>
      accumulator + Number(resource.notHelpfulCount || 0),
    0,
  );

  const coverageByKind = Object.entries(groupResources(resources)).map(
    ([group, groupResources]) => ({
      group,
      count: groupResources.length,
      helpfulCount: groupResources.reduce(
        (accumulator, resource) =>
          accumulator + Number(resource.helpfulCount || 0),
        0,
      ),
    }),
  );

  return {
    totalResources: resources.length,
    publishedResources: publishedCount,
    obsoleteResources: obsoleteCount,
    expiredResources: expiredCount,
    totalAssets: resources.reduce(
      (accumulator, resource) =>
        accumulator + Number(resource.assets.length || 0),
      0,
    ),
    totalUsage,
    totalHelpful,
    totalNotHelpful,
    coverageByKind,
    topResources: [...resources]
      .sort(
        (left, right) =>
          Number(right.helpfulCount || 0) - Number(left.helpfulCount || 0) ||
          Number(right.usageCount || 0) - Number(left.usageCount || 0),
      )
      .slice(0, 6),
    stageCoverage: extractUniqueValues(
      resources,
      (resource) => resource.stageCodes,
    ).map((stageCode) => ({
      stageCode,
      count: resources.filter((resource) =>
        resource.stageCodes.includes(stageCode),
      ).length,
    })),
  };
}

export async function getCommercialEnablementDashboard() {
  const resources = await listCommercialEnablementResources();
  const grouped = groupResources(resources);

  return {
    summary: {
      totalResources: resources.length,
      publishedResources: resources.filter(
        (resource) => resource.status === "published",
      ).length,
      templates: grouped.templates.length,
      solutionGuides: grouped.solutionGuides.length,
      roleGuides: grouped.roleGuides.length,
      activeAssets: resources.reduce(
        (accumulator, resource) => accumulator + resource.assets.length,
        0,
      ),
    },
    resources,
    grouped,
    taxonomy: {
      stageCodes: extractUniqueValues(
        resources,
        (resource) => resource.stageCodes,
      ),
      industryTags: extractUniqueValues(
        resources,
        (resource) => resource.industryTags,
      ),
      solutionCodes: extractUniqueValues(
        resources,
        (resource) => resource.solutionCodes,
      ),
      themeTags: extractUniqueValues(
        resources,
        (resource) => resource.themeTags,
      ),
      roleTags: extractUniqueValues(
        resources,
        (resource) => resource.recommendedRoleTags,
      ),
    },
    analytics: buildAnalytics(resources),
  };
}

export async function createCommercialEnablementResource({ body, user }) {
  const publicId = buildResourcePublicId();
  const now = new Date();
  await query(
    `INSERT INTO commercial_enablement_resources
      (public_id, kind, status, title, summary, body_markdown,
       solution_codes_json, industry_tags_json, stage_codes_json,
       theme_tags_json, competitor_tags_json, persona_tags_json,
       need_tags_json, recommended_role_tags_json, valid_until,
       owner_user_id, metadata_json, created_by_user_id, updated_by_user_id,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      publicId,
      body.kind,
      body.status,
      body.title,
      body.summary || null,
      body.bodyMarkdown || null,
      JSON.stringify(body.solutionCodes || []),
      JSON.stringify(body.industryTags || []),
      JSON.stringify(body.stageCodes || []),
      JSON.stringify(body.themeTags || []),
      JSON.stringify(body.competitorTags || []),
      JSON.stringify(body.personaTags || []),
      JSON.stringify(body.needTags || []),
      JSON.stringify(body.recommendedRoleTags || []),
      body.validUntil || null,
      body.ownerUserId || null,
      JSON.stringify(body.metadata || {}),
      Number(user?.id) || null,
      Number(user?.id) || null,
      now,
      now,
    ],
  );
  return getCommercialEnablementResourceDetail(publicId);
}

export async function updateCommercialEnablementResource({
  resourcePublicId,
  body,
  user,
}) {
  await query(
    `UPDATE commercial_enablement_resources
     SET kind = ?, status = ?, title = ?, summary = ?, body_markdown = ?,
         solution_codes_json = ?, industry_tags_json = ?, stage_codes_json = ?,
         theme_tags_json = ?, competitor_tags_json = ?, persona_tags_json = ?,
         need_tags_json = ?, recommended_role_tags_json = ?, valid_until = ?,
         owner_user_id = ?, metadata_json = ?, updated_by_user_id = ?,
         updated_at = NOW(3)
     WHERE public_id = ?`,
    [
      body.kind,
      body.status,
      body.title,
      body.summary || null,
      body.bodyMarkdown || null,
      JSON.stringify(body.solutionCodes || []),
      JSON.stringify(body.industryTags || []),
      JSON.stringify(body.stageCodes || []),
      JSON.stringify(body.themeTags || []),
      JSON.stringify(body.competitorTags || []),
      JSON.stringify(body.personaTags || []),
      JSON.stringify(body.needTags || []),
      JSON.stringify(body.recommendedRoleTags || []),
      body.validUntil || null,
      body.ownerUserId || null,
      JSON.stringify(body.metadata || {}),
      Number(user?.id) || null,
      resourcePublicId,
    ],
  );
  return getCommercialEnablementResourceDetail(resourcePublicId);
}

export async function getCommercialEnablementResourceDetail(resourcePublicId) {
  const rows = await query(
    `SELECT r.*, owner.full_name AS owner_user_name,
            COUNT(a.id) AS asset_count
     FROM commercial_enablement_resources r
     LEFT JOIN users owner ON owner.id = r.owner_user_id
     LEFT JOIN commercial_enablement_assets a
       ON a.resource_id = r.id AND a.is_deleted = 0
     WHERE r.public_id = ?
     GROUP BY r.id
     LIMIT 1`,
    [resourcePublicId],
  );
  if (!rows.length) {
    return null;
  }
  const resource = mapResourceRow(rows[0]);
  const assetsByResourceId = await listResourceAssetsByResourceIds([
    resource.id,
  ]);
  return {
    ...resource,
    assets: assetsByResourceId.get(resource.id) || [],
  };
}

export async function uploadCommercialEnablementAssets({
  req,
  resourcePublicId,
  user,
}) {
  const resource =
    await getCommercialEnablementResourceDetail(resourcePublicId);
  if (!resource) {
    const error = new Error("Recurso no encontrado");
    error.status = 404;
    throw error;
  }

  const { files } = await parseMultipartFiles(req);
  if (!files.length) {
    const error = new Error("Selecciona al menos un archivo");
    error.status = 400;
    throw error;
  }

  try {
    for (const file of files) {
      const buffer = await readFile(file.filepath);
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      const assetPublicId = buildAssetPublicId();
      const storageKey = buildAssetStorageKey({
        resourcePublicId,
        assetPublicId,
        fileName: file.originalFilename || file.newFilename || "archivo",
        sha256,
      });
      const stored = await storage.save({ buffer, storageKey });
      await query(
        `INSERT INTO commercial_enablement_assets
          (public_id, resource_id, storage_provider, storage_bucket, storage_key,
           original_file_name, stored_file_name, mime_type, file_extension,
           byte_size, sha256, uploaded_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
        [
          assetPublicId,
          resource.id,
          stored.storageProvider,
          stored.storageBucket,
          stored.storageKey,
          file.originalFilename || file.newFilename || "archivo",
          stored.storedFileName,
          file.mimetype || "application/octet-stream",
          path
            .extname(file.originalFilename || file.newFilename || "")
            .toLowerCase(),
          Number(file.size || buffer.length),
          sha256,
          Number(user?.id) || null,
        ],
      );
    }
  } finally {
    await cleanupTempFiles(files);
  }

  return getCommercialEnablementResourceDetail(resourcePublicId);
}

export async function deleteCommercialEnablementAsset({
  resourcePublicId,
  assetPublicId,
}) {
  const rows = await query(
    `SELECT a.id, a.storage_bucket, a.storage_key
     FROM commercial_enablement_assets a
     INNER JOIN commercial_enablement_resources r ON r.id = a.resource_id
     WHERE r.public_id = ?
       AND a.public_id = ?
       AND a.is_deleted = 0
     LIMIT 1`,
    [resourcePublicId, assetPublicId],
  );
  if (!rows.length) {
    const error = new Error("Adjunto no encontrado");
    error.status = 404;
    throw error;
  }

  await storage.delete({
    storageKey: rows[0].storage_key,
    storageBucket: rows[0].storage_bucket,
  });
  await query(
    `UPDATE commercial_enablement_assets
     SET is_deleted = 1, updated_at = NOW(3)
     WHERE id = ?`,
    [Number(rows[0].id)],
  );

  return getCommercialEnablementResourceDetail(resourcePublicId);
}

export async function getCommercialEnablementAssetStream({
  resourcePublicId,
  assetPublicId,
}) {
  const rows = await query(
    `SELECT a.original_file_name, a.mime_type, a.storage_bucket, a.storage_key
     FROM commercial_enablement_assets a
     INNER JOIN commercial_enablement_resources r ON r.id = a.resource_id
     WHERE r.public_id = ?
       AND a.public_id = ?
       AND a.is_deleted = 0
     LIMIT 1`,
    [resourcePublicId, assetPublicId],
  );
  if (!rows.length) {
    return null;
  }

  return {
    fileName: rows[0].original_file_name,
    mimeType: rows[0].mime_type,
    stream: await storage.openReadStream({
      storageKey: rows[0].storage_key,
      storageBucket: rows[0].storage_bucket,
    }),
  };
}

export async function recordCommercialEnablementFeedback({
  resourcePublicId,
  eventType,
  user,
  contextType = null,
  contextEntityId = null,
  metadata = {},
}) {
  const rows = await query(
    `SELECT id
     FROM commercial_enablement_resources
     WHERE public_id = ?
     LIMIT 1`,
    [resourcePublicId],
  );
  if (!rows.length) {
    const error = new Error("Recurso no encontrado");
    error.status = 404;
    throw error;
  }

  const resourceId = Number(rows[0].id);
  await query(
    `INSERT INTO commercial_enablement_usage_events
      (resource_id, user_id, event_type, context_type, context_entity_id, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW(3))`,
    [
      resourceId,
      Number(user?.id) || null,
      eventType,
      contextType,
      contextEntityId,
      JSON.stringify(metadata || {}),
    ],
  );

  const incrementSql =
    eventType === "helpful"
      ? `helpful_count = helpful_count + 1`
      : eventType === "not_helpful"
        ? `not_helpful_count = not_helpful_count + 1`
        : `usage_count = usage_count + 1`;

  await query(
    `UPDATE commercial_enablement_resources
     SET ${incrementSql}, updated_at = NOW(3)
     WHERE id = ?`,
    [resourceId],
  );

  return getCommercialEnablementResourceDetail(resourcePublicId);
}

export async function loadCommercialEnablementRecommendationCatalog() {
  const resources = await listCommercialEnablementResources({
    includeDrafts: false,
  });
  return resources.filter((resource) => resource.status === "published");
}

function overlapScore(resourceValues, contextValues, weight) {
  if (!resourceValues.length || !contextValues.length) return 0;
  const resourceSet = new Set(resourceValues.map(normalizeTag).filter(Boolean));
  const contextSet = new Set(contextValues.map(normalizeTag).filter(Boolean));
  let matches = 0;
  resourceSet.forEach((value) => {
    if (contextSet.has(value)) matches += 1;
  });
  return matches ? matches * weight : 0;
}

function deriveThemeTagsFromContext(context) {
  const values = [
    ...(context.themeTags || []),
    ...(context.riskReasons || []),
    ...(context.dependencies || []).map(
      (dependency) => dependency.dependencyType || "",
    ),
    context.executionStateCode || "",
    context.executionStateLabel || "",
  ];

  const normalized = values.flatMap((value) => {
    const text = normalizeTag(value);
    if (!text) return [];
    const tags = [text];
    if (/preventa|presales/.test(text)) tags.push("preventa");
    if (/cliente/.test(text)) tags.push("cliente");
    if (/bloque/.test(text)) tags.push("dependencia");
    if (/riesgo/.test(text)) tags.push("riesgo");
    if (/decision/.test(text)) tags.push("decision");
    if (/precio|presupuesto/.test(text)) tags.push("presupuesto");
    if (/follow_up|seguimiento/.test(text)) tags.push("seguimiento");
    return tags;
  });

  return Array.from(new Set(normalized));
}

export function recommendCommercialEnablementResources({
  catalog,
  context,
  limit = 4,
}) {
  const contextStageCodes = (
    context.stageCodes || [context.stageCode || ""]
  ).filter(Boolean);
  const contextThemeTags = deriveThemeTagsFromContext(context);
  const contextRoleTags = (context.roleTags || ["seller"]).filter(Boolean);
  const contextSearchTokens = [
    context.opportunityName,
    context.accountName,
    context.recommendedHeading,
    context.recommendedRoute,
  ]
    .join(" ")
    .toLowerCase();

  return catalog
    .map((resource) => {
      const score =
        overlapScore(resource.stageCodes, contextStageCodes, 30) +
        overlapScore(resource.themeTags, contextThemeTags, 14) +
        overlapScore(resource.recommendedRoleTags, contextRoleTags, 12) +
        overlapScore(resource.solutionCodes, context.solutionCodes || [], 20) +
        overlapScore(resource.industryTags, context.industryTags || [], 16) +
        (contextSearchTokens.includes(normalizeTag(resource.title)) ? 6 : 0);

      const reasons = [];
      if (overlapScore(resource.stageCodes, contextStageCodes, 1)) {
        reasons.push("aplica a la etapa actual");
      }
      if (overlapScore(resource.themeTags, contextThemeTags, 1)) {
        reasons.push("cubre el riesgo o necesidad dominante");
      }
      if (overlapScore(resource.recommendedRoleTags, contextRoleTags, 1)) {
        reasons.push("esta pensado para el actor involucrado");
      }

      return {
        ...resource,
        matchScore: score,
        recommendationReason:
          reasons.join(" y ") || "refuerza el discurso comercial actual",
      };
    })
    .filter((resource) => resource.matchScore > 0)
    .sort((left, right) => right.matchScore - left.matchScore)
    .slice(0, limit)
    .map((resource) => ({
      publicId: resource.publicId,
      kind: resource.kind,
      kindLabel: resource.kindLabel,
      title: resource.title,
      summary: resource.summary,
      recommendationReason: resource.recommendationReason,
      assets: resource.assets,
      matchScore: resource.matchScore,
    }));
}
