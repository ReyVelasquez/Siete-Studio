import React, { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Mail, Send } from "lucide-react";
import { pageTransitionVariants } from "@/config/animations";
import { THEME_CONFIG } from "@/config/theme.config";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { StickerCard } from "@/components/ui/StickerCard";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useAuth } from "@/contexts/AuthContext";
import { forgotPasswordSchema, type ForgotPasswordFormValues } from "@/schemas/auth.schema";

export const ForgotPasswordPage: React.FC = () => {
  const { sendPasswordReset } = useAuth();
  const [sentEmail, setSentEmail] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
  });

  const onSubmit = async (values: ForgotPasswordFormValues) => {
    setErrorMsg(null);
    try {
      await sendPasswordReset(values.email);
      setSentEmail(values.email);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "No se pudo enviar el correo.");
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-surface-canvas bg-print-grid">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Link
          to="/login"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-secondary hover:text-ink-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Volver a iniciar sesión</span>
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
          {sentEmail ? (
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-ink">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <h1 className="mt-4 font-display text-xl font-extrabold text-ink-primary">
                Enlace de recuperación enviado
              </h1>
              <p className="mt-2 text-xs leading-relaxed text-ink-secondary">
                Si <strong className="font-mono text-ink-primary">{sentEmail}</strong> está
                registrado, recibirás un correo (revisa tu bandeja de Gmail o carpeta de spam) con
                el enlace seguro para restablecer tu contraseña.
              </p>
              <div className="mt-6 flex flex-col gap-2.5">
                <Link to="/login">
                  <Button fullWidth>Volver a Iniciar Sesión</Button>
                </Link>
                <button
                  type="button"
                  onClick={() => setSentEmail(null)}
                  className="text-xs font-semibold text-ink-muted hover:text-ink-primary"
                >
                  Intentar con otro correo
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="text-center">
                <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink-primary">
                  {THEME_CONFIG.copy.auth.forgotTitle}
                </h1>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
                  {THEME_CONFIG.copy.auth.forgotSubtitle}
                </p>
              </div>

              <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-6 space-y-4">
                <Input
                  label="Correo electrónico registrado"
                  type="email"
                  autoComplete="email"
                  placeholder="tucorreo@gmail.com"
                  leftIcon={<Mail className="h-4 w-4" />}
                  error={errors.email?.message}
                  {...register("email")}
                />

                {errorMsg && (
                  <div
                    role="alert"
                    className="rounded-lg border border-brand-800 bg-brand-950 px-3.5 py-2.5 text-xs font-medium text-brand-50 dark:border-brand-300 dark:bg-brand-900"
                  >
                    {errorMsg}
                  </div>
                )}

                <Button
                  type="submit"
                  fullWidth
                  size="lg"
                  loading={isSubmitting}
                  rightIcon={<Send className="h-4 w-4" />}
                >
                  Enviar enlace de restablecimiento
                </Button>
              </form>
            </>
          )}
        </StickerCard>
      </motion.div>
    </div>
  );
};
