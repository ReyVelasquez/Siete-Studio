import React, { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { useForm } from "react-hook-form";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ArrowLeft, Lock, Mail, User } from "lucide-react";
import { pageTransitionVariants } from "@/config/animations";
import { THEME_CONFIG } from "@/config/theme.config";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
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
    return <Navigate to="/dashboard" replace />;
  }

  const onSubmit = async (values: RegisterFormValues) => {
    setAuthError(null);
    try {
      await registerWithEmail(values.displayName, values.email, values.password);
      pushToast({ title: "Cuenta creada correctamente", variant: "success" });
      navigate("/dashboard", { replace: true });
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
              {THEME_CONFIG.copy.auth.registerTitle}
            </h1>
            <p className="mt-1.5 text-xs text-ink-muted">
              {THEME_CONFIG.copy.auth.registerSubtitle}
            </p>
          </div>

          <div className="mt-6">
            <Button
              type="button"
              variant="outline"
              fullWidth
              loading={googleLoading}
              onClick={handleGoogle}
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
              registro con correo
            </span>
            <div className="h-px flex-1 bg-line-subtle" />
          </div>

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
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
                className="rounded-lg border border-brand-800 bg-brand-950 px-3.5 py-2.5 text-xs font-medium text-brand-50 dark:border-brand-300 dark:bg-brand-900"
              >
                {authError}
              </div>
            )}

            <Button type="submit" fullWidth size="lg" loading={isSubmitting}>
              Registrar cuenta
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-ink-muted">
            ¿Ya tienes una cuenta?{" "}
            <Link to="/login" className="font-bold text-accent hover:underline">
              Iniciar sesión
            </Link>
          </p>
        </StickerCard>
      </motion.div>
    </div>
  );
};
