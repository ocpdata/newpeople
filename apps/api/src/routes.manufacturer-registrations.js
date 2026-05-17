import express from "express";
import { z } from "zod";
import { query, withTransaction } from "./db.js";
import { requireAnyPermission, requirePermission } from "./auth.js";
import { logAuditEvent, parseAuditChangedFields } from "./audit.js";
import { ensureManufacturerRegistrationsSchema } from "./manufacturer-registrations/schema.js";

const router = express.Router();

const READ_PERMISSIONS = [
  "registros_fabricantes.read",
  "registros_fabricantes.read_all",
];
const REQUEST_PERMISSION = "registros_fabricantes.request";
const UPDATE_PERMISSION = "registros_fabricantes.update";
const MANAGE_PERMISSION = "registros_fabricantes.manage";
const GLOBAL_READ_PERMISSIONS = new Set([
  "registros_fabricantes.read_all",
  "oportunidades.read_all",
]);
const ALERT_THRESHOLDS = [30, 15, 7];
const CLOSED_COMMERCIAL_STATUS_CODES = new Set([
  "ganada",
  "perdida",
  "anulada",
]);

const createSchema = z.object({
  providerId: z.number().int().positive(),
  requestedAt: z.coerce.date(),
  notes: z.string().trim().max(5000).optional().nullable(),
});

const updateSchema = z.object({
  providerId: z.number().int().positive(),
  requestedAt: z.coerce.date(),
  notes: z.string().trim().max(5000).optional().nullable(),
});

const approveSchema = z.object({
  registrationFolio: z.string().trim().min(1).max(120),
  approvedAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date(),
  notes: z.string().trim().max(5000).optional().nullable(),
});

const rejectSchema = z.object({
  rejectionNotes: z.string().trim().max(5000).optional().nullable(),
});

const renewSchema = z.object({
  registrationFolio: z.string().trim().max(120).optional().nullable(),
  expiresAt: z.coerce.date(),
  notes: z.string().trim().max(5000).optional().nullable(),
});

const reopenSchema = z.object({
  notes: z.string().trim().max(5000).optional().nullable(),
});

const listQuerySchema = z.object({
  q: z.string().trim().max(160).optional(),
  displayStatus: z
    .enum(["sin_aprobar", "aprobado", "renovado", "vencido", "rechazado"])
    .optional(),
  alertLevel: z
    .enum(["none", "info", "warning", "critical", "expired"])
    .optional(),
  providerId: z.coerce.number().int().positive().optional(),
  accountId: z.coerce.number().int().positive().optional(),
  opportunityId: z.coerce.number().int().positive().optional(),
  sellerUserId: z.coerce.number().int().positive().optional(),
  salesStageId: z.coerce.number().int().positive().optional(),
  expiresFrom: z.string().trim().optional(),
  expiresTo: z.string().trim().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sortBy: z
    .enum([
      "expiresAt",
      "updatedAt",
      "providerName",
      "accountName",
      "opportunityName",
    ])
    .default("expiresAt"),
  sortDir: z.enum(["asc", "desc"]).default("asc"),
});

router.use(async (_req, res, next) => {
  try {
    await ensureManufacturerRegistrationsSchema();
    next();
  } catch (error) {
    res
      .status(500)
      .json({ message: "No fue posible preparar el esquema del modulo" });
  }
});

function hasGlobalReadScope(user) {
  return Array.from(GLOBAL_READ_PERMISSIONS).some((permission) =>
    user?.permissionSet?.has(permission),
  );
}

