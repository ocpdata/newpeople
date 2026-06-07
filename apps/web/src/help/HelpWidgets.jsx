import { useHelp } from "./HelpProvider";

export function HelpFabButton() {
  const { toggleHelp } = useHelp();

  return (
    <button
      type="button"
      className="help-fab"
      onClick={toggleHelp}
      aria-label="Abrir centro de ayuda"
      title="Centro de ayuda"
    >
      Ayuda
    </button>
  );
}

export function HelpDrawer() {
  const {
    isOpen,
    query,
    setQuery,
    routeTours,
    filteredArticles,
    completedTours,
    closeHelp,
    startTour,
    routeKey,
  } = useHelp();

  return (
    <>
      {isOpen ? (
        <button
          type="button"
          className="help-drawer-backdrop"
          onClick={closeHelp}
          aria-label="Cerrar ayuda"
        />
      ) : null}
      <aside
        className={isOpen ? "help-drawer is-open" : "help-drawer"}
        aria-hidden={!isOpen}
      >
        <div className="help-drawer-header">
          <div>
            <h3>Centro de ayuda</h3>
            <p>Contexto actual: {routeKey}</p>
          </div>
          <button
            type="button"
            className="help-close"
            onClick={closeHelp}
            aria-label="Cerrar centro de ayuda"
          >
            Cerrar
          </button>
        </div>

        <label className="help-search">
          Buscar
          <input
            type="text"
            placeholder="Buscar guias de este modulo"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <section className="help-block">
          <h4>Tours guiados</h4>
          {routeTours.length ? (
            <div className="help-list">
              {routeTours.map((tour) => (
                <article key={tour.id} className="help-item">
                  <strong>{tour.title}</strong>
                  <p>{tour.steps.length} pasos</p>
                  <div className="help-item-row">
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => startTour(tour.id)}
                    >
                      Iniciar
                    </button>
                    {completedTours[tour.id] ? (
                      <span className="help-badge">Completado</span>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="field-hint">No hay tours para esta pantalla.</p>
          )}
        </section>

        <section className="help-block">
          <h4>Guias rapidas</h4>
          {filteredArticles.length ? (
            <div className="help-list">
              {filteredArticles.map((article) => (
                <article key={article.id} className="help-item">
                  <strong>{article.title}</strong>
                  <p>{article.summary}</p>
                  {Array.isArray(article.details) && article.details.length ? (
                    <ul className="help-item-details">
                      {article.details.map((detail) => (
                        <li key={detail}>{detail}</li>
                      ))}
                    </ul>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <p className="field-hint">No hay resultados para tu busqueda.</p>
          )}
        </section>
      </aside>
    </>
  );
}

export function HelpTourCoach() {
  const {
    currentTour,
    currentStep,
    activeTour,
    stopTour,
    previousStep,
    nextStep,
  } = useHelp();

  if (!currentTour || !currentStep || !activeTour) {
    return null;
  }

  const stepIndex = Number(activeTour.stepIndex || 0);
  const total = currentTour.steps.length;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex >= total - 1;

  return (
    <section className="help-tour-coach" aria-live="polite">
      <span className="help-tour-kicker">
        {currentTour.title} · Paso {stepIndex + 1}/{total}
      </span>
      <h4>{currentStep.title}</h4>
      <p>{currentStep.content}</p>
      <div className="help-tour-actions">
        <button type="button" className="btn-secondary" onClick={stopTour}>
          Salir
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={previousStep}
          disabled={isFirst}
        >
          Atras
        </button>
        <button type="button" className="btn-primary" onClick={nextStep}>
          {isLast ? "Finalizar" : "Siguiente"}
        </button>
      </div>
    </section>
  );
}
