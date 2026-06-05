import { createHash, randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import express from "express";
import formidable from "formidable";
import { z } from "zod";
import { requireAnyPermission, requirePermission } from "./auth.js";
import { logAuditEvent } from "./audit.js";
import { config } from "./config.js";
import { query, withTransaction } from "./db.js";
import { ensureOpportunityDocumentSchema } from "./opportunity-documents/schema.js";
import { createDocumentStorage } from "./opportunity-documents/storage.js";
import { ensureAccountInteractionsSchema } from "./account-interactions/schema.js";

const router = express.Router({ mergeParams: true });
const storage = createDocumentStorage();
const accountReadPermission = "cuentas.read";
const accountGlobalReadPermission = "cuentas.read_all";
const accountWritePermissions = ["cuentas.create", "cuentas.update"];
const accountInteractionAccessPermissions = [
  accountReadPermission,
  ...accountWritePermissions,
];
const opportunityCreatePermissions = ["oportunidades.create"];

const interactionSchema = z.object({
  interactionTypeId: z.number().int().positive(),
  resultId: z.number().int().positive(),
  title: z.string().trim().min(2).max(255),
  summary: z.string().trim().min(2).max(50000),
  nextStep: z.string().trim().max(50000).optional().nullable(),
  occurredAt: z.string().trim().min(10).max(40),
  followUpAt: z.string().trim().max(40).optional().nullable(),
  contactIds: z.array(z.number().int().positive()).optional().default([]),
});

const interactionResultSchema = z.object({
  resultId: z.number().int().positive(),
});

const createOpportunityFromInteractionSchema = z.object({
  name: z.string().trim().min(2).max(180),
  amountUsd: z.number().nonnegative(),
  closeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  contactId: z.number().int().positive(),
  businessLineId: z.number().int().positive(),
  sellerUserId: z.number().int().positive(),
  presalesUserId: z.number().int().positive().optional().nullable(),
  documentPublicIds: z
    .array(z.string().trim().min(4).max(64))
    .optional()
    .default([]),
});

function hasGlobalAccountReadScope(user) {
  return user?.permissionSet?.has(accountGlobalReadPermission);
}

function resolveOpportunityCreationStatusCode(user) {
  if (user?.permissionSet?.has("oportunidades.create")) {
    return "activada";
  }
  return null;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function sanitizeFileName(fileName) {
  return String(fileName || "archivo")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 160);
}

function buildAttachmentStorageKey({ accountId, interactionId, fileName }) {
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return [
    "account-interactions",
    year,
    month,
    `account-${accountId}`,
    `interaction-${interactionId}`,
    `${Date.now()}-${randomUUID().replace(/-/g, "")}-${sanitizeFileName(fileName)}`,
  ].join("/");
}

function buildDocumentPublicId() {
  return `doc_${randomUUID().replace(/-/g, "")}`;
}

function serializeDocumentRow(row) {
  return {
    publicId: row.public_id,
    originalFileName: row.original_file_name,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size || 0),
    documentKind: row.document_kind || null,
    processingStatus: row.processing_status || "uploaded",
    createdAt: row.created_at,
  };
}

async function requireAccessibleAccountOr404({ user, accountId, message }) {
  const rows = hasGlobalAccountReadScope(user)
    ? await query(`SELECT id FROM accounts WHERE id = ? LIMIT 1`, [
        Number(accountId),
      ])
    : await query(
        `SELECT a.id
         FROM accounts a
         INNER JOIN account_owners ao ON ao.account_id = a.id AND ao.user_id = ?
         WHERE a.id = ?
         LIMIT 1`,
        [Number(user.id), Number(accountId)],
      );

  if (!rows.length) {
    return { ok: false, response: { status: 404, body: { message } } };
  }

  return { ok: true };
}

async function requireInteractionOr404({
  user,
  accountId,
  interactionId,
  message,
}) {
  const rows = hasGlobalAccountReadScope(user)
    ? await query(
        `SELECT ai.id, ai.account_id, ai.linked_opportunity_id
         FROM account_interactions ai
         WHERE ai.id = ? AND ai.account_id = ?
         LIMIT 1`,
        [Number(interactionId), Number(accountId)],
      )
    : await query(
        `SELECT ai.id, ai.account_id, ai.linked_opportunity_id
         FROM account_interactions ai
         INNER JOIN account_owners ao ON ao.account_id = ai.account_id AND ao.user_id = ?
         WHERE ai.id = ? AND ai.account_id = ?
         LIMIT 1`,
        [Number(user.id), Number(interactionId), Number(accountId)],
      );

  if (!rows.length) {
    return { ok: false, response: { status: 404, body: { message } } };
  }

  return { ok: true, interaction: rows[0] };
}

