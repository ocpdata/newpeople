import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getQuotationStatusTone } from "./quotations/quotationStatusPresentation";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Database,
  LayoutDashboard,
  Lightbulb,
  MessageCircle,
  Pencil,
  Search,
  Settings2,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react";
import { api, getApiErrorMessage } from "./api";
import { validateCustomerChatObservedFlow } from "./customer-chat-trace-validation";
import "./mi-agent.css";
import "./mi-agent-prospect.css";
import "./mi-agent-navigation.css";
import "./mi-agent-detail.css";
import "./mi-agent-execution-kit.css";
import "./mi-agent-health.css";
import "./mi-agent-alerts.css";
import "./mi-agent-activity-progress.css";
import "./mi-agent-activity-message.css";
import "./mi-agent-coach.css";
import "./mi-agent-feedback.css";
import "./mi-agent-rules.css";
import "./mi-agent-coach-thread.css";

const PRIORITY_LABELS = {
  critical: "Critica",
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

const ACTION_STATUS_LABELS = {
  pending: "Pendiente",
  done: "Creada",
};

const CUSTOMER_ACTIVITY_STATUS_LABELS = {
  pending: "Pendiente",
  in_progress: "En curso",
  done: "Completada",
  completed: "Completada",
  cancelled: "Cancelada",
  blocked: "Bloqueada",
};

const CUSTOMER_ACTIVITY_TYPE_LABELS = {
  producto: "Producto",
  service: "Servicio",
  servicio: "Servicio",
  call: "Llamada",
  meeting: "Reunión",
  email: "Correo",
  visit: "Visita",
  demo: "Demostración",
  presentation: "Presentación",
};
const CUSTOMER_CHAT_DEBUG_GUIDE = {
  B1: {
    purpose: "Recibe la pregunta y la muestra en el chat.",
    check: "Que el texto de la pregunta sea el esperado.",
  },
  B2: {
    purpose: "Asocia la pregunta con una sesión y crea el job del turno.",
    check:
      "IDs de sesión y job, y aceptación del job. Pending es normal; B1 consulta el resultado después.",
  },
  B3: {
    purpose: "Autoriza el contexto CRM, carga el snapshot y prepara agentes.",
    check: "Contexto validado, métricas del snapshot y estado de agentes.",
  },
  B4: {
    purpose:
      "Adapta contexto, reglas y catálogo de herramientas para el motor.",
    check:
      "Que la invocación enviada a B5 refleje el contexto y las políticas.",
  },
  B5: {
    purpose: "Orquesta el turno y devuelve una respuesta normalizada a B4.",
    check:
      "Tipo, validación, aclaración y latencia; el plan detallado está en B6.",
  },
  B6: {
    purpose: "Propone el plan estructurado que B5 valida antes de usar.",
    check:
      "Intención, cardinalidad, referencias opacas, herramientas y filtros.",
  },
  B7: {
    purpose: "Convierte el plan en lecturas concretas.",
    check: "Qué consultas se autorizaron y cuáles quedaron fuera.",
  },
  B8: {
    purpose: "Lee datos CRM dentro de la cuenta autorizada.",
    check:
      "Conteos, errores y truncamientos; no se muestran filas CRM completas.",
  },
  B9: {
    purpose: "Comprueba si la evidencia alcanza para responder.",
    check: "Estado, hechos faltantes, consultas fallidas y límites.",
  },
  B10: {
    purpose: "Construye y valida la respuesta final.",
    check: "Tipo de respuesta, fallback y resultado de la auditoría.",
  },
  B11: {
    purpose: "Guarda respuesta, historial y contexto del siguiente turno.",
    check: "Si el contexto se recalculó o se conservó.",
  },
};

const CUSTOMER_CHAT_DEBUG_STATUS_LABELS = {
  completed: "Completado",
  executed: "Se ejecutaron lecturas",
  no_reads: "No necesitó leer CRM",
  not_reached: "No alcanzado",
  sufficient: "Evidencia suficiente",
  no_results: "Sin coincidencias",
  clarification: "Necesita precisión",
  error: "Error",
  query_error: "Falló una consulta",
  query_limit_reached: "Límite de consultas",
  insufficient_evidence: "Falta evidencia",
  timeout: "Tiempo agotado",
  verification_unavailable: "Verificación no disponible",
  verification_error: "Falló la verificación",
};

function summarizeDebugTools(toolNames = []) {
  const names = Array.isArray(toolNames) ? toolNames.filter(Boolean) : [];
  if (!names.length) return "ninguna";
  const visibleNames = names.slice(0, 4).join(", ");
  return names.length > 4
    ? `${visibleNames} y ${names.length - 4} más`
    : visibleNames;
}

function summarizeDebugToolMetrics(toolMetrics = []) {
  const metrics = Array.isArray(toolMetrics) ? toolMetrics : [];
  if (!metrics.length) return "No se registraron lecturas";
  return metrics
    .slice(0, 4)
    .map((metric) => {
      const count = Number(metric.resultCount || 0);
      const resultText = `${count} resultado${count === 1 ? "" : "s"}`;
      const statusText = metric.errorCode
        ? `error: ${metric.errorCode}`
        : metric.truncated === true
          ? "truncado"
          : "correcto";
      return `${metric.toolName}: ${resultText}, ${statusText}`;
    })
    .join("; ");
}

function summarizeDebugSnapshotMetrics(snapshotMetrics = []) {
  const metrics = Array.isArray(snapshotMetrics) ? snapshotMetrics : [];
  if (!metrics.length) return "sin métricas de snapshot";
  return metrics
    .slice(0, 4)
    .map((metric) => {
      const count = Number(metric.resultCount || 0);
      const truncated = metric.truncated === true ? ", truncado" : "";
      return `${metric.source}: ${count}${truncated}`;
    })
    .join("; ");
}

function summarizeDebugPolicy(policy = {}) {
  if (!policy || typeof policy !== "object") return "sin política registrada";
  const summarizeFlags = (values = {}) =>
    Object.entries(values)
      .map(([name, value]) => `${name} ${value ? "sí" : "no"}`)
      .join(", ") || "ninguna";
  const channelRules = summarizeFlags(policy.channelRules);
  const businessScope = summarizeFlags(
    policy.businessRuleScope || policy.businessScope,
  );
  const operationKinds = summarizeDebugTools(
    policy.operationPolicy?.allowedKinds || policy.allowedOperationKinds,
  );
  const toolNames = summarizeDebugTools(
    policy.availableTools || policy.toolCatalog,
  );
  return `reglas de canal: ${channelRules}; alcance: ${businessScope}; operaciones: ${operationKinds}; herramientas: ${toolNames}`;
}

function summarizeDebugRouting(routing = {}) {
  if (!routing || typeof routing !== "object") return "sin ruta validada";
  const intents = routing.intents || (routing.intent ? [routing.intent] : []);
  const tools = routing.allowedTools || [];
  const reference = routing.referenceResolution;
  const filters = Object.entries(routing.filters || {})
    .filter(
      ([, value]) => value !== null && value !== undefined && value !== "",
    )
    .map(
      ([key, value]) =>
        `${key}: ${Array.isArray(value) ? value.join(", ") : value}`,
    );
  return (
    [
      intents.length ? `intenciones: ${summarizeDebugTools(intents)}` : null,
      reference
        ? `objetivo ${reference.targetType || "sin tipo"} (${reference.cardinality || "sin cardinalidad"}, ${reference.source || "sin origen"})`
        : null,
      tools.length
        ? `herramientas autorizadas: ${summarizeDebugTools(tools)}`
        : null,
      filters.length ? `filtros: ${filters.join(", ")}` : null,
      routing.requiresClarification ? "requiere aclaración" : null,
    ]
      .filter(Boolean)
      .join("; ") || "sin consultas enrutadas"
  );
}

function summarizeCustomerChatDebugStep(item) {
  const input = item.input || {};
  const output = item.output || {};
  const reference = output.normalizedPlan?.referenceResolution || {};
  const context = input.context || {};
  const engineInput = output.engineInput || {};
  const metrics = output.toolMetrics || [];
  const snapshotMetrics = output.snapshotMetrics || [];
  const proposedPlan = output.proposedPlan || null;
  const routingValidation = output.routingValidation || null;
  const normalizedRouting = output.normalizedPlan || null;
  const answerAudit = output.auditDiagnostics || null;
  const contextSummary = (value) =>
    [
      value.accountId ? `cuenta ${value.accountId}` : null,
      value.opportunityId ? `oportunidad ${value.opportunityId}` : null,
      value.contactId ? `contacto ${value.contactId}` : null,
      value.leadId ? `lead ${value.leadId}` : null,
    ]
      .filter(Boolean)
      .join(", ") || "sin entidad seleccionada";
  const answerPreview = String(output.answer || "")
    .replace(/\s+/g, " ")
    .trim();

  switch (item.block) {
    case "B1":
      return {
        input: `Cuenta enviada: ${input.accountId || "no indicada"}; pregunta: ${String(input.question || "").slice(0, 180)}`,
        output: output.forwardedToApi
          ? "Solicitud enviada a la API. Este bloque no representa la respuesta final; consulta el acuse y el resultado en Comunicación navegador ↔ API, dentro de Flujo observado."
          : "No se confirma el envío a la API; revisa Comunicación navegador ↔ API dentro de Flujo observado.",
      };
    case "B2":
      return {
        input: `${input.chatSessionId ? `Sesión ${input.chatSessionId}` : "Sesión nueva"}; pregunta de ${input.questionLength || 0} caracteres.`,
        output: output.accepted
          ? `B2 aceptó el job ${output.jobId || "sin ID"}; estado inicial ${output.initialStatus || "desconocido"}. Pending es normal mientras B1 consulta el resultado; revisa esas consultas en Comunicación navegador ↔ API, dentro de Flujo observado.`
          : `B2 no confirmó la aceptación del job ${output.jobId || "sin ID"}. Revisa Comunicación navegador ↔ API dentro de Flujo observado.`,
      };
    case "B3":
      return {
        input: `Se solicitó contexto de la cuenta ${input.accountId || "no indicada"}.`,
        output: `${contextSummary(output.validatedContext || {})}; snapshot: ${summarizeDebugSnapshotMetrics(snapshotMetrics)}; ${output.agentMetrics?.length || 0} agentes preparados.`,
      };
    case "B4":
      return {
        input: `${input.channel || "Canal desconocido"}; ${contextSummary(input.context || {})}; ${input.preparedAgentCount || 0} agentes preparados.`,
        output: `Entrega a B5: ${engineInput.channel || "canal desconocido"}; contexto ${contextSummary(engineInput.context || {})}; ${engineInput.historyMessageCount || 0} mensajes de historial; ${summarizeDebugPolicy(engineInput.policy)}.`,
      };
    case "B5":
      const responseTypeOrigin =
        output.responseTypeSource === "customer_account_default"
          ? "original omitido; default de Cliente existente aplicado"
          : output.responseTypeSource === "upstream"
            ? "recibido del resultado previo"
            : "origen no identificado";
      return {
        input: `${input.channel || "Canal desconocido"}; ${contextSummary(context)}; ${input.conversationContext?.intents?.length ? `intenciones previas: ${summarizeDebugTools(input.conversationContext.intents)}` : "sin intención conversacional previa"}; ${input.historyMessageCount || 0} mensajes; ${summarizeDebugPolicy(input.policy)}.`,
        output: `${output.plannerRoutingReturned ? "Recibió una ruta normalizada del planificador" : "No recibió una ruta normalizada"}; respuesta ${output.responseType || "sin tipo"} (${responseTypeOrigin})${output.validationStatus ? `; validación ${output.validationStatus}` : ""}${output.confidence ? `; confianza ${output.confidence}` : ""}; ${output.answerLength || 0} caracteres, ${output.operationCount || 0} operaciones propuestas, ${output.latencyMs ?? "sin dato"} ms.`,
      };
    case "B6":
      return {
        input: `Recibe ${input.questionLength || 0} caracteres; contexto ${contextSummary(input.selectedContext || {})}; intenciones disponibles: ${summarizeDebugTools(input.enabledIntentCodes)}; herramientas autorizadas: ${summarizeDebugTools(input.availableToolNames)}; ${Object.values(input.candidateCounts || {}).reduce((total, count) => total + Number(count || 0), 0)} candidatos opacos.`,
        output: proposedPlan?.hasPlan
          ? `B6 propuso ${summarizeDebugRouting(proposedPlan.proposedRouting)}. B5 ${routingValidation?.accepted ? "aceptó y normalizó" : "rechazó"} la propuesta${routingValidation?.rejectedIntents?.length ? `; intenciones rechazadas: ${summarizeDebugTools(routingValidation.rejectedIntents)}` : ""}${routingValidation?.rejectedTools?.length ? `; herramientas rechazadas: ${summarizeDebugTools(routingValidation.rejectedTools)}` : ""}. Ruta efectiva: ${summarizeDebugRouting(normalizedRouting)}.`
          : `No hubo plan aplicable: ${routingValidation?.rejectionReason || output.diagnostics?.reasonCode || output.diagnostics?.source || "sin diagnóstico"}.`,
      };
    case "B7":
      return {
        input: `Ruta que recibió B7: ${summarizeDebugRouting(input.validatedRouting)}; política efectiva: ${summarizeDebugPolicy(input.policy)}.`,
        output: `Fuentes de snapshot disponibles: ${summarizeDebugTools(output.availableSources)}; herramientas del plan: ${summarizeDebugTools(input.plannedTools)}.`,
      };
    case "B8":
      return {
        input: `Herramientas ejecutadas: ${summarizeDebugTools(input.toolNames)}.`,
        output: summarizeDebugToolMetrics(metrics),
      };
    case "B9":
      return {
        input: `Verifica ${metrics.length} métricas de herramientas.`,
        output: output.status
          ? `Evidencia ${output.status}; ${output.rounds || 0} rondas, ${output.missingFactsCount || 0} hechos faltantes${output.errorCode ? `, error ${output.errorCode}` : ""}.`
          : "La verificación no se alcanzó.",
      };
    case "B10":
      return {
        input: `Evidencia ${input.evidenceStatus || "sin estado"}; respuesta tipo ${input.responseType || "sin tipo"}.`,
        output: answerPreview
          ? `Respuesta: ${answerPreview.slice(0, 180)}${answerPreview.length > 180 ? "…" : ""}${answerAudit ? `; auditoría IA ${answerAudit.status || "sin dictamen"}${answerAudit.unsupportedClaims?.length ? `, ${answerAudit.unsupportedClaims.length} afirmaciones no respaldadas` : ""}` : ""}`
          : "No hay texto de respuesta.",
      };
    case "B11":
      return {
        input: `Job ${input.jobId || "?"} y sesión ${input.chatSessionId || "?"}.`,
        output: `Job ${output.jobStatus || "sin estado"}; ${output.historyMessageCount || 0} mensajes guardados; contexto ${output.contextDisposition || "sin dato"}.`,
      };
    default:
      return {
        input: "Entrada disponible en los detalles JSON.",
        output: "Respuesta disponible en los detalles JSON.",
      };
  }
}

const CUSTOMER_CHAT_DEBUG_CHECK_LABELS = {
  pass: "Correcto",
  warning: "Revisar",
  error: "Error",
  not_applicable: "No aplica",
  not_checked: "No evaluado",
};

const CUSTOMER_CHAT_DEBUG_EXPECTED_BLOCKS = [
  "B1",
  "B2",
  "B3",
  "B4",
  "B5",
  "B6",
  "B7",
  "B8",
  "B9",
  "B10",
  "B11",
];

function CustomerChatDebugStep({ item, issueBlock, traceId }) {
  const summaries = summarizeCustomerChatDebugStep(item);
  return (
    <article
      id={`${traceId}-block-${item.block}`}
      className={`mi-agent-customer-chat-debug-step${
        item.block === issueBlock ? " is-problem" : ""
      }`}
    >
      <div className="mi-agent-customer-chat-debug-step-heading">
        <strong>
          {item.block} · {item.label}
        </strong>
        <small>
          {item.block === "B2"
            ? item.output?.accepted
              ? "Job aceptado"
              : "Job no aceptado"
            : CUSTOMER_CHAT_DEBUG_STATUS_LABELS[item.status] || item.status}
        </small>
      </div>
      <span>{CUSTOMER_CHAT_DEBUG_GUIDE[item.block]?.purpose}</span>
      <div className="mi-agent-customer-chat-debug-step-summary">
        <p>
          <strong>Entrada:</strong> {summaries.input}
        </p>
        <p>
          <strong>
            {item.block === "B1"
              ? "Estado del envío:"
              : item.block === "B2"
                ? "Acuse del job:"
                : item.block === "B5"
                  ? "Retorno a B4:"
                  : "Respuesta:"}
          </strong>{" "}
          {summaries.output}
        </p>
      </div>
      {item.block === "B10" && item.output?.auditDiagnostics ? (
        <details className="mi-agent-customer-chat-debug-step-details">
          <summary>Ver diagnóstico de auditoría IA</summary>
          <pre>{JSON.stringify(item.output.auditDiagnostics, null, 2)}</pre>
        </details>
      ) : null}
      {Array.isArray(item.checks) && item.checks.length ? (
        <ul className="mi-agent-customer-chat-debug-checks">
          {item.checks.map((check) => (
            <li
              id={`${traceId}-check-${item.block}-${check.field}`}
              key={check.field}
              className={`is-${check.state || "not_checked"}`}
            >
              <span className="mi-agent-customer-chat-debug-check-state">
                {CUSTOMER_CHAT_DEBUG_CHECK_LABELS[check.state] || "No evaluado"}
              </span>
              <span>
                <strong>{check.field}:</strong> {check.message}
              </span>
              <small>
                Esperado: {check.expected}; recibido:{" "}
                {JSON.stringify(check.actual)}
              </small>
            </li>
          ))}
        </ul>
      ) : (
        <small className="mi-agent-customer-chat-debug-no-checks">
          Este bloque no tiene comprobaciones estructuradas en este diagnóstico.
        </small>
      )}
      <small className="mi-agent-customer-chat-debug-step-guide">
        Revisar: {CUSTOMER_CHAT_DEBUG_GUIDE[item.block]?.check}
      </small>
      {item.input || item.output ? (
        <details className="mi-agent-customer-chat-debug-step-details">
          <summary>
            {item.block === "B1"
              ? "Ver datos técnicos del envío"
              : item.block === "B2"
                ? "Ver datos registrados y acuse del job"
                : "Ver JSON técnico de entrada y respuesta"}
          </summary>
          <div>
            <section>
              <strong>
                {item.block === "B1"
                  ? "Solicitud enviada"
                  : item.block === "B2"
                    ? "Datos registrados por B2"
                    : "Entrada"}
              </strong>
              <pre>{JSON.stringify(item.input ?? null, null, 2)}</pre>
            </section>
            <section>
              <strong>
                {item.block === "B1"
                  ? "Estado de envío"
                  : item.block === "B2"
                    ? "Acuse del job"
                    : "Respuesta"}
              </strong>
              <pre>{JSON.stringify(item.output ?? null, null, 2)}</pre>
            </section>
          </div>
        </details>
      ) : null}
    </article>
  );
}

function buildCustomerChatExecutionSpans(events = []) {
  const spans = new Map();
  events.forEach((event) => {
    if (!event?.spanId) return;
    const span = spans.get(event.spanId) || {
      id: event.spanId,
      children: [],
      sequence: Number(event.sequence || 0),
    };
    if (event.phase === "call") {
      Object.assign(span, {
        lane: event.lane || "worker",
        parentSpanId: event.parentSpanId || null,
        from: event.from,
        to: event.to,
        label: event.label,
        startedAt: event.at || null,
        input: event.input ?? null,
        status: event.status || "started",
        sequence: Number(event.sequence || span.sequence),
      });
    } else {
      Object.assign(span, {
        returnedAt: event.at || null,
        status: event.status || "unknown",
        durationMs: Number(event.durationMs || 0),
        output: event.output ?? null,
        errorCode: event.errorCode || null,
        returnFrom: event.from,
        returnTo: event.to,
      });
    }
    spans.set(event.spanId, span);
  });

  const roots = [];
  [...spans.values()]
    .sort((left, right) => left.sequence - right.sequence)
    .forEach((span) => {
      const parent = spans.get(span.parentSpanId);
      if (parent) parent.children.push(span);
      else roots.push(span);
    });
  return roots;
}

function CustomerChatExecutionSpan({ span }) {
  const statusLabels = {
    completed: "Retornó",
    failed: "Falló",
    started: "Sin retorno registrado",
    unavailable: "No disponible",
    no_new_results: "Sin nuevas lecturas",
  };

  return (
    <li id={span.traceElementId} className={`is-${span.status || "unknown"}`}>
      <details open={span.status === "failed"}>
        <summary>
          <strong>
            {span.from} → {span.to} · {span.label || "Llamada"}
          </strong>
          <small>
            {statusLabels[span.status] || span.status || "Estado desconocido"}
            {span.durationMs != null ? ` · ${span.durationMs} ms` : ""}
          </small>
        </summary>
        <div className="mi-agent-customer-chat-detailed-span-content">
          <small>
            {span.startedAt
              ? `Inicio: ${span.startedAt}`
              : "Inicio sin registrar"}
            {span.returnedAt ? ` · Retorno: ${span.returnedAt}` : ""}
          </small>
          {span.returnFrom && span.returnTo ? (
            <small>
              Retorno: {span.returnFrom} → {span.returnTo}
            </small>
          ) : null}
          <details>
            <summary>Datos enviados</summary>
            <pre>{JSON.stringify(span.input ?? null, null, 2)}</pre>
          </details>
          <details>
            <summary>Datos recibidos</summary>
            <pre>
              {JSON.stringify(
                span.errorCode ? { errorCode: span.errorCode } : span.output,
                null,
                2,
              )}
            </pre>
          </details>
          {span.children.length ? (
            <ol>
              {span.children.map((child) => (
                <CustomerChatExecutionSpan key={child.id} span={child} />
              ))}
            </ol>
          ) : null}
        </div>
      </details>
    </li>
  );
}

function countCustomerChatSpans(spans) {
  return spans.reduce(
    (count, span) => count + 1 + countCustomerChatSpans(span.children),
    0,
  );
}

function CustomerChatDetailedTrace({ debug, transportTrace }) {
  const turnDebug = debug || {};
  const executionEvents = Array.isArray(turnDebug.executionTrace)
    ? turnDebug.executionTrace
    : [];
  const workerSpans = buildCustomerChatExecutionSpans(executionEvents);
  const workerSpanCount = countCustomerChatSpans(workerSpans);
  const exchanges = Array.isArray(transportTrace?.exchanges)
    ? transportTrace.exchanges
    : [];
  const traceId = turnDebug.currentTurn?.jobId
    ? `customer-chat-${turnDebug.currentTurn.jobId}`
    : `customer-chat-session-${turnDebug.currentTurn?.chatSessionId || "unknown"}`;
  const integrityChecks = validateCustomerChatObservedFlow({
    events: executionEvents,
    exchanges,
  });
  const integrityCounts = integrityChecks.reduce(
    (counts, check) => ({
      ...counts,
      [check.state]: (counts[check.state] || 0) + 1,
    }),
    {},
  );
  const navigateToTraceEvent = (target) => {
    if (!target) return;
    const elementId =
      target.type === "span"
        ? `${traceId}-span-${target.id}`
        : `${traceId}-exchange-${target.id}`;
    const element = document.getElementById(elementId);
    if (!element) return;
    for (
      let parent = element.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    }
    window.requestAnimationFrame(() =>
      element.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  };
  const prepareSpans = (spans) =>
    spans.map((span) => ({
      ...span,
      traceElementId: `${traceId}-span-${span.id}`,
      children: prepareSpans(span.children),
    }));
  const renderedWorkerSpans = prepareSpans(workerSpans);

  return (
    <details className="mi-agent-customer-chat-detailed-trace">
      <summary>
        Flujo observado · {workerSpanCount} llamadas del worker ·{" "}
        {exchanges.length} intercambios del navegador
      </summary>
      <div className="mi-agent-customer-chat-detailed-trace-content">
        <p>
          Son dos carriles con relojes independientes. Los retornos se enlazan
          con su llamada; las llamadas hijas aparecen anidadas. Los datos CRM se
          muestran como resúmenes saneados. Las intenciones y reglas se ven en
          los datos de B4→B5, B5→B6, la validación de B5 y B5→B7/B10.
        </p>
        <details
          className="mi-agent-customer-chat-flow-integrity"
          open={Boolean(integrityCounts.error)}
        >
          <summary>
            Integridad del flujo · {integrityCounts.error || 0} errores ·{" "}
            {integrityCounts.warning || 0} advertencias ·{" "}
            {integrityCounts.pass || 0} correctas
            {integrityCounts.not_checked
              ? ` · ${integrityCounts.not_checked} sin datos`
              : ""}
          </summary>
          <ul>
            {integrityChecks.map((check) => (
              <li key={check.key} className={`is-${check.state}`}>
                <span>{check.message}</span>
                {check.target ? (
                  <button
                    type="button"
                    onClick={() => navigateToTraceEvent(check.target)}
                  >
                    Ir al{" "}
                    {check.target.type === "span" ? "span" : "intercambio"}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
        <section>
          <h4>Comunicación navegador ↔ API · B1 ↔ B2</h4>
          {exchanges.length ? (
            <ol>
              {exchanges.map((exchange, index) => (
                <li
                  id={`${traceId}-exchange-${index}`}
                  key={`${exchange.label}-${index}`}
                  className={`is-${exchange.outcome || "unknown"}`}
                >
                  <strong>
                    {exchange.kind === "local"
                      ? `B1 · ${exchange.label}`
                      : `B1 → B2 · ${exchange.method} ${exchange.path}`}
                  </strong>
                  <small>
                    {exchange.kind === "local" ? "" : "B2 → B1 · "}
                    {exchange.outcome || "resultado desconocido"}
                    {exchange.httpStatus
                      ? ` · HTTP ${exchange.httpStatus}`
                      : ""}
                    {exchange.durationMs != null
                      ? ` · ${exchange.durationMs} ms`
                      : ""}
                    {exchange.pollCount
                      ? ` · ${exchange.pollCount} consultas`
                      : ""}
                  </small>
                  {exchange.startedAt ? (
                    <small>Inicio: {exchange.startedAt}</small>
                  ) : null}
                  {exchange.finishedAt ? (
                    <small>Fin: {exchange.finishedAt}</small>
                  ) : null}
                  {exchange.pollEvents?.length ? (
                    <details>
                      <summary>Estados observados por consulta</summary>
                      <pre>{JSON.stringify(exchange.pollEvents, null, 2)}</pre>
                    </details>
                  ) : null}
                  <details>
                    <summary>Datos enviados</summary>
                    <pre>
                      {JSON.stringify(
                        exchange.requestSummary ?? {
                          method: exchange.method || null,
                          path: exchange.path || null,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                  <details>
                    <summary>Respuesta resumida</summary>
                    <pre>
                      {JSON.stringify(
                        exchange.responseSummary ?? null,
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </li>
              ))}
            </ol>
          ) : (
            <p>No hay intercambios de navegador disponibles para este turno.</p>
          )}
        </section>
        <section>
          <h4>Worker · B2 → B11</h4>
          {workerSpans.length ? (
            <ol>
              {renderedWorkerSpans.map((span) => (
                <CustomerChatExecutionSpan key={span.id} span={span} />
              ))}
            </ol>
          ) : (
            <p>
              Este resultado no contiene spans internos observados. Puede
              corresponder a un turno anterior a la instrumentación o a un fallo
              ocurrido antes de iniciar el worker.
            </p>
          )}
        </section>
        <section>
          <h4>Contexto del turno</h4>
          <details>
            <summary>Datos recibidos y diagnóstico del turno actual</summary>
            <pre>{JSON.stringify(turnDebug.currentTurn ?? null, null, 2)}</pre>
          </details>
          <details>
            <summary>Contexto e historial para el siguiente turno</summary>
            <pre>{JSON.stringify(turnDebug.nextTurn ?? null, null, 2)}</pre>
          </details>
        </section>
      </div>
    </details>
  );
}

function CustomerChatDebugResult({ debug }) {
  const issue = debug?.issue || {};
  const currentTurn = debug?.currentTurn || {};
  const flow = Array.isArray(debug?.flow) ? debug.flow : [];
  const b3 = flow.find((item) => item.block === "B3");
  const b9 = flow.find((item) => item.block === "B9");
  const accountId =
    debug?.nextTurn?.context?.accountId ||
    currentTurn.validatedContextReceived?.accountId ||
    currentTurn.accountId ||
    b3?.output?.validatedContext?.accountId ||
    b3?.input?.accountId;
  const evidenceStatus =
    currentTurn.diagnostics?.evidence?.status || b9?.output?.status;
  const evidenceLabels = {
    sufficient: "evidencia suficiente",
    no_results: "sin coincidencias",
    clarification: "requiere precisión",
    insufficient_evidence: "evidencia incompleta",
    query_error: "falló una consulta",
    timeout: "tiempo agotado",
  };
  const isSuccess = issue.severity === "success";
  const title = issue.block
    ? `${issue.title || "Revisión requerida"} · ${issue.block}`
    : isSuccess
      ? "Turno completado"
      : issue.title || "Resultado del turno";
  const metadata = [
    currentTurn.jobId ? `Job ${currentTurn.jobId}` : null,
    currentTurn.chatSessionId ? `Sesión ${currentTurn.chatSessionId}` : null,
    accountId ? `Cuenta ${accountId}` : null,
    evidenceStatus
      ? evidenceLabels[evidenceStatus] || `evidencia: ${evidenceStatus}`
      : null,
  ].filter(Boolean);

  return (
    <div className="mi-agent-customer-chat-debug-result">
      <div className="mi-agent-customer-chat-debug-result-heading">
        <strong>{title}</strong>
        {issue.message ? <p>{issue.message}</p> : null}
      </div>
      {metadata.length ? (
        <ul aria-label="Resumen del turno">
          {metadata.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      {!isSuccess && issue.nextAction ? (
        <small>{issue.nextAction}</small>
      ) : null}
    </div>
  );
}

function CustomerChatDebugConnector({
  label,
  kind = "call",
  direction = "down",
}) {
  return (
    <div
      className={`mi-agent-customer-chat-debug-connector is-${kind} is-${direction}`}
      aria-label={label}
    >
      <span aria-hidden="true">{direction === "right" ? "→" : "↓"}</span>
      <small>{label}</small>
    </div>
  );
}

function CustomerChatDebugFlow({ debug, transportTrace }) {
  const flow = Array.isArray(debug.flow) ? debug.flow : [];
  const traceId = debug.currentTurn?.jobId
    ? `customer-chat-${debug.currentTurn.jobId}`
    : `customer-chat-session-${debug.currentTurn?.chatSessionId || "unknown"}`;
  const blocks = new Map(flow.map((item) => [item.block, item]));
  const checks = flow.flatMap((item) =>
    (Array.isArray(item.checks) ? item.checks : []).map((check) => ({
      ...check,
      block: item.block,
    })),
  );
  const checkCounts = checks.reduce(
    (counts, check) => ({
      ...counts,
      [check.state || "not_checked"]:
        (counts[check.state || "not_checked"] || 0) + 1,
    }),
    {},
  );
  const attentionChecks = checks.filter((check) =>
    ["error", "warning"].includes(check.state),
  );
  const missingBlocks = CUSTOMER_CHAT_DEBUG_EXPECTED_BLOCKS.filter(
    (block) => !blocks.has(block),
  );
  const navigateToCheck = (block, field) => {
    const map = document.getElementById(`${traceId}-map`);
    const target = document.getElementById(
      `${traceId}-check-${block}-${field}`,
    );
    if (!map || !target) return;
    map.open = true;
    window.requestAnimationFrame(() =>
      target.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  };
  const edgeLabel = (from, to, kind, fallback) =>
    debug.flowEdges?.find(
      (edge) => edge.from === from && edge.to === to && edge.kind === kind,
    )?.label || fallback;
  const issueBlock = debug.issue?.block;
  const renderStep = (block) => {
    const item = blocks.get(block);
    return item ? (
      <CustomerChatDebugStep
        key={block}
        item={item}
        issueBlock={issueBlock}
        traceId={traceId}
      />
    ) : (
      <div
        key={block}
        className="mi-agent-customer-chat-debug-missing-block"
        role="status"
      >
        {block} no aparece en la traza.
      </div>
    );
  };

  return (
    <>
      <CustomerChatDetailedTrace
        debug={debug}
        transportTrace={transportTrace}
      />
      <details
        id={`${traceId}-map`}
        className="mi-agent-customer-chat-debug-map"
      >
        <summary>
          Mapa de bloques · {blocks.size} de{" "}
          {CUSTOMER_CHAT_DEBUG_EXPECTED_BLOCKS.length} presentes ·{" "}
          {checkCounts.error || 0} errores · {checkCounts.warning || 0} por
          revisar · {checkCounts.pass || 0} correctas ·{" "}
          {checkCounts.not_applicable || 0} no aplican
        </summary>
        <div className="mi-agent-customer-chat-debug-flow-map">
          {attentionChecks.length ? (
            <section className="mi-agent-customer-chat-debug-map-attention">
              <strong>
                Checks que requieren atención · {attentionChecks.length}
              </strong>
              <ul>
                {attentionChecks.map((check) => (
                  <li
                    key={`${check.block}-${check.field}`}
                    className={`is-${check.state}`}
                  >
                    <div>
                      <strong>
                        {check.block} · {check.field}
                      </strong>
                      <span>{check.message}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigateToCheck(check.block, check.field)}
                    >
                      Ir al check
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {missingBlocks.length ? (
            <p className="mi-agent-customer-chat-debug-result-warning">
              Faltan bloques en la traza: {missingBlocks.join(", ")}.
            </p>
          ) : null}
          <section className="mi-agent-customer-chat-debug-phase">
            <h3>1. La interfaz envía la pregunta y recibe un job</h3>
            <div className="mi-agent-customer-chat-debug-lane">
              {renderStep("B1")}
              <CustomerChatDebugConnector
                kind="request"
                direction="right"
                label={edgeLabel("B1", "B2", "request", "POST pregunta")}
              />
              {renderStep("B2")}
            </div>
            <CustomerChatDebugConnector
              kind="dispatch"
              label={edgeLabel(
                "B2",
                "B3",
                "dispatch",
                "despacha el job en segundo plano",
              )}
            />
          </section>

          <section className="mi-agent-customer-chat-debug-scope is-service">
            <header>
              <h3>2. B3 mantiene el control del job</h3>
              <p>
                Prepara el contexto, delega el turno y persiste el resultado al
                recuperarlo.
              </p>
            </header>
            {renderStep("B3")}
            <CustomerChatDebugConnector
              kind="call"
              label={edgeLabel("B3", "B4", "call", "prepara el canal")}
            />
            {renderStep("B4")}
            <CustomerChatDebugConnector
              kind="call"
              label={edgeLabel(
                "B4",
                "B5",
                "call",
                "invoca B5 y espera su resultado",
              )}
            />

            <section className="mi-agent-customer-chat-debug-scope is-engine">
              <header>
                <h3>3. B5 orquesta el turno hasta completarlo</h3>
                <p>
                  B5 no termina al recibir el plan: coordina las llamadas
                  internas y solo entonces retorna a B4.
                </p>
              </header>
              {renderStep("B5")}

              <section className="mi-agent-customer-chat-debug-subflow">
                <h4>Planificación: B5 llama a B6 y recibe el plan</h4>
                {renderStep("B6")}
                <CustomerChatDebugConnector
                  kind="return"
                  label={edgeLabel(
                    "B6",
                    "B5",
                    "return",
                    "el plan vuelve a B5 para validación",
                  )}
                />
              </section>

              <section className="mi-agent-customer-chat-debug-subflow">
                <h4>
                  Lecturas: B7 prepara consultas y B8 lee datos autorizados
                </h4>
                <div className="mi-agent-customer-chat-debug-lane">
                  {renderStep("B7")}
                  <CustomerChatDebugConnector
                    kind="call"
                    direction="right"
                    label={edgeLabel("B7", "B8", "call", "ejecuta lecturas")}
                  />
                  {renderStep("B8")}
                </div>
                <CustomerChatDebugConnector
                  kind="return"
                  label={edgeLabel(
                    "B8",
                    "B7",
                    "return",
                    "los resultados vuelven a B7 y la evidencia a B5",
                  )}
                />
              </section>

              <section className="mi-agent-customer-chat-debug-subflow">
                <h4>Verificación: B9 puede solicitar otra ronda de lecturas</h4>
                {renderStep("B9")}
                <div className="mi-agent-customer-chat-debug-loop">
                  <strong>Relectura condicional</strong>
                  <span>
                    {edgeLabel(
                      "B9",
                      "B7",
                      "conditional_loop",
                      "Si falta evidencia y quedan consultas autorizadas, vuelve a B7 y B8.",
                    )}
                  </span>
                </div>
              </section>

              <section className="mi-agent-customer-chat-debug-subflow">
                <h4>
                  Respuesta: B10 forma el resultado que termina devolviendo B5
                </h4>
                {renderStep("B10")}
              </section>

              <CustomerChatDebugConnector
                kind="return"
                label={edgeLabel(
                  "B5",
                  "B4",
                  "return",
                  "B5 retorna el resultado completo a B4",
                )}
              />
            </section>

            <CustomerChatDebugConnector
              kind="return"
              label={edgeLabel(
                "B4",
                "B3",
                "return",
                "B4 entrega el resultado a B3",
              )}
            />
            <section className="mi-agent-customer-chat-debug-persistence">
              <h4>4. Persistencia dentro del servicio B3</h4>
              {renderStep("B11")}
            </section>
          </section>

          <section className="mi-agent-customer-chat-debug-polling">
            <strong>5. Entrega asíncrona a la interfaz</strong>
            <p>
              B1 consulta periódicamente el job en B2; B2 devuelve el estado y,
              al completarse, el resultado final.
            </p>
            <small>
              {edgeLabel("B1", "B2", "poll", "GET estado del job")} →{" "}
              {edgeLabel("B2", "B1", "result", "B2 devuelve el resultado")}
            </small>
          </section>
        </div>
      </details>
    </>
  );
}

const COACH_POLL_TIMEOUT_MS = 180000;
const COACH_FOUNDATION_VISIBILITY_KEY = "mi-agent-coach-show-foundation";
const CUSTOMER_CHAT_FOUNDATION_VISIBILITY_KEY =
  "mi-agent-customer-chat-show-foundation";
const PROSPECT_SESSION_STORAGE_KEY = "mi-agent-prospect-session";
const customerChatSessionKey = (accountId) =>
  `mi-agent-customer-chat-session:${Number(accountId || 0)}`;

const COACH_HANDOFF_OPERATION_KINDS = new Set([
  "activity",
  "create_account",
  "create_contact",
  "create_opportunity",
  "create_lead",
  "create_contact_mapping",
  "create_quotation",
  "create_proposal",
  "lead_resolve",
]);

const COACH_RESPONSE_TYPE_LABELS = {
  informational: "Consulta informativa",
  recommendation: "Recomendación",
  change_request: "Solicitud de cambio",
  operation: "Operación completada",
  error: "Error de operación",
  handoff: "Continuar en otro espacio",
};

const COACH_RULE_CHANNEL_LABELS = {
  coach: "Coach",
  customer_account: "Cliente existente",
  prospect: "Cuenta nueva",
};

const COACH_INTERACTION_MODE_LABELS = {
  coaching: "Coaching del vendedor",
  brief_context: "Contexto breve",
  deep_exploration: "Exploración detallada",
  operation: "Propuesta de operación",
};

const COACH_INTENT_PROCESS_OPTIONS = [
  {
    value: "seller_coaching",
    label: "Desempeño y prioridades del vendedor",
    description:
      "Usa señales resumidas del pipeline para recomendar qué mejorar y qué atender primero.",
  },
  {
    value: "unknown",
    label: "Consulta no identificada",
    description:
      "Se aplica cuando el motor no logra reconocer con claridad qué tipo de consulta recibió.",
  },
  {
    value: "operation",
    label: "Proponer una acción o cambio",
    description:
      "Se aplica cuando el usuario pide crear o modificar algo; no ejecuta la operación por sí sola.",
  },
  {
    value: "stage_readiness",
    label: "Evaluar una oportunidad para avanzar",
    description:
      "Se aplica al revisar preparación, pendientes o riesgos de una oportunidad concreta.",
  },
  {
    value: "account_ranking",
    label: "Comparar cuentas por sus oportunidades",
    description:
      "Se aplica al ordenar o comparar cuentas usando la cobertura de sus oportunidades.",
  },
  {
    value: "temporal_filter",
    label: "Consultar por fecha o periodo",
    description:
      "Se aplica a preguntas que filtran oportunidades por fecha de cierre o periodo.",
  },
  {
    value: "opportunity_query",
    label: "Consultar oportunidades",
    description:
      "Se aplica a búsquedas y preguntas sobre oportunidades, sus estados o etapas.",
  },
  {
    value: "lead_query",
    label: "Consultar leads",
    description:
      "Se aplica a búsquedas y preguntas sobre leads o prospectos registrados.",
  },
  {
    value: "general_query",
    label: "Pregunta general o informativa",
    description:
      "Se aplica a preguntas que no requieren consultar un tipo específico de registro.",
  },
  {
    value: "account_query",
    label: "Consultar una cuenta",
    description: "Se aplica a resúmenes e información de una cuenta del CRM.",
  },
  {
    value: "contact_query",
    label: "Consultar contactos y decisores",
    description:
      "Se aplica a preguntas sobre contactos relacionados con una cuenta u oportunidad.",
  },
  {
    value: "activity_query",
    label: "Consultar actividades",
    description:
      "Se aplica a preguntas sobre actividades y siguientes pasos de una oportunidad.",
  },
  {
    value: "quotation_query",
    label: "Consultar una cotización",
    description:
      "Se aplica a preguntas sobre el contenido comercial de la cotización de una oportunidad.",
  },
];

function getCoachProcessOption(process, channel = "coach") {
  if (process === "default") {
    return {
      label: "Configuración predeterminada del canal",
      description:
        "Esta configuración sirve de base para el canal y se usa cuando no hay una específica para el tipo de consulta.",
    };
  }
  if (channel === "prospect") {
    return {
      label: "Conversación de cuenta nueva",
      description:
        "Abarca la conversación del canal de prospección y sus límites de datos y operaciones.",
    };
  }
  if (channel === "customer_account") {
    return {
      label: "Conversación de cliente existente",
      description:
        "Abarca la conversación vinculada a la cuenta seleccionada y sus límites de datos y operaciones.",
    };
  }
  return (
    COACH_INTENT_PROCESS_OPTIONS.find((option) => option.value === process) || {
      label: "Tipo de consulta personalizado",
      description: "Configuración específica para este código de consulta.",
    }
  );
}

const COACH_OPPORTUNITY_STAGE_OPTIONS = [
  { code: "contacto_inicial", label: "Contacto Inicial" },
  {
    code: "identificacion_oportunidad",
    label: "Identificación de Oportunidad",
  },
  { code: "desarrollo", label: "Desarrollo" },
  { code: "cotizacion", label: "Cotización" },
  { code: "demostracion", label: "Demostración" },
  { code: "negociacion", label: "Negociación" },
  { code: "waiting", label: "Waiting" },
];

const COACH_OPERATION_OPTIONS = {
  coach: [
    ["activity", "Actividad"],
    ["stage_answer", "Respuesta de etapa"],
    ["lead_call_outcome", "Resultado de llamada de lead"],
    ["account_field", "Campo de cuenta"],
    ["contact_field", "Campo de contacto"],
    ["opportunity_field", "Campo de oportunidad"],
  ],
  customer_account: [
    ["activity", "Actividad"],
    ["stage_answer", "Respuesta de etapa"],
    ["lead_call_outcome", "Resultado de llamada de lead"],
    ["account_field", "Campo de cuenta"],
    ["contact_field", "Campo de contacto"],
    ["opportunity_field", "Campo de oportunidad"],
  ],
  prospect: [
    ["create_account", "Crear cuenta"],
    ["create_contact", "Crear contacto"],
    ["create_opportunity", "Crear oportunidad"],
  ],
};

const COACH_CONFIDENCE_LABELS = {
  high: "Alta confianza",
  medium: "Confianza media",
  low: "Baja confianza",
};

const STAGE_READINESS_RECOMMENDATION_LABELS = {
  advance: "Avanzar",
  advance_with_caution: "Avanzar con cautela",
  remain: "Permanecer en la etapa",
};

const COACH_OPERATION_STATUS_META = {
  proposed: { label: "Propuesta", tone: "neutral" },
  collecting: { label: "Información incompleta", tone: "attention" },
  ready: { label: "Lista para revisar", tone: "actionable" },
  handed_off: { label: "Pendiente en módulo", tone: "progress" },
  executing: { label: "Aplicando cambio", tone: "progress" },
  completed: { label: "Completada", tone: "success" },
  failed: { label: "Requiere atención", tone: "error" },
  rejected: { label: "Rechazada", tone: "neutral" },
  cancelled: { label: "Cancelada", tone: "neutral" },
  superseded: { label: "Reemplazada", tone: "neutral" },
  reverted: { label: "Revertida", tone: "attention" },
};

const COACH_OPERATION_LABELS = {
  activity: "Registrar actividad",
  stage_answer: "Actualizar respuesta de etapa",
  opportunity_field: "Actualizar oportunidad",
  account_field: "Actualizar cuenta",
  contact_field: "Actualizar contacto",
  lead_call_outcome: "Registrar resultado del lead",
  lead_resolve: "Resolver lead",
  create_account: "Crear cuenta",
  create_contact: "Crear contacto",
  create_opportunity: "Crear oportunidad",
  create_lead: "Crear lead",
  create_contact_mapping: "Crear mapeo de contacto",
  create_quotation: "Crear cotización",
  create_proposal: "Crear propuesta",
};

const COACH_TARGET_MODULE_LABELS = {
  accounts: "Cuentas",
  contacts: "Contactos",
  opportunities: "Oportunidades",
  interactions: "Leads",
  contact_mapping: "Mapeo de contactos",
  quotations: "Cotizaciones",
  proposals: "Propuestas",
  commercial_development: "Desarrollo comercial",
};

const COACH_SOURCE_LABELS = {
  account: "Cuenta",
  contact: "Contacto",
  opportunity: "Oportunidad",
  lead: "Lead",
  stage_answer: "Respuesta de etapa",
  activity: "Actividad",
  quotation: "Cotización",
  proposal: "Propuesta",
  document: "Documento",
  process_guide: "Proceso comercial",
  crm_context: "CRM",
  conversation: "Conversación",
};

const COACH_ACTIVITY_TYPE_OPTIONS = [
  ["call", "Llamada"],
  ["conference", "Reunión"],
  ["presentation", "Demostración"],
  ["visit", "Visita"],
  ["send_email", "Correo"],
  ["next_step", "Tarea de seguimiento"],
  ["waiting_customer", "Esperando cliente"],
  ["other", "Otro"],
];

const COACH_ACTIVITY_TYPE_ALIASES = {
  meeting: "conference",
  demo: "presentation",
  follow_up: "call",
};

const CUSTOMER_FINDING_CATEGORY_LABELS = {
  company_profile: "Perfil de empresa",
  business_challenge: "Reto de negocio",
  technology_project: "Proyecto tecnológico",
  stakeholder: "Contacto / influencia",
  decision_area: "Área de decisión",
  need: "Necesidad",
  pain_point: "Dolor",
  risk: "Riesgo",
  next_step: "Siguiente paso",
  missing_information: "Hueco de información",
};

const PROSPECT_RESEARCH_TRACK_LABELS = {
  company_profile: "Perfil de empresa",
  business_signals: "Señales de negocio",
  technology_signals: "Tecnología e infraestructura",
  public_people: "Personas y áreas",
};

const CUSTOMER_FINDING_STATUS_LABELS = {
  suggested: "Sugerido",
  confirmed: "Confirmado",
  rejected: "Rechazado",
  outdated: "Obsoleto",
};

const CUSTOMER_FINDING_CONFIDENCE_LABELS = {
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

const PROSPECT_CONVERSION_TARGETS = new Set([
  "account",
  "contact",
  "opportunity",
]);
const PROSPECT_CONVERSION_ACTION_TYPES = new Set([
  "convert",
  "conversion",
  "create",
]);

function isProspectConversionAction(action) {
  return (
    PROSPECT_CONVERSION_TARGETS.has(
      String(action?.target || "")
        .trim()
        .toLowerCase(),
    ) &&
    PROSPECT_CONVERSION_ACTION_TYPES.has(
      String(action?.actionType || "")
        .trim()
        .toLowerCase(),
    )
  );
}

function isProspectConversionOperation(operation) {
  const targetByKind = {
    create_account: "account",
    create_contact: "contact",
    create_opportunity: "opportunity",
  };
  return (
    targetByKind[operation?.kind] === operation?.payload?.target &&
    PROSPECT_CONVERSION_TARGETS.has(operation?.payload?.target) &&
    PROSPECT_CONVERSION_ACTION_TYPES.has(
      String(operation?.payload?.actionType || "")
        .trim()
        .toLowerCase(),
    )
  );
}
const CUSTOMER_AGENT_LABELS = {
  crm_context: "Contexto CRM",
  commercial_health: "Salud comercial",
  public_research: "Investigación pública",
  contact_research: "Investigación de contactos",
  technology_research: "Investigación tecnológica",
  expansion: "Oportunidades de expansión",
  synthesis: "Síntesis ejecutiva",
  actions: "Acciones sugeridas",
};

const CUSTOMER_AGENT_STATUS_LABELS = {
  completed: "Completado",
  skipped: "No ejecutado",
  failed: "Con error",
};

function CustomerActionResult({
  label,
  status,
  preview,
  className = "",
  showStatus = true,
  open,
  onToggle,
  children,
}) {
  return (
    <details
      className={`mi-agent-customer-action-result ${className}`.trim()}
      role="region"
      aria-label={label}
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
    >
      <summary>
        <span className="mi-agent-customer-action-result-copy">
          <strong>{label}</strong>
          {preview ? <small>{preview}</small> : null}
        </span>
        {showStatus ? (
          <span
            className={`mi-agent-customer-action-result-status ${getCustomerActionStatusClass(status)}`}
          >
            {status}
          </span>
        ) : null}
      </summary>
      <div className="mi-agent-customer-action-result-content">{children}</div>
    </details>
  );
}

function getCustomerActionStatus({ loading, error, job }) {
  if (error) return "Error";
  if (loading || job?.status === "pending" || job?.status === "running") {
    return "En proceso";
  }
  if (job?.status === "completed") return "Listo";
  if (job?.status === "failed") return "Error";
  return "Sin ejecutar";
}

function getCustomerActionStatusClass(status) {
  if (status === "Listo") return "is-ready";
  if (status === "En proceso") return "is-running";
  if (status === "Error") return "is-error";
  return "is-idle";
}

function summarizeCustomerAgents(agents = []) {
  const findingCount = agents.reduce(
    (total, agent) => total + (agent.findings?.length || 0),
    0,
  );
  return `${agents.length} ${agents.length === 1 ? "agente" : "agentes"} · ${findingCount} ${findingCount === 1 ? "hallazgo" : "hallazgos"}`;
}

const CUSTOMER_QUOTATION_STATUS_LABELS = {
  won: "Ganada",
  ganada: "Ganada",
  accepted: "Aceptada",
  aceptada: "Aceptada",
  draft: "Borrador",
  borrador: "Borrador",
  sent: "Enviada",
  enviada: "Enviada",
  rejected: "Rechazada",
  rechazada: "Rechazada",
  pending: "Pendiente",
  pendiente: "Pendiente",
};

function groupCustomerProductsByQuotation(products = []) {
  const groups = new Map();
  for (const product of products) {
    const quotationId = Number(product.quotationId);
    if (!groups.has(quotationId)) {
      groups.set(quotationId, {
        quotationId,
        commercialStatus: product.commercialStatus,
        products: [],
      });
    }
    groups.get(quotationId).products.push(product);
  }
  return [...groups.values()];
}

const CUSTOMER_FINDING_APPLY_FIELDS = {
  account: [
    ["description", "Descripción"],
    ["website", "Sitio web"],
    ["phone", "Teléfono"],
    ["city", "Ciudad"],
    ["stateRegion", "Estado / región"],
  ],
  contact: [
    ["positionTitle", "Puesto"],
    ["department", "Departamento"],
    ["email", "Correo"],
    ["phone", "Teléfono"],
    ["mobile", "Móvil"],
    ["city", "Ciudad"],
    ["stateRegion", "Estado / región"],
  ],
  opportunity: [["name", "Nombre"]],
};

function normalizeCoachActivityType(value) {
  return COACH_ACTIVITY_TYPE_ALIASES[value] || value || "other";
}

function formatCurrency(value, currency = "USD") {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return "Sin fecha";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(date);
}

function formatCoachRecommendation(recommendation) {
  if (!recommendation) return "Sin recomendación adicional.";
  return typeof recommendation === "object"
    ? recommendation.action || "Sin recomendación adicional."
    : recommendation;
}

function formatCoachDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : new Intl.DateTimeFormat("es-MX", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function CoachEvidenceList({ evidence = [] }) {
  if (!evidence.length) return null;
  return (
    <ul className="mi-agent-coach-evidence-list">
      {evidence.map((item, index) => {
        const structured = item && typeof item === "object";
        return (
          <li
            key={`${structured ? item.sourceType : "evidence"}-${structured ? item.sourceId : index}-${index}`}
          >
            {structured ? (
              <>
                <span>
                  {COACH_SOURCE_LABELS[item.sourceType] || item.sourceType}
                </span>
                <strong>{item.label}</strong>
                {item.excerpt ? <small>{item.excerpt}</small> : null}
              </>
            ) : (
              <span>{item}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function CoachSemanticSections({ result }) {
  const sections = [
    {
      key: "facts",
      title: "Hechos",
      icon: Database,
      items: result?.facts || [],
    },
    {
      key: "evidence",
      title: "Evidencia",
      icon: Search,
      items: result?.evidence || [],
    },
    {
      key: "inferences",
      title: "Inferencias",
      icon: AlertCircle,
      items: result?.inferences || [],
    },
  ].filter((section) => section.items.length);
  const recommendation = formatCoachRecommendation(result?.recommendation);

  if (!sections.length && !result?.recommendation) return null;
  return (
    <div className="mi-agent-coach-semantic" aria-label="Fundamento del Coach">
      {sections.map(({ key, title, icon, items }) => (
        <section className={`is-${key}`} key={key}>
          <h5>
            {createElement(icon, { size: 14, "aria-hidden": true })}
            {title}
          </h5>
          <CoachEvidenceList evidence={items} />
        </section>
      ))}
      {result?.recommendation ? (
        <section className="is-recommendation">
          <h5>
            <Lightbulb size={14} aria-hidden="true" />
            Recomendación
          </h5>
          <p>{recommendation}</p>
        </section>
      ) : null}
    </div>
  );
}

function CoachStageReadiness({ readiness }) {
  if (!readiness) return null;

  const completedCount = readiness.confirmedProgress?.length || 0;
  const pendingCount = readiness.pendingItems?.length || 0;
  const totalCount = completedCount + pendingCount;
  const diagnosisLabel =
    readiness.recommendation === "advance"
      ? "Sólida"
      : readiness.recommendation === "advance_with_caution"
        ? "Parcial"
        : "Débil";
  const principalWeakness =
    readiness.risks?.[0]?.title ||
    readiness.pendingItems?.[0]?.title ||
    "Sin debilidad identificada";

  const renderItems = (items, emptyMessage, includeSeverity = false) =>
    items?.length ? (
      <ul>
        {items.map((item, index) => (
          <li key={`${item.title}-${index}`}>
            <strong>{item.title}</strong>
            {includeSeverity ? (
              <span className={`is-${item.severity}`}>{item.severity}</span>
            ) : null}
            <small>{item.detail}</small>
            {item.mitigation ? (
              <small>Mitigación: {item.mitigation}</small>
            ) : null}
            <CoachEvidenceList evidence={item.evidence} />
          </li>
        ))}
      </ul>
    ) : (
      <p className="mi-agent-stage-readiness-empty">{emptyMessage}</p>
    );

  return (
    <section
      className="mi-agent-stage-readiness"
      aria-label="Preparación de etapa"
    >
      <div className="mi-agent-stage-readiness-stage">
        <div>
          <small>Etapa actual</small>
          <strong>{readiness.currentStage.name}</strong>
          <p>{readiness.currentStage.objective}</p>
        </div>
        <div className="mi-agent-stage-readiness-score">
          <span>{diagnosisLabel}</span>
          <strong>
            {completedCount}/{totalCount || 0}
          </strong>
          <small>dimensiones confirmadas</small>
        </div>
      </div>
      <div className="mi-agent-stage-readiness-weakness">
        <AlertCircle size={15} aria-hidden="true" />
        <span>Principal punto de atención</span>
        <strong>{principalWeakness}</strong>
      </div>
      <div className="mi-agent-stage-readiness-grid">
        <section>
          <h5>Avances confirmados</h5>
          {renderItems(readiness.confirmedProgress, "Sin avances confirmados.")}
        </section>
        <section>
          <h5>Pendientes</h5>
          {renderItems(readiness.pendingItems, "Sin pendientes.")}
        </section>
        <section>
          <h5>Riesgos</h5>
          {renderItems(readiness.risks, "Sin riesgos abiertos.", true)}
        </section>
      </div>
      <div className="mi-agent-stage-readiness-next">
        <small>Siguiente paso</small>
        <strong>{readiness.nextStep.action}</strong>
        <p>{readiness.nextStep.successCriteria}</p>
        <span>
          Responsable {readiness.nextStep.responsibleUserId || "por asignar"}
          {readiness.nextStep.targetDate
            ? ` · ${formatDate(readiness.nextStep.targetDate)}`
            : ""}
        </span>
      </div>
      <div
        className={`mi-agent-stage-readiness-recommendation is-${readiness.recommendation}`}
      >
        <small>Recomendación de avance</small>
        <strong>
          {STAGE_READINESS_RECOMMENDATION_LABELS[readiness.recommendation] ||
            readiness.recommendation}
        </strong>
        <p>{readiness.rationale}</p>
      </div>
    </section>
  );
}

function buildCoachOperationDraft(operation, persistedOperation = null) {
  const pendingOperation =
    persistedOperation?.pendingOperation || operation || {};
  const operationWithMissingFields = {
    ...pendingOperation,
    missingFields:
      persistedOperation?.missingFields || pendingOperation.missingFields || [],
  };
  return {
    operation: operationWithMissingFields,
    opportunityId: pendingOperation.opportunityId || "",
    value: pendingOperation.value || pendingOperation.answerValue || "",
    answerMode: pendingOperation.answerMode || "replace",
    payload: pendingOperation.payload || {},
    persistentId:
      persistedOperation?.id || pendingOperation.persistentId || null,
    version:
      persistedOperation?.version || pendingOperation.persistenceVersion || 1,
    persistenceStatus:
      persistedOperation?.status ||
      pendingOperation.persistenceStatus ||
      "ready",
    reviewedAt: persistedOperation?.reviewedAt || null,
  };
}

function serializeCoachOperationDraft(draft) {
  const operation = { ...(draft?.operation || {}) };
  delete operation.persistenceStatus;
  delete operation.persistenceVersion;
  if (
    [
      "create_account",
      "create_contact",
      "create_opportunity",
      "create_lead",
      "create_contact_mapping",
      "create_quotation",
      "create_proposal",
      "lead_resolve",
    ].includes(operation.kind)
  ) {
    operation.payload = draft.payload || {};
  } else if (operation.kind === "stage_answer") {
    operation.answerValue = draft.value;
    operation.answerMode = draft.answerMode;
  } else if (operation.kind === "lead_call_outcome") {
    operation.comment = draft.value;
  } else if (operation.kind === "activity") {
    operation.opportunityId = Number(draft.opportunityId || 0) || null;
  } else if (operation.field) {
    operation.value = draft.value;
  }
  return operation;
}

function unresolvedCoachFields(operation) {
  const payload = operation?.payload || {};
  return (operation?.missingFields || []).filter((field) => {
    const value = payload[field] ?? operation[field];
    return value === null || value === undefined || String(value).trim() === "";
  });
}

function isUsablePublicContactValue(value) {
  const text = String(value || "").trim();
  return Boolean(text) && !/[*xX]{2,}/.test(text);
}

const SHOW_COACH_QUALITY_FEEDBACK = false;

function CoachQualityFeedback({ traceId }) {
  const [category, setCategory] = useState("response");
  const [submittedRating, setSubmittedRating] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedbackError, setFeedbackError] = useState("");
  const categoryDescriptions = {
    intent: "¿Entendió qué estabas pidiendo?",
    entity: "¿Identificó la cuenta, oportunidad o persona correcta?",
    response: "¿La respuesta fue clara y resolvió tu pregunta?",
    evidence: "¿Los datos y las fuentes respaldan lo que respondió?",
    other: "¿Hay otro problema que no encaja en las categorías anteriores?",
  };

  async function submit(rating) {
    if (!traceId || submitting) return;
    setSubmitting(true);
    setFeedbackError("");
    try {
      await api.post(`/api/mi-agent/coach/quality/${traceId}/feedback`, {
        rating,
        category,
        corrected: rating === "negative",
      });
      setSubmittedRating(rating);
    } catch (requestError) {
      setFeedbackError(
        getApiErrorMessage(requestError, "No se pudo registrar el feedback"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!SHOW_COACH_QUALITY_FEEDBACK || !traceId) return null;
  return (
    <div
      className="mi-agent-quality-feedback"
      aria-label="Evaluar respuesta del Coach"
    >
      <div className="mi-agent-quality-feedback-copy">
        <strong>¿Cómo evalúas esta respuesta?</strong>
        <label>
          <span>Aspecto</span>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            disabled={submitting || Boolean(submittedRating)}
          >
            <option value="intent">Interpretación de la solicitud</option>
            <option value="entity">Identificación del registro</option>
            <option value="response">
              Claridad y utilidad de la respuesta
            </option>
            <option value="evidence">Exactitud de datos y evidencia</option>
            <option value="other">Otro aspecto</option>
          </select>
        </label>
        <small>{categoryDescriptions[category]}</small>
      </div>
      <div
        className="mi-agent-quality-feedback-actions"
        aria-label="Calificación"
      >
        <button
          type="button"
          className={submittedRating === "positive" ? "is-selected" : ""}
          title="Útil y correcta"
          aria-label="Marcar respuesta como útil y correcta"
          disabled={submitting || Boolean(submittedRating)}
          onClick={() => submit("positive")}
        >
          <ThumbsUp size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={submittedRating === "negative" ? "is-selected" : ""}
          title="Necesita corrección"
          aria-label="Marcar que la respuesta necesita corrección"
          disabled={submitting || Boolean(submittedRating)}
          onClick={() => submit("negative")}
        >
          <ThumbsDown size={16} aria-hidden="true" />
        </button>
        {submittedRating ? (
          <small className="mi-agent-quality-feedback-status" role="status">
            {submittedRating === "positive"
              ? "Gracias, registrado"
              : "Corrección registrada"}
          </small>
        ) : null}
        {feedbackError ? (
          <small className="mi-agent-quality-feedback-error" role="alert">
            {feedbackError}
          </small>
        ) : null}
      </div>
    </div>
  );
}

function buildSnapshot(dashboard) {
  const development = dashboard?.development || dashboard || {};
  const quota = development.quota || {};
  const workboard = Array.isArray(dashboard?.workboard)
    ? dashboard.workboard
    : [];
  // El endpoint propio de Mi agente ya devuelve únicamente oportunidades calificadas.
  const qualified = workboard;
  const coachOpportunities = Array.isArray(dashboard?.coachOpportunities)
    ? dashboard.coachOpportunities
    : qualified;
  const openPipeline = coachOpportunities.filter(
    (item) => item.lifecycle === "open",
  );
  const currencyCode =
    quota.currencyCode ||
    development.period?.baseCurrencyCode ||
    dashboard?.period?.baseCurrencyCode ||
    "USD";
  const currencyConversionAvailable =
    dashboard?.currencyConversion?.available ?? currencyCode === "USD";

  return {
    period: development.period || dashboard?.period || null,
    quota: {
      assignedAmount: Number(quota.assignedAmount || 0),
      actualAmount:
        quota.actualAmount == null ? null : Number(quota.actualAmount),
      gapAmount: quota.gapAmount == null ? null : Number(quota.gapAmount),
      committedOpenAmount:
        quota.committedOpenAmount == null
          ? null
          : Number(quota.committedOpenAmount),
      weightedOpenAmount:
        quota.weightedOpenAmount == null
          ? null
          : Number(quota.weightedOpenAmount),
      currencyCode,
      currencyConversionAvailable,
      usdToQuotaRate: Number(
        dashboard?.currencyConversion?.usdToTargetRate ?? 1,
      ),
      currencyRateFetchedAt: dashboard?.currencyConversion?.fetchedAt || null,
    },
    pipeline: {
      openAmount: !currencyConversionAvailable
        ? null
        : openPipeline.reduce(
            (sum, item) =>
              sum +
              Number(item.amountUsd ?? item.amount_usd ?? 0) *
                Number(dashboard?.currencyConversion?.usdToTargetRate ?? 1),
            0,
          ),
      openCount: openPipeline.length,
      qualifiedAmount: qualified.reduce(
        (sum, item) => sum + Number(item.amountUsd || 0),
        0,
      ),
      qualifiedCount: qualified.length,
      opportunities: qualified.map((item) => ({
        id: Number(item.id),
        name: item.name || "",
        accountName: item.accountName || "",
        amountUsd: Number(item.amountUsd || 0),
        closeDate: item.closeDate || null,
        updatedAt: item.updatedAt || null,
        stageCode: item.stageCode || "",
        stageName: item.stageName || "",
        riskLevel: item.riskLevel || "low",
        riskReasons: Array.isArray(item.riskReasons)
          ? item.riskReasons.slice(0, 4)
          : [],
        daysSinceActivity: Number(item.daysSinceActivity || 0),
        currentStageValidated: Boolean(item.currentStageValidated),
        openWeaknesses: Array.isArray(item.openWeaknesses)
          ? item.openWeaknesses
          : [],
        nextStep: item.nextStep || null,
        nextPendingAction: item.nextPendingAction || null,
        recommendedStrategySteps: Array.isArray(item.recommendedStrategySteps)
          ? item.recommendedStrategySteps.slice(0, 3)
          : [],
      })),
    },
    coachOpportunities,
    wonOpportunities: Array.isArray(dashboard?.wonOpportunities)
      ? dashboard.wonOpportunities
      : [],
    lostOpportunities: Array.isArray(dashboard?.lostOpportunities)
      ? dashboard.lostOpportunities
      : [],
    cancelledOpportunities: Array.isArray(dashboard?.cancelledOpportunities)
      ? dashboard.cancelledOpportunities
      : [],
    inactivePipelineOpportunities: Array.isArray(
      dashboard?.inactivePipelineOpportunities,
    )
      ? dashboard.inactivePipelineOpportunities
      : [],
    accounts: Array.isArray(dashboard?.accounts) ? dashboard.accounts : [],
    contactMappings: Array.isArray(dashboard?.contactMappings)
      ? dashboard.contactMappings
      : [],
    summary: dashboard?.summary || {},
  };
}

function buildCoachOpportunityOptions(openOpportunities, snapshot, accountId) {
  const normalizedAccountId = Number(accountId || 0);
  const open = (Array.isArray(openOpportunities) ? openOpportunities : []).map(
    (opportunity) => ({ ...opportunity, contextGroup: "open" }),
  );
  const historicalGroups = [
    ["wonOpportunities", "won"],
    ["lostOpportunities", "lost"],
    ["cancelledOpportunities", "cancelled"],
  ];
  const historical = historicalGroups.flatMap(([key, contextGroup]) =>
    (Array.isArray(snapshot?.[key]) ? snapshot[key] : [])
      .filter(
        (opportunity) =>
          Number(opportunity.account?.id || opportunity.accountId || 0) ===
          normalizedAccountId,
      )
      .map((opportunity) => ({ ...opportunity, contextGroup })),
  );
  const unique = new Map();
  [...open, ...historical].forEach((opportunity) => {
    unique.set(Number(opportunity.id), opportunity);
  });
  return [...unique.values()];
}

function formatCoachOperationLabel(operation) {
  const title = String(operation?.pendingOperation?.title || "").trim();
  if (title && title.toLowerCase() !== "unknown") return title;
  const kind =
    operation?.kind && operation.kind !== "unknown"
      ? operation.kind
      : operation?.pendingOperation?.kind;
  return COACH_OPERATION_LABELS[kind] || "Acción pendiente";
}

function formatCoachTargetModule(targetModule) {
  return COACH_TARGET_MODULE_LABELS[targetModule] || "";
}

function formatCoachOperationSummary(operation) {
  if (operation?.kind === "activity") {
    return `${operation.actionType || "Actividad"} · ${operation.scheduledAt || "Fecha pendiente"} · ${operation.priority || "Prioridad pendiente"}`;
  }
  if (operation?.kind === "stage_answer")
    return `Respuesta de etapa: ${operation.answerValue || "Pendiente"}`;
  if (operation?.kind === "lead_call_outcome")
    return `Resultado del lead: ${operation.substatusCode || "Pendiente"}`;
  if (operation?.kind === "lead_resolve") return "Resolver y materializar lead";
  if (operation?.kind === "create_account") return "Crear cuenta";
  if (operation?.kind === "create_contact") return "Crear contacto";
  if (operation?.kind === "create_opportunity") return "Crear oportunidad";
  return `${formatCoachFieldLabel(operation?.field)}: ${operation?.value ?? "Valor pendiente"}`;
}

function formatCoachFieldLabel(field) {
  const labels = {
    amountUsd: "Importe de la oportunidad",
    closeDate: "Fecha de cierre",
    name: "Nombre",
    phone: "Teléfono",
    website: "Sitio web",
    companyDescription: "Descripción de la empresa",
    firstName: "Nombre",
    lastName: "Apellido",
    email: "Correo",
    mobile: "Móvil",
    city: "Ciudad",
    stateRegion: "Estado o región",
    postalCode: "Código postal",
    registrationCode: "Código de registro",
    summary: "Resumen",
    sourceNotes: "Notas de origen",
    proposalName: "Nombre de cotización",
    quotationDate: "Fecha de cotización",
    introduction: "Introducción",
    paymentTerms: "Condiciones de pago",
    quotationVersionId: "Versión de cotización",
    sourceProposalId: "Propuesta de origen",
    templateId: "Plantilla",
    opportunityId: "Oportunidad",
    title: "Título",
    actionType: "Tipo de actividad",
    scheduledAt: "Fecha y hora",
    dueDate: "Fecha límite",
    priority: "Prioridad",
    notes: "Notas",
    successCriteria: "Criterio de éxito",
  };
  return labels[field] || field || "Cambio";
}

export default function MiAgentPage({
  canUseCoach = false,
  canExecuteCoach = false,
  canCreateActions = false,
  canUpdateLeads = false,
  canReadLeads = false,
  canCreateLeads = false,
  canUpdateAccounts = false,
  canUpdateContacts = false,
  canCreateAccounts = false,
  canCreateContacts = false,
  canResolveLeads = false,
  canCreateOpportunities = false,
  canUpdateCommercialDevelopment = false,
  canCreateQuotations = false,
  canCreateProposals = false,
  canUseExternalSources = false,
  canReadProspecting = false,
  canCreateProspecting = false,
  canUpdateProspecting = false,
  canReadCustomerIntelligence = false,
  canManageCoach = false,
  canDiagnoseCustomerChats = false,
}) {
  const navigate = useNavigate();
  const [activeWorkspace, setActiveWorkspace] = useState(
    canDiagnoseCustomerChats && !canUseCoach ? "chat-diagnostics" : "summary",
  );
  const [chatDiagnosticsQuery, setChatDiagnosticsQuery] = useState("");
  const [chatDiagnosticsStatus, setChatDiagnosticsStatus] = useState("all");
  const [chatDiagnosticsAccountId, setChatDiagnosticsAccountId] = useState("");
  const [chatDiagnosticsDateFrom, setChatDiagnosticsDateFrom] = useState("");
  const [chatDiagnosticsDateTo, setChatDiagnosticsDateTo] = useState("");
  const [chatDiagnosticsPage, setChatDiagnosticsPage] = useState(1);
  const [chatDiagnosticsResult, setChatDiagnosticsResult] = useState(null);
  const [chatDiagnosticsSelected, setChatDiagnosticsSelected] = useState(null);
  const [chatDiagnosticsLoading, setChatDiagnosticsLoading] = useState(false);
  const [chatDiagnosticsError, setChatDiagnosticsError] = useState("");
  const [dashboard, setDashboard] = useState(null);
  const [coachAccounts, setCoachAccounts] = useState([]);
  const [coachOpportunities, setCoachOpportunities] = useState([]);
  const [coachContacts, setCoachContacts] = useState([]);
  const [coachContext, setCoachContext] = useState({
    accountId: "",
    opportunityId: "",
    contactId: "",
    leadId: "",
  });
  const [coachSessionId, setCoachSessionId] = useState(null);
  const [loadingCoachContext, setLoadingCoachContext] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [creatingActionRank, setCreatingActionRank] = useState(null);
  const [error, setError] = useState("");
  const [coachNotice, setCoachNotice] = useState("");
  const [selectedAction, setSelectedAction] = useState(null);
  const [coachQuestion, setCoachQuestion] = useState("");
  const [askingCoach, setAskingCoach] = useState(false);
  const [coachMessages, setCoachMessages] = useState([]);
  const [showCoachFoundation, setShowCoachFoundation] = useState(
    () =>
      window.localStorage.getItem(COACH_FOUNDATION_VISIBILITY_KEY) === "true",
  );
  const [coachMetrics, setCoachMetrics] = useState(null);
  const [coachActionDraft, setCoachActionDraft] = useState(null);
  const [coachOperationDraft, setCoachOperationDraft] = useState(null);
  const [
    coachOperationOpportunityOptionsOverride,
    setCoachOperationOpportunityOptionsOverride,
  ] = useState(null);
  const [coachPendingOperations, setCoachPendingOperations] = useState([]);
  const [coachRecentOperations, setCoachRecentOperations] = useState([]);
  const [coachUndoOperationId, setCoachUndoOperationId] = useState(null);
  const [savingCoachOperation, setSavingCoachOperation] = useState(false);
  const [coachDraftSaving, setCoachDraftSaving] = useState(false);
  const [coachOperationAction, setCoachOperationAction] = useState({});
  const [coachGovernance, setCoachGovernance] = useState(null);
  const [coachGovernanceLoading, setCoachGovernanceLoading] = useState(false);
  const [coachGovernanceSaving, setCoachGovernanceSaving] = useState(false);
  const [coachQualityDashboard, setCoachQualityDashboard] = useState(null);
  const [coachBusinessRulesDraft, setCoachBusinessRulesDraft] = useState("");
  const [coachBusinessRulesChannel, setCoachBusinessRulesChannel] =
    useState("coach");
  const [coachBusinessRulesProcess, setCoachBusinessRulesProcess] =
    useState("default");
  const [coachBusinessRulesSource, setCoachBusinessRulesSource] =
    useState(null);
  const [coachAdminRules, setCoachAdminRules] = useState([]);
  const [coachIntentCatalog, setCoachIntentCatalog] = useState([]);
  const [coachIntentRevisions, setCoachIntentRevisions] = useState([]);
  const [coachIntentCode, setCoachIntentCode] = useState("");
  const [coachIntentExamplesDraft, setCoachIntentExamplesDraft] = useState("");
  const [coachIntentTestQuestion, setCoachIntentTestQuestion] = useState("");
  const [coachIntentPreview, setCoachIntentPreview] = useState(null);
  const [coachIntentFeedback, setCoachIntentFeedback] = useState(null);
  const [channelIntentChannel, setChannelIntentChannel] =
    useState("customer_account");
  const [channelIntentCatalog, setChannelIntentCatalog] = useState([]);
  const [channelIntentRevisions, setChannelIntentRevisions] = useState([]);
  const [channelIntentCode, setChannelIntentCode] = useState("");
  const [channelIntentDraft, setChannelIntentDraft] = useState(null);
  const [channelIntentTestQuestion, setChannelIntentTestQuestion] =
    useState("");
  const [channelIntentPreview, setChannelIntentPreview] = useState(null);
  const [channelIntentFeedback, setChannelIntentFeedback] = useState(null);
  const [channelIntentSaving, setChannelIntentSaving] = useState(false);
  const [coachAdminRuleDraft, setCoachAdminRuleDraft] = useState(null);
  const [coachAdminRuleEditingId, setCoachAdminRuleEditingId] = useState(null);
  const [coachAdminRuleFeedback, setCoachAdminRuleFeedback] = useState(null);
  const [customerIntelligenceJob, setCustomerIntelligenceJob] = useState(null);
  const customerIntelligenceResultRef = useRef(null);
  const [openCustomerAction, setOpenCustomerAction] = useState(null);
  const [customerAccounts, setCustomerAccounts] = useState([]);
  const [customerAccountSearch, setCustomerAccountSearch] = useState("");
  const [customerAccountId, setCustomerAccountId] = useState("");
  const [customerSnapshot, setCustomerSnapshot] = useState(null);
  const [customerSnapshotLoading, setCustomerSnapshotLoading] = useState(false);
  const [customerFindings, setCustomerFindings] = useState([]);
  const [customerInvestigating, setCustomerInvestigating] = useState(false);
  const [customerIntelligenceError, setCustomerIntelligenceError] =
    useState("");
  const [customerActionErrors, setCustomerActionErrors] = useState({
    analysis: "",
    agents: "",
    briefing: "",
    call: "",
  });
  const [customerChatTransportError, setCustomerChatTransportError] =
    useState(null);
  const [customerChatFailureIds, setCustomerChatFailureIds] = useState(null);
  const [customerFindingApplyDraft, setCustomerFindingApplyDraft] =
    useState(null);
  const [customerFindingApplying, setCustomerFindingApplying] = useState(false);
  const [customerContactApplyDraft, setCustomerContactApplyDraft] =
    useState(null);
  const [customerContactApplying, setCustomerContactApplying] = useState(false);
  const [customerDiscoveryJob, setCustomerDiscoveryJob] = useState(null);
  const [customerDiscoveryPreparing, setCustomerDiscoveryPreparing] =
    useState(false);
  const [customerExecutiveBriefingJob, setCustomerExecutiveBriefingJob] =
    useState(null);
  const [
    customerExecutiveBriefingLoading,
    setCustomerExecutiveBriefingLoading,
  ] = useState(false);
  const [customerAgentsJob, setCustomerAgentsJob] = useState(null);
  const [customerAgentsLoading, setCustomerAgentsLoading] = useState(false);
  const [customerChatQuestion, setCustomerChatQuestion] = useState("");
  const [customerChatMessages, setCustomerChatMessages] = useState([]);
  const [customerChatLoading, setCustomerChatLoading] = useState(false);
  const [customerChatSessionId, setCustomerChatSessionId] = useState(null);
  const [customerChatSessionLoading, setCustomerChatSessionLoading] =
    useState(false);
  const [showCustomerChatFoundation, setShowCustomerChatFoundation] = useState(
    () =>
      window.localStorage.getItem(CUSTOMER_CHAT_FOUNDATION_VISIBILITY_KEY) ===
      "true",
  );
  const [customerChatPublicResearch, setCustomerChatPublicResearch] =
    useState(false);
  const [prospectForm, setProspectForm] = useState({
    companyName: "",
    country: "",
    website: "",
    industry: "",
  });
  const [prospectView, setProspectView] = useState("new");
  const [prospectListSearch, setProspectListSearch] = useState("");
  const [prospectList, setProspectList] = useState({
    items: [],
    total: 0,
    limit: 25,
    offset: 0,
  });
  const [prospectListLoading, setProspectListLoading] = useState(false);
  const [prospectListError, setProspectListError] = useState("");
  const [prospectTargetUpdatingId, setProspectTargetUpdatingId] =
    useState(null);
  const [prospectSession, setProspectSession] = useState(null);
  const [prospectChatQuestion, setProspectChatQuestion] = useState("");
  const [prospectChatMessages, setProspectChatMessages] = useState([]);
  const [prospectChatLoading, setProspectChatLoading] = useState(false);
  const [prospectPreparing, setProspectPreparing] = useState(false);
  const [prospectError, setProspectError] = useState("");
  const [prospectFindingUpdatingId, setProspectFindingUpdatingId] =
    useState(null);
  const [prospectConverting, setProspectConverting] = useState("");
  const [prospectExternalResearching, setProspectExternalResearching] =
    useState(false);
  const [prospectConvertedAccountId, setProspectConvertedAccountId] =
    useState(null);
  const [prospectConvertedLeadId, setProspectConvertedLeadId] = useState(null);
  const [prospectConvertedContacts, setProspectConvertedContacts] = useState(
    {},
  );
  const [prospectConvertedOpportunities, setProspectConvertedOpportunities] =
    useState({});
  const [prospectContactDrafts, setProspectContactDrafts] = useState({});
  const coachContextRef = useRef(coachContext);
  const coachThreadRef = useRef(null);
  const coachDialogRef = useRef(null);
  const coachReturnFocusRef = useRef(null);
  const coachActiveSessionCheckedRef = useRef(false);
  const coachActiveSessionRequestRef = useRef(null);
  const coachContextRevisionRef = useRef(0);
  const coachDraftSaveSignatureRef = useRef("");

  useEffect(() => {
    const sessionId = Number(
      window.sessionStorage.getItem(PROSPECT_SESSION_STORAGE_KEY) || 0,
    );
    if (!sessionId) return undefined;
    let cancelled = false;
    api
      .get(`/api/prospect-research/sessions/${sessionId}`)
      .then(({ data }) => {
        if (cancelled || !data?.session) return;
        const session = data.session;
        setProspectSession(session);
        setProspectForm({
          companyName: session.companyName || "",
          country: session.country || "",
          website: session.website || "",
          industry: session.industry || "",
        });
        setProspectChatMessages(
          (Array.isArray(session.chatHistory) ? session.chatHistory : []).map(
            (message) => ({
              ...message,
              role: message.role === "assistant" ? "assistant" : "seller",
              text: message.text || message.answer || "",
            }),
          ),
        );
      })
      .catch(() => {
        if (!cancelled) {
          window.sessionStorage.removeItem(PROSPECT_SESSION_STORAGE_KEY);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activeWorkspace !== "prospect" || prospectView === "new") return;
    loadProspectSessions({
      search: prospectListSearch,
      targetOnly: prospectView === "targets",
      offset: 0,
    });
  }, [activeWorkspace, prospectView]);

  useEffect(() => {
    if (customerIntelligenceJob?.status !== "completed") return;
    customerIntelligenceResultRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [customerIntelligenceJob?.status]);

  useEffect(() => {
    coachContextRef.current = coachContext;
  }, [coachContext]);

  useEffect(() => {
    if (coachSessionId)
      window.localStorage.setItem(
        "mi-agent-coach-session",
        String(coachSessionId),
      );
    else window.localStorage.removeItem("mi-agent-coach-session");
  }, [coachSessionId]);

  useEffect(() => {
    if (!coachSessionId || coachMessages.length) return undefined;
    const contextRevision = coachContextRevisionRef.current;
    let cancelled = false;
    api
      .get(`/api/mi-agent/coach/sessions/${coachSessionId}`)
      .then(({ data }) => {
        if (
          cancelled ||
          contextRevision !== coachContextRevisionRef.current ||
          !data?.session
        )
          return;
        const session = data.session;
        setCoachContext((current) => ({
          ...current,
          accountId: String(
            session.context?.accountId || current.accountId || "",
          ),
          contactId: String(
            session.context?.contactId || current.contactId || "",
          ),
          opportunityId: String(
            session.context?.opportunityId || current.opportunityId || "",
          ),
          leadId: String(session.context?.leadId || current.leadId || ""),
        }));
        setCoachMessages(session.messages || []);
        setCoachPendingOperations(data.operations || []);
        setCoachRecentOperations(data.recentOperations || []);
      })
      .catch(() => {
        if (!cancelled) setCoachSessionId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [coachSessionId, coachMessages.length]);

  useEffect(() => {
    if (coachActiveSessionCheckedRef.current || coachSessionId) return;
    coachActiveSessionCheckedRef.current = true;
    const contextRevision = coachContextRevisionRef.current;
    const request = api.get("/api/mi-agent/coach/sessions/active");
    coachActiveSessionRequestRef.current = request;
    request
      .then(({ data }) => {
        if (
          contextRevision !== coachContextRevisionRef.current ||
          !data?.session
        )
          return;
        setCoachSessionId(Number(data.session.id));
        setCoachMessages(data.session.messages || []);
        setCoachPendingOperations(data.operations || []);
        setCoachRecentOperations(data.recentOperations || []);
        setCoachContext((current) => ({
          ...current,
          accountId: String(data.session.context?.accountId || ""),
          contactId: String(data.session.context?.contactId || ""),
          opportunityId: String(data.session.context?.opportunityId || ""),
          leadId: String(data.session.context?.leadId || ""),
        }));
      })
      .catch(() => undefined)
      .finally(() => {
        if (coachActiveSessionRequestRef.current === request) {
          coachActiveSessionRequestRef.current = null;
        }
      });
  }, [coachSessionId]);

  useEffect(() => {
    if (!coachOperationDraft?.persistentId || savingCoachOperation)
      return undefined;
    const pendingOperation = serializeCoachOperationDraft(coachOperationDraft);
    const missingFields = unresolvedCoachFields(pendingOperation);
    const signature = JSON.stringify({ pendingOperation, missingFields });
    if (signature === coachDraftSaveSignatureRef.current) return undefined;
    const timer = window.setTimeout(() => {
      setCoachDraftSaving(true);
      api
        .patch(
          `/api/mi-agent/coach/operations/${coachOperationDraft.persistentId}`,
          {
            pendingOperation,
            missingFields,
            version: coachOperationDraft.version,
          },
        )
        .then(({ data }) => {
          const saved = data?.operation;
          if (!saved) return;
          coachDraftSaveSignatureRef.current = signature;
          setCoachOperationDraft((current) =>
            current?.persistentId === saved.id
              ? {
                  ...current,
                  version: saved.version,
                  persistenceStatus: saved.status,
                }
              : current,
          );
          setCoachPendingOperations((current) =>
            current.map((item) => (item.id === saved.id ? saved : item)),
          );
        })
        .catch((requestError) => {
          const serverOperation = requestError?.response?.data?.operation;
          const message = getApiErrorMessage(
            requestError,
            "No fue posible guardar el borrador del Coach",
          );
          if (serverOperation) {
            setCoachPendingOperations((current) =>
              current.map((item) =>
                item.id === serverOperation.id ? serverOperation : item,
              ),
            );
          }
          setCoachOperationDraft((current) =>
            current
              ? {
                  ...current,
                  operation:
                    serverOperation?.pendingOperation || current.operation,
                  version: serverOperation?.version || current.version,
                  persistenceStatus:
                    serverOperation?.status || current.persistenceStatus,
                  error: message,
                }
              : current,
          );
        })
        .finally(() => setCoachDraftSaving(false));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [coachOperationDraft, savingCoachOperation]);

  useEffect(() => {
    if (coachOperationDraft) coachDialogRef.current?.focus();
  }, [coachOperationDraft]);

  useEffect(() => {
    if (coachThreadRef.current) {
      coachThreadRef.current.scrollTop = coachThreadRef.current.scrollHeight;
    }
  }, [coachMessages]);

  async function loadDashboard() {
    setLoading(true);
    setError("");
    try {
      const [{ data }, metricsResponse] = await Promise.all([
        api.get("/api/mi-agent/context"),
        api.get("/api/mi-agent/coach/metrics").catch(() => ({ data: null })),
      ]);
      setDashboard(data);
      setCoachMetrics(metricsResponse.data);
      const accountsResponse = await api.get("/api/accounts?activeOnly=true");
      setCoachAccounts(
        Array.isArray(accountsResponse.data) ? accountsResponse.data : [],
      );
      setCustomerAccounts(
        Array.isArray(accountsResponse.data) ? accountsResponse.data : [],
      );
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar el contexto de Mi Coach",
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  function requestCoachGeneralScope() {
    const pendingOperationCount = coachPendingOperations.length;
    const pendingOperationNotice = pendingOperationCount
      ? pendingOperationCount === 1
        ? " También se descartará 1 acción pendiente."
        : ` También se descartarán ${pendingOperationCount} acciones pendientes.`
      : "";

    const confirmed = window.confirm(
      `Volver al ámbito general cerrará esta conversación y limpiará sus mensajes y borradores.${pendingOperationNotice} No podrás reabrirla desde Coach. ¿Continuar?`,
    );
    if (confirmed) void resetCoachToGeneral();
  }

  async function clearCoachConversation() {
    const hasConversationState = Boolean(
      coachSessionId ||
      coachMessages.length ||
      coachRecentOperations.length ||
      coachOperationDraft,
    );
    if (!hasConversationState) return;
    const pendingOperationCount = coachPendingOperations.length;
    const pendingOperationNotice =
      pendingOperationCount === 1
        ? " También se descartará 1 acción pendiente."
        : pendingOperationCount
          ? ` También se descartarán ${pendingOperationCount} acciones pendientes.`
          : "";
    const confirmed = window.confirm(
      `Se cerrará esta conversación y se eliminarán sus mensajes de la vista.${pendingOperationNotice} ¿Continuar?`,
    );
    if (!confirmed) return;

    const sessionId = Number(coachSessionId || 0);
    coachContextRevisionRef.current += 1;
    coachActiveSessionRequestRef.current = null;
    setError("");
    try {
      if (pendingOperationCount) {
        await Promise.all(
          coachPendingOperations.map((operation) =>
            api.post(`/api/mi-agent/coach/operations/${operation.id}/status`, {
              status: "cancelled",
              cancellationReason: "Descartada al limpiar la conversación",
            }),
          ),
        );
      }
      if (sessionId) {
        await api.post(`/api/mi-agent/coach/sessions/${sessionId}/close`);
      }
      setCoachSessionId(null);
      setCoachMessages([]);
      setCoachQuestion("");
      setCoachNotice("");
      setCoachActionDraft(null);
      setCoachOperationDraft(null);
      setCoachPendingOperations([]);
      setCoachRecentOperations([]);
      setCoachUndoOperationId(null);
      setCoachOperationAction({});
      coachDraftSaveSignatureRef.current = "";
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible limpiar la conversación del Coach",
        ),
      );
    }
  }

  async function resetCoachToGeneral() {
    setLoadingCoachContext(true);
    setError("");
    const pendingRestore = coachActiveSessionRequestRef.current;
    coachContextRevisionRef.current += 1;
    coachActiveSessionRequestRef.current = null;
    try {
      const restoredSessionResponse = pendingRestore
        ? await pendingRestore.catch(() => null)
        : null;
      const generalContext = {
        accountId: "",
        opportunityId: "",
        contactId: "",
        leadId: "",
      };
      const sessionIdToClose = Number(
        coachSessionId || restoredSessionResponse?.data?.session?.id || 0,
      );
      if (coachPendingOperations.length) {
        await Promise.all(
          coachPendingOperations.map((operation) =>
            api.post(`/api/mi-agent/coach/operations/${operation.id}/status`, {
              status: "cancelled",
              cancellationReason: "Descartada al volver al ámbito general",
            }),
          ),
        );
      }
      if (sessionIdToClose) {
        await api.post(
          `/api/mi-agent/coach/sessions/${sessionIdToClose}/close`,
        );
      }

      setCoachContext(generalContext);
      coachContextRef.current = generalContext;
      setCoachSessionId(null);
      setCoachOpportunities([]);
      setCoachContacts([]);
      setCoachMessages([]);
      setCoachQuestion("");
      setCoachActionDraft(null);
      setCoachOperationDraft(null);
      setCoachPendingOperations([]);
      setCoachRecentOperations([]);
      setCoachUndoOperationId(null);
      setCoachOperationAction({});
      setCoachNotice("");
      coachDraftSaveSignatureRef.current = "";
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible volver al ámbito general del Coach",
        ),
      );
    } finally {
      setLoadingCoachContext(false);
    }
  }

  async function searchCustomerAccounts(value) {
    setCustomerAccountSearch(value);
    try {
      const response = await api.get(
        `/api/accounts?activeOnly=true&search=${encodeURIComponent(value)}`,
      );
      setCustomerAccounts(Array.isArray(response.data) ? response.data : []);
    } catch (requestError) {
      setCustomerIntelligenceError(
        getApiErrorMessage(requestError, "No fue posible buscar cuentas"),
      );
    }
  }

  function selectCustomerAccount(accountId) {
    setCustomerAccountId(String(accountId || ""));
    resetCustomerIntelligence();
  }

  function openCoachDetailHandoff(handoff) {
    if (handoff?.destination === "customer_account") {
      if (!canReadCustomerIntelligence || !Number(handoff.accountId || 0)) {
        return;
      }
      setActiveWorkspace("customer");
      selectCustomerAccount(handoff.accountId);
      return;
    }
    if (
      handoff?.destination === "lead_management" &&
      canReadLeads &&
      Number(handoff.leadId || 0)
    ) {
      navigate(`/interactions?leadId=${Number(handoff.leadId)}`);
    }
  }

  async function applyCoachActiveContext(
    activeContext,
    expectedRevision = coachContextRevisionRef.current,
  ) {
    if (expectedRevision !== coachContextRevisionRef.current) return;
    const nextContext = {
      accountId: String(activeContext?.accountId || ""),
      opportunityId: String(activeContext?.opportunityId || ""),
      contactId: String(activeContext?.contactId || ""),
      leadId: String(activeContext?.leadId || ""),
    };
    const hasChanged = [
      "accountId",
      "opportunityId",
      "contactId",
      "leadId",
    ].some((key) => nextContext[key] !== coachContextRef.current[key]);
    setCoachContext(nextContext);
    if (!hasChanged) return;
    if (!nextContext.accountId) {
      setCoachOpportunities([]);
      setCoachContacts([]);
      return;
    }

    const [contextResponse, opportunitiesResponse, contactsResponse] =
      await Promise.all([
        api.get("/api/mi-agent/context"),
        api.get(
          `/api/opportunities?accountId=${nextContext.accountId}&activeOnly=true&openOnly=true`,
        ),
        api.get(
          `/api/contacts?accountId=${nextContext.accountId}&opportunityId=${nextContext.opportunityId}&activeOnly=true`,
        ),
      ]);
    if (expectedRevision !== coachContextRevisionRef.current) return;
    const accountSnapshot = buildSnapshot(contextResponse.data);
    setDashboard(contextResponse.data);
    setCoachAccounts((current) => {
      const accounts = new Map(
        current.map((account) => [Number(account.id), account]),
      );
      accountSnapshot.accounts.forEach((account) =>
        accounts.set(Number(account.id), account),
      );
      return [...accounts.values()];
    });
    setCoachOpportunities(
      buildCoachOpportunityOptions(
        opportunitiesResponse.data,
        accountSnapshot,
        nextContext.accountId,
      ),
    );
    setCoachContacts(
      Array.isArray(contactsResponse.data) ? contactsResponse.data : [],
    );
  }

  useEffect(() => {
    if (canDiagnoseCustomerChats && !canUseCoach) {
      setLoading(false);
      void loadCustomerChatDiagnostics({ page: 1 });
      return;
    }
    loadDashboard();
  }, []);

  const snapshot = useMemo(() => buildSnapshot(dashboard), [dashboard]);
  const currency = snapshot.quota.currencyCode;
  const coverage =
    snapshot.quota.currencyConversionAvailable && snapshot.quota.gapAmount
      ? snapshot.pipeline.openAmount / snapshot.quota.gapAmount
      : null;
  const selectedCustomerAccount =
    customerAccounts.find(
      (item) => String(item.id) === String(customerAccountId),
    ) || null;
  const hasCustomerContext = Boolean(customerAccountId);

  useEffect(() => {
    if (activeWorkspace !== "customer" || !hasCustomerContext) {
      setCustomerSnapshot(null);
      return undefined;
    }
    let cancelled = false;
    setCustomerSnapshotLoading(true);
    api
      .get("/api/commercial-intelligence/account-intelligence/snapshot", {
        params: {
          accountId: Number(customerAccountId),
        },
      })
      .then((response) => {
        if (!cancelled) setCustomerSnapshot(response.data?.snapshot || null);
      })
      .catch((requestError) => {
        if (!cancelled)
          setCustomerIntelligenceError(
            getApiErrorMessage(
              requestError,
              "No fue posible cargar la salud de la cuenta",
            ),
          );
      })
      .finally(() => {
        if (!cancelled) setCustomerSnapshotLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeWorkspace, customerAccountId, hasCustomerContext]);

  useEffect(() => {
    const accountId = Number(customerAccountId || 0);
    if (!accountId || !hasCustomerContext) {
      setCustomerChatSessionId(null);
      setCustomerChatMessages([]);
      setCustomerChatSessionLoading(false);
      return undefined;
    }
    const storageKey = customerChatSessionKey(accountId);
    const storedSessionId = Number(
      window.sessionStorage.getItem(storageKey) || 0,
    );
    if (!storedSessionId) {
      setCustomerChatSessionId(null);
      setCustomerChatMessages([]);
      setCustomerChatSessionLoading(false);
      return undefined;
    }
    let cancelled = false;
    setCustomerChatSessionId(storedSessionId);
    setCustomerChatSessionLoading(true);
    api
      .get(
        `/api/commercial-intelligence/account-chat/sessions/${storedSessionId}`,
      )
      .then((response) => {
        if (cancelled) return;
        const session = response.data?.session;
        if (Number(session?.accountId || 0) !== accountId) {
          throw new Error("La sesion no corresponde a la cuenta actual");
        }
        setCustomerChatMessages(
          (Array.isArray(session.history) ? session.history : []).map(
            (message) =>
              message.role === "user"
                ? { role: "seller", text: message.text }
                : {
                    role: "assistant",
                    answer: message.text,
                    activityHistory: message.activityHistory || null,
                    debug: message.turnDebug || null,
                    sourceDomain: "crm_internal",
                  },
          ),
        );
      })
      .catch(() => {
        if (cancelled) return;
        window.sessionStorage.removeItem(storageKey);
        setCustomerChatSessionId(null);
        setCustomerChatMessages([]);
      })
      .finally(() => {
        if (!cancelled) setCustomerChatSessionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customerAccountId, hasCustomerContext]);

  function resetCustomerIntelligence() {
    setCustomerSnapshot(null);
    setCustomerSnapshotLoading(false);
    setCustomerIntelligenceJob(null);
    setOpenCustomerAction(null);
    setCustomerFindings([]);
    setCustomerIntelligenceError("");
    setCustomerActionErrors({
      analysis: "",
      agents: "",
      briefing: "",
      call: "",
    });
    setCustomerFindingApplyDraft(null);
    setCustomerFindingApplying(false);
    setCustomerContactApplyDraft(null);
    setCustomerContactApplying(false);
    setCustomerDiscoveryJob(null);
    setCustomerDiscoveryPreparing(false);
    setCustomerExecutiveBriefingJob(null);
    setCustomerExecutiveBriefingLoading(false);
    setCustomerAgentsJob(null);
    setCustomerAgentsLoading(false);
    setCustomerChatQuestion("");
    setCustomerChatMessages([]);
    setCustomerChatLoading(false);
    setCustomerChatSessionId(null);
    setCustomerChatSessionLoading(false);
    setCustomerChatFailureIds(null);
    setCustomerChatPublicResearch(false);
  }

  function setCustomerActionResultOpen(action, isOpen) {
    setOpenCustomerAction((current) => {
      if (isOpen) return action;
      return current === action ? null : current;
    });
  }

  function buildCustomerIntelligencePayload() {
    return {
      accountId: customerAccountId ? Number(customerAccountId) : null,
      objective: "Investigar cliente existente desde Mi Coach",
    };
  }

  async function pollCustomerIntelligenceJob(jobId) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await api.get(
        `/api/commercial-intelligence/account-internal-analysis/jobs/${jobId}`,
      );
      const job = response.data?.job || null;
      if (job) {
        setCustomerIntelligenceJob(job);
        setCustomerFindings(Array.isArray(job.findings) ? job.findings : []);
      }
      if (["completed", "failed"].includes(String(job?.status || ""))) {
        return job;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 600));
    }
    return null;
  }

  async function runCustomerInvestigation() {
    if (!hasCustomerContext) {
      setCustomerActionErrors((current) => ({
        ...current,
        analysis: "Selecciona una cuenta existente para investigar.",
      }));
      return;
    }
    setCustomerInvestigating(true);
    setCustomerActionResultOpen("analysis", true);
    setCustomerActionErrors((current) => ({ ...current, analysis: "" }));
    setCoachNotice("");
    try {
      const response = await api.post(
        "/api/commercial-intelligence/account-internal-analysis/jobs",
        buildCustomerIntelligencePayload(),
      );
      const job = response.data?.job;
      if (!job?.id)
        throw new Error("No se pudo iniciar la investigación del cliente");
      setCustomerIntelligenceJob(job);
      setCustomerFindings([]);
      const completedJob = await pollCustomerIntelligenceJob(job.id);
      if (!completedJob || completedJob.status === "failed") {
        throw new Error(
          completedJob?.errorMessage ||
            "No fue posible completar la investigación del cliente",
        );
      }
      setCoachNotice("Investigación del cliente completada.");
    } catch (requestError) {
      setCustomerActionErrors((current) => ({
        ...current,
        analysis: getApiErrorMessage(
          requestError,
          "No fue posible investigar el cliente",
        ),
      }));
    } finally {
      setCustomerInvestigating(false);
    }
  }

  async function applyCustomerFinding() {
    const draft = customerFindingApplyDraft;
    if (
      !draft?.finding?.id ||
      !draft.target ||
      !draft.field ||
      !String(draft.value || "").trim()
    )
      return;
    setCustomerFindingApplying(true);
    setCustomerIntelligenceError("");
    try {
      await api.post(
        `/api/commercial-intelligence/findings/${draft.finding.id}/apply`,
        {
          target: draft.target,
          field: draft.field,
          value: draft.value.trim(),
          mode: draft.mode,
        },
      );
      setCustomerFindingApplyDraft(null);
      setCoachNotice("Hallazgo aplicado al registro correctamente.");
    } catch (requestError) {
      setCustomerIntelligenceError(
        getApiErrorMessage(
          requestError,
          "No fue posible aplicar el hallazgo al registro",
        ),
      );
    } finally {
      setCustomerFindingApplying(false);
    }
  }

  async function applyCustomerContact() {
    const draft = customerContactApplyDraft;
    if (!draft?.finding?.id) return;
    setCustomerContactApplying(true);
    try {
      await api.post(
        `/api/commercial-intelligence/findings/${draft.finding.id}/apply-contact`,
        {
          contactId: draft.contactId ? Number(draft.contactId) : null,
          contactData: draft.contactData,
        },
      );
      setCustomerContactApplyDraft(null);
      setCoachNotice("Contacto confirmado y guardado correctamente.");
    } catch (requestError) {
      setCustomerIntelligenceError(
        getApiErrorMessage(requestError, "No fue posible guardar el contacto"),
      );
    } finally {
      setCustomerContactApplying(false);
    }
  }

  async function pollCustomerDiscoveryJob(jobId) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await api.get(
        `/api/commercial-intelligence/commercial-discovery/jobs/${jobId}`,
      );
      const job = response.data?.job || null;
      if (job) setCustomerDiscoveryJob(job);
      if (["completed", "failed"].includes(String(job?.status || "")))
        return job;
      await new Promise((resolve) => window.setTimeout(resolve, 600));
    }
    return null;
  }

  async function prepareCustomerCall() {
    if (!hasCustomerContext) {
      setCustomerActionErrors((current) => ({
        ...current,
        call: "Selecciona una cuenta existente para preparar la llamada.",
      }));
      return;
    }
    setCustomerDiscoveryPreparing(true);
    setCustomerActionResultOpen("call", true);
    setCustomerActionErrors((current) => ({ ...current, call: "" }));
    setCoachNotice("");
    try {
      const response = await api.post(
        "/api/commercial-intelligence/commercial-discovery/jobs",
        buildCustomerIntelligencePayload(),
      );
      const job = response.data?.job;
      if (!job?.id)
        throw new Error("No se pudo iniciar la preparación comercial");
      setCustomerDiscoveryJob(job);
      const completedJob = await pollCustomerDiscoveryJob(job.id);
      if (!completedJob || completedJob.status === "failed") {
        throw new Error(
          completedJob?.errorMessage || "No fue posible preparar la llamada",
        );
      }
      setCoachNotice("Briefing comercial preparado.");
    } catch (requestError) {
      setCustomerActionErrors((current) => ({
        ...current,
        call: getApiErrorMessage(
          requestError,
          "No fue posible preparar la llamada",
        ),
      }));
    } finally {
      setCustomerDiscoveryPreparing(false);
    }
  }

  async function prepareCustomerExecutiveBriefing() {
    if (!hasCustomerContext) {
      setCustomerActionErrors((current) => ({
        ...current,
        briefing:
          "Selecciona una cuenta existente para preparar el resumen ejecutivo.",
      }));
      return;
    }
    setCustomerExecutiveBriefingLoading(true);
    setCustomerActionResultOpen("briefing", true);
    setCustomerActionErrors((current) => ({ ...current, briefing: "" }));
    try {
      const response = await api.post(
        "/api/commercial-intelligence/executive-briefing/jobs",
        buildCustomerIntelligencePayload(),
      );
      const jobId = Number(response.data?.job?.id || 0);
      if (!jobId) throw new Error("No se pudo iniciar el resumen ejecutivo");
      setCustomerExecutiveBriefingJob(response.data.job);
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const jobResponse = await api.get(
          `/api/commercial-intelligence/executive-briefing/jobs/${jobId}`,
        );
        const job = jobResponse.data?.job;
        if (job) setCustomerExecutiveBriefingJob(job);
        if (["completed", "failed"].includes(String(job?.status || ""))) {
          if (job.status === "failed")
            throw new Error(
              job.errorMessage ||
                "No fue posible preparar el resumen ejecutivo",
            );
          setCoachNotice("Resumen ejecutivo preparado.");
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 600));
      }
      throw new Error(
        "El resumen ejecutivo tardó demasiado; inténtalo de nuevo",
      );
    } catch (requestError) {
      setCustomerActionErrors((current) => ({
        ...current,
        briefing: getApiErrorMessage(
          requestError,
          "No fue posible preparar el resumen ejecutivo",
        ),
      }));
    } finally {
      setCustomerExecutiveBriefingLoading(false);
    }
  }

  async function runCustomerAgents() {
    if (!hasCustomerContext) {
      setCustomerActionErrors((current) => ({
        ...current,
        agents: "Selecciona una cuenta existente para ejecutar los agentes.",
      }));
      return;
    }
    setCustomerAgentsLoading(true);
    setCustomerActionResultOpen("agents", true);
    setCustomerActionErrors((current) => ({ ...current, agents: "" }));
    try {
      if (!canUseExternalSources) {
        throw new Error(
          "No tienes permiso para ejecutar agentes con fuentes públicas",
        );
      }
      const response = await api.post(
        "/api/commercial-intelligence/agents/jobs",
        { ...buildCustomerIntelligencePayload(), includePublicResearch: true },
      );
      const jobId = Number(response.data?.job?.id || 0);
      if (!jobId)
        throw new Error("No se pudo iniciar la orquestación de agentes");
      setCustomerAgentsJob(response.data.job);
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const jobResponse = await api.get(
          `/api/commercial-intelligence/agents/jobs/${jobId}`,
        );
        const job = jobResponse.data?.job;
        if (job) setCustomerAgentsJob(job);
        if (["completed", "failed"].includes(String(job?.status || ""))) {
          if (job.status === "failed")
            throw new Error(
              job.errorMessage || "No fue posible ejecutar los agentes",
            );
          setCoachNotice("Agentes especializados ejecutados.");
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 600));
      }
      throw new Error("La orquestación tardó demasiado; inténtalo de nuevo");
    } catch (requestError) {
      setCustomerActionErrors((current) => ({
        ...current,
        agents: getApiErrorMessage(
          requestError,
          "No fue posible ejecutar los agentes",
        ),
      }));
    } finally {
      setCustomerAgentsLoading(false);
    }
  }

  async function askCustomerChat(question = customerChatQuestion) {
    const normalizedQuestion = String(question || "").trim();
    if (!normalizedQuestion || !hasCustomerContext) return;
    const transportExchanges = [];
    let activeExchange = null;
    let failedJobDebug = null;
    let activeChatSessionId = Number(customerChatSessionId || 0) || null;
    let activeChatJobId = null;
    const beginExchange = (label, method, path, requestSummary = null) => {
      activeExchange = {
        label,
        method,
        path,
        requestSummary,
        startedAt: Date.now(),
        pollCount: 0,
        observedStatuses: [],
        pollEvents: [],
      };
      return activeExchange;
    };
    const finishExchange = (
      exchange,
      response,
      outcome,
      responseSummary = {},
    ) => {
      if (!exchange) return;
      transportExchanges.push({
        label: exchange.label,
        method: exchange.method,
        path: exchange.path,
        requestSummary: exchange.requestSummary,
        startedAt: new Date(exchange.startedAt).toISOString(),
        finishedAt: new Date().toISOString(),
        httpStatus: Number(response?.status || 0) || null,
        outcome,
        durationMs: Math.max(0, Date.now() - exchange.startedAt),
        pollCount: exchange.pollCount || 0,
        pollEvents: exchange.pollEvents || [],
        responseSummary,
      });
      if (activeExchange === exchange) activeExchange = null;
    };
    const safeApiErrorMessage = (requestError) =>
      String(
        requestError?.response?.data?.message || requestError?.message || "",
      )
        .replace(/\s+/g, " ")
        .slice(0, 180);

    setCustomerChatLoading(true);
    setCustomerIntelligenceError("");
    setCustomerChatTransportError(null);
    setCustomerChatFailureIds(null);
    setCustomerChatMessages((current) => [
      ...current,
      { role: "seller", text: normalizedQuestion },
    ]);
    setCustomerChatQuestion("");
    try {
      if (!activeChatSessionId) {
        const sessionRequest = buildCustomerIntelligencePayload();
        const exchange = beginExchange(
          "Crear sesión",
          "POST",
          "/api/commercial-intelligence/account-chat/sessions",
          sessionRequest,
        );
        const sessionResponse = await api.post(
          "/api/commercial-intelligence/account-chat/sessions",
          sessionRequest,
        );
        activeChatSessionId = Number(sessionResponse.data?.session?.id || 0);
        finishExchange(
          exchange,
          sessionResponse,
          activeChatSessionId ? "completed" : "invalid_response",
          { sessionId: activeChatSessionId || null },
        );
        if (!activeChatSessionId)
          throw new Error("No se pudo iniciar una conversación de cuenta");
        window.sessionStorage.setItem(
          customerChatSessionKey(customerAccountId),
          String(activeChatSessionId),
        );
        setCustomerChatSessionId(activeChatSessionId);
      } else {
        transportExchanges.push({
          kind: "local",
          label: "Reutilizar sesión existente",
          outcome: "reused",
          responseSummary: { sessionId: activeChatSessionId },
        });
      }
      const submitExchange = beginExchange(
        "Iniciar pregunta",
        "POST",
        "/api/commercial-intelligence/account-chat/jobs",
        {
          ...buildCustomerIntelligencePayload(),
          chatSessionId: activeChatSessionId,
          question: normalizedQuestion,
          includePublicResearch: customerChatPublicResearch,
        },
      );
      const response = await api.post(
        "/api/commercial-intelligence/account-chat/jobs",
        submitExchange.requestSummary,
      );
      const jobId = Number(response.data?.job?.id || 0);
      activeChatJobId = jobId || null;
      finishExchange(
        submitExchange,
        response,
        jobId ? "accepted" : "invalid_response",
        {
          jobId: jobId || null,
          chatSessionId:
            Number(response.data?.job?.chatSessionId || activeChatSessionId) ||
            null,
          initialStatus: response.data?.job?.status || null,
          pollAfterMs: Number(response.data?.job?.pollAfterMs || 0) || null,
        },
      );
      if (!jobId) throw new Error("No se pudo iniciar el chat de cuenta");
      let result = null;
      const pollExchange = beginExchange(
        "Consultar resultado",
        "GET",
        `/api/commercial-intelligence/account-chat/jobs/${jobId}`,
        { jobId },
      );
      let finalPollJob = null;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const jobResponse = await api.get(
          `/api/commercial-intelligence/account-chat/jobs/${jobId}`,
        );
        const job = jobResponse.data?.job;
        pollExchange.pollCount += 1;
        pollExchange.pollEvents.push({
          attempt: pollExchange.pollCount,
          at: new Date().toISOString(),
          httpStatus: Number(jobResponse.status || 0) || null,
          status: String(job?.status || "unknown"),
        });
        if (
          job?.status &&
          !pollExchange.observedStatuses.includes(String(job.status))
        ) {
          pollExchange.observedStatuses.push(String(job.status));
        }
        if (["completed", "failed"].includes(String(job?.status || ""))) {
          finalPollJob = job;
          finishExchange(
            pollExchange,
            jobResponse,
            job.status === "completed" ? "completed" : "job_failed",
            {
              jobId,
              finalStatus: String(job.status),
              observedStatuses: pollExchange.observedStatuses,
              resultReceived: Boolean(job.result),
              errorMessage:
                job.status === "failed"
                  ? String(
                      job.errorMessage || "El job terminó con error",
                    ).slice(0, 180)
                  : null,
            },
          );
          if (job.status === "failed") {
            failedJobDebug = job.result?.debug || null;
            throw new Error(job.errorMessage || "No fue posible responder");
          }
          result = job.result;
          break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 600));
      }
      if (!result) {
        if (activeExchange === pollExchange) {
          finishExchange(pollExchange, null, "timeout", {
            jobId,
            finalStatus: finalPollJob?.status || "sin estado terminal",
            observedStatuses: pollExchange.observedStatuses,
            resultReceived: false,
          });
        }
        throw new Error("La respuesta tardó demasiado; inténtalo de nuevo");
      }
      setCustomerChatMessages((current) => [
        ...current,
        {
          role: "assistant",
          ...result,
          transportTrace: {
            source: "browser_observed",
            exchanges: transportExchanges,
          },
        },
      ]);
      setCustomerChatFailureIds(
        result.responseType === "error"
          ? { sessionId: activeChatSessionId, jobId: activeChatJobId }
          : null,
      );
    } catch (requestError) {
      if (activeExchange) {
        finishExchange(
          activeExchange,
          requestError?.response,
          requestError?.response ? "http_error" : "network_error",
          {
            errorMessage: safeApiErrorMessage(requestError) || null,
            pollCount: activeExchange.pollCount || 0,
            observedStatuses: activeExchange.observedStatuses || [],
          },
        );
      }
      setCustomerChatTransportError({
        source: "browser_observed",
        exchanges: transportExchanges,
        debug: failedJobDebug,
      });
      if (activeChatSessionId || activeChatJobId) {
        setCustomerChatFailureIds({
          sessionId: activeChatSessionId,
          jobId: activeChatJobId,
        });
      }
      setCustomerIntelligenceError(
        getApiErrorMessage(
          requestError,
          "No fue posible responder sobre la cuenta",
        ),
      );
    } finally {
      setCustomerChatLoading(false);
    }
  }

  function startNewCustomerChat() {
    if (customerChatLoading || customerChatSessionLoading) return;
    window.sessionStorage.removeItem(customerChatSessionKey(customerAccountId));
    setCustomerChatSessionId(null);
    setCustomerChatMessages([]);
    setCustomerChatQuestion("");
    setCustomerIntelligenceError("");
    setCustomerChatTransportError(null);
    setCustomerChatFailureIds(null);
  }

  async function openDiscoveryActivity(nextStep) {
    const opportunityId = Number(nextStep?.opportunityId || 0);
    if (!opportunityId || !canExecuteCoach || !canUpdateCommercialDevelopment)
      return;
    const snapshotAccountId = Number(customerSnapshot?.account?.id || 0);
    const customerOpportunity = [
      ...(customerSnapshot?.opportunities || []),
      ...(customerSnapshot?.inactiveOpportunities || []),
    ].find(
      (item) =>
        Number(item.id) === opportunityId &&
        Number(item.accountId || snapshotAccountId) === snapshotAccountId &&
        snapshotAccountId === Number(customerAccountId || 0),
    );
    if (!customerOpportunity) {
      setError(
        "La oportunidad ya no está disponible en la cuenta seleccionada. Actualiza la información e inténtalo de nuevo.",
      );
      return;
    }
    setSavingCoachOperation(true);
    setError("");
    try {
      const response = await api.post("/api/mi-agent/coach/operations", {
        sessionId: null,
        originalIntent: "Preparar actividad desde Cliente existente",
        context: {
          accountId: Number(customerAccountId || 0) || null,
          opportunityId,
        },
        operation: {
          kind: "activity",
          sourceChannel: "coach",
          title: nextStep.title || "Seguimiento comercial",
          evidence: Array.isArray(nextStep.evidence) ? nextStep.evidence : [],
          missingFields: [],
          requiresConfirmation: true,
          opportunityId,
          activityId: null,
          actionType: nextStep.actionType || "call",
          status: "pending",
          priority: nextStep.priority || "medium",
          scheduledAt: nextStep.scheduledAt || null,
          dueDate: nextStep.dueDate || null,
          notes:
            nextStep.notes || "Preparada desde Cliente existente en Mi Coach.",
          successCriteria:
            nextStep.successCriteria || "Obtener siguiente paso confirmado.",
        },
      });
      const persistedOperation = response.data?.operation;
      const destinationSessionId = Number(response.data?.sessionId || 0);
      if (!persistedOperation?.id || !destinationSessionId) {
        throw new Error(
          "No se pudo persistir la actividad en una sesión nueva del Coach",
        );
      }
      const coachContextForHandoff = {
        accountId: String(customerAccountId || ""),
        opportunityId: String(opportunityId),
        contactId: "",
        leadId: "",
      };
      setCoachContext(coachContextForHandoff);
      coachContextRef.current = coachContextForHandoff;
      setCoachMessages([]);
      setCoachSessionId(destinationSessionId);
      setCoachPendingOperations((current) => [
        persistedOperation,
        ...current.filter((item) => item.id !== persistedOperation.id),
      ]);
      await openCoachOperationConfirmation(
        {
          ...persistedOperation.pendingOperation,
          persistentId: persistedOperation.id,
          persistenceVersion: persistedOperation.version,
          persistenceStatus: persistedOperation.status,
        },
        {
          opportunityOptions: [
            {
              ...customerOpportunity,
              accountName:
                customerSnapshot.account.name || selectedCustomerAccount?.name,
            },
          ],
        },
      );
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible preparar la actividad",
        ),
      );
    } finally {
      setSavingCoachOperation(false);
    }
  }

  function canReviewCustomerOperation(operation) {
    if (!canExecuteCoach) return false;
    if (operation?.kind === "activity") return canUpdateCommercialDevelopment;
    if (operation?.kind === "lead_call_outcome") return canUpdateLeads;
    if (operation?.kind === "account_field") return canUpdateAccounts;
    if (operation?.kind === "contact_field") return canUpdateContacts;
    if (["stage_answer", "opportunity_field"].includes(operation?.kind))
      return canCreateActions;
    return false;
  }

  async function openCustomerChatOperation(operation) {
    if (!operation || !canReviewCustomerOperation(operation)) return;
    setSavingCoachOperation(true);
    setError("");
    try {
      const accountId = Number(customerAccountId || 0) || null;
      const opportunityId = Number(operation.opportunityId || 0) || null;
      const contactId = Number(operation.contactId || 0) || null;
      const coachOperation = {
        ...operation,
        sourceChannel: "coach",
        requiresConfirmation: true,
      };
      const response = await api.post("/api/mi-agent/coach/operations", {
        sessionId: null,
        originChannel: "customer_account",
        originalIntent: `Propuesta desde Cliente existente: ${operation.title || operation.kind}`,
        context: {
          accountId,
          opportunityId,
          contactId,
          leadId: null,
        },
        operation: coachOperation,
      });
      const persistedOperation = response.data?.operation;
      const destinationSessionId = Number(response.data?.sessionId || 0);
      if (!persistedOperation?.id || !destinationSessionId) {
        throw new Error("No se pudo preparar la operación en el Coach");
      }
      const coachContextForHandoff = {
        accountId: String(accountId || ""),
        opportunityId: String(opportunityId || ""),
        contactId: String(contactId || ""),
        leadId: "",
      };
      setCoachContext(coachContextForHandoff);
      coachContextRef.current = coachContextForHandoff;
      setCoachMessages([]);
      setCoachSessionId(destinationSessionId);
      setCoachPendingOperations((current) => [
        persistedOperation,
        ...current.filter((item) => item.id !== persistedOperation.id),
      ]);
      await openCoachOperationConfirmation({
        ...persistedOperation.pendingOperation,
        persistentId: persistedOperation.id,
        persistenceVersion: persistedOperation.version,
        persistenceStatus: persistedOperation.status,
      });
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible preparar la operación en el Coach",
        ),
      );
    } finally {
      setSavingCoachOperation(false);
    }
  }

  function updateProspectForm(field, value) {
    setProspectForm((current) => ({ ...current, [field]: value }));
    setProspectError("");
  }

  async function loadProspectSessions({
    search = prospectListSearch,
    targetOnly = prospectView === "targets",
    offset = 0,
  } = {}) {
    setProspectListLoading(true);
    setProspectListError("");
    try {
      const response = await api.get("/api/prospect-research/sessions", {
        params: { search, targetOnly, limit: 25, offset },
      });
      setProspectList(
        response.data || { items: [], total: 0, limit: 25, offset },
      );
    } catch (requestError) {
      setProspectListError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar las investigaciones guardadas",
        ),
      );
    } finally {
      setProspectListLoading(false);
    }
  }

  async function openSavedProspect(sessionId) {
    setProspectListLoading(true);
    setProspectListError("");
    try {
      const response = await api.get(
        `/api/prospect-research/sessions/${sessionId}`,
      );
      const session = response.data?.session;
      if (!session) throw new Error("No se encontró la investigación");
      setProspectSession(session);
      setProspectForm({
        companyName: session.companyName || "",
        country: session.country || "",
        website: session.website || "",
        industry: session.industry || "",
      });
      setProspectConvertedAccountId(session.convertedAccountId || null);
      setProspectConvertedLeadId(null);
      setProspectConvertedContacts({});
      setProspectConvertedOpportunities({});
      setProspectContactDrafts({});
      setProspectChatQuestion("");
      setProspectError("");
      setProspectChatMessages(
        (Array.isArray(session.chatHistory) ? session.chatHistory : []).map(
          (message) => ({
            ...message,
            role: message.role === "assistant" ? "assistant" : "seller",
            text: message.text || message.answer || "",
          }),
        ),
      );
      window.sessionStorage.setItem(
        PROSPECT_SESSION_STORAGE_KEY,
        String(session.id),
      );
      setProspectView("new");
    } catch (requestError) {
      setProspectListError(
        getApiErrorMessage(
          requestError,
          "No fue posible abrir la investigación",
        ),
      );
    } finally {
      setProspectListLoading(false);
    }
  }

  async function updateProspectTarget(session) {
    if (!session?.id) return;
    setProspectTargetUpdatingId(Number(session.id));
    setProspectListError("");
    setProspectError("");
    try {
      const response = await api.patch(
        `/api/prospect-research/sessions/${session.id}/target`,
        { isTarget: !session.isTarget },
      );
      const isTarget = Boolean(response.data?.isTarget);
      setProspectSession((current) =>
        current && Number(current.id) === Number(session.id)
          ? { ...current, isTarget, targetAddedAt: response.data.targetAddedAt }
          : current,
      );
      await loadProspectSessions({ targetOnly: prospectView === "targets" });
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible actualizar Cuentas objetivo",
      );
      if (prospectView === "new") setProspectError(message);
      else setProspectListError(message);
    } finally {
      setProspectTargetUpdatingId(null);
    }
  }

  async function deleteSavedProspect(session) {
    if (!session?.id) return;
    const duplicateNote =
      session.duplicateCount > 1
        ? ` También se archivarán sus ${session.duplicateCount - 1} ficha(s) duplicada(s).`
        : "";
    const confirmed = window.confirm(
      `¿Eliminar la investigación guardada de ${session.companyName}?${duplicateNote} La cuenta CRM, si existe, no se eliminará.`,
    );
    if (!confirmed) return;
    setProspectListLoading(true);
    setProspectListError("");
    try {
      await api.delete(`/api/prospect-research/sessions/${session.id}`);
      if (Number(prospectSession?.id) === Number(session.id)) {
        setProspectSession(null);
        setProspectChatMessages([]);
        setProspectChatQuestion("");
        setProspectConvertedAccountId(null);
        setProspectConvertedLeadId(null);
        setProspectConvertedContacts({});
        setProspectConvertedOpportunities({});
        setProspectContactDrafts({});
        window.sessionStorage.removeItem(PROSPECT_SESSION_STORAGE_KEY);
      }
      await loadProspectSessions({ targetOnly: prospectView === "targets" });
    } catch (requestError) {
      setProspectListError(
        getApiErrorMessage(
          requestError,
          "No fue posible eliminar la investigación guardada",
        ),
      );
    } finally {
      setProspectListLoading(false);
    }
  }

  async function startProspectResearch() {
    const companyName = prospectForm.companyName.trim();
    const country = prospectForm.country.trim();
    if (!companyName || !country) {
      setProspectError("Captura empresa y país para iniciar la investigación.");
      return;
    }
    setProspectPreparing(true);
    setProspectError("");
    setCoachNotice("");
    try {
      const createResponse = await api.post("/api/prospect-research/sessions", {
        companyName,
        country,
        website: prospectForm.website.trim(),
        industry: prospectForm.industry.trim(),
      });
      const sessionId = Number(createResponse.data?.session?.id || 0);
      if (!sessionId)
        throw new Error("No se pudo crear la sesión de prospección");
      setProspectSession(createResponse.data.session);
      setProspectChatMessages([]);
      window.sessionStorage.setItem(
        PROSPECT_SESSION_STORAGE_KEY,
        String(sessionId),
      );
      setProspectConvertedAccountId(null);
      setProspectConvertedLeadId(null);
      setProspectConvertedContacts({});
      setProspectConvertedOpportunities({});
      setProspectContactDrafts({});
      await runProspectExternalResearch(sessionId);
    } catch (requestError) {
      setProspectError(
        getApiErrorMessage(
          requestError,
          "No fue posible iniciar la investigación pública",
        ),
      );
    } finally {
      setProspectPreparing(false);
    }
  }

  async function askProspectChat(question = prospectChatQuestion) {
    const normalizedQuestion = String(question || "").trim();
    if (!normalizedQuestion || !prospectSession?.id) return;
    const sessionId = Number(prospectSession.id);
    setProspectChatLoading(true);
    setProspectError("");
    setProspectChatMessages((current) => [
      ...current,
      { role: "seller", text: normalizedQuestion },
    ]);
    setProspectChatQuestion("");
    try {
      const response = await api.post(
        `/api/prospect-research/sessions/${sessionId}/chat/jobs`,
        { question: normalizedQuestion },
      );
      const jobId = Number(response.data?.job?.id || 0);
      if (!jobId) throw new Error("No se pudo iniciar el turno de chat");

      let completedJob = null;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const jobResponse = await api.get(
          `/api/prospect-research/sessions/${sessionId}/chat/jobs/${jobId}`,
        );
        const job = jobResponse.data?.job;
        if (job?.status === "completed") {
          completedJob = job;
          break;
        }
        if (job?.status === "failed") {
          throw new Error(
            job.errorMessage || "No fue posible responder sobre el prospecto",
          );
        }
        await new Promise((resolve) => window.setTimeout(resolve, 600));
      }
      if (!completedJob?.result) {
        throw new Error("La respuesta tardó demasiado; inténtalo de nuevo");
      }
      const assistantMessage = {
        role: "assistant",
        ...completedJob.result,
        text: completedJob.result.text || completedJob.result.answer || "",
      };
      setProspectChatMessages((current) => [...current, assistantMessage]);
      setProspectSession((current) =>
        current
          ? {
              ...current,
              chatHistory: [
                ...(Array.isArray(current.chatHistory)
                  ? current.chatHistory
                  : []),
                { role: "user", text: normalizedQuestion },
                assistantMessage,
              ].slice(-16),
            }
          : current,
      );
    } catch (requestError) {
      setProspectError(
        getApiErrorMessage(
          requestError,
          "No fue posible responder sobre el prospecto",
        ),
      );
    } finally {
      setProspectChatLoading(false);
    }
  }

  async function runProspectExternalResearch(sessionId = prospectSession?.id) {
    if (!sessionId) return;
    setProspectExternalResearching(true);
    setProspectError("");
    try {
      const startPath = `/api/prospect-research/sessions/${sessionId}/run-external`;
      let startResponse;
      let lastStartError;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          startResponse = await api.post(startPath, {});
          break;
        } catch (requestError) {
          lastStartError = requestError;
          const isTransient = [
            "ECONNABORTED",
            "ETIMEDOUT",
            "ERR_NETWORK",
          ].includes(requestError?.code);
          if (!isTransient || attempt === 2) throw requestError;
        }
      }
      if (!startResponse) throw lastStartError;
      const runId = Number(startResponse.data?.job?.id || 0);
      if (!runId) throw new Error("No se pudo iniciar la investigación");

      let completedJob = null;
      let transientPollFailures = 0;
      for (let attempt = 0; attempt < 240; attempt += 1) {
        try {
          const statusResponse = await api.get(
            `/api/prospect-research/sessions/${sessionId}/run-external/${runId}`,
          );
          const job = statusResponse.data?.job;
          transientPollFailures = 0;
          if (job?.status === "completed" || job?.status === "failed") {
            completedJob = job;
            break;
          }
          await new Promise((resolve) =>
            window.setTimeout(resolve, Number(job?.pollAfterMs || 700)),
          );
        } catch (requestError) {
          const isTransient = [
            "ECONNABORTED",
            "ETIMEDOUT",
            "ERR_NETWORK",
          ].includes(requestError?.code);
          if (!isTransient || transientPollFailures >= 3) throw requestError;
          transientPollFailures += 1;
          await new Promise((resolve) =>
            window.setTimeout(resolve, 700 * transientPollFailures),
          );
        }
      }
      if (!completedJob) {
        const latestSession = await api.get(
          `/api/prospect-research/sessions/${sessionId}`,
        );
        setProspectSession(latestSession.data?.session || prospectSession);
        setCoachNotice(
          "La consulta sigue activa. La ficha queda guardada; pulsa Actualizar investigación para recuperar su estado.",
        );
        return;
      }
      if (completedJob.status === "failed") {
        throw new Error(
          completedJob.warnings?.join(" ") ||
            "No fue posible completar la investigación pública",
        );
      }
      setProspectSession(completedJob.session || prospectSession);
      const externalResearch = completedJob.session?.result?.externalResearch;
      const hasFindings = Number(externalResearch?.findingCount || 0) > 0;
      setCoachNotice(
        hasFindings
          ? "Investigación pública actualizada con fuentes verificables."
          : "La investigación terminó sin hallazgos públicos verificables.",
      );
    } catch (requestError) {
      setProspectError(
        getApiErrorMessage(
          requestError,
          "No fue posible investigar fuentes públicas",
        ),
      );
    } finally {
      setProspectExternalResearching(false);
    }
  }

  async function updateProspectFindingStatus(finding, status) {
    const action = status === "confirmed" ? "confirm" : "reject";
    setProspectFindingUpdatingId(finding.id);
    setProspectError("");
    try {
      const response = await api.post(
        `/api/prospect-research/findings/${finding.id}/${action}`,
        {},
      );
      const updatedFinding = response.data?.finding;
      if (updatedFinding) {
        setProspectSession((current) =>
          current
            ? {
                ...current,
                findings: (Array.isArray(current.findings)
                  ? current.findings
                  : []
                ).map((item) =>
                  Number(item.id) === Number(updatedFinding.id)
                    ? updatedFinding
                    : item,
                ),
              }
            : current,
        );
      }
    } catch (requestError) {
      setProspectError(
        getApiErrorMessage(
          requestError,
          "No fue posible actualizar el hallazgo",
        ),
      );
    } finally {
      setProspectFindingUpdatingId(null);
    }
  }

  async function convertProspectAccount(
    duplicateDecision = "",
    duplicateAccountId = null,
  ) {
    if (!prospectSession?.id) return;
    setProspectConverting("account");
    setProspectError("");
    try {
      const response = await api.post(
        `/api/prospect-research/sessions/${prospectSession.id}/convert-to-account`,
        { duplicateDecision, duplicateAccountId },
      );
      const accountId = Number(response.data?.accountId || 0);
      if (!accountId) throw new Error("No se pudo crear la cuenta");
      setProspectConvertedAccountId(accountId);
      setProspectSession((current) =>
        current ? { ...current, convertedAccountId: accountId } : current,
      );
      setCoachNotice(
        response.data?.reused
          ? "Cuenta existente vinculada a la prospección."
          : "Cuenta creada desde la prospección.",
      );
    } catch (requestError) {
      setProspectError(
        getApiErrorMessage(requestError, "No fue posible crear la cuenta"),
      );
    } finally {
      setProspectConverting("");
    }
  }

  async function updateProspectHypothesisStatus(hypothesis, status) {
    setProspectConverting(`hypothesis-${hypothesis.id}`);
    setProspectError("");
    try {
      const response = await api.post(
        `/api/prospect-research/hypotheses/${hypothesis.id}/${status === "confirmed" ? "confirm" : "reject"}`,
        {},
      );
      const updatedHypothesis = response.data?.hypothesis;
      if (updatedHypothesis) {
        setProspectSession((current) =>
          current
            ? {
                ...current,
                hypotheses: (current.hypotheses || []).map((item) =>
                  Number(item.id) === Number(updatedHypothesis.id)
                    ? updatedHypothesis
                    : item,
                ),
              }
            : current,
        );
      }
    } catch (requestError) {
      setProspectError(
        getApiErrorMessage(requestError, "No fue posible validar la hipótesis"),
      );
    } finally {
      setProspectConverting("");
    }
  }

  async function convertProspectLead() {
    if (!prospectSession?.id) return;
    setProspectConverting("lead");
    setProspectError("");
    try {
      const response = await api.post(
        `/api/prospect-research/sessions/${prospectSession.id}/convert-to-lead`,
        {
          accountId:
            prospectConvertedAccountId ||
            prospectSession.convertedAccountId ||
            null,
        },
      );
      const interactionId = Number(response.data?.interactionId || 0);
      if (!interactionId) throw new Error("No se pudo crear el lead");
      setProspectConvertedLeadId(interactionId);
      setCoachNotice("Lead creado desde la prospección.");
    } catch (requestError) {
      setProspectError(
        getApiErrorMessage(requestError, "No fue posible crear el lead"),
      );
    } finally {
      setProspectConverting("");
    }
  }

  function updateProspectContactDraft(contactId, field, value) {
    setProspectContactDrafts((current) => ({
      ...current,
      [contactId]: { ...(current[contactId] || {}), [field]: value },
    }));
  }

  async function convertProspectContact(contact) {
    const accountId =
      prospectConvertedAccountId || prospectSession?.convertedAccountId || null;
    if (!accountId) {
      setProspectError(
        "Primero crea o vincula la cuenta antes de crear contactos.",
      );
      return;
    }
    const draft = prospectContactDrafts[contact.id] || {};
    const contactName = String(draft.contactName || contact.name || "").trim();
    if (!contactName) {
      setProspectError(
        "Captura el nombre real del contacto sugerido antes de crearlo.",
      );
      return;
    }
    setProspectConverting(`contact-${contact.id}`);
    setProspectError("");
    try {
      const response = await api.post(
        `/api/prospect-research/contacts/${contact.id}/convert`,
        {
          accountId,
          contactName,
          email: draft.email || "",
        },
      );
      const contactId = Number(response.data?.contactId || 0);
      if (!contactId) throw new Error("No se pudo crear el contacto");
      setProspectConvertedContacts((current) => ({
        ...current,
        [contact.id]: contactId,
      }));
      setCoachNotice("Contacto creado desde la prospección.");
    } catch (requestError) {
      setProspectError(
        getApiErrorMessage(requestError, "No fue posible crear el contacto"),
      );
    } finally {
      setProspectConverting("");
    }
  }

  async function convertProspectOpportunity(hypothesis) {
    const accountId =
      prospectConvertedAccountId || prospectSession?.convertedAccountId || null;
    const firstContactId = Number(
      Object.values(prospectConvertedContacts)[0] || 0,
    );
    if (!accountId || !firstContactId) {
      setProspectError(
        "Crea la cuenta y al menos un contacto antes de crear una oportunidad preliminar.",
      );
      return;
    }
    setProspectConverting(`opportunity-${hypothesis.id}`);
    setProspectError("");
    try {
      const response = await api.post(
        `/api/prospect-research/hypotheses/${hypothesis.id}/convert-to-opportunity`,
        {
          accountId,
          contactId: firstContactId,
          amountUsd: 0,
        },
      );
      const opportunityId = Number(response.data?.opportunityId || 0);
      if (!opportunityId) throw new Error("No se pudo crear la oportunidad");
      setProspectConvertedOpportunities((current) => ({
        ...current,
        [hypothesis.id]: opportunityId,
      }));
      setCoachNotice("Oportunidad preliminar creada desde la prospección.");
    } catch (requestError) {
      setProspectError(
        getApiErrorMessage(requestError, "No fue posible crear la oportunidad"),
      );
    } finally {
      setProspectConverting("");
    }
  }

  async function askCoach(
    question = coachQuestion,
    contextOverride = coachContext,
    sessionIdOverride = coachSessionId,
  ) {
    const normalizedQuestion = String(question || "").trim();
    if (!normalizedQuestion) return;
    const requestContext = { ...contextOverride };
    const contextKey = JSON.stringify(requestContext);
    const contextRevision = coachContextRevisionRef.current;
    setAskingCoach(true);
    setError("");
    setCoachNotice("");
    const messageId = `${Date.now()}-${normalizedQuestion}`;
    setCoachMessages((current) => [
      ...current,
      { id: `${messageId}-question`, role: "seller", text: normalizedQuestion },
      { id: `${messageId}-pending`, role: "coach", pending: true },
    ]);
    setCoachQuestion("");
    try {
      const conversationHistory = coachMessages
        .filter((message) => !message.pending)
        .slice(-8)
        .map((message) => ({
          role: message.role === "coach" ? "coach" : "seller",
          text:
            message.role === "coach"
              ? message.result?.answer || message.error || ""
              : message.text || "",
        }))
        .filter((message) => message.text);
      const { data: queued } = await api.post("/api/mi-agent/coach", {
        question: normalizedQuestion,
        history: conversationHistory,
        sessionId: sessionIdOverride,
        context: {
          accountId: Number(requestContext.accountId || 0) || null,
          opportunityId: Number(requestContext.opportunityId || 0) || null,
          contactId: Number(requestContext.contactId || 0) || null,
          leadId: Number(requestContext.leadId || 0) || null,
        },
      });
      if (contextRevision !== coachContextRevisionRef.current) return;
      if (queued?.sessionId) setCoachSessionId(Number(queued.sessionId));
      const jobId = Number(queued?.job?.id || 0);
      if (!jobId) throw new Error("No se pudo iniciar la consulta al Coach");
      const deadline = Date.now() + COACH_POLL_TIMEOUT_MS;
      for (;;) {
        if (Date.now() >= deadline) {
          throw new Error(
            "El Coach está tardando más de lo esperado. Puedes intentarlo nuevamente.",
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (contextRevision !== coachContextRevisionRef.current) return;
        const { data } = await api.get(`/api/mi-agent/coach/jobs/${jobId}`);
        if (data?.job?.status === "completed") {
          if (
            contextRevision !== coachContextRevisionRef.current ||
            JSON.stringify(coachContextRef.current) !== contextKey
          ) {
            throw new Error(
              "El contexto cambio mientras se analizaba la pregunta. Vuelve a intentarlo.",
            );
          }
          const activeContext = data.result?.activeContext;
          if (activeContext)
            await applyCoachActiveContext(activeContext, contextRevision);
          const persistedOperations = (data.result?.operations || [])
            .filter((operation) => operation.persistentId)
            .map((operation) => ({
              id: operation.persistentId,
              sessionId: Number(queued.sessionId || coachSessionId || 0),
              kind: operation.kind,
              status: operation.persistenceStatus || "ready",
              version: operation.persistenceVersion || 1,
              originalIntent: normalizedQuestion,
              missingFields: operation.missingFields || [],
              evidence: operation.evidence || [],
              targetModule: operation.targetModule || null,
              pendingOperation: operation,
            }));
          if (persistedOperations.length) {
            setCoachPendingOperations((current) => {
              const incomingIds = new Set(
                persistedOperations.map((operation) => operation.id),
              );
              return [
                ...persistedOperations,
                ...current.filter(
                  (operation) => !incomingIds.has(operation.id),
                ),
              ];
            });
          }
          setCoachMessages((current) =>
            current.map((message) =>
              message.id === `${messageId}-pending`
                ? { ...message, pending: false, result: data.result }
                : message,
            ),
          );
          break;
        }
        if (data?.job?.status === "failed")
          throw new Error(
            data.job.errorMessage || "No fue posible responder la pregunta",
          );
      }
    } catch (requestError) {
      setCoachMessages((current) =>
        current.map((message) =>
          message.id === `${messageId}-pending`
            ? {
                ...message,
                pending: false,
                error: getApiErrorMessage(
                  requestError,
                  "No fue posible responder la pregunta",
                ),
              }
            : message,
        ),
      );
      setError(
        getApiErrorMessage(requestError, "No fue posible consultar al Coach"),
      );
    } finally {
      setAskingCoach(false);
    }
  }

  async function analyzeSituation() {
    setAnalyzing(true);
    setError("");
    try {
      const { data: queued } = await api.post("/api/mi-agent/analyze", {
        snapshot,
      });
      const jobId = Number(queued?.job?.id || 0);
      if (!jobId) {
        throw new Error("No se pudo iniciar el análisis de Mi agente");
      }

      for (;;) {
        await new Promise((resolve) => {
          setTimeout(
            resolve,
            Math.max(500, Number(queued?.job?.pollAfterMs || 1000)),
          );
        });
        const { data: jobData } = await api.get(
          `/api/mi-agent/analyze/jobs/${jobId}`,
        );
        const status = String(jobData?.job?.status || "");
        if (status === "completed" && jobData.result) {
          setAnalysis(jobData.result);
          setSelectedAction(jobData.result.actions?.[0] || null);
          break;
        }
        if (status === "failed") {
          throw new Error(
            jobData?.job?.errorMessage ||
              "No fue posible completar el análisis de Mi agente",
          );
        }
      }
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible analizar tu situación comercial",
        ),
      );
    } finally {
      setAnalyzing(false);
    }
  }

  async function loadCoachGovernance() {
    setCoachGovernanceLoading(true);
    setError("");
    try {
      const [
        response,
        qualityResponse,
        rulesResponse,
        businessRulesResponse,
        intentsResponse,
        channelIntentsResponse,
      ] = await Promise.all([
        api.get("/api/commercial-intelligence/governance"),
        api.get("/api/mi-agent/coach/quality"),
        api.get(
          "/api/commercial-intelligence/governance/rules?channel=all&process=default",
        ),
        api.get(
          "/api/commercial-intelligence/governance/business-rules?channel=coach&process=default",
        ),
        api.get("/api/commercial-intelligence/governance/intents"),
        api
          .get(
            `/api/commercial-intelligence/governance/channel-intents/${channelIntentChannel}`,
          )
          .catch((requestError) => ({
            data: { loadError: requestError },
          })),
      ]);
      setCoachGovernance(response.data || null);
      setCoachQualityDashboard(qualityResponse.data?.quality || null);
      setCoachBusinessRulesDraft(
        JSON.stringify(
          businessRulesResponse.data?.businessRules || {},
          null,
          2,
        ),
      );
      setCoachBusinessRulesSource(
        businessRulesResponse.data?.configurationSource || null,
      );
      setCoachAdminRules(rulesResponse.data?.rules || []);
      const intentCatalog = intentsResponse.data?.catalog || [];
      setCoachIntentCatalog(intentCatalog);
      setCoachIntentRevisions(intentsResponse.data?.revisions || []);
      setCoachIntentCode((current) =>
        intentCatalog.some((item) => item.code === current)
          ? current
          : intentCatalog[0]?.code || "",
      );
      setCoachIntentExamplesDraft(
        (current) => current || (intentCatalog[0]?.examples || []).join("\n"),
      );
      const channelCatalog = channelIntentsResponse.data?.catalog || [];
      setChannelIntentCatalog(channelCatalog);
      setChannelIntentRevisions(channelIntentsResponse.data?.revisions || []);
      if (channelIntentsResponse.data?.loadError) {
        setChannelIntentFeedback({
          kind: "error",
          message: getApiErrorMessage(
            channelIntentsResponse.data.loadError,
            "No fue posible cargar la configuración del canal.",
          ),
        });
      }
      const initialChannelIntent = channelCatalog[0];
      setChannelIntentCode(initialChannelIntent?.code || "");
      setChannelIntentDraft(
        initialChannelIntent
          ? {
              enabled: initialChannelIntent.enabled,
              examples: initialChannelIntent.examples.join("\n"),
              priority: initialChannelIntent.priority,
              allowedTools: [...initialChannelIntent.allowedTools],
              requiredContext: [...initialChannelIntent.requiredContext],
            }
          : null,
      );
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar gobierno de Mi Coach",
        ),
      );
    } finally {
      setCoachGovernanceLoading(false);
    }
  }

  async function loadCustomerChatDiagnostics({
    page = chatDiagnosticsPage,
    query = chatDiagnosticsQuery,
    status = chatDiagnosticsStatus,
    accountId = chatDiagnosticsAccountId,
    dateFrom = chatDiagnosticsDateFrom,
    dateTo = chatDiagnosticsDateTo,
  } = {}) {
    if (!canDiagnoseCustomerChats) return;
    setChatDiagnosticsLoading(true);
    setChatDiagnosticsError("");
    try {
      const response = await api.get(
        "/api/commercial-intelligence/account-chat/diagnostics/sessions",
        {
          params: {
            page,
            pageSize: 20,
            query,
            status,
            accountId: accountId || undefined,
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
          },
        },
      );
      setChatDiagnosticsResult(response.data || null);
    } catch (requestError) {
      setChatDiagnosticsError(
        getApiErrorMessage(
          requestError,
          "No fue posible consultar las sesiones de chat",
        ),
      );
    } finally {
      setChatDiagnosticsLoading(false);
    }
  }

  async function openCustomerChatDiagnostic({ sessionId, jobId }) {
    if (!canDiagnoseCustomerChats) return;
    setChatDiagnosticsLoading(true);
    setChatDiagnosticsError("");
    try {
      const path = jobId
        ? `/api/commercial-intelligence/account-chat/diagnostics/jobs/${jobId}`
        : `/api/commercial-intelligence/account-chat/diagnostics/sessions/${sessionId}`;
      const response = await api.get(path);
      setChatDiagnosticsSelected(response.data?.session || null);
    } catch (requestError) {
      setChatDiagnosticsError(
        getApiErrorMessage(
          requestError,
          "No fue posible abrir el diagnóstico de la sesión",
        ),
      );
      setChatDiagnosticsSelected(null);
    } finally {
      setChatDiagnosticsLoading(false);
    }
  }

  async function saveCoachGovernance() {
    if (!coachGovernance?.settings) return;
    setCoachGovernanceSaving(true);
    setError("");
    try {
      const response = await api.put(
        "/api/commercial-intelligence/governance/settings",
        coachGovernance.settings,
      );
      setCoachGovernance(response.data || coachGovernance);
      const contextResponse = await api.get("/api/mi-agent/context");
      setDashboard(contextResponse.data);
      if (coachContext.accountId) {
        const opportunitiesResponse = await api.get(
          `/api/opportunities?accountId=${coachContext.accountId}&activeOnly=true&openOnly=true`,
        );
        setCoachOpportunities(
          buildCoachOpportunityOptions(
            opportunitiesResponse.data,
            buildSnapshot(contextResponse.data),
            coachContext.accountId,
          ),
        );
      }
      setCoachNotice("Configuración de gobierno guardada.");
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible guardar gobierno de Mi Coach",
        ),
      );
    } finally {
      setCoachGovernanceSaving(false);
    }
  }

  function updateCoachBusinessRuleField(section, field, value) {
    setCoachBusinessRulesDraft((current) => {
      let rules = {};
      try {
        rules = JSON.parse(current || "{}");
      } catch {
        return current;
      }
      return JSON.stringify(
        {
          ...rules,
          [section]: {
            ...(rules[section] || {}),
            [field]: value,
          },
        },
        null,
        2,
      );
    });
  }

  function updateCoachOperationKind(kind, enabled) {
    let rules = {};
    try {
      rules = JSON.parse(coachBusinessRulesDraft || "{}");
    } catch {
      return;
    }
    const currentKinds = Array.isArray(rules.operationPolicy?.allowedKinds)
      ? rules.operationPolicy.allowedKinds
      : (COACH_OPERATION_OPTIONS[coachBusinessRulesChannel] || []).map(
          ([code]) => code,
        );
    const allowedKinds = enabled
      ? [...new Set([...currentKinds, kind])]
      : currentKinds.filter((currentKind) => currentKind !== kind);
    updateCoachBusinessRuleField(
      "operationPolicy",
      "allowedKinds",
      allowedKinds,
    );
  }

  function updateOpportunityStageSet(settingKey, stageCode, enabled) {
    setCoachGovernance((current) => {
      if (!current?.settings) return current;
      const settings = current.settings;
      const existing = Array.isArray(settings[settingKey])
        ? settings[settingKey]
        : [];
      const next = enabled
        ? [...new Set([...existing, stageCode])]
        : existing.filter((code) => code !== stageCode);
      if (!next.length) return current;
      const nextSettings = { ...settings, [settingKey]: next };
      if (settingKey === "qualifiedOpportunityStageCodes" && !enabled) {
        const remainingCommittedStages = (
          settings.committedOpportunityStageCodes || []
        ).filter((code) => code !== stageCode);
        nextSettings.committedOpportunityStageCodes =
          remainingCommittedStages.length > 0
            ? remainingCommittedStages
            : [next[next.length - 1]];
      }
      return { ...current, settings: nextSettings };
    });
  }

  async function saveCoachBusinessRules() {
    setCoachGovernanceSaving(true);
    setError("");
    try {
      const rules = JSON.parse(coachBusinessRulesDraft || "{}");
      const response = await api.put(
        "/api/commercial-intelligence/governance/business-rules",
        {
          channel: coachBusinessRulesChannel,
          process: coachBusinessRulesProcess,
          rules,
        },
      );
      setCoachBusinessRulesDraft(
        JSON.stringify(response.data?.businessRules || rules, null, 2),
      );
      setCoachBusinessRulesSource(
        response.data?.configurationSource || {
          sourceProcess: coachBusinessRulesProcess,
          hasSavedOverride: true,
          inheritedFromDefault: false,
        },
      );
      setCoachGovernance((current) => ({
        ...current,
        businessRules: response.data?.businessRules || rules,
      }));
      setCoachNotice("Reglas del motor guardadas.");
    } catch (requestError) {
      setError(
        requestError instanceof SyntaxError
          ? "El JSON de reglas no es valido."
          : getApiErrorMessage(
              requestError,
              "No fue posible guardar las reglas del motor",
            ),
      );
    } finally {
      setCoachGovernanceSaving(false);
    }
  }

  async function loadCoachBusinessRulesForScope(
    channel = coachBusinessRulesChannel,
    process = coachBusinessRulesProcess,
  ) {
    setCoachGovernanceSaving(true);
    setError("");
    try {
      const params = new URLSearchParams({
        channel,
        process,
      });
      const response = await api.get(
        `/api/commercial-intelligence/governance/business-rules?${params}`,
      );
      setCoachBusinessRulesDraft(
        JSON.stringify(response.data?.businessRules || {}, null, 2),
      );
      setCoachBusinessRulesSource(response.data?.configurationSource || null);
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar las reglas del motor",
        ),
      );
    } finally {
      setCoachGovernanceSaving(false);
    }
  }

  async function resetCoachBusinessRules() {
    setCoachGovernanceSaving(true);
    setError("");
    try {
      const params = new URLSearchParams({
        channel: coachBusinessRulesChannel,
        process: coachBusinessRulesProcess,
      });
      const response = await api.delete(
        `/api/commercial-intelligence/governance/business-rules?${params}`,
      );
      setCoachBusinessRulesDraft(
        JSON.stringify(response.data?.businessRules || {}, null, 2),
      );
      setCoachBusinessRulesSource(response.data?.configurationSource || null);
      setCoachNotice("Reglas restablecidas al valor predeterminado.");
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible restablecer las reglas",
        ),
      );
    } finally {
      setCoachGovernanceSaving(false);
    }
  }

  async function loadCoachAdminRules(
    channel = "all",
    process = coachBusinessRulesProcess,
  ) {
    setCoachGovernanceSaving(true);
    setError("");
    try {
      const params = new URLSearchParams({ channel, process });
      const response = await api.get(
        `/api/commercial-intelligence/governance/rules?${params}`,
      );
      setCoachAdminRules(response.data?.rules || []);
    } catch (requestError) {
      setError(
        getApiErrorMessage(requestError, "No fue posible cargar las reglas"),
      );
    } finally {
      setCoachGovernanceSaving(false);
    }
  }

  function startCoachAdminRuleCreate(scope) {
    setCoachAdminRuleEditingId(null);
    setCoachAdminRuleDraft({
      scope,
      channel: scope === "channel" ? coachBusinessRulesChannel : null,
      process: scope === "channel" ? coachBusinessRulesProcess : "default",
      title: "",
      instruction: "",
      enabled: true,
      sortOrder:
        Math.max(
          0,
          ...coachAdminRules.map((rule) => Number(rule.sortOrder || 0)),
        ) + 10,
    });
  }

  function startCoachAdminRuleEdit(rule) {
    setCoachAdminRuleEditingId(rule.id);
    setCoachAdminRuleDraft({ ...rule });
  }

  async function saveCoachAdminRule() {
    if (!coachAdminRuleDraft) return;
    setCoachGovernanceSaving(true);
    setCoachAdminRuleFeedback(null);
    setError("");
    try {
      const payload = {
        title: coachAdminRuleDraft.title.trim(),
        instruction: coachAdminRuleDraft.instruction.trim(),
        enabled: Boolean(coachAdminRuleDraft.enabled),
        sortOrder: Number(coachAdminRuleDraft.sortOrder || 0),
      };
      if (coachAdminRuleEditingId) {
        await api.put(
          `/api/commercial-intelligence/governance/rules/${coachAdminRuleEditingId}`,
          payload,
        );
      } else {
        const response = await api.post(
          "/api/commercial-intelligence/governance/rules",
          {
            ...payload,
            scope: coachAdminRuleDraft.scope,
            process: coachAdminRuleDraft.process,
            ...(coachAdminRuleDraft.scope === "channel"
              ? { channel: coachAdminRuleDraft.channel }
              : {}),
          },
        );
        const createdRule = response.data?.rule;
        if (createdRule?.id) {
          setCoachAdminRules((current) =>
            current.some((rule) => rule.id === createdRule.id)
              ? current
              : [...current, createdRule],
          );
        }
      }
      setCoachAdminRuleDraft(null);
      setCoachAdminRuleEditingId(null);
      await loadCoachAdminRules("all", coachBusinessRulesProcess);
      const savedTitle = payload.title;
      setCoachAdminRuleFeedback({
        kind: "success",
        message: `La regla “${savedTitle}” se guardó correctamente y ya aparece en la lista.`,
      });
      setCoachNotice("Regla guardada correctamente.");
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible guardar la regla.",
      );
      setCoachAdminRuleFeedback({ kind: "error", message });
      setError(message);
    } finally {
      setCoachGovernanceSaving(false);
    }
  }

  async function toggleCoachAdminRule(rule) {
    setCoachGovernanceSaving(true);
    setCoachAdminRuleFeedback(null);
    setError("");
    try {
      await api.put(
        `/api/commercial-intelligence/governance/rules/${rule.id}`,
        {
          title: rule.title,
          instruction: rule.instruction,
          enabled: !rule.enabled,
          sortOrder: rule.sortOrder,
        },
      );
      await loadCoachAdminRules();
      setCoachAdminRuleFeedback({
        kind: "success",
        message: `La regla “${rule.title}” se actualizó correctamente.`,
      });
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible actualizar la regla.",
      );
      setCoachAdminRuleFeedback({ kind: "error", message });
      setError(message);
    } finally {
      setCoachGovernanceSaving(false);
    }
  }

  async function deleteCoachAdminRule(rule) {
    if (!window.confirm(`¿Eliminar la regla “${rule.title}”?`)) return;
    setCoachGovernanceSaving(true);
    setCoachAdminRuleFeedback(null);
    setError("");
    try {
      await api.delete(
        `/api/commercial-intelligence/governance/rules/${rule.id}`,
      );
      setCoachAdminRules((current) =>
        current.filter((item) => item.id !== rule.id),
      );
      if (coachAdminRuleEditingId === rule.id) {
        setCoachAdminRuleDraft(null);
        setCoachAdminRuleEditingId(null);
      }
      setCoachNotice("Regla eliminada.");
      setCoachAdminRuleFeedback({
        kind: "success",
        message: `La regla “${rule.title}” se eliminó correctamente.`,
      });
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible eliminar la regla.",
      );
      setCoachAdminRuleFeedback({ kind: "error", message });
      setError(message);
    } finally {
      setCoachGovernanceSaving(false);
    }
  }

  function selectCoachIntent(intent) {
    setCoachIntentCode(intent.code);
    setCoachIntentExamplesDraft((intent.examples || []).join("\n"));
    setCoachIntentPreview(null);
    setCoachIntentFeedback(null);
  }

  async function saveCoachIntentExamples() {
    const examples = coachIntentExamplesDraft
      .split("\n")
      .map((example) => example.trim())
      .filter(Boolean);
    setCoachGovernanceSaving(true);
    setCoachIntentFeedback(null);
    setError("");
    try {
      const response = await api.put(
        `/api/commercial-intelligence/governance/intents/${coachIntentCode}/examples`,
        { examples },
      );
      setCoachIntentCatalog(response.data?.catalog || []);
      setCoachIntentRevisions(
        (
          await api.get(
            "/api/commercial-intelligence/governance/intents/revisions",
          )
        ).data?.revisions || [],
      );
      setCoachIntentFeedback({
        kind: "success",
        message: "Los ejemplos se guardaron y quedaron auditados.",
      });
      setCoachNotice("Ejemplos de enrutamiento guardados.");
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible guardar los ejemplos de intención.",
      );
      setCoachIntentFeedback({ kind: "error", message });
      setError(message);
    } finally {
      setCoachGovernanceSaving(false);
    }
  }

  async function previewCoachIntent() {
    const examples = coachIntentExamplesDraft
      .split("\n")
      .map((example) => example.trim())
      .filter(Boolean);
    setCoachGovernanceSaving(true);
    setCoachIntentFeedback(null);
    setCoachIntentPreview(null);
    setError("");
    try {
      const { data } = await api.post(
        "/api/mi-agent/coach/admin/intents/preview",
        {
          question: coachIntentTestQuestion,
          intentCode: coachIntentCode,
          examples,
        },
      );
      setCoachIntentPreview(data);
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible probar la clasificación.",
      );
      setCoachIntentFeedback({ kind: "error", message });
      setError(message);
    } finally {
      setCoachGovernanceSaving(false);
    }
  }

  async function restoreCoachIntentRevision(revision) {
    if (
      !window.confirm(
        `¿Restaurar la configuración anterior a la revisión ${revision.id}?`,
      )
    ) {
      return;
    }
    setCoachGovernanceSaving(true);
    setCoachIntentFeedback(null);
    setError("");
    try {
      const { data } = await api.post(
        `/api/commercial-intelligence/governance/intents/revisions/${revision.id}/restore`,
      );
      setCoachIntentCatalog(data.catalog || []);
      setCoachIntentRevisions(data.revisions || []);
      const selected = (data.catalog || []).find(
        (item) => item.code === coachIntentCode,
      );
      if (selected) setCoachIntentExamplesDraft(selected.examples.join("\n"));
      setCoachIntentPreview(null);
      setCoachIntentFeedback({
        kind: "success",
        message: `Se restauró la revisión ${revision.id}; la restauración también quedó registrada.`,
      });
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible restaurar la configuración.",
      );
      setCoachIntentFeedback({ kind: "error", message });
      setError(message);
    } finally {
      setCoachGovernanceSaving(false);
    }
  }

  function selectChannelIntent(intent) {
    setChannelIntentCode(intent.code);
    setChannelIntentDraft({
      enabled: intent.enabled,
      examples: intent.examples.join("\n"),
      priority: intent.priority,
      allowedTools: [...intent.allowedTools],
      requiredContext: [...intent.requiredContext],
    });
    setChannelIntentPreview(null);
    setChannelIntentFeedback(null);
  }

  async function loadChannelIntentChannel(channel) {
    setChannelIntentChannel(channel);
    setChannelIntentCatalog([]);
    setChannelIntentRevisions([]);
    setChannelIntentCode("");
    setChannelIntentDraft(null);
    setChannelIntentSaving(true);
    setChannelIntentFeedback(null);
    setChannelIntentPreview(null);
    try {
      const { data } = await api.get(
        `/api/commercial-intelligence/governance/channel-intents/${channel}`,
      );
      const catalog = data?.catalog || [];
      const firstIntent = catalog[0];
      setChannelIntentCatalog(catalog);
      setChannelIntentRevisions(data?.revisions || []);
      setChannelIntentCode(firstIntent?.code || "");
      setChannelIntentDraft(
        firstIntent
          ? {
              enabled: firstIntent.enabled,
              examples: firstIntent.examples.join("\n"),
              priority: firstIntent.priority,
              allowedTools: [...firstIntent.allowedTools],
              requiredContext: [...firstIntent.requiredContext],
            }
          : null,
      );
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible cargar la configuración del canal.",
      );
      setChannelIntentFeedback({ kind: "error", message });
    } finally {
      setChannelIntentSaving(false);
    }
  }

  async function saveChannelIntentConfiguration() {
    if (!channelIntentDraft || !channelIntentCode) return;
    const configuration = {
      ...channelIntentDraft,
      examples: channelIntentDraft.examples
        .split("\n")
        .map((example) => example.trim())
        .filter(Boolean),
    };
    setChannelIntentSaving(true);
    setChannelIntentFeedback(null);
    try {
      const { data } = await api.put(
        `/api/commercial-intelligence/governance/channel-intents/${channelIntentChannel}/${channelIntentCode}`,
        configuration,
      );
      const catalog = data?.catalog || [];
      setChannelIntentCatalog(catalog);
      setChannelIntentRevisions(data?.revisions || []);
      const savedIntent = catalog.find(
        (intent) => intent.code === channelIntentCode,
      );
      if (savedIntent) selectChannelIntent(savedIntent);
      setChannelIntentFeedback({
        kind: "success",
        message: "La configuración se guardó y quedó auditada.",
      });
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible guardar la configuración del canal.",
      );
      setChannelIntentFeedback({ kind: "error", message });
    } finally {
      setChannelIntentSaving(false);
    }
  }

  async function previewChannelIntentConfiguration() {
    setChannelIntentSaving(true);
    setChannelIntentFeedback(null);
    setChannelIntentPreview(null);
    try {
      const { data } = await api.post(
        "/api/commercial-intelligence/governance/channel-intents/preview",
        {
          channel: channelIntentChannel,
          question: channelIntentTestQuestion,
          intentCode: channelIntentCode,
          configuration: {
            ...channelIntentDraft,
            examples: channelIntentDraft.examples
              .split("\n")
              .map((example) => example.trim())
              .filter(Boolean),
          },
        },
      );
      setChannelIntentPreview(data);
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible probar el enrutamiento.",
      );
      setChannelIntentFeedback({ kind: "error", message });
    } finally {
      setChannelIntentSaving(false);
    }
  }

  async function restoreChannelIntentConfiguration(revision) {
    if (
      !window.confirm(
        `¿Restaurar la configuración del canal a la revisión ${revision.id}?`,
      )
    ) {
      return;
    }
    setChannelIntentSaving(true);
    setChannelIntentFeedback(null);
    try {
      const { data } = await api.post(
        `/api/commercial-intelligence/governance/channel-intents/${channelIntentChannel}/revisions/${revision.id}/restore`,
      );
      const catalog = data?.catalog || [];
      setChannelIntentCatalog(catalog);
      setChannelIntentRevisions(data?.revisions || []);
      const selected = catalog.find(
        (intent) => intent.code === channelIntentCode,
      );
      if (selected) selectChannelIntent(selected);
      setChannelIntentFeedback({
        kind: "success",
        message: `Se restauró la revisión ${revision.id} y la restauración quedó registrada.`,
      });
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible restaurar la configuración del canal.",
      );
      setChannelIntentFeedback({ kind: "error", message });
    } finally {
      setChannelIntentSaving(false);
    }
  }

  function openCoachActionConfirmation(action) {
    if (!canExecuteCoach || !canUpdateCommercialDevelopment || !action?.title)
      return;
    setCoachActionDraft({
      action,
      opportunityId: action.opportunityId || "",
      title: action.title || "",
      actionType: action.actionType || "next_step",
      status: action.status || "pending",
      dueDate: action.suggestedDueDate || "",
      scheduledAt: action.scheduledAt || "",
      priority:
        action.priority === "critical" ? "high" : action.priority || "medium",
      successCriteria: action.successCriteria || action.expectedOutcome || "",
      notes:
        action.notes ||
        action.reason ||
        "Creada desde el Coach Comercial de Mi Agente.",
      contextSnapshot:
        snapshot.pipeline.opportunities.find(
          (item) => Number(item.id) === Number(action.opportunityId),
        ) || null,
    });
    setError("");
  }

  function openClarifiedCoachActivity(candidate, activity) {
    openCoachActionConfirmation({
      opportunityId: candidate.id,
      title: activity?.title || "Actividad comercial",
      actionType: activity?.actionType || "meeting",
      status: "pending",
      priority: activity?.priority || "medium",
      scheduledAt: activity?.scheduledAt || "",
      suggestedDueDate: activity?.dueDate || "",
      notes: activity?.notes || activity?.rawRequest || "",
      successCriteria:
        activity?.successCriteria ||
        "Definir el siguiente compromiso del cliente.",
    });
  }

  async function applyCoachClarification(candidate, clarification) {
    const entityType = candidate?.entityType;
    if (!entityType) {
      setError(
        "La aclaración del Coach no incluye el tipo de entidad requerido.",
      );
      return;
    }
    if (clarification?.activity && entityType === "opportunity") {
      openClarifiedCoachActivity(candidate, clarification.activity);
      return;
    }
    const nextContext = {
      accountId: String(
        candidate?.accountId || (entityType === "account" ? candidate.id : ""),
      ),
      opportunityId: String(
        candidate?.opportunityId ||
          (entityType === "opportunity" ? candidate.id : ""),
      ),
      contactId: String(
        candidate?.contactId || (entityType === "contact" ? candidate.id : ""),
      ),
      leadId: String(entityType === "lead" ? candidate.id : ""),
    };
    setCoachContext(nextContext);
    coachContextRef.current = nextContext;
    setCoachSessionId(null);
    setCoachActionDraft(null);
    setCoachOperationDraft(null);
    if (entityType === "account") {
      setCoachAccounts((current) =>
        current.some((item) => Number(item.id) === Number(candidate.id))
          ? current
          : [...current, candidate],
      );
    }
    await askCoach(
      clarification?.originalRequest || "Continúa con la solicitud anterior.",
      nextContext,
      null,
    );
  }

  async function createNextStep() {
    const draft = coachActionDraft;
    const action = draft?.action;
    const opportunityId = Number(
      draft?.opportunityId || action?.opportunityId || 0,
    );
    if (!opportunityId || !draft?.title.trim()) return;
    setCreatingActionRank(action.rank);
    setError("");
    try {
      const proposed = await api.post("/api/mi-agent/coach/operations", {
        sessionId: coachSessionId,
        originalIntent: action.reason || action.title,
        context: { opportunityId },
        operation: {
          kind: "activity",
          title: draft.title.trim(),
          opportunityId,
          activityId: null,
          actionType: draft.actionType,
          status: draft.status,
          priority: draft.priority,
          dueDate: draft.dueDate || null,
          scheduledAt: draft.scheduledAt || null,
          successCriteria: draft.successCriteria.trim() || null,
          notes: draft.notes.trim() || null,
          evidence: [],
          missingFields: [],
          requiresConfirmation: true,
        },
      });
      const operation = proposed.data?.operation;
      if (!operation?.id) throw new Error("No se pudo preparar la actividad");
      const response = await api.post(
        `/api/mi-agent/coach/operations/${operation.id}/handoff`,
      );
      if (!response.data?.handoff?.url) {
        throw new Error("No se pudo abrir Desarrollo Comercial");
      }
      if (proposed.data?.sessionId)
        setCoachSessionId(Number(proposed.data.sessionId));
      setCoachActionDraft(null);
      navigate(response.data.handoff.url);
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible crear el próximo paso",
        ),
      );
    } finally {
      setCreatingActionRank(null);
    }
  }

  async function openCoachOperationConfirmation(
    operation,
    { opportunityOptions = null } = {},
  ) {
    coachReturnFocusRef.current = document.activeElement;
    const canApplyOperation = !canExecuteCoach
      ? false
      : operation?.kind === "lead_call_outcome"
        ? canUpdateLeads
        : operation?.kind === "account_field"
          ? canUpdateAccounts
          : operation?.kind === "contact_field"
            ? canUpdateContacts
            : operation?.kind === "create_account"
              ? canCreateAccounts
              : operation?.kind === "create_contact"
                ? canCreateContacts
                : operation?.kind === "lead_resolve"
                  ? canResolveLeads
                  : operation?.kind === "create_opportunity"
                    ? canCreateOpportunities
                    : operation?.kind === "activity"
                      ? canUpdateCommercialDevelopment
                      : operation?.kind === "create_lead"
                        ? canCreateLeads
                        : operation?.kind === "create_contact_mapping"
                          ? canUpdateContacts
                          : operation?.kind === "create_quotation"
                            ? canCreateQuotations
                            : operation?.kind === "create_proposal"
                              ? canCreateProposals
                              : ["stage_answer", "opportunity_field"].includes(
                                    operation?.kind,
                                  )
                                ? canCreateActions
                                : false;
    if (
      !canApplyOperation ||
      (!(
        operation?.opportunityId ||
        operation?.accountId ||
        operation?.contactId ||
        operation?.interactionId ||
        operation?.quotationVersionId
      ) &&
        ![
          "create_account",
          "create_opportunity",
          "create_quotation",
          "create_proposal",
        ].includes(operation?.kind))
    )
      return;
    setCoachOperationOpportunityOptionsOverride(opportunityOptions);
    const persistedOperation = coachPendingOperations.find(
      (candidate) => candidate.id === Number(operation.persistentId || 0),
    );
    let reviewedOperation = persistedOperation;
    if (
      persistedOperation &&
      !COACH_HANDOFF_OPERATION_KINDS.has(operation?.kind)
    ) {
      setSavingCoachOperation(true);
      try {
        const response = await api.post(
          `/api/mi-agent/coach/operations/${persistedOperation.id}/review`,
          { version: persistedOperation.version },
        );
        reviewedOperation = response.data?.operation || persistedOperation;
        setCoachPendingOperations((current) =>
          current.map((item) =>
            item.id === reviewedOperation.id ? reviewedOperation : item,
          ),
        );
      } catch (requestError) {
        const message = getApiErrorMessage(
          requestError,
          "No fue posible revisar el valor actual",
        );
        setCoachOperationAction({
          id: persistedOperation.id,
          state: "error",
          message,
        });
        return;
      } finally {
        setSavingCoachOperation(false);
      }
    }
    const draft = buildCoachOperationDraft(operation, reviewedOperation);
    draft.idempotencyKey = crypto.randomUUID();
    coachDraftSaveSignatureRef.current = JSON.stringify({
      pendingOperation: serializeCoachOperationDraft(draft),
      missingFields: unresolvedCoachFields(serializeCoachOperationDraft(draft)),
    });
    setCoachOperationDraft(draft);
    setError("");
  }

  async function persistCoachOperationDraft(draft) {
    if (!draft?.persistentId) return draft;
    const pendingOperation = serializeCoachOperationDraft(draft);
    const response = await api.patch(
      `/api/mi-agent/coach/operations/${draft.persistentId}`,
      {
        pendingOperation,
        missingFields: unresolvedCoachFields(pendingOperation),
        version: draft.version,
      },
    );
    const persisted = response.data?.operation;
    if (!persisted) return draft;
    setCoachPendingOperations((current) =>
      current.map((item) => (item.id === persisted.id ? persisted : item)),
    );
    return {
      ...draft,
      operation: persisted.pendingOperation,
      version: persisted.version,
      persistenceStatus: persisted.status,
      reviewedAt: persisted.reviewedAt || null,
    };
  }

  function appendCoachOperationMessage(text, type = "success") {
    setCoachMessages((current) => [
      ...current,
      {
        id: `coach-operation-${Date.now()}-${Math.random()}`,
        role: "coach",
        result: {
          responseType: type === "error" ? "error" : "operation",
          confidence: "high",
          answer: text,
          evidence: [],
          recommendation:
            type === "error"
              ? "Corrige el problema y vuelve a intentarlo."
              : "La operación fue aplicada correctamente.",
        },
      },
    ]);
  }

  function closeCoachOperationDraft() {
    setCoachOperationDraft(null);
    setCoachOperationOpportunityOptionsOverride(null);
    window.requestAnimationFrame(() => coachReturnFocusRef.current?.focus());
  }

  async function applyCoachOperation() {
    let draft = coachOperationDraft;
    let operation = draft?.operation;
    const delegatesToModule = COACH_HANDOFF_OPERATION_KINDS.has(
      operation?.kind,
    );
    if (
      !delegatesToModule &&
      !(
        draft?.opportunityId ||
        operation?.opportunityId ||
        operation?.accountId ||
        operation?.contactId ||
        operation?.interactionId
      )
    )
      return;
    setError("");
    setSavingCoachOperation(true);
    try {
      draft = await persistCoachOperationDraft(draft);
      operation = draft?.operation;
      if (delegatesToModule) {
        if (!draft?.persistentId)
          throw new Error("La operación no tiene un borrador persistente");
        const response = await api.post(
          `/api/mi-agent/coach/operations/${draft.persistentId}/handoff`,
        );
        const handoff = response.data?.handoff;
        if (!handoff?.url)
          throw new Error("No fue posible preparar el módulo de destino");
        if (response.data?.operation) {
          setCoachPendingOperations((current) =>
            current.map((item) =>
              item.id === response.data.operation.id
                ? response.data.operation
                : item,
            ),
          );
        }
        closeCoachOperationDraft();
        navigate(handoff.url);
        return;
      }
      if (!draft.reviewedAt) {
        const reviewResponse = await api.post(
          `/api/mi-agent/coach/operations/${draft.persistentId}/review`,
          { version: draft.version },
        );
        const reviewedOperation = reviewResponse.data?.operation;
        if (!reviewedOperation)
          throw new Error("No fue posible revisar el valor actual");
        setCoachPendingOperations((current) =>
          current.map((item) =>
            item.id === reviewedOperation.id ? reviewedOperation : item,
          ),
        );
        setCoachOperationDraft((current) =>
          current?.persistentId === reviewedOperation.id
            ? {
                ...current,
                operation: {
                  ...reviewedOperation.pendingOperation,
                  missingFields: reviewedOperation.missingFields || [],
                },
                version: reviewedOperation.version,
                persistenceStatus: reviewedOperation.status,
                reviewedAt: reviewedOperation.reviewedAt,
                error: "",
              }
            : current,
        );
        return;
      }
      const response = await api.post(
        `/api/mi-agent/coach/operations/${draft.persistentId}/execute`,
        {
          version: draft.version,
          idempotencyKey: draft.idempotencyKey,
        },
      );
      const completedOperation = response.data?.operation;
      if (!operation.successNotice) {
        operation.successNotice =
          operation.kind === "opportunity_field"
            ? "Cambio de la oportunidad guardado correctamente."
            : operation.kind === "stage_answer"
              ? "Respuesta de etapa guardada correctamente."
              : operation.kind === "account_field"
                ? "Cambio de la cuenta guardado correctamente."
                : operation.kind === "contact_field"
                  ? "Cambio del contacto guardado correctamente."
                  : operation.kind === "lead_call_outcome"
                    ? "Resultado del lead guardado correctamente."
                    : "Cambio guardado correctamente en el CRM.";
      }
      if (completedOperation?.id)
        setCoachUndoOperationId(completedOperation.id);
      if (completedOperation) {
        setCoachPendingOperations((current) =>
          current.filter((item) => item.id !== completedOperation.id),
        );
        setCoachRecentOperations((current) =>
          [
            completedOperation,
            ...current.filter((item) => item.id !== completedOperation.id),
          ].slice(0, 6),
        );
      }
      closeCoachOperationDraft();
      setCoachMessages((current) =>
        current
          .filter((message) => message.result?.responseType !== "error")
          .map((message) => {
            if (!Array.isArray(message.result?.operations)) return message;
            const remainingOperations = message.result.operations.filter(
              (candidate) =>
                candidate !== operation &&
                !(
                  candidate.kind === operation.kind &&
                  candidate.opportunityId === operation.opportunityId &&
                  candidate.accountId === operation.accountId &&
                  candidate.contactId === operation.contactId &&
                  candidate.field === operation.field
                ),
            );
            return remainingOperations.length ===
              message.result.operations.length
              ? message
              : {
                  ...message,
                  result: {
                    ...message.result,
                    operations: remainingOperations,
                  },
                };
          }),
      );
      if (operation.successNotice)
        appendCoachOperationMessage(operation.successNotice);
      await loadDashboard();
      if (operation.successNotice) setCoachNotice(operation.successNotice);
    } catch (requestError) {
      const responseData = requestError?.response?.data;
      const errorCode = responseData?.code;
      setCoachOperationDraft((current) =>
        current
          ? {
              ...current,
              operation:
                errorCode === "COACH_TARGET_CHANGED" &&
                Object.prototype.hasOwnProperty.call(
                  responseData || {},
                  "currentValue",
                )
                  ? {
                      ...current.operation,
                      currentValue: responseData.currentValue,
                    }
                  : current.operation,
              version: responseData?.operation?.version || current.version,
              persistenceStatus:
                responseData?.operation?.status || current.persistenceStatus,
              reviewedAt:
                errorCode === "COACH_TARGET_CHANGED" ||
                errorCode === "COACH_REVIEW_REQUIRED"
                  ? null
                  : current.reviewedAt,
              error: getApiErrorMessage(
                requestError,
                "No fue posible aplicar el cambio propuesto",
              ),
              duplicateWarnings:
                responseData?.duplicateWarnings ||
                current.duplicateWarnings ||
                [],
              duplicateDecision:
                responseData?.duplicateDecision ||
                current.duplicateDecision ||
                null,
              duplicateReview:
                responseData?.duplicateReview ||
                current.duplicateReview ||
                null,
            }
          : current,
      );
      appendCoachOperationMessage(
        getApiErrorMessage(
          requestError,
          "No fue posible aplicar el cambio propuesto",
        ),
        "error",
      );
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible aplicar el cambio propuesto",
        ),
      );
    } finally {
      setSavingCoachOperation(false);
    }
  }

  async function undoCoachOperation() {
    if (!coachUndoOperationId) return;
    try {
      const response = await api.post(
        `/api/mi-agent/coach/operations/${coachUndoOperationId}/revert`,
      );
      if (response.data?.operation) {
        setCoachRecentOperations((current) =>
          [
            response.data.operation,
            ...current.filter((item) => item.id !== response.data.operation.id),
          ].slice(0, 6),
        );
      }
      setCoachUndoOperationId(null);
      await loadDashboard();
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible revertir el cambio del Coach",
        ),
      );
    }
  }

  async function rejectCoachOperation(operation) {
    const persistentId =
      coachOperationDraft?.persistentId || operation?.persistentId || null;
    if (!persistentId) {
      closeCoachOperationDraft();
      return;
    }
    try {
      const response = await api.post(
        `/api/mi-agent/coach/operations/${persistentId}/reject`,
        { reason: "Rechazada por el vendedor" },
      );
      if (response.data?.operation) {
        setCoachPendingOperations((current) =>
          current.filter((item) => item.id !== response.data.operation.id),
        );
        setCoachRecentOperations((current) =>
          [
            response.data.operation,
            ...current.filter((item) => item.id !== response.data.operation.id),
          ].slice(0, 6),
        );
      }
      closeCoachOperationDraft();
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible rechazar la operación del Coach",
        ),
      );
    }
  }

  async function continueCoachOperation(persistedOperation) {
    const operation = {
      ...persistedOperation.pendingOperation,
      persistentId: persistedOperation.id,
    };
    if (persistedOperation.status !== "handed_off") {
      await openCoachOperationConfirmation(operation);
      return;
    }
    setCoachOperationAction({ id: persistedOperation.id, state: "loading" });
    try {
      const response = await api.post(
        `/api/mi-agent/coach/operations/${persistedOperation.id}/handoff`,
      );
      if (!response.data?.handoff?.url) {
        throw new Error("No fue posible recuperar el módulo de destino");
      }
      navigate(response.data.handoff.url);
    } catch (requestError) {
      setCoachOperationAction({
        id: persistedOperation.id,
        state: "error",
        message: getApiErrorMessage(
          requestError,
          "No fue posible continuar la operación",
        ),
      });
    }
  }

  async function cancelPendingCoachOperation(persistedOperation) {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "¿Quieres descartar esta acción pendiente? La información preparada se perderá.",
      )
    ) {
      return;
    }
    setCoachOperationAction({ id: persistedOperation.id, state: "loading" });
    try {
      const response = await api.post(
        `/api/mi-agent/coach/operations/${persistedOperation.id}/status`,
        {
          status: "cancelled",
          cancellationReason: "Cancelada por el vendedor",
        },
      );
      setCoachPendingOperations((current) =>
        current.filter((item) => item.id !== persistedOperation.id),
      );
      if (response.data?.operation) {
        setCoachRecentOperations((current) =>
          [
            response.data.operation,
            ...current.filter((item) => item.id !== response.data.operation.id),
          ].slice(0, 6),
        );
      }
      setCoachOperationAction({});
    } catch (requestError) {
      setCoachOperationAction({
        id: persistedOperation.id,
        state: "error",
        message: getApiErrorMessage(
          requestError,
          "No fue posible descartar la acción",
        ),
      });
    }
  }

  function rejectCoachAction() {
    setCoachActionDraft(null);
  }

  function updateCoachPayloadField(field, value) {
    setCoachOperationDraft((current) => ({
      ...current,
      payload: { ...(current?.payload || {}), [field]: value },
      value: "",
    }));
  }

  function updateCoachFoundationVisibility(visible) {
    setShowCoachFoundation(visible);
    window.localStorage.setItem(
      COACH_FOUNDATION_VISIBILITY_KEY,
      String(visible),
    );
  }

  function updateCustomerChatFoundationVisibility(visible) {
    setShowCustomerChatFoundation(visible);
    window.localStorage.setItem(
      CUSTOMER_CHAT_FOUNDATION_VISIBILITY_KEY,
      String(visible),
    );
  }

  const coachDraftSerialized = coachOperationDraft
    ? serializeCoachOperationDraft(coachOperationDraft)
    : null;
  const coachDraftMissingFields = coachDraftSerialized
    ? unresolvedCoachFields(coachDraftSerialized)
    : [];
  const coachDraftMissingSet = new Set(coachDraftMissingFields);
  const hasCoachFoundation = coachMessages.some((message) => {
    const result = message.result;
    return Boolean(
      result?.facts?.length ||
      result?.evidence?.length ||
      result?.inferences?.length ||
      result?.recommendation,
    );
  });
  const hasCustomerChatFoundation = customerChatMessages.some(
    (message) =>
      message.role !== "seller" &&
      (message.evidence?.length ||
        message.inferences?.length ||
        message.publicSources?.length ||
        message.agents?.length),
  );
  const hasCoachConversation = Boolean(
    coachSessionId ||
    coachMessages.length ||
    coachRecentOperations.length ||
    coachOperationDraft,
  );
  let selectedCoachBusinessRules = {};
  try {
    selectedCoachBusinessRules = JSON.parse(coachBusinessRulesDraft || "{}");
  } catch {
    selectedCoachBusinessRules = {};
  }
  const coachBusinessRulesSourceLabel =
    coachBusinessRulesSource?.hasSavedOverride &&
    coachBusinessRulesSource.sourceProcess === coachBusinessRulesProcess
      ? coachBusinessRulesProcess === "default"
        ? "Hay una configuración predeterminada guardada para este canal."
        : "Hay ajustes propios guardados para este tipo de consulta."
      : coachBusinessRulesSource?.inheritedFromDefault
        ? "No hay ajustes propios para este tipo; se usa la configuración predeterminada del canal."
        : "Se usan los valores iniciales del sistema para este canal.";
  const selectedCoachProcessOption = getCoachProcessOption(
    coachBusinessRulesProcess,
    coachBusinessRulesChannel,
  );
  const getVisibleChannelRules = (channel) =>
    coachAdminRules.filter(
      (rule) =>
        rule.scope === "channel" &&
        rule.channel === channel &&
        (channel !== coachBusinessRulesChannel ||
          rule.process === "default" ||
          rule.process === coachBusinessRulesProcess),
    );
  const selectedCoachIntent = coachIntentCatalog.find(
    (intent) => intent.code === coachIntentCode,
  );
  const selectedChannelIntent = channelIntentCatalog.find(
    (intent) => intent.code === channelIntentCode,
  );

  if (loading) {
    return (
      <section className="mi-agent-page">
        <div className="mi-agent-empty">Cargando tu situación comercial...</div>
      </section>
    );
  }

  return (
    <section className="mi-agent-page">
      <header className="mi-agent-hero">
        <div>
          <span className="mi-agent-kicker">Ejecución comercial</span>
          <h2>Mi Coach</h2>
          <p>Tu siguiente mejor movimiento para acercarte a la cuota.</p>
        </div>
      </header>

      {error ? <p className="form-error">{error}</p> : null}
      {coachNotice ? (
        <p className="mi-agent-coach-success" role="status">
          {coachNotice}
        </p>
      ) : null}

      <div className="mi-agent-workspace-navigation">
        <nav
          className="mi-agent-workspace-tabs"
          aria-label="Espacios de Mi Coach"
        >
          {canUseCoach ? (
            <>
              <button
                type="button"
                className={activeWorkspace === "summary" ? "is-active" : ""}
                aria-current={
                  activeWorkspace === "summary" ? "page" : undefined
                }
                onClick={() => setActiveWorkspace("summary")}
              >
                <LayoutDashboard size={16} aria-hidden="true" />
                Resumen
              </button>
              <button
                type="button"
                className={activeWorkspace === "coach" ? "is-active" : ""}
                aria-current={activeWorkspace === "coach" ? "page" : undefined}
                onClick={() => setActiveWorkspace("coach")}
              >
                <MessageCircle size={16} aria-hidden="true" />
                Coach
              </button>
            </>
          ) : null}
          {canReadCustomerIntelligence ? (
            <button
              type="button"
              className={activeWorkspace === "customer" ? "is-active" : ""}
              aria-current={activeWorkspace === "customer" ? "page" : undefined}
              onClick={() => setActiveWorkspace("customer")}
            >
              Cliente existente
            </button>
          ) : null}
          {canReadProspecting || canCreateProspecting ? (
            <button
              type="button"
              className={activeWorkspace === "prospect" ? "is-active" : ""}
              aria-current={activeWorkspace === "prospect" ? "page" : undefined}
              onClick={() => setActiveWorkspace("prospect")}
            >
              Cuenta nueva
            </button>
          ) : null}
        </nav>
        {canManageCoach ? (
          <nav className="mi-agent-workspace-admin" aria-label="Administración">
            <button
              type="button"
              className={activeWorkspace === "admin" ? "is-active" : ""}
              aria-current={activeWorkspace === "admin" ? "page" : undefined}
              onClick={() => {
                setActiveWorkspace("admin");
                loadCoachGovernance();
              }}
            >
              <Settings2 size={16} aria-hidden="true" />
              Administración
            </button>
          </nav>
        ) : null}
        {canDiagnoseCustomerChats ? (
          <nav
            className="mi-agent-workspace-admin"
            aria-label="Diagnóstico de soporte"
          >
            <button
              type="button"
              className={
                activeWorkspace === "chat-diagnostics" ? "is-active" : ""
              }
              aria-current={
                activeWorkspace === "chat-diagnostics" ? "page" : undefined
              }
              onClick={() => {
                setActiveWorkspace("chat-diagnostics");
                setChatDiagnosticsSelected(null);
                void loadCustomerChatDiagnostics({ page: 1 });
                setChatDiagnosticsPage(1);
              }}
            >
              Diagnóstico de chats
            </button>
          </nav>
        ) : null}
      </div>

      {activeWorkspace === "chat-diagnostics" && canDiagnoseCustomerChats ? (
        <section className="mi-agent-workspace-panel mi-agent-governance-panel">
          <div className="mi-agent-section-heading">
            <div>
              <span className="mi-agent-section-label">Soporte</span>
              <h3>Diagnóstico de chats</h3>
              <p>
                Busca por usuario, sesión o job; abre el turno para revisar su
                traza.
              </p>
            </div>
            <span>Solo lectura</span>
          </div>
          <form
            className="mi-agent-chat-diagnostics-search"
            onSubmit={(event) => {
              event.preventDefault();
              setChatDiagnosticsPage(1);
              void loadCustomerChatDiagnostics({ page: 1 });
            }}
          >
            <label>
              Usuario, correo, cuenta, sessionId o jobId
              <input
                value={chatDiagnosticsQuery}
                onChange={(event) =>
                  setChatDiagnosticsQuery(event.target.value)
                }
                placeholder="Buscar sesiones"
              />
            </label>
            <label>
              Estado
              <select
                value={chatDiagnosticsStatus}
                onChange={(event) => {
                  const nextStatus = event.target.value;
                  setChatDiagnosticsStatus(nextStatus);
                  setChatDiagnosticsPage(1);
                  void loadCustomerChatDiagnostics({
                    page: 1,
                    status: nextStatus,
                  });
                }}
              >
                <option value="all">Todas</option>
                <option value="errors">Con error</option>
                <option value="active">En proceso</option>
              </select>
            </label>
            <label>
              Cuenta ID
              <input
                inputMode="numeric"
                value={chatDiagnosticsAccountId}
                onChange={(event) =>
                  setChatDiagnosticsAccountId(
                    event.target.value.replace(/\D/g, ""),
                  )
                }
                placeholder="Todas las cuentas"
              />
            </label>
            <label>
              Desde
              <input
                type="date"
                value={chatDiagnosticsDateFrom}
                onChange={(event) =>
                  setChatDiagnosticsDateFrom(event.target.value)
                }
              />
            </label>
            <label>
              Hasta
              <input
                type="date"
                value={chatDiagnosticsDateTo}
                onChange={(event) =>
                  setChatDiagnosticsDateTo(event.target.value)
                }
              />
            </label>
            <button type="submit" disabled={chatDiagnosticsLoading}>
              Buscar
            </button>
          </form>
          {chatDiagnosticsError ? (
            <p className="form-error" role="alert">
              {chatDiagnosticsError}
            </p>
          ) : null}
          <div className="mi-agent-chat-diagnostics-layout">
            <section aria-label="Sesiones encontradas">
              <div className="mi-agent-domain-policy-heading">
                <h4>Sesiones ({chatDiagnosticsResult?.total || 0})</h4>
                <button
                  type="button"
                  className="mi-agent-secondary-button"
                  disabled={chatDiagnosticsLoading || chatDiagnosticsPage <= 1}
                  onClick={() => {
                    const page = chatDiagnosticsPage - 1;
                    setChatDiagnosticsPage(page);
                    void loadCustomerChatDiagnostics({ page });
                  }}
                >
                  Anterior
                </button>
                <button
                  type="button"
                  className="mi-agent-secondary-button"
                  disabled={
                    chatDiagnosticsLoading ||
                    chatDiagnosticsPage * 20 >=
                      (chatDiagnosticsResult?.total || 0)
                  }
                  onClick={() => {
                    const page = chatDiagnosticsPage + 1;
                    setChatDiagnosticsPage(page);
                    void loadCustomerChatDiagnostics({ page });
                  }}
                >
                  Siguiente
                </button>
              </div>
              {chatDiagnosticsLoading ? (
                <div className="mi-agent-empty">Cargando sesiones...</div>
              ) : null}
              <div className="mi-agent-chat-diagnostics-list">
                {(chatDiagnosticsResult?.sessions || []).map((session) => (
                  <article key={session.sessionId}>
                    <div>
                      <strong>{session.userName || session.userEmail}</strong>
                      <span>{session.userEmail}</span>
                      <span>
                        {session.accountName ||
                          `Cuenta ${session.accountId || "sin asignar"}`}
                      </span>
                      <small>
                        Sesión {session.sessionId}
                        {session.latestJob?.jobId
                          ? ` · Job ${session.latestJob.jobId}`
                          : " · Sin jobs"}
                      </small>
                      {session.latestJob ? (
                        <small>
                          {session.latestJob.status} ·{" "}
                          {session.latestJob.question || "Sin pregunta"}
                          {session.latestJob.issueBlock
                            ? ` · ${session.latestJob.issueBlock}: ${session.latestJob.issueTitle || "Revisión requerida"}`
                            : ""}
                        </small>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="mi-agent-secondary-button"
                      onClick={() =>
                        void openCustomerChatDiagnostic({
                          ...(/^\d+$/.test(chatDiagnosticsQuery) &&
                          Number(chatDiagnosticsQuery) !== session.sessionId
                            ? { jobId: Number(chatDiagnosticsQuery) }
                            : { sessionId: session.sessionId }),
                        })
                      }
                    >
                      Abrir diagnóstico
                    </button>
                  </article>
                ))}
                {!chatDiagnosticsLoading &&
                !chatDiagnosticsResult?.sessions?.length ? (
                  <div className="mi-agent-empty">
                    No hay sesiones para esos filtros.
                  </div>
                ) : null}
              </div>
            </section>
            <section aria-label="Detalle de sesión">
              {chatDiagnosticsSelected ? (
                <>
                  <div className="mi-agent-domain-policy-heading">
                    <div>
                      <span className="mi-agent-section-label">
                        {chatDiagnosticsSelected.user.name} ·{" "}
                        {chatDiagnosticsSelected.user.email}
                      </span>
                      <h4>
                        Sesión {chatDiagnosticsSelected.id} ·{" "}
                        {chatDiagnosticsSelected.accountName ||
                          "Cuenta no disponible"}
                      </h4>
                    </div>
                  </div>
                  <div className="mi-agent-chat-diagnostics-jobs">
                    {chatDiagnosticsSelected.jobs.map((job) => (
                      <article key={job.id}>
                        <div>
                          <strong>
                            Job {job.id} · {job.status}
                          </strong>
                          <p>{job.question || "Sin pregunta registrada"}</p>
                          {job.errorMessage ? (
                            <p className="form-error">{job.errorMessage}</p>
                          ) : null}
                          {job.response.answer ? (
                            <p>{job.response.answer}</p>
                          ) : null}
                        </div>
                        {job.debug ? (
                          <details className="mi-agent-customer-chat-debug">
                            <summary>
                              Diagnóstico B1–B11 ·{" "}
                              {job.debug.issue?.block || "Sin bloque señalado"}
                            </summary>
                            <CustomerChatDebugFlow debug={job.debug} />
                          </details>
                        ) : (
                          <small>
                            Este job no conserva diagnóstico técnico.
                          </small>
                        )}
                      </article>
                    ))}
                  </div>
                  <details>
                    <summary>Historial de la sesión</summary>
                    <ol className="mi-agent-chat-diagnostics-history">
                      {chatDiagnosticsSelected.history.map((message, index) => (
                        <li key={`${index}-${message.role}`}>
                          <strong>
                            {message.role === "assistant" ? "Chat" : "Usuario"}
                          </strong>
                          <p>{message.text}</p>
                        </li>
                      ))}
                    </ol>
                  </details>
                </>
              ) : (
                <div className="mi-agent-empty">
                  Selecciona una sesión para revisar el historial y sus jobs.
                </div>
              )}
            </section>
          </div>
        </section>
      ) : activeWorkspace === "summary" || activeWorkspace === "coach" ? (
        <>
          {activeWorkspace === "summary" ? (
            <section
              className="mi-agent-summary"
              aria-labelledby="mi-agent-summary-title"
            >
              <div className="mi-agent-section-heading">
                <div>
                  <span className="mi-agent-section-label">Vista general</span>
                  <h3 id="mi-agent-summary-title">Resumen comercial</h3>
                </div>
                <div className="mi-agent-summary-period">
                  <span>{snapshot.period?.label || "Período actual"}</span>
                  {currency !== "USD" &&
                  snapshot.quota.currencyConversionAvailable ? (
                    <small>
                      1 USD ={" "}
                      {snapshot.quota.usdToQuotaRate.toLocaleString("es-MX", {
                        maximumFractionDigits: 4,
                      })}{" "}
                      {currency} · tasa de referencia{" "}
                      {snapshot.quota.currencyRateFetchedAt
                        ? formatDate(snapshot.quota.currencyRateFetchedAt)
                        : "actual"}
                    </small>
                  ) : null}
                </div>
              </div>
              <div className="mi-agent-metrics">
                <article>
                  <span>Cuota</span>
                  <strong>
                    {formatCurrency(snapshot.quota.assignedAmount, currency)}
                  </strong>
                  <small>{snapshot.period?.label || "Período actual"}</small>
                </article>
                <article>
                  <span>Real ganado</span>
                  <strong>
                    {snapshot.quota.currencyConversionAvailable
                      ? formatCurrency(snapshot.quota.actualAmount, currency)
                      : "No disponible"}
                  </strong>
                  <small>
                    {!snapshot.quota.currencyConversionAvailable
                      ? "Avance no disponible: falta tipo de cambio"
                      : snapshot.quota.assignedAmount
                        ? `${Math.round((snapshot.quota.actualAmount / snapshot.quota.assignedAmount) * 100)}% de avance`
                        : "Sin cuota"}
                  </small>
                </article>
                <article className="is-alert">
                  <span>Brecha</span>
                  <strong>
                    {snapshot.quota.currencyConversionAvailable
                      ? formatCurrency(snapshot.quota.gapAmount, currency)
                      : "No disponible"}
                  </strong>
                  <small>
                    {snapshot.quota.currencyConversionAvailable
                      ? "Lo que aún falta"
                      : "No se obtuvo tipo de cambio desde USD"}
                  </small>
                </article>
                <article>
                  <span>Pipeline abierto</span>
                  <strong>
                    {snapshot.quota.currencyConversionAvailable
                      ? formatCurrency(snapshot.pipeline.openAmount, currency)
                      : "No disponible"}
                  </strong>
                  <small>
                    {snapshot.pipeline.openCount} oportunidades ·{" "}
                    {!snapshot.quota.currencyConversionAvailable
                      ? "Cobertura no disponible"
                      : coverage
                        ? `${coverage.toFixed(1)}x cobertura`
                        : "Sin cobertura"}
                  </small>
                </article>
              </div>
            </section>
          ) : null}

          {activeWorkspace === "coach" ? (
            <>
              <section className="mi-agent-coach-panel">
                <div className="mi-agent-section-heading">
                  <div>
                    <span className="mi-agent-section-label">
                      Coach comercial
                    </span>
                    <h3>Pregúntale a tu Coach</h3>
                  </div>
                  <span>Asesoría general para tu desempeño comercial</span>
                </div>
                <div className="mi-agent-coach-context-heading">
                  <div>
                    <strong>Ámbito de la conversación</strong>
                    <small>
                      Empieza con tu cartera y prioridades generales. Menciona
                      una cuenta, oportunidad, contacto o lead para enfocar la
                      conversación.
                    </small>
                  </div>
                </div>
                <div
                  className="mi-agent-coach-context-summary"
                  aria-label="Alcance actual del Coach"
                  role="group"
                >
                  <strong>
                    {coachContext.accountId ||
                    coachContext.opportunityId ||
                    coachContext.contactId ||
                    coachContext.leadId
                      ? "Enfoque activo"
                      : "Ámbito general del vendedor"}
                  </strong>
                  {coachContext.accountId ? (
                    <span>
                      {coachAccounts.find(
                        (item) =>
                          String(item.id) === String(coachContext.accountId),
                      )?.name || "Cuenta en contexto"}
                    </span>
                  ) : null}
                  {coachContext.opportunityId ? (
                    <span>
                      {coachOpportunities.find(
                        (item) =>
                          String(item.id) ===
                          String(coachContext.opportunityId),
                      )?.name || "Oportunidad en contexto"}
                    </span>
                  ) : null}
                  {coachContext.contactId ? (
                    <span>
                      {coachContacts.find(
                        (item) =>
                          String(item.id) === String(coachContext.contactId),
                      )?.full_name || "Contacto en contexto"}
                    </span>
                  ) : null}
                  {coachContext.leadId ? <span>Lead en contexto</span> : null}
                  {coachContext.accountId ||
                  coachContext.opportunityId ||
                  coachContext.contactId ||
                  coachContext.leadId ? (
                    <button
                      type="button"
                      className="mi-agent-secondary-button"
                      onClick={requestCoachGeneralScope}
                      disabled={loadingCoachContext || askingCoach}
                    >
                      Volver al ámbito general
                    </button>
                  ) : (
                    <span>
                      Menciona una entidad en tu pregunta para centrar el
                      análisis.
                    </span>
                  )}
                </div>
                {coachMetrics ? (
                  <div
                    className="mi-agent-coach-metrics"
                    aria-label="Actividad del Coach durante los últimos 30 días"
                  >
                    <div>
                      <strong>Actividad del Coach</strong>
                      <small>Últimos 30 días</small>
                    </div>
                    <dl>
                      <div>
                        <dt>Consultas</dt>
                        <dd>{coachMetrics.requests}</dd>
                      </div>
                      <div>
                        <dt>Propuestas</dt>
                        <dd>{coachMetrics.proposed || 0}</dd>
                      </div>
                      <div>
                        <dt>Decididas</dt>
                        <dd>{coachMetrics.decided || 0}</dd>
                      </div>
                      <div>
                        <dt>Aprobadas</dt>
                        <dd>{coachMetrics.approved || 0}</dd>
                      </div>
                      <div>
                        <dt>Rechazadas</dt>
                        <dd>{coachMetrics.rejected || 0}</dd>
                      </div>
                      <div>
                        <dt>Completadas</dt>
                        <dd>{coachMetrics.completed || 0}</dd>
                      </div>
                    </dl>
                  </div>
                ) : null}
                <div className="mi-agent-coach-quick-questions">
                  <strong>Preguntas rápidas</strong>
                  <div className="mi-agent-coach-suggestions">
                    {coachContext.opportunityId ? (
                      <>
                        <button
                          type="button"
                          disabled={askingCoach}
                          onClick={() =>
                            askCoach("¿Qué falta para avanzar de etapa?")
                          }
                        >
                          ¿Qué falta para avanzar?
                        </button>
                        <button
                          type="button"
                          disabled={askingCoach}
                          onClick={() =>
                            askCoach("Registra una actividad de seguimiento")
                          }
                        >
                          Registrar actividad
                        </button>
                      </>
                    ) : coachContext.accountId ? (
                      <>
                        <button
                          type="button"
                          disabled={askingCoach}
                          onClick={() =>
                            askCoach(
                              "¿Qué oportunidad debería priorizar en esta cuenta y cuál sería el siguiente paso?",
                            )
                          }
                        >
                          ¿Qué priorizar en esta cuenta?
                        </button>
                        <button
                          type="button"
                          disabled={askingCoach}
                          onClick={() =>
                            askCoach(
                              "¿Qué puedo mejorar en mi seguimiento de esta cuenta?",
                            )
                          }
                        >
                          ¿Cómo mejorar mi seguimiento?
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={askingCoach}
                          onClick={() =>
                            askCoach(
                              "¿Cómo puedo mejorar mi desempeño este mes?",
                            )
                          }
                        >
                          ¿Cómo mejorar mi desempeño?
                        </button>
                        <button
                          type="button"
                          disabled={askingCoach}
                          onClick={() =>
                            askCoach(
                              "¿Qué oportunidades debo priorizar por riesgo y qué seguimiento debo hacer?",
                            )
                          }
                        >
                          ¿Qué atender primero?
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div className="mi-agent-coach-conversation-heading">
                  <div>
                    <strong>Conversación</strong>
                    <small>
                      {coachMessages.length
                        ? `${coachMessages.length} mensajes en esta sesión`
                        : "Inicia una conversación con tu contexto actual"}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost mi-agent-coach-clear-button"
                    disabled={askingCoach || !hasCoachConversation}
                    onClick={clearCoachConversation}
                    title="Limpiar conversación"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    Limpiar conversación
                  </button>
                  {hasCoachFoundation ? (
                    <label className="mi-agent-coach-foundation-toggle">
                      <span>Mostrar fundamento</span>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={showCoachFoundation}
                        onChange={(event) =>
                          updateCoachFoundationVisibility(event.target.checked)
                        }
                      />
                      <span
                        className="mi-agent-coach-foundation-toggle-track"
                        aria-hidden="true"
                      />
                    </label>
                  ) : null}
                </div>
                <form
                  className="mi-agent-coach-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    askCoach();
                  }}
                >
                  <input
                    value={coachQuestion}
                    onChange={(event) => setCoachQuestion(event.target.value)}
                    placeholder="Escribe tu pregunta para el Coach..."
                    disabled={askingCoach}
                  />
                  <button
                    type="submit"
                    className="mi-agent-primary-button"
                    disabled={askingCoach || !coachQuestion.trim()}
                  >
                    {askingCoach ? "Consultando..." : "Preguntar"}
                  </button>
                </form>
                {coachUndoOperationId ? (
                  <button
                    type="button"
                    className="btn-secondary mi-agent-coach-undo-button"
                    onClick={undoCoachOperation}
                  >
                    Deshacer último cambio
                  </button>
                ) : null}
                {coachMessages
                  .filter((message) => message.result?.clarification)
                  .slice(-1)
                  .map((message) => {
                    const clarification = message.result.clarification;
                    return (
                      <div
                        className="mi-agent-coach-action"
                        key={`${message.id}-clarification`}
                      >
                        <strong>{clarification.message}</strong>
                        <small>Falta: {clarification.missing.join(", ")}</small>
                        {clarification.candidates.length ? (
                          clarification.candidates.map((candidate) => (
                            <button
                              type="button"
                              className="btn-secondary"
                              key={`${candidate.entityType}-${candidate.id}`}
                              onClick={() =>
                                applyCoachClarification(
                                  candidate,
                                  clarification,
                                )
                              }
                            >
                              Usar {candidate.name}
                              {candidate.accountName
                                ? ` · ${candidate.accountName}`
                                : ""}
                              {candidate.stageName
                                ? ` · ${candidate.stageName}`
                                : ""}
                              {candidate.email ? ` · ${candidate.email}` : ""}
                            </button>
                          ))
                        ) : (
                          <small>
                            No hay registros accesibles para seleccionar.
                          </small>
                        )}
                      </div>
                    );
                  })}
                {coachPendingOperations.length ? (
                  <section
                    className="mi-agent-coach-pending"
                    aria-label="Acciones pendientes del Coach"
                  >
                    <div>
                      <strong>Acciones pendientes</strong>
                      <small>
                        Retoma las acciones que iniciaste o descarta las que ya
                        no necesitas.
                      </small>
                    </div>
                    <div className="mi-agent-coach-pending-list">
                      {coachPendingOperations.map((persistedOperation) => {
                        const statusMeta =
                          COACH_OPERATION_STATUS_META[
                            persistedOperation.status
                          ] || COACH_OPERATION_STATUS_META.proposed;
                        const missingFields =
                          persistedOperation.missingFields || [];
                        const actionPending =
                          coachOperationAction.id === persistedOperation.id &&
                          coachOperationAction.state === "loading";
                        const actionError =
                          coachOperationAction.id === persistedOperation.id &&
                          coachOperationAction.state === "error"
                            ? coachOperationAction.message
                            : null;
                        const handoffExpiresAt =
                          persistedOperation.handoffExpiresAt
                            ? new Date(persistedOperation.handoffExpiresAt)
                            : null;
                        const handoffExpired =
                          handoffExpiresAt &&
                          handoffExpiresAt.getTime() <= Date.now();
                        const targetModuleLabel = formatCoachTargetModule(
                          persistedOperation.targetModule ||
                            persistedOperation.pendingOperation?.targetModule,
                        );
                        return (
                          <article
                            key={persistedOperation.id}
                            className={`is-${statusMeta.tone}`}
                          >
                            <div>
                              <span className="mi-agent-coach-operation-status">
                                {persistedOperation.status === "completed" ? (
                                  <CheckCircle2 size={13} aria-hidden="true" />
                                ) : persistedOperation.status === "failed" ? (
                                  <AlertCircle size={13} aria-hidden="true" />
                                ) : (
                                  <Clock3 size={13} aria-hidden="true" />
                                )}
                                {statusMeta.label}
                              </span>
                              <strong>
                                {formatCoachOperationLabel(persistedOperation)}
                              </strong>
                              {persistedOperation.status === "failed" ? (
                                <small>
                                  {persistedOperation.errorDetail ||
                                    "La acción requiere revisión."}
                                </small>
                              ) : targetModuleLabel ? (
                                <small>
                                  {targetModuleLabel}
                                  {persistedOperation.handedOffAt
                                    ? ` · enviada ${formatCoachDateTime(persistedOperation.handedOffAt)}`
                                    : ""}
                                </small>
                              ) : null}
                              {persistedOperation.status === "handed_off" ? (
                                <small
                                  className={handoffExpired ? "form-error" : ""}
                                >
                                  {handoffExpired
                                    ? "El acceso al módulo venció; corrige para generar uno nuevo."
                                    : `Handoff vigente${handoffExpiresAt ? ` hasta ${formatCoachDateTime(handoffExpiresAt)}` : ""}.`}
                                </small>
                              ) : null}
                              {missingFields.length ? (
                                <div className="mi-agent-coach-missing-fields">
                                  <span>
                                    Falta completar antes de continuar:
                                  </span>
                                  <ul>
                                    {missingFields.map((field) => (
                                      <li key={field}>
                                        {formatCoachFieldLabel(field)}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ) : null}
                              {actionError ? (
                                <small className="form-error" role="alert">
                                  {actionError}
                                </small>
                              ) : null}
                            </div>
                            <div className="mi-agent-coach-pending-actions">
                              {persistedOperation.status === "collecting" ||
                              (persistedOperation.status === "handed_off" &&
                                !handoffExpired) ? (
                                <button
                                  type="button"
                                  className="btn-primary"
                                  disabled={actionPending}
                                  onClick={() =>
                                    continueCoachOperation(persistedOperation)
                                  }
                                >
                                  <ArrowRight size={14} aria-hidden="true" />
                                  {actionPending
                                    ? "Abriendo..."
                                    : persistedOperation.status === "collecting"
                                      ? "Completar datos"
                                      : `Abrir en ${targetModuleLabel || "el módulo"}`}
                                </button>
                              ) : null}
                              {["ready", "failed"].includes(
                                persistedOperation.status,
                              ) || handoffExpired ? (
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  disabled={actionPending}
                                  onClick={() =>
                                    openCoachOperationConfirmation({
                                      ...persistedOperation.pendingOperation,
                                      persistentId: persistedOperation.id,
                                    })
                                  }
                                >
                                  <Pencil size={14} aria-hidden="true" />
                                  Revisar
                                </button>
                              ) : null}
                              {[
                                "proposed",
                                "collecting",
                                "ready",
                                "handed_off",
                                "failed",
                              ].includes(persistedOperation.status) ? (
                                <button
                                  type="button"
                                  className="btn-ghost"
                                  disabled={actionPending}
                                  onClick={() =>
                                    cancelPendingCoachOperation(
                                      persistedOperation,
                                    )
                                  }
                                >
                                  <X size={14} aria-hidden="true" />
                                  Descartar
                                </button>
                              ) : null}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ) : null}
                {coachRecentOperations.length ? (
                  <details className="mi-agent-coach-recent">
                    <summary>
                      Actividad reciente
                      <span>{coachRecentOperations.length}</span>
                    </summary>
                    <div>
                      {coachRecentOperations.map((operation) => {
                        const statusMeta =
                          COACH_OPERATION_STATUS_META[operation.status] ||
                          COACH_OPERATION_STATUS_META.completed;
                        return (
                          <article key={operation.id}>
                            <span className={`is-${statusMeta.tone}`}>
                              {operation.status === "completed" ? (
                                <CheckCircle2 size={13} aria-hidden="true" />
                              ) : (
                                <Clock3 size={13} aria-hidden="true" />
                              )}
                              {statusMeta.label}
                            </span>
                            <strong>
                              {formatCoachOperationLabel(operation)}
                            </strong>
                            <small>
                              {formatCoachDateTime(
                                operation.completedAt ||
                                  operation.revertedAt ||
                                  operation.rejectedAt ||
                                  operation.cancelledAt ||
                                  operation.updatedAt,
                              ) || "Actualizada recientemente"}
                            </small>
                          </article>
                        );
                      })}
                    </div>
                  </details>
                ) : null}
                {coachMessages.length ? (
                  <div
                    ref={coachThreadRef}
                    className="mi-agent-coach-thread"
                    aria-live="polite"
                  >
                    {coachMessages.map((message) =>
                      message.role === "seller" ? (
                        <div
                          key={message.id}
                          className="mi-agent-coach-message is-seller"
                        >
                          <span>Vendedor</span>
                          <p>{message.text}</p>
                        </div>
                      ) : (
                        <div
                          key={message.id}
                          className="mi-agent-coach-message is-coach"
                        >
                          <span>Coach</span>
                          {message.pending ? (
                            <p>Analizando tu contexto comercial...</p>
                          ) : message.error ? (
                            <p>{message.error}</p>
                          ) : (
                            <>
                              <div className="mi-agent-coach-result-meta">
                                <span>
                                  {COACH_RESPONSE_TYPE_LABELS[
                                    message.result?.responseType
                                  ] || "Respuesta del Coach"}
                                </span>
                                <span>
                                  {COACH_CONFIDENCE_LABELS[
                                    message.result?.confidence
                                  ] || "Confianza media"}
                                </span>
                              </div>
                              <p className="mi-agent-coach-answer-text">
                                {message.result?.answer || "Lectura comercial"}
                              </p>
                              {message.result?.detailHandoff ? (
                                <div className="mi-agent-coach-handoff">
                                  <small>
                                    Coach mantiene el foco en tu desempeño; el
                                    detalle se revisa en el espacio
                                    especializado.
                                  </small>
                                  {message.result.detailHandoff.destination ===
                                  "customer_account" ? (
                                    <button
                                      type="button"
                                      className="mi-agent-secondary-button"
                                      onClick={() =>
                                        openCoachDetailHandoff(
                                          message.result.detailHandoff,
                                        )
                                      }
                                      disabled={
                                        askingCoach ||
                                        !canReadCustomerIntelligence
                                      }
                                    >
                                      Abrir Cliente existente
                                    </button>
                                  ) : message.result.detailHandoff
                                      .destination === "lead_management" ? (
                                    <button
                                      type="button"
                                      className="mi-agent-secondary-button"
                                      onClick={() =>
                                        openCoachDetailHandoff(
                                          message.result.detailHandoff,
                                        )
                                      }
                                      disabled={askingCoach || !canReadLeads}
                                    >
                                      Abrir gestión de leads
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}
                              <CoachQualityFeedback
                                traceId={message.result?.qualityTraceId}
                              />
                              <CoachStageReadiness
                                readiness={message.result?.stageReadiness}
                              />
                              {showCoachFoundation ? (
                                <CoachSemanticSections
                                  result={message.result}
                                />
                              ) : null}
                              {message.result?.operations
                                ?.filter(
                                  (operation) =>
                                    !operation.persistentId ||
                                    coachPendingOperations.some(
                                      (pending) =>
                                        pending.id === operation.persistentId,
                                    ),
                                )
                                .map((operation, index) => (
                                  <div
                                    className="mi-agent-coach-action"
                                    key={`${operation.kind}-${operation.opportunityId || operation.accountId || operation.contactId || operation.interactionId}-${index}`}
                                  >
                                    <strong>
                                      {operation.title || "Cambio propuesto"}
                                    </strong>
                                    <small>
                                      {formatCoachOperationSummary(operation)}
                                    </small>
                                    {(
                                      operation.kind === "activity"
                                        ? canUpdateCommercialDevelopment
                                        : operation.kind === "lead_call_outcome"
                                          ? canUpdateLeads
                                          : operation.kind === "account_field"
                                            ? canUpdateAccounts
                                            : operation.kind === "contact_field"
                                              ? canUpdateContacts
                                              : operation.kind ===
                                                  "create_account"
                                                ? canCreateAccounts
                                                : operation.kind ===
                                                    "create_contact"
                                                  ? canCreateContacts
                                                  : operation.kind ===
                                                      "lead_resolve"
                                                    ? canResolveLeads
                                                    : canCreateActions
                                    ) ? (
                                      <button
                                        type="button"
                                        className="btn-secondary"
                                        onClick={() =>
                                          openCoachOperationConfirmation(
                                            operation,
                                          )
                                        }
                                      >
                                        Revisar y confirmar
                                      </button>
                                    ) : (
                                      <small>
                                        Requiere permiso de actualización.
                                      </small>
                                    )}
                                  </div>
                                ))}
                              {message.result?.action?.title ? (
                                <div className="mi-agent-coach-action">
                                  <strong>
                                    Acción sugerida:{" "}
                                    {message.result.action.title}
                                  </strong>
                                  <small>
                                    Criterio de éxito:{" "}
                                    {message.result.action.successCriteria ||
                                      "Definir un siguiente compromiso."}
                                  </small>
                                </div>
                              ) : null}
                            </>
                          )}
                        </div>
                      ),
                    )}
                  </div>
                ) : null}
              </section>
            </>
          ) : null}

          {activeWorkspace === "summary" ? (
            !analysis ? (
              <div className="mi-agent-start-panel">
                <div className="mi-agent-start-icon">✦</div>
                <div>
                  <h3>Tu plan comercial está listo para analizarse</h3>
                  <p>
                    Mi agente revisará tu cuota, las oportunidades desde
                    Desarrollo y las señales de riesgo del proceso comercial.
                  </p>
                  <button
                    type="button"
                    className="mi-agent-primary-button"
                    onClick={analyzeSituation}
                    disabled={analyzing}
                  >
                    {analyzing ? "Analizando..." : "Analizar mi situación"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mi-agent-content-stack">
                <div className="mi-agent-main-column">
                  <section className="mi-agent-focus-panel">
                    <div className="mi-agent-section-heading">
                      <div>
                        <span className="mi-agent-section-label">
                          Lectura del agente
                        </span>
                        <h3>{analysis.headline || "Tu situación comercial"}</h3>
                      </div>
                      <span className="mi-agent-analysis-date">
                        Actualizado ahora
                      </span>
                      <button
                        type="button"
                        className="mi-agent-secondary-button"
                        onClick={analyzeSituation}
                        disabled={analyzing}
                      >
                        {analyzing ? "Actualizando..." : "Actualizar análisis"}
                      </button>
                    </div>
                    <p>{analysis.summary || analysis.quotaReadout}</p>
                  </section>

                  {analysis.activityProgress ? (
                    <section className="mi-agent-activity-progress-panel">
                      <div className="mi-agent-section-heading">
                        <div>
                          <span className="mi-agent-section-label">
                            Efectividad comercial
                          </span>
                          <h3>Actividad vs. avance</h3>
                        </div>
                        <span>Lectura del período</span>
                      </div>
                      <p className="mi-agent-activity-progress-message">
                        {analysis.activityProgress.message}
                      </p>
                      <div className="mi-agent-activity-progress-metrics">
                        <article>
                          <span>Actividades recientes</span>
                          <strong>
                            {analysis.activityProgress.activityCount}
                          </strong>
                          <small>Últimos 7 días</small>
                        </article>
                        <article>
                          <span>Oportunidades con respuesta de etapa</span>
                          <strong>
                            {analysis.activityProgress.progressedOpportunities}
                          </strong>
                          <small>Registrada en los últimos 7 días</small>
                        </article>
                        <article
                          className={
                            analysis.activityProgress
                              .opportunitiesWithoutProgress
                              ? "is-alert"
                              : ""
                          }
                        >
                          <span>Actividad sin evidencia de etapa</span>
                          <strong>
                            {
                              analysis.activityProgress
                                .opportunitiesWithoutProgress
                            }
                          </strong>
                          <small>
                            Oportunidades que requieren una interacción más
                            dirigida
                          </small>
                        </article>
                      </div>
                      {analysis.activityProgress.details?.filter(
                        (item) => item.activityWithoutProgress,
                      ).length ? (
                        <div className="mi-agent-activity-progress-list">
                          <strong>
                            Oportunidades con actividad pero sin respuesta de
                            etapa reciente
                          </strong>
                          <ul>
                            {analysis.activityProgress.details
                              .filter((item) => item.activityWithoutProgress)
                              .map((item) => (
                                <li key={item.opportunityId}>
                                  <span>
                                    {item.opportunityName} ·{" "}
                                    {item.accountName || "Sin cuenta"}
                                  </span>
                                  <small>
                                    {item.activityCount} actividades · sin
                                    respuesta de etapa posterior a la actividad
                                  </small>
                                  <button
                                    type="button"
                                    className="mi-agent-link-button"
                                    onClick={() =>
                                      navigate(
                                        `/opportunities?edit=${item.opportunityId}`,
                                      )
                                    }
                                  >
                                    Abrir oportunidad
                                  </button>
                                </li>
                              ))}
                          </ul>
                        </div>
                      ) : null}
                    </section>
                  ) : null}

                  {analysis.alerts?.length ? (
                    <section className="mi-agent-alerts-panel">
                      <div className="mi-agent-section-heading">
                        <div>
                          <span className="mi-agent-section-label">
                            Diagnóstico automático
                          </span>
                          <h3>Problemas de venta detectados</h3>
                        </div>
                        <span>{analysis.alerts.length} alertas</span>
                      </div>
                      <div className="mi-agent-alert-list">
                        {analysis.alerts.map((alert) => (
                          <article
                            key={`${alert.code}-${alert.opportunityId || alert.accountName || alert.title}`}
                            className={`mi-agent-alert-card is-${alert.severity}`}
                          >
                            <div className="mi-agent-alert-card-heading">
                              <strong>{alert.title}</strong>
                              <span>
                                {alert.severity === "critical"
                                  ? "Crítica"
                                  : alert.severity === "high"
                                    ? "Alta"
                                    : "Media"}
                              </span>
                            </div>
                            <p>
                              {alert.opportunityName
                                ? `Oportunidad: ${alert.opportunityName} · ${alert.accountName || "Sin cuenta"}`
                                : "Pipeline del vendedor"}
                            </p>
                            <p>
                              <strong>Evidencia:</strong> {alert.evidence}
                            </p>
                            <p>
                              <strong>Acción:</strong> {alert.action}
                            </p>
                            {alert.opportunityId ? (
                              <button
                                type="button"
                                className="mi-agent-link-button"
                                onClick={() =>
                                  navigate(
                                    `/opportunities?edit=${alert.opportunityId}`,
                                  )
                                }
                              >
                                Abrir oportunidad
                              </button>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  <section className="mi-agent-actions-panel">
                    <div className="mi-agent-section-heading">
                      <div>
                        <span className="mi-agent-section-label">
                          Orden recomendado
                        </span>
                        <h3>Qué hacer ahora</h3>
                      </div>
                      <span>{analysis.actions.length} acciones</span>
                    </div>
                    <div className="mi-agent-action-list">
                      {analysis.actions.length ? (
                        analysis.actions.map((action) => (
                          <div
                            key={`${action.rank}-${action.opportunityId || action.title}`}
                            className="mi-agent-action-item"
                          >
                            <button
                              type="button"
                              className={`mi-agent-action-row ${selectedAction?.rank === action.rank ? "is-selected" : ""}`}
                              onClick={() => setSelectedAction(action)}
                            >
                              <span className="mi-agent-action-rank">
                                {action.rank}
                              </span>
                              <span className="mi-agent-action-copy">
                                <strong>
                                  {action.title || "Acción comercial"}
                                </strong>
                                <small>
                                  Oportunidad #{action.opportunityId || "-"} ·{" "}
                                  {action.opportunityName || "Sin nombre"}
                                </small>
                                <small>
                                  {action.accountName || "Sin cuenta"} ·{" "}
                                  {action.stageName || "Sin etapa"}
                                </small>
                              </span>
                              <span
                                className={`mi-agent-health-badge is-${String(action.salesHealth?.label || "parcial").toLowerCase()}`}
                              >
                                {action.salesHealth
                                  ? `Salud ${action.salesHealth.label}`
                                  : "Salud"}
                              </span>
                              <span
                                className={`mi-agent-priority is-${action.priority}`}
                              >
                                {PRIORITY_LABELS[action.priority]}
                              </span>
                              <span
                                className={`mi-agent-row-state ${action.status === "done" ? "is-done" : ""}`}
                              >
                                {ACTION_STATUS_LABELS[action.status] ||
                                  "Pendiente"}
                              </span>
                            </button>
                            {action.opportunityId ? (
                              <button
                                type="button"
                                className="mi-agent-link-button"
                                onClick={() =>
                                  navigate(
                                    `/opportunities?edit=${action.opportunityId}`,
                                  )
                                }
                              >
                                Abrir oportunidad
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="mi-agent-link-button"
                                onClick={() => setActiveWorkspace("coach")}
                              >
                                Consultar con Coach
                              </button>
                            )}
                          </div>
                        ))
                      ) : (
                        <div className="mi-agent-empty">
                          No se encontraron acciones concretas en este análisis.
                        </div>
                      )}
                    </div>
                  </section>
                </div>

                <section
                  className="mi-agent-detail-panel"
                  style={{ alignSelf: "stretch", position: "static" }}
                >
                  {selectedAction ? (
                    <>
                      <div className="mi-agent-detail-heading">
                        <div>
                          <span className="mi-agent-section-label">
                            Detalle de la acción
                          </span>
                          <h3>{selectedAction.title}</h3>
                          <p>
                            Oportunidad #{selectedAction.opportunityId || "-"} ·{" "}
                            {selectedAction.opportunityName || "Sin nombre"} ·{" "}
                            {selectedAction.accountName || "Sin cuenta"}
                          </p>
                        </div>
                        <span
                          className={`mi-agent-priority is-${selectedAction.priority}`}
                        >
                          {PRIORITY_LABELS[selectedAction.priority]}
                        </span>
                      </div>
                      <div className="mi-agent-detail-facts">
                        <article>
                          <span>Por qué importa</span>
                          <p>
                            {selectedAction.reason ||
                              "Prioridad definida por el análisis del pipeline."}
                          </p>
                        </article>
                        <article>
                          <span>Riesgo</span>
                          <p>
                            {selectedAction.risk ||
                              "Sin riesgo adicional identificado."}
                          </p>
                        </article>
                        <article>
                          <span>Resultado esperado</span>
                          <p>
                            {selectedAction.expectedOutcome ||
                              "Obtener un siguiente paso verificable."}
                          </p>
                        </article>
                        <article>
                          <span>Criterio de éxito</span>
                          <p>
                            {selectedAction.successCriteria ||
                              "Registrar el resultado y el siguiente compromiso."}
                          </p>
                        </article>
                      </div>
                      {selectedAction.salesHealth ? (
                        <div className="mi-agent-health-panel">
                          <div className="mi-agent-health-heading">
                            <div>
                              <span className="mi-agent-section-label">
                                Salud de la oportunidad
                              </span>
                              <strong>
                                {selectedAction.salesHealth.label} ·{" "}
                                {selectedAction.salesHealth.solidCount}/
                                {selectedAction.salesHealth.totalCount}{" "}
                                dimensiones sólidas
                              </strong>
                            </div>
                            <span>
                              Principal debilidad:{" "}
                              {selectedAction.salesHealth.principalWeakness}
                            </span>
                          </div>
                          <div className="mi-agent-health-grid">
                            {selectedAction.salesHealth.dimensions.map(
                              (dimension) => (
                                <div
                                  key={dimension.key}
                                  className={`mi-agent-health-dimension is-${dimension.state}`}
                                >
                                  <span>{dimension.label}</span>
                                  <strong>{dimension.stateLabel}</strong>
                                  <small>{dimension.evidence}</small>
                                </div>
                              ),
                            )}
                          </div>
                        </div>
                      ) : null}
                      <div className="mi-agent-execution-kit">
                        <div className="mi-agent-execution-kit-heading">
                          <div>
                            <span className="mi-agent-section-label">
                              Preparación para ejecutar
                            </span>
                            <h4>{selectedAction.actionType || "follow_up"}</h4>
                          </div>
                          <span>Listo para usar</span>
                        </div>
                        <div className="mi-agent-kit-grid">
                          <article>
                            <span>Objetivo</span>
                            <p>
                              {selectedAction.executionKit?.objective ||
                                selectedAction.expectedOutcome ||
                                "Conseguir un compromiso verificable del cliente."}
                            </p>
                          </article>
                          <article>
                            <span>Resultado mínimo</span>
                            <p>
                              {selectedAction.executionKit?.minimumOutcome ||
                                selectedAction.successCriteria ||
                                "Definir fecha, responsable y siguiente hito."}
                            </p>
                          </article>
                          <article>
                            <span>Propuesta de valor</span>
                            <p>
                              {selectedAction.executionKit?.valueProposition ||
                                "Conectar la solución con la necesidad y el riesgo concreto del cliente."}
                            </p>
                          </article>
                          <article>
                            <span>Mensaje de seguimiento</span>
                            <p>
                              {selectedAction.executionKit?.followUpMessage ||
                                "Enviar un resumen de acuerdos con fecha y siguiente paso."}
                            </p>
                          </article>
                        </div>
                        {selectedAction.executionKit?.knownInformation
                          ?.length ? (
                          <div className="mi-agent-kit-list">
                            <strong>Información conocida</strong>
                            <ul>
                              {selectedAction.executionKit.knownInformation.map(
                                (item) => (
                                  <li key={item}>{item}</li>
                                ),
                              )}
                            </ul>
                          </div>
                        ) : null}
                        {selectedAction.executionKit?.objections?.length ? (
                          <div className="mi-agent-kit-list">
                            <strong>Objeciones probables</strong>
                            <ul>
                              {selectedAction.executionKit.objections.map(
                                (item) => (
                                  <li key={item}>{item}</li>
                                ),
                              )}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                      {selectedAction.questions?.length ? (
                        <div className="mi-agent-questions">
                          <strong>Preguntas sugeridas</strong>
                          <ul>
                            {selectedAction.questions.map((question) => (
                              <li key={question}>{question}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {selectedAction.developmentNarrative ? (
                        <div className="mi-agent-development-context">
                          <span className="mi-agent-section-label">
                            Desarrollo de la oportunidad
                          </span>
                          <span
                            className={`mi-agent-alignment-status is-${selectedAction.alignedContext?.alignment || "partially_aligned"}`}
                            style={{
                              display: "inline-block",
                              marginBottom: "8px",
                              fontSize: "12px",
                              fontWeight: 800,
                            }}
                          >
                            Alineación:{" "}
                            {selectedAction.alignedContext?.alignment ===
                            "aligned"
                              ? "Alineada"
                              : selectedAction.alignedContext?.alignment ===
                                  "not_aligned"
                                ? "Requiere revisión"
                                : "Parcial"}
                          </span>
                          <div className="mi-agent-development-block">
                            <strong>Descripción y situación actual</strong>
                            <p>
                              {selectedAction.alignedContext?.situation ||
                                selectedAction.developmentNarrative.contract
                                  ?.descriptionSituationText ||
                                selectedAction.developmentNarrative
                                  .statusSummary ||
                                "Sin información disponible."}
                            </p>
                          </div>
                          <div className="mi-agent-development-block">
                            <strong>Estrategia para lograr la venta</strong>
                            <p>
                              {selectedAction.alignedContext?.strategy ||
                                selectedAction.developmentNarrative.contract
                                  ?.salesStrategyText ||
                                "Sin información disponible."}
                            </p>
                          </div>
                          <div className="mi-agent-development-block">
                            <strong>Siguiente mejor paso</strong>
                            <p>
                              {selectedAction.alignedContext?.nextBestStep ||
                                selectedAction.developmentNarrative.contract
                                  ?.nextBestStepText ||
                                selectedAction.developmentNarrative
                                  .nextStepRecommendation ||
                                "Sin información disponible."}
                            </p>
                          </div>
                          <div className="mi-agent-development-block">
                            <strong>Paso alternativo</strong>
                            <p>
                              {selectedAction.alignedContext?.alternativeStep ||
                                selectedAction.developmentNarrative.contract
                                  ?.alternativeStepText ||
                                "Sin información disponible."}
                            </p>
                          </div>
                        </div>
                      ) : null}
                      {selectedAction.title &&
                      canExecuteCoach &&
                      canUpdateCommercialDevelopment ? (
                        <button
                          type="button"
                          className="mi-agent-primary-button is-wide"
                          onClick={() =>
                            openCoachActionConfirmation(selectedAction)
                          }
                          disabled={
                            creatingActionRank === selectedAction.rank ||
                            selectedAction.status === "done"
                          }
                        >
                          {selectedAction.status === "done"
                            ? "Próximo paso creado"
                            : "Crear próximo paso"}
                        </button>
                      ) : null}
                      {selectedAction.opportunityId &&
                      (!canExecuteCoach || !canUpdateCommercialDevelopment) ? (
                        <p className="mi-agent-permission-note">
                          Tienes acceso de lectura. Solicita permiso de
                          ejecución y Desarrollo Comercial para preparar el
                          próximo paso.
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <div className="mi-agent-empty">
                      Selecciona una acción para ver su contexto.
                    </div>
                  )}
                </section>
              </div>
            )
          ) : null}
        </>
      ) : activeWorkspace === "customer" ? (
        <section className="mi-agent-workspace-panel mi-agent-customer-workspace">
          <div className="mi-agent-section-heading">
            <div>
              <span className="mi-agent-section-label">Cliente existente</span>
              <h3>Conocimiento del cliente</h3>
            </div>
            <span>
              {customerIntelligenceJob?.status === "completed"
                ? "Investigación lista"
                : "Inteligencia interna"}
            </span>
          </div>
          <div className="mi-agent-customer-context-card">
            <label>
              Buscar cliente
              <input
                value={customerAccountSearch}
                onChange={(event) => searchCustomerAccounts(event.target.value)}
                placeholder="Nombre de cuenta"
              />
            </label>
            <label>
              Cuenta existente
              <select
                value={customerAccountId}
                onChange={(event) => selectCustomerAccount(event.target.value)}
              >
                <option value="">Selecciona una cuenta</option>
                {customerAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {customerAccountId ? (
            <section
              className="mi-agent-customer-overview"
              aria-label="Resumen de cuenta"
            >
              <div className="mi-agent-section-heading">
                <div>
                  <span className="mi-agent-section-label">Fuente CRM</span>
                  <h3>
                    {customerSnapshot?.account?.name ||
                      selectedCustomerAccount?.name ||
                      "Cuenta seleccionada"}
                  </h3>
                </div>
                <span>
                  {customerSnapshot?.account?.city ||
                  customerSnapshot?.account?.stateRegion
                    ? [
                        customerSnapshot.account.city,
                        customerSnapshot.account.stateRegion,
                      ]
                        .filter(Boolean)
                        .join(", ")
                    : "Ubicación sin registrar"}
                </span>
              </div>
              <div className="mi-agent-customer-overview-grid">
                <article>
                  <span>Última actividad registrada</span>
                  <strong>
                    {customerSnapshot?.interactions?.[0]?.updatedAt
                      ? formatDate(customerSnapshot.interactions[0].updatedAt)
                      : "Sin actividad accesible"}
                  </strong>
                  <small>
                    {customerSnapshot?.interactions?.[0]?.title ||
                      "Fuente: interacciones CRM"}
                  </small>
                </article>
                <article>
                  <span>Sitio web</span>
                  <strong>
                    {customerSnapshot?.account?.website || "Sin registrar"}
                  </strong>
                  <small>
                    {customerSnapshot?.account?.registrationCode ||
                      "Sin código de registro"}
                  </small>
                </article>
                <article>
                  <span>Relación comercial</span>
                  <strong>
                    {customerSnapshot?.accountHealth?.metrics
                      ?.opportunityCount || 0}{" "}
                    oportunidades · {customerSnapshot?.contacts?.length || 0}{" "}
                    contactos
                  </strong>
                  <small>Datos CRM autorizados</small>
                </article>
              </div>
              {customerSnapshot?.account?.description ? (
                <p className="mi-agent-customer-summary">
                  {customerSnapshot.account.description}
                </p>
              ) : null}
            </section>
          ) : (
            <div className="mi-agent-empty">
              Selecciona una cuenta para revisar salud, riesgos e historial
              comercial.
            </div>
          )}
          {customerChatFailureIds ? (
            <div className="mi-agent-customer-chat-failure-ids" role="status">
              <strong>Comparte estos identificadores con soporte:</strong>
              {customerChatFailureIds.sessionId ? (
                <span>
                  Sesión {customerChatFailureIds.sessionId}
                  <button
                    type="button"
                    className="mi-agent-secondary-button"
                    aria-label="Copiar ID de sesión"
                    onClick={() =>
                      void navigator.clipboard?.writeText(
                        String(customerChatFailureIds.sessionId),
                      )
                    }
                  >
                    Copiar
                  </button>
                </span>
              ) : null}
              {customerChatFailureIds.jobId ? (
                <span>
                  Job {customerChatFailureIds.jobId}
                  <button
                    type="button"
                    className="mi-agent-secondary-button"
                    aria-label="Copiar ID de job"
                    onClick={() =>
                      void navigator.clipboard?.writeText(
                        String(customerChatFailureIds.jobId),
                      )
                    }
                  >
                    Copiar
                  </button>
                </span>
              ) : null}
            </div>
          ) : null}
          {customerIntelligenceError ? (
            <>
              <p className="form-error">{customerIntelligenceError}</p>
              {customerChatTransportError ? (
                <details open className="mi-agent-customer-chat-debug is-error">
                  <summary>Flujo observado · solicitud fallida</summary>
                  <CustomerChatDetailedTrace
                    debug={customerChatTransportError.debug}
                    transportTrace={customerChatTransportError}
                  />
                </details>
              ) : null}
            </>
          ) : null}
          <section
            className="mi-agent-coach-panel mi-agent-customer-chat"
            aria-label="Chat de cuenta"
          >
            <div className="mi-agent-section-heading">
              <div>
                <span className="mi-agent-section-label">Chat de cuenta</span>
                <h3>Pregúntale sobre esta cuenta</h3>
              </div>
              <div className="mi-agent-customer-chat-header-actions">
                <button
                  type="button"
                  className="mi-agent-secondary-button"
                  onClick={startNewCustomerChat}
                  disabled={
                    customerChatLoading ||
                    customerChatSessionLoading ||
                    !hasCustomerContext
                  }
                >
                  Nueva conversación
                </button>
                <label className="mi-agent-coach-foundation-toggle">
                  <span>Mostrar fundamento</span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={showCustomerChatFoundation}
                    disabled={!hasCustomerChatFoundation}
                    onChange={(event) =>
                      updateCustomerChatFoundationVisibility(
                        event.target.checked,
                      )
                    }
                  />
                  <span
                    className="mi-agent-coach-foundation-toggle-track"
                    aria-hidden="true"
                  />
                </label>
              </div>
            </div>
            <div className="mi-agent-customer-chat-toolbox">
              <div className="mi-agent-customer-chat-prompts">
                <span className="mi-agent-customer-chat-toolbox-label">
                  Preguntas sugeridas
                </span>
                <div className="mi-agent-coach-suggestions">
                  <button
                    type="button"
                    onClick={() =>
                      askCustomerChat("Resume esta cuenta para mi reunión.")
                    }
                    disabled={
                      customerChatLoading ||
                      customerChatSessionLoading ||
                      !hasCustomerContext
                    }
                  >
                    Resumen para reunión
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      askCustomerChat("¿Qué riesgos debo atender?")
                    }
                    disabled={
                      customerChatLoading ||
                      customerChatSessionLoading ||
                      !hasCustomerContext
                    }
                  >
                    Riesgos
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      askCustomerChat(
                        "¿Qué oportunidades de expansión existen?",
                      )
                    }
                    disabled={customerChatLoading || !hasCustomerContext}
                  >
                    Expansión
                  </button>
                </div>
              </div>
              <label className="mi-agent-customer-public-research">
                <input
                  type="checkbox"
                  checked={customerChatPublicResearch}
                  onChange={(event) =>
                    setCustomerChatPublicResearch(event.target.checked)
                  }
                  disabled={customerChatLoading || !hasCustomerContext}
                />
                <span>Incluir fuentes públicas</span>
                <small>Requiere gobierno y permiso</small>
              </label>
            </div>
            <form
              className="mi-agent-coach-form"
              onSubmit={(event) => {
                event.preventDefault();
                askCustomerChat();
              }}
            >
              <input
                value={customerChatQuestion}
                onChange={(event) =>
                  setCustomerChatQuestion(event.target.value)
                }
                placeholder="Pregunta sobre la cuenta..."
                disabled={customerChatLoading || !hasCustomerContext}
              />
              <button
                type="submit"
                className="mi-agent-primary-button"
                disabled={
                  customerChatLoading ||
                  customerChatSessionLoading ||
                  !customerChatQuestion.trim() ||
                  !hasCustomerContext
                }
              >
                {customerChatLoading ? "Consultando..." : "Preguntar"}
              </button>
            </form>
            {customerChatMessages.length ? (
              <div className="mi-agent-coach-thread" aria-live="polite">
                {customerChatMessages.map((message, index) =>
                  message.role === "seller" ? (
                    <div
                      key={`seller-${index}`}
                      className="mi-agent-coach-message is-seller"
                    >
                      <span>Vendedor</span>
                      <p>{message.text}</p>
                    </div>
                  ) : (
                    <div
                      key={`assistant-${index}`}
                      className="mi-agent-coach-message is-coach"
                    >
                      <span>Cuenta</span>
                      <small className="mi-agent-customer-source-label">
                        {message.sourceDomain === "mixed"
                          ? "CRM + investigación pública"
                          : message.sourceDomain === "public_web"
                            ? "Investigación pública"
                            : "Fuente CRM"}
                        {message.confidence
                          ? ` · confianza ${CUSTOMER_FINDING_CONFIDENCE_LABELS[message.confidence] || message.confidence}`
                          : ""}
                      </small>
                      {String(message.answer || "").includes("\n") ? (
                        <p className="mi-agent-coach-answer-text is-multiline">
                          {message.answer}
                        </p>
                      ) : (
                        <h4
                          className={
                            message.activityHistory
                              ? "mi-agent-customer-history-summary"
                              : undefined
                          }
                        >
                          {message.answer}
                        </h4>
                      )}
                      {message.activityHistory ? (
                        message.activityHistory.mode === "contact_history" ? (
                          <div className="mi-agent-customer-history-results">
                            {!message.activityHistory.contactsAvailable ? (
                              <p className="mi-agent-customer-history-empty">
                                No tienes permiso para consultar contactos en
                                esta cuenta.
                              </p>
                            ) : (
                              message.activityHistory.contacts.map(
                                (contact) => (
                                  <section
                                    key={contact.id}
                                    className="mi-agent-customer-history-section"
                                  >
                                    <div className="mi-agent-customer-history-section-heading">
                                      <strong>{contact.name}</strong>
                                      <span>
                                        {contact.interactionHistoryAvailable
                                          ? `${contact.interactions.length} interacciones`
                                          : "Historial sin acceso"}
                                      </span>
                                    </div>
                                    <div className="mi-agent-customer-contact-history-data">
                                      {contact.positionTitle ||
                                      contact.department ? (
                                        <span>
                                          {[
                                            contact.positionTitle,
                                            contact.department,
                                          ]
                                            .filter(Boolean)
                                            .join(" · ")}
                                        </span>
                                      ) : null}
                                      {contact.email ? (
                                        <a href={`mailto:${contact.email}`}>
                                          {contact.email}
                                        </a>
                                      ) : null}
                                      {contact.phone || contact.mobile ? (
                                        <span>
                                          {[contact.phone, contact.mobile]
                                            .filter(Boolean)
                                            .join(" · ")}
                                        </span>
                                      ) : null}
                                      {contact.activationStatusCode &&
                                      contact.activationStatusCode !==
                                        "activado" ? (
                                        <span>
                                          {contact.activationStatusCode}
                                        </span>
                                      ) : null}
                                    </div>
                                    {contact.purchaseParticipation ||
                                    contact.hierarchyLevel ||
                                    contact.relationshipType ||
                                    contact.influenceLevel ? (
                                      <details className="mi-agent-customer-contact-history-extra">
                                        <summary>
                                          Más datos del contacto
                                        </summary>
                                        <p>
                                          {[
                                            contact.purchaseParticipation,
                                            contact.hierarchyLevel,
                                            contact.relationshipType,
                                            contact.influenceLevel,
                                          ]
                                            .filter(Boolean)
                                            .join(" · ")}
                                        </p>
                                      </details>
                                    ) : null}
                                    {!contact.interactionHistoryAvailable ? (
                                      <p className="mi-agent-customer-history-empty">
                                        No tienes permiso de lectura para
                                        consultar su historial.
                                      </p>
                                    ) : contact.interactions.length ? (
                                      <ul className="mi-agent-customer-history-list">
                                        {contact.interactions.map((item) => (
                                          <li key={`${contact.id}-${item.id}`}>
                                            <time dateTime={item.date}>
                                              {formatDate(item.date)}
                                            </time>
                                            <div className="mi-agent-customer-history-item-content">
                                              <strong title={item.title}>
                                                {item.title}
                                              </strong>
                                              {item.details ? (
                                                <details>
                                                  <summary>
                                                    Ver detalles
                                                  </summary>
                                                  <p>{item.details}</p>
                                                </details>
                                              ) : null}
                                            </div>
                                          </li>
                                        ))}
                                      </ul>
                                    ) : (
                                      <p className="mi-agent-customer-history-empty">
                                        Sin interacciones vinculadas.
                                      </p>
                                    )}
                                  </section>
                                ),
                              )
                            )}
                          </div>
                        ) : (
                          <div className="mi-agent-customer-history-results">
                            {message.activityHistory.mode === "quotation" ? (
                              <div className="mi-agent-customer-history-period">
                                {message.activityHistory.metadata
                                  .opportunityName ? (
                                  <span>
                                    {
                                      message.activityHistory.metadata
                                        .opportunityName
                                    }
                                  </span>
                                ) : null}
                                {message.activityHistory.metadata
                                  .quotationDate ? (
                                  <span>
                                    {formatDate(
                                      message.activityHistory.metadata
                                        .quotationDate,
                                    )}
                                  </span>
                                ) : null}
                                {message.activityHistory.metadata.statusName ? (
                                  <span>
                                    {
                                      message.activityHistory.metadata
                                        .statusName
                                    }
                                  </span>
                                ) : null}
                              </div>
                            ) : (
                              <div className="mi-agent-customer-history-period">
                                <span>
                                  {formatDate(
                                    message.activityHistory.range.startDate,
                                  )}
                                  {" - "}
                                  {formatDate(
                                    message.activityHistory.range.endDate,
                                  )}
                                </span>
                                <span>
                                  {message.activityHistory.range.months} meses
                                </span>
                              </div>
                            )}
                            {message.activityHistory.sections.map((section) => (
                              <section
                                key={section.key}
                                className="mi-agent-customer-history-section"
                              >
                                <div className="mi-agent-customer-history-section-heading">
                                  <strong>{section.title}</strong>
                                  <span>
                                    {section.available
                                      ? section.items.length
                                      : "Sin acceso"}
                                  </span>
                                </div>
                                {section.subtitle ? (
                                  <p className="mi-agent-customer-history-empty">
                                    {section.subtitle}
                                  </p>
                                ) : null}
                                {!section.available ? (
                                  <p className="mi-agent-customer-history-empty">
                                    {section.unavailableMessage}
                                  </p>
                                ) : section.items.length ? (
                                  <ul className="mi-agent-customer-history-list">
                                    {section.items.map((item) => (
                                      <li key={`${section.key}-${item.id}`}>
                                        {item.date ? (
                                          <time dateTime={item.date}>
                                            {formatDate(item.date)}
                                          </time>
                                        ) : item.activityType ? (
                                          <span className="mi-agent-customer-history-item-type">
                                            {CUSTOMER_ACTIVITY_TYPE_LABELS[
                                              item.activityType
                                            ] || item.activityType}
                                          </span>
                                        ) : null}
                                        <div className="mi-agent-customer-history-item-content">
                                          <strong title={item.title}>
                                            {item.title}
                                          </strong>
                                          <div className="mi-agent-customer-history-item-meta">
                                            {item.opportunityName ? (
                                              <span>
                                                {item.opportunityName}
                                              </span>
                                            ) : null}
                                            {item.activityType ? (
                                              <span>
                                                {CUSTOMER_ACTIVITY_TYPE_LABELS[
                                                  item.activityType
                                                ] || item.activityType}
                                              </span>
                                            ) : null}
                                            {item.status ? (
                                              <span className="mi-agent-customer-history-status">
                                                {CUSTOMER_ACTIVITY_STATUS_LABELS[
                                                  item.status
                                                ] || item.status}
                                              </span>
                                            ) : null}
                                          </div>
                                          {item.details ? (
                                            <details>
                                              <summary>Ver detalles</summary>
                                              <p>{item.details}</p>
                                            </details>
                                          ) : null}
                                        </div>
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="mi-agent-customer-history-empty">
                                    No hay registros en este periodo.
                                  </p>
                                )}
                              </section>
                            ))}
                          </div>
                        )
                      ) : null}
                      {message.debug ? (
                        <details
                          className={`mi-agent-customer-chat-debug is-${message.debug.issue?.severity || "info"}`}
                        >
                          <summary>
                            Diagnóstico ·{" "}
                            {message.debug.issue?.title || "Turno"}
                          </summary>
                          <CustomerChatDebugResult debug={message.debug} />
                          <CustomerChatDebugFlow
                            debug={message.debug}
                            transportTrace={message.transportTrace}
                          />
                          <section className="mi-agent-customer-chat-debug-continuity">
                            <div>
                              <strong>Continuidad del chat</strong>
                              <p>
                                La siguiente pregunta reutiliza la sesión
                                {message.debug.currentTurn?.chatSessionId
                                  ? ` ${message.debug.currentTurn.chatSessionId}`
                                  : " validada"}
                                ; cada turno crea un job nuevo.
                              </p>
                            </div>
                            <details className="mi-agent-customer-chat-debug-json">
                              <summary>Datos técnicos · 2</summary>
                              <details>
                                <summary>Datos del turno procesado</summary>
                                <pre>
                                  {JSON.stringify(
                                    message.debug.currentTurn ?? null,
                                    null,
                                    2,
                                  )}
                                </pre>
                              </details>
                              <details>
                                <summary>Contexto del siguiente turno</summary>
                                <pre>
                                  {JSON.stringify(
                                    message.debug.nextTurn ?? null,
                                    null,
                                    2,
                                  )}
                                </pre>
                              </details>
                            </details>
                          </section>
                        </details>
                      ) : null}
                      <CoachQualityFeedback traceId={message.qualityTraceId} />
                      {showCustomerChatFoundation &&
                      message.evidence?.length ? (
                        <div className="mi-agent-customer-chat-evidence">
                          <strong>Evidencia</strong>
                          <ul>
                            {message.evidence.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {showCustomerChatFoundation &&
                      message.inferences?.length ? (
                        <div className="mi-agent-customer-chat-inferences">
                          <strong>Hipótesis por validar</strong>
                          <ul>
                            {message.inferences.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {showCustomerChatFoundation &&
                      message.publicSources?.length ? (
                        <div className="mi-agent-customer-public-sources">
                          <strong>Fuentes públicas</strong>
                          <ul>
                            {message.publicSources.map(
                              (source, sourceIndex) => {
                                const sourceUrl =
                                  typeof source === "string"
                                    ? source
                                    : source.url || source.sourceUrl;
                                return (
                                  <li
                                    key={`${sourceUrl || "source"}-${sourceIndex}`}
                                  >
                                    {/^https?:\/\//i.test(
                                      String(sourceUrl || ""),
                                    ) ? (
                                      <a
                                        href={sourceUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        {typeof source === "object"
                                          ? source.title ||
                                            source.domain ||
                                            sourceUrl
                                          : sourceUrl}
                                      </a>
                                    ) : (
                                      String(
                                        source?.title ||
                                          source ||
                                          "Fuente pública",
                                      )
                                    )}
                                  </li>
                                );
                              },
                            )}
                          </ul>
                        </div>
                      ) : null}
                      {showCustomerChatFoundation && message.agents?.length ? (
                        <small>
                          Agentes:{" "}
                          {message.agents
                            .map((agent) => agent.agentId)
                            .join(", ")}
                        </small>
                      ) : null}
                      {message.recommendedActions?.length ? (
                        <div className="mi-agent-customer-chat-actions">
                          <strong>Próximos pasos sugeridos</strong>
                          {message.recommendedActions.map(
                            (action, actionIndex) => (
                              <article key={`${action.title}-${actionIndex}`}>
                                <span>
                                  {action.title} · requiere confirmación
                                </span>
                                {action.opportunityId &&
                                canExecuteCoach &&
                                canUpdateCommercialDevelopment ? (
                                  <button
                                    type="button"
                                    className="mi-agent-link-button"
                                    onClick={() =>
                                      openDiscoveryActivity({
                                        opportunityId: action.opportunityId,
                                        title: action.title,
                                        actionType: action.actionType || "call",
                                        notes: action.notes,
                                        successCriteria: action.successCriteria,
                                      })
                                    }
                                  >
                                    Preparar actividad
                                  </button>
                                ) : action.opportunityId ? (
                                  <button
                                    type="button"
                                    className="mi-agent-link-button"
                                    onClick={() =>
                                      navigate(
                                        `/opportunities?edit=${action.opportunityId}`,
                                      )
                                    }
                                  >
                                    Abrir oportunidad
                                  </button>
                                ) : null}
                              </article>
                            ),
                          )}
                        </div>
                      ) : null}
                      {message.operations?.some(
                        (operation) => operation.kind !== "activity",
                      ) ? (
                        <div className="mi-agent-customer-chat-actions">
                          <strong>Operaciones propuestas</strong>
                          {message.operations
                            .filter(
                              (operation) => operation.kind !== "activity",
                            )
                            .map((operation, operationIndex) => (
                              <article
                                key={`${operation.kind}-${operation.title}-${operationIndex}`}
                              >
                                <span>
                                  {operation.title || operation.kind} · requiere
                                  revisión y confirmación
                                </span>
                                {canReviewCustomerOperation(operation) ? (
                                  <button
                                    type="button"
                                    className="mi-agent-link-button"
                                    disabled={savingCoachOperation}
                                    onClick={() =>
                                      openCustomerChatOperation(operation)
                                    }
                                  >
                                    Revisar operación
                                  </button>
                                ) : (
                                  <small>
                                    No tienes permisos para proponer este tipo
                                    de cambio.
                                  </small>
                                )}
                              </article>
                            ))}
                        </div>
                      ) : null}
                    </div>
                  ),
                )}
              </div>
            ) : null}
          </section>
          {customerSnapshotLoading ? (
            <p className="field-hint">Calculando salud de la cuenta...</p>
          ) : null}
          {customerSnapshot?.accountHealth ? (
            <details
              key={`account-health-${customerAccountId}`}
              className="mi-agent-discovery-panel mi-agent-customer-collapsible"
              role="region"
              aria-label="Salud de la cuenta"
            >
              <summary className="mi-agent-customer-collapsible-summary">
                <span className="mi-agent-customer-collapsible-summary-copy">
                  <span className="mi-agent-section-label">
                    Salud de cuenta
                  </span>
                  <strong>
                    {customerSnapshot.accountHealth.status === "at_risk"
                      ? "Requiere atención"
                      : customerSnapshot.accountHealth.status === "attention"
                        ? "Atención recomendada"
                        : customerSnapshot.accountHealth.status === "healthy"
                          ? "Salud estable"
                          : "Información insuficiente"}
                  </strong>
                </span>
                <strong>{customerSnapshot.accountHealth.score}/100</strong>
              </summary>
              <div className="mi-agent-customer-collapsible-content">
                <div className="mi-agent-intelligence-summary">
                  <article>
                    <span>Contactos</span>
                    <strong>
                      {customerSnapshot.accountHealth.metrics.contactCount}
                    </strong>
                  </article>
                  <article>
                    <span>Oportunidades</span>
                    <strong>
                      {customerSnapshot.accountHealth.metrics.opportunityCount}
                    </strong>
                  </article>
                  <article>
                    <span>En riesgo</span>
                    <strong>
                      {
                        customerSnapshot.accountHealth.metrics
                          .riskyOpportunityCount
                      }
                    </strong>
                  </article>
                  <article>
                    <span>Última actividad</span>
                    <strong>
                      {customerSnapshot.accountHealth.metrics
                        .daysSinceLastInteraction === null
                        ? "Sin datos"
                        : `${customerSnapshot.accountHealth.metrics.daysSinceLastInteraction} días`}
                    </strong>
                  </article>
                </div>
                {customerSnapshot.accountHealth.signals.length ? (
                  <div className="mi-agent-finding-list">
                    {customerSnapshot.accountHealth.signals.map((signal) => (
                      <article
                        key={`${signal.code}-${signal.entityId || "account"}`}
                        className={`mi-agent-finding-card is-${signal.severity === "high" ? "rejected" : "suggested"}`}
                      >
                        <div className="mi-agent-finding-heading">
                          <div>
                            <span>
                              {signal.severity === "high" ? "Riesgo" : "Señal"}
                            </span>
                            <strong>{signal.title}</strong>
                          </div>
                          <em>{signal.severity}</em>
                        </div>
                        <small className="mi-agent-customer-source-label">
                          Fuente CRM · señal determinística
                        </small>
                        <p>{signal.summary}</p>
                        <blockquote>{signal.evidence}</blockquote>
                        <div className="mi-agent-customer-signal-actions">
                          {signal.entityType === "opportunity" &&
                          signal.entityId ? (
                            <button
                              type="button"
                              className="mi-agent-link-button"
                              onClick={() =>
                                navigate(
                                  `/opportunities?edit=${signal.entityId}`,
                                )
                              }
                            >
                              Abrir oportunidad
                            </button>
                          ) : null}
                          {!signal.entityId &&
                          customerSnapshot.opportunities?.some(
                            (opportunity) =>
                              !["ganada", "perdida", "anulada"].includes(
                                opportunity.commercialStatusCode,
                              ),
                          ) &&
                          canUpdateCommercialDevelopment ? (
                            <button
                              type="button"
                              className="mi-agent-link-button"
                              onClick={() => {
                                const opportunity =
                                  customerSnapshot.opportunities.find(
                                    (item) =>
                                      ![
                                        "ganada",
                                        "perdida",
                                        "anulada",
                                      ].includes(item.commercialStatusCode),
                                  );
                                openDiscoveryActivity({
                                  opportunityId: opportunity.id,
                                  title: signal.title,
                                  actionType: "call",
                                  priority:
                                    signal.severity === "high"
                                      ? "high"
                                      : "medium",
                                  notes: signal.evidence,
                                  successCriteria:
                                    "Validar la señal de salud con el cliente y registrar el siguiente compromiso.",
                                });
                              }}
                            >
                              Preparar seguimiento
                            </button>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="mi-agent-empty">
                    No se detectaron señales determinísticas de atención.
                  </div>
                )}
              </div>
            </details>
          ) : null}
          {customerSnapshot?.accountHealth?.signals?.length ? (
            <details
              key={`next-step-${customerAccountId}`}
              className="mi-agent-customer-next-step mi-agent-customer-collapsible"
              role="region"
              aria-label="Próximo paso sugerido"
            >
              <summary className="mi-agent-customer-collapsible-summary">
                <span className="mi-agent-customer-collapsible-summary-copy">
                  <span className="mi-agent-section-label">
                    Sugerencia basada en señales CRM
                  </span>
                  <strong>Próximo paso sugerido</strong>
                  <span className="mi-agent-customer-collapsible-summary-detail">
                    {customerSnapshot.accountHealth.signals[0].title}
                  </span>
                </span>
              </summary>
              <div className="mi-agent-customer-collapsible-content">
                <div>
                  <p>{customerSnapshot.accountHealth.signals[0].summary}</p>
                  <small>
                    Evidencia:{" "}
                    {customerSnapshot.accountHealth.signals[0].evidence}
                  </small>
                </div>
                {customerSnapshot.accountHealth.signals[0].entityType ===
                  "opportunity" &&
                customerSnapshot.accountHealth.signals[0].entityId ? (
                  <button
                    type="button"
                    className="mi-agent-secondary-button"
                    onClick={() =>
                      navigate(
                        `/opportunities?edit=${customerSnapshot.accountHealth.signals[0].entityId}`,
                      )
                    }
                  >
                    Abrir oportunidad
                  </button>
                ) : canExecuteCoach && canUpdateCommercialDevelopment ? (
                  customerSnapshot.opportunities?.some((opportunity) =>
                    ["open", undefined].includes(opportunity.lifecycle),
                  ) ? (
                    <button
                      type="button"
                      className="mi-agent-primary-button"
                      onClick={() => {
                        const opportunity = customerSnapshot.opportunities.find(
                          (item) =>
                            ["open", undefined].includes(item.lifecycle),
                        );
                        openDiscoveryActivity({
                          opportunityId: opportunity.id,
                          title:
                            customerSnapshot.accountHealth.signals[0].title,
                          actionType: "call",
                          priority:
                            customerSnapshot.accountHealth.signals[0]
                              .severity === "high"
                              ? "high"
                              : "medium",
                          notes:
                            customerSnapshot.accountHealth.signals[0].evidence,
                          successCriteria:
                            "Validar la señal con el cliente y registrar un siguiente compromiso.",
                        });
                      }}
                    >
                      Preparar seguimiento
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="mi-agent-secondary-button"
                      onClick={() =>
                        askCustomerChat(
                          `¿Cuál es el siguiente paso para atender: ${customerSnapshot.accountHealth.signals[0].title}?`,
                        )
                      }
                      disabled={customerChatLoading}
                    >
                      Consultar siguiente paso
                    </button>
                  )
                ) : (
                  <button
                    type="button"
                    className="mi-agent-secondary-button"
                    onClick={() =>
                      askCustomerChat(
                        `¿Cuál es el siguiente paso para atender: ${customerSnapshot.accountHealth.signals[0].title}?`,
                      )
                    }
                    disabled={customerChatLoading}
                  >
                    Consultar siguiente paso
                  </button>
                )}
              </div>
            </details>
          ) : null}
          {customerSnapshot ? (
            <details
              key={`history-${customerAccountId}`}
              className="mi-agent-customer-history mi-agent-customer-collapsible"
              role="region"
              aria-label="Historial comercial de la cuenta"
            >
              <summary className="mi-agent-customer-collapsible-summary">
                <span className="mi-agent-customer-collapsible-summary-copy">
                  <span className="mi-agent-section-label">Fuente CRM</span>
                  <strong>Historial comercial</strong>
                </span>
                <span>
                  {(customerSnapshot.opportunities?.length || 0) +
                    (customerSnapshot.inactiveOpportunities?.length || 0)}{" "}
                  oportunidades
                </span>
              </summary>
              <div className="mi-agent-customer-collapsible-content">
                <div className="mi-agent-customer-history-grid">
                  {[
                    ["open", "Abiertas"],
                    ["ganada", "Ganadas"],
                    ["perdida", "Perdidas"],
                    ["anulada", "Anuladas"],
                  ].map(([statusCode, label]) => {
                    const opportunities = (
                      customerSnapshot.opportunities || []
                    ).filter((opportunity) =>
                      statusCode === "open"
                        ? !["ganada", "perdida", "anulada"].includes(
                            opportunity.commercialStatusCode,
                          )
                        : opportunity.commercialStatusCode === statusCode,
                    );
                    return (
                      <div key={statusCode}>
                        <strong>
                          {label} <span>{opportunities.length}</span>
                        </strong>
                        {opportunities.length ? (
                          <ul>
                            {opportunities.map((opportunity) => (
                              <li key={opportunity.id}>
                                <button
                                  type="button"
                                  className="mi-agent-customer-record-link"
                                  onClick={() =>
                                    navigate(
                                      `/opportunities?edit=${opportunity.id}`,
                                    )
                                  }
                                >
                                  {opportunity.name}
                                </button>
                                <small>
                                  {opportunity.stageName || "Sin etapa"} ·{" "}
                                  {formatCurrency(opportunity.amountUsd, "USD")}
                                  {opportunity.closeDate
                                    ? ` · cierre ${formatDate(opportunity.closeDate)}`
                                    : ""}
                                </small>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <small>Sin registros accesibles</small>
                        )}
                      </div>
                    );
                  })}
                  <div>
                    <strong>
                      Desactivadas{" "}
                      <span>
                        {customerSnapshot.inactiveOpportunities?.length || 0}
                      </span>
                    </strong>
                    {customerSnapshot.inactiveOpportunities?.length ? (
                      <ul>
                        {customerSnapshot.inactiveOpportunities.map(
                          (opportunity) => (
                            <li key={opportunity.id}>
                              <button
                                type="button"
                                className="mi-agent-customer-record-link"
                                onClick={() =>
                                  navigate(
                                    `/opportunities?edit=${opportunity.id}`,
                                  )
                                }
                              >
                                {opportunity.name}
                              </button>
                              <small>
                                {opportunity.activationStatusCode ||
                                  "No activada"}{" "}
                                ·{" "}
                                {opportunity.commercialStatusCode ||
                                  "en proceso"}{" "}
                                · {opportunity.stageName || "Sin etapa"} ·{" "}
                                {formatCurrency(opportunity.amountUsd, "USD")}
                              </small>
                            </li>
                          ),
                        )}
                      </ul>
                    ) : (
                      <small>Sin registros accesibles</small>
                    )}
                  </div>
                </div>
              </div>
            </details>
          ) : null}
          {customerSnapshot?.permissions?.canReadContacts ? (
            <details
              key={`contacts-${customerAccountId}`}
              className="mi-agent-customer-contacts mi-agent-customer-collapsible"
              role="region"
              aria-label="Mapa de relaciones de la cuenta"
            >
              <summary className="mi-agent-customer-collapsible-summary">
                <span className="mi-agent-customer-collapsible-summary-copy">
                  <span className="mi-agent-section-label">Fuente CRM</span>
                  <strong>Contactos y mapa de relación</strong>
                </span>
                <span>{customerSnapshot.contacts?.length || 0} contactos</span>
              </summary>
              <div className="mi-agent-customer-collapsible-content">
                {customerSnapshot.contacts?.length ? (
                  <div className="mi-agent-customer-contact-grid">
                    {customerSnapshot.contacts.map((contact) => {
                      const missing = [
                        !contact.positionTitle && "cargo",
                        !contact.purchaseParticipation &&
                          "participación de compra",
                        !contact.hierarchyLevel && "nivel jerárquico",
                        !contact.influenceLevel && "nivel de influencia",
                        !contact.managerContactId &&
                          !contact.influencesContactId &&
                          "relación con otros contactos",
                      ].filter(Boolean);
                      return (
                        <article key={contact.id}>
                          <strong>
                            {contact.name || "Contacto sin nombre"}
                          </strong>
                          <span>
                            {contact.positionTitle || "Cargo sin registrar"}
                            {contact.department
                              ? ` · ${contact.department}`
                              : ""}
                          </span>
                          <small>
                            Participación:{" "}
                            {contact.purchaseParticipation || "Sin dato"}
                          </small>
                          <small>
                            Jerarquía: {contact.hierarchyLevel || "Sin dato"} ·{" "}
                            Influencia: {contact.influenceLevel || "Sin dato"}
                          </small>
                          <small>
                            Relación: {contact.relationshipType || "Sin dato"}
                            {contact.managerName
                              ? ` · Reporta a ${contact.managerName}`
                              : ""}
                            {contact.influencesName
                              ? ` · Influye en ${contact.influencesName}`
                              : ""}
                          </small>
                          {missing.length ? (
                            <small className="mi-agent-customer-map-gap">
                              Falta: {missing.join(", ")}
                            </small>
                          ) : null}
                          {canUpdateContacts ? (
                            <button
                              type="button"
                              className="mi-agent-customer-record-link"
                              onClick={() => {
                                const params = new URLSearchParams();
                                params.set(
                                  "accountId",
                                  String(customerAccountId),
                                );
                                params.set("contactId", String(contact.id));
                                params.set("edit", String(contact.id));
                                navigate(
                                  `/contact-mapping?${params.toString()}`,
                                );
                              }}
                            >
                              Editar en Mapeo de contactos
                            </button>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mi-agent-empty">
                    No hay contactos activos accesibles para esta cuenta.
                  </div>
                )}
              </div>
            </details>
          ) : null}
          {customerSnapshot &&
          (customerSnapshot.products?.length ||
            customerSnapshot.renewals?.length) ? (
            <details
              key={`quotations-${customerAccountId}`}
              className="mi-agent-discovery-panel mi-agent-customer-collapsible"
              role="region"
              aria-label="Productos y renovaciones"
            >
              <summary className="mi-agent-customer-collapsible-summary">
                <span className="mi-agent-customer-collapsible-summary-copy">
                  <span className="mi-agent-section-label">Fuente CRM</span>
                  <strong>Cotizaciones, productos y renovaciones</strong>
                </span>
                <span>
                  {
                    groupCustomerProductsByQuotation(customerSnapshot.products)
                      .length
                  }{" "}
                  {groupCustomerProductsByQuotation(customerSnapshot.products)
                    .length === 1
                    ? "cotización"
                    : "cotizaciones"}{" "}
                  · {customerSnapshot.products?.length || 0}{" "}
                  {(customerSnapshot.products?.length || 0) === 1
                    ? "producto"
                    : "productos"}{" "}
                  · {customerSnapshot.renewals?.length || 0}{" "}
                  {(customerSnapshot.renewals?.length || 0) === 1
                    ? "renovación"
                    : "renovaciones"}
                </span>
              </summary>
              <div className="mi-agent-customer-collapsible-content">
                {customerSnapshot.products?.length ? (
                  <div className="mi-agent-customer-quotation-list">
                    <p className="mi-agent-customer-evidence-note">
                      Una cotización aceptada o ganada no confirma por sí sola
                      compra, facturación ni entrega.
                    </p>
                    {groupCustomerProductsByQuotation(
                      customerSnapshot.products,
                    ).map((quotation) => (
                      <details
                        key={quotation.quotationId}
                        className={`mi-agent-customer-quotation is-${getQuotationStatusTone({ uiKey: quotation.commercialStatus, code: quotation.commercialStatus })}`}
                        role="group"
                        aria-label={`Cotización ${quotation.quotationId}`}
                      >
                        <summary className="mi-agent-customer-collapsible-summary">
                          <span className="mi-agent-customer-collapsible-summary-copy">
                            <strong>Cotización {quotation.quotationId}</strong>
                            <span className="mi-agent-customer-collapsible-summary-detail">
                              {CUSTOMER_QUOTATION_STATUS_LABELS[
                                quotation.commercialStatus
                              ] || quotation.commercialStatus}
                            </span>
                          </span>
                          <span>{quotation.products.length} productos</span>
                        </summary>
                        {quotation.products[0]?.opportunityId ? (
                          <button
                            type="button"
                            className="mi-agent-customer-record-link mi-agent-customer-quotation-opportunity"
                            onClick={() =>
                              navigate(
                                `/opportunities?edit=${quotation.products[0].opportunityId}`,
                              )
                            }
                          >
                            Abrir oportunidad asociada
                          </button>
                        ) : null}
                        <ul className="mi-agent-customer-quotation-products">
                          {quotation.products.map((product, productIndex) => (
                            <li
                              key={`${product.quotationVersionId}-${product.productCode}-${product.description}-${productIndex}`}
                            >
                              <strong>{product.description}</strong>
                              <span>
                                {product.itemType || "producto"} ·{" "}
                                {product.quantity} unidad(es)
                                {product.isRenewal
                                  ? " · renovación cotizada"
                                  : ""}
                              </span>
                              <small>
                                Compra/entrega: no verificada
                                {product.providerName
                                  ? ` · ${product.providerName}`
                                  : ""}
                              </small>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ))}
                  </div>
                ) : null}
                {customerSnapshot.renewals?.length ? (
                  <div className="mi-agent-discovery-columns">
                    <div>
                      <strong>Renovaciones</strong>
                      <ul>
                        {customerSnapshot.renewals
                          .slice(0, 10)
                          .map((renewal) => (
                            <li key={renewal.id}>
                              <span>
                                {renewal.providerName} · {renewal.statusCode} ·
                                vence {renewal.expiresAt || "sin fecha"}
                              </span>
                              <button
                                type="button"
                                className="mi-agent-customer-record-link"
                                onClick={() =>
                                  navigate(
                                    `/opportunities?edit=${renewal.opportunityId}`,
                                  )
                                }
                              >
                                Abrir oportunidad asociada
                              </button>
                            </li>
                          ))}
                      </ul>
                    </div>
                  </div>
                ) : null}
              </div>
            </details>
          ) : null}
          {customerSnapshot?.expansionHypotheses?.length ? (
            <details
              key={`expansion-hypotheses-${customerAccountId}`}
              className="mi-agent-discovery-panel mi-agent-customer-collapsible"
              role="region"
              aria-label="Hipótesis de expansión"
            >
              <summary className="mi-agent-customer-collapsible-summary">
                <span className="mi-agent-customer-collapsible-summary-copy">
                  <span className="mi-agent-section-label">
                    Desarrollo comercial
                  </span>
                  <strong>Hipótesis de expansión</strong>
                </span>
                <span>
                  {customerSnapshot.expansionHypotheses.length} hipótesis
                </span>
              </summary>
              <div className="mi-agent-customer-collapsible-content">
                <div className="mi-agent-discovery-next-steps">
                  {customerSnapshot.expansionHypotheses.map((hypothesis) => (
                    <article key={`${hypothesis.type}-${hypothesis.title}`}>
                      <div>
                        <span>Hipótesis · {hypothesis.type}</span>
                        <strong>{hypothesis.title}</strong>
                        <p>
                          {hypothesis.summary} {hypothesis.evidence}
                        </p>
                        <small>
                          Confianza:{" "}
                          {CUSTOMER_FINDING_CONFIDENCE_LABELS[
                            hypothesis.confidence
                          ] ||
                            hypothesis.confidence ||
                            "Baja"}{" "}
                          · requiere validación del vendedor
                        </small>
                      </div>
                      {hypothesis.opportunityId &&
                      canExecuteCoach &&
                      canUpdateCommercialDevelopment &&
                      customerSnapshot.opportunities.some(
                        (opportunity) =>
                          Number(opportunity.id) ===
                            Number(hypothesis.opportunityId) &&
                          opportunity.lifecycle === "open",
                      ) ? (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() =>
                            openDiscoveryActivity({
                              opportunityId: hypothesis.opportunityId,
                              title: hypothesis.title,
                              actionType: "call",
                              priority: "medium",
                              notes: hypothesis.evidence,
                              successCriteria:
                                "Validar la hipótesis con el cliente antes de crear o ampliar la oportunidad.",
                            })
                          }
                        >
                          Revisar hipótesis
                        </button>
                      ) : hypothesis.opportunityId ? (
                        <button
                          type="button"
                          className="mi-agent-link-button"
                          onClick={() =>
                            navigate(
                              `/opportunities?edit=${hypothesis.opportunityId}`,
                            )
                          }
                        >
                          Abrir oportunidad
                        </button>
                      ) : null}
                    </article>
                  ))}
                </div>
              </div>
            </details>
          ) : null}
          <div className="mi-agent-customer-actions mi-agent-customer-operation-list">
            <section
              className="mi-agent-customer-operation"
              aria-label="Analizar cuenta"
            >
              <header className="mi-agent-customer-operation-heading is-result-heading">
                <button
                  type="button"
                  className="mi-agent-primary-button"
                  onClick={runCustomerInvestigation}
                  disabled={customerInvestigating || !hasCustomerContext}
                >
                  {customerInvestigating ? "Analizando..." : "Analizar cuenta"}
                </button>
                <div className="mi-agent-customer-analysis-intro">
                  <div className="mi-agent-customer-analysis-title">
                    <strong>Resultado del análisis</strong>
                    <span
                      className={`mi-agent-customer-action-result-status ${getCustomerActionStatusClass(getCustomerActionStatus({ loading: customerInvestigating, error: customerActionErrors.analysis, job: customerIntelligenceJob }))}`}
                    >
                      {getCustomerActionStatus({
                        loading: customerInvestigating,
                        error: customerActionErrors.analysis,
                        job: customerIntelligenceJob,
                      })}
                    </span>
                  </div>
                  <p
                    ref={customerIntelligenceResultRef}
                    className="mi-agent-customer-analysis-summary"
                  >
                    {customerIntelligenceJob?.result?.summary ||
                      (customerInvestigating
                        ? "Analizando información interna..."
                        : "El análisis interno aún no se ha ejecutado.")}
                  </p>
                  {customerActionErrors.analysis ? (
                    <p className="form-error">
                      {customerActionErrors.analysis}
                    </p>
                  ) : null}
                </div>
              </header>
              <CustomerActionResult
                label="Hallazgos y métricas"
                className="is-result-wide"
                showStatus={false}
                status={getCustomerActionStatus({
                  loading: customerInvestigating,
                  error: customerActionErrors.analysis,
                  job: customerIntelligenceJob,
                })}
                preview={
                  customerFindings.length
                    ? `${customerFindings.length} hallazgos · ${customerFindings.filter((finding) => finding.category === "missing_information").length} huecos`
                    : customerIntelligenceJob?.status === "completed"
                      ? "No se generaron hallazgos."
                      : "Los hallazgos aparecerán aquí al analizar la cuenta."
                }
                open={openCustomerAction === "analysis"}
                onToggle={(isOpen) =>
                  setCustomerActionResultOpen("analysis", isOpen)
                }
              >
                {customerIntelligenceJob ? (
                  <div className="mi-agent-intelligence-summary">
                    <article>
                      <span>Estado</span>
                      <strong>
                        {customerIntelligenceJob.status === "completed"
                          ? "Completado"
                          : customerIntelligenceJob.status === "failed"
                            ? "Fallido"
                            : "En proceso"}
                      </strong>
                    </article>
                    <article>
                      <span>Hallazgos</span>
                      <strong>{customerFindings.length}</strong>
                    </article>
                    <article>
                      <span>Huecos</span>
                      <strong>
                        {
                          customerFindings.filter(
                            (finding) =>
                              finding.category === "missing_information",
                          ).length
                        }
                      </strong>
                    </article>
                    <article>
                      <span>Confirmados</span>
                      <strong>
                        {
                          customerFindings.filter(
                            (finding) => finding.status === "confirmed",
                          ).length
                        }
                      </strong>
                    </article>
                  </div>
                ) : null}
                {customerInvestigating ? (
                  <p className="field-hint">
                    Analizando la información interna...
                  </p>
                ) : null}
                {customerFindings.length ? (
                  <div className="mi-agent-finding-list">
                    {customerFindings.map((finding) => (
                      <article
                        key={finding.id}
                        className={`mi-agent-finding-card is-${finding.status}`}
                      >
                        <div className="mi-agent-finding-heading">
                          <div>
                            <span>
                              {CUSTOMER_FINDING_CATEGORY_LABELS[
                                finding.category
                              ] || finding.category}
                            </span>
                            <strong>{finding.title}</strong>
                          </div>
                          <em>
                            {CUSTOMER_FINDING_STATUS_LABELS[finding.status] ||
                              finding.status}
                          </em>
                        </div>
                        <p>{finding.summary}</p>
                        {finding.evidenceText ? (
                          <blockquote>{finding.evidenceText}</blockquote>
                        ) : null}
                        <div className="mi-agent-finding-meta">
                          <span>
                            Fuente:{" "}
                            {finding.sourceDomain === "public_web"
                              ? "Investigación pública"
                              : finding.certainty === "inferred"
                                ? "Inferencia"
                                : "CRM"}
                          </span>
                          <span>
                            Confianza:{" "}
                            {CUSTOMER_FINDING_CONFIDENCE_LABELS[
                              finding.confidence
                            ] || finding.confidence}
                          </span>
                          <span>Certeza: {finding.certainty}</span>
                          <span>
                            Fuente:{" "}
                            {finding.sourceReference || finding.sourceType}
                          </span>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : customerIntelligenceJob?.status === "completed" ? (
                  <div className="mi-agent-empty">
                    No se generaron hallazgos para este contexto.
                  </div>
                ) : !customerIntelligenceJob && !customerInvestigating ? (
                  <p className="field-hint">
                    Ejecuta el análisis para revisar el resumen y los hallazgos
                    internos de la cuenta.
                  </p>
                ) : null}
              </CustomerActionResult>
            </section>
            <section
              className="mi-agent-customer-operation"
              aria-label="Enriquecer con fuentes públicas"
            >
              <header className="mi-agent-customer-operation-heading is-result-heading">
                <button
                  type="button"
                  className="mi-agent-secondary-button"
                  onClick={runCustomerAgents}
                  disabled={
                    customerAgentsLoading ||
                    !hasCustomerContext ||
                    !canUseExternalSources
                  }
                >
                  {customerAgentsLoading
                    ? "Enriqueciendo..."
                    : "Enriquecer con fuentes públicas"}
                </button>
                <div className="mi-agent-customer-analysis-intro">
                  <div className="mi-agent-customer-analysis-title">
                    <strong>Resultado del enriquecimiento</strong>
                    <span
                      className={`mi-agent-customer-action-result-status ${getCustomerActionStatusClass(getCustomerActionStatus({ loading: customerAgentsLoading, error: customerActionErrors.agents, job: customerAgentsJob }))}`}
                    >
                      {getCustomerActionStatus({
                        loading: customerAgentsLoading,
                        error: customerActionErrors.agents,
                        job: customerAgentsJob,
                      })}
                    </span>
                  </div>
                  <p className="mi-agent-customer-analysis-summary">
                    {customerAgentsJob?.result?.agents?.length
                      ? summarizeCustomerAgents(customerAgentsJob.result.agents)
                      : customerAgentsLoading
                        ? "Consultando CRM y fuentes públicas..."
                        : "Los resultados aparecerán aquí al enriquecer la cuenta."}
                  </p>
                </div>
              </header>
              <CustomerActionResult
                label="Detalle de agentes"
                className="is-result-wide"
                showStatus={false}
                status={getCustomerActionStatus({
                  loading: customerAgentsLoading,
                  error: customerActionErrors.agents,
                  job: customerAgentsJob,
                })}
                preview={
                  customerAgentsJob?.result?.agents?.length
                    ? summarizeCustomerAgents(customerAgentsJob.result.agents)
                    : customerAgentsLoading
                      ? "Consultando CRM y fuentes públicas..."
                      : "Los resultados aparecerán aquí al enriquecer la cuenta."
                }
                open={openCustomerAction === "agents"}
                onToggle={(isOpen) =>
                  setCustomerActionResultOpen("agents", isOpen)
                }
              >
                {customerActionErrors.agents ? (
                  <p className="form-error">{customerActionErrors.agents}</p>
                ) : customerAgentsJob?.result?.agents?.length ? (
                  <section
                    className="mi-agent-specialized-agents"
                    aria-label="Agentes especializados"
                  >
                    <div className="mi-agent-section-heading">
                      <div>
                        <span className="mi-agent-section-label">
                          {customerAgentsJob.result.sourceDomain ===
                          "public_web"
                            ? "Fuentes CRM y públicas"
                            : "Análisis interno CRM"}
                        </span>
                        <h3>Agentes especializados</h3>
                      </div>
                      <span className="mi-agent-agent-safety-note">
                        Sin escrituras automáticas
                      </span>
                    </div>
                    <div className="mi-agent-specialized-agent-grid">
                      {customerAgentsJob.result.agents.map((agent) => (
                        <article
                          className="mi-agent-specialized-agent"
                          key={agent.agentId}
                        >
                          <header className="mi-agent-specialized-agent-heading">
                            <strong>
                              {CUSTOMER_AGENT_LABELS[agent.agentId] ||
                                agent.agentId}
                            </strong>
                            <span
                              className={`mi-agent-agent-status is-${agent.status || "completed"}`}
                            >
                              {CUSTOMER_AGENT_STATUS_LABELS[agent.status] ||
                                agent.status}
                            </span>
                          </header>
                          <p className="mi-agent-specialized-agent-summary">
                            {agent.summary}
                          </p>
                          <div className="mi-agent-agent-meta">
                            <span>
                              {agent.sourceDomain === "public_web"
                                ? "Fuente pública"
                                : "Fuente CRM"}
                            </span>
                            <span>{agent.findings?.length || 0} hallazgos</span>
                            <span>
                              Confianza{" "}
                              {CUSTOMER_FINDING_CONFIDENCE_LABELS[
                                agent.confidence
                              ] || agent.confidence}
                            </span>
                          </div>
                          {agent.findings?.length ? (
                            <ul className="mi-agent-specialized-findings">
                              {agent.findings.slice(0, 10).map((finding) => {
                                const contact =
                                  agent.agentId === "contact_research"
                                    ? finding.metadata?.contactData
                                    : null;
                                return (
                                  <li key={`${agent.agentId}-${finding.title}`}>
                                    <strong className="mi-agent-specialized-finding-title">
                                      {contact?.firstName && contact?.lastName
                                        ? `${contact.firstName} ${contact.lastName}`
                                        : finding.title}
                                    </strong>
                                    {contact?.positionTitle ? (
                                      <span className="mi-agent-specialized-finding-role">
                                        {contact.positionTitle}
                                        {contact.department
                                          ? ` · ${contact.department}`
                                          : ""}
                                      </span>
                                    ) : null}
                                    {isUsablePublicContactValue(
                                      contact?.email,
                                    ) ? (
                                      <span>Correo: {contact.email}</span>
                                    ) : null}
                                    {isUsablePublicContactValue(
                                      contact?.phone,
                                    ) ? (
                                      <span>Teléfono: {contact.phone}</span>
                                    ) : null}
                                    {isUsablePublicContactValue(
                                      contact?.mobile,
                                    ) ? (
                                      <span>Móvil: {contact.mobile}</span>
                                    ) : null}
                                    {finding.summary ? (
                                      <p className="mi-agent-specialized-finding-summary">
                                        {finding.summary}
                                      </p>
                                    ) : null}
                                    <div className="mi-agent-specialized-finding-meta">
                                      <span>
                                        Certeza:{" "}
                                        {finding.certainty || "evidenciada"}
                                      </span>
                                      <span>
                                        Confianza{" "}
                                        {CUSTOMER_FINDING_CONFIDENCE_LABELS[
                                          finding.confidence
                                        ] ||
                                          finding.confidence ||
                                          CUSTOMER_FINDING_CONFIDENCE_LABELS[
                                            agent.confidence
                                          ] ||
                                          agent.confidence}
                                      </span>
                                    </div>
                                    {finding.evidenceText ||
                                    finding.evidence ? (
                                      <details className="mi-agent-specialized-evidence">
                                        <summary>Ver evidencia</summary>
                                        <p>
                                          {finding.evidenceText ||
                                            finding.evidence}
                                        </p>
                                      </details>
                                    ) : null}
                                    {/^https?:\/\//i.test(
                                      String(finding.sourceUrl || ""),
                                    ) ? (
                                      <a
                                        href={finding.sourceUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        Ver fuente pública
                                      </a>
                                    ) : null}
                                  </li>
                                );
                              })}
                            </ul>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  </section>
                ) : (
                  <p className="field-hint">
                    {customerAgentsLoading
                      ? "Consultando CRM y fuentes públicas..."
                      : "Ejecuta el enriquecimiento para consultar agentes internos y fuentes públicas."}
                  </p>
                )}
              </CustomerActionResult>
            </section>
            <section
              className="mi-agent-customer-operation"
              aria-label="Preparar resumen ejecutivo"
            >
              <header className="mi-agent-customer-operation-heading is-result-heading">
                <button
                  type="button"
                  className="mi-agent-secondary-button"
                  onClick={prepareCustomerExecutiveBriefing}
                  disabled={
                    customerExecutiveBriefingLoading || !hasCustomerContext
                  }
                >
                  {customerExecutiveBriefingLoading
                    ? "Preparando resumen..."
                    : "Preparar resumen ejecutivo"}
                </button>
                <div className="mi-agent-customer-analysis-intro">
                  <div className="mi-agent-customer-analysis-title">
                    <strong>Resumen ejecutivo</strong>
                    <span
                      className={`mi-agent-customer-action-result-status ${getCustomerActionStatusClass(getCustomerActionStatus({ loading: customerExecutiveBriefingLoading, error: customerActionErrors.briefing, job: customerExecutiveBriefingJob }))}`}
                    >
                      {getCustomerActionStatus({
                        loading: customerExecutiveBriefingLoading,
                        error: customerActionErrors.briefing,
                        job: customerExecutiveBriefingJob,
                      })}
                    </span>
                  </div>
                  <p className="mi-agent-customer-analysis-summary">
                    {customerExecutiveBriefingJob?.result?.executiveBriefing
                      ? `Salud ${customerExecutiveBriefingJob.result.executiveBriefing.healthScore}/100 · ${customerExecutiveBriefingJob.result.executiveBriefing.prioritizedRisks?.length || 0} riesgos`
                      : customerExecutiveBriefingLoading
                        ? "Preparando síntesis de la cuenta..."
                        : "Síntesis, riesgos y siguiente paso recomendado."}
                  </p>
                </div>
              </header>
              <CustomerActionResult
                label="Ver síntesis y acciones"
                className="is-result-wide"
                showStatus={false}
                status={getCustomerActionStatus({
                  loading: customerExecutiveBriefingLoading,
                  error: customerActionErrors.briefing,
                  job: customerExecutiveBriefingJob,
                })}
                preview={
                  customerExecutiveBriefingJob?.result?.executiveBriefing
                    ? `Salud ${customerExecutiveBriefingJob.result.executiveBriefing.healthScore}/100 · ${customerExecutiveBriefingJob.result.executiveBriefing.prioritizedRisks?.length || 0} riesgos`
                    : customerExecutiveBriefingLoading
                      ? "Preparando síntesis de la cuenta..."
                      : "Síntesis, riesgos y siguiente paso recomendado."
                }
                open={openCustomerAction === "briefing"}
                onToggle={(isOpen) =>
                  setCustomerActionResultOpen("briefing", isOpen)
                }
              >
                {customerActionErrors.briefing ? (
                  <p className="form-error">{customerActionErrors.briefing}</p>
                ) : customerExecutiveBriefingJob?.result?.executiveBriefing ? (
                  <section
                    className="mi-agent-customer-executive-result"
                    aria-label="Resumen ejecutivo de cuenta"
                  >
                    <div className="mi-agent-section-heading">
                      <div>
                        <span className="mi-agent-section-label">
                          Síntesis ejecutiva
                        </span>
                        <h3>{customerExecutiveBriefingJob.result.headline}</h3>
                      </div>
                      <span>
                        Salud{" "}
                        {
                          customerExecutiveBriefingJob.result.executiveBriefing
                            .healthScore
                        }
                        /100
                      </span>
                    </div>
                    <p className="mi-agent-customer-summary">
                      {customerExecutiveBriefingJob.result.summary}
                    </p>
                    <div className="mi-agent-discovery-columns">
                      <div>
                        <strong>Cambios recientes</strong>
                        <ul>
                          {(
                            customerExecutiveBriefingJob.result
                              .executiveBriefing.recentChanges || []
                          ).map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <strong>Riesgos prioritarios</strong>
                        <ul>
                          {(
                            customerExecutiveBriefingJob.result
                              .executiveBriefing.prioritizedRisks || []
                          ).map((item) => (
                            <li key={`${item.title}-${item.evidence}`}>
                              {item.title}: {item.summary}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <strong>Preguntas para la reunión</strong>
                        <ul>
                          {(
                            customerExecutiveBriefingJob.result
                              .executiveBriefing.meetingQuestions || []
                          ).map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <div className="mi-agent-customer-summary">
                      <strong>Siguiente mejor paso:</strong>{" "}
                      {
                        customerExecutiveBriefingJob.result.executiveBriefing
                          .nextBestStep
                      }
                    </div>
                    {customerExecutiveBriefingJob.result.executiveBriefing
                      .recommendedActions?.length ? (
                      <div className="mi-agent-discovery-next-steps">
                        <strong>Acciones recomendadas</strong>
                        {customerExecutiveBriefingJob.result.executiveBriefing.recommendedActions.map(
                          (action, index) => (
                            <article
                              key={`${action.title}-${action.opportunityId || index}`}
                            >
                              <div>
                                <span>{action.actionType || "Actividad"}</span>
                                <strong>{action.title}</strong>
                                <p>
                                  {action.successCriteria ||
                                    action.notes ||
                                    "Revisar y confirmar el siguiente paso."}
                                </p>
                              </div>
                              {action.opportunityId &&
                              canUpdateCommercialDevelopment ? (
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  onClick={() =>
                                    openDiscoveryActivity({
                                      ...action,
                                      opportunityId: Number(
                                        action.opportunityId,
                                      ),
                                    })
                                  }
                                >
                                  Revisar y crear tarea
                                </button>
                              ) : null}
                            </article>
                          ),
                        )}
                      </div>
                    ) : null}
                  </section>
                ) : (
                  <p className="field-hint">
                    {customerExecutiveBriefingLoading
                      ? "Preparando resumen ejecutivo..."
                      : "Prepara un resumen para consultar riesgos y acciones recomendadas."}
                  </p>
                )}
              </CustomerActionResult>
            </section>
            <section
              className="mi-agent-customer-operation"
              aria-label="Preparar llamada"
            >
              <header className="mi-agent-customer-operation-heading is-result-heading">
                <button
                  type="button"
                  className="mi-agent-secondary-button"
                  onClick={prepareCustomerCall}
                  disabled={customerDiscoveryPreparing || !hasCustomerContext}
                >
                  {customerDiscoveryPreparing
                    ? "Preparando..."
                    : "Preparar llamada"}
                </button>
                <div className="mi-agent-customer-analysis-intro">
                  <div className="mi-agent-customer-analysis-title">
                    <strong>Briefing de llamada</strong>
                    <span
                      className={`mi-agent-customer-action-result-status ${getCustomerActionStatusClass(getCustomerActionStatus({ loading: customerDiscoveryPreparing, error: customerActionErrors.call, job: customerDiscoveryJob }))}`}
                    >
                      {getCustomerActionStatus({
                        loading: customerDiscoveryPreparing,
                        error: customerActionErrors.call,
                        job: customerDiscoveryJob,
                      })}
                    </span>
                  </div>
                  <p className="mi-agent-customer-analysis-summary">
                    {customerDiscoveryJob?.result?.briefing
                      ? `${customerDiscoveryJob.result.briefing.questions?.length || 0} preguntas · ${customerDiscoveryJob.result.briefing.nextSteps?.length || 0} próximos pasos`
                      : customerDiscoveryPreparing
                        ? "Preparando el briefing comercial..."
                        : "Objetivo, preguntas y próximos pasos para la llamada."}
                  </p>
                </div>
              </header>
              <CustomerActionResult
                label="Ver preguntas y próximos pasos"
                className="is-result-wide"
                showStatus={false}
                status={getCustomerActionStatus({
                  loading: customerDiscoveryPreparing,
                  error: customerActionErrors.call,
                  job: customerDiscoveryJob,
                })}
                preview={
                  customerDiscoveryJob?.result?.briefing
                    ? `${customerDiscoveryJob.result.briefing.questions?.length || 0} preguntas · ${customerDiscoveryJob.result.briefing.nextSteps?.length || 0} próximos pasos`
                    : customerDiscoveryPreparing
                      ? "Preparando el briefing comercial..."
                      : "Objetivo, preguntas y próximos pasos para la llamada."
                }
                open={openCustomerAction === "call"}
                onToggle={(isOpen) =>
                  setCustomerActionResultOpen("call", isOpen)
                }
              >
                {customerActionErrors.call ? (
                  <p className="form-error">{customerActionErrors.call}</p>
                ) : customerDiscoveryJob?.result?.briefing ? (
                  <section
                    className="mi-agent-customer-call-result"
                    aria-label="Briefing de llamada"
                  >
                    <div className="mi-agent-section-heading">
                      <div>
                        <span className="mi-agent-section-label">
                          Preparación comercial
                        </span>
                        <h3>
                          {customerDiscoveryJob.result.headline ||
                            "Briefing de llamada"}
                        </h3>
                      </div>
                      <span>
                        {customerDiscoveryJob.status === "completed"
                          ? "Listo"
                          : "En proceso"}
                      </span>
                    </div>
                    <p className="mi-agent-customer-summary">
                      {customerDiscoveryJob.result.summary}
                    </p>
                    <div className="mi-agent-discovery-grid">
                      <article>
                        <span>Objetivo</span>
                        <p>{customerDiscoveryJob.result.briefing.objective}</p>
                      </article>
                      <article>
                        <span>Contacto objetivo</span>
                        <p>
                          {customerDiscoveryJob.result.briefing.targetContact}
                        </p>
                      </article>
                    </div>
                    <div className="mi-agent-discovery-columns">
                      <div>
                        <strong>Preguntas para descubrir</strong>
                        <ul>
                          {(
                            customerDiscoveryJob.result.briefing.questions || []
                          ).map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <strong>Riesgos a cuidar</strong>
                        <ul>
                          {(
                            customerDiscoveryJob.result.briefing.risks || []
                          ).map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <strong>Guion de llamada</strong>
                        <ul>
                          {(
                            customerDiscoveryJob.result.briefing.callGuide || []
                          ).map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <div className="mi-agent-discovery-next-steps">
                      <strong>Próximos pasos sugeridos</strong>
                      {(
                        customerDiscoveryJob.result.briefing.nextSteps || []
                      ).map((step) => (
                        <article key={`${step.title}-${step.actionType}`}>
                          <div>
                            <span>{step.actionType}</span>
                            <strong>{step.title}</strong>
                            <p>{step.successCriteria}</p>
                          </div>
                          {step.opportunityId &&
                          canUpdateCommercialDevelopment ? (
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => openDiscoveryActivity(step)}
                            >
                              Crear tarea
                            </button>
                          ) : null}
                        </article>
                      ))}
                    </div>
                    {customerDiscoveryJob.result.briefing.emailDraft ? (
                      <div className="mi-agent-discovery-email">
                        <strong>Correo sugerido</strong>
                        <span>
                          {
                            customerDiscoveryJob.result.briefing.emailDraft
                              .subject
                          }
                        </span>
                        <pre>
                          {customerDiscoveryJob.result.briefing.emailDraft.body}
                        </pre>
                      </div>
                    ) : null}
                  </section>
                ) : (
                  <p className="field-hint">
                    {customerDiscoveryPreparing
                      ? "Preparando el briefing de llamada..."
                      : "No se pudo preparar el briefing de llamada."}
                  </p>
                )}
              </CustomerActionResult>
            </section>
          </div>
          {!hasCustomerContext ? (
            <p className="field-hint">
              Selecciona una cuenta existente arriba para iniciar la
              inteligencia comercial; la selección del Chat del Coach es
              independiente.
            </p>
          ) : null}
        </section>
      ) : activeWorkspace === "prospect" ? (
        <section className="mi-agent-workspace-panel">
          <div className="mi-agent-section-heading">
            <div>
              <span className="mi-agent-section-label">Cuenta nueva</span>
              <h3>Prospección asistida</h3>
            </div>
            <span>
              {prospectSession?.status === "completed"
                ? "Ficha lista"
                : "Cuenta nueva"}
            </span>
          </div>
          <div
            className="mi-agent-workspace-tabs"
            role="tablist"
            aria-label="Prospección"
          >
            <button
              type="button"
              role="tab"
              aria-selected={prospectView === "new"}
              className={prospectView === "new" ? "is-active" : ""}
              onClick={() => setProspectView("new")}
            >
              Nueva investigación
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={prospectView === "saved"}
              className={prospectView === "saved" ? "is-active" : ""}
              onClick={() => setProspectView("saved")}
            >
              Investigaciones guardadas
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={prospectView === "targets"}
              className={prospectView === "targets" ? "is-active" : ""}
              onClick={() => setProspectView("targets")}
            >
              Cuentas objetivo
            </button>
          </div>
          {prospectView !== "new" ? (
            <section
              className="mi-agent-prospect-library"
              role="tabpanel"
              aria-label={
                prospectView === "targets"
                  ? "Cuentas objetivo"
                  : "Investigaciones guardadas"
              }
            >
              <form
                className="mi-agent-prospect-library-search"
                onSubmit={(event) => {
                  event.preventDefault();
                  loadProspectSessions({
                    search: prospectListSearch,
                    targetOnly: prospectView === "targets",
                    offset: 0,
                  });
                }}
              >
                <input
                  value={prospectListSearch}
                  onChange={(event) =>
                    setProspectListSearch(event.target.value)
                  }
                  placeholder="Buscar empresa, país, sitio o industria"
                  aria-label="Buscar investigaciones"
                />
                <button
                  type="submit"
                  className="mi-agent-secondary-button"
                  disabled={prospectListLoading}
                >
                  Buscar
                </button>
              </form>
              {prospectListError ? (
                <p className="form-error">{prospectListError}</p>
              ) : null}
              {prospectListLoading ? (
                <p className="field-hint">Cargando investigaciones…</p>
              ) : prospectList.items.length ? (
                <div className="mi-agent-prospect-library-list">
                  {prospectList.items.map((item) => (
                    <article key={item.id}>
                      <div className="mi-agent-prospect-library-summary">
                        <strong>{item.companyName}</strong>
                        <span>
                          {[item.country, item.industry, item.website]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        <small>
                          {item.externalResearchedAt
                            ? `Última investigación ${new Date(item.externalResearchedAt).toLocaleString("es-MX")}`
                            : item.latestRunStatus === "running" ||
                                item.latestRunStatus === "pending"
                              ? "Investigación en curso"
                              : "Sin investigación pública completada"}
                        </small>
                        <small>
                          {item.findingCount} hallazgo(s) · {item.contactCount}{" "}
                          persona(s) · {item.hypothesisCount} hipótesis ·{" "}
                          {item.runCount} ejecución(es)
                          {item.convertedAccountId
                            ? " · vinculada a cuenta CRM"
                            : ""}
                          {item.duplicateCount > 1
                            ? ` · ${item.duplicateCount} fichas agrupadas`
                            : ""}
                        </small>
                      </div>
                      <div className="mi-agent-prospect-library-actions">
                        <button
                          type="button"
                          className="mi-agent-primary-button"
                          onClick={() => openSavedProspect(item.id)}
                          disabled={prospectListLoading}
                        >
                          Abrir investigación
                        </button>
                        <button
                          type="button"
                          className="mi-agent-secondary-button"
                          onClick={() => updateProspectTarget(item)}
                          disabled={
                            prospectTargetUpdatingId === item.id ||
                            (!item.isTarget && !item.externalResearchedAt)
                          }
                          title={
                            !item.isTarget && !item.externalResearchedAt
                              ? "Completa una investigación pública antes de agregarla"
                              : undefined
                          }
                        >
                          {prospectTargetUpdatingId === item.id
                            ? "Actualizando…"
                            : item.isTarget
                              ? "Quitar de cuentas objetivo"
                              : "Agregar a cuentas objetivo"}
                        </button>
                        <button
                          type="button"
                          className="mi-agent-secondary-button"
                          onClick={() => deleteSavedProspect(item)}
                          disabled={prospectListLoading}
                          aria-label={`Eliminar investigación de ${item.companyName}`}
                        >
                          Eliminar investigación
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="field-hint">
                  {prospectView === "targets"
                    ? "Aún no agregas investigaciones a Cuentas objetivo."
                    : "Aún no hay investigaciones guardadas con esos criterios."}
                </p>
              )}
              <div className="mi-agent-prospect-library-pagination">
                <span>
                  {prospectList.total
                    ? `${prospectList.offset + 1}–${Math.min(prospectList.offset + prospectList.limit, prospectList.total)} de ${prospectList.total}`
                    : "0 investigaciones"}
                </span>
                <button
                  type="button"
                  className="mi-agent-secondary-button"
                  onClick={() =>
                    loadProspectSessions({
                      search: prospectListSearch,
                      targetOnly: prospectView === "targets",
                      offset: Math.max(
                        0,
                        prospectList.offset - prospectList.limit,
                      ),
                    })
                  }
                  disabled={prospectListLoading || prospectList.offset === 0}
                  aria-label="Página anterior"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  className="mi-agent-secondary-button"
                  onClick={() =>
                    loadProspectSessions({
                      search: prospectListSearch,
                      targetOnly: prospectView === "targets",
                      offset: prospectList.offset + prospectList.limit,
                    })
                  }
                  disabled={
                    prospectListLoading ||
                    prospectList.offset + prospectList.limit >=
                      prospectList.total
                  }
                  aria-label="Página siguiente"
                >
                  Siguiente
                </button>
              </div>
            </section>
          ) : null}
          {prospectView === "new" && prospectError ? (
            <p className="form-error">{prospectError}</p>
          ) : null}
          <div
            className="mi-agent-prospect-preview"
            hidden={prospectView !== "new"}
          >
            <label>
              Empresa
              <input
                value={prospectForm.companyName}
                onChange={(event) =>
                  updateProspectForm("companyName", event.target.value)
                }
                placeholder="Nombre de la empresa"
                disabled={prospectPreparing || Boolean(prospectSession)}
              />
            </label>
            <label>
              País / mercado
              <input
                value={prospectForm.country}
                onChange={(event) =>
                  updateProspectForm("country", event.target.value)
                }
                placeholder="México, Perú, Colombia..."
                disabled={prospectPreparing || Boolean(prospectSession)}
              />
            </label>
            <label>
              Sitio web opcional
              <input
                value={prospectForm.website}
                onChange={(event) =>
                  updateProspectForm("website", event.target.value)
                }
                placeholder="https://empresa.com"
                disabled={prospectPreparing || Boolean(prospectSession)}
              />
            </label>
            <label>
              Industria opcional
              <input
                value={prospectForm.industry}
                onChange={(event) =>
                  updateProspectForm("industry", event.target.value)
                }
                placeholder="Logística, banca, retail..."
                disabled={prospectPreparing || Boolean(prospectSession)}
              />
            </label>
          </div>
          <div
            className="mi-agent-workspace-actions"
            hidden={prospectView !== "new"}
          >
            {!prospectSession &&
            canCreateProspecting &&
            canUseExternalSources ? (
              <button
                type="button"
                className="mi-agent-primary-button"
                onClick={startProspectResearch}
                disabled={
                  prospectPreparing ||
                  prospectExternalResearching ||
                  !prospectForm.companyName.trim() ||
                  !prospectForm.country.trim()
                }
              >
                {prospectPreparing || prospectExternalResearching
                  ? "Investigando..."
                  : "Investigar fuentes públicas"}
              </button>
            ) : null}
            {canCreateProspecting &&
            canUseExternalSources &&
            prospectSession ? (
              <button
                type="button"
                className="mi-agent-primary-button"
                onClick={() => runProspectExternalResearch(prospectSession.id)}
                disabled={prospectPreparing || prospectExternalResearching}
              >
                {prospectExternalResearching
                  ? "Actualizando..."
                  : prospectSession.externalResearchRuns?.length ||
                      prospectSession.result?.externalResearch?.researchedAt
                    ? "Actualizar investigación"
                    : "Investigar fuentes públicas"}
              </button>
            ) : null}
            {prospectSession && canUpdateProspecting ? (
              <button
                type="button"
                className="mi-agent-secondary-button"
                onClick={() => updateProspectTarget(prospectSession)}
                disabled={
                  prospectTargetUpdatingId === prospectSession.id ||
                  (!prospectSession.isTarget &&
                    !(
                      prospectSession.externalResearchedAt ||
                      prospectSession.result?.externalResearch?.researchedAt
                    ))
                }
                title={
                  !prospectSession.isTarget &&
                  !(
                    prospectSession.externalResearchedAt ||
                    prospectSession.result?.externalResearch?.researchedAt
                  )
                    ? "Completa una investigación pública antes de agregarla"
                    : undefined
                }
              >
                {prospectTargetUpdatingId === prospectSession.id
                  ? "Actualizando…"
                  : prospectSession.isTarget
                    ? "Quitar de cuentas objetivo"
                    : "Agregar a cuentas objetivo"}
              </button>
            ) : null}
            <button
              type="button"
              className="mi-agent-secondary-button"
              onClick={() => {
                setProspectForm({
                  companyName: "",
                  country: "",
                  website: "",
                  industry: "",
                });
                window.sessionStorage.removeItem(PROSPECT_SESSION_STORAGE_KEY);
                setProspectSession(null);
                setProspectChatMessages([]);
                setProspectChatQuestion("");
                setProspectError("");
              }}
              disabled={prospectPreparing || prospectExternalResearching}
            >
              Limpiar
            </button>
          </div>
          {prospectView === "new" &&
          canCreateProspecting &&
          !canUseExternalSources ? (
            <p className="field-hint">
              Tu usuario no tiene permiso para consultar fuentes públicas.
            </p>
          ) : null}
          {prospectView === "new" && !prospectSession ? (
            <p className="field-hint">
              La investigación consultará fuentes públicas y mostrará sus
              referencias. No completará información sin respaldo verificable.
            </p>
          ) : null}
          {prospectView === "new" && prospectSession?.result ? (
            <section className="mi-agent-prospect-result">
              <div className="mi-agent-section-heading">
                <div>
                  <span className="mi-agent-section-label">
                    Investigación pública
                  </span>
                  <h3>
                    {prospectSession.companyName || prospectForm.companyName}
                  </h3>
                </div>
                <span>
                  {prospectExternalResearching
                    ? "En curso"
                    : prospectSession.status === "completed"
                      ? "Actualizada"
                      : prospectSession.status}
                </span>
              </div>
              {prospectSession.result?.externalResearch?.researchedAt ? (
                <p className="mi-agent-customer-summary">
                  {`${prospectSession.result.externalResearch.findingCount || 0} hallazgo(s), ${prospectSession.result.externalResearch.contactCount || 0} persona(s) con fuente, ${prospectSession.result.externalResearch.hypothesisCount || 0} hipótesis y ${(prospectSession.result.externalResearch.targetRoles || []).length} roles objetivo en la última consulta.`}
                </p>
              ) : null}
              <section className="mi-agent-coach-panel mi-agent-customer-chat">
                <div className="mi-agent-section-heading">
                  <div>
                    <span className="mi-agent-section-label">
                      Chat de prospecto
                    </span>
                    <h4>Pregúntale sobre esta cuenta nueva</h4>
                  </div>
                  <span>Datos de prospección, no CRM confirmado</span>
                </div>
                {prospectChatMessages.length ? (
                  <div className="mi-agent-coach-thread" aria-live="polite">
                    {prospectChatMessages.map((message, index) => (
                      <div
                        key={`${message.role}-${index}`}
                        className={`mi-agent-coach-message ${message.role === "seller" ? "is-seller" : "is-coach"}`}
                      >
                        <span>
                          {message.role === "seller" ? "Vendedor" : "Prospecto"}
                        </span>
                        <p>{message.text || message.answer}</p>
                        <CoachQualityFeedback
                          traceId={message.qualityTraceId}
                        />
                        {message.evidence?.length ? (
                          <small>{message.evidence.join(" ")}</small>
                        ) : null}
                        {message.recommendedActions?.some(
                          isProspectConversionAction,
                        ) &&
                        !message.operations?.some(
                          isProspectConversionOperation,
                        ) ? (
                          <div className="mi-agent-customer-chat-actions">
                            <strong>
                              Acciones sugeridas · requieren confirmación
                            </strong>
                            {message.recommendedActions
                              .filter(isProspectConversionAction)
                              .map((action, actionIndex) => (
                                <article key={`${action.title}-${actionIndex}`}>
                                  <span>
                                    {action.title || "Acción de prospección"}
                                  </span>
                                  <small>
                                    Confirma esta acción desde la ficha antes de
                                    convertir datos a CRM.
                                  </small>
                                </article>
                              ))}
                          </div>
                        ) : null}
                        {message.operations?.some(
                          isProspectConversionOperation,
                        ) ? (
                          <div className="mi-agent-customer-chat-actions">
                            <strong>Operaciones propuestas</strong>
                            {message.operations
                              .filter(isProspectConversionOperation)
                              .map((operation, operationIndex) => (
                                <article
                                  key={`${operation.kind}-${operation.title}-${operationIndex}`}
                                >
                                  <span>
                                    {operation.title || operation.kind} ·
                                    requiere revisión y confirmación
                                  </span>
                                  {canReviewCustomerOperation(operation) ? (
                                    <button
                                      type="button"
                                      className="mi-agent-link-button"
                                      disabled={savingCoachOperation}
                                      onClick={() =>
                                        openCustomerChatOperation(operation)
                                      }
                                    >
                                      Revisar operación
                                    </button>
                                  ) : (
                                    <small>
                                      No tienes permisos para proponer este tipo
                                      de cambio.
                                    </small>
                                  )}
                                </article>
                              ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                <form
                  className="mi-agent-coach-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    askProspectChat();
                  }}
                >
                  <input
                    value={prospectChatQuestion}
                    onChange={(event) =>
                      setProspectChatQuestion(event.target.value)
                    }
                    placeholder="Pregunta sobre el prospecto..."
                    disabled={prospectChatLoading}
                  />
                  <button
                    type="submit"
                    className="mi-agent-primary-button"
                    disabled={
                      prospectChatLoading || !prospectChatQuestion.trim()
                    }
                  >
                    {prospectChatLoading ? "Consultando..." : "Preguntar"}
                  </button>
                </form>
              </section>
              {prospectSession.result?.externalResearch?.warnings?.length ? (
                <p className="mi-agent-inline-notice">
                  {prospectSession.result.externalResearch.warnings.join(" ")}
                </p>
              ) : null}
              {prospectSession.result?.externalResearch?.sellerBrief ? (
                <section className="mi-agent-prospect-section">
                  <strong>Guía para iniciar la conversación</strong>
                  <article className="mi-agent-customer-summary">
                    <span>Por qué podría ser relevante contactar ahora</span>
                    <p>
                      {
                        prospectSession.result.externalResearch.sellerBrief
                          .whyNow
                      }
                    </p>
                    <span>Apertura sugerida</span>
                    <p>
                      {
                        prospectSession.result.externalResearch.sellerBrief
                          .recommendedOpening
                      }
                    </p>
                    <strong>Preguntas de descubrimiento</strong>
                    <ul>
                      {prospectSession.result.externalResearch.sellerBrief.discoveryQuestions.map(
                        (question, index) => (
                          <li key={`${index}-${question}`}>{question}</li>
                        ),
                      )}
                    </ul>
                    <small>
                      Basado en fuentes públicas; las necesidades y la intención
                      de compra deben validarse con el prospecto.
                    </small>
                    <div className="mi-agent-finding-actions">
                      {prospectSession.result.externalResearch.sellerBrief.sourceReferences.map(
                        (source, index) => (
                          <a
                            key={`${source}-${index}`}
                            href={source}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Fuente {index + 1}
                          </a>
                        ),
                      )}
                    </div>
                  </article>
                </section>
              ) : null}
              {prospectSession.result?.externalResearch?.targetRoles?.length ? (
                <div className="mi-agent-prospect-section">
                  <strong>
                    Roles objetivo sugeridos · no son personas identificadas
                  </strong>
                  <div className="mi-agent-prospect-card-grid">
                    {prospectSession.result.externalResearch.targetRoles.map(
                      (role, index) => (
                        <article key={`${role.roleTitle}-${index}`}>
                          <span>{role.area}</span>
                          <strong>{role.roleTitle}</strong>
                          <p>{role.rationale}</p>
                          <small>{role.validationQuestion}</small>
                          <small>
                            Basado en: {role.basisFindingTitle}
                            {role.sourceReference ? (
                              <>
                                {" · "}
                                <a
                                  href={role.sourceReference}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Abrir fuente
                                </a>
                              </>
                            ) : null}
                          </small>
                        </article>
                      ),
                    )}
                  </div>
                </div>
              ) : null}
              <div className="mi-agent-discovery-grid">
                <article>
                  <span>Empresa</span>
                  <p>{prospectSession.companyName}</p>
                </article>
                <article>
                  <span>País</span>
                  <p>{prospectSession.country}</p>
                </article>
                {prospectSession.website ? (
                  <article>
                    <span>Sitio ingresado</span>
                    <p>{prospectSession.website}</p>
                  </article>
                ) : null}
                {prospectSession.industry ? (
                  <article>
                    <span>Industria ingresada</span>
                    <p>{prospectSession.industry}</p>
                  </article>
                ) : null}
              </div>
              {prospectSession.externalResearchRuns?.length ? (
                <div className="mi-agent-prospect-section">
                  <strong>Historial de investigación</strong>
                  <div className="mi-agent-prospect-card-grid">
                    {prospectSession.externalResearchRuns.map((run) => (
                      <article key={run.id}>
                        <span>
                          {run.startedAt
                            ? new Date(run.startedAt).toLocaleString("es-MX")
                            : "Consulta"}
                        </span>
                        <strong>
                          {run.status === "completed"
                            ? `${run.findingCount} hallazgo(s), ${run.contactCount} persona(s), ${run.hypothesisCount} hipótesis`
                            : run.status}
                        </strong>
                        {run.trackResults?.map((track) => (
                          <small key={`${run.id}-${track.key}`}>
                            {PROSPECT_RESEARCH_TRACK_LABELS[track.key] ||
                              track.label}
                            : {track.sourceCount} fuente(s),{" "}
                            {track.findingCount} hallazgo(s),{" "}
                            {track.contactCount} persona(s),{" "}
                            {track.hypothesisCount} hipótesis,{" "}
                            {track.targetRoleCount || 0} rol(es) objetivo
                            {!track.sourceCount
                              ? " · sin evidencia pública"
                              : ""}
                          </small>
                        ))}
                        {run.warnings?.length ? (
                          <small>{run.warnings.join(" ")}</small>
                        ) : null}
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="mi-agent-prospect-section">
                <strong>Revisión de posibles cuentas duplicadas</strong>
                {!prospectSession.duplicateReview?.completed ? (
                  <p>
                    Se requiere permiso de lectura de cuentas para revisar
                    duplicados antes de convertir.
                  </p>
                ) : !prospectSession.duplicateReview.countryResolved ? (
                  <p>
                    No se reconoció el país indicado. Corrígelo y prepara de
                    nuevo la prospección antes de convertir.
                  </p>
                ) : prospectSession.duplicateReview.candidates.length ? (
                  <>
                    <p>
                      Hay coincidencias por nombre o dominio. Revisa en el
                      módulo de cuentas y elige una decisión explícita.
                    </p>
                    <div className="mi-agent-prospect-card-grid">
                      {prospectSession.duplicateReview.candidates.map(
                        (candidate) => (
                          <article key={candidate.id}>
                            <strong>{candidate.name}</strong>
                            <p>
                              {candidate.country || "País no indicado"}
                              {candidate.domain ? ` · ${candidate.domain}` : ""}
                            </p>
                            <small>
                              Coincidencia:{" "}
                              {candidate.matchType === "domain"
                                ? "dominio"
                                : "nombre y país"}
                            </small>
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() =>
                                convertProspectAccount(
                                  "link_existing",
                                  candidate.id,
                                )
                              }
                              disabled={
                                !canUpdateProspecting ||
                                !canCreateAccounts ||
                                prospectConverting === "account" ||
                                Boolean(prospectSession.convertedAccountId)
                              }
                            >
                              Vincular esta cuenta
                            </button>
                          </article>
                        ),
                      )}
                    </div>
                    <button
                      type="button"
                      className="mi-agent-secondary-button"
                      onClick={() => convertProspectAccount("create_new")}
                      disabled={
                        !canUpdateProspecting ||
                        !canCreateAccounts ||
                        prospectConverting === "account" ||
                        Boolean(prospectSession.convertedAccountId)
                      }
                    >
                      Crear una cuenta nueva de todos modos
                    </button>
                  </>
                ) : (
                  <p>
                    No se encontraron posibles duplicados para este nombre, país
                    y dominio.
                  </p>
                )}
              </div>
              <div className="mi-agent-prospect-conversion-actions">
                <button
                  type="button"
                  className="mi-agent-primary-button"
                  onClick={() => convertProspectAccount("create_new")}
                  disabled={
                    !canUpdateProspecting ||
                    !canCreateAccounts ||
                    prospectConverting === "account" ||
                    !prospectSession.duplicateReview?.completed ||
                    !prospectSession.duplicateReview?.countryResolved ||
                    prospectSession.duplicateReview.candidates.length > 0 ||
                    Boolean(
                      prospectConvertedAccountId ||
                      prospectSession.convertedAccountId,
                    )
                  }
                >
                  {prospectConvertedAccountId ||
                  prospectSession.convertedAccountId
                    ? "Cuenta creada/vinculada"
                    : prospectConverting === "account"
                      ? "Creando cuenta..."
                      : "Crear cuenta revisada"}
                </button>
                {prospectConvertedLeadId ? (
                  <span className="mi-agent-prospect-success" role="status">
                    <CheckCircle2 size={16} aria-hidden="true" />
                    Lead creado
                  </span>
                ) : (
                  <button
                    type="button"
                    className="mi-agent-secondary-button"
                    onClick={convertProspectLead}
                    disabled={
                      !canUpdateProspecting ||
                      !canCreateLeads ||
                      prospectConverting === "lead"
                    }
                  >
                    {prospectConverting === "lead"
                      ? "Creando lead..."
                      : "Crear lead"}
                  </button>
                )}
              </div>
              {Array.isArray(prospectSession.findings) &&
              prospectSession.findings.length ? (
                <div className="mi-agent-finding-list">
                  {prospectSession.findings.map((finding) => (
                    <article
                      key={finding.id}
                      className={`mi-agent-finding-card is-${finding.status}`}
                    >
                      <div className="mi-agent-finding-heading">
                        <div>
                          <span>
                            {CUSTOMER_FINDING_CATEGORY_LABELS[
                              finding.category
                            ] || finding.category}
                          </span>
                          <small>
                            {finding.certainty === "evidenced" ||
                            /^https?:\/\//i.test(finding.sourceReference || "")
                              ? "Respaldado por fuente pública"
                              : "Inferencia por validar"}
                            {finding.metadata?.researchTracks?.length
                              ? ` · ${finding.metadata.researchTracks
                                  .map(
                                    (track) =>
                                      PROSPECT_RESEARCH_TRACK_LABELS[track] ||
                                      track,
                                  )
                                  .join(", ")}`
                              : ""}
                          </small>
                          <strong>{finding.title}</strong>
                        </div>
                        <em>
                          {CUSTOMER_FINDING_STATUS_LABELS[finding.status] ||
                            finding.status}
                        </em>
                        {finding.lastResearchObservation ? (
                          <small>
                            {{
                              new: "Nuevo",
                              updated: "Actualizado",
                              unchanged: "Sin cambios",
                            }[finding.lastResearchObservation] ||
                              finding.lastResearchObservation}
                          </small>
                        ) : null}
                      </div>
                      <p>{finding.summary}</p>
                      {finding.evidenceText ? (
                        <small>
                          Lectura de la fuente: {finding.evidenceText}
                        </small>
                      ) : null}
                      {finding.metadata?.sourcePublishedAt ? (
                        <small>
                          Publicado: {finding.metadata.sourcePublishedAt}
                        </small>
                      ) : null}
                      {finding.sourceExcerpt || finding.evidenceText ? (
                        <blockquote>
                          <small>Fragmento recuperado de la fuente</small>
                          <br />
                          {finding.sourceExcerpt || finding.evidenceText}
                        </blockquote>
                      ) : null}
                      <div className="mi-agent-finding-meta">
                        <span>
                          Confianza:{" "}
                          {CUSTOMER_FINDING_CONFIDENCE_LABELS[
                            finding.confidence
                          ] || finding.confidence}
                          <span>
                            Fuente:{" "}
                            {/^https?:\/\//i.test(
                              finding.sourceReference || "",
                            ) ? (
                              <a
                                href={finding.sourceReference}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Abrir fuente
                              </a>
                            ) : (
                              finding.sourceReference || finding.sourceType
                            )}
                          </span>
                          Fuente:{" "}
                          {finding.sourceReference || finding.sourceType}
                        </span>
                      </div>
                      <div className="mi-agent-finding-actions">
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() =>
                            updateProspectFindingStatus(finding, "confirmed")
                          }
                          disabled={
                            !canUpdateProspecting ||
                            finding.status === "confirmed" ||
                            prospectFindingUpdatingId === finding.id
                          }
                        >
                          Confirmar
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() =>
                            updateProspectFindingStatus(finding, "rejected")
                          }
                          disabled={
                            !canUpdateProspecting ||
                            finding.status === "rejected" ||
                            prospectFindingUpdatingId === finding.id
                          }
                        >
                          Rechazar
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}
              {Array.isArray(prospectSession.contacts) &&
              prospectSession.contacts.length ? (
                <div className="mi-agent-prospect-section">
                  <strong>Personas públicas y roles objetivo</strong>
                  <div className="mi-agent-prospect-card-grid">
                    {prospectSession.contacts.map((contact) => (
                      <article key={contact.id}>
                        <span>{contact.area}</span>
                        <strong>{contact.roleTitle}</strong>
                        <small>
                          {contact.sourceType === "public_source"
                            ? "Persona identificada en una fuente pública · no confirmada en CRM"
                            : "Rol objetivo sugerido · no es una persona verificada"}
                        </small>
                        <p>
                          Confianza:{" "}
                          {CUSTOMER_FINDING_CONFIDENCE_LABELS[
                            contact.confidence
                          ] || contact.confidence}
                        </p>
                        {contact.sourceReference ? (
                          <small>
                            Fuente:{" "}
                            {/^https?:\/\//i.test(contact.sourceReference) ? (
                              <a
                                href={contact.sourceReference}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Abrir fuente
                              </a>
                            ) : (
                              contact.sourceReference
                            )}
                          </small>
                        ) : null}
                        {contact.evidenceText ? (
                          <small>Relevancia: {contact.evidenceText}</small>
                        ) : null}
                        {contact.sourceExcerpt ? (
                          <blockquote>
                            <small>Fragmento recuperado de la fuente</small>
                            <br />
                            {contact.sourceExcerpt}
                          </blockquote>
                        ) : null}
                        {contact.sourcePublishedAt ? (
                          <small>Publicado: {contact.sourcePublishedAt}</small>
                        ) : null}
                        <label>
                          Nombre real
                          <input
                            value={
                              prospectContactDrafts[contact.id]?.contactName ||
                              contact.name ||
                              ""
                            }
                            onChange={(event) =>
                              updateProspectContactDraft(
                                contact.id,
                                "contactName",
                                event.target.value,
                              )
                            }
                            placeholder="Nombre y apellido"
                            disabled={Boolean(
                              prospectConvertedContacts[contact.id],
                            )}
                          />
                        </label>
                        <label>
                          Email opcional
                          <input
                            value={
                              prospectContactDrafts[contact.id]?.email || ""
                            }
                            onChange={(event) =>
                              updateProspectContactDraft(
                                contact.id,
                                "email",
                                event.target.value,
                              )
                            }
                            placeholder="correo@empresa.com"
                            disabled={Boolean(
                              prospectConvertedContacts[contact.id],
                            )}
                          />
                        </label>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => convertProspectContact(contact)}
                          disabled={
                            !canUpdateProspecting ||
                            !canCreateContacts ||
                            Boolean(prospectConvertedContacts[contact.id]) ||
                            prospectConverting === `contact-${contact.id}`
                          }
                        >
                          {prospectConvertedContacts[contact.id]
                            ? "Contacto creado"
                            : prospectConverting === `contact-${contact.id}`
                              ? "Creando..."
                              : "Crear contacto"}
                        </button>
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}
              {Array.isArray(prospectSession.hypotheses) &&
              prospectSession.hypotheses.length ? (
                <div className="mi-agent-prospect-section">
                  <strong>Hipótesis de oportunidad · por validar</strong>
                  <div className="mi-agent-prospect-card-grid">
                    {prospectSession.hypotheses.map((hypothesis) => (
                      <article key={hypothesis.id}>
                        <span>{hypothesis.technologyArea}</span>
                        <strong>{hypothesis.title}</strong>
                        <small>
                          {hypothesis.status === "confirmed"
                            ? "Validada por el vendedor"
                            : hypothesis.status === "rejected"
                              ? "Rechazada por el vendedor"
                              : "Hipótesis · no confirmada"}
                        </small>
                        <p>{hypothesis.businessChallenge}</p>
                        <small>{hypothesis.validationQuestion}</small>
                        {hypothesis.evidenceText ? (
                          <small>
                            Lectura de la fuente: {hypothesis.evidenceText}
                          </small>
                        ) : null}
                        {hypothesis.sourceExcerpt ? (
                          <blockquote>
                            <small>Fragmento recuperado de la fuente</small>
                            <br />
                            {hypothesis.sourceExcerpt}
                          </blockquote>
                        ) : null}
                        {hypothesis.sourceReference ? (
                          <small>
                            Fuente:{" "}
                            <a
                              href={hypothesis.sourceReference}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Abrir evidencia
                            </a>
                            {hypothesis.sourcePublishedAt
                              ? ` · publicado ${hypothesis.sourcePublishedAt}`
                              : ""}
                          </small>
                        ) : null}
                        {hypothesis.lastResearchObservation ? (
                          <small>
                            {{
                              new: "Nueva en esta consulta",
                              updated: "Nueva versión detectada",
                              unchanged: "Sin cambios",
                            }[hypothesis.lastResearchObservation] ||
                              hypothesis.lastResearchObservation}
                          </small>
                        ) : null}
                        <div className="mi-agent-finding-actions">
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() =>
                              updateProspectHypothesisStatus(
                                hypothesis,
                                "confirmed",
                              )
                            }
                            disabled={
                              !canUpdateProspecting ||
                              hypothesis.status === "confirmed" ||
                              prospectConverting ===
                                `hypothesis-${hypothesis.id}`
                            }
                          >
                            Confirmar hipótesis
                          </button>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() =>
                              updateProspectHypothesisStatus(
                                hypothesis,
                                "rejected",
                              )
                            }
                            disabled={
                              !canUpdateProspecting ||
                              hypothesis.status === "rejected" ||
                              prospectConverting ===
                                `hypothesis-${hypothesis.id}`
                            }
                          >
                            Rechazar
                          </button>
                        </div>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => convertProspectOpportunity(hypothesis)}
                          disabled={
                            !canUpdateProspecting ||
                            !canCreateOpportunities ||
                            hypothesis.status !== "confirmed" ||
                            Boolean(
                              prospectConvertedOpportunities[hypothesis.id],
                            ) ||
                            prospectConverting ===
                              `opportunity-${hypothesis.id}`
                          }
                        >
                          {prospectConvertedOpportunities[hypothesis.id]
                            ? "Oportunidad creada"
                            : prospectConverting ===
                                `opportunity-${hypothesis.id}`
                              ? "Creando..."
                              : "Crear oportunidad preliminar"}
                        </button>
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}
              {prospectSession.result.outreach ? (
                <div className="mi-agent-discovery-email">
                  <strong>
                    Borrador de contacto sugerido · no es un hallazgo verificado
                  </strong>
                  <span>{prospectSession.result.outreach.subject}</span>
                  <pre>{prospectSession.result.outreach.body}</pre>
                  {prospectSession.result.outreach.questions?.length ? (
                    <ul>
                      {prospectSession.result.outreach.questions.map(
                        (question) => (
                          <li key={question}>{question}</li>
                        ),
                      )}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : prospectView === "new" && prospectSession ? (
            <section className="mi-agent-prospect-result">
              <div className="mi-agent-section-heading">
                <div>
                  <span className="mi-agent-section-label">
                    Investigación pública
                  </span>
                  <h3>{prospectSession.companyName}</h3>
                </div>
                <span>
                  {prospectExternalResearching ? "En curso" : "Pendiente"}
                </span>
              </div>
              <p className="mi-agent-customer-summary">
                La sesión ya existe. La investigación aún no ha terminado; usa
                el botón de actualización para volver a intentarlo.
              </p>
            </section>
          ) : null}
        </section>
      ) : (
        <section className="mi-agent-workspace-panel mi-agent-governance-panel">
          <div className="mi-agent-section-heading">
            <div>
              <span className="mi-agent-section-label">
                Gobierno de Mi Coach
              </span>
              <h3>Configuración, límites y métricas</h3>
            </div>
            <span>Solo administración</span>
          </div>
          {coachGovernanceLoading ? (
            <div className="mi-agent-empty">
              Cargando configuración de gobierno...
            </div>
          ) : null}
          {coachGovernance ? (
            <>
              <section
                className="mi-agent-intent-governance"
                aria-labelledby="mi-agent-intent-governance-title"
              >
                <div className="mi-agent-domain-policy-heading">
                  <div>
                    <h4 id="mi-agent-intent-governance-title">
                      Intenciones y enrutamiento
                    </h4>
                    <p>
                      Aquí editas ejemplos de preguntas para mejorar cómo el
                      sistema clasifica solicitudes. Coach prioriza tu
                      desempeño, puede dar contexto puntual y deriva la
                      exploración detallada a Cliente existente o al módulo de
                      leads.
                    </p>
                  </div>
                </div>
                <div
                  className="mi-agent-intent-modes"
                  aria-label="Modos de respuesta de Coach"
                >
                  <article>
                    <strong>Coaching</strong>
                    <span>
                      Analiza avances y riesgos para proponer una mejora y un
                      siguiente paso al vendedor.
                    </span>
                  </article>
                  <article>
                    <strong>Contexto breve</strong>
                    <span>
                      Contesta una pregunta puntual con los datos mínimos
                      relevantes, sin desplegar la ficha completa.
                    </span>
                  </article>
                  <article>
                    <strong>Exploración detallada</strong>
                    <span>
                      No consulta el detalle desde Coach; ofrece abrir el
                      espacio que permite revisarlo.
                    </span>
                  </article>
                  <article>
                    <strong>Propuesta de operación</strong>
                    <span>
                      Prepara un cambio para revisión; el módulo correspondiente
                      conserva la confirmación y ejecución.
                    </span>
                  </article>
                </div>
                {coachIntentFeedback ? (
                  <p
                    className={`mi-agent-admin-rule-feedback is-${coachIntentFeedback.kind}`}
                    role={
                      coachIntentFeedback.kind === "error" ? "alert" : "status"
                    }
                  >
                    {coachIntentFeedback.message}
                  </p>
                ) : null}
                <div className="mi-agent-intent-layout">
                  <nav
                    className="mi-agent-intent-catalog"
                    aria-label="Catálogo de intenciones"
                  >
                    {coachIntentCatalog.map((intent) => (
                      <button
                        type="button"
                        key={intent.code}
                        className={
                          intent.code === coachIntentCode ? "is-active" : ""
                        }
                        onClick={() => selectCoachIntent(intent)}
                        disabled={coachGovernanceSaving}
                      >
                        <strong>{intent.label}</strong>
                        <span>{intent.code}</span>
                      </button>
                    ))}
                  </nav>
                  {selectedCoachIntent ? (
                    <div className="mi-agent-intent-detail">
                      <div>
                        <h5>{selectedCoachIntent.label}</h5>
                        <p>{selectedCoachIntent.description}</p>
                      </div>
                      <dl className="mi-agent-intent-metadata">
                        <div>
                          <dt>Contexto requerido</dt>
                          <dd>
                            {selectedCoachIntent.requiredContext.length
                              ? selectedCoachIntent.requiredContext.join(", ")
                              : "Ninguno"}
                          </dd>
                        </div>
                        <div>
                          <dt>Herramientas posibles</dt>
                          <dd>
                            {selectedCoachIntent.tools.length
                              ? selectedCoachIntent.tools.join(", ")
                              : "Ninguna"}
                          </dd>
                        </div>
                      </dl>
                      <label className="mi-agent-intent-examples">
                        Ejemplos reconocidos, uno por línea
                        <textarea
                          rows={6}
                          maxLength={7200}
                          value={coachIntentExamplesDraft}
                          onChange={(event) =>
                            setCoachIntentExamplesDraft(event.target.value)
                          }
                          disabled={coachGovernanceSaving}
                        />
                      </label>
                      <div className="mi-agent-intent-preview-form">
                        <label>
                          Pregunta de prueba
                          <input
                            value={coachIntentTestQuestion}
                            maxLength={1200}
                            onChange={(event) =>
                              setCoachIntentTestQuestion(event.target.value)
                            }
                            placeholder="Escribe una pregunta para probar el enrutamiento"
                          />
                        </label>
                        <div className="mi-agent-workspace-actions">
                          <button
                            type="button"
                            className="mi-agent-secondary-button"
                            onClick={previewCoachIntent}
                            disabled={
                              coachGovernanceSaving ||
                              !coachIntentTestQuestion.trim()
                            }
                          >
                            {coachGovernanceSaving ? "Probando..." : "Probar"}
                          </button>
                          <button
                            type="button"
                            className="mi-agent-primary-button"
                            onClick={saveCoachIntentExamples}
                            disabled={
                              coachGovernanceSaving ||
                              !coachIntentExamplesDraft.trim() ||
                              !selectedCoachIntent
                            }
                          >
                            Guardar ejemplos
                          </button>
                        </div>
                      </div>
                      {coachIntentPreview ? (
                        <div className="mi-agent-intent-preview" role="status">
                          <strong>
                            {coachIntentCatalog.find(
                              (intent) =>
                                intent.code ===
                                coachIntentPreview.classification.intent,
                            )?.label || "Requiere aclaración"}
                          </strong>
                          <span>
                            ? `${run.findingCount} fuente(s): $
                            {run.newFindingCount} nueva(s), $
                            {run.updatedFindingCount} actualizada(s), $
                            {run.unchangedFindingCount} sin cambios`
                            {COACH_INTERACTION_MODE_LABELS[
                              coachIntentPreview.classification.mode
                            ] || "Requiere aclaración"}
                          </span>
                          {coachIntentPreview.classification.detailTarget ? (
                            <span>
                              Detalle solicitado:{" "}
                              {coachIntentPreview.classification.detailTarget}
                            </span>
                          ) : null}
                          <span>
                            Confianza{" "}
                            {Math.round(
                              coachIntentPreview.classification.confidence *
                                100,
                            )}
                            %
                          </span>
                          <span>
                            Contexto:{" "}
                            {coachIntentPreview.classification.requiredContext.join(
                              ", ",
                            ) || "ninguno"}
                          </span>
                          {coachIntentPreview.missingContext.length ? (
                            <span>
                              Falta seleccionar:{" "}
                              {coachIntentPreview.missingContext.join(", ")}
                            </span>
                          ) : null}
                          <span>
                            Herramientas previstas:{" "}
                            {coachIntentPreview.plannedTools.join(", ") ||
                              "ninguna"}
                          </span>
                          <small>
                            Simulación sin ejecución de herramientas ni cambios
                            CRM.
                          </small>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="mi-agent-intent-revisions">
                  <h5>Historial de configuración</h5>
                  {coachIntentRevisions.length ? (
                    coachIntentRevisions.map((revision) => (
                      <div
                        className="mi-agent-intent-revision"
                        key={revision.id}
                      >
                        <span>
                          Revisión {revision.id} ·{" "}
                          {new Date(revision.createdAt).toLocaleString()}
                          {revision.changedByUserId
                            ? ` · usuario ${revision.changedByUserId}`
                            : " · sistema"}
                        </span>
                        <button
                          type="button"
                          className="mi-agent-secondary-button"
                          onClick={() => restoreCoachIntentRevision(revision)}
                          disabled={coachGovernanceSaving}
                        >
                          Restaurar
                        </button>
                      </div>
                    ))
                  ) : (
                    <p>No hay cambios previos registrados.</p>
                  )}
                </div>
              </section>

              <section
                className="mi-agent-channel-intent-governance"
                aria-labelledby="mi-agent-channel-intent-title"
              >
                <div className="mi-agent-admin-rules-heading">
                  <div>
                    <h4 id="mi-agent-channel-intent-title">
                      Enrutamiento por canal
                    </h4>
                    <p>
                      Ajusta las intenciones de Cliente existente y Cuenta
                      nueva. Los límites de herramientas y contexto los aplica
                      el servidor.
                    </p>
                  </div>
                  <label className="mi-agent-channel-intent-channel">
                    Canal
                    <select
                      value={channelIntentChannel}
                      onChange={(event) =>
                        loadChannelIntentChannel(event.target.value)
                      }
                      disabled={channelIntentSaving}
                    >
                      <option value="customer_account">
                        Cliente existente
                      </option>
                      <option value="prospect">Cuenta nueva</option>
                    </select>
                  </label>
                </div>
                {channelIntentFeedback ? (
                  <p
                    className={`mi-agent-admin-rule-feedback is-${channelIntentFeedback.kind}`}
                    role={
                      channelIntentFeedback.kind === "error"
                        ? "alert"
                        : "status"
                    }
                  >
                    {channelIntentFeedback.message}
                  </p>
                ) : null}
                <div className="mi-agent-intent-layout">
                  <nav
                    className="mi-agent-intent-catalog"
                    aria-label="Intenciones del canal"
                  >
                    {channelIntentCatalog.map((intent) => (
                      <button
                        type="button"
                        key={intent.code}
                        className={
                          intent.code === channelIntentCode ? "is-active" : ""
                        }
                        onClick={() => selectChannelIntent(intent)}
                        disabled={channelIntentSaving}
                      >
                        <strong>{intent.label}</strong>
                        <span>{intent.code}</span>
                      </button>
                    ))}
                  </nav>
                  {selectedChannelIntent && channelIntentDraft ? (
                    <div className="mi-agent-intent-detail">
                      <div>
                        <h5>{selectedChannelIntent.label}</h5>
                        <p>{selectedChannelIntent.description}</p>
                      </div>
                      <label className="mi-agent-channel-intent-toggle">
                        <input
                          type="checkbox"
                          checked={channelIntentDraft.enabled}
                          disabled={
                            channelIntentSaving ||
                            ["account_overview", "prospect_profile"].includes(
                              selectedChannelIntent.code,
                            )
                          }
                          onChange={(event) =>
                            setChannelIntentDraft((current) => ({
                              ...current,
                              enabled: event.target.checked,
                            }))
                          }
                        />
                        Activa
                      </label>
                      <label className="mi-agent-channel-intent-priority">
                        Prioridad
                        <input
                          type="number"
                          min={0}
                          max={200}
                          value={channelIntentDraft.priority}
                          onChange={(event) =>
                            setChannelIntentDraft((current) => ({
                              ...current,
                              priority: Number(event.target.value),
                            }))
                          }
                          disabled={channelIntentSaving}
                        />
                      </label>
                      <label className="mi-agent-intent-examples">
                        Ejemplos reconocidos, uno por línea
                        <textarea
                          rows={5}
                          maxLength={7200}
                          value={channelIntentDraft.examples}
                          onChange={(event) =>
                            setChannelIntentDraft((current) => ({
                              ...current,
                              examples: event.target.value,
                            }))
                          }
                          disabled={channelIntentSaving}
                        />
                      </label>
                      <fieldset className="mi-agent-channel-intent-options">
                        <legend>Herramientas permitidas</legend>
                        {selectedChannelIntent.possibleTools.map((tool) => (
                          <label key={tool}>
                            <input
                              type="checkbox"
                              checked={channelIntentDraft.allowedTools.includes(
                                tool,
                              )}
                              onChange={(event) =>
                                setChannelIntentDraft((current) => ({
                                  ...current,
                                  allowedTools: event.target.checked
                                    ? [...current.allowedTools, tool]
                                    : current.allowedTools.filter(
                                        (item) => item !== tool,
                                      ),
                                }))
                              }
                              disabled={channelIntentSaving}
                            />
                            {tool}
                          </label>
                        ))}
                      </fieldset>
                      <fieldset className="mi-agent-channel-intent-options">
                        <legend>Contexto requerido</legend>
                        {(channelIntentChannel === "customer_account"
                          ? ["account", "opportunity", "contact"]
                          : ["prospectSession"]
                        ).map((contextKey) => {
                          const fixed =
                            selectedChannelIntent.fixedContext.includes(
                              contextKey,
                            );
                          return (
                            <label key={contextKey}>
                              <input
                                type="checkbox"
                                checked={channelIntentDraft.requiredContext.includes(
                                  contextKey,
                                )}
                                onChange={(event) =>
                                  setChannelIntentDraft((current) => ({
                                    ...current,
                                    requiredContext: event.target.checked
                                      ? [...current.requiredContext, contextKey]
                                      : current.requiredContext.filter(
                                          (item) => item !== contextKey,
                                        ),
                                  }))
                                }
                                disabled={channelIntentSaving || fixed}
                              />
                              {contextKey}
                              {fixed ? " · obligatorio" : ""}
                            </label>
                          );
                        })}
                      </fieldset>
                      <div className="mi-agent-intent-preview-form">
                        <label>
                          Pregunta de prueba
                          <input
                            value={channelIntentTestQuestion}
                            maxLength={1200}
                            onChange={(event) =>
                              setChannelIntentTestQuestion(event.target.value)
                            }
                            placeholder="Escribe una pregunta para probar el enrutamiento"
                          />
                        </label>
                        <div className="mi-agent-workspace-actions">
                          <button
                            type="button"
                            className="mi-agent-secondary-button"
                            onClick={previewChannelIntentConfiguration}
                            disabled={
                              channelIntentSaving ||
                              !channelIntentTestQuestion.trim()
                            }
                          >
                            Probar
                          </button>
                          <button
                            type="button"
                            className="mi-agent-primary-button"
                            onClick={saveChannelIntentConfiguration}
                            disabled={
                              channelIntentSaving ||
                              !channelIntentDraft.examples.trim()
                            }
                          >
                            Guardar configuración
                          </button>
                        </div>
                      </div>
                      {channelIntentPreview?.classification ? (
                        <div className="mi-agent-intent-preview">
                          <strong>
                            {channelIntentPreview.classification.label} ·{" "}
                            {channelIntentPreview.classification.intent}
                          </strong>
                          {channelIntentPreview.classification.missingContext
                            .length ? (
                            <span>
                              Contexto requerido no suministrado:{" "}
                              {channelIntentPreview.classification.missingContext.join(
                                ", ",
                              )}
                            </span>
                          ) : null}
                          <span>
                            Herramientas previstas:{" "}
                            {channelIntentPreview.classification.allowedTools.join(
                              ", ",
                            ) || "ninguna"}
                          </span>
                          <small>
                            Simulación sin ejecución de herramientas ni cambios
                            CRM.
                          </small>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="mi-agent-intent-revisions">
                  <h5>Historial de configuración del canal</h5>
                  {channelIntentRevisions.length ? (
                    channelIntentRevisions.map((revision) => (
                      <div
                        className="mi-agent-intent-revision"
                        key={revision.id}
                      >
                        <span>
                          Revisión {revision.id} ·{" "}
                          {new Date(revision.createdAt).toLocaleString()}
                          {revision.restoredFromRevisionId
                            ? ` · restaurada desde ${revision.restoredFromRevisionId}`
                            : ""}
                        </span>
                        <button
                          type="button"
                          className="mi-agent-secondary-button"
                          onClick={() =>
                            restoreChannelIntentConfiguration(revision)
                          }
                          disabled={channelIntentSaving}
                        >
                          Restaurar
                        </button>
                      </div>
                    ))
                  ) : (
                    <p>No hay cambios previos registrados.</p>
                  )}
                </div>
              </section>

              <section
                className="mi-agent-admin-rules"
                aria-labelledby="mi-agent-admin-rules-title"
              >
                <div className="mi-agent-admin-rules-heading">
                  <div>
                    <h4 id="mi-agent-admin-rules-title">
                      Reglas conversacionales
                    </h4>
                    <p>
                      Define instrucciones de respuesta para el asistente:
                      comunes para todos los chats o específicas por canal y
                      tipo de consulta.
                    </p>
                  </div>
                  <div className="mi-agent-admin-rules-actions">
                    <button
                      type="button"
                      className="mi-agent-secondary-button"
                      onClick={() => startCoachAdminRuleCreate("common")}
                      disabled={coachGovernanceSaving}
                    >
                      Añadir regla común
                    </button>
                    <button
                      type="button"
                      className="mi-agent-primary-button"
                      onClick={() => startCoachAdminRuleCreate("channel")}
                      disabled={coachGovernanceSaving}
                    >
                      Añadir regla específica
                    </button>
                  </div>
                </div>
                {coachAdminRuleFeedback ? (
                  <p
                    className={`mi-agent-admin-rule-feedback is-${coachAdminRuleFeedback.kind}`}
                    role={
                      coachAdminRuleFeedback.kind === "error"
                        ? "alert"
                        : "status"
                    }
                  >
                    {coachAdminRuleFeedback.message}
                  </p>
                ) : null}
                <div className="mi-agent-admin-rule-groups">
                  {[
                    {
                      key: "common",
                      title: "Comunes a todos los chats",
                      rules: coachAdminRules.filter(
                        (rule) => rule.scope === "common",
                      ),
                    },
                    {
                      key: "coach",
                      title: `Específicas para Coach · ${coachBusinessRulesChannel === "coach" ? getCoachProcessOption(coachBusinessRulesProcess, "coach").label : "todos los tipos de consulta"}`,
                      rules: getVisibleChannelRules("coach"),
                    },
                    {
                      key: "customer_account",
                      title: `Específicas para Cliente existente · ${coachBusinessRulesChannel === "customer_account" ? getCoachProcessOption(coachBusinessRulesProcess, "customer_account").label : "toda la conversación"}`,
                      rules: getVisibleChannelRules("customer_account"),
                    },
                    {
                      key: "prospect",
                      title: `Específicas para Cuenta nueva · ${coachBusinessRulesChannel === "prospect" ? getCoachProcessOption(coachBusinessRulesProcess, "prospect").label : "toda la conversación"}`,
                      rules: getVisibleChannelRules("prospect"),
                    },
                  ].map((group) => (
                    <section
                      className="mi-agent-admin-rule-group"
                      key={group.key}
                    >
                      <h5>{group.title}</h5>
                      {group.rules.length ? (
                        <div className="mi-agent-admin-rule-list">
                          {group.rules.map((rule) => (
                            <article
                              className={`mi-agent-admin-rule${rule.enabled ? "" : " is-disabled"}`}
                              key={rule.id}
                            >
                              <div className="mi-agent-admin-rule-copy">
                                <strong>{rule.title}</strong>
                                {rule.scope === "channel" ? (
                                  <span>
                                    {COACH_RULE_CHANNEL_LABELS[rule.channel]} ·{" "}
                                    {
                                      getCoachProcessOption(
                                        rule.process,
                                        rule.channel,
                                      ).label
                                    }
                                  </span>
                                ) : null}
                                <p>{rule.instruction}</p>
                              </div>
                              <div className="mi-agent-admin-rule-controls">
                                <label className="mi-agent-admin-rule-toggle">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(rule.enabled)}
                                    onChange={() => toggleCoachAdminRule(rule)}
                                    disabled={coachGovernanceSaving}
                                  />
                                  Activa
                                </label>
                                <button
                                  type="button"
                                  className="mi-agent-icon-button"
                                  aria-label={`Editar regla ${rule.title}`}
                                  title="Editar regla"
                                  onClick={() => startCoachAdminRuleEdit(rule)}
                                  disabled={coachGovernanceSaving}
                                >
                                  <Pencil size={15} aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  className="mi-agent-icon-button is-danger"
                                  aria-label={`Eliminar regla ${rule.title}`}
                                  title="Eliminar regla"
                                  onClick={() => deleteCoachAdminRule(rule)}
                                  disabled={coachGovernanceSaving}
                                >
                                  <Trash2 size={15} aria-hidden="true" />
                                </button>
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <p className="mi-agent-admin-rule-empty">
                          {group.key === coachBusinessRulesChannel &&
                          coachBusinessRulesProcess !== "default"
                            ? `No hay reglas específicas para ${getCoachProcessOption(coachBusinessRulesProcess, coachBusinessRulesChannel).label}; se aplican las reglas predeterminadas del canal.`
                            : "No hay reglas en este ámbito."}
                        </p>
                      )}
                    </section>
                  ))}
                </div>
                {coachAdminRuleDraft ? (
                  <div className="mi-agent-admin-rule-editor">
                    <div className="mi-agent-admin-rule-editor-heading">
                      <h5>
                        {coachAdminRuleEditingId
                          ? "Editar regla"
                          : "Nueva regla"}
                      </h5>
                      <span>
                        {coachAdminRuleDraft.scope === "common"
                          ? "Común a todos los chats"
                          : `${COACH_RULE_CHANNEL_LABELS[coachAdminRuleDraft.channel]} · ${getCoachProcessOption(coachAdminRuleDraft.process, coachAdminRuleDraft.channel).label}`}
                      </span>
                    </div>
                    <label>
                      Nombre
                      <input
                        value={coachAdminRuleDraft.title}
                        maxLength={180}
                        onChange={(event) =>
                          setCoachAdminRuleDraft((current) => ({
                            ...current,
                            title: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      Instrucción
                      <textarea
                        rows={4}
                        value={coachAdminRuleDraft.instruction}
                        maxLength={5000}
                        onChange={(event) =>
                          setCoachAdminRuleDraft((current) => ({
                            ...current,
                            instruction: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="mi-agent-admin-rule-order">
                      Orden
                      <input
                        type="number"
                        min={-1000}
                        max={1000}
                        value={coachAdminRuleDraft.sortOrder}
                        onChange={(event) =>
                          setCoachAdminRuleDraft((current) => ({
                            ...current,
                            sortOrder: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <div className="mi-agent-workspace-actions">
                      <button
                        type="button"
                        className="mi-agent-primary-button"
                        onClick={saveCoachAdminRule}
                        disabled={
                          coachGovernanceSaving ||
                          !coachAdminRuleDraft.title.trim() ||
                          !coachAdminRuleDraft.instruction.trim()
                        }
                      >
                        {coachGovernanceSaving
                          ? "Guardando..."
                          : "Guardar regla"}
                      </button>
                      <button
                        type="button"
                        className="mi-agent-secondary-button"
                        onClick={() => {
                          setCoachAdminRuleDraft(null);
                          setCoachAdminRuleEditingId(null);
                        }}
                        disabled={coachGovernanceSaving}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : null}
              </section>

              <section
                className="mi-agent-domain-policy"
                aria-labelledby="mi-agent-channel-policy-title"
              >
                <div className="mi-agent-domain-policy-heading">
                  <div>
                    <h4 id="mi-agent-channel-policy-title">
                      Políticas del canal y contexto
                    </h4>
                    <p>
                      Delimita qué datos puede consultar cada canal y qué
                      operaciones puede proponer. Los permisos del usuario
                      siempre se validan por separado.
                    </p>
                  </div>
                </div>

                <div className="mi-agent-governance-grid">
                  <label>
                    Canal
                    <select
                      value={coachBusinessRulesChannel}
                      onChange={(event) => {
                        const channel = event.target.value;
                        setCoachBusinessRulesChannel(channel);
                        setCoachBusinessRulesProcess("default");
                        loadCoachAdminRules("all", "default");
                        loadCoachBusinessRulesForScope(channel, "default");
                      }}
                    >
                      <option value="coach">Coach</option>
                      <option value="customer_account">Cuenta existente</option>
                      <option value="prospect">Prospección</option>
                    </select>
                  </label>
                  <label>
                    Tipo de consulta
                    <select
                      value={coachBusinessRulesProcess}
                      onChange={(event) => {
                        const process = event.target.value;
                        setCoachBusinessRulesProcess(process);
                        loadCoachAdminRules("all", process);
                        loadCoachBusinessRulesForScope(
                          coachBusinessRulesChannel,
                          process,
                        );
                      }}
                    >
                      <option value="default">
                        Configuración predeterminada del canal
                      </option>
                      {coachBusinessRulesChannel === "coach"
                        ? COACH_INTENT_PROCESS_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))
                        : [
                            coachBusinessRulesChannel === "prospect"
                              ? "prospect_chat"
                              : "account_chat",
                          ].map((process) => (
                            <option key={process} value={process}>
                              {
                                getCoachProcessOption(
                                  process,
                                  coachBusinessRulesChannel,
                                ).label
                              }
                            </option>
                          ))}
                    </select>
                    <small className="mi-agent-scope-help">
                      {selectedCoachProcessOption.description}
                    </small>
                  </label>
                </div>

                <p className="mi-agent-scope-explainer">
                  La selección de tipo de consulta solo determina a qué
                  solicitudes aplican estos ajustes. No selecciona una etapa
                  comercial ni cambia los controles globales del pipeline.
                </p>

                <section className="mi-agent-domain-policy-subsection">
                  <div>
                    <span className="mi-agent-section-label">
                      {COACH_RULE_CHANNEL_LABELS[coachBusinessRulesChannel]}
                    </span>
                    <div className="mi-agent-admin-scope-status">
                      <strong>
                        Configuración para:{" "}
                        {COACH_RULE_CHANNEL_LABELS[coachBusinessRulesChannel]} ·{" "}
                        {selectedCoachProcessOption.label}
                      </strong>
                      <span>{coachBusinessRulesSourceLabel}</span>
                    </div>
                    <h4>Alcance por dominio y operaciones</h4>
                    <p>
                      Estos controles pueden reducir lo que consulta o propone
                      el chat. Los permisos efectivos y los límites obligatorios
                      del canal siguen siendo validados por el servidor.
                    </p>
                  </div>
                  <div className="mi-agent-domain-policy-groups">
                    <fieldset className="mi-agent-domain-stage-group">
                      <legend>Dominios disponibles para consulta</legend>
                      {[
                        ["accountSearchAllowed", "Cuentas"],
                        ["contactSearchAllowed", "Contactos"],
                        ["leadSearchAllowed", "Leads"],
                        [
                          "opportunitySearchAllowed",
                          "Oportunidades y pipeline",
                        ],
                        ["quotationSearchAllowed", "Cotizaciones"],
                      ].map(([field, label]) => {
                        const channelForbidsDomain =
                          coachBusinessRulesChannel === "prospect" &&
                          [
                            "contactSearchAllowed",
                            "leadSearchAllowed",
                            "opportunitySearchAllowed",
                            "quotationSearchAllowed",
                          ].includes(field);
                        return (
                          <label key={field}>
                            <input
                              type="checkbox"
                              checked={
                                selectedCoachBusinessRules.scope?.[field] !==
                                false
                              }
                              disabled={channelForbidsDomain}
                              onChange={(event) =>
                                updateCoachBusinessRuleField(
                                  "scope",
                                  field,
                                  event.target.checked,
                                )
                              }
                            />
                            {label}
                            {channelForbidsDomain
                              ? " · no disponible en este canal"
                              : ""}
                          </label>
                        );
                      })}
                    </fieldset>
                    <fieldset className="mi-agent-domain-stage-group">
                      <legend>Operaciones que este canal puede proponer</legend>
                      {(
                        COACH_OPERATION_OPTIONS[coachBusinessRulesChannel] || []
                      ).map(([kind, label]) => (
                        <label key={kind}>
                          <input
                            type="checkbox"
                            checked={(
                              selectedCoachBusinessRules.operationPolicy
                                ?.allowedKinds || []
                            ).includes(kind)}
                            onChange={(event) =>
                              updateCoachOperationKind(
                                kind,
                                event.target.checked,
                              )
                            }
                          />
                          {label}
                        </label>
                      ))}
                    </fieldset>
                  </div>
                  <div className="mi-agent-workspace-actions">
                    <button
                      type="button"
                      className="mi-agent-primary-button"
                      onClick={saveCoachBusinessRules}
                      disabled={coachGovernanceSaving}
                    >
                      Guardar políticas del canal
                    </button>
                  </div>
                </section>
              </section>

              <section
                className="mi-agent-governance-settings"
                aria-labelledby="mi-agent-governance-settings-title"
              >
                <div className="mi-agent-domain-policy-heading">
                  <div>
                    <h4 id="mi-agent-governance-settings-title">
                      Configuración de gobierno
                    </h4>
                    <p>
                      Ajusta límites globales y banderas generales que aplican
                      al uso del asistente en toda la organización.
                    </p>
                  </div>
                </div>
                <section className="mi-agent-pipeline-governance">
                  <div>
                    <span className="mi-agent-section-label">
                      Configuración global
                    </span>
                    <h4>Etapas del pipeline calificado y comprometido</h4>
                    <p>
                      Elige qué etapas se incluyen en cada indicador. Esto se
                      aplica a toda la organización, no al canal ni al tipo de
                      consulta seleccionado. Una oportunidad abierta se define
                      por estar activada y En proceso; esta selección no cambia
                      esa regla.
                    </p>
                  </div>
                  <div className="mi-agent-domain-policy-groups">
                    {[
                      {
                        key: "qualifiedOpportunityStageCodes",
                        title: "Etapas que cuentan en el pipeline calificado",
                        selected:
                          coachGovernance.settings
                            .qualifiedOpportunityStageCodes || [],
                      },
                      {
                        key: "committedOpportunityStageCodes",
                        title: "Etapas que cuentan en el monto comprometido",
                        selected:
                          coachGovernance.settings
                            .committedOpportunityStageCodes || [],
                      },
                    ].map((group) => (
                      <fieldset
                        className="mi-agent-domain-stage-group"
                        key={group.key}
                      >
                        <legend>{group.title}</legend>
                        {COACH_OPPORTUNITY_STAGE_OPTIONS.map((stage) => {
                          const isQualified = (
                            coachGovernance.settings
                              .qualifiedOpportunityStageCodes || []
                          ).includes(stage.code);
                          return (
                            <label key={`${group.key}-${stage.code}`}>
                              <input
                                type="checkbox"
                                checked={group.selected.includes(stage.code)}
                                disabled={
                                  (group.key ===
                                    "committedOpportunityStageCodes" &&
                                    !isQualified) ||
                                  (group.selected.length === 1 &&
                                    group.selected.includes(stage.code))
                                }
                                onChange={(event) =>
                                  updateOpportunityStageSet(
                                    group.key,
                                    stage.code,
                                    event.target.checked,
                                  )
                                }
                              />
                              {stage.label}
                            </label>
                          );
                        })}
                      </fieldset>
                    ))}
                  </div>
                  <p className="mi-agent-scope-help">
                    Se guarda con el botón «Guardar configuración» de esta
                    sección.
                  </p>
                </section>
                <div className="mi-agent-governance-grid">
                  <label>
                    Fuentes externas habilitadas
                    <input
                      type="checkbox"
                      checked={Boolean(
                        coachGovernance.settings.externalSourcesEnabled,
                      )}
                      onChange={(event) =>
                        setCoachGovernance((current) => ({
                          ...current,
                          settings: {
                            ...current.settings,
                            externalSourcesEnabled: event.target.checked,
                          },
                        }))
                      }
                    />
                  </label>
                  <label>
                    Conversiones de prospección habilitadas
                    <input
                      type="checkbox"
                      checked={Boolean(
                        coachGovernance.settings.allowProspectConversion,
                      )}
                      onChange={(event) =>
                        setCoachGovernance((current) => ({
                          ...current,
                          settings: {
                            ...current.settings,
                            allowProspectConversion: event.target.checked,
                          },
                        }))
                      }
                    />
                  </label>
                  <label>
                    Incluir oportunidades ganadas
                    <input
                      type="checkbox"
                      checked={Boolean(
                        coachGovernance.settings.includeWonOpportunities,
                      )}
                      onChange={(event) =>
                        setCoachGovernance((current) => ({
                          ...current,
                          settings: {
                            ...current.settings,
                            includeWonOpportunities: event.target.checked,
                          },
                        }))
                      }
                    />
                  </label>
                  <label>
                    Incluir oportunidades perdidas
                    <input
                      type="checkbox"
                      checked={Boolean(
                        coachGovernance.settings.includeLostOpportunities,
                      )}
                      onChange={(event) =>
                        setCoachGovernance((current) => ({
                          ...current,
                          settings: {
                            ...current.settings,
                            includeLostOpportunities: event.target.checked,
                          },
                        }))
                      }
                    />
                  </label>
                  <label>
                    Incluir oportunidades anuladas
                    <input
                      type="checkbox"
                      checked={Boolean(
                        coachGovernance.settings.includeCancelledOpportunities,
                      )}
                      onChange={(event) =>
                        setCoachGovernance((current) => ({
                          ...current,
                          settings: {
                            ...current.settings,
                            includeCancelledOpportunities: event.target.checked,
                          },
                        }))
                      }
                    />
                  </label>
                  <label>
                    Límite diario de investigación por usuario
                    <input
                      type="number"
                      min="1"
                      max="500"
                      value={coachGovernance.settings.dailyResearchLimitPerUser}
                      onChange={(event) =>
                        setCoachGovernance((current) => ({
                          ...current,
                          settings: {
                            ...current.settings,
                            dailyResearchLimitPerUser: Number(
                              event.target.value,
                            ),
                          },
                        }))
                      }
                    />
                  </label>
                  <label>
                    Retención de hallazgos (días)
                    <input
                      type="number"
                      min="30"
                      max="3650"
                      value={coachGovernance.settings.findingRetentionDays}
                      onChange={(event) =>
                        setCoachGovernance((current) => ({
                          ...current,
                          settings: {
                            ...current.settings,
                            findingRetentionDays: Number(event.target.value),
                          },
                        }))
                      }
                    />
                  </label>
                  <label className="mi-agent-governance-wide">
                    Notas
                    <textarea
                      value={coachGovernance.settings.notes || ""}
                      onChange={(event) =>
                        setCoachGovernance((current) => ({
                          ...current,
                          settings: {
                            ...current.settings,
                            notes: event.target.value,
                          },
                        }))
                      }
                    />
                  </label>
                </div>
                <div className="mi-agent-workspace-actions">
                  <button
                    type="button"
                    className="mi-agent-primary-button"
                    onClick={saveCoachGovernance}
                    disabled={coachGovernanceSaving}
                  >
                    {coachGovernanceSaving
                      ? "Guardando..."
                      : "Guardar configuración"}
                  </button>
                </div>
              </section>

              <section
                className="mi-agent-governance-metrics-section"
                aria-labelledby="mi-agent-governance-metrics-title"
              >
                <h4 id="mi-agent-governance-metrics-title">
                  Calidad y métricas
                </h4>
                <p>
                  Revisa desempeño, regresiones y volumen de uso para monitorear
                  la calidad operativa del asistente.
                </p>
                <section className="mi-agent-governance-metrics">
                  <h4>Evaluación del planificador</h4>
                  <div className="mi-agent-governance-grid">
                    {(coachQualityDashboard?.plannerMetrics || []).map(
                      (metrics) => (
                        <article
                          className="mi-agent-governance-rollout"
                          key={`planner-rollout-${metrics.mode}-${metrics.cohort}`}
                        >
                          <strong>Planificador · Cliente existente</strong>
                          <span>
                            Planner disponible {metrics.planAvailableTurns}/
                            {metrics.turns} turnos · filtros explícitos medios{" "}
                            {metrics.averagePlannerFilterCount ?? "Sin muestra"}
                            · referencias medias{" "}
                            {metrics.averagePlannerEntityReferenceCount ??
                              "Sin muestra"}
                          </span>
                          <span>
                            Herramientas observadas{" "}
                            {metrics.plannedToolObservationRate == null
                              ? "Sin muestra"
                              : `${Math.round(metrics.plannedToolObservationRate * 100)}%`}
                            · con evidencia{" "}
                            {metrics.plannedToolEvidenceRate == null
                              ? "Sin muestra"
                              : `${Math.round(metrics.plannedToolEvidenceRate * 100)}%`}
                            · aclaraciones del planner{" "}
                            {Math.round(metrics.plannerClarificationRate * 100)}
                            % · visibles{" "}
                            {Math.round(metrics.visibleClarificationRate * 100)}
                            %
                            {metrics.incorrectClarificationRate == null
                              ? " · feedback negativo de aclaración sin muestra"
                              : ` · feedback negativo visible ${Math.round(metrics.incorrectClarificationRate * 100)}%`}
                          </span>
                          <span>
                            Fallback genérico{" "}
                            {Math.round(metrics.genericFallbackRate * 100)}% ·
                            errores de recuperación{" "}
                            {Math.round(metrics.retrievalErrorRate * 100)}% ·
                            truncamiento{" "}
                            {Math.round(metrics.truncationRate * 100)}%
                          </span>
                          <span>
                            Latencia media {metrics.averageLatencyMs} ms · costo
                            medio por turno{" "}
                            {metrics.averageCostMicros == null
                              ? "Sin dato"
                              : `USD ${(metrics.averageCostMicros / 1000000).toFixed(4)}`}
                            · correcciones{" "}
                            {metrics.correctionByFeedbackRate == null
                              ? "Sin feedback"
                              : `${Math.round(metrics.correctionByFeedbackRate * 100)}%`}
                          </span>
                        </article>
                      ),
                    )}
                  </div>
                </section>
                <section className="mi-agent-governance-metrics">
                  <h4>
                    Calidad del motor ·{" "}
                    {coachQualityDashboard?.periodDays || 30} días
                  </h4>
                  <p>
                    {coachQualityDashboard?.totalTurns || 0} turnos trazados
                  </p>
                  <div className="mi-agent-governance-grid">
                    {(coachQualityDashboard?.channels || []).map((metrics) => (
                      <article
                        className="mi-agent-governance-rollout"
                        key={`quality-${metrics.channel}`}
                      >
                        <strong>{metrics.channel}</strong>
                        <span>
                          Aclaraciones{" "}
                          {Math.round(metrics.clarificationRate * 100)}% ·
                          Respuestas inválidas{" "}
                          {Math.round(metrics.invalidResponseRate * 100)}%
                        </span>
                        <span>
                          Intención{" "}
                          {metrics.intentFeedbackCount
                            ? `${Math.round(metrics.intentClassificationAccuracy * 100)}%`
                            : "Sin feedback"}
                          · Entidad{" "}
                          {metrics.entityFeedbackCount
                            ? `${Math.round(metrics.entityResolutionQuality * 100)}%`
                            : "Sin feedback"}
                        </span>
                        <span>
                          Operaciones rechazadas{" "}
                          {metrics.proposedOperations
                            ? `${Math.round(metrics.rejectedOperationRate * 100)}%`
                            : "Sin operaciones"}
                          · Correcciones{" "}
                          {metrics.feedbackCount
                            ? `${Math.round(metrics.correctionByFeedbackRate * 100)}%`
                            : "Sin feedback"}
                        </span>
                      </article>
                    ))}
                  </div>
                  {coachQualityDashboard?.regressions?.length ? (
                    <div className="mi-agent-governance-regressions">
                      <strong>Procesos con señales de regresión</strong>
                      {coachQualityDashboard.regressions
                        .slice(0, 8)
                        .map((item) => (
                          <p key={`${item.channel}-${item.process}`}>
                            {item.channel} · {item.process}
                            {item.caseId ? ` · ${item.caseId}` : ""}: inválidas{" "}
                            {Math.round(item.invalidResponseRate * 100)}%,
                            feedback negativo {item.negativeFeedback},
                            operaciones rechazadas {item.rejectedOperations}
                          </p>
                        ))}
                    </div>
                  ) : null}
                </section>
                <div className="mi-agent-governance-metrics">
                  <h4>Actividad de los últimos 30 días</h4>
                  <p>
                    Jobs:{" "}
                    {coachGovernance.metrics.jobsLast30Days?.reduce(
                      (sum, item) => sum + Number(item.total || 0),
                      0,
                    ) || 0}{" "}
                    · Hallazgos:{" "}
                    {coachGovernance.metrics.findingsLast30Days?.reduce(
                      (sum, item) => sum + Number(item.total || 0),
                      0,
                    ) || 0}{" "}
                    · Sesiones de prospección:{" "}
                    {coachGovernance.metrics.prospectSessionsLast30Days?.reduce(
                      (sum, item) => sum + Number(item.total || 0),
                      0,
                    ) || 0}
                  </p>
                </div>
              </section>

              <details className="mi-agent-admin-rules-advanced">
                <summary>Configuración técnica avanzada del ámbito</summary>
                <p>
                  Edita directamente el contrato JSON de políticas solo para
                  ajustes avanzados del comportamiento del motor.
                </p>
                <label className="mi-agent-governance-wide">
                  Contrato JSON de reglas deterministas
                  <textarea
                    rows={18}
                    spellCheck={false}
                    value={coachBusinessRulesDraft}
                    onChange={(event) =>
                      setCoachBusinessRulesDraft(event.target.value)
                    }
                  />
                </label>
                <div className="mi-agent-workspace-actions">
                  <button
                    type="button"
                    className="mi-agent-primary-button"
                    onClick={saveCoachBusinessRules}
                    disabled={coachGovernanceSaving}
                  >
                    Guardar contrato técnico
                  </button>
                  <button
                    type="button"
                    className="mi-agent-secondary-button"
                    onClick={resetCoachBusinessRules}
                    disabled={coachGovernanceSaving}
                  >
                    Restablecer contrato técnico
                  </button>
                </div>
              </details>
            </>
          ) : !coachGovernanceLoading ? (
            <div className="mi-agent-empty">
              No se pudo cargar el gobierno de Mi Coach.
            </div>
          ) : null}
        </section>
      )}

      {customerContactApplyDraft ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Confirmar contacto público"
        >
          <div className="modal-dialog mi-agent-coach-action-dialog">
            <h3 className="modal-title">Confirmar contacto público</h3>
            <p className="modal-message">
              Revisa la evidencia y confirma si deseas crear este contacto en la
              cuenta.
            </p>
            <div className="mi-agent-coach-action-form">
              {[
                ["firstName", "Nombre"],
                ["lastName", "Apellido"],
                ["positionTitle", "Cargo"],
                ["department", "Departamento"],
                ["email", "Correo corporativo"],
                ["phone", "Teléfono"],
                ["mobile", "Móvil"],
              ].map(([field, label]) => (
                <label key={field}>
                  {label}
                  <input
                    value={customerContactApplyDraft.contactData?.[field] || ""}
                    onChange={(event) =>
                      setCustomerContactApplyDraft((current) => ({
                        ...current,
                        contactData: {
                          ...current.contactData,
                          [field]: event.target.value,
                        },
                      }))
                    }
                  />
                </label>
              ))}
              {coachContacts.length ? (
                <label>
                  Actualizar contacto existente (opcional)
                  <select
                    value={customerContactApplyDraft.contactId}
                    onChange={(event) =>
                      setCustomerContactApplyDraft((current) => ({
                        ...current,
                        contactId: event.target.value,
                      }))
                    }
                  >
                    <option value="">Crear contacto nuevo</option>
                    {coachContacts.map((contact) => (
                      <option key={contact.id} value={contact.id}>
                        {contact.full_name ||
                          `${contact.first_name || ""} ${contact.last_name || ""}`.trim()}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            <div className="modal-buttons">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setCustomerContactApplyDraft(null)}
                disabled={customerContactApplying}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={applyCustomerContact}
                disabled={
                  customerContactApplying ||
                  !customerContactApplyDraft.contactData?.firstName?.trim() ||
                  !customerContactApplyDraft.contactData?.lastName?.trim()
                }
              >
                {customerContactApplying
                  ? "Guardando..."
                  : "Confirmar y guardar contacto"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {customerFindingApplyDraft ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Aplicar hallazgo al CRM"
        >
          <div className="modal-dialog mi-agent-coach-action-dialog">
            <h3 className="modal-title">Aplicar hallazgo al CRM</h3>
            <p className="modal-message">
              El hallazgo fue confirmado. Revisa el valor sugerido antes de
              agregarlo o reemplazar el dato del registro.
            </p>
            <div className="mi-agent-coach-action-form">
              <label>
                Registro
                <select
                  value={customerFindingApplyDraft.target}
                  onChange={(event) => {
                    const target = event.target.value;
                    const firstField =
                      CUSTOMER_FINDING_APPLY_FIELDS[target]?.[0]?.[0] || "";
                    setCustomerFindingApplyDraft((current) => ({
                      ...current,
                      target,
                      field: firstField,
                    }));
                  }}
                >
                  {customerFindingApplyDraft.finding.accountId ? (
                    <option value="account">Cuenta</option>
                  ) : null}
                  {customerFindingApplyDraft.finding.contactId ? (
                    <option value="contact">Contacto</option>
                  ) : null}
                  {customerFindingApplyDraft.finding.opportunityId ? (
                    <option value="opportunity">Oportunidad</option>
                  ) : null}
                </select>
              </label>
              <label>
                Campo
                <select
                  value={customerFindingApplyDraft.field}
                  onChange={(event) =>
                    setCustomerFindingApplyDraft((current) => ({
                      ...current,
                      field: event.target.value,
                    }))
                  }
                >
                  {(
                    CUSTOMER_FINDING_APPLY_FIELDS[
                      customerFindingApplyDraft.target
                    ] || []
                  ).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Valor
                <textarea
                  rows={5}
                  value={customerFindingApplyDraft.value}
                  onChange={(event) =>
                    setCustomerFindingApplyDraft((current) => ({
                      ...current,
                      value: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Tratamiento del valor actual
                <select
                  value={customerFindingApplyDraft.mode}
                  onChange={(event) =>
                    setCustomerFindingApplyDraft((current) => ({
                      ...current,
                      mode: event.target.value,
                    }))
                  }
                >
                  <option value="append">Agregar al valor existente</option>
                  <option value="replace">Reemplazar el valor existente</option>
                </select>
              </label>
            </div>
            <div className="modal-buttons">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setCustomerFindingApplyDraft(null)}
                disabled={customerFindingApplying}
              >
                Cerrar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={applyCustomerFinding}
                disabled={
                  customerFindingApplying ||
                  !String(customerFindingApplyDraft.value || "").trim()
                }
              >
                {customerFindingApplying
                  ? "Aplicando..."
                  : "Confirmar aplicación"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {coachActionDraft ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Confirmar próximo paso del Coach"
        >
          <div className="modal-dialog mi-agent-coach-action-dialog">
            <h3 className="modal-title">Confirmar cambio comercial</h3>
            <p className="modal-message">
              Revisa y edita la propuesta antes de guardarla en la oportunidad.
            </p>
            <div className="mi-agent-coach-action-form">
              <label>
                Oportunidad
                <select
                  value={coachActionDraft.opportunityId}
                  onChange={(event) =>
                    setCoachActionDraft((current) => ({
                      ...current,
                      opportunityId: event.target.value,
                      contextSnapshot:
                        snapshot.pipeline.opportunities.find(
                          (item) =>
                            Number(item.id) === Number(event.target.value),
                        ) || null,
                    }))
                  }
                >
                  <option value="">Selecciona una oportunidad</option>
                  {snapshot.pipeline.opportunities.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.accountName || "Sin cuenta"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Tipo de registro
                <select
                  value={coachActionDraft.actionType}
                  onChange={(event) =>
                    setCoachActionDraft((current) => ({
                      ...current,
                      actionType: event.target.value,
                    }))
                  }
                >
                  <option value="next_step">Próximo paso</option>
                  <option value="follow_up">Seguimiento</option>
                  <option value="call">Llamada</option>
                  <option value="meeting">Reunión</option>
                  <option value="demo">Demostración</option>
                  <option value="quotation">Cotización</option>
                  <option value="negotiation">Negociación</option>
                  <option value="other">Otra actividad</option>
                </select>
              </label>
              <label>
                Título
                <input
                  value={coachActionDraft.title}
                  onChange={(event) =>
                    setCoachActionDraft((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Estado
                <select
                  value={coachActionDraft.status}
                  onChange={(event) =>
                    setCoachActionDraft((current) => ({
                      ...current,
                      status: event.target.value,
                    }))
                  }
                >
                  <option value="pending">Pendiente</option>
                  <option value="in_progress">En progreso</option>
                  <option value="blocked">Bloqueado</option>
                  <option value="done">Realizado</option>
                </select>
              </label>
              <label>
                Fecha límite
                <input
                  type="date"
                  value={coachActionDraft.dueDate}
                  onChange={(event) =>
                    setCoachActionDraft((current) => ({
                      ...current,
                      dueDate: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Fecha y hora programada
                <input
                  type="datetime-local"
                  value={coachActionDraft.scheduledAt}
                  onChange={(event) =>
                    setCoachActionDraft((current) => ({
                      ...current,
                      scheduledAt: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Prioridad
                <select
                  value={coachActionDraft.priority}
                  onChange={(event) =>
                    setCoachActionDraft((current) => ({
                      ...current,
                      priority: event.target.value,
                    }))
                  }
                >
                  <option value="critical">Crítica</option>
                  <option value="low">Baja</option>
                  <option value="medium">Media</option>
                  <option value="high">Alta</option>
                </select>
              </label>
              <label>
                Criterio de éxito
                <textarea
                  rows={2}
                  value={coachActionDraft.successCriteria}
                  onChange={(event) =>
                    setCoachActionDraft((current) => ({
                      ...current,
                      successCriteria: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Notas
                <textarea
                  rows={2}
                  value={coachActionDraft.notes}
                  onChange={(event) =>
                    setCoachActionDraft((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <div className="modal-buttons">
              <button
                type="button"
                className="btn-secondary"
                onClick={rejectCoachAction}
                disabled={Boolean(creatingActionRank)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={createNextStep}
                disabled={
                  Boolean(creatingActionRank) || !coachActionDraft.title.trim()
                }
              >
                {creatingActionRank
                  ? "Preparando..."
                  : "Continuar en Desarrollo Comercial"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {coachOperationDraft ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Confirmar cambio del Coach"
        >
          <div
            ref={coachDialogRef}
            tabIndex={-1}
            className="modal-dialog mi-agent-coach-action-dialog"
            style={{
              width: "min(820px, calc(100vw - 32px))",
              maxWidth: 820,
              padding: 20,
            }}
          >
            <h3 className="modal-title">
              {coachDraftMissingFields.length
                ? "Completar operación"
                : coachOperationDraft.persistenceStatus === "failed"
                  ? "Corregir operación"
                  : "Confirmar cambio"}
            </h3>
            <p className="modal-message">
              {coachDraftMissingFields.length
                ? "Completa los datos obligatorios antes de continuar al módulo."
                : "Revisa el valor propuesto antes de actualizar el CRM."}
            </p>
            {coachDraftMissingFields.length ? (
              <div
                className="mi-agent-coach-missing-summary"
                role="status"
                aria-live="polite"
              >
                <AlertCircle size={16} aria-hidden="true" />
                <div>
                  <strong>
                    {coachDraftMissingFields.length} campos pendientes
                  </strong>
                  <span>
                    {coachDraftMissingFields
                      .map(formatCoachFieldLabel)
                      .join(", ")}
                  </span>
                </div>
              </div>
            ) : null}
            <div className="mi-agent-coach-action-form">
              <label>
                Operación
                <input
                  value={
                    coachOperationDraft.operation.title ||
                    coachOperationDraft.operation.kind
                  }
                  disabled
                />
              </label>
              {[
                "create_account",
                "create_contact",
                "create_opportunity",
                "create_lead",
                "create_contact_mapping",
                "create_quotation",
                "create_proposal",
                "lead_resolve",
              ].includes(coachOperationDraft.operation.kind) ? (
                <div className="mi-agent-coach-action-form">
                  {(coachOperationDraft.operation.kind === "create_account"
                    ? [
                        "name",
                        "registrationCode",
                        "phone",
                        "website",
                        "city",
                        "stateRegion",
                        "postalCode",
                        "companyDescription",
                      ]
                    : coachOperationDraft.operation.kind === "create_contact"
                      ? [
                          "firstName",
                          "lastName",
                          "email",
                          "phone",
                          "mobile",
                          "positionTitle",
                          "department",
                          "city",
                          "stateRegion",
                        ]
                      : coachOperationDraft.operation.kind ===
                          "create_contact_mapping"
                        ? [
                            "accountId",
                            "firstName",
                            "lastName",
                            "email",
                            "phone",
                            "mobile",
                            "positionTitle",
                            "department",
                            "city",
                            "stateRegion",
                          ]
                        : coachOperationDraft.operation.kind === "create_lead"
                          ? ["title", "leadSource", "summary", "sourceNotes"]
                          : coachOperationDraft.operation.kind ===
                              "create_opportunity"
                            ? ["name", "amountUsd", "closeDate", "summary"]
                            : coachOperationDraft.operation.kind ===
                                "create_quotation"
                              ? [
                                  "proposalName",
                                  "quotationDate",
                                  "introduction",
                                  "paymentTerms",
                                ]
                              : coachOperationDraft.operation.kind ===
                                  "create_proposal"
                                ? [
                                    "quotationVersionId",
                                    "sourceProposalId",
                                    "templateId",
                                  ]
                                : ["summary", "sourceNotes"]
                  ).map((field) => (
                    <label key={field}>
                      {field}
                      {field === "companyDescription" ||
                      field === "summary" ||
                      field === "sourceNotes" ? (
                        <textarea
                          rows={3}
                          value={coachOperationDraft.payload?.[field] || ""}
                          aria-invalid={coachDraftMissingSet.has(field)}
                          onChange={(event) =>
                            updateCoachPayloadField(field, event.target.value)
                          }
                        />
                      ) : (
                        <input
                          type={
                            field === "amountUsd"
                              ? "number"
                              : field === "closeDate"
                                ? "date"
                                : "text"
                          }
                          value={coachOperationDraft.payload?.[field] ?? ""}
                          aria-invalid={coachDraftMissingSet.has(field)}
                          onChange={(event) =>
                            updateCoachPayloadField(field, event.target.value)
                          }
                        />
                      )}
                      {coachDraftMissingSet.has(field) ? (
                        <small className="mi-agent-coach-field-error">
                          Este campo es obligatorio para continuar.
                        </small>
                      ) : null}
                    </label>
                  ))}
                  {coachOperationDraft.error ? (
                    <p className="form-error">{coachOperationDraft.error}</p>
                  ) : null}
                  {coachOperationDraft.duplicateWarnings?.length ? (
                    <div className="mi-agent-coach-duplicate-warning">
                      <strong>
                        Revisa posibles duplicados antes de crear:
                      </strong>
                      <ul>
                        {coachOperationDraft.duplicateWarnings.map(
                          (warning, index) => (
                            <li
                              key={`${warning.matchReason || "duplicate"}-${index}`}
                            >
                              {warning.reasonLabel ||
                                warning.message ||
                                warning.severityMessage ||
                                "Coincidencia detectada"}
                            </li>
                          ),
                        )}
                      </ul>
                      <small>
                        Si ya existe, cancela esta propuesta y selecciona el
                        registro existente desde el contexto del Coach.
                      </small>
                    </div>
                  ) : null}
                </div>
              ) : coachOperationDraft.operation.kind === "activity" ? (
                <div
                  className="mi-agent-coach-action-form"
                  style={{
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: 10,
                  }}
                >
                  <label>
                    Oportunidad
                    <select
                      value={coachOperationDraft.opportunityId}
                      aria-invalid={coachDraftMissingSet.has("opportunityId")}
                      onChange={(event) =>
                        setCoachOperationDraft((current) => ({
                          ...current,
                          opportunityId: event.target.value,
                        }))
                      }
                    >
                      <option value="">Selecciona una oportunidad</option>
                      {(
                        coachOperationOpportunityOptionsOverride ||
                        snapshot.pipeline.opportunities
                      ).map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · {item.accountName || "Sin cuenta"}
                        </option>
                      ))}
                    </select>
                    {coachDraftMissingSet.has("opportunityId") ? (
                      <small className="mi-agent-coach-field-error">
                        Selecciona una oportunidad para continuar.
                      </small>
                    ) : null}
                  </label>
                  {[
                    ["title", "Título"],
                    ["actionType", "Tipo"],
                    ["scheduledAt", "Fecha y hora"],
                    ["dueDate", "Fecha límite"],
                    ["priority", "Prioridad"],
                    ["notes", "Notas"],
                    ["successCriteria", "Criterio de éxito"],
                  ].map(([field, label]) => (
                    <label key={field}>
                      {label}
                      {field === "actionType" ? (
                        <select
                          value={normalizeCoachActivityType(
                            coachOperationDraft.operation[field],
                          )}
                          aria-invalid={coachDraftMissingSet.has(field)}
                          onChange={(event) =>
                            setCoachOperationDraft((current) => ({
                              ...current,
                              operation: {
                                ...current.operation,
                                [field]: event.target.value,
                              },
                            }))
                          }
                        >
                          {COACH_ACTIVITY_TYPE_OPTIONS.map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      ) : field === "priority" ? (
                        <select
                          value={
                            coachOperationDraft.operation[field] || "medium"
                          }
                          aria-invalid={coachDraftMissingSet.has(field)}
                          onChange={(event) =>
                            setCoachOperationDraft((current) => ({
                              ...current,
                              operation: {
                                ...current.operation,
                                [field]: event.target.value,
                              },
                            }))
                          }
                        >
                          <option value="critical">Crítica</option>
                          <option value="high">Alta</option>
                          <option value="medium">Media</option>
                          <option value="low">Baja</option>
                        </select>
                      ) : field === "notes" || field === "successCriteria" ? (
                        <textarea
                          rows={2}
                          value={coachOperationDraft.operation[field] || ""}
                          aria-invalid={coachDraftMissingSet.has(field)}
                          onChange={(event) =>
                            setCoachOperationDraft((current) => ({
                              ...current,
                              operation: {
                                ...current.operation,
                                [field]: event.target.value,
                              },
                            }))
                          }
                        />
                      ) : (
                        <input
                          type={
                            field === "scheduledAt"
                              ? "datetime-local"
                              : field === "dueDate"
                                ? "date"
                                : "text"
                          }
                          value={coachOperationDraft.operation[field] || ""}
                          aria-invalid={coachDraftMissingSet.has(field)}
                          onChange={(event) =>
                            setCoachOperationDraft((current) => ({
                              ...current,
                              operation: {
                                ...current.operation,
                                [field]: event.target.value,
                              },
                            }))
                          }
                        />
                      )}
                      {coachDraftMissingSet.has(field) ? (
                        <small className="mi-agent-coach-field-error">
                          Este campo es obligatorio para continuar.
                        </small>
                      ) : null}
                    </label>
                  ))}
                </div>
              ) : coachOperationDraft.operation.kind === "stage_answer" ||
                coachOperationDraft.operation.kind === "lead_call_outcome" ? (
                <label>
                  {coachOperationDraft.operation.kind === "stage_answer"
                    ? "Respuesta de etapa"
                    : "Comentario del resultado"}
                  <textarea
                    rows={4}
                    value={coachOperationDraft.value}
                    aria-invalid={coachDraftMissingSet.has(
                      coachOperationDraft.operation.kind === "stage_answer"
                        ? "answerValue"
                        : "comment",
                    )}
                    onChange={(event) =>
                      setCoachOperationDraft((current) => ({
                        ...current,
                        value: event.target.value,
                      }))
                    }
                  />
                  {coachDraftMissingSet.has(
                    coachOperationDraft.operation.kind === "stage_answer"
                      ? "answerValue"
                      : "comment",
                  ) ? (
                    <small className="mi-agent-coach-field-error">
                      Este campo es obligatorio para continuar.
                    </small>
                  ) : null}
                </label>
              ) : (
                <div className="mi-agent-coach-action-form">
                  {coachOperationDraft.operation.field ? (
                    <>
                      <label>
                        Campo a actualizar
                        <input
                          value={formatCoachFieldLabel(
                            coachOperationDraft.operation.field,
                          )}
                          disabled
                        />
                      </label>
                      <label>
                        Valor actual
                        <input
                          value={
                            coachOperationDraft.operation.currentValue ??
                            "Sin valor"
                          }
                          disabled
                        />
                      </label>
                    </>
                  ) : null}
                  <label>
                    Nuevo valor
                    <input
                      value={coachOperationDraft.value}
                      aria-invalid={coachDraftMissingSet.has("value")}
                      onChange={(event) =>
                        setCoachOperationDraft((current) => ({
                          ...current,
                          value: event.target.value,
                        }))
                      }
                    />
                    {coachDraftMissingSet.has("value") ? (
                      <small className="mi-agent-coach-field-error">
                        Este campo es obligatorio para continuar.
                      </small>
                    ) : null}
                  </label>
                </div>
              )}
              {coachOperationDraft.operation.kind === "stage_answer" &&
              coachOperationDraft.operation.previousAnswer ? (
                <label>
                  Tratamiento de la respuesta anterior
                  <select
                    value={coachOperationDraft.answerMode}
                    onChange={(event) =>
                      setCoachOperationDraft((current) => ({
                        ...current,
                        answerMode: event.target.value,
                      }))
                    }
                  >
                    <option value="replace">Reemplazar</option>
                    <option value="append">
                      Agregar a la respuesta anterior
                    </option>
                  </select>
                </label>
              ) : null}
              {coachOperationDraft.error ? (
                <p className="form-error" role="alert">
                  {coachOperationDraft.error}
                </p>
              ) : null}
              <p className="mi-agent-coach-save-state" aria-live="polite">
                {savingCoachOperation || coachDraftSaving
                  ? "Guardando y validando la operación..."
                  : coachDraftMissingFields.length
                    ? "La operación permanecerá pendiente hasta completar los campos indicados."
                    : coachOperationDraft.reviewedAt
                      ? "Valor actual revisado. Confirma para guardar."
                      : "Revisa el valor actual antes de confirmar."}
              </p>
            </div>
            <div className="modal-buttons">
              <button
                type="button"
                className="btn-secondary"
                onClick={() =>
                  rejectCoachOperation(coachOperationDraft.operation)
                }
                disabled={savingCoachOperation || coachDraftSaving}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={applyCoachOperation}
                disabled={
                  savingCoachOperation ||
                  coachDraftSaving ||
                  !canExecuteCoach ||
                  coachDraftMissingFields.length > 0 ||
                  (coachOperationDraft.operation.kind === "activity"
                    ? !String(
                        coachOperationDraft.operation.title || "",
                      ).trim() ||
                      !String(
                        coachOperationDraft.operation.scheduledAt || "",
                      ).trim()
                    : [
                          "create_account",
                          "create_contact",
                          "create_opportunity",
                          "create_lead",
                          "create_contact_mapping",
                          "create_quotation",
                          "create_proposal",
                          "lead_resolve",
                        ].includes(coachOperationDraft.operation.kind)
                      ? !Object.keys(coachOperationDraft.payload || {}).length
                      : !String(coachOperationDraft.value || "").trim())
                }
              >
                {savingCoachOperation
                  ? "Preparando..."
                  : COACH_HANDOFF_OPERATION_KINDS.has(
                        coachOperationDraft.operation.kind,
                      )
                    ? "Continuar en el módulo"
                    : coachOperationDraft.reviewedAt
                      ? "Confirmar y guardar"
                      : "Revisar valor actual"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {analysis?.risks?.length ? (
        <section className="mi-agent-risks">
          <div className="mi-agent-section-heading">
            <div>
              <span className="mi-agent-section-label">Señales a vigilar</span>
              <h3>Riesgos principales</h3>
            </div>
          </div>
          <div className="mi-agent-risk-list">
            {analysis.risks.map((risk) => (
              <div key={risk}>!</div>
            ))}
          </div>
          <ul>
            {analysis.risks.map((risk) => (
              <li key={risk}>{risk}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
