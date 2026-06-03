import { config } from "../src/config.js";
import { pool, query } from "../src/db.js";

function parseArgs(argv) {
  const options = {
    json: false,
    providerId: null,
    priceListId: null,
    limitGroups: null,
  };

  for (const rawArg of argv) {
    const arg = String(rawArg || "").trim();
    if (!arg) continue;
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg.startsWith("--provider-id=")) {
      const value = Number(arg.split("=")[1]);
      options.providerId = Number.isInteger(value) && value > 0 ? value : null;
      continue;
    }
    if (arg.startsWith("--price-list-id=")) {
      const value = Number(arg.split("=")[1]);
      options.priceListId = Number.isInteger(value) && value > 0 ? value : null;
      continue;
    }
    if (arg.startsWith("--limit-groups=")) {
      const value = Number(arg.split("=")[1]);
      options.limitGroups = Number.isInteger(value) && value > 0 ? value : null;
    }
  }

  return options;
}

function buildFilters(options) {
  const conditions = [];
  const params = [];

  if (options.providerId) {
    conditions.push("ppl.provider_id = ?");
    params.push(Number(options.providerId));
  }

  if (options.priceListId) {
    conditions.push("ppl.id = ?");
    params.push(Number(options.priceListId));
  }

  return {
    sql: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function compareRowsForKeepCandidate(left, right) {
  const leftIsActive = left.activationStatusCode === "activo" ? 1 : 0;
  const rightIsActive = right.activationStatusCode === "activo" ? 1 : 0;
  if (leftIsActive !== rightIsActive) {
    return rightIsActive - leftIsActive;
  }

  const leftCreatedAt = left.createdAt ? new Date(left.createdAt).getTime() : 0;
  const rightCreatedAt = right.createdAt ? new Date(right.createdAt).getTime() : 0;
  if (leftCreatedAt !== rightCreatedAt) {
    return leftCreatedAt - rightCreatedAt;
  }

  return Number(left.id) - Number(right.id);
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString();
}

async function loadDuplicateRows(options) {
  const filters = buildFilters(options);
  const rows = await query(
    `SELECT
       p.id AS provider_id,
       p.name AS provider_name,
       ppl.id AS price_list_id,
       ppl.name AS price_list_name,
       ppli.id,
       ppli.code,
       ppli.description,
       ppli.item_type,
       ppli.price,
       curr.code AS currency_code,
       pils.code AS activation_status_code,
       ppli.created_at,
       ppli.updated_at,
       REPLACE(UPPER(TRIM(ppli.code)), ' ', '') AS normalized_code
     FROM provider_price_list_items ppli
     INNER JOIN provider_price_lists ppl ON ppl.id = ppli.price_list_id
     INNER JOIN providers p ON p.id = ppl.provider_id
     INNER JOIN currencies curr ON curr.id = ppli.currency_id
     INNER JOIN provider_price_list_item_statuses pils ON pils.id = ppli.activation_status_id
     INNER JOIN (
       SELECT
         ppli_inner.price_list_id,
         REPLACE(UPPER(TRIM(ppli_inner.code)), ' ', '') AS normalized_code
       FROM provider_price_list_items ppli_inner
       INNER JOIN provider_price_lists ppl ON ppl.id = ppli_inner.price_list_id
       ${filters.sql}
       GROUP BY ppli_inner.price_list_id, REPLACE(UPPER(TRIM(ppli_inner.code)), ' ', '')
       HAVING COUNT(*) > 1
     ) duplicates
       ON duplicates.price_list_id = ppli.price_list_id
      AND duplicates.normalized_code = REPLACE(UPPER(TRIM(ppli.code)), ' ', '')
     ORDER BY p.name, ppl.name, normalized_code, ppli.id`,
    filters.params,
  );

  return Array.isArray(rows) ? rows : [];
}

function groupDuplicateRows(rows) {
  const groupsByKey = new Map();

  for (const row of rows) {
    const groupKey = `${Number(row.price_list_id)}::${String(row.normalized_code || "")}`;
    const mappedRow = {
      id: Number(row.id),
      code: String(row.code || ""),
      normalizedCode: String(row.normalized_code || normalizeCode(row.code)),
      description: String(row.description || ""),
      itemType: String(row.item_type || ""),
      price: Number(row.price || 0),
      currencyCode: String(row.currency_code || ""),
      activationStatusCode: String(row.activation_status_code || ""),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    if (!groupsByKey.has(groupKey)) {
      groupsByKey.set(groupKey, {
        providerId: Number(row.provider_id),
        providerName: String(row.provider_name || ""),
        priceListId: Number(row.price_list_id),
        priceListName: String(row.price_list_name || ""),
        normalizedCode: mappedRow.normalizedCode,
        items: [],
      });
    }

    groupsByKey.get(groupKey).items.push(mappedRow);
  }

  const groups = Array.from(groupsByKey.values()).map((group) => {
    const items = [...group.items].sort(compareRowsForKeepCandidate);
    const keepCandidate = items[0] || null;
    return {
      ...group,
      items,
      duplicateCount: items.length,
      activeCount: items.filter((item) => item.activationStatusCode === "activo")
        .length,
      keepCandidateId: keepCandidate ? keepCandidate.id : null,
      duplicateItemIds: keepCandidate
        ? items.filter((item) => item.id !== keepCandidate.id).map((item) => item.id)
        : items.map((item) => item.id),
    };
  });

  return groups.sort((left, right) => {
    if (left.providerName !== right.providerName) {
      return left.providerName.localeCompare(right.providerName, "es");
    }
    if (left.priceListName !== right.priceListName) {
      return left.priceListName.localeCompare(right.priceListName, "es");
    }
    return left.normalizedCode.localeCompare(right.normalizedCode, "es");
  });
}

function printHumanReport(groups, options) {
  console.log(`database ${config.db.database}`);
  console.log(`groups ${groups.length}`);
  console.log(
    "normalization trim + upper + remove spaces; report is read-only and does not change data.",
  );

  if (options.providerId) {
    console.log(`filter_provider_id ${options.providerId}`);
  }
  if (options.priceListId) {
    console.log(`filter_price_list_id ${options.priceListId}`);
  }

  if (!groups.length) {
    console.log(
      "No se detectaron codigos duplicados por lista usando la normalizacion configurada.",
    );
    return;
  }

  groups.forEach((group, index) => {
    console.log("");
    console.log(`group ${index + 1}`);
    console.log(`provider ${group.providerId} | ${group.providerName}`);
    console.log(`price_list ${group.priceListId} | ${group.priceListName}`);
    console.log(`normalized_code ${group.normalizedCode}`);
    console.log(`duplicate_count ${group.duplicateCount}`);
    console.log(`active_count ${group.activeCount}`);
    console.log(
      `keep_candidate_id ${group.keepCandidateId || "-"} | duplicate_item_ids ${group.duplicateItemIds.join(", ") || "-"}`,
    );
    console.log(
      "keep_candidate_rule activo primero, luego fecha de creacion mas antigua, luego menor id.",
    );

    group.items.forEach((item) => {
      const marker = item.id === group.keepCandidateId ? "KEEP" : "DUP";
      console.log(
        [
          `  [${marker}] id=${item.id}`,
          `code=\"${item.code}\"`,
          `status=${item.activationStatusCode}`,
          `type=${item.itemType}`,
          `price=${item.price.toFixed(2)} ${item.currencyCode}`,
          `created=${formatDateTime(item.createdAt)}`,
          `updated=${formatDateTime(item.updatedAt)}`,
        ].join(" | "),
      );
      if (item.description) {
        console.log(`    description ${item.description}`);
      }
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const duplicateRows = await loadDuplicateRows(options);
  let groups = groupDuplicateRows(duplicateRows);

  if (options.limitGroups) {
    groups = groups.slice(0, options.limitGroups);
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          database: config.db.database,
          normalization: "trim + upper + remove spaces",
          groupCount: groups.length,
          providerId: options.providerId,
          priceListId: options.priceListId,
          groups,
        },
        null,
        2,
      ),
    );
    return;
  }

  printHumanReport(groups, options);
}

main()
  .catch((error) => {
    console.error("duplicate_report_error", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });