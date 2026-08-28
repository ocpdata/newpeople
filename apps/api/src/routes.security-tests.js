import express from "express";
import { z } from "zod";
import { requirePermission } from "./auth.js";
import {
  cancelSecurityTestJob,
  createSecurityTestJob,
  deleteSecurityTestJob,
  getSecurityTestJob,
  listSecurityTestCatalog,
  listSecurityTestJobs,
} from "./security-tests/service.js";
import { queueSecurityTestProcessing } from "./security-tests/async.js";

const router = express.Router();
const createSchema = z.object({
  scriptKey: z.string().trim().min(1).max(80),
  profileKey: z.string().trim().min(1).max(80),
  wafMode: z.enum(["monitoring", "blocking"]).default("monitoring"),
  testId: z.string().trim().min(1).max(80).optional(),
});

router.get("/catalog", requirePermission("pruebas.read"), (_req, res) => {
  res.json({ items: listSecurityTestCatalog() });
});

router.get("/jobs", requirePermission("pruebas.read"), async (_req, res) => {
  res.json({ items: await listSecurityTestJobs() });
});

router.post("/jobs", requirePermission("pruebas.execute"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "Datos invalidos", errors: parsed.error.flatten() });
  if ((parsed.data.profileKey === "f5" || parsed.data.wafMode === "blocking") && !req.user.permissionSet.has("pruebas.admin")) {
    return res.status(403).json({ message: "El perfil con F5 requiere permisos administrativos" });
  }
  try {
    const id = await createSecurityTestJob({ ...parsed.data, requestedByUserId: req.user.id, req });
    queueSecurityTestProcessing();
    return res.status(202).json({ job: await getSecurityTestJob(id) });
  } catch (error) {
    return res.status(Number(error?.status) || 500).json({ message: error?.message || "No fue posible iniciar la prueba" });
  }
});

router.get("/jobs/:id", requirePermission("pruebas.read"), async (req, res) => {
  const job = await getSecurityTestJob(req.params.id);
  if (!job) return res.status(404).json({ message: "Ejecucion no encontrada" });
  res.json({ job });
});

router.get("/jobs/:id/report", requirePermission("pruebas.read"), async (req, res) => {
  const job = await getSecurityTestJob(req.params.id, true);
  if (!job) return res.status(404).json({ message: "Ejecucion no encontrada" });
  if (!job.reportText) return res.status(409).json({ message: "El reporte aun no esta disponible" });
  res.type("text/tab-separated-values").send(job.reportText);
});

router.post("/jobs/:id/cancel", requirePermission("pruebas.execute"), async (req, res) => {
  if (!(await cancelSecurityTestJob(req.params.id, req))) return res.status(409).json({ message: "La ejecucion ya comenzo o no existe" });
  res.json({ message: "Ejecucion cancelada" });
});

router.delete("/jobs/:id", requirePermission("pruebas.admin"), async (req, res) => {
  const result = await deleteSecurityTestJob(req.params.id, req);
  if (!result.found) return res.status(404).json({ message: "Ejecucion no encontrada" });
  if (result.active) return res.status(409).json({ message: "No se puede eliminar una ejecucion activa; cancelala primero" });
  res.json({ message: "Ejecucion eliminada" });
});

export default router;
