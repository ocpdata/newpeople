import { withTransaction } from "./db.js";

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

        for (const permission of CORE_PERMISSIONS) {
          await conn.query(
            `INSERT INTO permissions (code, module, action, description, created_at, updated_at)
             SELECT ?, ?, ?, ?, ?, ?
             WHERE NOT EXISTS (
               SELECT 1
               FROM permissions
               WHERE code = ?
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
