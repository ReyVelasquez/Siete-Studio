import React, { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertCircle, AlertTriangle, Clock, PlusCircle, RefreshCw } from "lucide-react";
import { pageTransitionVariants } from "@/config/animations";
import { THEME_CONFIG } from "@/config/theme.config";
import { KpiGrid } from "@/components/dashboard/KpiGrid";
import { PendingQueue } from "@/components/dashboard/PendingQueue";
import { QuickActions } from "@/components/dashboard/QuickActions";
import { OrderDetailModal } from "@/components/orders/OrderDetailModal";
import { QuickOrderModal } from "@/components/orders/QuickOrderModal";
import { Button } from "@/components/ui/Button";
import { StickerCard } from "@/components/ui/StickerCard";
import { ordersService } from "@/services/orders.service";
import type { DashboardSummary, OrderItem } from "@/types/order";

export const DashboardHomePage: React.FC = () => {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<OrderItem | null>(null);
  const [quickOrderOpen, setQuickOrderOpen] = useState(false);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await ordersService.getDashboardSummary();
      setSummary(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo cargar el resumen del taller."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  return (
    <motion.div
      variants={pageTransitionVariants}
      initial="initial"
      animate="animate"
      className="space-y-6"
    >
      {/* Band 1: Studio Command Header with Instant Queue Status & Primary CTA */}
      <StickerCard padding="md" className="bg-print-grid overflow-hidden">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-diecut/75 bg-surface-card px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-accent shadow-xs">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full bg-accent"
                />
                Taller de Impresión · En Vivo
              </span>

              {!loading && summary && (
                <span className="sticker-badge inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-diecut bg-accent-soft px-2.5 py-0.5 font-mono text-[11px] font-bold text-ink-primary">
                  <Clock className="h-3 w-3 text-accent" aria-hidden="true" />
                  {summary.pending_orders_count} pendiente(s)
                </span>
              )}

              {!loading && summary && summary.overdue_deliveries_count > 0 && (
                <span className="sticker-badge inline-flex items-center gap-1.5 rounded-full border border-state-critical-bg bg-state-critical-bg px-2.5 py-0.5 font-mono text-[11px] font-bold text-state-critical-ink">
                  <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                  {summary.overdue_deliveries_count} atrasada(s)
                </span>
              )}
            </div>

            <div>
              <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink-primary sm:text-3xl">
                {THEME_CONFIG.copy.dashboard.title}
              </h1>
              <p className="mt-0.5 text-xs text-ink-secondary sm:text-sm">
                {THEME_CONFIG.copy.dashboard.subtitle}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 lg:shrink-0">
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={() => setQuickOrderOpen(true)}
              leftIcon={<PlusCircle className="h-4 w-4" />}
            >
              Nuevo pedido rápido
            </Button>
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={() => void loadSummary()}
              loading={loading}
              leftIcon={<RefreshCw className="h-4 w-4" />}
            >
              Actualizar
            </Button>
          </div>
        </div>
      </StickerCard>

      {error && (
        <StickerCard
          dieCut
          tone="critical"
          padding="sm"
          role="alert"
          className="flex items-start gap-3"
        >
          <span
            aria-hidden="true"
            className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-state-critical-bg text-state-critical-ink"
          >
            <AlertCircle className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 text-xs text-ink-secondary">
            <strong className="font-bold text-ink-primary">Aviso de conexión API:</strong>{" "}
            {error}
          </div>
        </StickerCard>
      )}

      {/* Band 2: Priority Operational Workspace (Above the Fold) */}
      <section
        aria-label="Trabajos pendientes y accesos rápidos"
        className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12"
      >
        {/* Centerpiece: Pending Priority Deliveries */}
        <div className="lg:col-span-7 xl:col-span-8">
          <PendingQueue
            orders={summary?.upcoming_deliveries ?? []}
            loading={loading}
            onSelectOrder={(order) => setSelectedOrder(order)}
          />
        </div>

        {/* Sticky Command Rail: Operational & Prepress Quick Actions */}
        <aside className="lg:sticky lg:top-24 lg:col-span-5 xl:col-span-4">
          <QuickActions onOpenQuickOrder={() => setQuickOrderOpen(true)} />
        </aside>
      </section>

      {/* Band 3: Secondary Operational & Financial Telemetry */}
      <section aria-labelledby="dashboard-kpis-heading" className="space-y-3 pt-1">
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-line-subtle pt-5">
          <h2
            id="dashboard-kpis-heading"
            className="font-display text-xs font-bold uppercase tracking-widest text-ink-secondary"
          >
            Indicadores del Taller · Resumen Operativo y Ventas
          </h2>
          <span className="font-mono text-[11px] text-ink-muted">
            Métricas consolidadas
          </span>
        </div>
        <KpiGrid summary={summary} loading={loading} />
      </section>

      {/* Modals */}
      <OrderDetailModal
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
        onUpdated={() => {
          void loadSummary();
        }}
        onDeleted={() => {
          void loadSummary();
        }}
      />

      <QuickOrderModal
        isOpen={quickOrderOpen}
        onClose={() => setQuickOrderOpen(false)}
        onCreated={() => {
          void loadSummary();
        }}
      />
    </motion.div>
  );
};
