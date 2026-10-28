import { useCallback, useEffect, useState } from "react";
import { Download, ExternalLink, FilePlus, Link as LinkIcon, Mail, Star, X } from "lucide-react";
import { api, getApiErrorMessage } from "../api";
import { AudienceBadge, MaterialIcon, StatusBadge } from "./LibraryParts";
import { ProposalMaterialDialog, SendMaterialDialog } from "./UseMaterialDialogs";
import {
  API_BASE,
  copyShareLink,
  describeExpiry,
  downloadAssetFile,
  formatBytes,
  describeCopyResult,
  formatDate,
  getCatalogNames,
  getResource,
  getResourceKind,
  isPreviewable,
  openAssetLink,
} from "./libraryModel";

function Preview({ asset }) {
  const [previewUrl, setPreviewUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const kind = getResourceKind(asset);
  const previewable = isPreviewable(asset);
  const file = getResource(asset).file;
  const assetPublicId = asset.publicId;
  const filePublicId = file?.publicId;

  useEffect(() => {
    if (!previewable || !filePublicId) return undefined;
    let cancelled = false;
    let objectUrl = "";
    api
      .get(`${API_BASE}/assets/${assetPublicId}/files/${filePublicId}/content`, {
        responseType: "blob",
        timeout: 60000,
      })
      .then((response) => {
        if (cancelled) return;
        objectUrl = window.URL.createObjectURL(response.data);
        setPreviewUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) window.URL.revokeObjectURL(objectUrl);
    };
  }, [previewable, assetPublicId, filePublicId]);

  if (!previewable) {
    return (
      <div className="sl-preview sl-preview-empty">
        <MaterialIcon asset={asset} size={44} />
        <p>
          {kind === "link"
            ? "Material enlazado: ábrelo para verlo."
            : "Vista previa no disponible para este formato. Descarga el archivo para verlo."}
        </p>
      </div>
    );
  }
  if (failed) {
    return (
      <div className="sl-preview sl-preview-empty">
        <p>No fue posible cargar la vista previa.</p>
      </div>
    );
  }
  if (!previewUrl) {
    return (
      <div className="sl-preview sl-preview-empty">
        <p>Cargando vista previa...</p>
      </div>
    );
  }
  return (
    <div className="sl-preview">
      {kind === "image" ? (
        <img src={previewUrl} alt={asset.title} />
      ) : (
        <iframe src={previewUrl} title={`Vista previa de ${asset.title}`} />
      )}
    </div>
  );
}

function DetailRow({ label, values }) {
  const text = Array.isArray(values) ? values.join(", ") : values;
  if (!text) return null;
  return (
    <div className="sl-detail-row">
      <dt>{label}</dt>
      <dd>{text}</dd>
    </div>
  );
}

export default function MaterialPanel({
  publicId,
  onClose,
  onOpenRelated,
  onChanged,
  onEdit,
  onDeleted,
  notify,
  capabilities,
}) {
  const [asset, setAsset] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(null);
  const canSend = capabilities.canEmailOpportunity || capabilities.canEmailLead;

  useEffect(() => {
    let cancelled = false;
    api
      .get(`${API_BASE}/assets/${publicId}`)
      .then((response) => {
        if (cancelled) return;
        setAsset(response.data);
        api
          .post(`${API_BASE}/assets/${publicId}/usage-events`, {
            eventType: "viewed",
          })
          .catch(() => undefined);
      })
      .catch((requestError) => {
        if (!cancelled) {
          setAsset(null);
          setError(
            getApiErrorMessage(requestError, "No fue posible abrir el material"),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [publicId]);

  const update = useCallback(
    (next) => {
      setAsset((current) => ({ ...(current || {}), ...next }));
      onChanged?.(next);
    },
    [onChanged],
  );

  async function run(task, fallbackMessage) {
    setBusy(true);
    try {
      await task();
    } catch (requestError) {
      notify(getApiErrorMessage(requestError, fallbackMessage), "error");
    } finally {
      setBusy(false);
    }
  }

  function handleFavorite() {
    return run(async () => {
      const response = asset.isFavorite
        ? await api.delete(`${API_BASE}/assets/${publicId}/favorite`)
        : await api.post(`${API_BASE}/assets/${publicId}/favorite`);
      update({ isFavorite: response.data.isFavorite });
    }, "No fue posible actualizar favoritos");
  }

  function handleCopyLink() {
    return run(async () => {
      const result = await copyShareLink(asset);
      notify(describeCopyResult(result), result.copied ? "success" : "error");
    }, "No fue posible crear el enlace");
  }

  function handleDownload() {
    const resource = getResource(asset);
    if (resource.kind === "link") return openAssetLink(asset, resource.link);
    return run(
      () => downloadAssetFile(asset, resource.file),
      "No fue posible descargar el archivo",
    );
  }

  function handleToggleActive() {
    return run(async () => {
      const action = asset.isActive ? "deactivate" : "activate";
      const response = await api.post(
        `${API_BASE}/assets/${publicId}/${action}`,
        {},
      );
      update(response.data);
      notify(
        asset.isActive ? "Material desactivado." : "Material activado.",
        "success",
      );
    }, "No fue posible cambiar el estado");
  }

  function handleDelete() {
    if (
      !window.confirm(
        "Esto elimina el material y su archivo de forma permanente. Si solo quieres ocultarlo, usa Desactivar. ¿Eliminar?",
      )
    ) {
      return undefined;
    }
    return run(async () => {
      await api.delete(`${API_BASE}/assets/${publicId}`);
      notify("Material eliminado.", "success");
      onDeleted?.(publicId);
    }, "No fue posible eliminar el material");
  }

  const resource = asset ? getResource(asset) : { kind: "none" };
  const expiryText = asset ? describeExpiry(asset) : "";

  return (
    <aside className="sl-panel" aria-label="Detalle del material">
      <div className="sl-panel-header">
        <button
          type="button"
          className="sl-icon-button"
          onClick={onClose}
          aria-label="Cerrar detalle"
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      {loading ? <p className="sl-muted sl-panel-pad">Cargando...</p> : null}
      {error ? (
        <p className="form-error sl-panel-pad" role="alert">
          {error}
        </p>
      ) : null}
      {asset ? (
        <div className="sl-panel-body">
          <div className="sl-panel-title">
            <span className="sl-card-type">{asset.assetTypeLabel}</span>
            <h2>{asset.title}</h2>
            <div className="sl-card-badges">
              <AudienceBadge asset={asset} />
              <StatusBadge asset={asset} />
              {expiryText ? <span className="sl-badge">{expiryText}</span> : null}
            </div>
          </div>

          {!asset.isShareable ? (
            <p className="sl-callout">
              Material solo interno: no lo envíes ni lo compartas con clientes.
            </p>
          ) : null}

          <Preview key={getResource(asset).file?.publicId || "none"} asset={asset} />

          <div className="sl-panel-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={handleDownload}
              disabled={busy || resource.kind === "none"}
            >
              {resource.kind === "link" ? (
                <ExternalLink size={16} aria-hidden="true" />
              ) : (
                <Download size={16} aria-hidden="true" />
              )}{" "}
              {resource.kind === "link" ? "Abrir enlace" : "Descargar"}
            </button>
            {asset.isShareable && asset.isActive ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={handleCopyLink}
                disabled={busy}
              >
                <LinkIcon size={16} aria-hidden="true" /> Copiar enlace
              </button>
            ) : null}
            {asset.isShareable && asset.isActive && canSend ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setDialog("send")}
                disabled={busy}
              >
                <Mail size={16} aria-hidden="true" /> Enviar por correo
              </button>
            ) : null}
            {asset.isShareable && asset.isActive && capabilities.canUseInProposal ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setDialog("proposal")}
                disabled={busy}
              >
                <FilePlus size={16} aria-hidden="true" /> Usar en propuesta
              </button>
            ) : null}
            <button
              type="button"
              className="btn-secondary"
              onClick={handleFavorite}
              disabled={busy}
              aria-pressed={asset.isFavorite}
            >
              <Star
                size={16}
                fill={asset.isFavorite ? "currentColor" : "none"}
                aria-hidden="true"
              />{" "}
              {asset.isFavorite ? "Favorito" : "Agregar a favoritos"}
            </button>
          </div>

          {asset.usageNote ? (
            <section className="sl-section">
              <h3>Cuándo usarlo</h3>
              <p>{asset.usageNote}</p>
            </section>
          ) : null}
          {asset.summary ? (
            <section className="sl-section">
              <h3>Resumen</h3>
              <p>{asset.summary}</p>
            </section>
          ) : null}

          <dl className="sl-details">
            <DetailRow label="Fabricante" values={getCatalogNames(asset, "manufacturer")} />
            <DetailRow label="Tecnología" values={getCatalogNames(asset, "technology")} />
            <DetailRow label="Solución" values={getCatalogNames(asset, "solution")} />
            <DetailRow label="Industria" values={getCatalogNames(asset, "industry")} />
            <DetailRow label="Idioma" values={String(asset.languageCode || "").toUpperCase()} />
            <DetailRow
              label="Archivo"
              values={
                resource.kind === "file"
                  ? `${resource.file.originalFileName} ${formatBytes(resource.file.byteSize)}`.trim()
                  : ""
              }
            />
            <DetailRow label="Actualizado" values={formatDate(asset.updatedAt)} />
          </dl>

          {asset.relatedItems?.length ? (
            <section className="sl-section">
              <h3>Materiales relacionados</h3>
              <ul className="sl-related">
                {asset.relatedItems.map((related) => (
                  <li key={related.publicId}>
                    <button type="button" onClick={() => onOpenRelated(related.publicId)}>
                      <strong>{related.title}</strong>
                      <span>{related.assetTypeLabel}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {asset.canToggle || asset.canDelete ? (
            <div className="sl-panel-actions sl-panel-admin">
              {asset.canEdit ? (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => onEdit(asset)}
                  disabled={busy}
                >
                  Editar
                </button>
              ) : null}
              {asset.canToggle ? (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleToggleActive}
                  disabled={busy}
                >
                  {asset.isActive ? "Desactivar" : "Reactivar"}
                </button>
              ) : null}
              {asset.canDelete ? (
                <button
                  type="button"
                  className="btn-danger"
                  onClick={handleDelete}
                  disabled={busy}
                >
                  Eliminar
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {dialog === "send" && asset ? (
        <SendMaterialDialog
          asset={asset}
          capabilities={capabilities}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "proposal" && asset ? (
        <ProposalMaterialDialog
          asset={asset}
          notify={notify}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </aside>
  );
}
