import { useEffect, useMemo, useState } from "react";
import { api, getApiErrorMessage } from "../api";

const DEFAULT_FORM = {
  salesStageId: "",
  prompt: "",
  responseType: "long_text",
  displayOrder: "",
  isRequired: true,
};

export function useOpportunityQuestionAdminPage() {
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

  useEffect(() => {
    loadStages().catch((err) => {
      setError(
        getApiErrorMessage(err, "No fue posible cargar las etapas comerciales"),
      );
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!selectedStageId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    loadQuestions(selectedStageId)
      .catch((err) => {
        setError(
          getApiErrorMessage(
            err,
            "No fue posible cargar las preguntas de la etapa seleccionada",
          ),
        );
      })
      .finally(() => {
        setLoading(false);
      });
  }, [selectedStageId]);

  const selectedStage = useMemo(
    () =>
      stages.find((stage) => String(stage.id) === String(selectedStageId)) ||
      null,
    [stages, selectedStageId],
  );

  const activeQuestionsCount = useMemo(
    () => questions.filter((question) => Number(question.is_active) === 1).length,
    [questions],
  );

  function updateFormField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

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
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= questions.length) {
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
        Array.isArray(response.data?.questions) ? response.data.questions : reordered,
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

  return {
    stages,
    selectedStageId,
    setSelectedStageId,
    questions,
    responseTypes,
    loading,
    saving,
    error,
    success,
    showModal,
    editingQuestion,
    form,
    selectedStage,
    activeQuestionsCount,
    updateFormField,
    openCreateModal,
    openEditModal,
    closeModal,
    submitQuestion,
    toggleQuestionStatus,
    moveQuestion,
  };
}