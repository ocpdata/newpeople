import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { readFile } from "node:fs/promises";
import express from "express";
import { z } from "zod";
import { query, withTransaction } from "./db.js";
import { requireAnyPermission } from "./auth.js";
import { ensureCampaignEmailDispatchSchema } from "./campaign-emails/schema.js";
import {
  parseMultipartFiles,
  cleanupTempFiles,
} from "./opportunity-documents/service.js";
import { createDocumentStorage } from "./opportunity-documents/storage.js";
import { listCommercialEnablementAssets } from "./commercial-enablement/library-service.js";
import {
  GOOGLE_GMAIL_SEND_SCOPE,
  decryptOpaqueSecret,
  exchangeGoogleRefreshToken,
  hasGoogleMailSendScope,
  sendGoogleMailMessage,
} from "./utils.js";

const router = express.Router();
export const publicRouter = express.Router();
const documentStorage = createDocumentStorage();

const CAMPAIGN_EMAIL_SEND_PERMISSIONS = [
  "campanas.read",
  "campanas.create",
  "campanas.update",
];
const SHARED_DOCUMENT_SOURCE_LOCAL = "local_upload";
const SHARED_DOCUMENT_SOURCE_LIBRARY = "library_file";
const SHARED_LINK_MODE_GENERAL = "general";
const SHARED_LINK_MODE_PER_RECIPIENT = "per_recipient";

const FIXED_BATCH_SIZE = 50;
const FIXED_MAX_SENDS_PER_HOUR = 50;
const FIXED_MAX_SENDS_PER_DAY = 300;
const RECIPIENT_LEASE_SECONDS = 300;
const RECIPIENT_RETRY_DELAY_MINUTES = 15;
const MAX_RECIPIENT_ATTEMPTS = 3;
const WORKER_POLL_INTERVAL_MS = 30_000;

let campaignEmailWorkerStarted = false;
let campaignEmailWorkerTimer = null;
let campaignEmailWorkerRunning = false;

function hasCampaignEmailAdminAccess(user) {
  return (Array.isArray(user?.roles) ? user.roles : []).some(
    (role) => Boolean(role?.is_system) || String(role?.name || "") === "Administrador",
  );
}

const campaignRecipientSchema = z.object({
  email: z.string().trim().email().max(190),
  contactId: z.number().int().positive().optional().nullable(),
  accountId: z.number().int().positive().optional().nullable(),
  contactName: z.string().trim().max(190).optional().nullable(),
  accountName: z.string().trim().max(190).optional().nullable(),
});

const sharedDocumentSendSchema = z.object({
  publicId: z.string().trim().min(4).max(64),
  linkMode: z
    .enum([SHARED_LINK_MODE_GENERAL, SHARED_LINK_MODE_PER_RECIPIENT])
    .optional()
    .default(SHARED_LINK_MODE_PER_RECIPIENT),
  expiresDays: z.number().int().min(1).max(365).optional().default(30),
  useAsPrimaryCta: z.boolean().optional().default(true),
  linkLabel: z.string().trim().max(190).optional().nullable(),
});

const testSendSchema = z.object({
  recipients: z
    .array(z.union([z.string().trim().max(190), campaignRecipientSchema]))
    .max(100)
    .optional(),
  recipientsText: z.string().trim().max(4000).optional(),
  subject: z.string().trim().max(220).min(1),
  preheader: z.string().trim().max(300).optional().nullable(),
  htmlContent: z.string().trim().max(2_000_000).min(1),
  ctaLabel: z.string().trim().max(190).optional().nullable(),
  ctaUrl: z.string().trim().max(2000).optional().nullable(),
  sharedDocument: sharedDocumentSendSchema.optional().nullable(),
});

const campaignSendSchema = z.object({
  campaignId: z.number().int().positive().optional(),
  recipients: z
    .array(z.union([z.string().trim().max(190), campaignRecipientSchema]))
    .min(1)
    .max(5000),
  subject: z.string().trim().max(220).min(1),
  preheader: z.string().trim().max(300).optional().nullable(),
  htmlContent: z.string().trim().max(2_000_000).min(1),
  ctaLabel: z.string().trim().max(190).optional().nullable(),
  ctaUrl: z.string().trim().max(2000).optional().nullable(),
  sharedDocument: sharedDocumentSendSchema.optional().nullable(),
  batchSize: z.number().int().positive().max(5000).optional(),
  maxSendsPerHour: z.number().int().positive().max(5000).optional(),
  maxSendsPerDay: z.number().int().positive().max(50000).optional(),
});

const sharedDocumentUploadFieldsSchema = z.object({
  campaignId: z.coerce.number().int().positive().optional(),
  title: z.string().trim().min(1).max(190),
  description: z.string().trim().max(5000).optional().nullable(),
});

const sharedDocumentLibrarySchema = z.object({
  campaignId: z.number().int().positive().optional(),
  assetPublicId: z.string().trim().min(4).max(64),
  filePublicId: z.string().trim().min(4).max(64),
  title: z.string().trim().min(1).max(190),
  description: z.string().trim().max(5000).optional().nullable(),
});

const sharedDocumentPreviewSchema = z.object({
  expiresDays: z.number().int().min(1).max(365).optional().default(30),
});

const emailSchema = z.string().trim().email().max(190);

