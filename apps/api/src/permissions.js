import { query, withTransaction } from "./db.js";

const CORE_PERMISSIONS = [
  {
    code: "reportes.access", module: "reportes", action: "access",
    description: "Entrar al modulo Reportes. No habilita ningun reporte por si solo.",
  },
  {
    code: "reportes.oportunidades_cotizaciones.read", module: "reportes", action: "oportunidades_cotizaciones.read",
    description: "Consultar Oportunidades y cotizaciones de las oportunidades donde es el vendedor asignado actual. Incluye acceso al modulo y al detalle completo del reporte, sin permisos de otros modulos.",
  },
  {
    code: "reportes.oportunidades_cotizaciones.read_all", module: "reportes", action: "oportunidades_cotizaciones.read_all",
    description: "Consultar Oportunidades y cotizaciones de todos los usuarios. Incluye acceso al modulo y al reporte completo; no requiere el permiso de datos propios ni permisos de otros modulos.",
  },
  {
    code: "reportes.rentabilidad.read", module: "reportes", action: "rentabilidad.read",
    description: "Consultar Rentabilidad de oportunidades ganadas donde es el vendedor asignado actual, incluidos costos, utilidad y margen. Incluye acceso al modulo; no requiere permisos de otros modulos.",
  },
  {
    code: "reportes.rentabilidad.read_all", module: "reportes", action: "rentabilidad.read_all",
    description: "Consultar Rentabilidad de oportunidades ganadas de todos los usuarios, incluidos costos, utilidad y margen. Incluye acceso al modulo; no requiere el permiso de datos propios ni permisos de otros modulos.",
  },
  {
    code: "configuracion.read",
    module: "configuracion",
    action: "read",
    description: "Ver configuracion general",
  },
  {
    code: "configuracion.update",
    module: "configuracion",
    action: "update",
    description: "Actualizar configuracion general",
  },
  {
    code: "documentacion_rag.access",
    module: "documentacion_rag",
    action: "access",
    description:
      "Entrar al modulo para consultar temas, documentos y su estado. No permite importar, cargar, reemplazar, clasificar ni eliminar contenido; el chatbot puede consultar documentos activos sin este permiso.",
  },
  {
    code: "documentacion_rag.manage",
    module: "documentacion_rag",
    action: "manage",
    description:
      "Gestionar temas y documentos: importar desde Pinecone Assistant, cargar o reemplazar archivos, actualizar resumen y clasificacion, eliminar documentos y habilitar o deshabilitar temas. Incluye acceso de consulta.",
  },
  {
    code: "cuentas.request",
    module: "cuentas",
    action: "request",
    description:
      "Solicitar aprobación del alta de cuentas. Las registra como Pendientes de activación para revisión por un usuario autorizado. Requiere habilitar el flujo de cuentas pendientes; no permite activarlas. Con cuentas.create, se crean activadas.",
  },
  {
    code: "cuentas.assign_owners_any",
    module: "cuentas",
    action: "assign_owners_any",
    description:
      "Elegir propietarios al crear o editar cuentas. Requiere permiso de creación o cuentas.update, respectivamente. Sin este permiso, la cuenta nueva se asigna al creador y la edición conserva los propietarios. No concede acceso a cuentas ajenas.",
  },
  {
    code: "contactos.request",
    module: "contactos",
    action: "request",
    description:
      "Solicitar aprobación manual de nuevos contactos cuando no se use IA. Registra sus datos como Pendientes de activación para revisión y aprobación por un usuario autorizado. Requiere habilitar el flujo de pendientes; no permite activarlos por sí solo.",
  },
  {
    code: "oportunidades.request",
    module: "oportunidades",
    action: "request",
    description:
      "Solicitar el alta de oportunidades como Pendientes de activación. Requiere habilitar el flujo de pendientes, salvo si tiene oportunidades.read_all. No permite activarlas; con oportunidades.create se crean activadas.",
  },
  {
    code: "oportunidades.change_closed_status",
    module: "oportunidades",
    action: "change_closed_status",
    description:
      "Corregir el estado comercial o reabrir oportunidades cerradas accesibles, con motivo y auditoría. Requiere oportunidades.update; no concede edición general de Ganadas ni cambios de etapa.",
  },
  {
    code: "oportunidades.update_won",
    module: "oportunidades",
    action: "update_won",
    description:
      "Editar campos de oportunidades Ganadas junto con oportunidades.update. No reabre la oportunidad ni permite cambiar su etapa o estado comercial. Solo aplica a oportunidades a las que tenga acceso.",
  },
  {
    code: "oportunidades.bypass_stage_validation",
    module: "oportunidades",
    action: "bypass_stage_validation",
    description:
      "Avanzar manualmente a la siguiente etapa sin la validación normal, indicando un motivo que queda en auditoría. Solo en oportunidades accesibles y no cerradas. No concede edición general ni acceso global.",
  },
  {
    code: "oportunidades.bypass_demostracion_validation",
    module: "oportunidades",
    action: "bypass_demostracion_validation",
    description:
      "Avanzar manualmente sin la validación normal solo desde Demostración, indicando un motivo que queda en auditoría. Solo en oportunidades accesibles y no cerradas. No habilita excepciones en otras etapas ni concede edición general.",
  },
  {
    code: "mi_coach.access",
    module: "mi_coach",
    action: "access",
    description: "Entrar al módulo Mi Coach",
  },
  {
    code: "mi_coach.use",
    module: "mi_coach",
    action: "use",
    description: "Ver el resumen y usar el espacio Coach",
  },
  {
    code: "mi_coach.execute",
    module: "mi_coach",
    action: "execute",
    description: "Confirmar operaciones propuestas por Mi Coach",
  },
  {
    code: "mi_coach.admin",
    module: "mi_coach",
    action: "admin",
    description: "Administrar gobierno, limites y configuracion de Mi Coach",
  },
  {
    code: "mi_coach.chat_diagnostics",
    module: "mi_coach",
    action: "chat_diagnostics",
    description: "Revisar conversaciones de otros usuarios para soporte",
  },
  {
    code: "mi_coach.evaluations_read",
    module: "mi_coach",
    action: "evaluations_read",
    description: "Consultar catálogo y evaluaciones propias del chat",
  },
  {
    code: "mi_coach.evaluations_execute",
    module: "mi_coach",
    action: "evaluations_execute",
    description: "Ejecutar evaluaciones del chat con IA real en esta instancia",
  },
  {
    code: "mi_coach.evaluations_write",
    module: "mi_coach",
    action: "evaluations_write",
    description: "Confirmar acciones de evaluación sobre registros autorizados",
  },
  {
    code: "fuentes_externas.execute",
    module: "fuentes_externas",
    action: "execute",
    description: "Ejecutar investigaciones con fuentes publicas externas",
  },
  {
    code: "herramientas.read",
    module: "herramientas",
    action: "read",
    description:
      "Consultar el catalogo, revisar incidencias y ver grupos duplicados en listas de precios, su detalle y referencias antes de decidir una accion.",
  },
  {
    code: "herramientas.update",
    module: "herramientas",
    action: "update",
    description:
      "Consolidar grupos de productos duplicados en listas de precios, archivando duplicados o eliminandolos cuando la validacion lo permite. Las acciones quedan auditadas.",
  },
  {
    code: "herramientas.admin",
    module: "herramientas",
    action: "admin",
    description:
      "Permiso previsto para acciones administrativas avanzadas. Actualmente las herramientas disponibles se controlan con herramientas.read y herramientas.update; este permiso no habilita acciones adicionales.",
  },
  {
    code: "pruebas.read",
    module: "pruebas",
    action: "read",
    description: "Ver ejecuciones de pruebas de seguridad",
  },
  {
    code: "pruebas.execute",
    module: "pruebas",
    action: "execute",
    description: "Ejecutar perfiles de pruebas de seguridad",
  },
  {
    code: "pruebas.admin",
    module: "pruebas",
    action: "admin",
    description: "Ejecutar pruebas de seguridad con integraciones externas",
  },
  {
    code: "cotizaciones.aprobacion_humana",
    module: "cotizaciones",
    action: "aprobacion_humana",
    description:
      "Aprobar cotizaciones sin usar IA en los estados habilitados para aprobacion. La aprobacion sigue sujeta a las validaciones del sistema.",
  },
  {
    code: "cotizaciones.aprobacion_ia",
    module: "cotizaciones",
    action: "aprobacion_ia",
    description:
      "Ejecutar la aprobacion de cotizaciones con IA en los estados habilitados. La aprobacion depende de las validaciones y del resultado del proceso.",
  },
  {
    code: "aceptar_pedido.procesamiento.read",
    module: "aceptar_pedido",
    action: "procesamiento_read",
    description:
      "Consultar las etapas, el estado y los documentos del procesamiento posterior a la aceptación de una cotización. No permite editar información, generar contenido con IA ni enviar convocatorias.",
  },
  {
    code: "aceptar_pedido.procesamiento.update",
    module: "aceptar_pedido",
    action: "procesamiento_update",
    description:
      "Editar la información operativa de las etapas y gestionar sus documentos y evidencias para dar seguimiento al pedido aceptado.",
  },
  {
    code: "aceptar_pedido.procesamiento.ia",
    module: "aceptar_pedido",
    action: "procesamiento_ia",
    description:
      "Generar o volver a generar resúmenes con IA a partir de las evidencias del procesamiento, cuando haya contenido compatible disponible.",
  },
  {
    code: "aceptar_pedido.procesamiento.convocar",
    module: "aceptar_pedido",
    action: "procesamiento_convocar",
    description:
      "Enviar convocatorias y notificaciones de kick off asociadas al procesamiento del pedido. No concede permisos para editar las etapas ni generar resúmenes con IA.",
  },
  {
    code: "propuestas.read",
    module: "propuestas",
    action: "read",
    description: "Ver propuestas",
  },
  {
    code: "propuestas.create",
    module: "propuestas",
    action: "create",
    description: "Crear propuestas",
  },
  {
    code: "propuestas.update",
    module: "propuestas",
    action: "update",
    description: "Actualizar propuestas",
  },
  {
    code: "ia.budget.read_self",
    module: "ia",
    action: "budget_read_self",
    description:
      "Consultar el credito disponible y el consumo de IA asociados al propio usuario",
  },
  {
    code: "ia.budget.read_all",
    module: "ia",
    action: "budget_read_all",
    description:
      "Consultar saldos, consumo y detalle de uso de IA de cualquier usuario",
  },
  {
    code: "ia.budget.manage",
    module: "ia",
    action: "budget_manage",
    description:
      "Configurar limites, politicas de consumo, asignaciones por usuario y tarifas de servicios de IA",
  },
  {
    code: "ia.usage.read_all",
    module: "ia",
    action: "usage_read_all",
    description:
      "Consultar reportes agregados de consumo de IA por usuario, proveedor u otros criterios disponibles",
  },
];

