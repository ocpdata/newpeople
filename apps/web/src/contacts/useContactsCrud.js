import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, getApiErrorMessage } from "../api";
import { usePersistedStatusFilter } from "../appFilters";

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

const CONTACT_PRESENTATION_FIELDS = new Set([
  "firstName",
  "lastName",
  "positionTitle",
  "department",
]);

const CONTACT_TEXT_CONNECTORS = new Set([
  "de",
  "del",
  "la",
  "las",
  "los",
  "el",
  "y",
  "e",
  "da",
  "das",
  "do",
  "dos",
  "van",
  "von",
]);

const CONTACT_TEXT_ACRONYMS = new Set([
  "b2b",
  "b2c",
  "bi",
  "ceo",
  "cfo",
  "coo",
  "crm",
  "cto",
  "erp",
  "hr",
  "it",
  "qa",
  "rrhh",
  "sap",
  "ti",
  "ui",
  "ux",
  "vp",
]);

function collapseContactWhitespace(value) {
  return String(value || "")
    .replace(/^\s+/g, "")
    .replace(/\s{2,}/g, " ");
}

function capitalizeContactWord(value) {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function normalizePresentationKey(value) {
  return normalizeText(value).replace(/[^a-z0-9]/g, "");
}

function normalizeContactSegment(segment) {
  const segmentKey = normalizePresentationKey(segment);
  if (CONTACT_TEXT_ACRONYMS.has(segmentKey)) {
    return segment.toUpperCase();
  }

  return segment.replace(/[A-Za-zÀ-ÿ]+/g, (word) =>
    capitalizeContactWord(word),
  );
}

function normalizeContactToken(token, index) {
  const trimmedToken = String(token || "").trim();
  if (!trimmedToken) return "";

  const tokenKey = normalizePresentationKey(trimmedToken);
  if (CONTACT_TEXT_CONNECTORS.has(tokenKey)) {
    return index === 0 ? capitalizeContactWord(trimmedToken) : tokenKey;
  }

  return trimmedToken
    .split(/([-/'’])/)
    .map((segment) => {
      if (/^[-/'’]$/.test(segment)) {
        return segment;
      }
      return normalizeContactSegment(segment);
    })
    .join("");
}

function normalizeContactPresentationValue(value) {
  const sanitizedValue = collapseContactWhitespace(value).trim();
  if (!sanitizedValue) return "";

  return sanitizedValue
    .split(" ")
    .filter(Boolean)
    .map((token, index) => normalizeContactToken(token, index))
    .join(" ");
}

function normalizeContactPresentationField(field, value) {
  if (!CONTACT_PRESENTATION_FIELDS.has(field)) {
    return value;
  }

  return normalizeContactPresentationValue(value);
}

function normalizeContactPresentationForm(sourceForm) {
  return Object.entries(sourceForm).reduce((result, [field, value]) => {
    result[field] = normalizeContactPresentationField(field, value);
    return result;
  }, {});
}

export function useContactsCrud({
  currentUser,
  searchParams,
  setSearchParams,
}) {
  const [contacts, setContacts] = useState([]);
  const [contactsPendingEnabled, setContactsPendingEnabled] = useState(false);
  const [contactStatusFilter, setContactStatusFilterState] =
    usePersistedStatusFilter("crm.contacts.statusFilter");
  const [contactQuery, setContactQueryState] = useState("");
  const [contactSortField, setContactSortField] = useState("id");
  const [contactSortDirection, setContactSortDirection] = useState("asc");
  const [contactsPerPage, setContactsPerPageState] = useState(10);
  const [contactsPage, setContactsPage] = useState(1);
  const [showContactModal, setShowContactModal] = useState(false);
  const [editingContactId, setEditingContactId] = useState(null);
  const [editContactAudit, setEditContactAudit] = useState(null);
  const [contactDuplicateReview, setContactDuplicateReview] = useState(null);
  const [openContactMenuId, setOpenContactMenuId] = useState(null);
  const [confirmContactStatusAction, setConfirmContactStatusAction] =
    useState(null);
  const [savingContact, setSavingContact] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [catalogs, setCatalogs] = useState({
    accounts: [],
    countries: [],
    purchaseParticipations: [],
    hierarchyLevels: [],
    relationshipTypes: [],
    influenceLevels: [],
    employmentStatuses: [],
    activationStatuses: [],
  });
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    accountId: "",
    positionTitle: "",
    phone: "",
    phoneExtension: "",
    mobile: "",
    email: "",
    department: "",
    countryId: "",
    stateRegion: "",
    city: "",
    addressLine: "",
    postalCode: "",
    purchaseParticipationId: "",
    hierarchyLevelId: "",
    relationshipTypeId: "",
    influenceLevelId: "",
    employmentStatusId: "",
    activationStatusId: "",
    managerContactId: "",
    influencesContactId: "",
  });
  const openEditContactModalRef = useRef(null);

  const explicitContactPermissions = useMemo(
    () => new Set(currentUser?.permissions || []),
    [currentUser],
  );
  const canDirectCreateContacts =
    explicitContactPermissions.has("contactos.create");
  const canRequestContacts =
    explicitContactPermissions.has("contactos.request");
  const canCreateOrRequestContacts =
    canDirectCreateContacts || (canRequestContacts && contactsPendingEnabled);
  const canChangeContactActivationStatus = canDirectCreateContacts;

  function findCatalogIdByCode(options, expectedCode) {
    const target = normalizeText(expectedCode);
    const found = options.find(
      (option) => normalizeText(option.code) === target,
    );
    return found ? String(found.id) : "";
  }

  function getAccountLocationFields(accountId) {
    const selectedAccount = catalogs.accounts.find(
      (account) => String(account.id) === String(accountId || ""),
    );

    return {
      countryId: selectedAccount?.country_id
        ? String(selectedAccount.country_id)
        : "",
      stateRegion: selectedAccount?.state_region || "",
      city: selectedAccount?.city || "",
      addressLine: selectedAccount?.address_line || "",
      postalCode: selectedAccount?.postal_code || "",
    };
  }

  function buildDefaultContactForm() {
    return {
      firstName: "",
      lastName: "",
      accountId: "",
      positionTitle: "",
      phone: "",
      phoneExtension: "",
      mobile: "",
      email: "",
      department: "",
      countryId: "",
      stateRegion: "",
      city: "",
      addressLine: "",
      postalCode: "",
      purchaseParticipationId: findCatalogIdByCode(
        catalogs.purchaseParticipations,
        "ninguno",
      ),
      hierarchyLevelId: findCatalogIdByCode(
        catalogs.hierarchyLevels,
        "usuario",
      ),
      relationshipTypeId: findCatalogIdByCode(
        catalogs.relationshipTypes,
        "media",
      ),
      influenceLevelId: findCatalogIdByCode(catalogs.influenceLevels, "media"),
      employmentStatusId: String(catalogs.employmentStatuses?.[0]?.id || ""),
      activationStatusId: findCatalogIdByCode(
        catalogs.activationStatuses,
        canDirectCreateContacts
          ? "activado"
          : contactsPendingEnabled && canRequestContacts
            ? "pendiente_activacion"
            : "activado",
      ),
      managerContactId: "",
      influencesContactId: "",
    };
  }

  async function load() {
    try {
      const [
        contactsRes,
        accountsRes,
        countriesRes,
        purchaseRes,
        hierarchyRes,
        relationshipRes,
        influenceRes,
        employmentRes,
        activationRes,
        temporaryFeaturesRes,
      ] = await Promise.all([
        api.get("/api/contacts"),
        api.get("/api/catalogs/contact-accounts"),
        api.get("/api/catalogs/contact-countries"),
        api.get("/api/catalogs/contact-purchase-participations"),
        api.get("/api/catalogs/contact-hierarchy-levels"),
        api.get("/api/catalogs/contact-relationship-types"),
        api.get("/api/catalogs/contact-influence-levels"),
        api.get("/api/catalogs/contact-employment-statuses"),
        api.get("/api/catalogs/contact-activation-statuses"),
        api
          .get("/api/settings/temporary-features")
          .catch(() => ({ data: { settings: null } })),
      ]);

      setContacts(contactsRes.data || []);
      setCatalogs({
        accounts: accountsRes.data || [],
        countries: countriesRes.data || [],
        purchaseParticipations: purchaseRes.data || [],
        hierarchyLevels: hierarchyRes.data || [],
        relationshipTypes: relationshipRes.data || [],
        influenceLevels: influenceRes.data || [],
        employmentStatuses: employmentRes.data || [],
        activationStatuses: activationRes.data || [],
      });
      setContactsPendingEnabled(
        Boolean(temporaryFeaturesRes.data?.settings?.contactsPendingEnabled),
      );
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible cargar contactos"));
    }
  }

  function isContactActive(contact) {
    return normalizeText(contact.activation_status) === "activado";
  }

  function isContactPending(contact) {
    return (
      normalizeText(contact.activation_status) === "pendiente de activacion"
    );
  }

  function isContactInactive(contact) {
    return normalizeText(contact.activation_status) === "desactivado";
  }

  const getContactStatusLabel = useCallback(
    (contact) => {
      const normalizedStatus = normalizeText(contact?.activation_status);
      if (normalizedStatus === "pendiente de activacion") {
        return contactsPendingEnabled
          ? "Pendiente de activacion"
          : "Desactivado";
      }
      return normalizedStatus === "activado" ? "Activado" : "Desactivado";
    },
    [contactsPendingEnabled],
  );

  function getContactStatusBadgeClass(contact) {
    if (isContactPending(contact)) {
      return contactsPendingEnabled
        ? "user-status-badge pending"
        : "user-status-badge inactive";
    }
    return isContactActive(contact)
      ? "user-status-badge active"
      : "user-status-badge inactive";
  }

  function getContactStatusIconBadgeClass(contact) {
    if (isContactPending(contact)) {
      return contactsPendingEnabled
        ? "status-icon-badge pending"
        : "status-icon-badge inactive";
    }
    return isContactActive(contact)
      ? "status-icon-badge active"
      : "status-icon-badge inactive";
  }

  function formatDateTime(value) {
    if (!value) return "No registrado";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "No registrado";
    return date.toLocaleString("es-ES");
  }

  function updateContactFormField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function normalizeContactFormField(field, value) {
    const normalizedValue = normalizeContactPresentationField(field, value);
    setForm((prev) => {
      if (prev[field] === normalizedValue) {
        return prev;
      }

      return { ...prev, [field]: normalizedValue };
    });
  }

  function handleContactAccountChange(accountId) {
    const nextAccountId = String(accountId || "");
    setForm((prev) => ({
      ...prev,
      accountId: nextAccountId,
      managerContactId: "",
      ...(editingContactId ? null : getAccountLocationFields(accountId)),
    }));
  }

  function openCreateContactModal() {
    setError("");
    setSuccess("");
    setContactDuplicateReview(null);
    setEditingContactId(null);
    setEditContactAudit(null);
    setForm(buildDefaultContactForm());
    setShowContactModal(true);
  }

  const openEditContactModal = useCallback(async (contactId) => {
    setError("");
    setSuccess("");
    setContactDuplicateReview(null);
    try {
      const { data } = await api.get(`/api/contacts/${contactId}`);
      setForm({
        firstName: data.first_name || "",
        lastName: data.last_name || "",
        accountId: String(data.account_id || ""),
        positionTitle: data.position_title || "",
        phone: data.phone || "",
        phoneExtension: data.phone_extension || "",
        mobile: data.mobile || "",
        email: data.email || "",
        department: data.department || "",
        countryId: data.country_id ? String(data.country_id) : "",
        stateRegion: data.state_region || "",
        city: data.city || "",
        addressLine: data.address_line || "",
        postalCode: data.postal_code || "",
        purchaseParticipationId: String(data.purchase_participation_id || ""),
        hierarchyLevelId: String(data.hierarchy_level_id || ""),
        relationshipTypeId: String(data.relationship_type_id || ""),
        influenceLevelId: String(data.influence_level_id || ""),
        employmentStatusId: String(data.employment_status_id || ""),
        activationStatusId: String(data.activation_status_id || ""),
        managerContactId: data.manager_contact_id
          ? String(data.manager_contact_id)
          : "",
        influencesContactId: data.influences_contact_id
          ? String(data.influences_contact_id)
          : "",
      });
      setEditContactAudit({
        createdByName: data.created_by_name || "",
        createdAt: data.created_at || "",
        updatedByName: data.updated_by_name || "",
        updatedAt: data.updated_at || "",
      });
      setEditingContactId(Number(contactId));
      setShowContactModal(true);
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible cargar el contacto"));
    }
  }, []);

  function closeContactModal() {
    if (savingContact) return;
    setShowContactModal(false);
    setEditingContactId(null);
    setEditContactAudit(null);
    setContactDuplicateReview(null);
  }

  function toggleContactMenu(contactId) {
    setOpenContactMenuId((prev) => (prev === contactId ? null : contactId));
  }

  async function runContactAction(action) {
    try {
      await action();
    } finally {
      setOpenContactMenuId(null);
    }
  }

  async function updateContactStatus(contact, statusCode) {
    setError("");
    setSuccess("");
    try {
      const { data } = await api.patch(`/api/contacts/${contact.id}/status`, {
        statusCode,
      });
      setSuccess(data?.message || "Estado de contacto actualizado");
      await load();
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible actualizar el estado del contacto",
        ),
      );
    }
  }

  function openContactStatusConfirmation(contact, statusCode) {
    setConfirmContactStatusAction({ contact, statusCode });
    setOpenContactMenuId(null);
  }

  function closeContactStatusConfirmation() {
    setConfirmContactStatusAction(null);
  }

  async function confirmSelectedContactStatusChange() {
    if (!confirmContactStatusAction) return;

    await updateContactStatus(
      confirmContactStatusAction.contact,
      confirmContactStatusAction.statusCode,
    );
    setConfirmContactStatusAction(null);
  }

  function getContactStatusConfirmationMeta() {
    const contactName = confirmContactStatusAction?.contact?.full_name || "";

    if (confirmContactStatusAction?.statusCode === "activado") {
      return {
        title: "Activar contacto",
        message: `Seguro que deseas activar al contacto "${contactName}"?`,
        confirmText: "Activar",
        isDangerous: false,
      };
    }

    if (confirmContactStatusAction?.statusCode === "pendiente_activacion") {
      return {
        title: "Marcar contacto como pendiente",
        message: `Seguro que deseas marcar como pendiente al contacto "${contactName}"?`,
        confirmText: "Marcar pendiente",
        isDangerous: false,
      };
    }

    return {
      title: "Desactivar contacto",
      message: `Seguro que deseas desactivar al contacto "${contactName}"?`,
      confirmText: "Desactivar",
      isDangerous: true,
    };
  }

  function buildContactPayload(sourceForm = form) {
    return {
      firstName: sourceForm.firstName,
      lastName: sourceForm.lastName,
      accountId: Number(sourceForm.accountId),
      positionTitle: sourceForm.positionTitle || undefined,
      phone: sourceForm.phone || undefined,
      phoneExtension: sourceForm.phoneExtension || undefined,
      mobile: sourceForm.mobile || undefined,
      email: sourceForm.email || undefined,
      department: sourceForm.department || undefined,
      countryId: sourceForm.countryId ? Number(sourceForm.countryId) : null,
      stateRegion: sourceForm.stateRegion || undefined,
      city: sourceForm.city || undefined,
      addressLine: sourceForm.addressLine || undefined,
      postalCode: sourceForm.postalCode || undefined,
      purchaseParticipationId: Number(sourceForm.purchaseParticipationId),
      hierarchyLevelId: Number(sourceForm.hierarchyLevelId),
      relationshipTypeId: Number(sourceForm.relationshipTypeId),
      influenceLevelId: Number(sourceForm.influenceLevelId),
      employmentStatusId: Number(sourceForm.employmentStatusId),
      activationStatusId: Number(sourceForm.activationStatusId),
      managerContactId: sourceForm.managerContactId
        ? Number(sourceForm.managerContactId)
        : null,
      influencesContactId: sourceForm.influencesContactId
        ? Number(sourceForm.influencesContactId)
        : null,
    };
  }

  async function saveContact(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setSavingContact(true);

    try {
      const normalizedForm = normalizeContactPresentationForm(form);
      setForm((prev) => {
        const didChange = Array.from(CONTACT_PRESENTATION_FIELDS).some(
          (field) => prev[field] !== normalizedForm[field],
        );
        return didChange ? { ...prev, ...normalizedForm } : prev;
      });

      const payload = buildContactPayload(normalizedForm);

      const { data } = editingContactId
        ? await api.put(`/api/contacts/${editingContactId}`, payload)
        : await api.post("/api/contacts", payload);

      setSuccess(
        data?.message ||
          (editingContactId
            ? "Contacto actualizado correctamente"
            : "Contacto creado correctamente"),
      );
      setContactDuplicateReview(null);
      setShowContactModal(false);
      setEditingContactId(null);
      setEditContactAudit(null);
      await load();
    } catch (err) {
      const duplicatePayload = err?.response?.data;
      if (
        !editingContactId &&
        err?.response?.status === 409 &&
        duplicatePayload?.code === "CONTACT_DUPLICATE_BLOCKED"
      ) {
        setContactDuplicateReview({
          code: duplicatePayload.code,
          message: duplicatePayload.message,
          duplicateDecision: duplicatePayload.duplicateDecision,
          duplicateWarnings: Array.isArray(duplicatePayload.duplicateWarnings)
            ? duplicatePayload.duplicateWarnings
            : [],
          aiReview: duplicatePayload.duplicateReview || null,
          duplicateValidationSource:
            duplicatePayload.duplicateValidationSource || "heuristic",
        });
        setSavingContact(false);
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
          setSavingContact(false);
          return;
        }
      }
      setError(getApiErrorMessage(err, "No fue posible guardar el contacto"));
    } finally {
      setSavingContact(false);
    }
  }

  function dismissContactDuplicateReview() {
    setContactDuplicateReview(null);
  }

  async function openDuplicateCandidateContact(contactId) {
    setContactDuplicateReview(null);
    await openEditContactModal(contactId);
  }

  const filteredContacts = useMemo(
    () =>
      contacts.filter((contact) => {
        if (contactStatusFilter === "all") return true;
        if (contactStatusFilter === "pending") {
          return contactsPendingEnabled && isContactPending(contact);
        }
        if (contactStatusFilter === "inactive")
          return (
            isContactInactive(contact) ||
            (!contactsPendingEnabled && isContactPending(contact))
          );
        return isContactActive(contact);
      }),
    [contacts, contactStatusFilter, contactsPendingEnabled],
  );

  const contactStatusCounts = useMemo(
    () =>
      contacts.reduce(
        (totals, contact) => {
          if (isContactPending(contact)) {
            if (contactsPendingEnabled) {
              totals.pending += 1;
            } else {
              totals.inactive += 1;
            }
            return totals;
          }
          if (isContactInactive(contact)) {
            totals.inactive += 1;
            return totals;
          }
          totals.active += 1;
          return totals;
        },
        { active: 0, pending: 0, inactive: 0 },
      ),
    [contacts, contactsPendingEnabled],
  );

  const totalContactsCount =
    contactStatusCounts.active +
    contactStatusCounts.pending +
    contactStatusCounts.inactive;

  const sortedContacts = useMemo(() => {
    const list = [...filteredContacts];

    const readValue = (contact) => {
      if (contactSortField === "id") return Number(contact.id) || 0;
      if (contactSortField === "nombre") return String(contact.full_name || "");
      if (contactSortField === "cuenta")
        return String(contact.account_name || "");
      if (contactSortField === "cargo")
        return String(contact.position_title || "");
      if (contactSortField === "email") return String(contact.email || "");
      if (contactSortField === "estado")
        return String(getContactStatusLabel(contact));
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

      return contactSortDirection === "asc" ? result : -result;
    });

    return list;
  }, [
    filteredContacts,
    contactSortField,
    contactSortDirection,
    getContactStatusLabel,
  ]);

  const visibleContacts = useMemo(() => {
    const query = contactQuery.trim().toLowerCase();
    if (!query) return sortedContacts;

    return sortedContacts.filter((contact) => {
      const haystack = [
        contact.id,
        contact.full_name,
        contact.account_name,
        contact.position_title,
        contact.email,
        contact.mobile,
        getContactStatusLabel(contact),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [sortedContacts, contactQuery, getContactStatusLabel]);

  const totalContactPages = Math.max(
    1,
    Math.ceil(visibleContacts.length / contactsPerPage),
  );
  const pagedContacts = visibleContacts.slice(
    (contactsPage - 1) * contactsPerPage,
    contactsPage * contactsPerPage,
  );

  const managerOptions = useMemo(
    () =>
      contacts.filter((contact) => {
        if (Number(contact.id) === Number(editingContactId)) return false;
        if (!form.accountId) return false;
        return Number(contact.account_id) === Number(form.accountId);
      }),
    [contacts, editingContactId, form.accountId],
  );

  const editingContact = useMemo(
    () =>
      contacts.find(
        (contact) => Number(contact.id) === Number(editingContactId),
      ) || null,
    [contacts, editingContactId],
  );

  useEffect(() => {
    if (!error && !success) return;
    const timeoutId = window.setTimeout(() => {
      setError("");
      setSuccess("");
    }, 4000);
    return () => window.clearTimeout(timeoutId);
  }, [error, success]);

  useEffect(() => {
    if (openContactMenuId === null) return undefined;

    function handlePointerDown(event) {
      if (event.target.closest(".contacts-kebab-wrap")) return;
      setOpenContactMenuId(null);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [openContactMenuId]);

  useEffect(() => {
    openEditContactModalRef.current = openEditContactModal;
  }, [openEditContactModal]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setContactDuplicateReview(null);
  }, [
    form.firstName,
    form.lastName,
    form.accountId,
    form.email,
    form.mobile,
    form.positionTitle,
    form.department,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function initializeContacts() {
      try {
        const [
          contactsRes,
          accountsRes,
          countriesRes,
          purchaseRes,
          hierarchyRes,
          relationshipRes,
          influenceRes,
          employmentRes,
          activationRes,
          temporaryFeaturesRes,
        ] = await Promise.all([
          api.get("/api/contacts"),
          api.get("/api/catalogs/contact-accounts"),
          api.get("/api/catalogs/contact-countries"),
          api.get("/api/catalogs/contact-purchase-participations"),
          api.get("/api/catalogs/contact-hierarchy-levels"),
          api.get("/api/catalogs/contact-relationship-types"),
          api.get("/api/catalogs/contact-influence-levels"),
          api.get("/api/catalogs/contact-employment-statuses"),
          api.get("/api/catalogs/contact-activation-statuses"),
          api
            .get("/api/settings/temporary-features")
            .catch(() => ({ data: { settings: null } })),
        ]);

        if (cancelled) return;

        setContacts(contactsRes.data || []);
        setCatalogs({
          accounts: accountsRes.data || [],
          countries: countriesRes.data || [],
          purchaseParticipations: purchaseRes.data || [],
          hierarchyLevels: hierarchyRes.data || [],
          relationshipTypes: relationshipRes.data || [],
          influenceLevels: influenceRes.data || [],
          employmentStatuses: employmentRes.data || [],
          activationStatuses: activationRes.data || [],
        });
        setContactsPendingEnabled(
          Boolean(temporaryFeaturesRes.data?.settings?.contactsPendingEnabled),
        );
      } catch (err) {
        if (!cancelled) {
          setError(getApiErrorMessage(err, "No fue posible cargar contactos"));
        }
      }
    }

    void initializeContacts();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (contactsPendingEnabled || contactStatusFilter !== "pending") {
      return;
    }
    setContactStatusFilterState("all");
  }, [
    contactStatusFilter,
    contactsPendingEnabled,
    setContactStatusFilterState,
  ]);

  useEffect(() => {
    const editId = searchParams.get("edit");
    if (!editId) return;
    let cancelled = false;

    async function syncEditParam() {
      setSearchParams({}, { replace: true });
      if (cancelled) return;
      await openEditContactModalRef.current?.(Number(editId));
    }

    void syncEditParam();

    return () => {
      cancelled = true;
    };
  }, [searchParams, setSearchParams]);

  function setContactStatusFilter(value) {
    setContactsPage(1);
    setContactStatusFilterState(
      value === "pending" && !contactsPendingEnabled ? "all" : value,
    );
  }

  function setContactQuery(value) {
    setContactsPage(1);
    setContactQueryState(value);
  }

  function setContactsPerPage(value) {
    setContactsPage(1);
    setContactsPerPageState(value);
  }

  function toggleContactSort(field) {
    if (contactSortField === field) {
      setContactSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setContactSortField(field);
    setContactSortDirection("asc");
  }

  function getContactSortArrow(field) {
    if (contactSortField !== field) return "↕";
    return contactSortDirection === "asc" ? "↑" : "↓";
  }

  return {
    contacts,
    load,
    contactStatusFilter,
    setContactStatusFilter,
    contactQuery,
    setContactQuery,
    contactsPerPage,
    setContactsPerPage,
    contactsPage,
    setContactsPage,
    showContactModal,
    editingContactId,
    editContactAudit,
    contactDuplicateReview,
    openContactMenuId,
    confirmContactStatusAction,
    savingContact,
    error,
    success,
    catalogs,
    contactsPendingEnabled,
    canCreateOrRequestContacts,
    canChangeContactActivationStatus,
    form,
    totalContactsCount,
    contactStatusCounts,
    visibleContacts,
    pagedContacts,
    totalContactPages,
    managerOptions,
    editingContact,
    isContactActive,
    isContactPending,
    isContactInactive,
    getContactStatusLabel,
    getContactStatusBadgeClass,
    getContactStatusIconBadgeClass,
    formatDateTime,
    updateContactFormField,
    normalizeContactFormField,
    handleContactAccountChange,
    openCreateContactModal,
    openEditContactModal,
    closeContactModal,
    toggleContactMenu,
    runContactAction,
    openContactStatusConfirmation,
    closeContactStatusConfirmation,
    confirmSelectedContactStatusChange,
    getContactStatusConfirmationMeta,
    saveContact,
    dismissContactDuplicateReview,
    openDuplicateCandidateContact,
    toggleContactSort,
    getContactSortArrow,
  };
}
