import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, getApiErrorMessage } from "./api";
import "./documentation/documentation.css";

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function resolveDocumentationAssetUrl(source, documentPath = "") {
  const normalizedSource = String(source || "").trim();
  if (/^https?:\/\//i.test(normalizedSource)) return normalizedSource;
  if (normalizedSource.startsWith("/")) return normalizedSource;

  const pathParts = String(documentPath || "")
    .split("/")
    .filter(Boolean);
  pathParts.pop();
  for (const part of normalizedSource.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      pathParts.pop();
      continue;
    }
    pathParts.push(part);
  }

  return `/api/documentation/assets?path=${encodeURIComponent(pathParts.join("/"))}`;
}

function getDocumentationImageUrls(markdown = "", documentPath = "") {
  return Array.from(
    String(markdown || "").matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g),
  )
    .map((match) => resolveDocumentationAssetUrl(match[1], documentPath))
    .filter((source) => source.startsWith("/api/documentation/assets?"));
}

function renderInlineMarkdown(text = "", documentPath = "", assetUrls = {}) {
  let html = escapeHtml(text);
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/_(.+?)_/g, "<em>$1</em>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_match, alt, source) => {
    const resolvedSource = resolveDocumentationAssetUrl(source, documentPath);
    const src = escapeHtml(assetUrls[resolvedSource] || resolvedSource);
    return `<img src="${src}" alt="${alt}" loading="lazy" />`;
  });
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]+|\.{1,2}\/[^\s)]+)\)/gi,
    (_match, label, source) => {
      if (source.startsWith("./") || source.startsWith("../")) {
        const [relativePath, fragment] = source.split("#");
        const assetUrl = resolveDocumentationAssetUrl(relativePath, documentPath);
        const resolvedPath = new URLSearchParams(assetUrl.split("?")[1]).get("path");
        const hash = fragment ? `#${fragment}` : "";
        if (!/\.md$/i.test(relativePath)) {
          const repositoryPath = resolvedPath.split("/").map(encodeURIComponent).join("/");
          return `<a href="https://github.com/ocpdata/newpeople/blob/main/${repositoryPath}${hash}" target="_blank" rel="noreferrer">${label}</a>`;
        }
        const slug = resolvedPath
          .trim()
          .toLowerCase()
          .replace(/\\/g, "/")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") || "documento";
        return `<a href="/documentation/${slug}${hash}">${label}</a>`;
      }
      return `<a href="${source}" target="_blank" rel="noreferrer">${label}</a>`;
    },
  );
  return html;
}

