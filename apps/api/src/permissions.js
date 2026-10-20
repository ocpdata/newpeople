import { query, withTransaction } from "./db.js";

const CORE_PERMISSIONS = [
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
    description: "Ver modulo de herramientas administrativas",
  },
  {
    code: "herramientas.update",
    module: "herramientas",
    action: "update",
    description:
      "Ejecutar acciones correctivas en herramientas administrativas",
  },
  {
    code: "herramientas.admin",
    module: "herramientas",
    action: "admin",
    description: "Administrar herramientas operativas de alto impacto",
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
    description: "Ver el modulo Aceptar Pedido y su flujo operativo",
  },
  {
    code: "aceptar_pedido.procesamiento.update",
    module: "aceptar_pedido",
    action: "procesamiento_update",
    description: "Actualizar etapas y documentos del modulo Aceptar Pedido",
  },
  {
    code: "aceptar_pedido.procesamiento.ia",
    module: "aceptar_pedido",
    action: "procesamiento_ia",
    description: "Generar contenido IA dentro del modulo Aceptar Pedido",
  },
  {
    code: "aceptar_pedido.procesamiento.convocar",
    module: "aceptar_pedido",
    action: "procesamiento_convocar",
    description: "Enviar convocatorias y notificaciones desde Aceptar Pedido",
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
    description: "Ver su propio credito y consumo de IA",
  },
  {
    code: "ia.budget.read_all",
    module: "ia",
    action: "budget_read_all",
    description: "Ver credito y consumo de IA de todos los usuarios",
  },
  {
    code: "ia.budget.manage",
    module: "ia",
    action: "budget_manage",
    description: "Gestionar creditos y politicas de consumo de IA",
  },
  {
    code: "ia.usage.read_all",
    module: "ia",
    action: "usage_read_all",
    description: "Ver reportes agregados de uso de IA",
  },
];

