import { z } from "zod";
import { THEME_CONFIG } from "@/config/theme.config";

const PHONE_REGEX = /^\+?[0-9\s\-().]{7,25}$/;
const DIMENSIONS_REGEX = /^\s*(\d+(?:[.,]\d{1,2})?)\s*[xX×]\s*(\d+(?:[.,]\d{1,2})?)(?:\s*cm)?\s*$/;
const SINGLE_CM_REGEX =
  /^\s*(?:(?:alto|ancho)\s*[:=]?\s*)?(\d+(?:[.,]\d{1,2})?)(?:\s*cm)?(?:\s*\(prop\.?\))?\s*$/i;
const HEIGHT_ONLY_PREFIX_REGEX = /^\s*alto\s*[:=]?\s*(\d+(?:[.,]\d{1,2})?)/i;
const WIDTH_ONLY_PREFIX_REGEX = /^\s*ancho\s*[:=]?\s*(\d+(?:[.,]\d{1,2})?)/i;
const EXACT_HOUR_REGEX = /^([01]\d|2[0-3]):00$/;

export const MAX_ORDER_DESIGNS = 20;
export const MAX_TOTAL_ORDER_UPLOAD_MB = 30;
export const MAX_TOTAL_ORDER_UPLOAD_BYTES = MAX_TOTAL_ORDER_UPLOAD_MB * 1024 * 1024;

export const stickerMaterialSchema = z.enum([
  "Vinilo Brillo",
  "Vinilo Mate",
  "Transparente",
  "DTF UV",
  "Hojas Adhesivas",
]);

export const vinylGlossModeSchema = z.enum(["En rollo", "Corte uno a uno"]);

export const stickerShapeSchema = z.enum([
  "Circular",
  "Rectangular",
  "Cuadrado",
  "En su forma",
]);

export const stickerSizeModeSchema = z.enum(["both", "height_only", "width_only"]);

export const orderStatusSchema = z.enum([
  "Pendiente",
  "En Diseño",
  "En Impresión",
  "Troquelado",
  "Listo",
  "Entregado",
  "Cancelado",
]);

export const paymentMethodSchema = z.enum([
  "Pendiente",
  "Efectivo",
  "Transferencia",
  "QR",
  "Tarjeta",
  "Mixto",
]);

const customerHeaderFields = {
  referral_name: z
    .string()
    .trim()
    .min(2, "Ingresa tu nombre o nombre de referido (mínimo 2 caracteres).")
    .max(120, "Máximo 120 caracteres."),
  phone: z
    .string()
    .trim()
    .regex(PHONE_REGEX, "Ingresa un número de teléfono o WhatsApp válido.")
    .refine((val) => {
      const digits = val.replace(/\D/g, "");
      return digits.length >= 7 && digits.length <= 15;
    }, "El teléfono debe contener entre 7 y 15 dígitos."),
  delivery_date: z.string().min(1, "Selecciona una fecha de entrega."),
  delivery_hour: z
    .string()
    .regex(EXACT_HOUR_REGEX, "Solo se permiten horas en punto (minutos en :00)."),
};

export const stickerImageFileSchema = z
  .custom<File | null>((v) => v instanceof File, {
    message: "Debes subir la imagen de este diseño.",
  })
  .refine((file) => !file || file.size <= THEME_CONFIG.upload.maxSizeBytes, {
    message: `El archivo excede el máximo permitido de ${THEME_CONFIG.upload.maxSizeMB} MB.`,
  })
  .refine(
    (file) => {
      if (!file) return false;
      const lower = file.name.toLowerCase();
      const validExt = [".png", ".jpg", ".jpeg", ".webp", ".svg"].some((ext) =>
        lower.endsWith(ext)
      );
      const validMime = (THEME_CONFIG.upload.acceptedMimeTypes as readonly string[]).includes(
        file.type
      );
      return validMime || validExt;
    },
    {
      message: "Formato no permitido. Solo PNG, JPG, WEBP o SVG.",
    }
  );

export function parseSingleCmValue(raw?: string | number | null): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? Math.round(raw * 100) / 100 : null;
  }
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const match = SINGLE_CM_REGEX.exec(trimmed);
  if (!match) return null;
  const num = Number(match[1].replace(",", "."));
  return Number.isFinite(num) && num > 0 ? Math.round(num * 100) / 100 : null;
}