async function validateInteractionContacts({ accountId, contactIds }) {
  if (!Array.isArray(contactIds) || !contactIds.length) {
    return { ok: true };
  }

  const placeholders = contactIds.map(() => "?").join(", ");
  const rows = await query(
    `SELECT id, account_id
     FROM contacts
     WHERE id IN (${placeholders})`,
    contactIds,
  );

  if (rows.length !== contactIds.length) {
    return {
      ok: false,
      status: 400,
      message: "Uno o mas contactos no existen",
    };
  }

  const invalid = rows.some(
    (row) => Number(row.account_id) !== Number(accountId),
  );
  if (invalid) {
    return {
      ok: false,
      status: 400,
      message: "Todos los contactos deben pertenecer a la cuenta seleccionada",
    };
  }

  return { ok: true };
}

function parseDateTimeOrNull(value, fieldName, { dateOnly = false } = {}) {
  const text = String(value || "").trim();
  if (!text) return null;

  const normalized =
    dateOnly && /^\d{4}-\d{2}-\d{2}$/.test(text)
      ? `${text}T00:00:00.000Z`
      : text;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    const error = new Error(`${fieldName} invalido`);
    error.status = 400;
    throw error;
  }
  return date;
}

function toDateTimeSql(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 23).replace("T", " ");
}

async function fetchInteractionContacts(interactionId) {
  return await query(
    `SELECT c.id, TRIM(CONCAT_WS(' ', c.first_name, c.last_name)) AS full_name,
            c.email, c.phone, c.position_title
     FROM account_interaction_contacts aic
     INNER JOIN contacts c ON c.id = aic.contact_id
     WHERE aic.interaction_id = ?
     ORDER BY c.first_name, c.last_name, c.id`,
    [Number(interactionId)],
  );
}

async function fetchInteractionDocuments(interactionId) {
  const rows = await query(
    `SELECT public_id, original_file_name, mime_type, byte_size, document_kind,
            processing_status, created_at
     FROM documents
     WHERE entity_type = 'account_interaction'
       AND entity_id = ?
       AND is_deleted = 0
     ORDER BY created_at DESC, id DESC`,
    [Number(interactionId)],
  );
  return rows.map((row) => serializeDocumentRow(row));
}

async function fetchInteractionDetail(interactionId) {
  const rows = await query(
    `SELECT ai.id, ai.public_id, ai.account_id, ai.title, ai.summary, ai.next_step,
            ai.occurred_at, ai.follow_up_at, ai.linked_opportunity_id,
            ait.id AS interaction_type_id, ait.code AS interaction_type_code, ait.name AS interaction_type_name,
            air.id AS result_id, air.code AS result_code, air.name AS result_name,
            uc.full_name AS created_by_name, uu.full_name AS updated_by_name,
            ai.created_at, ai.updated_at
     FROM account_interactions ai
     INNER JOIN account_interaction_types ait ON ait.id = ai.interaction_type_id
     INNER JOIN account_interaction_results air ON air.id = ai.result_id
     INNER JOIN users uc ON uc.id = ai.created_by
     INNER JOIN users uu ON uu.id = ai.updated_by
     WHERE ai.id = ?
     LIMIT 1`,
    [Number(interactionId)],
  );

  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: Number(row.id),
    publicId: row.public_id,
    accountId: Number(row.account_id),
    type: {
      id: Number(row.interaction_type_id),
      code: row.interaction_type_code,
      name: row.interaction_type_name,
    },
    result: {
      id: Number(row.result_id),
      code: row.result_code,
      name: row.result_name,
    },
    title: row.title,
    summary: row.summary,
    nextStep: row.next_step || "",
    occurredAt: row.occurred_at,
    followUpAt: row.follow_up_at,
    linkedOpportunityId:
      row.linked_opportunity_id === null
        ? null
        : Number(row.linked_opportunity_id),
    createdByName: row.created_by_name || null,
    updatedByName: row.updated_by_name || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    contacts: await fetchInteractionContacts(row.id),
    documents: await fetchInteractionDocuments(row.id),
  };
}

async function getOpportunityActivationStatusId(statusCode) {
  const rows = await query(
    "SELECT id FROM opportunity_activation_statuses WHERE code = ? LIMIT 1",
    [statusCode],
  );
  return rows.length ? Number(rows[0].id) : null;
}

