import { CustomerChatFeedbackTriage } from "./CustomerChatFeedbackTriage";
import { formatCoachDateTime } from "./miAgentHelpers";
import { CustomerChatDebugFlow } from "./CustomerChatDebug";

export function CustomerChatDiagnosticsPanel({ canWriteEvaluations, chatDiagnosticsAccountId, chatDiagnosticsClosingId, chatDiagnosticsDateFrom, chatDiagnosticsDateTo, chatDiagnosticsError, chatDiagnosticsLoading, chatDiagnosticsPage, chatDiagnosticsQuery, chatDiagnosticsResult, chatDiagnosticsReviewStatus, chatDiagnosticsSelected, chatDiagnosticsStatus, closeCustomerDiagnostic, loadCustomerChatDiagnostics, openCustomerChatDiagnostic, setChatDiagnosticsAccountId, setChatDiagnosticsDateFrom, setChatDiagnosticsDateTo, setChatDiagnosticsPage, setChatDiagnosticsQuery, setChatDiagnosticsReviewStatus, setChatDiagnosticsStatus }) {
  return (
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
        <span>Trazas de consulta · cierre de revisión</span>
      </div>
      <CustomerChatFeedbackTriage
        canConvert={canWriteEvaluations}
        onOpenDiagnostic={(jobId) => void openCustomerChatDiagnostic({ jobId })}
      />
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
          Diagnóstico
          <select
            aria-label="Estado del diagnóstico"
            value={chatDiagnosticsReviewStatus}
            onChange={(event) => {
              const reviewStatus = event.target.value;
              setChatDiagnosticsReviewStatus(reviewStatus);
              setChatDiagnosticsPage(1);
              void loadCustomerChatDiagnostics({ page: 1, reviewStatus });
            }}
          >
            <option value="all">Todos</option>
            <option value="pending">Pendientes</option>
            <option value="closed">Cerrados</option>
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
                chatDiagnosticsPage * 10 >=
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
              <article key={session.sessionId}
                className={session.diagnosticReview?.status === "closed" ? "is-diagnostic-closed" : ""}
              >
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
                  <small>
                    Creada: {formatCoachDateTime(session.sessionCreatedAt, chatDiagnosticsResult?.businessTimezone) || "Fecha no disponible"}
                    {chatDiagnosticsResult?.businessTimezone ? ` · ${chatDiagnosticsResult.businessTimezone}` : ""}
                  </small>
                  <strong>
                    {session.diagnosticReview?.status === "closed" ? "Diagnóstico cerrado" : "Diagnóstico pendiente"}
                  </strong>
                  {session.diagnosticReview?.status === "closed" ? (
                    <small>
                      Cerrado por {session.diagnosticReview.closedByName || "Usuario no disponible"} ·{" "}
                      {formatCoachDateTime(session.diagnosticReview.closedAt, chatDiagnosticsResult?.businessTimezone)}
                    </small>
                  ) : null}
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
                <div className="mi-agent-chat-diagnostics-actions">
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
                  <button
                    type="button"
                    className="mi-agent-secondary-button"
                    disabled={session.diagnosticReview?.status === "closed" ||
                      chatDiagnosticsClosingId !== null || chatDiagnosticsLoading}
                    onClick={() => void closeCustomerDiagnostic(session)}
                  >
                    {chatDiagnosticsClosingId === session.sessionId ? "Cerrando..." : "Cerrar diagnóstico"}
                  </button>
                </div>
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
                          Diagnóstico B1–B12 ·{" "}
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
  );
}
