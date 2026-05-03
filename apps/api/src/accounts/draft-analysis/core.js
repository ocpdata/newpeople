import { query } from "../../db.js";
import { runProfiledStructuredWebResearch } from "../../structuredWebResearch.js";
import {
  accountCompanyResearchProfile,
  accountLocationResearchProfile,
} from "../../aiResearchProfiles.js";

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDomain(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return "";

  try {
    const candidate = rawValue.startsWith("http")
      ? rawValue
      : `https://${rawValue}`;
    const url = new URL(candidate);
    return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return normalizeText(rawValue).replace(/\s+/g, "");
  }
}

function buildBigrams(value) {
  const normalized = normalizeText(value).replace(/\s/g, "");
  if (normalized.length < 2) {
    return new Set(normalized ? [normalized] : []);
  }

  const pairs = new Set();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    pairs.add(normalized.slice(index, index + 2));
  }
  return pairs;
}

function calculateNameSimilarity(left, right) {
  const leftNormalized = normalizeText(left);
  const rightNormalized = normalizeText(right);
  if (!leftNormalized || !rightNormalized) return 0;
  if (leftNormalized === rightNormalized) return 1;
  if (
    leftNormalized.length >= 6 &&
    rightNormalized.length >= 6 &&
    (leftNormalized.includes(rightNormalized) ||
      rightNormalized.includes(leftNormalized))
  ) {
    return 0.93;
  }

  const leftPairs = buildBigrams(leftNormalized);
  const rightPairs = buildBigrams(rightNormalized);
  let overlap = 0;

  leftPairs.forEach((pair) => {
    if (rightPairs.has(pair)) overlap += 1;
  });

  return (2 * overlap) / (leftPairs.size + rightPairs.size || 1);
}

function trimSentence(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function cleanHtmlSnippet(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .trim();
}

function truncateText(value, maxLength = 320) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}...`;
}

function normalizeUrlCandidate(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return "";

  try {
    const normalized = rawValue.startsWith("http")
      ? rawValue
      : `https://${rawValue}`;
    return new URL(normalized).toString();
  } catch {
    return "";
  }
}

function extractJsonObject(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;

    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

export function hasMeaningfulContactData(contactData) {
  return Boolean(
    contactData?.addressLine ||
    contactData?.city ||
    contactData?.stateRegion ||
    contactData?.postalCode ||
    contactData?.phone,
  );
}

export function buildSuggestedContactData({
  draft,
  contactData,
  sourceType,
  reason,
  confidence,
}) {
  if (!hasMeaningfulContactData(contactData)) {
    return {
      addressLine: "",
      city: "",
      stateRegion: "",
      postalCode: "",
      phone: "",
      confidence: "low",
      sourceType: sourceType || "crm_internal",
      reason:
        reason ||
        "No hay suficiente evidencia publica o interna para sugerir direccion o telefono confiables todavia.",
      canAutoApply: false,
    };
  }

  return {
    addressLine: String(
      contactData.addressLine || draft.addressLine || "",
    ).trim(),
    city: String(contactData.city || draft.city || "").trim(),
    stateRegion: String(
      contactData.stateRegion || draft.stateRegion || "",
    ).trim(),
    postalCode: String(contactData.postalCode || draft.postalCode || "").trim(),
    phone: String(contactData.phone || draft.phone || "").trim(),
    confidence: confidence || "medium",
    sourceType: sourceType || "external_public_source",
    reason:
      reason ||
      "Se identificaron datos de contacto publicos que conviene validar antes de guardar.",
    canAutoApply: true,
  };
}

const ECONOMIC_SECTOR_KEYWORDS = {
  Agricultura: ["agricultura", "agricola", "agro", "ganader", "cultivo"],
  Comercio: ["comercio", "retail", "tienda", "ecommerce", "supermercado"],
  Construccion: ["construccion", "constructora", "obra", "infraestructura"],
  Corporativos: ["corporativo", "holding", "grupo empresarial"],
  Educacion: ["educacion", "universidad", "escuela", "colegio", "capacitacion"],
  Energia: ["energia", "electrica", "petroleo", "gas", "renovable"],
  Finanzas: ["finanzas", "financiera", "banco", "credito", "seguros"],
  Gobierno: ["gobierno", "secretaria", "ministerio", "municipio", "publico"],
  Hoteleria: ["hotel", "hoteleria", "hospedaje", "turismo", "resort"],
  Industria: [
    "industria",
    "industrial",
    "manufactura",
    "fabrica",
    "produccion",
  ],
  Informacion: ["software", "tecnologia", "datos", "informacion", "digital"],
  Mineria: ["mineria", "minero", "extraccion"],
  Otros: [],
  Salud: ["salud", "hospital", "clinica", "medico", "farmaceut"],
  Telecomunicaciones: [
    "telecom",
    "telecomunicaciones",
    "telefonia",
    "internet",
    "fibra optica",
    "conectividad",
    "voz y datos",
  ],
  Transporte: ["transporte", "logistica", "movilidad", "envio", "carga"],
};

export async function getEconomicSectorOptions() {
  return query("SELECT id, name FROM economic_sectors ORDER BY name");
}

export function buildSuggestedEconomicSector({
  draft,
  economicSectorOptions,
  externalContext,
  suggestedCompanyDescription,
}) {
  if (draft.economicSectorId) {
    const selectedSector = economicSectorOptions.find(
      (option) => Number(option.id) === Number(draft.economicSectorId),
    );
    return {
      sectorId: selectedSector
        ? Number(selectedSector.id)
        : Number(draft.economicSectorId),
      sectorName: selectedSector?.name || "",
      confidence: "high",
      sourceType: "user_input",
      reason:
        "El borrador ya incluye un sector economico seleccionado por el usuario.",
      canAutoApply: false,
    };
  }

  const combinedText = normalizeText(
    [
      externalContext?.summary,
      externalContext?.title,
      externalContext?.metaDescription,
      externalContext?.bodyText,
      suggestedCompanyDescription?.text,
    ]
      .filter(Boolean)
      .join(" "),
  );

  if (!combinedText) {
    return {
      sectorId: null,
      sectorName: "",
      confidence: "low",
      sourceType: "crm_internal",
      reason:
        "No hay suficiente contexto para sugerir un sector economico confiable todavia.",
      canAutoApply: false,
    };
  }

  const rankedSectors = economicSectorOptions
    .map((option) => {
      const keywords = ECONOMIC_SECTOR_KEYWORDS[option.name] || [];
      let score = 0;

      keywords.forEach((keyword) => {
        if (combinedText.includes(normalizeText(keyword))) {
          score += keyword.includes(" ") ? 3 : 2;
        }
      });

      if (combinedText.includes(normalizeText(option.name))) {
        score += 4;
      }

      return { option, score };
    })
    .sort((left, right) => right.score - left.score);

  const bestMatch = rankedSectors[0];
  if (!bestMatch || bestMatch.score < 3) {
    return {
      sectorId: null,
      sectorName: "",
      confidence: "low",
      sourceType: externalContext ? "external_public_source" : "crm_internal",
      reason:
        "No hubo evidencia suficiente para mapear el negocio a un sector economico del catalogo.",
      canAutoApply: false,
    };
  }

  return {
    sectorId: Number(bestMatch.option.id),
    sectorName: bestMatch.option.name,
    confidence: bestMatch.score >= 6 ? "high" : "medium",
    sourceType: externalContext ? "external_public_source" : "crm_internal",
    reason: `El contenido analizado coincide con el sector ${bestMatch.option.name.toLowerCase()}.`,
    canAutoApply: true,
  };
}

function extractJsonLdObjects(html) {
  const blocks = [];
  const matches = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );

  for (const match of matches) {
    const text = String(match[1] || "").trim();
    if (!text) continue;
    try {
      blocks.push(JSON.parse(text));
    } catch {
      const parsed = extractJsonObject(text);
      if (parsed) blocks.push(parsed);
    }
  }

  return blocks;
}

