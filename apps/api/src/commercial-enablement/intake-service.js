import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  assertAiBudgetAvailable,
  recordAiUsageFromOpenAiResponse,
} from "../ai-usage/service.js";
import { config } from "../config.js";
import { query, withTransaction } from "../db.js";
import {
  cleanupTempFiles,
  extractContentFromBuffer,
  parseMultipartFiles,
  validateSingleFile,
} from "../opportunity-documents/service.js";
import { createDocumentStorage } from "../opportunity-documents/storage.js";
import {
  createCommercialEnablementAsset,
  ensureCommercialEnablementStarterData,
  getCommercialEnablementAssetDetail,
  getCommercialEnablementCatalogs,
} from "./library-service.js";

const storage = createDocumentStorage();
const INTAKE_TTL_HOURS = 24;
const MAX_EXTRACTION_PREVIEW_CHARS = 6000;
const MAX_ANALYSIS_TEXT_CHARS = 18000;
const ANALYSIS_MODEL = config.openai.model || "gpt-4.1-mini";
const MAX_SUMMARY_SOURCE_TEXT_CHARS = 12000;
const MAX_SUMMARY_OUTPUT_CHARS = 900;

function createAiOnlyError({
  status,
  code,
  message,
  retryable = false,
  providerStatus = null,
}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.retryable = Boolean(retryable);
  error.providerStatus = providerStatus == null ? null : Number(providerStatus);
  error.body = {
    message,
    error: {
      code,
      retryable: Boolean(retryable),
      providerStatus: providerStatus == null ? null : Number(providerStatus),
    },
  };
  return error;
}

function mapProviderError(status) {
  const numericStatus = Number(status) || 500;
  if (numericStatus === 429) {
    return createAiOnlyError({
      status: 429,
      code: "ai_provider_rate_limited",
      message: "El proveedor IA rechazo la solicitud por limite de tasa",
      retryable: true,
      providerStatus: numericStatus,
    });
  }
  if (numericStatus === 408 || numericStatus === 504) {
    return createAiOnlyError({
      status: 504,
      code: "ai_provider_timeout",
      message: "El proveedor IA no respondio a tiempo",
      retryable: true,
      providerStatus: numericStatus,
    });
  }
  if (numericStatus >= 500) {
    return createAiOnlyError({
      status: 503,
      code: "ai_provider_unavailable",
      message: "El proveedor IA no esta disponible en este momento",
      retryable: true,
      providerStatus: numericStatus,
    });
  }
  return createAiOnlyError({
    status: 502,
    code: "ai_provider_unavailable",
    message: "La respuesta del proveedor IA no fue aceptada",
    retryable: true,
    providerStatus: numericStatus,
  });
}

function shouldFallbackToHeuristicSummary(error) {
  const code = String(error?.code || "").trim().toLowerCase();
  if (!code) return false;
  return code.startsWith("ai_");
}

function isAiValidatedRow(row) {
  return (
    String(row?.analysis_status || "") === "completed" &&
    Boolean(String(row?.analysis_model || "").trim()) &&
    !String(row?.analysis_error_code || "").trim()
  );
}

function buildAiRunFromRow(row) {
  const model = String(row?.analysis_model || "").trim();
  const used = isAiValidatedRow(row);
  if (!used && !model) {
    return null;
  }
  return {
    used,
    provider: "openai",
    model: model || null,
    requestId: null,
    latencyMs: null,
    inputChars: null,
    outputChars: null,
  };
}

