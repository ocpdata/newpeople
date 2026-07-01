import { createHash, randomUUID } from "node:crypto";
import express from "express";
import { z } from "zod";
import { requireAnyPermission } from "./auth.js";
import { query, withTransaction } from "./db.js";
import { logAuditEvent } from "./audit.js";
import { parseMultipartFiles, cleanupTempFiles } from "./opportunity-documents/service.js";

const landingReadPermissions = ["landing.read"];
const landingCreatePermissions = ["landing.create"];
const landingUpdatePermissions = ["landing.update"];
const landingPublishPermissions = ["landing.publish"];
const landingSubmissionsReadPermissions = ["landing.submissions.read"];
const landingSubmissionsReprocessPermissions = ["landing.submissions.reprocess"];

const SOURCE_TYPES = new Set(["ai", "html_upload", "url_import_once", "manual_edit"]);
const FIELD_TYPES = new Set([
  "text",
  "email",
  "phone",
  "textarea",
  "select",
  "radio",
  "checkbox",
  "hidden",
]);
const CRM_ENTITY_TYPES = new Set(["lead", "account", "contact", "meta"]);
const CRM_STATUS_PENDING = "pending";
const CRM_STATUS_PROCESSED = "processed";
const CRM_STATUS_FAILED = "failed";
const CRM_STATUS_DUPLICATE_REVIEW = "duplicate_review";

const updateDraftSchema = z.object({
  html_content: z.string().trim().min(1).max(2_000_000).optional(),
  form_schema: z.any().optional(),
  publish_notes: z.string().trim().max(500).optional().nullable(),
});

const upsertLandingSchema = z.object({
  eventName: z.string().trim().min(1).max(180),
  slug: z
    .string()
    .trim()
    .min(3)
    .max(120)
    .regex(/^[a-z0-9-]+$/),
  source_type: z.enum(["ai", "html_upload", "url_import_once", "manual_edit"]),
  initial_prompt: z.string().trim().max(4000).optional().nullable(),
  html_content: z.string().trim().max(2_000_000).optional().nullable(),
  source_url: z.string().trim().url().max(1000).optional().nullable(),
  form_schema: z.any(),
});

const importUrlSchema = z.object({
  source_url: z.string().trim().url().max(1000),
});

const publishSchema = z.object({
  version_id: z.number().int().positive(),
});

const publicSubmitSchema = z.object({
  form_data: z.record(z.any()),
  context: z
    .object({
      referrer_url: z.string().trim().max(1000).optional().nullable(),
      page_url: z.string().trim().max(1000).optional().nullable(),
    })
    .optional()
    .default({}),
});

const reprocessSchema = z.object({
  force: z.boolean().optional().default(false),
});

const privateRouter = express.Router();
const publicRouter = express.Router();

function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePhone(value) {
  return String(value || "")
    .trim()
    .replace(/[^\d+]/g, "")
    .slice(0, 30);
}

function normalizeCompanyName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b(s\.?a\.?\s*de\s*c\.?v\.?|s\.?a\.?|llc|inc|corp)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeGenericText(value, max = 255) {
  return String(value || "").trim().slice(0, max);
}

function inferFieldMap(formSchema = {}) {
  const fields = Array.isArray(formSchema?.fields) ? formSchema.fields : [];
  const map = new Map();
  for (const field of fields) {
    const key = String(field?.key || "").trim();
    if (!key) continue;
    map.set(key, field);
  }
  return map;
}

function validateFormSchema(formSchema) {
  const schema = formSchema && typeof formSchema === "object" ? formSchema : null;
  if (!schema) {
    throw Object.assign(new Error("form_schema es obligatorio"), { status: 400 });
  }

  const fields = Array.isArray(schema.fields) ? schema.fields : [];
  if (!fields.length) {
    throw Object.assign(new Error("El formulario debe tener al menos un campo"), {
      status: 400,
    });
  }
  if (fields.length > 50) {
    throw Object.assign(new Error("El formulario no puede tener mas de 50 campos"), {
      status: 400,
    });
  }

  const keySet = new Set();
  let hasContactEmailOrPhone = false;
  for (const field of fields) {
    const key = String(field?.key || "").trim();
    const type = String(field?.type || "").trim();
    const crmEntity = String(field?.crm_map?.entity || "").trim();
    const crmField = String(field?.crm_map?.field || "").trim();

    if (!key || !/^[a-z0-9_]{2,60}$/.test(key)) {
      throw Object.assign(new Error(`Campo invalido: key (${key || "vacio"})`), {
        status: 400,
      });
    }
    if (keySet.has(key)) {
      throw Object.assign(new Error(`Campo duplicado en form_schema: ${key}`), {
        status: 400,
      });
    }
    keySet.add(key);

    if (!FIELD_TYPES.has(type)) {
      throw Object.assign(new Error(`Tipo de campo no soportado: ${type}`), {
        status: 400,
      });
    }

    if (["select", "radio"].includes(type)) {
      const options = Array.isArray(field?.options) ? field.options : [];
      if (!options.length) {
        throw Object.assign(
          new Error(`El campo ${key} requiere opciones para tipo ${type}`),
          { status: 400 },
        );
      }
    }

    if (!CRM_ENTITY_TYPES.has(crmEntity)) {
      throw Object.assign(
        new Error(`crm_map.entity invalido en campo ${key}: ${crmEntity}`),
        { status: 400 },
      );
    }

    if (crmEntity === "contact" && ["email", "phone", "mobile"].includes(crmField)) {
      hasContactEmailOrPhone = true;
    }
  }

  if (!hasContactEmailOrPhone) {
    throw Object.assign(
      new Error("El formulario debe mapear al menos un campo a contact.email o contact.phone/mobile"),
      { status: 400 },
    );
  }

  return schema;
}

function normalizeSubmissionPayload(formData = {}, formSchema = {}) {
  const fields = Array.isArray(formSchema?.fields) ? formSchema.fields : [];
  const normalized = {
    contact: {},
    account: {},
    lead: {},
    meta: {},
  };

  for (const field of fields) {
    const key = String(field?.key || "").trim();
    const entity = String(field?.crm_map?.entity || "").trim();
    const targetField = String(field?.crm_map?.field || "").trim();
    if (!key || !entity || !targetField) continue;

    const rawValue = formData?.[key];
    if (rawValue === undefined || rawValue === null) continue;

    let value = rawValue;
    if (targetField === "email") {
      value = normalizeEmail(rawValue);
    } else if (["phone", "mobile"].includes(targetField)) {
      value = normalizePhone(rawValue);
    } else if (targetField === "name") {
      value = normalizeCompanyName(rawValue);
    } else {
      value = normalizeGenericText(rawValue, 500);
    }

    if (String(value || "").trim() === "") continue;
    normalized[entity][targetField] = value;
  }

  return normalized;
}

