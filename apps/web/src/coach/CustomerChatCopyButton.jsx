import { useEffect, useRef, useState } from "react";

// Copies an answer to the clipboard and confirms it visually and to screen readers.
export function CustomerChatCopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);
  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(String(text || ""));
      setCopied(true);
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  if (!String(text || "").trim()) return null;
  return (
    <span className="mi-agent-customer-chat-copy">
      <button type="button" className="mi-agent-secondary-button" onClick={copy}>
        {copied ? "Copiado" : "Copiar respuesta"}
      </button>
      <span className="mi-agent-sr-only" aria-live="polite">
        {copied ? "Respuesta copiada al portapapeles" : ""}
      </span>
    </span>
  );
}
