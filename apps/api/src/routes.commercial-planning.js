import express from "express";
import { z } from "zod";
import { requirePermission } from "./auth.js";
import { logAuditEvent } from "./audit.js";
import { query, withTransaction } from "./db.js";
import { ensureCommercialPlanningSchema } from "./commercial-planning/schema.js";

const router = express.Router();

const periodSchema = z.object({
  year: z.number().int().min(2020).max(2100),
  quarter: z.number().int().min(1).max(4),
  baseCurrencyCode: z.string().trim().min(1).max(10),
  notes: z.string().trim().max(4000).optional().nullable(),
});

const createVersionSchema = z.object({
  sourceVersionId: z.number().int().positive().optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
});

const targetInputSchema = z.object({
  sellerUserId: z.number().int().positive(),
  salesQuotaAmount: z.number().positive(),
  currencyCode: z.string().trim().min(1).max(10),
  expectedMarginPercent: z.number().min(0).max(999.99),
  notes: z.string().trim().max(4000).optional().nullable(),
  status: z.enum(["complete", "incomplete", "void"]).optional(),
});

const replaceTargetsSchema = z.object({
  targets: z.array(targetInputSchema).max(500),
});

const publishSchema = z.object({
  justification: z.string().trim().max(2000).optional().nullable(),
});

const quarterLabel = (year, quarter) => `T${quarter} ${year}`;

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function mapPeriodRow(row) {
  return {
    id: Number(row.id),
    year: Number(row.plan_year),
    quarter: Number(row.plan_quarter),
    label: quarterLabel(row.plan_year, row.plan_quarter),
    baseCurrencyCode: row.base_currency_code,
    status: row.status,
    notes: row.notes || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    closedAt: row.closed_at,
    versionCount: Number(row.version_count || 0),
    activeVersionId: row.active_version_id
      ? Number(row.active_version_id)
      : null,
    activeVersionNumber: row.active_version_number
      ? Number(row.active_version_number)
      : null,
    targetCount: Number(row.target_count || 0),
    totalQuotaAmount: roundMoney(row.total_quota_amount),
    totalContributionAmount: roundMoney(row.total_contribution_amount),
    expectedMarginAveragePercent:
      row.expected_margin_average_percent === null
        ? null
        : Number(Number(row.expected_margin_average_percent).toFixed(2)),
  };
}

function mapVersionRow(row) {
  return {
    id: Number(row.id),
    periodId: Number(row.period_id),
    versionNumber: Number(row.version_number),
    label: row.label,
    status: row.status,
    notes: row.notes || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    publishedByUserId: row.published_by_user_id
      ? Number(row.published_by_user_id)
      : null,
    publishedByUserName: row.published_by_name || "",
    targetCount: Number(row.target_count || 0),
    totalQuotaAmount: roundMoney(row.total_quota_amount),
    totalContributionAmount: roundMoney(row.total_contribution_amount),
    expectedMarginAveragePercent:
      row.expected_margin_average_percent === null
        ? null
        : Number(Number(row.expected_margin_average_percent).toFixed(2)),
  };
}

function mapTargetRow(row) {
  return {
    id: Number(row.id),
    versionId: Number(row.version_id),
    sellerUserId: Number(row.seller_user_id),
    sellerUserName: row.seller_user_name,
    sellerUserEmail: row.seller_user_email,
    salesQuotaAmount: roundMoney(row.sales_quota_amount),
    currencyCode: row.currency_code,
    expectedMarginPercent: Number(
      Number(row.expected_margin_percent).toFixed(2),
    ),
    expectedContributionAmount: roundMoney(row.expected_contribution_amount),
    notes: row.notes || "",
    status: row.status,
    updatedAt: row.updated_at,
    updatedByUserName: row.updated_by_name || "",
  };
}

function buildChangedTargetFields(before, after) {
  if (!before) return after;
  return {
    salesQuotaAmount: after.salesQuotaAmount,
    currencyCode: after.currencyCode,
    expectedMarginPercent: after.expectedMarginPercent,
    expectedContributionAmount: after.expectedContributionAmount,
    notes: after.notes,
    status: after.status,
  };
}

