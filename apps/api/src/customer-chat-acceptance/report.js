const percent = (value, total) => (total ? `${Math.round((value / total) * 100)} %` : "—");

export function summarizeRun(report) {
  const turns = report.conversations.flatMap((conversation) => conversation.turns.map((turn) => ({
    conversationId: conversation.conversationId, ...turn,
  })));
  const graded = turns.filter((turn) => turn.grade && turn.grade.status !== "not_graded");
  const sum = (key) => graded.reduce((total, turn) => total + Number(turn.grade[key] || 0), 0);
  const usage = turns.map((turn) => turn.execution.aiUsage).filter(Boolean);
  const durations = turns.map((turn) => turn.execution.durationMs).filter((value) => Number.isFinite(value));
  return {
    turns: turns.length,
    graded: graded.length,
    passed: graded.filter((turn) => turn.grade.status === "passed").length,
    blocked: graded.filter((turn) => turn.grade.blocked?.length).length,
    criticalPassed: sum("criticalPassed"),
    criticalTotal: sum("criticalTotal"),
    requiredPassed: sum("requiredPassed"),
    requiredTotal: sum("requiredTotal"),
    violations: graded.reduce((total, turn) => total + (turn.grade.violations?.length || 0), 0),
    unverified: graded.reduce((total, turn) => total + (turn.grade.unverified?.length || 0), 0),
    formTurns: graded.filter((turn) => turn.grade.form).length,
    formPassed: graded.filter((turn) => turn.grade.form?.passed).length,
    medianDurationMs: durations.length ? [...durations].sort((a, b) => a - b)[Math.floor(durations.length / 2)] : null,
    maxDurationMs: durations.length ? Math.max(...durations) : null,
    aiCalls: usage.reduce((total, item) => total + item.calls, 0),
    promptTokens: usage.reduce((total, item) => total + item.promptTokens, 0),
    completionTokens: usage.reduce((total, item) => total + item.completionTokens, 0),
    costUsd: usage.reduce((total, item) => total + item.costUsd, 0),
  };
}

function cell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

export function renderMarkdownReport(report) {
  const summary = summarizeRun(report);
  const lines = [
    `# Banco de aceptación — ${report.engine} — ${report.startedAt}`,
    "",
    `- Revisión de código: ${report.gitRevision || "desconocida"}`,
    `- Modelo del chat: ${report.chatModel}`,
    ...(report.analystModel ? [`- Analista: ${report.analystModel}${report.analystReasoningEffort ? ` (esfuerzo ${report.analystReasoningEffort})` : ""} · enrutador: ${report.routerModel}`] : []),
    `- Modelo evaluador: ${report.judgeModel || "sin evaluación"}`,
    `- Hechos del banco verificados: ${report.factCheck.ok}/${report.factCheck.total}`,
    "",
    "## Resumen",
    "",
    "| Métrica | Valor |",
    "| --- | --- |",
    `| Turnos aprobados | ${summary.passed}/${summary.graded} (${percent(summary.passed, summary.graded)}) |`,
    `| Hechos críticos presentes | ${summary.criticalPassed}/${summary.criticalTotal} (${percent(summary.criticalPassed, summary.criticalTotal)}) |`,
    `| Hechos totales presentes | ${summary.requiredPassed}/${summary.requiredTotal} (${percent(summary.requiredPassed, summary.requiredTotal)}) |`,
    `| Afirmaciones prohibidas | ${summary.violations} |`,
    `| Forma exigida cumplida | ${summary.formPassed}/${summary.formTurns} |`,
    `| Turnos con error o aclaración no permitida | ${summary.blocked} |`,
    `| Veredictos sin cita verificable (revisión humana) | ${summary.unverified} |`,
    `| Duración mediana / máxima | ${summary.medianDurationMs === null ? "—" : `${Math.round(summary.medianDurationMs / 1000)} s`} / ${summary.maxDurationMs === null ? "—" : `${Math.round(summary.maxDurationMs / 1000)} s`} |`,
    `| Llamadas de IA del chat | ${summary.aiCalls} |`,
    `| Tokens de entrada / salida del chat | ${summary.promptTokens} / ${summary.completionTokens} |`,
    `| Coste registrado del chat | ${summary.costUsd.toFixed(4)} USD |`,
    "",
    "## Turnos",
    "",
    "| Conversación | Turno | Resultado | Críticos | Prohibidas | Forma | Bloqueo | Duración | Llamadas IA |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const conversation of report.conversations) {
    for (const turn of conversation.turns) {
      const grade = turn.grade || {};
      lines.push(`| ${conversation.conversationId} | ${turn.turnId} | ${grade.status || "sin evaluar"} | ${grade.criticalTotal ? `${grade.criticalPassed}/${grade.criticalTotal}` : "—"} | ${grade.violations?.length ? cell(grade.violations.join(", ")) : "0"} | ${grade.form ? `${grade.form.withConfirmation}/${grade.form.required}${grade.form.passed ? "" : " ✗"}` : "—"} | ${cell(grade.blocked?.join(", ") || "")} | ${Math.round((turn.execution.durationMs || 0) / 1000)} s | ${turn.execution.aiUsage?.calls ?? "—"} |`);
    }
  }
  lines.push("", "## Detalle", "");
  for (const conversation of report.conversations) {
    for (const turn of conversation.turns) {
      const grade = turn.grade;
      lines.push(`### ${conversation.conversationId} / ${turn.turnId} — ${grade?.status || "sin evaluar"}`, "",
        `**Pregunta:** ${turn.question}`, "",
        `**Job:** ${turn.execution.jobId ?? "—"} · estado ${turn.execution.status} · tipo ${turn.execution.responseType || "—"} · presentación ${turn.execution.presentationStatus || "—"}${turn.execution.presentationReason ? ` (${turn.execution.presentationReason})` : ""}`, "");
      if (turn.execution.errorMessage) lines.push(`**Error:** ${turn.execution.errorMessage}`, "");
      if (turn.judgeError) lines.push(`**Error del evaluador:** ${turn.judgeError}`, "");
      lines.push("**Respuesta:**", "", ...String(turn.execution.answer || "(vacía)").split("\n").map((line) => `> ${line}`), "");
      if (grade?.required?.length) {
        lines.push("| Comprobación | Crítica | Resultado | Explicación |", "| --- | --- | --- | --- |");
        for (const item of grade.required) {
          lines.push(`| ${item.id} | ${item.critical ? "sí" : "no"} | ${item.status} | ${cell(item.explanation)} |`);
        }
        for (const item of grade.forbidden) {
          lines.push(`| ✗ ${item.id} | prohibida | ${item.status} | ${cell(item.explanation)} |`);
        }
        if (grade.form) lines.push(`| forma | — | ${grade.form.passed ? "passed" : "failed"} | ${cell(`${grade.form.found} puntos, ${grade.form.withConfirmation} con confirmación; ${grade.form.explanation}`)} |`);
        lines.push("");
      }
    }
  }
  return lines.join("\n");
}
