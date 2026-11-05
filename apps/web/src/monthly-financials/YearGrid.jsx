import FinancialCell from "./FinancialCell";
import {
  FIELD_LABELS, MONTHS, MONTH_NAMES, MONTH_SHORT, SECTIONS, formatAmount, groupYearTotal,
  isFinancialRate, registeredCount, rowYearTotal, totalLabel, FIELDS,
} from "./utils";

function Amount({ amount, registered, size }) {
  if (registered === 0) return <span className="mf-empty">—</span>;
  return (
    <>
      <span>{formatAmount(amount)}</span>
      {registered < size && <small>parcial</small>}
    </>
  );
}

function monthStatus(form) {
  const count = registeredCount(form);
  if (count === 0) return "Sin datos";
  return count === FIELDS.length ? "Completo" : `${count}/${FIELDS.length}`;
}

export default function YearGrid({
  forms, errors, totalsByMonth, dirtyMonths, conflictMonths, disabled, mixedCurrencies,
  onChange, onPaste, onNavigate, onRepeat,
}) {
  return (
    <div className="monthly-financial-grid-wrap" role="region" aria-label="Tabla anual de información financiera" tabIndex={0}>
      <table className="monthly-financial-grid">
        <thead>
          <tr>
            <th scope="col" className="mf-label">Concepto</th>
            {MONTHS.map((month) => (
              <th
                key={month}
                scope="col"
                className={`mf-month${dirtyMonths.has(month) ? " is-dirty" : ""}${conflictMonths.has(month) ? " is-conflict" : ""}`}
              >
                <abbr title={MONTH_NAMES[month - 1]}>{MONTH_SHORT[month - 1]}</abbr>
                <small>{monthStatus(forms[month])}</small>
                {dirtyMonths.has(month) && <span className="mf-dot" role="img" aria-label="Cambios sin guardar">●</span>}
              </th>
            ))}
            <th scope="col" className="mf-year-total">Total del año</th>
          </tr>
        </thead>
        <tbody>
          {SECTIONS.map((section) => (
            <SectionRows
              key={section.title}
              section={section}
              props={{ forms, errors, totalsByMonth, disabled, mixedCurrencies, onChange, onPaste, onNavigate, onRepeat }}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SectionRows({ section, props }) {
  const { forms, errors, totalsByMonth, disabled, mixedCurrencies, onChange, onPaste, onNavigate, onRepeat } = props;
  const columns = MONTHS.length + 2;
  return (
    <>
      <tr className="mf-band"><th scope="colgroup" colSpan={columns}>{section.title}</th></tr>
      {section.groups.map((group) => (
        <GroupRows key={group.title} group={group} showTitle={section.groups.length > 1} columns={columns}>
          {group.fields.map(([key, , help]) => {
            const yearTotal = rowYearTotal(forms, key);
            return (
              <tr key={key}>
                <th scope="row" className="mf-label" title={help}>{FIELD_LABELS[key]}</th>
                {MONTHS.map((month) => (
                  <td key={month}>
                    <FinancialCell
                      month={month}
                      field={key}
                      value={forms[month][key]}
                      invalid={Boolean(errors[`${month}-${key}`])}
                      disabled={disabled}
                      ariaLabel={`${FIELD_LABELS[key]}, ${MONTH_NAMES[month - 1]}`}
                      onChange={onChange}
                      onPaste={onPaste}
                      onNavigate={onNavigate}
                    />
                  </td>
                ))}
                <td className="mf-year-total">
                  {isFinancialRate(key) ? (
                    <button
                      type="button"
                      className="mf-repeat"
                      disabled={disabled}
                      aria-label={`Repetir ${FIELD_LABELS[key]} en los meses vacíos siguientes`}
                      title="Copia el último valor capturado a los meses vacíos que le siguen"
                      onClick={() => onRepeat(key)}
                    >
                      Repetir →
                    </button>
                  ) : mixedCurrencies ? <span className="mf-empty">—</span> : <Amount {...yearTotal} />}
                </td>
              </tr>
            );
          })}
          {group.total && (
            <tr className="mf-subtotal">
              <th scope="row" className="mf-label">{totalLabel(group)}</th>
              {MONTHS.map((month) => {
                const total = totalsByMonth[month][group.total];
                return (
                  <td key={month}>
                    <Amount amount={total.amount} registered={group.fields.length - total.pending} size={group.fields.length} />
                  </td>
                );
              })}
              <td className="mf-year-total">
                {mixedCurrencies ? <span className="mf-empty">—</span> : <Amount {...groupYearTotal(totalsByMonth, group)} />}
              </td>
            </tr>
          )}
        </GroupRows>
      ))}
    </>
  );
}

function GroupRows({ group, showTitle, columns, children }) {
  return (
    <>
      {showTitle && <tr className="mf-subband"><th scope="colgroup" colSpan={columns}>{group.title}</th></tr>}
      {children}
    </>
  );
}
