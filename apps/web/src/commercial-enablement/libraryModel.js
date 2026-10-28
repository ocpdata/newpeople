import { api } from "../api";

export const API_BASE = "/api/commercial-enablement";

const DAY_MS = 24 * 60 * 60 * 1000;

export function uniqueStrings(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

export function toggleValue(values, value) {
  return values.includes(value)
    ? values.filter((entry) => entry !== value)
    : [...values, value];
}

export function getCatalogCodes(asset, catalogType) {
  return (asset?.catalogs || [])
    .filter((entry) => entry.catalogType === catalogType)
    .map((entry) => entry.code);
}

export function getCatalogNames(asset, catalogType) {
  return (asset?.catalogs || [])
    .filter((entry) => entry.catalogType === catalogType)
    .map((entry) => entry.name);
}

export function getTagCodes(asset, tagGroup) {
  return (asset?.tags || [])
    .filter((entry) => entry.tagGroup === tagGroup)
    .map((entry) => entry.code);
}

export function getResource(asset) {
  const file = asset?.files?.[0];
  if (file) return { kind: "file", file };
  const link = asset?.links?.[0];
  if (link) return { kind: "link", link };
  return { kind: "none" };
}

export function getResourceKind(asset) {
  const resource = getResource(asset);
  if (resource.kind === "link") return "link";
  if (resource.kind === "none") return "none";
  const mime = String(resource.file.mimeType || "").toLowerCase();
  const extension = String(resource.file.fileExtension || "").toLowerCase();
  if (mime === "application/pdf" || extension === ".pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.includes("presentation") || [".ppt", ".pptx"].includes(extension)) {
    return "presentation";
  }
  return "document";
}

export function isPreviewable(asset) {
  const resource = getResource(asset);
  return (
    resource.kind === "file" &&
    resource.file.isAvailable !== false &&
    ["pdf", "image"].includes(getResourceKind(asset))
  );
}

export function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-PE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function daysUntil(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return null;
  return Math.ceil((time - Date.now()) / DAY_MS);
}

export function describeExpiry(asset) {
  if (!asset?.expiresAt) return "";
  if (asset.isExpired) return `Venció el ${formatDate(asset.expiresAt)}`;
  const days = daysUntil(asset.expiresAt);
  return days <= 1 ? "Vence hoy o mañana" : `Vence en ${days} días`;
}

// Advertencia discreta para tarjetas: vencimiento cercano o material antiguo.
export function getCardWarning(asset) {
  if (asset?.expiresAt && !asset.isExpired) {
    const days = daysUntil(asset.expiresAt);
    if (days <= 7) return describeExpiry(asset);
  }
  const updated = new Date(asset?.updatedAt || 0).getTime();
  if (updated && Date.now() - updated > 365 * DAY_MS) {
    return "Sin actualizar hace más de un año";
  }
  return "";
}

export function emptyDraft() {
  return {
    title: "",
    summary: "",
    usageNote: "",
    internalDescription: "",
    assetTypeCode: "",
    status: "archived",
    sourceType: "file",
    visibilityLevel: "client_safe",
    audienceCode: "mixed",
    languageCode: "es",
    manufacturerCodes: [],
    solutionCodes: [],
    technologyCodes: [],
    needCodes: [],
    requirementCodes: [],
    competitorCodes: [],
    industryCodes: [],
    stageCodes: [],
    themeTags: [],
    personaTags: [],
    recommendedRoleTags: [],
  };
}

export function buildDraftFromAsset(asset) {
  return {
    ...emptyDraft(),
    title: asset.title || "",
    summary: asset.summary || "",
    usageNote: asset.usageNote || "",
    internalDescription: asset.internalDescription || "",
    assetTypeCode: asset.assetTypeCode || "",
    status: asset.status === "published" ? "published" : "archived",
    sourceType: asset.sourceType || "file",
    visibilityLevel: asset.visibilityLevel || "client_safe",
    audienceCode: asset.audienceCode || "mixed",
    languageCode: asset.languageCode || "es",
    manufacturerCodes: getCatalogCodes(asset, "manufacturer"),
    solutionCodes: getCatalogCodes(asset, "solution"),
    technologyCodes: getCatalogCodes(asset, "technology"),
    needCodes: getCatalogCodes(asset, "need"),
    requirementCodes: getCatalogCodes(asset, "requirement"),
    competitorCodes: getCatalogCodes(asset, "competitor"),
    industryCodes: getCatalogCodes(asset, "industry"),
    stageCodes: getTagCodes(asset, "stage"),
    themeTags: getTagCodes(asset, "theme"),
    personaTags: getTagCodes(asset, "persona"),
    recommendedRoleTags: getTagCodes(asset, "recommended_role"),
  };
}

export function buildDraftFromIntake(session) {
  const payload = session?.acceptedPayload || session?.draftPayload || {};
  return { ...emptyDraft(), ...payload, sourceType: "file" };
}

export function buildPayload(draft, overrides = {}) {
  const payload = { ...draft, ...overrides };
  [
    "manufacturerCodes",
    "solutionCodes",
    "technologyCodes",
    "needCodes",
    "requirementCodes",
    "competitorCodes",
    "industryCodes",
    "stageCodes",
    "themeTags",
    "personaTags",
    "recommendedRoleTags",
  ].forEach((key) => {
    payload[key] = uniqueStrings(payload[key]);
  });
  payload.title = String(payload.title || "").trim();
  payload.summary = String(payload.summary || "").trim();
  payload.usageNote = String(payload.usageNote || "").trim();
  payload.isInternal = payload.visibilityLevel !== "client_safe";
  return payload;
}

export function getMissingDraftFields(draft) {
  const missing = [];
  if (String(draft.title || "").trim().length < 3) missing.push("título");
  if (!draft.assetTypeCode) missing.push("tipo");
  if (
    !draft.manufacturerCodes.length &&
    !draft.technologyCodes.length &&
    !draft.solutionCodes.length
  ) {
    missing.push("fabricante o tecnología");
  }
  return missing;
}

// Descarga el archivo con la sesión actual y registra el uso.
export async function downloadAssetFile(asset, file) {
  const response = await api.get(
    `${API_BASE}/assets/${asset.publicId}/files/${file.publicId}/content`,
    { responseType: "blob", timeout: 120000 },
  );
  const objectUrl = window.URL.createObjectURL(response.data);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = file.originalFileName || "material";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 60000);
  api
    .post(`${API_BASE}/assets/${asset.publicId}/usage-events`, {
      eventType: "downloaded",
    })
    .catch(() => undefined);
}

