import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, getApiErrorMessage } from "./api";
import "./landing-module.css";

const DEFAULT_FORM_SCHEMA = {
  form_schema_version: 1,
  submit: {
    button_text: "Registrarme",
    success_message: "Gracias por registrarte",
    redirect_url: null,
  },
  fields: [
    {
      key: "first_name",
      label: "Nombre",
      type: "text",
      required: true,
      placeholder: "Tu nombre",
      default_value: null,
      options: [],
      validation: {
        min_length: 2,
        max_length: 120,
        regex: null,
      },
      crm_map: {
        entity: "contact",
        field: "first_name",
        required_for_entity: true,
      },
    },
    {
      key: "email",
      label: "Correo",
      type: "email",
      required: true,
      placeholder: "correo@empresa.com",
      default_value: null,
      options: [],
      validation: {
        min_length: 5,
        max_length: 180,
        regex: null,
      },
      crm_map: {
        entity: "contact",
        field: "email",
        required_for_entity: true,
      },
    },
    {
      key: "company_name",
      label: "Empresa",
      type: "text",
      required: false,
      placeholder: "Nombre de empresa",
      default_value: null,
      options: [],
      validation: {
        min_length: 2,
        max_length: 180,
        regex: null,
      },
      crm_map: {
        entity: "account",
        field: "name",
        required_for_entity: false,
      },
    },
  ],
};

