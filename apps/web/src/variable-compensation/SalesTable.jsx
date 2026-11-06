import { useMemo, useState } from "react";
import { formatBusinessDate } from "../business-timezone";
import { formatNumber, formatPct, LINE_LABELS } from "./format";

export default function SalesTable({ data }) {
  const [seller, setSeller] = useState("");
  const [line, setLine] = useState("");
  const [onlyNew, setOnlyNew] = useState(false);
  const [onlyLow, setOnlyLow] = useState(false);
  const rows = useMemo(() => data.sales.filter((sale) =>
    (!seller || String(sale.sellerUserId) === seller) && (!line || sale.line === line)
    && (!onlyNew || sale.newClient) && (!onlyLow || sale.lowMargin)), [data.sales, seller, line, onlyNew, onlyLow]);
  const totals = rows.reduce((sum, sale) => ({ sale: sum.sale + sale.saleAmount, cost: sum.cost + sale.costAmount }), { sale: 0, cost: 0 });
  const margin = totals.sale > 0 ? ((totals.sale - totals.cost) / totals.sale) * 100 : null;
  return (
    <section className="vc-card" aria-labelledby="vc-sales-title">
      <h3 id="vc-sales-title" className="vc-section-title">Ventas acreditadas del trimestre</h3>
      <div className="vc-filters">
        <label>Vendedor
          <select value={seller} onChange={(event) => setSeller(event.target.value)}>
            <option value="">Todos</option>
            {data.sellers.map((item) => <option key={item.sellerUserId} value={item.sellerUserId}>{item.sellerUserName}</option>)}
          </select>
        </label>
        <label>Línea
          <select value={line} onChange={(event) => setLine(event.target.value)}>
            <option value="">Todas</option>
            {Object.entries(LINE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="vc-check"><input type="checkbox" checked={onlyNew} onChange={(event) => setOnlyNew(event.target.checked)} /> Solo clientes nuevos</label>
        <label className="vc-check"><input type="checkbox" checked={onlyLow} onChange={(event) => setOnlyLow(event.target.checked)} /> Solo margen bajo</label>
        <span className="vc-count" role="status">{rows.length} de {data.sales.length} ventas</span>
      </div>
      <div className="vc-table-wrap">
        <table className="vc-table">
          <thead>
            <tr>
              <th scope="col">Cliente</th><th scope="col">Vendedor</th><th scope="col">Línea</th><th scope="col">Acreditada</th>
              <th scope="col" className="vc-num">Monto ({data.currencyCode})</th>
              <th scope="col" className="vc-num">Costo</th><th scope="col" className="vc-num">Margen</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((sale) => (
              <tr key={sale.quotationId} className={sale.lowMargin ? "vc-row-low" : undefined}>
                <td>
                  {sale.newClient && <span className="vc-badge vc-badge-new">Nuevo</span>}
                  {sale.lowMargin && <span className="vc-badge vc-badge-low">Margen bajo</span>}
                  {sale.accountName}
                  <small>{sale.proposalName}</small>
                </td>
                <td>{sale.sellerUserName}</td>
                <td>{LINE_LABELS[sale.line]}</td>
                <td>{formatBusinessDate(sale.wonAt)}</td>
                <td className="vc-num">{formatNumber(sale.saleAmount)}</td>
                <td className="vc-num">{formatNumber(sale.costAmount)}</td>
                <td className="vc-num">{formatPct(sale.marginPct)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7}>No hay ventas con estos filtros.</td></tr>}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={4}>Total filtrado</th>
              <td className="vc-num">{formatNumber(totals.sale)}</td>
              <td className="vc-num">{formatNumber(totals.cost)}</td>
              <td className="vc-num">{formatPct(margin)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
