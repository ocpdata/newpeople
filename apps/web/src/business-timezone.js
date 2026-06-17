import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export const DEFAULT_BUSINESS_TIMEZONE = "America/Mexico_City";
const DATE_ONLY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

let activeBusinessTimezone = DEFAULT_BUSINESS_TIMEZONE;

const BusinessTimezoneContext = createContext({
  businessTimezone: DEFAULT_BUSINESS_TIMEZONE,
  setBusinessTimezone: () => {},
});

function getFormatterParts(formatter, value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const parts = formatter.formatToParts(date);
  const lookup = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      lookup[part.type] = part.value;
    }
  }
  return lookup;
}

function parseDateOnlyText(value) {
  const text = String(value || "").trim();
  const match = DATE_ONLY_REGEX.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  return { year, month, day, text };
}

export function isValidIanaTimezone(timezone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: String(timezone || "") });
    return true;
  } catch {
    return false;
  }
}

export function normalizeBusinessTimezone(timezone) {
  const candidate = String(timezone || "").trim();
  if (!candidate) {
    return DEFAULT_BUSINESS_TIMEZONE;
  }
  return isValidIanaTimezone(candidate)
    ? candidate
    : DEFAULT_BUSINESS_TIMEZONE;
}

export function getActiveBusinessTimezone() {
  return activeBusinessTimezone;
}

export function setActiveBusinessTimezone(timezone) {
  activeBusinessTimezone = normalizeBusinessTimezone(timezone);
}

export function getBusinessDateParts(value, timezone = getActiveBusinessTimezone()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: normalizeBusinessTimezone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = getFormatterParts(formatter, value);
  if (!parts) return null;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

export function toBusinessDateIso(value, timezone = getActiveBusinessTimezone()) {
  const dateOnly = parseDateOnlyText(value);
  if (dateOnly) return dateOnly.text;
  const parts = getBusinessDateParts(value, timezone);
  if (!parts) return "";
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function getTodayBusinessDate(timezone = getActiveBusinessTimezone()) {
  return toBusinessDateIso(new Date(), timezone);
}

export function addDaysToIsoDate(dateText, days) {
  const [year, month, day] = String(dateText || "")
    .split("-")
    .map((value) => Number(value));
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return String(dateText || "");
  }
  const base = new Date(Date.UTC(year, month - 1, day));
  base.setUTCDate(base.getUTCDate() + Number(days || 0));
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, "0")}-${String(base.getUTCDate()).padStart(2, "0")}`;
}

export function formatBusinessDate(
  value,
  {
    locale = "es-MX",
    options = { day: "2-digit", month: "2-digit", year: "numeric" },
    fallback = "Sin fecha",
    timezone = getActiveBusinessTimezone(),
  } = {},
) {
  if (!value) return fallback;
  const dateOnly = parseDateOnlyText(value);
  if (dateOnly) {
    const exactDate = new Date(
      Date.UTC(dateOnly.year, dateOnly.month - 1, dateOnly.day, 12, 0, 0),
    );
    return exactDate.toLocaleDateString(locale, {
      ...options,
      timeZone: "UTC",
    });
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toLocaleDateString(locale, {
    ...options,
    timeZone: normalizeBusinessTimezone(timezone),
  });
}

export function formatBusinessDateTime(
  value,
  {
    locale = "es-MX",
    options = {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
    fallback = "Sin fecha",
    timezone = getActiveBusinessTimezone(),
  } = {},
) {
  if (!value) return fallback;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toLocaleString(locale, {
    ...options,
    timeZone: normalizeBusinessTimezone(timezone),
  });
}

export function formatBusinessTime(
  value,
  {
    locale = "es-MX",
    options = { hour: "2-digit", minute: "2-digit" },
    fallback = "Sin hora",
    timezone = getActiveBusinessTimezone(),
  } = {},
) {
  if (!value) return fallback;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toLocaleTimeString(locale, {
    ...options,
    timeZone: normalizeBusinessTimezone(timezone),
  });
}

export function toBusinessDateTimeInputValue(
  value,
  timezone = getActiveBusinessTimezone(),
) {
  if (!value) return "";
  const parts = getBusinessDateParts(value, timezone);
  if (!parts) return "";
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function toBusinessDateInputValue(
  value,
  timezone = getActiveBusinessTimezone(),
) {
  if (!value) {
    return getTodayBusinessDate(timezone);
  }
  return toBusinessDateIso(value, timezone);
}

export function BusinessTimezoneProvider({ initialTimezone, children }) {
  const [businessTimezone, setBusinessTimezone] = useState(() =>
    normalizeBusinessTimezone(initialTimezone),
  );

  useEffect(() => {
    setBusinessTimezone(normalizeBusinessTimezone(initialTimezone));
  }, [initialTimezone]);

  useEffect(() => {
    setActiveBusinessTimezone(businessTimezone);
  }, [businessTimezone]);

  useEffect(() => {
    function handleTimezoneUpdated(event) {
      const nextTimezone = normalizeBusinessTimezone(
        event?.detail?.businessTimezone,
      );
      setBusinessTimezone(nextTimezone);
    }

    window.addEventListener("business-timezone-updated", handleTimezoneUpdated);
    return () => {
      window.removeEventListener(
        "business-timezone-updated",
        handleTimezoneUpdated,
      );
    };
  }, []);

  const contextValue = useMemo(
    () => ({
      businessTimezone,
      setBusinessTimezone,
    }),
    [businessTimezone],
  );

  return createElement(
    BusinessTimezoneContext.Provider,
    { value: contextValue },
    children,
  );
}

export function useBusinessTimezone() {
  return useContext(BusinessTimezoneContext);
}