export function formatCmNum(val: number): string {
  const rounded = Math.round(val * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

export function resolveDesignMeasureSpec(params: {
  shape: z.infer<typeof stickerShapeSchema>;
  diameter_cm?: string | number | null;
  size_mode?: z.infer<typeof stickerSizeModeSchema> | null;
  height_cm?: string | number | null;
  width_cm?: string | number | null;
  dimensions?: string | null;
  artworkSize?: { width: number; height: number } | null;
}): {
  effectiveMode: z.infer<typeof stickerSizeModeSchema>;
  heightCm: number | null;
  widthCm: number | null;
  normalizedDimensions: string | null;
  summaryText: string;
  livePreviewText: string;
  proportionalHint: string | null;
} {
  if (params.shape === "Circular") {
    const d = parseSingleCmValue(params.diameter_cm);
    const label = d ? `Ø ${formatCmNum(d)} cm` : "Sin diámetro";
    return {
      effectiveMode: "both",
      heightCm: d,
      widthCm: d,
      normalizedDimensions: null,
      summaryText: label,
      livePreviewText: d ? `Ø ${formatCmNum(d)} cm` : "Indica diámetro",
      proportionalHint: null,
    };
  }

  const rawDims = (params.dimensions || "").trim();
  let mode: z.infer<typeof stickerSizeModeSchema> = params.size_mode || "both";
  if (!params.size_mode && rawDims) {
    if (HEIGHT_ONLY_PREFIX_REGEX.test(rawDims)) mode = "height_only";
    else if (WIDTH_ONLY_PREFIX_REGEX.test(rawDims)) mode = "width_only";
  }

  const artW = params.artworkSize?.width ?? 0;
  const artH = params.artworkSize?.height ?? 0;
  const hasAspect = artW > 0 && artH > 0;

  if (mode === "height_only") {
    const h = parseSingleCmValue(params.height_cm) ?? parseSingleCmValue(rawDims);
    if (h && h >= 0.5 && h <= 500) {
      const hText = formatCmNum(h);
      const approxW = hasAspect ? Math.max(0.1, Math.round(h * (artW / artH) * 10) / 10) : null;
      const propText =
        approxW !== null
          ? `Alto ${hText} cm × ~${formatCmNum(approxW)} cm auto`
          : `Alto ${hText} cm (prop.)`;
      return {
        effectiveMode: "height_only",
        heightCm: h,
        widthCm: approxW,
        normalizedDimensions: `Alto ${hText} cm`,
        summaryText: propText,
        livePreviewText: propText,
        proportionalHint:
          approxW !== null ? `Ancho proporcional estimado: ~${formatCmNum(approxW)} cm` : null,
      };
    }
    return {
      effectiveMode: "height_only",
      heightCm: null,
      widthCm: null,
      normalizedDimensions: null,
      summaryText: "Sin alto",
      livePreviewText: "Indica Alto (cm)",
      proportionalHint: null,
    };
  }

  if (mode === "width_only") {
    const w = parseSingleCmValue(params.width_cm) ?? parseSingleCmValue(rawDims);
    if (w && w >= 0.5 && w <= 500) {
      const wText = formatCmNum(w);
      const approxH = hasAspect ? Math.max(0.1, Math.round(w * (artH / artW) * 10) / 10) : null;
      const propText =
        approxH !== null
          ? `Ancho ${wText} cm × ~${formatCmNum(approxH)} cm auto`
          : `Ancho ${wText} cm (prop.)`;
      return {
        effectiveMode: "width_only",
        heightCm: approxH,
        widthCm: w,
        normalizedDimensions: `Ancho ${wText} cm`,
        summaryText: propText,
        livePreviewText: propText,
        proportionalHint:
          approxH !== null ? `Alto proporcional estimado: ~${formatCmNum(approxH)} cm` : null,
      };
    }
    return {
      effectiveMode: "width_only",
      heightCm: null,
      widthCm: null,
      normalizedDimensions: null,
      summaryText: "Sin ancho",
      livePreviewText: "Indica Ancho (cm)",
      proportionalHint: null,
    };
  }

  // mode === "both"
  const match = DIMENSIONS_REGEX.exec(rawDims);
  let h = parseSingleCmValue(params.height_cm);
  let w = parseSingleCmValue(params.width_cm);
  if (match) {
    h = Number(match[1].replace(",", "."));
    w = Number(match[2].replace(",", "."));
  }
  if (h && w && h >= 0.5 && h <= 500 && w >= 0.5 && w <= 500) {
    const norm = `${formatCmNum(h)}x${formatCmNum(w)} cm`;
    return {
      effectiveMode: "both",
      heightCm: h,
      widthCm: w,
      normalizedDimensions: norm,
      summaryText: norm,
      livePreviewText: norm,
      proportionalHint: null,
    };
  }

  return {
    effectiveMode: "both",
    heightCm: null,
    widthCm: null,
    normalizedDimensions: rawDims || null,
    summaryText: rawDims || "Sin medida",
    livePreviewText: rawDims || "Indica Alto x Ancho",
    proportionalHint: null,
  };
}

export const orderDesignSizeVariantSchema = z.object({
  id: z.string().optional(),
  diameter_cm: z.string().optional(),
  size_mode: stickerSizeModeSchema.optional().default("both"),
  height_cm: z.string().optional(),
  width_cm: z.string().optional(),
  dimensions: z.string().optional(),
  quantity: z.coerce
    .number({ invalid_type_error: "Ingresa una cantidad numérica válida." })
    .int("La cantidad debe ser un número entero.")
    .min(1, "La cantidad mínima es 1 sticker.")
    .max(1_000_000, "Cantidad fuera del límite permitido."),
});

export type OrderDesignSizeVariantFormValues = z.infer<typeof orderDesignSizeVariantSchema>;

function validateShapeDimensionFields(
  shape: z.infer<typeof stickerShapeSchema>,
  measure: {
    diameter_cm?: string;
    size_mode?: z.infer<typeof stickerSizeModeSchema>;
    height_cm?: string;
    width_cm?: string;
    dimensions?: string;
  },
  ctx: z.RefinementCtx,
  pathPrefix: (string | number)[] = []
) {
  if (shape === "Circular") {
    const parsed = Number((measure.diameter_cm || "").replace(",", "."));
    if (!measure.diameter_cm || Number.isNaN(parsed) || parsed < 0.5 || parsed > 500) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...pathPrefix, "diameter_cm"],
        message: "Ingresa un diámetro válido entre 0.5 y 500 cm.",
      });
    }
    return;
  }

  const mode = measure.size_mode || "both";
  const rawDims = (measure.dimensions || "").trim();

  if (mode === "height_only") {
    const h = parseSingleCmValue(measure.height_cm) ?? parseSingleCmValue(rawDims);
    if (h === null || h < 0.5 || h > 500) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...pathPrefix, "height_cm"],
        message: "Ingresa un alto válido entre 0.5 y 500 cm.",
      });
    }
  } else if (mode === "width_only") {
    const w = parseSingleCmValue(measure.width_cm) ?? parseSingleCmValue(rawDims);
    if (w === null || w < 0.5 || w > 500) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...pathPrefix, "width_cm"],
        message: "Ingresa un ancho válido entre 0.5 y 500 cm.",
      });
    }
  } else {
    const match = DIMENSIONS_REGEX.exec(rawDims);
    const hFromField = parseSingleCmValue(measure.height_cm);
    const wFromField = parseSingleCmValue(measure.width_cm);

    if (match) {
      const h = Number(match[1].replace(",", "."));
      const w = Number(match[2].replace(",", "."));
      if (h < 0.5 || h > 500 || w < 0.5 || w > 500) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...pathPrefix, "dimensions"],
          message: "Alto y ancho deben estar entre 0.5 y 500 cm.",
        });
      }
    } else if (hFromField !== null && wFromField !== null) {
      if (hFromField < 0.5 || hFromField > 500 || wFromField < 0.5 || wFromField > 500) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...pathPrefix, "dimensions"],
          message: "Alto y ancho deben estar entre 0.5 y 500 cm.",
        });
      }
    } else {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...pathPrefix, "dimensions"],
        message: "Usa el formato Alto x Ancho (ej. 5x7 cm o 5.5x8).",
      });
    }
  }
}

