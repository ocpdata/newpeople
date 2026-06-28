import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Blob } from "node:buffer";
import formidable from "formidable";
import { simpleParser } from "mailparser";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import XLSX from "xlsx";
import JSZip from "jszip";
import { parseBuffer as parseAudioBuffer } from "music-metadata";
import { getUserAuthContext } from "../auth.js";
import { query, withTransaction } from "../db.js";
import { config } from "../config.js";
import {
  assertAiBudgetAvailable,
  recordAiUsageFromOpenAiResponse,
} from "../ai-usage/service.js";
import { createDocumentStorage } from "./storage.js";

const commercialSellerEligibilityPermission = "comercial.seller.eligible";

const storage = createDocumentStorage();
const PIPELINE_VERSION = "v1";

const FILE_LIMITS = {
  ".pdf": { maxBytes: 20 * 1024 * 1024, kind: "pdf" },
  ".docx": { maxBytes: 15 * 1024 * 1024, kind: "docx" },
  ".ppt": { maxBytes: 20 * 1024 * 1024, kind: "presentation" },
  ".pptx": { maxBytes: 20 * 1024 * 1024, kind: "presentation" },
  ".xlsx": { maxBytes: 10 * 1024 * 1024, kind: "spreadsheet" },
  ".xls": { maxBytes: 10 * 1024 * 1024, kind: "spreadsheet" },
  ".csv": { maxBytes: 5 * 1024 * 1024, kind: "spreadsheet" },
  ".txt": { maxBytes: 2 * 1024 * 1024, kind: "text" },
  ".eml": { maxBytes: 10 * 1024 * 1024, kind: "text" },
  ".png": { maxBytes: 10 * 1024 * 1024, kind: "image" },
  ".jpg": { maxBytes: 10 * 1024 * 1024, kind: "image" },
  ".jpeg": { maxBytes: 10 * 1024 * 1024, kind: "image" },
  ".mp3": { maxBytes: 50 * 1024 * 1024, kind: "audio" },
  ".wav": { maxBytes: 50 * 1024 * 1024, kind: "audio" },
  ".m4a": { maxBytes: 50 * 1024 * 1024, kind: "audio" },
  ".mp4": { maxBytes: 80 * 1024 * 1024, kind: "audio" },
};

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildBigrams(value) {
  const normalized = normalizeText(value).replace(/\s/g, "");
  if (!normalized) return new Set();
  if (normalized.length === 1) return new Set([normalized]);

  const pairs = new Set();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    pairs.add(normalized.slice(index, index + 2));
  }
  return pairs;
}

function calculateSimilarity(left, right) {
  const leftNormalized = normalizeText(left);
  const rightNormalized = normalizeText(right);
  if (!leftNormalized || !rightNormalized) return 0;
  if (leftNormalized === rightNormalized) return 1;
  if (
    leftNormalized.length >= 6 &&
    rightNormalized.length >= 6 &&
    (leftNormalized.includes(rightNormalized) ||
      rightNormalized.includes(leftNormalized))
  ) {
    return 0.93;
  }

  const leftPairs = buildBigrams(leftNormalized);
  const rightPairs = buildBigrams(rightNormalized);
  let overlap = 0;
  leftPairs.forEach((pair) => {
    if (rightPairs.has(pair)) overlap += 1;
  });
  return (2 * overlap) / (leftPairs.size + rightPairs.size || 1);
}

function detectExtension(fileName) {
  return String(path.extname(fileName || "") || "").toLowerCase();
}

function decodeXmlEntities(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_match, dec) =>
      String.fromCodePoint(parseInt(dec, 10)),
    )
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSlideTextFromXml(xml) {
  return Array.from(String(xml || "").matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/gi))
    .map((match) => decodeXmlEntities(match[1]))
    .filter(Boolean);
}

