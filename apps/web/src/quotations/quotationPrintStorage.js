const QUOTATION_PRINT_JOB_PREFIX = "quotation-print-job:";

function buildQuotationPrintJobKey(jobId) {
  return `${QUOTATION_PRINT_JOB_PREFIX}${jobId}`;
}

function resolveStorageWindow(targetWindow) {
  if (targetWindow?.sessionStorage) {
    return targetWindow;
  }

  if (typeof window === "undefined") {
    return null;
  }

  return window;
}

export function createQuotationPrintJob(model, targetWindow) {
  const storageWindow = resolveStorageWindow(targetWindow);
  if (!storageWindow || !model) {
    return "";
  }

  const jobId = `print-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  storageWindow.sessionStorage.setItem(
    buildQuotationPrintJobKey(jobId),
    JSON.stringify({ model, createdAt: Date.now() }),
  );
  return jobId;
}

export function readQuotationPrintJob(jobId, targetWindow) {
  const storageWindow = resolveStorageWindow(targetWindow);
  if (!storageWindow || !jobId) {
    return null;
  }

  const rawValue = storageWindow.sessionStorage.getItem(
    buildQuotationPrintJobKey(jobId),
  );
  if (!rawValue) {
    return null;
  }

  try {
    const payload = JSON.parse(rawValue);
    return payload?.model || null;
  } catch {
    return null;
  }
}

export function deleteQuotationPrintJob(jobId, targetWindow) {
  const storageWindow = resolveStorageWindow(targetWindow);
  if (!storageWindow || !jobId) {
    return;
  }

  storageWindow.sessionStorage.removeItem(buildQuotationPrintJobKey(jobId));
}
