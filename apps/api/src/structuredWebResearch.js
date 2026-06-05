import { config } from "./config.js";
import { randomUUID } from "node:crypto";
import {
  assertAiBudgetAvailable,
  recordAiUsageFromOpenAiResponse,
} from "./ai-usage/service.js";

function buildFieldSchema(field) {
  if (field.type === "string") {
    return { type: "string" };
  }

  if (field.type === "enum") {
    return {
      type: "string",
      enum: field.enum,
    };
  }

  if (field.type === "array") {
    return {
      type: "array",
      items: buildFieldSchema(field.items),
    };
  }

  if (field.type === "object") {
    return {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(
        field.fields.map((childField) => [
          childField.key,
          buildFieldSchema(childField),
        ]),
      ),
      required: field.fields
        .filter((childField) => childField.required !== false)
        .map((childField) => childField.key),
    };
  }

  throw new Error(`Unsupported structured research field type: ${field.type}`);
}

function buildExpectedValue(field) {
  if (field.type === "string") {
    return field.example ?? "";
  }

  if (field.type === "enum") {
    return field.example ?? field.enum.join("|");
  }

  if (field.type === "array") {
    return field.example ?? [];
  }

  if (field.type === "object") {
    return Object.fromEntries(
      field.fields.map((childField) => [
        childField.key,
        buildExpectedValue(childField),
      ]),
    );
  }

  throw new Error(`Unsupported structured research field type: ${field.type}`);
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

function extractResponseOutputText(data) {
  const directOutputText = String(data?.output_text || "").trim();
  if (directOutputText) return directOutputText;

  const outputEntries = Array.isArray(data?.output) ? data.output : [];
  const contentText = outputEntries
    .flatMap((entry) => (Array.isArray(entry?.content) ? entry.content : []))
    .filter((part) => part?.type === "output_text")
    .map((part) => String(part?.text || "").trim())
    .find(Boolean);

  return contentText || "";
}

export async function runStructuredWebResearch({
  schemaName,
  systemPrompt,
  subject,
  context,
  currentValues,
  fields,
  aiUsageContext = null,
}) {
  if (!config.openai.apiKey || !config.openai.enableWebSearch) {
    return null;
  }

  const safeAiUsageContext =
    aiUsageContext && typeof aiUsageContext === "object"
      ? aiUsageContext
      : null;
  const aiUsageUserId = Number(safeAiUsageContext?.userId || 0);

  if (aiUsageUserId) {
    await assertAiBudgetAvailable({ userId: aiUsageUserId });
  }

  const payload = {
    model: config.openai.model,
    tools: [{ type: "web_search_preview" }],
    input: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: JSON.stringify({
          subject,
          context,
          currentValues,
          expectedJsonShape: Object.fromEntries(
            fields.map((field) => [field.key, buildExpectedValue(field)]),
          ),
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
    const errorText = await response.text();
    throw new Error(
      `OpenAI web search failed: ${response.status} ${errorText}`,
    );
  }

  const data = await response.json();

  if (aiUsageUserId) {
    await recordAiUsageFromOpenAiResponse({
      internalRequestId: randomUUID(),
      userId: aiUsageUserId,
      featureCode:
        String(
          safeAiUsageContext?.featureCode || "accounts.draft_analysis",
        ).trim() || "accounts.draft_analysis",
      model: String(config.openai.model || "").trim(),
      openAiResponse: data,
      jobType: safeAiUsageContext?.jobType || null,
      jobId: safeAiUsageContext?.jobId || null,
      startedAt,
    });
  }

  return extractJsonObject(extractResponseOutputText(data));
}

export async function runProfiledStructuredWebResearch(profile, args) {
  return runStructuredWebResearch({
    schemaName: profile.schemaName,
    systemPrompt: profile.systemPrompt,
    subject: profile.buildSubject(args),
    context: profile.buildContext(args),
    currentValues: profile.buildCurrentValues(args),
    fields: profile.fields,
    aiUsageContext:
      args?.aiUsageContext && typeof args.aiUsageContext === "object"
        ? args.aiUsageContext
        : null,
  });
}

export function buildStructuredResearchSchema(schemaName, fields) {
  return {
    name: schemaName,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(
        fields.map((field) => [field.key, buildFieldSchema(field)]),
      ),
      required: fields
        .filter((field) => field.required !== false)
        .map((field) => field.key),
    },
  };
}
