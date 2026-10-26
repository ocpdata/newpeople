import { config } from "./config.js";
import { randomUUID } from "node:crypto";
import {
  assertAiBudgetAvailable,
  recordAiUsageFromOpenAiResponse,
} from "./ai-usage/service.js";

function buildFieldSchema(field, definitions = null) {
  if (field.nullable) {
    return { anyOf: [buildFieldSchema({ ...field, nullable: false }, definitions), { type: "null" }] };
  }
  if (field.definition && definitions) {
    if (!definitions[field.definition]) {
      definitions[field.definition] = buildFieldSchema({ ...field, definition: undefined }, definitions);
    }
    return { $ref: `#/$defs/${field.definition}` };
  }
  if (field.type === "union") {
    return { anyOf: field.variants.map((variant) => buildFieldSchema(variant, definitions)) };
  }
  if (field.type === "string") {
    return { type: "string" };
  }
  if (field.type === "number") {
    return { type: "number" };
  }
  if (field.type === "boolean") {
    return { type: "boolean" };
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
      items: buildFieldSchema(field.items, definitions),
      ...(field.minItems !== undefined ? { minItems: field.minItems } : {}),
      ...(field.maxItems !== undefined ? { maxItems: field.maxItems } : {}),
    };
  }

  if (field.type === "object") {
    return {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(
        field.fields.map((childField) => [
          childField.key,
          buildFieldSchema(childField, definitions),
        ]),
      ),
      required: field.fields
        .filter((childField) => childField.required !== false)
        .map((childField) => childField.key),
    };
  }

  throw new Error(`Unsupported structured research field type: ${field.type}`);
}

function buildExpectedValue(field, schemaExample = false) {
  if (field.example !== undefined) return field.example;
  if (field.nullable) return null;
  if (field.type === "union") return buildExpectedValue(field.variants[0], schemaExample);
  if (field.type === "string") {
    return field.example ?? "";
  }
  if (field.type === "number") {
    return field.example ?? 0;
  }
  if (field.type === "boolean") {
    return false;
  }

  if (field.type === "enum") {
    return field.example ?? (schemaExample ? field.enum[0] : field.enum.join("|"));
  }

  if (field.type === "array") {
    return field.example ?? Array.from({ length: field.minItems || 0 }, () => buildExpectedValue(field.items, schemaExample));
  }

  if (field.type === "object") {
    return Object.fromEntries(
      field.fields.map((childField) => [
        childField.key,
        buildExpectedValue(childField, schemaExample),
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

const STREAM_ERROR_STATUS = { rate_limit_exceeded: 429, server_error: 500, insufficient_quota: 429, credit_balance_exhausted: 429 };

/** Reads a Responses API event stream and returns the final response object, like the non-streamed body. */
const DEGENERATE_WHITESPACE = 400;
const DEGENERATE_REPEATS = 200;

async function readStreamedResponse(response, stats = { events: 0, bytes: 0 }) {
  Object.assign(stats, { tail: stats.tail || "", whitespaceRun: 0, repeats: 0, lastDelta: null });
  const decoder = new TextDecoder();
  let buffer = "";
  let final = null;
  const handle = (block) => {
    const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data);
    stats.events += 1;
    stats.lastType = event.type;
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      stats.tail = (stats.tail + event.delta).slice(-200);
      stats.whitespaceRun = /^\s*$/.test(event.delta) ? stats.whitespaceRun + event.delta.length : 0;
      stats.repeats = event.delta === stats.lastDelta ? stats.repeats + 1 : 0;
      stats.lastDelta = event.delta;
      // Strict JSON output sometimes degenerates into endless whitespace or one repeated token; stop it early.
      if (stats.whitespaceRun > DEGENERATE_WHITESPACE || stats.repeats > DEGENERATE_REPEATS) {
        throw new Error(`OpenAI web search failed: 502 Salida degenerada del modelo (eventos ${stats.events}, final ${JSON.stringify(stats.tail.slice(-60))}).`);
      }
    }
    if (["response.completed", "response.incomplete"].includes(event.type)) final = event.response;
    if (event.type === "response.failed" || event.type === "error") {
      const error = event.response?.error || event.error || event;
      const status = STREAM_ERROR_STATUS[error?.code] || STREAM_ERROR_STATUS[error?.type] || 500;
      throw new Error(`OpenAI web search failed: ${status} ${JSON.stringify({ error })}`);
    }
  };
  const reader = response.body.getReader();
  const idleMs = config.openai.streamIdleTimeoutMs;
  while (true) {
    let timer;
    // A stream that stops sending data would otherwise wait for the whole turn deadline.
    const idle = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`OpenAI web search failed: 504 La respuesta en streaming no envió datos en ${idleMs} ms.`)), idleMs);
    });
    let read;
    try {
      read = await Promise.race([reader.read(), idle]);
    } catch (error) {
      reader.cancel().catch(() => {});
      throw error;
    } finally {
      clearTimeout(timer);
    }
    if (read.done) break;
    stats.bytes += read.value.length;
    buffer += decoder.decode(read.value, { stream: true });
    let separator;
    while ((separator = buffer.indexOf("\n\n")) >= 0) {
      handle(buffer.slice(0, separator));
      buffer = buffer.slice(separator + 2);
    }
  }
  if (buffer.trim()) handle(buffer);
  if (!final) throw new Error("OpenAI web search failed: 502 La respuesta en streaming terminó sin resultado.");
  return final;
}

