import React, { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { useForm } from "react-hook-form";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Lock, Mail } from "lucide-react";
import { pageTransitionVariants } from "@/config/animations";
import { THEME_CONFIG } from "@/config/theme.config";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { StickerCard } from "@/components/ui/StickerCard";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/useToast";
import { loginSchema, type LoginFormValues } from "@/schemas/auth.schema";

export const LoginPage: React.FC = () => {
  const { user, isConfigured, loginWithEmail, loginWithGoogle } = useAuth();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [googleLoading, setGoogleLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const redirectTo =
    (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || "/dashboard";

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
  });

  if (user) {
    return <Navigate to={redirectTo} replace />;
  }

  const onSubmit = async (values: LoginFormValues) => {
    setAuthError(null);
    try {
      await loginWithEmail(values.email, values.password);
      pushToast({ title: "Bienvenido al panel", variant: "success" });
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "No se pudo iniciar sesión.");
    }
  };

  const handleGoogleLogin = async () => {
    setAuthError(null);
    setGoogleLoading(true);
    try {
      await loginWithGoogle();
      pushToast({ title: "Sesión iniciada con Google", variant: "success" });
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Error al iniciar sesión con Google.");
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-surface-canvas bg-print-grid">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-secondary hover:text-ink-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Volver al portal público</span>
        </Link>
        <ThemeToggle />
      </div>

      <motion.div
        variants={pageTransitionVariants}
        initial="initial"
        animate="animate"
        className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 pb-12"
      >
        <div className="mb-6 flex justify-center">
          <BrandLogo showTagline />
        </div>

        <StickerCard padding="lg">
          <div className="text-center">
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink-primary">
              {THEME_CONFIG.copy.auth.loginTitle}
            </h1>
            <p className="mt-1.5 text-xs text-ink-muted">
              {THEME_CONFIG.copy.auth.loginSubtitle}
            </p>
          </div>

          {!isConfigured && (
            <div className="mt-5 rounded-lg border border-dashed border-line-diecut bg-surface-elevated p-3 text-xs text-ink-secondary">
              Configura las variables <code className="font-mono font-bold">VITE_FIREBASE_*</code> en{" "}
              <code className="font-mono font-bold">frontend/.env</code> para habilitar el inicio de sesión.
            </div>
          )}

          <div className="mt-6">
            <Button
              type="button"
              variant="outline"
              fullWidth
              loading={googleLoading}
              onClick={handleGoogleLogin}
              leftIcon={
                <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
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
            <div className="h-px flex-1 bg-line-subtle" />
            <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-ink-muted">
              o con tu correo
            </span>
            <div className="h-px flex-1 bg-line-subtle" />
          </div>

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <Input
              label="Correo electrónico"
              type="email"
              autoComplete="email"
              placeholder="operador@taller.com"
              leftIcon={<Mail className="h-4 w-4" />}
              error={errors.email?.message}
              {...register("email")}
            />

            <Input
              label="Contraseña"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              leftIcon={<Lock className="h-4 w-4" />}
              error={errors.password?.message}
              {...register("password")}
            />

            <div className="flex justify-end">
              <Link
                to="/forgot-password"
                className="text-xs font-semibold text-accent hover:underline"
              >
                ¿Olvidaste tu contraseña?
              </Link>
            </div>

            {authError && (
              <div
                role="alert"
                className="rounded-lg border border-brand-800 bg-brand-950 px-3.5 py-2.5 text-xs font-medium text-brand-50 dark:border-brand-300 dark:bg-brand-900"
              >
                {authError}
              </div>
            )}

            <Button type="submit" fullWidth size="lg" loading={isSubmitting}>
              Iniciar sesión
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-ink-muted">
            ¿Nuevo en el equipo?{" "}
            <Link to="/register" className="font-bold text-accent hover:underline">
              Crear cuenta
            </Link>
          </p>
        </StickerCard>
      </motion.div>
    </div>
  );
};
