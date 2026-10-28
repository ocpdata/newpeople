import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, getApiErrorMessage } from "../api";
import { API_BASE, setLibrarySendHandoff } from "./libraryModel";

const MAX_VISIBLE = 30;

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// Lista filtrable de destinos (oportunidades, leads o propuestas).
function TargetPicker({ label, loadItems, onPick, emptyMessage }) {
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState({ key: null, items: [], error: "" });

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(queryDraft.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [queryDraft]);

  useEffect(() => {
    let cancelled = false;
    loadItems(query)
      .then((items) => {
        if (!cancelled) setResult({ key: query, items, error: "" });
      })
      .catch((requestError) => {
        if (!cancelled) {
          setResult({
            key: query,
            items: [],
            error: getApiErrorMessage(requestError, "No fue posible cargar la lista"),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadItems, query]);

  const loading = result.key !== query;

  return (
    <div className="sl-picker">
      <input
        type="search"
        value={queryDraft}
        onChange={(event) => setQueryDraft(event.target.value)}
        placeholder={label}
        aria-label={label}
        autoFocus
      />
      {result.error ? (
        <p className="form-error" role="alert">
          {result.error}
        </p>
      ) : null}
      {loading ? <p className="sl-muted">Buscando...</p> : null}
      <ul className="sl-picker-list">
        {result.items.slice(0, MAX_VISIBLE).map((item) => (
          <li key={item.id}>
            <button type="button" onClick={() => onPick(item)}>
              <strong>{item.label}</strong>
              {item.sublabel ? <span>{item.sublabel}</span> : null}
            </button>
          </li>
        ))}
        {!loading && !result.items.length && !result.error ? (
          <li className="sl-muted">{emptyMessage}</li>
        ) : null}
      </ul>
    </div>
  );
}

function DialogShell({ title, intro, onClose, children }) {
  useEffect(() => {
    function handleKey(event) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div className="modal-overlay modal-overlay-elevated">
      <div className="sl-modal sl-modal-small" role="dialog" aria-modal="true" aria-label={title}>
        <header className="sl-modal-header">
          <h2>{title}</h2>
          <button type="button" className="btn-tertiary" onClick={onClose}>
            Cerrar
          </button>
        </header>
        <div className="sl-modal-body">
          {intro ? <p className="sl-muted">{intro}</p> : null}
          {children}
        </div>
      </div>
    </div>
  );
}

// "Enviar por correo": elige la oportunidad o el lead y abre su modal de correo con el adjunto.
export function SendMaterialDialog({ asset, capabilities, onClose }) {
  const navigate = useNavigate();
  const targets = [
    capabilities.canEmailOpportunity && { id: "opportunity", label: "Oportunidad" },
    capabilities.canEmailLead && { id: "lead", label: "Lead" },
  ].filter(Boolean);
  const [targetType, setTargetType] = useState(targets[0]?.id || "");

  const loadOpportunities = useStableLoader(async (query) => {
    const { data } = await api.get("/api/opportunities", {
      params: { openOnly: "true" },
    });
    const needle = normalize(query);
    return (Array.isArray(data) ? data : [])
      .filter((row) => !needle || normalize(`${row.name} ${row.account_name}`).includes(needle))
      .map((row) => ({
        id: row.id,
        label: row.name,
        sublabel: [row.account_name, row.sales_stage].filter(Boolean).join(" · "),
      }));
  });
  const loadLeads = useStableLoader(async (query) => {
    const { data } = await api.get("/api/interactions", {
      params: { page: 1, pageSize: 20, query },
    });
    return (Array.isArray(data?.items) ? data.items : []).map((row) => ({
      id: row.id,
      label: row.title || `Lead ${row.id}`,
      sublabel: row.accountName || "",
    }));
  });

  function handlePick(item) {
    setLibrarySendHandoff({
      assetPublicId: asset.publicId,
      targetType,
      targetId: item.id,
    });
    onClose();
    navigate(
      targetType === "opportunity"
        ? `/opportunities?edit=${item.id}`
        : `/interactions?leadId=${item.id}`,
    );
  }

  return (
    <DialogShell
      title="Enviar por correo"
      intro={`Elige a dónde enviar «${asset.title}». Se abrirá el correo con el material adjunto.`}
      onClose={onClose}
    >
      {targets.length > 1 ? (
        <div className="sl-segmented" role="tablist" aria-label="Destino">
          {targets.map((target) => (
            <button
              key={target.id}
              type="button"
              role="tab"
              aria-selected={targetType === target.id}
              className={targetType === target.id ? "is-active" : ""}
              onClick={() => setTargetType(target.id)}
            >
              {target.label}
            </button>
          ))}
        </div>
      ) : null}
      {targetType === "opportunity" ? (
        <TargetPicker
          key="opportunity"
          label="Buscar oportunidad abierta"
          loadItems={loadOpportunities}
          onPick={handlePick}
          emptyMessage="No hay oportunidades abiertas que coincidan."
        />
      ) : (
        <TargetPicker
          key="lead"
          label="Buscar lead"
          loadItems={loadLeads}
          onPick={handlePick}
          emptyMessage="No hay leads que coincidan."
        />
      )}
    </DialogShell>
  );
}

// "Usar en propuesta": agrega el material a la sección de folletos de una propuesta abierta.
export function ProposalMaterialDialog({ asset, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState(null);

  const loadProposals = useStableLoader(async (query) => {
    const { data } = await api.get("/api/proposals");
    const needle = normalize(query);
    return (Array.isArray(data) ? data : [])
      .filter((row) => row.statusCode !== "archived")
      .filter(
        (row) =>
          !needle ||
          normalize(`${row.title} ${row.accountName} ${row.opportunityName}`).includes(needle),
      )
      .map((row) => ({
        id: row.id,
        label: row.title || `Propuesta ${row.id}`,
        sublabel: [row.accountName, row.opportunityName].filter(Boolean).join(" · "),
      }));
  });

  async function handlePick(item) {
    setBusy(true);
    setError("");
    try {
      const response = await api.post(`/api/proposals/${item.id}/brochures`, {
        assetPublicId: asset.publicId,
      });
      setAdded({
        id: item.id,
        label: item.label,
        alreadyAdded: Boolean(response.data?.alreadyAdded),
      });
    } catch (requestError) {
      setError(
        getApiErrorMessage(requestError, "No fue posible agregar el material a la propuesta"),
      );
    } finally {
      setBusy(false);
    }
  }

  if (added) {
    return (
      <DialogShell title="Usar en propuesta" onClose={onClose}>
        <p className="form-success" role="status">
          {added.alreadyAdded
            ? `«${asset.title}» ya estaba en los folletos de «${added.label}».`
            : `«${asset.title}» se agregó a los folletos de «${added.label}».`}
        </p>
        <div className="sl-inline-actions">
          <Link className="btn-primary sl-link-button" to={`/proposals?proposalId=${added.id}`}>
            Abrir propuesta
          </Link>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Seguir en la biblioteca
          </button>
        </div>
      </DialogShell>
    );
  }

  return (
    <DialogShell
      title="Usar en propuesta"
      intro={`Elige la propuesta abierta donde agregar «${asset.title}» como folleto.`}
      onClose={onClose}
    >
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {busy ? <p className="sl-busy">Agregando material...</p> : null}
      <TargetPicker
        label="Buscar propuesta"
        loadItems={loadProposals}
        onPick={handlePick}
        emptyMessage="No hay propuestas abiertas que coincidan."
      />
    </DialogShell>
  );
}

// Mantiene la misma función entre renders para no repetir la carga.
function useStableLoader(loader) {
  const [stable] = useState(() => loader);
  return stable;
}
