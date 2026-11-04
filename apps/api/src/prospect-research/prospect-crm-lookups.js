// What the CRM says about a prospect's neighborhood: customers that look like it, what was sold to them and who in the
// team already looks after a similar account. Everything is read with the seller's own account scope and summarized;
// the chat never queries the CRM itself and never presents any of this as data of the prospect.

const normalize = (value) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase();
const tokensOf = (value) => normalize(value).split(/[^a-z0-9]+/).filter((token) => token.length >= 4);

const MAX_CUSTOMERS = 5;
const MAX_LINES = 4;
const MAX_OWNERS = 3;
const GENERIC_SECTOR = "otros";

// The session stores the industry as free text; a sector matches when a significant word shares its first five letters.
export function matchEconomicSector(industry, sectors = []) {
  const words = tokensOf(industry).map((word) => word.slice(0, 5));
  if (!words.length) return null;
  return sectors.find((sector) => normalize(sector.name) !== GENERIC_SECTOR
    && tokensOf(sector.name).some((token) => words.includes(token.slice(0, 5)))) || null;
}

const isoDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

export function shapeSimilarCustomers({ basis, sector = null, rows = [], businessLines = [] }) {
  return {
    checked: true,
    basis,
    sector: sector?.name || null,
    scope: "Clientes del CRM con oportunidades ganadas que el usuario puede consultar; se parecen al prospecto solo por la base indicada.",
    customers: rows.slice(0, MAX_CUSTOMERS).map((row) => ({
      accountId: Number(row.id),
      name: row.name || "",
      country: row.country_name || "",
      sector: row.sector_name || "",
      wonOpportunities: Number(row.wins || 0),
      lastWonAt: isoDate(row.last_win),
    })),
    soldToSimilar: businessLines.slice(0, MAX_LINES).map((row) => ({
      businessLine: row.business_line,
      wonOpportunities: Number(row.wins || 0),
    })),
  };
}

// Accounts the user may read: all of them, or only those assigned to the user.
const scopeSql = (canReadAll) => (canReadAll ? "" : "AND EXISTS (SELECT 1 FROM account_owners ao WHERE ao.account_id = a.id AND ao.user_id = ?)");

export async function loadSimilarCustomers({ run, user, industry, countryId, excludeAccountIds = [], canReadAll }) {
  const sectors = await run(`SELECT id, name FROM economic_sectors WHERE is_active = 1`);
  const sector = matchEconomicSector(industry, sectors);
  const basis = sector ? (countryId ? "sector y país" : "sector") : countryId ? "país" : "none";
  if (basis === "none") return shapeSimilarCustomers({ basis, rows: [] });
  const params = [];
  const conditions = [];
  if (sector) {
    conditions.push("a.economic_sector_id = ?");
    params.push(Number(sector.id));
  } else {
    conditions.push("a.country_id = ?");
    params.push(Number(countryId));
  }
  const exclude = excludeAccountIds.map(Number).filter(Boolean);
  if (exclude.length) {
    conditions.push(`a.id NOT IN (${exclude.map(() => "?").join(",")})`);
    params.push(...exclude);
  }
  if (!canReadAll) params.push(Number(user.id));
  const rows = await run(
    `SELECT a.id, a.name, c.name AS country_name, es.name AS sector_name, w.wins, w.last_win
     FROM accounts a
     JOIN economic_sectors es ON es.id = a.economic_sector_id
     LEFT JOIN countries c ON c.id = a.country_id
     JOIN (SELECT o.account_id, COUNT(*) AS wins, MAX(o.commercial_closed_at) AS last_win
           FROM opportunities o JOIN opportunity_commercial_statuses cs ON cs.id = o.commercial_status_id
           WHERE cs.code = 'ganada' GROUP BY o.account_id) w ON w.account_id = a.id
     WHERE ${conditions.join(" AND ")} ${scopeSql(canReadAll)}
     ORDER BY (a.country_id <=> ?) DESC, w.wins DESC, a.name
     LIMIT ${MAX_CUSTOMERS}`,
    [...params, countryId ? Number(countryId) : null],
  );
  if (!rows.length) return shapeSimilarCustomers({ basis, sector, rows: [] });
  const ids = rows.map((row) => Number(row.id));
  const businessLines = await run(
    `SELECT bl.name AS business_line, COUNT(*) AS wins
     FROM opportunities o
     JOIN opportunity_commercial_statuses cs ON cs.id = o.commercial_status_id
     JOIN opportunity_business_lines bl ON bl.id = o.business_line_id
     WHERE cs.code = 'ganada' AND o.account_id IN (${ids.map(() => "?").join(",")})
     GROUP BY bl.name ORDER BY wins DESC, bl.name LIMIT ${MAX_LINES}`,
    ids,
  );
  return shapeSimilarCustomers({ basis, sector, rows, businessLines });
}

// Who looks after the accounts that resemble the prospect, so the seller knows whom to ask before writing.
export async function loadAccountOwners({ run, accountIds = [] }) {
  const ids = accountIds.map(Number).filter(Boolean);
  if (!ids.length) return {};
  const rows = await run(
    `SELECT ao.account_id, u.full_name
     FROM account_owners ao JOIN users u ON u.id = ao.user_id
     WHERE ao.account_id IN (${ids.map(() => "?").join(",")}) ORDER BY ao.assigned_at, u.full_name`,
    ids,
  );
  const owners = {};
  for (const row of rows) {
    const list = owners[row.account_id] ||= [];
    if (list.length < MAX_OWNERS && row.full_name) list.push(row.full_name);
  }
  return owners;
}
