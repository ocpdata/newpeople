import { toDateInputValue } from "./presentation";

function getModalTitle(mode) {
  switch (mode) {
    case "create":
      return "Solicitar registro de fabricante";
    case "edit":
      return "Editar registro";
    case "approve":
      return "Aprobar registro";
    case "reject":
      return "Rechazar registro";
    case "renew":
      return "Renovar registro";
    case "reopen":
      return "Reabrir registro";
    default:
      return "Solicitud de registro de fabricante";
  }
}

function getSubmitLabel(mode, submitting) {
  if (submitting) {
    return "Guardando...";
  }
  switch (mode) {
    case "create":
      return "Enviar solicitud";
    case "edit":
      return "Guardar cambios";
    case "approve":
      return "Aprobar";
    case "reject":
      return "Confirmar rechazo";
    case "renew":
      return "Renovar";
    case "reopen":
      return "Reabrir";
    default:
      return "Guardar";
  }
}

export function buildManufacturerRegistrationActionInitialState(mode, item) {
  const today = new Date().toISOString().slice(0, 10);
  switch (mode) {
    case "create":
      return {
        providerId: "",
        requestedAt: today,
        notes: "",
      };
    case "edit":
      return {
        providerId: String(item?.providerId || ""),
        requestedAt: toDateInputValue(item?.requestedAt) || today,
        notes: String(item?.notes || ""),
      };
    case "approve":
      return {
        registrationFolio: String(item?.registrationFolio || ""),
        approvedAt: today,
        expiresAt: toDateInputValue(item?.expiresAt),
        notes: String(item?.notes || ""),
      };
    case "reject":
      return {
        rejectionNotes: String(item?.rejectionNotes || ""),
      };
    case "renew":
      return {
        registrationFolio: String(item?.registrationFolio || ""),
        expiresAt: "",
        notes: String(item?.notes || ""),
      };
    case "reopen":
      return {
        notes: String(item?.notes || ""),
      };
    default:
      return {};
  }
}

function ProviderFields({ formState, setFormState, providers }) {
  return (
    <>
      <div className="field-group">
        <label>
          Fabricante <span className="required-mark">*</span>
        </label>
        <select
          value={formState.providerId}
          onChange={(event) =>
            setFormState((current) => ({
              ...current,
              providerId: event.target.value,
            }))
          }
          required
        >
          <option value="">Selecciona fabricante</option>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field-group">
        <label>
          Fecha de solicitud <span className="required-mark">*</span>
        </label>
        <input
          type="date"
          value={formState.requestedAt}
          onChange={(event) =>
            setFormState((current) => ({
              ...current,
              requestedAt: event.target.value,
            }))
          }
          required
        />
      </div>
      <div className="field-group manufacturer-registration-modal-notes">
        <label>Observaciones</label>
        <textarea
          rows={4}
          value={formState.notes}
          onChange={(event) =>
            setFormState((current) => ({
              ...current,
              notes: event.target.value,
            }))
          }
        />
      </div>
    </>
  );
}

export default function ManufacturerRegistrationActionModal({
  isOpen,
  mode,
  item,
  providers = [],
  formState,
  setFormState,
  errorMessage = "",
  onClose,
  onSubmit,
  submitting = false,
}) {
  if (!isOpen || !mode) {
    return null;
  }

  return (
    <div className="modal-overlay modal-overlay-elevated" onClick={onClose}>
      <div
        className="modal-dialog modal-dialog-account manufacturer-registration-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div className="opportunity-modal-header-copy">
            <h3 className="modal-title">{getModalTitle(mode)}</h3>
            <p className="field-hint opportunity-modal-subtitle">
              {item?.providerName
                ? `Fabricante: ${item.providerName}`
                : mode === "create"
                  ? "La solicitud quedara pendiente de aprobacion en el modulo global."
                  : ""}
            </p>
          </div>
          <button
            type="button"
            className="opportunity-documents-apply-icon-button"
            onClick={onClose}
            aria-label="Cerrar"
            title="Cerrar"
          >
            ×
          </button>
        </div>

        <div className="account-create-form in-modal">
          {errorMessage ? (
            <div className="opportunity-modal-error" role="alert">
              {errorMessage}
            </div>
          ) : null}

          <section className="account-form-section manufacturer-registration-modal-section">
            <div className="grid-form account-grid-main manufacturer-registration-modal-grid">
              {mode === "create" || mode === "edit" ? (
                <ProviderFields
                  formState={formState}
                  setFormState={setFormState}
                  providers={providers}
                />
              ) : null}

              {mode === "approve" ? (
                <>
                  <div className="field-group">
                    <label>
                      Folio <span className="required-mark">*</span>
                    </label>
                    <input
                      value={formState.registrationFolio}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          registrationFolio: event.target.value,
                        }))
                      }
                      required
                    />
                  </div>
                  <div className="field-group">
                    <label>Fecha de aprobacion</label>
                    <input
                      type="date"
                      value={formState.approvedAt}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          approvedAt: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="field-group">
                    <label>
                      Fecha de vencimiento{" "}
                      <span className="required-mark">*</span>
                    </label>
                    <input
                      type="date"
                      value={formState.expiresAt}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          expiresAt: event.target.value,
                        }))
                      }
                      required
                    />
                  </div>
                  <div className="field-group manufacturer-registration-modal-notes">
                    <label>Observaciones</label>
                    <textarea
                      rows={4}
                      value={formState.notes}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          notes: event.target.value,
                        }))
                      }
                    />
                  </div>
                </>
              ) : null}

              {mode === "reject" ? (
                <div className="field-group manufacturer-registration-modal-notes">
                  <label>Comentario de rechazo</label>
                  <textarea
                    rows={4}
                    value={formState.rejectionNotes}
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        rejectionNotes: event.target.value,
                      }))
                    }
                  />
                </div>
              ) : null}

              {mode === "renew" ? (
                <>
                  <div className="field-group">
                    <label>
                      Folio vigente <span className="required-mark">*</span>
                    </label>
                    <input
                      value={formState.registrationFolio}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          registrationFolio: event.target.value,
                        }))
                      }
                      required
                    />
                  </div>
                  <div className="field-group">
                    <label>
                      Nueva fecha de vencimiento{" "}
                      <span className="required-mark">*</span>
                    </label>
                    <input
                      type="date"
                      value={formState.expiresAt}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          expiresAt: event.target.value,
                        }))
                      }
                      required
                    />
                  </div>
                  <div className="field-group manufacturer-registration-modal-notes">
                    <label>Observaciones</label>
                    <textarea
                      rows={4}
                      value={formState.notes}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          notes: event.target.value,
                        }))
                      }
                    />
                  </div>
                </>
              ) : null}

              {mode === "reopen" ? (
                <div className="field-group manufacturer-registration-modal-notes">
                  <label>Observaciones</label>
                  <textarea
                    rows={4}
                    value={formState.notes}
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        notes: event.target.value,
                      }))
                    }
                  />
                </div>
              ) : null}
            </div>
          </section>

          <div className="modal-buttons">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={submitting}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={onSubmit}
              disabled={submitting}
            >
              {getSubmitLabel(mode, submitting)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
