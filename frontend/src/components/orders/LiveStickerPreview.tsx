import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarClock,
  Droplets,
  GalleryHorizontalEnd,
  Laptop,
  Layers,
  Package,
  Ruler,
  Scissors,
  Sparkles,
  SquareDashed,
  Sun,
} from "lucide-react";
import { MOTION_EASE } from "@/config/animations";
import { StickerCard } from "@/components/ui/StickerCard";
import { resolveDesignMeasureSpec } from "@/schemas/order.schema";
import type {
  StickerMaterial,
  StickerShape,
  StickerSizeMode,
  VinylGlossMode,
} from "@/types/order";

export interface LivePreviewDesignEntry {
  fieldId: string;
  previewUrl: string | null;
  material: StickerMaterial;
  vinylGlossMode?: VinylGlossMode | null;
  shape: StickerShape;
  diameterCm?: string;
  sizeMode?: StickerSizeMode | null;
  heightCm?: string;
  widthCm?: string;
  dimensions?: string;
  quantity: number | string;
}

interface LiveStickerPreviewProps {
  designs: LivePreviewDesignEntry[];
  activeIndex: number;
  onSelectDesign: (index: number) => void;
  referralName: string;
  deliveryDate: string;
  deliveryHour: string;
}

type TransparentSurfaceId = "laptop" | "thermos" | "glass";

const TRANSPARENT_SURFACES: ReadonlyArray<{
  id: TransparentSurfaceId;
  label: string;
  shortLabel: string;
  stageClass: string;
  markClass: string;
  placeholderClass: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: "laptop",
    label: "Sobre Laptop Oscura",
    shortLabel: "Laptop Oscura",
    stageClass: "surface-test-laptop border-darkroom-line",
    markClass: "text-darkroom-muted",
    placeholderClass: "text-darkroom-ink",
    icon: Laptop,
  },
  {
    id: "thermos",
    label: "Sobre Termo Claro",
    shortLabel: "Termo Claro",
    stageClass: "surface-test-thermos border-brand-300",
    markClass: "text-brand-800",
    placeholderClass: "text-sborg-midnight",
    icon: Sun,
  },
  {
    id: "glass",
    label: "Sobre Vidrio",
    shortLabel: "Vidrio",
    stageClass: "surface-test-glass border-line-subtle",
    markClass: "text-ink-secondary",
    placeholderClass: "text-ink-primary",
    icon: Droplets,
  },
];