async function getOpportunityCommercialStatusId(statusCode) {
  const rows = await query(
    "SELECT id FROM opportunity_commercial_statuses WHERE code = ? LIMIT 1",
    [statusCode],
  );
  return rows.length ? Number(rows[0].id) : null;
}

async function getOpportunitySalesStageByCode(stageCode) {
  const rows = await query(
    `SELECT id
     FROM opportunity_sales_stages
     WHERE code = ?
     LIMIT 1`,
    [stageCode],
  );
  return rows.length ? rows[0] : null;
}

async function validateOpportunityRelations({
  user,
  accountId,
  contactId,
  sellerUserId,
  presalesUserId,
}) {
  const accountAccess = await requireAccessibleAccountOr404({
    user,
    accountId,
    message: "Cuenta no encontrada",
  });
  if (!accountAccess.ok) {
    return {
      ok: false,
      status: accountAccess.response.status,
      message: accountAccess.response.body.message,
    };
  }

  const contactRows = await query(
    "SELECT account_id FROM contacts WHERE id = ? LIMIT 1",
    [Number(contactId)],
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
     WHERE u.id = ?
       AND u.status = 'active'
       AND EXISTS (
         SELECT 1
         FROM user_roles ur
         INNER JOIN role_permissions rp ON rp.role_id = ur.role_id
         INNER JOIN permissions p ON p.id = rp.permission_id
         WHERE ur.user_id = u.id
           AND p.code IN ('oportunidades.read', 'oportunidades.read_all', 'oportunidades.create', 'oportunidades.request', 'oportunidades.update')
       )
     LIMIT 1`,
    [Number(sellerUserId)],
  );
  if (!sellerRows.length) {
    return {
      ok: false,
      status: 400,
      message: "El vendedor debe tener permisos de oportunidades",
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
      [Number(presalesUserId)],
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

async function parseMultipartFiles(req) {
  const form = formidable({
    multiples: true,
    maxFiles: 10,
    maxFileSize: config.documents.storage.maxSessionBytes,
    allowEmptyFiles: false,
  });

  return await new Promise((resolve, reject) => {
    form.parse(req, (error, _fields, files) => {
      if (error) {
        reject(error);
        return;
      }
      const normalized = Array.isArray(files.files)
        ? files.files
        : files.files
          ? [files.files]
          : [];
      resolve(normalized);
    });
  });
}

router.use(async (_req, _res, next) => {
  try {
    await ensureAccountInteractionsSchema();
    next();
  } catch (error) {
    next(error);
  }
});

router.get(
  "/",
  requireAnyPermission(accountInteractionAccessPermissions),
  async (req, res) => {
    const accountId = Number(req.params.accountId);
    if (!Number.isInteger(accountId) || accountId <= 0) {
      return res.status(400).json({ message: "accountId invalido" });
    }

    const accountAccess = await requireAccessibleAccountOr404({
      user: req.user,
      accountId,
      message: "Cuenta no encontrada",
    });
    if (!accountAccess.ok) {
      return res
        .status(accountAccess.response.status)
        .json(accountAccess.response.body);
    }

    const params = [accountId];
    const filters = ["ai.account_id = ?"];

    if (req.query.typeCode) {
      filters.push("ait.code = ?");
      params.push(String(req.query.typeCode));
    }
    if (req.query.resultCode) {
      filters.push("air.code = ?");
      params.push(String(req.query.resultCode));
    }
    if (req.query.fromDate) {
      filters.push("DATE(ai.occurred_at) >= ?");
      params.push(String(req.query.fromDate));
    }
    if (req.query.toDate) {
      filters.push("DATE(ai.occurred_at) <= ?");
      params.push(String(req.query.toDate));
    }

    const rows = await query(
      `SELECT ai.id, ai.public_id, ai.title, ai.summary, ai.next_step,
            ai.occurred_at, ai.follow_up_at, ai.linked_opportunity_id,
            ait.id AS interaction_type_id, ait.code AS interaction_type_code, ait.name AS interaction_type_name,
            air.id AS result_id, air.code AS result_code, air.name AS result_name,
            uc.full_name AS created_by_name, ai.created_at, ai.updated_at,
            (
              SELECT COUNT(*)
              FROM documents d
              WHERE d.entity_type = 'account_interaction'
                AND d.entity_id = ai.id
                AND d.is_deleted = 0
            ) AS document_count
     FROM account_interactions ai
     INNER JOIN account_interaction_types ait ON ait.id = ai.interaction_type_id
     INNER JOIN account_interaction_results air ON air.id = ai.result_id
     INNER JOIN users uc ON uc.id = ai.created_by
     WHERE ${filters.join(" AND ")}
     ORDER BY ai.occurred_at DESC, ai.id DESC`,
      params,
    );

    const items = await Promise.all(
      rows.map(async (row) => ({
        id: Number(row.id),
        publicId: row.public_id,
        title: row.title,
        summary: row.summary,
        nextStep: row.next_step || "",
        occurredAt: row.occurred_at,
        followUpAt: row.follow_up_at,
        linkedOpportunityId:
          row.linked_opportunity_id === null
            ? null
            : Number(row.linked_opportunity_id),
        type: {
          id: Number(row.interaction_type_id),
          code: row.interaction_type_code,
          name: row.interaction_type_name,
        },
        result: {
          id: Number(row.result_id),
          code: row.result_code,
          name: row.result_name,
        },
        contacts: await fetchInteractionContacts(row.id),
        documentCount: Number(row.document_count || 0),
        createdByName: row.created_by_name || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    );

    return res.json({ items });
  },
);

router.get(
  "/contact-options",
  requireAnyPermission(accountInteractionAccessPermissions),
  async (req, res) => {
    const accountId = Number(req.params.accountId);
    if (!Number.isInteger(accountId) || accountId <= 0) {
      return res.status(400).json({ message: "accountId invalido" });
    }

    const accountAccess = await requireAccessibleAccountOr404({
      user: req.user,
      accountId,
      message: "Cuenta no encontrada",
    });
    if (!accountAccess.ok) {
      return res
        .status(accountAccess.response.status)
        .json(accountAccess.response.body);
    }

    const rows = await query(
      `SELECT c.id, TRIM(CONCAT_WS(' ', c.first_name, c.last_name)) AS full_name,
              c.email, c.phone, cas.name AS activation_status
       FROM contacts c
       INNER JOIN contact_activation_statuses cas ON cas.id = c.activation_status_id
       WHERE c.account_id = ?
       ORDER BY c.first_name, c.last_name, c.id`,
      [accountId],
    );

    return res.json(
      rows.map((row) => ({
        id: Number(row.id),
        fullName: row.full_name,
        email: row.email || "",
        phone: row.phone || "",
        activationStatus: row.activation_status || "",
      })),
    );
  },
);

router.get(
  "/:interactionId",
  requireAnyPermission(accountInteractionAccessPermissions),
  async (req, res) => {
    const accountId = Number(req.params.accountId);
    const interactionId = Number(req.params.interactionId);
    if (
      !Number.isInteger(accountId) ||
      accountId <= 0 ||
      !Number.isInteger(interactionId) ||
      interactionId <= 0
    ) {
      return res.status(400).json({ message: "Parametros invalidos" });
    }

    const interactionAccess = await requireInteractionOr404({
      user: req.user,
      accountId,
      interactionId,
      message: "Interaccion comercial no encontrada",
    });
    if (!interactionAccess.ok) {
      return res
        .status(interactionAccess.response.status)
        .json(interactionAccess.response.body);
    }

    const detail = await fetchInteractionDetail(interactionId);
    return res.json(detail);
  },
);

router.post(
  "/",
  requireAnyPermission(accountWritePermissions),
  async (req, res) => {
    const accountId = Number(req.params.accountId);
    if (!Number.isInteger(accountId) || accountId <= 0) {
      return res.status(400).json({ message: "accountId invalido" });
    }

    const parsed = interactionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const accountAccess = await requireAccessibleAccountOr404({
      user: req.user,
      accountId,
      message: "Cuenta no encontrada",
    });
    if (!accountAccess.ok) {
      return res
        .status(accountAccess.response.status)
        .json(accountAccess.response.body);
    }

    const contactValidation = await validateInteractionContacts({
      accountId,
      contactIds: parsed.data.contactIds,
    });
    if (!contactValidation.ok) {
      return res
        .status(contactValidation.status)
        .json({ message: contactValidation.message });
    }

    try {
      const occurredAt = parseDateTimeOrNull(
        parsed.data.occurredAt,
        "occurredAt",
      );
      const followUpAt = parseDateTimeOrNull(
        parsed.data.followUpAt,
        "followUpAt",
      );
      const publicId = `aci_${randomUUID().replace(/-/g, "")}`;
      const now = new Date();

      const interactionId = await withTransaction(async (conn) => {
        const [insertResult] = await conn.query(
          `INSERT INTO account_interactions
           (public_id, account_id, interaction_type_id, result_id, title, summary,
            next_step, occurred_at, follow_up_at, linked_opportunity_id,
            created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
          [
            publicId,
            accountId,
            parsed.data.interactionTypeId,
            parsed.data.resultId,
            parsed.data.title,
            parsed.data.summary,
            parsed.data.nextStep || null,
            toDateTimeSql(occurredAt),
            toDateTimeSql(followUpAt),
            Number(req.user.id),
            Number(req.user.id),
            now,
            now,
          ],
        );

        for (const contactId of parsed.data.contactIds) {
          await conn.query(
            `INSERT INTO account_interaction_contacts (interaction_id, contact_id, created_at)
           VALUES (?, ?, NOW(3))`,
            [insertResult.insertId, Number(contactId)],
          );
        }

        return insertResult.insertId;
      });

      await logAuditEvent({
        req,
        module: "cuentas",
        action: "account_interaction_created",
        entityType: "account_interaction",
        entityId: interactionId,
        detail: "Interaccion comercial registrada",
        after: {
          account_id: accountId,
          title: parsed.data.title,
          result_id: parsed.data.resultId,
        },
      });

      return res.status(201).json({
        message: "Interaccion comercial registrada",
        interaction: await fetchInteractionDetail(interactionId),
      });
    } catch (error) {
      return res.status(error.status || 500).json({
        message:
          error.status && error.status < 500
            ? error.message
            : "No fue posible registrar la interaccion comercial",
      });
    }
  },
);

