import {
  PROSPECT_SESSION_STORAGE_KEY,
  PROSPECT_RESEARCH_TRACK_LABELS,
  CUSTOMER_FINDING_CATEGORY_LABELS,
  CUSTOMER_FINDING_STATUS_LABELS,
} from "./miAgentConstants";
import { CoachQualityFeedback } from "./CoachQualityFeedback";
import { isProspectConversionAction, isProspectConversionOperation } from "./miAgentHelpers";
import { CheckCircle2 } from "lucide-react";
import { CUSTOMER_FINDING_CONFIDENCE_LABELS } from "./customerChatShared";

export function ProspectWorkspace({ askProspectChat, canCreateAccounts, canCreateContacts, canCreateLeads, canCreateOpportunities, canCreateProspecting, canReviewCustomerOperation, canUpdateProspecting, canUseExternalSources, convertProspectContact, convertProspectOpportunity, deleteSavedProspect, loadProspectSessions, openCustomerChatOperation, openSavedProspect, prospectChatLoading, prospectChatMessages, prospectChatQuestion, prospectContactDrafts, prospectConvertedAccountId, prospectConvertedContacts, prospectConvertedLeadId, prospectConvertedOpportunities, prospectConverting, prospectError, prospectExternalResearching, prospectFindingUpdatingId, prospectForm, prospectList, prospectListError, prospectListLoading, prospectListSearch, prospectPreparing, prospectSession, prospectTargetUpdatingId, prospectView, runProspectExternalResearch, savingCoachOperation, setProspectChatMessages, setProspectChatQuestion, setProspectConversionConfirmation, setProspectError, setProspectForm, setProspectListSearch, setProspectSession, setProspectView, startProspectResearch, updateProspectContactDraft, updateProspectFindingStatus, updateProspectForm, updateProspectHypothesisStatus, updateProspectTarget }) {
  return (
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
                  Se encontraron posibles cuentas existentes. No se creará
                  ni se vinculará una cuenta desde esta prospección.
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
                      </article>
                    ),
                  )}
                </div>
              </>
            ) : (
              <p>
                No se encontraron posibles duplicados para este nombre, país
                y dominio.
              </p>
            )}
          </div>
          <div className="mi-agent-prospect-conversion-actions">
            {!prospectSession.duplicateReview?.candidates?.length ? (
              <button
                type="button"
                className="mi-agent-primary-button"
                onClick={() => setProspectConversionConfirmation("account")}
                disabled={
                  !canUpdateProspecting ||
                  !canCreateAccounts ||
                  prospectConverting === "account" ||
                  !prospectSession.duplicateReview?.completed ||
                  !prospectSession.duplicateReview?.countryResolved ||
                  Boolean(
                    prospectConvertedAccountId ||
                    prospectSession.convertedAccountId,
                  )
                }
              >
                {prospectConvertedAccountId ||
                prospectSession.convertedAccountId
                  ? "Cuenta creada"
                  : prospectConverting === "account"
                    ? "Creando cuenta..."
                    : "Crear cuenta revisada"}
              </button>
            ) : null}
            {prospectConvertedLeadId ? (
              <span className="mi-agent-prospect-success" role="status">
                <CheckCircle2 size={16} aria-hidden="true" />
                Lead creado
              </span>
            ) : (
              <button
                type="button"
                className="mi-agent-secondary-button"
                onClick={() => setProspectConversionConfirmation("lead")}
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
  );
}