function extractSlideNumber(filePath) {
  const match = String(filePath || "").match(/slide(\d+)\.xml$/i);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

async function extractPptxText(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slidePaths = Object.keys(zip.files)
    .filter((filePath) => /^ppt\/slides\/slide\d+\.xml$/i.test(filePath))
    .sort(
      (left, right) => extractSlideNumber(left) - extractSlideNumber(right),
    );

  const slideBlocks = [];
  for (const slidePath of slidePaths) {
    const slideXml = await zip.file(slidePath)?.async("string");
    if (!slideXml) continue;
    const slideNumber = extractSlideNumber(slidePath);
    const lines = extractSlideTextFromXml(slideXml);
    if (!lines.length) continue;
    slideBlocks.push(`Diapositiva ${slideNumber}\n${lines.join("\n")}`);
  }

  return slideBlocks.join("\n\n").trim();
}

function sanitizeFileName(fileName) {
  return String(fileName || "archivo")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 160);
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatEmailHeader(label, value) {
  const text = String(value || "").trim();
  return text ? `${label}: ${text}` : "";
}

async function extractEmailContent(buffer) {
  const parsed = await simpleParser(buffer, {
    skipHtmlToText: true,
  });
  const bodyText = String(parsed.text || "").trim() || stripHtml(parsed.html);

  return [
    formatEmailHeader("Asunto", parsed.subject),
    formatEmailHeader("De", parsed.from?.text),
    formatEmailHeader("Para", parsed.to?.text),
    formatEmailHeader("CC", parsed.cc?.text),
    formatEmailHeader("Fecha", parsed.date?.toISOString?.() || ""),
    bodyText ? `Cuerpo:\n${bodyText}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function buildSessionPublicId() {
  return `ods_${randomUUID().replace(/-/g, "")}`;
}

function buildDocumentPublicId() {
  return `doc_${randomUUID().replace(/-/g, "")}`;
}

function extractResponseOutputText(data) {
  const directOutputText = String(data?.output_text || "").trim();
  if (directOutputText) return directOutputText;

  const outputEntries = Array.isArray(data?.output) ? data.output : [];
  return (
    outputEntries
      .flatMap((entry) => (Array.isArray(entry?.content) ? entry.content : []))
      .filter((part) => part?.type === "output_text")
      .map((part) => String(part?.text || "").trim())
      .find(Boolean) || ""
  );
}

function extractJsonObject(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function parseJsonField(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
}

function normalizeSuggestedNameOptions(values) {
  const unique = new Map();

  (Array.isArray(values) ? values : []).forEach((value) => {
    const normalized = String(value || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!normalized) return;
    const dedupeKey = normalizeText(normalized);
    if (!dedupeKey || unique.has(dedupeKey)) return;
    unique.set(dedupeKey, normalized);
  });

  return Array.from(unique.values());
}

function extractSuggestedNameOptions(text, fileName) {
  const normalized = String(text || "");
  const options = [];

  const labeledMatches = Array.from(
    normalized.matchAll(
      /(?:^|\n)\s*(?:nombre de la oportunidad|oportunidad|nombre)\s*:\s*(.+)$/gim,
    ),
  )
    .map((match) => String(match[1] || "").trim())
    .filter(Boolean);

  options.push(...labeledMatches);

  const explicitOpportunityMatches = Array.from(
    normalized.matchAll(
      /(?:^|\n)\s*(?:oportunidad|proyecto|propuesta)\s*(?:\d+|[a-z])?\s*[:\-]\s*(.+)$/gim,
    ),
  )
    .map((match) => String(match[1] || "").trim())
    .filter(Boolean);

  options.push(...explicitOpportunityMatches);

  if (!options.length) {
    const bulletMatches = Array.from(
      normalized.matchAll(
        /(?:^|\n)\s*(?:[-*\u2022]|\d+[.)])\s+([^\n]{6,140})/g,
      ),
    )
      .map((match) => String(match[1] || "").trim())
      .filter(
        (value) =>
          /oportun|propuesta|servicio|renov|licit|proyecto|implement/i.test(
            value,
          ) && !/:\s*$/.test(value),
      );
    options.push(...bulletMatches);
  }

  const normalizedOptions = normalizeSuggestedNameOptions(options);
  if (normalizedOptions.length) return normalizedOptions;

  return fileName ? [`Oportunidad derivada de ${fileName}`] : [];
}

function mergeAnalysisWithHeuristics(analysis, text, fileName) {
  const heuristicAnalysis = fallbackAnalyzeText(text, fileName);
  const mergedNameOptions = normalizeSuggestedNameOptions([
    ...(Array.isArray(analysis?.suggestedNameOptions)
      ? analysis.suggestedNameOptions
      : []),
    analysis?.suggestedName,
    ...heuristicAnalysis.suggestedNameOptions,
    heuristicAnalysis.suggestedName,
  ]);

  return {
    ...heuristicAnalysis,
    ...(analysis || {}),
    suggestedName:
      String(analysis?.suggestedName || "").trim() ||
      mergedNameOptions[0] ||
      heuristicAnalysis.suggestedName ||
      "",
    suggestedNameOptions: mergedNameOptions,
    warnings: Array.isArray(analysis?.warnings)
      ? analysis.warnings
      : heuristicAnalysis.warnings,
    stageSuggestions: Array.isArray(analysis?.stageSuggestions)
      ? analysis.stageSuggestions
      : heuristicAnalysis.stageSuggestions,
  };
}

function resolveMatchStatus(candidates) {
  if (!candidates.length) return "no_match";
  if (candidates[0].score >= 0.99) {
    return "single_match";
  }
  if (
    candidates[0].score >= 0.92 &&
    (candidates.length === 1 || (candidates[1]?.score || 0) <= 0.84)
  ) {
    return "single_match";
  }
  return "multiple_matches";
}

function pickTopCandidates(candidates) {
  return candidates
    .filter((candidate) => candidate.score >= 0.5)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);
}

function buildEntityCandidates(rows, detectedValue, labelKey = "name") {
  const candidates = rows
    .map((row) => ({
      id: Number(row.id),
      label: String(row[labelKey] || row.full_name || row.name || "").trim(),
      score: calculateSimilarity(
        detectedValue,
        row[labelKey] || row.full_name || row.name || "",
      ),
    }))
    .filter((candidate) => candidate.label)
    .sort((left, right) => right.score - left.score);

  return pickTopCandidates(candidates);
}

export function summarizeForPrompt(value, maxLength = 12000) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}...`;
}

function fallbackAnalyzeText(text, fileName) {
  const normalized = summarizeForPrompt(text, 5000);
  const suggestedNameOptions = extractSuggestedNameOptions(
    normalized,
    fileName,
  );
  const readLabel = (labelPattern) => {
    const regex = new RegExp(
      `(?:^|\\n)\\s*(?:${labelPattern})\\s*:\\s*(.+)$`,
      "im",
    );
    const match = normalized.match(regex);
    return match ? String(match[1] || "").trim() : "";
  };
  const amountMatch = normalized.match(
    /\$?\s*([0-9]{1,3}(?:[,.][0-9]{3})*(?:[,.][0-9]{2})?)/,
  );
  const dateMatch = normalized.match(
    /(20\d{2}-\d{2}-\d{2}|\d{2}\/\d{2}\/20\d{2})/,
  );
  return {
    suggestedName:
      readLabel("nombre de la oportunidad|oportunidad|nombre") ||
      suggestedNameOptions[0] ||
      (fileName ? `Oportunidad derivada de ${fileName}` : ""),
    suggestedNameOptions,
    suggestedAmountUsd: amountMatch
      ? Number(String(amountMatch[1]).replace(/,/g, ""))
      : null,
    suggestedCloseDate: dateMatch
      ? String(dateMatch[1]).includes("/")
        ? String(dateMatch[1]).split("/").reverse().join("-")
        : String(dateMatch[1])
      : "",
    detectedAccountName: readLabel("cuenta|empresa|cliente"),
    detectedContactName: readLabel("contacto"),
    detectedBusinessLineName: readLabel("linea de negocio|linea"),
    detectedSellerName: readLabel("vendedor|seller"),
    detectedPresalesName: readLabel("preventa|presales"),
    summaryNotes: summarizeForPrompt(normalized, 400),
    stageSuggestions: [],
    warnings: [],
    confidence: "low",
  };
}

async function analyzeStructuredDocument({
  text,
  fileName,
  mimeType,
  aiUsageContext,
}) {
  const trimmedText = summarizeForPrompt(text, 16000);
  if (!trimmedText) {
    return {
      ...fallbackAnalyzeText(text, fileName),
      warnings: ["No fue posible extraer contenido util del archivo."],
    };
  }

  if (!config.openai.apiKey) {
    return fallbackAnalyzeText(trimmedText, fileName);
  }

  const aiUsageUserId = Number(aiUsageContext?.userId || 0);
  if (aiUsageUserId) {
    await assertAiBudgetAvailable({ userId: aiUsageUserId });
  }

  const payload = {
    model: config.openai.model,
    input: [
      {
        role: "system",
        content:
          "Analiza documentos comerciales privados relacionados con oportunidades CRM y responde solo con JSON valido. No inventes IDs internos. Extrae nombre de oportunidad, monto, fecha de cierre estimada, cuenta detectada, contacto detectado, linea de negocio, vendedor, preventa, notas y sugerencias breves por etapa cuando existan. Si no hay evidencia clara, deja cadenas vacias o null y usa confianza baja.",
      },
      {
        role: "user",
        content: JSON.stringify({
          fileName,
          mimeType,
          content: trimmedText,
          expectedJsonShape: {
            suggestedName: "",
            suggestedNameOptions: [""],
            suggestedAmountUsd: null,
            suggestedCloseDate: "",
            detectedAccountName: "",
            detectedContactName: "",
            detectedBusinessLineName: "",
            detectedSellerName: "",
            detectedPresalesName: "",
            summaryNotes: "",
            stageSuggestions: [
              {
                stageCode: "",
                stageName: "",
                suggestedText: "",
                reason: "",
              },
            ],
            warnings: [],
            confidence: "high|medium|low",
          },
        }),
      },
    ],
  };

  const startedAt = new Date();
  const response = await fetch(
    `${config.openai.baseUrl.replace(/\/$/, "")}/responses`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openai.apiKey}`,
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    return fallbackAnalyzeText(trimmedText, fileName);
  }

  const data = await response.json();
  if (aiUsageUserId) {
    await recordAiUsageFromOpenAiResponse({
      internalRequestId: randomUUID(),
      userId: aiUsageUserId,
      featureCode: "opportunities.documents.analysis",
      model: String(config.openai.model || "").trim(),
      openAiResponse: data,
      jobType: "opportunity_document_analysis",
      jobId: aiUsageContext?.jobId || null,
      startedAt,
    });
  }
  const parsed = extractJsonObject(extractResponseOutputText(data));
  if (!parsed) {
    return fallbackAnalyzeText(trimmedText, fileName);
  }

  return mergeAnalysisWithHeuristics(parsed, trimmedText, fileName);
}

export async function extractImageText(
  buffer,
  mimeType,
  aiUsageContext = null,
) {
  if (!config.openai.apiKey) {
    throw new Error("OpenAI no configurado para OCR de imagenes");
  }

  const aiUsageUserId = Number(aiUsageContext?.userId || 0);
  if (aiUsageUserId) {
    await assertAiBudgetAvailable({ userId: aiUsageUserId });
  }

  const payload = {
    model: config.openai.model,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Extrae todo el texto legible de esta imagen. Devuelve solo texto plano, sin comentarios.",
          },
          {
            type: "input_image",
            image_url: `data:${mimeType};base64,${buffer.toString("base64")}`,
          },
        ],
      },
    ],
  };

  const startedAt = new Date();
  const response = await fetch(
    `${config.openai.baseUrl.replace(/\/$/, "")}/responses`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openai.apiKey}`,
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`No fue posible extraer texto de la imagen: ${errorText}`);
  }

  const data = await response.json();
  if (aiUsageUserId) {
    await recordAiUsageFromOpenAiResponse({
      internalRequestId: randomUUID(),
      userId: aiUsageUserId,
      featureCode: "opportunities.documents.ocr",
      model: String(config.openai.model || "").trim(),
      openAiResponse: data,
      jobType: "opportunity_document_ocr",
      jobId: aiUsageContext?.jobId || null,
      startedAt,
    });
  }
  return extractResponseOutputText(data);
}

export async function transcribeAudio(
  buffer,
  mimeType,
  fileName,
  aiUsageContext = null,
) {
  if (!config.openai.apiKey) {
    throw new Error("OpenAI no configurado para transcripcion de audio");
  }

  const aiUsageUserId = Number(aiUsageContext?.userId || 0);
  if (aiUsageUserId) {
    await assertAiBudgetAvailable({ userId: aiUsageUserId });
  }

  const body = new FormData();
  body.append(
    "file",
    new Blob([buffer], { type: mimeType || "application/octet-stream" }),
    fileName || "audio",
  );
  body.append("model", config.openai.transcriptionModel);

  const startedAt = new Date();
  const response = await fetch(
    `${config.openai.baseUrl.replace(/\/$/, "")}/audio/transcriptions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openai.apiKey}`,
      },
      body,
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`No fue posible transcribir el audio: ${errorText}`);
  }

  const data = await response.json();
  if (aiUsageUserId) {
    await recordAiUsageFromOpenAiResponse({
      internalRequestId: randomUUID(),
      userId: aiUsageUserId,
      featureCode: "opportunities.documents.transcription",
      model: String(config.openai.transcriptionModel || "").trim(),
      openAiResponse: data,
      jobType: "opportunity_document_transcription",
      jobId: aiUsageContext?.jobId || null,
      startedAt,
    });
  }
  return {
    text: String(data?.text || "").trim(),
    language: String(data?.language || "").trim(),
  };
}

