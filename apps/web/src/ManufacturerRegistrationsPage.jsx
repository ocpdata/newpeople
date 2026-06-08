import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, getApiErrorMessage } from "./api";
import ManufacturerRegistrationActionModal, {
  buildManufacturerRegistrationActionInitialState,
} from "./manufacturer-registrations/ManufacturerRegistrationActionModal";
import ManufacturerRegistrationDetailModal from "./manufacturer-registrations/ManufacturerRegistrationDetailModal";
import {
  formatManufacturerRegistrationDate,
  getManufacturerRegistrationAlertClass,
  getManufacturerRegistrationAlertLabel,
  getManufacturerRegistrationExpirationLabel,
  getManufacturerRegistrationStatusClass,
  getManufacturerRegistrationStatusLabel,
} from "./manufacturer-registrations/presentation";
import "./manufacturer-registrations/manufacturer-registrations.css";

function buildActionPayload(mode, formState) {
  switch (mode) {
    case "approve":
      return {
        registrationFolio: formState.registrationFolio,
        approvedAt: formState.approvedAt || undefined,
        expiresAt: formState.expiresAt,
        notes: formState.notes || null,
      };
    case "reject":
      return { rejectionNotes: formState.rejectionNotes || null };
    case "renew":
      return {
        registrationFolio: formState.registrationFolio,
        expiresAt: formState.expiresAt,
        notes: formState.notes || null,
      };
    case "reopen":
      return { notes: formState.notes || null };
    default:
      return {};
  }
}

