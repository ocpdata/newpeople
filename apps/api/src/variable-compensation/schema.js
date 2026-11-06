import { query } from "../db.js";

let schemaPromise;

export async function ensureVariableCompensationSchema() {
  if (!schemaPromise) {
    schemaPromise = query(`CREATE TABLE IF NOT EXISTS variable_compensation_rules (
      id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
      rules_json LONGTEXT NOT NULL,
      validated TINYINT(1) NOT NULL DEFAULT 0,
      version INT NOT NULL DEFAULT 1,
      updated_by_user_id BIGINT UNSIGNED NOT NULL,
      updated_at DATETIME(3) NOT NULL
    )`).catch((error) => { schemaPromise = undefined; throw error; });
  }
  await schemaPromise;
}
