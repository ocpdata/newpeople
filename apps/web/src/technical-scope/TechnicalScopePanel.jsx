import { useCallback, useEffect, useState } from "react";
import ApprovalTab from "./ApprovalTab";
import QuestionnaireTab from "./QuestionnaireTab";
import ScopeSectionsTab from "./ScopeSectionsTab";
import SowTab from "./SowTab";
import TopologyTab from "./TopologyTab";
import {
  SCOPE_STATUS_LABELS,
  getTechnicalScopeErrorMessage,
  technicalScopeApi,
} from "./technicalScopeApi";
import "./technical-scope.css";

const TABS = [
  { key: "questionnaire", label: "Cuestionario" },
  { key: "scope", label: "Alcance" },
  { key: "topology", label: "Topología" },
  { key: "approval", label: "Revisión y aprobación" },
  { key: "sow", label: "SOW" },
];

function StartCard({ overview, busy, onStart }) {
  const { suggestedPlaybooks, catalog, capabilities } = overview;
  const [selected, setSelected] = useState(() => suggestedPlaybooks.map((entry) => entry.code));
  const toSelections = () =>
    selected.map((code) => {
      const suggestion = suggestedPlaybooks.find((entry) => entry.code === code);
      const playbook = catalog.find((entry) => entry.code === code);
      return {
        code,
        modules: playbook?.modules.length === 1 ? playbook.modules.map((m) => m.code) : suggestion?.modules || [],
      };
    });

  return (
    <div className="ts-card">
      <h4>Esta propuesta aún no tiene alcance técnico</h4>
      <p className="field-hint">
        Describe la solución, el alcance, la topología y las exclusiones según el escenario del cliente. Al iniciarlo,
        la propuesta solo se podrá imprimir o enviar cuando el alcance técnico esté aprobado por el preventa.
      </p>
      <div className="ts-playbook-grid">
        {catalog.map((playbook) => (
          <label key={playbook.code} className={selected.includes(playbook.code) ? "ts-playbook is-selected" : "ts-playbook"}>
            <span className="ts-check">
              <input
                type="checkbox"
                disabled={!capabilities.canEdit}
                checked={selected.includes(playbook.code)}
                onChange={(event) =>
                  setSelected(event.target.checked ? [...selected, playbook.code] : selected.filter((code) => code !== playbook.code))
                }
              />
              <strong>{playbook.name}</strong>
            </span>
            {suggestedPlaybooks.some((entry) => entry.code === playbook.code) ? (
              <span className="proposal-chip">Sugerida por la cotización</span>
            ) : null}
          </label>
        ))}
      </div>
      {capabilities.canEdit ? (
        <button type="button" className="btn-primary" disabled={busy || selected.length === 0} onClick={() => onStart(toSelections())}>
          Iniciar alcance técnico
        </button>
      ) : (
        <p className="field-hint">No tienes permiso para iniciar el alcance técnico.</p>
      )}
    </div>
  );
}

