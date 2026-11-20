/**
 * =============================================================================
 * CENTRALIZED DESIGN & BRANDING CONFIGURATION
 * =============================================================================
 * Edit this file alongside `src/styles/tokens.css` to completely re-brand,
 * change monochromatic palette metadata, typography, business hours, currency,
 * logos, and UI copy without touching individual components.
 */

export const THEME_CONFIG = {
  brand: {
    name: "SIETE",
    fullName: "SIETE · Sticker Studio",
    tagline: "Imprenta de stickers de precisión",
    subtitle: "Vinilo, DTF UV y troquelado profesional a tu medida",
    logoMarkPath: "/brand/logo-mark.svg",
    faviconPath: "/brand/favicon.svg",
    whatsappSupport: "+59170000000",
    currencySymbol: "Bs.",
    locale: "es-BO",
  },

  /** Design token map referencing CSS variables defined in src/styles/tokens.css */
  tokens: {
    paletteName: "Monochrome Electric Cobalt-Slate",
    colors: {
      canvas: "var(--surface-canvas)",
      card: "var(--surface-card)",
      elevated: "var(--surface-elevated)",
      inkPrimary: "var(--ink-primary)",
      inkSecondary: "var(--ink-secondary)",
      inkMuted: "var(--ink-muted)",
      accent: "var(--accent-primary)",
      dieCutBorder: "var(--border-diecut)",
    },
    typography: {
      sans: "var(--font-sans)",
      display: "var(--font-display)",
      mono: "var(--font-mono)",
    },
    radii: {
      sm: "var(--radius-sm)",
      md: "var(--radius-md)",
      lg: "var(--radius-lg)",
      xl: "var(--radius-xl)",
      sticker: "var(--radius-sticker)",
    },
    shadows: {
      card: "var(--shadow-card)",
      elevated: "var(--shadow-elevated)",
      sticker: "var(--shadow-sticker)",
    },
  },

  /** Operating hours for strict top-of-the-hour (:00) delivery selection */
  deliveryHours: {
    startHour: 8,
    endHour: 20,
    get slots(): string[] {
      const result: string[] = [];
      for (let h = this.startHour; h <= this.endHour; h += 1) {
        result.push(`${String(h).padStart(2, "0")}:00`);
      }
      return result;
    },
  },

  upload: {
    maxSizeMB: 10,
    maxSizeBytes: 10 * 1024 * 1024,
    acceptedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"],
    acceptAttribute: ".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml",
  },

  copy: {
    publicPortal: {
      badge: "Recepción Directa · Sin Registro",
      heroTitle: "Envía tu diseño y programa tus stickers en minutos",
      heroDescription:
        "Sube tu arte, elige el material y la forma exacta, y reserva tu hora en punto de entrega. Nuestro taller recibirá tu orden al instante.",
      submitLabel: "Enviar pedido de stickers",
      submittingLabel: "Registrando pedido...",
    },
    auth: {
      loginTitle: "Panel del Taller",
      loginSubtitle: "Inicia sesión para gestionar pedidos pendientes, entregas y ventas.",
      registerTitle: "Crear cuenta interna",
      registerSubtitle: "Registra un nuevo operador para el panel administrativo.",
      forgotTitle: "Recuperar contraseña",
      forgotSubtitle:
        "Ingresa tu correo registrado (Gmail u otro) y te enviaremos un enlace seguro de restablecimiento.",
    },
    dashboard: {
      title: "Centro de Producción y Ventas",
      subtitle: "Prioridad por fecha y hora de entrega · Control financiero en tiempo real",
    },
  },

  materials: [
    {
      value: "Vinilo Brillo" as const,
      label: "Vinilo Brillo",
      description: "Acabado brillante impermeable y colores vibrantes.",
      badge: "Requiere modalidad",
      requiresGlossMode: true,
    },
    {
      value: "Vinilo Mate" as const,
      label: "Vinilo Mate",
      description: "Superficie sedosa antirreflejo con tacto premium.",
      badge: "Antirreflejo",
      requiresGlossMode: false,
    },
    {
      value: "Transparente" as const,
      label: "Transparente",
      description: "Base cristalina ideal para envases, vidrio y acrílico.",
      badge: "Base cristal",
      requiresGlossMode: false,
    },
    {
      value: "DTF UV" as const,
      label: "DTF UV",
      description: "Transfer con relieve táctil para superficies rígidas.",
      badge: "Alto relieve",
      requiresGlossMode: false,
    },
    {
      value: "Hojas Adhesivas" as const,
      label: "Hojas Adhesivas",
      description: "Papel autoadhesivo económico para empaques y etiquetas.",
      badge: "Versátil",
      requiresGlossMode: false,
    },
  ],

  vinylGlossModes: [
    {
      value: "En rollo" as const,
      label: "En rollo",
      description: "Ideal para etiquetado continuo y producción en volumen.",
    },
    {
      value: "Corte uno a uno" as const,
      label: "Corte uno a uno",
      description: "Stickers individuales listos para entregar o vender.",
    },
  ],

  shapes: [
    {
      value: "Circular" as const,
      label: "Circular",
      hint: "Solo diámetro (cm)",
      isCircular: true,
    },
    {
      value: "Rectangular" as const,
      label: "Rectangular",
      hint: "Alto x Ancho",
      isCircular: false,
    },
    {
      value: "Cuadrado" as const,
      label: "Cuadrado",
      hint: "Alto x Ancho",
      isCircular: false,
    },
    {
      value: "En su forma" as const,
      label: "En su forma",
      hint: "Troquel silueta",
      isCircular: false,
    },
  ],

  orderStatuses: [
    "Pendiente",
    "En Diseño",
    "En Impresión",
    "Troquelado",
    "Listo",
    "Entregado",
    "Cancelado",
  ] as const,

  paymentMethods: [
    "Pendiente",
    "Efectivo",
    "Transferencia",
    "QR",
    "Tarjeta",
    "Mixto",
  ] as const,

  phase2Modules: [
    {
      id: "enhancer" as const,
      title: "Mejora de Imagen",
      badge: "Próximamente · Fase 2",
      stack: "Python · OpenCV · NumPy",
      summary: "Escalado inteligente a 300 DPI, eliminación de ruido y calibración de nitidez.",
    },
    {
      id: "edge_detector" as const,
      title: "Troquelado IA",
      badge: "Próximamente · Fase 2",
      stack: "OpenCV · rembg (U2-Net)",
      summary: "Detección automática de silueta con IA y trazado vectorial de línea de corte.",
    },
    {
      id: "layout_packer" as const,
      title: "Distribución en Pliego",
      badge: "Próximamente · Fase 2",
      stack: "NumPy · 2D Bin Packing",
      summary: "Acomodo óptimo de múltiples pedidos en pliego minimizando desperdicio.",
    },
  ],
} as const;

export function formatCurrency(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return `${THEME_CONFIG.brand.currencySymbol} ${safe.toLocaleString(THEME_CONFIG.brand.locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