export async function extractContentFromBuffer({
  buffer,
  mimeType,
  fileName,
  extension,
  aiUsageContext,
}) {
  const normalizedExtension = String(extension || "")
    .trim()
    .toLowerCase();
  const resolvedExtension = normalizedExtension
    ? normalizedExtension.startsWith(".")
      ? normalizedExtension
      : `.${normalizedExtension}`
    : detectExtension(fileName);
  const detectedFormat =
    resolvedExtension.replace(/^\./, "") || mimeType || "unknown";

  if (resolvedExtension === ".txt") {
    const text = buffer.toString("utf8");
    return {
      extractionStatus: "completed",
      transcriptionStatus: "pending",
      detectedFormat,
      rawText: text,
      normalizedText: summarizeForPrompt(text, 120000),
      structuredContentJson: null,
      transcriptText: null,
      transcriptionLanguage: null,
      transcriptionConfidence: null,
      durationSeconds: null,
      pageCount: null,
      contentSummary: summarizeForPrompt(text, 300),
    };
  }

  if (resolvedExtension === ".eml") {
    const text = await extractEmailContent(buffer);
    return {
      extractionStatus: "completed",
      transcriptionStatus: "pending",
      detectedFormat,
      rawText: text,
      normalizedText: summarizeForPrompt(text, 120000),
      structuredContentJson: null,
      transcriptText: null,
      transcriptionLanguage: null,
      transcriptionConfidence: null,
      durationSeconds: null,
      pageCount: null,
      contentSummary: summarizeForPrompt(text, 300),
    };
  }

  if (
    resolvedExtension === ".csv" ||
    resolvedExtension === ".xlsx" ||
    resolvedExtension === ".xls"
  ) {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheets = workbook.SheetNames.map((sheetName) => {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1,
        defval: "",
      });
      return {
        sheetName,
        rows: rows.slice(0, 200),
      };
    });
    const normalizedText = sheets
      .map((sheet) =>
        [sheet.sheetName]
          .concat(sheet.rows.map((row) => row.join(" | ")))
          .join("\n"),
      )
      .join("\n\n");

    return {
      extractionStatus: "completed",
      transcriptionStatus: "pending",
      detectedFormat,
      rawText: normalizedText,
      normalizedText: summarizeForPrompt(normalizedText, 120000),
      structuredContentJson: sheets,
      transcriptText: null,
      transcriptionLanguage: null,
      transcriptionConfidence: null,
      durationSeconds: null,
      pageCount: null,
      contentSummary: summarizeForPrompt(normalizedText, 300),
    };
  }

  if (resolvedExtension === ".docx") {
    const result = await mammoth.extractRawText({ buffer });
    const text = String(result.value || "").trim();
    return {
      extractionStatus: "completed",
      transcriptionStatus: "pending",
      detectedFormat,
      rawText: text,
      normalizedText: summarizeForPrompt(text, 120000),
      structuredContentJson: null,
      transcriptText: null,
      transcriptionLanguage: null,
      transcriptionConfidence: null,
      durationSeconds: null,
      pageCount: null,
      contentSummary: summarizeForPrompt(text, 300),
    };
  }

  if (resolvedExtension === ".pptx") {
    const extractedText = await extractPptxText(buffer);
    const text =
      extractedText ||
      [
        `Presentacion cargada: ${String(fileName || "archivo")}`,
        "No se encontro texto legible en las diapositivas PPTX.",
        "Agrega contexto en la pista para mejorar la sugerencia inicial.",
      ].join("\n");
    return {
      extractionStatus: "completed",
      transcriptionStatus: "pending",
      detectedFormat,
      rawText: text,
      normalizedText: summarizeForPrompt(text, 120000),
      structuredContentJson: null,
      transcriptText: null,
      transcriptionLanguage: null,
      transcriptionConfidence: null,
      durationSeconds: null,
      pageCount: null,
      contentSummary: summarizeForPrompt(text, 300),
    };
  }

  if (resolvedExtension === ".ppt") {
    const text = [
      `Presentacion cargada: ${String(fileName || "archivo")}`,
      "La extraccion automatica de texto para PPT no esta habilitada en este flujo.",
      "Agrega contexto en la pista para mejorar la sugerencia inicial.",
    ].join("\n");
    return {
      extractionStatus: "completed",
      transcriptionStatus: "pending",
      detectedFormat,
      rawText: text,
      normalizedText: summarizeForPrompt(text, 120000),
      structuredContentJson: null,
      transcriptText: null,
      transcriptionLanguage: null,
      transcriptionConfidence: null,
      durationSeconds: null,
      pageCount: null,
      contentSummary: summarizeForPrompt(text, 300),
    };
  }

  if (resolvedExtension === ".pdf") {
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    await parser.destroy().catch(() => undefined);
    const text = String(result.text || "").trim();
    return {
      extractionStatus: "completed",
      transcriptionStatus: "pending",
      detectedFormat,
      rawText: text,
      normalizedText: summarizeForPrompt(text, 120000),
      structuredContentJson: null,
      transcriptText: null,
      transcriptionLanguage: null,
      transcriptionConfidence: null,
      durationSeconds: null,
      pageCount: Number(result.total || 0) || null,
      contentSummary: summarizeForPrompt(text, 300),
    };
  }

  if (
    resolvedExtension === ".png" ||
    resolvedExtension === ".jpg" ||
    resolvedExtension === ".jpeg"
  ) {
    const text = await extractImageText(buffer, mimeType, aiUsageContext);
    return {
      extractionStatus: "completed",
      transcriptionStatus: "pending",
      detectedFormat,
      rawText: text,
      normalizedText: summarizeForPrompt(text, 120000),
      structuredContentJson: null,
      transcriptText: null,
      transcriptionLanguage: null,
      transcriptionConfidence: null,
      durationSeconds: null,
      pageCount: null,
      contentSummary: summarizeForPrompt(text, 300),
    };
  }

  if (
    resolvedExtension === ".mp3" ||
    resolvedExtension === ".wav" ||
    resolvedExtension === ".m4a" ||
    resolvedExtension === ".mp4"
  ) {
    const metadata = await parseAudioBuffer(buffer, mimeType, {
      duration: true,
    });
    const durationSeconds = Math.round(Number(metadata.format.duration || 0));
    const transcript = await transcribeAudio(
      buffer,
      mimeType,
      fileName,
      aiUsageContext,
    );

    return {
      extractionStatus: "completed",
      transcriptionStatus: "completed",
      detectedFormat,
      rawText: transcript.text,
      normalizedText: summarizeForPrompt(transcript.text, 120000),
      structuredContentJson: null,
      transcriptText: transcript.text,
      transcriptionLanguage: transcript.language || null,
      transcriptionConfidence: null,
      durationSeconds,
      pageCount: null,
      contentSummary: summarizeForPrompt(transcript.text, 300),
    };
  }

  const error = new Error(
    `El tipo de archivo ${resolvedExtension || "desconocido"} no esta soportado para extraccion`,
  );
  error.status = 400;
  throw error;
}

export function buildStorageKey({
  entityType,
  publicId,
  sha256,
  fileName,
  createdAt,
}) {
  const safeFileName = sanitizeFileName(fileName || "archivo");
  const date = createdAt || new Date();
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return path.posix.join(
    "local_fs",
    entityType,
    year,
    month,
    publicId,
    `${sha256}__${safeFileName}`,
  );
}

export async function parseMultipartFiles(req) {
  const configuredUploadDir = path.join(
    config.documents.storage.localRoot,
    "tmp",
    "uploads",
  );
  let uploadDir = configuredUploadDir;

  try {
    await mkdir(uploadDir, {
      recursive: true,
    });
  } catch (error) {
    if (error?.code !== "EACCES" && error?.code !== "EPERM") {
      throw error;
    }

    uploadDir = path.join(tmpdir(), "newpeople", "documents", "tmp", "uploads");
    await mkdir(uploadDir, {
      recursive: true,
    });
  }

  const form = formidable({
    multiples: true,
    maxFiles: config.documents.storage.maxSessionFiles,
    maxTotalFileSize: config.documents.storage.maxSessionBytes,
    uploadDir,
    keepExtensions: true,
    allowEmptyFiles: false,
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (error, fields, files) => {
      if (error) {
        reject(error);
        return;
      }

      const rawFiles = Object.values(files).flatMap((value) =>
        Array.isArray(value) ? value : value ? [value] : [],
      );
      resolve({ fields, files: rawFiles });
    });
  });
}

export async function cleanupTempFiles(files) {
  await Promise.all(
    files.map((file) =>
      rm(file.filepath, { force: true }).catch(() => undefined),
    ),
  );
}

function shouldDeferDocumentProcessing() {
  return config.documents.processing.mode === "async_in_process";
}

function getRetryDelayMs(attemptCount) {
  return (
    config.documents.processing.retryBaseDelayMs *
    Math.max(1, 2 ** Math.max(0, attemptCount - 1))
  );
}

function buildDeferredProcessingState({
  extension,
  mimeType,
  durationSeconds,
}) {
  return {
    extractionStatus: "pending",
    transcriptionStatus: "pending",
    detectedFormat: extension.replace(/^\./, "") || mimeType || "unknown",
    rawText: null,
    normalizedText: null,
    structuredContentJson: null,
    transcriptText: null,
    transcriptionLanguage: null,
    transcriptionConfidence: null,
    durationSeconds: durationSeconds || null,
    pageCount: null,
    contentSummary: null,
  };
}

async function createPendingDocumentArtifacts({
  conn,
  documentId,
  extension,
  mimeType,
  durationSeconds,
}) {
  const pending = buildDeferredProcessingState({
    extension,
    mimeType,
    durationSeconds,
  });

  await conn.query(
    `INSERT INTO document_contents
       (document_id, extraction_status, transcription_status, detected_format,
        detected_language, page_count, duration_seconds, raw_text, normalized_text,
        structured_content_json, transcript_text, transcription_language,
        transcription_confidence, content_summary, extracted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, NULL, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NOW(3), NOW(3))
     ON DUPLICATE KEY UPDATE
       extraction_status = VALUES(extraction_status),
       transcription_status = VALUES(transcription_status),
       detected_format = VALUES(detected_format),
       duration_seconds = VALUES(duration_seconds),
       extracted_at = NULL,
       updated_at = NOW(3)`,
    [
      documentId,
      pending.extractionStatus,
      pending.transcriptionStatus,
      pending.detectedFormat,
      pending.durationSeconds,
    ],
  );
}

async function refreshUploadSessionStatus(conn, sessionId) {
  const [rows] = await conn.query(
    `SELECT processing_status, COUNT(*) AS total
     FROM documents
     WHERE upload_session_id = ?
       AND is_deleted = 0
     GROUP BY processing_status`,
    [sessionId],
  );

  const totalsByStatus = Object.fromEntries(
    rows.map((row) => [row.processing_status, Number(row.total || 0)]),
  );
  const activeJobs =
    Number(totalsByStatus.uploaded || 0) +
    Number(totalsByStatus.retry_pending || 0) +
    Number(totalsByStatus.processing || 0);
  const completedJobs =
    Number(totalsByStatus.review_ready || 0) +
    Number(totalsByStatus.failed || 0);

  const nextStatus =
    activeJobs > 0 ? "processing" : completedJobs > 0 ? "ready" : "open";

  await conn.query(
    `UPDATE opportunity_document_upload_sessions
     SET status = ?, updated_at = NOW(3)
     WHERE id = ?`,
    [nextStatus, sessionId],
  );
}

