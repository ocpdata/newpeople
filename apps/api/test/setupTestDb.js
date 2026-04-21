import fs from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.test") });

const dbName = process.env.DB_NAME || "newpeople_crm_test";

if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
  throw new Error(`Nombre de base invalido para pruebas: ${dbName}`);
}

if (dbName === "newpeople_crm") {
  throw new Error(
    "La base de pruebas no puede apuntar a newpeople_crm. Usa otra DB_NAME en .env.test.",
  );
}

async function main() {
  const schemaPath = resolve(__dirname, "../sql/schema.sql");
  const rawSchema = await fs.readFile(schemaPath, "utf8");
  const testSchema = rawSchema.replace(/newpeople_crm/g, dbName);

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    multipleStatements: true,
  });

  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    await connection.query(testSchema);
    console.log(`Test DB ready: ${dbName}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});