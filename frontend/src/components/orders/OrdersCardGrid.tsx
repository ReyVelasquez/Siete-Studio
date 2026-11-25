import React from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Layers,
  Phone,
  Ruler,
} from "lucide-react";
import { staggerContainerVariants, staggerItemVariants } from "@/config/animations";
import { formatCurrency } from "@/config/theme.config";
import { OrderStickerStack } from "@/components/orders/OrderStickerStack";
import { StickerBadge } from "@/components/ui/StickerBadge";
import { StickerCard } from "@/components/ui/StickerCard";
import type { OrderItem } from "@/types/order";
import { formatDeliveryShort, getDeliveryUrgency } from "@/utils/date";

interface OrdersCardGridProps {
  orders: OrderItem[];
  onSelectOrder: (order: OrderItem) => void;
}

export const OrdersCardGrid: React.FC<OrdersCardGridProps> = ({ orders, onSelectOrder }) => {
  return (
    <motion.div
      variants={staggerContainerVariants}
      initial="hidden"
      animate="visible"
      className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
    >
      {orders.map((order) => {
        const { dateLabel, timeLabel } = formatDeliveryShort(order.delivery_datetime);
        const urgency = getDeliveryUrgency(order.delivery_datetime, order.status);
        const cardTone =
          urgency === "overdue"
            ? "critical"
            : urgency === "today"
            ? "accent"
            : "default";

        return (
          <motion.div key={order.id} variants={staggerItemVariants}>
            <StickerCard
              peel
              interactive
              tone={cardTone}
              padding="md"
              role="button"
              tabIndex={0}
              onClick={() => onSelectOrder(order)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectOrder(order);
                }
              }}
              className="group flex h-full flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-xs bg-accent-soft px-1.5 py-0.5 font-mono text-[11px] font-bold text-accent">
                        {order.order_number}
                      </span>
                      {urgency === "overdue" && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-state-critical-bg px-2 py-0.5 font-mono text-[9px] font-bold text-state-critical-ink">
                          <AlertTriangle className="h-2.5 w-2.5" aria-hidden="true" />
                          ATRASADO
                        </span>
                      )}
                      {urgency === "today" && (
                        <span className="rounded-full border border-dashed border-line-diecut bg-surface-card px-2 py-0.5 font-mono text-[9px] font-bold text-accent">
                          HOY
                        </span>
                      )}
                    </div>
                    <h3 className="mt-1.5 truncate font-display text-base font-extrabold tracking-tight text-ink-primary transition-colors duration-fast ease-studio group-hover:text-accent">
                      {order.referral_name}
                    </h3>
                  </div>
                  <StickerBadge status={order.status} size="sm" />
                </div>

                <p className="mt-1 flex items-center gap-1.5 font-mono text-xs tabular-nums text-ink-muted">
                  <Phone className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                  {order.phone}
                </p>

                {/* Sticker Stack Visual Preview Strip (fanned white-bordered thumbnails on hover) */}
                {(() => {
                  const designCount = Math.max(1, order.items_count ?? order.items?.length ?? 1);
                  const readyPrepress = (order.items ?? []).filter(
                    (it) =>
                      it.prepress_status &&
                      it.prepress_status !== "pendiente" &&
                      it.prepress_status !== "pending" &&
                      it.prepress_status !== "Pendiente"
                  ).length;
                  const totalQty = order.total_quantity ?? order.quantity;

                  return (
                    <div className="mt-3.5 flex items-center justify-between gap-3 rounded-lg border border-dashed border-line-subtle bg-surface-elevated/55 px-3 py-2.5 transition-colors duration-fast ease-studio group-hover:border-line-diecut/60 group-hover:bg-accent-soft/25">
                      <OrderStickerStack order={order} size="md" showBadge />
                      <div className="min-w-0 text-right">
                        <p className="font-mono text-[11px] font-bold tabular-nums text-ink-primary">
                          {designCount === 1
                            ? "1 diseño"
                            : `${designCount} diseños`}
                        </p>
                        <p className="font-mono text-[10px] tabular-nums text-ink-muted">
                          {totalQty.toLocaleString()} uds. totales
                        </p>
                        {designCount >= 2 && readyPrepress > 0 && (
                          <p className="mt-0.5 font-mono text-[10px] font-bold text-accent">
                            {readyPrepress}/{designCount} en preprensa
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })()}

                <div className="mt-3 space-y-2 rounded-lg border border-line-subtle/70 bg-surface-card/85 p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-ink-muted">
                      <Layers className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                      Material
                    </span>
                    <span className="text-right font-semibold text-ink-primary">
                      {order.material}
                      {order.vinyl_gloss_mode ? ` · ${order.vinyl_gloss_mode}` : ""}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-ink-muted">
                      <Ruler className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                      Corte y medida
                    </span>
                    <span className="font-mono font-semibold tabular-nums text-ink-primary">
                      {order.shape} ·{" "}
                      <strong className="rounded border border-line-subtle bg-surface-elevated px-1.5 py-0.5 text-ink-primary">
                        {order.items?.[0]?.size_display || order.size_display}
                      </strong>{" "}
                      × {order.quantity}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-ink-muted">
                      <CalendarClock className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                      Entrega
                    </span>
                    <span className="font-mono font-bold tabular-nums text-ink-primary">
                      {dateLabel} · {timeLabel}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-dashed border-line-subtle pt-3 text-xs">
                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
                    Total ({order.payment_method})
                  </span>
                  <span className="font-mono font-bold tabular-nums text-ink-primary">
                    {formatCurrency(order.total_price)}
                  </span>
                </div>
                <div className="flex items-center gap-2.5 text-right">
                  <div>
                    <span className="block text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
                      Saldo pendiente
                    </span>
                    <span
                      className={`font-mono font-extrabold tabular-nums ${
                        order.pending_balance > 0 ? "text-accent" : "text-ink-secondary"
                      }`}
                    >
                      {formatCurrency(order.pending_balance)}
                    </span>
                  </div>
                  <ArrowRight
                    aria-hidden="true"
                    className="h-4 w-4 text-ink-muted transition-transform duration-fast ease-studio group-hover:translate-x-0.5 group-hover:text-accent"
                  />
                </div>
              </div>
            </StickerCard>
          </motion.div>
        );
      })}
    </motion.div>
  );
};
