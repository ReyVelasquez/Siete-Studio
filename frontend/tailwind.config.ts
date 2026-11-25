import type { Config } from "tailwindcss";

/**
 * Tailwind CSS Design System Configuration — Monochromatic 3-Tier Token Architecture.
 *
 * Every color resolves to `hsl(var(--*-hsl) / <alpha-value>)` from `src/styles/tokens.css`,
 * enabling full Tailwind opacity modifiers (`bg-surface-canvas/85`, `border-line-diecut/60`)
 * and runtime Light/Dark theming with zero hardcoded hex values.
 */
const config: Config = {
  darkMode: [
    "variant",
    [
      "&:where(.dark, .dark *)",
      '&:where([data-theme="dark"], [data-theme="dark"] *)',
    ],
  ],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        /* Tier 1: Sborg Core Palette Anchors & Harmonized Brand Scale */
        sborg: {
          midnight: "hsl(var(--sborg-midnight-hsl) / <alpha-value>)",
          navy: "hsl(var(--sborg-navy-hsl) / <alpha-value>)",
          emerald: "hsl(var(--sborg-emerald-hsl) / <alpha-value>)",
          white: "hsl(var(--sborg-white-hsl) / <alpha-value>)",
        },
        brand: {
          50: "hsl(var(--brand-50-hsl) / <alpha-value>)",
          100: "hsl(var(--brand-100-hsl) / <alpha-value>)",
          200: "hsl(var(--brand-200-hsl) / <alpha-value>)",
          300: "hsl(var(--brand-300-hsl) / <alpha-value>)",
          400: "hsl(var(--brand-400-hsl) / <alpha-value>)",
          500: "hsl(var(--brand-500-hsl) / <alpha-value>)",
          600: "hsl(var(--brand-600-hsl) / <alpha-value>)",
          700: "hsl(var(--brand-700-hsl) / <alpha-value>)",
          800: "hsl(var(--brand-800-hsl) / <alpha-value>)",
          900: "hsl(var(--brand-900-hsl) / <alpha-value>)",
          950: "hsl(var(--brand-950-hsl) / <alpha-value>)",
        },

        /* Tier 2: Semantic Surface, Ink, Line & Accent Tokens (opacity-modifier ready) */
        surface: {
          canvas: "hsl(var(--surface-canvas-hsl) / <alpha-value>)",
          card: "hsl(var(--surface-card-hsl) / <alpha-value>)",
          elevated: "hsl(var(--surface-elevated-hsl) / <alpha-value>)",
          subtle: "hsl(var(--surface-subtle-hsl) / <alpha-value>)",
          inverted: "hsl(var(--surface-inverted-hsl) / <alpha-value>)",
        },
        ink: {
          primary: "hsl(var(--ink-primary-hsl) / <alpha-value>)",
          secondary: "hsl(var(--ink-secondary-hsl) / <alpha-value>)",
          muted: "hsl(var(--ink-muted-hsl) / <alpha-value>)",
          inverted: "hsl(var(--ink-inverted-hsl) / <alpha-value>)",
        },
        line: {
          subtle: "hsl(var(--border-subtle-hsl) / <alpha-value>)",
          strong: "hsl(var(--border-strong-hsl) / <alpha-value>)",
          diecut: "hsl(var(--border-diecut-hsl) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent-primary-hsl) / <alpha-value>)",
          hover: "hsl(var(--accent-primary-hover-hsl) / <alpha-value>)",
          soft: "hsl(var(--accent-soft-hsl) / <alpha-value>)",
          ink: "hsl(var(--accent-ink-hsl) / <alpha-value>)",
          foreground: "hsl(var(--accent-ink-hsl) / <alpha-value>)",
        },

        /* Tier 2 Standard Design-System Aliases (composable UI primitives) */
        background: "hsl(var(--background-hsl) / <alpha-value>)",
        foreground: "hsl(var(--foreground-hsl) / <alpha-value>)",
        card: {
          DEFAULT: "hsl(var(--card-hsl) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground-hsl) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "hsl(var(--primary-hsl) / <alpha-value>)",
          hover: "hsl(var(--primary-hover-hsl) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground-hsl) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary-hsl) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground-hsl) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted-hsl) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground-hsl) / <alpha-value>)",
        },
        border: "hsl(var(--border-subtle-hsl) / <alpha-value>)",
        input: "hsl(var(--input-hsl) / <alpha-value>)",
        ring: "hsl(var(--ring-hsl) / <alpha-value>)",

        /* Tier 2 Monochromatic Tonal Feedback Tokens */
        state: {
          "info-bg": "hsl(var(--state-info-bg-hsl) / <alpha-value>)",
          "info-ink": "hsl(var(--state-info-ink-hsl) / <alpha-value>)",
          "positive-bg": "hsl(var(--state-positive-bg-hsl) / <alpha-value>)",
          "positive-ink": "hsl(var(--state-positive-ink-hsl) / <alpha-value>)",
          "warning-bg": "hsl(var(--state-warning-bg-hsl) / <alpha-value>)",
          "warning-ink": "hsl(var(--state-warning-ink-hsl) / <alpha-value>)",
          "critical-bg": "hsl(var(--state-critical-bg-hsl) / <alpha-value>)",
          "critical-ink": "hsl(var(--state-critical-ink-hsl) / <alpha-value>)",
        },

        /* Tier 2 Prepress Preflight Traffic-Light Tokens */
        preflight: {
          "ok-bg": "hsl(var(--preflight-ok-bg-hsl) / <alpha-value>)",
          "ok-ink": "hsl(var(--preflight-ok-ink-hsl) / <alpha-value>)",
          "ok-border": "hsl(var(--preflight-ok-border-hsl) / <alpha-value>)",
          "ok-dot": "hsl(var(--preflight-ok-dot-hsl) / <alpha-value>)",
          "warn-bg": "hsl(var(--preflight-warn-bg-hsl) / <alpha-value>)",
          "warn-ink": "hsl(var(--preflight-warn-ink-hsl) / <alpha-value>)",
          "warn-border": "hsl(var(--preflight-warn-border-hsl) / <alpha-value>)",
          "warn-dot": "hsl(var(--preflight-warn-dot-hsl) / <alpha-value>)",
          "crit-bg": "hsl(var(--preflight-crit-bg-hsl) / <alpha-value>)",
          "crit-ink": "hsl(var(--preflight-crit-ink-hsl) / <alpha-value>)",
          "crit-border": "hsl(var(--preflight-crit-border-hsl) / <alpha-value>)",
          "crit-dot": "hsl(var(--preflight-crit-dot-hsl) / <alpha-value>)",
        },

        /* Tier 2 Calibrated Darkroom / Cutting-Mat Surface Tokens */
        darkroom: {
          mat: "hsl(var(--darkroom-mat-hsl) / <alpha-value>)",
          surface: "hsl(var(--darkroom-surface-hsl) / <alpha-value>)",
          elevated: "hsl(var(--darkroom-elevated-hsl) / <alpha-value>)",
          ink: "hsl(var(--darkroom-ink-hsl) / <alpha-value>)",
          muted: "hsl(var(--darkroom-muted-hsl) / <alpha-value>)",
          line: "hsl(var(--darkroom-line-hsl) / <alpha-value>)",
        },

        /* Tier 2 Vector CutContour Plotter Stroke Tokens */
        cutcontour: {
          magenta: "hsl(var(--cutcontour-magenta-hsl) / <alpha-value>)",
          cyan: "hsl(var(--cutcontour-cyan-hsl) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        display: ["var(--font-display)"],
        mono: ["var(--font-mono)"],
      },
      borderRadius: {
        xs: "var(--radius-xs)",
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        sticker: "var(--radius-sticker)",
      },
      boxShadow: {
        xs: "var(--shadow-xs)",
        card: "var(--shadow-card)",
        elevated: "var(--shadow-elevated)",
        sticker: "var(--shadow-sticker)",
        "sticker-hover": "var(--shadow-sticker-hover)",
      },
      transitionDuration: {
        fast: "var(--duration-fast)",
        base: "var(--duration-base)",
      },
      transitionTimingFunction: {
        studio: "var(--ease-studio)",
      },
    },
  },
  plugins: [],
};

export default config;