function buildPublicId(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueStrings(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

function toStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[;,\n]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function summarizeText(value, maxChars) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

function summarizeNaturalText(value, maxChars) {
  const normalized = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;

  const sliced = normalized.slice(0, maxChars).trim();
  const sentenceMatch = sliced.match(/^([\s\S]*[.!?])[^.!?]*$/);
  if (sentenceMatch?.[1]?.trim()) {
    const sentence = sentenceMatch[1].trim();
    if (sentence.length >= Math.min(160, Math.floor(maxChars * 0.55))) {
      return sentence;
    }
  }

  const wordBoundary = sliced.replace(/\s+\S*$/, "").trim();
  return wordBoundary || sliced;
}

function normalizeLanguageCode(value) {
  const normalized = normalizeText(value).replace(/\s+/g, "_");
  if (!normalized) return null;

  if (
    ["es", "spa", "spanish", "espanol", "espanol_latam"].includes(normalized)
  ) {
    return "es";
  }
  if (["en", "eng", "english", "ingles", "inglish"].includes(normalized)) {
    return "en";
  }
  if (normalized.startsWith("es_")) return "es";
  if (normalized.startsWith("en_")) return "en";
  return null;
}

function detectLanguageFromText(text) {
  const source = ` ${String(text || "").toLowerCase()} `;
  if (!source.trim()) return "es";

  const spanishSignals = [
    " el ",
    " la ",
    " los ",
    " las ",
    " de ",
    " para ",
    " con ",
    " una ",
    " que ",
    " por ",
    " y ",
    " en ",
    " cliente ",
    " solucion ",
  ];
  const englishSignals = [
    " the ",
    " and ",
    " for ",
    " with ",
    " from ",
    " this ",
    " that ",
    " customer ",
    " solution ",
    " overview ",
    " benefits ",
  ];

  const spanishScore = spanishSignals.reduce(
    (total, token) => total + Number(source.includes(token)),
    /[áéíóúñü]/i.test(source) ? 2 : 0,
  );
  const englishScore = englishSignals.reduce(
    (total, token) => total + Number(source.includes(token)),
    0,
  );

  if (englishScore > spanishScore) return "en";
  return "es";
}

function detectLanguageCode({ reportedLanguage, text, hint }) {
  return (
    normalizeLanguageCode(reportedLanguage) ||
    detectLanguageFromText([text, hint].filter(Boolean).join("\n")) ||
    "es"
  );
}

function buildTitleBase(value) {
  return String(value || "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferDocumentKindLabel(value) {
  const normalized = normalizeText(value);
  if (!normalized) return "Documento";
  if (/\bdata\s*sheet\b|\bdatasheet\b/.test(normalized)) {
    return "Ficha tecnica";
  }
  if (/\bwhite\s*paper\b|\bwhitepaper\b/.test(normalized)) {
    return "Documento tecnico";
  }
  if (/\bbrochure\b|\bflyer\b/.test(normalized)) {
    return "Folleto comercial";
  }
  if (/\bcase\s*study\b/.test(normalized)) {
    return "Caso de exito";
  }
  if (/\bpresentation\b|\bpresentacion\b|\bdeck\b/.test(normalized)) {
    return "Presentacion comercial";
  }
  return "Documento";
}

function buildSummarySubject({ titleBase, hint }) {
  const preferred = String(hint || titleBase || "").trim();
  if (!preferred) return "";

  const cleaned = preferred
    .replace(/\bdata[\s_-]*sheet\b/gi, "")
    .replace(/\bdatasheet\b/gi, "")
    .replace(/\bwhite[\s_-]*paper\b/gi, "")
    .replace(/\bwhitepaper\b/gi, "")
    .replace(/\bbrochure\b/gi, "")
    .replace(/\bflyer\b/gi, "")
    .replace(/\bcase[\s_-]*study\b/gi, "")
    .replace(/\bpresentation\b/gi, "")
    .replace(/\bdeck\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || preferred;
}

function normalizeSummaryToSpanish({ summary, titleBase, hint, text }) {
  const candidate = summarizeNaturalText(summary, MAX_SUMMARY_OUTPUT_CHARS);
  if (candidate && detectLanguageFromText(candidate) === "es") {
    return candidate;
  }
  return buildSpanishSummary({ titleBase, hint, text });
}

function buildSpanishSummary({ titleBase, hint, text }) {
  const normalizedHint = String(hint || "")
    .replace(/\s+/g, " ")
    .trim();
  const excerpt = summarizeText(text || "", 360);
  const excerptLanguage = detectLanguageFromText(excerpt);
  const documentKind = inferDocumentKindLabel(
    `${titleBase || ""} ${normalizedHint || ""}`,
  );
  const subject = buildSummarySubject({ titleBase, hint: normalizedHint });

  if (excerpt && excerptLanguage === "es") {
    const sentences = excerpt
      .split(/(?<=[.!?])\s+/)
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 3);
    if (sentences.length) {
      return summarizeNaturalText(
        sentences.join(" "),
        MAX_SUMMARY_OUTPUT_CHARS,
      );
    }
  }

  if (subject) {
    const languageNote =
      excerpt && excerptLanguage === "en"
        ? " El contenido fuente original esta en ingles y requiere validacion editorial antes de compartirse."
        : "";
    return summarizeNaturalText(
      `${documentKind} sobre ${subject}. Resume el contenido principal, el uso recomendado y los mensajes clave que conviene conservar al compartirlo o reutilizarlo.${languageNote}`,
      MAX_SUMMARY_OUTPUT_CHARS,
    );
  }

  if (excerpt) {
    const languageLabel = excerptLanguage === "en" ? "ingles" : "otro idioma";
    return summarizeNaturalText(
      `${documentKind} detectado en ${languageLabel}. Resume el contenido principal, el uso recomendado y los mensajes clave antes de compartirlo o reutilizarlo.`,
      MAX_SUMMARY_OUTPUT_CHARS,
    );
  }

  return "Resumen preliminar pendiente de validacion manual.";
}

function extractJsonPayloadParts(payload) {
  return [
    String(payload?.output_text || "").trim(),
    ...(Array.isArray(payload?.output)
      ? payload.output.flatMap((entry) =>
          Array.isArray(entry?.content)
            ? entry.content.map((part) => String(part?.text || "").trim())
            : [],
        )
      : []),
  ].filter(Boolean);
}

function tryParseJsonPayloadPart(part) {
  try {
    return JSON.parse(part);
  } catch {
    const start = part.indexOf("{");
    const end = part.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(part.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function requestOpenAiSummarySuggestion({
  text,
  fileName,
  hint = "",
  aiUsageContext = null,
}) {
  if (!config.openai.apiKey) {
    throw createAiOnlyError({
      status: 500,
      code: "ai_disabled_configuration",
      message: "La configuracion IA no esta habilitada para este entorno",
      retryable: false,
    });
  }

  const requestStartedAt = Date.now();
  const aiUsageUserId = Number(aiUsageContext?.userId || 0);
  const aiUsageStartedAt = new Date();
  const aiUsageInternalRequestId =
    aiUsageContext?.internalRequestId || randomUUID();

  if (aiUsageUserId) {
    await assertAiBudgetAvailable({ userId: aiUsageUserId });
  }

  const response = await fetch(
    `${config.openai.baseUrl.replace(/\/$/, "")}/responses`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openai.apiKey}`,
      },
      body: JSON.stringify({
        model: ANALYSIS_MODEL,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: "Resume un documento de biblioteca comercial y devuelve exclusivamente JSON valido. Escribe summary siempre en espanol, aunque el documento fuente este en otro idioma. El summary debe explicar de forma breve y concreta que contiene el documento, para que sirve y que valor o utilidad practica aporta. Evita frases genericas como 'material comercial orientado a'. No inventes beneficios, promesas ni detalles no presentes en el texto. Devuelve solo {\"summary\": string}.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify({
                  fileName,
                  hint,
                  text: summarizeText(text, MAX_SUMMARY_SOURCE_TEXT_CHARS),
                }),
              },
            ],
          },
        ],
      }),
    },
  );

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw mapProviderError(response.status);
  }

  const requestId =
    response.headers.get("x-request-id") ||
    response.headers.get("openai-request-id") ||
    null;

  if (aiUsageUserId) {
    await recordAiUsageFromOpenAiResponse({
      internalRequestId: aiUsageInternalRequestId,
      userId: aiUsageUserId,
      featureCode:
        String(
          aiUsageContext?.featureCode || "commercial_enablement.intake_summary",
        ) || "commercial_enablement.intake_summary",
      model: ANALYSIS_MODEL,
      openAiResponse: payload,
      jobType: aiUsageContext?.jobType || null,
      jobId: aiUsageContext?.jobId || null,
      startedAt: aiUsageStartedAt,
    });
  }

  for (const part of extractJsonPayloadParts(payload)) {
    const parsed = tryParseJsonPayloadPart(part);
    if (parsed && typeof parsed === "object") {
      const summary = summarizeNaturalText(
        String(parsed.summary || ""),
        MAX_SUMMARY_OUTPUT_CHARS,
      );
      if (summary) {
        if (detectLanguageFromText(summary) !== "es") {
          throw createAiOnlyError({
            status: 502,
            code: "ai_output_schema_invalid",
            message:
              "La respuesta IA no cumple el formato o idioma esperado para el resumen",
            retryable: true,
          });
        }
        return {
          summary,
          aiRun: {
            used: true,
            provider: "openai",
            model: ANALYSIS_MODEL,
            requestId,
            latencyMs: Date.now() - requestStartedAt,
            inputChars: summarizeText(text, MAX_SUMMARY_SOURCE_TEXT_CHARS)
              .length,
            outputChars: summary.length,
          },
        };
      }
    }
  }

  throw createAiOnlyError({
    status: 502,
    code: "ai_output_unparseable",
    message: "No fue posible interpretar una salida IA valida para el resumen",
    retryable: true,
  });
}

function buildSpanishInternalDescription({ hint, languageCode }) {
  const normalizedHint = String(hint || "")
    .replace(/\s+/g, " ")
    .trim();
  const languageLabel = languageCode === "en" ? "ingles" : "espanol";

  if (normalizedHint) {
    return summarizeText(
      `Usar este material con enfoque ${normalizedHint}. Ajustar narrativa, llamados a la accion y clasificacion final durante la revision interna.`,
      280,
    );
  }

  return `Documento detectado en ${languageLabel}. Revisar mensaje, clasificacion comercial y nivel de visibilidad antes de publicarlo.`;
}

function buildStoredSessionResponse(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    publicId: row.public_id,
    status: row.status,
    sourceFileName: row.source_file_name || "",
    sourceMimeType: row.source_mime_type || "",
    sourceSizeBytes:
      row.source_size_bytes == null ? null : Number(row.source_size_bytes),
    sourceChecksum: row.source_checksum || "",
    storageProvider: row.storage_provider || "",
    storageBucket: row.storage_bucket || null,
    storageKey: row.storage_key || "",
    extractionStatus: row.extraction_status || "pending",
    extractionErrorCode: row.extraction_error_code || null,
    extractionErrorMessage: row.extraction_error_message || null,
    analysisStatus: row.analysis_status || "pending",
    analysisSource: "ai_only",
    analysisModel: row.analysis_model || null,
    analysisErrorCode: row.analysis_error_code || null,
    analysisErrorMessage: row.analysis_error_message || null,
    aiRun: buildAiRunFromRow(row),
    sourceHint: row.source_hint || "",
    sourceSummary: row.source_summary || "",
    languageDetected: row.language_detected || null,
    pageCount: row.page_count == null ? null : Number(row.page_count),
    extractionPreview: summarizeText(
      row.extraction_preview || "",
      MAX_EXTRACTION_PREVIEW_CHARS,
    ),
    draftPayload: parseJson(row.draft_payload_json, null),
    acceptedPayload: parseJson(row.accepted_payload_json, null),
    acceptedFieldDecisions: parseJson(row.accepted_field_decisions_json, []),
    warnings: parseJson(row.warnings_json, []),
    completedAssetId:
      row.completed_asset_id == null ? null : Number(row.completed_asset_id),
    completedAssetPublicId: row.completed_asset_public_id || null,
    reviewConfirmed: Boolean(row.review_confirmed),
    reviewStartedAt: row.review_started_at || null,
    expiresAt: row.expires_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function pickMatchingCodes(text, entries, maxResults = 3) {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => {
      const code = normalizeText(entry.code || "");
      const name = normalizeText(entry.name || "");
      return (
        (code && normalized.includes(code.replace(/_/g, " "))) ||
        (name && normalized.includes(name))
      );
    })
    .slice(0, maxResults)
    .map((entry) => entry.code);
}

function normalizeCatalogCodes(values, entries, maxResults = 5) {
  const sourceEntries = Array.isArray(entries) ? entries : [];
  const byCode = new Map(
    sourceEntries.map((entry) => [normalizeText(entry.code || ""), entry.code]),
  );
  const byName = new Map(
    sourceEntries.map((entry) => [normalizeText(entry.name || ""), entry.code]),
  );

  const normalized = [];
  for (const raw of toStringArray(values)) {
    const key = normalizeText(raw);
    if (!key) continue;
    const fromCode = byCode.get(key);
    if (fromCode) {
      normalized.push(fromCode);
      continue;
    }
    const fromName = byName.get(key);
    if (fromName) {
      normalized.push(fromName);
      continue;
    }

    for (const [nameKey, code] of byName.entries()) {
      if (key.includes(nameKey) || nameKey.includes(key)) {
        normalized.push(code);
        break;
      }
    }
  }

  return uniqueStrings(normalized).slice(0, maxResults);
}

function inferAssetType({ fileName, text, catalogs }) {
  const normalizedFileName = normalizeText(fileName);
  const normalizedText = normalizeText(text);
  const candidates = [
    {
      code: "presentation",
      score:
        Number(/presenta|slide|deck|ppt/.test(normalizedFileName)) +
        Number(/presentacion|slide|agenda/.test(normalizedText)),
    },
    {
      code: "case_study",
      score:
        Number(/caso/.test(normalizedFileName)) +
        Number(/caso de exito|cliente|resultado/.test(normalizedText)),
    },
    {
      code: "battlecard",
      score:
        Number(/comparativo|competencia|vs/.test(normalizedFileName)) +
        Number(/competidor|comparativ/.test(normalizedText)),
    },
    {
      code: "manufacturer_brief",
      score:
        Number(/fabricante|vendor/.test(normalizedFileName)) +
        Number(/fabricante|portafolio|marca/.test(normalizedText)),
    },
    {
      code: "template",
      score:
        Number(/template|plantilla/.test(normalizedFileName)) +
        Number(/plantilla|rellena|placeholder/.test(normalizedText)),
    },
    {
      code: "customer_document",
      score:
        Number(/cliente/.test(normalizedFileName)) +
        Number(/estimado cliente|para cliente/.test(normalizedText)),
    },
    {
      code: "solution_brief",
      score:
        1 +
        Number(
          /solucion|beneficio|capacidad|arquitectura/.test(normalizedText),
        ),
    },
  ]
    .sort((left, right) => right.score - left.score)
    .filter((candidate) =>
      (Array.isArray(catalogs.asset_type) ? catalogs.asset_type : []).some(
        (entry) => entry.code === candidate.code,
      ),
    );

  return candidates[0]?.code || "presentation";
}

function inferAudienceCode({ assetTypeCode, text }) {
  const normalizedText = normalizeText(text);
  if (assetTypeCode === "internal_playbook") return "seller";
  if (/cliente|decision|beneficio|riesgo|negocio/.test(normalizedText)) {
    return "client";
  }
  return "mixed";
}

function inferVisibilityLevel() {
  return null;
}

function buildHeuristicDraft({
  fileName,
  text,
  catalogs,
  hint = "",
  languageCode = "es",
}) {
  const assetTypeCode = inferAssetType({ fileName, text, catalogs });
  const manufacturerCodes = pickMatchingCodes(text, catalogs.manufacturer);
  const solutionCodes = pickMatchingCodes(text, catalogs.solution);
  const industryCodes = pickMatchingCodes(text, catalogs.industry, 2);
  const titleBase = String(fileName || "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    schemaVersion: "1.0",
    analysisStatus: "ready_for_review",
    prefill: {
      title: {
        value: titleBase || "Activo comercial sugerido",
        confidence: titleBase ? "medium" : "low",
        decisionRequired: false,
        evidence: ["Derivado del nombre del archivo cargado."],
      },
      summary: {
        value: buildSpanishSummary({ titleBase, hint, text }),
        confidence: text ? "medium" : "low",
        decisionRequired: false,
        evidence: [
          text
            ? "Resumen inicial generado en espanol a partir del contenido detectado."
            : "No hubo texto suficiente; se uso la pista del usuario si estaba disponible.",
        ],
      },
      internalDescription: {
        value: buildSpanishInternalDescription({ hint, languageCode }),
        confidence: hint ? "medium" : "low",
        decisionRequired: true,
        evidence: ["Sugerencia inicial de uso interno redactada en espanol."],
      },
      assetTypeCode: {
        value: assetTypeCode,
        confidence: "medium",
        decisionRequired: false,
        evidence: ["Clasificacion heuristica basada en nombre y contenido."],
      },
      manufacturerCodes: {
        values: manufacturerCodes,
        confidence: manufacturerCodes.length ? "medium" : "low",
        decisionRequired: manufacturerCodes.length === 0,
        evidence: ["Coincidencia contra catalogo de fabricantes."],
      },
      solutionCodes: {
        values: solutionCodes,
        confidence: solutionCodes.length ? "medium" : "low",
        decisionRequired: false,
        evidence: ["Coincidencia contra catalogo de soluciones."],
      },
      industryCodes: {
        values: industryCodes,
        confidence: industryCodes.length ? "medium" : "low",
        decisionRequired: industryCodes.length === 0,
        evidence: ["Coincidencia contra catalogo de industrias."],
      },
      audienceCode: {
        value: inferAudienceCode({ assetTypeCode, text }),
        confidence: "low",
        decisionRequired: true,
        evidence: ["Sugerencia inicial basada en tono del documento."],
      },
      languageCode: {
        value: languageCode,
        confidence: "medium",
        decisionRequired: false,
        evidence: [
          "Idioma detectado a partir del contenido extraido y metadatos disponibles.",
        ],
      },
      visibilityLevel: {
        value: inferVisibilityLevel(),
        confidence: "none",
        decisionRequired: true,
        evidence: ["La visibilidad final requiere validacion humana."],
      },
      status: {
        value: null,
        confidence: "none",
        decisionRequired: true,
        evidence: ["El estado final del activo debe decidirlo el usuario."],
      },
    },
    warnings: manufacturerCodes.length
      ? []
      : [
          {
            code: "manufacturer_not_detected",
            message: "No se detecto fabricante con suficiente certeza.",
          },
        ],
    missingInformation: [
      {
        field: "visibilityLevel",
        reason: "manual_confirmation_required",
      },
      {
        field: "status",
        reason: "manual_confirmation_required",
      },
    ],
  };
}

function buildDraftPayloadFromAnalysis(analysis, basePayload) {
  return {
    ...basePayload,
    title: analysis?.prefill?.title?.value || basePayload.title || "",
    summary: analysis?.prefill?.summary?.value || basePayload.summary || "",
    internalDescription:
      analysis?.prefill?.internalDescription?.value ||
      basePayload.internalDescription ||
      "",
    assetTypeCode:
      analysis?.prefill?.assetTypeCode?.value || basePayload.assetTypeCode,
    manufacturerCodes: uniqueStrings(
      analysis?.prefill?.manufacturerCodes?.values ||
        basePayload.manufacturerCodes ||
        [],
    ),
    solutionCodes: uniqueStrings(
      analysis?.prefill?.solutionCodes?.values ||
        basePayload.solutionCodes ||
        [],
    ),
    industryCodes: uniqueStrings(
      analysis?.prefill?.industryCodes?.values ||
        basePayload.industryCodes ||
        [],
    ),
    stageCodes: uniqueStrings(
      analysis?.prefill?.stageCodes?.values || basePayload.stageCodes || [],
    ),
    themeTags: uniqueStrings(
      analysis?.prefill?.themeTags?.values || basePayload.themeTags || [],
    ),
    personaTags: uniqueStrings(
      analysis?.prefill?.personaTags?.values || basePayload.personaTags || [],
    ),
    recommendedRoleTags: uniqueStrings(
      analysis?.prefill?.recommendedRoleTags?.values ||
        basePayload.recommendedRoleTags ||
        [],
    ),
    audienceCode:
      analysis?.prefill?.audienceCode?.value || basePayload.audienceCode,
    languageCode:
      analysis?.prefill?.languageCode?.value || basePayload.languageCode,
    visibilityLevel: basePayload.visibilityLevel,
    status: basePayload.status,
    sourceType: "file",
  };
}

function buildFieldDecisions(analysis, acceptedPayload) {
  const decisions = [];
  const mapping = [
    ["title", "value"],
    ["summary", "value"],
    ["internalDescription", "value"],
    ["assetTypeCode", "value"],
    ["audienceCode", "value"],
    ["languageCode", "value"],
    ["manufacturerCodes", "values"],
    ["solutionCodes", "values"],
    ["industryCodes", "values"],
  ];

  mapping.forEach(([field, property]) => {
    const suggested = analysis?.prefill?.[field]?.[property];
    const accepted = acceptedPayload?.[field];
    decisions.push({
      field,
      suggested,
      accepted,
      wasOverridden:
        JSON.stringify(suggested ?? null) !== JSON.stringify(accepted ?? null),
    });
  });

  return decisions;
}

async function requestOpenAiPrefill({
  catalogs,
  text,
  fileName,
  hint,
  aiUsageContext = null,
}) {
  if (!config.openai.apiKey) {
    throw createAiOnlyError({
      status: 500,
      code: "ai_disabled_configuration",
      message: "La configuracion IA no esta habilitada para este entorno",
      retryable: false,
    });
  }

  const requestStartedAt = Date.now();
  const aiUsageUserId = Number(aiUsageContext?.userId || 0);
  const aiUsageStartedAt = new Date();
  const aiUsageInternalRequestId =
    aiUsageContext?.internalRequestId || randomUUID();

  if (aiUsageUserId) {
    await assertAiBudgetAvailable({ userId: aiUsageUserId });
  }

  const response = await fetch(
    `${config.openai.baseUrl.replace(/\/$/, "")}/responses`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openai.apiKey}`,
      },
      body: JSON.stringify({
        model: ANALYSIS_MODEL,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: "Analiza un documento de biblioteca comercial y devuelve exclusivamente JSON valido. Los campos summary e internalDescription siempre deben redactarse en espanol, aunque el documento fuente este en otro idioma. El campo summary debe explicar brevemente que contiene el documento, para que sirve y que valor o utilidad practica aporta. Evita frases genericas como 'material comercial orientado a'. Identifica languageCode como 'es' o 'en'. Nunca decidas status ni visibilityLevel; siempre deben quedar como decisionRequired=true y value=null. Usa solo codigos existentes cuando clasifiques assetTypeCode, manufacturerCodes, solutionCodes, industryCodes y audienceCode.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify({
                  fileName,
                  hint,
                  text: summarizeText(text, MAX_ANALYSIS_TEXT_CHARS),
                  catalogs: {
                    assetTypeCodes: (catalogs.asset_type || []).map(
                      (entry) => entry.code,
                    ),
                    manufacturerCodes: (catalogs.manufacturer || []).map(
                      (entry) => ({ code: entry.code, name: entry.name }),
                    ),
                    solutionCodes: (catalogs.solution || []).map((entry) => ({
                      code: entry.code,
                      name: entry.name,
                    })),
                    industryCodes: (catalogs.industry || []).map((entry) => ({
                      code: entry.code,
                      name: entry.name,
                    })),
                  },
                }),
              },
            ],
          },
        ],
      }),
    },
  );

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw mapProviderError(response.status);
  }

  const requestId =
    response.headers.get("x-request-id") ||
    response.headers.get("openai-request-id") ||
    null;

  if (aiUsageUserId) {
    await recordAiUsageFromOpenAiResponse({
      internalRequestId: aiUsageInternalRequestId,
      userId: aiUsageUserId,
      featureCode:
        String(
          aiUsageContext?.featureCode || "commercial_enablement.intake_prefill",
        ) || "commercial_enablement.intake_prefill",
      model: ANALYSIS_MODEL,
      openAiResponse: payload,
      jobType: aiUsageContext?.jobType || null,
      jobId: aiUsageContext?.jobId || null,
      startedAt: aiUsageStartedAt,
    });
  }

  for (const part of extractJsonPayloadParts(payload)) {
    const parsed = tryParseJsonPayloadPart(part);
    if (parsed) {
      return {
        payload: parsed,
        aiRun: {
          used: true,
          provider: "openai",
          model: ANALYSIS_MODEL,
          requestId,
          latencyMs: Date.now() - requestStartedAt,
          inputChars: summarizeText(text, MAX_ANALYSIS_TEXT_CHARS).length,
          outputChars: String(part || "").length,
        },
      };
    }
  }

  throw createAiOnlyError({
    status: 502,
    code: "ai_output_unparseable",
    message: "No fue posible interpretar una salida IA valida para el analisis",
    retryable: true,
  });
}

