import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./customer-chat-answer.css";

const CITATION_HREF_PREFIX = "#cita-";

// Inserts a numbered link after the end of each anchored sentence. Positions come from the markdown source,
// so a marker is placed after the text node that holds the end of the sentence (splitting it when it can be
// done exactly) and never inside code or other non-text nodes.
function remarkCitationMarkers({ anchors, idPrefix, labels }) {
  return () => (tree) => {
    if (!anchors.length) return;
    const entries = [];
    const collect = (node, parent) => {
      if (node.type === "text" && node.position?.start?.offset !== undefined) entries.push({ node, parent });
      (node.children || []).forEach((child) => collect(child, node));
    };
    collect(tree, null);
    const markersFor = (citations) => citations.map((number) => ({
      type: "link",
      url: `${CITATION_HREF_PREFIX}${idPrefix}-${number}`,
      title: null,
      children: [{ type: "text", value: `[${number}]` }],
      data: { hProperties: {
        className: ["customer-chat-citation-marker"],
        "aria-label": `Fuente ${number}: ${labels[number - 1] || "registro del CRM"}`,
      } },
    }));
    for (const anchor of [...anchors].sort((a, b) => b.end - a.end)) {
      let position = entries.findIndex(({ node }) =>
        node.position.start.offset < anchor.end && anchor.end <= node.position.end.offset);
      if (position < 0) {
        position = entries.reduce((best, { node }, index) =>
          (node.position.end.offset <= anchor.end && (best < 0 || node.position.end.offset >= entries[best].node.position.end.offset) ? index : best), -1);
        if (position < 0) continue;
      }
      const { node, parent } = entries[position];
      const start = node.position.start.offset;
      const cut = anchor.end - start;
      const exact = node.value.length === node.position.end.offset - start;
      const siblings = parent.children;
      const at = siblings.indexOf(node);
      const markers = markersFor(anchor.citations);
      if (exact && cut > 0 && cut < node.value.length) {
        const rest = {
          type: "text",
          value: node.value.slice(cut),
          position: { start: { ...node.position.start, offset: anchor.end }, end: node.position.end },
        };
        node.value = node.value.slice(0, cut);
        node.position = { start: node.position.start, end: { ...node.position.end, offset: anchor.end } };
        siblings.splice(at + 1, 0, ...markers, rest);
        entries.splice(position + 1, 0, { node: rest, parent });
      } else {
        siblings.splice(at + 1, 0, ...markers);
      }
    }
  };
}

export function CustomerChatAnswer({ answer, citationAnchors = [], citationLabels = [], citationIdPrefix = "", onCitationSelect }) {
  const components = {
    table: ({ children }) => (
      <div className="customer-chat-table-scroll" role="region" aria-label="Tabla de la respuesta" tabIndex={0}>
        <table>{children}</table>
      </div>
    ),
    th: ({ children, style }) => <th scope="col" style={style}>{children}</th>,
    a: ({ children, href, ...props }) => {
      if (String(href || "").startsWith(CITATION_HREF_PREFIX)) {
        const target = href.slice(1);
        return (
          <a
            href={href}
            className={props.className}
            aria-label={props["aria-label"]}
            onClick={(event) => { event.preventDefault(); onCitationSelect?.(target); }}
          >
            {children}
          </a>
        );
      }
      return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
    },
  };
  const plugins = citationAnchors.length
    ? [remarkGfm, remarkCitationMarkers({ anchors: citationAnchors, idPrefix: citationIdPrefix, labels: citationLabels })]
    : [remarkGfm];
  return (
    <div className="customer-chat-answer">
      <Markdown remarkPlugins={plugins} components={components} skipHtml disallowedElements={["img"]}>
        {String(answer || "")}
      </Markdown>
    </div>
  );
}