async function queueDeferredDocumentProcessing() {
  if (!shouldDeferDocumentProcessing()) return;
  const { queueOpportunityDocumentProcessing } = await import("./async.js");
  queueOpportunityDocumentProcessing();
}

async function getSessionByPublicId(sessionPublicId) {
  const rows = await query(
    `SELECT *
     FROM opportunity_document_upload_sessions
     WHERE public_id = ?
     LIMIT 1`,
    [sessionPublicId],
  );
  return rows.length ? rows[0] : null;
}

async function getDocumentByPublicId(documentPublicId) {
  const rows = await query(
    `SELECT *
     FROM documents
     WHERE public_id = ?
       AND is_deleted = 0
     LIMIT 1`,
    [documentPublicId],
  );
  return rows.length ? rows[0] : null;
}

function assertSessionOwnership({ session, user }) {
  if (!session) {
    const error = new Error("Sesion documental no encontrada");
    error.status = 404;
    throw error;
  }

  if (Number(session.created_by_user_id) !== Number(user.id)) {
    const error = new Error(
      "No autorizado para acceder a esta sesion documental",
    );
    error.status = 403;
    throw error;
  }
}

function assertOpportunityDocumentAccess({ opportunityAccess }) {
  if (!opportunityAccess?.ok) {
    const error = new Error(
      opportunityAccess?.response?.body?.message ||
        "No autorizado para acceder a la oportunidad",
    );
    error.status = opportunityAccess?.response?.status || 404;
    throw error;
  }
}

async function loadSessionDocuments(sessionId) {
  return query(
    `SELECT d.*, dc.extraction_status, dc.transcription_status, dc.content_summary,
            dc.transcript_text, dc.raw_text, dc.normalized_text
     FROM documents d
     LEFT JOIN document_contents dc ON dc.document_id = d.id
     WHERE d.upload_session_id = ?
       AND d.is_deleted = 0
     ORDER BY d.id ASC`,
    [sessionId],
  );
}

function validateSessionQuota(existingDocuments, incomingFiles) {
  if (
    existingDocuments.length + incomingFiles.length >
    config.documents.storage.maxSessionFiles
  ) {
    const error = new Error(
      `La sesion admite como maximo ${config.documents.storage.maxSessionFiles} archivos.`,
    );
    error.status = 400;
    throw error;
  }

  const existingBytes = existingDocuments.reduce(
    (total, document) => total + Number(document.byte_size || 0),
    0,
  );
  const incomingBytes = incomingFiles.reduce(
    (total, file) => total + Number(file.size || 0),
    0,
  );
  if (
    existingBytes + incomingBytes >
    config.documents.storage.maxSessionBytes
  ) {
    const error = new Error(
      "La sesion excede el tamano total permitido de archivos.",
    );
    error.status = 400;
    throw error;
  }
}

export function validateSingleFile(file) {
  const originalFileName = String(
    file.originalFilename || file.newFilename || "archivo",
  );
  const extension = detectExtension(originalFileName);
  const fileConfig = FILE_LIMITS[extension];
  if (!fileConfig) {
    const error = new Error(
      `El tipo de archivo ${extension || "desconocido"} no esta soportado.`,
    );
    error.status = 400;
    throw error;
  }

  if (Number(file.size || 0) > fileConfig.maxBytes) {
    const error = new Error(
      `El archivo ${originalFileName} excede el tamano permitido para ${extension}.`,
    );
    error.status = 400;
    throw error;
  }

  const mimeType = String(file.mimetype || "")
    .trim()
    .toLowerCase();
  if (
    mimeType &&
    !config.documents.storage.allowedMimeTypes.includes(mimeType)
  ) {
    const error = new Error(`El tipo MIME ${mimeType} no esta permitido.`);
    error.status = 400;
    throw error;
  }

  return { originalFileName, extension, mimeType, kind: fileConfig.kind };
}

async function extractAndAnalyzeDocument({
  documentRecord,
  buffer,
  extension,
  mimeType,
  originalFileName,
  aiUsageContext,
}) {
  try {
    const extracted = await extractContentFromBuffer({
      buffer,
      mimeType,
      fileName: originalFileName,
      extension,
      aiUsageContext,
    });

    const analysis = await analyzeStructuredDocument({
      text:
        extracted.normalizedText ||
        extracted.transcriptText ||
        extracted.rawText,
      fileName: originalFileName,
      mimeType,
      aiUsageContext,
    });

    return { extracted, analysis, processingError: null };
  } catch (error) {
    return {
      extracted: {
        extractionStatus: "failed",
        transcriptionStatus:
          extension === ".mp3" ||
          extension === ".wav" ||
          extension === ".m4a" ||
          extension === ".mp4"
            ? "failed"
            : "pending",
        detectedFormat: extension.replace(/^\./, "") || mimeType || "unknown",
        rawText: null,
        normalizedText: null,
        structuredContentJson: null,
        transcriptText: null,
        transcriptionLanguage: null,
        transcriptionConfidence: null,
        durationSeconds: null,
        pageCount: null,
        contentSummary: null,
      },
      analysis: fallbackAnalyzeText("", originalFileName),
      processingError: error?.message || "No fue posible procesar el archivo",
    };
  }
}

async function persistDocumentArtifacts({
  conn,
  documentId,
  extracted,
  analysis,
  matches,
  processingStatus,
  processingError,
}) {
  await conn.query(
    `INSERT INTO document_contents
       (document_id, extraction_status, transcription_status, detected_format,
        detected_language, page_count, duration_seconds, raw_text, normalized_text,
        structured_content_json, transcript_text, transcription_language,
        transcription_confidence, content_summary, extracted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3), NOW(3))
     ON DUPLICATE KEY UPDATE
       extraction_status = VALUES(extraction_status),
       transcription_status = VALUES(transcription_status),
       detected_format = VALUES(detected_format),
       detected_language = VALUES(detected_language),
       page_count = VALUES(page_count),
       duration_seconds = VALUES(duration_seconds),
       raw_text = VALUES(raw_text),
       normalized_text = VALUES(normalized_text),
       structured_content_json = VALUES(structured_content_json),
       transcript_text = VALUES(transcript_text),
       transcription_language = VALUES(transcription_language),
       transcription_confidence = VALUES(transcription_confidence),
       content_summary = VALUES(content_summary),
       extracted_at = NOW(3),
       updated_at = NOW(3)`,
    [
      documentId,
      extracted.extractionStatus,
      extracted.transcriptionStatus,
      extracted.detectedFormat,
      extracted.detectedLanguage || null,
      extracted.pageCount,
      extracted.durationSeconds,
      extracted.rawText,
      extracted.normalizedText,
      extracted.structuredContentJson
        ? JSON.stringify(extracted.structuredContentJson)
        : null,
      extracted.transcriptText,
      extracted.transcriptionLanguage,
      extracted.transcriptionConfidence,
      extracted.contentSummary,
    ],
  );

  const [analysisResult] = await conn.query(
    `INSERT INTO document_analyses
       (document_id, analysis_scope, pipeline_version, model_provider, model_name,
        status, draft_fields_json, stage_suggestions_json, entities_json,
        warnings_json, confidence, evidence_json, error_message, analyzed_at,
        created_at, updated_at)
     VALUES (?, 'opportunity_draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3), NOW(3))`,
    [
      documentId,
      PIPELINE_VERSION,
      config.openai.apiKey ? "openai" : null,
      config.openai.apiKey ? config.openai.model : null,
      processingStatus === "review_ready" ? "completed" : "failed",
      JSON.stringify({
        suggestedName: analysis.suggestedName || "",
        suggestedNameOptions: Array.isArray(analysis.suggestedNameOptions)
          ? analysis.suggestedNameOptions
          : [],
        suggestedAmountUsd: analysis.suggestedAmountUsd ?? null,
        suggestedCloseDate: analysis.suggestedCloseDate || "",
        detectedAccountName: analysis.detectedAccountName || "",
        detectedContactName: analysis.detectedContactName || "",
        detectedBusinessLineName: analysis.detectedBusinessLineName || "",
        detectedSellerName: analysis.detectedSellerName || "",
        detectedPresalesName: analysis.detectedPresalesName || "",
        summaryNotes: analysis.summaryNotes || "",
      }),
      JSON.stringify(
        Array.isArray(analysis.stageSuggestions)
          ? analysis.stageSuggestions
          : [],
      ),
      JSON.stringify({
        accountName: analysis.detectedAccountName || "",
        contactName: analysis.detectedContactName || "",
        businessLineName: analysis.detectedBusinessLineName || "",
        sellerName: analysis.detectedSellerName || "",
        presalesName: analysis.detectedPresalesName || "",
      }),
      JSON.stringify(Array.isArray(analysis.warnings) ? analysis.warnings : []),
      analysis.confidence || "low",
      JSON.stringify([
        {
          sourceType: "document",
          fileName: analysis.fileName || null,
          excerpt: analysis.summaryNotes || extracted.contentSummary || null,
        },
      ]),
      processingError,
    ],
  );
  const analysisId = analysisResult.insertId;

  for (const match of matches) {
    await conn.query(
      `INSERT INTO document_match_results
         (document_analysis_id, match_target, detected_label, normalized_label,
          match_status, selected_entity_id, selected_entity_label,
          candidate_entities_json, confidence_score, reason,
          reviewed_by_user_id, reviewed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NOW(3), NOW(3))`,
      [
        analysisId,
        match.matchTarget,
        match.detectedLabel,
        normalizeText(match.detectedLabel),
        match.matchStatus,
        match.selectedEntityId,
        match.selectedEntityLabel,
        JSON.stringify(match.candidateEntities),
        match.confidenceScore,
        match.reason,
      ],
    );
  }
}

