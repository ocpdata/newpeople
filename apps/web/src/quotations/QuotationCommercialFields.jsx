import { useState } from "react";

function withCurrentCatalogOption(options, currentValue, valueKey = "code") {
  if (!currentValue) return options;
  if (
    options.some(
      (option) => String(option?.[valueKey] || "") === String(currentValue),
    )
  ) {
    return options;
  }

  return [
    {
      id: `legacy-${valueKey}-${currentValue}`,
      [valueKey]: currentValue,
      name: currentValue,
    },
    ...options,
  ];
}

export const QUOTATION_FINANCING_PAYMENT_TERMS_CODE = "segun_notas";
const QUOTATION_FINANCING_BLOCK_START = "---- Forma de pago ----";
const QUOTATION_FINANCING_BLOCK_END = "------------";
const LEGACY_QUOTATION_FINANCING_BLOCK_START =
  "[FINANCIAMIENTO_AUTOGENERADO_INICIO]";
const LEGACY_QUOTATION_FINANCING_BLOCK_END =
  "[FINANCIAMIENTO_AUTOGENERADO_FIN]";

const QUOTATION_FINANCING_FREQUENCY_OPTIONS = [
  { value: "monthly", label: "mensual", periodsPerYear: 12 },
  { value: "quarterly", label: "trimestral", periodsPerYear: 4 },
  { value: "semiannual", label: "semestral", periodsPerYear: 2 },
  { value: "annual", label: "anual", periodsPerYear: 1 },
];