async function listEligibleSellers() {
  const rows = await query(
    `SELECT DISTINCT u.id, u.full_name, u.email, u.status,
            GROUP_CONCAT(DISTINCT r.name ORDER BY r.name SEPARATOR ', ') AS roles
     FROM users u
     INNER JOIN user_roles ur ON ur.user_id = u.id
     INNER JOIN roles r ON r.id = ur.role_id
     WHERE u.status = 'active'
       AND r.is_active = 1
       AND LOWER(TRIM(r.name)) = 'vendedor'
     GROUP BY u.id, u.full_name, u.email, u.status
     ORDER BY u.full_name`,
    [],
  );

  return rows.map((row) => ({
    id: Number(row.id),
    fullName: row.full_name,
    email: row.email,
    status: row.status,
    roles: row.roles || "",
  }));
}

async function getPeriodById(periodId) {
  const rows = await query(
    `SELECT p.*,
            (SELECT COUNT(*) FROM commercial_planning_versions v WHERE v.period_id = p.id) AS version_count,
            (SELECT v.id FROM commercial_planning_versions v WHERE v.period_id = p.id AND v.status = 'active' ORDER BY v.version_number DESC LIMIT 1) AS active_version_id,
            (SELECT v.version_number FROM commercial_planning_versions v WHERE v.period_id = p.id AND v.status = 'active' ORDER BY v.version_number DESC LIMIT 1) AS active_version_number,
            (SELECT COUNT(*)
             FROM commercial_planning_targets t
             INNER JOIN commercial_planning_versions v ON v.id = t.version_id
             WHERE v.period_id = p.id AND v.status = 'active') AS target_count,
            (SELECT COALESCE(SUM(t.sales_quota_amount), 0)
             FROM commercial_planning_targets t
             INNER JOIN commercial_planning_versions v ON v.id = t.version_id
             WHERE v.period_id = p.id AND v.status = 'active') AS total_quota_amount,
            (SELECT COALESCE(SUM(t.expected_contribution_amount), 0)
             FROM commercial_planning_targets t
             INNER JOIN commercial_planning_versions v ON v.id = t.version_id
             WHERE v.period_id = p.id AND v.status = 'active') AS total_contribution_amount,
            (SELECT AVG(t.expected_margin_percent)
             FROM commercial_planning_targets t
             INNER JOIN commercial_planning_versions v ON v.id = t.version_id
             WHERE v.period_id = p.id AND v.status = 'active') AS expected_margin_average_percent
     FROM commercial_planning_periods p
     WHERE p.id = ?`,
    [periodId],
  );

  return rows[0] ? mapPeriodRow(rows[0]) : null;
}

async function getVersionsForPeriod(periodId) {
  const rows = await query(
    `SELECT v.*, pub.full_name AS published_by_name,
            COUNT(t.id) AS target_count,
            COALESCE(SUM(t.sales_quota_amount), 0) AS total_quota_amount,
            COALESCE(SUM(t.expected_contribution_amount), 0) AS total_contribution_amount,
            AVG(t.expected_margin_percent) AS expected_margin_average_percent
     FROM commercial_planning_versions v
     LEFT JOIN users pub ON pub.id = v.published_by_user_id
     LEFT JOIN commercial_planning_targets t ON t.version_id = v.id
     WHERE v.period_id = ?
     GROUP BY v.id, pub.full_name
     ORDER BY v.version_number DESC`,
    [periodId],
  );

  return rows.map(mapVersionRow);
}

async function getVersionDetail(versionId) {
  const versionRows = await query(
    `SELECT v.*, p.plan_year, p.plan_quarter, p.base_currency_code, p.status AS period_status,
            pub.full_name AS published_by_name,
            COUNT(t.id) AS target_count,
            COALESCE(SUM(t.sales_quota_amount), 0) AS total_quota_amount,
            COALESCE(SUM(t.expected_contribution_amount), 0) AS total_contribution_amount,
            AVG(t.expected_margin_percent) AS expected_margin_average_percent
     FROM commercial_planning_versions v
     INNER JOIN commercial_planning_periods p ON p.id = v.period_id
     LEFT JOIN users pub ON pub.id = v.published_by_user_id
     LEFT JOIN commercial_planning_targets t ON t.version_id = v.id
     WHERE v.id = ?
     GROUP BY v.id, p.plan_year, p.plan_quarter, p.base_currency_code, p.status, pub.full_name`,
    [versionId],
  );

  if (!versionRows[0]) return null;

  const targetRows = await query(
    `SELECT t.*, u.full_name AS seller_user_name, u.email AS seller_user_email,
            updater.full_name AS updated_by_name
     FROM commercial_planning_targets t
     INNER JOIN users u ON u.id = t.seller_user_id
     LEFT JOIN users updater ON updater.id = t.updated_by_user_id
     WHERE t.version_id = ?
     ORDER BY u.full_name`,
    [versionId],
  );

  const version = mapVersionRow(versionRows[0]);
  return {
    version: {
      ...version,
      periodYear: Number(versionRows[0].plan_year),
      periodQuarter: Number(versionRows[0].plan_quarter),
      periodLabel: quarterLabel(
        versionRows[0].plan_year,
        versionRows[0].plan_quarter,
      ),
      baseCurrencyCode: versionRows[0].base_currency_code,
      periodStatus: versionRows[0].period_status,
    },
    targets: targetRows.map(mapTargetRow),
  };
}