router.put(
  "/:interactionId",
  requirePermission("cuentas.update"),
  async (req, res) => {
    const accountId = Number(req.params.accountId);
    const interactionId = Number(req.params.interactionId);
    if (
      !Number.isInteger(accountId) ||
      accountId <= 0 ||
      !Number.isInteger(interactionId) ||
      interactionId <= 0
    ) {
      return res.status(400).json({ message: "Parametros invalidos" });
    }

    const parsed = interactionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const interactionAccess = await requireInteractionOr404({
      user: req.user,
      accountId,
      interactionId,
      message: "Interaccion comercial no encontrada",
    });
    if (!interactionAccess.ok) {
      return res
        .status(interactionAccess.response.status)
        .json(interactionAccess.response.body);
    }

    const contactValidation = await validateInteractionContacts({
      accountId,
      contactIds: parsed.data.contactIds,
    });
    if (!contactValidation.ok) {
      return res
        .status(contactValidation.status)
        .json({ message: contactValidation.message });
    }

    try {
      const occurredAt = parseDateTimeOrNull(
        parsed.data.occurredAt,
        "occurredAt",
      );
      const followUpAt = parseDateTimeOrNull(
        parsed.data.followUpAt,
        "followUpAt",
      );

      await withTransaction(async (conn) => {
        await conn.query(
          `UPDATE account_interactions
         SET interaction_type_id = ?, result_id = ?, title = ?, summary = ?,
             next_step = ?, occurred_at = ?, follow_up_at = ?,
             updated_by = ?, updated_at = NOW(3)
         WHERE id = ? AND account_id = ?`,
          [
            parsed.data.interactionTypeId,
            parsed.data.resultId,
            parsed.data.title,
            parsed.data.summary,
            parsed.data.nextStep || null,
            toDateTimeSql(occurredAt),
            toDateTimeSql(followUpAt),
            Number(req.user.id),
            interactionId,
            accountId,
          ],
        );

        await conn.query(
          `DELETE FROM account_interaction_contacts WHERE interaction_id = ?`,
          [interactionId],
        );
        for (const contactId of parsed.data.contactIds) {
          await conn.query(
            `INSERT INTO account_interaction_contacts (interaction_id, contact_id, created_at)
           VALUES (?, ?, NOW(3))`,
            [interactionId, Number(contactId)],
          );
        }
      });

      await logAuditEvent({
        req,
        module: "cuentas",
        action: "account_interaction_updated",
        entityType: "account_interaction",
        entityId: interactionId,
        detail: "Interaccion comercial actualizada",
        after: {
          title: parsed.data.title,
          result_id: parsed.data.resultId,
        },
      });

      return res.json({
        message: "Interaccion comercial actualizada",
        interaction: await fetchInteractionDetail(interactionId),
      });
    } catch (error) {
      return res.status(error.status || 500).json({
        message:
          error.status && error.status < 500
            ? error.message
            : "No fue posible actualizar la interaccion comercial",
      });
    }
  },
);

