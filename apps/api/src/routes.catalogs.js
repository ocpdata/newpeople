import express from "express";
import { query } from "./db.js";
import { requirePermission } from "./auth.js";

const router = express.Router();

function isAdminUser(user) {
  return Boolean(user?.isAdmin);
}

function applyOwnedAccountScope({ user, accountExpression, params }) {
  if (isAdminUser(user)) return "";
  params.push(Number(user.id));
  return `INNER JOIN account_owners ao_scope ON ao_scope.account_id = ${accountExpression} AND ao_scope.user_id = ?`;
}

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
  "/account-owner-users",
  requirePermission("cuentas.read"),
  async (_req, res) => {
    const rows = await query(
      `SELECT id, full_name, email, status
       FROM users
       WHERE status = 'active'
       ORDER BY full_name`,
    );
    res.json(rows);
  },
);

router.get(
  "/contact-accounts",
  requirePermission("contactos.read"),
  async (req, res) => {
    const params = [];
    const ownershipJoin = applyOwnedAccountScope({
      user: req.user,
      accountExpression: "a.id",
      params,
    });
    const rows = await query(
      `SELECT a.id, a.name, a.country_id, a.state_region, a.city, a.address_line, a.postal_code
       FROM accounts a
       ${ownershipJoin}
       ORDER BY a.name`,
      params,
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

router.get(
  "/opportunity-accounts",
  requirePermission("oportunidades.read"),
  async (req, res) => {
    const params = [];
    const ownershipJoin = applyOwnedAccountScope({
      user: req.user,
      accountExpression: "a.id",
      params,
    });
    const rows = await query(
      `SELECT a.id, a.name
       FROM accounts a
       ${ownershipJoin}
       ORDER BY a.name`,
      params,
    );
    res.json(rows);
  },
);

router.get(
  "/opportunity-contacts",
  requirePermission("oportunidades.read"),
  async (req, res) => {
    const params = [];
    const ownershipJoin = applyOwnedAccountScope({
      user: req.user,
      accountExpression: "c.account_id",
      params,
    });
    const rows = await query(
      `SELECT c.id, c.account_id,
              CONCAT(c.first_name, ' ', c.last_name) AS full_name
       FROM contacts c
       ${ownershipJoin}
       ORDER BY full_name`,
      params,
    );
    res.json(rows);
  },
);

router.get(
  "/opportunity-seller-users",
  requirePermission("oportunidades.read"),
  async (_req, res) => {
    const rows = await query(
      `SELECT DISTINCT u.id, u.full_name, u.email
       FROM users u
       INNER JOIN user_roles ur ON ur.user_id = u.id
       INNER JOIN roles r ON r.id = ur.role_id
       WHERE u.status = 'active'
         AND LOWER(TRIM(r.name)) = 'vendedor'
       ORDER BY u.full_name`,
    );
    res.json(rows);
  },
);

router.get(
  "/opportunity-presales-users",
  requirePermission("oportunidades.read"),
  async (_req, res) => {
    const rows = await query(
      `SELECT DISTINCT u.id, u.full_name, u.email
       FROM users u
       INNER JOIN user_roles ur ON ur.user_id = u.id
       INNER JOIN roles r ON r.id = ur.role_id
       WHERE u.status = 'active'
         AND LOWER(TRIM(r.name)) = 'preventa'
       ORDER BY u.full_name`,
    );
    res.json(rows);
  },
);

router.get(
  "/opportunity-business-lines",
  requirePermission("oportunidades.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name FROM opportunity_business_lines WHERE is_active = 1 ORDER BY name",
    );
    res.json(rows);
  },
);

router.get(
  "/opportunity-sales-stages",
  requirePermission("oportunidades.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name, stage_order FROM opportunity_sales_stages WHERE is_active = 1 ORDER BY stage_order",
    );
    res.json(rows);
  },
);

router.get(
  "/opportunity-activation-statuses",
  requirePermission("oportunidades.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name FROM opportunity_activation_statuses WHERE is_active = 1 ORDER BY id",
    );
    res.json(rows);
  },
);

export default router;