function normalizeRecipientList({ recipients, recipientsText }) {
  const fromArray = Array.isArray(recipients) ? recipients : [];
  const fromText = String(recipientsText || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const merged = [...fromArray, ...fromText].map((entry) => {
    if (typeof entry === "string") {
      return {
        email: String(entry || "")
          .trim()
          .toLowerCase(),
      };
    }

    return {
      email: String(entry?.email || "")
        .trim()
        .toLowerCase(),
      contactId: entry?.contactId ? Number(entry.contactId) : null,
      accountId: entry?.accountId ? Number(entry.accountId) : null,
      contactName: String(entry?.contactName || "").trim() || null,
      accountName: String(entry?.accountName || "").trim() || null,
    };
  });

  const deduped = new Map();
  merged.forEach((entry) => {
    if (!entry?.email) return;
    if (!deduped.has(entry.email)) {
      deduped.set(entry.email, entry);
    }
  });

  return Array.from(deduped.values());
}

async function findUserGoogleMailConnection(userId) {
  const rows = await query(
    `SELECT id, google_email, refresh_token_encrypted, scope_text, revoked_at
       FROM user_google_mail_connections
      WHERE user_id = ?
        AND revoked_at IS NULL
      LIMIT 1`,
    [Number(userId)],
  );

  return rows[0] || null;
}

function buildHtmlWithPreheader({ preheader, htmlContent }) {
  const normalizedPreheader = String(preheader || "").trim();
  const normalizedHtml = String(htmlContent || "").trim();
  // Legacy compatibility: ignore preheader even if old clients still send it.
  void normalizedPreheader;
  return normalizedHtml;
}

function buildSharedDocumentPublicId() {
  return `cmdoc_${randomUUID().replace(/-/g, "")}`;
}

function buildShareLinkPublicId() {
  return `cmshare_${randomUUID().replace(/-/g, "")}`;
}

function buildCampaignEmailShareToken() {
  return `${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "")}`;
}

function buildCampaignEmailShareTokenHash(token) {
  return createHash("sha256")
    .update(String(token || ""))
    .digest("hex");
}

function buildCampaignEmailShareUrl(req, token) {
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  return `${baseUrl}/api/public/campaign-email-shares/${encodeURIComponent(token)}/download`;
}

function buildHtmlWithPrimaryCta({ htmlContent, ctaUrl, ctaLabel }) {
  const normalizedHtml = String(htmlContent || "").trim();
  if (!normalizedHtml) return normalizedHtml;

  const safeUrl = String(ctaUrl || "").trim();
  const safeLabel = String(ctaLabel || "").trim();
  if (!safeUrl && !safeLabel) {
    return normalizedHtml;
  }

  return normalizedHtml.replace(
    /<a\b([^>]*)href=["'][^"']*["']([^>]*)>([\s\S]*?)<\/a>/i,
    (_match, beforeHref, afterHref, innerHtml) => {
      const nextHref = safeUrl || "#";
      const nextLabel =
        safeLabel || String(innerHtml || "").trim() || "Ir a la acción";
      return `<a${beforeHref}href="${nextHref.replace(/"/g, "&quot;")}"${afterHref}>${nextLabel}</a>`;
    },
  );
}

function classifyRecipients(rawRecipients = []) {
  const normalized = normalizeRecipientList({ recipients: rawRecipients });

  const validationResults = normalized.map((recipient) => ({
    recipient,
    email: String(recipient?.email || "")
      .trim()
      .toLowerCase(),
    isValid: emailSchema.safeParse(String(recipient?.email || "").trim())
      .success,
  }));

  return {
    validRecipients: validationResults
      .filter((item) => item.isValid)
      .map((item) => ({
        ...item.recipient,
        email: item.email,
      })),
    invalidRecipients: validationResults
      .filter((item) => !item.isValid)
      .map((item) => item.email),
  };
}

async function resolveGoogleAccessTokenForUser(userId) {
  const googleConnection = await findUserGoogleMailConnection(userId);
  if (!googleConnection) {
    const error = new Error(
      "Debes conectar tu cuenta de Google antes de enviar correos",
    );
    error.status = 409;
    error.reason = "google_reconnect_required";
    throw error;
  }

  if (!hasGoogleMailSendScope(googleConnection.scope_text || "")) {
    const error = new Error(
      "Tu conexión de Google no incluye permisos para enviar correo",
    );
    error.status = 409;
    error.reason = "google_scope_missing";
    error.requiredScope = GOOGLE_GMAIL_SEND_SCOPE;
    throw error;
  }

  try {
    const refreshToken = decryptOpaqueSecret(
      googleConnection.refresh_token_encrypted,
    );
    const tokenPayload = await exchangeGoogleRefreshToken(refreshToken);
    const accessToken = String(tokenPayload?.access_token || "").trim();
    if (!accessToken) {
      throw new Error("No fue posible renovar token de Google");
    }

    return {
      accessToken,
      fromEmail: String(googleConnection.google_email || "").trim(),
    };
  } catch (error) {
    const errorCode = String(error?.code || "google_send_failed").toLowerCase();
    if (
      errorCode === "invalid_grant" ||
      errorCode === "invalid_token" ||
      errorCode === "unauthenticated"
    ) {
      const tokenError = new Error(
        "La conexión con Google expiró o fue revocada. Reconecta tu cuenta para continuar",
      );
      tokenError.status = 409;
      tokenError.reason = "google_reconnect_required";
      throw tokenError;
    }

    if (errorCode === "insufficient_scope") {
      const tokenError = new Error(
        "Tu conexión con Google no tiene permisos suficientes para enviar correo",
      );
      tokenError.status = 409;
      tokenError.reason = "google_scope_missing";
      tokenError.requiredScope = GOOGLE_GMAIL_SEND_SCOPE;
      throw tokenError;
    }

    const tokenError = new Error(
      String(error?.detail || error?.message || "") ||
        "No fue posible preparar el envío con Google",
    );
    tokenError.status = 502;
    tokenError.reason = "google_send_failed";
    throw tokenError;
  }
}

async function resolveSharedDocumentForSendConfig(config, userId) {
  if (!config?.publicId) return null;
  const sharedDocumentRow = await getSharedDocumentByPublicId(
    config.publicId,
    userId,
  );
  if (!sharedDocumentRow) {
    const error = new Error("Documento compartido no encontrado");
    error.status = 404;
    throw error;
  }

  return {
    id: Number(sharedDocumentRow.id),
    publicId: String(sharedDocumentRow.public_id || "").trim(),
    linkMode:
      String(config.linkMode || SHARED_LINK_MODE_PER_RECIPIENT).trim() ||
      SHARED_LINK_MODE_PER_RECIPIENT,
    expiresDays: toPositiveInt(config.expiresDays, 30),
    useAsPrimaryCta: config.useAsPrimaryCta !== false,
    linkLabel: String(config.linkLabel || "").trim(),
  };
}

function buildSharedDocumentPayload(row) {
  if (!row) return null;
  return {
    id: String(row.public_id || ""),
    campaignId: row.campaign_id ? Number(row.campaign_id) : null,
    sourceType: String(row.source_type || "").trim(),
    title: String(row.title || "").trim(),
    description: String(row.description || "").trim(),
    mimeType: String(row.mime_type || "").trim(),
    originalFileName: String(row.original_file_name || "").trim(),
    byteSize: row.byte_size == null ? null : Number(row.byte_size),
    libraryAssetPublicId: String(row.library_asset_public_id || "").trim(),
    libraryFilePublicId: String(row.library_file_public_id || "").trim(),
    status: String(row.status || "active").trim(),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function getSharedDocumentByPublicId(publicId, userId) {
  await ensureCampaignEmailDispatchSchema();
  const rows = await query(
    `SELECT *
       FROM campaign_email_shared_documents
      WHERE public_id = ?
        AND created_by_user_id = ?
      LIMIT 1`,
    [String(publicId || "").trim(), Number(userId)],
  );
  return rows[0] || null;
}

async function resolveLibraryFileRow({ assetPublicId, filePublicId }) {
  const rows = await query(
    `SELECT i.id AS item_id,
            i.public_id AS asset_public_id,
            i.title,
            i.summary,
            i.status,
            i.is_downloadable,
            f.public_id AS file_public_id,
            f.storage_provider,
            f.storage_bucket,
            f.storage_key,
            f.original_file_name,
            f.stored_file_name,
            f.mime_type,
            f.byte_size
       FROM commercial_enablement_items i
       INNER JOIN commercial_enablement_item_files f ON f.item_id = i.id
      WHERE i.public_id = ?
        AND f.public_id = ?
        AND COALESCE(i.is_deleted, 0) = 0
        AND COALESCE(f.is_deleted, 0) = 0
        AND COALESCE(i.is_downloadable, 1) = 1
      LIMIT 1`,
    [String(assetPublicId || "").trim(), String(filePublicId || "").trim()],
  );
  return rows[0] || null;
}

async function resolveSharedDocumentFileDescriptor(sharedDocument) {
  if (!sharedDocument) return null;

  if (
    String(sharedDocument.source_type || "") === SHARED_DOCUMENT_SOURCE_LOCAL
  ) {
    return {
      storageProvider: String(sharedDocument.storage_provider || "").trim(),
      storageBucket: sharedDocument.storage_bucket || null,
      storageKey: String(sharedDocument.storage_key || "").trim(),
      fileName:
        String(sharedDocument.original_file_name || "").trim() ||
        String(sharedDocument.title || "documento"),
      mimeType:
        String(sharedDocument.mime_type || "").trim() ||
        "application/octet-stream",
    };
  }

  if (
    String(sharedDocument.source_type || "") === SHARED_DOCUMENT_SOURCE_LIBRARY
  ) {
    const libraryFile = await resolveLibraryFileRow({
      assetPublicId: sharedDocument.library_asset_public_id,
      filePublicId: sharedDocument.library_file_public_id,
    });
    if (!libraryFile) {
      return null;
    }

    return {
      storageProvider: String(libraryFile.storage_provider || "").trim(),
      storageBucket: libraryFile.storage_bucket || null,
      storageKey: String(libraryFile.storage_key || "").trim(),
      fileName:
        String(libraryFile.original_file_name || "").trim() ||
        String(sharedDocument.title || "documento"),
      mimeType:
        String(libraryFile.mime_type || "").trim() ||
        "application/octet-stream",
    };
  }

  return null;
}

async function createCampaignEmailShareLink({
  sharedDocumentId,
  dispatchId = null,
  dispatchRecipientId = null,
  shareMode = SHARED_LINK_MODE_GENERAL,
  recipient = null,
  expiresDays = 30,
}) {
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + toPositiveInt(expiresDays, 30) * 24 * 60 * 60 * 1000,
  );
  const publicId = buildShareLinkPublicId();
  const token = buildCampaignEmailShareToken();
  const tokenHash = buildCampaignEmailShareTokenHash(token);

  await query(
    `INSERT INTO campaign_email_share_links
      (public_id, token_hash, shared_document_id, dispatch_id, dispatch_recipient_id,
       share_mode, recipient_email, contact_id, account_id, contact_name, account_name,
       expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
    [
      publicId,
      tokenHash,
      Number(sharedDocumentId),
      dispatchId ? Number(dispatchId) : null,
      dispatchRecipientId ? Number(dispatchRecipientId) : null,
      String(shareMode || SHARED_LINK_MODE_GENERAL),
      recipient?.email ? String(recipient.email).trim().toLowerCase() : null,
      recipient?.contactId ? Number(recipient.contactId) : null,
      recipient?.accountId ? Number(recipient.accountId) : null,
      recipient?.contactName ? String(recipient.contactName).trim() : null,
      recipient?.accountName ? String(recipient.accountName).trim() : null,
      expiresAt,
    ],
  );

  return {
    publicId,
    token,
    expiresAt: expiresAt.toISOString(),
  };
}

async function findExistingGeneralShareLink({ sharedDocumentId, dispatchId }) {
  const rows = await query(
    `SELECT public_id
       FROM campaign_email_share_links
      WHERE shared_document_id = ?
        AND share_mode = ?
        AND dispatch_id ${dispatchId ? "= ?" : "IS NULL"}
        AND revoked_at IS NULL
        AND expires_at > NOW(3)
      ORDER BY id DESC
      LIMIT 1`,
    dispatchId
      ? [Number(sharedDocumentId), SHARED_LINK_MODE_GENERAL, Number(dispatchId)]
      : [Number(sharedDocumentId), SHARED_LINK_MODE_GENERAL],
  );
  return rows[0] || null;
}

async function buildShareUrlForRecipient({
  req,
  sharedDocument,
  dispatchId = null,
  dispatchRecipientId = null,
  recipient = null,
  shareMode = SHARED_LINK_MODE_GENERAL,
  expiresDays = 30,
}) {
  if (!sharedDocument?.id) return null;

  if (shareMode === SHARED_LINK_MODE_GENERAL) {
    const existing = await findExistingGeneralShareLink({
      sharedDocumentId: Number(sharedDocument.id),
      dispatchId: dispatchId ? Number(dispatchId) : null,
    });
    if (existing?.public_id) {
      return null;
    }
  }

  const share = await createCampaignEmailShareLink({
    sharedDocumentId: Number(sharedDocument.id),
    dispatchId,
    dispatchRecipientId,
    recipient,
    shareMode,
    expiresDays,
  });

  return {
    url: buildCampaignEmailShareUrl(req, share.token),
    expiresAt: share.expiresAt,
  };
}

async function listCampaignEmailLibraryFiles({ user, q = "" }) {
  const listing = await listCommercialEnablementAssets({
    user,
    filters: {
      q: String(q || "").trim(),
      page: 1,
      pageSize: 30,
      sort: "updated_desc",
    },
  });

  const items = Array.isArray(listing?.items) ? listing.items : [];
  return items
    .filter((item) => item?.isDownloadable !== false)
    .flatMap((item) => {
      const files = Array.isArray(item?.files) ? item.files : [];
      return files.map((file) => ({
        assetPublicId: String(item?.publicId || "").trim(),
        filePublicId: String(file?.publicId || "").trim(),
        title: String(item?.title || "").trim(),
        summary: String(item?.summary || "").trim(),
        fileName: String(
          file?.originalFileName || file?.storedFileName || "",
        ).trim(),
        mimeType: String(file?.mimeType || "").trim(),
        byteSize: file?.byteSize == null ? null : Number(file.byteSize),
        status: String(item?.status || "").trim(),
      }));
    })
    .filter((item) => item.assetPublicId && item.filePublicId && item.fileName);
}

async function createSharedDocumentFromUpload({ req, user }) {
  const { fields, files } = await parseMultipartFiles(req);
  if (!files.length) {
    const error = new Error("Debes adjuntar un archivo");
    error.status = 400;
    throw error;
  }
  if (files.length > 1) {
    const error = new Error(
      "Solo se permite un archivo por documento compartido",
    );
    error.status = 400;
    throw error;
  }

  const parsed = sharedDocumentUploadFieldsSchema.safeParse({
    campaignId: Array.isArray(fields?.campaignId)
      ? fields.campaignId[0]
      : fields?.campaignId,
    title: Array.isArray(fields?.title) ? fields.title[0] : fields?.title,
    description: Array.isArray(fields?.description)
      ? fields.description[0]
      : fields?.description,
  });

  if (!parsed.success) {
    await cleanupTempFiles(files).catch(() => undefined);
    const error = new Error("Datos inválidos para documento compartido");
    error.status = 400;
    error.body = { errors: parsed.error.flatten() };
    throw error;
  }

  const [file] = files;
  try {
    const buffer = await readFile(file.filepath);
    const extension = path.extname(file.originalFilename || "").toLowerCase();
    const publicId = buildSharedDocumentPublicId();
    const storageKey = `campaign-email-shared/${publicId}${extension}`;
    const stored = await documentStorage.save({ buffer, storageKey });

    await query(
      `INSERT INTO campaign_email_shared_documents
        (public_id, campaign_id, created_by_user_id, source_type, title, description,
         mime_type, original_file_name, byte_size, storage_provider, storage_bucket,
         storage_key, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW(3), NOW(3))`,
      [
        publicId,
        parsed.data.campaignId ? Number(parsed.data.campaignId) : null,
        Number(user.id),
        SHARED_DOCUMENT_SOURCE_LOCAL,
        String(parsed.data.title || "").trim(),
        String(parsed.data.description || "").trim() || null,
        file.mimetype || "application/octet-stream",
        file.originalFilename || path.basename(file.filepath),
        Number(file.size || buffer.byteLength || 0),
        stored.storageProvider,
        stored.storageBucket,
        stored.storageKey,
      ],
    );

    const created = await getSharedDocumentByPublicId(publicId, user.id);
    return buildSharedDocumentPayload(created);
  } finally {
    await cleanupTempFiles(files).catch(() => undefined);
  }
}

async function createSharedDocumentFromLibrarySelection({ body, user }) {
  const libraryFile = await resolveLibraryFileRow({
    assetPublicId: body.assetPublicId,
    filePublicId: body.filePublicId,
  });
  if (!libraryFile) {
    const error = new Error("Archivo de biblioteca no encontrado");
    error.status = 404;
    throw error;
  }

  const publicId = buildSharedDocumentPublicId();
  await query(
    `INSERT INTO campaign_email_shared_documents
      (public_id, campaign_id, created_by_user_id, source_type, title, description,
       mime_type, original_file_name, byte_size, library_asset_public_id,
       library_file_public_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW(3), NOW(3))`,
    [
      publicId,
      body.campaignId ? Number(body.campaignId) : null,
      Number(user.id),
      SHARED_DOCUMENT_SOURCE_LIBRARY,
      String(body.title || "").trim(),
      String(body.description || "").trim() || null,
      String(libraryFile.mime_type || "").trim() || null,
      String(libraryFile.original_file_name || "").trim() || null,
      libraryFile.byte_size == null ? null : Number(libraryFile.byte_size),
      String(body.assetPublicId || "").trim(),
      String(body.filePublicId || "").trim(),
    ],
  );

  const created = await getSharedDocumentByPublicId(publicId, user.id);
  return buildSharedDocumentPayload(created);
}

async function createPreviewShareLink({
  req,
  sharedDocument,
  expiresDays = 30,
}) {
  const share = await createCampaignEmailShareLink({
    sharedDocumentId: Number(sharedDocument.id),
    shareMode: SHARED_LINK_MODE_GENERAL,
    expiresDays,
  });

  return {
    url: buildCampaignEmailShareUrl(req, share.token),
    expiresAt: share.expiresAt,
  };
}

async function sendToRecipients({
  accessToken,
  from,
  recipients,
  subject,
  preheader,
  htmlContent,
  ctaLabel,
  ctaUrl,
  req,
  sharedDocument,
  dispatchId = null,
}) {
  const results = [];

  for (const recipient of recipients) {
    try {
      let resolvedCtaUrl = String(ctaUrl || "").trim();
      if (sharedDocument?.id && sharedDocument?.useAsPrimaryCta !== false) {
        const shareMode =
          sharedDocument.linkMode === SHARED_LINK_MODE_GENERAL
            ? SHARED_LINK_MODE_GENERAL
            : SHARED_LINK_MODE_PER_RECIPIENT;

        const shareLink = await buildShareUrlForRecipient({
          req,
          sharedDocument,
          dispatchId,
          dispatchRecipientId: recipient?.dispatchRecipientId || null,
          recipient,
          shareMode,
          expiresDays: sharedDocument.expiresDays,
        });

        if (shareLink?.url) {
          resolvedCtaUrl = shareLink.url;
        }
      }

      const htmlBody = buildHtmlWithPreheader({
        preheader,
        htmlContent: buildHtmlWithPrimaryCta({
          htmlContent,
          ctaUrl: resolvedCtaUrl,
          ctaLabel:
            String(sharedDocument?.linkLabel || "").trim() ||
            String(ctaLabel || "").trim(),
        }),
      });

      await sendGoogleMailMessage({
        accessToken,
        from,
        to: String(recipient?.email || "").trim(),
        cc: "",
        subject,
        messageBody: "Mensaje enviado",
        htmlBody,
        attachments: [],
      });

      results.push({
        email: String(recipient?.email || "").trim(),
        status: "sent",
        message: "Enviado",
      });
    } catch (error) {
      results.push({
        email: String(recipient?.email || "").trim(),
        status: "failed",
        message:
          String(error?.detail || error?.message || "") ||
          "Google rechazó el envío",
      });
    }
  }

  return results;
}

function summarizeResults(results = []) {
  return {
    total: results.length,
    sent: results.filter((item) => item.status === "sent").length,
    failed: results.filter((item) => item.status === "failed").length,
    invalid: results.filter((item) => item.status === "invalid").length,
    skipped: results.filter((item) => item.status === "skipped").length,
  };
}

function toPositiveInt(value, fallback) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) return fallback;
  return Math.trunc(normalized);
}

function toSafeNumber(value, fallback = 0) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
}

function buildDispatchPublicId() {
  return `cmpmailrun_${randomUUID().replace(/-/g, "")}`;
}

async function createDispatch({
  campaignId,
  requestedByUserId,
  subject,
  preheader,
  ctaLabel,
  ctaUrl,
  sharedDocument,
  htmlContent,
  recipients,
}) {
  await ensureCampaignEmailDispatchSchema();

  const publicId = buildDispatchPublicId();
  await query(
    `INSERT INTO campaign_email_dispatches
       (public_id, campaign_id, requested_by_user_id, status,
        subject, preheader, cta_label, cta_url,
        shared_document_public_id, shared_document_link_mode, shared_document_expires_days,
        html_content,
        batch_size, max_sends_per_hour, max_sends_per_day,
        timezone, started_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3), NOW(3))`,
    [
      publicId,
      campaignId || null,
      Number(requestedByUserId),
      "running",
      subject,
      null,
      String(ctaLabel || "").trim() || null,
      String(ctaUrl || "").trim() || null,
      String(sharedDocument?.publicId || "").trim() || null,
      String(sharedDocument?.linkMode || "").trim() || null,
      sharedDocument?.expiresDays ? Number(sharedDocument.expiresDays) : null,
      htmlContent,
      FIXED_BATCH_SIZE,
      FIXED_MAX_SENDS_PER_HOUR,
      FIXED_MAX_SENDS_PER_DAY,
      "UTC",
    ],
  );

  const dispatchRows = await query(
    `SELECT *
     FROM campaign_email_dispatches
     WHERE public_id = ?
     LIMIT 1`,
    [publicId],
  );
  const dispatch = dispatchRows[0] || null;
  if (!dispatch) {
    throw new Error("No fue posible crear la corrida de envío");
  }

  const chunkSize = 400;
  for (let index = 0; index < recipients.length; index += chunkSize) {
    const chunk = recipients.slice(index, index + chunkSize);
    const placeholders = chunk
      .map(() => "(?, ?, ?, ?, ?, ?, 'pending', 0, NOW(3), NOW(3))")
      .join(", ");
    const values = [];
    for (const recipient of chunk) {
      values.push(
        Number(dispatch.id),
        String(recipient?.email || "")
          .trim()
          .toLowerCase(),
        recipient?.contactId ? Number(recipient.contactId) : null,
        recipient?.accountId ? Number(recipient.accountId) : null,
        recipient?.contactName ? String(recipient.contactName).trim() : null,
        recipient?.accountName ? String(recipient.accountName).trim() : null,
      );
    }

    await query(
      `INSERT INTO campaign_email_dispatch_recipients
         (dispatch_id, email, contact_id, account_id, contact_name, account_name,
          status, attempt_count, created_at, updated_at)
       VALUES ${placeholders}`,
      values,
    );
  }

  return dispatch;
}

async function getDispatchRowByPublicId(
  publicId,
  { requestedByUserId, allowAnyRequester = false } = {},
) {
  await ensureCampaignEmailDispatchSchema();
  const normalizedPublicId = String(publicId || "").trim();
  let rows;
  if (allowAnyRequester) {
    rows = await query(
      `SELECT *
       FROM campaign_email_dispatches
       WHERE public_id = ?
       LIMIT 1`,
      [normalizedPublicId],
    );
  } else {
    rows = await query(
      `SELECT *
       FROM campaign_email_dispatches
       WHERE public_id = ?
         AND requested_by_user_id = ?
       LIMIT 1`,
      [normalizedPublicId, Number(requestedByUserId)],
    );
  }
  return rows[0] || null;
}

async function getDispatchSummary(dispatchId) {
  const totalsRows = await query(
    `SELECT
        COUNT(*) AS total,
        SUM(status = 'pending') AS pending,
        SUM(status = 'running') AS running,
        SUM(status = 'sent') AS sent,
        SUM(status = 'failed') AS failed,
        SUM(status = 'skipped') AS skipped
     FROM campaign_email_dispatch_recipients
     WHERE dispatch_id = ?`,
    [Number(dispatchId)],
  );

  const windowsRows = await query(
    `SELECT
        SUM(status = 'sent' AND sent_at >= DATE_SUB(NOW(3), INTERVAL 1 HOUR)) AS sent_last_hour,
        SUM(status = 'sent' AND sent_at >= CURRENT_DATE() AND sent_at < DATE_ADD(CURRENT_DATE(), INTERVAL 1 DAY)) AS sent_today
     FROM campaign_email_dispatch_recipients
     WHERE dispatch_id = ?`,
    [Number(dispatchId)],
  );

  const nextRetryRows = await query(
    `SELECT MIN(next_retry_at) AS next_retry_at
     FROM campaign_email_dispatch_recipients
     WHERE dispatch_id = ?
       AND status = 'failed'
       AND attempt_count < ?
       AND next_retry_at IS NOT NULL`,
    [Number(dispatchId), MAX_RECIPIENT_ATTEMPTS],
  );

  const shareRows = await query(
    `SELECT
        COUNT(*) AS link_count,
        SUM(access_count) AS access_count,
        SUM(download_count) AS download_count,
        SUM(CASE WHEN access_count > 0 THEN 1 ELSE 0 END) AS accessed_recipients,
        SUM(CASE WHEN download_count > 0 THEN 1 ELSE 0 END) AS downloaded_recipients,
        MAX(last_accessed_at) AS last_accessed_at,
        MAX(d.title) AS document_title,
        MAX(s.share_mode) AS share_mode
     FROM campaign_email_share_links s
     INNER JOIN campaign_email_shared_documents d ON d.id = s.shared_document_id
     WHERE s.dispatch_id = ?`,
    [Number(dispatchId)],
  );

  const totals = totalsRows[0] || {};
  const windows = windowsRows[0] || {};
  const shares = shareRows[0] || {};

  return {
    total: toSafeNumber(totals.total),
    pending: toSafeNumber(totals.pending),
    running: toSafeNumber(totals.running),
    sent: toSafeNumber(totals.sent),
    failed: toSafeNumber(totals.failed),
    skipped: toSafeNumber(totals.skipped),
    sentLastHour: toSafeNumber(windows.sent_last_hour),
    sentToday: toSafeNumber(windows.sent_today),
    nextRetryAt: nextRetryRows[0]?.next_retry_at || null,
    documentTracking:
      toSafeNumber(shares.link_count) > 0
        ? {
            title:
              String(shares.document_title || "").trim() ||
              "Documento compartido",
            shareMode: String(shares.share_mode || SHARED_LINK_MODE_GENERAL),
            totalLinks: toSafeNumber(shares.link_count),
            accessCount: toSafeNumber(shares.access_count),
            downloadCount: toSafeNumber(shares.download_count),
            accessedRecipients: toSafeNumber(shares.accessed_recipients),
            downloadedRecipients: toSafeNumber(shares.downloaded_recipients),
            lastAccessedAt: shares.last_accessed_at || null,
          }
        : null,
  };
}

async function getDispatchResults(dispatchId, limit = 100) {
  const rows = await query(
    `SELECT r.email, r.contact_name, r.account_name,
            COALESCE(owners.owner_names, '') AS seller_name,
            r.status,
            r.last_error_message, r.sent_at, r.updated_at,
            link_stats.first_accessed_at, link_stats.last_accessed_at,
            COALESCE(link_stats.access_count, 0) AS access_count,
            COALESCE(link_stats.download_count, 0) AS download_count
     FROM campaign_email_dispatch_recipients r
     LEFT JOIN (
       SELECT ao.account_id,
              GROUP_CONCAT(DISTINCT u.full_name ORDER BY u.full_name SEPARATOR ', ') AS owner_names
       FROM account_owners ao
       INNER JOIN users u ON u.id = ao.user_id
       GROUP BY ao.account_id
     ) owners ON owners.account_id = r.account_id
     LEFT JOIN (
       SELECT dispatch_recipient_id,
              MIN(first_accessed_at) AS first_accessed_at,
              MAX(last_accessed_at) AS last_accessed_at,
              SUM(access_count) AS access_count,
              SUM(download_count) AS download_count
         FROM campaign_email_share_links
        WHERE dispatch_id = ?
          AND dispatch_recipient_id IS NOT NULL
        GROUP BY dispatch_recipient_id
     ) link_stats ON link_stats.dispatch_recipient_id = r.id
     WHERE r.dispatch_id = ?
     ORDER BY
       CASE r.status
         WHEN 'running' THEN 0
         WHEN 'failed' THEN 1
         WHEN 'pending' THEN 2
         WHEN 'sent' THEN 3
         ELSE 4
       END,
       r.sent_at DESC,
       r.updated_at DESC,
       r.id DESC
     LIMIT ?`,
    [Number(dispatchId), Number(dispatchId), toPositiveInt(limit, 100)],
  );

  return rows.map((row) => ({
    email: String(row.email || ""),
    contactName: String(row.contact_name || "").trim() || null,
    accountName: String(row.account_name || "").trim() || null,
    sellerName: String(row.seller_name || "").trim() || null,
    status: String(row.status || "pending"),
    message:
      String(row.last_error_message || "").trim() ||
      (String(row.status || "") === "sent" ? "Enviado" : "En cola"),
    sentAt: row.sent_at || null,
    updatedAt: row.updated_at || null,
    firstAccessedAt: row.first_accessed_at || null,
    lastAccessedAt: row.last_accessed_at || null,
    accessCount: toSafeNumber(row.access_count),
    downloadCount: toSafeNumber(row.download_count),
  }));
}

function buildDispatchPayload(dispatchRow, summary) {
  if (!dispatchRow) return null;
  return {
    id: String(dispatchRow.public_id || ""),
    campaignId: dispatchRow.campaign_id
      ? Number(dispatchRow.campaign_id)
      : null,
    status: String(dispatchRow.status || "running"),
    subject: String(dispatchRow.subject || ""),
    config: {
      batchSize: toSafeNumber(dispatchRow.batch_size, FIXED_BATCH_SIZE),
      maxSendsPerHour: toSafeNumber(
        dispatchRow.max_sends_per_hour,
        FIXED_MAX_SENDS_PER_HOUR,
      ),
      maxSendsPerDay: toSafeNumber(
        dispatchRow.max_sends_per_day,
        FIXED_MAX_SENDS_PER_DAY,
      ),
    },
    startedAt: dispatchRow.started_at || null,
    pausedAt: dispatchRow.paused_at || null,
    resumedAt: dispatchRow.resumed_at || null,
    finishedAt: dispatchRow.finished_at || null,
    lastErrorMessage:
      String(dispatchRow.last_error_message || "").trim() || null,
    summary,
  };
}

async function claimRecipientsForDispatch(dispatchId, limit) {
  const leaseToken = randomUUID().replace(/-/g, "");

  const rows = await withTransaction(async (conn) => {
    const [updateResult] = await conn.query(
      `UPDATE campaign_email_dispatch_recipients
       SET status = 'running',
           attempt_count = CASE WHEN status = 'running' THEN attempt_count ELSE attempt_count + 1 END,
           lease_token = ?,
           lease_expires_at = DATE_ADD(NOW(3), INTERVAL ? SECOND),
           updated_at = NOW(3)
       WHERE dispatch_id = ?
         AND (
           status = 'pending'
           OR (
             status = 'failed'
             AND attempt_count < ?
             AND next_retry_at IS NOT NULL
             AND next_retry_at <= NOW(3)
           )
           OR (
             status = 'running'
             AND lease_expires_at IS NOT NULL
             AND lease_expires_at <= NOW(3)
           )
         )
       ORDER BY id ASC
       LIMIT ?`,
      [
        leaseToken,
        RECIPIENT_LEASE_SECONDS,
        Number(dispatchId),
        MAX_RECIPIENT_ATTEMPTS,
        toPositiveInt(limit, 1),
      ],
    );

    if (!Number(updateResult?.affectedRows || 0)) {
      return [];
    }

    const [claimedRows] = await conn.query(
      `SELECT id, email, contact_id, account_id, contact_name, account_name, attempt_count
       FROM campaign_email_dispatch_recipients
       WHERE dispatch_id = ?
         AND lease_token = ?
       ORDER BY id ASC`,
      [Number(dispatchId), leaseToken],
    );

    return claimedRows;
  });

  return {
    leaseToken,
    recipients: Array.isArray(rows) ? rows : [],
  };
}

async function markRecipientSent({ recipientId, leaseToken }) {
  await query(
    `UPDATE campaign_email_dispatch_recipients
     SET status = 'sent',
         sent_at = NOW(3),
         next_retry_at = NULL,
         lease_token = NULL,
         lease_expires_at = NULL,
         last_error_message = NULL,
         updated_at = NOW(3)
     WHERE id = ?
       AND lease_token = ?`,
    [Number(recipientId), String(leaseToken || "")],
  );
}

async function markRecipientFailed({
  recipientId,
  leaseToken,
  attemptCount,
  errorMessage,
}) {
  const shouldRetry = Number(attemptCount) < MAX_RECIPIENT_ATTEMPTS;
  if (shouldRetry) {
    await query(
      `UPDATE campaign_email_dispatch_recipients
       SET status = 'failed',
           next_retry_at = DATE_ADD(NOW(3), INTERVAL ? MINUTE),
           lease_token = NULL,
           lease_expires_at = NULL,
           last_error_message = ?,
           updated_at = NOW(3)
       WHERE id = ?
         AND lease_token = ?`,
      [
        RECIPIENT_RETRY_DELAY_MINUTES,
        String(errorMessage || "Google rechazó el envío").slice(0, 1000),
        Number(recipientId),
        String(leaseToken || ""),
      ],
    );
    return;
  }

  await query(
    `UPDATE campaign_email_dispatch_recipients
     SET status = 'failed',
         next_retry_at = NULL,
         lease_token = NULL,
         lease_expires_at = NULL,
         last_error_message = ?,
         updated_at = NOW(3)
     WHERE id = ?
       AND lease_token = ?`,
    [
      String(errorMessage || "Google rechazó el envío").slice(0, 1000),
      Number(recipientId),
      String(leaseToken || ""),
    ],
  );
}

async function completeDispatchIfNoPending(dispatchId) {
  const rows = await query(
    `SELECT COUNT(*) AS open_count
     FROM campaign_email_dispatch_recipients
     WHERE dispatch_id = ?
       AND (
         status = 'pending'
         OR status = 'running'
         OR (status = 'failed' AND attempt_count < ?)
       )`,
    [Number(dispatchId), MAX_RECIPIENT_ATTEMPTS],
  );

  const openCount = toSafeNumber(rows[0]?.open_count);
  if (openCount > 0) {
    return false;
  }

  await query(
    `UPDATE campaign_email_dispatches
     SET status = 'completed',
         finished_at = NOW(3),
         updated_at = NOW(3)
     WHERE id = ?
       AND status = 'running'`,
    [Number(dispatchId)],
  );
  return true;
}

async function calculateDispatchWindowQuota(dispatchId, dispatchConfig) {
  const rows = await query(
    `SELECT
        SUM(status = 'sent' AND sent_at >= DATE_SUB(NOW(3), INTERVAL 1 HOUR)) AS sent_last_hour,
        SUM(status = 'sent' AND sent_at >= CURRENT_DATE() AND sent_at < DATE_ADD(CURRENT_DATE(), INTERVAL 1 DAY)) AS sent_today
     FROM campaign_email_dispatch_recipients
     WHERE dispatch_id = ?`,
    [Number(dispatchId)],
  );
  const metrics = rows[0] || {};
  const sentLastHour = toSafeNumber(metrics.sent_last_hour);
  const sentToday = toSafeNumber(metrics.sent_today);

  const maxPerHour = toPositiveInt(
    dispatchConfig?.max_sends_per_hour,
    FIXED_MAX_SENDS_PER_HOUR,
  );
  const maxPerDay = toPositiveInt(
    dispatchConfig?.max_sends_per_day,
    FIXED_MAX_SENDS_PER_DAY,
  );
  const batchSize = toPositiveInt(dispatchConfig?.batch_size, FIXED_BATCH_SIZE);

  const availableByHour = Math.max(0, maxPerHour - sentLastHour);
  const availableByDay = Math.max(0, maxPerDay - sentToday);
  const allowedNow = Math.max(
    0,
    Math.min(batchSize, availableByHour, availableByDay),
  );

  return {
    allowedNow,
    sentLastHour,
    sentToday,
  };
}

async function processSingleDispatch(dispatchRow) {
  const dispatchId = Number(dispatchRow?.id || 0);
  const requestedByUserId = Number(dispatchRow?.requested_by_user_id || 0);
  if (!dispatchId || !requestedByUserId) return;

  const { allowedNow } = await calculateDispatchWindowQuota(
    dispatchId,
    dispatchRow,
  );
  if (allowedNow <= 0) {
    await completeDispatchIfNoPending(dispatchId);
    return;
  }

  let tokenData;
  try {
    tokenData = await resolveGoogleAccessTokenForUser(requestedByUserId);
  } catch (error) {
    await query(
      `UPDATE campaign_email_dispatches
       SET status = 'paused',
           paused_at = NOW(3),
           last_error_message = ?,
           updated_at = NOW(3)
       WHERE id = ?
         AND status = 'running'`,
      [
        String(
          error?.message || "No fue posible preparar envío con Google",
        ).slice(0, 1000),
        dispatchId,
      ],
    );
    return;
  }

  const { leaseToken, recipients } = await claimRecipientsForDispatch(
    dispatchId,
    allowedNow,
  );
  if (!recipients.length) {
    await completeDispatchIfNoPending(dispatchId);
    return;
  }

  const sharedDocumentPublicId = String(
    dispatchRow.shared_document_public_id || "",
  ).trim();
  const sharedDocumentRecord = sharedDocumentPublicId
    ? await getSharedDocumentByPublicId(
        sharedDocumentPublicId,
        requestedByUserId,
      )
    : null;
  const sharedDocument = sharedDocumentRecord
    ? {
        id: Number(sharedDocumentRecord.id),
        publicId: String(sharedDocumentRecord.public_id || "").trim(),
        linkMode:
          String(dispatchRow.shared_document_link_mode || "").trim() ||
          SHARED_LINK_MODE_PER_RECIPIENT,
        expiresDays: toPositiveInt(
          dispatchRow.shared_document_expires_days,
          30,
        ),
        linkLabel: String(dispatchRow.cta_label || "").trim(),
        useAsPrimaryCta: true,
      }
    : null;

  let generalShareUrl = "";
  if (
    sharedDocument?.id &&
    sharedDocument.linkMode === SHARED_LINK_MODE_GENERAL
  ) {
    const generalShare = await buildShareUrlForRecipient({
      req: {
        protocol: process.env.APP_BASE_URL?.startsWith("https")
          ? "https"
          : "http",
        get(header) {
          if (header === "host") {
            const appBaseUrl = String(process.env.APP_BASE_URL || "").trim();
            if (appBaseUrl) {
              try {
                return new URL(appBaseUrl).host;
              } catch {
                return appBaseUrl
                  .replace(/^https?:\/\//, "")
                  .replace(/\/+$/, "");
              }
            }
          }
          return "localhost:4000";
        },
      },
      sharedDocument,
      dispatchId,
      shareMode: SHARED_LINK_MODE_GENERAL,
      expiresDays: sharedDocument.expiresDays,
    });
    generalShareUrl = String(generalShare?.url || "").trim();
  }

  for (const recipient of recipients) {
    try {
      let resolvedCtaUrl = String(dispatchRow.cta_url || "").trim();
      if (generalShareUrl) {
        resolvedCtaUrl = generalShareUrl;
      } else if (
        sharedDocument?.id &&
        sharedDocument.linkMode === SHARED_LINK_MODE_PER_RECIPIENT
      ) {
        const shareLink = await buildShareUrlForRecipient({
          req: {
            protocol: process.env.APP_BASE_URL?.startsWith("https")
              ? "https"
              : "http",
            get(header) {
              if (header === "host") {
                const appBaseUrl = String(
                  process.env.APP_BASE_URL || "",
                ).trim();
                if (appBaseUrl) {
                  try {
                    return new URL(appBaseUrl).host;
                  } catch {
                    return appBaseUrl
                      .replace(/^https?:\/\//, "")
                      .replace(/\/+$/, "");
                  }
                }
              }
              return "localhost:4000";
            },
          },
          sharedDocument,
          dispatchId,
          dispatchRecipientId: Number(recipient.id),
          recipient: {
            email: String(recipient.email || "").trim(),
            contactId: recipient.contact_id
              ? Number(recipient.contact_id)
              : null,
            accountId: recipient.account_id
              ? Number(recipient.account_id)
              : null,
            contactName: String(recipient.contact_name || "").trim() || null,
            accountName: String(recipient.account_name || "").trim() || null,
          },
          shareMode: SHARED_LINK_MODE_PER_RECIPIENT,
          expiresDays: sharedDocument.expiresDays,
        });
        if (shareLink?.url) {
          resolvedCtaUrl = shareLink.url;
        }
      }

      await sendGoogleMailMessage({
        accessToken: tokenData.accessToken,
        from: tokenData.fromEmail,
        to: String(recipient.email || ""),
        cc: "",
        subject: String(dispatchRow.subject || "").trim(),
        messageBody: "Mensaje enviado",
        htmlBody: buildHtmlWithPreheader({
          preheader: "",
          htmlContent: buildHtmlWithPrimaryCta({
            htmlContent: String(dispatchRow.html_content || ""),
            ctaUrl: resolvedCtaUrl,
            ctaLabel: String(dispatchRow.cta_label || "").trim(),
          }),
        }),
        attachments: [],
      });
      await markRecipientSent({ recipientId: recipient.id, leaseToken });
    } catch (error) {
      await markRecipientFailed({
        recipientId: recipient.id,
        leaseToken,
        attemptCount: toSafeNumber(recipient.attempt_count, 1),
        errorMessage:
          String(
            error?.detail || error?.message || "Google rechazó el envío",
          ) || "Google rechazó el envío",
      });
    }
  }

  await completeDispatchIfNoPending(dispatchId);
}

export async function processPendingCampaignEmailDispatches({
  limit = 2,
} = {}) {
  await ensureCampaignEmailDispatchSchema();

  const runningDispatches = await query(
    `SELECT *
     FROM campaign_email_dispatches
     WHERE status = 'running'
     ORDER BY updated_at ASC, id ASC
     LIMIT ?`,
    [toPositiveInt(limit, 2)],
  );

  for (const dispatch of runningDispatches) {
    await processSingleDispatch(dispatch);
  }

  return { processedCount: runningDispatches.length };
}

function queueCampaignEmailDispatchProcessing() {
  if (process.env.NODE_ENV === "test") return;

  setTimeout(async () => {
    if (campaignEmailWorkerRunning) return;
    campaignEmailWorkerRunning = true;
    try {
      await processPendingCampaignEmailDispatches({ limit: 1 });
    } catch (error) {
      console.error(
        "Queued campaign email dispatch processing error:",
        error?.message || error,
      );
    } finally {
      campaignEmailWorkerRunning = false;
    }
  }, 0);
}

export async function startCampaignEmailDispatchWorker() {
  if (campaignEmailWorkerStarted || process.env.NODE_ENV === "test") {
    return;
  }

  campaignEmailWorkerStarted = true;
  await ensureCampaignEmailDispatchSchema();
  queueCampaignEmailDispatchProcessing();

  campaignEmailWorkerTimer = setInterval(async () => {
    if (campaignEmailWorkerRunning) return;
    campaignEmailWorkerRunning = true;
    try {
      await processPendingCampaignEmailDispatches({ limit: 5 });
    } catch (error) {
      console.error(
        "Scheduled campaign email dispatch worker error:",
        error?.message || error,
      );
    } finally {
      campaignEmailWorkerRunning = false;
    }
  }, WORKER_POLL_INTERVAL_MS);

  if (typeof campaignEmailWorkerTimer?.unref === "function") {
    campaignEmailWorkerTimer.unref();
  }
}

router.get(
  "/library-files",
  requireAnyPermission(CAMPAIGN_EMAIL_SEND_PERMISSIONS),
  async (req, res) => {
    const files = await listCampaignEmailLibraryFiles({
      user: req.user,
      q: String(req.query?.q || "").trim(),
    });
    return res.json({ items: files });
  },
);

router.post(
  "/shared-documents/upload",
  requireAnyPermission(CAMPAIGN_EMAIL_SEND_PERMISSIONS),
  async (req, res) => {
    try {
      const document = await createSharedDocumentFromUpload({
        req,
        user: req.user,
      });
      return res.status(201).json({ document });
    } catch (error) {
      return res.status(Number(error?.status) || 500).json({
        message:
          String(error?.message || "") ||
          "No fue posible cargar el documento compartido",
        ...(error?.body || {}),
      });
    }
  },
);

router.post(
  "/shared-documents/library",
  requireAnyPermission(CAMPAIGN_EMAIL_SEND_PERMISSIONS),
  async (req, res) => {
    const parsed = sharedDocumentLibrarySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos para seleccionar archivo de biblioteca",
        errors: parsed.error.flatten(),
      });
    }

    try {
      const document = await createSharedDocumentFromLibrarySelection({
        body: parsed.data,
        user: req.user,
      });
      return res.status(201).json({ document });
    } catch (error) {
      return res.status(Number(error?.status) || 500).json({
        message:
          String(error?.message || "") ||
          "No fue posible preparar el documento desde biblioteca",
      });
    }
  },
);

router.post(
  "/shared-documents/:documentPublicId/preview-link",
  requireAnyPermission(CAMPAIGN_EMAIL_SEND_PERMISSIONS),
  async (req, res) => {
    const parsed = sharedDocumentPreviewSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos para generar enlace de vista previa",
        errors: parsed.error.flatten(),
      });
    }

    const sharedDocument = await getSharedDocumentByPublicId(
      req.params.documentPublicId,
      req.user.id,
    );
    if (!sharedDocument) {
      return res
        .status(404)
        .json({ message: "Documento compartido no encontrado" });
    }

    const preview = await createPreviewShareLink({
      req,
      sharedDocument,
      expiresDays: parsed.data.expiresDays,
    });

    return res.json(preview);
  },
);

router.post(
  "/test-send",
  requireAnyPermission(CAMPAIGN_EMAIL_SEND_PERMISSIONS),
  async (req, res) => {
    const parsed = testSendSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos para envío de prueba",
        issues: parsed.error.flatten(),
      });
    }

    const recipientsRaw = normalizeRecipientList(parsed.data);
    if (!recipientsRaw.length) {
      return res.status(400).json({
        message: "Debes indicar al menos un correo de prueba",
      });
    }

    const { validRecipients, invalidRecipients } =
      classifyRecipients(recipientsRaw);

    if (!validRecipients.length) {
      return res.status(400).json({
        message:
          "La lista de correos de prueba no contiene destinatarios válidos",
        results: invalidRecipients.map((email) => ({
          email,
          status: "invalid",
          message: "Formato de correo inválido",
        })),
      });
    }

    let accessToken = "";
    let fromEmail = "";
    let sharedDocument = null;
    try {
      const tokenData = await resolveGoogleAccessTokenForUser(req.user.id);
      accessToken = tokenData.accessToken;
      fromEmail = tokenData.fromEmail;
      sharedDocument = await resolveSharedDocumentForSendConfig(
        parsed.data.sharedDocument,
        req.user.id,
      );
    } catch (error) {
      return res.status(Number(error?.status) || 502).json({
        message: String(error?.message || "") || "Error de envío",
        reason: String(error?.reason || "google_send_failed"),
        requiredScope: error?.requiredScope || undefined,
      });
    }

    const subject = String(parsed.data.subject || "").trim();
    const htmlContent = String(parsed.data.htmlContent || "").trim();

    const results = await sendToRecipients({
      accessToken,
      from: fromEmail,
      recipients: validRecipients,
      subject,
      preheader: "",
      htmlContent,
      ctaLabel: String(parsed.data.ctaLabel || "").trim(),
      ctaUrl: String(parsed.data.ctaUrl || "").trim(),
      req,
      sharedDocument,
    });

    for (const invalidEmail of invalidRecipients) {
      results.push({
        email: invalidEmail,
        status: "invalid",
        message: "Formato de correo inválido",
      });
    }

    return res.json({
      summary: summarizeResults(results),
      results,
    });
  },
);

router.post(
  "/send",
  requireAnyPermission(CAMPAIGN_EMAIL_SEND_PERMISSIONS),
  async (req, res) => {
    const parsed = campaignSendSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos para iniciar envío",
        issues: parsed.error.flatten(),
      });
    }

    const { validRecipients, invalidRecipients } = classifyRecipients(
      parsed.data.recipients,
    );

    if (!validRecipients.length) {
      return res.status(400).json({
        message: "No hay destinatarios válidos para enviar",
      });
    }

    try {
      await resolveGoogleAccessTokenForUser(req.user.id);
    } catch (error) {
      return res.status(Number(error?.status) || 502).json({
        message: String(error?.message || "") || "Error de envío",
        reason: String(error?.reason || "google_send_failed"),
        requiredScope: error?.requiredScope || undefined,
      });
    }

    let sharedDocument = null;
    try {
      sharedDocument = await resolveSharedDocumentForSendConfig(
        parsed.data.sharedDocument,
        req.user.id,
      );
    } catch (error) {
      return res.status(Number(error?.status) || 500).json({
        message:
          String(error?.message || "") ||
          "No fue posible validar el documento compartido",
      });
    }

    let dispatch;
    try {
      dispatch = await createDispatch({
        campaignId: Number(parsed.data.campaignId || 0) || null,
        requestedByUserId: req.user.id,
        subject: String(parsed.data.subject || "").trim(),
        preheader: "",
        ctaLabel: String(parsed.data.ctaLabel || "").trim(),
        ctaUrl: String(parsed.data.ctaUrl || "").trim(),
        sharedDocument,
        htmlContent: String(parsed.data.htmlContent || "").trim(),
        recipients: validRecipients,
      });
    } catch (error) {
      return res.status(500).json({
        message:
          String(error?.message || "") ||
          "No fue posible crear la corrida de envío",
      });
    }

    queueCampaignEmailDispatchProcessing();

    const dispatchSummary = await getDispatchSummary(dispatch.id);
    const dispatchPayload = buildDispatchPayload(dispatch, dispatchSummary);

    const invalidResults = invalidRecipients.map((email) => ({
      email,
      status: "invalid",
      message: "Formato de correo inválido",
    }));

    return res.json({
      message:
        "Envío programado. Se procesará automáticamente con tope fijo de 50 por hora y 300 por día.",
      dispatch: dispatchPayload,
      summary: {
        queued: dispatchSummary.total,
        invalid: invalidRecipients.length,
        batchSize: FIXED_BATCH_SIZE,
        maxSendsPerHour: FIXED_MAX_SENDS_PER_HOUR,
        maxSendsPerDay: FIXED_MAX_SENDS_PER_DAY,
      },
      invalidResults,
    });
  },
);

router.get(
  "/runs/:runId",
  requireAnyPermission(CAMPAIGN_EMAIL_SEND_PERMISSIONS),
  async (req, res) => {
    const canViewAllDispatches = hasCampaignEmailAdminAccess(req.user);
    const dispatch = await getDispatchRowByPublicId(
      req.params.runId,
      {
        requestedByUserId: req.user.id,
        allowAnyRequester: canViewAllDispatches,
      },
    );
    if (!dispatch) {
      return res
        .status(404)
        .json({ message: "Corrida de envío no encontrada" });
    }

    const summary = await getDispatchSummary(dispatch.id);
    const results = await getDispatchResults(dispatch.id, 120);
    return res.json({
      dispatch: buildDispatchPayload(dispatch, summary),
      results,
    });
  },
);

router.get(
  "/campaign/:campaignId/latest",
  requireAnyPermission(CAMPAIGN_EMAIL_SEND_PERMISSIONS),
  async (req, res) => {
    const campaignId = Number(req.params.campaignId || 0);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return res.status(400).json({ message: "campaignId invalido" });
    }

    await ensureCampaignEmailDispatchSchema();
    const canViewAllDispatches = hasCampaignEmailAdminAccess(req.user);
    const rows = canViewAllDispatches
      ? await query(
          `SELECT *
           FROM campaign_email_dispatches
           WHERE campaign_id = ?
           ORDER BY created_at DESC, id DESC
           LIMIT 1`,
          [campaignId],
        )
      : await query(
          `SELECT *
           FROM campaign_email_dispatches
           WHERE campaign_id = ?
             AND requested_by_user_id = ?
           ORDER BY created_at DESC, id DESC
           LIMIT 1`,
          [campaignId, Number(req.user.id)],
        );

    const dispatch = rows[0] || null;
    if (!dispatch) {
      return res.json({ dispatch: null, results: [] });
    }

    const summary = await getDispatchSummary(dispatch.id);
    const results = await getDispatchResults(dispatch.id, 120);
    return res.json({
      dispatch: buildDispatchPayload(dispatch, summary),
      results,
    });
  },
);

router.post(
  "/runs/:runId/pause",
  requireAnyPermission(CAMPAIGN_EMAIL_SEND_PERMISSIONS),
  async (req, res) => {
    const dispatch = await getDispatchRowByPublicId(
      req.params.runId,
      { requestedByUserId: req.user.id },
    );
    if (!dispatch) {
      return res
        .status(404)
        .json({ message: "Corrida de envío no encontrada" });
    }

    await query(
      `UPDATE campaign_email_dispatches
       SET status = 'paused',
           paused_at = NOW(3),
           updated_at = NOW(3)
       WHERE id = ?
         AND status = 'running'`,
      [Number(dispatch.id)],
    );

    const updated = await getDispatchRowByPublicId(
      req.params.runId,
      { requestedByUserId: req.user.id },
    );
    const summary = await getDispatchSummary(dispatch.id);
    return res.json({ dispatch: buildDispatchPayload(updated, summary) });
  },
);

router.post(
  "/runs/:runId/resume",
  requireAnyPermission(CAMPAIGN_EMAIL_SEND_PERMISSIONS),
  async (req, res) => {
    const dispatch = await getDispatchRowByPublicId(
      req.params.runId,
      { requestedByUserId: req.user.id },
    );
    if (!dispatch) {
      return res
        .status(404)
        .json({ message: "Corrida de envío no encontrada" });
    }

    await query(
      `UPDATE campaign_email_dispatches
       SET status = 'running',
           resumed_at = NOW(3),
           last_error_message = NULL,
           updated_at = NOW(3)
       WHERE id = ?
         AND status IN ('paused', 'failed')`,
      [Number(dispatch.id)],
    );

    queueCampaignEmailDispatchProcessing();

    const updated = await getDispatchRowByPublicId(
      req.params.runId,
      { requestedByUserId: req.user.id },
    );
    const summary = await getDispatchSummary(dispatch.id);
    return res.json({ dispatch: buildDispatchPayload(updated, summary) });
  },
);

router.post(
  "/runs/:runId/cancel",
  requireAnyPermission(CAMPAIGN_EMAIL_SEND_PERMISSIONS),
  async (req, res) => {
    const dispatch = await getDispatchRowByPublicId(
      req.params.runId,
      { requestedByUserId: req.user.id },
    );
    if (!dispatch) {
      return res
        .status(404)
        .json({ message: "Corrida de envío no encontrada" });
    }

    await query(
      `UPDATE campaign_email_dispatches
       SET status = 'canceled',
           finished_at = NOW(3),
           updated_at = NOW(3)
       WHERE id = ?
         AND status IN ('running', 'paused')`,
      [Number(dispatch.id)],
    );

    await query(
      `UPDATE campaign_email_dispatch_recipients
       SET status = 'skipped',
           lease_token = NULL,
           lease_expires_at = NULL,
           next_retry_at = NULL,
           last_error_message = 'Corrida cancelada por usuario',
           updated_at = NOW(3)
       WHERE dispatch_id = ?
         AND (
           status = 'pending'
           OR status = 'running'
           OR (status = 'failed' AND attempt_count < ?)
         )`,
      [Number(dispatch.id), MAX_RECIPIENT_ATTEMPTS],
    );

    const updated = await getDispatchRowByPublicId(
      req.params.runId,
      { requestedByUserId: req.user.id },
    );
    const summary = await getDispatchSummary(dispatch.id);
    return res.json({ dispatch: buildDispatchPayload(updated, summary) });
  },
);

publicRouter.get("/campaign-email-shares/:token/download", async (req, res) => {
  const token = String(req.params.token || "").trim();
  if (!token) {
    return res.status(400).json({ message: "Token inválido" });
  }

  await ensureCampaignEmailDispatchSchema();
  const tokenHash = buildCampaignEmailShareTokenHash(token);
  const rows = await query(
    `SELECT s.id, s.shared_document_id, s.revoked_at, s.expires_at,
            d.source_type, d.mime_type, d.original_file_name, d.storage_provider,
            d.storage_bucket, d.storage_key, d.library_asset_public_id,
            d.library_file_public_id, d.title
       FROM campaign_email_share_links s
       INNER JOIN campaign_email_shared_documents d ON d.id = s.shared_document_id
      WHERE s.token_hash = ?
      LIMIT 1`,
    [tokenHash],
  );

  if (!rows.length) {
    return res.status(404).json({ message: "Enlace no encontrado" });
  }

  const shareLink = rows[0];
  if (shareLink.revoked_at) {
    return res.status(410).json({ message: "Enlace revocado" });
  }

  const expiresAt = new Date(shareLink.expires_at);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
    return res.status(410).json({ message: "Enlace expirado" });
  }

  const descriptor = await resolveSharedDocumentFileDescriptor({
    source_type: shareLink.source_type,
    storage_provider: shareLink.storage_provider,
    storage_bucket: shareLink.storage_bucket,
    storage_key: shareLink.storage_key,
    original_file_name: shareLink.original_file_name,
    mime_type: shareLink.mime_type,
    title: shareLink.title,
    library_asset_public_id: shareLink.library_asset_public_id,
    library_file_public_id: shareLink.library_file_public_id,
  });

  if (!descriptor?.storageKey) {
    return res.status(404).json({ message: "Archivo no disponible" });
  }

  try {
    const stream = await documentStorage.openReadStream({
      storageKey: descriptor.storageKey,
      storageBucket: descriptor.storageBucket,
    });

    await query(
      `UPDATE campaign_email_share_links
       SET first_accessed_at = COALESCE(first_accessed_at, NOW(3)),
           last_accessed_at = NOW(3),
           access_count = access_count + 1,
           download_count = download_count + 1,
           updated_at = NOW(3)
       WHERE id = ?`,
      [Number(shareLink.id)],
    );

    stream.on("error", (error) => {
      console.error(error);
      if (!res.headersSent) {
        res
          .status(502)
          .json({ message: "No fue posible transmitir el archivo" });
        return;
      }
      res.destroy(error);
    });

    res.setHeader(
      "Content-Type",
      descriptor.mimeType || "application/octet-stream",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(descriptor.fileName || "documento")}"`,
    );
    res.setHeader("Cache-Control", "no-store");
    return stream.pipe(res);
  } catch (error) {
    const status = Number(error?.status) || 502;
    if (status >= 500) {
      console.error(error);
    }
    return res.status(status).json({
      message: error?.message || "No fue posible abrir el documento compartido",
    });
  }
});

export default router;
