import express from "express";
import { z } from "zod";
import { query, withTransaction } from "./db.js";
import { requireAnyPermission, requirePermission } from "./auth.js";
import { logAuditEvent } from "./audit.js";
import { queueAccountDraftAnalysisProcessing } from "./accounts/draft-analysis/async.js";
import {
  accountDraftAnalysisRequestSchema,
  analyzeAccountDraft,
  analyzeAccountDuplicateReview,
  createOrReuseAccountDraftAnalysisJob,
  ensureAccountDraftAnalysisJobSchema,
  getAccountDraftAnalysisJob,
} from "./accounts/draft-analysis/index.js";
import {
  buildDuplicateWarnings,
  getDuplicateCandidates,
} from "./accounts/draft-analysis/core.js";
import accountInteractionsRoutes from "./routes.account-interactions.js";
import { getTemporaryFeatureSettings } from "./settings.js";

const router = express.Router();

let ensureAccountsSchemaPromise = null;

async function ensureAccountsSchema() {
  if (!ensureAccountsSchemaPromise) {
    ensureAccountsSchemaPromise = (async () => {
      await query(
        `ALTER TABLE accounts
         MODIFY COLUMN registration_code VARCHAR(80) NULL`,
      ).catch(() => null);
    })().catch((error) => {
      ensureAccountsSchemaPromise = null;
      throw error;
    });
  }

  return ensureAccountsSchemaPromise;
}

router.use(async (_req, _res, next) => {
  try {
    await ensureAccountsSchema();
    next();
  } catch (error) {
    next(error);
  }
});

router.use("/:accountId/interactions", accountInteractionsRoutes);

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
  companyDescription: z.string().max(10000).optional(),
  description: z.string().max(10000).optional(),
  addressLine: z.string().max(255).optional(),
  postalCode: z.string().max(20).optional(),
  activationStatusId: z.number().int().positive(),
  ownerUserIds: z.array(z.number().int().positive()).min(1),
});

function normalizeAccountPayload(body) {
  return {
    ...body,
    registrationCode: String(body.registrationCode || "").trim() || null,
    companyDescription: String(
      body.companyDescription || body.description || "",
    ).trim(),
  };
}

function isAccountCountryRegistrationConflict(error) {
  return String(error?.message || "").includes(
    "accounts.uq_accounts_country_registration",
  );
}

const SPANISH_NAME_STOPWORDS = new Set([
  "a",
  "al",
  "de",
  "del",
  "e",
  "el",
  "la",
  "las",
  "los",
  "y",
]);

function normalizeDuplicateDecisionText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildCoreAccountName(value) {
  return normalizeDuplicateDecisionText(value)
    .split(" ")
    .filter((token) => token && !SPANISH_NAME_STOPWORDS.has(token))
    .join(" ");
}

function hasSuspiciousPartialNameMatch({ draftName, duplicateWarnings }) {
  const draftCoreName = buildCoreAccountName(draftName);
  if (!draftCoreName) return false;

  return duplicateWarnings.some((warning) => {
    if (warning.matchReason !== "partial_name_match") return false;

    const candidateCoreName = buildCoreAccountName(warning.accountName);
    if (!candidateCoreName) return false;

    return (
      draftCoreName === candidateCoreName ||
      draftCoreName.includes(candidateCoreName) ||
      candidateCoreName.includes(draftCoreName)
    );
  });
}

function getAccountDuplicateDecision(duplicateWarnings) {
  if (duplicateWarnings.some((warning) => warning.severity === "high")) {
    return "review_required";
  }
  if (duplicateWarnings.some((warning) => warning.severity === "medium")) {
    return "confirmation_required";
  }
  return "clear";
}

