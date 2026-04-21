import express from "express";
import { z } from "zod";
import { query, withTransaction } from "./db.js";
import { requireAnyPermission, requirePermission } from "./auth.js";
import { logAuditEvent } from "./audit.js";

const router = express.Router();

const contactSchema = z.object({
  firstName: z.string().min(2).max(120),
  lastName: z.string().min(2).max(120),
  accountId: z.number().int().positive(),
  positionTitle: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  phoneExtension: z.string().max(20).optional(),
  mobile: z.string().max(30).optional(),
  email: z
    .string()
    .max(190)
    .optional()
    .transform((value) => String(value || "").trim()),
  department: z.string().max(120).optional(),
  countryId: z.number().int().positive().optional().nullable(),
  stateRegion: z.string().max(120).optional(),
  city: z.string().max(120).optional(),
  addressLine: z.string().max(255).optional(),
  postalCode: z.string().max(20).optional(),
  purchaseParticipationId: z.number().int().positive(),
  relationshipTypeId: z.number().int().positive(),
  employmentStatusId: z.number().int().positive(),
  activationStatusId: z.number().int().positive(),
  managerContactId: z.number().int().positive().optional().nullable(),
  influencesContactId: z.number().int().positive().optional().nullable(),
});

const contactStatusSchema = z.object({
  statusCode: z.enum(["activado", "desactivado", "pendiente_activacion"]),
});

const contactCreatePermissions = ["contactos.create", "contactos.request"];

function isAdminUser(user) {
  return Boolean(user?.isAdmin);
}

function applyOwnedAccountScope({ user, accountExpression, params }) {
  if (isAdminUser(user)) return "";
  params.push(Number(user.id));
  return `INNER JOIN account_owners ao_scope ON ao_scope.account_id = ${accountExpression} AND ao_scope.user_id = ?`;
}

async function requireAccessibleContactOr404({ user, contactId, message }) {
  const params = [];
  const ownershipJoin = applyOwnedAccountScope({
    user,
    accountExpression: "c.account_id",
    params,
  });
  params.push(Number(contactId));
  const rows = await query(
    `SELECT c.id
     FROM contacts c
     ${ownershipJoin}
     WHERE c.id = ?
     LIMIT 1`,
    params,
  );

  if (!rows.length) {
    return { ok: false, response: { status: 404, body: { message } } };
  }

  return { ok: true };
}

async function requireAccessibleAccountForContact({ user, accountId }) {
  if (isAdminUser(user)) return { ok: true };

  const rows = await query(
    `SELECT 1
     FROM account_owners
     WHERE account_id = ? AND user_id = ?
     LIMIT 1`,
    [Number(accountId), Number(user.id)],
  );

  if (!rows.length) {
    return {
      ok: false,
      response: {
        status: 403,
        body: { message: "No autorizado para usar una cuenta que no te pertenece" },
      },
    };
  }

  return { ok: true };
}

function hasExplicitContactPermission(user, permission) {
  return user?.permissionSet?.has(permission);
}

function canChangeContactActivationStatus(user) {
  return hasExplicitContactPermission(user, "contactos.create");
}

async function getContactActivationStatusId(statusCode) {
  const rows = await query(
    "SELECT id FROM contact_activation_statuses WHERE code = ? LIMIT 1",
    [statusCode],
  );
  return rows.length ? Number(rows[0].id) : null;
}

async function getContactActivationStatusCodeById(statusId) {
  const rows = await query(
    "SELECT code FROM contact_activation_statuses WHERE id = ? LIMIT 1",
    [statusId],
  );
  return rows.length ? String(rows[0].code) : null;
}

function resolveContactCreationStatusCode(user) {
  if (hasExplicitContactPermission(user, "contactos.create")) {
    return "activado";
  }
  if (hasExplicitContactPermission(user, "contactos.request")) {
    return "pendiente_activacion";
  }
  return null;
}

router.get("/", requirePermission("contactos.read"), async (req, res) => {
  const params = [];
  const ownershipJoin = applyOwnedAccountScope({
    user: req.user,
    accountExpression: "c.account_id",
    params,
  });
  const rows = await query(
    `SELECT c.id, c.first_name, c.last_name,
            CONCAT(c.first_name, ' ', c.last_name) AS full_name,
            c.position_title, c.phone, c.phone_extension, c.mobile, c.email,
            c.department, c.state_region, c.city, c.address_line, c.postal_code,
            a.id AS account_id, a.name AS account_name,
            ctr.name AS relationship_type,
            cpp.name AS purchase_participation,
            ces.name AS employment_status,
            cas.name AS activation_status,
            cm.id AS manager_contact_id,
            CASE
              WHEN cm.id IS NULL THEN NULL
              ELSE CONCAT(cm.first_name, ' ', cm.last_name)
            END AS manager_contact_name,
            ci.id AS influences_contact_id,
            CASE
              WHEN ci.id IS NULL THEN NULL
              ELSE CONCAT(ci.first_name, ' ', ci.last_name)
            END AS influences_contact_name,
            c.created_at, u1.full_name AS created_by_name,
            c.updated_at, u2.full_name AS updated_by_name
     FROM contacts c
               ${ownershipJoin}
     INNER JOIN accounts a ON a.id = c.account_id
     INNER JOIN contact_relationship_types ctr ON ctr.id = c.relationship_type_id
     INNER JOIN contact_purchase_participations cpp ON cpp.id = c.purchase_participation_id
     INNER JOIN contact_employment_statuses ces ON ces.id = c.employment_status_id
     INNER JOIN contact_activation_statuses cas ON cas.id = c.activation_status_id
     LEFT JOIN contacts cm ON cm.id = c.manager_contact_id
     LEFT JOIN contacts ci ON ci.id = c.influences_contact_id
     INNER JOIN users u1 ON u1.id = c.created_by
     INNER JOIN users u2 ON u2.id = c.updated_by
     ORDER BY c.id DESC`,
    params,
  );
  res.json(rows);
});