function buildLandingCaptureScript(slug) {
  const safeSlug = String(slug || "").trim();
  return `
<script>
(function(){
  try {
    var form = document.querySelector('form[data-landing-form]') || document.querySelector('form');
    if (!form) return;

    form.addEventListener('submit', async function(event){
      event.preventDefault();
      var elements = Array.from(form.elements || []);
      var formData = {};
      elements.forEach(function(el){
        if (!el || !el.name) return;
        if (el.type === 'checkbox') {
          formData[el.name] = Boolean(el.checked);
          return;
        }
        if (el.type === 'radio') {
          if (el.checked) formData[el.name] = el.value;
          return;
        }
        formData[el.name] = el.value;
      });

      if (!Object.prototype.hasOwnProperty.call(formData, 'hp_field')) {
        formData.hp_field = '';
      }

      var submitButton = form.querySelector('[type="submit"]');
      if (submitButton) submitButton.disabled = true;

      var response = await fetch('/api/public/landing/v1/${safeSlug}/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          form_data: formData,
          context: {
            referrer_url: document.referrer || null,
            page_url: window.location.href || null
          }
        })
      });

      if (submitButton) submitButton.disabled = false;

      if (response.ok) {
        var payload = await response.json().catch(function(){ return {}; });
        var successMessage = (payload && payload.message) || 'Gracias por registrarte';
        window.alert(successMessage);
        return;
      }

      window.alert('No fue posible enviar el formulario. Intenta de nuevo.');
    });
  } catch (error) {
    console.error('landing submit error', error);
  }
})();
</script>
`;
}

function renderLandingHtml(html, slug) {
  const sourceHtml = String(html || "");
  const script = buildLandingCaptureScript(slug);
  if (sourceHtml.toLowerCase().includes("</body>")) {
    return sourceHtml.replace(/<\/body>/i, `${script}</body>`);
  }
  return `${sourceHtml}\n${script}`;
}

function hasPermission(user, permission) {
  return Boolean(user?.permissionSet?.has(permission));
}

async function loadLandingPageById(landingPageId) {
  const rows = await query(
    `SELECT lp.id, lp.event_id, lp.event_name, lp.slug, lp.status, lp.current_version_id,
            lp.created_by, lp.updated_by, lp.created_at, lp.updated_at
     FROM landing_pages lp
     WHERE lp.id = ?
     LIMIT 1`,
    [Number(landingPageId)],
  );
  return rows[0] || null;
}

async function loadLandingVersionById(landingPageId, versionId) {
  const rows = await query(
    `SELECT lv.*
     FROM landing_page_versions lv
     WHERE lv.id = ? AND lv.landing_page_id = ?
     LIMIT 1`,
    [Number(versionId), Number(landingPageId)],
  );
  return rows[0] || null;
}

async function parseFormSchemaFromField(formSchemaRaw) {
  if (!formSchemaRaw) {
    throw Object.assign(new Error("form_schema es obligatorio"), { status: 400 });
  }
  try {
    const parsed = JSON.parse(String(formSchemaRaw));
    return validateFormSchema(parsed);
  } catch (error) {
    if (error?.status) throw error;
    throw Object.assign(new Error("form_schema no es JSON valido"), { status: 400 });
  }
}

async function fetchUrlHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
    });
    if (!response.ok) {
      throw Object.assign(new Error(`No fue posible importar URL (${response.status})`), {
        status: 422,
      });
    }
    const html = await response.text();
    if (!html || html.length > 2_000_000) {
      throw Object.assign(new Error("El HTML importado es vacio o excede el limite"), {
        status: 422,
      });
    }
    return html;
  } finally {
    clearTimeout(timeout);
  }
}