async function loadUploaderContext(userId) {
  return getUserAuthContext(userId);
}

async function processStoredDocument({ documentId, attemptCount = 0 }) {
  const rows = await query(
    `SELECT *
     FROM documents
     WHERE id = ?
       AND is_deleted = 0
     LIMIT 1`,
    [documentId],
  );
  const document = rows[0];
  if (!document) return false;

  const uploader = await loadUploaderContext(
    Number(document.uploaded_by_user_id),
  );
  if (!uploader) {
    throw new Error("Usuario subidor del documento no encontrado");
  }

  let buffer;
  try {
    buffer = await storage.readBuffer({
      storageKey: document.storage_key,
      storageBucket: document.storage_bucket,
    });
  } catch (error) {
    const processingError =
      error?.message || "No fue posible leer el archivo almacenado";
    const processingStatus =
      attemptCount + 1 < config.documents.processing.maxAttempts
        ? "retry_pending"
        : "failed";

    await withTransaction(async (conn) => {
      await persistDocumentArtifacts({
        conn,
        documentId,
        extracted: buildDeferredProcessingState({
          extension: document.file_extension,
          mimeType: document.mime_type,
          durationSeconds: document.duration_seconds,
        }),
        analysis: fallbackAnalyzeText("", document.original_file_name),
        matches: [],
        processingStatus,
        processingError,
      });
      await conn.query(
        `UPDATE documents
         SET processing_status = ?, processing_error = ?, updated_at = NOW(3)
         WHERE id = ?`,
        [processingStatus, processingError, documentId],
      );
      if (document.upload_session_id) {
        await refreshUploadSessionStatus(
          conn,
          Number(document.upload_session_id),
        );
      }
    });
    return true;
  }

  const { extracted, analysis, processingError } =
    await extractAndAnalyzeDocument({
      documentRecord: document,
      buffer,
      extension: document.file_extension,
      mimeType: document.mime_type,
      originalFileName: document.original_file_name,
      aiUsageContext: {
        userId: Number(document.uploaded_by_user_id || 0),
        jobId: Number(document.id || 0),
      },
    });
  if (!extracted.durationSeconds && document.duration_seconds) {
    extracted.durationSeconds = Number(document.duration_seconds);
  }

  const nextAttempt = attemptCount + 1;
  const processingStatus = processingError
    ? nextAttempt < config.documents.processing.maxAttempts
      ? "retry_pending"
      : "failed"
    : "review_ready";
  const matches = processingError
    ? []
    : await buildMatchResults({ user: uploader, analysis });

  await withTransaction(async (conn) => {
    await persistDocumentArtifacts({
      conn,
      documentId,
      extracted,
      analysis: { ...analysis, fileName: document.original_file_name },
      matches,
      processingStatus,
      processingError,
    });
    await conn.query(
      `UPDATE documents
       SET processing_status = ?, processing_error = ?, duration_seconds = ?, updated_at = NOW(3)
       WHERE id = ?`,
      [
        processingStatus,
        processingError,
        extracted.durationSeconds,
        documentId,
      ],
    );
    if (document.upload_session_id) {
      await refreshUploadSessionStatus(
        conn,
        Number(document.upload_session_id),
      );
    }
  });

  return true;
}

export async function processPendingOpportunityDocumentJobs({
  limit = 5,
} = {}) {
  let processedCount = 0;

  for (let index = 0; index < limit; index += 1) {
    const pendingDocuments = await query(
      `SELECT d.id, d.processing_status, d.updated_at,
              COALESCE(attempts.attempt_count, 0) AS attempt_count
       FROM documents d
       LEFT JOIN (
         SELECT document_id, COUNT(*) AS attempt_count
         FROM document_analyses
         WHERE analysis_scope = 'opportunity_draft'
         GROUP BY document_id
       ) attempts ON attempts.document_id = d.id
       WHERE d.is_deleted = 0
         AND d.processing_status IN ('uploaded', 'retry_pending')
       ORDER BY d.updated_at ASC, d.id ASC
       LIMIT 20`,
    );

    const nextDocument = pendingDocuments.find((document) => {
      if (document.processing_status === "uploaded") return true;
      return (
        Date.now() - new Date(document.updated_at).getTime() >=
        getRetryDelayMs(Number(document.attempt_count || 0))
      );
    });

    if (!nextDocument) break;

    const claimed = await withTransaction(async (conn) => {
      const [updateResult] = await conn.query(
        `UPDATE documents
         SET processing_status = 'processing', processing_error = NULL, updated_at = NOW(3)
         WHERE id = ?
           AND processing_status IN ('uploaded', 'retry_pending')`,
        [Number(nextDocument.id)],
      );
      if (!updateResult.affectedRows) return false;

      const [docRows] = await conn.query(
        `SELECT upload_session_id
         FROM documents
         WHERE id = ?
         LIMIT 1`,
        [Number(nextDocument.id)],
      );
      if (docRows[0]?.upload_session_id) {
        await refreshUploadSessionStatus(
          conn,
          Number(docRows[0].upload_session_id),
        );
      }
      return true;
    });

    if (!claimed) continue;

    await processStoredDocument({
      documentId: Number(nextDocument.id),
      attemptCount: Number(nextDocument.attempt_count || 0),
    });
    processedCount += 1;
  }

  return { processedCount };
}

async function loadAccessibleAccounts(user) {
  const params = [];
  const ownershipJoin = user?.permissionSet?.has("oportunidades.read_all")
    ? ""
    : (params.push(Number(user.id)),
      "INNER JOIN account_owners ao_scope ON ao_scope.account_id = a.id AND ao_scope.user_id = ?");

  return query(
    `SELECT DISTINCT a.id, a.name
     FROM accounts a
     ${ownershipJoin}
     ORDER BY a.name`,
    params,
  );
}

async function loadAccessibleContacts(user) {
  const params = [];
  const ownershipJoin = user?.permissionSet?.has("oportunidades.read_all")
    ? ""
    : (params.push(Number(user.id)),
      "INNER JOIN account_owners ao_scope ON ao_scope.account_id = c.account_id AND ao_scope.user_id = ?");

  return query(
    `SELECT DISTINCT c.id,
            TRIM(CONCAT_WS(' ', c.first_name, c.last_name)) AS full_name,
            c.account_id
     FROM contacts c
     ${ownershipJoin}
     ORDER BY full_name`,
    params,
  );
}

async function loadBusinessLines() {
  return query(
    `SELECT id, name
     FROM opportunity_business_lines
     ORDER BY name`,
  );
}

async function loadSellerUsers() {
  return query(
    `SELECT DISTINCT u.id, u.full_name
     FROM users u
     WHERE u.status = 'active'
       AND EXISTS (
         SELECT 1
         FROM user_roles ur
         INNER JOIN role_permissions rp ON rp.role_id = ur.role_id
         INNER JOIN permissions p ON p.id = rp.permission_id
         WHERE ur.user_id = u.id
           AND p.code = ?
       )
     ORDER BY u.full_name`,
    [commercialSellerEligibilityPermission],
  );
}

async function loadPresalesUsers() {
  return query(
    `SELECT DISTINCT u.id, u.full_name
     FROM users u
     INNER JOIN user_roles ur ON ur.user_id = u.id
     INNER JOIN roles r ON r.id = ur.role_id
     WHERE u.status = 'active'
       AND LOWER(r.name) = 'preventa'
     ORDER BY u.full_name`,
  );
}

async function buildMatchResults({ user, analysis }) {
  const [accounts, contacts, businessLines, sellerUsers, presalesUsers] =
    await Promise.all([
      loadAccessibleAccounts(user),
      loadAccessibleContacts(user),
      loadBusinessLines(),
      loadSellerUsers(),
      loadPresalesUsers(),
    ]);

  const configs = [
    {
      matchTarget: "account",
      detectedLabel: analysis.detectedAccountName,
      rows: accounts,
      labelKey: "name",
    },
    {
      matchTarget: "contact",
      detectedLabel: analysis.detectedContactName,
      rows: contacts,
      labelKey: "full_name",
    },
    {
      matchTarget: "business_line",
      detectedLabel: analysis.detectedBusinessLineName,
      rows: businessLines,
      labelKey: "name",
    },
    {
      matchTarget: "seller_user",
      detectedLabel: analysis.detectedSellerName,
      rows: sellerUsers,
      labelKey: "full_name",
    },
    {
      matchTarget: "presales_user",
      detectedLabel: analysis.detectedPresalesName,
      rows: presalesUsers,
      labelKey: "full_name",
    },
  ];

  return configs
    .filter((configItem) => String(configItem.detectedLabel || "").trim())
    .map((configItem) => {
      const candidateEntities = buildEntityCandidates(
        configItem.rows,
        configItem.detectedLabel,
        configItem.labelKey,
      );
      const matchStatus = resolveMatchStatus(candidateEntities);
      return {
        matchTarget: configItem.matchTarget,
        detectedLabel: String(configItem.detectedLabel || "").trim(),
        matchStatus,
        selectedEntityId:
          matchStatus === "single_match"
            ? candidateEntities[0]?.id || null
            : null,
        selectedEntityLabel:
          matchStatus === "single_match"
            ? candidateEntities[0]?.label || null
            : null,
        candidateEntities,
        confidenceScore: candidateEntities[0]?.score || 0,
        reason:
          matchStatus === "single_match"
            ? "Se encontro una coincidencia unica suficientemente cercana."
            : matchStatus === "multiple_matches"
              ? "Se encontraron varias coincidencias y requiere revision manual."
              : "No se encontro una coincidencia interna util.",
      };
    });
}

