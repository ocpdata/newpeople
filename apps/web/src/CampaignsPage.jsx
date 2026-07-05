import { useEffect, useMemo, useState } from "react";
import { api, getApiErrorMessage } from "./api";
import "./campaigns-page.css";

const EMPTY_FORM = {
  name: "",
  description: "",
  tipo_campana: "reconocimiento",
  subtipo_campana: "correo_masivo",
  estado_campana: "borrador",
  etapa_ciclo_vida: "",
  starts_at: "",
  ends_at: "",
};

const EMPTY_ACCOUNT_FORM = {
  account_id: "",
  estado_interaccion: "no_enviado",
  last_interaction_at: "",
};

const CAMPAIGN_TYPE_DESCRIPTIONS = {
  reconocimiento:
    "Aumenta visibilidad y recordacion de marca en audiencias nuevas.",
  captacion_de_leads:
    "Genera registros de prospectos interesados para el equipo comercial.",
  nutricion: "Educa y acompana leads para elevar su madurez de compra.",
  conversion: "Impulsa acciones de cierre como demo, cotizacion o compra.",
  fidelizacion:
    "Fortalece relacion con clientes actuales para mejorar permanencia.",
  reactivacion:
    "Recupera contactos o clientes inactivos con nuevas propuestas.",
  promocion: "Comunica ofertas puntuales para acelerar respuesta comercial.",
  lanzamiento_de_producto:
    "Presenta una nueva solucion al mercado para lograr adopcion inicial.",
  upsell: "Promueve una version superior o mayor volumen en clientes activos.",
  cross_sell:
    "Ofrece productos o servicios complementarios a clientes actuales.",
  evento: "Convoca audiencia alrededor de un evento presencial o virtual.",
  referidos:
    "Incentiva recomendaciones de clientes o aliados para captar nuevos leads.",
  educacion:
    "Entrega contenido formativo para posicionar expertise y confianza.",
};

const CAMPAIGN_SUBTYPE_DESCRIPTIONS = {
  correo_masivo:
    "Envio puntual a una base amplia para comunicar anuncios o contenidos.",
  correo_automatizado:
    "Secuencias de email por disparadores o etapas del embudo.",
  redes_sociales_organicas:
    "Publicaciones sin pauta para construir comunidad y alcance natural.",
  redes_sociales_pagadas:
    "Campanas de pauta en redes para segmentar y escalar resultados.",
  anuncios_busqueda:
    "Anuncios en buscadores orientados a intencion activa de demanda.",
  anuncios_display: "Banners y formatos graficos para awareness y remarketing.",
  webinar: "Sesion online en vivo para educar, captar y calificar interes.",
  landing_page:
    "Pagina de conversion enfocada en registro, descarga o contacto.",
  sms: "Mensajes de texto de alta apertura para recordatorios o avisos.",
  whatsapp: "Mensajeria directa para seguimiento comercial y conversacion 1:1.",
  evento_presencial:
    "Actividad fisica para relacionamiento, networking y demostracion.",
  evento_virtual: "Evento online para alcance remoto y participacion digital.",
  encuesta: "Levantamiento de feedback para segmentar, aprender y priorizar.",
  programa_de_referidos:
    "Mecanica de referidos con incentivos para atraer nuevos prospectos.",
};

const CAMPAIGN_STATE_DESCRIPTIONS = {
  borrador: "Campana en preparacion interna; aun no se ejecuta.",
  en_ejecucion: "Campana activa y corriendo en sus canales definidos.",
  pausada: "Campana detenida temporalmente con posibilidad de reanudacion.",
  finalizada: "Campana concluida y cerrada operativamente.",
  cancelada: "Campana detenida de forma definitiva antes de su cierre normal.",
};

const CAMPAIGN_LIFECYCLE_STAGE_DESCRIPTIONS = {
  visitante: "Cuenta sin interes explicito; aun en etapa de descubrimiento.",
  lead_nuevo:
    "Cuenta con leads creados o asignados activos/no cerrados, sin leads calificados.",
  lead_calificado:
    "Cuenta con leads calificados y sin leads activos en estado creado o asignado.",
  oportunidad:
    "Cuenta con oportunidades abiertas desde la etapa Desarrollo en adelante.",
  cliente_nuevo:
    "Cuenta con 1+ oportunidades ganadas en los ultimos 90 dias y sin ganadas anteriores.",
  cliente_activo: "Cliente vigente con relacion comercial activa y en curso.",
  cliente_en_riesgo:
    "Cliente con señales de posible perdida o baja de actividad.",
  cliente_inactivo:
    "Cliente sin actividad comercial reciente ni compras en curso.",
};

function isActiveAccount(account) {
  const statusCode = String(account?.activation_status_code || "")
    .trim()
    .toLowerCase();
  if (statusCode) {
    return statusCode === "activada";
  }

  const statusName = String(account?.activation_status || "")
    .trim()
    .toLowerCase();
  return statusName === "activada";
}

