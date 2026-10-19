import { customerPendingSpecPatch, customerPendingSpecSchema, customerDateOnly } from "./turn-contract.js";
import { CUSTOMER_HISTORY_SOURCES, customerHistoryDate, resolveCustomerHistoryPeriod,
  resolveCustomerHistoryRequest } from "./customer-history.js";

const continuing = (movement) => ["continue", "correct", "answer_clarification", "select_candidate"].includes(movement);
const opportunities = (snapshot) => [...(snapshot.opportunities || []), ...(snapshot.inactiveOpportunities || []),
  ...(snapshot.selectedOpportunity ? [snapshot.selectedOpportunity] : [])];

export function validateCustomerPendingMemory(value, snapshot) {
  if (!value || Number(value.accountId) !== Number(snapshot.account?.id) ||
      !["account", "opportunity", "contact"].includes(value.object)) return null;
  const spec = customerPendingSpecSchema.safeParse(value.spec);
  if (!spec.success || spec.data.clarification || spec.data.unsupported?.length ||
      (spec.data.asOf && !customerDateOnly(spec.data.asOf)) ||
      (spec.data.period && !resolveCustomerHistoryPeriod(spec.data.period, new Date(), "UTC"))) return null;
  const records = value.object === "account" ? [snapshot.account] : value.object === "opportunity" ? opportunities(snapshot) :
    [...(snapshot.contacts || []), ...(snapshot.selectedContact ? [snapshot.selectedContact] : [])];
  return records.some((item) => Number(item.id) === Number(value.targetId) &&
    (value.object === "account" || Number(item.accountId) === Number(snapshot.account.id)))
    ? { accountId: Number(value.accountId), object: value.object, targetId: Number(value.targetId), spec: spec.data } : null;
}

export function resolveCustomerPendingRequest({ component, movement, previous, snapshot, context, now, timezone, businessRules }) {
  const fail = (error, responseType = "clarification") => ({ error, responseType });
  const parsed = customerPendingSpecSchema.safeParse(component.pendingSpec || {});
  if (!parsed.success) return fail("Los criterios de pendientes no son válidos. Precisa entidad, estados y fechas.");
  const patch = customerPendingSpecPatch(parsed.data);
  if (patch.contactReference && patch.opportunityReference) {
    return fail("Precisa si quieres pendientes del contacto o de la oportunidad; el filtro combinado no está soportado.");
  }
  const accountReference = String(component.reference || "").trim().toLocaleLowerCase("es") ===
    String(snapshot.account?.name || "").trim().toLocaleLowerCase("es");
  const object = patch.contactReference ? "contact" : patch.opportunityReference ? "opportunity" :
    component.object === "activity" ? component.reference && !accountReference ? "opportunity" :
      continuing(movement) && previous ? previous.object : "account" : component.object;
  const reference = patch.contactReference || patch.opportunityReference || component.reference || "";
  const target = resolveCustomerHistoryRequest({
    component: { object, reference, historySpec: { purpose: "absence_explanation",
      accountReference: patch.accountReference, clarification: patch.clarification, unsupported: patch.unsupported } },
    movement, previous, snapshot, context, now, timezone, businessRules,
  });
  if (target.error) return fail(target.error.replaceAll("historial", "pendientes"), target.responseType);
  const sameTarget = continuing(movement) && previous?.object === object && previous.targetId === Number(target.target.id);
  const spec = { ...(sameTarget ? previous.spec : {}), ...patch };
  if (spec.clarification) return fail(spec.clarification);
  if (spec.unsupported?.length) return fail(`Estos criterios de pendientes no están soportados: ${spec.unsupported.join(", ")}. No los omití.`, "informational");
  const range = spec.period && spec.period.mode !== "default" ? resolveCustomerHistoryPeriod(spec.period, now, timezone) : null;
  if (spec.period && spec.period.mode !== "default" && !range) return fail("Precisa un periodo válido con año y límites ordenados, de hasta cinco años.");
  const asOf = spec.asOf ? customerDateOnly(spec.asOf) : customerHistoryDate(now, timezone);
  if (!asOf) return fail("Indica una fecha de corte válida, con año, mes y día.");
  const effective = {
    mode: spec.mode || "all", asOf,
    ...(range ? { period: { mode: "absolute", ...range } } : {}),
    sources: [...new Set(spec.sources?.length ? spec.sources : ["opportunityActivities", "calendarActivities"])],
    statuses: [...new Set(spec.statuses?.length ? spec.statuses : ["pending"])],
    includeUndated: spec.includeUndated !== false, limit: Math.min(spec.limit || 50, 50),
    opportunityStatusCodes: spec.opportunityStatusCodes || [], activation: spec.activation || "all",
  };
  return { pending: true, target: target.target, range, spec: effective,
    memory: { accountId: Number(snapshot.account.id), object, targetId: Number(target.target.id), spec: effective } };
}