export function openAssetLink(asset, link) {
  const rawUrl = String(link?.url || "").trim();
  if (!rawUrl) return;
  const url = /^[a-z][a-z\d+.-]*:/i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  window.open(url, "_blank", "noopener,noreferrer");
  api
    .post(`${API_BASE}/assets/${asset.publicId}/usage-events`, {
      eventType: "opened_link",
    })
    .catch(() => undefined);
}

// Genera el enlace compartible (vence en 30 días) y lo copia al portapapeles.
// Safari solo permite copiar dentro del gesto del usuario, así que el texto se
// entrega como promesa y la petición no bloquea la escritura.
export async function copyShareLink(asset) {
  const request = api
    .post(`${API_BASE}/assets/${asset.publicId}/share-link`, {})
    .then((response) => response.data || {});

  if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    try {
      const text = request.then(
        (data) => new Blob([data.url], { type: "text/plain" }),
      );
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": text })]);
      return { ...(await request), copied: true };
    } catch {
      // Si falló la API, el error se propaga; si falló el portapapeles, se reintenta abajo.
      await request;
    }
  }

  const data = await request;
  try {
    await navigator.clipboard.writeText(data.url);
    return { ...data, copied: true };
  } catch {
    return { ...data, copied: false };
  }
}

export function describeCopyResult({ url, expiresAt, copied }) {
  return copied
    ? `Enlace copiado. Vence el ${formatDate(expiresAt)}.`
    : `No se pudo copiar automáticamente. Copia este enlace: ${url}`;
}

// Qué puede hacer el usuario con un material, según sus permisos.
export function getLibraryCapabilities(permissions) {
  const granted = new Set(permissions || []);
  const hasPrefix = (prefix) =>
    Array.from(granted).some((code) => code.startsWith(prefix));
  return {
    canEmailOpportunity:
      granted.has("desarrollo_comercial.update") &&
      granted.has("oportunidades.update") &&
      granted.has("oportunidades.read"),
    canEmailLead:
      granted.has("interacciones.update") && granted.has("interacciones.read"),
    canUseInProposal: granted.has("propuestas.update") || hasPrefix("cotizaciones."),
  };
}

// Traspaso entre la biblioteca y los módulos que abren su modal de correo.
const SEND_HANDOFF_KEY = "crm_library_send_handoff";
const SEND_HANDOFF_MAX_AGE_MS = 2 * 60 * 1000;

export function setLibrarySendHandoff({ assetPublicId, targetType, targetId }) {
  window.sessionStorage.setItem(
    SEND_HANDOFF_KEY,
    JSON.stringify({
      assetPublicId,
      targetType,
      targetId: Number(targetId),
      createdAt: Date.now(),
    }),
  );
}

// Devuelve y consume el traspaso solo si corresponde a este destino.
export function takeLibrarySendHandoff(targetType, targetId) {
  let handoff = null;
  try {
    handoff = JSON.parse(window.sessionStorage.getItem(SEND_HANDOFF_KEY));
  } catch {
    handoff = null;
  }
  if (
    !handoff ||
    handoff.targetType !== targetType ||
    Number(handoff.targetId) !== Number(targetId) ||
    Date.now() - Number(handoff.createdAt || 0) > SEND_HANDOFF_MAX_AGE_MS
  ) {
    return null;
  }
  window.sessionStorage.removeItem(SEND_HANDOFF_KEY);
  return handoff;
}
