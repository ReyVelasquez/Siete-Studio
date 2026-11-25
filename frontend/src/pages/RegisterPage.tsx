import React, { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { useForm } from "react-hook-form";
import { Link, Navigate, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Clock,
  Lock,
  Mail,
  MailCheck,
  Scissors,
  ShieldCheck,
  User,
} from "lucide-react";
import { pageTransitionVariants } from "@/config/animations";
import { THEME_CONFIG } from "@/config/theme.config";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { StickerBadge } from "@/components/ui/StickerBadge";
import { StickerCard } from "@/components/ui/StickerCard";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/useToast";
import { registerSchema, type RegisterFormValues } from "@/schemas/auth.schema";

export const RegisterPage: React.FC = () => {
  const { user, registerWithEmail, loginWithGoogle } = useAuth();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const [googleLoading, setGoogleLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
  });

  if (user) {
    return <Navigate to={user.emailVerified ? "/dashboard" : "/verify-email"} replace />;
  }

  const onSubmit = async (values: RegisterFormValues) => {
    setAuthError(null);
    try {
      await registerWithEmail(values.displayName, values.email, values.password);
      pushToast({
        title: "Cuenta creada · Confirmación enviada",
        description: `Enviamos un enlace de verificación a ${values.email}.`,
        variant: "success",
      });
      navigate("/verify-email", { replace: true });
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "No se pudo crear la cuenta.");
    }
  };

  const handleGoogle = async () => {
    setAuthError(null);
    setGoogleLoading(true);
    try {
      await loginWithGoogle();
      pushToast({ title: "Acceso con Google completado", variant: "success" });
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Error al continuar con Google.");
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-surface-canvas bg-print-grid text-ink-primary">
      {/* Top Utility Bar */}
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-5 sm:px-6">
        <Link
          to="/"
          className="group inline-flex h-9 items-center gap-2 rounded-full border border-line-subtle bg-surface-card px-3.5 text-xs font-semibold text-ink-secondary shadow-xs transition-all duration-fast ease-studio hover:-translate-y-px hover:border-line-diecut hover:bg-surface-elevated hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas"
        >
          <ArrowLeft
            className="h-3.5 w-3.5 text-accent transition-transform duration-fast ease-studio group-hover:-translate-x-0.5"
            aria-hidden="true"
          />
          <span>Volver al portal público</span>
        </Link>

        <div className="flex items-center gap-2.5">
          <Link
            to="/login"
            className="hidden h-9 items-center gap-1.5 rounded-full border border-line-strong bg-surface-card px-3.5 text-xs font-semibold text-ink-primary shadow-xs transition-all duration-fast ease-studio hover:-translate-y-px hover:border-line-diecut hover:bg-accent-soft/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas sm:inline-flex"
          >
            <span>Iniciar sesión</span>
          </Link>
          <ThemeToggle />
        </div>
      </header>

      {/* Main Split Studio Auth Workspace */}
      <motion.main
        variants={pageTransitionVariants}
        initial="initial"
        animate="animate"
        className="mx-auto flex w-full max-w-5xl flex-1 items-center px-4 pb-12 pt-2 sm:px-6"
      >
        <div className="grid w-full grid-cols-1 items-center gap-6 lg:grid-cols-12 lg:gap-8">
          {/* Left Context Rail (Desktop): Studio Onboarding & Workflow Overview */}
          <aside className="order-2 space-y-5 lg:order-1 lg:col-span-5">
            <div className="hidden lg:block">
              <BrandLogo showTagline />
            </div>

            <StickerCard dieCut registrationMarks padding="md" className="space-y-5">
              <div className="space-y-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-diecut/75 bg-accent-soft px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-accent">
                  <Scissors className="h-3 w-3" aria-hidden="true" />
                  Alta en el Taller
                </span>
                <h2 className="font-display text-lg font-extrabold tracking-tight text-ink-primary">
                  Únete al flujo de producción de stickers
                </h2>
                <p className="text-xs leading-relaxed text-ink-secondary">
                  Crea tu acceso en segundos para coordinar trabajos pendientes, aprobar archivos y trabajar con las herramientas de preprensa.
                </p>
              </div>

              {/* Live Production Pipeline Badges */}
              <div className="space-y-2 border-t border-dashed border-line-subtle pt-4">
                <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-ink-muted">
                  Flujo del Estudio
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <StickerBadge status="Pendiente" size="sm" />
                  <StickerBadge status="En Diseño" size="sm" />
                  <StickerBadge status="Troquelado" size="sm" />
                  <StickerBadge status="Listo" size="sm" />
                </div>
              </div>

              {/* Onboarding Steps */}
              <ul className="space-y-2.5 border-t border-dashed border-line-subtle pt-4 text-xs">
                <li className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
                    <MailCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="font-bold text-ink-primary">Verificación inmediata</p>
                    <p className="text-[11px] text-ink-muted">
                      Confirmamos tu correo o vinculamos tu cuenta Google de forma segura.
                    </p>
                  </div>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
                    <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="font-bold text-ink-primary">Acceso directo a pendientes</p>
                    <p className="text-[11px] text-ink-muted">
                      Revisa prioridades por hora, calidad CMYK y corte troquelado en un solo lugar.
                    </p>
                  </div>
                </li>
              </ul>
            </StickerCard>
          </aside>

          {/* Right Primary Column: Registration Card (First on Mobile, Featured on Desktop) */}
          <section className="order-1 mx-auto w-full max-w-md lg:order-2 lg:col-span-7 lg:max-w-none">
            <div className="mb-5 flex justify-center lg:hidden">
              <BrandLogo showTagline />
            </div>

            <StickerCard tone="featured" padding="lg" className="mx-auto w-full max-w-md">
              <div className="text-center">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line-subtle bg-surface-elevated px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-ink-secondary">
                  <ShieldCheck className="h-3 w-3 text-accent" aria-hidden="true" />
                  Registro Seguro · Taller
                </span>
                <h1 className="mt-3 font-display text-2xl font-extrabold tracking-tight text-ink-primary">
                  {THEME_CONFIG.copy.auth.registerTitle}
                </h1>
                <p className="mt-1.5 text-xs text-ink-muted">
                  {THEME_CONFIG.copy.auth.registerSubtitle}
                </p>
              </div>

              {/* Quick-Access Google Sign-up */}
              <div className="mt-6">
                <Button
                  type="button"
                  variant="dieCut"
                  size="lg"
                  fullWidth
                  loading={googleLoading}
                  onClick={handleGoogle}
                  leftIcon={
                    <svg className="h-4 w-4 text-accent" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M21.35 11.1h-9.18v2.98h5.27c-.23 1.48-1.69 4.35-5.27 4.35-3.17 0-5.76-2.62-5.76-5.85s2.59-5.85 5.76-5.85c1.81 0 3.01.77 3.7 1.43l2.52-2.43C16.78 4.22 14.68 3.3 12.17 3.3 7.1 3.3 3 7.4 3 12.5s4.1 9.2 9.17 9.2c5.3 0 8.81-3.72 8.81-8.97 0-.6-.06-1.06-.15-1.63Z"
                      />
                    </svg>
                  }
                >
                  Continuar con Google
                </Button>
              </div>

              <div className="my-5 flex items-center gap-3">
                <div className="h-px flex-1 border-t border-dashed border-line-subtle" />
                <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-ink-muted">
                  registro con correo
                </span>
                <div className="h-px flex-1 border-t border-dashed border-line-subtle" />
              </div>

              <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-3.5">
                <Input
                  label="Nombre completo"
                  placeholder="Ej. Valeria Mendoza"
                  leftIcon={<User className="h-4 w-4" />}
                  error={errors.displayName?.message}
                  {...register("displayName")}
                />
                <Input
                  label="Correo electrónico"
                  type="email"
                  autoComplete="email"
                  placeholder="nombre@gmail.com"
                  leftIcon={<Mail className="h-4 w-4" />}
                  error={errors.email?.message}
                  {...register("email")}
                />
                <Input
                  label="Contraseña"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Mínimo 8 caracteres y un número"
                  leftIcon={<Lock className="h-4 w-4" />}
                  error={errors.password?.message}
                  {...register("password")}
                />
                <Input
                  label="Confirmar contraseña"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Repite tu contraseña"
                  leftIcon={<Lock className="h-4 w-4" />}
                  error={errors.confirmPassword?.message}
                  {...register("confirmPassword")}
                />

                {authError && (
                  <div
                    role="alert"
                    className="flex items-start gap-2.5 rounded-lg border border-state-critical-bg bg-state-critical-bg px-3.5 py-2.5 text-xs font-semibold text-state-critical-ink"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{authError}</span>
                  </div>
                )}

                <div className="pt-1">
                  <Button
                    type="submit"
                    fullWidth
                    size="lg"
                    loading={isSubmitting}
                    rightIcon={<ArrowRight className="h-4 w-4" />}
                  >
                    Registrar cuenta
                  </Button>
                </div>
              </form>

              <div className="mt-6 border-t border-dashed border-line-subtle pt-4 text-center text-xs text-ink-muted">
                ¿Ya tienes una cuenta?{" "}
                <Link
                  to="/login"
                  className="rounded-xs font-bold text-accent transition-colors duration-fast ease-studio hover:text-accent-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card"
                >
                  Iniciar sesión
                </Link>
              </div>
            </StickerCard>
          </section>
        </div>
      </motion.main>
    </div>
  );
};
