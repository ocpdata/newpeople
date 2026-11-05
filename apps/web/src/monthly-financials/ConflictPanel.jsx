import { FIELDS, FIELD_LABELS, MONTH_NAMES, formatAmount, monthFromRecord } from "./utils";

const display = (value) => (value === "" || value == null ? "Pendiente" : formatAmount(value));

export default function ConflictPanel({ conflicts, forms, currencyCode, onLoadCurrent }) {
  return (
    <section className="panel monthly-financial-conflict" role="alert">
      <h3>Hay una versión más reciente</h3>
      <p>
        Otra persona modificó {conflicts.length === 1 ? "este mes" : "estos meses"}. Tu captura se conserva y no se sobrescribió nada.
        Cargar la versión actual descarta tu captura solo de {conflicts.length === 1 ? "ese mes" : "esos meses"}; los demás cambios se mantienen.
      </p>
      {conflicts.map(({ month, record }) => {
        const current = monthFromRecord(record);
        const differences = FIELDS.filter((key) => display(forms[month][key]) !== display(current[key]));
        const currencyDiffers = record && record.currencyCode !== currencyCode;
        return (
          <div key={month} className="monthly-financial-compare">
            <h4>{MONTH_NAMES[month - 1]}</h4>
            <table>
              <thead><tr><th>Concepto</th><th>Tu captura</th><th>Versión actual</th></tr></thead>
              <tbody>
                {currencyDiffers && <tr><th>Moneda</th><td>{currencyCode || "Sin seleccionar"}</td><td>{record.currencyCode}</td></tr>}
                {differences.map((key) => (
                  <tr key={key}><th>{FIELD_LABELS[key]}</th><td>{display(forms[month][key])}</td><td>{display(current[key])}</td></tr>
                ))}
                {!currencyDiffers && !differences.length && <tr><td colSpan={3}>Sin diferencias de importes; solo cambió la versión.</td></tr>}
              </tbody>
            </table>
          </div>
        );
      })}
      <button type="button" className="btn-secondary" onClick={onLoadCurrent}>Cargar versión actual</button>
    </section>
  );
}
