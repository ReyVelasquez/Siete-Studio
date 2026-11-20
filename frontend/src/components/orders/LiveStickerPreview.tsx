import React from "react";
import { CalendarClock, Layers, Ruler, Scissors, Sparkles } from "lucide-react";
import { StickerCard } from "@/components/ui/StickerCard";
import type { StickerMaterial, StickerShape, VinylGlossMode } from "@/types/order";

interface LiveStickerPreviewProps {
  previewUrl: string | null;
  referralName: string;
  material: StickerMaterial;
  vinylGlossMode?: VinylGlossMode | null;
  shape: StickerShape;
  diameterCm?: string;
  dimensions?: string;
  quantity: number | string;
  deliveryDate: string;
  deliveryHour: string;
}

export const LiveStickerPreview: React.FC<LiveStickerPreviewProps> = ({
  previewUrl,
  referralName,
  material,
  vinylGlossMode,
  shape,
  diameterCm,
  dimensions,
  quantity,
  deliveryDate,
  deliveryHour,
}) => {
  const sizeText =
    shape === "Circular"
      ? diameterCm
        ? `Ø ${diameterCm} cm`
        : "Indica diámetro"
      : dimensions?.trim()
      ? dimensions.trim()
      : "Indica Alto x Ancho";

  const frameClass =
    shape === "Circular"
      ? "h-48 w-48 rounded-full"
      : shape === "Cuadrado"
      ? "h-48 w-48 rounded-2xl"
      : shape === "Rectangular"
      ? "h-40 w-56 rounded-xl"
      : "h-48 w-48 rounded-[34%_66%_58%_42%/44%_36%_64%_56%]";

  const isTransparent = material === "Transparente";
  const isGloss = material === "Vinilo Brillo";

  return (
    <StickerCard peel padding="md">
      <div className="flex items-center justify-between border-b border-line-subtle pb-3.5">
        <div>
          <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-ink-muted">
            Vista Previa de Corte
          </span>
          <h3 className="font-display text-sm font-bold text-ink-primary">
            Simulador de Sticker
          </h3>
        </div>
        <span className="sticker-badge inline-flex items-center gap-1 rounded-full border border-dashed border-line-diecut bg-surface-elevated px-2.5 py-0.5 font-mono text-[10px] font-bold text-ink-primary">
          <Scissors className="h-3 w-3" />
          {shape}
        </span>
      </div>

      {/* Live Sticker Canvas */}
      <div className="bg-transparency-grid relative my-5 flex min-h-[248px] items-center justify-center overflow-hidden rounded-xl border border-line-subtle p-6">
        {/* Corner crop marks */}
        <span className="pointer-events-none absolute left-3 top-3 font-mono text-[10px] text-ink-muted">
          ┌ 00
        </span>
        <span className="pointer-events-none absolute right-3 top-3 font-mono text-[10px] text-ink-muted">
          300 DPI ┐
        </span>

        {/* Die-cut outer contour */}
        <div
          className={`relative flex items-center justify-center border-2 border-dashed border-line-diecut p-2.5 transition-all duration-300 ${frameClass}`}
        >
          {/* Sticker substrate */}
          <div
            className={`relative flex h-full w-full items-center justify-center overflow-hidden border-4 border-white shadow-elevated transition-all duration-300 dark:border-brand-200 ${
              shape === "Circular"
                ? "rounded-full"
                : shape === "En su forma"
                ? "rounded-[34%_66%_58%_42%/44%_36%_64%_56%]"
                : "rounded-xl"
            } ${isTransparent ? "bg-transparent" : "bg-white dark:bg-brand-50"}`}
          >
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="Previsualización de tu sticker"
                className="h-full w-full object-contain p-2"
              />
            ) : (
              <div className="flex flex-col items-center justify-center px-4 text-center text-brand-700/70">
                <Sparkles className="h-7 w-7" />
                <span className="mt-2 font-mono text-[11px] font-semibold">
                  Tu diseño aquí
                </span>
              </div>
            )}

            {/* Gloss sheen reflection effect for Vinilo Brillo */}
            {isGloss && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-transparent via-white/30 to-transparent"
              />
            )}
          </div>
        </div>

        {/* Size readout pill */}
        <span className="absolute bottom-2.5 right-3 rounded-full border border-line-subtle bg-surface-card/95 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-ink-primary shadow-sm">
          {sizeText}
        </span>
      </div>

      {/* Live Order Spec Sheet */}
      <dl className="space-y-2.5 text-xs">
        <div className="flex items-center justify-between rounded-md bg-surface-elevated/70 px-3 py-2">
          <dt className="flex items-center gap-1.5 text-ink-muted">
            <Layers className="h-3.5 w-3.5" />
            Material
          </dt>
          <dd className="text-right font-semibold text-ink-primary">
            {material}
            {material === "Vinilo Brillo" && vinylGlossMode ? ` · ${vinylGlossMode}` : ""}
          </dd>
        </div>

        <div className="flex items-center justify-between rounded-md bg-surface-elevated/70 px-3 py-2">
          <dt className="flex items-center gap-1.5 text-ink-muted">
            <Ruler className="h-3.5 w-3.5" />
            Forma y medida
          </dt>
          <dd className="font-mono font-semibold text-ink-primary">
            {shape} · {sizeText}
          </dd>
        </div>

        <div className="flex items-center justify-between rounded-md bg-surface-elevated/70 px-3 py-2">
          <dt className="text-ink-muted">Cantidad</dt>
          <dd className="font-mono font-bold text-ink-primary">
            {Number(quantity) > 0 ? `${Number(quantity).toLocaleString()} uds.` : "—"}
          </dd>
        </div>

        <div className="flex items-center justify-between rounded-md bg-surface-elevated/70 px-3 py-2">
          <dt className="flex items-center gap-1.5 text-ink-muted">
            <CalendarClock className="h-3.5 w-3.5" />
            Entrega pactada
          </dt>
          <dd className="font-mono font-semibold text-ink-primary">
            {deliveryDate ? `${deliveryDate} · ${deliveryHour}` : "Por definir"}
          </dd>
        </div>
      </dl>

      {referralName.trim() && (
        <p className="mt-3.5 border-t border-line-subtle pt-3 text-center text-[11px] text-ink-muted">
          A nombre de <strong className="text-ink-primary">{referralName.trim()}</strong>
        </p>
      )}
    </StickerCard>
  );
};
