import { api } from "../api";

const documentPath = (proposalId) => `/api/proposal-documents/v1/proposal-documents/${proposalId}`;
const scopePath = (proposalId, suffix = "") => `${documentPath(proposalId)}/technical-scope${suffix}`;
const sowPath = (proposalId, suffix = "") => `${documentPath(proposalId)}/sow${suffix}`;

// AI-backed operations can take longer than the default 15 s of the shared client.
const LONG_TIMEOUT = { timeout: 240000 };

export const technicalScopeApi = {
  overview: (proposalId) => api.get(scopePath(proposalId)).then((r) => r.data),
  start: (proposalId, selections) =>
    api.post(scopePath(proposalId), selections ? { selections } : {}).then((r) => r.data),
  discard: (proposalId) => api.delete(scopePath(proposalId)).then((r) => r.data),
  saveSelections: (proposalId, selections) =>
    api.put(scopePath(proposalId, "/selections"), { selections }).then((r) => r.data),
  saveAnswers: (proposalId, answers) =>
    api.put(scopePath(proposalId, "/answers"), { answers }).then((r) => r.data),
  confirmAnswers: (proposalId, playbookCode) =>
    api.post(scopePath(proposalId, "/answers/confirm"), { playbookCode }).then((r) => r.data),
  analyzeDocuments: (proposalId, documentPublicIds) =>
    api
      .post(
        scopePath(proposalId, "/analyze-documents"),
        { documentPublicIds: documentPublicIds || null },
        LONG_TIMEOUT,
      )
      .then((r) => r.data),
  useExtractionAsAsIs: (proposalId, documentPublicId) =>
    api
      .post(scopePath(proposalId, `/extractions/${encodeURIComponent(documentPublicId)}/use-as-asis`))
      .then((r) => r.data),
  generate: (proposalId, body) =>
    api.post(scopePath(proposalId, "/generate"), body, LONG_TIMEOUT).then((r) => r.data),
  saveSection: (proposalId, code, body) =>
    api.put(scopePath(proposalId, `/sections/${code}`), body).then((r) => r.data),
  saveItemRefs: (proposalId, code, itemRefs) =>
    api.put(scopePath(proposalId, `/sections/${code}/item-refs`), { itemRefs }).then((r) => r.data),
  saveTopology: (proposalId, topology, kind) =>
    api.put(scopePath(proposalId, "/topology"), { topology, kind }).then((r) => r.data),
  proposeTopology: (proposalId, useAi) =>
    api.post(scopePath(proposalId, "/topology/propose"), { useAi }, LONG_TIMEOUT).then((r) => r.data),
  gate: (proposalId) => api.get(scopePath(proposalId, "/gate")).then((r) => r.data),
  verification: (proposalId) =>
    api.get(scopePath(proposalId, "/verification")).then((r) => r.data),
  submit: (proposalId) => api.post(scopePath(proposalId, "/submit")).then((r) => r.data),
  approve: (proposalId, checklist, comment) =>
    api.post(scopePath(proposalId, "/approve"), { checklist, comment }).then((r) => r.data),
  returnToDraft: (proposalId, reason) =>
    api.post(scopePath(proposalId, "/return-to-draft"), { reason }).then((r) => r.data),

  sow: (proposalId) => api.get(sowPath(proposalId)).then((r) => r.data),
  generateSow: (proposalId, useAi) =>
    api.post(sowPath(proposalId, "/generate"), { useAi }, LONG_TIMEOUT).then((r) => r.data),
  saveSowSection: (proposalId, code, body) =>
    api.put(sowPath(proposalId, `/sections/${code}`), body).then((r) => r.data),
  submitSow: (proposalId) => api.post(sowPath(proposalId, "/submit")).then((r) => r.data),
  approveSow: (proposalId, checklist, comment) =>
    api.post(sowPath(proposalId, "/approve"), { checklist, comment }).then((r) => r.data),
  returnSowToDraft: (proposalId, reason) =>
    api.post(sowPath(proposalId, "/return-to-draft"), { reason }).then((r) => r.data),
  sowPdf: (proposalId) =>
    api
      .post(sowPath(proposalId, "/pdf"), {}, { responseType: "blob", timeout: 60000 })
      .then((r) => r.data),
};

export const playbooksApi = {
  list: () => api.get("/api/technical-playbooks").then((r) => r.data),
  diagnostic: () => api.get("/api/technical-playbooks/diagnostic").then((r) => r.data),
  ragTopics: () => api.get("/api/technical-playbooks/rag-topics").then((r) => r.data),
  detail: (code) => api.get(`/api/technical-playbooks/${code}`).then((r) => r.data),
  save: (code, body) => api.put(`/api/technical-playbooks/${code}`, body).then((r) => r.data),
  updateMetadata: (code, body) =>
    api.patch(`/api/technical-playbooks/${code}`, body).then((r) => r.data),
  generateDraft: (code, instructions) =>
    api
      .post(`/api/technical-playbooks/${code}/generate-draft`, { instructions }, LONG_TIMEOUT)
      .then((r) => r.data),
};

// Blob responses carry the JSON error inside the blob; this extracts the message.
export async function getTechnicalScopeErrorMessage(error, fallback) {
  const data = error?.response?.data;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text());
      if (parsed?.message) return parsed.message;
    } catch {
      return fallback;
    }
  }
  if (data?.message) {
    const missing = Array.isArray(data.missingChecklist) && data.missingChecklist.length
      ? ` (${data.missingChecklist.join(", ")})`
      : "";
    return `${data.message}${missing}`;
  }
  return error?.message || fallback;
}

export const SCOPE_STATUS_LABELS = {
  draft: "Borrador",
  in_review: "En revisión",
  approved: "Aprobado",
};
