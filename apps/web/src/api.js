import axios from "axios";

const configuredBaseURL = import.meta.env.VITE_API_URL?.trim();

function isLoopbackHostname(hostname) {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  );
}

function resolveBaseURL() {
  const pageOrigin = window.location.origin;
  if (!configuredBaseURL) {
    return pageOrigin;
  }

  try {
    const configuredURL = new URL(configuredBaseURL, pageOrigin);
    const pageURL = new URL(pageOrigin);

    const configuredTargetsLoopback = isLoopbackHostname(
      configuredURL.hostname,
    );
    const pageTargetsLoopback = isLoopbackHostname(pageURL.hostname);
    if (configuredTargetsLoopback && !pageTargetsLoopback) {
      return pageOrigin;
    }

    if (pageURL.protocol === "https:" && configuredURL.protocol !== "https:") {
      return pageOrigin;
    }

    return configuredURL.origin;
  } catch {
    return pageOrigin;
  }
}

const baseURL = resolveBaseURL();

export const api = axios.create({
  baseURL,
  timeout: 15000,
});

export function setAuthToken(token) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
  }
}

function formatValidationErrors(errors) {
  if (!errors || typeof errors !== "object") return "";

  const fieldErrors = errors.fieldErrors || {};
  const fieldMessages = Object.entries(fieldErrors)
    .flatMap(([field, messages]) => {
      if (!Array.isArray(messages) || messages.length === 0) return [];
      return `${field}: ${messages.join(", ")}`;
    })
    .filter(Boolean);

  const formMessages = Array.isArray(errors.formErrors)
    ? errors.formErrors.filter(Boolean)
    : [];

  return [...formMessages, ...fieldMessages].join(" | ");
}

function formatIssueList(issues) {
  if (!Array.isArray(issues)) return "";
  return issues.filter(Boolean).join(" | ");
}

function formatExtraErrorDetail(data) {
  if (!data || typeof data !== "object") return "";

  const detailCandidates = [
    data.detail,
    data.error,
    data.reason,
    data.cause,
    typeof data.details === "string" ? data.details : "",
  ];

  const detail = detailCandidates
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .find(Boolean);

  if (detail) {
    return detail;
  }

  if (Array.isArray(data.details)) {
    return data.details
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean)
      .join(" | ");
  }

  return "";
}

function formatRawErrorBody(data) {
  if (typeof data !== "string") return "";

  const normalized = data
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "";
  }

  return normalized.slice(0, 500);
}

function formatGatewayTimeoutMessage(error, data) {
  const status = Number(error?.response?.status);
  const rawBody = typeof data === "string" ? data : "";
  const normalizedBody = rawBody
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (status === 504) {
    return "La solicitud tardo demasiado y fue interrumpida por el proxy antes de que la API respondiera. Intenta de nuevo con menos documentos o una etapa con menos preguntas.";
  }

  if (
    (status === 502 || status === 503) &&
    (normalizedBody.includes("gateway timeout") ||
      normalizedBody.includes("requested url was rejected"))
  ) {
    return "La solicitud no alcanzó a completarse porque un proxy intermedio rechazó o interrumpió la respuesta de la API. Intenta nuevamente en unos momentos.";
  }

  return "";
}

function formatHttpStatusFallback(error) {
  const status = Number(error?.response?.status);
  const statusText = String(error?.response?.statusText || "").trim();

  if (!Number.isFinite(status) || status <= 0) {
    return "";
  }

  return statusText ? `HTTP ${status}: ${statusText}` : `HTTP ${status}`;
}

export function normalizeUiMessage(rawMessage) {
  const text = String(rawMessage || "").trim();
  if (!text) return "";

  const lower = text.toLowerCase();

  if (lower.includes("insufficient authentication scopes")) {
    return "La cuenta de Google no tiene permisos para enviar correos. Reconecta Gmail con permisos de envío.";
  }

  if (lower.includes("invalid_grant") || lower.includes("invalid token")) {
    return "La sesión de Google expiró o es inválida. Reconecta tu cuenta de Google.";
  }

  if (lower.includes("quota") || lower.includes("rate limit")) {
    return "Se alcanzó un límite de envío de Google. Intenta nuevamente más tarde.";
  }

  if (lower.includes("google_send_failed")) {
    return "Google no permitió enviar el correo.";
  }

  if (lower.includes("network error")) {
    return "Error de red. Verifica tu conexión e inténtalo nuevamente.";
  }

  if (lower.startsWith("request failed with status code")) {
    const codeMatch = text.match(/status code\s+(\d{3})/i);
    const code = codeMatch ? codeMatch[1] : "";
    return code
      ? `La solicitud falló con el código ${code}.`
      : "La solicitud falló.";
  }

  return text
    .replace(/\bsent\b/gi, "enviado")
    .replace(/\bfailed\b/gi, "fallido")
    .replace(/\binvalid\b/gi, "inválido")
    .replace(/\bsuccess\b/gi, "éxito");
}

export function getApiErrorMessage(error, fallback = "Error de red") {
  const data = error?.response?.data;
  if (!data) {
    if (String(error?.message || "").trim() === "Network Error") {
      return normalizeUiMessage(
        "No se recibió respuesta del servidor. La conexión pudo haberse interrumpido o algún proxy/API cortó la solicitud antes de responder.",
      );
    }

    if (error?.code === "ECONNABORTED") {
      return normalizeUiMessage(
        String(
        error?.message || "La solicitud excedió el tiempo de espera",
        ),
      );
    }

    if (String(error?.message || "").trim()) {
      return normalizeUiMessage(String(error.message).trim());
    }

    return normalizeUiMessage(fallback);
  }

  const gatewayTimeoutMessage = formatGatewayTimeoutMessage(error, data);
  if (gatewayTimeoutMessage) {
    return normalizeUiMessage(gatewayTimeoutMessage);
  }

  const rawBodyDetail = formatRawErrorBody(data);
  if (rawBodyDetail) {
    return normalizeUiMessage(rawBodyDetail);
  }

  const validationDetail = formatValidationErrors(data.errors);
  if (validationDetail) {
    return normalizeUiMessage(
      data.message
      ? `${data.message}: ${validationDetail}`
      : validationDetail,
    );
  }

  const issueDetail = formatIssueList(data.issues);
  if (issueDetail) {
    return normalizeUiMessage(
      data.message ? `${data.message}: ${issueDetail}` : issueDetail,
    );
  }

  const extraDetail = formatExtraErrorDetail(data);
  if (extraDetail) {
    return normalizeUiMessage(
      data.message && data.message !== extraDetail
      ? `${data.message}: ${extraDetail}`
      : extraDetail,
    );
  }

  if (typeof data.message === "string" && data.message.trim()) {
    return normalizeUiMessage(data.message.trim());
  }

  const httpStatusFallback = formatHttpStatusFallback(error);
  if (httpStatusFallback) {
    return normalizeUiMessage(httpStatusFallback);
  }

  return normalizeUiMessage(fallback);
}
