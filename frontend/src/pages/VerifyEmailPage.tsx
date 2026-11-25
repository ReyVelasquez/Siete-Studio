import React, { useState } from "react";
import { motion } from "framer-motion";
import { Navigate, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  LogOut,
  MailCheck,
  Send,
} from "lucide-react";
import { pageTransitionVariants } from "@/config/animations";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { Button } from "@/components/ui/Button";
import { StickerCard } from "@/components/ui/StickerCard";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/useToast";

export const VerifyEmailPage: React.FC = () => {
  const { user, resendVerificationEmail, refreshEmailVerification, logout } = useAuth();
  const { pushToast } = useToast();
  const navigate = useNavigate();

  const [resending, setResending] = useState(false);
  const [checking, setChecking] = useState(false);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.emailVerified) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleResend = async () => {
    setResending(true);
    try {
      await resendVerificationEmail();
      pushToast({
        title: "Correo de confirmación reenviado",
        description: `Revisa tu bandeja de entrada o spam en ${user.email}.`,
        variant: "success",
      });
    } catch (err) {
      pushToast({
        title: "No se pudo reenviar el correo",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setResending(false);
    }
  };

  const handleCheckVerified = async () => {
    setChecking(true);
    try {
      const verified = await refreshEmailVerification();
      if (verified) {
        pushToast({
          title: "¡Correo confirmado con éxito!",
          description: "Tu cuenta está verificada. Bienvenido al panel.",
          variant: "success",
        });
        navigate("/dashboard", { replace: true });
      } else {
        pushToast({
          title: "Aún pendiente de confirmación",
          description: "Haz clic primero en el enlace que llegó a tu correo y vuelve a intentar.",
          variant: "info",
        });
      }
    } catch (err) {
      pushToast({
        title: "Error verificando estado",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setChecking(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="flex min-h-screen flex-col bg-surface-canvas bg-print-grid text-ink-primary">
      {/* Top Utility Bar */}
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-5 sm:px-6">
        <BrandLogo showTagline />
        <ThemeToggle />
      </header>

      <motion.main
        variants={pageTransitionVariants}
        initial="initial"
        animate="animate"
        className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 pb-12 pt-2"
      >
        <StickerCard
          dieCut
          registrationMarks
          tone="featured"
          padding="lg"
          className="text-center"
        >
          <div className="sticker-badge mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-ink">
            <MailCheck className="h-7 w-7" aria-hidden="true" />
          </div>

          <span className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-diecut/75 bg-accent-soft px-3 py-0.5 font-mono text-[10px] font-bold uppercase tracking-widest text-accent">
            <Clock className="h-3 w-3" aria-hidden="true" />
            Verificación Pendiente · Paso Final
          </span>

          <h1 className="mt-3 font-display text-2xl font-extrabold tracking-tight text-ink-primary sm:text-3xl">
            Confirma tu correo electrónico
          </h1>

          {/* Target Email Ticket */}
          <div className="mt-4 rounded-lg border border-dashed border-line-diecut/70 bg-accent-soft/45 px-4 py-3">
            <span className="block font-mono text-[10px] font-bold uppercase tracking-widest text-ink-muted">
              Enlace enviado a
            </span>
            <strong className="mt-0.5 block truncate font-mono text-sm font-bold text-ink-primary">
              {user.email}
            </strong>
          </div>

          {/* Concise Verification Checklist */}
          <ol className="mt-4 grid grid-cols-1 gap-2 rounded-lg border border-line-subtle bg-surface-elevated/55 p-3.5 text-left text-xs sm:grid-cols-3">
            <li className="flex items-start gap-2 sm:flex-col sm:gap-1">
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent font-mono text-[10px] font-bold text-accent-ink">
                1
              </span>
              <span className="text-ink-secondary">
                Abre tu correo (revisa Spam o Promociones).
              </span>
            </li>
            <li className="flex items-start gap-2 sm:flex-col sm:gap-1">
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent font-mono text-[10px] font-bold text-accent-ink">
                2
              </span>
              <span className="text-ink-secondary">
                Haz clic en el enlace seguro de verificación.
              </span>
            </li>
            <li className="flex items-start gap-2 sm:flex-col sm:gap-1">
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent font-mono text-[10px] font-bold text-accent-ink">
                3
              </span>
              <span className="text-ink-secondary">
                Vuelve aquí y presiona continuar al taller.
              </span>
            </li>
          </ol>

          {/* Primary & Quick Action Stack */}
          <div className="mt-6 flex flex-col gap-3">
            <Button
              type="button"
              size="lg"
              fullWidth
              loading={checking}
              onClick={handleCheckVerified}
              leftIcon={<CheckCircle2 className="h-4 w-4" />}
              rightIcon={<ArrowRight className="h-4 w-4" />}
            >
              Ya confirmé mi correo · Continuar
            </Button>

            <Button
              type="button"
              variant="dieCut"
              size="md"
              fullWidth
              loading={resending}
              onClick={handleResend}
              leftIcon={<Send className="h-4 w-4" />}
            >
              Reenviar correo de confirmación
            </Button>

            <div className="border-t border-dashed border-line-subtle pt-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                fullWidth
                onClick={handleLogout}
                leftIcon={<LogOut className="h-4 w-4" />}
              >
                Cerrar sesión y usar otra cuenta
              </Button>
            </div>
          </div>
        </StickerCard>
      </motion.main>
    </div>
  );
};
