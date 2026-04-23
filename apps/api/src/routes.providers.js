import express from "express";
import { z } from "zod";
import { query, withTransaction } from "./db.js";
import { requirePermission } from "./auth.js";
import { logAuditEvent } from "./audit.js";

const router = express.Router();

const providerPriceItemTypeSchema = z.enum(["producto", "servicio_propio"]);

const providerSchema = z.object({
  name: z.string().min(2).max(180),
  registrationCode: z.preprocess(
    (value) => {
      const trimmed = String(value ?? "").trim();
      return trimmed === "" ? null : trimmed;
    },
    z.string().max(80).nullable(),
  ),
  addressLine: z.string().max(255).optional(),
  countryId: z.number().int().positive(),
  city: z.string().max(120).optional(),
  postalCode: z.string().max(20).optional(),
  stateRegion: z.string().max(120).optional(),
  activationStatusId: z.number().int().positive(),
});

const providerStatusSchema = z.object({
  statusCode: z.enum(["activado", "desactivado"]),
});

const priceListSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(180)
    .transform((value) => String(value || "").trim()),
  currencyId: z.number().int().positive(),
  itemType: providerPriceItemTypeSchema,
});

const priceListStatusSchema = z.object({
  statusCode: z.enum(["activa", "inactiva"]),
});

const priceListItemSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(80)
    .transform((value) => String(value || "").trim()),
  description: z.string().max(10000).optional(),
  itemType: providerPriceItemTypeSchema,
  price: z.number().nonnegative(),
  currencyId: z.number().int().positive(),
  activationStatusId: z.number().int().positive(),
});

const priceListItemStatusSchema = z.object({
  statusCode: z.enum(["activo", "inactivo"]),
});

async function getProviderActivationStatusId(statusCode) {
  const rows = await query(
    "SELECT id FROM provider_activation_statuses WHERE code = ? LIMIT 1",
    [statusCode],
  );
  return rows.length ? Number(rows[0].id) : null;
}

async function getProviderActivationStatusCodeById(statusId) {
  const rows = await query(
    "SELECT code FROM provider_activation_statuses WHERE id = ? LIMIT 1",
    [statusId],
  );
  return rows.length ? String(rows[0].code) : null;
}

async function getPriceItemActivationStatusId(statusCode) {
  const rows = await query(
    "SELECT id FROM provider_price_list_item_statuses WHERE code = ? LIMIT 1",
    [statusCode],
  );
  return rows.length ? Number(rows[0].id) : null;
}

async function getPriceItemActivationStatusCodeById(statusId) {
  const rows = await query(
    "SELECT code FROM provider_price_list_item_statuses WHERE id = ? LIMIT 1",
    [statusId],
  );
  return rows.length ? String(rows[0].code) : null;
}

async function getProviderPriceItemCounts(providerId) {
  const rows = await query(
    `SELECT pils.code, COUNT(*) AS count
     FROM provider_price_list_items ppli
     INNER JOIN provider_price_list_item_statuses pils ON pils.id = ppli.activation_status_id
     WHERE ppli.provider_id = ?
     GROUP BY pils.code`,
    [providerId],
  );

  return rows.reduce(
    (totals, row) => ({
      ...totals,
      [String(row.code)]: Number(row.count) || 0,
    }),
    {},
  );
}

async function getProviderPriceListCounts(providerId) {
  const rows = await query(
    `SELECT SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_count,
            COUNT(*) AS total_count
     FROM provider_price_lists
     WHERE provider_id = ?`,
    [providerId],
  );

  return {
    active: Number(rows[0]?.active_count || 0),
    total: Number(rows[0]?.total_count || 0),
  };
}

async function getBlockedProviderStatusResponse(providerId, nextStatusCode) {
  if (nextStatusCode !== "desactivado") {
    return null;
  }

  const listCounts = await getProviderPriceListCounts(providerId);
  if (listCounts.active > 0) {
    return {
      status: 409,
      body: {
        message:
          "No es posible desactivar el proveedor porque tiene una lista de precios activa",
      },
    };
  }

  const itemCounts = await getProviderPriceItemCounts(providerId);
  const activeItems = Number(itemCounts.activo || 0);

  if (activeItems > 0) {
    return {
      status: 409,
      body: {
        message:
          "No es posible desactivar el proveedor porque tiene precios activos",
      },
    };
  }

  return null;
}

async function requireProviderOr404(providerId) {
  const rows = await query("SELECT id FROM providers WHERE id = ? LIMIT 1", [
    providerId,
  ]);

  if (!rows.length) {
    return {
      ok: false,
      response: { status: 404, body: { message: "Proveedor no encontrado" } },
    };
  }

  return { ok: true };
}

