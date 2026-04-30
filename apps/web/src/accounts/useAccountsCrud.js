import { useCallback, useEffect, useMemo, useState } from "react";
import { api, getApiErrorMessage } from "../api";
import { usePersistedStatusFilter } from "../appFilters";

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function useAccountsCrud({ currentUser }) {
  const [accounts, setAccounts] = useState([]);
  const [users, setUsers] = useState([]);
  const [accountStatusFilter, setAccountStatusFilterState] =
    usePersistedStatusFilter("crm.accounts.statusFilter");
  const [accountQuery, setAccountQueryState] = useState("");
  const [accountSortField, setAccountSortField] = useState("id");
  const [accountSortDirection, setAccountSortDirection] = useState("asc");
  const [accountsPerPage, setAccountsPerPageState] = useState(10);
  const [accountsPage, setAccountsPage] = useState(1);
  const [showCreateAccountModal, setShowCreateAccountModal] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState(null);
  const [editAccountAudit, setEditAccountAudit] = useState(null);
  const [openAccountMenuId, setOpenAccountMenuId] = useState(null);
  const [confirmAccountStatusAction, setConfirmAccountStatusAction] =
    useState(null);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [analyzingAccountDraft, setAnalyzingAccountDraft] = useState(false);
  const [accountDraftAnalysis, setAccountDraftAnalysis] = useState(null);
  const [accountDraftAnalysisError, setAccountDraftAnalysisError] =
    useState("");
  const [catalogs, setCatalogs] = useState({
    countries: [],
    accountTypes: [],
    sectors: [],
    statuses: [],
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const explicitAccountPermissions = useMemo(
    () => new Set(currentUser?.permissions || []),
    [currentUser],
  );
  const canCreateOrRequestAccounts =
    explicitAccountPermissions.has("cuentas.create") ||
    explicitAccountPermissions.has("cuentas.request");
  const canActivateAccounts = explicitAccountPermissions.has("cuentas.create");

  function findCatalogIdByName(options, expectedName) {
    const target = normalizeText(expectedName);
    const found = options.find(
      (option) => normalizeText(option.name) === target,
    );
    return found ? String(found.id) : "";
  }

  function buildDefaultAccountForm() {
    const defaultCountryId = findCatalogIdByName(catalogs.countries, "mexico");
    const defaultAccountTypeId = findCatalogIdByName(
      catalogs.accountTypes,
      "prospecto",
    );
    const defaultOwnerUserIds = currentUser?.id ? [Number(currentUser.id)] : [];

    return {
      name: "",
      registrationCode: "",
      phone: "",
      website: "",
      city: "",
      stateRegion: "",
      description: "",
      addressLine: "",
      postalCode: "",
      accountTypeId: defaultAccountTypeId,
      economicSectorId: "",
      countryId: defaultCountryId,
      activationStatusId: "",
      ownerUserIds: defaultOwnerUserIds,
    };
  }

  const [form, setForm] = useState(buildDefaultAccountForm);

  function normalizeOwnerOption(user) {
    return {
      ...user,
      status: user?.status || "active",
    };
  }

  function mergeOwnerOptions(baseUsers, extraUsers = []) {
    const merged = new Map();

    [...baseUsers, ...extraUsers].forEach((user) => {
      if (!user?.id) return;
      merged.set(Number(user.id), normalizeOwnerOption(user));
    });

    return Array.from(merged.values()).sort((left, right) =>
      String(left.full_name || "").localeCompare(
        String(right.full_name || ""),
        "es",
        {
          sensitivity: "base",
        },
      ),
    );
  }

  function isInactiveOwner(user) {
    return normalizeText(user?.status) === "inactive";
  }

  function getOwnerOptionLabel(user) {
    return isInactiveOwner(user)
      ? `${user.full_name} (inactivo)`
      : user.full_name;
  }

  async function load() {
    try {
      const [
        accountsRes,
        usersRes,
        countriesRes,
        typesRes,
        sectorsRes,
        statusesRes,
      ] = await Promise.all([
        api.get("/api/accounts"),
        api.get("/api/catalogs/account-owner-users"),
        api.get("/api/catalogs/countries"),
        api.get("/api/catalogs/account-types"),
        api.get("/api/catalogs/economic-sectors"),
        api.get("/api/catalogs/account-activation-statuses"),
      ]);
      setAccounts(accountsRes.data);
      setUsers((usersRes.data || []).map(normalizeOwnerOption));
      setCatalogs({
        countries: countriesRes.data,
        accountTypes: typesRes.data,
        sectors: sectorsRes.data,
        statuses: statusesRes.data,
      });
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible cargar cuentas"));
    }
  }

  function formatDateTime(value) {
    if (!value) return "No registrado";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "No registrado";
    return date.toLocaleString("es-ES");
  }

  function openCreateAccountModal() {
    setError("");
    setSuccess("");
    setAccountDraftAnalysis(null);
    setAccountDraftAnalysisError("");
    setEditingAccountId(null);
    setEditAccountAudit(null);
    setUsers((prev) => prev.filter((user) => !isInactiveOwner(user)));
    setForm(buildDefaultAccountForm());
    setShowCreateAccountModal(true);
  }

  function closeAccountModal() {
    if (creatingAccount) return;
    setAccountDraftAnalysis(null);
    setAccountDraftAnalysisError("");
    setShowCreateAccountModal(false);
    setEditingAccountId(null);
    setEditAccountAudit(null);
  }

  async function saveAccount(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (!form.ownerUserIds.length) {
      setError("Selecciona al menos un usuario propietario");
      return;
    }
    setCreatingAccount(true);
    try {
      const fallbackActivationStatusId =
        Number(form.activationStatusId) || Number(catalogs.statuses?.[0]?.id);
      const normalizedRegistrationCode = String(
        form.registrationCode || "",
      ).trim();

      if (!Number.isFinite(fallbackActivationStatusId)) {
        throw new Error("No hay estado de activacion disponible");
      }

      const payload = {
        ...form,
        registrationCode: normalizedRegistrationCode,
        accountTypeId: Number(form.accountTypeId),
        economicSectorId: Number(form.economicSectorId),
        countryId: Number(form.countryId),
        activationStatusId: fallbackActivationStatusId,
        ownerUserIds: form.ownerUserIds.map(Number),
      };

      const { data } = editingAccountId
        ? await api.put(`/api/accounts/${editingAccountId}`, payload)
        : await api.post("/api/accounts", payload);

      setForm(buildDefaultAccountForm());
      setAccountDraftAnalysis(null);
      setAccountDraftAnalysisError("");
      setEditingAccountId(null);
      setShowCreateAccountModal(false);
      await load();
      setSuccess(
        data?.message ||
          (editingAccountId
            ? "Cuenta actualizada correctamente"
            : "Cuenta creada correctamente"),
      );
    } catch (err) {
      const fieldErrors = err?.response?.data?.errors?.fieldErrors;
      if (fieldErrors && typeof fieldErrors === "object") {
        const firstError = Object.entries(fieldErrors).find(
          ([, messages]) => Array.isArray(messages) && messages.length > 0,
        );
        if (firstError) {
          const [fieldName, messages] = firstError;
          setError(`${fieldName}: ${messages[0]}`);
          return;
        }
      }
      setError(
        getApiErrorMessage(err, err?.message || "No fue posible crear cuenta"),
      );
    } finally {
      setCreatingAccount(false);
    }
  }

  function toggleOwnerUser(userId) {
    setForm((prev) => {
      const numericId = Number(userId);
      const selected = prev.ownerUserIds.includes(numericId);
      return {
        ...prev,
        ownerUserIds: selected
          ? prev.ownerUserIds.filter((id) => id !== numericId)
          : [...prev.ownerUserIds, numericId],
      };
    });
  }

  function toggleAccountMenu(accountId) {
    setOpenAccountMenuId((prev) => (prev === accountId ? null : accountId));
  }

  async function runAccountAction(action) {
    try {
      await action();
    } finally {
      setOpenAccountMenuId(null);
    }
  }

  function isAccountActive(account) {
    return normalizeText(account.activation_status) === "activada";
  }

  function isAccountPending(account) {
    return (
      normalizeText(account.activation_status) === "pendiente de activacion"
    );
  }

  function isAccountInactive(account) {
    return normalizeText(account.activation_status) === "desactivada";
  }

  function getAccountStatusBadgeClass(account) {
    if (isAccountPending(account)) {
      return "user-status-badge pending";
    }
    return isAccountActive(account)
      ? "user-status-badge active"
      : "user-status-badge inactive";
  }

  const getAccountStatusLabel = useCallback((account) => {
    const normalizedStatus = normalizeText(account?.activation_status);
    if (normalizedStatus === "pendiente de activacion") {
      return "Pendiente de activacion";
    }
    return normalizedStatus === "activada" ? "Activada" : "Desactivada";
  }, []);

  function getEditingActivationMeta() {
    const selectedStatus = catalogs.statuses.find(
      (status) => String(status.id) === String(form.activationStatusId),
    );
    const statusCode = normalizeText(selectedStatus?.code || "");
    const statusName = normalizeText(selectedStatus?.name || "");
    const isActive = statusCode === "activada" || statusName === "activada";
    const isPending =
      statusCode === "pendiente_activacion" ||
      statusName === "pendiente de activacion";

    return {
      label: selectedStatus?.name || "No definido",
      badgeClass: isPending
        ? "status-icon-badge pending"
        : isActive
          ? "status-icon-badge active"
          : "status-icon-badge inactive",
    };
  }

  async function updateAccountStatus(account, statusCode) {
    setError("");
    setSuccess("");
    try {
      const { data } = await api.patch(`/api/accounts/${account.id}/status`, {
        statusCode,
      });
      setSuccess(data?.message || "Estado de cuenta actualizado");
      await load();
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible actualizar el estado de la cuenta",
        ),
      );
    }
  }

  function openAccountStatusConfirmation(account, statusCode) {
    setConfirmAccountStatusAction({ account, statusCode });
    setOpenAccountMenuId(null);
  }

  function closeAccountStatusConfirmation() {
    setConfirmAccountStatusAction(null);
  }

  async function confirmSelectedAccountStatusChange() {
    if (!confirmAccountStatusAction) return;

    await updateAccountStatus(
      confirmAccountStatusAction.account,
      confirmAccountStatusAction.statusCode,
    );
    setConfirmAccountStatusAction(null);
  }

  function getAccountStatusConfirmationMeta() {
    const accountName = confirmAccountStatusAction?.account?.name || "";

    if (confirmAccountStatusAction?.statusCode === "activada") {
      return {
        title: "Activar cuenta",
        message: `Seguro que deseas activar la cuenta "${accountName}"?`,
        confirmText: "Activar",
        isDangerous: false,
      };
    }

    if (confirmAccountStatusAction?.statusCode === "pendiente_activacion") {
      return {
        title: "Marcar cuenta como pendiente",
        message: `Seguro que deseas marcar como pendiente la cuenta "${accountName}"?`,
        confirmText: "Marcar pendiente",
        isDangerous: false,
      };
    }

    return {
      title: "Desactivar cuenta",
      message: `Seguro que deseas desactivar la cuenta "${accountName}"?`,
      confirmText: "Desactivar",
      isDangerous: true,
    };
  }

  async function openEditAccountModal(accountId) {
    setError("");
    setSuccess("");
    setAccountDraftAnalysis(null);
    setAccountDraftAnalysisError("");
    try {
      const { data } = await api.get(`/api/accounts/${accountId}`);
      setUsers((prev) => mergeOwnerOptions(prev, data.owners || []));
      setForm({
        name: data.name || "",
        registrationCode: data.registration_code || "",
        phone: data.phone || "",
        website: data.website || "",
        city: data.city || "",
        stateRegion: data.state_region || "",
        description: data.description || "",
        addressLine: data.address_line || "",
        postalCode: data.postal_code || "",
        accountTypeId: String(data.account_type_id || ""),
        economicSectorId: String(data.economic_sector_id || ""),
        countryId: String(data.country_id || ""),
        activationStatusId: String(data.activation_status_id || ""),
        ownerUserIds: Array.isArray(data.owners)
          ? data.owners.map((owner) => Number(owner.id))
          : [],
      });
      setEditAccountAudit({
        createdByName: data.created_by_name || null,
        createdAt: data.created_at || null,
        updatedByName: data.updated_by_name || null,
        updatedAt: data.updated_at || null,
      });
      setEditingAccountId(Number(accountId));
      setShowCreateAccountModal(true);
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible cargar la cuenta"));
    }
  }

  const filteredAccounts = useMemo(
    () =>
      accounts.filter((account) => {
        if (accountStatusFilter === "all") return true;
        if (accountStatusFilter === "pending") return isAccountPending(account);
        if (accountStatusFilter === "inactive")
          return isAccountInactive(account);
        return isAccountActive(account);
      }),
    [accounts, accountStatusFilter],
  );

  const sortedAccounts = useMemo(() => {
    const list = [...filteredAccounts];

    const readValue = (account) => {
      if (accountSortField === "id") return Number(account.id) || 0;
      if (accountSortField === "nombre") return String(account.name || "");
      if (accountSortField === "tipo")
        return String(account.account_type || "");
      if (accountSortField === "pais") return String(account.country || "");
      if (accountSortField === "registro") {
        return String(account.registration_code || "");
      }
      if (accountSortField === "propietarios") {
        return String(account.owners_display || "");
      }
      if (accountSortField === "estado") {
        return String(getAccountStatusLabel(account) || "");
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

      return accountSortDirection === "asc" ? result : -result;
    });

    return list;
  }, [
    filteredAccounts,
    accountSortField,
    accountSortDirection,
    getAccountStatusLabel,
  ]);

  const visibleAccounts = useMemo(() => {
    const query = accountQuery.trim().toLowerCase();
    if (!query) return sortedAccounts;

    return sortedAccounts.filter((account) => {
      const haystack = [
        account.id,
        account.name,
        account.account_type,
        account.owners_display,
        account.country,
        account.registration_code,
        getAccountStatusLabel(account),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [sortedAccounts, accountQuery, getAccountStatusLabel]);

  const totalAccountPages = Math.max(
    1,
    Math.ceil(visibleAccounts.length / accountsPerPage),
  );
  const pagedAccounts = visibleAccounts.slice(
    (accountsPage - 1) * accountsPerPage,
    accountsPage * accountsPerPage,
  );

  const accountStatusCounts = useMemo(
    () =>
      accounts.reduce(
        (totals, account) => {
          if (isAccountPending(account)) {
            totals.pending += 1;
            return totals;
          }
          if (isAccountInactive(account)) {
            totals.inactive += 1;
            return totals;
          }
          totals.active += 1;
          return totals;
        },
        { active: 0, pending: 0, inactive: 0 },
      ),
    [accounts],
  );

  const totalAccountsCount =
    accountStatusCounts.active +
    accountStatusCounts.pending +
    accountStatusCounts.inactive;

  useEffect(() => {
    if (!error && !success) return;
    const timeoutId = window.setTimeout(() => {
      setError("");
      setSuccess("");
    }, 4000);
    return () => window.clearTimeout(timeoutId);
  }, [error, success]);

  useEffect(() => {
    if (openAccountMenuId === null) return undefined;

    function handlePointerDown(event) {
      if (event.target.closest(".accounts-kebab-wrap")) return;
      setOpenAccountMenuId(null);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [openAccountMenuId]);

  useEffect(() => {
    let cancelled = false;

    async function initializeAccounts() {
      try {
        const [
          accountsRes,
          usersRes,
          countriesRes,
          typesRes,
          sectorsRes,
          statusesRes,
        ] = await Promise.all([
          api.get("/api/accounts"),
          api.get("/api/catalogs/account-owner-users"),
          api.get("/api/catalogs/countries"),
          api.get("/api/catalogs/account-types"),
          api.get("/api/catalogs/economic-sectors"),
          api.get("/api/catalogs/account-activation-statuses"),
        ]);

        if (cancelled) return;

        setAccounts(accountsRes.data);
        setUsers((usersRes.data || []).map(normalizeOwnerOption));
        setCatalogs({
          countries: countriesRes.data,
          accountTypes: typesRes.data,
          sectors: sectorsRes.data,
          statuses: statusesRes.data,
        });
      } catch (err) {
        if (!cancelled) {
          setError(getApiErrorMessage(err, "No fue posible cargar cuentas"));
        }
      }
    }

    void initializeAccounts();

    return () => {
      cancelled = true;
    };
  }, []);

  function setAccountStatusFilter(value) {
    setAccountsPage(1);
    setAccountStatusFilterState(value);
  }

  function setAccountQuery(value) {
    setAccountsPage(1);
    setAccountQueryState(value);
  }

  function setAccountsPerPage(value) {
    setAccountsPage(1);
    setAccountsPerPageState(value);
  }

  function toggleAccountSort(field) {
    if (accountSortField === field) {
      setAccountSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setAccountSortField(field);
    setAccountSortDirection("asc");
  }

  function getAccountSortArrow(field) {
    if (accountSortField !== field) return "↕";
    return accountSortDirection === "asc" ? "↑" : "↓";
  }

  async function analyzeAccountDraft() {
    if (editingAccountId) return;

    setAccountDraftAnalysisError("");
    setAnalyzingAccountDraft(true);

    try {
      const payload = {
        draft: {
          name: form.name,
          accountTypeId: form.accountTypeId ? Number(form.accountTypeId) : null,
          registrationCode: form.registrationCode,
          phone: form.phone,
          economicSectorId: form.economicSectorId
            ? Number(form.economicSectorId)
            : null,
          website: form.website,
          city: form.city,
          stateRegion: form.stateRegion,
          countryId: form.countryId ? Number(form.countryId) : null,
          description: form.description,
          addressLine: form.addressLine,
          postalCode: form.postalCode,
          ownerUserIds: form.ownerUserIds.map(Number),
        },
        options: {
          allowExternalEnrichment: true,
        },
      };

      const { data } = await api.post("/api/accounts/draft-analysis", payload);
      setAccountDraftAnalysis(data);
      setSuccess("Analisis de cuenta generado");
    } catch (err) {
      setAccountDraftAnalysis(null);
      setAccountDraftAnalysisError(
        getApiErrorMessage(err, "No fue posible analizar el borrador de cuenta"),
      );
    } finally {
      setAnalyzingAccountDraft(false);
    }
  }

  function useSuggestedAccountDescription(kind) {
    const nextDescription =
      kind === "commercial"
        ? accountDraftAnalysis?.suggestedCommercialDescription?.text
        : accountDraftAnalysis?.suggestedAdministrativeDescription?.text;

    if (!nextDescription) return;

    setForm((prev) => ({
      ...prev,
      description: nextDescription,
    }));
    setSuccess("Descripcion sugerida aplicada al formulario");
  }

  function useSuggestedAccountField(field) {
    if (field === "economicSector") {
      const nextSectorId = accountDraftAnalysis?.suggestedEconomicSector?.sectorId;
      if (!nextSectorId) return;

      setForm((prev) => ({
        ...prev,
        economicSectorId: String(nextSectorId),
      }));
      setSuccess("Sector economico sugerido aplicado al formulario");
      return;
    }

    if (field === "contactData") {
      const nextContactData = accountDraftAnalysis?.suggestedContactData;
      if (!nextContactData?.canAutoApply) return;

      setForm((prev) => ({
        ...prev,
        addressLine: nextContactData.addressLine || prev.addressLine,
        city: nextContactData.city || prev.city,
        stateRegion: nextContactData.stateRegion || prev.stateRegion,
        postalCode: nextContactData.postalCode || prev.postalCode,
        phone: nextContactData.phone || prev.phone,
      }));

      setSuccess("Direccion y telefono sugeridos aplicados al formulario");
      return;
    }

    const fieldValue =
      field === "website"
        ? accountDraftAnalysis?.suggestedWebsite?.value
        : accountDraftAnalysis?.registrationAssistance?.value;

    if (!fieldValue) return;

    setForm((prev) => ({
      ...prev,
      [field === "website" ? "website" : "registrationCode"]: fieldValue,
    }));

    setSuccess(
      field === "website"
        ? "Sitio web sugerido aplicado al formulario"
        : "Registro sugerido aplicado al formulario; validalo antes de guardar",
    );
  }

  return {
    users,
    accountStatusFilter,
    setAccountStatusFilter,
    accountQuery,
    setAccountQuery,
    accountsPerPage,
    setAccountsPerPage,
    accountsPage,
    setAccountsPage,
    showCreateAccountModal,
    editingAccountId,
    editAccountAudit,
    openAccountMenuId,
    confirmAccountStatusAction,
    creatingAccount,
    analyzingAccountDraft,
    accountDraftAnalysis,
    accountDraftAnalysisError,
    catalogs,
    error,
    success,
    canCreateOrRequestAccounts,
    canActivateAccounts,
    form,
    setForm,
    visibleAccounts,
    pagedAccounts,
    totalAccountPages,
    accountStatusCounts,
    totalAccountsCount,
    isInactiveOwner,
    getOwnerOptionLabel,
    formatDateTime,
    saveAccount,
    toggleOwnerUser,
    toggleAccountMenu,
    runAccountAction,
    isAccountActive,
    isAccountPending,
    isAccountInactive,
    getAccountStatusBadgeClass,
    getAccountStatusLabel,
    getEditingActivationMeta,
    openAccountStatusConfirmation,
    closeAccountStatusConfirmation,
    confirmSelectedAccountStatusChange,
    getAccountStatusConfirmationMeta,
    openEditAccountModal,
    openCreateAccountModal,
    closeAccountModal,
    toggleAccountSort,
    getAccountSortArrow,
    analyzeAccountDraft,
    useSuggestedAccountDescription,
    useSuggestedAccountField,
  };
}
