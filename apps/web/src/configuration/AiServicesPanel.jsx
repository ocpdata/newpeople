import { useCallback, useEffect, useMemo, useState } from "react";
import { api, getApiErrorMessage } from "../api";

const usdFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const preciseUsdFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
const numberFormatter = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });

const LEVEL_LABELS = { normal: "Normal", warning: "Aviso", limit: "Límite alcanzado" };

function formatUsd(value) {
  const number = Number(value || 0);
  return number > 0 && number < 0.01 ? preciseUsdFormatter.format(number) : usdFormatter.format(number);
}

function formatAmount(value, unit) {
  if (value === null || value === undefined) return "—";
  if (unit === "usd") return formatUsd(value);
  return numberFormatter.format(Number(value || 0));
}

function unitLabel(unit) {
  if (unit === "credits") return "créditos";
  if (unit === "tokens") return "tokens";
  if (unit === "unidades") return "unidades";
  return "";
}

function formatRelative(iso) {
  if (!iso) return "";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "hace un momento";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return new Date(iso).toLocaleString("es-MX");
}

function cloneSettings(settings) {
  return JSON.parse(JSON.stringify(settings || {}));
}

function settingsPayload(settings) {
  const { version: _version, ...rest } = settings;
  return rest;
}

function UsageBar({ percent, level }) {
  const width = Math.max(0, Math.min(100, Number(percent || 0)));
  return (
    <div className="ai-services-bar" aria-hidden="true">
      <span className={`ai-services-bar-fill level-${level || "normal"}`} style={{ width: `${width}%` }} />
    </div>
  );
}

function MetricRow({ metric }) {
  const hasLimit = metric.limit !== null && metric.limit !== undefined;
  return (
    <div className="ai-services-metric">
      <div className="ai-services-metric-head">
        <span>{metric.label}</span>
        <strong>
          {formatAmount(metric.used, metric.unit)}
          {hasLimit ? ` de ${formatAmount(metric.limit, metric.unit)}` : ""}{" "}
          {metric.unit !== "usd" ? unitLabel(metric.unit) : ""}
          {metric.percent !== null && metric.percent !== undefined ? ` · ${metric.percent}%` : ""}
        </strong>
      </div>
      {hasLimit ? <UsageBar percent={metric.percent} level={metric.level} /> : (
        <p className="field-hint">Sin límite mensual configurado.</p>
      )}
    </div>
  );
}

function BalanceBlock({ balance }) {
  if (!balance) {
    return (
      <div className="ai-services-balance">
        <span>Saldo en el proveedor</span>
        <p className="field-hint">Sin saldo capturado. Captúralo con Editar para ver el saldo estimado.</p>
      </div>
    );
  }
  return (
    <div className={`ai-services-balance level-${balance.level}`}>
      <div className="ai-services-kv">
        <span>Saldo estimado</span>
        <strong>{formatUsd(balance.estimatedUsd)}</strong>
      </div>
      <small className="field-hint">
        Capturado {formatUsd(balance.capturedUsd)} el {new Date(balance.capturedAt).toLocaleString("es-MX")} · consumido
        desde entonces {formatUsd(balance.spentSinceUsd)} (medido por el CRM)
        {balance.warningUsd !== null ? ` · aviso en ${formatUsd(balance.warningUsd)}` : ""}
      </small>
    </div>
  );
}

function ProviderCard({ status, children, footer, onEdit, editing, canManage }) {
  const stateLabel = !status.configured
    ? "Sin clave configurada"
    : status.enabledInServer === false
      ? "Desactivado en el servidor"
      : status.level !== "normal"
        ? LEVEL_LABELS[status.level]
        : "Conectado";
  const stateClass = !status.configured || status.enabledInServer === false
    ? "off"
    : status.level;
  return (
    <article className={`ai-services-card level-${status.level}`} aria-label={`Proveedor ${status.label}`}>
      <header className="ai-services-card-head">
        <div>
          <h5>{status.label}</h5>
          {status.planLabel ? <span className="ai-services-card-sub">Plan {status.planLabel}</span> : null}
        </div>
        <span className={`ai-services-state state-${stateClass}`}>{stateLabel}</span>
      </header>
      {status.metrics
        .filter((metric) => metric.kind !== "balance")
        .map((metric) => <MetricRow key={metric.code} metric={metric} />)}
      {children}
      <footer className="ai-services-card-foot">
        <div className="ai-services-card-foot-text">{footer}</div>
        {canManage ? (
          <button type="button" className="btn-secondary" onClick={onEdit}>
            {editing ? "Cerrar" : "Editar"}
          </button>
        ) : null}
      </footer>
    </article>
  );
}

