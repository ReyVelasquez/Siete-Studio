import { z } from "zod";
import { THEME_CONFIG } from "@/config/theme.config";

const PHONE_REGEX = /^\+?[0-9\s\-().]{7,25}$/;
const DIMENSIONS_REGEX = /^\s*(\d+(?:[.,]\d{1,2})?)\s*[xX×]\s*(\d+(?:[.,]\d{1,2})?)(?:\s*cm)?\s*$/;
const EXACT_HOUR_REGEX = /^([01]\d|2[0-3]):00$/;

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

export const publicOrderSchema = z
  .object({
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
    material: stickerMaterialSchema,
    vinyl_gloss_mode: vinylGlossModeSchema.optional().nullable(),
    shape: stickerShapeSchema,
    diameter_cm: z.string().optional(),
    dimensions: z.string().optional(),
    quantity: z.coerce
      .number({ invalid_type_error: "Ingresa una cantidad numérica válida." })
      .int("La cantidad debe ser un número entero.")
      .min(1, "La cantidad mínima es 1 sticker.")
      .max(1_000_000, "Cantidad fuera del límite permitido."),
    delivery_date: z
      .string()
      .min(1, "Selecciona una fecha de entrega."),
    delivery_hour: z
      .string()
      .regex(EXACT_HOUR_REGEX, "Solo se permiten horas en punto (minutos en :00)."),
    image: z
      .custom<File | null>((v) => v instanceof File, {
        message: "Debes subir la imagen de tu sticker.",
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
      ),
  })
  .superRefine((data, ctx) => {
    // Conditional Rule 1: Vinilo Brillo requires modality
    if (data.material === "Vinilo Brillo" && !data.vinyl_gloss_mode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["vinyl_gloss_mode"],
        message: "Selecciona una modalidad para Vinilo Brillo (En rollo o Corte uno a uno).",
      });
    }

    // Conditional Rule 2: Circular -> ONLY diameter; others -> ONLY single Alto x Ancho field
    if (data.shape === "Circular") {
      const parsed = Number((data.diameter_cm || "").replace(",", "."));
      if (!data.diameter_cm || Number.isNaN(parsed) || parsed < 0.5 || parsed > 500) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["diameter_cm"],
          message: "Ingresa un diámetro válido entre 0.5 y 500 cm.",
        });
      }
    } else {
      const rawDims = (data.dimensions || "").trim();
      const match = DIMENSIONS_REGEX.exec(rawDims);
      if (!match) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["dimensions"],
          message: "Usa el formato Alto x Ancho (ej. 5x7 cm o 5.5x8).",
        });
      } else {
        const h = Number(match[1].replace(",", "."));
        const w = Number(match[2].replace(",", "."));
        if (h < 0.5 || h > 500 || w < 0.5 || w > 500) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["dimensions"],
            message: "Alto y ancho deben estar entre 0.5 y 500 cm.",
          });
        }
      }
    }

    // Delivery datetime must not be in the past
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
  });

export type PublicOrderFormValues = z.infer<typeof publicOrderSchema>;

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
