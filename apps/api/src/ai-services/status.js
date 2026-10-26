// Pure computations for AI services: provider status, limits, readiness and period boundaries.
import {
  AI_LLM_PROVIDERS,
  AI_MODEL_ROLES,
  AI_MODULES,
  PINECONE_METRICS,
  PINECONE_PLANS,
  tavilyPriceForPlan,
} from "./catalog.js";

function datePartsIn(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const value = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second") };
}

function timeZoneOffsetMs(date, timeZone) {
  const p = datePartsIn(date, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
}

// Start of the calendar month in the business time zone, as an absolute instant.
export function monthStartFor(now, timeZone) {
  const p = datePartsIn(now, timeZone);
  const guess = new Date(Date.UTC(p.year, p.month - 1, 1));
  return new Date(guess.getTime() - timeZoneOffsetMs(guess, timeZone));
}

export function periodKeyFor(now, timeZone) {
  const p = datePartsIn(now, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

export function dayKeyFor(date, timeZone) {
  const p = datePartsIn(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function levelFor(used, limit, warningPercent) {
  if (!limit || limit <= 0) return { percent: null, level: "normal" };
  const percent = Math.round((used / limit) * 1000) / 10;
  if (percent >= 100) return { percent, level: "limit" };
  if (percent >= warningPercent) return { percent, level: "warning" };
  return { percent, level: "normal" };
}

const LEVEL_RANK = { normal: 0, warning: 1, limit: 2 };

function worstLevel(metrics) {
  return metrics.reduce(
    (worst, metric) => (LEVEL_RANK[metric.level] > LEVEL_RANK[worst] ? metric.level : worst),
    "normal",
  );
}

export function tavilyEffectivePrice(settings, remote) {
  const configured = settings.providers.tavily.usdPerCredit;
  if (configured !== null && configured !== undefined) return { usdPerCredit: configured, source: "configured" };
  const fromPlan = tavilyPriceForPlan(remote?.plan);
  return fromPlan === null ? { usdPerCredit: null, source: "unknown" } : { usdPerCredit: fromPlan, source: "plan" };
}

// Alerts for a balance are re-armed every time a new balance is captured.
export function balanceMetricCode(capturedAt) {
  return `balance_usd@${new Date(capturedAt).getTime().toString(36)}`;
}

export function isBalanceMetric(code) {
  return String(code || "").startsWith("balance_usd");
}

/**
 * Estimated balance = captured balance − cost measured by the CRM since the capture.
 * Returns null when no balance was captured.
 */
export function estimateProviderBalance(providerSettings, spentSinceUsd) {
  if (providerSettings?.balanceUsd === null || providerSettings?.balanceUsd === undefined
    || !providerSettings.balanceCapturedAt) return null;
  const spent = Math.max(0, Number(spentSinceUsd || 0));
  const estimatedUsd = Math.round((providerSettings.balanceUsd - spent) * 1e6) / 1e6;
  const warningUsd = providerSettings.balanceWarningUsd;
  const level = estimatedUsd <= 0
    ? "limit"
    : warningUsd !== null && warningUsd !== undefined && estimatedUsd <= warningUsd ? "warning" : "normal";
  return {
    capturedUsd: providerSettings.balanceUsd,
    capturedAt: providerSettings.balanceCapturedAt,
    spentSinceUsd: spent,
    estimatedUsd,
    warningUsd: warningUsd ?? null,
    level,
  };
}

/**
 * usage: {
 *   openai: { costUsd, calls, byModel: [{ model, costUsd, calls }], spentSinceBalanceUsd },
 *   tavily: { credits, calls },
 *   pinecone: { [metric]: units },
 * }
 * remote.tavily: { plan, planUsage, planLimit, fetchedAt, error } | null
 */
export function computeProviderStatuses({ settings, usage, remoteTavily = null, connections = {} }) {
  const openaiSettings = settings.providers.openai;
  const openaiCost = Number(usage?.openai?.costUsd || 0);
  const openaiLevel = levelFor(openaiCost, openaiSettings.monthlyLimitUsd, openaiSettings.warningPercent);
  const openaiMetrics = [{
    code: "cost_usd",
    label: "Consumo medido por el CRM",
    unit: "usd",
    used: openaiCost,
    limit: openaiSettings.monthlyLimitUsd,
    source: "measured",
    ...openaiLevel,
  }];

  const balance = estimateProviderBalance(openaiSettings, usage?.openai?.spentSinceBalanceUsd);
  if (balance) {
    openaiMetrics.push({
      code: balanceMetricCode(balance.capturedAt),
      kind: "balance",
      label: "Saldo estimado",
      unit: "usd",
      used: balance.estimatedUsd,
      limit: null,
      percent: null,
      level: balance.level,
      source: "estimated",
    });
  }

  const tavilySettings = settings.providers.tavily;
  const measuredCredits = Number(usage?.tavily?.credits || 0);
  const remoteUsed = remoteTavily && !remoteTavily.error && Number.isFinite(Number(remoteTavily.planUsage))
    ? Number(remoteTavily.planUsage) : null;
  const remoteLimit = remoteTavily && !remoteTavily.error && Number(remoteTavily.planLimit) > 0
    ? Number(remoteTavily.planLimit) : null;
  const tavilyUsed = remoteUsed ?? measuredCredits;
  const tavilyLimit = tavilySettings.monthlyLimitCredits ?? remoteLimit;
  const tavilyPrice = tavilyEffectivePrice(settings, remoteTavily);
  const tavilyMetrics = [{
    code: "credits",
    label: remoteUsed === null ? "Créditos medidos por el CRM" : "Créditos del ciclo (leído de Tavily)",
    unit: "credits",
    used: tavilyUsed,
    limit: tavilyLimit,
    limitSource: tavilySettings.monthlyLimitCredits ? "configured" : remoteLimit ? "plan" : null,
    source: remoteUsed === null ? "measured" : "provider",
    ...levelFor(tavilyUsed, tavilyLimit, tavilySettings.warningPercent),
  }];

  const pineconeSettings = settings.providers.pinecone;
  const plan = PINECONE_PLANS[pineconeSettings.plan] || PINECONE_PLANS.starter;
  let pineconeCost = 0;
  const pineconeMetrics = PINECONE_METRICS.map((metric) => {
    const used = Number(usage?.pinecone?.[metric.code] || 0);
    const limit = plan.limits[metric.code] || null;
    pineconeCost += used * Number(plan.usdPerUnit[metric.code] || 0);
    return {
      code: metric.code,
      label: metric.label,
      unit: metric.unit,
      used,
      limit,
      source: "measured",
      ...levelFor(used, limit, pineconeSettings.warningPercent),
    };
  });

  return {
    openai: {
      code: "openai",
      label: "OpenAI",
      kind: "llm",
      configured: Boolean(connections.openai),
      metrics: openaiMetrics,
      level: worstLevel(openaiMetrics),
      costUsd: openaiCost,
      calls: Number(usage?.openai?.calls || 0),
      byModel: usage?.openai?.byModel || [],
      balance,
      onLimit: openaiSettings.onLimit,
      warningPercent: openaiSettings.warningPercent,
    },
    tavily: {
      code: "tavily",
      label: "Tavily",
      kind: "search",
      configured: Boolean(connections.tavily),
      enabledInServer: connections.tavilyEnabled !== false,
      metrics: tavilyMetrics,
      level: worstLevel(tavilyMetrics),
      measuredCredits,
      calls: Number(usage?.tavily?.calls || 0),
      usdPerCredit: tavilyPrice.usdPerCredit,
      priceSource: tavilyPrice.source,
      costUsd: tavilyPrice.usdPerCredit === null ? null : tavilyUsed * tavilyPrice.usdPerCredit,
      remote: remoteTavily,
      onLimit: tavilySettings.onLimit,
      warningPercent: tavilySettings.warningPercent,
    },
    pinecone: {
      code: "pinecone",
      label: "Pinecone Assistant",
      kind: "documents",
      configured: Boolean(connections.pinecone),
      plan: pineconeSettings.plan,
      planLabel: plan.label,
      blocksAtLimit: plan.blocksAtLimit,
      metrics: pineconeMetrics,
      level: worstLevel(pineconeMetrics),
      costUsd: pineconeCost,
      calls: Number(usage?.pinecone?.calls || 0),
      warningPercent: pineconeSettings.warningPercent,
    },
  };
}

/**
 * Checks every model the settings would use against active tariffs.
 * activeRates: { [provider]: Set<model> }
 */
export function validateAiServiceSettings(settings, { activeRates = {}, connections = {} } = {}) {
  const errors = [];
  const moduleIssues = {};
  const providerIssues = {};
  const usedProviders = new Set();
  const addModuleIssue = (code, issue) => {
    moduleIssues[code] = [...(moduleIssues[code] || []), issue];
  };

  for (const module of AI_MODULES) {
    const moduleSettings = settings.modules[module.code];
    if (!module.usesLlm || !moduleSettings) continue;
    const provider = moduleSettings.llmProvider;
    usedProviders.add(provider);
    const providerLabel = AI_LLM_PROVIDERS.find((item) => item.code === provider)?.label || provider;
    if (!connections[provider]) addModuleIssue(module.code, `${providerLabel} no tiene clave configurada en el servidor.`);
    for (const role of AI_MODEL_ROLES) {
      const override = moduleSettings.modelOverrides?.[role.code];
      if (!override) continue;
      if (!activeRates[provider]?.has(override)) {
        const message = `Falta tarifa vigente para ${override} (${role.label}).`;
        addModuleIssue(module.code, message);
        errors.push(`${module.label}: ${message}`);
      }
    }
  }

  for (const provider of usedProviders) {
    const providerSettings = settings.providers[provider];
    const providerLabel = AI_LLM_PROVIDERS.find((item) => item.code === provider)?.label || provider;
    for (const role of AI_MODEL_ROLES) {
      const model = providerSettings?.models?.[role.code];
      if (!model) {
        const message = `Falta el modelo ${role.label}.`;
        providerIssues[provider] = [...(providerIssues[provider] || []), message];
        errors.push(`${providerLabel}: ${message}`);
      } else if (!activeRates[provider]?.has(model)) {
        const message = `Falta tarifa vigente para ${model} (${role.label}).`;
        providerIssues[provider] = [...(providerIssues[provider] || []), message];
        errors.push(`${providerLabel}: ${message}`);
      }
    }
  }

  for (const module of AI_MODULES) {
    const provider = settings.modules[module.code]?.llmProvider;
    if (module.usesLlm && providerIssues[provider]) {
      for (const issue of providerIssues[provider]) addModuleIssue(module.code, issue);
    }
  }

  return { errors, moduleIssues, providerIssues };
}

// Alerts to raise for the period: one per provider, metric and level.
export function alertCandidates(statuses) {
  const candidates = [];
  for (const status of Object.values(statuses)) {
    for (const metric of status.metrics) {
      if (metric.level === "normal") continue;
      candidates.push({
        provider: status.code,
        providerLabel: status.label,
        metric: metric.code,
        metricLabel: metric.label,
        level: metric.level,
        percent: metric.percent,
      });
    }
  }
  return candidates;
}

function roundPercent(value) {
  return Math.round(Number(value) * 100) / 100;
}

// Plan of per-user percentages of the captured provider balance.
export function normalizeAllocationPlan(raw, version = 0) {
  const source = raw && typeof raw === "object" ? raw : {};
  const users = {};
  for (const [id, value] of Object.entries(source.users || {})) {
    const userId = Number(id);
    const percent = roundPercent(value);
    if (Number.isInteger(userId) && userId > 0 && Number.isFinite(percent) && percent > 0 && percent <= 100) {
      users[userId] = percent;
    }
  }
  const warning = Number(source.warningPercent);
  return {
    version: Number(version) || 0,
    warningPercent: Number.isInteger(warning) && warning >= 1 && warning <= 99 ? warning : 80,
    users,
  };
}

/**
 * Each active user with a percentage gets percent × captured balance and only spends from it.
 * Users without a percentage share the unassigned reserve. Spend from users outside the assigned set
 * (including inactive ones) counts against the reserve, so the total never exceeds the captured balance.
 */
export function computeUserAllocations({ capturedUsd, plan, spentByUser = new Map(), activeUserIds = new Set() }) {
  const captured = Math.max(0, Number(capturedUsd || 0));
  const assigned = new Map(
    Object.entries(plan.users)
      .map(([id, percent]) => [Number(id), percent])
      .filter(([id]) => activeUserIds.has(id)),
  );
  const assignedPercent = roundPercent([...assigned.values()].reduce((sum, value) => sum + value, 0));
  const reservePercent = roundPercent(Math.max(0, 100 - assignedPercent));
  const reserveUsd = (reservePercent / 100) * captured;
  let reserveSpentUsd = 0;
  for (const [userId, spent] of spentByUser) {
    if (!assigned.has(Number(userId))) reserveSpentUsd += Number(spent || 0);
  }
  const reserveAvailableUsd = reserveUsd - reserveSpentUsd;
  const levelFor = (available, consumedPercent) =>
    available <= 0 ? "exhausted" : consumedPercent >= plan.warningPercent ? "warning" : "normal";
  const reserveConsumedPercent = reserveUsd > 0 ? Math.min(100, (reserveSpentUsd / reserveUsd) * 100) : 100;

  const forUser = (userId) => {
    const id = Number(userId);
    const spentUsd = Number(spentByUser.get(id) || 0);
    if (assigned.has(id)) {
      const percent = assigned.get(id);
      const allocatedUsd = (percent / 100) * captured;
      const availableUsd = allocatedUsd - spentUsd;
      const consumedPercent = allocatedUsd > 0 ? Math.min(100, (spentUsd / allocatedUsd) * 100) : 100;
      return {
        userId: id,
        source: "allocation",
        percent,
        allocatedUsd,
        spentUsd,
        availableUsd,
        consumedPercent: Math.round(consumedPercent),
        state: levelFor(availableUsd, consumedPercent),
      };
    }
    return {
      userId: id,
      source: "reserve",
      percent: null,
      allocatedUsd: null,
      spentUsd,
      availableUsd: reserveAvailableUsd,
      consumedPercent: Math.round(reserveConsumedPercent),
      state: levelFor(reserveAvailableUsd, reserveConsumedPercent),
    };
  };

  return {
    capturedUsd: captured,
    assignedPercent,
    reservePercent,
    reserveUsd,
    reserveSpentUsd,
    reserveAvailableUsd,
    reserveState: levelFor(reserveAvailableUsd, reserveConsumedPercent),
    forUser,
  };
}