export default function ManufacturerRegistrationsPage({ can }) {
  const navigate = useNavigate();
  const canManage = can("registros_fabricantes.manage");
  const [items, setItems] = useState([]);
  const [providers, setProviders] = useState([]);
  const [summary, setSummary] = useState({
    sinAprobar: 0,
    aprobado: 0,
    renovado: 0,
    vencido: 0,
    rechazado: 0,
    criticalAlerts: 0,
  });
  const [alerts, setAlerts] = useState({
    total: 0,
    info: 0,
    warning: 0,
    critical: 0,
    expired: 0,
  });
  const [filters, setFilters] = useState({
    q: "",
    displayStatus: "",
    alertLevel: "",
    providerId: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [modalMode, setModalMode] = useState("");
  const [selectedItem, setSelectedItem] = useState(null);
  const [formState, setFormState] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [openRegistrationMenuId, setOpenRegistrationMenuId] = useState(null);

  async function loadProviders() {
    const { data } = await api.get(
      "/api/catalogs/manufacturer-registration-providers",
    );
    setProviders(Array.isArray(data) ? data : []);
  }

  async function loadAlerts() {
    const { data } = await api.get("/api/manufacturer-registrations/alerts");
    setAlerts(
      data || { total: 0, info: 0, warning: 0, critical: 0, expired: 0 },
    );
  }

  async function loadItems() {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (filters.q) query.set("q", filters.q);
      if (filters.displayStatus)
        query.set("displayStatus", filters.displayStatus);
      if (filters.alertLevel) query.set("alertLevel", filters.alertLevel);
      if (filters.providerId) query.set("providerId", filters.providerId);

      const { data } = await api.get(
        `/api/manufacturer-registrations?${query.toString()}`,
      );
      setItems(Array.isArray(data?.items) ? data.items : []);
      setSummary(
        data?.summary || {
          sinAprobar: 0,
          aprobado: 0,
          renovado: 0,
          vencido: 0,
          rechazado: 0,
          criticalAlerts: 0,
        },
      );
      setError("");
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar los registros de fabricantes",
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadProviders();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAlerts();
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadItems();
  }, [filters]);

  function openAction(mode, item) {
    setModalMode(mode);
    setSelectedItem(item);
    setFormState(buildManufacturerRegistrationActionInitialState(mode, item));
  }

  function closeActionModal() {
    if (submitting) return;
    setModalMode("");
    setSelectedItem(null);
    setFormState({});
  }

  function toggleRegistrationMenu(id) {
    setOpenRegistrationMenuId((current) => (current === id ? null : id));
  }

  function runRegistrationAction(callback) {
    setOpenRegistrationMenuId(null);
    callback();
  }

  async function handleActionSubmit(event) {
    event.preventDefault();
    if (!selectedItem) return;
    setSubmitting(true);
    try {
      await api.post(
        `/api/opportunities/${selectedItem.opportunityId}/manufacturer-registrations/${selectedItem.id}/${modalMode}`,
        buildActionPayload(modalMode, formState),
      );
      closeActionModal();
      await loadItems();
      await loadAlerts();
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible ejecutar la accion del registro",
        ),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function openDetail(item) {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailError("");
    setDetail(null);
    try {
      const { data } = await api.get(
        `/api/opportunities/${item.opportunityId}/manufacturer-registrations/${item.id}`,
      );
      setDetail(data || null);
    } catch (requestError) {
      setDetailError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar el detalle del registro",
        ),
      );
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <section className="panel manufacturer-registration-page">
      <div className="manufacturer-registration-page-header">
        <div>
          <h2>Registros de fabricantes</h2>
          <p className="field-hint">
            Supervisa solicitudes pendientes, vigencias y renovaciones de
            oportunidades comercialmente abiertas.
          </p>
        </div>
        <div className="manufacturer-registration-summary-row">
          <span className="record-id-badge">
            Sin aprobar: {summary.sinAprobar}
          </span>
          <span className="record-id-badge">Criticas: {alerts.critical}</span>
          <span className="record-id-badge">Vencidos: {alerts.expired}</span>
        </div>
      </div>

      <section className="account-form-section manufacturer-registration-filter-panel">
        <div className="grid-form account-grid-main manufacturer-registration-filter-grid">
          <div className="field-group">
            <label>Buscar</label>
            <input
              placeholder="Cuenta, oportunidad, fabricante o folio"
              value={filters.q}
              onChange={(event) =>
                setFilters((current) => ({ ...current, q: event.target.value }))
              }
            />
          </div>
          <div className="field-group">
            <label>Estado</label>
            <select
              value={filters.displayStatus}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  displayStatus: event.target.value,
                }))
              }
            >
              <option value="">Todos</option>
              <option value="sin_aprobar">Sin aprobar</option>
              <option value="aprobado">Aprobado</option>
              <option value="renovado">Renovado</option>
              <option value="vencido">Vencido</option>
              <option value="rechazado">Rechazado</option>
            </select>
          </div>
          <div className="field-group">
            <label>Alerta</label>
            <select
              value={filters.alertLevel}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  alertLevel: event.target.value,
                }))
              }
            >
              <option value="">Todas</option>
              <option value="info">Preventiva</option>
              <option value="warning">Proxima</option>
              <option value="critical">Critica</option>
              <option value="expired">Vencido</option>
            </select>
          </div>
          <div className="field-group">
            <label>Fabricante</label>
            <select
              value={filters.providerId}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  providerId: event.target.value,
                }))
              }
            >
              <option value="">Todos</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {error ? <div className="opportunity-modal-error">{error}</div> : null}
      {loading ? <p className="field-hint">Cargando registros...</p> : null}

      {!loading && !items.length ? (
        <div className="manufacturer-registration-empty">
          No hay registros que coincidan con los filtros actuales.
        </div>
      ) : null}

      {!loading && items.length ? (
        <div className="manufacturer-registration-table-wrap">
          <table className="manufacturer-registration-table">
            <thead>
              <tr>
                <th>Cuenta</th>
                <th>Oportunidad</th>
                <th>Fabricante</th>
                <th>Folio</th>
                <th>Estado</th>
                <th>Vigencia</th>
                <th>Alerta</th>
                <th>Vendedor</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.accountName}</td>
                  <td>{item.opportunityName}</td>
                  <td>{item.providerName}</td>
                  <td>{item.registrationFolio || "-"}</td>
                  <td>
                    <span
                      className={`manufacturer-registration-badge ${getManufacturerRegistrationStatusClass(item.displayStatus)}`}
                    >
                      {getManufacturerRegistrationStatusLabel(
                        item.displayStatus,
                      )}
                    </span>
                  </td>
                  <td>
                    <div>
                      {formatManufacturerRegistrationDate(item.expiresAt)}
                    </div>
                    <small>
                      {getManufacturerRegistrationExpirationLabel(item)}
                    </small>
                  </td>
                  <td>
                    <span
                      className={`manufacturer-registration-badge ${getManufacturerRegistrationAlertClass(item.alertLevel)}`}
                    >
                      {getManufacturerRegistrationAlertLabel(item.alertLevel)}
                    </span>
                  </td>
                  <td>{item.sellerUserName || "-"}</td>
                  <td className="accounts-actions-cell">
                    <div className="user-kebab-wrap">
                      <button
                        type="button"
                        className="kebab-btn"
                        onClick={() => toggleRegistrationMenu(item.id)}
                        aria-label={`Abrir acciones de ${item.providerName || "registro"}`}
                      >
                        ⋮
                      </button>
                      {openRegistrationMenuId === item.id ? (
                        <div className="user-kebab-menu">
                          <button
                            type="button"
                            onClick={() => runRegistrationAction(() => openDetail(item))}
                          >
                            Ver
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              runRegistrationAction(() =>
                                navigate(`/opportunities?edit=${item.opportunityId}`),
                              )
                            }
                          >
                            Abrir oportunidad
                          </button>
                          {canManage && item.displayStatus === "sin_aprobar" ? (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  runRegistrationAction(() =>
                                    openAction("approve", item),
                                  )
                                }
                              >
                                Aprobar
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  runRegistrationAction(() =>
                                    openAction("reject", item),
                                  )
                                }
                              >
                                Rechazar
                              </button>
                            </>
                          ) : null}
                          {canManage &&
                          (item.displayStatus === "aprobado" ||
                            item.displayStatus === "renovado" ||
                            item.displayStatus === "vencido") ? (
                            <button
                              type="button"
                              onClick={() =>
                                runRegistrationAction(() =>
                                  openAction("renew", item),
                                )
                              }
                            >
                              Renovar
                            </button>
                          ) : null}
                          {canManage && item.displayStatus === "rechazado" ? (
                            <button
                              type="button"
                              onClick={() =>
                                runRegistrationAction(() =>
                                  openAction("reopen", item),
                                )
                              }
                            >
                              Reabrir
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <ManufacturerRegistrationActionModal
        isOpen={Boolean(modalMode)}
        mode={modalMode}
        item={selectedItem}
        providers={providers}
        formState={formState}
        setFormState={setFormState}
        onClose={closeActionModal}
        onSubmit={handleActionSubmit}
        submitting={submitting}
      />

      <ManufacturerRegistrationDetailModal
        isOpen={detailOpen}
        detail={detail}
        loading={detailLoading}
        error={detailError}
        onClose={() => setDetailOpen(false)}
      />
    </section>
  );
}
