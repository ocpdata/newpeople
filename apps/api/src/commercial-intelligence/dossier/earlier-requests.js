// The models see the last RECENT_MESSAGES of the conversation. What the seller asked or required before that
// (language, scope, "no public sources"...) would be forgotten, so a clipped list of those older requests is
// passed along as continuity only. They are the seller's own words, never evidence and never tasks to run again.

export const RECENT_MESSAGES = 6;
const MAX_EARLIER_REQUESTS = 10;
const MAX_REQUEST_CHARS = 200;

export function earlierUserRequests(history = [], { recent = RECENT_MESSAGES } = {}) {
  const older = Array.isArray(history) ? history.slice(0, Math.max(0, history.length - recent)) : [];
  return older
    .filter((message) => message?.role === "user")
    .map((message) => String(message.text || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(-MAX_EARLIER_REQUESTS)
    .map((text) => (text.length > MAX_REQUEST_CHARS ? `${text.slice(0, MAX_REQUEST_CHARS - 1).trimEnd()}…` : text));
}

// Spread into a context object: adds the key only when there is something older than the recent window.
export function earlierRequestsContext(history, options) {
  const requests = earlierUserRequests(history, options);
  return requests.length ? { earlierUserRequests: requests } : {};
}
