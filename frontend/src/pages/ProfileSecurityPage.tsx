import React, { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  Clock,
  KeyRound,
  LayoutDashboard,
  Lock,
  Mail,
  Shield,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { pageTransitionVariants } from "@/config/animations";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { StickerCard } from "@/components/ui/StickerCard";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/useToast";
import {
  changePasswordSchema,
  linkPasswordSchema,
  type ChangePasswordFormValues,
  type LinkPasswordFormValues,
} from "@/schemas/auth.schema";

export const ProfileSecurityPage: React.FC = () => {
  const {
    user,
    profile,
    hasPasswordProvider,
    changeOwnPassword,
    linkPasswordToGoogleAccount,
  } = useAuth();
  const { pushToast } = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const changeForm = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordSchema),
  });

  const linkForm = useForm<LinkPasswordFormValues>({
    resolver: zodResolver(linkPasswordSchema),
  });

  const onChangePassword = async (values: ChangePasswordFormValues) => {
    setFormError(null);
    setSuccessMsg(null);
    try {
      await changeOwnPassword(values.currentPassword, values.newPassword);
      changeForm.reset();
      const msg = "Tu contraseña se actualizó correctamente.";
      setSuccessMsg(msg);
      pushToast({ title: "Contraseña actualizada", description: msg, variant: "success" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo cambiar la contraseña.";
      setFormError(msg);
      pushToast({ title: "Error al cambiar contraseña", description: msg, variant: "error" });
    }
  };

  const onLinkPassword = async (values: LinkPasswordFormValues) => {
    setFormError(null);
    setSuccessMsg(null);
    try {
      await linkPasswordToGoogleAccount(values.newPassword);
      linkForm.reset();
      const msg =
        "Contraseña vinculada a tu cuenta Google. Ahora también puedes ingresar con correo/contraseña y cambiarla cuando quieras.";
      setSuccessMsg(msg);
      pushToast({ title: "Contraseña configurada", description: msg, variant: "success" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo vincular la contraseña.";
      setFormError(msg);
      pushToast({ title: "Error al configurar contraseña", description: msg, variant: "error" });
    }
  };

  return (
    <motion.div
      variants={pageTransitionVariants}
      initial="initial"
      animate="animate"
      className="space-y-6"
    >
      {/* Band 1: Studio Profile Command Header with Quick Return Shortcuts */}
      <StickerCard padding="md" className="bg-print-grid overflow-hidden">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-diecut/75 bg-surface-card px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-accent shadow-xs">
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                Seguridad de Cuenta · RBAC
              </span>
              <span className="sticker-badge inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase text-accent-ink">
                <Shield className="h-3 w-3" aria-hidden="true" />
                {profile?.role_name || profile?.role || "Operador"}
              </span>
            </div>

            <div>
              <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink-primary sm:text-3xl">
                Mi Perfil y Seguridad de Cuenta
              </h1>
              <p className="mt-0.5 text-xs text-ink-secondary sm:text-sm">
                Verifica tu identidad, rol RBAC en PostgreSQL y gestiona el cambio de tu contraseña.
              </p>
            </div>
          </div>

          {/* Quick-Access Navigation Shortcuts */}
          <div className="flex flex-wrap items-center gap-2.5 lg:shrink-0">
            <Link
              to="/dashboard/orders?only_pending=true"
              className="group inline-flex h-11 items-center gap-2 rounded-md border border-dashed border-line-diecut/80 bg-surface-card px-4 text-xs font-semibold text-ink-primary shadow-xs transition-all duration-fast ease-studio hover:-translate-y-px hover:border-line-diecut hover:bg-accent-soft/60 hover:shadow-sticker focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card"
            >
              <Clock className="h-4 w-4 text-accent" aria-hidden="true" />
              <span>Trabajos pendientes</span>
              <ArrowRight
                className="h-3.5 w-3.5 text-ink-muted transition-transform duration-fast ease-studio group-hover:translate-x-0.5 group-hover:text-accent"
                aria-hidden="true"
              />
            </Link>

            <Link
              to="/dashboard"
              className="inline-flex h-11 items-center gap-2 rounded-md border border-line-strong bg-surface-card px-4 text-xs font-semibold text-ink-primary shadow-xs transition-all duration-fast ease-studio hover:-translate-y-px hover:border-line-diecut hover:bg-surface-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card"
            >
              <LayoutDashboard className="h-4 w-4 text-accent" aria-hidden="true" />
              <span>Resumen taller</span>
            </Link>
          </div>
        </div>
      </StickerCard>

      {/* Band 2: Identity Rail & Featured Password Security Card */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        {/* Account Identity Summary */}
        <StickerCard
          peel
          dieCut
          registrationMarks
          padding="md"
          className="space-y-5 lg:col-span-5"
        >
          <div className="flex items-center gap-3.5 border-b border-dashed border-line-subtle pb-4">
            <div className="sticker-badge flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent font-display text-base font-extrabold text-accent-ink">
              {(profile?.display_name || user?.displayName || user?.email || "U")
                .slice(0, 1)
                .toUpperCase()}
            </div>
            <div className="min-w-0">
              <h2 className="truncate font-display text-base font-extrabold tracking-tight text-ink-primary">
                {profile?.display_name || user?.displayName || "Usuario"}
              </h2>
              <p className="truncate font-mono text-xs text-ink-muted">{user?.email}</p>
            </div>
          </div>

          <dl className="space-y-2.5 text-xs">
            <div className="flex items-center justify-between gap-2 rounded-md border border-line-subtle/60 bg-surface-elevated/60 px-3 py-2.5">
              <dt className="flex items-center gap-1.5 text-ink-muted">
                <Shield className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                Rol asignado (BD Relacional)
              </dt>
              <dd className="sticker-badge rounded-full bg-accent px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase text-accent-ink">
                {profile?.role_name || profile?.role || "Operador"}
              </dd>
            </div>

            <div className="flex items-center justify-between gap-2 rounded-md border border-line-subtle/60 bg-surface-elevated/60 px-3 py-2.5">
              <dt className="flex items-center gap-1.5 text-ink-muted">
                <Mail className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                Confirmación de Email
              </dt>
              <dd
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                  user?.emailVerified
                    ? "bg-state-info-bg text-state-info-ink"
                    : "border border-dashed border-line-diecut bg-accent-soft text-accent"
                }`}
              >
                <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                {user?.emailVerified ? "Verificado" : "Pendiente"}
              </dd>
            </div>

            <div className="flex items-center justify-between gap-2 rounded-md border border-line-subtle/60 bg-surface-elevated/60 px-3 py-2.5">
              <dt className="flex items-center gap-1.5 text-ink-muted">
                <UserCheck className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                Método de acceso
              </dt>
              <dd className="font-mono font-semibold text-ink-primary">
                {hasPasswordProvider ? "Correo/Contraseña" : "Google OAuth"}
              </dd>
            </div>
          </dl>

          <div className="rounded-lg border border-dashed border-line-diecut/70 bg-accent-soft/35 p-3.5 text-[11px] leading-relaxed text-ink-secondary">
            <div className="flex items-center gap-1.5 font-bold text-ink-primary">
              <ShieldCheck className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
              <span>Re-autenticación obligatoria</span>
            </div>
            <p className="mt-1">
              Por seguridad, cambiar la contraseña valida primero tu contraseña actual contra
              Firebase Auth antes de aplicar la nueva credencial.
            </p>
          </div>
        </StickerCard>

        {/* Change Password / Link Password Form */}
        <StickerCard tone="featured" padding="lg" className="lg:col-span-7">
          <div className="mb-5 flex items-center gap-3 border-b border-dashed border-line-subtle pb-4">
            <span
              aria-hidden="true"
              className="sticker-badge flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent text-accent-ink"
            >
              <KeyRound className="h-4 w-4" />
            </span>
            <div>
              <h2 className="font-display text-base font-extrabold tracking-tight text-ink-primary">
                {hasPasswordProvider
                  ? "Cambiar Contraseña en Sesión de Usuario"
                  : "Configurar Contraseña para tu Cuenta Google"}
              </h2>
              <p className="mt-0.5 text-xs text-ink-muted">
                {hasPasswordProvider
                  ? "Ingresa tu contraseña actual y define una nueva clave segura."
                  : "Ingresaste con Google OAuth. Vincula una contraseña para poder iniciar sesión y cambiarla también con correo y clave."}
              </p>
            </div>
          </div>

          {hasPasswordProvider ? (
            <form
              onSubmit={changeForm.handleSubmit(onChangePassword)}
              noValidate
              className="space-y-4"
            >
              <Input
                label="Contraseña actual *"
                type="password"
                autoComplete="current-password"
                placeholder="Tu contraseña actual"
                leftIcon={<Lock className="h-4 w-4" />}
                error={changeForm.formState.errors.currentPassword?.message}
                {...changeForm.register("currentPassword")}
              />
              <Input
                label="Nueva contraseña *"
                type="password"
                autoComplete="new-password"
                placeholder="Mínimo 8 caracteres con letras y números"
                leftIcon={<KeyRound className="h-4 w-4" />}
                error={changeForm.formState.errors.newPassword?.message}
                {...changeForm.register("newPassword")}
              />
              <Input
                label="Confirmar nueva contraseña *"
                type="password"
                autoComplete="new-password"
                placeholder="Repite tu nueva contraseña"
                leftIcon={<KeyRound className="h-4 w-4" />}
                error={changeForm.formState.errors.confirmNewPassword?.message}
                {...changeForm.register("confirmNewPassword")}
              />

              {formError && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-lg border border-state-critical-bg bg-state-critical-bg px-3.5 py-2.5 text-xs font-semibold text-state-critical-ink"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{formError}</span>
                </div>
              )}

              {successMsg && (
                <div
                  role="status"
                  className="flex items-start gap-2.5 rounded-lg border border-dashed border-line-diecut bg-accent-soft px-3.5 py-2.5 text-xs font-semibold text-ink-primary"
                >
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                  <span>{successMsg}</span>
                </div>
              )}

              <div className="flex justify-end border-t border-dashed border-line-subtle pt-4">
                <Button
                  type="submit"
                  size="lg"
                  loading={changeForm.formState.isSubmitting}
                  leftIcon={<KeyRound className="h-4 w-4" />}
                  className="w-full sm:w-auto"
                >
                  Actualizar contraseña
                </Button>
              </div>
            </form>
          ) : (
            <form
              onSubmit={linkForm.handleSubmit(onLinkPassword)}
              noValidate
              className="space-y-4"
            >
              <Input
                label="Nueva contraseña *"
                type="password"
                autoComplete="new-password"
                placeholder="Mínimo 8 caracteres con letras y números"
                leftIcon={<KeyRound className="h-4 w-4" />}
                error={linkForm.formState.errors.newPassword?.message}
                {...linkForm.register("newPassword")}
              />
              <Input
                label="Confirmar contraseña *"
                type="password"
                autoComplete="new-password"
                placeholder="Repite la contraseña"
                leftIcon={<KeyRound className="h-4 w-4" />}
                error={linkForm.formState.errors.confirmNewPassword?.message}
                {...linkForm.register("confirmNewPassword")}
              />

              {formError && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-lg border border-state-critical-bg bg-state-critical-bg px-3.5 py-2.5 text-xs font-semibold text-state-critical-ink"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{formError}</span>
                </div>
              )}

              {successMsg && (
                <div
                  role="status"
                  className="flex items-start gap-2.5 rounded-lg border border-dashed border-line-diecut bg-accent-soft px-3.5 py-2.5 text-xs font-semibold text-ink-primary"
                >
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                  <span>{successMsg}</span>
                </div>
              )}

              <div className="flex justify-end border-t border-dashed border-line-subtle pt-4">
                <Button
                  type="submit"
                  size="lg"
                  loading={linkForm.formState.isSubmitting}
                  leftIcon={<KeyRound className="h-4 w-4" />}
                  className="w-full sm:w-auto"
                >
                  Vincular contraseña
                </Button>
              </div>
            </form>
          )}
        </StickerCard>
      </div>
    </motion.div>
  );
};
