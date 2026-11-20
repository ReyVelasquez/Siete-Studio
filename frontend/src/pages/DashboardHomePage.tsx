import React, { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import { pageTransitionVariants } from "@/config/animations";
import { THEME_CONFIG } from "@/config/theme.config";
import { KpiGrid } from "@/components/dashboard/KpiGrid";
import { PendingQueue } from "@/components/dashboard/PendingQueue";
import { Phase2PreviewModal } from "@/components/dashboard/Phase2PreviewModal";
import { QuickActions } from "@/components/dashboard/QuickActions";
import { OrderDetailModal } from "@/components/orders/OrderDetailModal";
import { QuickOrderModal } from "@/components/orders/QuickOrderModal";
import { Button } from "@/components/ui/Button";
import { ordersService } from "@/services/orders.service";
import type { DashboardSummary, OrderItem } from "@/types/order";

export const DashboardHomePage: React.FC = () => {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<OrderItem | null>(null);
  const [quickOrderOpen, setQuickOrderOpen] = useState(false);
  const [phase2ModalId, setPhase2ModalId] = useState<
    "enhancer" | "edge_detector" | "layout_packer" | null
  >(null);

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
      className="space-y-7"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink-primary">
            {THEME_CONFIG.copy.dashboard.title}
          </h1>
          <p className="mt-0.5 text-xs text-ink-muted">
            {THEME_CONFIG.copy.dashboard.subtitle}
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void loadSummary()}
          loading={loading}
          leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
        >
          Actualizar métricas
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-dashed border-line-diecut bg-surface-card p-4 text-xs text-ink-secondary"
        >
          <strong className="text-ink-primary">Aviso de conexión API:</strong> {error}
        </div>
      )}

      {/* KPI Metrics Grid */}
      <KpiGrid summary={summary} loading={loading} />

      {/* Operational & Phase 2 Quick Actions */}
      <QuickActions
        onOpenQuickOrder={() => setQuickOrderOpen(true)}
        onOpenPhase2Modal={(id) => setPhase2ModalId(id)}
      />

      {/* Upcoming Priority Deliveries */}
      <PendingQueue
        orders={summary?.upcoming_deliveries ?? []}
        loading={loading}
        onSelectOrder={(order) => setSelectedOrder(order)}
      />

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

      <Phase2PreviewModal
        selectedModuleId={phase2ModalId}
        onClose={() => setPhase2ModalId(null)}
      />
    </motion.div>
  );
};
