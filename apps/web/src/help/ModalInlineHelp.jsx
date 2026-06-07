import { useEffect, useRef, useState } from "react";
import { getModalHelp } from "./helpData";

export default function ModalInlineHelp({
  helpKey,
  triggerLabel = "?",
  ariaLabel,
  title,
  purpose,
  usage,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const shellRef = useRef(null);
  const catalogEntry = getModalHelp(helpKey);
  const resolvedAriaLabel = catalogEntry?.ariaLabel || ariaLabel || "Ayuda";
  const resolvedTitle = catalogEntry?.title || title || "Ayuda";
  const resolvedPurpose = catalogEntry?.purpose || purpose || "";
  const resolvedUsage = catalogEntry?.usage || usage || "";
  const resolvedSections = Array.isArray(catalogEntry?.sections)
    ? catalogEntry.sections
    : [];
  const resolvedModalActions = Array.isArray(catalogEntry?.modalActions)
    ? catalogEntry.modalActions
    : [];

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (!shellRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isOpen]);

  return (
    <div className="account-modal-help-shell" ref={shellRef}>
      <button
        type="button"
        className={
          triggerLabel === "?"
            ? "accounts-module-help-trigger account-modal-help-trigger"
            : "accounts-module-help-trigger account-modal-help-trigger account-modal-help-trigger-labeled"
        }
        aria-label={resolvedAriaLabel}
        aria-expanded={isOpen}
        title={resolvedAriaLabel}
        onClick={() => setIsOpen((current) => !current)}
      >
        {triggerLabel}
      </button>
      {isOpen ? (
        <div
          className="account-modal-help-popover"
          role="dialog"
          aria-label={resolvedTitle}
        >
          <strong>Para que sirve este modal</strong>
          <p>{resolvedPurpose}</p>
          <strong>Como conviene usarlo</strong>
          <p>{resolvedUsage}</p>
          {resolvedSections.length ? (
            <>
              <strong>Secciones del modal</strong>
              <div className="account-modal-help-blocks">
                {resolvedSections.map((section) => (
                  <article
                    key={section.title}
                    className="account-modal-help-block"
                  >
                    <h5>{section.title}</h5>
                    <p>{section.purpose}</p>
                    {Array.isArray(section.actions) &&
                    section.actions.length ? (
                      <ul>
                        {section.actions.map((action) => (
                          <li key={action}>{action}</li>
                        ))}
                      </ul>
                    ) : null}
                  </article>
                ))}
              </div>
            </>
          ) : null}
          {resolvedModalActions.length ? (
            <>
              <strong>Acciones clave</strong>
              <ul className="account-modal-help-actions">
                {resolvedModalActions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