function splitMarkdownTableRow(row) {
  return String(row || "")
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isMarkdownTableSeparator(row) {
  const cells = splitMarkdownTableRow(row);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function renderMarkdownToHtml(
  markdown = "",
  documentPath = "",
  assetUrls = {},
) {
  const content = String(markdown || "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (!content) return "";

  const renderBlock = (block) => {
    const trimmed = block.trim();
    if (!trimmed) return "";

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = renderInlineMarkdown(
        headingMatch[2],
        documentPath,
        assetUrls,
      );
      return `<h${level}>${text}</h${level}>`;
    }

    const fencedCode = trimmed.match(/^```(\w+)?\n([\s\S]*?)\n```$/);
    if (fencedCode) {
      const code = escapeHtml(fencedCode[2]);
      return `<pre class="documentation-code"><code>${code}</code></pre>`;
    }

    const listLines = trimmed.split(/\n/);
    if (
      listLines.length >= 2 &&
      listLines[0].includes("|") &&
      isMarkdownTableSeparator(listLines[1])
    ) {
      const headers = splitMarkdownTableRow(listLines[0]);
      const rows = listLines.slice(2).map(splitMarkdownTableRow);
      const headerHtml = headers
        .map(
          (cell) =>
            `<th>${renderInlineMarkdown(cell, documentPath, assetUrls)}</th>`,
        )
        .join("");
      const bodyHtml = rows
        .map(
          (row) =>
            `<tr>${headers
              .map(
                (_header, index) =>
                  `<td>${renderInlineMarkdown(
                    row[index] || "",
                    documentPath,
                    assetUrls,
                  )}</td>`,
              )
              .join("")}</tr>`,
        )
        .join("");
      return `<div class="documentation-table-wrap"><table class="documentation-table"><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
    }

    const listMarker = /^([-*+]\s+|\d+\.\s+)/;
    const isList = listMarker.test(listLines[0].trim()) &&
      listLines.every((line) =>
        listMarker.test(line.trim()) || /^\s+\S/.test(line),
      );
    if (isList) {
      const itemLines = [];
      for (const line of listLines) {
        if (listMarker.test(line.trim())) {
          itemLines.push(line.trim());
        } else {
          itemLines[itemLines.length - 1] += ` ${line.trim()}`;
        }
      }
      const ordered = itemLines.every((line) => /^\d+\.\s+/.test(line));
      const tag = ordered ? "ol" : "ul";
      const items = itemLines
        .map((line) => {
          const cleaned = line.trim();
          const text = cleaned.replace(/^([-*+]|\d+\.)\s+/, "");
          return `<li>${renderInlineMarkdown(text, documentPath, assetUrls)}</li>`;
        })
        .join("");

      return `<${tag}>${items}</${tag}>`;
    }

    const quoteLines = trimmed.split(/\n/);
    const isQuote = quoteLines.every((line) => /^>\s?/.test(line));
    if (isQuote) {
      const quoteHtml = quoteLines
        .map((line) =>
          renderInlineMarkdown(
            line.replace(/^>\s?/, ""),
            documentPath,
            assetUrls,
          ),
        )
        .join("<br />");
      return `<blockquote>${quoteHtml}</blockquote>`;
    }

    const paragraph = renderInlineMarkdown(trimmed, documentPath, assetUrls);
    return `<p>${paragraph}</p>`;
  };

  const renderBlocks = (blocks) => {
    const rendered = [];
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      const trimmed = block.trim();
      if (!trimmed) continue;

      const detailsMatch = trimmed.match(/^:::details[ \t]+(.+)$/);
      if (detailsMatch) {
        let depth = 1;
        const innerBlocks = [];
        let closingIndex = -1;

        for (
          let candidateIndex = index + 1;
          candidateIndex < blocks.length;
          candidateIndex += 1
        ) {
          const candidate = blocks[candidateIndex].trim();
          if (/^:::details[ \t]+/.test(candidate)) {
            depth += 1;
            innerBlocks.push(blocks[candidateIndex]);
          } else if (candidate === ":::") {
            depth -= 1;
            if (depth === 0) {
              closingIndex = candidateIndex;
              break;
            }
            innerBlocks.push(blocks[candidateIndex]);
          } else {
            innerBlocks.push(blocks[candidateIndex]);
          }
        }

        if (closingIndex >= 0) {
          const summary = renderInlineMarkdown(
            detailsMatch[1],
            documentPath,
            assetUrls,
          );
          rendered.push(
            `<details class="documentation-collapsible"><summary>${summary}</summary><div class="documentation-collapsible-content">${renderBlocks(innerBlocks)}</div></details>`,
          );
          index = closingIndex;
          continue;
        }
      }

      rendered.push(renderBlock(block));
    }
    return rendered.join("");
  };

  return renderBlocks(content.split(/\n\s*\n/));
}

export default function DocumentationPage() {
  const { docId } = useParams();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [documentationAssetUrls, setDocumentationAssetUrls] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let ignore = false;

    async function loadCatalog() {
      setLoading(true);
      setError("");
      try {
        const { data } = await api.get("/api/documentation");
        if (ignore) return;
        setItems(Array.isArray(data?.items) ? data.items : []);
      } catch (loadError) {
        if (ignore) return;
        setError(
          getApiErrorMessage(
            loadError,
            "No fue posible cargar la documentación disponible",
          ),
        );
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    void loadCatalog();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!docId) {
      setSelectedItem(null);
      return;
    }

    let ignore = false;

    async function loadDocument() {
      setLoading(true);
      setError("");
      try {
        const { data } = await api.get(
          `/api/documentation/${encodeURIComponent(docId)}`,
        );
        if (ignore) return;
        setSelectedItem(data?.item || null);
      } catch (loadError) {
        if (ignore) return;
        setError(
          getApiErrorMessage(loadError, "No fue posible cargar este documento"),
        );
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    void loadDocument();
    return () => {
      ignore = true;
    };
  }, [docId]);

  const selectedTitle = useMemo(
    () => selectedItem?.title || "Documentación",
    [selectedItem],
  );

  async function exportDocumentationPdf() {
    const content = document.querySelector(".documentation-content");
    if (!content) return;

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setError("Permite las ventanas emergentes para exportar el documento a PDF.");
      return;
    }
    printWindow.opener = null;

    try {
      printWindow.document.open();
      printWindow.document.write(`<!doctype html>
        <html lang="es">
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>${escapeHtml(selectedTitle)}</title>
            <style>
              @page { size: A4; margin: 16mm; }
              * { box-sizing: border-box; }
              body {
                margin: 0;
                color: #1f2937;
                font: 10pt/1.6 Arial, Helvetica, sans-serif;
                overflow-wrap: anywhere;
              }
              h1, h2, h3, h4, h5, h6 {
                color: #0f172a;
                line-height: 1.3;
                break-after: avoid;
              }
              h1 { margin: 0 0 1.2em; font-size: 22pt; }
              h2 { font-size: 17pt; }
              h3 { font-size: 14pt; }
              p, ul, ol, blockquote, pre, table { margin: 0.8em 0; }
              li { break-inside: avoid; }
              a { color: #1d4ed8; }
              img { max-width: 100%; height: auto; break-inside: avoid; }
              table { width: 100%; border-collapse: collapse; }
              th, td {
                padding: 6pt;
                border: 1px solid #cbd5e1;
                text-align: left;
                vertical-align: top;
              }
              th { background: #eaf2f5; }
              pre {
                padding: 8pt;
                background: #f1f5f9;
                white-space: pre-wrap;
                break-inside: avoid;
              }
              code { font-family: Menlo, Consolas, monospace; font-size: 9pt; }
              details { margin: 0.8em 0; }
              details > summary { font-weight: bold; }
              details > :not(summary) { display: block !important; }
              blockquote { padding-left: 10pt; border-left: 3px solid #93c5fd; }
              tr { break-inside: avoid; }
            </style>
          </head>
          <body>
            <main>
              <h1>${escapeHtml(selectedTitle)}</h1>
              ${content.innerHTML}
            </main>
          </body>
        </html>`);
      printWindow.document.close();
      printWindow.document.querySelectorAll("details").forEach((details) => {
        details.open = true;
      });

      const imagesReady = Promise.all(
        Array.from(printWindow.document.images, (image) =>
          typeof image.decode === "function"
            ? image.decode().catch(() => undefined)
            : Promise.resolve(),
        ),
      );
      await Promise.race([
        Promise.all([imagesReady, printWindow.document.fonts?.ready]),
        new Promise((resolve) => window.setTimeout(resolve, 5000)),
      ]);
      printWindow.focus();
      printWindow.print();
    } catch (printError) {
      printWindow.close();
      setError(
        getApiErrorMessage(
          printError,
          "No fue posible preparar el documento para exportarlo a PDF",
        ),
      );
    }
  }

  useEffect(() => {
    let ignore = false;
    const objectUrls = [];
    const assetUrls = getDocumentationImageUrls(
      selectedItem?.content || "",
      selectedItem?.path || "",
    );

    setDocumentationAssetUrls({});
    if (!assetUrls.length) return undefined;

    Promise.all(
      assetUrls.map(async (assetUrl) => {
        const response = await api.get(assetUrl, { responseType: "blob" });
        const objectUrl = URL.createObjectURL(response.data);
        objectUrls.push(objectUrl);
        return [assetUrl, objectUrl];
      }),
    )
      .then((entries) => {
        if (!ignore) setDocumentationAssetUrls(Object.fromEntries(entries));
      })
      .catch(() => {
        if (!ignore) setDocumentationAssetUrls({});
      });

    return () => {
      ignore = true;
      objectUrls.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
    };
  }, [selectedItem]);

  const groupedItems = useMemo(() => {
    const buckets = new Map();
    for (const item of items) {
      const category = String(item?.category || "General").trim();
      if (!buckets.has(category)) {
        buckets.set(category, []);
      }
      buckets.get(category).push(item);
    }

    return Array.from(buckets.entries()).sort(([left], [right]) =>
      left.localeCompare(right, "es", { sensitivity: "base" }),
    );
  }, [items]);

  if (docId && selectedItem) {
    return (
      <section className="panel documentation-page">
        <header className="documentation-header">
          <div>
            <div className="module-title-with-icon">
              <h2>Documentación</h2>
              <span
                className="module-title-icon documentation-title-icon"
                aria-hidden="true"
              >
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M6 2.75A2.75 2.75 0 0 0 3.25 5.5v13A2.75 2.75 0 0 0 6 21.25h12.75a1 1 0 0 0 1-1V5a2 2 0 0 0-2-2H6Zm1 3.5h8.5a1 1 0 1 1 0 2H7a1 1 0 1 1 0-2Zm0 4h8.5a1 1 0 1 1 0 2H7a1 1 0 1 1 0-2Zm0 4h5.5a1 1 0 0 1 0 2H7a1 1 0 0 1 0-2Z" />
                </svg>
              </span>
            </div>
            <p className="roles-subtitle">{selectedTitle}</p>
          </div>
          <div className="documentation-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void exportDocumentationPdf()}
            >
              Exportar a PDF
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => navigate("/documentation")}
            >
              Volver a la lista
            </button>
          </div>
        </header>

        {error ? <div className="toast toast-error">{error}</div> : null}

        <article className="documentation-article">
          <div className="documentation-article-meta">
            <span className="documentation-badge">{selectedItem.category}</span>
            <span className="field-hint">{selectedItem.path}</span>
          </div>
          <div
            className="documentation-content"
            dangerouslySetInnerHTML={{
              __html: renderMarkdownToHtml(
                selectedItem.content || "",
                selectedItem.path || "",
                documentationAssetUrls,
              ),
            }}
          />
        </article>
      </section>
    );
  }

  return (
    <section className="panel documentation-page">
      <header className="documentation-header">
        <div>
          <div className="module-title-with-icon">
            <h2>Documentación</h2>
            <span
              className="module-title-icon documentation-title-icon"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M6 2.75A2.75 2.75 0 0 0 3.25 5.5v13A2.75 2.75 0 0 0 6 21.25h12.75a1 1 0 0 0 1-1V5a2 2 0 0 0-2-2H6Zm1 3.5h8.5a1 1 0 1 1 0 2H7a1 1 0 1 1 0-2Zm0 4h8.5a1 1 0 1 1 0 2H7a1 1 0 1 1 0-2Zm0 4h5.5a1 1 0 0 1 0 2H7a1 1 0 0 1 0-2Z" />
              </svg>
            </span>
          </div>
          <p className="roles-subtitle">
            Bibliografía interna del sistema y guías operativas para
            administración.
          </p>
        </div>
      </header>

      {error ? <div className="toast toast-error">{error}</div> : null}
      {loading ? <p className="field-hint">Cargando documentación...</p> : null}

      <div className="documentation-groups">
        {groupedItems.map(([category, categoryItems]) => (
          <div key={category} className="documentation-group">
            <h3 className="documentation-group-title">{category}</h3>
            <div className="documentation-list">
              {categoryItems.map((item) => (
                <article key={item.slug} className="documentation-card">
                  <div className="documentation-card-head">
                    <div>
                      <h4>{item.title}</h4>
                    </div>
                  </div>

                  <p className="documentation-description">
                    {item.description}
                  </p>
                  <div className="documentation-card-footer">
                    <span className="field-hint">{item.path}</span>
                    <Link
                      className="btn-primary"
                      to={`/documentation/${item.slug}`}
                    >
                      Ver documento
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
