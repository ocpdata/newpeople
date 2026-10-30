import { useEffect, useRef, useState } from "react";
import { api, getApiErrorMessage } from "../api";

const CUSTOMER_CHAT_FOUNDATION_VISIBILITY_KEY =
  "mi-agent-customer-chat-show-foundation";
const customerChatSessionKey = (accountId) =>
  `mi-agent-customer-chat-session:${Number(accountId || 0)}`;
const customerChatPendingKey = (accountId) =>
  `mi-agent-customer-chat-pending:${Number(accountId || 0)}`;

export function useCustomerChat({
  activeWorkspace,
  customerAccountId,
  hasCustomerContext,
  buildCustomerIntelligencePayload,
  customerFocusOptions,
  customerFocusOpportunityId,
  setCustomerIntelligenceError,
}) {
  const [customerChatTransportError, setCustomerChatTransportError] =
    useState(null);
  const [customerChatFailureIds, setCustomerChatFailureIds] = useState(null);
  const [customerChatQuestion, setCustomerChatQuestion] = useState("");
  const [customerChatAttachment, setCustomerChatAttachment] = useState(null);
  const [customerChatMessages, setCustomerChatMessages] = useState([]);
  const [customerChatLoading, setCustomerChatLoading] = useState(false);
  const [customerChatTurn, setCustomerChatTurn] = useState(null);
  const customerChatTurnBlocking = Boolean(customerChatTurn && customerChatTurn.status !== "failed");
  const customerChatRevisionRef = useRef(0);
  const customerChatRequestRef = useRef(null);
  const customerChatThreadRef = useRef(null);
  const [customerChatSessionId, setCustomerChatSessionId] = useState(null);
  const [customerChatSessionLoading, setCustomerChatSessionLoading] =
    useState(false);
  const [customerChatHistoryReload, setCustomerChatHistoryReload] = useState(0);
  const [showCustomerChatFoundation, setShowCustomerChatFoundation] = useState(
    () =>
      window.localStorage.getItem(CUSTOMER_CHAT_FOUNDATION_VISIBILITY_KEY) ===
      "true",
  );
  const [customerChatPublicResearch, setCustomerChatPublicResearch] =
    useState(false);

  useEffect(() => {
    if (customerChatThreadRef.current) {
      customerChatThreadRef.current.scrollTop = customerChatThreadRef.current.scrollHeight;
    }
  }, [customerChatMessages, customerChatTurn?.status, customerChatTurn?.error, activeWorkspace]);

  useEffect(() => {
    const revision = ++customerChatRevisionRef.current;
    let cancelled = false;
    const cleanup = () => {
      cancelled = true;
      customerChatRevisionRef.current += 1;
      customerChatRequestRef.current = null;
    };
    customerChatRequestRef.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCustomerChatLoading(false);
    setCustomerChatTurn(null);
    const accountId = Number(customerAccountId || 0);
    if (!accountId || !hasCustomerContext) {
      setCustomerChatSessionId(null);
      setCustomerChatMessages([]);
      setCustomerChatSessionLoading(false);
      return cleanup;
    }
    const storageKey = customerChatSessionKey(accountId);
    const storedSessionId = Number(
      window.sessionStorage.getItem(storageKey) || 0,
    );
    if (!storedSessionId) {
      setCustomerChatSessionId(null);
      setCustomerChatMessages([]);
      setCustomerChatSessionLoading(false);
      return cleanup;
    }
    setCustomerChatSessionId(storedSessionId);
    setCustomerChatSessionLoading(true);
    api
      .get(
        `/api/commercial-intelligence/account-chat/sessions/${storedSessionId}`,
      )
      .then((response) => {
        if (cancelled || revision !== customerChatRevisionRef.current) return;
        const session = response.data?.session;
        if (Number(session?.accountId || 0) !== accountId) {
          throw new Error("La sesion no corresponde a la cuenta actual");
        }
        setCustomerChatMessages(
          (Array.isArray(session.history) ? session.history : []).map(
            (message) =>
              message.role === "user"
                ? {
                    role: "seller",
                    text: message.text,
                    attachmentName: message.attachmentName || null,
                  }
                : {
                    role: "assistant",
                    answer: message.text,
                    presentation: message.presentation || null,
                    dossierCitations: message.dossierCitations || [],
                    opportunityOptions: message.opportunityOptions || [],
                    activityHistory: message.activityHistory || null,
                    operations: message.operations || [],
                    stageAnswerPrefill: message.stageAnswerPrefill || null,
                    components: message.components || [],
                    contentSource: message.contentSource || null,
                    documentCoverage: message.documentCoverage || null,
                    documentSources: message.documentSources || [],
                    documentEvidence: message.documentEvidence || [],
                    priorityMetadata: message.priorityMetadata || null,
                    priorityEvidence: message.priorityEvidence || [],
                    comparisonMetadata: message.comparisonMetadata || null,
                    comparisonEvidence: message.comparisonEvidence || [],
                    trendMetadata: message.trendMetadata || null,
                    scenarioMetadata: message.scenarioMetadata || null,
                    scenarioEvidence: message.scenarioEvidence || [],
                    documentReportMetadata: message.documentReportMetadata || [],
                    creationMetadata: message.creationMetadata || null,
                    updateMetadata: message.updateMetadata || null,
                    linkMetadata: message.linkMetadata || null,
                    rescheduleMetadata: message.rescheduleMetadata || null,
                    outcomeMetadata: message.outcomeMetadata || null,
                    stageMetadata: message.stageMetadata || null,
                    documentReportEvidence: message.documentReportEvidence || [],
                    trendEvidence: message.trendEvidence || [],
                    debug: message.turnDebug || null,
                    jobId: message.turnDebug?.currentTurn?.jobId || null,
                    sourceDomain: "crm_internal",
                  },
          ),
        );
        const pendingText = window.sessionStorage.getItem(customerChatPendingKey(accountId));
        if (pendingText) {
          const pending = JSON.parse(pendingText);
          if (
            pending.accountId !== accountId ||
            pending.sessionId !== storedSessionId ||
            !Number.isInteger(pending.jobId) || pending.jobId <= 0 ||
            typeof pending.question !== "string"
          ) throw new Error("El turno pendiente no corresponde a esta conversación");
          const completedInHistory = (session.history || []).some((message) =>
            message.role === "assistant" && String(message.text || "").trim() &&
            Number(message.turnDebug?.currentTurn?.jobId) === pending.jobId);
          if (completedInHistory) {
            window.sessionStorage.removeItem(customerChatPendingKey(accountId));
            setCustomerChatTurn(null);
            return;
          }
          setCustomerChatTurn({
            ...pending,
            status: "interrupted",
            error: "Hay una respuesta pendiente de recuperar. No es necesario reenviar la pregunta.",
          });
          const history = session.history || [];
          const last = history[history.length - 1];
          if (last?.role !== "user" || last.text !== pending.question) {
            if (Number(last?.turnDebug?.currentTurn?.jobId) !== pending.jobId) {
              setCustomerChatMessages((current) => [
                ...current, { role: "seller", text: pending.question },
              ]);
            }
          }
        }
      })
      .catch((requestError) => {
        if (cancelled || revision !== customerChatRevisionRef.current) return;
        setCustomerChatTurn({
          status: "history_error",
          error: getApiErrorMessage(requestError, "No se pudo cargar el historial de la conversación"),
        });
      })
      .finally(() => {
        if (!cancelled && revision === customerChatRevisionRef.current)
          setCustomerChatSessionLoading(false);
      });
    return cleanup;
  }, [customerAccountId, hasCustomerContext, customerChatHistoryReload]);

  function reset() {
    customerChatRevisionRef.current += 1;
    customerChatRequestRef.current = null;
    setCustomerChatTurn(null);
    setCustomerChatQuestion("");
    setCustomerChatAttachment(null);
    setCustomerChatMessages([]);
    setCustomerChatLoading(false);
    setCustomerChatSessionId(null);
    setCustomerChatSessionLoading(false);
    setCustomerChatFailureIds(null);
    setCustomerChatPublicResearch(false);
  }

  async function askCustomerChat(question = customerChatQuestion, recovery = null) {
    const normalizedQuestion = String(question || "").trim();
    const selectedAttachment = recovery ? null : customerChatAttachment;
    if (
      !normalizedQuestion || !hasCustomerContext ||
      customerChatRequestRef.current || customerChatSessionLoading ||
      (!recovery && customerChatTurnBlocking)
    ) return;
    const revision = ++customerChatRevisionRef.current;
    customerChatRequestRef.current = revision;
    const isCurrent = () => revision === customerChatRevisionRef.current;
    const accountId = Number(customerAccountId);
    const transportExchanges = [...(recovery?.transportTrace?.exchanges || [])];
    let activeExchange = null;
    let failedJobDebug = null;
    let activeChatSessionId = Number(recovery?.sessionId || customerChatSessionId || 0) || null;
    let activeChatJobId = recovery?.jobId || null;
    let terminalFailure = false;
    const beginExchange = (label, method, path, requestSummary = null) => {
      // eslint-disable-next-line react-hooks/immutability
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
    setCustomerChatTurn({
      accountId, sessionId: activeChatSessionId, jobId: activeChatJobId,
      question: normalizedQuestion, status: "pending", error: "",
    });
    if (!recovery) {
      setCustomerChatMessages((current) => [
        ...current,
        {
          role: "seller",
          text: normalizedQuestion,
          ...(selectedAttachment
            ? { attachmentName: selectedAttachment.name }
            : {}),
        },
      ]);
      setCustomerChatQuestion("");
      setCustomerChatAttachment(null);
    }
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
          customerChatSessionKey(accountId),
          String(activeChatSessionId),
        );
        if (!isCurrent()) return;
        setCustomerChatSessionId(activeChatSessionId);
      } else {
        transportExchanges.push({
          kind: "local",
          label: "Reutilizar sesión existente",
          outcome: "reused",
          responseSummary: { sessionId: activeChatSessionId },
        });
      }
      if (!recovery) {
        const jobPayload = {
          ...buildCustomerIntelligencePayload(),
          chatSessionId: activeChatSessionId,
          question: normalizedQuestion,
          includePublicResearch: customerChatPublicResearch,
          ...(customerFocusOptions.enabled && customerFocusOpportunityId
            ? { focusOpportunityId: Number(customerFocusOpportunityId) }
            : {}),
        };
        let requestBody = jobPayload;
        const requestSummary = { ...jobPayload };
        if (selectedAttachment) {
          const formData = new FormData();
          formData.append("payload", JSON.stringify(jobPayload));
          formData.append("attachment", selectedAttachment);
          requestBody = formData;
          requestSummary.attachment = {
            name: selectedAttachment.name,
            size: selectedAttachment.size,
            type: selectedAttachment.type,
          };
        }
        const submitExchange = beginExchange(
          "Iniciar pregunta",
          "POST",
          "/api/commercial-intelligence/account-chat/jobs",
          requestSummary,
        );
        const response = await api.post(
          "/api/commercial-intelligence/account-chat/jobs",
          requestBody,
          selectedAttachment ? { timeout: 120000 } : undefined,
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
        if (
          isCurrent() ||
          (Number(window.sessionStorage.getItem(customerChatSessionKey(accountId))) === activeChatSessionId &&
            !window.sessionStorage.getItem(customerChatPendingKey(accountId)))
        ) {
          window.sessionStorage.setItem(customerChatPendingKey(accountId), JSON.stringify({
            accountId, sessionId: activeChatSessionId, jobId, question: normalizedQuestion,
          }));
        }
        if (!isCurrent()) return;
        setCustomerChatTurn({
          accountId, sessionId: activeChatSessionId, jobId,
          question: normalizedQuestion, status: "pending", error: "",
        });
      }
      const jobId = activeChatJobId;
      let result = null;
      const pollExchange = beginExchange(
        "Consultar resultado",
        "GET",
        `/api/commercial-intelligence/account-chat/jobs/${jobId}`,
        { jobId },
      );
      let finalPollJob = null;
      let consecutiveFailures = 0;
      const deadline = Date.now() + (selectedAttachment ? 180000 : 60000);
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (!isCurrent()) return;
        if (Date.now() >= deadline) break;
        let jobResponse;
        try {
          jobResponse = await api.get(
            `/api/commercial-intelligence/account-chat/jobs/${jobId}`,
          );
        } catch (requestError) {
          if (!isCurrent()) return;
          const status = Number(requestError.response?.status || 0);
          consecutiveFailures += 1;
          const retryable = !status || [408, 429, 500, 502, 503, 504].includes(status);
          pollExchange.pollCount += 1;
          pollExchange.pollEvents.push({
            attempt: pollExchange.pollCount,
            at: new Date().toISOString(),
            httpStatus: status || null,
            status: "poll_error",
            errorMessage: safeApiErrorMessage(requestError),
          });
          if (!retryable || consecutiveFailures >= 3) throw requestError;
          setCustomerChatTurn((current) => ({
            ...current,
            error: "Se interrumpió la consulta del resultado. Reintentando sin reenviar la pregunta...",
          }));
          await new Promise((resolve) => window.setTimeout(resolve, 1000 * consecutiveFailures));
          continue;
        }
        if (!isCurrent()) return;
        consecutiveFailures = 0;
        setCustomerChatTurn((current) => ({ ...current, error: "" }));
        const job = jobResponse.data?.job;
        if (
          !job || Number(job.id) !== jobId ||
          (job.accountId != null && Number(job.accountId) !== accountId) ||
          !["pending", "running", "completed", "failed"].includes(job.status)
        ) throw new Error("El servidor devolvió un resultado de chat inválido");
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
            terminalFailure = true;
            failedJobDebug = job.result?.debug || null;
            throw new Error(job.errorMessage || "No fue posible responder");
          }
          result = job.result;
          if (!result || typeof result.answer !== "string" || !result.answer.trim()) {
            throw new Error("El turno terminó, pero no se recibió una respuesta válida. Recupera el resultado.");
          }
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
        throw new Error("La respuesta sigue pendiente. Puedes recuperar su estado sin reenviar la pregunta.");
      }
      if (!isCurrent()) return;
      setCustomerChatMessages((current) => {
        const message = {
          role: "assistant",
          ...result,
          jobId,
          transportTrace: {
            source: "browser_observed",
            exchanges: transportExchanges,
          },
        };
        return current.some((item) => item.role === "assistant" && Number(item.jobId) === jobId)
          ? current.map((item) =>
              item.role === "assistant" && Number(item.jobId) === jobId ? message : item,
            )
          : [...current, message];
      });
      window.sessionStorage.removeItem(customerChatPendingKey(accountId));
      setCustomerChatTurn(null);
      setCustomerChatFailureIds(
        result.responseType === "error"
          ? { sessionId: activeChatSessionId, jobId: activeChatJobId }
          : null,
      );
    } catch (requestError) {
      if (!isCurrent()) return;
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
      if (terminalFailure) window.sessionStorage.removeItem(customerChatPendingKey(accountId));
      setCustomerChatTurn({
        accountId, sessionId: activeChatSessionId, jobId: activeChatJobId,
        question: normalizedQuestion,
        status: terminalFailure ? "failed" : "interrupted",
        error: getApiErrorMessage(requestError, "No se pudo recuperar la respuesta de la cuenta"),
        transportTrace: {
          source: "browser_observed", exchanges: transportExchanges,
        },
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
      if (isCurrent()) {
        customerChatRequestRef.current = null;
        setCustomerChatLoading(false);
      }
    }
  }

  function startNewCustomerChat() {
    if (customerChatLoading || customerChatSessionLoading) return;
    window.sessionStorage.removeItem(customerChatSessionKey(customerAccountId));
    window.sessionStorage.removeItem(customerChatPendingKey(customerAccountId));
    customerChatRevisionRef.current += 1;
    customerChatRequestRef.current = null;
    setCustomerChatTurn(null);
    setCustomerChatSessionId(null);
    setCustomerChatMessages([]);
    setCustomerChatQuestion("");
    setCustomerChatAttachment(null);
    setCustomerIntelligenceError("");
    setCustomerChatTransportError(null);
    setCustomerChatFailureIds(null);
  }

  function updateCustomerChatFoundationVisibility(visible) {
    setShowCustomerChatFoundation(visible);
    window.localStorage.setItem(
      CUSTOMER_CHAT_FOUNDATION_VISIBILITY_KEY,
      String(visible),
    );
  }

  const hasCustomerChatFoundation = customerChatMessages.some(
    (message) =>
      message.role !== "seller" &&
      (message.evidence?.length ||
        message.inferences?.length ||
        message.publicSources?.length ||
        message.agents?.length),
  );

  return {
    customerChatQuestion,
    setCustomerChatQuestion,
    customerChatAttachment,
    setCustomerChatAttachment,
    customerChatMessages,
    customerChatLoading,
    customerChatTurn,
    customerChatTurnBlocking,
    customerChatThreadRef,
    customerChatSessionId,
    customerChatSessionLoading,
    setCustomerChatHistoryReload,
    showCustomerChatFoundation,
    hasCustomerChatFoundation,
    updateCustomerChatFoundationVisibility,
    customerChatPublicResearch,
    setCustomerChatPublicResearch,
    customerChatTransportError,
    customerChatFailureIds,
    askCustomerChat,
    startNewCustomerChat,
    reset,
  };
}
