import { useCallback, useEffect, useMemo, useState } from "react";
import { api, getApiErrorMessage } from "../api";
import { usePersistedStatusFilter } from "../appFilters";
import { useProviderPricing } from "./useProviderPricing";

export function useProvidersPage({ currentUser }) {
  const [providers, setProviders] = useState([]);
  const [providerStatusFilter, setProviderStatusFilterState] =
    usePersistedStatusFilter("crm.providers.statusFilter");
  const [providerQuery, setProviderQueryState] = useState("");
  const [providerSortField, setProviderSortField] = useState("id");
  const [providerSortDirection, setProviderSortDirection] = useState("asc");
  const [providersPerPage, setProvidersPerPageState] = useState(10);
  const [providersPage, setProvidersPage] = useState(1);
  const [showProviderModal, setShowProviderModal] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState(null);
  const [editProviderAudit, setEditProviderAudit] = useState(null);
  const [openProviderMenuId, setOpenProviderMenuId] = useState(null);
  const [confirmProviderStatusAction, setConfirmProviderStatusAction] =
    useState(null);
  const [savingProvider, setSavingProvider] = useState(false);
  const [catalogs, setCatalogs] = useState({
    countries: [],
    providerStatuses: [],
    priceItemStatuses: [],
    currencies: [],
    productTypes: [],
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [form, setForm] = useState({
    name: "",
    registrationCode: "",
    addressLine: "",
    countryId: "",
    city: "",
    postalCode: "",
    stateRegion: "",
    activationStatusId: "",
  });

  const explicitProviderPermissions = useMemo(
    () => new Set(currentUser?.permissions || []),
    [currentUser],
  );

  const canCreateProviders =
    explicitProviderPermissions.has("proveedores.create");
  const canUpdateProviders =
    explicitProviderPermissions.has("proveedores.update");
  const canReadProviderPrices =
    explicitProviderPermissions.has("proveedores_precios.read") ||
    canCreateProviders ||
    canUpdateProviders;
  const canCreateProviderPrices = explicitProviderPermissions.has(
    "proveedores_precios.create",
  );
  const canUpdateProviderPrices = explicitProviderPermissions.has(
    "proveedores_precios.update",
  );

  function normalizeText(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  }

  function findCatalogIdByCode(options, expectedCode) {
    const target = normalizeText(expectedCode);
    const found = options.find((opt) => normalizeText(opt.code) === target);
    return found ? String(found.id) : "";
  }

  function buildDefaultProviderForm() {
    const defaultCountryId = catalogs.countries.find(
      (country) => normalizeText(country.name) === "mexico",
    );

    return {
      name: "",
      registrationCode: "",
      addressLine: "",
      countryId: defaultCountryId ? String(defaultCountryId.id) : "",
      city: "",
      postalCode: "",
      stateRegion: "",
      activationStatusId:
        findCatalogIdByCode(catalogs.providerStatuses, "activado") ||
        String(catalogs.providerStatuses?.[0]?.id || ""),
    };
  }

  function formatPriceValue(price, currencyCode) {
    const code = String(currencyCode || "USD").toUpperCase();
    try {
      return new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency: code,
      }).format(Number(price || 0));
    } catch {
      return `${code} ${Number(price || 0).toFixed(2)}`;
    }
  }

  const pricing = useProviderPricing({
    providers,
    catalogs,
    formatPriceValue,
    reloadProviders: load,
    setError,
    setSuccess,
  });

  useEffect(() => {
    if (!error && !success) return;
    const timeoutId = window.setTimeout(() => {
      setError("");
      setSuccess("");
    }, 4000);
    return () => window.clearTimeout(timeoutId);
  }, [error, success]);

  useEffect(() => {
    if (openProviderMenuId === null) return undefined;

    function handlePointerDown(event) {
      if (event.target.closest(".providers-kebab-wrap")) return;
      setOpenProviderMenuId(null);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [openProviderMenuId]);

  async function load() {
    try {
      const [
        providersRes,
        countriesRes,
        providerStatusesRes,
        priceItemStatusesRes,
        currenciesRes,
        productTypesRes,
      ] = await Promise.all([
        api.get("/api/providers"),
        api.get("/api/catalogs/provider-countries"),
        api.get("/api/catalogs/provider-activation-statuses"),
        api.get("/api/catalogs/provider-price-list-item-statuses"),
        api.get("/api/catalogs/provider-price-list-currencies"),
        api.get("/api/catalogs/product-types"),
      ]);

      setProviders(providersRes.data || []);
      setCatalogs({
        countries: countriesRes.data || [],
        providerStatuses: providerStatusesRes.data || [],
        priceItemStatuses: priceItemStatusesRes.data || [],
        currencies: currenciesRes.data || [],
        productTypes: productTypesRes.data || [],
      });
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible cargar proveedores"));
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function initializeProviders() {
      try {
        const [
          providersRes,
          countriesRes,
          providerStatusesRes,
          priceItemStatusesRes,
          currenciesRes,
          productTypesRes,
        ] = await Promise.all([
          api.get("/api/providers"),
          api.get("/api/catalogs/provider-countries"),
          api.get("/api/catalogs/provider-activation-statuses"),
          api.get("/api/catalogs/provider-price-list-item-statuses"),
          api.get("/api/catalogs/provider-price-list-currencies"),
          api.get("/api/catalogs/product-types"),
        ]);

        if (cancelled) return;

        setProviders(providersRes.data || []);
        setCatalogs({
          countries: countriesRes.data || [],
          providerStatuses: providerStatusesRes.data || [],
          priceItemStatuses: priceItemStatusesRes.data || [],
          currencies: currenciesRes.data || [],
          productTypes: productTypesRes.data || [],
        });
      } catch (err) {
        if (!cancelled) {
          setError(
            getApiErrorMessage(err, "No fue posible cargar proveedores"),
          );
        }
      }
    }

    void initializeProviders();

    return () => {
      cancelled = true;
    };
  }, []);

  function openCreateProviderModal() {
    setError("");
    setSuccess("");
    setEditingProviderId(null);
    setEditProviderAudit(null);
    setForm(buildDefaultProviderForm());
    setShowProviderModal(true);
  }

  async function openEditProviderModal(providerId) {
    setError("");
    setSuccess("");
    try {
      const { data } = await api.get(`/api/providers/${providerId}`);
      setForm({
        name: data.name || "",
        registrationCode: data.registration_code || "",
        addressLine: data.address_line || "",
        countryId: String(data.country_id || ""),
        city: data.city || "",
        postalCode: data.postal_code || "",
        stateRegion: data.state_region || "",
        activationStatusId: String(data.activation_status_id || ""),
      });
      setEditProviderAudit({
        createdByName: data.created_by_name || "",
        createdAt: data.created_at || "",
        updatedByName: data.updated_by_name || "",
        updatedAt: data.updated_at || "",
      });
      setEditingProviderId(Number(providerId));
      setShowProviderModal(true);
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible cargar el proveedor"));
    }
  }

  function closeProviderModal() {
    if (savingProvider) return;
    setShowProviderModal(false);
    setEditingProviderId(null);
    setEditProviderAudit(null);
  }

  const isProviderActive = useCallback((provider) => {
    return (
      normalizeText(
        provider.activation_status_code || provider.activation_status,
      ) === "activado"
    );
  }, []);

  const isProviderInactive = useCallback((provider) => {
    return (
      normalizeText(
        provider.activation_status_code || provider.activation_status,
      ) === "desactivado"
    );
  }, []);

  const getProviderStatusLabel = useCallback(
    (provider) => {
      return isProviderActive(provider) ? "Activado" : "Desactivado";
    },
    [isProviderActive],
  );

  function getProviderStatusBadgeClass(provider) {
    return isProviderActive(provider)
      ? "user-status-badge active"
      : "user-status-badge inactive";
  }

  function toggleProviderMenu(providerId) {
    setOpenProviderMenuId((prev) => (prev === providerId ? null : providerId));
  }

  async function runProviderAction(action) {
    try {
      await action();
    } finally {
      setOpenProviderMenuId(null);
    }
  }

  async function updateProviderStatus(provider, statusCode) {
    setError("");
    setSuccess("");

    try {
      const { data } = await api.patch(`/api/providers/${provider.id}/status`, {
        statusCode,
      });
      setSuccess(data?.message || "Estado del proveedor actualizado");
      await load();
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible actualizar el estado del proveedor",
        ),
      );
    }
  }

  function openProviderStatusConfirmation(provider, statusCode) {
    setConfirmProviderStatusAction({ provider, statusCode });
    setOpenProviderMenuId(null);
  }

  function closeProviderStatusConfirmation() {
    setConfirmProviderStatusAction(null);
  }

  async function confirmSelectedProviderStatusChange() {
    if (!confirmProviderStatusAction) return;

    await updateProviderStatus(
      confirmProviderStatusAction.provider,
      confirmProviderStatusAction.statusCode,
    );
    setConfirmProviderStatusAction(null);
  }

  function getProviderStatusIconBadgeClassById(statusId) {
    const selectedStatus = catalogs.providerStatuses.find(
      (status) => String(status.id) === String(statusId),
    );
    return normalizeText(selectedStatus?.code || selectedStatus?.name) ===
      "activado"
      ? "status-icon-badge active"
      : "status-icon-badge inactive";
  }

  const filteredProviders = useMemo(
    () =>
      providers.filter((provider) => {
        if (providerStatusFilter === "all") return true;
        if (providerStatusFilter === "inactive") {
          return isProviderInactive(provider);
        }
        return isProviderActive(provider);
      }),
    [providers, providerStatusFilter, isProviderActive, isProviderInactive],
  );

  const providerStatusCounts = useMemo(
    () =>
      providers.reduce(
        (totals, provider) => {
          if (isProviderInactive(provider)) {
            totals.inactive += 1;
            return totals;
          }
          totals.active += 1;
          return totals;
        },
        { active: 0, inactive: 0 },
      ),
    [providers, isProviderInactive],
  );

  const totalProvidersCount =
    providerStatusCounts.active + providerStatusCounts.inactive;

  const sortedProviders = useMemo(() => {
    const list = [...filteredProviders];

    const readValue = (provider) => {
      if (providerSortField === "id") return Number(provider.id) || 0;
      if (providerSortField === "nombre") return String(provider.name || "");
      if (providerSortField === "pais") return String(provider.country || "");
      if (providerSortField === "lista_activa") {
        return String(provider.active_price_list_name || "");
      }
      if (providerSortField === "estado") {
        return getProviderStatusLabel(provider);
      }
      return "";
    };

    list.sort((left, right) => {
      const leftValue = readValue(left);
      const rightValue = readValue(right);

      let result = 0;
      if (typeof leftValue === "number" && typeof rightValue === "number") {
        result = leftValue - rightValue;
      } else {
        result = String(leftValue).localeCompare(String(rightValue), "es", {
          numeric: true,
          sensitivity: "base",
        });
      }

      return providerSortDirection === "asc" ? result : -result;
    });

    return list;
  }, [
    filteredProviders,
    providerSortField,
    providerSortDirection,
    getProviderStatusLabel,
  ]);

  const visibleProviders = useMemo(() => {
    const query = providerQuery.trim().toLowerCase();
    if (!query) return sortedProviders;

    return sortedProviders.filter((provider) => {
      const haystack = [
        provider.id,
        provider.name,
        provider.country,
        provider.active_price_list_name,
        getProviderStatusLabel(provider),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [sortedProviders, providerQuery, getProviderStatusLabel]);

  function setProviderStatusFilter(value) {
    setProvidersPage(1);
    setProviderStatusFilterState(value);
  }

  function setProviderQuery(value) {
    setProvidersPage(1);
    setProviderQueryState(value);
  }

  function setProvidersPerPage(value) {
    setProvidersPage(1);
    setProvidersPerPageState(value);
  }

  const totalProviderPages = Math.max(
    1,
    Math.ceil(visibleProviders.length / providersPerPage),
  );
  const pagedProviders = visibleProviders.slice(
    (providersPage - 1) * providersPerPage,
    providersPage * providersPerPage,
  );

  function toggleProviderSort(field) {
    if (providerSortField === field) {
      setProviderSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setProviderSortField(field);
    setProviderSortDirection("asc");
  }

  function getProviderSortArrow(field) {
    if (providerSortField !== field) return "↕";
    return providerSortDirection === "asc" ? "↑" : "↓";
  }

  function formatDateTime(value) {
    if (!value) return "No registrado";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "No registrado";
    return date.toLocaleString("es-ES");
  }

  function getProviderStatusConfirmationMeta() {
    const providerName = confirmProviderStatusAction?.provider?.name || "";

    if (confirmProviderStatusAction?.statusCode === "activado") {
      return {
        title: "Activar proveedor",
        message: `Seguro que deseas activar el proveedor "${providerName}"?`,
        confirmText: "Activar",
        isDangerous: false,
      };
    }

    return {
      title: "Desactivar proveedor",
      message: `Seguro que deseas desactivar el proveedor "${providerName}"?`,
      confirmText: "Desactivar",
      isDangerous: true,
    };
  }

  async function saveProvider(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setSavingProvider(true);

    try {
      const payload = {
        name: form.name,
        registrationCode: String(form.registrationCode || "").trim() || null,
        addressLine: form.addressLine || undefined,
        countryId: Number(form.countryId),
        city: form.city || undefined,
        postalCode: form.postalCode || undefined,
        stateRegion: form.stateRegion || undefined,
        activationStatusId: Number(form.activationStatusId),
      };

      const { data } = editingProviderId
        ? await api.put(`/api/providers/${editingProviderId}`, payload)
        : await api.post("/api/providers", payload);

      setSuccess(
        data?.message ||
          (editingProviderId
            ? "Proveedor actualizado correctamente"
            : "Proveedor creado correctamente"),
      );
      setShowProviderModal(false);
      setEditingProviderId(null);
      setEditProviderAudit(null);
      await load();
    } catch (err) {
      const fieldErrors = err?.response?.data?.errors?.fieldErrors;
      if (fieldErrors && typeof fieldErrors === "object") {
        const firstError = Object.entries(fieldErrors).find(
          ([, messages]) => Array.isArray(messages) && messages.length > 0,
        );
        if (firstError) {
          const [fieldName, messages] = firstError;
          setError(`${fieldName}: ${messages[0]}`);
          setSavingProvider(false);
          return;
        }
      }
      setError(getApiErrorMessage(err, "No fue posible guardar el proveedor"));
    } finally {
      setSavingProvider(false);
    }
  }

  function updateProviderFormField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  return {
    providers,
    providerStatusFilter,
    setProviderStatusFilter,
    providerQuery,
    setProviderQuery,
    providersPerPage,
    setProvidersPerPage,
    providersPage,
    setProvidersPage,
    showProviderModal,
    editingProviderId,
    editProviderAudit,
    openProviderMenuId,
    confirmProviderStatusAction,
    savingProvider,
    catalogs,
    error,
    success,
    canCreateProviders,
    canUpdateProviders,
    canReadProviderPrices,
    canCreateProviderPrices,
    canUpdateProviderPrices,
    form,
    providerStatusCounts,
    totalProvidersCount,
    visibleProviders,
    pagedProviders,
    totalProviderPages,
    openCreateProviderModal,
    openEditProviderModal,
    closeProviderModal,
    isProviderActive,
    isProviderInactive,
    getProviderStatusLabel,
    getProviderStatusBadgeClass,
    toggleProviderMenu,
    runProviderAction,
    openProviderStatusConfirmation,
    closeProviderStatusConfirmation,
    confirmSelectedProviderStatusChange,
    getProviderStatusIconBadgeClassById,
    toggleProviderSort,
    getProviderSortArrow,
    formatDateTime,
    formatPriceValue,
    getProviderStatusConfirmationMeta,
    saveProvider,
    updateProviderFormField,
    ...pricing,
  };
}
