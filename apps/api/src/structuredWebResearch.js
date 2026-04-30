import { config } from "./config.js";

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
        field.fields.map((childField) => [childField.key, buildFieldSchema(childField)]),
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
      field.fields.map((childField) => [childField.key, buildExpectedValue(childField)]),
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

export async function runStructuredWebResearch({
  schemaName,
  systemPrompt,
  subject,
  context,
  currentValues,
  fields,
}) {
  if (!config.openai.apiKey || !config.openai.enableWebSearch) {
    return null;
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
    throw new Error(`OpenAI web search failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return extractJsonObject(data?.output_text || "");
}

export async function runProfiledStructuredWebResearch(profile, args) {
  return runStructuredWebResearch({
    schemaName: profile.schemaName,
    systemPrompt: profile.systemPrompt,
    subject: profile.buildSubject(args),
    context: profile.buildContext(args),
    currentValues: profile.buildCurrentValues(args),
    fields: profile.fields,
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