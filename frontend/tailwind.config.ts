import type { Config } from "tailwindcss";

/**
 * Tailwind CSS theme wired 100% to centralized CSS design tokens in src/styles/tokens.css.
 * Re-theming the entire monochromatic palette only requires editing tokens.css and theme.config.ts.
 */
const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "rgb(var(--brand-50-rgb) / <alpha-value>)",
          100: "rgb(var(--brand-100-rgb) / <alpha-value>)",
          200: "rgb(var(--brand-200-rgb) / <alpha-value>)",
          300: "rgb(var(--brand-300-rgb) / <alpha-value>)",
          400: "rgb(var(--brand-400-rgb) / <alpha-value>)",
          500: "rgb(var(--brand-500-rgb) / <alpha-value>)",
          600: "rgb(var(--brand-600-rgb) / <alpha-value>)",
          700: "rgb(var(--brand-700-rgb) / <alpha-value>)",
          800: "rgb(var(--brand-800-rgb) / <alpha-value>)",
          900: "rgb(var(--brand-900-rgb) / <alpha-value>)",
          950: "rgb(var(--brand-950-rgb) / <alpha-value>)",
        },
        surface: {
          canvas: "var(--surface-canvas)",
          card: "var(--surface-card)",
          elevated: "var(--surface-elevated)",
          subtle: "var(--surface-subtle)",
          inverted: "var(--surface-inverted)",
        },
        ink: {
          primary: "var(--ink-primary)",
          secondary: "var(--ink-secondary)",
          muted: "var(--ink-muted)",
          inverted: "var(--ink-inverted)",
        },
        line: {
          subtle: "var(--border-subtle)",
          strong: "var(--border-strong)",
          diecut: "var(--border-diecut)",
        },
        accent: {
          DEFAULT: "var(--accent-primary)",
          hover: "var(--accent-primary-hover)",
          soft: "var(--accent-soft)",
          ink: "var(--accent-ink)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        display: ["var(--font-display)"],
        mono: ["var(--font-mono)"],
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        sticker: "var(--radius-sticker)",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        elevated: "var(--shadow-elevated)",
        sticker: "var(--shadow-sticker)",
        "sticker-hover": "var(--shadow-sticker-hover)",
      },
    },
  },
  plugins: [],
};

export default config;
