import express from "express";
import { z } from "zod";
import { requireEvaluationPermission } from "../customer-chat-evaluations/service.js";
import { QUALITY_CHANNELS } from "./gates.js";
import { getChannelQualityOverview } from "./store.js";
import { runChannelProductionMonitor } from "./production-monitor.js";

const router = express.Router();
const channelSchema = z.enum(QUALITY_CHANNELS);
const daysSchema = z.coerce.number().int().min(1).max(365).default(90);

function parseChannel(value) {
  const parsed = channelSchema.safeParse(value);
  if (!parsed.success) {
    throw Object.assign(new Error("Canal de calidad no disponible"), { status: 404 });
  }
  return parsed.data;
}

// Same permissions as the Cliente existente evaluations: read to see the trend, execute to refresh production.
router.get("/:channel", async (req, res) => {
  requireEvaluationPermission(req.user, "read");
  res.json(await getChannelQualityOverview({ channel: parseChannel(req.params.channel), days: daysSchema.parse(req.query.days) }));
});

router.post("/:channel/production-snapshot", async (req, res) => {
  requireEvaluationPermission(req.user, "execute");
  res.json({ run: await runChannelProductionMonitor({ channel: parseChannel(req.params.channel), force: true, trigger: "manual" }) });
});

export default router;
