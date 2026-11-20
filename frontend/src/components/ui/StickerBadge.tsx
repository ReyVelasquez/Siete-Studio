import React from "react";
import {
  CheckCircle2,
  Clock,
  PackageCheck,
  Palette,
  Printer,
  Scissors,
  XCircle,
} from "lucide-react";
import type { OrderStatus } from "@/types/order";

interface StickerBadgeProps {
  status: OrderStatus;
  size?: "sm" | "md";
}

/**
 * Monochromatic sticker-style badges differentiated through tonal depth,
 * border style (dashed vs solid), and crisp iconography while staying 100% WCAG AA.
 */
const statusStyles: Record<
  OrderStatus,
  { classes: string; icon: React.ComponentType<{ className?: string }> }
> = {
  Pendiente: {
    classes:
      "border-dashed border-brand-600 bg-surface-card text-brand-800 dark:border-brand-300 dark:bg-brand-950 dark:text-brand-100",
    icon: Clock,
  },
  "En Diseño": {
    classes:
      "border-solid border-brand-300 bg-brand-100 text-brand-900 dark:border-brand-700 dark:bg-brand-900/70 dark:text-brand-100",
    icon: Palette,
  },
  "En Impresión": {
    classes:
      "border-solid border-brand-400 bg-brand-200/80 text-brand-950 dark:border-brand-500 dark:bg-brand-800 dark:text-brand-50",
    icon: Printer,
  },
  Troquelado: {
    classes:
      "border-dashed border-brand-700 bg-brand-200 text-brand-950 dark:border-brand-400 dark:bg-brand-800/90 dark:text-brand-50",
    icon: Scissors,
  },
  Listo: {
    classes:
      "border-solid border-brand-700 bg-brand-700 text-white dark:border-brand-400 dark:bg-brand-400 dark:text-brand-950",
    icon: CheckCircle2,
  },
  Entregado: {
    classes:
      "border-solid border-brand-950 bg-brand-950 text-brand-50 dark:border-brand-100 dark:bg-brand-100 dark:text-brand-950",
    icon: PackageCheck,
  },
  Cancelado: {
    classes:
      "border-solid border-line-strong bg-surface-elevated text-ink-muted line-through",
    icon: XCircle,
  },
};

export const StickerBadge: React.FC<StickerBadgeProps> = ({ status, size = "sm" }) => {
  const config = statusStyles[status] || statusStyles.Pendiente;
  const Icon = config.icon;

  return (
    <span
      className={`sticker-badge inline-flex items-center gap-1.5 rounded-full border font-semibold tracking-tight whitespace-nowrap ${
        size === "sm" ? "px-2.5 py-0.5 text-[11px]" : "px-3 py-1 text-xs"
      } ${config.classes}`}
    >
      <Icon className={size === "sm" ? "h-3 w-3 shrink-0" : "h-3.5 w-3.5 shrink-0"} />
      <span>{status}</span>
    </span>
  );
};
