import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { query } from "../db.js";
import {
  escapeLikeTerm,
  normalizeSearchText,
  tokenizeSearchText,
} from "./common.js";
import { fetchChatbotEmbedding } from "./openai.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const KB_INDEX_TTL_MS = 10 * 60 * 1000;
const KB_MAX_CHUNK_CHARS = 1400;
const KB_MIN_CHUNK_CHARS = 280;
const KB_MAX_EMBEDDING_CHUNKS = 220;

let lastKnowledgeIndexRunAt = 0;
let indexingPromise = null;

async function listMarkdownFiles(rootPath) {
  const targets = [
    "README.md",
    "apps/api/README.md",
    "apps/web/README.md",
    "readme",
  ];

  const files = [];

  async function walkDirectory(currentPath) {
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walkDirectory(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.toLowerCase().endsWith(".md")) continue;
      files.push(absolute);
    }
  }

  for (const target of targets) {
    const absolute = path.join(rootPath, target);
    const statSafe = await readFile(absolute, "utf8").then(
      () => ({ isFile: true }),
      async () => {
        try {
          await walkDirectory(absolute);
          return { isFile: false };
        } catch {
          return null;
        }
      },
    );

    if (!statSafe) continue;
    if (statSafe.isFile) {
      files.push(absolute);
    }
  }

  return [...new Set(files)].sort((left, right) => left.localeCompare(right));
}

function chunkMarkdownContent(rawContent) {
  const content = String(rawContent || "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!content) return [];

  const lines = content.split("\n");
  const chunks = [];

  let currentHeading = "";
  let buffer = [];

  const flushChunk = () => {
    const text = buffer.join("\n").trim();
    if (!text) {
      buffer = [];
      return;
    }

    if (text.length <= KB_MAX_CHUNK_CHARS) {
      chunks.push({ heading: currentHeading, text });
      buffer = [];
      return;
    }

    const paragraphs = text.split(/\n{2,}/g);
    let paragraphBuffer = "";
    for (const paragraphRaw of paragraphs) {
      const paragraph = String(paragraphRaw || "").trim();
      if (!paragraph) continue;

      if (!paragraphBuffer) {
        paragraphBuffer = paragraph;
        continue;
      }

      const candidate = `${paragraphBuffer}\n\n${paragraph}`;
      if (candidate.length > KB_MAX_CHUNK_CHARS) {
        chunks.push({ heading: currentHeading, text: paragraphBuffer });
        paragraphBuffer = paragraph;
      } else {
        paragraphBuffer = candidate;
      }
    }

    if (paragraphBuffer) {
      chunks.push({ heading: currentHeading, text: paragraphBuffer });
    }

    buffer = [];
  };

  for (const lineRaw of lines) {
    const line = String(lineRaw || "");
    const headingMatch = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (buffer.join("\n").trim().length >= KB_MIN_CHUNK_CHARS) {
        flushChunk();
      }
      currentHeading = headingMatch[2].trim();
      buffer.push(line);
      continue;
    }

    buffer.push(line);
    if (buffer.join("\n").length >= KB_MAX_CHUNK_CHARS) {
      flushChunk();
    }
  }

  flushChunk();

  return chunks
    .map((item) => ({
      heading: item.heading,
      text: String(item.text || "").trim(),
    }))
    .filter((item) => item.text.length >= 80);
}

function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || !left.length) return 0;
  const size = Math.min(left.length, right.length);
  if (!size) return 0;

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < size; index += 1) {
    const a = Number(left[index] || 0);
    const b = Number(right[index] || 0);
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }

  if (!leftNorm || !rightNorm) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

