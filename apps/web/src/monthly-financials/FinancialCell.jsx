import { memo, useState } from "react";
import { AMOUNT_PATTERN, formatAmount } from "./utils";

// While typing it shows the raw text; otherwise the stored value with thousands separators.
function FinancialCell({ month, field, value, invalid, disabled, ariaLabel, describedBy, onChange, onPaste, onNavigate }) {
  const [draft, setDraft] = useState(null);
  const shown = draft ?? (AMOUNT_PATTERN.test(value) ? formatAmount(value) : value);

  return (
    <input
      id={`financial-cell-${month}-${field}`}
      className="monthly-financial-cell"
      type="text"
      inputMode="decimal"
      autoComplete="off"
      placeholder="—"
      maxLength={20}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      value={shown}
      onChange={(event) => {
        setDraft(event.target.value);
        onChange(month, field, event.target.value.replace(/,/g, "").trim());
      }}
      onBlur={() => setDraft(null)}
      onPaste={(event) => {
        const text = event.clipboardData.getData("text");
        if (!/[\t\n]/.test(text.replace(/\r?\n$/, ""))) return;
        event.preventDefault();
        setDraft(null);
        onPaste(month, field, text);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          onNavigate(month, field, event.key === "ArrowUp" || (event.key === "Enter" && event.shiftKey) ? -1 : 1);
        }
      }}
    />
  );
}

export default memo(FinancialCell);
