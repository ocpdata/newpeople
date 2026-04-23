import axios from "axios";
import { pool, query } from "../src/db.js";

const EXPECTED_DEMO_PROVIDERS = 12;
const EXPECTED_DEMO_PROVIDER_PRICE_ITEMS = 60;

function assertEqual(label, actual, expected) {
  if (Number(actual) !== Number(expected)) {
    throw new Error(`${label}: esperado ${expected}, recibido ${actual}`);
  }
  console.log(`${label}_ok`, Number(actual));
}

function assertZero(label, actual) {
  assertEqual(label, actual, 0);
}

async function printCounts() {
  for (const table of [
    "users",
    "accounts",
    "contacts",
    "opportunities",
    "providers",
    "provider_price_list_items",
  ]) {
    const rows = await query(`SELECT COUNT(*) AS count FROM ${table}`);
    console.log(table, Number(rows[0].count));
  }

  const demoUsers = await query(
    "SELECT COUNT(*) AS count FROM users WHERE description LIKE 'DEMO_SEED_V1:%'",
  );
  console.log("demo_marked_users", Number(demoUsers[0].count));
}

async function verifyProviderSeed() {
  const [demoProviders] = await query(
    `SELECT COUNT(*) AS count
     FROM providers
     WHERE registration_code LIKE 'DEMO-PROV-%'`,
  );
  assertEqual(
    "demo_providers",
    Number(demoProviders.count),
    EXPECTED_DEMO_PROVIDERS,
  );

  const [demoProviderPriceItems] = await query(
    `SELECT COUNT(*) AS count
     FROM provider_price_list_items ppi
     INNER JOIN providers p ON p.id = ppi.provider_id
     WHERE p.registration_code LIKE 'DEMO-PROV-%'`,
  );
  assertEqual(
    "demo_provider_price_items",
    Number(demoProviderPriceItems.count),
    EXPECTED_DEMO_PROVIDER_PRICE_ITEMS,
  );

  const [providersWithoutPrices] = await query(
    `SELECT COUNT(*) AS count
     FROM providers p
     LEFT JOIN provider_price_list_items ppi ON ppi.provider_id = p.id
     WHERE p.registration_code LIKE 'DEMO-PROV-%'
       AND ppi.id IS NULL`,
  );
  assertZero(
    "demo_providers_without_prices",
    Number(providersWithoutPrices.count),
  );

  const [inactiveProvidersWithActivePrices] = await query(
    `SELECT COUNT(*) AS count
     FROM providers p
     INNER JOIN provider_activation_statuses pas ON pas.id = p.activation_status_id
     INNER JOIN provider_price_list_items ppi ON ppi.provider_id = p.id
     INNER JOIN provider_price_list_item_statuses pist ON pist.id = ppi.activation_status_id
     WHERE p.registration_code LIKE 'DEMO-PROV-%'
       AND pas.code = 'desactivado'
       AND pist.code = 'activo'`,
  );
  assertZero(
    "inactive_demo_providers_with_active_prices",
    Number(inactiveProvidersWithActivePrices.count),
  );

  const demoProviderItemSpread = await query(
    `SELECT COUNT(*) AS item_count
     FROM provider_price_list_items ppi
     INNER JOIN providers p ON p.id = ppi.provider_id
     WHERE p.registration_code LIKE 'DEMO-PROV-%'
     GROUP BY ppi.provider_id
     ORDER BY item_count ASC`,
  );

  const minItems = Number(demoProviderItemSpread[0]?.item_count || 0);
  const maxItems = Number(
    demoProviderItemSpread[demoProviderItemSpread.length - 1]?.item_count || 0,
  );
  console.log("demo_provider_price_items_min", minItems);
  console.log("demo_provider_price_items_max", maxItems);
}

async function verifyLogins() {
  for (const creds of [
    { email: "ocarrillo@accessq.com.mx", password: "Cruz4das?" },
    { email: "ocarrillo@electrodata.com.pe", password: "Cruz4das?" },
  ]) {
    const response = await axios.post(
      "http://localhost:4000/api/auth/login",
      creds,
    );
    console.log(creds.email, response.status, Boolean(response.data?.token));
  }
}

async function main() {
  await printCounts();
  await verifyProviderSeed();
  await verifyLogins();
}

main()
  .catch((error) => {
    console.error(
      error.response?.status,
      error.response?.data || error.message,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
