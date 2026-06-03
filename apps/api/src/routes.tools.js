import express from "express";
import { z } from "zod";
import { requirePermission } from "./auth.js";
import { logAuditEvent } from "./audit.js";
import { query, withTransaction } from "./db.js";

const router = express.Router();

const DUPLICATE_NORMALIZATION_DESCRIPTION = "trim + upper + remove spaces";

const duplicateFilterSchema = z.object({
  providerId: z.coerce.number().int().positive().optional(),
  priceListId: z.coerce.number().int().positive().optional(),
  normalizedCode: z.string().trim().min(1).max(120).optional(),
  state: z
    .enum([
      "detected",
      "review_required",
      "ready_to_consolidate",
      "blocked",
      "consolidated",
      "archived",
    ])
    .optional(),
  riskLevel: z.enum(["low", "medium", "high"]).optional(),
  itemType: z.enum(["producto", "servicio_propio", "grupo_productos"]).optional(),
  hasQuotationReferences: z.coerce.boolean().optional(),
  hasBundleReferences: z.coerce.boolean().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const consolidationPayloadSchema = z.object({
  keepCandidateId: z.number().int().positive(),
  duplicateItemIds: z.array(z.number().int().positive()).min(1),
  mode: z.enum(["archive_duplicates", "delete_safe_duplicates"]).default(
    "archive_duplicates",
  ),
});

function normalizeDuplicateCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function buildGroupKey(priceListId, normalizedCode) {
  return `${Number(priceListId)}::${String(normalizedCode || "").trim()}`;
}

function parseGroupKey(rawGroupKey) {
  const value = String(rawGroupKey || "").trim();
  const separatorIndex = value.indexOf("::");
  if (separatorIndex <= 0) {
    throw Object.assign(new Error("GROUP_KEY_INVALID"), { status: 400 });
  }

  const priceListId = Number(value.slice(0, separatorIndex));
  const normalizedCode = normalizeDuplicateCode(value.slice(separatorIndex + 2));
  if (!Number.isInteger(priceListId) || priceListId <= 0 || !normalizedCode) {
    throw Object.assign(new Error("GROUP_KEY_INVALID"), { status: 400 });
  }

  return { priceListId, normalizedCode };
}

function buildSqlExecutor(conn = null) {
  if (!conn) {
    return async (sql, params = []) => query(sql, params);
  }

  return async (sql, params = []) => {
    const [rows] = await conn.query(sql, params);
    return rows;
  };
}

async function getPriceItemStatusId(fetchRows, code) {
  const rows = await fetchRows(
    "SELECT id FROM provider_price_list_item_statuses WHERE code = ? LIMIT 1",
    [code],
  );
  return rows.length ? Number(rows[0].id) : null;
}

async function listToolCatalog() {
  return [
    {
      key: "price_list_duplicates",
      title: "Duplicados en listas de precios",
      description:
        "Detecta y consolida codigos equivalentes dentro de una misma lista de precios.",
      riskLevel: "medium",
      href: "/tools/price-list-duplicates",
    },
    {
      key: "orphan_reference_diagnostics",
      title: "Referencias huerfanas",
      description:
        "Espacio reservado para diagnostico de referencias huerfanas e inconsistentes.",
      riskLevel: "low",
      href: "/tools",
      status: "planned",
    },
    {
      key: "quotation_reference_reconciliation",
      title: "Reconciliacion de referencias de cotizacion",
      description:
        "Espacio reservado para reconciliar referencias historicas contra listas vigentes.",
      riskLevel: "medium",
      href: "/tools",
      status: "planned",
    },
  ];
}

async function listDuplicateGroupRows(fetchRows, filters = {}) {
  const whereConditions = [];
  const whereParams = [];

  if (filters.providerId) {
    whereConditions.push("ppl.provider_id = ?");
    whereParams.push(Number(filters.providerId));
  }
  if (filters.priceListId) {
    whereConditions.push("ppli.price_list_id = ?");
    whereParams.push(Number(filters.priceListId));
  }

  const whereSql = whereConditions.length
    ? `WHERE ${whereConditions.join(" AND ")}`
    : "";

  const rows = await fetchRows(
    `SELECT
       p.id AS provider_id,
       p.name AS provider_name,
       ppl.id AS price_list_id,
       ppl.name AS price_list_name,
       duplicate_groups.normalized_code,
       duplicate_groups.duplicate_count,
       duplicate_groups.active_count,
       duplicate_groups.item_type_count,
       duplicate_groups.min_created_at,
       duplicate_groups.max_updated_at,
       SUM(duplicate_groups.quotation_reference_count) AS quotation_reference_count,
       SUM(duplicate_groups.bundle_parent_reference_count) AS bundle_parent_reference_count,
       SUM(duplicate_groups.bundle_component_reference_count) AS bundle_component_reference_count
     FROM (
       SELECT
         ppli.price_list_id,
         REPLACE(UPPER(TRIM(ppli.code)), ' ', '') AS normalized_code,
         COUNT(*) AS duplicate_count,
         SUM(CASE WHEN pils.code = 'activo' THEN 1 ELSE 0 END) AS active_count,
         COUNT(DISTINCT ppli.item_type) AS item_type_count,
         MIN(ppli.created_at) AS min_created_at,
         MAX(ppli.updated_at) AS max_updated_at,
         SUM(
           (
             SELECT COUNT(*)
             FROM quotation_section_items qsi
             WHERE qsi.source_provider_price_list_item_id = ppli.id
                OR qsi.source_component_price_list_item_id = ppli.id
           )
         ) AS quotation_reference_count,
         SUM(
           (
             SELECT COUNT(*)
             FROM provider_price_list_item_components components_parent
             WHERE components_parent.grupo_item_id = ppli.id
           )
         ) AS bundle_parent_reference_count,
         SUM(
           (
             SELECT COUNT(*)
             FROM provider_price_list_item_components components_child
             WHERE components_child.component_item_id = ppli.id
           )
         ) AS bundle_component_reference_count
       FROM provider_price_list_items ppli
       INNER JOIN provider_price_lists ppl ON ppl.id = ppli.price_list_id
       INNER JOIN provider_price_list_item_statuses pils ON pils.id = ppli.activation_status_id
       ${whereSql}
       GROUP BY ppli.price_list_id, REPLACE(UPPER(TRIM(ppli.code)), ' ', '')
       HAVING COUNT(*) > 1
     ) duplicate_groups
     INNER JOIN provider_price_lists ppl ON ppl.id = duplicate_groups.price_list_id
     INNER JOIN providers p ON p.id = ppl.provider_id
     GROUP BY
       p.id,
       p.name,
       ppl.id,
       ppl.name,
       duplicate_groups.normalized_code,
       duplicate_groups.duplicate_count,
       duplicate_groups.active_count,
       duplicate_groups.item_type_count,
       duplicate_groups.min_created_at,
       duplicate_groups.max_updated_at
     ORDER BY p.name ASC, ppl.name ASC, duplicate_groups.normalized_code ASC`,
    whereParams,
  );

  return Array.isArray(rows) ? rows : [];
}

async function getDuplicateGroupItems(fetchRows, { priceListId, normalizedCode }) {
  const rows = await fetchRows(
    `SELECT
       p.id AS provider_id,
       p.name AS provider_name,
       ppl.id AS price_list_id,
       ppl.name AS price_list_name,
       ppli.id,
       ppli.code,
       ppli.description,
       ppli.item_type,
       ppli.price,
       curr.code AS currency_code,
       pils.code AS activation_status_code,
       ppli.created_at,
       ppli.updated_at,
       REPLACE(UPPER(TRIM(ppli.code)), ' ', '') AS normalized_code,
       (
         SELECT COUNT(*)
         FROM quotation_section_items qsi
         WHERE qsi.source_provider_price_list_item_id = ppli.id
       ) AS quotation_provider_reference_count,
       (
         SELECT COUNT(*)
         FROM quotation_section_items qsi
         WHERE qsi.source_component_price_list_item_id = ppli.id
       ) AS quotation_component_reference_count,
       (
         SELECT COUNT(*)
         FROM provider_price_list_item_components components_parent
         WHERE components_parent.grupo_item_id = ppli.id
       ) AS bundle_parent_reference_count,
       (
         SELECT COUNT(*)
         FROM provider_price_list_item_components components_child
         WHERE components_child.component_item_id = ppli.id
       ) AS bundle_component_reference_count
     FROM provider_price_list_items ppli
     INNER JOIN provider_price_lists ppl ON ppl.id = ppli.price_list_id
     INNER JOIN providers p ON p.id = ppl.provider_id
     INNER JOIN currencies curr ON curr.id = ppli.currency_id
     INNER JOIN provider_price_list_item_statuses pils ON pils.id = ppli.activation_status_id
     WHERE ppli.price_list_id = ?
       AND REPLACE(UPPER(TRIM(ppli.code)), ' ', '') = ?
     ORDER BY ppli.id ASC`,
    [Number(priceListId), normalizedCode],
  );

  return Array.isArray(rows)
    ? rows.map((row) => ({
        id: Number(row.id),
        providerId: Number(row.provider_id),
        providerName: String(row.provider_name || ""),
        priceListId: Number(row.price_list_id),
        priceListName: String(row.price_list_name || ""),
        code: String(row.code || ""),
        normalizedCode: String(row.normalized_code || ""),
        description: String(row.description || ""),
        itemType: String(row.item_type || ""),
        price: Number(row.price || 0),
        currencyCode: String(row.currency_code || ""),
        activationStatusCode: String(row.activation_status_code || ""),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        references: {
          quotationItems:
            Number(row.quotation_provider_reference_count || 0) +
            Number(row.quotation_component_reference_count || 0),
          quotationProviderItems: Number(
            row.quotation_provider_reference_count || 0,
          ),
          quotationComponentItems: Number(
            row.quotation_component_reference_count || 0,
          ),
          bundleParents: Number(row.bundle_parent_reference_count || 0),
          bundleComponents: Number(row.bundle_component_reference_count || 0),
        },
      }))
    : [];
}

function selectKeepCandidate(items) {
  const sorted = [...items].sort((left, right) => {
    const leftActive = left.activationStatusCode === "activo" ? 1 : 0;
    const rightActive = right.activationStatusCode === "activo" ? 1 : 0;
    if (leftActive !== rightActive) {
      return rightActive - leftActive;
    }

    const leftReferences =
      left.references.quotationItems +
      left.references.bundleParents +
      left.references.bundleComponents;
    const rightReferences =
      right.references.quotationItems +
      right.references.bundleParents +
      right.references.bundleComponents;
    if (leftReferences !== rightReferences) {
      return rightReferences - leftReferences;
    }

    const leftCreatedAt = left.createdAt ? new Date(left.createdAt).getTime() : 0;
    const rightCreatedAt = right.createdAt
      ? new Date(right.createdAt).getTime()
      : 0;
    if (leftCreatedAt !== rightCreatedAt) {
      return leftCreatedAt - rightCreatedAt;
    }

    return Number(left.id) - Number(right.id);
  });

  return sorted[0] || null;
}

function computeRiskLevel(items) {
  const hasBundleParent = items.some((item) => item.references.bundleParents > 0);
  const hasBundleComponent = items.some(
    (item) => item.references.bundleComponents > 0,
  );
  const hasQuotationRefs = items.some((item) => item.references.quotationItems > 0);

  if ((hasBundleParent || hasBundleComponent) && hasQuotationRefs) {
    return "high";
  }
  if (hasBundleParent || hasBundleComponent || hasQuotationRefs) {
    return "medium";
  }
  return "low";
}

function computeGroupState(items, keepCandidate) {
  if (!items.length || !keepCandidate) return "detected";

  const activeItems = items.filter(
    (item) => item.activationStatusCode === "activo",
  );
  const distinctPrices = new Set(
    activeItems.map((item) => `${item.price}:${item.currencyCode}`),
  );
  const distinctTypes = new Set(activeItems.map((item) => item.itemType));
  const hasBundleParents = items.some((item) => item.references.bundleParents > 0);
  if (distinctTypes.size > 1 || distinctPrices.size > 1 || hasBundleParents) {
    return "review_required";
  }

  return "ready_to_consolidate";
}

async function detectBundlePairCollisions(fetchRows, keepCandidateId, duplicateIds) {
  if (!duplicateIds.length) return [];

  const placeholders = duplicateIds.map(() => "?").join(", ");
  const rows = await fetchRows(
    `SELECT source.grupo_item_id, source.id AS source_component_link_id
     FROM provider_price_list_item_components source
     WHERE source.component_item_id IN (${placeholders})
       AND EXISTS (
         SELECT 1
         FROM provider_price_list_item_components existing
         WHERE existing.grupo_item_id = source.grupo_item_id
           AND existing.component_item_id = ?
           AND existing.id <> source.id
       )`,
    [...duplicateIds, Number(keepCandidateId)],
  );

  return Array.isArray(rows)
    ? rows.map((row) => ({
        grupoItemId: Number(row.grupo_item_id),
        sourceComponentLinkId: Number(row.source_component_link_id),
      }))
    : [];
}

async function buildDuplicateGroupDetail(fetchRows, groupIdentity) {
  const items = await getDuplicateGroupItems(fetchRows, groupIdentity);
  if (!items.length) {
    return null;
  }

  const keepCandidate = selectKeepCandidate(items);
  const groupState = computeGroupState(items, keepCandidate);
  const riskLevel = computeRiskLevel(items);

  return {
    groupKey: buildGroupKey(groupIdentity.priceListId, groupIdentity.normalizedCode),
    providerId: items[0].providerId,
    providerName: items[0].providerName,
    priceListId: items[0].priceListId,
    priceListName: items[0].priceListName,
    normalizedCode: groupIdentity.normalizedCode,
    status: groupState,
    riskLevel,
    duplicateCount: items.length,
    activeCount: items.filter((item) => item.activationStatusCode === "activo")
      .length,
    keepCandidateId: keepCandidate ? keepCandidate.id : null,
    items,
    impact: {
      totalQuotationItemsToRepoint: items
        .filter((item) => item.id !== keepCandidate?.id)
        .reduce((sum, item) => sum + item.references.quotationItems, 0),
      totalBundleComponentsToRepoint: items
        .filter((item) => item.id !== keepCandidate?.id)
        .reduce((sum, item) => sum + item.references.bundleComponents, 0),
      totalBundleParentsAffected: items
        .filter((item) => item.id !== keepCandidate?.id)
        .reduce((sum, item) => sum + item.references.bundleParents, 0),
    },
  };
}

async function validateDuplicateConsolidation(fetchRows, groupIdentity, payload) {
  const detail = await buildDuplicateGroupDetail(fetchRows, groupIdentity);
  if (!detail) {
    throw Object.assign(new Error("DUPLICATE_GROUP_NOT_FOUND"), { status: 404 });
  }

  const itemById = new Map(detail.items.map((item) => [item.id, item]));
  const keepCandidate = itemById.get(Number(payload.keepCandidateId));
  if (!keepCandidate) {
    return {
      valid: false,
      statusAfterValidation: "blocked",
      keepCandidateId: Number(payload.keepCandidateId),
      duplicateItemIds: payload.duplicateItemIds,
      warnings: [],
      blockers: ["El item seleccionado para conservar no pertenece al grupo."],
      plan: null,
    };
  }

  const duplicateItems = payload.duplicateItemIds
    .map((itemId) => itemById.get(Number(itemId)) || null)
    .filter(Boolean)
    .filter((item) => item.id !== keepCandidate.id);

  const blockers = [];
  const warnings = [];

  if (duplicateItems.length !== payload.duplicateItemIds.length) {
    blockers.push("Uno o mas items duplicados ya no pertenecen al grupo seleccionado.");
  }

  if (!duplicateItems.length) {
    blockers.push("Debes seleccionar al menos un item sobrante para consolidar.");
  }

  const distinctActivePrices = new Set(
    detail.items
      .filter((item) => item.activationStatusCode === "activo")
      .map((item) => `${item.price}:${item.currencyCode}`),
  );
  if (distinctActivePrices.size > 1) {
    warnings.push(
      "Los items activos tienen precios o monedas diferentes. Revisa antes de consolidar.",
    );
  }

  const activeItemTypes = new Set(
    detail.items
      .filter((item) => item.activationStatusCode === "activo")
      .map((item) => item.itemType),
  );
  if (activeItemTypes.size > 1) {
    blockers.push(
      "El grupo mezcla tipos de item distintos. La consolidacion automatica esta bloqueada.",
    );
  }

  if (duplicateItems.some((item) => item.references.bundleParents > 0)) {
    blockers.push(
      "Al menos uno de los duplicados actua como grupo padre en bundles. Requiere resolucion manual.",
    );
  }

  const pairCollisions = await detectBundlePairCollisions(
    fetchRows,
    keepCandidate.id,
    duplicateItems.map((item) => item.id),
  );
  if (pairCollisions.length) {
    blockers.push(
      "Reapuntar componentes del bundle crearia pares duplicados en la composicion del grupo.",
    );
  }

  const safeDeleteIds = duplicateItems
    .filter(
      (item) =>
        item.references.quotationItems === 0 &&
        item.references.bundleComponents === 0 &&
        item.references.bundleParents === 0,
    )
    .map((item) => item.id);

  if (
    payload.mode === "delete_safe_duplicates" &&
    safeDeleteIds.length !== duplicateItems.length
  ) {
    warnings.push(
      "No todos los duplicados son seguros de eliminar fisicamente. Los restantes se archivarian o bloquearian segun el caso.",
    );
  }

  return {
    valid: blockers.length === 0,
    statusAfterValidation:
      blockers.length === 0 ? "ready_to_consolidate" : "blocked",
    keepCandidateId: keepCandidate.id,
    duplicateItemIds: duplicateItems.map((item) => item.id),
    warnings,
    blockers,
    plan: {
      quotationItemsToRepoint: duplicateItems.reduce(
        (sum, item) => sum + item.references.quotationItems,
        0,
      ),
      bundleComponentsToRepoint: duplicateItems.reduce(
        (sum, item) => sum + item.references.bundleComponents,
        0,
      ),
      bundleParentsToArchive: duplicateItems.reduce(
        (sum, item) => sum + item.references.bundleParents,
        0,
      ),
      itemsToArchive:
        payload.mode === "archive_duplicates"
          ? duplicateItems.length
          : duplicateItems.length - safeDeleteIds.length,
      itemsToDelete:
        payload.mode === "delete_safe_duplicates" ? safeDeleteIds.length : 0,
      safeDeleteIds,
      pairCollisionCount: pairCollisions.length,
    },
  };
}

async function consolidateDuplicateGroup(conn, req, groupIdentity, payload) {
  const fetchRows = buildSqlExecutor(conn);
  const validation = await validateDuplicateConsolidation(
    fetchRows,
    groupIdentity,
    payload,
  );
  if (!validation.valid) {
    const error = new Error("DUPLICATE_CONSOLIDATION_BLOCKED");
    error.status = 409;
    error.payload = validation;
    throw error;
  }

  const inactiveStatusId = await getPriceItemStatusId(fetchRows, "inactivo");
  if (!inactiveStatusId) {
    throw Object.assign(new Error("PRICE_ITEM_INACTIVE_STATUS_NOT_FOUND"), {
      status: 500,
    });
  }

  const duplicateIds = validation.duplicateItemIds;
  const keepCandidateId = Number(validation.keepCandidateId);

  if (duplicateIds.length) {
    const placeholders = duplicateIds.map(() => "?").join(", ");

    await conn.query(
      `UPDATE quotation_section_items
       SET source_provider_price_list_item_id = ?, updated_at = NOW(3)
       WHERE source_provider_price_list_item_id IN (${placeholders})`,
      [keepCandidateId, ...duplicateIds],
    );

    await conn.query(
      `UPDATE quotation_section_items
       SET source_component_price_list_item_id = ?, updated_at = NOW(3)
       WHERE source_component_price_list_item_id IN (${placeholders})`,
      [keepCandidateId, ...duplicateIds],
    );

    await conn.query(
      `UPDATE provider_price_list_item_components component_link
       SET component_item_id = ?, updated_by = ?, updated_at = NOW(3)
       WHERE component_item_id IN (${placeholders})`,
      [keepCandidateId, Number(req.user.id), ...duplicateIds],
    );

    const safeDeleteIds = Array.isArray(validation.plan?.safeDeleteIds)
      ? validation.plan.safeDeleteIds
      : [];
    const archiveIds =
      payload.mode === "delete_safe_duplicates"
        ? duplicateIds.filter((itemId) => !safeDeleteIds.includes(itemId))
        : duplicateIds;

    if (archiveIds.length) {
      const archivePlaceholders = archiveIds.map(() => "?").join(", ");
      await conn.query(
        `UPDATE provider_price_list_items
         SET activation_status_id = ?, updated_by = ?, updated_at = NOW(3)
         WHERE id IN (${archivePlaceholders})`,
        [Number(inactiveStatusId), Number(req.user.id), ...archiveIds],
      );
    }

    if (payload.mode === "delete_safe_duplicates" && safeDeleteIds.length) {
      const deletePlaceholders = safeDeleteIds.map(() => "?").join(", ");
      await conn.query(
        `DELETE FROM provider_price_list_items
         WHERE id IN (${deletePlaceholders})`,
        safeDeleteIds,
      );
    }
  }

  await logAuditEvent({
    req,
    module: "herramientas",
    action: "price_list_duplicates_consolidated",
    entityType: "provider_price_list_duplicate_group",
    entityId: null,
    detail: `Consolidacion aplicada sobre ${buildGroupKey(groupIdentity.priceListId, groupIdentity.normalizedCode)}`,
    before: null,
    after: {
      groupKey: buildGroupKey(groupIdentity.priceListId, groupIdentity.normalizedCode),
      keepCandidateId,
      duplicateItemIds: duplicateIds,
      mode: payload.mode,
      plan: validation.plan,
    },
  });

  return {
    message: "Duplicados consolidados correctamente",
    result: {
      groupKey: buildGroupKey(groupIdentity.priceListId, groupIdentity.normalizedCode),
      keptItemId: keepCandidateId,
      archivedItemIds:
        payload.mode === "archive_duplicates"
          ? duplicateIds
          : duplicateIds.filter(
              (itemId) => !validation.plan.safeDeleteIds.includes(itemId),
            ),
      deletedItemIds:
        payload.mode === "delete_safe_duplicates"
          ? validation.plan.safeDeleteIds
          : [],
      repointedQuotationItems: validation.plan.quotationItemsToRepoint,
      repointedBundleComponents: validation.plan.bundleComponentsToRepoint,
      status: "consolidated",
    },
  };
}

function mapDuplicateGroupListItem(row) {
  const riskLevel =
    Number(row.bundle_parent_reference_count || 0) > 0 &&
    Number(row.quotation_reference_count || 0) > 0
      ? "high"
      : Number(row.bundle_parent_reference_count || 0) > 0 ||
          Number(row.bundle_component_reference_count || 0) > 0 ||
          Number(row.quotation_reference_count || 0) > 0
        ? "medium"
        : "low";
  const status =
    Number(row.item_type_count || 0) > 1 ||
    Number(row.bundle_parent_reference_count || 0) > 0
      ? "review_required"
      : "ready_to_consolidate";

  return {
    groupKey: buildGroupKey(row.price_list_id, row.normalized_code),
    providerId: Number(row.provider_id),
    providerName: String(row.provider_name || ""),
    priceListId: Number(row.price_list_id),
    priceListName: String(row.price_list_name || ""),
    normalizedCode: String(row.normalized_code || ""),
    status,
    riskLevel,
    duplicateCount: Number(row.duplicate_count || 0),
    activeCount: Number(row.active_count || 0),
    keepCandidateId: null,
    quotationReferenceCount: Number(row.quotation_reference_count || 0),
    bundleParentReferenceCount: Number(row.bundle_parent_reference_count || 0),
    bundleComponentReferenceCount: Number(
      row.bundle_component_reference_count || 0,
    ),
  };
}

async function handleConsolidationRequest(req, res, modeOverride = null) {
  let groupIdentity;
  try {
    groupIdentity = parseGroupKey(decodeURIComponent(req.params.groupKey || ""));
  } catch {
    return res.status(400).json({ message: "groupKey invalido" });
  }

  const parsed = consolidationPayloadSchema.safeParse({
    ...(req.body || {}),
    ...(modeOverride ? { mode: modeOverride } : {}),
  });
  if (!parsed.success) {
    return res.status(400).json({
      message: "Datos invalidos",
      errors: parsed.error.flatten(),
    });
  }

  try {
    const result = await withTransaction((conn) =>
      consolidateDuplicateGroup(conn, req, groupIdentity, parsed.data),
    );
    return res.json(result);
  } catch (error) {
    if (error?.status === 409 && error?.payload) {
      return res.status(409).json({
        message: "La consolidacion esta bloqueada para este grupo",
        validation: error.payload,
      });
    }

    await logAuditEvent({
      req,
      module: "herramientas",
      action: "price_list_duplicates_execution_failed",
      entityType: "provider_price_list_duplicate_group",
      entityId: null,
      detail: `Error al consolidar ${buildGroupKey(groupIdentity.priceListId, groupIdentity.normalizedCode)}`,
      before: null,
      after: {
        groupKey: buildGroupKey(groupIdentity.priceListId, groupIdentity.normalizedCode),
        error: String(error?.message || error || "Error desconocido"),
      },
      status: "error",
    });

    return res.status(Number(error?.status) || 500).json({
      message: "No fue posible consolidar el grupo duplicado",
    });
  }
}

router.get("/", requirePermission("herramientas.read"), async (req, res) => {
  const catalog = await listToolCatalog();
  const fetchRows = buildSqlExecutor();
  const duplicateRows = await listDuplicateGroupRows(fetchRows, {});
  const duplicateItems = duplicateRows.map(mapDuplicateGroupListItem);
  const groupCount = duplicateRows.length;
  const providerCount = new Set(duplicateRows.map((row) => Number(row.provider_id)))
    .size;
  const priceListCount = new Set(
    duplicateRows.map((row) => Number(row.price_list_id)),
  ).size;
  const highRiskGroupCount = duplicateItems.filter(
    (item) => item.riskLevel === "high",
  ).length;

  res.json({
    items: catalog.map((item) =>
      item.key === "price_list_duplicates"
        ? {
            ...item,
            status: groupCount ? "action_required" : "ok",
            stats: {
              groupCount,
              providerCount,
              priceListCount,
              highRiskGroupCount,
              readyToConsolidateCount: duplicateItems.filter(
                (item) => item.status === "ready_to_consolidate",
              ).length,
            },
            permissions: {
              canRead: req.user.permissionSet.has("herramientas.read"),
              canUpdate: req.user.permissionSet.has("herramientas.update"),
            },
          }
        : item,
    ),
  });
});

router.get(
  "/price-list-duplicates/summary",
  requirePermission("herramientas.read"),
  async (_req, res) => {
    const fetchRows = buildSqlExecutor();
    const rows = await listDuplicateGroupRows(fetchRows, {});
    const items = rows.map(mapDuplicateGroupListItem);
    res.json({
      summary: {
        groupCount: rows.length,
        itemCount: rows.reduce(
          (sum, row) => sum + Number(row.duplicate_count || 0),
          0,
        ),
        providerCount: new Set(rows.map((row) => Number(row.provider_id))).size,
        priceListCount: new Set(rows.map((row) => Number(row.price_list_id))).size,
        highRiskGroupCount: items.filter((item) => item.riskLevel === "high")
          .length,
        readyToConsolidateCount: items.filter(
          (item) => item.status === "ready_to_consolidate",
        ).length,
      },
      normalization: DUPLICATE_NORMALIZATION_DESCRIPTION,
      lastEvaluatedAt: new Date().toISOString(),
    });
  },
);

router.get(
  "/price-list-duplicates/groups",
  requirePermission("herramientas.read"),
  async (req, res) => {
    const parsed = duplicateFilterSchema.safeParse(req.query || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Filtros invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const filters = parsed.data;
    const fetchRows = buildSqlExecutor();
    const rows = await listDuplicateGroupRows(fetchRows, filters);
    let items = rows.map(mapDuplicateGroupListItem);

    if (filters.normalizedCode) {
      const normalizedCode = normalizeDuplicateCode(filters.normalizedCode);
      items = items.filter((item) => item.normalizedCode === normalizedCode);
    }
    if (filters.state) {
      items = items.filter((item) => item.status === filters.state);
    }
    if (filters.riskLevel) {
      items = items.filter((item) => item.riskLevel === filters.riskLevel);
    }
    if (filters.hasQuotationReferences !== undefined) {
      items = items.filter((item) =>
        filters.hasQuotationReferences
          ? item.quotationReferenceCount > 0
          : item.quotationReferenceCount === 0,
      );
    }
    if (filters.hasBundleReferences !== undefined) {
      items = items.filter((item) => {
        const hasBundleRefs =
          item.bundleParentReferenceCount > 0 || item.bundleComponentReferenceCount > 0;
        return filters.hasBundleReferences ? hasBundleRefs : !hasBundleRefs;
      });
    }

    const total = items.length;
    const startIndex = (filters.page - 1) * filters.pageSize;
    const pagedItems = items.slice(startIndex, startIndex + filters.pageSize);

    res.json({
      items: pagedItems,
      pagination: {
        page: filters.page,
        pageSize: filters.pageSize,
        total,
      },
      normalization: DUPLICATE_NORMALIZATION_DESCRIPTION,
    });
  },
);

router.get(
  "/price-list-duplicates/groups/:groupKey",
  requirePermission("herramientas.read"),
  async (req, res) => {
    let groupIdentity;
    try {
      groupIdentity = parseGroupKey(decodeURIComponent(req.params.groupKey || ""));
    } catch {
      return res.status(400).json({ message: "groupKey invalido" });
    }

    const fetchRows = buildSqlExecutor();
    const detail = await buildDuplicateGroupDetail(fetchRows, groupIdentity);
    if (!detail) {
      return res.status(404).json({ message: "Grupo duplicado no encontrado" });
    }

    res.json({ group: detail, normalization: DUPLICATE_NORMALIZATION_DESCRIPTION });
  },
);

router.post(
  "/price-list-duplicates/groups/:groupKey/validate-consolidation",
  requirePermission("herramientas.read"),
  async (req, res) => {
    let groupIdentity;
    try {
      groupIdentity = parseGroupKey(decodeURIComponent(req.params.groupKey || ""));
    } catch {
      return res.status(400).json({ message: "groupKey invalido" });
    }

    const parsed = consolidationPayloadSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const fetchRows = buildSqlExecutor();
    const validation = await validateDuplicateConsolidation(
      fetchRows,
      groupIdentity,
      parsed.data,
    );
    res.json(validation);
  },
);

router.post(
  "/price-list-duplicates/groups/:groupKey/consolidate",
  requirePermission("herramientas.update"),
  async (req, res) => handleConsolidationRequest(req, res),
);

router.post(
  "/price-list-duplicates/groups/:groupKey/archive-duplicates",
  requirePermission("herramientas.update"),
  async (req, res) => handleConsolidationRequest(req, res, "archive_duplicates"),
);

export default router;