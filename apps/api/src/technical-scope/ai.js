import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { aiFetch } from "../ai-services/client.js";
import { aiModelFor } from "../ai-services/state.js";
import {
  assertAiBudgetAvailable,
  recordAiUsageFromOpenAiResponse,
} from "../ai-usage/service.js";

export const TECHNICAL_SCOPE_AI_FEATURES = Object.freeze({
  sections: "proposals.technical_scope.sections",
  topology: "proposals.technical_scope.topology",
  prefill: "proposals.technical_scope.prefill",
  documentFacts: "proposals.technical_scope.document_facts",
  diagram: "proposals.technical_scope.diagram",
  playbookDraft: "proposals.technical_scope.playbook_draft",
  sow: "proposals.technical_scope.sow",
});

export function extractJsonFromText(value) {
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

function getOutputText(responseData) {
  const output = Array.isArray(responseData?.output) ? responseData.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (part?.type === "output_text" && part?.text) return String(part.text);
    }
  }
  return "";
}

function aiError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

// The gateway in front of the AI provider cuts requests at about 30 s, so every call must stay small and use the fast model
// (output of roughly 10 KB or less). Larger drafts are built from several calls.
// Calls the model asking for JSON, validates it with the given zod schema and records the usage.
export async function requestAiJson({
  featureCode,
  role = "fast",
  system,
  user,
  images = [],
  userId = null,
  timeoutMs = 90_000,
  schema,
  maxAttempts = 2,
}) {
  if (userId) await assertAiBudgetAvailable({ userId });
  if (!config.openai.apiKey) {
    throw aiError(
      "La generacion asistida no esta disponible en este momento",
      503,
      "ai_generation_disabled",
    );
  }

  const model = aiModelFor(featureCode, role);
  const userText = typeof user === "string" ? user : JSON.stringify(user);
  const userContent = images.length
    ? [
        { type: "input_text", text: userText },
        ...images.map((image) => ({ type: "input_image", image_url: image })),
      ]
    : userText;

  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = new Date();
    const internalRequestId = randomUUID();
    try {
      const response = await aiFetch(featureCode, "/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          input: [
            { role: "system", content: system },
            { role: "user", content: userContent },
          ],
        }),
        signal: controller.signal,
        userId,
      });
      if (!response.ok) {
        const errorText = await response.text();
        lastError = aiError(
          `La solicitud a IA fallo: ${response.status} ${errorText}`.slice(0, 500),
          502,
          "ai_request_failed",
        );
        // Gateway timeouts and temporary outages are worth another attempt.
        if ([429, 502, 503, 504].includes(response.status) && attempt < maxAttempts) continue;
        throw lastError;
      }
      const data = await response.json();
      if (userId) {
        await recordAiUsageFromOpenAiResponse({
          internalRequestId,
          userId,
          featureCode,
          model,
          openAiResponse: data,
          jobType: "technical_scope",
          startedAt,
        });
      }
      const parsedJson = extractJsonFromText(getOutputText(data));
      if (!parsedJson) {
        lastError = aiError("La IA no devolvio JSON valido", 502, "ai_invalid_json");
        continue;
      }
      const validated = schema.safeParse(parsedJson);
      if (!validated.success) {
        lastError = aiError(
          `La respuesta de la IA no cumple el formato esperado: ${validated.error.issues
            .slice(0, 3)
            .map((issue) => `${issue.path.join(".")} ${issue.message}`)
            .join("; ")}`,
          502,
          "ai_invalid_shape",
        );
        continue;
      }
      return validated.data;
    } catch (error) {
      if (error?.name === "AbortError") {
        lastError = aiError("La IA excedio el tiempo limite", 504, "ai_timeout");
        if (attempt < maxAttempts) continue;
        throw lastError;
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw lastError || aiError("La IA no devolvio una respuesta valida", 502, "ai_invalid_json");
}
