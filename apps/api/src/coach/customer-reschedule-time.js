import { getCommercialSettings } from "../settings.js";
import { config } from "../config.js";

export async function loadRescheduleTimezone() {
  const settings = await getCommercialSettings();
  return String(settings?.businessTimezone || config.app?.businessTimezone || "America/Mexico_City").trim();
}

export function localSchedule(value, timeZone) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

export function scheduleUtc(local, timeZone) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(local)) return null;
  const base = Date.parse(`${local}Z`);
  if (!Number.isFinite(base)) return null;
  const candidates = new Map();
  // Check offsets on either side of a possible DST transition; reject gaps and overlaps.
  for (const delta of [-86400000, 0, 86400000]) {
    const probe = new Date(base + delta);
    const offset = Date.parse(`${localSchedule(probe, timeZone)}Z`) - probe.getTime();
    const candidate = new Date(base - offset);
    if (localSchedule(candidate, timeZone) === local) candidates.set(candidate.getTime(), candidate);
  }
  return candidates.size === 1 ? [...candidates.values()][0] : null;
}

const normalize = (text) => String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const weekdays = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export function resolveBusinessDate(text, today) {
  const value = normalize(text);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const numeric = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (numeric) return `${numeric[3]}-${numeric[2].padStart(2, "0")}-${numeric[1].padStart(2, "0")}`;
  const named = value.match(/^(\d{1,2}) de ([a-z]+) de (\d{4})$/);
  if (named && months.includes(named[2])) return `${named[3]}-${String(months.indexOf(named[2]) + 1).padStart(2, "0")}-${named[1].padStart(2, "0")}`;
  const day = new Date(`${today}T12:00:00Z`);
  const relativeDays = { hoy: 0, manana: 1, "pasado manana": 2 };
  let offset = Object.hasOwn(relativeDays, value) ? relativeDays[value] : undefined;
  const weekday = value.replace(/^(el |este |proximo )/, "");
  if (weekdays.includes(weekday)) {
    offset = (weekdays.indexOf(weekday) - day.getUTCDay() + 7) % 7;
    if (offset === 0 && !value.startsWith("este ")) offset = 7;
  }
  if (offset === undefined) return null;
  day.setUTCDate(day.getUTCDate() + offset);
  return day.toISOString().slice(0, 10);
}
function timeOnly(text) {
  let value = normalize(text).replace(/^a las? /, "");
  const words = ["cero", "una", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce"];
  value = value.replace(/^([a-z]+)(?= |$)/, (word) => words.includes(word) ? String(words.indexOf(word)) : word);
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return `${value}:00`;
  const match = value.match(/^(\d{1,2})(?::([0-5]\d))? (am|pm|de la manana|de la tarde|de la noche)$/);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 12) return null;
  const hour = Number(match[1]) % 12 + (["pm", "de la tarde", "de la noche"].includes(match[3]) ? 12 : 0);
  return `${String(hour).padStart(2, "0")}:${match[2] || "00"}:00`;
}

export function proposeSchedule({ current, dateText, timeText, timeZone, now = new Date() }) {
  const original = localSchedule(current, timeZone);
  const date = dateText ? resolveBusinessDate(dateText, localSchedule(now, timeZone).slice(0, 10)) : original?.slice(0, 10);
  const time = timeText ? timeOnly(timeText) : original?.slice(11);
  if (!date || !time) return { error: "Indica una fecha inequívoca y una hora (HH:mm de 24 horas o con mañana/tarde). No inventaré los datos faltantes." };
  const proposed = scheduleUtc(`${date}T${time}`, timeZone);
  if (!proposed) return { error: "La fecha/hora es inválida o ambigua en la zona del negocio. Indica otra programación." };
  if (proposed.getTime() <= now.getTime()) return { error: "La nueva programación debe estar en el futuro. Indica una fecha y hora futuras." };
  return { proposed: proposed.toISOString(), local: `${date}T${time}`, original, dueDate: date };
}