async function requestOpenAiClassificationSuggestion({
  catalogs,
  text,
  fileName,
  hint,
  summary,
  aiUsageContext = null,
}) {
  if (!config.openai.apiKey) {
    throw createAiOnlyError({
      status: 500,
      code: "ai_disabled_configuration",
      message: "La configuracion IA no esta habilitada para este entorno",
      retryable: false,
    });
  }

  const requestStartedAt = Date.now();
  const aiUsageUserId = Number(aiUsageContext?.userId || 0);
  const aiUsageStartedAt = new Date();
  const aiUsageInternalRequestId =
    aiUsageContext?.internalRequestId || randomUUID();

  if (aiUsageUserId) {
    await assertAiBudgetAvailable({ userId: aiUsageUserId });
  }
  const response = await fetch(
    `${config.openai.baseUrl.replace(/\/$/, "")}/responses`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openai.apiKey}`,
      },
      body: JSON.stringify({
        model: ANALYSIS_MODEL,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: 'Devuelve exclusivamente JSON valido con clasificacion comercial. Usa solo codigos del catalogo provisto. No inventes codigos. Responde con: {"assetTypeCode": string|null, "audienceCode": string|null, "manufacturerCodes": string[], "solutionCodes": string[], "industryCodes": string[], "stageCodes": string[]}',
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify({
                  fileName,
                  hint,
                  summary,
                  text: summarizeText(text, 12000),
                  catalogs: {
                    assetTypeCodes: (catalogs.asset_type || []).map(
                      (entry) => entry.code,
                    ),
                    audienceCodes: (catalogs.audience || []).map(
                      (entry) => entry.code,
                    ),
                    manufacturerCodes: (catalogs.manufacturer || []).map(
                      (entry) => ({ code: entry.code, name: entry.name }),
                    ),
                    solutionCodes: (catalogs.solution || []).map((entry) => ({
                      code: entry.code,
                      name: entry.name,
                    })),
                    industryCodes: (catalogs.industry || []).map((entry) => ({
                      code: entry.code,
                      name: entry.name,
                    })),
                    stageCodes: (catalogs.stage || []).map((entry) => ({
                      code: entry.code,
                      name: entry.name,
                    })),
                  },
                }),
              },
            ],
          },
        ],
      }),
    },
  );

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw mapProviderError(response.status);
  }

  const requestId =
    response.headers.get("x-request-id") ||
    response.headers.get("openai-request-id") ||
    null;

  if (aiUsageUserId) {
    await recordAiUsageFromOpenAiResponse({
      internalRequestId: aiUsageInternalRequestId,
      userId: aiUsageUserId,
      featureCode:
        String(
          aiUsageContext?.featureCode ||
            "commercial_enablement.intake_classification",
        ) || "commercial_enablement.intake_classification",
      model: ANALYSIS_MODEL,
      openAiResponse: payload,
      jobType: aiUsageContext?.jobType || null,
      jobId: aiUsageContext?.jobId || null,
      startedAt: aiUsageStartedAt,
    });
  }

  for (const part of extractJsonPayloadParts(payload)) {
    const parsed = tryParseJsonPayloadPart(part);
    if (parsed && typeof parsed === "object") {
      return {
        payload: parsed,
        aiRun: {
          used: true,
          provider: "openai",
          model: ANALYSIS_MODEL,
          requestId,
          latencyMs: Date.now() - requestStartedAt,
          inputChars: summarizeText(text, 12000).length,
          outputChars: String(part || "").length,
        },
      };
    }
  }

  throw createAiOnlyError({
    status: 502,
    code: "ai_output_unparseable",
    message:
      "No fue posible interpretar una salida IA valida para clasificacion",
    retryable: true,
  });
}

export async function reanalyzeCommercialEnablementAssetSummary({
  assetPublicId,
  user,
}) {
  await ensureCommercialEnablementStarterData();

  const asset = await getCommercialEnablementAssetDetail({
    user,
    assetPublicId,
  });
  if (!asset) {
    const error = new Error("Activo no encontrado");
    error.status = 404;
    throw error;
  }

  const sourceRows = await query(
    `SELECT source_file_name, source_mime_type, extracted_text, extracted_text_summary, created_at
       FROM commercial_enablement_item_source_contents
      WHERE item_id = ?
      ORDER BY created_at DESC, id DESC`,
    [Number(asset.id)],
  );

  if (sourceRows.length !== 1) {
    const error = new Error(
      "El activo no tiene una fuente unica disponible para reanalizar el resumen",
    );
    error.status = 409;
    error.body = {
      message:
        "El activo no tiene una fuente unica disponible para reanalizar el resumen",
      error: {
        code: "asset_summary_source_unavailable",
        retryable: false,
      },
    };
    throw error;
  }

  const source = sourceRows[0];
  const extractedText = String(source.extracted_text || "").trim();
  const extractedSummary = String(source.extracted_text_summary || "").trim();
  const sourceText = extractedText || extractedSummary;

  if (!sourceText) {
    const error = new Error(
      "No existe texto fuente suficiente para reanalizar el resumen",
    );
    error.status = 422;
    error.body = {
      message: "No existe texto fuente suficiente para reanalizar el resumen",
      error: {
        code: "asset_summary_source_insufficient",
        retryable: false,
      },
    };
    throw error;
  }

  let aiSuggestion = null;
  let summaryText = "";

  try {
    aiSuggestion = await requestOpenAiSummarySuggestion({
      text: sourceText,
      fileName: source.source_file_name || asset.title || "documento",
      hint: asset.summary || asset.title || "",
      aiUsageContext: user?.id
        ? {
            userId: Number(user.id),
            featureCode: "commercial_enablement.asset_summary_reanalysis",
            jobType: "commercial_enablement_asset_summary_reanalysis",
            jobId: Number(asset.id),
            internalRequestId: `commercial_enablement_asset_summary_reanalysis:${Number(asset.id)}:${Date.now()}`,
          }
        : null,
    });
    summaryText = summarizeText(
      aiSuggestion?.summary || "",
      MAX_SUMMARY_OUTPUT_CHARS,
    );
  } catch (error) {
    if (!shouldFallbackToHeuristicSummary(error)) {
      throw error;
    }

    summaryText = summarizeNaturalText(
      buildSpanishSummary({
        titleBase: buildTitleBase(source.source_file_name || asset.title || ""),
        hint: asset.summary || asset.title || "",
        text: sourceText,
      }),
      MAX_SUMMARY_OUTPUT_CHARS,
    );
    aiSuggestion = {
      aiRun: {
        used: false,
        provider: "openai",
        model: ANALYSIS_MODEL,
        requestId: null,
        latencyMs: null,
        inputChars: summarizeText(sourceText, MAX_SUMMARY_SOURCE_TEXT_CHARS)
          .length,
        outputChars: summaryText.length,
      },
    };
  }

  if (!summaryText) {
    throw createAiOnlyError({
      status: 502,
      code: "ai_output_schema_invalid",
      message: "La respuesta IA no incluyo un resumen utilizable",
      retryable: true,
    });
  }

  return {
    assetPublicId: asset.publicId,
    summarySuggestion: {
      text: summaryText,
      languageCode: "es",
      generatedAt: new Date().toISOString(),
      sourceKind: "item_source_content",
      sourceFileName: source.source_file_name || "",
    },
    meta: {
      usedAi: Boolean(aiSuggestion?.aiRun?.used),
      aiRun: aiSuggestion.aiRun || null,
      charCount: summaryText.length,
    },
  };
}

async function analyzeIntakeSessionInternal({
  sessionRow,
  hint = "",
  forceRegenerate = false,
}) {
  if (!sessionRow) {
    const error = new Error("Sesion no encontrada");
    error.status = 404;
    throw error;
  }

  if (!forceRegenerate && sessionRow.analysis_status === "completed") {
    if (!isAiValidatedRow(sessionRow)) {
      throw createAiOnlyError({
        status: 412,
        code: "analysis_not_ai_validated",
        message:
          "La sesion actual no tiene un analisis IA valido; vuelve a analizar el documento",
        retryable: false,
      });
    }
    return buildStoredSessionResponse(sessionRow);
  }

  const catalogs = await getCommercialEnablementCatalogs();
  const aiUsageBaseContext = Number(sessionRow.uploaded_by_user_id || 0)
    ? {
        userId: Number(sessionRow.uploaded_by_user_id),
        jobType: "commercial_enablement_intake",
        jobId: Number(sessionRow.id),
      }
    : null;
  const textRows = await query(
    `SELECT text_content FROM commercial_enablement_intake_extracted_content WHERE intake_session_id = ? ORDER BY id`,
    [Number(sessionRow.id)],
  );
  const text = textRows.map((row) => row.text_content || "").join("\n\n");
  const titleBase = buildTitleBase(sessionRow.source_file_name);

  const aiResult = await requestOpenAiPrefill({
    catalogs,
    text,
    fileName: sessionRow.source_file_name,
    hint: hint || sessionRow.source_hint || "",
    aiUsageContext: aiUsageBaseContext
      ? {
          ...aiUsageBaseContext,
          featureCode: "commercial_enablement.intake_prefill",
          internalRequestId: `commercial_enablement_intake_prefill:${Number(sessionRow.id)}:${Date.now()}`,
        }
      : null,
  });
  if (!aiResult?.payload || typeof aiResult.payload !== "object") {
    throw createAiOnlyError({
      status: 502,
      code: "ai_output_schema_invalid",
      message: "La salida IA no devolvio un objeto de analisis valido",
      retryable: true,
    });
  }

  const languageCode = detectLanguageCode({
    reportedLanguage: sessionRow.language_detected,
    text,
    hint: hint || sessionRow.source_hint || "",
  });
  const aiPrefill = aiResult.payload.prefill || {};
  let aiSummary = summarizeNaturalText(
    String(aiPrefill?.summary?.value || ""),
    MAX_SUMMARY_OUTPUT_CHARS,
  );
  let summaryAiRun = aiResult.aiRun || null;

  if (!aiSummary || detectLanguageFromText(aiSummary) !== "es") {
    const summaryFallback = await requestOpenAiSummarySuggestion({
      text,
      fileName: sessionRow.source_file_name,
      hint:
        String(hint || sessionRow.source_hint || "").trim() ||
        "Genera un resumen comercial breve en espanol",
      aiUsageContext: aiUsageBaseContext
        ? {
            ...aiUsageBaseContext,
            featureCode: "commercial_enablement.intake_summary",
            internalRequestId: `commercial_enablement_intake_summary:${Number(sessionRow.id)}:${Date.now()}`,
          }
        : null,
    });
    aiSummary = summarizeNaturalText(
      String(summaryFallback?.summary || ""),
      MAX_SUMMARY_OUTPUT_CHARS,
    );
    summaryAiRun = summaryFallback?.aiRun || summaryAiRun;
  }

  if (!aiSummary || detectLanguageFromText(aiSummary) !== "es") {
    throw createAiOnlyError({
      status: 502,
      code: "ai_output_schema_invalid",
      message:
        "La IA no devolvio un resumen valido en espanol tras el reintento",
      retryable: true,
    });
  }

  const analysis = {
    schemaVersion: "1.0",
    analysisStatus: "ready_for_review",
    prefill: {
      title: {
        value: summarizeText(String(aiPrefill?.title?.value || ""), 190),
        confidence: aiPrefill?.title?.confidence || "medium",
        decisionRequired: Boolean(aiPrefill?.title?.decisionRequired),
        evidence: Array.isArray(aiPrefill?.title?.evidence)
          ? aiPrefill.title.evidence
          : [],
      },
      summary: {
        value: aiSummary,
        confidence: aiPrefill?.summary?.confidence || "medium",
        decisionRequired: Boolean(aiPrefill?.summary?.decisionRequired),
        evidence: Array.isArray(aiPrefill?.summary?.evidence)
          ? aiPrefill.summary.evidence
          : [],
      },
      internalDescription: {
        value: summarizeText(
          String(aiPrefill?.internalDescription?.value || ""),
          40000,
        ),
        confidence: aiPrefill?.internalDescription?.confidence || "low",
        decisionRequired:
          aiPrefill?.internalDescription?.decisionRequired !== false,
        evidence: Array.isArray(aiPrefill?.internalDescription?.evidence)
          ? aiPrefill.internalDescription.evidence
          : [],
      },
      assetTypeCode: {
        value: String(aiPrefill?.assetTypeCode?.value || "presentation"),
        confidence: aiPrefill?.assetTypeCode?.confidence || "low",
        decisionRequired: Boolean(aiPrefill?.assetTypeCode?.decisionRequired),
        evidence: Array.isArray(aiPrefill?.assetTypeCode?.evidence)
          ? aiPrefill.assetTypeCode.evidence
          : [],
      },
      manufacturerCodes: {
        values: uniqueStrings(aiPrefill?.manufacturerCodes?.values || []),
        confidence: aiPrefill?.manufacturerCodes?.confidence || "low",
        decisionRequired:
          aiPrefill?.manufacturerCodes?.decisionRequired !== false,
        evidence: Array.isArray(aiPrefill?.manufacturerCodes?.evidence)
          ? aiPrefill.manufacturerCodes.evidence
          : [],
      },
      solutionCodes: {
        values: uniqueStrings(aiPrefill?.solutionCodes?.values || []),
        confidence: aiPrefill?.solutionCodes?.confidence || "low",
        decisionRequired: Boolean(aiPrefill?.solutionCodes?.decisionRequired),
        evidence: Array.isArray(aiPrefill?.solutionCodes?.evidence)
          ? aiPrefill.solutionCodes.evidence
          : [],
      },
      industryCodes: {
        values: uniqueStrings(aiPrefill?.industryCodes?.values || []),
        confidence: aiPrefill?.industryCodes?.confidence || "low",
        decisionRequired: aiPrefill?.industryCodes?.decisionRequired !== false,
        evidence: Array.isArray(aiPrefill?.industryCodes?.evidence)
          ? aiPrefill.industryCodes.evidence
          : [],
      },
      audienceCode: {
        value: String(aiPrefill?.audienceCode?.value || "mixed"),
        confidence: aiPrefill?.audienceCode?.confidence || "low",
        decisionRequired: aiPrefill?.audienceCode?.decisionRequired !== false,
        evidence: Array.isArray(aiPrefill?.audienceCode?.evidence)
          ? aiPrefill.audienceCode.evidence
          : [],
      },
      languageCode: {
        value: ["es", "en"].includes(
          String(aiPrefill?.languageCode?.value || ""),
        )
          ? String(aiPrefill.languageCode.value)
          : languageCode,
        confidence: aiPrefill?.languageCode?.confidence || "medium",
        decisionRequired: Boolean(aiPrefill?.languageCode?.decisionRequired),
        evidence: Array.isArray(aiPrefill?.languageCode?.evidence)
          ? aiPrefill.languageCode.evidence
          : [],
      },
      visibilityLevel: {
        value: null,
        confidence: "none",
        decisionRequired: true,
        evidence: ["La visibilidad final requiere validacion humana."],
      },
      status: {
        value: null,
        confidence: "none",
        decisionRequired: true,
        evidence: ["El estado final del activo debe decidirlo el usuario."],
      },
    },
    warnings: Array.isArray(aiResult.payload.warnings)
      ? aiResult.payload.warnings
      : [],
  };

  analysis.prefill.assetTypeCode.value =
    normalizeCatalogCodes(
      [analysis.prefill.assetTypeCode.value],
      catalogs.asset_type,
      1,
    )[0] || "presentation";
  analysis.prefill.audienceCode.value =
    normalizeCatalogCodes(
      [analysis.prefill.audienceCode.value],
      catalogs.audience,
      1,
    )[0] || "mixed";
  analysis.prefill.manufacturerCodes.values = normalizeCatalogCodes(
    analysis.prefill.manufacturerCodes.values,
    catalogs.manufacturer,
    6,
  );
  analysis.prefill.solutionCodes.values = normalizeCatalogCodes(
    analysis.prefill.solutionCodes.values,
    catalogs.solution,
    6,
  );
  analysis.prefill.industryCodes.values = normalizeCatalogCodes(
    analysis.prefill.industryCodes.values,
    catalogs.industry,
    4,
  );
  analysis.prefill.stageCodes = {
    values: normalizeCatalogCodes(
      aiPrefill?.stageCodes?.values || [],
      catalogs.stage,
      4,
    ),
    confidence: aiPrefill?.stageCodes?.confidence || "low",
    decisionRequired: true,
    evidence: Array.isArray(aiPrefill?.stageCodes?.evidence)
      ? aiPrefill.stageCodes.evidence
      : [],
  };

  if (
    analysis.prefill.manufacturerCodes.values.length === 0 ||
    analysis.prefill.solutionCodes.values.length === 0
  ) {
    const classify = await requestOpenAiClassificationSuggestion({
      catalogs,
      text,
      fileName: sessionRow.source_file_name,
      hint: hint || sessionRow.source_hint || "",
      summary: aiSummary,
      aiUsageContext: aiUsageBaseContext
        ? {
            ...aiUsageBaseContext,
            featureCode: "commercial_enablement.intake_classification",
            internalRequestId: `commercial_enablement_intake_classification:${Number(sessionRow.id)}:${Date.now()}`,
          }
        : null,
    });
    const c = classify.payload || {};

    analysis.prefill.assetTypeCode.value =
      normalizeCatalogCodes([c.assetTypeCode], catalogs.asset_type, 1)[0] ||
      analysis.prefill.assetTypeCode.value;
    analysis.prefill.audienceCode.value =
      normalizeCatalogCodes([c.audienceCode], catalogs.audience, 1)[0] ||
      analysis.prefill.audienceCode.value;

    const manufacturerCodes = normalizeCatalogCodes(
      c.manufacturerCodes,
      catalogs.manufacturer,
      6,
    );
    const solutionCodes = normalizeCatalogCodes(
      c.solutionCodes,
      catalogs.solution,
      6,
    );
    const industryCodes = normalizeCatalogCodes(
      c.industryCodes,
      catalogs.industry,
      4,
    );
    const stageCodes = normalizeCatalogCodes(c.stageCodes, catalogs.stage, 4);

    analysis.prefill.manufacturerCodes.values = uniqueStrings([
      ...analysis.prefill.manufacturerCodes.values,
      ...manufacturerCodes,
    ]);
    analysis.prefill.solutionCodes.values = uniqueStrings([
      ...analysis.prefill.solutionCodes.values,
      ...solutionCodes,
    ]);
    analysis.prefill.industryCodes.values = uniqueStrings([
      ...analysis.prefill.industryCodes.values,
      ...industryCodes,
    ]);
    analysis.prefill.stageCodes.values = uniqueStrings([
      ...(analysis.prefill.stageCodes.values || []),
      ...stageCodes,
    ]);
    summaryAiRun = classify.aiRun || summaryAiRun;
  }

  const warnings = Array.isArray(analysis.warnings) ? analysis.warnings : [];

  if (!analysis.prefill.title.value) {
    analysis.prefill.title.value =
      titleBase || "Activo comercial sugerido por IA";
  }

  const basePayload = {
    title: "",
    summary: "",
    internalDescription: "",
    assetTypeCode: "presentation",
    status: "published",
    sourceType: "file",
    visibilityLevel: "client_safe",
    audienceCode: "mixed",
    languageCode: detectLanguageCode({
      reportedLanguage: sessionRow.language_detected,
      text,
      hint: hint || sessionRow.source_hint || "",
    }),
    manufacturerCodes: [],
    solutionCodes: [],
    needCodes: [],
    requirementCodes: [],
    competitorCodes: [],
    industryCodes: [],
    stageCodes: [],
    themeTags: [],
    personaTags: [],
    recommendedRoleTags: [],
    isInternal: false,
    isDownloadable: true,
  };
  const draftPayload = buildDraftPayloadFromAnalysis(analysis, basePayload);

  await query(
    `UPDATE commercial_enablement_intake_sessions
     SET status = 'ready_for_review',
         analysis_status = 'completed',
         analysis_model = ?,
         analysis_error_code = NULL,
         analysis_error_message = NULL,
         source_hint = ?,
         draft_payload_json = ?,
         warnings_json = ?,
         updated_at = NOW(3)
     WHERE id = ?`,
    [
      summaryAiRun?.model || aiResult.aiRun?.model || ANALYSIS_MODEL,
      String(hint || sessionRow.source_hint || "").trim(),
      JSON.stringify(draftPayload),
      JSON.stringify(warnings),
      Number(sessionRow.id),
    ],
  );

  const [nextRow] = await query(
    `SELECT s.*, i.public_id AS completed_asset_public_id
     FROM commercial_enablement_intake_sessions s
     LEFT JOIN commercial_enablement_items i ON i.id = s.completed_asset_id
     WHERE s.id = ? LIMIT 1`,
    [Number(sessionRow.id)],
  );
  return buildStoredSessionResponse(nextRow);
}

async function getIntakeSessionRowByPublicId(publicId) {
  const rows = await query(
    `SELECT s.*, i.public_id AS completed_asset_public_id
     FROM commercial_enablement_intake_sessions s
     LEFT JOIN commercial_enablement_items i ON i.id = s.completed_asset_id
     WHERE s.public_id = ?
       AND s.status <> 'expired'
     LIMIT 1`,
    [String(publicId || "")],
  );
  return rows[0] || null;
}

async function ensureSessionAccess({ publicId, user }) {
  const row = await getIntakeSessionRowByPublicId(publicId);
  if (!row) {
    const error = new Error("Sesion no encontrada");
    error.status = 404;
    throw error;
  }

  if (Number(row.uploaded_by_user_id || 0) !== Number(user.id)) {
    const error = new Error("No autorizado para acceder a esta sesion");
    error.status = 403;
    throw error;
  }

  return row;
}

export async function createCommercialEnablementIntakeSession({
  req,
  user,
  hint = "",
}) {
  await ensureCommercialEnablementStarterData();
  const { files } = await parseMultipartFiles(req);
  if (!files.length) {
    const error = new Error("No se recibio ningun archivo");
    error.status = 400;
    throw error;
  }

  if (files.length > 1) {
    const error = new Error("Solo se permite un archivo por sesion asistida");
    error.status = 400;
    throw error;
  }

  const file = files[0];
  const validatedFile = validateSingleFile(file);
  const publicId = buildPublicId("ceis");

  try {
    const buffer = await readFile(file.filepath);
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const extension = validatedFile.extension;
    const storageKey = `commercial_enablement/intake/${publicId}/${sha256}${extension}`;
    let stored;
    try {
      stored = await storage.save({ buffer, storageKey });
    } catch (error) {
      const storageError = new Error(
        "No fue posible guardar temporalmente el archivo para la sesion asistida",
      );
      storageError.status = 502;
      storageError.cause = error;
      throw storageError;
    }

    let extracted;
    try {
      extracted = await extractContentFromBuffer({
        buffer,
        fileName: validatedFile.originalFileName,
        mimeType: validatedFile.mimeType || "application/octet-stream",
        extension,
      });
    } catch (error) {
      if (error?.status) {
        throw error;
      }
      const extractionError = new Error(
        String(
          error?.message || "No fue posible extraer el contenido del archivo",
        ),
      );
      extractionError.status = 422;
      extractionError.cause = error;
      throw extractionError;
    }

    const extractedText = String(
      extracted.normalizedText || extracted.rawText || "",
    ).trim();
    const detectedLanguageCode = detectLanguageCode({
      reportedLanguage: extracted.transcriptionLanguage,
      text: extractedText,
      hint,
    });
    const extractionPreview = summarizeText(
      extractedText,
      MAX_EXTRACTION_PREVIEW_CHARS,
    );

    await withTransaction(async (conn) => {
      const [result] = await conn.query(
        `INSERT INTO commercial_enablement_intake_sessions
          (public_id, status, uploaded_by_user_id, source_file_name, source_mime_type,
           source_size_bytes, source_checksum, storage_provider, storage_bucket,
           storage_key, extraction_status, analysis_status, source_hint,
           source_summary, language_detected, page_count, extraction_preview,
           expires_at, created_at, updated_at)
         VALUES (?, 'analysis_pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, DATE_ADD(NOW(3), INTERVAL ? HOUR), NOW(3), NOW(3))`,
        [
          publicId,
          Number(user.id),
          validatedFile.originalFileName || path.basename(file.filepath),
          validatedFile.mimeType || "application/octet-stream",
          Number(file.size || 0),
          sha256,
          stored.storageProvider,
          stored.storageBucket,
          stored.storageKey,
          extracted.extractionStatus || "completed",
          String(hint || "").trim(),
          extracted.contentSummary || "",
          detectedLanguageCode,
          extracted.pageCount == null ? null : Number(extracted.pageCount),
          extractionPreview,
          INTAKE_TTL_HOURS,
        ],
      );
      const intakeSessionId = Number(result.insertId);

      await conn.query(
        `INSERT INTO commercial_enablement_intake_extracted_content
          (intake_session_id, content_kind, page_number, text_content, char_count, created_at)
         VALUES (?, 'full_text', NULL, ?, ?, NOW(3))`,
        [intakeSessionId, extractedText, extractedText.length],
      );
    });

    const sessionRow = await getIntakeSessionRowByPublicId(publicId);
    return buildStoredSessionResponse(sessionRow);
  } finally {
    await cleanupTempFiles(files).catch(() => undefined);
  }
}

