import express from "express";
import { requireAnyPermission } from "./auth.js";
import { REPORT_PERMISSIONS } from "../../../shared/report-permissions.js";
import {
  getReportCatalogs,
  listOpportunitiesQuotationsReport,
  reportFiltersSchema,
} from "./reports/opportunities-quotations.js";
import { listOpportunityProfitability, profitabilityFiltersSchema } from "./reports/opportunity-profitability.js";

const router = express.Router();
const authorize = (report) => requireAnyPermission(Object.values(REPORT_PERMISSIONS[report]));

router.get("/opportunity-profitability/catalogs", authorize("profitability"), async (req, res) => {
  res.json(await getReportCatalogs(req.user, "profitability"));
});

router.get("/opportunity-profitability", authorize("profitability"), async (req, res) => {
  const parsed = profitabilityFiltersSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ message: "Filtros de reporte inválidos", errors: parsed.error.flatten() });
  }
  res.json(await listOpportunityProfitability(req.user, parsed.data));
});

router.get("/opportunities-quotations/catalogs", authorize("opportunitiesQuotations"), async (req, res) => {
  res.json(await getReportCatalogs(req.user));
});

router.get("/opportunities-quotations", authorize("opportunitiesQuotations"), async (req, res) => {
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