function getAccountDuplicateDecisionFromReview({
  draftName,
  duplicateWarnings,
  duplicateReview,
  duplicateValidationSource,
}) {
  const suspiciousPartialNameMatch = hasSuspiciousPartialNameMatch({
    draftName,
    duplicateWarnings,
  });
  const deterministicStrongDuplicate = duplicateWarnings.some((warning) =>
    [
      "country_registration",
      "website_domain",
      "normalized_name_same_country",
    ].includes(warning.matchReason),
  );

  if (deterministicStrongDuplicate) {
    return "review_required";
  }

  if (duplicateReview?.verdict === "likely_duplicate") {
    return "review_required";
  }
  if (duplicateReview?.verdict === "inconclusive") {
    return "confirmation_required";
  }
  if (suspiciousPartialNameMatch) {
    return "confirmation_required";
  }
  if (duplicateReview?.verdict === "likely_distinct") {
    return "clear";
  }

  return getAccountDuplicateDecision(duplicateWarnings);
}

function getAccountDuplicateReasonLabel(matchReason) {
  if (matchReason === "country_registration") {
    return "Mismo registro en el pais seleccionado";
  }
  if (matchReason === "website_domain") {
    return "Mismo dominio web";
  }
  if (matchReason === "normalized_name_same_country") {
    return "Mismo nombre comercial en el pais seleccionado";
  }
  if (matchReason === "near_exact_name_same_country") {
    return "Nombre casi identico en el pais seleccionado";
  }
  if (matchReason === "similar_name_same_country") {
    return "Nombre muy parecido en el pais seleccionado";
  }
  if (matchReason === "partial_name_match") {
    return "Nombre parcialmente coincidente";
  }
  return "Coincidencia detectada con una cuenta existente";
}

function getAccountDuplicateSeverityMessage(severity) {
  if (severity === "high") {
    return "Coincidencia fuerte. Conviene detener la creacion y revisar si la cuenta ya existe.";
  }
  if (severity === "medium") {
    return "Coincidencia probable. Confirma que no se trate de la misma organizacion antes de continuar.";
  }
  return "Coincidencia baja. Revisa rapidamente antes de seguir.";
}

export async function validateAccountDuplicates({ draft, user }) {
  const analysis = await analyzeAccountDuplicateReview({ draft, user });
  const duplicateWarnings = Array.isArray(analysis?.duplicateWarnings)
    ? analysis.duplicateWarnings.map((warning) => ({
        ...warning,
        reasonLabel:
          warning.reasonLabel ||
          getAccountDuplicateReasonLabel(warning.matchReason),
        severityMessage:
          warning.severityMessage ||
          getAccountDuplicateSeverityMessage(warning.severity),
      }))
    : [];
  return {
    duplicateWarnings,
    duplicateReview: analysis?.duplicateReview || null,
    duplicateValidationSource: analysis?.meta?.usedAiGeneration
      ? "ai"
      : "heuristic",
    duplicateDecision: getAccountDuplicateDecisionFromReview({
      draftName: draft.name,
      duplicateWarnings,
      duplicateReview: analysis?.duplicateReview,
      duplicateValidationSource: analysis?.meta?.usedAiGeneration
        ? "ai"
        : "heuristic",
    }),
  };
}

export function buildAccountDuplicateResponse(validation) {
  const isReviewRequired = validation.duplicateDecision === "review_required";
  return {
    code: isReviewRequired
      ? "ACCOUNT_DUPLICATE_REVIEW_REQUIRED"
      : "ACCOUNT_DUPLICATE_CONFIRMATION_REQUIRED",
    message: isReviewRequired
      ? "Detectamos una coincidencia fuerte con cuentas existentes. Antes de crear una cuenta nueva, revisa si en realidad estas frente a un duplicado."
      : "Detectamos una coincidencia probable con cuentas existentes. Verifica si corresponde a la misma organizacion antes de continuar.",
    duplicateDecision: validation.duplicateDecision,
    duplicateWarnings: validation.duplicateWarnings,
    duplicateReview: validation.duplicateReview,
    duplicateValidationSource: validation.duplicateValidationSource,
  };
}

const accountStatusSchema = z.object({
  statusCode: z.enum(["activada", "desactivada", "pendiente_activacion"]),
});

const accountCreatePermissions = ["cuentas.create", "cuentas.request"];
const accountGlobalReadPermission = "cuentas.read_all";
const accountAssignAnyOwnersPermission = "cuentas.assign_owners_any";

function hasGlobalAccountReadScope(user) {
  return user?.permissionSet?.has(accountGlobalReadPermission);
}