function serializeDocumentRow(row) {
  return {
    publicId: row.public_id,
    originalFileName: row.original_file_name,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size || 0),
    durationSeconds:
      row.duration_seconds === null ? null : Number(row.duration_seconds),
    documentKind: row.document_kind || null,
    processingStatus: row.processing_status,
    processingError: row.processing_error || "",
    extractionStatus: row.extraction_status || "pending",
    transcriptionStatus: row.transcription_status || "pending",
    contentSummary: row.content_summary || "",
    transcriptText: row.transcript_text || "",
    rawText: row.raw_text || "",
    normalizedText: row.normalized_text || "",
    stageSuggestions: parseJsonField(row.stage_suggestions_json, []),
    createdAt: row.created_at,
  };
}

function buildConsolidatedSuggestions({ analyses, matchesByTarget }) {
  const firstValue = (key) =>
    analyses.find((analysis) =>
      String(analysis?.draftFields?.[key] || "").trim(),
    )?.draftFields?.[key] || "";
  const firstNumber = (key) => {
    const found = analyses.find(
      (analysis) =>
        analysis?.draftFields?.[key] !== null &&
        analysis?.draftFields?.[key] !== undefined,
    );
    return found ? found.draftFields[key] : null;
  };
  const primarySuggestedName = firstValue("suggestedName");
  const suggestedNameOptions = normalizeSuggestedNameOptions([
    primarySuggestedName,
    ...analyses.flatMap((analysis) => {
      const draftFields = analysis?.draftFields || {};
      return [
        draftFields.suggestedName,
        ...(Array.isArray(draftFields.suggestedNameOptions)
          ? draftFields.suggestedNameOptions
          : []),
      ];
    }),
  ]);

  return {
    suggestedName: primarySuggestedName || suggestedNameOptions[0] || "",
    suggestedNameOptions,
    suggestedAmountUsd: firstNumber("suggestedAmountUsd"),
    suggestedCloseDate: firstValue("suggestedCloseDate"),
    summaryNotes: analyses
      .map((analysis) =>
        String(analysis?.draftFields?.summaryNotes || "").trim(),
      )
      .filter(Boolean)
      .join("\n\n"),
    detectedAccountName: firstValue("detectedAccountName"),
    detectedContactName: firstValue("detectedContactName"),
    detectedBusinessLineName: firstValue("detectedBusinessLineName"),
    detectedSellerName: firstValue("detectedSellerName"),
    detectedPresalesName: firstValue("detectedPresalesName"),
    matchedAccount: matchesByTarget.account || null,
    matchedContact: matchesByTarget.contact || null,
    matchedBusinessLine: matchesByTarget.business_line || null,
    matchedSeller: matchesByTarget.seller_user || null,
    matchedPresales: matchesByTarget.presales_user || null,
  };
}

export async function createUploadSession({ user }) {
  const publicId = buildSessionPublicId();
  await query(
    `INSERT INTO opportunity_document_upload_sessions
       (public_id, entity_type, entity_id, status, created_by_user_id, created_at, updated_at, expires_at)
     VALUES (?, 'opportunity_draft', NULL, 'open', ?, NOW(3), NOW(3), DATE_ADD(NOW(3), INTERVAL 7 DAY))`,
    [publicId, Number(user.id)],
  );
  return getUploadSessionReview({ sessionPublicId: publicId, user });
}

export async function uploadFilesToSession({ req, sessionPublicId, user }) {
  const session = await getSessionByPublicId(sessionPublicId);
  assertSessionOwnership({ session, user });

  const { files } = await parseMultipartFiles(req);
  if (!files.length) {
    const error = new Error("Selecciona al menos un archivo");
    error.status = 400;
    throw error;
  }

  const existingDocuments = await loadSessionDocuments(session.id);
  validateSessionQuota(existingDocuments, files);

  const currentAudioFiles = existingDocuments.filter((document) =>
    [
      "audio/mpeg",
      "audio/wav",
      "audio/x-wav",
      "audio/mp4",
      "audio/x-m4a",
    ].includes(String(document.mime_type || "")),
  ).length;

  const uploadedDocuments = [];
  try {
    let audioFilesSeen = 0;
    let totalAudioDuration = existingDocuments.reduce(
      (total, document) => total + Number(document.duration_seconds || 0),
      0,
    );

    for (const file of files) {
      const { originalFileName, extension, mimeType, kind } =
        validateSingleFile(file);
      const buffer = await readFile(file.filepath);
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      let durationSeconds = null;

      if (kind === "audio") {
        audioFilesSeen += 1;
        if (
          currentAudioFiles + audioFilesSeen >
          config.documents.storage.maxAudioFilesPerSession
        ) {
          const error = new Error(
            `La sesion admite como maximo ${config.documents.storage.maxAudioFilesPerSession} archivos de audio.`,
          );
          error.status = 400;
          throw error;
        }

        const audioMetadata = await parseAudioBuffer(buffer, mimeType, {
          duration: true,
        });
        durationSeconds = Math.round(
          Number(audioMetadata.format.duration || 0),
        );
        if (
          durationSeconds >
          config.documents.storage.maxAudioDurationSecondsPerFile
        ) {
          const error = new Error(
            `El audio ${originalFileName} excede la duracion maxima permitida de ${Math.round(config.documents.storage.maxAudioDurationSecondsPerFile / 60)} minutos.`,
          );
          error.status = 400;
          throw error;
        }

        totalAudioDuration += durationSeconds;
        if (
          totalAudioDuration >
          config.documents.storage.maxAudioDurationSecondsPerSession
        ) {
          const error = new Error(
            "La sesion excede la duracion total permitida de audio.",
          );
          error.status = 400;
          throw error;
        }
      }

      const documentPublicId = buildDocumentPublicId();
      const storageKey = buildStorageKey({
        entityType: "opportunity_draft",
        publicId: session.public_id,
        sha256,
        fileName: originalFileName,
        createdAt: new Date(),
      });
      const stored = await storage.save({ buffer, storageKey });
      const deferredProcessing = shouldDeferDocumentProcessing();

      let extracted = null;
      let analysis = null;
      let processingError = null;
      let processingStatus = deferredProcessing ? "uploaded" : "processing";
      let matches = [];

      if (!deferredProcessing) {
        ({ extracted, analysis, processingError } =
          await extractAndAnalyzeDocument({
            documentRecord: null,
            buffer,
            extension,
            mimeType,
            originalFileName,
            aiUsageContext: {
              userId: Number(user.id),
            },
          }));
        if (!extracted.durationSeconds && durationSeconds) {
          extracted.durationSeconds = durationSeconds;
        }
        processingStatus = processingError ? "failed" : "review_ready";
        matches = await buildMatchResults({ user, analysis });
      }

      await withTransaction(async (conn) => {
        const [insertResult] = await conn.query(
          `INSERT INTO documents
             (public_id, upload_session_id, entity_type, entity_id, storage_provider,
              storage_bucket, storage_key, original_file_name, stored_file_name,
              mime_type, file_extension, byte_size, sha256, document_kind, source_label,
              processing_status, processing_error, duration_seconds, is_deleted,
              uploaded_by_user_id, created_at, updated_at)
           VALUES (?, ?, 'opportunity_draft', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NOW(3), NOW(3))`,
          [
            documentPublicId,
            session.id,
            stored.storageProvider,
            stored.storageBucket,
            stored.storageKey,
            originalFileName,
            stored.storedFileName,
            mimeType || "application/octet-stream",
            extension,
            Number(file.size || buffer.byteLength),
            sha256,
            kind,
            kind === "audio" ? "audio_upload" : "manual_upload",
            processingStatus,
            processingError,
            extracted?.durationSeconds || durationSeconds,
            Number(user.id),
          ],
        );

        if (deferredProcessing) {
          await createPendingDocumentArtifacts({
            conn,
            documentId: insertResult.insertId,
            extension,
            mimeType,
            durationSeconds,
          });
        } else {
          await persistDocumentArtifacts({
            conn,
            documentId: insertResult.insertId,
            extracted,
            analysis: { ...analysis, fileName: originalFileName },
            matches,
            processingStatus,
            processingError,
          });
        }

        await refreshUploadSessionStatus(conn, session.id);
      });

      uploadedDocuments.push(documentPublicId);
    }
  } finally {
    await cleanupTempFiles(files);
  }

  await queueDeferredDocumentProcessing();

  return getUploadSessionReview({ sessionPublicId, user });
}

