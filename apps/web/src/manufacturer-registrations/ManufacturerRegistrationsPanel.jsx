import { useEffect, useState } from "react";
import { api, getApiErrorMessage } from "../api";
import ManufacturerRegistrationActionModal, {
  buildManufacturerRegistrationActionInitialState,
} from "./ManufacturerRegistrationActionModal";
import ManufacturerRegistrationDetailModal from "./ManufacturerRegistrationDetailModal";
import {
  formatManufacturerRegistrationDate,
  getManufacturerRegistrationAlertClass,
  getManufacturerRegistrationAlertLabel,
  getManufacturerRegistrationExpirationLabel,
  getManufacturerRegistrationStatusClass,
  getManufacturerRegistrationStatusLabel,
} from "./presentation";
import "./manufacturer-registrations.css";

function buildStatusSummary(items) {
  return items.reduce(
    (accumulator, item) => {
      accumulator.total += 1;
      if (item.displayStatus === "sin_aprobar") accumulator.sinAprobar += 1;
      if (item.displayStatus === "aprobado") accumulator.aprobado += 1;
      if (item.displayStatus === "renovado") accumulator.renovado += 1;
      if (item.displayStatus === "vencido") accumulator.vencido += 1;
      return accumulator;
    },
    { total: 0, sinAprobar: 0, aprobado: 0, renovado: 0, vencido: 0 },
  );
}

function buildActionPayload(mode, formState) {
  switch (mode) {
    case "create":
    case "edit":
      return {
        providerId: Number(formState.providerId),
        requestedAt: formState.requestedAt,
        notes: formState.notes || null,
      };
    case "approve":
      return {
        registrationFolio: formState.registrationFolio,
        approvedAt: formState.approvedAt || undefined,
        expiresAt: formState.expiresAt,
        notes: formState.notes || null,
      };
    case "reject":
      return {
        rejectionNotes: formState.rejectionNotes || null,
      };
    case "renew":
      return {
        registrationFolio: formState.registrationFolio,
        expiresAt: formState.expiresAt,
        notes: formState.notes || null,
      };
    case "reopen":
      return {
        notes: formState.notes || null,
      };
    default:
      return {};
  }
}

export default function ManufacturerRegistrationsPanel({
  opportunityId,
  canRequest = false,
  canUpdate = false,
  isOpportunityClosed = false,
}) {
  const [items, setItems] = useState([]);
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [modalMode, setModalMode] = useState("");
  const [selectedItem, setSelectedItem] = useState(null);
  const [formState, setFormState] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detail, setDetail] = useState(null);

  async function loadProviders() {
    const { data } = await api.get(
      "/api/catalogs/manufacturer-registration-providers",
    );
    setProviders(Array.isArray(data) ? data : []);
  }

  async function loadItems() {
    if (!opportunityId) {
      setItems([]);
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.get(
        `/api/opportunities/${opportunityId}/manufacturer-registrations`,
      );
      setItems(Array.isArray(data) ? data : []);
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
    if (!opportunityId) {
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadItems();
    if (!isOpportunityClosed && (canRequest || canUpdate)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadProviders();
    }
  }, [opportunityId, isOpportunityClosed, canRequest, canUpdate]);

  function openAction(mode, item = null) {
    setModalMode(mode);
    setSelectedItem(item);
    setFormState(buildManufacturerRegistrationActionInitialState(mode, item));
    setError("");
    setSuccess("");
  }

  function closeActionModal({ force = false } = {}) {
    if (submitting && !force) {
      return;
    }
    setModalMode("");
    setSelectedItem(null);
    setFormState({});
  }

  async function handleActionSubmit(event) {
    event?.preventDefault?.();
    const payload = buildActionPayload(modalMode, formState);
    setSubmitting(true);
    setError("");
    setSuccess("");

    try {
      if (modalMode === "create") {
        await api.post(
          `/api/opportunities/${opportunityId}/manufacturer-registrations`,
          payload,
        );
      } else if (modalMode === "edit") {
        await api.put(
          `/api/opportunities/${opportunityId}/manufacturer-registrations/${selectedItem.id}`,
          payload,
        );
      } else {
        await api.post(
          `/api/opportunities/${opportunityId}/manufacturer-registrations/${selectedItem.id}/${modalMode}`,
          payload,
        );
      }

      await loadItems();
      setSuccess(
        modalMode === "create"
          ? "Solicitud registrada correctamente"
          : "Registro actualizado correctamente",
      );
      closeActionModal({ force: true });
    } catch (requestError) {
      const errorMessage = getApiErrorMessage(
        requestError,
        modalMode === "create"
          ? "No fue posible solicitar el registro"
          : "No fue posible actualizar el registro",
      );
      console.error("Manufacturer registration request failed", {
        mode: modalMode,
        opportunityId,
        payload,
        status: requestError?.response?.status || null,
        data: requestError?.response?.data || null,
      });
      setError(errorMessage);
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
        `/api/opportunities/${opportunityId}/manufacturer-registrations/${item.id}`,
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

  const summary = buildStatusSummary(items);

  return (
    <section className="account-form-section manufacturer-registration-section">
      <div className="manufacturer-registration-toolbar">
        <div>
          <h4>Registros de fabricantes</h4>
          <p className="field-hint">
            {isOpportunityClosed
              ? "No disponible cuando la oportunidad esta ganada, perdida o anulada."
              : "Solicita y consulta registros de fabricante vinculados a esta oportunidad."}
          </p>
        </div>
        {canRequest && !isOpportunityClosed ? (
          <button
            type="button"
            className="btn-primary"
            onClick={() => openAction("create")}
          >
            + Solicitar registro de fabricante
          </button>
        ) : null}
      </div>

      {!isOpportunityClosed ? (
        <div className="manufacturer-registration-summary-row">
          <span className="record-id-badge">
            Sin aprobar: {summary.sinAprobar}
          </span>
          <span className="record-id-badge">Aprobados: {summary.aprobado}</span>
          <span className="record-id-badge">Renovados: {summary.renovado}</span>
          <span className="record-id-badge">Vencidos: {summary.vencido}</span>
        </div>
      ) : null}

      {error ? <div className="opportunity-modal-error">{error}</div> : null}
      {success ? (
        <p className="field-hint manufacturer-registration-success">
          {success}
        </p>
      ) : null}
      {loading ? <p className="field-hint">Cargando registros...</p> : null}

      {!loading && !items.length ? (
        <div className="manufacturer-registration-empty">
          {isOpportunityClosed
            ? "Los registros de fabricantes solo se muestran mientras la oportunidad permanece abierta."
            : "Esta oportunidad aún no tiene solicitudes de registro de fabricante."}
        </div>
      ) : null}

      {!loading && items.length ? (
        <div className="manufacturer-registration-table-wrap">
          <table className="manufacturer-registration-table">
            <thead>
              <tr>
                <th>Fabricante</th>
                <th>Folio</th>
                <th>Estado</th>
                <th>Vigencia</th>
                <th>Alerta</th>
                <th>Renovaciones</th>
                <th>Actualizado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
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
                  <td>{item.renewalCount}</td>
                  <td>
                    {formatManufacturerRegistrationDate(item.updatedAt, true)}
                  </td>
                  <td>
                    <div className="manufacturer-registration-actions">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => openDetail(item)}
                      >
                        Ver
                      </button>
                      {canUpdate && !isOpportunityClosed ? (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => openAction("edit", item)}
                        >
                          Editar
                        </button>
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
        errorMessage={error}
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