function applyOwnedAccountScope({ user, accountExpression, params }) {
  if (hasGlobalReadScope(user)) {
    return "";
  }

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

async function getProviderRow(providerId) {
  const rows = await query(
    `SELECT p.id, p.name, pas.code AS activation_status_code
     FROM providers p
     INNER JOIN provider_activation_statuses pas ON pas.id = p.activation_status_id
     WHERE p.id = ?
     LIMIT 1`,
    [Number(providerId)],
  );
  return rows[0] || null;
}

async function getOpportunityCommercialStatusRow(opportunityId) {
  const rows = await query(
    `SELECT o.id, ocs.code AS commercial_status_code, ocs.name AS commercial_status_name
     FROM opportunities o
     INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
     WHERE o.id = ?
     LIMIT 1`,
    [Number(opportunityId)],
  );
  return rows[0] || null;
}

function isClosedCommercialStatus(code) {
  return CLOSED_COMMERCIAL_STATUS_CODES.has(String(code || "").trim());
}

async function requireOpenOpportunityOr422(opportunityId) {
  const commercialStatus =
    await getOpportunityCommercialStatusRow(opportunityId);
  if (!commercialStatus) {
    return {
      ok: false,
      response: { status: 404, body: { message: "Oportunidad no encontrada" } },
    };
  }

  if (!isClosedCommercialStatus(commercialStatus.commercial_status_code)) {
    return { ok: true, commercialStatus };
  }

  return {
    ok: false,
    response: {
      status: 422,
      body: {
        message:
          "No es posible operar registros de fabricantes cuando la oportunidad esta ganada, perdida o anulada",
        reason: "manufacturer_registration_closed_opportunity",
      },
    },
  };
}

function startOfDay(dateValue) {
  const date = new Date(dateValue);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfDay(dateValue) {
  const date = new Date(dateValue);
  date.setHours(23, 59, 59, 999);
  return date;
}

function toDateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function computeDisplayState(row, now = new Date()) {
  const baseStatus = String(row?.status_code || "sin_aprobar").trim();
  if (baseStatus === "rechazado") {
    return "rechazado";
  }
  if (baseStatus !== "aprobado") {
    return "sin_aprobar";
  }
  const expiresAt = toDateOrNull(row?.expires_at);
  if (expiresAt && expiresAt.getTime() < now.getTime()) {
    return "vencido";
  }
  if (Number(row?.renewal_count || 0) > 0) {
    return "renovado";
  }
  return "aprobado";
}

function computeAlertLevel(row, now = new Date()) {
  const displayStatus = computeDisplayState(row, now);
  const expiresAt = toDateOrNull(row?.expires_at);
  if (displayStatus === "rechazado" || !expiresAt) {
    return { alertLevel: "none", daysToExpire: null };
  }
  const msDiff = startOfDay(expiresAt).getTime() - startOfDay(now).getTime();
  const daysToExpire = Math.ceil(msDiff / 86400000);
  if (daysToExpire < 0) {
    return { alertLevel: "expired", daysToExpire };
  }
  if (daysToExpire <= ALERT_THRESHOLDS[2]) {
    return { alertLevel: "critical", daysToExpire };
  }
  if (daysToExpire <= ALERT_THRESHOLDS[1]) {
    return { alertLevel: "warning", daysToExpire };
  }
  if (daysToExpire <= ALERT_THRESHOLDS[0]) {
    return { alertLevel: "info", daysToExpire };
  }
  return { alertLevel: "none", daysToExpire };
}

function normalizeRegistrationRow(row) {
  const now = new Date();
  const displayStatus = computeDisplayState(row, now);
  const { alertLevel, daysToExpire } = computeAlertLevel(row, now);
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    opportunityName: row.opportunity_name || "",
    accountId: Number(row.account_id),
    accountName: row.account_name || "",
    sellerUserId: row.seller_user_id ? Number(row.seller_user_id) : null,
    sellerUserName: row.seller_user_name || "",
    salesStageId: row.sales_stage_id ? Number(row.sales_stage_id) : null,
    salesStageName: row.sales_stage_name || "",
    providerId: Number(row.provider_id),
    providerName: row.provider_name || "",
    baseStatus: row.status_code || "sin_aprobar",
    displayStatus,
    requestedAt: row.requested_at || null,
    approvedAt: row.approved_at || null,
    expiresAt: row.expires_at || null,
    registrationFolio: row.registration_folio || "",
    renewalCount: Number(row.renewal_count || 0),
    lastRenewedAt: row.last_renewed_at || null,
    rejectedAt: row.rejected_at || null,
    notes: row.notes || "",
    rejectionNotes: row.rejection_notes || "",
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    createdByName: row.created_by_name || "",
    updatedByName: row.updated_by_name || "",
    alertLevel,
    daysToExpire,
  };
}

async function getRegistrationById(registrationId) {
  const rows = await query(
    `SELECT mr.*, o.name AS opportunity_name, o.account_id,
            a.name AS account_name,
            o.seller_user_id,
            su.full_name AS seller_user_name,
            o.sales_stage_id,
            oss.name AS sales_stage_name,
            p.name AS provider_name,
            u1.full_name AS created_by_name,
            u2.full_name AS updated_by_name
     FROM opportunity_manufacturer_registrations mr
     INNER JOIN opportunities o ON o.id = mr.opportunity_id
     INNER JOIN accounts a ON a.id = o.account_id
     INNER JOIN providers p ON p.id = mr.provider_id
     LEFT JOIN users su ON su.id = o.seller_user_id
     LEFT JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
     LEFT JOIN users u1 ON u1.id = mr.created_by_user_id
     LEFT JOIN users u2 ON u2.id = mr.updated_by_user_id
     WHERE mr.id = ?
     LIMIT 1`,
    [Number(registrationId)],
  );
  return rows[0] || null;
}

async function getRenewalsForRegistration(registrationId) {
  const rows = await query(
    `SELECT r.id, r.previous_folio, r.new_folio, r.previous_expires_at,
            r.new_expires_at, r.notes, r.renewed_at, u.full_name AS renewed_by_name
     FROM opportunity_manufacturer_registration_renewals r
     LEFT JOIN users u ON u.id = r.renewed_by_user_id
     WHERE r.registration_id = ?
     ORDER BY r.renewed_at DESC, r.id DESC`,
    [Number(registrationId)],
  );

  return rows.map((row) => ({
    id: Number(row.id),
    previousFolio: row.previous_folio || "",
    newFolio: row.new_folio || "",
    previousExpiresAt: row.previous_expires_at || null,
    newExpiresAt: row.new_expires_at || null,
    notes: row.notes || "",
    renewedAt: row.renewed_at || null,
    renewedByName: row.renewed_by_name || "",
  }));
}

async function getAuditEntriesForRegistration(registrationId) {
  const rows = await query(
    `SELECT id, action, detail, status, created_at,
            performed_by_name, performed_by_email, changed_fields
     FROM audit_log
     WHERE module = 'registros_fabricantes'
       AND entity_type = 'manufacturer_registration'
       AND entity_id = ?
     ORDER BY created_at DESC, id DESC`,
    [Number(registrationId)],
  );

  return rows.map((row) => ({
    id: Number(row.id),
    action: row.action || "",
    detail: row.detail || "",
    status: row.status || "success",
    createdAt: row.created_at || null,
    performedByName: row.performed_by_name || "",
    performedByEmail: row.performed_by_email || "",
    changedFields: parseAuditChangedFields(row.changed_fields),
  }));
}

async function logManufacturerRegistrationEvent({
  req,
  registrationId,
  action,
  detail,
  after = null,
}) {
  await logAuditEvent({
    req,
    module: "registros_fabricantes",
    action,
    entityType: "manufacturer_registration",
    entityId: Number(registrationId),
    detail,
    after,
  });
}

function isDuplicateError(error) {
  return String(error?.code || "") === "ER_DUP_ENTRY";
}

function mapSortColumn(sortBy) {
  switch (sortBy) {
    case "updatedAt":
      return "mr.updated_at";
    case "providerName":
      return "p.name";
    case "accountName":
      return "a.name";
    case "opportunityName":
      return "o.name";
    case "expiresAt":
    default:
      return "mr.expires_at";
  }
}

router.get(
  "/catalogs/manufacturer-registration-providers",
  requirePermission("oportunidades.read"),
  requireAnyPermission(READ_PERMISSIONS),
  async (_req, res) => {
    const rows = await query(
      `SELECT p.id, p.name
       FROM providers p
       INNER JOIN provider_activation_statuses pas ON pas.id = p.activation_status_id
       WHERE pas.code = 'activado'
       ORDER BY p.name ASC`,
    );
    res.json(rows.map((row) => ({ id: Number(row.id), name: row.name || "" })));
  },
);

router.get(
  "/opportunities/:opportunityId/manufacturer-registrations",
  requirePermission("oportunidades.read"),
  requireAnyPermission(READ_PERMISSIONS),
  async (req, res) => {
    const opportunityId = Number(req.params.opportunityId);
    if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
      return res.status(400).json({ message: "Id de oportunidad invalido" });
    }

    const access = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId,
      message: "Oportunidad no encontrada",
    });
    if (!access.ok) {
      return res.status(access.response.status).json(access.response.body);
    }

    const commercialStatus =
      await getOpportunityCommercialStatusRow(opportunityId);
    if (isClosedCommercialStatus(commercialStatus?.commercial_status_code)) {
      return res.json([]);
    }

    const rows = await query(
      `SELECT mr.*, o.name AS opportunity_name, o.account_id,
              a.name AS account_name, o.seller_user_id,
              su.full_name AS seller_user_name, o.sales_stage_id,
              oss.name AS sales_stage_name, p.name AS provider_name,
              ocs.code AS commercial_status_code,
              u1.full_name AS created_by_name, u2.full_name AS updated_by_name
       FROM opportunity_manufacturer_registrations mr
       INNER JOIN opportunities o ON o.id = mr.opportunity_id
       INNER JOIN accounts a ON a.id = o.account_id
       INNER JOIN providers p ON p.id = mr.provider_id
       LEFT JOIN users su ON su.id = o.seller_user_id
       LEFT JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
       INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
       LEFT JOIN users u1 ON u1.id = mr.created_by_user_id
       LEFT JOIN users u2 ON u2.id = mr.updated_by_user_id
       WHERE mr.opportunity_id = ?
       ORDER BY p.name ASC, mr.id DESC`,
      [opportunityId],
    );

    res.json(rows.map(normalizeRegistrationRow));
  },
);

