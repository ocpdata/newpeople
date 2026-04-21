import express from "express";
import { z } from "zod";
import { query } from "./db.js";
import { requireAnyPermission, requirePermission } from "./auth.js";
import { logAuditEvent } from "./audit.js";

const router = express.Router();

const opportunitySchema = z.object({
  name: z.string().min(2).max(180),
  amountUsd: z.number().nonnegative(),
  accountId: z.number().int().positive(),
  closeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  contactId: z.number().int().positive(),
  salesStageId: z.number().int().positive(),
  businessLineId: z.number().int().positive(),
  sellerUserId: z.number().int().positive(),
  presalesUserId: z.number().int().positive().optional().nullable(),
  activationStatusId: z.number().int().positive(),
});

const opportunityStatusSchema = z.object({
  statusCode: z.enum(["activada", "desactivada", "pendiente_activacion"]),
});

const opportunityCreatePermissions = [
  "oportunidades.create",
  "oportunidades.request",
];

function isAdminUser(user) {
  return Boolean(user?.isAdmin);
}

function applyOwnedAccountScope({ user, accountExpression, params }) {
  if (isAdminUser(user)) return "";
  params.push(Number(user.id));
  return `INNER JOIN account_owners ao_scope ON ao_scope.account_id = ${accountExpression} AND ao_scope.user_id = ?`;
}

async function requireAccessibleOpportunityOr404({
  user,
  opportunityId,
  message,
}) {
  const params = [];
  const ownershipJoin = applyOwnedAccountScope({
    user,
    accountExpression: "o.account_id",
    params,
  });
  params.push(Number(opportunityId));
  const rows = await query(
    `SELECT o.id
     FROM opportunities o
     ${ownershipJoin}
     WHERE o.id = ?
     LIMIT 1`,
    params,
  );

  if (!rows.length) {
    return { ok: false, response: { status: 404, body: { message } } };
  }

  return { ok: true };
}

function hasExplicitOpportunityPermission(user, permission) {
  return user?.permissionSet?.has(permission);
}

function canChangeOpportunityActivationStatus(user) {
  return hasExplicitOpportunityPermission(user, "oportunidades.create");
}

async function getOpportunityActivationStatusId(statusCode) {
  const rows = await query(
    "SELECT id FROM opportunity_activation_statuses WHERE code = ? LIMIT 1",
    [statusCode],
  );
  return rows.length ? Number(rows[0].id) : null;
}

async function getOpportunityActivationStatusCodeById(statusId) {
  const rows = await query(
    "SELECT code FROM opportunity_activation_statuses WHERE id = ? LIMIT 1",
    [statusId],
  );
  return rows.length ? String(rows[0].code) : null;
}

function resolveOpportunityCreationStatusCode(user) {
  if (hasExplicitOpportunityPermission(user, "oportunidades.create")) {
    return "activada";
  }
  if (hasExplicitOpportunityPermission(user, "oportunidades.request")) {
    return "pendiente_activacion";
  }
  return null;
}

async function validateOpportunityRelations({
  user,
  accountId,
  contactId,
  sellerUserId,
  presalesUserId,
}) {
  if (!isAdminUser(user)) {
    const accountRows = await query(
      `SELECT 1
       FROM account_owners
       WHERE account_id = ? AND user_id = ?
       LIMIT 1`,
      [Number(accountId), Number(user.id)],
    );

    if (!accountRows.length) {
      return {
        ok: false,
        status: 403,
        message: "No autorizado para usar una cuenta que no te pertenece",
      };
    }
  }

  const contactRows = await query(
    "SELECT account_id FROM contacts WHERE id = ? LIMIT 1",
    [contactId],
  );
  if (!contactRows.length) {
    return { ok: false, status: 400, message: "Contacto invalido" };
  }
  if (Number(contactRows[0].account_id) !== Number(accountId)) {
    return {
      ok: false,
      status: 400,
      message: "El contacto debe pertenecer a la cuenta seleccionada",
    };
  }

  const sellerRows = await query(
    `SELECT u.id
     FROM users u
     INNER JOIN user_roles ur ON ur.user_id = u.id
     INNER JOIN roles r ON r.id = ur.role_id
     WHERE u.id = ?
       AND u.status = 'active'
       AND LOWER(TRIM(r.name)) = 'vendedor'
     LIMIT 1`,
    [sellerUserId],
  );

  if (!sellerRows.length) {
    return {
      ok: false,
      status: 400,
      message: "El vendedor debe tener rol de vendedor",
    };
  }

  if (presalesUserId) {
    const presalesRows = await query(
      `SELECT u.id
       FROM users u
       INNER JOIN user_roles ur ON ur.user_id = u.id
       INNER JOIN roles r ON r.id = ur.role_id
       WHERE u.id = ?
         AND u.status = 'active'
         AND LOWER(TRIM(r.name)) = 'preventa'
       LIMIT 1`,
      [presalesUserId],
    );

    if (!presalesRows.length) {
      return {
        ok: false,
        status: 400,
        message: "El ingeniero preventa debe tener rol de preventa",
      };
    }
  }

  return { ok: true };
}