function flattenJsonLd(value, bucket = []) {
  if (!value) return bucket;
  if (Array.isArray(value)) {
    value.forEach((item) => flattenJsonLd(item, bucket));
    return bucket;
  }
  if (typeof value === "object") {
    bucket.push(value);
    Object.values(value).forEach((item) => flattenJsonLd(item, bucket));
  }
  return bucket;
}

function extractPhoneFromText(text) {
  const match = String(text || "").match(/(?:\+?\d[\d\s().-]{7,}\d)/);
  return match ? match[0].trim() : "";
}

function extractPostalCodeFromText(text) {
  const value = String(text || "");
  const labeledMatch = value.match(
    /(?:c\.?p\.?|codigo postal|postal code|zip code)\D{0,10}(\d{4,10})/i,
  );
  if (labeledMatch?.[1]) return labeledMatch[1].trim();
  const genericMatch = value.match(/\b\d{5}\b/);
  return genericMatch?.[0] ? genericMatch[0].trim() : "";
}

function cleanAddressText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\b(?:telefono|tel\.?|phone|whatsapp)\b.*$/i, "")
    .replace(/\b(?:sitio web|website|web)\b.*$/i, "")
    .replace(/[|]/g, ", ")
    .replace(/\s+,/g, ",")
    .replace(/,+/g, ",")
    .replace(/^[,\s]+|[,\s]+$/g, "")
    .trim();
}

function extractAddressLikeText(text) {
  const value = cleanAddressText(cleanHtmlSnippet(text));
  if (!value) return "";

  const labeledMatch = value.match(
    /(?:direccion|domicilio|ubicacion|address|oficina(?:s)?)\s*:?\s*([^\n]{18,220})/i,
  );
  if (labeledMatch?.[1]) return cleanAddressText(labeledMatch[1]);

  const streetMatch = value.match(
    /((?:av(?:enida)?|calle|blvd|boulevard|carretera|km|paseo|camino|prol(?:ongacion)?|periferico|autopista)\.?[^\n]{18,220})/i,
  );
  if (streetMatch?.[1]) return cleanAddressText(streetMatch[1]);

  return "";
}

