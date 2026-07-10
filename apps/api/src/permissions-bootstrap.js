import { query } from "./db.js";

export async function isInitialRoleAssignmentRequired() {
  const rows = await query(
    "SELECT COUNT(*) AS total FROM role_permissions LIMIT 1",
  ).catch(() => []);
  return Number(rows[0]?.total || 0) === 0;
}
