export const STAGE_ANSWER_PREFILL_STORAGE_PREFIX =
  "crm:stage-answer-prefill:";

export function stageAnswerPrefillStorageKey(token) {
  return `${STAGE_ANSWER_PREFILL_STORAGE_PREFIX}${String(token || "").trim()}`;
}

export function appendStageAnswerPrefillText(currentAnswer, appendText) {
  const current = String(currentAnswer || "").trim();
  const addition = String(appendText || "").trim();
  if (!addition || current.includes(addition)) return current;
  return current ? `${current}\n\n${addition}` : addition;
}