import { useEffect, useMemo, useState } from "react";
import { api, getApiErrorMessage } from "../api";

function normalizeRole(role) {
  return {
    ...role,
    id: Number(role.id),
    is_system: Number(role.is_system),
    is_active: Number(role.is_active),
  };
}

function normalizePermission(permission) {
  return {
    ...permission,
    id: Number(permission.id),
  };
}

export function useRolesPage({ onRefreshCurrentUser }) {
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [selectedRoleId, setSelectedRoleId] = useState(null);
  const [selectedPerms, setSelectedPerms] = useState([]);
  const [roleUsers, setRoleUsers] = useState([]);
  const [openRoleMenuId, setOpenRoleMenuId] = useState(null);
  const [showCreateRoleModal, setShowCreateRoleModal] = useState(false);
  const [editingRole, setEditingRole] = useState(null);
  const [roleForm, setRoleForm] = useState({
    name: "",
    description: "",
  });
  const [creatingRole, setCreatingRole] = useState(false);
  const [roleStatusFilter, setRoleStatusFilter] = useState("active");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    role: null,
    action: null,
  });

  useEffect(() => {
    if (!error && !success) return;
    const timeoutId = window.setTimeout(() => {
      setError("");
      setSuccess("");
    }, 4000);
    return () => window.clearTimeout(timeoutId);
  }, [error, success]);

  useEffect(() => {
    if (openRoleMenuId === null) return undefined;

    function handlePointerDown(event) {
      if (event.target.closest(".role-kebab-wrap")) return;
      setOpenRoleMenuId(null);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [openRoleMenuId]);

  async function load() {
    try {
      const rolesUrl =
        roleStatusFilter === "all" || roleStatusFilter === "inactive"
          ? "/api/roles?includeInactive=1"
          : "/api/roles";
      const [rolesRes, permsRes] = await Promise.all([
        api.get(rolesUrl),
        api.get("/api/roles/permissions"),
      ]);
      const normalizedRoles = (rolesRes.data || []).map(normalizeRole);
      setRoles(normalizedRoles);
      if (selectedRoleId && !normalizedRoles.some((role) => role.id === selectedRoleId)) {
        setSelectedRoleId(null);
        setSelectedPerms([]);
      }
      setPermissions((permsRes.data || []).map(normalizePermission));
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible cargar roles/permisos"));
    }
  }

  useEffect(() => {
    load();
  }, [roleStatusFilter]);

  function resetRoleForm() {
    setRoleForm({ name: "", description: "" });
  }

  function closeRoleModal() {
    if (creatingRole) return;
    setShowCreateRoleModal(false);
    setEditingRole(null);
    resetRoleForm();
  }

  function openCreateRoleModal() {
    setEditingRole(null);
    resetRoleForm();
    setShowCreateRoleModal(true);
  }

  function openEditRoleModal(role) {
    setOpenRoleMenuId(null);
    setShowCreateRoleModal(false);
    setEditingRole(role);
    setRoleForm({
      name: role.name || "",
      description: role.description || "",
    });
  }

  async function submitRole(event) {
    event.preventDefault();
    if (!roleForm.name.trim()) return;
    setError("");
    setSuccess("");
    setCreatingRole(true);
    try {
      const payload = {
        name: roleForm.name.trim(),
        description: roleForm.description.trim(),
      };
      const roleName = payload.name;
      if (editingRole) {
        await api.put(`/api/roles/${editingRole.id}`, payload);
      } else {
        await api.post("/api/roles", payload);
      }
      closeRoleModal();
      await load();
      setSuccess(
        editingRole
          ? `Rol "${roleName}" actualizado correctamente.`
          : `Rol "${roleName}" creado correctamente.`,
      );
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          editingRole
            ? "No fue posible actualizar el rol"
            : "No fue posible crear el rol",
        ),
      );
    } finally {
      setCreatingRole(false);
    }
  }

  async function savePerms() {
    if (!selectedRoleId) {
      setSuccess("");
      setError("Selecciona un rol antes de guardar permisos.");
      return;
    }
    setError("");
    setSuccess("");
    try {
      await api.put(`/api/roles/${selectedRoleId}/permissions`, {
        permissionIds: selectedPerms.map(Number),
      });
      if (typeof onRefreshCurrentUser === "function") {
        await onRefreshCurrentUser();
      }
      await load();
      const selectedRole = roles.find((role) => role.id === selectedRoleId);
      const roleName = selectedRole?.name || "rol";
      setSuccess(`Permisos guardados correctamente para ${roleName}.`);
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible actualizar permisos del rol"),
      );
    }
  }

  async function selectRole(roleId) {
    setSelectedRoleId(roleId);
    setOpenRoleMenuId(null);
    setError("");
    setSuccess("");
    try {
      const [permsRes, usersRes] = await Promise.all([
        api.get(`/api/roles/${roleId}/permissions`),
        api.get(`/api/roles/${roleId}/users`),
      ]);
      setSelectedPerms((permsRes.data.permissionIds || []).map(Number));
      setRoleUsers(usersRes.data || []);
    } catch (err) {
      setSelectedPerms([]);
      setRoleUsers([]);
      setError(getApiErrorMessage(err, "No fue posible cargar datos del rol"));
    }
  }

  function openConfirmModal(role, action) {
    setConfirmModal({ isOpen: true, role, action });
  }

  function closeConfirmModal() {
    setConfirmModal({ isOpen: false, role: null, action: null });
  }

  async function confirmRoleStatusChange() {
    const { role, action } = confirmModal;
    if (!role) return;

    closeConfirmModal();
    const roleId = Number(role.id);
    const nextIsActive = action === "activar";

    setError("");
    setSuccess("");
    try {
      await api.patch(`/api/roles/${roleId}/status`, {
        isActive: nextIsActive,
      });
      if (!nextIsActive && roleStatusFilter === "active" && selectedRoleId === roleId) {
        setSelectedRoleId(null);
        setSelectedPerms([]);
      }
      await load();
      setSuccess(
        nextIsActive
          ? `Rol "${role.name}" activado correctamente.`
          : `Rol "${role.name}" desactivado correctamente.`,
      );
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible actualizar estado del rol"),
      );
    }
  }

  async function updateRoleStatus(role, nextIsActive) {
    const roleId = Number(role.id);
    if (Number(role.is_system) === 1) {
      setSuccess("");
      setError("No se puede cambiar el estado de un rol del sistema.");
      return;
    }

    const action = nextIsActive ? "activar" : "desactivar";
    openConfirmModal(role, action);
  }

  function toggleRoleMenu(roleId) {
    selectRole(roleId);
    setOpenRoleMenuId((prev) => (prev === roleId ? null : roleId));
  }

  async function runRoleAction(action) {
    try {
      await action();
    } finally {
      setOpenRoleMenuId(null);
    }
  }

  function formatDateTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString("es-ES");
  }

  function updateRoleFormField(field, value) {
    setRoleForm((prev) => ({ ...prev, [field]: value }));
  }

  function togglePermission(permissionId, checked) {
    const numericPermissionId = Number(permissionId);
    setSelectedPerms((prev) => {
      if (checked) return [...prev, numericPermissionId];
      return prev.filter((id) => id !== numericPermissionId);
    });
  }

  const filteredRoles = useMemo(
    () =>
      roles.filter((role) =>
        roleStatusFilter === "all"
          ? true
          : roleStatusFilter === "active"
            ? Number(role.is_active) === 1
            : Number(role.is_active) === 0,
      ),
    [roles, roleStatusFilter],
  );

  const roleStatusCounts = useMemo(
    () => ({
      active: roles.filter((role) => Number(role.is_active) === 1).length,
      inactive: roles.filter((role) => Number(role.is_active) === 0).length,
      all: roles.length,
    }),
    [roles],
  );

  const selectedRole = roles.find((role) => role.id === selectedRoleId) || null;

  const permissionsByModule = useMemo(
    () =>
      Object.entries(
        permissions.reduce((accumulator, permission) => {
          const moduleName = permission.module || "otros";
          if (!accumulator[moduleName]) accumulator[moduleName] = [];
          accumulator[moduleName].push(permission);
          return accumulator;
        }, {}),
      ),
    [permissions],
  );

  return {
    roles,
    permissions,
    selectedRoleId,
    selectedPerms,
    roleUsers,
    openRoleMenuId,
    showCreateRoleModal,
    editingRole,
    roleForm,
    creatingRole,
    roleStatusFilter,
    setRoleStatusFilter,
    error,
    success,
    confirmModal,
    filteredRoles,
    roleStatusCounts,
    selectedRole,
    permissionsByModule,
    openCreateRoleModal,
    openEditRoleModal,
    closeRoleModal,
    submitRole,
    savePerms,
    selectRole,
    closeConfirmModal,
    confirmRoleStatusChange,
    updateRoleStatus,
    toggleRoleMenu,
    runRoleAction,
    formatDateTime,
    updateRoleFormField,
    togglePermission,
    setOpenRoleMenuId,
  };
}