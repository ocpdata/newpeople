import { DOCUMENT_FORMATS } from "../../../../shared/document-formats.js";

export const CUSTOMER_ACTIVITY_STATUS_LABELS = {
  pending: "Pendiente",
  in_progress: "En curso",
  done: "Completada",
  completed: "Completada",
  cancelled: "Cancelada",
  blocked: "Bloqueada",
};

export const CUSTOMER_ACTIVITY_TYPE_LABELS = {
  producto: "Producto",
  service: "Servicio",
  servicio: "Servicio",
  call: "Llamada",
  meeting: "Reunión",
  email: "Correo",
  visit: "Visita",
  demo: "Demostración",
  presentation: "Presentación",
};

export const CUSTOMER_FINDING_CONFIDENCE_LABELS = {
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

export function formatDate(value) {
  if (!value) return "Sin fecha";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(date);
}

// Classifies why a chat turn failed so the UI can say what happened and what to do next.
export function classifyCustomerChatFailure(error, { terminalFailure = false } = {}) {
  if (terminalFailure) {
    return {
      kind: "job_failed",
      hint: "No se pudo completar la consulta. Puedes reintentar o reformular la pregunta.",
    };
  }
  const status = Number(error?.response?.status || 0);
  const message = String(error?.message || "");
  if (status === 401 || status === 403) {
    return { kind: "permission", hint: "No tienes permiso para realizar esta consulta." };
  }
  if (status === 413) {
    return { kind: "too_large", hint: "El archivo adjunto es demasiado grande. Prueba con uno más pequeño." };
  }
  if (!status) {
    if (error?.code === "ECONNABORTED" || /sigue pendiente|timeout/i.test(message)) {
      return { kind: "timeout", hint: "La consulta tardó más de lo esperado. Puedes reintentar." };
    }
    return { kind: "network", hint: "No hay conexión con el servidor. Revisa tu red y reintenta." };
  }
  if (status === 408 || status === 504) {
    return { kind: "timeout", hint: "La consulta tardó más de lo esperado. Puedes reintentar." };
  }
  if (status >= 500) {
    return { kind: "server", hint: "El servidor tuvo un problema al procesar la pregunta. Reintenta en unos segundos." };
  }
  return { kind: "rejected", hint: null };
}

// Mirrors the server rules (extension, empty file, size limit per format) so the seller sees the
// problem when choosing the file instead of after sending the question.
export function validateChatAttachment(file) {
  if (!file) return "";
  const name = String(file.name || "archivo");
  const dot = name.lastIndexOf(".");
  const extension = dot >= 0 ? name.slice(dot).toLowerCase() : "";
  const format = DOCUMENT_FORMATS[extension];
  if (!format) return `El tipo de archivo ${extension || "desconocido"} no está soportado.`;
  if (!(Number(file.size) > 0)) return `El archivo ${name} está vacío.`;
  if (Number(file.size) > format.maxBytes) {
    return `El archivo ${name} excede el tamaño permitido para ${extension} (${Math.round(format.maxBytes / 1048576)} MB).`;
  }
  return "";
}

export function formatFileSize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size < 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1048576) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / 1048576).toFixed(1)} MB`;
}

// Short announcement for screen readers when an answer arrives; it never repeats the answer itself.
export const ANSWER_READY_ANNOUNCEMENT = "Respuesta lista al final de la conversación.";

// Removes the seller message of a turn that is being retried or cancelled so it is not shown twice.
export function removeLastSellerMessage(messages, question) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role !== "seller") continue;
    return messages[index].text === question
      ? [...messages.slice(0, index), ...messages.slice(index + 1)]
      : messages;
  }
  return messages;
}
