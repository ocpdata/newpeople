import FinancialCell from "./FinancialCell";
import {
  FIELD_LABELS, SECTIONS, cellError, formatAmount, isFinancialRate, totalLabel,
} from "./utils";

export default function MonthForm({ month, form, totals, currencyCode, disabled, onChange, onPaste, onNavigate }) {
  return (
    <div className="monthly-financial-sections">
      {SECTIONS.map((section) => (
        <section key={section.title} className="panel monthly-financial-section full">
          <h3>{section.title}</h3>
          <div className={section.groups.length > 1 ? "monthly-financial-other" : undefined}>
            {section.groups.map((group) => (
              <div key={group.title}>
                {section.groups.length > 1 && <h4>{group.title}</h4>}
                <div className="monthly-financial-fields">
                  {group.fields.map(([key, label, help]) => {
                    const message = cellError(key, form[key]);
                    return (
                      <label key={key} htmlFor={`financial-cell-${month}-${key}`}>
                        <span>{label}</span>
                        <div className="monthly-financial-input">
                          <FinancialCell
                            month={month}
                            field={key}
                            value={form[key]}
                            invalid={Boolean(message)}
                            disabled={disabled}
                            ariaLabel={FIELD_LABELS[key]}
                            describedBy={message ? `financial-error-${key}` : help ? `financial-help-${key}` : undefined}
                            onChange={onChange}
                            onPaste={onPaste}
                            onNavigate={onNavigate}
                          />
                          <span>{isFinancialRate(key) ? "%" : currencyCode || "—"}</span>
                        </div>
                        {help && <small id={`financial-help-${key}`}>{help}</small>}
                        {message && <small id={`financial-error-${key}`} className="monthly-financial-error">{message}</small>}
                      </label>
                    );
                  })}
                </div>
                {group.total && (
                  <div className="monthly-financial-total">
                    <span>{totals[group.total].pending ? "Subtotal registrado" : totalLabel(group)}</span>
                    <strong>
                      {totals[group.total].pending === group.fields.length
                        ? "Pendiente"
                        : `${formatAmount(totals[group.total].amount)} ${currencyCode}`}
                    </strong>
                    {totals[group.total].pending > 0 && <small>{totals[group.total].pending} conceptos pendientes</small>}
                  </div>
                )}
                {group.title === "Porcentajes" && (
                  <p className="field-hint">Escribe 30 para indicar 30%. Estas tasas no calculan automáticamente ISR ni PTU en dinero.</p>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
