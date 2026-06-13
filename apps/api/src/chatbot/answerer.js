import { config } from "../config.js";
import { recordAiUsageFromOpenAiResponse } from "../ai-usage/service.js";
import { getReadableDomainHints } from "./capabilities.js";
import { extractJsonObject } from "./common.js";
import { fetchChatbotCompletion } from "./openai.js";
import { buildAnswererSystemPrompt } from "./prompts.js";
import { answerOutputSchema } from "./schemas.js";
import { loadEntitySnapshot } from "./snapshots.js";

export async function generateChatbotAnswerWithAi({
  user,
  prompt,
  contextSnapshot,
  evidencePackage,
  references,
  featureCode,
  internalRequestId,
}) {
  if (!config.openai.apiKey) {
    return answerOutputSchema.parse({
      answer:
        "No hay proveedor IA configurado en este entorno. Puedes preguntarme flujos de trabajo y te comparto una guia basada en reglas internas.",
      sourceType: "fallback",
      confidence: 0.4,
      references: ["fallback_rules"],
    });
  }

  const payload = {
    model: config.openai.model,
    temperature: 0.2,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "chatbot_assistant_response",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            answer: { type: "string" },
            sourceType: {
              type: "string",
              enum: ["knowledge", "crm_data", "mixed", "fallback"],
            },
            confidence: { type: "number" },
            references: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["answer", "sourceType", "confidence", "references"],
        },
      },
    },
    messages: [
      {
        role: "system",
        content: buildAnswererSystemPrompt(),
      },
      {
        role: "user",
        content: JSON.stringify({
          prompt,
          contextSnapshot,
          entitySnapshot: await loadEntitySnapshot(user),
          evidencePackage,
          allowedDomains: getReadableDomainHints(user),
        }),
      },
    ],
  };

  const data = await fetchChatbotCompletion(payload, "answerer");

  await recordAiUsageFromOpenAiResponse({
    internalRequestId,
    userId: Number(user.id),
    featureCode,
    model: String(payload.model || config.openai.model || "").trim(),
    openAiResponse: data,
    jobType: "chatbot_message",
    jobId: null,
    startedAt: new Date(),
  });

  const content = String(data?.choices?.[0]?.message?.content || "").trim();
  const parsed = extractJsonObject(content) || {};

  return answerOutputSchema.parse({
    answer:
      String(parsed.answer || "").trim() ||
      "No tengo suficientes datos para responder con precision. Reformula la pregunta indicando el modulo y objetivo.",
    sourceType:
      String(
        parsed.sourceType || (references?.length ? "crm_data" : "knowledge"),
      ).trim() || "knowledge",
    confidence: Number(parsed.confidence || 0.5),
    references: Array.isArray(parsed.references)
      ? parsed.references
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      : references?.length
        ? references
        : ["chatbot"],
  });
}
