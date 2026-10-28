import { useState } from "react";
import { api, getApiErrorMessage } from "../api";
import { API_BASE } from "./libraryModel";

const CATALOG_TYPES = [
  { type: "manufacturer", label: "Fabricantes", singular: "fabricante" },
  { type: "technology", label: "Tecnologías", singular: "tecnología" },
  { type: "solution", label: "Soluciones", singular: "solución" },
  { type: "industry", label: "Industrias", singular: "industria" },
  { type: "asset_type", label: "Tipos de material", singular: "tipo" },
];

function CatalogSection({ config, entries, onResponse, notify }) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(task, fallbackMessage) {
    setBusy(true);
    try {
      const response = await task();
      onResponse(response.data);
      return true;
    } catch (requestError) {
      notify(getApiErrorMessage(requestError, fallbackMessage), "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd(event) {
    event.preventDefault();
    const name = newName.trim();
    if (name.length < 2) return;
    const ok = await run(
      () => api.post(`${API_BASE}/catalogs/${config.type}`, { name }),
      `No fue posible crear el ${config.singular}`,
    );
    if (ok) setNewName("");
  }

  async function handleRename(entry) {
    const name = editingName.trim();
    if (name.length < 2) return;
    const ok = await run(
      () =>
        api.put(`${API_BASE}/catalogs/entry/${entry.publicId}`, {
          name,
          code: entry.code,
          description: entry.description || "",
          sortOrder: entry.sortOrder || 0,
          isActive: entry.isActive !== false,
        }),
      `No fue posible renombrar el ${config.singular}`,
    );
    if (ok) setEditingId(null);
  }

  function handleToggle(entry) {
    return run(
      () =>
        api.put(`${API_BASE}/catalogs/entry/${entry.publicId}`, {
          name: entry.name,
          code: entry.code,
          description: entry.description || "",
          sortOrder: entry.sortOrder || 0,
          isActive: entry.isActive === false,
        }),
      "No fue posible cambiar el estado",
    );
  }

  function handleDelete(entry) {
    if (
      !window.confirm(
        `¿Eliminar "${entry.name}" del catálogo? Los materiales dejarán de mostrarlo. Si solo quieres ocultarlo, desactívalo.`,
      )
    ) {
      return undefined;
    }
    return run(
      () => api.delete(`${API_BASE}/catalogs/entry/${entry.publicId}`),
      "No fue posible eliminar la opción",
    );
  }

  return (
    <section className="sl-catalog">
      <h3>{config.label}</h3>
      <ul className="sl-catalog-list">
        {entries.map((entry) => (
          <li key={entry.publicId} className={entry.isActive === false ? "is-inactive" : ""}>
            {editingId === entry.publicId ? (
              <>
                <input
                  type="text"
                  value={editingName}
                  onChange={(event) => setEditingName(event.target.value)}
                  aria-label={`Nuevo nombre de ${entry.name}`}
                />
                <button type="button" className="btn-primary" disabled={busy} onClick={() => handleRename(entry)}>
                  Guardar
                </button>
                <button type="button" className="btn-tertiary" onClick={() => setEditingId(null)}>
                  Cancelar
                </button>
              </>
            ) : (
              <>
                <span>
                  {entry.name}
                  {entry.isActive === false ? " (desactivado)" : ""}
                </span>
                <span className="sl-inline-actions">
                  <button
                    type="button"
                    className="btn-tertiary"
                    disabled={busy}
                    onClick={() => {
                      setEditingId(entry.publicId);
                      setEditingName(entry.name);
                    }}
                  >
                    Renombrar
                  </button>
                  <button type="button" className="btn-tertiary" disabled={busy} onClick={() => handleToggle(entry)}>
                    {entry.isActive === false ? "Activar" : "Desactivar"}
                  </button>
                  <button type="button" className="btn-tertiary sl-danger-text" disabled={busy} onClick={() => handleDelete(entry)}>
                    Eliminar
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
        {!entries.length ? <li className="sl-muted">Sin opciones.</li> : null}
      </ul>
      <form className="sl-catalog-add" onSubmit={handleAdd}>
        <input
          type="text"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          placeholder={`Nuevo ${config.singular}`}
          aria-label={`Nuevo ${config.singular}`}
        />
        <button type="submit" className="btn-secondary" disabled={busy || newName.trim().length < 2}>
          Agregar
        </button>
      </form>
    </section>
  );
}

export default function CatalogsView({ adminCatalogs, onCatalogsChanged, notify }) {
  return (
    <div className="sl-catalogs">
      <p className="sl-muted">
        Administra las opciones que se usan para clasificar y filtrar materiales.
      </p>
      <div className="sl-catalog-grid">
        {CATALOG_TYPES.map((config) => (
          <CatalogSection
            key={config.type}
            config={config}
            entries={adminCatalogs?.[config.type] || []}
            onResponse={onCatalogsChanged}
            notify={notify}
          />
        ))}
      </div>
    </div>
  );
}