router.patch(
  "/:interactionId/result",
  requirePermission("cuentas.update"),
  async (req, res) => {
    const accountId = Number(req.params.accountId);
    const interactionId = Number(req.params.interactionId);
    if (
      !Number.isInteger(accountId) ||
      accountId <= 0 ||
      !Number.isInteger(interactionId) ||
      interactionId <= 0
    ) {
      return res.status(400).json({ message: "Parametros invalidos" });
    }

    const parsed = interactionResultSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const interactionAccess = await requireInteractionOr404({
      user: req.user,
      accountId,
      interactionId,
      message: "Interaccion comercial no encontrada",
    });
    if (!interactionAccess.ok) {
      return res
        .status(interactionAccess.response.status)
        .json(interactionAccess.response.body);
    }

    await query(
      `UPDATE account_interactions
     SET result_id = ?, updated_by = ?, updated_at = NOW(3)
     WHERE id = ? AND account_id = ?`,
      [parsed.data.resultId, Number(req.user.id), interactionId, accountId],
    );

    await logAuditEvent({
      req,
      module: "cuentas",
      action: "account_interaction_result_changed",
      entityType: "account_interaction",
      entityId: interactionId,
      detail: "Resultado de interaccion comercial actualizado",
      after: { result_id: parsed.data.resultId },
    });

    return res.json({
      message: "Resultado actualizado",
      interaction: await fetchInteractionDetail(interactionId),
    });
  },
);

