import { z } from "zod";

export const LEGACY_CUSTOMER_CONTACT_UPDATE_FIELDS = Object.freeze([
  "hierarchyLevelId", "relationshipTypeId", "influenceLevelId", "managerContactId", "influencesContactId",
]);
export const CUSTOMER_UPDATE_FIELDS = Object.freeze({
  account: { name: ["name", 180, false], phone: ["phone", 40, true], website: ["website", 300, true],
    city: ["city", 120, true], stateRegion: ["state_region", 120, true], companyDescription: ["description", 10000, true] },
  contact: { firstName: ["first_name", 120, false], lastName: ["last_name", 120, false],
    email: ["email", 190, true], phone: ["phone", 40, true], mobile: ["mobile", 30, true],
    positionTitle: ["position_title", 120, true], department: ["department", 120, true],
    city: ["city", 120, true], stateRegion: ["state_region", 120, true] },
  opportunity: { name: ["name", 180, false], amountUsd: ["amount_usd", 40, false], closeDate: ["close_date", 10, false] },
});
export const CUSTOMER_UPDATE_LABELS = {
  name: "Nombre", firstName: "Nombre", lastName: "Apellido", phone: "Teléfono", mobile: "Móvil",
  email: "Correo", website: "Sitio web", city: "Ciudad", stateRegion: "Estado/región",
  companyDescription: "Descripción", positionTitle: "Cargo", department: "Departamento",
  amountUsd: "Importe USD", closeDate: "Cierre previsto",
};
export function parseCustomerUpdateAmount(text) {
  const value = String(text).trim();
  let canonical = value;
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(value)) canonical = value.replaceAll(",", "");
  else if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(value)) canonical = value.replaceAll(".", "").replace(",", ".");
  else if (/^\d+,\d{1,2}$/.test(value)) canonical = value.replace(",", ".");
  else if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const amount = Number(canonical);
  return Number.isFinite(amount) && amount <= 9999999999999.99 ? amount : null;
}
export function normalizeCustomerUpdateValue(object, field, value) {
  const definition = CUSTOMER_UPDATE_FIELDS[object]?.[field];
  if (!definition) throw new Error("Campo fuera del alcance A02");
  if (value === null || value === "") {
    if (!definition[2]) throw new Error("Este campo no se puede dejar vacío");
    return null;
  }
  const text = String(value).trim();
  if (!text) throw new Error("Indica un valor o solicita explícitamente vaciar el campo");
  if (text.length > definition[1]) throw new Error(`El campo admite hasta ${definition[1]} caracteres`);
  if (["name", "firstName", "lastName"].includes(field) && text.length < 2) throw new Error("El nombre requiere al menos dos caracteres");
  if (field === "amountUsd") {
    const amount = parseCustomerUpdateAmount(text);
    if (amount === null) throw new Error("Importe USD inválido; usa un número no negativo con hasta dos decimales");
    return amount;
  }
  if (field === "closeDate") {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00Z`) : null;
    if (!date || Number(text.slice(0, 4)) < 1000 || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) throw new Error("Indica una fecha real AAAA-MM-DD (año 1000 a 9999)");
  }
  if (field === "email" && !z.email().safeParse(text).success) throw new Error("Correo inválido");
  if (field === "website" && !/^(https?:\/\/)?[^\s/]+\.[^\s]+$/i.test(text)) throw new Error("Sitio web inválido");
  return text;
}
export function comparableCustomerUpdateValue(field, value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  return field === "amountUsd" ? Number(value) : String(value);
}
