import React, { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  KeyRound,
  Mail,
  MailCheck,
  RotateCcw,
  Send,
} from "lucide-react";
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
    <div className="flex min-h-screen flex-col bg-surface-canvas bg-print-grid text-ink-primary">
      {/* Top Utility Bar */}
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-5 sm:px-6">
        <Link
          to="/login"
          className="group inline-flex h-9 items-center gap-2 rounded-full border border-line-subtle bg-surface-card px-3.5 text-xs font-semibold text-ink-secondary shadow-xs transition-all duration-fast ease-studio hover:-translate-y-px hover:border-line-diecut hover:bg-surface-elevated hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas"
        >
          <ArrowLeft
            className="h-3.5 w-3.5 text-accent transition-transform duration-fast ease-studio group-hover:-translate-x-0.5"
            aria-hidden="true"
          />
          <span>Volver a iniciar sesión</span>
        </Link>

        <div className="flex items-center gap-2.5">
          <Link
            to="/"
            className="hidden h-9 items-center gap-1.5 rounded-full border border-line-strong bg-surface-card px-3.5 text-xs font-semibold text-ink-primary shadow-xs transition-all duration-fast ease-studio hover:-translate-y-px hover:border-line-diecut hover:bg-accent-soft/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas sm:inline-flex"
          >
            <span>Portal público</span>
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <motion.main
        variants={pageTransitionVariants}
        initial="initial"
        animate="animate"
        className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 pb-12 pt-2"
      >
        <div className="mb-6 flex justify-center">
          <BrandLogo showTagline />
        </div>

        <StickerCard dieCut registrationMarks tone="featured" padding="lg">
          {sentEmail ? (
            <div className="text-center">
              <div className="sticker-badge mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-ink">
                <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
              </div>

              <span className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-diecut/70 bg-accent-soft px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-accent">
                <MailCheck className="h-3 w-3" aria-hidden="true" />
                Correo enviado
              </span>

              <h1 className="mt-2.5 font-display text-xl font-extrabold tracking-tight text-ink-primary sm:text-2xl">
                Enlace de recuperación enviado
              </h1>

              <div className="mt-4 rounded-lg border border-dashed border-line-diecut/70 bg-accent-soft/45 px-3.5 py-2.5">
                <span className="block font-mono text-[10px] font-bold uppercase tracking-widest text-ink-muted">
                  Destinatario
                </span>
                <strong className="mt-0.5 block truncate font-mono text-xs font-bold text-ink-primary">
                  {sentEmail}
                </strong>
              </div>

              <p className="mt-3 text-xs leading-relaxed text-ink-secondary">
                Si esta dirección está registrada, recibirás un correo (revisa tu bandeja de Gmail
                o carpeta de spam) con el enlace seguro para restablecer tu contraseña.
              </p>

              <div className="mt-6 flex flex-col gap-2.5">
                <Link
                  to="/login"
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-accent px-6 text-sm font-semibold tracking-tight text-accent-ink shadow-xs transition-all duration-fast ease-studio hover:-translate-y-px hover:bg-accent-hover hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card active:scale-[0.985]"
                >
                  <span>Volver a Iniciar Sesión</span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Button
                  type="button"
                  variant="dieCut"
                  size="md"
                  fullWidth
                  onClick={() => setSentEmail(null)}
                  leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
                >
                  Intentar con otro correo
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="text-center">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line-subtle bg-surface-elevated px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-ink-secondary">
                  <KeyRound className="h-3 w-3 text-accent" aria-hidden="true" />
                  Recuperación de Acceso
                </span>
                <h1 className="mt-3 font-display text-2xl font-extrabold tracking-tight text-ink-primary">
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
                    className="flex items-start gap-2.5 rounded-lg border border-state-critical-bg bg-state-critical-bg px-3.5 py-2.5 text-xs font-semibold text-state-critical-ink"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{errorMsg}</span>
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

              <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-line-subtle pt-4 text-xs text-ink-muted">
                <Link
                  to="/login"
                  className="rounded-xs font-semibold text-ink-secondary transition-colors duration-fast ease-studio hover:text-ink-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Recordé mi contraseña
                </Link>
                <Link
                  to="/register"
                  className="rounded-xs font-bold text-accent transition-colors duration-fast ease-studio hover:text-accent-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Crear cuenta
                </Link>
              </div>
            </>
          )}
        </StickerCard>
      </motion.main>
    </div>
  );
};
