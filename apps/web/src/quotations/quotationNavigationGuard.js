const QUOTATION_NAVIGATION_GUARD_KEY = "__quotationNavigationGuards";

function getNavigationGuardStore() {
  if (typeof window === "undefined") {
    return null;
  }

  const currentStore = window[QUOTATION_NAVIGATION_GUARD_KEY];
  if (currentStore && typeof currentStore === "object") {
    return currentStore;
  }

  const nextStore = {};
  window[QUOTATION_NAVIGATION_GUARD_KEY] = nextStore;
  return nextStore;
}

function cleanupNavigationGuardStore(store) {
  if (
    typeof window !== "undefined" &&
    store &&
    Object.keys(store).length === 0
  ) {
    delete window[QUOTATION_NAVIGATION_GUARD_KEY];
  }
}

export function setQuotationNavigationGuard(sourceId, options) {
  const store = getNavigationGuardStore();
  if (!store || !sourceId) {
    return;
  }

  if (options?.active) {
    store[sourceId] = {
      message: options.message || "",
    };
    return;
  }

  delete store[sourceId];
  cleanupNavigationGuardStore(store);
}

export function confirmQuotationNavigation() {
  if (typeof window === "undefined") {
    return true;
  }

  const store = getNavigationGuardStore();
  if (!store) {
    return true;
  }

  const activeGuard = Object.values(store).find(Boolean);
  if (!activeGuard?.message) {
    cleanupNavigationGuardStore(store);
    return true;
  }

  return window.confirm(activeGuard.message);
}
