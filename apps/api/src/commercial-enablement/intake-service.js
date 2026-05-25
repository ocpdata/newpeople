import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { readFile } from "node:fs/promises";
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

function summarizeText(value, maxChars) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
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

function buildSpanishSummary({ titleBase, hint, text }) {
  const normalizedHint = String(hint || "")
    .replace(/\s+/g, " ")
    .trim();
  const excerpt = summarizeText(text || "", 220);

  if (normalizedHint) {
    return summarizeText(
      `Material comercial orientado a ${normalizedHint}. Validar que el mensaje final conserve beneficios, diferenciadores y siguiente paso comercial.`,
      320,
    );
  }

  if (titleBase) {
    return summarizeText(
      `Resumen comercial preliminar para ${titleBase}. Confirmar beneficios clave, propuesta de valor y contexto de uso antes de compartirlo con el cliente o el equipo.`,
      320,
    );
  }

  if (excerpt) {
    return summarizeText(
      `Resumen comercial preliminar derivado del documento cargado. Contenido base detectado: ${excerpt}`,
      320,
    );
  }

  return "Resumen comercial preliminar pendiente de validacion manual.";
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
    analysisModel: row.analysis_model || null,
    analysisErrorCode: row.analysis_error_code || null,
    analysisErrorMessage: row.analysis_error_message || null,
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

async function requestOpenAiPrefill({ catalogs, text, fileName, hint }) {
  if (!config.openai.apiKey) {
    return null;
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
                text: "Analiza un documento de biblioteca comercial y devuelve exclusivamente JSON valido. Los campos summary e internalDescription siempre deben redactarse en espanol, aunque el documento fuente este en otro idioma. Identifica languageCode como 'es' o 'en'. Nunca decidas status ni visibilityLevel; siempre deben quedar como decisionRequired=true y value=null. Usa solo codigos existentes cuando clasifiques assetTypeCode, manufacturerCodes, solutionCodes, industryCodes y audienceCode.",
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
    throw new Error(`OpenAI request failed: ${response.status}`);
  }

  const textParts = [
    String(payload?.output_text || "").trim(),
    ...(Array.isArray(payload?.output)
      ? payload.output.flatMap((entry) =>
          Array.isArray(entry?.content)
            ? entry.content.map((part) => String(part?.text || "").trim())
            : [],
        )
      : []),
  ].filter(Boolean);

  for (const part of textParts) {
    try {
      return JSON.parse(part);
    } catch {
      const start = part.indexOf("{");
      const end = part.lastIndexOf("}");
      if (start !== -1 && end > start) {
        try {
          return JSON.parse(part.slice(start, end + 1));
        } catch {
          // Continue.
        }
      }
    }
  }

  return null;
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
    return buildStoredSessionResponse(sessionRow);
  }

  const catalogs = await getCommercialEnablementCatalogs();
  const textRows = await query(
    `SELECT text_content FROM commercial_enablement_intake_extracted_content WHERE intake_session_id = ? ORDER BY id`,
    [Number(sessionRow.id)],
  );
  const text = textRows.map((row) => row.text_content || "").join("\n\n");

  const heuristic = buildHeuristicDraft({
    fileName: sessionRow.source_file_name,
    text,
    catalogs,
    hint: hint || sessionRow.source_hint || "",
    languageCode: detectLanguageCode({
      reportedLanguage: sessionRow.language_detected,
      text,
      hint: hint || sessionRow.source_hint || "",
    }),
  });
  let analysis = heuristic;
  let warnings = Array.isArray(heuristic.warnings) ? heuristic.warnings : [];

  try {
    const aiResult = await requestOpenAiPrefill({
      catalogs,
      text,
      fileName: sessionRow.source_file_name,
      hint: hint || sessionRow.source_hint || "",
    });
    if (aiResult && typeof aiResult === "object") {
      analysis = {
        ...heuristic,
        ...aiResult,
        prefill: {
          ...heuristic.prefill,
          ...(aiResult.prefill || {}),
        },
        warnings: Array.isArray(aiResult.warnings)
          ? aiResult.warnings
          : heuristic.warnings,
      };
      warnings = Array.isArray(analysis.warnings) ? analysis.warnings : [];
    }
  } catch (error) {
    warnings = [
      ...warnings,
      {
        code: "ai_prefill_failed",
        message:
          String(error?.message || "").trim() ||
          "No fue posible obtener sugerencias IA; se usaron heuristicas.",
      },
    ];
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
      config.openai.apiKey ? ANALYSIS_MODEL : "heuristic_prefill",
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
  return await analyzeIntakeSessionInternal({
    sessionRow: refreshed,
    hint,
    forceRegenerate,
  });
}

export async function reviewCommercialEnablementIntakeSession({
  publicId,
  user,
  acceptedPayload,
  reviewConfirmed = false,
}) {
  const row = await ensureSessionAccess({ publicId, user });
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
