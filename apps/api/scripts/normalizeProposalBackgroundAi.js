import { query, withTransaction, pool } from "../src/db.js";

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function getOptionValue(prefix) {
  const entry = process.argv.find((arg) => arg.startsWith(`${prefix}=`));
  if (!entry) return null;
  const [, value] = entry.split("=");
  return value == null ? null : String(value).trim();
}

function asNullableInt(value) {
  const normalized = Number(value || 0);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : null;
}

function printRows(rows) {
  for (const row of rows) {
    console.log(
      JSON.stringify(
        {
          proposalId: Number(row.proposal_id),
          componentId: Number(row.component_id),
          current: {
            aiEnabled:
              row.current_ai_enabled == null
                ? null
                : Number(row.current_ai_enabled) === 1,
            aiMode: row.current_ai_mode || null,
            aiCapabilityKey: row.current_ai_capability_key || null,
          },
          target: {
            aiEnabled:
              row.target_ai_enabled == null
                ? null
                : Number(row.target_ai_enabled) === 1,
            aiMode: row.target_ai_mode || null,
            aiCapabilityKey: row.target_ai_capability_key || null,
          },
          proposalStatus: row.proposal_status_code,
          proposalArchivedAt: row.proposal_archived_at || null,
        },
        null,
        2,
      ),
    );
  }
}

async function exec(conn, sql, params = []) {
  const [rows] = await conn.query(sql, params);
  return rows;
}

async function main() {
  const apply = hasFlag("--apply");
  const includeArchived = hasFlag("--include-archived");
  const proposalId = asNullableInt(getOptionValue("--proposal-id"));
  const backupTable =
    getOptionValue("--backup-table") ||
    "proposal_component_background_ai_fix_backup";

  const configRows = await query(
    `SELECT pcc.id AS config_id,
            pccp.component_code,
            pccp.ai_enabled,
            pccp.ai_mode,
            pccp.ai_capability_key
     FROM proposal_content_configs pcc
     INNER JOIN proposal_content_components pccp
             ON pccp.proposal_content_config_id = pcc.id
     WHERE pcc.singleton_key = 'default'
       AND pccp.component_code = 'background'
     LIMIT 1`,
  );

  if (!configRows.length) {
    throw new Error(
      "No existe configuracion activa para componente background en proposal_content_components.",
    );
  }

  const config = configRows[0];
  const targetAiEnabled = Number(config.ai_enabled) === 1 ? 1 : 0;
  const targetAiMode = targetAiEnabled
    ? String(config.ai_mode || "auto")
    : null;
  const targetAiCapabilityKey = targetAiEnabled
    ? String(config.ai_capability_key || "proposal.background")
    : null;

  const whereSql = [
    `pc.component_code = 'background'`,
    includeArchived ? `1=1` : `p.archived_at IS NULL`,
    proposalId ? `pc.proposal_id = ?` : `1=1`,
    `NOT (
      pc.ai_enabled <=> ?
      AND pc.ai_mode <=> ?
      AND pc.ai_capability_key <=> ?
    )`,
  ].join("\n       AND ");

  const baseParams = [
    ...(proposalId ? [proposalId] : []),
    targetAiEnabled,
    targetAiMode,
    targetAiCapabilityKey,
  ];

  const previewRows = await query(
    `SELECT pc.id AS component_id,
            pc.proposal_id,
            pc.ai_enabled AS current_ai_enabled,
            pc.ai_mode AS current_ai_mode,
            pc.ai_capability_key AS current_ai_capability_key,
            ? AS target_ai_enabled,
            ? AS target_ai_mode,
            ? AS target_ai_capability_key,
            p.status_code AS proposal_status_code,
            p.archived_at AS proposal_archived_at
     FROM proposal_components pc
     INNER JOIN proposals p ON p.id = pc.proposal_id
     WHERE ${whereSql}
     ORDER BY pc.proposal_id ASC`,
    [targetAiEnabled, targetAiMode, targetAiCapabilityKey, ...baseParams],
  );

  console.log("\n=== Normalizacion de IA para Antecedentes ===");
  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        includeArchived,
        proposalId: proposalId || null,
        target: {
          aiEnabled: targetAiEnabled === 1,
          aiMode: targetAiMode,
          aiCapabilityKey: targetAiCapabilityKey,
        },
        affectedCount: previewRows.length,
      },
      null,
      2,
    ),
  );

  if (!previewRows.length) {
    console.log("No hay filas por normalizar.");
    return;
  }

  console.log("\nMuestra de filas afectadas (max 20):");
  printRows(previewRows.slice(0, 20));

  if (!apply) {
    console.log(
      "\nDry-run finalizado. Para aplicar cambios, ejecuta con --apply.",
    );
    return;
  }

  const runId = `bg_ai_fix_${Date.now()}`;

  await withTransaction(async (conn) => {
    await exec(
      conn,
      `CREATE TABLE IF NOT EXISTS ${backupTable} (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        run_id VARCHAR(64) NOT NULL,
        proposal_component_id BIGINT UNSIGNED NOT NULL,
        proposal_id BIGINT UNSIGNED NOT NULL,
        component_code VARCHAR(80) NOT NULL,
        previous_ai_enabled TINYINT(1) NULL,
        previous_ai_mode VARCHAR(20) NULL,
        previous_ai_capability_key VARCHAR(120) NULL,
        target_ai_enabled TINYINT(1) NULL,
        target_ai_mode VARCHAR(20) NULL,
        target_ai_capability_key VARCHAR(120) NULL,
        created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
        PRIMARY KEY (id),
        KEY idx_bg_ai_fix_run_id (run_id),
        KEY idx_bg_ai_fix_component (proposal_component_id)
      )`,
    );

    await exec(
      conn,
      `INSERT INTO ${backupTable}
          (run_id, proposal_component_id, proposal_id, component_code,
           previous_ai_enabled, previous_ai_mode, previous_ai_capability_key,
           target_ai_enabled, target_ai_mode, target_ai_capability_key)
       SELECT ?,
              pc.id,
              pc.proposal_id,
              pc.component_code,
              pc.ai_enabled,
              pc.ai_mode,
              pc.ai_capability_key,
              ?,
              ?,
              ?
       FROM proposal_components pc
       INNER JOIN proposals p ON p.id = pc.proposal_id
       WHERE ${whereSql}`,
      [
        runId,
        targetAiEnabled,
        targetAiMode,
        targetAiCapabilityKey,
        ...baseParams,
      ],
    );

    await exec(
      conn,
      `UPDATE proposal_components pc
       INNER JOIN proposals p ON p.id = pc.proposal_id
       SET pc.ai_enabled = ?,
           pc.ai_mode = ?,
           pc.ai_capability_key = ?,
           pc.updated_at = NOW(3)
       WHERE ${whereSql}`,
      [targetAiEnabled, targetAiMode, targetAiCapabilityKey, ...baseParams],
    );

    console.log(`\nCambios aplicados con run_id=${runId}`);
    console.log(`Respaldo almacenado en tabla ${backupTable}.`);
    console.log("\nRollback sugerido:");
    console.log(
      `UPDATE proposal_components pc INNER JOIN ${backupTable} b ON b.proposal_component_id = pc.id SET pc.ai_enabled = b.previous_ai_enabled, pc.ai_mode = b.previous_ai_mode, pc.ai_capability_key = b.previous_ai_capability_key, pc.updated_at = NOW(3) WHERE b.run_id = '${runId}';`,
    );
  });
}

main()
  .catch((error) => {
    console.error("Error al normalizar IA de Antecedentes:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
