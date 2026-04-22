import { useEffect, useMemo, useState } from "react";
import { api, getApiErrorMessage } from "./api";

const DEFAULT_FORM = {
  salesStageId: "",
  prompt: "",
  responseType: "long_text",
  displayOrder: "",
  isRequired: true,
};

export default function OpportunityQuestionAdminPage() {
  const [stages, setStages] = useState([]);
  const [selectedStageId, setSelectedStageId] = useState("");
  const [questions, setQuestions] = useState([]);
  const [responseTypes, setResponseTypes] = useState(["long_text"]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState(null);
  const [form, setForm] = useState(DEFAULT_FORM);

  useEffect(() => {
    if (!error && !success) return undefined;
    const timeoutId = window.setTimeout(() => {
      setError("");
      setSuccess("");
    }, 4000);
    return () => window.clearTimeout(timeoutId);
  }, [error, success]);

  async function loadStages() {
    const { data } = await api.get("/api/catalogs/opportunity-sales-stages");
    const nextStages = Array.isArray(data) ? data : [];
    setStages(nextStages);
    setSelectedStageId((current) => {
      if (
        current &&
        nextStages.some((stage) => String(stage.id) === String(current))
      ) {
        return current;
      }
      return nextStages[0] ? String(nextStages[0].id) : "";
    });
  }

  async function loadQuestions(stageId) {
    if (!stageId) {
      setQuestions([]);
      return;
    }

    const { data } = await api.get(
      "/api/catalogs/opportunity-stage-questions-admin",
      {
        params: { salesStageId: Number(stageId) },
      },
    );

    setQuestions(Array.isArray(data?.questions) ? data.questions : []);
    setResponseTypes(
      Array.isArray(data?.responseTypes) && data.responseTypes.length
        ? data.responseTypes
        : ["long_text"],
    );
  }

  async function loadAll({ stageId } = {}) {
    setLoading(true);
    try {
      if (!stages.length) {
        await loadStages();
      }
      const targetStageId = stageId || selectedStageId;
      if (targetStageId) {
        await loadQuestions(targetStageId);
      }
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible cargar la configuración de preguntas",
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStages().catch((err) => {
      setError(
        getApiErrorMessage(err, "No fue posible cargar las etapas comerciales"),
      );
    });
  }, []);

  useEffect(() => {
    if (!selectedStageId) return;
    loadQuestions(selectedStageId).catch((err) => {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible cargar las preguntas de la etapa seleccionada",
        ),
      );
    });
  }, [selectedStageId]);

  const selectedStage = useMemo(
    () =>
      stages.find((stage) => String(stage.id) === String(selectedStageId)) ||
      null,
    [stages, selectedStageId],
  );

  const activeQuestionsCount = useMemo(
    () =>
      questions.filter((question) => Number(question.is_active) === 1).length,
    [questions],
  );

  function openCreateModal() {
    setEditingQuestion(null);
    setForm({
      salesStageId: String(selectedStageId || ""),
      prompt: "",
      responseType: responseTypes[0] || "long_text",
      displayOrder: String(questions.length + 1),
      isRequired: true,
    });
    setShowModal(true);
  }

  function openEditModal(question) {
    setEditingQuestion(question);
    setForm({
      salesStageId: String(question.sales_stage_id),
      prompt: String(question.prompt || ""),
      responseType: String(
        question.response_type || responseTypes[0] || "long_text",
      ),
      displayOrder: String(question.display_order || ""),
      isRequired: Number(question.is_required) === 1,
    });
    setShowModal(true);
  }

  function closeModal() {
    if (saving) return;
    setShowModal(false);
    setEditingQuestion(null);
    setForm(DEFAULT_FORM);
  }

  async function submitQuestion(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setSaving(true);

    const payload = {
      salesStageId: Number(form.salesStageId),
      prompt: form.prompt,
      responseType: form.responseType,
      displayOrder: Number(form.displayOrder),
      isRequired: Boolean(form.isRequired),
    };

    try {
      const response = editingQuestion
        ? await api.put(
            `/api/catalogs/opportunity-stage-questions/${editingQuestion.id}`,
            payload,
          )
        : await api.post("/api/catalogs/opportunity-stage-questions", payload);

      const nextStageId = String(payload.salesStageId);
      if (nextStageId !== String(selectedStageId)) {
        setSelectedStageId(nextStageId);
      } else {
        await loadQuestions(nextStageId);
      }

      setSuccess(
        response.data?.message ||
          (editingQuestion
            ? "Pregunta actualizada correctamente"
            : "Pregunta creada correctamente"),
      );
      closeModal();
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible guardar la pregunta"));
    } finally {
      setSaving(false);
    }
  }

  async function toggleQuestionStatus(question) {
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      const response = await api.patch(
        `/api/catalogs/opportunity-stage-questions/${question.id}/status`,
        {
          isActive: Number(question.is_active) !== 1,
        },
      );
      await loadQuestions(selectedStageId);
      setSuccess(
        response.data?.message ||
          "Estado de pregunta actualizado correctamente",
      );
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible actualizar el estado de la pregunta",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  async function moveQuestion(question, direction) {
    const currentIndex = questions.findIndex(
      (row) => Number(row.id) === Number(question.id),
    );
    const targetIndex =
      direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (
      currentIndex < 0 ||
      targetIndex < 0 ||
      targetIndex >= questions.length
    ) {
      return;
    }

    const reordered = [...questions];
    const [movedQuestion] = reordered.splice(currentIndex, 1);
    reordered.splice(targetIndex, 0, movedQuestion);

    setError("");
    setSuccess("");
    setSaving(true);
    try {
      const response = await api.post(
        "/api/catalogs/opportunity-stage-questions/reorder",
        {
          salesStageId: Number(selectedStageId),
          questionIds: reordered.map((row) => Number(row.id)),
        },
      );
      setQuestions(
        Array.isArray(response.data?.questions)
          ? response.data.questions
          : reordered,
      );
      setSuccess(response.data?.message || "Orden actualizado correctamente");
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible reordenar las preguntas"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel">
      <div className="roles-page-header">
        <div className="roles-page-header-left">
          <div className="module-title-with-icon">
            <h2>Preguntas comerciales</h2>
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
            Administra las preguntas activas por etapa sin tocar código ni
            reiniciar la aplicación.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={openCreateModal}>
          + Nueva pregunta
        </button>
      </div>

      {error && <div className="toast toast-error">{error}</div>}
      {success && <div className="toast toast-success">{success}</div>}

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
                <th>Acciones</th>
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
                  <td>
                    <div className="question-admin-table-actions">
                      <button
                        type="button"
                        className="btn-secondary question-admin-order-btn"
                        disabled={saving || index === 0}
                        onClick={() => moveQuestion(question, "up")}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn-secondary question-admin-order-btn"
                        disabled={saving || index === questions.length - 1}
                        onClick={() => moveQuestion(question, "down")}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={saving}
                        onClick={() => openEditModal(question)}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={saving}
                        onClick={() => toggleQuestionStatus(question)}
                      >
                        {Number(question.is_active) === 1
                          ? "Desactivar"
                          : "Activar"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">
          No hay preguntas configuradas para esta etapa. Crea la primera desde
          aquí.
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div
            className="modal-dialog modal-dialog-wide"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <h3 className="modal-title">
                {editingQuestion ? "Editar pregunta" : "Nueva pregunta"}
              </h3>
            </div>
            <p className="modal-message">
              Los cambios se reflejan en oportunidades cuando vuelvan a
              consultar el catálogo de la etapa.
            </p>
            <form onSubmit={submitQuestion}>
              <div className="field-group">
                <label>
                  Etapa <span className="required-mark">*</span>
                </label>
                <select
                  value={form.salesStageId}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      salesStageId: event.target.value,
                    }))
                  }
                  required
                >
                  <option value="">Selecciona etapa</option>
                  {stages.map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field-group" style={{ marginTop: 12 }}>
                <label>
                  Pregunta <span className="required-mark">*</span>
                </label>
                <textarea
                  aria-label="Pregunta"
                  rows={4}
                  value={form.prompt}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      prompt: event.target.value,
                    }))
                  }
                  required
                />
              </div>

              <div className="grid-form question-admin-modal-grid">
                <div className="field-group">
                  <label>
                    Tipo de respuesta <span className="required-mark">*</span>
                  </label>
                  <select
                    value={form.responseType}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        responseType: event.target.value,
                      }))
                    }
                    required
                  >
                    {responseTypes.map((responseType) => (
                      <option key={responseType} value={responseType}>
                        {responseType}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-group">
                  <label>
                    Orden <span className="required-mark">*</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={form.displayOrder}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        displayOrder: event.target.value,
                      }))
                    }
                    required
                  />
                </div>
                <div className="field-group">
                  <label>
                    Obligatoria <span className="required-mark">*</span>
                  </label>
                  <select
                    value={form.isRequired ? "1" : "0"}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        isRequired: event.target.value === "1",
                      }))
                    }
                  >
                    <option value="1">Sí</option>
                    <option value="0">No</option>
                  </select>
                </div>
              </div>

              <div className="modal-buttons" style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={closeModal}
                  disabled={saving}
                >
                  Cancelar
                </button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving
                    ? editingQuestion
                      ? "Guardando..."
                      : "Creando..."
                    : "Guardar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
