import { useEffect, useMemo, useState } from "react";
import { api, getApiErrorMessage } from "../api";
import { usePersistedStatusFilter } from "../appFilters";

const EMPTY_USER_FORM = {
  fullName: "",
  email: "",
  mobile: "",
  avatarUrl: "",
  roleIds: [],
};

export function useUsersPage() {
  const maxUserAvatarSizeBytes = 2 * 1024 * 1024;
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [openUserMenuId, setOpenUserMenuId] = useState(null);
  const [confirmUserAction, setConfirmUserAction] = useState(null);
  const [editUser, setEditUser] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_USER_FORM);
  const [sortField, setSortField] = useState("id");
  const [sortDirection, setSortDirection] = useState("asc");
  const [userQuery, setUserQuery] = useState("");
  const [userStatusFilter, setUserStatusFilter] = usePersistedStatusFilter(
    "crm.users.statusFilter",
  );
  const [usersPerPage, setUsersPerPage] = useState(10);
  const [usersPage, setUsersPage] = useState(1);
  const [form, setForm] = useState(EMPTY_USER_FORM);

  useEffect(() => {
    if (!error && !success) return;
    const timeoutId = window.setTimeout(() => {
      setError("");
      setSuccess("");
    }, 4000);
    return () => window.clearTimeout(timeoutId);
  }, [error, success]);

  useEffect(() => {
    if (openUserMenuId === null) return undefined;

    function handlePointerDown(event) {
      if (event.target.closest(".users-kebab-wrap")) return;
      setOpenUserMenuId(null);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [openUserMenuId]);

  const sortedUsers = useMemo(() => {
    const list = [...users];

    const readValue = (user) => {
      if (sortField === "id") return Number(user.id) || 0;
      if (sortField === "nombre") return String(user.full_name || "");
      if (sortField === "email") return String(user.email || "");
      if (sortField === "movil") return String(user.mobile || "");
      if (sortField === "estado") return String(user.status || "");
      if (sortField === "roles") return String(user.roles || "");
      return "";
    };

    list.sort((left, right) => {
      const leftValue = readValue(left);
      const rightValue = readValue(right);

      let result = 0;
      if (typeof leftValue === "number" && typeof rightValue === "number") {
        result = leftValue - rightValue;
      } else {
        result = String(leftValue).localeCompare(String(rightValue), "es", {
          numeric: true,
          sensitivity: "base",
        });
      }

      return sortDirection === "asc" ? result : -result;
    });

    return list;
  }, [users, sortField, sortDirection]);

  const filteredUsers = useMemo(() => {
    const base = sortedUsers.filter((user) => {
      if (userStatusFilter === "all") return true;
      if (userStatusFilter === "inactive") return user.status !== "active";
      return user.status === "active";
    });
    const query = userQuery.trim().toLowerCase();
    if (!query) return base;

    return base.filter((user) => {
      const haystack = [
        user.id,
        user.full_name,
        user.email,
        user.mobile,
        user.status === "active" ? "activo" : "inactivo",
        user.roles,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [sortedUsers, userQuery, userStatusFilter]);

  useEffect(() => {
    setUsersPage(1);
  }, [userQuery, userStatusFilter, usersPerPage]);

  const totalUserPages = Math.max(
    1,
    Math.ceil(filteredUsers.length / usersPerPage),
  );
  const pagedUsers = filteredUsers.slice(
    (usersPage - 1) * usersPerPage,
    usersPage * usersPerPage,
  );

  const userStatusCounts = useMemo(
    () =>
      users.reduce(
        (totals, user) => {
          if (user.status === "active") {
            totals.active += 1;
            return totals;
          }
          totals.inactive += 1;
          return totals;
        },
        { active: 0, inactive: 0 },
      ),
    [users],
  );

  const totalUsersCount = userStatusCounts.active + userStatusCounts.inactive;

  function toggleSort(field) {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortField(field);
    setSortDirection("asc");
  }

  function getSortArrow(field) {
    if (sortField !== field) return "↕";
    return sortDirection === "asc" ? "↑" : "↓";
  }

  function formatDateTime(value) {
    if (!value) return "No registrado";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "No registrado";
    return date.toLocaleString("es-ES");
  }

  async function load() {
    try {
      const [usersRes, rolesRes] = await Promise.all([
        api.get("/api/users"),
        api.get("/api/roles"),
      ]);
      setUsers(usersRes.data || []);
      setRoles(rolesRes.data || []);
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible cargar usuarios"));
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!showCreateForm) return;
    setForm((prev) => ({ ...prev, email: "" }));
  }, [showCreateForm]);

  function readUserImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("No fue posible leer la imagen"));
      reader.readAsDataURL(file);
    });
  }

  async function handleUserAvatarChange(file, applyAvatar) {
    if (!file) {
      applyAvatar("");
      return;
    }

    if (!String(file.type || "").startsWith("image/")) {
      setError("Selecciona un archivo de imagen válido");
      return;
    }

    if (file.size > maxUserAvatarSizeBytes) {
      setError("La imagen del usuario no debe exceder 2 MB");
      return;
    }

    try {
      const dataUrl = await readUserImageFile(file);
      applyAvatar(dataUrl);
    } catch (err) {
      setError(String(err?.message || "No fue posible cargar la imagen"));
    }
  }

  function closeCreateUserModal() {
    if (saving) return;
    setShowCreateForm(false);
    setError("");
    setSuccess("");
    setForm(EMPTY_USER_FORM);
  }

  function openCreateUserModal() {
    setError("");
    setSuccess("");
    setShowCreateForm(true);
  }

  async function createUser(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      const payload = {
        fullName: form.fullName,
        email: form.email,
        mobile: form.mobile || undefined,
        avatarUrl: form.avatarUrl || undefined,
        roleIds: form.roleIds,
      };

      const { data } = await api.post("/api/users", payload);
      setForm(EMPTY_USER_FORM);
      setShowCreateForm(false);
      setSuccess(
        data?.message ||
          "Usuario creado. Se envio un correo para crear la contrasena.",
      );
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible crear el usuario"));
    } finally {
      setSaving(false);
    }
  }

  async function updateUserStatus(userId, nextStatus) {
    setError("");
    setSuccess("");
    try {
      const { data } = await api.patch(`/api/users/${userId}/status`, {
        status: nextStatus,
      });
      setSuccess(data?.message || "Estado actualizado");
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible actualizar estado"));
    }
  }

  function openUserActionConfirmation(user, action) {
    setConfirmUserAction({ user, action });
    setOpenUserMenuId(null);
  }

  function closeUserActionConfirmation() {
    if (saving) return;
    setConfirmUserAction(null);
  }

  async function confirmSelectedUserAction() {
    if (!confirmUserAction) return;

    if (confirmUserAction.action === "inactive") {
      await updateUserStatus(confirmUserAction.user.id, "inactive");
    } else if (confirmUserAction.action === "active") {
      await updateUserStatus(confirmUserAction.user.id, "active");
    } else if (confirmUserAction.action === "reset-password") {
      await sendResetInvite(confirmUserAction.user.id);
    }

    setConfirmUserAction(null);
  }

  function getUserActionConfirmationTitle() {
    if (confirmUserAction?.action === "active") return "Activar usuario";
    if (confirmUserAction?.action === "reset-password") {
      return "Reiniciar contrasena";
    }
    return "Desactivar usuario";
  }

  function getUserActionConfirmationMessage() {
    const fullName = confirmUserAction?.user?.full_name || "";
    if (confirmUserAction?.action === "active") {
      return `Seguro que deseas activar al usuario "${fullName}"?`;
    }
    if (confirmUserAction?.action === "reset-password") {
      return `Seguro que deseas enviar un reinicio de contrasena para el usuario "${fullName}"?`;
    }
    return `Seguro que deseas desactivar al usuario "${fullName}"?`;
  }

  function getUserActionConfirmationText() {
    if (confirmUserAction?.action === "active") return "Activar";
    if (confirmUserAction?.action === "reset-password") {
      return "Enviar reinicio";
    }
    return "Desactivar";
  }

  async function sendResetInvite(userId) {
    setError("");
    setSuccess("");
    try {
      const { data } = await api.post(
        `/api/users/${userId}/reset-password-invite`,
      );
      setSuccess(data?.message || "Correo de reinicio enviado");
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible enviar correo de reinicio"),
      );
    }
  }

  function toggleUserMenu(userId) {
    setOpenUserMenuId((prev) => (prev === userId ? null : userId));
  }

  function openEditUser(user) {
    const currentRoleIds = user.roles
      ? roles
          .filter((role) => user.roles.split(", ").includes(role.name))
          .map((role) => role.id)
      : [];
    setEditForm({
      fullName: user.full_name,
      email: user.email,
      mobile: user.mobile || "",
      avatarUrl: user.avatar_url || "",
      roleIds: currentRoleIds,
    });
    setEditUser(user);
  }

  function closeEditUserModal() {
    if (saving) return;
    setEditUser(null);
  }

  async function saveEditUser(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      const { data } = await api.put(`/api/users/${editUser.id}`, {
        fullName: editForm.fullName,
        email: editForm.email,
        mobile: editForm.mobile || null,
        avatarUrl: editForm.avatarUrl || null,
        roleIds: editForm.roleIds,
      });
      setEditUser(null);
      setSuccess(data?.message || "Usuario actualizado");
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible actualizar el usuario"));
    } finally {
      setSaving(false);
    }
  }

  async function runUserAction(action) {
    try {
      await action();
    } finally {
      setOpenUserMenuId(null);
    }
  }

  function updateCreateFormField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function updateEditFormField(field, value) {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  }

  function toggleCreateRole(roleId, checked) {
    const numericRoleId = Number(roleId);
    setForm((prev) => ({
      ...prev,
      roleIds: checked
        ? [...prev.roleIds, numericRoleId]
        : prev.roleIds.filter((id) => id !== numericRoleId),
    }));
  }

  function toggleEditRole(roleId, checked) {
    setEditForm((prev) => ({
      ...prev,
      roleIds: checked
        ? [...prev.roleIds, roleId]
        : prev.roleIds.filter((id) => id !== roleId),
    }));
  }

  return {
    roles,
    error,
    success,
    saving,
    showCreateForm,
    openUserMenuId,
    confirmUserAction,
    editUser,
    editForm,
    userQuery,
    setUserQuery,
    userStatusFilter,
    setUserStatusFilter,
    usersPerPage,
    setUsersPerPage,
    usersPage,
    setUsersPage,
    form,
    filteredUsers,
    pagedUsers,
    userStatusCounts,
    totalUsersCount,
    totalUserPages,
    openCreateUserModal,
    closeCreateUserModal,
    createUser,
    toggleUserMenu,
    openEditUser,
    closeEditUserModal,
    saveEditUser,
    runUserAction,
    openUserActionConfirmation,
    closeUserActionConfirmation,
    confirmSelectedUserAction,
    getUserActionConfirmationTitle,
    getUserActionConfirmationMessage,
    getUserActionConfirmationText,
    getSortArrow,
    toggleSort,
    formatDateTime,
    handleUserAvatarChange,
    updateCreateFormField,
    updateEditFormField,
    toggleCreateRole,
    toggleEditRole,
  };
}