export async function runStructuredWebResearch({
  schemaName,
  systemPrompt,
  subject,
  context,
  currentValues,
  fields,
  aiUsageContext = null,
  useWebSearchTool = true,
  onResponseMetadata = null,
  signal = null,
  temperature = null,
  responseVariants = null,
  model = null,
  reasoningEffort = null,
  maxDurationMs = null,
  maxOutputTokens = null,
}) {
  if (
    !config.openai.apiKey ||
    (useWebSearchTool && !config.openai.enableWebSearch)
  ) {
    return null;
  }

  const resolvedModel = String(model || config.openai.model || "").trim();
  const safeAiUsageContext =
    aiUsageContext && typeof aiUsageContext === "object"
      ? aiUsageContext
      : null;
  const aiUsageUserId = Number(safeAiUsageContext?.userId || 0);

  if (aiUsageUserId) {
    await assertAiBudgetAvailable({ userId: aiUsageUserId });
  }

  const payload = {
    model: resolvedModel,
    ...(temperature === null ? {} : { temperature }),
    ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
    ...(maxOutputTokens ? { max_output_tokens: maxOutputTokens } : {}),
    ...(useWebSearchTool ? { tools: [{ type: "web_search_preview" }] } : {}),
    text: {
      format: {
        type: "json_schema",
        ...buildStructuredResearchSchema(schemaName, fields, responseVariants),
        strict: true,
      },
    },
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
          expectedJsonShape: responseVariants
            ? { result: Object.fromEntries(responseVariants[0].map((field) => [field.key, buildExpectedValue(field, true)])) }
            : Object.fromEntries(fields.map((field) => [field.key, buildExpectedValue(field)])),
        }),
      },
    ],
  };

  const startedAt = new Date();
  // A streamed call answers with headers at once; waiting longer means the gateway or provider stalled.
  const headerTimeout = config.openai.streamResponses ? new AbortController() : null;
  const headerTimer = headerTimeout
    ? setTimeout(() => headerTimeout.abort(new Error("header timeout")), config.openai.streamHeaderTimeoutMs) : null;
  // A call that keeps streaming without finishing would otherwise hold the whole turn; it is retried instead.
  const callTimeout = maxDurationMs ? new AbortController() : null;
  const callTimer = callTimeout ? setTimeout(() => callTimeout.abort(new Error("call timeout")), maxDurationMs) : null;
  const signals = [signal, headerTimeout?.signal, callTimeout?.signal].filter(Boolean);
  const requestSignal = signals.length > 1 ? AbortSignal.any(signals) : signals[0] || null;
  const stats = { events: 0, bytes: 0 };
  const callTimedOut = (error) => {
    if (callTimeout?.signal.aborted && !signal?.aborted) {
      return new Error(`OpenAI web search failed: 504 La llamada superó ${maxDurationMs} ms (eventos ${stats.events}, bytes ${stats.bytes}, último ${stats.lastType || "ninguno"}, final ${JSON.stringify(String(stats.tail || "").slice(-60))}).`);
    }
    return error;
  };
  let response;
  try {
    response = await fetch(
    `${config.openai.baseUrl.replace(/\/$/, "")}/responses`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openai.apiKey}`,
      },
      body: JSON.stringify(config.openai.streamResponses ? { ...payload, stream: true } : payload),
      ...(requestSignal ? { signal: requestSignal } : {}),
    },
  );
  } catch (error) {
    clearTimeout(callTimer);
    if (headerTimeout?.signal.aborted && !signal?.aborted && !callTimeout?.signal.aborted) {
      throw new Error(`OpenAI web search failed: 504 El proveedor no respondió en ${config.openai.streamHeaderTimeoutMs} ms.`);
    }
    throw callTimedOut(error);
  } finally {
    clearTimeout(headerTimer);
  }

  let data;
  try {
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenAI web search failed: ${response.status} ${errorText}`,
      );
    }
    data = String(response.headers?.get?.("content-type") || "").includes("text/event-stream")
      ? await readStreamedResponse(response, stats)
      : await response.json();
  } catch (error) {
    throw callTimedOut(error);
  } finally {
    clearTimeout(callTimer);
  }
  // A runaway generation stops at the output limit; it is retried like a transient failure, never parsed.
  if (maxOutputTokens && data?.status === "incomplete" && data?.incomplete_details?.reason === "max_output_tokens") {
    throw new Error(`OpenAI web search failed: 502 La respuesta superó el límite de ${maxOutputTokens} tokens de salida.`);
  }

  if (typeof onResponseMetadata === "function") {
    try {
      onResponseMetadata({
        responseId: String(data?.id || "").slice(0, 120) || null,
        model:
          String(data?.model || resolvedModel || "").slice(0, 120) ||
          null,
      });
    } catch {
      // Diagnostic callbacks must not change the research result.
    }
  }

  if (aiUsageUserId) {
    await recordAiUsageFromOpenAiResponse({
      internalRequestId: randomUUID(),
      userId: aiUsageUserId,
      featureCode:
        String(
          safeAiUsageContext?.featureCode || "accounts.draft_analysis",
        ).trim() || "accounts.draft_analysis",
      model: resolvedModel,
      openAiResponse: data,
      jobType: safeAiUsageContext?.jobType || null,
      jobId: safeAiUsageContext?.jobId || null,
      startedAt,
    });
  }

  const parsed = extractJsonObject(extractResponseOutputText(data));
  if (!responseVariants) return parsed;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
      Object.keys(parsed).length !== 1 || !parsed.result || typeof parsed.result !== "object" || Array.isArray(parsed.result)) {
    throw Object.assign(new Error("La respuesta estructurada no contiene el resultado esperado"), {
      code: "STRUCTURED_RESPONSE_INVALID_ENVELOPE",
    });
  }
  return parsed.result;
}