function splitAddressCandidate(addressText) {
  const cleaned = cleanAddressText(addressText);
  if (!cleaned) return null;

  const explicitAddressMatch = cleaned.match(
    /^(.*?),\s*([^,]+),\s*([^,]+),\s*(?:c\.?p\.?|codigo postal|postal code)?\s*(\d{4,10})\.?$/i,
  );
  if (explicitAddressMatch) {
    return {
      addressLine: cleanAddressText(explicitAddressMatch[1]),
      city: cleanAddressText(explicitAddressMatch[2]),
      stateRegion: cleanAddressText(explicitAddressMatch[3]),
      postalCode: String(explicitAddressMatch[4] || "").trim(),
    };
  }

  const postalCode = extractPostalCodeFromText(cleaned);
  const withoutPostalCode = postalCode
    ? cleaned.replace(
        new RegExp(
          `(?:c\\.?p\\.?|codigo postal|postal code)?\\s*${postalCode}`,
          "i",
        ),
        " ",
      )
    : cleaned;
  const segments = withoutPostalCode
    .split(",")
    .map((segment) =>
      segment
        .replace(/^(?:direccion|domicilio|ubicacion|address)\s*:?\s*/i, "")
        .replace(/^(?:c\.?p\.?|codigo postal|postal code)\s*:?\s*/i, "")
        .replace(/[.\s]+$/g, "")
        .trim(),
    )
    .filter((segment) => segment && /[a-z0-9]/i.test(segment));

  function looksLikeStreetSegment(value) {
    return /\d|\b(?:av(?:enida)?|calle|blvd|boulevard|carretera|km|paseo|camino|prol(?:ongacion)?|periferico|autopista)\b/i.test(
      String(value || ""),
    );
  }

  function looksLikeStateSegment(value) {
    const normalized = String(value || "").trim();
    if (!normalized) return false;
    return (
      /^[A-Z]{2,5}$/.test(normalized) ||
      /\b(?:estado de|provincia de|nuevo leon|queretaro|cdmx|ciudad de mexico|jalisco|puebla|guanajuato|yucatan|sonora|chihuahua|veracruz|coahuila|tamaulipas)\b/i.test(
        normalized,
      )
    );
  }

  if (segments.length === 0) {
    return postalCode
      ? { addressLine: "", city: "", stateRegion: "", postalCode }
      : null;
  }

  let city = "";
  let stateRegion = "";
  const addressSegments = [...segments];

  if (addressSegments.length >= 3) {
    stateRegion = addressSegments.pop() || "";
    city = addressSegments.pop() || "";
  } else if (addressSegments.length === 2) {
    const [firstSegment, secondSegment] = addressSegments;
    if (
      !looksLikeStreetSegment(firstSegment) &&
      (postalCode || looksLikeStateSegment(secondSegment))
    ) {
      city = firstSegment;
      stateRegion = secondSegment;
      addressSegments.length = 0;
    } else {
      city = addressSegments.pop() || "";
    }
  }

  stateRegion = stateRegion.replace(
    /^(?:c\.?p\.?|codigo postal|postal code)\s*:?\s*/i,
    "",
  );
  city = city.replace(/^(?:c\.?p\.?|codigo postal|postal code)\s*:?\s*/i, "");

  return {
    addressLine: cleanAddressText(addressSegments.join(", ")),
    city,
    stateRegion,
    postalCode,
  };
}

export function mergeContactData(...sources) {
  return sources.reduce(
    (merged, source) => ({
      addressLine:
        merged.addressLine || String(source?.addressLine || "").trim(),
      city: merged.city || String(source?.city || "").trim(),
      stateRegion:
        merged.stateRegion || String(source?.stateRegion || "").trim(),
      postalCode: merged.postalCode || String(source?.postalCode || "").trim(),
      phone: merged.phone || String(source?.phone || "").trim(),
    }),
    { addressLine: "", city: "", stateRegion: "", postalCode: "", phone: "" },
  );
}

export function hasLocationGaps(contactData) {
  return !(
    contactData?.addressLine &&
    contactData?.city &&
    contactData?.stateRegion &&
    contactData?.postalCode
  );
}

function scoreContactData(contactData) {
  if (!contactData) return 0;
  let score = 0;
  if (contactData.addressLine) score += 30;
  if (contactData.city) score += 20;
  if (contactData.stateRegion) score += 20;
  if (contactData.postalCode) score += 20;
  if (contactData.phone) score += 10;
  return score;
}

function extractContactDataFromText(text) {
  const phone = extractPhoneFromText(text);
  const addressCandidate = splitAddressCandidate(extractAddressLikeText(text));
  if (!addressCandidate && !phone) return null;
  return mergeContactData(addressCandidate, { phone });
}

function extractContactDataFromHtml(html) {
  const cleanText = cleanHtmlSnippet(html);
  const jsonLdObjects = flattenJsonLd(extractJsonLdObjects(html));
  const textContactData = extractContactDataFromText(cleanText);

  for (const item of jsonLdObjects) {
    const address = item?.address;
    const telephone = String(item?.telephone || "").trim();
    if (!address && !telephone) continue;

    return mergeContactData(
      {
        addressLine: String(address?.streetAddress || "").trim(),
        city: String(address?.addressLocality || "").trim(),
        stateRegion: String(address?.addressRegion || "").trim(),
        postalCode: String(address?.postalCode || "").trim(),
        phone: telephone,
      },
      textContactData,
    );
  }

  return textContactData || null;
}

function extractContactDataFromSearchHtml(html) {
  const candidates = [];

  extractPublicSearchCandidates(html).forEach((candidate) => {
    const contactData = extractContactDataFromText(
      [candidate.title, candidate.snippet].filter(Boolean).join(". "),
    );
    if (contactData) candidates.push(contactData);
  });

  candidates.sort(
    (left, right) => scoreContactData(right) - scoreContactData(left),
  );
  return candidates[0] || null;
}