async function ensureKnowledgeSchema() {
  await query(
    `CREATE TABLE IF NOT EXISTS chatbot_knowledge_chunks (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      source_type VARCHAR(30) NOT NULL,
      file_path VARCHAR(400) NOT NULL,
      heading VARCHAR(300) NULL,
      chunk_index INT NOT NULL,
      content_hash CHAR(40) NOT NULL,
      chunk_text MEDIUMTEXT NOT NULL,
      searchable_text MEDIUMTEXT NOT NULL,
      embedding_json MEDIUMTEXT NULL,
      embedding_model VARCHAR(80) NULL,
      created_at_utc DATETIME(3) NOT NULL,
      updated_at_utc DATETIME(3) NOT NULL,
      UNIQUE KEY uq_chatbot_knowledge_chunk (source_type, file_path, chunk_index, content_hash),
      KEY idx_chatbot_knowledge_file_path (file_path)
    )`,
  );

  await query(
    `CREATE TABLE IF NOT EXISTS chatbot_knowledge_index_meta (
      singleton_key VARCHAR(60) PRIMARY KEY,
      source_hash CHAR(40) NOT NULL,
      indexed_at_utc DATETIME(3) NOT NULL,
      updated_at_utc DATETIME(3) NOT NULL
    )`,
  );
}

async function loadExistingSourceHash() {
  const rows = await query(
    `SELECT source_hash
     FROM chatbot_knowledge_index_meta
     WHERE singleton_key = 'docs_markdown'
     LIMIT 1`,
  );
  return rows[0]?.source_hash ? String(rows[0].source_hash) : "";
}

async function upsertSourceHash(nextHash) {
  const now = new Date();
  await query(
    `INSERT INTO chatbot_knowledge_index_meta
       (singleton_key, source_hash, indexed_at_utc, updated_at_utc)
     VALUES ('docs_markdown', ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       source_hash = VALUES(source_hash),
       indexed_at_utc = VALUES(indexed_at_utc),
       updated_at_utc = VALUES(updated_at_utc)`,
    [nextHash, now, now],
  );
}

async function maybeBuildEmbedding(text, modelName) {
  if (!config.openai.apiKey) return null;
  try {
    const result = await fetchChatbotEmbedding({
      input: text,
      model: modelName,
    });
    if (!Array.isArray(result) || !result.length) return null;
    return result;
  } catch {
    return null;
  }
}

