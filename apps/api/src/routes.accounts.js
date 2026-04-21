import express from "express";
import { z } from "zod";
import { query, withTransaction } from "./db.js";
import { requireAnyPermission, requirePermission } from "./auth.js";
import { logAuditEvent } from "./audit.js";

const router = express.Router();

const accountSchema = z.object({
  name: z.string().min(2).max(180),
  accountTypeId: z.number().int().positive(),
  registrationCode: z
    .string()
    .max(80)
    .optional()
    .transform((value) => String(value || "").trim()),
  phone: z.string().max(40).optional(),
  economicSectorId: z.number().int().positive(),
  website: z.string().max(300).optional(),
  city: z.string().max(120).optional(),
  stateRegion: z.string().max(120).optional(),
  countryId: z.number().int().positive(),
  description: z.string().max(10000).optional(),
  addressLine: z.string().max(255).optional(),
  postalCode: z.string().max(20).optional(),
  activationStatusId: z.number().int().positive(),
  ownerUserIds: z.array(z.number().int().positive()).min(1),
});

const accountStatusSchema = z.object({
  statusCode: z.enum(["activada", "desactivada", "pendiente_activacion"]),
});

const accountCreatePermissions = ["cuentas.create", "cuentas.request"];

function isAdminUser(user) {
  return Boolean(user?.isAdmin);
}

function applyAccountOwnershipScope({ user, accountAlias, params }) {
  if (isAdminUser(user)) return "";
  params.push(Number(user.id));
  return `INNER JOIN account_owners ao_scope ON ao_scope.account_id = ${accountAlias}.id AND ao_scope.user_id = ?`;
}

async function requireAccessibleAccountOr404({ user, accountId, message }) {
  const params = [];
  const ownershipJoin = applyAccountOwnershipScope({
    user,
    accountAlias: "a",
    params,
  });
  params.push(Number(accountId));
  const rows = await query(
    `SELECT a.id
     FROM accounts a
     ${ownershipJoin}
     WHERE a.id = ?
     LIMIT 1`,
    params,
  );

  if (!rows.length) {
    return { ok: false, response: { status: 404, body: { message } } };
  }

  return { ok: true };
}

function hasExplicitAccountPermission(user, permission) {
  return user?.permissionSet?.has(permission);
}

function canActivateAccounts(user) {
  return hasExplicitAccountPermission(user, "cuentas.create");
}

async function getAccountActivationStatusId(statusCode) {
  const rows = await query(
    "SELECT id FROM account_activation_statuses WHERE code = ? LIMIT 1",
    [statusCode],
  );
  return rows.length ? Number(rows[0].id) : null;
}

async function getAccountActivationStatusCodeById(statusId) {
  const rows = await query(
    "SELECT code FROM account_activation_statuses WHERE id = ? LIMIT 1",
    [statusId],
  );
  return rows.length ? String(rows[0].code) : null;
}

async function getContactCountsForAccount(accountId) {
  const rows = await query(
    `SELECT cas.code, COUNT(*) AS count
     FROM contacts c
     INNER JOIN contact_activation_statuses cas ON cas.id = c.activation_status_id
     WHERE c.account_id = ?
     GROUP BY cas.code`,
    [accountId],
  );

  return rows.reduce(
    (totals, row) => ({
      ...totals,
      [String(row.code)]: Number(row.count) || 0,
    }),
    {},
  );
}

async function getBlockedAccountStatusResponse(accountId, nextStatusCode) {
  const contactCounts = await getContactCountsForAccount(accountId);
  const activeContacts = Number(contactCounts.activado || 0);
  const inactiveContacts = Number(contactCounts.desactivado || 0);

  if (nextStatusCode === "desactivada" && activeContacts > 0) {
    return {
      status: 409,
      body: {
        message:
          "No es posible desactivar la cuenta porque tiene contactos activos",
      },
    };
  }

  if (
    nextStatusCode === "pendiente_activacion" &&
    activeContacts + inactiveContacts > 0
  ) {
    return {
      status: 409,
      body: {
        message:
          "No es posible marcar la cuenta como pendiente porque tiene contactos activos o desactivados",
      },
    };
  }

  return null;
}

