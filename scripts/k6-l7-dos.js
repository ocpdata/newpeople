import http from "k6/http";
import { Counter } from "k6/metrics";

const rate = Number(__ENV.DOS_RATE_RPS || 1);
const duration = __ENV.DOS_DURATION || "10s";
const testId = __ENV.DOS_TEST_ID || "dos-unknown";
const runId = __ENV.DOS_RUN_ID || "dos-run";
const targetUrl = __ENV.DOS_TARGET_URL;

const successfulResponses = new Counter("dos_successful_responses");
const blockedResponses = new Counter("dos_blocked_responses");
const errorResponses = new Counter("dos_error_responses");

export const options = {
  noVUConnectionReuse: true,
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
  scenarios: {
    controlled_rate: {
      executor: "constant-arrival-rate",
      rate,
      timeUnit: "1s",
      duration,
      preAllocatedVUs: Math.max(10, Math.ceil(rate / 5)),
      maxVUs: Math.max(20, Math.ceil(rate / 2)),
    },
  },
  discardResponseBodies: true,
};

export default function () {
  const separator = targetUrl.includes("?") ? "&" : "?";
  const requestUrl = `${targetUrl}${separator}dos_test_id=${encodeURIComponent(testId)}&dos_run_id=${encodeURIComponent(runId)}&dos_request=${__VU}-${__ITER}`;
  const response = http.get(requestUrl, {
    headers: {
      "Cache-Control": "no-cache, no-store",
      Connection: "close",
      Pragma: "no-cache",
      "X-DOS-Test-ID": testId,
      "X-DOS-Run-ID": runId,
    },
    tags: { test_id: testId, run_id: runId },
    timeout: "10s",
  });

  if (response.status === 403 || response.status === 429) {
    blockedResponses.add(1);
  } else if (response.status >= 200 && response.status < 400) {
    successfulResponses.add(1);
  } else {
    errorResponses.add(1);
  }
}

export function handleSummary(data) {
  return {
    [__ENV.DOS_SUMMARY_PATH]: JSON.stringify(data),
  };
}
