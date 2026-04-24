import { useEffect, useMemo, useState } from "react";
import { api, getApiErrorMessage } from "../api";
import { usePersistedStatusFilter } from "../appFilters";

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function useContactsCrud({ currentUser, searchParams, setSearchParams }) {
  const [contacts, setContacts] = useState([]);
  const [contactStatusFilter, setContactStatusFilter] =
    usePersistedStatusFilter("crm.contacts.statusFilter");
  const [contactQuery, setContactQuery] = useState("");
  const [contactSortField, setContactSortField] = useState("id");
  const [contactSortDirection, setContactSortDirection] = useState("asc");
  const [contactsPerPage, setContactsPerPage] = useState(10);
  const [contactsPage, setContactsPage] = useState(1);
  const [showContactModal, setShowContactModal] = useState(false);
  const [editingContactId, setEditingContactId] = useState(null);
  const [editContactAudit, setEditContactAudit] = useState(null);
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
    relationshipTypes: [],
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
    relationshipTypeId: "",
    employmentStatusId: "",
    activationStatusId: "",
    managerContactId: "",
    influencesContactId: "",
  });

  const explicitContactPermissions = useMemo(
    () => new Set(currentUser?.permissions || []),
    [currentUser],
  );
  const canCreateOrRequestContacts =
    explicitContactPermissions.has("contactos.create") ||
    explicitContactPermissions.has("contactos.request");
  const canChangeContactActivationStatus = explicitContactPermissions.has(
    "contactos.create",
  );

  function findCatalogIdByCode(options, expectedCode) {
    const target = normalizeText(expectedCode);
    const found = options.find((option) => normalizeText(option.code) === target);
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
      relationshipTypeId: findCatalogIdByCode(
        catalogs.relationshipTypes,
        "ninguno",
      ),
      employmentStatusId: String(catalogs.employmentStatuses?.[0]?.id || ""),
      activationStatusId: String(catalogs.activationStatuses?.[0]?.id || ""),
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
        relationshipRes,
        employmentRes,
        activationRes,
      ] = await Promise.all([
        api.get("/api/contacts"),
        api.get("/api/catalogs/contact-accounts"),
        api.get("/api/catalogs/contact-countries"),
        api.get("/api/catalogs/contact-purchase-participations"),
        api.get("/api/catalogs/contact-relationship-types"),
        api.get("/api/catalogs/contact-employment-statuses"),
        api.get("/api/catalogs/contact-activation-statuses"),
      ]);

      setContacts(contactsRes.data || []);
      setCatalogs({
        accounts: accountsRes.data || [],
        countries: countriesRes.data || [],
        purchaseParticipations: purchaseRes.data || [],
        relationshipTypes: relationshipRes.data || [],
        employmentStatuses: employmentRes.data || [],
        activationStatuses: activationRes.data || [],
      });
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible cargar contactos"));
    }
  }

  function isContactActive(contact) {
    return normalizeText(contact.activation_status) === "activado";
  }

  function isContactPending(contact) {
    return normalizeText(contact.activation_status) === "pendiente de activacion";
  }

  function isContactInactive(contact) {
    return normalizeText(contact.activation_status) === "desactivado";
  }

  function getContactStatusLabel(contact) {
    if (isContactPending(contact)) return "Pendiente de activacion";
    return isContactActive(contact) ? "Activado" : "Desactivado";
  }

  function getContactStatusBadgeClass(contact) {
    if (isContactPending(contact)) {
      return "user-status-badge pending";
    }
    return isContactActive(contact)
      ? "user-status-badge active"
      : "user-status-badge inactive";
  }

  function getContactStatusIconBadgeClass(contact) {
    if (isContactPending(contact)) {
      return "status-icon-badge pending";
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

  function handleContactAccountChange(accountId) {
    setForm((prev) => ({
      ...prev,
      accountId,
      ...(editingContactId ? null : getAccountLocationFields(accountId)),
    }));
  }

  function openCreateContactModal() {
    setError("");
    setSuccess("");
    setEditingContactId(null);
    setEditContactAudit(null);
    setForm(buildDefaultContactForm());
    setShowContactModal(true);
  }

  async function openEditContactModal(contactId) {
    setError("");
    setSuccess("");
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
        relationshipTypeId: String(data.relationship_type_id || ""),
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
  }

  function closeContactModal() {
    if (savingContact) return;
    setShowContactModal(false);
    setEditingContactId(null);
    setEditContactAudit(null);
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

  async function saveContact(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setSavingContact(true);

    try {
      const payload = {
        firstName: form.firstName,
        lastName: form.lastName,
        accountId: Number(form.accountId),
        positionTitle: form.positionTitle || undefined,
        phone: form.phone || undefined,
        phoneExtension: form.phoneExtension || undefined,
        mobile: form.mobile || undefined,
        email: form.email || undefined,
        department: form.department || undefined,
        countryId: form.countryId ? Number(form.countryId) : null,
        stateRegion: form.stateRegion || undefined,
        city: form.city || undefined,
        addressLine: form.addressLine || undefined,
        postalCode: form.postalCode || undefined,
        purchaseParticipationId: Number(form.purchaseParticipationId),
        relationshipTypeId: Number(form.relationshipTypeId),
        employmentStatusId: Number(form.employmentStatusId),
        activationStatusId: Number(form.activationStatusId),
        managerContactId: form.managerContactId
          ? Number(form.managerContactId)
          : null,
        influencesContactId: form.influencesContactId
          ? Number(form.influencesContactId)
          : null,
      };

      const { data } = editingContactId
        ? await api.put(`/api/contacts/${editingContactId}`, payload)
        : await api.post("/api/contacts", payload);

      setSuccess(
        data?.message ||
          (editingContactId
            ? "Contacto actualizado correctamente"
            : "Contacto creado correctamente"),
      );
      setShowContactModal(false);
      setEditingContactId(null);
      setEditContactAudit(null);
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
          setSavingContact(false);
          return;
        }
      }
      setError(getApiErrorMessage(err, "No fue posible guardar el contacto"));
    } finally {
      setSavingContact(false);
    }
  }

  const filteredContacts = useMemo(
    () =>
      contacts.filter((contact) => {
        if (contactStatusFilter === "all") return true;
        if (contactStatusFilter === "pending") return isContactPending(contact);
        if (contactStatusFilter === "inactive") return isContactInactive(contact);
        return isContactActive(contact);
      }),
    [contacts, contactStatusFilter],
  );

  const contactStatusCounts = useMemo(
    () =>
      contacts.reduce(
        (totals, contact) => {
          if (isContactPending(contact)) {
            totals.pending += 1;
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
    [contacts],
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
      if (contactSortField === "cuenta") return String(contact.account_name || "");
      if (contactSortField === "cargo") return String(contact.position_title || "");
      if (contactSortField === "email") return String(contact.email || "");
      if (contactSortField === "estado") return String(getContactStatusLabel(contact));
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
  }, [filteredContacts, contactSortField, contactSortDirection]);

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
  }, [sortedContacts, contactQuery]);

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
      contacts.find((contact) => Number(contact.id) === Number(editingContactId)) ||
      null,
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
    load();
  }, []);

  useEffect(() => {
    const editId = searchParams.get("edit");
    if (!editId) return;
    setSearchParams({}, { replace: true });
    openEditContactModal(Number(editId));
  }, [searchParams]);

  useEffect(() => {
    if (!showContactModal || editingContactId) return;

    setForm((prev) => ({
      ...prev,
      purchaseParticipationId:
        prev.purchaseParticipationId ||
        findCatalogIdByCode(catalogs.purchaseParticipations, "ninguno"),
      relationshipTypeId:
        prev.relationshipTypeId ||
        findCatalogIdByCode(catalogs.relationshipTypes, "ninguno"),
      employmentStatusId:
        prev.employmentStatusId ||
        String(catalogs.employmentStatuses?.[0]?.id || ""),
      activationStatusId:
        prev.activationStatusId ||
        String(catalogs.activationStatuses?.[0]?.id || ""),
      ...(prev.accountId ? getAccountLocationFields(prev.accountId) : null),
    }));
  }, [showContactModal, editingContactId, catalogs]);

  useEffect(() => {
    setContactsPage(1);
  }, [contactQuery, contactStatusFilter, contactsPerPage]);

  useEffect(() => {
    if (!form.managerContactId) return;
    const isValidManager = managerOptions.some(
      (contact) => Number(contact.id) === Number(form.managerContactId),
    );
    if (isValidManager) return;

    setForm((prev) => ({
      ...prev,
      managerContactId: "",
    }));
  }, [managerOptions, form.managerContactId]);

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
    openContactMenuId,
    confirmContactStatusAction,
    savingContact,
    error,
    success,
    catalogs,
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
    toggleContactSort,
    getContactSortArrow,
  };
}