const FACT_SOURCES = Object.freeze({
  opportunities: ["amount_usd", "close_date", "sales_stage_id", "commercial_status_id", "contact_id", "account_id"],
  contacts: ["first_name", "last_name", "position_title"],
  opportunity_stage_question_answers: ["answer_value", "opportunity_id"],
  opportunity_workspace_actions: ["status", "due_date", "notes", "opportunity_id"],
  opportunity_notes: ["opportunity_id"],
  quotations: ["opportunity_id"],
  quotation_versions: ["status_id", "version_number", "quotation_id"],
  quotation_won_documents: ["opportunity_id", "document_role"],
});
const DATE_FIELDS = new Set(["close_date", "due_date"]);

function assertAllowed(table, fields) {
  const allowed = FACT_SOURCES[table];
  if (!allowed) throw new Error(`Tabla no permitida para hechos del banco: ${table}`);
  const invalid = fields.filter((field) => !allowed.includes(field));
  if (invalid.length) throw new Error(`Campos no permitidos en ${table}: ${invalid.join(", ")}`);
}

export function buildFactQuery(fact) {
  if (fact.where) {
    const fields = Object.keys(fact.where);
    assertAllowed(fact.table, fields);
    return {
      sql: `SELECT COUNT(*) AS value FROM ?? WHERE ${fields.map(() => "?? = ?").join(" AND ")}`,
      params: [fact.table, ...fields.flatMap((field) => [field, fact.where[field]])],
    };
  }
  assertAllowed(fact.table, [fact.field]);
  return {
    sql: DATE_FIELDS.has(fact.field)
      ? "SELECT DATE_FORMAT(??, '%Y-%m-%d') AS value FROM ?? WHERE id = ?"
      : "SELECT ?? AS value FROM ?? WHERE id = ?",
    params: [fact.field, fact.table, fact.id],
  };
}

export function compareFact(fact, rows) {
  if (fact.where) {
    const actual = Number(rows[0]?.value);
    return { ok: actual === fact.count, actual, expected: fact.count };
  }
  if (!rows.length) return { ok: false, actual: null, expected: fact.equals ?? fact.contains, reason: "registro_inexistente" };
  const actual = rows[0].value === null ? null : String(rows[0].value);
  if (fact.equals !== undefined) {
    return { ok: actual === String(fact.equals), actual, expected: fact.equals };
  }
  return { ok: actual !== null && actual.includes(fact.contains), actual, expected: fact.contains };
}

export async function verifyBankFacts(bank, run) {
  const results = [];
  for (const [factId, fact] of Object.entries(bank.facts)) {
    const { sql, params } = buildFactQuery(fact);
    const rows = await run(sql, params);
    const comparison = compareFact(fact, rows);
    results.push({
      factId,
      ok: comparison.ok,
      expected: comparison.expected,
      actual: typeof comparison.actual === "string" ? comparison.actual.slice(0, 300) : comparison.actual,
      ...(comparison.reason ? { reason: comparison.reason } : {}),
    });
  }
  return results;
}

export { withReadOnlyConnection } from "../commercial-intelligence/dossier/access.js";