router.get("/", requirePermission("oportunidades.read"), async (req, res) => {
  const params = [];
  const ownershipJoin = applyOwnedAccountScope({
    user: req.user,
    accountExpression: "o.account_id",
    params,
  });

  const accountIdFilter = req.query.accountId
    ? Number(req.query.accountId)
    : null;
  if (accountIdFilter !== null) {
    if (!Number.isInteger(accountIdFilter) || accountIdFilter <= 0) {
      return res.status(400).json({ message: "accountId invalido" });
    }
    params.push(accountIdFilter);
  }

  const rows = await query(
    `SELECT o.id, o.name, o.amount_usd, o.close_date,
            a.id AS account_id, a.name AS account_name,
            CONCAT(c.first_name, ' ', c.last_name) AS contact_name,
            oss.name AS sales_stage,
            obl.name AS business_line,
            su.full_name AS seller_user_name,
            pu.full_name AS presales_user_name,
            oas.name AS activation_status,
            u1.full_name AS created_by_name,
            o.created_at,
            u2.full_name AS updated_by_name,
            o.updated_at
     FROM opportunities o
               ${ownershipJoin}
     INNER JOIN accounts a ON a.id = o.account_id
     INNER JOIN contacts c ON c.id = o.contact_id
     INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
     INNER JOIN opportunity_business_lines obl ON obl.id = o.business_line_id
     LEFT JOIN users su ON su.id = o.seller_user_id
     LEFT JOIN users pu ON pu.id = o.presales_user_id
     INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
     INNER JOIN users u1 ON u1.id = o.created_by
     INNER JOIN users u2 ON u2.id = o.updated_by
     ${accountIdFilter !== null ? "WHERE o.account_id = ?" : ""}
     ORDER BY o.id DESC`,
    params,
  );
  res.json(rows);
});

router.get(
  "/:id",
  requirePermission("oportunidades.read"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Id de oportunidad invalido" });
    }

    const params = [];
    const ownershipJoin = applyOwnedAccountScope({
      user: req.user,
      accountExpression: "o.account_id",
      params,
    });
    params.push(id);

    const rows = await query(
      `SELECT o.*, a.name AS account_name,
              CONCAT(c.first_name, ' ', c.last_name) AS contact_name,
              oss.name AS sales_stage,
              obl.name AS business_line,
              su.full_name AS seller_user_name,
              pu.full_name AS presales_user_name,
              oas.name AS activation_status,
              u1.full_name AS created_by_name,
              u2.full_name AS updated_by_name
       FROM opportunities o
            ${ownershipJoin}
       INNER JOIN accounts a ON a.id = o.account_id
       INNER JOIN contacts c ON c.id = o.contact_id
       INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
       INNER JOIN opportunity_business_lines obl ON obl.id = o.business_line_id
       LEFT JOIN users su ON su.id = o.seller_user_id
       LEFT JOIN users pu ON pu.id = o.presales_user_id
       INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
       INNER JOIN users u1 ON u1.id = o.created_by
       INNER JOIN users u2 ON u2.id = o.updated_by
       WHERE o.id = ?`,
      params,
    );

    if (!rows.length) {
      return res.status(404).json({ message: "Oportunidad no encontrada" });
    }

    res.json(rows[0]);
  },
);

