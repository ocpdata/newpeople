import express from "express";
import { z } from "zod";
import { requireAnyPermission } from "./auth.js";
import {
  aggregateAiUsage,
  closeAdminPricingRate,
  createAdminPricingRate,
  getAdminWalletByUserId,
  getAiCreditSummaryByUserId,
  listAdminPricingRates,
  listAiUsageByUserId,
  syncOpenAiPricingRates,
} from "./ai-usage/service.js";
import { listUserAllocations, saveAllocationPlan } from "./ai-services/allocations.js";
import {
  acknowledgeAiServiceAlert,
  getAiServicesOverview,
  getAiServicesUsage,
  listAiServiceAlerts,
  saveAiServiceSettings,
} from "./ai-services/store.js";
import { AI_MODEL_ROLES, AI_MODULES, PINECONE_PLANS } from "./ai-services/catalog.js";

const router = express.Router();

const AI_SERVICES_READ_PERMISSIONS = ["ia.budget.read_all", "configuracion.read"];
const AI_SERVICES_MANAGE_PERMISSIONS = ["ia.budget.manage", "configuracion.update"];

const modelName = z.string().trim().max(120);
const roleModelsSchema = z.object(
  Object.fromEntries(AI_MODEL_ROLES.map((role) => [role.code, modelName.min(1)])),
);
const roleOverridesSchema = z.object(
  Object.fromEntries(AI_MODEL_ROLES.map((role) => [role.code, modelName.optional()])),
).partial();
const warningPercentSchema = z.number().int().min(1).max(99);
const onLimitSchema = z.enum(["warn", "stop"]);

const aiServicesSettingsBodySchema = z.object({
  expectedVersion: z.number().int().min(0),
  settings: z.object({
    providers: z.object({
      openai: z.object({
        models: roleModelsSchema,
        monthlyLimitUsd: z.number().positive().max(1_000_000).nullable(),
        warningPercent: warningPercentSchema,
        onLimit: onLimitSchema,
        balanceUsd: z.number().min(0).max(10_000_000).nullable().optional(),
        balanceWarningUsd: z.number().min(0).max(10_000_000).nullable().optional(),
        recaptureBalance: z.boolean().optional(),
      }),
      tavily: z.object({
        monthlyLimitCredits: z.number().int().positive().max(100_000_000).nullable(),
        usdPerCredit: z.number().min(0).max(10).nullable(),
        warningPercent: warningPercentSchema,
        onLimit: onLimitSchema,
      }),
      pinecone: z.object({
        plan: z.enum(Object.keys(PINECONE_PLANS)),
        warningPercent: warningPercentSchema,
      }),
    }),
    modules: z.object(
      Object.fromEntries(AI_MODULES.map((module) => [
        module.code,
        z.object({
          llmProvider: z.string().trim().min(2).max(20),
          tavily: z.boolean(),
          pinecone: z.boolean(),
          modelOverrides: roleOverridesSchema.optional(),
        }),
      ])),
    ).partial(),
  }),
});

const alertIdParamSchema = z.coerce.number().int().positive();

const isoDateSchema = z.string().datetime({ offset: true });

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

const allocationPlanBodySchema = z.object({
  expectedVersion: z.number().int().min(0),
  warningPercent: z.number().int().min(1).max(99),
  users: z.array(z.object({
    userId: z.number().int().positive(),
    percent: z.number().min(0).max(100).nullable(),
  })).max(5000),
});

router.get(
  "/admin/ai/allocations",
  requireAnyPermission(AI_SERVICES_READ_PERMISSIONS),
  async (_req, res) => {
    try {
      return res.json(await listUserAllocations());
    } catch (error) {
      const parsed = parseCommonError(error, "No fue posible cargar las asignaciones de crédito IA");
      return res.status(parsed.status).json(parsed.body);
    }
  },
);

