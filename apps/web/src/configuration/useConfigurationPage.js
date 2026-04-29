import { useEffect, useMemo, useState } from "react";
import { api, getApiErrorMessage } from "../api";

const EMPTY_FORM = {
  legalName: "",
  commercialName: "",
  taxId: "",
  logoUrl: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  stateRegion: "",
  countryId: "",
  postalCode: "",
  email: "",
  phone: "",
  website: "",
  description: "",
};

const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024;

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function validateCompanyProfile(form) {
  const errors = {};

  if (!String(form.legalName || "").trim()) {
    errors.legalName = "La razon social es obligatoria";
  }

  if (!String(form.taxId || "").trim()) {
    errors.taxId = "El registro fiscal es obligatorio";
  }

  if (!String(form.addressLine1 || "").trim()) {
    errors.addressLine1 = "La direccion principal es obligatoria";
  }

  if (!String(form.city || "").trim()) {
    errors.city = "La ciudad es obligatoria";
  }

  if (!String(form.stateRegion || "").trim()) {
    errors.stateRegion = "El estado o region es obligatorio";
  }

  if (!String(form.countryId || "").trim()) {
    errors.countryId = "Selecciona un pais";
  }

  if (!String(form.postalCode || "").trim()) {
    errors.postalCode = "El codigo postal es obligatorio";
  }

  const email = String(form.email || "").trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Escribe un correo institucional valido";
  }

  const website = String(form.website || "").trim();
  if (website && !isValidHttpUrl(website)) {
    errors.website = "El sitio web debe iniciar con http:// o https://";
  }

  return errors;
}

function normalizeProfileToForm(profile) {
  if (!profile) return EMPTY_FORM;
  return {
    legalName: String(profile.legalName || ""),
    commercialName: String(profile.commercialName || ""),
    taxId: String(profile.taxId || ""),
    logoUrl: String(profile.logoUrl || ""),
    addressLine1: String(profile.addressLine1 || ""),
    addressLine2: String(profile.addressLine2 || ""),
    city: String(profile.city || ""),
    stateRegion: String(profile.stateRegion || ""),
    countryId: profile.countryId ? String(profile.countryId) : "",
    postalCode: String(profile.postalCode || ""),
    email: String(profile.email || ""),
    phone: String(profile.phone || ""),
    website: String(profile.website || ""),
    description: String(profile.description || ""),
  };
}

function serializeForm(form) {
  return JSON.stringify({
    legalName: String(form.legalName || "").trim(),
    commercialName: String(form.commercialName || "").trim(),
    taxId: String(form.taxId || "").trim(),
    logoUrl: String(form.logoUrl || "").trim(),
    addressLine1: String(form.addressLine1 || "").trim(),
    addressLine2: String(form.addressLine2 || "").trim(),
    city: String(form.city || "").trim(),
    stateRegion: String(form.stateRegion || "").trim(),
    countryId: String(form.countryId || "").trim(),
    postalCode: String(form.postalCode || "").trim(),
    email: String(form.email || "").trim(),
    phone: String(form.phone || "").trim(),
    website: String(form.website || "").trim(),
    description: String(form.description || "").trim(),
  });
}

function formatDateTime(value) {
  if (!value) return "Sin cambios registrados";
  try {
    return new Date(value).toLocaleString("es-MX", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(value);
  }
}

function summarizeChangedFields(changedFields) {
  const entries = Object.entries(changedFields || {});
  if (!entries.length) return "Cambio registrado";
  return entries
    .slice(0, 3)
    .map(([field]) => field)
    .join(", ");
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("No fue posible leer la imagen"));
    reader.readAsDataURL(file);
  });
}