async function getCatalogIdByCode(tableName, code) {
  const rows = await query(
    `SELECT id FROM ${tableName} WHERE code = ? LIMIT 1`,
    [String(code || "").trim()],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

async function resolveCountryId() {
  const rows = await query(`SELECT id FROM countries WHERE iso2 = 'MX' LIMIT 1`);
  return rows[0] ? Number(rows[0].id) : null;
}

function buildRegistrationCode(prefix = "LND") {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`.slice(0, 80);
}

async function resolveOrCreateAccount({ normalizedPayload, actorUserId }) {
  const accountName = normalizeCompanyName(
    normalizedPayload?.account?.name || normalizedPayload?.contact?.company_name || "",
  );
  if (!accountName) {
    return null;
  }

  const existing = await query(
    `SELECT id
     FROM accounts
     WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))
     ORDER BY id ASC
     LIMIT 2`,
    [accountName],
  );
  if (existing.length > 1) {
    return { duplicateReview: true };
  }
  if (existing.length === 1) {
    return { accountId: Number(existing[0].id), action: "match_update" };
  }

  const [accountTypeId, economicSectorId, activationStatusId, countryId] = await Promise.all([
    getCatalogIdByCode("account_types", "prospecto").then((value) => value || getCatalogIdByCode("account_types", "cliente_potencial")),
    getCatalogIdByCode("economic_sectors", "otros"),
    getCatalogIdByCode("account_activation_statuses", "activada"),
    resolveCountryId(),
  ]);

  if (!accountTypeId || !economicSectorId || !activationStatusId || !countryId) {
    return { error: "No fue posible resolver catalogos para crear cuenta" };
  }

  const now = new Date();
  const insertResult = await query(
    `INSERT INTO accounts
      (name, account_type_id, registration_code, phone, economic_sector_id, website,
       city, state_region, country_id, description, address_line, postal_code,
       activation_status_id, created_by, created_at, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)`,
    [
      accountName,
      accountTypeId,
      buildRegistrationCode("LND"),
      normalizedPayload?.account?.phone || null,
      economicSectorId,
      normalizedPayload?.account?.website || null,
      normalizedPayload?.account?.city || null,
      normalizedPayload?.account?.state_region || null,
      countryId,
      normalizedPayload?.lead?.notes || null,
      activationStatusId,
      Number(actorUserId),
      now,
      Number(actorUserId),
      now,
    ],
  );

  const accountId = Number(insertResult.insertId || 0);
  if (!accountId) {
    return { error: "No fue posible crear cuenta" };
  }

  await query(
    `INSERT INTO account_owners (account_id, user_id, assigned_at, assigned_by)
     SELECT ?, ?, NOW(3), ?
     WHERE NOT EXISTS (
       SELECT 1 FROM account_owners WHERE account_id = ? AND user_id = ?
     )`,
    [accountId, Number(actorUserId), Number(actorUserId), accountId, Number(actorUserId)],
  ).catch(() => undefined);

  return { accountId, action: "create" };
}

async function resolveOrCreateContact({ normalizedPayload, accountId, actorUserId }) {
  const email = normalizeEmail(normalizedPayload?.contact?.email || "");
  const mobile = normalizePhone(normalizedPayload?.contact?.mobile || normalizedPayload?.contact?.phone || "");

  if (email) {
    const rows = await query(
      `SELECT id, account_id
       FROM contacts
       WHERE LOWER(TRIM(email)) = ?
       ORDER BY id ASC
       LIMIT 2`,
      [email],
    );

    if (rows.length > 1) {
      return { duplicateReview: true };
    }

    if (rows.length === 1) {
      const contactId = Number(rows[0].id);
      await query(
        `UPDATE contacts
         SET phone = COALESCE(NULLIF(phone, ''), ?),
             mobile = COALESCE(NULLIF(mobile, ''), ?),
             position_title = COALESCE(NULLIF(position_title, ''), ?),
             department = COALESCE(NULLIF(department, ''), ?),
             updated_by = ?,
             updated_at = NOW(3)
         WHERE id = ?`,
        [
          normalizedPayload?.contact?.phone || null,
          mobile || null,
          normalizedPayload?.contact?.position_title || null,
          normalizedPayload?.contact?.department || null,
          Number(actorUserId),
          contactId,
        ],
      ).catch(() => undefined);

      return { contactId, action: "match_update" };
    }
  }

  if (!accountId) {
    return { error: "No fue posible crear contacto sin cuenta asociada" };
  }

  const firstName = normalizeGenericText(normalizedPayload?.contact?.first_name || "Prospecto", 120);
  const lastName = normalizeGenericText(normalizedPayload?.contact?.last_name || "Landing", 120);

  const [purchaseParticipationId, relationshipTypeId, hierarchyLevelId, influenceLevelId, employmentStatusId, activationStatusId, countryId] =
    await Promise.all([
      getCatalogIdByCode("contact_purchase_participations", "ninguno"),
      getCatalogIdByCode("contact_relationship_types", "media").then((value) => value || getCatalogIdByCode("contact_relationship_types", "ninguno")),
      getCatalogIdByCode("contact_hierarchy_levels", "usuario"),
      getCatalogIdByCode("contact_influence_levels", "media"),
      getCatalogIdByCode("contact_employment_statuses", "labora"),
      getCatalogIdByCode("contact_activation_statuses", "activado"),
      resolveCountryId(),
    ]);

  if (
    !purchaseParticipationId ||
    !relationshipTypeId ||
    !hierarchyLevelId ||
    !influenceLevelId ||
    !employmentStatusId ||
    !activationStatusId
  ) {
    return { error: "No fue posible resolver catalogos para crear contacto" };
  }

  const now = new Date();
  const insertResult = await query(
    `INSERT INTO contacts
      (first_name, last_name, account_id, position_title, phone, phone_extension,
       mobile, email, department, country_id, state_region, city, address_line,
       postal_code, purchase_participation_id, relationship_type_id,
       hierarchy_level_id, influence_level_id, employment_status_id,
       activation_status_id, manager_contact_id, influences_contact_id,
       created_by, created_at, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
    [
      firstName,
      lastName,
      Number(accountId),
      normalizedPayload?.contact?.position_title || null,
      normalizedPayload?.contact?.phone || null,
      mobile || null,
      email || null,
      normalizedPayload?.contact?.department || null,
      countryId || null,
      normalizedPayload?.contact?.state_region || null,
      normalizedPayload?.contact?.city || null,
      purchaseParticipationId,
      relationshipTypeId,
      hierarchyLevelId,
      influenceLevelId,
      employmentStatusId,
      activationStatusId,
      Number(actorUserId),
      now,
      Number(actorUserId),
      now,
    ],
  );

  const contactId = Number(insertResult.insertId || 0);
  if (!contactId) {
    return { error: "No fue posible crear contacto" };
  }

  return { contactId, action: "create" };
}

async function resolveOrCreateLead({
  submissionId,
  eventId,
  slug,
  accountId,
  contactId,
  normalizedPayload,
  actorUserId,
}) {
  const dedupRows = await query(
    `SELECT i.id
     FROM interactions i
     LEFT JOIN interaction_contact_links icl ON icl.interaction_id = i.id
     WHERE i.account_id <=> ?
       AND icl.contact_id <=> ?
       AND i.created_at >= (NOW(3) - INTERVAL 90 DAY)
       AND i.source_notes LIKE ?
     ORDER BY i.id DESC
     LIMIT 1`,
    [accountId || null, contactId || null, `%landing:event_id=${Number(eventId)};%`],
  );

  if (dedupRows[0]) {
    return { leadId: Number(dedupRows[0].id), action: "match_update" };
  }

  const now = new Date();
  const publicId = `int_${randomUUID().replace(/-/g, "")}`;
  const title = normalizeGenericText(
    normalizedPayload?.lead?.title || `Registro landing ${slug}`,
    180,
  );
  const sourceNotes = `landing:event_id=${Number(eventId)};slug=${slug};submission_id=${Number(submissionId)};campaign=${normalizeGenericText(normalizedPayload?.meta?.utm_campaign || "", 120)}`;

  const insertResult = await query(
    `INSERT INTO interactions
       (public_id, title, lead_source, source_notes, summary, analysis_status, processing_status,
        warnings_json, topics_json, actions_taken_json, next_steps_json,
        suggested_account_json, suggested_contacts_json, suggested_opportunities_json,
        account_id, primary_opportunity_id, seller_user_id,
        landing_submission_id,
        created_by, updated_by, created_at, updated_at, analyzed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, NULL, NULL, ?, ?, ?, ?, ?, NULL)`,
    [
      publicId,
      title,
      "webinar",
      sourceNotes,
      normalizedPayload?.lead?.notes || null,
      "created",
      "analyzed",
      accountId || null,
      Number(submissionId),
      Number(actorUserId),
      Number(actorUserId),
      now,
      now,
    ],
  );

  const leadId = Number(insertResult.insertId || 0);
  if (!leadId) {
    return { error: "No fue posible crear lead" };
  }

  if (contactId) {
    await query(
      `INSERT IGNORE INTO interaction_contact_links (interaction_id, contact_id, created_at)
       VALUES (?, ?, NOW(3))`,
      [leadId, contactId],
    ).catch(() => undefined);
  }

  return { leadId, action: "create" };
}

