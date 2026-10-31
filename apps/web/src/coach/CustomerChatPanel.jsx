import { useEffect, useId, useRef, useState } from "react";
import "./customer-chat-a11y.css";
import { DOCUMENT_FILE_ACCEPT, DOCUMENT_FORMAT_HELP } from "../../../../shared/document-formats.js";
import { CustomerChatAnswer } from "./CustomerChatAnswer";
import { CustomerChatCopyButton } from "./CustomerChatCopyButton";
import {
  CustomerChatDebugFlow,
  CustomerChatDebugResult,
  CustomerChatDetailedTrace,
} from "./CustomerChatDebug";
import { CustomerOutcomeSummary } from "./CustomerOutcomeSummary";
import { CustomerRescheduleSummary } from "./CustomerRescheduleReview";
import { CustomerStageSummary } from "./CustomerStageReview";
import { CoachQualityFeedback } from "./CoachQualityFeedback";
import { CustomerChatProgress } from "./CustomerChatProgress";
import {
  CUSTOMER_ACTIVITY_STATUS_LABELS,
  CUSTOMER_ACTIVITY_TYPE_LABELS,
  CUSTOMER_FINDING_CONFIDENCE_LABELS,
  formatDate,
  formatFileSize,
  validateChatAttachment,
} from "./customerChatShared";

