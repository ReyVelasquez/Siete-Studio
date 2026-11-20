import { z } from "zod";

export const materialSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "El nombre debe tener al menos 2 caracteres.")
    .max(80, "Máximo 80 caracteres."),
  description: z.string().trim().max(400, "Máximo 400 caracteres.").optional(),
  requires_gloss_mode: z.boolean().default(false),
  base_unit_price: z.coerce
    .number({ invalid_type_error: "Ingresa un precio numérico válido." })
    .min(0, "El precio no puede ser negativo.")
    .max(100_000, "Precio fuera de rango."),
  is_active: z.boolean().default(true),
});

export type MaterialFormValues = z.infer<typeof materialSchema>;
