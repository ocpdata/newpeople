import axios from "axios";

const baseURL = import.meta.env.VITE_API_URL || "http://localhost:4000";

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

export function getApiErrorMessage(error, fallback = "Error de red") {
  const data = error?.response?.data;
  if (!data) return fallback;

  const validationDetail = formatValidationErrors(data.errors);
  if (validationDetail) {
    return data.message
      ? `${data.message}: ${validationDetail}`
      : validationDetail;
  }

  return data.message || fallback;
}