async function processSubmissionIntoCrm(submissionId, workerRunId) {
  const rows = await query(
    `SELECT s.id, s.event_id, s.payload_normalized_json, s.crm_processing_status,
            lp.slug, lp.created_by
     FROM landing_submissions s
     INNER JOIN landing_pages lp ON lp.id = s.landing_page_id
     WHERE s.id = ?
     LIMIT 1`,
    [Number(submissionId)],
  );

  const submission = rows[0] || null;
  if (!submission) {
    return;
  }

  if (
    submission.crm_processing_status !== CRM_STATUS_PENDING &&
    submission.crm_processing_status !== CRM_STATUS_FAILED
  ) {
    return;
  }

  const normalizedPayload =
    typeof submission.payload_normalized_json === "string"
      ? JSON.parse(submission.payload_normalized_json || "{}")
      : submission.payload_normalized_json || {};

  const actorUserId = Number(submission.created_by || 0) || 1;

  const accountResolution = await resolveOrCreateAccount({
    normalizedPayload,
    actorUserId,
  });
  if (accountResolution?.duplicateReview) {
    await query(
      `UPDATE landing_submissions
       SET crm_processing_status = ?,
           crm_error_message = ?,
           crm_processed_at = NOW(3)
       WHERE id = ?`,
      [CRM_STATUS_DUPLICATE_REVIEW, "Multiples cuentas candidatas", Number(submissionId)],
    );
    return;
  }
  if (accountResolution?.error) {
    throw new Error(accountResolution.error);
  }

  const contactResolution = await resolveOrCreateContact({
    normalizedPayload,
    accountId: accountResolution?.accountId || null,
    actorUserId,
  });
  if (contactResolution?.duplicateReview) {
    await query(
      `UPDATE landing_submissions
       SET crm_processing_status = ?,
           crm_error_message = ?,
           crm_processed_at = NOW(3)
       WHERE id = ?`,
      [CRM_STATUS_DUPLICATE_REVIEW, "Multiples contactos candidatos", Number(submissionId)],
    );
    return;
  }
  if (contactResolution?.error) {
    throw new Error(contactResolution.error);
  }

  const leadResolution = await resolveOrCreateLead({
    submissionId,
    eventId: Number(submission.event_id),
    slug: submission.slug,
    accountId: accountResolution?.accountId || null,
    contactId: contactResolution?.contactId || null,
    normalizedPayload,
    actorUserId,
  });

  if (leadResolution?.error) {
    throw new Error(leadResolution.error);
  }

  await withTransaction(async (conn) => {
    await conn.query(
      `UPDATE landing_submissions
       SET crm_processing_status = ?,
           crm_error_message = NULL,
           crm_processed_at = NOW(3)
       WHERE id = ?`,
      [CRM_STATUS_PROCESSED, Number(submissionId)],
    );

    await conn.query(
      `INSERT INTO landing_submission_crm_links
         (submission_id, action_taken_json, lead_id, account_id, contact_id, worker_run_id)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         action_taken_json = VALUES(action_taken_json),
         lead_id = VALUES(lead_id),
         account_id = VALUES(account_id),
         contact_id = VALUES(contact_id),
         worker_run_id = VALUES(worker_run_id),
         processed_at = NOW(3)`,
      [
        Number(submissionId),
        JSON.stringify({
          account: { action: accountResolution?.action || "none", id: accountResolution?.accountId || null },
          contact: { action: contactResolution?.action || "none", id: contactResolution?.contactId || null },
          lead: { action: leadResolution?.action || "none", id: leadResolution?.leadId || null },
        }),
        leadResolution?.leadId || null,
        accountResolution?.accountId || null,
        contactResolution?.contactId || null,
        workerRunId,
      ],
    );
  });
}

let landingWorkerStarted = false;
let landingWorkerBusy = false;
let landingWorkerTimer = null;

async function processPendingLandingSubmissionsBatch(limit = 20) {
  const rows = await query(
    `SELECT id
     FROM landing_submissions
     WHERE crm_processing_status = ?
     ORDER BY submitted_at ASC, id ASC
     LIMIT ?`,
    [CRM_STATUS_PENDING, Number(limit)],
  );

  const workerRunId = `lnd_${Date.now()}_${randomUUID().slice(0, 8)}`;
  for (const row of rows) {
    const submissionId = Number(row.id);
    try {
      await processSubmissionIntoCrm(submissionId, workerRunId);
    } catch (error) {
      await query(
        `UPDATE landing_submissions
         SET crm_processing_status = ?,
             crm_error_message = ?,
             crm_processed_at = NOW(3)
         WHERE id = ?`,
        [
          CRM_STATUS_FAILED,
          String(error?.message || "No fue posible procesar envio de landing").slice(
            0,
            1000,
          ),
          submissionId,
        ],
      ).catch(() => undefined);
    }
  }
}

export async function processPendingLandingSubmissions() {
  if (landingWorkerBusy) return;
  landingWorkerBusy = true;
  try {
    await processPendingLandingSubmissionsBatch(20);
  } finally {
    landingWorkerBusy = false;
  }
}

export async function startLandingWorker() {
  if (landingWorkerStarted) return;
  landingWorkerStarted = true;

  await processPendingLandingSubmissions();

  landingWorkerTimer = setInterval(async () => {
    await processPendingLandingSubmissions();
  }, 10000);

  if (typeof landingWorkerTimer?.unref === "function") {
    landingWorkerTimer.unref();
  }
}