router.post(
  "/",
  requireAnyPermission(opportunityCreatePermissions),
  async (req, res) => {
    const parsed = opportunitySchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const body = parsed.data;
    const relationValidation = await validateOpportunityRelations({
      user: req.user,
      ...body,
    });
    if (!relationValidation.ok) {
      return res
        .status(relationValidation.status)
        .json({ message: relationValidation.message });
    }

    const now = new Date();
    const creationStatusCode = resolveOpportunityCreationStatusCode(req.user);
    const activationStatusId = creationStatusCode
      ? await getOpportunityActivationStatusId(creationStatusCode)
      : null;

    if (!activationStatusId) {
      return res.status(403).json({
        message: "No autorizado para crear o solicitar oportunidades",
      });
    }

    try {
      const insertResult = await query(
        `INSERT INTO opportunities
          (name, amount_usd, account_id, close_date, contact_id,
           sales_stage_id, business_line_id, seller_user_id, presales_user_id, activation_status_id,
           created_by, created_at, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          body.name,
          body.amountUsd,
          body.accountId,
          body.closeDate,
          body.contactId,
          body.salesStageId,
          body.businessLineId,
          body.sellerUserId,
          body.presalesUserId || null,
          activationStatusId,
          req.user.id,
          now,
          req.user.id,
          now,
        ],
      );
      const opportunityId = insertResult.insertId;

      await logAuditEvent({
        req,
        module: "oportunidades",
        action: "created",
        entityType: "opportunity",
        entityId: opportunityId,
        detail: "Oportunidad creada",
        after: {
          name: body.name,
          amount_usd: body.amountUsd,
          account_id: body.accountId,
          close_date: body.closeDate,
          contact_id: body.contactId,
          sales_stage_id: body.salesStageId,
          business_line_id: body.businessLineId,
          seller_user_id: body.sellerUserId,
          presales_user_id: body.presalesUserId || null,
          activation_status_id: activationStatusId,
        },
      });

      return res.status(201).json({
        id: opportunityId,
        message:
          creationStatusCode === "activada"
            ? "Oportunidad creada"
            : "Solicitud de oportunidad creada en estado pendiente",
      });
    } catch (error) {
      return res
        .status(500)
        .json({ message: "No fue posible crear la oportunidad" });
    }
  },
);

router.put(
  "/:id",
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Id de oportunidad invalido" });
    }

    const parsed = opportunitySchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const body = parsed.data;
    const opportunityAccess = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId: id,
      message: "Oportunidad no encontrada",
    });
    if (!opportunityAccess.ok) {
      return res
        .status(opportunityAccess.response.status)
        .json(opportunityAccess.response.body);
    }

    const beforeRows = await query(
      "SELECT * FROM opportunities WHERE id = ? LIMIT 1",
      [id],
    );
    if (!beforeRows.length) {
      return res.status(404).json({ message: "Oportunidad no encontrada" });
    }

    const previousStatusCode = await getOpportunityActivationStatusCodeById(
      Number(beforeRows[0].activation_status_id),
    );
    const requestedStatusCode = await getOpportunityActivationStatusCodeById(
      Number(body.activationStatusId),
    );

    if (!requestedStatusCode) {
      return res.status(400).json({ message: "Estado de activacion invalido" });
    }

    if (
      requestedStatusCode !== previousStatusCode &&
      !canChangeOpportunityActivationStatus(req.user)
    ) {
      return res.status(403).json({
        message:
          "No autorizado para cambiar el estado de activacion de oportunidades",
      });
    }

    const relationValidation = await validateOpportunityRelations({
      user: req.user,
      ...body,
    });
    if (!relationValidation.ok) {
      return res
        .status(relationValidation.status)
        .json({ message: relationValidation.message });
    }

    const now = new Date();
    await query(
      `UPDATE opportunities
       SET name = ?, amount_usd = ?, account_id = ?, close_date = ?, contact_id = ?,
           sales_stage_id = ?, business_line_id = ?, seller_user_id = ?,
           presales_user_id = ?, activation_status_id = ?, updated_by = ?, updated_at = ?
       WHERE id = ?`,
      [
        body.name,
        body.amountUsd,
        body.accountId,
        body.closeDate,
        body.contactId,
        body.salesStageId,
        body.businessLineId,
        body.sellerUserId,
        body.presalesUserId || null,
        body.activationStatusId,
        req.user.id,
        now,
        id,
      ],
    );

    const afterRows = await query(
      "SELECT * FROM opportunities WHERE id = ? LIMIT 1",
      [id],
    );
    await logAuditEvent({
      req,
      module: "oportunidades",
      action: "updated",
      entityType: "opportunity",
      entityId: id,
      detail: "Oportunidad actualizada",
      before: beforeRows[0],
      after: afterRows[0],
    });

    res.json({ message: "Oportunidad actualizada" });
  },
);

router.patch(
  "/:id/status",
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Id de oportunidad invalido" });
    }

    const parsed = opportunityStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const statusRows = await query(
      "SELECT id FROM opportunity_activation_statuses WHERE code = ? LIMIT 1",
      [parsed.data.statusCode],
    );
    if (!statusRows.length) {
      return res.status(400).json({ message: "Estado de activacion invalido" });
    }

    if (!canChangeOpportunityActivationStatus(req.user)) {
      return res.status(403).json({
        message:
          "No autorizado para cambiar el estado de activacion de oportunidades",
      });
    }

    const opportunityAccess = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId: id,
      message: "Oportunidad no encontrada",
    });
    if (!opportunityAccess.ok) {
      return res
        .status(opportunityAccess.response.status)
        .json(opportunityAccess.response.body);
    }

    const beforeRows = await query(
      "SELECT activation_status_id FROM opportunities WHERE id = ? LIMIT 1",
      [id],
    );
    if (!beforeRows.length) {
      return res.status(404).json({ message: "Oportunidad no encontrada" });
    }

    const now = new Date();
    await query(
      `UPDATE opportunities
       SET activation_status_id = ?, updated_by = ?, updated_at = ?
       WHERE id = ?`,
      [statusRows[0].id, req.user.id, now, id],
    );

    await logAuditEvent({
      req,
      module: "oportunidades",
      action: "status_changed",
      entityType: "opportunity",
      entityId: id,
      detail: "Estado de oportunidad actualizado",
      before: {
        activation_status_id: Number(beforeRows[0].activation_status_id),
      },
      after: { activation_status_id: Number(statusRows[0].id) },
    });

    const messageByCode = {
      activada: "Oportunidad activada",
      desactivada: "Oportunidad desactivada",
      pendiente_activacion: "Oportunidad marcada como pendiente de activacion",
    };

    return res.json({
      message: messageByCode[parsed.data.statusCode] || "Estado actualizado",
    });
  },
);

export default router;
