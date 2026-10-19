import { resolveCoachEntities } from "../coach/entity-resolver.js";
import { customerDateOnly, customerHistorySpecPatch, customerHistorySpecSchema } from "./turn-contract.js";

export const CUSTOMER_HISTORY_SOURCES = Object.freeze({
  interactions: { title: "Interacciones", metric: "interactions", permission: "interacciones.read", flag: "canReadInteractions", tool: "searchInteractions" },
  opportunityActivities: { title: "Actividades de oportunidades", metric: "opportunity_activities", permission: "desarrollo_comercial.read", flag: "canReadOpportunityActivities", tool: "getOpportunityActivities" },
  calendarActivities: { title: "Actividades de calendario", metric: "calendar_activities", permission: "calendario_comercial.read", flag: "canReadCalendarActivities", tool: "getOpportunityActivities" },
});
const normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const continuing = (movement) => ["continue", "correct", "answer_clarification", "select_candidate"].includes(movement);

export function customerHistoryDate(value, timezone) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return customerDateOnly(value);
  if (!(value instanceof Date) && !(typeof value === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value))) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type).value).join("-");
}

function shiftMonths(day, amount) {
  const date = new Date(`${day}T00:00:00Z`);
  const original = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + amount);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(last, original));
  return date.toISOString().slice(0, 10);
}

