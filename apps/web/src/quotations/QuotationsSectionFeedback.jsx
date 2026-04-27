function QuotationsSectionFeedback({ isOpportunityActive, error, success }) {
  return (
    <>
      {!isOpportunityActive ? (
        <p className="field-hint quotation-disabled-hint">
          Solo se puede crear cotizacion desde una oportunidad activada.
        </p>
      ) : null}

      {error ? <div className="toast toast-error">{error}</div> : null}
      {success ? <div className="toast toast-success">{success}</div> : null}
    </>
  );
}

export default QuotationsSectionFeedback;
