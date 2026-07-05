import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { api, getApiErrorMessage } from "./api";
import "./campaign-email-module.css";

const MODULE_TABS = [
  { key: "overview", label: "Campana / Correo" },
  { key: "editor", label: "Editor" },
  { key: "schedule", label: "Programacion" },
  { key: "results", label: "Resultados" },
];

const CTA_SUGGESTIONS = [
  "Registrarme",
  "Solicitar demo",
  "Ver más",
  "Descargar guía",
  "Confirmar asistencia",
  "Agendar reunión",
  "Conocer solución",
  "Hablar con un asesor",
];

const DEFAULT_HTML = `<!doctype html>
<html>
  <body style="margin:0;font-family:Segoe UI,Tahoma,sans-serif;background:#eef4fb;color:#17324d;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef4fb;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;width:100%;background:#ffffff;border:1px solid #d9e6f5;border-radius:18px;overflow:hidden;">
            <tr>
              <td style="padding:28px 28px 12px;">
                <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#1f5fb0;">Correo de campana</div>
                <h1 style="margin:10px 0 12px;font-size:28px;line-height:1.2;color:#173d72;">Asunto principal del correo</h1>
                <p style="margin:0 0 18px;color:#466381;font-size:15px;line-height:1.6;">Resume aqui la propuesta de valor principal, el contexto de la campana y la accion esperada para la audiencia.</p>
                <a href="https://example.com" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#1f5fb0;color:#ffffff;text-decoration:none;font-weight:700;">Ir a la accion</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

const DEFAULT_DRAFT = {
  send_type: "correo_masivo",
  status: "draft",
  subject: "",
  preheader: "",
  cta_label: "",
  cta_url: "",
  html_content: DEFAULT_HTML,
  scheduled_at: "",
  batch_size: "50",
  max_sends_per_hour: "50",
  max_sends_per_day: "300",
  test_recipients: "",
};

const EMAIL_TYPE_DESCRIPTIONS = {
  correo_masivo:
    "Envio puntual a una audiencia amplia para comunicar una accion concreta.",
  secuencia:
    "Serie de correos programados para nutrir o acompañar el seguimiento.",
  recordatorio:
    "Correo breve para reforzar una fecha, evento o accion pendiente.",
  seguimiento:
    "Correo posterior al primer impacto para reactivar interes o avanzar la conversacion.",
};

const EMAIL_TYPE_SUGGESTION_MATRIX = {
  reconocimiento: {
    correo_masivo: "correo_masivo",
    correo_automatizado: "secuencia",
    redes_sociales_organicas: "correo_masivo",
    redes_sociales_pagadas: "seguimiento",
    anuncios_busqueda: "seguimiento",
    anuncios_display: "correo_masivo",
    webinar: "recordatorio",
    landing_page: "seguimiento",
    sms: "recordatorio",
    whatsapp: "seguimiento",
    evento_presencial: "recordatorio",
    evento_virtual: "recordatorio",
    encuesta: "seguimiento",
    programa_de_referidos: "seguimiento",
  },
  captacion_de_leads: {
    correo_masivo: "correo_masivo",
    correo_automatizado: "secuencia",
    redes_sociales_organicas: "seguimiento",
    redes_sociales_pagadas: "seguimiento",
    anuncios_busqueda: "seguimiento",
    anuncios_display: "seguimiento",
    webinar: "recordatorio",
    landing_page: "seguimiento",
    sms: "recordatorio",
    whatsapp: "seguimiento",
    evento_presencial: "recordatorio",
    evento_virtual: "recordatorio",
    encuesta: "seguimiento",
    programa_de_referidos: "seguimiento",
  },
  nutricion: {
    correo_masivo: "correo_masivo",
    correo_automatizado: "secuencia",
    redes_sociales_organicas: "secuencia",
    redes_sociales_pagadas: "seguimiento",
    anuncios_busqueda: "seguimiento",
    anuncios_display: "correo_masivo",
    webinar: "recordatorio",
    landing_page: "seguimiento",
    sms: "recordatorio",
    whatsapp: "seguimiento",
    evento_presencial: "recordatorio",
    evento_virtual: "recordatorio",
    encuesta: "seguimiento",
    programa_de_referidos: "seguimiento",
  },
  conversion: {
    correo_masivo: "correo_masivo",
    correo_automatizado: "secuencia",
    redes_sociales_organicas: "seguimiento",
    redes_sociales_pagadas: "seguimiento",
    anuncios_busqueda: "seguimiento",
    anuncios_display: "seguimiento",
    webinar: "recordatorio",
    landing_page: "seguimiento",
    sms: "recordatorio",
    whatsapp: "seguimiento",
    evento_presencial: "recordatorio",
    evento_virtual: "recordatorio",
    encuesta: "seguimiento",
    programa_de_referidos: "seguimiento",
  },
  fidelizacion: {
    correo_masivo: "correo_masivo",
    correo_automatizado: "secuencia",
    redes_sociales_organicas: "secuencia",
    redes_sociales_pagadas: "seguimiento",
    anuncios_busqueda: "seguimiento",
    anuncios_display: "correo_masivo",
    webinar: "recordatorio",
    landing_page: "seguimiento",
    sms: "recordatorio",
    whatsapp: "seguimiento",
    evento_presencial: "recordatorio",
    evento_virtual: "recordatorio",
    encuesta: "seguimiento",
    programa_de_referidos: "seguimiento",
  },
  reactivacion: {
    correo_masivo: "correo_masivo",
    correo_automatizado: "secuencia",
    redes_sociales_organicas: "seguimiento",
    redes_sociales_pagadas: "seguimiento",
    anuncios_busqueda: "seguimiento",
    anuncios_display: "correo_masivo",
    webinar: "recordatorio",
    landing_page: "seguimiento",
    sms: "recordatorio",
    whatsapp: "seguimiento",
    evento_presencial: "recordatorio",
    evento_virtual: "recordatorio",
    encuesta: "seguimiento",
    programa_de_referidos: "seguimiento",
  },
  promocion: {
    correo_masivo: "correo_masivo",
    correo_automatizado: "secuencia",
    redes_sociales_organicas: "correo_masivo",
    redes_sociales_pagadas: "seguimiento",
    anuncios_busqueda: "seguimiento",
    anuncios_display: "correo_masivo",
    webinar: "recordatorio",
    landing_page: "seguimiento",
    sms: "recordatorio",
    whatsapp: "seguimiento",
    evento_presencial: "recordatorio",
    evento_virtual: "recordatorio",
    encuesta: "seguimiento",
    programa_de_referidos: "seguimiento",
  },
  lanzamiento_de_producto: {
    correo_masivo: "correo_masivo",
    correo_automatizado: "secuencia",
    redes_sociales_organicas: "correo_masivo",
    redes_sociales_pagadas: "seguimiento",
    anuncios_busqueda: "seguimiento",
    anuncios_display: "correo_masivo",
    webinar: "recordatorio",
    landing_page: "seguimiento",
    sms: "recordatorio",
    whatsapp: "seguimiento",
    evento_presencial: "recordatorio",
    evento_virtual: "recordatorio",
    encuesta: "seguimiento",
    programa_de_referidos: "seguimiento",
  },
  upsell: {
    correo_masivo: "correo_masivo",
    correo_automatizado: "secuencia",
    redes_sociales_organicas: "seguimiento",
    redes_sociales_pagadas: "seguimiento",
    anuncios_busqueda: "seguimiento",
    anuncios_display: "correo_masivo",
    webinar: "recordatorio",
    landing_page: "seguimiento",
    sms: "recordatorio",
    whatsapp: "seguimiento",
    evento_presencial: "recordatorio",
    evento_virtual: "recordatorio",
    encuesta: "seguimiento",
    programa_de_referidos: "seguimiento",
  },
  cross_sell: {
    correo_masivo: "correo_masivo",
    correo_automatizado: "secuencia",
    redes_sociales_organicas: "seguimiento",
    redes_sociales_pagadas: "seguimiento",
    anuncios_busqueda: "seguimiento",
    anuncios_display: "correo_masivo",
    webinar: "recordatorio",
    landing_page: "seguimiento",
    sms: "recordatorio",
    whatsapp: "seguimiento",
    evento_presencial: "recordatorio",
    evento_virtual: "recordatorio",
    encuesta: "seguimiento",
    programa_de_referidos: "seguimiento",
  },
  evento: {
    correo_masivo: "correo_masivo",
    correo_automatizado: "secuencia",
    redes_sociales_organicas: "correo_masivo",
    redes_sociales_pagadas: "seguimiento",
    anuncios_busqueda: "seguimiento",
    anuncios_display: "correo_masivo",
    webinar: "recordatorio",
    landing_page: "seguimiento",
    sms: "recordatorio",
    whatsapp: "recordatorio",
    evento_presencial: "recordatorio",
    evento_virtual: "recordatorio",
    encuesta: "seguimiento",
    programa_de_referidos: "seguimiento",
  },
  referidos: {
    correo_masivo: "correo_masivo",
    correo_automatizado: "secuencia",
    redes_sociales_organicas: "correo_masivo",
    redes_sociales_pagadas: "seguimiento",
    anuncios_busqueda: "seguimiento",
    anuncios_display: "correo_masivo",
    webinar: "recordatorio",
    landing_page: "seguimiento",
    sms: "recordatorio",
    whatsapp: "seguimiento",
    evento_presencial: "recordatorio",
    evento_virtual: "recordatorio",
    encuesta: "seguimiento",
    programa_de_referidos: "seguimiento",
  },
  educacion: {
    correo_masivo: "correo_masivo",
    correo_automatizado: "secuencia",
    redes_sociales_organicas: "correo_masivo",
    redes_sociales_pagadas: "seguimiento",
    anuncios_busqueda: "seguimiento",
    anuncios_display: "correo_masivo",
    webinar: "recordatorio",
    landing_page: "seguimiento",
    sms: "recordatorio",
    whatsapp: "seguimiento",
    evento_presencial: "recordatorio",
    evento_virtual: "recordatorio",
    encuesta: "seguimiento",
    programa_de_referidos: "seguimiento",
  },
};

function getSuggestedEmailType(campaign) {
  const tipoCampana = String(campaign?.tipo_campana || "").trim();
  const subtipoCampana = String(campaign?.subtipo_campana || "").trim();

  return (
    EMAIL_TYPE_SUGGESTION_MATRIX[tipoCampana]?.[subtipoCampana] ||
    DEFAULT_DRAFT.send_type
  );
}

function formatLabel(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function toDateInputValue(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  const datePart = normalized.includes("T")
    ? normalized.split("T")[0]
    : normalized.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : "";
}

function createDefaultDraft(campaign) {
  const campaignName = String(campaign?.name || "").trim();
  return {
    ...DEFAULT_DRAFT,
    send_type: getSuggestedEmailType(campaign),
    subject: campaignName
      ? `${campaignName}: propuesta principal`
      : "Asunto del correo",
    preheader: campaignName
      ? `Resumen breve de ${campaignName}`
      : "Resumen breve del correo",
    cta_label: "Ver mas",
    cta_url: "https://example.com",
    scheduled_at: toDateInputValue(campaign?.starts_at),
  };
}

function normalizeAssetSearchQuery(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeComparableText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("es-MX", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDispatchStatus(status) {
  const normalized = String(status || "")
    .trim()
    .toLowerCase();
  if (normalized === "running") return "En ejecución";
  if (normalized === "paused") return "Pausado";
  if (normalized === "completed") return "Completado";
  if (normalized === "canceled") return "Cancelado";
  if (normalized === "failed") return "Con error";
  return "Sin corrida";
}

function promptRequestsAssetSearch(prompt) {
  const normalized = String(prompt || "").toLowerCase();
  return /(grafico|gráfico|chart|graph|imagen|image|infografia|infografía|infographic)/i.test(
    normalized,
  );
}

function readStoredDrafts() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem("campaign-email-module-drafts");
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object") return {};

    const migrated = {};
    for (const [key, draft] of Object.entries(parsed)) {
      const normalizedDraft =
        draft && typeof draft === "object" ? { ...draft } : {};

      if (String(normalizedDraft.batch_size || "").trim() === "250") {
        normalizedDraft.batch_size = DEFAULT_DRAFT.batch_size;
      }
      if (String(normalizedDraft.max_sends_per_hour || "").trim() === "1000") {
        normalizedDraft.max_sends_per_hour = DEFAULT_DRAFT.max_sends_per_hour;
      }
      if (String(normalizedDraft.max_sends_per_day || "").trim() === "10000") {
        normalizedDraft.max_sends_per_day = DEFAULT_DRAFT.max_sends_per_day;
      }

      migrated[key] = normalizedDraft;
    }

    return migrated;
  } catch {
    return {};
  }
}

function extractHtmlFromAssistantText(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const fencedMatch = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : text;
  if (!candidate) return "";
  if (!/<html[\s>]|<body[\s>]|<table[\s>]|<!doctype html>/i.test(candidate)) {
    return "";
  }
  return candidate;
}

function extractEmailAiPayload(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  const fencedJsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonCandidate = fencedJsonMatch ? fencedJsonMatch[1].trim() : text;

  const pickString = (source, keys) => {
    for (const key of keys) {
      const candidate = String(source?.[key] || "").trim();
      if (candidate) return candidate;
    }
    return "";
  };

  const readLabeledField = (labelPattern) => {
    const match = text.match(labelPattern);
    return match ? String(match[1] || "").trim() : "";
  };

  try {
    const parsed = JSON.parse(jsonCandidate);
    const html = extractHtmlFromAssistantText(
      pickString(parsed, ["html", "body_html", "email_html", "content_html"]),
    );
    if (html) {
      return {
        subject: pickString(parsed, ["subject", "title", "email_subject"]),
        preheader: pickString(parsed, [
          "preheader",
          "preview_text",
          "pre_header",
          "subtitle",
        ]),
        html,
      };
    }
  } catch {
    // Ignore and fallback to raw HTML extraction.
  }

  const html = extractHtmlFromAssistantText(text);
  if (!html) return null;
  return {
    subject: readLabeledField(/(?:^|\n)\s*(?:asunto|subject)\s*:\s*(.+)/i),
    preheader: readLabeledField(
      /(?:^|\n)\s*(?:preheader|preview text|preview_text|pre header)\s*:\s*(.+)/i,
    ),
    html,
  };
}

function insertAssetIntoEmailHtml(html, asset) {
  const sourceHtml = String(html || "").trim() || DEFAULT_HTML;
  const assetUrl = String(asset?.sourceUrl || "").trim();
  if (!assetUrl) return sourceHtml;

  const altText = String(asset?.title || "Grafico aprobado").trim();
  const imageBlock = [
    '<div style="margin:18px 0;text-align:center;">',
    `<img src="${assetUrl}" alt="${altText.replace(/"/g, "&quot;")}" style="max-width:100%;height:auto;border:0;border-radius:12px;display:block;margin:0 auto;" />`,
    "</div>",
  ].join("");

  if (sourceHtml.includes("<a ")) {
    return sourceHtml.replace("<a ", `${imageBlock}<a `);
  }

  if (sourceHtml.includes("</td>")) {
    return sourceHtml.replace("</td>", `${imageBlock}</td>`);
  }

  if (sourceHtml.includes("</body>")) {
    return sourceHtml.replace("</body>", `${imageBlock}</body>`);
  }

  return `${sourceHtml}${imageBlock}`;
}

