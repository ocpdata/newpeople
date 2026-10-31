import { useCallback, useState } from "react";
import { api, getApiErrorMessage } from "../api";

const base = "/api/commercial-intelligence/account-chat/sessions";
const dateFormat = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" });

function formatWhen(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : dateFormat.format(date);
}

// Earlier conversations of the seller about the current account, loaded when the list is opened.
export function CustomerChatHistory({ accountId, currentSessionId, disabled, opportunityNames = {}, onResume }) {
  const [sessions, setSessions] = useState(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (nextPage) => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get(base, { params: { accountId, page: nextPage } });
      const incoming = Array.isArray(data?.sessions) ? data.sessions : [];
      setSessions((previous) => (nextPage === 1 ? incoming : [...(previous || []), ...incoming]));
      setPage(nextPage);
      setHasMore(Boolean(data?.hasMore));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "No se pudieron cargar las conversaciones anteriores"));
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  return (
    <details
      className="mi-agent-customer-chat-history"
      onToggle={(event) => { if (event.currentTarget.open) void load(1); }}
    >
      <summary>Conversaciones anteriores</summary>
      <div className="mi-agent-customer-chat-history-body">
        {error ? <p className="form-error">{error}</p> : null}
        {sessions === null && loading ? <p className="mi-agent-customer-chat-history-hint">Cargando…</p> : null}
        {sessions && !sessions.length && !error ? (
          <p className="mi-agent-customer-chat-history-hint">Aún no hay conversaciones guardadas de esta cuenta.</p>
        ) : null}
        {sessions?.length ? (
          <ul>
            {sessions.map((session) => {
              const current = session.id === currentSessionId;
              const opportunity = opportunityNames[session.opportunityId];
              return (
                <li key={session.id}>
                  <button
                    type="button"
                    disabled={disabled || current}
                    aria-current={current ? "true" : undefined}
                    onClick={() => onResume(session.id)}
                  >
                    <strong>{session.title}</strong>
                    <span>
                      {formatWhen(session.updatedAt)} · {session.messageCount} mensajes
                      {opportunity ? ` · ${opportunity}` : ""}
                      {current ? " · abierta ahora" : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        {hasMore ? (
          <button type="button" className="mi-agent-secondary-button" disabled={loading} onClick={() => load(page + 1)}>
            {loading ? "Cargando…" : "Ver las más antiguas"}
          </button>
        ) : null}
      </div>
    </details>
  );
}