export async function runStructuredTextResearch(args) {
  return runStructuredWebResearch({ ...args, useWebSearchTool: false });
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

export function buildStructuredResearchSchema(schemaName, fields, responseVariants = null) {
  if (responseVariants) {
    const sharedItems = responseVariants[0].filter((field) => field.type === "array" &&
      responseVariants.every((variant) => JSON.stringify(variant.find((candidate) => candidate.key === field.key)?.items) === JSON.stringify(field.items)));
    const definitions = {};
    for (const field of sharedItems) {
      definitions[`${field.key}Item`] = buildFieldSchema(field.items, definitions);
    }
    return {
      name: schemaName,
      schema: {
        type: "object", additionalProperties: false, required: ["result"],
        ...(sharedItems.length ? { $defs: definitions } : {}),
        properties: { result: { anyOf: responseVariants.map((variant) => {
          const schema = buildFieldSchema({ type: "object", fields: variant }, definitions);
          for (const field of sharedItems) {
            schema.properties[field.key].items = { $ref: `#/$defs/${field.key}Item` };
          }
          return schema;
        }) } },
      },
    };
  }
  return {
    name: schemaName,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(
        fields.map((field) => [field.key, buildFieldSchema(field)]),
      ),
      required: fields.map((field) => field.key),
    },
  };
}