export const LiveStickerPreview: React.FC<LiveStickerPreviewProps> = ({
  designs,
  activeIndex,
  onSelectDesign,
  referralName,
  deliveryDate,
  deliveryHour,
}) => {
  const [transparentSurface, setTransparentSurface] = useState<TransparentSurfaceId>("laptop");
  const [activeArtworkSize, setActiveArtworkSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const safeIndex = Math.min(Math.max(0, activeIndex), Math.max(0, designs.length - 1));
  const active = designs[safeIndex] ?? {
    fieldId: "fallback",
    previewUrl: null,
    material: "Vinilo Mate" as StickerMaterial,
    vinylGlossMode: null,
    shape: "Circular" as StickerShape,
    diameterCm: "5",
    sizeMode: "both" as StickerSizeMode,
    heightCm: "",
    widthCm: "",
    dimensions: "",
    quantity: 50,
  };

  useEffect(() => {
    if (!active.previewUrl) {
      setActiveArtworkSize(null);
      return;
    }
    let cancelled = false;
    const img = new window.Image();
    img.onload = () => {
      if (!cancelled && img.naturalWidth > 0 && img.naturalHeight > 0) {
        setActiveArtworkSize({ width: img.naturalWidth, height: img.naturalHeight });
      }
    };
    img.onerror = () => {
      if (!cancelled) setActiveArtworkSize(null);
    };
    img.src = active.previewUrl;
    return () => {
      cancelled = true;
    };
  }, [active.previewUrl]);

  const totalUnits = designs.reduce((sum, item) => {
    const qty = Number(item.quantity);
    return sum + (Number.isFinite(qty) && qty > 0 ? qty : 0);
  }, 0);

  const resolvedMeasure = resolveDesignMeasureSpec({
    shape: active.shape,
    diameter_cm: active.diameterCm,
    size_mode: active.sizeMode ?? "both",
    height_cm: active.heightCm,
    width_cm: active.widthCm,
    dimensions: active.dimensions,
    artworkSize: activeArtworkSize,
  });

  const sizeText = resolvedMeasure.livePreviewText;

  const isTransparent = active.material === "Transparente";
  const isGloss = active.material === "Vinilo Brillo";
  const isMatte = active.material === "Vinilo Mate";
  const isDtfUv = active.material === "DTF UV";
  const isCustomShape = active.shape === "En su forma";

  const activeSurface =
    TRANSPARENT_SURFACES.find((s) => s.id === transparentSurface) ?? TRANSPARENT_SURFACES[0];

  const outerFrameClass =
    active.shape === "Circular"
      ? "h-48 w-48 rounded-full"
      : active.shape === "Cuadrado"
      ? "h-48 w-48 rounded-sticker"
      : active.shape === "Rectangular"
      ? "h-40 w-56 rounded-lg"
      : "h-48 w-48 rounded-[36%_64%_58%_42%/44%_36%_64%_56%]";

  const innerShapeClass =
    active.shape === "Circular"
      ? "rounded-full"
      : isCustomShape
      ? "rounded-[34%_66%_56%_44%/42%_38%_62%_58%]"
      : "rounded-lg";

  const stageBgClass = isTransparent
    ? activeSurface.stageClass
    : "bg-transparency-grid border-line-subtle";

  const cropMarkClass = isTransparent ? activeSurface.markClass : "text-ink-muted";

  const placeholderTextClass = isTransparent
    ? activeSurface.placeholderClass
    : "text-brand-800";

  return (
    <StickerCard peel tone="featured" padding="md">
      <div className="flex items-center justify-between gap-2 border-b border-dashed border-line-subtle pb-3.5">
        <div>
          <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-accent">
            Simulador de Acabado
          </span>
          <h3 className="font-display text-sm font-extrabold tracking-tight text-ink-primary">
            {designs.length > 1
              ? `Vista Previa · Diseño #${String(safeIndex + 1).padStart(2, "0")}`
              : "Simulador de Sticker"}
          </h3>
        </div>
        <span
          className={`sticker-badge inline-flex items-center gap-1.5 rounded-full border border-dashed px-2.5 py-0.5 font-mono text-[10px] font-bold ${
            isCustomShape
              ? "border-cutcontour-magenta bg-surface-card text-cutcontour-magenta"
              : "border-line-diecut bg-accent-soft text-ink-primary"
          }`}
        >
          <Scissors className="h-3 w-3" aria-hidden="true" />
          {active.shape}
        </span>
      </div>

      {/* Multi-design switcher pills when order has 2+ designs */}
      {designs.length > 1 && (
        <div
          role="tablist"
          aria-label="Seleccionar diseño para vista previa"
          className="mt-3.5 flex flex-wrap items-center gap-1.5"
        >
          {designs.map((design, idx) => {
            const isSelected = idx === safeIndex;
            const hasArtwork = Boolean(design.previewUrl);
            return (
              <button
                key={design.fieldId}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => onSelectDesign(idx)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] font-bold transition-all duration-fast ease-studio focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isSelected
                    ? "border-accent bg-accent text-accent-ink shadow-xs"
                    : "border-line-subtle bg-surface-elevated/80 text-ink-secondary hover:border-line-diecut hover:text-ink-primary"
                }`}
              >
                <span>#{String(idx + 1).padStart(2, "0")}</span>
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${
                    isSelected
                      ? hasArtwork
                        ? "bg-accent-ink"
                        : "bg-accent-ink/45"
                      : hasArtwork
                      ? "bg-accent"
                      : "bg-line-strong"
                  }`}
                />
              </button>
            );
          })}
        </div>
      )}

      {/* Surface Tester Selector strictly when `Transparente` is selected */}
      <AnimatePresence initial={false}>
        {isTransparent && (
          <motion.div
            key="transparent-surface-bar"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: MOTION_EASE }}
            className="mt-3.5 rounded-lg border border-line-subtle bg-surface-elevated/75 p-2"
          >
            <div className="mb-1.5 flex items-center justify-between px-1">
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink-secondary">
                Superficie de prueba · Transparente
              </span>
              <span className="font-mono text-[10px] text-accent">En vivo</span>
            </div>
            <div
              role="radiogroup"
              aria-label="Superficie de prueba para sticker transparente"
              className="grid grid-cols-3 gap-1.5"
            >
              {TRANSPARENT_SURFACES.map((surf) => {
                const Icon = surf.icon;
                const selected = transparentSurface === surf.id;
                return (
                  <button
                    key={surf.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    title={surf.label}
                    onClick={() => setTransparentSurface(surf.id)}
                    className={`flex flex-col items-center justify-center gap-1 rounded-md border px-1.5 py-1.5 text-center transition-all duration-fast ease-studio focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      selected
                        ? "border-accent bg-accent text-accent-ink shadow-xs"
                        : "border-line-subtle bg-surface-card text-ink-secondary hover:border-line-diecut hover:text-ink-primary"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="text-[10px] font-bold leading-tight">{surf.shortLabel}</span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Live Sticker Proofing Stage */}
      <div
        className={`relative my-4 flex min-h-[252px] flex-col items-center justify-center overflow-hidden rounded-sticker border p-6 transition-all duration-base ease-studio ${stageBgClass}`}
      >
        {/* Precision crop registration marks */}
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute left-3 top-2.5 font-mono text-[10px] font-semibold ${cropMarkClass}`}
        >
          ┌ #{String(safeIndex + 1).padStart(2, "0")}
        </span>
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute right-3 top-2.5 font-mono text-[10px] font-semibold ${cropMarkClass}`}
        >
          300 DPI ┐
        </span>

        {/* Active surface caption when testing Transparente */}
        {isTransparent && (
          <span className="pointer-events-none absolute left-3 bottom-2.5 rounded-full border border-line-subtle/60 bg-surface-card/90 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-ink-primary shadow-xs backdrop-blur-xs">
            {activeSurface.label}
          </span>
        )}

        {/* CutContour indicator pill when shape is `En su forma` */}
        {isCustomShape && !isTransparent && (
          <span className="pointer-events-none absolute left-3 bottom-2.5 inline-flex items-center gap-1.5 rounded-full border border-dashed border-cutcontour-magenta bg-surface-card/95 px-2.5 py-0.5 font-mono text-[10px] font-bold text-cutcontour-magenta shadow-xs">
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full bg-cutcontour-magenta"
            />
            CutContour · Troquel
          </span>
        )}

        {/* Outer Die-Cut / CutContour Ring */}
        <div
          className={`relative flex items-center justify-center p-2.5 transition-all duration-base ease-studio ${outerFrameClass} ${
            isCustomShape
              ? "border-2 border-dashed border-cutcontour-magenta shadow-xs"
              : "border-2 border-dashed border-line-diecut"
          }`}
        >
          {/* Physical Sticker Body (White vinyl border + realistic shadow; crystal edge on Transparente) */}
          <div
            className={`relative flex h-full w-full items-center justify-center overflow-hidden transition-all duration-base ease-studio ${innerShapeClass} ${
              isTransparent
                ? "border-2 border-sborg-white/75 bg-transparent shadow-elevated"
                : isCustomShape
                ? "border-[6px] border-sborg-white bg-sborg-white shadow-elevated ring-1 ring-sborg-midnight/15"
                : "border-4 border-sborg-white bg-brand-50 shadow-elevated"
            } ${isDtfUv ? "sticker-dtf-relief" : ""}`}
          >
            {active.previewUrl ? (
              <img
                src={active.previewUrl}
                alt={`Previsualización del Diseño #${safeIndex + 1}`}
                className={`relative z-10 h-full w-full object-contain ${
                  isCustomShape ? "p-2.5 drop-shadow-sm" : "p-2"
                }`}
              />
            ) : (
              <div
                className={`relative z-10 flex flex-col items-center justify-center px-4 text-center ${placeholderTextClass}`}
              >
                <Sparkles className="h-7 w-7" aria-hidden="true" />
                <span className="mt-2 font-mono text-[11px] font-bold">
                  Diseño #{String(safeIndex + 1).padStart(2, "0")} aquí
                </span>
                {isTransparent && (
                  <span className="mt-0.5 text-[10px] opacity-80">
                    Fondo cristalino real
                  </span>
                )}
              </div>
            )}

            {/* Animated diagonal vinyl gloss sheen for `Vinilo Brillo` */}
            {isGloss && (
              <>
                <div
                  aria-hidden="true"
                  className="sticker-gloss-sheen pointer-events-none absolute inset-0 z-20"
                />
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -left-6 -top-6 z-20 h-20 w-28 -rotate-12 rounded-full bg-sborg-white/30 blur-md"
                />
              </>
            )}

            {/* Soft anti-glare matte grain overlay for `Vinilo Mate` */}
            {isMatte && (
              <div
                aria-hidden="true"
                className="sticker-matte-grain pointer-events-none absolute inset-0 z-20"
              />
            )}
          </div>
        </div>

        {/* Size readout pill */}
        <span className="absolute bottom-2.5 right-3 rounded-full border border-line-subtle bg-surface-card/95 px-2.5 py-0.5 font-mono text-[11px] font-bold tabular-nums text-ink-primary shadow-xs">
          {sizeText}
        </span>
      </div>

      {/* Visual Presentation Mode Indicator specifically for `Vinilo Brillo` (En rollo vs Corte 1 a 1) */}
      <AnimatePresence initial={false}>
        {isGloss && (
          <motion.div
            key="gloss-presentation-visual"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: MOTION_EASE }}
            className="mb-3.5 rounded-lg border border-dashed border-line-diecut bg-accent-soft/45 px-3 py-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {active.vinylGlossMode === "En rollo" ? (
                  <GalleryHorizontalEnd
                    className="h-4 w-4 shrink-0 text-accent"
                    aria-hidden="true"
                  />
                ) : (
                  <SquareDashed
                    className="h-4 w-4 shrink-0 text-accent"
                    aria-hidden="true"
                  />
                )}
                <div>
                  <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-accent">
                    Acabado Vinilo Brillo · Presentación
                  </p>
                  <p className="text-xs font-bold text-ink-primary">
                    {active.vinylGlossMode === "En rollo"
                      ? "En rollo · Tira continua en bobina"
                      : active.vinylGlossMode === "Corte uno a uno"
                      ? "Corte uno a uno · Stickers sueltos"
                      : "Selecciona modalidad (En rollo o Corte 1 a 1)"}
                  </p>
                </div>
              </div>

              {/* Miniature schematic visual showing Roll Strip vs Single Die-Cut */}
              {active.vinylGlossMode === "En rollo" ? (
                <div
                  aria-hidden="true"
                  className="flex items-center gap-1 rounded-md border border-line-diecut/60 bg-surface-card px-2 py-1.5 shadow-xs"
                >
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-accent bg-accent-soft" />
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-accent bg-accent-soft" />
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-accent bg-accent-soft" />
                </div>
              ) : active.vinylGlossMode === "Corte uno a uno" ? (
                <div
                  aria-hidden="true"
                  className="relative flex h-7 w-7 items-center justify-center rounded-md border-2 border-dashed border-accent bg-surface-card shadow-xs"
                >
                  <span className="h-3.5 w-3.5 rounded-full bg-accent/80" />
                </div>
              ) : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active Design Spec Sheet */}
      <dl className="space-y-2 text-xs">
        <div className="flex items-center justify-between gap-2 rounded-md border border-line-subtle/60 bg-surface-elevated/60 px-3 py-2">
          <dt className="flex items-center gap-1.5 text-ink-muted">
            <Layers className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
            Material
          </dt>
          <dd className="text-right font-semibold text-ink-primary">
            {active.material}
            {isGloss && active.vinylGlossMode ? ` · ${active.vinylGlossMode}` : ""}
          </dd>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-md border border-line-subtle/60 bg-surface-elevated/60 px-3 py-2">
          <dt className="flex items-center gap-1.5 text-ink-muted">
            <Ruler className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
            Forma y medida
          </dt>
          <dd className="font-mono font-semibold tabular-nums text-ink-primary">
            {active.shape} · {sizeText}
          </dd>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-md border border-line-subtle/60 bg-surface-elevated/60 px-3 py-2">
          <dt className="text-ink-muted">
            {designs.length > 1
              ? `Cantidad (Diseño #${String(safeIndex + 1).padStart(2, "0")})`
              : "Cantidad"}
          </dt>
          <dd className="font-mono font-bold tabular-nums text-ink-primary">
            {Number(active.quantity) > 0
              ? `${Number(active.quantity).toLocaleString()} uds.`
              : "—"}
          </dd>
        </div>

        {/* Order-wide Totals Summary */}
        <div className="flex items-center justify-between gap-2 rounded-md border border-dashed border-line-diecut/65 bg-accent-soft/45 px-3 py-2">
          <dt className="flex items-center gap-1.5 font-semibold text-ink-primary">
            <Package className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
            Resumen del pedido
          </dt>
          <dd className="font-mono font-bold tabular-nums text-ink-primary">
            {designs.length} {designs.length === 1 ? "diseño" : "diseños"} ·{" "}
            {totalUnits > 0 ? `${totalUnits.toLocaleString()} uds.` : "—"}
          </dd>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-md border border-line-subtle/60 bg-surface-elevated/60 px-3 py-2">
          <dt className="flex items-center gap-1.5 text-ink-muted">
            <CalendarClock className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
            Entrega pactada
          </dt>
          <dd className="font-mono font-semibold tabular-nums text-ink-primary">
            {deliveryDate ? `${deliveryDate} · ${deliveryHour}` : "Por definir"}
          </dd>
        </div>
      </dl>

      {referralName.trim() && (
        <p className="mt-3.5 border-t border-dashed border-line-subtle pt-3 text-center text-[11px] text-ink-muted">
          A nombre de <strong className="text-ink-primary">{referralName.trim()}</strong>
        </p>
      )}
    </StickerCard>
  );
};
