import { ConfirmationModal } from "./AppModals";
import UserFormModal from "./users/UserFormModal";
import UsersListSection from "./users/UsersListSection";
import { useUsersPage } from "./users/useUsersPage";

function UsersPage({ can }) {
  const {
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
  } = useUsersPage();

  const canCreateUsers = can("usuarios.create");

  return (
    <section className="panel">
      <ConfirmationModal
        isOpen={Boolean(confirmUserAction)}
        title={getUserActionConfirmationTitle()}
        message={getUserActionConfirmationMessage()}
        onConfirm={confirmSelectedUserAction}
        onCancel={closeUserActionConfirmation}
        confirmText={getUserActionConfirmationText()}
        isDangerous={confirmUserAction?.action === "inactive"}
      />

      <UsersListSection
        canCreateUsers={canCreateUsers}
        showCreateForm={showCreateForm}
        openCreateUserModal={openCreateUserModal}
        userStatusFilter={userStatusFilter}
        setUserStatusFilter={setUserStatusFilter}
        userStatusCounts={userStatusCounts}
        totalUsersCount={totalUsersCount}
        userQuery={userQuery}
        setUserQuery={setUserQuery}
        filteredUsers={filteredUsers}
        pagedUsers={pagedUsers}
        toggleSort={toggleSort}
        getSortArrow={getSortArrow}
        openUserMenuId={openUserMenuId}
        toggleUserMenu={toggleUserMenu}
        setOpenUserMenuId={() => {}}
        openEditUser={openEditUser}
        openUserActionConfirmation={openUserActionConfirmation}
        usersPage={usersPage}
        setUsersPage={setUsersPage}
        usersPerPage={usersPerPage}
        setUsersPerPage={setUsersPerPage}
        totalUserPages={totalUserPages}
      />

      {canCreateUsers && (
        <UserFormModal
          isOpen={showCreateForm}
          mode="create"
          saving={saving}
          form={form}
          roles={roles}
          onSubmit={createUser}
          onClose={closeCreateUserModal}
          onFieldChange={updateCreateFormField}
          onRoleToggle={toggleCreateRole}
          onAvatarChange={handleUserAvatarChange}
        />
      )}

      {error && <div className="toast toast-error">{error}</div>}
      {success && <div className="toast toast-success">{success}</div>}

      <UserFormModal
        isOpen={Boolean(editUser)}
        mode="edit"
        saving={saving}
        form={editForm}
        roles={roles}
        user={editUser}
        onSubmit={saveEditUser}
        onClose={closeEditUserModal}
        onFieldChange={updateEditFormField}
        onRoleToggle={toggleEditRole}
        onAvatarChange={handleUserAvatarChange}
        formatDateTime={formatDateTime}
      />
    </section>
  );
}

export default UsersPage;
