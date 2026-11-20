import { z } from "zod";

const strongPassword = z
  .string()
  .min(8, "La contraseña debe tener al menos 8 caracteres.")
  .regex(/[A-Za-z]/, "Incluye al menos una letra.")
  .regex(/[0-9]/, "Incluye al menos un número.");

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
    password: strongPassword,
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

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(6, "Ingresa tu contraseña actual."),
    newPassword: strongPassword,
    confirmNewPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    path: ["confirmNewPassword"],
    message: "La confirmación no coincide con la nueva contraseña.",
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    path: ["newPassword"],
    message: "La nueva contraseña debe ser distinta a la actual.",
  });

export type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>;

export const linkPasswordSchema = z
  .object({
    newPassword: strongPassword,
    confirmNewPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    path: ["confirmNewPassword"],
    message: "Las contraseñas no coinciden.",
  });

export type LinkPasswordFormValues = z.infer<typeof linkPasswordSchema>;

export const adminCreateUserSchema = z.object({
  display_name: z.string().trim().min(2, "Mínimo 2 caracteres.").max(120),
  email: z.string().trim().email("Ingresa un correo electrónico válido."),
  password: strongPassword,
  role: z.enum(["admin", "operador", "cliente"]),
  email_verified: z.boolean().default(true),
});

export type AdminCreateUserFormValues = z.infer<typeof adminCreateUserSchema>;

export const adminTempPasswordSchema = z
  .object({
    new_password: strongPassword,
    confirm_password: z.string(),
  })
  .refine((data) => data.new_password === data.confirm_password, {
    path: ["confirm_password"],
    message: "Las contraseñas no coinciden.",
  });

export type AdminTempPasswordFormValues = z.infer<typeof adminTempPasswordSchema>;
