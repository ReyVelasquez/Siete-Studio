import React, { useEffect, useMemo, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence } from "framer-motion";
import { useFieldArray, useForm } from "react-hook-form";
import {
  AlertCircle,
  Calendar,
  Layers,
  Phone,
  Plus,
  User,
  Wallet,
} from "lucide-react";
import { THEME_CONFIG, formatCurrency } from "@/config/theme.config";
import { DesignItemCard } from "@/components/orders/DesignItemCard";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { StickerCard } from "@/components/ui/StickerCard";
import {
  MAX_ORDER_DESIGNS,
  quickOrderSchema,
  type OrderDesignItemFormValues,
  type QuickOrderFormValues,
} from "@/schemas/order.schema";
import {
  getFallbackPublicMaterials,
  mapPublicMaterialsToOptions,
  materialsService,
  type PublicMaterialOption,
} from "@/services/materials.service";
import { ordersService } from "@/services/orders.service";
import type { OrderItem } from "@/types/order";
import { getLocalTodayIsoDate, getNextAvailableDeliverySlot } from "@/utils/date";
import { useToast } from "@/hooks/useToast";

interface QuickOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (order: OrderItem) => void;
}

function createDefaultDesignItem(): OrderDesignItemFormValues {
  return {
    material: "Vinilo Mate",
    vinyl_gloss_mode: null,
    shape: "Circular",
    diameter_cm: "5",
    size_mode: "both",
    height_cm: "",
    width_cm: "",
    dimensions: "",
    quantity: 50,
    image: null,
  };
}

