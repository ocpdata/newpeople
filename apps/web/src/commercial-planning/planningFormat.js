export function formatAmount(value) {
  return new Intl.NumberFormat("es-MX", {
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

export function formatPercent(value) {
  if (value === null || value === undefined || value === "") return "Sin dato";
  return `${Number(value).toFixed(2)}%`;
}

export function normalizeDecimalInput(value) {
  return String(value || "")
    .replace(/,/g, "")
    .trim();
}

export function formatGroupedDecimalInput(value) {
  const normalized = normalizeDecimalInput(value);
  if (!normalized) return "";

  const isNegative = normalized.startsWith("-");
  const unsigned = isNegative ? normalized.slice(1) : normalized;
  const [integerPartRaw, decimalPart] = unsigned.split(".");
  const integerPart = integerPartRaw.replace(/\D/g, "") || "0";
  const groupedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  return `${isNegative ? "-" : ""}${groupedInteger}${
    decimalPart !== undefined ? `.${decimalPart}` : ""
  }`;
}

export function withCurrentCatalogOption(options, currentValue, valueKey = "code") {
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
