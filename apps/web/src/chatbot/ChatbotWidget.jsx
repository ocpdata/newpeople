import { useEffect, useMemo, useRef, useState } from "react";
import { api, getApiErrorMessage } from "../api";
import { useChatbotContextState } from "./context.jsx";

const CHATBOT_DEFAULT_REQUEST_TIMEOUT_MS = 60000;

function ChatbotIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M4.5 5.5h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4.5 3v-3H4.5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z" />
      <path d="M8 10.5h8" />
      <path d="M8 13.5h5" />
    </svg>
  );
}

function ChatbotClearIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M6 7.5h12" />
      <path d="M9 7.5V5.75a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5.75V7.5" />
      <path d="M8.5 7.5l.9 11h5.2l.9-11" />
      <path d="M10.5 11v4" />
      <path d="M13.5 11v4" />
    </svg>
  );
}

function ChatbotNewIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
      <path d="M4.5 5.5h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4.5 3v-3H4.5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z" />
    </svg>
  );
}

function ChatbotCloseIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}

export default function ChatbotWidget({ currentUser }) {
  const [isOpen, setIsOpen] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [walletSummary, setWalletSummary] = useState(null);
  const [drawerOffset, setDrawerOffset] = useState({ x: 0, y: 0 });
  const [requestTimeoutMs, setRequestTimeoutMs] = useState(
    CHATBOT_DEFAULT_REQUEST_TIMEOUT_MS,
  );
  const pollTimerRef = useRef(null);
  const drawerRef = useRef(null);
  const dragStateRef = useRef(null);

  const contextSnapshot = useChatbotContextState();
  const contextIdentity = useMemo(
    () =>
      [
        String(contextSnapshot?.route || ""),
        String(contextSnapshot?.module || ""),
        String(contextSnapshot?.viewType || ""),
        String(contextSnapshot?.surface || ""),
        String(contextSnapshot?.activeEntity?.type || ""),
        String(contextSnapshot?.activeEntity?.id || ""),
      ].join("|"),
    [contextSnapshot],
  );

  const storageKey = useMemo(
    () => `chatbot_session_${Number(currentUser?.id || 0)}`,
    [currentUser?.id],
  );

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function boot() {
      try {
        const nextTimeoutMs = await loadChatbotSettings(mounted);
        const remembered = localStorage.getItem(storageKey) || "";
        if (remembered) {
          if (mounted) {
            setSessionId(remembered);
          }
          await loadHistory(remembered, mounted, nextTimeoutMs);
          await loadWallet(mounted, nextTimeoutMs);
          return;
        }

        await createSession(mounted, nextTimeoutMs);
      } catch (bootError) {
        if (mounted) {
          setError(
            getApiErrorMessage(bootError, "No fue posible iniciar el chatbot"),
          );
        }
      }
    }

    boot();

    return () => {
      mounted = false;
    };
  }, [storageKey, contextIdentity]);

  async function loadChatbotSettings(mounted = true) {
    try {
      const { data } = await api.get("/api/chatbot/settings");
      const nextTimeoutMs = Math.max(
        5000,
        Number(
          data?.settings?.requestTimeoutMs ||
            CHATBOT_DEFAULT_REQUEST_TIMEOUT_MS,
        ),
      );
      if (mounted) {
        setRequestTimeoutMs(nextTimeoutMs);
      }
      return nextTimeoutMs;
    } catch {
      if (mounted) {
        setRequestTimeoutMs(CHATBOT_DEFAULT_REQUEST_TIMEOUT_MS);
      }
      return CHATBOT_DEFAULT_REQUEST_TIMEOUT_MS;
    }
  }

  async function loadWallet(mounted = true, timeoutMs = requestTimeoutMs) {
    try {
      const { data } = await api.get("/api/chatbot/wallet/me", {
        timeout: timeoutMs,
      });
      if (mounted) {
        setWalletSummary(data);
      }
    } catch {
      if (mounted) {
        setWalletSummary(null);
      }
    }
  }

  async function loadHistory(
    targetSessionId,
    mounted = true,
    timeoutMs = requestTimeoutMs,
  ) {
    if (!targetSessionId) return;
    try {
      const { data } = await api.get(
        `/api/chatbot/sessions/${encodeURIComponent(targetSessionId)}/messages`,
        {
          timeout: timeoutMs,
        },
      );
      if (mounted) {
        setMessages(Array.isArray(data?.items) ? data.items : []);
      }
    } catch (historyError) {
      if (mounted) {
        setError(
          getApiErrorMessage(
            historyError,
            "No fue posible cargar el historial del chatbot",
          ),
        );
      }
    }
  }

  function setPollingJob(jobId, timeoutMs = requestTimeoutMs) {
    if (!jobId) return;

    const poll = async () => {
      try {
        const { data } = await api.get(
          `/api/chatbot/jobs/${encodeURIComponent(jobId)}`,
          {
            timeout: timeoutMs,
          },
        );

        const status = String(data?.status || "queued").trim();
        if (status === "queued") {
          setStatusText("Asistente en cola...");
          pollTimerRef.current = setTimeout(poll, 1500);
          return;
        }

        if (status === "running") {
          setStatusText("Asistente procesando respuesta...");
          pollTimerRef.current = setTimeout(poll, 1500);
          return;
        }

        if (status === "completed") {
          setStatusText("");
          setSending(false);
          await loadHistory(sessionId, true, timeoutMs);
          await loadWallet(true, timeoutMs);
          return;
        }

        const message =
          String(data?.error?.message || "").trim() ||
          "No fue posible completar la respuesta del chatbot";
        setStatusText("");
        setSending(false);
        setError(message);
      } catch (pollError) {
        setStatusText("");
        setSending(false);
        setError(
          getApiErrorMessage(pollError, "No fue posible consultar el job"),
        );
      }
    };

    poll();
  }

  async function handleSend() {
    if (!sessionId || sending) return;

    const message = String(input || "").trim();
    if (!message) return;

    setInput("");
    setError("");
    setSending(true);
    setStatusText("Enviando consulta...");

    try {
      const { data } = await api.post(
        "/api/chatbot/messages",
        {
          sessionId,
          message,
          useContext: true,
          contextSnapshot,
          featureCode: "chatbot.assistant",
        },
        {
          timeout: requestTimeoutMs,
        },
      );

      setMessages((current) => [
        ...current,
        {
          id: `temp_${Date.now()}`,
          role: "user",
          content: message,
          source: null,
          createdAt: new Date().toISOString(),
        },
      ]);

      setPollingJob(String(data?.jobId || ""), requestTimeoutMs);
    } catch (sendError) {
      setSending(false);
      setStatusText("");
      setError(
        getApiErrorMessage(sendError, "No fue posible enviar la pregunta"),
      );
    }
  }

  function formatBalanceUsd(value) {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(value || 0));
  }

  function getAvailablePercentage(summary) {
    if (!summary) return 0;
    const consumed = Number(summary.consumedPercent || 0);
    return Math.max(0, 100 - consumed);
  }

  function getBalanceIndicatorClass(summary) {
    if (!summary) return "normal";
    return summary.state || "normal";
  }

  async function createSession(mounted = true, timeoutMs = requestTimeoutMs) {
    const { data } = await api.post(
      "/api/chatbot/sessions",
      {
        locale: "es",
        userContext: contextSnapshot,
      },
      {
        timeout: timeoutMs,
      },
    );

    const nextSessionId = String(data?.sessionId || "").trim();
    if (!nextSessionId) {
      throw new Error("No fue posible iniciar sesion de chatbot");
    }

    localStorage.setItem(storageKey, nextSessionId);
    if (mounted) {
      setSessionId(nextSessionId);
      setMessages([]);
      setInput("");
      setError("");
      setStatusText("");
      setSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []);
    }

    await loadHistory(nextSessionId, mounted, timeoutMs);
    await loadWallet(mounted, timeoutMs);

    return nextSessionId;
  }

  function handleClearChat() {
    setMessages([]);
    setInput("");
    setError("");
    setStatusText("");
  }

  async function handleNewChat() {
    if (sending) return;

    setSending(true);
    setStatusText("Creando nuevo chat...");
    setError("");

    try {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }

      await createSession(true);
    } catch (newChatError) {
      setError(
        getApiErrorMessage(newChatError, "No fue posible crear un chat nuevo"),
      );
    } finally {
      setSending(false);
      setStatusText("");
    }
  }

  function handleDrawerPointerDown(event) {
    if (event.button !== 0) return;
    if (event.target.closest(".chatbot-close")) return;

    const drawerElement = drawerRef.current;
    if (!drawerElement) return;

    const rect = drawerElement.getBoundingClientRect();
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffsetX: drawerOffset.x,
      startOffsetY: drawerOffset.y,
      rectLeft: rect.left,
      rectTop: rect.top,
      width: rect.width,
      height: rect.height,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleDrawerPointerMove(event) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    const margin = 12;

    const minLeft = margin;
    const maxLeft = window.innerWidth - margin - dragState.width;
    const minTop = margin;
    const maxTop = window.innerHeight - margin - dragState.height;

    const nextLeft = Math.min(
      Math.max(dragState.rectLeft + deltaX, minLeft),
      maxLeft,
    );
    const nextTop = Math.min(
      Math.max(dragState.rectTop + deltaY, minTop),
      maxTop,
    );

    setDrawerOffset({
      x: dragState.startOffsetX + (nextLeft - dragState.rectLeft),
      y: dragState.startOffsetY + (nextTop - dragState.rectTop),
    });
  }

  function endDrawerDrag() {
    dragStateRef.current = null;
  }

  return (
    <>
      <button
        type="button"
        className="chatbot-fab"
        onClick={() => setIsOpen((current) => !current)}
        aria-label={isOpen ? "Cerrar asistente" : "Abrir asistente"}
        title={isOpen ? "Cerrar asistente" : "Abrir asistente"}
      >
        <ChatbotIcon />
      </button>

      {isOpen ? (
        <section
          className="chatbot-drawer"
          ref={drawerRef}
          role="dialog"
          aria-label="Asistente de NewPeople"
          style={{
            transform: `translate3d(${drawerOffset.x}px, ${drawerOffset.y}px, 0)`,
          }}
        >
          <div
            className="chatbot-header"
            onPointerDown={handleDrawerPointerDown}
            onPointerMove={handleDrawerPointerMove}
            onPointerUp={endDrawerDrag}
            onPointerCancel={endDrawerDrag}
          >
            <div className="chatbot-header-content">
              <h3>Asistente IA</h3>
              {contextSnapshot?.activeEntity?.name ? (
                <p className="chatbot-context-active">
                  📍 {contextSnapshot.activeEntity.name}
                </p>
              ) : (
                <p className="chatbot-context-default">
                  {contextSnapshot.module}
                </p>
              )}
            </div>
            <div className="chatbot-header-actions">
              {walletSummary ? (
                <div
                  className={`chatbot-credit-badge is-${getBalanceIndicatorClass(walletSummary)}`}
                  title="Disponibilidad de crédito de IA"
                  aria-label={`${getAvailablePercentage(walletSummary)}% de crédito disponible`}
                >
                  {getAvailablePercentage(walletSummary)}%
                </div>
              ) : null}
              <button
                type="button"
                className="chatbot-header-action"
                disabled={sending}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={handleClearChat}
                aria-label="Limpiar chat"
                title="Limpiar chat"
              >
                <ChatbotClearIcon />
              </button>
              <button
                type="button"
                className="chatbot-header-action is-primary"
                disabled={sending}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={handleNewChat}
                aria-label="Nuevo chat"
                title="Nuevo chat"
              >
                <ChatbotNewIcon />
              </button>
              <button
                type="button"
                className="chatbot-close"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => setIsOpen(false)}
                aria-label="Cerrar"
                title="Cerrar"
              >
                <ChatbotCloseIcon />
              </button>
            </div>
          </div>

          {error ? <div className="chatbot-error">{error}</div> : null}

          <div className="chatbot-messages">
            {messages.length ? (
              messages.map((item) => (
                <article
                  key={item.id}
                  className={
                    item.role === "user"
                      ? "chatbot-message is-user"
                      : "chatbot-message is-assistant"
                  }
                >
                  <div className="chatbot-message-header">
                    {item.role === "user" ? "👤" : "🤖"}
                    <span className="chatbot-message-role">
                      {item.role === "user" ? "Tu pregunta" : "Asistente"}
                    </span>
                  </div>
                  <p className="chatbot-message-text">{item.content}</p>
                  {item?.source?.sourceType ? (
                    <small className="chatbot-message-source">
                      {item.source.sourceType}
                    </small>
                  ) : null}
                </article>
              ))
            ) : (
              <div className="chatbot-empty-state">
                <p>¿Qué necesitas saber?</p>
                <small>
                  Pregunta sobre cómo usar la aplicación o tus datos
                </small>
              </div>
            )}
          </div>

          {suggestions.length && !messages.length ? (
            <div className="chatbot-suggestions">
              <p className="chatbot-suggestions-label">Sugerencias:</p>
              {suggestions.slice(0, 3).map((suggestion) => (
                <button
                  type="button"
                  key={suggestion}
                  className="chatbot-suggestion"
                  onClick={() => setInput(String(suggestion || ""))}
                  disabled={sending}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          ) : null}

          <div className="chatbot-compose">
            <textarea
              rows={2}
              value={input}
              disabled={sending}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Escribe tu pregunta aquí..."
              className="chatbot-input"
            />
            <button
              type="button"
              className="chatbot-send-btn"
              onClick={handleSend}
              disabled={sending || !String(input || "").trim()}
            >
              {sending ? "Procesando..." : "Enviar"}
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}
