import { useState } from "react";
import { validateVariableRules } from "../../../../shared/variable-compensation.js";
import { api, getApiErrorMessage } from "../api";

const GROUPS = [
  { key: "quota", title: "Cuota", fields: [
    ["floorPct", "Piso de cuota (%)"], ["fullActivationPct", "Activación completa (%)"], ["targetPct", "Meta de cuota (%)"],
    ["basePay", "Pago base por cuota"], ["floorPayPct", "Pago en el piso (% del pago base)"],
    ["acceleratorPctPerPoint", "Acelerador: % del pago base por punto sobre la meta"],
    ["acceleratorMaxMultiplier", "Multiplicador máximo del acelerador"], ["acceleratorMinMarginPct", "Margen mínimo para el acelerador (%)"],
  ] },
  { key: "margin", title: "Margen", fields: [
    ["fullPct", "Margen para pago completo (%)"], ["partialPct", "Margen para pago parcial (%)"],
    ["fullPay", "Pago completo"], ["partialPay", "Pago parcial"], ["lowMarginSalePct", "Venta con margen bajo, menor a (%)"],
  ] },
  { key: "team", title: "Equipo en cuota", fields: [["sellerQuotaPct", "Cuota individual para contar al vendedor (%)"]] },
  { key: "newClients", title: "Clientes nuevos", fields: [
    ["minAmountPctOfQuota", "Venta a nuevos (% de la cuota del trimestre)"],
    ["clientMinAmountPctOfQuota", "Venta mínima por cliente (% de la cuota)"],
    ["minClients", "Clientes que deben cumplir el mínimo"], ["lookbackMonths", "Meses sin compra previa para ser nuevo"], ["pay", "Pago"],
  ] },
  { key: "existingAccounts", title: "Cuentas actuales", fields: [["minGrowthPct", "Crecimiento mínimo vs mismo trimestre del año anterior (%)"], ["pay", "Pago"]] },
];

const toNumber = (text) => (text === "" ? "" : Number(text));
const FIELD_LABEL = Object.fromEntries(GROUPS.flatMap((group) => group.fields.map(([field, label]) => [`${group.key}.${field}`, `${group.title} · ${label}`])));
const friendly = (error) => error.replace(/^(\w+\.\w+) /, (_match, path) => `${FIELD_LABEL[path] || path} `);

export default function RulesPanel({ state, canUpdate, onSaved }) {
  const [draft, setDraft] = useState(() => structuredClone(state.rules));
  const [validated, setValidated] = useState(state.validated);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState([]);
  const [message, setMessage] = useState("");

  const setField = (group, field, value) => setDraft((current) => ({ ...current, [group]: { ...current[group], [field]: value } }));
  const setTier = (index, field, value) => setDraft((current) => ({
    ...current, team: { ...current.team, tiers: current.team.tiers.map((tier, position) => (position === index ? { ...tier, [field]: value } : tier)) },
  }));

  async function save(event) {
    event.preventDefault();
    const checked = validateVariableRules(draft);
    if (!checked.ok) { setErrors(checked.errors.map(friendly)); setMessage(""); return; }
    setSaving(true); setErrors([]); setMessage("");
    try {
      await api.put("/api/variable-compensation/rules", { rules: checked.rules, validated, version: state.version });
      setMessage("Reglas guardadas.");
      await onSaved();
    } catch (failure) {
      const serverErrors = failure.response?.data?.errors;
      setErrors(Array.isArray(serverErrors) ? serverErrors.map(friendly) : [getApiErrorMessage(failure, "No fue posible guardar las reglas.")]);
      if (failure.response?.status === 409) await onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="vc-card vc-rules" onSubmit={save} noValidate aria-label="Reglas de pago">
      <h3 className="vc-section-title">Reglas de pago</h3>
      <p className="vc-sub">
        {state.isDefault ? "Reglas iniciales tomadas del diseño del tablero." : `Última edición: ${state.updatedByName || "usuario no disponible"}.`}
        {" "}Los importes de pago están en {draft.payCurrencyCode}. Los montos de clientes nuevos se definen como porcentaje de la cuota para no depender de la moneda de las ventas.
      </p>
      <fieldset disabled={!canUpdate || saving} className="vc-rules-fields">
        <label>Moneda de pago
          <input value={draft.payCurrencyCode} maxLength={3} onChange={(event) => setDraft((current) => ({ ...current, payCurrencyCode: event.target.value.toUpperCase() }))} />
        </label>
        <label>Tope trimestral
          <input type="number" min="0" value={draft.quarterlyCap} onChange={(event) => setDraft((current) => ({ ...current, quarterlyCap: toNumber(event.target.value) }))} />
        </label>
        {GROUPS.map((group) => (
          <div key={group.key} className="vc-rules-group">
            <h4>{group.title}</h4>
            {group.fields.map(([field, label]) => (
              <label key={field}>{label}
                <input type="number" min="0" step="any" value={draft[group.key][field]} onChange={(event) => setField(group.key, field, toNumber(event.target.value))} />
              </label>
            ))}
            {group.key === "team" && (
              <div className="vc-tiers">
                <p>Pago por vendedores en cuota</p>
                {draft.team.tiers.map((tier, index) => (
                  <div key={index} className="vc-tier">
                    <label>Desde (vendedores)
                      <input type="number" min="1" step="1" value={tier.minSellers} onChange={(event) => setTier(index, "minSellers", toNumber(event.target.value))} />
                    </label>
                    <label>Pago
                      <input type="number" min="0" value={tier.pay} onChange={(event) => setTier(index, "pay", toNumber(event.target.value))} />
                    </label>
                    <button type="button" onClick={() => setDraft((current) => ({ ...current, team: { ...current.team, tiers: current.team.tiers.filter((_, position) => position !== index) } }))}>Quitar</button>
                  </div>
                ))}
                <button type="button" onClick={() => setDraft((current) => ({ ...current, team: { ...current.team, tiers: [...current.team.tiers, { minSellers: 1, pay: 0 }] } }))}>Agregar nivel</button>
              </div>
            )}
          </div>
        ))}
        <label className="vc-check">
          <input type="checkbox" checked={validated} onChange={(event) => setValidated(event.target.checked)} />
          Estas reglas fueron validadas contra la carta de compensación
        </label>
      </fieldset>
      {errors.length > 0 && <ul className="vc-errors" role="alert">{errors.map((error) => <li key={error}>{error}</li>)}</ul>}
      {message && <p role="status">{message}</p>}
      {canUpdate
        ? <button type="submit" className="btn-primary" disabled={saving}>{saving ? "Guardando…" : "Guardar reglas"}</button>
        : <p className="vc-sub">Solo consulta: no tienes permiso para editar las reglas.</p>}
    </form>
  );
}