export async function getCommercialEnablementIntakeSession({ publicId, user }) {
  const row = await ensureSessionAccess({ publicId, user });
  return buildStoredSessionResponse(row);
}

export async function getCommercialEnablementIntakeExtractedContent({
  publicId,
  user,
}) {
  const row = await ensureSessionAccess({ publicId, user });
  const contents = await query(
    `SELECT content_kind, page_number, text_content, char_count, created_at
     FROM commercial_enablement_intake_extracted_content
     WHERE intake_session_id = ?
     ORDER BY id`,
    [Number(row.id)],
  );
  return {
    session: buildStoredSessionResponse(row),
    contents: contents.map((entry) => ({
      contentKind: entry.content_kind,
      pageNumber: entry.page_number == null ? null : Number(entry.page_number),
      textContent: entry.text_content || "",
      charCount: Number(entry.char_count || 0),
      createdAt: entry.created_at || null,
    })),
  };
}

export async function analyzeCommercialEnablementIntakeSession({
  publicId,
  user,
  hint = "",
  forceRegenerate = false,
}) {
  const row = await ensureSessionAccess({ publicId, user });
  await query(
    `UPDATE commercial_enablement_intake_sessions
     SET status = 'analysis_running', analysis_status = 'running', updated_at = NOW(3)
     WHERE id = ?`,
    [Number(row.id)],
  );
  const refreshed = await ensureSessionAccess({ publicId, user });
  try {
    return await analyzeIntakeSessionInternal({
      sessionRow: refreshed,
      hint,
      forceRegenerate,
    });
  } catch (error) {
    const failureCode = String(error?.code || "analysis_failed").trim();
    const failureMessage = String(
      error?.message || "No fue posible analizar el documento con IA",
    ).trim();
    await query(
      `UPDATE commercial_enablement_intake_sessions
       SET status = 'analysis_failed',
           analysis_status = 'failed',
           analysis_model = NULL,
           analysis_error_code = ?,
           analysis_error_message = ?,
           draft_payload_json = NULL,
           updated_at = NOW(3)
       WHERE id = ?`,
      [failureCode, failureMessage.slice(0, 1000), Number(row.id)],
    );
    throw error;
  }
}

