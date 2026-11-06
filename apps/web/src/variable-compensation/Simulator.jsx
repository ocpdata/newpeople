import { useId, useState } from "react";
import { calculateVariable } from "../../../../shared/variable-compensation.js";
import { formatMoney, formatNumber } from "./format";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export default function Simulator({ data }) {
  const rules = data.rules.rules;
  const teamSize = data.sellers.length;
  const id = useId();
  const [attainment, setAttainment] = useState(() => clamp(Math.round(data.company.attainmentPct), 50, 140));
  const [margin, setMargin] = useState(() => clamp(Math.round((data.company.marginPct ?? 34) * 2) / 2, 25, 42));
  const [sellers, setSellers] = useState(() => Math.min(data.sellersInQuota, teamSize));
  const [newClientsMet, setNewClientsMet] = useState(Boolean(data.newClients.met));
  const [existingMet, setExistingMet] = useState(Boolean(data.existingAccounts.met));
  const result = calculateVariable(rules, {
    attainmentPct: attainment, marginPct: margin, sellersInQuota: sellers,
    newClientsMet, existingAccountsMet: existingMet,
  });
  const payCurrency = rules.payCurrencyCode;
  return (
    <section className="vc-card vc-simulator" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="vc-section-title">Simulador · ¿cuánto pagaría el trimestre?</h3>
      <div className="vc-sim-grid">
        <div className="vc-sim-controls">
          <label>
            <span>Cuota alcanzada <strong>{attainment}%</strong></span>
            <input type="range" min="50" max="140" step="1" value={attainment} onChange={(event) => setAttainment(Number(event.target.value))} />
          </label>
          <label>
            <span>Margen promedio <strong>{margin.toFixed(1)}%</strong></span>
            <input type="range" min="25" max="42" step="0.5" value={margin} onChange={(event) => setMargin(Number(event.target.value))} />
          </label>
          <label>
            <span>Vendedores en cuota <strong>{sellers} de {teamSize}</strong></span>
            <input type="range" min="0" max={teamSize} step="1" value={sellers} onChange={(event) => setSellers(Number(event.target.value))} />
          </label>
          <label className="vc-check">
            <input type="checkbox" checked={newClientsMet} onChange={(event) => setNewClientsMet(event.target.checked)} />
            Clientes nuevos cumplidos ({formatNumber(rules.newClients.pay)})
          </label>
          <label className="vc-check">
            <input type="checkbox" checked={existingMet} onChange={(event) => setExistingMet(event.target.checked)} />
            Crecimiento de cuentas actuales cumplido ({formatNumber(rules.existingAccounts.pay)})
          </label>
        </div>
        <div className="vc-sim-output" aria-live="polite">
          <p className="vc-label">Variable del trimestre</p>
          <p className="vc-big">{formatMoney(result.total, payCurrency)}</p>
          <ul>
            {result.components.map((component) => (
              <li key={component.key}><span>{component.label}</span><strong>{formatNumber(component.pay)}</strong></li>
            ))}
          </ul>
          <p className="vc-sub">
            {!result.floorReached
              ? `Bajo el piso: no se paga variable (se requiere al menos ${rules.quota.floorPct}% de la cuota).`
              : !result.fullActivation
                ? `Pago parcial: entre ${rules.quota.floorPct}% y ${rules.quota.fullActivationPct}% solo se pagan cuota y margen.`
                : result.components[0].note}
            {result.capped ? " Se aplicó el tope trimestral." : ""}
          </p>
        </div>
      </div>
    </section>
  );
}