router.get(
  "/opportunities/:opportunityId/manufacturer-registrations/:registrationId",
  requirePermission("oportunidades.read"),
  requireAnyPermission(READ_PERMISSIONS),
  async (req, res) => {
    const opportunityId = Number(req.params.opportunityId);
    const registrationId = Number(req.params.registrationId);
    if (
      !Number.isInteger(opportunityId) ||
      opportunityId <= 0 ||
      !Number.isInteger(registrationId) ||
      registrationId <= 0
    ) {
      return res.status(400).json({ message: "Identificador invalido" });
    }

    const access = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId,
      message: "Oportunidad no encontrada",
    });
    if (!access.ok) {
      return res.status(access.response.status).json(access.response.body);
    }

    const row = await getRegistrationById(registrationId);
    if (!row || Number(row.opportunity_id) !== opportunityId) {
      return res.status(404).json({ message: "Registro no encontrado" });
    }

    res.json({
      ...normalizeRegistrationRow(row),
      renewals: await getRenewalsForRegistration(registrationId),
      auditEntries: await getAuditEntriesForRegistration(registrationId),
    });
  },
);

router.post(
  "/opportunities/:opportunityId/manufacturer-registrations",
  requirePermission("oportunidades.update"),
  requireAnyPermission([REQUEST_PERMISSION]),
  async (req, res) => {
    const opportunityId = Number(req.params.opportunityId);
    if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
      return res.status(400).json({ message: "Id de oportunidad invalido" });
    }

    const access = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId,
      message: "Oportunidad no encontrada",
    });
    if (!access.ok) {
      return res.status(access.response.status).json(access.response.body);
    }

    const opportunityState = await requireOpenOpportunityOr422(opportunityId);
    if (!opportunityState.ok) {
      return res
        .status(opportunityState.response.status)
        .json(opportunityState.response.body);
    }

    const parsed = createSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const provider = await getProviderRow(parsed.data.providerId);
    if (!provider) {
      return res.status(404).json({ message: "Fabricante no encontrado" });
    }

    try {
      const result = await withTransaction(async (conn) => {
        const now = new Date();
        const [insertResult] = await conn.query(
          `INSERT INTO opportunity_manufacturer_registrations
             (opportunity_id, provider_id, status_code, requested_at, notes,
              created_by_user_id, updated_by_user_id, created_at, updated_at)
           VALUES (?, ?, 'sin_aprobar', ?, ?, ?, ?, ?, ?)`,
          [
            opportunityId,
            Number(parsed.data.providerId),
            parsed.data.requestedAt,
            parsed.data.notes || null,
            Number(req.user.id),
            Number(req.user.id),
            now,
            now,
          ],
        );
        return Number(insertResult.insertId);
      });

      const created = await getRegistrationById(result);
      await logManufacturerRegistrationEvent({
        req,
        registrationId: result,
        action: "create",
        detail: `Registro creado para ${provider.name}`,
        after: {
          opportunityId,
          providerId: Number(provider.id),
          providerName: provider.name,
          statusCode: "sin_aprobar",
        },
      });
      return res.status(201).json(normalizeRegistrationRow(created));
    } catch (error) {
      if (isDuplicateError(error)) {
        return res.status(409).json({
          message:
            "Ya existe un registro para ese fabricante en la oportunidad",
          reason: "manufacturer_registration_duplicate_for_opportunity",
        });
      }
      return res
        .status(500)
        .json({ message: "No fue posible crear el registro" });
    }
  },
);

