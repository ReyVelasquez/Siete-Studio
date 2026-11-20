import React from "react";
import { motion } from "framer-motion";
import { CalendarClock, Layers, Phone, Ruler } from "lucide-react";
import { staggerContainerVariants, staggerItemVariants } from "@/config/animations";
import { formatCurrency } from "@/config/theme.config";
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

        return (
          <motion.div key={order.id} variants={staggerItemVariants}>
            <StickerCard
              peel
              padding="md"
              onClick={() => onSelectOrder(order)}
              className="flex h-full cursor-pointer flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-mono text-[11px] font-bold text-accent">
                      {order.order_number}
                    </span>
                    <h3 className="mt-0.5 font-display text-base font-bold text-ink-primary">
                      {order.referral_name}
                    </h3>
                  </div>
                  <StickerBadge status={order.status} />
                </div>

                <p className="mt-1 flex items-center gap-1.5 font-mono text-xs text-ink-muted">
                  <Phone className="h-3.5 w-3.5" />
                  {order.phone}
                </p>

                <div className="mt-4 space-y-2 rounded-lg bg-surface-elevated/70 p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-ink-muted">
                      <Layers className="h-3.5 w-3.5" />
                      Material
                    </span>
                    <span className="text-right font-semibold text-ink-primary">
                      {order.material}
                      {order.vinyl_gloss_mode ? ` · ${order.vinyl_gloss_mode}` : ""}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-ink-muted">
                      <Ruler className="h-3.5 w-3.5" />
                      Corte
                    </span>
                    <span className="font-mono font-semibold text-ink-primary">
                      {order.shape} · {order.size_display} × {order.quantity}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-ink-muted">
                      <CalendarClock className="h-3.5 w-3.5" />
                      Entrega
                    </span>
                    <span className="font-mono font-bold text-ink-primary">
                      {dateLabel} · {timeLabel}
                      {urgency === "overdue" ? " (Atrasado)" : urgency === "today" ? " (Hoy)" : ""}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-line-subtle pt-3 text-xs">
                <div>
                  <span className="block text-[10px] uppercase tracking-wider text-ink-muted">
                    Total ({order.payment_method})
                  </span>
                  <span className="font-mono font-bold text-ink-primary">
                    {formatCurrency(order.total_price)}
                  </span>
                </div>
                <div className="text-right">
                  <span className="block text-[10px] uppercase tracking-wider text-ink-muted">
                    Saldo pendiente
                  </span>
                  <span className="font-mono font-extrabold text-brand-700 dark:text-brand-300">
                    {formatCurrency(order.pending_balance)}
                  </span>
                </div>
              </div>
            </StickerCard>
          </motion.div>
        );
      })}
    </motion.div>
  );
};
