import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import path from "node:path";

const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 20_000;

function isPublicIpv4(address) {
  const octets = address.split(".").map(Number);
  const [a, b, c] = octets;
  if (octets.length !== 4 || octets.some((part) => part < 0 || part > 255)) {
    return false;
  }
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}

function ipv6ToBigInt(address) {
  const normalized = address.toLowerCase().split("%")[0];
  const ipv4Match = normalized.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/);
  let value = normalized;
  if (ipv4Match) {
    const octets = ipv4Match[1].split(".").map(Number);
    const tail = `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
    value = normalized.replace(ipv4Match[1], tail);
  }

  const halves = value.split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  const groups = halves.length === 2
    ? [...left, ...Array(Math.max(0, missing)).fill("0"), ...right]
    : value.split(":");
  if (groups.length !== 8) return null;
  return groups.reduce((result, group) => {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    return (result << 16n) | BigInt(`0x${group}`);
  }, 0n);
}

export function isPublicRagAddress(address) {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family !== 6) return false;
  const value = ipv6ToBigInt(address);
  if (value === null) return false;
  const mappedPrefix = BigInt("0xffff") << 32n;
  if (value >> 32n === mappedPrefix >> 32n) {
    const mapped = [
      Number((value >> 24n) & 255n),
      Number((value >> 16n) & 255n),
      Number((value >> 8n) & 255n),
      Number(value & 255n),
    ].join(".");
    return isPublicIpv4(mapped);
  }
  return (
    value >= (BigInt("0x2000") << 112n) &&
    value < (BigInt("0x4000") << 112n) &&
    value >> 96n !== BigInt("0x20010db8")
  );
}

export function validateRagSourceUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 2048) {
    throw new Error("Ingresa una URL pública válida (máximo 2048 caracteres)");
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("La URL no tiene un formato válido");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Solo se permiten enlaces HTTP o HTTPS");
  }
  if (url.username || url.password) {
    throw new Error("La URL no debe incluir credenciales");
  }
  if (!url.hostname || url.hostname.endsWith(".local")) {
    throw new Error("El enlace debe apuntar a un sitio público");
  }
  return url;
}

async function resolvePublicAddress(hostname) {
  const literal = hostname.replace(/^\[|\]$/g, "");
  if (isIP(literal)) {
    if (!isPublicRagAddress(literal)) throw new Error("El enlace debe apuntar a un sitio público");
    return { address: literal, family: isIP(literal) };
  }
  const addresses = await dnsLookup(literal, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicRagAddress(address))) {
    throw new Error("El enlace debe resolver únicamente a direcciones públicas");
  }
  return addresses[0];
}

function requestUrl(url, address, maxBytes) {
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "GET",
        headers: {
          Accept: "text/html,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/json,text/markdown,text/plain,*/*;q=0.1",
          "User-Agent": "NewPeople-DocumentacionRAG/1.0",
        },
        lookup: (_hostname, _options, callback) =>
          callback(null, address.address, address.family),
      },
      (response) => {
        const status = Number(response.statusCode || 0);
        if ([301, 302, 303, 307, 308].includes(status)) {
          response.resume();
          resolve({
            redirect: response.headers.location || "",
            status,
          });
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`El sitio respondió con estado HTTP ${status || "desconocido"}`));
          return;
        }
        const contentLength = Number(response.headers["content-length"] || 0);
        if (contentLength > maxBytes) {
          response.destroy();
          reject(new Error("El contenido supera el tamaño máximo permitido"));
          return;
        }
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            response.destroy(new Error("El contenido supera el tamaño máximo permitido"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({
            buffer: Buffer.concat(chunks),
            contentType: String(response.headers["content-type"] || "")
              .split(";")[0]
              .trim()
              .toLowerCase(),
            contentDisposition: String(response.headers["content-disposition"] || ""),
          });
        });
        response.on("error", reject);
      },
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error("La descarga excedió el tiempo límite"));
    });
    req.on("error", reject);
    req.end();
  });
}

async function fetchPublicUrl(inputUrl, maxBytes, redirects = 0) {
  const address = await resolvePublicAddress(inputUrl.hostname);
  const result = await requestUrl(inputUrl, address, maxBytes);
  if (![301, 302, 303, 307, 308].includes(result.status)) {
    return { ...result, finalUrl: inputUrl };
  }
  if (redirects >= MAX_REDIRECTS) {
    throw new Error("El enlace excede el máximo de redirecciones permitido");
  }
  if (!result.redirect) throw new Error("El sitio redirigió a un destino inválido");
  const nextUrl = validateRagSourceUrl(new URL(result.redirect, inputUrl).href);
  return fetchPublicUrl(nextUrl, maxBytes, redirects + 1);
}

function decodeHtmlEntities(value) {
  const decodeCodePoint = (codePoint) => {
    const parsed = Number(codePoint);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 0x10ffff
      ? String.fromCodePoint(parsed)
      : "\uFFFD";
  };
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, decimal) => decodeCodePoint(decimal))
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) =>
      decodeCodePoint(parseInt(hex, 16)),
    );
}

function safeFileName(value) {
  const name = path.basename(String(value || "documento"))
    .replace(/[\r\n"]/g, "")
    .trim()
    .slice(0, 255);
  return name || "documento";
}

function getDispositionFileName(header) {
  const encoded = String(header || "").match(/filename\*=UTF-8''([^;]+)/i);
  if (encoded) {
    try {
      return safeFileName(decodeURIComponent(encoded[1]));
    } catch {
      return safeFileName(encoded[1]);
    }
  }
  const plain = String(header || "").match(/filename="?([^";]+)"?/i);
  return plain ? safeFileName(plain[1]) : "";
}

export function convertRagHtmlToMarkdown(html) {
  const title = decodeHtmlEntities(
    String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ?.replace(/<[^>]+>/g, " ") || "",
  ).replace(/\s+/g, " ").trim();
  let markdown = String(html || "")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|iframe|nav|footer|header)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<h([1-6])[^>]*>/gi, (_match, level) => `${"#".repeat(Number(level))} `)
    .replace(/<\/h[1-6]\s*>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/li\s*>/gi, "\n")
    .replace(/<(p|div|section|article|br|tr|table|ul|ol)[^>]*>/gi, "\n")
    .replace(/<\/(p|div|section|article|tr|table|ul|ol)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  markdown = decodeHtmlEntities(markdown)
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!markdown) throw new Error("No se pudo extraer texto de la página web");
  return {
    fileName: `${safeFileName(title || "pagina-web").replace(/\.[^.]+$/, "")}.md`,
    buffer: Buffer.from(`${title ? `# ${title}\n\n` : ""}${markdown}`, "utf8"),
    mimeType: "text/markdown",
    sourceType: "web_page",
  };
}

export async function importRagSourceUrl(value, { maxBytes }) {
  const sourceUrl = validateRagSourceUrl(value);
  const result = await fetchPublicUrl(sourceUrl, maxBytes);
  const contentType = result.contentType;
  if (contentType === "text/html" || contentType === "application/xhtml+xml") {
    const converted = convertRagHtmlToMarkdown(result.buffer.toString("utf8"));
    return {
      ...converted,
      sourceUrl: sourceUrl.href,
      byteSize: converted.buffer.length,
    };
  }

  let pathFileName = path.basename(result.finalUrl.pathname);
  try {
    pathFileName = decodeURIComponent(pathFileName);
  } catch {
    pathFileName = path.basename(result.finalUrl.pathname);
  }
  const fileName =
    getDispositionFileName(result.contentDisposition) ||
    safeFileName(pathFileName);
  const extension = path.extname(fileName).toLowerCase();
  const allowed = new Set([".docx", ".json", ".md", ".pdf", ".txt"]);
  if (!allowed.has(extension)) {
    throw new Error(
      "El enlace no apunta a una página HTML ni a un archivo compatible (PDF, DOCX, JSON, Markdown o TXT)",
    );
  }
  return {
    buffer: result.buffer,
    fileName,
    mimeType: contentType || "application/octet-stream",
    byteSize: result.buffer.length,
    sourceType: "url_file",
    sourceUrl: sourceUrl.href,
  };
}