function canAssignAnyAccountOwners(user) {
  return user?.permissionSet?.has(accountAssignAnyOwnersPermission);
}

function applyAccountOwnershipScope({ user, accountAlias, params }) {
  if (hasGlobalAccountReadScope(user)) return "";
  params.push(Number(user.id));
  return `INNER JOIN account_owners ao_scope ON ao_scope.account_id = ${accountAlias}.id AND ao_scope.user_id = ?`;
}

async function requireAccessibleAccountOr404({ user, accountId, message }) {
  const params = [];
  const ownershipJoin = applyAccountOwnershipScope({
    user,
    accountAlias: "a",
    params,
  });
  params.push(Number(accountId));
  const rows = await query(
    `SELECT a.id
     FROM accounts a
     ${ownershipJoin}
     WHERE a.id = ?
     LIMIT 1`,
    params,
  );

  if (!rows.length) {
    return { ok: false, response: { status: 404, body: { message } } };
  }

  return { ok: true };
}

function hasExplicitAccountPermission(user, permission) {
  return user?.permissionSet?.has(permission);
}

function canActivateAccounts(user) {
  return hasExplicitAccountPermission(user, "cuentas.create");
}

function canRequestAccounts(user) {
  return hasExplicitAccountPermission(user, "cuentas.request");
}

async function getAccountActivationStatusId(statusCode) {
  const rows = await query(
    "SELECT id FROM account_activation_statuses WHERE code = ? LIMIT 1",
    [statusCode],
  );
  return rows.length ? Number(rows[0].id) : null;
}

async function getAccountActivationStatusCodeById(statusId) {
  const rows = await query(
    "SELECT code FROM account_activation_statuses WHERE id = ? LIMIT 1",
    [statusId],
  );
  return rows.length ? String(rows[0].code) : null;
}

async function getContactCountsForAccount(accountId) {
  const rows = await query(
    `SELECT cas.code, COUNT(*) AS count
     FROM contacts c
     INNER JOIN contact_activation_statuses cas ON cas.id = c.activation_status_id
     WHERE c.account_id = ?
     GROUP BY cas.code`,
    [accountId],
  );

  return rows.reduce(
    (totals, row) => ({
      ...totals,
      [String(row.code)]: Number(row.count) || 0,
    }),
    {},
  );
}

async function getBlockedAccountStatusResponse(accountId, nextStatusCode) {
  const contactCounts = await getContactCountsForAccount(accountId);
  const activeContacts = Number(contactCounts.activado || 0);
  const inactiveContacts = Number(contactCounts.desactivado || 0);

  if (nextStatusCode === "desactivada" && activeContacts > 0) {
    return {
      status: 409,
      body: {
        message:
          "No es posible desactivar la cuenta porque tiene contactos activos",
      },
    };
  }

  if (
    nextStatusCode === "pendiente_activacion" &&
    activeContacts + inactiveContacts > 0
  ) {
    return {
      status: 409,
      body: {
        message:
          "No es posible marcar la cuenta como pendiente porque tiene contactos activos o desactivados",
      },
    };
  }

  return null;
}

async function resolveAccountCreationStatusCode(user) {
  if (hasExplicitAccountPermission(user, "cuentas.create")) {
    return "activada";
  }
  if (!canRequestAccounts(user)) {
    return null;
  }

  const settings = await getTemporaryFeatureSettings();
  if (settings.accountsPendingEnabled) {
    return "pendiente_activacion";
  }

  return null;
}

async function ensurePendingAccountStatusAllowed() {
  const settings = await getTemporaryFeatureSettings();
  return settings.accountsPendingEnabled;
}

function getOwnerDisplayExpression(userAlias = "u") {
  return `CASE
    WHEN ${userAlias}.status = 'inactive' THEN CONCAT(${userAlias}.full_name, ' (inactivo)')
    ELSE ${userAlias}.full_name
  END`;
}