router.get(
  "/:interactionId/documents",
  requireAnyPermission(accountInteractionAccessPermissions),
  async (req, res) => {
    const accountId = Number(req.params.accountId);
    const interactionId = Number(req.params.interactionId);
    if (
      !Number.isInteger(accountId) ||
      accountId <= 0 ||
      !Number.isInteger(interactionId) ||
      interactionId <= 0
    ) {
      return res.status(400).json({ message: "Parametros invalidos" });
    }

    const interactionAccess = await requireInteractionOr404({
      user: req.user,
      accountId,
      interactionId,
      message: "Interaccion comercial no encontrada",
    });
    if (!interactionAccess.ok) {
      return res
        .status(interactionAccess.response.status)
        .json(interactionAccess.response.body);
    }

    return res.json(await fetchInteractionDocuments(interactionId));
  },
);

router.post(
  "/:interactionId/documents",
  requirePermission("cuentas.update"),
  async (req, res) => {
    const accountId = Number(req.params.accountId);
    const interactionId = Number(req.params.interactionId);
    if (
      !Number.isInteger(accountId) ||
      accountId <= 0 ||
      !Number.isInteger(interactionId) ||
      interactionId <= 0
    ) {
      return res.status(400).json({ message: "Parametros invalidos" });
    }

    const interactionAccess = await requireInteractionOr404({
      user: req.user,
      accountId,
      interactionId,
      message: "Interaccion comercial no encontrada",
    });
    if (!interactionAccess.ok) {
      return res
        .status(interactionAccess.response.status)
        .json(interactionAccess.response.body);
    }

    try {
      await ensureOpportunityDocumentSchema();
      const files = await parseMultipartFiles(req);
      if (!files.length) {
        return res.status(400).json({ message: "No se recibieron archivos" });
      }

      for (const file of files) {
        const mimeType = String(file.mimetype || "")
          .trim()
          .toLowerCase();
        if (
          mimeType &&
          !config.documents.storage.allowedMimeTypes.includes(mimeType)
        ) {
          return res.status(400).json({
            message: `El tipo MIME ${mimeType} no esta permitido.`,
          });
        }
      }

      await withTransaction(async (conn) => {
        for (const file of files) {
          const buffer = await readFile(file.filepath);
          const sha256 = createHash("sha256").update(buffer).digest("hex");
          const originalFileName = String(
            file.originalFilename || file.newFilename || "archivo",
          );
          const extension = String(
            path.extname(originalFileName || "") || "",
          ).toLowerCase();
          const storageKey = buildAttachmentStorageKey({
            accountId,
            interactionId,
            fileName: originalFileName,
          });
          const stored = await storage.save({ buffer, storageKey });
          await conn.query(
            `INSERT INTO documents
             (public_id, upload_session_id, entity_type, entity_id, storage_provider,
              storage_bucket, storage_key, original_file_name, stored_file_name,
              mime_type, file_extension, byte_size, sha256, document_kind, source_label,
              processing_status, processing_error, duration_seconds, is_deleted,
              uploaded_by_user_id, created_at, updated_at)
           VALUES (?, NULL, 'account_interaction', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploaded', NULL, NULL, 0, ?, NOW(3), NOW(3))`,
            [
              buildDocumentPublicId(),
              interactionId,
              stored.storageProvider,
              stored.storageBucket,
              stored.storageKey,
              originalFileName,
              stored.storedFileName,
              String(file.mimetype || "application/octet-stream").toLowerCase(),
              extension || null,
              Number(file.size || buffer.length || 0),
              sha256,
              extension.replace(/^\./, "") || null,
              "interaction_attachment",
              Number(req.user.id),
            ],
          );
          await unlink(file.filepath).catch(() => {});
        }
      });

      await logAuditEvent({
        req,
        module: "cuentas",
        action: "account_interaction_document_uploaded",
        entityType: "account_interaction",
        entityId: interactionId,
        detail: "Documentos adjuntos a interaccion comercial",
      });

      return res
        .status(201)
        .json(await fetchInteractionDocuments(interactionId));
    } catch (error) {
      return res.status(error.status || 500).json({
        message:
          error.status && error.status < 500
            ? error.message
            : "No fue posible adjuntar documentos a la interaccion comercial",
      });
    }
  },
);

