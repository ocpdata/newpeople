import express from "express";
import { z } from "zod";
import { query, withTransaction } from "./db.js";
import { requirePermission } from "./auth.js";
import { logAuditEvent } from "./audit.js";

const router = express.Router();

const providerPriceItemTypeSchema = z.enum(["producto", "servicio_propio"]);

const providerSchema = z.object({
  name: z.string().min(2).max(180),
  registrationCode: z
    .string()
    .min(1)
    .max(80)
    .transform((value) => String(value || "").trim()),
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

async function getBlockedProviderStatusResponse(providerId, nextStatusCode) {
  if (nextStatusCode !== "desactivado") {
    return null;
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

async function requireProviderPriceItemOr404(providerId, itemId) {
  const rows = await query(
    `SELECT id, provider_id, item_type, activation_status_id
     FROM provider_price_list_items
     WHERE id = ? AND provider_id = ?
     LIMIT 1`,
    [itemId, providerId],
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
            COALESCE(item_stats.active_price_items, 0) AS active_price_items,
            COALESCE(item_stats.total_price_items, 0) AS total_price_items,
            p.created_at, u1.full_name AS created_by_name,
            p.updated_at, u2.full_name AS updated_by_name
     FROM providers p
     INNER JOIN countries c ON c.id = p.country_id
     INNER JOIN provider_activation_statuses pas ON pas.id = p.activation_status_id
     INNER JOIN users u1 ON u1.id = p.created_by
     INNER JOIN users u2 ON u2.id = p.updated_by
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

    const rows = await query(
      `SELECT ppli.id, ppli.provider_id, ppli.code, ppli.description, ppli.item_type, ppli.price,
              ppli.currency_id, curr.code AS currency_code, curr.name AS currency_name,
              curr.symbol AS currency_symbol,
              ppli.activation_status_id,
              pils.code AS activation_status_code,
              pils.name AS activation_status,
              ppli.created_at, u1.full_name AS created_by_name,
              ppli.updated_at, u2.full_name AS updated_by_name
       FROM provider_price_list_items ppli
       INNER JOIN currencies curr ON curr.id = ppli.currency_id
       INNER JOIN provider_price_list_item_statuses pils ON pils.id = ppli.activation_status_id
       INNER JOIN users u1 ON u1.id = ppli.created_by
       INNER JOIN users u2 ON u2.id = ppli.updated_by
       WHERE ppli.provider_id = ?
       ORDER BY ppli.id DESC`,
      [providerId],
    );

    res.json(rows);
  },
);

router.post(
  "/:id/price-list-items",
  requirePermission("proveedores_precios.create"),
  async (req, res) => {
    const providerId = Number(req.params.id);
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

    const providerStatusCode = await getProviderStatusCode(providerId);
    if (providerStatusCode !== "activado") {
      return res.status(409).json({
        message: "No es posible agregar precios a un proveedor desactivado",
      });
    }

    const now = new Date();
    const body = parsed.data;

    try {
      const insertResult = await query(
        `INSERT INTO provider_price_list_items
          (provider_id, code, description, item_type, price, currency_id, activation_status_id,
           created_by, created_at, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          providerId,
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
        isUniqueViolation(error, "uq_provider_price_list_items_provider_code")
      ) {
        return res.status(409).json({
          message: "Ya existe un precio con ese codigo para el proveedor.",
        });
      }
      return res
        .status(500)
        .json({ message: "No fue posible crear el precio" });
    }
  },
);

router.put(
  "/:id/price-list-items/:itemId",
  requirePermission("proveedores_precios.update"),
  async (req, res) => {
    const providerId = Number(req.params.id);
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

    const itemAccess = await requireProviderPriceItemOr404(providerId, itemId);
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

    const beforeRows = await query(
      `SELECT id, provider_id, code, description, item_type, price, currency_id, activation_status_id
       FROM provider_price_list_items
       WHERE id = ? AND provider_id = ?
       LIMIT 1`,
      [itemId, providerId],
    );

    const now = new Date();

    try {
      await query(
        `UPDATE provider_price_list_items
         SET code = ?, description = ?, item_type = ?, price = ?, currency_id = ?, activation_status_id = ?,
             updated_by = ?, updated_at = ?
         WHERE id = ? AND provider_id = ?`,
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
        ],
      );
    } catch (error) {
      if (
        isUniqueViolation(error, "uq_provider_price_list_items_provider_code")
      ) {
        return res.status(409).json({
          message: "Ya existe un precio con ese codigo para el proveedor.",
        });
      }
      return res
        .status(500)
        .json({ message: "No fue posible actualizar el precio" });
    }

    const afterRows = await query(
      `SELECT id, provider_id, code, description, item_type, price, currency_id, activation_status_id
       FROM provider_price_list_items
       WHERE id = ? AND provider_id = ?
       LIMIT 1`,
      [itemId, providerId],
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
  "/:id/price-list-items/:itemId/status",
  requirePermission("proveedores_precios.update"),
  async (req, res) => {
    const providerId = Number(req.params.id);
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

    const itemAccess = await requireProviderPriceItemOr404(providerId, itemId);
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
       WHERE id = ? AND provider_id = ?`,
      [statusRows[0].id, req.user.id, now, itemId, providerId],
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

export default router;
