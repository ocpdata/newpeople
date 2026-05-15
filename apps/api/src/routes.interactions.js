import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import express from "express";
import { z } from "zod";
import { logAuditEvent } from "./audit.js";
import { requireAnyPermission, requirePermission } from "./auth.js";
import { config } from "./config.js";
import { query, withTransaction } from "./db.js";
import { ensureInteractionPermissions } from "./interactions/permissions.js";
import { ensureInteractionSchema } from "./interactions/schema.js";
import {
  analyzeInteractionEvidence,
  buildDefaultOpportunityDraft,
} from "./interactions/service.js";
import {
  buildStorageKey,
  cleanupTempFiles,
  extractContentFromBuffer,
  parseMultipartFiles,
} from "./opportunity-documents/service.js";
import { ensureOpportunityDocumentSchema } from "./opportunity-documents/schema.js";
import { createDocumentStorage } from "./opportunity-documents/storage.js";

const router = express.Router();
const storage = createDocumentStorage();

const interactionReadPermissions = [
  "interacciones.read",
  "interacciones.read_all",
];

const interactionCreatePermissions = ["interacciones.create"];
const interactionUpdatePermissions = ["interacciones.update"];
const interactionAnalyzePermissions = ["interacciones.analyze"];
const interactionResolvePermissions = ["interacciones.resolve"];

const editableInteractionSchema = z.object({
  title: z.string().trim().min(2).max(255),
  sourceNotes: z.string().max(20000).optional().default(""),
  summary: z.string().max(20000).optional().default(""),
  topics: z
    .array(z.string().trim().min(1).max(400))
    .max(30)
    .optional()
    .default([]),
  actionsTaken: z
    .array(z.string().trim().min(1).max(400))
    .max(30)
    .optional()
    .default([]),
  nextSteps: z
    .array(z.string().trim().min(1).max(400))
    .max(30)
    .optional()
    .default([]),
  suggestedAccount: z.any().optional().nullable(),
  suggestedContacts: z.array(z.any()).max(50).optional().default([]),
  suggestedOpportunities: z.array(z.any()).max(50).optional().default([]),
});

const resolutionSchema = editableInteractionSchema.extend({
  sellerUserId: z.number().int().positive().optional().nullable(),
  assignCurrentUserAsOwnerSeller: z.boolean().optional().default(false),
  accountResolution: z
    .object({
      mode: z.enum(["link_existing", "create_new", "ignore"]),
      accountId: z.number().int().positive().optional().nullable(),
      draft: z
        .object({
          name: z.string().trim().min(2).max(180),
          website: z.string().trim().max(300).optional().default(""),
          phone: z.string().trim().max(40).optional().default(""),
          city: z.string().trim().max(120).optional().default(""),
          stateRegion: z.string().trim().max(120).optional().default(""),
          countryId: z.number().int().positive().optional().nullable(),
          description: z.string().max(10000).optional().default(""),
        })
        .optional(),
    })
    .optional()
    .default({ mode: "ignore" }),
  contactResolutions: z
    .array(
      z.object({
        suggestionId: z.string().trim().min(1).max(120),
        mode: z.enum(["link_existing", "create_new", "ignore"]),
        contactId: z.number().int().positive().optional().nullable(),
        draft: z
          .object({
            firstName: z.string().trim().min(1).max(120),
            lastName: z.string().trim().min(1).max(120),
            email: z.string().trim().max(190).optional().default(""),
            phone: z.string().trim().max(40).optional().default(""),
            mobile: z.string().trim().max(30).optional().default(""),
            positionTitle: z.string().trim().max(120).optional().default(""),
            department: z.string().trim().max(120).optional().default(""),
            countryId: z.number().int().positive().optional().nullable(),
            stateRegion: z.string().trim().max(120).optional().default(""),
            city: z.string().trim().max(120).optional().default(""),
          })
          .optional(),
      }),
    )
    .max(50)
    .optional()
    .default([]),
  opportunityResolutions: z
    .array(
      z.object({
        suggestionId: z.string().trim().min(1).max(120),
        mode: z.enum(["link_existing", "create_new", "ignore"]),
        opportunityId: z.number().int().positive().optional().nullable(),
        isPrimary: z.boolean().optional().default(false),
        draft: z
          .object({
            name: z.string().trim().min(2).max(180),
            contactId: z.number().int().positive().optional().nullable(),
            amountUsd: z.number().nonnegative().optional().nullable(),
            closeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            businessLineId: z.number().int().positive().optional().nullable(),
            sellerUserId: z.number().int().positive().optional().nullable(),
            presalesUserId: z.number().int().positive().optional().nullable(),
            summary: z.string().max(5000).optional().default(""),
          })
          .optional(),
      }),
    )
    .max(50)
    .optional()
    .default([]),
});

function isQualifiedLeadStatus(status) {
  return status === "lead_qualified";
}

function resolveLeadCommercialStatus({
  accountId,
  contactIds,
  sellerUserId,
  opportunityIds,
}) {
  if (!accountId || !Array.isArray(contactIds) || !contactIds.length) {
    return "created";
  }
  if (Array.isArray(opportunityIds) && opportunityIds.length) {
    if (!sellerUserId) {
      return "created";
    }
    return "lead_qualified";
  }
  if (sellerUserId) {
    return "lead_assigned";
  }
  return "lead_unassigned";
}

async function validateLinkedContactForAccount(contactId, accountId) {
  const rows = await query(
    `SELECT id
     FROM contacts
     WHERE id = ?
       AND account_id = ?
     LIMIT 1`,
    [Number(contactId), Number(accountId)],
  );
  return rows.length > 0;
}

async function validateLinkedOpportunityForAccount(opportunityId, accountId) {
  const rows = await query(
    `SELECT id
     FROM opportunities
     WHERE id = ?
       AND account_id = ?
     LIMIT 1`,
    [Number(opportunityId), Number(accountId)],
  );
  return rows.length > 0;
}

async function validateSellerOwnerForAccount(accountId, sellerUserId, conn = null) {
  const executor = conn || { query };
  const [rows] = conn
    ? await executor.query(
        `SELECT u.id
         FROM account_owners ao
         INNER JOIN users u ON u.id = ao.user_id
         INNER JOIN user_roles ur ON ur.user_id = u.id
         INNER JOIN roles r ON r.id = ur.role_id
         WHERE ao.account_id = ?
           AND ao.user_id = ?
           AND u.status = 'active'
           AND LOWER(TRIM(r.name)) = 'vendedor'
         LIMIT 1`,
        [Number(accountId), Number(sellerUserId)],
      )
    : [
        await executor.query(
          `SELECT u.id
           FROM account_owners ao
           INNER JOIN users u ON u.id = ao.user_id
           INNER JOIN user_roles ur ON ur.user_id = u.id
           INNER JOIN roles r ON r.id = ur.role_id
           WHERE ao.account_id = ?
             AND ao.user_id = ?
             AND u.status = 'active'
             AND LOWER(TRIM(r.name)) = 'vendedor'
           LIMIT 1`,
          [Number(accountId), Number(sellerUserId)],
        ),
      ];
  return rows.length > 0;
}

function parseJsonField(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
}