export function resolveCustomerHistoryPeriod(period = { mode: "default" }, now, timezone) {
  const today = customerHistoryDate(now, timezone);
  let startDate;
  let endDate = today;
  if (period.mode === "absolute") {
    startDate = customerDateOnly(period.startDate);
    endDate = customerDateOnly(period.endDate);
  } else if (["default", "relative"].includes(period.mode)) {
    const amount = period.mode === "default" ? 6 : period.amount;
    const unit = period.mode === "default" ? "month" : period.unit;
    if (!Number.isInteger(amount) || amount <= 0 || !unit) return null;
    if (["month", "quarter", "year"].includes(unit)) {
      startDate = shiftMonths(today, -amount * ({ month: 1, quarter: 3, year: 12 }[unit]));
    } else {
      const date = new Date(`${today}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() - amount * (unit === "week" ? 7 : 1));
      startDate = date.toISOString().slice(0, 10);
    }
  } else if (period.mode === "calendar") {
    if (!["month", "quarter", "year"].includes(period.unit)) return null;
    if ((!period.year && period.index) || (period.unit === "year" && period.index > 1)) return null;
    const current = new Date(`${today}T00:00:00Z`);
    const year = period.year || current.getUTCFullYear();
    const size = { month: 1, quarter: 3, year: 12 }[period.unit];
    if (period.year && period.unit !== "year" && (!period.index || period.index > 12 / size)) return null;
    const index = period.year ? period.index || 1 : Math.floor(current.getUTCMonth() / size) + 1;
    const first = new Date(Date.UTC(year, (index - 1 + (period.year ? 0 : period.offset || 0)) * size, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + size, 0));
    startDate = first.toISOString().slice(0, 10);
    endDate = last.toISOString().slice(0, 10);
    if (!period.year && !period.offset) endDate = today;
  }
  if (!customerDateOnly(startDate) || !customerDateOnly(endDate) || startDate > endDate ||
      (Date.parse(endDate) - Date.parse(startDate)) / 86400000 > 366 * 5) return null;
  return { startDate, endDate };
}

export function validateCustomerHistoryMemory(value, snapshot) {
  if (!value || Number(value.accountId) !== Number(snapshot.account?.id) ||
      !["account", "opportunity", "contact"].includes(value.object)) return null;
  const parsed = customerHistorySpecSchema.safeParse(value.spec);
  if (!parsed.success || parsed.data.clarification || parsed.data.unsupported?.length ||
      parsed.data.period?.mode !== "absolute" ||
      !resolveCustomerHistoryPeriod(parsed.data.period, new Date(), "UTC")) return null;
  const records = value.object === "contact" ? [...(snapshot.contacts || []), ...(snapshot.selectedContact ? [snapshot.selectedContact] : [])] :
    value.object === "opportunity" ? [...(snapshot.opportunities || []), ...(snapshot.inactiveOpportunities || []),
      ...(snapshot.selectedOpportunity ? [snapshot.selectedOpportunity] : [])] : [snapshot.account];
  const record = records.find((item) => Number(item.id) === Number(value.targetId) &&
    (value.object === "account" || Number(item.accountId) === Number(snapshot.account.id)));
  return record ? { accountId: Number(snapshot.account.id), object: value.object, targetId: Number(record.id),
    spec: parsed.data } : null;
}

export function resolveCustomerHistoryRequest({ component, movement, previous, snapshot, context, now, timezone, businessRules }) {
  const fail = (error, responseType = "clarification") => ({ error, responseType });
  if (!["account", "opportunity", "contact"].includes(component.object)) return fail("El historial admite cuenta, oportunidad o contacto.", "informational");
  if (!snapshot.account?.id || Number(context.accountId) !== Number(snapshot.account.id)) return fail("Selecciona una cuenta autorizada para consultar su historial.");
  const parsed = customerHistorySpecSchema.safeParse(component.historySpec || {});
  if (!parsed.success) return fail("Los criterios del historial no son válidos. Precisa periodo, fuentes y estados.");
  const patch = customerHistorySpecPatch(parsed.data);
  if (patch.accountReference && normalize(patch.accountReference) !== normalize(snapshot.account.name)) {
    return fail("El historial pertenece únicamente a la cuenta seleccionada. Cambia la cuenta en la interfaz.");
  }
  const ref = String(component.reference || "").trim();
  const records = component.object === "contact" ? [...(snapshot.contacts || []), ...(snapshot.selectedContact ? [snapshot.selectedContact] : [])] :
    component.object === "opportunity" ? [...(snapshot.opportunities || []), ...(snapshot.inactiveOpportunities || []),
      ...(snapshot.selectedOpportunity ? [snapshot.selectedOpportunity] : [])] : [snapshot.account];
  const authorized = [...new Map(records.filter((item) =>
    component.object === "account" || Number(item.accountId) === Number(snapshot.account.id))
    .map((item) => [Number(item.id), item])).values()];
  let target;
  if (component.object === "account") {
    if (ref && normalize(ref) !== normalize(snapshot.account.name)) return fail("Indica la cuenta seleccionada; no ampliaré el historial a otra cuenta.");
    target = snapshot.account;
  } else if (ref) {
    const exact = authorized.filter((item) => normalize(item.name) === normalize(ref));
    if (exact.length === 1) target = exact[0];
    else {
      const matches = resolveCoachEntities({
        coachOpportunities: component.object === "opportunity" ? authorized : [],
        contactMappings: component.object === "contact" ? authorized : [],
      }, ref, businessRules, { exactMatchOnly: true, ignoreStageFilters: true });
      const candidates = matches.candidates[component.object === "contact" ? "contacts" : "opportunities"];
      if (candidates.length === 1) target = candidates[0];
    }
  } else {
    const id = continuing(movement) && previous?.object === component.object ? previous.targetId :
      context[component.object === "contact" ? "contactId" : "opportunityId"];
    target = authorized.find((item) => Number(item.id) === Number(id));
  }
  if (!target) return fail("Indica un único contacto u oportunidad autorizado por su nombre para consultar su historial.");
  const sameTarget = continuing(movement) && previous?.object === component.object &&
    previous.targetId === Number(target.id);
  const spec = {
    ...(sameTarget ? previous.spec : {}),
    ...patch,
  };
  if (spec.clarification) return fail(spec.clarification);
  if (spec.unsupported?.length) return fail(`Estos criterios de historial no están soportados: ${spec.unsupported.join(", ")}. No los omití.`, "informational");
  const purpose = parsed.data.purpose || "timeline";
  if (purpose === "absence_explanation") return {
    purpose, target, entities: { accountId: Number(snapshot.account.id),
      opportunityId: component.object === "opportunity" ? Number(target.id) : null,
      contactId: component.object === "contact" ? Number(target.id) : null },
  };
  const range = resolveCustomerHistoryPeriod(spec.period, now, timezone);
  if (!range) return fail("Precisa un periodo válido, con año y límites ordenados, de hasta cinco años.");
  const effective = {
    period: { mode: "absolute", ...range },
    sources: [...new Set(spec.sources?.length ? spec.sources : Object.keys(CUSTOMER_HISTORY_SOURCES))],
    statuses: [...new Set(spec.statuses || [])], limit: Math.min(spec.limit || 50, 50),
  };
  return {
    purpose, target, range, defaultPeriod: !spec.period || spec.period.mode === "default",
    spec: effective,
    memory: { accountId: Number(snapshot.account.id), object: component.object, targetId: Number(target.id), spec: effective },
  };
}

export function getCustomerHistorySourceAccess({ request, snapshot, permissions, intent, activityIntent = null, businessRules }) {
  return request.spec.sources.map((source) => {
    const definition = CUSTOMER_HISTORY_SOURCES[source];
    const sourceIntent = request.memory.object === "contact" && source === "calendarActivities" ? activityIntent : intent;
    let status = "available";
    if (request.memory.object === "contact" && source === "opportunityActivities") status = "not_applicable";
    else if (!permissions.has(definition.permission) || snapshot.permissions?.[definition.flag] !== true ||
      (source !== "interactions" && !permissions.has("oportunidades.read"))) status = "restricted";
    else if (!sourceIntent || sourceIntent.enabled === false || !sourceIntent.allowedTools.includes(definition.tool) ||
      (source !== "interactions" && businessRules.scope?.opportunitySearchAllowed === false)) status = "disabled";
    return { source, title: definition.title, status, tool: definition.tool };
  });
}

function normalizeEvent(record, source, timezone) {
  const fields = source === "interactions" ? [["createdAt", "Creación de interacción"], ["updatedAt", "Actualización de interacción"]] :
    [["scheduledAt", "Programación"], ["dueDate", "Vencimiento"], ["createdAt", "Creación de actividad"]];
  const field = fields.find(([key]) => record[key] != null);
  const date = field ? customerHistoryDate(record[field[0]], timezone) : null;
  const value = field ? record[field[0]] : null;
  const timestamp = date && (value instanceof Date || String(value).includes("T"))
    ? new Date(value).toISOString() : "";
  return {
    id: `${source}:${record.id}`, recordId: Number(record.id), source,
    sourceTitle: CUSTOMER_HISTORY_SOURCES[source].title,
    date: date || "", dateMeaning: field?.[1] || "Sin fecha utilizable",
    timestamp, time: timestamp ? new Intl.DateTimeFormat("es-MX", {
      timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(new Date(timestamp)) : "",
    title: record.title || "Registro sin título", opportunityName: record.opportunityName || "",
    ...(source === "interactions" ? { accountLink: Number(record.directAccountId) === Number(record.accountId)
      ? "Cuenta directa" : record.directAccountId !== undefined && record.opportunityId
        ? "Mediante oportunidad" : "Vínculo directo no verificado" } : {}),
    activityType: record.activityType || record.actionType || "",
    status: source === "interactions" ? "" : record.status || "",
    details: record.summary || record.notes || record.sourceNotes || "",
  };
}

export function buildCustomerHistoryReadFilter(source, request) {
  const { object, targetId } = request.memory;
  if (!CUSTOMER_HISTORY_SOURCES[source] || !customerDateOnly(request.range.startDate) ||
      !customerDateOnly(request.range.endDate) || !Number.isSafeInteger(targetId) || targetId <= 0) {
    throw Object.assign(new Error("Criterios de lectura de historial inválidos"), { code: "CUSTOMER_HISTORY_READ_INVALID" });
  }
  const expressions = {
    interactions: { date: "COALESCE(i.created_at, i.updated_at)", opportunity: "i.primary_opportunity_id",
      contact: "EXISTS (SELECT 1 FROM interaction_contact_links history_link WHERE history_link.interaction_id = i.id AND history_link.contact_id = ?)" },
    opportunityActivities: { date: "COALESCE(a.scheduled_at, a.due_date, a.created_at)", opportunity: "a.opportunity_id" },
    calendarActivities: { date: "COALESCE(cca.scheduled_at, cca.due_date, cca.created_at)",
      opportunity: "COALESCE(cca.opportunity_id, linked_i.primary_opportunity_id)", contact: "cca.contact_id = ?" },
  }[source];
  // Include boundary days; the final comparison uses the business timezone.
  const clauses = [`(${expressions.date} IS NULL OR (${expressions.date} >= DATE_SUB(?, INTERVAL 1 DAY) AND ${expressions.date} < DATE_ADD(?, INTERVAL 2 DAY)))`];
  const params = [request.range.startDate, request.range.endDate];
  if (object === "opportunity") {
    clauses.push(`${expressions.opportunity} = ?`);
    params.push(targetId);
  } else if (object === "contact") {
    if (!expressions.contact) throw Object.assign(new Error("Fuente sin vínculo de contacto"), { code: "CUSTOMER_HISTORY_RELATION_UNAVAILABLE" });
    clauses.push(expressions.contact);
    params.push(targetId);
  }
  return { sql: `AND ${clauses.join(" AND ")}`, params };
}

export function buildCustomerHistoryResponse({ request, snapshot, metrics = [], access, timezone }) {
  if (request.purpose === "absence_explanation") return {
    answer: [
      "No. La ausencia de interacciones directas de cuenta no demuestra que nunca hubo contacto con el cliente.",
      `No he verificado que esa ausencia se cumpla en ${request.target.name}; respondo a la premisa condicional, no a una lectura de su historial.`,
      "Puede haber interacciones vinculadas mediante oportunidades, actividades de oportunidades o de calendario, o contacto no registrado. No afirmo que esos registros existan en este caso.",
      "La fuente Interacciones puede reunir vínculos directos a cuenta y vínculos mediante oportunidad; no debe confundirse con una tabla exclusivamente de interacciones directas.",
      "Para comprobar el historial disponible habría que consultar las fuentes autorizadas y acordar su alcance. Una lectura completa de una fuente y un periodo no acredita todo el historial del cliente.",
      "Las fechas de creación, programación o vencimiento no prueban por sí solas que se realizó una conversación ni su resultado.",
    ].join("\n"),
    responseType: "informational", confidence: "high", source: "account_intelligence",
    operations: [], recommendedActions: [], pendingItems: [], inferences: [], evidence: [], entities: request.entities,
  };
  const coverage = [];
  const dated = [];
  const undated = [];
  const object = request.memory.object;
  const opportunityIds = new Set([
    ...(snapshot.opportunities || []), ...(snapshot.inactiveOpportunities || []),
    ...(snapshot.selectedOpportunity ? [snapshot.selectedOpportunity] : []),
  ].filter((item) => Number(item.accountId) === request.memory.accountId).map((item) => Number(item.id)));
  for (const sourceAccess of access) {
    const { source } = sourceAccess;
    const metric = metrics.find((item) => item.source === CUSTOMER_HISTORY_SOURCES[source].metric);
    const linkFailure = object === "contact" && source === "interactions" &&
      metrics.some((item) => ["interaction_contact_links", "contacts"].includes(item.source) && item.errorCode);
    let status = sourceAccess.status !== "available" ? sourceAccess.status :
      metric?.errorCode || linkFailure ? "failed" : !metric || metric.truncated !== false ? "partial" : "complete";
    const relationLimited = (snapshot[source] || []).some((record) =>
      record.opportunityId && !opportunityIds.has(Number(record.opportunityId)));
    const scopeIncomplete = metrics.some((item) => ["opportunities_active", "opportunities_inactive"].includes(item.source) &&
      (item.errorCode || item.truncated !== false));
    const linksUnverified = object === "contact" && source === "interactions" && snapshot.interactions?.length &&
      !metrics.some((item) => item.source === "interaction_contact_links" && item.truncated === false);
    if (status === "complete" && (relationLimited || linksUnverified ||
        (object === "account" && source !== "interactions" && scopeIncomplete))) status = "partial";
    const seen = new Set();
    const rows = ["complete", "partial"].includes(status) ? (snapshot[source] || []).filter((record) => {
      if (Number(record.accountId) !== request.memory.accountId || !Number.isInteger(Number(record.id)) || Number(record.id) <= 0) return false;
      if (record.opportunityId && !opportunityIds.has(Number(record.opportunityId))) return false;
      if (object === "opportunity" && Number(record.opportunityId) !== request.memory.targetId) return false;
      if (object === "contact" && !(source === "calendarActivities" ? Number(record.contactId) === request.memory.targetId :
        record.contactIds?.includes(request.memory.targetId))) return false;
      const status = record.status === "done" ? "completed" : record.status;
      if (request.spec.statuses.length && (source === "interactions" || !request.spec.statuses.includes(status))) return false;
      if (seen.has(Number(record.id))) return false;
      seen.add(Number(record.id));
      return true;
    }) : [];
    const events = rows.map((row) => normalizeEvent(row, source, timezone));
    const matches = events.filter((event) => event.date >= request.range.startDate && event.date <= request.range.endDate);
    const missing = events.filter((event) => !event.date);
    dated.push(...matches);
    undated.push(...missing);
    coverage.push({ ...sourceAccess, status,
      recovered: ["complete", "partial"].includes(status) ? metric?.resultCount ?? (snapshot[source] || []).length : 0,
      matched: matches.length, undated: missing.length });
  }
  dated.sort((a, b) => a.date.localeCompare(b.date) || a.timestamp.localeCompare(b.timestamp) ||
    a.id.localeCompare(b.id, "en", { numeric: true }));
  undated.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
  const items = [...dated, ...undated].slice(0, request.spec.limit);
  for (const source of coverage) source.shown = items.filter((item) => item.source === source.source).length;
  const partial = coverage.some((item) => item.status !== "complete");
  const limited = dated.length + undated.length > request.spec.limit;
  const failed = coverage.some((item) => item.status === "failed");
  const usable = coverage.some((item) => ["complete", "partial"].includes(item.status));
  const labels = { complete: "lectura completa", partial: "lectura parcial o cobertura desconocida",
    failed: "falló la lectura", restricted: "sin permiso", disabled: "deshabilitada por el canal",
    not_applicable: "sin vínculo explícito admitido para este contacto" };
  const warnings = coverage.filter((item) => item.status !== "complete")
    .map((item) => `${item.title}: ${labels[item.status]}.`);
  if (limited) warnings.push(`Se muestran como máximo ${request.spec.limit} eventos; no hay paginación.`);
  if (undated.length) warnings.push(`${undated.length} registro(s) sin fecha utilizable: no se puede comprobar su pertenencia al periodo.`);
  const statusLabel = (status) => ({ done: "realizada", completed: "realizada", pending: "pendiente",
    in_progress: "en curso", blocked: "bloqueada", cancelled: "cancelada" })[status] || status || "sin estado";
  let detailCount = 0;
  const eventLines = items.map((item) => {
    const status = statusLabel(item.status);
    const date = item.date
      ? `${item.date} · ${item.dateMeaning || "fecha registrada"}`
      : "Sin fecha utilizable; pertenencia al periodo no verificable";
    let line = `- ${date} · ${status[0].toLocaleUpperCase("es")}${status.slice(1)}: “${item.title}”` +
      (item.sourceTitle ? ` — ${item.sourceTitle}` : "");
    if (item.date && item.details && detailCount < 5) {
      const note = item.details.slice(0, 500);
      line += ` · Nota: ${note}${item.details.length > 500 ? " [extracto; consulta el detalle para ver el resto]" : ""}`;
      detailCount += 1;
    }
    return line;
  });
  const datedCount = `${dated.length} ${dated.length === 1 ? "evento fechado" : "eventos fechados"}`;
  const shownCount = `${items.length} ${items.length === 1 ? "registro" : "registros"}`;
  const statusSummary = [...new Set(dated.map((item) => statusLabel(item.status)))].map((status) => {
    const count = dated.filter((item) => statusLabel(item.status) === status).length;
    const plural = { realizada: "realizadas", pendiente: "pendientes", bloqueada: "bloqueadas",
      cancelada: "canceladas" }[status] || status;
    return `${count} ${count === 1 ? status : plural}`;
  });
  const hasNonCompletionDate = items.some((item) => item.date &&
    !["realización", "realizada"].includes(String(item.dateMeaning || "").toLocaleLowerCase("es")));
  const answer = [
    `Historial de ${request.target.name}: del ${request.range.startDate} al ${request.range.endDate}${request.defaultPeriod ? " (últimos seis meses)" : ""}.`,
    `Zona horaria: ${timezone}.`,
    `Encontré ${datedCount} en las fuentes consultadas; se muestran ${shownCount}.`,
    ...(statusSummary.length ? [`Estado de las actividades: ${statusSummary.join(", ")}.`] : []),
    ...eventLines,
    items.filter((item) => item.date && item.details).length > 5
      ? "Incluyo hasta cinco notas; puedes consultar las demás en la cronología." : "",
    items.some((item) => ["done", "completed"].includes(item.status) && !item.details)
      ? "Algunas actividades aparecen como realizadas, pero no tienen un resultado anotado. El título por sí solo no permite saber cómo terminó la gestión." : "",
    request.spec.statuses.length ? `Mostré actividades con estado ${request.spec.statuses.map(statusLabel).join(", ")}. Las interacciones no usan esos estados y no están incluidas.` : "",
    ...warnings,
    !dated.length ? partial ? "La cobertura es incompleta; esto no demuestra ausencia de eventos ni de contacto con el cliente." :
      "No encontré eventos con fecha en este periodo y en las fuentes consultadas. Esto no demuestra que nunca hubo contacto fuera de estos registros." : "",
    "Este resumen cubre las fuentes y el periodo consultados; puede haber otras conversaciones fuera de ese alcance.",
    hasNonCompletionDate ? "Una fecha de programación, vencimiento o creación no confirma que la actividad se haya realizado ni cuál fue su resultado." : "",
  ].filter(Boolean).join("\n");
  return {
    answer, responseType: !usable ? "error" : "informational",
    confidence: partial ? "medium" : "high", source: "account_intelligence",
    operations: [], recommendedActions: [], pendingItems: [], inferences: [],
    evidence: coverage.filter((item) => ["complete", "partial"].includes(item.status)).map((item) =>
      `${item.title}: ${item.matched} coincidencia(s) fechadas del ${request.range.startDate} al ${request.range.endDate}; ${labels[item.status]}.`),
    entities: { accountId: request.memory.accountId,
      opportunityId: object === "opportunity" ? request.memory.targetId : null,
      contactId: object === "contact" ? request.memory.targetId : null },
    ...(!failed && usable ? { historyMemory: request.memory } : {}),
    activityHistory: {
      mode: "timeline", range: request.range, timezone, coverage, warnings,
      metadata: { partial, presentationLimited: limited, matched: dated.length, shown: items.length, undated: undated.length },
      sections: [
        { key: "timeline", title: "Cronología registrada", available: usable, unavailableMessage: "No se pudo consultar ninguna fuente solicitada.",
          items: items.filter((item) => item.date) },
        { key: "undated", title: "Sin fecha utilizable", available: true,
          subtitle: "No se incluyen en el conteo del periodo.", items: items.filter((item) => !item.date) },
      ],
    },
  };
}