// Mount with key={proposal.id} so each proposal starts from a clean state.
// `embedded` renders the panel body without its collapsible header (used inside a drawer);
// `onChange` is called after every successful operation so the host can refresh its print gate.
export default function TechnicalScopePanel({ proposal, embedded = false, onChange = null }) {
  const proposalId = proposal.id;
  const [overview, setOverview] = useState(null);
  const [sowData, setSowData] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("questionnaire");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [warnings, setWarnings] = useState([]);

  // Re-fetches the overview from event handlers (the initial load runs in the effect below).
  const load = useCallback(async () => {
    try {
      setOverview(await technicalScopeApi.overview(proposalId));
    } catch (err) {
      if (err?.response?.status === 403 || err?.response?.status === 404) setHidden(true);
      else setError(await getTechnicalScopeErrorMessage(err, "No fue posible cargar el alcance técnico"));
    }
  }, [proposalId]);

  useEffect(() => {
    let active = true;
    technicalScopeApi
      .overview(proposalId)
      .then((data) => active && setOverview(data))
      .catch(async (err) => {
        if (!active) return;
        if (err?.response?.status === 403 || err?.response?.status === 404) setHidden(true);
        else setError(await getTechnicalScopeErrorMessage(err, "No fue posible cargar el alcance técnico"));
      });
    return () => {
      active = false;
    };
  }, [proposalId]);

  const scopeUpdatedAt = overview?.scope?.updatedAt;
  const hasScope = Boolean(overview?.scope);
  useEffect(() => {
    if (tab !== "sow" || !(open || embedded) || !hasScope) return undefined;
    let active = true;
    technicalScopeApi
      .sow(proposalId)
      .then((data) => active && setSowData(data.sow))
      .catch(async (err) => {
        if (active) setError(await getTechnicalScopeErrorMessage(err, "No fue posible cargar el SOW"));
      });
    return () => {
      active = false;
    };
  }, [tab, open, embedded, hasScope, scopeUpdatedAt, proposalId]);

  // Runs an action, shows its outcome and applies the returned overview.
  const run = async (action, { success, apply } = {}) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await action();
      onChange?.();
      if (apply) apply(result);
      else if (result?.capabilities) setOverview(result);
      if (success) setNotice(typeof success === "function" ? success(result) : success);
      return result;
    } catch (err) {
      setError(await getTechnicalScopeErrorMessage(err, "No fue posible completar la operación"));
      return null;
    } finally {
      setBusy(false);
    }
  };

  if (hidden) return null;

  const scope = overview?.scope;
  const statusLabel = scope ? SCOPE_STATUS_LABELS[scope.status] : "Sin iniciar";
  const caps = overview?.capabilities;

  return (
    <section className="ts-panel" aria-label="Alcance técnico y SOW">
      {embedded ? null : (
        <button type="button" className="ts-panel-head" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span>
            <strong>Alcance técnico y SOW</strong>
            <small className="field-hint"> Solución, alcance, topología y exclusiones a la medida del cliente</small>
          </span>
          <span className="ts-panel-chips">
            <span className={scope?.status === "approved" ? "proposal-chip" : "proposal-chip proposal-chip-soft"}>{statusLabel}</span>
            {scope && !scope.printable ? <span className="proposal-chip ts-chip-warn">Impresión bloqueada</span> : null}
            <span aria-hidden="true">{open ? "▲" : "▼"}</span>
          </span>
        </button>
      )}

      {open || embedded ? (
        <div className="ts-panel-body">
          {error ? <p className="ts-error" role="alert">{error}</p> : null}
          {notice ? <p className="ts-ok" role="status">{notice}</p> : null}
          {!overview ? <p className="field-hint">Cargando…</p> : null}

          {overview && !scope ? (
            <StartCard
              overview={overview}
              busy={busy}
              onStart={(selections) =>
                run(() => technicalScopeApi.start(proposalId, selections), { success: "Alcance técnico iniciado" })
              }
            />
          ) : null}

          {overview && scope ? (
            <>
              <div className="ts-tabs" role="tablist">
                {TABS.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    role="tab"
                    aria-selected={tab === entry.key}
                    className={tab === entry.key ? "is-selected" : ""}
                    onClick={() => setTab(entry.key)}
                  >
                    {entry.label}
                    {entry.key === "approval" && overview.verification?.blocking ? (
                      <span className="ts-badge">{overview.verification.blocking}</span>
                    ) : null}
                  </button>
                ))}
              </div>

              {tab === "questionnaire" ? (
                <QuestionnaireTab
                  overview={overview}
                  canEdit={caps.canEdit}
                  busy={busy}
                  onSaveSelections={(selections) =>
                    run(() => technicalScopeApi.saveSelections(proposalId, selections), { success: "Selección guardada" })
                  }
                  onSaveAnswers={(answers) =>
                    run(() => technicalScopeApi.saveAnswers(proposalId, answers), { success: "Respuestas guardadas" })
                  }
                  onConfirm={(playbookCode) =>
                    run(() => technicalScopeApi.confirmAnswers(proposalId, playbookCode), { success: "Sugerencias confirmadas" })
                  }
                  onAnalyze={() =>
                    run(() => technicalScopeApi.analyzeDocuments(proposalId), {
                      apply: (result) => setOverview(result.overview),
                      success: (result) =>
                        `Documentos analizados: ${result.analysis.documents.length}. Respuestas sugeridas: ${result.analysis.applied}.` +
                        (result.analysis.conflicts.length
                          ? ` ${result.analysis.conflicts.length} difieren de respuestas ya confirmadas y no se aplicaron.`
                          : ""),
                    })
                  }
                  onUseAsAsIs={(documentPublicId) =>
                    run(() => technicalScopeApi.useExtractionAsAsIs(proposalId, documentPublicId), {
                      success: "Diagrama del cliente guardado como situación actual",
                    })
                  }
                />
              ) : null}

              {tab === "scope" ? (
                <ScopeSectionsTab
                  overview={overview}
                  canEdit={caps.canEdit}
                  busy={busy}
                  warnings={warnings}
                  onGenerate={(body) =>
                    run(() => technicalScopeApi.generate(proposalId, body), {
                      apply: (result) => {
                        setOverview(result.overview);
                        setWarnings(result.warnings || []);
                      },
                      success: (result) => (result.usedAi ? "Alcance generado con IA" : "Alcance generado desde el playbook"),
                    })
                  }
                  onSaveSection={(code, content) =>
                    run(() => technicalScopeApi.saveSection(proposalId, code, { content }), { success: "Sección guardada" })
                  }
                  onSaveItemRefs={(code, itemRefs) =>
                    run(() => technicalScopeApi.saveItemRefs(proposalId, code, itemRefs))
                  }
                />
              ) : null}

              {tab === "topology" ? (
                <TopologyTab
                  overview={overview}
                  canEdit={caps.canEdit}
                  busy={busy}
                  onSave={(topology, kind) =>
                    run(() => technicalScopeApi.saveTopology(proposalId, topology, kind), { success: "Topología guardada" })
                  }
                  onPropose={() =>
                    run(() => technicalScopeApi.proposeTopology(proposalId, true), {
                      apply: () => undefined,
                    })
                  }
                />
              ) : null}

              {tab === "approval" ? (
                <ApprovalTab
                  overview={overview}
                  busy={busy}
                  onSubmit={() => run(() => technicalScopeApi.submit(proposalId), { success: "Enviado a revisión" })}
                  onApprove={(checklist, comment) =>
                    run(() => technicalScopeApi.approve(proposalId, checklist, comment), {
                      apply: (result) => setOverview(result.overview),
                      success: (result) =>
                        result.selfApproved
                          ? "Alcance aprobado (queda registrado que lo aprobó quien lo elaboró)"
                          : "Alcance técnico aprobado",
                    })
                  }
                  onReturn={(reason) =>
                    run(() => technicalScopeApi.returnToDraft(proposalId, reason), { success: "Regresado a borrador" })
                  }
                  onDiscard={() =>
                    run(() => technicalScopeApi.discard(proposalId), {
                      apply: () => load(),
                      success: "Alcance técnico descartado",
                    })
                  }
                />
              ) : null}

              {tab === "sow" ? (
                <SowTab
                  overview={overview}
                  sow={sowData}
                  canEdit={caps.canEdit}
                  canApprove={caps.canApprove}
                  busy={busy}
                  onGenerate={(useAi) =>
                    run(() => technicalScopeApi.generateSow(proposalId, useAi), {
                      apply: (result) => {
                        setSowData(result.sow);
                        setWarnings(result.warnings || []);
                      },
                      success: "SOW generado",
                    })
                  }
                  onSaveSection={(code, content) =>
                    run(() => technicalScopeApi.saveSowSection(proposalId, code, { content }), {
                      apply: (result) => setSowData(result.sow),
                      success: "Sección guardada",
                    })
                  }
                  onSubmit={() =>
                    run(() => technicalScopeApi.submitSow(proposalId), {
                      apply: (result) => setSowData(result.sow),
                      success: "SOW enviado a revisión",
                    })
                  }
                  onApprove={(checklist, comment) =>
                    run(() => technicalScopeApi.approveSow(proposalId, checklist, comment), {
                      apply: (result) => setSowData(result.sow),
                      success: "SOW aprobado",
                    })
                  }
                  onReturn={(reason) =>
                    run(() => technicalScopeApi.returnSowToDraft(proposalId, reason), {
                      apply: (result) => setSowData(result.sow),
                      success: "SOW regresado a borrador",
                    })
                  }
                  onOpenPdf={async () => {
                    const pdfWindow = window.open("", "_blank");
                    setBusy(true);
                    setError("");
                    try {
                      const blob = await technicalScopeApi.sowPdf(proposalId);
                      const url = window.URL.createObjectURL(blob);
                      if (pdfWindow) pdfWindow.location.href = url;
                      else window.open(url, "_blank");
                    } catch (err) {
                      pdfWindow?.close();
                      setError(await getTechnicalScopeErrorMessage(err, "No fue posible generar el PDF del SOW"));
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
