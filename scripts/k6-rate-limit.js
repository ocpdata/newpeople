import { fail } from "k6";
import execution from "k6/execution";
import http from "k6/http";

const targetUrl =
  __ENV.TARGET_URL ||
  __ENV.BASE_URL ||
  "https://newpip.digitalvs.com/";
const runId = __ENV.RUN_ID || `rl-${Date.now()}`;
const rps = Number(__ENV.RATE_LIMIT_RPS || 120);
const duration = __ENV.RATE_LIMIT_DURATION || "10s";
const cloudProjectID =
  __ENV.K6_CLOUD_PROJECT_ID && !Number.isNaN(Number(__ENV.K6_CLOUD_PROJECT_ID))
    ? Number(__ENV.K6_CLOUD_PROJECT_ID)
    : undefined;

export const options = {
  cloud: {
    name: "NewPeople - Rate Limit",
    ...(cloudProjectID ? { projectID: cloudProjectID } : {}),
    distribution: {
      "amazon:us:columbus": {
        loadZone: "amazon:us:columbus",
        percent: 100,
      },
    },
  },
  scenarios: {
    rate_limit_burst: {
      executor: "constant-arrival-rate",
      rate: rps,
      timeUnit: "1s",
      duration,
      preAllocatedVUs: Math.max(20, Math.ceil(rps / 4)),
      maxVUs: 150,
      gracefulStop: "0s",
    },
  },
  discardResponseBodies: false,
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
};

export default function () {
  const index = execution.scenario.iterationInTest + 1;
  const testId = `test-21-rate-limit-${index}`;
  const headers = {
    "X-WAF-Test-ID": testId,
    "X-WAF-Run-ID": runId,
    "User-Agent": "waf-rate-limit-k6-120rps",
  };

  const res = http.get(targetUrl, {
    headers,
    timeout: "10s",
    redirects: 0,
    tags: {
      test_id: testId,
      run_id: runId,
    },
  });

  const bodyText = res.body || "";
  const isRejected = /Request Rejected|The requested URL was rejected|Your support ID is/i.test(
    bodyText,
  );

  console.log(`${testId} | HTTP ${res.status} | rejected=${isRejected} | bytes=${bodyText.length}`);
}
