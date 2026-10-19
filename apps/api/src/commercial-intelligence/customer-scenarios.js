import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { customerDateOnly, customerScenarioSpecPatch, customerScenarioSpecSchema } from "./turn-contract.js";
import { describeCustomerOpportunityFilters, filterCustomerRecords, normalizeCustomerSearchText, resolveCustomerListSpec, validateCustomerRecordList } from "./customer-record-list.js";
import { FINANCIAL_UNAVAILABLE } from "./customer-trends.js";

const continuing = (movement) => ["continue", "correct", "answer_clarification", "select_candidate", "request_rationale"].includes(movement);
const statuses = { en_proceso: "En proceso", ganada: "Ganada", perdida: "Perdida", anulada: "Anulada" };
const response = (answer, responseType = "informational", extra = {}) => ({
  answer, responseType, operations: [], recommendedActions: [], evidence: [], inferences: [], pendingItems: [],
  source: "account_intelligence", confidence: "medium", ...extra,
});
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = (error, responseType = "clarification") => ({ error, responseType });
export function validateCustomerScenarioMemory(value, snapshot) {
  if (!value || value.accountId !== Number(snapshot.account?.id) || snapshot.permissions?.canReadOpportunities === false ||
      !Array.isArray(value.ids) || !value.ids.length || value.ids.length > 10000 ||
      value.ids.some((id) => !Number.isSafeInteger(id) || id <= 0) || new Set(value.ids).size !== value.ids.length ||
      typeof value.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.fingerprint)) return null;
  const spec = customerScenarioSpecSchema.safeParse(value.spec);
  if (!spec.success || spec.data.unsupported?.length || spec.data.clarification ||
      !spec.data.set || !spec.data.alternatives?.length || spec.data.mode !== "analyze" ||
      (spec.data.set === "named" && !spec.data.references?.length) || typeof value.observedAt !== "string" ||
      !Number.isFinite(Date.parse(value.observedAt))) return null;
  return { accountId: value.accountId, ids: value.ids, spec: spec.data, fingerprint: value.fingerprint, observedAt: value.observedAt };
}