export async function getUploadSessionReview({ sessionPublicId, user }) {
  const session = await getSessionByPublicId(sessionPublicId);
  assertSessionOwnership({ session, user });

  const documents = await query(
    `SELECT d.*, dc.extraction_status, dc.transcription_status, dc.content_summary,
            dc.transcript_text, dc.raw_text, dc.normalized_text,
            da.id AS analysis_id, da.draft_fields_json, da.stage_suggestions_json,
            da.warnings_json, da.confidence,
            dmr.id AS match_id, dmr.match_target, dmr.detected_label,
            dmr.match_status, dmr.selected_entity_id, dmr.selected_entity_label,
            dmr.candidate_entities_json, dmr.confidence_score, dmr.reason
     FROM documents d
     LEFT JOIN document_contents dc ON dc.document_id = d.id
     LEFT JOIN document_analyses da ON da.id = (
       SELECT da2.id
       FROM document_analyses da2
       WHERE da2.document_id = d.id
         AND da2.analysis_scope = 'opportunity_draft'
       ORDER BY da2.id DESC
       LIMIT 1
     )
     LEFT JOIN document_match_results dmr ON dmr.document_analysis_id = da.id
     WHERE d.upload_session_id = ?
       AND d.is_deleted = 0
     ORDER BY d.id ASC, dmr.id ASC`,
    [session.id],
  );

  const documentMap = new Map();
  for (const row of documents) {
    if (!documentMap.has(row.public_id)) {
      const draftFields = parseJsonField(row.draft_fields_json, {});
      const stageSuggestions = parseJsonField(row.stage_suggestions_json, []);
      const warnings = parseJsonField(row.warnings_json, []);
      documentMap.set(row.public_id, {
        ...serializeDocumentRow(row),
        analysis: {
          analysisId: row.analysis_id ? Number(row.analysis_id) : null,
          draftFields,
          stageSuggestions,
          warnings,
          confidence: row.confidence || "low",
        },
        matches: [],
      });
    }

    if (row.match_id) {
      documentMap.get(row.public_id).matches.push({
        id: Number(row.match_id),
        matchTarget: row.match_target,
        detectedLabel: row.detected_label,
        matchStatus: row.match_status,
        selectedEntityId:
          row.selected_entity_id === null
            ? null
            : Number(row.selected_entity_id),
        selectedEntityLabel: row.selected_entity_label || null,
        candidateEntities: parseJsonField(row.candidate_entities_json, []),
        confidenceScore:
          row.confidence_score === null ? 0 : Number(row.confidence_score),
        reason: row.reason || "",
      });
    }
  }

  const normalizedDocuments = Array.from(documentMap.values());
  const analyses = normalizedDocuments.map((document) => document.analysis);
  const matchesByTarget = Object.fromEntries(
    normalizedDocuments
      .flatMap((document) => document.matches)
      .map((match) => [match.matchTarget, match]),
  );

  const consolidated = buildConsolidatedSuggestions({
    analyses,
    matchesByTarget,
  });
  const warnings = normalizedDocuments.flatMap(
    (document) => document.analysis.warnings || [],
  );

  return {
    session: {
      publicId: session.public_id,
      status: session.status,
      entityType: session.entity_type,
      entityId: session.entity_id === null ? null : Number(session.entity_id),
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      expiresAt: session.expires_at,
    },
    documents: normalizedDocuments,
    review: {
      suggestedFields: consolidated,
      warnings,
      canApply: normalizedDocuments.some(
        (document) => document.processingStatus === "review_ready",
      ),
      executionPlan: {
        mode: config.documents.processing.mode,
        canDefer: shouldDeferDocumentProcessing(),
        queueName: "opportunity-document-processing",
      },
    },
  };
}

export async function applyUploadSessionToDraft({
  sessionPublicId,
  user,
  body = {},
}) {
  const review = await getUploadSessionReview({ sessionPublicId, user });
  const matchSelections = body.matchSelections || {};
  const fieldOverrides = body.fieldOverrides || {};
  const hasFieldOverride = (key) =>
    Object.prototype.hasOwnProperty.call(fieldOverrides, key);
  const hasMatchSelection = (key) =>
    Object.prototype.hasOwnProperty.call(matchSelections, key);
  const nextFields = {
    name:
      (hasFieldOverride("name")
        ? fieldOverrides.name
        : review.review.suggestedFields.suggestedName) || "",
    amountUsd: hasFieldOverride("amountUsd")
      ? fieldOverrides.amountUsd
      : review.review.suggestedFields.suggestedAmountUsd,
    closeDate:
      (hasFieldOverride("closeDate")
        ? fieldOverrides.closeDate
        : review.review.suggestedFields.suggestedCloseDate) || "",
    accountId: hasMatchSelection("accountId")
      ? matchSelections.accountId
      : review.review.suggestedFields.matchedAccount?.selectedEntityId || null,
    contactId: hasMatchSelection("contactId")
      ? matchSelections.contactId
      : review.review.suggestedFields.matchedContact?.selectedEntityId || null,
    businessLineId: hasMatchSelection("businessLineId")
      ? matchSelections.businessLineId
      : review.review.suggestedFields.matchedBusinessLine?.selectedEntityId ||
        null,
    sellerUserId: hasMatchSelection("sellerUserId")
      ? matchSelections.sellerUserId
      : review.review.suggestedFields.matchedSeller?.selectedEntityId || null,
    presalesUserId: hasMatchSelection("presalesUserId")
      ? matchSelections.presalesUserId
      : review.review.suggestedFields.matchedPresales?.selectedEntityId || null,
    summaryNotes:
      (hasFieldOverride("summaryNotes")
        ? fieldOverrides.summaryNotes
        : review.review.suggestedFields.summaryNotes) || "",
  };

  return {
    session: review.session,
    appliedDraft: nextFields,
    review: review.review,
  };
}

export async function transferUploadSessionToOpportunity({
  conn,
  sessionPublicId,
  opportunityId,
  userId,
}) {
  if (!sessionPublicId) return;

  await transferUploadSession({
    conn,
    sessionPublicId,
    entityType: "opportunity",
    entityId: opportunityId,
    userId,
    linkTable: "opportunity_document_links",
    linkColumn: "opportunity_id",
    sessionStatus: "applied",
  });
}

export async function transferUploadSessionToInteraction({
  conn,
  sessionPublicId,
  interactionId,
  userId,
}) {
  if (!sessionPublicId) return;

  await transferUploadSession({
    conn,
    sessionPublicId,
    entityType: "interaction",
    entityId: interactionId,
    userId,
    linkTable: null,
    linkColumn: null,
    sessionStatus: "applied",
  });
}

async function transferUploadSession({
  conn,
  sessionPublicId,
  entityType,
  entityId,
  userId,
  linkTable,
  linkColumn,
  sessionStatus,
}) {
  const [sessionRows] = await conn.query(
    `SELECT *
     FROM opportunity_document_upload_sessions
     WHERE public_id = ?
     LIMIT 1`,
    [sessionPublicId],
  );
  const session = sessionRows.length ? sessionRows[0] : null;
  if (!session) {
    const error = new Error("Sesion documental no encontrada");
    error.status = 404;
    throw error;
  }

  await conn.query(
    `UPDATE documents
     SET entity_type = ?, entity_id = ?, updated_at = NOW(3)
     WHERE upload_session_id = ?
       AND is_deleted = 0`,
    [entityType, entityId, session.id],
  );

  const [documents] = await conn.query(
    `SELECT id
     FROM documents
     WHERE upload_session_id = ?
       AND is_deleted = 0`,
    [session.id],
  );

  if (linkTable && linkColumn) {
    for (const document of documents) {
      await conn.query(
        `INSERT IGNORE INTO ${linkTable}
           (${linkColumn}, document_id, link_type, created_by_user_id, created_at)
         VALUES (?, ?, 'source_document', ?, NOW(3))`,
        [entityId, Number(document.id), Number(userId)],
      );
    }
  }

  await conn.query(
    `UPDATE opportunity_document_upload_sessions
     SET entity_type = ?, entity_id = ?, status = ?, updated_at = NOW(3)
     WHERE id = ?`,
    [entityType, entityId, sessionStatus, session.id],
  );
}

export async function listOpportunityDocuments({ opportunityId }) {
  const rows = await query(
    `SELECT d.*, dc.extraction_status, dc.transcription_status, dc.content_summary,
            dc.transcript_text, dc.raw_text, dc.normalized_text,
            da.stage_suggestions_json
     FROM opportunity_document_links odl
     INNER JOIN documents d ON d.id = odl.document_id
     LEFT JOIN document_contents dc ON dc.document_id = d.id
     LEFT JOIN document_analyses da ON da.id = (
       SELECT da2.id
       FROM document_analyses da2
       WHERE da2.document_id = d.id
         AND da2.analysis_scope = 'opportunity_draft'
       ORDER BY da2.id DESC
       LIMIT 1
     )
     WHERE odl.opportunity_id = ?
       AND d.is_deleted = 0
     ORDER BY d.created_at DESC, d.id DESC`,
    [opportunityId],
  );

  return rows.map((row) => serializeDocumentRow(row));
}

export async function deleteOpportunityDocument({
  opportunityId,
  documentPublicId,
}) {
  const documents = await query(
    `SELECT d.id, d.public_id, d.original_file_name, d.storage_bucket, d.storage_key
     FROM opportunity_document_links odl
     INNER JOIN documents d ON d.id = odl.document_id
     WHERE odl.opportunity_id = ?
       AND d.public_id = ?
       AND d.is_deleted = 0
     LIMIT 1`,
    [opportunityId, documentPublicId],
  );

  const document = documents[0] || null;
  if (!document) {
    const error = new Error("Documento no encontrado");
    error.status = 404;
    throw error;
  }

  await storage.delete({
    storageKey: document.storage_key,
    storageBucket: document.storage_bucket,
  });

  await query(`DELETE FROM documents WHERE id = ?`, [document.id]);

  return {
    publicId: document.public_id,
    originalFileName: document.original_file_name,
  };
}

