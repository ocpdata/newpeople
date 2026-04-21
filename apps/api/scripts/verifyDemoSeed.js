import axios from "axios";
import { pool, query } from "../src/db.js";

async function printCounts() {
  for (const table of ["users", "accounts", "contacts", "opportunities"]) {
    const rows = await query(`SELECT COUNT(*) AS count FROM ${table}`);
    console.log(table, Number(rows[0].count));
  }

  const demoUsers = await query(
    "SELECT COUNT(*) AS count FROM users WHERE description LIKE 'DEMO_SEED_V1:%'",
  );
  console.log("demo_marked_users", Number(demoUsers[0].count));
}

async function verifyLogins() {
  for (const creds of [
    { email: "ocarrillo@accessq.com.mx", password: "Cruz4das?" },
    { email: "ocarrillo@electrodata.com.pe", password: "Cruz4das?" },
  ]) {
    const response = await axios.post("http://localhost:4000/api/auth/login", creds);
    console.log(creds.email, response.status, Boolean(response.data?.token));
  }
}

async function main() {
  await printCounts();
  await verifyLogins();
}

main()
  .catch((error) => {
    console.error(error.response?.status, error.response?.data || error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });