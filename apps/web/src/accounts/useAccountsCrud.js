const CONTACT_SUGGESTED_FIELD_LABELS = {
  addressLine: "Direccion",
  city: "Ciudad",
  stateRegion: "Estado",
  postalCode: "Codigo postal",
  phone: "Telefono",
};

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, getApiErrorMessage } from "../api";
import { usePersistedStatusFilter } from "../appFilters";

const ACCOUNT_DRAFT_ANALYSIS_REQUEST_TIMEOUT_MS = 45000;
const ACCOUNT_DRAFT_ANALYSIS_POLL_INTERVAL_MS = 3000;
const ACCOUNT_DRAFT_ANALYSIS_TOTAL_POLL_TIMEOUT_MS = 120000;

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function useAccountsCrud({
  currentUser,
  searchParams,
  setSearchParams,
}) {
  const [accounts, setAccounts] = useState([]);
  const [users, setUsers] = useState([]);
  const [accountsPendingEnabled, setAccountsPendingEnabled] = useState(false);
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
  const [accountDuplicateReview, setAccountDuplicateReview] = useState(null);
  const [catalogs, setCatalogs] = useState({
    countries: [],
    accountTypes: [],
    sectors: [],
    statuses: [],
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const accountDraftAnalysisPollingTokenRef = useRef(0);

  useEffect(
    () => () => {
      accountDraftAnalysisPollingTokenRef.current += 1;
    },
    [],
  );

  const explicitAccountPermissions = useMemo(
    () => new Set(currentUser?.permissions || []),
    [currentUser],
  );
  const canDirectCreateAccounts =
    explicitAccountPermissions.has("cuentas.create");
  const canRequestAccounts = explicitAccountPermissions.has("cuentas.request");
  const canAssignAnyOwners = explicitAccountPermissions.has(
    "cuentas.assign_owners_any",
  );
  const canCreateOrRequestAccounts =
    canDirectCreateAccounts || (canRequestAccounts && accountsPendingEnabled);
  const canActivateAccounts = canDirectCreateAccounts;

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
    const defaultStatusCode = canDirectCreateAccounts
      ? "activada"
      : accountsPendingEnabled && canRequestAccounts
        ? "pendiente_activacion"
        : "activada";
    const defaultActivationStatusId = catalogs.statuses.find(
      (status) => normalizeText(status.code) === defaultStatusCode,
    )?.id;
    const defaultOwnerUserIds = currentUser?.id ? [Number(currentUser.id)] : [];

    return {
      name: "",
      registrationCode: "",
      phone: "",
      website: "",
      city: "",
      stateRegion: "",
      companyDescription: "",
      addressLine: "",
      postalCode: "",
      accountTypeId: defaultAccountTypeId,
      economicSectorId: "",
      countryId: defaultCountryId,
      activationStatusId: defaultActivationStatusId
        ? String(defaultActivationStatusId)
        : "",
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
        temporaryFeaturesRes,
      ] = await Promise.all([
        api.get("/api/accounts"),
        api.get("/api/catalogs/account-owner-users"),
        api.get("/api/catalogs/countries"),
        api.get("/api/catalogs/account-types"),
        api.get("/api/catalogs/economic-sectors"),
        api.get("/api/catalogs/account-activation-statuses"),
        api
          .get("/api/settings/temporary-features")
          .catch(() => ({ data: { settings: null } })),
      ]);
      setAccounts(accountsRes.data);
      setUsers((usersRes.data || []).map(normalizeOwnerOption));
      setCatalogs({
        countries: countriesRes.data,
        accountTypes: typesRes.data,
        sectors: sectorsRes.data,
        statuses: statusesRes.data,
      });
      setAccountsPendingEnabled(
        Boolean(temporaryFeaturesRes.data?.settings?.accountsPendingEnabled),
      );
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
    cancelAccountDraftAnalysisPolling();
    setAnalyzingAccountDraft(false);
    setError("");
    setSuccess("");
    setAccountDraftAnalysis(null);
    setAccountDraftAnalysisError("");
    setAccountDuplicateReview(null);
    setEditingAccountId(null);
    setEditAccountAudit(null);
    setUsers((prev) => prev.filter((user) => !isInactiveOwner(user)));
    setForm(buildDefaultAccountForm());
    setShowCreateAccountModal(true);
  }

  function closeAccountModal() {
    if (creatingAccount) return;
    cancelAccountDraftAnalysisPolling();
    setAnalyzingAccountDraft(false);
    setAccountDraftAnalysis(null);
    setAccountDraftAnalysisError("");
    setAccountDuplicateReview(null);
    setShowCreateAccountModal(false);
    setEditingAccountId(null);
    setEditAccountAudit(null);
  }

  function buildAccountDraftAnalysisPayload() {
    return {
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
        companyDescription: form.companyDescription,
        addressLine: form.addressLine,
        postalCode: form.postalCode,
        ownerUserIds: form.ownerUserIds.map(Number),
      },
      options: {
        allowExternalFetch: true,
        allowAiSynthesis: true,
        allowWebSearchTool: true,
      },
    };
  }

  function cancelAccountDraftAnalysisPolling() {
    accountDraftAnalysisPollingTokenRef.current += 1;
  }

  async function pollAccountDraftAnalysisJob({
    jobId,
    pollingToken,
    pollAfterMs,
  }) {
    const deadline = Date.now() + ACCOUNT_DRAFT_ANALYSIS_TOTAL_POLL_TIMEOUT_MS;
    let nextDelay = Math.max(
      Number(pollAfterMs || ACCOUNT_DRAFT_ANALYSIS_POLL_INTERVAL_MS),
      0,
    );

    while (accountDraftAnalysisPollingTokenRef.current === pollingToken) {
      if (Date.now() >= deadline) {
        return {
          job: { id: jobId, status: "timed_out" },
          error: {
            code: "poll_timeout",
            message:
              "El analisis del borrador sigue tardando mas de 2 minutos. Puedes reintentarlo sin cerrar el modal.",
          },
        };
      }

      if (nextDelay > 0) {
        await new Promise((resolve) => {
          window.setTimeout(resolve, nextDelay);
        });
      }

      if (accountDraftAnalysisPollingTokenRef.current !== pollingToken) {
        return null;
      }

      const { data } = await api.get(
        `/api/accounts/draft-analysis/jobs/${jobId}`,
        {
          timeout: ACCOUNT_DRAFT_ANALYSIS_REQUEST_TIMEOUT_MS,
        },
      );

      if (data?.result) {
        return data;
      }

      const jobStatus = String(data?.job?.status || "");
      if (["failed", "expired"].includes(jobStatus)) {
        return data;
      }

      nextDelay = Math.max(
        Number(
          data?.job?.pollAfterMs || ACCOUNT_DRAFT_ANALYSIS_POLL_INTERVAL_MS,
        ),
        0,
      );
      nextDelay = Math.min(nextDelay, Math.max(deadline - Date.now(), 0));
    }

    return null;
  }

  async function requestAccountDraftAnalysis({
    onResolved,
    onJobError,
    onTransportError,
    forceRegenerate = false,
  } = {}) {
    cancelAccountDraftAnalysisPolling();
    const pollingToken = accountDraftAnalysisPollingTokenRef.current;

    try {
      const { data } = await api.post(
        "/api/accounts/draft-analysis/jobs",
        {
          ...buildAccountDraftAnalysisPayload(),
          ...(forceRegenerate ? { forceRegenerate: true } : {}),
        },
        { timeout: ACCOUNT_DRAFT_ANALYSIS_REQUEST_TIMEOUT_MS },
      );

      let resolvedData = data;
      if (!resolvedData?.result) {
        const jobId = String(resolvedData?.job?.id || "").trim();
        if (!jobId) {
          throw new Error(
            "No fue posible obtener el identificador del job de analisis de cuenta",
          );
        }

        resolvedData = await pollAccountDraftAnalysisJob({
          jobId,
          pollingToken,
          pollAfterMs: resolvedData?.job?.pollAfterMs,
        });
      }

      if (accountDraftAnalysisPollingTokenRef.current !== pollingToken) {
        return null;
      }

      if (resolvedData?.result) {
        onResolved?.(resolvedData.result);
        return resolvedData.result;
      }

      onJobError?.(resolvedData?.error);
      return null;
    } catch (err) {
      if (accountDraftAnalysisPollingTokenRef.current !== pollingToken) {
        return null;
      }
      onTransportError?.(err);
      return null;
    }
  }

  async function runDuplicateAiReview() {
    setAccountDuplicateReview((current) =>
      current
        ? {
            ...current,
            aiReviewStatus: "loading",
            aiReviewError: "",
          }
        : current,
    );

    await requestAccountDraftAnalysis({
      onResolved: (data) => {
        setAccountDraftAnalysis(data);
        setAccountDuplicateReview((current) => {
          if (!current) return current;
          return {
            ...current,
            duplicateWarnings:
              Array.isArray(data?.duplicateWarnings) &&
              data.duplicateWarnings.length
                ? data.duplicateWarnings
                : current.duplicateWarnings,
            aiReview: data?.duplicateReview || null,
            aiReviewStatus: "ready",
            aiReviewError: "",
            aiReviewMeta: data?.meta || null,
          };
        });
      },
      onJobError: (jobError) => {
        setAccountDuplicateReview((current) =>
          current
            ? {
                ...current,
                aiReviewStatus: "error",
                aiReviewError:
                  String(jobError?.message || "").trim() ||
                  "No fue posible completar la revisión IA del posible duplicado",
              }
            : current,
        );
      },
      onTransportError: (err) => {
        setAccountDuplicateReview((current) =>
          current
            ? {
                ...current,
                aiReviewStatus: "error",
                aiReviewError: getApiErrorMessage(
                  err,
                  "No fue posible completar la revisión IA del posible duplicado",
                ),
              }
            : current,
        );
      },
    });
  }

  async function saveAccount(event, options = {}) {
    event.preventDefault();
    setError("");
    setSuccess("");
    const accountForm = options.formOverride || form;
    if (!accountForm.ownerUserIds.length) {
      setError("Selecciona al menos un usuario propietario");
      return;
    }
    setCreatingAccount(true);

    try {
      const wasEditing = Boolean(editingAccountId);
      const fallbackActivationStatusId =
        Number(accountForm.activationStatusId) ||
        Number(catalogs.statuses?.[0]?.id);
      const normalizedRegistrationCode = String(
        accountForm.registrationCode || "",
      ).trim();

      if (!Number.isFinite(fallbackActivationStatusId)) {
        throw new Error("No hay estado de activacion disponible");
      }

      const payload = {
        ...accountForm,
        registrationCode: normalizedRegistrationCode,
        accountTypeId: Number(accountForm.accountTypeId),
        economicSectorId: Number(accountForm.economicSectorId),
        countryId: Number(accountForm.countryId),
        activationStatusId: fallbackActivationStatusId,
        ownerUserIds: accountForm.ownerUserIds.map(Number),
        allowDuplicateOverride: options.allowDuplicateOverride === true,
      };

      const { data } = editingAccountId
        ? await api.put(`/api/accounts/${editingAccountId}`, payload)
        : await api.post("/api/accounts", payload);

      setForm(buildDefaultAccountForm());
      setAccountDraftAnalysis(null);
      setAccountDraftAnalysisError("");
      setAccountDuplicateReview(null);
      setEditingAccountId(null);
      setShowCreateAccountModal(false);
      await load();

      if (!wasEditing) {
        setAccountStatusFilterState("all");
        setAccountQueryState("");
        setAccountSortField("id");
        setAccountSortDirection("desc");
        setAccountsPage(1);
      }

      setSuccess(
        data?.message ||
          (wasEditing
            ? "Cuenta actualizada correctamente"
            : "Cuenta creada correctamente"),
      );
    } catch (err) {
      const duplicatePayload = err?.response?.data;
      if (
        !editingAccountId &&
        err?.response?.status === 409 &&
        [
          "ACCOUNT_DUPLICATE_REVIEW_REQUIRED",
          "ACCOUNT_DUPLICATE_CONFIRMATION_REQUIRED",
        ].includes(duplicatePayload?.code)
      ) {
        const reviewState = {
          code: duplicatePayload.code,
          message: duplicatePayload.message,
          duplicateDecision: duplicatePayload.duplicateDecision,
          duplicateWarnings: Array.isArray(duplicatePayload.duplicateWarnings)
            ? duplicatePayload.duplicateWarnings
            : [],
          aiReview: duplicatePayload.duplicateReview || null,
          aiReviewStatus: duplicatePayload.duplicateReview
            ? "ready"
            : duplicatePayload.duplicateDecision === "confirmation_required"
              ? "loading"
              : "idle",
          aiReviewError: "",
          aiReviewMeta: null,
        };
        setAccountDuplicateReview(reviewState);

        if (
          duplicatePayload.duplicateDecision === "confirmation_required" &&
          !duplicatePayload.duplicateReview
        ) {
          void runDuplicateAiReview(reviewState);
        }
        return;
      }

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
    if (!canAssignAnyOwners) {
      return;
    }

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
      return accountsPendingEnabled
        ? "user-status-badge pending"
        : "user-status-badge inactive";
    }
    return isAccountActive(account)
      ? "user-status-badge active"
      : "user-status-badge inactive";
  }

  const getAccountStatusLabel = useCallback(
    (account) => {
      const normalizedStatus = normalizeText(account?.activation_status);
      if (normalizedStatus === "pendiente de activacion") {
        return accountsPendingEnabled
          ? "Pendiente de activacion"
          : "Desactivada";
      }
      return normalizedStatus === "activada" ? "Activada" : "Desactivada";
    },
    [accountsPendingEnabled],
  );

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
        ? accountsPendingEnabled
          ? "status-icon-badge pending"
          : "status-icon-badge inactive"
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
    cancelAccountDraftAnalysisPolling();
    setError("");
    setSuccess("");
    setAccountDraftAnalysis(null);
    setAccountDraftAnalysisError("");
    setAccountDuplicateReview(null);
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
        companyDescription: data.companyDescription || data.description || "",
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
        if (accountStatusFilter === "pending") {
          return accountsPendingEnabled && isAccountPending(account);
        }
        if (accountStatusFilter === "inactive")
          return (
            isAccountInactive(account) ||
            (!accountsPendingEnabled && isAccountPending(account))
          );
        return isAccountActive(account);
      }),
    [accounts, accountStatusFilter, accountsPendingEnabled],
  );

  const sortedAccounts = useMemo(() => {
    const list = [...filteredAccounts];

    const readValue = (account) => {
      if (accountSortField === "id") return Number(account.id) || 0;
      if (accountSortField === "nombre") return String(account.name || "");
      if (accountSortField === "tipo")
        return String(account.account_type || "");
      if (accountSortField === "sector")
        return String(account.economic_sector || "");
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
        account.economic_sector,
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
            if (accountsPendingEnabled) {
              totals.pending += 1;
            } else {
              totals.inactive += 1;
            }
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
    [accounts, accountsPendingEnabled],
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
          temporaryFeaturesRes,
        ] = await Promise.all([
          api.get("/api/accounts"),
          api.get("/api/catalogs/account-owner-users"),
          api.get("/api/catalogs/countries"),
          api.get("/api/catalogs/account-types"),
          api.get("/api/catalogs/economic-sectors"),
          api.get("/api/catalogs/account-activation-statuses"),
          api
            .get("/api/settings/temporary-features")
            .catch(() => ({ data: { settings: null } })),
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
        setAccountsPendingEnabled(
          Boolean(temporaryFeaturesRes.data?.settings?.accountsPendingEnabled),
        );
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

  useEffect(() => {
    if (accountsPendingEnabled || accountStatusFilter !== "pending") {
      return;
    }
    setAccountStatusFilterState("all");
  }, [
    accountStatusFilter,
    accountsPendingEnabled,
    setAccountStatusFilterState,
  ]);

  function setAccountStatusFilter(value) {
    setAccountsPage(1);
    setAccountStatusFilterState(
      value === "pending" && !accountsPendingEnabled ? "all" : value,
    );
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
      await requestAccountDraftAnalysis({
        onResolved: (data) => {
          setAccountDraftAnalysis(data);
          setSuccess("Analisis de cuenta generado");
        },
        onJobError: (jobError) => {
          setAccountDraftAnalysis(null);
          setAccountDraftAnalysisError(
            String(jobError?.message || "").trim() ||
              "No fue posible analizar el borrador de la cuenta",
          );
        },
        onTransportError: (err) => {
          setAccountDraftAnalysis(null);
          setAccountDraftAnalysisError(
            getApiErrorMessage(
              err,
              "No fue posible analizar el borrador de la cuenta",
            ),
          );
        },
      });
    } finally {
      setAnalyzingAccountDraft(false);
    }
  }

  function dismissAccountDuplicateReview() {
    setAccountDuplicateReview(null);
  }

  async function confirmAccountDuplicateOverride() {
    return saveAccount(
      { preventDefault() {} },
      { allowDuplicateOverride: true },
    );
  }

  async function openDuplicateCandidateAccount(accountId) {
    setAccountDuplicateReview(null);
    await openEditAccountModal(accountId);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAccountDuplicateReview(null);
  }, [form.name, form.registrationCode, form.website, form.countryId]);

  useEffect(() => {
    if (!searchParams || typeof setSearchParams !== "function") {
      return;
    }

    const editId = searchParams.get("edit");
    if (!editId) return;

    let cancelled = false;

    async function syncEditParam() {
      setSearchParams({}, { replace: true });
      if (cancelled) return;
      await openEditAccountModal(Number(editId));
    }

    void syncEditParam();

    return () => {
      cancelled = true;
    };
  }, [searchParams, setSearchParams]);

  function useSuggestedCompanyDescription() {
    const nextDescription =
      accountDraftAnalysis?.suggestedCompanyDescription?.text;

    if (!nextDescription) return;

    setForm((prev) => ({
      ...prev,
      companyDescription: nextDescription,
    }));
    setSuccess("Descripcion sugerida aplicada al formulario");
  }

  function applySuggestedAccountField(field) {
    if (field === "economicSector") {
      const nextSectorId =
        accountDraftAnalysis?.suggestedEconomicSector?.sectorId;
      if (!nextSectorId) return;

      setForm((prev) => ({
        ...prev,
        economicSectorId: String(nextSectorId),
      }));
      setSuccess("Sector economico sugerido aplicado al formulario");
      return;
    }

    if (Object.hasOwn(CONTACT_SUGGESTED_FIELD_LABELS, field)) {
      const nextContactData = accountDraftAnalysis?.suggestedContactData;
      if (!nextContactData?.canAutoApply) return;

      const nextValue = String(nextContactData[field] || "").trim();
      if (!nextValue) return;

      setForm((prev) => ({
        ...prev,
        [field]: nextValue,
      }));

      setSuccess(
        `${CONTACT_SUGGESTED_FIELD_LABELS[field]} sugerido aplicado al formulario`,
      );
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
    accountDuplicateReview,
    catalogs,
    error,
    success,
    accountsPendingEnabled,
    canCreateOrRequestAccounts,
    canActivateAccounts,
    canAssignAnyOwners,
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
    runDuplicateAiReview,
    dismissAccountDuplicateReview,
    confirmAccountDuplicateOverride,
    openDuplicateCandidateAccount,
    useSuggestedCompanyDescription,
    applySuggestedAccountField,
  };
}