async function requireProviderPriceListOr404(providerId, listId) {
  const rows = await query(
    `SELECT id, provider_id, name, currency_id, item_type, is_active, created_at, updated_at
     FROM provider_price_lists
     WHERE id = ? AND provider_id = ?
     LIMIT 1`,
    [listId, providerId],
  );

  if (!rows.length) {
    return {
      ok: false,
      response: {
        status: 404,
        body: { message: "Lista de precios no encontrada" },
      },
    };
  }

  return { ok: true, priceList: rows[0] };
}

async function requireProviderPriceItemOr404(providerId, listId, itemId) {
  const rows = await query(
    `SELECT ppli.id, ppli.provider_id, ppli.price_list_id, ppli.item_type,
            ppli.activation_status_id, ppl.is_active AS price_list_is_active
     FROM provider_price_list_items ppli
     INNER JOIN provider_price_lists ppl ON ppl.id = ppli.price_list_id
     WHERE ppli.id = ? AND ppli.provider_id = ? AND ppli.price_list_id = ?
     LIMIT 1`,
    [itemId, providerId, listId],
  );

  if (!rows.length) {
    return {
      ok: false,
      response: {
        status: 404,
        body: { message: "Precio del proveedor no encontrado" },
      },
    };
  }

  return { ok: true, item: rows[0] };
}

async function requireActiveProviderPriceListOr409(providerId) {
  const rows = await query(
    `SELECT id, provider_id, name, is_active
     FROM provider_price_lists
     WHERE provider_id = ? AND is_active = 1
     ORDER BY id DESC
     LIMIT 1`,
    [providerId],
  );

  if (!rows.length) {
    return {
      ok: false,
      response: {
        status: 409,
        body: {
          message:
            "No existe una lista de precios activa para el proveedor. Crea o activa una lista primero.",
        },
      },
    };
  }

  return { ok: true, priceList: rows[0] };
}

async function getProviderStatusCode(providerId) {
  const rows = await query(
    `SELECT pas.code
     FROM providers p
     INNER JOIN provider_activation_statuses pas ON pas.id = p.activation_status_id
     WHERE p.id = ?
     LIMIT 1`,
    [providerId],
  );
  return rows.length ? String(rows[0].code) : null;
}

async function getProviderPriceListCurrency(priceListId, excludeItemId = null) {
  const listRows = await query(
    "SELECT currency_id FROM provider_price_lists WHERE id = ? LIMIT 1",
    [priceListId],
  );

  if (listRows.length && listRows[0].currency_id) {
    return Number(listRows[0].currency_id);
  }

  const params = [priceListId];
  let excludeClause = "";

  if (excludeItemId !== null && excludeItemId !== undefined) {
    excludeClause = " AND id <> ?";
    params.push(excludeItemId);
  }

  const rows = await query(
    `SELECT currency_id
     FROM provider_price_list_items
     WHERE price_list_id = ?${excludeClause}
     ORDER BY id ASC
     LIMIT 1`,
    params,
  );

  return rows.length ? Number(rows[0].currency_id) : null;
}

async function getCurrencyCodeById(currencyId) {
  const rows = await query("SELECT code FROM currencies WHERE id = ? LIMIT 1", [
    currencyId,
  ]);
  return rows.length ? String(rows[0].code) : null;
}

async function getSingleCurrencyViolationResponse(
  priceListId,
  currencyId,
  excludeItemId = null,
) {
  const enforcedCurrencyId = await getProviderPriceListCurrency(
    priceListId,
    excludeItemId,
  );

  if (!enforcedCurrencyId || Number(enforcedCurrencyId) === Number(currencyId)) {
    return null;
  }

  const enforcedCurrencyCode =
    (await getCurrencyCodeById(enforcedCurrencyId)) || String(enforcedCurrencyId);

  return {
    status: 409,
    body: {
      message: `La lista de precios solo permite una moneda. Usa ${enforcedCurrencyCode}.`,
      currencyId: enforcedCurrencyId,
      currencyCode: enforcedCurrencyCode,
    },
  };
}

function getPriceListItemTypeViolationResponse(priceList, itemType) {
  const enforcedItemType = String(priceList?.item_type || "producto");

  if (String(itemType) === enforcedItemType) {
    return null;
  }

  return {
    status: 409,
    body: {
      message: `La lista de precios solo permite items de tipo ${enforcedItemType === "servicio_propio" ? "Servicios Propios" : "Productos"}.`,
      itemType: enforcedItemType,
    },
  };
}

function isUniqueViolation(error, constraintName) {
  const message = String(error?.message || "");
  return (
    message.includes(constraintName) || message.includes("Duplicate entry")
  );
}