router.delete(
  "/:interactionId/documents/:documentPublicId",
  requirePermission("cuentas.update"),
  async (req, res) => {
    const accountId = Number(req.params.accountId);
    const interactionId = Number(req.params.interactionId);
    if (
      !Number.isInteger(accountId) ||
      accountId <= 0 ||
      !Number.isInteger(interactionId) ||
      interactionId <= 0
    ) {
      return res.status(400).json({ message: "Parametros invalidos" });
    }

    const interactionAccess = await requireInteractionOr404({
      user: req.user,
      accountId,
      interactionId,
      message: "Interaccion comercial no encontrada",
    });
    if (!interactionAccess.ok) {
      return res
        .status(interactionAccess.response.status)
        .json(interactionAccess.response.body);
    }

    const rows = await query(
      `SELECT id, storage_provider, storage_bucket, storage_key
     FROM documents
     WHERE public_id = ?
       AND entity_type = 'account_interaction'
       AND entity_id = ?
       AND is_deleted = 0
     LIMIT 1`,
      [req.params.documentPublicId, interactionId],
    );
    if (!rows.length) {
      return res.status(404).json({ message: "Documento no encontrado" });
    }

    await storage.delete({
      storageKey: rows[0].storage_key,
      storageBucket: rows[0].storage_bucket,
    });
    await query(
      `UPDATE documents
     SET is_deleted = 1, updated_at = NOW(3)
     WHERE id = ?`,
      [Number(rows[0].id)],
    );

    return res.json(await fetchInteractionDocuments(interactionId));
  },
);

router.get(
  "/:interactionId/documents/:documentPublicId/content",
  requireAnyPermission(accountInteractionAccessPermissions),
  async (req, res) => {
    const accountId = Number(req.params.accountId);
    const interactionId = Number(req.params.interactionId);
    if (
      !Number.isInteger(accountId) ||
      accountId <= 0 ||
      !Number.isInteger(interactionId) ||
      interactionId <= 0
    ) {
      return res.status(400).json({ message: "Parametros invalidos" });
    }

    const interactionAccess = await requireInteractionOr404({
      user: req.user,
      accountId,
      interactionId,
      message: "Interaccion comercial no encontrada",
    });
    if (!interactionAccess.ok) {
      return res
        .status(interactionAccess.response.status)
        .json(interactionAccess.response.body);
    }

    const rows = await query(
      `SELECT original_file_name, mime_type, storage_bucket, storage_key
     FROM documents
     WHERE public_id = ?
       AND entity_type = 'account_interaction'
       AND entity_id = ?
       AND is_deleted = 0
     LIMIT 1`,
      [req.params.documentPublicId, interactionId],
    );
    if (!rows.length) {
      return res.status(404).json({ message: "Documento no encontrado" });
    }

    const document = rows[0];
    const stream = await storage.openReadStream({
      storageKey: document.storage_key,
      storageBucket: document.storage_bucket,
    });
    res.setHeader(
      "Content-Type",
      document.mime_type || "application/octet-stream",
    );
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(document.original_file_name)}"`,
    );
    stream.pipe(res);
  },
);