const DEFAULT_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Landing</title>
    <style>
      body { font-family: 'Segoe UI', Tahoma, sans-serif; margin: 0; background: linear-gradient(135deg,#eff5ff,#f9fbff); color: #123; }
      .wrap { max-width: 860px; margin: 0 auto; padding: 48px 20px 64px; }
      .hero { background: #fff; border: 1px solid #d8e3f5; border-radius: 16px; padding: 28px; box-shadow: 0 16px 36px rgba(18,57,119,.08); }
      h1 { margin: 0 0 10px; color: #133a6f; }
      p { margin: 0 0 16px; color: #36537a; }
      form { display: grid; gap: 12px; margin-top: 20px; }
      input, button { border-radius: 10px; border: 1px solid #b6c9e6; padding: 10px 12px; font-size: 14px; }
      button { background: #0f4d9d; color: #fff; border-color: #0f4d9d; font-weight: 600; cursor: pointer; }
      button:hover { background: #0b3f82; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <section class="hero">
        <h1>Webinar F5</h1>
        <p>Regístrate para asegurar tu lugar.</p>
        <form data-landing-form>
          <input name="first_name" placeholder="Nombre" />
          <input name="email" type="email" placeholder="Correo" />
          <input name="company_name" placeholder="Empresa" />
          <input name="hp_field" type="text" style="display:none" tabindex="-1" autocomplete="off" />
          <button type="submit">Registrarme</button>
        </form>
      </section>
    </div>
  </body>
</html>`;

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function parseJsonOrThrow(text, fallbackMessage) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    throw new Error(fallbackMessage);
  }
}

function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 120);
}

function cleanTextLine(value, max = 220) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const COMPANY_DOMAIN_OVERRIDES = {
  aws: "aws.amazon.com",
  amazon: "amazon.com",
  microsoft: "microsoft.com",
  azure: "azure.microsoft.com",
  google: "google.com",
  gcp: "cloud.google.com",
  ibm: "ibm.com",
  oracle: "oracle.com",
  sap: "sap.com",
  salesforce: "salesforce.com",
  f5: "f5.com",
  cisco: "cisco.com",
  fortinet: "fortinet.com",
  paloalto: "paloaltonetworks.com",
  samsung: "samsung.com",
  hp: "hp.com",
  intel: "intel.com",
  amd: "amd.com",
  dell: "dell.com",
  lenovo: "lenovo.com",
  hpe: "hpe.com",
  vmware: "vmware.com",
  servicenow: "servicenow.com",
  adobe: "adobe.com",
  hubspot: "hubspot.com",
  stripe: "stripe.com",
  shopify: "shopify.com",
  nvidia: "nvidia.com",
};

function normalizeCompanyKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCaseWords(value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function extractRequestedLogoCompanies(prompt) {
  const text = String(prompt || "");
  if (!/logo|logotipo/i.test(text)) return [];

  const collected = [];
  const logoClauses = [
    ...text.matchAll(/(?:logos?|logotipos?)\s+(?:de|del|para)\s+([^\n.;:]+)/gi),
    ...text.matchAll(
      /(?:incluir|agregar|anadir|mostrar)\s+([^\n.;:]+?)\s+(?:como\s+)?(?:logos?|logotipos?)/gi,
    ),
  ];

  for (const clauseMatch of logoClauses) {
    const clause = String(clauseMatch[1] || "").trim();
    if (!clause) continue;
    const parts = clause
      .replace(/\s+y\s+/gi, ",")
      .split(",")
      .map((item) => cleanTextLine(item, 80))
      .map((item) => item.replace(/^(de|del|la|el|los|las)\s+/i, "").trim())
      .filter(Boolean);
    collected.push(...parts);
  }

  const normalized = new Set();
  const output = [];
  for (const company of collected) {
    const key = normalizeCompanyKey(company);
    if (!key || normalized.has(key)) continue;
    normalized.add(key);
    output.push(titleCaseWords(company));
  }

  return output.slice(0, 8);
}

function resolveCompanyDomain(companyName) {
  const key = normalizeCompanyKey(companyName).replace(/\s+/g, "");
  if (COMPANY_DOMAIN_OVERRIDES[key]) {
    return COMPANY_DOMAIN_OVERRIDES[key];
  }

  const tokenizedKey = normalizeCompanyKey(companyName).split(" ")[0] || "";
  if (COMPANY_DOMAIN_OVERRIDES[tokenizedKey]) {
    return COMPANY_DOMAIN_OVERRIDES[tokenizedKey];
  }

  const slug = normalizeCompanyKey(companyName).replace(/\s+/g, "");
  return slug ? `${slug}.com` : "example.com";
}

function buildLogoHintLines(prompt) {
  const companies = extractRequestedLogoCompanies(prompt);
  if (!companies.length) return "";

  return companies
    .map((company) => {
      const domain = resolveCompanyDomain(company);
      const logoUrl = `https://logo.clearbit.com/${domain}`;
      const fallbackUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
      return `- ${company}: domain=${domain}; primary=${logoUrl}; fallback=${fallbackUrl}`;
    })
    .join("\n");
}

function extractHtmlFromAssistantText(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const fencedMatch = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : text;

  if (!candidate) return "";
  if (!/<!doctype html>|<html[\s>]|<body[\s>]/i.test(candidate)) return "";
  return candidate;
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function generateLandingHtmlWithChatbotAi({
  prompt,
  eventName,
  slug,
  formSchema,
  currentHtml,
  onStatus,
  shouldCancel,
}) {
  const throwIfCancelled = () => {
    if (typeof shouldCancel === "function" && shouldCancel()) {
      const error = new Error("Generación con IA cancelada");
      error.code = "AI_GENERATION_CANCELLED";
      throw error;
    }
  };

  throwIfCancelled();

  if (typeof onStatus === "function") {
    onStatus("Iniciando sesion de IA...");
  }

  const sessionRes = await api.post("/api/chatbot/sessions", {
    locale: "es",
    userContext: {
      module: "landing",
      objective: "generate_html_landing",
      eventName: String(eventName || "").trim(),
      slug: String(slug || "").trim(),
    },
  });

  const sessionId = String(sessionRes?.data?.sessionId || "").trim();
  if (!sessionId) {
    throw new Error("No fue posible crear sesion IA");
  }

  throwIfCancelled();

  if (typeof onStatus === "function") {
    onStatus("Enviando instrucciones al asistente...");
  }

  const fields = Array.isArray(formSchema?.fields) ? formSchema.fields : [];
  const baseHtml = String(currentHtml || "").trim();
  const baseHtmlSnippet = baseHtml.slice(0, 1600);
  const promptText = String(prompt || "")
    .trim()
    .slice(0, 2400);
  const logoHints = buildLogoHintLines(promptText);
  const requiredFieldHints = fields
    .slice(0, 10)
    .map((field) => {
      const key = cleanTextLine(field?.key || "", 60);
      const type = cleanTextLine(field?.type || "text", 20);
      if (!key) return "";
      const suffix = field?.required ? " (required)" : "";
      return `- ${key}: ${type}${suffix}`;
    })
    .filter(Boolean)
    .join("\n");

  const aiInstruction = [
    "Edita el HTML existente de una landing page para registro de webinar.",
    "Devuelve una version completa actualizada del HTML (no un fragmento).",
    "Puedes agregar, modificar o eliminar contenido del HTML existente.",
    "Conserva la estructura base y cambia solo lo necesario segun el prompt.",
    "Si el prompt pide logos, crea una seccion visual de logos y usa URLs absolutas https confiables.",
    "Para imagenes de logos usa <img> con width/height, object-fit: contain, loading='lazy' y alt descriptivo.",
    "En logos, usa fallback con onerror a una URL de icono funcional si el logo principal falla.",
    "Responde solo con HTML valido (sin explicaciones, sin markdown).",
    "Incluye formulario con atributo data-landing-form y conserva campo hp_field oculto.",
    "Incluye diseno moderno responsive (desktop y mobile) con CSS inline dentro de <style>.",
    "Usa copy en espanol orientado a conversion.",
    `Evento: ${cleanTextLine(eventName || "Webinar", 180)}`,
    `Slug: ${cleanTextLine(slug || "landing", 120)}`,
    "Campos sugeridos en formulario:",
    requiredFieldHints ||
      "- first_name: text (required)\n- email: email (required)\n- company_name: text",
    logoHints ? "Sugerencias de logos (usar estas URLs):" : "",
    logoHints,
    "Instrucciones del usuario:",
    promptText || "Mejorar propuesta de valor y claridad del CTA.",
    "HTML actual (extracto de referencia):",
    baseHtmlSnippet ||
      "<html><body><form data-landing-form></form></body></html>",
  ].join("\n\n");

  const messageRes = await api.post("/api/chatbot/messages", {
    sessionId,
    message: aiInstruction,
    useContext: true,
    contextSnapshot: {
      module: "landing",
      eventName: String(eventName || "").trim(),
      slug: String(slug || "").trim(),
      currentHtml: baseHtml.slice(0, 50_000),
      prompt: promptText,
    },
    featureCode: "chatbot.assistant",
  });

  const jobId = String(messageRes?.data?.jobId || "").trim();
  if (!jobId) {
    throw new Error("No fue posible iniciar generacion IA");
  }

  throwIfCancelled();

  if (typeof onStatus === "function") {
    onStatus("La IA esta construyendo tu landing...");
  }

  let attempts = 0;
  let jobCompleted = false;
  while (attempts < 35) {
    throwIfCancelled();
    attempts += 1;
    const jobRes = await api.get(
      `/api/chatbot/jobs/${encodeURIComponent(jobId)}`,
    );
    const status = String(jobRes?.data?.status || "queued").trim();

    if (typeof onStatus === "function") {
      if (status === "queued") {
        onStatus("La solicitud esta en cola...");
      } else if (status === "running") {
        onStatus("Generando HTML con IA...");
      }
    }

    if (status === "completed") {
      jobCompleted = true;
      break;
    }

    if (status === "failed" || status === "cancelled") {
      const reason = String(jobRes?.data?.error?.message || "").trim();
      throw new Error(reason || "La IA no pudo generar la landing");
    }

    await delay(1200);
  }

  if (!jobCompleted) {
    throw new Error(
      "La IA no termino de generar la landing en el tiempo esperado. Intenta de nuevo.",
    );
  }

  throwIfCancelled();

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
  const html = extractHtmlFromAssistantText(assistantContent);
  if (!html) {
    throw new Error("La IA no devolvio HTML utilizable");
  }

  if (typeof onStatus === "function") {
    onStatus("Aplicando resultado de IA...");
  }

  return html;
}

export default function LandingModulePage() {
  const [activeTab, setActiveTab] = useState("events");

  const [globalError, setGlobalError] = useState("");
  const [globalSuccess, setGlobalSuccess] = useState("");

  const [isLoadingList, setIsLoadingList] = useState(false);
  const [landingItems, setLandingItems] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [selectedLandingId, setSelectedLandingId] = useState(null);
  const [selectedEventId, setSelectedEventId] = useState(null);

  const [landingDetail, setLandingDetail] = useState(null);
  const [selectedVersionId, setSelectedVersionId] = useState(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  const [newEventName, setNewEventName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newSourceType, setNewSourceType] = useState("manual_edit");

  const [editorHtml, setEditorHtml] = useState(DEFAULT_HTML);
  const [editorFormSchemaText, setEditorFormSchemaText] = useState(
    prettyJson(DEFAULT_FORM_SCHEMA),
  );
  const [importUrl, setImportUrl] = useState("");
  const [uploadFile, setUploadFile] = useState(null);
  const [isSavingEditor, setIsSavingEditor] = useState(false);
  const [isAiPromptModalOpen, setIsAiPromptModalOpen] = useState(false);
  const [aiPromptText, setAiPromptText] = useState("");
  const [isGeneratingWithAi, setIsGeneratingWithAi] = useState(false);
  const [isAiCancelRequested, setIsAiCancelRequested] = useState(false);
  const [aiProgressText, setAiProgressText] = useState(
    "Generando landing con IA...",
  );
  const aiGenerationCancelRef = useRef(false);

  const [submissions, setSubmissions] = useState([]);
  const [isLoadingSubmissions, setIsLoadingSubmissions] = useState(false);
  const [crmStatusFilter, setCrmStatusFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const selectedVersion = useMemo(() => {
    const versions = Array.isArray(landingDetail?.versions)
      ? landingDetail.versions
      : [];
    return (
      versions.find(
        (version) => Number(version.id) === Number(selectedVersionId),
      ) || null
    );
  }, [landingDetail, selectedVersionId]);

  const isSelectedLandingPublished =
    String(landingDetail?.landing_page?.status || "")
      .trim()
      .toLowerCase() === "published";

  const selectedPublicUrl = useMemo(() => {
    if (!isSelectedLandingPublished) return "";
    const slug = String(landingDetail?.landing_page?.slug || "").trim();
    if (!slug) return "";
    const apiBaseUrl = String(api.defaults.baseURL || window.location.origin)
      .trim()
      .replace(/\/+$/, "");
    return `${apiBaseUrl}/landing/${slug}.html`;
  }, [isSelectedLandingPublished, landingDetail]);

  const nextAutoEventId = useMemo(() => {
    const eventIds = landingItems
      .map((item) => Number(item?.event_id || 0))
      .filter((value) => Number.isInteger(value) && value > 0);
    if (!eventIds.length) return 1;
    return Math.max(...eventIds) + 1;
  }, [landingItems]);

  const pushSuccess = useCallback((message) => {
    setGlobalSuccess(message);
    setGlobalError("");
  }, []);

  const pushError = useCallback((message) => {
    setGlobalError(message);
    setGlobalSuccess("");
  }, []);

  const loadLandingList = useCallback(async () => {
    try {
      setIsLoadingList(true);
      const { data } = await api.get("/api/landing/v1/landing-pages", {
        params: {
          page: 1,
          page_size: 100,
          status: statusFilter || undefined,
          search: searchText || undefined,
        },
      });
      const items = Array.isArray(data?.items) ? data.items : [];
      setLandingItems(items);

      if (!selectedLandingId && items[0]?.id) {
        setSelectedLandingId(Number(items[0].id));
        setSelectedEventId(Number(items[0].event_id));
      }
    } catch (error) {
      pushError(
        getApiErrorMessage(error, "No fue posible cargar las landings"),
      );
    } finally {
      setIsLoadingList(false);
    }
  }, [pushError, searchText, selectedLandingId, statusFilter]);

  const loadLandingDetail = useCallback(
    async (landingId) => {
      if (!landingId) return;
      try {
        setIsLoadingDetail(true);
        const { data } = await api.get(
          `/api/landing/v1/landing-pages/${landingId}`,
        );
        setLandingDetail(data || null);
        const currentVersionId = Number(
          data?.landing_page?.current_version_id || 0,
        );
        const versions = Array.isArray(data?.versions) ? data.versions : [];
        const nextVersionId =
          currentVersionId || Number(versions[0]?.id || 0) || null;
        setSelectedVersionId(nextVersionId);

        const currentVersion =
          versions.find(
            (version) => Number(version.id) === Number(nextVersionId),
          ) ||
          versions[0] ||
          null;
        if (currentVersion) {
          setEditorHtml(String(currentVersion.html_content || DEFAULT_HTML));
          const schemaValue =
            typeof currentVersion.form_schema_json === "string"
              ? parseJsonOrThrow(
                  currentVersion.form_schema_json,
                  "Schema JSON invalido en API",
                )
              : currentVersion.form_schema_json || DEFAULT_FORM_SCHEMA;
          setEditorFormSchemaText(prettyJson(schemaValue));
        }
      } catch (error) {
        pushError(
          getApiErrorMessage(
            error,
            "No fue posible cargar el detalle de la landing",
          ),
        );
      } finally {
        setIsLoadingDetail(false);
      }
    },
    [pushError],
  );

  const loadSubmissions = useCallback(async () => {
    if (!selectedEventId) {
      setSubmissions([]);
      return;
    }

    try {
      setIsLoadingSubmissions(true);
      const { data } = await api.get(
        `/api/landing/v1/events/${selectedEventId}/submissions`,
        {
          params: {
            page: 1,
            page_size: 100,
            crm_status: crmStatusFilter || undefined,
            from: fromDate || undefined,
            to: toDate || undefined,
          },
        },
      );

      setSubmissions(Array.isArray(data?.items) ? data.items : []);
    } catch (error) {
      pushError(
        getApiErrorMessage(
          error,
          "No fue posible cargar los registros del evento",
        ),
      );
    } finally {
      setIsLoadingSubmissions(false);
    }
  }, [crmStatusFilter, fromDate, pushError, selectedEventId, toDate]);

  useEffect(() => {
    loadLandingList();
  }, [loadLandingList]);

  useEffect(() => {
    if (!selectedLandingId) return;
    loadLandingDetail(selectedLandingId);
  }, [loadLandingDetail, selectedLandingId]);

  useEffect(() => {
    if (activeTab !== "submissions") return;
    loadSubmissions();
  }, [activeTab, loadSubmissions]);

  function onSelectLanding(item) {
    setSelectedLandingId(Number(item.id));
    setSelectedEventId(Number(item.event_id));
    setActiveTab("editor");
    setGlobalError("");
    setGlobalSuccess("");
  }

  async function handleCreateOrUpsertLanding(event) {
    event.preventDefault();
    setGlobalError("");
    setGlobalSuccess("");

    const eventId = Number(nextAutoEventId || 0);
    if (!Number.isInteger(eventId) || eventId <= 0) {
      pushError("Debes indicar un Event ID válido");
      return;
    }
    if (!String(newEventName || "").trim()) {
      pushError("Debes indicar el nombre del evento");
      return;
    }

    const normalizedSlug = normalizeSlug(newSlug);
    if (!normalizedSlug || normalizedSlug.length < 3) {
      pushError("El slug debe tener al menos 3 caracteres alfanuméricos");
      return;
    }

    let parsedSchema;
    try {
      parsedSchema = parseJsonOrThrow(
        editorFormSchemaText,
        "El schema del formulario no es JSON válido",
      );
    } catch (error) {
      pushError(error.message);
      return;
    }

    try {
      setIsSavingEditor(true);
      const { data } = await api.put(
        `/api/landing/v1/events/${eventId}/landing`,
        {
          eventName: String(newEventName || "").trim(),
          slug: normalizedSlug,
          source_type: newSourceType,
          initial_prompt: null,
          html_content: String(editorHtml || "").trim() || DEFAULT_HTML,
          source_url: null,
          form_schema: parsedSchema,
        },
      );

      const landingId = Number(data?.landing_page?.id || 0);
      if (landingId > 0) {
        setSelectedLandingId(landingId);
        setSelectedEventId(Number(data?.landing_page?.event_id || eventId));
        setActiveTab("editor");
        await loadLandingList();
        await loadLandingDetail(landingId);
      }

      pushSuccess("Landing guardada correctamente");
    } catch (error) {
      pushError(
        getApiErrorMessage(error, "No fue posible crear/actualizar la landing"),
      );
    } finally {
      setIsSavingEditor(false);
    }
  }

  async function handleSaveCurrentVersion() {
    if (!selectedLandingId || !selectedVersionId) {
      pushError("Selecciona una landing y versión para guardar");
      return;
    }

    let parsedSchema;
    try {
      parsedSchema = parseJsonOrThrow(
        editorFormSchemaText,
        "El schema del formulario no es JSON válido",
      );
    } catch (error) {
      pushError(error.message);
      return;
    }

    try {
      setIsSavingEditor(true);
      await api.patch(
        `/api/landing/v1/landing-pages/${selectedLandingId}/versions/${selectedVersionId}`,
        {
          html_content: String(editorHtml || "").trim(),
          form_schema: parsedSchema,
          publish_notes: null,
        },
      );
      await loadLandingDetail(selectedLandingId);
      pushSuccess("Versión actualizada");
    } catch (error) {
      pushError(getApiErrorMessage(error, "No fue posible guardar la versión"));
    } finally {
      setIsSavingEditor(false);
    }
  }

  async function handlePublishVersion() {
    if (!selectedLandingId || !selectedVersionId) {
      pushError("Selecciona una landing y versión para publicar");
      return;
    }

    try {
      setIsSavingEditor(true);
      await api.post(
        `/api/landing/v1/landing-pages/${selectedLandingId}/publish`,
        {
          version_id: Number(selectedVersionId),
        },
      );
      await loadLandingList();
      await loadLandingDetail(selectedLandingId);
      pushSuccess("Landing publicada");
    } catch (error) {
      pushError(
        getApiErrorMessage(error, "No fue posible publicar la landing"),
      );
    } finally {
      setIsSavingEditor(false);
    }
  }

  function handleOpenAiPromptModal() {
    if (!selectedLandingId) {
      pushError("Selecciona una landing antes de usar IA");
      return;
    }

    setAiPromptText((current) => {
      if (String(current || "").trim()) return current;
      return [
        "Objetivo:",
        "Audiencia:",
        "Propuesta de valor:",
        "CTA:",
        "Cambios puntuales sobre el HTML actual:",
      ].join("\n");
    });
    setIsAiPromptModalOpen(true);
  }

  async function handleGenerateLandingWithAiInstructions(initialPrompt) {
    if (!selectedLandingId) {
      pushError("Selecciona una landing antes de usar IA");
      return;
    }

    const landingPage = landingDetail?.landing_page || {};
    const eventId = Number(landingPage.event_id || 0);
    const slug = normalizeSlug(landingPage.slug || newSlug);
    const eventName = String(
      landingPage.event_name || newEventName || "",
    ).trim();

    if (!Number.isInteger(eventId) || eventId <= 0 || !slug || !eventName) {
      pushError(
        "No se pudo resolver Event ID, nombre del evento o slug para generar con IA",
      );
      return;
    }

    if (!String(initialPrompt).trim()) {
      pushError("Debes escribir instrucciones para IA");
      return;
    }

    let parsedSchema;
    try {
      parsedSchema = parseJsonOrThrow(
        editorFormSchemaText,
        "El schema del formulario no es JSON válido",
      );
    } catch (error) {
      pushError(error.message);
      return;
    }

    let suggestedHtml = "";
    aiGenerationCancelRef.current = false;
    setIsAiCancelRequested(false);

    try {
      setIsGeneratingWithAi(true);
      setAiProgressText("Preparando contexto para IA...");
      suggestedHtml = await generateLandingHtmlWithChatbotAi({
        prompt: initialPrompt,
        eventName,
        slug,
        formSchema: parsedSchema,
        currentHtml: String(
          selectedVersion?.html_content || editorHtml || "",
        ).trim(),
        onStatus: (message) => {
          if (String(message || "").trim()) {
            setAiProgressText(String(message).trim());
          }
        },
        shouldCancel: () => aiGenerationCancelRef.current,
      });
    } catch (error) {
      const wasCancelled =
        aiGenerationCancelRef.current ||
        String(error?.code || "").trim() === "AI_GENERATION_CANCELLED";
      if (wasCancelled) {
        pushError("Generación con IA cancelada");
        return;
      }

      const errorMessage =
        String(error?.message || "").trim() ||
        "No fue posible generar HTML con IA";
      pushError(errorMessage);
      return;
    } finally {
      setIsGeneratingWithAi(false);
      setAiProgressText("Generando landing con IA...");
    }

    if (aiGenerationCancelRef.current) {
      pushError("Generación con IA cancelada");
      return;
    }

    try {
      setIsSavingEditor(true);
      setEditorHtml(suggestedHtml);
      await api.put(`/api/landing/v1/events/${eventId}/landing`, {
        eventName,
        slug,
        source_type: "ai",
        initial_prompt: String(initialPrompt).trim(),
        html_content: suggestedHtml,
        source_url: null,
        form_schema: parsedSchema,
      });

      await loadLandingList();
      await loadLandingDetail(selectedLandingId);
      pushSuccess("HTML generado por IA y guardado como nueva versión");
    } catch (error) {
      pushError(
        getApiErrorMessage(error, "No fue posible guardar instrucciones de IA"),
      );
    } finally {
      setIsSavingEditor(false);
    }
  }

  function handleCancelAiGeneration() {
    aiGenerationCancelRef.current = true;
    setIsAiCancelRequested(true);
    setAiProgressText("Cancelando generación...");
  }

  function handleCloseAiPromptModal() {
    if (isGeneratingWithAi) return;
    setIsAiPromptModalOpen(false);
  }

  async function handleSubmitAiPrompt(event) {
    event.preventDefault();
    const prompt = String(aiPromptText || "").trim();
    if (!prompt) {
      pushError("Debes escribir instrucciones para IA");
      return;
    }

    setIsAiPromptModalOpen(false);
    await handleGenerateLandingWithAiInstructions(prompt);
  }

  function handlePreviewDraftLanding() {
    const htmlToRender = String(
      selectedVersion?.html_content || editorHtml || "",
    ).trim();
    if (!htmlToRender) {
      pushError("No hay contenido HTML para previsualizar");
      return;
    }

    try {
      const previewBlob = new Blob([htmlToRender], {
        type: "text/html;charset=utf-8",
      });
      const previewUrl = URL.createObjectURL(previewBlob);

      const tempLink = document.createElement("a");
      tempLink.href = previewUrl;
      tempLink.target = "_blank";
      tempLink.rel = "noopener noreferrer";
      tempLink.style.display = "none";
      document.body.appendChild(tempLink);
      tempLink.click();
      tempLink.remove();

      // Allow the new tab to start loading before revoking the object URL.
      window.setTimeout(() => {
        URL.revokeObjectURL(previewUrl);
      }, 60_000);
    } catch {
      pushError("No fue posible abrir la previsualización");
    }
  }

  async function handleImportUrl(event) {
    event.preventDefault();
    if (!selectedLandingId) {
      pushError("Primero selecciona una landing");
      return;
    }
    if (!String(importUrl || "").trim()) {
      pushError("Debes indicar una URL para importar");
      return;
    }

    const sourceUrl = String(importUrl || "").trim();

    try {
      setIsSavingEditor(true);
      const { data } = await api.post(
        `/api/landing/v1/landing-pages/${selectedLandingId}/import-url`,
        {
          source_url: sourceUrl,
        },
      );
      setImportUrl("");
      await loadLandingDetail(selectedLandingId);
      if (data?.version_id) {
        setSelectedVersionId(Number(data.version_id));
      }
      pushSuccess("Importación completada");
    } catch (error) {
      const apiMessage = getApiErrorMessage(
        error,
        "No fue posible importar la URL",
      );
      const requiresForce =
        String(apiMessage || "")
          .toLowerCase()
          .includes("solo se permite una vez por landing") ||
        Number(error?.response?.status) === 409;

      if (requiresForce) {
        const shouldReplace = window.confirm(
          "Esta landing ya tuvo una importación por URL. ¿Deseas reemplazarla con una nueva importación?",
        );
        if (shouldReplace) {
          try {
            const { data } = await api.post(
              `/api/landing/v1/landing-pages/${selectedLandingId}/import-url`,
              {
                source_url: sourceUrl,
                force: true,
              },
            );
            setImportUrl("");
            await loadLandingDetail(selectedLandingId);
            if (data?.version_id) {
              setSelectedVersionId(Number(data.version_id));
            }
            pushSuccess("Importación reemplazada correctamente");
            return;
          } catch (forceError) {
            pushError(
              getApiErrorMessage(
                forceError,
                "No fue posible reemplazar la importación",
              ),
            );
            return;
          }
        }
      }

      pushError(apiMessage);
    } finally {
      setIsSavingEditor(false);
    }
  }

  async function handleUploadHtml(event) {
    event.preventDefault();
    if (!selectedLandingId) {
      pushError("Primero selecciona una landing");
      return;
    }
    if (!uploadFile) {
      pushError("Selecciona un archivo HTML para subir");
      return;
    }

    try {
      setIsSavingEditor(true);
      const payload = new FormData();
      payload.append("file", uploadFile);
      payload.append("form_schema", editorFormSchemaText);
      const { data } = await api.post(
        `/api/landing/v1/landing-pages/${selectedLandingId}/versions/html-upload`,
        payload,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        },
      );

      setUploadFile(null);
      await loadLandingDetail(selectedLandingId);
      if (data?.version_id) {
        setSelectedVersionId(Number(data.version_id));
      }
      pushSuccess("Archivo HTML subido como nueva versión");
    } catch (error) {
      pushError(
        getApiErrorMessage(error, "No fue posible subir el archivo HTML"),
      );
    } finally {
      setIsSavingEditor(false);
    }
  }

  async function handleReprocessSubmission(submissionId) {
    try {
      await api.post(`/api/landing/v1/submissions/${submissionId}/reprocess`, {
        force: true,
      });
      pushSuccess("Registro enviado a reproceso");
      await loadSubmissions();
    } catch (error) {
      pushError(
        getApiErrorMessage(error, "No fue posible reprocesar el registro"),
      );
    }
  }

  function useVersionInEditor(version) {
    if (!version) return;
    setSelectedVersionId(Number(version.id));
    setEditorHtml(String(version.html_content || DEFAULT_HTML));
    const schemaValue =
      typeof version.form_schema_json === "string"
        ? parseJsonOrThrow(version.form_schema_json, "Schema JSON inválido")
        : version.form_schema_json || DEFAULT_FORM_SCHEMA;
    setEditorFormSchemaText(prettyJson(schemaValue));
  }

  return (
    <div className="landing-module-page">
      <header className="landing-module-head">
        <div>
          <h2>Landing por evento</h2>
          <p>
            Crea, edita y publica landings; captura registros y revisa la
            integración CRM.
          </p>
        </div>
      </header>

      <div
        className="landing-module-tabs"
        role="tablist"
        aria-label="Secciones landing"
      >
        <button
          className={activeTab === "events" ? "is-active" : ""}
          onClick={() => setActiveTab("events")}
        >
          Eventos / Landings
        </button>
        <button
          className={activeTab === "editor" ? "is-active" : ""}
          onClick={() => setActiveTab("editor")}
        >
          Editor / Publicación
        </button>
        <button
          className={activeTab === "submissions" ? "is-active" : ""}
          onClick={() => setActiveTab("submissions")}
        >
          Registros por evento
        </button>
      </div>

      {globalError ? (
        <div className="landing-alert landing-alert-error">{globalError}</div>
      ) : null}
      {globalSuccess ? (
        <div className="landing-alert landing-alert-success">
          {globalSuccess}
        </div>
      ) : null}

      {activeTab === "events" ? (
        <section className="landing-panel">
          <div className="landing-grid-two">
            <article className="landing-card landing-card-with-badge">
              <div className="landing-event-id-badge">
                Event ID auto: {nextAutoEventId}
              </div>
              <h3>Crear o actualizar landing por evento</h3>
              <form
                className="landing-form-grid"
                onSubmit={handleCreateOrUpsertLanding}
              >
                <label>
                  Nombre del evento
                  <input
                    type="text"
                    value={newEventName}
                    onChange={(event) => setNewEventName(event.target.value)}
                    placeholder="Webinar F5"
                    required
                  />
                </label>
                <label>
                  Slug
                  <input
                    type="text"
                    value={newSlug}
                    onChange={(event) =>
                      setNewSlug(normalizeSlug(event.target.value))
                    }
                    placeholder="webinarf5"
                    required
                  />
                </label>
                <label>
                  Fuente
                  <select
                    value={newSourceType}
                    onChange={(event) => setNewSourceType(event.target.value)}
                  >
                    <option value="manual_edit">Edición manual</option>
                    <option value="ai">IA</option>
                    <option value="html_upload">HTML</option>
                    <option value="url_import_once">URL</option>
                  </select>
                </label>
                <div className="landing-form-actions">
                  <button type="submit" disabled={isSavingEditor}>
                    {isSavingEditor ? "Guardando..." : "Guardar landing"}
                  </button>
                </div>
              </form>
            </article>

            <article className="landing-card">
              <h3>Landings registradas</h3>
              <div className="landing-list-filters">
                <input
                  type="text"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Buscar por evento, slug o event id"
                />
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <option value="">Todos los estados</option>
                  <option value="draft">Borrador</option>
                  <option value="published">Publicada</option>
                  <option value="archived">Archivada</option>
                </select>
                <button
                  type="button"
                  onClick={loadLandingList}
                  disabled={isLoadingList}
                >
                  {isLoadingList ? "Cargando..." : "Refrescar"}
                </button>
              </div>

              <div className="landing-list-wrap">
                <table className="landing-table">
                  <thead>
                    <tr>
                      <th>Evento</th>
                      <th>Slug</th>
                      <th>Estado</th>
                      <th>Versión</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {landingItems.length === 0 ? (
                      <tr>
                        <td colSpan={5}>No hay landings registradas</td>
                      </tr>
                    ) : (
                      landingItems.map((item) => (
                        <tr
                          key={item.id}
                          className={
                            Number(selectedLandingId) === Number(item.id)
                              ? "is-selected"
                              : ""
                          }
                        >
                          <td>
                            <strong>{item.event_name}</strong>
                            <div className="landing-muted">
                              Event ID: {item.event_id}
                            </div>
                          </td>
                          <td>{item.slug}</td>
                          <td>{item.status}</td>
                          <td>
                            {item.current_version_number
                              ? `v${item.current_version_number}`
                              : "-"}
                          </td>
                          <td>
                            <button
                              type="button"
                              onClick={() => onSelectLanding(item)}
                            >
                              Abrir
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </article>
          </div>
        </section>
      ) : null}

      {activeTab === "editor" ? (
        <section className="landing-panel">
          <div className="landing-grid-two landing-grid-editor">
            <article className="landing-card landing-editor-card">
              <h3>Editor y publicación</h3>
              {!selectedLandingId ? (
                <p className="landing-muted">
                  Selecciona una landing desde la pestaña Eventos/Landings.
                </p>
              ) : (
                <>
                  <div className="landing-meta-grid">
                    <div>
                      <span className="landing-muted">Landing ID</span>
                      <strong>{selectedLandingId}</strong>
                    </div>
                    <div>
                      <span className="landing-muted">Event ID</span>
                      <strong>
                        {landingDetail?.landing_page?.event_id || "-"}
                      </strong>
                    </div>
                    <div>
                      <span className="landing-muted">Slug</span>
                      <strong>
                        {landingDetail?.landing_page?.slug || "-"}
                      </strong>
                    </div>
                    <div>
                      <span className="landing-muted">Estado</span>
                      <strong>
                        {landingDetail?.landing_page?.status || "-"}
                      </strong>
                    </div>
                    <div className="landing-meta-version">
                      <span className="landing-muted">Versión</span>
                      <select
                        value={selectedVersionId || ""}
                        onChange={(event) => {
                          const nextId = Number(event.target.value || 0);
                          setSelectedVersionId(nextId || null);
                          const version = (landingDetail?.versions || []).find(
                            (entry) => Number(entry.id) === nextId,
                          );
                          if (version) {
                            useVersionInEditor(version);
                          }
                        }}
                      >
                        {(landingDetail?.versions || []).map((version) => (
                          <option key={version.id} value={version.id}>
                            v{version.version_number} · {version.source_type}
                            {version.is_active ? " · activa" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="landing-inline-actions landing-editor-actions">
                    <button
                      type="button"
                      onClick={handleSaveCurrentVersion}
                      disabled={
                        isSavingEditor || isLoadingDetail || isGeneratingWithAi
                      }
                    >
                      Guardar versión
                    </button>
                    <button
                      type="button"
                      onClick={handlePublishVersion}
                      disabled={
                        isSavingEditor || isLoadingDetail || isGeneratingWithAi
                      }
                    >
                      Publicar
                    </button>
                    <button
                      type="button"
                      className="landing-ai-action"
                      onClick={handleOpenAiPromptModal}
                      disabled={
                        isSavingEditor || isLoadingDetail || isGeneratingWithAi
                      }
                    >
                      <span className="landing-ai-glyph" aria-hidden="true">
                        AI
                      </span>
                      Generar con IA
                    </button>
                    {selectedPublicUrl ? (
                      <a
                        href={selectedPublicUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Ver landing publicada
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={handlePreviewDraftLanding}
                        disabled={
                          isSavingEditor ||
                          isLoadingDetail ||
                          isGeneratingWithAi
                        }
                      >
                        Previsualizar borrador
                      </button>
                    )}
                  </div>

                  <label className="landing-label-block">
                    HTML
                    <textarea
                      value={editorHtml}
                      onChange={(event) => setEditorHtml(event.target.value)}
                      rows={14}
                    />
                  </label>

                  <label className="landing-label-block">
                    Form schema (JSON)
                    <textarea
                      value={editorFormSchemaText}
                      onChange={(event) =>
                        setEditorFormSchemaText(event.target.value)
                      }
                      rows={14}
                    />
                  </label>

                  <form
                    className="landing-inline-actions"
                    onSubmit={handleImportUrl}
                  >
                    <input
                      type="url"
                      value={importUrl}
                      onChange={(event) => setImportUrl(event.target.value)}
                      placeholder="https://sitio.com/landing"
                    />
                    <button type="submit" disabled={isSavingEditor}>
                      Importar URL
                    </button>
                  </form>

                  <form
                    className="landing-inline-actions"
                    onSubmit={handleUploadHtml}
                  >
                    <input
                      type="file"
                      accept=".html,text/html"
                      onChange={(event) =>
                        setUploadFile(event.target.files?.[0] || null)
                      }
                    />
                    <button type="submit" disabled={isSavingEditor}>
                      Subir HTML como nueva versión
                    </button>
                  </form>
                </>
              )}
            </article>

            <article className="landing-card">
              <h3>Vista previa</h3>
              <div className="landing-preview-wrap">
                <iframe
                  title="Vista previa landing"
                  srcDoc={editorHtml || DEFAULT_HTML}
                  sandbox="allow-forms allow-same-origin allow-scripts"
                />
              </div>
              {selectedVersion ? (
                <p className="landing-muted">
                  Versión seleccionada: v{selectedVersion.version_number} ·{" "}
                  {selectedVersion.source_type}
                </p>
              ) : null}
            </article>
          </div>
        </section>
      ) : null}

      {activeTab === "submissions" ? (
        <section className="landing-panel">
          <article className="landing-card">
            <h3>Registros por evento</h3>
            <div className="landing-inline-actions landing-submission-filters">
              <input
                type="number"
                value={selectedEventId || ""}
                onChange={(event) =>
                  setSelectedEventId(Number(event.target.value || 0) || null)
                }
                placeholder="Event ID"
              />
              <select
                value={crmStatusFilter}
                onChange={(event) => setCrmStatusFilter(event.target.value)}
              >
                <option value="">Todos los estados</option>
                <option value="pending">pending</option>
                <option value="processed">processed</option>
                <option value="failed">failed</option>
                <option value="duplicate_review">duplicate_review</option>
              </select>
              <input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
              />
              <input
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
              />
              <button
                type="button"
                onClick={loadSubmissions}
                disabled={isLoadingSubmissions}
              >
                {isLoadingSubmissions ? "Cargando..." : "Buscar"}
              </button>
            </div>

            <div className="landing-list-wrap">
              <table className="landing-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Contacto</th>
                    <th>Cuenta</th>
                    <th>Estado CRM</th>
                    <th>IDs CRM</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {submissions.length === 0 ? (
                    <tr>
                      <td colSpan={6}>No hay registros para este evento</td>
                    </tr>
                  ) : (
                    submissions.map((submission) => {
                      const contact =
                        submission.payload_normalized?.contact || {};
                      const account =
                        submission.payload_normalized?.account || {};
                      return (
                        <tr key={submission.submission_id}>
                          <td>
                            {new Date(submission.submitted_at).toLocaleString()}
                          </td>
                          <td>
                            <strong>
                              {contact.first_name || ""}{" "}
                              {contact.last_name || ""}
                            </strong>
                            <div className="landing-muted">
                              {contact.email || "-"}
                            </div>
                            <div className="landing-muted">
                              {contact.phone || contact.mobile || ""}
                            </div>
                          </td>
                          <td>
                            <strong>{account.name || "-"}</strong>
                            <div className="landing-muted">
                              {account.website || ""}
                            </div>
                          </td>
                          <td>
                            <span
                              className={`landing-status status-${submission.crm_processing_status}`}
                            >
                              {submission.crm_processing_status}
                            </span>
                            {submission.crm_error_message ? (
                              <div className="landing-error-inline">
                                {submission.crm_error_message}
                              </div>
                            ) : null}
                          </td>
                          <td>
                            <div className="landing-muted">
                              lead: {submission.crm_links?.lead_id || "-"}
                            </div>
                            <div className="landing-muted">
                              account: {submission.crm_links?.account_id || "-"}
                            </div>
                            <div className="landing-muted">
                              contact: {submission.crm_links?.contact_id || "-"}
                            </div>
                          </td>
                          <td>
                            <button
                              type="button"
                              onClick={() =>
                                handleReprocessSubmission(
                                  submission.submission_id,
                                )
                              }
                            >
                              Reprocesar
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      ) : null}

      {isGeneratingWithAi ? (
        <div
          className="landing-ai-modal-backdrop"
          role="status"
          aria-live="polite"
        >
          <div
            className="landing-ai-modal"
            aria-label="Generacion IA en progreso"
          >
            <div className="landing-ai-modal-spinner" aria-hidden="true" />
            <h4>La IA esta trabajando</h4>
            <p>{aiProgressText}</p>
            <button
              type="button"
              className="landing-ai-cancel-button"
              onClick={handleCancelAiGeneration}
              disabled={isAiCancelRequested}
            >
              {isAiCancelRequested ? "Cancelando..." : "Cancelar"}
            </button>
          </div>
        </div>
      ) : null}

      {isAiPromptModalOpen ? (
        <div
          className="landing-ai-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Instrucciones para generar landing con IA"
        >
          <form className="landing-ai-modal" onSubmit={handleSubmitAiPrompt}>
            <h4>Instrucciones para IA</h4>
            <p>
              Describe cambios en varias líneas. La IA editará el HTML actual de
              la landing.
            </p>
            <textarea
              className="landing-ai-prompt-textarea"
              value={aiPromptText}
              onChange={(event) => setAiPromptText(event.target.value)}
              rows={9}
              placeholder={[
                "Objetivo:",
                "Audiencia:",
                "Propuesta de valor:",
                "CTA:",
                "Cambios puntuales:",
              ].join("\n")}
              autoFocus
            />
            <div className="landing-ai-modal-actions">
              <button
                type="button"
                className="landing-ai-cancel-button"
                onClick={handleCloseAiPromptModal}
              >
                Cancelar
              </button>
              <button type="submit" className="landing-ai-submit-button">
                Generar con IA
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
