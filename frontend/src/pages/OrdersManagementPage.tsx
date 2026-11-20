import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useSearchParams } from "react-router-dom";
import {
  FilterX,
  LayoutGrid,
  Plus,
  RefreshCw,
  Search,
  Table2,
} from "lucide-react";
import { pageTransitionVariants } from "@/config/animations";
import { THEME_CONFIG, formatCurrency } from "@/config/theme.config";
import { OrderDetailModal } from "@/components/orders/OrderDetailModal";
import { OrdersCardGrid } from "@/components/orders/OrdersCardGrid";
import { OrdersTable } from "@/components/orders/OrdersTable";
import { QuickOrderModal } from "@/components/orders/QuickOrderModal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { StickerCard } from "@/components/ui/StickerCard";
import { useOrders } from "@/hooks/useOrders";
import type { OrderItem, OrderStatus, StickerMaterial, StickerShape } from "@/types/order";

export const OrdersManagementPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");

  const [statusFilter, setStatusFilter] = useState<OrderStatus | "">(
    (searchParams.get("status") as OrderStatus) || ""
  );
  const [materialFilter, setMaterialFilter] = useState<StickerMaterial | "">("");
  const [shapeFilter, setShapeFilter] = useState<StickerShape | "">("");
  const [searchQuery, setSearchQuery] = useState("");
  const [onlyPending, setOnlyPending] = useState(
    searchParams.get("only_pending") === "true"
  );

  const [selectedOrder, setSelectedOrder] = useState<OrderItem | null>(null);
  const [quickOrderOpen, setQuickOrderOpen] = useState(false);

  const { orders, total, loading, error, refetch, replaceOrderLocally } = useOrders({
    status: statusFilter,
    material: materialFilter,
    shape: shapeFilter,
    search: searchQuery,
    only_pending: onlyPending,
  });

  const totals = useMemo(() => {
    return orders.reduce(
      (acc, o) => {
        if (o.status !== "Cancelado") {
          acc.sales += o.total_price;
          acc.advance += o.advance_payment;
          acc.balance += o.pending_balance;
        }
        return acc;
      },
      { sales: 0, advance: 0, balance: 0 }
    );
  }, [orders]);

  const clearFilters = () => {
    setStatusFilter("");
    setMaterialFilter("");
    setShapeFilter("");
    setSearchQuery("");
    setOnlyPending(false);
    setSearchParams({});
  };

  const hasActiveFilters = Boolean(
    statusFilter || materialFilter || shapeFilter || searchQuery.trim() || onlyPending
  );

  return (
    <motion.div
      variants={pageTransitionVariants}
      initial="initial"
      animate="animate"
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink-primary">
            Gestión de Pedidos y Ventas
          </h1>
          <p className="mt-0.5 text-xs text-ink-muted">
            Ordenados por prioridad de entrega · Edita precios, adelantos y estados en un clic.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-line-subtle bg-surface-card p-1">
            <button
              type="button"
              onClick={() => setViewMode("table")}
              aria-label="Vista tabla"
              className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                viewMode === "table"
                  ? "bg-accent text-accent-ink"
                  : "text-ink-muted hover:text-ink-primary"
              }`}
            >
              <Table2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Tabla</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("cards")}
              aria-label="Vista tarjetas"
              className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                viewMode === "cards"
                  ? "bg-accent text-accent-ink"
                  : "text-ink-muted hover:text-ink-primary"
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Tarjetas</span>
            </button>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            loading={loading}
            leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
          >
            Refrescar
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={() => setQuickOrderOpen(true)}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            Nuevo Pedido Rápido
          </Button>
        </div>
      </div>

      {/* Filters Toolbar */}
      <StickerCard padding="sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="md:col-span-4">
            <Input
              placeholder="Buscar referido, teléfono o código STK-..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              leftIcon={<Search className="h-4 w-4" />}
            />
          </div>

          <div className="md:col-span-2">
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as OrderStatus | "")}
              aria-label="Filtrar por estado"
            >
              <option value="">Todos los estados</option>
              {THEME_CONFIG.orderStatuses.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </Select>
          </div>

          <div className="md:col-span-3">
            <Select
              value={materialFilter}
              onChange={(e) => setMaterialFilter(e.target.value as StickerMaterial | "")}
              aria-label="Filtrar por material"
            >
              <option value="">Todos los materiales</option>
              {THEME_CONFIG.materials.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="md:col-span-3">
            <Select
              value={shapeFilter}
              onChange={(e) => setShapeFilter(e.target.value as StickerShape | "")}
              aria-label="Filtrar por forma"
            >
              <option value="">Todas las formas</option>
              {THEME_CONFIG.shapes.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle pt-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setOnlyPending((prev) => !prev)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                onlyPending
                  ? "border-accent bg-accent text-accent-ink"
                  : "border-line-strong bg-surface-elevated text-ink-secondary hover:text-ink-primary"
              }`}
            >
              Solo trabajos activos (sin entregar)
            </button>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-ink-muted hover:bg-surface-elevated hover:text-ink-primary"
              >
                <FilterX className="h-3.5 w-3.5" />
                Limpiar filtros
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-4 font-mono text-[11px] text-ink-secondary">
            <span>
              Mostrando <strong className="text-ink-primary">{total}</strong>
            </span>
            <span>
              Ventas: <strong className="text-ink-primary">{formatCurrency(totals.sales)}</strong>
            </span>
            <span>
              Cobrado: <strong className="text-ink-primary">{formatCurrency(totals.advance)}</strong>
            </span>
            <span>
              Saldo:{" "}
              <strong className="text-brand-700 dark:text-brand-300">
                {formatCurrency(totals.balance)}
              </strong>
            </span>
          </div>
        </div>
      </StickerCard>

      {/* Error State */}
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-dashed border-line-diecut bg-surface-card p-4 text-xs text-ink-secondary"
        >
          <strong className="text-ink-primary">No se pudieron cargar los pedidos:</strong> {error}
        </div>
      )}

      {/* Orders Listing */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((idx) => (
            <div key={idx} className="h-16 animate-pulse rounded-xl bg-surface-card" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <StickerCard dieCut padding="lg" className="text-center">
          <p className="text-sm font-bold text-ink-primary">
            No se encontraron pedidos con los filtros actuales
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            Prueba limpiar los filtros o registra un nuevo pedido rápido desde el taller.
          </p>
          {hasActiveFilters && (
            <div className="mt-4">
              <Button type="button" variant="secondary" size="sm" onClick={clearFilters}>
                Mostrar todos los pedidos
              </Button>
            </div>
          )}
        </StickerCard>
      ) : viewMode === "table" ? (
        <OrdersTable orders={orders} onSelectOrder={(order) => setSelectedOrder(order)} />
      ) : (
        <OrdersCardGrid orders={orders} onSelectOrder={(order) => setSelectedOrder(order)} />
      )}

      {/* Detail & Quick Create Modals */}
      <OrderDetailModal
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
        onUpdated={(updated) => replaceOrderLocally(updated)}
        onDeleted={() => void refetch()}
      />

      <QuickOrderModal
        isOpen={quickOrderOpen}
        onClose={() => setQuickOrderOpen(false)}
        onCreated={() => void refetch()}
      />
    </motion.div>
  );
};
