import { normalizeText } from "./quotationsUtils";
import ModalInlineHelp from "../help/ModalInlineHelp";

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
const COMMERCIAL_CLAUSE_CATEGORY_LABELS = {
  payment: "Pago",
  delivery: "Entrega",
  warranty: "Garantia",
  legal: "Legal",
  logistics: "Logistica",
  others: "Condicion",
};
const SUGGESTED_MATCH_STATUSES = [
  "suggested_match_pending_confirmation",
  "ambiguous_similar_match",
];

function formatCommercialClauseConfidence(value) {
  const normalizedValue = String(value || "")
    .trim()
    .toLowerCase();
  if (normalizedValue === "high") {
    return "Alta";
  }
  if (normalizedValue === "medium") {
    return "Media";
  }
  return "Baja";
}

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

function formatResolvedCostUnit(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return "-";
  }

  return new Intl.NumberFormat("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numericValue);
}

function formatProviderImportJobStatus(value) {
  const normalizedValue = normalizeText(value).replace(/[_-]+/g, " ");

  if (!normalizedValue) {
    return "pendiente";
  }

  if (normalizedValue === "running") {
    return "en ejecucion";
  }

  if (normalizedValue === "pending") {
    return "pendiente";
  }

  if (normalizedValue === "completed") {
    return "completado";
  }

  if (normalizedValue === "failed") {
    return "fallido";
  }

  if (normalizedValue === "expired") {
    return "expirado";
  }

  if (normalizedValue === "stale") {
    return "desactualizado";
  }

  return String(value || "").trim() || "pendiente";
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

function formatProviderImportWarning(warning) {
  const normalizedWarning = String(warning || "").trim();
  if (!normalizedWarning) {
    return "";
  }

  const comparableWarning = normalizeText(normalizedWarning)
    .replace(/[_-]+/g, " ")
    .trim();

  const serviceTermMatch = comparableWarning.match(
    /^(subscription|maintenance)(?:\s+with\s+service)?\s+term:?\s+(\d+)\s+months?$/i,
  );
  if (serviceTermMatch) {
    const warningType = /maintenance/i.test(serviceTermMatch[1])
      ? "Mantenimiento"
      : "Suscripcion";
    const monthCount = Number(serviceTermMatch[2]) || 0;
    return `El item corresponde a ${
      warningType === "Mantenimiento" ? "mantenimiento" : "una suscripcion"
    } con termino de servicio de ${monthCount} ${
      monthCount === 1 ? "mes" : "meses"
    }`;
  }

  const bareServiceTermMatch = comparableWarning.match(
    /^service\s+term:?\s+(\d+)\s+months?$/i,
  );
  if (bareServiceTermMatch) {
    const monthCount = Number(bareServiceTermMatch[1]) || 0;
    return `El item indica un termino de servicio de ${monthCount} ${
      monthCount === 1 ? "mes" : "meses"
    }`;
  }

  if (/subscription/i.test(normalizedWarning)) {
    return "El item corresponde a una suscripcion y conviene validar su vigencia y alcance en el documento fuente";
  }

  if (/maintenance/i.test(normalizedWarning)) {
    return "El item corresponde a mantenimiento y conviene validar su vigencia y alcance en el documento fuente";
  }

  if (/warranty|garantia/i.test(normalizedWarning)) {
    return "Este item incluye una referencia a garantia; revisa el plazo y el alcance indicados en el documento fuente";
  }

  if (/delivery|shipping|freight/i.test(normalizedWarning)) {
    return "Este item incluye una referencia a entrega o flete; revisa el alcance logistico indicado en el documento fuente";
  }

  if (
    /warning imported from ai analysis/i.test(normalizedWarning) ||
    /review item detail in source document/i.test(normalizedWarning)
  ) {
    return "";
  }

  if (/warning imported from ai analysis/i.test(normalizedWarning)) {
    return "";
  }

  if (
    /\b(review item detail in source document|document source|source document)\b/i.test(
      normalizedWarning,
    )
  ) {
    return "";
  }

  return normalizedWarning;
}

function QuotationProviderDocumentImportModal({
  isOpen,
  errorMessage,
  successMessage,
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
  creatingSuggestedMatchPreviewId,
  suggestedMatchFeedbackByPreviewId,
  applying,
  commercialTermsSelection,
  onToggleCommercialTermSelection,
  commercialClausesSelection,
  onToggleCommercialClauseSelection,
  onSelectSuggestedMatchCandidate,
  onResolveSuggestedMatch,
  missingItemsSelection,
  onToggleMissingItemSelection,
  transferableWarningsSelection,
  onToggleTransferableWarningSelection,
  isWarningTransferable,
  onCreateMissingItems,
  onCreateSuggestedMatchItem,
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
  const previewJobStatusLabel = formatProviderImportJobStatus(previewJobStatus);
  const previewJobLabel = String(previewJob?.progress?.label || "").trim();
  const previewJobPercent = Number(previewJob?.progress?.percent || 0) || 0;
  const previewJobErrorMessage = String(
    previewJob?.error?.message || "",
  ).trim();
  const suggestedMatchFeedback = suggestedMatchFeedbackByPreviewId || {};
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
  const isCreatingMissingItems = Boolean(creatingMissingItems);
  const isCreatingSuggestedMatchItem = Boolean(
    String(creatingSuggestedMatchPreviewId || "").trim(),
  );
  const isBlockingImport = Boolean(loadingPreview || creatingMissingItems);
  const hasConfirmedProviderContext = Boolean(
    confirmedProviderId ||
    preview?.confirmedProvider?.id ||
    previewJob?.request?.providerId,
  );
  const hasDocumentContext = Boolean(
    selectedDocumentId || previewJob?.request?.documentLinkId,
  );
  const termSelection = commercialTermsSelection || {};
  const clauseSelection = commercialClausesSelection || {};
  const commercialClauses = Array.isArray(preview?.commercialClauses)
    ? preview.commercialClauses
    : [];

  return (
    <div
      className={`quotation-provider-import-modal quotation-provider-import-modal-inline${
        isBlockingImport ? " is-blocked" : ""
      }`}
      role="region"
      aria-labelledby="quotation-provider-import-title"
      aria-busy={isBlockingImport}
    >
      {isBlockingImport ? (
        <div
          className="quotation-provider-import-blocking-overlay"
          role="status"
          aria-live="polite"
        >
          <div className="quotation-provider-import-blocking-dialog">
            <span
              className="quotation-provider-import-blocking-spinner"
              aria-hidden="true"
            />
            <strong>
              {loadingPreview
                ? "Analizando documento con IA..."
                : "Creando items faltantes en lista..."}
            </strong>
            <p>
              {loadingPreview
                ? previewJobLabel ||
                  "Espera la respuesta del analisis para continuar."
                : "Espera la respuesta para continuar con la aplicación."}
            </p>
          </div>
        </div>
      ) : null}
      <div className="modal-header">
        <div>
          <div className="quotation-help-title-row">
            <h3 id="quotation-provider-import-title">
              Crear items desde documento con IA
            </h3>
            <ModalInlineHelp
              helpKey="quotation.provider-document-import"
              triggerLabel="Ayuda"
            />
          </div>
          <p className="field-hint">
            La IA propone proveedor, condiciones e items. El usuario confirma
            antes de aplicar.
          </p>
        </div>
      </div>

      <div className="quotation-provider-import-body">
        <section className="quotation-provider-import-setup-panel">
          <div className="quotation-provider-import-setup-copy">
            <strong>Configuracion inicial</strong>
            <p>
              Selecciona el documento, confirma el proveedor y luego inicia el
              analisis asistido por IA.
            </p>
          </div>

          <div className="quotation-provider-import-setup-layout">
            <div className="quotation-provider-import-grid">
              <label className="field-group">
                <span>Documento</span>
                <select
                  value={selectedDocumentId}
                  onChange={(event) => onDocumentChange(event.target.value)}
                  disabled={isBlockingImport}
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
                  disabled={
                    isBlockingImport || (!activeProviders.length && !preview)
                  }
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

            <div className="quotation-provider-import-actions">
              <button
                type="button"
                className="btn-secondary quotation-provider-import-icon-button quotation-provider-import-icon-button-emphasis"
                onClick={onAnalyze}
                disabled={
                  isBlockingImport || !selectedDocumentId || loadingPreview
                }
                title={
                  loadingPreview
                    ? "Analizando el documento seleccionado con IA"
                    : "Analizar el documento seleccionado con IA para detectar proveedor, condiciones e items"
                }
                aria-label={
                  loadingPreview
                    ? "Analizando el documento seleccionado con IA"
                    : "Analizar el documento seleccionado con IA para detectar proveedor, condiciones e items"
                }
              >
                {loadingPreview ? (
                  <span
                    className="quotation-provider-import-inline-spinner"
                    aria-hidden="true"
                  />
                ) : (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M10.2 4.75a7.45 7.45 0 0 1 5.74 12.2l3.08 3.07a.75.75 0 0 1-1.06 1.06l-3.08-3.08A7.45 7.45 0 1 1 10.2 4.75Zm0 1.5a5.95 5.95 0 1 0 0 11.9 5.95 5.95 0 0 0 0-11.9Zm.05 2.3a.75.75 0 0 1 .75.75v1.95h1.95a.75.75 0 0 1 0 1.5h-2.7a.75.75 0 0 1-.75-.75V9.3a.75.75 0 0 1 .75-.75Z" />
                  </svg>
                )}
              </button>
              <span className="quotation-provider-import-action-hint">
                {loadingPreview
                  ? "Analizando documento..."
                  : "Iniciar analisis"}
              </span>
            </div>
          </div>
        </section>

        {errorMessage ? (
          <div className="quotation-provider-import-warning" role="alert">
            <strong>No se pudo completar la accion</strong>
            <ul>
              <li>{errorMessage}</li>
            </ul>
          </div>
        ) : null}

        {successMessage ? (
          <div className="quotation-provider-import-success" role="status">
            <strong>Accion completada</strong>
            <p>{successMessage}</p>
          </div>
        ) : null}

        {!documents.length ? (
          <div className="quotation-provider-import-warning">
            <strong>Sin documentos elegibles</strong>
            <ul>
              <li>No hay documentos habilitados para IA en esta cotización.</li>
            </ul>
          </div>
        ) : null}

        {previewJob ? (
          <div className="quotation-provider-import-job-status">
            <div className="quotation-provider-import-job-status-row">
              <strong>Estado del analisis: {previewJobStatusLabel}</strong>
              <span>{Math.max(0, Math.min(100, previewJobPercent))}%</span>
            </div>
            <p>
              {previewJobLabel ||
                (loadingPreview
                  ? "Analizando documento del proveedor"
                  : "Analisis preparado")}
            </p>
            {previewJobStatus === "failed" && previewJobErrorMessage ? (
              <p>{previewJobErrorMessage}</p>
            ) : null}
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
                      <th>Advertencias</th>
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
                              <div className="quotation-provider-import-warning-line">
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
                                  disabled={isCreatingMissingItems}
                                />
                                <button
                                  type="button"
                                  className="btn-secondary quotation-provider-import-suggestion-btn quotation-provider-import-suggestion-btn-icon quotation-provider-import-suggestion-btn-create"
                                  onClick={() =>
                                    onCreateSuggestedMatchItem?.(item.previewId)
                                  }
                                  disabled={
                                    isCreatingMissingItems ||
                                    isCreatingSuggestedMatchItem ||
                                    !hasConfirmedProviderContext ||
                                    !hasDocumentContext
                                  }
                                  title={
                                    !hasConfirmedProviderContext
                                      ? "Confirma el proveedor para crear un nuevo item"
                                      : !hasDocumentContext
                                        ? "Confirma el documento analizado para crear un nuevo item"
                                        : "Crear item individual en lista"
                                  }
                                  aria-label={
                                    !hasConfirmedProviderContext
                                      ? "Confirma el proveedor para crear un nuevo item"
                                      : !hasDocumentContext
                                        ? "Confirma el documento analizado para crear un nuevo item"
                                        : "Crear item individual en lista"
                                  }
                                >
                                  {String(
                                    creatingSuggestedMatchPreviewId || "",
                                  ) === String(item.previewId) ? (
                                    <span
                                      className="quotation-provider-import-inline-spinner"
                                      aria-hidden="true"
                                    />
                                  ) : (
                                    <svg viewBox="0 0 24 24" aria-hidden="true">
                                      <path d="M12 3a9 9 0 1 0 9 9 9.01 9.01 0 0 0-9-9Zm3.75 9.75h-3v3h-1.5v-3h-3v-1.5h3v-3h1.5v3h3Z" />
                                    </svg>
                                  )}
                                </button>
                              </div>
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
                        <td>{formatResolvedCostUnit(item.resolvedCostUnit)}</td>
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
                            {suggestedMatchFeedback?.[String(item.previewId)]
                              ?.message ? (
                              <span>
                                {
                                  suggestedMatchFeedback[String(item.previewId)]
                                    .message
                                }
                              </span>
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
                              {item.warnings.map((warning, index) => {
                                const formattedWarning =
                                  formatProviderImportWarning(warning);
                                if (!formattedWarning) {
                                  return null;
                                }

                                return (
                                  <li key={`${item.previewId}-${index}`}>
                                    <div className="quotation-provider-import-warning-line">
                                      <span className="quotation-provider-import-warning-text">
                                        {formattedWarning}
                                      </span>
                                      {isWarningTransferable?.(warning) ? (
                                        <label className="quotation-provider-import-warning-transfer-toggle">
                                          <input
                                            type="checkbox"
                                            checked={Boolean(
                                              transferableWarningsSelection?.[
                                                `${String(item.previewId || "").trim()}::${String(
                                                  warning || "",
                                                ).trim()}`
                                              ],
                                            )}
                                            onChange={(event) =>
                                              onToggleTransferableWarningSelection?.(
                                                item.previewId,
                                                warning,
                                                event.target.checked,
                                              )
                                            }
                                            disabled={isCreatingMissingItems}
                                          />
                                          <span>Agregar a descripcion</span>
                                        </label>
                                      ) : null}
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                          ) : (
                            <span>Sin advertencias</span>
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
                          disabled={isCreatingMissingItems}
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

            <section className="quotation-provider-import-conditions-section">
              <strong>Clausulas comerciales detectadas</strong>
              <p>
                Selecciona los terminos o condiciones del proveedor que se
                anexaran a las notas de la cotizacion en espanol.
              </p>
              {commercialClauses.length ? (
                <div className="quotation-provider-import-terms">
                  <div className="quotation-provider-import-terms-grid">
                    {commercialClauses.map((clause, index) => {
                      const clauseId = String(
                        clause?.clauseId || `clause-${index + 1}`,
                      ).trim();
                      if (!clauseId) {
                        return null;
                      }

                      const category = String(clause?.category || "")
                        .trim()
                        .toLowerCase();
                      const categoryLabel =
                        COMMERCIAL_CLAUSE_CATEGORY_LABELS[category] ||
                        COMMERCIAL_CLAUSE_CATEGORY_LABELS.others;
                      const title = String(clause?.titleEs || "").trim();
                      const text = String(clause?.textEs || "").trim();
                      const sourceSnippet = String(
                        clause?.sourceSnippet || "",
                      ).trim();

                      return (
                        <label
                          key={clauseId}
                          className="quotation-provider-import-term-card"
                        >
                          <span className="quotation-provider-import-term-title">
                            <input
                              type="checkbox"
                              checked={Boolean(clauseSelection[clauseId])}
                              onChange={(event) =>
                                onToggleCommercialClauseSelection?.(
                                  clauseId,
                                  event.target.checked,
                                )
                              }
                              disabled={isCreatingMissingItems}
                            />
                            <strong>{title || "Clausula detectada"}</strong>
                          </span>
                          <span>
                            {categoryLabel} · Confianza{" "}
                            {formatCommercialClauseConfidence(
                              clause?.confidence,
                            )}
                          </span>
                          {text ? <span>{text}</span> : null}
                          {sourceSnippet ? (
                            <span className="quotation-provider-import-muted">
                              Evidencia: {sourceSnippet}
                            </span>
                          ) : null}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="quotation-provider-import-warning">
                  <ul>
                    <li>
                      No se detectaron clausulas de terminos o condiciones en el
                      documento analizado.
                    </li>
                  </ul>
                </div>
              )}
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
                  {!hasConfirmedProviderContext ? (
                    <li>
                      Confirma el proveedor para habilitar la accion Crear nuevo
                      item.
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
                        {suggestedMatchFeedback?.[String(item.previewId)]
                          ?.type === "success"
                          ? suggestedMatchFeedback?.[String(item.previewId)]
                              ?.mode === "reused"
                            ? "Ya existe en lista activa"
                            : "Creado en lista activa"
                          : "Confirmado como existente"}
                      </span>
                      {getSuggestedMatchCandidateLabel(item) ? (
                        <span className="quotation-provider-import-resolved-match-link">
                          {getSuggestedMatchCandidateLabel(item)}
                        </span>
                      ) : null}
                      {suggestedMatchFeedback?.[String(item.previewId)]
                        ?.message ? (
                        <p className="quotation-provider-import-row-feedback is-success">
                          {
                            suggestedMatchFeedback[String(item.previewId)]
                              .message
                          }
                        </p>
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
                    const isCreatingThisSuggestedItem =
                      String(creatingSuggestedMatchPreviewId || "") ===
                      String(item.previewId);
                    const rowFeedback =
                      suggestedMatchFeedback[String(item.previewId)] || null;
                    const canCreateSuggestedItem =
                      hasConfirmedProviderContext && hasDocumentContext;
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
                        <div className="quotation-provider-import-suggestion-resolution-row">
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
                                disabled={
                                  isCreatingMissingItems ||
                                  isCreatingSuggestedMatchItem
                                }
                              >
                                <option value="">
                                  Selecciona un item existente
                                </option>
                                {candidates.map((candidate) => (
                                  <option
                                    key={candidate.id}
                                    value={candidate.id}
                                  >
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
                          ) : (
                            <div />
                          )}
                          <div className="quotation-provider-import-suggestion-actions">
                            <button
                              type="button"
                              className="btn-secondary quotation-provider-import-suggestion-btn quotation-provider-import-suggestion-btn-icon quotation-provider-import-suggestion-btn-use"
                              onClick={() =>
                                onResolveSuggestedMatch(
                                  item.previewId,
                                  "use_existing",
                                )
                              }
                              disabled={
                                isCreatingMissingItems ||
                                isCreatingSuggestedMatchItem ||
                                (candidates.length > 1 &&
                                  !item.selectedSuggestedPriceListItemId)
                              }
                              title="Usar existente"
                              aria-label="Usar existente"
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="m9.55 16.2-3.8-3.8 1.06-1.06 2.74 2.74 7.64-7.64 1.06 1.06Z" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              className="btn-secondary quotation-provider-import-suggestion-btn quotation-provider-import-suggestion-btn-icon quotation-provider-import-suggestion-btn-create"
                              onClick={() =>
                                onCreateSuggestedMatchItem?.(item.previewId)
                              }
                              disabled={
                                isCreatingMissingItems ||
                                isCreatingSuggestedMatchItem ||
                                !canCreateSuggestedItem
                              }
                              title={
                                !hasConfirmedProviderContext
                                  ? "Confirma el proveedor para crear un nuevo item"
                                  : !hasDocumentContext
                                    ? "Confirma el documento analizado para crear un nuevo item"
                                    : "Crear nuevo item"
                              }
                              aria-label={
                                !hasConfirmedProviderContext
                                  ? "Confirma el proveedor para crear un nuevo item"
                                  : !hasDocumentContext
                                    ? "Confirma el documento analizado para crear un nuevo item"
                                    : "Crear nuevo item"
                              }
                            >
                              {isCreatingThisSuggestedItem ? (
                                <span
                                  className="quotation-provider-import-inline-spinner"
                                  aria-hidden="true"
                                />
                              ) : (
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="M12 3a9 9 0 1 0 9 9 9.01 9.01 0 0 0-9-9Zm3.75 9.75h-3v3h-1.5v-3h-3v-1.5h3v-3h1.5v3h3Z" />
                                </svg>
                              )}
                            </button>
                          </div>
                        </div>
                        {rowFeedback?.message ? (
                          <p
                            className={`quotation-provider-import-row-feedback ${
                              rowFeedback.type === "success"
                                ? "is-success"
                                : "is-error"
                            }`}
                          >
                            {rowFeedback.message}
                          </p>
                        ) : null}
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

      <div className="modal-footer quotation-provider-import-footer">
        <div className="quotation-provider-import-footer-copy">
          <strong>
            {workflowStage === "ready_to_create_missing_items"
              ? "Paso siguiente: crear faltantes"
              : workflowStage === "ready_to_apply"
                ? "Paso final: agregar a la edicion actual"
                : "Sigue el flujo para continuar"}
          </strong>
          <span>
            {workflowStage === "resolve_suggested_matches"
              ? "Primero resuelve las coincidencias sugeridas pendientes."
              : workflowStage === "ready_to_create_missing_items"
                ? "Crea los items faltantes seleccionados antes de aplicar."
                : workflowStage === "ready_to_apply"
                  ? "Los items confirmados se agregaran en memoria y se guardaran al pulsar Guardar como version actual."
                  : "Confirma proveedor, documento y condiciones antes de continuar."}
          </span>
        </div>
        <div className="quotation-provider-import-footer-actions">
          <button
            type="button"
            className="btn-secondary quotation-provider-import-icon-button"
            onClick={onClose}
            disabled={isBlockingImport}
            title="Cancelar y cerrar esta ventana de importación asistida por IA"
            aria-label="Cancelar y cerrar esta ventana de importación asistida por IA"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6.53 5.47a.75.75 0 0 1 1.06 0L12 9.88l4.41-4.41a.75.75 0 1 1 1.06 1.06L13.06 10.94l4.41 4.41a.75.75 0 1 1-1.06 1.06L12 12l-4.41 4.41a.75.75 0 0 1-1.06-1.06l4.41-4.41-4.41-4.41a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </button>
          <button
            type="button"
            className="btn-primary quotation-provider-import-icon-button quotation-provider-import-icon-button-primary"
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
            title={
              workflowStage === "provider_mismatch_confirmation_required"
                ? "Revisa el proveedor confirmado antes de continuar"
                : workflowStage === "resolve_suggested_matches"
                  ? "Primero resuelve las coincidencias sugeridas pendientes"
                  : workflowStage === "ready_to_create_missing_items"
                    ? creatingMissingItems
                      ? "Creando los items faltantes en la lista activa del proveedor"
                      : "Crear los items faltantes seleccionados en la lista activa del proveedor"
                    : applying
                      ? "Agregando los items confirmados a la edicion actual"
                      : "Agregar los items confirmados a la edicion actual. Se guardaran al pulsar Guardar como version actual"
            }
            aria-label={
              workflowStage === "provider_mismatch_confirmation_required"
                ? "Revisa el proveedor confirmado antes de continuar"
                : workflowStage === "resolve_suggested_matches"
                  ? "Primero resuelve las coincidencias sugeridas pendientes"
                  : workflowStage === "ready_to_create_missing_items"
                    ? creatingMissingItems
                      ? "Creando los items faltantes en la lista activa del proveedor"
                      : "Crear los items faltantes seleccionados en la lista activa del proveedor"
                    : applying
                      ? "Agregando los items confirmados a la edicion actual"
                      : "Agregar los items confirmados a la edicion actual. Se guardaran al pulsar Guardar como version actual"
            }
          >
            {creatingMissingItems || applying ? (
              <span
                className="quotation-provider-import-inline-spinner is-on-primary"
                aria-hidden="true"
              />
            ) : workflowStage === "ready_to_create_missing_items" ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3a9 9 0 1 0 9 9 9.01 9.01 0 0 0-9-9Zm3.75 9.75h-3v3h-1.5v-3h-3v-1.5h3v-3h1.5v3h3Z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8.78 6.47a.75.75 0 0 1 1.06 0l4.72 4.72a1.13 1.13 0 0 1 0 1.6l-4.72 4.72a.75.75 0 1 1-1.06-1.06l4.34-4.46-4.34-4.46a.75.75 0 0 1 0-1.06Z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default QuotationProviderDocumentImportModal;