router.put(
  "/opportunities/:opportunityId/manufacturer-registrations/:registrationId",
  requirePermission("oportunidades.update"),
  requireAnyPermission([UPDATE_PERMISSION]),
  async (req, res) => {
    const opportunityId = Number(req.params.opportunityId);
    const registrationId = Number(req.params.registrationId);
    if (
      !Number.isInteger(opportunityId) ||
      opportunityId <= 0 ||
      !Number.isInteger(registrationId) ||
      registrationId <= 0
    ) {
      return res.status(400).json({ message: "Identificador invalido" });
    }

    const parsed = updateSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const access = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId,
      message: "Oportunidad no encontrada",
    });
    if (!access.ok) {
      return res.status(access.response.status).json(access.response.body);
    }

    const opportunityState = await requireOpenOpportunityOr422(opportunityId);
    if (!opportunityState.ok) {
      return res
        .status(opportunityState.response.status)
        .json(opportunityState.response.body);
    }

    const existing = await getRegistrationById(registrationId);
    if (!existing || Number(existing.opportunity_id) !== opportunityId) {
      return res.status(404).json({ message: "Registro no encontrado" });
    }

    try {
      await query(
        `UPDATE opportunity_manufacturer_registrations
         SET provider_id = ?, requested_at = ?, notes = ?, updated_by_user_id = ?, updated_at = NOW(3)
         WHERE id = ?`,
        [
          Number(parsed.data.providerId),
          parsed.data.requestedAt,
          parsed.data.notes || null,
          Number(req.user.id),
          registrationId,
        ],
      );
    } catch (error) {
      if (isDuplicateError(error)) {
        return res.status(409).json({
          message:
            "Ya existe un registro para ese fabricante en la oportunidad",
          reason: "manufacturer_registration_duplicate_for_opportunity",
        });
      }
      return res
        .status(500)
        .json({ message: "No fue posible actualizar el registro" });
    }

    const updated = await getRegistrationById(registrationId);
    await logManufacturerRegistrationEvent({
      req,
      registrationId,
      action: "update",
      detail: `Registro actualizado para ${updated?.provider_name || "fabricante"}`,
      after: {
        providerId: Number(updated.provider_id),
        requestedAt: updated.requested_at,
      },
    });
    res.json(normalizeRegistrationRow(updated));
  },
);