router.put(
  "/admin/ai/allocations",
  requireAnyPermission(AI_SERVICES_MANAGE_PERMISSIONS),
  async (req, res) => {
    const parsedBody = allocationPlanBodySchema.safeParse(req.body || {});
    if (!parsedBody.success) {
      return res.status(400).json({ message: "Datos invalidos", errors: parsedBody.error.flatten() });
    }
    try {
      const plan = await saveAllocationPlan({ ...parsedBody.data, actorUserId: Number(req.user.id) });
      return res.json({ plan });
    } catch (error) {
      const parsed = parseCommonError(error, "No fue posible guardar las asignaciones de crédito IA");
      return res.status(parsed.status).json(parsed.body);
    }
  },
);

router.get(
  "/admin/ai/services",
  requireAnyPermission(AI_SERVICES_READ_PERMISSIONS),
  async (req, res) => {
    try {
      const overview = await getAiServicesOverview({
        refreshTavily: String(req.query.refreshTavily || "") === "true",
      });
      return res.json(overview);
    } catch (error) {
      const parsed = parseCommonError(error, "No fue posible cargar los servicios de IA");
      return res.status(parsed.status).json(parsed.body);
    }
  },
);

router.put(
  "/admin/ai/services/settings",
  requireAnyPermission(AI_SERVICES_MANAGE_PERMISSIONS),
  async (req, res) => {
    const parsedBody = aiServicesSettingsBodySchema.safeParse(req.body || {});
    if (!parsedBody.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsedBody.error.flatten(),
      });
    }
    try {
      const settings = await saveAiServiceSettings({
        settings: parsedBody.data.settings,
        expectedVersion: parsedBody.data.expectedVersion,
        actorUserId: Number(req.user.id),
      });
      return res.json({ settings });
    } catch (error) {
      const parsed = parseCommonError(error, "No fue posible guardar la configuración de IA");
      if (Array.isArray(error?.details)) parsed.body.details = error.details;
      return res.status(parsed.status).json(parsed.body);
    }
  },
);

router.get(
  "/admin/ai/services/usage",
  requireAnyPermission(AI_SERVICES_READ_PERMISSIONS),
  async (req, res) => {
    const { fromUtc, toUtc } = req.query;
    if (fromUtc && !isoDateSchema.safeParse(fromUtc).success) {
      return res.status(400).json({ message: "fromUtc invalido (ISO UTC)" });
    }
    if (toUtc && !isoDateSchema.safeParse(toUtc).success) {
      return res.status(400).json({ message: "toUtc invalido (ISO UTC)" });
    }
    try {
      const usage = await getAiServicesUsage({
        fromUtc: fromUtc ? String(fromUtc) : undefined,
        toUtc: toUtc ? String(toUtc) : undefined,
      });
      return res.json(usage);
    } catch (error) {
      const parsed = parseCommonError(error, "No fue posible cargar el consumo de IA");
      return res.status(parsed.status).json(parsed.body);
    }
  },
);

router.get(
  "/ai/services/alerts",
  requireAnyPermission(AI_SERVICES_READ_PERMISSIONS),
  async (_req, res) => {
    try {
      const items = await listAiServiceAlerts();
      return res.json({ items });
    } catch (error) {
      const parsed = parseCommonError(error, "No fue posible cargar los avisos de IA");
      return res.status(parsed.status).json(parsed.body);
    }
  },
);

router.post(
  "/ai/services/alerts/:alertId/acknowledge",
  requireAnyPermission(AI_SERVICES_MANAGE_PERMISSIONS),
  async (req, res) => {
    const alertId = alertIdParamSchema.safeParse(req.params.alertId);
    if (!alertId.success) {
      return res.status(400).json({ message: "alertId invalido" });
    }
    try {
      await acknowledgeAiServiceAlert({ alertId: alertId.data, actorUserId: Number(req.user.id) });
      return res.status(204).end();
    } catch (error) {
      const parsed = parseCommonError(error, "No fue posible marcar el aviso");
      return res.status(parsed.status).json(parsed.body);
    }
  },
);

export default router;