export function buildCustomerPendingReadFilter(source, request) {
  const alias = { opportunityActivities: "a", calendarActivities: "cca" }[source];
  if (!alias || !validateCustomerPendingReadRequest(request)) {
    throw Object.assign(new Error("Criterios de lectura de pendientes inválidos"), { code: "CUSTOMER_PENDING_READ_INVALID" });
  }
  const clauses = [`${alias}.status IN (${request.spec.statuses.map(() => "?").join(",")})`];
  const params = [...request.spec.statuses];
  const opportunity = source === "calendarActivities" ? "COALESCE(cca.opportunity_id, linked_i.primary_opportunity_id)" : "a.opportunity_id";
  if (request.memory.object === "opportunity") {
    clauses.push(`${opportunity} = ?`); params.push(request.memory.targetId);
  } else if (request.memory.object === "contact") {
    if (source !== "calendarActivities") throw Object.assign(new Error("Fuente sin vínculo explícito al contacto"), { code: "CUSTOMER_PENDING_RELATION_UNAVAILABLE" });
    clauses.push("cca.contact_id = ?"); params.push(request.memory.targetId);
  } else {
    clauses.push(`${opportunity} IS NOT NULL`);
  }
  if (request.spec.opportunityStatusCodes.length) {
    clauses.push(`EXISTS (SELECT 1 FROM opportunity_commercial_statuses pending_status
      WHERE pending_status.id=o.commercial_status_id AND pending_status.code IN (${request.spec.opportunityStatusCodes.map(() => "?").join(",")}))`);
    params.push(...request.spec.opportunityStatusCodes);
  }
  if (request.spec.activation !== "all") {
    clauses.push(`EXISTS (SELECT 1 FROM opportunity_activation_statuses pending_activation
      WHERE pending_activation.id=o.activation_status_id AND pending_activation.code ${request.spec.activation === "active" ? "=" : "<>"} 'activada')`);
  }
  return { sql: `AND ${clauses.join(" AND ")}`, params };
}

function validateCustomerPendingReadRequest(request) {
  return request?.pending === true && Number.isSafeInteger(request.memory?.targetId) && request.memory.targetId > 0 &&
    ["account", "opportunity", "contact"].includes(request.memory.object) &&
    customerPendingSpecSchema.safeParse(request.spec).success && request.spec.statuses?.length > 0;
}