function validateStickerDesignConditionalRules(
  data: {
    material: z.infer<typeof stickerMaterialSchema>;
    vinyl_gloss_mode?: z.infer<typeof vinylGlossModeSchema> | null;
    shape: z.infer<typeof stickerShapeSchema>;
    diameter_cm?: string;
    size_mode?: z.infer<typeof stickerSizeModeSchema>;
    height_cm?: string;
    width_cm?: string;
    dimensions?: string;
    size_variants?: OrderDesignSizeVariantFormValues[];
  },
  ctx: z.RefinementCtx
) {
  // Conditional Rule 1: Vinilo Brillo requires modality
  if (data.material === "Vinilo Brillo" && !data.vinyl_gloss_mode) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["vinyl_gloss_mode"],
      message: "Selecciona una modalidad para Vinilo Brillo (En rollo o Corte uno a uno).",
    });
  }

  // Conditional Rule 2: Primary measure
  validateShapeDimensionFields(data.shape, data, ctx, []);

  // Conditional Rule 3: Additional size variants sharing the same artwork & shape
  if (Array.isArray(data.size_variants) && data.size_variants.length > 0) {
    data.size_variants.forEach((variant, vIdx) => {
      validateShapeDimensionFields(
        data.shape,
        {
          diameter_cm: variant.diameter_cm,
          size_mode: variant.size_mode || data.size_mode || "both",
          height_cm: variant.height_cm,
          width_cm: variant.width_cm,
          dimensions: variant.dimensions,
        },
        ctx,
        ["size_variants", vIdx]
      );
    });
  }
}

