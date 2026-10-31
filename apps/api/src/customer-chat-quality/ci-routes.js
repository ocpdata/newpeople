import { createHash, timingSafeEqual } from "node:crypto";
import express from "express";
import { z } from "zod";
import { config } from "../config.js";
import { getQualitySettings, recordQualityRun } from "./store.js";

export const CI_TOKEN_MIN_LENGTH = 32;
const MAX_CLOCK_SKEW_MS = 60 * 60 * 1000;

const group = z.object({ passed: z.number().int().min(0), total: z.number().int().min(0) }).strict()
  .refine((value) => value.passed <= value.total, "Los aciertos no pueden superar el total.");
const failedItem = z.object({
  group: z.string().max(40).optional(),
  id: z.union([z.string().max(120), z.number()]).nullish(),
  expected: z.string().max(120).nullish(),
  passed: z.boolean(),
  error: z.string().max(300).nullish(),
});

export const ciReportSchema = z.object({
  source: z.enum(["contract", "pipeline"]),
  commit: z.string().regex(/^[0-9a-f]{7,40}$/i).optional(),
  report: z.object({
    model: z.string().max(80).optional(),
    evaluatedAt: z.string().datetime(),
    groups: z.record(z.string().max(40), group).optional(),
    results: z.array(failedItem).max(200).optional(),
    scenarios: z.array(z.object({ name: z.string().max(200), status: z.string().max(20) })).max(50).optional(),
  }),
}).superRefine((value, context) => {
  const present = value.source === "pipeline" ? value.report.scenarios?.length : Object.keys(value.report.groups || {}).length;
  if (!present) context.addIssue({ code: "custom", message: "El reporte no contiene resultados.", path: ["report"] });
  if (new Date(value.report.evaluatedAt).getTime() > Date.now() + MAX_CLOCK_SKEW_MS) {
    context.addIssue({ code: "custom", message: "La fecha de evaluación está en el futuro.", path: ["report", "evaluatedAt"] });
  }
});

const digest = (value) => createHash("sha256").update(String(value)).digest();

// Compares digests so the comparison time does not depend on how much of the token matches.
export function tokenMatches(received, expected) {
  return Boolean(expected) && timingSafeEqual(digest(received), digest(expected));
}

export function requireCiToken(req, res, next) {
  const expected = config.customerChatQuality.ciToken;
  if (expected.length < CI_TOKEN_MIN_LENGTH) {
    return res.status(503).json({ message: "La integración con el flujo semanal no está configurada." });
  }
  const received = /^Bearer (.+)$/.exec(req.get("Authorization") || "")?.[1] || "";
  if (!tokenMatches(received, expected)) return res.status(401).json({ message: "Token inválido." });
  return next();
}

const router = express.Router();
router.use(requireCiToken);

router.get("/status", async (_req, res, next) => {
  try {
    const settings = await getQualitySettings();
    res.set("Cache-Control", "no-store").json({ weeklyEnabled: settings.weeklyEnabled });
  } catch (error) { next(error); }
});

router.post("/reports", async (req, res, next) => {
  try {
    const parsed = ciReportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Reporte inválido.", issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) });
    }
    const { source, commit, report } = parsed.data;
    const run = await recordQualityRun({
      source, report, model: report.model, commitSha: commit || null, trigger: "ci", evaluatedAt: report.evaluatedAt,
    });
    return res.status(run.duplicate ? 200 : 201).json({ id: run.id, status: run.status, reasons: run.reasons, duplicate: Boolean(run.duplicate) });
  } catch (error) { return next(error); }
});

export default router;
