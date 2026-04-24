export default function RoleFormModal({
  isOpen,
  editingRole,
  roleForm,
  creatingRole,
  onClose,
  onSubmit,
  onFieldChange,
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(event) => event.stopPropagation()}>
        <h3 className="modal-title">
          {editingRole ? "Editar rol" : "Crear rol"}
        </h3>
        <form onSubmit={onSubmit}>
          <div className="field-group">
            <label>Nombre de rol</label>
            <input
              value={roleForm.name}
              onChange={(event) => onFieldChange("name", event.target.value)}
              placeholder="Nombre de rol"
              autoFocus
              required
            />
          </div>
          <div className="field-group" style={{ marginTop: 12 }}>
            <label>Descripcion</label>
            <textarea
              value={roleForm.description}
              onChange={(event) =>
                onFieldChange("description", event.target.value)
              }
              placeholder="Describe el objetivo o alcance del rol"
              maxLength={255}
              rows={4}
            />
          </div>
          <div className="modal-buttons" style={{ marginTop: 16 }}>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={creatingRole}>
              {creatingRole
                ? editingRole
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