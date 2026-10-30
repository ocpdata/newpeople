export const CUSTOMER_ACTIVITY_STATUS_LABELS = {
  pending: "Pendiente",
  in_progress: "En curso",
  done: "Completada",
  completed: "Completada",
  cancelled: "Cancelada",
  blocked: "Bloqueada",
};

export const CUSTOMER_ACTIVITY_TYPE_LABELS = {
  producto: "Producto",
  service: "Servicio",
  servicio: "Servicio",
  call: "Llamada",
  meeting: "Reunión",
  email: "Correo",
  visit: "Visita",
  demo: "Demostración",
  presentation: "Presentación",
};

export const CUSTOMER_FINDING_CONFIDENCE_LABELS = {
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

export function formatDate(value) {
  if (!value) return "Sin fecha";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(date);
}