function formatCampaignTypeLabel(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDateTimeLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("es-CO", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toPayloadDateTime(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function toPayloadDate(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  return `${normalized}T00:00:00.000Z`;
}

function toDateInputValue(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  const datePart = normalized.includes("T")
    ? normalized.split("T")[0]
    : normalized.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : "";
}

function normalizeSectorValue(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function normalizeAudienceContact(rawContact) {
  const contactId = Number(rawContact?.contact_id ?? rawContact?.id ?? 0);
  if (!Number.isInteger(contactId) || contactId <= 0) return null;

  const contactName = String(
    rawContact?.contact_name ||
      rawContact?.full_name ||
      rawContact?.fullName ||
      "",
  ).trim();
  const email = String(rawContact?.email || "").trim();

  return {
    contact_id: contactId,
    contact_name: contactName || email || `Contacto ${contactId}`,
    email,
    position_title: String(rawContact?.position_title || "").trim(),
  };
}

function normalizeCampaignForm(form) {
  return {
    name: String(form.name || "").trim(),
    description: String(form.description || "").trim() || null,
    tipo_campana: String(form.tipo_campana || "").trim(),
    subtipo_campana: String(form.subtipo_campana || "").trim(),
    estado_campana: String(form.estado_campana || "").trim(),
    etapa_ciclo_vida: String(form.etapa_ciclo_vida || "").trim() || null,
    starts_at: toPayloadDate(form.starts_at),
    ends_at: toPayloadDate(form.ends_at),
  };
}

function getSubtypeCompatibilityLevel(
  policyByType,
  tipoCampana,
  subtipoCampana,
) {
  const tipo = String(tipoCampana || "").trim();
  const subtipo = String(subtipoCampana || "").trim();
  const policy = policyByType?.[tipo] || null;
  if (!policy || !subtipo) {
    return "bloqueado";
  }

  const allowed = Array.isArray(policy.permitido) ? policy.permitido : [];
  const requiresApproval = Array.isArray(policy.permitido_con_aprobacion)
    ? policy.permitido_con_aprobacion
    : [];

  if (allowed.includes(subtipo)) {
    return "permitido";
  }

  if (requiresApproval.includes(subtipo)) {
    return "permitido_con_aprobacion";
  }

  return "bloqueado";
}

function getCompatibleSubtypeOptions(
  policyByType,
  allSubtypeValues,
  tipoCampana,
) {
  const tipo = String(tipoCampana || "").trim();
  const policy = policyByType?.[tipo] || null;
  const catalogValues = Array.isArray(allSubtypeValues) ? allSubtypeValues : [];

  if (!policy) {
    return catalogValues.map((value) => ({
      value,
      nivel: "permitido",
    }));
  }

  return catalogValues
    .map((value) => ({
      value,
      nivel: getSubtypeCompatibilityLevel(policyByType, tipo, value),
    }))
    .filter((entry) => entry.nivel !== "bloqueado");
}

function normalizeCampaignAccountForm(form, lifecycleStage) {
  return {
    account_id: Number(form.account_id),
    etapa_ciclo_vida: String(lifecycleStage || "").trim() || null,
    estado_interaccion: String(form.estado_interaccion || "").trim(),
    last_interaction_at: toPayloadDateTime(form.last_interaction_at),
  };
}

function resolveCampaignStateValue(value, allowedStates) {
  const normalized = String(value || "").trim();
  if (normalized && allowedStates.includes(normalized)) {
    return normalized;
  }
  return allowedStates[0] || EMPTY_FORM.estado_campana;
}

export default function CampaignsPage() {
  const [audienceSortMode, setAudienceSortMode] = useState("name_asc");
  const [catalogs, setCatalogs] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [campaignAccounts, setCampaignAccounts] = useState([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState(null);
  const [campaignForm, setCampaignForm] = useState(EMPTY_FORM);
  const accountForm = EMPTY_ACCOUNT_FORM;
  const [isSavingCampaign, setIsSavingCampaign] = useState(false);
  const [isSavingAccount, setIsSavingAccount] = useState(false);
  const [isLoadingCampaignAccounts, setIsLoadingCampaignAccounts] =
    useState(false);
  const [isLoadingSuggestedAccounts, setIsLoadingSuggestedAccounts] =
    useState(false);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [suggestedAccounts, setSuggestedAccounts] = useState([]);
  const [suggestedAccountsRuleSummary, setSuggestedAccountsRuleSummary] =
    useState("");
  const [suggestedAccountsError, setSuggestedAccountsError] = useState("");
  const [selectedAudienceAccountIds, setSelectedAudienceAccountIds] = useState(
    [],
  );
  const [
    removedAudienceContactsByAccount,
    setRemovedAudienceContactsByAccount,
  ] = useState({});
  const [isAddAccountsModalOpen, setIsAddAccountsModalOpen] = useState(false);
  const [addAccountsSearchText, setAddAccountsSearchText] = useState("");
  const [pendingAddAccountIds, setPendingAddAccountIds] = useState([]);
  const [isAddContactsModalOpen, setIsAddContactsModalOpen] = useState(false);
  const [addContactsAccountId, setAddContactsAccountId] = useState(null);
  const [addContactsSearchText, setAddContactsSearchText] = useState("");
  const [pendingAddContactIds, setPendingAddContactIds] = useState([]);
  const [isLoadingAddContacts, setIsLoadingAddContacts] = useState(false);
  const [addContactsError, setAddContactsError] = useState("");
  const [accountContactsByAccountId, setAccountContactsByAccountId] = useState(
    {},
  );
  const [manuallyAddedContactsByAccount, setManuallyAddedContactsByAccount] =
    useState({});
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [executionTab, setExecutionTab] = useState("landing");
  const [selectedSectorFilters, setSelectedSectorFilters] = useState([]);
  const [sectorFiltersInitialized, setSectorFiltersInitialized] =
    useState(false);
  const [preferSavedAudienceSelection, setPreferSavedAudienceSelection] =
    useState(true);

  const selectedCampaign = useMemo(() => {
    return (
      campaigns.find((campaign) => campaign.id === selectedCampaignId) || null
    );
  }, [campaigns, selectedCampaignId]);
  const selectedTypeDescription =
    CAMPAIGN_TYPE_DESCRIPTIONS[campaignForm.tipo_campana] ||
    "Selecciona el objetivo principal de la campana.";
  const selectedSubtypeDescription =
    CAMPAIGN_SUBTYPE_DESCRIPTIONS[campaignForm.subtipo_campana] ||
    "Selecciona el canal o formato principal de ejecucion de la campana.";
  const compatibilityPolicyByType =
    catalogs?.compatibilidad_tipo_subtipo?.por_tipo || {};
  const compatibleSubtypeOptions = useMemo(
    () =>
      getCompatibleSubtypeOptions(
        compatibilityPolicyByType,
        catalogs?.subtipo_campana,
        campaignForm.tipo_campana,
      ),
    [
      catalogs?.subtipo_campana,
      campaignForm.tipo_campana,
      compatibilityPolicyByType,
    ],
  );
  const visibleCampaignStates = catalogs?.estado_campana || [];
  const savedCampaignAccountIds = useMemo(() => {
    return campaignAccounts
      .map((item) => Number(item.account_id || 0))
      .filter((accountId) => Number.isInteger(accountId) && accountId > 0);
  }, [campaignAccounts]);
  const selectedStateDescription =
    CAMPAIGN_STATE_DESCRIPTIONS[campaignForm.estado_campana] ||
    "Selecciona el estado operativo actual de la campana.";
  const selectedLifecycleDescription = campaignForm.etapa_ciclo_vida
    ? CAMPAIGN_LIFECYCLE_STAGE_DESCRIPTIONS[campaignForm.etapa_ciclo_vida] ||
      "Selecciona la etapa objetivo que quieres mover con esta campana."
    : "Selecciona la etapa objetivo que quieres mover con esta campana.";
  const selectedAudienceLifecycleDescription = campaignForm.etapa_ciclo_vida
    ? CAMPAIGN_LIFECYCLE_STAGE_DESCRIPTIONS[campaignForm.etapa_ciclo_vida] ||
      "Filtra cuentas segun la regla de etapa seleccionada."
    : "Sin definir muestra todas las cuentas activas y sus contactos activos.";
  const selectedAudienceLifecycleLabel = campaignForm.etapa_ciclo_vida
    ? formatCampaignTypeLabel(campaignForm.etapa_ciclo_vida)
    : "Sin definir";
  const sectorOptions = useMemo(() => {
    const unique = Array.from(
      new Set(
        accounts
          .map((account) => String(account?.economic_sector || "").trim())
          .filter(Boolean),
      ),
    );
    return unique.sort((first, second) =>
      first.localeCompare(second, "es", {
        sensitivity: "base",
      }),
    );
  }, [accounts]);
  const selectedSectorFilterSet = useMemo(() => {
    return new Set(
      selectedSectorFilters
        .map((sector) => String(sector || "").trim())
        .filter(Boolean),
    );
  }, [selectedSectorFilters]);
  useEffect(() => {
    if (sectorFiltersInitialized) return;
    if (!sectorOptions.length) return;

    const excludedSectors = new Set([
      "proveedor",
      "proveedores",
      "integrador",
      "integradores",
    ]);

    const defaultSelection = sectorOptions.filter(
      (sector) => !excludedSectors.has(normalizeSectorValue(sector)),
    );

    setSelectedSectorFilters(defaultSelection);
    setSectorFiltersInitialized(true);
  }, [sectorFiltersInitialized, sectorOptions]);
  const accountSectorById = useMemo(() => {
    const map = new Map();
    accounts.forEach((account) => {
      const accountId = Number(account?.id || 0);
      if (!Number.isInteger(accountId) || accountId <= 0) return;
      map.set(accountId, String(account?.economic_sector || "").trim());
    });
    return map;
  }, [accounts]);
  const filteredAudienceAccounts = useMemo(() => {
    if (!campaignForm.etapa_ciclo_vida) {
      if (suggestedAccounts.length > 0) {
        return suggestedAccounts;
      }

      return accounts.map((account) => ({
        account_id: Number(account.id),
        account_name: account.name || "",
        total_opportunities: null,
        open_opportunities: null,
        won_opportunities: null,
        contacts: [],
      }));
    }

    return suggestedAccounts;
  }, [campaignForm.etapa_ciclo_vida, accounts, suggestedAccounts]);
  const filteredAudienceAccountsBySector = useMemo(() => {
    if (!selectedSectorFilterSet.size) {
      return filteredAudienceAccounts;
    }

    return filteredAudienceAccounts.filter((item) => {
      const accountId = Number(item?.account_id || 0);
      const sector = String(
        item?.economic_sector || accountSectorById.get(accountId) || "",
      ).trim();
      return selectedSectorFilterSet.has(sector);
    });
  }, [accountSectorById, filteredAudienceAccounts, selectedSectorFilterSet]);
  const suggestedContactsCount = useMemo(() => {
    return filteredAudienceAccountsBySector.reduce((total, item) => {
      const accountId = Number(item.account_id || 0);
      const removedContactIds =
        removedAudienceContactsByAccount[accountId] || [];
      const visibleContacts = Array.isArray(item.contacts)
        ? item.contacts.filter((contact) => {
            const contactId = Number(contact?.contact_id || 0);
            return !removedContactIds.includes(contactId);
          })
        : [];

      return total + visibleContacts.length;
    }, 0);
  }, [filteredAudienceAccountsBySector, removedAudienceContactsByAccount]);
  const filteredAudienceAccountsById = useMemo(() => {
    const map = new Map();
    filteredAudienceAccountsBySector.forEach((item) => {
      const accountId = Number(item.account_id || 0);
      if (Number.isInteger(accountId) && accountId > 0) {
        map.set(accountId, item);
      }
    });
    return map;
  }, [filteredAudienceAccountsBySector]);
  const accountsById = useMemo(() => {
    const map = new Map();
    accounts.forEach((account) => {
      const accountId = Number(account.id || 0);
      if (Number.isInteger(accountId) && accountId > 0) {
        map.set(accountId, {
          account_id: accountId,
          account_name: String(account.name || "").trim(),
          economic_sector: String(account.economic_sector || "").trim(),
          total_opportunities: null,
          open_opportunities: null,
          won_opportunities: null,
          contacts: [],
        });
      }
    });
    return map;
  }, [accounts]);
  const campaignAccountsById = useMemo(() => {
    const map = new Map();
    campaignAccounts.forEach((item) => {
      const accountId = Number(item.account_id || 0);
      if (Number.isInteger(accountId) && accountId > 0) {
        map.set(accountId, item);
      }
    });
    return map;
  }, [campaignAccounts]);
  const visibleAudienceAccounts = useMemo(() => {
    const selectedUniqueIds = Array.from(
      new Set(
        selectedAudienceAccountIds
          .map((accountId) => Number(accountId || 0))
          .filter((accountId) => Number.isInteger(accountId) && accountId > 0),
      ),
    );

    return selectedUniqueIds
      .map((accountId) => {
        const savedAccount = campaignAccountsById.get(accountId);
        const suggestedAccount = filteredAudienceAccountsById.get(accountId);
        const accountCatalog = accountsById.get(accountId);
        if (savedAccount || suggestedAccount || accountCatalog) {
          const mergedContactsById = new Map();
          [
            ...(Array.isArray(suggestedAccount?.contacts)
              ? suggestedAccount.contacts
              : []),
            ...(Array.isArray(savedAccount?.contacts)
              ? savedAccount.contacts
              : []),
            ...(Array.isArray(accountCatalog?.contacts)
              ? accountCatalog.contacts
              : []),
          ].forEach((contact) => {
            const normalizedContact = normalizeAudienceContact(contact);
            if (!normalizedContact) return;
            mergedContactsById.set(
              Number(normalizedContact.contact_id),
              normalizedContact,
            );
          });

          return {
            ...(accountCatalog || {}),
            ...(suggestedAccount || {}),
            ...(savedAccount || {}),
            economic_sector: String(
              savedAccount?.economic_sector ||
                suggestedAccount?.economic_sector ||
                accountCatalog?.economic_sector ||
                "",
            ).trim(),
            contacts: Array.from(mergedContactsById.values()),
          };
        }
        return null;
      })
      .filter(Boolean);
  }, [
    selectedAudienceAccountIds,
    campaignAccountsById,
    filteredAudienceAccountsById,
    accountsById,
  ]);
  const availableAccountsBase = useMemo(() => {
    const selectedSet = new Set(
      selectedAudienceAccountIds
        .map((accountId) => Number(accountId || 0))
        .filter((accountId) => Number.isInteger(accountId) && accountId > 0),
    );

    return accounts
      .filter((account) => isActiveAccount(account))
      .map((account) => ({
        account_id: Number(account.id || 0),
        account_name: String(account.name || "").trim(),
      }))
      .filter(
        (account) =>
          Number.isInteger(account.account_id) &&
          account.account_id > 0 &&
          account.account_name &&
          !selectedSet.has(account.account_id),
      )
      .sort((first, second) =>
        first.account_name.localeCompare(second.account_name, "es", {
          sensitivity: "base",
        }),
      );
  }, [accounts, selectedAudienceAccountIds]);
  const availableAccountsToAdd = useMemo(() => {
    const query = String(addAccountsSearchText || "")
      .trim()
      .toLowerCase();
    if (!query) return availableAccountsBase;

    return availableAccountsBase.filter((item) =>
      String(item.account_name || "")
        .trim()
        .toLowerCase()
        .includes(query),
    );
  }, [addAccountsSearchText, availableAccountsBase]);
  const visibleContactsByAccountId = useMemo(() => {
    const map = new Map();

    visibleAudienceAccounts.forEach((item) => {
      const accountId = Number(item.account_id || 0);
      if (!Number.isInteger(accountId) || accountId <= 0) return;

      const baseContacts = Array.isArray(item.contacts)
        ? item.contacts.map((contact) => normalizeAudienceContact(contact))
        : [];
      const manualContacts = Array.isArray(
        manuallyAddedContactsByAccount[accountId],
      )
        ? manuallyAddedContactsByAccount[accountId].map((contact) =>
            normalizeAudienceContact(contact),
          )
        : [];
      const merged = [...baseContacts, ...manualContacts].filter(Boolean);
      const byId = new Map();
      merged.forEach((contact) => {
        byId.set(Number(contact.contact_id), contact);
      });

      const removedSet = new Set(
        (removedAudienceContactsByAccount[accountId] || []).map((contactId) =>
          Number(contactId || 0),
        ),
      );
      const visible = Array.from(byId.values()).filter(
        (contact) => !removedSet.has(Number(contact.contact_id || 0)),
      );
      map.set(accountId, visible);
    });

    return map;
  }, [
    manuallyAddedContactsByAccount,
    removedAudienceContactsByAccount,
    visibleAudienceAccounts,
  ]);
  const visibleAudienceAccountsWithContacts = useMemo(() => {
    return visibleAudienceAccounts.filter((item) => {
      const accountId = Number(item.account_id || 0);
      if (!Number.isInteger(accountId) || accountId <= 0) return false;
      return (visibleContactsByAccountId.get(accountId) || []).length > 0;
    });
  }, [visibleAudienceAccounts, visibleContactsByAccountId]);
  const sortedVisibleAudienceAccounts = useMemo(() => {
    const items = [...visibleAudienceAccountsWithContacts];

    items.sort((first, second) => {
      if (audienceSortMode === "name_desc") {
        return String(second.account_name || "").localeCompare(
          String(first.account_name || ""),
          "es",
          { sensitivity: "base" },
        );
      }

      if (audienceSortMode === "sector_asc") {
        const sectorCompare = String(first.economic_sector || "").localeCompare(
          String(second.economic_sector || ""),
          "es",
          { sensitivity: "base" },
        );
        if (sectorCompare !== 0) return sectorCompare;
      }

      if (audienceSortMode === "sector_desc") {
        const sectorCompare = String(
          second.economic_sector || "",
        ).localeCompare(String(first.economic_sector || ""), "es", {
          sensitivity: "base",
        });
        if (sectorCompare !== 0) return sectorCompare;
      }

      return String(first.account_name || "").localeCompare(
        String(second.account_name || ""),
        "es",
        { sensitivity: "base" },
      );
    });

    return items;
  }, [audienceSortMode, visibleAudienceAccountsWithContacts]);
  const addContactsAccount = useMemo(() => {
    const targetId = Number(addContactsAccountId || 0);
    if (!targetId) return null;
    return (
      visibleAudienceAccounts.find(
        (item) => Number(item.account_id || 0) === targetId,
      ) || null
    );
  }, [addContactsAccountId, visibleAudienceAccounts]);
  const addContactsAllById = useMemo(() => {
    if (!addContactsAccount) return new Map();

    const accountId = Number(addContactsAccount.account_id || 0);
    const fromSuggested = Array.isArray(addContactsAccount.contacts)
      ? addContactsAccount.contacts
      : [];
    const fromApi = Array.isArray(accountContactsByAccountId[accountId])
      ? accountContactsByAccountId[accountId]
      : [];
    const fromManual = Array.isArray(manuallyAddedContactsByAccount[accountId])
      ? manuallyAddedContactsByAccount[accountId]
      : [];
    const map = new Map();

    [...fromApi, ...fromSuggested, ...fromManual].forEach((contact) => {
      const normalized = normalizeAudienceContact(contact);
      if (!normalized) return;
      map.set(Number(normalized.contact_id), normalized);
    });

    return map;
  }, [
    addContactsAccount,
    accountContactsByAccountId,
    manuallyAddedContactsByAccount,
  ]);
  const availableContactsToAdd = useMemo(() => {
    if (!addContactsAccount) return [];

    const accountId = Number(addContactsAccount.account_id || 0);
    const visibleSet = new Set(
      (visibleContactsByAccountId.get(accountId) || []).map((contact) =>
        Number(contact?.contact_id || 0),
      ),
    );
    const query = String(addContactsSearchText || "")
      .trim()
      .toLowerCase();

    return Array.from(addContactsAllById.values())
      .filter((contact) => !visibleSet.has(Number(contact?.contact_id || 0)))
      .filter((contact) => {
        if (!query) return true;
        const label = String(contact?.contact_name || "").toLowerCase();
        const email = String(contact?.email || "").toLowerCase();
        return label.includes(query) || email.includes(query);
      })
      .sort((first, second) =>
        String(first?.contact_name || "").localeCompare(
          String(second?.contact_name || ""),
          "es",
          { sensitivity: "base" },
        ),
      );
  }, [
    addContactsAllById,
    addContactsAccount,
    addContactsSearchText,
    visibleContactsByAccountId,
  ]);

  useEffect(() => {
    let mounted = true;

    async function loadInitialData() {
      setIsLoadingData(true);
      setError("");

      try {
        const [catalogsResponse, campaignsResponse, accountsResponse] =
          await Promise.all([
            api.get("/api/campaigns/catalogs"),
            api.get("/api/campaigns"),
            api.get("/api/accounts", {
              params: { activeOnly: true },
            }),
          ]);

        if (!mounted) return;

        const catalogsData = catalogsResponse.data || {};
        const campaignsData = Array.isArray(campaignsResponse.data?.items)
          ? campaignsResponse.data.items
          : [];
        const accountsData = Array.isArray(accountsResponse.data)
          ? accountsResponse.data
          : [];

        setCatalogs(catalogsData);
        setCampaigns(campaignsData);
        setAccounts(accountsData.filter((account) => isActiveAccount(account)));

        if (campaignsData.length > 0) {
          const visibleStates = catalogsData.estado_campana || [];
          setSelectedCampaignId(campaignsData[0].id);
          setCampaignForm({
            name: campaignsData[0].name || "",
            description: campaignsData[0].description || "",
            tipo_campana: campaignsData[0].tipo_campana || "",
            subtipo_campana: campaignsData[0].subtipo_campana || "",
            estado_campana: resolveCampaignStateValue(
              campaignsData[0].estado_campana,
              visibleStates,
            ),
            etapa_ciclo_vida: campaignsData[0].etapa_ciclo_vida || "",
            starts_at: toDateInputValue(campaignsData[0].starts_at),
            ends_at: toDateInputValue(campaignsData[0].ends_at),
          });
        }
      } catch (requestError) {
        if (mounted) {
          setError(
            getApiErrorMessage(requestError, "No fue posible cargar campañas"),
          );
        }
      } finally {
        if (mounted) {
          setIsLoadingData(false);
        }
      }
    }

    loadInitialData();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadCampaignAccounts() {
      if (!selectedCampaignId) {
        setCampaignAccounts([]);
        return;
      }

      setIsLoadingCampaignAccounts(true);
      setError("");

      try {
        const { data } = await api.get(
          `/api/campaigns/${selectedCampaignId}/accounts`,
        );
        if (!mounted) return;

        setCampaignAccounts(Array.isArray(data?.items) ? data.items : []);
      } catch (requestError) {
        if (mounted) {
          setError(
            getApiErrorMessage(
              requestError,
              "No fue posible cargar la audiencia por cuenta",
            ),
          );
        }
      } finally {
        if (mounted) {
          setIsLoadingCampaignAccounts(false);
        }
      }
    }

    loadCampaignAccounts();

    return () => {
      mounted = false;
    };
  }, [selectedCampaignId]);

  useEffect(() => {
    if (preferSavedAudienceSelection && savedCampaignAccountIds.length > 0) {
      setSelectedAudienceAccountIds(savedCampaignAccountIds);
      return;
    }

    setSelectedAudienceAccountIds(
      filteredAudienceAccountsBySector
        .map((item) => Number(item.account_id || 0))
        .filter((accountId) => Number.isInteger(accountId) && accountId > 0),
    );
  }, [
    filteredAudienceAccountsBySector,
    preferSavedAudienceSelection,
    savedCampaignAccountIds,
  ]);

  useEffect(() => {
    setRemovedAudienceContactsByAccount({});
    setManuallyAddedContactsByAccount({});
  }, [campaignForm.etapa_ciclo_vida]);

  useEffect(() => {
    if (isAddAccountsModalOpen) return;
    setAddAccountsSearchText("");
    setPendingAddAccountIds([]);
  }, [isAddAccountsModalOpen]);

  useEffect(() => {
    if (isAddContactsModalOpen) return;
    setAddContactsSearchText("");
    setPendingAddContactIds([]);
    setAddContactsError("");
    setAddContactsAccountId(null);
  }, [isAddContactsModalOpen]);

  useEffect(() => {
    if (!isAddContactsModalOpen) return;
    if (!addContactsAccount) {
      setIsAddContactsModalOpen(false);
    }
  }, [addContactsAccount, isAddContactsModalOpen]);

  useEffect(() => {
    if (!isAddContactsModalOpen) return;
    const accountId = Number(addContactsAccountId || 0);
    if (!Number.isInteger(accountId) || accountId <= 0) return;

    let mounted = true;

    async function loadContactsForAccount() {
      setIsLoadingAddContacts(true);
      setAddContactsError("");

      try {
        const { data } = await api.get("/api/contacts", {
          params: { accountId, activeOnly: true },
        });
        if (!mounted) return;

        const items = Array.isArray(data) ? data : [];
        const normalized = items
          .map((contact) => normalizeAudienceContact(contact))
          .filter(Boolean);

        setAccountContactsByAccountId((previous) => ({
          ...previous,
          [accountId]: normalized,
        }));
      } catch (requestError) {
        if (!mounted) return;
        setAddContactsError(
          getApiErrorMessage(
            requestError,
            "No fue posible cargar los contactos de la cuenta",
          ),
        );
      } finally {
        if (mounted) {
          setIsLoadingAddContacts(false);
        }
      }
    }

    loadContactsForAccount();

    return () => {
      mounted = false;
    };
  }, [addContactsAccountId, isAddContactsModalOpen]);

  useEffect(() => {
    let mounted = true;

    async function loadSuggestedAccountsByLifecycle() {
      const lifecycleStage = String(campaignForm.etapa_ciclo_vida || "").trim();
      setIsLoadingSuggestedAccounts(true);
      setSuggestedAccountsError("");

      try {
        const requestConfig = lifecycleStage
          ? { params: { etapa_ciclo_vida: lifecycleStage } }
          : undefined;
        const { data } = await api.get(
          "/api/campaigns/accounts/suggestions",
          requestConfig,
        );

        if (!mounted) return;

        const items = Array.isArray(data?.items) ? data.items : [];
        setSuggestedAccounts(items);
        setSuggestedAccountsRuleSummary(String(data?.ruleSummary || ""));
      } catch (requestError) {
        if (!mounted) return;
        setSuggestedAccounts([]);
        setSuggestedAccountsRuleSummary("");
        setSuggestedAccountsError(
          getApiErrorMessage(
            requestError,
            "No fue posible calcular cuentas sugeridas por etapa",
          ),
        );
      } finally {
        if (mounted) {
          setIsLoadingSuggestedAccounts(false);
        }
      }
    }

    loadSuggestedAccountsByLifecycle();

    return () => {
      mounted = false;
    };
  }, [campaignForm.etapa_ciclo_vida]);

  useEffect(() => {
    if (!compatibleSubtypeOptions.length) return;

    const currentSubtype = String(campaignForm.subtipo_campana || "").trim();
    if (
      compatibleSubtypeOptions.some((entry) => entry.value === currentSubtype)
    ) {
      return;
    }

    setCampaignForm((previous) => ({
      ...previous,
      subtipo_campana: compatibleSubtypeOptions[0].value,
    }));
  }, [campaignForm.subtipo_campana, compatibleSubtypeOptions]);

  function startNewCampaign() {
    setSelectedCampaignId(null);
    setPreferSavedAudienceSelection(true);
    setCampaignForm({
      ...EMPTY_FORM,
      tipo_campana: catalogs?.tipo_campana?.[0] || EMPTY_FORM.tipo_campana,
      subtipo_campana:
        catalogs?.subtipo_campana?.[0] || EMPTY_FORM.subtipo_campana,
      estado_campana: resolveCampaignStateValue(
        EMPTY_FORM.estado_campana,
        visibleCampaignStates,
      ),
    });
    setFeedback("");
    setError("");
  }

  function selectCampaign(campaign) {
    setPreferSavedAudienceSelection(true);
    setSelectedCampaignId(campaign.id);
    setCampaignForm({
      name: campaign.name || "",
      description: campaign.description || "",
      tipo_campana: campaign.tipo_campana || "",
      subtipo_campana: campaign.subtipo_campana || "",
      estado_campana: resolveCampaignStateValue(
        campaign.estado_campana,
        visibleCampaignStates,
      ),
      etapa_ciclo_vida: campaign.etapa_ciclo_vida || "",
      starts_at: toDateInputValue(campaign.starts_at),
      ends_at: toDateInputValue(campaign.ends_at),
    });
    setFeedback("");
    setError("");
  }

  function handleLifecycleStageChange(nextValue) {
    const nextStage = String(nextValue || "").trim();
    const currentStage = String(campaignForm.etapa_ciclo_vida || "").trim();
    if (nextStage === currentStage) return;

    const hasSavedAudience =
      preferSavedAudienceSelection && savedCampaignAccountIds.length > 0;

    if (hasSavedAudience) {
      const confirmed = window.confirm(
        "Esta campana ya tiene una audiencia guardada. Si cambias la etapa de ciclo de vida objetivo, la lista de cuentas cambiara segun la nueva seleccion sugerida. ¿Deseas continuar?",
      );
      if (!confirmed) {
        return;
      }

      setPreferSavedAudienceSelection(false);
      setCampaignAccounts([]);
      setSelectedAudienceAccountIds([]);
      setRemovedAudienceContactsByAccount({});
      setManuallyAddedContactsByAccount({});
      setFeedback(
        "Se cambio la etapa de ciclo de vida. Revisa y guarda la nueva audiencia sugerida.",
      );
      setError("");
    }

    setCampaignForm((previous) => ({
      ...previous,
      etapa_ciclo_vida: nextStage,
    }));
  }

  async function handleSaveCampaign(event) {
    event.preventDefault();

    setIsSavingCampaign(true);
    setError("");
    setFeedback("");

    try {
      const payload = normalizeCampaignForm(campaignForm);
      let savedCampaign = null;

      if (selectedCampaignId) {
        const response = await api.patch(
          `/api/campaigns/${selectedCampaignId}`,
          payload,
        );
        savedCampaign = response.data?.campaign || null;
      } else {
        const response = await api.post("/api/campaigns", payload);
        savedCampaign = response.data?.campaign || null;
      }

      if (!savedCampaign) {
        throw new Error("No se recibio la campana guardada");
      }

      setCampaigns((previous) => {
        const withoutCurrent = previous.filter(
          (item) => item.id !== savedCampaign.id,
        );
        return [savedCampaign, ...withoutCurrent];
      });
      setSelectedCampaignId(savedCampaign.id);
      setCampaignForm({
        name: savedCampaign.name || "",
        description: savedCampaign.description || "",
        tipo_campana: savedCampaign.tipo_campana || "",
        subtipo_campana: savedCampaign.subtipo_campana || "",
        estado_campana: resolveCampaignStateValue(
          savedCampaign.estado_campana,
          visibleCampaignStates,
        ),
        etapa_ciclo_vida: savedCampaign.etapa_ciclo_vida || "",
        starts_at: toDateInputValue(savedCampaign.starts_at),
        ends_at: toDateInputValue(savedCampaign.ends_at),
      });
      setFeedback(
        selectedCampaignId ? "Campaña actualizada" : "Campaña creada",
      );
    } catch (requestError) {
      setError(
        getApiErrorMessage(requestError, "No fue posible guardar la campaña"),
      );
    } finally {
      setIsSavingCampaign(false);
    }
  }

  async function handleSaveCampaignAccount(event) {
    event.preventDefault();

    if (!selectedCampaignId) {
      setError("Primero crea o selecciona una campaña");
      return;
    }

    setIsSavingAccount(true);
    setError("");
    setFeedback("");

    try {
      const selectedIds = selectedAudienceAccountIds
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
        .filter((accountId) => {
          return (visibleContactsByAccountId.get(accountId) || []).length > 0;
        });
      if (!selectedIds.length) {
        throw new Error(
          "Selecciona al menos una cuenta que tenga por lo menos un contacto",
        );
      }

      const payload = normalizeCampaignAccountForm(
        accountForm,
        campaignForm.etapa_ciclo_vida,
      );

      const responses = await Promise.all(
        selectedIds.map((accountId) =>
          api.patch(
            `/api/campaigns/${selectedCampaignId}/accounts/${accountId}`,
            {
              etapa_ciclo_vida: payload.etapa_ciclo_vida,
              estado_interaccion: payload.estado_interaccion,
              contact_ids: (visibleContactsByAccountId.get(accountId) || [])
                .map((contact) => Number(contact?.contact_id || 0))
                .filter(
                  (contactId) => Number.isInteger(contactId) && contactId > 0,
                ),
              last_interaction_at: payload.last_interaction_at,
            },
          ),
        ),
      );

      const savedItems = responses
        .map((response) => response?.data?.item)
        .filter(Boolean);
      if (!savedItems.length) {
        throw new Error("No se recibieron registros de audiencia guardados");
      }

      setCampaignAccounts((previous) => {
        const idsSet = new Set(
          savedItems.map((item) => Number(item.account_id)),
        );
        const withoutUpdated = previous.filter(
          (existing) => !idsSet.has(Number(existing.account_id)),
        );
        return [...savedItems, ...withoutUpdated];
      });
      setFeedback(
        `${savedItems.length} cuentas incluidas/actualizadas en la campaña`,
      );
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible guardar la cuenta en la campaña",
        ),
      );
    } finally {
      setIsSavingAccount(false);
    }
  }

  if (isLoadingData) {
    return (
      <section className="campaigns-page">
        <p>Cargando campañas...</p>
      </section>
    );
  }

  return (
    <section className="campaigns-page">
      <header className="campaigns-header">
        <div>
          <h2>Campañas</h2>
          <p>
            Gestiona la taxonomía de campañas y su avance por cuenta para
            conectar marketing con el ciclo de vida comercial.
          </p>
        </div>
        <div className="campaigns-header-actions">
          <span className="campaigns-counter">{campaigns.length} campañas</span>
          <button
            type="button"
            className="btn-secondary"
            onClick={startNewCampaign}
          >
            Nueva campaña
          </button>
        </div>
      </header>

      {error ? (
        <p className="campaigns-alert campaigns-alert-error">{error}</p>
      ) : null}
      {feedback ? (
        <p className="campaigns-alert campaigns-alert-success">{feedback}</p>
      ) : null}

      <div className="campaigns-layout">
        <aside className="campaigns-sidebar">
          <div className="campaigns-sidebar-head">
            <h3>Listado</h3>
            <small>{campaigns.length} registros</small>
          </div>
          <ul>
            {campaigns.map((campaign) => {
              const isSelected = campaign.id === selectedCampaignId;
              return (
                <li key={campaign.id}>
                  <button
                    type="button"
                    className={isSelected ? "is-selected" : ""}
                    onClick={() => selectCampaign(campaign)}
                  >
                    <strong>{campaign.name}</strong>
                    <span>
                      {formatCampaignTypeLabel(campaign.subtipo_campana)}
                    </span>
                    <div className="campaigns-sidebar-meta">
                      <small className="campaigns-chip">
                        {formatCampaignTypeLabel(campaign.tipo_campana)}
                      </small>
                      <small className="campaigns-chip campaigns-chip-state">
                        {formatCampaignTypeLabel(campaign.estado_campana)}
                      </small>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <main className="campaigns-main">
          <form className="card" onSubmit={handleSaveCampaign}>
            <h3>{selectedCampaign ? "Editar campaña" : "Crear campaña"}</h3>
            <div className="campaigns-form-sections">
              <div className="campaigns-form-section">
                <div className="campaigns-section-title">Identidad</div>
                <div className="campaigns-grid campaigns-grid-single">
                  <label>
                    Nombre
                    <input
                      value={campaignForm.name}
                      onChange={(event) =>
                        setCampaignForm((previous) => ({
                          ...previous,
                          name: event.target.value,
                        }))
                      }
                      required
                      placeholder="Ej. Campaña de webinar Q3"
                    />
                  </label>
                </div>
              </div>

              <div className="campaigns-form-section">
                <div className="campaigns-section-title">Clasificación</div>
                <div className="campaigns-grid">
                  <label>
                    Tipo
                    <select
                      value={campaignForm.tipo_campana}
                      onChange={(event) =>
                        setCampaignForm((previous) => ({
                          ...previous,
                          tipo_campana: event.target.value,
                        }))
                      }
                    >
                      {(catalogs?.tipo_campana || []).map((value) => (
                        <option key={value} value={value}>
                          {`${formatCampaignTypeLabel(value)} - ${CAMPAIGN_TYPE_DESCRIPTIONS[value] || "Sin descripcion"}`}
                        </option>
                      ))}
                    </select>
                    <small className="campaigns-field-help">
                      {selectedTypeDescription}
                    </small>
                  </label>
                  <label>
                    Subtipo
                    <div className="campaigns-subtype-options">
                      {compatibleSubtypeOptions.map((entry) => {
                        const value = entry.value;
                        const levelClass =
                          entry.nivel === "permitido"
                            ? "is-priority"
                            : "is-secondary";
                        const isSelected =
                          String(campaignForm.subtipo_campana || "") === value;

                        return (
                          <button
                            key={value}
                            type="button"
                            className={`campaigns-subtype-option ${levelClass} ${
                              isSelected ? "is-selected" : ""
                            }`}
                            aria-pressed={isSelected}
                            onClick={() =>
                              setCampaignForm((previous) => ({
                                ...previous,
                                subtipo_campana: value,
                              }))
                            }
                          >
                            <span>{formatCampaignTypeLabel(value)}</span>
                            {isSelected ? (
                              <small className="campaigns-subtype-selected-tag">
                                Seleccionado
                              </small>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                    <div className="campaigns-subtype-legend">
                      <span className="campaigns-subtype-legend-item is-priority">
                        Prioritaria
                      </span>
                      <span className="campaigns-subtype-legend-item is-secondary">
                        Secundaria
                      </span>
                    </div>
                    <small className="campaigns-field-help">
                      {selectedSubtypeDescription}
                    </small>
                  </label>
                  <label>
                    Estado
                    <select
                      value={campaignForm.estado_campana}
                      onChange={(event) =>
                        setCampaignForm((previous) => ({
                          ...previous,
                          estado_campana: event.target.value,
                        }))
                      }
                    >
                      {visibleCampaignStates.map((value) => (
                        <option key={value} value={value}>
                          {`${formatCampaignTypeLabel(value)} - ${CAMPAIGN_STATE_DESCRIPTIONS[value] || "Sin descripcion"}`}
                        </option>
                      ))}
                    </select>
                    <small className="campaigns-field-help">
                      {selectedStateDescription}
                    </small>
                  </label>
                  <label>
                    Etapa ciclo de vida objetivo
                    <select
                      value={campaignForm.etapa_ciclo_vida}
                      onChange={(event) =>
                        handleLifecycleStageChange(event.target.value)
                      }
                    >
                      <option value="">Sin definir</option>
                      {(catalogs?.etapa_ciclo_vida || []).map((value) => (
                        <option key={value} value={value}>
                          {`${formatCampaignTypeLabel(value)} - ${CAMPAIGN_LIFECYCLE_STAGE_DESCRIPTIONS[value] || "Sin descripcion"}`}
                        </option>
                      ))}
                    </select>
                    <small className="campaigns-field-help">
                      {selectedLifecycleDescription}
                    </small>
                  </label>
                  <div className="campaigns-grid-wide campaigns-subsection-block">
                    <div className="campaigns-subsection-title">
                      Filtro por sector de cuenta
                    </div>
                    <div className="campaigns-sector-filter">
                      {sectorOptions.length === 0 ? (
                        <small className="campaigns-field-help">
                          Sin sectores disponibles.
                        </small>
                      ) : (
                        sectorOptions.map((sector) => {
                          const isSelected = selectedSectorFilterSet.has(
                            String(sector || "").trim(),
                          );
                          return (
                            <label
                              key={sector}
                              className={`campaigns-sector-filter-item ${
                                isSelected ? "is-selected" : ""
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => {
                                  setSelectedSectorFilters((previous) => {
                                    const normalized = String(
                                      sector || "",
                                    ).trim();
                                    if (isSelected) {
                                      return previous.filter(
                                        (value) =>
                                          String(value || "").trim() !==
                                          normalized,
                                      );
                                    }
                                    return [...previous, normalized];
                                  });
                                }}
                              />
                              <span>{sector}</span>
                            </label>
                          );
                        })
                      )}
                    </div>
                    <small className="campaigns-field-help">
                      Puedes elegir una o varias opciones de sector para filtrar
                      las cuentas en Audiencia. Por defecto se seleccionan todos
                      excepto Proveedor e Integrador.
                    </small>
                  </div>
                </div>
              </div>

              <div className="campaigns-form-section">
                <div className="campaigns-section-title">Calendario</div>
                <div className="campaigns-grid">
                  <label>
                    Inicio
                    <input
                      type="date"
                      value={campaignForm.starts_at}
                      onChange={(event) =>
                        setCampaignForm((previous) => ({
                          ...previous,
                          starts_at: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Fin
                    <input
                      type="date"
                      value={campaignForm.ends_at}
                      onChange={(event) =>
                        setCampaignForm((previous) => ({
                          ...previous,
                          ends_at: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
              </div>

              <div className="campaigns-form-section">
                <div className="campaigns-section-title">Narrativa</div>
                <div className="campaigns-grid campaigns-grid-single">
                  <label className="campaigns-grid-wide">
                    Descripción
                    <textarea
                      rows={3}
                      value={campaignForm.description}
                      onChange={(event) =>
                        setCampaignForm((previous) => ({
                          ...previous,
                          description: event.target.value,
                        }))
                      }
                      placeholder="Resume objetivo, mensaje y publico esperado"
                    />
                  </label>
                </div>
              </div>
            </div>
            <div className="campaigns-actions campaigns-actions-sticky">
              <button
                type="submit"
                className="btn-primary"
                disabled={isSavingCampaign}
              >
                {isSavingCampaign
                  ? "Guardando campaña..."
                  : "Guardar datos de campaña"}
              </button>
            </div>
          </form>

          <section className="card">
            <h3>Audiencia</h3>
            <form
              className="campaigns-grid"
              onSubmit={handleSaveCampaignAccount}
            >
              <div className="campaigns-grid-wide">
                <small className="campaigns-field-help">
                  Etapa seleccionada: {selectedAudienceLifecycleLabel}
                </small>
                <small className="campaigns-field-help">
                  {selectedAudienceLifecycleDescription}
                </small>
                <div className="campaigns-audience-list-wrap">
                  <div className="campaigns-audience-list-head">
                    <div className="campaigns-audience-title-row">
                      <strong>
                        Cuentas sugeridas:{" "}
                        {filteredAudienceAccountsBySector.length} · Contactos
                        sugeridos: {suggestedContactsCount}
                      </strong>
                      <button
                        type="button"
                        className="campaigns-audience-add-icon"
                        title="Abrir modal para anadir cuentas"
                        aria-label="Abrir modal para anadir cuentas"
                        disabled={availableAccountsBase.length === 0}
                        onClick={() => {
                          setIsAddAccountsModalOpen(true);
                        }}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                          focusable="false"
                        >
                          <path
                            d="M12 5v14M5 12h14"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </div>
                    <div className="campaigns-audience-tools">
                      <label className="campaigns-audience-sort">
                        <span>Ordenar</span>
                        <select
                          value={audienceSortMode}
                          onChange={(event) =>
                            setAudienceSortMode(event.target.value)
                          }
                        >
                          <option value="name_asc">Nombre A-Z</option>
                          <option value="name_desc">Nombre Z-A</option>
                          <option value="sector_asc">Sector A-Z</option>
                          <option value="sector_desc">Sector Z-A</option>
                        </select>
                      </label>
                      <small>
                        Seleccionadas con contacto:{" "}
                        {sortedVisibleAudienceAccounts.length}
                      </small>
                    </div>
                  </div>

                  {campaignForm.etapa_ciclo_vida &&
                  suggestedAccountsRuleSummary ? (
                    <p className="campaigns-field-help campaigns-audience-rule">
                      {suggestedAccountsRuleSummary}
                    </p>
                  ) : null}

                  {isLoadingSuggestedAccounts ? (
                    <p className="campaigns-empty">Calculando sugerencias...</p>
                  ) : null}

                  {!isLoadingSuggestedAccounts && suggestedAccountsError ? (
                    <p className="campaigns-alert campaigns-alert-error">
                      {suggestedAccountsError}
                    </p>
                  ) : null}

                  {!isLoadingSuggestedAccounts &&
                  !suggestedAccountsError &&
                  visibleAudienceAccountsWithContacts.length === 0 ? (
                    <p className="campaigns-empty">
                      No hay cuentas seleccionadas con contactos. Usa el icono
                      de anadir para recuperar cuentas y contactos.
                    </p>
                  ) : null}

                  {!isLoadingSuggestedAccounts &&
                  !suggestedAccountsError &&
                  visibleAudienceAccountsWithContacts.length > 0 ? (
                    <div className="campaigns-account-checklist">
                      {sortedVisibleAudienceAccounts.map((item) => {
                        const accountId = Number(item.account_id);
                        const visibleContacts =
                          visibleContactsByAccountId.get(accountId) || [];
                        return (
                          <label
                            key={accountId}
                            className="campaigns-account-check-item"
                          >
                            <div className="campaigns-account-check-main">
                              <div className="campaigns-account-check-head">
                                <div className="campaigns-account-title-wrap">
                                  <strong>{item.account_name}</strong>
                                  {String(item.economic_sector || "").trim() ? (
                                    <span className="campaigns-mini-badge campaigns-mini-badge-sector">
                                      {String(
                                        item.economic_sector || "",
                                      ).trim()}
                                    </span>
                                  ) : null}
                                </div>
                                <div className="campaigns-account-check-actions">
                                  <button
                                    type="button"
                                    className="campaigns-add-contact-icon"
                                    title="Adicionar contactos"
                                    aria-label="Adicionar contactos"
                                    onClick={() => {
                                      setAddContactsAccountId(accountId);
                                      setIsAddContactsModalOpen(true);
                                    }}
                                  >
                                    <svg
                                      viewBox="0 0 24 24"
                                      width="16"
                                      height="16"
                                      fill="none"
                                      aria-hidden="true"
                                      focusable="false"
                                      style={{ display: "block" }}
                                    >
                                      <path
                                        d="M12 5v14M5 12h14"
                                        stroke="currentColor"
                                        strokeWidth="2.2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      />
                                    </svg>
                                  </button>
                                  <button
                                    type="button"
                                    className="campaigns-remove-icon"
                                    title="Eliminar cuenta de la lista"
                                    aria-label="Eliminar cuenta de la lista"
                                    onClick={() => {
                                      setSelectedAudienceAccountIds(
                                        (previous) =>
                                          previous.filter(
                                            (existingId) =>
                                              Number(existingId) !== accountId,
                                          ),
                                      );
                                    }}
                                  >
                                    <svg
                                      viewBox="0 0 24 24"
                                      width="16"
                                      height="16"
                                      fill="currentColor"
                                      aria-hidden="true"
                                      focusable="false"
                                      style={{ display: "block" }}
                                    >
                                      <path
                                        d="M9 3h6a1 1 0 0 1 1 1v1h4v2h-1v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7H4V5h4V4a1 1 0 0 1 1-1zm1 2v0h4V5h-4zm-3 2v12h10V7H7zm3 2h2v8h-2V9zm4 0h2v8h-2V9z"
                                        fill="#ffffff"
                                      />
                                    </svg>
                                  </button>
                                </div>
                              </div>
                              {item.total_opportunities !== null ? (
                                <small>
                                  Oportunidades: {item.total_opportunities} · En
                                  proceso: {item.open_opportunities} · Ganadas:{" "}
                                  {item.won_opportunities}
                                </small>
                              ) : null}
                              <div className="campaigns-account-contacts">
                                {visibleContacts.length > 0 ? (
                                  <div className="campaigns-contact-list">
                                    {visibleContacts.map((contact, index) => {
                                      const contactId = Number(
                                        contact?.contact_id || 0,
                                      );
                                      const contactName = String(
                                        contact?.contact_name ||
                                          contact?.email ||
                                          `Contacto ${index + 1}`,
                                      ).trim();
                                      return (
                                        <div
                                          key={`${accountId}-${contactId || index}`}
                                          className="campaigns-contact-row"
                                        >
                                          <span>
                                            {contactName}
                                            {String(
                                              contact?.position_title || "",
                                            ).trim() ? (
                                              <span className="campaigns-mini-badge campaigns-mini-badge-contact-role">
                                                {String(
                                                  contact?.position_title || "",
                                                ).trim()}
                                              </span>
                                            ) : null}
                                          </span>
                                          <button
                                            type="button"
                                            className="campaigns-contact-remove-icon"
                                            title="Eliminar contacto de la lista"
                                            aria-label="Eliminar contacto de la lista"
                                            onClick={() => {
                                              setRemovedAudienceContactsByAccount(
                                                (previous) => {
                                                  const existing =
                                                    previous[accountId] || [];
                                                  if (
                                                    !contactId ||
                                                    existing.includes(contactId)
                                                  ) {
                                                    return previous;
                                                  }
                                                  return {
                                                    ...previous,
                                                    [accountId]: [
                                                      ...existing,
                                                      contactId,
                                                    ],
                                                  };
                                                },
                                              );
                                            }}
                                          >
                                            <svg
                                              viewBox="0 0 24 24"
                                              width="16"
                                              height="16"
                                              fill="currentColor"
                                              aria-hidden="true"
                                              focusable="false"
                                              style={{ display: "block" }}
                                            >
                                              <path
                                                d="M9 3h6a1 1 0 0 1 1 1v1h4v2h-1v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7H4V5h4V4a1 1 0 0 1 1-1zm1 2v0h4V5h-4zm-3 2v12h10V7H7zm3 2h2v8h-2V9zm4 0h2v8h-2V9z"
                                                fill="#ffffff"
                                              />
                                            </svg>
                                          </button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <p>Sin contactos para esta regla.</p>
                                )}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="campaigns-actions campaigns-grid-wide">
                <button
                  type="submit"
                  className="btn-secondary"
                  disabled={isSavingAccount || !selectedCampaignId}
                >
                  {isSavingAccount
                    ? "Guardando audiencia..."
                    : "Guardar audiencia seleccionada"}
                </button>
              </div>
            </form>
          </section>

          <section className="card">
            <h3>Ejecucion</h3>
            <div
              className="campaigns-execution-tabs"
              role="tablist"
              aria-label="Tabs de ejecucion"
            >
              <button
                type="button"
                role="tab"
                aria-selected={executionTab === "landing"}
                className={executionTab === "landing" ? "is-active" : ""}
                onClick={() => setExecutionTab("landing")}
              >
                Landing
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={executionTab === "correo"}
                className={executionTab === "correo" ? "is-active" : ""}
                onClick={() => setExecutionTab("correo")}
              >
                Correo
              </button>
            </div>

            <div className="campaigns-execution-panel" role="tabpanel">
              <small className="campaigns-field-help">
                Esta seccion consolida el estado operativo de la campana para
                dar seguimiento a la salida y avances de ejecucion.
              </small>

              <div className="campaigns-sidebar-meta">
                <small className="campaigns-chip">
                  Cuentas objetivo: {sortedVisibleAudienceAccounts.length}
                </small>
                <small className="campaigns-chip">
                  Estado: {formatCampaignTypeLabel(campaignForm.estado_campana)}
                </small>
                <small className="campaigns-chip">
                  Inicio: {campaignForm.starts_at || "Sin definir"}
                </small>
                <small className="campaigns-chip">
                  Fin: {campaignForm.ends_at || "Sin definir"}
                </small>
              </div>

              {executionTab === "landing" ? (
                <div className="campaigns-execution-content">
                  <strong>Plan de ejecucion Landing</strong>
                  <p>
                    Usa esta vista para controlar publicacion, trafico y
                    conversion de la landing de la campana.
                  </p>
                  <ul>
                    <li>Validar slug, contenido y llamada a la accion.</li>
                    <li>
                      Confirmar fecha/hora de salida y canal de promocion.
                    </li>
                    <li>Monitorear registros entrantes y calidad del lead.</li>
                  </ul>
                </div>
              ) : (
                <div className="campaigns-execution-content">
                  <strong>Plan de ejecucion Correo</strong>
                  <p>
                    Usa esta vista para controlar envios, seguimiento y
                    respuesta comercial por correo.
                  </p>
                  <ul>
                    <li>Revisar segmentacion y asunto del correo.</li>
                    <li>
                      Definir lote inicial, horario y frecuencia de envio.
                    </li>
                    <li>Monitorear apertura, clic y contactos efectivos.</li>
                  </ul>
                </div>
              )}
            </div>
          </section>
        </main>
      </div>

      {isAddAccountsModalOpen ? (
        <div
          className="campaigns-modal-backdrop"
          role="presentation"
          onClick={() => setIsAddAccountsModalOpen(false)}
        >
          <div
            className="campaigns-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Anadir cuentas"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="campaigns-modal-head">
              <strong>Anadir cuentas</strong>
              <button
                type="button"
                className="campaigns-modal-close"
                onClick={() => setIsAddAccountsModalOpen(false)}
                aria-label="Cerrar modal"
              >
                ×
              </button>
            </div>

            <label className="campaigns-modal-search">
              Buscar cuenta
              <input
                value={addAccountsSearchText}
                onChange={(event) =>
                  setAddAccountsSearchText(event.target.value)
                }
                placeholder="Escribe nombre de cuenta"
              />
            </label>

            <div className="campaigns-modal-list">
              {availableAccountsToAdd.length === 0 ? (
                <p className="campaigns-empty">
                  No hay cuentas disponibles para anadir con el filtro actual.
                </p>
              ) : (
                availableAccountsToAdd.map((item) => {
                  const accountId = Number(item.account_id || 0);
                  const isChecked = pendingAddAccountIds.includes(accountId);
                  return (
                    <label
                      key={accountId}
                      className="campaigns-modal-list-item"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          setPendingAddAccountIds((previous) => {
                            if (isChecked) {
                              return previous.filter(
                                (existingId) =>
                                  Number(existingId) !== accountId,
                              );
                            }
                            return [...previous, accountId];
                          });
                        }}
                      />
                      <span>{item.account_name}</span>
                    </label>
                  );
                })
              )}
            </div>

            <div className="campaigns-modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setIsAddAccountsModalOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={pendingAddAccountIds.length === 0}
                onClick={() => {
                  setSelectedAudienceAccountIds((previous) => {
                    const merged = new Set(
                      previous
                        .map((accountId) => Number(accountId || 0))
                        .filter(
                          (accountId) =>
                            Number.isInteger(accountId) && accountId > 0,
                        ),
                    );
                    pendingAddAccountIds.forEach((accountId) => {
                      merged.add(Number(accountId));
                    });
                    return Array.from(merged.values());
                  });
                  setIsAddAccountsModalOpen(false);
                }}
              >
                Anadir seleccionadas
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isAddContactsModalOpen && addContactsAccount ? (
        <div
          className="campaigns-modal-backdrop"
          role="presentation"
          onClick={() => setIsAddContactsModalOpen(false)}
        >
          <div
            className="campaigns-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Adicionar contactos"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="campaigns-modal-head">
              <strong>{`Adicionar contactos · ${addContactsAccount.account_name}`}</strong>
              <button
                type="button"
                className="campaigns-modal-close"
                onClick={() => setIsAddContactsModalOpen(false)}
                aria-label="Cerrar modal"
              >
                ×
              </button>
            </div>

            <label className="campaigns-modal-search">
              Buscar contacto
              <input
                value={addContactsSearchText}
                onChange={(event) =>
                  setAddContactsSearchText(event.target.value)
                }
                placeholder="Escribe nombre o correo"
              />
            </label>

            <div className="campaigns-modal-list">
              {isLoadingAddContacts ? (
                <p className="campaigns-empty">Cargando contactos...</p>
              ) : null}

              {!isLoadingAddContacts && addContactsError ? (
                <p className="campaigns-alert campaigns-alert-error">
                  {addContactsError}
                </p>
              ) : null}

              {!isLoadingAddContacts &&
              !addContactsError &&
              availableContactsToAdd.length === 0 ? (
                <p className="campaigns-empty">
                  No hay contactos adicionales disponibles para adicionar.
                </p>
              ) : null}

              {!isLoadingAddContacts &&
              !addContactsError &&
              availableContactsToAdd.length > 0
                ? availableContactsToAdd.map((contact, index) => {
                    const contactId = Number(contact?.contact_id || 0);
                    const isChecked = pendingAddContactIds.includes(contactId);
                    const contactLabel = String(
                      contact?.contact_name ||
                        contact?.email ||
                        `Contacto ${index + 1}`,
                    ).trim();
                    return (
                      <label
                        key={`${addContactsAccount.account_id}-${contactId || index}`}
                        className="campaigns-modal-list-item"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            if (!contactId) return;
                            setPendingAddContactIds((previous) => {
                              if (isChecked) {
                                return previous.filter(
                                  (existingId) => existingId !== contactId,
                                );
                              }
                              return [...previous, contactId];
                            });
                          }}
                        />
                        <span>
                          {contactLabel}
                          {contact?.email ? ` · ${contact.email}` : ""}
                        </span>
                      </label>
                    );
                  })
                : null}
            </div>

            <div className="campaigns-modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setIsAddContactsModalOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={pendingAddContactIds.length === 0}
                onClick={() => {
                  const accountId = Number(addContactsAccount.account_id || 0);
                  if (!accountId) {
                    setIsAddContactsModalOpen(false);
                    return;
                  }
                  const selectedContacts = pendingAddContactIds
                    .map(
                      (contactId) =>
                        addContactsAllById.get(Number(contactId || 0)) || null,
                    )
                    .filter(Boolean);

                  setRemovedAudienceContactsByAccount((previous) => {
                    const existingRemoved = (previous[accountId] || []).map(
                      (contactId) => Number(contactId || 0),
                    );
                    const pendingSet = new Set(
                      pendingAddContactIds.map((contactId) =>
                        Number(contactId || 0),
                      ),
                    );
                    const nextRemoved = existingRemoved.filter(
                      (contactId) => !pendingSet.has(contactId),
                    );

                    if (nextRemoved.length === 0) {
                      const nextState = { ...previous };
                      delete nextState[accountId];
                      return nextState;
                    }

                    return {
                      ...previous,
                      [accountId]: nextRemoved,
                    };
                  });

                  setManuallyAddedContactsByAccount((previous) => {
                    const suggestedSet = new Set(
                      (Array.isArray(addContactsAccount.contacts)
                        ? addContactsAccount.contacts
                        : []
                      )
                        .map((contact) => Number(contact?.contact_id || 0))
                        .filter(
                          (contactId) =>
                            Number.isInteger(contactId) && contactId > 0,
                        ),
                    );

                    const existingManual = Array.isArray(previous[accountId])
                      ? previous[accountId]
                      : [];
                    const mergedManual = new Map(
                      existingManual.map((contact) => [
                        Number(contact?.contact_id || 0),
                        contact,
                      ]),
                    );

                    selectedContacts.forEach((contact) => {
                      const contactId = Number(contact?.contact_id || 0);
                      if (!Number.isInteger(contactId) || contactId <= 0) {
                        return;
                      }
                      if (suggestedSet.has(contactId)) {
                        return;
                      }
                      mergedManual.set(contactId, contact);
                    });

                    if (mergedManual.size === 0) {
                      const nextState = { ...previous };
                      delete nextState[accountId];
                      return nextState;
                    }

                    return {
                      ...previous,
                      [accountId]: Array.from(mergedManual.values()),
                    };
                  });
                  setIsAddContactsModalOpen(false);
                }}
              >
                Adicionar seleccionados
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