router.post(
  "/:interactionId/create-opportunity",
  requireAnyPermission(opportunityCreatePermissions),
  async (req, res) => {
    const accountId = Number(req.params.accountId);
    const interactionId = Number(req.params.interactionId);
    if (
      !Number.isInteger(accountId) ||
      accountId <= 0 ||
      !Number.isInteger(interactionId) ||
      interactionId <= 0
    ) {
      return res.status(400).json({ message: "Parametros invalidos" });
    }

    const parsed = createOpportunityFromInteractionSchema.safeParse(
      req.body || {},
    );
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const interactionAccess = await requireInteractionOr404({
      user: req.user,
      accountId,
      interactionId,
      message: "Interaccion comercial no encontrada",
    });
    if (!interactionAccess.ok) {
      return res
        .status(interactionAccess.response.status)
        .json(interactionAccess.response.body);
    }

    const relationValidation = await validateOpportunityRelations({
      user: req.user,
      accountId,
      contactId: parsed.data.contactId,
      sellerUserId: parsed.data.sellerUserId,
      presalesUserId: parsed.data.presalesUserId,
    });
    if (!relationValidation.ok) {
      return res
        .status(relationValidation.status)
        .json({ message: relationValidation.message });
    }

    const activationStatusCode = resolveOpportunityCreationStatusCode(req.user);
    const activationStatusId = activationStatusCode
      ? await getOpportunityActivationStatusId(activationStatusCode)
      : null;
    const initialStage =
      await getOpportunitySalesStageByCode("contacto_inicial");
    const initialCommercialStatusId =
      await getOpportunityCommercialStatusId("en_proceso");
    if (
      !activationStatusId ||
      !initialStage?.id ||
      !initialCommercialStatusId
    ) {
      return res
        .status(403)
        .json({ message: "Configuracion incompleta del proceso comercial" });
    }

    const linkedDocumentPublicIds = parsed.data.documentPublicIds.length
      ? parsed.data.documentPublicIds
      : (await fetchInteractionDocuments(interactionId)).map(
          (document) => document.publicId,
        );

    const documentRows = linkedDocumentPublicIds.length
      ? await query(
          `SELECT id, public_id
         FROM documents
         WHERE entity_type = 'account_interaction'
           AND entity_id = ?
           AND is_deleted = 0
           AND public_id IN (${linkedDocumentPublicIds.map(() => "?").join(", ")})`,
          [interactionId, ...linkedDocumentPublicIds],
        )
      : [];

    if (documentRows.length !== linkedDocumentPublicIds.length) {
      return res.status(400).json({
        message:
          "Uno o mas documentos seleccionados no pertenecen a la interaccion",
      });
    }

    try {
      await ensureOpportunityDocumentSchema();
      const now = new Date();
      const opportunityId = await withTransaction(async (conn) => {
        const [insertResult] = await conn.query(
          `INSERT INTO opportunities
           (name, amount_usd, account_id, close_date, contact_id,
            sales_stage_id, business_line_id, seller_user_id, presales_user_id, activation_status_id,
            commercial_status_id, created_by, created_at, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            parsed.data.name,
            parsed.data.amountUsd,
            accountId,
            parsed.data.closeDate,
            parsed.data.contactId,
            Number(initialStage.id),
            parsed.data.businessLineId,
            parsed.data.sellerUserId,
            parsed.data.presalesUserId || null,
            activationStatusId,
            initialCommercialStatusId,
            Number(req.user.id),
            now,
            Number(req.user.id),
            now,
          ],
        );

        for (const document of documentRows) {
          await conn.query(
            `INSERT IGNORE INTO opportunity_document_links
             (opportunity_id, document_id, link_type, created_by_user_id, created_at)
           VALUES (?, ?, 'source_document', ?, NOW(3))`,
            [insertResult.insertId, Number(document.id), Number(req.user.id)],
          );
        }

        await conn.query(
          `UPDATE account_interactions
         SET linked_opportunity_id = ?, result_id = (
             SELECT id FROM account_interaction_results WHERE code = 'converted_to_opportunity' LIMIT 1
           ), updated_by = ?, updated_at = NOW(3)
         WHERE id = ?`,
          [insertResult.insertId, Number(req.user.id), interactionId],
        );

        return insertResult.insertId;
      });

      await logAuditEvent({
        req,
        module: "cuentas",
        action: "account_interaction_promoted_to_opportunity",
        entityType: "account_interaction",
        entityId: interactionId,
        detail: "Interaccion comercial promovida a oportunidad",
        after: { opportunity_id: opportunityId },
      });

      return res.status(201).json({
        message: "Oportunidad creada desde la interaccion comercial",
        opportunityId,
        interaction: await fetchInteractionDetail(interactionId),
      });
    } catch (error) {
      return res.status(error.status || 500).json({
        message:
          error.status && error.status < 500
            ? error.message
            : "No fue posible crear la oportunidad desde la interaccion comercial",
      });
    }
  },
);

export default router;