function validateFutureDelivery(
  data: { delivery_date: string; delivery_hour: string },
  ctx: z.RefinementCtx
) {
  if (data.delivery_date && EXACT_HOUR_REGEX.test(data.delivery_hour)) {
    const combined = new Date(`${data.delivery_date}T${data.delivery_hour}:00`);
    const nowMinusGrace = new Date(Date.now() - 5 * 60 * 1000);
    if (!Number.isNaN(combined.getTime()) && combined < nowMinusGrace) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["delivery_hour"],
        message: "La fecha y hora de entrega deben ser futuras.",
      });
    }
  }
}

const stickerDesignBaseFields = {
  material: stickerMaterialSchema,
  vinyl_gloss_mode: vinylGlossModeSchema.optional().nullable(),
  shape: stickerShapeSchema,
  diameter_cm: z.string().optional(),
  size_mode: stickerSizeModeSchema.optional().default("both"),
  height_cm: z.string().optional(),
  width_cm: z.string().optional(),
  dimensions: z.string().optional(),
  quantity: z.coerce
    .number({ invalid_type_error: "Ingresa una cantidad numérica válida." })
    .int("La cantidad debe ser un número entero.")
    .min(1, "La cantidad mínima es 1 sticker.")
    .max(1_000_000, "Cantidad fuera del límite permitido."),
  image: stickerImageFileSchema,
  image_index: z.number().int().min(0).optional(),
  size_variants: z.array(orderDesignSizeVariantSchema).optional(),
};

/** Schema for an individual sticker design card inside a multi-design order. */
export const orderDesignItemSchema = z
  .object(stickerDesignBaseFields)
  .superRefine(validateStickerDesignConditionalRules);

export type OrderDesignItemFormValues = z.infer<typeof orderDesignItemSchema>;

export interface FlattenedOrderDesignSubmissionItem {
  material: z.infer<typeof stickerMaterialSchema>;
  vinyl_gloss_mode: z.infer<typeof vinylGlossModeSchema> | null;
  shape: z.infer<typeof stickerShapeSchema>;
  diameter_cm?: string;
  size_mode?: z.infer<typeof stickerSizeModeSchema>;
  height_cm?: string;
  width_cm?: string;
  dimensions?: string;
  quantity: number;
  image: File;
  image_index: number;
}

/** Count total flattened designs (cards + extra size variants). */
export function countTotalOrderDesignVariants(
  items: ReadonlyArray<Partial<OrderDesignItemFormValues> | undefined>
): number {
  return items.reduce((acc, item) => {
    if (!item) return acc;
    const extraCount = Array.isArray(item.size_variants) ? item.size_variants.length : 0;
    return acc + 1 + extraCount;
  }, 0);
}