privateRouter.put(
  "/events/:eventId/landing",
  requireAnyPermission(landingCreatePermissions),
  async (req, res) => {
    const eventId = Number(req.params.eventId);
    if (!Number.isInteger(eventId) || eventId <= 0) {
      return res.status(400).json({ message: "eventId invalido" });
    }

    const parsed = upsertLandingSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const payload = parsed.data;
    const slug = normalizeSlug(payload.slug);
    if (!slug || !/^[a-z0-9-]{3,120}$/.test(slug)) {
      return res.status(400).json({ message: "slug invalido" });
    }

    let formSchema;
    try {
      formSchema = validateFormSchema(payload.form_schema);
    } catch (error) {
      return res.status(Number(error?.status) || 400).json({ message: error.message });
    }

    const htmlContent = String(payload.html_content || "").trim() || "<html><body><h1>Landing</h1><form data-landing-form><input name=\"email\" type=\"email\" /><button type=\"submit\">Enviar</button></form></body></html>";

    try {
      const result = await withTransaction(async (conn) => {
        const [existingRows] = await conn.query(
          `SELECT id, slug
           FROM landing_pages
           WHERE event_id = ?
           LIMIT 1`,
          [eventId],
        );

        if (!existingRows.length) {
          const [slugRows] = await conn.query(
            `SELECT id
             FROM landing_pages
             WHERE slug = ?
             LIMIT 1`,
            [slug],
          );
          if (slugRows.length) {
            throw Object.assign(new Error("El slug ya esta en uso"), { status: 409 });
          }

          const now = new Date();
          const [insertPageResult] = await conn.query(
            `INSERT INTO landing_pages
               (event_id, event_name, slug, status, created_by, created_at, updated_by, updated_at)
             VALUES (?, ?, ?, 'draft', ?, ?, ?, ?)`,
            [
              eventId,
              payload.eventName,
              slug,
              Number(req.user.id),
              now,
              Number(req.user.id),
              now,
            ],
          );

          const landingPageId = Number(insertPageResult.insertId || 0);
          const [insertVersionResult] = await conn.query(
            `INSERT INTO landing_page_versions
               (landing_page_id, version_number, source_type, source_url, html_content,
                assets_manifest_json, form_schema_json, publish_notes, is_active, created_by, created_at)
             VALUES (?, 1, ?, ?, ?, NULL, ?, NULL, 0, ?, ?)`,
            [
              landingPageId,
              payload.source_type,
              payload.source_url || null,
              htmlContent,
              JSON.stringify(formSchema),
              Number(req.user.id),
              now,
            ],
          );

          const versionId = Number(insertVersionResult.insertId || 0);
          await conn.query(
            `UPDATE landing_pages
             SET current_version_id = ?, updated_by = ?, updated_at = NOW(3)
             WHERE id = ?`,
            [versionId, Number(req.user.id), landingPageId],
          );

          return {
            landingPageId,
            versionId,
          };
        }

        const landingPageId = Number(existingRows[0].id);
        if (String(existingRows[0].slug || "") !== slug) {
          const [slugRows] = await conn.query(
            `SELECT id
             FROM landing_pages
             WHERE slug = ?
               AND id <> ?
             LIMIT 1`,
            [slug, landingPageId],
          );
          if (slugRows.length) {
            throw Object.assign(new Error("El slug ya esta en uso"), { status: 409 });
          }
        }

        const [versionRows] = await conn.query(
          `SELECT COALESCE(MAX(version_number), 0) AS max_version
           FROM landing_page_versions
           WHERE landing_page_id = ?`,
          [landingPageId],
        );
        const nextVersion = Number(versionRows[0]?.max_version || 0) + 1;

        const [insertVersionResult] = await conn.query(
          `INSERT INTO landing_page_versions
             (landing_page_id, version_number, source_type, source_url, html_content,
              assets_manifest_json, form_schema_json, publish_notes, is_active, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, 0, ?, NOW(3))`,
          [
            landingPageId,
            nextVersion,
            payload.source_type,
            payload.source_url || null,
            htmlContent,
            JSON.stringify(formSchema),
            Number(req.user.id),
          ],
        );

        const versionId = Number(insertVersionResult.insertId || 0);
        await conn.query(
          `UPDATE landing_pages
           SET slug = ?,
               event_name = ?,
               current_version_id = ?,
               updated_by = ?,
               updated_at = NOW(3)
           WHERE id = ?`,
          [slug, payload.eventName, versionId, Number(req.user.id), landingPageId],
        );

        return {
          landingPageId,
          versionId,
        };
      });

      await logAuditEvent({
        req,
        module: "landing",
        action: "updated",
        entityType: "landing_page",
        entityId: Number(result.landingPageId),
        detail: `Landing guardada para evento ${eventId}`,
        after: {
          event_id: eventId,
          slug,
          version_id: Number(result.versionId),
        },
      });

      return res.json({
        landing_page: {
          id: Number(result.landingPageId),
          event_id: eventId,
          slug,
          status: "draft",
          current_version_id: Number(result.versionId),
        },
        version: {
          id: Number(result.versionId),
        },
      });
    } catch (error) {
      return res.status(Number(error?.status) || 500).json({
        message: error?.message || "No fue posible guardar landing",
      });
    }
  },
);

privateRouter.post(
  "/landing-pages/:landingPageId/versions/html-upload",
  requireAnyPermission(landingUpdatePermissions),
  async (req, res) => {
    let parsedFiles = [];
    try {
      const landingPageId = Number(req.params.landingPageId);
      if (!Number.isInteger(landingPageId) || landingPageId <= 0) {
        return res.status(400).json({ message: "landingPageId invalido" });
      }

      const landingPage = await loadLandingPageById(landingPageId);
      if (!landingPage) {
        return res.status(404).json({ message: "Landing no encontrada" });
      }

      const { fields, files } = await parseMultipartFiles(req);
      parsedFiles = files;
      const rawFiles = Array.isArray(files) ? files : [];
      if (rawFiles.length !== 1) {
        return res.status(400).json({ message: "Debes subir exactamente un archivo HTML" });
      }

      const file = rawFiles[0];
      const htmlContent = String(await import("node:fs/promises").then((m) => m.readFile(file.filepath, "utf8")) || "");
      if (!htmlContent.trim()) {
        return res.status(400).json({ message: "El archivo HTML esta vacio" });
      }

      const formSchema = await parseFormSchemaFromField(fields?.form_schema);

      const inserted = await withTransaction(async (conn) => {
        const [versionRows] = await conn.query(
          `SELECT COALESCE(MAX(version_number), 0) AS max_version
           FROM landing_page_versions
           WHERE landing_page_id = ?`,
          [landingPageId],
        );
        const nextVersion = Number(versionRows[0]?.max_version || 0) + 1;

        const [insertResult] = await conn.query(
          `INSERT INTO landing_page_versions
             (landing_page_id, version_number, source_type, source_url, html_content,
              assets_manifest_json, form_schema_json, publish_notes, is_active, created_by, created_at)
           VALUES (?, ?, 'html_upload', NULL, ?, NULL, ?, NULL, 0, ?, NOW(3))`,
          [landingPageId, nextVersion, htmlContent, JSON.stringify(formSchema), Number(req.user.id)],
        );

        await conn.query(
          `UPDATE landing_pages
           SET current_version_id = ?, updated_by = ?, updated_at = NOW(3)
           WHERE id = ?`,
          [Number(insertResult.insertId), Number(req.user.id), landingPageId],
        );

        return {
          versionId: Number(insertResult.insertId || 0),
          versionNumber: nextVersion,
        };
      });

      return res.status(201).json({
        version_id: inserted.versionId,
        version_number: inserted.versionNumber,
        source_type: "html_upload",
      });
    } catch (error) {
      return res.status(Number(error?.status) || 500).json({
        message: error?.message || "No fue posible subir HTML",
      });
    } finally {
      if (parsedFiles.length) {
        await cleanupTempFiles(parsedFiles).catch(() => undefined);
      }
    }
  },
);