export function resolveCustomerScenarioRequest({ component, movement, previous, previousList, snapshot, context, now }) {
  const parsed = customerScenarioSpecSchema.safeParse(component.scenarioSpec || {});
  if (!parsed.success) return fail("La especificación del escenario contiene valores inválidos.");
  const patch = customerScenarioSpecPatch(parsed.data);
  if (patch.mode === "financial") return fail(FINANCIAL_UNAVAILABLE, "informational");
  if (patch.clarification) return fail(patch.clarification);
  if (patch.unsupported?.length) return fail(`No puedo acreditar: ${patch.unsupported.join(", ")}. No inventaré probabilidades, autorizaciones ni pronósticos.`, "informational");
  if (!["account", "opportunity"].includes(component.object)) return fail("Los escenarios comerciales se analizan sobre la cuenta o sus oportunidades.", "informational");
  if (!snapshot.account?.id || Number(snapshot.account.id) !== Number(context.accountId)) return fail("Selecciona una cuenta autorizada.");
  if (patch.accountReference && normalizeCustomerSearchText(patch.accountReference) !== normalizeCustomerSearchText(snapshot.account.name)) return fail("El escenario está limitado a la cuenta seleccionada.");
  const prior = continuing(movement) ? previous : null;
  if (patch.mode === "reset") return { reset: true };
  if (component.listPosition > 0) return fail("Una fila de simulación no identifica un registro real por ordinal. Indica los nombres.");
  if (["explain", "refresh", "compare"].includes(patch.mode) && !prior && !patch.alternatives?.length) return fail("No hay un escenario anterior verificable. Indica los supuestos y el conjunto.");
  if (!prior && patch.edit && patch.edit !== "replace") return fail("No hay escenario anterior al que añadir o quitar supuestos.");
  let references = patch.references ?? (component.object === "opportunity" && component.reference ? [component.reference] : prior?.spec.references || []);
  const set = patch.set || (references.length ? "named" : prior?.spec.set);
  if (component.object === "account" && component.reference &&
      normalizeCustomerSearchText(component.reference) !== normalizeCustomerSearchText(snapshot.account.name)) return fail("El nombre de cuenta no corresponde a la seleccionada.");
  if (!set || (set === "named" && !references.length)) return fail("Indica las oportunidades o solicita explícitamente toda la cuenta; no ampliaré el conjunto.");
  if (set === "account" && Object.hasOwn(patch, "references") && references.length) return fail("Elige toda la cuenta o un conjunto nombrado, no ambos.");
  if (set === "account") references = [];
  let alternatives = patch.alternatives ?? prior?.spec.alternatives;
  if (patch.edit === "append" && patch.alternatives) {
    alternatives = structuredClone(prior.spec.alternatives);
    for (const alternative of patch.alternatives) {
      const existing = alternatives.find((item) => normalizeCustomerSearchText(item.name) === normalizeCustomerSearchText(alternative.name));
      if (existing) { existing.changes.push(...alternative.changes); existing.assumptions.push(...alternative.assumptions); }
      else alternatives.push(alternative);
    }
  }
  if (patch.edit === "remove") {
    if (!patch.alternatives?.length) return fail("Indica las alternativas que deseas quitar.");
    const names = patch.alternatives.map((item) => normalizeCustomerSearchText(item.name));
    if (names.some((name) => !prior.spec.alternatives.some((item) => normalizeCustomerSearchText(item.name) === name))) return fail("Una alternativa indicada no existe en el escenario anterior.");
    alternatives = prior.spec.alternatives.filter((item) => !names.includes(normalizeCustomerSearchText(item.name)));
  }
  if (!alternatives?.length) return fail("Indica al menos un supuesto; para abandonar la simulación solicita volver a los datos reales.");
  const names = alternatives.map((item) => normalizeCustomerSearchText(item.name));
  if (new Set(names).size !== names.length) return fail("Las alternativas deben tener nombres distintos.");
  const spec = { set, references, alternatives, mode: "analyze",
    granularity: patch.granularity || prior?.spec.granularity || "month",
    ...(patch.period || prior?.spec.period ? { period: patch.period || prior.spec.period } : {}),
  };
  if (patch.listSpec && set !== "filtered") return fail("Los filtros requieren selección filtrada explícita; no recortaré toda la cuenta o los nombres silenciosamente.");
  if (set === "filtered") {
    const list = resolveCustomerListSpec({ object: "opportunity", listSpec: patch.listSpec || {} },
      prior?.spec.listSpec ? { object: "opportunity", spec: prior.spec.listSpec } : null, movement, snapshot.account);
    if (list.error) return fail(list.error);
    if (list.spec.limit) return fail("El escenario filtrado no recorta un top silenciosamente. Usa nombres o un listado previo para un subconjunto.");
    if (![list.spec.statusCodes, list.spec.stageCodes, list.spec.textFilters, list.spec.amountFilters, list.spec.closeDateFilters].some((items) => items.length) &&
        list.spec.activation === "all") return fail("Indica filtros explícitos o solicita toda la cuenta; no ampliaré el conjunto.");
    spec.listSpec = list.spec;
  }
  if (!customerScenarioSpecSchema.safeParse(spec).success) return fail("Máximo tres alternativas, cinco cambios y cinco supuestos por alternativa.");
  for (const alternative of alternatives) {
    if (!alternative.changes.length && !alternative.assumptions.length) return fail("Una alternativa no contiene supuestos ni cambios.");
    if (alternative.assumptions.some((item) => item.budgetUsd !== -1 && (item.budgetUsd < 0 || cents(item.budgetUsd) === null))) return fail("Indica un presupuesto USD válido con máximo dos decimales, o aclara que no está informado.");
    for (const change of alternative.changes) {
      if (change.kind === "amount_percent" && (change.unit !== "percent" || change.value < -100 || Math.abs(change.value * 10000 - Math.round(change.value * 10000)) > 0.000001)) return fail("Usa un porcentaje válido de hasta cuatro decimales; una reducción no puede superar 100 %.");
      if (["amount_set", "amount_delta"].includes(change.kind) && (change.unit !== "USD" || (change.kind === "amount_set" && change.value < 0) || cents(change.value) === null)) return fail("Indica un importe válido en USD con máximo dos decimales.");
      if (change.kind === "close_shift" && (!["days", "months", "quarters"].includes(change.unit) || !Number.isInteger(change.value) || Math.abs(change.value) > 3650)) return fail("Indica un desplazamiento entero válido en días, meses o trimestres.");
      if (change.kind === "close_set" && !validDay(change.date)) return fail("La fecha hipotética debe existir y tener formato AAAA-MM-DD.");
    }
  }
  if (spec.period && (spec.period.mode !== "absolute" || !validDay(spec.period.startDate) || !validDay(spec.period.endDate) ||
      spec.period.startDate > spec.period.endDate || (Date.parse(spec.period.endDate) - Date.parse(spec.period.startDate)) / 86400000 > 366 * 5)) return fail("Indica un periodo absoluto válido de hasta cinco años para distribuir el pipeline.");
  if (patch.mode === "explain" && prior && !isDeepStrictEqual(spec, prior.spec)) return { ...fail("Explicar conserva los criterios del escenario anterior. Solicita cambiar o actualizar el escenario por separado."), previous: prior };
  const explicitSet = Object.hasOwn(patch, "set") || Object.hasOwn(patch, "references") || Object.hasOwn(patch, "listSpec") || Boolean(component.object === "opportunity" && component.reference);
  const list = set === "previous_list" && (!prior || explicitSet) ? validateCustomerRecordList(previousList, snapshot, snapshot.account.id) : null;
  if (set === "previous_list" && (!prior || explicitSet) && (!list || list.object !== "opportunity")) return fail("No hay un listado previo de oportunidades verificable. Vuelve a listar o indica los nombres.");
  return { spec, accountId: Number(snapshot.account.id), previous: prior, mode: patch.mode || "analyze",
    lockedIds: list ? list.ids : prior && !explicitSet && !["account", "filtered"].includes(set) ? prior.ids : null, now };
}

