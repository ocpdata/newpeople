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

router.get(
  "/contact-accounts",
  requirePermission("contactos.read"),
  async (_req, res) => {
    const rows = await query(
      `SELECT id, name, country_id
       FROM accounts
       ORDER BY name`,
    );
    res.json(rows);
  },
);

router.get(
  "/contact-countries",
  requirePermission("contactos.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, iso2, iso3, name FROM countries WHERE is_active = 1 ORDER BY name",
    );
    res.json(rows);
  },
);

router.get(
  "/contact-purchase-participations",
  requirePermission("contactos.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name FROM contact_purchase_participations WHERE is_active = 1 ORDER BY id",
    );
    res.json(rows);
  },
);

router.get(
  "/contact-relationship-types",
  requirePermission("contactos.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name FROM contact_relationship_types WHERE is_active = 1 ORDER BY id",
    );
    res.json(rows);
  },
);

router.get(
  "/contact-employment-statuses",
  requirePermission("contactos.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name FROM contact_employment_statuses WHERE is_active = 1 ORDER BY id",
    );
    res.json(rows);
  },
);

router.get(
  "/contact-activation-statuses",
  requirePermission("contactos.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name FROM contact_activation_statuses WHERE is_active = 1 ORDER BY id",
    );
    res.json(rows);
  },
);

export default router;
