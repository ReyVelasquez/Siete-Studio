import React, { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Plus } from "lucide-react";
import { THEME_CONFIG } from "@/config/theme.config";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { StickerDropzone } from "@/components/orders/StickerDropzone";
import { publicOrderSchema, type PublicOrderFormValues } from "@/schemas/order.schema";
import { ordersService } from "@/services/orders.service";
import type { OrderItem, PaymentMethod } from "@/types/order";
import { getLocalTodayIsoDate, getNextAvailableDeliverySlot } from "@/utils/date";
import { useToast } from "@/hooks/useToast";

interface QuickOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (order: OrderItem) => void;
}

export const QuickOrderModal: React.FC<QuickOrderModalProps> = ({
  isOpen,
  onClose,
  onCreated,
}) => {
  const { pushToast } = useToast();
  const initialSlot = useMemo(() => getNextAvailableDeliverySlot(), []);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [totalPrice, setTotalPrice] = useState("0");
  const [advancePayment, setAdvancePayment] = useState("0");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("Pendiente");
  const [notes, setNotes] = useState("");

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PublicOrderFormValues>({
    resolver: zodResolver(publicOrderSchema),
    defaultValues: {
      referral_name: "",
      phone: "",
      material: "Vinilo Mate",
      vinyl_gloss_mode: null,
      shape: "Circular",
      diameter_cm: "5",
      dimensions: "",
      quantity: 50,
      delivery_date: initialSlot.date,
      delivery_hour: initialSlot.hour,
      image: null,
    },
  });

  const watched = watch();

  useEffect(() => {
    if (watched.material !== "Vinilo Brillo" && watched.vinyl_gloss_mode) {
      setValue("vinyl_gloss_mode", null);
    }
  }, [watched.material, watched.vinyl_gloss_mode, setValue]);

  useEffect(() => {
    if (watched.shape === "Circular") {
      if (watched.dimensions) setValue("dimensions", "", { shouldValidate: false });
    } else if (watched.diameter_cm) {
      setValue("diameter_cm", "", { shouldValidate: false });
    }
  }, [watched.shape, watched.dimensions, watched.diameter_cm, setValue]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleFileChange = (file: File | null) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(file ? URL.createObjectURL(file) : null);
    setValue("image", file, { shouldValidate: true });
  };

  const handleClose = () => {
    reset();
    setTotalPrice("0");
    setAdvancePayment("0");
    setPaymentMethod("Pendiente");
    setNotes("");
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    onClose();
  };

  const onSubmit = async (values: PublicOrderFormValues) => {
    if (!values.image) return;
    const parsedTotal = Math.max(0, Number(totalPrice) || 0);
    const parsedAdvance = Math.max(0, Number(advancePayment) || 0);
    if (parsedTotal > 0 && parsedAdvance > parsedTotal) {
      pushToast({
        title: "Adelanto inválido",
        description: "El adelanto no puede superar el precio total.",
        variant: "error",
      });
      return;
    }

    try {
      const created = await ordersService.createAdminQuickOrder({
        referral_name: values.referral_name,
        phone: values.phone,
        material: values.material,
        vinyl_gloss_mode: values.material === "Vinilo Brillo" ? values.vinyl_gloss_mode : null,
        shape: values.shape,
        diameter_cm: values.shape === "Circular" ? values.diameter_cm : undefined,
        dimensions: values.shape !== "Circular" ? values.dimensions : undefined,
        quantity: values.quantity,
        delivery_date: values.delivery_date,
        delivery_hour: values.delivery_hour,
        image: values.image,
        total_price: parsedTotal,
        advance_payment: parsedAdvance,
        payment_method: paymentMethod,
        notes,
      });

      pushToast({
        title: `Pedido rápido ${created.order_number} creado`,
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

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Nuevo Pedido Rápido (Taller)"
      subtitle="Registra pedidos recibidos en mostrador o por WhatsApp con control inmediato de venta."
      maxWidthClass="max-w-3xl"
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Nombre de Referido *"
            placeholder="Cliente o marca"
            error={errors.referral_name?.message}
            {...register("referral_name")}
          />
          <Input
            label="Teléfono / WhatsApp *"
            placeholder="+591 71234567"
            error={errors.phone?.message}
            {...register("phone")}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select label="Material *" error={errors.material?.message} {...register("material")}>
            {THEME_CONFIG.materials.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>

          <Select label="Forma *" error={errors.shape?.message} {...register("shape")}>
            {THEME_CONFIG.shapes.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>

        {watched.material === "Vinilo Brillo" && (
          <div className="rounded-lg border border-dashed border-line-diecut bg-surface-elevated/70 p-3">
            <Select
              label="Modalidad requerida para Vinilo Brillo *"
              error={errors.vinyl_gloss_mode?.message}
              {...register("vinyl_gloss_mode")}
            >
              <option value="">Selecciona modalidad...</option>
              {THEME_CONFIG.vinylGlossModes.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </Select>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {watched.shape === "Circular" ? (
            <Input
              label="Diámetro (cm) *"
              type="number"
              step="0.1"
              placeholder="Ej. 5"
              error={errors.diameter_cm?.message}
              {...register("diameter_cm")}
            />
          ) : (
            <Input
              label="Alto x Ancho *"
              placeholder="Ej. 5x7 cm"
              error={errors.dimensions?.message}
              {...register("dimensions")}
            />
          )}

          <Input
            label="Cantidad *"
            type="number"
            min={1}
            error={errors.quantity?.message}
            {...register("quantity")}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Fecha de Entrega *"
            type="date"
            min={getLocalTodayIsoDate()}
            error={errors.delivery_date?.message}
            {...register("delivery_date")}
          />
          <Select
            label="Hora en punto (:00) *"
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

        <StickerDropzone
          file={watched.image ?? null}
          previewUrl={previewUrl}
          error={errors.image?.message as string | undefined}
          onFileChange={handleFileChange}
        />

        <div className="grid grid-cols-1 gap-4 rounded-lg border border-line-subtle bg-surface-elevated/60 p-4 sm:grid-cols-3">
          <Input
            label={`Precio Total (${THEME_CONFIG.brand.currencySymbol})`}
            type="number"
            min="0"
            step="0.50"
            value={totalPrice}
            onChange={(e) => setTotalPrice(e.target.value)}
          />
          <Input
            label={`Adelanto (${THEME_CONFIG.brand.currencySymbol})`}
            type="number"
            min="0"
            step="0.50"
            value={advancePayment}
            onChange={(e) => setAdvancePayment(e.target.value)}
          />
          <Select
            label="Método de Pago"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
          >
            {THEME_CONFIG.paymentMethods.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </div>

        <Input
          label="Notas internas (opcional)"
          placeholder="Detalles rápidos para diseño o entrega..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <div className="flex justify-end gap-2.5 pt-2">
          <Button type="button" variant="outline" onClick={handleClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={isSubmitting} leftIcon={<Plus className="h-4 w-4" />}>
            Registrar Pedido
          </Button>
        </div>
      </form>
    </Modal>
  );
};
