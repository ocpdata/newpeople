import { config } from "../config.js";

function recordPinecone(action, ...records) {
  if (!records.length) return;
  import("../ai-services/store.js")
    .then((store) => Promise.all(records.map((details) => store[action](details))))
    .catch(() => {});
}

function recordPineconeTokens({ usage, metrics, featureCode, userId }) {
  const records = metrics
    .map(([metric, field]) => ({ metric, units: Number(usage?.[field]) }))
    .filter(({ units }) => Number.isFinite(units) && units > 0)
    .map(({ metric, units }) => ({ provider: "pinecone", metric, units, featureCode, userId }));
  recordPinecone("recordAiServiceUsage", ...records);
}

function recordPineconeFailure(error, featureCode, userId) {
  recordPinecone("recordAiServiceError", {
    provider: "pinecone",
    featureCode,
    statusCode: Number(error?.status) || null,
    errorCode: error?.code || null,
    message: error?.message,
    userId,
  });
}

const CONTROL_URL = "https://api.pinecone.io/assistant";
const REQUEST_TIMEOUT_MS = 120_000;
const ASSISTANT_READY_TIMEOUT_MS = 120_000;
const ASSISTANT_POLL_INTERVAL_MS = 3_000;
let assistantPromise = null;
let assistantCache = null;

function getApiKey() {
  const key = String(config.pinecone.apiKey || "").trim();
  if (!key) {
    const error = new Error("PINECONE_API_KEY no está configurada");
    error.status = 503;
    error.code = "PINECONE_NOT_CONFIGURED";
    throw error;
  }
  return key;
}

function assistantName() {
  return String(config.pinecone.assistantName || "").trim();
}

async function requestJson(
  url,
  {
    method = "GET",
    body,
    headers = {},
    timeoutMs = REQUEST_TIMEOUT_MS,
    deadlineAt = null,
  } = {},
) {
  const effectiveTimeoutMs = deadlineAt
    ? Math.min(timeoutMs, deadlineAt - Date.now())
    : timeoutMs;
  if (effectiveTimeoutMs <= 0) {
    const error = new Error("La solicitud a Pinecone excedió el tiempo límite");
    error.status = 504;
    error.code = "PINECONE_TIMEOUT";
    throw error;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), effectiveTimeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        "Api-Key": getApiKey(),
        "X-Pinecone-Api-Version": config.pinecone.apiVersion,
        ...(body && !(body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        ...headers,
      },
      body:
        body && !(body instanceof FormData) ? JSON.stringify(body) : body,
      signal: controller.signal,
    });
    const text = response.status === 204 ? "" : await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch (parseError) {
      // Quota and gateway errors arrive as plain text; keep their message instead of a parse error.
      if (response.ok) throw parseError;
    }
    if (!response.ok) {
      const message = String(
        payload?.error?.message ||
          payload?.message ||
          text ||
          `Pinecone respondió ${response.status}`,
      );
      const error = new Error(`Pinecone: ${message}`);
      error.status = response.status >= 500 ? 502 : response.status;
      error.code = String(payload?.error?.code || "PINECONE_REQUEST_FAILED");
      throw error;
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("La solicitud a Pinecone excedió el tiempo límite");
      timeoutError.status = 504;
      timeoutError.code = "PINECONE_TIMEOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function getAssistantHost(assistant) {
  const host = String(assistant?.host || "").trim();
  if (!host) {
    const error = new Error("Pinecone no devolvió el host del Assistant");
    error.status = 502;
    error.code = "PINECONE_ASSISTANT_HOST_MISSING";
    throw error;
  }
  return host.startsWith("http") ? host.replace(/\/$/, "") : `https://${host}`;
}

async function loadOrCreateAssistant(
  timeoutMs = REQUEST_TIMEOUT_MS,
  deadlineAt = Date.now() + timeoutMs,
) {
  const name = assistantName();
  if (!name) throw new Error("PINECONE_ASSISTANT_NAME no está configurado");
  const encodedName = encodeURIComponent(name);
  let assistant;

  try {
    assistant = await requestJson(
      `${CONTROL_URL}/assistants/${encodedName}`,
      { timeoutMs, deadlineAt },
    );
  } catch (error) {
    if (Number(error?.status) !== 404) throw error;
    try {
      assistant = await requestJson(`${CONTROL_URL}/assistants`, {
        method: "POST",
        body: {
          name,
          region: config.pinecone.assistantRegion,
          instructions:
            "Responde con base únicamente en los documentos cargados. Si no hay información suficiente, indícalo sin inventar datos.",
        },
        timeoutMs,
        deadlineAt,
      });
    } catch (createError) {
      if (Number(createError?.status) !== 409 && Number(createError?.status) !== 429) {
        throw createError;
      }
      assistant = await requestJson(
        `${CONTROL_URL}/assistants/${encodedName}`,
        { timeoutMs, deadlineAt },
      );
    }
  }

  let status = String(assistant?.status || "");
  const readyDeadline = Math.min(
    deadlineAt,
    Date.now() + ASSISTANT_READY_TIMEOUT_MS,
  );
  while (status === "Initializing" && Date.now() < readyDeadline) {
    await new Promise((resolve) => setTimeout(
      resolve,
      Math.min(ASSISTANT_POLL_INTERVAL_MS, Math.max(1, readyDeadline - Date.now())),
    ));
    if (Date.now() >= readyDeadline) break;
    assistant = await requestJson(
      `${CONTROL_URL}/assistants/${encodedName}`,
      { timeoutMs, deadlineAt: readyDeadline },
    );
    status = String(assistant?.status || "");
  }
  if (status && status !== "Ready") {
    const error = new Error(
      status === "Initializing"
        ? "Pinecone Assistant sigue inicializándose; intenta de nuevo más tarde"
        : `Pinecone Assistant no está disponible (estado: ${status})`,
    );
    error.status = status === "Initializing" ? 503 : 502;
    error.code = "PINECONE_ASSISTANT_NOT_READY";
    throw error;
  }

  return {
    name,
    host: getAssistantHost(assistant),
    status,
  };
}

