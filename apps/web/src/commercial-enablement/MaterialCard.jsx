import { useEffect, useRef, useState } from "react";
import { AlertTriangle, MoreHorizontal, Star } from "lucide-react";
import { AudienceBadge, MaterialIcon, StatusBadge } from "./LibraryParts";
import {
  formatDate,
  getCardWarning,
  getCatalogNames,
  getResource,
} from "./libraryModel";

function CardMenu({ asset, onCopyLink, onDownload }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const resource = getResource(asset);

  useEffect(() => {
    if (!open) return undefined;
    function handlePointer(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointer);
    return () => document.removeEventListener("mousedown", handlePointer);
  }, [open]);

  function run(action) {
    setOpen(false);
    action(asset);
  }

  return (
    <div className="sl-card-menu" ref={containerRef}>
      <button
        type="button"
        className="sl-icon-button"
        aria-label={`Más acciones para ${asset.title}`}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
      {open ? (
        <div className="sl-menu" role="menu">
          {asset.isShareable && asset.isActive ? (
            <button type="button" role="menuitem" onClick={() => run(onCopyLink)}>
              Copiar enlace
            </button>
          ) : null}
          {resource.kind !== "none" ? (
            <button type="button" role="menuitem" onClick={() => run(onDownload)}>
              {resource.kind === "link" ? "Abrir enlace" : "Descargar"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function MaterialCard({
  asset,
  isSelected,
  onOpen,
  onToggleFavorite,
  onCopyLink,
  onDownload,
}) {
  const manufacturers = getCatalogNames(asset, "manufacturer");
  const warning = getCardWarning(asset);

  return (
    <article
      className={`sl-card ${isSelected ? "is-selected" : ""} ${asset.isActive ? "" : "is-inactive"}`}
    >
      <button
        type="button"
        className="sl-card-main"
        onClick={() => onOpen(asset)}
        aria-label={`Ver ${asset.title}`}
      >
        <span className="sl-card-thumb">
          <MaterialIcon asset={asset} />
        </span>
        <span className="sl-card-type">{asset.assetTypeLabel}</span>
        <strong className="sl-card-title">{asset.title}</strong>
        <span className="sl-card-meta">
          {manufacturers[0] || "Sin fabricante"} · {formatDate(asset.updatedAt)}
        </span>
        {warning ? (
          <span className="sl-card-warning">
            <AlertTriangle size={12} aria-hidden="true" /> {warning}
          </span>
        ) : null}
      </button>
      <div className="sl-card-footer">
        <span className="sl-card-badges">
          <AudienceBadge asset={asset} />
          {!asset.isActive ? <StatusBadge asset={asset} /> : null}
        </span>
        <span className="sl-card-actions">
          <button
            type="button"
            className={`sl-icon-button ${asset.isFavorite ? "is-favorite" : ""}`}
            aria-label={
              asset.isFavorite ? "Quitar de favoritos" : "Agregar a favoritos"
            }
            aria-pressed={asset.isFavorite}
            onClick={() => onToggleFavorite(asset)}
          >
            <Star
              size={18}
              fill={asset.isFavorite ? "currentColor" : "none"}
              aria-hidden="true"
            />
          </button>
          <CardMenu
            asset={asset}
            onCopyLink={onCopyLink}
            onDownload={onDownload}
          />
        </span>
      </div>
    </article>
  );
}
