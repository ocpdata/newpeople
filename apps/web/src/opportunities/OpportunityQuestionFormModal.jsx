export default function OpportunityQuestionFormModal({
  isOpen,
  editingQuestion,
  saving,
  form,
  stages,
  responseTypes,
  onClose,
  onSubmit,
  onChange,
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-dialog modal-dialog-wide"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h3 className="modal-title">
            {editingQuestion ? "Editar pregunta" : "Nueva pregunta"}
          </h3>
        </div>
        <p className="modal-message">
          Los cambios se reflejan en oportunidades cuando vuelvan a consultar el
          catálogo de la etapa.
        </p>
        <form onSubmit={onSubmit}>
          <div className="field-group">
            <label>
              Etapa <span className="required-mark">*</span>
            </label>
            <select
              value={form.salesStageId}
              onChange={(event) => onChange("salesStageId", event.target.value)}
              required
            >
              <option value="">Selecciona etapa</option>
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field-group" style={{ marginTop: 12 }}>
            <label>
              Pregunta <span className="required-mark">*</span>
            </label>
            <textarea
              aria-label="Pregunta"
              rows={4}
              value={form.prompt}
              onChange={(event) => onChange("prompt", event.target.value)}
              required
            />
          </div>

          <div className="grid-form question-admin-modal-grid">
            <div className="field-group">
              <label>
                Tipo de respuesta <span className="required-mark">*</span>
              </label>
              <select
                value={form.responseType}
                onChange={(event) => onChange("responseType", event.target.value)}
                required
              >
                {responseTypes.map((responseType) => (
                  <option key={responseType} value={responseType}>
                    {responseType}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-group">
              <label>
                Orden <span className="required-mark">*</span>
              </label>
              <input
                type="number"
                min="1"
                value={form.displayOrder}
                onChange={(event) => onChange("displayOrder", event.target.value)}
                required
              />
            </div>
            <div className="field-group">
              <label>
                Obligatoria <span className="required-mark">*</span>
              </label>
              <select
                value={form.isRequired ? "1" : "0"}
                onChange={(event) => onChange("isRequired", event.target.value === "1")}
              >
                <option value="1">Sí</option>
                <option value="0">No</option>
              </select>
            </div>
          </div>

          <div className="modal-buttons" style={{ marginTop: 16 }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving
                ? editingQuestion
                  ? "Guardando..."
                  : "Creando..."
                : "Guardar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}