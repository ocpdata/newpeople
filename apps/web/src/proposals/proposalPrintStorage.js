const PROPOSAL_PRINT_JOB_PREFIX = "proposal-print-job:";

function buildProposalPrintJobKey(jobId) {
  return `${PROPOSAL_PRINT_JOB_PREFIX}${jobId}`;
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

export function createProposalPrintJob(model, targetWindow) {
  const storageWindow = resolveStorageWindow(targetWindow);
  if (!storageWindow || !model) {
    return "";
  }

  const jobId = `print-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  storageWindow.sessionStorage.setItem(
    buildProposalPrintJobKey(jobId),
    JSON.stringify({ model, createdAt: Date.now() }),
  );
  return jobId;
}

export function readProposalPrintJob(jobId, targetWindow) {
  const storageWindow = resolveStorageWindow(targetWindow);
  if (!storageWindow || !jobId) {
    return null;
  }

  const rawValue = storageWindow.sessionStorage.getItem(
    buildProposalPrintJobKey(jobId),
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

export function deleteProposalPrintJob(jobId, targetWindow) {
  const storageWindow = resolveStorageWindow(targetWindow);
  if (!storageWindow || !jobId) {
    return;
  }

  storageWindow.sessionStorage.removeItem(buildProposalPrintJobKey(jobId));
}
