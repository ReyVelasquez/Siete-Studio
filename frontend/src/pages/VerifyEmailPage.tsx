import React, { useState } from "react";
import { motion } from "framer-motion";
import { Navigate, useNavigate } from "react-router-dom";
import { CheckCircle2, LogOut, MailCheck, RefreshCw, Send } from "lucide-react";
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
    <div className="flex min-h-screen flex-col bg-surface-canvas bg-print-grid">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <BrandLogo showTagline />
        <ThemeToggle />
      </div>

      <motion.div
        variants={pageTransitionVariants}
        initial="initial"
        animate="animate"
        className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 pb-12"
      >
        <StickerCard dieCut padding="lg" className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-ink shadow-sticker">
            <MailCheck className="h-7 w-7" />
          </div>

          <span className="mt-4 inline-block rounded-full border border-dashed border-line-diecut bg-surface-elevated px-3 py-0.5 font-mono text-[10px] font-bold uppercase tracking-widest text-accent">
            Confirmación por Email Requerida
          </span>

          <h1 className="mt-3 font-display text-2xl font-extrabold tracking-tight text-ink-primary">
            Confirma tu correo electrónico
          </h1>

          <p className="mt-2 text-xs leading-relaxed text-ink-secondary">
            Enviamos un enlace de confirmación a{" "}
            <strong className="font-mono text-ink-primary">{user.email}</strong>. Abre ese enlace en
            tu correo (revisa también Spam o Promociones) y luego presiona el botón para continuar.
          </p>

          <div className="mt-6 flex flex-col gap-3">
            <Button
              type="button"
              size="lg"
              fullWidth
              loading={checking}
              onClick={handleCheckVerified}
              leftIcon={<CheckCircle2 className="h-4 w-4" />}
            >
              Ya confirmé mi correo · Continuar
            </Button>

            <Button
              type="button"
              variant="secondary"
              fullWidth
              loading={resending}
              onClick={handleResend}
              leftIcon={resending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            >
              Reenviar correo de confirmación
            </Button>

            <Button
              type="button"
              variant="ghost"
              fullWidth
              onClick={handleLogout}
              leftIcon={<LogOut className="h-4 w-4" />}
            >
              Cerrar sesión y usar otra cuenta
            </Button>
          </div>
        </StickerCard>
      </motion.div>
    </div>
  );
};
