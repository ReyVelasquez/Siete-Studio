import React, { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import {
  ArrowDownRight,
  Clock,
  CopyPlus,
  Droplets,
  Layers,
  Scissors,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  Wand2,
  Zap,
} from "lucide-react";
import { ANIMATIONS_ENABLED, pageTransitionVariants } from "@/config/animations";
import { THEME_CONFIG } from "@/config/theme.config";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { OrderConfirmation } from "@/components/orders/OrderConfirmation";
import { PublicOrderForm } from "@/components/orders/PublicOrderForm";
import { StickerCard } from "@/components/ui/StickerCard";
import { MAX_ORDER_DESIGNS } from "@/schemas/order.schema";
import type { PublicOrderConfirmation, StickerMaterial } from "@/types/order";

interface StickerPackHeroProps {
  onSelectFinish: (material: StickerMaterial) => void;
}

const StickerPackShowcase: React.FC<StickerPackHeroProps> = ({ onSelectFinish }) => {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);

  const smoothX = useSpring(pointerX, { stiffness: 180, damping: 22, mass: 0.6 });
  const smoothY = useSpring(pointerY, { stiffness: 180, damping: 22, mass: 0.6 });

  const tiltRotateX = useTransform(smoothY, [-0.5, 0.5], [7, -7]);
  const tiltRotateY = useTransform(smoothX, [-0.5, 0.5], [-9, 9]);
  const parallaxDeepX = useTransform(smoothX, [-0.5, 0.5], [-8, 8]);
  const parallaxDeepY = useTransform(smoothY, [-0.5, 0.5], [-6, 6]);
  const parallaxMidX = useTransform(smoothX, [-0.5, 0.5], [6, -6]);
  const parallaxMidY = useTransform(smoothY, [-0.5, 0.5], [5, -5]);

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!ANIMATIONS_ENABLED || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const nx = (event.clientX - rect.left) / rect.width - 0.5;
    const ny = (event.clientY - rect.top) / rect.height - 0.5;
    pointerX.set(nx);
    pointerY.set(ny);
  };

  const handleMouseLeave = () => {
    pointerX.set(0);
    pointerY.set(0);
  };

  return (
    <div
      ref={stageRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ perspective: 900 }}
      aria-label="Muestrario interactivo de acabados de stickers"
      className="relative flex min-h-[218px] w-full items-center justify-center rounded-sticker border border-dashed border-line-diecut/60 bg-surface-elevated/55 bg-print-grid p-4 sm:min-h-[234px]"
    >
      {/* Subtle Workshop Label */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-2.5 font-mono text-[9px] font-bold uppercase tracking-widest text-ink-muted"
      >
        STICKER PACK · ACABADOS REALES
      </span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-2 right-3 font-mono text-[9px] font-semibold text-ink-muted"
      >
        Haz clic para probar en el simulador
      </span>

      <motion.div
        style={
          ANIMATIONS_ENABLED
            ? {
                rotateX: tiltRotateX,
                rotateY: tiltRotateY,
                transformStyle: "preserve-3d",
              }
            : undefined
        }
        className="grid w-full max-w-[360px] grid-cols-2 gap-3.5 py-4 sm:gap-4"
      >
        {/* 1. BRILLO — Circular glossy vinyl with live diagonal sheen */}
        <motion.button
          type="button"
          onClick={() => onSelectFinish("Vinilo Brillo")}
          style={ANIMATIONS_ENABLED ? { x: parallaxDeepX, y: parallaxDeepY } : undefined}
          whileHover={ANIMATIONS_ENABLED ? { scale: 1.07, rotate: -2 } : undefined}
          whileTap={ANIMATIONS_ENABLED ? { scale: 0.97 } : undefined}
          className="sticker-pack-chip group relative mx-auto flex h-24 w-24 -rotate-6 flex-col items-center justify-center overflow-hidden rounded-full bg-sborg-midnight text-sborg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            aria-hidden="true"
            className="sticker-gloss-sheen pointer-events-none absolute inset-0"
          />
          <Zap
            className="relative z-10 h-6 w-6 text-sborg-emerald transition-transform duration-fast group-hover:scale-110"
            aria-hidden="true"
          />
          <span className="relative z-10 mt-1 font-mono text-[10px] font-extrabold uppercase tracking-wider text-sborg-white">
            Brillo
          </span>
          <span className="relative z-10 font-mono text-[8px] font-semibold text-brand-200">
            VINILO GLOSS
          </span>
        </motion.button>

        {/* 2. MATE — Rounded square silky anti-glare matte sticker */}
        <motion.button
          type="button"
          onClick={() => onSelectFinish("Vinilo Mate")}
          style={ANIMATIONS_ENABLED ? { x: parallaxMidX, y: parallaxMidY } : undefined}
          whileHover={ANIMATIONS_ENABLED ? { scale: 1.07, rotate: 1.5 } : undefined}
          whileTap={ANIMATIONS_ENABLED ? { scale: 0.97 } : undefined}
          className="sticker-pack-chip group relative mx-auto flex h-[88px] w-[108px] rotate-[5deg] flex-col items-center justify-center overflow-hidden rounded-2xl bg-brand-700 text-sborg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            aria-hidden="true"
            className="sticker-matte-grain pointer-events-none absolute inset-0"
          />
          <Layers
            className="relative z-10 h-5 w-5 text-brand-100 transition-transform duration-fast group-hover:scale-110"
            aria-hidden="true"
          />
          <span className="relative z-10 mt-1 font-mono text-[10px] font-extrabold uppercase tracking-wider text-sborg-white">
            Mate
          </span>
          <span className="relative z-10 font-mono text-[8px] font-semibold text-brand-100">
            ANTIRREFLEJO
          </span>
        </motion.button>

        {/* 3. TRANSPARENTE — Crystal clear window showing background print-grid dots */}
        <motion.button
          type="button"
          onClick={() => onSelectFinish("Transparente")}
          style={ANIMATIONS_ENABLED ? { x: parallaxMidX, y: parallaxDeepY } : undefined}
          whileHover={ANIMATIONS_ENABLED ? { scale: 1.07, rotate: -1 } : undefined}
          whileTap={ANIMATIONS_ENABLED ? { scale: 0.97 } : undefined}
          className="sticker-pack-chip group relative mx-auto flex h-[76px] w-[124px] -rotate-3 flex-col items-center justify-center overflow-hidden rounded-full bg-surface-card/35 text-ink-primary backdrop-blur-[1.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-sborg-white/45 via-transparent to-sborg-emerald/15"
          />
          <span className="relative z-10 inline-flex items-center gap-1 rounded-full bg-surface-card/90 px-2 py-0.5 font-mono text-[9px] font-extrabold uppercase tracking-wider text-ink-primary shadow-xs">
            <Droplets className="h-3 w-3 text-accent" aria-hidden="true" />
            Transparente
          </span>
          <span className="relative z-10 mt-1 font-mono text-[8px] font-bold text-ink-secondary">
            BASE CRISTAL
          </span>
        </motion.button>

        {/* 4. DTF UV — Tactile embossed 3D relief with magenta dashed CutContour halo */}
        <motion.button
          type="button"
          onClick={() => onSelectFinish("DTF UV")}
          style={ANIMATIONS_ENABLED ? { x: parallaxDeepX, y: parallaxMidY } : undefined}
          whileHover={ANIMATIONS_ENABLED ? { scale: 1.07, rotate: 2 } : undefined}
          whileTap={ANIMATIONS_ENABLED ? { scale: 0.97 } : undefined}
          className="group relative mx-auto flex items-center justify-center rounded-[28px] border-2 border-dashed border-cutcontour-magenta p-1.5 rotate-[4deg] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="sticker-pack-chip sticker-dtf-relief flex h-[74px] w-[112px] flex-col items-center justify-center rounded-[22px] bg-sborg-navy text-sborg-white">
            <Sparkles
              className="h-5 w-5 text-sborg-emerald transition-transform duration-fast group-hover:scale-110"
              aria-hidden="true"
            />
            <span className="mt-1 font-mono text-[10px] font-extrabold uppercase tracking-wider text-sborg-white">
              DTF UV
            </span>
            <span className="font-mono text-[8px] font-semibold text-brand-200">
              RELIEVE 3D
            </span>
          </span>
        </motion.button>
      </motion.div>
    </div>
  );
};