function extractPublicSearchCandidates(html) {
  const results = [];
  const resultBlocks = String(html || "")
    .split(/<div class=["']result["']/i)
    .slice(1);

  resultBlocks.forEach((block) => {
    const linkMatch = block.match(
      /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!linkMatch) return;

    const snippetMatch = block.match(
      /<a[^>]+class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/a>|<div[^>]+class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    );
    const rawHref = decodeHtmlEntities(linkMatch[1]);
    const title = cleanHtmlSnippet(linkMatch[2]);
    const snippet = cleanHtmlSnippet(
      snippetMatch?.[1] || snippetMatch?.[2] || "",
    );

    let href = rawHref;
    if (href.startsWith("//duckduckgo.com/l/?")) href = `https:${href}`;
    if (href.includes("duckduckgo.com/l/?")) {
      try {
        const redirectUrl = new URL(href);
        href = decodeURIComponent(redirectUrl.searchParams.get("uddg") || "");
      } catch {
        href = "";
      }
    }

    const website = normalizeUrlCandidate(href);
    if (!website) return;
    results.push({ title, snippet, website });
  });

  return results;
}

function scorePublicSearchCandidate({ draft, candidate }) {
  const domain = normalizeDomain(candidate.website);
  const normalizedName = normalizeText(draft.name);
  const nameTokens = normalizedName
    .split(" ")
    .filter((token) => token.length >= 4);
  const searchableText = normalizeText(
    `${candidate.title} ${candidate.snippet} ${domain}`,
  );
  const blockedDomains = [
    "linkedin.com",
    "facebook.com",
    "instagram.com",
    "wikipedia.org",
    "youtube.com",
  ];

  if (blockedDomains.some((blockedDomain) => domain.includes(blockedDomain))) {
    return -100;
  }

  let score = 0;
  if (nameTokens.some((token) => searchableText.includes(token))) score += 30;
  if (
    nameTokens.length > 0 &&
    nameTokens.every((token) => searchableText.includes(token))
  )
    score += 20;
  if (
    domain &&
    normalizedName.replace(/\s+/g, "").includes(domain.replace(/\./g, ""))
  )
    score += 25;
  if (domain.endsWith(".com") || domain.endsWith(".com.mx")) score += 10;
  if (searchableText.includes("oficial")) score += 10;
  return score;
}

export async function discoverPublicWebsiteByName({ draft, catalogContext }) {
  const queryText = [
    draft.name,
    catalogContext.countryName,
    draft.city,
    "sitio oficial",
  ]
    .filter(Boolean)
    .join(" ");
  const response = await fetch(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(queryText)}`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; NewPeopleCRM/1.0; AccountDraftAnalysis)",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Public search failed: ${response.status}`);
  }

  const html = await response.text();
  const searchContactData = extractContactDataFromSearchHtml(html);
  const candidates = extractPublicSearchCandidates(html)
    .map((candidate) => ({
      ...candidate,
      score: scorePublicSearchCandidate({ draft, candidate }),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);

  for (const candidate of candidates) {
    const websiteContext = await fetchWebsiteContext(candidate.website);
    if (!websiteContext) {
      return {
        website: candidate.website,
        confidence: candidate.score >= 70 ? "high" : "medium",
        reason: `Se encontro un posible sitio oficial por nombre en fuentes publicas: ${candidate.title || candidate.website}.`,
        summary: candidate.snippet,
        contactData: searchContactData,
      };
    }

    return {
      website: candidate.website,
      confidence: candidate.score >= 70 ? "high" : "medium",
      reason:
        "Se encontro un posible sitio oficial por nombre y se pudo leer informacion publica del sitio.",
      summary: websiteContext.summary || candidate.snippet,
      title: websiteContext.title,
      metaDescription: websiteContext.metaDescription,
      bodyText: websiteContext.bodyText,
      contactData: mergeContactData(
        websiteContext.contactData,
        searchContactData,
      ),
    };
  }

  return null;
}

export async function discoverPublicContactDataByName({
  draft,
  catalogContext,
  preferredWebsite,
}) {
  const searchQueries = [
    [draft.name, catalogContext.countryName, "direccion telefono"]
      .filter(Boolean)
      .join(" "),
    [draft.name, catalogContext.countryName, "contacto oficinas"]
      .filter(Boolean)
      .join(" "),
    [draft.name, catalogContext.countryName, "codigo postal direccion"]
      .filter(Boolean)
      .join(" "),
  ];
  const preferredDomain = normalizeDomain(preferredWebsite);

  if (preferredDomain) {
    searchQueries.unshift(
      [draft.name, `site:${preferredDomain}`, "contacto direccion"]
        .filter(Boolean)
        .join(" "),
    );
  }

  let bestCandidate = null;

  for (const queryText of searchQueries.slice(0, 4)) {
    let response;
    try {
      response = await fetch(
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(queryText)}`,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; NewPeopleCRM/1.0; AccountDraftAnalysis)",
          },
        },
      );
    } catch {
      continue;
    }

    if (!response?.ok) continue;

    const html = await response.text();
    const searchContactData = extractContactDataFromSearchHtml(html);
    if (scoreContactData(searchContactData) > scoreContactData(bestCandidate)) {
      bestCandidate = searchContactData;
    }

    const searchResults = extractPublicSearchCandidates(html).slice(0, 3);
    for (const result of searchResults) {
      const pageContext = await fetchWebsiteContext(result.website);
      if (!pageContext?.contactData) continue;

      const mergedCandidate = mergeContactData(
        pageContext.contactData,
        searchContactData,
      );
      if (scoreContactData(mergedCandidate) > scoreContactData(bestCandidate)) {
        bestCandidate = mergedCandidate;
      }

      if (scoreContactData(bestCandidate) >= 80) {
        return {
          contactData: bestCandidate,
          confidence: "high",
          reason:
            "Se completaron datos de direccion y contacto desde resultados publicos y paginas relacionadas con la cuenta.",
        };
      }
    }
  }

  if (scoreContactData(bestCandidate) < 40) return null;

  return {
    contactData: bestCandidate,
    confidence: scoreContactData(bestCandidate) >= 80 ? "high" : "medium",
    reason:
      "Se identificaron datos publicos de direccion o contacto en resultados relacionados con la cuenta.",
  };
}

function getCountryRegistrationProfile(catalogContext) {
  const normalizedCountry = normalizeText(catalogContext.countryName);

  if (normalizedCountry === "mexico") {
    return {
      label: "RFC",
      queries: [
        "RFC",
        "razon social RFC",
        "registro federal de contribuyentes",
        "facturacion RFC",
      ],
      regexes: [
        /\b[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}\b/gi,
        /rfc[^a-z0-9]{0,10}([A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3})/gi,
      ],
    };
  }

  if (normalizedCountry === "argentina") {
    return {
      label: "CUIT",
      queries: ["CUIT", "razon social CUIT", "identificacion fiscal"],
      regexes: [/\b\d{2}-?\d{8}-?\d\b/gi],
    };
  }

  return {
    label: "registro",
    queries: ["tax id", "registration number", "company registration"],
    regexes: [],
  };
}

function extractRegistrationFromText(text, profile) {
  const cleanText = String(text || "");
  const candidates = [];

  for (const regex of profile.regexes) {
    for (const match of cleanText.matchAll(regex)) {
      const value = String(match[1] || match[0] || "")
        .trim()
        .replace(/[.,;:]$/, "");
      if (value) candidates.push(value);
    }
  }

  return Array.from(new Set(candidates));
}

function extractRegistrationCandidatesFromSearchHtml({ html, profile, draft }) {
  const searchText = cleanHtmlSnippet(html);
  return extractRegistrationFromText(searchText, profile).map((value) => ({
    value,
    score: scoreRegistrationCandidate({
      value,
      sourceText: searchText,
      draft,
      profile,
    }),
    reason: `Se encontro ${profile.label} en resultados publicos de busqueda relacionados con la empresa.`,
  }));
}

function scoreRegistrationCandidate({ value, sourceText, draft, profile }) {
  const normalizedText = normalizeText(sourceText);
  const normalizedName = normalizeText(draft.name);
  let score = 0;

  if (normalizedText.includes(normalizeText(profile.label))) score += 30;
  if (
    normalizedName &&
    normalizedText.includes(normalizedName.split(" ")[0] || "")
  )
    score += 20;
  if (value.length >= 10) score += 15;

  return score;
}

export async function discoverPublicRegistrationByName({
  draft,
  catalogContext,
  preferredWebsite,
}) {
  const profile = getCountryRegistrationProfile(catalogContext);
  const searchQueries = profile.queries.map((querySuffix) =>
    [draft.name, catalogContext.countryName, querySuffix]
      .filter(Boolean)
      .join(" "),
  );
  const seenValues = new Set();
  const candidates = [];

  if (preferredWebsite) {
    const preferredDomain = normalizeDomain(preferredWebsite);
    if (preferredDomain) {
      searchQueries.unshift(
        [draft.name, `site:${preferredDomain}`, profile.label]
          .filter(Boolean)
          .join(" "),
      );
    }
  }

  for (const queryText of searchQueries.slice(0, 4)) {
    let response;
    try {
      response = await fetch(
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(queryText)}`,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; NewPeopleCRM/1.0; AccountDraftAnalysis)",
          },
        },
      );
    } catch {
      continue;
    }

    if (!response?.ok) continue;

    const html = await response.text();
    const searchHtmlCandidates = extractRegistrationCandidatesFromSearchHtml({
      html,
      profile,
      draft,
    });

    searchHtmlCandidates.forEach((candidate) => {
      if (seenValues.has(candidate.value)) return;
      seenValues.add(candidate.value);
      candidates.push(candidate);
    });

    const strongHtmlCandidate = candidates.find(
      (candidate) => candidate.score >= 45,
    );
    if (strongHtmlCandidate) {
      return {
        value: strongHtmlCandidate.value,
        confidence: "high",
        reason: strongHtmlCandidate.reason,
      };
    }

    const searchResults = extractPublicSearchCandidates(html).slice(0, 4);
    for (const result of searchResults) {
      const snippetText = `${result.title} ${result.snippet}`;
      const snippetMatches = extractRegistrationFromText(snippetText, profile);

      snippetMatches.forEach((value) => {
        if (seenValues.has(value)) return;
        seenValues.add(value);
        candidates.push({
          value,
          score: scoreRegistrationCandidate({
            value,
            sourceText: snippetText,
            draft,
            profile,
          }),
          reason: `Se encontro ${profile.label} en un resultado publico relacionado con la empresa.`,
        });
      });

      const strongSnippetCandidate = candidates.find(
        (candidate) => candidate.score >= 45,
      );
      if (strongSnippetCandidate) {
        return {
          value: strongSnippetCandidate.value,
          confidence: "high",
          reason: strongSnippetCandidate.reason,
        };
      }

      const pageContext = await fetchWebsiteContext(result.website);
      const pageText = [
        pageContext?.title,
        pageContext?.metaDescription,
        pageContext?.bodyText,
      ]
        .filter(Boolean)
        .join(" ");
      const pageMatches = extractRegistrationFromText(pageText, profile);

      pageMatches.forEach((value) => {
        if (seenValues.has(value)) return;
        seenValues.add(value);
        candidates.push({
          value,
          score: scoreRegistrationCandidate({
            value,
            sourceText: pageText,
            draft,
            profile,
          }),
          reason: `Se encontro ${profile.label} en una pagina publica relacionada con la empresa.`,
        });
      });

      const strongPageCandidate = candidates.find(
        (candidate) => candidate.score >= 45,
      );
      if (strongPageCandidate) {
        return {
          value: strongPageCandidate.value,
          confidence: "high",
          reason: strongPageCandidate.reason,
        };
      }
    }
  }

  candidates.sort((left, right) => right.score - left.score);
  const bestMatch = candidates[0];
  if (!bestMatch || bestMatch.score < 30) return null;

  return {
    value: bestMatch.value,
    confidence: bestMatch.score >= 45 ? "high" : "medium",
    reason: bestMatch.reason,
  };
}