function validDay(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= "1000-01-01" && value <= "9999-12-31" &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
function cents(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value);
  if (!/^\d{1,13}(?:\.\d{1,2})?$/.test(text.replace(/^-/, ""))) return null;
  const negative = text.startsWith("-"), [whole, fraction = ""] = text.replace(/^-/, "").split(".");
  return BigInt(`${negative ? "-" : ""}${whole}${fraction.padEnd(2, "0")}`);
}
function money(value) {
  if (value === null) return "No registrado";
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}USD ${(absolute / 100n).toLocaleString("es-MX")}.${String(absolute % 100n).padStart(2, "0")}`;
}
function shiftDate(day, change) {
  const date = new Date(`${day}T00:00:00Z`);
  if (change.unit === "days") date.setUTCDate(date.getUTCDate() + change.value);
  else {
    const originalDay = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + change.value * (change.unit === "quarters" ? 3 : 1));
    const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(originalDay, end));
  }
  return date.toISOString().slice(0, 10);
}
const qualitative = {
  approval: ["Una aprobación hipotética no acredita firma, compra ni cierre ganado.", "Validar alcance, autoridad del aprobador y condiciones pendientes antes de preparar el cierre."],
  budget: ["Una restricción presupuestaria puede exigir revisar alcance o fases; no acredita un descuento autorizado.", "Confirmar presupuesto y prioridades; explorar fases o alternativas sin prometer viabilidad técnica ni margen."],
  delay: ["Un retraso hipotético puede cambiar la secuencia de seguimiento; no demuestra pérdida de interés.", "Confirmar motivo, nueva fecha de decisión y vigencia de la propuesta antes de reprogramar acciones."],
  competition: ["La presencia hipotética de competencia no acredita pérdida ni superioridad de una oferta.", "Validar criterios de decisión y diferencias comprobables; no inventar precios o capacidades del competidor."],
  other: ["El supuesto no está confirmado en el CRM y sus consecuencias dependen de información que debe validarse.", "Validar el supuesto, sus restricciones y responsables antes de tomar una decisión comercial."],
};
export function buildCustomerScenarioResponse({ request, data }) {
  if (data.complete !== true) return response("La lectura del escenario está incompleta; no se presentan totales truncados.", "error");
  const all = data.opportunities.filter((item) => Number(item.account_id) === request.accountId);
  if (all.length !== data.opportunities.length) return response("La lectura del escenario contiene registros fuera de la cuenta autorizada.", "error");
  let selected;
  if (request.lockedIds) {
    selected = request.lockedIds.map((id) => all.find((item) => Number(item.id) === id));
    if (selected.some((item) => !item)) return response("El conjunto anterior ya no está completamente autorizado. Indica uno nuevo.", "clarification");
  } else if (request.spec.set === "account" || request.spec.set === "filtered") selected = all;
  else {
    selected = [];
    for (const name of request.spec.references) {
      const matches = all.filter((item) => normalizeCustomerSearchText(item.name) === normalizeCustomerSearchText(name));
      if (matches.length !== 1) return response("No pude resolver todas las oportunidades inequívocamente. Precisa los nombres; no simularé solo las restantes.", "clarification");
      selected.push(matches[0]);
    }
  }
  if (request.spec.listSpec) {
    const eligible = filterCustomerRecords(selected.map((item) => ({
      id: item.id, name: item.name, amountUsd: item.amount_usd === null ? null : Number(item.amount_usd),
      closeDate: item.close_date, commercialStatusCode: item.commercial_status_code,
      activationStatusCode: item.activation_status_code, stageCode: item.stage_code,
    })), "opportunity", request.spec.listSpec);
    const ids = new Set(eligible.map((item) => item.id));
    selected = selected.filter((item) => ids.has(item.id));
  }
  if (!selected.length) return response("No hay oportunidades autorizadas en el conjunto; no se acredita un pipeline global vacío.", "clarification");
  if (new Set(selected.map((item) => Number(item.id))).size !== selected.length) return response("Una oportunidad está repetida en la selección. Corrige el conjunto.", "clarification");
  const base = selected.map((item) => ({
    id: Number(item.id), name: item.name, amount: cents(item.amount_usd), close: customerDateOnly(item.close_date),
    status: item.commercial_status_code, activation: item.activation_status_code,
  }));
  if (base.some((item) => item.amount !== null && item.amount < 0n)) return response("La base real contiene un importe negativo no válido; verifica el dato antes de simular.", "error");
  if (base.some((item) => !statuses[item.status] || !["activada", "desactivada", "pendiente_activacion"].includes(item.activation))) return response("El estado de una oportunidad no es verificable; no simularé con valores predeterminados.", "error");
  const fingerprint = digest(base.map((item) => ({ ...item, amount: item.amount?.toString() ?? null })));
  const changed = request.previous && fingerprint !== request.previous.fingerprint;
  if (changed && request.mode !== "refresh") return response(
    "La base real cambió desde el escenario anterior. Solicita actualizar antes de explicar o recalcular; no mezclaré ambas bases.",
    "clarification", { scenarioMemory: request.previous });
  const tables = [], notes = [], reasons = [], assumptions = [], guidance = [];
  const numericRows = [];
  const summaryRows = [];
  const variants = [{ name: "Base registrada", rows: base }];
  for (const alternative of request.spec.alternatives) {
    const rows = base.map((item) => ({ ...item }));
    for (const change of alternative.changes) {
      let targets = rows;
      if (change.references.length) {
        targets = [];
        for (const name of change.references) {
          const matches = rows.filter((item) => normalizeCustomerSearchText(item.name) === normalizeCustomerSearchText(name));
          if (matches.length !== 1) return response("Un cambio no identifica una oportunidad única dentro del conjunto. Precisa el destino.", "clarification");
          targets.push(matches[0]);
        }
        if (new Set(targets.map((item) => item.id)).size !== targets.length) return response("Un cambio repite su destino; no aplicaré dos veces la transformación.", "clarification");
      }
      for (const target of targets) {
        if (change.kind.startsWith("amount_")) {
          if (change.kind !== "amount_set" && target.amount === null) return response(`No hay importe válido para calcular sobre ${target.name}. Indica una base o un importe hipotético absoluto.`, "clarification");
          if (change.kind === "amount_set") target.amount = cents(change.value);
          if (change.kind === "amount_delta") target.amount += cents(change.value);
          if (change.kind === "amount_percent") {
            const numerator = target.amount * (1000000n + BigInt(Math.round(change.value * 10000)));
            target.amount = (numerator + 500000n) / 1000000n;
          }
          if (target.amount < 0n || target.amount > 999999999999999n) return response("El escenario produce un importe negativo o fuera del rango permitido. Ajusta el supuesto.", "clarification");
        } else if (change.kind === "close_set") target.close = change.date;
        else if (change.kind === "close_shift") {
          if (!validDay(target.close)) return response(`No hay fecha de cierre válida para desplazar ${target.name}. Indica una fecha base.`, "clarification");
          target.close = shiftDate(target.close, change);
          if (!validDay(target.close)) return response("El desplazamiento produce una fecha fuera del rango válido.", "clarification");
        } else target.status = change.status;
      }
      assumptions.push(`${alternative.name}: ${change.kind} ${change.kind === "close_set" ? change.date : change.kind === "status_set" ? statuses[change.status] : `${change.value} ${change.unit}`}; destino: ${change.references.join(", ") || "conjunto seleccionado"}.`);
      guidance.push(`${alternative.name} — ${targets.length} oportunidades afectadas: ${
        change.kind.startsWith("amount_")
          ? "El importe calculado es comercial, no presupuesto ni descuento aprobado. Antes de ofrecerlo, validar alcance, condiciones, costos y autorización; considerar fases sin asumir viabilidad."
          : change.kind.startsWith("close_")
            ? "El desplazamiento calculado no acredita una nueva fecha acordada. Confirmar fecha de decisión, vigencia de cotización, dependencias y disponibilidad antes de reprogramar."
            : "El estado supuesto modifica la distribución comercial, no acredita cierre real ni cobro. Verificar los requisitos del estado y evidencia de decisión antes de solicitar un cambio real."
      }`);
    }
    for (const assumption of alternative.assumptions) {
      assumptions.push(`${alternative.name} — supuesto aportado: ${assumption.statement}${assumption.budgetUsd === -1 ? "" : `; presupuesto aportado: ${money(cents(assumption.budgetUsd))}`}.`);
      guidance.push(`${alternative.name}: ${qualitative[assumption.kind].join(" ")}`);
      if (assumption.kind === "budget" && assumption.budgetUsd === -1) notes.push("Presupuesto no informado: no se usa el importe de oportunidad como presupuesto del cliente.");
    }
    variants.push({ name: alternative.name, rows });
    for (let i = 0; i < rows.length; i += 1) {
      const before = base[i], after = rows[i];
      numericRows.push([alternative.name, after.name, money(before.amount), money(after.amount),
        before.amount === null || after.amount === null ? "No calculable" : money(after.amount - before.amount),
        before.close || "Sin fecha", after.close || "Sin fecha", `${statuses[before.status]} → ${statuses[after.status]}`]);
    }
  }
  for (const variant of variants) {
    for (const status of Object.keys(statuses)) {
      const items = variant.rows.filter((item) => item.status === status);
      const missing = items.some((item) => item.amount === null);
      if (missing) reasons.push(`${variant.name}: hay importes no registrados; las sumas son solo de valores conocidos.`);
      summaryRows.push([variant.name, statuses[status], String(items.length), money(items.reduce((sum, item) => sum + (item.amount ?? 0n), 0n)), missing ? "Importe parcial" : "Conjunto autorizado"]);
    }
  }
  tables.push({ title: "Situación registrada y alternativas hipotéticas", headers: ["Alternativa", "Oportunidad", "Importe real", "Importe hipotético", "Diferencia", "Cierre real", "Cierre hipotético", "Estado real → hipotético"], rows: numericRows.slice(0, 500) });
  if (numericRows.length > 500) reasons.push(`Presentación limitada a 500 de ${numericRows.length} filas; los totales incluyen todo el conjunto.`);
  tables.push({ title: "Distribución comercial — no facturación", headers: ["Serie", "Estado", "Oportunidades", "Importe registrado USD", "Cobertura"], rows: summaryRows });
  if (request.spec.period) {
    const period = request.spec.period, pipeline = [], distributions = [];
    for (const variant of variants) {
      const groups = new Map();
      for (const item of variant.rows.filter((row) => row.status === "en_proceso" && row.activation === "activada")) {
        const day = item.close;
        const key = !validDay(day) ? "Sin fecha" : day < period.startDate || day > period.endDate ? "Fuera del periodo" :
          request.spec.granularity === "year" ? day.slice(0, 4) : request.spec.granularity === "quarter"
            ? `${day.slice(0, 4)}-T${Math.ceil(Number(day.slice(5, 7)) / 3)}` : day.slice(0, 7);
        if (!groups.has(key)) groups.set(key, { count: 0, amount: 0n, missing: false });
        const group = groups.get(key);
        group.count += 1; group.amount += item.amount ?? 0n; group.missing ||= item.amount === null;
      }
      if (!groups.size) pipeline.push([variant.name, "Sin oportunidades abiertas activadas", "0", money(0n), "Conjunto autorizado"]);
      for (const [key, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) pipeline.push([variant.name, key, String(group.count), money(group.amount), group.missing ? "Importe parcial" : "Distribución por cierre previsto"]);
      distributions.push({ name: variant.name, groups });
    }
    tables.push({ title: `Pipeline hipotético ${period.startDate} — ${period.endDate}`, headers: ["Serie", "Periodo", "Oportunidades", "Importe USD", "Fundamento"], rows: pipeline });
    const contrasts = [];
    const empty = { count: 0, amount: 0n, missing: false };
    const real = distributions[0].groups;
    for (const variant of distributions.slice(1)) {
      for (const key of [...new Set([...real.keys(), ...variant.groups.keys()])].sort()) {
        const before = real.get(key) || empty, after = variant.groups.get(key) || empty;
        contrasts.push([variant.name, key, `${before.count} → ${after.count}`, String(after.count - before.count),
          before.missing || after.missing ? "No calculable: importe parcial" : money(after.amount - before.amount)]);
      }
    }
    tables.push({ title: "Cambio del pipeline respecto de la misma base real", headers: ["Alternativa", "Periodo", "Cantidad real → hipotética", "Diferencia cantidad", "Diferencia USD"], rows: contrasts });
  }
  const evidence = [
    `Base real consultada: ${request.now.toISOString()}; ${base.length} oportunidades actualmente autorizadas.`,
    ...(request.spec.listSpec ? [describeCustomerOpportunityFilters(request.spec.listSpec)] : []),
    "Cada alternativa parte de la misma base real. Los cambios dentro de una alternativa se aplican en el orden indicado.",
    "Importes en centavos USD; redondeo al centavo más próximo, mitad hacia arriba, en cada transformación.",
    "Meses y trimestres: conservar día si existe; de lo contrario ajustar al último día. Días: calendario, no hábiles.",
    ...(request.spec.period ? ["Pipeline: En proceso y activadas, agrupadas por cierre previsto; sin fecha y fuera de periodo se muestran por separado."] : []),
    ...notes, ...reasons,
  ];
  const memory = { accountId: request.accountId, ids: base.map((item) => item.id), spec: request.spec, fingerprint, observedAt: request.now.toISOString() };
  const conciseResult = numericRows.length === 1
    ? `Resultado para ${numericRows[0][1]}: importe ${numericRows[0][2]} → ${numericRows[0][3]} (${numericRows[0][4]}); cierre ${numericRows[0][5]} → ${numericRows[0][6]}; estado ${numericRows[0][7]}.`
    : "Los resultados por oportunidad y las diferencias están en las tablas.";
  return response([
    "ESCENARIO HIPOTÉTICO; no modifica el CRM ni confirma aprobación, descuento autorizado o cierre real.",
    ...(request.mode === "refresh" ? [`Base actualizada: ${changed ? "cambió" : "sin cambios"}.`] : []),
    ...assumptions.map((item) => `Supuesto: ${item}`),
    conciseResult,
    ...(guidance.length ? guidance : [
      "El cálculo no indica una mayor probabilidad de venta. Confirma condiciones y autorizaciones antes de decidir.",
    ]),
    ...(request.spec.listSpec ? [describeCustomerOpportunityFilters(request.spec.listSpec)] : []),
    ...notes, ...reasons,
    "Facturación e ingresos contables no están disponibles. No se infieren probabilidades ni ventas garantizadas.",
    "El detalle completo, los datos base y los límites están en las tablas y el apartado de fundamento.",
  ].join("\n"), "informational", {
    scenarioMemory: memory, scenarioMetadata: { hypothetical: true, partial: reasons.length > 0, reasons, tables, assumptions, observedAt: memory.observedAt },
    scenarioEvidence: evidence, evidence, confidence: reasons.length ? "medium" : "high",
    entities: { accountId: request.accountId, opportunityId: null, contactId: null },
  });
}