router.get("/", requirePermission("proveedores.read"), async (_req, res) => {
  const rows = await query(
    `SELECT p.id, p.name, p.registration_code, p.address_line, p.city,
            p.postal_code, p.state_region, c.name AS country,
            pas.name AS activation_status, pas.code AS activation_status_code,
            active_list.name AS active_price_list_name,
            COALESCE(list_stats.active_price_lists, 0) AS active_price_lists,
            COALESCE(list_stats.total_price_lists, 0) AS total_price_lists,
            COALESCE(item_stats.active_price_items, 0) AS active_price_items,
            COALESCE(item_stats.total_price_items, 0) AS total_price_items,
            p.created_at, u1.full_name AS created_by_name,
            p.updated_at, u2.full_name AS updated_by_name
     FROM providers p
     INNER JOIN countries c ON c.id = p.country_id
     INNER JOIN provider_activation_statuses pas ON pas.id = p.activation_status_id
     INNER JOIN users u1 ON u1.id = p.created_by
     INNER JOIN users u2 ON u2.id = p.updated_by
     LEFT JOIN provider_price_lists active_list
       ON active_list.provider_id = p.id AND active_list.is_active = 1
     LEFT JOIN (
      SELECT ppl.provider_id,
        SUM(CASE WHEN ppl.is_active = 1 THEN 1 ELSE 0 END) AS active_price_lists,
        COUNT(*) AS total_price_lists
      FROM provider_price_lists ppl
      GROUP BY ppl.provider_id
         ) list_stats ON list_stats.provider_id = p.id
         LEFT JOIN (
       SELECT ppli.provider_id,
              SUM(CASE WHEN pils.code = 'activo' THEN 1 ELSE 0 END) AS active_price_items,
              COUNT(*) AS total_price_items
       FROM provider_price_list_items ppli
       INNER JOIN provider_price_list_item_statuses pils ON pils.id = ppli.activation_status_id
       GROUP BY ppli.provider_id
     ) item_stats ON item_stats.provider_id = p.id
     ORDER BY p.id DESC`,
  );

  res.json(rows);
});

router.get("/:id", requirePermission("proveedores.read"), async (req, res) => {
  const providerId = Number(req.params.id);
  const rows = await query(
    `SELECT p.*, c.name AS country,
            pas.name AS activation_status, pas.code AS activation_status_code,
            u1.full_name AS created_by_name, u2.full_name AS updated_by_name
     FROM providers p
     INNER JOIN countries c ON c.id = p.country_id
     INNER JOIN provider_activation_statuses pas ON pas.id = p.activation_status_id
     INNER JOIN users u1 ON u1.id = p.created_by
     INNER JOIN users u2 ON u2.id = p.updated_by
     WHERE p.id = ?
     LIMIT 1`,
    [providerId],
  );

  if (!rows.length) {
    return res.status(404).json({ message: "Proveedor no encontrado" });
  }

  res.json(rows[0]);
});

