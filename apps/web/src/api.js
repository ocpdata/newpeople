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

    if (import.meta.env.PROD) {
      const configuredTargetsLoopback = isLoopbackHostname(
        configuredURL.hostname,
      );
      const pageTargetsLoopback = isLoopbackHostname(pageURL.hostname);
      if (configuredTargetsLoopback && !pageTargetsLoopback) {
        return pageOrigin;
      }

      if (
        pageURL.protocol === "https:" &&
        configuredURL.protocol !== "https:"
      ) {
        return pageOrigin;
      }
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

function formatHttpStatusFallback(error) {
  const status = Number(error?.response?.status);
  const statusText = String(error?.response?.statusText || "").trim();

  if (!Number.isFinite(status) || status <= 0) {
    return "";
  }

  return statusText ? `HTTP ${status}: ${statusText}` : `HTTP ${status}`;
}

export function getApiErrorMessage(error, fallback = "Error de red") {
  const data = error?.response?.data;
  if (!data) {
    if (String(error?.message || "").trim() === "Network Error") {
      return "No se recibio respuesta del servidor. La conexion pudo haberse interrumpido o algun proxy/API corto la solicitud antes de responder.";
    }

    if (error?.code === "ECONNABORTED") {
      return String(
        error?.message || "La solicitud excedio el tiempo de espera",
      );
    }

    if (String(error?.message || "").trim()) {
      return String(error.message).trim();
    }

    return fallback;
  }

  const rawBodyDetail = formatRawErrorBody(data);
  if (rawBodyDetail) {
    return rawBodyDetail;
  }

  const validationDetail = formatValidationErrors(data.errors);
  if (validationDetail) {
    return data.message
      ? `${data.message}: ${validationDetail}`
      : validationDetail;
  }

  const issueDetail = formatIssueList(data.issues);
  if (issueDetail) {
    return data.message ? `${data.message}: ${issueDetail}` : issueDetail;
  }

  const extraDetail = formatExtraErrorDetail(data);
  if (extraDetail) {
    return data.message && data.message !== extraDetail
      ? `${data.message}: ${extraDetail}`
      : extraDetail;
  }

  const httpStatusFallback = formatHttpStatusFallback(error);
  if (httpStatusFallback) {
    return httpStatusFallback;
  }

  return data.message || fallback;
}
