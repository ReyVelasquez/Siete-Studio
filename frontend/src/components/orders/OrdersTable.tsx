import React from "react";
import { AlertTriangle, Clock, Eye } from "lucide-react";
import { formatCurrency } from "@/config/theme.config";
import { Button } from "@/components/ui/Button";
import { StickerBadge } from "@/components/ui/StickerBadge";
import type { OrderItem } from "@/types/order";
import { formatDeliveryShort, getDeliveryUrgency } from "@/utils/date";

interface OrdersTableProps {
  orders: OrderItem[];
  onSelectOrder: (order: OrderItem) => void;
}

export const OrdersTable: React.FC<OrdersTableProps> = ({ orders, onSelectOrder }) => {
  return (
    <div className="overflow-hidden rounded-sticker border border-line-subtle bg-surface-card shadow-card">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-line-subtle text-left text-xs">
          <thead className="bg-surface-elevated/80 text-[11px] font-bold uppercase tracking-wider text-ink-muted">
            <tr>
              <th className="px-4 py-3.5">Prioridad / Entrega</th>
              <th className="px-4 py-3.5">Orden & Cliente</th>
              <th className="px-4 py-3.5">Especificación</th>
              <th className="px-4 py-3.5 text-right">Cant.</th>
              <th className="px-4 py-3.5 text-right">Ventas / Saldo</th>
              <th className="px-4 py-3.5">Estado</th>
              <th className="px-4 py-3.5 text-right">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {orders.map((order) => {
              const { dateLabel, timeLabel } = formatDeliveryShort(order.delivery_datetime);
              const urgency = getDeliveryUrgency(order.delivery_datetime, order.status);

              return (
                <tr
                  key={order.id}
                  onClick={() => onSelectOrder(order)}
                  className="cursor-pointer transition-colors hover:bg-surface-elevated/55"
                >
                  <td className="whitespace-nowrap px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      {urgency === "overdue" ? (
                        <span
                          title="Entrega atrasada"
                          className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-900 text-white dark:bg-brand-200 dark:text-brand-950"
                        >
                          <AlertTriangle className="h-3.5 w-3.5" />
                        </span>
                      ) : urgency === "today" ? (
                        <span
                          title="Entrega hoy"
                          className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-line-diecut bg-accent-soft text-accent"
                        >
                          <Clock className="h-3.5 w-3.5" />
                        </span>
                      ) : (
                        <span className="inline-block h-2 w-2 rounded-full bg-line-strong" />
                      )}
                      <div>
                        <p className="font-mono font-bold text-ink-primary">{timeLabel} hrs</p>
                        <p className="text-[11px] capitalize text-ink-muted">{dateLabel}</p>
                      </div>
                    </div>
                  </td>

                  <td className="px-4 py-3.5">
                    <p className="font-mono text-[11px] font-bold text-accent">
                      {order.order_number}
                    </p>
                    <p className="font-semibold text-ink-primary">{order.referral_name}</p>
                    <p className="font-mono text-[11px] text-ink-muted">{order.phone}</p>
                  </td>

                  <td className="px-4 py-3.5">
                    <p className="font-semibold text-ink-primary">
                      {order.material}
                      {order.vinyl_gloss_mode ? (
                        <span className="ml-1 font-normal text-ink-muted">
                          ({order.vinyl_gloss_mode})
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] text-ink-muted">
                      {order.shape} · {order.size_display}
                    </p>
                  </td>

                  <td className="whitespace-nowrap px-4 py-3.5 text-right font-mono font-bold text-ink-primary">
                    {order.quantity.toLocaleString()}
                  </td>

                  <td className="whitespace-nowrap px-4 py-3.5 text-right font-mono">
                    <p className="font-bold text-ink-primary">
                      {formatCurrency(order.total_price)}
                    </p>
                    <p className="text-[11px] text-ink-muted">
                      Saldo:{" "}
                      <span
                        className={
                          order.pending_balance > 0
                            ? "font-bold text-brand-700 dark:text-brand-300"
                            : ""
                        }
                      >
                        {formatCurrency(order.pending_balance)}
                      </span>
                    </p>
                  </td>

                  <td className="whitespace-nowrap px-4 py-3.5">
                    <StickerBadge status={order.status} />
                  </td>

                  <td className="whitespace-nowrap px-4 py-3.5 text-right">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectOrder(order);
                      }}
                      leftIcon={<Eye className="h-3.5 w-3.5" />}
                    >
                      Gestionar
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
