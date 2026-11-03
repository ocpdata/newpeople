import { useEffect, useState } from "react";
import { api, getApiErrorMessage } from "../api";

export default function PurchaseOrderValueFields({ order, versionId, canUpdate, onRemoved }) {
  const [amount, setAmount] = useState(order.amount == null ? "" : String(order.amount));
  const [currency, setCurrency] = useState(order.currencyCode || "");
  const [currencies, setCurrencies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    api.get("/api/purchase-order-currencies").then(({ data }) => {
      if (active) setCurrencies(data);
    }).catch((loadError) => {
      if (active) setError(getApiErrorMessage(loadError, "No fue posible cargar las monedas"));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);

  async function save() {
    const value = Number(amount);
    setError("");
    setSuccess("");
    if (amount.trim() === "" || !Number.isFinite(value) || value < 0 || !currency) {
      setError("Ingresa un importe no negativo y selecciona su moneda.");
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.patch(
        `/api/quotation-versions/${versionId}/won-documents/${order.source}/${order.documentId}/value`,
        { amount: value, currencyCode: currency },
      );
      setAmount(String(data.amount));
      setCurrency(data.currencyCode);
      setSuccess("Valor de orden de compra guardado.");
    } catch (saveError) {
      setError(getApiErrorMessage(saveError, "No fue posible guardar el valor de la orden de compra"));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm("¿Quitar la orden de compra del cierre y borrar su valor y moneda? El archivo original se conservará en la cotización u oportunidad.")) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await api.delete(`/api/quotation-versions/${versionId}/won-documents/${order.source}/${order.documentId}`);
      onRemoved();
    } catch (removeError) {
      setError(getApiErrorMessage(removeError, "No fue posible quitar la orden de compra"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="purchase-order-value-fields">
      <div className="purchase-order-value-grid">
      <label>Importe
        <input aria-label="Valor de la orden de compra" type="number" min="0" max="9999999999999.99" step="0.01"
          placeholder="0.00"
          value={amount} disabled={!canUpdate || saving}
          onChange={(event) => { setAmount(event.target.value); setSuccess(""); }} />
      </label>
      <label>Moneda
        <select aria-label="Moneda de la orden de compra" value={currency} disabled={!canUpdate || saving || loading}
          onChange={(event) => { setCurrency(event.target.value); setSuccess(""); }}>
          <option value="">Selecciona moneda</option>
          {currency && !currencies.some((item) => item.code === currency) && <option value={currency}>{currency}</option>}
          {currencies.map((item) => <option key={item.code} value={item.code}>{item.code} - {item.name}</option>)}
        </select>
      </label>
      </div>
      {canUpdate && <div className="purchase-order-value-actions">
        <button type="button" className="btn-primary" aria-label="Guardar valor de orden" disabled={saving || loading}
          onClick={() => void save()}>{saving ? "Procesando..." : "Guardar valor"}</button>
        <button type="button" className="btn-secondary purchase-order-remove-btn"
          aria-label="Quitar orden de compra del cierre" disabled={saving}
          onClick={() => void remove()}>Quitar del cierre</button>
      </div>}
      {loading && <p role="status">Cargando monedas...</p>}
      {error && <div role="alert"><p className="field-hint opportunity-documents-preview-error">{error}</p>
        <button type="button" disabled={saving} onClick={() => {
          setLoading(true);
          setError("");
          setRetry((value) => value + 1);
        }}>Recargar monedas</button>
      </div>}
      {success && <p role="status">{success}</p>}
    </div>
  );
}
