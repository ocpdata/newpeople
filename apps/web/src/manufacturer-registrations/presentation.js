const dateFormatter = new Intl.DateTimeFormat("es-MX", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("es-MX", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatManufacturerRegistrationDate(value, withTime = false) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return withTime ? dateTimeFormatter.format(date) : dateFormatter.format(date);
}

export function getManufacturerRegistrationStatusLabel(status) {
  switch (String(status || "").trim()) {
    case "aprobado":
      return "Aprobado";
    case "renovado":
      return "Renovado";
    case "vencido":
      return "Vencido";
    case "rechazado":
      return "Rechazado";
    case "sin_aprobar":
    default:
      return "Sin aprobar";
  }
}

export function getManufacturerRegistrationStatusClass(status) {
  switch (String(status || "").trim()) {
    case "aprobado":
      return "is-approved";
    case "renovado":
      return "is-renewed";
    case "vencido":
      return "is-expired";
    case "rechazado":
      return "is-rejected";
    case "sin_aprobar":
    default:
      return "is-pending";
  }
}

export function getManufacturerRegistrationAlertLabel(alertLevel) {
  switch (String(alertLevel || "").trim()) {
    case "critical":
      return "Critica";
    case "warning":
      return "Proxima";
    case "info":
      return "Preventiva";
    case "expired":
      return "Vencido";
    default:
      return "Sin alerta";
  }
}

export function getManufacturerRegistrationAlertClass(alertLevel) {
  switch (String(alertLevel || "").trim()) {
    case "critical":
      return "is-critical";
    case "warning":
      return "is-warning";
    case "info":
      return "is-info";
    case "expired":
      return "is-expired";
    default:
      return "is-none";
  }
}

export function getManufacturerRegistrationExpirationLabel(item) {
  if (!item?.expiresAt) {
    return "Sin vigencia";
  }

  const daysToExpire = Number(item?.daysToExpire);
  if (!Number.isFinite(daysToExpire)) {
    return formatManufacturerRegistrationDate(item.expiresAt);
  }
  if (daysToExpire < 0) {
    const absDays = Math.abs(daysToExpire);
    return absDays === 1 ? "Vencio ayer" : `Vencido hace ${absDays} dias`;
  }
  if (daysToExpire === 0) {
    return "Vence hoy";
  }
  if (daysToExpire === 1) {
    return "Vence manana";
  }
  return `Vence en ${daysToExpire} dias`;
}

export function toDateInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}
