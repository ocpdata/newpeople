import { config } from "../config.js";
import { recordAiUsageFromOpenAiResponse } from "../ai-usage/service.js";
import {
  getReadableDomainHints,
  loadChatbotPlannerMetadata,
} from "./capabilities.js";
import {
  isContextualChatbotPrompt,
  mergeRequestedDomainsForEntity,
  normalizeChatbotActiveEntity,
} from "./context.js";
import { extractJsonObject } from "./common.js";
import { fetchChatbotCompletion } from "./openai.js";
import { buildPlannerSystemPrompt } from "./prompts.js";
import { plannerOutputSchema } from "./schemas.js";

const plannerFiltersResponseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    common: {
      type: "object",
      additionalProperties: false,
      properties: {
        recentOnly: { type: "boolean" },
      },
      required: ["recentOnly"],
    },
    accounts: {
      type: "object",
      additionalProperties: false,
      properties: {
        activeOnly: { type: "boolean" },
        activationStatusCodes: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["activeOnly", "activationStatusCodes"],
    },
    contacts: {
      type: "object",
      additionalProperties: false,
      properties: {
        activeOnly: { type: "boolean" },
        activationStatusCodes: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["activeOnly", "activationStatusCodes"],
    },
    opportunities: {
      type: "object",
      additionalProperties: false,
      properties: {
        openOnly: { type: "boolean" },
        activeOnly: { type: "boolean" },
        activationStatusCodes: {
          type: "array",
          items: { type: "string" },
        },
        commercialStatusCodes: {
          type: "array",
          items: { type: "string" },
        },
        salesStageCodes: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: [
        "openOnly",
        "activeOnly",
        "activationStatusCodes",
        "commercialStatusCodes",
        "salesStageCodes",
      ],
    },
    quotations: {
      type: "object",
      additionalProperties: false,
      properties: {
        activeOnly: { type: "boolean" },
        activationStatusCodes: {
          type: "array",
          items: { type: "string" },
        },
        latestStatusCodes: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["activeOnly", "activationStatusCodes", "latestStatusCodes"],
    },
    proposals: {
      type: "object",
      additionalProperties: false,
      properties: {
        statusCodes: {
          type: "array",
          items: { type: "string" },
        },
        quotationVersionStatusCodes: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["statusCodes", "quotationVersionStatusCodes"],
    },
  },
  required: [
    "common",
    "accounts",
    "contacts",
    "opportunities",
    "quotations",
    "proposals",
  ],
};

function normalizeRequestedDomains(value, allowedDomains) {
  const requested = Array.isArray(value) ? value : [];
  const normalized = requested
    .map((item) => String(item || "").trim())
    .filter((item) =>
      [
        "accounts",
        "contacts",
        "opportunities",
        "quotations",
        "proposals",
      ].includes(item),
    )
    .filter((item) => allowedDomains?.[item] !== false);

  if (normalized.length) {
    return [...new Set(normalized)];
  }

  return Object.entries(allowedDomains || {})
    .filter(([, enabled]) => Boolean(enabled))
    .map(([domain]) => domain)
    .slice(0, 3);
}

function normalizeCodeList(value, allowedCodes = []) {
  const allowed = new Set(
    Array.isArray(allowedCodes)
      ? allowedCodes.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
  );
  const source = Array.isArray(value) ? value : [];
  return [
    ...new Set(
      source
        .map((item) => String(item || "").trim())
        .filter((item) => (allowed.size ? allowed.has(item) : Boolean(item))),
    ),
  ];
}

function normalizeRetrievalFilters(value, plannerMetadata) {
  const filters = value && typeof value === "object" ? value : {};
  const domains = plannerMetadata?.domains || {};
  return {
    common: {
      recentOnly: Boolean(filters?.common?.recentOnly || filters.recentOnly),
    },
    accounts: {
      activeOnly: filters?.accounts?.activeOnly !== false,
      activationStatusCodes: normalizeCodeList(
        filters?.accounts?.activationStatusCodes,
        domains?.accounts?.activationStatusCodes,
      ),
    },
    contacts: {
      activeOnly: filters?.contacts?.activeOnly !== false,
      activationStatusCodes: normalizeCodeList(
        filters?.contacts?.activationStatusCodes,
        domains?.contacts?.activationStatusCodes,
      ),
    },
    opportunities: {
      openOnly: Boolean(filters?.opportunities?.openOnly ?? filters?.openOnly),
      activeOnly: filters?.opportunities?.activeOnly !== false,
      activationStatusCodes: normalizeCodeList(
        filters?.opportunities?.activationStatusCodes,
        domains?.opportunities?.activationStatusCodes,
      ),
      commercialStatusCodes: normalizeCodeList(
        filters?.opportunities?.commercialStatusCodes,
        domains?.opportunities?.commercialStatusCodes,
      ),
      salesStageCodes: normalizeCodeList(
        filters?.opportunities?.salesStageCodes,
        domains?.opportunities?.salesStageCodes,
      ),
    },
    quotations: {
      activeOnly: filters?.quotations?.activeOnly !== false,
      activationStatusCodes: normalizeCodeList(
        filters?.quotations?.activationStatusCodes,
        domains?.quotations?.activationStatusCodes,
      ),
      latestStatusCodes: normalizeCodeList(
        filters?.quotations?.latestStatusCodes,
        domains?.quotations?.latestStatusCodes,
      ),
    },
    proposals: {
      statusCodes: normalizeCodeList(
        filters?.proposals?.statusCodes,
        domains?.proposals?.statusCodes,
      ),
      quotationVersionStatusCodes: normalizeCodeList(
        filters?.proposals?.quotationVersionStatusCodes,
        domains?.proposals?.quotationVersionStatusCodes,
      ),
    },
  };
}

export async function planChatbotRetrievalWithAi({
  user,
  prompt,
  contextSnapshot,
  featureCode,
  internalRequestId,
}) {
  if (!config.openai.apiKey) {
    return {
      mode: "knowledge",
      targetEntityType: "none",
      targetEntityName: "",
      requestedDomains: [],
      filters: normalizeRetrievalFilters({}, { domains: {} }),
      clarificationNeeded: false,
      clarificationQuestion: "",
      confidence: 0.5,
      sourceReason: "missing_openai_api_key",
      plannerMetadata: {
        allowedDomains: getReadableDomainHints(user),
        domains: {},
      },
    };
  }

  const plannerMetadata = await loadChatbotPlannerMetadata(user);
  const allowedDomains = plannerMetadata.allowedDomains;
  const payload = {
    model: config.openai.model,
    temperature: 0,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "chatbot_retrieval_plan",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            mode: { type: "string", enum: ["knowledge", "crm_lookup"] },
            targetEntityType: {
              type: "string",
              enum: ["none", "account", "contact", "opportunity"],
            },
            targetEntityName: { type: "string" },
            requestedDomains: {
              type: "array",
              items: {
                type: "string",
                enum: [
                  "accounts",
                  "contacts",
                  "opportunities",
                  "quotations",
                  "proposals",
                ],
              },
            },
            filters: plannerFiltersResponseSchema,
            clarificationNeeded: { type: "boolean" },
            clarificationQuestion: { type: "string" },
            confidence: { type: "number" },
          },
          required: [
            "mode",
            "targetEntityType",
            "targetEntityName",
            "requestedDomains",
            "filters",
            "clarificationNeeded",
            "clarificationQuestion",
            "confidence",
          ],
        },
      },
    },
    messages: [
      {
        role: "system",
        content: buildPlannerSystemPrompt(),
      },
      {
        role: "user",
        content: JSON.stringify({
          prompt,
          contextSnapshot,
          plannerMetadata,
        }),
      },
    ],
  };

  const data = await fetchChatbotCompletion(payload, "planner");

  await recordAiUsageFromOpenAiResponse({
    internalRequestId: `${internalRequestId}:planner`,
    userId: Number(user.id),
    featureCode,
    model: String(payload.model || config.openai.model || "").trim(),
    openAiResponse: data,
    jobType: "chatbot_planner",
    jobId: null,
    startedAt: new Date(),
  });

  const content = String(data?.choices?.[0]?.message?.content || "").trim();
  const parsed = extractJsonObject(content) || {};
  const activeEntity = normalizeChatbotActiveEntity(contextSnapshot);
  const promptIsContextual = isContextualChatbotPrompt(prompt, contextSnapshot);
  const normalized = {
    mode: String(parsed.mode || "knowledge").trim() || "knowledge",
    targetEntityType:
      String(parsed.targetEntityType || "none").trim() || "none",
    targetEntityName: String(parsed.targetEntityName || "").trim(),
    contextEntityId: null,
    requestedDomains: normalizeRequestedDomains(
      parsed.requestedDomains,
      allowedDomains,
    ),
    filters: normalizeRetrievalFilters(parsed.filters, plannerMetadata),
    clarificationNeeded: Boolean(parsed.clarificationNeeded),
    clarificationQuestion: String(parsed.clarificationQuestion || "").trim(),
    confidence: Number(parsed.confidence || 0.7),
  };

  let sourceReason = "ai_retrieval_plan";

  if (activeEntity && promptIsContextual) {
    if (
      normalized.mode !== "crm_lookup" ||
      normalized.targetEntityType === "none" ||
      !normalized.targetEntityName
    ) {
      normalized.mode = "crm_lookup";
      normalized.targetEntityType = activeEntity.type;
      normalized.targetEntityName =
        normalized.targetEntityName || activeEntity.name || "";
      normalized.requestedDomains = mergeRequestedDomainsForEntity(
        normalized.requestedDomains,
        activeEntity.type,
      );
      normalized.clarificationNeeded = false;
      normalized.clarificationQuestion = "";
      sourceReason = "context_active_entity";
    }

    if (normalized.targetEntityType === activeEntity.type) {
      normalized.contextEntityId = activeEntity.id;
      normalized.targetEntityName =
        normalized.targetEntityName || activeEntity.name || "";
      normalized.requestedDomains = mergeRequestedDomainsForEntity(
        normalized.requestedDomains,
        activeEntity.type,
      );
    }
  }

  return {
    ...plannerOutputSchema.parse(normalized),
    sourceReason,
    plannerMetadata,
  };
}