router.get("/", requirePermission("cuentas.read"), async (req, res) => {
  const params = [];
  const ownershipJoin = applyAccountOwnershipScope({
    user: req.user,
    accountAlias: "a",
    params,
  });
  const activeOnly =
    String(req.query.activeOnly || "")
      .trim()
      .toLowerCase() === "true";
  const rows = await query(
    `SELECT a.id, a.name, atp.name AS account_type, a.registration_code, a.phone, es.name AS economic_sector,
            a.website, a.city, a.state_region, c.name AS country,
            aas.name AS activation_status, aas.code AS activation_status_code,
            COALESCE(owners.owner_names, '') AS owners_display,
            a.created_at, u1.full_name AS created_by_name, a.updated_at, u2.full_name AS updated_by_name
     FROM accounts a
     ${ownershipJoin}
     INNER JOIN account_types atp ON atp.id = a.account_type_id
     INNER JOIN economic_sectors es ON es.id = a.economic_sector_id
     INNER JOIN countries c ON c.id = a.country_id
     INNER JOIN account_activation_statuses aas ON aas.id = a.activation_status_id
     INNER JOIN users u1 ON u1.id = a.created_by
     INNER JOIN users u2 ON u2.id = a.updated_by
     LEFT JOIN (
       SELECT ao.account_id,
              GROUP_CONCAT(
                DISTINCT ${getOwnerDisplayExpression("u")}
                ORDER BY u.full_name SEPARATOR ', '
              ) AS owner_names
       FROM account_owners ao
       INNER JOIN users u ON u.id = ao.user_id
       GROUP BY ao.account_id
     ) owners ON owners.account_id = a.id
     ${activeOnly ? "WHERE aas.code = 'activada'" : ""}
     ORDER BY a.id DESC`,
    params,
  );
  res.json(rows);
});

router.post(
  "/draft-analysis/jobs",
  requireAnyPermission(accountCreatePermissions),
  async (req, res) => {
    const parsed = accountDraftAnalysisRequestSchema
      .extend({ forceRegenerate: z.boolean().optional() })
      .safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    try {
      await ensureAccountDraftAnalysisJobSchema();
      const result = await createOrReuseAccountDraftAnalysisJob({
        draft: parsed.data.draft,
        options: parsed.data.options,
        requestedByUserId: Number(req.user.id),
        forceRegenerate: Boolean(parsed.data.forceRegenerate),
      });

      if (!result.wasReused) {
        queueAccountDraftAnalysisProcessing();
      }

      return res
        .status(result.response?.result ? 200 : 202)
        .json(result.response);
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        message: "No fue posible preparar el analisis del borrador de cuenta",
      });
    }
  },
);

router.get(
  "/draft-analysis/jobs/:jobId",
  requireAnyPermission(accountCreatePermissions),
  async (req, res) => {
    const jobId = String(req.params.jobId || "").trim();
    if (!jobId) {
      return res.status(400).json({ message: "jobId invalido" });
    }

    try {
      await ensureAccountDraftAnalysisJobSchema();
      const job = await getAccountDraftAnalysisJob(jobId);
      if (!job) {
        return res.status(404).json({ message: "Job no encontrado" });
      }

      if (Number(job.job?.requestedByUserId || 0) !== Number(req.user.id)) {
        return res.status(404).json({ message: "Job no encontrado" });
      }

      return res.json(job);
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        message: "No fue posible obtener el analisis del borrador de cuenta",
      });
    }
  },
);

router.post(
  "/draft-analysis",
  requireAnyPermission(accountCreatePermissions),
  async (req, res) => {
    const parsed = accountDraftAnalysisRequestSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    try {
      const analysis = await analyzeAccountDraft({
        draft: parsed.data.draft,
        options: parsed.data.options,
        user: req.user,
      });
      return res.json(analysis);
    } catch (error) {
      console.error(error);
      return res
        .status(500)
        .json({ message: "No fue posible analizar el borrador de cuenta" });
    }
  },
);