function resolveAccountCreationStatusCode(user) {
  if (hasExplicitAccountPermission(user, "cuentas.create")) {
    return "activada";
  }
  if (hasExplicitAccountPermission(user, "cuentas.request")) {
    return "pendiente_activacion";
  }
  return null;
}

function getOwnerDisplayExpression(userAlias = "u") {
  return `CASE
    WHEN ${userAlias}.status = 'inactive' THEN CONCAT(${userAlias}.full_name, ' (inactivo)')
    ELSE ${userAlias}.full_name
  END`;
}

router.get("/", requirePermission("cuentas.read"), async (req, res) => {
  const params = [];
  const ownershipJoin = applyAccountOwnershipScope({
    user: req.user,
    accountAlias: "a",
    params,
  });
  const rows = await query(
    `SELECT a.id, a.name, atp.name AS account_type, a.registration_code, a.phone, es.name AS economic_sector,
            a.website, a.city, a.state_region, c.name AS country, aas.name AS activation_status,
            COALESCE(owners.owner_names, '') AS owners_display,
            a.created_at, u1.full_name AS created_by_name, a.updated_at, u2.full_name AS updated_by_name
     FROM accounts a
     ${ownershipJoin}
     INNER JOIN account_types atp ON atp.id = a.account_type_id
     INNER JOIN economic_sectors es ON es.id = a.economic_sector_id
     INNER JOIN countries c ON c.id = a.country_id
     INNER JOIN account_activation_statuses aas ON aas.id = a.activation_status_id
     INNER JOIN users u1 ON u1.id = a.created_by
     INNER JOIN users u2 ON u2.id = a.updated_by
     LEFT JOIN (
       SELECT ao.account_id,
              GROUP_CONCAT(
                DISTINCT ${getOwnerDisplayExpression("u")}
                ORDER BY u.full_name SEPARATOR ', '
              ) AS owner_names
       FROM account_owners ao
       INNER JOIN users u ON u.id = ao.user_id
       GROUP BY ao.account_id
     ) owners ON owners.account_id = a.id
     ORDER BY a.id DESC`,
    params,
  );
  res.json(rows);
});

router.get("/:id", requirePermission("cuentas.read"), async (req, res) => {
  const id = Number(req.params.id);
  const params = [];
  const ownershipJoin = applyAccountOwnershipScope({
    user: req.user,
    accountAlias: "a",
    params,
  });
  params.push(id);
  const rows = await query(
    `SELECT a.*,
            atp.name AS account_type,
            es.name AS economic_sector,
            c.name AS country,
            aas.name AS activation_status,
            u1.full_name AS created_by_name,
            u2.full_name AS updated_by_name
     FROM accounts a
     ${ownershipJoin}
     INNER JOIN account_types atp ON atp.id = a.account_type_id
     INNER JOIN economic_sectors es ON es.id = a.economic_sector_id
     INNER JOIN countries c ON c.id = a.country_id
     INNER JOIN account_activation_statuses aas ON aas.id = a.activation_status_id
     INNER JOIN users u1 ON u1.id = a.created_by
     INNER JOIN users u2 ON u2.id = a.updated_by
     WHERE a.id = ?`,
    params,
  );

  if (rows.length === 0) {
    return res.status(404).json({ message: "Cuenta no encontrada" });
  }

  const owners = await query(
    `SELECT u.id, u.full_name, u.email, u.status
     FROM account_owners ao
     INNER JOIN users u ON u.id = ao.user_id
     WHERE ao.account_id = ?
     ORDER BY u.full_name`,
    [id],
  );

  res.json({ ...rows[0], owners });
});

