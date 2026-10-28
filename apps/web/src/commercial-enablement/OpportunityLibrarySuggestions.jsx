import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import "../commercial-enablement.css";

// Materiales para cliente sugeridos según el fabricante, la solución, la industria y la etapa.
export default function OpportunityLibrarySuggestions({
  opportunityId,
  canAttach,
  onAttach,
}) {
  const [result, setResult] = useState({ key: null, items: [] });

  useEffect(() => {
    if (!opportunityId) return undefined;
    let cancelled = false;
    api
      .get(
        `/api/execution-commercial/opportunities/${opportunityId}/library-suggestions`,
      )
      .then((response) => {
        if (!cancelled) {
          setResult({ key: opportunityId, items: response.data?.items || [] });
        }
      })
      .catch(() => {
        // Es una ayuda opcional; si falla, el bloque simplemente no aparece.
        if (!cancelled) setResult({ key: opportunityId, items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [opportunityId]);

  const items = result.key === opportunityId ? result.items : [];
  if (!items.length) return null;

  return (
    <div className="sl-suggested" aria-label="Material sugerido">
      <h6>Material sugerido</h6>
      <ul>
        {items.map((item) => (
          <li key={item.publicId}>
            <div>
              <strong>{item.title}</strong>
              <span>
                {item.assetTypeLabel}
                {item.reasons.length ? ` · ${item.reasons.join(", ")}` : ""}
              </span>
            </div>
            <div className="sl-suggested-actions">
              <button
                type="button"
                className="btn-secondary"
                disabled={!canAttach}
                onClick={() => onAttach(item.publicId)}
              >
                Adjuntar a correo
              </button>
              <Link
                to={`/commercial-enablement?material=${encodeURIComponent(item.publicId)}`}
              >
                Ver
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
