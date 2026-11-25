import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  Clock,
  FilterX,
  Inbox,
  LayoutGrid,
  Plus,
  RefreshCw,
  Scissors,
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

const QUICK_STATUS_FILTERS: readonly OrderStatus[] = [
  "Pendiente",
  "En Diseño",
  "Troquelado",
  "Listo",
];

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
        acc.designs += Math.max(1, o.items_count ?? o.items?.length ?? 1);
        if (o.status !== "Cancelado") {
          acc.sales += o.total_price;
          acc.advance += o.advance_payment;
          acc.balance += o.pending_balance;
        }
        return acc;
      },
      { sales: 0, advance: 0, balance: 0, designs: 0 }
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
      {/* Band 1: Command Header with Prominent Quick Actions */}
      <StickerCard padding="md" className="bg-print-grid overflow-hidden">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-diecut/75 bg-surface-card px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-accent shadow-xs">
                <Scissors className="h-3 w-3" aria-hidden="true" />
                Cola de Producción · Ventas
              </span>
              <span className="sticker-badge inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-diecut bg-accent-soft px-2.5 py-0.5 font-mono text-[11px] font-bold tabular-nums text-ink-primary">
                <Clock className="h-3 w-3 text-accent" aria-hidden="true" />
                {total} pedido(s)
                {totals.designs > total ? ` · ${totals.designs} diseños` : ""}
              </span>
            </div>

            <div>
              <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink-primary sm:text-3xl">
                Gestión de Pedidos y Ventas
              </h1>
              <p className="mt-0.5 text-xs text-ink-secondary sm:text-sm">
                Ordenados por prioridad de entrega · Edita precios, adelantos y estados en un clic.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 lg:shrink-0">
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={() => setQuickOrderOpen(true)}
              leftIcon={<Plus className="h-4 w-4" />}
            >
              Nuevo Pedido Rápido
            </Button>

            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={() => void refetch()}
              loading={loading}
              leftIcon={<RefreshCw className="h-4 w-4" />}
            >
              Refrescar
            </Button>

            <div
              role="group"
              aria-label="Modo de visualización"
              className="inline-flex h-11 items-center rounded-md border border-line-subtle bg-surface-card p-1 shadow-xs"
            >
              <button
                type="button"
                onClick={() => setViewMode("table")}
                aria-label="Vista tabla"
                aria-pressed={viewMode === "table"}
                className={`inline-flex h-full items-center gap-1.5 rounded-sm px-3 text-xs font-semibold transition-all duration-fast ease-studio focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  viewMode === "table"
                    ? "bg-accent text-accent-ink shadow-xs"
                    : "text-ink-muted hover:bg-surface-elevated hover:text-ink-primary"
                }`}
              >
                <Table2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Tabla</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode("cards")}
                aria-label="Vista tarjetas"
                aria-pressed={viewMode === "cards"}
                className={`inline-flex h-full items-center gap-1.5 rounded-sm px-3 text-xs font-semibold transition-all duration-fast ease-studio focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  viewMode === "cards"
                    ? "bg-accent text-accent-ink shadow-xs"
                    : "text-ink-muted hover:bg-surface-elevated hover:text-ink-primary"
                }`}
              >
                <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Tarjetas</span>
              </button>
            </div>
          </div>
        </div>
      </StickerCard>

      {/* Band 2: Priority Quick-Filter & Search Console */}
      <StickerCard dieCut registrationMarks padding="md" className="space-y-4">
        {/* Top Quick-Access Stage & Active-Jobs Pills */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-dashed border-line-subtle pb-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-pressed={onlyPending}
              onClick={() => setOnlyPending((prev) => !prev)}
              className={`sticker-badge inline-flex items-center gap-1.5 rounded-full border-[1.5px] px-3 py-1 text-xs font-bold transition-all duration-fast ease-studio hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card ${
                onlyPending
                  ? "border-accent bg-accent text-accent-ink shadow-sticker"
                  : "border-dashed border-line-diecut/80 bg-accent-soft/60 text-ink-primary hover:border-line-diecut hover:bg-accent-soft"
              }`}
            >
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Solo trabajos activos</span>
            </button>

            <span
              aria-hidden="true"
              className="hidden h-4 w-px bg-line-subtle sm:inline-block"
            />

            {QUICK_STATUS_FILTERS.map((st) => {
              const active = statusFilter === st;
              return (
                <button
                  key={st}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setStatusFilter((prev) => (prev === st ? "" : st))}
                  className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold transition-all duration-fast ease-studio hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    active
                      ? "border-accent bg-accent text-accent-ink shadow-xs"
                      : "border-line-subtle bg-surface-card text-ink-secondary hover:border-line-diecut hover:bg-surface-elevated hover:text-ink-primary"
                  }`}
                >
                  {st}
                </button>
              );
            })}
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1.5 rounded-full border border-line-subtle bg-surface-elevated px-3 py-1 text-xs font-semibold text-ink-secondary transition-all duration-fast ease-studio hover:border-line-strong hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <FilterX className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
              <span>Limpiar filtros</span>
            </button>
          )}
        </div>

        {/* Search & Facet Selectors */}
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

        {/* Consolidated Totals Strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-dashed border-line-subtle pt-3 text-xs">
          <span className="font-mono text-[11px] text-ink-muted">
            Mostrando <strong className="tabular-nums text-ink-primary">{total}</strong> resultado(s)
          </span>

          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] tabular-nums">
            <span className="rounded-md border border-line-subtle bg-surface-elevated/70 px-2.5 py-1 text-ink-secondary">
              Ventas:{" "}
              <strong className="text-ink-primary">{formatCurrency(totals.sales)}</strong>
            </span>
            <span className="rounded-md border border-line-subtle bg-surface-elevated/70 px-2.5 py-1 text-ink-secondary">
              Cobrado:{" "}
              <strong className="text-ink-primary">{formatCurrency(totals.advance)}</strong>
            </span>
            <span className="rounded-md border border-dashed border-line-diecut/70 bg-accent-soft px-2.5 py-1 text-ink-secondary">
              Saldo:{" "}
              <strong className="font-bold text-accent">
                {formatCurrency(totals.balance)}
              </strong>
            </span>
          </div>
        </div>
      </StickerCard>

      {/* Error State */}
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
            <strong className="font-bold text-ink-primary">
              No se pudieron cargar los pedidos:
            </strong>{" "}
            {error}
          </div>
        </StickerCard>
      )}

      {/* Band 3: Orders Listing */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((idx) => (
            <div
              key={idx}
              className="h-16 animate-pulse rounded-sticker border border-line-subtle bg-surface-card"
            />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <StickerCard
          dieCut
          registrationMarks
          padding="lg"
          className="bg-print-grid text-center"
        >
          <div className="sticker-badge mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-line-diecut/70 bg-accent-soft text-accent">
            <Inbox className="h-5 w-5" aria-hidden="true" />
          </div>
          <p className="mt-3.5 text-sm font-bold text-ink-primary">
            No se encontraron pedidos con los filtros actuales
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs text-ink-muted">
            Prueba limpiar los filtros o registra un nuevo pedido rápido desde el taller.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
            {hasActiveFilters && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={clearFilters}
                leftIcon={<FilterX className="h-3.5 w-3.5" />}
              >
                Mostrar todos los pedidos
              </Button>
            )}
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => setQuickOrderOpen(true)}
              leftIcon={<Plus className="h-3.5 w-3.5" />}
            >
              Nuevo Pedido Rápido
            </Button>
          </div>
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
        onUpdated={(updated) => {
          replaceOrderLocally(updated);
          setSelectedOrder((prev) => (prev?.id === updated.id ? updated : prev));
        }}
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
