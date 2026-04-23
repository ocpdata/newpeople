import express from "express";
import { query, withTransaction } from "./db.js";
import { requireAnyPermission, requirePermission } from "./auth.js";

const router = express.Router();
const ALLOWED_OPPORTUNITY_STAGE_QUESTION_RESPONSE_TYPES = new Set([
  "long_text",
]);

function isAdminUser(user) {
  return Boolean(user?.isAdmin);
}

function applyOwnedAccountScope({ user, accountExpression, params }) {
  if (isAdminUser(user)) return "";
  params.push(Number(user.id));
  return `INNER JOIN account_owners ao_scope ON ao_scope.account_id = ${accountExpression} AND ao_scope.user_id = ?`;
}

function normalizeQuestionPrompt(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function parseQuestionBoolean(value) {
  if (value === true || value === false) return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return null;
}

function parseDisplayOrder(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function clampDisplayOrder(displayOrder, maxOrder) {
  if (!displayOrder) return maxOrder;
  return Math.min(Math.max(displayOrder, 1), maxOrder);
}

function buildOpportunityStageQuestionCode(stageCode) {
  return `${stageCode}_manual_${Date.now()}_${Math.floor(
    Math.random() * 100000,
  )}`;
}

async function getOpportunitySalesStageById(stageId) {
  const rows = await query(
    `SELECT id, code, name, stage_order
     FROM opportunity_sales_stages
     WHERE id = ?
       AND is_active = 1
     LIMIT 1`,
    [stageId],
  );
  return rows.length ? rows[0] : null;
}

async function getOpportunityStageQuestionById(questionId) {
  const rows = await query(
    `SELECT q.id, q.sales_stage_id, q.code, q.prompt, q.response_type,
            q.display_order, q.is_required, q.is_active,
            s.code AS sales_stage_code, s.name AS sales_stage_name
     FROM opportunity_stage_questions q
     INNER JOIN opportunity_sales_stages s ON s.id = q.sales_stage_id
     WHERE q.id = ?
     LIMIT 1`,
    [questionId],
  );
  return rows.length ? rows[0] : null;
}

async function getOpportunityStageQuestionsByStageId(
  salesStageId,
  { includeInactive = false } = {},
) {
  const params = [salesStageId];
  const activeClause = includeInactive ? "" : "AND q.is_active = 1";
  return query(
    `SELECT q.id, q.sales_stage_id, q.code, q.prompt, q.response_type,
            q.display_order, q.is_required, q.is_active,
            s.code AS sales_stage_code, s.name AS sales_stage_name
     FROM opportunity_stage_questions q
     INNER JOIN opportunity_sales_stages s ON s.id = q.sales_stage_id
     WHERE q.sales_stage_id = ?
       ${activeClause}
       AND s.is_active = 1
     ORDER BY q.display_order, q.id`,
    params,
  );
}

async function makeRoomForStageQuestion(
  conn,
  salesStageId,
  displayOrder,
  excludeQuestionId = null,
) {
  const params = [salesStageId, displayOrder];
  let excludeClause = "";
  if (excludeQuestionId) {
    params.push(excludeQuestionId);
    excludeClause = "AND id <> ?";
  }
  const [rows] = await conn.query(
    `SELECT id, display_order
     FROM opportunity_stage_questions
     WHERE sales_stage_id = ?
       AND display_order >= ?
       ${excludeClause}
     ORDER BY display_order DESC, id DESC`,
    params,
  );

  for (const row of rows) {
    await conn.query(
      `UPDATE opportunity_stage_questions
       SET display_order = ?
       WHERE id = ?`,
      [Number(row.display_order) + 1, Number(row.id)],
    );
  }
}

async function moveStageQuestionWithinStage(conn, question, targetOrder) {
  const currentOrder = Number(question.display_order);
  if (currentOrder === targetOrder) {
    return;
  }

  await conn.query(
    `UPDATE opportunity_stage_questions
     SET display_order = 255
     WHERE id = ?`,
    [Number(question.id)],
  );

  if (targetOrder < currentOrder) {
    const [rows] = await conn.query(
      `SELECT id, display_order
       FROM opportunity_stage_questions
       WHERE sales_stage_id = ?
         AND display_order >= ?
         AND display_order < ?
       ORDER BY display_order DESC, id DESC`,
      [Number(question.sales_stage_id), targetOrder, currentOrder],
    );
    for (const row of rows) {
      await conn.query(
        `UPDATE opportunity_stage_questions
         SET display_order = ?
         WHERE id = ?`,
        [Number(row.display_order) + 1, Number(row.id)],
      );
    }
  } else {
    const [rows] = await conn.query(
      `SELECT id, display_order
       FROM opportunity_stage_questions
       WHERE sales_stage_id = ?
         AND display_order > ?
         AND display_order <= ?
       ORDER BY display_order ASC, id ASC`,
      [Number(question.sales_stage_id), currentOrder, targetOrder],
    );
    for (const row of rows) {
      await conn.query(
        `UPDATE opportunity_stage_questions
         SET display_order = ?
         WHERE id = ?`,
        [Number(row.display_order) - 1, Number(row.id)],
      );
    }
  }

  await conn.query(
    `UPDATE opportunity_stage_questions
     SET display_order = ?
     WHERE id = ?`,
    [targetOrder, Number(question.id)],
  );
}

function validateOpportunityStageQuestionPayload(body) {
  const salesStageId = Number(body?.salesStageId);
  const prompt = normalizeQuestionPrompt(body?.prompt);
  const responseType = String(body?.responseType || "").trim();
  const displayOrder = parseDisplayOrder(body?.displayOrder);
  const isRequired = parseQuestionBoolean(body?.isRequired);

  if (!Number.isInteger(salesStageId) || salesStageId <= 0) {
    return { ok: false, message: "salesStageId invalido" };
  }
  if (prompt.length < 5) {
    return {
      ok: false,
      message: "La pregunta debe tener al menos 5 caracteres",
    };
  }
  if (!ALLOWED_OPPORTUNITY_STAGE_QUESTION_RESPONSE_TYPES.has(responseType)) {
    return { ok: false, message: "Tipo de respuesta invalido" };
  }
  if (body?.displayOrder !== undefined && displayOrder === null) {
    return { ok: false, message: "displayOrder invalido" };
  }
  if (isRequired === null) {
    return { ok: false, message: "isRequired invalido" };
  }

  return {
    ok: true,
    value: {
      salesStageId,
      prompt,
      responseType,
      displayOrder,
      isRequired,
    },
  };
}

router.get(
  "/countries",
  requirePermission("cuentas.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, iso2, iso3, name FROM countries WHERE is_active = 1 ORDER BY name",
    );
    res.json(rows);
  },
);

router.get(
  "/currencies",
  requirePermission("cuentas.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name, symbol, decimals FROM currencies WHERE is_active = 1 ORDER BY name",
    );
    res.json(rows);
  },
);

