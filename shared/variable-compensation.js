// Reglas y cálculo del variable trimestral. Lo usan la API (fuente oficial) y el simulador
// del navegador, para que ambos apliquen exactamente la misma fórmula.

export const DEFAULT_VARIABLE_RULES = {
  payCurrencyCode: "MXN",
  quota: {
    floorPct: 70,
    fullActivationPct: 80,
    targetPct: 100,
    basePay: 80000,
    floorPayPct: 40,
    acceleratorPctPerPoint: 3,
    acceleratorMaxMultiplier: 2,
    acceleratorMinMarginPct: 32,
  },
  margin: { fullPct: 35, partialPct: 32, fullPay: 50000, partialPay: 25000, lowMarginSalePct: 10 },
  team: {
    sellerQuotaPct: 100,
    tiers: [{ minSellers: 3, pay: 9000 }, { minSellers: 4, pay: 18000 }, { minSellers: 5, pay: 30000 }],
  },
  newClients: {
    minAmountPctOfQuota: 10,
    clientMinAmountPctOfQuota: 0.67,
    minClients: 3,
    lookbackMonths: 24,
    pay: 20000,
  },
  existingAccounts: { minGrowthPct: 10, pay: 20000 },
  quarterlyCap: 280000,
};

export const COMPONENT_LABELS = {
  quota: "Cuota de venta",
  margin: "Margen promedio",
  team: "Equipo en cuota",
  newClients: "Clientes nuevos",
  existingAccounts: "Cuentas actuales",
};

const round = (value, digits = 2) => Number(Number(value || 0).toFixed(digits));
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

const NUMERIC_FIELDS = {
  quota: ["floorPct", "fullActivationPct", "targetPct", "basePay", "floorPayPct", "acceleratorPctPerPoint", "acceleratorMaxMultiplier", "acceleratorMinMarginPct"],
  margin: ["fullPct", "partialPct", "fullPay", "partialPay", "lowMarginSalePct"],
  team: ["sellerQuotaPct"],
  newClients: ["minAmountPctOfQuota", "clientMinAmountPctOfQuota", "minClients", "lookbackMonths", "pay"],
  existingAccounts: ["minGrowthPct", "pay"],
};

