// Quality gates for the Coach and Cuenta nueva chats. They mirror the structure of the Cliente existente gates
// but are independent: thresholds here are initial values to be tuned once each channel has a measured baseline.

export const QUALITY_CHANNELS = Object.freeze(["coach", "prospect"]);
export const QUALITY_SOURCES = Object.freeze(["lab", "live", "production_monitor"]);
export const REGRESSION_POINTS = 5;
export const PRODUCTION_MIN_TURNS = 5;
export const LAB_MIN_RATIO = 0.9;
export const LIVE_MIN_RATIO = 0.85;
export const PRODUCTION_LIMITS = Object.freeze({ minReliability: 0.95, minResolution: 0.9, minSatisfaction: 0.75, maxP95Seconds: 30 });

const ratio = (group) => (group && group.total > 0 ? group.passed / group.total : null);
const pct = (value) => `${Math.round(value * 1000) / 10}%`;

function cleanGroup(group) {
  const passed = Number(group?.passed);
  const total = Number(group?.total);
  if (!Number.isFinite(passed) || !Number.isFinite(total) || total < 0 || passed < 0 || passed > total) return null;
  return { passed, total };
}

export function normalizeGroups(report) {
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

export function gateFailures(source, groups, metrics = {}) {
  const failures = [];
  if (source === "lab") {
    minimumRatio(groups, "cases", LAB_MIN_RATIO, "Casos aprobados", failures);
  } else if (source === "live") {
    minimumRatio(groups, "cases", LIVE_MIN_RATIO, "Casos aprobados con IA real", failures);
    const critical = groups.critical;
    if (critical && critical.total > 0 && critical.passed !== critical.total) {
      failures.push(`Escenarios críticos: ${critical.passed}/${critical.total}; se exige el 100%.`);
    }
  } else if (source === "production_monitor") {
    if ((metrics.turns || 0) >= PRODUCTION_MIN_TURNS) {
      minimumRatio(groups, "reliability", PRODUCTION_LIMITS.minReliability, "Turnos sin fallo", failures);
      if ((groups.resolution?.total || 0) >= PRODUCTION_MIN_TURNS) {
        minimumRatio(groups, "resolution", PRODUCTION_LIMITS.minResolution, "Turnos resueltos", failures);
      }
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
  const groups = normalizeGroups(report);
  const failures = gateFailures(source, groups, metrics);
  const regressions = regressionReasons(previousGroups, groups);
  const status = failures.length ? "failed" : regressions.length ? "regressed" : "passed";
  return { groups, status, reasons: [...failures, ...regressions] };
}
