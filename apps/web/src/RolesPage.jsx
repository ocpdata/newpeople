import { ConfirmationModal } from "./AppModals";
import RoleFormModal from "./roles/RoleFormModal";
import RolesWorkspaceSection from "./roles/RolesWorkspaceSection";
import { useRolesPage } from "./roles/useRolesPage";

function RolesPage({ can, onRefreshCurrentUser }) {
  const {
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
  } = useRolesPage({ onRefreshCurrentUser });

  const canCreateRoles = can("roles.create");
  const canUpdateRoles = can("roles.update");

  return (
    <section className="panel">
      <div className="roles-page-header">
        <div className="roles-page-header-left">
          <div className="module-title-with-icon">
            <h2>Roles y permisos</h2>
            <span className="module-title-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M12 1a5 5 0 1 1 0 10A5 5 0 0 1 12 1zm0 1.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM3.5 19.5A8.5 8.5 0 0 1 12 13a8.5 8.5 0 0 1 8.5 6.5H3.5zM2 20.5C2.42 16.09 6.8 13 12 13s9.58 3.09 10 7.5H2zM17 14l1.5 1.5L23 11l-1.5-1.5L17 14zm1.5 1.5L17 14l-2 2 1.5 1.5 2-2z" />
              </svg>
            </span>
          </div>
          <p className="roles-subtitle">
            Gestiona los roles del sistema y asigna permisos por módulo
          </p>
        </div>
        {canCreateRoles && (
          <button
            type="button"
            className="btn-primary"
            onClick={openCreateRoleModal}
          >
            + Crear rol
          </button>
        )}
      </div>

      {error && <div className="toast toast-error">{error}</div>}
      {success && <div className="toast toast-success">{success}</div>}

      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        title={
          confirmModal.action === "activar" ? "Activar rol" : "Desactivar rol"
        }
        message={`Seguro que deseas ${confirmModal.action} el rol "${confirmModal.role?.name}"?`}
        onConfirm={confirmRoleStatusChange}
        onCancel={closeConfirmModal}
        confirmText={
          confirmModal.action === "activar" ? "Activar" : "Desactivar"
        }
        isDangerous={confirmModal.action === "desactivar"}
      />


      <RoleFormModal
        isOpen={showCreateRoleModal || Boolean(editingRole)}
        editingRole={editingRole}
        roleForm={roleForm}
        creatingRole={creatingRole}
        onClose={closeRoleModal}
        onSubmit={submitRole}
        onFieldChange={updateRoleFormField}
      />

      <RolesWorkspaceSection
        canUpdateRoles={canUpdateRoles}
        roleStatusFilter={roleStatusFilter}
        setRoleStatusFilter={setRoleStatusFilter}
        roleStatusCounts={roleStatusCounts}
        filteredRoles={filteredRoles}
        selectedRoleId={selectedRoleId}
        selectedRole={selectedRole}
        openRoleMenuId={openRoleMenuId}
        toggleRoleMenu={toggleRoleMenu}
        setOpenRoleMenuId={setOpenRoleMenuId}
        openEditRoleModal={openEditRoleModal}
        runRoleAction={runRoleAction}
        updateRoleStatus={updateRoleStatus}
        formatDateTime={formatDateTime}
        permissions={permissions}
        selectedPerms={selectedPerms}
        permissionsByModule={permissionsByModule}
        togglePermission={togglePermission}
        savePerms={savePerms}
        roleUsers={roleUsers}
        selectRole={selectRole}
      />
    </section>
  );
}

export default RolesPage;
