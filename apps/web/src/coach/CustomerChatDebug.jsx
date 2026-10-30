import { useState } from "react";
import { Copy } from "lucide-react";
import { validateCustomerChatObservedFlow } from "../customer-chat-trace-validation";

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
  B12: {
    purpose: "Recupera fragmentos documentales solo para preguntas pertinentes.",
    check: "Estado y cantidad recuperada; nunca muestra el texto ni IDs documentales.",
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
  results: "Fragmentos recuperados",
  not_applicable: "No aplica",
  not_configured: "Pinecone no configurado",
  no_documents: "Sin documentos activos",
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
    case "B12":
      return {
        input: input.requested
          ? "B5 solicitó conocimiento documental para esta intención."
          : "La intención no requiere consultar documentos.",
        output: `Recuperación ${CUSTOMER_CHAT_DEBUG_STATUS_LABELS[output.status] || output.status || "no alcanzada"}; ${output.snippetsCount || 0} fragmentos. El contenido documental no se expone en este diagnóstico.`,
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
  "B12",
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

function buildCustomerChatObservedFlowExport(debug, transportTrace) {
  const exchanges = Array.isArray(transportTrace?.exchanges)
    ? transportTrace.exchanges
    : [];
  return {
    schemaVersion: "customer-chat-observed-flow.v1",
    jobId: Number(debug?.currentTurn?.jobId || 0) || null,
    chatSessionId: Number(debug?.currentTurn?.chatSessionId || 0) || null,
    serverTrace: debug || null,
    browserTrace: {
      available: Array.isArray(transportTrace?.exchanges),
      source: transportTrace?.source || null,
      exchanges,
    },
  };
}

export function CustomerChatDetailedTrace({ debug, transportTrace }) {
  const [copyStatus, setCopyStatus] = useState("");
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
  const copyObservedFlow = async () => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API no disponible");
      }
      await navigator.clipboard.writeText(
        JSON.stringify(
          buildCustomerChatObservedFlowExport(turnDebug, transportTrace),
          null,
          2,
        ),
      );
      setCopyStatus("Flujo copiado");
    } catch {
      setCopyStatus("No se pudo copiar el flujo");
    }
  };

  return (
    <details className="mi-agent-customer-chat-detailed-trace">
      <summary>
        Flujo observado · {workerSpanCount} llamadas del worker ·{" "}
        {exchanges.length} intercambios del navegador
      </summary>
      <div className="mi-agent-customer-chat-detailed-trace-content">
        <div className="mi-agent-customer-chat-flow-copy">
          <button
            type="button"
            className="btn-secondary"
            aria-label="Copiar flujo del job"
            title="Copiar flujo del job"
            onClick={copyObservedFlow}
          >
            <Copy size={14} aria-hidden="true" />
          </button>
          <span role="status" aria-live="polite">
            {copyStatus}
          </span>
        </div>
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
          <h4>Worker · B2 → B12</h4>
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

export function CustomerChatDebugResult({ debug }) {
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

export function CustomerChatDebugFlow({ debug, transportTrace }) {
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

          <section className="mi-agent-customer-chat-debug-subflow">
            <h4>Conocimiento documental: B5 o el contrato de B4 consulta B12</h4>
            {renderStep("B12")}
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
