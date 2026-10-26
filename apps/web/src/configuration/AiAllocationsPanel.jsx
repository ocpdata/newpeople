import { useCallback, useEffect, useMemo, useState } from "react";
import { api, getApiErrorMessage } from "../api";

const usdFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const STATE_LABELS = {
  normal: "Disponible",
  warning: "Aviso",
  exhausted: "Agotado",
  unlimited: "Sin límite",
};

function formatUsd(value) {
  return value === null || value === undefined ? "—" : usdFormatter.format(Number(value || 0));
}

function roundDown(value) {
  return Math.floor(value * 100) / 100;
}

function percentsFrom(users) {
  return Object.fromEntries(users.map((user) => [user.userId, user.percent === null ? "" : String(user.percent)]));
}

function toNumber(value) {
  if (value === "" || value === null || value === undefined) return 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function fetchAllocations() {
  return api.get("/api/admin/ai/allocations");
}

function UserDetail({ user }) {
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState("");

  async function loadHistory() {
    try {
      const { data } = await api.get(`/api/admin/ai/wallets/${user.userId}`);
      setHistory(Array.isArray(data?.recentTransactions) ? data.recentTransactions : []);
    } catch (requestError) {
      setHistoryError(getApiErrorMessage(requestError, "No fue posible cargar el historial"));
    }
  }

  return (
    <div className="ai-allocations-detail">
      <div>
        <h6>Consumo por módulo</h6>
        {user.byModule.length ? (
          <ul>
            {user.byModule.map((module) => (
              <li key={module.module}>
                <span>{module.label}</span>
                <strong>{formatUsd(module.costUsd)}</strong>
                <small>{module.calls} llamadas</small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="field-hint">Sin consumo en el periodo.</p>
        )}
      </div>
      <div>
        <h6>Movimientos de la billetera anterior</h6>
        {history === null ? (
          <button type="button" className="ai-services-link" onClick={loadHistory}>
            Ver historial
          </button>
        ) : history.length ? (
          <ul>
            {history.map((movement) => (
              <li key={movement.id}>
                <span>{movement.reasonText || movement.reasonCode}</span>
                <strong>{formatUsd(movement.amountUsd)}</strong>
                <small>{movement.createdAtUtc ? new Date(movement.createdAtUtc).toLocaleDateString("es-MX") : ""}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="field-hint">Sin movimientos registrados.</p>
        )}
        {historyError ? <p className="form-error">{historyError}</p> : null}
      </div>
    </div>
  );
}

export default function AiAllocationsPanel({ canManage }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [percents, setPercents] = useState({});
  const [warningPercent, setWarningPercent] = useState(80);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");

  const apply = useCallback(
    (request) =>
      request
        .then(({ data: next }) => {
          setData(next);
          setPercents(percentsFrom(next.users));
          setWarningPercent(next.plan.warningPercent);
          setError("");
        })
        .catch((requestError) => {
          setError(getApiErrorMessage(requestError, "No fue posible cargar las asignaciones"));
        }),
    [],
  );

  useEffect(() => {
    apply(fetchAllocations());
  }, [apply]);

  const captured = data?.capturedUsd ?? null;
  const totalPercent = useMemo(
    () => Math.round(Object.values(percents).reduce((sum, value) => sum + toNumber(value), 0) * 100) / 100,
    [percents],
  );
  const reservePercent = Math.max(0, Math.round((100 - totalPercent) * 100) / 100);
  const invalid = Object.values(percents).some((value) => toNumber(value) < 0 || toNumber(value) > 100) || totalPercent > 100;
  const dirty = useMemo(() => {
    if (!data) return false;
    const saved = percentsFrom(data.users);
    return (
      warningPercent !== data.plan.warningPercent ||
      data.users.some((user) => toNumber(saved[user.userId]) !== toNumber(percents[user.userId]))
    );
  }, [data, percents, warningPercent]);

  const visibleUsers = useMemo(() => {
    const text = filter.trim().toLowerCase();
    const users = data?.users || [];
    if (!text) return users;
    return users.filter((user) => `${user.fullName} ${user.email} ${user.roles}`.toLowerCase().includes(text));
  }, [data, filter]);

  function splitEqually() {
    const recent = data.users.filter((user) => user.usedAiRecently);
    const targets = recent.length ? recent : data.users;
    const share = targets.length ? roundDown(100 / targets.length) : 0;
    const ids = new Set(targets.map((user) => user.userId));
    setPercents(Object.fromEntries(data.users.map((user) => [user.userId, ids.has(user.userId) ? String(share) : ""])));
  }

  async function save() {
    setSaving(true);
    setSaveError("");
    setNotice("");
    try {
      await api.put("/api/admin/ai/allocations", {
        expectedVersion: data.plan.version,
        warningPercent: Number(warningPercent),
        users: data.users.map((user) => ({
          userId: user.userId,
          percent: percents[user.userId] === "" ? null : toNumber(percents[user.userId]),
        })),
      });
      await apply(fetchAllocations());
      setNotice("Asignaciones guardadas.");
    } catch (requestError) {
      setSaveError(getApiErrorMessage(requestError, "No fue posible guardar las asignaciones"));
    } finally {
      setSaving(false);
    }
  }

  if (error && !data) return <p className="form-error">{error}</p>;
  if (!data) return <p className="field-hint">Cargando asignaciones...</p>;

  const totals = data.totals;

  return (
    <section className="configuration-card ai-allocations">
      <div className="configuration-card-heading">
        <div>
          <h4>Crédito por usuario</h4>
          <p>
            Cada usuario activo recibe un porcentaje del saldo capturado de OpenAI y solo descuenta lo que él gasta.
            Quien no tiene porcentaje usa la reserva compartida.
          </p>
        </div>
      </div>

      {data.limited ? (
        <div className="ai-allocations-summary">
          <div>
            <span>Saldo capturado</span>
            <strong>{formatUsd(captured)}</strong>
            <small>{new Date(data.capturedAt).toLocaleString("es-MX")}</small>
          </div>
          <div>
            <span>Asignado</span>
            <strong className={totalPercent > 100 ? "is-over" : ""}>{totalPercent} %</strong>
            <small>{formatUsd((Math.min(totalPercent, 100) / 100) * captured)}</small>
          </div>
          <div className={`state-${totals?.reserveState || "normal"}`}>
            <span>Reserva compartida</span>
            <strong>{reservePercent} %</strong>
            <small>
              {formatUsd((reservePercent / 100) * captured)} · disponible{" "}
              {formatUsd(Math.max(0, (reservePercent / 100) * captured - Number(totals?.reserveSpentUsd || 0)))}
            </small>
          </div>
        </div>
      ) : (
        <p className="ai-services-caution">
          Sin saldo capturado: no hay límite por usuario y solo se mide el consumo. Captura el saldo de OpenAI en
          Resumen para aplicar estos porcentajes.
        </p>
      )}

      <div className="ai-allocations-bar" aria-label={`Asignado ${totalPercent} %, reserva ${reservePercent} %`}>
        <span className={`ai-allocations-bar-assigned${totalPercent > 100 ? " is-over" : ""}`} style={{ width: `${Math.min(totalPercent, 100)}%` }} />
      </div>
      {totalPercent > 100 ? (
        <p className="form-error">Los porcentajes suman {totalPercent} %; el máximo es 100 %.</p>
      ) : null}

      <div className="ai-services-toolbar">
        <label className="field-group">
          <span>Buscar usuario</span>
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Nombre, correo o rol" />
        </label>
        <div className="ai-allocations-actions">
          <label className="field-group">
            <span>Avisar al (%) de su asignación</span>
            <input
              type="number"
              min="1"
              max="99"
              value={warningPercent}
              disabled={!canManage}
              onChange={(event) => setWarningPercent(Number(event.target.value))}
            />
          </label>
          {canManage ? (
            <button type="button" className="btn-secondary" onClick={splitEqually}>
              Repartir en partes iguales
            </button>
          ) : null}
        </div>
      </div>
      <p className="field-hint">
        Repartir en partes iguales asigna el mismo porcentaje a quienes usaron IA en los últimos 90 días
        ({data.users.filter((user) => user.usedAiRecently).length} usuarios).
      </p>

      <div className="ai-pricing-table-wrap">
        <table className="configuration-table ai-allocations-table">
          <thead>
            <tr>
              <th>Usuario</th>
              <th>%</th>
              <th>Asignado</th>
              <th>Gastado</th>
              <th>Disponible</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {visibleUsers.map((user) => {
              const percent = toNumber(percents[user.userId]);
              const allocated = data.limited && percent > 0 ? (percent / 100) * captured : null;
              const available = allocated === null ? null : allocated - user.spentUsd;
              const isExpanded = expanded === user.userId;
              return [
                <tr key={user.userId}>
                  <td>
                    <button
                      type="button"
                      className="ai-allocations-user"
                      aria-expanded={isExpanded}
                      onClick={() => setExpanded(isExpanded ? null : user.userId)}
                    >
                      <strong>{user.fullName || user.email}</strong>
                      <span>{user.roles || user.email}</span>
                    </button>
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      className="ai-allocations-percent"
                      aria-label={`Porcentaje de ${user.fullName || user.email}`}
                      value={percents[user.userId] ?? ""}
                      placeholder="Reserva"
                      disabled={!canManage}
                      onChange={(event) =>
                        setPercents((current) => ({ ...current, [user.userId]: event.target.value }))
                      }
                    />
                  </td>
                  <td>{allocated === null ? (data.limited ? "Reserva" : "—") : formatUsd(allocated)}</td>
                  <td>{formatUsd(user.spentUsd)}</td>
                  <td>{available === null ? (data.limited && percent <= 0 ? "Compartida" : "—") : formatUsd(Math.max(0, available))}</td>
                  <td>
                    <span className={`ai-allocations-state state-${user.state}`}>{STATE_LABELS[user.state] || user.state}</span>
                  </td>
                </tr>,
                isExpanded ? (
                  <tr key={`${user.userId}-detail`} className="ai-services-overrides-row">
                    <td colSpan="6">
                      <UserDetail user={user} />
                    </td>
                  </tr>
                ) : null,
              ];
            })}
            {!visibleUsers.length ? (
              <tr>
                <td colSpan="6" className="field-hint">No hay usuarios activos con ese filtro.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="field-hint">
        Gastado: {data.limited ? "desde la captura del saldo" : "en el mes actual"}. El estado se recalcula con los
        porcentajes guardados. Solo se muestran usuarios activos.
      </p>

      {dirty || saveError || notice ? (
        <div className="ai-services-savebar">
          <div>
            {saveError ? (
              <p className="form-error">{saveError}</p>
            ) : notice && !dirty ? (
              <p className="ai-services-notice">{notice}</p>
            ) : (
              <p>Tienes cambios sin guardar.</p>
            )}
          </div>
          {dirty ? (
            <div className="ai-services-savebar-actions">
              <button
                type="button"
                className="btn-secondary"
                disabled={saving}
                onClick={() => {
                  setPercents(percentsFrom(data.users));
                  setWarningPercent(data.plan.warningPercent);
                  setSaveError("");
                }}
              >
                Descartar
              </button>
              <button type="button" className="btn-primary" disabled={saving || invalid || !canManage} onClick={save}>
                {saving ? "Guardando..." : "Guardar cambios"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