export async function uploadDocumentsToOpportunity({
  req,
  opportunityId,
  user,
}) {
  const { files } = await parseMultipartFiles(req);
  if (!files.length) {
    const error = new Error("Selecciona al menos un archivo");
    error.status = 400;
    throw error;
  }

  try {
    for (const file of files) {
      const { originalFileName, extension, mimeType, kind } =
        validateSingleFile(file);
      const buffer = await readFile(file.filepath);
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      let durationSeconds = null;
      if (kind === "audio") {
        const audioMetadata = await parseAudioBuffer(buffer, mimeType, {
          duration: true,
        });
        durationSeconds = Math.round(
          Number(audioMetadata.format.duration || 0),
        );
      }
      const storageKey = buildStorageKey({
        entityType: "opportunity",
        publicId: `opp_${opportunityId}`,
        sha256,
        fileName: originalFileName,
        createdAt: new Date(),
      });
      const stored = await storage.save({ buffer, storageKey });
      const documentPublicId = buildDocumentPublicId();
      const deferredProcessing = shouldDeferDocumentProcessing();

      let extracted = null;
      let analysis = null;
      let processingError = null;
      let processingStatus = deferredProcessing ? "uploaded" : "processing";
      let matches = [];

      if (!deferredProcessing) {
        ({ extracted, analysis, processingError } =
          await extractAndAnalyzeDocument({
            documentRecord: null,
            buffer,
            extension,
            mimeType,
            originalFileName,
            aiUsageContext: {
              userId: Number(user.id),
            },
          }));
        if (!extracted.durationSeconds && durationSeconds) {
          extracted.durationSeconds = durationSeconds;
        }
        matches = await buildMatchResults({ user, analysis });
        processingStatus = processingError ? "failed" : "review_ready";
      }

      await withTransaction(async (conn) => {
        const [insertResult] = await conn.query(
          `INSERT INTO documents
             (public_id, upload_session_id, entity_type, entity_id, storage_provider,
              storage_bucket, storage_key, original_file_name, stored_file_name,
              mime_type, file_extension, byte_size, sha256, document_kind, source_label,
              processing_status, processing_error, duration_seconds, is_deleted,
              uploaded_by_user_id, created_at, updated_at)
           VALUES (?, NULL, 'opportunity', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NOW(3), NOW(3))`,
          [
            documentPublicId,
            opportunityId,
            stored.storageProvider,
            stored.storageBucket,
            stored.storageKey,
            originalFileName,
            stored.storedFileName,
            mimeType || "application/octet-stream",
            extension,
            Number(file.size || buffer.byteLength),
            sha256,
            kind,
            kind === "audio" ? "audio_upload" : "manual_upload",
            processingStatus,
            processingError,
            extracted?.durationSeconds || durationSeconds,
            Number(user.id),
          ],
        );

        if (deferredProcessing) {
          await createPendingDocumentArtifacts({
            conn,
            documentId: insertResult.insertId,
            extension,
            mimeType,
            durationSeconds,
          });
        } else {
          await persistDocumentArtifacts({
            conn,
            documentId: insertResult.insertId,
            extracted,
            analysis: { ...analysis, fileName: originalFileName },
            matches,
            processingStatus,
            processingError,
          });
        }

        await conn.query(
          `INSERT IGNORE INTO opportunity_document_links
             (opportunity_id, document_id, link_type, created_by_user_id, created_at)
           VALUES (?, ?, 'source_document', ?, NOW(3))`,
          [opportunityId, insertResult.insertId, Number(user.id)],
        );
      });
    }
  } finally {
    await cleanupTempFiles(files);
  }

  await queueDeferredDocumentProcessing();

  return listOpportunityDocuments({ opportunityId });
}

export async function getDocumentContentStream({ documentPublicId }) {
  const document = await getDocumentByPublicId(documentPublicId);
  if (!document) {
    const error = new Error("Documento no encontrado");
    error.status = 404;
    throw error;
  }

  const stream = await storage.openReadStream({
    storageKey: document.storage_key,
    storageBucket: document.storage_bucket,
  });
  return { document, stream };
}

export async function getDocumentPreviewText({ documentPublicId }) {
  const document = await getDocumentByPublicId(documentPublicId);
  if (!document) {
    const error = new Error("Documento no encontrado");
    error.status = 404;
    throw error;
  }

  const rows = await query(
    `SELECT raw_text, normalized_text, transcript_text, content_summary,
            extraction_status, transcription_status
     FROM document_contents
     WHERE document_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [document.id],
  );
  const row = rows[0] || null;
  const transcriptText = row?.transcript_text || "";
  const rawText = row?.raw_text || "";
  const normalizedText = row?.normalized_text || "";
  const contentSummary = row?.content_summary || "";

  const previewText =
    transcriptText || rawText || normalizedText || contentSummary || "";
  const previewKind = transcriptText
    ? "transcript"
    : rawText
      ? "raw"
      : normalizedText
        ? "normalized"
        : contentSummary
          ? "summary"
          : "empty";

  return {
    document,
    previewText,
    previewKind,
    transcriptText,
    rawText,
    normalizedText,
    contentSummary,
    extractionStatus: row?.extraction_status || "pending",
    transcriptionStatus: row?.transcription_status || "pending",
  };
}

export async function deleteSessionDocument({
  sessionPublicId,
  documentPublicId,
  user,
}) {
  const session = await getSessionByPublicId(sessionPublicId);
  assertSessionOwnership({ session, user });
  const document = await getDocumentByPublicId(documentPublicId);
  if (!document || Number(document.upload_session_id) !== Number(session.id)) {
    const error = new Error("Documento no encontrado en la sesion");
    error.status = 404;
    throw error;
  }

  await withTransaction(async (conn) => {
    await conn.query(
      `UPDATE documents
       SET is_deleted = 1, updated_at = NOW(3)
       WHERE id = ?`,
      [document.id],
    );
    await refreshUploadSessionStatus(conn, Number(session.id));
  });
  await storage.delete({
    storageKey: document.storage_key,
    storageBucket: document.storage_bucket,
  });

  return getUploadSessionReview({ sessionPublicId, user });
}

export async function purgeExpiredOpportunityDraftSessions({
  dryRun = false,
  now = new Date(),
} = {}) {
  let expiredSessions;
  try {
    expiredSessions = await query(
      `SELECT id, public_id
       FROM opportunity_document_upload_sessions
       WHERE entity_type = 'opportunity_draft'
         AND entity_id IS NULL
         AND expires_at IS NOT NULL
         AND expires_at < ?`,
      [now],
    );
  } catch (error) {
    if (error?.code === "ER_NO_SUCH_TABLE") {
      return {
        dryRun,
        skipped: true,
        reason: "document_schema_not_available",
        expiredSessionCount: 0,
        deletedDocumentCount: 0,
        deletedSessionCount: 0,
        sessionPublicIds: [],
      };
    }
    throw error;
  }

  if (!expiredSessions.length) {
    return {
      dryRun,
      expiredSessionCount: 0,
      deletedDocumentCount: 0,
      deletedSessionCount: 0,
      sessionPublicIds: [],
    };
  }

  const sessionIds = expiredSessions.map((session) => Number(session.id));
  const placeholders = sessionIds.map(() => "?").join(", ");
  const documents = await query(
    `SELECT id, public_id, storage_bucket, storage_key
     FROM documents
     WHERE upload_session_id IN (${placeholders})`,
    sessionIds,
  );

  if (dryRun) {
    return {
      dryRun,
      expiredSessionCount: expiredSessions.length,
      deletedDocumentCount: documents.length,
      deletedSessionCount: expiredSessions.length,
      sessionPublicIds: expiredSessions.map((session) => session.public_id),
      documentPublicIds: documents.map((document) => document.public_id),
    };
  }

  for (const document of documents) {
    await storage.delete({
      storageKey: document.storage_key,
      storageBucket: document.storage_bucket,
    });
  }

  await withTransaction(async (conn) => {
    await conn.query(
      `DELETE FROM documents
       WHERE upload_session_id IN (${placeholders})`,
      sessionIds,
    );
    await conn.query(
      `DELETE FROM opportunity_document_upload_sessions
       WHERE id IN (${placeholders})`,
      sessionIds,
    );
  });

  return {
    dryRun,
    expiredSessionCount: expiredSessions.length,
    deletedDocumentCount: documents.length,
    deletedSessionCount: expiredSessions.length,
    sessionPublicIds: expiredSessions.map((session) => session.public_id),
    documentPublicIds: documents.map((document) => document.public_id),
  };
}

export async function linkDocumentToOpportunityStage({
  opportunityId,
  salesStageId,
  documentPublicId,
  userId,
  linkRole = "evidence",
}) {
  const document = await getDocumentByPublicId(documentPublicId);
  if (!document) {
    const error = new Error("Documento no encontrado");
    error.status = 404;
    throw error;
  }

  await query(
    `INSERT IGNORE INTO opportunity_stage_document_links
       (opportunity_id, sales_stage_id, document_id, link_role, created_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, NOW(3))`,
    [opportunityId, salesStageId, document.id, linkRole, userId],
  );
}

export async function linkDocumentToStageAnswer({
  stageAnswerId,
  documentPublicId,
  evidenceExcerpt,
}) {
  const document = await getDocumentByPublicId(documentPublicId);
  if (!document) {
    const error = new Error("Documento no encontrado");
    error.status = 404;
    throw error;
  }

  await query(
    `INSERT IGNORE INTO opportunity_stage_answer_document_sources
       (stage_answer_id, document_id, evidence_excerpt, created_at)
     VALUES (?, ?, ?, NOW(3))`,
    [stageAnswerId, document.id, evidenceExcerpt || null],
  );
}