async function validateVersion(versionId) {
  const detail = await getVersionDetail(versionId);
  if (!detail) {
    const error = new Error("Version no encontrada");
    error.status = 404;
    throw error;
  }

  const { version, targets } = detail;
  const eligibleSellers = await listEligibleSellers();
  const eligibleSellerIds = new Set(eligibleSellers.map((seller) => seller.id));

  const errors = [];
  const warnings = [];

  if (version.periodStatus === "closed") {
    errors.push({
      code: "period_closed",
      message: "No se puede publicar una version de un periodo cerrado",
    });
  }
  if (version.status !== "draft") {
    errors.push({
      code: "version_not_draft",
      message: "Solo se pueden validar versiones en borrador",
    });
  }

  const seenSellerIds = new Set();
  for (const target of targets) {
    if (seenSellerIds.has(target.sellerUserId)) {
      errors.push({
        code: "duplicate_seller",
        message: `El vendedor ${target.sellerUserName} esta duplicado en la version`,
      });
    }
    seenSellerIds.add(target.sellerUserId);

    if (!eligibleSellerIds.has(target.sellerUserId)) {
      errors.push({
        code: "seller_not_eligible",
        message: `El vendedor ${target.sellerUserName} ya no es un vendedor activo elegible`,
      });
    }
    if (!(Number(target.salesQuotaAmount) > 0)) {
      errors.push({
        code: "invalid_sales_quota",
        message: `La cuota de venta de ${target.sellerUserName} debe ser mayor que cero`,
      });
    }
    if (Number(target.expectedMarginPercent) < 0) {
      errors.push({
        code: "invalid_expected_margin",
        message: `El margen esperado de ${target.sellerUserName} no puede ser negativo`,
      });
    }
    const expectedContributionAmount = roundMoney(
      Number(target.salesQuotaAmount) *
        (Number(target.expectedMarginPercent) / 100),
    );
    if (
      roundMoney(target.expectedContributionAmount) !==
      expectedContributionAmount
    ) {
      errors.push({
        code: "contribution_mismatch",
        message: `La contribucion esperada de ${target.sellerUserName} no coincide con la formula del modulo`,
      });
    }
  }

  for (const seller of eligibleSellers) {
    if (!seenSellerIds.has(seller.id)) {
      warnings.push({
        code: "missing_target_for_seller",
        message: `${seller.fullName} no tiene meta capturada en esta version`,
        sellerUserId: seller.id,
      });
    }
  }

  return {
    versionId,
    versionStatus: version.status,
    periodStatus: version.periodStatus,
    errors,
    warnings,
    canPublish: errors.length === 0,
    requiresOverride: errors.length === 0 && warnings.length > 0,
  };
}

router.use(async (_req, _res, next) => {
  await ensureCommercialPlanningSchema();
  next();
});

