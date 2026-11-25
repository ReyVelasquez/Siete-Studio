import React from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock,
  Layers,
  Scissors,
} from "lucide-react";
import { formatCurrency } from "@/config/theme.config";
import { StickerBadge } from "@/components/ui/StickerBadge";
import { StickerCard } from "@/components/ui/StickerCard";
import type { OrderItem } from "@/types/order";
import { formatDeliveryShort, getDeliveryUrgency } from "@/utils/date";

interface PendingQueueProps {
  orders: OrderItem[];
  loading: boolean;
  onSelectOrder: (order: OrderItem) => void;
}

export const PendingQueue: React.FC<PendingQueueProps> = ({
  orders,
  loading,
  onSelectOrder,
}) => {
  const overdueCount = orders.filter(
    (order) => getDeliveryUrgency(order.delivery_datetime, order.status) === "overdue"
  ).length;
  const todayCount = orders.filter(
    (order) => getDeliveryUrgency(order.delivery_datetime, order.status) === "today"
  ).length;

  return (
    <StickerCard tone="featured" padding="none" className="overflow-hidden">
      {/* Prominent Die-Cut Command Header */}
      <div className="bg-print-grid flex flex-col gap-3.5 border-b border-dashed border-line-subtle bg-surface-elevated/50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="sticker-badge mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent text-accent-ink"
          >
            <ClipboardList className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-base font-extrabold tracking-tight text-ink-primary sm:text-lg">
                Trabajos Pendientes · Entregas Prioritarias
              </h2>
              {!loading && (
                <span className="sticker-badge rounded-full border border-dashed border-line-diecut bg-accent-soft px-2.5 py-0.5 font-mono text-[11px] font-bold tabular-nums text-ink-primary">
                  {orders.length} en cola
                </span>
              )}
              {!loading && overdueCount > 0 && (
                <span className="sticker-badge inline-flex items-center gap-1 rounded-full bg-state-critical-bg px-2.5 py-0.5 font-mono text-[10px] font-bold tabular-nums text-state-critical-ink">
                  <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                  {overdueCount} atrasado(s)
                </span>
              )}
              {!loading && todayCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-line-diecut/75 bg-surface-card px-2 py-0.5 font-mono text-[10px] font-bold tabular-nums text-accent">
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  {todayCount} hoy
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              Cola activa ordenada por fecha y hora en punto más cercana. Haz clic en cualquier
              trabajo para iniciar producción o troquelado.
            </p>
          </div>
        </div>

        {/* Quick-Access Navigation Buttons */}
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
          <Link
            to="/dashboard/orders?only_pending=true"
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-dashed border-line-diecut/80 bg-accent-soft/65 px-3 text-xs font-bold text-ink-primary shadow-xs transition-all duration-fast ease-studio hover:-translate-y-px hover:border-line-diecut hover:bg-accent-soft hover:shadow-sticker focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card"
          >
            <Clock className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
            <span>Pendientes</span>
          </Link>

          <Link
            to="/dashboard/orders"
            className="group inline-flex h-9 items-center gap-1.5 rounded-full border border-line-subtle bg-surface-card px-3 text-xs font-semibold text-ink-primary shadow-xs transition-all duration-fast ease-studio hover:-translate-y-px hover:border-line-diecut hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card"
          >
            <span>Ver todos</span>
            <ArrowRight
              className="h-3.5 w-3.5 transition-transform duration-fast ease-studio group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3 p-5 sm:p-6">
          {[1, 2, 3, 4].map((idx) => (
            <div
              key={idx}
              className="h-[72px] animate-pulse rounded-lg border border-line-subtle/60 bg-surface-elevated/70"
            />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="bg-print-grid flex flex-col items-center justify-center px-6 py-14 text-center">
          <div className="sticker-badge flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-line-diecut/70 bg-accent-soft text-accent">
            <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
          </div>
          <p className="mt-3.5 text-sm font-bold text-ink-primary">
            No hay trabajos pendientes en cola
          </p>
          <p className="mt-1 max-w-sm text-xs text-ink-muted">
            Cuando ingresen pedidos desde el portal público o desde Pedido Rápido aparecerán aquí
            priorizados por hora.
          </p>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-line-subtle">
            {orders.map((order) => {
              const { dateLabel, timeLabel } = formatDeliveryShort(order.delivery_datetime);
              const urgency = getDeliveryUrgency(order.delivery_datetime, order.status);

              const urgencyRowClasses =
                urgency === "overdue"
                  ? "border-l-state-critical-bg bg-surface-elevated/45"
                  : urgency === "today"
                  ? "border-l-line-diecut bg-accent-soft/20"
                  : "border-l-transparent";

              const iconClasses =
                urgency === "overdue"
                  ? "sticker-badge bg-state-critical-bg text-state-critical-ink"
                  : urgency === "today"
                  ? "border border-dashed border-line-diecut bg-accent-soft text-accent"
                  : "border border-line-subtle bg-surface-elevated text-ink-secondary group-hover:border-line-strong group-hover:text-ink-primary";

              return (
                <li key={order.id}>
                  <button
                    type="button"
                    onClick={() => onSelectOrder(order)}
                    className={`group flex w-full flex-col gap-3 border-l-4 px-5 py-4 text-left transition-all duration-fast ease-studio hover:bg-surface-elevated/75 focus-visible:bg-surface-elevated/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:flex-row sm:items-center sm:justify-between sm:px-6 ${urgencyRowClasses}`}
                  >
                    <div className="flex min-w-0 items-start gap-3.5">
                      <div
                        className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md transition-all duration-fast ease-studio group-hover:scale-105 ${iconClasses}`}
                      >
                        {urgency === "overdue" ? (
                          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <CalendarClock className="h-4 w-4" aria-hidden="true" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-xs border border-line-diecut/35 bg-accent-soft px-1.5 py-0.5 font-mono text-[11px] font-extrabold text-accent">
                            {order.order_number}
                          </span>
                          <span className="truncate font-display text-sm font-extrabold tracking-tight text-ink-primary transition-colors duration-fast ease-studio group-hover:text-accent">
                            {order.referral_name}
                          </span>
                          {urgency === "overdue" && (
                            <span className="rounded-full bg-state-critical-bg px-2 py-0.5 font-mono text-[10px] font-bold tracking-wide text-state-critical-ink">
                              ATRASADO
                            </span>
                          )}
                          {urgency === "today" && (
                            <span className="rounded-full border border-dashed border-line-diecut bg-surface-card px-2 py-0.5 font-mono text-[10px] font-bold tracking-wide text-accent">
                              HOY
                            </span>
                          )}
                        </div>

                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-muted">
                          <span className="inline-flex items-center gap-1">
                            <Layers className="h-3 w-3 text-accent" aria-hidden="true" />
                            <span>
                              {order.material}
                              {order.vinyl_gloss_mode ? ` (${order.vinyl_gloss_mode})` : ""}
                            </span>
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1 font-mono text-[11px]">
                            <Scissors className="h-3 w-3 text-accent" aria-hidden="true" />
                            <span>
                              {order.shape} {order.size_display}
                            </span>
                          </span>
                          <span className="rounded-xs border border-line-subtle bg-surface-card px-1.5 py-0.5 font-mono text-[11px] font-bold tabular-nums text-ink-primary">
                            {order.quantity} uds.
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 sm:shrink-0 sm:justify-end">
                      <div className="text-left sm:text-right">
                        <p className="font-mono text-xs font-extrabold tabular-nums text-ink-primary">
                          {dateLabel} · {timeLabel}
                        </p>
                        <p className="mt-0.5 font-mono text-[11px] tabular-nums text-ink-muted">
                          Saldo:{" "}
                          <strong
                            className={
                              order.pending_balance > 0
                                ? "font-bold text-accent"
                                : "font-semibold text-ink-secondary"
                            }
                          >
                            {formatCurrency(order.pending_balance)}
                          </strong>
                        </p>
                      </div>

                      <StickerBadge status={order.status} size="sm" />

                      <span className="hidden items-center gap-1 rounded-full border border-line-subtle bg-surface-card px-2.5 py-1 text-[11px] font-semibold text-ink-secondary shadow-xs transition-all duration-fast ease-studio group-hover:border-line-diecut group-hover:bg-accent-soft/60 group-hover:text-ink-primary md:inline-flex">
                        <span>Abrir</span>
                        <ChevronRight
                          aria-hidden="true"
                          className="h-3.5 w-3.5 transition-transform duration-fast ease-studio group-hover:translate-x-0.5 group-hover:text-accent"
                        />
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Footer Quick Strip */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-line-subtle bg-surface-elevated/35 px-5 py-3 text-xs sm:px-6">
            <span className="font-mono text-[11px] text-ink-muted">
              Mostrando los próximos{" "}
              <strong className="tabular-nums text-ink-primary">{orders.length}</strong> trabajos
              prioritarios
            </span>
            <Link
              to="/dashboard/orders?only_pending=true"
              className="group inline-flex items-center gap-1 font-semibold text-accent transition-colors duration-fast ease-studio hover:text-accent-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span>Abrir cola completa de producción</span>
              <ArrowRight
                className="h-3.5 w-3.5 transition-transform duration-fast ease-studio group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </Link>
          </div>
        </>
      )}
    </StickerCard>
  );
};
