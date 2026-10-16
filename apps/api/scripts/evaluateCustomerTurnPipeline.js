import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { config } from "../src/config.js";

if (!process.argv.includes("--live")) {
  console.error("Requiere --live: realiza llamadas pagadas con CRM exclusivamente sintético.");
  process.exitCode = 1;
} else if (!config.openai.apiKey) {
  console.error("Falta la configuración del proveedor de IA.");
  process.exitCode = 1;
} else {
  process.env.CUSTOMER_TURN_PIPELINE_LIVE = "1";
  const { startVitest } = await import("vitest/node");
  const ctx = await startVitest("test", ["test/customer-turn-pipeline.test.js"], {
    root: fileURLToPath(new URL("..", import.meta.url)),
    config: false, watch: false, maxWorkers: 1,
    testNamePattern: "real synthetic", reporters: ["default"],
  });
  if (!ctx) process.exitCode = 1;
  else {
    try {
      const tasks = ctx.state.getFiles().flatMap((file) => file.tasks.flatMap((suite) => suite.tasks || []));
      const executed = tasks.filter((task) => ["pass", "fail"].includes(task.result?.state));
      const passed = executed.length === 7 && executed.every((task) => task.result.state === "pass");
      const report = {
        passed, syntheticOnly: true, model: config.openai.model,
        scenarios: executed.map((task) => ({ name: task.name, status: task.result.state })),
        evaluatedAt: new Date().toISOString(),
      };
      const index = process.argv.indexOf("--output");
      if (index >= 0 && process.argv[index + 1]) {
        await writeFile(process.argv[index + 1], JSON.stringify(report, null, 2));
      }
      if (!passed) process.exitCode = 1;
    } finally {
      await ctx.close();
    }
  }
}