function getFormField(fields, key) {
  const value = fields?.[key];
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

function hasPermission(user, permission) {
  return user?.permissionSet?.has(permission);
}

function hasSellerRole(user) {
  return Array.isArray(user?.roles)
    ? user.roles.some(
        (role) => String(role?.name || "").trim().toLowerCase() === "vendedor",
      )
    : false;
}

function hasGlobalReadScope(user) {
  return hasPermission(user, "interacciones.read_all");
}

function normalizeForStorage(value) {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function buildInteractionPublicId() {
  return `int_${randomUUID().replace(/-/g, "")}`;
}

function buildDocumentPublicId() {
  return `doc_${randomUUID().replace(/-/g, "")}`;
}

function buildSuggestedInteractionTitleFromFiles(files) {
  const rawName = String(files?.[0]?.originalFilename || "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!rawName) return "Nueva interaccion";
  if (rawName.length <= 2) return "Interaccion cargada";
  return rawName.charAt(0).toUpperCase() + rawName.slice(1);
}

function buildSuggestedInteractionTitleFromSourceNotes(sourceNotes) {
  const text = String(sourceNotes || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return "Nueva interaccion";

  const suggested = text.slice(0, 80).trim();
  if (suggested.length <= 2) return "Interaccion cargada";
  return suggested.charAt(0).toUpperCase() + suggested.slice(1);
}

function applyOwnedAccountScope({ user, accountExpression, params }) {
  if (hasGlobalReadScope(user)) return "";
  params.push(Number(user.id));
  return `INNER JOIN account_owners ao_scope ON ao_scope.account_id = ${accountExpression} AND ao_scope.user_id = ?`;
}

async function loadAccessibleAccounts(user) {
  const params = [];
  const ownershipJoin = applyOwnedAccountScope({
    user,
    accountExpression: "a.id",
    params,
  });

  return query(
    `SELECT DISTINCT a.id, a.name, a.country_id, a.website, a.phone
     FROM accounts a
     ${ownershipJoin}
     ORDER BY a.name`,
    params,
  );
}

async function loadAccessibleContacts(user) {
  const params = [];
  const ownershipJoin = applyOwnedAccountScope({
    user,
    accountExpression: "c.account_id",
    params,
  });

  return query(
    `SELECT DISTINCT c.id,
            c.account_id,
            CONCAT(c.first_name, ' ', c.last_name) AS full_name,
            c.email,
            c.phone,
            c.mobile,
            c.position_title
     FROM contacts c
     ${ownershipJoin}
     ORDER BY full_name`,
    params,
  );
}

async function loadAccessibleOpportunities(user) {
  const params = [];
  const ownershipJoin = applyOwnedAccountScope({
    user,
    accountExpression: "o.account_id",
    params,
  });

  return query(
    `SELECT DISTINCT o.id, o.account_id, o.contact_id, o.name, o.amount_usd, o.close_date
     FROM opportunities o
     ${ownershipJoin}
     ORDER BY o.name`,
    params,
  );
}

async function loadBusinessLines() {
  return query(
    `SELECT id, code, name
     FROM opportunity_business_lines
     WHERE is_active = 1
     ORDER BY name`,
  );
}

async function loadSellerUsers() {
  return query(
    `SELECT DISTINCT u.id, u.full_name, u.email
     FROM users u
     INNER JOIN user_roles ur ON ur.user_id = u.id
     INNER JOIN roles r ON r.id = ur.role_id
     WHERE u.status = 'active'
       AND LOWER(TRIM(r.name)) = 'vendedor'
     ORDER BY u.full_name`,
  );
}

async function loadPresalesUsers() {
  return query(
    `SELECT DISTINCT u.id, u.full_name, u.email
     FROM users u
     INNER JOIN user_roles ur ON ur.user_id = u.id
     INNER JOIN roles r ON r.id = ur.role_id
     WHERE u.status = 'active'
       AND LOWER(TRIM(r.name)) = 'preventa'
     ORDER BY u.full_name`,
  );
}

async function loadSellerUsersByAccountIds(accountIds) {
  const uniqueAccountIds = Array.from(
    new Set(
      (Array.isArray(accountIds) ? accountIds : [])
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0),
    ),
  );

  if (!uniqueAccountIds.length) {
    return {};
  }

  const rows = await query(
    `SELECT ao.account_id, u.id, u.full_name, u.email
     FROM account_owners ao
     INNER JOIN users u ON u.id = ao.user_id
     INNER JOIN user_roles ur ON ur.user_id = u.id
     INNER JOIN roles r ON r.id = ur.role_id
     WHERE ao.account_id IN (${uniqueAccountIds.map(() => "?").join(", ")})
       AND u.status = 'active'
       AND LOWER(TRIM(r.name)) = 'vendedor'
     ORDER BY ao.account_id, u.full_name`,
    uniqueAccountIds,
  );

  return rows.reduce((accumulator, row) => {
    const accountId = String(Number(row.account_id));
    if (!accumulator[accountId]) {
      accumulator[accountId] = [];
    }
    accumulator[accountId].push({
      id: Number(row.id),
      full_name: row.full_name,
      email: row.email,
    });
    return accumulator;
  }, {});
}

async function loadAccessibleContext(user) {
  const [accounts, contacts, opportunities, businessLines, presalesUsers] =
    await Promise.all([
    loadAccessibleAccounts(user),
    loadAccessibleContacts(user),
    loadAccessibleOpportunities(user),
    loadBusinessLines(),
    loadPresalesUsers(),
  ]);
  const sellerUsersByAccountId = await loadSellerUsersByAccountIds(
    accounts.map((account) => account.id),
  );

  return {
    accounts,
    contacts,
    opportunities,
    businessLines,
    sellerUsersByAccountId,
    sellerUsers: [],
    presalesUsers,
  };
}

async function getIdByCode(tableName, code) {
  const rows = await query(
    `SELECT id
     FROM ${tableName}
     WHERE code = ?
     LIMIT 1`,
    [code],
  );
  return rows.length ? Number(rows[0].id) : null;
}

function resolveCreationStatusCode(user, createPermission, requestPermission) {
  if (hasPermission(user, createPermission)) {
    return "activada";
  }
  if (hasPermission(user, requestPermission)) {
    return "pendiente_activacion";
  }
  return null;
}

async function requireAccessibleInteractionOr404({ user, interactionId }) {
  const params = [];
  const ownershipJoin = hasGlobalReadScope(user)
    ? ""
    : "LEFT JOIN account_owners ao_scope ON ao_scope.account_id = i.account_id AND ao_scope.user_id = ?";
  if (!hasGlobalReadScope(user)) {
    params.push(Number(user.id));
  }
  params.push(Number(interactionId));
  if (!hasGlobalReadScope(user)) {
    params.push(Number(user.id));
  }

  const rows = await query(
    `SELECT i.id
     FROM interactions i
     ${ownershipJoin}
     WHERE i.id = ?
       AND (
         ${hasGlobalReadScope(user) ? "1 = 1" : "ao_scope.user_id IS NOT NULL OR i.created_by = ?"}
       )
     LIMIT 1`,
    params,
  );

  if (!rows.length) {
    return {
      ok: false,
      response: { status: 404, body: { message: "Interaccion no encontrada" } },
    };
  }
  return { ok: true };
}

async function fetchInteractionDocuments(interactionId) {
  const rows = await query(
    `SELECT d.public_id, d.original_file_name, d.mime_type, d.file_extension,
            d.byte_size, d.processing_status, d.processing_error, d.created_at,
            dc.extraction_status, dc.transcription_status, dc.detected_format,
            dc.raw_text, dc.normalized_text, dc.transcript_text, dc.content_summary,
            dc.page_count, dc.duration_seconds
     FROM documents d
     LEFT JOIN document_contents dc ON dc.document_id = d.id
     WHERE d.entity_type = 'interaction'
       AND d.entity_id = ?
       AND d.is_deleted = 0
     ORDER BY d.created_at ASC`,
    [interactionId],
  );

  return rows.map((row) => ({
    publicId: row.public_id,
    originalFileName: row.original_file_name,
    mimeType: row.mime_type,
    fileExtension: row.file_extension,
    byteSize: Number(row.byte_size || 0),
    processingStatus: row.processing_status || "uploaded",
    processingError: row.processing_error || "",
    extractionStatus: row.extraction_status || "pending",
    transcriptionStatus: row.transcription_status || "pending",
    detectedFormat: row.detected_format || "",
    rawText: row.raw_text || "",
    normalizedText: row.normalized_text || "",
    transcriptText: row.transcript_text || "",
    contentSummary: row.content_summary || "",
    pageCount: row.page_count === null ? null : Number(row.page_count),
    durationSeconds:
      row.duration_seconds === null ? null : Number(row.duration_seconds),
    createdAt: row.created_at,
  }));
}

async function fetchInteractionDetail(interactionId) {
  const rows = await query(
    `SELECT i.*, a.name AS account_name,
            po.name AS primary_opportunity_name,
            su.full_name AS seller_user_name,
            su.email AS seller_user_email,
            u1.full_name AS created_by_name,
            u2.full_name AS updated_by_name
     FROM interactions i
     LEFT JOIN accounts a ON a.id = i.account_id
     LEFT JOIN opportunities po ON po.id = i.primary_opportunity_id
     LEFT JOIN users su ON su.id = i.seller_user_id
     INNER JOIN users u1 ON u1.id = i.created_by
     INNER JOIN users u2 ON u2.id = i.updated_by
     WHERE i.id = ?
     LIMIT 1`,
    [interactionId],
  );
  if (!rows.length) return null;

  const row = rows[0];
  const [contacts, opportunities, documents] = await Promise.all([
    query(
      `SELECT c.id, c.account_id,
              CONCAT(c.first_name, ' ', c.last_name) AS full_name,
              c.email, c.phone, c.mobile, c.position_title
       FROM interaction_contact_links icl
       INNER JOIN contacts c ON c.id = icl.contact_id
       WHERE icl.interaction_id = ?
       ORDER BY full_name`,
      [interactionId],
    ),
    query(
      `SELECT o.id, o.account_id, o.contact_id, o.name, o.amount_usd, o.close_date,
              iol.is_primary
       FROM interaction_opportunity_links iol
       INNER JOIN opportunities o ON o.id = iol.opportunity_id
       WHERE iol.interaction_id = ?
       ORDER BY iol.is_primary DESC, o.name`,
      [interactionId],
    ),
    fetchInteractionDocuments(interactionId),
  ]);

  return {
    id: Number(row.id),
    publicId: row.public_id,
    title: row.title,
    sourceNotes: row.source_notes || "",
    summary: row.summary || "",
    analysisStatus: row.analysis_status,
    processingStatus: row.processing_status || "pending",
    warnings: parseJsonField(row.warnings_json, []),
    topics: parseJsonField(row.topics_json, []),
    actionsTaken: parseJsonField(row.actions_taken_json, []),
    nextSteps: parseJsonField(row.next_steps_json, []),
    suggestedAccount: parseJsonField(row.suggested_account_json, null),
    suggestedContacts: parseJsonField(row.suggested_contacts_json, []),
    suggestedOpportunities: parseJsonField(
      row.suggested_opportunities_json,
      [],
    ),
    accountId: row.account_id === null ? null : Number(row.account_id),
    accountName: row.account_name || "",
    primaryOpportunityId:
      row.primary_opportunity_id === null
        ? null
        : Number(row.primary_opportunity_id),
    primaryOpportunityName: row.primary_opportunity_name || "",
    sellerUserId:
      row.seller_user_id === null ? null : Number(row.seller_user_id),
    seller:
      row.seller_user_id === null
        ? null
        : {
            id: Number(row.seller_user_id),
            fullName: row.seller_user_name || "",
            email: row.seller_user_email || "",
          },
    contacts: contacts.map((contact) => ({
      id: Number(contact.id),
      accountId: Number(contact.account_id),
      fullName: contact.full_name,
      email: contact.email || "",
      phone: contact.phone || "",
      mobile: contact.mobile || "",
      positionTitle: contact.position_title || "",
    })),
    opportunities: opportunities.map((opportunity) => ({
      id: Number(opportunity.id),
      accountId: Number(opportunity.account_id),
      contactId:
        opportunity.contact_id === null ? null : Number(opportunity.contact_id),
      name: opportunity.name,
      amountUsd:
        opportunity.amount_usd === null ? null : Number(opportunity.amount_usd),
      closeDate: opportunity.close_date,
      isPrimary: Boolean(opportunity.is_primary),
    })),
    documents,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    analyzedAt: row.analyzed_at,
    resolvedAt: row.resolved_at,
    createdByName: row.created_by_name,
    updatedByName: row.updated_by_name,
  };
}

async function persistDocumentContent({
  conn,
  documentId,
  extracted,
  errorMessage,
}) {
  await conn.query(
    `INSERT INTO document_contents
       (document_id, extraction_status, transcription_status, detected_format,
        detected_language, page_count, duration_seconds, raw_text, normalized_text,
        structured_content_json, transcript_text, transcription_language,
        transcription_confidence, content_summary, extracted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3), NOW(3))
     ON DUPLICATE KEY UPDATE
       extraction_status = VALUES(extraction_status),
       transcription_status = VALUES(transcription_status),
       detected_format = VALUES(detected_format),
       page_count = VALUES(page_count),
       duration_seconds = VALUES(duration_seconds),
       raw_text = VALUES(raw_text),
       normalized_text = VALUES(normalized_text),
       structured_content_json = VALUES(structured_content_json),
       transcript_text = VALUES(transcript_text),
       transcription_language = VALUES(transcription_language),
       transcription_confidence = VALUES(transcription_confidence),
       content_summary = VALUES(content_summary),
       extracted_at = NOW(3),
       updated_at = NOW(3)`,
    [
      documentId,
      extracted.extractionStatus,
      extracted.transcriptionStatus,
      extracted.detectedFormat,
      extracted.pageCount,
      extracted.durationSeconds,
      extracted.rawText,
      extracted.normalizedText,
      extracted.structuredContentJson
        ? JSON.stringify(extracted.structuredContentJson)
        : null,
      extracted.transcriptText,
      extracted.transcriptionLanguage,
      extracted.transcriptionConfidence,
      errorMessage
        ? `${extracted.contentSummary || ""}${
            extracted.contentSummary ? " | " : ""
          }${errorMessage}`.trim()
        : extracted.contentSummary,
    ],
  );
}

async function extractFiles(files) {
  const extractedDocuments = [];

  for (const file of files) {
    const buffer = await readFile(file.filepath);
    const originalFileName = String(
      file.originalFilename || file.newFilename || "archivo",
    );
    const mimeType = String(file.mimetype || "application/octet-stream")
      .trim()
      .toLowerCase();
    const extension = String(
      path.extname(originalFileName || "") || "",
    ).toLowerCase();

    let extracted;
    let extractionError = "";
    try {
      extracted = await extractContentFromBuffer({
        buffer,
        mimeType,
        fileName: originalFileName,
        extension,
      });
    } catch (error) {
      extractionError = String(
        error?.message || "No fue posible extraer el contenido",
      );
      extracted = {
        extractionStatus: "failed",
        transcriptionStatus:
          extension === ".mp3" || extension === ".wav" || extension === ".m4a"
            ? "failed"
            : "pending",
        detectedFormat: extension.replace(/^\./, "") || mimeType || "unknown",
        rawText: "",
        normalizedText: "",
        structuredContentJson: null,
        transcriptText: "",
        transcriptionLanguage: null,
        transcriptionConfidence: null,
        durationSeconds: null,
        pageCount: null,
        contentSummary: "",
      };
    }

    extractedDocuments.push({
      buffer,
      file,
      originalFileName,
      mimeType,
      extension,
      extracted,
      extractionError,
    });
  }

  return extractedDocuments;
}

async function createInteractionDocuments({
  conn,
  interactionId,
  interactionPublicId,
  userId,
  extractedDocuments,
}) {
  const now = new Date();
  const created = [];

  for (const item of extractedDocuments) {
    const sha256 = createHash("sha256").update(item.buffer).digest("hex");
    const storageKey = buildStorageKey({
      entityType: "interaction",
      publicId: interactionPublicId,
      sha256,
      fileName: item.originalFileName,
      createdAt: now,
    });
    const stored = await storage.save({ buffer: item.buffer, storageKey });

    const [insertResult] = await conn.query(
      `INSERT INTO documents
         (public_id, upload_session_id, entity_type, entity_id, storage_provider,
          storage_bucket, storage_key, original_file_name, stored_file_name,
          mime_type, file_extension, byte_size, sha256, document_kind, source_label,
          processing_status, processing_error, duration_seconds, is_deleted,
          uploaded_by_user_id, created_at, updated_at)
       VALUES (?, NULL, 'interaction', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NOW(3), NOW(3))`,
      [
        buildDocumentPublicId(),
        interactionId,
        stored.storageProvider,
        stored.storageBucket,
        stored.storageKey,
        item.originalFileName,
        stored.storedFileName,
        item.mimeType,
        item.extension || null,
        Number(item.file.size || item.buffer.length || 0),
        sha256,
        item.extension.replace(/^\./, "") || null,
        "interaction_source",
        item.extractionError ? "failed" : "review_ready",
        item.extractionError || null,
        item.extracted.durationSeconds,
        Number(userId),
      ],
    );

    await persistDocumentContent({
      conn,
      documentId: Number(insertResult.insertId),
      extracted: item.extracted,
      errorMessage: item.extractionError,
    });
    created.push({ ...item, documentId: Number(insertResult.insertId) });
  }

  return created;
}

function buildStoredDocumentAnalysisInput(document) {
  return {
    normalizedText:
      document.normalizedText ||
      document.rawText ||
      document.transcriptText ||
      "",
    rawText: document.rawText || document.transcriptText || "",
    warnings: document.processingError ? [document.processingError] : [],
  };
}

function buildExtractedDocumentAnalysisInput(item) {
  return {
    normalizedText:
      item.extracted.normalizedText ||
      item.extracted.rawText ||
      item.extracted.transcriptText ||
      "",
    rawText: item.extracted.rawText || item.extracted.transcriptText || "",
    warnings: item.extractionError ? [item.extractionError] : [],
  };
}

async function buildInteractionAnalysis({
  user,
  title,
  sourceNotes,
  existingDocuments = [],
  extractedDocuments = [],
}) {
  const accessibleContext = await loadAccessibleContext(user);
  return analyzeInteractionEvidence({
    title,
    sourceNotes,
    documentExtractions: [
      ...existingDocuments.map(buildStoredDocumentAnalysisInput),
      ...extractedDocuments.map(buildExtractedDocumentAnalysisInput),
    ],
    accessibleContext,
  });
}

async function createAccountFromDraft(conn, user, draft) {
  const creationStatusCode = resolveCreationStatusCode(user, "cuentas.create");
  if (!creationStatusCode) {
    throw Object.assign(new Error("No autorizado para crear cuentas"), {
      status: 403,
    });
  }

  const [accountTypeId, economicSectorId, activationStatusId] =
    await Promise.all([
      getIdByCode("account_types", "prospecto"),
      getIdByCode("economic_sectors", "otros"),
      getIdByCode("account_activation_statuses", creationStatusCode),
    ]);
  const [countryRows] = await conn.query(
    `SELECT id
     FROM countries
     WHERE iso2 = 'MX'
     LIMIT 1`,
  );
  const countryId =
    draft.countryId || (countryRows.length ? Number(countryRows[0].id) : null);
  const now = new Date();
  const registrationCode =
    `INT-${Date.now()}-${Math.floor(Math.random() * 10000)}`.slice(0, 80);

  const [insertResult] = await conn.query(
    `INSERT INTO accounts
       (name, account_type_id, registration_code, phone, economic_sector_id, website,
        city, state_region, country_id, description, address_line, postal_code,
        activation_status_id, created_by, created_at, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)`,
    [
      draft.name,
      accountTypeId,
      registrationCode,
      draft.phone || null,
      economicSectorId,
      draft.website || null,
      draft.city || null,
      draft.stateRegion || null,
      countryId,
      draft.description || null,
      activationStatusId,
      Number(user.id),
      now,
      Number(user.id),
      now,
    ],
  );

  await conn.query(
    `INSERT INTO account_owners (account_id, user_id, assigned_at, assigned_by)
     VALUES (?, ?, ?, ?)`,
    [insertResult.insertId, Number(user.id), now, Number(user.id)],
  );

  return Number(insertResult.insertId);
}

async function createContactFromDraft(conn, user, accountId, draft) {
  const creationStatusCode = hasPermission(user, "contactos.create")
    ? "activado"
    : null;
  if (!creationStatusCode) {
    throw Object.assign(new Error("No autorizado para crear contactos"), {
      status: 403,
    });
  }

  const [
    purchaseParticipationId,
    relationshipTypeId,
    employmentStatusId,
    activationStatusId,
    accountQueryResult,
  ] = await Promise.all([
    getIdByCode("contact_purchase_participations", "ninguno"),
    getIdByCode("contact_relationship_types", "ninguno"),
    getIdByCode("contact_employment_statuses", "labora"),
    getIdByCode("contact_activation_statuses", creationStatusCode),
    conn.query(`SELECT country_id FROM accounts WHERE id = ? LIMIT 1`, [
      accountId,
    ]),
  ]);
  const [accountRows] = accountQueryResult;
  const accountCountryId = accountRows[0]?.country_id || null;
  const now = new Date();

  const [insertResult] = await conn.query(
    `INSERT INTO contacts
       (first_name, last_name, account_id, position_title, phone, phone_extension,
        mobile, email, department, country_id, state_region, city, address_line,
        postal_code, purchase_participation_id, relationship_type_id,
        employment_status_id, activation_status_id, manager_contact_id,
        influences_contact_id, created_by, created_at, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
    [
      draft.firstName,
      draft.lastName,
      accountId,
      draft.positionTitle || null,
      draft.phone || null,
      draft.mobile || null,
      draft.email || null,
      draft.department || null,
      draft.countryId || accountCountryId,
      draft.stateRegion || null,
      draft.city || null,
      purchaseParticipationId,
      relationshipTypeId,
      employmentStatusId,
      activationStatusId,
      Number(user.id),
      now,
      Number(user.id),
      now,
    ],
  );

  return Number(insertResult.insertId);
}

async function listSellerOwnersForAccount(conn, accountId) {
  const [rows] = await conn.query(
    `SELECT DISTINCT u.id, u.full_name, u.email
     FROM account_owners ao
     INNER JOIN users u ON u.id = ao.user_id
     INNER JOIN user_roles ur ON ur.user_id = u.id
     INNER JOIN roles r ON r.id = ur.role_id
     WHERE ao.account_id = ?
       AND u.status = 'active'
       AND LOWER(TRIM(r.name)) = 'vendedor'
     ORDER BY u.full_name`,
    [Number(accountId)],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    full_name: row.full_name,
    email: row.email,
  }));
}

async function ensureAccountOwner(conn, accountId, userId, assignedBy) {
  await conn.query(
    `INSERT INTO account_owners (account_id, user_id, assigned_at, assigned_by)
     SELECT ?, ?, NOW(3), ?
     WHERE NOT EXISTS (
       SELECT 1
       FROM account_owners
       WHERE account_id = ?
         AND user_id = ?
       LIMIT 1
     )`,
    [
      Number(accountId),
      Number(userId),
      Number(assignedBy),
      Number(accountId),
      Number(userId),
    ],
  );
}

async function createOpportunityFromDraft(conn, user, accountId, draft) {
  const creationStatusCode = resolveCreationStatusCode(
    user,
    "oportunidades.create",
  );
  if (!creationStatusCode) {
    throw Object.assign(new Error("No autorizado para crear oportunidades"), {
      status: 403,
    });
  }

  const [salesStageId, commercialStatusId, activationStatusId, businessLineId] =
    await Promise.all([
      getIdByCode("opportunity_sales_stages", "contacto_inicial"),
      getIdByCode("opportunity_commercial_statuses", "en_proceso"),
      getIdByCode("opportunity_activation_statuses", creationStatusCode),
      draft.businessLineId
        ? Promise.resolve(Number(draft.businessLineId))
        : getIdByCode("opportunity_business_lines", "otros"),
    ]);
  const now = new Date();

  const [insertResult] = await conn.query(
    `INSERT INTO opportunities
       (name, amount_usd, account_id, close_date, contact_id,
        sales_stage_id, business_line_id, seller_user_id, presales_user_id,
        activation_status_id, commercial_status_id, created_by, created_at,
        updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      draft.name,
      draft.amountUsd || 0,
      accountId,
      draft.closeDate,
      draft.contactId,
      salesStageId,
      businessLineId,
      draft.sellerUserId || Number(user.id),
      draft.presalesUserId || null,
      activationStatusId,
      commercialStatusId,
      Number(user.id),
      now,
      Number(user.id),
      now,
    ],
  );

  return Number(insertResult.insertId);
}

async function linkInteractionDocumentsToOpportunities(
  conn,
  interactionId,
  opportunityIds,
  userId,
) {
  if (!opportunityIds.length) return;
  const [documentRows] = await conn.query(
    `SELECT id
     FROM documents
     WHERE entity_type = 'interaction'
       AND entity_id = ?
       AND is_deleted = 0`,
    [interactionId],
  );
  for (const opportunityId of opportunityIds) {
    for (const document of documentRows) {
      const documentId = Number(document.id);
      await conn.query(
        `INSERT IGNORE INTO opportunity_document_links
           (opportunity_id, document_id, link_type, created_by_user_id, created_at)
         VALUES (?, ?, 'source_document', ?, NOW(3))`,
        [opportunityId, documentId, Number(userId)],
      );
    }
  }
}

router.use(async (_req, _res, next) => {
  try {
    await ensureInteractionPermissions();
    await ensureInteractionSchema();
    await ensureOpportunityDocumentSchema();
    next();
  } catch (error) {
    next(error);
  }
});

router.get(
  "/",
  requireAnyPermission(interactionReadPermissions),
  async (req, res) => {
    const page = Math.max(1, Number(req.query.page || 1) || 1);
    const pageSize = Math.min(
      50,
      Math.max(1, Number(req.query.pageSize || 10) || 10),
    );
    const queryText = String(req.query.query || "").trim();
    const statusFilter = String(req.query.status || "all").trim();
    const params = [];
    const ownershipJoin = hasGlobalReadScope(req.user)
      ? ""
      : "LEFT JOIN account_owners ao_scope ON ao_scope.account_id = i.account_id AND ao_scope.user_id = ?";
    if (!hasGlobalReadScope(req.user)) {
      params.push(Number(req.user.id));
    }

    const where = [];
    if (!hasGlobalReadScope(req.user)) {
      where.push("(ao_scope.user_id IS NOT NULL OR i.created_by = ?)");
      params.push(Number(req.user.id));
    }
    if (queryText) {
      where.push("(i.title LIKE ? OR i.summary LIKE ? OR a.name LIKE ?)");
      params.push(`%${queryText}%`, `%${queryText}%`, `%${queryText}%`);
    }
    if (statusFilter && statusFilter !== "all") {
      where.push("i.analysis_status = ?");
      params.push(statusFilter);
    }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const countRows = await query(
      `SELECT COUNT(*) AS total
       FROM interactions i
       LEFT JOIN accounts a ON a.id = i.account_id
       ${ownershipJoin}
       ${whereClause}`,
      params,
    );

    const rows = await query(
      `SELECT i.id, i.public_id, i.title, i.summary, i.analysis_status, i.account_id,
              i.primary_opportunity_id, i.created_at, a.name AS account_name,
              po.name AS primary_opportunity_name,
              COUNT(DISTINCT d.id) AS document_count
       FROM interactions i
       LEFT JOIN accounts a ON a.id = i.account_id
       LEFT JOIN opportunities po ON po.id = i.primary_opportunity_id
       LEFT JOIN documents d ON d.entity_type = 'interaction' AND d.entity_id = i.id AND d.is_deleted = 0
       ${ownershipJoin}
       ${whereClause}
       GROUP BY i.id, i.public_id, i.title, i.summary, i.analysis_status, i.account_id,
                i.primary_opportunity_id, i.created_at, a.name, po.name
       ORDER BY i.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    );

    return res.json({
      items: rows.map((row) => ({
        id: Number(row.id),
        publicId: row.public_id,
        title: row.title,
        summary: row.summary || "",
        analysisStatus: row.analysis_status,
        accountId: row.account_id === null ? null : Number(row.account_id),
        accountName: row.account_name || "",
        primaryOpportunityId:
          row.primary_opportunity_id === null
            ? null
            : Number(row.primary_opportunity_id),
        primaryOpportunityName: row.primary_opportunity_name || "",
        documentCount: Number(row.document_count || 0),
        createdAt: row.created_at,
      })),
      page,
      pageSize,
      total: Number(countRows[0]?.total || 0),
    });
  },
);

router.get(
  "/resolution-options",
  requireAnyPermission(interactionReadPermissions),
  async (req, res) => {
    const accountId = Number(req.query.accountId || 0);
    const accessibleContext = await loadAccessibleContext(req.user);
    const filteredContacts = accountId
      ? accessibleContext.contacts.filter(
          (contact) => Number(contact.account_id) === accountId,
        )
      : accessibleContext.contacts;
    const filteredOpportunities = accountId
      ? accessibleContext.opportunities.filter(
          (opportunity) => Number(opportunity.account_id) === accountId,
        )
      : accessibleContext.opportunities;
    const sellerUsers = accountId
      ? accessibleContext.sellerUsersByAccountId[String(accountId)] || []
      : [];
    return res.json({
      accounts: accessibleContext.accounts,
      contacts: filteredContacts,
      opportunities: filteredOpportunities,
      businessLines: accessibleContext.businessLines,
      sellerUsers,
      sellerUsersByAccountId: accessibleContext.sellerUsersByAccountId,
      presalesUsers: accessibleContext.presalesUsers,
    });
  },
);

router.post(
  "/",
  requireAnyPermission(interactionCreatePermissions),
  async (req, res) => {
    let parsedFiles = [];
    try {
      const { fields, files } = await parseMultipartFiles(req);
      parsedFiles = files;
      const sourceNotes = getFormField(fields, "sourceNotes");
      if (!files.length && !sourceNotes.trim()) {
        return res
          .status(400)
          .json({ message: "Debes subir al menos un archivo o pegar texto" });
      }

      const title =
        getFormField(fields, "title") ||
        (files.length
          ? buildSuggestedInteractionTitleFromFiles(files)
          : buildSuggestedInteractionTitleFromSourceNotes(sourceNotes));
      const extractedDocuments = await extractFiles(files);
      const analysis = await buildInteractionAnalysis({
        user: req.user,
        title,
        sourceNotes,
        extractedDocuments,
      });
      const interactionPublicId = buildInteractionPublicId();
      const now = new Date();

      const interactionId = await withTransaction(async (conn) => {
        const [insertResult] = await conn.query(
          `INSERT INTO interactions
             (public_id, title, source_notes, summary, analysis_status, processing_status,
              warnings_json, topics_json, actions_taken_json, next_steps_json,
              suggested_account_json, suggested_contacts_json, suggested_opportunities_json,
              created_by, updated_by, created_at, updated_at, analyzed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            interactionPublicId,
            title,
            sourceNotes || null,
            analysis.summary || null,
            "created",
            analysis.processingStatus,
            normalizeForStorage(analysis.warnings),
            normalizeForStorage(analysis.topics),
            normalizeForStorage(analysis.actionsTaken),
            normalizeForStorage(analysis.nextSteps),
            normalizeForStorage(analysis.suggestedAccount),
            normalizeForStorage(analysis.suggestedContacts),
            normalizeForStorage(analysis.suggestedOpportunities),
            Number(req.user.id),
            Number(req.user.id),
            now,
            now,
            analysis.processingStatus === "pending" ? null : now,
          ],
        );
        await createInteractionDocuments({
          conn,
          interactionId: Number(insertResult.insertId),
          interactionPublicId,
          userId: req.user.id,
          extractedDocuments,
        });
        return Number(insertResult.insertId);
      });

      await logAuditEvent({
        req,
        module: "interacciones",
        action: "created",
        entityType: "interaction",
        entityId: interactionId,
        detail: "Interaccion creada y analizada",
      });

      return res.status(201).json(await fetchInteractionDetail(interactionId));
    } catch (error) {
      return res.status(error.status || 500).json({
        message:
          error.status && error.status < 500
            ? error.message
            : "No fue posible crear la interaccion",
      });
    } finally {
      await cleanupTempFiles(parsedFiles).catch(() => undefined);
    }
  },
);

