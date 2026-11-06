import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { query, withTransaction } from "./db.js";
import { requireAnyPermission } from "./auth.js";
import { logAuditEvent } from "./audit.js";
import { config } from "./config.js";
import { cleanupTempFiles, getDocumentContentStream, parseMultipartFiles } from "./opportunity-documents/service.js";
import { createDocumentStorage } from "./opportunity-documents/storage.js";

let schemaPromise;

export async function ensureProviderInvoicesSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await query(`CREATE TABLE IF NOT EXISTS provider_invoice_lock (
        id TINYINT UNSIGNED PRIMARY KEY
      ) ENGINE=InnoDB`);
      await query("INSERT IGNORE INTO provider_invoice_lock (id) VALUES (1)");
      await query(`CREATE TABLE IF NOT EXISTS provider_invoices (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        document_type VARCHAR(20) NOT NULL,
        invoice_number VARCHAR(120) NULL,
        invoice_number_normalized VARCHAR(120) COLLATE utf8mb4_bin NULL,
        invoice_date DATE NOT NULL,
        provider_id BIGINT UNSIGNED NOT NULL,
        provider_name VARCHAR(190) NOT NULL,
        currency_code VARCHAR(3) NOT NULL,
        exchange_rate DECIMAL(20,8) NOT NULL,
        exchange_rate_source VARCHAR(20) NOT NULL,
        exchange_rate_date DATE NULL,
        subtotal DECIMAL(20,2) NOT NULL,
        iva_amount DECIMAL(20,2) NOT NULL,
        total_amount DECIMAL(20,2) NOT NULL,
        total_usd DECIMAL(20,2) NOT NULL,
        orders_json LONGTEXT NOT NULL,
        created_by_user_id BIGINT UNSIGNED NOT NULL,
        converted_at DATETIME(3) NULL,
        converted_by_user_id BIGINT UNSIGNED NULL,
        created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        UNIQUE KEY uq_provider_invoice_number (provider_id, invoice_number_normalized),
        CONSTRAINT fk_pi_user FOREIGN KEY (created_by_user_id) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await query(`CREATE TABLE IF NOT EXISTS provider_invoice_items (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        invoice_id BIGINT UNSIGNED NOT NULL,
        purchase_order_id BIGINT UNSIGNED NOT NULL,
        purchase_order_item_id BIGINT UNSIGNED NOT NULL,
        quantity DECIMAL(18,6) NOT NULL,
        UNIQUE KEY uq_pii_item (invoice_id, purchase_order_item_id),
        KEY idx_pii_order (purchase_order_id),
        CONSTRAINT fk_pii_invoice FOREIGN KEY (invoice_id) REFERENCES provider_invoices(id) ON DELETE CASCADE,
        CONSTRAINT fk_pii_order FOREIGN KEY (purchase_order_id) REFERENCES quotation_processing_purchase_orders(id) ON DELETE RESTRICT,
        CONSTRAINT fk_pii_item FOREIGN KEY (purchase_order_item_id) REFERENCES quotation_processing_purchase_order_items(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB`);
    })().catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }
  return schemaPromise;
}

export async function lockProviderInvoices(conn) {
  await conn.query("SELECT id FROM provider_invoice_lock WHERE id = 1 FOR UPDATE");
}

export async function assertPurchaseOrderHasNoProviderInvoices(conn, orderId) {
  const [rows] = await conn.query(
    "SELECT id FROM provider_invoice_items WHERE purchase_order_id = ? LIMIT 1", [orderId],
  );
  if (rows.length) throw failure(409, "La orden tiene facturas o prefacturas de proveedor y no puede modificarse ni eliminarse");
}

function failure(status, message) {
  return Object.assign(new Error(message), { status });
}

function validDate(value) {
  if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const dateSchema = z.string().refine(validDate);
const idSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const quantitySchema = z.number().positive().max(999999999999)
  .refine((value) => Number(value.toFixed(6)) === value);
const metadataSchema = z.object({
  invoiceNumber: z.string().trim().max(120).optional().nullable(),
  invoiceDate: dateSchema,
  exchangeRate: z.number().positive().min(0.00000001).max(999999999999)
    .refine((value) => Number(value.toFixed(8)) === value).optional(),
  exchangeRateSource: z.enum(["manual", "suggested"]).optional(),
  exchangeRateDate: dateSchema.optional().nullable(),
});
const createSchema = metadataSchema.extend({
  documentType: z.enum(["invoice", "preinvoice"]).default("invoice"),
  orderItems: z.array(z.object({
    orderId: idSchema,
    items: z.array(z.object({ itemId: idSchema, quantity: quantitySchema })).min(1).max(1000),
  })).min(1).max(500),
});

const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const roundQuantity = (value) => Number(value.toFixed(6));
const dateOnly = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : value || null;

function rateFields(currencyCode, input, stored = {}) {
  const exchangeRate = input.exchangeRate ?? stored.exchangeRate ?? (currencyCode === "USD" ? 1 : null);
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0 ||
      (currencyCode === "USD" && exchangeRate !== 1)) {
    throw failure(400, "Se requiere un tipo de cambio positivo (unidades de moneda original por USD); para USD debe ser 1");
  }
  const exchangeRateSource = input.exchangeRateSource ??
    (input.exchangeRate != null ? "manual" : stored.exchangeRateSource || "manual");
  const exchangeRateDate = exchangeRateSource === "suggested"
    ? input.exchangeRateDate ?? (input.exchangeRate == null ? stored.exchangeRateDate : null) ?? null
    : null;
  return { exchangeRate, exchangeRateSource, exchangeRateDate };
}

function numberFields(documentType, invoiceNumber) {
  const number = invoiceNumber?.trim() || null;
  if (documentType === "invoice" && !number) throw failure(400, "El numero de factura del proveedor es obligatorio");
  if (documentType === "preinvoice" && number) throw failure(400, "El numero de factura se captura al convertir la prefactura");
  return { invoiceNumber: number, normalizedNumber: number?.toLocaleLowerCase("en-US") || null };
}

function moneyLimit(values) {
  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 9e12)) {
    throw failure(400, "El importe del documento excede el limite permitido");
  }
}

const orderSelect = `SELECT po.*, a.id AS account_id, a.name AS account_name,
  o.name AS opportunity_name
  FROM quotation_processing_purchase_orders po
  INNER JOIN opportunities o ON o.id = po.opportunity_id
  INNER JOIN accounts a ON a.id = o.account_id`;

function orderHeader(row) {
  return {
    orderId: Number(row.id), quotationId: Number(row.quotation_id),
    orderNumber: row.order_number || null, orderDate: dateOnly(row.order_date),
    providerId: Number(row.provider_id), providerName: row.provider_name || "Proveedor",
    accountId: Number(row.account_id), accountName: row.account_name || "",
    opportunityId: Number(row.opportunity_id), opportunityName: row.opportunity_name || "",
    currencyCode: String(row.currency_code || "").trim().toUpperCase(), ivaPct: Number(row.iva_pct),
  };
}

function lineHeader(row) {
  return {
    itemId: Number(row.id), productId: row.product_id ? Number(row.product_id) : null,
    code: row.line_code || "-", description: row.line_description || "",
    quantity: Number(row.quantity), unitCost: Number(row.unit_cost),
    discountPct: Number(row.discount_pct), amount: Number(row.amount),
  };
}

function documentPayload(row) {
  return {
    id: String(row.id), documentType: row.document_type, invoiceNumber: row.invoice_number,
    invoiceDate: dateOnly(row.invoice_date), providerId: Number(row.provider_id),
    providerName: row.provider_name, currencyCode: row.currency_code,
    exchangeRate: Number(row.exchange_rate), exchangeRateSource: row.exchange_rate_source,
    exchangeRateDate: dateOnly(row.exchange_rate_date),
    subtotal: Number(row.subtotal), ivaAmount: Number(row.iva_amount),
    totalAmount: Number(row.total_amount), totalUsd: Number(row.total_usd),
    orders: typeof row.orders_json === "string" ? JSON.parse(row.orders_json) : row.orders_json,
    createdByUserId: Number(row.created_by_user_id), createdAt: row.created_at,
    convertedAt: row.converted_at || null,
    convertedByUserId: row.converted_by_user_id ? Number(row.converted_by_user_id) : null,
    attachments: [],
  };
}

function attachmentPayload(row) {
  return {
    id: row.public_id, documentId: Number(row.id), fileName: row.original_file_name,
    mimeType: row.mime_type, byteSize: Number(row.byte_size), uploadedAt: row.created_at,
    downloadUrl: `/api/provider-invoices/${row.entity_id}/attachments/${row.public_id}/content`,
  };
}

async function invoiceAttachments(ids, execute = query) {
  if (!ids.length) return [];
  return execute(`SELECT id, public_id, entity_id, original_file_name, mime_type, byte_size, created_at
    FROM documents WHERE entity_type = 'provider_invoice' AND is_deleted = 0
    AND entity_id IN (${ids.map(() => "?").join(",")}) ORDER BY created_at, id`, ids);
}

const documentSelect = `SELECT pi.*,
  DATE_FORMAT(pi.invoice_date, '%Y-%m-%d') AS invoice_date,
  DATE_FORMAT(pi.exchange_rate_date, '%Y-%m-%d') AS exchange_rate_date
  FROM provider_invoices pi`;

function documentScope(user, hasAdministration, params) {
  if (hasAdministration(user)) return "";
  params.push(Number(user.id));
  // A grouped document is visible only when every underlying account is accessible.
  return ` AND NOT EXISTS (
    SELECT 1 FROM provider_invoice_items scope_item
    INNER JOIN quotation_processing_purchase_orders scope_po ON scope_po.id = scope_item.purchase_order_id
    INNER JOIN opportunities scope_o ON scope_o.id = scope_po.opportunity_id
    WHERE scope_item.invoice_id = pi.id AND NOT EXISTS (
      SELECT 1 FROM account_owners scope_owner
      WHERE scope_owner.account_id = scope_o.account_id AND scope_owner.user_id = ?
    )
  )`;
}

async function snapshotOrders(conn, user, orderItems, hasAdministration) {
  const ids = orderItems.map((entry) => entry.orderId);
  if (new Set(ids).size !== ids.length) throw failure(400, "Orden de compra duplicada");
  const params = [...ids];
  let scope = "";
  if (!hasAdministration(user)) {
    scope = " AND EXISTS (SELECT 1 FROM account_owners ao WHERE ao.account_id = a.id AND ao.user_id = ?)";
    params.push(Number(user.id));
  }
  const [rows] = await conn.query(
    `${orderSelect} WHERE po.id IN (${ids.map(() => "?").join(",")})${scope} ORDER BY po.id FOR UPDATE`, params,
  );
  if (rows.length !== ids.length) throw failure(404, "Orden de compra no encontrada");
  const headers = rows.map(orderHeader);
  if (new Set(headers.map((row) => row.providerId)).size !== 1 ||
      new Set(headers.map((row) => row.currencyCode)).size !== 1) {
    throw failure(400, "Las ordenes deben pertenecer al mismo proveedor y moneda");
  }
  if (!/^[A-Z]{3}$/.test(headers[0].currencyCode)) throw failure(400, "Moneda de orden invalida");
  const [lines] = await conn.query(
    `SELECT * FROM quotation_processing_purchase_order_items
     WHERE purchase_order_id IN (${ids.map(() => "?").join(",")}) ORDER BY id FOR UPDATE`, ids,
  );
  const [used] = await conn.query(
    `SELECT purchase_order_item_id, SUM(quantity) AS used_quantity FROM provider_invoice_items
     WHERE purchase_order_id IN (${ids.map(() => "?").join(",")}) GROUP BY purchase_order_item_id`, ids,
  );
  const usedById = new Map(used.map((row) => [Number(row.purchase_order_item_id), Number(row.used_quantity)]));
  const linesById = new Map(lines.map((row) => [Number(row.id), row]));
  const selectedIds = new Set();
  return headers.map((header) => {
    const entry = orderItems.find((item) => item.orderId === header.orderId);
    const snapshotLines = entry.items.map((selected) => {
      const line = linesById.get(selected.itemId);
      if (!line || Number(line.purchase_order_id) !== header.orderId || selectedIds.has(selected.itemId)) {
        throw failure(400, "Item de orden invalido o duplicado");
      }
      selectedIds.add(selected.itemId);
      const saved = lineHeader(line);
      const usedQuantity = usedById.get(selected.itemId) || 0;
      if (!Number.isFinite(saved.quantity) || !Number.isFinite(usedQuantity) ||
          selected.quantity > roundQuantity(saved.quantity - usedQuantity)) {
        throw failure(409, "La cantidad solicitada excede el disponible de la orden");
      }
      if (!Number.isFinite(saved.unitCost) || saved.unitCost < 0 ||
          !Number.isFinite(saved.discountPct) || saved.discountPct < 0 || saved.discountPct > 100) {
        throw failure(409, "Costo de la orden invalido");
      }
      const amount = roundMoney(selected.quantity * saved.unitCost * (1 - saved.discountPct / 100));
      moneyLimit([amount]);
      return { ...saved, purchasedQuantity: saved.quantity, quantity: selected.quantity, amount };
    });
    if (!Number.isFinite(header.ivaPct) || header.ivaPct < 0 || header.ivaPct > 100) throw failure(409, "IVA de la orden invalido");
    const subtotal = roundMoney(snapshotLines.reduce((sum, line) => sum + line.amount, 0));
    const ivaAmount = roundMoney(subtotal * header.ivaPct / 100);
    return { ...header, lines: snapshotLines, subtotal, ivaAmount, totalAmount: roundMoney(subtotal + ivaAmount) };
  });
}

function handleError(res, error) {
  if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ message: "El numero de factura ya existe para este proveedor" });
  if (error.status) return res.status(error.status).json({ message: error.message });
  console.error("provider-invoices", error);
  return res.status(500).json({ message: "No fue posible procesar la factura de proveedor" });
}

export function registerProviderInvoiceRoutes(router, { permissionCodes, hasAdministration, hasUpdatePermission, ensureProcessingSchema }) {
  const permission = requireAnyPermission(permissionCodes);
  const canUpdate = (user) => hasUpdatePermission(user);
  const writable = (req, res, next) => canUpdate(req.user)
    ? next() : res.status(403).json({ message: "No autorizado para modificar facturas de proveedor" });
  const withCapabilities = (document, user) => ({
    ...document, canUpdate: canUpdate(user),
    canConvert: document.documentType === "preinvoice" && canUpdate(user) &&
      (hasAdministration(user) || document.createdByUserId === Number(user.id)),
  });
  const ensure = async () => {
    await ensureProcessingSchema();
    await ensureProviderInvoicesSchema();
  };
  router.get("/provider-invoices/orders", permission, async (req, res) => {
    try {
      await ensure();
      const params = [];
      let scope = "";
      if (!hasAdministration(req.user)) {
        scope = " WHERE EXISTS (SELECT 1 FROM account_owners ao WHERE ao.account_id = a.id AND ao.user_id = ?)";
        params.push(Number(req.user.id));
      }
      const orders = await query(`${orderSelect}${scope} ORDER BY po.created_at DESC, po.id DESC`, params);
      if (!orders.length) return res.json([]);
      const ids = orders.map((row) => Number(row.id));
      const lines = await query(`SELECT poi.*,
        COALESCE(used.invoiced_quantity, 0) AS invoiced_quantity,
        COALESCE(used.reserved_quantity, 0) AS reserved_quantity
        FROM quotation_processing_purchase_order_items poi
        LEFT JOIN (
          SELECT pii.purchase_order_item_id,
            SUM(CASE WHEN pi.document_type = 'invoice' THEN pii.quantity ELSE 0 END) AS invoiced_quantity,
            SUM(CASE WHEN pi.document_type = 'preinvoice' THEN pii.quantity ELSE 0 END) AS reserved_quantity
          FROM provider_invoice_items pii INNER JOIN provider_invoices pi ON pi.id = pii.invoice_id
          GROUP BY pii.purchase_order_item_id
        ) used ON used.purchase_order_item_id = poi.id
        WHERE poi.purchase_order_id IN (${ids.map(() => "?").join(",")})
        ORDER BY poi.purchase_order_id, poi.id`, ids);
      const linesByOrder = new Map();
      for (const row of lines) {
        const line = lineHeader(row);
        const invoicedQuantity = Number(row.invoiced_quantity);
        const reservedQuantity = Number(row.reserved_quantity);
        const orderLines = linesByOrder.get(Number(row.purchase_order_id)) || [];
        orderLines.push({ ...line, purchasedQuantity: line.quantity, invoicedQuantity, reservedQuantity,
          availableQuantity: Math.max(0, roundQuantity(line.quantity - invoicedQuantity - reservedQuantity)) });
        linesByOrder.set(Number(row.purchase_order_id), orderLines);
      }
      return res.json(orders.map((row) => ({
        ...orderHeader(row), lines: linesByOrder.get(Number(row.id)) || [], canUpdate: canUpdate(req.user),
      })));
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.get("/provider-invoices", permission, async (req, res) => {
    try {
      await ensure();
      const params = [];
      const scope = documentScope(req.user, hasAdministration, params);
      const rows = await query(`${documentSelect} WHERE 1=1${scope} ORDER BY pi.created_at DESC, pi.id DESC`, params);
      const attachments = await invoiceAttachments(rows.map((row) => Number(row.id)));
      return res.json(rows.map((row) => withCapabilities({
        ...documentPayload(row),
        attachments: attachments.filter((attachment) => Number(attachment.entity_id) === Number(row.id)).map(attachmentPayload),
      }, req.user)));
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.post("/provider-invoices", permission, writable, async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Datos de factura invalidos", errors: parsed.error.flatten() });
    try {
      const input = parsed.data;
      const { invoiceNumber, normalizedNumber } = numberFields(input.documentType, input.invoiceNumber);
      await ensure();
      const document = await withTransaction(async (conn) => {
        await lockProviderInvoices(conn);
        const orders = await snapshotOrders(conn, req.user, input.orderItems, hasAdministration);
        const { providerId, providerName, currencyCode } = orders[0];
        const rate = rateFields(currencyCode, input);
        const subtotal = roundMoney(orders.reduce((sum, order) => sum + order.subtotal, 0));
        const ivaAmount = roundMoney(orders.reduce((sum, order) => sum + order.ivaAmount, 0));
        const totalAmount = roundMoney(subtotal + ivaAmount);
        const totalUsd = roundMoney(totalAmount / rate.exchangeRate);
        moneyLimit([subtotal, ivaAmount, totalAmount, totalUsd]);
        const [result] = await conn.query(`INSERT INTO provider_invoices
          (document_type, invoice_number, invoice_number_normalized, invoice_date, provider_id, provider_name,
           currency_code, exchange_rate, exchange_rate_source, exchange_rate_date,
           subtotal, iva_amount, total_amount, total_usd, orders_json, created_by_user_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [input.documentType, invoiceNumber, normalizedNumber, input.invoiceDate, providerId, providerName,
          currencyCode, rate.exchangeRate, rate.exchangeRateSource, rate.exchangeRateDate,
          subtotal, ivaAmount, totalAmount, totalUsd, JSON.stringify(orders), Number(req.user.id)]);
        for (const order of orders) {
          for (const line of order.lines) {
            await conn.query(`INSERT INTO provider_invoice_items
              (invoice_id, purchase_order_id, purchase_order_item_id, quantity) VALUES (?, ?, ?, ?)`,
            [result.insertId, order.orderId, line.itemId, line.quantity]);
          }
        }
        const [rows] = await conn.query(`${documentSelect} WHERE pi.id = ?`, [result.insertId]);
        const document = documentPayload(rows[0]);
        await logAuditEvent({
          req, module: "cotizaciones", action: "provider_invoice_created",
          entityType: "provider_invoice", entityId: document.id,
          after: document, connection: conn, required: true,
        });
        return document;
      });
      return res.status(201).json(withCapabilities(document, req.user));
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.post("/provider-invoices/:id/convert", permission, writable, async (req, res) => {
    const parsed = metadataSchema.safeParse(req.body);
    const id = Number(req.params.id);
    if (!parsed.success || !Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ message: "Datos de conversion invalidos" });
    try {
      const input = parsed.data;
      const { invoiceNumber, normalizedNumber } = numberFields("invoice", input.invoiceNumber);
      await ensure();
      const document = await withTransaction(async (conn) => {
        await lockProviderInvoices(conn);
        const params = [id];
        const scope = documentScope(req.user, hasAdministration, params);
        const [rows] = await conn.query(`${documentSelect} WHERE pi.id = ?${scope} FOR UPDATE`, params);
        if (!rows.length) throw failure(404, "Prefactura no encontrada");
        const before = documentPayload(rows[0]);
        if (!hasAdministration(req.user) && before.createdByUserId !== Number(req.user.id)) {
          throw failure(403, "Solo el creador o un administrador puede convertir la prefactura");
        }
        if (before.documentType !== "preinvoice") throw failure(409, "El documento ya es una factura");
        const rate = rateFields(before.currencyCode, input, before);
        const totalUsd = roundMoney(before.totalAmount / rate.exchangeRate);
        moneyLimit([totalUsd]);
        await conn.query(`UPDATE provider_invoices
          SET document_type = 'invoice', invoice_number = ?, invoice_number_normalized = ?, invoice_date = ?,
              exchange_rate = ?, exchange_rate_source = ?, exchange_rate_date = ?, total_usd = ?,
              converted_at = NOW(3), converted_by_user_id = ? WHERE id = ?`,
        [invoiceNumber, normalizedNumber, input.invoiceDate, rate.exchangeRate, rate.exchangeRateSource,
          rate.exchangeRateDate, totalUsd, Number(req.user.id), id]);
        const [updated] = await conn.query(`${documentSelect} WHERE pi.id = ?`, [id]);
        const document = documentPayload(updated[0]);
        const attachments = await invoiceAttachments([id], async (...args) => (await conn.query(...args))[0]);
        document.attachments = attachments.map(attachmentPayload);
        await logAuditEvent({
          req, module: "cotizaciones", action: "provider_invoice_converted",
          entityType: "provider_invoice", entityId: id, before, after: document, connection: conn, required: true,
        });
        return document;
      });
      return res.json(withCapabilities(document, req.user));
    } catch (error) {
      return handleError(res, error);
    }
  });

  const accessibleDocument = async (id, user, execute = query) => {
    if (!Number.isSafeInteger(id) || id <= 0) throw failure(400, "ID de factura invalido");
    const params = [id];
    const scope = documentScope(user, hasAdministration, params);
    const rows = await execute(`${documentSelect} WHERE pi.id = ?${scope}`, params);
    if (!rows.length) throw failure(404, "Factura no encontrada");
    return rows[0];
  };

  router.get("/provider-invoices/:id/attachments", permission, async (req, res) => {
    try {
      await ensure();
      const id = Number(req.params.id);
      await accessibleDocument(id, req.user);
      return res.json((await invoiceAttachments([id])).map(attachmentPayload));
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.post("/provider-invoices/:id/attachments", permission, writable, async (req, res) => {
    let files = [];
    const storedFiles = [];
    const storage = createDocumentStorage();
    try {
      await ensure();
      const id = Number(req.params.id);
      await accessibleDocument(id, req.user);
      ({ files } = await parseMultipartFiles(req));
      if (!files.length) throw failure(400, "Selecciona al menos un archivo");
      const allowedTypes = new Set(config.documents.storage.allowedMimeTypes);
      if (files.some((file) => !allowedTypes.has(file.mimetype))) throw failure(400, "Tipo de archivo no permitido");
      const attachments = await withTransaction(async (conn) => {
        await lockProviderInvoices(conn);
        await accessibleDocument(id, req.user, async (...args) => (await conn.query(...args))[0]);
        const attachments = [];
        for (const file of files) {
          const fileName = String(file.originalFilename || "documento").trim().slice(0, 255);
          const publicId = `doc_${randomUUID().replace(/-/g, "")}`;
          const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "documento";
          const buffer = await readFile(file.filepath);
          const stored = await storage.save({
            buffer, storageKey: path.posix.join("provider_invoices", String(id), `${publicId}__${safeName}`),
          });
          storedFiles.push(stored);
          const [result] = await conn.query(`INSERT INTO documents
            (public_id, upload_session_id, entity_type, entity_id, storage_provider, storage_bucket,
             storage_key, original_file_name, stored_file_name, mime_type, file_extension, byte_size,
             sha256, document_kind, source_label, processing_status, is_deleted, uploaded_by_user_id)
            VALUES (?, NULL, 'provider_invoice', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              'provider_invoice_attachment', 'Factura de proveedor', 'uploaded', 0, ?)`,
          [publicId, id, stored.storageProvider, stored.storageBucket, stored.storageKey, fileName,
            stored.storedFileName, file.mimetype, path.extname(fileName).slice(1) || null, buffer.length,
            createHash("sha256").update(buffer).digest("hex"), Number(req.user.id)]);
          attachments.push(attachmentPayload({
            id: result.insertId, public_id: publicId, entity_id: id, original_file_name: fileName,
            mime_type: file.mimetype, byte_size: buffer.length, created_at: new Date().toISOString(),
          }));
        }
        await logAuditEvent({
          req, module: "cotizaciones", action: "provider_invoice_attachments_uploaded",
          entityType: "provider_invoice", entityId: id, after: { attachments },
          connection: conn, required: true,
        });
        return attachments;
      });
      return res.status(201).json({ attachments });
    } catch (error) {
      await Promise.all(storedFiles.map((stored) => storage.delete(stored).catch(() => undefined)));
      return handleError(res, error);
    } finally {
      await cleanupTempFiles(files);
    }
  });

  router.get("/provider-invoices/:id/attachments/:documentId/content", permission, async (req, res) => {
    try {
      await ensure();
      const id = Number(req.params.id);
      await accessibleDocument(id, req.user);
      const attachments = await invoiceAttachments([id]);
      const attachment = attachments.find((row) => row.public_id === req.params.documentId);
      if (!attachment) throw failure(404, "Documento no encontrado");
      const { stream } = await getDocumentContentStream({ documentPublicId: attachment.public_id });
      res.attachment(attachment.original_file_name);
      res.setHeader("Content-Type", attachment.mime_type || "application/octet-stream");
      res.setHeader("X-Content-Type-Options", "nosniff");
      stream.on("error", (error) => {
        if (res.headersSent) res.destroy(error);
        else handleError(res, error);
      });
      stream.pipe(res);
    } catch (error) {
      return handleError(res, error);
    }
  });
}