const PERMISSION_DESCRIPTION_OVERRIDES = [
  {
    code: "audit.read",
    description:
      "Consultar eventos de seguridad, administración y operaciones registrados en la bitácora global, aplicar filtros y revisar sus detalles y cambios. Es un permiso de solo lectura; no permite modificar ni eliminar registros.",
  },
  {
    code: "documentacion_rag.access",
    description:
      "Entrar al modulo para consultar temas, documentos y su estado. No permite importar, cargar, reemplazar, clasificar ni eliminar contenido; el chatbot puede consultar documentos activos sin este permiso.",
  },
  {
    code: "documentacion_rag.manage",
    description:
      "Gestionar temas y documentos: importar desde Pinecone Assistant, cargar o reemplazar archivos, actualizar resumen y clasificacion, eliminar documentos y habilitar o deshabilitar temas. Incluye acceso de consulta.",
  },
  {
    code: "herramientas.read",
    description:
      "Consultar el catalogo, revisar incidencias y ver grupos duplicados en listas de precios, su detalle y referencias antes de decidir una accion.",
  },
  {
    code: "herramientas.update",
    description:
      "Consolidar grupos de productos duplicados en listas de precios, archivando duplicados o eliminandolos cuando la validacion lo permite. Las acciones quedan auditadas.",
  },
  {
    code: "herramientas.admin",
    description:
      "Permiso previsto para acciones administrativas avanzadas. Actualmente las herramientas disponibles se controlan con herramientas.read y herramientas.update; este permiso no habilita acciones adicionales.",
  },
  {
    code: "oportunidades.read",
    description:
      "Consultar el listado, los datos y las notas de las oportunidades de cuentas de las que sea propietario. No concede creación ni edición. Para consultar oportunidades de todas las cuentas necesita además oportunidades.read_all.",
  },
  {
    code: "oportunidades.read_all",
    description:
      "Ampliar a todas las cuentas el alcance de consulta de oportunidades y de los registros relacionados. Requiere oportunidades.read; no concede creación ni edición por sí solo.",
  },
  {
    code: "oportunidades.request",
    description:
      "Registrar solicitudes de alta de oportunidades como Pendientes de activación para revisión. No las activa; su disponibilidad depende de la configuración del flujo de pendientes.",
  },
  {
    code: "oportunidades.create",
    description:
      "Crear oportunidades activadas, sujeto a las validaciones del sistema. Junto con oportunidades.update permite los cambios de activación previstos; no concede por sí solo la edición de oportunidades ganadas.",
  },
  {
    code: "oportunidades.update",
    description:
      "Editar oportunidades accesibles, agregar notas y operar su flujo comercial según sus validaciones. Cambiar la activación requiere oportunidades.create; editar Ganadas requiere oportunidades.update_won. No permite cambiar etapas de oportunidades cerradas.",
  },
  {
    code: "oportunidades.update_won",
    description:
      "Editar campos de oportunidades Ganadas junto con oportunidades.update. No las reabre ni permite cambiar su etapa o estado comercial; solo aplica a oportunidades accesibles.",
  },
  {
    code: "oportunidades.bypass_stage_validation",
    description:
      "Avanzar manualmente a la siguiente etapa sin completar la validación habitual, dejando un motivo en auditoría. Solo aplica a oportunidades accesibles y no cerradas; no concede edición general.",
  },
  {
    code: "oportunidades.bypass_demostracion_validation",
    description:
      "Avanzar manualmente desde Demostración sin completar su validación habitual, dejando un motivo en auditoría. No habilita excepciones en otras etapas ni concede edición general.",
  },
  {
    code: "cuentas.read",
    description:
      "Consultar el listado y los datos de las cuentas de las que eres propietario. Para ampliar el alcance a todas las cuentas se requiere además cuentas.read_all. No permite crear ni editar cuentas.",
  },
  {
    code: "cuentas.read_all",
    description:
      "Ampliar a todas las cuentas el alcance de cuentas.read. Para consultar se requiere también cuentas.read; junto con cuentas.update permite editar cuentas ajenas. No concede creación ni asignación de propietarios.",
  },
  {
    code: "cuentas.request",
    description:
      "Registrar nuevas cuentas como Pendientes de activación para revisión, si el flujo de pendientes está habilitado. No permite activarlas; si también tienes cuentas.create, se crean activadas.",
  },
  {
    code: "cuentas.create",
    description:
      "Crear cuentas directamente activadas, sujetas a la validación de datos y duplicados. Junto con cuentas.update permite cambiar el estado de activación; elegir otros propietarios requiere además cuentas.assign_owners_any.",
  },
  {
    code: "cuentas.update",
    description:
      "Editar los datos de cuentas a las que tienes acceso. No permite crearlas; cambiar su estado requiere también cuentas.create y elegir propietarios requiere cuentas.assign_owners_any. cuentas.read_all amplía el alcance de edición a todas.",
  },
  {
    code: "cuentas.assign_owners_any",
    description:
      "Elegir propietarios al crear una cuenta (con cuentas.create o cuentas.request) o editarla (con cuentas.update). Sin este permiso, la cuenta nueva se asigna a quien la crea y la edición conserva sus propietarios. No amplía el acceso a otras cuentas.",
  },
  {
    code: "contactos.request",
    description:
      "Registrar contactos nuevos como Pendientes de activación para revisión, si el flujo de pendientes está habilitado. No permite activarlos; si también tienes contactos.create, se crean activados.",
  },
  {
    code: "contactos.read",
    description:
      "Ver los contactos asociados a cuentas de las que eres propietario. Para ampliar la consulta a contactos de otras cuentas se requiere además contactos.read_all. No permite crear ni editar contactos.",
  },
  {
    code: "contactos.read_all",
    description:
      "Ampliar a todas las cuentas el alcance de contactos.read. Requiere también contactos.read; junto con permisos de creación o edición, permite operar contactos de otras cuentas. No concede creación ni edición por sí solo.",
  },
  {
    code: "contactos.create",
    description:
      "Crear contactos activos asociados a una cuenta accesible, sujetos a validaciones y revisión de posibles duplicados. Junto con contactos.update permite cambiar el estado; elegir otra cuenta requiere acceso a ella.",
  },
  {
    code: "contactos.update",
    description:
      "Actualizar los datos y la información relacional de contactos dentro de tu alcance. No permite crearlos; cambiar su estado de activación requiere también contactos.create. contactos.read_all amplía el alcance a contactos de todas las cuentas.",
  },
  {
    code: "cotizaciones.operacion",
    description:
      "Crear y preparar cotizaciones, solicitar su aprobacion, enviarlas y registrar su resultado comercial segun el estado. Aprobarlas requiere ademas autorizacion para aprobar sin IA o con IA.",
  },
  {
    code: "cotizaciones.ingreso",
    description:
      "Gestionar el ingreso de cotizaciones: editar borradores, solicitar aprobacion, registrar como ganada una cotizacion aprobada o devolver una ganada a borrador, segun las reglas del flujo.",
  },
  {
    code: "cotizaciones.revision",
    description:
      "Revisar, corregir y rechazar cotizaciones en el flujo de aprobacion. Este permiso no aprueba por si solo: se requiere ademas autorizacion para aprobar sin IA o con IA.",
  },
  {
    code: "cotizaciones.aprobacion_humana",
    description:
      "Aprobar manualmente cotizaciones en estados habilitados. La accion sigue sujeta a las reglas de transicion y validaciones comerciales.",
  },
  {
    code: "cotizaciones.aprobacion_ia",
    description:
      "Ejecutar la aprobacion asistida por IA en los estados habilitados. La accion depende de las reglas de transicion, las validaciones y el resultado del analisis.",
  },
  {
    code: "cotizaciones.administracion",
    description:
      "Acceder a todas las acciones y al historial de versiones; crear o editar versiones incluso en estados avanzados. Es un permiso amplio, sujeto a las validaciones del flujo.",
  },
  {
    code: "aceptar_pedido.procesamiento.read",
    description:
      "Consultar las etapas, el estado y los documentos del procesamiento posterior a la aceptación de una cotización. No permite editar información, generar contenido con IA ni enviar convocatorias.",
  },
  {
    code: "aceptar_pedido.procesamiento.update",
    description:
      "Editar la información operativa de las etapas y gestionar sus documentos y evidencias para dar seguimiento al pedido aceptado.",
  },
  {
    code: "aceptar_pedido.procesamiento.ia",
    description:
      "Generar o volver a generar resúmenes con IA a partir de las evidencias del procesamiento, cuando haya contenido compatible disponible.",
  },
  {
    code: "aceptar_pedido.procesamiento.convocar",
    description:
      "Enviar convocatorias y notificaciones de kick off asociadas al procesamiento del pedido. No concede permisos para editar las etapas ni generar resúmenes con IA.",
  },
  {
    code: "cotizaciones.externo",
    description:
      "Consultar, sin modificarlas, las cotizaciones disponibles para el cliente en estados aprobada, enviada, ganada o aceptada.",
  },
  {
    code: "propuestas.read",
    description: "Ver propuestas",
  },
  {
    code: "propuestas.create",
    description: "Crear propuestas",
  },
  {
    code: "propuestas.update",
    description: "Actualizar propuestas",
  },
  {
    code: "ia.budget.read_self",
    description:
      "Consultar el credito disponible y el consumo de IA asociados al propio usuario",
  },
  {
    code: "ia.budget.read_all",
    description:
      "Consultar saldos, consumo y detalle de uso de IA de cualquier usuario",
  },
  {
    code: "ia.budget.manage",
    description:
      "Configurar limites, politicas de consumo, asignaciones por usuario y tarifas de servicios de IA",
  },
  {
    code: "ia.usage.read_all",
    description:
      "Consultar reportes agregados de consumo de IA por usuario, proveedor u otros criterios disponibles",
  },
];