router.post(
  "/opportunities/:opportunityId/manufacturer-registrations/:registrationId/approve",
  requirePermission("oportunidades.update"),
  requireAnyPermission([MANAGE_PERMISSION]),
  async (req, res) => {
    const opportunityId = Number(req.params.opportunityId);
    const registrationId = Number(req.params.registrationId);
    const parsed = approveSchema.safeParse(req.body || {});
    if (
      !Number.isInteger(opportunityId) ||
      opportunityId <= 0 ||
      !Number.isInteger(registrationId) ||
      registrationId <= 0
    ) {
      return res.status(400).json({ message: "Identificador invalido" });
    }
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const access = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId,
      message: "Oportunidad no encontrada",
    });
    if (!access.ok) {
      return res.status(access.response.status).json(access.response.body);
    }

    const opportunityState = await requireOpenOpportunityOr422(opportunityId);
    if (!opportunityState.ok) {
      return res
        .status(opportunityState.response.status)
        .json(opportunityState.response.body);
    }

    const existing = await getRegistrationById(registrationId);
    if (!existing || Number(existing.opportunity_id) !== opportunityId) {
      return res.status(404).json({ message: "Registro no encontrado" });
    }

    const approvedAt = parsed.data.approvedAt || new Date();
    if (parsed.data.expiresAt.getTime() < approvedAt.getTime()) {
      return res.status(422).json({
        message:
          "La fecha de vencimiento no puede ser anterior a la aprobacion",
        reason: "manufacturer_registration_invalid_expiration",
      });
    }

    try {
      await query(
        `UPDATE opportunity_manufacturer_registrations
         SET status_code = 'aprobado', registration_folio = ?, approved_at = ?,
             expires_at = ?, rejected_at = NULL, rejection_notes = NULL,
             notes = ?, updated_by_user_id = ?, updated_at = NOW(3)
         WHERE id = ?`,
        [
          parsed.data.registrationFolio,
          approvedAt,
          parsed.data.expiresAt,
          parsed.data.notes || existing.notes || null,
          Number(req.user.id),
          registrationId,
        ],
      );
    } catch (error) {
      if (isDuplicateError(error)) {
        return res.status(409).json({
          message: "Ese folio ya existe para el fabricante seleccionado",
          reason: "manufacturer_registration_folio_conflict",
        });
      }
      return res
        .status(500)
        .json({ message: "No fue posible aprobar el registro" });
    }

    const updated = await getRegistrationById(registrationId);
    await logManufacturerRegistrationEvent({
      req,
      registrationId,
      action: "approve",
      detail: `Registro aprobado con folio ${parsed.data.registrationFolio}`,
      after: {
        registrationFolio: parsed.data.registrationFolio,
        expiresAt: parsed.data.expiresAt,
      },
    });
    res.json(normalizeRegistrationRow(updated));
  },
);

