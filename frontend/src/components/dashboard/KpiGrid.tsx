import React from "react";
import { motion } from "framer-motion";
import { CalendarClock, Clock, TrendingUp, Wallet } from "lucide-react";
import { staggerContainerVariants, staggerItemVariants } from "@/config/animations";
import { formatCurrency } from "@/config/theme.config";
import { StickerCard } from "@/components/ui/StickerCard";
import type { DashboardSummary } from "@/types/order";

interface KpiGridProps {
  summary: DashboardSummary | null;
  loading: boolean;
}

export const KpiGrid: React.FC<KpiGridProps> = ({ summary, loading }) => {
  const cards = [
    {
      label: "Pedidos Pendientes",
      value: summary ? String(summary.pending_orders_count) : "—",
      sub: summary
        ? `${summary.in_production_count} en diseño / impresión / troquelado`
        : "Cargando cola...",
      icon: Clock,
      emphasis: true,
    },
    {
      label: "Entregas para Hoy",
      value: summary ? String(summary.today_deliveries_count) : "—",
      sub:
        summary && summary.overdue_deliveries_count > 0
          ? `${summary.overdue_deliveries_count} entrega(s) atrasada(s) prioritarias`
          : "Sin entregas atrasadas",
      icon: CalendarClock,
      emphasis: false,
    },
    {
      label: "Ventas del Día",
      value: summary ? formatCurrency(summary.today_sales_total) : "—",
      sub: summary
        ? `Cobrado hoy: ${formatCurrency(summary.today_collected_total)}`
        : "Calculando ingresos...",
      icon: Wallet,
      emphasis: false,
    },
    {
      label: "Ventas del Mes",
      value: summary ? formatCurrency(summary.month_sales_total) : "—",
      sub: summary
        ? `Por cobrar: ${formatCurrency(summary.month_pending_balance)}`
        : "Resumen mensual...",
      icon: TrendingUp,
      emphasis: false,
    },
  ];

  return (
    <motion.div
      variants={staggerContainerVariants}
      initial="hidden"
      animate="visible"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <motion.div key={card.label} variants={staggerItemVariants}>
            <StickerCard
              peel
              padding="md"
              className={
                card.emphasis
                  ? "border-brand-600/60 bg-gradient-to-br from-surface-card to-accent-soft/45"
                  : ""
              }
            >
              <div className="flex items-start justify-between">
                <p className="text-xs font-bold uppercase tracking-wider text-ink-muted">
                  {card.label}
                </p>
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-elevated text-accent">
                  <Icon className="h-4 w-4" />
                </span>
              </div>
              <p className="mt-3 font-mono text-2xl font-extrabold tracking-tight text-ink-primary sm:text-3xl">
                {loading ? (
                  <span className="inline-block h-7 w-24 animate-pulse rounded bg-surface-elevated" />
                ) : (
                  card.value
                )}
              </p>
              <p className="mt-1.5 text-xs text-ink-muted">{card.sub}</p>
            </StickerCard>
          </motion.div>
        );
      })}
    </motion.div>
  );
};
