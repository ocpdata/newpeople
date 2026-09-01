import { fail } from "k6";
import execution from "k6/execution";
import http from "k6/http";
import { Counter } from "k6/metrics";

const targetUrl =
  __ENV.DOS_TARGET_URL ||
  "https://newpip.digitalvs.com/api/accounts/l7-dos-test";
const testId = __ENV.DOS_TEST_ID || "dos-k6-cloud";
const runId = __ENV.DOS_RUN_ID || `dos-${Date.now()}`;

const successfulResponses = new Counter("dos_successful_responses");
const blockedResponses = new Counter("dos_blocked_responses");
const serverErrorResponses = new Counter("dos_server_error_responses");
const unexpectedResponses = new Counter("dos_unexpected_responses");
const cloudProjectID =
  __ENV.K6_CLOUD_PROJECT_ID && !Number.isNaN(Number(__ENV.K6_CLOUD_PROJECT_ID))
    ? Number(__ENV.K6_CLOUD_PROJECT_ID)
    : undefined;

function rateScenario(rate, duration, startTime) {
  return {
    executor: "constant-arrival-rate",
    exec: "sendRequest",
    rate,
    timeUnit: "1s",
    duration,
    startTime,
    preAllocatedVUs: Math.max(20, Math.ceil(rate / 4)),
    maxVUs: 100,
    gracefulStop: "0s",
  };
}

export const options = {
  cloud: {
    name: "NewPeople - DDoS L7 distribuido",
    ...(cloudProjectID ? { projectID: cloudProjectID } : {}),
    distribution: {
      "amazon:us:columbus": {
        loadZone: "amazon:us:columbus",
        percent: 10,
      },
      "amazon:br:sao paulo": {
        loadZone: "amazon:br:sao paulo",
        percent: 20,
      },
      "amazon:de:frankfurt": {
        loadZone: "amazon:de:frankfurt",
        percent: 20,
      },
      "amazon:gb:london": {
        loadZone: "amazon:gb:london",
        percent: 10,
      },
      "amazon:sa:cape town": {
        loadZone: "amazon:sa:cape town",
        percent: 20,
      },
      "amazon:jp:tokyo": {
        loadZone: "amazon:jp:tokyo",
        percent: 20,
      },
    },
  },
  scenarios: {
    baseline: rateScenario(50, "10s", "0s"),
    pre_threshold: rateScenario(90, "15s", "10s"),
    threshold: rateScenario(100, "20s", "25s"),
    over_threshold: rateScenario(150, "1m", "45s"),
    recovery: rateScenario(20, "15s", "1m45s"),
  },
  thresholds: {
    dropped_iterations: ["count==0"],
    dos_server_error_responses: ["count==0"],
    http_req_duration: ["p(95)<5000"],
  },
  discardResponseBodies: true,
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
};

export function setup() {
  if (!/^https:\/\//i.test(targetUrl)) {
    fail("DOS_TARGET_URL debe ser una URL HTTPS valida");
  }
  if (!/^dos-[a-z0-9-]+$/i.test(testId)) {
    fail("DOS_TEST_ID debe comenzar con dos- y usar letras, numeros o guiones");
  }
  if (!/^dos-[a-z0-9-]+$/i.test(runId)) {
    fail("DOS_RUN_ID debe comenzar con dos- y usar letras, numeros o guiones");
  }
}

export function sendRequest() {
  const phase = execution.scenario.name;
  const requestId = `${execution.vu.idInTest}-${execution.scenario.iterationInTest}`;

  const response = http.get(targetUrl, {
    headers: {
      "Cache-Control": "no-cache, no-store",
      Pragma: "no-cache",
      "X-DOS-Request-ID": requestId,
      "X-DOS-Test-ID": testId,
      "X-DOS-Run-ID": runId,
    },
    tags: {
      name: "l7_dos_test",
      phase,
      run_id: runId,
      test_id: testId,
    },
    timeout: "10s",
  });

  if (response.status === 403 || response.status === 429) {
    blockedResponses.add(1, { phase });
  } else if (response.status >= 200 && response.status < 400) {
    successfulResponses.add(1, { phase });
  } else if (response.status >= 500) {
    serverErrorResponses.add(1, { phase });
  } else {
    unexpectedResponses.add(1, { phase, status: String(response.status) });
  }
}
