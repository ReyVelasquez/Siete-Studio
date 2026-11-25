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

export interface StickerBadgeProps {
  status: OrderStatus;
  size?: "sm" | "md";
  /** Enables subtle tactile sticker lift on hover (default: true). */
  interactive?: boolean;
  className?: string;
}

interface StatusStyleConfig {
  badgeClasses: string;
  iconClasses: string;
  dotClasses: string;
  pulseClasses?: string;
  labelClasses?: string;
  icon: React.ComponentType<{ className?: string }>;
}

/**
 * Monochromatic vinyl-sticker status badges built exclusively with Tier 2 & 3
 * semantic design tokens (`tokens.css` + `tailwind.config.ts`).
 *
 * Visual hierarchy prioritizes actionable pending work (`Pendiente`) at first
 * glance via highest-contrast tonal inversion, dashed die-cut contour, and a
 * motion-safe attention beacon, while completed/voided states recede cleanly.
 */
const STATUS_STYLES: Record<OrderStatus, StatusStyleConfig> = {
  Pendiente: {
    badgeClasses:
      "border-dashed border-state-critical-ink/45 bg-state-critical-bg text-state-critical-ink ring-1 ring-state-critical-bg/35 hover:bg-state-critical-bg/90",
    iconClasses: "text-state-critical-ink",
    dotClasses: "bg-state-critical-ink",
    pulseClasses: "bg-state-critical-ink/60",
    labelClasses: "font-extrabold tracking-normal",
    icon: Clock,
  },
  "En Diseño": {
    badgeClasses:
      "border-solid border-line-diecut/70 bg-state-info-bg text-state-info-ink hover:border-line-diecut",
    iconClasses: "text-accent",
    dotClasses: "bg-accent",
    icon: Palette,
  },
  "En Impresión": {
    badgeClasses:
      "border-solid border-line-strong bg-state-warning-bg text-state-warning-ink hover:border-line-diecut",
    iconClasses: "text-state-warning-ink",
    dotClasses: "bg-state-warning-ink/80",
    icon: Printer,
  },
  Troquelado: {
    badgeClasses:
      "border-dashed border-line-diecut bg-accent-soft text-ink-primary hover:bg-accent-soft/85",
    iconClasses:
      "text-accent transition-transform duration-fast ease-studio group-hover/sticker:-rotate-12",
    dotClasses: "border border-dashed border-line-diecut bg-accent/30",
    icon: Scissors,
  },
  Listo: {
    badgeClasses:
      "border-solid border-accent bg-state-positive-bg text-state-positive-ink hover:border-accent-hover hover:bg-accent-hover",
    iconClasses: "text-state-positive-ink",
    dotClasses: "bg-state-positive-ink",
    labelClasses: "font-bold",
    icon: CheckCircle2,
  },
  Entregado: {
    badgeClasses:
      "border-solid border-line-strong/80 bg-surface-card text-ink-secondary hover:border-line-strong hover:text-ink-primary",
    iconClasses: "text-accent",
    dotClasses: "bg-line-strong",
    icon: PackageCheck,
  },
  Cancelado: {
    badgeClasses:
      "border-dotted border-line-strong/75 bg-surface-elevated text-ink-muted opacity-85",
    iconClasses: "text-ink-muted",
    dotClasses: "bg-line-strong",
    labelClasses: "line-through decoration-line-strong",
    icon: XCircle,
  },
};

const SIZE_CLASSES: Record<"sm" | "md", { root: string; icon: string; dot: string }> = {
  sm: {
    root: "px-2.5 py-0.5 text-[11px] gap-1.5",
    icon: "h-3 w-3 shrink-0",
    dot: "h-1.5 w-1.5 shrink-0",
  },
  md: {
    root: "px-3 py-1 text-xs gap-2",
    icon: "h-3.5 w-3.5 shrink-0",
    dot: "h-2 w-2 shrink-0",
  },
};

export const StickerBadge: React.FC<StickerBadgeProps> = ({
  status,
  size = "sm",
  interactive = true,
  className = "",
}) => {
  const config = STATUS_STYLES[status] ?? STATUS_STYLES.Pendiente;
  const sizing = SIZE_CLASSES[size];
  const Icon = config.icon;

  return (
    <span
      data-status={status}
      className={`sticker-badge group/sticker inline-flex select-none items-center rounded-full border-[1.5px] font-semibold tracking-tight whitespace-nowrap transition-all duration-fast ease-studio ${
        interactive ? "hover:-translate-y-0.5 hover:shadow-sticker-hover" : ""
      } ${sizing.root} ${config.badgeClasses} ${className}`}
    >
      <span aria-hidden="true" className={`relative inline-flex ${sizing.dot}`}>
        {config.pulseClasses && (
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full motion-reduce:animate-none ${config.pulseClasses}`}
          />
        )}
        <span className={`relative inline-flex h-full w-full rounded-full ${config.dotClasses}`} />
      </span>
      <Icon className={`${sizing.icon} ${config.iconClasses}`} aria-hidden="true" />
      <span className={config.labelClasses}>{status}</span>
    </span>
  );
};