router.get(
  "/periods",
  requirePermission("planeacion_comercial.read"),
  async (req, res) => {
    const selectedYear = req.query.year ? Number(req.query.year) : null;
    const selectedQuarter = req.query.quarter
      ? Number(req.query.quarter)
      : null;

    const where = [];
    const params = [];
    if (Number.isInteger(selectedYear)) {
      where.push("p.plan_year = ?");
      params.push(selectedYear);
    }
    if (Number.isInteger(selectedQuarter)) {
      where.push("p.plan_quarter = ?");
      params.push(selectedQuarter);
    }

    const rows = await query(
      `SELECT p.*,
              COUNT(DISTINCT v.id) AS version_count,
              MAX(CASE WHEN v.status = 'active' THEN v.id ELSE NULL END) AS active_version_id,
              MAX(CASE WHEN v.status = 'active' THEN v.version_number ELSE NULL END) AS active_version_number,
              COUNT(DISTINCT CASE WHEN v.status = 'active' THEN t.id ELSE NULL END) AS target_count,
              COALESCE(SUM(CASE WHEN v.status = 'active' THEN t.sales_quota_amount ELSE 0 END), 0) AS total_quota_amount,
              COALESCE(SUM(CASE WHEN v.status = 'active' THEN t.expected_contribution_amount ELSE 0 END), 0) AS total_contribution_amount,
              AVG(CASE WHEN v.status = 'active' THEN t.expected_margin_percent ELSE NULL END) AS expected_margin_average_percent
       FROM commercial_planning_periods p
       LEFT JOIN commercial_planning_versions v ON v.period_id = p.id
       LEFT JOIN commercial_planning_targets t ON t.version_id = v.id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       GROUP BY p.id
       ORDER BY p.plan_year DESC, p.plan_quarter DESC`,
      params,
    );

    res.json({ periods: rows.map(mapPeriodRow) });
  },
);

