import { normalizeText } from "./quotationsUtils";

const COMMERCIAL_TERM_LABELS = {
  deliveryTime: "Entrega",
  quotationValidity: "Validez",
  warranty: "Garantia",
  paymentTerms: "Pago",
  currencyCode: "Moneda",
};

const COMMERCIAL_TERM_ORDER = [
  "deliveryTime",
  "quotationValidity",
  "warranty",
  "paymentTerms",
  "currencyCode",
];
const SUGGESTED_MATCH_STATUSES = [
  "suggested_match_pending_confirmation",
  "ambiguous_similar_match",
];

function getSuggestedMatchCandidateLabel(item) {
  const candidate = item?.effectiveMatchedCandidate;
  if (!candidate) {
    return "";
  }

  return `${candidate.code || "Item"} · ${candidate.description || ""}`.trim();
}

function getProviderImportItemStatusLabel(item) {
  if (item.effectiveMatchStatus === "matched") {
    return item.resolutionAction === "use_existing"
      ? "Existente confirmado"
      : "Existe en lista";
  }
  if (item.matchStatus === "matched") {
    return "Existe en lista";
  }
  if (item.resolutionRequired) {
    return item.matchStatus === "ambiguous_similar_match"
      ? "Coincidencia ambigua"
      : "Coincidencia sugerida";
  }
  if (item.effectiveMatchStatus === "missing_in_price_list") {
    return item.canCreateInPriceList
      ? "Faltante listo para crear"
      : "Faltante con bloqueo";
  }
  if (item.effectiveMatchStatus === "missing_price_list") {
    return "Proveedor sin lista activa";
  }
  return "Confirma proveedor";
}

function formatCommercialTermValue(field, value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) {
    return "";
  }

  const normalizedValue = normalizeText(rawValue).replace(/[_-]+/g, " ");

  if (field === "currencyCode") {
    return rawValue.toUpperCase();
  }

  if (normalizedValue === "segun notas" || normalizedValue === "segun_notas") {
    return "De acuerdo a lo indicado en notas";
  }

  if (
    normalizedValue === "de acuerdo a lo indicado en notas" ||
    normalizedValue === "according to notes" ||
    normalizedValue === "as indicated in notes"
  ) {
    return "De acuerdo a lo indicado en notas";
  }

  const dayMatch = normalizedValue.match(/^(\d+)\s*(?:dias?|days?)$/u);
  if (dayMatch) {
    return `${dayMatch[1]} dias`;
  }

  const yearMatch = normalizedValue.match(/^(\d+)\s*(?:anos?|years?)$/u);
  if (yearMatch) {
    return `${yearMatch[1]} ${yearMatch[1] === "1" ? "ano" : "anos"}`;
  }

  if (
    normalizedValue === "inmediato" ||
    normalizedValue === "immediate" ||
    normalizedValue === "immediately"
  ) {
    return "Inmediato";
  }

  if (
    normalizedValue === "contado" ||
    normalizedValue === "cash" ||
    normalizedValue === "cash in advance" ||
    normalizedValue === "advance payment" ||
    normalizedValue === "100 adelantado" ||
    normalizedValue === "100% adelantado" ||
    normalizedValue === "100 advance" ||
    normalizedValue === "100% advance" ||
    normalizedValue === "100 upfront" ||
    normalizedValue === "100% upfront" ||
    normalizedValue === "100_adelantado"
  ) {
    return "100% adelantado";
  }

  if (
    normalizedValue === "50 adelantado 50 entrega" ||
    normalizedValue === "50% adelantado 50% contra entrega" ||
    normalizedValue === "50 anticipo y saldo contra entrega" ||
    normalizedValue === "50 advance 50 on delivery" ||
    normalizedValue === "50% advance 50% on delivery" ||
    normalizedValue === "50_adelantado_50_entrega"
  ) {
    return "50% adelantado - 50% contra entrega";
  }

  if (
    normalizedValue === "100 entrega" ||
    normalizedValue === "100% contra entrega" ||
    normalizedValue === "100 on delivery" ||
    normalizedValue === "100% on delivery" ||
    normalizedValue === "100_entrega"
  ) {
    return "100% contra entrega";
  }

  const invoicedDaysMatch = normalizedValue.match(
    /^(\d+)\s*(?:dias?|days?)\s*(?:despues de facturado|after invoiced|after invoice|after billing|net)$/u,
  );
  if (invoicedDaysMatch) {
    return `${invoicedDaysMatch[1]} dias despues de facturado`;
  }

  const netDaysMatch = normalizedValue.match(/^net\s*(\d+)$/u);
  if (netDaysMatch) {
    return `${netDaysMatch[1]} dias despues de facturado`;
  }

  if (["deliveryTime", "quotationValidity"].includes(field)) {
    const deliveryDaysMatch = normalizedValue.match(/^(\d+)\s*dias$/u);
    if (deliveryDaysMatch) {
      return `${deliveryDaysMatch[1]} dias`;
    }
  }

  return rawValue;
}