router.get("/:id", requirePermission("contactos.read"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: "Id de contacto invalido" });
  }

  const params = [];
  const ownershipJoin = applyOwnedAccountScope({
    user: req.user,
    accountExpression: "c.account_id",
    params,
  });
  params.push(id);

  const rows = await query(
    `SELECT c.*, a.name AS account_name,
            ctr.name AS relationship_type,
            cpp.name AS purchase_participation,
            ces.name AS employment_status,
            cas.name AS activation_status,
            co.name AS country_name,
            u1.full_name AS created_by_name,
            u2.full_name AS updated_by_name,
            cm.id AS manager_contact_id,
            CASE
              WHEN cm.id IS NULL THEN NULL
              ELSE CONCAT(cm.first_name, ' ', cm.last_name)
            END AS manager_contact_name,
            ci.id AS influences_contact_id,
            CASE
              WHEN ci.id IS NULL THEN NULL
              ELSE CONCAT(ci.first_name, ' ', ci.last_name)
            END AS influences_contact_name
     FROM contacts c
     ${ownershipJoin}
     INNER JOIN accounts a ON a.id = c.account_id
     INNER JOIN contact_relationship_types ctr ON ctr.id = c.relationship_type_id
     INNER JOIN contact_purchase_participations cpp ON cpp.id = c.purchase_participation_id
     INNER JOIN contact_employment_statuses ces ON ces.id = c.employment_status_id
     INNER JOIN contact_activation_statuses cas ON cas.id = c.activation_status_id
     LEFT JOIN countries co ON co.id = c.country_id
     LEFT JOIN users u1 ON u1.id = c.created_by
     LEFT JOIN users u2 ON u2.id = c.updated_by
     LEFT JOIN contacts cm ON cm.id = c.manager_contact_id
     LEFT JOIN contacts ci ON ci.id = c.influences_contact_id
     WHERE c.id = ?`,
    params,
  );

  if (!rows.length) {
    return res.status(404).json({ message: "Contacto no encontrado" });
  }

  res.json(rows[0]);
});