router.post(
  "/periods",
  requirePermission("planeacion_comercial.create"),
  async (req, res) => {
    const parsed = periodSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const actorUserId = Number(req.user?.id) || null;
    const now = new Date();

    let createdPeriodId = null;
    let createdVersionId = null;
    try {
      await withTransaction(async (conn) => {
        const [existingRows] = await conn.query(
          `SELECT id
           FROM commercial_planning_periods
           WHERE plan_year = ? AND plan_quarter = ?`,
          [parsed.data.year, parsed.data.quarter],
        );
        if (existingRows.length) {
          const error = new Error(
            "Ya existe un periodo para ese ano y trimestre",
          );
          error.status = 409;
          throw error;
        }

        const [periodResult] = await conn.query(
          `INSERT INTO commercial_planning_periods
             (plan_year, plan_quarter, base_currency_code, status, notes,
              created_by_user_id, updated_by_user_id, created_at, updated_at)
           VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
          [
            parsed.data.year,
            parsed.data.quarter,
            parsed.data.baseCurrencyCode.trim().toUpperCase(),
            parsed.data.notes || null,
            actorUserId,
            actorUserId,
            now,
            now,
          ],
        );
        createdPeriodId = Number(periodResult.insertId);

        const label = `Version 1 · ${quarterLabel(parsed.data.year, parsed.data.quarter)}`;
        const [versionResult] = await conn.query(
          `INSERT INTO commercial_planning_versions
             (period_id, version_number, label, status, notes,
              created_by_user_id, updated_by_user_id, created_at, updated_at)
           VALUES (?, 1, ?, 'draft', ?, ?, ?, ?, ?)`,
          [
            createdPeriodId,
            label,
            parsed.data.notes || null,
            actorUserId,
            actorUserId,
            now,
            now,
          ],
        );
        createdVersionId = Number(versionResult.insertId);
      });
    } catch (error) {
      const status = Number(error?.status) || 500;
      return res
        .status(status)
        .json({ message: error.message || "No fue posible crear el periodo" });
    }

    const period = await getPeriodById(createdPeriodId);
    const versions = await getVersionsForPeriod(createdPeriodId);
    await logAuditEvent({
      req,
      module: "planeacion_comercial",
      action: "created_period",
      entityType: "commercial_planning_period",
      entityId: createdPeriodId,
      detail: `Periodo ${period.label} creado con Version 1 en borrador`,
      before: null,
      after: { ...period, createdVersionId },
    });

    res.status(201).json({
      message: "Periodo de planeacion comercial creado correctamente",
      period,
      versions,
      createdVersionId,
    });
  },
);

router.get(
  "/periods/:periodId",
  requirePermission("planeacion_comercial.read"),
  async (req, res) => {
    const period = await getPeriodById(Number(req.params.periodId));
    if (!period) {
      return res.status(404).json({ message: "Periodo no encontrado" });
    }

    const versions = await getVersionsForPeriod(period.id);
    res.json({ period, versions });
  },
);

router.post(
  "/periods/:periodId/versions",
  requirePermission("planeacion_comercial.create"),
  async (req, res) => {
    const parsed = createVersionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const actorUserId = Number(req.user?.id) || null;
    const periodId = Number(req.params.periodId);
    const period = await getPeriodById(periodId);
    if (!period) {
      return res.status(404).json({ message: "Periodo no encontrado" });
    }
    if (period.status === "closed") {
      return res
        .status(409)
        .json({
          message: "No se pueden crear nuevas versiones en un periodo cerrado",
        });
    }

    const now = new Date();
    let createdVersionId = null;
    await withTransaction(async (conn) => {
      const [versionRows] = await conn.query(
        `SELECT *
         FROM commercial_planning_versions
         WHERE period_id = ?
         ORDER BY version_number DESC`,
        [periodId],
      );

      const nextVersionNumber = Number(versionRows[0]?.version_number || 0) + 1;
      const sourceVersionId = parsed.data.sourceVersionId
        ? Number(parsed.data.sourceVersionId)
        : versionRows.find((row) => row.status === "active")?.id ||
          versionRows[0]?.id ||
          null;

      const label = `Version ${nextVersionNumber} · ${period.label}`;
      const [versionResult] = await conn.query(
        `INSERT INTO commercial_planning_versions
           (period_id, version_number, label, status, notes,
            created_by_user_id, updated_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
        [
          periodId,
          nextVersionNumber,
          label,
          parsed.data.notes || null,
          actorUserId,
          actorUserId,
          now,
          now,
        ],
      );
      createdVersionId = Number(versionResult.insertId);

      if (sourceVersionId) {
        await conn.query(
          `INSERT INTO commercial_planning_targets
             (version_id, seller_user_id, sales_quota_amount, currency_code,
              expected_margin_percent, expected_contribution_amount, notes, status,
              created_by_user_id, updated_by_user_id, created_at, updated_at)
           SELECT ?, seller_user_id, sales_quota_amount, currency_code,
                  expected_margin_percent, expected_contribution_amount, notes, status,
                  ?, ?, ?, ?
           FROM commercial_planning_targets
           WHERE version_id = ?`,
          [
            createdVersionId,
            actorUserId,
            actorUserId,
            now,
            now,
            Number(sourceVersionId),
          ],
        );
      }
    });

    const detail = await getVersionDetail(createdVersionId);
    await logAuditEvent({
      req,
      module: "planeacion_comercial",
      action: "created_version",
      entityType: "commercial_planning_version",
      entityId: createdVersionId,
      detail: `Creada ${detail.version.label} para ${detail.version.periodLabel}`,
      before: null,
      after: detail.version,
    });

    res.status(201).json({
      message: "Version de planeacion creada correctamente",
      version: detail.version,
      targets: detail.targets,
    });
  },
);

router.get(
  "/versions/:versionId",
  requirePermission("planeacion_comercial.read"),
  async (req, res) => {
    const detail = await getVersionDetail(Number(req.params.versionId));
    if (!detail) {
      return res.status(404).json({ message: "Version no encontrada" });
    }

    const eligibleSellers = await listEligibleSellers();
    const validation = await validateVersion(detail.version.id);
    res.json({ ...detail, eligibleSellers, validation });
  },
);

router.put(
  "/versions/:versionId/targets",
  requirePermission("planeacion_comercial.update"),
  async (req, res) => {
    const parsed = replaceTargetsSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const versionId = Number(req.params.versionId);
    const existingDetail = await getVersionDetail(versionId);
    if (!existingDetail) {
      return res.status(404).json({ message: "Version no encontrada" });
    }
    if (existingDetail.version.status !== "draft") {
      return res
        .status(409)
        .json({ message: "Solo se pueden editar metas en versiones borrador" });
    }

    const actorUserId = Number(req.user?.id) || null;
    const now = new Date();
    const normalizedTargets = parsed.data.targets.map((target) => ({
      sellerUserId: Number(target.sellerUserId),
      salesQuotaAmount: roundMoney(target.salesQuotaAmount),
      currencyCode: target.currencyCode.trim().toUpperCase(),
      expectedMarginPercent: Number(
        Number(target.expectedMarginPercent).toFixed(2),
      ),
      expectedContributionAmount: roundMoney(
        Number(target.salesQuotaAmount) *
          (Number(target.expectedMarginPercent) / 100),
      ),
      notes: target.notes || null,
      status: target.status || "complete",
    }));

    const duplicateSellerIds = normalizedTargets
      .map((target) => target.sellerUserId)
      .filter(
        (sellerUserId, index, list) => list.indexOf(sellerUserId) !== index,
      );
    if (duplicateSellerIds.length) {
      return res
        .status(400)
        .json({
          message: "No se permiten vendedores duplicados en la misma version",
        });
    }

    const beforeTargets = existingDetail.targets;

    await withTransaction(async (conn) => {
      await conn.query(
        `DELETE FROM commercial_planning_targets
         WHERE version_id = ?`,
        [versionId],
      );

      for (const target of normalizedTargets) {
        await conn.query(
          `INSERT INTO commercial_planning_targets
             (version_id, seller_user_id, sales_quota_amount, currency_code,
              expected_margin_percent, expected_contribution_amount, notes, status,
              created_by_user_id, updated_by_user_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            versionId,
            target.sellerUserId,
            target.salesQuotaAmount,
            target.currencyCode,
            target.expectedMarginPercent,
            target.expectedContributionAmount,
            target.notes,
            target.status,
            actorUserId,
            actorUserId,
            now,
            now,
          ],
        );
      }

      await conn.query(
        `UPDATE commercial_planning_versions
         SET updated_by_user_id = ?, updated_at = ?
         WHERE id = ?`,
        [actorUserId, now, versionId],
      );
    });

    const detail = await getVersionDetail(versionId);
    await logAuditEvent({
      req,
      module: "planeacion_comercial",
      action: "updated_targets",
      entityType: "commercial_planning_version",
      entityId: versionId,
      detail: `Metas trimestrales actualizadas en ${detail.version.label}`,
      before: {
        targets: beforeTargets.map((item) =>
          buildChangedTargetFields(null, item),
        ),
      },
      after: {
        targets: detail.targets.map((item) =>
          buildChangedTargetFields(null, item),
        ),
      },
    });

    res.json({
      message: "Metas trimestrales actualizadas correctamente",
      version: detail.version,
      targets: detail.targets,
      validation: await validateVersion(versionId),
    });
  },
);

router.post(
  "/versions/:versionId/validate",
  requirePermission("planeacion_comercial.read"),
  async (req, res) => {
    try {
      const validation = await validateVersion(Number(req.params.versionId));
      res.json(validation);
    } catch (error) {
      res
        .status(Number(error?.status) || 500)
        .json({
          message: error.message || "No fue posible validar la version",
        });
    }
  },
);

router.post(
  "/versions/:versionId/publish",
  requirePermission("planeacion_comercial.publish"),
  async (req, res) => {
    const parsed = publishSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const versionId = Number(req.params.versionId);
    const detail = await getVersionDetail(versionId);
    if (!detail) {
      return res.status(404).json({ message: "Version no encontrada" });
    }

    const validation = await validateVersion(versionId);
    if (validation.errors.length) {
      return res.status(409).json({
        message: "La version tiene errores duros y no puede publicarse",
        validation,
      });
    }
    if (
      validation.warnings.length &&
      !req.user?.permissionSet?.has("planeacion_comercial.override_validation")
    ) {
      return res.status(409).json({
        message:
          "La version tiene advertencias justificables y requiere permiso especial para publicarse",
        validation,
      });
    }
    if (
      validation.warnings.length &&
      !String(parsed.data.justification || "").trim()
    ) {
      return res.status(400).json({
        message:
          "Debes capturar una justificacion para publicar con advertencias",
        validation,
      });
    }

    const actorUserId = Number(req.user?.id) || null;
    const now = new Date();
    await withTransaction(async (conn) => {
      await conn.query(
        `UPDATE commercial_planning_versions
         SET status = 'archived', updated_by_user_id = ?, updated_at = ?
         WHERE period_id = ? AND status = 'active' AND id <> ?`,
        [actorUserId, now, detail.version.periodId, versionId],
      );

      await conn.query(
        `UPDATE commercial_planning_versions
         SET status = 'active', published_at = ?, published_by_user_id = ?,
             updated_by_user_id = ?, updated_at = ?
         WHERE id = ?`,
        [now, actorUserId, actorUserId, now, versionId],
      );

      await conn.query(
        `UPDATE commercial_planning_periods
         SET status = 'active', published_at = ?, published_by_user_id = ?,
             updated_by_user_id = ?, updated_at = ?
         WHERE id = ?`,
        [now, actorUserId, actorUserId, now, detail.version.periodId],
      );
    });

    const refreshed = await getVersionDetail(versionId);
    await logAuditEvent({
      req,
      module: "planeacion_comercial",
      action: "published_version",
      entityType: "commercial_planning_version",
      entityId: versionId,
      detail:
        validation.warnings.length && parsed.data.justification
          ? `Publicada ${refreshed.version.label} con justificacion: ${parsed.data.justification}`
          : `Publicada ${refreshed.version.label}`,
      before: { status: detail.version.status },
      after: {
        status: refreshed.version.status,
        publishedAt: refreshed.version.publishedAt,
        justification: parsed.data.justification || null,
      },
    });

    res.json({
      message: "Version publicada correctamente",
      version: refreshed.version,
      targets: refreshed.targets,
      validation,
    });
  },
);

router.post(
  "/periods/:periodId/close",
  requirePermission("planeacion_comercial.close"),
  async (req, res) => {
    const periodId = Number(req.params.periodId);
    const period = await getPeriodById(periodId);
    if (!period) {
      return res.status(404).json({ message: "Periodo no encontrado" });
    }
    if (period.status === "closed") {
      return res.status(409).json({ message: "El periodo ya esta cerrado" });
    }

    const actorUserId = Number(req.user?.id) || null;
    const now = new Date();
    await query(
      `UPDATE commercial_planning_periods
       SET status = 'closed', closed_at = ?, closed_by_user_id = ?,
           updated_at = ?, updated_by_user_id = ?
       WHERE id = ?`,
      [now, actorUserId, now, actorUserId, periodId],
    );

    const updatedPeriod = await getPeriodById(periodId);
    await logAuditEvent({
      req,
      module: "planeacion_comercial",
      action: "closed_period",
      entityType: "commercial_planning_period",
      entityId: periodId,
      detail: `Cerrado el periodo ${updatedPeriod.label}`,
      before: { status: period.status },
      after: { status: updatedPeriod.status, closedAt: updatedPeriod.closedAt },
    });

    res.json({
      message: "Periodo cerrado correctamente",
      period: updatedPeriod,
    });
  },
);

router.get(
  "/eligible-sellers",
  requirePermission("planeacion_comercial.read"),
  async (_req, res) => {
    res.json({ sellers: await listEligibleSellers() });
  },
);

router.get(
  "/audit",
  requirePermission("planeacion_comercial.audit.read"),
  async (req, res) => {
    const selectedYear = req.query.year ? Number(req.query.year) : null;
    const selectedQuarter = req.query.quarter
      ? Number(req.query.quarter)
      : null;
    const sellerUserId = req.query.sellerUserId
      ? Number(req.query.sellerUserId)
      : null;
    const where = [`module = 'planeacion_comercial'`];
    const params = [];

    if (Number.isInteger(selectedYear)) {
      where.push("detail LIKE ?");
      params.push(`%${selectedYear}%`);
    }
    if (Number.isInteger(selectedQuarter)) {
      where.push("detail LIKE ?");
      params.push(`%T${selectedQuarter}%`);
    }
    if (Number.isInteger(sellerUserId)) {
      where.push("changed_fields LIKE ?");
      params.push(`%\"sellerUserId\":${sellerUserId}%`);
    }

    const rows = await query(
      `SELECT id, action, entity_type, entity_id, detail, changed_fields,
              performed_by_user_id, performed_by_name, performed_by_email, created_at
       FROM audit_log
       WHERE ${where.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT 300`,
      params,
    );

    res.json({
      entries: rows.map((row) => ({
        id: Number(row.id),
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id === null ? null : Number(row.entity_id),
        detail: row.detail || "",
        changedFields: row.changed_fields ? JSON.parse(row.changed_fields) : {},
        performedByUserId:
          row.performed_by_user_id === null
            ? null
            : Number(row.performed_by_user_id),
        performedByName: row.performed_by_name || "",
        performedByEmail: row.performed_by_email || "",
        createdAt: row.created_at,
      })),
    });
  },
);

export default router;
