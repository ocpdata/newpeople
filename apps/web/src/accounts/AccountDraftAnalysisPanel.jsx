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

function normalizeText(value) {
  return String(value || "").trim();
}

function isSuggestedContactDataApplied(form, suggestedContactData) {
  if (!form || !suggestedContactData?.canAutoApply) return false;

  const comparableFields = [
    ["addressLine", suggestedContactData.addressLine],
    ["city", suggestedContactData.city],
    ["stateRegion", suggestedContactData.stateRegion],
    ["postalCode", suggestedContactData.postalCode],
    ["phone", suggestedContactData.phone],
  ].filter(([, value]) => normalizeText(value));

  if (!comparableFields.length) return false;

  return comparableFields.every(
    ([fieldName, value]) =>
      normalizeText(form[fieldName]) === normalizeText(value),
  );
}

function renderSuggestedFieldCard({
  title,
  value,
  applied,
  onApply,
  disabled,
  emptyLabel,
  applyLabel,
  appliedLabel,
}) {
  return (
    <article className="account-ai-description-card account-ai-description-card-compact">
      <div className="account-ai-card-header">
        <strong>{title}</strong>
        <div className="account-ai-card-header-actions">
          {applied ? (
            <span className="account-ai-mini-badge info">Aplicado</span>
          ) : null}
          <button
            type="button"
            className="account-ai-suggestion-icon-button"
            onClick={onApply}
            disabled={disabled}
            aria-label={applied ? appliedLabel : applyLabel}
            title={applied ? appliedLabel : applyLabel}
          >
            {applied ? "✓" : "↗"}
          </button>
        </div>
      </div>
      <p className="account-ai-suggestion-value" title={value || emptyLabel}>
        {value || emptyLabel}
      </p>
    </article>
  );
}

