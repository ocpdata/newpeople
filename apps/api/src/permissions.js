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
    description: "Solicitar creacion de cuentas",
  },
  {
    code: "cuentas.assign_owners_any",
    module: "cuentas",
    action: "assign_owners_any",
    description: "Asignar cualquier propietario en cuentas",
  },
  {
    code: "contactos.request",
    module: "contactos",
    action: "request",
    description: "Solicitar creacion de contactos",
  },
  {
    code: "oportunidades.request",
    module: "oportunidades",
    action: "request",
    description: "Solicitar creacion de oportunidades",
  },
  {
    code: "oportunidades.bypass_stage_validation",
    module: "oportunidades",
    action: "bypass_stage_validation",
    description: "Bypasear la validacion de etapa en el proceso comercial",
  },
  {
    code: "oportunidades.bypass_demostracion_validation",
    module: "oportunidades",
    action: "bypass_demostracion_validation",
    description: "Bypasear la validacion de etapa solo en Demostracion",
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
    description: "Aprobar cotizaciones sin IA",
  },
  {
    code: "cotizaciones.aprobacion_ia",
    module: "cotizaciones",
    action: "aprobacion_ia",
    description: "Aprobar cotizaciones con IA",
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
    code: "cotizaciones.operacion",
    description: "Operar cotizaciones (crear, editar y gestionar en trabajo)",
  },
  {
    code: "cotizaciones.ingreso",
    description: "Solicitar aprobacion de cotizaciones (sin aprobar)",
  },
  {
    code: "cotizaciones.revision",
    description: "Revisar cotizaciones (validar informacion sin aprobar)",
  },
  {
    code: "cotizaciones.aprobacion_humana",
    description: "Aprobar cotizaciones sin IA",
  },
  {
    code: "cotizaciones.aprobacion_ia",
    description: "Aprobar cotizaciones con IA",
  },
  {
    code: "cotizaciones.administracion",
    description: "Administrar cotizaciones (control total y excepciones)",
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
      "Acceso externo a cotizaciones (consulta o colaboracion limitada)",
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
