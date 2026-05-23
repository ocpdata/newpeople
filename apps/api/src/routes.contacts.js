import express from "express";
import { z } from "zod";
import { config } from "./config.js";
import { query, withTransaction } from "./db.js";
import { requireAnyPermission, requirePermission } from "./auth.js";
import { logAuditEvent } from "./audit.js";
import { getTemporaryFeatureSettings } from "./settings.js";

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
const contactGlobalReadPermission = "contactos.read_all";

function normalizeContactText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeContactEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeContactPhone(value) {
  return String(value || "")
    .replace(/\D/g, "")
    .trim();
}

function buildContactFullName(contact) {
  return String(
    `${contact?.firstName || contact?.first_name || ""} ${
      contact?.lastName || contact?.last_name || ""
    }`,
  ).trim();
}

function buildContactBigrams(value) {
  const normalized = normalizeContactText(value).replace(/\s/g, "");
  if (normalized.length < 2) {
    return new Set(normalized ? [normalized] : []);
  }

  const pairs = new Set();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    pairs.add(normalized.slice(index, index + 2));
  }
  return pairs;
}

function calculateContactNameSimilarity(left, right) {
  const leftNormalized = normalizeContactText(left);
  const rightNormalized = normalizeContactText(right);
  if (!leftNormalized || !rightNormalized) return 0;
  if (leftNormalized === rightNormalized) return 1;
  if (
    leftNormalized.length >= 6 &&
    rightNormalized.length >= 6 &&
    (leftNormalized.includes(rightNormalized) ||
      rightNormalized.includes(leftNormalized))
  ) {
    return 0.93;
  }

  const leftPairs = buildContactBigrams(leftNormalized);
  const rightPairs = buildContactBigrams(rightNormalized);
  let overlap = 0;

  leftPairs.forEach((pair) => {
    if (rightPairs.has(pair)) overlap += 1;
  });

  return (2 * overlap) / (leftPairs.size + rightPairs.size || 1);
}

