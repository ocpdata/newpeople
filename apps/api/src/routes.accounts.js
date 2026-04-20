import express from "express";
import { z } from "zod";
import { query, withTransaction } from "./db.js";
import { requirePermission } from "./auth.js";
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

router.get("/", requirePermission("cuentas.read"), async (_req, res) => {
  const rows = await query(
    `SELECT a.id, a.name, atp.name AS account_type, a.registration_code, a.phone, es.name AS economic_sector,
            a.website, a.city, a.state_region, c.name AS country, aas.name AS activation_status,
            a.created_at, u1.full_name AS created_by_name, a.updated_at, u2.full_name AS updated_by_name
     FROM accounts a
     INNER JOIN account_types atp ON atp.id = a.account_type_id
     INNER JOIN economic_sectors es ON es.id = a.economic_sector_id
     INNER JOIN countries c ON c.id = a.country_id
     INNER JOIN account_activation_statuses aas ON aas.id = a.activation_status_id
     INNER JOIN users u1 ON u1.id = a.created_by
     INNER JOIN users u2 ON u2.id = a.updated_by
     ORDER BY a.id DESC`,
  );
  res.json(rows);
});

router.get("/:id", requirePermission("cuentas.read"), async (req, res) => {
  const id = Number(req.params.id);
  const rows = await query(
    `SELECT a.*,
            atp.name AS account_type,
            es.name AS economic_sector,
            c.name AS country,
            aas.name AS activation_status,
            u1.full_name AS created_by_name,
            u2.full_name AS updated_by_name
     FROM accounts a
     INNER JOIN account_types atp ON atp.id = a.account_type_id
     INNER JOIN economic_sectors es ON es.id = a.economic_sector_id
     INNER JOIN countries c ON c.id = a.country_id
     INNER JOIN account_activation_statuses aas ON aas.id = a.activation_status_id
     INNER JOIN users u1 ON u1.id = a.created_by
     INNER JOIN users u2 ON u2.id = a.updated_by
     WHERE a.id = ?`,
    [id],
  );

  if (rows.length === 0) {
    return res.status(404).json({ message: "Cuenta no encontrada" });
  }

  const owners = await query(
    `SELECT u.id, u.full_name, u.email
     FROM account_owners ao
     INNER JOIN users u ON u.id = ao.user_id
     WHERE ao.account_id = ?
     ORDER BY u.full_name`,
    [id],
  );

  res.json({ ...rows[0], owners });
});

router.post("/", requirePermission("cuentas.create"), async (req, res) => {
  const parsed = accountSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
  }

  const now = new Date();
  const body = parsed.data;

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
          body.activationStatusId,
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
        activation_status_id: body.activationStatusId,
        owner_user_ids: body.ownerUserIds.map(Number),
      },
    });

    return res.status(201).json({ id: accountId, message: "Cuenta creada" });
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

    const now = new Date();
    const accountRows = await query(
      "SELECT activation_status_id FROM accounts WHERE id = ? LIMIT 1",
      [id],
    );

    if (!accountRows.length) {
      return res.status(404).json({ message: "Cuenta no encontrada" });
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
          : "Cuenta desactivada",
    });
  },
);

export default router;
