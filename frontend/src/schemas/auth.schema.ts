import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().email("Ingresa un correo electrónico válido."),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres."),
});

export type LoginFormValues = z.infer<typeof loginSchema>;

export const registerSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(2, "Ingresa tu nombre completo.")
      .max(80, "Máximo 80 caracteres."),
    email: z.string().trim().email("Ingresa un correo electrónico válido."),
    password: z
      .string()
      .min(8, "La contraseña debe tener al menos 8 caracteres.")
      .regex(/[A-Za-z]/, "Incluye al menos una letra.")
      .regex(/[0-9]/, "Incluye al menos un número."),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Las contraseñas no coinciden.",
  });

export type RegisterFormValues = z.infer<typeof registerSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email("Ingresa un correo electrónico válido."),
});

export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;