export function CustomerChatPanel({
  chat,
  navigate,
  hasCustomerContext,
  customerIntelligenceError,
  customerFocusOptions,
  customerFocusOpportunityId,
  setCustomerFocusOpportunityId,
  canCreateActions,
  canExecuteCoach,
  canUpdateCalendar,
  canDiagnoseCustomerChats,
  canReviewCustomerOperation,
  savingCoachOperation,
  openCustomerStageAnswerPrefill,
  openDiscoveryActivity,
  openCustomerChatOperation,
}) {
  const {
    customerChatFailureIds,
    customerChatTransportError,
    customerChatLoading,
    customerChatSessionLoading,
    customerChatPublicResearch,
    setCustomerChatPublicResearch,
    startNewCustomerChat,
    showCustomerChatFoundation,
    hasCustomerChatFoundation,
    updateCustomerChatFoundationVisibility,
    askCustomerChat,
    setCustomerChatAttachment,
    customerChatAttachment,
    customerChatQuestion,
    setCustomerChatQuestion,
    customerChatTurnBlocking,
    customerChatMessages,
    customerChatTurn,
    customerChatThreadRef,
    setCustomerChatHistoryReload,
    cancelCustomerChatTurn,
    retryCustomerChatTurn,
    customerChatCanceling,
    customerChatAnnouncement,
  } = chat;
  const hintId = useId();
  const attachmentErrorId = useId();
  const [attachmentError, setAttachmentError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const chatInputsDisabled = customerChatLoading || customerChatSessionLoading || !hasCustomerContext;
  // Validates the file when it is chosen or dropped, so a bad file is rejected before sending.
  function selectAttachment(file) {
    const problem = validateChatAttachment(file);
    setAttachmentError(problem);
    if (!problem) setCustomerChatAttachment(file || null);
  }
  const turnNoticeRef = useRef(null);
  const previousTurnStatusRef = useRef(null);
  // When a pending turn fails, move focus to its notice so the retry/recover actions are reachable.
  useEffect(() => {
    const status = customerChatTurn?.status || null;
    if (previousTurnStatusRef.current === "pending" && ["failed", "interrupted"].includes(status)) {
      turnNoticeRef.current?.focus();
    }
    previousTurnStatusRef.current = status;
  }, [customerChatTurn?.status]);
  return (
    <>
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
                <h3>Chat de cuenta</h3>
              </div>
              <div className="mi-agent-customer-chat-header-actions">
                {customerFocusOptions.enabled ? (
                  <label className="mi-agent-customer-focus">
                    <span>Oportunidad</span>
                    <select
                      value={customerFocusOpportunityId}
                      onChange={(event) => setCustomerFocusOpportunityId(event.target.value)}
                      disabled={customerChatLoading || customerChatSessionLoading || !hasCustomerContext}
                      aria-label="Oportunidad en foco"
                    >
                      <option value="">Toda la cuenta</option>
                      {customerFocusOptions.opportunities.map((opportunity) => (
                        <option key={opportunity.id} value={String(opportunity.id)}>
                          {opportunity.name}
                          {opportunity.stageName ? ` · ${opportunity.stageName}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {customerFocusOptions.error ? (
                  <small className="form-error">{customerFocusOptions.error}</small>
                ) : null}
                <label className="mi-agent-customer-public-research">
                  <input
                    type="checkbox"
                    checked={customerChatPublicResearch}
                    onChange={(event) =>
                      setCustomerChatPublicResearch(event.target.checked)
                    }
                    disabled={customerChatLoading || customerChatSessionLoading || !hasCustomerContext}
                  />
                  <span>Incluir fuentes públicas</span>
                  <small>Requiere gobierno y permiso</small>
                </label>
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
            <form
              className={`mi-agent-coach-form${dragActive ? " is-drag-active" : ""}`}
              onSubmit={(event) => {
                event.preventDefault();
                askCustomerChat();
              }}
              onDragOver={(event) => {
                if (chatInputsDisabled) return;
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setDragActive(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDragActive(false);
                if (chatInputsDisabled) return;
                selectAttachment(event.dataTransfer?.files?.[0] || null);
              }}
            >
              <label className="mi-agent-customer-chat-file-picker">
                <span>Adjuntar</span>
                <input
                  type="file"
                  accept={DOCUMENT_FILE_ACCEPT}
                  aria-label="Adjuntar documento, imagen o audio"
                  aria-describedby={attachmentError ? `${hintId} ${attachmentErrorId}` : hintId}
                  title={DOCUMENT_FORMAT_HELP}
                  onChange={(event) => {
                    selectAttachment(event.target.files?.[0] || null);
                    event.target.value = "";
                  }}
                  disabled={chatInputsDisabled}
                />
              </label>
              {attachmentError ? (
                <small className="form-error" id={attachmentErrorId} role="alert">
                  {attachmentError}
                </small>
              ) : null}
              {customerChatAttachment ? (
                <div className="mi-agent-customer-chat-file-name">
                  <span title={customerChatAttachment.name}>
                    {customerChatAttachment.name}
                  </span>
                  <small>{formatFileSize(customerChatAttachment.size)}</small>
                  <button
                    type="button"
                    aria-label="Quitar archivo adjunto"
                    onClick={() => {
                      setCustomerChatAttachment(null);
                      setAttachmentError("");
                    }}
                    disabled={customerChatLoading}
                  >
                    Quitar
                  </button>
                </div>
              ) : null}
              <textarea
                rows={3}
                aria-label="Pregunta sobre la cuenta"
                aria-describedby={hintId}
                value={customerChatQuestion}
                onChange={(event) =>
                  setCustomerChatQuestion(event.target.value)
                }
                placeholder="Pregunta sobre la cuenta..."
                disabled={customerChatLoading || customerChatSessionLoading || !hasCustomerContext}
              />
              <button
                type="submit"
                className="mi-agent-primary-button"
                disabled={
                  customerChatLoading ||
                  customerChatSessionLoading ||
                  customerChatTurnBlocking ||
                  !customerChatQuestion.trim() ||
                  !hasCustomerContext
                }
              >
                {customerChatLoading ? "Consultando..." : "Preguntar"}
              </button>
            </form>
            <small className="field-hint" id={hintId}>Un archivo por mensaje. {DOCUMENT_FORMAT_HELP}</small>
            <div className="mi-agent-sr-only" aria-live="polite" aria-atomic="true">
              {customerChatAnnouncement}
            </div>
            {customerChatMessages.length || customerChatTurn ? (
              <div className="mi-agent-coach-thread" ref={customerChatThreadRef}>
                {customerChatMessages.map((message, index) =>
                  message.role === "seller" ? (
                    <div
                      key={`seller-${index}`}
                      className="mi-agent-coach-message is-seller"
                    >
                      <span>Vendedor</span>
                      <p>{message.text}</p>
                      {message.attachmentName ? (
                        <small>Adjunto: {message.attachmentName}</small>
                      ) : null}
                    </div>
                  ) : (
                    <div
                      key={`assistant-${index}`}
                      className="mi-agent-coach-message is-coach"
                    >
                      <span>Cuenta</span>
                      <small className="mi-agent-customer-source-label">
                        {message.linkMetadata
                          ? "Vínculo propuesto · no acredita guardado"
                          : message.updateMetadata
                          ? "Cambio propuesto · no acredita guardado"
                          : message.creationMetadata
                          ? "Datos aportados · borrador no guardado"
                          : message.contentSource === "knowledge_library"
                          ? "Biblioteca documental RAG; no acredita hechos del cliente"
                          : message.contentSource === "mixed_knowledge"
                          ? "Biblioteca RAG + otras fuentes; respaldo diferenciado en la respuesta"
                          : message.contentSource === "user_provided"
                          ? "Material aportado; no verificado en CRM"
                          : message.contentSource === "mixed_document"
                          ? "CRM + material aportado; fuentes diferenciadas en la respuesta"
                          : message.sourceDomain === "mixed"
                          ? "CRM + investigación pública"
                          : message.sourceDomain === "public_web"
                            ? "Investigación pública"
                            : "Fuente CRM"}
                        {message.confidence
                          ? ` · confianza ${CUSTOMER_FINDING_CONFIDENCE_LABELS[message.confidence] || message.confidence}`
                          : ""}
                      </small>
                      {message.documentCoverage ? (
                        <small className="mi-agent-customer-source-label">
                          {message.documentCoverage.kind === "metadata_only"
                            ? message.documentCoverage.partial
                              ? "Listado documental parcial; contenido no leído"
                              : "Listado documental; contenido no leído"
                            : message.documentCoverage.partial
                            ? "Cobertura documental parcial"
                            : "Contenido comercial o texto extraído consultado"}
                          {message.documentCoverage.availableLength != null
                            ? ` · ${message.documentCoverage.availableLength} caracteres disponibles`
                            : ""}
                        </small>
                      ) : null}
                      {message.documentSources?.length ? (
                        <details aria-label="Fuentes documentales CRM">
                          <summary>Documentos CRM consultados</summary>
                          <ul>
                            {message.documentSources.map((document, index) => (
                              <li key={`${document.source}-${document.documentId}-${index}`}>
                                {document.name}
                                {document.versionNumber ? ` · cotización ${document.quotationId}, versión ${document.versionNumber}` : ""}
                                {` · ${document.status === "ready" ? "contenido leído" : "contenido no disponible"}`}
                                {document.kind === "summary" ? " · solo resumen" : ""}
                                {document.availableLength ? ` · ${document.availableLength} caracteres utilizados` : ""}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                      {message.linkMetadata ? (
                        <details aria-label="Propuesta de vínculo A04">
                          <summary>Vínculo de {message.linkMetadata.opportunityName} · {message.linkMetadata.effect === "no_change" ? "ya existe" : "revisión necesaria"}</summary>
                          <p>Cuenta: {message.linkMetadata.accountName}</p>
                          <p>Contacto actual: {message.linkMetadata.currentContactName || "(sin contacto)"}</p>
                          <p>Contacto propuesto: {message.linkMetadata.contactName}</p>
                          <p>{message.linkMetadata.effect === "replace" ? "Sustituye la asociación actual; no conserva ambas." :
                            message.linkMetadata.effect === "no_change" ? "Sin modificación." : "Asignación de contacto."}</p>
                          <small>Resumen histórico, no confirmación de guardado. La relación vigente se revalida en Oportunidades.</small>
                        </details>
                      ) : null}
                      {message.stageMetadata ? (
                        <details><summary>Validación de avance · solicitud sin ejecutar</summary>
                          <CustomerStageSummary summary={message.stageMetadata} />
                        </details>
                      ) : null}
                      {message.outcomeMetadata ? (
                        <details>
                          <summary>Resultado de llamada · {message.outcomeMetadata.status === "prepared" ? "propuesta sin guardar" : "requiere aclaración"}</summary>
                          <CustomerOutcomeSummary operation={{ ...message.outcomeMetadata, outcomeSummary: message.outcomeMetadata.proposed ? message.outcomeMetadata : null }} />
                        </details>
                      ) : null}
                      {message.rescheduleMetadata ? (
                        <details aria-label="Propuesta de reprogramación A06">
                          <summary>Reprogramación · {message.rescheduleMetadata.status === "no_change" ? "sin cambio" : "revisión necesaria"}</summary>
                          <CustomerRescheduleSummary summary={message.rescheduleMetadata} />
                          <small>Resumen histórico, no confirmación de guardado. La actividad se revalida en Calendario.</small>
                        </details>
                      ) : null}
                      {message.updateMetadata ? (
                        <details aria-label="Propuesta de actualización A02">
                          <summary>Cambio de {message.updateMetadata.targetName} · {message.updateMetadata.status === "finished" ? "sin pendientes" : "revisión necesaria"}</summary>
                          <p>Cuenta: {message.updateMetadata.accountName}</p>
                          {message.updateMetadata.field ? (
                            <p>{message.updateMetadata.label}: {message.updateMetadata.currentValue ?? "(vacío)"} → {message.updateMetadata.proposedValue ?? "(vacío)"}</p>
                          ) : null}
                          <ul>{message.updateMetadata.changes.map((change) => (
                            <li key={change.id}>
                              {change.label}: {change.action === "pending" ? "valor pendiente" : change.action === "clear" ? "(vaciar)" : change.value}
                              {" · "}{({ pending: "pendiente", completed: "guardado según operación", discarded: "retirado", no_change: "sin cambio" })[change.status]}
                            </li>
                          ))}</ul>
                          <small>Resumen histórico, no confirmación de ejecución. Cada campo se revisa y confirma por separado; la vigencia se comprueba en el servidor.</small>
                        </details>
                      ) : null}
                      {message.creationMetadata ? (
                        <details aria-label="Borrador de alta A01">
                          <summary>
                            Borrador de {message.creationMetadata.object === "contact" ? "contacto" : "oportunidad"} · no guardado
                          </summary>
                          <p>Cuenta: {message.creationMetadata.accountName}</p>
                          <ul>{message.creationMetadata.fields.map((field) => (
                            <li key={field.field}>{field.label}: {field.value}</li>
                          ))}</ul>
                          <p>Pendientes de completar o revisar: {message.creationMetadata.pendingFields.join(", ")}</p>
                          {message.creationMetadata.coincidences.map((item) => (
                            <p key={item.id}>Posible coincidencia: {item.name} · {item.reason}</p>
                          ))}
                          {message.creationMetadata.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
                          <small>Resumen histórico de la propuesta, no comprobante de alta. La vigencia se verifica al continuar al módulo.</small>
                        </details>
                      ) : null}
                      {message.documentReportMetadata?.length ? (
                        <div aria-label="Contraste del reporte documental">
                          <small className="mi-agent-customer-source-label">
                            Reporte documental · no confirma hechos CRM
                          </small>
                          {message.documentReportMetadata.map((report, index) => (
                            <details key={index}>
                              <summary>{report.statusLabel}{report.partial ? " · cobertura parcial" : ""}</summary>
                              <p><strong>Lo reportado:</strong> {report.claim}</p>
                              <p><strong>Fuente consultada:</strong> {report.sourceLabel}</p>
                              <p>{report.reason}</p>
                              {report.crmDiscrepancies?.map((item) => (
                                <p key={item.questionId}>
                                  <strong>Diferencia con {item.prompt}:</strong> {item.reason}
                                  {item.partial ? " · Respuesta CRM registrada (fragmento recortado): " : " · Respuesta CRM registrada: "}{item.currentAnswer}
                                  {" · No se reemplazó ni se eligió cuál fuente es correcta."}
                                </p>
                              ))}
                              <ul>{report.citations.map((citation) => (
                                <li key={citation.key}>[{citation.key}]: {citation.text}</li>
                              ))}</ul>
                              <small>No certifica autenticidad ni reemplaza datos CRM.</small>
                              {report.crmCoverage?.partial ? <small> · Comparación CRM parcial: solo respuestas y fragmentos disponibles.</small> : null}
                            </details>
                          ))}
                        </div>
                      ) : null}
                      {message.scenarioMetadata ? (
                        <small className="mi-agent-customer-source-label">
                          Escenario hipotético · no modifica el CRM
                          {message.scenarioMetadata.partial ? " · consultar cobertura" : ""}
                        </small>
                      ) : null}
                      {message.scenarioEvidence?.length ? (
                        <details>
                          <summary>Base, metodología y límites del escenario</summary>
                          <ul>{message.scenarioEvidence.map((item, index) => <li key={index}>{item}</li>)}</ul>
                        </details>
                      ) : null}
                      {message.scenarioMetadata?.tables?.length ? (
                        <div style={{ overflowX: "auto" }}>
                          {message.scenarioMetadata.tables.map((table, index) => (
                            <table key={index} aria-label={table.title}>
                              <caption>{table.title}</caption>
                              <thead><tr>{table.headers.map((header) => <th key={header} scope="col">{header}</th>)}</tr></thead>
                              <tbody>{table.rows.map((row, rowIndex) => (
                                <tr key={rowIndex}>{row.map((value, columnIndex) => <td key={columnIndex}>{value}</td>)}</tr>
                              ))}</tbody>
                            </table>
                          ))}
                        </div>
                      ) : null}
                      {message.trendMetadata ? (
                        <small className="mi-agent-customer-source-label">
                          Evolución comercial registrada · {message.trendMetadata.metric}
                          {message.trendMetadata.partial ? " · consultar cobertura y límites" : ""}
                        </small>
                      ) : null}
                      {message.trendEvidence?.length ? (
                        <details>
                          <summary>Fundamento histórico</summary>
                          <ul>{message.trendEvidence.map((item, index) => <li key={index}>{item}</li>)}</ul>
                        </details>
                      ) : null}
                      {message.trendMetadata?.table || message.trendMetadata?.tables?.length ? (
                        <div style={{ overflowX: "auto" }}>
                          {(message.trendMetadata.tables || [message.trendMetadata.table]).map((table, index) => (
                            <table key={index} aria-label={table.title || "Evolución comercial"}>
                              {table.title ? <caption>{table.title}</caption> : null}
                              <thead><tr>{table.headers.map((header) => <th key={header} scope="col">{header}</th>)}</tr></thead>
                              <tbody>{table.rows.map((row, rowIndex) => (
                                <tr key={rowIndex}>{row.map((value, columnIndex) => <td key={columnIndex}>{value}</td>)}</tr>
                              ))}</tbody>
                            </table>
                          ))}
                        </div>
                      ) : null}
                      {message.comparisonMetadata ? (
                        <small className="mi-agent-customer-source-label">
                          Comparación por datos registrados
                          {message.comparisonMetadata.partial ? " · cobertura parcial" : ""}
                          {` · ${message.comparisonMetadata.count} oportunidades`}
                        </small>
                      ) : null}
                      {message.comparisonEvidence?.length ? (
                        <details>
                          <summary>Fundamento de la comparación</summary>
                          <ul>
                            {message.comparisonEvidence.map((item, evidenceIndex) => (
                              <li key={evidenceIndex}>{item}</li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                      {message.priorityMetadata ? (
                        <small className="mi-agent-customer-source-label">
                          Priorización por datos registrados
                          {message.priorityMetadata.partial ? " · recuperación parcial" : ""}
                          {` · ${message.priorityMetadata.shown} de ${message.priorityMetadata.eligible} elegibles recuperadas`}
                        </small>
                      ) : null}
                      {message.priorityEvidence?.length ? (
                        <details>
                          <summary>Fundamento del ranking</summary>
                          <ul>
                            {message.priorityEvidence.map((item, evidenceIndex) => (
                              <li key={evidenceIndex}>{item}</li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                      {message.documentEvidence?.length ? (
                        <details>
                          <summary>Respaldo documental</summary>
                          <ul>
                            {message.documentEvidence.map((item, evidenceIndex) => (
                              <li key={evidenceIndex}>{item}</li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                      {message.comparisonMetadata?.table || message.comparisonMetadata?.tables?.length ? (
                        <div style={{ overflowX: "auto" }}>
                          {(message.comparisonMetadata.tables || [message.comparisonMetadata.table]).map((table, tableIndex) => (
                            <table key={tableIndex} aria-label={table.title || "Comparación de oportunidades"}>
                              {table.title ? <caption>{table.title}</caption> : null}
                              <thead>
                                <tr>{table.headers.map((header) => <th key={header} scope="col">{header}</th>)}</tr>
                              </thead>
                              <tbody>
                                {table.rows.map((row, rowIndex) => (
                                  <tr key={rowIndex}>{row.map((value, columnIndex) => <td key={columnIndex}>{value}</td>)}</tr>
                                ))}
                              </tbody>
                            </table>
                          ))}
                        </div>
                      ) : null}
                      <CustomerChatAnswer
                        answer={message.comparisonMetadata?.table || message.comparisonMetadata?.tables?.length ||
                            message.trendMetadata?.table || message.trendMetadata?.tables?.length || message.scenarioMetadata?.tables?.length
                            ? String(message.answer || "").split("\n").filter((line) => !line.startsWith("|")).join("\n")
                            : message.answer}
                      />
                      <CustomerChatCopyButton text={message.answer} />
                      {message.presentation?.status === "degraded" ? (
                        <p role="status">
                          {message.presentation?.engine === "dossier"
                            ? "Parte de esta respuesta no pudo verificarse con los registros del CRM; revisa la nota al final."
                            : "No pude completar la redacción conversacional. Te muestro el resultado verificado."}
                        </p>
                      ) : null}
                      {message.opportunityOptions?.length && index === customerChatMessages.length - 1 ? (
                        <div className="mi-agent-opportunity-options" role="group" aria-label="Elegir oportunidad">
                          {message.opportunityOptions.map((option) => (
                            <button
                              type="button"
                              className="mi-agent-secondary-button"
                              key={option.id}
                              disabled={customerChatLoading || customerChatSessionLoading}
                              onClick={() => askCustomerChat(option.name)}
                            >
                              {option.name}
                              {option.stageName ? ` · ${option.stageName}` : ""}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {message.dossierCitations?.length ? (
                        <details className="mi-agent-dossier-citations">
                          <summary>Evidencia del CRM citada ({message.dossierCitations.length})</summary>
                          <ul>
                            {message.dossierCitations.map((citation) => (
                              <li key={citation.evidenceId}>
                                <strong>{citation.label}</strong>
                                {citation.detail ? <span> · {citation.detail}</span> : null}
                                {citation.date ? <span> · {String(citation.date).slice(0, 10)}</span> : null}
                                {citation.excerpt ? <p>{citation.excerpt}</p> : null}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                      {message.components?.length > 1 ? (
                        <ul aria-label="Estado de solicitudes">
                          {message.components.map((component) => (
                            <li key={component.id}>
                              {({
                                completed: "Atendida",
                                clarification: "Requiere aclaración",
                                error: "No se pudo completar",
                                unavailable: "Capacidad no disponible",
                                disabled: "Deshabilitada",
                                permission_denied: "Sin permiso",
                              })[component.status] || "Pendiente"}: {component.label || "Solicitud"}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {message.stageAnswerPrefill ? (
                        <div className="mi-agent-customer-chat-actions">
                          <strong>Respuesta de etapa preparada para revisar</strong>
                          {message.stageAnswerPrefill.questionPrompts?.map(
                            (prompt) => <span key={prompt}>{prompt}</span>,
                          )}
                          <p>
                            Se agregará a la respuesta actual. Revísala en la
                            oportunidad y guarda los cambios cuando esté lista.
                          </p>
                          {canCreateActions ? (
                            <button
                              type="button"
                              className="mi-agent-link-button"
                              onClick={() =>
                                openCustomerStageAnswerPrefill(
                                  message.stageAnswerPrefill,
                                )
                              }
                            >
                              Abrir oportunidad para revisar
                            </button>
                          ) : (
                            <small>
                              No tienes permiso para actualizar oportunidades.
                            </small>
                          )}
                        </div>
                      ) : null}
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
                                {message.activityHistory.range ? <span>
                                  {formatDate(
                                    message.activityHistory.range.startDate,
                                  )}
                                  {" - "}
                                  {formatDate(
                                    message.activityHistory.range.endDate,
                                  )}
                                </span> : <span>Sin límite temporal implícito</span>}
                                {message.activityHistory.range?.months ? (
                                  <span>{message.activityHistory.range.months} meses</span>
                                ) : null}
                                {message.activityHistory.timezone ? <span>{message.activityHistory.timezone}</span> : null}
                              </div>
                            )}
                            {message.activityHistory.warnings?.map((warning) => (
                              <p key={warning} className="mi-agent-customer-history-empty">{warning}</p>
                            ))}
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
                                            {item.sourceTitle ? <span>{item.sourceTitle}</span> : null}
                                            {item.recordId ? <span>Registro {item.recordId}</span> : null}
                                            {item.dateMeaning ? <span>{item.dateMeaning}</span> : null}
                                            {item.accountLink ? <span>{item.accountLink}</span> : null}
                                            {item.time ? <span>{item.time}</span> : null}
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
                      {canDiagnoseCustomerChats && message.debug ? (
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
                                canUpdateCalendar ? (
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
                      {message.operations?.length ? (
                        <div className="mi-agent-customer-chat-actions">
                          <strong>Operaciones propuestas</strong>
                          {message.operations.map(
                            (operation, operationIndex) => (
                              <article
                                key={`${operation.kind}-${operation.title}-${operationIndex}`}
                              >
                                <span>
                                  {operation.title || operation.kind}
                                  {operation.kind === "activity"
                                    ? operation.status === "done"
                                      ? " · Realizada"
                                      : operation.status === "pending"
                                        ? " · Programada"
                                        : ""
                                    : ""}
                                  {operation.kind === "activity" &&
                                  operation.scheduledAt
                                    ? operation.status === "done"
                                      ? ` · Ocurrió: ${operation.scheduledAt}`
                                      : ` · Programada para: ${operation.scheduledAt}`
                                    : ""}
                                  {" · requiere revisión y confirmación"}
                                </span>
                                {operation.kind === "activity" && operation.notes ? (
                                  <p>
                                    Resultado propuesto: {operation.notes}
                                  </p>
                                ) : null}
                                {operation.kind === "opportunity_note" && operation.noteText ? (
                                  <p>{operation.noteText}</p>
                                ) : null}
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
                            ),
                          )}
                        </div>
                      ) : null}
                    </div>
                  ),
                )}
                {customerChatTurn ? (
                  <div
                    className="mi-agent-coach-message is-coach"
                    role={customerChatTurn.status === "pending" ? "status" : "alert"}
                    ref={turnNoticeRef}
                    tabIndex={-1}
                  >
                    <span>Estado de la respuesta</span>
                    <p>
                      {customerChatTurn.error || "Consultando la cuenta. La respuesta todavía está pendiente..."}
                    </p>
                    {customerChatTurn.status === "pending" ? (
                      <CustomerChatProgress
                        turn={customerChatTurn}
                        onCancel={cancelCustomerChatTurn}
                        canceling={customerChatCanceling}
                      />
                    ) : null}
                    {customerChatTurn.status !== "pending" && customerChatTurn.errorHint ? (
                      <small className="mi-agent-customer-chat-error-hint">{customerChatTurn.errorHint}</small>
                    ) : null}
                    {customerChatTurn.status === "interrupted" && customerChatTurn.jobId ? (
                      <button
                        type="button"
                        className="mi-agent-secondary-button"
                        disabled={customerChatLoading || customerChatSessionLoading}
                        onClick={() => askCustomerChat(customerChatTurn.question, customerChatTurn)}
                      >
                        Recuperar respuesta
                      </button>
                    ) : customerChatTurn.status === "history_error" ? (
                      <button
                        type="button"
                        className="mi-agent-secondary-button"
                        disabled={customerChatSessionLoading}
                        onClick={() => setCustomerChatHistoryReload((current) => current + 1)}
                      >
                        Recargar conversación
                      </button>
                    ) : customerChatTurn.status === "failed" ? (
                      <>
                        <p>Puedes corregir tu pregunta o enviar otra en esta misma conversación.</p>
                        <button
                          type="button"
                          className="mi-agent-secondary-button"
                          disabled={customerChatLoading || customerChatSessionLoading}
                          onClick={retryCustomerChatTurn}
                        >
                          Reintentar
                        </button>
                      </>
                    ) : customerChatTurn.status !== "pending" ? (
                      <>
                        <p>Inicia una nueva conversación para enviar otra pregunta.</p>
                        {customerChatTurn.question ? (
                          <button
                            type="button"
                            className="mi-agent-secondary-button"
                            disabled={customerChatLoading || customerChatSessionLoading}
                            onClick={retryCustomerChatTurn}
                          >
                            Reintentar
                          </button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
    </>
  );
}
