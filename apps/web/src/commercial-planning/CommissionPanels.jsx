import { useMemo, useState } from "react";
import {
  COMMISSION_CATEGORIES,
  COMMISSION_MIN_QUOTA_ATTAINMENT_PCT,
  COMMISSION_MIN_QUOTATION_MARGIN_PCT,
  simulateCommission,
} from "./commissionRules";

const moneyFormatter = new Intl.NumberFormat("es-MX", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMoney(value) {
  return moneyFormatter.format(Number(value || 0));
}

const RULE_ROWS = [
  ["Periodicidad", "Trimestral", "La comisión se calcula por trimestre."],
  ["Venta que cuenta", "Cotización aceptada", "Se asigna al trimestre de su fecha de aceptación."],
  [
    "Cumplimiento mínimo de cuota",
    `${COMMISSION_MIN_QUOTA_ATTAINMENT_PCT}%`,
    "Si no se alcanza al cierre del trimestre, la comisión del trimestre es $0.",
  ],
  [
    "Habilitación retroactiva",
    "Sí",
    `Al llegar al ${COMMISSION_MIN_QUOTA_ATTAINMENT_PCT}%, todas las cotizaciones elegibles del trimestre quedan habilitadas.`,
  ],
  [
    "Margen mínimo por cotización",
    `${COMMISSION_MIN_QUOTATION_MARGIN_PCT}%`,
    "Se valida sobre la cotización completa. Por debajo cuenta para la cuota, pero no paga comisión.",
  ],
  ["Base de cálculo", "Contribución del ítem", "Venta menos costo del ítem; no se usa la venta total."],
  ["Fórmula", "Contribución × % de la categoría", "La comisión del vendedor es la suma de sus ítems elegibles."],
  [
    "No incluido en esta versión",
    "Ventas compartidas, notas de crédito y ajustes",
    "Los porcentajes son fijos dentro del trimestre.",
  ],
];

export function CommissionRulesCard({ compact = false }) {
  return (
    <details className="commission-help-card">
      <summary>
        <strong>Reglas de comisión</strong>
        <span>
          Cuota mínima {COMMISSION_MIN_QUOTA_ATTAINMENT_PCT}% · Margen mínimo {COMMISSION_MIN_QUOTATION_MARGIN_PCT}% ·
          Comisión = contribución × % de la categoría
        </span>
      </summary>
      <div className="commercial-planning-table-wrap">
        <table className="commercial-planning-table commission-rules-table">
          <thead>
            <tr>
              <th>Parámetro</th>
              <th>Valor actual</th>
              <th>Qué significa</th>
            </tr>
          </thead>
          <tbody>
            {RULE_ROWS.map(([name, value, description]) => (
              <tr key={name}>
                <td><strong>{name}</strong></td>
                <td>{value}</td>
                <td>{description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!compact ? (
        <p className="field-hint">
          Ejemplo: cuota $100,000 y venta aceptada $82,000 → cumplimiento 82%, habilitado.
          Una cotización con margen 15% y un producto con contribución $2,000 al 5% paga $100.
        </p>
      ) : null}
    </details>
  );
}

export function CommissionCategoriesCard() {
  return (
    <details className="commission-help-card">
      <summary>
        <strong>Categorías de comisión</strong>
        <span>Cada ítem entra en una sola categoría: Renovaciones, Servicios o Productos.</span>
      </summary>
      <ol className="commission-categories-list">
        <li><strong>Renovaciones:</strong> ítems marcados como renovación. Esta regla tiene prioridad.</li>
        <li>
          <strong>Servicios:</strong> ítems de tipo servicio propio cuyo proveedor es Access Quality.
        </li>
        <li><strong>Productos:</strong> todo lo demás.</li>
      </ol>
    </details>
  );
}

export function CommissionBulkApply({ quarter, disabled, onApply }) {
  const [values, setValues] = useState({ products: "", services: "", renewals: "" });
  const hasValue = COMMISSION_CATEGORIES.some((category) => values[category.key] !== "");

  return (
    <div className="commission-bulk-apply">
      <strong>Aplicar a todos los vendedores</strong>
      {COMMISSION_CATEGORIES.map((category) => (
        <label key={category.key}>
          % {category.label}
          <input
            aria-label={`Aplicar % ${category.label} a todos T${quarter}`}
            type="number"
            min="0"
            max="100"
            step="0.01"
            placeholder="Sin cambio"
            value={values[category.key]}
            disabled={disabled}
            onChange={(event) => setValues((current) => ({ ...current, [category.key]: event.target.value }))}
          />
        </label>
      ))}
      <button
        type="button"
        className="btn-secondary"
        disabled={disabled || !hasValue}
        onClick={() => {
          onApply(values);
          setValues({ products: "", services: "", renewals: "" });
        }}
      >
        Aplicar a T{quarter}
      </button>
    </div>
  );
}

export function CommissionSimulator({ quarters, year }) {
  const sellers = useMemo(() => {
    const byId = new Map();
    (quarters || []).forEach((quarter) => quarter.sellers.forEach((seller) => {
      if (!byId.has(seller.sellerUserId)) byId.set(seller.sellerUserId, seller.sellerUserName);
    }));
    return Array.from(byId, ([id, name]) => ({ id, name }));
  }, [quarters]);
  const [sellerId, setSellerId] = useState("");
  const [quarterNumber, setQuarterNumber] = useState(1);
  const [acceptedSales, setAcceptedSales] = useState("");
  const [marginPct, setMarginPct] = useState("");
  const [contributions, setContributions] = useState({ products: "", services: "", renewals: "" });

  const selectedSellerId = sellers.some((seller) => String(seller.id) === String(sellerId))
    ? sellerId
    : String(sellers[0]?.id ?? "");
  const seller = (quarters || [])
    .find((quarter) => quarter.quarter === quarterNumber)
    ?.sellers.find((item) => String(item.sellerUserId) === String(selectedSellerId));

  if (!sellers.length) return null;

  const result = simulateCommission({
    quotaAmount: seller?.salesQuotaAmount,
    acceptedSalesAmount: acceptedSales,
    marginPct,
    contributions,
    rates: seller,
  });
  const statusMessage = result.status === "eligible"
    ? "Elegible: la cotización genera comisión."
    : result.status === "blocked_by_margin"
      ? `Bloqueada por margen: ${COMMISSION_MIN_QUOTATION_MARGIN_PCT}% o más para generar comisión.`
      : `Bloqueada por cuota: se requiere ${COMMISSION_MIN_QUOTA_ATTAINMENT_PCT}% de cumplimiento.`;

  return (
    <details className="commission-help-card">
      <summary>
        <strong>Simulador de comisión</strong>
        <span>Prueba una cotización con los porcentajes que ves en pantalla; no guarda nada.</span>
      </summary>
      <div className="commission-simulator">
        <div className="commission-simulator-inputs">
          <label>
            Vendedor a simular
            <select value={selectedSellerId} onChange={(event) => setSellerId(event.target.value)}>
              {sellers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>
            Trimestre a simular
            <select value={quarterNumber} onChange={(event) => setQuarterNumber(Number(event.target.value))}>
              {[1, 2, 3, 4].map((quarter) => (
                <option key={quarter} value={quarter}>T{quarter} {year}</option>
              ))}
            </select>
          </label>
          <label>
            Venta aceptada acumulada del trimestre
            <input type="number" min="0" step="0.01" value={acceptedSales} onChange={(event) => setAcceptedSales(event.target.value)} />
          </label>
          <label>
            Margen de la cotización (%)
            <input type="number" min="0" step="0.01" value={marginPct} onChange={(event) => setMarginPct(event.target.value)} />
          </label>
          {COMMISSION_CATEGORIES.map((category) => (
            <label key={category.key}>
              Contribución de {category.label.toLowerCase()}
              <input
                type="number"
                min="0"
                step="0.01"
                value={contributions[category.key]}
                onChange={(event) => setContributions((current) => ({ ...current, [category.key]: event.target.value }))}
              />
            </label>
          ))}
        </div>
        <div className="commission-simulator-result" aria-live="polite">
          <p>
            Cuota del trimestre: <strong>{formatMoney(seller?.salesQuotaAmount)}</strong>
            {" · "}Cumplimiento: <strong>{result.attainmentPct.toFixed(2)}%</strong>
          </p>
          <p className={result.status === "eligible" ? "commission-status-ok" : "commission-status-blocked"}>
            {statusMessage}
          </p>
          <table className="commercial-planning-table commission-rules-table">
            <thead>
              <tr><th>Categoría</th><th>Contribución</th><th>%</th><th>Comisión</th></tr>
            </thead>
            <tbody>
              {result.items.map((item) => (
                <tr key={item.key}>
                  <td>{item.label}</td>
                  <td>{formatMoney(item.contribution)}</td>
                  <td>{item.rate.toFixed(2)}%</td>
                  <td>{formatMoney(item.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan="3"><strong>Comisión estimada</strong></td>
                <td><strong>{formatMoney(result.total)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </details>
  );
}
