import express from "express";
import { z } from "zod";
import { requireAnyPermission } from "./auth.js";
import {
  VariableRulesConflictError, buildVariableDashboard, currentBusinessQuarter, getVariableRules, saveVariableRules,
} from "./variable-compensation/service.js";

const router = express.Router();
const readPermissions = ["variable_comercial.read", "variable_comercial.update"];

const periodSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  quarter: z.coerce.number().int().min(1).max(4).optional(),
}).strict();
const saveRulesSchema = z.object({
  rules: z.unknown(),
  validated: z.boolean(),
  version: z.number().int().min(0).max(2147483646),
}).strict();

router.use(requireAnyPermission(readPermissions));

router.get("/", async (req, res) => {
  const parsed = periodSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Periodo inválido" });
  const current = currentBusinessQuarter();
  res.json(await buildVariableDashboard({
    year: parsed.data.year ?? current.year, quarter: parsed.data.quarter ?? current.quarter,
  }));
});

router.get("/rules", async (_req, res) => {
  res.json(await getVariableRules());
});

router.put("/rules", requireAnyPermission(["variable_comercial.update"]), async (req, res) => {
  const parsed = saveRulesSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Revisa los datos enviados" });
  try {
    res.json(await saveVariableRules(req, parsed.data));
  } catch (error) {
    if (error instanceof VariableRulesConflictError) {
      return res.status(409).json({ message: error.message, current: await getVariableRules() });
    }
    if (error.status === 400) return res.status(400).json({ message: error.message, errors: error.errors });
    throw error;
  }
});

export default router;
