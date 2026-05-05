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

const EMPTY_TEMPORARY_FEATURE_SETTINGS = {
  accountsPendingEnabled: false,
  contactsPendingEnabled: false,
  opportunitiesPendingEnabled: false,
  updatedAt: null,
  updatedByUserName: "",
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

function normalizeTemporaryFeatureSettings(settings) {
  if (!settings) {
    return { ...EMPTY_TEMPORARY_FEATURE_SETTINGS };
  }

  return {
    accountsPendingEnabled: Boolean(settings.accountsPendingEnabled),
    contactsPendingEnabled: Boolean(settings.contactsPendingEnabled),
    opportunitiesPendingEnabled: Boolean(settings.opportunitiesPendingEnabled),
    updatedAt: settings.updatedAt || null,
    updatedByUserName: String(settings.updatedByUserName || ""),
  };
}

function serializeTemporaryFeatureSettings(settings) {
  return JSON.stringify({
    accountsPendingEnabled: Boolean(settings.accountsPendingEnabled),
    contactsPendingEnabled: Boolean(settings.contactsPendingEnabled),
    opportunitiesPendingEnabled: Boolean(settings.opportunitiesPendingEnabled),
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
  const [temporaryFeatureSettings, setTemporaryFeatureSettings] = useState(
    EMPTY_TEMPORARY_FEATURE_SETTINGS,
  );
  const [form, setForm] = useState(EMPTY_FORM);
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [initialSnapshot, setInitialSnapshot] = useState(
    serializeForm(EMPTY_FORM),
  );
  const [savingTemporaryFeatures, setSavingTemporaryFeatures] =
    useState(false);
  const [initialTemporaryFeaturesSnapshot, setInitialTemporaryFeaturesSnapshot] =
    useState(serializeTemporaryFeatureSettings(EMPTY_TEMPORARY_FEATURE_SETTINGS));
  const [auditEntries, setAuditEntries] = useState([]);
  const [workspacePlaybooks, setWorkspacePlaybooks] = useState([]);
  const [workspacePlaybookDetail, setWorkspacePlaybookDetail] = useState(null);
  const [activatingWorkspaceVersionId, setActivatingWorkspaceVersionId] =
    useState(null);
  const [savingWorkspacePlaybookKey, setSavingWorkspacePlaybookKey] =
    useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadConfiguration() {
      setLoading(true);
      setError("");
      try {
        const [
          profileResponse,
          temporaryFeaturesResponse,
          countriesResponse,
          auditResponse,
          playbooksResponse,
        ] = await Promise.all([
          api.get("/api/settings/company-profile"),
          api
            .get("/api/settings/temporary-features")
            .catch(() => ({ data: { settings: null } })),
          api.get("/api/catalogs/countries"),
          api.get("/api/settings/audit?limit=25"),
          api
            .get("/api/opportunities/workspace-playbooks")
            .catch(() => ({ data: { items: [] } })),
        ]);

        if (cancelled) return;

        const nextProfile = profileResponse.data?.profile || null;
        const nextTemporaryFeatureSettings = normalizeTemporaryFeatureSettings(
          temporaryFeaturesResponse.data?.settings,
        );
        const nextForm = normalizeProfileToForm(nextProfile);
        setCompanyProfile(nextProfile);
        setTemporaryFeatureSettings(nextTemporaryFeatureSettings);
        setForm(nextForm);
        setInitialSnapshot(serializeForm(nextForm));
        setInitialTemporaryFeaturesSnapshot(
          serializeTemporaryFeatureSettings(nextTemporaryFeatureSettings),
        );
        setCountries(
          Array.isArray(countriesResponse.data) ? countriesResponse.data : [],
        );
        setAuditEntries(
          Array.isArray(auditResponse.data) ? auditResponse.data : [],
        );
        setWorkspacePlaybooks(
          Array.isArray(playbooksResponse.data?.items)
            ? playbooksResponse.data.items
            : [],
        );
        const activePlaybook = Array.isArray(playbooksResponse.data?.items)
          ? playbooksResponse.data.items.find((item) => item.isActive)
          : null;
        if (activePlaybook?.versionId) {
          const detailResponse = await api.get(
            `/api/opportunities/workspace-playbooks/${activePlaybook.versionId}`,
          );
          if (!cancelled) {
            setWorkspacePlaybookDetail(detailResponse.data?.playbook || null);
          }
        } else {
          setWorkspacePlaybookDetail(null);
        }
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
  const temporaryFeaturesDirty = useMemo(
    () =>
      serializeTemporaryFeatureSettings(temporaryFeatureSettings) !==
      initialTemporaryFeaturesSnapshot,
    [temporaryFeatureSettings, initialTemporaryFeaturesSnapshot],
  );

  const validationErrors = useMemo(() => validateCompanyProfile(form), [form]);
  const canSave = isDirty && Object.keys(validationErrors).length === 0;
  const temporaryFeaturesCanSave = temporaryFeaturesDirty;

  useEffect(() => {
    if (!isDirty && !temporaryFeaturesDirty) return undefined;

    function handleBeforeUnload(event) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty, temporaryFeaturesDirty]);

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

  function updateTemporaryFeatureSetting(field, value) {
    setTemporaryFeatureSettings((current) => ({
      ...current,
      [field]: Boolean(value),
    }));
  }

  async function saveTemporaryFeatureSettings() {
    setSavingTemporaryFeatures(true);
    setError("");
    setSuccess("");
    try {
      const payload = {
        accountsPendingEnabled: Boolean(
          temporaryFeatureSettings.accountsPendingEnabled,
        ),
        contactsPendingEnabled: Boolean(
          temporaryFeatureSettings.contactsPendingEnabled,
        ),
        opportunitiesPendingEnabled: Boolean(
          temporaryFeatureSettings.opportunitiesPendingEnabled,
        ),
      };

      const [saveResponse, auditResponse] = await Promise.all([
        api.put("/api/settings/temporary-features", payload),
        api.get("/api/settings/audit?limit=25"),
      ]);

      const nextSettings = normalizeTemporaryFeatureSettings(
        saveResponse.data?.settings,
      );
      setTemporaryFeatureSettings(nextSettings);
      setInitialTemporaryFeaturesSnapshot(
        serializeTemporaryFeatureSettings(nextSettings),
      );
      setAuditEntries(
        Array.isArray(auditResponse.data) ? auditResponse.data : [],
      );
      setSuccess(
        saveResponse.data?.message ||
          "Configuracion temporal actualizada correctamente",
      );
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible guardar la configuracion temporal",
        ),
      );
    } finally {
      setSavingTemporaryFeatures(false);
    }
  }

  async function activateWorkspacePlaybook(versionId) {
    setActivatingWorkspaceVersionId(versionId);
    setError("");
    setSuccess("");
    try {
      const [activateResponse, playbooksResponse, detailResponse] =
        await Promise.all([
          api.post(
            `/api/opportunities/workspace-playbooks/${versionId}/activate`,
          ),
          api.get("/api/opportunities/workspace-playbooks"),
          api.get(`/api/opportunities/workspace-playbooks/${versionId}`),
        ]);
      setWorkspacePlaybooks(
        Array.isArray(playbooksResponse.data?.items)
          ? playbooksResponse.data.items
          : [],
      );
      setWorkspacePlaybookDetail(detailResponse.data?.playbook || null);
      setSuccess(
        activateResponse.data?.playbook
          ? `Playbook activo: ${activateResponse.data.playbook.name} ${activateResponse.data.playbook.version}`
          : "Playbook activado correctamente",
      );
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible activar la version del playbook",
        ),
      );
    } finally {
      setActivatingWorkspaceVersionId(null);
    }
  }

  async function updateWorkspacePlaybookStage({
    versionId,
    salesStageCode,
    objective,
    exitCriteriaSummary,
  }) {
    setSavingWorkspacePlaybookKey(`stage:${salesStageCode}`);
    setError("");
    setSuccess("");
    try {
      const response = await api.put(
        `/api/opportunities/workspace-playbooks/${versionId}/stages/${salesStageCode}`,
        { objective, exitCriteriaSummary },
      );
      setWorkspacePlaybookDetail(response.data?.playbook || null);
      setSuccess("Etapa del playbook actualizada");
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible actualizar la etapa del playbook",
        ),
      );
      throw err;
    } finally {
      setSavingWorkspacePlaybookKey("");
    }
  }

  async function updateWorkspacePlaybookCriterion({
    versionId,
    salesStageCode,
    criterionCode,
    title,
    description,
    themeCode,
    displayOrder,
  }) {
    setSavingWorkspacePlaybookKey(
      `criterion:${salesStageCode}:${criterionCode}`,
    );
    setError("");
    setSuccess("");
    try {
      const response = await api.put(
        `/api/opportunities/workspace-playbooks/${versionId}/stages/${salesStageCode}/criteria/${criterionCode}`,
        {
          title,
          description,
          themeCode,
          displayOrder,
        },
      );
      setWorkspacePlaybookDetail(response.data?.playbook || null);
      setSuccess("Criterio del playbook actualizado");
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible actualizar el criterio del playbook",
        ),
      );
      throw err;
    } finally {
      setSavingWorkspacePlaybookKey("");
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

  const latestTemporaryFeaturesUpdateText = useMemo(() => {
    if (!temporaryFeatureSettings.updatedAt) {
      return "Sin cambios registrados";
    }
    return `${formatDateTime(temporaryFeatureSettings.updatedAt)} por ${
      temporaryFeatureSettings.updatedByUserName || "sistema"
    }`;
  }, [temporaryFeatureSettings]);

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
        dirty: temporaryFeaturesDirty,
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
    [isDirty, temporaryFeaturesDirty],
  );

  return {
    loading,
    saving,
    error,
    success,
    activeSection,
    countries,
    companyProfile,
    temporaryFeatureSettings,
    form,
    auditEntries,
    workspacePlaybooks,
    workspacePlaybookDetail,
    activatingWorkspaceVersionId,
    savingWorkspacePlaybookKey,
    fieldErrors: saveAttempted ? validationErrors : {},
    isDirty,
    canSave,
    savingTemporaryFeatures,
    temporaryFeaturesDirty,
    temporaryFeaturesCanSave,
    latestUpdateText,
    latestTemporaryFeaturesUpdateText,
    sectionItems,
    formatDateTime,
    summarizeChangedFields,
    updateField,
    changeSection,
    discardChanges,
    handleLogoChange,
    saveCompanyProfile,
    updateTemporaryFeatureSetting,
    saveTemporaryFeatureSettings,
    activateWorkspacePlaybook,
    updateWorkspacePlaybookStage,
    updateWorkspacePlaybookCriterion,
  };
}
