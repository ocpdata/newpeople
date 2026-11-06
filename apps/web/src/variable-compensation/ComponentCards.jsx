import { formatCompact, formatMoney, formatNumber, formatPct, STATE_LABELS } from "./format";

export function Meter({ value, max = 100, state, marks = [] }) {
  const width = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={`vc-track${marks.length ? " vc-track-marked" : ""}`} role="presentation">
      <div className={`vc-fill vc-${state}`} style={{ width: `${width}%` }} />
      {marks.map((mark) => (
        <span key={mark.at} className="vc-mark" style={{ left: `${Math.min(100, (mark.at / max) * 100)}%` }}>
          <i>{mark.label}</i>
        </span>
      ))}
    </div>
  );
}

function CardShell({ component, children, main, sub }) {
  const payText = component.pay > 0
    ? `Paga ${formatNumber(component.pay)} de ${formatNumber(component.max)}`
    : component.locked ? `Bloqueado · ${component.note}` : component.note;
  return (
    <article className={`vc-card vc-component vc-border-${component.state}`} aria-label={component.label}>
      <header>
        <h4>{component.label}</h4>
        <span className={`vc-pill vc-pill-${component.state}`}>
          {component.locked && component.state !== "off" ? "Bloqueado" : STATE_LABELS[component.state]}
        </span>
      </header>
      <p className="vc-main">{main}</p>
      {sub && <p className="vc-sub">{sub}</p>}
      {children}
      <footer className={component.pay > 0 ? "vc-pay" : "vc-pay vc-pay-zero"}>{payText}</footer>
    </article>
  );
}

export default function ComponentCards({ data }) {
  const { variable, company, sellers, sellersInQuota, newClients, existingAccounts, currencyCode } = data;
  const r = data.rules.rules;
  const byKey = Object.fromEntries(variable.components.map((component) => [component.key, component]));
  const growth = existingAccounts.available ? existingAccounts.growthPct : null;
  const lowSales = data.sales.filter((sale) => sale.lowMargin);
  const lowAmount = lowSales.reduce((sum, sale) => sum + sale.saleAmount, 0);
  return (
    <div className="vc-components">
      <CardShell
        component={byKey.quota}
        main={formatPct(company.attainmentPct)}
        sub={`${formatCompact(company.salesAmount, currencyCode)} de ${formatCompact(company.quotaAmount, currencyCode)}`}
      >
        <Meter value={Math.min(company.attainmentPct, 133)} max={133} state={byKey.quota.state}
          marks={[{ at: r.quota.floorPct, label: `${r.quota.floorPct}%` }, { at: r.quota.fullActivationPct, label: `${r.quota.fullActivationPct}%` }, { at: r.quota.targetPct, label: "meta" }]} />
      </CardShell>
      <CardShell
        component={byKey.margin}
        main={formatPct(company.marginPct)}
        sub={`≥${r.margin.fullPct}% paga completo · ${r.margin.partialPct}–${r.margin.fullPct}% paga ${formatNumber(r.margin.partialPay)}`}
      >
        <Meter value={Math.min(company.marginPct || 0, 50)} max={50} state={byKey.margin.state}
          marks={[{ at: r.margin.partialPct, label: `${r.margin.partialPct}%` }, { at: r.margin.fullPct, label: `${r.margin.fullPct}%` }]} />
        {lowSales.length > 0 && (
          <p className="vc-sub vc-note-bad">
            {lowSales.length} venta(s) con margen menor a {r.margin.lowMarginSalePct}% ({formatCompact(lowAmount, currencyCode)}): cuentan para cuota y se marcan en la tabla.
          </p>
        )}
      </CardShell>
      <CardShell component={byKey.team} main={<>{sellersInQuota} <small>de {sellers.length}</small></>}>
        <ul className="vc-sellers">
          {sellers.map((seller) => {
            const state = seller.attainmentPct >= r.team.sellerQuotaPct ? "ok" : seller.attainmentPct >= r.quota.floorPct ? "warn" : "bad";
            return (
              <li key={seller.sellerUserId}>
                <span className="vc-seller-name">{seller.sellerUserName}</span>
                <span className="vc-seller-pct">{formatPct(seller.attainmentPct, 0)}</span>
                <span className={`vc-dot vc-${state}`} role="img" aria-label={STATE_LABELS[state]} />
                <Meter value={Math.min(seller.attainmentPct, 100)} state={state} />
              </li>
            );
          })}
        </ul>
      </CardShell>
      <CardShell
        component={byKey.newClients}
        main={formatCompact(newClients.amount, currencyCode)}
        sub={`Meta: ${formatCompact(newClients.requiredAmount, currencyCode)} y ${newClients.requiredClients} clientes de ${formatCompact(newClients.clientMinAmount, currencyCode)}`}
      >
        <Meter value={newClients.requiredAmount > 0 ? (newClients.amount / newClients.requiredAmount) * 100 : 0} state={newClients.amountMet ? "ok" : "warn"} />
        <p className="vc-sub">Clientes que cumplen: {newClients.qualifyingClients} de {newClients.requiredClients}</p>
      </CardShell>
      <CardShell
        component={byKey.existingAccounts}
        main={growth == null ? "Sin base" : `${growth >= 0 ? "+" : ""}${growth.toFixed(1)}%`}
        sub={growth == null
          ? "Sin ventas comparables del mismo trimestre del año anterior"
          : `${formatCompact(existingAccounts.currentAmount, currencyCode)} vs ${formatCompact(existingAccounts.baselineAmount, currencyCode)} · meta +${r.existingAccounts.minGrowthPct}%`}
      >
        {growth != null && <Meter value={Math.max(0, growth)} max={r.existingAccounts.minGrowthPct || 1} state={existingAccounts.met ? "ok" : "warn"} />}
      </CardShell>
    </div>
  );
}

