function renderFindingSeverityLabel(severity) {
  if (severity === "high") return "Alta";
  if (severity === "medium") return "Media";
  if (severity === "low") return "Baja";
  return "Info";
}

function renderAssessmentLabel(status) {
  if (status === "ready_with_minor_improvements") {
    return "Lista con mejoras menores";
  }
  if (status === "needs_review") return "Requiere revision";
  return "Incompleta";
}

function AccountDraftAnalysisPanel({
  analysis,
  error,
  loading,
  onAnalyze,
  onApplyAdministrativeDescription,
  onApplyCommercialDescription,
  onApplySuggestedWebsite,
  onApplySuggestedEconomicSector,
  onApplySuggestedContactData,
  onApplySuggestedRegistration,
  isDisabled,
}) {
  return (
    <section className="account-form-section account-modal-section account-ai-section">
      <div className="account-ai-toolbar">
        <div>
          <h4>Asistente IA</h4>
          <p className="field-hint account-ai-toolbar-hint">
            Revisa duplicados, calidad del borrador y sugiere una descripcion centrada en que hace la empresa y a que se dedica.
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary account-ai-trigger"
          onClick={onAnalyze}
          disabled={isDisabled || loading}
        >
          {loading ? "Analizando..." : analysis ? "Reanalizar con IA" : "Analizar con IA"}
        </button>
      </div>

      {error && <div className="account-ai-banner error">{error}</div>}

      {!analysis && !error && (
        <div className="account-ai-empty-state">
          Completa al menos nombre y pais, y luego ejecuta el analisis.
        </div>
      )}

      {analysis && (
        <div className="account-ai-results">
          <div className="account-ai-banner">
            <span className={`account-ai-badge ${analysis.overallAssessment.status}`}>
              {renderAssessmentLabel(analysis.overallAssessment.status)}
            </span>
            <span>{analysis.overallAssessment.summary}</span>
          </div>

          {analysis.warnings?.length > 0 && (
            <div className="account-ai-subsection">
              <h5>Advertencias</h5>
              <ul className="account-ai-list compact">
                {analysis.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          {analysis.duplicateWarnings?.length > 0 && (
            <div className="account-ai-subsection">
              <h5>Duplicados potenciales</h5>
              <div className="account-ai-card-list">
                {analysis.duplicateWarnings.map((warning) => (
                  <article key={`${warning.accountId}-${warning.matchReason}`} className="account-ai-card">
                    <div className="account-ai-card-header">
                      <strong>{warning.accountName}</strong>
                      <span className={`account-ai-mini-badge ${warning.severity}`}>
                        {renderFindingSeverityLabel(warning.severity)}
                      </span>
                    </div>
                    <p>{warning.recommendedAction}</p>
                    <dl className="account-ai-meta-grid">
                      <div>
                        <dt>Motivo</dt>
                        <dd>{warning.matchReason}</dd>
                      </div>
                      <div>
                        <dt>Pais</dt>
                        <dd>{warning.country}</dd>
                      </div>
                      {warning.website && (
                        <div>
                          <dt>Website</dt>
                          <dd>{warning.website}</dd>
                        </div>
                      )}
                    </dl>
                  </article>
                ))}
              </div>
            </div>
          )}

          {analysis.dataQualityFindings?.length > 0 && (
            <div className="account-ai-subsection">
              <h5>Hallazgos de calidad</h5>
              <div className="account-ai-card-list">
                {analysis.dataQualityFindings.map((finding) => (
                  <article key={finding.code} className="account-ai-card compact">
                    <div className="account-ai-card-header">
                      <strong>{finding.code}</strong>
                      <span className={`account-ai-mini-badge ${finding.severity}`}>
                        {renderFindingSeverityLabel(finding.severity)}
                      </span>
                    </div>
                    <p>{finding.message}</p>
                  </article>
                ))}
              </div>
            </div>
          )}

          <div className="account-ai-subsection">
            <h5>Descripciones sugeridas sobre la empresa</h5>
            <div className="account-ai-description-grid">
              <article className="account-ai-description-card">
                <div className="account-ai-card-header">
                  <strong>Que hace la empresa</strong>
                  <span className="account-ai-mini-badge info">
                    {analysis.suggestedAdministrativeDescription?.sourceType === "crm_internal"
                      ? "Interna"
                      : "Externa"}
                  </span>
                </div>
                <p>{analysis.suggestedAdministrativeDescription?.text || "Sin sugerencia"}</p>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={onApplyAdministrativeDescription}
                  disabled={!analysis.suggestedAdministrativeDescription?.text}
                >
                  Usar esta descripcion
                </button>
              </article>

              <article className="account-ai-description-card">
                <div className="account-ai-card-header">
                  <strong>Descripcion para contexto comercial</strong>
                  <span className="account-ai-mini-badge info">
                    {analysis.suggestedCommercialDescription?.sourceType === "crm_internal"
                      ? "Interna"
                      : "Externa"}
                  </span>
                </div>
                <p>{analysis.suggestedCommercialDescription?.text || "Sin sugerencia"}</p>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={onApplyCommercialDescription}
                  disabled={!analysis.suggestedCommercialDescription?.text}
                >
                  Usar esta descripcion
                </button>
              </article>
            </div>
          </div>

          <div className="account-ai-subsection">
            <h5>Campos sugeridos</h5>
            <div className="account-ai-description-grid">
              <article className="account-ai-description-card">
                <div className="account-ai-card-header">
                  <strong>Sitio web</strong>
                  <span className="account-ai-mini-badge info">
                    Confianza {analysis.suggestedWebsite?.confidence || "baja"}
                  </span>
                </div>
                <p>{analysis.suggestedWebsite?.value || "No hay sugerencia confiable todavia."}</p>
                <p className="account-ai-note">{analysis.suggestedWebsite?.reason}</p>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={onApplySuggestedWebsite}
                  disabled={!analysis.suggestedWebsite?.canAutoApply}
                >
                  Usar sitio web sugerido
                </button>
              </article>

              <article className="account-ai-description-card">
                <div className="account-ai-card-header">
                  <strong>Registro</strong>
                  <span className="account-ai-mini-badge info">
                    Confianza {analysis.registrationAssistance?.confidence || "baja"}
                  </span>
                </div>
                <p>
                  {analysis.registrationAssistance?.value ||
                    "No hay registro sugerido; se requiere validacion manual."}
                </p>
                <p className="account-ai-note">{analysis.registrationAssistance?.reason}</p>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={onApplySuggestedRegistration}
                  disabled={!analysis.registrationAssistance?.canAutoApply}
                >
                  Usar registro sugerido
                </button>
              </article>

              <article className="account-ai-description-card">
                <div className="account-ai-card-header">
                  <strong>Sector economico</strong>
                  <span className="account-ai-mini-badge info">
                    Confianza {analysis.suggestedEconomicSector?.confidence || "baja"}
                  </span>
                </div>
                <p>
                  {analysis.suggestedEconomicSector?.sectorName ||
                    "No hay sector sugerido confiable todavia."}
                </p>
                <p className="account-ai-note">{analysis.suggestedEconomicSector?.reason}</p>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={onApplySuggestedEconomicSector}
                  disabled={!analysis.suggestedEconomicSector?.canAutoApply}
                >
                  Usar sector sugerido
                </button>
              </article>

              <article className="account-ai-description-card">
                <div className="account-ai-card-header">
                  <strong>Direccion y contacto</strong>
                  <span className="account-ai-mini-badge info">
                    Confianza {analysis.suggestedContactData?.confidence || "baja"}
                  </span>
                </div>
                <p>
                  {analysis.suggestedContactData?.addressLine ||
                  analysis.suggestedContactData?.city ||
                  analysis.suggestedContactData?.stateRegion ||
                  analysis.suggestedContactData?.postalCode
                    ? [
                        analysis.suggestedContactData?.addressLine,
                        analysis.suggestedContactData?.city,
                        analysis.suggestedContactData?.stateRegion,
                        analysis.suggestedContactData?.postalCode,
                      ]
                        .filter(Boolean)
                        .join(", ")
                    : "No hay direccion sugerida todavia."}
                </p>
                <p>
                  {analysis.suggestedContactData?.phone
                    ? `Telefono: ${analysis.suggestedContactData.phone}`
                    : "No hay telefono sugerido todavia."}
                </p>
                <p className="account-ai-note">{analysis.suggestedContactData?.reason}</p>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={onApplySuggestedContactData}
                  disabled={!analysis.suggestedContactData?.canAutoApply}
                >
                  Usar direccion y contacto sugeridos
                </button>
              </article>
            </div>
          </div>

          {analysis.suggestedImprovements?.length > 0 && (
            <div className="account-ai-subsection">
              <h5>Mejoras sugeridas</h5>
              <ul className="account-ai-list">
                {analysis.suggestedImprovements.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {analysis.nextRecommendedStep && (
            <div className="account-ai-subsection">
              <h5>Siguiente paso recomendado</h5>
              <article className="account-ai-card compact">
                <div className="account-ai-card-header">
                  <strong>{analysis.nextRecommendedStep.action}</strong>
                  <span className="account-ai-mini-badge info">
                    Confianza {analysis.confidence || "media"}
                  </span>
                </div>
                <p>{analysis.nextRecommendedStep.reason}</p>
              </article>
            </div>
          )}

          {analysis.evidence?.length > 0 && (
            <div className="account-ai-subsection">
              <h5>Evidencia usada</h5>
              <div className="account-ai-card-list">
                {analysis.evidence.map((item) => (
                  <article key={`${item.sourceType}-${item.label}`} className="account-ai-card compact">
                    <div className="account-ai-card-header">
                      <strong>{item.label}</strong>
                      <span className="account-ai-mini-badge info">{item.sourceType}</span>
                    </div>
                    <p>{item.value}</p>
                  </article>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default AccountDraftAnalysisPanel;