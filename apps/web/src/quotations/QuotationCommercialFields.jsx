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
            Validez de la cotizacion
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
          <label htmlFor={`${idPrefix}-warranty`}>Garantia</label>
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
          </div>
        </div>
      </div>

      <div className="field-group quotation-commercial-conditions-notes-field">
        <label htmlFor={`${idPrefix}-notes`}>Notas de la cotizacion</label>
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