const PERMISSION_DESCRIPTION_OVERRIDES = [
  {
    code: "oportunidades.read",
    description:
      "Consultar el listado y los datos de oportunidades de cuentas de las que sea propietario. No concede creación ni edición. Para consultar oportunidades de todas las cuentas necesita además oportunidades.read_all.",
  },
  {
    code: "oportunidades.read_all",
    description:
      "Acceder a oportunidades de todas las cuentas y a cuentas y contactos ajenos en catálogos relacionados. Consultar requiere oportunidades.read. Amplía el alcance de las operaciones autorizadas; no concede creación ni edición por sí solo.",
  },
  {
    code: "oportunidades.request",
    description:
      "Solicitar el alta de oportunidades como Pendientes de activación. Requiere habilitar el flujo de pendientes, salvo si tiene oportunidades.read_all. No permite activarlas; con oportunidades.create se crean activadas.",
  },
  {
    code: "oportunidades.create",
    description:
      "Crear oportunidades directamente Activadas, sujetas a las validaciones del sistema. Junto con oportunidades.update, habilita cambios de activación según las reglas del flujo. No permite editar oportunidades ganadas por sí solo.",
  },
  {
    code: "oportunidades.update",
    description:
      "Editar oportunidades accesibles y operar su flujo comercial, sujeto a validaciones y reglas de cierre. Cambiar la activación requiere oportunidades.create; editar Ganadas requiere oportunidades.update_won. No permite cambiar etapas de cerradas.",
  },
  {
    code: "oportunidades.update_won",
    description:
      "Editar campos de oportunidades Ganadas junto con oportunidades.update. No reabre la oportunidad ni permite cambiar su etapa o estado comercial. Solo aplica a oportunidades a las que tenga acceso.",
  },
  {
    code: "oportunidades.bypass_stage_validation",
    description:
      "Avanzar manualmente a la siguiente etapa sin la validación normal, indicando un motivo que queda en auditoría. Solo en oportunidades accesibles y no cerradas. No concede edición general ni acceso global.",
  },
  {
    code: "oportunidades.bypass_demostracion_validation",
    description:
      "Avanzar manualmente sin la validación normal solo desde Demostración, indicando un motivo que queda en auditoría. Solo en oportunidades accesibles y no cerradas. No habilita excepciones en otras etapas ni concede edición general.",
  },
  {
    code: "cuentas.read",
    description:
      "Consultar el listado y los datos de las cuentas de las que el usuario es propietario. No permite crearlas ni editarlas. Para consultar todas las cuentas necesita además cuentas.read_all.",
  },
  {
    code: "cuentas.read_all",
    description:
      "Acceder a todas las cuentas, aunque no sea propietario. La consulta requiere cuentas.read; combinado con cuentas.update, amplía la edición a todas las cuentas. No concede creación, edición ni asignación de propietarios por sí solo.",
  },
  {
    code: "cuentas.request",
    description:
      "Solicitar aprobación del alta de cuentas. Las registra como Pendientes de activación para revisión por un usuario autorizado. Requiere habilitar el flujo de cuentas pendientes; no permite activarlas. Con cuentas.create, se crean activadas.",
  },
  {
    code: "cuentas.create",
    description:
      "Crear cuentas directamente activadas, sin aprobación manual y sujetas a las validaciones del sistema. Junto con cuentas.update, permite activar, desactivar o marcar cuentas como pendientes cuando el flujo esté habilitado.",
  },
  {
    code: "cuentas.update",
    description:
      "Editar los datos de cuentas a las que tenga acceso. No permite crearlas. Cambiar su activación requiere además cuentas.create; cambiar sus propietarios requiere cuentas.assign_owners_any.",
  },
  {
    code: "cuentas.assign_owners_any",
    description:
      "Elegir propietarios al crear o editar cuentas. Requiere permiso de creación o cuentas.update, respectivamente. Sin este permiso, la cuenta nueva se asigna al creador y la edición conserva los propietarios. No concede acceso a cuentas ajenas.",
  },
  {
    code: "contactos.request",
    description:
      "Solicitar aprobación manual de nuevos contactos cuando no se use IA. Registra sus datos como Pendientes de activación para revisión y aprobación por un usuario autorizado. Requiere habilitar el flujo de pendientes; no permite activarlos por sí solo.",
  },
  {
    code: "contactos.read",
    description:
      "Consultar contactos de sus cuentas. Permite ver el listado y los datos de contactos asociados a cuentas de las que el usuario es propietario. No permite crearlos ni modificarlos.",
  },
  {
    code: "contactos.read_all",
    description:
      "Acceder a contactos de todas las cuentas. Amplía el alcance más allá de las cuentas propias. Para consultarlos necesita también contactos.read; combinado con permisos de creación o edición, amplía también el alcance de esas operaciones.",
  },
  {
    code: "contactos.create",
    description:
      "Crear contactos activos sin aprobación manual, sujetos a validaciones de datos y duplicados. Junto con contactos.update, permite activar, desactivar o marcar contactos como pendientes, según las reglas del sistema.",
  },
  {
    code: "contactos.update",
    description:
      "Editar los datos de contactos a los que tenga acceso. No permite crear contactos ni cambiar su estado de activación por sí solo; para cambiar ese estado necesita además contactos.create.",
  },
  {
    code: "cotizaciones.operacion",
    description:
      "Para vendedores. Permite crear y preparar cotizaciones, solicitar aprobacion, enviarlas y registrar su resultado comercial segun el estado. La aprobacion requiere un permiso adicional.",
  },
  {
    code: "cotizaciones.ingreso",
    description:
      "Para logistica. Permite aceptar cotizaciones ganadas o devolverlas a borrador. Tambien permite editar borradores, solicitar aprobacion y marcar cotizaciones aprobadas como ganadas.",
  },
  {
    code: "cotizaciones.revision",
    description:
      "Para responsables de aprobar cotizaciones. Permite revisar, corregir y rechazar cotizaciones en aprobacion. Para aprobarlas se necesita ademas el permiso de aprobacion humana o con IA.",
  },
  {
    code: "cotizaciones.aprobacion_humana",
    description:
      "Aprobar cotizaciones sin usar IA en los estados habilitados para aprobacion. La aprobacion sigue sujeta a las validaciones del sistema.",
  },
  {
    code: "cotizaciones.aprobacion_ia",
    description:
      "Ejecutar la aprobacion de cotizaciones con IA en los estados habilitados. La aprobacion depende de las validaciones y del resultado del proceso.",
  },
  {
    code: "cotizaciones.administracion",
    description:
      "Administrar cotizaciones, acceder a versiones historicas y editar o crear versiones incluso en estados aprobada, enviada, ganada y aceptada. Habilita todas las acciones del modulo, sujetas a las validaciones de cada operacion.",
  },
  {
    code: "aceptar_pedido.procesamiento.read",
    description: "Ver el modulo Aceptar Pedido y su flujo operativo",
  },
  {
    code: "aceptar_pedido.procesamiento.update",
    description: "Actualizar etapas y documentos del modulo Aceptar Pedido",
  },
  {
    code: "aceptar_pedido.procesamiento.ia",
    description: "Generar contenido IA dentro del modulo Aceptar Pedido",
  },
  {
    code: "aceptar_pedido.procesamiento.convocar",
    description: "Enviar convocatorias y notificaciones desde Aceptar Pedido",
  },
  {
    code: "cotizaciones.externo",
    description:
      "Para clientes que desean consultar sus cotizaciones. Permite ver las cotizaciones a las que tengan acceso en estado aprobada, enviada, ganada o aceptada, sin modificarlas ni cambiar su estado.",
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
    description: "Ver su propio credito y consumo de IA",
  },
  {
    code: "ia.budget.read_all",
    description: "Ver credito y consumo de IA de todos los usuarios",
  },
  {
    code: "ia.budget.manage",
    description: "Gestionar creditos y politicas de consumo de IA",
  },
  {
    code: "ia.usage.read_all",
    description: "Ver reportes agregados de uso de IA",
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