function LimitFields({ value, onChange, limitLabel, limitKey, limitStep = "1", allowStop = true, limitHint }) {
  return (
    <div className="ai-services-form-grid">
      {limitKey ? (
        <label className="field-group">
          <span>{limitLabel}</span>
          <input
            type="number"
            min="0"
            step={limitStep}
            value={value[limitKey] ?? ""}
            placeholder="Sin límite"
            onChange={(event) =>
              onChange({ [limitKey]: event.target.value === "" ? null : Number(event.target.value) })
            }
          />
          {limitHint ? <small className="field-hint">{limitHint}</small> : null}
        </label>
      ) : null}
      <label className="field-group">
        <span>Avisar al (%)</span>
        <input
          type="number"
          min="1"
          max="99"
          value={value.warningPercent ?? 80}
          onChange={(event) => onChange({ warningPercent: Number(event.target.value) })}
        />
      </label>
      {allowStop ? (
        <label className="field-group">
          <span>Al llegar al límite</span>
          <select value={value.onLimit || "warn"} onChange={(event) => onChange({ onLimit: event.target.value })}>
            <option value="warn">Solo avisar</option>
            <option value="stop">Detener el servicio</option>
          </select>
        </label>
      ) : null}
    </div>
  );
}

function ModelSelect({ value, models, onChange, placeholder, id }) {
  const options = useMemo(() => {
    const list = [...(models || [])];
    if (value && !list.includes(value)) list.unshift(value);
    return list;
  }, [models, value]);
  return (
    <select id={id} value={value || ""} onChange={(event) => onChange(event.target.value)}>
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options.map((model) => (
        <option key={model} value={model}>
          {model}
          {models?.includes(model) ? "" : " (sin tarifa vigente)"}
        </option>
      ))}
    </select>
  );
}

