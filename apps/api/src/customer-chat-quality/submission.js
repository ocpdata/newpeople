const MAX_FAILED_ITEMS = 200;

// The workflow sends the scores and only the failed items; the full report stays as a CI artifact.
export function buildSubmission({ source, report, commit = null }) {
  const failed = (Array.isArray(report?.results) ? report.results : [])
    .filter((item) => item && item.passed === false)
    .slice(0, MAX_FAILED_ITEMS)
    .map((item) => ({
      group: typeof item.group === "string" ? item.group.slice(0, 40) : undefined,
      expected: typeof item.expected === "string" ? item.expected.slice(0, 120) : undefined,
      id: typeof item.id === "string" || typeof item.id === "number" ? item.id : undefined,
      error: typeof item.error === "string" ? item.error.slice(0, 300) : undefined,
      passed: false,
    }));
  return {
    source,
    ...(commit && /^[0-9a-f]{7,40}$/i.test(commit) ? { commit } : {}),
    report: {
      model: typeof report?.model === "string" ? report.model.slice(0, 80) : undefined,
      evaluatedAt: report?.evaluatedAt,
      groups: report?.groups,
      results: failed,
      scenarios: Array.isArray(report?.scenarios)
        ? report.scenarios.map((item) => ({ name: String(item.name).slice(0, 200), status: String(item.status).slice(0, 20) }))
        : undefined,
    },
  };
}

export function endpointFor(baseUrl, path) {
  const url = new URL(path, `${String(baseUrl).replace(/\/+$/, "")}/`);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("La URL de la API debe usar https.");
  }
  return url.toString();
}