router.get(
  "/account-types",
  requirePermission("cuentas.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name FROM account_types WHERE is_active = 1 ORDER BY name",
    );
    res.json(rows);
  },
);

router.get(
  "/economic-sectors",
  requirePermission("cuentas.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name FROM economic_sectors WHERE is_active = 1 ORDER BY name",
    );
    res.json(rows);
  },
);

router.get(
  "/account-activation-statuses",
  requirePermission("cuentas.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name FROM account_activation_statuses WHERE is_active = 1 ORDER BY id",
    );
    res.json(rows);
  },
);

router.get(
  "/account-owner-users",
  requirePermission("cuentas.read"),
  async (_req, res) => {
    const rows = await query(
      `SELECT id, full_name, email, status
       FROM users
       WHERE status = 'active'
       ORDER BY full_name`,
    );
    res.json(rows);
  },
);

router.get(
  "/contact-accounts",
  requirePermission("contactos.read"),
  async (req, res) => {
    const params = [];
    const ownershipJoin = applyOwnedAccountScope({
      user: req.user,
      accountExpression: "a.id",
      params,
    });
    const rows = await query(
      `SELECT a.id, a.name, a.country_id, a.state_region, a.city, a.address_line, a.postal_code
       FROM accounts a
       ${ownershipJoin}
       ORDER BY a.name`,
      params,
    );
    res.json(rows);
  },
);

router.get(
  "/contact-countries",
  requirePermission("contactos.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, iso2, iso3, name FROM countries WHERE is_active = 1 ORDER BY name",
    );
    res.json(rows);
  },
);

router.get(
  "/contact-purchase-participations",
  requirePermission("contactos.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name FROM contact_purchase_participations WHERE is_active = 1 ORDER BY id",
    );
    res.json(rows);
  },
);

router.get(
  "/contact-relationship-types",
  requirePermission("contactos.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name FROM contact_relationship_types WHERE is_active = 1 ORDER BY id",
    );
    res.json(rows);
  },
);

router.get(
  "/contact-employment-statuses",
  requirePermission("contactos.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name FROM contact_employment_statuses WHERE is_active = 1 ORDER BY id",
    );
    res.json(rows);
  },
);

