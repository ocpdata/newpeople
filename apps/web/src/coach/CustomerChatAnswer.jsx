import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./customer-chat-answer.css";

const plugins = [remarkGfm];
const components = {
  table: ({ children }) => (
    <div className="customer-chat-table-scroll" role="region" aria-label="Tabla de la respuesta" tabIndex={0}>
      <table>{children}</table>
    </div>
  ),
  th: ({ children, style }) => <th scope="col" style={style}>{children}</th>,
  a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
};

export function CustomerChatAnswer({ answer }) {
  return (
    <div className="customer-chat-answer">
      <Markdown remarkPlugins={plugins} components={components} skipHtml disallowedElements={["img"]}>
        {String(answer || "")}
      </Markdown>
    </div>
  );
}