router.post(
  "/opportunities/:opportunityId/manufacturer-registrations/:registrationId/reject",
  requirePermission("oportunidades.update"),
  requireAnyPermission([MANAGE_PERMISSION]),
  async (req, res) => {
    const opportunityId = Number(req.params.opportunityId);
    const registrationId = Number(req.params.registrationId);
    const parsed = rejectSchema.safeParse(req.body || {});
    if (
      !Number.isInteger(opportunityId) ||
      opportunityId <= 0 ||
      !Number.isInteger(registrationId) ||
      registrationId <= 0
    ) {
      return res.status(400).json({ message: "Identificador invalido" });
    }
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const access = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId,
      message: "Oportunidad no encontrada",
    });
    if (!access.ok) {
      return res.status(access.response.status).json(access.response.body);
    }

    const opportunityState = await requireOpenOpportunityOr422(opportunityId);
    if (!opportunityState.ok) {
      return res
        .status(opportunityState.response.status)
        .json(opportunityState.response.body);
    }

    const existing = await getRegistrationById(registrationId);
    if (!existing || Number(existing.opportunity_id) !== opportunityId) {
      return res.status(404).json({ message: "Registro no encontrado" });
    }

    await query(
      `UPDATE opportunity_manufacturer_registrations
       SET status_code = 'rechazado', rejected_at = NOW(3), rejection_notes = ?,
           updated_by_user_id = ?, updated_at = NOW(3)
       WHERE id = ?`,
      [parsed.data.rejectionNotes || null, Number(req.user.id), registrationId],
    );

    const updated = await getRegistrationById(registrationId);
    await logManufacturerRegistrationEvent({
      req,
      registrationId,
      action: "reject",
      detail: `Registro rechazado para ${updated?.provider_name || "fabricante"}`,
      after: { rejectionNotes: parsed.data.rejectionNotes || null },
    });
    res.json(normalizeRegistrationRow(updated));
  },
);

router.post(
  "/opportunities/:opportunityId/manufacturer-registrations/:registrationId/renew",
  requirePermission("oportunidades.update"),
  requireAnyPermission([MANAGE_PERMISSION]),
  async (req, res) => {
    const opportunityId = Number(req.params.opportunityId);
    const registrationId = Number(req.params.registrationId);
    const parsed = renewSchema.safeParse(req.body || {});
    if (
      !Number.isInteger(opportunityId) ||
      opportunityId <= 0 ||
      !Number.isInteger(registrationId) ||
      registrationId <= 0
    ) {
      return res.status(400).json({ message: "Identificador invalido" });
    }
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const access = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId,
      message: "Oportunidad no encontrada",
    });
    if (!access.ok) {
      return res.status(access.response.status).json(access.response.body);
    }

    const opportunityState = await requireOpenOpportunityOr422(opportunityId);
    if (!opportunityState.ok) {
      return res
        .status(opportunityState.response.status)
        .json(opportunityState.response.body);
    }

    const existing = await getRegistrationById(registrationId);
    if (!existing || Number(existing.opportunity_id) !== opportunityId) {
      return res.status(404).json({ message: "Registro no encontrado" });
    }
    if (String(existing.status_code) === "rechazado") {
      return res.status(422).json({
        message:
          "No es posible renovar un registro rechazado sin reabrirlo primero",
        reason: "manufacturer_registration_cannot_renew_rejected",
      });
    }

    const nextFolio = String(
      parsed.data.registrationFolio || existing.registration_folio || "",
    ).trim();
    if (!nextFolio) {
      return res.status(422).json({
        message: "Debes indicar un folio para renovar el registro",
        reason: "manufacturer_registration_missing_folio",
      });
    }

    try {
      await withTransaction(async (conn) => {
        await conn.query(
          `INSERT INTO opportunity_manufacturer_registration_renewals
             (registration_id, previous_folio, new_folio, previous_expires_at,
              new_expires_at, notes, renewed_by_user_id, renewed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3))`,
          [
            registrationId,
            existing.registration_folio || null,
            nextFolio,
            existing.expires_at || null,
            parsed.data.expiresAt,
            parsed.data.notes || null,
            Number(req.user.id),
          ],
        );

        await conn.query(
          `UPDATE opportunity_manufacturer_registrations
           SET status_code = 'aprobado', registration_folio = ?, expires_at = ?,
               renewal_count = renewal_count + 1, last_renewed_at = NOW(3),
               notes = ?, updated_by_user_id = ?, updated_at = NOW(3)
           WHERE id = ?`,
          [
            nextFolio,
            parsed.data.expiresAt,
            parsed.data.notes || existing.notes || null,
            Number(req.user.id),
            registrationId,
          ],
        );
      });
    } catch (error) {
      if (isDuplicateError(error)) {
        return res.status(409).json({
          message: "Ese folio ya existe para el fabricante seleccionado",
          reason: "manufacturer_registration_folio_conflict",
        });
      }
      return res
        .status(500)
        .json({ message: "No fue posible renovar el registro" });
    }

    const updated = await getRegistrationById(registrationId);
    await logManufacturerRegistrationEvent({
      req,
      registrationId,
      action: "renew",
      detail: `Registro renovado hasta ${parsed.data.expiresAt.toISOString()}`,
      after: {
        registrationFolio: nextFolio,
        expiresAt: parsed.data.expiresAt,
        renewalCount: Number(updated?.renewal_count || 0),
      },
    });
    res.json({
      ...normalizeRegistrationRow(updated),
      renewals: await getRenewalsForRegistration(registrationId),
    });
  },
);

