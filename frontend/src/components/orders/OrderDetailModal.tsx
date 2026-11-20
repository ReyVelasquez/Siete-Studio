import React, { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  CalendarClock,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  Save,
  Wallet,
} from "lucide-react";
import { THEME_CONFIG, formatCurrency } from "@/config/theme.config";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { StickerBadge } from "@/components/ui/StickerBadge";
import { salesUpdateSchema, type SalesUpdateFormValues } from "@/schemas/order.schema";
import { ordersService } from "@/services/orders.service";
import type { OrderItem } from "@/types/order";
import { formatDateTime } from "@/utils/date";
import { useToast } from "@/hooks/useToast";

interface OrderDetailModalProps {
  order: OrderItem | null;
  onClose: () => void;
  onUpdated: (updatedOrder: OrderItem) => void;
}

export const OrderDetailModal: React.FC<OrderDetailModalProps> = ({
  order,
  onClose,
  onUpdated,
}) => {
  const { pushToast } = useToast();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loadingImage, setLoadingImage] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SalesUpdateFormValues>({
    resolver: zodResolver(salesUpdateSchema),
  });

  useEffect(() => {
    if (!order) return;
    reset({
      total_price: order.total_price,
      advance_payment: order.advance_payment,
      payment_method: order.payment_method,
      status: order.status,
      notes: order.notes ?? "",
    });
  }, [order, reset]);

  useEffect(() => {
    if (!order) {
      setImageUrl(null);
      return;
    }

    let cancelled = false;
    let createdUrl: string | null = null;

    const loadImage = async () => {
      setLoadingImage(true);
      try {
        const url = await ordersService.fetchOrderImageObjectUrl(order.id);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        createdUrl = url;
        setImageUrl(url);
      } catch {
        if (!cancelled) setImageUrl(null);
      } finally {
        if (!cancelled) setLoadingImage(false);
      }
    };

    void loadImage();

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [order]);

  if (!order) return null;

  const watchedTotal = Number(watch("total_price")) || 0;
  const watchedAdvance = Number(watch("advance_payment")) || 0;
  const computedBalance = Math.max(0, Number((watchedTotal - watchedAdvance).toFixed(2)));

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await ordersService.downloadOrderImageFile(order.id, order.image.safe_filename || `${order.order_number}.png`);
      pushToast({ title: "Descarga iniciada", description: order.order_number, variant: "success" });
    } catch (err) {
      pushToast({
        title: "No se pudo descargar la imagen",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setDownloading(false);
    }
  };

  const onSubmit = async (values: SalesUpdateFormValues) => {
    try {
      const updated = await ordersService.updateOrderSales(order.id, {
        total_price: values.total_price,
        advance_payment: values.advance_payment,
        payment_method: values.payment_method,
        status: values.status,
        notes: values.notes || null,
      });
      onUpdated(updated);
      pushToast({
        title: `Pedido ${updated.order_number} actualizado`,
        description: `Estado: ${updated.status} · Saldo: ${formatCurrency(updated.pending_balance)}`,
        variant: "success",
      });
      onClose();
    } catch (err) {
      pushToast({
        title: "Error al guardar cambios",
        description: err instanceof Error ? err.message : "Intenta nuevamente.",
        variant: "error",
      });
    }
  };

  const cleanPhone = order.phone.replace(/\D/g, "");
  const waHref = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(
    `Hola ${order.referral_name}, te escribimos de ${THEME_CONFIG.brand.name} respecto a tu pedido ${order.order_number}.`
  )}`;

  return (
    <Modal
      isOpen={Boolean(order)}
      onClose={onClose}
      title={`Pedido ${order.order_number}`}
      subtitle={`Referido: ${order.referral_name} · Recibido ${formatDateTime(order.received_at)}`}
      maxWidthClass="max-w-4xl"
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column: Artwork & Technical Print Specs */}
        <div className="space-y-4 lg:col-span-5">
          <div className="die-cut-zone overflow-hidden rounded-xl p-3">
            <div className="bg-transparency-grid flex h-56 items-center justify-center overflow-hidden rounded-lg border border-line-subtle p-3">
              {loadingImage ? (
                <div className="flex flex-col items-center gap-2 text-ink-muted">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <span className="text-xs">Cargando arte seguro...</span>
                </div>
              ) : imageUrl ? (
                <img
                  src={imageUrl}
                  alt={`Arte del pedido ${order.order_number}`}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-ink-muted">
                  <ImageIcon className="h-7 w-7" />
                  <span className="text-xs">Vista previa no disponible</span>
                </div>
              )}
            </div>

            <div className="mt-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-mono text-[11px] font-semibold text-ink-primary">
                  {order.image.original_filename}
                </p>
                <p className="font-mono text-[10px] text-ink-muted">
                  {order.image.content_type} · {(order.image.size_bytes / 1024).toFixed(0)} KB
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={downloading}
                onClick={handleDownload}
                leftIcon={<Download className="h-3.5 w-3.5" />}
              >
                Descargar
              </Button>
            </div>
          </div>

          <div className="rounded-xl border border-line-subtle bg-surface-elevated/60 p-4 text-xs">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-bold uppercase tracking-wider text-ink-secondary">
                Ficha Técnica
              </span>
              <StickerBadge status={order.status} />
            </div>

            <dl className="space-y-2">
              <div className="flex justify-between gap-2">
                <dt className="text-ink-muted">Material</dt>
                <dd className="text-right font-semibold text-ink-primary">
                  {order.material}
                  {order.vinyl_gloss_mode ? ` · ${order.vinyl_gloss_mode}` : ""}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-muted">Forma</dt>
                <dd className="font-semibold text-ink-primary">{order.shape}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-muted">Medida</dt>
                <dd className="font-mono font-bold text-ink-primary">{order.size_display}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-muted">Cantidad</dt>
                <dd className="font-mono font-bold text-ink-primary">
                  {order.quantity.toLocaleString()} uds.
                </dd>
              </div>
              <div className="flex justify-between gap-2 border-t border-line-subtle pt-2">
                <dt className="flex items-center gap-1 text-ink-muted">
                  <CalendarClock className="h-3.5 w-3.5" />
                  Entrega
                </dt>
                <dd className="font-mono font-bold text-ink-primary">
                  {formatDateTime(order.delivery_datetime)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-ink-muted">Teléfono</dt>
                <dd>
                  <a
                    href={waHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-mono font-semibold text-accent hover:underline"
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    {order.phone}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </dd>
              </div>
            </dl>
          </div>
        </div>

        {/* Right Column: Sales Control & Status Editor */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 lg:col-span-7">
          <div className="rounded-xl border border-line-subtle bg-surface-card p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-2 border-b border-line-subtle pb-3">
              <Wallet className="h-4 w-4 text-accent" />
              <h3 className="font-display text-sm font-bold text-ink-primary">
                Control de Ventas y Estado de Producción
              </h3>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label={`Precio Total (${THEME_CONFIG.brand.currencySymbol})`}
                type="number"
                step="0.50"
                min="0"
                error={errors.total_price?.message}
                {...register("total_price")}
              />
              <Input
                label={`Adelanto (${THEME_CONFIG.brand.currencySymbol})`}
                type="number"
                step="0.50"
                min="0"
                error={errors.advance_payment?.message}
                {...register("advance_payment")}
              />
            </div>

            {/* Automatic Live Pending Balance Readout */}
            <div className="mt-4 flex items-center justify-between rounded-lg border border-dashed border-line-diecut bg-surface-elevated px-4 py-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
                  Saldo Pendiente (calculado automáticamente)
                </p>
                <p className="text-[11px] text-ink-muted">
                  Precio total − Adelanto registrado
                </p>
              </div>
              <span className="font-mono text-xl font-extrabold text-ink-primary">
                {formatCurrency(computedBalance)}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Select
                label="Método de Pago"
                error={errors.payment_method?.message}
                {...register("payment_method")}
              >
                {THEME_CONFIG.paymentMethods.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </Select>

              <Select
                label="Estado del Pedido"
                error={errors.status?.message}
                {...register("status")}
              >
                {THEME_CONFIG.orderStatuses.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </Select>
            </div>

            <div className="mt-4 space-y-1.5">
              <label
                htmlFor="order-notes"
                className="block text-xs font-semibold uppercase tracking-wider text-ink-secondary"
              >
                Notas Internas de Taller
              </label>
              <textarea
                id="order-notes"
                rows={3}
                placeholder="Indicaciones de corte, laminado, referencia de pago o entrega..."
                className="w-full rounded-md border border-line-subtle bg-surface-card px-3.5 py-2.5 text-sm text-ink-primary placeholder:text-ink-muted focus:border-line-diecut focus:outline-none"
                {...register("notes")}
              />
              {errors.notes && (
                <p className="text-xs font-semibold text-brand-800 dark:text-brand-200">
                  • {errors.notes.message}
                </p>
              )}
            </div>

            {order.updated_by && order.updated_at && (
              <p className="mt-3 text-[11px] text-ink-muted">
                Última actualización: {formatDateTime(order.updated_at)} por{" "}
                <span className="font-mono">{order.updated_by}</span>
              </p>
            )}
          </div>

          <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              type="submit"
              loading={isSubmitting}
              leftIcon={<Save className="h-4 w-4" />}
            >
              Guardar cambios
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
};
