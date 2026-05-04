import { useMemo } from "react";
import { useConfigurationPage } from "./configuration/useConfigurationPage";
import "./configuration/configuration.css";

function ConfigurationSummaryList({ items }) {
  return (
    <dl className="configuration-summary-list">
      {items.map((item) => (
        <div key={item.label} className="configuration-summary-row">
          <dt>{item.label}</dt>
          <dd>{item.value || "Sin definir"}</dd>
        </div>
      ))}
    </dl>
  );
}

function ConfigurationChecklist({ title, description, items }) {
  return (
    <section className="configuration-card">
      <div className="configuration-card-heading">
        <div>
          <h4>{title}</h4>
          <p>{description}</p>
        </div>
      </div>
      <div className="configuration-checklist">
        {items.map((item) => (
          <article
            key={item.label}
            className={`configuration-checklist-item ${
              item.complete ? "is-complete" : "is-pending"
            }`}
          >
            <div>
              <strong>{item.label}</strong>
              <p>{item.description}</p>
            </div>
            <span>{item.complete ? "Completo" : "Pendiente"}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function ConfigurationBrandingPreview({
  logoUrl,
  legalName,
  taxId,
  lines,
  email,
  phone,
}) {
  return (
    <section className="configuration-card configuration-branding-card">
      <div className="configuration-card-heading">
        <div>
          <h4>Branding documental activo</h4>
          <p>
            Este bloque se reutiliza en la salida documental de cotizaciones.
          </p>
        </div>
      </div>

      <div className="configuration-branding-preview">
        <div className="configuration-branding-logo-shell">
          {logoUrl ? (
            <img src={logoUrl} alt="Logo institucional en documentos" />
          ) : (
            <div className="configuration-logo-empty">Sin logo configurado</div>
          )}
        </div>

        <div className="configuration-branding-copy">
          <strong>{legalName || "Sin razon social"}</strong>
          <span>{taxId || "Sin registro fiscal"}</span>
          {lines.map((line) => (
            <span key={line}>{line}</span>
          ))}
          {email ? <span>{email}</span> : null}
          {phone ? <span>{phone}</span> : null}
        </div>
      </div>
    </section>
  );
}

function ConfigurationModuleCards({ items, onOpenAudit }) {
  return (
    <div className="configuration-module-grid">
      {items.map((item) => (
        <section key={item.title} className="configuration-card">
          <div className="configuration-card-heading">
            <div>
              <h4>{item.title}</h4>
              <p>{item.description}</p>
            </div>
            {item.badge ? (
              <span className="configuration-inline-pill">{item.badge}</span>
            ) : null}
          </div>

          <ul className="configuration-bullet-list">
            {item.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>

          {item.action === "audit" ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={onOpenAudit}
            >
              Abrir historial
            </button>
          ) : null}
        </section>
      ))}
    </div>
  );
}

function WorkspacePlaybookCard({ items, activatingVersionId, onActivate }) {
  return (
    <section className="configuration-card">
      <div className="configuration-card-heading">
        <div>
          <h4>Playbook comercial activo</h4>
          <p>
            El workspace de oportunidades ahora se construye desde la version
            activa persistida en base de datos.
          </p>
        </div>
      </div>

      <div className="configuration-playbook-list">
        {items.map((item) => (
          <article
            key={`${item.playbookId}:${item.versionId}`}
            className={`configuration-playbook-item ${item.isActive ? "is-active" : ""}`}
          >
            <div>
              <strong>
                {item.name} {item.version}
              </strong>
              <p>{item.description || "Sin descripcion"}</p>
              <span>
                {item.stageCount} etapas | {item.criteriaCount} criterios
              </span>
            </div>
            <button
              type="button"
              className={item.isActive ? "btn-secondary" : "btn-primary"}
              disabled={item.isActive || activatingVersionId === item.versionId}
              onClick={() => onActivate(item.versionId)}
            >
              {item.isActive
                ? "Activo"
                : activatingVersionId === item.versionId
                  ? "Activando..."
                  : "Activar"}
            </button>
          </article>
        ))}
        {!items.length ? (
          <p className="field-hint">
            No hay versiones de playbook disponibles.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function WorkspacePlaybookEditor({
  playbook,
  savingKey,
  onSaveStage,
  onSaveCriterion,
}) {
  if (!playbook) {
    return (
      <section className="configuration-card">
        <div className="configuration-card-heading">
          <div>
            <h4>Edicion del playbook</h4>
            <p>No hay una version activa disponible para editar.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="configuration-card">
      <div className="configuration-card-heading">
        <div>
          <h4>Edicion del playbook activo</h4>
          <p>
            Ajusta objetivos y criterios que usa el workspace comercial para
            evaluar la oportunidad.
          </p>
        </div>
        <span className="configuration-inline-pill">
          {playbook.name} {playbook.version}
        </span>
      </div>

      <div className="configuration-playbook-stage-list">
        {playbook.stages.map((stage) => (
          <article
            key={stage.stageCode}
            className="configuration-playbook-stage-card"
          >
            <div className="configuration-playbook-stage-header">
              <div>
                <strong>{stage.stageName}</strong>
                <span>{stage.criteria.length} criterios</span>
              </div>
            </div>

            <form
              className="configuration-playbook-stage-form"
              onSubmit={(event) => {
                event.preventDefault();
                const formData = new FormData(event.currentTarget);
                onSaveStage({
                  versionId: playbook.versionId,
                  salesStageCode: stage.stageCode,
                  objective: String(formData.get("objective") || "").trim(),
                  exitCriteriaSummary: String(
                    formData.get("exitCriteriaSummary") || "",
                  ).trim(),
                });
              }}
            >
              <div className="field-group">
                <label>Objetivo</label>
                <textarea
                  name="objective"
                  rows="3"
                  defaultValue={stage.objective}
                />
              </div>
              <div className="field-group">
                <label>Criterio de salida</label>
                <textarea
                  name="exitCriteriaSummary"
                  rows="3"
                  defaultValue={stage.exitCriteriaSummary}
                />
              </div>
              <div className="configuration-playbook-actions-row">
                <button
                  type="submit"
                  className="btn-secondary"
                  disabled={savingKey === `stage:${stage.stageCode}`}
                >
                  {savingKey === `stage:${stage.stageCode}`
                    ? "Guardando..."
                    : "Guardar etapa"}
                </button>
              </div>
            </form>

            <div className="configuration-playbook-criteria-list">
              {stage.criteria.map((criterion) => (
                <form
                  key={criterion.criterionCode}
                  className="configuration-playbook-criterion-card"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const formData = new FormData(event.currentTarget);
                    onSaveCriterion({
                      versionId: playbook.versionId,
                      salesStageCode: stage.stageCode,
                      criterionCode: criterion.criterionCode,
                      title: String(formData.get("title") || "").trim(),
                      description: String(
                        formData.get("description") || "",
                      ).trim(),
                      themeCode: String(formData.get("themeCode") || "").trim(),
                      displayOrder: Number(formData.get("displayOrder") || 1),
                    });
                  }}
                >
                  <div className="configuration-playbook-criterion-header">
                    <strong>{criterion.criterionCode}</strong>
                    <span>Tema: {criterion.themeCode || "sin tema"}</span>
                  </div>
                  <div className="field-group">
                    <label>Titulo</label>
                    <input name="title" defaultValue={criterion.title} />
                  </div>
                  <div className="field-group">
                    <label>Descripcion</label>
                    <textarea
                      name="description"
                      rows="2"
                      defaultValue={criterion.description}
                    />
                  </div>
                  <div className="configuration-playbook-criterion-grid">
                    <div className="field-group">
                      <label>Tema</label>
                      <input
                        name="themeCode"
                        defaultValue={criterion.themeCode}
                      />
                    </div>
                    <div className="field-group">
                      <label>Orden</label>
                      <input
                        name="displayOrder"
                        type="number"
                        min="1"
                        defaultValue={criterion.displayOrder}
                      />
                    </div>
                  </div>
                  <div className="configuration-playbook-actions-row">
                    <button
                      type="submit"
                      className="btn-secondary"
                      disabled={
                        savingKey ===
                        `criterion:${stage.stageCode}:${criterion.criterionCode}`
                      }
                    >
                      {savingKey ===
                      `criterion:${stage.stageCode}:${criterion.criterionCode}`
                        ? "Guardando..."
                        : "Guardar criterio"}
                    </button>
                  </div>
                </form>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function InlineFieldError({ message }) {
  if (!message) return null;
  return <p className="field-error-text">{message}</p>;
}

function getFieldClassName(message) {
  return message ? "field-input-error" : undefined;
}

function formatAuditAction(action) {
  const value = String(action || "")
    .replaceAll("_", " ")
    .trim();
  if (!value) return "Cambio registrado";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildAddressPreviewLines(form, countryName) {
  const lines = [];
  const addressLine1 = String(form.addressLine1 || "").trim();
  const addressLine2 = String(form.addressLine2 || "").trim();
  const locality = [form.city, form.stateRegion]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ");
  const localityLine = [
    locality,
    String(form.postalCode || "").trim()
      ? `CP ${String(form.postalCode || "").trim()}`
      : "",
  ]
    .filter(Boolean)
    .join(", ");

  if (addressLine1) lines.push(addressLine1);
  if (addressLine2) lines.push(addressLine2);
  if (localityLine) lines.push(localityLine);
  if (countryName) lines.push(countryName);

  return lines;
}

function formatCompletionLabel(completed, total) {
  if (!total) return "Sin datos";
  return `${completed} de ${total} completos`;
}

function formatCompletionPercent(completed, total) {
  if (!total) return 0;
  return Math.round((completed / total) * 100);
}

function ConfigurationAuditList({
  entries,
  formatDateTime,
  summarizeChangedFields,
}) {
  if (!entries.length) {
    return (
      <div className="configuration-placeholder-card">
        <h3>Sin movimientos recientes</h3>
        <p>
          Cuando se modifique la configuracion, el historial aparecera aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="configuration-audit-list">
      {entries.map((entry) => (
        <article key={entry.id} className="configuration-audit-item">
          <div className="configuration-audit-item-top">
            <strong>{formatDateTime(entry.created_at)}</strong>
            <span>
              {entry.performed_by_name || entry.performed_by_email || "Sistema"}
            </span>
          </div>
          <div className="configuration-audit-item-body">
            <span className="configuration-audit-action">
              {formatAuditAction(entry.action)}
            </span>
            <p>
              {entry.detail || summarizeChangedFields(entry.changed_fields)}
            </p>
          </div>
        </article>
      ))}
    </div>
  );
}

export default function ConfigurationPage() {
  const {
    loading,
    saving,
    error,
    success,
    activeSection,
    countries,
    companyProfile,
    form,
    auditEntries,
    workspacePlaybooks,
    workspacePlaybookDetail,
    activatingWorkspaceVersionId,
    savingWorkspacePlaybookKey,
    fieldErrors,
    isDirty,
    canSave,
    latestUpdateText,
    sectionItems,
    formatDateTime,
    summarizeChangedFields,
    updateField,
    changeSection,
    discardChanges,
    handleLogoChange,
    saveCompanyProfile,
    activateWorkspacePlaybook,
    updateWorkspacePlaybookStage,
    updateWorkspacePlaybookCriterion,
  } = useConfigurationPage();

  const activeSectionMeta = useMemo(
    () =>
      sectionItems.find((item) => item.id === activeSection) || sectionItems[0],
    [activeSection, sectionItems],
  );

  const countryName = useMemo(
    () =>
      countries.find((country) => String(country.id) === String(form.countryId))
        ?.name ||
      companyProfile?.countryName ||
      "",
    [companyProfile, countries, form.countryId],
  );

  const brandingLines = useMemo(
    () => buildAddressPreviewLines(form, countryName),
    [countryName, form],
  );

  const requiredFieldItems = useMemo(
    () => [
      {
        label: "Razon social",
        description: "Identidad legal usada en documentos y encabezados.",
        complete: Boolean(String(form.legalName || "").trim()),
      },
      {
        label: "Registro fiscal",
        description:
          "Identificador fiscal requerido para cotizaciones y referencias.",
        complete: Boolean(String(form.taxId || "").trim()),
      },
      {
        label: "Direccion principal",
        description:
          "Base del domicilio institucional que se imprime en documentos.",
        complete: Boolean(String(form.addressLine1 || "").trim()),
      },
      {
        label: "Ciudad y region",
        description: "Ubicacion administrativa completa de la empresa.",
        complete:
          Boolean(String(form.city || "").trim()) &&
          Boolean(String(form.stateRegion || "").trim()),
      },
      {
        label: "Pais",
        description: "Catalogo geografico de referencia para la sede.",
        complete: Boolean(String(form.countryId || "").trim()),
      },
      {
        label: "Codigo postal",
        description:
          "Se agrega al domicilio institucional y validaciones operativas.",
        complete: Boolean(String(form.postalCode || "").trim()),
      },
    ],
    [form],
  );

  const optionalFieldItems = useMemo(
    () => [
      {
        label: "Logo institucional",
        description: "Mejora la salida documental y refuerza el branding.",
        complete: Boolean(String(form.logoUrl || "").trim()),
      },
      {
        label: "Correo institucional",
        description:
          "Canal de contacto visible para clientes y equipos internos.",
        complete: Boolean(String(form.email || "").trim()),
      },
      {
        label: "Telefono institucional",
        description:
          "Referencia operativa visible en la documentacion emitida.",
        complete: Boolean(String(form.phone || "").trim()),
      },
      {
        label: "Sitio web",
        description: "Punto de referencia comercial complementario.",
        complete: Boolean(String(form.website || "").trim()),
      },
      {
        label: "Descripcion institucional",
        description:
          "Contexto interno del perfil de empresa para administradores.",
        complete: Boolean(String(form.description || "").trim()),
      },
    ],
    [form],
  );

  const requiredCompleted = requiredFieldItems.filter(
    (item) => item.complete,
  ).length;
  const optionalCompleted = optionalFieldItems.filter(
    (item) => item.complete,
  ).length;

  const summaryItems = useMemo(
    () => [
      {
        label: "Nombre comercial",
        value: form.commercialName || "Sin definir",
      },
      { label: "Correo institucional", value: form.email || "Sin definir" },
      { label: "Telefono institucional", value: form.phone || "Sin definir" },
      { label: "Sitio web", value: form.website || "Sin definir" },
      { label: "Pais sede", value: countryName || "Sin definir" },
      { label: "Ultimo cambio", value: latestUpdateText },
    ],
    [
      countryName,
      form.commercialName,
      form.email,
      form.phone,
      form.website,
      latestUpdateText,
    ],
  );

  const latestAuditEntry = auditEntries[0] || null;

  const moduleItems = useMemo(
    () => [
      {
        title: "Cotizaciones",
        description:
          "Las salidas PDF consultan el branding documental centralizado desde esta configuracion.",
        badge: brandingLines.length ? "Activo" : "Revisar",
        points: [
          `Razon social publicada: ${form.legalName || "Sin definir"}`,
          `Registro fiscal visible: ${form.taxId || "Sin definir"}`,
          `Lineas de domicilio listas: ${brandingLines.length}`,
        ],
      },
      {
        title: "Permisos y control",
        description:
          "La administracion del modulo esta protegida por permisos especificos de lectura y actualizacion.",
        badge: "Controlado",
        points: [
          "Lectura: configuracion.read",
          "Actualizacion: configuracion.update",
          "Los cambios sensibles quedan trazados en auditoria.",
        ],
      },
      {
        title: "Auditoria",
        description:
          "Cada ajuste institucional relevante deja rastro para revision posterior.",
        badge: `${auditEntries.length} eventos`,
        points: latestAuditEntry
          ? [
              `Ultima accion: ${formatAuditAction(latestAuditEntry.action)}`,
              `Responsable: ${
                latestAuditEntry.performed_by_name ||
                latestAuditEntry.performed_by_email ||
                "Sistema"
              }`,
              `Fecha: ${formatDateTime(latestAuditEntry.created_at)}`,
            ]
          : [
              "Sin eventos recientes registrados.",
              "El historial se actualiza al guardar cambios.",
              "Puedes revisar el detalle completo desde esta misma pantalla.",
            ],
        action: "audit",
      },
    ],
    [
      auditEntries.length,
      brandingLines.length,
      form.legalName,
      form.taxId,
      formatDateTime,
      latestAuditEntry,
    ],
  );

  if (loading) {
    return <div className="centered">Cargando configuracion...</div>;
  }

  return (
    <section className="panel configuration-page">
      <header className="configuration-header">
        <div>
          <div className="module-title-with-icon">
            <h2>Configuracion</h2>
            <span
              className="module-title-icon configuration-title-icon"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M10.34 2.88a1 1 0 0 1 1.32-.61l.95.38a1 1 0 0 0 .74 0l.95-.38a1 1 0 0 1 1.32.61l.42.93a1 1 0 0 0 .57.52l.98.33a1 1 0 0 1 .67 1.28l-.31 1a1 1 0 0 0 .11.77l.57.88a1 1 0 0 1-.17 1.43l-.8.67a1 1 0 0 0-.33.71l-.05 1.05a1 1 0 0 1-.95.95l-1.05.05a1 1 0 0 0-.71.33l-.67.8a1 1 0 0 1-1.43.17l-.88-.57a1 1 0 0 0-.77-.11l-1 .31a1 1 0 0 1-1.28-.67l-.33-.98a1 1 0 0 0-.52-.57l-.93-.42a1 1 0 0 1-.61-1.32l.38-.95a1 1 0 0 0 0-.74l-.38-.95a1 1 0 0 1 .61-1.32l.93-.42a1 1 0 0 0 .52-.57z" />
                <path d="M12 9.25A2.75 2.75 0 1 0 12 14.75A2.75 2.75 0 1 0 12 9.25z" />
              </svg>
            </span>
          </div>
          <p className="roles-subtitle">
            Administra los datos institucionales y parametros globales de la
            aplicacion.
          </p>
          <p className="field-hint">Ultima actualizacion: {latestUpdateText}</p>
        </div>

        <div className="configuration-header-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => changeSection("audit")}
          >
            Ver auditoria
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={!isDirty || saving}
            onClick={discardChanges}
          >
            Descartar cambios
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={saving || !canSave}
            onClick={saveCompanyProfile}
          >
            {saving ? "Guardando..." : "Guardar cambios"}
          </button>
        </div>
      </header>

      <div className="configuration-layout">
        <aside className="configuration-sidebar">
          <div className="configuration-sidebar-title">
            Configuracion general
          </div>
          {sectionItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`configuration-nav-item ${item.id === activeSection ? "is-active" : ""}`}
              onClick={() => changeSection(item.id)}
            >
              <div>
                <strong>{item.title}</strong>
                <span>{item.description}</span>
              </div>
              {item.dirty ? <span className="configuration-nav-dot" /> : null}
            </button>
          ))}
        </aside>

        <div className="configuration-content">
          <header className="configuration-section-header">
            <div>
              <h3>{activeSectionMeta.title}</h3>
              <p>{activeSectionMeta.description}</p>
            </div>
            {companyProfile?.updatedAt ? (
              <span className="configuration-status-pill">
                Vigente desde {formatDateTime(companyProfile.updatedAt)}
              </span>
            ) : null}
          </header>

          {activeSection === "company" ? (
            <div className="configuration-company-grid">
              <section className="configuration-card">
                <h4>Identidad institucional</h4>
                <div className="configuration-form-grid">
                  <div className="field-group">
                    <label>
                      Razon social <span className="required-mark">*</span>
                    </label>
                    <input
                      type="text"
                      className={getFieldClassName(fieldErrors.legalName)}
                      value={form.legalName}
                      onChange={(event) =>
                        updateField("legalName", event.target.value)
                      }
                      placeholder="Ej. Access Quality S.A. de C.V."
                    />
                    <InlineFieldError message={fieldErrors.legalName} />
                    <p className="field-hint">
                      Se usara en documentos oficiales y encabezados
                      institucionales.
                    </p>
                  </div>
                  <div className="field-group">
                    <label>Nombre comercial</label>
                    <input
                      type="text"
                      value={form.commercialName}
                      onChange={(event) =>
                        updateField("commercialName", event.target.value)
                      }
                      placeholder="Ej. Access Quality"
                    />
                  </div>
                  <div className="field-group configuration-grid-span-full">
                    <label>Descripcion institucional</label>
                    <textarea
                      rows="3"
                      className={getFieldClassName(fieldErrors.description)}
                      value={form.description}
                      onChange={(event) =>
                        updateField("description", event.target.value)
                      }
                      placeholder="Breve descripcion para uso interno o documental"
                    />
                    <InlineFieldError message={fieldErrors.description} />
                  </div>
                </div>
              </section>

              <section className="configuration-card">
                <h4>Logo institucional</h4>
                <div className="configuration-logo-card">
                  <div className="configuration-logo-preview">
                    {form.logoUrl ? (
                      <img
                        src={form.logoUrl}
                        alt="Vista previa del logo institucional"
                      />
                    ) : (
                      <div className="configuration-logo-empty">
                        Sin logo cargado
                      </div>
                    )}
                  </div>
                  <div className="configuration-logo-actions">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(event) =>
                        handleLogoChange(event.target.files?.[0])
                      }
                    />
                    <p className="field-hint">
                      Formatos permitidos: JPG, PNG, WEBP. Tamano maximo: 2 MB.
                    </p>
                    {form.logoUrl ? (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => updateField("logoUrl", "")}
                      >
                        Quitar logo
                      </button>
                    ) : null}
                  </div>
                </div>
              </section>

              <section className="configuration-card">
                <h4>Datos fiscales</h4>
                <div className="configuration-form-grid">
                  <div className="field-group">
                    <label>
                      Registro fiscal <span className="required-mark">*</span>
                    </label>
                    <input
                      type="text"
                      className={getFieldClassName(fieldErrors.taxId)}
                      value={form.taxId}
                      onChange={(event) =>
                        updateField("taxId", event.target.value)
                      }
                      placeholder="Ej. RFC: AQU110118AV2"
                    />
                    <InlineFieldError message={fieldErrors.taxId} />
                  </div>
                </div>
              </section>

              <section className="configuration-card">
                <h4>Direccion</h4>
                <div className="configuration-form-grid">
                  <div className="field-group configuration-grid-span-full">
                    <label>
                      Direccion principal{" "}
                      <span className="required-mark">*</span>
                    </label>
                    <input
                      type="text"
                      className={getFieldClassName(fieldErrors.addressLine1)}
                      value={form.addressLine1}
                      onChange={(event) =>
                        updateField("addressLine1", event.target.value)
                      }
                      placeholder="Calle, numero y colonia"
                    />
                    <InlineFieldError message={fieldErrors.addressLine1} />
                  </div>
                  <div className="field-group configuration-grid-span-full">
                    <label>Direccion complementaria</label>
                    <input
                      type="text"
                      value={form.addressLine2}
                      onChange={(event) =>
                        updateField("addressLine2", event.target.value)
                      }
                      placeholder="Piso, oficina, referencia"
                    />
                  </div>
                  <div className="field-group">
                    <label>
                      Ciudad <span className="required-mark">*</span>
                    </label>
                    <input
                      type="text"
                      className={getFieldClassName(fieldErrors.city)}
                      value={form.city}
                      onChange={(event) =>
                        updateField("city", event.target.value)
                      }
                    />
                    <InlineFieldError message={fieldErrors.city} />
                  </div>
                  <div className="field-group">
                    <label>
                      Estado o region <span className="required-mark">*</span>
                    </label>
                    <input
                      type="text"
                      className={getFieldClassName(fieldErrors.stateRegion)}
                      value={form.stateRegion}
                      onChange={(event) =>
                        updateField("stateRegion", event.target.value)
                      }
                    />
                    <InlineFieldError message={fieldErrors.stateRegion} />
                  </div>
                  <div className="field-group">
                    <label>
                      Pais <span className="required-mark">*</span>
                    </label>
                    <select
                      className={getFieldClassName(fieldErrors.countryId)}
                      value={form.countryId}
                      onChange={(event) =>
                        updateField("countryId", event.target.value)
                      }
                    >
                      <option value="">Selecciona pais</option>
                      {countries.map((country) => (
                        <option key={country.id} value={country.id}>
                          {country.name}
                        </option>
                      ))}
                    </select>
                    <InlineFieldError message={fieldErrors.countryId} />
                  </div>
                  <div className="field-group">
                    <label>
                      Codigo postal <span className="required-mark">*</span>
                    </label>
                    <input
                      type="text"
                      className={getFieldClassName(fieldErrors.postalCode)}
                      value={form.postalCode}
                      onChange={(event) =>
                        updateField("postalCode", event.target.value)
                      }
                    />
                    <InlineFieldError message={fieldErrors.postalCode} />
                  </div>
                </div>
              </section>

              <section className="configuration-card">
                <h4>Contacto institucional</h4>
                <div className="configuration-form-grid">
                  <div className="field-group">
                    <label>Correo institucional</label>
                    <input
                      type="email"
                      className={getFieldClassName(fieldErrors.email)}
                      value={form.email}
                      onChange={(event) =>
                        updateField("email", event.target.value)
                      }
                      placeholder="contacto@empresa.com"
                    />
                    <InlineFieldError message={fieldErrors.email} />
                  </div>
                  <div className="field-group">
                    <label>Telefono institucional</label>
                    <input
                      type="text"
                      value={form.phone}
                      onChange={(event) =>
                        updateField("phone", event.target.value)
                      }
                      placeholder="+52 55 1234 5678"
                    />
                  </div>
                  <div className="field-group configuration-grid-span-full">
                    <label>Sitio web</label>
                    <input
                      type="url"
                      className={getFieldClassName(fieldErrors.website)}
                      value={form.website}
                      onChange={(event) =>
                        updateField("website", event.target.value)
                      }
                      placeholder="https://www.empresa.com"
                    />
                    <InlineFieldError message={fieldErrors.website} />
                  </div>
                </div>
              </section>
            </div>
          ) : null}

          {activeSection === "global" ? (
            <div className="configuration-section-stack">
              <WorkspacePlaybookCard
                items={workspacePlaybooks}
                activatingVersionId={activatingWorkspaceVersionId}
                onActivate={activateWorkspacePlaybook}
              />

              <WorkspacePlaybookEditor
                playbook={workspacePlaybookDetail}
                savingKey={savingWorkspacePlaybookKey}
                onSaveStage={updateWorkspacePlaybookStage}
                onSaveCriterion={updateWorkspacePlaybookCriterion}
              />

              <section className="configuration-card">
                <div className="configuration-card-heading">
                  <div>
                    <h4>Resumen institucional activo</h4>
                    <p>
                      Vista consolidada del perfil que hoy consume la
                      aplicacion.
                    </p>
                  </div>
                  <span className="configuration-inline-pill">
                    {formatCompletionPercent(
                      requiredCompleted,
                      requiredFieldItems.length,
                    )}
                    %
                  </span>
                </div>

                <div className="configuration-metrics-grid">
                  <article className="configuration-metric-card">
                    <strong>
                      {formatCompletionLabel(
                        requiredCompleted,
                        requiredFieldItems.length,
                      )}
                    </strong>
                    <span>Campos obligatorios</span>
                  </article>
                  <article className="configuration-metric-card">
                    <strong>
                      {formatCompletionLabel(
                        optionalCompleted,
                        optionalFieldItems.length,
                      )}
                    </strong>
                    <span>Campos complementarios</span>
                  </article>
                  <article className="configuration-metric-card">
                    <strong>{auditEntries.length}</strong>
                    <span>Eventos recientes en auditoria</span>
                  </article>
                </div>

                <ConfigurationSummaryList items={summaryItems} />
              </section>

              <ConfigurationChecklist
                title="Cobertura minima requerida"
                description="Estos datos sostienen la identidad institucional y el branding documental compartido."
                items={requiredFieldItems}
              />

              <ConfigurationChecklist
                title="Cobertura complementaria"
                description="Estos campos mejoran el contexto operativo y la presentacion institucional."
                items={optionalFieldItems}
              />

              <ConfigurationBrandingPreview
                logoUrl={form.logoUrl}
                legalName={form.legalName}
                taxId={form.taxId}
                lines={brandingLines}
                email={form.email}
                phone={form.phone}
              />
            </div>
          ) : null}

          {activeSection === "modules" ? (
            <div className="configuration-section-stack">
              <section className="configuration-card">
                <div className="configuration-card-heading">
                  <div>
                    <h4>Impacto operativo por modulo</h4>
                    <p>
                      Esta configuracion ya tiene consumidores claros y deja
                      visible su alcance real.
                    </p>
                  </div>
                </div>
              </section>

              <ConfigurationModuleCards
                items={moduleItems}
                onOpenAudit={() => changeSection("audit")}
              />
            </div>
          ) : null}

          {activeSection === "audit" ? (
            <ConfigurationAuditList
              entries={auditEntries}
              formatDateTime={formatDateTime}
              summarizeChangedFields={summarizeChangedFields}
            />
          ) : null}
        </div>
      </div>

      {isDirty ? (
        <div className="configuration-bottom-bar">
          <span>Tienes cambios sin guardar</span>
          <div className="configuration-bottom-bar-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={discardChanges}
              disabled={saving}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={saveCompanyProfile}
              disabled={saving || !canSave}
            >
              {saving ? "Guardando..." : "Guardar cambios"}
            </button>
          </div>
        </div>
      ) : null}

      {error ? <div className="toast toast-error">{error}</div> : null}
      {success ? <div className="toast toast-success">{success}</div> : null}
    </section>
  );
}
