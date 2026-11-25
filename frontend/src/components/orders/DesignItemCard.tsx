import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type {
  FieldErrors,
  Path,
  PathValue,
  UseFormRegister,
  UseFormSetValue,
} from "react-hook-form";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  CopyPlus,
  Eye,
  Hash,
  ImagePlus,
  Layers,
  Plus,
  RectangleHorizontal,
  Ruler,
  Scissors,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import { conditionalFieldVariants, stickerSlapVariants } from "@/config/animations";
import { THEME_CONFIG } from "@/config/theme.config";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { StickerCard } from "@/components/ui/StickerCard";
import { StickerDropzone } from "@/components/orders/StickerDropzone";
import {
  MAX_ORDER_DESIGNS,
  resolveDesignMeasureSpec,
  type OrderDesignItemFormValues,
  type OrderDesignSizeVariantFormValues,
  type PublicOrderFormValues,
} from "@/schemas/order.schema";
import {
  getFallbackPublicMaterials,
  type PublicMaterialOption,
} from "@/services/materials.service";
import type {
  StickerMaterial,
  StickerShape,
  StickerSizeMode,
  VinylGlossMode,
} from "@/types/order";

export interface MultiDesignFormShape {
  items: OrderDesignItemFormValues[];
}

export interface DesignItemCardProps<
  TForm extends MultiDesignFormShape = PublicOrderFormValues,
> {
  /** Stable unique ID from React Hook Form's `useFieldArray`. */
  fieldId: string;
  /** Zero-based position in the dynamic `items` array. */
  index: number;
  /** Total number of design cards currently in the order. */
  totalCount: number;
  /** Total count of flattened designs (cards + extra size variants) across the order. */
  totalOrderVariantsCount?: number;
  /** Current watched form values for this design item. */
  value: OrderDesignItemFormValues;
  /** Dynamic active materials catalog (loaded from `/api/v1/public/materials` with fallback). */
  materials?: PublicMaterialOption[];
  /** Validation errors scoped to this specific design item. */
  itemErrors?: FieldErrors<OrderDesignItemFormValues>;
  /** Local Object URL preview for this design's uploaded file. */
  previewUrl: string | null;
  /** Whether this card is currently focused in the sticky LiveStickerPreview. */
  isActivePreview?: boolean;
  /** Shows the desktop "Ver en simulador" chip (enabled in public portal). */
  showPreviewToggle?: boolean;
  /** When true, renders the compact die-cut sticker label layout for scanning 4–20 designs. */
  compact?: boolean;
  /** DOM ID prefix so multiple form instances never collide. */
  idPrefix?: string;
  /** Disables inputs while submitting the order. */
  disabled?: boolean;
  register: UseFormRegister<TForm>;
  setValue: UseFormSetValue<TForm>;
  onImageChange: (file: File | null) => void;
  onActivatePreview?: () => void;
  onRemove: () => void;
}

const shapeIcons: Record<StickerShape, React.ComponentType<{ className?: string }>> = {
  Circular: Circle,
  Rectangular: RectangleHorizontal,
  Cuadrado: Square,
  "En su forma": Sparkles,
};

const NON_CIRCULAR_SIZE_MODE_OPTIONS: ReadonlyArray<{
  value: StickerSizeMode;
  label: string;
  shortLabel: string;
  shortHint: string;
}> = [
  { value: "both", label: "Alto y Ancho", shortLabel: "Alto×Ancho", shortHint: "Ej. 5x7 cm" },
  { value: "height_only", label: "Solo Alto", shortLabel: "Solo Alto", shortHint: "Ancho auto" },
  { value: "width_only", label: "Solo Ancho", shortLabel: "Solo Ancho", shortHint: "Alto auto" },
];

/** Precision print-shop corner registration crosshairs (4 corners). */
const CornerRegistrationMarks: React.FC<{ emphasized: boolean; hasError: boolean }> = ({
  emphasized,
  hasError,
}) => {
  const strokeTone = hasError
    ? "border-state-critical-bg"
    : emphasized
    ? "border-line-diecut"
    : "border-line-strong/65";

  return (
    <>
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute left-2.5 top-2.5 h-3 w-3 border-l-2 border-t-2 ${strokeTone}`}
      />
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute right-2.5 top-2.5 h-3 w-3 border-r-2 border-t-2 ${strokeTone}`}
      />
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute bottom-2.5 left-2.5 h-3 w-3 border-b-2 border-l-2 ${strokeTone}`}
      />
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute bottom-2.5 right-2.5 h-3 w-3 border-b-2 border-r-2 ${strokeTone}`}
      />
    </>
  );
};

export function DesignItemCard<
  TForm extends MultiDesignFormShape = PublicOrderFormValues,
