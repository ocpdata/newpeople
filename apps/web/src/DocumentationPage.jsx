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
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
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
  return (
    cells.length > 0 &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell))
  );
}

function renderMarkdownToHtml(markdown = "", documentPath = "", assetUrls = {}) {
  const content = String(markdown || "").replace(/\r\n/g, "\n").trim();
  if (!content) return "";

  const blocks = content.split(/\n\s*\n/);

  return blocks
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";

      const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const text = renderInlineMarkdown(headingMatch[2], documentPath, assetUrls);
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

      const isList = listLines.every((line) => /^([-*+]\s+|\d+\.\s+)/.test(line.trim()));
      if (isList) {
        const ordered = listLines.every((line) => /^\d+\.\s+/.test(line.trim()));
        const tag = ordered ? "ol" : "ul";
        const items = listLines
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
            renderInlineMarkdown(line.replace(/^>\s?/, ""), documentPath, assetUrls),
          )
          .join("<br />");
        return `<blockquote>${quoteHtml}</blockquote>`;
      }

      const paragraph = renderInlineMarkdown(trimmed, documentPath, assetUrls);
      return `<p>${paragraph}</p>`;
    })
    .join("");
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
        const { data } = await api.get(`/api/documentation/${encodeURIComponent(docId)}`);
        if (ignore) return;
        setSelectedItem(data?.item || null);
      } catch (loadError) {
        if (ignore) return;
        setError(
          getApiErrorMessage(
            loadError,
            "No fue posible cargar este documento",
          ),
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
              <span className="module-title-icon documentation-title-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M6 2.75A2.75 2.75 0 0 0 3.25 5.5v13A2.75 2.75 0 0 0 6 21.25h12.75a1 1 0 0 0 1-1V5a2 2 0 0 0-2-2H6Zm1 3.5h8.5a1 1 0 1 1 0 2H7a1 1 0 1 1 0-2Zm0 4h8.5a1 1 0 1 1 0 2H7a1 1 0 1 1 0-2Zm0 4h5.5a1 1 0 0 1 0 2H7a1 1 0 0 1 0-2Z"/>
                </svg>
              </span>
            </div>
            <p className="roles-subtitle">{selectedTitle}</p>
          </div>
          <div className="documentation-actions">
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
            <span className="module-title-icon documentation-title-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M6 2.75A2.75 2.75 0 0 0 3.25 5.5v13A2.75 2.75 0 0 0 6 21.25h12.75a1 1 0 0 0 1-1V5a2 2 0 0 0-2-2H6Zm1 3.5h8.5a1 1 0 1 1 0 2H7a1 1 0 1 1 0-2Zm0 4h8.5a1 1 0 1 1 0 2H7a1 1 0 1 1 0-2Zm0 4h5.5a1 1 0 0 1 0 2H7a1 1 0 0 1 0-2Z"/>
              </svg>
            </span>
          </div>
          <p className="roles-subtitle">
            Bibliografía interna del sistema y guías operativas para administración.
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

                  <p className="documentation-description">{item.description}</p>
                  <div className="documentation-card-footer">
                    <span className="field-hint">{item.path}</span>
                    <Link className="btn-primary" to={`/documentation/${item.slug}`}>
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