router.get(
  "/:interactionId",
  requireAnyPermission(interactionReadPermissions),
  async (req, res) => {
    const interactionId = Number(req.params.interactionId);
    if (!Number.isInteger(interactionId) || interactionId <= 0) {
      return res.status(400).json({ message: "Parametros invalidos" });
    }
    const access = await requireAccessibleInteractionOr404({
      user: req.user,
      interactionId,
    });
    if (!access.ok) {
      return res.status(access.response.status).json(access.response.body);
    }
    const detail = await fetchInteractionDetail(interactionId);
    return res.json(detail);
  },
);

router.post(
  "/:interactionId/documents",
  requireAnyPermission(interactionUpdatePermissions),
  async (req, res) => {
    let parsedFiles = [];
    try {
      const interactionId = Number(req.params.interactionId);
      if (!Number.isInteger(interactionId) || interactionId <= 0) {
        return res.status(400).json({ message: "Parametros invalidos" });
      }

      const access = await requireAccessibleInteractionOr404({
        user: req.user,
        interactionId,
      });
      if (!access.ok) {
        return res.status(access.response.status).json(access.response.body);
      }

      const detail = await fetchInteractionDetail(interactionId);
      if (!detail) {
        return res.status(404).json({ message: "Interaccion no encontrada" });
      }
      if (isQualifiedLeadStatus(detail.analysisStatus)) {
        return res.status(409).json({
          message:
            "No puedes agregar archivos a un lead calificado",
        });
      }

      const { files } = await parseMultipartFiles(req);
      parsedFiles = files;
      if (!files.length) {
        return res
          .status(400)
          .json({ message: "Debes subir al menos un archivo" });
      }

      const extractedDocuments = await extractFiles(files);
      const analysis = await buildInteractionAnalysis({
        user: req.user,
        title: detail.title,
        sourceNotes: detail.sourceNotes,
        existingDocuments: detail.documents,
        extractedDocuments,
      });

      await withTransaction(async (conn) => {
        await createInteractionDocuments({
          conn,
          interactionId,
          interactionPublicId: detail.publicId,
          userId: req.user.id,
          extractedDocuments,
        });

        await conn.query(
          `UPDATE interactions
           SET summary = ?, processing_status = ?, warnings_json = ?, topics_json = ?,
               actions_taken_json = ?, next_steps_json = ?, suggested_account_json = ?,
               suggested_contacts_json = ?, suggested_opportunities_json = ?, analyzed_at = NOW(3),
               updated_by = ?, updated_at = NOW(3)
           WHERE id = ?`,
          [
            analysis.summary || null,
            analysis.processingStatus,
            normalizeForStorage(analysis.warnings),
            normalizeForStorage(analysis.topics),
            normalizeForStorage(analysis.actionsTaken),
            normalizeForStorage(analysis.nextSteps),
            normalizeForStorage(analysis.suggestedAccount),
            normalizeForStorage(analysis.suggestedContacts),
            normalizeForStorage(analysis.suggestedOpportunities),
            Number(req.user.id),
            interactionId,
          ],
        );
      });

      await logAuditEvent({
        req,
        module: "interacciones",
        action: "updated",
        entityType: "interaction",
        entityId: interactionId,
        detail: "Interaccion creada",
      });

      return res.status(201).json(await fetchInteractionDetail(interactionId));
    } catch (error) {
      return res.status(error.status || 500).json({
        message:
          error.status && error.status < 500
            ? error.message
            : "No fue posible agregar archivos a la interaccion",
      });
    } finally {
      await cleanupTempFiles(parsedFiles).catch(() => undefined);
    }
  },
);

