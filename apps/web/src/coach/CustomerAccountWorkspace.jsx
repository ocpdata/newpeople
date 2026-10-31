import { CustomerChatPanel } from "./CustomerChatPanel";
import {
  getCustomerActionStatusClass,
  getCustomerActionStatus,
  formatCurrency,
  groupCustomerProductsByQuotation,
  summarizeCustomerAgents,
  isUsablePublicContactValue,
} from "./miAgentHelpers";
import { formatDate, CUSTOMER_FINDING_CONFIDENCE_LABELS } from "./customerChatShared";
import { CustomerActionResult } from "./MiAgentWidgets";
import { getQuotationStatusTone } from "../quotations/quotationStatusPresentation";
import {
  CUSTOMER_QUOTATION_STATUS_LABELS,
  CUSTOMER_FINDING_CATEGORY_LABELS,
  CUSTOMER_FINDING_STATUS_LABELS,
  CUSTOMER_AGENT_LABELS,
  CUSTOMER_AGENT_STATUS_LABELS,
} from "./miAgentConstants";

export function CustomerAccountWorkspace({ askCustomerChat, canCreateActions, canDiagnoseCustomerChats, canExecuteCoach, canReviewCustomerOperation, canUpdateCalendar, canUpdateContacts, canUseExternalSources, customerAccountId, customerAccountSearch, customerActionErrors, customerAgentsJob, customerAgentsLoading, customerAnalysisSnapshot, customerChat, customerChatLoading, customerDiscoveryJob, customerDiscoveryPreparing, customerExecutiveBriefingJob, customerExecutiveBriefingLoading, customerFindings, customerFocusOpportunityId, customerFocusOptions, customerIntelligenceError, customerIntelligenceJob, customerIntelligenceResultRef, customerInvestigating, customerSnapshot, customerSnapshotLoading, hasCustomerContext, navigate, openCustomerAction, openCustomerChatOperation, openCustomerStageAnswerPrefill, openDiscoveryActivity, prepareCustomerCall, prepareCustomerExecutiveBriefing, runCustomerAgents, runCustomerInvestigation, savingCoachOperation, searchCustomerAccounts, selectCustomerAccount, selectedCustomerAccount, setCustomerActionResultOpen, setCustomerFocusOpportunityId, sortedCustomerAccounts }) {
  return (
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
            {sortedCustomerAccounts.map((account) => (
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
          {!customerAnalysisSnapshot ? (
            <p className="field-hint">
              Analiza la cuenta para revisar su salud, historial y
              oportunidades de desarrollo. El chat ya está disponible.
            </p>
          ) : null}
        </section>
      ) : (
        <div className="mi-agent-empty">
          Selecciona una cuenta para revisar salud, riesgos e historial
          comercial.
        </div>
      )}
      <CustomerChatPanel
        chat={customerChat}
        navigate={navigate}
        hasCustomerContext={hasCustomerContext}
        customerIntelligenceError={customerIntelligenceError}
        customerFocusOptions={customerFocusOptions}
        customerFocusOpportunityId={customerFocusOpportunityId}
        setCustomerFocusOpportunityId={setCustomerFocusOpportunityId}
        canCreateActions={canCreateActions}
        canExecuteCoach={canExecuteCoach}
        canUpdateCalendar={canUpdateCalendar}
        canDiagnoseCustomerChats={canDiagnoseCustomerChats}
        canReviewCustomerOperation={canReviewCustomerOperation}
        savingCoachOperation={savingCoachOperation}
        openCustomerStageAnswerPrefill={openCustomerStageAnswerPrefill}
        openDiscoveryActivity={openDiscoveryActivity}
        openCustomerChatOperation={openCustomerChatOperation}
      />
      {customerSnapshotLoading ? (
        <p className="field-hint">Cargando contexto de la cuenta...</p>
      ) : null}
      <div className="mi-agent-customer-actions mi-agent-customer-operation-list">
        <section
          className="mi-agent-customer-operation is-account-analysis"
          aria-label="Analizar cuenta"
        >
          <header className="mi-agent-customer-operation-heading is-result-heading">
            <button
              type="button"
              className="mi-agent-primary-button"
              onClick={runCustomerInvestigation}
              disabled={customerInvestigating || !hasCustomerContext}
            >
              {customerInvestigating
                ? "Analizando..."
                : customerAnalysisSnapshot
                  ? "Actualizar análisis"
                  : "Analizar cuenta"}
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
                {customerIntelligenceJob?.status === "completed" &&
                customerAnalysisSnapshot
                  ? customerIntelligenceJob.result.summary
                  : customerInvestigating
                    ? "Analizando información interna..."
                    : customerAnalysisSnapshot
                      ? "Se conserva el último análisis completado."
                      : "El análisis interno aún no se ha ejecutado."}
              </p>
              {customerAnalysisSnapshot ? (
                <p className="field-hint">
                  Fecha del análisis:{" "}
                  {formatDate(customerAnalysisSnapshot.capturedAt)}
                  {customerInvestigating || customerActionErrors.analysis
                    ? " · Resultado anterior; pendiente de actualización."
                    : ""}
                </p>
              ) : null}
              {customerActionErrors.analysis ? (
                <p className="form-error">
                  {customerActionErrors.analysis}
                </p>
              ) : null}
            </div>
          </header>
          {customerAnalysisSnapshot ? (
            <CustomerActionResult
              label="Ver análisis completo"
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
                    : "El detalle del análisis aparecerá aquí."
              }
              open={openCustomerAction === "analysis"}
              onToggle={(isOpen) =>
                setCustomerActionResultOpen("analysis", isOpen)
              }
            >
            <>
              <section aria-label="Resumen comercial de cuenta">
                <div className="mi-agent-customer-overview-grid">
                  <article>
                    <span>Última actividad registrada</span>
                    <strong>
                      {customerAnalysisSnapshot.interactions?.[0]
                        ?.updatedAt
                        ? formatDate(
                            customerAnalysisSnapshot.interactions[0].updatedAt,
                          )
                        : "Sin actividad accesible"}
                    </strong>
                    <small>
                      {customerAnalysisSnapshot.interactions?.[0]?.title ||
                        "Fuente: interacciones CRM"}
                    </small>
                  </article>
                  <article>
                    <span>Sitio web</span>
                    <strong>
                      {customerAnalysisSnapshot.account.website ||
                        "Sin registrar"}
                    </strong>
                    <small>
                      {customerAnalysisSnapshot.account.registrationCode ||
                        "Sin código de registro"}
                    </small>
                  </article>
                  <article>
                    <span>Relación comercial</span>
                    <strong>
                      {customerAnalysisSnapshot.accountHealth?.metrics
                        ?.opportunityCount || 0}{" "}
                      oportunidades ·{" "}
                      {customerAnalysisSnapshot.contacts?.length || 0} contactos
                    </strong>
                    <small>Datos CRM autorizados</small>
                  </article>
                  {customerAnalysisSnapshot.permissions?.canReadOpportunities ? (
                    <article>
                      <span>Pipeline abierto</span>
                      <strong>
                        {formatCurrency(
                          (customerAnalysisSnapshot.opportunities || [])
                            .filter((opportunity) => opportunity.lifecycle === "open")
                            .reduce(
                              (total, opportunity) =>
                                total + Number(opportunity.amountUsd || 0),
                              0,
                            ),
                          "USD",
                        )}
                      </strong>
                      <small>Solo oportunidades activas y abiertas</small>
                    </article>
                  ) : null}
                </div>
                {customerAnalysisSnapshot.account.description ? (
                  <p className="mi-agent-customer-summary">
                    {customerAnalysisSnapshot.account.description}
                  </p>
                ) : null}
              </section>
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
                              canUpdateCalendar ? (
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
                    ) : canExecuteCoach && canUpdateCalendar ? (
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
                          canUpdateCalendar &&
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
            </>
              {customerIntelligenceJob ? (
                <div className="mi-agent-intelligence-summary">
                  <article>
                    <span>Estado</span>
                    <strong>
                      {customerInvestigating || customerActionErrors.analysis
                        ? "Resultado anterior"
                        : customerIntelligenceJob.status === "completed"
                          ? "Completado"
                          : customerIntelligenceJob.status === "failed"
                            ? "Fallido"
                            : "En proceso"}
                    </strong>
                  </article>
                  <article>
                    <span>Hallazgos adicionales</span>
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
                          (finding) => finding.certainty === "confirmed",
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
                  No hay hallazgos adicionales. La información está
                  consolidada en las secciones del análisis.
                </div>
              ) : !customerIntelligenceJob && !customerInvestigating ? (
                <p className="field-hint">
                  Ejecuta el análisis para revisar el resumen y los hallazgos
                  internos de la cuenta.
                </p>
              ) : null}
            </CustomerActionResult>
          ) : null}
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
                          {action.opportunityId && canUpdateCalendar ? (
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
                      {step.opportunityId && canUpdateCalendar ? (
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
  );
}
