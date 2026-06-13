import { config } from "../config.js";
import { recordAiUsageFromOpenAiResponse } from "../ai-usage/service.js";
import { extractJsonObject } from "./common.js";
import { fetchChatbotCompletion } from "./openai.js";
import { buildResolverSystemPrompt } from "./prompts.js";
import { resolverOutputSchema } from "./schemas.js";

export async function resolveChatbotEntityWithAi({
  user,
  prompt,
  plannerOutput,
  candidates,
  featureCode,
  internalRequestId,
}) {
  const safeCandidates = Array.isArray(candidates) ? candidates : [];

  if (!safeCandidates.length) {
    return resolverOutputSchema.parse({
      resolutionStatus: "not_found",
      selectedEntityType: String(plannerOutput?.targetEntityType || "none"),
      selectedEntityId: null,
      confidence: 0.9,
      clarificationNeeded: false,
      clarificationQuestion: "",
    });
  }

  if (!config.openai.apiKey) {
    if (safeCandidates.length === 1) {
      return resolverOutputSchema.parse({
        resolutionStatus: "resolved",
        selectedEntityType: safeCandidates[0].entityType,
        selectedEntityId: Number(safeCandidates[0].id),
        confidence: 0.6,
        clarificationNeeded: false,
        clarificationQuestion: "",
      });
    }
    return resolverOutputSchema.parse({
      resolutionStatus: "ambiguous",
      selectedEntityType: String(plannerOutput?.targetEntityType || "none"),
      selectedEntityId: null,
      confidence: 0.4,
      clarificationNeeded: true,
      clarificationQuestion:
        "Necesito que me indiques exactamente cual de las opciones quieres consultar.",
    });
  }

  const payload = {
    model: config.openai.model,
    temperature: 0,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "chatbot_entity_resolution",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            resolutionStatus: {
              type: "string",
              enum: [
                "resolved",
                "ambiguous",
                "not_found",
                "clarification_required",
              ],
            },
            selectedEntityType: {
              type: "string",
              enum: ["none", "account", "contact", "opportunity"],
            },
            selectedEntityId: { type: ["integer", "null"] },
            confidence: { type: "number" },
            clarificationNeeded: { type: "boolean" },
            clarificationQuestion: { type: "string" },
          },
          required: [
            "resolutionStatus",
            "selectedEntityType",
            "selectedEntityId",
            "confidence",
            "clarificationNeeded",
            "clarificationQuestion",
          ],
        },
      },
    },
    messages: [
      { role: "system", content: buildResolverSystemPrompt() },
      {
        role: "user",
        content: JSON.stringify({
          prompt,
          plannerOutput,
          candidates: safeCandidates,
        }),
      },
    ],
  };

  const data = await fetchChatbotCompletion(payload, "resolver");

  await recordAiUsageFromOpenAiResponse({
    internalRequestId: `${internalRequestId}:resolver`,
    userId: Number(user.id),
    featureCode,
    model: String(payload.model || config.openai.model || "").trim(),
    openAiResponse: data,
    jobType: "chatbot_resolver",
    jobId: null,
    startedAt: new Date(),
  });

  const content = String(data?.choices?.[0]?.message?.content || "").trim();
  const parsed = extractJsonObject(content) || {};
  const normalized = resolverOutputSchema.parse({
    resolutionStatus: String(parsed.resolutionStatus || "not_found"),
    selectedEntityType: String(parsed.selectedEntityType || "none"),
    selectedEntityId:
      parsed.selectedEntityId === null || parsed.selectedEntityId === undefined
        ? null
        : Number(parsed.selectedEntityId),
    confidence: Number(parsed.confidence || 0.5),
    clarificationNeeded: Boolean(parsed.clarificationNeeded),
    clarificationQuestion: String(parsed.clarificationQuestion || "").trim(),
  });

  if (
    normalized.selectedEntityId !== null &&
    !safeCandidates.some(
      (candidate) => Number(candidate.id) === normalized.selectedEntityId,
    )
  ) {
    return resolverOutputSchema.parse({
      resolutionStatus: "clarification_required",
      selectedEntityType: String(plannerOutput?.targetEntityType || "none"),
      selectedEntityId: null,
      confidence: 0.1,
      clarificationNeeded: true,
      clarificationQuestion:
        "Necesito que aclares a cual registro te refieres.",
    });
  }

  return normalized;
}
