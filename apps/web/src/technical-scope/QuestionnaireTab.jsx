import { useMemo, useState } from "react";

const SOURCE_LABELS = {
  manual: "Capturada",
  document: "Documento",
  crm: "CRM",
  ai: "IA",
};

function answerKey(question) {
  return `${question.playbookCode}:${question.code}`;
}

function initialValue(question) {
  const value = question.answer?.value;
  if (value === null || value === undefined) return question.type === "multi" ? [] : "";
  if (question.type === "boolean") return value ? "true" : "false";
  if (question.type === "multi") return Array.isArray(value) ? value : [];
  return String(value);
}

function serializeValue(question, value) {
  if (question.type === "boolean") return value === "" ? null : value === "true";
  if (question.type === "multi") return value;
  return value === "" ? null : value;
}

function QuestionInput({ question, value, onChange, disabled }) {
  if (question.type === "number") {
    return (
      <input
        type="number"
        min="0"
        step="any"
        inputMode="decimal"
        placeholder={question.unit ? `Número (${question.unit})` : "Escribe un número"}
        value={value}
        disabled={disabled}
        onKeyDown={(event) => {
          // Number inputs accept "e" as an exponent, which looks like the field ignoring text.
          if (["e", "E", "+", "-"].includes(event.key)) event.preventDefault();
        }}
        onChange={(event) => onChange(event.target.value)}
        aria-label={question.prompt}
      />
    );
  }
  if (question.type === "boolean") {
    return (
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} aria-label={question.prompt}>
        <option value="">Sin respuesta</option>
        <option value="true">Sí</option>
        <option value="false">No</option>
      </select>
    );
  }
  if (question.type === "choice") {
    return (
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} aria-label={question.prompt}>
        <option value="">Sin respuesta</option>
        {question.options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    );
  }
  if (question.type === "multi") {
    return (
      <div className="ts-checks" role="group" aria-label={question.prompt}>
        {question.options.map((option) => (
          <label key={option} className="ts-check">
            <input
              type="checkbox"
              disabled={disabled}
              checked={value.includes(option)}
              onChange={(event) =>
                onChange(event.target.checked ? [...value, option] : value.filter((entry) => entry !== option))
              }
            />
            {option}
          </label>
        ))}
      </div>
    );
  }
  return (
    <textarea rows={2} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} aria-label={question.prompt} />
  );
}