router.post("/", requireAnyPermission(accountCreatePermissions), async (req, res) => {
  const parsed = accountSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
  }

  const now = new Date();
  const body = parsed.data;
  const creationStatusCode = resolveAccountCreationStatusCode(req.user);
  const activationStatusId = creationStatusCode
    ? await getAccountActivationStatusId(creationStatusCode)
    : null;

  if (!activationStatusId) {
    return res.status(403).json({
      message: "No autorizado para crear o solicitar cuentas",
    });
  }

  try {
    const accountId = await withTransaction(async (conn) => {
      const [insertResult] = await conn.query(
        `INSERT INTO accounts
          (name, account_type_id, registration_code, phone, economic_sector_id, website, city, state_region,
           country_id, description, address_line, postal_code, activation_status_id,
           created_by, created_at, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          body.name,
          body.accountTypeId,
          body.registrationCode,
          body.phone || null,
          body.economicSectorId,
          body.website || null,
          body.city || null,
          body.stateRegion || null,
          body.countryId,
          body.description || null,
          body.addressLine || null,
          body.postalCode || null,
          activationStatusId,
          req.user.id,
          now,
          req.user.id,
          now,
        ],
      );

      for (const ownerUserId of body.ownerUserIds) {
        await conn.query(
          "INSERT INTO account_owners (account_id, user_id, assigned_at, assigned_by) VALUES (?, ?, ?, ?)",
          [insertResult.insertId, ownerUserId, now, req.user.id],
        );
      }

      return insertResult.insertId;
    });

    await logAuditEvent({
      req,
      module: "cuentas",
      action: "created",
      entityType: "account",
      entityId: accountId,
      detail: "Cuenta creada",
      after: {
        name: body.name,
        account_type_id: body.accountTypeId,
        registration_code: body.registrationCode,
        phone: body.phone || null,
        economic_sector_id: body.economicSectorId,
        website: body.website || null,
        city: body.city || null,
        state_region: body.stateRegion || null,
        country_id: body.countryId,
        description: body.description || null,
        address_line: body.addressLine || null,
        postal_code: body.postalCode || null,
        activation_status_id: activationStatusId,
        owner_user_ids: body.ownerUserIds.map(Number),
      },
    });

    return res.status(201).json({
      id: accountId,
      message:
        creationStatusCode === "activada"
          ? "Cuenta creada"
          : "Solicitud de cuenta creada en estado pendiente",
    });
  } catch (error) {
    if (
      String(error.message || "").includes(
        "accounts.uq_accounts_country_registration",
      )
    ) {
      return res.status(409).json({
        message:
          "Ya existe una cuenta con ese registro en el pais seleccionado.",
      });
    }
    return res.status(500).json({ message: "No fue posible crear la cuenta" });
  }
});

router.put("/:id", requirePermission("cuentas.update"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = accountSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
  }

  const now = new Date();
  const body = parsed.data;

  const accountAccess = await requireAccessibleAccountOr404({
    user: req.user,
    accountId: id,
    message: "Cuenta no encontrada",
  });
  if (!accountAccess.ok) {
    return res.status(accountAccess.response.status).json(accountAccess.response.body);
  }

  const beforeRows = await query(
    `SELECT id, name, account_type_id, registration_code, phone, economic_sector_id,
            website, city, state_region, country_id, description, address_line,
            postal_code, activation_status_id
     FROM accounts WHERE id = ? LIMIT 1`,
    [id],
  );

  if (!beforeRows.length) {
    return res.status(404).json({ message: "Cuenta no encontrada" });
  }

  const previousStatusCode = await getAccountActivationStatusCodeById(
    Number(beforeRows[0].activation_status_id),
  );
  const requestedStatusCode = await getAccountActivationStatusCodeById(
    Number(body.activationStatusId),
  );

  if (!requestedStatusCode) {
    return res.status(400).json({ message: "Estado de activacion invalido" });
  }

  if (
    requestedStatusCode !== previousStatusCode &&
    !canActivateAccounts(req.user)
  ) {
    return res.status(403).json({
      message: "No autorizado para cambiar el estado de activacion de cuentas",
    });
  }

  if (requestedStatusCode !== previousStatusCode) {
    const blockedStatusResponse = await getBlockedAccountStatusResponse(
      id,
      requestedStatusCode,
    );
    if (blockedStatusResponse) {
      return res
        .status(blockedStatusResponse.status)
        .json(blockedStatusResponse.body);
    }
  }

  const beforeOwners = await query(
    "SELECT user_id FROM account_owners WHERE account_id = ? ORDER BY user_id",
    [id],
  );

  await withTransaction(async (conn) => {
    await conn.query(
      `UPDATE accounts
       SET name = ?, account_type_id = ?, registration_code = ?, phone = ?, economic_sector_id = ?,
           website = ?, city = ?, state_region = ?, country_id = ?, description = ?, address_line = ?,
           postal_code = ?, activation_status_id = ?, updated_by = ?, updated_at = ?
       WHERE id = ?`,
      [
        body.name,
        body.accountTypeId,
        body.registrationCode,
        body.phone || null,
        body.economicSectorId,
        body.website || null,
        body.city || null,
        body.stateRegion || null,
        body.countryId,
        body.description || null,
        body.addressLine || null,
        body.postalCode || null,
        body.activationStatusId,
        req.user.id,
        now,
        id,
      ],
    );

    await conn.query("DELETE FROM account_owners WHERE account_id = ?", [id]);
    for (const ownerUserId of body.ownerUserIds) {
      await conn.query(
        "INSERT INTO account_owners (account_id, user_id, assigned_at, assigned_by) VALUES (?, ?, ?, ?)",
        [id, ownerUserId, now, req.user.id],
      );
    }
  });

  const afterRows = await query(
    `SELECT id, name, account_type_id, registration_code, phone, economic_sector_id,
            website, city, state_region, country_id, description, address_line,
            postal_code, activation_status_id
     FROM accounts WHERE id = ? LIMIT 1`,
    [id],
  );
  const afterOwners = await query(
    "SELECT user_id FROM account_owners WHERE account_id = ? ORDER BY user_id",
    [id],
  );

  await logAuditEvent({
    req,
    module: "cuentas",
    action: "updated",
    entityType: "account",
    entityId: id,
    detail: "Cuenta actualizada",
    before: {
      ...beforeRows[0],
      owner_user_ids: beforeOwners.map((row) => Number(row.user_id)),
    },
    after: {
      ...afterRows[0],
      owner_user_ids: afterOwners.map((row) => Number(row.user_id)),
    },
  });

  res.json({ message: "Cuenta actualizada" });
});

router.patch(
  "/:id/status",
  requirePermission("cuentas.update"),
  async (req, res) => {
    const id = Number(req.params.id);
    const parsed = accountStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const statusRows = await query(
      "SELECT id FROM account_activation_statuses WHERE code = ? LIMIT 1",
      [parsed.data.statusCode],
    );
    if (!statusRows.length) {
      return res.status(400).json({ message: "Estado de activacion invalido" });
    }

    if (!canActivateAccounts(req.user)) {
      return res.status(403).json({
        message: "No autorizado para cambiar el estado de activacion de cuentas",
      });
    }

    const accountAccess = await requireAccessibleAccountOr404({
      user: req.user,
      accountId: id,
      message: "Cuenta no encontrada",
    });
    if (!accountAccess.ok) {
      return res.status(accountAccess.response.status).json(accountAccess.response.body);
    }

    const now = new Date();
    const accountRows = await query(
      "SELECT activation_status_id FROM accounts WHERE id = ? LIMIT 1",
      [id],
    );

    if (!accountRows.length) {
      return res.status(404).json({ message: "Cuenta no encontrada" });
    }

    const blockedStatusResponse = await getBlockedAccountStatusResponse(
      id,
      parsed.data.statusCode,
    );
    if (blockedStatusResponse) {
      return res
        .status(blockedStatusResponse.status)
        .json(blockedStatusResponse.body);
    }

    const previousStatusId = Number(accountRows[0].activation_status_id);
    const updateResult = await query(
      `UPDATE accounts
       SET activation_status_id = ?, updated_by = ?, updated_at = ?
       WHERE id = ?`,
      [statusRows[0].id, req.user.id, now, id],
    );

    if (!updateResult.affectedRows) {
      return res.status(404).json({ message: "Cuenta no encontrada" });
    }

    await logAuditEvent({
      req,
      module: "cuentas",
      action: "status_changed",
      entityType: "account",
      entityId: id,
      detail: "Estado de cuenta actualizado",
      before: { activation_status_id: previousStatusId },
      after: { activation_status_id: Number(statusRows[0].id) },
    });

    return res.json({
      message:
        parsed.data.statusCode === "activada"
          ? "Cuenta activada"
          : parsed.data.statusCode === "pendiente_activacion"
            ? "Cuenta marcada como pendiente"
            : "Cuenta desactivada",
    });
  },
);

export default router;