router.get("/:id", requirePermission("cuentas.read"), async (req, res) => {
  const id = Number(req.params.id);
  const params = [];
  const ownershipJoin = applyAccountOwnershipScope({
    user: req.user,
    accountAlias: "a",
    params,
  });
  params.push(id);
  const rows = await query(
    `SELECT a.*,
            atp.name AS account_type,
            es.name AS economic_sector,
            c.name AS country,
            aas.name AS activation_status,
            u1.full_name AS created_by_name,
            u2.full_name AS updated_by_name
     FROM accounts a
     ${ownershipJoin}
     INNER JOIN account_types atp ON atp.id = a.account_type_id
     INNER JOIN economic_sectors es ON es.id = a.economic_sector_id
     INNER JOIN countries c ON c.id = a.country_id
     INNER JOIN account_activation_statuses aas ON aas.id = a.activation_status_id
     INNER JOIN users u1 ON u1.id = a.created_by
     INNER JOIN users u2 ON u2.id = a.updated_by
     WHERE a.id = ?`,
    params,
  );

  if (rows.length === 0) {
    return res.status(404).json({ message: "Cuenta no encontrada" });
  }

  const owners = await query(
    `SELECT u.id, u.full_name, u.email, u.status
     FROM account_owners ao
     INNER JOIN users u ON u.id = ao.user_id
     WHERE ao.account_id = ?
     ORDER BY u.full_name`,
    [id],
  );

  res.json({
    ...rows[0],
    companyDescription: String(rows[0].description || ""),
    owners,
  });
});

router.post(
  "/",
  requireAnyPermission(accountCreatePermissions),
  async (req, res) => {
    const parsed = accountSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const now = new Date();
    const body = normalizeAccountPayload(parsed.data);
    const allowDuplicateOverride = req.body?.allowDuplicateOverride === true;
    const creationStatusCode = await resolveAccountCreationStatusCode(req.user);
    const activationStatusId = creationStatusCode
      ? await getAccountActivationStatusId(creationStatusCode)
      : null;

    if (!activationStatusId) {
      return res.status(403).json({
        message: "No autorizado",
      });
    }

    const actorUserId = Number(req.user.id || 0);
    const canAssignAnyOwners = canAssignAnyAccountOwners(req.user);
    const effectiveOwnerUserIds = canAssignAnyOwners
      ? Array.from(new Set(body.ownerUserIds.map(Number).filter(Boolean)))
      : actorUserId
        ? [actorUserId]
        : [];

    if (!effectiveOwnerUserIds.length) {
      return res.status(403).json({
        message: "No autorizado para asignar propietarios en cuentas",
      });
    }

    const duplicateValidation = await validateAccountDuplicates({
      draft: body,
      user: req.user,
    });

    if (
      !allowDuplicateOverride &&
      duplicateValidation.duplicateDecision !== "clear"
    ) {
      return res
        .status(409)
        .json(buildAccountDuplicateResponse(duplicateValidation));
    }

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
            body.companyDescription || null,
            body.addressLine || null,
            body.postalCode || null,
            activationStatusId,
            req.user.id,
            now,
            req.user.id,
            now,
          ],
        );

        for (const ownerUserId of effectiveOwnerUserIds) {
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
          description: body.companyDescription || null,
          address_line: body.addressLine || null,
          postal_code: body.postalCode || null,
          activation_status_id: activationStatusId,
          owner_user_ids: effectiveOwnerUserIds,
          duplicate_override: allowDuplicateOverride,
          duplicate_decision:
            duplicateValidation.duplicateDecision === "clear"
              ? null
              : duplicateValidation.duplicateDecision,
          duplicate_warning_ids: allowDuplicateOverride
            ? duplicateValidation.duplicateWarnings.map((warning) =>
                Number(warning.accountId),
              )
            : [],
        },
      });

      return res.status(201).json({
        id: accountId,
        message:
          creationStatusCode === "activada"
            ? "Cuenta creada"
            : "Solicitud de cuenta creada en estado pendiente",
      });
    } catch (error) {
      if (isAccountCountryRegistrationConflict(error)) {
        return res.status(409).json({
          message:
            "Ya existe una cuenta con ese registro en el pais seleccionado.",
        });
      }
      return res
        .status(500)
        .json({ message: "No fue posible crear la cuenta" });
    }
  },
);