privateRouter.post(
  "/landing-pages/:landingPageId/import-url",
  requireAnyPermission(landingUpdatePermissions),
  async (req, res) => {
    const landingPageId = Number(req.params.landingPageId);
    if (!Number.isInteger(landingPageId) || landingPageId <= 0) {
      return res.status(400).json({ message: "landingPageId invalido" });
    }

    const parsed = importUrlSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ message: "source_url invalida" });
    }

    const landingPage = await loadLandingPageById(landingPageId);
    if (!landingPage) {
      return res.status(404).json({ message: "Landing no encontrada" });
    }

    const alreadyImportedRows = await query(
      `SELECT id
       FROM landing_import_runs
       WHERE landing_page_id = ?
         AND import_status = 'success'
       LIMIT 1`,
      [landingPageId],
    );
    if (alreadyImportedRows.length) {
      return res.status(409).json({
        message: "La importacion por URL solo se permite una vez por landing",
      });
    }

    try {
      const html = await fetchUrlHtml(parsed.data.source_url);
      const diagnostics = {
        scripts_detected: (html.match(/<script\b/gi) || []).length,
        warnings: [],
      };

      const sourceHash = createHash("sha256").update(html).digest("hex");

      const inserted = await withTransaction(async (conn) => {
        const [versionRows] = await conn.query(
          `SELECT COALESCE(MAX(version_number), 0) AS max_version
           FROM landing_page_versions
           WHERE landing_page_id = ?`,
          [landingPageId],
        );
        const nextVersion = Number(versionRows[0]?.max_version || 0) + 1;

        const [baseVersionRows] = await conn.query(
          `SELECT form_schema_json
           FROM landing_page_versions
           WHERE landing_page_id = ?
           ORDER BY version_number DESC
           LIMIT 1`,
          [landingPageId],
        );

        const fallbackSchema =
          baseVersionRows[0]?.form_schema_json && typeof baseVersionRows[0].form_schema_json === "string"
            ? JSON.parse(baseVersionRows[0].form_schema_json)
            : baseVersionRows[0]?.form_schema_json || {
                form_schema_version: 1,
                submit: {
                  button_text: "Registrarme",
                  success_message: "Gracias por registrarte",
                  redirect_url: null,
                },
                fields: [
                  {
                    key: "email",
                    label: "Correo",
                    type: "email",
                    required: true,
                    placeholder: "correo@empresa.com",
                    default_value: null,
                    options: [],
                    validation: {
                      min_length: 5,
                      max_length: 180,
                      regex: null,
                    },
                    crm_map: {
                      entity: "contact",
                      field: "email",
                      required_for_entity: true,
                    },
                  },
                ],
              };

        validateFormSchema(fallbackSchema);

        const [insertVersionResult] = await conn.query(
          `INSERT INTO landing_page_versions
             (landing_page_id, version_number, source_type, source_url, html_content,
              assets_manifest_json, form_schema_json, publish_notes, is_active, created_by, created_at)
           VALUES (?, ?, 'url_import_once', ?, ?, NULL, ?, NULL, 0, ?, NOW(3))`,
          [
            landingPageId,
            nextVersion,
            parsed.data.source_url,
            html,
            JSON.stringify(fallbackSchema),
            Number(req.user.id),
          ],
        );

        const versionId = Number(insertVersionResult.insertId || 0);

        await conn.query(
          `UPDATE landing_pages
           SET current_version_id = ?, updated_by = ?, updated_at = NOW(3)
           WHERE id = ?`,
          [versionId, Number(req.user.id), landingPageId],
        );

        const [importResult] = await conn.query(
          `INSERT INTO landing_import_runs
             (landing_page_id, source_url, fetched_at, html_hash, import_status, diagnostics_json)
           VALUES (?, ?, NOW(3), ?, 'success', ?)`,
          [
            landingPageId,
            parsed.data.source_url,
            sourceHash,
            JSON.stringify(diagnostics),
          ],
        );

        return {
          versionId,
          versionNumber: nextVersion,
          importRunId: Number(importResult.insertId || 0),
        };
      });

      return res.status(201).json({
        version_id: inserted.versionId,
        version_number: inserted.versionNumber,
        source_type: "url_import_once",
        import_run_id: inserted.importRunId,
        diagnostics,
      });
    } catch (error) {
      return res.status(Number(error?.status) || 500).json({
        message: error?.message || "No fue posible importar URL",
      });
    }
  },
);

privateRouter.patch(
  "/landing-pages/:landingPageId/versions/:versionId",
  requireAnyPermission(landingUpdatePermissions),
  async (req, res) => {
    const landingPageId = Number(req.params.landingPageId);
    const versionId = Number(req.params.versionId);
    if (!Number.isInteger(landingPageId) || landingPageId <= 0) {
      return res.status(400).json({ message: "landingPageId invalido" });
    }
    if (!Number.isInteger(versionId) || versionId <= 0) {
      return res.status(400).json({ message: "versionId invalido" });
    }

    const parsed = updateDraftSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const version = await loadLandingVersionById(landingPageId, versionId);
    if (!version) {
      return res.status(404).json({ message: "Version no encontrada" });
    }

    let formSchema = version.form_schema_json;
    if (typeof formSchema === "string") {
      formSchema = JSON.parse(formSchema || "{}");
    }
    if (parsed.data.form_schema !== undefined) {
      try {
        formSchema = validateFormSchema(parsed.data.form_schema);
      } catch (error) {
        return res.status(Number(error?.status) || 400).json({ message: error.message });
      }
    }

    const htmlContent =
      parsed.data.html_content !== undefined
        ? String(parsed.data.html_content || "").trim()
        : String(version.html_content || "");

    if (!htmlContent) {
      return res.status(400).json({ message: "html_content no puede quedar vacio" });
    }

    await query(
      `UPDATE landing_page_versions
       SET html_content = ?,
           form_schema_json = ?,
           publish_notes = ?,
           created_by = ?,
           created_at = NOW(3)
       WHERE id = ?`,
      [
        htmlContent,
        JSON.stringify(formSchema),
        parsed.data.publish_notes || null,
        Number(req.user.id),
        versionId,
      ],
    );

    return res.json({
      version_id: versionId,
      updated: true,
    });
  },
);