function hasSingleEditDistance(left, right) {
  const leftNormalized = normalizeContactText(left).replace(/\s/g, "");
  const rightNormalized = normalizeContactText(right).replace(/\s/g, "");

  if (!leftNormalized || !rightNormalized) return false;
  if (leftNormalized === rightNormalized) return false;
  if (leftNormalized.length < 6 || rightNormalized.length < 6) return false;

  const lengthDelta = Math.abs(leftNormalized.length - rightNormalized.length);
  if (lengthDelta > 1) return false;

  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;

  while (
    leftIndex < leftNormalized.length &&
    rightIndex < rightNormalized.length
  ) {
    if (leftNormalized[leftIndex] === rightNormalized[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }

    edits += 1;
    if (edits > 1) return false;

    if (leftNormalized.length === rightNormalized.length) {
      leftIndex += 1;
      rightIndex += 1;
    } else if (leftNormalized.length > rightNormalized.length) {
      leftIndex += 1;
    } else {
      rightIndex += 1;
    }
  }

  if (
    leftIndex < leftNormalized.length ||
    rightIndex < rightNormalized.length
  ) {
    edits += 1;
  }

  return edits === 1;
}

function getContactDuplicateReasonLabel(matchReason) {
  if (matchReason === "same_email") {
    return "Mismo e-mail";
  }
  if (matchReason === "same_name_same_account") {
    return "Mismo nombre en la misma cuenta";
  }
  if (matchReason === "same_mobile_same_account") {
    return "Mismo movil en la misma cuenta";
  }
  if (matchReason === "near_exact_name_same_account") {
    return "Nombre casi identico en la misma cuenta";
  }
  if (matchReason === "similar_name_same_account") {
    return "Nombre muy parecido en la misma cuenta";
  }
  if (matchReason === "possible_name_match_same_account") {
    return "Nombre parcialmente coincidente en la misma cuenta";
  }
  return "Coincidencia detectada con un contacto existente";
}

function getContactDuplicateSeverityMessage(severity) {
  if (severity === "high") {
    return "Coincidencia fuerte. El sistema bloqueara la creacion para evitar un duplicado.";
  }
  if (severity === "medium") {
    return "Coincidencia probable. El sistema no creara el contacto mientras exista duda razonable.";
  }
  return "Coincidencia detectada. El sistema requiere una diferencia mas clara para crear un contacto nuevo.";
}

async function getContactDuplicateCandidates({ draft }) {
  const normalizedEmail = normalizeContactEmail(draft.email);
  const rows = await query(
    `SELECT c.id, c.first_name, c.last_name, c.account_id, a.name AS account_name,
            c.position_title, c.email, c.mobile, c.department
     FROM contacts c
     INNER JOIN accounts a ON a.id = c.account_id
     WHERE c.account_id = ?
        OR (? <> '' AND LOWER(TRIM(COALESCE(c.email, ''))) = ?)
     ORDER BY c.id DESC
     LIMIT 25`,
    [Number(draft.accountId), normalizedEmail, normalizedEmail],
  );

  return rows;
}

function buildContactDuplicateWarnings({ draft, candidates }) {
  const draftFullName = buildContactFullName(draft);
  const draftEmail = normalizeContactEmail(draft.email);
  const draftMobile = normalizeContactPhone(draft.mobile);
  const warnings = [];

  candidates.forEach((candidate) => {
    const candidateFullName = buildContactFullName(candidate);
    const candidateEmail = normalizeContactEmail(candidate.email);
    const candidateMobile = normalizeContactPhone(candidate.mobile);
    const sameAccount =
      Number(candidate.account_id) === Number(draft.accountId);
    const similarity = calculateContactNameSimilarity(
      draftFullName,
      candidateFullName,
    );
    const isNearExactNameMatch = hasSingleEditDistance(
      draftFullName,
      candidateFullName,
    );

    let severity = null;
    let matchReason = "";
    let sortRank = 0;

    if (draftEmail && candidateEmail && draftEmail === candidateEmail) {
      severity = "high";
      matchReason = "same_email";
      sortRank = 400;
    } else if (
      sameAccount &&
      draftFullName &&
      normalizeContactText(draftFullName) ===
        normalizeContactText(candidateFullName)
    ) {
      severity = "high";
      matchReason = "same_name_same_account";
      sortRank = 360;
    } else if (
      sameAccount &&
      draftMobile &&
      candidateMobile &&
      draftMobile === candidateMobile
    ) {
      severity = "high";
      matchReason = "same_mobile_same_account";
      sortRank = 340;
    } else if (sameAccount && isNearExactNameMatch) {
      severity = "medium";
      matchReason = "near_exact_name_same_account";
      sortRank = 300;
    } else if (sameAccount && similarity >= 0.88) {
      severity = "medium";
      matchReason = "similar_name_same_account";
      sortRank = 200 + Math.round(similarity * 10);
    } else if (sameAccount && similarity >= 0.74) {
      severity = "low";
      matchReason = "possible_name_match_same_account";
      sortRank = 140 + Math.round(similarity * 10);
    }

    if (!severity) return;

    warnings.push({
      severity,
      matchReason,
      reasonLabel: getContactDuplicateReasonLabel(matchReason),
      contactId: Number(candidate.id),
      contactName: candidateFullName,
      accountId: Number(candidate.account_id),
      accountName: candidate.account_name || "",
      email: candidate.email || "",
      mobile: candidate.mobile || "",
      positionTitle: candidate.position_title || "",
      department: candidate.department || "",
      severityMessage: getContactDuplicateSeverityMessage(severity),
      recommendedAction:
        severity === "high"
          ? "Deten la creacion y valida primero si el contacto ya existe."
          : "Verifica rapidamente si corresponde a la misma persona.",
      sortRank,
    });
  });

  return warnings.sort((left, right) => right.sortRank - left.sortRank);
}

function extractJsonObject(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function getOpenAiOutputText(responseData) {
  const output = Array.isArray(responseData?.output) ? responseData.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (part?.type === "output_text" && part?.text) {
        return String(part.text);
      }
    }
  }
  return "";
}