export async function getPineconeAssistant({
  timeoutMs = REQUEST_TIMEOUT_MS,
  deadlineAt = Date.now() + timeoutMs,
} = {}) {
  getApiKey();
  if (assistantCache) return assistantCache;
  if (timeoutMs < REQUEST_TIMEOUT_MS) {
    const assistant = await loadOrCreateAssistant(timeoutMs, deadlineAt);
    assistantCache = assistant;
    return assistant;
  }
  if (!assistantPromise) {
    assistantPromise = loadOrCreateAssistant(timeoutMs, deadlineAt)
      .then((assistant) => {
        assistantCache = assistant;
        return assistant;
      })
      .catch((error) => {
        assistantPromise = null;
        throw error;
      });
  }
  return assistantPromise;
}

export async function uploadRagFile({
  buffer,
  fileName,
  mimeType,
  fileId,
  metadata,
}) {
  const assistant = await getPineconeAssistant();
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimeType }), fileName);
  form.append("metadata", JSON.stringify(metadata));
  const path = fileId
    ? `/assistant/files/${encodeURIComponent(assistant.name)}/${encodeURIComponent(fileId)}`
    : `/assistant/files/${encodeURIComponent(assistant.name)}`;
  return requestJson(`${assistant.host}${path}`, {
    method: fileId ? "PUT" : "POST",
    body: form,
  });
}

export async function listRagFiles() {
  const deadlineAt = Date.now() + REQUEST_TIMEOUT_MS;
  const assistant = await requestJson(
    `${CONTROL_URL}/assistants/${encodeURIComponent(assistantName())}`,
    { deadlineAt },
  );
  if (assistant?.status && assistant.status !== "Ready") {
    const error = new Error("El Assistant configurado no está listo para importar");
    error.status = 503;
    throw error;
  }
  const result = await requestJson(
    `${getAssistantHost(assistant)}/assistant/files/${encodeURIComponent(assistantName())}`,
    { deadlineAt },
  );
  // The Assistant list-files API returns all files, without pagination.
  if (!Array.isArray(result?.files) || result.files.some((file) =>
    !file || typeof file.id !== "string" || typeof file.name !== "string")) {
    const error = new Error("Pinecone devolvió un listado de archivos no válido");
    error.status = 502;
    throw error;
  }
  return {
    assistantName: assistantName(),
    files: result.files.map(({ id, name, status, metadata }) => ({
      id, name, status, metadata,
    })),
  };
}

export async function describeRagOperation(operationId) {
  const assistant = await getPineconeAssistant();
  return requestJson(
    `${assistant.host}/assistant/operations/${encodeURIComponent(assistant.name)}/${encodeURIComponent(operationId)}`,
  );
}

export async function deleteRagFile(fileId) {
  const assistant = await getPineconeAssistant();
  return requestJson(
    `${assistant.host}/assistant/files/${encodeURIComponent(assistant.name)}/${encodeURIComponent(fileId)}`,
    { method: "DELETE" },
  );
}

export async function retrieveRagContext({
  query,
  filter,
  topK = 6,
  timeoutMs = REQUEST_TIMEOUT_MS,
  featureCode = "unspecified",
  userId = null,
}) {
  const deadlineAt = Date.now() + timeoutMs;
  let payload;
  try {
    const assistant = await getPineconeAssistant({ timeoutMs, deadlineAt });
    payload = await requestJson(
      `${assistant.host}/assistant/chat/${encodeURIComponent(assistant.name)}/context`,
      {
        method: "POST",
        body: {
          query: String(query || "").slice(0, 4000),
          top_k: Math.max(1, Math.min(12, Number(topK) || 6)),
          snippet_size: 1200,
          ...(filter ? { filter } : {}),
        },
        timeoutMs,
        deadlineAt,
      },
    );
  } catch (error) {
    recordPineconeFailure(error, featureCode, userId);
    throw error;
  }
  recordPineconeTokens({ usage: payload?.usage, metrics: [["context_tokens", "prompt_tokens"]], featureCode, userId });
  return Array.isArray(payload?.snippets) ? payload.snippets : [];
}

export async function generateRagDocumentSummary({
  fileName,
  documentId,
  versionId,
  featureCode = "documentacion_rag.summary",
  userId = null,
}) {
  let payload;
  try {
    const assistant = await getPineconeAssistant();
    payload = await requestJson(
      `${assistant.host}/assistant/chat/${encodeURIComponent(assistant.name)}`,
      {
        method: "POST",
        body: {
          filter: {
            $and: [
              { document_id: { $eq: String(documentId || "") } },
              { version_id: { $eq: String(versionId || "") } },
            ],
          },
          messages: [
            {
              role: "user",
              content: `Resume brevemente el documento "${String(fileName || "").slice(0, 180)}" en una sola oración en español. Describe solo el contenido que aparece en el documento. No agregues recomendaciones ni información externa.`,
            },
          ],
        },
      },
    );
  } catch (error) {
    recordPineconeFailure(error, featureCode, userId);
    throw error;
  }
  recordPineconeTokens({
    usage: payload?.usage,
    metrics: [["chat_input_tokens", "prompt_tokens"], ["chat_output_tokens", "completion_tokens"]],
    featureCode,
    userId,
  });
  return String(payload?.message?.content || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export function isPineconeConfigured() {
  return Boolean(String(config.pinecone.apiKey || "").trim());
}