function QuotationProviderDocumentImportModal({
  isOpen,
  documents,
  providerOptions,
  selectedDocumentId,
  onDocumentChange,
  confirmedProviderId,
  onProviderChange,
  onClose,
  onAnalyze,
  preview,
  effectiveItems,
  workflowStage,
  previewJob,
  loadingPreview,
  creatingMissingItems,
  applying,
  commercialTermsSelection,
  onToggleCommercialTermSelection,
  onSelectSuggestedMatchCandidate,
  onResolveSuggestedMatch,
  missingItemsSelection,
  onToggleMissingItemSelection,
  onCreateMissingItems,
  onApply,
}) {
  if (!isOpen) {
    return null;
  }

  const previewItems = Array.isArray(effectiveItems)
    ? effectiveItems
    : Array.isArray(preview?.items)
      ? preview.items
      : [];
  const activeProviders = Array.isArray(preview?.activeProviders)
    ? preview.activeProviders
    : Array.isArray(providerOptions)
      ? providerOptions
      : [];
  const priorImports = Array.isArray(preview?.priorImports)
    ? preview.priorImports
    : [];
  const previewJobStatus = String(previewJob?.status || "").trim();
  const previewJobLabel = String(previewJob?.progress?.label || "").trim();
  const previewJobPercent = Number(previewJob?.progress?.percent || 0) || 0;
  const suggestedMatchItems = previewItems.filter(
    (item) => item.resolutionRequired,
  );
  const suggestedMatchSourceItems = previewItems.filter((item) =>
    SUGGESTED_MATCH_STATUSES.includes(
      item.originalMatchStatus || item.matchStatus,
    ),
  );
  const resolvedSuggestedMatchItems = suggestedMatchSourceItems.filter(
    (item) => !item.resolutionRequired,
  );
  const selectedCreatableMissingItems = previewItems.filter(
    (item) =>
      item.effectiveMatchStatus === "missing_in_price_list" &&
      item.canCreateInPriceList &&
      missingItemsSelection?.[String(item.previewId)],
  );
  const blockedMissingItems = previewItems.filter(
    (item) =>
      item.effectiveMatchStatus === "missing_in_price_list" &&
      !item.canCreateInPriceList,
  );
  const canApply =
    workflowStage === "ready_to_apply" &&
    Boolean(preview) &&
    Boolean(confirmedProviderId) &&
    previewItems.some((item) => item.effectiveMatchStatus === "matched");
  const termSelection = commercialTermsSelection || {};

  return (
    <div
      className="quotation-provider-import-modal quotation-provider-import-modal-inline"
      role="region"
      aria-labelledby="quotation-provider-import-title"
    >
      <div className="modal-header">
        <div>
          <h3 id="quotation-provider-import-title">
            Crear items desde documento con IA
          </h3>
          <p className="field-hint">
            La IA propone proveedor, condiciones e items. El usuario confirma
            antes de aplicar.
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={onClose}>
          Cerrar
        </button>
      </div>

      <div className="quotation-provider-import-body">
        <div className="quotation-provider-import-grid">
          <label className="field-group">
            <span>Documento</span>
            <select
              value={selectedDocumentId}
              onChange={(event) => onDocumentChange(event.target.value)}
            >
              <option value="">
                {documents.length
                  ? "Selecciona un documento"
                  : "No hay documentos habilitados para IA"}
              </option>
              {documents.map((document) => {
                const optionValue = String(document.id || "");
                return (
                  <option key={optionValue} value={optionValue}>
                    {document.originalFileName || "Documento"}
                  </option>
                );
              })}
            </select>
          </label>

          <label className="field-group">
            <span>Proveedor confirmado</span>
            <select
              value={confirmedProviderId}
              onChange={(event) => onProviderChange(event.target.value)}
              disabled={!activeProviders.length && !preview}
            >
              <option value="">Selecciona un proveedor</option>
              {activeProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {!documents.length ? (
          <div className="quotation-provider-import-warning">
            <strong>Sin documentos elegibles</strong>
            <ul>
              <li>No hay documentos habilitados para IA en esta cotización.</li>
            </ul>
          </div>
        ) : null}

        <div className="quotation-provider-import-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={onAnalyze}
            disabled={!selectedDocumentId || loadingPreview}
          >
            {loadingPreview
              ? "Analizando en background..."
              : "Analizar documento"}
          </button>
        </div>

        {previewJob ? (
          <div className="quotation-provider-import-job-status">
            <div className="quotation-provider-import-job-status-row">
              <strong>
                Estado del analisis: {previewJobStatus || "pending"}
              </strong>
              <span>{Math.max(0, Math.min(100, previewJobPercent))}%</span>
            </div>
            <p>
              {previewJobLabel ||
                (loadingPreview
                  ? "Analizando documento del proveedor"
                  : "Analisis preparado")}
            </p>
          </div>
        ) : null}

        {preview ? (
          <>
            <div className="quotation-provider-import-summary">
              <div className="quotation-provider-import-summary-card">
                <strong>Proveedor sugerido</strong>
                <span>{preview.suggestedProviderName || "Sin sugerencia"}</span>
              </div>
              <div className="quotation-provider-import-summary-card">
                <strong>Sección destino</strong>
                <span>
                  {preview.suggestedSectionName || "Seccion sugerida"}
                </span>
              </div>
              <div className="quotation-provider-import-summary-card">
                <strong>Lista activa</strong>
                <span>
                  {preview.activePriceList
                    ? `${preview.activePriceList.name} (${preview.activePriceList.currencyCode})`
                    : "Pendiente de proveedor o lista activa"}
                </span>
              </div>
            </div>

            {priorImports.length ? (
              <div className="quotation-provider-import-warning">
                <strong>Advertencia de reutilización</strong>
                <ul>
                  {priorImports.map((item) => (
                    <li key={item.id}>
                      V{item.versionNumber} · {item.sectionTitle} ·{" "}
                      {item.requestedByUserName}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <section className="quotation-provider-import-items-section">
              <div className="quotation-provider-import-table-intro">
                <strong>Items identificados</strong>
                <p>
                  Esta tabla contiene los items que la IA extrajo del documento.
                  Las resoluciones ajustan el estado de cada fila; el contenido
                  base del documento se conserva para revisar y confirmar antes
                  de aplicar.
                </p>
              </div>

              <div className="quotation-provider-import-table-wrap">
                <table className="commercial-planning-table quotation-provider-import-table">
                  <thead>
                    <tr>
                      <th>Crear</th>
                      <th>Código</th>
                      <th>Descripción</th>
                      <th>Cant.</th>
                      <th>Moneda</th>
                      <th>Costo resuelto</th>
                      <th>Estado</th>
                      <th>Warnings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewItems.map((item) => (
                      <tr
                        key={item.previewId || item.providerCode}
                        className={
                          item.effectiveMatchStatus === "matched"
                            ? "quotation-provider-import-table-row-is-resolved"
                            : item.resolutionRequired
                              ? "quotation-provider-import-table-row-is-pending"
                              : ""
                        }
                      >
                        <td>
                          {item.effectiveMatchStatus ===
                          "missing_in_price_list" ? (
                            item.canCreateInPriceList ? (
                              <input
                                type="checkbox"
                                checked={Boolean(
                                  missingItemsSelection?.[
                                    String(item.previewId)
                                  ],
                                )}
                                onChange={(event) =>
                                  onToggleMissingItemSelection(
                                    item.previewId,
                                    event.target.checked,
                                  )
                                }
                              />
                            ) : (
                              <span className="quotation-provider-import-muted">
                                No
                              </span>
                            )
                          ) : (
                            <span className="quotation-provider-import-muted">
                              -
                            </span>
                          )}
                        </td>
                        <td>{item.providerCode}</td>
                        <td>{item.productDescription}</td>
                        <td>{item.quantity}</td>
                        <td>{item.originalCurrencyCode || "USD"}</td>
                        <td>{item.resolvedCostUnit}</td>
                        <td>
                          <div className="quotation-provider-import-status-cell">
                            <strong>
                              {getProviderImportItemStatusLabel(item)}
                            </strong>
                            {item.effectiveMatchStatus === "matched" &&
                            item.effectiveMatchedCandidate ? (
                              <span>
                                {item.resolutionAction === "use_existing"
                                  ? "Vinculado a"
                                  : "Coincide con"}{" "}
                                {item.effectiveMatchedCandidate.code ||
                                  "item existente"}
                              </span>
                            ) : item.resolutionRequired ? (
                              <span>Pendiente de confirmación</span>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          {(item.warnings || []).length ||
                          item.suggestedMatchReason ||
                          item.createBlockedReason ? (
                            <ul>
                              {item.suggestedMatchReason ? (
                                <li>{item.suggestedMatchReason}</li>
                              ) : null}
                              {item.createBlockedReason ? (
                                <li>{item.createBlockedReason}</li>
                              ) : null}
                              {item.warnings.map((warning, index) => (
                                <li key={`${item.previewId}-${index}`}>
                                  {warning}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span>Sin warnings</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!previewItems.length ? (
                      <tr>
                        <td colSpan="8" className="centered">
                          La IA no encontró items utilizables en el documento.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="quotation-provider-import-conditions-section">
              <strong>Condiciones encontradas</strong>
              <p>
                Marca las condiciones comerciales encontradas que deseas aplicar
                a la cotizacion.
              </p>
              <div className="quotation-provider-import-terms">
                <div className="quotation-provider-import-terms-grid">
                  {COMMERCIAL_TERM_ORDER.map((field) => (
                    <label
                      key={field}
                      className="quotation-provider-import-term-card"
                    >
                      <span className="quotation-provider-import-term-title">
                        <input
                          type="checkbox"
                          checked={Boolean(termSelection[field])}
                          onChange={(event) =>
                            onToggleCommercialTermSelection(
                              field,
                              event.target.checked,
                            )
                          }
                        />
                        <strong>{COMMERCIAL_TERM_LABELS[field]}</strong>
                      </span>
                      <span>
                        {formatCommercialTermValue(
                          field,
                          preview.commercialTerms?.[field] ||
                            (field === "currencyCode" ? "USD" : "30 dias"),
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </section>

            {workflowStage === "blocked_missing_price_list" ? (
              <div className="quotation-provider-import-warning">
                <strong>Importacion bloqueada</strong>
                <ul>
                  <li>
                    El proveedor confirmado no tiene una lista activa de
                    productos. Crea o activa la lista antes de continuar.
                  </li>
                </ul>
              </div>
            ) : null}

            {workflowStage === "provider_mismatch_confirmation_required" ? (
              <div className="quotation-provider-import-warning">
                <strong>Proveedor por revisar</strong>
                <ul>
                  <li>
                    El proveedor confirmado no coincide con el proveedor
                    sugerido por la IA.
                  </li>
                  {preview.suggestedProviderCandidate?.name ? (
                    <li>
                      Proveedor sugerido:{" "}
                      {preview.suggestedProviderCandidate.name}
                    </li>
                  ) : null}
                </ul>
              </div>
            ) : null}

            {suggestedMatchItems.length ? (
              <div className="quotation-provider-import-warning">
                <strong>Coincidencias sugeridas pendientes</strong>
                <ul>
                  <li>
                    Se detectaron coincidencias probables con items ya
                    existentes en la lista del proveedor. Debes confirmarlas o
                    tratarlas como faltantes antes de continuar.
                  </li>
                  {resolvedSuggestedMatchItems.length ? (
                    <li>
                      {resolvedSuggestedMatchItems.length} coincidencia
                      {resolvedSuggestedMatchItems.length === 1 ? "" : "s"} ya
                      resuelta
                      {resolvedSuggestedMatchItems.length === 1 ? "" : "s"}.
                    </li>
                  ) : null}
                </ul>
              </div>
            ) : null}

            {resolvedSuggestedMatchItems.length ? (
              <div className="quotation-provider-import-resolved-matches">
                <strong>Coincidencias resueltas</strong>
                <div className="quotation-provider-import-resolved-matches-list">
                  {resolvedSuggestedMatchItems.map((item) => (
                    <div
                      key={`resolved-${item.previewId}`}
                      className="quotation-provider-import-resolved-match-card"
                    >
                      <div>
                        <strong>{item.providerCode}</strong>
                        <p>{item.productDescription}</p>
                      </div>
                      <span className="quotation-provider-import-resolved-match-badge">
                        Confirmado como existente
                      </span>
                      {getSuggestedMatchCandidateLabel(item) ? (
                        <span className="quotation-provider-import-resolved-match-link">
                          {getSuggestedMatchCandidateLabel(item)}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {suggestedMatchItems.length ? (
              <div className="quotation-provider-import-suggestions">
                <strong>Resolver coincidencias sugeridas</strong>
                <div className="quotation-provider-import-suggestions-list">
                  {suggestedMatchItems.map((item) => {
                    const candidates = Array.isArray(
                      item.suggestedMatchCandidates,
                    )
                      ? item.suggestedMatchCandidates
                      : [];
                    return (
                      <div
                        key={`suggested-${item.previewId}`}
                        className="quotation-provider-import-suggestion-card"
                      >
                        <div className="quotation-provider-import-suggestion-header">
                          <div>
                            <strong>{item.providerCode}</strong>
                            <p>{item.productDescription}</p>
                          </div>
                          <span className="quotation-provider-import-suggestion-reason">
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M12 3a9 9 0 1 0 9 9 9.01 9.01 0 0 0-9-9Zm0 13a1.25 1.25 0 1 1 1.25-1.25A1.25 1.25 0 0 1 12 16Zm1.45-4.34-.38.26a1.48 1.48 0 0 0-.57 1.17v.16h-1.5v-.22a2.96 2.96 0 0 1 1.24-2.42l.39-.27a1.3 1.3 0 0 0-1.39-2.2 1.28 1.28 0 0 0-.62 1.11H9.12a2.78 2.78 0 0 1 1.35-2.4 2.81 2.81 0 0 1 3 .03 2.8 2.8 0 0 1-.02 4.48Z" />
                            </svg>
                            {item.suggestedMatchReason ||
                              "Coincidencia sugerida por codigo"}
                          </span>
                        </div>
                        {candidates.length > 1 ? (
                          <label className="field-group quotation-provider-import-suggestion-select">
                            <span>Item existente sugerido</span>
                            <select
                              value={
                                item.selectedSuggestedPriceListItemId || ""
                              }
                              onChange={(event) =>
                                onSelectSuggestedMatchCandidate(
                                  item.previewId,
                                  event.target.value,
                                )
                              }
                            >
                              <option value="">
                                Selecciona un item existente
                              </option>
                              {candidates.map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>
                                  {candidate.code} · {candidate.description}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : candidates[0] ? (
                          <div className="quotation-provider-import-suggestion-candidate">
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="m9.55 16.2-3.8-3.8 1.06-1.06 2.74 2.74 7.64-7.64 1.06 1.06Z" />
                            </svg>
                            <strong>{candidates[0].code}</strong>
                            <span>{candidates[0].description}</span>
                          </div>
                        ) : null}
                        <div className="quotation-provider-import-suggestion-actions">
                          <button
                            type="button"
                            className="btn-secondary quotation-provider-import-suggestion-btn"
                            onClick={() =>
                              onResolveSuggestedMatch(
                                item.previewId,
                                "use_existing",
                              )
                            }
                            disabled={
                              candidates.length > 1 &&
                              !item.selectedSuggestedPriceListItemId
                            }
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="m9.55 16.2-3.8-3.8 1.06-1.06 2.74 2.74 7.64-7.64 1.06 1.06Z" />
                            </svg>
                            Usar existente
                          </button>
                          <button
                            type="button"
                            className="btn-secondary quotation-provider-import-suggestion-btn"
                            onClick={() =>
                              onResolveSuggestedMatch(
                                item.previewId,
                                "treat_as_missing",
                              )
                            }
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M6 6h12v1.5H6Zm2 3h8l-.54 9.2A1.8 1.8 0 0 1 13.66 20h-3.32a1.8 1.8 0 0 1-1.8-1.8Zm2.25-4.5h3.5V6h-3.5Z" />
                            </svg>
                            Tratar como faltante
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {previewItems.some(
              (item) => item.effectiveMatchStatus === "missing_in_price_list",
            ) ? (
              <div className="quotation-provider-import-missing-confirmation">
                <strong>Etapa 1: crear faltantes en lista</strong>
                <p>
                  Selecciona solo los items faltantes que deben crearse en la
                  lista activa del proveedor antes de aplicarlos a la
                  cotizacion.
                </p>
                {blockedMissingItems.length ? (
                  <div className="quotation-provider-import-inline-warning">
                    {blockedMissingItems.length} item
                    {blockedMissingItems.length === 1 ? "" : "s"} no se
                    {blockedMissingItems.length === 1 ? " puede" : " pueden"}
                    crear automaticamente y requieren correccion previa.
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="modal-footer">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={
            workflowStage === "ready_to_create_missing_items"
              ? onCreateMissingItems
              : onApply
          }
          disabled={
            !preview ||
            !confirmedProviderId ||
            loadingPreview ||
            creatingMissingItems ||
            applying ||
            (workflowStage === "provider_mismatch_confirmation_required" &&
              true) ||
            (workflowStage === "blocked_missing_price_list" && true) ||
            (workflowStage === "resolve_suggested_matches" && true) ||
            (workflowStage === "ready_to_create_missing_items" &&
              !selectedCreatableMissingItems.length) ||
            (workflowStage !== "ready_to_create_missing_items" && !canApply)
          }
        >
          {workflowStage === "provider_mismatch_confirmation_required"
            ? "Revisar proveedor confirmado"
            : workflowStage === "resolve_suggested_matches"
              ? "Resolver coincidencias pendientes"
              : workflowStage === "ready_to_create_missing_items"
                ? creatingMissingItems
                  ? "Creando faltantes..."
                  : "Crear items faltantes en lista"
                : applying
                  ? "Aplicando..."
                  : "Aplicar a cotizacion"}
        </button>
      </div>
    </div>
  );
}

export default QuotationProviderDocumentImportModal;