function AccountDraftAnalysisPanel({
  analysis,
  error,
  loading,
  onAnalyze,
  onApplySuggestedCompanyDescription,
  onApplySuggestedWebsite,
  onApplySuggestedEconomicSector,
  onApplySuggestedContactData,
  onApplySuggestedRegistration,
  isDisabled,
  form,
}) {
  const isSuggestedWebsiteApplied =
    analysis?.suggestedWebsite?.canAutoApply &&
    normalizeText(form?.website) ===
      normalizeText(analysis?.suggestedWebsite?.value);
  const isSuggestedCompanyDescriptionApplied =
    normalizeText(form?.companyDescription) ===
    normalizeText(analysis?.suggestedCompanyDescription?.text);
  const isSuggestedRegistrationApplied =
    analysis?.registrationAssistance?.canAutoApply &&
    normalizeText(form?.registrationCode) ===
      normalizeText(analysis?.registrationAssistance?.value);
  const isSuggestedEconomicSectorApplied =
    analysis?.suggestedEconomicSector?.canAutoApply &&
    String(form?.economicSectorId || "") ===
      String(analysis?.suggestedEconomicSector?.sectorId || "");
  const isSuggestedContactApplied = isSuggestedContactDataApplied(
    form,
    analysis?.suggestedContactData,
  );
  const suggestedContactFields = [
    {
      key: "addressLine",
      title: "Direccion",
      value: normalizeText(analysis?.suggestedContactData?.addressLine),
      applied:
        normalizeText(analysis?.suggestedContactData?.addressLine) &&
        normalizeText(form?.addressLine) ===
          normalizeText(analysis?.suggestedContactData?.addressLine),
      emptyLabel: "No hay direccion sugerida todavia.",
    },
    {
      key: "city",
      title: "Ciudad",
      value: normalizeText(analysis?.suggestedContactData?.city),
      applied:
        normalizeText(analysis?.suggestedContactData?.city) &&
        normalizeText(form?.city) ===
          normalizeText(analysis?.suggestedContactData?.city),
      emptyLabel: "No hay ciudad sugerida todavia.",
    },
    {
      key: "stateRegion",
      title: "Estado",
      value: normalizeText(analysis?.suggestedContactData?.stateRegion),
      applied:
        normalizeText(analysis?.suggestedContactData?.stateRegion) &&
        normalizeText(form?.stateRegion) ===
          normalizeText(analysis?.suggestedContactData?.stateRegion),
      emptyLabel: "No hay estado sugerido todavia.",
    },
    {
      key: "postalCode",
      title: "Codigo postal",
      value: normalizeText(analysis?.suggestedContactData?.postalCode),
      applied:
        normalizeText(analysis?.suggestedContactData?.postalCode) &&
        normalizeText(form?.postalCode) ===
          normalizeText(analysis?.suggestedContactData?.postalCode),
      emptyLabel: "No hay codigo postal sugerido todavia.",
    },
    {
      key: "phone",
      title: "Telefono",
      value: normalizeText(analysis?.suggestedContactData?.phone),
      applied:
        normalizeText(analysis?.suggestedContactData?.phone) &&
        normalizeText(form?.phone) ===
          normalizeText(analysis?.suggestedContactData?.phone),
      emptyLabel: "No hay telefono sugerido todavia.",
    },
  ];

  return (
    <section className="account-form-section account-modal-section account-ai-section">
      <div className="account-ai-toolbar">
        <div>
          <h4>Asistente IA</h4>
          <p className="field-hint account-ai-toolbar-hint">
            Revisa duplicados, calidad del borrador y sugiere una descripcion
            centrada en que hace la empresa y a que se dedica.
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary account-ai-trigger"
          onClick={onAnalyze}
          disabled={isDisabled || loading}
        >
          {loading
            ? "Analizando..."
            : analysis
              ? "Reanalizar con IA"
              : "Analizar con IA"}
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
            <span
              className={`account-ai-badge ${analysis.overallAssessment.status}`}
            >
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
                  <article
                    key={`${warning.accountId}-${warning.matchReason}`}
                    className="account-ai-card"
                  >
                    <div className="account-ai-card-header">
                      <strong>{warning.accountName}</strong>
                      <span
                        className={`account-ai-mini-badge ${warning.severity}`}
                      >
                        {renderFindingSeverityLabel(warning.severity)}
                      </span>
                    </div>
                    <p>
                      {warning.severityMessage || warning.recommendedAction}
                    </p>
                    <dl className="account-ai-meta-grid">
                      <div>
                        <dt>Motivo</dt>
                        <dd>{warning.reasonLabel || warning.matchReason}</dd>
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

          <div className="account-ai-subsection">
            <h5>Campos sugeridos</h5>
            <div className="account-ai-description-grid">
              {renderSuggestedFieldCard({
                title: "Descripcion de la empresa",
                value: analysis.suggestedCompanyDescription?.text,
                applied: isSuggestedCompanyDescriptionApplied,
                onApply: onApplySuggestedCompanyDescription,
                disabled:
                  !analysis.suggestedCompanyDescription?.text ||
                  isSuggestedCompanyDescriptionApplied,
                emptyLabel: "Sin sugerencia.",
                applyLabel: "Usar descripcion sugerida",
                appliedLabel: "Descripcion aplicada",
              })}

              {renderSuggestedFieldCard({
                title: "Pagina web",
                value: analysis.suggestedWebsite?.value,
                applied: isSuggestedWebsiteApplied,
                onApply: onApplySuggestedWebsite,
                disabled:
                  !analysis.suggestedWebsite?.canAutoApply ||
                  isSuggestedWebsiteApplied,
                emptyLabel: "No hay sugerencia confiable todavia.",
                applyLabel: "Usar sitio web sugerido",
                appliedLabel: "Sitio web aplicado",
              })}

              {renderSuggestedFieldCard({
                title: "Registro",
                value: analysis.registrationAssistance?.value,
                applied: isSuggestedRegistrationApplied,
                onApply: onApplySuggestedRegistration,
                disabled:
                  !analysis.registrationAssistance?.canAutoApply ||
                  isSuggestedRegistrationApplied,
                emptyLabel:
                  "No hay registro sugerido; se requiere validacion manual.",
                applyLabel: "Usar registro sugerido",
                appliedLabel: "Registro aplicado",
              })}

              {renderSuggestedFieldCard({
                title: "Sector economico",
                value: analysis.suggestedEconomicSector?.sectorName,
                applied: isSuggestedEconomicSectorApplied,
                onApply: onApplySuggestedEconomicSector,
                disabled:
                  !analysis.suggestedEconomicSector?.canAutoApply ||
                  isSuggestedEconomicSectorApplied,
                emptyLabel: "No hay sector sugerido confiable todavia.",
                applyLabel: "Usar sector sugerido",
                appliedLabel: "Sector aplicado",
              })}

              {suggestedContactFields.map((field) =>
                renderSuggestedFieldCard({
                  title: field.title,
                  value: field.value,
                  applied: field.applied,
                  onApply: onApplySuggestedContactData,
                  disabled:
                    !analysis.suggestedContactData?.canAutoApply ||
                    isSuggestedContactApplied ||
                    !field.value,
                  emptyLabel: field.emptyLabel,
                  applyLabel: "Usar valor sugerido",
                  appliedLabel: "Aplicado",
                }),
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default AccountDraftAnalysisPanel;