router.post(
  "/opportunities/:opportunityId/manufacturer-registrations/:registrationId/reopen",
  requirePermission("oportunidades.update"),
  requireAnyPermission([MANAGE_PERMISSION]),
  async (req, res) => {
    const opportunityId = Number(req.params.opportunityId);
    const registrationId = Number(req.params.registrationId);
    const parsed = reopenSchema.safeParse(req.body || {});
    if (
      !Number.isInteger(opportunityId) ||
      opportunityId <= 0 ||
      !Number.isInteger(registrationId) ||
      registrationId <= 0
    ) {
      return res.status(400).json({ message: "Identificador invalido" });
    }
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const access = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId,
      message: "Oportunidad no encontrada",
    });
    if (!access.ok) {
      return res.status(access.response.status).json(access.response.body);
    }

    const opportunityState = await requireOpenOpportunityOr422(opportunityId);
    if (!opportunityState.ok) {
      return res
        .status(opportunityState.response.status)
        .json(opportunityState.response.body);
    }

    const existing = await getRegistrationById(registrationId);
    if (!existing || Number(existing.opportunity_id) !== opportunityId) {
      return res.status(404).json({ message: "Registro no encontrado" });
    }

    await query(
      `UPDATE opportunity_manufacturer_registrations
       SET status_code = 'sin_aprobar', rejection_notes = NULL, rejected_at = NULL,
           notes = ?, updated_by_user_id = ?, updated_at = NOW(3)
       WHERE id = ?`,
      [
        parsed.data.notes || existing.notes || null,
        Number(req.user.id),
        registrationId,
      ],
    );

    const updated = await getRegistrationById(registrationId);
    await logManufacturerRegistrationEvent({
      req,
      registrationId,
      action: "reopen",
      detail: `Registro reabierto para ${updated?.provider_name || "fabricante"}`,
      after: { statusCode: "sin_aprobar" },
    });
    res.json(normalizeRegistrationRow(updated));
  },
);

