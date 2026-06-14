import express from "express";
import { z } from "zod";
import { requireAnyPermission } from "./auth.js";
import {
  adjustWalletCredit,
  aggregateAiUsage,
  closeAdminPricingRate,
  createAdminPricingRate,
  getAdminWalletByUserId,
  getAiCreditSummaryByUserId,
  grantWalletCredit,
  listAdminPricingRates,
  listAiUsageByUserId,
  listAdminWalletSummaries,
  syncOpenAiPricingRates,
  updateWalletPolicy,
} from "./ai-usage/service.js";

const router = express.Router();

const isoDateSchema = z.string().datetime({ offset: true });

const grantBodySchema = z.object({
  amountUsd: z.number().positive(),
  reasonCode: z.string().trim().min(2).max(50),
  reasonText: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().trim().min(8).max(120),
});

const adjustmentBodySchema = z.object({
  amountUsd: z.number().refine((value) => value !== 0, {
    message: "amountUsd debe ser distinto de 0",
  }),
  reasonCode: z.string().trim().min(2).max(50),
  reasonText: z.string().trim().min(4).max(500),
  idempotencyKey: z.string().trim().min(8).max(120),
});

const policyBodySchema = z
  .object({
    hardLimitEnabled: z.boolean().optional(),
    warningThresholdPercent: z.number().int().min(1).max(99).optional(),
    criticalThresholdPercent: z.number().int().min(1).max(100).optional(),
  })
  .refine(
    (value) =>
      value.hardLimitEnabled !== undefined ||
      value.warningThresholdPercent !== undefined ||
      value.criticalThresholdPercent !== undefined,
    {
      message: "No hay campos para actualizar",
    },
  );

const pricingRateBodySchema = z.object({
  provider: z.string().trim().min(2).max(20),
  model: z.string().trim().min(2).max(120),
  inputUsdPerMillionMicros: z.number().int().min(0),
  outputUsdPerMillionMicros: z.number().int().min(0),
  cachedInputUsdPerMillionMicros: z.number().int().min(0).optional(),
  validFromUtc: z.string().datetime({ offset: true }).optional(),
  validToUtc: z.string().datetime({ offset: true }).optional().nullable(),
  source: z.string().trim().min(2).max(80).optional(),
  sourceReference: z.string().trim().max(255).optional(),
});

const closePricingRateBodySchema = z.object({
  validToUtc: z.string().datetime({ offset: true }).optional(),
});

const pricingSyncBodySchema = z.object({
  dryRun: z.boolean().optional().default(true),
});

function toPositiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseCommonError(error, fallbackMessage) {
  const status = Number(error?.status) || 500;
  const code = String(error?.code || "").trim();
  const message = String(error?.message || "").trim() || fallbackMessage;
  return { status, body: { code: code || "UNEXPECTED_ERROR", message } };
}

router.get(
  "/admin/ai/pricing-rates",
  requireAnyPermission(["ia.budget.read_all", "configuracion.read"]),
  async (req, res) => {
    const activeOnly =
      String(req.query.activeOnly || "")
        .trim()
        .toLowerCase() === "true";
    try {
      const items = await listAdminPricingRates({
        provider: req.query.provider ? String(req.query.provider) : undefined,
        model: req.query.model ? String(req.query.model) : undefined,
        activeOnly,
      });
      return res.json({ items });
    } catch (error) {
      const parsed = parseCommonError(
        error,
        "No fue posible listar las tarifas de IA",
      );
      return res.status(parsed.status).json(parsed.body);
    }
  },
);

router.post(
  "/admin/ai/pricing-rates",
  requireAnyPermission(["ia.budget.manage", "configuracion.update"]),
  async (req, res) => {
    const parsedBody = pricingRateBodySchema.safeParse(req.body || {});
    if (!parsedBody.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsedBody.error.flatten(),
      });
    }

    try {
      const rate = await createAdminPricingRate({
        ...parsedBody.data,
        actorUserId: Number(req.user.id),
      });
      return res.status(201).json({ rate });
    } catch (error) {
      const parsed = parseCommonError(
        error,
        "No fue posible crear la tarifa de IA",
      );
      return res.status(parsed.status).json(parsed.body);
    }
  },
);