export function VariableHero({ data }) {
  const { variable, company, currencyCode, period } = data;
  const r = data.rules.rules;
  const payCurrency = r.payCurrencyCode;
  return (
    <div className="vc-hero">
      <section className="vc-card vc-variable" aria-label="Variable del trimestre">
        <h3 className="vc-label">Variable del trimestre · ventas aceptadas a la fecha</h3>
        <p className="vc-big">{formatMoney(variable.total, payCurrency)}</p>
        <p className="vc-sub">
          de {formatMoney(variable.maxTotal, payCurrency)} posibles{variable.capped ? " · tope trimestral aplicado" : ""}.
          {company.pendingAcceptanceCount > 0 && ` Hay ${company.pendingAcceptanceCount} venta(s) ganada(s) por aceptar (${formatCompact(company.pendingAcceptanceAmount, currencyCode)}) que aún no cuentan.`}
        </p>
        <ul className="vc-chips">
          {variable.components.map((component) => (
            <li key={component.key} className={component.pay > 0 ? "vc-chip vc-chip-pay" : "vc-chip"}>
              {component.label} {component.pay > 0 ? formatNumber(component.pay) : "—"}
            </li>
          ))}
        </ul>
      </section>
      <section className="vc-card" aria-label="Cuota del trimestre">
        <h3 className="vc-label">Cuota del trimestre</h3>
        <p className="vc-kpi">{formatPct(company.attainmentPct)}</p>
        <p className="vc-sub">{formatCompact(company.salesAmount, currencyCode)} de {formatCompact(company.quotaAmount, currencyCode)}</p>
        <Meter value={Math.min(company.attainmentPct, 133)} max={133} state={variable.components[0].state}
          marks={[{ at: r.quota.floorPct, label: `${r.quota.floorPct}%` }, { at: r.quota.targetPct, label: "meta" }]} />
        <p className="vc-sub vc-pace">
          Faltan {formatCompact(company.remainingQuotaAmount, currencyCode)} en {period.daysRemaining} días
          {company.requiredDailyAmount != null ? ` · ${formatCompact(company.requiredDailyAmount, currencyCode)} por día` : ""}.
        </p>
      </section>
      <section className="vc-card" aria-label="Margen comercial">
        <h3 className="vc-label">Margen comercial</h3>
        <p className="vc-kpi">{formatPct(company.marginPct)}</p>
        <p className="vc-sub">Ponderado por importe de venta</p>
        <Meter value={Math.min(company.marginPct || 0, 50)} max={50} state={variable.components[1].state}
          marks={[{ at: r.margin.partialPct, label: `${r.margin.partialPct}%` }, { at: r.margin.fullPct, label: `${r.margin.fullPct}%` }]} />
        {company.marginExcludingLowPct != null && company.marginExcludingLowPct !== company.marginPct && (
          <p className="vc-sub vc-pace">Sin ventas de margen bajo: {formatPct(company.marginExcludingLowPct)}</p>
        )}
      </section>
    </div>
  );
}