>({
  fieldId,
  index,
  totalCount,
  totalOrderVariantsCount,
  value,
  materials,
  itemErrors,
  previewUrl,
  isActivePreview = false,
  showPreviewToggle = true,
  compact = false,
  idPrefix = "diseno",
  disabled = false,
  register,
  setValue,
  onImageChange,
  onActivatePreview,
  onRemove,
}: DesignItemCardProps<TForm>) {
  const designNumber = index + 1;
  const formattedNumber = String(designNumber).padStart(2, "0");
  const canRemove = totalCount > 1;
  const materialOptions =
    materials && materials.length > 0 ? materials : getFallbackPublicMaterials();
  const isVinylGloss = value.material === "Vinilo Brillo";
  const isCircular = value.shape === "Circular";
  const hasArtwork = Boolean(value.image || previewUrl);
  const currentSizeMode: StickerSizeMode = value.size_mode || "both";
  const sizeVariants: OrderDesignSizeVariantFormValues[] = Array.isArray(value.size_variants)
    ? value.size_variants
    : [];

  const effectiveTotalVariants = totalOrderVariantsCount ?? totalCount + sizeVariants.length;
  const canAddSizeVariant = !disabled && effectiveTotalVariants < MAX_ORDER_DESIGNS;

  // Allows expanding an individual card temporarily even when the list is in Compact View
  const [expandedInCompact, setExpandedInCompact] = useState(false);
  const quickFileInputRef = useRef<HTMLInputElement | null>(null);

  const [artworkNaturalSize, setArtworkNaturalSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    if (!previewUrl) {
      setArtworkNaturalSize(null);
      return;
    }
    let cancelled = false;
    const img = new window.Image();
    img.onload = () => {
      if (!cancelled && img.naturalWidth > 0 && img.naturalHeight > 0) {
        setArtworkNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
      }
    };
    img.onerror = () => {
      if (!cancelled) setArtworkNaturalSize(null);
    };
    img.src = previewUrl;
    return () => {
      cancelled = true;
    };
  }, [previewUrl]);

  const resolvedMeasure = resolveDesignMeasureSpec({
    shape: value.shape,
    diameter_cm: value.diameter_cm,
    size_mode: currentSizeMode,
    height_cm: value.height_cm,
    width_cm: value.width_cm,
    dimensions: value.dimensions,
    artworkSize: artworkNaturalSize,
  });

  const sizeSummary = resolvedMeasure.summaryText;
  const primaryQty = Number(value.quantity) || 0;
  const variantsQty = sizeVariants.reduce(
    (sum, v) => sum + (Number.isFinite(Number(v?.quantity)) ? Number(v.quantity) : 0),
    0
  );
  const totalCardUnits = primaryQty + variantsQty;
  const totalCardMeasures = 1 + sizeVariants.length;

  const setItemField = <K extends keyof OrderDesignItemFormValues>(
    field: K,
    nextVal: OrderDesignItemFormValues[K],
    options?: { shouldValidate?: boolean; shouldDirty?: boolean }
  ) => {
    const path = `items.${index}.${String(field)}` as Path<TForm>;
    setValue(path, nextVal as PathValue<TForm, typeof path>, options);
  };

  const handleMaterialSelect = (nextMaterial: StickerMaterial) => {
    setItemField("material", nextMaterial, {
      shouldValidate: true,
      shouldDirty: true,
    });
    if (nextMaterial === "Vinilo Brillo") {
      if (!value.vinyl_gloss_mode) {
        setItemField("vinyl_gloss_mode", "Corte uno a uno", { shouldValidate: true });
      }
    } else {
      setItemField("vinyl_gloss_mode", null, { shouldValidate: true });
    }
    onActivatePreview?.();
  };

  const handleGlossModeSelect = (nextMode: VinylGlossMode) => {
    setItemField("vinyl_gloss_mode", nextMode, {
      shouldValidate: true,
      shouldDirty: true,
    });
    onActivatePreview?.();
  };

  const handleShapeSelect = (nextShape: StickerShape) => {
    setItemField("shape", nextShape, {
      shouldValidate: true,
      shouldDirty: true,
    });
    if (nextShape === "Circular") {
      if (!value.diameter_cm) {
        setItemField("diameter_cm", "5", { shouldValidate: false });
      }
      setItemField("dimensions", "", { shouldValidate: false });
      setItemField("height_cm", "", { shouldValidate: false });
      setItemField("width_cm", "", { shouldValidate: false });
    } else {
      setItemField("diameter_cm", "", { shouldValidate: false });
      if (!value.size_mode) {
        setItemField("size_mode", "both", { shouldValidate: false });
      }
      if (!value.dimensions && !value.height_cm && !value.width_cm) {
        setItemField("dimensions", "5x5 cm", { shouldValidate: false });
      }
    }
    onActivatePreview?.();
  };

  const handleSizeModeSelect = (nextMode: StickerSizeMode) => {
    setItemField("size_mode", nextMode, {
      shouldValidate: false,
      shouldDirty: true,
    });
    if (nextMode === "both") {
      setItemField("height_cm", "", { shouldValidate: false });
      setItemField("width_cm", "", { shouldValidate: false });
    } else if (nextMode === "height_only") {
      setItemField("width_cm", "", { shouldValidate: false });
      setItemField("dimensions", "", { shouldValidate: false });
    } else if (nextMode === "width_only") {
      setItemField("height_cm", "", { shouldValidate: false });
      setItemField("dimensions", "", { shouldValidate: false });
    }
    onActivatePreview?.();
  };

  const handleAddSizeVariant = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!canAddSizeVariant) return;

    const nextVariantNumber = sizeVariants.length + 2;
    const defaultDiameter = String(4 + nextVariantNumber);
    const defaultDim = `${3 + nextVariantNumber}x${3 + nextVariantNumber} cm`;

    const newVariant: OrderDesignSizeVariantFormValues = {
      id: `${fieldId}-var-${Date.now()}-${sizeVariants.length + 1}`,
      diameter_cm: isCircular ? defaultDiameter : "",
      size_mode: currentSizeMode,
      height_cm: !isCircular && currentSizeMode === "height_only" ? defaultDiameter : "",
      width_cm: !isCircular && currentSizeMode === "width_only" ? defaultDiameter : "",
      dimensions: !isCircular && currentSizeMode === "both" ? defaultDim : "",
      quantity: primaryQty > 0 ? primaryQty : 50,
    };

    setItemField("size_variants", [...sizeVariants, newVariant], {
      shouldValidate: true,
      shouldDirty: true,
    });
    onActivatePreview?.();
  };

  const handleUpdateSizeVariant = (
    variantIndex: number,
    patch: Partial<OrderDesignSizeVariantFormValues>
  ) => {
    const nextList = sizeVariants.map((item, idx) =>
      idx === variantIndex ? { ...item, ...patch } : item
    );
    setItemField("size_variants", nextList, {
      shouldValidate: true,
      shouldDirty: true,
    });
  };

  const handleRemoveSizeVariant = (variantIndex: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const nextList = sizeVariants.filter((_, idx) => idx !== variantIndex);
    setItemField("size_variants", nextList, {
      shouldValidate: true,
      shouldDirty: true,
    });
  };

  const hasVariantErrors = Boolean(
    Array.isArray(itemErrors?.size_variants) &&
      itemErrors.size_variants.some((entry) => Boolean(entry))
  );

  const hasCardErrors = Boolean(
    itemErrors?.material ||
      itemErrors?.vinyl_gloss_mode ||
      itemErrors?.shape ||
      itemErrors?.diameter_cm ||
      itemErrors?.height_cm ||
      itemErrors?.width_cm ||
      itemErrors?.dimensions ||
      itemErrors?.quantity ||
      itemErrors?.image ||
      hasVariantErrors
  );

  const isCompactMode = compact && !expandedInCompact && !hasCardErrors;

  /** Reusable Extra Size Variants Section (`+ Otra medida de este diseño`) */
  const renderExtraSizesSection = (isCompactLayout: boolean) => (
    <div
      className={`space-y-2.5 ${
        isCompactLayout
          ? "border-t border-dashed border-line-subtle pt-2.5"
          : "rounded-lg border border-dashed border-line-diecut/70 bg-surface-elevated/55 p-3.5"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 font-mono text-[10px] font-extrabold uppercase tracking-wider text-ink-secondary">
            <CopyPlus className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
            <span>
              {sizeVariants.length > 0
                ? `Mismo diseño en ${totalCardMeasures} medidas (${totalCardUnits.toLocaleString()} stickers)`
                : "¿Necesitas este mismo diseño en otro tamaño?"}
            </span>
          </span>
          {sizeVariants.length > 0 && (
            <span className="rounded-full border border-line-diecut/60 bg-accent-soft px-2 py-0.5 font-mono text-[9px] font-bold text-accent">
              1 sola subida de archivo
            </span>
          )}
        </div>

        <button
          type="button"
          disabled={!canAddSizeVariant}
          onClick={handleAddSizeVariant}
          className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-diecut bg-surface-card px-3 py-1 font-mono text-[11px] font-extrabold text-accent shadow-xs transition-all duration-fast ease-studio hover:-translate-y-px hover:bg-accent hover:text-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          <span>+ Otra medida de este diseño</span>
        </button>
      </div>

      {/* List of additional `[Medida | Cantidad]` rows sharing the same artwork */}
      <AnimatePresence initial={false}>
        {sizeVariants.map((variant, vIdx) => {
          const variantMode: StickerSizeMode = variant.size_mode || currentSizeMode;
          const vErr = Array.isArray(itemErrors?.size_variants)
            ? itemErrors?.size_variants[vIdx]
            : undefined;
          const variantMeasure = resolveDesignMeasureSpec({
            shape: value.shape,
            diameter_cm: variant.diameter_cm,
            size_mode: variantMode,
            height_cm: variant.height_cm,
            width_cm: variant.width_cm,
            dimensions: variant.dimensions,
            artworkSize: artworkNaturalSize,
          });
          const measureErrMsg =
            vErr?.diameter_cm?.message ||
            vErr?.height_cm?.message ||
            vErr?.width_cm?.message ||
            vErr?.dimensions?.message;
          const qtyErrMsg = vErr?.quantity?.message;

          return (
            <motion.div
              key={variant.id || `${fieldId}-variant-${vIdx}`}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16 }}
              className="rounded-md border border-line-subtle bg-surface-card p-2.5 shadow-xs"
            >
              <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-xs bg-accent px-1.5 py-0.5 font-mono text-[10px] font-extrabold text-accent-ink">
                    #{formattedNumber}.{vIdx + 2}
                  </span>
                  <span className="font-mono text-[11px] font-bold text-ink-primary">
                    Medida #{vIdx + 2}
                  </span>
                  <span className="rounded-full border border-line-subtle bg-surface-elevated px-2 py-0.5 font-mono text-[10px] font-semibold text-ink-secondary">
                    {variantMeasure.summaryText} · {(Number(variant.quantity) || 0).toLocaleString()} uds.
                  </span>

                  {/* Compact non-circular mode switcher per variant */}
                  {!isCircular && (
                    <div
                      role="group"
                      aria-label={`Modo de medida #${vIdx + 2}`}
                      className="inline-flex rounded-md border border-line-subtle bg-surface-elevated p-0.5 font-mono text-[9px] font-bold"
                    >
                      {NON_CIRCULAR_SIZE_MODE_OPTIONS.map((opt) => {
                        const isModeActive = variantMode === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            disabled={disabled}
                            onClick={() =>
                              handleUpdateSizeVariant(vIdx, { size_mode: opt.value })
                            }
                            className={`rounded-xs px-1.5 py-0.5 transition-colors ${
                              isModeActive
                                ? "bg-accent text-accent-ink"
                                : "text-ink-muted hover:text-ink-primary"
                            }`}
                          >
                            {opt.shortLabel}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Inline [Medida | Cantidad | Eliminar] */}
                <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                  <div className="min-w-[138px] flex-1 sm:w-40">
                    {isCircular ? (
                      <input
                        type="number"
                        step="0.1"
                        min="0.5"
                        max="500"
                        disabled={disabled}
                        aria-label={`Diámetro en cm para medida #${vIdx + 2}`}
                        placeholder="Ø Diámetro cm (ej. 7)"
                        value={variant.diameter_cm ?? ""}
                        onChange={(e) =>
                          handleUpdateSizeVariant(vIdx, { diameter_cm: e.target.value })
                        }
                        className="h-8 w-full rounded-md border border-line-subtle bg-surface-elevated/60 px-2.5 font-mono text-xs font-bold text-ink-primary focus:border-line-diecut focus:bg-surface-card focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    ) : variantMode === "height_only" ? (
                      <input
                        type="number"
                        step="0.1"
                        min="0.5"
                        max="500"
                        disabled={disabled}
                        aria-label={`Solo Alto en cm para medida #${vIdx + 2}`}
                        placeholder="Alto cm (ej. 8)"
                        value={variant.height_cm ?? ""}
                        onChange={(e) =>
                          handleUpdateSizeVariant(vIdx, { height_cm: e.target.value })
                        }
                        className="h-8 w-full rounded-md border border-line-subtle bg-surface-elevated/60 px-2.5 font-mono text-xs font-bold text-ink-primary focus:border-line-diecut focus:bg-surface-card focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    ) : variantMode === "width_only" ? (
                      <input
                        type="number"
                        step="0.1"
                        min="0.5"
                        max="500"
                        disabled={disabled}
                        aria-label={`Solo Ancho en cm para medida #${vIdx + 2}`}
                        placeholder="Ancho cm (ej. 8)"
                        value={variant.width_cm ?? ""}
                        onChange={(e) =>
                          handleUpdateSizeVariant(vIdx, { width_cm: e.target.value })
                        }
                        className="h-8 w-full rounded-md border border-line-subtle bg-surface-elevated/60 px-2.5 font-mono text-xs font-bold text-ink-primary focus:border-line-diecut focus:bg-surface-card focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    ) : (
                      <input
                        type="text"
                        disabled={disabled}
                        aria-label={`Alto x Ancho para medida #${vIdx + 2}`}
                        placeholder="Alto x Ancho (ej. 7x7 cm)"
                        value={variant.dimensions ?? ""}
                        onChange={(e) =>
                          handleUpdateSizeVariant(vIdx, { dimensions: e.target.value })
                        }
                        className="h-8 w-full rounded-md border border-line-subtle bg-surface-elevated/60 px-2.5 font-mono text-xs font-bold text-ink-primary focus:border-line-diecut focus:bg-surface-card focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    )}
                  </div>

                  <div className="w-28 shrink-0">
                    <input
                      type="number"
                      min={1}
                      step={1}
                      disabled={disabled}
                      aria-label={`Cantidad de unidades para medida #${vIdx + 2}`}
                      placeholder="Cant. uds."
                      value={variant.quantity ?? ""}
                      onChange={(e) =>
                        handleUpdateSizeVariant(vIdx, {
                          quantity: Number(e.target.value),
                        })
                      }
                      className="h-8 w-full rounded-md border border-line-subtle bg-surface-elevated/60 px-2.5 font-mono text-xs font-bold tabular-nums text-ink-primary focus:border-line-diecut focus:bg-surface-card focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>

                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={`Eliminar medida #${vIdx + 2}`}
                    onClick={(e) => handleRemoveSizeVariant(vIdx, e)}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line-subtle bg-surface-elevated text-ink-muted transition-colors hover:border-state-critical-bg hover:bg-state-critical-bg hover:text-state-critical-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>

              {(measureErrMsg || qtyErrMsg) && (
                <p
                  role="alert"
                  className="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-state-critical-ink"
                >
                  <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>{measureErrMsg || qtyErrMsg}</span>
                </p>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );

  // ============================================================================
  // COMPACT DIE-CUT STICKER LABEL MODE (For scanning 4 to 20 designs effortlessly)
  // ============================================================================
  if (isCompactMode) {
    return (
      <motion.div
        layout="position"
        variants={stickerSlapVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        onFocusCapture={onActivatePreview}
        onClick={onActivatePreview}
        id={`${idPrefix}-${designNumber}`}
        className="scroll-mt-24"
      >
        <input
          ref={quickFileInputRef}
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml"
          disabled={disabled}
          className="sr-only"
          onChange={(e) => {
            const picked = e.target.files?.[0] ?? null;
            if (picked) {
              onImageChange(picked);
              onActivatePreview?.();
            }
            e.target.value = "";
          }}
        />

        <div
          className={`relative rounded-sticker border-2 border-dashed p-3.5 transition-all duration-fast ease-studio ${
            isActivePreview
              ? "border-line-diecut bg-accent-soft/40 shadow-sticker ring-1 ring-line-diecut/40"
              : "border-line-subtle bg-surface-card shadow-xs hover:border-line-diecut/70"
          }`}
        >
          <CornerRegistrationMarks emphasized={isActivePreview} hasError={hasCardErrors} />

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {/* Left: Numbered Tab + White-Bordered Sticker Miniature + File Info */}
            <div className="flex min-w-0 items-center gap-3">
              {/* Die-Cut White-Bordered Sticker Thumbnail */}
              <button
                type="button"
                disabled={disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  quickFileInputRef.current?.click();
                }}
                title={
                  hasArtwork
                    ? "Haz clic para cambiar la imagen de este diseño"
                    : "Haz clic para subir la imagen de este diseño"
                }
                className="group relative flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-surface-elevated bg-print-grid p-1.5 shadow-xs ring-1 ring-line-subtle transition-transform duration-fast hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {previewUrl ? (
                  <div className="flex h-full w-full items-center justify-center rounded-lg bg-sborg-white p-1 shadow-sticker ring-2 ring-sborg-white">
                    <img
                      src={previewUrl}
                      alt={`Miniatura Diseño #${formattedNumber}`}
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center text-ink-muted group-hover:text-accent">
                    <ImagePlus className="h-5 w-5" aria-hidden="true" />
                    <span className="mt-0.5 font-mono text-[8px] font-bold uppercase">Subir</span>
                  </div>
                )}

                <span
                  className={` -left-1.5 -top-1.5 absolute rounded-md px-1.5 py-0.5 font-mono text-[10px] font-extrabold leading-none shadow-xs ${
                    isActivePreview
                      ? "bg-accent text-accent-ink"
                      : "bg-surface-card text-ink-primary ring-1 ring-line-strong"
                  }`}
                >
                  #{formattedNumber}
                </span>
              </button>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-display text-sm font-extrabold text-ink-primary">
                    Diseño #{formattedNumber}
                  </span>
                  <span className="rounded-full border border-dashed border-line-diecut/70 bg-accent-soft px-2 py-0.5 font-mono text-[10px] font-extrabold tabular-nums text-accent">
                    {totalCardUnits.toLocaleString()} uds.
                    {sizeVariants.length > 0 ? ` (${totalCardMeasures} medidas)` : ""}
                  </span>
                </div>
                <p className="mt-0.5 truncate font-mono text-[11px] text-ink-muted">
                  {value.image instanceof File ? value.image.name : "Sin archivo seleccionado"}
                </p>
              </div>
            </div>

            {/* Right: Inline Quick Edit Controls (Material, Shape, Measure, Quantity, Actions) */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Material Select */}
              <select
                aria-label={`Material para Diseño #${designNumber}`}
                disabled={disabled}
                value={value.material}
                onChange={(e) => handleMaterialSelect(e.target.value as StickerMaterial)}
                className="h-8 rounded-md border border-line-subtle bg-surface-elevated px-2 text-xs font-bold text-ink-primary focus:border-line-diecut focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {materialOptions.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>

              {/* Conditional Vinilo Brillo sub-option */}
              {isVinylGloss && (
                <select
                  aria-label={`Modalidad Vinilo Brillo para Diseño #${designNumber}`}
                  disabled={disabled}
                  value={value.vinyl_gloss_mode ?? "Corte uno a uno"}
                  onChange={(e) => handleGlossModeSelect(e.target.value as VinylGlossMode)}
                  className="h-8 rounded-md border border-dashed border-line-diecut bg-accent-soft/60 px-2 text-xs font-bold text-ink-primary focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {THEME_CONFIG.vinylGlossModes.map((mode) => (
                    <option key={mode.value} value={mode.value}>
                      {mode.label}
                    </option>
                  ))}
                </select>
              )}

              {/* Shape Select */}
              <select
                aria-label={`Forma para Diseño #${designNumber}`}
                disabled={disabled}
                value={value.shape}
                onChange={(e) => handleShapeSelect(e.target.value as StickerShape)}
                className="h-8 rounded-md border border-line-subtle bg-surface-elevated px-2 text-xs font-bold text-ink-primary focus:border-line-diecut focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {THEME_CONFIG.shapes.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>

              {/* Primary Measure Input */}
              {isCircular ? (
                <input
                  type="number"
                  step="0.1"
                  min="0.5"
                  max="500"
                  disabled={disabled}
                  aria-label={`Diámetro en cm para Diseño #${designNumber}`}
                  placeholder="Ø cm"
                  className="h-8 w-24 rounded-md border border-line-subtle bg-surface-elevated px-2 font-mono text-xs font-bold text-ink-primary focus:border-line-diecut focus:outline-none focus:ring-2 focus:ring-ring"
                  {...register(`items.${index}.diameter_cm` as Path<TForm>)}
                />
              ) : currentSizeMode === "height_only" ? (
                <input
                  type="number"
                  step="0.1"
                  min="0.5"
                  max="500"
                  disabled={disabled}
                  aria-label={`Alto en cm para Diseño #${designNumber}`}
                  placeholder="Alto cm"
                  className="h-8 w-24 rounded-md border border-line-subtle bg-surface-elevated px-2 font-mono text-xs font-bold text-ink-primary focus:border-line-diecut focus:outline-none focus:ring-2 focus:ring-ring"
                  {...register(`items.${index}.height_cm` as Path<TForm>)}
                />
              ) : currentSizeMode === "width_only" ? (
                <input
                  type="number"
                  step="0.1"
                  min="0.5"
                  max="500"
                  disabled={disabled}
                  aria-label={`Ancho en cm para Diseño #${designNumber}`}
                  placeholder="Ancho cm"
                  className="h-8 w-24 rounded-md border border-line-subtle bg-surface-elevated px-2 font-mono text-xs font-bold text-ink-primary focus:border-line-diecut focus:outline-none focus:ring-2 focus:ring-ring"
                  {...register(`items.${index}.width_cm` as Path<TForm>)}
                />
              ) : (
                <input
                  type="text"
                  disabled={disabled}
                  aria-label={`Alto x Ancho para Diseño #${designNumber}`}
                  placeholder="5x7 cm"
                  className="h-8 w-28 rounded-md border border-line-subtle bg-surface-elevated px-2 font-mono text-xs font-bold text-ink-primary focus:border-line-diecut focus:outline-none focus:ring-2 focus:ring-ring"
                  {...register(`items.${index}.dimensions` as Path<TForm>)}
                />
              )}

              {/* Primary Quantity Input */}
              <input
                type="number"
                min={1}
                step={1}
                disabled={disabled}
                aria-label={`Cantidad para Diseño #${designNumber}`}
                placeholder="Cant."
                className="h-8 w-20 rounded-md border border-line-subtle bg-surface-elevated px-2 font-mono text-xs font-bold tabular-nums text-ink-primary focus:border-line-diecut focus:outline-none focus:ring-2 focus:ring-ring"
                {...register(`items.${index}.quantity` as Path<TForm>)}
              />

              {/* Expand details button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedInCompact(true);
                }}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-line-subtle bg-surface-elevated px-2.5 font-mono text-[10px] font-bold text-ink-secondary transition-colors hover:border-line-diecut hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Detalle</span>
              </button>

              {canRemove && (
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Eliminar Diseño #${designNumber}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove();
                  }}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line-subtle bg-surface-elevated text-ink-muted transition-colors hover:border-state-critical-bg hover:bg-state-critical-bg hover:text-state-critical-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          {/* Multi-size section inside Compact Mode */}
          <div className="mt-2.5">{renderExtraSizesSection(true)}</div>
        </div>
      </motion.div>
    );
  }

  // ============================================================================
  // DETAILED WORKSHOP SPEC-SHEET MODE
  // ============================================================================
  return (
    <motion.div
      layout="position"
      variants={stickerSlapVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      onFocusCapture={onActivatePreview}
      onClick={onActivatePreview}
      className="relative pt-1"
    >
      {/* Top Print-Shop Spec-Sheet Folder Tab (`DISEÑO #01`) */}
      <div className="flex items-end justify-between gap-2 px-3">
        <div
          className={`relative -mb-px z-10 inline-flex items-center gap-2 rounded-t-lg border border-b-0 px-3.5 py-1.5 font-mono text-[11px] font-extrabold uppercase tracking-wider transition-colors duration-fast ease-studio ${
            hasCardErrors
              ? "border-state-critical-bg bg-state-critical-bg text-state-critical-ink"
              : isActivePreview
              ? "border-line-diecut bg-accent text-accent-ink shadow-xs"
              : "border-line-subtle bg-surface-elevated text-ink-primary"
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${
              hasCardErrors
                ? "bg-state-critical-ink"
                : isActivePreview
                ? hasArtwork
                  ? "bg-accent-ink"
                  : "border border-accent-ink bg-transparent"
                : hasArtwork
                ? "bg-accent"
                : "border border-line-strong bg-transparent"
            }`}
          />
          <span>#{formattedNumber} · DISEÑO</span>
          <span
            className={`hidden text-[10px] font-semibold sm:inline ${
              hasCardErrors
                ? "text-state-critical-ink/85"
                : isActivePreview
                ? "text-accent-ink/85"
                : "text-ink-muted"
            }`}
          >
            · {totalCardUnits.toLocaleString()} STICKERS
          </span>
        </div>

        <div className="mb-1 flex items-center gap-1.5">
          {compact && expandedInCompact && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpandedInCompact(false);
              }}
              className="inline-flex items-center gap-1 rounded-full border border-line-subtle bg-surface-card px-2.5 py-0.5 font-mono text-[10px] font-bold text-ink-secondary hover:border-line-diecut hover:text-ink-primary"
            >
              <ChevronUp className="h-3 w-3" aria-hidden="true" />
              <span>Compactar</span>
            </button>
          )}
          <span className="hidden rounded-full border border-line-subtle bg-surface-card px-2 py-0.5 font-mono text-[10px] font-semibold text-ink-muted sm:inline-block">
            SPEC-{formattedNumber} · 300 DPI
          </span>
          {showPreviewToggle && onActivatePreview && totalCount > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onActivatePreview();
              }}
              className={`hidden items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-bold transition-colors duration-fast ease-studio focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:inline-flex ${
                isActivePreview
                  ? "border-dashed border-line-diecut bg-accent-soft text-accent"
                  : "border-line-subtle bg-surface-card text-ink-muted hover:border-line-strong hover:text-ink-primary"
              }`}
            >
              <Eye className="h-3 w-3" aria-hidden="true" />
              {isActivePreview ? "En simulador" : "Ver en simulador"}
            </button>
          )}
        </div>
      </div>

      {/* Main Workshop Spec-Sheet Body with 4-Corner Registration Marks */}
      <StickerCard
        id={`${idPrefix}-${designNumber}`}
        tone={
          hasCardErrors
            ? "critical"
            : showPreviewToggle && isActivePreview && totalCount > 1
            ? "featured"
            : "default"
        }
        padding="md"
        className="relative scroll-mt-24 space-y-6 rounded-tl-none"
      >
        <CornerRegistrationMarks
          emphasized={showPreviewToggle && isActivePreview && totalCount > 1}
          hasError={hasCardErrors}
        />

        {/* Spec-Sheet Sub-Header: White-Bordered Sticker Miniature + Summary Readout & Discrete Remove */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-dashed border-line-subtle pb-3.5 pt-1">
          <div className="flex min-w-0 items-center gap-3">
            {previewUrl && (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-surface-elevated bg-print-grid p-1 ring-1 ring-line-subtle">
                <div className="flex h-full w-full items-center justify-center rounded-lg bg-sborg-white p-0.5 shadow-sticker">
                  <img
                    src={previewUrl}
                    alt={`Miniatura sticker #${formattedNumber}`}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
              </div>
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-display text-base font-extrabold tracking-tight text-ink-primary">
                  Especificaciones · Diseño #{formattedNumber}
                </h3>
                <span className="rounded-full border border-dashed border-line-diecut/70 bg-accent-soft px-2 py-0.5 font-mono text-[10px] font-extrabold tabular-nums text-accent">
                  {totalCardUnits.toLocaleString()} stickers
                  {sizeVariants.length > 0 ? ` · ${totalCardMeasures} medidas` : ""}
                </span>
              </div>
              <p className="mt-0.5 truncate font-mono text-[11px] text-ink-muted">
                {value.material}
                {isVinylGloss && value.vinyl_gloss_mode ? ` (${value.vinyl_gloss_mode})` : ""} ·{" "}
                {value.shape} · {sizeSummary}
                {primaryQty > 0 ? ` · ${primaryQty.toLocaleString()} uds.` : ""}
              </p>
            </div>
          </div>

          {canRemove && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              aria-label={`Eliminar Diseño #${designNumber}`}
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              leftIcon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
              className="shrink-0 text-ink-muted hover:text-ink-primary"
            >
              <span className="hidden sm:inline">Eliminar</span>
            </Button>
          )}
        </div>

        {/* Sub-section A: Dynamic Material + Independent Vinilo Brillo Conditional Modality */}
        <section aria-labelledby={`design-${fieldId}-material-heading`} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
              <h4
                id={`design-${fieldId}-material-heading`}
                className="text-xs font-bold uppercase tracking-wider text-ink-secondary"
              >
                Material del Sticker *
              </h4>
            </div>
            <span className="font-mono text-[10px] text-ink-muted">
              Sustrato independiente · Diseño #{formattedNumber}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {materialOptions.map((mat) => {
              const selected = value.material === mat.value;
              return (
                <button
                  key={mat.value}
                  type="button"
                  disabled={disabled}
                  aria-pressed={selected}
                  onClick={() => handleMaterialSelect(mat.value)}
                  className={`group relative flex flex-col items-start rounded-lg border p-3 text-left transition-all duration-fast ease-studio focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card active:scale-[0.99] disabled:pointer-events-none disabled:opacity-60 ${
                    selected
                      ? "border-line-diecut bg-accent-soft/75 shadow-sticker ring-1 ring-line-diecut/50"
                      : "border-line-subtle bg-surface-card shadow-xs hover:-translate-y-0.5 hover:border-line-strong hover:bg-surface-elevated/60"
                  }`}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="text-sm font-bold text-ink-primary">{mat.label}</span>
                    <span
                      aria-hidden="true"
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-fast ease-studio ${
                        selected
                          ? "border-accent bg-accent text-accent-ink"
                          : "border-line-strong text-transparent group-hover:border-line-diecut"
                      }`}
                    >
                      <Check className="h-3 w-3" />
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-ink-muted">{mat.description}</p>
                  <span
                    className={`mt-2 inline-block rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold ${
                      selected
                        ? "border-dashed border-line-diecut/70 bg-surface-card text-accent"
                        : "border-line-subtle bg-surface-elevated/70 text-ink-secondary"
                    }`}
                  >
                    {mat.badge}
                  </span>
                </button>
              );
            })}
          </div>

          {itemErrors?.material && (
            <p
              role="alert"
              className="flex items-center gap-1.5 text-xs font-semibold text-ink-primary"
            >
              <span
                aria-hidden="true"
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-state-critical-bg text-state-critical-ink"
              >
                <AlertCircle className="h-3 w-3" />
              </span>
              <span>{itemErrors.material.message}</span>
            </p>
          )}

          {/* Conditional Rule 1: Vinilo Brillo -> En rollo / Corte uno a uno */}
          <AnimatePresence initial={false}>
            {isVinylGloss && (
              <motion.div
                key={`vinyl-gloss-${fieldId}`}
                variants={conditionalFieldVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="overflow-hidden"
              >
                <div className="mt-1 rounded-sticker border-2 border-dashed border-line-diecut bg-accent-soft/35 p-3.5 sm:p-4">
                  <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-ink-primary">
                    <Scissors className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                    <span>Modalidad requerida para Vinilo Brillo *</span>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {THEME_CONFIG.vinylGlossModes.map((mode) => {
                      const active = value.vinyl_gloss_mode === mode.value;
                      return (
                        <button
                          key={mode.value}
                          type="button"
                          disabled={disabled}
                          aria-pressed={active}
                          onClick={() => handleGlossModeSelect(mode.value)}
                          className={`flex flex-col items-start rounded-md border p-3 text-left transition-all duration-fast ease-studio focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card active:scale-[0.99] disabled:pointer-events-none disabled:opacity-60 ${
                            active
                              ? "border-accent bg-accent text-accent-ink shadow-sticker"
                              : "border-line-strong bg-surface-card text-ink-primary shadow-xs hover:-translate-y-px hover:border-line-diecut hover:bg-surface-elevated"
                          }`}
                        >
                          <span className="text-sm font-bold">{mode.label}</span>
                          <span
                            className={`mt-0.5 text-xs ${
                              active ? "text-accent-ink/85" : "text-ink-muted"
                            }`}
                          >
                            {mode.description}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {itemErrors?.vinyl_gloss_mode && (
                    <p
                      role="alert"
                      className="mt-2.5 flex items-center gap-1.5 text-xs font-semibold text-ink-primary"
                    >
                      <span
                        aria-hidden="true"
                        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-state-critical-bg text-state-critical-ink"
                      >
                        <AlertCircle className="h-3 w-3" />
                      </span>
                      <span>{itemErrors.vinyl_gloss_mode.message}</span>
                    </p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Sub-section B: Shape + Independent Conditional Dimensions + Quantity + Extra Measures */}
        <section
          aria-labelledby={`design-${fieldId}-shape-heading`}
          className="space-y-4 border-t border-dashed border-line-subtle pt-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Ruler className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
              <h4
                id={`design-${fieldId}-shape-heading`}
                className="text-xs font-bold uppercase tracking-wider text-ink-secondary"
              >
                Forma, Tamaño y Cantidad *
              </h4>
            </div>
            <span className="font-mono text-[10px] text-ink-muted">
              {isCircular
                ? "Medida circular (solo diámetro)"
                : currentSizeMode === "height_only"
                ? "Medida por Alto (ancho proporcional)"
                : currentSizeMode === "width_only"
                ? "Medida por Ancho (alto proporcional)"
                : "Medida en formato Alto x Ancho"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {THEME_CONFIG.shapes.map((item) => {
              const Icon = shapeIcons[item.value];
              const selected = value.shape === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  disabled={disabled}
                  aria-pressed={selected}
                  onClick={() => handleShapeSelect(item.value)}
                  className={`group flex flex-col items-center justify-center rounded-lg border p-3 text-center transition-all duration-fast ease-studio focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card active:scale-[0.985] disabled:pointer-events-none disabled:opacity-60 ${
                    selected
                      ? "border-accent bg-accent text-accent-ink shadow-sticker"
                      : "border-line-subtle bg-surface-card text-ink-primary shadow-xs hover:-translate-y-0.5 hover:border-line-diecut hover:bg-surface-elevated"
                  }`}
                >
                  <Icon
                    className={`h-5 w-5 transition-transform duration-fast ease-studio group-hover:scale-110 ${
                      selected ? "text-accent-ink" : "text-accent"
                    }`}
                    aria-hidden="true"
                  />
                  <span className="mt-1.5 text-xs font-bold">{item.label}</span>
                  <span
                    className={`mt-0.5 text-[10px] ${
                      selected ? "text-accent-ink/85" : "text-ink-muted"
                    }`}
                  >
                    {item.hint}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Non-circular compact 3-option size mode selector: Alto y Ancho | Solo Alto | Solo Ancho */}
          <AnimatePresence initial={false}>
            {!isCircular && (
              <motion.div
                key={`size-mode-bar-${fieldId}`}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16 }}
                className="rounded-lg border border-dashed border-line-subtle bg-surface-elevated/60 p-2.5"
              >
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 px-0.5">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink-secondary">
                    Modo de medida del diseño
                  </span>
                  {resolvedMeasure.proportionalHint && (
                    <span className="rounded-full border border-dashed border-line-diecut/75 bg-accent-soft px-2 py-0.5 font-mono text-[10px] font-bold tabular-nums text-accent">
                      {resolvedMeasure.livePreviewText}
                    </span>
                  )}
                </div>

                <div
                  role="radiogroup"
                  aria-label={`Modo de medida para Diseño #${designNumber}`}
                  className="grid grid-cols-3 gap-1.5"
                >
                  {NON_CIRCULAR_SIZE_MODE_OPTIONS.map((opt) => {
                    const active = currentSizeMode === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        disabled={disabled}
                        aria-checked={active}
                        onClick={() => handleSizeModeSelect(opt.value)}
                        className={`flex flex-col items-center justify-center rounded-md border px-2 py-1.5 text-center transition-all duration-fast ease-studio focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60 ${
                          active
                            ? "border-accent bg-accent text-accent-ink shadow-xs"
                            : "border-line-subtle bg-surface-card text-ink-secondary hover:border-line-diecut hover:text-ink-primary"
                        }`}
                      >
                        <span className="text-xs font-bold leading-tight">{opt.label}</span>
                        <span
                          className={`mt-0.5 font-mono text-[10px] ${
                            active ? "text-accent-ink/85" : "text-ink-muted"
                          }`}
                        >
                          {opt.shortHint}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Conditional Rule 2: Circular -> ONLY diameter_cm; Others -> Alto y Ancho / Solo Alto / Solo Ancho */}
            <AnimatePresence mode="wait">
              {isCircular ? (
                <motion.div
                  key={`diameter-${fieldId}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.16 }}
                >
                  <Input
                    id={`design-${fieldId}-diameter`}
                    label="Diámetro (cm) *"
                    type="number"
                    step="0.1"
                    min="0.5"
                    max="500"
                    disabled={disabled}
                    placeholder="Ej. 5"
                    helperText="Medida única en centímetros para corte circular."
                    error={itemErrors?.diameter_cm?.message}
                    {...register(`items.${index}.diameter_cm` as Path<TForm>)}
                  />
                </motion.div>
              ) : currentSizeMode === "height_only" ? (
                <motion.div
                  key={`height-only-${fieldId}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.16 }}
                >
                  <Input
                    id={`design-${fieldId}-height-cm`}
                    label="Solo Alto (cm) *"
                    type="number"
                    step="0.1"
                    min="0.5"
                    max="500"
                    disabled={disabled}
                    placeholder="Ej. 7"
                    helperText="El ancho se ajusta proporcionalmente a tu diseño"
                    error={itemErrors?.height_cm?.message || itemErrors?.dimensions?.message}
                    {...register(`items.${index}.height_cm` as Path<TForm>)}
                  />
                </motion.div>
              ) : currentSizeMode === "width_only" ? (
                <motion.div
                  key={`width-only-${fieldId}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.16 }}
                >
                  <Input
                    id={`design-${fieldId}-width-cm`}
                    label="Solo Ancho (cm) *"
                    type="number"
                    step="0.1"
                    min="0.5"
                    max="500"
                    disabled={disabled}
                    placeholder="Ej. 6.5"
                    helperText="El alto se ajusta proporcionalmente a tu diseño"
                    error={itemErrors?.width_cm?.message || itemErrors?.dimensions?.message}
                    {...register(`items.${index}.width_cm` as Path<TForm>)}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key={`dimensions-${fieldId}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.16 }}
                >
                  <Input
                    id={`design-${fieldId}-dimensions`}
                    label="Tamaño: Alto x Ancho *"
                    type="text"
                    disabled={disabled}
                    placeholder="Ej. 5x7 cm"
                    helperText="Ingresa Alto x Ancho en un solo campo (ej. 5x7 cm o 6.5x8)."
                    error={itemErrors?.dimensions?.message}
                    {...register(`items.${index}.dimensions` as Path<TForm>)}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <Input
              id={`design-${fieldId}-quantity`}
              label="Cantidad (unidades) *"
              type="number"
              min={1}
              step={1}
              disabled={disabled}
              placeholder="Ej. 100"
              leftIcon={<Hash className="h-4 w-4" />}
              helperText="Número entero positivo para esta medida."
              error={itemErrors?.quantity?.message}
              {...register(`items.${index}.quantity` as Path<TForm>)}
            />
          </div>

          {/* Multi-size Rows for the Same Design (`+ Otra medida de este diseño`) */}
          {renderExtraSizesSection(false)}
        </section>

        {/* Sub-section C: Independent Die-Cut Artwork Dropzone */}
        <section className="border-t border-dashed border-line-subtle pt-5">
          <StickerDropzone
            label={`Arte del Diseño #${formattedNumber} *`}
            cutlineTag={`Línea de corte · Diseño #${formattedNumber}`}
            emptyTitle={`Arrastra el arte del Diseño #${formattedNumber} o haz clic para subir`}
            file={value.image ?? null}
            previewUrl={previewUrl}
            disabled={disabled}
            error={itemErrors?.image?.message as string | undefined}
            onFileChange={(file) => {
              onImageChange(file);
              onActivatePreview?.();
            }}
          />
        </section>
      </StickerCard>
    </motion.div>
  );
}