router.post("/", requirePermission("proveedores.create"), async (req, res) => {
  const parsed = providerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
  }

  const now = new Date();
  const body = parsed.data;

  try {
    const [insertResult] = await withTransaction(async (conn) =>
      conn.query(
        `INSERT INTO providers
          (name, registration_code, address_line, country_id, city, postal_code,
           state_region, activation_status_id, created_by, created_at, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          body.name,
          body.registrationCode,
          body.addressLine || null,
          body.countryId,
          body.city || null,
          body.postalCode || null,
          body.stateRegion || null,
          body.activationStatusId,
          req.user.id,
          now,
          req.user.id,
          now,
        ],
      ),
    );

    await logAuditEvent({
      req,
      module: "proveedores",
      action: "created",
      entityType: "provider",
      entityId: insertResult.insertId,
      detail: "Proveedor creado",
      after: {
        name: body.name,
        registration_code: body.registrationCode,
        address_line: body.addressLine || null,
        country_id: body.countryId,
        city: body.city || null,
        postal_code: body.postalCode || null,
        state_region: body.stateRegion || null,
        activation_status_id: body.activationStatusId,
      },
    });

    return res.status(201).json({
      id: insertResult.insertId,
      message: "Proveedor creado",
    });
  } catch (error) {
    if (isUniqueViolation(error, "uq_providers_registration")) {
      return res.status(409).json({
        message: "Ya existe un proveedor con ese registro.",
      });
    }
    return res
      .status(500)
      .json({ message: "No fue posible crear el proveedor" });
  }
});

router.put(
  "/:id",
  requirePermission("proveedores.update"),
  async (req, res) => {
    const providerId = Number(req.params.id);
    const parsed = providerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const providerAccess = await requireProviderOr404(providerId);
    if (!providerAccess.ok) {
      return res
        .status(providerAccess.response.status)
        .json(providerAccess.response.body);
    }

    const now = new Date();
    const body = parsed.data;
    const beforeRows = await query(
      `SELECT id, name, registration_code, address_line, country_id, city,
            postal_code, state_region, activation_status_id
     FROM providers
     WHERE id = ?
     LIMIT 1`,
      [providerId],
    );

    const previousStatusCode = await getProviderActivationStatusCodeById(
      Number(beforeRows[0].activation_status_id),
    );
    const requestedStatusCode = await getProviderActivationStatusCodeById(
      Number(body.activationStatusId),
    );

    if (!requestedStatusCode) {
      return res.status(400).json({ message: "Estado de activacion invalido" });
    }

    if (requestedStatusCode !== previousStatusCode) {
      const blockedStatusResponse = await getBlockedProviderStatusResponse(
        providerId,
        requestedStatusCode,
      );
      if (blockedStatusResponse) {
        return res
          .status(blockedStatusResponse.status)
          .json(blockedStatusResponse.body);
      }
    }

    try {
      await query(
        `UPDATE providers
       SET name = ?, registration_code = ?, address_line = ?, country_id = ?, city = ?,
           postal_code = ?, state_region = ?, activation_status_id = ?,
           updated_by = ?, updated_at = ?
       WHERE id = ?`,
        [
          body.name,
          body.registrationCode,
          body.addressLine || null,
          body.countryId,
          body.city || null,
          body.postalCode || null,
          body.stateRegion || null,
          body.activationStatusId,
          req.user.id,
          now,
          providerId,
        ],
      );
    } catch (error) {
      if (isUniqueViolation(error, "uq_providers_registration")) {
        return res.status(409).json({
          message: "Ya existe un proveedor con ese registro.",
        });
      }
      return res
        .status(500)
        .json({ message: "No fue posible actualizar el proveedor" });
    }

    const afterRows = await query(
      `SELECT id, name, registration_code, address_line, country_id, city,
            postal_code, state_region, activation_status_id
     FROM providers
     WHERE id = ?
     LIMIT 1`,
      [providerId],
    );

    await logAuditEvent({
      req,
      module: "proveedores",
      action: "updated",
      entityType: "provider",
      entityId: providerId,
      detail: "Proveedor actualizado",
      before: beforeRows[0],
      after: afterRows[0],
    });

    res.json({ message: "Proveedor actualizado" });
  },
);

router.patch(
  "/:id/status",
  requirePermission("proveedores.update"),
  async (req, res) => {
    const providerId = Number(req.params.id);
    const parsed = providerStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const providerAccess = await requireProviderOr404(providerId);
    if (!providerAccess.ok) {
      return res
        .status(providerAccess.response.status)
        .json(providerAccess.response.body);
    }

    const statusRows = await query(
      "SELECT id FROM provider_activation_statuses WHERE code = ? LIMIT 1",
      [parsed.data.statusCode],
    );
    if (!statusRows.length) {
      return res.status(400).json({ message: "Estado de activacion invalido" });
    }

    const blockedStatusResponse = await getBlockedProviderStatusResponse(
      providerId,
      parsed.data.statusCode,
    );
    if (blockedStatusResponse) {
      return res
        .status(blockedStatusResponse.status)
        .json(blockedStatusResponse.body);
    }

    const now = new Date();
    const providerRows = await query(
      "SELECT activation_status_id FROM providers WHERE id = ? LIMIT 1",
      [providerId],
    );
    const previousStatusId = Number(providerRows[0].activation_status_id);

    await query(
      `UPDATE providers
       SET activation_status_id = ?, updated_by = ?, updated_at = ?
       WHERE id = ?`,
      [statusRows[0].id, req.user.id, now, providerId],
    );

    await logAuditEvent({
      req,
      module: "proveedores",
      action: "status_changed",
      entityType: "provider",
      entityId: providerId,
      detail: "Estado del proveedor actualizado",
      before: { activation_status_id: previousStatusId },
      after: { activation_status_id: Number(statusRows[0].id) },
    });

    return res.json({
      message:
        parsed.data.statusCode === "activado"
          ? "Proveedor activado"
          : "Proveedor desactivado",
    });
  },
);

router.get(
  "/:id/price-lists",
  requirePermission("proveedores_precios.read"),
  async (req, res) => {
    const providerId = Number(req.params.id);
    const providerAccess = await requireProviderOr404(providerId);
    if (!providerAccess.ok) {
      return res
        .status(providerAccess.response.status)
        .json(providerAccess.response.body);
    }

    const rows = await query(
      `SELECT ppl.id, ppl.provider_id, ppl.name, ppl.item_type, ppl.is_active,
              COALESCE(item_stats.active_price_items, 0) AS active_price_items,
              COALESCE(item_stats.total_price_items, 0) AS total_price_items,
                COALESCE(ppl.currency_id, item_stats.currency_id) AS currency_id,
              curr.code AS currency_code,
              curr.name AS currency_name,
              ppl.created_at, u1.full_name AS created_by_name,
              ppl.updated_at, u2.full_name AS updated_by_name
       FROM provider_price_lists ppl
       LEFT JOIN (
         SELECT ppli.price_list_id,
                SUM(CASE WHEN pils.code = 'activo' THEN 1 ELSE 0 END) AS active_price_items,
                COUNT(*) AS total_price_items,
                MIN(ppli.currency_id) AS currency_id
         FROM provider_price_list_items ppli
         INNER JOIN provider_price_list_item_statuses pils ON pils.id = ppli.activation_status_id
         GROUP BY ppli.price_list_id
       ) item_stats ON item_stats.price_list_id = ppl.id
      LEFT JOIN currencies curr ON curr.id = COALESCE(ppl.currency_id, item_stats.currency_id)
       INNER JOIN users u1 ON u1.id = ppl.created_by
       INNER JOIN users u2 ON u2.id = ppl.updated_by
       WHERE ppl.provider_id = ?
       ORDER BY ppl.is_active DESC, ppl.id DESC`,
      [providerId],
    );

    res.json(rows);
  },
);

router.post(
  "/:id/price-lists",
  requirePermission("proveedores_precios.create"),
  async (req, res) => {
    const providerId = Number(req.params.id);
    const parsed = priceListSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const providerAccess = await requireProviderOr404(providerId);
    if (!providerAccess.ok) {
      return res
        .status(providerAccess.response.status)
        .json(providerAccess.response.body);
    }

    const now = new Date();
    const currencyCode = await getCurrencyCodeById(parsed.data.currencyId);
    if (!currencyCode) {
      return res.status(400).json({ message: "Moneda invalida" });
    }

    try {
      const insertResult = await query(
        `INSERT INTO provider_price_lists
          (provider_id, name, currency_id, item_type, is_active, created_by, created_at, updated_by, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        [
          providerId,
          parsed.data.name,
          parsed.data.currencyId,
          parsed.data.itemType,
          req.user.id,
          now,
          req.user.id,
          now,
        ],
      );

      await logAuditEvent({
        req,
        module: "proveedores_precios",
        action: "created",
        entityType: "provider_price_list",
        entityId: insertResult.insertId,
        detail: "Lista de precios creada",
        after: {
          provider_id: providerId,
          name: parsed.data.name,
          currency_id: parsed.data.currencyId,
          currency_code: currencyCode,
          item_type: parsed.data.itemType,
          is_active: 0,
        },
      });

      return res.status(201).json({
        id: insertResult.insertId,
        message: "Lista de precios creada",
      });
    } catch (error) {
      if (isUniqueViolation(error, "uq_provider_price_lists_provider_name")) {
        return res.status(409).json({
          message:
            "Ya existe una lista de precios con ese nombre para el proveedor.",
        });
      }
      return res
        .status(500)
        .json({ message: "No fue posible crear la lista de precios" });
    }
  },
);

router.patch(
  "/:id/price-lists/:listId/status",
  requirePermission("proveedores_precios.update"),
  async (req, res) => {
    const providerId = Number(req.params.id);
    const listId = Number(req.params.listId);
    const parsed = priceListStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const providerAccess = await requireProviderOr404(providerId);
    if (!providerAccess.ok) {
      return res
        .status(providerAccess.response.status)
        .json(providerAccess.response.body);
    }

    const listAccess = await requireProviderPriceListOr404(providerId, listId);
    if (!listAccess.ok) {
      return res
        .status(listAccess.response.status)
        .json(listAccess.response.body);
    }

    const nextIsActive = parsed.data.statusCode === "activa" ? 1 : 0;
    const previousIsActive = Number(listAccess.priceList.is_active || 0);

    if (nextIsActive === previousIsActive) {
      return res.json({
        message: nextIsActive ? "Lista de precios activada" : "Lista de precios desactivada",
      });
    }

    if (nextIsActive === 1) {
      const providerStatusCode = await getProviderStatusCode(providerId);
      if (providerStatusCode !== "activado") {
        return res.status(409).json({
          message:
            "No es posible activar una lista de precios en un proveedor desactivado",
        });
      }

      const activeRows = await query(
        `SELECT id, name
         FROM provider_price_lists
         WHERE provider_id = ? AND is_active = 1 AND id <> ?
         LIMIT 1`,
        [providerId, listId],
      );
      if (activeRows.length) {
        return res.status(409).json({
          message: "Ya existe una lista de precios activa para el proveedor.",
          activeListId: Number(activeRows[0].id),
          activeListName: String(activeRows[0].name),
        });
      }
    }

    const now = new Date();
    await query(
      `UPDATE provider_price_lists
       SET is_active = ?, updated_by = ?, updated_at = ?
       WHERE id = ? AND provider_id = ?`,
      [nextIsActive, req.user.id, now, listId, providerId],
    );

    if (nextIsActive === 0) {
      const inactivePriceItemStatusId = await getPriceItemActivationStatusId(
        "inactivo",
      );
      if (inactivePriceItemStatusId) {
        await query(
          `UPDATE provider_price_list_items
           SET activation_status_id = ?, updated_by = ?, updated_at = ?
           WHERE provider_id = ? AND price_list_id = ? AND activation_status_id <> ?`,
          [
            inactivePriceItemStatusId,
            req.user.id,
            now,
            providerId,
            listId,
            inactivePriceItemStatusId,
          ],
        );
      }
    }

    await logAuditEvent({
      req,
      module: "proveedores_precios",
      action: "status_changed",
      entityType: "provider_price_list",
      entityId: listId,
      detail: "Estado de la lista de precios actualizado",
      before: { is_active: previousIsActive },
      after: { is_active: nextIsActive },
    });

    return res.json({
      message: nextIsActive
        ? "Lista de precios activada"
        : "Lista de precios desactivada",
    });
  },
);

router.get(
  "/:id/price-lists/:listId/items",
  requirePermission("proveedores_precios.read"),
  async (req, res) => {
    const providerId = Number(req.params.id);
    const listId = Number(req.params.listId);
    const providerAccess = await requireProviderOr404(providerId);
    if (!providerAccess.ok) {
      return res
        .status(providerAccess.response.status)
        .json(providerAccess.response.body);
    }

    const listAccess = await requireProviderPriceListOr404(providerId, listId);
    if (!listAccess.ok) {
      return res
        .status(listAccess.response.status)
        .json(listAccess.response.body);
    }

    const rows = await query(
      `SELECT ppli.id, ppli.provider_id, ppli.price_list_id, ppli.code,
              ppli.description, ppli.item_type, ppli.price, ppli.currency_id,
              curr.code AS currency_code, curr.name AS currency_name,
              curr.symbol AS currency_symbol, ppli.activation_status_id,
              pils.code AS activation_status_code, pils.name AS activation_status,
              ppl.name AS price_list_name, ppl.is_active AS price_list_is_active,
              ppli.created_at, u1.full_name AS created_by_name,
              ppli.updated_at, u2.full_name AS updated_by_name
       FROM provider_price_list_items ppli
       INNER JOIN provider_price_lists ppl ON ppl.id = ppli.price_list_id
       INNER JOIN currencies curr ON curr.id = ppli.currency_id
       INNER JOIN provider_price_list_item_statuses pils ON pils.id = ppli.activation_status_id
       INNER JOIN users u1 ON u1.id = ppli.created_by
       INNER JOIN users u2 ON u2.id = ppli.updated_by
       WHERE ppli.provider_id = ? AND ppli.price_list_id = ?
       ORDER BY ppli.id DESC`,
      [providerId, listId],
    );

    res.json(rows);
  },
);

router.post(
  "/:id/price-lists/:listId/items",
  requirePermission("proveedores_precios.create"),
  async (req, res) => {
    const providerId = Number(req.params.id);
    const listId = Number(req.params.listId);
    const parsed = priceListItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const providerAccess = await requireProviderOr404(providerId);
    if (!providerAccess.ok) {
      return res
        .status(providerAccess.response.status)
        .json(providerAccess.response.body);
    }

    const listAccess = await requireProviderPriceListOr404(providerId, listId);
    if (!listAccess.ok) {
      return res
        .status(listAccess.response.status)
        .json(listAccess.response.body);
    }

    const providerStatusCode = await getProviderStatusCode(providerId);
    if (providerStatusCode !== "activado") {
      return res.status(409).json({
        message: "No es posible agregar precios a un proveedor desactivado",
      });
    }

    const singleCurrencyViolation = await getSingleCurrencyViolationResponse(
      listId,
      parsed.data.currencyId,
    );
    if (singleCurrencyViolation) {
      return res
        .status(singleCurrencyViolation.status)
        .json(singleCurrencyViolation.body);
    }

    const itemTypeViolation = getPriceListItemTypeViolationResponse(
      listAccess.priceList,
      parsed.data.itemType,
    );
    if (itemTypeViolation) {
      return res.status(itemTypeViolation.status).json(itemTypeViolation.body);
    }

    const now = new Date();
    const body = parsed.data;

    try {
      const insertResult = await query(
        `INSERT INTO provider_price_list_items
          (provider_id, price_list_id, code, description, item_type, price, currency_id, activation_status_id,
           created_by, created_at, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          providerId,
          listId,
          body.code,
          body.description || null,
          body.itemType,
          body.price,
          body.currencyId,
          body.activationStatusId,
          req.user.id,
          now,
          req.user.id,
          now,
        ],
      );

      await logAuditEvent({
        req,
        module: "proveedores_precios",
        action: "created",
        entityType: "provider_price_list_item",
        entityId: insertResult.insertId,
        detail: "Precio de proveedor creado",
        after: {
          provider_id: providerId,
          price_list_id: listId,
          code: body.code,
          description: body.description || null,
          item_type: body.itemType,
          price: body.price,
          currency_id: body.currencyId,
          activation_status_id: body.activationStatusId,
        },
      });

      return res.status(201).json({
        id: insertResult.insertId,
        message: "Precio agregado",
      });
    } catch (error) {
      if (
        isUniqueViolation(error, "uq_provider_price_list_items_provider_code") ||
        isUniqueViolation(error, "uq_provider_price_list_items_list_code")
      ) {
        return res.status(409).json({
          message: "Ya existe un precio con ese codigo para la lista.",
        });
      }
      return res
        .status(500)
        .json({ message: "No fue posible crear el precio" });
    }
  },
);

router.put(
  "/:id/price-lists/:listId/items/:itemId",
  requirePermission("proveedores_precios.update"),
  async (req, res) => {
    const providerId = Number(req.params.id);
    const listId = Number(req.params.listId);
    const itemId = Number(req.params.itemId);
    const parsed = priceListItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const providerAccess = await requireProviderOr404(providerId);
    if (!providerAccess.ok) {
      return res
        .status(providerAccess.response.status)
        .json(providerAccess.response.body);
    }

    const listAccess = await requireProviderPriceListOr404(providerId, listId);
    if (!listAccess.ok) {
      return res
        .status(listAccess.response.status)
        .json(listAccess.response.body);
    }

    const itemAccess = await requireProviderPriceItemOr404(
      providerId,
      listId,
      itemId,
    );
    if (!itemAccess.ok) {
      return res
        .status(itemAccess.response.status)
        .json(itemAccess.response.body);
    }

    const providerStatusCode = await getProviderStatusCode(providerId);
    const requestedStatusCode = await getPriceItemActivationStatusCodeById(
      parsed.data.activationStatusId,
    );

    if (!requestedStatusCode) {
      return res.status(400).json({ message: "Estado del precio invalido" });
    }

    if (providerStatusCode !== "activado" && requestedStatusCode === "activo") {
      return res.status(409).json({
        message: "No es posible activar precios en un proveedor desactivado",
      });
    }

    const singleCurrencyViolation = await getSingleCurrencyViolationResponse(
      listId,
      parsed.data.currencyId,
      itemId,
    );
    if (singleCurrencyViolation) {
      return res
        .status(singleCurrencyViolation.status)
        .json(singleCurrencyViolation.body);
    }

    const itemTypeViolation = getPriceListItemTypeViolationResponse(
      listAccess.priceList,
      parsed.data.itemType,
    );
    if (itemTypeViolation) {
      return res.status(itemTypeViolation.status).json(itemTypeViolation.body);
    }

    const beforeRows = await query(
      `SELECT id, provider_id, price_list_id, code, description, item_type, price, currency_id, activation_status_id
       FROM provider_price_list_items
       WHERE id = ? AND provider_id = ? AND price_list_id = ?
       LIMIT 1`,
      [itemId, providerId, listId],
    );

    const now = new Date();

    try {
      await query(
        `UPDATE provider_price_list_items
         SET code = ?, description = ?, item_type = ?, price = ?, currency_id = ?, activation_status_id = ?,
             updated_by = ?, updated_at = ?
         WHERE id = ? AND provider_id = ? AND price_list_id = ?`,
        [
          parsed.data.code,
          parsed.data.description || null,
          parsed.data.itemType,
          parsed.data.price,
          parsed.data.currencyId,
          parsed.data.activationStatusId,
          req.user.id,
          now,
          itemId,
          providerId,
          listId,
        ],
      );
    } catch (error) {
      if (
        isUniqueViolation(error, "uq_provider_price_list_items_provider_code") ||
        isUniqueViolation(error, "uq_provider_price_list_items_list_code")
      ) {
        return res.status(409).json({
          message: "Ya existe un precio con ese codigo para la lista.",
        });
      }
      return res
        .status(500)
        .json({ message: "No fue posible actualizar el precio" });
    }

    const afterRows = await query(
      `SELECT id, provider_id, price_list_id, code, description, item_type, price, currency_id, activation_status_id
       FROM provider_price_list_items
       WHERE id = ? AND provider_id = ? AND price_list_id = ?
       LIMIT 1`,
      [itemId, providerId, listId],
    );

    await logAuditEvent({
      req,
      module: "proveedores_precios",
      action: "updated",
      entityType: "provider_price_list_item",
      entityId: itemId,
      detail: "Precio de proveedor actualizado",
      before: beforeRows[0],
      after: afterRows[0],
    });

    res.json({ message: "Precio actualizado" });
  },
);

router.patch(
  "/:id/price-lists/:listId/items/:itemId/status",
  requirePermission("proveedores_precios.update"),
  async (req, res) => {
    const providerId = Number(req.params.id);
    const listId = Number(req.params.listId);
    const itemId = Number(req.params.itemId);
    const parsed = priceListItemStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const providerAccess = await requireProviderOr404(providerId);
    if (!providerAccess.ok) {
      return res
        .status(providerAccess.response.status)
        .json(providerAccess.response.body);
    }

    const listAccess = await requireProviderPriceListOr404(providerId, listId);
    if (!listAccess.ok) {
      return res
        .status(listAccess.response.status)
        .json(listAccess.response.body);
    }

    const itemAccess = await requireProviderPriceItemOr404(
      providerId,
      listId,
      itemId,
    );
    if (!itemAccess.ok) {
      return res
        .status(itemAccess.response.status)
        .json(itemAccess.response.body);
    }

    const providerStatusCode = await getProviderStatusCode(providerId);
    if (
      providerStatusCode !== "activado" &&
      parsed.data.statusCode === "activo"
    ) {
      return res.status(409).json({
        message: "No es posible activar precios en un proveedor desactivado",
      });
    }

    const statusRows = await query(
      "SELECT id FROM provider_price_list_item_statuses WHERE code = ? LIMIT 1",
      [parsed.data.statusCode],
    );

    if (!statusRows.length) {
      return res.status(400).json({ message: "Estado del precio invalido" });
    }

    const previousStatusId = Number(itemAccess.item.activation_status_id);
    const now = new Date();

    await query(
      `UPDATE provider_price_list_items
       SET activation_status_id = ?, updated_by = ?, updated_at = ?
       WHERE id = ? AND provider_id = ? AND price_list_id = ?`,
      [statusRows[0].id, req.user.id, now, itemId, providerId, listId],
    );

    await logAuditEvent({
      req,
      module: "proveedores_precios",
      action: "status_changed",
      entityType: "provider_price_list_item",
      entityId: itemId,
      detail: "Estado del precio de proveedor actualizado",
      before: { activation_status_id: previousStatusId },
      after: { activation_status_id: Number(statusRows[0].id) },
    });

    return res.json({
      message:
        parsed.data.statusCode === "activo"
          ? "Precio activado"
          : "Precio desactivado",
    });
  },
);

router.get(
  "/:id/price-list-items",
  requirePermission("proveedores_precios.read"),
  async (req, res) => {
    const providerId = Number(req.params.id);
    const providerAccess = await requireProviderOr404(providerId);
    if (!providerAccess.ok) {
      return res
        .status(providerAccess.response.status)
        .json(providerAccess.response.body);
    }

    const activeListAccess = await requireActiveProviderPriceListOr409(providerId);
    if (!activeListAccess.ok) {
      return res.json([]);
    }

    const rows = await query(
      `SELECT ppli.id, ppli.provider_id, ppli.price_list_id, ppli.code,
              ppli.description, ppli.item_type, ppli.price, ppli.currency_id,
              curr.code AS currency_code, curr.name AS currency_name,
              curr.symbol AS currency_symbol, ppli.activation_status_id,
              pils.code AS activation_status_code, pils.name AS activation_status,
              ppli.created_at, u1.full_name AS created_by_name,
              ppli.updated_at, u2.full_name AS updated_by_name
       FROM provider_price_list_items ppli
       INNER JOIN currencies curr ON curr.id = ppli.currency_id
       INNER JOIN provider_price_list_item_statuses pils ON pils.id = ppli.activation_status_id
       INNER JOIN users u1 ON u1.id = ppli.created_by
       INNER JOIN users u2 ON u2.id = ppli.updated_by
       WHERE ppli.provider_id = ? AND ppli.price_list_id = ?
       ORDER BY ppli.id DESC`,
      [providerId, activeListAccess.priceList.id],
    );

    res.json(rows);
  },
);

router.post(
  "/:id/price-list-items",
  requirePermission("proveedores_precios.create"),
  async (_req, res) =>
    res.status(410).json({
      message:
        "Este endpoint requiere una lista explicita. Usa /api/providers/:id/price-lists/:listId/items.",
    }),
);

router.put(
  "/:id/price-list-items/:itemId",
  requirePermission("proveedores_precios.update"),
  async (_req, res) =>
    res.status(410).json({
      message:
        "Este endpoint requiere una lista explicita. Usa /api/providers/:id/price-lists/:listId/items/:itemId.",
    }),
);

router.patch(
  "/:id/price-list-items/:itemId/status",
  requirePermission("proveedores_precios.update"),
  async (_req, res) =>
    res.status(410).json({
      message:
        "Este endpoint requiere una lista explicita. Usa /api/providers/:id/price-lists/:listId/items/:itemId/status.",
    }),
);

export default router;
