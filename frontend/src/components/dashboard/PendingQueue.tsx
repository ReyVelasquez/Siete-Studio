import React from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2 } from "lucide-react";
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
  return (
    <StickerCard padding="none" className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-subtle px-5 py-4 sm:px-6">
        <div>
          <h2 className="font-display text-base font-bold text-ink-primary">
            Próximas Entregas Prioritarias
          </h2>
          <p className="text-xs text-ink-muted">
            Trabajos activos ordenados por fecha y hora en punto más cercana.
          </p>
        </div>
        <Link
          to="/dashboard/orders"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-accent hover:underline"
        >
          <span>Ver todos los pedidos</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {loading ? (
        <div className="space-y-3 p-6">
          {[1, 2, 3].map((idx) => (
            <div key={idx} className="h-14 animate-pulse rounded-lg bg-surface-elevated" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-elevated text-accent">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <p className="mt-3 text-sm font-bold text-ink-primary">
            No hay trabajos pendientes en cola
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            Cuando ingresen pedidos desde el portal público o desde Pedido Rápido aparecerán aquí.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-line-subtle">
          {orders.map((order) => {
            const { dateLabel, timeLabel } = formatDeliveryShort(order.delivery_datetime);
            const urgency = getDeliveryUrgency(order.delivery_datetime, order.status);

            return (
              <li
                key={order.id}
                onClick={() => onSelectOrder(order)}
                className="flex cursor-pointer flex-col gap-3 px-5 py-4 transition-colors hover:bg-surface-elevated/60 sm:flex-row sm:items-center sm:justify-between sm:px-6"
              >
                <div className="flex items-start gap-3.5">
                  <div
                    className={`mt-0.5 flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg font-mono text-[11px] font-bold ${
                      urgency === "overdue"
                        ? "bg-brand-900 text-white dark:bg-brand-200 dark:text-brand-950"
                        : urgency === "today"
                        ? "border border-dashed border-line-diecut bg-accent-soft text-accent"
                        : "bg-surface-elevated text-ink-primary"
                    }`}
                  >
                    {urgency === "overdue" ? (
                      <AlertTriangle className="h-4 w-4" />
                    ) : (
                      <CalendarClock className="h-4 w-4" />
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-accent">
                        {order.order_number}
                      </span>
                      <span className="text-sm font-bold text-ink-primary">
                        {order.referral_name}
                      </span>
                      {urgency === "overdue" && (
                        <span className="rounded bg-brand-900 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white dark:bg-brand-200 dark:text-brand-950">
                          ATRASADO
                        </span>
                      )}
                      {urgency === "today" && (
                        <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] font-bold text-accent">
                          HOY
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {order.material}
                      {order.vinyl_gloss_mode ? ` (${order.vinyl_gloss_mode})` : ""} · {order.shape}{" "}
                      {order.size_display} ·{" "}
                      <strong className="font-mono text-ink-secondary">
                        {order.quantity} uds.
                      </strong>
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
                  <div className="text-left sm:text-right">
                    <p className="font-mono text-xs font-bold text-ink-primary">
                      {dateLabel} · {timeLabel}
                    </p>
                    <p className="font-mono text-[11px] text-ink-muted">
                      Saldo: {formatCurrency(order.pending_balance)}
                    </p>
                  </div>
                  <StickerBadge status={order.status} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </StickerCard>
  );
};
