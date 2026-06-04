import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { query } from "./db.js";

const ADMIN_FALLBACK_PERMISSIONS = [
  "configuracion.read",
  "configuracion.update",
  "herramientas.read",
  "herramientas.update",
  "herramientas.admin",
  "roles.read",
  "permissions.read",
];

export async function getUserAuthContext(userId) {
  const users = await query(
    `SELECT id, full_name, email, avatar_url, status
     FROM users
     WHERE id = ?`,
    [userId],
  );

  if (users.length === 0) return null;

  const roles = await query(
    `SELECT r.id, r.name, r.is_system
     FROM roles r
     INNER JOIN user_roles ur ON ur.role_id = r.id
     WHERE ur.user_id = ?
       AND r.is_active = 1`,
    [userId],
  );

  const permissions = await query(
    `SELECT DISTINCT p.code
     FROM permissions p
     INNER JOIN role_permissions rp ON rp.permission_id = p.id
     INNER JOIN user_roles ur ON ur.role_id = rp.role_id
     INNER JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = ?
       AND r.is_active = 1`,
    [userId],
  );

  const isAdministrator = roles.some(
    (role) => role.is_system || role.name === "Administrador",
  );

  let effectivePermissions = permissions.map((permission) => permission.code);
  if (isAdministrator) {
    effectivePermissions = Array.from(
      new Set([...effectivePermissions, ...ADMIN_FALLBACK_PERMISSIONS]),
    );
  }

  const user = users[0];
  return {
    ...user,
    roles,
    permissionSet: new Set(effectivePermissions),
  };
}

export function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: "Token requerido" });
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.auth = payload;
    return next();
  } catch {
    return res.status(401).json({ message: "Token invalido o expirado" });
  }
}

export async function loadUser(req, res, next) {
  const user = await getUserAuthContext(req.auth.sub);
  if (!user) {
    return res.status(401).json({ message: "Usuario no encontrado" });
  }
  if (user.status !== "active") {
    return res.status(403).json({ message: "Usuario inactivo" });
  }
  req.user = user;
  return next();
}

export function requirePermission(permission) {
  return (req, res, next) => {
    const hasPermission = req.user?.permissionSet?.has(permission);
    if (!hasPermission) {
      return res.status(403).json({
        message: "No autorizado",
        requiredPermission: permission,
      });
    }
    return next();
  };
}

export function requireAnyPermission(permissions) {
  return (req, res, next) => {
    const hasPermission = permissions.some((permission) =>
      req.user?.permissionSet?.has(permission),
    );

    if (!hasPermission) {
      return res.status(403).json({
        message: "No autorizado",
        requiredAnyPermission: permissions,
      });
    }

    return next();
  };
}
