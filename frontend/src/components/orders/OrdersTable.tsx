import React from "react";
import { AlertTriangle, Clock, Eye, Layers } from "lucide-react";
import { formatCurrency } from "@/config/theme.config";
import { OrderStickerStack } from "@/components/orders/OrderStickerStack";
import { Button } from "@/components/ui/Button";
import { StickerBadge } from "@/components/ui/StickerBadge";
import { StickerCard } from "@/components/ui/StickerCard";
import type { OrderItem } from "@/types/order";
import { formatDeliveryShort, getDeliveryUrgency } from "@/utils/date";

interface OrdersTableProps {
  orders: OrderItem[];
  onSelectOrder: (order: OrderItem) => void;
}

export const OrdersTable: React.FC<OrdersTableProps> = ({ orders, onSelectOrder }) => {
  return (
    <StickerCard tone="featured" padding="none" className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-line-subtle text-left text-xs">
          <thead className="border-b border-dashed border-line-subtle bg-surface-elevated/65 text-[11px] font-bold uppercase tracking-wider text-ink-secondary">
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

              const rowUrgencyClass =
                urgency === "overdue"
                  ? "border-l-[3px] border-l-state-critical-bg bg-surface-elevated/35"
                  : urgency === "today"
                  ? "border-l-[3px] border-l-line-diecut bg-accent-soft/15"
                  : "border-l-[3px] border-l-transparent";

              return (
                <tr
                  key={order.id}
                  onClick={() => onSelectOrder(order)}
                  className={`group cursor-pointer transition-colors duration-fast ease-studio hover:bg-surface-elevated/70 ${rowUrgencyClass}`}
                >
                  <td className="whitespace-nowrap px-4 py-3.5">
                    <div className="flex items-center gap-2.5">
                      {urgency === "overdue" ? (
                        <span
                          title="Entrega atrasada"
                          className="sticker-badge inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-state-critical-bg text-state-critical-ink"
                        >
                          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                      ) : urgency === "today" ? (
                        <span
                          title="Entrega hoy"
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dashed border-line-diecut bg-accent-soft text-accent"
                        >
                          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                      ) : (
                        <span
                          aria-hidden="true"
                          className="mx-2 inline-block h-2 w-2 shrink-0 rounded-full bg-line-strong"
                        />
                      )}
                      <div>
                        <div className="flex items-center gap-1.5">
                          <p className="font-mono font-bold tabular-nums text-ink-primary">
                            {timeLabel} hrs
                          </p>
                          {urgency === "overdue" && (
                            <span className="rounded-full bg-state-critical-bg px-1.5 py-0.5 font-mono text-[9px] font-bold text-state-critical-ink">
                              ATRASADO
                            </span>
                          )}
                          {urgency === "today" && (
                            <span className="rounded-full border border-dashed border-line-diecut bg-accent-soft px-1.5 py-0.5 font-mono text-[9px] font-bold text-accent">
                              HOY
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] capitalize text-ink-muted">{dateLabel}</p>
                      </div>
                    </div>
                  </td>

                  <td className="px-4 py-3.5">
                    <span className="inline-block rounded-xs bg-accent-soft px-1.5 py-0.5 font-mono text-[11px] font-bold text-accent">
                      {order.order_number}
                    </span>
                    <p className="mt-1 font-bold text-ink-primary transition-colors duration-fast ease-studio group-hover:text-accent">
                      {order.referral_name}
                    </p>
                    <p className="font-mono text-[11px] tabular-nums text-ink-muted">
                      {order.phone}
                    </p>
                  </td>

                  <td className="px-4 py-3.5">
                    {(() => {
                      const designCount = Math.max(1, order.items_count ?? order.items?.length ?? 1);
                      const extraCount = designCount - 1;
                      const readyPrepress = (order.items ?? []).filter(
                        (it) =>
                          it.prepress_status &&
                          it.prepress_status !== "pendiente" &&
                          it.prepress_status !== "pending" &&
                          it.prepress_status !== "Pendiente"
                      ).length;

                      return (
                        <div className="flex items-center gap-3.5">
                          <OrderStickerStack order={order} size="sm" showBadge={false} />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="font-semibold text-ink-primary">
                                {order.material}
                                {order.vinyl_gloss_mode ? (
                                  <span className="ml-1 font-normal text-ink-muted">
                                    ({order.vinyl_gloss_mode})
                                  </span>
                                ) : null}
                              </p>
                              {designCount >= 2 && (
                                <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-line-diecut/80 bg-accent-soft px-2 py-0.5 font-mono text-[10px] font-bold tabular-nums text-accent transition-colors duration-fast ease-studio group-hover:border-line-diecut group-hover:bg-accent group-hover:text-accent-ink">
                                  <Layers className="h-2.5 w-2.5" aria-hidden="true" />+{extraCount}{" "}
                                  {extraCount === 1 ? "diseño" : "diseños"}
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-ink-muted">
                              <span>{order.shape}</span>
                              <span>·</span>
                              <span className="rounded border border-line-subtle bg-surface-elevated/80 px-1.5 py-0.5 font-bold text-ink-primary">
                                {order.items?.[0]?.size_display || order.size_display}
                              </span>
                              {designCount >= 2 && readyPrepress > 0 ? (
                                <span className="font-semibold text-accent">
                                  · {readyPrepress}/{designCount} preprensa
                                </span>
                              ) : null}
                            </p>
                          </div>
                        </div>
                      );
                    })()}
                  </td>

                  <td className="whitespace-nowrap px-4 py-3.5 text-right font-mono font-bold tabular-nums text-ink-primary">
                    {order.quantity.toLocaleString()}
                  </td>

                  <td className="whitespace-nowrap px-4 py-3.5 text-right font-mono tabular-nums">
                    <p className="font-bold text-ink-primary">
                      {formatCurrency(order.total_price)}
                    </p>
                    <p className="text-[11px] text-ink-muted">
                      Saldo:{" "}
                      <span
                        className={
                          order.pending_balance > 0 ? "font-bold text-accent" : ""
                        }
                      >
                        {formatCurrency(order.pending_balance)}
                      </span>
                    </p>
                  </td>

                  <td className="whitespace-nowrap px-4 py-3.5">
                    <StickerBadge status={order.status} size="sm" />
                  </td>

                  <td className="whitespace-nowrap px-4 py-3.5 text-right">
                    <Button
                      type="button"
                      size="sm"
                      variant="dieCut"
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
    </StickerCard>
  );
};