privateRouter.post(
  "/landing-pages/:landingPageId/publish",
  requireAnyPermission(landingPublishPermissions),
  async (req, res) => {
    const landingPageId = Number(req.params.landingPageId);
    if (!Number.isInteger(landingPageId) || landingPageId <= 0) {
      return res.status(400).json({ message: "landingPageId invalido" });
    }

    const parsed = publishSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ message: "version_id invalido" });
    }

    const landingPage = await loadLandingPageById(landingPageId);
    if (!landingPage) {
      return res.status(404).json({ message: "Landing no encontrada" });
    }

    const version = await loadLandingVersionById(landingPageId, parsed.data.version_id);
    if (!version) {
      return res.status(404).json({ message: "Version no encontrada" });
    }

    try {
      validateFormSchema(
        typeof version.form_schema_json === "string"
          ? JSON.parse(version.form_schema_json || "{}")
          : version.form_schema_json,
      );
    } catch (error) {
      return res.status(Number(error?.status) || 400).json({ message: error.message });
    }

    await withTransaction(async (conn) => {
      await conn.query(
        `UPDATE landing_page_versions
         SET is_active = 0
         WHERE landing_page_id = ?`,
        [landingPageId],
      );

      await conn.query(
        `UPDATE landing_page_versions
         SET is_active = 1,
             published_by = ?,
             published_at = NOW(3)
         WHERE id = ?`,
        [Number(req.user.id), Number(parsed.data.version_id)],
      );

      await conn.query(
        `UPDATE landing_pages
         SET status = 'published',
             current_version_id = ?,
             updated_by = ?,
             updated_at = NOW(3)
         WHERE id = ?`,
        [Number(parsed.data.version_id), Number(req.user.id), landingPageId],
      );
    });

    const publicUrl = `/landing/${landingPage.slug}.html`;

    await logAuditEvent({
      req,
      module: "landing",
      action: "published",
      entityType: "landing_page",
      entityId: landingPageId,
      detail: `Landing publicada ${publicUrl}`,
      after: {
        version_id: Number(parsed.data.version_id),
        slug: landingPage.slug,
      },
    });

    return res.json({
      landing_page_id: landingPageId,
      status: "published",
      current_version_id: Number(parsed.data.version_id),
      public_url: publicUrl,
      published_at: new Date().toISOString(),
    });
  },
);

privateRouter.get(
  "/landing-pages",
  requireAnyPermission(landingReadPermissions),
  async (req, res) => {
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(200, Math.max(1, Number(req.query.page_size || 25)));
    const offset = (page - 1) * pageSize;
    const status = String(req.query.status || "").trim();
    const search = String(req.query.search || "").trim();

    const where = ["1 = 1"];
    const params = [];
    if (status) {
      where.push("lp.status = ?");
      params.push(status);
    }
    if (search) {
      where.push("(lp.event_name LIKE ? OR lp.slug LIKE ? OR CAST(lp.event_id AS CHAR) LIKE ?)");
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const items = await query(
      `SELECT lp.id,
              lp.event_id,
              lp.event_name,
              lp.slug,
              lp.status,
              lp.current_version_id,
              lp.updated_at,
              lv.version_number AS current_version_number,
              lv.published_at
       FROM landing_pages lp
       LEFT JOIN landing_page_versions lv ON lv.id = lp.current_version_id
       WHERE ${where.join(" AND ")}
       ORDER BY lp.updated_at DESC, lp.id DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );

    const totalRows = await query(
      `SELECT COUNT(*) AS total
       FROM landing_pages lp
       WHERE ${where.join(" AND ")}`,
      params,
    );

    return res.json({
      items: items.map((row) => ({
        id: Number(row.id),
        event_id: Number(row.event_id),
        event_name: row.event_name || "",
        slug: row.slug || "",
        status: row.status || "draft",
        current_version_id:
          row.current_version_id === null ? null : Number(row.current_version_id),
        current_version_number:
          row.current_version_number === null
            ? null
            : Number(row.current_version_number),
        published_at: row.published_at || null,
        updated_at: row.updated_at || null,
      })),
      pagination: {
        page,
        page_size: pageSize,
        total: Number(totalRows[0]?.total || 0),
      },
    });
  },
);

privateRouter.get(
  "/events/:eventId/landing",
  requireAnyPermission(landingReadPermissions),
  async (req, res) => {
    const eventId = Number(req.params.eventId);
    if (!Number.isInteger(eventId) || eventId <= 0) {
      return res.status(400).json({ message: "eventId invalido" });
    }

    const rows = await query(
      `SELECT id
       FROM landing_pages
       WHERE event_id = ?
       LIMIT 1`,
      [eventId],
    );

    if (!rows.length) {
      return res.status(404).json({ message: "Landing no encontrada para el evento" });
    }

    return res.json({
      landing_page_id: Number(rows[0].id),
    });
  },
);

privateRouter.get(
  "/landing-pages/:landingPageId",
  requireAnyPermission(landingReadPermissions),
  async (req, res) => {
    const landingPageId = Number(req.params.landingPageId);
    if (!Number.isInteger(landingPageId) || landingPageId <= 0) {
      return res.status(400).json({ message: "landingPageId invalido" });
    }

    const pageRows = await query(
      `SELECT lp.*
       FROM landing_pages lp
       WHERE lp.id = ?
       LIMIT 1`,
      [landingPageId],
    );
    if (!pageRows.length) {
      return res.status(404).json({ message: "Landing no encontrada" });
    }

    const versionRows = await query(
      `SELECT id, landing_page_id, version_number, source_type, source_url,
              publish_notes, is_active, created_by, created_at, published_by, published_at,
              html_content, form_schema_json
       FROM landing_page_versions
       WHERE landing_page_id = ?
       ORDER BY version_number DESC`,
      [landingPageId],
    );

    return res.json({
      landing_page: pageRows[0],
      versions: versionRows,
    });
  },
);

privateRouter.get(
  "/events/:eventId/submissions",
  requireAnyPermission(landingSubmissionsReadPermissions),
  async (req, res) => {
    const eventId = Number(req.params.eventId);
    if (!Number.isInteger(eventId) || eventId <= 0) {
      return res.status(400).json({ message: "eventId invalido" });
    }

    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(200, Math.max(1, Number(req.query.page_size || 50)));
    const offset = (page - 1) * pageSize;
    const crmStatus = String(req.query.crm_status || "").trim();
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();

    const where = ["s.event_id = ?"];
    const params = [eventId];

    if (crmStatus) {
      where.push("s.crm_processing_status = ?");
      params.push(crmStatus);
    }
    if (from) {
      where.push("DATE(s.submitted_at) >= ?");
      params.push(from);
    }
    if (to) {
      where.push("DATE(s.submitted_at) <= ?");
      params.push(to);
    }

    const items = await query(
      `SELECT s.id AS submission_id,
              s.submitted_at,
              s.crm_processing_status,
              s.crm_error_message,
              s.payload_normalized_json,
              scl.lead_id,
              scl.account_id,
              scl.contact_id
       FROM landing_submissions s
       LEFT JOIN landing_submission_crm_links scl ON scl.submission_id = s.id
       WHERE ${where.join(" AND ")}
       ORDER BY s.submitted_at DESC, s.id DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );

    const totalRows = await query(
      `SELECT COUNT(*) AS total
       FROM landing_submissions s
       WHERE ${where.join(" AND ")}`,
      params,
    );

    return res.json({
      items: items.map((row) => ({
        submission_id: Number(row.submission_id),
        submitted_at: row.submitted_at,
        crm_processing_status: row.crm_processing_status,
        crm_error_message: row.crm_error_message,
        payload_normalized:
          typeof row.payload_normalized_json === "string"
            ? JSON.parse(row.payload_normalized_json || "{}")
            : row.payload_normalized_json || {},
        crm_links: {
          lead_id: row.lead_id === null ? null : Number(row.lead_id),
          account_id: row.account_id === null ? null : Number(row.account_id),
          contact_id: row.contact_id === null ? null : Number(row.contact_id),
        },
      })),
      pagination: {
        page,
        page_size: pageSize,
        total: Number(totalRows[0]?.total || 0),
      },
    });
  },
);

privateRouter.post(
  "/submissions/:submissionId/reprocess",
  requireAnyPermission(landingSubmissionsReprocessPermissions),
  async (req, res) => {
    const submissionId = Number(req.params.submissionId);
    if (!Number.isInteger(submissionId) || submissionId <= 0) {
      return res.status(400).json({ message: "submissionId invalido" });
    }

    const parsed = reprocessSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Payload invalido" });
    }

    const rows = await query(
      `SELECT id
       FROM landing_submissions
       WHERE id = ?
       LIMIT 1`,
      [submissionId],
    );
    if (!rows.length) {
      return res.status(404).json({ message: "Submission no encontrado" });
    }

    await query(
      `UPDATE landing_submissions
       SET crm_processing_status = ?,
           crm_error_message = NULL,
           crm_processed_at = NULL
       WHERE id = ?`,
      [CRM_STATUS_PENDING, submissionId],
    );

    await processPendingLandingSubmissions();

    return res.status(202).json({
      submission_id: submissionId,
      queued: true,
    });
  },
);