router.post(
  "/admin/ai/pricing-rates/:rateId/close",
  requireAnyPermission(["ia.budget.manage", "configuracion.update"]),
  async (req, res) => {
    const rateId = toPositiveId(req.params.rateId);
    if (!rateId) {
      return res.status(400).json({ message: "rateId invalido" });
    }

    const parsedBody = closePricingRateBodySchema.safeParse(req.body || {});
    if (!parsedBody.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsedBody.error.flatten(),
      });
    }

    try {
      const rate = await closeAdminPricingRate({
        rateId,
        validToUtc: parsedBody.data.validToUtc,
      });
      return res.json({ rate });
    } catch (error) {
      const parsed = parseCommonError(
        error,
        "No fue posible cerrar la vigencia de la tarifa",
      );
      return res.status(parsed.status).json(parsed.body);
    }
  },
);

router.post(
  "/admin/ai/pricing-rates/sync-openai",
  requireAnyPermission(["ia.budget.manage", "configuracion.update"]),
  async (req, res) => {
    const parsedBody = pricingSyncBodySchema.safeParse(req.body || {});
    if (!parsedBody.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsedBody.error.flatten(),
      });
    }

    try {
      const result = await syncOpenAiPricingRates({
        dryRun: parsedBody.data.dryRun,
        actorUserId: Number(req.user.id),
      });
      return res.json(result);
    } catch (error) {
      const parsed = parseCommonError(
        error,
        "No fue posible sincronizar las tarifas de IA",
      );
      return res.status(parsed.status).json(parsed.body);
    }
  },
);

router.get(
  "/admin/ai/wallets",
  requireAnyPermission(["ia.budget.read_all", "configuracion.read"]),
  async (_req, res) => {
    try {
      const items = await listAdminWalletSummaries();
      return res.json({ items });
    } catch (error) {
      const parsed = parseCommonError(
        error,
        "No fue posible listar las wallets de IA",
      );
      return res.status(parsed.status).json(parsed.body);
    }
  },
);

router.get("/ai/me/credit-summary", async (req, res) => {
  try {
    const summary = await getAiCreditSummaryByUserId(Number(req.user.id));
    return res.json(summary);
  } catch (error) {
    const parsed = parseCommonError(
      error,
      "No fue posible cargar el resumen de credito de IA",
    );
    return res.status(parsed.status).json(parsed.body);
  }
});

router.get("/ai/me/usage", async (req, res) => {
  const { fromUtc, toUtc, featureCode, limit, cursor } = req.query;

  if (fromUtc && !isoDateSchema.safeParse(fromUtc).success) {
    return res.status(400).json({ message: "fromUtc invalido (ISO UTC)" });
  }
  if (toUtc && !isoDateSchema.safeParse(toUtc).success) {
    return res.status(400).json({ message: "toUtc invalido (ISO UTC)" });
  }

  try {
    const result = await listAiUsageByUserId({
      userId: Number(req.user.id),
      fromUtc: fromUtc ? String(fromUtc) : undefined,
      toUtc: toUtc ? String(toUtc) : undefined,
      featureCode: featureCode ? String(featureCode) : undefined,
      limit: limit ? Number(limit) : 50,
      cursor: cursor ? Number(cursor) : null,
    });
    return res.json(result);
  } catch (error) {
    const parsed = parseCommonError(
      error,
      "No fue posible cargar el consumo de IA del usuario",
    );
    return res.status(parsed.status).json(parsed.body);
  }
});

router.get(
  "/admin/ai/wallets/:userId",
  requireAnyPermission(["ia.budget.read_all", "configuracion.read"]),
  async (req, res) => {
    const userId = toPositiveId(req.params.userId);
    if (!userId) {
      return res.status(400).json({ message: "userId invalido" });
    }

    try {
      const result = await getAdminWalletByUserId(userId);
      return res.json(result);
    } catch (error) {
      const parsed = parseCommonError(
        error,
        "No fue posible consultar la wallet del usuario",
      );
      return res.status(parsed.status).json(parsed.body);
    }
  },
);

