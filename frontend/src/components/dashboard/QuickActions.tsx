import React from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
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
  onOpenPhase2Modal: (moduleId: "enhancer" | "edge_detector" | "layout_packer") => void;
}

const phase2Icons = {
  enhancer: Sparkles,
  edge_detector: Scissors,
  layout_packer: Grid2X2,
};

export const QuickActions: React.FC<QuickActionsProps> = ({
  onOpenQuickOrder,
  onOpenPhase2Modal,
}) => {
  const navigate = useNavigate();

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Operational Quick Actions (Active Phase 1) */}
      <div className="space-y-3 lg:col-span-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-sm font-bold uppercase tracking-wider text-ink-secondary">
            Accesos Rápidos · Producción
          </h2>
          <span className="font-mono text-[10px] font-semibold text-accent">ACTIVO</span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StickerCard
            peel
            padding="sm"
            onClick={() => navigate("/dashboard/orders?only_pending=true")}
            className="flex cursor-pointer flex-col justify-between gap-3"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-ink">
              <Clock className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-bold text-ink-primary">Pedidos Pendientes</p>
              <p className="mt-0.5 text-[11px] text-ink-muted">Cola ordenada por hora</p>
            </div>
          </StickerCard>

          <StickerCard
            peel
            padding="sm"
            onClick={onOpenQuickOrder}
            className="flex cursor-pointer flex-col justify-between gap-3"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-inverted text-ink-inverted">
              <PlusCircle className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-bold text-ink-primary">Nuevo Pedido Rápido</p>
              <p className="mt-0.5 text-[11px] text-ink-muted">Mostrador o WhatsApp</p>
            </div>
          </StickerCard>

          <StickerCard
            peel
            padding="sm"
            onClick={() => navigate("/dashboard/orders?status=Entregado")}
            className="flex cursor-pointer flex-col justify-between gap-3"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-elevated text-accent">
              <ReceiptText className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-bold text-ink-primary">Historial de Ventas</p>
              <p className="mt-0.5 text-[11px] text-ink-muted">Entregados y cobros</p>
            </div>
          </StickerCard>
        </div>
      </div>

      {/* Phase 2 Prepared Shortcuts */}
      <div className="space-y-3 lg:col-span-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-sm font-bold uppercase tracking-wider text-ink-secondary">
            Laboratorio IA & Preprensa
          </h2>
          <span className="rounded-full border border-dashed border-line-diecut px-2 py-0.5 font-mono text-[10px] font-bold text-ink-muted">
            PRÓXIMAMENTE · FASE 2
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {THEME_CONFIG.phase2Modules.map((mod) => {
            const Icon = phase2Icons[mod.id];
            return (
              <button
                key={mod.id}
                type="button"
                onClick={() => onOpenPhase2Modal(mod.id)}
                className="group flex flex-col justify-between gap-3 rounded-sticker border border-dashed border-line-strong bg-surface-card/75 p-4 text-left transition-all hover:border-line-diecut hover:bg-surface-elevated/60"
              >
                <div className="flex items-center justify-between">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-elevated text-ink-secondary group-hover:text-accent">
                    <Icon className="h-4 w-4" />
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-ink-muted transition-transform group-hover:translate-x-0.5" />
                </div>
                <div>
                  <p className="text-xs font-bold text-ink-primary">{mod.title}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-ink-muted">Fase 2 · {mod.stack.split("·")[0].trim()}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
