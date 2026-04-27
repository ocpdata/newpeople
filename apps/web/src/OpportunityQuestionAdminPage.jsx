import OpportunityQuestionAdminLayout from "./opportunities/OpportunityQuestionAdminLayout";
import OpportunityQuestionFormModal from "./opportunities/OpportunityQuestionFormModal";
import { useOpportunityQuestionAdminPage } from "./opportunities/useOpportunityQuestionAdminPage";
import "./opportunities/opportunity-question-admin.css";

export default function OpportunityQuestionAdminPage() {
  const {
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
  } = useOpportunityQuestionAdminPage();

  return (
    <section className="panel">
      <OpportunityQuestionAdminLayout
        stages={stages}
        selectedStageId={selectedStageId}
        setSelectedStageId={setSelectedStageId}
        selectedStage={selectedStage}
        activeQuestionsCount={activeQuestionsCount}
        questions={questions}
        loading={loading}
        saving={saving}
        onCreateQuestion={openCreateModal}
        onEditQuestion={openEditModal}
        onToggleQuestionStatus={toggleQuestionStatus}
        onMoveQuestion={moveQuestion}
      />

      {error && <div className="toast toast-error">{error}</div>}
      {success && <div className="toast toast-success">{success}</div>}

      <OpportunityQuestionFormModal
        isOpen={showModal}
        editingQuestion={editingQuestion}
        saving={saving}
        form={form}
        stages={stages}
        responseTypes={responseTypes}
        onClose={closeModal}
        onSubmit={submitQuestion}
        onChange={updateFormField}
      />
    </section>
  );
}
