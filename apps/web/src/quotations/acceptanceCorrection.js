export function acceptanceCorrectionConfig(reason) {
  return reason ? { headers: { "X-Acceptance-Correction-Reason": encodeURIComponent(reason) } } : {};
}