function formatFinancingAmount(value) {
  const numericValue = Number(value || 0);
  return numericValue.toLocaleString("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function normalizeFinancingNumberInput(value) {
  return String(value || "")
    .replace(/,/gu, "")
    .replace(/[^\d.]/gu, "")
    .replace(/(\..*)\./gu, "$1");
}

function normalizeFinancingIntegerInput(value) {
  return String(value || "").replace(/\D/gu, "");
}

function formatFinancingInputWithThousands(value) {
  const sanitizedValue = normalizeFinancingNumberInput(value);
  if (!sanitizedValue) {
    return "";
  }

  const hasDecimalSeparator = sanitizedValue.includes(".");
  const [integerPart = "", decimalPart = ""] = sanitizedValue.split(".");
  const normalizedIntegerPart = (integerPart || "0").replace(/^0+(?=\d)/u, "");
  const formattedIntegerPart = Number(normalizedIntegerPart || 0).toLocaleString(
    "es-MX",
  );

  if (hasDecimalSeparator) {
    return `${formattedIntegerPart}.${decimalPart}`;
  }

  return formattedIntegerPart;
}

function roundFinancingValue(value, decimals = 8) {
  const numericValue = Number(value || 0);
  const factor = 10 ** decimals;
  return Math.round(numericValue * factor) / factor;
}

function getFinancingFrequencyMeta(value) {
  return (
    QUOTATION_FINANCING_FREQUENCY_OPTIONS.find(
      (option) => option.value === value,
    ) || QUOTATION_FINANCING_FREQUENCY_OPTIONS[0]
  );
}

function buildFinancingBlockRegex() {
  const startAlternatives = [
    QUOTATION_FINANCING_BLOCK_START,
    LEGACY_QUOTATION_FINANCING_BLOCK_START,
  ]
    .map((marker) => marker.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
    .join("|");
  const endAlternatives = [
    QUOTATION_FINANCING_BLOCK_END,
    LEGACY_QUOTATION_FINANCING_BLOCK_END,
  ]
    .map((marker) => marker.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
    .join("|");
  return new RegExp(`(?:${startAlternatives})[\\s\\S]*?(?:${endAlternatives})`, "gu");
}

function extractFinancingBlock(notes) {
  const text = String(notes || "");
  const match = text.match(buildFinancingBlockRegex());
  return match?.[0] || "";
}

export function buildQuotationFinancingForm(values = {}) {
  return {
    enabled: Boolean(values.enabled),
    initialMode: values.initialMode === "amount" ? "amount" : "percentage",
    initialValue:
      values.initialValue == null || values.initialValue === ""
        ? "0"
        : String(values.initialValue),
    teaPct:
      values.teaPct == null || values.teaPct === "" ? "0" : String(values.teaPct),
    frequency:
      QUOTATION_FINANCING_FREQUENCY_OPTIONS.some(
        (option) => option.value === values.frequency,
      )
        ? values.frequency
        : "monthly",
    periods:
      values.periods == null || values.periods === "" ? "" : String(values.periods),
  };
}

export function removeQuotationFinancingNotesBlock(notes) {
  const currentNotes = String(notes || "");
  const withoutBlock = currentNotes.replace(buildFinancingBlockRegex(), "").trim();
  return withoutBlock;
}

export function parseQuotationFinancingFromNotes(notes) {
  const block = extractFinancingBlock(notes);
  if (!block) {
    return buildQuotationFinancingForm();
  }

  const initialPctMatch = block.match(/\(([-\d.]+)%\)/u);
  const teaMatch = block.match(/TEA:\s*([-\d.]+)%/u);
  const periodsMatch = block.match(/Numero de periodos:\s*(\d+)/u);
  const frequencyLabelMatch = block.match(/Frecuencia:\s*([^\n\r]+)/u);
  const initialAmountMatch = block.match(/Cuota inicial:\s*[A-Z]{3}\s*([-\d.,]+)/u);

  const normalizedFrequencyLabel = String(frequencyLabelMatch?.[1] || "")
    .trim()
    .toLowerCase();
  const matchedFrequency = QUOTATION_FINANCING_FREQUENCY_OPTIONS.find(
    (option) => option.label === normalizedFrequencyLabel,
  );

  const normalizedInitialAmount = String(initialAmountMatch?.[1] || "")
    .replace(/,/gu, "")
    .trim();
  const parsedInitialPct = Number(initialPctMatch?.[1] || "0");

  return buildQuotationFinancingForm({
    enabled: true,
    initialMode:
      Number.isFinite(parsedInitialPct) && parsedInitialPct > 0
        ? "percentage"
        : "amount",
    initialValue:
      Number.isFinite(parsedInitialPct) && parsedInitialPct > 0
        ? String(parsedInitialPct)
        : normalizedInitialAmount || "0",
    teaPct: teaMatch?.[1] || "0",
    periods: periodsMatch?.[1] || "",
    frequency: matchedFrequency?.value || "monthly",
  });
}

export function buildQuotationFinancingPreview({
  financingForm,
  totalAmount,
  currencyCode,
  summaryVatMode,
}) {
  const form = buildQuotationFinancingForm(financingForm);
  const total = Math.max(Number(totalAmount || 0), 0);
  const currency = String(currencyCode || "USD").trim() || "USD";
  const includesVat = summaryVatMode !== "without_vat";

  if (!form.enabled) {
    return {
      isEnabled: false,
      isValid: false,
      validationMessage: "",
      noteBlock: "",
      currency,
    };
  }

  if (!(total > 0)) {
    return {
      isEnabled: true,
      isValid: false,
      validationMessage:
        "No se puede calcular financiamiento porque el total de la cotización no está disponible.",
      noteBlock: "",
      currency,
    };
  }

  const initialValue = Number(form.initialValue);
  if (!Number.isFinite(initialValue) || initialValue < 0) {
    return {
      isEnabled: true,
      isValid: false,
      validationMessage:
        form.initialMode === "amount"
          ? "La cuota inicial en monto debe ser mayor o igual a 0."
          : "La cuota inicial en porcentaje debe estar entre 0 y 100.",
      noteBlock: "",
      currency,
    };
  }

  if (form.initialMode === "percentage" && initialValue > 100) {
    return {
      isEnabled: true,
      isValid: false,
      validationMessage:
        "La cuota inicial en porcentaje debe estar entre 0 y 100.",
      noteBlock: "",
      currency,
    };
  }

  const teaPct = Number(form.teaPct);
  if (!Number.isFinite(teaPct) || teaPct < 0 || teaPct > 200) {
    return {
      isEnabled: true,
      isValid: false,
      validationMessage: "La TEA debe estar entre 0% y 200%.",
      noteBlock: "",
      currency,
    };
  }

  const periods = Number(form.periods);
  if (!Number.isInteger(periods) || periods < 1) {
    return {
      isEnabled: true,
      isValid: false,
      validationMessage:
        "El numero de periodos debe ser un entero mayor o igual a 1.",
      noteBlock: "",
      currency,
    };
  }

  const frequencyMeta = getFinancingFrequencyMeta(form.frequency);
  const downPaymentAmount =
    form.initialMode === "percentage" ? (total * initialValue) / 100 : initialValue;
  const normalizedDownPaymentAmount = roundFinancingValue(downPaymentAmount, 8);

  if (normalizedDownPaymentAmount > total) {
    return {
      isEnabled: true,
      isValid: false,
      validationMessage:
        "La cuota inicial no puede ser mayor al total de la cotización.",
      noteBlock: "",
      currency,
    };
  }

  const financedAmount = roundFinancingValue(total - normalizedDownPaymentAmount, 8);
  const teaRate = teaPct / 100;
  const periodRate = roundFinancingValue(
    Math.pow(1 + teaRate, 1 / frequencyMeta.periodsPerYear) - 1,
    12,
  );

  let installmentAmount = 0;
  if (financedAmount > 0) {
    if (periodRate === 0) {
      installmentAmount = financedAmount / periods;
    } else {
      const growthFactor = Math.pow(1 + periodRate, periods);
      installmentAmount =
        (financedAmount * periodRate * growthFactor) / (growthFactor - 1);
    }
  }

  const normalizedInstallmentAmount = roundFinancingValue(installmentAmount, 8);
  const totalEstimatedAmount = roundFinancingValue(
    normalizedDownPaymentAmount + normalizedInstallmentAmount * periods,
    8,
  );
  const downPaymentPct =
    total > 0 ? roundFinancingValue((normalizedDownPaymentAmount / total) * 100, 8) : 0;

  const noteBlock = [
    QUOTATION_FINANCING_BLOCK_START,
    "Forma de pago: Financiamiento segun notas",
    `Moneda: ${currency}`,
    `Total cotización (${includesVat ? "con descuentos e IVA" : "con descuentos, sin IVA"}): ${currency} ${formatFinancingAmount(total)}`,
    `Cuota inicial: ${currency} ${formatFinancingAmount(normalizedDownPaymentAmount)} (${formatFinancingAmount(downPaymentPct)}%)`,
    `Saldo financiado: ${currency} ${formatFinancingAmount(financedAmount)}`,
    `TEA: ${formatFinancingAmount(teaPct)}%`,
    `Frecuencia: ${frequencyMeta.label}`,
    `Numero de periodos: ${periods}`,
    `Cuota estimada por periodo: ${currency} ${formatFinancingAmount(normalizedInstallmentAmount)}`,
    `Total estimado a pagar (inicial + cuotas): ${currency} ${formatFinancingAmount(totalEstimatedAmount)}`,
    QUOTATION_FINANCING_BLOCK_END,
  ].join("\n");

  return {
    isEnabled: true,
    isValid: true,
    validationMessage: "",
    noteBlock,
    currency,
    frequencyLabel: frequencyMeta.label,
    total,
    downPaymentAmount: normalizedDownPaymentAmount,
    downPaymentPct,
    financedAmount,
    teaPct,
    periodRate,
    periods,
    installmentAmount: normalizedInstallmentAmount,
    totalEstimatedAmount,
  };
}

export function upsertQuotationFinancingNotesBlock(notes, noteBlock) {
  const baseNotes = removeQuotationFinancingNotesBlock(notes);
  const nextBlock = String(noteBlock || "").trim();

  if (!nextBlock) {
    return baseNotes;
  }

  if (!baseNotes) {
    return nextBlock;
  }

  return `${baseNotes}\n\n${nextBlock}`;
}

export function QuotationInternalNotesField({
  id,
  value,
  onChange,
  rows = 7,
  containerClassName = "field-group quotation-summary-notes-field",
  titleClassName = "quotation-summary-group-title",
}) {
  return (
    <div className={containerClassName}>
      <label className={titleClassName} htmlFor={id}>
        Notas internas
      </label>
      <textarea
        id={id}
        className="quotation-summary-internal-notes-input"
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function QuotationCommercialConditionsCard({
  idPrefix,
  values,
  catalogs,
  onFieldChange,
  notesRows = 7,
  showPricingHelperText = true,
  exchangeRateLoading = false,
  exchangeRateFeedback = "",
  exchangeRateError = "",
}) {
  return (
    <div className="quotation-commercial-conditions-card">
      <div className="quotation-commercial-conditions-fields">
        <div className="field-group">
          <label htmlFor={`${idPrefix}-delivery-time`}>Tiempo de entrega</label>
          <select
            id={`${idPrefix}-delivery-time`}
            value={values.deliveryTime}
            onChange={(event) =>
              onFieldChange("deliveryTime", event.target.value)
            }
          >
            {withCurrentCatalogOption(
              catalogs.deliveryTimes,
              values.deliveryTime,
            ).map((option) => (
              <option key={option.id || option.code} value={option.code}>
                {option.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field-group">
          <label htmlFor={`${idPrefix}-validity`}>
            Validez de la cotización
          </label>
          <select
            id={`${idPrefix}-validity`}
            value={values.quotationValidity}
            onChange={(event) =>
              onFieldChange("quotationValidity", event.target.value)
            }
          >
            {withCurrentCatalogOption(
              catalogs.validityTerms,
              values.quotationValidity,
            ).map((option) => (
              <option key={option.id || option.code} value={option.code}>
                {option.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field-group">
          <label htmlFor={`${idPrefix}-warranty`}>Garantía</label>
          <select
            id={`${idPrefix}-warranty`}
            value={values.warranty}
            onChange={(event) => onFieldChange("warranty", event.target.value)}
          >
            {withCurrentCatalogOption(
              catalogs.warrantyTerms,
              values.warranty,
            ).map((option) => (
              <option key={option.id || option.code} value={option.code}>
                {option.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field-group">
          <label htmlFor={`${idPrefix}-payment-terms`}>Forma de pago</label>
          <select
            id={`${idPrefix}-payment-terms`}
            value={values.paymentTerms}
            onChange={(event) =>
              onFieldChange("paymentTerms", event.target.value)
            }
          >
            {withCurrentCatalogOption(
              catalogs.paymentTerms,
              values.paymentTerms,
            ).map((option) => (
              <option key={option.id || option.code} value={option.code}>
                {option.name}
              </option>
            ))}
          </select>
        </div>

        <div className="quotation-commercial-conditions-bottom-row">
          <div className="field-group">
            <label htmlFor={`${idPrefix}-currency`}>Moneda</label>
            <select
              id={`${idPrefix}-currency`}
              value={values.currencyCode}
              onChange={(event) =>
                onFieldChange("currencyCode", event.target.value)
              }
            >
              {withCurrentCatalogOption(
                catalogs.currencies,
                values.currencyCode,
              ).map((option) => (
                <option key={option.id || option.code} value={option.code}>
                  {`${option.code} - ${option.name}`}
                </option>
              ))}
            </select>
          </div>

          <div className="field-group">
            <label htmlFor={`${idPrefix}-exchange-rate`}>Tipo de cambio</label>
            <input
              id={`${idPrefix}-exchange-rate`}
              type="number"
              min="0.0001"
              step="0.0001"
              value={values.exchangeRate}
              onChange={(event) =>
                onFieldChange("exchangeRate", event.target.value)
              }
            />
            {exchangeRateLoading ? (
              <p className="field-hint quotation-commercial-conditions-exchange-rate-status">
                Consultando tipo de cambio sugerido...
              </p>
            ) : null}
            {!exchangeRateLoading && exchangeRateError ? (
              <p className="field-hint quotation-commercial-conditions-exchange-rate-status is-error">
                {exchangeRateError}
              </p>
            ) : null}
            {!exchangeRateLoading && !exchangeRateError && exchangeRateFeedback ? (
              <p className="field-hint quotation-commercial-conditions-exchange-rate-status">
                {exchangeRateFeedback}
              </p>
            ) : null}
          </div>
        </div>

        {showPricingHelperText ? (
          <p className="quotation-commercial-conditions-helper-text">
            "Precio Lista M.O." conserva la base original del proveedor y "Precio
            de lista" muestra el valor convertido en la moneda de la cotización.
          </p>
        ) : null}
      </div>

      <div className="field-group quotation-commercial-conditions-notes-field">
        <label htmlFor={`${idPrefix}-notes`}>Notas de la cotización</label>
        <textarea
          id={`${idPrefix}-notes`}
          className="quotation-commercial-conditions-notes-input"
          rows={notesRows}
          value={values.quotationNotes}
          onChange={(event) =>
            onFieldChange("quotationNotes", event.target.value)
          }
        />
      </div>
    </div>
  );
}

export function QuotationFinancingCard({
  idPrefix,
  currencyCode,
  totalAmount,
  financingForm,
  financingPreview,
  onFieldChange,
}) {
  const [isInitialValueInputFocused, setIsInitialValueInputFocused] =
    useState(false);
  const resolvedCurrencyCode = String(currencyCode || "USD").trim() || "USD";
  const initialValueDisplay =
    financingForm.initialMode === "amount" && !isInitialValueInputFocused
      ? formatFinancingInputWithThousands(financingForm.initialValue)
      : financingForm.initialValue;

  return (
    <div className="quotation-financing-card">
      <div className="quotation-financing-top-row">
        <div className="quotation-financing-enabled-toggle">
          <label
            className="quotation-financing-enabled-control"
            htmlFor={`${idPrefix}-financing-enabled`}
          >
            <input
              id={`${idPrefix}-financing-enabled`}
              type="checkbox"
              checked={Boolean(financingForm.enabled)}
              onChange={(event) =>
                onFieldChange("enabled", event.target.checked)
              }
            />
            <span className="quotation-financing-switch" aria-hidden="true" />
            <span>Financiar forma de pago</span>
          </label>
        </div>

        <div className="field-group quotation-financing-total-field">
          <label htmlFor={`${idPrefix}-financing-total`}>Total base</label>
          <input
            id={`${idPrefix}-financing-total`}
            type="text"
            readOnly
            value={`${resolvedCurrencyCode} ${formatFinancingAmount(totalAmount)}`}
          />
        </div>
      </div>

      <div className="quotation-financing-fields">
        <div className="field-group quotation-financing-initial-field">
          <div className="quotation-financing-field-header">
            <label htmlFor={`${idPrefix}-financing-initial-value`}>
              Cuota inicial
            </label>
            <div
              className="quotation-financing-mode-segment"
              role="group"
              aria-label="Modo de cuota inicial"
            >
              <button
                type="button"
                className={`quotation-financing-mode-button${financingForm.initialMode === "percentage" ? " is-active" : ""}`}
                onClick={() => onFieldChange("initialMode", "percentage")}
                disabled={!financingForm.enabled}
              >
                %
              </button>
              <button
                type="button"
                className={`quotation-financing-mode-button${financingForm.initialMode === "amount" ? " is-active" : ""}`}
                onClick={() => onFieldChange("initialMode", "amount")}
                disabled={!financingForm.enabled}
              >
                Monto
              </button>
            </div>
          </div>
          <div className="quotation-financing-input-with-suffix">
            <input
              id={`${idPrefix}-financing-initial-value`}
              type="text"
              inputMode="decimal"
              value={initialValueDisplay}
              onFocus={() => setIsInitialValueInputFocused(true)}
              onBlur={() => setIsInitialValueInputFocused(false)}
              onChange={(event) =>
                onFieldChange(
                  "initialValue",
                  normalizeFinancingNumberInput(event.target.value),
                )
              }
              disabled={!financingForm.enabled}
            />
            <span>
              {financingForm.initialMode === "percentage" ? "%" : resolvedCurrencyCode}
            </span>
          </div>
        </div>

        <div className="field-group">
          <label htmlFor={`${idPrefix}-financing-tea`}>TEA %</label>
          <div className="quotation-financing-input-with-suffix">
            <input
              id={`${idPrefix}-financing-tea`}
              type="text"
              inputMode="decimal"
              value={financingForm.teaPct}
              onChange={(event) =>
                onFieldChange("teaPct", normalizeFinancingNumberInput(event.target.value))
              }
              disabled={!financingForm.enabled}
            />
            <span>%</span>
          </div>
        </div>

        <div className="field-group">
          <label htmlFor={`${idPrefix}-financing-frequency`}>Frecuencia</label>
          <select
            id={`${idPrefix}-financing-frequency`}
            value={financingForm.frequency}
            onChange={(event) => onFieldChange("frequency", event.target.value)}
            disabled={!financingForm.enabled}
          >
            {QUOTATION_FINANCING_FREQUENCY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field-group">
          <label htmlFor={`${idPrefix}-financing-periods`}>Numero de periodos</label>
          <input
            id={`${idPrefix}-financing-periods`}
            type="text"
            inputMode="numeric"
            value={financingForm.periods}
            onChange={(event) =>
              onFieldChange(
                "periods",
                normalizeFinancingIntegerInput(event.target.value),
              )
            }
            disabled={!financingForm.enabled}
          />
        </div>
      </div>

      {financingForm.enabled && financingPreview.validationMessage ? (
        <p className="field-hint quotation-financing-error">
          {financingPreview.validationMessage}
        </p>
      ) : null}

      {financingForm.enabled && financingPreview.isValid ? (
        <div className="quotation-financing-summary-grid">
          <div className="quotation-financing-summary-item">
            <span>Saldo financiado</span>
            <strong>
              {resolvedCurrencyCode} {formatFinancingAmount(financingPreview.financedAmount)}
            </strong>
          </div>
          <div className="quotation-financing-summary-item">
            <span>Tasa por periodo</span>
            <strong>{formatFinancingAmount(financingPreview.periodRate * 100)}%</strong>
          </div>
          <div className="quotation-financing-summary-item">
            <span>Cuota estimada</span>
            <strong>
              {resolvedCurrencyCode} {formatFinancingAmount(financingPreview.installmentAmount)}
            </strong>
          </div>
          <div className="quotation-financing-summary-item">
            <span>Total estimado</span>
            <strong>
              {resolvedCurrencyCode} {formatFinancingAmount(financingPreview.totalEstimatedAmount)}
            </strong>
          </div>
        </div>
      ) : null}
    </div>
  );
}