export function useConfigurationPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [activeSection, setActiveSection] = useState("company");
  const [countries, setCountries] = useState([]);
  const [companyProfile, setCompanyProfile] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [initialSnapshot, setInitialSnapshot] = useState(
    serializeForm(EMPTY_FORM),
  );
  const [auditEntries, setAuditEntries] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function loadConfiguration() {
      setLoading(true);
      setError("");
      try {
        const [profileResponse, countriesResponse, auditResponse] =
          await Promise.all([
            api.get("/api/settings/company-profile"),
            api.get("/api/catalogs/countries"),
            api.get("/api/settings/audit?limit=25"),
          ]);

        if (cancelled) return;

        const nextProfile = profileResponse.data?.profile || null;
        const nextForm = normalizeProfileToForm(nextProfile);
        setCompanyProfile(nextProfile);
        setForm(nextForm);
        setInitialSnapshot(serializeForm(nextForm));
        setCountries(
          Array.isArray(countriesResponse.data) ? countriesResponse.data : [],
        );
        setAuditEntries(
          Array.isArray(auditResponse.data) ? auditResponse.data : [],
        );
      } catch (err) {
        if (!cancelled) {
          setError(
            getApiErrorMessage(err, "No fue posible cargar la configuracion"),
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadConfiguration();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!error && !success) return undefined;
    const timeoutId = window.setTimeout(() => {
      setError("");
      setSuccess("");
    }, 4000);
    return () => window.clearTimeout(timeoutId);
  }, [error, success]);

  const isDirty = useMemo(
    () => serializeForm(form) !== initialSnapshot,
    [form, initialSnapshot],
  );

  const validationErrors = useMemo(() => validateCompanyProfile(form), [form]);
  const canSave = isDirty && Object.keys(validationErrors).length === 0;

  useEffect(() => {
    if (!isDirty) return undefined;

    function handleBeforeUnload(event) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  function updateField(field, value) {
    setSaveAttempted(false);
    setForm((current) => ({ ...current, [field]: value }));
  }

  function confirmDiscardChanges() {
    if (!isDirty) return true;
    return window.confirm("Hay cambios sin guardar. ¿Deseas descartarlos?");
  }

  function changeSection(nextSection) {
    if (nextSection === activeSection) return;
    if (!confirmDiscardChanges()) return;
    setActiveSection(nextSection);
  }

  function discardChanges() {
    if (!confirmDiscardChanges()) return;
    const nextForm = normalizeProfileToForm(companyProfile);
    setForm(nextForm);
    setSaveAttempted(false);
    setInitialSnapshot(serializeForm(nextForm));
    setError("");
    setSuccess("");
  }

  async function handleLogoChange(file) {
    if (!file) {
      updateField("logoUrl", "");
      return;
    }

    if (!String(file.type || "").startsWith("image/")) {
      setError("Selecciona un archivo de imagen valido");
      return;
    }

    if (file.size > MAX_LOGO_SIZE_BYTES) {
      setError("El logo no debe exceder 2 MB");
      return;
    }

    try {
      const logoUrl = await readImageFile(file);
      updateField("logoUrl", logoUrl);
    } catch (err) {
      setError(String(err?.message || "No fue posible cargar el logo"));
    }
  }

  async function saveCompanyProfile() {
    const nextValidationErrors = validateCompanyProfile(form);
    if (Object.keys(nextValidationErrors).length > 0) {
      setSaveAttempted(true);
      setError(Object.values(nextValidationErrors)[0]);
      setSuccess("");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const payload = {
        legalName: form.legalName.trim(),
        commercialName: form.commercialName.trim() || undefined,
        taxId: form.taxId.trim(),
        logoUrl: form.logoUrl.trim() || undefined,
        addressLine1: form.addressLine1.trim(),
        addressLine2: form.addressLine2.trim() || undefined,
        city: form.city.trim(),
        stateRegion: form.stateRegion.trim(),
        countryId: Number(form.countryId),
        postalCode: form.postalCode.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        website: form.website.trim() || undefined,
        description: form.description.trim() || undefined,
      };

      const [saveResponse, auditResponse] = await Promise.all([
        api.put("/api/settings/company-profile", payload),
        api.get("/api/settings/audit?limit=25"),
      ]);

      const nextProfile = saveResponse.data?.profile || null;
      const nextForm = normalizeProfileToForm(nextProfile);
      setCompanyProfile(nextProfile);
      setForm(nextForm);
      setSaveAttempted(false);
      setInitialSnapshot(serializeForm(nextForm));
      setAuditEntries(
        Array.isArray(auditResponse.data) ? auditResponse.data : [],
      );
      setSuccess(
        saveResponse.data?.message ||
          "Configuracion de empresa actualizada correctamente",
      );
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible guardar la configuracion institucional",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  const latestUpdateText = useMemo(() => {
    if (!companyProfile?.updatedAt) {
      return "Sin cambios registrados";
    }
    return `${formatDateTime(companyProfile.updatedAt)} por ${
      companyProfile.updatedByUserName || "sistema"
    }`;
  }, [companyProfile]);

  const sectionItems = useMemo(
    () => [
      {
        id: "company",
        title: "Empresa",
        description: "Datos institucionales, fiscales y de contacto",
        dirty: isDirty,
      },
      {
        id: "global",
        title: "Parametros globales",
        description: "Ajustes funcionales comunes a toda la aplicacion",
        dirty: false,
      },
      {
        id: "modules",
        title: "Parametros por modulo",
        description: "Reglas especificas por area funcional",
        dirty: false,
      },
      {
        id: "audit",
        title: "Historial de cambios",
        description: "Auditoria y trazabilidad de configuracion",
        dirty: false,
      },
    ],
    [isDirty],
  );

  return {
    loading,
    saving,
    error,
    success,
    activeSection,
    countries,
    companyProfile,
    form,
    auditEntries,
    fieldErrors: saveAttempted ? validationErrors : {},
    isDirty,
    canSave,
    latestUpdateText,
    sectionItems,
    formatDateTime,
    summarizeChangedFields,
    updateField,
    changeSection,
    discardChanges,
    handleLogoChange,
    saveCompanyProfile,
  };
}