router.delete(
  "/:interactionId/documents/:documentPublicId",
  requireAnyPermission(interactionUpdatePermissions),
  async (req, res) => {
    const interactionId = Number(req.params.interactionId);
    if (!Number.isInteger(interactionId) || interactionId <= 0) {
      return res.status(400).json({ message: "Parametros invalidos" });
    }

    const access = await requireAccessibleInteractionOr404({
      user: req.user,
      interactionId,
    });
    if (!access.ok) {
      return res.status(access.response.status).json(access.response.body);
    }

    const interaction = await fetchInteractionDetail(interactionId);
    if (!interaction) {
      return res.status(404).json({ message: "Interaccion no encontrada" });
    }
    if (isQualifiedLeadStatus(interaction.analysisStatus)) {
      return res.status(409).json({
        message: "No puedes eliminar archivos de un lead calificado",
      });
    }

    const rows = await query(
      `SELECT id, storage_bucket, storage_key
       FROM documents
       WHERE public_id = ?
         AND entity_type = 'interaction'
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

    await logAuditEvent({
      req,
      module: "interacciones",
      action: "updated",
      entityType: "interaction",
      entityId: interactionId,
      detail: `Documento eliminado de la interaccion (${req.params.documentPublicId})`,
    });

    return res.json(await fetchInteractionDetail(interactionId));
  },
);

router.delete(
  "/:interactionId",
  requireAnyPermission(interactionUpdatePermissions),
  async (req, res) => {
    const interactionId = Number(req.params.interactionId);
    if (!Number.isInteger(interactionId) || interactionId <= 0) {
      return res.status(400).json({ message: "Parametros invalidos" });
    }

    const access = await requireAccessibleInteractionOr404({
      user: req.user,
      interactionId,
    });
    if (!access.ok) {
      return res.status(access.response.status).json(access.response.body);
    }

    const interaction = await fetchInteractionDetail(interactionId);
    if (!interaction) {
      return res.status(404).json({ message: "Interaccion no encontrada" });
    }
    if (isQualifiedLeadStatus(interaction.analysisStatus)) {
      return res.status(409).json({
        message: "No puedes eliminar un lead calificado",
      });
    }

    const documentRows = await query(
      `SELECT id, storage_bucket, storage_key
       FROM documents
       WHERE entity_type = 'interaction'
         AND entity_id = ?
         AND is_deleted = 0`,
      [interactionId],
    );

    for (const document of documentRows) {
      await storage.delete({
        storageKey: document.storage_key,
        storageBucket: document.storage_bucket,
      });
    }

    await withTransaction(async (conn) => {
      const documentIds = documentRows
        .map((row) => Number(row.id))
        .filter(Boolean);
      if (documentIds.length) {
        await conn.query(
          `DELETE FROM documents
           WHERE id IN (${documentIds.map(() => "?").join(", ")})`,
          documentIds,
        );
      }

      await conn.query(`DELETE FROM interactions WHERE id = ?`, [
        interactionId,
      ]);
    });

    await logAuditEvent({
      req,
      module: "interacciones",
      action: "deleted",
      entityType: "interaction",
      entityId: interactionId,
      detail: "Interaccion eliminada",
    });

    return res.json({ message: "Interacción eliminada" });
  },
);

router.put(
  "/:interactionId",
  requireAnyPermission(interactionUpdatePermissions),
  async (req, res) => {
    const interactionId = Number(req.params.interactionId);
    if (!Number.isInteger(interactionId) || interactionId <= 0) {
      return res.status(400).json({ message: "Parametros invalidos" });
    }
    const access = await requireAccessibleInteractionOr404({
      user: req.user,
      interactionId,
    });
    if (!access.ok) {
      return res.status(access.response.status).json(access.response.body);
    }
    const parsed = editableInteractionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    await query(
      `UPDATE interactions
       SET title = ?, source_notes = ?, summary = ?, topics_json = ?,
           actions_taken_json = ?, next_steps_json = ?, suggested_account_json = ?,
           suggested_contacts_json = ?, suggested_opportunities_json = ?,
           updated_by = ?, updated_at = NOW(3)
       WHERE id = ?`,
      [
        parsed.data.title,
        parsed.data.sourceNotes || null,
        parsed.data.summary || null,
        normalizeForStorage(parsed.data.topics),
        normalizeForStorage(parsed.data.actionsTaken),
        normalizeForStorage(parsed.data.nextSteps),
        normalizeForStorage(parsed.data.suggestedAccount),
        normalizeForStorage(parsed.data.suggestedContacts),
        normalizeForStorage(parsed.data.suggestedOpportunities),
        Number(req.user.id),
        interactionId,
      ],
    );

    await logAuditEvent({
      req,
      module: "interacciones",
      action: "updated",
      entityType: "interaction",
      entityId: interactionId,
      detail: "Interaccion actualizada",
    });

    return res.json(await fetchInteractionDetail(interactionId));
  },
);

router.post(
  "/:interactionId/analyze",
  requireAnyPermission(interactionAnalyzePermissions),
  async (req, res) => {
    const interactionId = Number(req.params.interactionId);
    if (!Number.isInteger(interactionId) || interactionId <= 0) {
      return res.status(400).json({ message: "Parametros invalidos" });
    }
    const access = await requireAccessibleInteractionOr404({
      user: req.user,
      interactionId,
    });
    if (!access.ok) {
      return res.status(access.response.status).json(access.response.body);
    }

    const detail = await fetchInteractionDetail(interactionId);
    const analysis = await buildInteractionAnalysis({
      user: req.user,
      title: detail.title,
      sourceNotes: detail.sourceNotes,
      existingDocuments: detail.documents,
    });

    await query(
      `UPDATE interactions
       SET summary = ?, processing_status = ?, warnings_json = ?, topics_json = ?,
           actions_taken_json = ?, next_steps_json = ?, suggested_account_json = ?,
           suggested_contacts_json = ?, suggested_opportunities_json = ?, analyzed_at = NOW(3),
           updated_by = ?, updated_at = NOW(3)
       WHERE id = ?`,
      [
        analysis.summary || null,
        analysis.processingStatus,
        normalizeForStorage(analysis.warnings),
        normalizeForStorage(analysis.topics),
        normalizeForStorage(analysis.actionsTaken),
        normalizeForStorage(analysis.nextSteps),
        normalizeForStorage(analysis.suggestedAccount),
        normalizeForStorage(analysis.suggestedContacts),
        normalizeForStorage(analysis.suggestedOpportunities),
        Number(req.user.id),
        interactionId,
      ],
    );

    await logAuditEvent({
      req,
      module: "interacciones",
      action: "analyzed",
      entityType: "interaction",
      entityId: interactionId,
      detail: "Interaccion reanalizada",
    });

    return res.json(await fetchInteractionDetail(interactionId));
  },
);

router.post(
  "/:interactionId/resolve",
  requireAnyPermission(interactionResolvePermissions),
  async (req, res) => {
    const interactionId = Number(req.params.interactionId);
    if (!Number.isInteger(interactionId) || interactionId <= 0) {
      return res.status(400).json({ message: "Parametros invalidos" });
    }
    const access = await requireAccessibleInteractionOr404({
      user: req.user,
      interactionId,
    });
    if (!access.ok) {
      return res.status(access.response.status).json(access.response.body);
    }

    const parsed = resolutionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const options = await loadAccessibleContext(req.user);
    const detail = await fetchInteractionDetail(interactionId);

    try {
      const result = await withTransaction(async (conn) => {
        let resolvedAccountId = null;
        const linkedContactIds = [];
        const resolvedOpportunityIds = [];

        if (parsed.data.accountResolution.mode === "link_existing") {
          resolvedAccountId = Number(
            parsed.data.accountResolution.accountId || 0,
          );
        } else if (parsed.data.accountResolution.mode === "create_new") {
          resolvedAccountId = await createAccountFromDraft(
            conn,
            req.user,
            parsed.data.accountResolution.draft,
          );
        }

        const contactsBySuggestionId = new Map();
        for (const resolution of parsed.data.contactResolutions) {
          if (resolution.mode === "ignore") continue;
          if (!resolvedAccountId) {
            throw Object.assign(
              new Error("Debes vincular una cuenta antes de vincular contactos"),
              { status: 400 },
            );
          }
          let contactId = null;
          if (resolution.mode === "link_existing") {
            contactId = Number(resolution.contactId || 0);
            const belongsToAccount = await validateLinkedContactForAccount(
              contactId,
              resolvedAccountId,
            );
            if (!belongsToAccount) {
              throw Object.assign(
                new Error(
                  "Cada contacto vinculado debe pertenecer a la cuenta del lead",
                ),
                { status: 400 },
              );
            }
          } else if (resolution.mode === "create_new") {
            contactId = await createContactFromDraft(
              conn,
              req.user,
              resolvedAccountId,
              resolution.draft,
            );
          }
          if (contactId) {
            linkedContactIds.push(contactId);
            contactsBySuggestionId.set(resolution.suggestionId, contactId);
          }
        }

        const hasMinimumCommercialLinks = Boolean(
          resolvedAccountId && linkedContactIds.length,
        );

        let assignedSellerUserId = parsed.data.sellerUserId
          ? Number(parsed.data.sellerUserId)
          : null;

        if (
          parsed.data.assignCurrentUserAsOwnerSeller &&
          !assignedSellerUserId &&
          hasSellerRole(req.user)
        ) {
          assignedSellerUserId = Number(req.user.id);
        }

        if (assignedSellerUserId && !hasMinimumCommercialLinks) {
          throw Object.assign(
            new Error(
              "Debes vincular cuenta y al menos un contacto antes de asignar vendedor",
            ),
            { status: 400 },
          );
        }

        if (assignedSellerUserId) {
          if (
            Number(assignedSellerUserId) === Number(req.user.id) &&
            parsed.data.assignCurrentUserAsOwnerSeller
          ) {
            if (!hasSellerRole(req.user)) {
              throw Object.assign(
                new Error(
                  "Solo un usuario con rol de vendedor puede asignarse como owner vendedor",
                ),
                { status: 400 },
              );
            }

            const currentSellerOwners = await listSellerOwnersForAccount(
              conn,
              resolvedAccountId,
            );
            const currentUserAlreadyOwner = currentSellerOwners.some(
              (sellerOwner) => Number(sellerOwner.id) === Number(req.user.id),
            );

            if (!currentUserAlreadyOwner && currentSellerOwners.length > 0) {
              throw Object.assign(
                new Error(
                  "La cuenta ya tiene owners vendedores; debes seleccionar uno de ellos",
                ),
                { status: 400 },
              );
            }

            if (!currentUserAlreadyOwner) {
              await ensureAccountOwner(
                conn,
                resolvedAccountId,
                req.user.id,
                req.user.id,
              );
            }
          }

          const isValidSellerOwner = await validateSellerOwnerForAccount(
            resolvedAccountId,
            assignedSellerUserId,
            conn,
          );
          if (!isValidSellerOwner) {
            throw Object.assign(
              new Error(
                "El vendedor asignado debe ser uno de los owners vendedores de la cuenta",
              ),
              { status: 400 },
            );
          }
        }

        let primaryOpportunityId = null;
        const effectiveOpportunityResolutions =
          parsed.data.opportunityResolutions.filter(
            (resolution) => resolution.mode !== "ignore",
          );

        if (effectiveOpportunityResolutions.length && !hasMinimumCommercialLinks) {
          throw Object.assign(
            new Error(
              "Debes vincular cuenta y al menos un contacto antes de vincular una oportunidad",
            ),
            { status: 400 },
          );
        }

        if (effectiveOpportunityResolutions.length && !assignedSellerUserId) {
          throw Object.assign(
            new Error(
              "Debes asignar un vendedor antes de vincular una oportunidad",
            ),
            { status: 400 },
          );
        }

        const explicitPrimary = effectiveOpportunityResolutions.find(
          (resolution) => resolution.isPrimary,
        );

        for (const resolution of effectiveOpportunityResolutions) {
          let opportunityId = null;
          if (resolution.mode === "link_existing") {
            opportunityId = Number(resolution.opportunityId || 0);
            const belongsToAccount = await validateLinkedOpportunityForAccount(
              opportunityId,
              resolvedAccountId,
            );
            if (!belongsToAccount) {
              throw Object.assign(
                new Error(
                  "Cada oportunidad vinculada debe pertenecer a la cuenta del lead",
                ),
                { status: 400 },
              );
            }
          } else if (resolution.mode === "create_new") {
            const suggestion = (parsed.data.suggestedOpportunities || []).find(
              (item) => item?.suggestionId === resolution.suggestionId,
            );
            const resolvedContactId =
              resolution.draft?.contactId ||
              contactsBySuggestionId.get(suggestion?.contactSuggestionId) ||
              linkedContactIds[0] ||
              null;
            const defaultDraft = buildDefaultOpportunityDraft({
              suggestion,
              resolvedAccountId,
              resolvedContactId,
              businessLines: options.businessLines,
              sellerUsers: options.sellerUsers,
              presalesUsers: options.presalesUsers,
              currentUserId: Number(req.user.id),
            });
            const effectiveDraft = {
              ...defaultDraft,
              ...(resolution.draft || {}),
              accountId: resolvedAccountId,
              contactId: resolution.draft?.contactId || defaultDraft.contactId,
              businessLineId:
                resolution.draft?.businessLineId || defaultDraft.businessLineId,
              sellerUserId: assignedSellerUserId,
              presalesUserId:
                resolution.draft?.presalesUserId || defaultDraft.presalesUserId,
            };
            if (!effectiveDraft.contactId) {
              throw Object.assign(
                new Error(
                  "Cada oportunidad creada desde interacciones debe seleccionar un contacto",
                ),
                { status: 400 },
              );
            }
            if (
              !effectiveDraft.businessLineId ||
              !effectiveDraft.sellerUserId
            ) {
              throw Object.assign(
                new Error(
                  "Cada oportunidad creada desde leads debe seleccionar linea de negocio y vendedor",
                ),
                { status: 400 },
              );
            }
            opportunityId = await createOpportunityFromDraft(
              conn,
              req.user,
              resolvedAccountId,
              effectiveDraft,
            );
          }

          if (opportunityId) {
            resolvedOpportunityIds.push({
              id: opportunityId,
              isPrimary:
                resolution.isPrimary ||
                (!explicitPrimary && primaryOpportunityId === null),
            });
            if (
              resolution.isPrimary ||
              (!explicitPrimary && primaryOpportunityId === null)
            ) {
              primaryOpportunityId = opportunityId;
            }
          }
        }

        const leadStatus = resolveLeadCommercialStatus({
          accountId: resolvedAccountId,
          contactIds: linkedContactIds,
          sellerUserId: assignedSellerUserId,
          opportunityIds: resolvedOpportunityIds.map(
            (opportunity) => opportunity.id,
          ),
        });

        await conn.query(
          `UPDATE interactions
           SET title = ?, source_notes = ?, summary = ?, analysis_status = ?,
               warnings_json = ?, topics_json = ?, actions_taken_json = ?, next_steps_json = ?,
               suggested_account_json = ?, suggested_contacts_json = ?, suggested_opportunities_json = ?,
               account_id = ?, primary_opportunity_id = ?, seller_user_id = ?,
               resolved_at = ?,
               updated_by = ?, updated_at = NOW(3)
           WHERE id = ?`,
          [
            parsed.data.title,
            parsed.data.sourceNotes || null,
            parsed.data.summary || null,
            leadStatus,
            normalizeForStorage(detail.warnings),
            normalizeForStorage(parsed.data.topics),
            normalizeForStorage(parsed.data.actionsTaken),
            normalizeForStorage(parsed.data.nextSteps),
            normalizeForStorage(parsed.data.suggestedAccount),
            normalizeForStorage(parsed.data.suggestedContacts),
            normalizeForStorage(parsed.data.suggestedOpportunities),
            resolvedAccountId,
            primaryOpportunityId,
            assignedSellerUserId,
            leadStatus === "lead_qualified" ? new Date() : null,
            Number(req.user.id),
            interactionId,
          ],
        );

        await conn.query(
          `DELETE FROM interaction_contact_links WHERE interaction_id = ?`,
          [interactionId],
        );
        for (const contactId of linkedContactIds) {
          await conn.query(
            `INSERT INTO interaction_contact_links (interaction_id, contact_id, created_at)
             VALUES (?, ?, NOW(3))`,
            [interactionId, contactId],
          );
        }

        await conn.query(
          `DELETE FROM interaction_opportunity_links WHERE interaction_id = ?`,
          [interactionId],
        );
        for (const opportunity of resolvedOpportunityIds) {
          await conn.query(
            `INSERT INTO interaction_opportunity_links (interaction_id, opportunity_id, is_primary, created_at)
             VALUES (?, ?, ?, NOW(3))`,
            [interactionId, opportunity.id, opportunity.isPrimary ? 1 : 0],
          );
        }

        await linkInteractionDocumentsToOpportunities(
          conn,
          interactionId,
          resolvedOpportunityIds.map((opportunity) => opportunity.id),
          req.user.id,
        );

        return {
          leadStatus,
          resolvedAccountId,
          assignedSellerUserId,
          primaryOpportunityId,
          opportunityIds: resolvedOpportunityIds.map(
            (opportunity) => opportunity.id,
          ),
        };
      });

      await logAuditEvent({
        req,
        module: "interacciones",
        action: "updated",
        entityType: "interaction",
        entityId: interactionId,
        detail: "Lead actualizado",
        after: result,
      });

      return res.json(await fetchInteractionDetail(interactionId));
    } catch (error) {
      return res.status(error.status || 500).json({
        message:
          error.status && error.status < 500
            ? error.message
            : "No fue posible guardar el lead",
      });
    }
  },
);

export default router;