router.put("/:id", requirePermission("cuentas.update"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = accountSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
  }

  const now = new Date();
  const body = normalizeAccountPayload(parsed.data);

  const accountAccess = await requireAccessibleAccountOr404({
    user: req.user,
    accountId: id,
    message: "Cuenta no encontrada",
  });
  if (!accountAccess.ok) {
    return res
      .status(accountAccess.response.status)
      .json(accountAccess.response.body);
  }

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

  const previousStatusCode = await getAccountActivationStatusCodeById(
    Number(beforeRows[0].activation_status_id),
  );
  const requestedStatusCode = await getAccountActivationStatusCodeById(
    Number(body.activationStatusId),
  );

  if (!requestedStatusCode) {
    return res.status(400).json({ message: "Estado de activacion invalido" });
  }

  if (
    requestedStatusCode === "pendiente_activacion" &&
    requestedStatusCode !== previousStatusCode &&
    !(await ensurePendingAccountStatusAllowed())
  ) {
    return res.status(400).json({
      message: "El estado pendiente no esta habilitado para cuentas",
    });
  }

  if (
    requestedStatusCode !== previousStatusCode &&
    !canActivateAccounts(req.user)
  ) {
    return res.status(403).json({
      message: "No autorizado para cambiar el estado de activacion de cuentas",
    });
  }

  if (requestedStatusCode !== previousStatusCode) {
    const blockedStatusResponse = await getBlockedAccountStatusResponse(
      id,
      requestedStatusCode,
    );
    if (blockedStatusResponse) {
      return res
        .status(blockedStatusResponse.status)
        .json(blockedStatusResponse.body);
    }
  }

  const beforeOwners = await query(
    "SELECT user_id FROM account_owners WHERE account_id = ? ORDER BY user_id",
    [id],
  );
  const canAssignAnyOwners = canAssignAnyAccountOwners(req.user);
  const effectiveOwnerUserIds = canAssignAnyOwners
    ? Array.from(new Set(body.ownerUserIds.map(Number).filter(Boolean)))
    : beforeOwners
        .map((row) => Number(row.user_id || 0))
        .filter(
          (ownerUserId) => Number.isInteger(ownerUserId) && ownerUserId > 0,
        );

  if (!effectiveOwnerUserIds.length) {
    return res.status(403).json({
      message: "No autorizado para modificar propietarios de la cuenta",
    });
  }

  try {
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
          body.companyDescription || null,
          body.addressLine || null,
          body.postalCode || null,
          body.activationStatusId,
          req.user.id,
          now,
          id,
        ],
      );

      await conn.query("DELETE FROM account_owners WHERE account_id = ?", [id]);
      for (const ownerUserId of effectiveOwnerUserIds) {
        await conn.query(
          "INSERT INTO account_owners (account_id, user_id, assigned_at, assigned_by) VALUES (?, ?, ?, ?)",
          [id, ownerUserId, now, req.user.id],
        );
      }
    });
  } catch (error) {
    if (isAccountCountryRegistrationConflict(error)) {
      return res.status(409).json({
        message:
          "Ya existe una cuenta con ese registro en el pais seleccionado.",
      });
    }
    return res
      .status(500)
      .json({ message: "No fue posible actualizar la cuenta" });
  }

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

    const blockedStatusResponse = await getBlockedAccountStatusResponse(
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
      !(await ensurePendingAccountStatusAllowed())
    ) {
      return res.status(400).json({
        message: "El estado pendiente no esta habilitado para cuentas",
      });
    }

    if (!canActivateAccounts(req.user)) {
      return res.status(403).json({
        message:
          "No autorizado para cambiar el estado de activacion de cuentas",
      });
    }

    const accountAccess = await requireAccessibleAccountOr404({
      user: req.user,
      accountId: id,
      message: "Cuenta no encontrada",
    });
    if (!accountAccess.ok) {
      return res
        .status(accountAccess.response.status)
        .json(accountAccess.response.body);
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
    const previousStatusCode =
      await getAccountActivationStatusCodeById(previousStatusId);

    if (
      parsed.data.statusCode === "pendiente_activacion" &&
      parsed.data.statusCode !== previousStatusCode &&
      !(await ensurePendingAccountStatusAllowed())
    ) {
      return res.status(400).json({
        message: "El estado pendiente no esta habilitado para cuentas",
      });
    }

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
          : parsed.data.statusCode === "pendiente_activacion"
            ? "Cuenta marcada como pendiente"
            : "Cuenta desactivada",
    });
  },
);

export default router;
