import React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";

export const ThemeToggle: React.FC<{ className?: string }> = ({ className = "" }) => {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      title={isDark ? "Modo claro" : "Modo oscuro"}
      className={`inline-flex items-center gap-2 rounded-full border border-line-subtle bg-surface-card px-3 py-1.5 text-xs font-semibold text-ink-secondary shadow-sm transition-colors hover:border-line-strong hover:text-ink-primary ${className}`}
    >
      {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
      <span className="hidden sm:inline">{isDark ? "Claro" : "Oscuro"}</span>
    </button>
  );
};
