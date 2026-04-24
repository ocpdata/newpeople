export default function ProviderPriceListCreateModal({
  isOpen,
  provider,
  form,
  catalogs,
  saving,
  onClose,
  onSubmit,
  onChange,
}) {
  if (!isOpen || !provider) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-dialog modal-dialog-account provider-price-list-create-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="opportunity-modal-header-copy">
            <h3 className="modal-title">Crear lista de precios</h3>
            <p className="field-hint opportunity-modal-subtitle">
              {provider.name}
            </p>
          </div>
        </div>

        <form
          className="account-create-form in-modal provider-price-list-create-form"
          onSubmit={onSubmit}
        >
          <section className="account-form-section account-modal-section">
            <p className="field-hint provider-price-list-create-note">
              La lista se crea inactiva y usa una sola moneda y un solo tipo.
            </p>
            <div className="provider-price-list-create-grid">
              <div className="field-group provider-price-list-create-name-field">
                <label>
                  Nombre <span className="required-mark">*</span>
                </label>
                <input
                  value={form.name}
                  onChange={(e) => onChange("name", e.target.value)}
                  placeholder="Ej. Lista mayo 2026"
                  required
                />
              </div>
              <div className="field-group">
                <label>
                  Moneda <span className="required-mark">*</span>
                </label>
                <select
                  value={form.currencyId}
                  onChange={(e) => onChange("currencyId", e.target.value)}
                  required
                >
                  <option value="">Selecciona moneda</option>
                  {catalogs.currencies.map((currency) => (
                    <option key={currency.id} value={currency.id}>
                      {currency.code} - {currency.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label>
                  Tipo <span className="required-mark">*</span>
                </label>
                <select
                  value={form.itemType}
                  onChange={(e) => onChange("itemType", e.target.value)}
                  required
                >
                  {catalogs.productTypes.map((productType) => (
                    <option key={productType.id} value={productType.code}>
                      {productType.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <div className="modal-buttons" style={{ marginTop: 16 }}>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Creando..." : "Crear lista"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}