function isDeadlockError(error) {
  return (
    String(error?.code || "").trim() === "ER_LOCK_DEADLOCK" ||
    Number(error?.errno || 0) === 1213
  );
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function ensureCorePermissions(options = {}) {
  const autoAssignRoles = Boolean(options.autoAssignRoles);
  const maxRetries = 5;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      await withTransaction(async (conn) => {
        const now = new Date();

        const [legacyDiagnosticsRows] = await conn.query(
          "SELECT id FROM permissions WHERE code = ? LIMIT 1",
          ["inteligencia_comercial.chat_diagnostics"],
        );
        const [currentDiagnosticsRows] = await conn.query(
          "SELECT id FROM permissions WHERE code = ? LIMIT 1",
          ["mi_coach.chat_diagnostics"],
        );
        if (legacyDiagnosticsRows.length && currentDiagnosticsRows.length) {
          const legacyId = Number(legacyDiagnosticsRows[0].id);
          const currentId = Number(currentDiagnosticsRows[0].id);
          await conn.query(
            `INSERT INTO role_permissions (role_id, permission_id, created_at)
             SELECT legacy.role_id, ?, ?
             FROM role_permissions legacy
             WHERE legacy.permission_id = ?
               AND NOT EXISTS (
                 SELECT 1 FROM role_permissions existing
                 WHERE existing.role_id = legacy.role_id
                   AND existing.permission_id = ?
               )`,
            [currentId, now, legacyId, currentId],
          );
          await conn.query(
            "DELETE FROM role_permissions WHERE permission_id = ?",
            [legacyId],
          );
          await conn.query("DELETE FROM permissions WHERE id = ?", [legacyId]);
        } else if (legacyDiagnosticsRows.length) {
          await conn.query(
            `UPDATE permissions
             SET code = ?, module = ?, action = ?, description = ?, updated_at = ?
             WHERE id = ?`,
            [
              "mi_coach.chat_diagnostics",
              "mi_coach",
              "chat_diagnostics",
              "Revisar conversaciones de otros usuarios para soporte",
              now,
              Number(legacyDiagnosticsRows[0].id),
            ],
          );
        }

        for (const permission of CORE_PERMISSIONS) {
          await conn.query(
            `INSERT INTO permissions (code, module, action, description, created_at, updated_at)
             SELECT ?, ?, ?, ?, ?, ?
             WHERE NOT EXISTS (
               SELECT 1 FROM permissions WHERE code = ?
             )`,
            [
              permission.code,
              permission.module,
              permission.action,
              permission.description,
              now,
              now,
              permission.code,
            ],
          );
        }

        for (const permission of PERMISSION_DESCRIPTION_OVERRIDES) {
          await conn.query(
            `UPDATE permissions
             SET description = ?, updated_at = ?
             WHERE code = ? AND IFNULL(description, '') <> ?`,
            [permission.description, now, permission.code, permission.description],
          );
        }

        if (!autoAssignRoles) {
          return;
        }

        const [adminRoles] = await conn.query(
          `SELECT id
           FROM roles
           WHERE is_system = 1 OR name = 'Administrador'`,
        );

        if (!adminRoles.length) {
          return;
        }

        const placeholders = CORE_PERMISSIONS.map(() => "?").join(", ");
        const [permissionRows] = await conn.query(
          `SELECT id
           FROM permissions
           WHERE code IN (${placeholders})`,
          CORE_PERMISSIONS.map((permission) => permission.code),
        );

        for (const role of adminRoles) {
          for (const permission of permissionRows) {
            await conn.query(
              `INSERT INTO role_permissions (role_id, permission_id, created_at)
               SELECT ?, ?, ?
               WHERE NOT EXISTS (
                 SELECT 1
                 FROM role_permissions
                 WHERE role_id = ? AND permission_id = ?
               )`,
              [role.id, permission.id, now, role.id, permission.id],
            );
          }
        }
      });

      return;
    } catch (error) {
      if (!isDeadlockError(error) || attempt === maxRetries) {
        throw error;
      }

      await wait(120 * attempt);
    }
  }
}

