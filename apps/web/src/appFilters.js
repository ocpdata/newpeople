import { useEffect, useState } from "react";

const DEFAULT_STATUS_FILTER = "active";
const VALID_STATUS_FILTERS = new Set(["active", "pending", "inactive", "all"]);

function readStoredStatusFilter(storageKey) {
  if (typeof window === "undefined") return DEFAULT_STATUS_FILTER;
  const storedValue = window.localStorage.getItem(storageKey);
  return VALID_STATUS_FILTERS.has(storedValue)
    ? storedValue
    : DEFAULT_STATUS_FILTER;
}

export function usePersistedStatusFilter(storageKey) {
  const [statusFilter, setStatusFilter] = useState(() =>
    readStoredStatusFilter(storageKey),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey, statusFilter);
  }, [storageKey, statusFilter]);

  return [statusFilter, setStatusFilter];
}

export function parseDateFilterValue(value) {
  if (!value) return null;
  const [year, month, day] = String(value)
    .split("-")
    .map((part) => Number(part));
  if (!year || !month || !day) return null;
  const parsedDate = new Date(year, month - 1, day);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

export function formatDateFilterValue(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "";
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}