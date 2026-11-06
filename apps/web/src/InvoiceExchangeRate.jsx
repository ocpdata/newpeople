import { formatBusinessDate } from "./business-timezone";

export function InvoiceExchangeRateFields({ rate, total, disabled }) {
  const totalUsd = Math.round(((total / Number(rate.value)) + Number.EPSILON) * 100) / 100;
  return (
    <section className="invoice-exchange-card" aria-label="Tipo de cambio del documento">
      <div className="invoice-exchange-card-main">
        <div className="invoice-exchange-card-controls">
          <label className="field-group">
            <span>Tipo de cambio a USD (1 USD = X {rate.currency})</span>
            <input type="number" min="0.00000001" max="999999999999.99999999" step="0.00000001"
              value={rate.value} disabled={disabled || rate.currency === "USD"}
              onChange={(event) => rate.change(event.target.value)} />
          </label>
          {rate.currency !== "USD" && (
            <button type="button" className="btn-secondary" disabled={disabled || rate.loading || !rate.currency}
              onClick={() => void rate.load()}>
              Usar ultima tasa disponible
            </button>
          )}
        </div>
        <p className="invoice-exchange-card-total">Total en USD: <strong>{rate.valid && total != null
          ? new Intl.NumberFormat("es-MX", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(totalUsd)
          : "No disponible"}</strong></p>
      </div>
      {rate.loading && <p className="field-hint" role="status">Consultando tipo de cambio sugerido...</p>}
      {rate.error && <p className="status-text error" role="alert">{rate.error}</p>}
      {!rate.loading && rate.source === "suggested" && (
        <p className="field-hint">Fuente: Frankfurter. Fecha de publicacion: {rate.rateDate ? formatBusinessDate(rate.rateDate, { fallback: "-" }) : "No disponible"}. La consulta puede usar cache de hasta 6 horas.</p>
      )}
      {!rate.valid && <p className="field-hint">Ingresa una tasa positiva con hasta 8 decimales.</p>}
    </section>
  );
}
