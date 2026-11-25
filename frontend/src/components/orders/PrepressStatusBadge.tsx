import React from "react";
import type { PrepressStatus } from "@/types/order";

export interface PrepressStatusMeta {
  key: "pendiente" | "en_proceso" | "mejorado" | "troquelado" | "listo_pliego";
  label: string;
  classes: string;
  dotClasses: string;
}

export function getPrepressStatusMeta(status?: PrepressStatus | null): PrepressStatusMeta {
  switch (status) {
    case "listo_pliego":
    case "print_ready":
    case "Listo":
      return {
        key: "listo_pliego",
        label: "Listo pliego",
        classes: "border-accent bg-accent text-accent-ink",
        dotClasses: "bg-accent-ink",
      };
    case "troquelado":
    case "die_cut_ready":
    case "Troquelado":
      return {
        key: "troquelado",
        label: "Troquelado",
        classes: "border-dashed border-line-diecut bg-accent-soft text-accent",
        dotClasses: "bg-accent",
      };
    case "mejorado":
    case "enhanced":
    case "Mejorado":
      return {
        key: "mejorado",
        label: "Mejorado",
        classes: "border-preflight-ok-border/80 bg-preflight-ok-bg text-preflight-ok-ink",
        dotClasses: "bg-preflight-ok-dot",
      };
    case "in_progress":
    case "En Proceso":
      return {
        key: "en_proceso",
        label: "En preprensa",
        classes: "border-line-diecut/60 bg-state-info-bg text-state-info-ink",
        dotClasses: "bg-accent",
      };
    case "pendiente":
    case "pending":
    case "Pendiente":
    default:
      return {
        key: "pendiente",
        label: "Pendiente",
        classes: "border-dashed border-line-strong/75 bg-surface-elevated text-ink-muted",
        dotClasses: "bg-line-strong",
      };
  }
}

interface PrepressStatusBadgeProps {
  status?: PrepressStatus | null;
  size?: "xs" | "sm";
  className?: string;
}

export const PrepressStatusBadge: React.FC<PrepressStatusBadgeProps> = ({
  status,
  size = "xs",
  className = "",
}) => {
  const meta = getPrepressStatusMeta(status);
  const sizeClass =
    size === "sm" ? "px-2.5 py-0.5 text-[11px] gap-1.5" : "px-2 py-0.5 text-[10px] gap-1.5";

  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border font-mono font-bold tracking-tight ${sizeClass} ${meta.classes} ${className}`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dotClasses}`}
      />
      <span>{meta.label}</span>
    </span>
  );
};
