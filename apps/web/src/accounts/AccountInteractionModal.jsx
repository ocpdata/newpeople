function AccountInteractionModal({
  isOpen,
  editingInteractionId,
  interactionForm,
  setInteractionForm,
  interactionTypes,
  interactionResults,
  accountContactOptions,
  interactionDocuments,
  savingInteraction,
  uploadingInteractionDocuments,
  deletingInteractionDocumentId,
  showPromotionPanel,
  setShowPromotionPanel,
  promotionForm,
  setPromotionForm,
  promotionCatalogs,
  promotingInteraction,
  onClose,
  onSubmit,
  onToggleContact,
  onUploadDocuments,
  onDeleteDocument,
  onDownloadDocument,
  onPromote,
  onTogglePromotionDocument,
  formatAmountInput,
}) {
  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={
        editingInteractionId
          ? "Editar interaccion comercial"
          : "Registrar interaccion comercial"
      }
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-dialog modal-dialog-wide account-interaction-modal">
        <div className="modal-header">
          <h3 className="modal-title">
            {editingInteractionId
              ? "Editar interaccion comercial"
              : "Registrar interaccion comercial"}
          </h3>
        </div>

        <form
          className="account-create-form account-interaction-form"
          onSubmit={onSubmit}
        >
          <section className="account-form-section account-modal-section">
            <h4>Resumen</h4>
            <div className="account-interaction-grid">
              <div className="field-group">
                <label>Tipo</label>
                <select
                  value={interactionForm.interactionTypeId}
                  onChange={(event) =>
                    setInteractionForm((prev) => ({
                      ...prev,
                      interactionTypeId: event.target.value,
                    }))
                  }
                  required
                >
                  <option value="">Selecciona tipo</option>
                  {interactionTypes.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label>Resultado</label>
                <select
                  value={interactionForm.resultId}
                  onChange={(event) =>
                    setInteractionForm((prev) => ({
                      ...prev,
                      resultId: event.target.value,
                    }))
                  }
                  required
                >
                  <option value="">Selecciona resultado</option>
                  {interactionResults.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group account-interaction-grid-wide">
                <label>Titulo</label>
                <input
                  value={interactionForm.title}
                  onChange={(event) =>
                    setInteractionForm((prev) => ({
                      ...prev,
                      title: event.target.value,
                    }))
                  }
                  required
                />
              </div>
              <div className="field-group">
                <label>Fecha y hora</label>
                <input
                  type="datetime-local"
                  value={interactionForm.occurredAt}
                  onChange={(event) =>
                    setInteractionForm((prev) => ({
                      ...prev,
                      occurredAt: event.target.value,
                    }))
                  }
                  required
                />
              </div>
              <div className="field-group">
                <label>Seguimiento sugerido</label>
                <input
                  type="datetime-local"
                  value={interactionForm.followUpAt}
                  onChange={(event) =>
                    setInteractionForm((prev) => ({
                      ...prev,
                      followUpAt: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="field-group account-interaction-grid-wide">
                <label>Resumen</label>
                <textarea
                  value={interactionForm.summary}
                  onChange={(event) =>
                    setInteractionForm((prev) => ({
                      ...prev,
                      summary: event.target.value,
                    }))
                  }
                  required
                />
              </div>
              <div className="field-group account-interaction-grid-wide">
                <label>Proximo paso</label>
                <textarea
                  value={interactionForm.nextStep}
                  onChange={(event) =>
                    setInteractionForm((prev) => ({
                      ...prev,
                      nextStep: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
          </section>

          <section className="account-form-section account-modal-section">
            <h4>Contactos vinculados</h4>
            {!accountContactOptions.length ? (
              <p className="field-hint">
                La cuenta no tiene contactos registrados todavia.
              </p>
            ) : (
              <div className="account-interaction-contact-list">
                {accountContactOptions.map((contact) => {
                  const checked = interactionForm.contactIds.includes(
                    Number(contact.id),
                  );
                  return (
                    <label
                      key={contact.id}
                      className="account-interaction-contact-option"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggleContact(contact.id)}
                      />
                      <span>
                        <strong>{contact.fullName}</strong>
                        <small>
                          {[
                            contact.activationStatus,
                            contact.email || contact.phone,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </section>

          {editingInteractionId ? (
            <section className="account-form-section account-modal-section">
              <div className="account-interaction-documents-header">
                <div>
                  <h4>Adjuntos</h4>
                  <p className="field-hint">
                    Adjunta evidencia comercial, minutas, presentaciones o
                    documentos de seguimiento.
                  </p>
                </div>
                <label className="btn-secondary opportunity-documents-upload-button">
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.docx,.xlsx,.xls,.csv,.txt,.png,.jpg,.jpeg,.mp3,.wav,.m4a"
                    onChange={(event) => {
                      const nextFiles = event.target.files;
                      if (nextFiles?.length) {
                        onUploadDocuments(nextFiles);
                      }
                      event.target.value = "";
                    }}
                    disabled={uploadingInteractionDocuments}
                  />
                  {uploadingInteractionDocuments
                    ? "Subiendo..."
                    : "Adjuntar documentos"}
                </label>
              </div>

              {!interactionDocuments.length ? (
                <p className="field-hint">Aun no hay documentos adjuntos.</p>
              ) : (
                <div className="account-interaction-documents-list">
                  {interactionDocuments.map((document) => (
                    <article
                      key={document.publicId}
                      className="account-interaction-document-card"
                    >
                      <div>
                        <strong>{document.originalFileName}</strong>
                        <p className="field-hint">
                          {document.processingStatus || "Cargado"} ·{" "}
                          {Math.round((document.byteSize || 0) / 1024)} KB
                        </p>
                      </div>
                      <div className="account-interaction-document-actions">
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() =>
                            onDownloadDocument(
                              document.publicId,
                              document.originalFileName,
                            )
                          }
                        >
                          Abrir
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => onDeleteDocument(document.publicId)}
                          disabled={
                            deletingInteractionDocumentId === document.publicId
                          }
                        >
                          {deletingInteractionDocumentId === document.publicId
                            ? "Eliminando..."
                            : "Quitar"}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {editingInteractionId ? (
            <section className="account-form-section account-modal-section">
              <div className="account-interaction-promotion-head">
                <div>
                  <h4>Promover a oportunidad</h4>
                  <p className="field-hint">
                    Cuando la interaccion ya tiene una necesidad real,
                    conviertela en oportunidad sin perder la trazabilidad.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowPromotionPanel((prev) => !prev)}
                >
                  {showPromotionPanel ? "Ocultar" : "Mostrar"}
                </button>
              </div>

              {showPromotionPanel ? (
                <div className="account-interaction-promotion-grid">
                  <div className="field-group account-interaction-grid-wide">
                    <label>Nombre de la oportunidad</label>
                    <input
                      value={promotionForm.name}
                      onChange={(event) =>
                        setPromotionForm((prev) => ({
                          ...prev,
                          name: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="field-group">
                    <label>Monto USD</label>
                    <input
                      value={promotionForm.amountUsd}
                      onChange={(event) =>
                        setPromotionForm((prev) => ({
                          ...prev,
                          amountUsd: formatAmountInput(event.target.value),
                        }))
                      }
                    />
                  </div>
                  <div className="field-group">
                    <label>Fecha de cierre</label>
                    <input
                      type="date"
                      value={promotionForm.closeDate}
                      onChange={(event) =>
                        setPromotionForm((prev) => ({
                          ...prev,
                          closeDate: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="field-group">
                    <label>Contacto</label>
                    <select
                      value={promotionForm.contactId}
                      onChange={(event) =>
                        setPromotionForm((prev) => ({
                          ...prev,
                          contactId: event.target.value,
                        }))
                      }
                    >
                      <option value="">Selecciona contacto</option>
                      {accountContactOptions.map((contact) => (
                        <option key={contact.id} value={contact.id}>
                          {contact.fullName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field-group">
                    <label>Linea de negocio</label>
                    <select
                      value={promotionForm.businessLineId}
                      onChange={(event) =>
                        setPromotionForm((prev) => ({
                          ...prev,
                          businessLineId: event.target.value,
                        }))
                      }
                    >
                      <option value="">Selecciona linea</option>
                      {promotionCatalogs.businessLines.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field-group">
                    <label>Vendedor</label>
                    <select
                      value={promotionForm.sellerUserId}
                      onChange={(event) =>
                        setPromotionForm((prev) => ({
                          ...prev,
                          sellerUserId: event.target.value,
                        }))
                      }
                    >
                      <option value="">Selecciona vendedor</option>
                      {promotionCatalogs.sellerUsers.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.full_name || option.fullName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field-group">
                    <label>Preventa</label>
                    <select
                      value={promotionForm.presalesUserId}
                      onChange={(event) =>
                        setPromotionForm((prev) => ({
                          ...prev,
                          presalesUserId: event.target.value,
                        }))
                      }
                    >
                      <option value="">Sin preventa</option>
                      {promotionCatalogs.presalesUsers.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.full_name || option.fullName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field-group account-interaction-grid-wide account-interaction-promotion-documents-field">
                    <div className="account-interaction-promotion-documents-head">
                      <div>
                        <label>Documentos de referencia</label>
                        <p className="field-hint">
                          Selecciona la evidencia que debe viajar con la
                          oportunidad para conservar el contexto comercial.
                        </p>
                      </div>
                      <span className="account-interaction-promotion-documents-count">
                        {promotionForm.documentPublicIds.length} de{" "}
                        {interactionDocuments.length} seleccionado
                        {promotionForm.documentPublicIds.length === 1
                          ? ""
                          : "s"}
                      </span>
                    </div>

                    {interactionDocuments.length ? (
                      <>
                        <div className="account-interaction-promotion-documents-selected-bar">
                          {promotionForm.documentPublicIds.length ? (
                            promotionForm.documentPublicIds.map(
                              (documentPublicId) => {
                                const selectedDocument =
                                  interactionDocuments.find(
                                    (document) =>
                                      document.publicId === documentPublicId,
                                  );
                                if (!selectedDocument) return null;
                                return (
                                  <span
                                    key={documentPublicId}
                                    className="account-interaction-contact-chip"
                                  >
                                    {selectedDocument.originalFileName}
                                  </span>
                                );
                              },
                            )
                          ) : (
                            <span className="field-hint">
                              Aun no has seleccionado documentos de referencia.
                            </span>
                          )}
                        </div>

                        <div className="account-interaction-promotion-documents-grid">
                          {interactionDocuments.map((document) => {
                            const isSelected =
                              promotionForm.documentPublicIds.includes(
                                document.publicId,
                              );

                            return (
                              <label
                                key={document.publicId}
                                className={`account-interaction-promotion-document-option${
                                  isSelected ? " is-selected" : ""
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() =>
                                    onTogglePromotionDocument(document.publicId)
                                  }
                                />
                                <div className="account-interaction-promotion-document-copy">
                                  <div className="account-interaction-promotion-document-topline">
                                    <strong>{document.originalFileName}</strong>
                                    <span className="account-interaction-badge is-muted">
                                      {isSelected ? "Incluido" : "Disponible"}
                                    </span>
                                  </div>
                                  <div className="account-interaction-card-meta">
                                    <span>
                                      {document.processingStatus || "Cargado"}
                                    </span>
                                    <span>
                                      {Math.round(
                                        (document.byteSize || 0) / 1024,
                                      )}{" "}
                                      KB
                                    </span>
                                  </div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <div className="account-interaction-promotion-documents-empty">
                        <strong>No hay documentos disponibles</strong>
                        <span>
                          Adjunta evidencia a la interacción para poder usarla
                          como referencia al crear la oportunidad.
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="modal-buttons account-interaction-promotion-actions">
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={onPromote}
                      disabled={promotingInteraction}
                    >
                      {promotingInteraction
                        ? "Creando oportunidad..."
                        : "Crear oportunidad"}
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          <div className="modal-buttons" style={{ marginTop: 16 }}>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cerrar
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={savingInteraction}
            >
              {savingInteraction
                ? editingInteractionId
                  ? "Guardando..."
                  : "Registrando..."
                : editingInteractionId
                  ? "Guardar interaccion"
                  : "Registrar interaccion"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AccountInteractionModal;