function extractExternalImageUrlsFromHtml(html) {
  const content = String(html || "");
  const regex = /<img[^>]+src=["']([^"']+)["']/gi;
  const urls = new Set();
  let match = regex.exec(content);

  while (match) {
    const src = String(match[1] || "").trim();
    if (/^https?:\/\//i.test(src)) {
      urls.add(src);
    }
    match = regex.exec(content);
  }

  return Array.from(urls);
}

async function blobToDataUrl(blob) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("No fue posible convertir imagen"));
    reader.readAsDataURL(blob);
  });
}

async function localizeExternalImagesInHtml(html) {
  const source = String(html || "");
  const urls = extractExternalImageUrlsFromHtml(source);
  if (!urls.length) {
    return { html: source, converted: 0, failed: 0 };
  }

  let outputHtml = source;
  let converted = 0;
  let failed = 0;

  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        failed += 1;
        continue;
      }
      const blob = await response.blob();
      const dataUrl = await blobToDataUrl(blob);
      if (!dataUrl) {
        failed += 1;
        continue;
      }
      outputHtml = outputHtml.split(url).join(dataUrl);
      converted += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    html: outputHtml,
    converted,
    failed,
  };
}

function extractSearchQueriesFromAssistantText(value) {
  const text = String(value || "").trim();
  if (!text) return [];

  const fencedJsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonCandidate = fencedJsonMatch ? fencedJsonMatch[1].trim() : text;

  try {
    const parsed = JSON.parse(jsonCandidate);
    const queries = Array.isArray(parsed?.queries)
      ? parsed.queries
      : Array.isArray(parsed?.search_queries)
        ? parsed.search_queries
        : Array.isArray(parsed?.suggestions)
          ? parsed.suggestions
          : Array.isArray(parsed)
            ? parsed
            : String(parsed?.query || parsed?.search || "").trim()
              ? [String(parsed?.query || parsed?.search || "").trim()]
              : [];
    return queries
      .map((entry) => normalizeAssetSearchQuery(entry))
      .filter(Boolean)
      .slice(0, 5);
  } catch {
    // Continue to text parsing.
  }

  return text
    .split(/\n+/)
    .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
    .map((line) => line.replace(/^query\s*:\s*/i, "").trim())
    .map((line) => line.replace(/^búsqueda\s*:\s*/i, "").trim())
    .map((line) => normalizeAssetSearchQuery(line))
    .filter((line) => line.length >= 3)
    .filter(Boolean)
    .slice(0, 5);
}

