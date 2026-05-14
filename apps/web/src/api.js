import axios from "axios";

const configuredBaseURL = import.meta.env.VITE_API_URL?.trim();
const baseURL = configuredBaseURL || window.location.origin;

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

export function getApiErrorMessage(error, fallback = "Error de red") {
  const data = error?.response?.data;
  if (!data) {
    if (error?.code === "ECONNABORTED") {
      return String(error?.message || "La solicitud excedio el tiempo de espera");
    }

    if (String(error?.message || "").trim()) {
      return String(error.message).trim();
    }

    return fallback;
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

  return data.message || fallback;
}
