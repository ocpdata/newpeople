#!/usr/bin/env node

function formatLocalDateTimeInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

async function login(baseUrl, email, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.token) {
    throw new Error(
      `Login failed for ${email} (${response.status}): ${payload?.message || "unknown"}`,
    );
  }

  return payload.token;
}

async function createCalendarActivity(baseUrl, token, body) {
  const response = await fetch(
    `${baseUrl}/api/commercial-development/calendar/activities`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    },
  );

  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

function printCaseResult(caseName, expected, actual, payload) {
  const ok = expected === actual;
  const marker = ok ? "PASS" : "FAIL";
  console.log(`[${marker}] ${caseName}: expected ${expected}, got ${actual}`);
  if (!ok) {
    console.log(`       response: ${JSON.stringify(payload)}`);
  }
  return ok;
}

async function main() {
  const baseUrl =
    String(process.env.NP_API_BASE_URL || "http://localhost:4000").replace(
      /\/$/,
      "",
    );

  const okEmail = String(process.env.NP_API_OK_EMAIL || "").trim();
  const okPassword = String(process.env.NP_API_OK_PASSWORD || "").trim();
  const forbiddenEmail = String(process.env.NP_API_FORBIDDEN_EMAIL || "").trim();
  const forbiddenPassword = String(
    process.env.NP_API_FORBIDDEN_PASSWORD || "",
  ).trim();

  if (!okEmail || !okPassword || !forbiddenEmail || !forbiddenPassword) {
    console.error("Missing required env vars:");
    console.error("- NP_API_OK_EMAIL");
    console.error("- NP_API_OK_PASSWORD");
    console.error("- NP_API_FORBIDDEN_EMAIL");
    console.error("- NP_API_FORBIDDEN_PASSWORD");
    console.error("Optional: NP_API_BASE_URL (default http://localhost:4000)");
    process.exit(1);
  }

  const okToken = await login(baseUrl, okEmail, okPassword);
  const forbiddenToken = await login(baseUrl, forbiddenEmail, forbiddenPassword);

  const now = new Date();
  now.setMinutes(now.getMinutes() + 30);
  const scheduledAt = formatLocalDateTimeInput(now);
  const runId = `${Date.now()}`;

  const case201Payload = {
    kind: "standalone",
    activityType: "call",
    status: "pending",
    scheduledAt,
    objective: `QA 201 ${runId}`,
    note: "quick check 201",
    successCriteria: "registrada",
    accountLinkMode: "create_new",
    contactLinkMode: "create_new",
    accountDraft: {
      name: `QA Account ${runId}`,
      phone: "5550101",
      city: "CDMX",
      stateRegion: "CDMX",
      website: "",
      description: "QA quick test",
    },
    contactDraft: {
      firstName: "QA",
      lastName: `Contact${runId}`,
      email: `qa.contact.${runId}@example.test`,
      phone: "5550102",
      positionTitle: "Compras",
    },
  };

  const case403Payload = {
    ...case201Payload,
    objective: `QA 403 ${runId}`,
    accountDraft: {
      ...case201Payload.accountDraft,
      name: `QA Forbidden Account ${runId}`,
    },
    contactDraft: {
      ...case201Payload.contactDraft,
      lastName: `Forbidden${runId}`,
      email: `qa.forbidden.${runId}@example.test`,
    },
  };

  const dupAccountName = `QA DUP Account ${runId}`;
  const case409SeedPayload = {
    ...case201Payload,
    objective: `QA 409 seed ${runId}`,
    accountDraft: {
      ...case201Payload.accountDraft,
      name: dupAccountName,
    },
    contactDraft: {
      ...case201Payload.contactDraft,
      lastName: `DupSeed${runId}`,
      email: `qa.dup.seed.${runId}@example.test`,
    },
  };

  const case409Payload = {
    ...case201Payload,
    objective: `QA 409 check ${runId}`,
    accountDraft: {
      ...case201Payload.accountDraft,
      name: dupAccountName,
    },
    contactDraft: {
      ...case201Payload.contactDraft,
      lastName: `DupCheck${runId}`,
      email: `qa.dup.check.${runId}@example.test`,
    },
  };

  const case201 = await createCalendarActivity(baseUrl, okToken, case201Payload);
  const case403 = await createCalendarActivity(
    baseUrl,
    forbiddenToken,
    case403Payload,
  );

  // Seed once so the second creation with the same account name should trigger duplicate handling.
  await createCalendarActivity(baseUrl, okToken, case409SeedPayload);
  const case409 = await createCalendarActivity(baseUrl, okToken, case409Payload);

  const ok201 = printCaseResult("201 create with valid permissions", 201, case201.status, case201.payload);
  const ok403 = printCaseResult("403 create without required permissions", 403, case403.status, case403.payload);
  const ok409 = printCaseResult("409 duplicate validation", 409, case409.status, case409.payload);

  if (!ok201 || !ok403 || !ok409) {
    process.exit(1);
  }

  console.log("All quick checks passed.");
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