router.post("/", requireAnyPermission(contactCreatePermissions), async (req, res) => {
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
  }

  const body = parsed.data;
  const now = new Date();
  const accountAccess = await requireAccessibleAccountForContact({
    user: req.user,
    accountId: body.accountId,
  });
  if (!accountAccess.ok) {
    return res.status(accountAccess.response.status).json(accountAccess.response.body);
  }
  const creationStatusCode = resolveContactCreationStatusCode(req.user);
  const activationStatusId = creationStatusCode
    ? await getContactActivationStatusId(creationStatusCode)
    : null;

  if (!activationStatusId) {
    return res.status(403).json({
      message: "No autorizado para crear o solicitar contactos",
    });
  }

  try {
    const contactId = await withTransaction(async (conn) => {
      const [insertResult] = await conn.query(
        `INSERT INTO contacts
          (first_name, last_name, account_id, position_title, phone, phone_extension,
           mobile, email, department, country_id, state_region, city, address_line,
           postal_code, purchase_participation_id, relationship_type_id,
           employment_status_id, activation_status_id, manager_contact_id,
           influences_contact_id, created_by, created_at, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          body.firstName,
          body.lastName,
          body.accountId,
          body.positionTitle || null,
          body.phone || null,
          body.phoneExtension || null,
          body.mobile || null,
          body.email || null,
          body.department || null,
          body.countryId || null,
          body.stateRegion || null,
          body.city || null,
          body.addressLine || null,
          body.postalCode || null,
          body.purchaseParticipationId,
          body.relationshipTypeId,
          body.employmentStatusId,
          activationStatusId,
          body.managerContactId || null,
          body.influencesContactId || null,
          req.user.id,
          now,
          req.user.id,
          now,
        ],
      );

      return insertResult.insertId;
    });

    await logAuditEvent({
      req,
      module: "contactos",
      action: "created",
      entityType: "contact",
      entityId: contactId,
      detail: "Contacto creado",
      after: {
        first_name: body.firstName,
        last_name: body.lastName,
        account_id: body.accountId,
        email: body.email || null,
        mobile: body.mobile || null,
        activation_status_id: activationStatusId,
      },
    });

    return res.status(201).json({
      id: contactId,
      message:
        creationStatusCode === "activado"
          ? "Contacto creado"
          : "Solicitud de contacto creada en estado pendiente",
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "No fue posible crear el contacto" });
  }
});

router.put("/:id", requirePermission("contactos.update"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: "Id de contacto invalido" });
  }

  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
  }

  const body = parsed.data;
  const now = new Date();

  const contactAccess = await requireAccessibleContactOr404({
    user: req.user,
    contactId: id,
    message: "Contacto no encontrado",
  });
  if (!contactAccess.ok) {
    return res.status(contactAccess.response.status).json(contactAccess.response.body);
  }

  const accountAccess = await requireAccessibleAccountForContact({
    user: req.user,
    accountId: body.accountId,
  });
  if (!accountAccess.ok) {
    return res.status(accountAccess.response.status).json(accountAccess.response.body);
  }

  const beforeRows = await query(
    "SELECT * FROM contacts WHERE id = ? LIMIT 1",
    [id],
  );
  if (!beforeRows.length) {
    return res.status(404).json({ message: "Contacto no encontrado" });
  }

  const previousStatusCode = await getContactActivationStatusCodeById(
    Number(beforeRows[0].activation_status_id),
  );
  const requestedStatusCode = await getContactActivationStatusCodeById(
    Number(body.activationStatusId),
  );

  if (!requestedStatusCode) {
    return res.status(400).json({ message: "Estado de activacion invalido" });
  }

  if (
    requestedStatusCode !== previousStatusCode &&
    !canChangeContactActivationStatus(req.user)
  ) {
    return res.status(403).json({
      message: "No autorizado para cambiar el estado de activacion de contactos",
    });
  }

  await withTransaction(async (conn) => {
    await conn.query(
      `UPDATE contacts
       SET first_name = ?, last_name = ?, account_id = ?, position_title = ?,
           phone = ?, phone_extension = ?, mobile = ?, email = ?, department = ?,
           country_id = ?, state_region = ?, city = ?, address_line = ?, postal_code = ?,
           purchase_participation_id = ?, relationship_type_id = ?, employment_status_id = ?,
           activation_status_id = ?, manager_contact_id = ?, influences_contact_id = ?,
           updated_by = ?, updated_at = ?
       WHERE id = ?`,
      [
        body.firstName,
        body.lastName,
        body.accountId,
        body.positionTitle || null,
        body.phone || null,
        body.phoneExtension || null,
        body.mobile || null,
        body.email || null,
        body.department || null,
        body.countryId || null,
        body.stateRegion || null,
        body.city || null,
        body.addressLine || null,
        body.postalCode || null,
        body.purchaseParticipationId,
        body.relationshipTypeId,
        body.employmentStatusId,
        body.activationStatusId,
        body.managerContactId || null,
        body.influencesContactId || null,
        req.user.id,
        now,
        id,
      ],
    );
  });

  const afterRows = await query("SELECT * FROM contacts WHERE id = ? LIMIT 1", [
    id,
  ]);

  await logAuditEvent({
    req,
    module: "contactos",
    action: "updated",
    entityType: "contact",
    entityId: id,
    detail: "Contacto actualizado",
    before: beforeRows[0],
    after: afterRows[0],
  });

  res.json({ message: "Contacto actualizado" });
});

router.patch(
  "/:id/status",
  requirePermission("contactos.update"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Id de contacto invalido" });
    }

    const parsed = contactStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const statusRows = await query(
      "SELECT id FROM contact_activation_statuses WHERE code = ? LIMIT 1",
      [parsed.data.statusCode],
    );
    if (!statusRows.length) {
      return res.status(400).json({ message: "Estado de activacion invalido" });
    }

    if (!canChangeContactActivationStatus(req.user)) {
      return res.status(403).json({
        message: "No autorizado para cambiar el estado de activacion de contactos",
      });
    }

    const contactAccess = await requireAccessibleContactOr404({
      user: req.user,
      contactId: id,
      message: "Contacto no encontrado",
    });
    if (!contactAccess.ok) {
      return res.status(contactAccess.response.status).json(contactAccess.response.body);
    }

    const beforeRows = await query(
      "SELECT activation_status_id FROM contacts WHERE id = ? LIMIT 1",
      [id],
    );
    if (!beforeRows.length) {
      return res.status(404).json({ message: "Contacto no encontrado" });
    }

    const now = new Date();
    await query(
      `UPDATE contacts
       SET activation_status_id = ?, updated_by = ?, updated_at = ?
       WHERE id = ?`,
      [statusRows[0].id, req.user.id, now, id],
    );

    await logAuditEvent({
      req,
      module: "contactos",
      action: "status_changed",
      entityType: "contact",
      entityId: id,
      detail: "Estado de contacto actualizado",
      before: {
        activation_status_id: Number(beforeRows[0].activation_status_id),
      },
      after: { activation_status_id: Number(statusRows[0].id) },
    });

    return res.json({
      message:
        parsed.data.statusCode === "activado"
          ? "Contacto activado"
          : parsed.data.statusCode === "pendiente_activacion"
            ? "Contacto marcado como pendiente"
            : "Contacto desactivado",
    });
  },
);

export default router;