router.get(
  "/contact-activation-statuses",
  requirePermission("contactos.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name FROM contact_activation_statuses WHERE is_active = 1 ORDER BY id",
    );
    res.json(rows);
  },
);

router.get(
  "/provider-countries",
  requirePermission("proveedores.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, iso2, iso3, name FROM countries WHERE is_active = 1 ORDER BY name",
    );
    res.json(rows);
  },
);

router.get(
  "/provider-activation-statuses",
  requirePermission("proveedores.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name FROM provider_activation_statuses WHERE is_active = 1 ORDER BY id",
    );
    res.json(rows);
  },
);

router.get(
  "/provider-price-list-item-statuses",
  requireAnyPermission(["proveedores.read", "proveedores_precios.read"]),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name FROM provider_price_list_item_statuses WHERE is_active = 1 ORDER BY id",
    );
    res.json(rows);
  },
);

router.get(
  "/provider-price-list-currencies",
  requireAnyPermission(["proveedores.read", "proveedores_precios.read"]),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name, symbol, decimals FROM currencies WHERE is_active = 1 ORDER BY name",
    );
    res.json(rows);
  },
);

router.get(
  "/opportunity-accounts",
  requirePermission("oportunidades.read"),
  async (req, res) => {
    const params = [];
    const ownershipJoin = applyOwnedAccountScope({
      user: req.user,
      accountExpression: "a.id",
      params,
    });
    const rows = await query(
      `SELECT a.id, a.name
       FROM accounts a
       ${ownershipJoin}
       ORDER BY a.name`,
      params,
    );
    res.json(rows);
  },
);

router.get(
  "/opportunity-contacts",
  requirePermission("oportunidades.read"),
  async (req, res) => {
    const params = [];
    const ownershipJoin = applyOwnedAccountScope({
      user: req.user,
      accountExpression: "c.account_id",
      params,
    });
    const rows = await query(
      `SELECT c.id, c.account_id,
              CONCAT(c.first_name, ' ', c.last_name) AS full_name
       FROM contacts c
       ${ownershipJoin}
       ORDER BY full_name`,
      params,
    );
    res.json(rows);
  },
);

router.get(
  "/opportunity-seller-users",
  requirePermission("oportunidades.read"),
  async (_req, res) => {
    const rows = await query(
      `SELECT DISTINCT u.id, u.full_name, u.email
       FROM users u
       INNER JOIN user_roles ur ON ur.user_id = u.id
       INNER JOIN roles r ON r.id = ur.role_id
       WHERE u.status = 'active'
         AND LOWER(TRIM(r.name)) = 'vendedor'
       ORDER BY u.full_name`,
    );
    res.json(rows);
  },
);

router.get(
  "/opportunity-presales-users",
  requirePermission("oportunidades.read"),
  async (_req, res) => {
    const rows = await query(
      `SELECT DISTINCT u.id, u.full_name, u.email
       FROM users u
       INNER JOIN user_roles ur ON ur.user_id = u.id
       INNER JOIN roles r ON r.id = ur.role_id
       WHERE u.status = 'active'
         AND LOWER(TRIM(r.name)) = 'preventa'
       ORDER BY u.full_name`,
    );
    res.json(rows);
  },
);

router.get(
  "/opportunity-business-lines",
  requirePermission("oportunidades.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name FROM opportunity_business_lines WHERE is_active = 1 ORDER BY name",
    );
    res.json(rows);
  },
);

router.get(
  "/opportunity-sales-stages",
  requirePermission("oportunidades.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name, stage_order FROM opportunity_sales_stages WHERE is_active = 1 ORDER BY stage_order",
    );
    res.json(rows);
  },
);

router.get(
  "/opportunity-commercial-statuses",
  requirePermission("oportunidades.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name FROM opportunity_commercial_statuses WHERE is_active = 1 ORDER BY id",
    );
    res.json(rows);
  },
);

router.get(
  "/opportunity-stage-questions",
  requirePermission("oportunidades.read"),
  async (req, res) => {
    const salesStageId = Number(req.query.salesStageId);
    if (!Number.isInteger(salesStageId) || salesStageId <= 0) {
      return res.status(400).json({ message: "salesStageId invalido" });
    }

    const rows = await query(
      `SELECT q.id, q.sales_stage_id, q.code, q.prompt, q.response_type,
              q.display_order, q.is_required, q.is_active
       FROM opportunity_stage_questions q
       INNER JOIN opportunity_sales_stages s ON s.id = q.sales_stage_id
       WHERE q.sales_stage_id = ?
         AND q.is_active = 1
         AND s.is_active = 1
       ORDER BY q.display_order, q.id`,
      [salesStageId],
    );
    res.json(rows);
  },
);