export function buildCustomerPendingResponse({ request, snapshot, metrics = [], access, timezone }) {
  const authorized = new Map(opportunities(snapshot).filter((item) => Number(item.accountId) === request.memory.accountId)
    .map((item) => [Number(item.id), item]));
  const matched = [];
  const coverage = [];
  const scopeIncomplete = metrics.some((item) => ["opportunities_active", "opportunities_inactive"].includes(item.source) &&
    (item.errorCode || item.truncated !== false));
  const governed = /excluye/.test(snapshot.collectionScopes?.opportunities || "");
  for (const entry of access) {
    const metric = metrics.find((item) => item.source === CUSTOMER_HISTORY_SOURCES[entry.source].metric);
    const rows = snapshot[entry.source] || [];
    const unseen = rows.some((row) => row.opportunityId && !authorized.has(Number(row.opportunityId)));
    const status = entry.status !== "available" ? entry.status : metric?.errorCode ? "failed" :
      !metric || metric.truncated !== false || scopeIncomplete || governed || unseen ? "partial" : "complete";
    const items = [];
    if (["partial", "complete"].includes(status)) {
      const seen = new Set();
      for (const row of rows) {
        if (Number(row.accountId) !== request.memory.accountId || !Number.isSafeInteger(Number(row.id)) || Number(row.id) <= 0 ||
            seen.has(Number(row.id)) || !request.spec.statuses.includes(row.status)) continue;
        const opportunity = authorized.get(Number(row.opportunityId));
        if (request.memory.object !== "contact" && !opportunity) continue;
        if (row.opportunityId && !opportunity) continue;
        if (request.memory.object === "opportunity" && Number(row.opportunityId) !== request.memory.targetId) continue;
        if (request.memory.object === "contact" && Number(row.contactId) !== request.memory.targetId) continue;
        if (request.spec.opportunityStatusCodes.length &&
            !request.spec.opportunityStatusCodes.includes(opportunity?.commercialStatusCode)) continue;
        if (request.spec.activation !== "all" && (!opportunity?.activationStatusCode ||
            (request.spec.activation === "active") !== (opportunity.activationStatusCode === "activada"))) continue;
        seen.add(Number(row.id));
        const value = row.dueDate ?? row.scheduledAt;
        const date = customerHistoryDate(value, timezone);
        if (!date && !request.spec.includeUndated) continue;
        if (date && request.range && (date < request.range.startDate || date > request.range.endDate)) continue;
        if (date && request.spec.mode === "overdue" && date >= request.spec.asOf) continue;
        const item = { id: `${entry.source}:${row.id}`, recordId: Number(row.id), source: entry.source,
          sourceTitle: entry.title, title: row.title || "Actividad sin título", status: row.status,
          opportunityId: row.opportunityId || null, opportunityName: opportunity?.name || row.opportunityName || "",
          date: date || "", dateMeaning: date ? row.dueDate != null ? "Vencimiento" : "Programación" : "Sin fecha utilizable",
          overdue: date ? date < request.spec.asOf : null, activityType: row.actionType || row.activityType || "",
          details: row.notes || "" };
        items.push(item); matched.push(item);
      }
    }
    coverage.push({ ...entry, status, matched: items.length, undated: items.filter((item) => !item.date).length,
      recovered: ["partial", "complete"].includes(status) ? metric?.resultCount ?? rows.length : 0 });
  }
  matched.sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || a.id.localeCompare(b.id, "en", { numeric: true }));
  const items = matched.slice(0, request.spec.limit);
  for (const entry of coverage) entry.shown = items.filter((item) => item.source === entry.source).length;
  const partial = coverage.some((entry) => entry.status !== "complete");
  const usable = coverage.some((entry) => ["complete", "partial"].includes(entry.status));
  const labels = { complete: "lectura completa", partial: "lectura parcial o cobertura desconocida", failed: "falló la lectura",
    restricted: "sin permiso", disabled: "deshabilitada por el canal", not_applicable: "sin vínculo explícito admitido" };
  const warnings = coverage.filter((entry) => entry.status !== "complete").map((entry) => `${entry.title}: ${labels[entry.status]}.`);
  if (governed) warnings.push(`Alcance de oportunidades del canal: ${snapshot.collectionScopes.opportunities}.`);
  if (matched.length > items.length) warnings.push(`Se muestran como máximo ${request.spec.limit} actividades, sin paginación; hay más coincidencias recuperadas.`);
  const dated = items.filter((item) => item.date), undated = items.filter((item) => !item.date);
  const undatedCount = matched.filter((item) => !item.date).length;
  const datedCount = matched.length - undatedCount;
  const statusLabel = (status) => ({ pending: "pendiente", in_progress: "en curso", blocked: "bloqueada" })[status] || status;
  const answer = [
    `${request.spec.mode === "overdue" ? "Actividades vencidas" : "Actividades pendientes"} de ${request.target.name}.`,
    `Corte: ${request.spec.asOf}; zona horaria: ${timezone}.`,
    request.range ? `Periodo: ${request.range.startDate} al ${request.range.endDate}.` : "Sin límite temporal implícito.",
    request.spec.statuses.length !== 1 || request.spec.statuses[0] !== "pending"
      ? `Estados solicitados: ${request.spec.statuses.map(statusLabel).join(", ")}.` : "",
    request.spec.opportunityStatusCodes.length
      ? `Estados de oportunidad: ${request.spec.opportunityStatusCodes.join(", ")}.` : "",
    request.spec.activation !== "all" ? `Activación: ${request.spec.activation}.` : "",
    ...warnings,
    !usable ? "No se pudo verificar ninguna fuente solicitada; no puedo afirmar ausencia de pendientes." :
      !matched.length ? partial ? "La cobertura es incompleta; no puedo afirmar que no existan pendientes." :
        request.spec.mode === "overdue" ? "No encontré actividades vencidas en las fuentes y el alcance consultados." :
          "No encontré actividades pendientes en las fuentes y el alcance consultados." :
        request.spec.mode === "overdue"
          ? `${datedCount} vencida(s) con fecha verificable y ${undatedCount} sin fecha, no clasificable(s) como vencida(s).`
          : `${matched.length} actividad(es) pendiente(s) recuperada(s); ${items.length} mostrada(s).`,
    ...items.map((item) => `- ${item.sourceTitle}, registro ${item.recordId} · ${item.opportunityName || "Contacto seleccionado"} · ${item.title} · ${statusLabel(item.status)} · ${item.date ? `${item.dateMeaning}: ${item.date}` : "sin fecha; vencimiento no verificable"}`),
    undatedCount ? "Los registros sin fecha no se clasifican como vencidos; la fecha de creación no se usa como compromiso." :
      "Las fechas se identifican como vencimiento o programación; no demuestran por sí solas que una actividad se realizó.",
  ].filter(Boolean).join("\n");
  return { answer, responseType: usable ? "informational" : "error", source: "account_intelligence", confidence: partial ? "medium" : "high",
    operations: [], recommendedActions: [], pendingItems: items.map((item) => `${item.title} (${item.sourceTitle}, registro ${item.recordId})`),
    inferences: [], evidence: coverage.filter((entry) => ["complete", "partial"].includes(entry.status))
      .map((entry) => `${entry.title}: ${entry.matched} coincidencias recuperadas; ${labels[entry.status]}.`),
    entities: { accountId: request.memory.accountId,
      opportunityId: request.memory.object === "opportunity" ? request.memory.targetId : null,
      contactId: request.memory.object === "contact" ? request.memory.targetId : null },
    ...(usable && !coverage.some((entry) => entry.status === "failed") ? { pendingMemory: request.memory } : {}),
    activityHistory: { mode: "pending", timezone, coverage, warnings,
      ...(request.range ? { range: request.range } : {}),
      metadata: { partial, presentationLimited: matched.length > items.length, matched: matched.length, shown: items.length,
        undated: matched.filter((item) => !item.date).length },
      sections: [
        { key: "pending", title: request.spec.mode === "overdue" ? "Vencidas con fecha verificable" : "Pendientes con fecha",
          available: usable, unavailableMessage: "No se pudieron verificar las fuentes solicitadas.", items: dated },
        { key: "undated", title: "Sin fecha utilizable", available: usable,
          subtitle: "No se consideran vencidas ni se usa la fecha de creación como compromiso.", items: undated },
      ] },
  };
}
