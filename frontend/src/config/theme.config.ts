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

  /** Design token map referencing 3-tier CSS variables defined in src/styles/tokens.css */
  tokens: {
    paletteName: "Sborg Studio Palette (#1a1e29 · #132d46 · #01c38e · #ffffff)",
    baseHueVar: "--brand-hue",
    wcagTarget: "WCAG 2.1 AA+ (36/36 Light & Dark Pairs Verified)",
    colors: {
      canvas: "var(--surface-canvas)",
      card: "var(--surface-card)",
      elevated: "var(--surface-elevated)",
      subtle: "var(--surface-subtle)",
      inverted: "var(--surface-inverted)",
      inkPrimary: "var(--ink-primary)",
      inkSecondary: "var(--ink-secondary)",
      inkMuted: "var(--ink-muted)",
      inkInverted: "var(--ink-inverted)",
      accent: "var(--accent-primary)",
      accentHover: "var(--accent-primary-hover)",
      accentSoft: "var(--accent-soft)",
      accentInk: "var(--accent-ink)",
      borderSubtle: "var(--border-subtle)",
      borderStrong: "var(--border-strong)",
      dieCutBorder: "var(--border-diecut)",
      focusRing: "var(--focus-ring-color)",
    },
    typography: {
      sans: "var(--font-sans)",
      display: "var(--font-display)",
      mono: "var(--font-mono)",
    },
    radii: {
      xs: "var(--radius-xs)",
      sm: "var(--radius-sm)",
      md: "var(--radius-md)",
      lg: "var(--radius-lg)",
      xl: "var(--radius-xl)",
      sticker: "var(--radius-sticker)",
    },
    shadows: {
      xs: "var(--shadow-xs)",
      card: "var(--shadow-card)",
      elevated: "var(--shadow-elevated)",
      sticker: "var(--shadow-sticker)",
      stickerHover: "var(--shadow-sticker-hover)",
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
      title: "Mejora de Imagen & CMYK",
      badge: "Estudio de Preprensa",
      active: true,
      route: "/dashboard/image-enhancer",
      stack: "Python · OpenCV · NumPy · CMYK",
      summary: "Escalado 300 DPI, brillo/contraste/gamma, calibración CMYK y exportación TIFF/PNG.",
    },
    {
      id: "edge_detector" as const,
      title: "Troquelado Vectorial & EPS",
      badge: "Estudio de Preprensa",
      active: true,
      route: "/dashboard/die-cut",
      stack: "OpenCV · Bézier · EPS 2 Capas",
      summary: "Troquelado en silueta, círculo o polígono editable estilo Illustrator y exportación .EPS.",
    },
    {
      id: "layout_packer" as const,
      title: "Distribución en Pliego",
      badge: "Estudio de Preprensa",
      active: true,
      route: "/dashboard/die-cut?modo=pliego",
      stack: "NumPy · 2D Bin Packing · EPS/PDF",
      summary: "Acomodo óptimo de diseños en pliego o bobina minimizando desperdicio de material.",
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
