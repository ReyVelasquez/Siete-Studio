import React from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Clock,
  Grid2X2,
  PlusCircle,
  ReceiptText,
  Scissors,
  Sparkles,
} from "lucide-react";
import { THEME_CONFIG } from "@/config/theme.config";
import { StickerCard } from "@/components/ui/StickerCard";

interface QuickActionsProps {
  onOpenQuickOrder: () => void;
  onOpenPhase2Modal?: (moduleId: "enhancer" | "edge_detector" | "layout_packer") => void;
}

const prepressIcons = {
  enhancer: Sparkles,
  edge_detector: Scissors,
  layout_packer: Grid2X2,
};

export const QuickActions: React.FC<QuickActionsProps> = ({
  onOpenQuickOrder,
}) => {
  const navigate = useNavigate();

  return (
    <div className="space-y-5">
      {/* Operational Quick Actions (Primary Command Panel) */}
      <StickerCard dieCut registrationMarks padding="md" className="space-y-3.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-xs font-extrabold uppercase tracking-widest text-ink-secondary">
            Accesos Rápidos · Producción
          </h2>
          <span className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[10px] font-bold text-accent">
            OPERACIÓN
          </span>
        </div>

        {/* Hero Action: Quick Order */}
        <button
          type="button"
          onClick={onOpenQuickOrder}
          className="sticker-badge group flex w-full items-center justify-between gap-3 rounded-lg bg-accent px-4 py-3.5 text-left text-accent-ink transition-all duration-fast ease-studio hover:-translate-y-0.5 hover:bg-accent-hover hover:shadow-sticker-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card active:scale-[0.985]"
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent-ink/15 text-accent-ink">
              <PlusCircle className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-extrabold tracking-tight">Nuevo Pedido Rápido</p>
              <p className="mt-0.5 truncate text-xs text-accent-ink/85">
                Ingreso de mostrador o WhatsApp
              </p>
            </div>
          </div>
          <ArrowUpRight
            aria-hidden="true"
            className="h-4 w-4 shrink-0 transition-transform duration-fast ease-studio group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
          />
        </button>

        {/* Secondary Production Shortcuts */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => navigate("/dashboard/orders?only_pending=true")}
            className="sticker-peel group flex flex-col justify-between gap-3 rounded-lg border border-line-subtle bg-surface-card p-3.5 text-left shadow-xs transition-all duration-fast ease-studio hover:border-line-diecut hover:bg-surface-elevated/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card"
          >
            <div className="flex w-full items-center justify-between">
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-accent-soft text-accent transition-colors duration-fast ease-studio group-hover:bg-accent group-hover:text-accent-ink">
                <Clock className="h-4 w-4" aria-hidden="true" />
              </span>
              <ArrowRight
                aria-hidden="true"
                className="h-3.5 w-3.5 text-ink-muted transition-transform duration-fast ease-studio group-hover:translate-x-0.5 group-hover:text-accent"
              />
            </div>
            <div>
              <p className="text-xs font-bold text-ink-primary">Pedidos Pendientes</p>
              <p className="mt-0.5 text-[11px] text-ink-muted">Cola ordenada por hora</p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => navigate("/dashboard/orders?status=Entregado")}
            className="sticker-peel group flex flex-col justify-between gap-3 rounded-lg border border-line-subtle bg-surface-card p-3.5 text-left shadow-xs transition-all duration-fast ease-studio hover:border-line-strong hover:bg-surface-elevated/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card"
          >
            <div className="flex w-full items-center justify-between">
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-surface-elevated text-ink-primary transition-colors duration-fast ease-studio group-hover:bg-surface-inverted group-hover:text-ink-inverted">
                <ReceiptText className="h-4 w-4" aria-hidden="true" />
              </span>
              <ArrowRight
                aria-hidden="true"
                className="h-3.5 w-3.5 text-ink-muted transition-transform duration-fast ease-studio group-hover:translate-x-0.5 group-hover:text-ink-primary"
              />
            </div>
            <div>
              <p className="text-xs font-bold text-ink-primary">Historial de Ventas</p>
              <p className="mt-0.5 text-[11px] text-ink-muted">Entregados y cobros</p>
            </div>
          </button>
        </div>
      </StickerCard>

      {/* Estudio de Preprensa Shortcuts */}
      <StickerCard padding="md" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-xs font-extrabold uppercase tracking-widest text-ink-secondary">
            Estudio de Preprensa
          </h2>
          <span className="rounded-full border border-dashed border-line-diecut/75 bg-accent-soft px-2 py-0.5 font-mono text-[10px] font-bold text-accent">
            TALLER DIGITAL
          </span>
        </div>

        <div className="space-y-2.5">
          {THEME_CONFIG.phase2Modules
            .filter((mod) => mod.id !== "layout_packer")
            .map((mod) => {
              const Icon = prepressIcons[mod.id as keyof typeof prepressIcons];
              const targetRoute = mod.route || "/dashboard/die-cut";
              return (
                <button
                  key={mod.id}
                  type="button"
                  onClick={() => navigate(targetRoute)}
                  className="group flex w-full items-center justify-between gap-3 rounded-lg border border-line-diecut/55 bg-surface-card p-3 text-left shadow-xs transition-all duration-fast ease-studio hover:-translate-y-0.5 hover:border-line-diecut hover:bg-accent-soft/45 hover:shadow-sticker focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card active:scale-[0.99]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-ink shadow-xs transition-transform duration-fast ease-studio group-hover:-rotate-3">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-ink-primary">
                        {mod.title}
                      </p>
                      <p className="mt-0.5 truncate font-mono text-[10px] text-ink-muted">
                        {mod.stack}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <ArrowRight
                      aria-hidden="true"
                      className="h-3.5 w-3.5 text-ink-muted transition-transform duration-fast ease-studio group-hover:translate-x-0.5 group-hover:text-accent"
                    />
                  </div>
                </button>
              );
            })}
        </div>
      </StickerCard>
    </div>
  );
};
