import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api, getApiErrorMessage } from "./api";
import CatalogsView from "./commercial-enablement/CatalogsView";
import MyMaterialsView from "./commercial-enablement/MyMaterialsView";
import SearchView from "./commercial-enablement/SearchView";
import UploadModal from "./commercial-enablement/UploadModal";
import { API_BASE, getLibraryCapabilities } from "./commercial-enablement/libraryModel";
import "./commercial-enablement.css";

const NO_PERMISSIONS = {
  canUse: false,
  canUpload: false,
  canManage: false,
  canAdmin: false,
};

export default function CommercialEnablementPage({ currentUser }) {
  const capabilities = getLibraryCapabilities(currentUser?.permissions);
  const [bootstrap, setBootstrap] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [activeTab, setActiveTab] = useState("search");
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .get(`${API_BASE}/bootstrap`)
      .then((response) => {
        if (!cancelled) setBootstrap(response.data);
      })
      .catch((requestError) => {
        if (!cancelled) {
          setLoadError(
            getApiErrorMessage(requestError, "No fue posible cargar la biblioteca"),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const notify = useCallback((message, tone = "success") => {
    setToast({ message, tone });
  }, []);

  const bumpRefresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  const handleCatalogsChanged = useCallback((response) => {
    setBootstrap((current) => ({
      ...current,
      catalogs: response.catalogs,
      adminCatalogs: response.adminCatalogs || response.catalogs,
    }));
  }, []);

  if (loadError) {
    return (
      <div className="sl-page">
        <p className="form-error" role="alert">
          {loadError}
        </p>
      </div>
    );
  }
  if (!bootstrap) {
    return (
      <div className="sl-page">
        <p className="sl-muted">Cargando biblioteca de ventas...</p>
      </div>
    );
  }

  const permissions = bootstrap.permissions || NO_PERMISSIONS;
  const tabs = [
    { id: "search", label: "Buscar" },
    ...(permissions.canUpload ? [{ id: "mine", label: "Mis materiales" }] : []),
    ...(permissions.canAdmin ? [{ id: "catalogs", label: "Catálogos" }] : []),
  ];
  const currentTab = tabs.some((tab) => tab.id === activeTab)
    ? activeTab
    : "search";

  return (
    <div className="sl-page">
      <header className="sl-header">
        <div>
          <h1>Biblioteca de ventas</h1>
          <p className="sl-muted">
            Encuentra el material correcto, previsualízalo y compártelo en pocos
            clics.
          </p>
        </div>
        {permissions.canUpload ? (
          <button
            type="button"
            className="btn-primary sl-upload-button"
            onClick={() => setModal({ mode: "create" })}
          >
            <Plus size={16} aria-hidden="true" /> Subir
          </button>
        ) : null}
      </header>

      {tabs.length > 1 ? (
        <div className="sl-tabs" role="tablist" aria-label="Secciones">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={currentTab === tab.id}
              className={`sl-tab ${currentTab === tab.id ? "is-active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      ) : null}

      {toast ? (
        <div
          className={`sl-toast ${toast.tone === "error" ? "form-error" : "form-success"}`}
          role={toast.tone === "error" ? "alert" : "status"}
        >
          <span>{toast.message}</span>
          <button type="button" className="btn-tertiary" onClick={() => setToast(null)}>
            Cerrar
          </button>
        </div>
      ) : null}

      {currentTab === "search" ? (
        <SearchView
          catalogs={bootstrap.catalogs}
          refreshKey={refreshKey}
          notify={notify}
          onEdit={(asset) => setModal({ mode: "edit", asset })}
          capabilities={capabilities}
        />
      ) : null}
      {currentTab === "mine" ? (
        <MyMaterialsView
          canManage={permissions.canManage}
          refreshKey={refreshKey}
          notify={notify}
          onEdit={(asset) => setModal({ mode: "edit", asset })}
        />
      ) : null}
      {currentTab === "catalogs" ? (
        <CatalogsView
          adminCatalogs={bootstrap.adminCatalogs}
          onCatalogsChanged={handleCatalogsChanged}
          notify={notify}
        />
      ) : null}

      {modal ? (
        <UploadModal
          mode={modal.mode}
          asset={modal.asset}
          catalogs={bootstrap.catalogs || {}}
          notify={notify}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            bumpRefresh();
          }}
        />
      ) : null}
    </div>
  );
}
