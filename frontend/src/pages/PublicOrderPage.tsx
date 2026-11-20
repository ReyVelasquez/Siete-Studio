import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Scissors, ShieldCheck, Sparkles } from "lucide-react";
import { pageTransitionVariants } from "@/config/animations";
import { THEME_CONFIG } from "@/config/theme.config";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { OrderConfirmation } from "@/components/orders/OrderConfirmation";
import { PublicOrderForm } from "@/components/orders/PublicOrderForm";
import type { PublicOrderConfirmation } from "@/types/order";

export const PublicOrderPage: React.FC = () => {
  const [confirmation, setConfirmation] = useState<PublicOrderConfirmation | null>(null);
  const [confirmedPreview, setConfirmedPreview] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (confirmedPreview) URL.revokeObjectURL(confirmedPreview);
    };
  }, [confirmedPreview]);

  const handleOrderCreated = (data: PublicOrderConfirmation, previewUrl: string | null) => {
    if (confirmedPreview) URL.revokeObjectURL(confirmedPreview);
    setConfirmation(data);
    setConfirmedPreview(previewUrl);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleReset = () => {
    if (confirmedPreview) URL.revokeObjectURL(confirmedPreview);
    setConfirmation(null);
    setConfirmedPreview(null);
  };

  return (
    <div className="min-h-screen bg-surface-canvas bg-print-grid">
      <PublicHeader />

      <motion.main
        variants={pageTransitionVariants}
        initial="initial"
        animate="animate"
        className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8"
      >
        {!confirmation && (
          <section className="mb-8 max-w-3xl">
            <span className="sticker-badge inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-diecut bg-surface-card px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-wider text-accent">
              <Scissors className="h-3.5 w-3.5" />
              {THEME_CONFIG.copy.publicPortal.badge}
            </span>
            <h1 className="mt-4 font-display text-3xl font-extrabold tracking-tight text-ink-primary sm:text-4xl">
              {THEME_CONFIG.copy.publicPortal.heroTitle}
            </h1>
            <p className="mt-2.5 text-sm leading-relaxed text-ink-secondary sm:text-base">
              {THEME_CONFIG.copy.publicPortal.heroDescription}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-4 text-xs font-medium text-ink-muted">
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-accent" />
                Vista previa de corte en vivo
              </span>
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-accent" />
                Archivos verificados y encriptados
              </span>
            </div>
          </section>
        )}

        {confirmation ? (
          <OrderConfirmation
            confirmation={confirmation}
            previewUrl={confirmedPreview}
            onCreateAnother={handleReset}
          />
        ) : (
          <PublicOrderForm onOrderCreated={handleOrderCreated} />
        )}
      </motion.main>

      <footer className="mt-14 border-t border-line-subtle bg-surface-card/70 py-6">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 text-xs text-ink-muted sm:flex-row sm:px-6 lg:px-8">
          <p>
            © {new Date().getFullYear()} {THEME_CONFIG.brand.fullName} · {THEME_CONFIG.brand.tagline}
          </p>
          <p className="font-mono text-[11px]">Fase 1 · Plataforma Escalable de Impresión</p>
        </div>
      </footer>
    </div>
  );
};
