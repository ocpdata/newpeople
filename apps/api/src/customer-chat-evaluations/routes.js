import express from "express";
import { z } from "zod";
import { getEvaluationCatalog } from "./catalog.js";
import {
  requireEvaluationPermission, preflightEvaluation, createEvaluation, listEvaluations,
  getEvaluation, getEvaluationCase, cancelEvaluation, reviewEvaluationCase, exportEvaluation,
} from "./service.js";
import { queueEvaluationProcessing } from "./async.js";
import { confirmEvaluationAction, readEvaluationActions } from "./actions.js";

const router = express.Router();
router.use((req, _res, next) => { requireEvaluationPermission(req.user); next(); });
const id = (value) => z.string().uuid().parse(value);
const page = (value) => z.coerce.number().int().min(1).max(100000).default(1).parse(value);
const caseId = (value) => z.coerce.number().int().positive().parse(value);
router.get("/catalog", async (_req, res) => res.json(await getEvaluationCatalog()));
router.post("/preflight", async (req, res) => res.json(await preflightEvaluation(req.user)));
router.get("/runs", async (req, res) => res.json(await listEvaluations(req.user, page(req.query.page))));
router.post("/runs", async (req, res) => {
  const run = await createEvaluation(req.user, req.body);
  queueEvaluationProcessing();
  res.status(run.reused ? 200 : 202).json(run);
});
router.get("/runs/:id", async (req, res) => res.json(await getEvaluation(req.user, id(req.params.id), page(req.query.page))));
router.get("/runs/:id/export", async (req, res) => {
  const runId = id(req.params.id);
  res.set("Content-Disposition", `attachment; filename="customer-chat-evaluation-${runId}.json"`);
  res.json(await exportEvaluation(req.user, runId));
});
router.get("/runs/:id/cases/:caseId", async (req, res) =>
  res.json(await getEvaluationCase(req.user, id(req.params.id), caseId(req.params.caseId))));
router.post("/runs/:id/cancel", async (req, res) =>
  res.json(await cancelEvaluation(req.user, id(req.params.id))));
router.post("/runs/:id/cases/:caseId/review", async (req, res) =>
  res.json(await reviewEvaluationCase(req.user, id(req.params.id), caseId(req.params.caseId), req.body)));
router.post("/runs/:id/cases/:caseId/actions", async (req, res) =>
  res.json(await confirmEvaluationAction(req, id(req.params.id), caseId(req.params.caseId), req.body)));
router.get("/runs/:id/cases/:caseId/actions", async (req, res) =>
  res.json(await readEvaluationActions(req, id(req.params.id), caseId(req.params.caseId))));
router.use((error, _req, res, next) => {
  if (error instanceof z.ZodError) return res.status(400).json({ message: "Solicitud de evaluación inválida", issues: error.issues });
  if (error.status) return res.status(error.status).json({ message: error.message });
  next(error);
});
export default router;