export async function reviewCommercialEnablementIntakeSession({
  publicId,
  user,
  acceptedPayload,
  reviewConfirmed = false,
}) {
  const row = await ensureSessionAccess({ publicId, user });
  if (!isAiValidatedRow(row)) {
    throw createAiOnlyError({
      status: 412,
      code: "analysis_not_ai_validated",
      message:
        "La revision solo esta disponible cuando el analisis IA se completa correctamente",
      retryable: false,
    });
  }
  const analysis = {
    prefill: parseJson(row.draft_payload_json, {}),
  };
  const decisions = buildFieldDecisions(
    { prefill: analysis.prefill },
    acceptedPayload,
  );
  const canCreate =
    String(acceptedPayload?.title || "").trim().length >= 3 &&
    String(acceptedPayload?.summary || "").trim().length > 0 &&
    String(acceptedPayload?.assetTypeCode || "").trim().length > 0 &&
    ((Array.isArray(acceptedPayload?.manufacturerCodes) &&
      acceptedPayload.manufacturerCodes.length > 0) ||
      (Array.isArray(acceptedPayload?.solutionCodes) &&
        acceptedPayload.solutionCodes.length > 0)) &&
    String(acceptedPayload?.visibilityLevel || "").trim().length > 0 &&
    String(acceptedPayload?.status || "").trim().length > 0 &&
    reviewConfirmed;

  await query(
    `UPDATE commercial_enablement_intake_sessions
     SET status = ?,
         accepted_payload_json = ?,
         accepted_field_decisions_json = ?,
         review_confirmed = ?,
         review_started_at = COALESCE(review_started_at, NOW(3)),
         updated_at = NOW(3)
     WHERE id = ?`,
    [
      canCreate ? "ready_to_create" : "review_in_progress",
      JSON.stringify(acceptedPayload || {}),
      JSON.stringify(decisions),
      reviewConfirmed ? 1 : 0,
      Number(row.id),
    ],
  );

  const nextRow = await ensureSessionAccess({ publicId, user });
  return {
    ...buildStoredSessionResponse(nextRow),
    canCreate,
  };
}