async function analyzeContactDuplicateReview({ draft, duplicateWarnings }) {
  if (!config.openai.apiKey || !duplicateWarnings.length) {
    return { duplicateReview: null, usedAiGeneration: false };
  }

  const payload = {
    model: config.openai.model,
    input: [
      {
        role: "system",
        content:
          "Evalua posibles duplicados de contactos CRM y responde solo con JSON valido. Usa un criterio prudente: likely_duplicate, likely_distinct o inconclusive. Considera nombre completo, cuenta, email, movil, cargo y departamento. Para nombres personales, presta especial atencion a variantes casi identicas, errores tipograficos y apellidos con un solo cambio de letra como Castillo/Cantillo dentro de la misma cuenta. Si no hay evidencia suficiente para descartar que sea la misma persona, responde inconclusive.",
      },
      {
        role: "user",
        content: JSON.stringify({
          draft: {
            fullName: buildContactFullName(draft),
            accountId: Number(draft.accountId),
            email: draft.email || "",
            mobile: draft.mobile || "",
            positionTitle: draft.positionTitle || "",
            department: draft.department || "",
          },
          duplicateWarnings: duplicateWarnings.map((warning) => ({
            contactId: warning.contactId,
            contactName: warning.contactName,
            accountId: warning.accountId,
            accountName: warning.accountName,
            email: warning.email,
            mobile: warning.mobile,
            positionTitle: warning.positionTitle,
            department: warning.department,
            reasonLabel: warning.reasonLabel,
            severity: warning.severity,
          })),
          expectedShape: {
            verdict: "likely_duplicate|likely_distinct|inconclusive",
            summary: "string",
            recommendation: "string",
            confidence: "high|medium|low",
          },
        }),
      },
    ],
  };

  const response = await fetch(
    `${config.openai.baseUrl.replace(/\/$/, "")}/responses`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openai.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${errorText}`);
  }

  const responseData = await response.json();
  const parsed = extractJsonObject(getOpenAiOutputText(responseData));
  if (!parsed) {
    throw new Error("OpenAI request failed: invalid JSON response");
  }

  return {
    duplicateReview: {
      verdict: String(parsed.verdict || "inconclusive"),
      summary: String(parsed.summary || "").trim(),
      recommendation: String(parsed.recommendation || "").trim(),
      confidence: String(parsed.confidence || "low"),
    },
    usedAiGeneration: true,
  };
}

function getContactDuplicateDecision({ duplicateWarnings, duplicateReview }) {
  if (!duplicateWarnings.length) {
    return "clear";
  }

  if (duplicateWarnings.some((warning) => warning.severity === "high")) {
    return "blocked";
  }

  if (duplicateReview?.verdict === "likely_distinct") {
    return "clear";
  }

  return "blocked";
}

export async function validateContactDuplicates({ draft }) {
  const duplicateCandidates = await getContactDuplicateCandidates({ draft });
  const duplicateWarnings = buildContactDuplicateWarnings({
    draft,
    candidates: duplicateCandidates,
  });

  let duplicateReview = null;
  let duplicateValidationSource = "heuristic";

  try {
    const aiReview = await analyzeContactDuplicateReview({
      draft,
      duplicateWarnings,
    });
    duplicateReview = aiReview.duplicateReview;
    if (aiReview.usedAiGeneration) {
      duplicateValidationSource = "ai";
    }
  } catch {
    duplicateReview = null;
  }

  return {
    duplicateWarnings,
    duplicateReview,
    duplicateValidationSource,
    duplicateDecision: getContactDuplicateDecision({
      duplicateWarnings,
      duplicateReview,
    }),
  };
}

export function buildContactDuplicateResponse(validation) {
  return {
    code: "CONTACT_DUPLICATE_BLOCKED",
    message:
      "No se creo el contacto porque detectamos una coincidencia con contactos existentes y el sistema esta configurado para evitar duplicados automaticamente.",
    duplicateDecision: validation.duplicateDecision,
    duplicateWarnings: validation.duplicateWarnings,
    duplicateReview: validation.duplicateReview,
    duplicateValidationSource: validation.duplicateValidationSource,
  };
}

function hasGlobalAccountReadScope(user) {
  return user?.permissionSet?.has(contactGlobalReadPermission);
}

function applyOwnedAccountScope({ user, accountExpression, params }) {
  if (hasGlobalAccountReadScope(user)) return "";
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
  if (hasGlobalAccountReadScope(user)) return { ok: true };

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
        body: {
          message: "No autorizado para usar una cuenta que no te pertenece",
        },
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

function canRequestContacts(user) {
  return hasExplicitContactPermission(user, "contactos.request");
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

async function getOpportunityCountsForContact(contactId) {
  const rows = await query(
    `SELECT oas.code, COUNT(*) AS count
     FROM opportunities o
     INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
     WHERE o.contact_id = ?
     GROUP BY oas.code`,
    [contactId],
  );

  return rows.reduce(
    (totals, row) => ({
      ...totals,
      [String(row.code)]: Number(row.count) || 0,
    }),
    {},
  );
}

async function getBlockedContactStatusResponse(contactId, nextStatusCode) {
  const opportunityCounts = await getOpportunityCountsForContact(contactId);
  const activeOpportunities = Number(opportunityCounts.activada || 0);
  const inactiveOpportunities = Number(opportunityCounts.desactivada || 0);

  if (nextStatusCode === "desactivado" && activeOpportunities > 0) {
    return {
      status: 409,
      body: {
        message:
          "No es posible desactivar el contacto porque tiene oportunidades activas",
      },
    };
  }

  if (
    nextStatusCode === "pendiente_activacion" &&
    activeOpportunities + inactiveOpportunities > 0
  ) {
    return {
      status: 409,
      body: {
        message:
          "No es posible marcar el contacto como pendiente porque tiene oportunidades activas o desactivadas",
      },
    };
  }

  return null;
}

async function resolveContactCreationStatusCode(user) {
  if (hasExplicitContactPermission(user, "contactos.create")) {
    return "activado";
  }
  if (!canRequestContacts(user)) {
    return null;
  }

  const settings = await getTemporaryFeatureSettings();
  if (settings.contactsPendingEnabled) {
    return "pendiente_activacion";
  }

  return null;
}

async function ensurePendingContactStatusAllowed() {
  const settings = await getTemporaryFeatureSettings();
  return settings.contactsPendingEnabled;
}

router.get("/", requirePermission("contactos.read"), async (req, res) => {
  const params = [];
  const ownershipJoin = applyOwnedAccountScope({
    user: req.user,
    accountExpression: "c.account_id",
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
     ${accountIdFilter !== null ? "WHERE c.account_id = ?" : ""}
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

router.post(
  "/",
  requireAnyPermission(contactCreatePermissions),
  async (req, res) => {
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
      return res
        .status(accountAccess.response.status)
        .json(accountAccess.response.body);
    }
    const creationStatusCode = await resolveContactCreationStatusCode(req.user);
    const activationStatusId = creationStatusCode
      ? await getContactActivationStatusId(creationStatusCode)
      : null;

    if (!activationStatusId) {
      return res.status(403).json({
        message: "No autorizado",
      });
    }

    const duplicateValidation = await validateContactDuplicates({
      draft: body,
    });

    if (duplicateValidation.duplicateDecision !== "clear") {
      return res
        .status(409)
        .json(buildContactDuplicateResponse(duplicateValidation));
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
          duplicate_decision:
            duplicateValidation.duplicateDecision === "clear"
              ? null
              : duplicateValidation.duplicateDecision,
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
  },
);

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
    return res
      .status(contactAccess.response.status)
      .json(contactAccess.response.body);
  }

  const accountAccess = await requireAccessibleAccountForContact({
    user: req.user,
    accountId: body.accountId,
  });
  if (!accountAccess.ok) {
    return res
      .status(accountAccess.response.status)
      .json(accountAccess.response.body);
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
    requestedStatusCode === "pendiente_activacion" &&
    requestedStatusCode !== previousStatusCode &&
    !(await ensurePendingContactStatusAllowed())
  ) {
    return res.status(400).json({
      message: "El estado pendiente no esta habilitado para contactos",
    });
  }

  if (
    requestedStatusCode !== previousStatusCode &&
    !canChangeContactActivationStatus(req.user)
  ) {
    return res.status(403).json({
      message:
        "No autorizado para cambiar el estado de activacion de contactos",
    });
  }

  if (requestedStatusCode !== previousStatusCode) {
    const blockedStatusResponse = await getBlockedContactStatusResponse(
      id,
      requestedStatusCode,
    );
    if (blockedStatusResponse) {
      return res
        .status(blockedStatusResponse.status)
        .json(blockedStatusResponse.body);
    }
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

    const blockedStatusResponse = await getBlockedContactStatusResponse(
      id,
      parsed.data.statusCode,
    );
    if (blockedStatusResponse) {
      return res
        .status(blockedStatusResponse.status)
        .json(blockedStatusResponse.body);
    }

    if (
      parsed.data.statusCode === "pendiente_activacion" &&
      !(await ensurePendingContactStatusAllowed())
    ) {
      return res.status(400).json({
        message: "El estado pendiente no esta habilitado para contactos",
      });
    }

    if (!canChangeContactActivationStatus(req.user)) {
      return res.status(403).json({
        message:
          "No autorizado para cambiar el estado de activacion de contactos",
      });
    }

    const contactAccess = await requireAccessibleContactOr404({
      user: req.user,
      contactId: id,
      message: "Contacto no encontrado",
    });
    if (!contactAccess.ok) {
      return res
        .status(contactAccess.response.status)
        .json(contactAccess.response.body);
    }

    const beforeRows = await query(
      "SELECT activation_status_id FROM contacts WHERE id = ? LIMIT 1",
      [id],
    );
    if (!beforeRows.length) {
      return res.status(404).json({ message: "Contacto no encontrado" });
    }

    const previousStatusCode = await getContactActivationStatusCodeById(
      Number(beforeRows[0].activation_status_id),
    );

    if (
      parsed.data.statusCode === "pendiente_activacion" &&
      parsed.data.statusCode !== previousStatusCode &&
      !(await ensurePendingContactStatusAllowed())
    ) {
      return res.status(400).json({
        message: "El estado pendiente no esta habilitado para contactos",
      });
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