export async function rebuildMarkdownKnowledgeIndex({ force = false } = {}) {
  await ensureKnowledgeSchema();

  const nowMs = Date.now();
  if (!force && nowMs - lastKnowledgeIndexRunAt < KB_INDEX_TTL_MS) {
    return { skipped: true, reason: "ttl" };
  }

  if (!indexingPromise) {
    indexingPromise = (async () => {
      const files = await listMarkdownFiles(REPO_ROOT);
      const fileContents = [];
      for (const absolutePath of files) {
        const content = await readFile(absolutePath, "utf8").catch(() => "");
        if (!content.trim()) continue;
        const relativePath = path
          .relative(REPO_ROOT, absolutePath)
          .replace(/\\/g, "/");
        fileContents.push({ relativePath, content });
      }

      const sourceHash = createHash("sha1")
        .update(
          fileContents
            .map(
              (item) =>
                `${item.relativePath}:${item.content.length}:${createHash("sha1").update(item.content).digest("hex")}`,
            )
            .join("|") || "empty",
        )
        .digest("hex");

      const existingHash = await loadExistingSourceHash();
      if (!force && existingHash && existingHash === sourceHash) {
        lastKnowledgeIndexRunAt = Date.now();
        return { skipped: true, reason: "same_hash" };
      }

      const rowsToInsert = [];
      for (const file of fileContents) {
        const chunks = chunkMarkdownContent(file.content);
        chunks.forEach((chunk, index) => {
          const contentHash = createHash("sha1")
            .update(`${file.relativePath}:${index}:${chunk.text}`)
            .digest("hex");
          rowsToInsert.push({
            filePath: file.relativePath,
            heading: chunk.heading || null,
            chunkIndex: index,
            contentHash,
            chunkText: chunk.text,
            searchableText: normalizeSearchText(
              `${file.relativePath} ${chunk.heading || ""} ${chunk.text}`,
            ),
          });
        });
      }

      await query(
        "DELETE FROM chatbot_knowledge_chunks WHERE source_type = 'markdown'",
      );

      const embeddingModel = "text-embedding-3-small";
      const shouldEmbed =
        Boolean(config.openai.apiKey) &&
        rowsToInsert.length <= KB_MAX_EMBEDDING_CHUNKS;

      for (const row of rowsToInsert) {
        const embedding = shouldEmbed
          ? await maybeBuildEmbedding(
              `${row.filePath}\n${row.heading || ""}\n${row.chunkText}`.slice(
                0,
                8000,
              ),
              embeddingModel,
            )
          : null;

        const now = new Date();
        await query(
          `INSERT INTO chatbot_knowledge_chunks
             (source_type, file_path, heading, chunk_index,
              content_hash, chunk_text, searchable_text,
              embedding_json, embedding_model,
              created_at_utc, updated_at_utc)
           VALUES ('markdown', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            row.filePath,
            row.heading,
            row.chunkIndex,
            row.contentHash,
            row.chunkText,
            row.searchableText,
            embedding ? JSON.stringify(embedding) : null,
            embedding ? embeddingModel : null,
            now,
            now,
          ],
        );
      }

      await upsertSourceHash(sourceHash);
      lastKnowledgeIndexRunAt = Date.now();
      return {
        indexedChunks: rowsToInsert.length,
        indexedFiles: fileContents.length,
        embedded: shouldEmbed,
      };
    })().finally(() => {
      indexingPromise = null;
    });
  }

  return indexingPromise;
}

function computeKeywordScore({ searchableText, tokens }) {
  if (!tokens.length) return 0;
  let score = 0;
  for (const token of tokens) {
    if (!token) continue;
    const safeToken = escapeLikeTerm(token);
    if (searchableText.includes(safeToken)) {
      score += 1;
    }
  }
  return score;
}

export async function searchMarkdownKnowledge({ prompt, limit = 6 }) {
  await ensureKnowledgeSchema();
  await rebuildMarkdownKnowledgeIndex({ force: false }).catch(() => {});

  const safePrompt = String(prompt || "").trim();
  if (!safePrompt) return [];

  const tokens = tokenizeSearchText(safePrompt);
  const rows = await query(
    `SELECT id, file_path, heading, chunk_index, chunk_text, searchable_text,
            embedding_json, embedding_model, updated_at_utc
     FROM chatbot_knowledge_chunks
     WHERE source_type = 'markdown'
     ORDER BY file_path ASC, chunk_index ASC`,
  );

  const queryEmbedding =
    config.openai.apiKey && rows.some((row) => row.embedding_json)
      ? await fetchChatbotEmbedding({
          input: safePrompt.slice(0, 4000),
          model: "text-embedding-3-small",
        }).catch(() => null)
      : null;

  const ranked = rows
    .map((row) => {
      const searchable = String(row.searchable_text || "");
      const keywordScore = computeKeywordScore({
        searchableText: searchable,
        tokens,
      });

      let embeddingScore = 0;
      if (queryEmbedding && row.embedding_json) {
        const chunkEmbedding = JSON.parse(String(row.embedding_json || "null"));
        embeddingScore = cosineSimilarity(queryEmbedding, chunkEmbedding);
      }

      const finalScore = keywordScore * 0.72 + embeddingScore * 0.28;
      return {
        id: Number(row.id),
        filePath: String(row.file_path || ""),
        heading: row.heading ? String(row.heading) : "",
        chunkIndex: Number(row.chunk_index || 0),
        excerpt: String(row.chunk_text || "").slice(0, 520),
        score: Number(finalScore || 0),
        keywordScore,
        embeddingScore,
        updatedAtUtc: row.updated_at_utc || null,
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, Math.min(12, Number(limit || 6))));

  return ranked;
}