router.get(
  "/opportunity-stage-questions-admin",
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const salesStageId = Number(req.query.salesStageId);
    if (!Number.isInteger(salesStageId) || salesStageId <= 0) {
      return res.status(400).json({ message: "salesStageId invalido" });
    }

    const stage = await getOpportunitySalesStageById(salesStageId);
    if (!stage) {
      return res.status(404).json({ message: "Etapa de venta no encontrada" });
    }

    const rows = await getOpportunityStageQuestionsByStageId(salesStageId, {
      includeInactive: true,
    });
    res.json({
      salesStage: stage,
      responseTypes: Array.from(
        ALLOWED_OPPORTUNITY_STAGE_QUESTION_RESPONSE_TYPES,
      ),
      questions: rows,
    });
  },
);

router.post(
  "/opportunity-stage-questions",
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const parsed = validateOpportunityStageQuestionPayload(req.body);
    if (!parsed.ok) {
      return res.status(400).json({ message: parsed.message });
    }

    const stage = await getOpportunitySalesStageById(parsed.value.salesStageId);
    if (!stage) {
      return res.status(404).json({ message: "Etapa de venta no encontrada" });
    }

    const existingQuestions = await getOpportunityStageQuestionsByStageId(
      Number(stage.id),
      { includeInactive: true },
    );
    const targetOrder = clampDisplayOrder(
      parsed.value.displayOrder,
      existingQuestions.length + 1,
    );

    const questionId = await withTransaction(async (conn) => {
      await makeRoomForStageQuestion(conn, Number(stage.id), targetOrder);
      const [result] = await conn.query(
        `INSERT INTO opportunity_stage_questions
          (sales_stage_id, code, prompt, response_type, display_order, is_required, is_active)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [
          Number(stage.id),
          buildOpportunityStageQuestionCode(stage.code),
          parsed.value.prompt,
          parsed.value.responseType,
          targetOrder,
          parsed.value.isRequired ? 1 : 0,
        ],
      );
      return Number(result.insertId);
    });

    const question = await getOpportunityStageQuestionById(questionId);
    return res.status(201).json({
      message: "Pregunta creada correctamente",
      question,
    });
  },
);

router.put(
  "/opportunity-stage-questions/:id",
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const questionId = Number(req.params.id);
    if (!Number.isInteger(questionId) || questionId <= 0) {
      return res.status(400).json({ message: "questionId invalido" });
    }

    const question = await getOpportunityStageQuestionById(questionId);
    if (!question) {
      return res.status(404).json({ message: "Pregunta no encontrada" });
    }

    const parsed = validateOpportunityStageQuestionPayload(req.body);
    if (!parsed.ok) {
      return res.status(400).json({ message: parsed.message });
    }

    const targetStage = await getOpportunitySalesStageById(
      parsed.value.salesStageId,
    );
    if (!targetStage) {
      return res.status(404).json({ message: "Etapa de venta no encontrada" });
    }

    const targetStageQuestions = await getOpportunityStageQuestionsByStageId(
      Number(targetStage.id),
      { includeInactive: true },
    );
    const movingAcrossStages =
      Number(question.sales_stage_id) !== Number(targetStage.id);
    const targetOrder = clampDisplayOrder(
      parsed.value.displayOrder,
      movingAcrossStages
        ? targetStageQuestions.length + 1
        : targetStageQuestions.length,
    );

    await withTransaction(async (conn) => {
      if (!movingAcrossStages) {
        await moveStageQuestionWithinStage(
          conn,
          question,
          targetOrder || Number(question.display_order),
        );
        await conn.query(
          `UPDATE opportunity_stage_questions
           SET prompt = ?, response_type = ?, is_required = ?
           WHERE id = ?`,
          [
            parsed.value.prompt,
            parsed.value.responseType,
            parsed.value.isRequired ? 1 : 0,
            questionId,
          ],
        );
        return;
      }

      await conn.query(
        `UPDATE opportunity_stage_questions
         SET display_order = 255
         WHERE id = ?`,
        [questionId],
      );

      const [sourceRows] = await conn.query(
        `SELECT id, display_order
         FROM opportunity_stage_questions
         WHERE sales_stage_id = ?
           AND display_order > ?
         ORDER BY display_order ASC, id ASC`,
        [Number(question.sales_stage_id), Number(question.display_order)],
      );
      for (const row of sourceRows) {
        await conn.query(
          `UPDATE opportunity_stage_questions
           SET display_order = ?
           WHERE id = ?`,
          [Number(row.display_order) - 1, Number(row.id)],
        );
      }

      await makeRoomForStageQuestion(conn, Number(targetStage.id), targetOrder);

      await conn.query(
        `UPDATE opportunity_stage_questions
         SET sales_stage_id = ?, prompt = ?, response_type = ?,
             display_order = ?, is_required = ?
         WHERE id = ?`,
        [
          Number(targetStage.id),
          parsed.value.prompt,
          parsed.value.responseType,
          targetOrder,
          parsed.value.isRequired ? 1 : 0,
          questionId,
        ],
      );
    });

    const updatedQuestion = await getOpportunityStageQuestionById(questionId);
    return res.json({
      message: "Pregunta actualizada correctamente",
      question: updatedQuestion,
    });
  },
);

router.patch(
  "/opportunity-stage-questions/:id/status",
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const questionId = Number(req.params.id);
    if (!Number.isInteger(questionId) || questionId <= 0) {
      return res.status(400).json({ message: "questionId invalido" });
    }

    const nextIsActive = parseQuestionBoolean(req.body?.isActive);
    if (nextIsActive === null) {
      return res.status(400).json({ message: "isActive invalido" });
    }

    const question = await getOpportunityStageQuestionById(questionId);
    if (!question) {
      return res.status(404).json({ message: "Pregunta no encontrada" });
    }

    await query(
      `UPDATE opportunity_stage_questions
       SET is_active = ?
       WHERE id = ?`,
      [nextIsActive ? 1 : 0, questionId],
    );

    const updatedQuestion = await getOpportunityStageQuestionById(questionId);
    return res.json({
      message: nextIsActive
        ? "Pregunta activada correctamente"
        : "Pregunta desactivada correctamente",
      question: updatedQuestion,
    });
  },
);

router.post(
  "/opportunity-stage-questions/reorder",
  requirePermission("oportunidades.update"),
  async (req, res) => {
    const salesStageId = Number(req.body?.salesStageId);
    const questionIds = Array.isArray(req.body?.questionIds)
      ? req.body.questionIds.map((value) => Number(value))
      : [];

    if (!Number.isInteger(salesStageId) || salesStageId <= 0) {
      return res.status(400).json({ message: "salesStageId invalido" });
    }
    if (
      !questionIds.length ||
      questionIds.some((value) => !Number.isInteger(value) || value <= 0)
    ) {
      return res.status(400).json({ message: "questionIds invalidos" });
    }

    const stage = await getOpportunitySalesStageById(salesStageId);
    if (!stage) {
      return res.status(404).json({ message: "Etapa de venta no encontrada" });
    }

    const currentQuestions = await getOpportunityStageQuestionsByStageId(
      salesStageId,
      { includeInactive: true },
    );
    if (currentQuestions.length !== questionIds.length) {
      return res
        .status(400)
        .json({ message: "La lista de preguntas no coincide con la etapa" });
    }

    const currentIds = new Set(currentQuestions.map((row) => Number(row.id)));
    if (
      questionIds.some((id) => !currentIds.has(id)) ||
      currentIds.size !== questionIds.length
    ) {
      return res
        .status(400)
        .json({ message: "La lista de preguntas no coincide con la etapa" });
    }

    await withTransaction(async (conn) => {
      let working = currentQuestions.map((row) => ({
        id: Number(row.id),
        sales_stage_id: Number(row.sales_stage_id),
        display_order: Number(row.display_order),
      }));

      for (let index = 0; index < questionIds.length; index += 1) {
        const desiredId = Number(questionIds[index]);
        const desiredOrder = index + 1;
        const currentQuestion = working.find((row) => row.id === desiredId);
        if (!currentQuestion) continue;
        if (currentQuestion.display_order === desiredOrder) continue;

        await moveStageQuestionWithinStage(conn, currentQuestion, desiredOrder);

        const reordered = working.filter((row) => row.id !== desiredId);
        reordered.splice(desiredOrder - 1, 0, {
          ...currentQuestion,
          display_order: desiredOrder,
        });
        working = reordered.map((row, workingIndex) => ({
          ...row,
          display_order: workingIndex + 1,
        }));
      }
    });

    const questions = await getOpportunityStageQuestionsByStageId(
      salesStageId,
      {
        includeInactive: true,
      },
    );
    return res.json({
      message: "Orden actualizado correctamente",
      questions,
    });
  },
);

router.get(
  "/opportunity-activation-statuses",
  requirePermission("oportunidades.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name FROM opportunity_activation_statuses WHERE is_active = 1 ORDER BY id",
    );
    res.json(rows);
  },
);

export default router;
