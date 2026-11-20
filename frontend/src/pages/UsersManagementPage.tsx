import React, { useCallback, useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { useForm } from "react-hook-form";
import {
  BadgeCheck,
  Check,
  Copy,
  KeyRound,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  Users,
} from "lucide-react";
import { pageTransitionVariants } from "@/config/animations";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { StickerCard } from "@/components/ui/StickerCard";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/useToast";
import {
  adminCreateUserSchema,
  adminTempPasswordSchema,
  type AdminCreateUserFormValues,
  type AdminTempPasswordFormValues,
} from "@/schemas/auth.schema";
import { usersService } from "@/services/users.service";
import type { UserProfile, UserRoleCode } from "@/types/order";
import { formatDateTime } from "@/utils/date";

export const UsersManagementPage: React.FC = () => {
  const { profile, user: authUser } = useAuth();
  const { pushToast } = useToast();

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRoleCode | "">("");

  const [createOpen, setCreateOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [deletingUser, setDeletingUser] = useState<UserProfile | null>(null);
  const [restoringUser, setRestoringUser] = useState<UserProfile | null>(null);

  // Edit form local state
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<UserRoleCode>("operador");
  const [editActive, setEditActive] = useState(true);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingBusy, setDeletingBusy] = useState(false);

  // Restore password modal state
  const [restoreMode, setRestoreMode] = useState<"temporary_password" | "reset_link">(
    "temporary_password"
  );
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [generatingLink, setGeneratingLink] = useState(false);

  const createForm = useForm<AdminCreateUserFormValues>({
    resolver: zodResolver(adminCreateUserSchema),
    defaultValues: {
      display_name: "",
      email: "",
      password: "",
      role: "operador",
      email_verified: true,
    },
  });

  const tempPassForm = useForm<AdminTempPasswordFormValues>({
    resolver: zodResolver(adminTempPasswordSchema),
  });

  const isAdmin = profile?.role === "admin";

  const loadUsers = useCallback(async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await usersService.listUsers({ search, role: roleFilter });
      setUsers(res.items);
    } catch (err) {
      pushToast({
        title: "Error cargando usuarios",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [isAdmin, search, roleFilter, pushToast]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  if (profile && !isAdmin) {
    return (
      <StickerCard dieCut padding="lg" className="mx-auto max-w-xl text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-elevated text-accent">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h1 className="mt-4 font-display text-xl font-extrabold text-ink-primary">
          Acceso Exclusivo de Administrador
        </h1>
        <p className="mt-2 text-xs text-ink-muted">
          Tu cuenta tiene el rol <strong className="font-mono">{profile.role_name}</strong>. Solo un{" "}
          <strong>Administrador</strong> puede gestionar usuarios y restaurar contraseñas.
        </p>
      </StickerCard>
    );
  }

  const handleCreateUser = async (values: AdminCreateUserFormValues) => {
    try {
      const created = await usersService.createUser(values);
      pushToast({
        title: `Usuario ${created.display_name} creado`,
        description: `Rol asignado: ${created.role_name}`,
        variant: "success",
      });
      createForm.reset();
      setCreateOpen(false);
      void loadUsers();
    } catch (err) {
      pushToast({
        title: "No se pudo crear el usuario",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    }
  };

  const openEdit = (u: UserProfile) => {
    setEditingUser(u);
    setEditName(u.display_name);
    setEditRole(u.role);
    setEditActive(u.is_active);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setSavingEdit(true);
    try {
      await usersService.updateUser(editingUser.id, {
        display_name: editName.trim(),
        role: editRole,
        is_active: editActive,
      });
      pushToast({ title: "Usuario actualizado", variant: "success" });
      setEditingUser(null);
      void loadUsers();
    } catch (err) {
      pushToast({
        title: "No se pudo actualizar",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setSavingEdit(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingUser) return;
    setDeletingBusy(true);
    try {
      await usersService.deleteUser(deletingUser.id);
      pushToast({
        title: "Usuario eliminado",
        description: deletingUser.email,
        variant: "success",
      });
      setDeletingUser(null);
      void loadUsers();
    } catch (err) {
      pushToast({
        title: "No se pudo eliminar el usuario",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setDeletingBusy(false);
    }
  };

  const openRestoreModal = (u: UserProfile) => {
    setRestoringUser(u);
    setRestoreMode("temporary_password");
    setGeneratedLink(null);
    setCopiedLink(false);
    tempPassForm.reset();
  };

  const handleRestoreTempPassword = async (values: AdminTempPasswordFormValues) => {
    if (!restoringUser) return;
    try {
      const res = await usersService.restorePassword(restoringUser.id, {
        mode: "temporary_password",
        new_password: values.new_password,
      });
      pushToast({
        title: "Contraseña restaurada",
        description: res.message,
        variant: "success",
      });
      setRestoringUser(null);
      tempPassForm.reset();
    } catch (err) {
      pushToast({
        title: "Error al restaurar contraseña",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    }
  };

  const handleGenerateResetLink = async () => {
    if (!restoringUser) return;
    setGeneratingLink(true);
    try {
      const res = await usersService.restorePassword(restoringUser.id, {
        mode: "reset_link",
      });
      setGeneratedLink(res.reset_link);
      pushToast({
        title: "Enlace de restauración generado",
        description: res.message,
        variant: "success",
      });
    } catch (err) {
      pushToast({
        title: "No se pudo generar el enlace",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setGeneratingLink(false);
    }
  };

  const handleCopyLink = async () => {
    if (!generatedLink) return;
    try {
      await navigator.clipboard.writeText(generatedLink);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <motion.div
      variants={pageTransitionVariants}
      initial="initial"
      animate="animate"
      className="space-y-6"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink-primary">
            Usuarios, Roles y Restauración de Contraseñas
          </h1>
          <p className="mt-0.5 text-xs text-ink-muted">
            Administración CRUD sincronizada con PostgreSQL + Firebase Auth y restauración de acceso.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void loadUsers()}
            loading={loading}
            leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
          >
            Actualizar
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => setCreateOpen(true)}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            Nuevo Usuario
          </Button>
        </div>
      </div>

      {/* Filters */}
      <StickerCard padding="sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
          <div className="sm:col-span-8">
            <Input
              placeholder="Buscar por nombre o correo electrónico..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              leftIcon={<Search className="h-4 w-4" />}
            />
          </div>
          <div className="sm:col-span-4">
            <Select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as UserRoleCode | "")}
              aria-label="Filtrar por rol"
            >
              <option value="">Todos los roles</option>
              <option value="admin">Administrador</option>
              <option value="operador">Operador</option>
              <option value="cliente">Cliente</option>
            </Select>
          </div>
        </div>
      </StickerCard>

      {/* Users Table */}
      <div className="overflow-hidden rounded-sticker border border-line-subtle bg-surface-card shadow-card">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-line-subtle text-left text-xs">
            <thead className="bg-surface-elevated/80 text-[11px] font-bold uppercase tracking-wider text-ink-muted">
              <tr>
                <th className="px-4 py-3.5">Usuario</th>
                <th className="px-4 py-3.5">Rol</th>
                <th className="px-4 py-3.5">Email / Estado</th>
                <th className="px-4 py-3.5">Registro</th>
                <th className="px-4 py-3.5 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-ink-muted">
                    Cargando usuarios...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-ink-muted">
                    <Users className="mx-auto mb-2 h-6 w-6 opacity-60" />
                    No se encontraron usuarios.
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const isSelf = u.firebase_uid === authUser?.uid;
                  return (
                    <tr key={u.id} className="hover:bg-surface-elevated/50">
                      <td className="px-4 py-3.5">
                        <p className="font-bold text-ink-primary">
                          {u.display_name}{" "}
                          {isSelf && (
                            <span className="ml-1 rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] text-accent">
                              TÚ
                            </span>
                          )}
                        </p>
                        <p className="font-mono text-[11px] text-ink-muted">{u.email}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-bold ${
                            u.role === "admin"
                              ? "border-brand-700 bg-brand-700 text-white dark:border-brand-400 dark:bg-brand-400 dark:text-brand-950"
                              : "border-line-strong bg-surface-elevated text-ink-primary"
                          }`}
                        >
                          {u.role_name}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5">
                        <div className="flex flex-col gap-1">
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink-primary">
                            <BadgeCheck className="h-3.5 w-3.5 text-accent" />
                            {u.email_verified ? "Email verificado" : "Sin confirmar"}
                          </span>
                          <span className="font-mono text-[10px] text-ink-muted">
                            {u.is_active ? "Cuenta activa" : "Desactivada"} · {u.auth_provider}
                          </span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 font-mono text-[11px] text-ink-muted">
                        {formatDateTime(u.created_at)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => openRestoreModal(u)}
                            leftIcon={<KeyRound className="h-3.5 w-3.5" />}
                          >
                            Restaurar clave
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => openEdit(u)}
                            aria-label="Editar usuario"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          {!isSelf && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => setDeletingUser(u)}
                              aria-label="Eliminar usuario"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create User Modal */}
      <Modal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Registrar Nuevo Usuario"
        subtitle="Crea la cuenta simultáneamente en Firebase Authentication y PostgreSQL."
        maxWidthClass="max-w-lg"
      >
        <form onSubmit={createForm.handleSubmit(handleCreateUser)} noValidate className="space-y-4">
          <Input
            label="Nombre completo *"
            placeholder="Ej. Jorge Salinas"
            error={createForm.formState.errors.display_name?.message}
            {...createForm.register("display_name")}
          />
          <Input
            label="Correo electrónico *"
            type="email"
            placeholder="operador@taller.com"
            error={createForm.formState.errors.email?.message}
            {...createForm.register("email")}
          />
          <Input
            label="Contraseña inicial *"
            type="password"
            placeholder="Mínimo 8 caracteres con letras y números"
            error={createForm.formState.errors.password?.message}
            {...createForm.register("password")}
          />
          <Select
            label="Rol RBAC *"
            error={createForm.formState.errors.role?.message}
            {...createForm.register("role")}
          >
            <option value="operador">Operador de Taller</option>
            <option value="admin">Administrador</option>
            <option value="cliente">Cliente</option>
          </Select>
          <label className="flex items-center gap-2 text-xs font-medium text-ink-secondary">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-line-strong"
              {...createForm.register("email_verified")}
            />
            Marcar correo como verificado inmediatamente
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={createForm.formState.isSubmitting}>
              Crear Usuario
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit User Modal */}
      <Modal
        isOpen={Boolean(editingUser)}
        onClose={() => setEditingUser(null)}
        title="Editar Usuario"
        subtitle={editingUser?.email}
        maxWidthClass="max-w-md"
      >
        <form onSubmit={handleSaveEdit} className="space-y-4">
          <Input
            label="Nombre completo"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            required
          />
          <Select
            label="Rol"
            value={editRole}
            onChange={(e) => setEditRole(e.target.value as UserRoleCode)}
          >
            <option value="admin">Administrador</option>
            <option value="operador">Operador de Taller</option>
            <option value="cliente">Cliente</option>
          </Select>
          <label className="flex items-center gap-2 text-xs font-medium text-ink-secondary">
            <input
              type="checkbox"
              checked={editActive}
              onChange={(e) => setEditActive(e.target.checked)}
              className="h-4 w-4 rounded border-line-strong"
            />
            Cuenta activa (permitir inicio de sesión)
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setEditingUser(null)}>
              Cancelar
            </Button>
            <Button type="submit" loading={savingEdit}>
              Guardar cambios
            </Button>
          </div>
        </form>
      </Modal>

      {/* Admin Password Restoration Modal */}
      <Modal
        isOpen={Boolean(restoringUser)}
        onClose={() => setRestoringUser(null)}
        title="Restauración de Contraseña (Administrador)"
        subtitle={restoringUser ? `${restoringUser.display_name} · ${restoringUser.email}` : undefined}
        maxWidthClass="max-w-lg"
      >
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => setRestoreMode("temporary_password")}
              className={`rounded-lg border p-3 text-left text-xs transition-colors ${
                restoreMode === "temporary_password"
                  ? "border-accent bg-accent text-accent-ink"
                  : "border-line-subtle bg-surface-elevated text-ink-primary"
              }`}
            >
              <KeyRound className="h-4 w-4" />
              <p className="mt-1.5 font-bold">Contraseña temporal</p>
              <p className="mt-0.5 text-[11px] opacity-85">Aplica al instante y revoca sesiones</p>
            </button>
            <button
              type="button"
              onClick={() => setRestoreMode("reset_link")}
              className={`rounded-lg border p-3 text-left text-xs transition-colors ${
                restoreMode === "reset_link"
                  ? "border-accent bg-accent text-accent-ink"
                  : "border-line-subtle bg-surface-elevated text-ink-primary"
              }`}
            >
              <Link2 className="h-4 w-4" />
              <p className="mt-1.5 font-bold">Enlace de restauración</p>
              <p className="mt-0.5 text-[11px] opacity-85">Genera URL segura de un solo uso</p>
            </button>
          </div>

          {restoreMode === "temporary_password" ? (
            <form
              onSubmit={tempPassForm.handleSubmit(handleRestoreTempPassword)}
              noValidate
              className="space-y-4"
            >
              <Input
                label="Nueva contraseña temporal *"
                type="password"
                placeholder="Mínimo 8 caracteres con letras y números"
                error={tempPassForm.formState.errors.new_password?.message}
                {...tempPassForm.register("new_password")}
              />
              <Input
                label="Confirmar contraseña *"
                type="password"
                placeholder="Repite la contraseña temporal"
                error={tempPassForm.formState.errors.confirm_password?.message}
                {...tempPassForm.register("confirm_password")}
              />
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setRestoringUser(null)}>
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  loading={tempPassForm.formState.isSubmitting}
                  leftIcon={<KeyRound className="h-4 w-4" />}
                >
                  Restaurar ahora
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <p className="text-xs leading-relaxed text-ink-secondary">
                Genera un enlace oficial de Firebase Auth para que{" "}
                <strong className="font-mono text-ink-primary">{restoringUser?.email}</strong>{" "}
                defina su propia contraseña nueva.
              </p>

              {generatedLink && (
                <div className="rounded-lg border border-dashed border-line-diecut bg-surface-elevated p-3">
                  <p className="break-all font-mono text-[11px] text-ink-primary">
                    {generatedLink}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={handleCopyLink}
                    className="mt-2.5"
                    leftIcon={copiedLink ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  >
                    {copiedLink ? "Enlace copiado" : "Copiar enlace"}
                  </Button>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setRestoringUser(null)}>
                  Cerrar
                </Button>
                <Button
                  type="button"
                  loading={generatingLink}
                  onClick={handleGenerateResetLink}
                  leftIcon={<Link2 className="h-4 w-4" />}
                >
                  Generar enlace seguro
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Delete User Confirmation Modal */}
      <Modal
        isOpen={Boolean(deletingUser)}
        onClose={() => setDeletingUser(null)}
        title="Confirmar Eliminación de Usuario"
        maxWidthClass="max-w-md"
      >
        <div className="space-y-4 text-sm">
          <p className="text-xs leading-relaxed text-ink-secondary">
            ¿Estás seguro de eliminar a{" "}
            <strong className="text-ink-primary">{deletingUser?.display_name}</strong> (
            <span className="font-mono">{deletingUser?.email}</span>)? Se revocará su acceso en
            Firebase Auth y se eliminará de la tabla <code className="font-mono">users</code> (los
            pedidos históricos conservarán integridad mediante <code className="font-mono">ON DELETE SET NULL</code>).
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDeletingUser(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="inverted"
              loading={deletingBusy}
              onClick={handleConfirmDelete}
              leftIcon={<Trash2 className="h-4 w-4" />}
            >
              Confirmar eliminación
            </Button>
          </div>
        </div>
      </Modal>
    </motion.div>
  );
};