function PlaybookSelector({ overview, disabled, onSave }) {
  const current = overview.scope.playbookCodes;
  const [selection, setSelection] = useState(() => current);

  const toggleCode = (playbook, checked) => {
    if (checked) {
      const suggested = overview.suggestedPlaybooks.find((entry) => entry.code === playbook.code);
      const modules = playbook.modules.length === 1
        ? playbook.modules.map((module) => module.code)
        : suggested?.modules || [];
      setSelection([...selection, { code: playbook.code, modules }]);
    } else {
      setSelection(selection.filter((entry) => entry.code !== playbook.code));
    }
  };
  const toggleModule = (code, moduleCode, checked) =>
    setSelection(
      selection.map((entry) =>
        entry.code === code
          ? { ...entry, modules: checked ? [...entry.modules, moduleCode] : entry.modules.filter((m) => m !== moduleCode) }
          : entry,
      ),
    );
  const changed = JSON.stringify(selection) !== JSON.stringify(current);

  return (
    <section className="ts-card">
      <h4>Soluciones del alcance</h4>
      <p className="field-hint">
        Se sugirieron según las partidas cotizadas. Cambiar la selección regresa el alcance a borrador.
      </p>
      <div className="ts-playbook-grid">
        {overview.catalog.map((playbook) => {
          const selected = selection.find((entry) => entry.code === playbook.code);
          return (
            <div key={playbook.code} className={selected ? "ts-playbook is-selected" : "ts-playbook"}>
              <label className="ts-check">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={Boolean(selected)}
                  onChange={(event) => toggleCode(playbook, event.target.checked)}
                />
                <strong>{playbook.name}</strong>
              </label>
              <span className={playbook.status === "validado" ? "proposal-chip" : "proposal-chip proposal-chip-soft"}>
                {playbook.status === "validado" ? "Validado" : "Borrador IA"}
              </span>
              {selected && playbook.modules.length > 1 ? (
                <div className="ts-checks">
                  {playbook.modules.map((module) => (
                    <label key={module.code} className="ts-check" title={module.description}>
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={selected.modules.includes(module.code)}
                        onChange={(event) => toggleModule(playbook.code, module.code, event.target.checked)}
                      />
                      {module.name}
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {disabled ? null : (
        <button type="button" className="btn-secondary" disabled={!changed || selection.length === 0} onClick={() => onSave(selection)}>
          Guardar selección
        </button>
      )}
    </section>
  );
}

// The form remounts when the stored answers change, so drafts always start from what is saved.
// The playbook selector stays outside that remount so unsaved checkbox changes survive an analysis run.
export default function QuestionnaireTab(props) {
  const signature = JSON.stringify(props.overview.questions.map((q) => [answerKey(q), q.answer?.value ?? null, q.answer?.status ?? null]));
  const selectionSignature = JSON.stringify(props.overview.scope.playbookCodes);
  return (
    <div className="ts-tab">
      <PlaybookSelector
        key={selectionSignature}
        overview={props.overview}
        disabled={!props.canEdit || props.busy}
        onSave={props.onSaveSelections}
      />
      <QuestionnaireForm key={`${signature}|${selectionSignature}`} {...props} />
    </div>
  );
}

function QuestionnaireForm({ overview, canEdit, busy, analyzing, onSaveAnswers, onConfirm, onAnalyze, onUseAsAsIs }) {
  const { questions, coverage, extractions, scope } = overview;
  const [drafts, setDrafts] = useState(() =>
    Object.fromEntries(questions.map((question) => [answerKey(question), initialValue(question)])),
  );

  const dirtyQuestions = useMemo(
    () => questions.filter((question) => JSON.stringify(drafts[answerKey(question)]) !== JSON.stringify(initialValue(question))),
    [questions, drafts],
  );

  const grouped = useMemo(() => {
    const result = new Map();
    for (const question of questions) {
      const key = question.playbookCode;
      if (!result.has(key)) result.set(key, new Map());
      const sections = result.get(key);
      const section = question.section || "General";
      if (!sections.has(section)) sections.set(section, []);
      sections.get(section).push(question);
    }
    return result;
  }, [questions]);
  const playbookName = (code) => overview.catalog.find((entry) => entry.code === code)?.name || code;
  const progress = coverage.total ? Math.round((coverage.confirmed / coverage.total) * 100) : 0;
  const suggestedProgress = coverage.total ? Math.round((coverage.suggestedPending / coverage.total) * 100) : 0;
  const unanswered = Math.max(coverage.total - coverage.confirmed - coverage.suggestedPending, 0);
  const suggestedCount = (code) =>
    questions.filter((question) => question.playbookCode === code && question.answer?.status === "suggested").length;

  const save = () =>
    onSaveAnswers(
      dirtyQuestions.map((question) => ({
        playbookCode: question.playbookCode,
        questionCode: question.code,
        value: serializeValue(question, drafts[answerKey(question)]),
      })),
    );

  return (
    <>
      <section className="ts-card">
        <div className="ts-card-head">
          <div>
            <h4>Documentos técnicos del cliente</h4>
            <p className="field-hint">
              Analiza los documentos de la oportunidad (configuraciones, diagramas, levantamientos) para sugerir respuestas.
              Los secretos se enmascaran antes de procesarse y las sugerencias requieren tu confirmación.
            </p>
          </div>
          {canEdit ? (
            <button type="button" className="btn-secondary ts-analyze-btn" disabled={busy} aria-busy={analyzing} onClick={() => onAnalyze()}>
              {analyzing ? <span className="ts-spinner" aria-hidden="true" /> : null}
              {analyzing ? "Analizando…" : "Analizar documentos"}
            </button>
          ) : null}
        </div>
        {analyzing ? (
          <div className="ts-analyzing" role="status" aria-live="polite">
            <span className="ts-spinner" aria-hidden="true" />
            <span>
              Analizando los documentos de la oportunidad con IA. Esto puede tardar un minuto; no cierres esta ventana.
            </span>
            <span className="ts-analyzing-bar" aria-hidden="true" />
          </div>
        ) : null}
        {extractions.length ? (
          <ul className="ts-extractions">
            {extractions.map((extraction) => (
              <li key={extraction.documentPublicId}>
                <strong>{extraction.documentName}</strong>
                <span className="proposal-chip proposal-chip-soft">{extraction.detectedKind}</span>
                {extraction.status === "failed" ? <span className="ts-error">{extraction.errorMessage}</span> : null}
                {extraction.redactions?.count ? (
                  <span className="field-hint">{extraction.redactions.count} secretos enmascarados</span>
                ) : null}
                {extraction.topology?.nodes?.length && canEdit ? (
                  <button type="button" className="btn-link" onClick={() => onUseAsAsIs(extraction.documentPublicId)}>
                    Usar como topología de situación actual
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="field-hint">Aún no se han analizado documentos.</p>
        )}
      </section>

      <section className="ts-card">
        <div className="ts-card-head">
          <div>
            <h4>Cuestionario técnico</h4>
            <div className="ts-coverage" aria-label="Avance del cuestionario">
              <span className="ts-coverage-item is-confirmed"><strong>{coverage.confirmed}</strong> confirmadas</span>
              <span className="ts-coverage-item is-suggested"><strong>{coverage.suggestedPending}</strong> sugeridas por revisar</span>
              <span className="ts-coverage-item is-empty"><strong>{unanswered}</strong> sin responder</span>
              <span className="field-hint">de {coverage.total} preguntas</span>
            </div>
            <div className="ts-progress" aria-hidden="true">
              <span className="ts-progress-confirmed" style={{ width: `${progress}%` }} />
              <span className="ts-progress-suggested" style={{ width: `${suggestedProgress}%` }} />
            </div>
            <p className="field-hint">
              {coverage.suggestedPending > 0
                ? "Las sugeridas (en amarillo) las propuso la IA desde los documentos: revísalas y confírmalas para que cuenten. "
                : ""}
              {coverage.requiredMissing.length
                ? `Faltan ${coverage.requiredMissing.length} obligatorias por confirmar; se tratarán como supuestos.`
                : "Todas las obligatorias están confirmadas."}
            </p>
          </div>
          {canEdit ? (
            <div className="ts-actions">
              {coverage.suggestedPending > 0
                ? scope.playbookCodes
                    .filter((selection) => suggestedCount(selection.code) > 0)
                    .map((selection) => (
                      <button key={selection.code} type="button" className="btn-secondary" disabled={busy} onClick={() => onConfirm(selection.code)}>
                        Confirmar {suggestedCount(selection.code)} sugeridas de {playbookName(selection.code)}
                      </button>
                    ))
                : null}
              <button type="button" className="btn-primary" disabled={busy || dirtyQuestions.length === 0} onClick={save}>
                Guardar respuestas{dirtyQuestions.length ? ` (${dirtyQuestions.length})` : ""}
              </button>
            </div>
          ) : null}
        </div>

        {Array.from(grouped.entries()).map(([code, sections]) => (
          <div key={code} className="ts-question-group">
            <h5>{playbookName(code)}</h5>
            {Array.from(sections.entries()).map(([section, list]) => (
              <fieldset key={section} className="ts-fieldset">
                <legend>{section}</legend>
                {list.map((question) => {
                  const key = answerKey(question);
                  const answer = question.answer;
                  return (
                    <div key={key} className={answer?.status === "suggested" ? "ts-question is-suggested" : "ts-question"}>
                      <label>
                        {question.prompt}
                        {question.required ? <span className="ts-required" title="Obligatoria"> *</span> : null}
                        {question.unit ? <span className="field-hint"> ({question.unit})</span> : null}
                      </label>
                      {question.helpText ? <small className="field-hint">{question.helpText}</small> : null}
                      <QuestionInput
                        question={question}
                        value={drafts[key] ?? ""}
                        disabled={!canEdit || busy}
                        onChange={(value) => setDrafts((current) => ({ ...current, [key]: value }))}
                      />
                      {answer ? (
                        <small className="field-hint">
                          {answer.status === "suggested" ? <span className="ts-status-pill">Sugerida por IA · por confirmar</span> : null}
                          {answer.status === "suggested" ? " " : ""}
                          {SOURCE_LABELS[answer.sourceType] || answer.sourceType}
                          {answer.sourceRef ? `: ${answer.sourceRef}` : ""}
                          {answer.confidence !== null && answer.confidence !== undefined
                            ? ` · confianza ${Math.round(answer.confidence * 100)}%`
                            : ""}
                        </small>
                      ) : null}
                    </div>
                  );
                })}
              </fieldset>
            ))}
          </div>
        ))}
      </section>
    </>
  );
}