export async function migrateMiCoachPermissions() {
  await query(
    `CREATE TABLE IF NOT EXISTS mi_coach_permission_migrations (
      migration_key VARCHAR(120) NOT NULL PRIMARY KEY,
      applied_at DATETIME(3) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );

  await withTransaction(async (conn) => {
    const migrationKey = "mi_coach_access_model_v4";
    const [migrationResult] = await conn.query(
      `INSERT IGNORE INTO mi_coach_permission_migrations (migration_key, applied_at)
       VALUES (?, NOW(3))`,
      [migrationKey],
    );
    if (!migrationResult.affectedRows) return;

    const now = new Date();
    const transferLegacyPermission = async (legacyCode, currentCode) => {
      const [legacyRows] = await conn.query(
        "SELECT id FROM permissions WHERE code = ? LIMIT 1",
        [legacyCode],
      );
      if (!legacyRows.length) return;
      const [currentRows] = await conn.query(
        "SELECT id FROM permissions WHERE code = ? LIMIT 1",
        [currentCode],
      );
      if (!currentRows.length) {
        throw new Error(`No existe el permiso ${currentCode}`);
      }
      const legacyPermissionId = Number(legacyRows[0].id);
      const currentPermissionId = Number(currentRows[0].id);
      await conn.query(
        `INSERT INTO role_permissions (role_id, permission_id, created_at)
         SELECT legacy.role_id, ?, ?
         FROM role_permissions legacy
         WHERE legacy.permission_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM role_permissions existing
             WHERE existing.role_id = legacy.role_id
               AND existing.permission_id = ?
           )`,
        [currentPermissionId, now, legacyPermissionId, currentPermissionId],
      );
      await conn.query(
        "DELETE FROM role_permissions WHERE permission_id = ?",
        [legacyPermissionId],
      );
      await conn.query("DELETE FROM permissions WHERE id = ?", [
        legacyPermissionId,
      ]);
    };

    await transferLegacyPermission("mi_coach.chat", "mi_coach.use");
    await transferLegacyPermission(
      "inteligencia_comercial.chat",
      "inteligencia_comercial.access",
    );
    await transferLegacyPermission("prospeccion.chat", "prospeccion.access");
    await transferLegacyPermission(
      "inteligencia_comercial.chat_diagnostics",
      "mi_coach.chat_diagnostics",
    );
    await transferLegacyPermission(
      "inteligencia_comercial.admin",
      "mi_coach.admin",
    );
    await transferLegacyPermission("prospeccion.admin", "mi_coach.admin");

    const [moduleAccessRows] = await conn.query(
      "SELECT id FROM permissions WHERE code = 'mi_coach.access' LIMIT 1",
    );
    const moduleAccessPermissionId = Number(moduleAccessRows[0]?.id || 0);
    if (!moduleAccessPermissionId) {
      throw new Error("No existe el permiso mi_coach.access");
    }
    await conn.query(
      `INSERT INTO role_permissions (role_id, permission_id, created_at)
      SELECT DISTINCT existing.role_id, ?, ?
       FROM role_permissions existing
       INNER JOIN permissions permission ON permission.id = existing.permission_id
       WHERE permission.code IN (
         'mi_coach.use',
         'inteligencia_comercial.access',
         'prospeccion.access',
         'mi_coach.admin',
         'mi_coach.chat_diagnostics'
       )
         AND NOT EXISTS (
           SELECT 1 FROM role_permissions module_access
           WHERE module_access.role_id = existing.role_id
             AND module_access.permission_id = ?
         )`,
      [moduleAccessPermissionId, now, moduleAccessPermissionId],
    );

    await conn.query(
      `INSERT INTO role_permissions (role_id, permission_id, created_at)
       SELECT coach_use.role_id, chat.id, ?
       FROM permissions chat
       INNER JOIN role_permissions coach_use ON coach_use.permission_id = (
         SELECT id FROM permissions WHERE code = 'mi_coach.use' LIMIT 1
       )
      WHERE chat.code = 'inteligencia_comercial.access'
         AND EXISTS (
           SELECT 1 FROM role_permissions intelligence_read
           INNER JOIN permissions permission
             ON permission.id = intelligence_read.permission_id
           WHERE intelligence_read.role_id = coach_use.role_id
             AND permission.code = 'inteligencia_comercial.read'
         )
         AND EXISTS (
           SELECT 1 FROM role_permissions account_read
           INNER JOIN permissions permission
             ON permission.id = account_read.permission_id
           WHERE account_read.role_id = coach_use.role_id
             AND permission.code IN ('cuentas.read', 'cuentas.read_all')
         )
         AND NOT EXISTS (
           SELECT 1 FROM role_permissions existing
           WHERE existing.role_id = coach_use.role_id
             AND existing.permission_id = chat.id
         )`,
      [now],
    );

    await conn.query(
      `INSERT INTO role_permissions (role_id, permission_id, created_at)
       SELECT coach_use.role_id, chat.id, ?
       FROM permissions chat
       INNER JOIN role_permissions coach_use ON coach_use.permission_id = (
         SELECT id FROM permissions WHERE code = 'mi_coach.use' LIMIT 1
       )
      WHERE chat.code = 'prospeccion.access'
         AND EXISTS (
           SELECT 1 FROM role_permissions workspace_access
           INNER JOIN permissions permission
             ON permission.id = workspace_access.permission_id
           WHERE workspace_access.role_id = coach_use.role_id
             AND permission.code IN ('prospeccion.read', 'prospeccion.create')
         )
         AND NOT EXISTS (
           SELECT 1 FROM role_permissions existing
           WHERE existing.role_id = coach_use.role_id
             AND existing.permission_id = chat.id
         )`,
      [now],
    );

    const [coachAdminRows] = await conn.query(
      "SELECT id FROM permissions WHERE code = 'mi_coach.admin' LIMIT 1",
    );
    const coachAdminPermissionId = Number(coachAdminRows[0]?.id || 0);
    if (!coachAdminPermissionId) {
      throw new Error("No existe el permiso mi_coach.admin");
    }
    const [legacyAdminRows] = await conn.query(
      `SELECT id FROM permissions
       WHERE code IN ('inteligencia_comercial.admin', 'prospeccion.admin')`,
    );
    for (const legacyPermission of legacyAdminRows) {
      await conn.query(
        `INSERT INTO role_permissions (role_id, permission_id, created_at)
         SELECT legacy.role_id, ?, ?
         FROM role_permissions legacy
         WHERE legacy.permission_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM role_permissions existing
             WHERE existing.role_id = legacy.role_id
               AND existing.permission_id = ?
           )`,
        [
          coachAdminPermissionId,
          now,
          Number(legacyPermission.id),
          coachAdminPermissionId,
        ],
      );
      await conn.query(
        "DELETE FROM role_permissions WHERE permission_id = ?",
        [Number(legacyPermission.id)],
      );
      await conn.query("DELETE FROM permissions WHERE id = ?", [
        Number(legacyPermission.id),
      ]);
    }
  });
}