export default function CampaignEmailModulePage() {
  const [activeTab, setActiveTab] = useState("overview");
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState(null);
  const [campaignAudience, setCampaignAudience] = useState([]);
  const [draftsByCampaignId, setDraftsByCampaignId] = useState(() =>
    readStoredDrafts(),
  );
  const [isLoadingCampaigns, setIsLoadingCampaigns] = useState(true);
  const [isLoadingAudience, setIsLoadingAudience] = useState(false);
  const [isAiPromptModalOpen, setIsAiPromptModalOpen] = useState(false);
  const [aiActionMode, setAiActionMode] = useState("generate");
  const [aiPromptText, setAiPromptText] = useState("");
  const [isGeneratingWithAi, setIsGeneratingWithAi] = useState(false);
  const [aiProgressText, setAiProgressText] = useState("");
  const [isLocalizingImages, setIsLocalizingImages] = useState(false);
  const [isAssetSearchModalOpen, setIsAssetSearchModalOpen] = useState(false);
  const [assetSearchQuery, setAssetSearchQuery] = useState("");
  const [assetSearchResults, setAssetSearchResults] = useState([]);
  const [assetSearchSuggestedQueries, setAssetSearchSuggestedQueries] =
    useState([]);
  const [isSearchingAssets, setIsSearchingAssets] = useState(false);
  const [pendingAiRequest, setPendingAiRequest] = useState(null);
  const [landingUrlSuggestions, setLandingUrlSuggestions] = useState([]);
  const [isSendingTestEmail, setIsSendingTestEmail] = useState(false);
  const [isStartingSend, setIsStartingSend] = useState(false);
  const [testSendSummary, setTestSendSummary] = useState(null);
  const [testSendResults, setTestSendResults] = useState([]);
  const [campaignDispatch, setCampaignDispatch] = useState(null);
  const [campaignDispatchResults, setCampaignDispatchResults] = useState([]);
  const [isLoadingDispatch, setIsLoadingDispatch] = useState(false);
  const [isUpdatingDispatch, setIsUpdatingDispatch] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const selectedCampaign = useMemo(() => {
    return (
      campaigns.find((campaign) => campaign.id === selectedCampaignId) || null
    );
  }, [campaigns, selectedCampaignId]);

  const currentDraft = useMemo(() => {
    const key = String(selectedCampaignId || "");
    if (!key) return DEFAULT_DRAFT;
    return draftsByCampaignId[key] || createDefaultDraft(selectedCampaign);
  }, [draftsByCampaignId, selectedCampaign, selectedCampaignId]);

  const audienceAccountsCount = campaignAudience.length;
  const audienceContactsCount = useMemo(() => {
    return campaignAudience.reduce((total, item) => {
      return total + (Array.isArray(item.contacts) ? item.contacts.length : 0);
    }, 0);
  }, [campaignAudience]);

  const visibleLandingUrlSuggestions = useMemo(() => {
    const campaignName = normalizeComparableText(selectedCampaign?.name || "");
    if (!campaignName) return [];

    return landingUrlSuggestions
      .filter((entry) => {
        const eventName = normalizeComparableText(entry?.eventName || "");
        return (
          eventName.includes(campaignName) || campaignName.includes(eventName)
        );
      })
      .slice(0, 20);
  }, [landingUrlSuggestions, selectedCampaign?.name]);

  useEffect(() => {
    let mounted = true;

    async function loadCampaigns() {
      setIsLoadingCampaigns(true);
      setError("");
      try {
        const { data } = await api.get("/api/campaigns");
        if (!mounted) return;
        const items = Array.isArray(data?.items) ? data.items : [];
        setCampaigns(items);
        if (!selectedCampaignId && items[0]?.id) {
          setSelectedCampaignId(Number(items[0].id));
        }
      } catch (requestError) {
        if (!mounted) return;
        setError(
          getApiErrorMessage(
            requestError,
            "No fue posible cargar las campanas",
          ),
        );
      } finally {
        if (mounted) {
          setIsLoadingCampaigns(false);
        }
      }
    }

    loadCampaigns();

    return () => {
      mounted = false;
    };
  }, [selectedCampaignId]);

  useEffect(() => {
    let mounted = true;

    async function loadLatestDispatch() {
      if (!selectedCampaignId) {
        setCampaignDispatch(null);
        setCampaignDispatchResults([]);
        return;
      }

      setIsLoadingDispatch(true);
      try {
        const { data } = await api.get(
          `/api/campaign-emails/campaign/${selectedCampaignId}/latest`,
        );
        if (!mounted) return;
        setCampaignDispatch(data?.dispatch || null);
        setCampaignDispatchResults(
          Array.isArray(data?.results) ? data.results : [],
        );
      } catch {
        if (!mounted) return;
        setCampaignDispatch(null);
        setCampaignDispatchResults([]);
      } finally {
        if (mounted) {
          setIsLoadingDispatch(false);
        }
      }
    }

    loadLatestDispatch();

    return () => {
      mounted = false;
    };
  }, [selectedCampaignId]);

  useEffect(() => {
    if (!campaignDispatch?.id) return undefined;
    if (campaignDispatch.status !== "running") return undefined;

    const timer = window.setInterval(async () => {
      try {
        const { data } = await api.get(
          `/api/campaign-emails/runs/${campaignDispatch.id}`,
        );
        setCampaignDispatch(data?.dispatch || null);
        setCampaignDispatchResults(
          Array.isArray(data?.results) ? data.results : [],
        );
      } catch {
        // Ignore periodic refresh failures to avoid noisy UX.
      }
    }, 15_000);

    return () => window.clearInterval(timer);
  }, [campaignDispatch?.id, campaignDispatch?.status]);

  async function refreshDispatchStatus() {
    if (!campaignDispatch?.id) return;
    try {
      setIsLoadingDispatch(true);
      const { data } = await api.get(
        `/api/campaign-emails/runs/${campaignDispatch.id}`,
      );
      setCampaignDispatch(data?.dispatch || null);
      setCampaignDispatchResults(
        Array.isArray(data?.results) ? data.results : [],
      );
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible actualizar el estado del envío",
        ),
      );
      setSuccess("");
    } finally {
      setIsLoadingDispatch(false);
    }
  }

  async function handlePauseDispatch() {
    if (!campaignDispatch?.id || isUpdatingDispatch) return;
    try {
      setIsUpdatingDispatch(true);
      const { data } = await api.post(
        `/api/campaign-emails/runs/${campaignDispatch.id}/pause`,
      );
      setCampaignDispatch(data?.dispatch || null);
      setSuccess("Envío pausado. Puedes reanudar cuando desees.");
      setError("");
      await refreshDispatchStatus();
    } catch (requestError) {
      setError(
        getApiErrorMessage(requestError, "No fue posible pausar el envío"),
      );
      setSuccess("");
    } finally {
      setIsUpdatingDispatch(false);
    }
  }

  async function handleResumeDispatch() {
    if (!campaignDispatch?.id || isUpdatingDispatch) return;
    try {
      setIsUpdatingDispatch(true);
      const { data } = await api.post(
        `/api/campaign-emails/runs/${campaignDispatch.id}/resume`,
      );
      setCampaignDispatch(data?.dispatch || null);
      setSuccess("Envío reanudado.");
      setError("");
      await refreshDispatchStatus();
    } catch (requestError) {
      setError(
        getApiErrorMessage(requestError, "No fue posible reanudar el envío"),
      );
      setSuccess("");
    } finally {
      setIsUpdatingDispatch(false);
    }
  }

  async function handleCancelDispatch() {
    if (!campaignDispatch?.id || isUpdatingDispatch) return;
    const accepted = window.confirm(
      "¿Deseas cancelar esta corrida de envío? Los pendientes se marcarán como omitidos.",
    );
    if (!accepted) return;

    try {
      setIsUpdatingDispatch(true);
      const { data } = await api.post(
        `/api/campaign-emails/runs/${campaignDispatch.id}/cancel`,
      );
      setCampaignDispatch(data?.dispatch || null);
      setSuccess("Corrida cancelada.");
      setError("");
      await refreshDispatchStatus();
    } catch (requestError) {
      setError(
        getApiErrorMessage(requestError, "No fue posible cancelar el envío"),
      );
      setSuccess("");
    } finally {
      setIsUpdatingDispatch(false);
    }
  }

  useEffect(() => {
    let mounted = true;

    async function loadLandingUrlSuggestions() {
      try {
        const { data } = await api.get("/api/landing/v1/landing-pages", {
          params: {
            page: 1,
            page_size: 200,
          },
        });

        if (!mounted) return;

        const items = Array.isArray(data?.items) ? data.items : [];
        const apiBaseUrl = String(
          api.defaults.baseURL || window.location.origin,
        )
          .trim()
          .replace(/\/+$/, "");

        const mapped = items
          .map((item) => {
            const slug = String(item?.slug || "").trim();
            if (!slug) return null;
            return {
              url: `${apiBaseUrl}/api/public/landing/v1/${encodeURIComponent(slug)}/html`,
              eventName: String(item?.event_name || "").trim(),
              slug,
            };
          })
          .filter(Boolean);

        const unique = Array.from(
          new Map(mapped.map((entry) => [entry.url, entry])).values(),
        );
        setLandingUrlSuggestions(unique);
      } catch {
        if (mounted) {
          setLandingUrlSuggestions([]);
        }
      }
    }

    loadLandingUrlSuggestions();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadAudience() {
      if (!selectedCampaignId) {
        setCampaignAudience([]);
        return;
      }

      setIsLoadingAudience(true);
      try {
        const { data } = await api.get(
          `/api/campaigns/${selectedCampaignId}/accounts`,
        );
        if (!mounted) return;
        setCampaignAudience(Array.isArray(data?.items) ? data.items : []);
      } catch (requestError) {
        if (!mounted) return;
        setError(
          getApiErrorMessage(
            requestError,
            "No fue posible cargar la audiencia de la campana",
          ),
        );
      } finally {
        if (mounted) {
          setIsLoadingAudience(false);
        }
      }
    }

    loadAudience();

    return () => {
      mounted = false;
    };
  }, [selectedCampaignId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      "campaign-email-module-drafts",
      JSON.stringify(draftsByCampaignId),
    );
  }, [draftsByCampaignId]);

  function updateDraft(patch) {
    const key = String(selectedCampaignId || "");
    if (!key) return;
    setDraftsByCampaignId((previous) => ({
      ...previous,
      [key]: {
        ...(previous[key] || createDefaultDraft(selectedCampaign)),
        ...patch,
      },
    }));
  }

  function handleSaveLocalDraft() {
    setSuccess("Borrador de correo guardado en este navegador");
    setError("");
  }

  function parseTestRecipients(value) {
    return String(value || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  function hasInvalidEmail(entries) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return entries.some((entry) => !emailRegex.test(entry));
  }

  async function handleSendTestEmail() {
    if (isSendingTestEmail) return;

    const recipients = parseTestRecipients(currentDraft.test_recipients);
    if (!recipients.length) {
      setError("Debes indicar al menos un correo de prueba en el editor");
      setSuccess("");
      return;
    }

    if (hasInvalidEmail(recipients)) {
      setError(
        "La lista de correos de prueba contiene direcciones con formato inválido",
      );
      setSuccess("");
      return;
    }

    const subject = String(currentDraft.subject || "").trim();
    const htmlContent = String(currentDraft.html_content || "").trim();

    if (!subject) {
      setError("Debes definir asunto antes de enviar prueba");
      setSuccess("");
      return;
    }

    if (!htmlContent) {
      setError("Debes definir contenido HTML antes de enviar prueba");
      setSuccess("");
      return;
    }

    try {
      setIsSendingTestEmail(true);
      setError("");
      setSuccess("");

      const { data } = await api.post("/api/campaign-emails/test-send", {
        recipients,
        recipientsText: currentDraft.test_recipients,
        subject,
        preheader: String(currentDraft.preheader || "").trim(),
        htmlContent,
      });

      setTestSendSummary(data?.summary || null);
      setTestSendResults(Array.isArray(data?.results) ? data.results : []);

      const sent = Number(data?.summary?.sent || 0);
      const failed = Number(data?.summary?.failed || 0);
      const invalid = Number(data?.summary?.invalid || 0);
      setSuccess(
        `Prueba enviada. Exitos: ${sent}, Fallidos: ${failed}, Invalidos: ${invalid}.`,
      );
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible enviar correos de prueba",
        ),
      );
      setSuccess("");
      setTestSendSummary(null);
      setTestSendResults([]);
    } finally {
      setIsSendingTestEmail(false);
    }
  }

  function collectCampaignAudienceEmails() {
    const emails = [];
    for (const accountItem of campaignAudience) {
      const contacts = Array.isArray(accountItem?.contacts)
        ? accountItem.contacts
        : [];
      for (const contact of contacts) {
        const email = String(contact?.email || "")
          .trim()
          .toLowerCase();
        if (email) {
          emails.push(email);
        }
      }
    }

    return Array.from(new Set(emails));
  }

  async function handleStartCampaignSend() {
    if (isStartingSend) return;

    const recipients = collectCampaignAudienceEmails();
    if (!recipients.length) {
      setError("La campaña no tiene contactos con correo para enviar");
      setSuccess("");
      return;
    }

    const subject = String(currentDraft.subject || "").trim();
    const htmlContent = String(currentDraft.html_content || "").trim();
    if (!subject) {
      setError("Debes definir asunto antes de iniciar envío");
      setSuccess("");
      return;
    }
    if (!htmlContent) {
      setError("Debes definir HTML antes de iniciar envío");
      setSuccess("");
      return;
    }

    const accepted = window.confirm(
      `Se programará el envío automático para ${recipients.length} destinatarios con tope fijo de 50 por hora y 300 por día. ¿Deseas continuar?`,
    );
    if (!accepted) {
      return;
    }

    try {
      setIsStartingSend(true);
      setError("");
      setSuccess("");

      const { data } = await api.post("/api/campaign-emails/send", {
        campaignId: Number(selectedCampaignId || 0) || undefined,
        recipients,
        subject,
        preheader: String(currentDraft.preheader || "").trim(),
        htmlContent,
      });
      setCampaignDispatch(data?.dispatch || null);
      setCampaignDispatchResults(
        Array.isArray(data?.invalidResults) ? data.invalidResults : [],
      );

      const queued = Number(data?.summary?.queued || 0);
      const invalid = Number(data?.summary?.invalid || 0);
      setSuccess(
        `${String(data?.message || "Envío programado")} En cola: ${queued}. Invalidos: ${invalid}.`,
      );
      setActiveTab("results");
      await refreshDispatchStatus();
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible iniciar el envío de correos",
        ),
      );
      setSuccess("");
    } finally {
      setIsStartingSend(false);
    }
  }

  async function handleLocalizeExternalImages() {
    if (isLocalizingImages) return;

    const sourceHtml = String(currentDraft.html_content || "").trim();
    if (!sourceHtml) return;

    try {
      setIsLocalizingImages(true);
      const result = await localizeExternalImagesInHtml(sourceHtml);
      if (result.converted > 0) {
        updateDraft({ html_content: result.html });
        setSuccess(
          result.failed > 0
            ? `Se localizaron ${result.converted} imagen(es) y ${result.failed} no pudieron descargarse.`
            : `Se localizaron ${result.converted} imagen(es) externas.`,
        );
        setError("");
        return;
      }

      if (result.failed > 0) {
        setError(
          "No fue posible descargar las imágenes externas detectadas. Revisa que los enlaces sean públicos.",
        );
        setSuccess("");
        return;
      }

      setSuccess("No se encontraron URLs externas de imágenes para localizar.");
      setError("");
    } catch {
      setError("No fue posible localizar imágenes externas del correo");
      setSuccess("");
    } finally {
      setIsLocalizingImages(false);
    }
  }

  function handleOpenAssetSearchModal(initialQuery = "") {
    setAssetSearchQuery(String(initialQuery || "").trim());
    setAssetSearchResults([]);
    setIsAssetSearchModalOpen(true);
  }

  function handleCloseAssetSearchModal() {
    if (isSearchingAssets) return;
    setIsAssetSearchModalOpen(false);
    setAssetSearchSuggestedQueries([]);
    setPendingAiRequest(null);
  }

  async function fetchAssetResultsForQuery(query) {
    const response = await fetch(
      `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(
        query,
      )}&gsrnamespace=6&gsrlimit=8&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=720&format=json&origin=*`,
    );

    if (!response.ok) {
      throw new Error("No fue posible consultar resultados en internet");
    }

    const data = await response.json();
    const pages = Object.values(data?.query?.pages || {});
    return pages
      .map((page) => {
        const imageInfo = Array.isArray(page?.imageinfo)
          ? page.imageinfo[0]
          : null;
        if (!imageInfo?.url) return null;
        return {
          id: Number(page?.pageid || 0),
          title: String(page?.title || "")
            .replace(/^File:/i, "")
            .trim(),
          sourceUrl: String(imageInfo.url || "").trim(),
          thumbnailUrl: String(
            imageInfo.thumburl || imageInfo.url || "",
          ).trim(),
          width: Number(imageInfo.thumbwidth || imageInfo.width || 0),
          height: Number(imageInfo.thumbheight || imageInfo.height || 0),
          mime: String(imageInfo.mime || "").trim(),
        };
      })
      .filter(Boolean)
      .filter((item) => item.thumbnailUrl && item.sourceUrl);
  }

  async function getAiAssetSearchQueries(prompt) {
    if (!selectedCampaign) return [];

    const sessionRes = await api.post("/api/chatbot/sessions", {
      locale: "es",
      userContext: {
        module: "campaign_email_assets",
        objective: "search_graphic_queries",
        campaignName: String(selectedCampaign.name || "").trim(),
      },
    });

    const sessionId = String(sessionRes?.data?.sessionId || "").trim();
    if (!sessionId) {
      throw new Error(
        "No fue posible crear sesión IA para búsqueda de gráficos",
      );
    }

    const aiInstruction = [
      "Genera entre 3 y 5 consultas de búsqueda para encontrar un gráfico o imagen útil para un correo comercial.",
      'Devuelve solo JSON válido con esta estructura: {"queries": ["query 1", "query 2"]}.',
      "Las consultas deben ser cortas, concretas y útiles para buscar en repositorios visuales.",
      "Prioriza términos visuales en inglés cuando ayuden a encontrar mejores resultados.",
      `Campaña: ${String(selectedCampaign.name || "").trim()}`,
      `Tipo de campaña: ${formatLabel(selectedCampaign.tipo_campana)}`,
      `Subtipo de campaña: ${formatLabel(selectedCampaign.subtipo_campana)}`,
      `Tipo de correo: ${formatLabel(currentDraft.send_type)}`,
      `CTA: ${String(currentDraft.cta_label || "").trim()}`,
      "Pedido del usuario:",
      String(prompt || "").trim(),
    ].join("\n\n");

    const messageRes = await api.post("/api/chatbot/messages", {
      sessionId,
      message: aiInstruction,
      useContext: false,
      featureCode: "chatbot.assistant",
    });

    const jobId = String(messageRes?.data?.jobId || "").trim();
    if (!jobId) {
      throw new Error("No fue posible iniciar la búsqueda guiada por IA");
    }

    let attempts = 0;
    let jobCompleted = false;
    while (attempts < 25) {
      attempts += 1;
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      const jobRes = await api.get(
        `/api/chatbot/jobs/${encodeURIComponent(jobId)}`,
      );
      const status = String(jobRes?.data?.status || "queued").trim();

      if (status === "completed") {
        jobCompleted = true;
        break;
      }

      if (status === "failed") {
        throw new Error("La IA no pudo proponer búsquedas de gráficos");
      }
    }

    if (!jobCompleted) {
      throw new Error(
        "Tiempo de espera agotado para búsquedas de gráficos con IA",
      );
    }

    const historyRes = await api.get(
      `/api/chatbot/sessions/${encodeURIComponent(sessionId)}/messages`,
    );
    const messages = Array.isArray(historyRes?.data?.items)
      ? historyRes.data.items
      : [];
    const assistantMessage = [...messages]
      .reverse()
      .find((item) => String(item?.role || "").trim() === "assistant");
    const assistantContent = String(assistantMessage?.content || "").trim();
    return extractSearchQueriesFromAssistantText(assistantContent);
  }

  async function handleSearchAssets(
    event,
    queryOverride = "",
    queryCandidates = [],
  ) {
    event?.preventDefault?.();
    const query = String(queryOverride || assetSearchQuery || "").trim();
    if (!query) {
      setError("Debes escribir una búsqueda para encontrar gráficos");
      setSuccess("");
      return;
    }

    try {
      setIsSearchingAssets(true);
      setError("");
      setSuccess("");
      const orderedQueries = Array.from(
        new Set(
          [query, ...(Array.isArray(queryCandidates) ? queryCandidates : [])]
            .map((entry) => normalizeAssetSearchQuery(entry))
            .filter(Boolean),
        ),
      );

      if (!orderedQueries.length) {
        throw new Error("La IA no propuso consultas de búsqueda válidas");
      }

      let results = [];
      let resolvedQuery = orderedQueries[0] || query;
      for (const candidateQuery of orderedQueries) {
        const candidateResults =
          await fetchAssetResultsForQuery(candidateQuery);
        if (candidateResults.length) {
          results = candidateResults;
          resolvedQuery = candidateQuery;
          break;
        }
      }

      setAssetSearchQuery(resolvedQuery);
      setAssetSearchResults(results);
      if (!results.length) {
        setError("No se encontraron imágenes útiles para esa búsqueda");
      }
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible buscar gráficos en internet",
        ),
      );
      setAssetSearchResults([]);
    } finally {
      setIsSearchingAssets(false);
    }
  }

  async function handleApproveAsset(asset) {
    if (pendingAiRequest?.prompt) {
      setIsAssetSearchModalOpen(false);
      const promptWithAsset = [
        pendingAiRequest.prompt,
        "",
        "Usa este asset aprobado por el usuario si resulta pertinente:",
        `Título: ${String(asset?.title || "").trim()}`,
        `URL: ${String(asset?.sourceUrl || "").trim()}`,
      ].join("\n");
      setPendingAiRequest(null);
      await handleGenerateEmailWithAi(
        promptWithAsset,
        pendingAiRequest.mode,
        asset,
      );
      return;
    }

    updateDraft({
      html_content: insertAssetIntoEmailHtml(currentDraft.html_content, asset),
    });
    setIsAssetSearchModalOpen(false);
    setSuccess("Gráfico aprobado e insertado en el correo");
    setError("");
  }

  function handleOpenAiPromptModal(mode) {
    if (!selectedCampaign) {
      setError("Selecciona una campaña antes de usar IA");
      setSuccess("");
      return;
    }

    const normalizedMode = mode === "improve" ? "improve" : "generate";
    setAiActionMode(normalizedMode);

    setAiPromptText((current) => {
      if (String(current || "").trim()) return current;
      return [
        `Campaña: ${selectedCampaign.name || ""}`,
        `Tipo de campaña: ${formatLabel(selectedCampaign.tipo_campana)}`,
        `Subtipo de campaña: ${formatLabel(selectedCampaign.subtipo_campana)}`,
        `Tipo de correo: ${formatLabel(currentDraft.send_type)}`,
        `CTA principal: ${currentDraft.cta_label || ""}`,
        "Objetivo del correo:",
        "Audiencia:",
        "Tono deseado:",
        normalizedMode === "improve"
          ? "Cambios puntuales sobre el correo actual:"
          : "Lineamientos para generar el correo desde cero:",
      ].join("\n");
    });

    setIsAiPromptModalOpen(true);
  }

  function handleCloseAiPromptModal() {
    if (isGeneratingWithAi) return;
    setIsAiPromptModalOpen(false);
  }

  async function handleGenerateEmailWithAi(
    initialPrompt,
    mode = "generate",
    approvedAsset = null,
  ) {
    if (!selectedCampaign) {
      setError("Selecciona una campaña antes de usar IA");
      setSuccess("");
      return;
    }

    const prompt = String(initialPrompt || "").trim();
    if (!prompt) {
      setError("Debes escribir instrucciones para IA");
      setSuccess("");
      return;
    }

    try {
      setIsGeneratingWithAi(true);
      setAiProgressText("Preparando contexto para IA...");
      setError("");
      setSuccess("");

      const sessionRes = await api.post("/api/chatbot/sessions", {
        locale: "es",
        userContext: {
          module: "campaign_email",
          objective: "generate_campaign_email_html",
          campaignName: String(selectedCampaign.name || "").trim(),
          campaignType: String(selectedCampaign.tipo_campana || "").trim(),
          campaignSubtype: String(
            selectedCampaign.subtipo_campana || "",
          ).trim(),
          emailType: String(currentDraft.send_type || "").trim(),
        },
      });

      const sessionId = String(sessionRes?.data?.sessionId || "").trim();
      if (!sessionId) throw new Error("No fue posible crear sesión IA");

      setAiProgressText("Enviando instrucciones al asistente...");

      const aiInstruction = [
        mode === "improve"
          ? "Mejora un correo HTML existente para una campaña comercial."
          : "Genera un correo HTML completo desde cero para una campaña comercial.",
        'Devuelve exclusivamente un JSON válido con esta estructura: {"subject":"...","preheader":"...","html":"<!doctype html>..."}.',
        "No devuelvas explicaciones, ni markdown, ni texto adicional fuera del JSON.",
        "Debe ser responsive, profesional, claro y orientado a conversión.",
        `Campaña: ${String(selectedCampaign.name || "").trim() || "Campaña"}`,
        `Tipo de campaña: ${formatLabel(selectedCampaign.tipo_campana)}`,
        `Subtipo de campaña: ${formatLabel(selectedCampaign.subtipo_campana)}`,
        `Tipo de correo: ${formatLabel(currentDraft.send_type)}`,
        `Asunto actual: ${String(currentDraft.subject || "").trim()}`,
        `Preheader actual: ${String(currentDraft.preheader || "").trim()}`,
        `CTA principal: ${String(currentDraft.cta_label || "").trim()}`,
        `URL CTA: ${String(currentDraft.cta_url || "").trim()}`,
        `Descripción campaña: ${String(selectedCampaign.description || "").trim()}`,
        `Audiencia estimada: ${audienceContactsCount} contactos en ${audienceAccountsCount} cuentas`,
        approvedAsset?.sourceUrl
          ? `Asset aprobado por el usuario: ${String(approvedAsset.sourceUrl || "").trim()}`
          : "",
        approvedAsset?.title
          ? `Nombre del asset aprobado: ${String(approvedAsset.title || "").trim()}`
          : "",
        mode === "improve"
          ? "HTML actual de referencia:"
          : "Plantilla base de referencia:",
        String(
          mode === "improve"
            ? currentDraft.html_content || DEFAULT_HTML
            : DEFAULT_HTML,
        )
          .trim()
          .slice(0, 50000),
        "Instrucciones del usuario:",
        prompt,
      ].join("\n\n");

      const messageRes = await api.post("/api/chatbot/messages", {
        sessionId,
        message: aiInstruction,
        useContext: false,
        featureCode: "chatbot.assistant",
      });

      const jobId = String(messageRes?.data?.jobId || "").trim();
      if (!jobId) throw new Error("No fue posible iniciar generación IA");

      setAiProgressText("Generando correo con IA...");

      let attempts = 0;
      let jobCompleted = false;
      while (attempts < 35) {
        attempts += 1;
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
        const jobRes = await api.get(
          `/api/chatbot/jobs/${encodeURIComponent(jobId)}`,
        );
        const status = String(jobRes?.data?.status || "queued").trim();

        if (status === "completed") {
          jobCompleted = true;
          break;
        }

        if (status === "failed") {
          throw new Error("La IA no pudo completar la generación");
        }
      }

      if (!jobCompleted) {
        throw new Error("Tiempo de espera agotado para IA");
      }

      const historyRes = await api.get(
        `/api/chatbot/sessions/${encodeURIComponent(sessionId)}/messages`,
      );
      const messages = Array.isArray(historyRes?.data?.items)
        ? historyRes.data.items
        : [];
      const assistantMessage = [...messages]
        .reverse()
        .find((item) => String(item?.role || "").trim() === "assistant");
      const assistantContent = String(assistantMessage?.content || "").trim();
      const generatedPayload = extractEmailAiPayload(assistantContent);
      if (!generatedPayload?.html) {
        throw new Error(
          "La IA no devolvió asunto, preheader o HTML utilizable",
        );
      }

      updateDraft({
        subject:
          generatedPayload.subject ||
          currentDraft.subject ||
          "Asunto del correo",
        preheader: generatedPayload.preheader || currentDraft.preheader || "",
        html_content: generatedPayload.html,
      });
      setSuccess(
        mode === "improve"
          ? "Correo mejorado con IA"
          : "Correo generado con IA",
      );
      return;
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible generar el correo con IA",
        ),
      );
      setSuccess("");
    } finally {
      setIsGeneratingWithAi(false);
      setAiProgressText("");
    }
  }

  async function handleSubmitAiPrompt(event) {
    event.preventDefault();
    const prompt = String(aiPromptText || "").trim();
    if (!prompt) {
      setError("Debes escribir instrucciones para IA");
      setSuccess("");
      return;
    }

    setIsAiPromptModalOpen(false);
    await handleGenerateEmailWithAi(prompt, aiActionMode);
  }

  return (
    <section className="campaign-email-page">
      <header className="campaign-email-head">
        <div>
          <h2>Correos de campana</h2>
          <p>
            Modulo temporal para crear, organizar y monitorear correos ligados a
            campanas y su audiencia objetivo.
          </p>
        </div>
        <div className="campaign-email-head-actions">
          <NavLink className="campaign-email-inline-link" to="/campaigns">
            Volver a Campanas
          </NavLink>
          <NavLink className="campaign-email-inline-link" to="/landing">
            Ir a Landing por evento
          </NavLink>
        </div>
      </header>

      <div
        className="campaign-email-tabs"
        role="tablist"
        aria-label="Secciones correo"
      >
        {MODULE_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={activeTab === tab.key ? "is-active" : ""}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="campaign-email-alert campaign-email-alert-error">
          <span>{error}</span>
          <button
            type="button"
            className="campaign-email-alert-close"
            onClick={() => setError("")}
            aria-label="Cerrar notificacion de error"
          >
            ×
          </button>
        </div>
      ) : null}
      {success ? (
        <div className="campaign-email-alert campaign-email-alert-success">
          <span>{success}</span>
          <button
            type="button"
            className="campaign-email-alert-close"
            onClick={() => setSuccess("")}
            aria-label="Cerrar notificacion de exito"
          >
            ×
          </button>
        </div>
      ) : null}

      <section className="campaign-email-panel">
        <div className="campaign-email-grid-two campaign-email-grid-main">
          <article className="campaign-email-card campaign-email-sidebar-card">
            <div className="campaign-email-list-head">
              <h3>Campanas</h3>
              <small>{campaigns.length} registradas</small>
            </div>
            {isLoadingCampaigns ? (
              <p className="campaign-email-muted">Cargando campanas...</p>
            ) : null}
            {!isLoadingCampaigns && campaigns.length === 0 ? (
              <p className="campaign-email-muted">
                No hay campanas disponibles.
              </p>
            ) : null}
            <div className="campaign-email-campaign-list">
              {campaigns.map((campaign) => {
                const isSelected =
                  Number(campaign.id) === Number(selectedCampaignId);
                return (
                  <button
                    key={campaign.id}
                    type="button"
                    className={isSelected ? "is-selected" : ""}
                    onClick={() => {
                      setSelectedCampaignId(Number(campaign.id));
                      setSuccess("");
                      setError("");
                    }}
                  >
                    <strong>{campaign.name}</strong>
                    <span>
                      {formatLabel(campaign.tipo_campana)} ·{" "}
                      {formatLabel(campaign.subtipo_campana)}
                    </span>
                  </button>
                );
              })}
            </div>
          </article>

          <article className="campaign-email-card">
            {selectedCampaign ? (
              <>
                <div className="campaign-email-summary-head">
                  <div>
                    <h3>{selectedCampaign.name}</h3>
                    <p>
                      {formatLabel(selectedCampaign.tipo_campana)} ·{" "}
                      {formatLabel(selectedCampaign.subtipo_campana)} ·{" "}
                      {formatLabel(selectedCampaign.estado_campana)}
                    </p>
                  </div>
                  <div className="campaign-email-metrics">
                    <div>
                      <strong>{audienceAccountsCount}</strong>
                      <span>Cuentas</span>
                    </div>
                    <div>
                      <strong>{audienceContactsCount}</strong>
                      <span>Contactos</span>
                    </div>
                  </div>
                </div>

                {activeTab === "overview" ? (
                  <div className="campaign-email-content-grid">
                    <label>
                      Asunto
                      <input
                        value={currentDraft.subject}
                        onChange={(event) =>
                          updateDraft({ subject: event.target.value })
                        }
                        placeholder="Asunto del correo"
                      />
                    </label>
                    <label>
                      Tipo de correo
                      <select
                        value={currentDraft.send_type}
                        onChange={(event) =>
                          updateDraft({ send_type: event.target.value })
                        }
                      >
                        <option value="correo_masivo">
                          {`Correo masivo - ${EMAIL_TYPE_DESCRIPTIONS.correo_masivo}`}
                        </option>
                        <option value="secuencia">
                          {`Secuencia - ${EMAIL_TYPE_DESCRIPTIONS.secuencia}`}
                        </option>
                        <option value="recordatorio">
                          {`Recordatorio - ${EMAIL_TYPE_DESCRIPTIONS.recordatorio}`}
                        </option>
                        <option value="seguimiento">
                          {`Seguimiento - ${EMAIL_TYPE_DESCRIPTIONS.seguimiento}`}
                        </option>
                      </select>
                    </label>
                    <label>
                      CTA principal
                      <select
                        value=""
                        onChange={(event) => {
                          const value = String(event.target.value || "").trim();
                          if (value) {
                            updateDraft({ cta_label: value });
                          }
                        }}
                      >
                        <option value="">Seleccionar sugerencia...</option>
                        {CTA_SUGGESTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                      <input
                        value={currentDraft.cta_label}
                        onChange={(event) =>
                          updateDraft({ cta_label: event.target.value })
                        }
                        placeholder="Ej. Registrarme"
                      />
                      <small className="campaign-email-field-help">
                        Es el texto del boton o enlace principal que debe
                        motivar la accion esperada del destinatario.
                      </small>
                    </label>
                    <label className="campaign-email-field-wide">
                      URL CTA
                      <select
                        value=""
                        onChange={(event) => {
                          const value = String(event.target.value || "").trim();
                          if (value) {
                            updateDraft({ cta_url: value });
                          }
                        }}
                      >
                        <option value="">Seleccionar landing creada...</option>
                        {visibleLandingUrlSuggestions.length > 0 ? (
                          visibleLandingUrlSuggestions.map((entry) => (
                            <option key={entry.url} value={entry.url}>
                              {`${entry.eventName || "Landing"} (${entry.slug})`}
                            </option>
                          ))
                        ) : (
                          <option value="" disabled>
                            No hay landings relacionadas para esta campaña
                          </option>
                        )}
                      </select>
                      <input
                        value={currentDraft.cta_url}
                        onChange={(event) =>
                          updateDraft({ cta_url: event.target.value })
                        }
                        placeholder="https://..."
                      />
                    </label>
                    <div className="campaign-email-inline-actions campaign-email-field-wide">
                      <button type="button" onClick={handleSaveLocalDraft}>
                        Guardar borrador local
                      </button>
                    </div>
                  </div>
                ) : null}

                {activeTab === "editor" ? (
                  <div className="campaign-email-editor-layout">
                    <div className="campaign-email-content-grid">
                      <label>
                        Asunto
                        <input
                          value={currentDraft.subject}
                          onChange={(event) =>
                            updateDraft({ subject: event.target.value })
                          }
                          placeholder="Asunto del correo"
                        />
                      </label>
                      <label>
                        Preheader
                        <input
                          value={currentDraft.preheader}
                          onChange={(event) =>
                            updateDraft({ preheader: event.target.value })
                          }
                          placeholder="Texto corto de apoyo"
                        />
                      </label>
                      <div className="campaign-email-test-recipient-row campaign-email-field-wide">
                        <label>
                          Correos de prueba
                          <input
                            value={currentDraft.test_recipients}
                            onChange={(event) =>
                              updateDraft({
                                test_recipients: event.target.value,
                              })
                            }
                            placeholder="correo1@empresa.com, correo2@empresa.com"
                          />
                        </label>
                        <button
                          type="button"
                          className="campaign-email-test-send-inline"
                          onClick={handleSendTestEmail}
                          disabled={isSendingTestEmail}
                        >
                          {isSendingTestEmail
                            ? "Enviando prueba..."
                            : "Enviar prueba"}
                        </button>
                      </div>
                      {testSendSummary ? (
                        <div className="campaign-email-test-send-summary campaign-email-field-wide">
                          <strong>Resultado de envio de prueba</strong>
                          <span>
                            Total: {Number(testSendSummary.total || 0)} ·
                            Exitos: {Number(testSendSummary.sent || 0)} ·
                            Fallidos: {Number(testSendSummary.failed || 0)} ·
                            Invalidos: {Number(testSendSummary.invalid || 0)}
                          </span>
                        </div>
                      ) : null}
                      {testSendResults.length > 0 ? (
                        <div className="campaign-email-test-send-table-wrap campaign-email-field-wide">
                          <table className="campaign-email-test-send-table">
                            <thead>
                              <tr>
                                <th>Correo</th>
                                <th>Estado</th>
                                <th>Detalle</th>
                              </tr>
                            </thead>
                            <tbody>
                              {testSendResults.map((item) => (
                                <tr key={`${item.email}-${item.status}`}>
                                  <td>{item.email}</td>
                                  <td>{item.status}</td>
                                  <td>{item.message}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                      <div className="campaign-email-editor-actions campaign-email-field-wide">
                        <button
                          type="button"
                          className="campaign-email-ai-action"
                          onClick={() => handleOpenAiPromptModal("generate")}
                          disabled={isGeneratingWithAi}
                          title="Generar desde cero con IA"
                          aria-label="Generar desde cero con IA"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            width="16"
                            height="16"
                            fill="currentColor"
                            aria-hidden="true"
                            focusable="false"
                          >
                            <path d="M12 2l1.09 3.26L16.5 6l-3.41 1.09L12 10.5l-1.09-3.41L7.5 6l3.41-1.09L12 2zm6 10l.73 2.18L21 15l-2.27.73L18 18l-.73-2.27L15 15l2.27-.73L18 12zm-12 0l.73 2.18L9 15l-2.27.73L6 18l-.73-2.27L3 15l2.27-.73L6 12z" />
                          </svg>
                          <span>Generar desde cero</span>
                        </button>
                        <button
                          type="button"
                          className="campaign-email-ai-action campaign-email-ai-action-secondary"
                          onClick={() => handleOpenAiPromptModal("improve")}
                          disabled={isGeneratingWithAi}
                          title="Mejorar HTML actual con IA"
                          aria-label="Mejorar HTML actual con IA"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            width="16"
                            height="16"
                            fill="currentColor"
                            aria-hidden="true"
                            focusable="false"
                          >
                            <path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zm14.71-9.04a1.003 1.003 0 000-1.42l-2.5-2.5a1.003 1.003 0 00-1.42 0l-1.96 1.96 3.75 3.75 2.13-1.79z" />
                          </svg>
                          <span>Mejorar HTML actual</span>
                        </button>
                        <button
                          type="button"
                          className="campaign-email-ai-action campaign-email-ai-action-secondary"
                          onClick={handleLocalizeExternalImages}
                          disabled={isGeneratingWithAi || isLocalizingImages}
                          title="Descargar imágenes externas"
                          aria-label="Descargar imágenes externas"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            width="16"
                            height="16"
                            fill="currentColor"
                            aria-hidden="true"
                            focusable="false"
                          >
                            <path d="M12 3a1 1 0 011 1v8.59l2.3-2.29a1 1 0 111.4 1.42l-4 3.98a1 1 0 01-1.4 0l-4-3.98a1 1 0 111.4-1.42L11 12.59V4a1 1 0 011-1zM5 17a1 1 0 011 1v1h12v-1a1 1 0 112 0v2a1 1 0 01-1 1H5a1 1 0 01-1-1v-2a1 1 0 011-1z" />
                          </svg>
                          <span>
                            {isLocalizingImages
                              ? "Descargando imágenes..."
                              : "Descargar imágenes"}
                          </span>
                        </button>
                      </div>
                      <label className="campaign-email-field-wide">
                        <span>HTML del correo</span>
                        <textarea
                          value={currentDraft.html_content}
                          onChange={(event) =>
                            updateDraft({ html_content: event.target.value })
                          }
                          onBlur={() => {
                            handleLocalizeExternalImages();
                          }}
                          rows={18}
                        />
                      </label>
                    </div>
                    <div className="campaign-email-preview-card">
                      <div className="campaign-email-preview-meta">
                        <strong>{currentDraft.subject || "Sin asunto"}</strong>
                        <span>{currentDraft.preheader || "Sin preheader"}</span>
                      </div>
                      <iframe
                        title="Vista previa del correo"
                        className="campaign-email-preview-frame"
                        srcDoc={currentDraft.html_content || DEFAULT_HTML}
                      />
                    </div>
                  </div>
                ) : null}

                {activeTab === "schedule" ? (
                  <div className="campaign-email-content-grid">
                    <label>
                      Fecha programada
                      <input
                        type="date"
                        value={currentDraft.scheduled_at}
                        onChange={(event) =>
                          updateDraft({ scheduled_at: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Tamano de lote
                      <input type="number" min="1" value="50" disabled />
                    </label>
                    <label>
                      Numero maximo de envios por hora
                      <input type="number" min="1" value="50" disabled />
                    </label>
                    <label>
                      Numero maximo de envios por dia
                      <input type="number" min="1" value="300" disabled />
                    </label>
                    <div className="campaign-email-schedule-hints campaign-email-field-wide">
                      <div>
                        <strong>Configuracion activa (V1)</strong>
                        <ul>
                          <li>Envio automatico en cola: maximo 50 por hora.</li>
                          <li>
                            Tope diario estricto: maximo 300 enviados por dia.
                          </li>
                          <li>
                            Cuando llega al tope diario, el envio continua al
                            dia siguiente.
                          </li>
                        </ul>
                      </div>
                    </div>
                    <div className="campaign-email-inline-actions campaign-email-field-wide">
                      <button
                        type="button"
                        onClick={handleStartCampaignSend}
                        disabled={isStartingSend || isLoadingAudience}
                      >
                        {isStartingSend
                          ? "Iniciando envío..."
                          : "Iniciar envío de correos"}
                      </button>
                      <button
                        type="button"
                        onClick={refreshDispatchStatus}
                        disabled={isLoadingDispatch || !campaignDispatch?.id}
                      >
                        {isLoadingDispatch
                          ? "Actualizando..."
                          : "Actualizar estado"}
                      </button>
                      {campaignDispatch?.status === "running" ? (
                        <button
                          type="button"
                          onClick={handlePauseDispatch}
                          disabled={isUpdatingDispatch}
                        >
                          {isUpdatingDispatch ? "Procesando..." : "Pausar"}
                        </button>
                      ) : null}
                      {campaignDispatch?.status === "paused" ||
                      campaignDispatch?.status === "failed" ? (
                        <button
                          type="button"
                          onClick={handleResumeDispatch}
                          disabled={isUpdatingDispatch}
                        >
                          {isUpdatingDispatch ? "Procesando..." : "Reanudar"}
                        </button>
                      ) : null}
                      {campaignDispatch?.status === "running" ||
                      campaignDispatch?.status === "paused" ? (
                        <button
                          type="button"
                          onClick={handleCancelDispatch}
                          disabled={isUpdatingDispatch}
                        >
                          {isUpdatingDispatch ? "Procesando..." : "Cancelar"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {activeTab === "results" ? (
                  <div className="campaign-email-results-grid">
                    <article>
                      <strong>
                        {formatDispatchStatus(campaignDispatch?.status)}
                      </strong>
                      <span>Estado de la corrida</span>
                    </article>
                    <article>
                      <strong>
                        {Number(campaignDispatch?.summary?.total || 0)}
                      </strong>
                      <span>Total en cola</span>
                    </article>
                    <article>
                      <strong>
                        {Number(campaignDispatch?.summary?.sent || 0)}
                      </strong>
                      <span>Enviados</span>
                    </article>
                    <article>
                      <strong>
                        {Number(campaignDispatch?.summary?.pending || 0)}
                      </strong>
                      <span>Pendientes</span>
                    </article>
                    <article>
                      <strong>
                        {Number(campaignDispatch?.summary?.failed || 0)}
                      </strong>
                      <span>Fallidos</span>
                    </article>
                    <article>
                      <strong>
                        {Number(campaignDispatch?.summary?.skipped || 0)}
                      </strong>
                      <span>Omitidos</span>
                    </article>
                    <article>
                      <strong>
                        {Number(campaignDispatch?.summary?.sentLastHour || 0)}
                      </strong>
                      <span>Enviados ultima hora</span>
                    </article>
                    <article>
                      <strong>
                        {Number(campaignDispatch?.summary?.sentToday || 0)}
                      </strong>
                      <span>Enviados hoy</span>
                    </article>
                    <article className="campaign-email-field-wide">
                      <strong>
                        Inicio: {formatDateTime(campaignDispatch?.startedAt)} ·
                        Fin: {formatDateTime(campaignDispatch?.finishedAt)}
                      </strong>
                      <span>
                        Siguiente reintento:{" "}
                        {formatDateTime(campaignDispatch?.summary?.nextRetryAt)}
                      </span>
                    </article>
                    {campaignDispatch?.lastErrorMessage ? (
                      <article className="campaign-email-field-wide">
                        <strong>Ultimo error</strong>
                        <span>{campaignDispatch.lastErrorMessage}</span>
                      </article>
                    ) : null}
                    {campaignDispatchResults.length > 0 ? (
                      <div className="campaign-email-test-send-table-wrap campaign-email-field-wide">
                        <table className="campaign-email-test-send-table">
                          <thead>
                            <tr>
                              <th>Correo</th>
                              <th>Estado</th>
                              <th>Detalle</th>
                            </tr>
                          </thead>
                          <tbody>
                            {campaignDispatchResults
                              .slice(0, 80)
                              .map((item) => (
                                <tr
                                  key={`${item.email}-${item.status}-${item.updatedAt || ""}`}
                                >
                                  <td>{item.email}</td>
                                  <td>{item.status}</td>
                                  <td>{item.message}</td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="campaign-email-muted">
                Selecciona una campana para comenzar.
              </p>
            )}
          </article>
        </div>
      </section>

      {isAiPromptModalOpen ? (
        <div
          className="campaign-email-ai-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Instrucciones para generar correo con IA"
        >
          <form
            className="campaign-email-ai-modal"
            onSubmit={handleSubmitAiPrompt}
          >
            <h4>Instrucciones para IA</h4>
            <p>
              {aiActionMode === "improve"
                ? "Describe cómo mejorar el correo actual. La IA ajustará asunto, preheader y HTML usando como base lo ya definido."
                : "Describe cómo debe generarse el correo desde cero. La IA propondrá asunto, preheader y HTML usando como contexto la campaña y el CTA."}
            </p>
            <textarea
              className="campaign-email-ai-prompt-textarea"
              value={aiPromptText}
              onChange={(event) => setAiPromptText(event.target.value)}
              rows={10}
              placeholder={[
                "Objetivo del correo:",
                "Audiencia:",
                "Tono:",
                "CTA:",
                aiActionMode === "improve"
                  ? "Cambios puntuales sobre el correo actual:"
                  : "Lineamientos para generar el correo desde cero:",
              ].join("\n")}
              autoFocus
            />
            <div className="campaign-email-ai-modal-actions">
              <button
                type="button"
                className="campaign-email-ai-cancel-button"
                onClick={handleCloseAiPromptModal}
              >
                Cancelar
              </button>
              <button type="submit" className="campaign-email-ai-submit-button">
                {aiActionMode === "improve"
                  ? "Mejorar con IA"
                  : "Generar con IA"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {isAssetSearchModalOpen ? (
        <div
          className="campaign-email-ai-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Buscar gráfico en internet"
        >
          <div className="campaign-email-ai-modal campaign-email-asset-modal">
            <h4>Buscar gráfico en internet</h4>
            <p>
              Busca imágenes o gráficos reales en internet y aprueba una antes
              de insertarla en el correo.
            </p>
            {assetSearchSuggestedQueries.length > 0 ? (
              <div className="campaign-email-asset-query-list">
                <strong>Consultas sugeridas por IA</strong>
                <ul>
                  {assetSearchSuggestedQueries.map((query) => (
                    <li key={query}>{query}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <form
              className="campaign-email-asset-search-form"
              onSubmit={handleSearchAssets}
            >
              <input
                value={assetSearchQuery}
                onChange={(event) => setAssetSearchQuery(event.target.value)}
                placeholder="Ej. growth chart cybersecurity business"
              />
              <div className="campaign-email-ai-modal-actions">
                <button
                  type="button"
                  className="campaign-email-ai-cancel-button"
                  onClick={handleCloseAssetSearchModal}
                >
                  Cerrar
                </button>
                <button
                  type="submit"
                  className="campaign-email-ai-submit-button"
                  disabled={isSearchingAssets}
                >
                  {isSearchingAssets ? "Buscando..." : "Buscar"}
                </button>
              </div>
            </form>

            <div className="campaign-email-asset-results">
              {!isSearchingAssets && assetSearchResults.length === 0 ? (
                <p className="campaign-email-muted">
                  Ejecuta una búsqueda para ver opciones aprobables.
                </p>
              ) : null}

              {assetSearchResults.map((asset) => (
                <article
                  key={asset.id || asset.sourceUrl}
                  className="campaign-email-asset-card"
                >
                  <img src={asset.thumbnailUrl} alt={asset.title} />
                  <div className="campaign-email-asset-card-body">
                    <strong>{asset.title || "Imagen"}</strong>
                    <small>
                      {asset.width > 0 && asset.height > 0
                        ? `${asset.width} x ${asset.height}`
                        : "Dimensiones no disponibles"}
                    </small>
                    <small>{asset.mime || "Tipo no disponible"}</small>
                    <div className="campaign-email-ai-modal-actions">
                      <a
                        className="campaign-email-inline-link"
                        href={asset.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Ver original
                      </a>
                      <button
                        type="button"
                        className="campaign-email-ai-submit-button"
                        onClick={() => handleApproveAsset(asset)}
                      >
                        Aprobar e insertar
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {isGeneratingWithAi ? (
        <div
          className="campaign-email-ai-modal-backdrop"
          role="status"
          aria-live="polite"
        >
          <div className="campaign-email-ai-modal">
            <div
              className="campaign-email-ai-modal-spinner"
              aria-hidden="true"
            />
            <h4>Generando correo con IA</h4>
            <p>{aiProgressText || "Procesando solicitud..."}</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
