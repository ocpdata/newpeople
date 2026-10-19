import { randomUUID } from "node:crypto";
import { config } from "../src/config.js";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const token = process.env.CUSTOMER_CHAT_EVALUATION_TOKEN;
if (!token) {
  console.error("Falta CUSTOMER_CHAT_EVALUATION_TOKEN: token del usuario autorizado en la instancia actual.");
  process.exitCode = 1;
} else {
  const root = `http://127.0.0.1:${config.port}/api/mi-agent/evaluations`;
  async function request(path, body) {
    const response = await fetch(`${root}${path}`, { method: body === undefined ? "GET" : "POST", redirect: "error",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
    return data;
  }
  try {
    if (args.includes("--catalog")) console.log(JSON.stringify(await request("/catalog"), null, 2));
    else if (args.includes("--preflight")) console.log(JSON.stringify(await request("/preflight", {}), null, 2));
    else if (args.includes("--export")) {
      const id = option("--export");
      console.log(JSON.stringify(await request(`/runs/${encodeURIComponent(id)}/export`), null, 2));
    } else {
      if (!args.includes("--live")) throw new Error("Requiere --live para autorizar llamadas pagadas de IA. Usa --preflight para verificar primero.");
      const catalog = await request("/catalog");
      const category = option("--category");
      const selected = option("--case");
      const caseIds = selected ? selected.split(",") : category ? catalog.cases.filter((item) => item.category === category).map((item) => item.id) : [];
      const run = await request("/runs", {
        requestKey: randomUUID(), suite: selected || category ? "selected" : option("--suite", "smoke"), caseIds,
        repetitions: Number(option("--repeat", "1")), maxTurns: Number(option("--max-turns", "100")),
        maxMinutes: Number(option("--max-minutes", "30")), acknowledgePaidCalls: true,
      });
      console.log(JSON.stringify(run));
      if (args.includes("--wait")) {
        let detail;
        do {
          await new Promise((resolve) => setTimeout(resolve, 2500));
          detail = await request(`/runs/${run.id}`);
          console.log(JSON.stringify({ id: run.id, status: detail.run.status, counts: detail.counts }));
        } while (["pending", "running"].includes(detail.run.status));
        if (detail.run.status !== "completed" || Object.keys(detail.counts).some((status) => status !== "passed")) process.exitCode = 2;
      }
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