export const QuickOrderModal: React.FC<QuickOrderModalProps> = ({
  isOpen,
  onClose,
  onCreated,
}) => {
  const { pushToast } = useToast();
  const initialSlot = useMemo(() => getNextAvailableDeliverySlot(), []);
  const [previewUrlsById, setPreviewUrlsById] = useState<Record<string, string>>({});
  const previewUrlsRef = useRef<Record<string, string>>({});
  const [materials, setMaterials] = useState<PublicMaterialOption[]>(() =>
    getFallbackPublicMaterials()
  );

  const {
    control,
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<QuickOrderFormValues>({
    resolver: zodResolver(quickOrderSchema),
    defaultValues: {
      referral_name: "",
      phone: "",
      delivery_date: initialSlot.date,
      delivery_hour: initialSlot.hour,
      items: [createDefaultDesignItem()],
      total_price: 0,
      advance_payment: 0,
      payment_method: "Pendiente",
      status: "Pendiente",
      notes: "",
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "items",
  });

  const watched = watch();
  const watchedItems = watched.items ?? [];

  useEffect(() => {
    previewUrlsRef.current = previewUrlsById;
  }, [previewUrlsById]);

  useEffect(() => {
    return () => {
      Object.values(previewUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    materialsService
      .listPublicMaterials()
      .then((res) => {
        if (!active) return;
        setMaterials(mapPublicMaterialsToOptions(res.items));
      })
      .catch(() => {
        if (!active) return;
        setMaterials(getFallbackPublicMaterials());
      });
    return () => {
      active = false;
    };
  }, [isOpen]);

  const revokeAllPreviews = () => {
    Object.values(previewUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    previewUrlsRef.current = {};
    setPreviewUrlsById({});
  };

  const handleDesignImageChange = (fieldId: string, index: number, file: File | null) => {
    setPreviewUrlsById((prev) => {
      const next = { ...prev };
      if (next[fieldId]) {
        URL.revokeObjectURL(next[fieldId]);
        delete next[fieldId];
      }
      if (file) {
        next[fieldId] = URL.createObjectURL(file);
      }
      return next;
    });

    setValue(`items.${index}.image`, file, { shouldValidate: true, shouldDirty: true });
  };

  const handleAddDesign = () => {
    if (fields.length >= MAX_ORDER_DESIGNS) return;
    const nextIndex = fields.length;
    append(createDefaultDesignItem());

    window.requestAnimationFrame(() => {
      const el = document.getElementById(`quick-diseno-${nextIndex + 1}`);
      el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  };

  const handleRemoveDesign = (fieldId: string, index: number) => {
    if (fields.length <= 1) return;

    setPreviewUrlsById((prev) => {
      if (!prev[fieldId]) return prev;
      const next = { ...prev };
      URL.revokeObjectURL(next[fieldId]);
      delete next[fieldId];
      return next;
    });

    remove(index);
  };

  const handleClose = () => {
    const freshSlot = getNextAvailableDeliverySlot();
    revokeAllPreviews();
    reset({
      referral_name: "",
      phone: "",
      delivery_date: freshSlot.date,
      delivery_hour: freshSlot.hour,
      items: [createDefaultDesignItem()],
      total_price: 0,
      advance_payment: 0,
      payment_method: "Pendiente",
      status: "Pendiente",
      notes: "",
    });
    onClose();
  };

  const totalUnits = watchedItems.reduce((sum, item) => {
    const qty = Number(item?.quantity);
    return sum + (Number.isFinite(qty) && qty > 0 ? qty : 0);
  }, 0);

  const watchedTotal = Math.max(0, Number(watched.total_price) || 0);
  const watchedAdvance = Math.max(0, Number(watched.advance_payment) || 0);
  const computedBalance = Math.max(0, Number((watchedTotal - watchedAdvance).toFixed(2)));

  const onSubmit = async (values: QuickOrderFormValues) => {
    if (values.items.some((item) => !item.image)) return;

    try {
      const created = await ordersService.createAdminQuickOrder({
        referral_name: values.referral_name,
        phone: values.phone,
        delivery_date: values.delivery_date,
        delivery_hour: values.delivery_hour,
        items: values.items.map((item) => ({
          material: item.material,
          vinyl_gloss_mode: item.material === "Vinilo Brillo" ? item.vinyl_gloss_mode : null,
          shape: item.shape,
          diameter_cm: item.shape === "Circular" ? item.diameter_cm : undefined,
          size_mode: item.shape !== "Circular" ? (item.size_mode ?? "both") : undefined,
          height_cm: item.shape !== "Circular" ? item.height_cm : undefined,
          width_cm: item.shape !== "Circular" ? item.width_cm : undefined,
          dimensions: item.shape !== "Circular" ? item.dimensions : undefined,
          quantity: Number(item.quantity),
          image: item.image as File,
        })),
        total_price: values.total_price,
        advance_payment: values.advance_payment,
        payment_method: values.payment_method,
        status: values.status,
        notes: values.notes,
      });

      const designsLabel =
        values.items.length === 1
          ? "1 diseño"
          : `${values.items.length} diseños (${totalUnits.toLocaleString()} uds.)`;

      pushToast({
        title: `Pedido rápido ${created.order_number} creado`,
        description: `${designsLabel} · Estado: ${created.status}`,
        variant: "success",
      });
      onCreated(created);
      handleClose();
    } catch (err) {
      pushToast({
        title: "No se pudo registrar el pedido",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    }
  };

  const itemsRootError =
    errors.items && !Array.isArray(errors.items) ? errors.items.message : undefined;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Nuevo Pedido Rápido (Taller)"
      subtitle="Registra pedidos recibidos en mostrador o por WhatsApp con soporte multi-diseño y control inmediato de venta."
      maxWidthClass="max-w-4xl"
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
        {/* Step 01: Customer & Exact-Hour Delivery Header */}
        <StickerCard padding="md" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-line-subtle pb-3">
            <div className="flex items-center gap-2.5">
              <span className="sticker-badge flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent font-mono text-xs font-extrabold text-accent-ink">
                01
              </span>
              <div>
                <h3 className="font-display text-sm font-extrabold tracking-tight text-ink-primary">
                  Datos del Cliente y Horario de Entrega
                </h3>
                <p className="text-xs text-ink-muted">
                  Contacto del cliente y hora exacta de entrega en taller.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Nombre de Referido *"
              placeholder="Cliente o marca"
              disabled={isSubmitting}
              leftIcon={<User className="h-4 w-4" />}
              error={errors.referral_name?.message}
              {...register("referral_name")}
            />
            <Input
              label="Teléfono / WhatsApp *"
              placeholder="+591 71234567"
              inputMode="tel"
              disabled={isSubmitting}
              leftIcon={<Phone className="h-4 w-4" />}
              error={errors.phone?.message}
              {...register("phone")}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 border-t border-dashed border-line-subtle pt-4 sm:grid-cols-2">
            <Input
              label="Fecha de Entrega *"
              type="date"
              min={getLocalTodayIsoDate()}
              disabled={isSubmitting}
              leftIcon={<Calendar className="h-4 w-4" />}
              error={errors.delivery_date?.message}
              {...register("delivery_date")}
            />
            <Select
              label="Hora en punto (:00) *"
              disabled={isSubmitting}
              error={errors.delivery_hour?.message}
              {...register("delivery_hour")}
            >
              {THEME_CONFIG.deliveryHours.slots.map((slot) => (
                <option key={slot} value={slot}>
                  {slot} hrs
                </option>
              ))}
            </Select>
          </div>
        </StickerCard>

        {/* Step 02: Dynamic List of Sticker Design Cards (`useFieldArray` + `DesignItemCard`) */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-sticker border border-line-subtle bg-surface-card px-4 py-3.5 shadow-xs">
            <div className="flex items-center gap-2.5">
              <span className="sticker-badge flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent font-mono text-xs font-extrabold text-accent-ink">
                02
              </span>
              <div>
                <h3 className="font-display text-sm font-extrabold tracking-tight text-ink-primary">
                  Diseños del Pedido
                </h3>
                <p className="text-xs text-ink-muted">
                  Agrega uno o más diseños con sus propias reglas de material, corte e imagen.
                </p>
              </div>
            </div>

            <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-diecut/75 bg-accent-soft px-3 py-1 font-mono text-[11px] font-bold tabular-nums text-ink-primary">
              <Layers className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
              {fields.length} {fields.length === 1 ? "diseño" : "diseños"} ·{" "}
              {totalUnits.toLocaleString()} uds.
            </span>
          </div>

          {itemsRootError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-state-critical-bg bg-state-critical-bg px-4 py-3 text-xs font-semibold text-state-critical-ink"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{itemsRootError}</span>
            </div>
          )}

          <div className="space-y-5">
            <AnimatePresence initial={false}>
              {fields.map((field, index) => {
                const currentItem = watchedItems[index] ?? createDefaultDesignItem();
                const currentErrors = Array.isArray(errors.items)
                  ? errors.items[index]
                  : undefined;

                return (
                  <DesignItemCard<QuickOrderFormValues>
                    key={field.id}
                    fieldId={field.id}
                    index={index}
                    totalCount={fields.length}
                    value={currentItem}
                    materials={materials}
                    itemErrors={currentErrors}
                    previewUrl={previewUrlsById[field.id] ?? null}
                    showPreviewToggle={false}
                    idPrefix="quick-diseno"
                    disabled={isSubmitting}
                    register={register}
                    setValue={setValue}
                    onImageChange={(file) => handleDesignImageChange(field.id, index, file)}
                    onRemove={() => handleRemoveDesign(field.id, index)}
                  />
                );
              })}
            </AnimatePresence>
          </div>

          <div className="pt-1">
            <Button
              type="button"
              variant="dieCut"
              size="lg"
              fullWidth
              disabled={isSubmitting || fields.length >= MAX_ORDER_DESIGNS}
              onClick={handleAddDesign}
              className="h-12 border-2 text-sm font-bold"
            >
              + Agregar otro diseño
            </Button>
            {fields.length >= MAX_ORDER_DESIGNS && (
              <p className="mt-2 text-center font-mono text-[11px] text-ink-muted">
                Alcanzaste el límite de {MAX_ORDER_DESIGNS} diseños por pedido.
              </p>
            )}
          </div>
        </section>

        {/* Step 03: Sales Control, Initial Production Status & Workshop Notes */}
        <StickerCard tone="featured" padding="md" className="space-y-4">
          <div className="flex items-center gap-2.5 border-b border-dashed border-line-subtle pb-3">
            <span className="sticker-badge flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent font-mono text-xs font-extrabold text-accent-ink">
              03
            </span>
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-accent" aria-hidden="true" />
              <h3 className="font-display text-sm font-extrabold tracking-tight text-ink-primary">
                Control de Venta, Adelanto y Estado Inicial
              </h3>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Input
              label={`Precio Total (${THEME_CONFIG.brand.currencySymbol})`}
              type="number"
              min="0"
              step="0.50"
              disabled={isSubmitting}
              error={errors.total_price?.message}
              {...register("total_price")}
            />
            <Input
              label={`Adelanto (${THEME_CONFIG.brand.currencySymbol})`}
              type="number"
              min="0"
              step="0.50"
              disabled={isSubmitting}
              error={errors.advance_payment?.message}
              {...register("advance_payment")}
            />
            <Select
              label="Método de Pago"
              disabled={isSubmitting}
              error={errors.payment_method?.message}
              {...register("payment_method")}
            >
              {THEME_CONFIG.paymentMethods.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
            <Select
              label="Estado Inicial"
              disabled={isSubmitting}
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

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-line-diecut bg-surface-elevated px-4 py-2.5 text-xs">
            <span className="font-semibold text-ink-secondary">
              Saldo pendiente estimado ({fields.length}{" "}
              {fields.length === 1 ? "diseño" : "diseños"} · {totalUnits.toLocaleString()} uds.):
            </span>
            <span className="font-mono text-base font-extrabold tabular-nums text-ink-primary">
              {formatCurrency(computedBalance)}
            </span>
          </div>

          <Input
            label="Notas internas (opcional)"
            placeholder="Detalles rápidos para diseño, corte o entrega..."
            disabled={isSubmitting}
            error={errors.notes?.message}
            {...register("notes")}
          />
        </StickerCard>

        <div className="flex flex-col-reverse justify-end gap-2.5 border-t border-line-subtle pt-3 sm:flex-row">
          <Button type="button" variant="outline" disabled={isSubmitting} onClick={handleClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            loading={isSubmitting}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            {fields.length > 1
              ? `Registrar Pedido (${fields.length} diseños)`
              : "Registrar Pedido"}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
