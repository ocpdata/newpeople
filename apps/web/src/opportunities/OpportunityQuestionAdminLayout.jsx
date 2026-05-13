export default function OpportunityQuestionAdminLayout({
  stages,
  selectedStageId,
  setSelectedStageId,
  selectedStage,
  activeQuestionsCount,
  questions,
  loading,
  saving,
  canUpdate,
  onCreateQuestion,
  onEditQuestion,
  onToggleQuestionStatus,
  onMoveQuestion,
}) {
  return (
    <>
      <div className="roles-page-header">
        <div className="roles-page-header-left">
          <div className="module-title-with-icon">
            <h2>Configuración del proceso comercial</h2>
            <span
              className="module-title-icon module-title-icon-opportunities"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M6.75 4A2.75 2.75 0 0 0 4 6.75v10.5A2.75 2.75 0 0 0 6.75 20h10.5A2.75 2.75 0 0 0 20 17.25V9.81a.75.75 0 0 0-.22-.53l-5.06-5.06A.75.75 0 0 0 14.19 4H6.75zm8 .56L18.44 8.25H15.5a.75.75 0 0 1-.75-.75V4.56zM5.5 6.75c0-.69.56-1.25 1.25-1.25H13V7.5A2.25 2.25 0 0 0 15.25 9.75h3.25v7.5c0 .69-.56 1.25-1.25 1.25H6.75c-.69 0-1.25-.56-1.25-1.25V6.75z" />
                <path d="M8 12.25a.75.75 0 0 1 .75-.75h6.5a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1-.75-.75zm0 3a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75z" />
              </svg>
            </span>
          </div>
          <p className="roles-subtitle">
            Administra la configuración de preguntas por etapa del proceso
            comercial sin tocar código ni reiniciar la aplicación.
          </p>
        </div>
        {canUpdate ? (
          <button
            type="button"
            className="btn-primary"
            onClick={onCreateQuestion}
          >
            + Nueva pregunta
          </button>
        ) : null}
      </div>

      <div className="question-admin-stage-strip">
        {stages.map((stage) => (
          <button
            key={stage.id}
            type="button"
            className={
              String(stage.id) === String(selectedStageId)
                ? "question-admin-stage-pill is-selected"
                : "question-admin-stage-pill"
            }
            onClick={() => setSelectedStageId(String(stage.id))}
          >
            <span>{stage.name}</span>
            <small>Etapa {stage.stage_order}</small>
          </button>
        ))}
      </div>

      <div className="question-admin-summary">
        <div className="account-form-section question-admin-summary-card">
          <h4>Etapa seleccionada</h4>
          <strong>{selectedStage?.name || "-"}</strong>
          <p className="field-hint question-admin-summary-hint">
            Las oportunidades consumen este catálogo cuando abren o refrescan su
            contexto comercial.
          </p>
        </div>
        <div className="account-form-section question-admin-summary-card">
          <h4>Preguntas activas</h4>
          <strong>{activeQuestionsCount}</strong>
          <p className="field-hint question-admin-summary-hint">
            {questions.length} registradas en total para la etapa actual.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="empty-state">Cargando configuración comercial...</div>
      ) : questions.length ? (
        <div className="question-admin-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Orden</th>
                <th>Pregunta</th>
                <th>Tipo</th>
                <th>Obligatoria</th>
                <th>Estado</th>
                {canUpdate ? <th>Acciones</th> : null}
              </tr>
            </thead>
            <tbody>
              {questions.map((question, index) => (
                <tr key={question.id}>
                  <td>{question.display_order}</td>
                  <td>
                    <div className="question-admin-prompt-cell">
                      <strong>{question.prompt}</strong>
                      <span className="field-hint">
                        Código interno: {question.code}
                      </span>
                    </div>
                  </td>
                  <td>{question.response_type}</td>
                  <td>
                    <span
                      className={
                        Number(question.is_required) === 1
                          ? "user-status-badge active"
                          : "user-status-badge pending"
                      }
                    >
                      {Number(question.is_required) === 1 ? "Sí" : "No"}
                    </span>
                  </td>
                  <td>
                    <span
                      className={
                        Number(question.is_active) === 1
                          ? "user-status-badge active"
                          : "user-status-badge inactive"
                      }
                    >
                      {Number(question.is_active) === 1 ? "Activa" : "Inactiva"}
                    </span>
                  </td>
                  {canUpdate ? (
                    <td>
                      <div className="question-admin-table-actions">
                        <button
                          type="button"
                          className="btn-secondary question-admin-order-btn"
                          disabled={saving || index === 0}
                          onClick={() => onMoveQuestion(question, "up")}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="btn-secondary question-admin-order-btn"
                          disabled={saving || index === questions.length - 1}
                          onClick={() => onMoveQuestion(question, "down")}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={saving}
                          onClick={() => onEditQuestion(question)}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={saving}
                          onClick={() => onToggleQuestionStatus(question)}
                        >
                          {Number(question.is_active) === 1
                            ? "Desactivar"
                            : "Activar"}
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">
          {canUpdate
            ? "No hay preguntas configuradas para esta etapa. Crea la primera desde aquí."
            : "No hay preguntas configuradas para esta etapa."}
        </div>
      )}
    </>
  );
}