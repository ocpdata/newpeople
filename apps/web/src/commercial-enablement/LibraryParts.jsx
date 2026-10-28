import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  File,
  FileText,
  Image as ImageIcon,
  Link as LinkIcon,
  Lock,
  Presentation,
  Video,
  CheckCircle2,
} from "lucide-react";
import { getResourceKind } from "./libraryModel";

const ICONS_BY_KIND = {
  pdf: FileText,
  document: FileText,
  presentation: Presentation,
  image: ImageIcon,
  video: Video,
  link: LinkIcon,
  none: File,
};

export function MaterialIcon({ asset, size = 28 }) {
  const Icon = ICONS_BY_KIND[getResourceKind(asset)] || File;
  return <Icon size={size} aria-hidden="true" />;
}

export function AudienceBadge({ asset }) {
  return asset.isShareable ? (
    <span className="sl-badge sl-badge-client">
      <CheckCircle2 size={12} aria-hidden="true" /> Para cliente
    </span>
  ) : (
    <span className="sl-badge sl-badge-internal">
      <Lock size={12} aria-hidden="true" /> Solo interno
    </span>
  );
}

export function StatusBadge({ asset }) {
  return (
    <span
      className={`sl-badge ${asset.isActive ? "sl-badge-active" : "sl-badge-inactive"}`}
    >
      {asset.isActive ? "Activo" : "Desactivado"}
    </span>
  );
}

function useDismissOnOutsideClick(ref, onDismiss, enabled) {
  useEffect(() => {
    if (!enabled) return undefined;
    function handlePointer(event) {
      if (ref.current && !ref.current.contains(event.target)) onDismiss();
    }
    function handleKey(event) {
      if (event.key === "Escape") onDismiss();
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [ref, onDismiss, enabled]);
}

// Menú desplegable de selección múltiple para los filtros.
export function FilterMenu({ label, options, selected, onToggle }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  useDismissOnOutsideClick(containerRef, () => setOpen(false), open);

  return (
    <div className="sl-filter" ref={containerRef}>
      <button
        type="button"
        className={`sl-filter-button ${selected.length ? "is-active" : ""}`}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        {label}
        {selected.length ? ` (${selected.length})` : ""}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div className="sl-popover" role="listbox" aria-label={label}>
          {options.length ? (
            options.map((option) => (
              <label key={option.code} className="sl-check">
                <input
                  type="checkbox"
                  checked={selected.includes(option.code)}
                  onChange={() => onToggle(option.code)}
                />
                {option.name}
              </label>
            ))
          ) : (
            <p className="sl-muted">Sin opciones</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function MoreFiltersMenu({ groups }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  useDismissOnOutsideClick(containerRef, () => setOpen(false), open);
  const activeCount = groups.reduce(
    (total, group) => total + group.selected.length,
    0,
  );

  return (
    <div className="sl-filter" ref={containerRef}>
      <button
        type="button"
        className={`sl-filter-button ${activeCount ? "is-active" : ""}`}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        Más filtros{activeCount ? ` (${activeCount})` : ""}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div className="sl-popover sl-popover-wide">
          {groups.map((group) =>
            group.options.length ? (
              <fieldset key={group.key} className="sl-fieldset">
                <legend>{group.label}</legend>
                {group.options.map((option) => (
                  <label key={option.code} className="sl-check">
                    <input
                      type="checkbox"
                      checked={group.selected.includes(option.code)}
                      onChange={() => group.onToggle(option.code)}
                    />
                    {option.name}
                  </label>
                ))}
              </fieldset>
            ) : null,
          )}
        </div>
      ) : null}
    </div>
  );
}

// Selector de opciones como chips; sirve para catálogos de varios valores.
export function ChipPicker({ options, selected, onToggle, emptyLabel }) {
  if (!options.length) {
    return <p className="sl-muted">{emptyLabel || "Sin opciones disponibles"}</p>;
  }
  return (
    <div className="sl-chip-row">
      {options.map((option) => {
        const isSelected = selected.includes(option.code);
        return (
          <button
            key={option.code}
            type="button"
            className={`sl-chip ${isSelected ? "is-selected" : ""}`}
            aria-pressed={isSelected}
            onClick={() => onToggle(option.code)}
          >
            {option.name}
          </button>
        );
      })}
    </div>
  );
}
