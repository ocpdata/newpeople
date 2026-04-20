import express from "express";
import { query } from "./db.js";
import { requirePermission } from "./auth.js";

const router = express.Router();

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

export default router;
