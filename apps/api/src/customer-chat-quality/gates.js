// Quality gates for the existing-customer chat. Thresholds mirror
// readme/evaluacion-live-chat-cliente-existente.md; the production ones are alert levels set
// above the baseline measured before the chat improvements (5.1% failures, p95 19.4 s).

export const QUALITY_SOURCES = Object.freeze(["contract", "pipeline", "evaluation_module", "production_monitor"]);
export const REGRESSION_POINTS = 5;
export const PRODUCTION_MIN_TURNS = 5;
export const PRODUCTION_LIMITS = Object.freeze({ minReliability: 0.9, minSatisfaction: 0.75, maxP95Seconds: 30 });

const ratio = (group) => (group && group.total > 0 ? group.passed / group.total : null);
const pct = (value) => `${Math.round(value * 1000) / 10}%`;

function cleanGroup(group) {
  const passed = Number(group?.passed);
  const total = Number(group?.total);
  if (!Number.isFinite(passed) || !Number.isFinite(total) || total < 0 || passed < 0 || passed > total) return null;
  return { passed, total };
}

export function normalizeGroups(source, report) {
  if (source === "pipeline") {
    const scenarios = Array.isArray(report?.scenarios) ? report.scenarios : [];
    return { scenarios: { passed: scenarios.filter((item) => item.status === "pass").length, total: scenarios.length } };
  }
  const groups = {};
  for (const [name, value] of Object.entries(report?.groups || {})) {
    const group = cleanGroup(value);
    if (group) groups[name] = group;
  }
  return groups;
}

function minimumRatio(groups, name, minimum, label, failures) {
  const group = groups[name];
  if (!group || group.total === 0) {
    failures.push(`${label}: no se ejecutó.`);
    return;
  }
  if (ratio(group) < minimum) failures.push(`${label}: ${group.passed}/${group.total} (${pct(ratio(group))}); mínimo ${pct(minimum)}.`);
}

function exactGroup(groups, name, expectedTotal, label, failures) {
  const group = groups[name];
  if (!group || group.total !== expectedTotal || group.passed !== expectedTotal) {
    failures.push(`${label}: ${group ? `${group.passed}/${group.total}` : "no se ejecutó"}; se exige ${expectedTotal}/${expectedTotal}.`);
  }
}

export function gateFailures(source, groups, metrics = {}) {
  const failures = [];
  if (source === "contract") {
    if (groups.dimensions) {
      if (groups.dimensions.total === 0 || groups.dimensions.passed !== groups.dimensions.total) {
        failures.push(`Dimensiones: ${groups.dimensions.passed}/${groups.dimensions.total}; se exige el 100%.`);
      }
    } else {
      minimumRatio(groups, "catalog", 0.95, "Categoría y objeto", failures);
      minimumRatio(groups, "dialogue", 0.9, "Movimiento de diálogo", failures);
      exactGroup(groups, "critical", 9, "Controles críticos", failures);
    }
  } else if (source === "pipeline") {
    exactGroup(groups, "scenarios", 7, "Recorridos completos", failures);
  } else if (source === "evaluation_module") {
    minimumRatio(groups, "cases", 0.9, "Casos aprobados", failures);
  } else if (source === "production_monitor") {
    if ((metrics.turns || 0) >= PRODUCTION_MIN_TURNS) {
      minimumRatio(groups, "reliability", PRODUCTION_LIMITS.minReliability, "Turnos sin fallo", failures);
      if ((groups.satisfaction?.total || 0) >= PRODUCTION_MIN_TURNS) {
        minimumRatio(groups, "satisfaction", PRODUCTION_LIMITS.minSatisfaction, "Valoraciones positivas", failures);
      }
      if (Number(metrics.latencyP95Seconds) > PRODUCTION_LIMITS.maxP95Seconds) {
        failures.push(`Latencia p95: ${metrics.latencyP95Seconds} s; máximo ${PRODUCTION_LIMITS.maxP95Seconds} s.`);
      }
    }
  } else {
    throw new Error(`Fuente de calidad desconocida: ${source}`);
  }
  return failures;
}

export function regressionReasons(previousGroups, groups) {
  const reasons = [];
  for (const [name, group] of Object.entries(groups)) {
    const before = ratio(previousGroups?.[name]);
    const now = ratio(group);
    if (before === null || now === null) continue;
    if ((before - now) * 100 >= REGRESSION_POINTS) {
      reasons.push(`${name} bajó de ${pct(before)} a ${pct(now)} frente a la ejecución anterior.`);
    }
  }
  return reasons;
}

// status: failed (a gate is not met) > regressed (gates met but the score dropped) > passed.
export function assessQualityReport({ source, report, metrics = {}, previousGroups = null }) {
  const groups = normalizeGroups(source, report);
  const failures = gateFailures(source, groups, metrics);
  const regressions = regressionReasons(previousGroups, groups);
  const status = failures.length ? "failed" : regressions.length ? "regressed" : "passed";
  return { groups, status, reasons: [...failures, ...regressions] };
}