// Devuelve las reglas normalizadas o la lista de errores en español; nunca lanza.
export function validateVariableRules(input) {
  const errors = [];
  const source = input && typeof input === "object" ? input : {};
  const rules = { payCurrencyCode: String(source.payCurrencyCode || "").trim().toUpperCase() };
  if (!/^[A-Z]{3}$/.test(rules.payCurrencyCode)) errors.push("La moneda de pago debe tener 3 letras");

  for (const [group, fields] of Object.entries(NUMERIC_FIELDS)) {
    rules[group] = {};
    for (const field of fields) {
      const value = source[group]?.[field];
      if (!isNumber(value) || value < 0) errors.push(`${group}.${field} debe ser un número no negativo`);
      else rules[group][field] = value;
    }
  }
  const tiers = Array.isArray(source.team?.tiers) ? source.team.tiers : [];
  rules.team.tiers = tiers.map((tier) => ({ minSellers: tier?.minSellers, pay: tier?.pay }));
  if (!tiers.length || tiers.length > 20 || rules.team.tiers.some((tier) =>
    !Number.isInteger(tier.minSellers) || tier.minSellers < 1 || !isNumber(tier.pay) || tier.pay < 0)) {
    errors.push("Los niveles de equipo requieren vendedores mínimos enteros y un pago no negativo");
  } else {
    rules.team.tiers.sort((left, right) => left.minSellers - right.minSellers);
    if (new Set(rules.team.tiers.map((tier) => tier.minSellers)).size !== rules.team.tiers.length) {
      errors.push("Los niveles de equipo no pueden repetir vendedores mínimos");
    }
  }
  rules.quarterlyCap = source.quarterlyCap;
  if (!isNumber(rules.quarterlyCap) || rules.quarterlyCap < 0) errors.push("El tope trimestral debe ser un número no negativo");

  if (!errors.length) {
    const { quota, margin, newClients } = rules;
    if (!(quota.floorPct <= quota.fullActivationPct && quota.fullActivationPct <= quota.targetPct)) {
      errors.push("Los umbrales de cuota deben cumplir piso ≤ activación completa ≤ meta");
    }
    if (quota.targetPct <= quota.floorPct) errors.push("La meta de cuota debe ser mayor al piso");
    if (quota.floorPayPct > 100) errors.push("El pago en el piso no puede superar 100% del pago base");
    if (quota.acceleratorMaxMultiplier < 1) errors.push("El multiplicador máximo del acelerador debe ser al menos 1");
    if (margin.partialPct > margin.fullPct) errors.push("El margen parcial no puede superar al margen completo");
    if (margin.fullPct > 100 || margin.lowMarginSalePct > 100) errors.push("Los porcentajes de margen no pueden superar 100");
    if (!Number.isInteger(newClients.minClients) || !Number.isInteger(newClients.lookbackMonths) || newClients.lookbackMonths < 1 || newClients.lookbackMonths > 120) {
      errors.push("Los clientes mínimos y los meses de historial deben ser enteros válidos (historial de 1 a 120 meses)");
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, rules };
}

export function tierPay(rules, sellersInQuota) {
  return rules.team.tiers.reduce((pay, tier) => (sellersInQuota >= tier.minSellers ? tier.pay : pay), 0);
}

// Cuota de un cliente nuevo: monto mínimo del trimestre y cuántos clientes superan el mínimo individual.
export function evaluateNewClients(rules, { newSalesAmount, quotaAmount, accountAmounts }) {
  const settings = rules.newClients;
  const requiredAmount = round(quotaAmount * settings.minAmountPctOfQuota / 100);
  const clientMinAmount = round(quotaAmount * settings.clientMinAmountPctOfQuota / 100);
  const qualifyingClients = accountAmounts.filter((amount) => amount >= clientMinAmount && clientMinAmount > 0).length;
  const amountMet = requiredAmount > 0 && newSalesAmount >= requiredAmount;
  const clientsMet = qualifyingClients >= settings.minClients;
  return {
    amount: round(newSalesAmount), requiredAmount, clientMinAmount,
    qualifyingClients, requiredClients: settings.minClients, amountMet, clientsMet,
    met: amountMet && clientsMet,
  };
}

// Crecimiento de venta a cuentas existentes contra el mismo trimestre del año anterior.
export function evaluateGrowth(rules, { currentAmount, baselineAmount }) {
  if (!(baselineAmount > 0)) {
    return { available: false, growthPct: null, met: null, currentAmount: round(currentAmount), baselineAmount: baselineAmount == null ? null : round(baselineAmount) };
  }
  const growthPct = round((currentAmount / baselineAmount - 1) * 100, 1);
  return {
    available: true, growthPct, met: growthPct >= rules.existingAccounts.minGrowthPct,
    currentAmount: round(currentAmount), baselineAmount: round(baselineAmount),
  };
}

function quotaPay(rules, attainmentPct, marginPct) {
  const { quota } = rules;
  if (attainmentPct < quota.floorPct) return { pay: 0, note: `No se paga: la cuota está bajo el ${quota.floorPct}%` };
  if (attainmentPct <= quota.targetPct) {
    const span = quota.targetPct - quota.floorPct;
    const fraction = quota.floorPayPct / 100 + (1 - quota.floorPayPct / 100) * (attainmentPct - quota.floorPct) / span;
    return { pay: quota.basePay * fraction, note: "Pago proporcional entre el piso y la meta" };
  }
  if (marginPct == null || marginPct < quota.acceleratorMinMarginPct) {
    return { pay: quota.basePay, note: `Acelerador bloqueado: el margen es menor a ${quota.acceleratorMinMarginPct}%` };
  }
  const multiplier = Math.min(quota.acceleratorMaxMultiplier, 1 + quota.acceleratorPctPerPoint / 100 * (attainmentPct - quota.targetPct));
  return { pay: quota.basePay * multiplier, note: "Acelerador activo sobre la meta" };
}

// Calcula el variable del trimestre. `newClientsMet` y `existingAccountsMet` pueden ser null
// cuando no hay información para evaluarlos; en ese caso no pagan y se marcan sin datos.
export function calculateVariable(rules, input) {
  const attainmentPct = isNumber(input.attainmentPct) ? input.attainmentPct : 0;
  const marginPct = isNumber(input.marginPct) ? input.marginPct : null;
  const sellersInQuota = Number(input.sellersInQuota || 0);
  const floorReached = attainmentPct >= rules.quota.floorPct;
  const fullActivation = attainmentPct >= rules.quota.fullActivationPct;
  const lockedNote = `Se activa con ${rules.quota.fullActivationPct}% de la cuota`;
  const maxTierPay = Math.max(0, ...rules.team.tiers.map((tier) => tier.pay));

  const quota = quotaPay(rules, attainmentPct, marginPct);
  const marginPay = marginPct == null ? 0 : marginPct >= rules.margin.fullPct ? rules.margin.fullPay
    : marginPct >= rules.margin.partialPct ? rules.margin.partialPay : 0;
  const teamPay = tierPay(rules, sellersInQuota);
  const gated = (met, pay) => (fullActivation && met ? pay : 0);

  const components = [
    {
      key: "quota", pay: round(quota.pay), max: rules.quota.basePay, note: quota.note,
      state: attainmentPct >= rules.quota.targetPct ? "ok" : floorReached ? "warn" : "bad",
    },
    {
      key: "margin", pay: round(floorReached ? marginPay : 0), max: rules.margin.fullPay,
      note: !floorReached ? `No se paga: la cuota está bajo el ${rules.quota.floorPct}%`
        : marginPct == null ? "Sin ventas para calcular el margen"
          : marginPay === 0 ? `No se paga: el margen es menor a ${rules.margin.partialPct}%`
            : marginPay === rules.margin.fullPay ? "Margen completo" : "Margen parcial",
      state: marginPct != null && marginPct >= rules.margin.fullPct ? "ok" : marginPct != null && marginPct >= rules.margin.partialPct ? "warn" : "bad",
    },
    {
      key: "team", pay: round(gated(true, teamPay)), max: maxTierPay,
      note: !fullActivation ? lockedNote : teamPay === 0 ? "No se paga: no se alcanza el mínimo de vendedores en cuota" : "Pago por vendedores en cuota",
      state: !fullActivation ? "off" : teamPay > 0 && teamPay === maxTierPay ? "ok" : teamPay > 0 ? "warn" : "bad",
    },
    {
      key: "newClients", pay: round(gated(input.newClientsMet === true, rules.newClients.pay)), max: rules.newClients.pay,
      note: !fullActivation ? lockedNote : input.newClientsMet == null ? "Sin datos" : input.newClientsMet ? "Meta cumplida" : "Faltan monto o clientes",
      state: !fullActivation || input.newClientsMet == null ? "off" : input.newClientsMet ? "ok" : "warn",
    },
    {
      key: "existingAccounts", pay: round(gated(input.existingAccountsMet === true, rules.existingAccounts.pay)), max: rules.existingAccounts.pay,
      note: !fullActivation ? lockedNote : input.existingAccountsMet == null ? "Sin base del año anterior para comparar" : input.existingAccountsMet ? "Meta cumplida" : "Crecimiento por debajo de la meta",
      state: !fullActivation || input.existingAccountsMet == null ? "off" : input.existingAccountsMet ? "ok" : "warn",
    },
  ].map((component) => ({
    ...component, label: COMPONENT_LABELS[component.key], max: round(component.max),
    locked: component.key === "quota" ? false : component.key === "margin" ? !floorReached : !fullActivation,
  }));

  const rawTotal = round(components.reduce((sum, component) => sum + component.pay, 0));
  const total = Math.min(rawTotal, rules.quarterlyCap);
  return {
    floorReached, fullActivation, components, rawTotal, total: round(total), capped: rawTotal > rules.quarterlyCap,
    maxTotal: round(Math.min(
      components.reduce((sum, component) => sum + component.max, 0)
        + rules.quota.basePay * (rules.quota.acceleratorMaxMultiplier - 1),
      rules.quarterlyCap,
    )),
  };
}
