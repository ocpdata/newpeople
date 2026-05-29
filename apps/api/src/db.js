import mysql from "mysql2/promise";
import { config } from "./config.js";

export const pool = mysql.createPool(config.db);

function countSqlPlaceholders(sql) {
  const text = String(sql || "");
  let count = 0;
  let i = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (i < text.length) {
    const char = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
      }
      i += 1;
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && !inBacktick) {
      if (char === "-" && next === "-") {
        inLineComment = true;
        i += 2;
        continue;
      }
      if (char === "/" && next === "*") {
        inBlockComment = true;
        i += 2;
        continue;
      }
    }

    if (!inDoubleQuote && !inBacktick && char === "'" && text[i - 1] !== "\\") {
      inSingleQuote = !inSingleQuote;
      i += 1;
      continue;
    }

    if (!inSingleQuote && !inBacktick && char === '"' && text[i - 1] !== "\\") {
      inDoubleQuote = !inDoubleQuote;
      i += 1;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && char === "`") {
      inBacktick = !inBacktick;
      i += 1;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && !inBacktick && char === "?") {
      count += 1;
    }

    i += 1;
  }

  return count;
}

function validateSqlPlaceholders(sql, params) {
  if (typeof sql !== "string") return;
  const placeholderCount = countSqlPlaceholders(sql);
  if (placeholderCount === 0) return;
  if (!Array.isArray(params)) return;

  if (params.length < placeholderCount) {
    const error = new Error(
      `SQL placeholder mismatch: expected ${placeholderCount}, received ${params.length}`,
    );
    error.code = "SQL_PLACEHOLDER_MISMATCH";
    error.sql = sql;
    error.expectedPlaceholders = placeholderCount;
    error.receivedParams = params.length;
    throw error;
  }
}

export async function query(sql, params = []) {
  validateSqlPlaceholders(sql, params);
  const [rows] = await pool.query(sql, params);
  return rows;
}

export async function withTransaction(work) {
  const conn = await pool.getConnection();
  const originalQuery = conn.query.bind(conn);
  conn.query = async (sql, params = []) => {
    validateSqlPlaceholders(sql, params);
    return originalQuery(sql, params);
  };
  try {
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