publicRouter.get("/landing/:slug.html", async (req, res) => {
  const slug = normalizeSlug(req.params.slug);
  if (!slug) {
    return res.status(404).send("Landing no encontrada");
  }

  const rows = await query(
    `SELECT lp.slug, lv.html_content
     FROM landing_pages lp
     INNER JOIN landing_page_versions lv ON lv.id = lp.current_version_id
     WHERE lp.slug = ?
       AND lp.status = 'published'
       AND lv.is_active = 1
     LIMIT 1`,
    [slug],
  );

  const landing = rows[0] || null;
  if (!landing) {
    return res.status(404).send("Landing no encontrada");
  }

  const html = renderLandingHtml(landing.html_content, slug);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(html);
});

publicRouter.post("/api/public/landing/v1/:slug/submit", async (req, res) => {
  const slug = normalizeSlug(req.params.slug);
  if (!slug) {
    return res.status(404).json({ message: "Landing no encontrada" });
  }

  const parsed = publicSubmitSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      message: "Payload invalido",
      errors: parsed.error.flatten(),
    });
  }

  const rowSet = await query(
    `SELECT lp.id AS landing_page_id,
            lp.event_id,
            lp.current_version_id,
            lv.form_schema_json,
            lv.id AS version_id,
            lv.is_active
     FROM landing_pages lp
     INNER JOIN landing_page_versions lv ON lv.id = lp.current_version_id
     WHERE lp.slug = ?
       AND lp.status = 'published'
       AND lv.is_active = 1
     LIMIT 1`,
    [slug],
  );

  const landing = rowSet[0] || null;
  if (!landing) {
    return res.status(404).json({ message: "Landing no encontrada" });
  }

  const formData = parsed.data.form_data || {};
  if (String(formData.hp_field || "").trim()) {
    return res.status(202).json({
      status: "accepted",
      message: "Gracias por registrarte",
    });
  }

  let formSchema = landing.form_schema_json;
  if (typeof formSchema === "string") {
    formSchema = JSON.parse(formSchema || "{}");
  }

  try {
    validateFormSchema(formSchema);
  } catch (error) {
    return res.status(422).json({ message: error.message });
  }

  const fieldsMap = inferFieldMap(formSchema);
  for (const field of formSchema.fields || []) {
    if (!field?.required) continue;
    const key = String(field?.key || "").trim();
    if (!key) continue;
    if (formData[key] === undefined || formData[key] === null || String(formData[key]).trim() === "") {
      return res.status(422).json({
        message: `Campo requerido: ${key}`,
      });
    }

    const fieldType = String(field.type || "").trim();
    if (fieldType === "email") {
      const email = normalizeEmail(formData[key]);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(422).json({
          message: `Correo invalido en campo: ${key}`,
        });
      }
    }
  }

  const idempotencyKey = String(req.headers["idempotency-key"] || "")
    .trim()
    .slice(0, 120);
  if (idempotencyKey) {
    const existingRows = await query(
      `SELECT id
       FROM landing_submissions
       WHERE landing_page_id = ?
         AND idempotency_key = ?
       LIMIT 1`,
      [Number(landing.landing_page_id), idempotencyKey],
    );
    if (existingRows[0]) {
      return res.status(201).json({
        submission_id: Number(existingRows[0].id),
        status: "accepted",
        message: String(formSchema?.submit?.success_message || "Gracias por registrarte"),
      });
    }
  }

  const normalizedPayload = normalizeSubmissionPayload(formData, formSchema);

  const insertResult = await query(
    `INSERT INTO landing_submissions
       (landing_page_id, landing_version_id, event_id, submitted_at, ip_address,
        user_agent, referrer_url, idempotency_key,
        payload_raw_json, payload_normalized_json,
        validation_status, crm_processing_status, crm_error_message)
     VALUES (?, ?, ?, NOW(3), ?, ?, ?, ?, ?, ?, 'valid', ?, NULL)`,
    [
      Number(landing.landing_page_id),
      Number(landing.version_id),
      Number(landing.event_id),
      String(req.ip || "").slice(0, 64),
      String(req.headers["user-agent"] || "").slice(0, 500) || null,
      normalizeGenericText(parsed.data.context?.referrer_url || parsed.data.context?.page_url || "", 1000) || null,
      idempotencyKey || null,
      JSON.stringify({
        form_data: formData,
        field_keys: Array.from(fieldsMap.keys()),
      }),
      JSON.stringify(normalizedPayload),
      CRM_STATUS_PENDING,
    ],
  );

  const submissionId = Number(insertResult.insertId || 0);
  await processPendingLandingSubmissions();

  return res.status(201).json({
    submission_id: submissionId,
    status: "accepted",
    message: String(formSchema?.submit?.success_message || "Gracias por registrarte"),
  });
});

export default privateRouter;
export { publicRouter };