/** Sum total sticker units across all cards and their additional size variants. */
export function countTotalOrderUnits(
  items: ReadonlyArray<Partial<OrderDesignItemFormValues> | undefined>
): number {
  return items.reduce((acc, item) => {
    if (!item) return acc;
    const primaryQty = Number(item.quantity);
    let cardSum = Number.isFinite(primaryQty) && primaryQty > 0 ? primaryQty : 0;
    if (Array.isArray(item.size_variants)) {
      for (const variant of item.size_variants) {
        const vQty = Number(variant?.quantity);
        if (Number.isFinite(vQty) && vQty > 0) {
          cardSum += vQty;
        }
      }
    }
    return acc + cardSum;
  }, 0);
}

/** Calculate cumulative byte size of unique File objects across all items. */
export function countUniqueOrderUploadBytes(
  items: ReadonlyArray<Partial<OrderDesignItemFormValues> | undefined>
): number {
  const seen = new Set<File>();
  let totalBytes = 0;
  for (const item of items) {
    const file = item?.image;
    if (file instanceof File && !seen.has(file)) {
      seen.add(file);
      totalBytes += file.size;
    }
  }
  return totalBytes;
}

/**
 * Flatten every `DesignItemCard` and its `size_variants[]` into flat order items,
 * assigning the same `image_index` to all variants that share the same artwork `File`
 * so each unique file is uploaded only once.
 */
export function flattenOrderDesignItemsForSubmission(
  items: ReadonlyArray<OrderDesignItemFormValues>
): {
  flattenedItems: FlattenedOrderDesignSubmissionItem[];
  uniqueImages: File[];
} {
  const uniqueImages: File[] = [];
  const fileIndexMap = new Map<File, number>();
  const flattenedItems: FlattenedOrderDesignSubmissionItem[] = [];

  const resolveImageIndex = (file: File): number => {
    const existing = fileIndexMap.get(file);
    if (existing !== undefined) return existing;
    // Also deduplicate by name + size + lastModified if cloned File instances share the same underlying file
    const bySignatureIdx = uniqueImages.findIndex(
      (f) => f === file || (f.name === file.name && f.size === file.size && f.lastModified === file.lastModified)
    );
    if (bySignatureIdx >= 0) {
      fileIndexMap.set(file, bySignatureIdx);
      return bySignatureIdx;
    }
    const nextIdx = uniqueImages.length;
    uniqueImages.push(file);
    fileIndexMap.set(file, nextIdx);
    return nextIdx;
  };

  for (const item of items) {
    if (!(item.image instanceof File)) continue;
    const imageIndex = resolveImageIndex(item.image);
    const isCircular = item.shape === "Circular";
    const resolvedGloss = item.material === "Vinilo Brillo" ? (item.vinyl_gloss_mode ?? null) : null;

    // 1. Primary measure of this design card
    flattenedItems.push({
      material: item.material,
      vinyl_gloss_mode: resolvedGloss,
      shape: item.shape,
      diameter_cm: isCircular ? item.diameter_cm : undefined,
      size_mode: !isCircular ? (item.size_mode ?? "both") : undefined,
      height_cm: !isCircular ? item.height_cm : undefined,
      width_cm: !isCircular ? item.width_cm : undefined,
      dimensions: !isCircular ? item.dimensions : undefined,
      quantity: Number(item.quantity),
      image: item.image,
      image_index: imageIndex,
    });

    // 2. Additional size variants sharing the exact same artwork (`image_index`)
    if (Array.isArray(item.size_variants) && item.size_variants.length > 0) {
      for (const variant of item.size_variants) {
        const variantMode = variant.size_mode ?? item.size_mode ?? "both";
        flattenedItems.push({
          material: item.material,
          vinyl_gloss_mode: resolvedGloss,
          shape: item.shape,
          diameter_cm: isCircular ? variant.diameter_cm : undefined,
          size_mode: !isCircular ? variantMode : undefined,
          height_cm: !isCircular ? variant.height_cm : undefined,
          width_cm: !isCircular ? variant.width_cm : undefined,
          dimensions: !isCircular ? variant.dimensions : undefined,
          quantity: Number(variant.quantity),
          image: item.image,
          image_index: imageIndex,
        });
      }
    }
  }

  return { flattenedItems, uniqueImages };
}

