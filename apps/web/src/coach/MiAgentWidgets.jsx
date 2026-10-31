import { createElement } from "react";
import { AlertCircle, Database, Lightbulb, Search } from "lucide-react";
import { formatDate } from "./customerChatShared";
import { formatCoachRecommendation, getCustomerActionStatusClass } from "./miAgentHelpers";
import { COACH_SOURCE_LABELS, STAGE_READINESS_RECOMMENDATION_LABELS } from "./miAgentConstants";

export function CustomerActionResult({
  label,
  status,
  preview,
  className = "",
  showStatus = true,
  open,
  onToggle,
  children,
}) {
  return (
    <details
      className={`mi-agent-customer-action-result ${className}`.trim()}
      role="region"
      aria-label={label}
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
    >
      <summary>
        <span className="mi-agent-customer-action-result-copy">
          <strong>{label}</strong>
          {preview ? <small>{preview}</small> : null}
        </span>
        {showStatus ? (
          <span
            className={`mi-agent-customer-action-result-status ${getCustomerActionStatusClass(status)}`}
          >
            {status}
          </span>
        ) : null}
      </summary>
      <div className="mi-agent-customer-action-result-content">{children}</div>
    </details>
  );
}

function CoachEvidenceList({ evidence = [] }) {
  if (!evidence.length) return null;
  return (
    <ul className="mi-agent-coach-evidence-list">
      {evidence.map((item, index) => {
        const structured = item && typeof item === "object";
        return (
          <li
            key={`${structured ? item.sourceType : "evidence"}-${structured ? item.sourceId : index}-${index}`}
          >
            {structured ? (
              <>
                <span>
                  {COACH_SOURCE_LABELS[item.sourceType] || item.sourceType}
                </span>
                <strong>{item.label}</strong>
                {item.excerpt ? <small>{item.excerpt}</small> : null}
              </>
            ) : (
              <span>{item}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function CoachSemanticSections({ result }) {
  const sections = [
    {
      key: "facts",
      title: "Hechos",
      icon: Database,
      items: result?.facts || [],
    },
    {
      key: "evidence",
      title: "Evidencia",
      icon: Search,
      items: result?.evidence || [],
    },
    {
      key: "inferences",
      title: "Inferencias",
      icon: AlertCircle,
      items: result?.inferences || [],
    },
  ].filter((section) => section.items.length);
  const recommendation = formatCoachRecommendation(result?.recommendation);

  if (!sections.length && !result?.recommendation) return null;
  return (
    <div className="mi-agent-coach-semantic" aria-label="Fundamento del Coach">
      {sections.map(({ key, title, icon, items }) => (
        <section className={`is-${key}`} key={key}>
          <h5>
            {createElement(icon, { size: 14, "aria-hidden": true })}
            {title}
          </h5>
          <CoachEvidenceList evidence={items} />
        </section>
      ))}
      {result?.recommendation ? (
        <section className="is-recommendation">
          <h5>
            <Lightbulb size={14} aria-hidden="true" />
            Recomendación
          </h5>
          <p>{recommendation}</p>
        </section>
      ) : null}
    </div>
  );
}

export function CoachStageReadiness({ readiness }) {
  if (!readiness) return null;

  const completedCount = readiness.confirmedProgress?.length || 0;
  const pendingCount = readiness.pendingItems?.length || 0;
  const totalCount = completedCount + pendingCount;
  const diagnosisLabel =
    readiness.recommendation === "advance"
      ? "Sólida"
      : readiness.recommendation === "advance_with_caution"
        ? "Parcial"
        : "Débil";
  const principalWeakness =
    readiness.risks?.[0]?.title ||
    readiness.pendingItems?.[0]?.title ||
    "Sin debilidad identificada";

  const renderItems = (items, emptyMessage, includeSeverity = false) =>
    items?.length ? (
      <ul>
        {items.map((item, index) => (
          <li key={`${item.title}-${index}`}>
            <strong>{item.title}</strong>
            {includeSeverity ? (
              <span className={`is-${item.severity}`}>{item.severity}</span>
            ) : null}
            <small>{item.detail}</small>
            {item.mitigation ? (
              <small>Mitigación: {item.mitigation}</small>
            ) : null}
            <CoachEvidenceList evidence={item.evidence} />
          </li>
        ))}
      </ul>
    ) : (
      <p className="mi-agent-stage-readiness-empty">{emptyMessage}</p>
    );

  return (
    <section
      className="mi-agent-stage-readiness"
      aria-label="Preparación de etapa"
    >
      <div className="mi-agent-stage-readiness-stage">
        <div>
          <small>Etapa actual</small>
          <strong>{readiness.currentStage.name}</strong>
          <p>{readiness.currentStage.objective}</p>
        </div>
        <div className="mi-agent-stage-readiness-score">
          <span>{diagnosisLabel}</span>
          <strong>
            {completedCount}/{totalCount || 0}
          </strong>
          <small>dimensiones confirmadas</small>
        </div>
      </div>
      <div className="mi-agent-stage-readiness-weakness">
        <AlertCircle size={15} aria-hidden="true" />
        <span>Principal punto de atención</span>
        <strong>{principalWeakness}</strong>
      </div>
      <div className="mi-agent-stage-readiness-grid">
        <section>
          <h5>Avances confirmados</h5>
          {renderItems(readiness.confirmedProgress, "Sin avances confirmados.")}
        </section>
        <section>
          <h5>Pendientes</h5>
          {renderItems(readiness.pendingItems, "Sin pendientes.")}
        </section>
        <section>
          <h5>Riesgos</h5>
          {renderItems(readiness.risks, "Sin riesgos abiertos.", true)}
        </section>
      </div>
      <div className="mi-agent-stage-readiness-next">
        <small>Siguiente paso</small>
        <strong>{readiness.nextStep.action}</strong>
        <p>{readiness.nextStep.successCriteria}</p>
        <span>
          Responsable {readiness.nextStep.responsibleUserId || "por asignar"}
          {readiness.nextStep.targetDate
            ? ` · ${formatDate(readiness.nextStep.targetDate)}`
            : ""}
        </span>
      </div>
      <div
        className={`mi-agent-stage-readiness-recommendation is-${readiness.recommendation}`}
      >
        <small>Recomendación de avance</small>
        <strong>
          {STAGE_READINESS_RECOMMENDATION_LABELS[readiness.recommendation] ||
            readiness.recommendation}
        </strong>
        <p>{readiness.rationale}</p>
      </div>
    </section>
  );
}

export function AdministrationGroups({
  governance,
  policies,
  intents,
  classifier,
  planner,
  conversationalRules,
  serverRules,
  observability,
}) {
  return (
    <div className="mi-agent-administration-groups">
      <section aria-labelledby="mi-agent-admin-governance-group">
        <h3 id="mi-agent-admin-governance-group">Gobierno y alcance</h3>
        {governance}
        {policies}
      </section>
      <section aria-labelledby="mi-agent-admin-behavior-group">
        <h3 id="mi-agent-admin-behavior-group">
          Interpretación y comportamiento
        </h3>
        {intents}
        {classifier}
        {planner}
        {conversationalRules}
      </section>
      <section aria-labelledby="mi-agent-admin-diagnostics-group">
        <h3 id="mi-agent-admin-diagnostics-group">
          Validación y diagnóstico
        </h3>
        {serverRules}
        {observability}
      </section>
    </div>
  );
}