function SummaryTab({ overview, draft, setDraft, canManage, onRefreshTavily, refreshingTavily }) {
  const [editing, setEditing] = useState(null);
  const { statuses, catalog, tariffModels, readiness } = overview;
  const openaiModels = tariffModels.openai || [];
  const updateProvider = (provider, patch) =>
    setDraft((current) => ({
      ...current,
      providers: { ...current.providers, [provider]: { ...current.providers[provider], ...patch } },
    }));
  const updateModel = (role, model) =>
    setDraft((current) => ({
      ...current,
      providers: {
        ...current.providers,
        openai: {
          ...current.providers.openai,
          models: { ...current.providers.openai.models, [role]: model },
        },
      },
    }));
  const savedAdvanced = overview.settings.providers.openai.models.advanced;
  const advancedChanged = draft.providers.openai.models.advanced !== savedAdvanced;
  const tavily = statuses.tavily;
  const tavilyRemote = tavily.remote;

  return (
    <div className="ai-services-cards">
      <ProviderCard
        status={statuses.openai}
        canManage={canManage}
        editing={editing === "openai"}
        onEdit={() => setEditing(editing === "openai" ? null : "openai")}
        footer={`${numberFormatter.format(statuses.openai.calls)} llamadas este mes · medido por el CRM`}
      >
        <BalanceBlock balance={statuses.openai.balance} />
        <div className="ai-services-models">
          <h6>Modelos</h6>
          {catalog.roles.map((role) => {
            const model = (editing === "openai" ? draft : overview.settings).providers.openai.models[role.code];
            const hasRate = openaiModels.includes(model);
            return (
              <div key={role.code} className="ai-services-model-row">
                <span title={role.description}>{role.label}</span>
                {editing === "openai" ? (
                  <ModelSelect
                    id={`ai-model-${role.code}`}
                    value={model}
                    models={openaiModels}
                    onChange={(value) => updateModel(role.code, value)}
                  />
                ) : (
                  <code title={model}>{model}</code>
                )}
                <span className={hasRate ? "ai-services-ok" : "ai-services-missing"}>
                  {hasRate ? "✓ tarifa vigente" : "Falta tarifa"}
                </span>
              </div>
            );
          })}
          {(readiness.providerIssues?.openai || []).length && editing !== "openai" ? (
            <p className="form-error">Registra la tarifa en la pestaña Tarifas para que los módulos puedan usar este modelo.</p>
          ) : null}
          {editing === "openai" && advancedChanged ? (
            <p className="ai-services-caution">
              Cambiar el modelo Avanzado afecta la calidad del chat de Cliente existente. Pruébalo antes en el banco de pruebas.
            </p>
          ) : null}
        </div>
        {statuses.openai.byModel.length ? (
          <details className="ai-services-breakdown">
            <summary>Consumo por modelo</summary>
            <ul>
              {statuses.openai.byModel.map((item) => (
                <li key={item.model}>
                  <code>{item.model}</code>
                  <span>{formatUsd(item.costUsd)}</span>
                  <span>
                    {statuses.openai.costUsd > 0 ? Math.round((item.costUsd / statuses.openai.costUsd) * 100) : 0}%
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {editing === "openai" ? (
          <>
            <div className="ai-services-form-grid">
              <label className="field-group">
                <span>Saldo actual en OpenAI (USD)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.providers.openai.balanceUsd ?? ""}
                  placeholder="Sin capturar"
                  onChange={(event) =>
                    updateProvider("openai", {
                      balanceUsd: event.target.value === "" ? null : Number(event.target.value),
                      recaptureBalance: true,
                    })
                  }
                />
                <small className="field-hint">
                  Cópialo de la página de facturación de OpenAI cada vez que recargues. Al guardar se toma la fecha y hora actuales.
                </small>
              </label>
              <label className="field-group">
                <span>Avisar si el saldo baja de (USD)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.providers.openai.balanceWarningUsd ?? ""}
                  placeholder="Sin aviso"
                  onChange={(event) =>
                    updateProvider("openai", {
                      balanceWarningUsd: event.target.value === "" ? null : Number(event.target.value),
                    })
                  }
                />
              </label>
            </div>
            <LimitFields
              value={draft.providers.openai}
              onChange={(patch) => updateProvider("openai", patch)}
              limitKey="monthlyLimitUsd"
              limitLabel="Límite mensual (USD)"
              limitStep="0.01"
            />
          </>
        ) : null}
      </ProviderCard>

      <ProviderCard
        status={tavily}
        canManage={canManage}
        editing={editing === "tavily"}
        onEdit={() => setEditing(editing === "tavily" ? null : "tavily")}
        footer={
          <>
            {tavilyRemote?.plan ? `Plan ${tavilyRemote.plan} · ` : ""}
            {tavilyRemote?.fetchedAt
              ? tavilyRemote.error
                ? `No se pudo leer de Tavily (${tavilyRemote.error})`
                : `Leído de Tavily ${formatRelative(tavilyRemote.fetchedAt)}`
              : "Sin lectura de Tavily"}
            {" · "}
            <button type="button" className="ai-services-link" onClick={onRefreshTavily} disabled={refreshingTavily}>
              {refreshingTavily ? "Actualizando..." : "Actualizar"}
            </button>
          </>
        }
      >
        <div className="ai-services-kv">
          <span>Medido por el CRM este mes</span>
          <strong>{numberFormatter.format(tavily.measuredCredits)} créditos</strong>
        </div>
        <div className="ai-services-kv">
          <span>Costo estimado</span>
          <strong>
            {tavily.costUsd === null ? "Sin precio por crédito" : formatUsd(tavily.costUsd)}
            {tavily.usdPerCredit !== null ? (
              <small> · {preciseUsdFormatter.format(tavily.usdPerCredit)}/crédito{tavily.priceSource === "plan" ? " (precio del plan)" : ""}</small>
            ) : null}
          </strong>
        </div>
        {editing === "tavily" ? (
          <>
            <LimitFields
              value={draft.providers.tavily}
              onChange={(patch) => updateProvider("tavily", patch)}
              limitKey="monthlyLimitCredits"
              limitLabel="Límite mensual (créditos)"
              limitHint="Vacío: usa el límite del plan leído de Tavily."
            />
            <div className="ai-services-form-grid">
              <label className="field-group">
                <span>Precio por crédito (USD)</span>
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  value={draft.providers.tavily.usdPerCredit ?? ""}
                  placeholder="Precio del plan"
                  onChange={(event) =>
                    updateProvider("tavily", {
                      usdPerCredit: event.target.value === "" ? null : Number(event.target.value),
                    })
                  }
                />
                <small className="field-hint">Vacío: usa el precio publicado de tu plan.</small>
              </label>
            </div>
          </>
        ) : null}
      </ProviderCard>

      <ProviderCard
        status={statuses.pinecone}
        canManage={canManage}
        editing={editing === "pinecone"}
        onEdit={() => setEditing(editing === "pinecone" ? null : "pinecone")}
        footer={
          <>
            Medido por el CRM · {statuses.pinecone.costUsd > 0 ? formatUsd(statuses.pinecone.costUsd) : "USD 0"}
            {statuses.pinecone.blocksAtLimit ? " · el plan se bloquea al llegar a cualquier cuota" : ""}
          </>
        }
      >
        {editing === "pinecone" ? (
          <div className="ai-services-form-grid">
            <label className="field-group">
              <span>Plan</span>
              <select
                value={draft.providers.pinecone.plan}
                onChange={(event) => updateProvider("pinecone", { plan: event.target.value })}
              >
                {catalog.pineconePlans.map((plan) => (
                  <option key={plan.code} value={plan.code}>{plan.label}</option>
                ))}
              </select>
            </label>
            <label className="field-group">
              <span>Avisar al (%)</span>
              <input
                type="number"
                min="1"
                max="99"
                value={draft.providers.pinecone.warningPercent}
                onChange={(event) => updateProvider("pinecone", { warningPercent: Number(event.target.value) })}
              />
            </label>
          </div>
        ) : null}
      </ProviderCard>
    </div>
  );
}

function ModulesTab({ overview, draft, setDraft, canManage }) {
  const [expanded, setExpanded] = useState(null);
  const { catalog, modulesUsage, readiness, tariffModels, connections, statuses } = overview;
  const updateModule = (code, patch) =>
    setDraft((current) => ({
      ...current,
      modules: { ...current.modules, [code]: { ...current.modules[code], ...patch } },
    }));
  const updateOverride = (code, role, model) =>
    setDraft((current) => {
      const overrides = { ...(current.modules[code].modelOverrides || {}) };
      if (model) overrides[role] = model;
      else delete overrides[role];
      return {
        ...current,
        modules: { ...current.modules, [code]: { ...current.modules[code], modelOverrides: overrides } },
      };
    });
  const tavilyAvailable = connections.tavily && connections.tavilyEnabled;

  return (
    <div className="ai-pricing-table-wrap">
      <table className="configuration-table ai-services-modules-table">
        <thead>
          <tr>
            <th>Módulo</th>
            <th>Proveedor IA</th>
            <th>Búsqueda web (Tavily)</th>
            <th>Documentación (Pinecone)</th>
            <th>Uso del mes</th>
          </tr>
        </thead>
        <tbody>
          {catalog.modules.map((module) => {
            const settings = draft.modules[module.code];
            const usage = modulesUsage[module.code] || {};
            const issues = readiness.moduleIssues?.[module.code] || [];
            const overrides = settings.modelOverrides || {};
            const hasOverrides = Object.keys(overrides).length > 0;
            const isExpanded = expanded === module.code;
            const providerModels = tariffModels[settings.llmProvider] || [];
            return [
              <tr key={module.code} className={issues.length ? "ai-services-row-issue" : ""}>
                <td>
                  <strong>{module.label}</strong>
                  {hasOverrides ? <span className="ai-services-tag">Modelos personalizados</span> : null}
                  {issues.length ? (
                    <ul className="ai-services-issues">
                      {issues.map((issue) => <li key={issue}>{issue}</li>)}
                    </ul>
                  ) : null}
                </td>
                <td>
                  {module.usesLlm ? (
                    <div className="ai-services-provider-cell">
                      <select
                        aria-label={`Proveedor IA de ${module.label}`}
                        value={settings.llmProvider}
                        disabled={!canManage}
                        onChange={(event) => updateModule(module.code, { llmProvider: event.target.value })}
                      >
                        {catalog.llmProviders.map((provider) => (
                          <option key={provider.code} value={provider.code}>{provider.label}</option>
                        ))}
                      </select>
                      {canManage ? (
                        <button
                          type="button"
                          className="ai-services-link"
                          onClick={() => setExpanded(isExpanded ? null : module.code)}
                        >
                          {isExpanded ? "Ocultar modelos" : "Personalizar modelos"}
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <span className="field-hint">No usa modelos</span>
                  )}
                </td>
                <td>
                  {module.usesTavily ? (
                    <label className="ai-services-check" title={tavilyAvailable ? "" : "Tavily no está activo en el servidor"}>
                      <input
                        type="checkbox"
                        aria-label={`Tavily en ${module.label}`}
                        checked={Boolean(settings.tavily)}
                        disabled={!canManage || !tavilyAvailable}
                        onChange={(event) => updateModule(module.code, { tavily: event.target.checked })}
                      />
                      {tavilyAvailable ? "" : <small>No activo</small>}
                    </label>
                  ) : <span className="field-hint">—</span>}
                </td>
                <td>
                  {module.usesPinecone ? (
                    <label className="ai-services-check" title={module.pineconeRequired ? "Este módulo es la biblioteca de Pinecone" : ""}>
                      <input
                        type="checkbox"
                        aria-label={`Pinecone en ${module.label}`}
                        checked={Boolean(settings.pinecone)}
                        disabled={!canManage || module.pineconeRequired || !connections.pinecone}
                        onChange={(event) => updateModule(module.code, { pinecone: event.target.checked })}
                      />
                      {!connections.pinecone ? <small>Sin clave</small> : null}
                    </label>
                  ) : <span className="field-hint">—</span>}
                </td>
                <td className="ai-services-usage-cell">
                  {module.usesLlm ? <span>{formatUsd(usage.llmCostUsd)}</span> : null}
                  {module.usesTavily ? <span>{numberFormatter.format(usage.tavilyCredits || 0)} créditos</span> : null}
                  {module.usesPinecone ? (
                    <span>
                      {numberFormatter.format(usage.pineconeTokens || 0)} tokens
                      {usage.pineconeUnits ? ` · ${numberFormatter.format(usage.pineconeUnits)} unidades` : ""}
                    </span>
                  ) : null}
                </td>
              </tr>,
              isExpanded ? (
                <tr key={`${module.code}-models`} className="ai-services-overrides-row">
                  <td colSpan="5">
                    <div className="ai-services-overrides">
                      {catalog.roles.map((role) => {
                        const providerModel = draft.providers[settings.llmProvider]?.models?.[role.code];
                        return (
                          <label key={role.code} className="field-group">
                            <span>{role.label}</span>
                            <ModelSelect
                              value={overrides[role.code] || ""}
                              models={providerModels}
                              placeholder={`Del proveedor (${providerModel || "sin modelo"})`}
                              onChange={(value) => updateOverride(module.code, role.code, value)}
                            />
                          </label>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              ) : null,
            ];
          })}
        </tbody>
      </table>
      <p className="field-hint">
        Los módulos usan el modelo de cada tipo de trabajo definido en la tarjeta del proveedor. {statuses.tavily.enabledInServer === false
          ? "La búsqueda web está desactivada en el servidor (TAVILY_ENABLE_SEARCH)."
          : ""}
      </p>
    </div>
  );
}

function rangeFor(key) {
  const now = new Date();
  if (key === "last7") return { fromUtc: new Date(now.getTime() - 7 * 86400000).toISOString(), toUtc: now.toISOString() };
  if (key === "last30") return { fromUtc: new Date(now.getTime() - 30 * 86400000).toISOString(), toUtc: now.toISOString() };
  if (key === "previousMonth") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 1);
    return { fromUtc: start.toISOString(), toUtc: new Date(end.getTime() - 1).toISOString() };
  }
  return {};
}

function UsageTab() {
  const [rangeKey, setRangeKey] = useState("month");
  const [result, setResult] = useState({ key: null, usage: null, error: "" });
  const loading = result.key !== rangeKey;
  const usage = result.usage;
  const error = loading ? "" : result.error;

  useEffect(() => {
    let active = true;
    api
      .get("/api/admin/ai/services/usage", { params: rangeFor(rangeKey) })
      .then(({ data }) => {
        if (active) setResult({ key: rangeKey, usage: data, error: "" });
      })
      .catch((requestError) => {
        if (active) {
          setResult((current) => ({
            key: rangeKey,
            usage: current.usage,
            error: getApiErrorMessage(requestError, "No fue posible cargar el consumo"),
          }));
        }
      });
    return () => {
      active = false;
    };
  }, [rangeKey]);

  const maxDayCost = useMemo(
    () => Math.max(0.0001, ...(usage?.days || []).map((day) => day.llmCostUsd + day.tavilyCostUsd + day.pineconeCostUsd)),
    [usage],
  );

  async function exportExcel() {
    if (!usage) return;
    const XLSX = await import("xlsx");
    const book = XLSX.utils.book_new();
    const sheet = (rows) => XLSX.utils.json_to_sheet(rows.length ? rows : [{}]);
    XLSX.utils.book_append_sheet(book, sheet(usage.days.map((day) => ({
      Día: day.day,
      "Modelos IA (USD)": day.llmCostUsd,
      Llamadas: day.llmCalls,
      "Tavily (créditos)": day.tavilyCredits,
      "Tavily (USD)": day.tavilyCostUsd,
      "Pinecone (tokens)": day.pineconeTokens,
      "Pinecone (USD)": day.pineconeCostUsd,
    }))), "Por día");
    XLSX.utils.book_append_sheet(book, sheet(usage.modules.map((module) => ({
      Módulo: module.label,
      "Modelos IA (USD)": module.llmCostUsd,
      Llamadas: module.llmCalls,
      "Tavily (créditos)": module.tavilyCredits,
      "Tavily (USD)": module.tavilyCostUsd,
      "Pinecone (tokens)": module.pineconeTokens,
    }))), "Por módulo");
    XLSX.utils.book_append_sheet(book, sheet(usage.models.map((model) => ({
      Proveedor: model.provider,
      Modelo: model.model,
      "Costo (USD)": model.costUsd,
      Llamadas: model.calls,
      Tokens: model.tokens,
    }))), "Por modelo");
    XLSX.utils.book_append_sheet(book, sheet(usage.topUsers.map((user) => ({
      Usuario: user.fullName || user.email || user.userId,
      Correo: user.email || "",
      "Costo (USD)": user.costUsd,
      "Tavily (créditos)": user.tavilyCredits,
      "Pinecone (tokens)": user.pineconeTokens,
    }))), "Usuarios");
    XLSX.utils.book_append_sheet(book, sheet(usage.errors.map((item) => ({
      Fecha: item.createdAtUtc,
      Proveedor: item.provider,
      Módulo: item.moduleLabel,
      Estado: item.statusCode ?? "",
      Mensaje: item.message || item.errorCode || "",
    }))), "Errores");
    XLSX.writeFile(book, `consumo-ia-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <div className="ai-services-usage">
      <div className="ai-services-toolbar">
        <label className="field-group">
          <span>Periodo</span>
          <select value={rangeKey} onChange={(event) => setRangeKey(event.target.value)}>
            <option value="month">Este mes</option>
            <option value="last7">Últimos 7 días</option>
            <option value="last30">Últimos 30 días</option>
            <option value="previousMonth">Mes anterior</option>
          </select>
        </label>
        <button type="button" className="btn-secondary" onClick={exportExcel} disabled={!usage || loading}>
          Exportar a Excel
        </button>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      {loading && !usage ? <p className="field-hint">Cargando consumo...</p> : null}
      {usage ? (
        <>
          <section className="ai-services-block">
            <h6>Uso diario</h6>
            {usage.days.length ? (
              <ul className="ai-services-days">
                {usage.days.map((day) => {
                  const total = day.llmCostUsd + day.tavilyCostUsd + day.pineconeCostUsd;
                  return (
                    <li key={day.day}>
                      <span className="ai-services-day-label">{day.day.slice(5)}</span>
                      <span className="ai-services-day-bar">
                        <span className="seg-llm" style={{ width: `${(day.llmCostUsd / maxDayCost) * 100}%` }} />
                        <span className="seg-tavily" style={{ width: `${(day.tavilyCostUsd / maxDayCost) * 100}%` }} />
                        <span className="seg-pinecone" style={{ width: `${(day.pineconeCostUsd / maxDayCost) * 100}%` }} />
                      </span>
                      <span className="ai-services-day-total">
                        {formatUsd(total)}
                        {day.tavilyCredits ? ` · ${numberFormatter.format(day.tavilyCredits)} cr` : ""}
                        {day.pineconeTokens ? ` · ${numberFormatter.format(day.pineconeTokens)} tk` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="field-hint">Sin consumo en el periodo.</p>}
            <p className="ai-services-legend">
              <span className="seg-llm" /> Modelos IA <span className="seg-tavily" /> Tavily <span className="seg-pinecone" /> Pinecone
            </p>
          </section>

          <div className="ai-services-grid-2">
            <section className="ai-services-block">
              <h6>Por módulo</h6>
              <table className="configuration-table">
                <thead><tr><th>Módulo</th><th>Modelos IA</th><th>Tavily</th><th>Pinecone</th></tr></thead>
                <tbody>
                  {usage.modules.map((module) => (
                    <tr key={module.module}>
                      <td>{module.label}</td>
                      <td>{formatUsd(module.llmCostUsd)}</td>
                      <td>{numberFormatter.format(module.tavilyCredits)} cr</td>
                      <td>{numberFormatter.format(module.pineconeTokens)} tk</td>
                    </tr>
                  ))}
                  {!usage.modules.length ? <tr><td colSpan="4" className="field-hint">Sin consumo.</td></tr> : null}
                </tbody>
              </table>
            </section>
            <section className="ai-services-block">
              <h6>Por modelo</h6>
              <table className="configuration-table">
                <thead><tr><th>Modelo</th><th>Costo</th><th>Llamadas</th></tr></thead>
                <tbody>
                  {usage.models.map((model) => (
                    <tr key={`${model.provider}:${model.model}`}>
                      <td><code>{model.model}</code></td>
                      <td>{formatUsd(model.costUsd)}</td>
                      <td>{numberFormatter.format(model.calls)}</td>
                    </tr>
                  ))}
                  {!usage.models.length ? <tr><td colSpan="3" className="field-hint">Sin consumo.</td></tr> : null}
                </tbody>
              </table>
            </section>
          </div>

          <div className="ai-services-grid-2">
            <section className="ai-services-block">
              <h6>Usuarios que más consumen</h6>
              <ol className="ai-services-top-users">
                {usage.topUsers.map((user) => (
                  <li key={user.userId}>
                    <span>{user.fullName || user.email || `Usuario ${user.userId}`}</span>
                    <strong>{formatUsd(user.costUsd)}</strong>
                  </li>
                ))}
                {!usage.topUsers.length ? <li className="field-hint">Sin consumo.</li> : null}
              </ol>
            </section>
            <section className="ai-services-block">
              <h6>Errores recientes</h6>
              <ul className="ai-services-errors">
                {usage.errors.slice(0, 10).map((item, index) => (
                  <li key={`${item.createdAtUtc}-${index}`}>
                    <strong>{item.provider}</strong> · {item.moduleLabel}
                    {item.statusCode ? ` · ${item.statusCode}` : ""}
                    <small>{new Date(item.createdAtUtc).toLocaleString("es-MX")}</small>
                    <p>{item.message || item.errorCode || "Sin detalle"}</p>
                  </li>
                ))}
                {!usage.errors.length ? <li className="field-hint">Sin errores en el periodo.</li> : null}
              </ul>
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}

function fetchOverview({ refreshTavily = false } = {}) {
  return api.get("/api/admin/ai/services", {
    params: refreshTavily ? { refreshTavily: true } : {},
  });
}

export default function AiServicesPanel({ tab, canManage }) {
  const [overview, setOverview] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [notice, setNotice] = useState("");
  const [refreshingTavily, setRefreshingTavily] = useState(false);

  const applyOverview = useCallback((request) =>
    request
      .then(({ data }) => {
        setOverview(data);
        setDraft(cloneSettings(data.settings));
        setError("");
      })
      .catch((requestError) => {
        setError(getApiErrorMessage(requestError, "No fue posible cargar los servicios de IA"));
      })
      .finally(() => setLoading(false)), []);

  const load = useCallback(
    ({ refreshTavily = false } = {}) =>
      applyOverview(fetchOverview({ refreshTavily })),
    [applyOverview],
  );

  useEffect(() => {
    applyOverview(fetchOverview());
  }, [applyOverview]);

  const dirty = useMemo(
    () => Boolean(overview && draft && JSON.stringify(settingsPayload(draft)) !== JSON.stringify(settingsPayload(overview.settings))),
    [draft, overview],
  );

  async function save() {
    setSaving(true);
    setSaveError(null);
    setNotice("");
    try {
      await api.put("/api/admin/ai/services/settings", {
        expectedVersion: overview.settings.version,
        settings: settingsPayload(draft),
      });
      await load();
      setNotice("Configuración guardada.");
    } catch (requestError) {
      const data = requestError?.response?.data || {};
      const details = Array.isArray(data.details) ? data.details : [];
      setSaveError({
        message: details.length && data.message
          ? data.message
          : getApiErrorMessage(requestError, "No fue posible guardar la configuración"),
        details,
      });
    } finally {
      setSaving(false);
    }
  }

  async function refreshTavily() {
    setRefreshingTavily(true);
    await load({ refreshTavily: true });
    setRefreshingTavily(false);
  }

  if (loading) return <p className="field-hint">Cargando servicios de IA...</p>;
  if (error && !overview) return <p className="form-error">{error}</p>;
  if (!overview || !draft) return null;

  return (
    <div className="ai-services">
      {tab === "summary" ? (
        <SummaryTab
          overview={overview}
          draft={draft}
          setDraft={setDraft}
          canManage={canManage}
          onRefreshTavily={refreshTavily}
          refreshingTavily={refreshingTavily}
        />
      ) : null}
      {tab === "modules" ? (
        <ModulesTab overview={overview} draft={draft} setDraft={setDraft} canManage={canManage} />
      ) : null}
      {tab === "usage" ? <UsageTab /> : null}
      {tab !== "usage" && (dirty || saveError || notice) ? (
        <div className="ai-services-savebar">
          <div>
            {saveError ? (
              <div className="form-error">
                <p>{saveError.message}</p>
                {saveError.details.length ? (
                  <ul>{saveError.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
                ) : null}
              </div>
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
                onClick={() => {
                  setDraft(cloneSettings(overview.settings));
                  setSaveError(null);
                }}
                disabled={saving}
              >
                Descartar
              </button>
              <button type="button" className="btn-primary" onClick={save} disabled={saving || !canManage}>
                {saving ? "Guardando..." : "Guardar cambios"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