/** Multi-design Master-Detail schema for the Public Order Page (1 to 20 designs/variants). */
export const publicOrderSchema = z
  .object({
    ...customerHeaderFields,
    items: z
      .array(orderDesignItemSchema)
      .min(1, "Debes incluir al menos 1 diseño de sticker en tu pedido.")
      .max(MAX_ORDER_DESIGNS, `Puedes enviar hasta ${MAX_ORDER_DESIGNS} diseños por pedido.`),
  })
  .superRefine((data, ctx) => {
    validateFutureDelivery(data, ctx);

    const totalVariants = countTotalOrderDesignVariants(data.items);
    if (totalVariants > MAX_ORDER_DESIGNS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: `El total entre diseños y variantes de medida (${totalVariants}) no puede superar ${MAX_ORDER_DESIGNS} ítems por pedido.`,
      });
    }

    const totalQty = countTotalOrderUnits(data.items);
    if (totalQty > 1_000_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: "La suma total de stickers del pedido no puede superar 1,000,000 unidades.",
      });
    }

    const totalBytes = countUniqueOrderUploadBytes(data.items);
    if (totalBytes > MAX_TOTAL_ORDER_UPLOAD_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: `El peso total acumulado de las imágenes únicas no puede superar ${MAX_TOTAL_ORDER_UPLOAD_MB} MB.`,
      });
    }
  });

export type PublicOrderFormValues = z.infer<typeof publicOrderSchema>;

/** Multi-design Master-Detail schema for the internal QuickOrderModal (with initial sales & status). */
export const quickOrderSchema = z
  .object({
    ...customerHeaderFields,
    items: z
      .array(orderDesignItemSchema)
      .min(1, "Debes incluir al menos 1 diseño de sticker en el pedido.")
      .max(MAX_ORDER_DESIGNS, `Puedes registrar hasta ${MAX_ORDER_DESIGNS} diseños por pedido.`),
    total_price: z.coerce
      .number({ invalid_type_error: "Ingresa un precio válido." })
      .min(0, "El precio total no puede ser negativo.")
      .max(10_000_000, "Precio fuera del límite permitido."),
    advance_payment: z.coerce
      .number({ invalid_type_error: "Ingresa un adelanto válido." })
      .min(0, "El adelanto no puede ser negativo.")
      .max(10_000_000, "Adelanto fuera del límite permitido."),
    payment_method: paymentMethodSchema,
    status: orderStatusSchema,
    notes: z.string().max(1000, "Máximo 1000 caracteres.").optional().default(""),
  })
  .superRefine((data, ctx) => {
    validateFutureDelivery(data, ctx);

    const totalVariants = countTotalOrderDesignVariants(data.items);
    if (totalVariants > MAX_ORDER_DESIGNS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: `El total entre diseños y variantes de medida (${totalVariants}) no puede superar ${MAX_ORDER_DESIGNS} ítems por pedido.`,
      });
    }

    const totalQty = countTotalOrderUnits(data.items);
    if (totalQty > 1_000_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: "La suma total de stickers del pedido no puede superar 1,000,000 unidades.",
      });
    }

    const totalBytes = countUniqueOrderUploadBytes(data.items);
    if (totalBytes > MAX_TOTAL_ORDER_UPLOAD_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: `El peso total acumulado de las imágenes únicas no puede superar ${MAX_TOTAL_ORDER_UPLOAD_MB} MB.`,
      });
    }

    if (data.total_price > 0 && data.advance_payment > data.total_price) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["advance_payment"],
        message: "El adelanto no puede superar el precio total.",
      });
    }
  });

export type QuickOrderFormValues = z.infer<typeof quickOrderSchema>;

export const salesUpdateSchema = z
  .object({
    total_price: z.coerce.number().min(0, "No puede ser negativo."),
    advance_payment: z.coerce.number().min(0, "No puede ser negativo."),
    payment_method: paymentMethodSchema,
    status: orderStatusSchema,
    notes: z.string().max(1000, "Máximo 1000 caracteres.").optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.total_price > 0 && data.advance_payment > data.total_price) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["advance_payment"],
        message: "El adelanto no puede superar el precio total.",
      });
    }
  });

export type SalesUpdateFormValues = z.infer<typeof salesUpdateSchema>;
