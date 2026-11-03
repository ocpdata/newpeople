import express from "express";
import { requireAnyPermission, requirePermission } from "./auth.js";
import { QUOTATION_READ_PERMISSIONS } from "../../../shared/quotation-permissions.js";
import {
  getReportCatalogs,
  listOpportunitiesQuotationsReport,
  reportFiltersSchema,
} from "./reports/opportunities-quotations.js";

const router = express.Router();
router.use(requirePermission("oportunidades.read"), requireAnyPermission(QUOTATION_READ_PERMISSIONS));

router.get("/opportunities-quotations/catalogs", async (req, res) => {
  res.json(await getReportCatalogs(req.user));
});

router.get("/opportunities-quotations", async (req, res) => {
  const parsed = reportFiltersSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      message: "Filtros de reporte inválidos",
      errors: parsed.error.flatten(),
    });
  }
  res.json(await listOpportunitiesQuotationsReport(req.user, parsed.data));
});

export default router;