router.get(
  "/manufacturer-registrations",
  requirePermission("oportunidades.read"),
  requireAnyPermission(["registros_fabricantes.read_all"]),
  async (req, res) => {
    const parsed = listQuerySchema.safeParse(req.query || {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Filtros invalidos", errors: parsed.error.flatten() });
    }

    const filters = parsed.data;
    const params = [];
    const ownershipJoin = applyOwnedAccountScope({
      user: req.user,
      accountExpression: "o.account_id",
      params,
    });
    const where = [];

    if (filters.providerId) {
      where.push("mr.provider_id = ?");
      params.push(filters.providerId);
    }
    if (filters.accountId) {
      where.push("o.account_id = ?");
      params.push(filters.accountId);
    }
    if (filters.opportunityId) {
      where.push("o.id = ?");
      params.push(filters.opportunityId);
    }
    if (filters.sellerUserId) {
      where.push("o.seller_user_id = ?");
      params.push(filters.sellerUserId);
    }
    if (filters.salesStageId) {
      where.push("o.sales_stage_id = ?");
      params.push(filters.salesStageId);
    }
    where.push("ocs.code NOT IN ('ganada', 'perdida', 'anulada')");
    if (filters.expiresFrom) {
      where.push("mr.expires_at >= ?");
      params.push(startOfDay(filters.expiresFrom));
    }
    if (filters.expiresTo) {
      where.push("mr.expires_at <= ?");
      params.push(endOfDay(filters.expiresTo));
    }
    if (filters.q) {
      const term = `%${String(filters.q).toLowerCase()}%`;
      where.push(`(
        LOWER(o.name) LIKE ? OR LOWER(a.name) LIKE ? OR LOWER(p.name) LIKE ? OR LOWER(COALESCE(mr.registration_folio, '')) LIKE ?
      )`);
      params.push(term, term, term, term);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const sortColumn = mapSortColumn(filters.sortBy);
    const sortDirection = filters.sortDir === "desc" ? "DESC" : "ASC";
    const offset = (filters.page - 1) * filters.pageSize;

    const rows = await query(
      `SELECT mr.*, o.name AS opportunity_name, o.account_id, a.name AS account_name,
              o.seller_user_id, su.full_name AS seller_user_name,
              o.sales_stage_id, oss.name AS sales_stage_name,
          p.name AS provider_name, ocs.code AS commercial_status_code,
              u1.full_name AS created_by_name, u2.full_name AS updated_by_name
       FROM opportunity_manufacturer_registrations mr
       INNER JOIN opportunities o ON o.id = mr.opportunity_id
       ${ownershipJoin}
       INNER JOIN accounts a ON a.id = o.account_id
       INNER JOIN providers p ON p.id = mr.provider_id
       LEFT JOIN users su ON su.id = o.seller_user_id
       LEFT JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
        INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
       LEFT JOIN users u1 ON u1.id = mr.created_by_user_id
       LEFT JOIN users u2 ON u2.id = mr.updated_by_user_id
       ${whereSql}
       ORDER BY ${sortColumn} ${sortDirection}, mr.id DESC`,
      params,
    );

    let filteredItems = rows.map(normalizeRegistrationRow);
    if (filters.displayStatus) {
      filteredItems = filteredItems.filter(
        (item) => item.displayStatus === filters.displayStatus,
      );
    }
    if (filters.alertLevel) {
      filteredItems = filteredItems.filter(
        (item) => item.alertLevel === filters.alertLevel,
      );
    }

    const summary = filteredItems.reduce(
      (accumulator, item) => {
        if (item.displayStatus === "sin_aprobar") accumulator.sinAprobar += 1;
        if (item.displayStatus === "aprobado") accumulator.aprobado += 1;
        if (item.displayStatus === "renovado") accumulator.renovado += 1;
        if (item.displayStatus === "vencido") accumulator.vencido += 1;
        if (item.displayStatus === "rechazado") accumulator.rechazado += 1;
        if (item.alertLevel === "critical") accumulator.criticalAlerts += 1;
        return accumulator;
      },
      {
        sinAprobar: 0,
        aprobado: 0,
        renovado: 0,
        vencido: 0,
        rechazado: 0,
        criticalAlerts: 0,
      },
    );

    const total = filteredItems.length;
    const items = filteredItems.slice(offset, offset + filters.pageSize);

    res.json({
      items,
      pagination: {
        page: filters.page,
        pageSize: filters.pageSize,
        total,
      },
      summary,
    });
  },
);

router.get(
  "/manufacturer-registrations/alerts",
  requirePermission("oportunidades.read"),
  requireAnyPermission(["registros_fabricantes.read_all"]),
  async (req, res) => {
    const params = [];
    const ownershipJoin = applyOwnedAccountScope({
      user: req.user,
      accountExpression: "o.account_id",
      params,
    });
    const rows = await query(
      `SELECT mr.id, mr.status_code, mr.expires_at, mr.renewal_count
       FROM opportunity_manufacturer_registrations mr
       INNER JOIN opportunities o ON o.id = mr.opportunity_id
       INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
       ${ownershipJoin}
       WHERE ocs.code NOT IN ('ganada', 'perdida', 'anulada')`,
      params,
    );

    const summary = rows
      .map((row) => ({
        displayStatus: computeDisplayState(row),
        ...computeAlertLevel(row),
      }))
      .reduce(
        (accumulator, row) => {
          accumulator.total += 1;
          if (row.alertLevel === "info") accumulator.info += 1;
          if (row.alertLevel === "warning") accumulator.warning += 1;
          if (row.alertLevel === "critical") accumulator.critical += 1;
          if (row.alertLevel === "expired") accumulator.expired += 1;
          return accumulator;
        },
        { total: 0, info: 0, warning: 0, critical: 0, expired: 0 },
      );

    res.json(summary);
  },
);

router.get(
  "/manufacturer-registrations/:registrationId/audit",
  requirePermission("oportunidades.read"),
  requireAnyPermission(READ_PERMISSIONS),
  async (req, res) => {
    const registrationId = Number(req.params.registrationId);
    if (!Number.isInteger(registrationId) || registrationId <= 0) {
      return res.status(400).json({ message: "Identificador invalido" });
    }

    const registration = await getRegistrationById(registrationId);
    if (!registration) {
      return res.status(404).json({ message: "Registro no encontrado" });
    }

    const access = await requireAccessibleOpportunityOr404({
      user: req.user,
      opportunityId: Number(registration.opportunity_id),
      message: "Registro no encontrado",
    });
    if (!access.ok) {
      return res.status(access.response.status).json(access.response.body);
    }

    res.json({ items: await getAuditEntriesForRegistration(registrationId) });
  },
);

export default router;