export const PublicOrderPage: React.FC = () => {
  const [confirmation, setConfirmation] = useState<PublicOrderConfirmation | null>(null);
  const [confirmedPreviews, setConfirmedPreviews] = useState<(string | null)[]>([]);
  const [selectedHeroFinish, setSelectedHeroFinish] = useState<{
    material: StickerMaterial;
    nonce: number;
  } | null>(null);

  useEffect(() => {
    return () => {
      confirmedPreviews.forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    };
  }, [confirmedPreviews]);

  const handleOrderCreated = (
    data: PublicOrderConfirmation,
    previewUrls: (string | null)[]
  ) => {
    confirmedPreviews.forEach((url) => {
      if (url) URL.revokeObjectURL(url);
    });
    setConfirmation(data);
    setConfirmedPreviews(previewUrls);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleReset = () => {
    confirmedPreviews.forEach((url) => {
      if (url) URL.revokeObjectURL(url);
    });
    setConfirmation(null);
    setConfirmedPreviews([]);
  };

  const handleHeroFinishClick = (material: StickerMaterial) => {
    setSelectedHeroFinish({ material, nonce: Date.now() });
    const target = document.getElementById("paso-disenos");
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="min-h-screen bg-surface-canvas bg-print-grid text-ink-primary">
      <PublicHeader />

      <motion.main
        variants={pageTransitionVariants}
        initial="initial"
        animate="animate"
        className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8"
      >
        {!confirmation && (
          <StickerCard
            dieCut
            registrationMarks
            padding="md"
            className="mb-7 overflow-hidden bg-print-grid"
          >
            <div className="grid grid-cols-1 items-center gap-6 lg:grid-cols-12">
              {/* Left: Studio Identity, Value Proposition & High-Visibility Step Jumps */}
              <div className="lg:col-span-7">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="sticker-badge inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-diecut bg-surface-card px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-wider text-accent">
                    <Scissors className="h-3.5 w-3.5" aria-hidden="true" />
                    {THEME_CONFIG.copy.publicPortal.badge}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-line-subtle bg-surface-elevated px-2.5 py-1 font-mono text-[10px] font-semibold text-ink-secondary">
                    <Clock className="h-3 w-3 text-accent" aria-hidden="true" />
                    Entregas {String(THEME_CONFIG.deliveryHours.startHour).padStart(2, "0")}:00 –{" "}
                    {String(THEME_CONFIG.deliveryHours.endHour).padStart(2, "0")}:00
                  </span>
                </div>

                <h1 className="mt-3.5 font-display text-2xl font-extrabold tracking-tight text-ink-primary sm:text-4xl">
                  {THEME_CONFIG.copy.publicPortal.heroTitle}
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-secondary sm:text-base">
                  {THEME_CONFIG.copy.publicPortal.heroDescription}
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold text-ink-secondary">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-diecut/70 bg-accent-soft/65 px-2.5 py-1 font-mono text-[11px] font-bold text-ink-primary">
                    <Layers className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                    Hasta {MAX_ORDER_DESIGNS} diseños en lote
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-line-subtle bg-surface-elevated/80 px-2.5 py-1 font-mono text-[11px]">
                    <Wand2 className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                    Configuración rápida 1-clic
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-line-subtle bg-surface-elevated/80 px-2.5 py-1 font-mono text-[11px]">
                    <CopyPlus className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                    Varias medidas con 1 sola subida
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-line-subtle bg-surface-elevated/80 px-2.5 py-1 font-mono text-[11px]">
                    <ShieldCheck className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                    Preprensa CMYK · 300 DPI
                  </span>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <a
                    href="#paso-disenos"
                    className="sticker-badge group inline-flex h-11 items-center justify-center gap-2 rounded-md bg-accent px-5 text-sm font-semibold tracking-tight text-accent-ink transition-all duration-fast ease-studio hover:-translate-y-0.5 hover:bg-accent-hover hover:shadow-sticker-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card active:scale-[0.985]"
                  >
                    <UploadCloud className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>Subir hasta {MAX_ORDER_DESIGNS} diseños ahora</span>
                    <ArrowDownRight
                      className="h-4 w-4 shrink-0 transition-transform duration-fast ease-studio group-hover:translate-x-0.5 group-hover:translate-y-0.5"
                      aria-hidden="true"
                    />
                  </a>

                  <nav
                    aria-label="Accesos rápidos del pedido"
                    className="flex flex-wrap items-center gap-1.5"
                  >
                    <a
                      href="#paso-cliente-entrega"
                      className="inline-flex items-center gap-1.5 rounded-full border border-line-subtle bg-surface-card px-2.5 py-1 text-[11px] font-semibold text-ink-secondary shadow-xs transition-all duration-fast ease-studio hover:-translate-y-px hover:border-line-diecut hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="font-mono text-[10px] font-bold text-accent">01</span>
                      Cliente
                    </a>
                    <a
                      href="#paso-disenos"
                      className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-diecut/70 bg-accent-soft px-2.5 py-1 text-[11px] font-semibold text-ink-primary shadow-xs transition-all duration-fast ease-studio hover:-translate-y-px hover:border-line-diecut focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="font-mono text-[10px] font-bold text-accent">02</span>
                      Diseños
                    </a>
                    <a
                      href="#paso-confirmar"
                      className="inline-flex items-center gap-1.5 rounded-full border border-line-subtle bg-surface-card px-2.5 py-1 text-[11px] font-semibold text-ink-secondary shadow-xs transition-all duration-fast ease-studio hover:-translate-y-px hover:border-line-diecut hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="font-mono text-[10px] font-bold text-accent">03</span>
                      Enviar
                    </a>
                  </nav>
                </div>
              </div>

              {/* Right: Interactive Floating "Sticker Pack" Finish Showcase */}
              <div className="lg:col-span-5">
                <StickerPackShowcase onSelectFinish={handleHeroFinishClick} />
              </div>
            </div>
          </StickerCard>
        )}

        {confirmation ? (
          <OrderConfirmation
            confirmation={confirmation}
            previewUrls={confirmedPreviews}
            onCreateAnother={handleReset}
          />
        ) : (
          <PublicOrderForm
            onOrderCreated={handleOrderCreated}
            selectedHeroFinish={selectedHeroFinish}
          />
        )}
      </motion.main>

      <footer className="mt-14 border-t border-dashed border-line-subtle bg-surface-card/75 py-6">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 text-xs text-ink-muted sm:flex-row sm:px-6 lg:px-8">
          <p>
            © {new Date().getFullYear()} {THEME_CONFIG.brand.fullName} ·{" "}
            {THEME_CONFIG.brand.tagline}
          </p>
          <p className="font-mono text-[11px] text-ink-secondary">
            Siete Studio · Plataforma de Impresión & Troquelado
          </p>
        </div>
      </footer>
    </div>
  );
};
