import React, { useCallback, useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Check,
  Clock,
  Copy,
  FilterX,
  KeyRound,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Shield,
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

const QUICK_ROLE_FILTERS: readonly { value: UserRoleCode | ""; label: string }[] = [
  { value: "", label: "Todos" },
  { value: "admin", label: "Administrador" },
  { value: "operador", label: "Operador" },
  { value: "cliente", label: "Cliente" },
];

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
      <StickerCard
        dieCut
        registrationMarks
        tone="critical"
        padding="lg"
        className="mx-auto max-w-xl text-center"
      >
        <div className="sticker-badge mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-state-critical-bg text-state-critical-ink">
          <ShieldAlert className="h-7 w-7" aria-hidden="true" />
        </div>
        <h1 className="mt-4 font-display text-xl font-extrabold tracking-tight text-ink-primary">
          Acceso Exclusivo de Administrador
        </h1>
        <p className="mt-2 text-xs leading-relaxed text-ink-secondary">
          Tu cuenta tiene el rol{" "}
          <strong className="rounded-xs bg-surface-card px-1.5 py-0.5 font-mono text-ink-primary">
            {profile.role_name}
          </strong>
          . Solo un <strong className="text-ink-primary">Administrador</strong> puede gestionar
          usuarios y restaurar contraseñas.
        </p>
        <div className="mt-6 flex justify-center">
          <Link
            to="/dashboard/orders?only_pending=true"
            className="inline-flex h-11 items-center gap-2 rounded-md bg-accent px-5 text-xs font-semibold text-accent-ink shadow-xs transition-all duration-fast ease-studio hover:-translate-y-px hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card"
          >
            <Clock className="h-4 w-4" aria-hidden="true" />
            <span>Ir a trabajos pendientes</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
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
      {/* Band 1: Command Header with Prominent Quick Actions */}
      <StickerCard padding="md" className="bg-print-grid overflow-hidden">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-diecut/75 bg-surface-card px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-accent shadow-xs">
                <Shield className="h-3 w-3" aria-hidden="true" />
                Administración RBAC · Equipo
              </span>
              <span className="sticker-badge inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-diecut bg-accent-soft px-2.5 py-0.5 font-mono text-[11px] font-bold tabular-nums text-ink-primary">
                <Users className="h-3 w-3 text-accent" aria-hidden="true" />
                {users.length} cuenta(s)
              </span>
            </div>

            <div>
              <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink-primary sm:text-3xl">
                Usuarios, Roles y Restauración de Contraseñas
              </h1>
              <p className="mt-0.5 text-xs text-ink-secondary sm:text-sm">
                Administración CRUD sincronizada con PostgreSQL + Firebase Auth y restauración de acceso.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 lg:shrink-0">
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={() => setCreateOpen(true)}
              leftIcon={<Plus className="h-4 w-4" />}
            >
              Nuevo Usuario
            </Button>

            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={() => void loadUsers()}
              loading={loading}
              leftIcon={<RefreshCw className="h-4 w-4" />}
            >
              Actualizar
            </Button>

            <Link
              to="/dashboard/orders?only_pending=true"
              className="group inline-flex h-11 items-center gap-2 rounded-md border border-dashed border-line-diecut/80 bg-surface-card px-3.5 text-xs font-semibold text-ink-primary shadow-xs transition-all duration-fast ease-studio hover:-translate-y-px hover:border-line-diecut hover:bg-accent-soft/60 hover:shadow-sticker focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card"
            >
              <Clock className="h-4 w-4 text-accent" aria-hidden="true" />
              <span>Pendientes</span>
            </Link>
          </div>
        </div>
      </StickerCard>

      {/* Band 2: Quick Role Chips & Search Filters */}
      <StickerCard dieCut registrationMarks padding="md" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-dashed border-line-subtle pb-3.5">
          <div className="flex flex-wrap items-center gap-2">
            {QUICK_ROLE_FILTERS.map((item) => {
              const active = roleFilter === item.value;
              return (
                <button
                  key={item.label}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setRoleFilter(item.value)}
                  className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold transition-all duration-fast ease-studio hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    active
                      ? "sticker-badge border-accent bg-accent text-accent-ink shadow-sticker"
                      : "border-line-subtle bg-surface-card text-ink-secondary hover:border-line-diecut hover:bg-surface-elevated hover:text-ink-primary"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          {(search.trim() || roleFilter) && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setRoleFilter("");
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-line-subtle bg-surface-elevated px-3 py-1 text-xs font-semibold text-ink-secondary transition-colors duration-fast ease-studio hover:border-line-strong hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <FilterX className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
              <span>Limpiar filtros</span>
            </button>
          )}
        </div>

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

      {/* Band 3: Featured Users Table */}
      <StickerCard tone="featured" padding="none" className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-line-subtle text-left text-xs">
            <thead className="border-b border-dashed border-line-subtle bg-surface-elevated/65 text-[11px] font-bold uppercase tracking-wider text-ink-secondary">
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
                  <td colSpan={5} className="p-5">
                    <div className="space-y-2.5">
                      {[1, 2, 3].map((idx) => (
                        <div
                          key={idx}
                          className="h-12 animate-pulse rounded-md bg-surface-elevated/70"
                        />
                      ))}
                    </div>
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="bg-print-grid px-4 py-12 text-center">
                    <div className="sticker-badge mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-line-diecut/70 bg-accent-soft text-accent">
                      <Users className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <p className="mt-3 text-sm font-bold text-ink-primary">
                      No se encontraron usuarios
                    </p>
                    <p className="mt-1 text-xs text-ink-muted">
                      Ajusta la búsqueda o registra una nueva cuenta de operador.
                    </p>
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const isSelf = u.firebase_uid === authUser?.uid;
                  const roleBadgeClasses =
                    u.role === "admin"
                      ? "border-accent bg-accent text-accent-ink"
                      : u.role === "operador"
                      ? "border-dashed border-line-diecut/75 bg-accent-soft text-ink-primary"
                      : "border-line-strong bg-surface-elevated text-ink-secondary";

                  return (
                    <tr
                      key={u.id}
                      className={`group transition-colors duration-fast ease-studio hover:bg-surface-elevated/60 ${
                        !u.is_active ? "opacity-75" : ""
                      }`}
                    >
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <span
                            aria-hidden="true"
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-display text-xs font-extrabold ${
                              u.role === "admin"
                                ? "sticker-badge bg-accent text-accent-ink"
                                : "border border-line-subtle bg-surface-elevated text-ink-primary"
                            }`}
                          >
                            {(u.display_name || u.email || "U").slice(0, 1).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <p className="flex flex-wrap items-center gap-1.5 font-bold text-ink-primary">
                              <span className="truncate">{u.display_name}</span>
                              {isSelf && (
                                <span className="rounded-full border border-dashed border-line-diecut bg-accent-soft px-1.5 py-0.5 font-mono text-[9px] font-bold text-accent">
                                  TÚ
                                </span>
                              )}
                            </p>
                            <p className="truncate font-mono text-[11px] text-ink-muted">
                              {u.email}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="whitespace-nowrap px-4 py-3.5">
                        <span
                          className={`sticker-badge inline-flex rounded-full border-[1.5px] px-2.5 py-0.5 font-mono text-[11px] font-bold ${roleBadgeClasses}`}
                        >
                          {u.role_name}
                        </span>
                      </td>

                      <td className="whitespace-nowrap px-4 py-3.5">
                        <div className="flex flex-col gap-1">
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-ink-primary">
                            <BadgeCheck
                              className={`h-3.5 w-3.5 ${
                                u.email_verified ? "text-accent" : "text-ink-muted"
                              }`}
                              aria-hidden="true"
                            />
                            {u.email_verified ? "Email verificado" : "Sin confirmar"}
                          </span>
                          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-ink-muted">
                            {!u.is_active && (
                              <span className="rounded-full bg-state-critical-bg px-1.5 py-0.5 text-[9px] font-bold text-state-critical-ink">
                                DESACTIVADA
                              </span>
                            )}
                            <span>
                              {u.is_active ? "Cuenta activa" : ""} · {u.auth_provider}
                            </span>
                          </span>
                        </div>
                      </td>

                      <td className="whitespace-nowrap px-4 py-3.5 font-mono text-[11px] tabular-nums text-ink-muted">
                        {formatDateTime(u.created_at)}
                      </td>

                      <td className="whitespace-nowrap px-4 py-3.5 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="dieCut"
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
      </StickerCard>

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
          <label className="flex cursor-pointer items-center gap-2.5 rounded-md border border-line-subtle bg-surface-elevated/55 px-3 py-2.5 text-xs font-medium text-ink-secondary transition-colors duration-fast ease-studio hover:border-line-strong">
            <input
              type="checkbox"
              className="h-4 w-4 rounded-xs border-line-strong accent-accent focus-visible:ring-2 focus-visible:ring-ring"
              {...createForm.register("email_verified")}
            />
            <span>Marcar correo como verificado inmediatamente</span>
          </label>
          <div className="flex justify-end gap-2.5 border-t border-dashed border-line-subtle pt-4">
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
          <label className="flex cursor-pointer items-center gap-2.5 rounded-md border border-line-subtle bg-surface-elevated/55 px-3 py-2.5 text-xs font-medium text-ink-secondary transition-colors duration-fast ease-studio hover:border-line-strong">
            <input
              type="checkbox"
              checked={editActive}
              onChange={(e) => setEditActive(e.target.checked)}
              className="h-4 w-4 rounded-xs border-line-strong accent-accent focus-visible:ring-2 focus-visible:ring-ring"
            />
            <span>Cuenta activa (permitir inicio de sesión)</span>
          </label>
          <div className="flex justify-end gap-2.5 border-t border-dashed border-line-subtle pt-4">
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
        subtitle={
          restoringUser ? `${restoringUser.display_name} · ${restoringUser.email}` : undefined
        }
        maxWidthClass="max-w-lg"
      >
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <button
              type="button"
              aria-pressed={restoreMode === "temporary_password"}
              onClick={() => setRestoreMode("temporary_password")}
              className={`rounded-lg border p-3.5 text-left text-xs transition-all duration-fast ease-studio focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                restoreMode === "temporary_password"
                  ? "border-accent bg-accent text-accent-ink shadow-sticker"
                  : "border-line-subtle bg-surface-elevated/60 text-ink-primary hover:-translate-y-px hover:border-line-diecut"
              }`}
            >
              <KeyRound className="h-4 w-4" aria-hidden="true" />
              <p className="mt-2 font-bold">Contraseña temporal</p>
              <p
                className={`mt-0.5 text-[11px] ${
                  restoreMode === "temporary_password"
                    ? "text-accent-ink/85"
                    : "text-ink-muted"
                }`}
              >
                Aplica al instante y revoca sesiones
              </p>
            </button>
            <button
              type="button"
              aria-pressed={restoreMode === "reset_link"}
              onClick={() => setRestoreMode("reset_link")}
              className={`rounded-lg border p-3.5 text-left text-xs transition-all duration-fast ease-studio focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                restoreMode === "reset_link"
                  ? "border-accent bg-accent text-accent-ink shadow-sticker"
                  : "border-line-subtle bg-surface-elevated/60 text-ink-primary hover:-translate-y-px hover:border-line-diecut"
              }`}
            >
              <Link2 className="h-4 w-4" aria-hidden="true" />
              <p className="mt-2 font-bold">Enlace de restauración</p>
              <p
                className={`mt-0.5 text-[11px] ${
                  restoreMode === "reset_link" ? "text-accent-ink/85" : "text-ink-muted"
                }`}
              >
                Genera URL segura de un solo uso
              </p>
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
              <div className="flex justify-end gap-2.5 border-t border-dashed border-line-subtle pt-4">
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
                <div className="rounded-lg border border-dashed border-line-diecut bg-accent-soft/45 p-3.5">
                  <p className="break-all font-mono text-[11px] text-ink-primary">
                    {generatedLink}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={handleCopyLink}
                    className="mt-2.5"
                    leftIcon={
                      copiedLink ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )
                    }
                  >
                    {copiedLink ? "Enlace copiado" : "Copiar enlace"}
                  </Button>
                </div>
              )}

              <div className="flex justify-end gap-2.5 border-t border-dashed border-line-subtle pt-4">
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
          <div className="flex items-start gap-3 rounded-lg border border-dashed border-state-critical-bg/70 bg-surface-elevated/60 p-3.5">
            <span
              aria-hidden="true"
              className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-state-critical-bg text-state-critical-ink"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
            </span>
            <p className="text-xs leading-relaxed text-ink-secondary">
              ¿Estás seguro de eliminar a{" "}
              <strong className="text-ink-primary">{deletingUser?.display_name}</strong> (
              <span className="font-mono text-ink-primary">{deletingUser?.email}</span>)? Se
              revocará su acceso en Firebase Auth y se eliminará de la tabla{" "}
              <code className="rounded-xs bg-surface-card px-1 py-0.5 font-mono text-ink-primary">
                users
              </code>{" "}
              (los pedidos históricos conservarán integridad mediante{" "}
              <code className="rounded-xs bg-surface-card px-1 py-0.5 font-mono text-ink-primary">
                ON DELETE SET NULL
              </code>
              ).
            </p>
          </div>
          <div className="flex justify-end gap-2.5 border-t border-dashed border-line-subtle pt-4">
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