router.post(
  "/admin/ai/wallets/:userId/grants",
  requireAnyPermission(["ia.budget.manage", "configuracion.update"]),
  async (req, res) => {
    const userId = toPositiveId(req.params.userId);
    if (!userId) {
      return res.status(400).json({ message: "userId invalido" });
    }

    const parsedBody = grantBodySchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsedBody.error.flatten(),
      });
    }

    try {
      const result = await grantWalletCredit({
        userId,
        amountUsd: parsedBody.data.amountUsd,
        reasonCode: parsedBody.data.reasonCode,
        reasonText: parsedBody.data.reasonText,
        idempotencyKey: parsedBody.data.idempotencyKey,
        actorUserId: Number(req.user.id),
      });
      return res.status(201).json(result);
    } catch (error) {
      const parsed = parseCommonError(
        error,
        "No fue posible otorgar credito de IA",
      );
      return res.status(parsed.status).json(parsed.body);
    }
  },
);

router.post(
  "/admin/ai/wallets/:userId/adjustments",
  requireAnyPermission(["ia.budget.manage", "configuracion.update"]),
  async (req, res) => {
    const userId = toPositiveId(req.params.userId);
    if (!userId) {
      return res.status(400).json({ message: "userId invalido" });
    }

    const parsedBody = adjustmentBodySchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsedBody.error.flatten(),
      });
    }

    try {
      const result = await adjustWalletCredit({
        userId,
        amountUsd: parsedBody.data.amountUsd,
        reasonCode: parsedBody.data.reasonCode,
        reasonText: parsedBody.data.reasonText,
        idempotencyKey: parsedBody.data.idempotencyKey,
        actorUserId: Number(req.user.id),
      });
      return res.status(201).json(result);
    } catch (error) {
      const parsed = parseCommonError(
        error,
        "No fue posible aplicar el ajuste de IA",
      );
      return res.status(parsed.status).json(parsed.body);
    }
  },
);

router.patch(
  "/admin/ai/wallets/:userId/policy",
  requireAnyPermission(["ia.budget.manage", "configuracion.update"]),
  async (req, res) => {
    const userId = toPositiveId(req.params.userId);
    if (!userId) {
      return res.status(400).json({ message: "userId invalido" });
    }

    const parsedBody = policyBodySchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsedBody.error.flatten(),
      });
    }

    try {
      const wallet = await updateWalletPolicy({
        userId,
        hardLimitEnabled: parsedBody.data.hardLimitEnabled,
        warningThresholdPercent: parsedBody.data.warningThresholdPercent,
        criticalThresholdPercent: parsedBody.data.criticalThresholdPercent,
      });
      return res.json(wallet);
    } catch (error) {
      const parsed = parseCommonError(
        error,
        "No fue posible actualizar la politica de wallet IA",
      );
      return res.status(parsed.status).json(parsed.body);
    }
  },
);

router.get(
  "/admin/ai/usage/aggregate",
  requireAnyPermission([
    "ia.usage.read_all",
    "ia.budget.read_all",
    "configuracion.read",
  ]),
  async (req, res) => {
    const { fromUtc, toUtc, groupBy } = req.query;

    if (fromUtc && !isoDateSchema.safeParse(fromUtc).success) {
      return res.status(400).json({ message: "fromUtc invalido (ISO UTC)" });
    }
    if (toUtc && !isoDateSchema.safeParse(toUtc).success) {
      return res.status(400).json({ message: "toUtc invalido (ISO UTC)" });
    }

    try {
      const result = await aggregateAiUsage({
        fromUtc: fromUtc ? String(fromUtc) : undefined,
        toUtc: toUtc ? String(toUtc) : undefined,
        groupBy: groupBy ? String(groupBy) : "user",
      });
      return res.json(result);
    } catch (error) {
      const parsed = parseCommonError(
        error,
        "No fue posible cargar el reporte agregado de IA",
      );
      return res.status(parsed.status).json(parsed.body);
    }
  },
);

export default router;