export async function createCommercialEnablementAssetFromIntakeSession({
  publicId,
  user,
  finalPayload,
  reviewConfirmed = false,
}) {
  const row = await ensureSessionAccess({ publicId, user });
  if (!isAiValidatedRow(row)) {
    throw createAiOnlyError({
      status: 412,
      code: "analysis_not_ai_validated",
      message:
        "No se puede crear el activo hasta completar una sugerencia IA valida",
      retryable: false,
    });
  }
  if (!reviewConfirmed) {
    const error = new Error(
      "Debes confirmar la revision manual antes de crear el activo",
    );
    error.status = 400;
    throw error;
  }

  const created = await createCommercialEnablementAsset({
    body: {
      ...finalPayload,
      sourceType: "file",
      isInternal: finalPayload?.visibilityLevel !== "client_safe",
    },
    user,
  });

  const filePublicId = buildPublicId("cef");
  await query(
    `INSERT INTO commercial_enablement_item_files
      (public_id, item_id, storage_provider, storage_bucket, storage_key,
       original_file_name, stored_file_name, mime_type, file_extension,
       byte_size, sha256, uploaded_by_user_id, is_deleted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NOW(3), NOW(3))`,
    [
      filePublicId,
      Number(created.id),
      row.storage_provider,
      row.storage_bucket,
      row.storage_key,
      row.source_file_name,
      path.basename(String(row.storage_key || "archivo")),
      row.source_mime_type,
      path.extname(String(row.source_file_name || "")),
      Number(row.source_size_bytes || 0),
      row.source_checksum,
      Number(user.id),
    ],
  );

  const contentRows = await query(
    `SELECT text_content FROM commercial_enablement_intake_extracted_content WHERE intake_session_id = ? ORDER BY id`,
    [Number(row.id)],
  );
  const extractedText = contentRows
    .map((entry) => entry.text_content || "")
    .join("\n\n");
  await query(
    `INSERT INTO commercial_enablement_item_source_contents
      (item_id, intake_session_id, source_file_name, source_mime_type, source_checksum,
       extracted_text, extracted_text_summary, accepted_suggestions_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(3))`,
    [
      Number(created.id),
      Number(row.id),
      row.source_file_name,
      row.source_mime_type,
      row.source_checksum,
      extractedText,
      row.source_summary || "",
      JSON.stringify(finalPayload || {}),
    ],
  );

  await query(
    `UPDATE commercial_enablement_intake_sessions
     SET status = 'completed',
         completed_asset_id = ?,
         accepted_payload_json = ?,
         review_confirmed = 1,
         updated_at = NOW(3)
     WHERE id = ?`,
    [Number(created.id), JSON.stringify(finalPayload || {}), Number(row.id)],
  );

  return await getCommercialEnablementAssetDetail({
    user,
    assetPublicId: created.publicId,
  });
}

export async function cancelCommercialEnablementIntakeSession({
  publicId,
  user,
}) {
  const row = await ensureSessionAccess({ publicId, user });
  if (row.storage_key) {
    await storage
      .delete({
        storageKey: row.storage_key,
        storageBucket: row.storage_bucket,
      })
      .catch(() => undefined);
  }
  await query(
    `UPDATE commercial_enablement_intake_sessions
     SET status = 'cancelled', updated_at = NOW(3)
     WHERE id = ?`,
    [Number(row.id)],
  );
  return { ok: true };
}