export function buildWebsiteFetchCandidates({
  draft,
  fallbackWebsiteSuggestion,
}) {
  const candidates = [];
  const values = [draft.website, fallbackWebsiteSuggestion?.value];

  values.forEach((value) => {
    const normalizedValue = String(value || "").trim();
    if (!normalizedValue) return;
    const withProtocol = normalizedValue.startsWith("http")
      ? normalizedValue
      : `https://${normalizedValue}`;
    if (!candidates.includes(withProtocol)) candidates.push(withProtocol);
  });

  return candidates;
}

export async function fetchWebsiteContext(websiteUrl) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(websiteUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; NewPeopleCRM/1.0; AccountDraftAnalysis)",
      },
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const contentType = String(response.headers.get("content-type") || "");
    if (!contentType.includes("text/html")) return null;

    const html = await response.text();
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const metaDescriptionMatch = html.match(
      /<meta[^>]+(?:name=["']description["']|property=["']og:description["'])[^>]+content=["']([^"']+)["'][^>]*>/i,
    );
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);

    const title = cleanHtmlSnippet(titleMatch?.[1] || "");
    const metaDescription = cleanHtmlSnippet(metaDescriptionMatch?.[1] || "");
    const bodyText = truncateText(cleanHtmlSnippet(bodyMatch?.[1] || ""), 500);

    if (!title && !metaDescription && !bodyText) return null;

    return {
      website: websiteUrl,
      title,
      metaDescription,
      bodyText,
      summary: metaDescription || bodyText || title,
      contactData: extractContactDataFromHtml(html),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function buildDescriptionsFromExternalContext({
  draft,
  externalContext,
}) {
  if (!externalContext?.summary) return null;

  const baseSummary = trimSentence(externalContext.summary);
  return trimSentence(
    `${draft.name.trim()} ${baseSummary.replace(/^[A-ZÁÉÍÓÚÑa-záéíóúñ0-9]/, (char) => char.toLowerCase())}`,
  );
}

function formatLocation(draft, catalogContext) {
  const parts = [
    draft.city,
    draft.stateRegion,
    catalogContext.countryName,
  ].filter(Boolean);
  return parts.join(", ");
}

function buildBusinessActivityPhrase({ draft, catalogContext }) {
  const sector = catalogContext.economicSectorName
    ? catalogContext.economicSectorName.toLowerCase()
    : "";
  const accountType = catalogContext.accountTypeName
    ? catalogContext.accountTypeName.toLowerCase()
    : "";
  const websiteDomain = normalizeDomain(draft.website);

  if (sector) return `se dedica al sector ${sector}`;
  if (accountType) return `opera como ${accountType}`;
  if (websiteDomain)
    return `opera publicamente a traves del sitio ${websiteDomain}`;

  return "desarrolla actividades que aun deben validarse con una fuente publica o con el cliente";
}

export function buildSuggestedCompanyDescription({ draft, catalogContext }) {
  const location = formatLocation(draft, catalogContext);
  const businessActivityPhrase = buildBusinessActivityPhrase({
    draft,
    catalogContext,
  });
  const websiteDomain = normalizeDomain(draft.website);
  const descriptionParts = [
    `${draft.name.trim()} ${businessActivityPhrase}`,
    location ? `y tiene presencia declarada en ${location}` : "",
    websiteDomain ? `segun referencias disponibles en ${websiteDomain}` : "",
  ].filter(Boolean);

  return trimSentence(descriptionParts.join(" "));
}

export function buildWebsiteSuggestion({ draft, duplicateWarnings }) {
  if (String(draft.website || "").trim()) {
    return {
      value: String(draft.website || "").trim(),
      confidence: "high",
      sourceType: "user_input",
      reason: "El borrador ya incluye un sitio web capturado por el usuario.",
      canAutoApply: false,
    };
  }

  const duplicateWithWebsite = duplicateWarnings.find(
    (warning) => warning.website,
  );
  if (duplicateWithWebsite?.website) {
    return {
      value: duplicateWithWebsite.website,
      confidence: duplicateWithWebsite.severity === "high" ? "high" : "medium",
      sourceType: "crm_internal",
      reason:
        duplicateWithWebsite.severity === "high"
          ? "Existe una coincidencia interna fuerte con sitio web registrado."
          : "Existe una coincidencia interna relacionada que ya tiene sitio web cargado.",
      canAutoApply: true,
    };
  }

  return {
    value: "",
    confidence: "low",
    sourceType: "crm_internal",
    reason:
      "No hay suficiente evidencia interna para proponer un sitio web confiable todavia.",
    canAutoApply: false,
  };
}

export function buildRegistrationAssistance({
  draft,
  duplicateWarnings,
  catalogContext,
}) {
  const registrationCode = String(draft.registrationCode || "").trim();
  if (registrationCode) {
    return {
      status: "provided",
      value: registrationCode,
      confidence: "high",
      sourceType: "user_input",
      reason: "El borrador ya incluye un registro capturado por el usuario.",
      requiresManualValidation: true,
      canAutoApply: false,
    };
  }

  const duplicateWithRegistration = duplicateWarnings.find(
    (warning) => warning.matchReason === "country_registration",
  );
  if (duplicateWithRegistration?.registrationCode) {
    return {
      status: "candidate",
      value: duplicateWithRegistration.registrationCode,
      confidence: "high",
      sourceType: "crm_internal",
      reason:
        "Existe una coincidencia interna por registro en el mismo pais y conviene validarla antes de usarla.",
      requiresManualValidation: true,
      canAutoApply: true,
    };
  }

  return {
    status: "missing",
    value: "",
    confidence: "low",
    sourceType: "crm_internal",
    reason: catalogContext.countryName
      ? `Falta el registro y debe validarse manualmente en fuentes oficiales para ${catalogContext.countryName}.`
      : "Falta el registro y debe validarse manualmente en una fuente oficial antes de guardar.",
    requiresManualValidation: true,
    canAutoApply: false,
  };
}

export function buildSuggestedImprovements({
  draft,
  duplicateWarnings,
  dataQualityFindings,
}) {
  const improvements = [];

  if (duplicateWarnings.some((warning) => warning.severity === "high")) {
    improvements.push(
      "Revisar primero la coincidencia fuerte detectada antes de guardar la cuenta.",
    );
  } else if (duplicateWarnings.length > 0) {
    improvements.push(
      "Validar las coincidencias internas sugeridas para evitar duplicados.",
    );
  }

  const descriptionFinding = dataQualityFindings.find(
    (finding) =>
      finding.code === "missing_description" ||
      finding.code === "weak_description",
  );
  if (descriptionFinding) {
    improvements.push(
      "Completar una descripcion comercial util para el seguimiento posterior.",
    );
  }

  if (!draft.website) {
    improvements.push(
      "Confirmar o capturar el sitio web oficial de la cuenta.",
    );
  }

  if (!draft.registrationCode) {
    improvements.push(
      "Ubicar y validar manualmente el registro oficial de la cuenta antes de guardar si es un dato requerido.",
    );
  }

  if (!draft.economicSectorId) {
    improvements.push(
      "Definir el sector economico para mejorar el contexto comercial.",
    );
  }

  return improvements.slice(0, 5);
}

export function buildNextRecommendedStep({
  draft,
  duplicateWarnings,
  dataQualityFindings,
}) {
  if (duplicateWarnings.some((warning) => warning.severity === "high")) {
    return {
      action: "Validar duplicado antes de continuar",
      reason:
        "Existe una coincidencia fuerte y conviene resolverla antes de crear una nueva cuenta.",
    };
  }

  if (
    dataQualityFindings.some(
      (finding) =>
        finding.code === "missing_description" ||
        finding.code === "weak_description",
    )
  ) {
    return {
      action: "Completar contexto comercial de la cuenta",
      reason:
        "La descripcion actual no aporta suficiente contexto para registrar contactos u oportunidades con calidad.",
    };
  }

  return {
    action: "Registrar contacto principal",
    reason:
      "La cuenta ya tiene base suficiente para continuar con el siguiente paso del flujo comercial.",
  };
}

export function summarizeAssessment({
  duplicateWarnings,
  dataQualityFindings,
}) {
  const highDuplicates = duplicateWarnings.filter(
    (warning) => warning.severity === "high",
  ).length;
  const highFindings = dataQualityFindings.filter(
    (finding) => finding.severity === "high",
  ).length;
  const mediumFindings = dataQualityFindings.filter(
    (finding) => finding.severity === "medium",
  ).length;

  if (highDuplicates > 0) {
    return {
      status: "needs_review",
      summary:
        "Se detecto al menos una coincidencia fuerte con cuentas existentes y conviene revisarla antes de guardar.",
    };
  }

  if (highFindings > 0 || mediumFindings > 0) {
    return {
      status: "incomplete",
      summary:
        "La cuenta puede analizarse, pero aun requiere completar o fortalecer datos clave antes de guardarla.",
    };
  }

  return {
    status: "ready_with_minor_improvements",
    summary:
      "El borrador esta bien encaminado y solo requiere mejoras menores antes de crear la cuenta.",
  };
}

export async function getCatalogContext(draft) {
  const [accountTypeRows, sectorRows, countryRows] = await Promise.all([
    draft.accountTypeId
      ? query("SELECT name FROM account_types WHERE id = ? LIMIT 1", [
          draft.accountTypeId,
        ])
      : Promise.resolve([]),
    draft.economicSectorId
      ? query("SELECT name FROM economic_sectors WHERE id = ? LIMIT 1", [
          draft.economicSectorId,
        ])
      : Promise.resolve([]),
    draft.countryId
      ? query("SELECT name FROM countries WHERE id = ? LIMIT 1", [
          draft.countryId,
        ])
      : Promise.resolve([]),
  ]);

  return {
    accountTypeName: accountTypeRows[0]?.name || "",
    economicSectorName: sectorRows[0]?.name || "",
    countryName: countryRows[0]?.name || "",
  };
}

export async function getDuplicateCandidates({ draft, user }) {
  const params = [];
  const ownershipJoin = user?.permissionSet?.has("cuentas.read_all")
    ? ""
    : "INNER JOIN account_owners ao_scope ON ao_scope.account_id = a.id AND ao_scope.user_id = ?";

  if (!user?.permissionSet?.has("cuentas.read_all")) {
    params.push(Number(user.id));
  }

  let whereClause = "";
  if (draft.countryId) {
    whereClause = "WHERE a.country_id = ?";
    params.push(Number(draft.countryId));
  }

  return query(
    `SELECT a.id, a.name, a.registration_code, a.website, c.name AS country_name
     FROM accounts a
     ${ownershipJoin}
     INNER JOIN countries c ON c.id = a.country_id
     ${whereClause}
     ORDER BY a.updated_at DESC, a.id DESC
     LIMIT 150`,
    params,
  );
}

export function buildDuplicateWarnings({ draft, candidates }) {
  const draftName = normalizeText(draft.name);
  const draftRegistration = normalizeText(draft.registrationCode);
  const draftDomain = normalizeDomain(draft.website);
  const warnings = [];

  candidates.forEach((candidate) => {
    const candidateName = normalizeText(candidate.name);
    const candidateRegistration = normalizeText(candidate.registration_code);
    const candidateDomain = normalizeDomain(candidate.website);
    const similarity = calculateNameSimilarity(draftName, candidateName);

    let severity = null;
    let matchReason = "";
    let sortRank = 0;

    if (
      draftRegistration &&
      candidateRegistration &&
      draftRegistration === candidateRegistration
    ) {
      severity = "high";
      matchReason = "country_registration";
      sortRank = 400;
    } else if (
      draftDomain &&
      candidateDomain &&
      draftDomain === candidateDomain
    ) {
      severity = "high";
      matchReason = "website_domain";
      sortRank = 350;
    } else if (draftName && candidateName && draftName === candidateName) {
      severity = "high";
      matchReason = "normalized_name_same_country";
      sortRank = 320;
    } else if (similarity >= 0.88) {
      severity = "medium";
      matchReason = "similar_name_same_country";
      sortRank = 220 + Math.round(similarity * 10);
    } else if (similarity >= 0.8) {
      severity = "low";
      matchReason = "partial_name_match";
      sortRank = 120 + Math.round(similarity * 10);
    }

    if (!severity) return;

    warnings.push({
      severity,
      matchReason,
      accountId: Number(candidate.id),
      accountName: candidate.name,
      registrationCode: candidate.registration_code || "",
      country: candidate.country_name,
      website: candidate.website || "",
      recommendedAction:
        severity === "high"
          ? "Revisar esta coincidencia antes de guardar para evitar duplicar la cuenta."
          : "Verificar si corresponde a la misma organizacion antes de continuar.",
      _sortRank: sortRank,
    });
  });

  return warnings
    .sort((left, right) => right._sortRank - left._sortRank)
    .slice(0, 5)
    .map(({ _sortRank, ...warning }) => warning);
}

export function buildDataQualityFindings({ draft }) {
  const findings = [];
  const descriptionLength = String(draft.companyDescription || "").trim()
    .length;

  if (!draft.countryId) {
    findings.push({
      code: "missing_country",
      severity: "high",
      message:
        "Falta el pais y eso limita validacion, desambiguacion y enriquecimiento.",
    });
  }

  if (!draft.economicSectorId) {
    findings.push({
      code: "missing_sector",
      severity: "low",
      message: "No se definio sector economico todavia.",
    });
  }

  if (descriptionLength === 0) {
    findings.push({
      code: "missing_description",
      severity: "high",
      message:
        "La descripcion esta vacia y limita el contexto comercial posterior.",
    });
  } else if (descriptionLength < 40) {
    findings.push({
      code: "weak_description",
      severity: "medium",
      message: "La descripcion actual es demasiado corta para uso comercial.",
    });
  }

  if (!String(draft.website || "").trim()) {
    findings.push({
      code: "missing_website",
      severity: "medium",
      message: "No se capturo sitio web oficial.",
    });
  }

  if (!String(draft.registrationCode || "").trim()) {
    findings.push({
      code: "missing_registration",
      severity: "low",
      message: "No se capturo registro o identificador de la cuenta.",
    });
  }

  return findings;
}

export function buildEvidence({
  draft,
  duplicateWarnings,
  catalogContext,
  usedExternalEnrichment,
  externalContext,
}) {
  const evidence = [
    {
      sourceType: "user_input",
      label: "Nombre de cuenta",
      value: draft.name,
    },
  ];

  if (catalogContext.countryName) {
    evidence.push({
      sourceType: "crm_internal",
      label: "Pais seleccionado",
      value: catalogContext.countryName,
    });
  }

  if (duplicateWarnings.length > 0) {
    evidence.push({
      sourceType: "crm_internal",
      label: "Coincidencia interna mas relevante",
      value: duplicateWarnings[0].accountName,
    });

    if (duplicateWarnings[0].website) {
      evidence.push({
        sourceType: "crm_internal",
        label: "Website disponible en coincidencia interna",
        value: duplicateWarnings[0].website,
      });
    }
  }

  if (usedExternalEnrichment) {
    evidence.push({
      sourceType: "external_public_source",
      label: "Enriquecimiento externo",
      value:
        externalContext?.sourceLabel === "website_fetch"
          ? "Se consulto un sitio web publico asociado a la cuenta."
          : externalContext?.sourceLabel === "public_search"
            ? "Se uso una busqueda publica por nombre para encontrar un posible sitio oficial."
            : externalContext?.sourceLabel === "openai_general"
              ? "Se usaron sugerencias publicas generadas por OpenAI a partir del nombre y pais de la cuenta."
              : "Se uso una fuente publica controlada con apoyo de OpenAI.",
    });
  }

  return evidence;
}

export function classifyOpenAiError(error) {
  const message = String(error?.message || error || "");

  if (message.includes("insufficient_quota")) return "quota";
  if (
    message.includes("invalid_api_key") ||
    message.includes("Incorrect API key") ||
    message.includes("401")
  ) {
    return "auth";
  }

  return "other";
}

export function buildOpenAiProviderWarning(kind) {
  if (kind === "quota") {
    return "OpenAI no esta disponible por cuota o facturacion en este momento; se muestran recomendaciones internas.";
  }

  if (kind === "auth") {
    return "OpenAI no esta configurado correctamente en este momento; se muestran recomendaciones internas.";
  }

  return "No fue posible obtener sugerencias IA en este momento; se muestran recomendaciones internas.";
}

export async function searchPublicCompanyInfo({ draft, catalogContext }) {
  return runProfiledStructuredWebResearch(accountCompanyResearchProfile, {
    draft,
    catalogContext,
  });
}

export async function searchPublicCompanyLocationInfo({
  draft,
  catalogContext,
  preferredWebsite,
  currentContactData,
}) {
  return runProfiledStructuredWebResearch(accountLocationResearchProfile, {
    draft,
    catalogContext,
    preferredWebsite,
    currentContactData,
  });
}
