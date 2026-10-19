import { customerDateOnly, customerTrendSpecPatch, customerTrendSpecSchema } from "./turn-contract.js";
import { customerHistoryDate, resolveCustomerHistoryPeriod } from "./customer-history.js";
import { normalizeCustomerSearchText } from "./customer-record-list.js";
import { HISTORY_FIELDS } from "./opportunity-history-store.js";
import { createHash } from "node:crypto";

export const FINANCIAL_UNAVAILABLE = "La opción de consultar y analizar facturación, ingresos contables, cobros, pagos y saldos por cobrar aún no está disponible en este chat. Los importes y cierres comerciales de oportunidades no sustituyen esa información.";
const continuing = (movement) => ["continue", "correct", "answer_clarification", "request_rationale", "select_candidate"].includes(movement);
const response = (answer, responseType = "informational", extra = {}) => ({
  answer, responseType, operations: [], evidence: [], inferences: [], recommendedActions: [], pendingItems: [],
  source: "account_intelligence", confidence: "medium", ...extra,
});
const utc = (value) => value instanceof Date ? value.toISOString() :
  typeof value === "string" ? `${value.replace(" ", "T").replace(/Z$/, "")}Z` : null;
const parseJson = (value) => typeof value === "string" ? JSON.parse(value) : value;
const number = (value) => value === null || value === undefined ? null : Number(value);
function normalizedState(value) {
  if (!value) return null;
  const date = (item) => item instanceof Date
    ? `${item.getFullYear()}-${String(item.getMonth() + 1).padStart(2, "0")}-${String(item.getDate()).padStart(2, "0")} ${String(item.getHours()).padStart(2, "0")}:${String(item.getMinutes()).padStart(2, "0")}:${String(item.getSeconds()).padStart(2, "0")}`
    : typeof item === "string" ? item.replace("T", " ").slice(0, 19) : item ?? null;
  return Object.fromEntries(HISTORY_FIELDS.map((key) => [key,
    ["created_at", "commercial_closed_at"].includes(key) ? date(value[key]) :
      key === "close_date" ? value[key] instanceof Date ? date(value[key]).slice(0, 10) : value[key] ?? null :
        key === "name" ? value[key] ?? null : number(value[key])]));
}
const equal = (a, b) => JSON.stringify(normalizedState(a)) === JSON.stringify(normalizedState(b));
function stateMatches(state, request, data) {
  if (!state || Number(state.account_id) !== request.accountId) return false;
  const code = (list, id) => list.find((item) => Number(item.id) === Number(id))?.code;
  const filters = request.spec.filters;
  return (!filters.stageCodes.length || filters.stageCodes.includes(code(data.stages, state.sales_stage_id))) &&
    (!filters.statusCodes.length || filters.statusCodes.includes(code(data.commercialStatuses, state.commercial_status_id))) &&
    (filters.activation === "all" || (code(data.activationStatuses, state.activation_status_id) === "activada") === (filters.activation === "active"));
}
function buckets(range, granularity, now, timezone) {
  const today = customerHistoryDate(now, timezone), result = [];
  let day = range.startDate;
  while (day <= range.endDate) {
    const date = new Date(`${day}T00:00:00Z`);
    let end;
    if (granularity === "year") end = `${day.slice(0, 4)}-12-31`;
    else if (["month", "quarter"].includes(granularity)) {
      const size = granularity === "quarter" ? 3 : 1;
      const month = granularity === "quarter" ? Math.floor(date.getUTCMonth() / 3) * 3 : date.getUTCMonth();
      end = new Date(Date.UTC(date.getUTCFullYear(), month + size, 0)).toISOString().slice(0, 10);
    } else if (granularity === "week") {
      date.setUTCDate(date.getUTCDate() + (7 - (date.getUTCDay() || 7)));
      end = date.toISOString().slice(0, 10);
    } else end = day;
    end = [end, range.endDate, today].sort()[0];
    if (end < day) break;
    result.push({ start: day, end });
    const next = new Date(`${end}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
    day = next.toISOString().slice(0, 10);
    if (result.length > 500) throw Object.assign(new Error("Más de 500 cortes; utiliza una granularidad mayor."), { code: "TREND_BUCKET_LIMIT" });
  }
  return result;
}
export function validateCustomerTrendMemory(value, snapshot) {
  if (!value || value.accountId !== Number(snapshot.account?.id) || snapshot.permissions?.canReadOpportunities === false) return null;
  const parsed = customerTrendSpecSchema.safeParse(value.spec);
  if (!parsed.success || parsed.data.metric === "financial" || parsed.data.unsupported?.length ||
      parsed.data.clarification || !parsed.data.period || !parsed.data.filters) return null;
  if (typeof value.fingerprint !== "string" || value.fingerprint.length > 100 ||
      (value.targetId !== null && (!Number.isInteger(value.targetId) || value.targetId <= 0))) return null;
  return { accountId: value.accountId, targetId: value.targetId, spec: parsed.data, fingerprint: value.fingerprint };
}
export function resolveCustomerTrendRequest({ component, movement, previous, snapshot, context, now, timezone }) {
  const fail = (error, responseType = "clarification") => ({ error, responseType });
  const parsed = customerTrendSpecSchema.safeParse(component.trendSpec || {});
  if (!parsed.success) return fail("Los criterios históricos contienen valores inválidos.");
  const patch = customerTrendSpecPatch(parsed.data);
  if (patch.metric === "financial") return fail(FINANCIAL_UNAVAILABLE, "informational");
  if (patch.clarification) return fail(patch.clarification);
  if (patch.unsupported?.some((item) => /pron[oó]stic|predicci[oó]n/i.test(item))) {
    return fail("No puedo dar un pronóstico exacto de ventas con la información disponible. Sí puedo analizar escenarios condicionados a partir de las oportunidades registradas; serían hipótesis, no una predicción ni ventas aseguradas.", "informational");
  }
  if (patch.unsupported?.length) return fail(`No puedo acreditar estas solicitudes: ${patch.unsupported.join(", ")}. No inventaré causas, ingresos ni un pronóstico garantizado.`, "informational");
  if (!["account", "opportunity"].includes(component.object)) return fail("La evolución comercial admite cuenta u oportunidad.", "informational");
  if (!snapshot.account?.id || Number(snapshot.account.id) !== Number(context.accountId)) return fail("Selecciona una cuenta autorizada.");
  if (patch.accountReference && normalizeCustomerSearchText(patch.accountReference) !== normalizeCustomerSearchText(snapshot.account.name)) return fail("La historia está limitada a la cuenta seleccionada.");
  const prior = continuing(movement) ? previous : null;
  const metric = patch.metric || prior?.spec.metric;
  if (!metric || metric === "unspecified") return fail("¿Qué deseas analizar: oportunidades registradas, etapas, permanencias, cierres, cambios o pipeline histórico?");
  const period = patch.period || prior?.spec.period;
  if (!period) return fail("Indica el periodo o la fecha de corte del análisis histórico.");
  const range = resolveCustomerHistoryPeriod(period, now, timezone);
  if (!range || range.endDate > customerHistoryDate(now, timezone)) return fail("Indica fechas válidas, no futuras, con un intervalo máximo de cinco años por consulta.");
  const comparePeriod = patch.comparePeriod || prior?.spec.comparePeriod;
  const compareRange = comparePeriod ? resolveCustomerHistoryPeriod(comparePeriod, now, timezone) : null;
  if (comparePeriod && (!compareRange || compareRange.endDate > customerHistoryDate(now, timezone))) return fail("El periodo de comparación no es válido o contiene fechas futuras.");
  const filters = { stageCodes: [], statusCodes: metric === "pipeline" ? ["en_proceso"] : [], activation: metric === "pipeline" ? "active" : "all",
    ...(prior?.spec.metric === metric ? prior.spec.filters : {}), ...patch.filters };
  const spec = {
    metric, period: { mode: "absolute", ...range }, granularity: patch.granularity || prior?.spec.granularity || "month",
    filters, opportunityReference: patch.opportunityReference ??
      ((component.object === "opportunity" ? component.reference || "" : "") || prior?.spec.opportunityReference || ""), mode: patch.mode || "analyze",
    ...(compareRange ? { comparePeriod: { mode: "absolute", ...compareRange } } : {}),
  };
  if (spec.mode === "explain" && !prior) return fail("No hay un análisis previo verificable que explicar. Solicita primero el análisis.");
  if (component.object === "account" && component.reference &&
      normalizeCustomerSearchText(component.reference) !== normalizeCustomerSearchText(snapshot.account.name)) return fail("Indica la cuenta seleccionada o una oportunidad concreta.");
  const targetId = spec.opportunityReference === prior?.spec.opportunityReference ? prior?.targetId || null : null;
  if (["journey", "stage_duration"].includes(metric) && !spec.opportunityReference && !targetId) return fail("Indica una oportunidad para analizar su recorrido o permanencias.");
  return { accountId: Number(snapshot.account.id), spec, range, compareRange,
    targetId,
    previous: prior, now, timezone };
}

export function prepareCustomerCommercialHistory(data) {
  const byOpportunity = new Map();
  for (const event of data.events) {
    const id = Number(event.opportunity_id);
    if (!byOpportunity.has(id)) byOpportunity.set(id, []);
    byOpportunity.get(id).push(event);
  }
  return data.opportunities.map((opportunity) => {
    const all = byOpportunity.get(Number(opportunity.id)) || [];
    const events = all.filter((event) => event.event_kind !== "legacy").map((event) => ({
      id: Number(event.id), kind: event.event_kind, at: utc(event.recorded_at_utc),
      before: parseJson(event.before_state), after: parseJson(event.after_state),
    })).sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id);
    const created = events.find((event) => event.kind === "created");
    const baseline = events.find((event) => event.kind === "baseline");
    const anchor = created || baseline;
    let state = anchor?.after || null, continuous = Boolean(anchor), validEvents = [];
    if (anchor) {
      for (const event of events.filter((item) => item.at > anchor.at || (item.at === anchor.at && item.id > anchor.id))) {
        if (event.kind === "baseline") continue;
        if (!equal(state, event.before)) continuous = false;
        if (continuous) validEvents.push(event);
        state = event.after;
      }
    }
    if (state && !equal(state, opportunity)) continuous = false;
    // The baseline certifies only observations from its capture, never the preceding audit interval.
    const legacy = all.filter((event) => {
      if (event.event_kind !== "legacy") return false;
      const recorded = parseJson(event.before_state)?.recorded_at || event.recorded_at_utc;
      return !continuous || !anchor || Date.parse(recorded) < Date.parse(anchor.at);
    });
    return { opportunity, events, anchor, validEvents, continuous, legacy };
  });
}
export function reconstructCustomerOpportunity(timeline, day, timezone, data) {
  const atDay = (event) => customerHistoryDate(event.at, timezone);
  const createdDay = timelineCreatedDay(timeline, timezone);
  if (createdDay > day) return { known: true, state: null };
  if (!timeline.anchor || !timeline.continuous || atDay(timeline.anchor) > day) return { known: false, state: null };
  let state = timeline.anchor.after;
  for (const event of timeline.validEvents) {
    if (atDay(event) > day) break;
    state = event.after;
  }
  if (state && Number(state.account_id) !== Number(timeline.opportunity.account_id)) return { known: false, state: null };
  return { known: true, state };
}
function timelineCreatedDay(timeline, timezone) {
  const value = timeline.anchor?.kind === "created" ? timeline.anchor.after?.created_at : timeline.opportunity.created_at;
  return customerHistoryDate(value, timezone) || String(value || "").slice(0, 10);
}
function stageName(data, id) { return data.stages.find((stage) => Number(stage.id) === Number(id))?.name || "Etapa no identificada"; }
const fmt = (value) => value.toLocaleString("es-MX", { maximumFractionDigits: 4 });
function legacyRows(timeline, request) {
  const relevant = new Set(["sales_stage_id", "amount_usd", "close_date", "commercial_status_id"]);
  return timeline.legacy.flatMap((event) => {
    const original = parseJson(event.before_state)?.recorded_at;
    const day = original ? customerHistoryDate(original, request.timezone) || String(original).slice(0, 10) :
      customerHistoryDate(event.recorded_at_utc, request.timezone) || String(event.recorded_at_utc).slice(0, 10);
    if (day < request.range.startDate || day > request.range.endDate) return [];
    const fields = parseJson(event.after_state) || {};
    if (fields.account_id || fields.name) return [];
    return Object.keys(fields).filter((field) => relevant.has(field)).map((field) =>
      [day, timeline.opportunity.name, `Auditoría conservada: ${field}`, "Fecha original de auditoría; secuencia no certificada, no se suma a métricas ni duraciones"]);
  });
}
export function buildCustomerTrendResponse({ request, data }) {
  if (data.complete !== true) return response("La lectura histórica no está completa; no se presenta un total truncado.", "error");
  if (request.spec.filters.stageCodes.some((code) => !data.stages.some((stage) => stage.code === code))) {
    return response("Una etapa solicitada no existe en el catálogo autorizado. Precisa el filtro; no lo convertí en un cero.", "clarification");
  }
  let timelines = prepareCustomerCommercialHistory(data);
  if (request.spec.opportunityReference) {
    const matches = timelines.filter((item) => normalizeCustomerSearchText(item.opportunity.name) === normalizeCustomerSearchText(request.spec.opportunityReference));
    if (matches.length !== 1) return response("No pude resolver una única oportunidad autorizada por ese nombre; precisa la referencia.", "clarification");
    if (request.targetId && Number(matches[0].opportunity.id) !== request.targetId) return response("La referencia ya no corresponde a la misma oportunidad. Indica una selección nueva.", "clarification");
    timelines = matches;
  } else if (request.targetId) {
    timelines = timelines.filter((item) => Number(item.opportunity.id) === request.targetId);
    if (!timelines.length) return response("La oportunidad anterior ya no está autorizada.", "clarification");
  }
  const spec = request.spec, rows = [], summaries = [], warnings = new Set(), notes = [];
  const selectedIds = timelines.map((item) => Number(item.opportunity.id));
  if (!timelines.length) warnings.add("No hay oportunidades actualmente autorizadas; no acredita ausencia histórica global.");
  if (spec.metric !== "created" && timelines.some((item) => !item.continuous)) warnings.add("Hay secuencias incompletas o contradictorias.");
  const eventDay = (event) => customerHistoryDate(event.at, request.timezone);
  const inside = (day, range) => day >= (range.startDate || range.start) && day <= (range.endDate || range.end);
  const availableEvents = (timeline, range) => timeline.validEvents.filter((event) =>
    inside(eventDay(event), range) && Number(event.before?.account_id) === request.accountId &&
    Number(event.after?.account_id) === request.accountId);
  const coverage = (range) => timelines.every((item) =>
    timelineCreatedDay(item, request.timezone) > range.endDate ||
    (item.continuous && item.anchor && (item.anchor.kind === "created" || eventDay(item.anchor) < range.startDate)));
  const ranges = [request.range, ...(request.compareRange ? [request.compareRange] : [])];
  for (const [rangeIndex, range] of ranges.entries()) {
    const label = rangeIndex === 0 ? "Principal" : "Comparación";
    let total = 0, rangeComplete = spec.metric === "created" ? true : coverage(range);
    if (["created", "stage_movements", "closures", "pipeline"].includes(spec.metric)) {
      for (const bucket of buckets(range, spec.granularity, request.now, request.timezone)) {
        let count = 0, amountCents = 0n, movements = 0, advances = 0, retreats = 0, jumps = 0, won = 0, lost = 0, cancelled = 0, known = true;
        const distinct = new Set();
        for (const timeline of timelines) {
          if (spec.metric === "created") {
            const day = timelineCreatedDay(timeline, request.timezone);
            if (!inside(day, bucket)) continue;
            const hasFilters = spec.filters.stageCodes.length || spec.filters.statusCodes.length || spec.filters.activation !== "all";
            const initial = timeline.anchor?.kind === "created" ? timeline.anchor.after : null;
            if (hasFilters && !initial) { known = false; continue; }
            if (!hasFilters || stateMatches(initial, request, data)) count += 1;
          } else if (spec.metric === "pipeline") {
            const historical = reconstructCustomerOpportunity(timeline, bucket.end, request.timezone, data);
            if (!historical.known) { known = false; continue; }
            if (historical.state && stateMatches(historical.state, request, data)) {
              const value = number(historical.state.amount_usd);
              if (value === null || !Number.isFinite(value) || !Number.isSafeInteger(Math.round(value * 100))) { known = false; continue; }
              count += 1; amountCents += BigInt(Math.round(value * 100));
            }
          } else {
            if (!coverageForTimeline(timeline, bucket, request)) known = false;
            for (const event of availableEvents(timeline, bucket)) {
              if (!stateMatches(event.after, request, data)) continue;
              if (spec.metric === "stage_movements" && Number(event.before.sales_stage_id) !== Number(event.after.sales_stage_id)) {
                movements += 1; distinct.add(Number(timeline.opportunity.id));
                const ordered = [...data.stages].sort((a, b) => a.display_order - b.display_order);
                const before = ordered.findIndex((item) => Number(item.id) === Number(event.before.sales_stage_id));
                const after = ordered.findIndex((item) => Number(item.id) === Number(event.after.sales_stage_id));
                if (before < 0 || after < 0) warnings.add("No se conoce el orden de algunas etapas; no se clasificó la dirección.");
                else if (after > before) { advances += 1; if (after - before > 1) jumps += 1; }
                else retreats += 1;
              }
              if (spec.metric === "closures" && Number(event.before.commercial_status_id) !== Number(event.after.commercial_status_id)) {
                const code = data.commercialStatuses.find((item) => Number(item.id) === Number(event.after.commercial_status_id))?.code;
                if (["ganada", "perdida", "anulada"].includes(code)) {
                  movements += 1; distinct.add(Number(timeline.opportunity.id));
                  if (code === "ganada") won += 1; if (code === "perdida") lost += 1; if (code === "anulada") cancelled += 1;
                }
              }
            }
          }
        }
        if (!known) { rangeComplete = false; warnings.add("Hay cortes sin estado o eventos suficientes; sus cantidades son parciales, no ceros certificados."); }
        if (spec.metric === "stage_movements") count = movements;
        if (spec.metric === "closures") count = movements;
        total += count;
        rows.push([label, `${bucket.start} — ${bucket.end}`, known ? String(count) : `${count} conocidos (parcial)`,
          spec.metric === "pipeline" ? `USD ${formatCents(amountCents)}${known ? "" : " conocidos"}` :
            spec.metric === "stage_movements" ? `${distinct.size} oportunidades; ${advances} avances (${jumps} saltos incluidos), ${retreats} retrocesos` :
              spec.metric === "closures" ? `${distinct.size} oportunidades; ganadas ${won}, perdidas ${lost}, anuladas ${cancelled}` :
                "Oportunidades distintas por fecha de registro",
          known ? "Verificado en alcance actual autorizado" : "Cobertura parcial"]);
      }
      summaries.push({ label, total, complete: rangeComplete, days: (Date.parse(range.endDate) - Date.parse(range.startDate)) / 86400000 + 1 });
    } else {
      for (const timeline of timelines) {
        const events = availableEvents(timeline, range);
        if (!coverageForTimeline(timeline, range, request)) warnings.add("Recorrido parcial: no se certifican eventos ausentes ni permanencias anteriores al estado base.");
        if (spec.metric === "stage_duration") {
          const isOpen = (state) => data.commercialStatuses.find((item) => Number(item.id) === Number(state?.commercial_status_id))?.code === "en_proceso";
          let entry = timeline.anchor?.kind === "created" && isOpen(timeline.anchor.after) ? timeline.anchor : null;
          let stage = timeline.anchor?.after?.sales_stage_id;
          for (const event of timeline.validEvents) {
            if (!event.after || Number(event.before?.account_id) !== request.accountId ||
                Number(event.after.account_id) !== request.accountId) {
              warnings.add("Los cambios de cuenta interrumpen la estancia verificable; no acreditan entrada a una etapa.");
              entry = null; stage = event.after?.sales_stage_id;
              continue;
            }
            if (Number(event.before?.sales_stage_id) === Number(event.after?.sales_stage_id) &&
                Number(event.before?.account_id) === Number(event.after?.account_id) &&
                isOpen(event.before) === isOpen(event.after)) continue;
            if (entry && stage && inside(eventDay(event), range) && stateMatches(event.before, request, data)) {
              const days = (Date.parse(event.at) - Date.parse(entry.at)) / 86400000;
              rows.push([label, timeline.opportunity.name, stageName(data, stage), `${fmt(days)} días transcurridos`, `Estancia completada ${entry.at} — ${event.at}`]);
            }
            entry = event.after && isOpen(event.after) ? event : null; stage = event.after?.sales_stage_id;
          }
          if (entry && stage && stateMatches(entry.after, request, data)) {
            const endDay = customerHistoryDate(request.now, request.timezone);
            if (range.endDate === endDay) {
              const days = (request.now.getTime() - Date.parse(entry.at)) / 86400000;
              if (days >= 0) rows.push([label, timeline.opportunity.name, stageName(data, stage), `${fmt(days)} días transcurridos`, `Estancia abierta desde ${entry.at}; no completada`]);
            } else warnings.add("Las estancias abiertas solo se miden hasta ahora; no se infiere una salida al final del periodo.");
          }
        } else {
          if (spec.metric === "journey" && timeline.anchor && inside(eventDay(timeline.anchor), range) && stateMatches(timeline.anchor.after, request, data)) {
            rows.push([label, timeline.opportunity.name, timeline.anchor.at, stageName(data, timeline.anchor.after.sales_stage_id),
              timeline.anchor.kind === "baseline" ? "Estado base observado; no acredita entrada a etapa" : "Creación registrada"]);
          }
          for (const event of events) {
            if (!stateMatches(event.after, request, data)) continue;
            if (spec.metric === "journey" && ["sales_stage_id", "commercial_status_id", "activation_status_id"].some((field) => Number(event.before[field]) !== Number(event.after[field]))) {
              const describe = (state) => [
                stageName(data, state.sales_stage_id),
                data.commercialStatuses.find((item) => Number(item.id) === Number(state.commercial_status_id))?.name ||
                  data.commercialStatuses.find((item) => Number(item.id) === Number(state.commercial_status_id))?.code || "Estado no identificado",
                data.activationStatuses.find((item) => Number(item.id) === Number(state.activation_status_id))?.name ||
                  data.activationStatuses.find((item) => Number(item.id) === Number(state.activation_status_id))?.code || "Activación no identificada",
              ].join(" / ");
              rows.push([label, timeline.opportunity.name, event.at, describe(event.before), describe(event.after)]);
            }
            if (spec.metric === "changes") {
              for (const field of ["amount_usd", "close_date"]) if (String(event.before[field]) !== String(event.after[field])) {
                rows.push([label, timeline.opportunity.name, event.at, field === "amount_usd" ? "Importe USD" : "Cierre previsto",
                  `${event.before[field] ?? "No registrado"} → ${event.after[field] ?? "No registrado"}`]);
              }
            }
          }
          if (spec.metric === "journey" || spec.metric === "changes") {
            for (const legacy of legacyRows(timeline, { ...request, range })) rows.push([label, ...legacy]);
            if (timeline.legacy.length) warnings.add("La auditoría previa se muestra como antecedente no certificado; no reconstruye pipeline ni duraciones.");
          }
        }
      }
    }
  }
  if (request.compareRange && summaries.length === 2) {
    const [current, base] = summaries;
    if (spec.metric === "pipeline") warnings.add("Las fotografías de pipeline no se suman entre cortes para calcular crecimiento. Compara los valores de cada corte.");
    else if (!current.complete || !base.complete || current.days !== base.days) warnings.add("No se calculó variación: periodos de distinta duración o cobertura insuficiente.");
    else notes.push(`Variación principal respecto de comparación: ${current.total - base.total}; ${base.total === 0 ? "porcentaje no calculable, base cero" : `${fmt((current.total - base.total) / base.total * 100)} %`}.`);
  }
  const limited = rows.length > 500;
  if (limited) warnings.add(`Presentación limitada a 500 filas de ${rows.length}; no hay paginación. Los cálculos se realizaron antes del límite.`);
  const partial = !timelines.length || limited || warnings.size > 0;
  const shownRows = rows.slice(0, 500);
  const headers = ["Serie", "Periodo / oportunidad", "Cantidad / fecha / etapa", "Dato / contraste", "Fundamento"];
  const tableText = [headers, headers.map(() => "---"), ...shownRows]
    .map((row) => `| ${row.map((value) => String(value).replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ")).join(" | ")} |`).join("\n");
  const evidence = [
    `Métrica: ${spec.metric}; ${request.range.startDate} — ${request.range.endDate}; ${request.timezone}.`,
    "Fuente: auditoría comercial transaccional sin caducidad; cambios externos que omitan la auditoría no tienen captura garantizada.",
    "Filtros aplicados al estado histórico; autorización y pertenencia actuales limitan el conjunto recuperado.",
    `Criterios: etapas ${spec.filters.stageCodes.join(", ") || "todas"}; estados ${spec.filters.statusCodes.join(", ") || "todos"}; activación ${spec.filters.activation}.`,
    ...(spec.metric === "stage_movements" ? ["Avances y saltos se clasifican según el orden del catálogo de etapas consultado; los saltos forman parte de los avances."] : []),
    ...(spec.metric === "stage_duration" ? ["Duraciones transcurridas entre eventos; el cierre comercial termina la estancia. No son días hábiles ni acredita realización de tareas."] : []),
    ...(request.range.endDate === customerHistoryDate(request.now, request.timezone) ? ["El último periodo está en curso; el corte de hoy refleja lo recuperado, no un día futuro completado."] : []),
    ...notes,
    ...warnings,
  ];
  const fingerprint = fingerprintValue({ spec: { ...spec, mode: "analyze" }, rows, evidence, selectedIds });
  if (spec.mode === "explain" && request.previous && request.previous.fingerprint !== fingerprint) return response(
    "Los datos o la cobertura del análisis anterior cambiaron. Solicita actualizar; no presentaré el análisis anterior como vigente.",
    "clarification", { trendMemory: request.previous });
  const memory = { accountId: request.accountId, targetId: timelines.length === 1 && spec.opportunityReference ? Number(timelines[0].opportunity.id) : null,
    spec: { ...spec, mode: "analyze" }, fingerprint };
  return response([
    `Evolución comercial: ${spec.metric}. Cuenta: ${request.accountId}.`,
    ...evidence, tableText, ...(rows.length ? [] : ["No hay eventos verificables en este intervalo; no acredita ausencia de movimientos no conservados."]),
    ...(spec.mode === "refresh" && request.previous ? [request.previous.fingerprint === fingerprint ? "Análisis actualizado: sin cambios." : "Análisis actualizado: cambió respecto del anterior."] : []),
    "Los importes son valores comerciales registrados, no facturación ni cobros. No se infieren causas, estacionalidad ni un pronóstico garantizado.",
  ].join("\n"), "informational", {
    trendMemory: memory, trendMetadata: { metric: spec.metric, partial, reasons: [...warnings], table: { headers, rows: shownRows },
      period: request.range, timezone: request.timezone, opportunityCount: timelines.length },
    trendEvidence: evidence, evidence, confidence: partial ? "medium" : "high",
    entities: { accountId: request.accountId, opportunityId: memory.targetId, contactId: null },
  });
}
function coverageForTimeline(timeline, range, request) {
  const createdDay = timelineCreatedDay(timeline, request.timezone);
  return createdDay > range.endDate || Boolean(timeline.continuous && timeline.anchor &&
    (timeline.anchor.kind === "created" || customerHistoryDate(timeline.anchor.at, request.timezone) < range.startDate));
}
function fingerprintValue(value) {
  // A compact deterministic digest avoids persisting the complete historic result in conversation memory.
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function formatCents(cents) {
  const sign = cents < 0n ? "-" : "";
  const absolute = cents < 0n ? -cents : cents;
  return `${sign}${(absolute / 100n).toLocaleString("es-MX")}.${String(absolute % 100n).padStart(2, "0")}`;
}
